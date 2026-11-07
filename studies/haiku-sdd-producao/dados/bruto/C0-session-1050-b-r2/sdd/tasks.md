# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md`. Seguem o fluxo do AGENTS.md: testes de regressão primeiro, confirmados como falhando, depois a implementação mínima.

### T-01 — Adicionar `extraUnsealPasswords` ao tipo `SessionConfig`

Cobre: RF-01
Depende de: nenhuma

Inserir `extraUnsealPasswords?: string[]` em `SessionConfig`, logo após `password`, com JSDoc (D-01 e seção 4 da techspec): só abre sessões, ordem de tentativa, lista curta por custo de PBKDF2, reselagem apenas para sessões vindas de cookie, remover após a migração, mesma exigência de 32+ caracteres. `password` permanece `string`. Nenhum export novo.

Aceite: `pnpm typecheck` passa com uma config contendo `password` e `extraUnsealPasswords: ["antiga"]`; `pnpm vitest run test/unit/package.test.ts` continua passando (nenhum export público novo).

Arquivos:
- `src/utils/session.ts`

### T-02 — Testes: tipo e selagem somente com `password`

Cobre: RF-01, RF-02, RF-08
Depende de: T-01

Em `test/session.test.ts`, dentro do `describeMatrix("session", ...)`, adicionar as constantes `OLD` e `NEW` (≥ 32 caracteres) e uma rota própria com `{ ...sessionConfig, password: NEW, extraUnsealPasswords: [OLD] }`. Testes: (a) tipo — `extraUnsealPasswords: ["x"]` compila e `password: ["x"]` leva `// @ts-expect-error`; (b) o `Set-Cookie` de uma sessão selada abre com `NEW` via `unseal` e falha com `OLD`.

Aceite: `pnpm typecheck` passa; `pnpm vitest run test/session.test.ts` executa os novos testes em web e node (RF-02 passa já agora, por construção).

Arquivos:
- `test/session.test.ts`

### T-03 — Testes: abertura com senhas extras e rejeição

Cobre: RF-03, RF-04, RF-08
Depende de: T-02

Adicionar testes em `test/session.test.ts`: (a) cookie selado com `OLD` recupera `id` e `data` originais; (b) com `extraUnsealPasswords: [A, B]`, selo feito com `B` abre; (c) cookie selado com senha desconhecida gera novo `id`, `data` `{}`, status 200 e nenhum erro propagado; (d) sessão expirada (`maxAge` com timers `Date` falsos) selada com `OLD` é descartada e substituída por uma nova, sem ser mascarada pela tentativa de outras senhas.

Aceite: `pnpm vitest run test/session.test.ts` — os testes (a) e (b) falham antes da implementação (sessão nova em vez da original); (c) e (d) descrevem o comportamento a ser preservado.

Arquivos:
- `test/session.test.ts`

### T-04 — Testes: reselagem, header, legado e compatibilidade

Cobre: RF-05, RF-06, RF-07, RF-08
Depende de: T-02

Adicionar testes em `test/session.test.ts`: (a) sessão selada com `OLD` via cookie retorna um único `Set-Cookie`, que abre só com `NEW` e mantém o `id`; uma segunda requisição com o novo cookie não reseala; (b) sessão com `OLD` via header de sessão abre sem `Set-Cookie` de reselo; (c) selo com `OLD` e 1 iteração PBKDF2 abre e é reselado com `NEW` e as iterações atuais, e com `legacySealFallback: false` é descartado; (d) com `extraUnsealPasswords` `undefined` e `[]`, a contagem de `deriveBits` para um cookie inválido é igual à de uma config sem o campo (padrão do teste existente de contagem).

Aceite: `pnpm vitest run test/session.test.ts` — (a) e (c) falham antes da implementação; (b) e (d) passam. Confirmar e registrar quais falham.

Arquivos:
- `test/session.test.ts`

### T-05 — Implementar o laço de tentativas em `unsealSession`

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-03, T-04

Em `unsealSession`, substituir o `try/catch` único do unseal por chamada a helper interno não exportado, no fim do arquivo (D-02), com a lógica de D-03 a D-06: lista `[config.password, ...(config.extraUnsealPasswords || [])]`; fase 1 com as opções atuais em todas as senhas; fase 2 com 1 iteração em todas, sob as condições atuais (`legacySealFallback !== false`, `iterations !== 1`, último erro HMAC); só avança em `"Bad hmac value"`; marca `kLegacySeal` em sucesso com senha de índice > 0 ou na fase legada, não marcando objeto nulo; comentário no ponto da marca explicando o reuso de `kLegacySeal`. Manter intactas `sealSession`, `getSession` e as verificações de `maxAge`/`idleTimeout`.

Aceite: `pnpm vitest run test/session.test.ts` passa por completo, incluindo os testes de T-02 a T-04 e os existentes sem alteração de asserções; `git diff` mostra mudanças só em `src/utils/session.ts` e `test/session.test.ts`.

Arquivos:
- `src/utils/session.ts`

### T-06 — Verificação final e regressões

Cobre: RF-07, RF-08
Depende de: T-05

Executar `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`. Se algum teste existente falhar, ajustar apenas o necessário sem enfraquecer a asserção (techspec, seção 3). Confirmar que `package.json`, `docs/`, `iron-crypto.ts` e `src/index.ts` não foram alterados.

Aceite: os quatro comandos terminam com sucesso; `git status` lista somente `src/utils/session.ts` e `test/session.test.ts` como modificados (além dos arquivos `sdd/`).

Arquivos:
- `src/utils/session.ts`
- `test/session.test.ts`
