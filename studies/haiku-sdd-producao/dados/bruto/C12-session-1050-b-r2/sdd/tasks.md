# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050)

Derivado de `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (decisões D-01 a D-07 e ordem da §8). Cada tarefa é pequena e verificável por `pnpm vitest run` nos alvos `web` e `node`, por `pnpm typecheck` ou por `git diff`. Tarefas que tocam o mesmo arquivo (`src/utils/session.ts`, `test/session-unseal-passwords.test.ts`) são sequenciais pela dependência.

### T-01 — Testes de regressão de abertura e resselagem (falhando)

**Cobre:** RF-02, RF-04, RF-11
**Depende de:** nenhuma
**Aceite:** criar `test/session-unseal-passwords.test.ts` com `describeMatrix`. Casos: (a) sessão selada com `A` e config `{ password: "B", extraUnsealPasswords: ["A"] }` restaura `id`, `createdAt` e `data` sem erro; (b) `getSession` com esse cookie devolve um único `Set-Cookie` cujo valor abre com `unseal(..., "B")`. Antes de qualquer mudança em `src/`, `pnpm vitest run test/session-unseal-passwords.test.ts` deve falhar nos dois alvos pelo motivo esperado (sessão nova em vez da restaurada). Nenhum arquivo de `src/` é alterado nesta tarefa.
**Arquivos:** `test/session-unseal-passwords.test.ts`

### T-02 — Símbolo interno `kExtraPasswordSeal`

**Cobre:** RF-04 (marcação da sessão aberta por senha extra)
**Depende de:** nenhuma
**Aceite:** `kExtraPasswordSeal` declarado em `src/utils/internal/session.ts`, logo após `kLegacySeal`, com `Symbol.for("h3.internal.session.extra-password-seal")` e o mesmo padrão de `kLegacySeal` (techspec §3). `pnpm typecheck` passa. O símbolo não é exportado por `src/index.ts`.
**Arquivos:** `src/utils/internal/session.ts`

### T-03 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:** `extraUnsealPasswords?: string[]` adicionado a `SessionConfig` logo após `password`, com a JSDoc da techspec §3: só abre e nunca sela; a sessão aberta por extra é resselada com `password` na leitura, só no cookie e não no header; remover a entrada quando a última sessão com a senha antiga expirar; manter a lista curta. Sem validação no construtor (premissa do PRD). `password` continua `string`. `pnpm typecheck` passa.
**Arquivos:** `src/utils/session.ts`

### T-04 — Teste de tipo do campo

**Cobre:** RF-01
**Depende de:** T-03
**Aceite:** em `test/unit/types.test-d.ts`, um caso aceita `extraUnsealPasswords: ["x"]` e dois casos com `// @ts-expect-error` rejeitam `"abc"` e `[1]`. `pnpm typecheck` passa, e os `@ts-expect-error` não ficam sem erro (ou seja, o arquivo está incluído pelo `tsc`).
**Arquivos:** `test/unit/types.test-d.ts`

### T-05 — Laço de senhas em `unsealSession`

**Cobre:** RF-02, RF-07, RF-08 (implementação)
**Depende de:** T-02, T-03
**Aceite:** `unsealSession` segue a techspec §3 e D-02: candidatas `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`, nessa ordem; helper `unsealWithPassword` no fim do arquivo, com o fallback legado avaliado uma vez por candidata usando a mesma condição de hoje (`allowLegacy`); qualquer falha passa à próxima candidata; se todas falham, lança o erro da primeira candidata (`firstError`). O símbolo `kExtraPasswordSeal` é marcado só quando a senha que abriu não é `config.password`. As checagens de `maxAge` e `idleTimeout` continuam depois do laço, uma única vez (D-03). Assinatura pública inalterada. `sealSession` e `iron-crypto.ts` não mudam. O caso (a) de T-01 passa nos dois alvos.
**Arquivos:** `src/utils/session.ts`

### T-06 — Ajuste de `getSession`: leitura do símbolo e resselagem

**Cobre:** RF-04, RF-09 (implementação)
**Depende de:** T-02, T-05
**Aceite:** `getSession` lê `kExtraPasswordSeal` junto com `kLegacySeal` e apaga os dois antes de `Object.assign(session, unsealed)`, de modo que o símbolo não aparece no retorno. A condição de `updateSession` passa a incluir `extraSeal`, mantendo a guarda `sessionFromCookie` (D-05, D-07). Sessões do header não geram `Set-Cookie`. O caso (b) de T-01 passa nos dois alvos. `useSession`, `updateSession` e `sealSession` não mudam.
**Arquivos:** `src/utils/session.ts`

### T-07 — Expiração com senha extra

**Cobre:** RF-06
**Depende de:** T-05
**Aceite:** teste com selo de `A` feito com `seal()` sem `ttl`, `createdAt = agora - 120s`, config `{ password: "B", extraUnsealPasswords: ["A"], maxAge: 60 }`. `unsealSession` rejeita com `Error("Session expired!")`, e `getSession` devolve sessão nova sem `data` e sem `Set-Cookie`. Passa nos dois alvos. Só se o teste falhar, ajustar a ordem em `unsealSession` conforme D-03, sem tentar outras senhas depois da expiração.
**Arquivos:** `test/session-unseal-passwords.test.ts`, `src/utils/session.ts` (somente se necessário)

### T-08 — Selar só com `password` e resselagem única

**Cobre:** RF-03, RF-04 (verificação)
**Depende de:** T-06
**Aceite:** (a) `updateSession(event, { password: "B", extraUnsealPasswords: ["A"] }, { user: "x" })` gera `Set-Cookie` que abre com `"B"` e falha com `"A"`. (b) Na leitura com o cookie de `A`, há exatamente um `Set-Cookie`, cujo valor abre com `unseal(novo, "B", sealDefaults)` e não abre com `{ password: "B" }` sem a senha correta. Passa nos dois alvos.
**Arquivos:** `test/session-unseal-passwords.test.ts`

### T-09 — Sessão de header com senha extra

**Cobre:** RF-09
**Depende de:** T-06
**Aceite:** teste com selo de `A` enviado no header de sessão (usar o nome de header já adotado em `test/session.test.ts`), config `{ password: "B", extraUnsealPasswords: ["A"] }`. `getSession` restaura `id` e `data` e não emite nenhum `Set-Cookie`. Passa nos dois alvos.
**Arquivos:** `test/session-unseal-passwords.test.ts`

### T-10 — Senha não correspondente e fallback legado com extra

**Cobre:** RF-07, RF-08
**Depende de:** T-05
**Aceite:** (a) selo com `C` e config `{ password: "B", extraUnsealPasswords: ["A"] }`: `getSession` não lança, devolve sessão nova (`data` vazio, `id` novo), e `unsealSession` rejeita com `"Bad hmac value"`. (b) selo legado de 1 iteração com `A`: sem `legacySealFallback` a sessão é restaurada e resselada com `B`; com `legacySealFallback: false` a sessão é rejeitada (sessão nova). Passa nos dois alvos.
**Arquivos:** `test/session-unseal-passwords.test.ts`

### T-11 — Sem extras, extra inválida e ordem

**Cobre:** RF-02, RF-05
**Depende de:** T-06
**Aceite:** (a) com `extraUnsealPasswords` ausente, `undefined` ou `[]`, a leitura não emite `Set-Cookie` e o payload é o de hoje. (b) `extraUnsealPasswords: ["", "A"]` com selo de `A` restaura a sessão. (c) selo de `A2` com `["A1", "A2"]` restaura a sessão. Os três casos passam nos dois alvos. Além disso, `pnpm vitest run test/session.test.ts test/unit/iron-crypto.test.ts` passa, e `git diff -- test/session.test.ts test/unit/iron-crypto.test.ts` fica vazio.
**Arquivos:** `test/session-unseal-passwords.test.ts`

### T-12 — Exports públicos inalterados

**Cobre:** RF-10
**Depende de:** T-03, T-06
**Aceite:** `git diff -- src/index.ts test/unit/package.test.ts` fica vazio, e `pnpm vitest run test/unit/package.test.ts` passa sem alteração de snapshot. A única mudança de API pública é o campo novo em `SessionConfig`.
**Arquivos:** `src/index.ts`, `test/unit/package.test.ts` (somente verificação, sem alteração)

### T-13 — Verificação final

**Cobre:** RF-11, RF-12
**Depende de:** T-04, T-07, T-08, T-09, T-10, T-11, T-12
**Aceite:** `pnpm vitest run test/session-unseal-passwords.test.ts` passa em `web` e `node`; `pnpm lint` e `pnpm typecheck` terminam sem erro; `pnpm vitest run` (suíte completa) passa; o código novo segue `oxfmt`, ESM e imports com `.ts`. Se algo falhar, registrar a saída do comando.
**Arquivos:** nenhum (somente verificação)

---

## Mapa de cobertura

| RF | Tarefas |
|---|---|
| RF-01 | T-03, T-04 |
| RF-02 | T-01, T-05, T-11 |
| RF-03 | T-08 |
| RF-04 | T-01, T-02, T-06, T-08 |
| RF-05 | T-11 |
| RF-06 | T-07 |
| RF-07 | T-05, T-10 |
| RF-08 | T-05, T-10 |
| RF-09 | T-06, T-09 |
| RF-10 | T-12 |
| RF-11 | T-01, T-13 |
| RF-12 | T-13 |
