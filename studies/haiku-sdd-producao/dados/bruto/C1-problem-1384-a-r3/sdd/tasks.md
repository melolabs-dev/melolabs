# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-07, casos T-01 a T-12).

Convenções:
- Seguir o fluxo de correção do AGENTS.md: escrever o teste, rodar e confirmar a falha pelo motivo certo, depois implementar.
- Todos os testes novos usam `describeMatrix` (web e node).
- Decisões tomadas a partir da techspec, sujeitas a confirmação do time: P-01 (sem `message`/`data` de erro `unhandled` em debug, RF-06 do PRD será corrigido), P-02 (`handler.fetch` sem app continua no formato antigo, limitação documentada), P-03 (`unhandled` sai do corpo RFC), P-04 (sub-app usa a configuração do pai).

---

### T-01 — Opção `problemDetails` em `H3Config`

Cobre: RF-01

Depende de: nenhuma

Aceite: `app.config.problemDetails` é `false` quando a opção não é passada e `true` quando `problemDetails: true` é passado na criação. O campo tem JSDoc e aparece em `H3CoreConfig` (`expectTypeOf` em `test/unit/types.test-d.ts`). Os testes de T-01 (techspec) estão em `test/problem-details.test.ts` e falham antes da mudança.

Arquivos: `src/types/h3.ts`, `test/problem-details.test.ts` (criar), `test/unit/types.test-d.ts`

---

### T-02 — `type` e `instance` em `ErrorInput` e `HTTPError`

Cobre: RF-05

Depende de: nenhuma

Aceite: `new HTTPError({ status: 409, message: "Conflito", type: "...", instance: "/pedidos/42" })` expõe `err.type` e `err.instance` com os valores informados. Sem esses campos, ambos são `undefined`. Os campos são `readonly`, são atribuídos no construtor (também lidos de `cause`, como os demais campos) e NÃO são adicionados a `ErrorBody`. `toJSON()` não muda: um teste confirma que o corpo de `toJSON()` com `type`/`instance` informados é idêntico ao de antes. Teste de T-05 em `test/errors.test.ts` e `expectTypeOf` para `HTTPError["type"]` e `HTTPError["instance"]`.

Arquivos: `src/error.ts`, `test/errors.test.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Não-regressão do formato atual com a opção desligada

Cobre: RF-02

Depende de: T-01

Aceite: com `problemDetails` desligada (padrão), um `HTTPError` 404 retorna `Content-Type: application/json;charset=UTF-8`, corpo igual ao `toJSON()` (comparado com `JSON.parse`) e sem as chaves `type` nem `instance`. Este teste (T-02 da techspec) passa antes e depois das mudanças de T-04 em diante, e serve de trava para RF-02. Rodar também com `debug` ligado para cobrir o caso da techspec R-06.

Arquivos: `test/problem-details.test.ts`

---

### T-04 — Renderização do formato RFC 9457 em `errorResponse`

Cobre: RF-03, RF-04

Depende de: T-01, T-02

Aceite: com `problemDetails: true`, a resposta de erro tem o status do erro e `Content-Type: application/problem+json` (sem `charset`). O corpo tem `type` (valor de `HTTPError.type` ou `"about:blank"`), `title` (`statusText`, quando definido), `status`, `detail` (`message`, quando não vazia) e `instance` (quando definido). O corpo do exemplo do PRD bate com `toEqual` (T-03 e T-04 da techspec, com `debug = false`).

Implementação conforme techspec §5.3: `problemDetails` resolvido em `prepareResponse` (`config.problemDetails ?? event.app?.config.problemDetails`), `errorResponse` recebe o quarto parâmetro, `problemDetailsBody` e `problemJsonHeaders` ficam como funções internas de `src/response.ts`. Nenhum método ou export novo.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-05 — Erros não tratados não vazam detalhes

Cobre: RF-06

Depende de: T-04

Aceite: com `problemDetails: true` e `debug = false`, um `Error` comum com a mensagem "segredo do banco" gera status 500, `Content-Type: application/problem+json`, e o corpo não contém a string nem stack trace (T-06 da techspec). Com `debug = true`, o corpo tem `stack` e continua sem a string (decisão P-01). Com erro `unhandled`, `detail`, `instance`, `data`, `body` ficam fora do corpo e `type` é forçado para `"about:blank"` mesmo que o `Error` comum tenha uma propriedade `type` arbitrária (T-10 da techspec). O teste precisa limpar `t.errors = []` ao final, como `test/errors.test.ts` já faz.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-06 — Extensões do `body` e precedência dos membros da RFC

Cobre: RF-07

Depende de: T-04

Aceite: com `new HTTPError({ status: 400, message: "Campo inválido", body: { campo: "email" }, data: { tentativas: 2 } })`, o corpo tem `"campo": "email"` no nível superior e `"data": { "tentativas": 2 }`. Um `body` com `{ type: "x", status: 200 }` em erro 500 não altera `type` nem `status` (membros reservados vencem, D-05). A ordem das chaves não é contrato.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-07 — Formato problem details em todos os caminhos de renderização

Cobre: RF-08

Depende de: T-04

Aceite: (a) um middleware registrado com `app.use` que lança `HTTPError` 403 responde `application/problem+json` com status 403. (b) um `onResponse` cujo handler retorna `HTTPError` (passa por `src/utils/middleware.ts:26` sem `config`) também responde no formato novo. Esses dois casos falham antes da mudança e passam depois. A resolução via `event.app` (D-02) não altera `debug` nem `silent` nos caminhos sem `config`: um teste com `debug` ligado confirma isso (R-06). Teste de sub-app montado com `mount` e `problemDetails` diferente do pai documenta que o formato segue o app que renderiza (T-11, P-04). `src/handler.ts`, `src/utils/middleware.ts` e `src/h3.ts` não são alterados. Documentar em comentário a limitação de `handler.fetch` sem app (P-02).

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-08 — Headers do erro são preservados nos dois modos

Cobre: RF-09

Depende de: T-04

Aceite: um `HTTPError` com `headers: { "retry-after": "30" }` e status 503, com `problemDetails: true`, responde `retry-after: 30` e `Content-Type: application/problem+json`. Também com a opção desligada, o header `retry-after` continua presente e o `Content-Type` continua `application/json;charset=UTF-8`. Um `content-type` definido em `HTTPError.headers` vence o padrão (D-06). A base de headers é um `FrozenHeaders` análogo a `jsonHeaders`, e `errHeaders` do `event.res` continua aplicado depois.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-09 — Não-regressão da suíte, lint e tipos

Cobre: RF-10

Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08

Aceite: `pnpm vitest run test/problem-details.test.ts` passa. `pnpm test` (lint, typecheck e cobertura) passa sem alterar asserções de testes existentes. Se algum teste existente precisar de ajuste, o ajuste é mínimo e não remove nenhuma asserção, e a alteração é justificada no relatório. Confirmar que `test/errors.test.ts` e `test/security.test.ts` (asserções de `application/json`) passam sem mudança, e que a API pública não ganhou exports novos (`src/index.ts` intacto).

Arquivos: `test/problem-details.test.ts`, `test/errors.test.ts`, `test/security.test.ts`, `test/unit/types.test-d.ts`
