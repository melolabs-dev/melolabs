# Tarefas — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-12).

## Ordem e premissas

- Seguir o fluxo de correção do `AGENTS.md`: primeiro os testes de regressão (T-01), depois a implementação. Os testes de T-01 precisam falhar antes de T-02 a T-07.
- Pendências da spec (ver `techspec.md`, seção "Pendências"). Enquanto o autor não confirmar, as tarefas seguem a proposta da spec:
  - `unhandled` sai do corpo (D-07), sem extensão.
  - Código fora da tabela de frases e sem `statusText` fica sem `title` (D-04).
  - `detail` é sempre enviado para erro tratado (D-05).
  - Membros RFC têm precedência sobre `body` (D-08).
  - `pnpm typecheck` roda junto com `pnpm lint` (T-11).

---

### T-01 — Escrever testes de regressão do formato problem details

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07

Depende de: nenhuma

Aceite: os casos novos em `describe("problem details (RFC 9457)")`, dentro de `describeMatrix`, existem para RF-01, RF-03 a RF-07 e D-08 e D-04. Rodando `pnpm vitest run test/errors.test.ts` antes das demais tarefas, esses casos falham pelo formato antigo (`application/json`, `message`, `statusText`).

Arquivos: `test/errors.test.ts`

---

### T-02 — Criar tabela de frases RFC 9110 (`reasonPhrase`)

Cobre: RF-01, RF-07

Depende de: nenhuma

Aceite: `src/utils/internal/status-text.ts` exporta `reasonPhrase(status: number): string | undefined`, com a tabela cobrindo 400–431, 451, 500–505, 507, 508 e 511, incluindo 400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502 e 504. `reasonPhrase(422)` retorna `"Unprocessable Content"` e `reasonPhrase(499)` retorna `undefined`. `src/utils/response.ts` não muda.

Arquivos: `src/utils/internal/status-text.ts`

---

### T-03 — Escrever testes unitários de `type`, `instance`, `toJSON()` e `reasonPhrase`

Cobre: RF-02, RF-03

Depende de: T-02

Aceite: `test/unit/error.test.ts` (novo) cobre: `error.type` e `error.instance` com `new HTTPError({ status: 403, type, instance })`; herança de `type` e `instance` a partir de `cause`; `toJSON()` para cada código da tabela que `h3` usa; `reasonPhrase(499)` é `undefined` e `reasonPhrase(422)` é `"Unprocessable Content"`. Os testes falham antes de T-04 e T-05.

Arquivos: `test/unit/error.test.ts`

---

### T-04 — Adicionar `type` e `instance` a `ErrorInput` e `HTTPError`

Cobre: RF-02, RF-03

Depende de: T-03

Aceite: `ErrorInput` aceita `type?: string` e `instance?: string`, com comentário de uma linha cada. `HTTPError` expõe `readonly type` e `readonly instance`, lidos de `details` ou de `details.cause`, no mesmo padrão de `headers`. A interface `ProblemDetails` fica local, sem `export`, e `src/index.ts` não muda. Os testes de T-03 relacionados a `type`/`instance` passam. `pnpm typecheck` não acusa erro.

Arquivos: `src/error.ts`

---

### T-05 — Reescrever `HTTPError.toJSON()` como corpo problem details

Cobre: RF-01, RF-03, RF-04, RF-05, RF-07

Depende de: T-02, T-04

Aceite: `toJSON()` devolve `type` (padrão `"about:blank"`), `title` (`statusText` ou `reasonPhrase`; para `unhandled`, só `reasonPhrase`), `status`, `detail` (só para erro tratado), `instance` (ausente quando indefinido), `data` (só para erro tratado) e as chaves de `body` (espalhadas antes dos membros RFC, sem `unhandled`). Os testes de T-01 e T-03 sobre o corpo passam. Quando `unhandled: true`, a mensagem interna e `data` não aparecem no JSON. A doc de `message` em `src/error.ts` passa a mencionar `detail`.

Arquivos: `src/error.ts`

---

### T-06 — Trocar o `Content-Type` de erro para `application/problem+json`

Cobre: RF-01, RF-06

Depende de: T-05

Aceite: `problemHeaders` (`content-type: application/problem+json`, sem `charset`) existe em `src/response.ts` após `FrozenHeaders`. `errorResponse()` usa `problemHeaders` e mantém os headers de `error.headers` (ex.: `WWW-Authenticate`) e o `stack` apenas em debug. `jsonHeaders` continua no caminho de sucesso. Os testes de RF-01 e RF-06 de T-01 passam.

Arquivos: `src/response.ts`

---

### T-07 — Cobrir vazamento nos caminhos de erro de sistema

Cobre: RF-04, RF-07

Depende de: T-06

Aceite: `test/errors.test.ts` tem casos para erro não-`HTTPError` lançado por handler e para erro não tratado vindo de `toError()` e de `onError`. Em todos, o corpo não contém a mensagem interna nem o `token=secret` de um erro vindo de `foreign` (reaproveitar `test/errors.test.ts:339-353`). `title` é `"Internal Server Error"`. Os casos passam.

Arquivos: `test/errors.test.ts`

---

### T-08 — Ajustar asserções existentes em `errors.test.ts`, `handler.test.ts`, `validate.test.ts`, `route.test.ts`, `body.test.ts` e `app.test.ts`

Cobre: RF-08

Depende de: T-06, T-07

Aceite: as linhas listadas na `techspec.md` (seção "Testes existentes que mudam") nesses arquivos trocam `statusText` por `title`, `message` por `detail`, `unhandled` por `type`/`title`, e `application/json` por `application/problem+json`. Nenhum teste é removido e nenhuma verificação é enfraquecida; `stack[0]` em `test/body.test.ts:458` continua verificado. `pnpm vitest run test/errors.test.ts test/handler.test.ts test/validate.test.ts test/route.test.ts test/body.test.ts test/app.test.ts` passa.

Arquivos: `test/errors.test.ts`, `test/handler.test.ts`, `test/validate.test.ts`, `test/route.test.ts`, `test/body.test.ts`, `test/app.test.ts`

---

### T-09 — Ajustar asserções em `body-limit`, `dist`, `rules/cache`, `router` e `proxy`; verificar cache de erros

Cobre: RF-08, RF-01

Depende de: T-06, T-07

Aceite: `test/body-limit.test.ts:122`, `test/dist.test.ts:57`, `test/rules/cache.test.ts:251`, `test/router.test.ts:110` e `test/proxy.test.ts:1027-1028` são ajustados para `detail`/`title`, sem remover verificação. Em `test/rules/cache.test.ts`, um caso com erro cacheado confirma que a resposta servida tem o `application/problem+json` novo. Não mudam: `test/validate.test.ts:161-163`, `test/auth.test.ts`, `test/middleware.test.ts:143`, `test/security.test.ts:540-556`, `test/json-rpc*.test.ts`, `test/unit/cookie-validation.test.ts:68` e `test/mount.test.ts`. Os arquivos passam com `pnpm vitest run` nos caminhos citados. `test/dist.test.ts` só roda após `pnpm build` (ver T-12).

Arquivos: `test/body-limit.test.ts`, `test/dist.test.ts`, `test/rules/cache.test.ts`, `test/router.test.ts`, `test/proxy.test.ts`

---

### T-10 — Atualizar a documentação de erros

Cobre: RF-01, RF-02, RF-03, RF-05

Depende de: T-06

Aceite: `docs/1.guide/1.basics/6.error.md` mostra o exemplo de corpo `application/problem+json` (`type`, `title`, `status`, `detail`, `instance`), lista os campos novos (`type`, `instance`) e a extensão `data`/`body`, e a nota de mascaramento (`:90`) descreve o corpo de erro não tratado. `CHANGELOG.md` não é editado.

Arquivos: `docs/1.guide/1.basics/6.error.md`

---

### T-11 — Checar lint e tipos

Cobre: RF-09

Depende de: T-08, T-09, T-10

Aceite: `pnpm lint` (oxlint + oxfmt --check) termina com sucesso, e `pnpm typecheck` (`tsc --noEmit`, `package.json:54`) também. Se houver falha de formatação ou de tipo nos arquivos da mudança, ela é corrigida nesses arquivos. Caso `pnpm typecheck` não exista ou falhe por motivo fora desta mudança, registrar a saída no PR.

Arquivos: nenhum arquivo novo; corrige apenas os arquivos das tarefas T-02 a T-10 se o lint acusar problema.

---

### T-12 — Rodar a suíte completa e o build

Cobre: RF-08

Depende de: T-11

Aceite: `pnpm vitest run` passa por completo. `pnpm build` roda e, em seguida, `pnpm vitest run test/dist.test.ts` passa (o teste é pulado sem `dist/`). Nenhum teste foi removido nem teve asserção enfraquecida em relação a `main` (checar o diff de `test/`).

Arquivos: nenhum arquivo alterado; verificação apenas (`test/**`, `dist/`).
