# Tarefas de implementação — Problem details (RFC 9457) via `problem()`

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08).

Ordem: caracterização primeiro, depois testes que falham, depois implementação, depois validação. Seguir o "Bug Fix Workflow" do `AGENTS.md` adaptado a funcionalidade nova.

**Pré-requisito (R-01):** confirmar com o dono do contrato o mapeamento `title` ← `statusText` e `detail` ← `message` antes de iniciar T-04. Se o mapeamento mudar, ajustar T-04, T-06 e os testes de T-03.

Cobertura dos requisitos: RF-01 (T-03, T-05, T-07), RF-02 (T-02, T-05, T-07), RF-03 (T-03, T-04, T-06), RF-04 (T-03, T-06, T-08), RF-05 (T-01, T-06, T-09), RF-06 (T-03, T-04), RF-07 (T-03, T-06), RF-08 (T-03, T-09).

---

### T-01 — Caracterizar as respostas atuais de `HTTPError`

**Cobre:** RF-05
**Depende de:** nenhuma
**Aceite:** em `test/problem.test.ts`, com `describeMatrix`, existem testes que fixam o status, o `Content-Type` (`application/json;charset=UTF-8`) e o corpo atuais de `new HTTPError({ status: 409, message: "Conflito" })`, de `HTTPError.status(...)` e de um erro não tratado. Todos passam no código atual, sem nenhuma alteração em `src/`.

**Arquivos:** `test/problem.test.ts` (novo)

---

### T-02 — Testes de tipo para `problem()` e `ProblemInput`

**Cobre:** RF-02
**Depende de:** nenhuma
**Aceite:** em `test/unit/problem.test-d.ts`, existem testes de tipo que verificam: (a) `problem({ status: 404, message: "x", type: "https://...", instance: "/a/1" })` compila; (b) `// @ts-expect-error` em `problem({ status: 404, message: "x", foo: 1 })`; (c) o retorno é `HTTPError`, via `expectTypeOf`. Antes de T-05 o teste falha, porque `problem` ainda não existe.

**Arquivos:** `test/unit/problem.test-d.ts` (novo)

---

### T-03 — Testes de runtime do formato RFC 9457 (escritos antes da implementação)

**Cobre:** RF-01, RF-03, RF-04, RF-06, RF-07, RF-08
**Depende de:** T-01, T-02
**Aceite:** em `test/problem.test.ts`, usando `describeMatrix` (modos `web` e `node`), existem testes para:
- lançar e retornar `problem(...)` produz a mesma resposta;
- corpo completo com `type`, `title`, `status`, `detail` e `instance` (exemplo do RF-03);
- `type` ausente vira `"about:blank"`; `title` ausente é omitido (sem a chave); `instance` ausente é omitido;
- `body: { code: "X" }` aparece no nível superior;
- precedência: `body: { status: 999, type: "x", detail: "y" }` não altera `status`, `type` nem `detail`;
- `Content-Type` exatamente `application/problem+json`;
- `unhandled: true`: sem `detail`, sem a mensagem e sem membros de `body`, mas com `unhandled: true` presente;
- `status: 999` vira 500 e `headers: { "retry-after": "30" }` está presente;
- `HTTPError.isError(problem(...))` é `true`;
- `type` e `instance` aparecem no corpo, o que comprova que ficam disponíveis no erro (RF-02).
Rodar `pnpm vitest run test/problem.test.ts` e confirmar que os testes novos falham pelo motivo esperado (formato antigo ou `problem` inexistente), enquanto os de T-01 continuam passando.

**Arquivos:** `test/problem.test.ts`

---

### T-04 — Módulo interno: símbolo, membros e `toProblemJSON`

**Cobre:** RF-03, RF-06
**Depende de:** T-03
**Aceite:** `src/utils/internal/problem.ts` exporta `kProblem` (`Symbol.for("h3.problem")`), `ProblemMembers` e `toProblemJSON(error, members)`, com tipo de retorno explícito. `toProblemJSON` monta o corpo na ordem de D-04: `body` primeiro, depois `type` (padrão `about:blank`), `title` (só se houver `statusText`), `status`, `detail` (omitido com `unhandled`), `instance` (só se houver) e `unhandled` (quando `true`). Os testes de corpo de T-03 que dependem só deste módulo passam. `pnpm lint` e `pnpm typecheck` passam nos arquivos tocados.

**Arquivos:** `src/utils/internal/problem.ts` (novo)

---

### T-05 — Utilitário público `problem()` e tipo `ProblemInput`

**Cobre:** RF-01, RF-02
**Depende de:** T-02, T-03
**Aceite:** `src/utils/problem.ts` exporta `ProblemInput` (estende `ErrorInput` com `type?` e `instance?`) e `problem(input): HTTPError`. A função cria `new HTTPError(input)` e marca a instância com `kProblem` via `Object.defineProperty` não enumerável. Os testes de tipo de T-02 passam. Os testes de T-03 sobre `isError` e sobre a presença de `type`/`instance` passam. `src/error.ts` não é alterado.

**Arquivos:** `src/utils/problem.ts` (novo)

---

### T-06 — Escolher o formato em `errorResponse`

**Cobre:** RF-03, RF-04, RF-05, RF-07
**Depende de:** T-04, T-05
**Aceite:** em `src/response.ts`, `errorResponse` usa `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem charset) e `toProblemJSON` quando `error[kProblem]` existe. Caso contrário, o código segue exatamente como antes. `stack` continua sendo acrescentado só em `debug`, nos dois formatos. `headers` do erro continuam mesclados por cima da base. `prepareResponse`, `status` e `statusText` não mudam. Todos os testes de T-03 passam nos modos `web` e `node`. Os testes de caracterização de T-01 continuam passando sem alteração. `src/response.ts` continua com menos de ~400 linhas.

**Arquivos:** `src/response.ts`

---

### T-07 — Exportar `problem` e `ProblemInput` pelo pacote

**Cobre:** RF-01, RF-02
**Depende de:** T-05
**Aceite:** `src/index.ts` exporta `problem` e o tipo `ProblemInput` na seção `// Error`. Em `test/unit/package.test.ts`, o snapshot inline recebe `"problem"` entre `"parseCookies"` e `"proxy"`, e nada mais muda nesse arquivo. `import { problem } from "h3"` funciona nos testes. `pnpm vitest run test/unit/package.test.ts` passa.

**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-08 — Documentar o utilitário `problem()`

**Cobre:** RF-03, RF-04
**Depende de:** T-06
**Aceite:** `docs/1.guide/1.basics/6.error.md` tem uma seção curta sobre `problem()`, após a seção `HTTPError`. Ela descreve o mapeamento de membros (D-04), o `Content-Type` `application/problem+json`, a regra de `unhandled`, e as limitações conhecidas: `onError` que devolve outro valor perde o formato (R-06) e `problem()` dentro de JSON-RPC não muda de formato (R-07). Esta tarefa é opcional e recomendada no techspec.

**Arquivos:** `docs/1.guide/1.basics/6.error.md`

---

### T-09 — Validação final da suíte

**Cobre:** RF-05, RF-08
**Depende de:** T-06, T-07, T-08
**Aceite:** `pnpm vitest run` passa por completo nos modos `web` e `node`, incluindo os testes de caracterização de T-01 e os testes de `errors.test.ts` citados em `sdd/techspec.md` (linhas 137-151, 257, 309, 350, 384, 420 e 442) sem nenhuma alteração. `pnpm lint` e `pnpm typecheck` passam. Um erro comum (`new HTTPError(...)` ou `HTTPError.status(...)`) produz a mesma resposta byte a byte da versão anterior. Se algum teste existente falhar, a correção vai no código, não no teste.

**Arquivos:** nenhum arquivo novo; verificação sobre todo o repositório
