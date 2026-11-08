# Tarefas — Problem Details (RFC 9457) via `problem()`

Referências: `sdd/prd.md` (RF-01…RF-10) e `sdd/techspec.md` (D-01…D-08). A ordem segue o Bug Fix Workflow do `AGENTS.md`: regressão primeiro, depois implementação, depois testes novos e verificação.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03, T-05, T-06 |
| RF-02 | T-03, T-06, T-07 |
| RF-03 | T-02, T-04, T-06, T-08 |
| RF-04 | T-04, T-06 |
| RF-05 | T-02, T-04, T-06 |
| RF-06 | T-04, T-06 |
| RF-07 | T-04, T-06 |
| RF-08 | T-01, T-04, T-06 |
| RF-09 | T-02, T-04, T-06 |
| RF-10 | T-01, T-05, T-06, T-07, T-09 |

---

### T-01 — Teste de regressão do formato atual de erros

Criar `test/problem.test.ts` com `describeMatrix` e, por ora, só os casos de RF-08: `new HTTPError({ status: 400, message: "ruim", data: { a: 1 } })` lançado por handler, 404 de rota inexistente e `Error` comum. Cada caso verifica o corpo exato e `content-type: application/json;charset=UTF-8`, sem `type`/`title`/`detail`. Rodar **antes** de qualquer mudança em `src/` e confirmar que passa.

Cobre: RF-08, RF-10
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` passa nos modos web e node com `src/` intocado (`git status` não mostra alterações em `src/`).
Arquivos: `test/problem.test.ts`

### T-02 — Helper interno de renderização Problem Details

Criar `src/utils/internal/problem.ts` com `kProblem` (`"~problem"`), `ProblemMark` (`type`, `instance`, `detail`), `markProblem()` (`Object.defineProperty`, `enumerable: false`), `getProblem()`, a tabela mínima de títulos de status (D-06) e `problemBody()`. O corpo é `{ ...extensões, type, status, title, detail, instance }`: extensões são `data` (como membro raiz) e as chaves de `body`, espalhadas antes dos membros padrão para que estes tenham precedência. `type` assume `"about:blank"`; `title` usa `statusText` ou a tabela e é omitido se nenhum existir; `detail` e `instance` só entram quando há valor (sem chaves `undefined`). Com `unhandled`, omite `data`, `body` e `detail`, mantendo `type`/`status`/`title`.

Cobre: RF-03, RF-05, RF-09
Depende de: nenhuma
Aceite: `pnpm typecheck` passa; o arquivo tem menos de 200 linhas e não é exportado em `src/index.ts`; os comportamentos são exercitados pelos testes de T-06.
Arquivos: `src/utils/internal/problem.ts`

### T-03 — Utilitário público `problem()` e tipo `ProblemInput`

Criar `src/utils/problem.ts` com `ProblemInput<DataT> extends ErrorInput<DataT>` (`type?: string`, `instance?: string`) e `problem()`. A função extrai `type` e `instance`, cria `new HTTPError(rest)`, chama `markProblem(error, { type, instance, detail: rest.message || undefined })` e devolve o erro. Exportar `problem` e `type ProblemInput` em `src/index.ts`, no bloco `// Error`, com import direto do módulo (sem barrel). Não alterar `src/error.ts`.

Cobre: RF-01, RF-02
Depende de: T-02
Aceite: `pnpm typecheck` passa; `import { problem } from "h3"` resolve; `problem({ status: 404 })` é `HTTPError.isError` com `status` 404; nenhum outro nome público novo.
Arquivos: `src/utils/problem.ts`, `src/index.ts`

### T-04 — Integrar o formato em `errorResponse`

Em `src/response.ts`: importar `getProblem` e `problemBody`; declarar `problemHeaders` (`FrozenHeaders` com `application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`; em `errorResponse`, escolher a base de headers e o corpo conforme a marca, mantendo o merge de `error.headers` e `errHeaders` e o `stack` em modo debug. Sem marca, a expressão avaliada deve permanecer idêntica à atual.

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa (regressão de T-01 e a suíte de erros existente sem ajustes); `throw` e `return` de `problem({ status: 409 })` respondem 409 `application/problem+json` com corpos idênticos.
Arquivos: `src/response.ts`

### T-05 — Atualizar o snapshot de exports públicos

Inserir `"problem"` entre `"parseCookies"` e `"proxy"` no snapshot de `test/unit/package.test.ts`, sem enfraquecer a verificação (a lista só pode diferir da anterior por esse nome).

Cobre: RF-01, RF-10
Depende de: T-03
Aceite: `pnpm vitest run test/unit/package.test.ts` passa e o diff do arquivo contém apenas a linha `"problem"`.
Arquivos: `test/unit/package.test.ts`

### T-06 — Testes de integração de `problem()` (web e node)

Completar `test/problem.test.ts` com `describeMatrix`, mantendo os casos de T-01:
- RF-01/02: retorno é `HTTPError` com `status`, `message`, `headers` e `data` preservados.
- RF-03: exemplo completo do PRD com `toEqual`; `data` no nível raiz; colisão (`body: { title: "x", status: 1 }`) sem sobrescrever os membros padrão.
- RF-04: `content-type` começa com `application/problem+json`.
- RF-05: `problem({ status: 403 })` → `{ type: "about:blank", status: 403, title: "Forbidden" }`; `problem({})` → 500; corpo bruto sem `undefined`/`null`; status sem frase conhecida → sem `title`.
- RF-06: rotas `throw` e `return` com 409, mesmo status, content-type e corpo.
- RF-07: `retry-after: 30`; `title` = `statusText`; `content-type` do usuário sobrescreve; `errHeaders` do evento continuam aplicados.
- RF-09: `unhandled: true` com `message: "segredo"` e `data` → corpo sem esses valores e com `type`/`status`/`title`; `new H3({ debug: true })` inclui `stack`.
- Extras: `onError` configurado mantém `problem+json`; `new HTTPError(problemErr)` perde a marca (D-08); a marca não aparece em `JSON.stringify(err)` nem em `Object.keys(err)`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10
Depende de: T-04
Aceite: `pnpm vitest run test/problem.test.ts` passa em web e node; cada teste de `problem()` falha se T-04 for revertido (os de RF-08 continuam passando).
Arquivos: `test/problem.test.ts`

### T-07 — Testes de tipos de `ProblemInput`

Em `test/unit/types.test-d.ts` (dentro de `describe("types")`, com imports de `problem`/`ProblemInput`): aceitar `{ status, message, data, headers, type, instance }`; `// @ts-expect-error` para `type: 123` e `instance: 1`; `problem()` retorna `HTTPError`.

Cobre: RF-02, RF-10
Depende de: T-03
Aceite: `pnpm typecheck` e `pnpm vitest run test/unit/types.test-d.ts` passam; remover um `@ts-expect-error` faz o typecheck falhar.
Arquivos: `test/unit/types.test-d.ts`

### T-08 — Documentar `problem()`

Adicionar seção em `docs/1.guide/1.basics/6.error.md` com exemplo de `throw`/`return problem(...)`, o corpo e o content-type resultantes, a precedência dos membros padrão sobre extensões (`data`/`body`), o comportamento de `unhandled` e a perda da marca em `new HTTPError(problemErr)`.

Cobre: RF-03
Depende de: T-04
Aceite: a seção existe, os exemplos batem com os testes de T-06 e `pnpm lint` passa (oxfmt `--check`).
Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-09 — Verificação final

Rodar `pnpm fmt` nos arquivos novos, depois `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Conferir que `src/error.ts` não mudou e que os exports públicos novos são apenas `problem` e `ProblemInput`.

Cobre: RF-10
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
Aceite: os três comandos terminam sem erro; `git diff --stat` não lista `src/error.ts`, `src/h3.ts`, `src/adapters.ts` nem `src/utils/middleware.ts`.
Arquivos: `src/utils/internal/problem.ts`, `src/utils/problem.ts`, `src/response.ts`, `src/index.ts`, `test/problem.test.ts`, `test/unit/package.test.ts`, `test/unit/types.test-d.ts`, `docs/1.guide/1.basics/6.error.md`
