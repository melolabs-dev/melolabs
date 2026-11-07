# Tarefas — Problem details (RFC 9457) via `problem()`

Origem: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09). Seguem o fluxo do projeto: testes primeiro (T-01, T-02), confirmar que falham, implementar (T-03 a T-06) e rodar a suíte completa (T-07).

### T-01 — Escrever os testes de integração de `problem()` (devem falhar)

Criar `test/problem.test.ts` com `describeMatrix` (modos `web` e `node`), um `it` por critério de aceite do PRD, conforme a seção 5 do techspec:

- `throw` e `return` de `problem()` em rota, em middleware (`app.use`), no `onError` de config e no middleware `onError()`.
- Content-type `application/problem+json`, `retry-after` preservado, `content-type` explícito em `headers` respeitado.
- Corpo exato dos dois exemplos do PRD (RF-04 e RF-05), `title` por `statusText` e pela tabela, status fora da tabela sem `title`, `detail` omitido sem `message`.
- Extensões: `body` e `data`; chaves padrão de `body` não sobrescrevem; `__proto__` próprio (via `JSON.parse`) não altera o protótipo.
- Debug desligado (`new H3({ debug: false })`) com `unhandled: true`: sem `message`, `data`, `body`, `cause` nem `stack`. Em debug, `stack` presente como extensão.
- Erros comuns (`new HTTPError`, `HTTPError.status`, `Error` genérico, 404 de rota, erro de validação) mantêm `application/json;charset=UTF-8` e o formato atual.
- `toJSON()` de `problem()` igual ao corpo enviado; `toJSON()` de `HTTPError` comum inalterado; `Object.keys(error)` e `JSON.stringify(error)` sem `~problem`.
- D-09: `new HTTPError({ cause: problem({ status: 409 }) })` responde no formato atual.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
Arquivos: `test/problem.test.ts` (novo)
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` roda e os testes de `problem()` falham (função ainda inexistente). Os testes de RF-09 podem passar. Nenhum teste existente é alterado.

### T-02 — Escrever os testes de tipo de `ProblemInput` (devem falhar)

No fim do `describe("types")` de `test/unit/types.test-d.ts`, adicionar com `expectTypeOf`: a chamada completa do RF-02 (`status`, `message`, `data`, `type`, `instance`, `headers`) é aceita; um campo desconhecido é rejeitado com `// @ts-expect-error`; `problem()` retorna `HTTPError<DataT>`.

Cobre: RF-02, RF-01, RF-11
Arquivos: `test/unit/types.test-d.ts`
Depende de: nenhuma
Aceite: antes da implementação, `pnpm typecheck` falha apontando que `problem` não é exportado por `h3`. Depois de T-04, passa sem erros nem `@ts-expect-error` não usado.

### T-03 — Tabela interna de frases de status HTTP

Criar `getStatusText(status: number): string | undefined` com uma tabela pequena de códigos 1xx–5xx registrados na IANA. Sem `http.STATUS_CODES` do Node, para manter a portabilidade (D-04). Retorna `undefined` para status fora da tabela. Tipo de retorno explícito (`isolatedDeclarations`).

Cobre: RF-05
Arquivos: `src/utils/internal/status-text.ts` (novo)
Depende de: nenhuma
Aceite: `getStatusText(404) === "Not Found"` e `getStatusText(599) === undefined`. `pnpm typecheck` passa. O arquivo não é importado por `src/error.ts`.

### T-04 — Implementar `problem()`, `ProblemInput` e a exportação pública

Criar `src/utils/problem.ts` conforme D-01, D-02, D-05, D-06 e D-09:

- `ProblemInput<DataT> extends ErrorInput<DataT>` com `type?` e `instance?`.
- `problem()` separa `type` e `instance` de `rest`, cria `new HTTPError<DataT>(rest)` e define `~problem` com `Object.defineProperty` (não enumerável). O valor é o serializador do corpo, que captura `input.message`.
- `toProblemBody` (interno): ordem `type` (padrão `"about:blank"`), `title` (`statusText` → `getStatusText` → omitido), `status`, `detail` (só com `message` explícito não vazio), `instance`. Extensões na ordem `data` e `body`, com os membros padrão sempre vencendo. Cópia por `Object.fromEntries`. `type` e `instance` só entram se forem `string`. Com `unhandled`, omite `detail`, `data` e `body`.

Exportar em `src/index.ts` (grupo "Error"): `export { problem, type ProblemInput } from "./utils/problem.ts";`. Adicionar `"problem"` ao snapshot de `test/unit/package.test.ts`, entre `"parseCookies"` e `"proxy"`.

Cobre: RF-01, RF-02, RF-04, RF-05, RF-06, RF-10
Arquivos: `src/utils/problem.ts` (novo), `src/index.ts`, `test/unit/package.test.ts`
Depende de: T-03
Aceite: `pnpm typecheck` passa, incluindo os testes de tipo de T-02. `test/unit/package.test.ts` passa com `problem` como único export novo de valor. Em `test/problem.test.ts`, passam os casos de corpo, padrões, extensões e `unhandled`. Os casos de content-type ainda dependem de T-05.

### T-05 — Ramo isolado em `errorResponse` com `problemHeaders`

Em `src/response.ts`, ao lado de `jsonHeaders`, adicionar `problemHeaders` (frozen, `content-type: application/problem+json;charset=UTF-8`). Em `errorResponse`, ler `error["~problem"]` uma vez e escolher a base de cabeçalhos: `problemHeaders` quando houver marca, senão `jsonHeaders`. Manter a ordem `base < error.headers < errHeaders` e o corpo `JSON.stringify({ ...error.toJSON(), stack })`, com `stack` só em debug (D-03). Sem a marca, o caminho executado é o atual.

Cobre: RF-03, RF-07, RF-08, RF-09, RF-10
Arquivos: `src/response.ts`
Depende de: T-04
Aceite: `pnpm vitest run test/problem.test.ts` passa nos casos de content-type, `retry-after`, `content-type` explícito, `throw`/`return` idênticos (web e node), middleware e `onError`. `pnpm vitest run test/errors.test.ts` passa sem alterações nas asserções.

### T-06 — `toJSON()` reflete o corpo de problem details

Em `src/error.ts`, `HTTPError.toJSON()` ganha como primeira instrução um ramo `this["~problem"]?.(this)`. A assinatura e o tipo de retorno não mudam. Usar um `as` de uma linha, com comentário explicando que o formato é uma variante em runtime (D-08). A propriedade não é declarada na classe. O caminho de erros comuns fica intacto.

Cobre: RF-11
Arquivos: `src/error.ts`
Depende de: T-04
Aceite: em `test/problem.test.ts`, `problem(...).toJSON()` é igual ao corpo enviado. O `toJSON()` de `new HTTPError(...)` é igual ao literal anterior. `Object.keys(error)` e `JSON.stringify(error)` não contêm `~problem`. `pnpm typecheck` passa sem mudar tipos existentes.

### T-07 — Verificação final e regressão

Rodar a suíte completa e corrigir qualquer falha causada pela mudança. Conferir que nenhuma asserção de teste existente foi alterada (só o snapshot de exports, por T-04). Conferir que `src/h3.ts`, `src/adapters.ts`, `src/utils/middleware.ts`, `src/types/*` e `docs/` não foram tocados.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
Arquivos: nenhum arquivo novo (apenas ajustes pontuais nos arquivos de T-01 a T-06, se necessário)
Depende de: T-01, T-02, T-05, T-06
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. `git status` mostra só os arquivos listados nas tarefas T-01 a T-06 e `sdd/`.
