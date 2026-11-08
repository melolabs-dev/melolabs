# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09).

Ordem de trabalho: testes primeiro (T-01 a T-04), confirmando que falham antes de qualquer código de produção, depois a implementação (T-05 a T-09) e a verificação final (T-10). Isso segue o fluxo de correção do `AGENTS.md`.

Mapa de cobertura dos requisitos:

| Requisito | Tarefas |
|---|---|
| RF-01 | T-02, T-06 |
| RF-02 | T-04, T-06 |
| RF-03 | T-02, T-08 |
| RF-04 | T-02, T-05, T-08 |
| RF-05 | T-03, T-08 |
| RF-06 | T-01, T-10 |
| RF-07 | T-01, T-03, T-09 |
| RF-08 | T-03, T-09 |
| RF-09 | T-03, T-10 |
| RF-10 | T-04, T-07 |
| RF-11 | T-02, T-06 |

---

### T-01 — Fixar o formato atual de erros que não usam `problem`

Cobre: RF-06, RF-07
Depende de: nenhuma
Aceite: em `test/problem.test.ts` (novo, `describeMatrix`), os casos `new HTTPError({ status: 404, message: "Nada aqui" })`, `HTTPError.status(...)` e `new Error("segredo do banco")` passam **antes** de qualquer mudança em `src/`. O corpo é comparado com o JSON atual (`status`, `statusText`, `unhandled`, `message`, `data`) e o `Content-Type` com `application/json`. Os casos rodam em `web` e `node`.
Arquivos: `test/problem.test.ts`

### T-02 — Testes de retorno, corpo padrão, título e status inválido

Cobre: RF-01, RF-03, RF-04, RF-11
Depende de: T-01
Aceite: no mesmo `test/problem.test.ts`, casos que devem **falhar** antes da implementação (`problem` ainda não existe):
- `problem({ status: 404, message })` retorna `HTTPError` com `status` 404 e `HTTPError.isError` verdadeiro, testado com `throw` e com `return`.
- `throw problem({ status: 403, message, type, instance })` → status 403, `content-type` exatamente `application/problem+json`, corpo com `type`, `status`, `detail`, `instance` e `title`.
- `problem({ status: 409 })` → `type` `"about:blank"`, `status` 409, `title` `"Conflict"`, sem chave `instance` e sem chave `detail`.
- `statusText` informado vence a frase padrão; status sem frase (ex.: 499) não gera `title`.
- `problem({ status: 42, message: "x" })` → status HTTP 500 e `status` 500 no corpo.
Arquivos: `test/problem.test.ts`

### T-03 — Testes de extensões, erros não tratados, headers e hooks

Cobre: RF-05, RF-07, RF-08, RF-09
Depende de: T-01
Aceite: casos em `test/problem.test.ts` que devem falhar antes da implementação:
- `problem({ status: 422, message: "Inválido", body: { campos: ["email"], status: 999 } })` → `campos` no topo do corpo e `status` 422. Também `type`, `title`, `detail` e `instance` vindos de `body` são ignorados.
- `problem({ status: 503, message: "segredo", unhandled: true, body: { x: 1 } })` → status 500, `application/problem+json`, sem `detail` nem `x`, `title` `"Internal Server Error"`. Com `debug: true`, `stack` aparece.
- `problem({ status: 401, message: "Token expirado", headers: { "WWW-Authenticate": "Bearer" } })` → header presente e `content-type` `application/problem+json`. Com `headers: { "content-type": "text/plain" }`, o `content-type` continua `application/problem+json`. `event.res.errHeaders` continua mesclado.
- `onError` registrado recebe um `HTTPError` com `status` 400 e `message` "x" quando o handler faz `throw problem({ status: 400, message: "x" })`. `onResponse` é chamado uma vez.
Arquivos: `test/problem.test.ts`

### T-04 — Testes de tipo e snapshot da superfície pública

Cobre: RF-02, RF-10
Depende de: T-01
Aceite:
- `test/unit/types.test-d.ts`, com `expectTypeOf`: `problem({ status: 400, type: "x", instance: "/y" })` retorna `HTTPError`; `ProblemInput` aceita `type` e `instance`; `new HTTPError({ status: 400, type: "x" })` segue sendo erro de tipo (`// @ts-expect-error`). Falha antes da implementação.
- `test/unit/package.test.ts`: o snapshot inline inclui `"problem"` entre `"parseCookies"` e `"proxy"`, e nada mais. Falha antes da implementação.
Arquivos: `test/unit/types.test-d.ts`, `test/unit/package.test.ts`

### T-05 — Tabela interna de frases de status

Cobre: RF-04
Depende de: T-02
Aceite: existe `src/utils/internal/status-text.ts` exportando `getReasonPhrase(status: number): string | undefined`, com as frases do registro IANA para 4xx e 5xx. `getReasonPhrase(409) === "Conflict"`, `getReasonPhrase(499) === undefined` e `getReasonPhrase(200) === undefined`. A tabela `STATUS_TEXT` de `src/utils/response.ts` não é alterada, então `noContent` e `redirect` mantêm o comportamento atual. O arquivo passa em `pnpm lint`.
Arquivos: `src/utils/internal/status-text.ts`

### T-06 — `ProblemInput`, marca interna e `problem()` em `error.ts`

Cobre: RF-01, RF-02, RF-10, RF-11
Depende de: T-02, T-04
Aceite: em `src/error.ts`, ao fim do arquivo:
- `ProblemMembers` (interface) e `kProblem = Symbol.for("h3.problem")`, ambos não exportados por `src/index.ts`.
- `ProblemInput extends ErrorInput` com `type?` e `instance?`. `ErrorInput` não muda.
- `problem(input)` separa `type` e `instance` de `details`, cria `new HTTPError(details)` e define `kProblem` com `Object.defineProperty`, não enumerável, guardando `detail: input.message`, `type` e `instance`.
- Os testes de T-02 de retorno e status 42 → 500 passam; os de T-04 de tipo passam.
- `HTTPError.cause` não recebe `type` nem `instance`.
Arquivos: `src/error.ts`

### T-07 — Reexportar `problem` e `ProblemInput` em `src/index.ts`

Cobre: RF-10
Depende de: T-04, T-06
Aceite: `src/index.ts` reexporta `type ProblemInput` e `problem` no bloco de `./error.ts` (linha ~72). O snapshot de `test/unit/package.test.ts` passa. A comparação da lista de exports antes e depois mostra apenas `problem` (`ProblemInput` é tipo e não aparece no snapshot). `kProblem` e `ProblemMembers` não aparecem.
Arquivos: `src/index.ts`

### T-08 — Renderização `application/problem+json` em `errorResponse`

Cobre: RF-03, RF-04, RF-05
Depende de: T-02, T-03, T-05, T-06
Aceite: em `src/response.ts`, `errorResponse` ganha o ramo de problema, com a função `toProblemJSON` (D-03):
- Quando `error[kProblem]` existe, o `content-type` é `application/problem+json`, `error.headers` é copiado antes de o `content-type` ser definido (D-04) e `errHeaders` é mesclado com `mergeHeaders`.
- Ordem do corpo: `...body` primeiro; `type` (padrão `"about:blank"`), `title` (`statusText` ou frase de `getReasonPhrase`, omitido se não houver), `status`, `detail` (só se houver `message`) e `instance` (só se informado) por último, vencendo `body`.
- Caminho sem a marca fica intacto. `prepareResponse` e `HTTPError.prototype.toJSON` não mudam.
- Os testes de T-02 e os de T-03 de extensões passam; os casos de `unhandled` de T-03 ainda podem falhar até T-09.
Arquivos: `src/response.ts`

### T-09 — Erros `unhandled` e headers em problema

Cobre: RF-07, RF-08
Depende de: T-08
Aceite: quando `error.unhandled` é verdadeiro e a marca existe (D-05):
- status HTTP e `status` no corpo são 500; `title` é a frase de 500; `detail` e `body` não aparecem; `type` e `instance` permanecem.
- `stack` só aparece com `debug`.
- Os casos de RF-07 e RF-08 de T-03 passam, e o teste `new Error("segredo do banco")` de T-01 continua passando (caminho antigo).
Arquivos: `src/response.ts`

### T-10 — Verificação de regressão e qualidade final

Cobre: RF-06, RF-09 (verificação final de RF-06 e RF-09 já escritos em T-01 e T-03)
Depende de: T-09
Aceite:
- `pnpm vitest run test/errors.test.ts` passa sem alterar nenhum teste existente. Se algum teste existente mudar, é regressão no caminho antigo e não ajuste de teste.
- `pnpm vitest run test/problem.test.ts test/unit` passa em `web` e `node`.
- `pnpm vitest run` (suite completa) passa.
- `pnpm typecheck` e `pnpm lint` (inclui `oxfmt --check`) passam.
- Diff de `test/` contém somente `test/problem.test.ts` (novo), `test/unit/types.test-d.ts` e o snapshot de `test/unit/package.test.ts`.
Arquivos: nenhum arquivo novo; verificação sobre `test/errors.test.ts`, `test/problem.test.ts`, `test/unit/package.test.ts`, `test/unit/types.test-d.ts`

---

## Pendências para confirmação antes de T-06 e T-08

Estas são as decisões em aberto do `sdd/techspec.md`. A implementação segue as recomendações, e cada uma é uma linha de mudança se o time decidir de outra forma:

1. D-07: `detail` só com `message` explícito (recomendado, usado em T-06 e T-08) ou o `message` calculado pelo construtor.
2. D-08: `data` fora do corpo de problema (recomendado, usado em T-08) ou como extensão.
3. D-05: `instance` mantido em erros `unhandled` (recomendado, usado em T-09) ou ocultado.

Fora desta lista: README (opcional no PRD) e Nitro, `h3/rules` e outros pacotes, que estão fora de escopo.
