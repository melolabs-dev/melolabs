# Especificação técnica — Problem details (RFC 9457) como opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-06).

Todas as referências `arquivo:linha` foram conferidas no código atual (commit `3d21478`, branch `master`).

## Resumo

- `H3Config` ganha `problemDetails?: boolean` (padrão `false`).
- `HTTPError` ganha as propriedades `type` e `instance`, aceitas em `ErrorInput` e expostas na instância. Não entram em `toJSON()`.
- Com a opção ligada, `errorResponse` (em `src/response.ts`) renderiza o corpo como problem details, com `Content-Type: application/problem+json`.
- A lógica de montagem do corpo vai para um módulo interno novo, `src/utils/internal/problem.ts`.
- Nenhum export público novo. `test/unit/package.test.ts` (snapshot de exports) não muda.

## Arquitetura

### D-01 — `type` e `instance` como propriedades de `HTTPError`, fora de `ErrorBody`/`toJSON`

Os campos entram na interface de entrada `ErrorInput` (`src/error.ts:6`) e como propriedades `readonly` da classe (`src/error.ts:74`), ao lado de `data` e `body` (`src/error.ts:107`, `:112`). Não entram em `ErrorBody` (`src/error.ts:30`) nem em `toJSON()` (`src/error.ts:226`).

**Por quê:** `toJSON()` é a forma atual do corpo de erro. Se `type` ou `instance` aparecessem ali, um `HTTPError` com `type` definido mudaria o corpo que já é servido hoje, o que viola RF-06 e a suíte existente. Ficando de fora, o formato atual não muda.

**Alternativas consideradas:**
- Adicionar em `ErrorBody` e `toJSON()`: rejeitada, muda o corpo atual (RF-06).
- Herdar `type`/`instance` de `details.cause`, como `status` e `headers` (`src/error.ts:162-209`): rejeitada. `data` e `body` não herdam (`src/error.ts:208-209`), e `type`/`instance` são metadados do problema escolhido pelo autor do erro. Se herdassem, um erro embrulhado poderia trazer um `type` que o autor não pretendia expor.

**Conflito de nomes:** verificado. Nenhum uso de `.type` ou `.instance` em `src/error.ts`, `src/response.ts` ou `src/utils/middleware.ts`, e `Error` não tem essas propriedades.

### D-02 — Padrão `false` aplicado no construtor de `H3Core`

`H3Core` guarda `config` como veio (`src/h3.ts:55`). RF-01 exige que `app.config.problemDetails` valha `false` quando a opção não é passada, então o padrão é preenchido ao guardar a configuração:

```ts
this.config = { ...config, problemDetails: config.problemDetails ?? false };
```

**Por quê:** é o único ponto por onde toda aplicação passa (`H3` e `H3Core`), e `app.config` continua sendo a fonte de verdade que `freezeApp` congela (`src/_entries/_common.ts:5`).

**Alternativas consideradas:**
- Deixar `undefined` e ler com `?? false` em `errorResponse`: rejeitada, RF-01 pede que o valor lido de `app.config` seja `false`.
- Padrão no tipo via `Required<Pick<...>>`: rejeitada, complica `H3CoreConfig` (`src/types/h3.ts:55`) sem ganho.

**Efeito colateral:** `app.config` deixa de ser o mesmo objeto recebido. Não há teste que dependa da identidade (busca em `test/` sem resultados para `config).toBe`/`config ===`).

### D-03 — Módulo interno novo para o corpo do problem details

Nova função em `src/utils/internal/problem.ts`:
- `toProblemDetails(error)`: monta o objeto `ProblemDetails`.
- Tabela de títulos de status (`statusTitles`), no final do arquivo.

**Por quê:** `src/response.ts` já tem 381 linhas, e o `AGENTS.md` pede arquivos com menos de 200 linhas e helpers internos em `utils/internal/`.

**Alternativas consideradas:**
- Colocar tudo em `src/response.ts`: rejeitada, aumenta o arquivo que já passa do limite.
- Usar `STATUS_CODES` de `node:http`: rejeitada, o projeto prefere APIs web (`AGENTS.md`, "Best Practices") e o módulo precisa rodar em Workers e browsers.
- Usar só `error.statusText` como `title`: rejeitada, PRD (premissas) pede o texto padrão do status (`"Not Found"` para 404), e `statusText` é customizável.

### D-04 — `errorResponse` recebe `config` em vez de `debug`

Hoje a assinatura é `errorResponse(error, debug?, errHeaders?)` (`src/response.ts:358`) e a chamada é `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`). Passar `config` inteiro dá acesso a `problemDetails` sem novo parâmetro. Há um único call site (verificado por busca).

**Alternativas consideradas:**
- Adicionar um quarto parâmetro booleano: rejeitada, assinatura já tem parâmetros posicionais opcionais e isso piora a leitura.
- Montar o problem details fora de `errorResponse`, em `prepareResponse`: rejeitada, duplicaria a lógica de headers (`errHeaders`, `error.headers`) que já está em `errorResponse`.

### D-05 — Mascaramento e ausência de `stack` no corpo de problem details

Regras do corpo quando `problemDetails` está ligada:
- `status`: `error.status`.
- `title`: `statusTitles[status]`, ou `error.statusText` se o código não estiver na tabela. Campo omitido se nenhum existir.
- `type`: `error.type` quando o erro não é `unhandled`, senão `"about:blank"` (RFC 9457 §4.2.1).
- `detail`: `error.message` quando o erro não é `unhandled`, senão omitido.
- `instance`: `error.instance` quando o erro não é `unhandled`, senão omitido.
- `stack`: **nunca** entra no corpo, nem em modo `debug`.

**Por quê:** erros comuns chegam como `HTTPError` com `unhandled: true` (`src/response.ts:149-151`), e o `toJSON()` já mascara `message` e `data` nesse caso (`src/error.ts:226-237`). A mesma regra vale para os campos novos, o que cobre RF-05 e o risco de `type` vir de um `Error` qualquer, que pode ter propriedade `type` própria (ver R-02).

O teste de RF-05 roda com `debug: true` (`test/_setup.ts:136`). Se o `stack` entrasse no corpo nesse modo, a mensagem `"falha interna do banco"` vazaria pelo stack e o teste falharia. Como o `console.error` do erro não tratado continua acontecendo (`src/response.ts:156-158`, desligado só com `silent`), o debug não perde a informação do log.

**Alternativas consideradas:**
- Incluir `stack` em `debug`, como o formato atual faz (`src/response.ts:369`): rejeitada, PRD não lista `stack` entre os campos, e isso vaza a mensagem de erros 500 (RF-05).
- Incluir `stack` apenas quando o erro não é `unhandled`: rejeitada, complica a regra sem ganho claro. Pode ser avaliada depois, se houver pedido.

### D-06 — `Content-Type` base, com `error.headers` e `errHeaders` ainda podendo sobrescrever

`errorResponse` hoje começa com `jsonHeaders` (`src/response.ts:270-272`) e mescla `error.headers` e `errHeaders` por cima. Com a opção ligada, o cabeçalho base vira `application/problem+json`, e a mesma ordem de mescla continua valendo.

**Por quê:** é o comportamento que já existe para o `Content-Type` JSON. Quem precisar de outro tipo continua podendo definir `headers` no `HTTPError`.

**Alternativas consideradas:**
- Forçar `application/problem+json` por cima de tudo: rejeitada, quebra a precedência que já existe para `headers` e `errHeaders`.

### D-07 — Escopo: só o caminho de `prepareResponse`/`errorResponse`

Ficam fora desta mudança:
- `handler.ts:122-124` (`defineHandler(...).fetch`) chama `toResponse(...)` sem `config`. Os modos `debug` e `onError` também não valem nesse caminho, então `problemDetails` segue o mesmo padrão.
- Respostas de JSON-RPC (`src/utils/json-rpc.ts:484-491`) mantêm o envelope JSON-RPC.
- `onError` continua rodando antes da renderização (`src/response.ts:159-166`). Se o hook devolver uma `Response`, ela substitui o problem details. Se devolver `undefined`, o erro é renderizado com a opção que estiver ligada.
- Sub-apps montadas com `mount()` renderizam com a própria configuração quando são apps `.fetch`. Isso segue a regra já documentada em `src/types/h3.ts` para `mount`.

### D-08 — Aplicação da opção por configuração global, sem parâmetro por rota

O gatilho é só `H3Config.problemDetails`, lido de `this.config` no momento do request (`src/h3.ts:99` passa `this.config` para `toResponse`). Isso segue PRD (fora de escopo: opção por rota).

## Contratos e assinaturas

### `src/types/h3.ts` — `H3Config` (linha 28)

Adicionar entre `allowMalformedURL` (`:46`) e `plugins` (`:48`):

```ts
/**
 * When enabled, error responses use RFC 9457 problem details (`application/problem+json`).
 * Disabled by default.
 */
problemDetails?: boolean;
```

### `src/error.ts` — `ErrorInput` (linha 6) e `HTTPError` (linha 74)

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /** RFC 9457 `type`: URI reference that identifies the problem type. */
  type?: string;
  /** RFC 9457 `instance`: URI reference that identifies this occurrence of the problem. */
  instance?: string;
  // ...campos existentes
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /**
   * RFC 9457 problem type. `undefined` is rendered as `about:blank` in problem details.
   */
  readonly type: string | undefined;

  /**
   * RFC 9457 occurrence URI reference.
   */
  readonly instance: string | undefined;
  // ...campos existentes
}
```

No construtor, depois de `this.body = (details as ErrorBody)?.body;` (`src/error.ts:209`):

```ts
this.type = (details as ErrorInput)?.type;
this.instance = (details as ErrorInput)?.instance;
```

`toJSON()` (`src/error.ts:226`) não muda.

### `src/h3.ts` — `H3Core` constructor (linhas 53-57)

```ts
constructor(config: H3CoreConfig = {}) {
  this["~middleware"] = [];
  this.config = { ...config, problemDetails: config.problemDetails ?? false };
  this.fetch = this.fetch.bind(this);
  this.handler = this.handler.bind(this);
}
```

### `src/utils/internal/problem.ts` (novo)

```ts
import type { HTTPError } from "../../error.ts";

/**
 * Problem details body (RFC 9457, section 3.1).
 */
export interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
}

/**
 * Build the RFC 9457 body for an error. Unhandled errors hide their message, type and instance,
 * as `HTTPError#toJSON` does.
 */
export function toProblemDetails(error: HTTPError): ProblemDetails {
  const masked = error.unhandled;
  return {
    type: (!masked && error.type) || "about:blank",
    title: statusTitles[error.status] ?? error.statusText,
    status: error.status,
    detail: masked ? undefined : error.message,
    instance: masked ? undefined : error.instance,
  };
}

// Reason phrases from the IANA HTTP Status Code Registry (common codes)
const statusTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  // ...demais códigos comuns até 511
};
```

### `src/response.ts`

- `:173`: `val = errorResponse(error, config, errHeaders);`
- Após `jsonHeaders` (`:270-272`):

```ts
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

- `:358-380`: nova assinatura e corpo:

```ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const baseHeaders = config.problemDetails ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = config.problemDetails
    ? toProblemDetails(error)
    : {
        ...error.toJSON(),
        stack:
          config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      };
  return new FastResponse(JSON.stringify(body, undefined, config.debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

Import novo em `src/response.ts` (depois de `:4`): `import { toProblemDetails } from "./utils/internal/problem.ts";`

### Exports públicos

Nenhum. `src/index.ts:72` continua exportando `HTTPError` e os tipos já existentes. `test/unit/package.test.ts:5` continua válido sem alteração.

## Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: escrever os testes primeiro, confirmar que falham, depois implementar.

### Testes novos

1. **`test/problem-details.test.ts`** (novo, `describeMatrix`, cobre web e node):
   - RF-01: `app.config.problemDetails` vale `false` sem opção e `true` com `new H3({ problemDetails: true })`. Pode ser um teste unitário separado, fora do matrix.
   - RF-02: rota lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`. Esperado: status 404, `Content-Type: application/problem+json`, corpo com `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"`.
   - RF-04: `type` e `instance` definidos aparecem no corpo. Sem `type`, o corpo traz `type: "about:blank"`, e `instance` some do corpo quando não é definido.
   - RF-05: `throw new Error("falha interna do banco")` com `t.app` em `debug: true` (`test/_setup.ts:136`). Esperado: status 500, `application/problem+json`, e `await res.text()` não contém `"falha interna do banco"`. Cobrir também `throw "string"` (caminho de `toError`, `src/response.ts:73-83`).
   - RF-06: com a opção desligada e `HTTPError` com `type`/`instance`, o `Content-Type` é `application/json;charset=UTF-8` e o corpo não tem `type`/`instance`.
   - Cobrir com e sem `onError` (padrão de `test/errors.test.ts`, que roda `withOnError` em loop). Quando `onError` devolve `undefined`, o problem details deve sair mesmo assim.
   - Cobrir `HEAD` (sem corpo, `Content-Type` preservado) e `headers` do `HTTPError` (mesclado, com `content-type` de `error.headers` ainda podendo sobrescrever, D-06).
   - Alternar com `t.app.config.problemDetails = true` nos testes que precisam, como `test/errors.test.ts` faz com `t.app.config.onError`.

2. **`test/unit/error.test.ts`** (novo, unitário, sem matrix):
   - RF-03: `new HTTPError({ status: 403, type: "...", instance: "/pagamentos/42" })` expõe `error.type` e `error.instance`. Sem os campos, ambos valem `undefined`.
   - Regressão de D-01: `error.toJSON()` não ganha as chaves `type` e `instance`, mesmo quando definidas.
   - `new HTTPError(new Error(...))` tem `type`/`instance` `undefined` (D-01, sem herança do cause).

### Testes existentes

- `test/errors.test.ts` **não deve mudar**. Os testes existentes verificam `Content-Type`, corpo JSON e comportamento com `debug`, e todos continuam valendo com a opção desligada.
- `test/unit/package.test.ts` continua passando sem alteração (sem exports novos).

### Comandos de verificação

```bash
pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts
pnpm vitest run test/errors.test.ts test/unit/package.test.ts
pnpm lint          # oxlint + oxfmt --check
pnpm typecheck     # tsc --noEmit
pnpm test          # suíte completa com cobertura
```

## Riscos

- **R-01 — Vazamento de mensagem em erros 500.** Mitigado por D-05 (mascaramento de `detail`, `type`, `instance` e ausência de `stack`). Coberto por teste de RF-05 com `debug: true`.
- **R-02 — `type` vindo de erros que não são `HTTPError`.** `new HTTPError(val)` lê `type` de qualquer objeto de erro (`src/response.ts:148`, `src/utils/middleware.ts:48`). Erros que não são `HTTPError` são marcados como `unhandled` (`src/response.ts:149-151`), e o mascaramento de D-05 cobre esse caso. Resta um caso: `HTTPError`-shaped vindo de outros pacotes (srvx `BodyTooLargeError`), que não é `unhandled`. Se esses erros tiverem `type` próprio, ele aparece no corpo. Verificar antes de implementar; se houver, tratar com a mesma regra de D-05.
- **R-03 — Debug sem stack no corpo.** Com a opção ligada, quem depende do `stack` em modo `debug` vê só o log do `console.error` de erros não tratados. Documentar na JSDoc de `problemDetails`.
- **R-04 — Clientes que esperam o formato atual.** A mudança só afeta quem liga a opção. Documentar no README ou na JSDoc.
- **R-05 — `app.config` deixa de ser o mesmo objeto (D-02).** Verificado: nenhum teste depende da identidade. `freezeApp` (`src/_entries/_common.ts:5`) congela o novo objeto da mesma forma.
- **R-06 — Enfraquecimento de testes existentes.** Mitigado: nenhum teste existente é alterado. Novos testes cobrem os casos novos.
- **R-07 — Tabela de títulos desatualizada.** Tabela com códigos comuns. Códigos fora dela usam `statusText`, e a ausência de `title` é válida na RFC 9457.
- **R-08 — Caminhos sem `config`.** `handler.ts:122` e JSON-RPC ficam fora (D-07). Se o uso mostrar necessidade, é outra mudança, com decisão própria.
- **R-09 — Hooks de erro.** `onError` roda antes da renderização (`src/response.ts:159-166`). Hook que devolve `Response` substitui o problem details, o que é esperado. Cobrir no teste com `onError` do matrix (ver estratégia).
