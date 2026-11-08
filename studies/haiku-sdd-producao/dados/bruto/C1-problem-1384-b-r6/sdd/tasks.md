# Tarefas de implementação — Problem details (RFC 9457) como formato padrão de erro

Fontes: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-09, testes T-01 a T-08).

Antes de começar, confirmar as pendências da techspec (P-01 a P-05). As tarefas abaixo assumem as escolhas
padrão da techspec: `data` como membro de extensão, `Content-Type` exato, `message` removido do corpo, `unhandled`
mantido como extensão e `type`/`instance` lidos só de `details`. Se alguma pendência mudar, revisar as tarefas afetadas.

Regra do fluxo de bug fix (`AGENTS.md`): nas tarefas de teste de regressão (T-01, T-06), confirmar que os casos novos
falham antes de qualquer mudança em `src/`.

---

### T-01 — Testes de regressão de comportamento

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Depende de: nenhuma

Aceite: novo `describe("problem details")` em `test/errors.test.ts`, com `describeMatrix` (web e node), cobrindo:
- `new HTTPError({ status: 404, message: "Usuário não encontrado" })` → corpo com `status: 404`, `detail: "Usuário não encontrado"`, `title: "Not Found"`, `type: "about:blank"`;
- `Content-Type` `application/problem+json` para `HTTPError` e para erro comum;
- `new HTTPError({ status: 500 })` → sem membro `detail`, com `title: "Internal Server Error"`;
- `type` e `instance` informados aparecem em `error.type`/`error.instance` e no corpo;
- `status: 429` com `headers: { "retry-after": "30" }` → header presente na resposta;
- `status: 422` com `data: { campo: "email" }` → `data` preservado, sem sobrescrever `status`, `title` e `type`;
- `throw new Error("senha do banco incorreta")` → 500, `title: "Internal Server Error"`, corpo sem a string;
- handler retornando `{ ok: true }` → `application/json` e corpo `{"ok":true}`.
Os casos de RF-01 a RF-07 devem falhar antes de T-03 a T-05 e passar depois.

Arquivos:
- `test/errors.test.ts`

---

### T-02 — Tabela de frases RFC 9110 para `title`

Cobre: RF-03

Depende de: nenhuma

Aceite:
- `getStatusPhrase(404)` retorna `"Not Found"` e `getStatusPhrase(500)` retorna `"Internal Server Error"`;
- todos os códigos registrados no IANA para 1xx a 5xx têm frase;
- código não registrado (ex.: 599) retorna `undefined`;
- `src/utils/response.ts` (`STATUS_TEXT`) continua sem alteração (D-04).
Os testes ficam em `test/unit/problem-details.test.ts` (seção de `getStatusPhrase`).

Arquivos:
- `src/utils/internal/status-text.ts` (novo)
- `test/unit/problem-details.test.ts` (novo)

---

### T-03 — `HTTPError` aceita `type` e `instance`, com mensagem explícita privada

Cobre: RF-04, RF-03, RF-09

Depende de: nenhuma

Aceite:
- `ErrorBody` ganha `type?` e `instance?`, sem novo export em `src/index.ts`;
- `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` expõe `error.type` e `error.instance` com esses valores;
- `#detail` guarda só a mensagem explícita (vinda de `messageInput`, `details.message` ou `details.cause.message`); quando a mensagem cai no fallback `"HTTPError <status> <statusText>"` ou em `statusText`/`statusMessage`, `#detail` fica `undefined`;
- `Error.message` continua igual ao de hoje (logs e `onError` não mudam);
- `type` e `instance` são lidos só de `details`, não de `cause` (D-06).

Arquivos:
- `src/error.ts`

---

### T-04 — `toJSON()` passa a emitir problem details

Cobre: RF-01, RF-03, RF-06, RF-07

Depende de: T-02, T-03

Aceite:
- `toJSON()` devolve `type` (padrão `"about:blank"`), `title`, `status`, `detail` (só com mensagem explícita), `instance` (só quando definido) e `data`;
- `title` segue a ordem: `statusText` (se não for `unhandled`), frase RFC 9110, `"Unknown Error"`;
- `body` é espalhado antes dos membros padrão, então `body: { status: 1, title: "x" }` não sobrescreve nada;
- erro `unhandled` não tem `detail`, `data` nem `body` no corpo, e `title` ignora `statusText`; mantém `unhandled: true`;
- `message` e `statusText` saem do corpo.

Arquivos:
- `src/error.ts`

---

### T-05 — `errorResponse()` usa `application/problem+json`

Cobre: RF-02, RF-05, RF-08

Depende de: T-04

Aceite:
- `errorResponse()` responde com `Content-Type` exatamente `application/problem+json`, criado como `problemHeaders` (D-03);
- status e headers do erro (ex.: `Retry-After`) continuam aplicados;
- `stack` aparece só em modo debug;
- respostas de sucesso continuam com `application/json;charset=UTF-8` (`jsonHeaders` intacto);
- `onError`, `prepareResponse()` e `src/adapters.ts` não mudam (D-08).

Arquivos:
- `src/response.ts`

---

### T-06 — Testes unitários de `toJSON()`

Cobre: RF-03, RF-06, RF-07

Depende de: T-02, T-04

Aceite: em `test/unit/problem-details.test.ts`, seção de `toJSON()`, cobrindo:
- colisão de `body` com membros padrão: os membros padrão vencem;
- `unhandled` não expõe `detail`, `data` nem `body`;
- `statusText` informado vence a frase padrão em `title`, exceto em `unhandled`;
- `new HTTPError(new Error("x"))` e `new HTTPError({ cause: new Error("x") })` têm `detail: "x"`;
- `new HTTPError({ status: 500 })` não tem `detail`.

Arquivos:
- `test/unit/problem-details.test.ts`

---

### T-07 — Tipos de `type` e `instance`

Cobre: RF-04

Depende de: T-03

Aceite: em `test/unit/types.test-d.ts`, `new HTTPError({ status, type, instance })` aceita strings; `error.type` e `error.instance` são `string | undefined`; `ErrorBody` aceita os dois campos. `pnpm typecheck` passa.

Arquivos:
- `test/unit/types.test-d.ts`

---

### T-08 — Ajustar testes existentes ao novo formato

Cobre: RF-10

Depende de: T-05

Aceite: os asserts do formato antigo são trocados sem remover verificações de status, headers ou comportamento:
- `test/errors.test.ts:44`: `application/json;charset=UTF-8` → `application/problem+json`;
- `test/errors.test.ts:55`: `statusText: "Unprocessable"` → `title: "Unprocessable"`;
- `test/errors.test.ts:350`: `message: "HTTPError"` → sem `detail` e com `unhandled: true`;
- `test/dist.test.ts:57` e `test/iterable.test.ts:145`: `.message` → `.detail`.
Os asserts de `unhandled: true` (`test/errors.test.ts:257, 309, 384, 420, 442`) continuam iguais (D-02).
Após o ajuste, `pnpm vitest run test/errors.test.ts test/iterable.test.ts` passa.

Arquivos:
- `test/errors.test.ts`
- `test/dist.test.ts`
- `test/iterable.test.ts`

---

### T-09 — Verificação de exports públicos (RF-09)

Cobre: RF-09

Depende de: T-03, T-04

Aceite: a lista de exports de `h3` antes e depois da mudança é comparada. A única diferença é a aceitação de `type` e `instance` em `HTTPError`. Nenhum export novo aparece. `ProblemDetails` não é reexportado em `src/index.ts`. Se existir `test/unit/package.test.ts`, usá-lo para essa checagem; senão, comparar a lista manualmente e registrar o resultado na descrição da entrega.

Arquivos:
- `src/index.ts` (sem mudança esperada)
- `test/unit/package.test.ts` (somente se já existir e cobrir exports)

---

### T-10 — Build, dist e regressões de integração

Cobre: RF-08, RF-10

Depende de: T-05, T-08

Aceite:
- `pnpm build` roda sem erro, e `pnpm vitest run test/dist.test.ts` passa com `dist/` atualizado;
- `test/rules/cache.test.ts` passa; erros 4xx/5xx não são servidos com `application/json` após a mudança (D-09, R-08);
- testes de SSE e stream continuam iguais (D-08, R4);
- `test/json-rpc.test.ts` passa sem alteração (fora de escopo);
- `test/proxy.test.ts` (502/504) e `test/validate.test.ts` (`statusText` customizado vira `title`) passam, com asserts ajustados só se o formato mudou.

Arquivos:
- `dist/` (gerado pelo build)
- `test/rules/cache.test.ts`
- `test/proxy.test.ts`
- `test/validate.test.ts`
- `test/json-rpc.test.ts` (sem alteração esperada)

---

### T-11 — Qualidade final

Cobre: RF-10

Depende de: T-06, T-07, T-08, T-09, T-10

Aceite:
- `pnpm lint` (oxlint, oxfmt --check e typecheck) passa;
- `pnpm test` (lint, typecheck e cobertura) passa;
- nenhum teste foi removido ou enfraquecido sem substituto equivalente;
- a descrição da entrega indica a mudança como breaking (R-01) e documenta o novo formato.

Arquivos:
- nenhum arquivo novo; relatório da execução na descrição da entrega
