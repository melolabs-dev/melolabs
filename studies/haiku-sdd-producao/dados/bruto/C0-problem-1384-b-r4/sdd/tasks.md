# Tarefas de implementação — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` e `sdd/techspec.md`. Segue o fluxo de correção do AGENTS.md: testes novos primeiro (devem falhar), depois a implementação. Nada novo é exportado em `src/index.ts`, e `docs/` fica fora de escopo.

### T-01 — Escrever os testes novos de problem details (devem falhar)

Cria `test/problem-details.test.ts` com `describeMatrix` (modos web e node), um caso por critério de aceite: RF-01 (content-type e JSON válido); RF-02 (`title` de `statusText`, `title` da tabela de frases, `detail` omitido quando `message === title`, ausência de `message`/`statusText`/`unhandled`/`type`); RF-03 (`error.type`/`error.instance` na instância e no corpo, leitura via `cause`, valor não string ignorado); RF-04 (`data`, `body` e colisão `body: { title, type, status }`); RF-05 (`new Error("senha do banco: x")` sem `debug`, e também com `unhandled: true` junto de `type`/`instance`/`data`/`body`/`statusText`); RF-06 (`debug: true` com `x-trace`, `stack` como `string[]`, `content-type` de `error.headers` prevalece); RF-07 (404 de rota inexistente, `throw 404`, validação, limite de corpo, `onError` devolvendo `HTTPError`, `onError` devolvendo `Response` própria inalterada). Cria também o teste unitário de `problemDetails`/`toJSON()` em `test/unit/` (status sem frase, ordem das chaves) e o caso de tipos em `test/unit/types.test-d.ts` aceitando `type`/`instance` em `ErrorInput`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts test/unit/` roda e os casos novos **falham** contra o código atual, pelo motivo esperado (formato antigo). Registrar a falha antes de seguir para T-02.
Arquivos:
- `test/problem-details.test.ts` (novo)
- `test/unit/problem.test.ts` (novo)
- `test/unit/types.test-d.ts`

### T-02 — Declarar `type` e `instance` em `HTTPError`

Em `src/error.ts`: acrescentar `type?: string` e `instance?: string` em `ErrorBody` (após `message`) e atualizar a doc de `message` para indicar que vai em `detail`. Na classe, acrescentar `readonly type: string | undefined` e `readonly instance: string | undefined` (após `unhandled`). No construtor, atribuir lendo de `details` e de `details.cause`, aceitando só `typeof === "string"` (valor não string vira `undefined`). Tipos explícitos por causa de `isolatedDeclarations`.

Cobre: RF-03
Depende de: T-01
Aceite: `pnpm typecheck` passa; `new HTTPError({ status: 403, type: "u", instance: "/i" })` expõe `error.type === "u"` e `error.instance === "/i"`; `type`/`instance` vindos de `cause` são lidos, e um `type` numérico em `cause` é ignorado; o caso de tipos de `test/unit/types.test-d.ts` passa.
Arquivos:
- `src/error.ts`

### T-03 — Criar o helper interno `problemDetails` e a tabela de frases

Cria `src/utils/internal/problem.ts` com `problemDetails(error: HTTPError): Record<string, unknown> & { status: number }` e `STATUS_PHRASES` privado ao módulo (frases do RFC 9110, incluindo `418: "I'm a Teapot"` e `422: "Unprocessable Content"`). Regras: ordem de chaves `type`, `title`, `status`, `detail`, `instance`, `data`, extensões; `title = statusText ?? STATUS_PHRASES[status]`, omitido se não houver frase; `detail = message`, omitido se igual a `title`; extensões de `body` espalhadas primeiro e membros padrão atribuídos só quando definidos na instância (a instância vence; `body.type` sobrevive se a instância não define `type`); `data` atribuído antes de `body`, preservando `body.data` vencedor. Em erro `unhandled`: só `status` e `title` vindo exclusivamente da tabela (ignora `statusText`), sem `detail`, `type`, `instance`, `data` nem `body`. Nenhuma exportação em `src/index.ts`.

Cobre: RF-02, RF-04, RF-05
Depende de: T-02
Aceite: o teste unitário de `problemDetails` (T-01) passa; a tabela de exemplos do techspec §4 é reproduzida; para `unhandled` com `statusText`, `type`, `instance`, `data` e `body` preenchidos, o objeto devolvido só tem `status` e `title`.
Arquivos:
- `src/utils/internal/problem.ts` (novo)

### T-04 — Fazer `HTTPError.toJSON()` delegar ao helper

Em `src/error.ts`, importar `./utils/internal/problem.ts` e substituir o corpo de `toJSON()` por `return problemDetails(this)`, com assinatura explícita `toJSON(): Record<string, unknown> & { status: number }`. Atualizar só o comentário de `src/utils/json-rpc.ts` (linhas ~480-483) que cita o formato antigo, sem mudar comportamento.

Cobre: RF-02, RF-04, RF-05
Depende de: T-03
Aceite: `pnpm typecheck` e `pnpm lint` passam; `JSON.stringify(new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" }))` produz `{"title":"Not Found","status":404,"detail":"Usuário 42 não existe"}`; `message`, `statusText` e `unhandled` não aparecem; os testes unitários de `toJSON()` (T-01) passam.
Arquivos:
- `src/error.ts`
- `src/utils/json-rpc.ts`

### T-05 — Responder erros com `application/problem+json`

Em `src/response.ts`, acrescentar `problemHeaders` (`FrozenHeaders`, `content-type: application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`, sem alterar `jsonHeaders`. Em `errorResponse`, usar `problemHeaders` como base. Manter a ordem de mescla (base, `error.headers`, `errHeaders`), de modo que `content-type` vindo de `error.headers` continue vencendo; manter `stack` atribuído por último e a indentação 2 em `debug`. Não mexer no chamador em `prepareResponse` nem em `toError`.

Cobre: RF-01, RF-06, RF-07
Depende de: T-04
Aceite: `pnpm vitest run test/problem-details.test.ts` passa nos modos web e node: erro lançado, 404 de rota inexistente (`title: "Not Found"`, `detail` com `Cannot find any route matching`), `throw 404`, validação, limite de corpo e `onError` retornam `application/problem+json;charset=UTF-8`; `Response` própria devolvida por `onError` e respostas JSON de sucesso mantêm `application/json`; com `debug: true` o corpo traz `stack` como array e o header `x-trace`; `content-type` de `error.headers` prevalece.
Arquivos:
- `src/response.ts`

### T-06 — Ajustar os testes existentes ao novo formato

Atualizar os testes que afirmam o formato antigo, mantendo o que cada um verifica (sem remover testes nem afrouxar asserções): `test/errors.test.ts` (content-type; `statusText`/`message` viram `title`/`detail`; `unhandled: true` no corpo vira `title: "Internal Server Error"` com `not.toHaveProperty("unhandled")`/`detail`, e `t.errors[0].unhandled` passa a ser verificado onde faltava; `message: "HTTPError"` vira `title` com `not.toContain("secret")`), `test/app.test.ts` (`.statusText` vira `.title`), `test/dist.test.ts`, `test/iterable.test.ts` e `test/rules/cache.test.ts` (`.message` vira `.detail`). Conferir ao rodar `test/validate.test.ts`, `test/handler.test.ts` e `test/router.test.ts`, ajustando só se leem texto de rota que agora está em `detail`. Não alterar `test/security.test.ts`, `test/happydom.test.ts` nem `test/proxy.test.ts`.

Cobre: RF-08
Depende de: T-05
Aceite: `pnpm vitest run` passa sem testes removidos e sem asserções enfraquecidas (conferir com `git diff --stat test/` e revisão do diff); cada teste alterado continua verificando status, ausência de vazamento, headers e `data`/`body`.
Arquivos:
- `test/errors.test.ts`
- `test/app.test.ts`
- `test/dist.test.ts`
- `test/iterable.test.ts`
- `test/rules/cache.test.ts`
- `test/validate.test.ts`
- `test/handler.test.ts`
- `test/router.test.ts`

### T-07 — Verificação final

Rodar `pnpm build` (necessário para `test/dist.test.ts`), `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Conferir que `src/index.ts` e `src/types/h3.ts` não mudaram, que snapshots de exports (`test/unit/package.test.ts`, `test/meta.test.ts`) seguem verdes e que `docs/` não foi tocado. Registrar na comunicação de versão que a mudança de formato é breaking (`message`/`statusText`/`unhandled` e `application/json` em erros).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-06
Aceite: os quatro comandos terminam com sucesso; `git status` lista apenas os arquivos das tarefas T-01 a T-06 (mais `sdd/`); `git diff -- src/index.ts src/types/h3.ts docs/` vazio.
Arquivos:
- (nenhum arquivo alterado; apenas verificação)

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-05, T-07 |
| RF-02 | T-01, T-03, T-04, T-07 |
| RF-03 | T-01, T-02, T-07 |
| RF-04 | T-01, T-03, T-04, T-07 |
| RF-05 | T-01, T-03, T-04, T-07 |
| RF-06 | T-01, T-05, T-07 |
| RF-07 | T-01, T-05, T-07 |
| RF-08 | T-01, T-06, T-07 |
