# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/prd.md` (RF-01 a RF-09), `sdd/techspec.md` (D-01 a D-08, §3 a §8), issue h3js/h3#1384.

A ordem segue a §8 da especificação técnica: testes primeiro (Bug Fix Workflow do `AGENTS.md`), depois a implementação, depois a verificação.

---

### T-01 — Escrever os testes de comportamento antes da implementação

Criar `test/problem.test.ts` com `describeMatrix`, cobrindo os casos da §5.1 da especificação: `problem()` como `HTTPError`, `type`/`instance`, resposta completa (422 do exemplo do PRD), padrões (`about:blank` e `Internal Server Error`), `HTTPError` comum mantendo `application/json;charset=UTF-8`, `unhandled` sem vazamento de `"segredo do banco"` e sem `stack`, `data` e `body` como extensão, `HEAD`, `onError` devolvendo o mesmo erro, `new HTTPError(problemErr)` perdendo a marca e `errHeaders`/`headers` mesclados.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/problem.test.ts` executa nos modos `web` e `node` e falha antes de qualquer mudança em `src/`. A falha deve ser a esperada (por exemplo, `problem` não exportado por `h3`), não erro de sintaxe do próprio teste. O teste de vazamento usa `expect(text).not.toContain("segredo do banco")`.

**Arquivos:** `test/problem.test.ts`

---

### T-02 — Escrever os testes de tipo

Acrescentar em `test/unit/types.test-d.ts` as checagens da §5.2: `ProblemInput` aceita `ErrorInput`; `problem(...)` retorna algo compatível com `HTTPError`; `problem(...).type` é `string`; a entrada de `new HTTPError({ status: 400, message: "x" })` continua aceita sem mudança.

**Cobre:** RF-02, RF-08

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/unit/` roda as checagens. Antes da implementação, as que dependem de `problem`/`ProblemInput` falham. As de `HTTPError` já passam.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-03 — Tabela de textos padrão de status

Criar `src/utils/internal/status-text.ts` com `getStatusText(status: number): string | undefined`, baseada em um `Record<number, string>` com os textos IANA dos códigos comuns (4xx, 5xx e os 2xx/3xx usados em APIs), no estilo de `COMMON_MIME_TYPES` (D-06). Não usar `STATUS_CODES` de `node:http`. Criar o teste unitário `test/unit/status-text.test.ts`: código da tabela retorna o texto; código fora da tabela retorna `undefined`; 400, 404, 422 e 500 têm os textos corretos.

**Cobre:** RF-04

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/unit/status-text.test.ts` passa. `getStatusText(500)` retorna `"Internal Server Error"` e `getStatusText(599)` retorna `undefined`.

**Arquivos:** `src/utils/internal/status-text.ts`, `test/unit/status-text.test.ts`

---

### T-04 — Utilitário `problem()` e formato do corpo

Criar `src/utils/problem.ts` com `kProblem = Symbol.for("h3.problem")` (D-01), `ProblemInput` estendendo `ErrorInput` com `type?` e `instance?` (D-07), `problem()` (cria `new HTTPError(input)` e define, como não enumeráveis, a marca, `type` com padrão `"about:blank"` e `instance`), `isProblemError()` e `toProblemJSON()`. O corpo segue a tabela da D-05: membros de extensão (`body`, `data`) são espalhados antes dos membros padrão; `title` vem de `statusText` ou de `getStatusText`, e é omitido se nenhum existir; `detail` e `data` são omitidos com `unhandled`. Não alterar `src/error.ts`.

**Cobre:** RF-01, RF-02, RF-04, RF-06, RF-07, RF-08

**Depende de:** T-01, T-03

**Aceite:** `problem({ status: 404, message: "x" })` é `instanceof HTTPError` com `status` 404. Com `type`/`instance` informados, eles ficam no erro. Sem `type`, vale `about:blank`. `toProblemJSON` de um erro `unhandled` não contém `detail` nem `data`. Uma chave de `body` chamada `type` não sobrescreve o padrão. `pnpm typecheck` passa. A `JSON.stringify(problem(...))` não contém a marca (símbolo).

**Arquivos:** `src/utils/problem.ts`

---

### T-05 — Ramo `problem` em `errorResponse`

Em `src/response.ts`, adicionar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`) ao lado de `jsonHeaders`. Em `errorResponse` (§3.3 da especificação), escolher headers e corpo conforme `isProblemError`. Manter inalterados o merge de `error.headers`, o merge de `errHeaders` e o `stack` em debug. Não sobrescrever `toJSON` de `HTTPError` (D-04).

**Cobre:** RF-03, RF-05, RF-06, RF-07

**Depende de:** T-04

**Aceite:** `pnpm vitest run test/problem.test.ts` passa nos modos `web` e `node`. A resposta do exemplo do PRD tem status 422, `content-type` exatamente `application/problem+json` e corpo com `type`, `title`, `status`, `detail` e `instance`. `new HTTPError({ status: 400, message })` continua com `application/json;charset=UTF-8`. `test/errors.test.ts` passa sem alteração. O cabeçalho final é verificado no teste de integração, sem que middleware o sobrescreva.

**Arquivos:** `src/response.ts`

---

### T-06 — Reexportação pública de `problem` e `ProblemInput`

Em `src/index.ts`, na seção `// Error`, exportar **somente** `problem` e o tipo `ProblemInput` (§3.4). `isProblemError` e `kProblem` ficam internos. Atualizar o snapshot inline de `test/unit/package.test.ts` acrescentando `"problem"` entre `"parseCookies"` e `"proxy"`. Não criar outro nome público.

**Cobre:** RF-01, RF-09

**Depende de:** T-04

**Aceite:** `import { problem } from "h3"` funciona nos entries de runtime (todos fazem `export * from "../index.ts"`). `pnpm vitest run test/unit/package.test.ts` passa com o snapshot atualizado, e o diff do snapshot tem apenas a linha `"problem"`.

**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-07 — Verificação de tipos e lint

Rodar `pnpm typecheck` e `pnpm lint` depois da implementação. Corrigir apenas o que vier das mudanças desta feature. Confirmar que `HTTPError`, `ErrorInput`, `ErrorBody` e `createError` mantêm os tipos atuais.

**Cobre:** RF-08

**Depende de:** T-02, T-05, T-06

**Aceite:** `pnpm typecheck` e `pnpm lint` terminam sem erros. Nenhum arquivo de `src/` fora dos listados em T-03 a T-06 foi alterado para isso.

**Arquivos:** `src/utils/problem.ts`, `src/response.ts`, `src/index.ts`, `test/unit/types.test-d.ts`

---

### T-08 — Documentação do utilitário e da árvore do projeto

Acrescentar em `docs/1.guide/1.basics/6.error.md` a seção "Problem details (RFC 9457)", com exemplo de `problem()`, o `Content-Type`, o mapeamento `statusText → title` e `message → detail`, a nota de que `HTTPError` comum não muda e a nota de que `problem` não se aplica a erros de validação. Atualizar `AGENTS.md` incluindo `problem.ts` em `src/utils/` e `status-text.ts` em `src/utils/internal/` na árvore de Project Structure. Não editar `CHANGELOG.md`.

**Cobre:** RF-01, RF-03

**Depende de:** T-05, T-06

**Aceite:** o exemplo da seção de docs é igual ao caso do PRD e passa no teste de T-01. A árvore do `AGENTS.md` lista os dois arquivos novos. `git diff` não toca em `CHANGELOG.md`.

**Arquivos:** `docs/1.guide/1.basics/6.error.md`, `AGENTS.md`

---

### T-09 — Suíte completa e regressão

Rodar `pnpm vitest run` inteiro. Se um teste existente depender do formato alterado, ajustar apenas esse ponto, sem remover a verificação. Os testes de `HTTPError` comum em `test/errors.test.ts` não devem mudar. Opcional: `pnpm build && pnpm vitest run test/dist.test.ts`.

**Cobre:** RF-09

**Depende de:** T-05, T-06, T-07, T-08

**Aceite:** `pnpm vitest run` termina com todos os testes passando, incluindo os novos de T-01 nos modos `web` e `node`. Qualquer ajuste em teste existente aparece listado no relato, com o motivo.

**Arquivos:** `test/problem.test.ts`, `test/unit/status-text.test.ts`, `test/errors.test.ts`

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-04, T-06, T-08 |
| RF-02 | T-01, T-02, T-04 |
| RF-03 | T-01, T-05, T-08 |
| RF-04 | T-01, T-03, T-04 |
| RF-05 | T-01, T-05 |
| RF-06 | T-01, T-04, T-05 |
| RF-07 | T-01, T-04, T-05 |
| RF-08 | T-02, T-04, T-07 |
| RF-09 | T-06, T-09 |
