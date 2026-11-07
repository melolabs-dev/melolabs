# Tarefas — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08). Fluxo do AGENTS.md: testes primeiro (T-01), confirmar que falham, implementar (T-02 a T-05), confirmar que passam (T-06).

### T-01 — Escrever os testes novos (falham antes da implementação)

Criar `test/problem-details.test.ts` com `describeMatrix` (web e node), ligando a opção por teste com `t.app.config.problemDetails = true`, e o teste unitário de `HTTPError`. Casos mínimos, um por requisito:

- RF-01: sem a opção e com `false`, `content-type` é `application/json` e o corpo tem `statusText`/`message`, sem `type`/`title`/`detail`/`instance`.
- RF-02: `HTTPError.status(404)` e rota inexistente (`kNotFound`) respondem 404 com `application/problem+json`; `error.headers` e `event.res` de erro são mesclados; `HEAD` sem corpo.
- RF-03: caso 422 completo do PRD (com `title` acentuado), `title` pela frase padrão (404 → "Not Found"), status fora da tabela sem `title`, `type` padrão `about:blank`.
- RF-04 (unitário): `type`/`instance` via construtor, via `HTTPError.status(...)`, herdados de `cause`, `undefined` por padrão, valor não-string ignorado, e `toJSON()` sem a opção sem `type`/`instance`.
- RF-05: `data` e `body` presentes; `body: { title: "malicioso", status: 1, type: "x" }` não sobrescreve os membros padrão.
- RF-06: `throw new Error("segredo interno")` dá 500, content-type problem, sem a string "segredo interno", sem `stack`, `data` ou `body`, `detail: "HTTPError"` (capturar `t.errors`).
- RF-07: (a) `debug: true` com `stack` array e corpo indentado; (b) `onError` retornando `Response` prevalece sem reformatação; (c) `onError` que lança `HTTPError` sai em problem details.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts test/unit/` executa e os testes novos falham (por ausência da funcionalidade, não por erro de sintaxe ou import); existe ao menos um teste por RF-01 a RF-07.
Arquivos: `test/problem-details.test.ts` (novo), `test/unit/http-error.test.ts` (novo, ou o arquivo unitário de erro existente)

### T-02 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` com JSDoc após `silent` em `H3Config`. `H3CoreConfig` herda por `Omit`, sem alteração. Nenhum outro nome público novo (D-08).

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` passa e `app.config.problemDetails = true` compila; `test/unit/package.test.ts` (lista de exports) continua verde.
Arquivos: `src/types/h3.ts`

### T-03 — `type` e `instance` em `HTTPError` (e `~title` interno)

Em `ErrorBody` adicionar `type?: string` e `instance?: string` com JSDoc. Em `HTTPError` adicionar `readonly type`/`instance` (`string | undefined`), atribuídos no construtor com herança `details.type ?? details.cause.type` (só `typeof === "string"`). Guardar o texto cru do `statusText` na propriedade não enumerável `~title` via `Object.defineProperty`, com a mesma herança de `cause` (D-04). `toJSON()` não muda.

Cobre: RF-04, RF-03
Depende de: T-02
Aceite: os testes unitários de RF-04 de T-01 passam; `toJSON()` sem a opção não contém `type`/`instance`; `~title` não aparece em `Object.keys`, `toJSON` nem snapshots; `pnpm typecheck` passa (`isolatedDeclarations`).
Arquivos: `src/error.ts`

### T-04 — Helper interno `problemBody` e tabela de frases HTTP

Criar `src/utils/internal/problem.ts` (não exportado por `src/index.ts`) com `problemBody(error, debug?)` e a tabela interna `Record<number, string>` de frases padrão (4xx/5xx registrados e 2xx/3xx comuns), sem dependência nova. Corpo conforme D-06: extensões (`data`, `...body`, `stack` com `debug`) primeiro e membros padrão por último (`type`, `title`, `status`, `detail`, `instance`). `title`: `~title` → `statusText` → frase padrão → omitido. Para `unhandled`: `type: "about:blank"`, `detail: "HTTPError"`, sem `data`/`body`/`instance`/`~title`.

Cobre: RF-03, RF-05, RF-06, RF-07
Depende de: T-03
Aceite: `pnpm typecheck` e `pnpm lint` passam; arquivo com menos de 200 linhas; exemplo do RF-03 e a saída de `new Error("segredo interno")` do techspec são reproduzidos pela função.
Arquivos: `src/utils/internal/problem.ts` (novo)

### T-05 — Ativar problem details em `errorResponse`

Mudar a assinatura para `errorResponse(error, config, errHeaders)` e atualizar a chamada em `prepareResponse`. Adicionar `problemHeaders` (`content-type: application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`. Com `config.problemDetails`, usar `problemHeaders` e `problemBody`, mantendo a mesclagem de `error.headers` e `errHeaders`, a indentação de 2 espaços com `debug` e `status`/`statusText` da `Response`. Sem a opção, o caminho legado fica idêntico, byte a byte.

Cobre: RF-01, RF-02, RF-05, RF-06, RF-07
Depende de: T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa em web e node; `test/errors.test.ts` continua passando sem alteração (ainda verifica `application/json`).
Arquivos: `src/response.ts`

### T-06 — Documentação

Listar `problemDetails` entre as opções suportadas em `docs/1.guide/900.api/1.h3.md`. Em `docs/1.guide/1.basics/6.error.md`, documentar `type` e `instance` em "HTTPError Fields" e criar a seção "Problem Details (RFC 9457)" com exemplo de resposta, mencionando: opção global sem negociação de `Accept`, `title` e `detail`, mascaramento de erros não tratados, `debug` (`stack`), apps montados via `mount()` usando a config do pai e herança de `type` a partir de `cause`.

Cobre: RF-08
Depende de: T-05
Aceite: a opção e os campos novos aparecem nos dois arquivos; o exemplo de resposta bate com a saída real dos testes; `pnpm lint` (inclui `oxfmt --check`) passa.
Arquivos: `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/1.basics/6.error.md`

### T-07 — Verificação final e ajustes em testes existentes

Rodar `pnpm test` (lint, typecheck e cobertura). Se algum teste existente depender da forma de `ErrorBody` (por exemplo `test/unit/types.test-d.ts`), ajustá-lo preservando o que verifica; nenhum ajuste é esperado com a opção desligada.

Cobre: RF-08, RF-01
Depende de: T-05, T-06
Aceite: `pnpm test` passa por completo (lint, typecheck e todos os testes); a suíte existente passa sem mudança de comportamento com a opção ausente; existe ao menos um teste novo por RF-01 a RF-07.
Arquivos: `test/unit/types.test-d.ts` (somente se necessário), demais testes existentes (somente se necessário)
