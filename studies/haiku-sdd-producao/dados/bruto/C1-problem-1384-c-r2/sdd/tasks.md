# Tarefas — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/prd.md` (RF-01 a RF-08, premissas P1 a P5, riscos R1 a R5) e `sdd/techspec.md` (D-01 a D-08, seções 3 a 6).

Ordem geral: primeiro os testes, depois confirmar que falham (AGENTS.md, "Bug Fix Workflow"), depois a implementação, depois a verificação completa.

Antes de começar, confirmar com o dono do projeto (techspec, seção 8): P2 (`title` = `statusText` sem tabela de frases padrão) e as escolhas de `data` não objeto, `Content-Type` em `headers` e visibilidade de `type`/`instance` em erro `unhandled`. Se a resposta mudar P2, T-03 e T-06 são refeitas.

---

### T-01 — Testes de tipo para `problem` e `ProblemInput`

**Cobre:** RF-01, RF-02

**Depende de:** nenhuma

**Aceite:** em `test/unit/types.test-d.ts` existem verificações de que `ProblemInput` aceita `type` e `instance` opcionais como `string`, aceita todos os campos de `ErrorInput`, que `problem({ status: 404, message: "x" })` retorna `HTTPError`, e que `problem<{ campo: string }>({ data: { campo: "x" }, status: 400 })` retorna `HTTPError<{ campo: string }>`. Antes de `src/problem.ts` existir, `pnpm typecheck` falha por causa desses asserts.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-02 — Snapshot de exports com `problem`

**Cobre:** RF-08

**Depende de:** nenhuma

**Aceite:** o snapshot inline em `test/unit/package.test.ts` contém `"problem",` entre `"parseCookies",` e `"proxy",`. Antes da implementação, `pnpm vitest run test/unit/package.test.ts` falha porque o export ainda não existe. Esta é a única mudança de snapshot da feature (techspec, R8).

**Arquivos:** `test/unit/package.test.ts`

---

### T-03 — Testes de comportamento de `problem` na resposta

**Cobre:** RF-01, RF-03, RF-04, RF-06, RF-07

**Depende de:** nenhuma

**Aceite:** `test/problem.test.ts` criado com `describeMatrix` (modos `web` e `node`), no padrão de `test/errors.test.ts`, com estes casos: `problem()` devolve `HTTPError` com `status` e `message`; `type` e `instance` chegam ao corpo com status 422 e `content-type` exato `application/problem+json`; `type` ausente vira `"about:blank"`; `data: { campo: "email" }` vira `"campo": "email"` no nível superior, sem chave `data`; `body` aparece no nível superior; `data: { status: 1, detail: "x" }` não altera `status` nem `detail`; `data: "texto"` vai como `"data": "texto"`; `unhandled: true` com `message: "segredo"` e `data: { senha: "x" }` produz status 500 e corpo sem `segredo` nem `senha`; `headers: { "Retry-After": "30" }` chega na resposta; `headers: { "Content-Type": "text/plain" }` não troca o media type. Rodando `pnpm vitest run test/problem.test.ts` antes de `src/problem.ts` existir, os testes falham.

**Arquivos:** `test/problem.test.ts`

---

### T-04 — Testes de regressão do formato atual e da marca

**Cobre:** RF-05

**Depende de:** T-03 (mesmo arquivo de teste)

**Aceite:** em `test/problem.test.ts` há casos que passam já no código atual e devem continuar passando: `new HTTPError({ status: 400, message: "Ruim" })` responde com o mesmo `content-type` `application/json;charset=UTF-8` e o mesmo corpo de `test/errors.test.ts:67-86`; `{ ...problemErr }` é renderizado no formato antigo (R1); `JSON.stringify(err)` não contém `h3.problem` e `Object.keys(err)` não inclui o símbolo da marca (D-01); `onError` que devolve `new HTTPError(...)` produz `application/json` (D-07). Estes casos não dependem de `src/problem.ts`, então devem passar antes e depois da implementação.

**Arquivos:** `test/problem.test.ts`

---

### T-05 — Implementar `src/problem.ts`

**Cobre:** RF-01, RF-02, RF-04, RF-06

**Depende de:** T-01, T-03, T-04

**Aceite:** `src/problem.ts` exporta `ProblemInput`, `kProblem` (`Symbol.for("h3.problem")`), `problem`, `getProblem` e `toProblemJSON`, com tipos de retorno explícitos (exigência de `isolatedDeclarations`). `problem` cria `HTTPError` sem `type` e `instance` e grava a marca com `Object.defineProperty`, sem `enumerable`. `toProblemJSON` segue D-04 (extensões espalhadas, membros reservados por último), D-03 (`title` = `statusText`, `detail` = `message`) e D-05 (`unhandled` omite `detail`, `data` e `body`). Nenhum arquivo novo passa de 200 linhas. `pnpm typecheck` passa e os testes de T-01 e T-03 deixam de falhar nos casos cobertos por este módulo (o `content-type` ainda depende de T-06). Arquivo sem import de `response.ts`, para evitar ciclo (D-02).

**Arquivos:** `src/problem.ts`

---

### T-06 — Ramo `problem` em `errorResponse`

**Cobre:** RF-03, RF-05, RF-07

**Depende de:** T-05

**Aceite:** em `src/response.ts`, `errorResponse` chama `getProblem(error)`. Quando há marca, usa `toProblemJSON`, `problemHeaders` (`content-type: application/problem+json`, na forma de `jsonHeaders`), mescla `error.headers`, fixa `content-type` como `application/problem+json` depois da mesclagem (D-06), e mescla `errHeaders` por último. Quando não há marca, o corpo e os cabeçalhos são os mesmos de hoje. `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa, sem alterar `test/errors.test.ts`. Nenhuma outra linha de `src/response.ts` muda (techspec, 3.2).

**Arquivos:** `src/response.ts`

---

### T-07 — Reexportar `problem` e `ProblemInput` em `src/index.ts`

**Cobre:** RF-01, RF-08

**Depende de:** T-05

**Aceite:** `src/index.ts` tem `export { problem, type ProblemInput } from "./problem.ts";` no bloco `// Error`, após a linha de `ErrorInput`. `kProblem`, `getProblem` e `toProblemJSON` não são exportados pelo índice. Importar `problem` de `h3` devolve uma função.

**Arquivos:** `src/index.ts`

---

### T-08 — Verificação final e compatibilidade

**Cobre:** RF-08

**Depende de:** T-02, T-06, T-07

**Aceite:** `pnpm vitest run` passa por completo nos modos `web` e `node`; `pnpm lint` passa (oxlint e oxfmt --check); `pnpm typecheck` passa. Os testes existentes não foram alterados, exceto o snapshot de T-02. Se algum teste existente falhou, a causa foi corrigida no código, e não no teste (techspec, 6.2). Confirmar também que `pnpm install` e os comandos do `AGENTS.md` funcionam neste clone (premissa P5, risco R11). Se algum comando não puder ser executado, registrar isso no relatório final.

**Arquivos:** nenhum arquivo novo; verificação sobre `test/`, `src/` e configuração existente (`package.json`).
