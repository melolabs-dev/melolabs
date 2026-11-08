# Tarefas — `extraUnsealPasswords` para sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Fluxo de bug do AGENTS.md: testes primeiro (T-02), ver falharem, depois implementar (T-03 a T-06), ver passarem.

### T-01 — Campo `extraUnsealPasswords` e símbolo interno `kRotatedSeal`

Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`, logo depois de `password`, com o TSDoc do techspec (só abre, nunca sela; ordem de tentativa; entropia; lista curta; remover após migração). `password` continua `string`. Criar o símbolo interno `kRotatedSeal` ao lado de `kLegacySeal`, sem exportá-lo em `src/index.ts`.

Cobre: RF-01
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa com a config `password` string mais `extraUnsealPasswords: [...]`; `password: ["x"]` continua erro de tipo; `src/index.ts` não ganha nenhum export novo.

### T-02 — Testes de integração e de tipo (escritos antes da implementação)

Em `test/session.test.ts`, dentro do `describeMatrix("session", …)`, depois de `:186`, escrever os testes do techspec seção 5 usando `seal`/`unseal` do `iron-crypto`:

- RF-02: cookie criado e atualizado com `password` P2 e extras `[P1]` abre com P2 e não abre só com P1.
- RF-03: cookie de P1 recupera `id`, `createdAt` e `data` em `getSession` e `useSession`; variantes com cookie em chunks, header de sessão e extra na 2ª posição.
- RF-04: cookie de P0, fora das listas, gera sessão nova sem erro exposto.
- RF-05: cookie de P1 gera exatamente um `Set-Cookie` que abre só com P2 e preserva `id`, `createdAt` e `data`; header de sessão não gera `Set-Cookie`.
- RF-06: sem extras e com `[]`, selo de outra senha é rejeitado; contar as chamadas de `unseal` com `vi.spyOn` (uma tentativa, duas só com fallback legado).
- RF-07: `maxAge` vencido com selo de P1 gera sessão nova; idem `idleTimeout`; `legacySealFallback: false` rejeita selo legado de P1; selo legado de P1 com fallback ligado abre e é resselado uma só vez com P2; caso combinado com `idleTimeout` e janela já usada em mais da metade, ainda um só `Set-Cookie`.
- Caso com senha vazia na lista de extras: não derruba a requisição.
- Tipo (RF-01): conferir o `include` do `tsconfig`; se cobrir `test/`, adicionar `// @ts-expect-error` com `password: ["x"]` em `test/unit/types.test-d.ts`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts`
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes de RF-02, RF-03, RF-05 e RF-07 falhando antes de T-03 a T-05 e passando depois; os de RF-04 e RF-06 passam nos dois momentos, travando o comportamento atual; há ao menos um teste por RF-02 a RF-07; testes existentes ficam inalterados.

### T-03 — Helper `unsealWithPassword` com fallback legado por senha

Extrair o bloco `try/catch` de `unsealSession` (`src/utils/session.ts:322-348`) para a função interna `unsealWithPassword(sealed, password, config, sealOptions)` no fim do arquivo. Preservar as condições do fallback (só em `"Bad hmac value"`, respeitando `legacySealFallback: false`), a marcação `kLegacySeal` e o `throw error` original. `unsealSession` passa a chamá-la com `config.password`, sem mudar o comportamento.

Cobre: RF-07, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mantém verdes todos os testes existentes, incluindo os de fallback legado; `unsealSession` continua com a mesma assinatura e faz uma só tentativa (duas com fallback).

### T-04 — Laço de tentativas em `unsealSession`

`unsealSession` monta `[config.password, ...(config.extraUnsealPasswords ?? [])]` sem repetir senhas (`undefined` e `[]` valem como ausente) e tenta cada uma, em ordem e de forma sequencial, com `unsealWithPassword`. A primeira que abrir vence; se o índice for maior que 0, marca `kRotatedSeal`. Falhas guardam o primeiro erro e continuam (inclusive `"Empty password"`). Se nenhuma abrir, relança o primeiro erro, o da `password`. As verificações de `maxAge` e `idleTimeout` (`"Session expired!"`) ficam depois do laço, sobre o resultado que abriu.

Cobre: RF-03, RF-04, RF-06, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: os testes de RF-03, RF-04, RF-06 e RF-07 (expiração e fallback legado) de T-02 passam; sessão expirada selada com extra continua expirada; sem extras há uma única tentativa; o erro de `unsealSession` chamado direto com senha desconhecida é o mesmo de hoje.

### T-05 — Reselagem automática em `getSession`

Em `getSession`, ler e remover `kRotatedSeal` junto de `kLegacySeal` antes do `Object.assign(session, unsealed)`. A condição de reselagem passa a ser `legacySeal || rotatedSeal || shouldSlide(...)`, mantendo `sessionFromCookie`, no mesmo `if` e com uma única chamada de `updateSession`. `sealSession`, `updateSession` e `useSession` não mudam (selam só com `password`).

Cobre: RF-02, RF-05, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: os testes de RF-02, RF-05 e do caso combinado de RF-07 de T-02 passam; cookie de P1 emite um só `Set-Cookie` que abre apenas com P2; sessão do header não emite `Set-Cookie`; o símbolo não aparece em `session` em memória.

### T-06 — Documentação

Criar a seção "Rotate the Password" em `docs/4.examples/handle-session.md`, depois de "Expiration" e antes de "Use Multiple Sessions": passos da rotação (nova senha em `password`, antiga em `extraUnsealPasswords`, remoção após a migração por reselagem), lista curta por custo de CPU, remover a senha comprometida, mesma entropia de `password`, e prazo natural pelo `maxAge`/`idleTimeout`. Em `docs/2.utils/4.security.md`, adicionar a `unsealSession` uma frase sobre as senhas extras.

Cobre: RF-08
Arquivos: `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`
Depende de: T-01
Aceite: a seção existe na posição indicada e cobre os pontos listados; a referência de `unsealSession` menciona `extraUnsealPasswords`; `pnpm lint` passa (formatação).

### T-07 — Verificação final

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, a suíte completa, `pnpm lint` e `pnpm typecheck`. Corrigir regressões com ajuste mínimo, sem enfraquecer testes existentes. Conferir que `src/index.ts`, `iron-crypto.ts` e `sealSession` não mudaram.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`, `src/utils/session.ts`
Depende de: T-02, T-05, T-06
Aceite: todos os comandos acima passam; `git diff --stat` lista só os arquivos previstos no techspec seção 3 (mais `test/unit/types.test-d.ts`, se usado).
