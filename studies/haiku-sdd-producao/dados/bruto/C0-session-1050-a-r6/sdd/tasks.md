# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08). Ordem pensada para o fluxo do AGENTS.md: testes primeiro (devem falhar), implementação mínima, testes passando, suíte completa. Toda a mudança de produção fica em `src/utils/session.ts`.

## Cobertura de requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04 |
| RF-02 | T-02, T-04 |
| RF-03 | T-03, T-05 |
| RF-04 | T-03, T-05 |
| RF-05 | T-03, T-06 |
| RF-06 | T-01, T-02, T-04, T-05, T-08 |
| RF-07 | T-02, T-04, T-06 |
| RF-08 | T-03, T-05 |
| RF-09 | T-01, T-02, T-03, T-07, T-08 |

### T-01 — Ajustar os testes existentes ao novo tipo de `password`

Cobre: RF-06, RF-09
Arquivos:
- `test/session.test.ts`

Depende de: nenhuma

Extrair `const password = "1234567123456712345671234567123456712345671234567"` antes de `sessionConfig` (`test/session.test.ts:21`) e usá-la em `sessionConfig` e nas chamadas de `seal`/`unseal` que hoje recebem `sessionConfig.password` como `RawPassword` (`:137`, `:157`, `:164`). Nenhuma asserção muda; nada que os testes verificam pode ser perdido.

Aceite: `pnpm vitest run test/session.test.ts` passa com o código ainda inalterado, com o mesmo número de testes de antes; depois da T-04, `pnpm typecheck` continua passando com esses arquivos.

### T-02 — Escrever os testes novos de tipo, selo, compatibilidade e lista inválida

Cobre: RF-01, RF-02, RF-06, RF-07, RF-09
Arquivos:
- `test/session.test.ts`

Depende de: T-01

Em `describeMatrix`, com um auxiliar local `sealWith(password, { iterations? })` baseado em `seal` e `sealDefaults`:
- RF-01: com `password: [nova, antiga]` e com string, `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` executam sem erro.
- RF-02: sessão criada com `[nova, antiga]`; o cookie abre com `unseal(…, nova, sealDefaults)` e falha com `antiga` (`Bad hmac value`).
- RF-06: selo gerado com `string` abre com `[string]` e vice-versa.
- RF-07: `password: []` e `password: [nova, ""]` lançam `Empty password` em `sealSession`, `unsealSession`, `useSession` e `getSession`, mesmo com cookie válido na requisição; nenhuma sessão criada ou aceita. `password: ""` (string) mantém o comportamento atual.

Aceite: antes da T-04, `pnpm vitest run test/session.test.ts` mostra os testes novos desta tarefa **falhando** (confirmar e registrar), e os testes antigos passando; os testes rodam nos alvos `web` e `node`.

### T-03 — Escrever os testes novos de abertura, reseal, legado e erros

Cobre: RF-03, RF-04, RF-05, RF-08, RF-09
Arquivos:
- `test/session.test.ts`

Depende de: T-01

Em `describeMatrix`:
- RF-03: selo com `antiga`, config `[nova, antiga]` → mesmo `id` e dados, sem `id` novo. Variante com `maxAge` mostrando que a expiração vale depois do unseal (`vi.useFakeTimers({ toFake: ["Date"] })`).
- RF-04: selo com `removida` → `id` novo, dados vazios, `t.errors` vazio; `unsealSession` direto rejeita com `Bad hmac value`, igual ao erro da primeira senha sozinha.
- RF-05: cookie selado com `antiga`, config `[nova, antiga]` → exatamente um `Set-Cookie` que abre com `nova` sozinha, `id`/dados iguais. Header `x-h3-test-session` com `antiga`: sem `Set-Cookie`. Cookie selado com `nova`: sem `Set-Cookie`.
- RF-08: selo de 1 iteração com `antiga` → sessão recuperada e re-selada com `nova` e iterações atuais (`unseal(resealed, nova, sealDefaults)`); com `legacySealFallback: false` → rejeitado (`id` novo); selo legado com a senha primária continua funcionando.
- D-05: selo com expiração vencida e `[nova, antiga]` → erro de expiração, não `Bad hmac value`, e sem tentar a segunda senha (via `unsealSession` direto com `seal.ttl` curto ou `vi.spyOn` em `unseal`).

Aceite: antes da T-05/T-06, `pnpm vitest run test/session.test.ts` mostra os testes novos desta tarefa que dependem da mudança **falhando** (confirmar e registrar); os casos que já passam por comportamento atual (por exemplo, sem `Set-Cookie` com selo na senha primária) são anotados como tal.

### T-04 — Ampliar o tipo de `password`, normalizar a lista e selar com a primeira senha

Cobre: RF-01, RF-02, RF-06, RF-07
Arquivos:
- `src/utils/session.ts`

Depende de: T-02

- Alterar `SessionConfig.password` (`src/utils/session.ts:40-48`) para `string | string[]` e reescrever a doc: a primeira sela, todas abrem na ordem, lista não vazia, mínimo de 32 caracteres cada, lista curta, remover a senha antiga depois do reseal (D-02).
- Criar `normalizePasswords(password: string | string[]): string[]` privada, no fim do arquivo: `string` → `[password]` sem validar; lista vazia ou com elemento falsy → `new Error("Empty password")`; senão devolve a própria lista, sem copiar nem alterar (D-01, R-08).
- Em `sealSession` (`:300`), selar com `normalizePasswords(config.password)[0]` (D-03).
- Não criar nome público; `src/index.ts` e `iron-crypto.ts` ficam intactos.

Aceite: `pnpm typecheck` passa; os testes da T-02 passam em `web` e `node`; `pnpm vitest run test/session.test.ts` não regride; `git diff --stat` mostra só `src/utils/session.ts` e testes.

### T-05 — Abrir sessões percorrendo a lista, com fallback legado por senha

Cobre: RF-03, RF-04, RF-06, RF-08
Arquivos:
- `src/utils/session.ts`

Depende de: T-04

- Extrair o `try/catch` atual de `unsealSession` (`:322-348`) para `unsealWithPassword(sealed, password, config, sealOptions)`, privada, mantendo exatamente a lógica atual: `unseal`, fallback legado (`legacySealFallback === false`, `iterations === 1`, só para `Bad hmac value`) e marca `kLegacySeal`.
- Em `unsealSession`, iterar `normalizePasswords(config.password)` em ordem, com `found` separado (o unseal pode devolver `null`). Só `Bad hmac value` avança para a próxima senha; qualquer outro erro é propagado na hora. Se nenhuma abrir, lançar o erro da primeira senha (D-04, D-05).
- Se abriu com senha de índice > 0, marcar o resultado com `kLegacySeal` (comentário dizendo que vale para "selo legado ou senha secundária").
- `maxAge` e `idleTimeout` continuam depois do laço, sem alteração.

Aceite: testes de RF-03, RF-04, RF-08 e D-05 da T-03 passam em `web` e `node`; com uma senha só, todos os testes antigos passam sem mudança; `unsealSession` com nenhuma senha válida rejeita com `Bad hmac value`.

### T-06 — Validar em `getSession` e re-selar sessões abertas com senha secundária

Cobre: RF-05, RF-07
Arquivos:
- `src/utils/session.ts`

Depende de: T-05

- Chamar `normalizePasswords(config.password)` no início de `getSession`, antes de criar a sessão em `context.sessions` (`:153-155`/`:173`), para que `password: []` falhe de forma explícita em vez de virar sessão nova silenciosa (D-07).
- Comentar em `getSession` (`:199-202`) que `kLegacySeal` também significa "senha secundária" e reaproveitar o fluxo existente, sem tocar `src/utils/internal/session.ts`: cookie → `updateSession` sela com a primeira senha; header não re-sela (D-06).

Aceite: testes de RF-05 e RF-07 da T-03/T-02 passam em `web` e `node`: um único `Set-Cookie` que abre com `nova` sozinha, mesmos `id` e dados, nenhum `Set-Cookie` para header nem para selo na senha primária; `getSession` com `[]` lança `Empty password` e não deixa sessão em `context.sessions`.

### T-07 — Documentar a rotação de senha

Cobre: RF-09
Arquivos:
- `docs/4.examples/handle-session.md`

Depende de: T-06

- Ajustar a frase "Every option is optional except `password`" (`:143`) para dizer que `password` também aceita lista.
- Nova seção `## Rotate the Password`, antes de `## Expiration`, com: exemplo `password: [process.env.SESSION_PASSWORD_NEW, process.env.SESSION_PASSWORD_OLD]`; a primeira sela e todas abrem; reseal automático de cookies e a exceção do header (com o aviso de requisições concorrentes já existente); remover a senha antiga quando o reseal acabar; manter a lista curta (custo de PBKDF2); senha comprometida deixada na lista mantém sessões forjáveis.
- Texto de changelog sugerido sobre o tipo ampliado, deixado para a descrição da PR (não há changelog manual no repositório).

Aceite: a seção existe e cobre todos os pontos acima; `pnpm lint` (inclui `oxfmt --check`) não reclama do arquivo.

### T-08 — Verificação final

Cobre: RF-06, RF-09
Arquivos:
- `sdd/tasks.md`

Depende de: T-03, T-06, T-07

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/iron-crypto.test.ts` (não deve mudar), `pnpm lint`, `pnpm typecheck` e `pnpm test`. Conferir com `git status` que só mudaram `src/utils/session.ts`, `test/session.test.ts` e `docs/4.examples/handle-session.md` (e os arquivos de `sdd/`). Opcional, a pedido da revisão: type test mínimo `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` em `test/unit/types.test-d.ts`.

Aceite: os cinco comandos terminam sem falhas; a suíte existente de sessões passa com `password: "senha"` e com `password: ["senha"]`; nenhum arquivo fora da lista acima foi alterado.
