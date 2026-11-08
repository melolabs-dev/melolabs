# Tarefas — `problem()` (RFC 9457) via utilitário explícito

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08). Ordem seguida: testes primeiro, ver falhar, implementar, ver passar (fluxo de bug fix do `AGENTS.md`).

## Cobertura dos requisitos

| RF    | Tarefas          |
| ----- | ---------------- |
| RF-01 | T-01, T-04, T-06 |
| RF-02 | T-02, T-04       |
| RF-03 | T-01, T-03       |
| RF-04 | T-01, T-03       |
| RF-05 | T-01, T-03       |
| RF-06 | T-01, T-03, T-05 |
| RF-07 | T-01, T-03       |
| RF-08 | T-01, T-05       |

### T-01 — Escrever os testes de runtime de `problem()` (devem falhar)

Criar `test/problem.test.ts` com `describeMatrix` (modos `web` e `node`), no padrão de `test/errors.test.ts`. Casos, conforme techspec §5: instância de `HTTPError` com status 404; `throw` e `return` geram a mesma resposta; corpo completo do exemplo do RF-03; só `status` (sem `type`, `title`, `detail`, `instance`); `message` omitida sem `detail`; `content-type` começando com `application/problem+json` e `content-type` próprio em `headers` prevalecendo; `body` na raiz sem sobrescrever `status` nem `type`, e `data` sob a chave `data`; regressão dos erros comuns (`new HTTPError`, `HTTPError.status`, 404 de rota, `kNotFound`) mantendo formato e `application/json`; `unhandled: true` sem vazar "segredo interno", `detail`, `type`, `instance`, `data` e `body`; `unhandled` com `debug` trazendo `stack` sem a mensagem; mesclagem de headers do erro e `event.res.errHeaders` com `set-cookie` sem duplicar, com e sem `onError`; HEAD sem corpo e sem `content-length`; `Object.keys` sem `~problem` e `JSON.stringify` igual ao de `HTTPError`.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` executa e os casos de `problem()` falham (ainda não existe o export); os casos de regressão do RF-06 já passam.
Arquivos: `test/problem.test.ts` (novo)

### T-02 — Escrever os testes de tipo de `ProblemInput` (devem falhar)

Em `test/unit/types.test-d.ts`, adicionar testes: `problem({ status, message, headers, data, type, instance })` compila; `type: 1` e `instance: 1` com `// @ts-expect-error`; o retorno é `HTTPError`.

Cobre: RF-02
Depende de: nenhuma
Aceite: `pnpm typecheck` falha apontando que `problem`/`ProblemInput` não existem em `h3`.
Arquivos: `test/unit/types.test-d.ts`

### T-03 — Serialização problem details em `errorResponse`

Criar `src/utils/internal/problem.ts` com `kProblem = "~problem"`, o tipo `ProblemMark` (`type?`, `instance?`, `detail?`), `getProblem(error)` e `problemBody(error, mark)`. Ordem do corpo: `...body`, membros padrão (`type`, `title`, `status`, `detail`, `instance`) e por último `data` só se definido. `type` e `instance` só entram se `typeof === "string"`. Com `error.unhandled`, o corpo é apenas `{ title, status }`. Em `src/response.ts`, adicionar `problemHeaders` (`application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders` e alterar `errorResponse` para escolher a base de headers e o corpo pela marca, mantendo `mergeHeaders` e o `stack` em `debug`. Sem marca, o caminho atual fica idêntico. Não alterar `src/error.ts`.

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-01
Aceite: `pnpm vitest run test/errors.test.ts` passa sem nenhuma edição no arquivo (RF-06) e `pnpm typecheck` não acusa erros em `src/`. Os casos de `problem()` de T-01 passam depois de T-04.
Arquivos: `src/utils/internal/problem.ts` (novo), `src/response.ts`

### T-04 — `problem()`, `ProblemInput` e export público

Criar `src/utils/problem.ts` com `ProblemInput<DataT>` (estende `ErrorInput<DataT>` com `type?` e `instance?` strings) e `problem()`. A função cria `new HTTPError(details)` sem `type` e `instance`, define `~problem` não enumerável via `Object.defineProperty` com `{ type, instance, detail: input.message || undefined }` e devolve o erro, com retorno anotado por causa de `isolatedDeclarations` (usar `as HTTPError<DataT>` se o typecheck exigir). Exportar apenas `problem` e o tipo `ProblemInput` em `src/index.ts`, sem barrel, e não reexportar `kProblem`. Atualizar o snapshot de exports em `test/unit/package.test.ts`, inserindo `"problem"` entre `"parseCookies"` e `"proxy"`.

Cobre: RF-01, RF-02
Depende de: T-03
Aceite: `pnpm vitest run test/problem.test.ts test/unit` passa (inclui o snapshot de exports com só `"problem"` a mais) e `pnpm typecheck` passa, com os testes de tipo de T-02 verdes e `type: 1` e `instance: 1` falhando como esperado.
Arquivos: `src/utils/problem.ts` (novo), `src/index.ts`, `test/unit/package.test.ts`

### T-05 — Verificação completa e conferência de exports

Rodar `pnpm fmt` e depois `pnpm lint`, `pnpm typecheck` e `pnpm test`. Conferir que os únicos símbolos novos em `src/index.ts` são `problem` e `ProblemInput`, que `src/error.ts` não foi alterado e que `test/errors.test.ts` não foi editado. Corrigir apenas o que a verificação apontar.

Cobre: RF-06, RF-08
Depende de: T-02, T-04
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` passam; `git diff --stat` mostra apenas os arquivos listados nas tarefas T-01 a T-06; `test/problem.test.ts` passa nos modos `web` e `node`.
Arquivos: nenhum além dos já listados (ajustes de formatação por `pnpm fmt`)

### T-06 — Documentar `problem()` no guia de erros

Adicionar uma seção curta em `docs/1.guide/1.basics/6.error.md` (perto da linha 11) com exemplo de `throw problem({...})`, o corpo e o `content-type` resultantes, a regra de precedência dos membros padrão sobre `body` e o aviso de que a marca se perde em cópias do erro (`new HTTPError({ cause })`, spread).

Cobre: RF-01
Depende de: T-04
Aceite: a seção existe, o exemplo corresponde à saída testada em `test/problem.test.ts` e `pnpm fmt` não gera alterações adicionais no arquivo.
Arquivos: `docs/1.guide/1.basics/6.error.md`
