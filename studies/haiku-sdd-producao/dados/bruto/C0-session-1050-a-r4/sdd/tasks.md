# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Nenhum nome público novo; `iron-crypto.ts` e `src/index.ts` não mudam.

### T-01 — Tipo e JSDoc de `password`

Mudar `SessionConfig.password` para `string | string[]` e reescrever o JSDoc: uma string vale como hoje; numa lista a primeira sela e as demais só abrem; mínimo de 32 caracteres e aviso de entropia valem para cada senha; a lista deve ser curta e temporária (custo de PBKDF2 por tentativa, senha antiga vazada continua aceita) (D-07).

Cobre: RF-01
Arquivos: `src/utils/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` aceita `useSession` com `password: [A, B]`; o JSDoc descreve a rotação e os avisos; nenhum tipo mais estreito (sem tupla).

### T-02 — Símbolo interno `kStaleSeal`

Adicionar `kStaleSeal` (`Symbol.for("h3.internal.session.stale-seal")`) ao lado de `kLegacySeal`, sem exportá-lo em `src/index.ts` (D-05).

Cobre: RF-04
Arquivos: `src/utils/internal/session.ts`
Depende de: nenhuma
Aceite: o símbolo existe e é importável por `session.ts`; `pnpm vitest run test/unit/package.test.ts` continua passando (lista de exports públicos inalterada).

### T-03 — Helper `getPasswords` (normalização e validação)

Criar, no fim de `session.ts`, `getPasswords(config, options): string[]`: normaliza string para lista de um item; lança `Empty password` para `[]`, item vazio ou não string; lança `Password string too short (min N characters required)` para item abaixo de `max(encryption.minPasswordlength, integrity.minPasswordlength)`. Valida todos os itens antes de qualquer cripto (D-01, D-02).

Cobre: RF-05, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-01
Aceite: `[]`, `["a".repeat(32), ""]` e `["a".repeat(32), "curta"]` lançam erro de senha; string e `[string]` retornam lista de um item sem custo extra relevante.

### T-04 — `sealSession` sela com a primeira senha

Chamar `getPasswords` no início de `sealSession` e passar `passwords[0]` a `seal`. É o único ponto de selagem, cobrindo `updateSession`, `useSession`, legado e `idleTimeout` (D-03).

Cobre: RF-02, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: com `[A, B]` o cookie gerado abre com `A` e não abre só com `B`; `sealSession` e `useSession` com lista inválida rejeitam e não emitem `Set-Cookie`.

### T-05 — Helper `unsealWithPasswords` e novo `unsealSession`

Criar `unsealWithPasswords(sealed, passwords, options)` retornando `{ value, index }`: avança de senha só em `Error` com `message === "Bad hmac value"`, propaga qualquer outro erro de imediato e relança o primeiro `Bad hmac value` se todas falharem. Reescrever o `try/catch` de `unsealSession` para duas fases: iteração atual com todas as senhas; depois, só se todas falharam com `Bad hmac value`, `legacySealFallback !== false` e `integrity.iterations !== 1`, iteração 1 com todas. Marcar `kLegacySeal` (fase legado) e `kStaleSeal` (índice > 0 ou legado) como propriedades não enumeráveis. Manter intactas as checagens de `maxAge`/`idleTimeout` (D-04, D-05).

Cobre: RF-03, RF-05, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-02, T-03
Aceite: cookie de `B` abre com `[A, B]` e não abre com `[A, C]`; cookie corrompido (erro não HMAC) não tenta a segunda senha; `maxAge` vence cookie de `B`; cookie legado de `B` abre com fallback e é rejeitado com `legacySealFallback: false`; com uma senha o custo e os erros são os de hoje.

### T-06 — Reselagem em `getSession` para sessão de senha antiga

Ler `kStaleSeal` e apagá-lo antes do `Object.assign` (como `kLegacySeal`); ampliar a condição para `session.id && sessionFromCookie && (legacySeal || stale || shouldSlide(session, config))`, mantendo uma única chamada a `updateSession` (D-06).

Cobre: RF-04, RF-05, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-04, T-05
Aceite: cookie de `B` com `[A, B]` gera `Set-Cookie` selado com `A`, preservando `id` e `data`; cookie de `A` não gera `Set-Cookie` extra; via cabeçalho não há reselagem; cookie legado de `B` é reselado com `A`; `Object.getOwnPropertySymbols` da sessão não contém `kStaleSeal`.

### T-07 — Ajustar testes existentes ao novo tipo

Extrair `const password` (a string atual de `sessionConfig`) no escopo do `describeMatrix` e usá-la em `sessionConfig` e nas chamadas de `seal`/`unseal` que hoje usam `sessionConfig.password` (D-09). Não alterar o tipo anotado de `sessionConfig` nem o que os testes verificam.

Cobre: RF-08
Arquivos: `test/session.test.ts`
Depende de: T-01
Aceite: `pnpm typecheck` passa e `pnpm vitest run test/session.test.ts` passa como antes da mudança.

### T-08 — Testes novos de rotação de senha

Adicionar `describe("password rotation")` em `test/session.test.ts` com três senhas distintas de 32+ caracteres, fabricando cookies com `seal` de `iron-crypto.ts`: selagem com a primeira (RF-02); unseal com senha antiga e sessão nova com `[A, C]` (RF-03); reselagem por cookie e ausência por cabeçalho e por cookie de `A` (RF-04); string versus `[string]` com resultados iguais (RF-05); `[]`, `[A, ""]`, `[A, "curta"]` em `useSession` e `sealSession` (RF-06); `maxAge`, legado com reselagem e `legacySealFallback: false` (RF-07); cookie corrompido sem erro mascarado; símbolo não vaza. Usar `vi.useFakeTimers({ toFake: ["Date"] })` onde houver tempo. Verificar por mutação que remover o laço de senhas ou o `kStaleSeal` faz algum teste falhar. Opcional: teste de tipo `SessionConfig["password"]` em `test/unit/types.test-d.ts`.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts`
Depende de: T-06, T-07
Aceite: `pnpm vitest run test/session.test.ts` passa em `web` e `node`; os testes novos falham ao remover o laço de senhas em `unsealSession` ou o `kStaleSeal`.

### T-09 — Documentação com exemplo de rotação

Adicionar a subseção "Rotate the password" após Options, com exemplo `password: [nova, antiga]`, ordem (nova primeiro), reselagem automática do cookie, aviso de lista curta/temporária e custo de CPU. Conferir `docs/2.utils/4.security.md` e ajustar só se o texto de `sealSession`/`unsealSession` citar a senha.

Cobre: RF-08
Arquivos: `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`
Depende de: T-06
Aceite: a subseção existe com o exemplo e os avisos; `pnpm lint` (oxfmt) passa nos arquivos de docs tocados.

### T-10 — Verificação final

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck` e, se couber, `pnpm test`. Confirmar que `src/index.ts`, `iron-crypto.ts`, `src/types/context.ts` e `src/utils/auth.ts` não mudaram.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: nenhum (só verificação)
Depende de: T-08, T-09
Aceite: todos os comandos passam; `git diff --stat` não lista os arquivos proibidos.
