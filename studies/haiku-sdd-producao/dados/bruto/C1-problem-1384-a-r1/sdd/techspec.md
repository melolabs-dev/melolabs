# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-06).
Escopo desta spec: decisões de arquitetura, arquivos, contratos, testes e riscos. Nenhum código do projeto foi alterado. As referências `arquivo:linha` foram conferidas na leitura do código atual (commit `9dfd537`, árvore sem alterações além de `sdd/prd.md`).

## Resumo

- A renderização de erros já passa por um ponto único: `prepareResponse()` chama `errorResponse()`, que monta corpo (`HTTPError.toJSON()`) e cabeçalhos (`jsonHeaders`). A mudança fica nesse ponto, com a flag lida de `config`.
- `HTTPError` ganha `type` e `instance` como campos somente leitura, lidos do objeto de entrada.
- Com `problemDetails` desligada (padrão), o caminho de código de saída de erro é o atual, sem nenhuma alteração de saída.
- Há um problema de roteamento que o PRD não cobre: alguns caminhos chamam `toResponse` sem `config`, e com a opção ligada um `HTTPError` renderizado por eles sairia no formato antigo. Ver D-07.

---

## Decisões de arquitetura

### D-01 — Ponto de decisão do formato: `errorResponse` recebe `config`

**Escolha:** `errorResponse()` deixa de receber `debug: boolean` e passa a receber `config: H3Config`. Dentro dele, `config.problemDetails` escolhe entre o corpo atual e o corpo RFC 9457, e `config.debug` continua controlando `stack`. A chamada única está em `src/response.ts:173`.

**Alternativas consideradas:**
- *Função pública nova `toProblemResponse()`* — rejeitada: adiciona nome público, e o PRD proíbe novos nomes além de `problemDetails`, `type` e `instance`.
- *Método `HTTPError.toProblemJSON()`* — rejeitada: aumenta a superfície pública da classe e não resolve a escolha de formato (que depende da config da app, não do erro).
- *Plugin/hook que reescreve a resposta de erro* — rejeitada: exige um segundo passe sobre a `Response` e duplica a lógica de `errHeaders` (ver `src/response.ts:168-172`).

**Justificativa:** mantém a mudança em uma função interna, com um único ramo condicional, e preserva o caminho antigo intacto quando a opção está desligada (RF-04).

### D-02 — Forma do corpo em modo problem details

**Escolha:** o corpo é um objeto JSON plano com os membros RFC no primeiro nível:

- `type`: `error.type` quando for string não vazia; caso contrário `"about:blank"`.
- `title`: `error.statusText`, omitido quando ausente (JSON.stringify descarta `undefined`).
- `status`: `error.status`.
- `detail`: `error.message`, ou `"HTTPError"` quando `unhandled` (RF-05).
- `instance`: `error.instance` quando string; omitido quando ausente.
- `data` e `body`: repassados como hoje (premissa do PRD). Não entram quando `unhandled`.
- `stack`: só com `debug`, no mesmo formato atual.

Membros RFC têm precedência sobre chaves de `body` (ver D-06 e riscos).
`statusText` e `unhandled` não aparecem como membros no modo ligado, porque `title` e `detail` os substituem. O PRD proíbe remover campos do *formato padrão*, não do formato novo, então isso está dentro do escopo.

**Alternativas consideradas:**
- *Envelope* (`{ "problem": {...} }`) — rejeitada: a RFC define os membros no nível superior.
- *Manter `statusText` e `unhandled` como extensões* — rejeitada: duplica `title` e expõe a classificação interna sem ganho para o cliente. Pode ser reavaliada se algum consumidor depender deles.

### D-03 — Erros não tratados não expõem `type` nem `instance`

**Escolha:** quando `error.unhandled` é verdadeiro, `type` vira `"about:blank"`, `instance` é omitido e `detail` é `"HTTPError"`. A regra é a mesma que já oculta `message`, `data` e `body` (`src/error.ts:232-234`).

**Justificativa:** `type` e `instance` vêm do código da aplicação. Em erros que o h3 embrulhou (`toError`, `src/response.ts:73-83`, e `new HTTPError(val)` em `src/response.ts:148`), não há garantia de que esses valores existam ou sejam seguros. Ocultar é o caminho que o PRD já adota para RF-05.

### D-04 — `type` e `instance` são lidos apenas de `details`, sem fallback em `cause`

**Escolha:** no construtor de `HTTPError`, `type` e `instance` são lidos de `(details as ErrorBody)?.type` e `(details as ErrorBody)?.instance`, da mesma forma que `data` e `body` (`src/error.ts:208-209`). Não há fallback em `details.cause`, que `status`, `statusText` e `unhandled` usam (`src/error.ts:173-206`).

**Alternativas consideradas:**
- *Fallback em `cause`, como `status`* — rejeitada: `cause` pode ser qualquer valor vindo de um erro externo, e o embrulho `toError` guarda o valor original em `cause` (`src/response.ts:81`). Herdar `type` e `instance` dali abriria um caminho de metadado não controlado.

**Sem validação:** o h3 repassa o valor (PRD, premissas). Nenhum parse de URI.

### D-05 — Content-Type e cabeçalhos do erro

**Escolha:** um novo `problemHeaders` (FrozenHeaders, mesmo padrão de `jsonHeaders`, `src/response.ts:270-272`) com `content-type: application/problem+json`. `errorResponse` usa `problemHeaders` como base quando a opção está ligada, e mantém a ordem atual de mesclagem: `error.headers` sobrescreve a base, depois `errHeaders` é mesclado (`src/response.ts:359-364`).

**Justificativa:** preserva o comportamento que já existe para `error.headers` e `errHeaders`, incluindo `set-cookie` acumulado. Se o app definir `content-type` em `HTTPError.headers`, esse valor ganha, como hoje.

### D-06 — `onError` e valores retornados

**Escolha:** o fluxo de `onError` não muda. Quando o hook retorna um `HTTPError` (ou outro `Error`), `prepareResponse(newVal, ..., true)` (`src/response.ts:165`) cai em `errorResponse` com `config` e, portanto, sai em problem details (RF-06). Quando o hook retorna um valor que não é erro, ele segue a renderização normal de sucesso (`prepareResponseBody`), igual a hoje.

**Ambiguidade do PRD:** RF-06 diz "se ele retornar um valor, esse valor é renderizado no formato selecionado pela opção". Lido ao pé da letra, isso exigiria transformar qualquer valor em problem details. Isso não faz sentido para um corpo de sucesso. Esta spec adota a leitura de que o formato de erro se aplica a erros, e registra a escolha para confirmação.

**Regra de precedência de `errHeaders`:** o código atual limpa `event[kEventRes]` antes de renderizar (`src/response.ts:172`) e, no caminho com `onError`, o `Response` gerado volta por `prepareResponse` com `nested = true`, o que impede a segunda mesclagem de `errHeaders` (`src/response.ts:218`). Nada disso muda. Qualquer refatoração precisa manter essa ordem.

### D-07 — Caminhos que chamam `toResponse` sem `config`

**Problema (verificado na leitura):** o padrão de `toResponse(val, event, config = {})` (`src/response.ts:13-16`) faz com que estes caminhos renderizem sem config da app:

- `src/utils/middleware.ts:26` — `onResponse` middleware chama `toResponse(rawBody, event)`. Se o handler *retornar* um `HTTPError`, ele sai sem `problemDetails`. O middleware não recebe `config`.
- `src/rules/cache.ts:314` — `toResponse` do cache de regras, mesmo problema.
- `src/handler.ts:122` e `src/handler.ts:124` — `defineHandler(...).fetch()` sem app. Aqui não há config a recuperar.

**Escolha:** trocar o default de `toResponse` para `event.app?.config ?? {}`. `H3Event` guarda a app em `event.app` (`src/event.ts:40`, atribuído em `src/event.ts:95`), e `H3Core.config` é o mesmo objeto passado em `src/h3.ts:99`. Assim, os caminhos de `onResponse` e de cache passam a usar a config da app sem mudar a assinatura. `handler.fetch` sem app continua sem config, como já acontece com `debug`.

**Efeito colateral:** `debug` também passa a valer nesses caminhos (antes o `stack` e o `JSON` indentado não apareciam neles). Isso é uma correção, mas altera saída em modo debug, e precisa constar no changelog. Com a opção desligada e `debug` desligado, nada muda.

**Alternativa considerada:** passar `config` explicitamente pelos middlewares. Rejeitada: `onResponse` é um `Middleware` público sem acesso à config, e mudar sua assinatura é quebra de API.

### D-08 — Escopo de superfícies de erro

Fora desta mudança:

- `src/utils/json-rpc.ts:476-491` monta seu próprio envelope de erro JSON-RPC e não usa `errorResponse`. Não muda.
- `defineHandler(...).fetch()` sem app (ver D-07) segue sem `problemDetails`.
- Erros de WebSocket e SSE que não passam por `toResponse` não são cobertos.

---

## Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/types/h3.ts:28-53` | Adicionar `problemDetails?: boolean` em `H3Config`, logo após `allowMalformedURL` (`src/types/h3.ts:46`). |
| `src/error.ts:30-69` | Adicionar `type?: string` e `instance?: string` em `ErrorBody`. `ErrorInput` herda por `Partial<ErrorBody>` (`src/error.ts:6`). |
| `src/error.ts:74-119` | Declarar `readonly type: string \| undefined` e `readonly instance: string \| undefined` na classe, com doc RFC 9457. |
| `src/error.ts:162-210` | No construtor, atribuir `this.type` e `this.instance` a partir de `details` (perto de `src/error.ts:208-209`). |
| `src/error.ts:226-236` | `toJSON()` **não muda**. Os novos campos não entram no formato padrão (RF-03, RF-04). |
| `src/response.ts:13-16` | Default de `config` vira `event.app?.config ?? {}` (D-07). |
| `src/response.ts:146-174` | Passar `config` a `errorResponse` no lugar de `config.debug` (linha `src/response.ts:173`). |
| `src/response.ts:270-272` | Adicionar `problemHeaders` ao lado de `jsonHeaders`. |
| `src/response.ts:358-380` | `errorResponse(error, config, errHeaders)`: escolher base de cabeçalho e corpo pela flag; novo helper `toProblemJSON(error, debug)` no fim do arquivo, como helper interno (AGENTS.md: helpers internos no fim do arquivo). |
| `test/problem-details.test.ts` | Arquivo novo (ver Estratégia de testes). |
| `test/unit/types.test-d.ts` | Testes de tipo para `type`, `instance` e `problemDetails`. |
| `docs/1.guide/900.api/1.h3.md:113` | Documentar a opção `problemDetails`, ao lado de `allowMalformedURL`. Recomendado, não exigido pelo PRD. |
| `docs/1.guide/1.basics/6.error.md:51-60` | Seção curta sobre `type` e `instance` e o modo problem details. Recomendado. |

Não alteram: `src/index.ts:72` (nenhum export novo), `src/utils/json-rpc.ts`, `src/handler.ts`, `src/utils/middleware.ts`, `src/rules/cache.ts`.

## Contratos e assinaturas

```ts
// src/types/h3.ts — H3Config
/**
 * When enabled, H3 renders error responses as RFC 9457 problem details
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;
```

```ts
// src/error.ts — ErrorBody (acrescentar)
/** RFC 9457 `type` URI. Used only when `problemDetails` is enabled; defaults to `about:blank`. */
type?: string;
/** RFC 9457 `instance` URI. Used only when `problemDetails` is enabled. */
instance?: string;
```

```ts
// src/error.ts — HTTPError (acrescentar)
/** RFC 9457 `type`, as given in the input. Not validated. */
readonly type: string | undefined;
/** RFC 9457 `instance`, as given in the input. Not validated. */
readonly instance: string | undefined;
```

```ts
// src/response.ts — assinaturas internas
export function toResponse(val: unknown, event: H3Event, config?: H3Config): Response | Promise<Response>;
// default: config = event.app?.config ?? {}

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

function toProblemJSON(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Esboço de `toProblemJSON` (conforme D-02 e D-03):

```ts
function toProblemJSON(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const unhandled = error.unhandled;
  const type = unhandled ? undefined : error.type;
  return {
    ...(unhandled ? undefined : { data: error.data, ...error.body }),
    type: typeof type === "string" && type ? type : "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    instance: unhandled || typeof error.instance !== "string" ? undefined : error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

Observação: o `typeof` nos campos é deliberado. Ver risco R2.

Esboço de `errorResponse`:

```ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const base = config.problemDetails ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers ? mergeHeaders(base, error.headers) : new Headers(base);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = config.problemDetails
    ? toProblemJSON(error, config.debug)
    : { ...error.toJSON(), stack: config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined };
  return new FastResponse(JSON.stringify(body, undefined, config.debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

Esse esboço mantém a forma do código atual. A versão final deve manter o ramo antigo idêntico, byte a byte (RF-04), e pode preferir duas funções em vez de um ternário, se ficar mais legível.

## Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever o teste primeiro e confirmar que ele falha antes da implementação.

**Arquivo novo `test/problem-details.test.ts`**, com `describeMatrix` (web e node). Usar `t.app` do `_setup.ts`. Esse app já vem com `debug: true` e `onError` com mock (`test/_setup.ts:135-141`), então os testes devem configurar `t.app.config.problemDetails` explicitamente, como `errors.test.ts` faz com `onError` (`test/errors.test.ts:14`).

Casos, por requisito:

1. **RF-01:** `new H3()` sem a opção → `app.config.problemDetails` é `undefined`.
2. **RF-02:** rota que lança `HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })` → status 404, `Content-Type` exatamente `application/problem+json`, corpo com `type: "about:blank"`, `title`, `status`, `detail`.
3. **RF-02, 404 de rota:** `GET /missing` → `detail` começa com `Cannot find any route`, `type` é `about:blank`, `title` ausente.
4. **RF-02, `type` e `instance` informados:** `HTTPError({ status: 403, type, instance })` → corpo com os valores informados.
5. **RF-03:** `new HTTPError({ status: 403, type, instance })` → `err.type` e `err.instance` com os valores (teste unitário, pode ficar no mesmo arquivo).
6. **RF-03, opção desligada:** mesmo erro com `problemDetails` desligada → corpo sem `type` nem `instance`, `Content-Type` não é `application/problem+json`.
7. **RF-04:** parametrizar o teste existente "renders ... errors from a ... handler" de `test/errors.test.ts:24-63` por `problemDetails` ∈ {off, on}? Não recomendado: o teste verifica `application/json;charset=UTF-8` e `data`. Em vez disso, criar casos novos no arquivo novo que replicam o caso de `errHeaders` e `set-cookie` (`test/errors.test.ts:24-63`) com a opção ligada: `x-error` presente, `x-success` ausente, `getSetCookie()` com `["error=1", "prepared=1"]`, sem duplicação. Esse é o regression guard de `set-cookie` (riscos).
8. **RF-04, suíte existente:** nenhum teste existente precisa mudar, porque o default é desligado. Rodar `pnpm vitest run test/errors.test.ts` e a suíte completa para confirmar.
9. **RF-05:** `throw new Error("senha do banco: 123")` → status 500, `Content-Type` problem, `detail === "HTTPError"`, `expect(body).not.toContain("senha do banco")`, sem `data`, `body`, `type` nem `instance`. Incluir o caso com `debug: true` (padrão do `_setup`) para garantir que `stack` continua sem o segredo do `detail`. Atenção: o `stack` do erro não tratado pode conter a mensagem original; se o teste falhar por isso, a decisão é ocultar `stack` quando `unhandled` (ver riscos R6).
10. **RF-05, HTTPError não tratado com `type` via `cause`:** `toError` de um valor não-Error com `{ type: "x" }` → corpo com `type: "about:blank"`.
11. **RF-06:** `onError` retorna `new HTTPError({ status: 422, message: "Dados inválidos" })` → status 422, problem, `detail: "Dados inválidos"`. Caso extra: `onError` retorna `new Error("x")` → 500 unhandled, `detail: "HTTPError"`.
12. **Precedência RFC vs. `body`:** `HTTPError({ status: 400, body: { type: "x", status: 1, extra: true } })` → `type: "about:blank"`, `status: 400`, `extra: true`.
13. **D-07, `onResponse` middleware:** `t.app.use(onResponse(() => {}))` + handler que retorna `new HTTPError({ status: 409, message: "conflito" })` → resposta problem. Esse caso fica vermelho antes do D-07 e verde depois.
14. **D-05, cabeçalhos:** `HTTPError({ headers: { "x-own": "1" } })` → `x-own` presente com a opção ligada.
15. **HEAD:** `HEAD /missing` com opção ligada → corpo vazio, `Content-Type` problem.

**Tipos (`test/unit/types.test-d.ts`):**
- `new HTTPError({ status: 400, type: "https://x", instance: "/y" })` compila.
- `expectTypeOf(err.type).toEqualTypeOf<string | undefined>()`.
- `H3Config["problemDetails"]` é `boolean | undefined`.
- `new HTTPError({ status: 400, type: 123 })` falha na compilação (`// @ts-expect-error`).

**Comandos de verificação:**
```bash
pnpm vitest run test/problem-details.test.ts
pnpm vitest run test/errors.test.ts test/hooks.test.ts test/app.test.ts
pnpm typecheck
pnpm lint
pnpm vitest run          # suíte completa
```

Critério de pronto: todos os casos novos passam; a suíte existente passa sem alteração; `pnpm lint` e `pnpm typecheck` passam (PRD, premissas).

## Riscos

- **R1 — Colisão de chaves com `body`.** Um `body` com `type`, `title`, `status`, `detail` ou `instance` não sobrescreve os membros RFC no modo ligado (D-02). Coberto pelo caso 12. No modo desligado, o comportamento de `body` continua como hoje.
- **R2 — Erros "HTTPError-shaped" de outros pacotes.** `prepareResponse` só chama o construtor para erros que não passam em `HTTPError.isError` (`src/response.ts:147-148`). Para os demais, `error.type` e `error.instance` são lidos direto da propriedade e podem ter qualquer tipo. Por isso `toProblemJSON` checa `typeof === "string"`. Testar com um erro de `name: "HTTPError"`, `status: 400` e `type: 42`.
- **R3 — `error.headers` sobrescreve `Content-Type`.** D-05 mantém a ordem atual, então um app que definir `content-type` em `HTTPError.headers` terá esse valor. Documentar.
- **R4 — Mudança de `debug` em caminhos sem config (D-07).** `stack` e JSON indentado passam a aparecer em `onResponse`, cache e outros caminhos que antes não tinham config. Fora do modo debug, nada muda. Listar no changelog.
- **R5 — Clientes que comparam `application/json`.** Quem ligar a opção e comparar `Content-Type` com `application/json` deixa de reconhecer a resposta. Só afeta quem ligar a opção. Documentar, como o PRD pede.
- **R6 — Vazamento via `stack` em erro não tratado.** Com `debug: true`, o `stack` de um erro não tratado inclui a mensagem original (`src/response.ts:152-154` copia `val.stack` para o erro). Isso já acontece no formato atual, e o `detail` oculto não muda isso. A regra de RF-05 fala em "`data`, `body` e stack não são expostos fora do modo debug", então o `stack` em modo debug é permitido pelo PRD. Confirmar esse entendimento antes de fechar; se o time quiser ocultar também no debug, a mudança é uma linha em `toProblemJSON`.
- **R7 — `onError` que retorna valor não-erro.** D-06: segue a renderização normal (200 com corpo). Confirmar a leitura do RF-06.
- **R8 — `handler.fetch()` sem app.** `src/handler.ts:122,124` não têm config. Mesma limitação de `debug` hoje. Documentar.
- **R9 — Mesclagem de `set-cookie` ao reutilizar a resposta.** O código atual evita duplicar `errHeaders` ao passar pelo caminho `onError` (`src/response.ts:168-172`, `src/response.ts:218`). A refatoração de `errorResponse` não pode mexer nessa ordem. Coberto pelo caso 7.
- **R10 — Novo default de `toResponse` e tipos.** `config` passa a depender de `event.app`. Se `event.app` tiver `config` com `plugins`, o tipo `H3CoreConfig` é aceito por `H3Config`, sem erro de tipo, mas confirmar no `pnpm typecheck`.
- **R11 — Não verificado por execução.** Esta spec foi escrita sem rodar a suíte. Os itens D-07 e R2 são conclusões de leitura do código. Devem ser confirmados pelos testes 13 e R2 antes de dar a feature como pronta.

## Pontos a confirmar com quem pediu

1. D-06 / R7: o formato de erro vale só para erros retornados por `onError`, e valores de sucesso seguem a renderização normal?
2. R6: `stack` em modo debug para erro não tratado pode continuar? O PRD diz que não é exposto *fora* do debug.
3. D-02: `statusText` e `unhandled` saem do formato problem details. Se algum consumidor depender deles, ficam como extensões.
4. D-07: aceitar a mudança de `debug` nos caminhos de `onResponse` e cache.
