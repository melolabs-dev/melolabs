# Tarefas — Problem details (RFC 9457) via `problem()`

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (decisões D-01 a D-07, pontos P-1 a P-4).

Ordem: testes primeiro (fluxo "Bug Fix Workflow" do AGENTS.md), depois implementação, exportação, ajuste de snapshot e validação.

### T-01 — Testes de comportamento do `problem` (antes da implementação)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/problem.test.ts` falha porque `problem` ainda não existe (erro de import, não de sintaxe). Os casos 1 a 9 da seção 6 do techspec estão escritos com `describeMatrix`, rodando em `web` e `node`. Inclui o caso de `headers: { "content-type": "text/plain" }` (D-02) e o caso `new HTTPError` comum (RF-04).

**Arquivos:** `test/problem.test.ts` (novo)

### T-02 — Teste de tipo da entrada

**Cobre:** RF-06

**Depende de:** T-01

**Aceite:** o arquivo de teste importa `{ problem, type ProblemInput }` de `../src/index.ts` e contém `// @ts-expect-error` sobre `problem({ status: 400, type: 123 })`. Esse teste só passa no `pnpm typecheck` depois de T-03 e T-04; antes disso o typecheck falha por módulo inexistente.

**Arquivos:** `test/problem.test.ts`

### T-03 — Implementar `src/utils/problem.ts`

**Cobre:** RF-01, RF-02, RF-03, RF-05, RF-06

**Depende de:** T-01, T-02

**Aceite:**
- `ProblemInput<DataT>` estende `ErrorInput<DataT>` e acrescenta `type?` e `instance?` (D-07).
- `problem()` segue a referência da seção 5 do techspec: monta `body` com `type`/`instance` só quando definidos (D-03, com precedência sobre `input.body`) e força `content-type: application/problem+json` em `headers`, sem `;charset` (D-02).
- Tipo de retorno explícito, exigido por `isolatedDeclarations`.
- `src/error.ts` e `src/response.ts` não são alterados.
- Arquivo com menos de 200 linhas.
- `pnpm vitest run test/problem.test.ts` passa em `web` e `node`.
- Decisões P-1 a P-4 da seção 8 do techspec seguem as recomendações enquanto não forem confirmadas.

**Arquivos:** `src/utils/problem.ts` (novo)

### T-04 — Exportar `problem` e `ProblemInput` em `src/index.ts`

**Cobre:** RF-01, RF-06

**Depende de:** T-03

**Aceite:** a linha `export { problem, type ProblemInput } from "./utils/problem.ts";` aparece logo após a linha 72, na seção `// Error`. Nenhum outro nome público novo é exportado. `pnpm typecheck` passa, incluindo o `@ts-expect-error` de T-02.

**Arquivos:** `src/index.ts`

### T-05 — Atualizar o snapshot de exportações

**Cobre:** RF-07

**Depende de:** T-04

**Aceite:** `"problem",` entra no snapshot inline entre `"parseCookies",` e `"proxy",` (linha 105). O diff desse arquivo tem só essa linha. `pnpm vitest run test/unit/package.test.ts` passa. A alteração é justificada no PR como o único ajuste em teste existente.

**Arquivos:** `test/unit/package.test.ts`

### T-06 — Confirmar que os erros existentes não mudaram

**Cobre:** RF-04, RF-07

**Depende de:** T-04

**Aceite:** `pnpm vitest run test/errors.test.ts` passa sem nenhuma edição no arquivo. Os asserts de `application/json` (linhas 44 e 140) continuam válidos. O caso 9 de `test/problem.test.ts` cobre `new HTTPError` comum.

**Arquivos:** `test/errors.test.ts` (somente executado, sem edição), `test/problem.test.ts`

### T-07 — Validação final e descrição do PR

**Cobre:** RF-07

**Depende de:** T-05, T-06

**Aceite:**
- `pnpm fmt` seguido de `pnpm test` (lint, typecheck e coverage) passam sem falhas.
- A única alteração em teste existente é a de T-05, e está justificada no PR.
- A descrição do PR lista os riscos da seção 7 do techspec, as decisões P-1 a P-4 e termina com a linha de atribuição exigida.

**Arquivos:** os já listados nas tarefas anteriores (apenas formatação, se o `pnpm fmt` alterar algo)
