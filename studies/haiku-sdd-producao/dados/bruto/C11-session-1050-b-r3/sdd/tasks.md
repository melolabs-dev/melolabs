# Tarefas — Múltiplas senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (D-01 a D-08).

Ordem: primeiro os testes de regressão (T-01 a T-05), que devem falhar antes da mudança de código, depois a implementação (T-06 a T-11), a documentação (T-12) e a verificação final (T-13). Conforme `AGENTS.md`, cada teste de comportamento novo precisa ser confirmado como falhando antes da mudança.

---

### T-01 — Testes de leitura com senha extra

**Cobre:** RF-01, RF-04

**Depende de:** nenhuma

**Aceite:** criar `test/session-unseal-passwords.test.ts` com `describeMatrix`. Cobrir: cookie selado com `B` (config `password: A`, extras `[B]`) mantém `id`, `createdAt` e `data` (RF-01); sem `extraUnsealPasswords`, cookie com outra senha vira sessão nova e cookie legado selado com `password` ainda abre e é resselado (RF-04). Com `pnpm vitest run test/session-unseal-passwords.test.ts`, o caso de RF-01 deve falhar antes da mudança (sessão nova, `id` diferente); os casos de RF-04 devem passar.

**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-02 — Testes de escrita e migração por cookie

**Cobre:** RF-02, RF-03

**Depende de:** T-01 (mesmo arquivo de teste)

**Aceite:** acrescentar ao arquivo de testes: `updateSession` e `useSession(...).update` gravam cookie que abre só com `A`, e `unseal` com `B` lança (RF-02); leitura por cookie com `B` devolve `Set-Cookie` com selo que abre com `A` e não com `B`, mantendo os mesmos dados (RF-03). O caso de RF-03 deve falhar antes da mudança (sem `Set-Cookie`). O caso de RF-02 pode passar, porque não há extra antes da mudança; isso deve ser registrado no relatório.

**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-03 — Testes de prazos e de custo de derivação

**Cobre:** RF-05

**Depende de:** T-02

**Aceite:** acrescentar testes com `vi.useFakeTimers({ toFake: ["Date"] })`, no padrão de `test/session.test.ts:313`: cookie com `B` e `maxAge` expirado é descartado e nenhum dado é herdado; o mesmo com `idleTimeout` expirado. Acrescentar teste de custo que espiona `crypto.subtle.deriveBits` no padrão de `test/session.test.ts:722-735` e confirma que um cookie inválido com `N` extras faz `1 + N` derivações no modo estrito. Os testes de prazo devem falhar ou passar por acidente antes da mudança; o de custo deve falhar antes da mudança.

**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-04 — Testes de validação de `extraUnsealPasswords`

**Cobre:** RF-06

**Depende de:** T-03

**Aceite:** acrescentar testes em que `extraUnsealPasswords: ["curta"]` causa erro em `getSession` e em `useSession`, mesmo sem cookie na requisição. A rota de teste deve capturar o erro com `try/catch`, porque erro não tratado conta como falha em `ctx.errors` (`AGENTS.md`). A mensagem deve citar o índice (`extraUnsealPasswords[0]`) e não deve conter o valor da senha. Antes da mudança, o erro não aparece (é engolido e a sessão é tratada como nova): o teste deve falhar.

**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-05 — Testes de marca interna, header e legado sem fallback

**Cobre:** RF-03

**Depende de:** T-04

**Aceite:** acrescentar testes que confirmam: (a) o `Set-Cookie` gerado após migração, aberto com `unseal`, não contém a marca interna `kExtraUnsealPassword` no payload (D-03); (b) com `legacySealFallback: false`, um cookie legado selado com `B` é rejeitado e a sessão é tratada como nova (D-05); (c) sessão aberta por `B` via `sessionHeader` não gera `Set-Cookie` (fora de escopo do PRD, mas evita regressão silenciosa). Os casos (a) e (b) devem falhar antes da mudança ou passar apenas por ausência de extra; registrar o resultado de cada um.

**Arquivos:** `test/session-unseal-passwords.test.ts`

---

### T-06 — Campo público `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

**Depende de:** T-05

**Aceite:** acrescentar `extraUnsealPasswords?: string[]` a `SessionConfig`, logo após `password`, com o JSDoc de D-08 (nunca sela; abre depois de `password`; mínimo de 32 caracteres; sessões abertas por ela são resseladas por cookie; janela maior que `maxAge` ou `idleTimeout`; custo de PBKDF2 por entrada). Nenhum outro campo ou função pública novo. `pnpm typecheck` passa, e a configuração com o campo compila nos testes.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Validação de `extraUnsealPasswords` em `getSession`

**Cobre:** RF-06

**Depende de:** T-06

**Aceite:** criar `assertExtraUnsealPasswords(config)` em `src/utils/internal/session.ts`, que lança `Invalid extraUnsealPasswords[${index}]: must be a string of at least ${min} characters` quando a entrada não é string ou tem menos de `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` caracteres (valores de `iron-crypto.ts:22` e `:28`, ou os de `config.seal`). Chamar a função no início de `getSession`, antes de tocar em `context.sessions`. Os testes de T-04 passam; o valor da senha não aparece na mensagem.

**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

---

### T-08 — Laço de senhas em `unsealSession`

**Cobre:** RF-01, RF-04

**Depende de:** T-06

**Aceite:** mover o corpo atual do `try/catch` de `unsealSession` (`session.ts:324-347`) para `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`. `unsealSession` percorre `[config.password, ...extraUnsealPasswords]` e avança só em erro `Bad hmac value`; qualquer outro erro é relançado de imediato. O fallback legado é tentado por senha antes da próxima (D-05). A assinatura pública de `unsealSession` não muda. Com lista vazia, o comportamento é idêntico ao atual, e `pnpm vitest run test/session.test.ts` passa sem alteração. Os casos de RF-01 de T-01 passam (a marca ainda não é usada aqui, então a reselagem fica para T-09).

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-09 — Marca `kExtraUnsealPassword` e reselagem por cookie

**Cobre:** RF-03

**Depende de:** T-08

**Aceite:** adicionar o símbolo `kExtraUnsealPassword` em `src/utils/internal/session.ts`, com `Symbol.for("h3.internal.session.extra-unseal-password")`, no mesmo padrão de `kLegacySeal`. `unsealSession` marca o resultado quando a abertura usou uma extra. `getSession` lê e apaga a marca antes de `Object.assign(session, unsealed)`. A condição de reselagem (`session.ts:214`) passa a ser `legacySeal || extraSeal || shouldSlide(session, config)`, válida só para `sessionFromCookie`. Os casos de RF-03 de T-02 e T-05 (a) passam.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-10 — Escrita sempre com `password`

**Cobre:** RF-02

**Depende de:** T-09

**Aceite:** confirmar que `sealSession` e `updateSession` usam só `config.password` (sem alterar o código de selagem, salvo se algum caminho usar as extras). Os testes de RF-02 de T-02 passam, e a marca `kExtraUnsealPassword` não aparece no payload selado (cobertura de T-05 a).

**Arquivos:** `src/utils/session.ts`

---

### T-11 — Prazos conferidos depois da abertura

**Cobre:** RF-05

**Depende de:** T-09

**Aceite:** manter as verificações de `maxAge` (`session.ts:350-355`) e `idleTimeout` (`session.ts:359-365`) após o laço de senhas, sem depender da senha usada (D-07). Confirmar que a reselagem não renova `createdAt`, e que `sessionExpires` continua calculando o cookie a partir dele. Os testes de RF-05 de T-03 passam.

**Arquivos:** `src/utils/session.ts`

---

### T-12 — Documentação da rotação de senhas

**Cobre:** nenhum requisito funcional; documenta os riscos do PRD (janela de rotação, custo por entrada, sessões por header, troca de `password` pela senha antiga)

**Depende de:** T-10, T-11

**Aceite:** acrescentar em `docs/4.examples/handle-session.md`, após a seção de `idleTimeout` (`handle-session.md:183`), uma seção sobre rotação de senha com exemplo de configuração, a recomendação de janela maior que `maxAge` ou `idleTimeout`, o custo de derivação por entrada e a limitação de sessões lidas por header. Repetir o aviso sobre escrita concorrente de `Set-Cookie` (techspec, risco 5). Antes de editar `docs/2.utils/4.security.md`, verificar se o arquivo é gerado pelo automd; se for, atualizar pelo gerador (`pnpm fmt`) e não à mão.

**Arquivos:** `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md` (somente se não for gerado)

---

### T-13 — Verificação final

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06

**Depende de:** T-12

**Aceite:** executar, sem falhas: `pnpm vitest run test/session-unseal-passwords.test.ts`; `pnpm vitest run test/session.test.ts test/unit/iron-crypto.test.ts` (regressão sem alterar testes existentes); `pnpm lint` (oxlint, oxfmt --check e typecheck); `pnpm test` (suíte completa com cobertura). Relatar a saída de qualquer falha. Confirmar que `src/index.ts` e `src/utils/internal/iron-crypto.ts` não foram alterados.

**Arquivos:** `test/session-unseal-passwords.test.ts`, `test/session.test.ts`, `test/unit/iron-crypto.test.ts`
