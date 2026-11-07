# Tarefas de implementação — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` e `sdd/techspec.md`. Fluxo: testes novos primeiro (devem falhar), depois a implementação, depois a regressão completa. Nenhum export público novo além de `type` e `instance` em `ErrorBody`/`ErrorInput`/`HTTPError`.

### T-01 — Testes novos que reproduzem o comportamento esperado (falham antes da implementação)

Escrever, com `describeMatrix` (modos `web` e `node`), os casos da seção 5 da techspec: `Content-Type` (erro lançado, `throw 404`, rota inexistente, middleware, validação), membros `type`/`title`/`status`/`detail`, `type`/`instance` (instância, corpo, `HTTPError.status(...)`, `cause` objeto, `cause` com `type` não-string), ausência de `instance`, erros não tratados sem vazamento (incluindo `fromNodeHandler` com campo `type`), extensões de `body` sem sobrescrever membros padrão, `debug` com `stack` e `x-id`, e JSON-RPC inalterado. Criar também os testes unitários de `toJSON()` e `statusPhrase()` e as asserções de tipo.

- **Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
- **Depende de:** nenhuma
- **Aceite:** `pnpm vitest run test/errors.test.ts test/unit/problem-details.test.ts` roda e os casos novos **falham** antes das tarefas T-02 a T-05; cada RF-01…RF-08 tem ao menos um caso nomeado com o seu id.
- **Arquivos:** `test/errors.test.ts`, `test/unit/problem-details.test.ts` (novo), `test/unit/types.test-d.ts`

### T-02 — Campos `type` e `instance` em `ErrorBody` e `HTTPError`

Adicionar `type?: string` e `instance?: string` (com JSDoc) a `ErrorBody`. Declarar `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError` e atribuí-los no construtor depois de `this.body`, lendo `details` e `details.cause` apenas quando forem `string` não vazia (valores não-string ou vazios viram `undefined`). Conferir que `HTTPError.status(...)` repassa os campos.

- **Cobre:** RF-03, RF-04
- **Depende de:** T-01
- **Aceite:** `new HTTPError({ status: 403, type, instance })` expõe `error.type` e `error.instance`; sem eles ambos são `undefined`; `cause` objeto com strings é lido, `cause` com `type` numérico é ignorado; `pnpm typecheck` passa (`isolatedDeclarations`).
- **Arquivos:** `src/error.ts`

### T-03 — Helper interno `statusPhrase()`

Criar `statusPhrase(status: number): string | undefined` com tabela mínima, sem `node:http`, cobrindo 400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 413, 415, 418, 422, 423, 424, 425, 426, 428, 429, 431, 451 e 500–511. Código fora da tabela devolve `undefined`. Não exportar em `src/index.ts`; helper com menos de 200 linhas.

- **Cobre:** RF-02
- **Depende de:** nenhuma
- **Aceite:** testes unitários de `statusPhrase()` passam (ex.: 404 → `"Not Found"`, 599 → `undefined`); `grep statusPhrase src/index.ts` não retorna nada.
- **Arquivos:** `src/utils/internal/status-phrase.ts` (novo)

### T-04 — `HTTPError.toJSON()` com membros RFC 9457 e precedência

Reescrever `toJSON()` conforme D-05 e D-08: ordem legados (`status`, `statusText`, `unhandled`, `message`, `data`) → `...body` → membros padrão (`type`, `title`, `status`, `detail`, `instance`). `type` é `"about:blank"` quando ausente ou `unhandled`; `title` usa `statusText` e, na falta, `statusPhrase(status)` (omitido se não houver frase); `detail` = `message`, omitido em `unhandled`; `instance` omitido se `undefined` ou `unhandled` (nunca `null`). Manter o mascaramento atual de `unhandled` (sem `data`, `body` nem mensagem original). Tipo de retorno inline `Omit<ErrorBody, "body"> & { title?: string; detail?: string } & ErrorBody["body"]`, sem interface nova.

- **Cobre:** RF-02, RF-04, RF-05, RF-06
- **Depende de:** T-02, T-03
- **Aceite:** corpo de `HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" })` tem `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail`; `body: { status: 200, type: "x", title: "y" }` não sobrescreve os membros padrão; `body.message` ainda sobrescreve `message`; erro não tratado com `type`/`instance` na causa não os emite nem expõe "segredo interno"; `pnpm typecheck` passa.
- **Arquivos:** `src/error.ts`

### T-05 — `Content-Type: application/problem+json` em `errorResponse()`

Criar `problemHeaders` (`/* @__PURE__ */ new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })`) ao lado de `jsonHeaders` e usá-lo em `errorResponse()`. Manter `stack` fora de `toJSON()`, indentação de 2 espaços em `debug`, mesclagem de `HTTPError.headers` e `event.res.headers` e a sanitização de `statusText`. Respostas de sucesso continuam com `jsonHeaders`.

- **Cobre:** RF-01, RF-07, RF-08
- **Depende de:** T-04
- **Aceite:** erro lançado, `throw 404`, rota inexistente, erro de middleware e de validação respondem `application/problem+json;charset=UTF-8` em `web` e `node`; com `debug: true` há `stack` (array) e `x-id: 1`; respostas de sucesso JSON seguem `application/json`; caso HEAD de `test/errors.test.ts` continua passando; `test/json-rpc.test.ts` e `test/rules/*` passam sem alteração.
- **Arquivos:** `src/response.ts`

### T-06 — Ajustar testes existentes afetados

Trocar `application/json` por `application/problem+json` em `test/errors.test.ts` (linhas 44 e 140) e rodar a suíte completa para achar testes que comparam o corpo de erro com `toEqual` (`test/app.test.ts`, `test/proxy.test.ts`, `test/handler.test.ts`, `test/validate.test.ts`, `test/route.test.ts`, `test/body.test.ts`). Ajustar acrescentando os membros novos, sem remover asserções. Não alterar testes de resposta de sucesso (`test/security.test.ts:556`, `test/proxy.test.ts:1531`).

- **Cobre:** RF-01, RF-06, RF-08
- **Depende de:** T-05
- **Aceite:** `pnpm vitest run` passa por inteiro; o diff dos testes existentes só troca o `Content-Type` esperado e acrescenta membros, sem apagar asserções.
- **Arquivos:** `test/errors.test.ts`, `test/app.test.ts`, `test/proxy.test.ts`, `test/handler.test.ts`, `test/validate.test.ts`, `test/route.test.ts`, `test/body.test.ts`

### T-07 — Verificação final

Rodar a suíte completa e as verificações estáticas e confirmar que os testes de T-01 agora passam. Conferir que não surgiu nenhum export público novo e que `src/adapters.ts`, `src/utils/json-rpc.ts` e `src/rules/` não foram alterados. Registrar a mudança de `Content-Type` e a nova precedência de `body.type`/`title`/`detail`/`instance`/`status` (R-01, R-02) nas notas de versão, se o repositório tiver arquivo para isso.

- **Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
- **Depende de:** T-06
- **Aceite:** `pnpm vitest run`, `pnpm lint` (inclui typecheck) e `pnpm test` passam; `git diff --stat` não lista `src/adapters.ts`, `src/utils/json-rpc.ts`, `src/rules/` nem `src/index.ts`.
- **Arquivos:** nenhum arquivo novo (verificação); notas de versão, se existirem
