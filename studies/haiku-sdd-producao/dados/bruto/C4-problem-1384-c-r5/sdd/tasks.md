# Tarefas de implementação — Problem details (RFC 9457) via `problem()`

Referências: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (D-01 a D-10, seções 3 a 5).

Ordem de execução: testes primeiro (T-01, T-02), depois as partes independentes (T-03), a implementação (T-04 a T-06), a exportação (T-05) e, por fim, a verificação (T-07, T-08). O fluxo segue `AGENTS.md`: escrever o teste, confirmar que ele falha, implementar, confirmar que passa.

Cobertura dos requisitos:

| RF | Tarefas |
|---|---|
| RF-01 | T-01, T-04, T-05 |
| RF-02 | T-01, T-02, T-04 |
| RF-03 | T-01, T-06 |
| RF-04 | T-01, T-03, T-04 |
| RF-05 | T-01, T-04 |
| RF-06 | T-01, T-06 |
| RF-07 | T-01, T-04 |
| RF-08 | T-01, T-06, T-07 |
| RF-09 | T-01, T-04, T-06 |
| RF-10 | T-07 |
| RF-11 | T-01 |
| RF-12 | T-02, T-08 |

---

### T-01 — Testes de comportamento de `problem()` em `describeMatrix`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-11

Depende de: nenhuma

Aceite:
- O arquivo `test/problem.test.ts` usa `describeMatrix` (`test/_setup.ts:11`) e contém um caso para cada linha da tabela da seção 5.1 do techspec, incluindo: retorno `instanceof HTTPError`; `type` e `instance` acessíveis; `throw problem(...)` com `Content-Type` exato `application/problem+json` e corpo com `type`, `title`, `status`, `detail`, `instance`; o mesmo caso com `onError` devolvendo o erro; `type` ausente gerando `"about:blank"`; `title` de 422 igual a `"Unprocessable Content"`; `data` e `body` como membros de extensão, com `body.type` sem substituir `type`; `WWW-Authenticate` e `Retry-After` preservados; `unhandled: true` sem `detail`, `data`, `stack` e sem a mensagem secreta; erro legado `new HTTPError(...)` com `application/json` e as mesmas chaves; debug ligado com `stack` em array de strings; `HEAD` sem corpo; `detail` ausente sem `message`; status fora da tabela com `title` `"Unknown Error"`.
- Casos sem debug desligam `debug` em `t.app.config.debug = false`, como em `test/errors.test.ts:14`.
- Antes da implementação, `pnpm vitest run test/problem.test.ts` falha nos dois alvos (`web` e `node`) porque `problem` não existe. Nenhum caso falha por erro de sintaxe no próprio teste.

Arquivos: `test/problem.test.ts`

---

### T-02 — Testes de tipo para `problem()` e `ProblemInput`

Cobre: RF-02, RF-12

Depende de: nenhuma

Aceite:
- Em `test/unit/types.test-d.ts`, `expectTypeOf` verifica que `problem({ status: 404 })` é atribuível a `HTTPError` e tem `type: string`.
- Verifica que `ProblemInput` aceita `type` e `instance`.
- Verifica com `// @ts-expect-error` que `new HTTPError({ status: 404, type: "x" })` falha, o que prova que `ErrorInput` não mudou (D-03).
- Verifica com `// @ts-expect-error` que `problem({ status: 404, foo: 1 })` falha.
- Antes da implementação, `pnpm typecheck` falha pelos imports ausentes; depois de T-05, passa.

Arquivos: `test/unit/types.test-d.ts`

---

### T-03 — Tabela de textos padrão de status

Cobre: RF-04

Depende de: nenhuma

Aceite:
- `src/utils/internal/status-text.ts` exporta `statusTexts: Readonly<Record<number, string>>` com os códigos 400 a 418, 421 a 426, 428, 429, 431, 451, 500 a 505, 507, 508 e 511 (D-06).
- O texto de 422 é `"Unprocessable Content"`, igual ao usado em `src/utils/query.ts:77`.
- O arquivo não importa nada de `node:*`, tem menos de 200 linhas e não tem exportação além de `statusTexts`.
- Um teste unitário simples (ou o caso de T-01 para 422) confirma o texto de pelo menos 422 e 404.

Arquivos: `src/utils/internal/status-text.ts`

---

### T-04 — Módulo `src/problem.ts` com `problem()` e a montagem dos membros

Cobre: RF-01, RF-02, RF-04, RF-05, RF-07, RF-09

Depende de: T-01, T-03

Aceite:
- `src/problem.ts` exporta `problem` e `ProblemInput` (`extends ErrorInput`, com `type?` e `instance?`, D-03), e contém `kProblem = Symbol.for("h3.problem")` como símbolo não exportado para o pacote (D-01).
- `problem()` cria um `HTTPError` e o marca com `[kProblem]` e com as propriedades `type` (padrão `"about:blank"`) e `instance`, usando `Object.assign` (D-04).
- `detail` vem de `input.message` somente quando é string não vazia; `title` vem de `error.statusText`, depois de `statusTexts[status]`, depois de `"Unknown Error"` (D-05).
- `problemMembers(error, debug)` devolve, nesta ordem, `{ data, ...body, type, title, status, detail, instance, stack }` (D-08), de modo que os membros da RFC prevalecem sobre `body`.
- Com `unhandled: true`, o resultado tem só `type`, `title` e `status`, e `stack` nunca aparece, mesmo em debug (D-09, RF-07).
- Com debug ligado e sem `unhandled`, `stack` aparece como lista de linhas.
- `src/problem.ts` tem menos de 200 linhas e não importa de `src/response.ts`, para evitar ciclo (D-02).
- Os casos de T-01 que dependem só da montagem dos membros passam quando `errorResponse` ainda não foi alterado, ou são cobertos depois de T-06.

Arquivos: `src/problem.ts`

---

### T-05 — Exportar `problem` e `ProblemInput` pelo entry principal

Cobre: RF-01

Depende de: T-04

Aceite:
- `src/index.ts`, na seção `// Error` (`src/index.ts:70-72`), contém `export { problem, type ProblemInput } from "./problem.ts";` (D-10).
- `src/_entries/generic.ts` herda a exportação por `export * from "../index.ts"`, e `src/_deprecated.ts` não tem colisão de nome.
- Em `test/unit/package.test.ts`, `"problem"` entra no snapshot entre `"parseCookies"` (`:104`) e `"proxy"` (`:105`), em ordem alfabética. Essa é a única alteração em teste existente, e ela é justificada por RF-01 (D-10).
- `pnpm vitest run test/unit/package.test.ts` passa.
- O critério de RF-01 é atendido: `import { problem, HTTPError } from "h3"` (via `src/index.ts`) devolve um erro `instanceof HTTPError` com `status` 404 e `message` informada.

Arquivos: `src/index.ts`, `test/unit/package.test.ts`

---

### T-06 — Ramo de `problem` em `errorResponse()`

Cobre: RF-03, RF-06, RF-08, RF-09

Depende de: T-04

Aceite:
- Em `src/response.ts`, `errorResponse()` (`:358-380`) verifica `kProblem` como primeira instrução. Com a marca, delega a `problemErrorResponse(error, debug, errHeaders)`, função interna do mesmo arquivo (D-07).
- `problemErrorResponse` mescla `error.headers` e `errHeaders` com `mergeHeaders` (`:243`), define `content-type` como `application/problem+json` por último, e monta o corpo com `JSON.stringify(problemMembers(error, debug), undefined, debug ? 2 : undefined)`. Status e `statusText` vêm do erro.
- Sem a marca, o caminho é idêntico ao atual, com `application/json` e as mesmas chaves (RF-08). `HTTPError.toJSON()` não muda.
- Os casos de T-01 de `throw`, `onError`, cabeçalhos, debug e `HEAD` passam.
- `test/errors.test.ts` passa sem alteração (`:44` e `:53-57`).
- Um erro `problem()` repassado pelo `onError`, que o devolve, chega com o formato problem+json (RF-03).

Arquivos: `src/response.ts`

---

### T-07 — Suíte existente sem alterações de comportamento

Cobre: RF-08, RF-10

Depende de: T-02, T-05, T-06

Aceite:
- `pnpm vitest run` (suíte completa) passa.
- A lista de arquivos alterados em `test/` contém só `test/problem.test.ts` (novo), `test/unit/types.test-d.ts` e `test/unit/package.test.ts` (snapshot). Qualquer outro teste existente alterado precisa ser justificado por RF-03 ou RF-05 e manter a mesma verificação (RF-10).
- `src/error.ts` não tem diff, conforme a tabela da seção 3 do techspec.
- Caminhos fora de `toResponse` (`src/utils/json-rpc.ts`, `src/utils/event-stream.ts`, `src/utils/ws.ts`) não têm diff.

Arquivos: `test/problem.test.ts`, `test/unit/types.test-d.ts`, `test/unit/package.test.ts`, `src/response.ts`, `src/problem.ts`, `src/index.ts`, `src/utils/internal/status-text.ts`

---

### T-08 — Lint, tipagem, build e cobertura

Cobre: RF-12

Depende de: T-07

Aceite:
- `pnpm lint` termina sem erro (oxlint e oxfmt --check).
- `pnpm typecheck` termina sem erro.
- `pnpm build` termina sem erro, e `test/dist.test.ts` passa com `problem` presente nos entries compilados.
- `pnpm test` (lint, typecheck e coverage) termina sem erro. Os ramos de `errorResponse` com marca e sem marca têm ao menos um caso cada, e `src/problem.ts` e `status-text.ts` estão cobertos (techspec, seção 5.4).

Arquivos: nenhum arquivo novo ou alterado. Se o script de cobertura precisar de ajuste (não esperado), a mudança vira tarefa separada.

---

## Fora desta lista

- Mudança de documentação pública (PRD, "Fora de escopo"). Fica como tarefa separada.
- Negociação por `Accept`, validação de `type` como URI, helpers adicionais, Nitro e formato em SSE, WebSocket ou JSON-RPC: fora de escopo no PRD.
- Issue separado sobre `stack` em erros legados `unhandled` com debug (techspec, D-09). Não é implementado aqui, para não mudar RF-08.
