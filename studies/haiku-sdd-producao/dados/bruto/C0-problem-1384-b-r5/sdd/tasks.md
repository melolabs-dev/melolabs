# Tarefas — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09, R-01 a R-09). Ordem sugerida: T-01 (testes que falham), T-02 a T-05 (implementação), T-06 a T-08 (ajustes, docs e verificação).

### T-01 — Escrever os testes novos e confirmar que falham (regressão)

Adicionar ao fim de `test/errors.test.ts`, com `describeMatrix` e o estilo `t.app` / `t.fetch` do arquivo, um teste por requisito conforme techspec §5:

- 400, 404 de rota inexistente, erro de middleware e `throw 404` com `content-type` começando em `application/problem+json`.
- 404 com `message` (`type: "about:blank"`, `title: "Not Found"`, `status`, `detail`); `statusText` customizado vira `title`.
- `error.type` / `error.instance` via `new HTTPError({...})`, `HTTPError.status(403, undefined, { type, instance })` e `new HTTPError("m", { type, instance })`; `undefined` quando omitidos; valor não string vira `undefined`; `type` em `cause` não é herdado.
- `type` e `instance` na resposta; `instance` ausente (`not.toHaveProperty`) quando não informado.
- Sem `Accept` e com `Accept: text/html`, mesmo formato.
- Exemplo 422 do PRD (`message`, `data`, `codigo`, `detail`, `status`, `title`); colisão `body: { status: 200, title: "x", detail: "x" }` não altera `status`, `title`, `detail`; `body.message` continua sobrescrevendo `message`.
- `new Error("segredo do banco")` → 500, `problem+json`, `title: "Internal Server Error"`, sem a string no corpo, sem `stack`, `detail` e `instance`; com `debug: true`, `stack` presente; `HTTPError` com `unhandled: true`, `type` e `instance` não vaza nenhum dos dois.
- Exemplo 401 do PRD (`statusText`, `www-authenticate: Basic`, `title: "Não autorizado"`).
- Status 599: `title` ausente, sem exceção.
- `onError` que relança/devolve erro continua `problem+json`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/errors.test.ts` roda e os testes novos **falham** antes de qualquer mudança em `src/` (registrar quais falharam); os testes antigos continuam como estavam.
Arquivos: `test/errors.test.ts`

### T-02 — Criar a tabela interna de frases de status

Criar `statusTitle(status: number): string | undefined` e uma tabela `Record<number, string>` com os códigos 4xx e 5xx da RFC 9110 e os usuais de 1xx a 3xx, sem dependências, com anotação de tipo explícita (`isolatedDeclarations`). Não exportar pelo índice público e não reutilizar nem alterar `STATUS_TEXT` de `src/utils/response.ts` (D-04). Status sem frase conhecida (ex.: 599) retornam `undefined`.

Cobre: RF-02, RF-07
Depende de: nenhuma
Aceite: `statusTitle(404) === "Not Found"`, `statusTitle(500) === "Internal Server Error"`, `statusTitle(599) === undefined`; `src/index.ts` não reexporta o módulo; `pnpm typecheck` passa.
Arquivos: `src/utils/internal/status-text.ts`

### T-03 — Adicionar `type` e `instance` a `ErrorBody` e `HTTPError`

Em `src/error.ts`: declarar `type?: string` e `instance?: string` em `ErrorBody` com JSDoc (D-05); declarar `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`; no fim do construtor, atribuir ambos somente a partir de `details`, exigindo `typeof === "string"` e sem herdar de `cause` (D-06). `HTTPError.status(...)` e `new HTTPError(message, details)` repassam sem mudança. Nenhum nome público novo em `src/index.ts`.

Cobre: RF-03
Depende de: nenhuma
Aceite: os testes de RF-03 de T-01 passam (`error.type` e `error.instance` exatos; `undefined` quando omitidos, não string ou só em `cause`); `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-04 — Montar o corpo problem details em `HTTPError.toJSON()`

Em `src/error.ts`, importar `statusTitle` e reescrever `toJSON()` conforme D-02 e D-03: montar o objeto legado como hoje (`status`, `statusText`, `unhandled`, `message`, `data`, chaves de `body`, com a máscara de `unhandled`) e sobrepor depois do spread `type`, `title`, `status`, `detail` e `instance`.

- Tratado: `type = this.type ?? "about:blank"`, `title = this.statusText ?? statusTitle(status)`, `status = this.status`, `detail = this.message`, `instance = this.instance`.
- `unhandled`: `type = "about:blank"`, `title = statusTitle(status)` (nunca `statusText`), `detail` e `instance` ausentes, `message: "HTTPError"`, `data` e `body` omitidos.
- Chaves `undefined` somem na serialização; `stack` continua só com `config.debug`.

Cobre: RF-02, RF-04, RF-06, RF-07, RF-08
Depende de: T-02, T-03
Aceite: os testes de RF-02, RF-04, RF-06, RF-07 e RF-08 de T-01 passam; os `toMatchObject` existentes em `test/errors.test.ts` (linhas 257, 309, 350, 384, 420, 442) continuam passando sem edição; `JSON.stringify(error)` inclui os membros novos.
Arquivos: `src/error.ts`

### T-05 — Responder erros com `application/problem+json`

Em `src/response.ts`, acrescentar ao lado de `jsonHeaders` a constante congelada `problemHeaders` (`application/problem+json;charset=UTF-8`, padrão de `FrozenHeaders`, D-07) e trocar `jsonHeaders` por `problemHeaders` nas duas ramificações de `errorResponse`. Manter `mergeHeaders(problemHeaders, error.headers)` e a aplicação de `errHeaders` como hoje. Não ler `Accept` nem `H3Config` (D-08) e não tocar em `src/utils/json-rpc.ts`.

Cobre: RF-01, RF-05, RF-08
Depende de: T-04
Aceite: os testes de RF-01, RF-05 e RF-08 de T-01 passam em `web` e `node`, incluindo 404, middleware, `onError` e erro não tratado; headers customizados (`www-authenticate`, `x-error`, `set-cookie`) continuam na resposta; `H3Config` não ganhou campo.
Arquivos: `src/response.ts`

### T-06 — Ajustar os testes existentes dependentes do `Content-Type`

Em `test/errors.test.ts`: linha 44, `toBe("application/json;charset=UTF-8")` → `toBe("application/problem+json;charset=UTF-8")`; linha 140, `toMatch("application/json")` → `toMatch("application/problem+json")`. Manter as demais asserções desses testes. Se a suíte completa revelar outro teste dependente do `Content-Type` de erro, ajustar só a asserção.

Cobre: RF-09
Depende de: T-05
Aceite: `pnpm vitest run test/errors.test.ts` passa por inteiro; o diff dos testes antigos contém apenas as asserções de `Content-Type`.
Arquivos: `test/errors.test.ts`

### T-07 — Atualizar a página de erros da documentação do repositório

Atualizar somente `docs/1.guide/1.basics/6.error.md` (linhas 37-60 e 90): exemplo de resposta em problem details, `Content-Type`, campos `type` e `instance` de `HTTPError`, nota sobre erros não tratados sem `detail`, `type` e `instance`. Item opcional (D-09): pode ser cortado sem afetar as demais tarefas.

Cobre: RF-03, RF-04 (documentação de apoio; sem requisito próprio)
Depende de: T-05
Aceite: a página descreve o novo `Content-Type` e os membros `type`, `title`, `status`, `detail`, `instance`, e mantém os campos legados como extensões; nenhum outro arquivo de documentação foi alterado.
Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-08 — Verificação final e prova de regressão

Rodar `pnpm vitest run` completo, `pnpm lint`, `pnpm typecheck` e `pnpm build` (validar `isolatedDeclarations` e registrar a diferença de tamanho do bundle, R-07). Reverter temporariamente `src/error.ts` e `src/response.ts` (ex.: `git stash` apenas desses arquivos) e confirmar que os testes novos falham; restaurar em seguida. Registrar o que for pendente (R-03, R-08).

Cobre: RF-09
Depende de: T-01, T-05, T-06, T-07
Aceite: suíte completa, `pnpm lint`, `pnpm typecheck` e `pnpm build` passam; com `src/error.ts` e `src/response.ts` revertidos, os testes novos de T-01 falham; árvore final contém só as mudanças das tarefas acima.
Arquivos: nenhum (somente verificação)

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-05 |
| RF-02 | T-01, T-02, T-04 |
| RF-03 | T-01, T-03, T-07 |
| RF-04 | T-01, T-04, T-07 |
| RF-05 | T-01, T-05 |
| RF-06 | T-01, T-04 |
| RF-07 | T-01, T-02, T-04 |
| RF-08 | T-01, T-04, T-05 |
| RF-09 | T-01, T-06, T-08 |
