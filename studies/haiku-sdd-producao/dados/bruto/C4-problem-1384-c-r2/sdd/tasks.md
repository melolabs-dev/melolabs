# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, seção 3 e seção 5).

Ordem: os testes (T-01 a T-03) são escritos e vistos falhando antes da implementação (T-04 em diante), como manda o `AGENTS.md` (Bug Fix Workflow, adaptado). Cada tarefa lista os arquivos que toca no campo `Arquivos:`, no fim.

Pendências da especificação que não bloqueiam as tarefas, mas devem ser confirmadas antes do merge: nome `ProblemInput` (D-08), `detail` omitido quando vazio (D-05) e `Content-Type` sem `charset` (D-04).

---

### T-01 — Testes de comportamento do `problem()`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-08
Depende de: nenhuma
Aceite: criar `test/problem.test.ts` com `describeMatrix` (roda em `web` e `node`), cobrindo a tabela da seção 5 da techspec: retorno `HTTPError` com `status` e `message`; lançado e retornado dão a mesma resposta; `type` e `instance` no corpo; `"about:blank"` e sem `instance` quando omitidos; `Content-Type` exatamente `application/problem+json` com status 422; `statusText` → `title`, `message` → `detail`, `data` como extensão; sem `detail` quando `message` não é passado; `unhandled: true` oculta `detail`, `data` e `body` e mantém `status`; colisão de chaves de `body` (`title`, `status`, `type`) não sobrescreve os membros RFC; `headers` de `problem()` mesclados; `onError` recebe o erro; regressão: `new HTTPError(...)` continua com `application/json` e as chaves `status`, `statusText`, `unhandled`, `message`, `data`; `stack` em modo `debug` como antes. Rodar `pnpm vitest run test/problem.test.ts` e confirmar que os testes novos **falham** (import de `problem` ausente), e que os de regressão passam.
Arquivos:
- `test/problem.test.ts` (novo)

### T-02 — Teste de tipo de `ProblemInput`

Cobre: RF-07
Depende de: nenhuma
Aceite: em `test/unit/types.test-d.ts`, `expectTypeOf<ProblemInput>` aceita um objeto com `status`, `message`, `type` e `instance`, e rejeita uma chave desconhecida (`// @ts-expect-error`). Antes da implementação, `pnpm typecheck` falha por falta do export. Após T-06, passa.
Arquivos:
- `test/unit/types.test-d.ts`

### T-03 — Snapshot de exportações

Cobre: RF-01, RF-08
Depende de: nenhuma
Aceite: em `test/unit/package.test.ts`, incluir `"problem"` entre `"parseCookies"` (linha 104) e `"proxy"` (linha 105). Antes da implementação, `pnpm vitest run test/unit/package.test.ts` falha. Após T-06, passa. Esta é a única mudança em teste existente.
Arquivos:
- `test/unit/package.test.ts`

### T-04 — Módulo `src/problem.ts`

Cobre: RF-01, RF-02, RF-04, RF-06, RF-07
Depende de: T-01, T-02, T-03
Aceite: criar `src/problem.ts` com `ProblemInput` (estende `ErrorInput` com `type?` e `instance?`), `problem(input): HTTPError` com tipo de retorno explícito (exigido por `isolatedDeclarations`), `kProblem = Symbol.for("h3.problem")` não exportado, `getProblemFields(error)` e `toProblemJSON(error, fields)`. A marca guarda `type`, `instance` e `detail` (`input.message || undefined`), conforme D-01 e D-05. `toProblemJSON` segue a ordem de precedência de D-05 (corpo espalhado primeiro; `type`, `title`, `status`, `detail`, `instance`, `data` depois) e a regra de `unhandled` de D-06. Arquivo com menos de 200 linhas, sem `any`, com `.ts` nos imports. `pnpm typecheck` e `pnpm lint` passam neste arquivo.
Arquivos:
- `src/problem.ts` (novo)

### T-05 — Renderização RFC 9457 em `errorResponse`

Cobre: RF-03, RF-05, RF-06
Depende de: T-04
Aceite: em `src/response.ts`, importar `getProblemFields` e `toProblemJSON`; criar `problemHeaders` com `content-type: application/problem+json` (sem `charset`, D-04) ao lado de `jsonHeaders` (linha 270); `errorResponse` (linha 358) escolhe `problemHeaders` e `toProblemJSON` quando há marca, e mantém `jsonHeaders` e `error.toJSON()` sem marca. `HTTPError.toJSON` não muda. Mesclagem de `error.headers` e `errHeaders` e campo `stack` em debug continuam iguais. `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa por completo, e `test/errors.test.ts` não é alterado.
Arquivos:
- `src/response.ts`

### T-06 — Exportação pública

Cobre: RF-01, RF-07
Depende de: T-04
Aceite: em `src/index.ts`, acrescentar `export { problem, type ProblemInput } from "./problem.ts";` ao lado da exportação de `./error.ts` (linha 72). Nenhum outro símbolo novo é exportado (`kProblem`, `getProblemFields` e `toProblemJSON` ficam internos). `pnpm vitest run test/unit/package.test.ts` e `pnpm typecheck` passam.
Arquivos:
- `src/index.ts`

### T-07 — Teste de build

Cobre: RF-01, RF-03
Depende de: T-05, T-06
Aceite: em `test/dist.test.ts`, um caso que chama `problem()` a partir do build (`dist/_entries/*.mjs`) e confere o `Content-Type` `application/problem+json` e o corpo. Rodar `pnpm build && pnpm vitest run test/dist.test.ts`. Confirma que o bundler não removeu `kProblem` nem a ramificação de `errorResponse`, conforme o caso já documentado no próprio arquivo (linhas 4-16).
Arquivos:
- `test/dist.test.ts`

### T-08 — Documentação

Cobre: RF-01, RF-02, RF-04
Depende de: T-05
Aceite: em `docs/1.guide/1.basics/6.error.md`, uma seção "Problem Details (RFC 9457)" antes de `## Unhandled Errors` (linha 78), com exemplo de `problem()`, a tabela de mapeamento de RF-04 e a nota de que erros comuns continuam em `application/json`. Em `AGENTS.md`, incluir `problem.ts` na árvore de `src/` perto de `error.ts` (linha 63). Não há site externo (fora de escopo do PRD).
Arquivos:
- `docs/1.guide/1.basics/6.error.md`
- `AGENTS.md`

### T-09 — Verificação final

Cobre: RF-08
Depende de: T-05, T-06, T-07, T-08
Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm build && pnpm vitest run test/dist.test.ts` e `pnpm vitest run` terminam sem falhas. Nenhum teste existente foi removido. A única alteração em teste existente é a linha do snapshot em `test/unit/package.test.ts` (T-03). Os resultados são reportados com a saída, inclusive se algo falhar.
Arquivos:
- nenhum arquivo novo; verificação dos arquivos acima

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 (`problem` exportado) | T-01, T-03, T-04, T-06, T-07 |
| RF-02 (`type` e `instance`) | T-01, T-04, T-08 |
| RF-03 (`application/problem+json`) | T-01, T-05, T-07 |
| RF-04 (mapeamento RFC) | T-01, T-04, T-08 |
| RF-05 (erros comuns inalterados) | T-01, T-05 |
| RF-06 (`unhandled` sem vazamento) | T-01, T-04, T-05 |
| RF-07 (tipo `ProblemInput`) | T-02, T-04, T-06 |
| RF-08 (compatibilidade e qualidade) | T-01, T-03, T-09 |
