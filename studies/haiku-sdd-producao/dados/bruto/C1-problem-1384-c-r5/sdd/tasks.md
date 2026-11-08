# Tarefas — Problem details (RFC 9457) por `problem()`

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-11, seção 8 com decisões a confirmar).

Ordem sugerida: T-01 e T-02 em paralelo; depois T-03 e T-04; testes (T-05) antes da implementação de resposta (T-06). A techspec pede testes escritos antes e confirmados em vermelho.

---

### T-01 — Tabela de frases padrão

**Cobre:** RF-03

**Depende de:** nenhuma

**Aceite:** `defaultStatusText(404)` devolve `"Not Found"`, `defaultStatusText(422)` devolve `"Unprocessable Content"` (frase IANA atual), e um código sem frase registrada (por exemplo `599` ou `299`) devolve `undefined`. Cobrir com teste unitário em `test/unit/`. Nenhum import de `node:http`.

**Arquivos:** `src/utils/internal/status-text.ts`

---

### T-02 — Marca interna do erro criado por `problem`

**Cobre:** RF-01, RF-07

**Depende de:** nenhuma

**Aceite:** `setProblem` grava `kProblem = Symbol.for("h3.problem")` como propriedade não enumerável do próprio erro, e `getProblem` devolve o `ProblemMeta` só do erro recebido. Verificação: `getProblem(new HTTPError({ cause: problem(...) }))` devolve `undefined` (D-03), `Object.keys(erro)` não contém a marca, e `PROBLEM_CONTENT_TYPE` vale `"application/problem+json"`. Comentário no símbolo referenciando o padrão de `src/response.ts:88-94`.

**Arquivos:** `src/utils/internal/problem-body.ts`

---

### T-03 — Montagem do corpo problem+json

**Cobre:** RF-03, RF-04, RF-05

**Depende de:** T-01, T-02

**Aceite:** `toProblemBody` monta `{ ...extensões, ...membrosReservados }`:
- `type` vem de `meta.type` ou `"about:blank"`; `title` vem de `error.statusText ?? defaultStatusText(status) ?? "HTTPError"`; `status` vem do erro; `detail` vem de `message`; `instance` só entra quando informado.
- `body` é espalhado no topo e `data` vira membro `data`; membros reservados são aplicados por último, então `body: { status: 200, title: "x" }` não os altera.
- Com `unhandled: true`: `detail` é `"HTTPError"`, sem `data`, sem `body` e sem `instance` (D-09), `status` e `title` mantidos.
- `stack` só com `debug` e com a mesma regra de `src/response.ts:369`.
- Não usa `error.toJSON()` (D-07).

Verificação por teste unitário de `toProblemBody` com os casos acima; os casos de ponta a ponta ficam em T-05.

**Arquivos:** `src/utils/internal/problem-body.ts`

---

### T-04 — Utilitário público `problem()` e tipo `ProblemInput`

**Cobre:** RF-01, RF-02

**Depende de:** T-02

**Aceite:** `problem({ status: 404, message: "Usuário não encontrado" })` devolve `HTTPError` com esses `status` e `message`, e `HTTPError.isError` aceita o retorno. `problem({ ..., type, instance })` remove `type` e `instance` da entrada antes de criar o erro, grava-os com `setProblem` e não cria campos `type`/`instance` em `HTTPError`. `ProblemInput` estende `ErrorInput` com `type?` e `instance?` opcionais (D-02, D-10). Nome `ProblemInput` mantido como proposta, sujeita à decisão 1 da techspec.

**Arquivos:** `src/utils/problem.ts`

---

### T-05 — Testes ponta a ponta de `problem` (escritos antes da implementação)

**Cobre:** RF-03, RF-04, RF-05, RF-06, RF-07, RF-09

**Depende de:** T-04

**Aceite:** `test/problem.test.ts` usa `describeMatrix` (`test/_setup.ts:11`) e roda em `web` e `node`. Cobre:
- RF-03: com `statusText`; sem `statusText` (frase padrão); código sem frase (`"HTTPError"`); `type` ausente (`about:blank`); `instance` ausente (chave ausente). Status, `Content-Type` e corpo conferidos.
- RF-04: `body` no topo, `data` como membro, `body: { status: 200, title: "x", codigo: "X1" }` sem alterar `status` e `title`.
- RF-05: `unhandled: true` sem `data`, sem `body`, `detail === "HTTPError"`, `status` mantido, sem `instance`. Usar `t.errors = []` e `consoleMock` como em `test/errors.test.ts:7,116`.
- RF-06: `WWW-Authenticate` aplicado; `Content-Type` forçado mesmo com `headers: { "Content-Type": "text/plain" }`; também com `event.res.errHeaders.set("content-type", ...)` e `set-cookie` acumulado.
- RF-07: `HTTPError.status(404, "Not Found", {...})` mantém formato atual (sem `application/problem+json`, com `status`, `statusText`, `message`, `data`); `new HTTPError({ cause: problem(...) })` não vira problem+json.
- Debug: `stack` igual ao ramo comum.
- `onError`: hook recebe o erro marcado; hook que retorna `undefined` mantém problem+json; hook que retorna `Response` usa esse `Response`.
- `HEAD`: status e `Content-Type` corretos, corpo vazio.

Antes de T-06, rodar `pnpm vitest run test/problem.test.ts` e confirmar que os casos de RF-03 a RF-06 falham. Os de RF-07 podem passar, porque descrevem o comportamento atual.

**Arquivos:** `test/problem.test.ts`

---

### T-06 — Ramo problem+json em `errorResponse`

**Cobre:** RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** T-03, T-05

**Aceite:** `errorResponse` em `src/response.ts:358-380` chama `getProblem(error)` e, quando há marca, monta cabeçalhos na ordem de D-06 (base `problemHeaders` → `error.headers` → `errHeaders` → `content-type` fixado por último) e corpo por `toProblemBody`. Erros comuns seguem o ramo atual sem mudança. `prepareResponse` e a limpeza de `kEventRes` (`src/response.ts:172-173`) não mudam. Todos os casos de T-05 passam nos dois modos. `src/error.ts` não é alterado. `src/response.ts` continua o único ponto de renderização (D-05).

**Arquivos:** `src/response.ts`

---

### T-07 — Export público em `src/index.ts`

**Cobre:** RF-01, RF-02

**Depende de:** T-04

**Aceite:** `src/index.ts` exporta `problem` e `type ProblemInput` em uma linha, logo após o export de erro (`src/index.ts:72`, seção `// Error`) (D-10). `import { problem } from "h3"` funciona nos testes via `ctx.app`/`src/index.ts`. Nenhum outro nome público novo.

**Arquivos:** `src/index.ts`

---

### T-08 — Snapshot de exports

**Cobre:** RF-08

**Depende de:** T-07

**Aceite:** `pnpm vitest run test/unit/package.test.ts` passa. A única alteração é inserir `"problem"` entre `"parseCookies"` e `"proxy"` (`test/unit/package.test.ts:104-105`), mantendo a lista completa e ordenada. Nenhum outro item removido ou alterado no snapshot.

**Arquivos:** `test/unit/package.test.ts`

---

### T-09 — Testes de tipo para `ProblemInput` e `problem()`

**Cobre:** RF-02

**Depende de:** T-07

**Aceite:** `test/unit/types.test-d.ts` cobre: `ProblemInput` aceita `type` e `instance` como opcionais; `problem(...)` tem tipo de retorno `HTTPError`; `ErrorInput` continua aceito sem `type`/`instance`. A verificação de tipos passa em `pnpm typecheck` (`package.json:54`).

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-10 — Documentação do utilitário

**Cobre:** RF-01, RF-03, RF-04, RF-05

**Depende de:** T-07

**Aceite:** `docs/1.guide/1.basics/6.error.md` ganha subseção sobre `problem()` perto de `### HTTPError Fields` (`:51`). Explica: formato `application/problem+json`, regras de `type`/`title`/`detail`/`instance`, extensões via `body`/`data`, comportamento com `unhandled`, e que `new HTTPError`/`HTTPError.status` e `cause` não mudam de formato. Registra a limitação de que JSON-RPC não usa o formato (`src/utils/json-rpc.ts:484-491`) e que `type` não é validado como URI. `AGENTS.md` fica fora desta tarefa, conforme a decisão 5 da techspec.

**Arquivos:** `docs/1.guide/1.basics/6.error.md`

---

### T-11 — Verificação final

**Cobre:** RF-08, RF-09, RF-10

**Depende de:** T-06, T-08, T-09, T-10

**Aceite:**
- `pnpm vitest run` passa por completo, nos modos `web` e `node`, sem teste existente removido ou enfraquecido (RF-08).
- `pnpm lint` passa (`oxlint` + `oxfmt --check`, `typecheck`) sem erros (RF-10).
- `pnpm build` gera o export `problem` no bundle; `test/dist.test.ts` passa se existir (verificação opcional da techspec, seção 6).
- Relatar a saída real de cada comando, inclusive falhas.

**Arquivos:** nenhum arquivo novo; só execução de `pnpm vitest run`, `pnpm lint` e `pnpm build`.

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-02, T-04, T-07, T-10 |
| RF-02 | T-04, T-07, T-09 |
| RF-03 | T-01, T-03, T-05, T-06, T-10 |
| RF-04 | T-03, T-05, T-06, T-10 |
| RF-05 | T-03, T-05, T-06, T-10 |
| RF-06 | T-05, T-06 |
| RF-07 | T-02, T-05, T-06 |
| RF-08 | T-08, T-11 |
| RF-09 | T-05, T-11 |
| RF-10 | T-11 |

## Pendências da techspec (seção 8)

As tarefas seguem as propostas da techspec. Continuam a confirmar pelo time antes ou durante a implementação: nome `ProblemInput` (T-04), `instance` omitido em `unhandled` (T-03), `stack` em debug (T-03), `title` = `"HTTPError"` sem frase registrada (T-01, T-03) e atualização de `AGENTS.md` (T-10).
