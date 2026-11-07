# Tarefas — `problem()` (RFC 9457 Problem Details)

Origem: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-07, R-01 a R-07).
Ordem segue o fluxo do AGENTS.md: escrever os testes, vê-los falhar, implementar, vê-los passar, rodar a suíte completa.

### T-01 — Escrever os testes novos de `problem()` (devem falhar)

Criar `test/problem.test.ts` com `describeMatrix` (modos web e node), no padrão de `test/errors.test.ts`:

- RF-01: `problem({ status: 404 })` é `HTTPError` (`HTTPError.isError`) com `status` 404.
- RF-02: `throw problem({ status: 400 })` → status 400 e `content-type` começando com `application/problem+json`.
- RF-03: caso 422 completo (`statusText`, `message`, `type`, `instance`); `toEqual` no corpo e ausência de `statusText`/`message`/`unhandled`.
- RF-04: só `status: 404` → `type: "about:blank"`, `title: "Not Found"`, sem `instance` e sem `detail`.
- RF-05: 429 com `retry-after: 30` e `body: { balance: 0 }`; `content-type` explícito do usuário prevalece; `body.type` do usuário não substitui o `type` de `problem()`; `data` no nível superior.
- RF-06: `unhandled: true` com `message`/`data`/`body`/`instance` → corpo sem `"segredo"`, `data`, `stack`; com `debug` no app, `stack` aparece.
- RF-07: `new HTTPError({ status: 400, message: "ruim" })`, `HTTPError.status(...)`, erro genérico e 404 automático mantêm `application/json;charset=UTF-8` e o formato atual, sem `type`/`title`/`detail`.
- Extras: `problem()` com `onError` configurado mantém o formato; status sem entrada na tabela (ex.: 599) não gera `title` `"undefined"` (R-07); requisição `HEAD` não quebra.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` executa e os testes de `problem()` **falham** (função ainda inexistente); os testes de RF-07 já passam. Registrar a falha antes de seguir.
Arquivos: `test/problem.test.ts` (novo)

### T-02 — Módulo interno: símbolo, metadado e `problemBody`

Criar `src/utils/internal/problem.ts` (não exportado de `src/index.ts`) com:

- `kProblem = Symbol.for("h3.internal.problem")`;
- interface `ProblemMeta` (`type`, `title?`, `detail?`, `instance?`);
- `problemBody(error, meta, debug?)`: para erros normais devolve `{ ...(data !== undefined ? { data } : {}), ...error.body, type, title, status, detail, instance, stack? }` (extensões antes dos membros padrão, para que `body.type` etc. nunca substituam os da RFC); para `unhandled` devolve só `type`, `title`, `status` (+ `stack` em debug), omitindo `detail`, `instance`, `data` e `body`. Não emite `statusText`, `message` nem `unhandled`.
- Manter o módulo pequeno e sem a tabela de títulos, pois `response.ts` o importará (D-05, R-01).

Cobre: RF-03, RF-04, RF-05, RF-06
Depende de: T-01
Aceite: `pnpm typecheck` passa; o módulo não é exportado por `src/index.ts`; `problemBody` retorna o JSON do exemplo da techspec (422 com `type`/`instance`) e, para `unhandled`, não contém `detail`/`data`/`instance` (verificado pelos testes de T-01 depois de T-03 e T-04).
Arquivos: `src/utils/internal/problem.ts` (novo)

### T-03 — `problem()`, `ProblemInput` e tabela de títulos

Criar `src/utils/problem.ts`:

- `ProblemInput<DataT> extends ErrorInput<DataT>` com `type?: string` e `instance?: string`;
- `problem(input)`: separa `type`/`instance`; monta `Headers` a partir de `rest.headers ?? rest.cause?.headers` e define `content-type: application/problem+json;charset=UTF-8` apenas se o usuário não informou `content-type`; cria `new HTTPError({ ...rest, headers })`; calcula `title = error.statusText ?? defaultTitle(error.status)` e `detail = rest.message || undefined`; grava `kProblem` com `Object.defineProperty` (não enumerável, não gravável) com `type || "about:blank"`; retorna o `HTTPError`;
- tabela interna de textos-padrão de status (4xx/5xx comuns e 2xx/3xx usuais) neste módulo; status fora da tabela ficam sem `title`;
- JSDoc avisando que `detail` (de `message`) e `instance` não devem conter dados sensíveis (R-02).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05
Depende de: T-02
Aceite: `pnpm typecheck` passa; `problem({ status: 404 })` retorna `HTTPError` com `HTTPError.isError(r) === true`, `status` 404, `headers` com `content-type` `application/problem+json`, e `Object.keys(r)` / `r.toJSON()` idênticos aos de um `HTTPError` comum (o metadado não é enumerável).
Arquivos: `src/utils/problem.ts` (novo)

### T-04 — Integrar o formato em `errorResponse` e exportar `problem`

- Em `src/response.ts`: importar `kProblem`/`problemBody` e, em `errorResponse`, escolher o corpo com `error[kProblem] ? problemBody(error, error[kProblem], debug) : error.toJSON()`. Todo o resto (merge de cabeçalhos, `stack` em debug, indentação, status) permanece inalterado; o caminho padrão fica intocado.
- Em `src/index.ts`, junto dos utilitários: `export { problem, type ProblemInput } from "./utils/problem.ts";` (import direto, sem barrel). Nenhum outro nome público novo.
- Não alterar `src/error.ts`, `src/h3.ts`, `src/rules/**` nem `src/_deprecated.ts`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/problem.test.ts` passa em web e node; `git diff src/response.ts` mostra só o import e a escolha do corpo; `git diff src/error.ts` vazio.
Arquivos: `src/response.ts`, `src/index.ts`

### T-05 — Atualizar o snapshot de exports

Em `test/unit/package.test.ts`, inserir `"problem",` entre `"parseCookies"` e `"proxy"` (ordem do `sort()`). É o único teste existente afetado; o tipo `ProblemInput` não aparece no snapshot de valores.

Cobre: RF-01, RF-08
Depende de: T-04
Aceite: `pnpm vitest run test/unit/` passa e o diff do snapshot contém apenas a linha `"problem",` (o único novo export de valor é `problem`).
Arquivos: `test/unit/package.test.ts`

### T-06 — Verificação final e regressão

Rodar a suíte completa sem editar outros testes: `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`; conferir `test/rules/treeshake.test.ts` (orçamentos de bytes, R-01) e que `test/errors.test.ts` e demais testes de erro seguem verdes sem edição. Se algum teste existente falhar, corrigir a implementação (não o teste), exceto o snapshot de T-05.

Cobre: RF-07, RF-08
Depende de: T-01, T-04, T-05
Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` terminam sem falhas; `git status` mostra apenas os arquivos listados em T-01 a T-05 (mais `sdd/`).
Arquivos: nenhum (somente verificação)
