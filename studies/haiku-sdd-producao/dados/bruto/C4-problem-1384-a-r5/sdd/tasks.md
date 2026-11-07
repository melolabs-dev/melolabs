# Tasks: Problem Details (RFC 9457) em erros do h3, ativado por opção

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, seção 3 para arquivos e seção 5 para testes).

Ordem de execução: T-01 e T-02 podem começar em paralelo. Os testes de cada tarefa devem falhar antes da implementação (fluxo de `AGENTS.md`, "Bug Fix Workflow", aplicado também a funcionalidade nova).

Pendências da techspec (seção 7) assumidas como estão na recomendação: `Content-Type` `application/problem+json` sem charset (D-04), `detail` de erro não tratado = `"HTTPError"` (D-06) e `title` omitido sem `statusText` (D-03). Se o time mudar alguma delas, só a tarefa correspondente muda.

### T-01 — Opção `problemDetails` em `H3Config`

Cobre: RF-01

Depende de: nenhuma

Aceite: `app.config.problemDetails` é `undefined` em `new H3()` e `true` em `new H3({ problemDetails: true })`. O campo tem JSDoc descrevendo o formato RFC 9457 e o padrão desligado. `H3CoreConfig` herda o campo sem alteração. `pnpm lint` e `pnpm typecheck` passam.

Arquivos: `src/types/h3.ts`

### T-02 — `HTTPError` aceita e expõe `type` e `instance`

Cobre: RF-04

Depende de: nenhuma

Aceite: `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` expõe `error.type` e `error.instance` com esses valores. Sem os campos, ambos são `undefined`. Ambos são lidos de `details` com fallback para `details.cause`, como `status` e `statusText`. `ErrorInput` aceita os dois campos e `ErrorBody` não muda. `HTTPError#toJSON` continua idêntico (ver T-05).

Arquivos: `src/error.ts`

### T-03 — Módulo `toProblemDetails` com mapeamento RFC e mascaramento de erros não tratados

Cobre: RF-03, RF-05, RF-06

Depende de: T-02

Aceite: `toProblemDetails(error, debug)` devolve, para erro comum, `type` (ou `"about:blank"`), `title` (de `statusText`, omitido se ausente), `status`, `detail` (de `message`), `instance` (omitido se ausente), `data` e `body` como extensões, e `stack` só com `debug` e se houver stack. Os campos RFC são escritos por último, então `body` com `status` ou `title` não os altera. Para `error.unhandled`, o resultado tem `type: "about:blank"`, `detail: "HTTPError"`, sem `instance`, `data`, `body` nem `message`. Um erro comum com propriedade `type` externa não vaza para o corpo quando é `unhandled`. Arquivo novo, sem exportar `ProblemDetails` pelo `src/index.ts`.

Arquivos: `src/utils/internal/problem.ts`

### T-04 — `errorResponse` ramifica para problem details

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07

Depende de: T-01, T-03

Aceite: `errorResponse` recebe `config: H3Config` no lugar de `debug` e chama `problemDetailsResponse` só quando `config.problemDetails` é verdadeiro. A resposta usa `Content-Type: application/problem+json` (constante `problemJsonHeaders` ao lado de `jsonHeaders`). Os cabeçalhos de `error.headers` e `errHeaders` continuam aparecendo. A serialização roda dentro do mesmo `try` de `toResponse`, então corpo circular gera 500 sem exceção. Com a opção desligada, o caminho atual roda sem alteração. A chamada em `prepareResponse` passa `config`. `src/h3.ts` já passa `this.config` e não muda. `pnpm vitest run test/errors.test.ts` continua passando sem alteração nos testes.

Arquivos: `src/response.ts`

### T-05 — Formato padrão preservado e regressão de `toJSON`

Cobre: RF-02

Depende de: T-02

Aceite: `HTTPError.prototype.toJSON` não muda (`src/error.ts`, sem alteração de código nessa função). Um teste novo em `test/errors.test.ts` confirma que `new HTTPError({ status: 400, type: "x", instance: "/y" }).toJSON()` não contém `type` nem `instance`. Os testes existentes de `test/errors.test.ts` passam sem alteração. Com a opção ausente, `404` mantém `Content-Type: application/json;charset=UTF-8` e o corpo atual.

Arquivos: `test/errors.test.ts`

### T-06 — Testes de comportamento nos dois runtimes

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Depende de: T-04

Aceite: `test/problem-details.test.ts` usa `describeMatrix` e roda em `web` e `node`. Cobre os casos da techspec, seção 5: opção ausente (formato antigo), opção ligada com `404` e `Usuário não encontrado`, `data` e `body` como extensões com `body: { status: 200, title: "x" }` sem efeito nos campos RFC, `instance` e `type` no `HTTPError`, erro `new Error("segredo do banco")` com status `500` e sem o texto no corpo, erro com propriedade `type: "x"` virando `"about:blank"`, `debug: true` com `stack` em array, `onError` chamado uma vez com `Retry-After: 120` na resposta, `onResponse` chamado uma vez, `data` circular sem vazar exceção, e `HEAD` com corpo vazio. Os casos sem `debug` definem `t.app.config.debug = false` explicitamente. `pnpm vitest run test/problem-details.test.ts` passa nos dois alvos.

Arquivos: `test/problem-details.test.ts`

### T-07 — Testes de tipo

Cobre: RF-01, RF-04

Depende de: T-01, T-02

Aceite: em `test/unit/types.test-d.ts`, `new HTTPError({ status: 400, type: "x" }).type` tem tipo `string | undefined`. `ErrorInput` aceita `type` e `instance` como `string`. `H3Config` aceita `problemDetails: boolean`. `ErrorBody` não tem `type` nem `instance` (`@ts-expect-error` ao acessar `ErrorBody["type"]`). `pnpm typecheck` passa.

Arquivos: `test/unit/types.test-d.ts`

### T-08 — Documentação da opção

Cobre: RF-01

Depende de: T-01

Aceite: `docs/1.guide/900.api/1.h3.md` tem uma linha `problemDetails` na lista "Supported options", ao lado de `allowMalformedURL`, descrevendo o formato RFC 9457, o `Content-Type` `application/problem+json` e o padrão desligado. `CHANGELOG.md` não muda, pois é gerado pelo `changelogen`.

Arquivos: `docs/1.guide/900.api/1.h3.md`

### T-09 — Verificação final da suíte e de lint

Cobre: RF-08

Depende de: T-05, T-06, T-07, T-08

Aceite: `pnpm vitest run` passa com todos os casos de RF-01 a RF-07 nos dois alvos. `pnpm lint` e `pnpm typecheck` passam sem erros. `pnpm test` passa com cobertura. Se `pnpm bench:node` for rodado para medir R-07, o resultado vai junto com a entrega.

Arquivos: nenhum arquivo novo; roda os comandos sobre os arquivos das tarefas anteriores.
