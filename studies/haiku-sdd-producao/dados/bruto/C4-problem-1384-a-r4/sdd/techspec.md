# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08).

Todas as citações `caminho:linha` foram conferidas no código atual (branch `master`, commit `1ad885a`).

## Visão geral

Hoje, todo erro renderizado pelo h3 passa por `errorResponse` em `src/response.ts:358`, que monta um JSON a partir de `HTTPError.toJSON()` e usa `application/json`. A mudança adiciona um ramo nesse ponto: quando `H3Config.problemDetails` está ligado, o corpo é montado por um helper interno com os membros da RFC 9457 e o `Content-Type` passa a ser `application/problem+json`. Com a opção desligada, o caminho é o mesmo de hoje.

Não há mudança em `HTTPError.toJSON()`, em `onError`, em `json-rpc` nem em nenhum outro módulo de renderização. Nenhum nome público novo é exportado.

---

## Decisões de arquitetura

### D-01 — Gatilho é uma opção de `H3Config`, lida de `config` na renderização

**Escolha:** `problemDetails?: boolean` em `H3Config` (`src/types/h3.ts:28`). O valor chega a `errorResponse` pelo mesmo `config` que já circula pelo fluxo: `H3Core.~request` passa `this.config` para `toResponse` (`src/h3.ts:99`), que repassa a `prepareResponse` (`src/response.ts:132`).

**Alternativas consideradas:**
- *Flag por rota ou por `HTTPError`:* daria granularidade, mas o PRD pede uma opção de aplicação. Também exigiria novo nome público ou novo campo em `ErrorInput`.
- *Variável de ambiente:* foge do padrão do projeto, onde toda configuração vai pelo objeto de `H3Config`.
- *Negociação por `Accept`:* fora de escopo (PRD).

**Justificativa:** segue o padrão de `debug`, `silent` e `allowMalformedURL` (`src/types/h3.ts:32`, `:37`, `:46`), que são booleanos de `H3Config` lidos em tempo de renderização. Como `freezeApp` congela `app.config` (`src/_entries/_common.ts:5`), a opção não muda em tempo de execução, conforme a premissa do PRD.

### D-02 — Ramo dentro de `errorResponse`, trocando o parâmetro `debug` por `config`

**Escolha:** `errorResponse` passa a receber `config: H3Config` em vez de `debug?: boolean` (`src/response.ts:358`). Ele lê `config.debug` e `config.problemDetails`. A única chamada, em `src/response.ts:173`, passa a ser `errorResponse(error, config, errHeaders)`.

**Alternativas consideradas:**
- *Função separada `toProblemResponse` chamada de `prepareResponse`:* duplicaria a lógica de `errHeaders`, de `error.headers` e de `stack`, e exigiria decidir de novo qual caminho vale em cada chamada.
- *Passar um quarto parâmetro booleano:* funciona, mas `config` já contém as duas informações e fica mais simples.

**Justificativa:** um único lugar decide o formato, e `errHeaders`, `error.headers`, `stack` e a indentação com `debug` continuam iguais nos dois formatos. Isso também cobre automaticamente os erros que chegam ao h3 como `HTTPError`: 404 de rota (`src/response.ts:139-143`), 400 de URL malformada (`src/h3.ts:83`), erros de validação e de corpo (`src/utils/body.ts:72`, `src/utils/query.ts:67`) e erros não tratados convertidos por `toError` (`src/response.ts:73-83`).

### D-03 — Montagem dos membros em helper interno, sem reutilizar `toJSON()`

**Escolha:** um novo arquivo `src/utils/internal/problem.ts` com a função interna `toProblemDetails(error)`. Ela monta o objeto a partir dos campos do `HTTPError`, sem passar por `toJSON()`.

**Alternativas consideradas:**
- *Reaproveitar `error.toJSON()` e renomear chaves:* não serve, porque `toJSON()` deixa o `body` do erro sobrescrever `message` e `status` (`src/error.ts:232`, `:234`). A precedência "campos padrão vencem" do PRD não se cumpre desse jeito.
- *Método `toProblemDetails()` público em `HTTPError`:* criaria um nome público novo, o que o PRD proíbe (RF-06).
- *Dentro de `src/response.ts`:* o arquivo já tem cerca de 380 linhas, acima do limite de ~200 linhas por arquivo do `AGENTS.md`.

**Justificativa:** o helper fica interno (`utils/internal`, conforme a convenção do `AGENTS.md`), não é exportado pelo `src/index.ts`, e `toJSON()` continua intacto. A máscara de erros `unhandled` (`src/error.ts:232-233`) é repetida no helper; isso é um custo aceito e é coberto pelo teste de RF-05.

### D-04 — Precedência: membros padrão vencem `body` e `data`

**Escolha:** a ordem do objeto é: extensões (`data`, `unhandled`, `...body` quando não `unhandled`), depois os membros padrão (`type`, `title`, `status`, `detail`, `instance`). Como em objetos JS a última chave vence, `body` com chaves `type`, `title`, `status`, `detail` ou `instance` não sobrescreve os valores padrão. Dentro das extensões, `...body` continua vencendo `data`, como em `toJSON()` (`src/error.ts:233-234`).

**Alternativas consideradas:**
- *Manter a precedência de `toJSON()`, em que `body` vence:* é o que o PRD chama de risco ("colisão de nomes"), e o PRD sugere explicitamente que os campos padrão vençam.

**Justificativa:** RFC 9457 exige que `type`, `title`, `status` e `detail` tenham o significado padrão, e um `body` que os altere quebraria clientes. A divergência fica restrita ao formato novo; `toJSON()` não muda.

### D-05 — `Content-Type: application/problem+json`, sem parâmetro de charset

**Escolha:** um novo `FrozenHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`):

```ts
const problemJSONHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

`errorResponse` escolhe a base dos cabeçalhos com `config.problemDetails`. O `error.headers` e o `errHeaders` continuam sendo mesclados por cima, como hoje.

**Alternativas consideradas:**
- *`application/problem+json;charset=UTF-8`, como `jsonHeaders`:* a RFC 9457 registra o tipo sem parâmetro, e JSON é UTF-8 por definição. O PRD também escreve `application/problem+json` literalmente (RF-03).

**Justificativa:** segue o registro da RFC e o texto do PRD. Os testes existentes usam `toMatch` para `application/json` (`test/errors.test.ts:140`), então não são afetados, porque a opção fica desligada por padrão.

### D-06 — `type` e `instance` vêm só do objeto de entrada, como strings

**Escolha:**
- `ErrorBody` ganha `type?: string` e `instance?: string` (`src/error.ts:30-69`). `ErrorInput` herda os dois campos porque estende `Partial<ErrorBody>` (`src/error.ts:6`).
- `HTTPError` expõe `readonly type` e `readonly instance` (`src/error.ts:92-119`).
- No construtor, o valor é lido só de `details` e aceito apenas se for `string`. Não é herdado de `cause`.
- `error.type` continua `undefined` quando ausente. O padrão `about:blank` aparece só na renderização (D-03).

**Alternativas consideradas:**
- *Herdar de `cause`, como `unhandled` (`src/error.ts:205-206`) e `statusText` (`src/error.ts:181-184`):* quebra quando a causa é um objeto com `type` que não é URI de problema, como um `Event` do DOM ou uma exceção de biblioteca. Um `HTTPError` embrulhado sobre uma causa assim ganharia um `type` sem sentido.
- *Aceitar qualquer valor:* um `type` não-string deixaria o JSON com um tipo inválido.

**Justificativa:** o campo `type` é um URI, e a única fonte confiável é o que o próprio código da aplicação passou. A checagem de `string` evita que um objeto qualquer, passado como `details`, injete valores que não sejam texto.

### D-07 — Tipos: `ErrorBody` e `H3Config` ganham os campos; assinaturas de `toJSON()` e do construtor não mudam

**Escolha:** a assinatura de `toJSON()` (`src/error.ts:226`) fica como está. `ErrorBody` ganha `type?` e `instance?` como opcionais, então a tipagem do retorno de `toJSON()` continua válida, mesmo que o objeto retornado não traga esses campos.

**Justificativa:** RF-06 pede que os tipos reflitam os campos novos, sem nomes públicos extras. Mudar `toJSON()` está fora de escopo (PRD).

### D-08 — `onError` sem mudança; o erro devolvido ao h3 passa pelo mesmo ramo

**Escolha:** nenhuma mudança em `prepareResponse`. Quando `onError` não devolve valor, `prepareResponse` é chamado de novo com o próprio `HTTPError` e `nested = true` (`src/response.ts:161-165`). Essa segunda chamada cai no bloco de erro (`src/response.ts:146-174`) e renderiza via `errorResponse`, então o formato de problem details se aplica. Quando `onError` devolve um valor, ele é renderizado como hoje (JSON comum ou `Response`), conforme a premissa do PRD.

**Justificativa:** mantém o comportamento que o PRD pede, sem caminho especial.

### D-09 — `unhandled` continua como membro de extensão quando verdadeiro

**Escolha:** quando o erro é `unhandled`, o membro `unhandled: true` aparece como extensão, como em `toJSON()` (`src/error.ts:231`). `detail` vira `"HTTPError"`, `data` e `body` somem, e `stack` aparece só com `debug`.

**Alternativas consideradas:**
- *Remover `unhandled` do corpo:* o corpo não expõe nada sensível, e manter o campo preserva a informação que clientes atuais já recebem. O PRD não fala sobre esse campo.

**Ponto para revisão:** esta é uma escolha que o PRD não cobre. Se o mantenedor preferir remover o campo no formato RFC, basta tirar a linha `unhandled: error.unhandled` do helper e atualizar o teste de RF-05.

---

## Arquivos a alterar

| Arquivo | O que muda | Referências |
| --- | --- | --- |
| `src/types/h3.ts` | Campo `problemDetails?: boolean` em `H3Config`, com JSDoc. | Inserir depois de `silent` (`src/types/h3.ts:37`). |
| `src/error.ts` | `type?`/`instance?` em `ErrorBody`; `readonly type`/`readonly instance` em `HTTPError`; leitura no construtor. `toJSON()` não muda. | `src/error.ts:30-69` (`ErrorBody`), `:92` (`statusText`), `:119` (`unhandled`), `:197-210` (construtor), `:226-236` (`toJSON`). |
| `src/response.ts` | Nova constante de cabeçalho; `errorResponse` recebe `config`; ramo que escolhe o formato; chamada atualizada. | `src/response.ts:146-174` (bloco de erro), `:173` (chamada), `:270-272` (`jsonHeaders`), `:358-380` (`errorResponse`). |
| `src/utils/internal/problem.ts` | **Arquivo novo.** Função `toProblemDetails(error)`. | D-03. |
| `test/problem-details.test.ts` | **Arquivo novo.** Testes de integração com `describeMatrix`. | Estratégia de testes. |
| `test/unit/problem-details.test.ts` | **Arquivo novo.** Testes unitários de `HTTPError.type`/`instance` e de `toProblemDetails`. | Estratégia de testes. |
| `test/unit/types.test-d.ts` | Asserções de tipo para `problemDetails`, `type` e `instance`. | Estratégia de testes. |

Nenhum arquivo existente de teste precisa mudar. Com a opção desligada, todos os caminhos de `test/errors.test.ts` continuam iguais. Se algum teste existente quebrar, a causa mais provável é uma mudança de ordem de chaves no corpo, e o ajuste deve ser o mínimo possível.

Não há mudança em `src/index.ts`, `src/h3.ts`, `src/adapters.ts`, `src/utils/json-rpc.ts` nem em `src/_entries/*`.

---

## Contratos e assinaturas

### `src/types/h3.ts` — `H3Config`

```ts
export interface H3Config {
  debug?: boolean;
  silent?: boolean;

  /**
   * When enabled, H3 renders error responses as RFC 9457 problem details
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;

  allowMalformedURL?: boolean;
  plugins?: H3Plugin[];
  onRequest?: (event: H3Event) => MaybePromise<void>;
  onResponse?: (response: Response, event: H3Event) => MaybePromise<void>;
  onError?: (error: HTTPError, event: H3Event) => MaybePromise<void | unknown>;
}
```

### `src/error.ts` — `ErrorBody`, `HTTPError`

```ts
export interface ErrorBody<DataT = unknown> {
  status: number;
  statusText?: string;
  message: string;
  unhandled?: boolean;
  data?: DataT;
  body?: Record<string, unknown>;

  /** RFC 9457 `type` URI. Rendered as `about:blank` when unset, with `problemDetails` on. */
  type?: string;

  /** RFC 9457 `instance` URI for this occurrence of the problem. Never filled automatically. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes...
  readonly type: string | undefined;
  readonly instance: string | undefined;

  constructor(arg1: string | ErrorDetails, arg2?: ErrorDetails);
  // Dentro do construtor, depois de `this.body = ...`:
  //   const type = (details as ErrorBody)?.type;
  //   this.type = typeof type === "string" ? type : undefined;
  //   const instance = (details as ErrorBody)?.instance;
  //   this.instance = typeof instance === "string" ? instance : undefined;

  toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]; // sem mudança
}
```

### `src/utils/internal/problem.ts` — novo

```ts
import type { HTTPError } from "../../error.ts";

/**
 * RFC 9457 members for an error. Standard members are written last, so they win over
 * `body` and `data` extension members. `unhandled` errors hide `detail`, `data` and `body`.
 */
export function toProblemDetails(error: HTTPError): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    data: unhandled ? undefined : error.data,
    unhandled: error.unhandled,
    ...(unhandled ? undefined : error.body),
    type: error.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    instance: error.instance,
  };
}
```

### `src/response.ts` — `errorResponse`

```ts
const problemJSONHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const problem = config.problemDetails;
  const baseHeaders = problem ? problemJSONHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const stack = config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined;
  return new FastResponse(
    JSON.stringify(
      { ...(problem ? toProblemDetails(error) : error.toJSON()), stack },
      undefined,
      config.debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Chamada em `prepareResponse` (`src/response.ts:173`): `val = errorResponse(error, config, errHeaders);`.

### Corpo esperado (exemplos)

Com `problemDetails: true`, `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido" })`:

```json
{
  "data": undefined,
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Campo inválido",
  "instance": undefined
}
```

(`undefined` some na serialização; o corpo real é `{"type":"about:blank","title":"Unprocessable Content","status":422,"detail":"Campo inválido"}`.)

Com `new Error("segredo interno")` e `debug` desligado: status 500, `detail: "HTTPError"`, sem `stack`, sem `data`, sem `body`.

### Tipos

`pnpm typecheck` deve aceitar `new H3({ problemDetails: true })` e `new HTTPError({ status: 400, type: "x", instance: "y" })`, e rejeitar `problemDetails: "sim"`.

---

## Estratégia de testes

Seguindo o fluxo de correção do `AGENTS.md` (teste de regressão que falha antes da mudança), os testes são escritos primeiro e rodados antes de qualquer alteração em `src/`.

### Teste de integração — `test/problem-details.test.ts` (novo, `describeMatrix`)

`describeMatrix` roda cada caso em `web` e `node` (`test/_setup.ts:11`). Como `ctx.app` é criado com `debug: true` (`test/_setup.ts:135-141`), os casos que precisam de `debug` desligado mudam a config do app no próprio teste, no mesmo padrão de `test/errors.test.ts:14`: `t.app.config.problemDetails = true;`. Isso funciona nos dois targets porque `toNodeHandler` não congela a config (`src/_entries/node.ts:23-25`); só `serve` congela (`src/_entries/node.ts:16`). Casos que usam `serve` devem criar o app com `new H3(...)` próprio.

Casos:

1. **RF-02, opção desligada:** o corpo é igual a `HTTPError.toJSON()` e o `Content-Type` continua `application/json;charset=UTF-8`.
2. **RF-03:** `422` com `statusText`, `message` e `data`. Verifica status, `Content-Type` exato `application/problem+json`, e o corpo com `type: "about:blank"`, `title`, `status`, `detail`, `data` como extensão.
3. **RF-03, `type` e `instance`:** valores passados ao `HTTPError` aparecem no corpo; `instance` não é preenchido com a URL quando ausente.
4. **D-04, precedência:** `body: { title: "x", status: 999, detail: "y", type: "z" }` não sobrescreve os campos padrão, e `body` com chave extra aparece no topo.
5. **RF-05:** `new Error("segredo interno")` com `debug` desligado e `silent` ligado: status 500, `Content-Type` problem, `detail` diferente de `"segredo interno"`, sem `stack`. O teste precisa limpar `t.errors` (como `test/errors.test.ts:116`), porque `afterEach` falha quando há erro não tratado (`test/_setup.ts:152-157`).
6. **Debug ligado:** `stack` aparece como extensão no corpo problem.
7. **Rota inexistente:** 404 com `Content-Type` problem, para confirmar que `kNotFound` passa pelo mesmo ramo.
8. **HEAD:** resposta sem corpo, com `Content-Type` problem.
9. **`onError`:** (a) `onError` que não devolve valor → corpo problem; (b) `onError` que devolve objeto → corpo JSON comum com `application/json`, conforme D-08.
10. **Validação:** erro de `readValidatedBody` (ou `validateData`) renderizado como problem, para confirmar a premissa do PRD.
11. **`errHeaders` e `error.headers`:** `errHeaders` continua mesclado, `set-cookie` continua acumulando, e um `content-type` vindo de `error.headers` substitui o padrão (comportamento documentado em D-05).

### Teste unitário — `test/unit/problem-details.test.ts` (novo)

- `new HTTPError({ status: 403, type: "https://example.com/probs/forbidden", instance: "/req/1" })` → `error.type` e `error.instance` com os valores.
- `new HTTPError({ status: 403 })` → ambos `undefined` (RF-04).
- `type` não é herdado de `cause`: `new HTTPError({ status: 500, cause: { type: "click" } })` → `error.type` é `undefined`.
- `type` não-string é ignorado: `new HTTPError({ status: 400, type: 42 as any })` → `undefined`.
- `toProblemDetails` com erro `unhandled`: sem `detail` original, sem `data`, sem `body`.

### Tipos — `test/unit/types.test-d.ts` (existente, com novas asserções)

- `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()`.
- `expectTypeOf<ErrorInput["type"]>().toEqualTypeOf<string | undefined>()`, e o mesmo para `instance`.
- `expectTypeOf(new HTTPError({ status: 400, type: "x", instance: "y" })).toHaveProperty("type")`.

### Regressão da suíte existente

- `pnpm vitest run test/errors.test.ts`: deve passar sem alteração (opção desligada).
- `pnpm vitest run`: suíte completa.
- `pnpm typecheck` (`tsc --noEmit`, `package.json:54`).
- `pnpm lint` (`oxlint . && oxfmt --check .`, `package.json:46`).

**Observação:** o `AGENTS.md` diz que `pnpm lint` inclui typecheck, mas o script em `package.json:46` não inclui. Os dois comandos devem ser rodados separadamente.

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Clientes que checam `application/json` quebram quando a opção é ligada (PRD). | Alto para quem liga a opção. | Opção desligada por padrão; mudança documentada no JSDoc de `problemDetails`. |
| `body` com chaves padrão altera o corpo (PRD). | Médio. | D-04: membros padrão vencem. Teste 4. |
| Vazamento em erro não tratado (PRD). | Alto. | D-03 repete a máscara de `toJSON()`; teste 5. |
| `type` herdado de uma causa sem significado de URI. | Médio. | D-06: `type` só de `details`, só string. |
| Máscara de `unhandled` duplicada entre `toJSON()` e `toProblemDetails()`. | Baixo; divergência futura. | Teste de RF-05 cobre o comportamento; se a regra mudar, atualizar os dois lugares. Alternativa: extrair constante compartilhada `"HTTPError"` depois. |
| `error.headers` com `content-type` substitui o `application/problem+json`. | Baixo. | Comportamento igual ao atual com `application/json`; documentado no teste 11. |
| Testes de `config` mutável no target `node` podem falhar se `serve` for chamado. | Baixo. | Casos com `serve` criam app próprio (ver estratégia). |
| Nome `type` pode colidir com quem já usa o campo em `ErrorInput` de outra forma (PRD: "requer validação com o mantenedor"). | Médio. | Ponto para revisão do mantenedor antes do merge. Não há alternativa que mantenha o nome exigido pelo PRD. |
| Divergência entre `AGENTS.md` e `package.json` sobre `pnpm lint`. | Baixo. | Rodar `pnpm lint` e `pnpm typecheck` separadamente. |

## Pontos abertos para o mantenedor

1. **D-09:** manter `unhandled: true` no corpo problem, ou remover?
2. **D-06:** confirmar que `type` não deve ser herdado de `cause` (diferente de `unhandled` e `statusText`).
3. **Risco de `type`:** confirmar o uso do nome `type` em `ErrorInput`, como pede o PRD.
