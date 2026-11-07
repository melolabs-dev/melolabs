# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08). Seguir o Bug Fix Workflow do AGENTS.md: os testes (T-01, T-02) são escritos antes da implementação e devem **falhar** antes das tarefas T-03 a T-06. Cada tarefa lista os arquivos que toca no rodapé.

### T-01 — Testes unitários e de tipos para `HTTPError.type`/`instance` e `H3Config.problemDetails`

Escrever os testes de `HTTPError` (valores informados; `undefined` quando ausentes; herança via `details`/`cause` com `HTTPError` ou objeto simples; `Error` estrangeiro com `type: "entity.parse.failed"` não vira `error.type`; valor não string ignorado; `toJSON()` não ganha `type`/`instance`) e as asserções de tipo (`H3Config["problemDetails"]` é `boolean | undefined`; `ErrorInput` aceita `type`/`instance`).

- Cobre: RF-04, RF-01
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/unit/` mostra os novos testes falhando (e `pnpm typecheck` apontando os campos ainda inexistentes) antes de T-03/T-04; depois delas, tudo passa.
- Arquivos: `test/unit/error.test.ts` (novo ou ajuste do existente), `test/unit/types.test-d.ts`

### T-02 — Testes de integração `test/problem-details.test.ts`

Criar o arquivo com `describeMatrix`, um `it` por critério de aceite, ligando a opção por `ctx.app.config.problemDetails = true` (e `ctx.app.config.debug = false` quando necessário), sem alterar `_setup.ts`:
RF-01 (sem opção e com `false`, 404 mantém `application/json` e `message`/`statusText`); RF-02 (`Content-Type` começa com `application/problem+json`, corpo JSON válido); RF-03 (`type: "about:blank"`, `title: "Not Found"`, `status`, `detail`, sem `message`; `statusText` customizado vira `title`; status 599 omite `title`); RF-05 (`type`/`instance` emitidos; sem `instance` a chave não existe); RF-06 (`data` e `body` como extensões; `body: { status: 200, type: "x", detail: "y" }` não sobrescreve os padrão); RF-07 (`Error("segredo interno")` → 500, corpo sem o texto nem `stack`, `data`/`body` ocultos, `type`/`instance` ignorados quando `unhandled`); RF-08 (`x-id: 1` presente, `stack` no corpo, `error.headers` com `content-type: text/plain` não vence, `set-cookie` e headers de `event.res` preservados sem duplicar, `onError` chamado uma vez); bordas: `kNotFound`, 400 de URL malformada e `HEAD` com corpo nulo.

- Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/problem-details.test.ts` falha nos casos de problem details antes de T-03 a T-06 e passa por completo (modos web e node) depois delas; os casos de RF-01 passam desde o início.
- Arquivos: `test/problem-details.test.ts`

### T-03 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` logo após `debug` em `H3Config`, com JSDoc avisando que a opção troca o contrato do corpo de erro (`message` → `detail`) e que é desligada por padrão. `H3CoreConfig` herda sem mudança.

- Cobre: RF-01, RF-09
- Depende de: nenhuma
- Aceite: `pnpm typecheck` passa e as asserções de tipo de T-01 para `H3Config` passam; sem a opção, nenhum comportamento muda.
- Arquivos: `src/types/h3.ts`

### T-04 — Campos `type` e `instance` em `ErrorInput` e `HTTPError`

Adicionar `type?: string` e `instance?: string` (com JSDoc) a `ErrorInput`; declarar `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError` (anotação explícita por `isolatedDeclarations`) e atribuí-los no construtor por helper interno não exportado no fim do arquivo (D-04): lê de `details` e depois de `cause`, ignora fonte `Error` que não seja `HTTPError` e aceita só string não vazia. Não alterar `toJSON()` nem `ErrorBody`.

- Cobre: RF-04, RF-09
- Depende de: nenhuma
- Aceite: `new HTTPError({ status: 409, type: "https://example.com/probs/conflito", instance: "/pedidos/42" })` expõe os valores; sem os campos, ambos são `undefined`; os testes de T-01 passam e `pnpm typecheck` passa.
- Arquivos: `src/error.ts`

### T-05 — Módulo interno `problemBody` e tabela de frases de status

Criar `src/utils/internal/problem.ts` (< 200 LoC, sem reexportar em `src/index.ts`) com: `kProblemContentType = "application/problem+json"`; `STATUS_PHRASES` (frases RFC 9110 dos códigos 1xx/2xx/3xx usuais e 4xx/5xx comuns, 400…451 e 500…511); e `problemBody(error, debug?)` seguindo D-06: se `!error.unhandled`, espalhar `error.body` e `data`; depois os membros padrão por cima (`type` ou `"about:blank"`, `title` = `statusText` → frase → omitido, `status`, `detail` = `error.toJSON().message`, `instance` só se definido); `unhandled`; `stack` por último só com `debug`. Para `unhandled`, `type`/`instance` não são emitidos (`about:blank`/omitido). Não emitir `message` nem `statusText` do formato legado.

- Cobre: RF-03, RF-05, RF-06, RF-07
- Depende de: T-04
- Aceite: `problemBody` de `new HTTPError("Usuário não encontrado", { status: 404 })` devolve `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail` correto e sem `message`; `body: { status: 200 }` não altera `status`; erro `unhandled` não expõe mensagem, `data`, `body`, `type` nem `instance`; `pnpm lint` passa no arquivo.
- Arquivos: `src/utils/internal/problem.ts`

### T-06 — Integrar o modo problem details em `errorResponse`

Mudar a assinatura interna para `errorResponse(error, config, errHeaders?)` e atualizar a chamada em `prepareResponse`, lendo `debug` e `problemDetails` uma vez de `config`. No ramo `config.problemDetails`, usar `problemBody` com `JSON.stringify(corpo, undefined, debug ? 2 : undefined)` e, após as duas mesclagens de cabeçalhos (`error.headers` e `errHeaders`), forçar `content-type` para `application/problem+json`. O ramo legado, `statusText`, `onError` e `HEAD` ficam como estão.

- Cobre: RF-01, RF-02, RF-07, RF-08, RF-09
- Depende de: T-03, T-05
- Aceite: `pnpm vitest run test/problem-details.test.ts` passa em web e node (inclusive `stack` com `debug`, `x-id` preservado, `content-type` não sobrescrito e `onError` uma única vez); sem a opção as respostas permanecem idênticas ao formato atual.
- Arquivos: `src/response.ts`

### T-07 — Regressão e verificação final

Rodar a suíte completa e os checks estáticos; ajustar só o estritamente necessário em testes existentes, sem enfraquecer asserções (risco: testes que comparem a forma da instância de `HTTPError`). Conferir com `git diff --stat` que `src/index.ts`, `src/h3.ts` e `src/utils/response.ts` não mudaram e que nenhuma exportação nova surgiu. Rodar `pnpm fmt` se o lint apontar formatação.

- Cobre: RF-09
- Depende de: T-01, T-02, T-03, T-04, T-05, T-06
- Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` passam; `src/index.ts` sem alteração; a única superfície pública nova é `problemDetails` e `type`/`instance` de `HTTPError`/`ErrorInput`.
- Arquivos: nenhum arquivo novo; eventuais ajustes mínimos em `test/*.test.ts` existentes
