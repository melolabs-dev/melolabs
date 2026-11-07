# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01…RF-09) e `sdd/techspec.md` (D-01…D-12). Fluxo de bug fix do AGENTS.md: os testes de T-05 e T-06 devem ser escritos primeiro e confirmados falhando antes das tarefas de implementação (T-01…T-04). Nenhum nome público novo além de `H3Config.problemDetails` e `type`/`instance` em `HTTPError`.

### T-01 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` com JSDoc após `silent` (D-10). Sem default nem normalização: `undefined`/`false` mantém o caminho legado.

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm lint` (typecheck) passa; `H3Config["problemDetails"]` é `boolean | undefined` e `H3CoreConfig` herda a opção; nenhum export novo em `src/index.ts`.
Arquivos:

- `src/types/h3.ts`

### T-02 — Campos `type` e `instance` em `HTTPError`

Adicionar `type?: string` e `instance?: string` a `ErrorInput`, e `readonly type`/`readonly instance` à classe, atribuídos só a partir de `details` com validação `typeof === "string"` (D-03). Não herdar de `cause`; não alterar `toJSON` nem `ErrorBody`. `HTTPError.status(...)` já repassa `details`.

Cobre: RF-04, RF-09
Depende de: nenhuma
Aceite: `new HTTPError({ status: 409, type: "urn:erro:conflito", instance: "/x/1" })` retorna `type`/`instance` informados; sem informá-los, ambos são `undefined`; valor não-string é descartado; `toJSON()` não contém `type` nem `instance`; `pnpm lint` passa.
Arquivos:

- `src/error.ts`

### T-03 — Montagem do corpo problem details (`toProblemBody`)

Criar helper interno com o mapa mínimo de frases de status (D-04) e `toProblemBody(error, debug?)` (D-05…D-07): ordem `type`, `title`, `status`, `detail`, `instance`; `detail` omitido se igual a `title` ou a `"HTTPError <status>"`; extensões `data` e `body` com chaves reservadas filtradas; erros `unhandled` só com `title` (do mapa, ignorando `statusText`) e `status`; `stack` (array de linhas) apenas com `debug`.

Cobre: RF-03, RF-05, RF-06
Depende de: T-02
Aceite: teste unitário/integração do corpo: 403 completo gera `type`, `title`, `status`, `detail`, `instance`; `body: { codigo: "E42", status: 200 }` em erro 422 gera `codigo` e mantém `status: 422`; `unhandled` não contém mensagem, `data`, `body`, `type`, `instance` nem `stack` sem `debug`; membros `undefined` não são serializados; arquivo importado com extensão `.ts`, sem barrel.
Arquivos:

- `src/utils/internal/problem.ts`

### T-04 — Renderização em `errorResponse` com `config`

Mudar `errorResponse` para `(error, config, errHeaders?)` e atualizar a única chamada em `prepareResponse` (D-01). Criar `problemHeaders` (`application/problem+json;charset=UTF-8`) e escolher a base de headers e o corpo conforme `config.problemDetails` (D-08), mantendo a ordem `base → error.headers → errHeaders`. Com a opção desligada, o código executa exatamente o caminho atual. `debug` continua indentando com 2 espaços; fluxo do `onError` sem mudança (D-09).

Cobre: RF-01, RF-02, RF-07, RF-08, RF-09
Depende de: T-01, T-03
Aceite: com `problemDetails: true`, 400 retorna `content-type` iniciando em `application/problem+json` com charset UTF-8; 404 de rota retorna `title: "Not Found"` e `detail` com a mensagem de rota não encontrada; `content-type` explícito em `error.headers` ainda prevalece; sem a opção, resposta idêntica à atual; `pnpm lint` passa.
Arquivos:

- `src/response.ts`

### T-05 — Testes de integração em `describeMatrix`

Criar `test/problem-details.test.ts` (web e node), ligando a opção via `ctx.app.config.problemDetails = true` e, quando necessário, `ctx.app.config.debug = false`. Um caso por critério de aceite: RF-01 (opção ausente e `false`, corpo legado); RF-02; RF-03; RF-05 (incluindo `body` com `type`/`title`/`detail`/`instance` sem sobrescrever); RF-06 (`new Error("segredo interno")`, `cause` com `statusMessage`/`type` próprios sem vazar, `debug: true` com `stack` e JSON indentado, consumindo `ctx.errors`); RF-07 (`kNotFound`, body limit, caminho `/foo%`, falha de `readValidatedBody`); RF-08 (`x-id` preservado, `content-type` explícito prevalece, `event.res.errHeaders` mesclado, `onError` com valor próprio não reescrito, `set-cookie` não duplicado); caso espelho para `data` circular (R-T8) e registro do comportamento de fluxos sem config (R-T4).
Escrever antes de T-01…T-04 e confirmar que falham.

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
Depende de: T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa em `web` e `node`, e os testes falham antes das tarefas de implementação.
Arquivos:

- `test/problem-details.test.ts`

### T-06 — Testes unitários e de tipos para `type`/`instance` e a opção

Cobrir RF-04 no nível unitário (valores informados, `undefined`, `HTTPError.status(409, undefined, { type, instance })`, descarte de não-string, `toJSON()` sem os campos) e, em `test/unit/types.test-d.ts`, asserts de tipo: `H3Config["problemDetails"]` é `boolean | undefined`, `ErrorInput` aceita `type`/`instance` string e rejeita número, `HTTPError#type` é `string | undefined`.

Cobre: RF-01, RF-04, RF-09
Depende de: T-01, T-02
Aceite: `pnpm vitest run test/unit/` passa e `pnpm lint` (typecheck) aceita os asserts de tipo.
Arquivos:

- `test/unit/types.test-d.ts`
- `test/problem-details.test.ts`

### T-07 — Documentação

Acrescentar `problemDetails` à lista de opções e incluir `type` e `instance` nos campos de `HTTPError`, com seção curta sobre o formato `application/problem+json`, a regra de `unhandled` e a limitação de fluxos sem config (D-11), indicando que `type` deve ser URI (P5).

Cobre: RF-01, RF-03, RF-04
Depende de: T-04
Aceite: a lista de opções em `docs/1.guide/900.api/1.h3.md` inclui `problemDetails`; `docs/1.guide/1.basics/6.error.md` descreve `type`, `instance` e o formato; `pnpm fmt`/`pnpm lint` não reportam diferenças de formatação.
Arquivos:

- `docs/1.guide/900.api/1.h3.md`
- `docs/1.guide/1.basics/6.error.md`

### T-08 — Regressão e verificação final

Rodar a suíte completa, lint/typecheck e build; medir o tamanho do chunk antes e depois (R5/R-T6). Ajustar um teste existente só se falhar e preservando suas asserções originais. Confirmar que `toJSON`, `src/utils/json-rpc.ts`, `package.json` e `src/_entries/*` não foram alterados.

Cobre: RF-09
Depende de: T-05, T-06, T-07
Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm build` passam; `git diff` não mostra alterações em `toJSON`, `src/index.ts`, `package.json` nem `src/_entries/*`; o impacto no tamanho do bundle é registrado no resumo final.
Arquivos:

- `src/error.ts`
- `src/response.ts`
- `test/problem-details.test.ts`

## Cobertura dos requisitos

| Requisito | Tarefas                      |
| --------- | ---------------------------- |
| RF-01     | T-01, T-04, T-05, T-06, T-07 |
| RF-02     | T-04, T-05                   |
| RF-03     | T-03, T-05, T-07             |
| RF-04     | T-02, T-06, T-07             |
| RF-05     | T-03, T-05                   |
| RF-06     | T-03, T-05                   |
| RF-07     | T-04, T-05                   |
| RF-08     | T-04, T-05                   |
| RF-09     | T-02, T-04, T-06, T-08       |
