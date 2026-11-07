# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01…RF-11) e `sdd/techspec.md` (D-01…D-08, R-01…R-09).
Nenhum nome público novo além de `H3Config.problemDetails` e dos campos `type`/`instance` de `HTTPError`.

Antes de começar, rodar `pnpm vitest run test/errors.test.ts` para registrar a linha de base.

### T-01 — Declarar a opção `problemDetails` em `H3Config`

Cobre: RF-01

Adicionar `problemDetails?: boolean` com JSDoc (cita a RFC 9457; explica `Content-Type`, `type`/`instance` e o efeito em erros `unhandled`; desligada por padrão) logo após `silent`. Não duplicar em `H3CoreConfig` (derivado por `Omit`).

Depende de: nenhuma

Aceite: `pnpm typecheck` passa; `new H3({ problemDetails: true })` compila e `app.config.problemDetails` é `boolean | undefined`.

Arquivos: `src/types/h3.ts`

### T-02 — `HTTPError` aceita e expõe `type` e `instance`

Cobre: RF-04

Adicionar `type?: string` e `instance?: string` em `ErrorBody` (com JSDoc da RFC 9457), propriedades `readonly type`/`readonly instance` na classe e atribuição no construtor lendo só de `details` (não de `details.cause`) e só se `typeof === "string"`. `toJSON()` e `HTTPError.status()` não mudam (D-05, R-02).

Depende de: nenhuma

Aceite: `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/contas/12/saques/9" })` expõe os dois valores; sem informar, ambos são `undefined`; `toJSON()` idêntico ao atual; `pnpm vitest run test/errors.test.ts` continua passando.

Arquivos: `src/error.ts`

### T-03 — Função interna `toProblemDetails`

Cobre: RF-03, RF-05, RF-06, RF-07, RF-08

Criar `toProblemDetails(error, debug?)` (sem export público) com a tabela interna de textos de status (RFC 9110 + 418, 422, 425, 429, 451; status ausente ⇒ `title` omitido). Algoritmo (D-03/D-04):
1. `title = statusText || STATUS_TEXT[status]`; `detail = unhandled || message === title ? undefined : message`.
2. Base na ordem `type`, `title`, `status`, `detail`, `instance`.
3. Se não for `unhandled`: copiar `body` e depois `data` (sob a chave `data`), ignorando as chaves reservadas; `type`/`instance` do erro vencem os de `body`.
4. `unhandled` produz só `{ title, status }`, sem `detail`, `body`, `data`, `type` nem `instance`.
5. Se `debug && stack`: `stack` como linhas aparadas, por último (vence `body.stack`).

Depende de: T-02

Aceite: o arquivo tem menos de 200 linhas e não é exportado por `src/index.ts`; verificado pelos testes de T-07: exemplo do PRD (`title: "Not Found"`, `detail`, sem `type`/`instance`), `body.status: 200` não substitui o real, `unhandled` sem vazamento, `stack` em debug.

Arquivos: `src/utils/internal/problem.ts`

### T-04 — Ramo de problem details em `errorResponse`

Cobre: RF-01, RF-02, RF-08, RF-09, RF-10

Declarar `problemHeaders` (`application/problem+json;charset=UTF-8`, `FrozenHeaders`, `/* @__PURE__ */`) ao lado de `jsonHeaders`. Mudar `errorResponse` para `(error, config, errHeaders)`, atualizar a chamada em `prepareResponse` e, com `config.problemDetails`, usar `toProblemDetails(error, config.debug)` e `problemHeaders`. Mesclagem de `error.headers`/`errHeaders`, status, `statusText` e indentação em debug permanecem; com a opção desligada o ramo legado fica sem alteração.

Depende de: T-01, T-03

Aceite: com `problemDetails: true`, 404 por rota inexistente, erro lançado, `onError` devolvendo `HTTPError` e validação respondem `application/problem+json`; `onError` com valor próprio mantém precedência; 401 com `x-trace` mantém status e cabeçalho; sem a opção, `pnpm vitest run test/errors.test.ts` passa sem ajustes.

Arquivos: `src/response.ts`

### T-05 — Propagar a opção no middleware `onResponse`

Cobre: RF-10

Em `toResponse(rawBody, ...)` do middleware `onResponse`, passar `{ problemDetails: event.app?.config.problemDetails }` (D-07). Não passar a config completa, para não reexecutar `onError`/`onResponse`. `src/handler.ts` não muda (limitação R-05).

Depende de: T-04

Aceite: app com `problemDetails: true` e middleware `onResponse` que recebe `kNotFound` responde 404 em `application/problem+json`; sem a opção, comportamento idêntico ao atual.

Arquivos: `src/utils/middleware.ts`

### T-06 — Documentar a opção

Cobre: RF-01

Adicionar `problemDetails` à lista de opções de `H3`, depois de `silent`, com descrição curta (RFC 9457, `application/problem+json`, desligada por padrão, `type`/`instance` em `HTTPError`) e a limitação de `handler.fetch` sem app.

Depende de: T-01

Aceite: a linha aparece na lista de opções, no mesmo estilo das vizinhas; `pnpm lint` passa (formatação).

Arquivos: `docs/1.guide/900.api/1.h3.md`

### T-07 — Testes de integração em `describeMatrix`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10

Criar o arquivo com um teste por linha da tabela da techspec §5, ligando `t.app.config.problemDetails = true` (e `debug = false` nos de RF-07):
- RF-01: opção ausente/`false` mantém corpo e content-type legados.
- RF-02: `HTTPError.status(404)`.
- RF-03: exemplo do PRD; `detail` omitido quando `message === title`; `title` padrão sem `statusText`; comportamento de R-03 documentado.
- RF-04: `error.type`/`error.instance` e `undefined` por padrão.
- RF-05: valores no corpo; campo do erro vence `body.type`.
- RF-06: extensões de `body`, `data` sob `data`, `body.status: 200` não vence.
- RF-07: `Error("segredo interno")` sem vazamento, sem `stack`, sem `detail`; `type` de erro de terceiro não vaza.
- RF-08: `stack` como array e corpo indentado.
- RF-09: 401 + `x-trace`, `statusText`, cabeçalhos de `event.res`.
- RF-10: rota inexistente, erro em middleware, `readValidatedBody`, `onError` com valor próprio, `onError` devolvendo `HTTPError`, middleware `onResponse`, `HEAD` sem corpo.

Depende de: T-04, T-05

Aceite: `pnpm vitest run test/problem-details.test.ts` passa em `web` e `node`; comentando `problemDetails: true` os testes de formato novo falham (verificação manual única, depois restaurar).

Arquivos: `test/problem-details.test.ts`

### T-08 — Testes de tipo

Cobre: RF-11

Adicionar ao fim do `describe("types", ...)`: `ErrorInput` aceita `type?: string` e `instance?: string` e rejeita `type: 1`; `H3Config["problemDetails"]` é `boolean | undefined`; `HTTPError#type` e `#instance` são `string | undefined`.

Depende de: T-01, T-02

Aceite: `pnpm typecheck` e `pnpm vitest run test/unit` passam; `type: 1` é coberto por `@ts-expect-error` ou `expectTypeOf`.

Arquivos: `test/unit/types.test-d.ts`

### T-09 — Verificação final e regressão

Cobre: RF-11

Rodar `pnpm lint`, `pnpm typecheck` e `pnpm test`; se houver build, `pnpm vitest run test/unit/package.test.ts test/dist.test.ts` para confirmar que nenhum export mudou. Conferir que nenhum teste existente foi alterado e que `git status` só lista os arquivos das tarefas anteriores (mais `sdd/`).

Depende de: T-05, T-06, T-07, T-08

Aceite: os três comandos passam sem erros; nenhum arquivo fora da lista das tarefas foi modificado (`src/index.ts`, `src/handler.ts`, JSON-RPC e WebSocket intactos).

Arquivos: nenhum (somente verificação)

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-04, T-06, T-07 |
| RF-02 | T-04, T-07 |
| RF-03 | T-03, T-07 |
| RF-04 | T-02, T-07 |
| RF-05 | T-03, T-07 |
| RF-06 | T-03, T-07 |
| RF-07 | T-03, T-07 |
| RF-08 | T-03, T-04, T-07 |
| RF-09 | T-04, T-07 |
| RF-10 | T-04, T-05, T-07 |
| RF-11 | T-07, T-08, T-09 |
