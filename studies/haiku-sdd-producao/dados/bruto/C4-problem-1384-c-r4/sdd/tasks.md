# Tarefas de implementação — Problem details (RFC 9457) via `problem()`

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-10).

Ordem sugerida: T-01 → T-02 (testes falhando) → T-03 → T-04 → T-05 → T-06 → T-07. Os testes de T-02 devem falhar antes de T-03/T-04, como pede o fluxo de bug fix do `AGENTS.md`.

Pontos da techspec §7 que seguem o default da spec, salvo decisão contrária do time antes de T-04: `application/problem+json` sem charset (D-04), `stack` em modo debug (D-06) e `toJSON()` inalterado (D-03).

---

### T-01 — Marca interna `kProblem` e tipo `ProblemFields` em `src/error.ts`

**Cobre:** RF-08, RF-09

**Depende de:** nenhuma

**Aceite:**
- `src/error.ts` declara `kProblem = Symbol.for("h3.problem")` e a interface `ProblemFields` (`type?`, `instance?`), perto da classe `HTTPError`.
- `constructor`, `isError`, `toJSON` e os campos de `HTTPError` ficam sem alteração (`git diff` mostra só as declarações novas).
- `kProblem` e `ProblemFields` não aparecem em `src/index.ts`.
- `pnpm typecheck` passa.

**Arquivos:** `src/error.ts`

---

### T-02 — Testes de cobertura da feature (escritos antes da implementação)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-10

**Depende de:** nenhuma

**Aceite:**
- `test/problem.test.ts` usa `describeMatrix` (web e node) e tem um caso por linha da tabela da techspec §5, cobrindo os RF-01 a RF-08.
- Casos de colisão (`body.status: 999`, `body.type`, `body.title`) e de `unhandled: true` com uma `message` sentinela verificam que o valor não aparece no corpo.
- O caso de RF-08 (`HTTPError.status(404, ...)` com `application/json;charset=UTF-8` e corpo no formato atual) passa já antes da implementação.
- Antes de T-03/T-04, `pnpm vitest run test/problem.test.ts` falha nos casos de `problem`, por ausência do export, e não por erro de sintaxe do próprio teste.

**Arquivos:** `test/problem.test.ts`

---

### T-03 — Utilitário `problem()` e tipo `ProblemInput` em `src/utils/problem.ts`

**Cobre:** RF-01, RF-02, RF-03

**Depende de:** T-01

**Aceite:**
- `problem(input)` separa `type` e `instance` de `input`, cria `new HTTPError(errorInput)` e grava `{ type, instance }` em `kProblem` com `Object.defineProperty` não enumerável.
- `type` e `instance` não entram em `cause` nem em `error.body`.
- Um teste unitário ou o `test/problem.test.ts` confirma que `problem({ status: 404, ... })` retorna `HTTPError` com `status` 404 e que `HTTPError.isError` devolve `true`.
- O arquivo tem menos de 200 linhas, como manda o `AGENTS.md`.
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/problem.ts`

---

### T-04 — Ramo de problem details em `errorResponse` (`src/response.ts`)

**Cobre:** RF-02, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** T-01, T-03

**Aceite:**
- `errorResponse` lê `error[kProblem]` no início; se existir, delega para `problemResponse`. Erros sem a marca seguem o código atual sem nenhuma linha alterada.
- `problemResponse` monta o corpo na ordem da techspec D-05: `...body` (se não `unhandled`), depois `data` (se definido), depois `type ?? "about:blank"`, `title` (só com `statusText`), `status`, `detail` (só se não `unhandled`), `instance` (só se informado) e `stack` (só com `debug`).
- Cabeçalhos seguem D-09: `error.headers`, depois `errHeaders` com `mergeHeaders`, depois `content-type: application/problem+json` com `set` por último.
- `prepareResponse` e a ordem de hooks `onError`/`onResponse` não mudam.
- `pnpm vitest run test/problem.test.ts` passa nos casos de RF-02 a RF-08, em web e node.
- `pnpm vitest run test/errors.test.ts` passa sem alteração no próprio arquivo de teste.

**Arquivos:** `src/response.ts`

---

### T-05 — Export público de `problem` e `ProblemInput` (`src/index.ts`)

**Cobre:** RF-01, RF-09

**Depende de:** T-03

**Aceite:**
- `src/index.ts` ganha uma linha na seção `// Error` exportando `problem` e `type ProblemInput`, e nenhum outro nome.
- `test/unit/package.test.ts` inclui `"problem"` no snapshot inline, entre `"parseCookies"` e `"proxy"`, e nenhuma outra entrada muda.
- `pnpm vitest run test/unit/package.test.ts` passa.
- Comparando a lista de exports antes e depois, a diferença é exatamente `problem`.

**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-06 — Testes de tipo para `ProblemInput` (opcional)

**Cobre:** RF-01, RF-03

**Depende de:** T-03

**Aceite:**
- `test/unit/types.test-d.ts` checa que `problem({ status: 404, type: "x", instance: "/a" })` compila.
- O mesmo arquivo checa que `problem({ status: 404, extra: 1 })` falha em literal.
- `pnpm vitest run --typecheck` (ou o comando de tipos que o projeto já usa) passa.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-07 — Verificação final e registro da diferença de `toJSON()`

**Cobre:** RF-10, RF-08, RF-09

**Depende de:** T-02, T-04, T-05, T-06

**Aceite:**
- `pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/package.test.ts` passa nos modos web e node.
- `pnpm vitest run` (suíte completa) passa. Se algum teste existente falhar, a causa deve estar diretamente ligada à mudança e o ajuste deve preservar o que ele verifica (RF-10).
- `pnpm lint` e `pnpm typecheck` passam sem erros.
- Os testes existentes de formato atual (`test/errors.test.ts` nas linhas 44, 67-86 e 107-122) continuam sem alteração.
- A descrição do PR registra que `HTTPError.toJSON()` continua no formato antigo (D-03) e que `problem()` é opt-in.

**Arquivos:** nenhum arquivo novo; revisão de `test/problem.test.ts`, `test/errors.test.ts`, `test/unit/package.test.ts`, `src/index.ts`, `src/response.ts`, `src/utils/problem.ts` e `src/error.ts`.
