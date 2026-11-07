# Tarefas de implementação — `problem(input)` (RFC 9457)

Origem: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (D-01 a D-09).

Ordem sugerida: T-01 → T-02 → T-03 → T-04 → T-05 → T-06. Os testes vêm primeiro, conforme o fluxo de correção do AGENTS.md: eles precisam falhar antes da implementação.

### T-01 — Escrever os testes de integração e de tipos (devem falhar)

Criar `test/problem.test.ts` com `describeMatrix` (modos `web` e `node`) e o bloco `describe("problem")` em `test/unit/types.test-d.ts`. Os testes de integração cobrem:

- `problem` importado de `../src/index.ts`, `HTTPError.isError` verdadeiro e o status lançado.
- `content-type` `application/problem+json`.
- Corpo do 404 sem `instance` nem `detail`, e o caso completo do 422 com as chaves exatas.
- Status 500 sem `status` e com `statusCode` descontinuado.
- Extensões na raiz, `data` sob `data`, e `body` com `status`/`type` sem sobrescrever os membros padrão.
- `unhandled` sem vazamento de `detail`, `data` e extensões.
- Cabeçalhos: `www-authenticate` preservado, `content-type` do usuário ignorado, e `errHeaders` mesclado inclusive com `content-type`.
- `stack` com `debug` ligado e desligado.
- Regressão: `new HTTPError`, `HTTPError.status` e `toJSON` continuam com `application/json` e corpo legado, e um erro comum no mesmo app não muda.
- Cadeia: `problem({ status: 409 })` lançado em handler, lançado em middleware, retornado por handler e usado em hooks `onError` (app e middleware), todos com o mesmo status e corpo.
- HEAD sem corpo.

Os testes de tipos cobrem:

- A chamada completa do RF-02 compila.
- `@ts-expect-error` para `type: 1` e `instance: {}`.
- `problem<{ a: number }>(...)` retorna `HTTPError<{ a: number }>`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-12
Arquivos:
- `test/problem.test.ts` (novo)
- `test/unit/types.test-d.ts`

Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` falha porque o export `problem` não existe, e a falha é só essa ausência. O arquivo usa imports com `.ts` e `describeMatrix`. Os testes de regressão de erros comuns passam mesmo antes da implementação.

### T-02 — Criar o helper interno `problemBody` (marca, tabela de frases e corpo)

Criar `src/utils/internal/problem.ts` com:

- A constante `kProblem = "~problem"` e a interface `ProblemMark` (`type`, `instance`, `detail`).
- Uma tabela enxuta e interna de frases HTTP (`Record<number, string>`, sem `node:http`).
- A função `problemBody(error, debug)`, que monta o corpo com a ordem e as regras abaixo:
  - Membros: `type` (padrão `"about:blank"`), `status` (de `error.status`), `title` (`statusText` ou frase padrão, omitido se desconhecido), `detail` e `instance`.
  - Extensões: `data` e depois as chaves de `body`, sem sobrescrever os membros padrão.
  - `stack`: só em `debug`, como array de linhas.
  - `unhandled`: só `type`, `status` e `title` (frase padrão), sem `detail`, `instance`, `data` nem extensões. O `stack` em `debug` segue a regra legada.

Todas as exportações têm tipos explícitos (`isolatedDeclarations`). O arquivo fica com menos de 200 linhas.

Cobre: RF-04, RF-05, RF-06, RF-07, RF-09, RF-12
Arquivos:
- `src/utils/internal/problem.ts` (novo)

Depende de: nenhuma
Aceite: `pnpm typecheck` passa com o arquivo. A revisão confirma que `problemBody` não altera `toJSON` nem `error.ts`. Os testes de corpo de T-01 passam depois de T-03 e T-04.

### T-03 — Implementar o utilitário público `problem()` e o tipo `ProblemInput`

Criar `src/utils/problem.ts` com:

- `interface ProblemInput<DataT = unknown> extends ErrorInput<DataT>`, com `type?: string` e `instance?: string`.
- `problem(input)`, que faz `new HTTPError(input)`, define `~problem` com `Object.defineProperty` (não enumerável, não gravável, não configurável) guardando `type`, `instance` e `detail`, e devolve o erro.
- `detail` vem de `input.message` quando for uma string não vazia (D-02).

Retorno anotado explicitamente como `HTTPError<DataT>`.

Cobre: RF-01, RF-02, RF-04, RF-12
Arquivos:
- `src/utils/problem.ts` (novo)

Depende de: T-02
Aceite: `pnpm typecheck` passa. Os testes de tipos de T-01 passam, com `type`/`instance` não string rejeitados em compilação. `Object.keys(problem({status: 400}))` e `JSON.stringify` do erro não mostram `~problem`.

### T-04 — Adicionar o ramo problem em `errorResponse`

Em `src/response.ts`, no `errorResponse`:

- Quando `error["~problem"]` existir, mesclar `error.headers` e `errHeaders` como hoje.
- Em seguida, forçar `headers.set("content-type", "application/problem+json;charset=UTF-8")`.
- O corpo vem de `problemBody(error, debug)`, serializado com `JSON.stringify`.
- Sem a marca, o código legado roda sem nenhuma alteração.
- Importar o helper interno junto aos imports do arquivo.
- Não alterar `src/error.ts`, `src/handler.ts` nem `src/utils/middleware.ts`.

Cobre: RF-03, RF-05, RF-07, RF-08, RF-09, RF-10, RF-11
Arquivos:
- `src/response.ts`

Depende de: T-02, T-03
Aceite: `pnpm vitest run test/problem.test.ts` passa nos modos `web` e `node`. `pnpm vitest run test/errors.test.ts` e as demais suítes de erro continuam passando sem alteração. O diff de `src/response.ts` fica restrito ao import e ao ramo novo.

### T-05 — Exportar `problem` e `ProblemInput` e ajustar o snapshot de exports

- Em `src/index.ts`, adicionar uma seção `// Problem` com `export { problem } from "./utils/problem.ts"` e `export type { ProblemInput } from "./utils/problem.ts"`.
- Em `test/unit/package.test.ts`, inserir `"problem"` entre `"parseCookies"` e `"proxy"`, em ordem alfabética. Este é o único ajuste em teste existente, e não enfraquece nenhuma asserção.

Nenhum export existente é removido ou alterado, e não há outro nome público novo.

Cobre: RF-01, RF-02, RF-10, RF-12
Arquivos:
- `src/index.ts`
- `test/unit/package.test.ts`

Depende de: T-03
Aceite: `pnpm vitest run test/unit/package.test.ts` passa com a única diferença sendo `"problem"` no snapshot. `problem` e `ProblemInput` são importáveis de `h3`. Nenhum outro nome novo aparece no snapshot.

### T-06 — Verificação final e documentação mínima

- Rodar `pnpm vitest run`, `pnpm lint`, `pnpm typecheck` e `pnpm test`.
- Corrigir apenas o que a mudança afetar, sem enfraquecer asserções existentes.
- Opcional e curto: uma seção sobre `problem` em `docs/1.guide/1.basics/6.error.md`, incluindo a nota de que `JSON.stringify(error)` e `toJSON` continuam no formato legado e de que reembrulhar manualmente o erro perde a marca.
- Confirmar a convenção do repositório: imports com `.ts`, sem barrel files, helpers internos em `utils/internal/` e arquivos curtos.

Cobre: RF-10, RF-12
Arquivos:
- `docs/1.guide/1.basics/6.error.md` (opcional)

Depende de: T-01, T-02, T-03, T-04, T-05
Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run` e `pnpm test` terminam sem erros nos modos `web` e `node`. O único teste existente alterado é `test/unit/package.test.ts`. Os testes novos de T-01 falhavam antes da implementação e passam agora.

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-03, T-05 |
| RF-02 | T-01, T-03, T-05 |
| RF-03 | T-01, T-04 |
| RF-04 | T-01, T-02, T-03 |
| RF-05 | T-01, T-02, T-04 |
| RF-06 | T-01, T-02 |
| RF-07 | T-01, T-02, T-04 |
| RF-08 | T-01, T-04 |
| RF-09 | T-01, T-02, T-04 |
| RF-10 | T-01, T-04, T-05, T-06 |
| RF-11 | T-01, T-04 |
| RF-12 | T-01, T-02, T-03, T-05, T-06 |
