# Tarefas de implementação — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08, seção 5 para os testes).

Ordem sugerida: T-01 primeiro (testes de regressão em vermelho, conforme o "Bug Fix Workflow" do `AGENTS.md`). T-02 e T-03 podem ir em paralelo depois dele. A numeração segue essa ordem.

---

### T-01 — Testes de regressão em `describeMatrix` (vermelhos)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

**Depende de:** nenhuma

**Aceite:**
- Existe `test/problem-details.test.ts` com um caso para cada item da seção 5 da techspec: RF-01 (422 com `application/problem+json`), RF-02 (corpo do 404 com `status`, `title`, `detail`, `type: "about:blank"`; 404 do roteador com `title: "Not Found"`; 500 `unhandled` sem `statusText` com `title: "Internal Server Error"`), RF-03 (`type` e `instance` em `error` e no corpo), RF-04 (`type` herdado de `cause`), RF-05 (`message`, `data`, `body` presentes; `body: { type: "x", status: 1 }` não sobrescreve os campos RFC), RF-06 (`unhandled` sem segredo, sem `stack`, `detail: "HTTPError"`; com `debug` o `stack` aparece), RF-07 (`Retry-After` preservado; `Content-Type` informado pelo usuário vence), RF-08 (corpo e `Content-Type` iguais em `web` e `node`), RF-09 (`new H3({})` responde com `application/problem+json`).
- Rodando `pnpm vitest run test/problem-details.test.ts` antes de qualquer mudança em `src/`, os casos que dependem da mudança **falham**. Anote a lista de falhas no PR.
- O arquivo usa `describeMatrix` e `ctx.fetch`, como no `AGENTS.md`.

**Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Tabela interna de textos padrão de status

**Cobre:** RF-02

**Depende de:** nenhuma

**Aceite:**
- Existe `src/utils/internal/status-text.ts` exportando somente `getDefaultStatusText(status: number): string`. A tabela não é exportada e o arquivo não entra em `src/index.ts`.
- `getDefaultStatusText(400)` retorna `"Bad Request"`, `404` retorna `"Not Found"`, `500` retorna `"Internal Server Error"`, e um código fora da tabela (ex.: `599`) retorna `"Unknown Error"`.
- `test/unit/status-text.test.ts` cobre esses quatro casos e passa com `pnpm vitest run test/unit/status-text.test.ts`.
- O arquivo não importa `node:http` (regra de web standards do `AGENTS.md`).

**Arquivos:** `src/utils/internal/status-text.ts`, `test/unit/status-text.test.ts`

---

### T-03 — Campos `type` e `instance` em `ErrorBody` e `HTTPError`

**Cobre:** RF-03, RF-04, RF-09

**Depende de:** T-01

**Aceite:**
- `ErrorBody` em `src/error.ts` ganha `type?: string` e `instance?: string`, com o comentário JSDoc da techspec (D-04). `ErrorInput` os recebe por `Partial<ErrorBody>`, sem mudança extra.
- A classe `HTTPError` ganha `readonly type: string | undefined` e `readonly instance: string | undefined`.
- No construtor, `type` e `instance` são lidos de `details` e, na falta, de `details.cause`, usando `||` (string vazia cai em `undefined`), no mesmo padrão de `status` e `statusText`.
- `new HTTPError({ status: 403, type, instance })` expõe `error.type` e `error.instance`. `new HTTPError({ status: 500, cause: { status: 409, type } })` expõe `error.type` herdado do `cause`.
- Os casos de RF-03 e RF-04 de `test/problem-details.test.ts` passam. A assinatura de `HTTPError.status(...)` e de `H3Config` não muda.

**Arquivos:** `src/error.ts`

---

### T-04 — `HTTPError.toJSON()` com membros RFC

**Cobre:** RF-02, RF-05, RF-06

**Depende de:** T-01, T-02, T-03

**Aceite:**
- `toJSON()` retorna `statusText`, `unhandled`, `message`, `data`, `...body` e, **depois** do `...body`, `status`, `title`, `detail`, `type` e `instance` (D-02). Para `title`, usa `statusText ?? getDefaultStatusText(status)`. `detail` recebe o valor de `message`. `type` é `type || "about:blank"`.
- O tipo de retorno é o alias local `ErrorJSON` (não exportado), e o `toJSON()` tem anotação explícita, para que `isolatedDeclarations` aceite.
- Para erro `unhandled`: `message` e `detail` valem `"HTTPError"`, `data`, `body` e `instance` somem, `type` vira `"about:blank"` (D-05). Confirme essa escolha no PR (pergunta 1 da techspec, seção 7).
- Teste: `body: { type: "x", status: 1 }` não sobrescreve `type` nem `status` no corpo final (RF-05).
- Os casos de RF-02, RF-05 e RF-06 de `test/problem-details.test.ts` passam. Os testes de `test/errors.test.ts` que usam `toMatchObject` (linhas 53-57, 79-85, 99-104, 119-121) continuam passando sem alteração.

**Arquivos:** `src/error.ts`

---

### T-05 — `problemHeaders` no caminho de erro de `src/response.ts`

**Cobre:** RF-01, RF-07, RF-08

**Depende de:** T-01, T-04

**Aceite:**
- Existe a constante `problemHeaders` em `src/response.ts`, logo após `jsonHeaders` (linhas 270-272), com a forma `FrozenHeaders` e `"content-type": "application/problem+json"`, como em D-01.
- `errorResponse` (linhas 358-380) usa `mergeHeaders(problemHeaders, error.headers)`. `jsonHeaders` continua igual e continua servindo as respostas de sucesso.
- Erro 422 responde com `application/problem+json`. Erro 404 do roteador também. `headers: { "Retry-After": "30" }` mantém o header e o `Content-Type` padrão. `headers: { "Content-Type": "text/plain" }` vence.
- Os casos de RF-01, RF-07 e RF-08 de `test/problem-details.test.ts` passam nos modos `web` e `node`.
- `test/security.test.ts:556` (resposta 200 com `application/json;charset=UTF-8`) continua passando, o que confirma que o sucesso não mudou.

**Arquivos:** `src/response.ts`

---

### T-06 — Ajuste das asserções de `Content-Type` em `test/errors.test.ts`

**Cobre:** RF-01

**Depende de:** T-05

**Aceite:**
- Linha 44: `"application/json;charset=UTF-8"` vira `"application/problem+json"`.
- Linha 140: `toMatch("application/json")` vira `toMatch("application/problem+json")`.
- Nenhuma outra asserção do arquivo muda. Não houve ajuste em testes de JSON-RPC ou SSE, porque eles não dependem do `Content-Type` HTTP de erro (techspec, seção 3 e 5).
- `pnpm vitest run test/errors.test.ts` passa.

**Arquivos:** `test/errors.test.ts`

---

### T-07 — Asserções de tipo para `type`, `instance` e ausência de opção nova

**Cobre:** RF-03, RF-09

**Depende de:** T-03

**Aceite:**
- `test/unit/types.test-d.ts` verifica que `error.type` e `error.instance` são `string | undefined`.
- Verifica que `ErrorInput` aceita `type` e `instance`.
- Verifica que `H3Config` não tem chave nova relacionada a formato de erro (RF-09). Se a asserção exigir, use `expectTypeOf<keyof H3Config>()` com a lista atual de chaves.
- `pnpm typecheck` passa com esse arquivo.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-08 — Verificação final da entrega

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

**Depende de:** T-06, T-07

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts test/errors.test.ts test/unit/status-text.test.ts` passa.
- `pnpm vitest run test/security.test.ts test/router.test.ts test/validate.test.ts` passa.
- `pnpm vitest run` (suíte completa) passa.
- `pnpm typecheck` e `pnpm lint` passam.
- `pnpm build` gera `dist/*.d.mts` sem erro de `isolatedDeclarations`.
- `pnpm test` (lint, typecheck e cobertura) passa. Se algo falhar, a saída vai no PR, sem resumo que esconda a falha.
- A lista de ajustes em testes existentes (T-06) e as duas perguntas em aberto da techspec (seção 7) estão no texto do PR.

**Arquivos:** nenhum arquivo alterado; a tarefa só executa os comandos acima.
