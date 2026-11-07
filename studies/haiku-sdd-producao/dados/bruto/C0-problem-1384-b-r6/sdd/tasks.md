# Tarefas — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-08). Este documento não altera código.

Ordem sugerida: T-01 → T-02 → T-03 → T-04 → T-05 → T-06 → T-07 → T-08 → T-09. Seguir o "Bug Fix Workflow" do `AGENTS.md`: o teste de regressão (T-01) deve falhar antes de qualquer mudança em `src/`.

### T-01 — Teste de regressão do content-type `application/problem+json`

Escrever em `test/errors.test.ts`, com `describeMatrix`, o teste que lança `new HTTPError({ status: 400 })` e verifica status 400 e `content-type` começando com `application/problem+json`. Incluir variantes: 404 por rota inexistente, `throw 404`, erro desconhecido e erro lançado em middleware. Executar `pnpm vitest run test/errors.test.ts` e confirmar que o teste **falha** antes da implementação.

- Cobre: RF-01, RF-07
- Arquivos: `test/errors.test.ts`
- Depende de: nenhuma
- Aceite: o novo teste existe, roda nos modos `web` e `node` e falha com o código atual (content-type ainda `application/json;charset=UTF-8`). O registro da falha fica na saída do comando.

### T-02 — Tabela interna de textos de razão (`getStatusText`)

Criar `src/utils/internal/status-text.ts` com a tabela de reason phrases da RFC 9110 (1xx–5xx, usando "Content Too Large" para 413 e "Unprocessable Content" para 422) e `export function getStatusText(status: number): string | undefined`. Não alterar `STATUS_TEXT` de `src/utils/response.ts` nem adicionar dependência. Adicionar teste unitário em `test/unit/` (códigos comuns como 404 e 500; código sem texto, como 599, retorna `undefined`).

- Cobre: RF-02, RF-07
- Arquivos: `src/utils/internal/status-text.ts`, `test/unit/status-text.test.ts`
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/unit/status-text.test.ts` passa; `getStatusText(404) === "Not Found"`, `getStatusText(422) === "Unprocessable Content"`, `getStatusText(599) === undefined`; `STATUS_TEXT` de `src/utils/response.ts` permanece intacto.

### T-03 — Campos `type` e `instance` em `ErrorBody` e `HTTPError`

Em `src/error.ts`: adicionar `type?: string` e `instance?: string` (com JSDoc) a `ErrorBody`; declarar `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`; atribuí-los no construtor lendo **somente** do objeto de entrada (não de `cause`) e validando `typeof === "string"` (D-07). Não criar outros nomes públicos.

- Cobre: RF-03
- Arquivos: `src/error.ts`
- Depende de: nenhuma
- Aceite: `pnpm typecheck` passa; `new HTTPError({ status: 409, type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })` expõe `error.type` e `error.instance` com os valores informados; `HTTPError.status(409, undefined, { type, instance })` e `new HTTPError("msg", { status, type })` aceitam os campos; um `Error` comum com propriedade `type` não string/`cause.type` não alimenta `error.type` (fica `undefined`).

### T-04 — Novo formato em `HTTPError.toJSON()`

Em `src/error.ts` (importando `getStatusText` de `./utils/internal/status-text.ts`), reescrever `toJSON()` com tipo de retorno inline explícito (exigência de `isolatedDeclarations`, sem tipo nomeado exportado), na ordem: `statusText`, `unhandled`, `message`, `data`, `...body` (legado) e, por último, `type` (informado ou `"about:blank"`), `title` (`statusText || getStatusText(status) || "HTTPError"`), `status`, `detail` (`this.message`) e `instance`. Para `unhandled`: `type` fixo `"about:blank"`, `detail` e `instance` `undefined`, `message` `"HTTPError"`, sem `data`/`body`; `title` e `status` mantidos. Não alterar a regra atual de ocultação.

- Cobre: RF-02, RF-03, RF-04, RF-05
- Arquivos: `src/error.ts`
- Depende de: T-02, T-03
- Aceite: `pnpm typecheck` passa; `toJSON()` de `new HTTPError({ status: 422, message: "inválido", data: { campo: "nome" }, body: { codigo: "E42" } })` contém `message`, `data`, `codigo`, `type: "about:blank"`, `title: "Unprocessable Content"`, `status: 422`, `detail: "inválido"` e não contém `instance`; `body: { type, title, status, detail, instance }` não sobrescreve os membros do `HTTPError`; com `unhandled: true` e `type`/`instance` informados, eles não saem e não há `detail`.

### T-05 — `errorResponse` com `problemHeaders`

Em `src/response.ts`, adicionar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`) ao lado de `jsonHeaders` e fazer `errorResponse` partir dele. Não alterar `jsonHeaders` (usado em respostas não erro), a chamada em `prepareResponse` nem `src/utils/json-rpc.ts`. Manter a mesclagem existente de `error.headers` e `errHeaders` e o acréscimo de `stack` só em modo debug.

- Cobre: RF-01, RF-05, RF-06
- Arquivos: `src/response.ts`
- Depende de: T-04
- Aceite: o teste de T-01 passa nos modos `web` e `node`; respostas não erro (objeto retornado, `Response.json`) continuam com `application/json;charset=UTF-8`; um `content-type` definido em `error.headers` prevalece; `status` e `statusText` HTTP não mudam.

### T-06 — Ajustar testes existentes que dependem do formato antigo

Em `test/errors.test.ts`: trocar a asserção da linha ~44 para `toBe("application/problem+json")` e a da linha ~140 para `toMatch("application/problem+json")`, mantendo a igualdade exata (D-08). Não mexer em `test/router.test.ts:422`, `test/security.test.ts:556` e `test/proxy.test.ts:1531` (respostas não erro). Rodar a suíte inteira e ajustar, sem afrouxar, qualquer outro teste que compare corpo de erro com `toEqual`/snapshot ou content-type exato.

- Cobre: RF-07
- Arquivos: `test/errors.test.ts`
- Depende de: T-05
- Aceite: `pnpm vitest run` passa sem testes pulados ou removidos; nenhuma asserção foi trocada por verificação mais fraca (revisar o diff).

### T-07 — Novos testes de RF-02 a RF-06

Em `test/errors.test.ts`, com `describeMatrix`, cobrir (conforme seção 5 da techspec): RF-02 (404 com `message`, `title` com `statusText` próprio, 599 → `"HTTPError"`, sem `instance`); RF-03 (`error.type`/`error.instance` capturados via `onError` e presentes no corpo; `HTTPError.status(...)` e `new HTTPError("msg", {...})`); RF-04 (campos legados mantidos, não sobrescrita por `body`, `toJSON()` direto); RF-05 (`throw new Error("segredo interno")` sem debug → 500, `title: "Internal Server Error"`, sem `detail` nem `stack`, texto ausente de `JSON.stringify` do corpo; `unhandled` com `type`/`instance` não os emite; `debug: true` traz `stack`); RF-06 (`www-authenticate` preservado, 401, content-type problem+json, `content-type` custom prevalece, `statusText` HTTP inalterado).

- Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
- Arquivos: `test/errors.test.ts`
- Depende de: T-05
- Aceite: `pnpm vitest run test/errors.test.ts` passa nos modos `web` e `node`, com ao menos um teste por requisito RF-02 a RF-06; `ctx.errors` não registra erros inesperados.

### T-08 — Atualizar a documentação de erros

Atualizar `docs/1.guide/1.basics/6.error.md` (se existir): exemplo de resposta no novo formato, lista de campos incluindo `type` e `instance`, nota sobre o content-type `application/problem+json`, sobre os campos legados mantidos como extensões e sobre `onError` com resposta própria não receber o formato automaticamente. Registrar a ruptura de content-type para as notas de versão.

- Cobre: RF-07
- Arquivos: `docs/1.guide/1.basics/6.error.md`
- Depende de: T-05
- Aceite: a documentação descreve `type`, `instance`, `title`, `detail`, o content-type novo e os campos legados; o exemplo de resposta é igual ao que o código emite; `pnpm lint` (oxfmt `--check`) não aponta o arquivo.

### T-09 — Verificação final

Executar `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`; conferir `test/unit/types.test-d.ts` com os campos novos; revisar o diff para confirmar que não houve nome público novo além de `type` e `instance`, nem mudança em `json-rpc.ts`, `jsonHeaders` ou `STATUS_TEXT`.

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
- Arquivos: nenhum (somente verificação)
- Depende de: T-06, T-07, T-08
- Aceite: os três comandos terminam com sucesso; `git diff --stat` lista apenas os arquivos das tarefas T-01 a T-08.
