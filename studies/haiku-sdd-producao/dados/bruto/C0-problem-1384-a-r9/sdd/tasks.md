# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-10).
Seguindo o fluxo do `AGENTS.md`, os testes são escritos primeiro (T-01, T-02) e devem falhar até as tarefas de implementação (T-03 a T-06) serem concluídas. Nenhum nome é adicionado a `src/index.ts`.

### T-01 — Testes de integração de problem details (escrever primeiro)
Criar `test/problem-details.test.ts` com `describeMatrix` (web e node), `app.config.problemDetails = true` por caso e ajuste de `debug`/`allowUnhandledErrors` conforme `test/_setup.ts`. Casos:
- RF-01: sem a opção e com `false`, `Content-Type: application/json;charset=UTF-8` e as mesmas chaves legadas; `toJSON()` sem `type`/`instance`.
- RF-02: `new HTTPError({ status: 404 })`, `throw 404` e rota inexistente retornam 404 com `application/problem+json`.
- RF-03: exemplo completo do PRD (403 com `type`/`instance`); padrões (`about:blank`, `title` padrão, `detail` omitido); `statusText` customizado sem `message` sem `detail`; mensagem explícita gera `detail`.
- RF-05: `body: { errors, status: 200 }` + `data` resulta em `status: 422`, `errors` e `data`; `body` com `type`/`title`/`detail`/`instance` não sobrescreve; precedência de `body.data` sobre `data`.
- RF-06: `throw new Error("segredo interno")` e `throw {…}` sem `debug` dão 500, problem+json e corpo sem a string; sem `data`/`body`; com `debug` aparece `stack` e não `message`.
- RF-07: `debug: true` + `headers: { "x-id": "1" }` traz `stack`, `x-id` e problem+json; `Content-Type` explícito do erro prevalece; `event.res.errHeaders` mesclado; `statusText` aplicado.
- Extra: `app.config.problemDetails = true` após criar o app; `onResponse` middleware devolvendo `HTTPError`; `data` circular continua virando 500; `HEAD` sem corpo.

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/problem-details.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts` roda e os casos de problem details falham antes da implementação (confirmar a falha); após T-06 todos passam em `web` e `node`.

### T-02 — Testes unitários de `type` e `instance` em `HTTPError`
Adicionar teste unitário (sem matriz) para: `error.type`/`error.instance` com os valores informados; `undefined` quando ausentes; leitura via `cause`; `HTTPError.status(400, undefined, { type, instance })`; valores não-string em `cause` viram `undefined`; `toJSON()` não contém `type`/`instance`. Colocar em `test/unit/` seguindo o padrão dos testes de `HTTPError` existentes (criar `test/unit/error.test.ts` se não houver arquivo adequado).

Cobre: RF-04, RF-08
Arquivos: `test/unit/error.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/error.test.ts` falha antes de T-04 e passa depois.

### T-03 — Opção `problemDetails` em `H3Config`
Adicionar `problemDetails?: boolean` em `H3Config`, logo após `silent`, com TSDoc (padrão `false`, descreve `application/problem+json`, membros padrão e a troca `message`→`detail`, `statusText`→`title`).

Cobre: RF-01
Arquivos: `src/types/h3.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa e `new H3({ problemDetails: true })` compila; `app.config.problemDetails` tem tipo `boolean | undefined`.

### T-04 — `HTTPError` aceita e expõe `type` e `instance`
Em `ErrorInput` adicionar `type?: string` e `instance?: string` com TSDoc (RFC 9457 §3.1.1 e §3.1.5). Na classe, adicionar `readonly type: string | undefined` e `readonly instance: string | undefined` (tipos explícitos por `isolatedDeclarations`). No construtor, ler de `details` e de `details.cause` aceitando apenas `typeof === "string"` (D-03). Não alterar `toJSON()` nem `ErrorBody` (D-02); `HTTPError.status(...)` já repassa por spread.

Cobre: RF-04
Arquivos: `src/error.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/error.test.ts` passa; `toJSON()` inalterado; `pnpm typecheck` passa.

### T-05 — Módulo interno `problem.ts`
Criar `src/utils/internal/problem.ts` (não exportado em `src/index.ts`) com: tabela privada de textos de status IANA 1xx–5xx (~60 entradas, fallback `"Error"`); `problemContentType = "application/problem+json;charset=UTF-8"`; `problemBody(error, debug?)` conforme D-05 a D-07 — membros `type` (`"about:blank"` por padrão), `title`, `status`, `detail` (omitido se genérico ou `unhandled`), `instance`; extensões `data` → chaves de `body` → membros padrão (nesta ordem de precedência); `stack` por último só com `debug`; para `unhandled`, apenas `type`, `title` padrão, `status`, `instance` e `stack`. Imports com extensão `.ts`; arquivo abaixo de 200 linhas.

Cobre: RF-02, RF-03, RF-05, RF-06
Arquivos: `src/utils/internal/problem.ts`
Depende de: T-04
Aceite: `pnpm typecheck` e `pnpm lint` passam; `problemBody` é exercitado pelos testes de T-01 após T-06.

### T-06 — Ligar a opção em `errorResponse`
Em `src/response.ts`, importar `problemBody` e `problemContentType`; na chamada de `errorResponse` (linha ~173) passar `config.problemDetails ?? event.app?.config.problemDetails` como 4º parâmetro; em `errorResponse`, com a opção ligada usar `content-type: problem+json` como base de cabeçalhos e `problemBody` como corpo, mantendo a mescla de `error.headers` e `errHeaders`, `statusText` e indentação de `debug`. Com a opção desligada o caminho atual permanece idêntico (D-09). Não alterar o padrão de `config` de `toResponse` (D-08).

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07
Arquivos: `src/response.ts`
Depende de: T-03, T-04, T-05
Aceite: `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa; testes existentes de erro inalterados passam com a opção desligada.

### T-07 — Testes de tipos
Em `test/unit/types.test-d.ts` (bloco `describe("types")`) adicionar: `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()`; `ErrorInput` aceita `type`/`instance` strings e rejeita número; `HTTPError["type"]` e `HTTPError["instance"]` são `string | undefined`.

Cobre: RF-08
Arquivos: `test/unit/types.test-d.ts`
Depende de: T-03, T-04
Aceite: `pnpm typecheck` e `pnpm vitest run test/unit/types.test-d.ts` passam.

### T-08 — Documentação
Documentar `problemDetails` na lista de opções junto de `debug` e `silent`, com aviso da troca de chaves e da limitação de `freezeApp`/handler avulso. Em "HTTPError Fields" documentar `type` e `instance`, adicionar exemplo de corpo problem+json e a nota sobre erros não tratados.

Cobre: RF-08
Arquivos: `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/1.basics/6.error.md`
Depende de: T-06
Aceite: revisão visual das duas páginas; `pnpm lint` (oxfmt) passa nos arquivos tocados.

### T-09 — Verificação final e ajuste de testes existentes
Executar `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Se algum teste existente quebrar, ajustar só ele mantendo a asserção original. Confirmar que `test/unit/package.test.ts` e `test/dist.test.ts` não mudaram e que `src/index.ts` não ganhou exports.

Cobre: RF-01, RF-08
Arquivos: `test/errors.test.ts` (somente se algum teste existente quebrar)
Depende de: T-01, T-02, T-06, T-07, T-08
Aceite: os três comandos passam sem erros e existem testes novos para RF-01 a RF-07.

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-03, T-06, T-09 |
| RF-02 | T-01, T-05, T-06 |
| RF-03 | T-01, T-05, T-06 |
| RF-04 | T-02, T-04 |
| RF-05 | T-01, T-05, T-06 |
| RF-06 | T-01, T-05, T-06 |
| RF-07 | T-01, T-06 |
| RF-08 | T-01, T-02, T-07, T-08, T-09 |
