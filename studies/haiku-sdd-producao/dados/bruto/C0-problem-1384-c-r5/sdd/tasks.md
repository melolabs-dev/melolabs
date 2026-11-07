# Tarefas — `problem()` (RFC 9457)

Referências: `sdd/prd.md` (RF-01..RF-09) e `sdd/techspec.md` (D-01..D-08). Convenções do `AGENTS.md`: ESM, extensões `.ts`, `isolatedDeclarations`, arquivos curtos, sem barrel files.

Fluxo (AGENTS.md): escrever os testes antes (T-05), confirmar que falham sem a implementação e só então implementar (T-01 a T-04).

### T-01 — Módulo interno: tabela de frases, marca e `problemBody()`
Cobre: RF-03, RF-07
Depende de: nenhuma
Aceite: `pnpm typecheck` passa. `problemBody(error, marca, debug)` segue a precedência de D-03: extensões (`body`/`data`, só se `!unhandled`) vêm primeiro, depois `type` (padrão `about:blank`), `title` (`statusText`, ou a frase do status quando `type` é `about:blank`, ou omitido), `status`, `detail` (`error.toJSON().message`), `instance` e `stack` (só com `debug`). `getProblemMark` tem retorno anotado e `"~problem"` é lido sem expor novo nome público. A tabela cobre 400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 418, 422, 429, 500, 501, 502, 503 e 504, além de outros 4xx/5xx usuais.
Arquivos:
- `src/utils/internal/problem.ts` (novo)

### T-02 — Utilitário público `problem()` e tipo `ProblemInput`
Cobre: RF-01, RF-02
Depende de: T-01
Aceite: `problem({ status: 400 })` devolve uma instância de `HTTPError` com `status` 400 e `HTTPError.isError(...)` retorna `true`. `ProblemInput<DataT>` é uma `interface` que estende `ErrorInput<DataT>` e acrescenta `type?` e `instance?` (strings). A fábrica remove `type`/`instance` do objeto passado ao `HTTPError` e grava a marca `"~problem"` com `Object.defineProperty` (não enumerável, não gravável). A marca não aparece em `Object.keys`, em `JSON.stringify(error)` nem em `toJSON()`. O JSDoc avisa para não interpolar dados internos em `instance`. `pnpm typecheck` passa com `isolatedDeclarations`.
Arquivos:
- `src/utils/problem.ts` (novo)

### T-03 — `errorResponse` escolhe cabeçalhos e corpo pela marca
Cobre: RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-01
Aceite: `problemHeaders` (`application/problem+json;charset=UTF-8`, `FrozenHeaders`) fica ao lado de `jsonHeaders`. `errorResponse` usa `problemHeaders` e `problemBody` quando a marca existe, e mantém exatamente o caminho atual quando não existe. `error.headers` e `errHeaders` continuam mesclados por cima, o que preserva `statusText`, `retry-after` e um `content-type` explícito. A assinatura de `errorResponse` não muda. `pnpm vitest run test/errors.test.ts` continua verde.
Arquivos:
- `src/response.ts`

### T-04 — Exportar `problem` e `ProblemInput` e ajustar o snapshot de exports
Cobre: RF-01, RF-02, RF-09
Depende de: T-02
Aceite: `src/index.ts` exporta `problem` e `type ProblemInput` logo após a linha dos erros, sem barrel file. O snapshot recebe só `"problem",` entre `"parseCookies"` e `"proxy"`. `pnpm vitest run test/unit/package.test.ts` passa e não há outro export novo.
Arquivos:
- `src/index.ts`
- `test/unit/package.test.ts`

### T-05 — Testes de integração (`describeMatrix`, modos `web` e `node`)
Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma (escrever primeiro) e T-02, T-03 e T-04 para passarem
Aceite: antes da implementação, os novos testes falham, e a falha é registrada. Depois dela, `pnpm vitest run test/problem.test.ts` passa nos dois modos, sem erros em `ctx.errors`. Cobertura:
- RF-01: `throw` e `return`, `instanceof` e `isError`.
- RF-03: caso completo do PRD com `toEqual`, `about:blank` com `title` padrão, `type` custom sem `statusText` (sem `title`), `instance` ausente (chave ausente), `body` que não sobrescreve os membros padrão, `data` sob `data`.
- RF-04: 422 com `content-type` `application/problem+json`.
- RF-05: 429 com `statusText` e `retry-after`, e `content-type` explícito respeitado.
- RF-06: `new HTTPError`, `HTTPError.status`, `throw new Error`, 404 de rota inexistente e erro de validação mantêm `application/json` e o corpo atual.
- RF-07: `unhandled: true` sem vazar a mensagem, `data` ou `body`, com `detail: "HTTPError"`, e com `debug` aparece `stack` no formato problem.
- RF-08: `onError` recebe o `HTTPError` 409 marcado, a resposta final continua em `application/problem+json`, um hook que devolve outra resposta substitui o formato, e há variante com hook `async`.
- Ramos com e sem `onError` (padrão de `test/errors.test.ts`).
Arquivos:
- `test/problem.test.ts` (novo)

### T-06 — Testes de tipo para `ProblemInput`
Cobre: RF-02, RF-09
Depende de: T-02, T-04
Aceite: `pnpm typecheck` e `pnpm vitest run test/unit/types.test-d.ts` passam. `problem({ status, message, type, instance })` compila, omitir `type`/`instance` compila, `type: 1` falha com `// @ts-expect-error`, o retorno é `HTTPError<...>` e `expectTypeOf<ProblemInput>().toMatchTypeOf<ErrorInput>()` vale.
Arquivos:
- `test/unit/types.test-d.ts`

### T-07 — Verificação final de qualidade e regressão
Cobre: RF-06, RF-09
Depende de: T-03, T-04, T-05, T-06
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` terminam sem erros, inclusive a formatação da tabela de frases (oxfmt). O único teste existente alterado é o snapshot de exports e nenhum arquivo fora da lista das tarefas foi modificado (`git status`). `src/error.ts` está intacto e nenhum nome público novo além de `problem` e `ProblemInput` foi criado.
Arquivos:
- (nenhum arquivo novo; só verificação)

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04, T-05 |
| RF-02 | T-02, T-04, T-06 |
| RF-03 | T-01, T-05 |
| RF-04 | T-03, T-05 |
| RF-05 | T-03, T-05 |
| RF-06 | T-03, T-05, T-07 |
| RF-07 | T-01, T-03, T-05 |
| RF-08 | T-03, T-05 |
| RF-09 | T-04, T-05, T-06, T-07 |
