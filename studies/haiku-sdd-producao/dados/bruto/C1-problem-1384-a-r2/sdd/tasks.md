# Tarefas: problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (D-01 a D-08).

Ordem de execução: seguir o fluxo de teste da techspec (seção "Estratégia de testes"). Em cada tarefa, escrever os testes primeiro, confirmar que falham e só então implementar. As decisões marcadas como "a confirmar" no PRD e na techspec seguem a proposta da techspec até o time decidir de outro modo.

Cobertura dos requisitos:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04 |
| RF-02 | T-03, T-04, T-06 |
| RF-03 | T-01 |
| RF-04 | T-07 |
| RF-05 | T-08 |
| RF-06 | T-09 |

---

### T-01 — Campos `type` e `instance` em `HTTPError`

- **Cobre:** RF-03
- **Depende de:** nenhuma
- **Aceite:** com `new HTTPError({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })`, `error.type` e `error.instance` retornam os valores informados. Sem os campos, ambos são `undefined`. `toJSON()` e as propriedades `status`, `statusText`, `message`, `data` e `body` têm o mesmo resultado de antes. Os testes unitários novos (`test/unit/error.test.ts`) falham antes da mudança e passam depois. Os tipos de `ErrorInput.type`/`instance` (como `string` opcional) e de `HTTPError.type`/`instance` (`string | undefined`, somente leitura) são verificados em `test/unit/types.test-d.ts`.
- **Arquivos:** `src/error.ts`, `test/unit/error.test.ts` (novo), `test/unit/types.test-d.ts`

---

### T-02 — Opção `problemDetails` em `H3Config`

- **Cobre:** RF-01
- **Depende de:** nenhuma
- **Aceite:** `H3Config` aceita `problemDetails?: boolean`, herdado por `H3CoreConfig`, e o tipo é verificado em `test/unit/types.test-d.ts`. Teste de regressão em `test/problem-details.test.ts` com `describeMatrix`: aplicação sem a opção responde a erro com `Content-Type` `application/json;charset=UTF-8` e as mesmas chaves de hoje (`status`, `statusText`, `unhandled`, `message`, `data`), reaproveitando as asserções de `test/errors.test.ts`. O teste de regressão passa antes e depois da mudança.
- **Arquivos:** `src/types/h3.ts`, `test/problem-details.test.ts` (novo), `test/unit/types.test-d.ts`

---

### T-03 — Helper interno `toProblemDetails`

- **Cobre:** RF-02
- **Depende de:** T-01
- **Aceite:** a função `toProblemDetails(error)` monta os membros da RFC a partir de `error.toJSON()`: `type` (`error.type` ou `"about:blank"`), `title` (`statusText`), `status`, `detail` (`message`) e `instance` (`error.instance`). `data` e `body` continuam no nível superior. Quando o erro é `unhandled`, `type` e `instance` são omitidos (D-05). Os membros da RFC vencem em colisão com `body` (D-03). Teste unitário cobre cada campo, a colisão e o caso `unhandled`. Quando `statusText` estiver vazio, `title` fica ausente (proposta da techspec, a confirmar). A função não é exportada por `src/index.ts`.
- **Arquivos:** `src/utils/internal/problem-details.ts` (novo), `test/unit/problem-details.test.ts` (novo)

---

### T-04 — Renderização de erro em `errorResponse` com `config`

- **Cobre:** RF-01, RF-02
- **Depende de:** T-02, T-03
- **Aceite:** `errorResponse(error, config, errHeaders)` recebe `config` inteiro, no lugar de `config.debug`, e `prepareResponse` passa `config` (D-01). Com `problemDetails: true`, a resposta usa `Content-Type` `application/problem+json`, sem `charset` (D-06), e o corpo vem de `toProblemDetails`. Sem a opção, o caminho atual não muda. Teste de `test/problem-details.test.ts` com `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`: status 404, `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail: "Usuário não encontrado"`. Teste de rota inexistente: 404 com `application/problem+json` e `detail` descrevendo a rota. `HEAD` para rota ausente continua com corpo vazio e sem `content-length` (teste 11 da techspec).
- **Arquivos:** `src/response.ts`, `test/problem-details.test.ts`

---

### T-05 — Caminhos de renderização sem `config` (D-07 e D-08)

- **Cobre:** RF-02
- **Depende de:** T-04
- **Aceite:** em `src/utils/middleware.ts` (`onResponse`) e `src/rules/cache.ts` (`toResponse` do ocache), o `toResponse` passa `{ problemDetails: event.app?.config.problemDetails }`, sem passar o `config` inteiro, para não ativar `debug` nesses caminhos. Testes: (a) `onResponse` com handler que retorna `HTTPError` (sem lançar) sai em problem details; (b) erro retornado sob regra de cache em `test/rules/cache.test.ts` sai em problem details; (c) `defineHandler(...).fetch(url)` com erro segue no formato atual, e o teste documenta isso como comportamento esperado; (d) hook `onError` que retorna um `HTTPError` novo é renderizado em problem details (D-08). Todos passam após a implementação.
- **Arquivos:** `src/utils/middleware.ts`, `src/rules/cache.ts`, `test/problem-details.test.ts`, `test/rules/cache.test.ts`

---

### T-06 — Corpo problem details para `HTTPError` e colisão de campos

- **Cobre:** RF-02
- **Depende de:** T-04
- **Aceite:** com a opção ligada, `HTTPError` com `type` e `instance` informados aparece no corpo com esses valores. `body: { title: "x", status: 999 }` tem `title` e `status` da RFC prevalecendo, e o restante de `body` continua no topo do JSON (D-03, teste 7 da techspec). `HTTPError` sem `statusText` não tem `title` no corpo. O `Content-Type` é `application/problem+json` em todos esses casos.
- **Arquivos:** `test/problem-details.test.ts`

---

### T-07 — Erros não tratados sem vazamento de detalhes

- **Cobre:** RF-04
- **Depende de:** T-04
- **Aceite:** com `problemDetails: true` e `debug` desligado, `new Error("segredo do banco")` resulta em 500 com `application/problem+json`. O corpo não contém `"segredo do banco"` nem `stack`, e `detail` é `"HTTPError"`. Com `debug: true` (teste de matriz com `t.app.config.debug = true` ou app própria), o corpo contém `stack` como lista de linhas, igual ao formato atual. Os testes cobrem os dois modos, conforme a seção 5 da techspec. Se algum caminho vazar `message` ou `stack`, a correção fica em `toProblemDetails`, que só lê via `toJSON()`.
- **Arquivos:** `test/problem-details.test.ts`, `src/utils/internal/problem-details.ts` (somente se um teste acusar vazamento)

---

### T-08 — Headers de erro preservados

- **Cobre:** RF-05
- **Depende de:** T-04
- **Aceite:** com `problemDetails: true`, um `HTTPError` criado com `headers: { "WWW-Authenticate": "Bearer" }` resulta em resposta com `WWW-Authenticate: Bearer` e `Content-Type` `application/problem+json`. Com `event.res.errHeaders` contendo `set-cookie`, o cookie aparece uma única vez na resposta (regressão do comentário em `src/response.ts`, por volta da linha 167). Um `content-type` explícito em `HTTPError.headers` continua vencendo, como hoje. Os testes passam também sem a opção, para confirmar que nada mudou.
- **Arquivos:** `test/problem-details.test.ts`, `src/response.ts` (somente se o teste acusar header duplicado ou perdido)

---

### T-09 — Verificação final e compatibilidade da suíte

- **Cobre:** RF-06
- **Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
- **Aceite:** `pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts test/unit/problem-details.test.ts` passa. Depois, `pnpm vitest run` completo passa sem alterar asserções existentes além das que dependem diretamente da opção ligada (na prática, nenhuma, já que o padrão é desligado). `pnpm lint` passa. Como `pnpm lint` é `oxlint . && oxfmt --check .`, também é preciso rodar `pnpm typecheck` (o script `typecheck` em `package.json`). Nenhum teste existente foi removido. Se algum teste existente falhar, a causa é bug desta mudança e deve ser corrigida no código, não no teste.
- **Arquivos:** nenhum arquivo novo; apenas execução de `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
