# Tarefas — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-07). Seguir o fluxo do AGENTS.md: teste novo falhando antes da mudança, depois a implementação mínima.

Cobertura: RF-01 (T-03, T-05), RF-02 (T-02, T-05), RF-03 (T-02, T-05), RF-04 (T-01, T-02, T-05), RF-05 (T-02, T-05), RF-06 (T-02, T-05), RF-07 (T-02, T-05), RF-08 (T-03, T-05), RF-09 (T-02, T-05), RF-10 (T-04, T-05, T-06).

### T-01 — Tabela interna de frases-padrão de status

Criar `statusPhrase(status): string | undefined` com uma tabela literal IANA 1xx–5xx (~60 entradas, inglês canônico, 422 = "Unprocessable Content"). Sem dependência nova, sem `node:http`, sem export público (D-05). Escrever antes o teste unitário (falhando).

Cobre: RF-04
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/status-text.test.ts` passa com `statusPhrase(404) === "Not Found"`, `statusPhrase(418)` definido e `statusPhrase(599) === undefined`; o arquivo tem menos de 200 linhas e `pnpm typecheck` passa.
Arquivos: `src/utils/internal/status-text.ts` (novo), `test/unit/status-text.test.ts` (novo)

### T-02 — `type`/`instance` em `HTTPError` e serialização `toProblemDetails`

Em `src/error.ts`: adicionar `type?: string` e `instance?: string` a `ErrorInput` (não a `ErrorBody`, D-02) com JSDoc, dizendo que não são herdados de `cause`. Adicionar as propriedades `readonly type`/`instance` a `HTTPError`, atribuídas no construtor só a partir de `details` e só se `typeof === "string"` (D-03). Criar a função interna `toProblemDetails(error)` ao final do arquivo, exportada do módulo mas **não** de `src/index.ts` (D-01), com as regras de D-04:
- legados (`statusText`, `unhandled`, `message`, `data`) e depois `body`;
- os cinco membros RFC atribuídos por último, inclusive como `undefined`;
- `type` = `error.type ?? "about:blank"`, sempre `"about:blank"` se `unhandled`;
- `title` = `statusText || statusPhrase(status)`;
- `detail` e `instance` ficam `undefined` se `unhandled`.

`toJSON()` delega a `toProblemDetails(this)` com tipo de retorno explícito (`isolatedDeclarations`). Se `ProblemDetails` não exportado falhar no typecheck/build, usar o tipo inline.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09
Depende de: T-01
Aceite: `pnpm typecheck` passa; `new HTTPError({ status: 403, type, instance })` expõe os dois valores e, sem informá-los, ambos são `undefined` (também via `HTTPError.status(...)` e `new HTTPError("msg", { type })`); `JSON.stringify(error)` traz `type`, `title`, `status`, `detail` e `instance` conforme as regras; `body: { status: 200, title: "x" }` não altera os membros RFC; `cause` com `type: "entity.too.large"` não vira `type`; `test/unit/package.test.ts` segue igual (nenhum export novo).
Arquivos: `src/error.ts`

### T-03 — Resposta de erro com `application/problem+json`

Em `src/response.ts`: adicionar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`, sem alterar `jsonHeaders` nem as respostas de sucesso (D-06). Em `errorResponse`, partir de `problemHeaders` e usar `toProblemDetails(error)` em vez de `error.toJSON()`, para que erros "HTTPError-shaped" de terceiros (ex.: `BodyTooLargeError` do srvx) recebam o mesmo documento (D-01). Manter o `stack` em `debug`, a mesclagem de `error.headers`/`errHeaders` e o `content-type` explícito do erro prevalecendo. Não tocar em `onError`, `toError`, `kNotFound`, JSON-RPC, WebSocket nem `h3/rules` (D-07).

Cobre: RF-01, RF-08
Depende de: T-02
Aceite: uma rota que lança `new HTTPError({ status: 400 })` responde 400 com `content-type` começando com `application/problem+json`; `GET /x` sem rota responde 404 com `type: "about:blank"`, `title: "Not Found"` e `detail` "Cannot find any route matching"; respostas de sucesso JSON seguem `application/json;charset=UTF-8`; `pnpm typecheck` passa.
Arquivos: `src/response.ts`

### T-04 — Ajustar testes existentes ao novo `content-type`

Trocar apenas o que mudou, mantendo cenário e intenção: `test/errors.test.ts:44` (`toBe("application/json;charset=UTF-8")` → `toBe("application/problem+json;charset=UTF-8")`, caso 422 com `errHeaders`, GET e HEAD) e `test/errors.test.ts:140` (`toMatch("application/json")` → `toMatch("application/problem+json")`). Não alterar `test/security.test.ts`, `test/router.test.ts` (respostas de sucesso) nem `test/json-rpc*.test.ts`. Se a suíte completa revelar outro teste dependente, aplicar a mesma regra.

Cobre: RF-10
Depende de: T-03
Aceite: `pnpm vitest run test/errors.test.ts` passa; o diff desse arquivo contém só as trocas de `content-type`, sem remoção de asserções; `pnpm vitest run` completo não mostra falhas atribuíveis ao formato.
Arquivos: `test/errors.test.ts`

### T-05 — Testes novos de Problem Details (`describeMatrix`)

Escrever `test/problem-details.test.ts` com `describeMatrix` (web e node), um grupo por requisito, e `t.errors = []` nos casos `unhandled`. Seguindo o fluxo do AGENTS.md, escrever e ver falhar antes de T-02/T-03 e confirmar que passam depois. Casos (techspec, seção 5):
- RF-01: `content-type` de erro e regressão do sucesso JSON.
- RF-02: `type`/`instance` na instância, `undefined` por padrão, via `HTTPError.status` e via construtor com mensagem, sem herança de `cause`.
- RF-03: `about:blank` e URI informado.
- RF-04: frase-padrão, `statusText` custom, `title` omitido para 599 e `body: { title }` sem vazar.
- RF-05: `detail` em erro tratado; `unhandled` sem `detail` nem o texto "segredo interno" (500).
- RF-06: `instance` presente/ausente; `unhandled` não o expõe.
- RF-07: exemplo completo do PRD (422), colisão de chaves de `body`, `stack` em `config.debug`.
- RF-08: `kNotFound`, `throw 404`, erro não-HTTP, erro em middleware, `readValidatedBody`, `onError` retornando erro, HEAD sem corpo, `error.headers` com `content-type` próprio prevalecendo, `errHeaders` mesclados e `createBodyTooLargeError` do srvx.
- RF-09: `JSON.parse(JSON.stringify(error))` igual ao corpo da resposta (sem `stack`).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10
Depende de: T-03
Aceite: `pnpm vitest run test/problem-details.test.ts` passa em web e node; antes de T-02/T-03 os testes novos falham; cada RF-01 a RF-09 tem ao menos um teste.
Arquivos: `test/problem-details.test.ts` (novo)

### T-06 — Documentação, nota de breaking e validação final

Atualizar `docs/1.guide/1.basics/6.error.md` (exemplo de corpo ~linha 42, `content-type` ~linha 60, `type`/`instance` ~linha 90) para o formato Problem Details. Registrar a mudança de `content-type` como *breaking* no `CHANGELOG.md` apenas se o arquivo for mantido à mão (se for gerado automaticamente por changelogen a partir de commits, deixar a nota para a mensagem de commit/release). Rodar a validação completa.

Cobre: RF-10
Depende de: T-04, T-05
Aceite: `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt `--check`) e `pnpm typecheck` terminam sem falhas; `pnpm build` gera as declarações `.d.mts` sem erro de `isolatedDeclarations`; a doc mostra o novo `content-type` e o corpo com `type`/`title`/`status`/`detail`.
Arquivos: `docs/1.guide/1.basics/6.error.md`, `CHANGELOG.md` (condicional)
