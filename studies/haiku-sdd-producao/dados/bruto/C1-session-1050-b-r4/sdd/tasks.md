# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Ordem sugerida: T-01 → T-03 → T-02 → T-04 → T-05 → testes (T-06 a T-08) → verificação (T-09, T-10).

Pendências da techspec que afetam as tarefas (ver T-02 e T-04): limite de 3 senhas extras (D-06) e exposição do símbolo em `unsealSession` (R8). Até confirmação, seguir o padrão descrito em cada tarefa.

---

### T-01 — Adicionar `extraUnsealPasswords` ao tipo `SessionConfig`

Acrescentar o campo opcional logo após `password`, com JSDoc em inglês explicando: senhas anteriores que só abrem sessões; a selagem usa sempre `password`; cada extra custa uma derivação PBKDF2 por cookie que não abre com as anteriores; remover as extras depois da janela de migração. Nenhuma lógica nova nesta tarefa.

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:** `pnpm typecheck` passa. Um arquivo de teste de tipo (ou o próprio `session.test.ts` depois) aceita `{ password: A, extraUnsealPasswords: [B] }` e `{ password: A }`, e `password` continua `string`.

**Arquivos:** `src/utils/session.ts`

---

### T-02 — Validar senhas extras com `assertUnsealPasswords`

Criar o helper interno `assertUnsealPasswords(config)` no fim de `src/utils/session.ts`. Ele lança `Error` se alguma entrada de `extraUnsealPasswords` não for string ou tiver `length` menor que `(config.seal ?? sealDefaults).encryption.minPasswordlength`. A mensagem cita `extraUnsealPasswords[i]` e o mínimo. Não há validação de quantidade por enquanto: o limite de 3 (D-06) só entra se for confirmado, e nesse caso vira uma linha a mais no helper mais um teste.

**Cobre:** RF-06
**Depende de:** T-01
**Aceite:** com `extraUnsealPasswords: ["curta"]`, o helper lança `Error` cuja mensagem contém `extraUnsealPasswords`. Com `[]`, com o campo ausente e com uma senha de 32+ caracteres, não lança. O helper ainda não é chamado (fica para T-04 e T-05).

**Arquivos:** `src/utils/session.ts`

---

### T-03 — Extrair a tentativa por senha em `unsealWithPassword`

Refatoração sem mudança de comportamento. Mover o `try/catch` atual de `unsealSession` (com o strict e o fallback legado de 1 iteração) para o helper interno `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`. O corpo usa `password` e `legacySealFallback` recebidos como parâmetro, no lugar de `config.password` e `config.legacySealFallback`. `unsealSession` continua chamando o helper com `config.password`, e ainda sem laço.

**Cobre:** RF-02 (base da leitura), RF-05
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` passa sem alterar nenhuma expectativa, nos modos web e node. `unsealSession` mantém a mesma assinatura exportada.

**Arquivos:** `src/utils/session.ts`

---

### T-04 — Laço de tentativas em `unsealSession` e símbolo `kUnsealedWithExtra`

Em `unsealSession`:

1. Chamar `assertUnsealPasswords(config)` no início (RF-06 também para quem usa a API pública).
2. Percorrer `[config.password, ...(config.extraUnsealPasswords ?? [])]` com `let found = false` e `let firstError`. Em cada senha, chamar `unsealWithPassword`; ao abrir, marcar `found = true` e sair do laço (D-08: sucesso por flag, não por truthiness). Em falha, guardar só o primeiro erro com `firstError ??= e`.
3. Se `!found`, lançar `firstError`, para que o erro com uma só senha seja o mesmo de hoje.
4. Se a senha que abriu não for a primeira (índice > 0), marcar `unsealed[kUnsealedWithExtra] = true`.
5. Manter as checagens de `maxAge` e `idleTimeout` depois do laço, sem alteração (D-07). "Session expired!" não dispara nova tentativa.

Criar `kUnsealedWithExtra` em `src/utils/internal/session.ts`, junto de `kLegacySeal`, com `Symbol.for("h3.internal.session.unsealed-with-extra")`.

Sobre R8 (pendência): o símbolo fica no retorno público de `unsealSession`, como já acontece com `kLegacySeal`. Não documentar como API.

**Cobre:** RF-02, RF-04 (sinal para a regravação), RF-07, RF-06 (validação no caminho público)
**Depende de:** T-02, T-03
**Aceite:** com `B` na lista e cookie selado com `B`, `unsealSession` devolve os dados originais e o símbolo está marcado. Com `C` fora da lista, lança o mesmo erro de hoje. Com `password` correto, nenhum símbolo é marcado. Os testes de `test/session.test.ts` continuam passando.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-05 — Integrar em `getSession`: validação, flag e regravação

Em `getSession`:

1. Chamar `assertUnsealPasswords(config)` como primeira linha, antes de qualquer mutação de `context.sessions`, e fora do `.catch(() => {})` (R3).
2. Ler `kUnsealedWithExtra` junto de `kLegacySeal` e remover com `delete` antes de `Object.assign(session, unsealed)`, para o símbolo não entrar na sessão em memória (R7).
3. Trocar a condição de regravação para `if (session.id && sessionFromCookie && (legacySeal || unsealedWithExtra || shouldSlide(session, config)))`. Assim a sessão aberta por extra e lida de cookie é regravada com `password` (RF-04). Sessões de header não entram nessa condição (`sessionFromCookie` é `false`), então não recebem `Set-Cookie` (P2).

Não mudar o caminho de selagem: `updateSession` já usa `config.password` (RF-03).

**Cobre:** RF-03 (selagem inalterada, verificada), RF-04, RF-06
**Depende de:** T-02, T-04
**Aceite:** com `password: A`, `extraUnsealPasswords: [B]` e cookie selado com `B`, a resposta tem um `Set-Cookie` que abre com `A` e não abre com `B`. O mesmo com a sessão enviada pelo header não gera `Set-Cookie`. Com `extraUnsealPasswords: ["curta"]`, `getSession` rejeita com erro (não devolve sessão nova em silêncio).

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Testes de abertura, rejeição e expiração

Criar `describe("extraUnsealPasswords", ...)` dentro do `describeMatrix` de `test/session.test.ts`, antes do fim do bloco (perto da linha 777). Usar `seal(payload, senha, sealDefaults)` de `src/utils/internal/iron-crypto.ts`. Senhas: `A` é a de `sessionConfig` (linha 23); `B` e `C` com 50+ caracteres distintos.

Casos:
- Abre cookie selado com `B`: `data` original, sem `error`.
- Cookie selado com `C` (fora da lista): `id` diferente do selado, sem erro.
- Cookie selado com `B` e `createdAt` vencido, com `maxAge` ativo: sessão nova (RF-07).
- Lista `[]` e campo ausente dão a mesma resposta.

**Cobre:** RF-02, RF-05, RF-07, RF-08
**Depende de:** T-05
**Aceite:** `pnpm vitest run test/session.test.ts -t extraUnsealPasswords` passa nos modos web e node.

**Arquivos:** `test/session.test.ts`

---

### T-07 — Testes de selagem e migração

Dentro do mesmo `describe("extraUnsealPasswords")`:

- Selagem só com `password`: `updateSession` grava; `unseal(cookie, A)` abre; `unseal(cookie, B)` rejeita com `Bad hmac value` (RF-03).
- Migração por `Set-Cookie`: cookie com `B`; a resposta tem exatamente 1 `Set-Cookie`; o novo cookie abre com `A` e não abre com `B` (RF-04). Verificar com `decodeURIComponent(setCookie.match(...))`, como no teste de legado.
- Sessão de header: `B` enviada em `x-{name}-session`; abre; `getSetCookie()` vazio (RF-04, P2).
- Asserção R7: a sessão devolvida por `getSession` não tem `kUnsealedWithExtra` em `Object.getOwnPropertySymbols(...)`.

**Cobre:** RF-03, RF-04, RF-08
**Depende de:** T-05
**Aceite:** `pnpm vitest run test/session.test.ts -t extraUnsealPasswords` passa nos modos web e node, com os casos desta tarefa.

**Arquivos:** `test/session.test.ts`

---

### T-08 — Testes de validação, legado e lista vazia

Dentro do mesmo `describe("extraUnsealPasswords")`:

- Validação de extra inválida: handler com `try/catch` que devolve `error.message` no corpo; a mensagem cita `extraUnsealPasswords`. O erro não pode virar `unhandled` (`src/error.ts:205-206`), senão o `afterEach` de `test/_setup.ts:152-156` falha (RF-06).
- Legado com extra: cookie legado (1 iteração) selado com `B`; abre, e é regravado com `A`.
- Legado com extra e `legacySealFallback: false`: mesmo cookie é rejeitado (sessão nova) (R2).

**Cobre:** RF-06, RF-05, RF-08
**Depende de:** T-05
**Aceite:** `pnpm vitest run test/session.test.ts -t extraUnsealPasswords` passa nos modos web e node, incluindo os casos de legado.

**Arquivos:** `test/session.test.ts`

---

### T-09 — Suíte de sessão e exports sem regressão

Rodar a suíte completa de sessão e a de unit, sem alterar expectativas de testes existentes (RF-05). Confirmar que a lista de exports runtime não mudou (nenhum símbolo runtime novo além do que já existe; `kUnsealedWithExtra` é interno).

**Cobre:** RF-05, RF-08
**Depende de:** T-06, T-07, T-08
**Aceite:** `pnpm vitest run test/session.test.ts` passa nos modos web e node, sem edições nas expectativas de casos já existentes. `pnpm vitest run test/unit/` passa, incluindo `test/unit/package.test.ts`.

**Arquivos:** `test/session.test.ts`, `test/unit/package.test.ts` (somente leitura, se nada precisar mudar)

---

### T-10 — Lint e typecheck sem erros novos

Rodar `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` (`tsc --noEmit`) sobre a mudança. Corrigir formatação e tipos introduzidos por esta feature. Não corrigir erros que já existiam antes da mudança; registrá-los como pendência separada.

**Cobre:** RF-09
**Depende de:** T-09
**Aceite:** `pnpm lint` e `pnpm typecheck` terminam sem erros novos em relação à branch `master`.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts` (somente ajustes de formatação e tipo)
