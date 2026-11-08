# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-09). Seguem o fluxo do AGENTS.md: testes primeiro (devem falhar), depois a implementação mínima, depois a regressão.

## Mapa de cobertura

| Requisito | Tarefas                |
| --------- | ---------------------- |
| RF-01     | T-01, T-03, T-06       |
| RF-02     | T-02, T-05, T-06       |
| RF-03     | T-02, T-05, T-06       |
| RF-04     | T-01, T-03, T-04       |
| RF-05     | T-02, T-05, T-06       |
| RF-06     | T-02, T-05, T-06       |
| RF-07     | T-02, T-05, T-06       |
| RF-08     | T-02, T-05, T-06       |
| RF-09     | T-02, T-06, T-08       |
| RF-10     | T-01, T-02, T-07, T-08 |

---

### T-01 — Testes unitários e de tipos para `HTTPError` e `H3Config`

Escrever `test/unit/error.test.ts`: `type`/`instance` lidos do input; `undefined` quando ausentes; herdados de `cause`; valor não string vira `undefined`; `toJSON()` não ganha as chaves `type`/`instance`. Acrescentar em `test/unit/types.test-d.ts` casos para `H3Config.problemDetails` e `ErrorInput.type`/`instance`. Confirmar que os testes falham antes da implementação.

Cobre: RF-01, RF-04, RF-10
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/error.test.ts` falha (propriedades inexistentes) antes de T-03/T-04 e passa depois; `pnpm typecheck` valida os casos de tipo após T-03/T-04.
Arquivos: `test/unit/error.test.ts` (novo), `test/unit/types.test-d.ts`

### T-02 — Testes de integração `test/problem-details.test.ts`

Criar o arquivo com `describeMatrix` (web e node), confirmando antes se `ctx.app.config` é mutável (senão, criar `new H3({...})` local, sem tocar em `_setup.ts`). Casos:

- RF-01: sem a opção, `HTTPError.status(404)` dá `application/json` com `status`/`statusText` e sem `title`/`type`.
- RF-02: 403 com `statusText`/`message` dá `type: "about:blank"`, `title: "Forbidden"`, `status: 403`, `detail`; `title` cai na tabela sem `statusText`.
- RF-03: `content-type` começa com `application/problem+json`; `x-custom: 1` preservado; cabeçalhos de `event.res` mesclados.
- RF-05: `type`/`instance` informados aparecem; ausentes dão `about:blank` e sem a chave `instance`.
- RF-06: `data` e `body: { code }` preservados; `body: { type, title }` não sobrescreve os membros padrão.
- RF-07: `throw new Error("segredo interno")` sem debug dá 500, `application/problem+json`, sem o texto nem `stack`; variante com `cause` carregando `type: "interno"` que não aparece.
- RF-08: rota inexistente com `debug: true` dá 404, `title: "Not Found"` e `stack`; sem debug, sem `stack`.
- RF-09: `onError` devolvendo `Response` própria prevalece; `onError` devolvendo `HTTPError` sai em problem details.

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts` falha nos casos de problem details (e passa no de RF-01 legado) antes de T-03 a T-05; passa por completo, em `web` e `node`, depois de T-05.
Arquivos: `test/problem-details.test.ts` (novo)

### T-03 — Opção `problemDetails` em `H3Config`

Inserir `problemDetails?: boolean` com JSDoc após `debug` na interface `H3Config`, conforme techspec 3.1. Sem normalização (D-09) e sem novo export.

Cobre: RF-01
Depende de: T-01
Aceite: `pnpm typecheck` passa e o caso de tipo de `H3Config.problemDetails` em `types.test-d.ts` compila; `H3CoreConfig` herda sem alteração.
Arquivos: `src/types/h3.ts`

### T-04 — Campos `type` e `instance` em `HTTPError`

Em `ErrorBody` adicionar `type?: string` e `instance?: string`; em `HTTPError` declarar `readonly type`/`readonly instance` (`string | undefined`) e atribuí-los no construtor lendo do input e de `cause`, só aceitando `typeof === "string"` (D-06, D-08). `toJSON()` permanece inalterado (D-01).

Cobre: RF-04
Depende de: T-01
Aceite: `pnpm vitest run test/unit/error.test.ts` passa; `new HTTPError({ status: 400, type, instance })` expõe os valores e um erro sem eles dá `undefined`; `toJSON()` inalterado; `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-05 — Helper interno e renderização em `errorResponse`

1. Criar `src/utils/internal/problem-details.ts` (não exportado em `src/index.ts`) com a tabela determinística `STATUS_PHRASES` (4xx, 5xx e 1xx/2xx/3xx comuns) e `problemDetailsBody(error, debug)`, seguindo D-04, D-05 e D-06: extensões primeiro, membros padrão por último, `detail` e `data` vindos de `toJSON()`, `unhandled` com `about:blank`, frase padrão e sem `instance`, `stack` só em debug.
2. Em `src/response.ts`: importar o helper, adicionar `problemHeaders` (`application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`, trocar a assinatura para `errorResponse(error, config, errHeaders)` e atualizar a chamada em `prepareResponse`. O ramo legado deve produzir exatamente o corpo e os cabeçalhos de hoje.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
Depende de: T-03, T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa em `web` e `node`; `src/utils/internal/problem-details.ts` tem menos de 200 linhas e `src/index.ts` não muda (`git diff` sem alterações lá).
Arquivos: `src/utils/internal/problem-details.ts` (novo), `src/response.ts`

### T-06 — Verificar compatibilidade do ramo legado e do `onError`

Rodar a suíte existente e conferir que, sem a opção, as respostas de erro são idênticas às de antes (incluindo `test/errors.test.ts`, `test/security.test.ts`, `test/json-rpc.test.ts`). Se algum teste existente quebrar, ajustá-lo preservando o que verifica; não esperado, pois `toJSON()` e o ramo legado não mudam.

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-05
Aceite: `pnpm vitest run` completo passa sem alterar arquivos de teste existentes (ou, se alterados, com justificativa registrada no commit); o teste de RF-09 (`onError` com `Response` própria) passa.
Arquivos: nenhum (verificação); eventualmente `test/errors.test.ts`

### T-07 — Documentação

- `docs/1.guide/900.api/1.h3.md`: nova linha `problemDetails` em "Supported options", com nota sobre `application/problem+json`.
- `docs/1.guide/1.basics/6.error.md`: adicionar `type` e `instance` em "HTTPError Fields" e criar a subseção "Problem Details (RFC 9457)" antes de "Unhandled Errors", com exemplo de config e de corpo, regra de precedência (membros padrão vencem `body`) e nota de que erros `unhandled` ignoram `type`/`instance`/`statusText`.

Cobre: RF-10
Depende de: T-05
Aceite: as duas páginas descrevem a opção e os campos novos com exemplo; `pnpm lint` (oxfmt) não reporta problemas nos arquivos de docs.
Arquivos: `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/1.basics/6.error.md`

### T-08 — Validação final

Rodar `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` (e `pnpm fmt` se o lint apontar formatação) e conferir que existe ao menos um teste por requisito RF-01 a RF-09 usando o mapa de cobertura acima.

Cobre: RF-09, RF-10
Depende de: T-06, T-07
Aceite: os três comandos terminam sem erro e `git status` mostra apenas os arquivos listados nas tarefas T-01 a T-07 (mais `sdd/`).
Arquivos: nenhum (verificação)
