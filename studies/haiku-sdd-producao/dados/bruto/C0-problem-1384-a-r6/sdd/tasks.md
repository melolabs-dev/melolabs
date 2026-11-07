# Tarefas — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-09). Seguir o fluxo de bugfix do AGENTS.md: os testes (T-06) podem ser escritos primeiro e devem falhar antes das tarefas T-01 a T-05.

### T-01 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` após `silent` em `H3Config`, com TSDoc (liga `application/problem+json` e o formato RFC 9457 do corpo de erro; padrão desligado). Sem normalização nem campo em `H3Core`: a opção é lida de `config` na hora da resposta (D-02).

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` passa; `new H3({ problemDetails: true })` compila e `app.config.problemDetails` é lido sem alterar nenhuma resposta enquanto a opção estiver ausente ou `false`.
Arquivos: `src/types/h3.ts`

### T-02 — `type` e `instance` em `ErrorBody` e `HTTPError`

Adicionar `type?: string` e `instance?: string` (com TSDoc, RFC 9457 §3.1.1 e §3.1.5) a `ErrorBody`; `ErrorInput` herda via `Partial<ErrorBody>`. Em `HTTPError`, declarar `readonly type: string | undefined` e `readonly instance: string | undefined` (anotação explícita por `isolatedDeclarations`) e atribuí-los no construtor depois de `this.body`, lendo `details` e depois `details.cause`, aceitando só `typeof === "string"` (D-03). Nenhum export novo em `src/index.ts`.

Cobre: RF-04
Depende de: nenhuma
Aceite: `new HTTPError({ status: 400, type: "https://example.com/probs/validacao", instance: "/pedidos/42" })` expõe `error.type` e `error.instance` com os valores informados; ficam `undefined` quando ausentes; são lidos de `cause`; valor não string (ex.: `cause.type = 1`) vira `undefined`; `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-03 — `toJSON()` com `type`/`instance` somente quando definidos

Em `HTTPError.toJSON()`, inserir antes do spread de `body` as chaves `type` e `instance` apenas quando definidas e quando o erro não for `unhandled`, preservando a regra de que chaves de `body` continuam vencendo e o mascaramento de erros `unhandled` (D-04).

Cobre: RF-04, RF-08
Depende de: T-02
Aceite: `Object.keys(new HTTPError({ status: 404 }).toJSON())` não contém `type` nem `instance`; com `type`/`instance` informados eles aparecem; um erro `unhandled` cujo `cause` tem `type: "entity.parse.failed"` não os mostra; os testes existentes de `test/errors.test.ts` seguem passando.
Arquivos: `src/error.ts`

### T-04 — Módulo interno `problem.ts` com `problemBody` e `STATUS_PHRASES`

Criar `src/utils/internal/problem.ts` (sem export público) com `STATUS_PHRASES: Record<number, string>` privado, com as frases IANA/RFC 9110 (ex.: 422 "Unprocessable Content", 413 "Content Too Large"), e `problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>` (D-05, D-06), montando na ordem:
1. membros padrão: `type` (`error.type ?? "about:blank"`; `about:blank` se `unhandled`), `title` (`error.statusText || STATUS_PHRASES[status]`, omitido se ambos faltarem), `status`, `detail` (de `error.toJSON().message`, mantendo o mascaramento) e `instance` só se definido (e não `unhandled`);
2. extensões, só se `!error.unhandled`: `data` (se `!== undefined`) e as chaves de `body`, ignorando `type`, `title`, `status`, `detail` e `instance`;
3. `stack` por último, somente com `debug && error.stack`.

Cobre: RF-03, RF-05, RF-06, RF-07
Depende de: T-02
Aceite: `problemBody(new HTTPError("Sem saldo", { status: 403 }))` retorna exatamente `{ type: "about:blank", title: "Forbidden", status: 403, detail: "Sem saldo" }`; com `body: { status: 1, errors: ["x"] }` e `data` os extras aparecem sem sobrescrever `status`; erro `unhandled` não expõe mensagem, `data`, `body`, `type` nem `instance`; status 599 sem `statusText` omite `title`; `pnpm typecheck` e `pnpm lint` passam (arquivo < 200 LoC, formatado com oxfmt).
Arquivos: `src/utils/internal/problem.ts`

### T-05 — Integrar problem details em `errorResponse`

Em `src/response.ts`: importar `problemBody`; criar `problemHeaders = /* @__PURE__ */ new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` ao lado de `jsonHeaders`; trocar a assinatura para `errorResponse(error, config: H3Config, errHeaders?)` e atualizar a única chamada em `prepareResponse`. Com `config.problemDetails`, usar `problemHeaders` como base de `mergeHeaders`/`new Headers` e `problemBody(error, config.debug)` como corpo (indentação 2 com `debug`, como hoje); sem a opção, o caminho atual fica idêntico byte a byte. Status e `statusText` da `Response`, mescla de `error.headers`/`event.res` e o fluxo de `onError` não mudam (D-01, D-07, D-08).

Cobre: RF-01, RF-02, RF-07
Depende de: T-01, T-03, T-04
Aceite: com `problemDetails: true`, `HTTPError`, `Error` comum e rota inexistente respondem `content-type` começando com `application/problem+json` e JSON válido; com a opção ausente ou `false`, `HTTPError.status(404)` responde `application/json;charset=UTF-8` com `status`, `statusText` e `message`; `debug: true` + `HTTPError({ status: 401, headers: { "www-authenticate": "Bearer" } })` responde 401, com o header, `application/problem+json` e `stack` no corpo; `onError` que devolve `Response` própria a substitui; `pnpm typecheck` passa.
Arquivos: `src/response.ts`

### T-06 — Testes de RF-01 a RF-07

Criar `test/problem-details.test.ts` com `describeMatrix` (web e node), ligando a opção por `t.app.config.problemDetails = true` e limpando `t.errors = []` nos testes com erros `unhandled`. Um `it` por critério: RF-01 (sem opção e com `false`); RF-02 (`HTTPError`, `Error` comum, rota inexistente); RF-03 (corpo exato de 403 sem `instance`, `statusText` explícito vira `title`, status 599 sem `title`); RF-04 (unitário de `type`/`instance`, `cause`, valor não string, resposta HTTP, `toJSON()` sem as chaves por padrão); RF-05 (`body`/`data` como extensões, `body` não sobrescreve membros padrão); RF-06 (`silent: true`, "segredo interno" ausente do corpo, `cause` com `type`/`data`/`body`, `throw` de não Error); RF-07 (`debug`, `www-authenticate`, `stack`, headers de `event.res` e `set-cookie` sem duplicar com `onError`, `onError` substituindo a resposta, `statusText` HTTP preservado); invariante: sem a opção, `type`/`instance` vindos de `cause` em erro `unhandled` não aparecem.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-05
Aceite: `pnpm vitest run test/problem-details.test.ts` passa em web e node; antes das tarefas T-01 a T-05 os testes novos falham (regressão confirmada) e depois passam.
Arquivos: `test/problem-details.test.ts`

### T-07 — Validação final, testes existentes e documentação

Executar `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` (formatar o arquivo novo com oxfmt se preciso). Ajustar testes existentes somente se dependerem de algo alterado (ex.: comparação exata de chaves do `HTTPError`), preservando o que verificam. Verificar se há documentação em `docs/` sobre erros/config que deva citar `problemDetails`, `type` e `instance` (R-09) e atualizá-la se houver.

Cobre: RF-08
Depende de: T-06
Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` terminam sem falhas; nenhum teste existente perdeu asserção; `src/index.ts` e `package.json` não mudaram (nenhum export público novo).
Arquivos: `test/errors.test.ts` (somente se algum ajuste for necessário), `docs/` (somente se houver página de erros/config)
