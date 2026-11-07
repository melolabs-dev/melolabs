# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-10).

Ordem sugerida: T-01 (testes que falham) → T-02 e T-03 → T-04 → T-05 → T-06. Segue o fluxo de correção do AGENTS.md: testes antes, confirmar que falham, implementar, rodar a suíte completa.

### T-01 — Escrever os testes de problem details (devem falhar antes da implementação)

Criar `test/problem-details.test.ts` com `describeMatrix` (modos web e node). Ligar a opção por `t.app.config.problemDetails = true` e, onde `stack` não deve aparecer, `t.app.config.debug = false`. Usar `{ allowUnhandledErrors: true }` nos testes de erro não tratado. Casos:

- RF-01: sem a opção e com `false`, 404 mantém `application/json` e corpo com `status`, `statusText`, `message`, sem `title`/`type`/`detail`.
- RF-02: `type`/`instance` lidos na instância; ausentes → `undefined`; `toJSON()` não os contém; `HTTPError.status(400, undefined, { type })` preserva `type`; `type` em `cause` não é promovido.
- RF-03: erro lançado com `statusText`, `message`, `type`, `instance` → 404, `application/problem+json` e os cinco membros; também erro retornado (`return new HTTPError`) e rota inexistente (`kNotFound`, sem comparar o `detail` completo por causa da URL).
- RF-04: `HTTPError.status(404)` → `type: "about:blank"`, `status: 404`, `title` não vazio, sem `instance` e sem `detail`; status fora da tabela (ex.: 499) com `title` não vazio.
- RF-05: `body: { codigo: "E42", status: 999 }` + `data: { campo: "nome" }` → `codigo` no topo, `data` sob a chave, `status` real; `body: { title: "x" }` não sobrescreve `title`.
- RF-06: `throw new Error("segredo interno")` com `debug` off → 500, problem+json, corpo sem o texto e sem `stack`; `type`/`instance`/`data` do input de um erro `unhandled` não vazam.
- RF-07: `headers: { "x-id": "1" }` → `x-id` e `Content-Type` problem+json; cabeçalhos de `event.res`/`set-cookie` mesclados sem duplicar (com `onError`); com `debug` ligado, `stack` presente.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/problem-details.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts` roda e os testes de RF-02 a RF-07 falham (RF-01 pode passar); registrar a falha antes de seguir para T-02.

### T-02 — Adicionar a opção `problemDetails` em `H3Config`

Acrescentar `problemDetails?: boolean` com JSDoc ("When enabled, errors are sent as RFC 9457 problem details (`application/problem+json`)") logo após `debug`. Padrão desligado; nenhuma leitura no construtor.

Cobre: RF-01
Arquivos: `src/types/h3.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa e `new H3({ problemDetails: true })` e `app.config.problemDetails = true` compilam; `src/index.ts` e o snapshot `test/unit/package.test.ts` não mudam.

### T-03 — Expor `type` e `instance` em `HTTPError`

Em `ErrorBody` adicionar `type?: string` e `instance?: string` (JSDoc citando a RFC 9457). Na classe, declarar `readonly type: string | undefined` e `readonly instance: string | undefined` após `body` e preenchê-los no construtor lendo somente de `details`, nunca de `details.cause` (D-04). `toJSON()` permanece intacto (D-02).

Cobre: RF-02, RF-08
Arquivos: `src/error.ts`
Depende de: nenhuma
Aceite: os testes de RF-02 de T-01 passam; `new HTTPError({ status: 400, type, instance })` expõe os valores, sem eles ambos são `undefined`; `toJSON()` tem o mesmo formato de antes; `test/errors.test.ts` continua passando.

### T-04 — Criar o helper interno que monta o corpo problem details

Criar `problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown>` e a tabela mínima, não exportada, de frases de razão (400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 418, 422, 429, 500, 501, 502, 503, 504, entre outros; fallback `"Client Error"`/`"Server Error"`/`"Error"`). Ordem de construção (a última chave vence): extensões de `body` → `data` sob `data` → `type`, `title`, `status`, `detail`, `instance` → `stack` com `debug`. Regras (D-05 a D-08):

- `type`: `error.type` ou `"about:blank"` (sempre `"about:blank"` se `unhandled`).
- `title`: `error.statusText`, senão a frase padrão; em `unhandled` só a frase padrão.
- `detail`: `error.message`, omitido se `unhandled` ou se igual ao message gerado pelo construtor (`"HTTPError <status> <statusText>"` ou só `statusText`).
- `instance`: omitido se ausente ou `unhandled`.
- `body` e `data` ignorados quando `unhandled`.

Não exportar nada por `src/index.ts`.

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07
Arquivos: `src/utils/internal/problem-details.ts`
Depende de: T-03
Aceite: `pnpm typecheck` passa; arquivo com menos de 200 linhas; os testes de corpo de RF-04, RF-05 e RF-06 de T-01 passam depois de T-05; snapshot de exports inalterado.

### T-05 — Ligar o formato em `errorResponse`

Em `src/response.ts`: criar `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` ao lado de `jsonHeaders`; mudar a chamada para `errorResponse(error, config, errHeaders)`; em `errorResponse`, quando `config.problemDetails` estiver ligado usar `problemHeaders` como base e `problemDetailsBody(error, config.debug)` como corpo; caso contrário manter o caminho atual (`jsonHeaders` e `{...error.toJSON(), stack}`) sem alteração. Manter a ordem de mescla base → `error.headers` → `errHeaders` e a serialização `JSON.stringify(body, undefined, config.debug ? 2 : undefined)`. Não alterar `src/handler.ts` nem `src/utils/middleware.ts` (limitação D-09).

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07
Arquivos: `src/response.ts`
Depende de: T-02, T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa por completo nos modos web e node; `test/errors.test.ts` e demais testes de erro passam sem alteração; com a opção desligada a resposta é idêntica à anterior.

### T-06 — Verificação final de compatibilidade e qualidade

Rodar a suíte completa e os checadores. Se algum teste existente falhar, ajustar apenas o que depende da mudança, sem perder o que ele verifica. Conferir que `toJSON()` e o snapshot de exports (`test/unit/package.test.ts`) não mudaram e que o `git status` mostra só os arquivos previstos.

Cobre: RF-08
Arquivos: `test/problem-details.test.ts`, `src/types/h3.ts`, `src/error.ts`, `src/response.ts`, `src/utils/internal/problem-details.ts`
Depende de: T-01, T-02, T-03, T-04, T-05
Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` terminam sem falhas; nenhuma quebra de API pública existente.

## Matriz de cobertura

| Requisito | Tarefas          |
| --------- | ---------------- |
| RF-01     | T-01, T-02, T-05 |
| RF-02     | T-01, T-03       |
| RF-03     | T-01, T-04, T-05 |
| RF-04     | T-01, T-04, T-05 |
| RF-05     | T-01, T-04, T-05 |
| RF-06     | T-01, T-04, T-05 |
| RF-07     | T-01, T-04, T-05 |
| RF-08     | T-01, T-03, T-06 |
