# Tarefas de implementação — `problem()` (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08). Fluxo do AGENTS.md: escrever os testes primeiro, confirmar que falham, implementar e então rodar a suíte.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-03, T-07 |
| RF-02 | T-02, T-04, T-07 |
| RF-03 | T-04, T-07 |
| RF-04 | T-02, T-04, T-07 |
| RF-05 | T-02, T-03, T-07 |
| RF-06 | T-02, T-04, T-07 |
| RF-07 | T-04, T-07 |
| RF-08 | T-01, T-05, T-06, T-08 |

### T-01 — Teste de integração `test/problem.test.ts` (escrito antes do código)

Criar `test/problem.test.ts` com `describeMatrix` (web e node), seguindo o padrão de `test/errors.test.ts`. Usar `t.app.config.debug = false` nos casos de igualdade exata e limpar `t.errors = []` nos casos `unhandled`. Casos da techspec §5:

- instância de `HTTPError` e `HTTPError.isError` verdadeiro, com status 404 (RF-01);
- exemplo 422 completo, com corpo exato, sem `statusText`/`message` e com `title` preservando o acento (RF-02);
- `content-type` começa com `application/problem+json` e o valor do chamador em `headers` prevalece (RF-03);
- `{ status: 404 }` dá `type: "about:blank"`, `title: "Not Found"` e nenhum `detail` falso (RF-04);
- `retry-after`, `body`, `data` objeto espalhado, `data` não objeto sob a chave `data`, `cause` preservada (RF-05);
- `body`/`data` com `type`, `status`, `title`, `detail`, `instance` não sobrescrevem os padrão (RF-02);
- `unhandled: true` sem `segredo`, sem `x`, sem `type`/`instance` customizados (RF-06);
- `new HTTPError`, `HTTPError.status`, `throw new Error`, rota inexistente e `throw 404` mantêm `application/json;charset=UTF-8` e o corpo atual (RF-07);
- `onError` global devolvendo `undefined` mantém o formato; `new HTTPError({ cause: problem(...) })` herda status/headers mas responde `application/json` (D-06);
- `HEAD` e `GET` com `event.res.errHeaders`: `set-cookie` sem duplicar e corpo vazio no HEAD;
- `debug: true` adiciona `stack` ao corpo problem.

Cobre: RF-08
Arquivos: `test/problem.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` roda e os casos de problem details (RF-01 a RF-06 e D-06) **falham** antes da implementação; os casos de RF-07 já passam.

### T-02 — Helper interno `src/utils/internal/problem.ts`

Criar o módulo interno, sem exportar pelo `index.ts`:

- `ProblemMeta` (`type`, `instance`, `title`, `detail`) e a constante `kProblem = "~problem"` (D-02);
- mapa mínimo `Record<number, string>` de textos padrão de status (400-451 e 500-511 mais comuns), sem dependência nova (D-04);
- `toProblemJSON(error, meta)`: `status = error.status`; `type = meta.type || "about:blank"`; `title = meta.title || texto padrão` (omitido se não houver); `detail` e `instance` omitidos quando ausentes; extensões de `data` (objeto simples espalhado, outro tipo sob a chave `data`) e depois de `body`; membros padrão com precedência final (D-04 itens 1-5);
- erro `unhandled`: corpo mínimo `{ type: "about:blank", status, title }`, sem `detail`, `instance`, `data` nem `body` (D-04 item 6).

Tipos explícitos em tudo que for exportado (`isolatedDeclarations`). Arquivo com menos de 200 linhas.

Cobre: RF-02, RF-04, RF-05, RF-06
Arquivos: `src/utils/internal/problem.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa; revisão confirma que `toProblemJSON` produz as saídas da tabela da techspec §4 (404, 429 com `saldo`, 500 `unhandled`, `body` com `status: 999`).

### T-03 — Função pública `problem()` e reexport em `src/index.ts`

Criar `src/utils/problem.ts` com `ProblemInput<DataT> extends ErrorInput<DataT>` (`type?: string`, `instance?: string`) e `problem<DataT>(input): HTTPError<DataT>` (D-07). Antes de construir o erro, capturar `title = input.statusText ?? input.statusMessage` e `detail = input.message` crus, ignorando strings vazias e `type`/`instance` não string (D-03). Construir com `new HTTPError(input)` e gravar a marca com `Object.defineProperty(error, "~problem", { value: meta })`, não enumerável (D-02). Reexportar `export { problem, type ProblemInput } from "./utils/problem.ts";` ao lado do bloco "Error" de `src/index.ts`. Nenhum outro nome público novo. `HTTPError.toJSON()` e `src/error.ts` ficam intactos (D-08).

Cobre: RF-01, RF-05
Arquivos: `src/utils/problem.ts`, `src/index.ts`
Depende de: T-02
Aceite: `import { problem } from "h3"` funciona; `problem({ status: 404 })` é `HTTPError` e `HTTPError.isError(...)` é `true`; `JSON.stringify(error)` não contém `~problem`; `pnpm typecheck` passa.

### T-04 — Integrar o formato problem em `errorResponse` (`src/response.ts`)

- Importar o helper de `src/utils/internal/problem.ts` no topo;
- adicionar `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` junto a `jsonHeaders` (D-05);
- em `errorResponse`, ler `error["~problem"]`: com a marca, usar `problemHeaders` como base e `toProblemJSON` como corpo; sem a marca, manter o fluxo atual intacto. O merge de `error.headers` e `errHeaders` não muda, então o `content-type` do chamador prevalece;
- `stack` em `debug` e a indentação do `JSON.stringify` continuam como hoje.

Mudança pequena (~6 linhas) em `errorResponse`, com a lógica pesada no helper.

Cobre: RF-02, RF-03, RF-04, RF-06, RF-07
Arquivos: `src/response.ts`
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa por inteiro; os casos antes falhando em T-01 agora passam e `test/errors.test.ts` passa sem alteração.

### T-05 — Ajustar o snapshot de exports em `test/unit/package.test.ts`

Inserir `"problem",` entre `"parseCookies"` e `"proxy"` na lista ordenada de exports. É o único teste existente afetado; o que ele verifica (conjunto exato de exports) permanece. `ProblemInput` é só tipo e não entra na lista.

Cobre: RF-08
Arquivos: `test/unit/package.test.ts`
Depende de: T-03
Aceite: `pnpm vitest run test/unit/package.test.ts` passa.

### T-06 — Teste de tipos de `problem`/`ProblemInput`

Em `test/unit/types.test-d.ts`, importando de `../../src/index.ts`, adicionar `expectTypeOf` para: `problem` aceita `type` e `instance` strings e todos os campos de `ErrorInput`; retorna `HTTPError<DataT>`; `type: 123` gera erro com `// @ts-expect-error`.

Cobre: RF-08
Arquivos: `test/unit/types.test-d.ts`
Depende de: T-03
Aceite: `pnpm typecheck` (e `pnpm vitest run test/unit/`) passa e o `@ts-expect-error` não fica sem uso.

### T-07 — Documentação (opcional) em `docs/1.guide/1.basics/6.error.md`

Adicionar parágrafo curto com exemplo de `throw problem({ ... })` e o resultado `application/problem+json`, perto da seção `## Unhandled Errors`. Mencionar que só erros criados por `problem()` mudam de formato. Não altera código.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Arquivos: `docs/1.guide/1.basics/6.error.md`
Depende de: T-04
Aceite: o exemplo do doc coincide com o contrato da techspec §4; `pnpm lint` (oxfmt) passa no arquivo.

### T-08 — Verificação final

Rodar `pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test`. Corrigir regressões ajustando só o que a mudança altera. Confirmar que `src/error.ts`, `src/h3.ts`, `src/middleware.ts`, `src/utils/middleware.ts`, `src/utils/json-rpc.ts` e `src/_deprecated.ts` não foram modificados (`git status`). Registrar como pendência o ponto R-05 da techspec (corpo mínimo em `unhandled` também oculta `type` e `instance`), que depende de confirmação do dono do PRD.

Cobre: RF-08
Arquivos: nenhum (somente verificação)
Depende de: T-01, T-04, T-05, T-06, T-07
Aceite: `pnpm test`, `pnpm lint` e `pnpm typecheck` passam sem erros; `git status` mostra apenas os arquivos listados nas tarefas T-01 a T-07.
