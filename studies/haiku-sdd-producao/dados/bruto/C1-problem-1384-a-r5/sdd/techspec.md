# Tech spec — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-07).
Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `7d1c71d`).

## 1. Visão geral

A opção `problemDetails` em `H3Config` faz `toResponse` renderizar erros como `application/problem+json`. Com a opção desligada, o caminho de renderização é o atual, byte a byte. O `HTTPError` ganha dois campos somente leitura (`type`, `instance`) que só são usados quando a opção está ligada.

O ponto de decisão central é onde fica a renderização RFC 9457. O PRD (seção Premissas) sugere alterar `HTTPError.toJSON()` em `src/error.ts`. Esta spec recomenda não alterar `toJSON` e fazer a conversão em `src/response.ts`, como detalhado em D-02.

Fluxo resultante:

```
H3Core["~request"]  (src/h3.ts:73)
  -> toResponse(handlerRes, event, this.config)  (src/h3.ts:99)
     -> prepareResponse  (src/response.ts:129)
        -> erro: errorResponse(error, config, errHeaders)  (src/response.ts:173)
           -> config.problemDetails ? toProblemDetails(error) : error.toJSON()
           -> content-type: problemHeaders | jsonHeaders
```

`config` já chega a `prepareResponse` com todas as opções do app, então não há novo encanamento.

---

## 2. Decisões de arquitetura

### D-01 — Gatilho é um booleano em `H3Config`, lido de `config` na renderização

**Escolha.** `problemDetails?: boolean` em `H3Config` (`src/types/h3.ts:28`, junto das demais opções globais de erro, por exemplo `debug` em `src/types/h3.ts:32` e `silent` em `src/types/h3.ts:37`). `errorResponse` recebe o `config` inteiro, em vez de só `config.debug` (hoje em `src/response.ts:173`).

**Alternativas consideradas.**
- *Enum `errorFormat: "default" | "problem"`*: mais extensível, mas o contrato pede um booleano e nenhum outro formato está previsto. Rejeitada.
- *Opção por `HTTPError` ou por rota*: fora de escopo pelo PRD.
- *Callback `onError` helper que o usuário chama*: exigiria escrever `onError` em cada app, que é justamente o problema descrito no PRD.

**Justificativa.** Segue o padrão de `debug` e `silent`, aparece em `app.config` (`src/h3.ts:99` passa `this.config`) e não cria nome público além do pedido.

### D-02 — Renderização RFC fica em `src/response.ts`; `HTTPError.toJSON()` não muda

**Escolha.** Uma função interna `toProblemDetails(error)` em `src/response.ts`, não exportada. `HTTPError.toJSON()` (`src/error.ts:226-236`) permanece idêntico.

**Alternativas consideradas.**
- *Alterar `toJSON` para aceitar opções ou ler uma flag*: `toJSON` é chamado pelo `JSON.stringify` de qualquer código que serialize o erro e não recebe `config`. Passar a flag por ele espalharia a opção para fora do fluxo de renderização. Além disso, o PRD exige que o caminho padrão não mude (RF-06), e alterar `toJSON` abre o risco "mudança silenciosa" listado no PRD.
- *Novo método público `HTTPError#toProblemJSON()`*: viola "nenhum outro nome público novo" (pedido.md, Restrições).

**Justificativa.** A regra "formato RFC só dentro de `errorResponse` com a opção ligada" do PRD (Riscos) vira estrutural: o caminho padrão não tem como ser afetado. `json-rpc` continua usando só `status`, `message`, `unhandled` (`src/utils/json-rpc.ts:480-484`), sem depender de `toJSON`.

### D-03 — `type` e `instance` entram em `ErrorInput`, não em `ErrorBody`

**Escolha.** `type?: string` e `instance?: string` em `ErrorInput` (`src/error.ts:6`), sem tocar em `ErrorBody` (`src/error.ts:30`).

**Alternativas consideradas.**
- *Adicionar em `ErrorBody`*: `ErrorBody` descreve o JSON do formato padrão. Colocar ali sugere que os campos saem por padrão, o que contradiz RF-06.

**Justificativa.** `ErrorInput` já é o lugar dos campos opcionais de entrada (`headers`, `cause`, `statusCode`, `statusMessage`, `src/error.ts:12-25`). `HTTPError` continua implementando `ErrorBody` sem mudança de contrato.

### D-04 — `type` e `instance` são lidos só do objeto de entrada, não de `cause`

**Escolha.** No construtor, `type` e `instance` vêm de `details` diretamente, como `data` e `body` (`src/error.ts:208-209`). Não herdam de `details.cause`.

**Alternativas consideradas.**
- *Herdar de `cause`, como `status`, `statusText` e `headers` (`src/error.ts:172-203`)*: `cause` costuma ser um erro externo (por exemplo, o que `src/adapters.ts:122-152` envolve com `unhandled: true`). Herdar um `type` de URI de um erro de driver faria um identificador interno sair na resposta como se fosse do app.

**Justificativa.** Reduz o risco de vazamento do PRD sem custo funcional: quem quer `type` define no `HTTPError`.

### D-05 — `Content-Type` exato `application/problem+json`, sem `charset`

**Escolha.** Novo `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json" })` ao lado de `jsonHeaders` (`src/response.ts:270-272`). O `error.headers` do usuário ainda é aplicado por cima com `mergeHeaders` (`src/response.ts:243-252`), como hoje.

**Alternativas consideradas.**
- *`application/problem+json; charset=UTF-8`*: a RFC não exige o parâmetro, e o PRD (RF-02) pede igualdade com `application/problem+json`.

**Justificativa.** Atende ao critério de aceite literal. Permitir que `error.headers` sobrescreva `content-type` mantém o comportamento atual (hoje também é possível).

### D-06 — Precedência no corpo: members RFC vencem; extensões vêm antes

**Escolha.** `toProblemDetails` monta o objeto com `data` e `...body` primeiro e `type`, `title`, `status`, `detail`, `instance` por último, para que os members RFC prevaleçam sobre colisões com `body`. A ordem relativa entre `data` e `body` é a mesma de hoje (em `toJSON`, `...body` vem depois de `data`, `src/error.ts:233-234`), então um `body.data` continua vencendo `data`.

**Alternativas consideradas.**
- *`...body` por último, como em `toJSON`*: um `body` com `type` ou `title` sobrescreveria o member RFC. Rejeitada; o PRD (Riscos, "Colisão de nomes") pede que os members RFC prevaleçam.

### D-07 — Erro `unhandled`: `detail` genérico, `data` e `body` ocultos, `type`/`instance` não mascarados

**Escolha.** Com `unhandled`, `detail` recebe `"HTTPError"` (o mesmo valor que `message` recebe em `src/error.ts:232`), `data` e `body` são omitidos (`src/error.ts:233-234`). `type` e `instance` não são mascarados, porque só podem vir do próprio código do app (D-04), nunca de `cause`.

**Observação.** `title` vem de `statusText`, que hoje já é exposto mesmo para erros `unhandled` (`src/error.ts:229`). Como `statusText` herda de `cause` (`src/error.ts:181-184`), `title` pode carregar o `statusText` de um erro externo. Isso não é vazamento novo, porque o JSON atual já o expõe; fica registrado em Riscos.

### D-08 — `stack`, indentação e `onError` não mudam

**Escolha.** `stack` continua sendo adicionado em `errorResponse` só com `debug` (hoje em `src/response.ts:369`). A indentação segue `config.debug ? 2 : undefined` (mesmo padrão de `src/response.ts:311` e `src/response.ts:372`). `onError` é chamado antes da renderização (`src/response.ts:159-166`), inalterado.

### D-09 — Cache: nenhuma mudança

**Escolha.** Nenhuma alteração em `src/utils/cache.ts` nem em `src/utils/internal/staged-headers.ts`. `withStagedHeaders` já não aplica headers de sucesso em respostas `>= 400` (`src/utils/internal/staged-headers.ts:69-70`). O `content-type` novo é definido em `errorResponse`, não é um header staged, e só muda o corpo de erro que o cache já recebe. O risco do PRD fica resolvido por inspeção, sem teste específico além do matrix de integração.

---

## 3. Arquivos a alterar

### 3.1 Código

| Arquivo | Alteração |
| --- | --- |
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` em `H3Config` com JSDoc. Inserir após `silent` (`src/types/h3.ts:37`). `H3CoreConfig` (`src/types/h3.ts:55`) herda sozinho. |
| `src/error.ts` | (a) `type?: string` e `instance?: string` em `ErrorInput` (inserir após `headers`, `src/error.ts:15`). (b) Campos `readonly type: string \| undefined` e `readonly instance: string \| undefined` na classe, após `unhandled` (`src/error.ts:119`). (c) Em `constructor`, após `this.body = ...` (`src/error.ts:209`), atribuir `type` e `instance` a partir de `details` (D-04). (d) `toJSON` (`src/error.ts:226-236`) **não muda**. |
| `src/response.ts` | (a) `errorResponse` (`src/response.ts:358-380`): assinatura passa a `(error: HTTPError, config: H3Config, errHeaders?: Headers)`; escolhe `problemHeaders` ou `jsonHeaders` e o corpo (`toProblemDetails` ou `error.toJSON()`). (b) Chamada em `src/response.ts:173`: `errorResponse(error, config, errHeaders)`. (c) `problemHeaders` após `jsonHeaders` (`src/response.ts:270-272`). (d) `toProblemDetails` no fim do arquivo (helper interno, D-06/D-07). `H3Config` já está importado (`src/response.ts:7`). |
| `docs/1.guide/900.api/1.h3.md` | Nova entrada `problemDetails` na lista de opções, perto de `silent` (`docs/1.guide/900.api/1.h3.md:112`) e `allowMalformedURL` (`docs/1.guide/900.api/1.h3.md:113`). |
| `docs/1.guide/1.basics/6.error.md` | Documentar `type` e `instance` na lista de campos (perto de `docs/1.guide/1.basics/6.error.md:60`) e o formato RFC com a opção ligada. Mencionar a mudança de members (`statusText`/`message` viram `title`/`detail`) e que `unhandled` não aparece nesse formato, como já se diz na nota de `docs/1.guide/1.basics/6.error.md:90`. |

**Não alterar:** `src/index.ts` (nenhum export novo; `HTTPError` já é exportado em `src/index.ts:72`), `src/_entries/*`, `package.json`, `src/utils/json-rpc.ts`, `src/utils/cache.ts`, `src/utils/internal/staged-headers.ts`, `test/unit/package.test.ts` (o snapshot de exports, `test/unit/package.test.ts:1-12`, continua válido).

### 3.2 Testes

| Arquivo | Situação |
| --- | --- |
| `test/problem-details.test.ts` | **Novo.** Integração com `describeMatrix` (ver seção 5). |
| `test/unit/error.test.ts` | **Novo.** Campos `type`/`instance` do `HTTPError` e `toJSON` inalterado (RF-04, RF-06). |
| `test/errors.test.ts` | **Sem alteração.** Os asserts de `content-type` (`test/errors.test.ts:44` exato, `:140` por `toMatch`) continuam válidos porque a opção é desligada por padrão. |
| `test/security.test.ts:556` | **Sem alteração.** |

Se algum teste existente quebrar, a causa será um bug na implementação, não um teste a ajustar. O PRD só permite ajuste em teste que dependa do que muda, e nesta spec nenhum teste existente depende do novo comportamento.

---

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
export interface H3Config {
  debug?: boolean;
  silent?: boolean;
  /**
   * When enabled, error responses are rendered as RFC 9457 problem details
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
  allowMalformedURL?: boolean;
  // ...demais campos inalterados
}
```

```ts
// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...campos existentes inalterados
  /** RFC 9457 `type` URI. Rendered only with `problemDetails`. Defaults to `about:blank`. Not validated. */
  type?: string;
  /** RFC 9457 `instance` URI reference. Rendered only with `problemDetails`. Not validated. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes inalterados
  /** RFC 9457 `type`, from the input object (not from `cause`). */
  readonly type: string | undefined;
  /** RFC 9457 `instance`, from the input object (not from `cause`). */
  readonly instance: string | undefined;

  // constructor: this.type = (details as ErrorInput)?.type || undefined;
  //              this.instance = (details as ErrorInput)?.instance || undefined;

  toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]; // inalterado
}
```

```ts
// src/response.ts (internos; nada exportado novo)
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

function toProblemDetails(error: HTTPError): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    data: unhandled ? undefined : error.data,
    ...(unhandled ? undefined : error.body),
    type: error.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    instance: error.instance,
  };
}
```

**Corpo com a opção ligada** (`errorResponse` acrescenta `stack` só com `debug`, como hoje):

```json
{
  "type": "https://exemplo.com/erros/validacao",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Campo inválido",
  "instance": "/pedidos/42",
  "data": { "...": "se houver" }
}
```

**Corpo com a opção desligada:** inalterado, `status`, `statusText`, `unhandled`, `message`, `data` e `body` como hoje, com `application/json;charset=UTF-8`.

**Observação sobre `title`.** Quando `statusText` não está definido, `title` some do corpo (JSON.stringify omite `undefined`), o que satisfaz RF-03.

---

## 5. Estratégia de testes

Seguir o fluxo de `AGENTS.md` (escrever o teste, ver falhar, implementar, ver passar). Usar `describeMatrix` (`test/_setup.ts:11`) para rodar em web e node. Como o contexto padrão tem `debug: true` (`test/_setup.ts:136`), os testes de debug desligado usam `ctx.app.config.debug = false`, e os de opção usam `ctx.app.config.problemDetails = true`, seguindo o padrão de `t.app.config.onError = undefined` em `test/errors.test.ts:27`.

**`test/problem-details.test.ts`** (integração)

1. Opção ausente: `config.problemDetails` é `undefined`/`false`; erro `HTTPError.status(404, "Not Found", { message })` responde `application/json;charset=UTF-8` e corpo atual (RF-01, RF-06).
2. Opção ligada, `HTTPError` 404: status 404, `content-type` exatamente `application/problem+json`, corpo com `status: 404` (RF-02).
3. Opção ligada, `throw new Error("x")`: status 500, `content-type: application/problem+json`, `unhandled` ausente no corpo (RF-02, RF-05).
4. Opção ligada, `HTTPError` de 422 com `type`, `instance`, `statusText`, `message`, `data` e `body`: corpo exatamente como no contrato (RF-03).
5. Opção ligada, `HTTPError` sem `type` e sem `statusText`: `type === "about:blank"` e chave `title` ausente (RF-03).
6. Colisão: `body: { type: "x", title: "y", detail: "z" }`: members RFC prevalecem (D-06).
7. Erro `unhandled` com `message: "senha do banco incorreta"` e `data`: corpo tem `detail: "HTTPError"`, não contém a string secreta e não tem `data` (RF-05). Verificar também `t.errors` para o `unhandled` não disparar o `afterEach` (usar `allowUnhandledErrors` se necessário, como outros testes de erro).
8. `error.headers: { "x-erro": "1" }` com `debug: true`: `x-erro: 1`, `content-type: application/problem+json`, `stack` como array de linhas (RF-07).
9. Mesmo cenário com `debug: false`: sem `stack` (RF-07).
10. `onError` continua sendo chamado (`t.hooks.onError` com 1 chamada) e um `event.res.errHeaders` staged ainda é aplicado (RF-07).
11. HEAD com erro: corpo vazio, `content-type` ainda `application/problem+json` (paridade com `test/errors.test.ts:27-60`).
12. Opção ligada e `onError` devolvendo `Response` própria: a resposta do hook é usada e não é reformatada (paridade com o caminho `nested` em `src/response.ts:161-165`).

**`test/unit/error.test.ts`** (unitário)

13. `new HTTPError({ status: 409, type, instance })`: `err.type` e `err.instance` com os valores (RF-04).
14. `new HTTPError("Erro", { status: 400 })`: `type` e `instance` são `undefined` (RF-04).
15. `new HTTPError({ cause: new HTTPError({ status: 400, type: "x" }) })`: `type` é `undefined`, confirmando D-04.
16. `JSON.stringify(new HTTPError({ status: 409, type, instance }))` não contém `type` nem `instance` (RF-06, `toJSON` inalterado).

**Verificação final**

- `pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts`
- `pnpm vitest run test/errors.test.ts test/security.test.ts test/json-rpc.test.ts` (regressão)
- `pnpm vitest run` (suíte completa, sem alterar testes existentes)
- `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` (`tsc --noEmit`), conforme `package.json:46` e `package.json:54`.

---

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Vazamento de dados internos em erro `unhandled` (PRD) | Alto | `detail` fixo em `"HTTPError"`, `data`/`body` omitidos (D-07); testes 7 e 8. `type`/`instance` não herdam de `cause` (D-04). |
| `title` herdar `statusText` de `cause` em erro `unhandled` | Baixo | Já é o comportamento de `statusText` hoje (`src/error.ts:200`, `:229`). Documentar; não mascarar nesta entrega, para não divergir do formato padrão. |
| Colisão entre `body` do app e members RFC | Médio | Members RFC por último (D-06); teste 6. |
| Mudança silenciosa no caminho padrão | Alto | `toJSON` intocado (D-02); `errorResponse` só usa `problemHeaders` com a opção ligada; testes 1 e 16. |
| Clientes que leem `statusText`/`message`/`unhandled` no formato novo | Médio | Opção desligada por padrão; documentação em `docs/1.guide/1.basics/6.error.md`. |
| `error.headers` com `content-type` próprio sobrescreve `problem+json` | Baixo | Comportamento igual ao atual para `application/json` (D-05). Documentar. |
| Mounts: sub-app com `problemDetails` próprio renderizado pelo app pai | Médio | Mesmo comportamento de `debug`/`onError` hoje; a opção vale para o app que renderiza. Documentar em `docs/1.guide/900.api/1.h3.md`. Não há teste de sub-app nesta entrega. |
| Mounts de `fetch` externo (`src/h3.ts:220-226`) | Baixo | Respostas de outro handler passam sem reformatação, como hoje. Fora de escopo. |
| Cache intermediário guardar o `content-type` novo | Baixo | Sem alteração em cache (D-09). Erros `>= 400` já não recebem headers staged (`src/utils/internal/staged-headers.ts:69-70`). |
| Tipagem: `ErrorInput` aceitar `type` tipado como `string` e uso em JS com valor não-string | Baixo | Sem validação (PRD). O valor vem do próprio código do app, não de requisição. |

---

## 7. Fora de escopo (reafirmação do PRD)

Negociação por `Accept`, opção por rota, formato de erros de validação com lista de campos, validação de URIs de `type`, integração com Nitro/`h3/rules`/JSON-RPC, novos exports, mudanças em build ou `package.json`.
