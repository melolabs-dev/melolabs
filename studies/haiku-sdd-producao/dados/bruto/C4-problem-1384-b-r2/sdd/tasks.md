# Tarefas de implementação — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-10, seções 4 e 6).

## Antes de começar

As tarefas seguem as decisões da techspec como estão escritas. Os pontos abaixo (techspec, seção 8) ainda dependem dos mantenedores. Se algum mudar, as tarefas indicadas mudam junto:

1. D-01: manter os membros legados (`message`, `statusText`, `unhandled`, `data`) como extensão. Afeta T-05 e T-06.
2. D-03: `body` perde para os membros do h3 em caso de chave repetida. Afeta T-05.
3. D-06: `detail` só quando a mensagem foi informada explicitamente. Afeta T-04 e T-05.
4. D-10: atualização da documentação. Afeta T-08, que pode ser removida do escopo.

A mudança de `Content-Type` (RF-02) e a precedência de `body` (D-03) são mudanças incompatíveis. Devem constar na descrição da mudança (ver T-07).

## Tarefas

### T-01 — Escrever os testes novos (antes da implementação)

- **Cobre:** RF-01 a RF-09
- **Depende de:** nenhuma
- **Aceite:** o arquivo roda com `pnpm vitest run test/problem-details.test.ts` nos modos `web` e `node` (via `describeMatrix`). Antes de T-03 a T-06, os cenários de RF-01 a RF-08 falham pelo motivo esperado (corpo sem `type`/`title`/`detail`/`instance`, `content-type` antigo, ausência de `stack` em debug etc.). O cenário de RF-09 (`{ ok: true }` com `application/json;charset=UTF-8`) já passa e serve de controle. Cobrir: `throw` de `HTTPError` com mensagem; erro retornado com `return`; `kNotFound` por rota inexistente; erro não tratado (`unhandled`, sem `detail`, `message: "HTTPError"`); `type`/`instance` por construtor e por `cause`; `about:blank` padrão; `title` com `statusText`, com a frase padrão (`HTTPError.status(404)` → `"Not Found"`) e com código fora da tabela (`"Error"`); `data` e `body` presentes; `body` com `status`/`type` forjados não altera o h3 (D-03); `stack` ausente com `debug: false` e presente como array com `debug: true` (app próprio, pois `_setup` ativa debug); `retry-after` e `errHeaders` mesclados; mensagem igual ao `statusText` ainda gera `detail` (D-06).
- **Arquivos:** `test/problem-details.test.ts`

### T-02 — Ajustar os dois asserts de `content-type` em testes existentes

- **Cobre:** RF-02, RF-10
- **Depende de:** nenhuma
- **Aceite:** `test/errors.test.ts:44` passa a esperar `application/problem+json;charset=UTF-8`, e `test/errors.test.ts:140` passa a esperar `toMatch("application/problem+json")`. Nenhum outro assert desse arquivo muda. O motivo de cada ajuste (RF-02) deve ser anotado para a descrição da mudança. Esses dois asserts falham até T-06 e passam depois dela.
- **Arquivos:** `test/errors.test.ts`

### T-03 — Criar a tabela interna de reason phrases

- **Cobre:** RF-05
- **Depende de:** nenhuma
- **Aceite:** `defaultStatusText(status)` retorna a frase IANA para os códigos 100 a 511 (ex.: `404` → `"Not Found"`, `422` → `"Unprocessable Content"`, `500` → `"Internal Server Error"`). Código fora da tabela retorna `"Error"` (ex.: `999`). Sem dependências de runtime (não usar `node:http`). Função exportada com tipo de retorno explícito (`isolatedDeclarations`). `pnpm typecheck` passa.
- **Arquivos:** `src/utils/internal/status-text.ts`

### T-04 — Adicionar `type` e `instance` em `HTTPError` e a flag `~hasMessage`

- **Cobre:** RF-03, RF-04, RF-05 (D-06)
- **Depende de:** nenhuma
- **Aceite:** `ErrorBody` ganha `type?: string` e `instance?: string`. A classe ganha `readonly type` e `readonly instance`, lidos de `details` e, na falta, de `details.cause`, como já ocorre com `headers` e `unhandled`. `new HTTPError({ status: 403, type, instance })` expõe os dois valores; sem eles, as propriedades são `undefined`. O construtor define `~hasMessage` como propriedade não enumerável via `declare`, com valor `true` apenas quando `messageInput`, `details.message` ou `cause.message` foi informado. `toJSON()` não muda: os testes existentes de `test/errors.test.ts` continuam passando. `pnpm typecheck` passa.
- **Arquivos:** `src/error.ts`

### T-05 — Montar o corpo RFC 9457 em `toProblemDetails`

- **Cobre:** RF-01, RF-04, RF-05, RF-06, RF-07
- **Depende de:** T-03, T-04
- **Aceite:** `toProblemDetails(error, debug)` retorna o corpo na ordem de precedência da techspec (seção 4): o `body` do erro é espalhado primeiro, e depois `type` (padrão `"about:blank"`), `title` (`statusText` ou `defaultStatusText`), `status`, `detail` (só com `~hasMessage`), `instance`, e os legados `message`, `statusText`, `unhandled`, `data`, `stack`. Com `unhandled: true`, `detail`, `data` e `body` são omitidos e `message` é `"HTTPError"` (D-08). `stack` é array de linhas trimadas apenas com `debug` e `error.stack`. As chaves `status`, `type`, `title`, `detail` e `instance` do h3 vencem as do `body` (D-03). O tipo `ProblemDetails` não é exportado pelo `index.ts`. O arquivo fica abaixo de 200 linhas. Os cenários de RF-01, RF-04 a RF-07 de `test/problem-details.test.ts` passam, exceto os que dependem de `response.ts` (T-06).
- **Arquivos:** `src/utils/internal/problem.ts`

### T-06 — Trocar o `Content-Type` e o corpo de erro em `errorResponse`

- **Cobre:** RF-01, RF-02, RF-08, RF-09
- **Depende de:** T-05
- **Aceite:** novo singleton `problemHeaders` (`FrozenHeaders`) com `content-type: application/problem+json;charset=UTF-8`, ao lado de `jsonHeaders`. `errorResponse` usa `problemHeaders` nas duas linhas que hoje usam `jsonHeaders` e `toProblemDetails` no lugar de `toJSON()`. A assinatura não muda. Continuam valendo `error.headers`, `errHeaders`, `set-cookie` e `onError` na mesma ordem de hoje. HEAD continua sem corpo. Respostas de sucesso continuam com `jsonHeaders` (`{ ok: true }` → `application/json;charset=UTF-8`, corpo `{"ok":true}`). Com `retry-after: 30`, o cabeçalho chega à resposta. `pnpm vitest run test/problem-details.test.ts` passa nos cenários de RF-01, RF-02, RF-08 e RF-09. Nenhuma montagem de corpo fica em `response.ts`.
- **Arquivos:** `src/response.ts`

### T-07 — Verificar a suíte completa e registrar a descrição da mudança

- **Cobre:** RF-10
- **Depende de:** T-01, T-02, T-06
- **Aceite:** `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa, depois `pnpm test` (lint, typecheck e cobertura) passa nos dois modos. Os testes que a techspec aponta como sensíveis (`test/handler.test.ts:220-330`, `test/body.test.ts:450-457`, `test/app.test.ts:198-205`, `test/errors.test.ts:350`, `:384`, `:420`) passam sem alteração. Se algum precisar de ajuste, o ajuste é listado com o motivo e só é feito se o teste verificar o mesmo comportamento. A descrição da mudança lista: (a) os ajustes em `test/errors.test.ts`; (b) a mudança incompatível de `Content-Type` (RF-02); (c) a precedência do h3 sobre `body` (D-03); (d) os pontos da seção "Antes de começar" que ainda dependem de decisão.
- **Arquivos:** nenhum (apenas execução de verificação e texto da descrição)

### T-08 — Atualizar a documentação do formato de erro

- **Cobre:** RF-01, RF-03 (D-10, fora do PRD; ver ponto 4 de "Antes de começar")
- **Depende de:** T-06
- **Aceite:** o exemplo JSON em `docs/1.guide/1.basics/6.error.md` (linhas ~39 a 50) mostra o corpo de um 404 com `type`, `title`, `status`, `detail` e `instance`, e o `content-type` é mencionado como `application/problem+json`. A lista de campos (linhas ~52 a 60) descreve `type` e `instance` e marca `message`, `statusText`, `data` e `stack` como extensões. Se os mantenedores retirarem D-10 do escopo, esta tarefa é removida. `pnpm lint` passa.
- **Arquivos:** `docs/1.guide/1.basics/6.error.md`

## Ordem sugerida

- T-01, T-02, T-03 e T-04 podem ser feitas em paralelo. T-01 deve ser executada e ter as falhas confirmadas antes de T-05 e T-06.
- T-05 depois de T-03 e T-04. T-06 depois de T-05.
- T-07 depois de T-01, T-02 e T-06. T-08 depois de T-06.

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 corpo RFC 9457 | T-01, T-05, T-06, T-08 |
| RF-02 `Content-Type` | T-01, T-02, T-06 |
| RF-03 `type` e `instance` em `HTTPError` | T-01, T-04, T-05, T-08 |
| RF-04 `type` padrão | T-01, T-04, T-05 |
| RF-05 `title` e `detail` | T-01, T-03, T-04, T-05 |
| RF-06 preservação de `data` | T-01, T-05 |
| RF-07 `stack` só em debug | T-01, T-05 |
| RF-08 cabeçalhos preservados | T-01, T-06 |
| RF-09 sucesso inalterado | T-01, T-06 |
| RF-10 suíte e verificações | T-02, T-07 |
