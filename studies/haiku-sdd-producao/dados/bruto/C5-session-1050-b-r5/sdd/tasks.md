# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (D-01 a D-08).

Ordem geral: linha de base → campo e testes que falham → implementação → resselagem → verificação final. Os testes são escritos antes da implementação, como pede o `AGENTS.md` (Bug Fix Workflow adaptado).

Pendência: a techspec (D-03) diverge do PRD (RF-05) e precisa de confirmação do usuário antes da T-07.

### T-01 — Linha de base da suíte de sessões

**Cobre:** RF-08, RF-10

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/session.test.ts` passa sem nenhuma alteração no código. O resultado (número de testes passando) fica registrado para comparação com a T-09.

**Arquivos:** nenhum (somente execução).

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

**Depende de:** T-01

**Aceite:** `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, com o JSDoc da techspec (senhas anteriores que só abrem, selagem sempre com `password`, mínimo de 32 caracteres, custo de uma derivação PBKDF2 por cookie inválido). `pnpm typecheck` passa, e uma configuração sem o campo continua válida com `password` do tipo `string`. `pnpm fmt` atualiza `docs/2.utils/4.security.md` a partir do JSDoc; o diff gerado é revisado e não é editado à mão.

**Arquivos:** `src/utils/session.ts`, `docs/2.utils/4.security.md` (gerado pelo automd).

### T-03 — Testes dos cenários novos (escritos antes da implementação)

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09, RF-10

**Depende de:** T-01

**Aceite:** novo bloco em `describeMatrix("session", ...)` dentro de `test/session.test.ts`, rodando em `web` e `node`, com estes casos:
- Selagem só com `password`: o cookie emitido abre com A e falha com B (RF-02).
- Cookie selado com B, config `password = A`, `extraUnsealPasswords = [B]`: `getSession` retorna `id` e `data` esperados (RF-03).
- Config `password = A`, `extraUnsealPasswords = [B, C]`, cookie com C: retorna dados (RF-04).
- Cookie com B, sem `idleTimeout`: o `Set-Cookie` abre com A e falha com B (RF-05).
- Cookie legado (1 iteração) com B: abre, `data` correto, `Set-Cookie` resselado com A (RF-06).
- Mesmo cookie legado com `legacySealFallback: false`: sessão vazia (RF-06).
- Cookie selado com Z, fora das senhas configuradas: sessão vazia, resposta sem a senha no corpo (RF-07).
- `extra = ["curta"]`: resposta 500 com mensagem que cita o tamanho mínimo de 32 caracteres (RF-09).
- Extra igual a `password` e extra repetida: dois casos, ambos 500 (D-05).
- Cookie do header de sessão aberto por extra: sessão aberta e nenhum `Set-Cookie` emitido (D-03).

Antes de qualquer alteração em `src/`, rodar `pnpm vitest run test/session.test.ts` e registrar que os novos casos falham pelas razões esperadas (campo ignorado, cookie não aberto, sem resselagem, sem validação). Os testes existentes continuam passando.

**Arquivos:** `test/session.test.ts`.

### T-04 — Marcador interno `kExtraUnseal`

**Cobre:** RF-05

**Depende de:** T-01

**Aceite:** `src/utils/internal/session.ts` exporta `kExtraUnseal = Symbol.for("h3.internal.session.extra-unseal")`, no mesmo padrão de `kLegacySeal`. O símbolo não aparece em `src/index.ts` nem em exports públicos, e `test/unit/package.test.ts` continua passando sem alteração. Typecheck passa.

**Arquivos:** `src/utils/internal/session.ts`.

### T-05 — Validação antecipada das senhas extras

**Cobre:** RF-09

**Depende de:** T-02, T-03

**Aceite:** helper `assertExtraUnsealPasswords(config)` é chamado em `getSession` logo após `const sessionName`, antes de qualquer mutação de `context.sessions`. Regras: cada item é `string` com pelo menos `minPasswordlength` caracteres (lido de `{ ...sealDefaults, ...config.seal }.encryption.minPasswordlength`); item igual a `password` ou repetido é rejeitado. O erro é um `Error` com mensagem fixa, que não identifica a senha. Os casos "extra curta", "extra igual a password" e "extra repetida" da T-03 passam. Os testes existentes continuam passando.

**Arquivos:** `src/utils/session.ts`.

### T-06 — Tentativa de unseal sobre as senhas configuradas

**Cobre:** RF-03, RF-04, RF-06, RF-07

**Depende de:** T-02, T-03

**Aceite:** `unsealSession` percorre `unsealPasswords(config)` (`[password, ...extras]`), na ordem, e para na primeira que abre. O corpo atual de tentativa com uma senha vai para `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`, que mantém o fallback de 1 iteração por senha (D-02). Só `"Bad hmac value"` passa para a próxima senha; `"Expired seal"` e outros erros não tentam as demais. Se nenhuma abrir, relança o último erro, que `getSession` continua engolindo, sem mensagem nova (D-07). A assinatura pública de `unsealSession` não muda. Os casos de RF-03, RF-04, RF-06 e RF-07 da T-03 passam; os testes existentes continuam passando.

**Arquivos:** `src/utils/session.ts`.

### T-07 — Resselagem de sessões abertas com senha extra

**Cobre:** RF-02, RF-05

**Depende de:** T-04, T-06

**Aceite:** em `getSession`, a condição de reseal (hoje `legacySeal || shouldSlide(...)`, dentro de `sessionFromCookie`) ganha o gatilho "sessão aberta com senha extra" lido do marcador `kExtraUnseal`. O marcador é apagado antes de `Object.assign`, junto de `kLegacySeal`, e não vaza para o objeto de sessão. Sessões de header não são resseladas. Os casos de resselagem, legado com extra e header da T-03 passam, e o cookie emitido só abre com `password` (RF-02, RF-05).

Pendente: confirmação do usuário sobre o gatilho adicional (D-03, divergência do RF-05 literal). Sem a confirmação, esta tarefa não deve ser concluída.

**Arquivos:** `src/utils/session.ts`.

### T-08 — Marcar sessão aberta por extra no unseal

**Cobre:** RF-05

**Depende de:** T-04, T-06

**Aceite:** dentro de `unsealSession`, quando a senha que abriu o cookie tem índice maior que zero, o objeto retornado recebe `[kExtraUnseal] = true`. Quando abre com `password` (índice zero), o marcador não é definido. Verificado pelos testes de resselagem da T-03 e por leitura do código.

**Arquivos:** `src/utils/session.ts`.

### T-09 — Verificação final e documentação

**Cobre:** RF-01, RF-08, RF-10

**Depende de:** T-05, T-07, T-08

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa inteiro, com todos os testes novos e existentes, e o total de testes existentes é igual ao da T-01.
- `pnpm test` (lint, typecheck e coverage) passa.
- `pnpm build` e `pnpm vitest run test/unit/` passam (lista de exports inalterada).
- Diff de `src/index.ts` vazio; `src/utils/internal/iron-crypto.ts` sem alteração.
- Resultado registrado no resumo final da entrega.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`, `docs/2.utils/4.security.md` (gerado pelo automd, se o JSDoc mudou).
