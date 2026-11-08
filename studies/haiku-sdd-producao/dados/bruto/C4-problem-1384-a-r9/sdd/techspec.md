# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A, issue h3js/h3#1384) e `sdd/prd.md` (RF-01 a RF-07).

Status: rascunho. Nenhum arquivo do projeto foi alterado. As citações `arquivo:linha` foram conferidas lendo o código atual do clone (branch `master`, commit `44c48e1`).

---

## 1. Resumo

Com a opção `problemDetails: true` em `H3Config`, todo erro HTTP que passa pelo caminho de renderização de erros do h3 sai como `application/problem+json` (RFC 9457). Com a opção desligada (padrão), a resposta é byte a byte a de hoje.

A mudança fica em três pontos:

1. `HTTPError` aceita e expõe `type` e `instance` (somente leitura, lidos do objeto de entrada).
2. `prepareResponse`/`errorResponse` escolhem o corpo e o `Content-Type` conforme `config.problemDetails`. O `config` já chega nesse ponto.
3. Um módulo interno, não exportado, monta o objeto de problema e guarda a tabela de frases padrão de status.

Nenhum nome público novo além de `problemDetails`, `HTTPError.type` e `HTTPError.instance`.

---

## 2. Estado atual relevante

- `HTTPError` lê `data` e `body` apenas do objeto de entrada: `src/error.ts:208-209`. `headers` também vem de `cause` como fallback: `src/error.ts:202`. `type` e `instance` seguem o padrão de `data`/`body` (somente do input), não o de `headers`.
- `HTTPError.toJSON()` produz o corpo legado e omite `message`/`data`/`body` quando `unhandled`: `src/error.ts:226-236`. Ele não é alterado.
- O único ponto que renderiza erro é `errorResponse`, chamado em `src/response.ts:173`. O `Content-Type` fixo é `jsonHeaders` (`src/response.ts:270-272`); o corpo é `JSON.stringify({ ...error.toJSON(), stack })` (`src/response.ts:366-373`).
- O 404 de rota não encontrada vira um `HTTPError` em `src/response.ts:139-144` e passa pelo mesmo caminho. O 404 de `HEAD` também.
- `prepareResponse` já recebe `config: H3Config` (`src/response.ts:129-134`). `errorResponse` recebe hoje só `config.debug` (`src/response.ts:173`).
- `H3Core.~request` chama `toResponse(handlerRes, event, this.config)` (`src/h3.ts:99`). Por isso `app.config` alcança `prepareResponse` sem nenhum canal novo. Mutar `app.config.x` depois da criação também funciona, porque é o mesmo objeto (`src/h3.ts:55`). Os testes existentes já fazem isso (`test/errors.test.ts:14`).
- `toResponse(val, event, config = {})` aceita o config como parâmetro (`src/response.ts:13-16`). Fora de uma instância `H3`, `config` vale `{}` e a opção fica desligada. Isso responde ao risco "caminhos sem app" do PRD (ver D-01).
- `H3Config` está em `src/types/h3.ts:28-53`. `debug` e `silent` são documentados em `src/types/h3.ts:29-37`. `H3CoreConfig` é derivado dele (`src/types/h3.ts:55`).
- `ErrorInput` (entrada do construtor) está em `src/error.ts:6-26`. `ErrorBody` está em `src/error.ts:30-69`. `ErrorDetails` está em `src/error.ts:28`.
- Não existe tabela de frases de status em `src/`. `srvx` também não exporta uma (verificado em `node_modules/srvx/dist`). Ver D-04.
- `sanitizeStatusCode` e `sanitizeStatusMessage` estão em `src/utils/sanitize.ts:10` e `:17`. `statusText` do erro já passa por eles (`src/error.ts:180-185`).
- `onError` roda antes da renderização e recebe o erro já wrapeado: `src/response.ts:159-166`. Quando `onError` devolve um valor, esse valor passa de novo por `prepareResponse` com `nested = true` (`src/response.ts:165`).
- O `kEventRes` é limpo antes de `errorResponse` (`src/response.ts:172`) para evitar duplicação de `set-cookie` (comentário em `src/response.ts:167-171`). A mudança não mexe nisso.
- `ErrorInput`, `ErrorBody` e `HTTPError` são exportados em `src/index.ts:72`. `toResponse` e `HTTPResponse` em `src/index.ts:68`.
- `test/unit/package.test.ts` mantém a lista de nomes exportados (ex.: `"onError"` na linha 101). Nenhum export novo deve aparecer ali.
- Não há `test/unit/error.test.ts` hoje (`ls test/unit`).

---

## 3. Decisões de arquitetura

### D-01 — Fonte da opção: `config` que já chega a `prepareResponse`

**Escolha.** `errorResponse` recebe o `config` inteiro (em vez de `config.debug`) e lê `config.problemDetails`. Assim a opção segue o mesmo canal de `debug`, `onError` e `silent`.

**Alternativas.**
- (a) Ler `this.config.problemDetails` em `H3Core["~request"]` e guardar no `H3Event` (novo campo de estado no evento). Descartada: cria estado novo por requisição e uma superfície nova no `H3Event`, sem ganho.
- (b) Um parâmetro novo em `toResponse`. Descartada: muda uma assinatura pública sem necessidade, já que `config` já está lá.
- (c) Decidir pelo header `Accept`. Descartada: fora de escopo (PRD, "Fora de escopo").

**Consequências.** Fora de `H3` (`toResponse(val, event)` sem config), a opção fica desligada, como `debug`. Sub-apps montados com `mount()` copiam as rotas para o app pai (`src/h3.ts:213-218`), então o erro é renderizado com o config do app pai. Isso é consistente com a nota em `src/types/h3.ts:211` ("Sub-app options and global hooks are not inherited").

### D-02 — Módulo interno para o objeto de problema

**Escolha.** Um arquivo novo `src/utils/internal/problem.ts`, com a função `toProblemDetails(error, debug)` e a tabela de frases. Nada disso é exportado por `src/index.ts`.

**Alternativas.**
- (a) Método `HTTPError.prototype.toProblemDetails()`. Descartada: é um nome público novo, proibido pelo PRD ("Novos nomes públicos além de `problemDetails`, `HTTPError.type` e `HTTPError.instance`" está fora de escopo).
- (b) Inline em `src/response.ts`. Descartada: `src/response.ts` já tem 380 linhas e a regra do projeto é arquivos curtos (AGENTS.md, "Short files"). Helpers internos vão em `utils/internal/` (AGENTS.md, "Internal helpers").
- (c) Mudar `HTTPError.toJSON()` para aceitar um modo. Descartada: `toJSON` é público e também é usado por `json-rpc` (`src/utils/json-rpc.ts:483`). Mexer nele arrisca o RF-03.

### D-03 — Precedência entre membros da RFC e extensões

**Escolha.** Os membros de extensão (`data`, depois os campos de `body`) entram primeiro; os membros da RFC (`type`, `title`, `status`, `detail`, `instance`) vêm por último e vencem em caso de colisão.

**Alternativas.**
- (a) Copiar a ordem de `toJSON` (`body` por último, como em `src/error.ts:234`). Descartada: um `body: { status: 200 }` faria o corpo de erro dizer 200. Isso quebra a RFC e fica feio de depurar.
- (b) Proibir `body` no modo problem. Descartada: o PRD quer `data` e `body` como extensões (RF-02).

**Consequência.** Para `body` com chave igual a um membro da RFC, o membro da RFC é o que aparece. Isso é um comportamento novo e deve ter teste (ver seção 6).

### D-04 — Frase padrão de status para `title`

**Escolha.** Tabela interna com as frases registradas no IANA para os códigos de status (`400`, `404`, `422`, `500` e os demais), em `src/utils/internal/problem.ts`. Usada só quando `statusText` está ausente. RFC 9457 §4.2 recomenda que `title` seja a frase padrão quando `type` é `about:blank`, então a tabela é o que a RFC pede.

**Alternativas.**
- (a) Omitir `title` quando `statusText` está ausente. A RFC permite (o membro é opcional). Descartada: contradiz RF-02, que pede a frase padrão.
- (b) `STATUS_CODES` de `node:http`. Descartada: é específico de Node e quebra o princípio "web standards first" (AGENTS.md, "Core Design").
- (c) Usar `new Response(null, { status }).statusText`. Descartada: a especificação do Fetch deixa `statusText` vazio nesse caso, então não há frase.

**Custo.** Uns 60 pares `código: frase`, cerca de 1,5 KB no bundle. Se o time achar caro, a alternativa (a) é a saída, e vale confirmar antes de implementar (seção 8).

### D-05 — `Content-Type` e cabeçalhos do erro

**Escolha.** Com a opção ligada, a base dos cabeçalhos é um `FrozenHeaders` novo, `problemHeaders`, com `content-type: application/problem+json` (sem `charset`, porque JSON é UTF-8 por definição). `error.headers` continua sendo mesclado por cima, como hoje (`src/response.ts:359-361`), e `errHeaders` (`src/response.ts:362-364`) também.

**Alternativas.**
- (a) Acrescentar `;charset=UTF-8` como em `jsonHeaders`. Descartada: o PRD pede o valor exato e a RFC não exige o parâmetro.
- (b) Impedir `error.headers` de sobrescrever `content-type`. Descartada: muda o comportamento legado sem necessidade. Ver risco R-04.

### D-06 — `stack` no modo problem

**Escolha.** O membro `stack` (como extensão) só aparece com `debug: true` e `error.stack` presente, exatamente a regra de hoje (`src/response.ts:369`).

**Alternativa.** Remover `stack` no modo problem. Descartada: é uma diferença de comportamento sem motivo, e não amplia exposição (o controle continua sendo `debug`).

### D-07 — `type` e `instance` só no objeto de entrada

**Escolha.** Os campos `type?: string` e `instance?: string` entram em `ErrorInput` (`src/error.ts:6-26`), não em `ErrorBody`. A classe ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos a partir de `details` (não de `details.cause`).

**Por que `ErrorInput` e não `ErrorBody`.** `ErrorBody` é usado no cast de `cause` (`src/error.ts:173-184`, `:202-206`). Pôr `type` ali faria parecer que `cause.type` é herdado, que é o comportamento que o RF-04 proíbe. `ErrorInput` é só o formato de entrada.

**Por que não entram em `toJSON()`.** RF-03 exige o corpo legado idêntico. `toJSON` continua como está.

### D-08 — `onError` não muda de fluxo

**Escolha.** Nenhuma mudança em `prepareResponse` na parte de `onError` (`src/response.ts:159-166`). O erro devolvido por `onError` passa por `errorResponse(error, config, ...)` e sai em problem+json.

**Precisão ao PRD (RF-06).** O RF-06 diz que "o valor que ele devolver passa pelo mesmo caminho de renderização". Isso só vale quando o valor é um erro (`HTTPError` ou `Error`), porque é isso que cai em `errorResponse`. Se `onError` devolve um objeto comum, ele é renderizado como corpo de sucesso (`prepareResponseBody`, `src/response.ts:188-206`) e não vira problem+json, como já acontece hoje. Recomendo deixar isso explícito no PRD e cobrir os dois casos em teste (seção 6).

---

## 4. Arquivos a alterar

| Arquivo | Mudança | Referência no código atual |
|---|---|---|
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` em `H3Config`, com JSDoc e `@default false`. | `src/types/h3.ts:28-53` (bloco de `debug`/`silent` em `:29-37`) |
| `src/error.ts` | Adicionar `type?`/`instance?` em `ErrorInput`; campos `readonly type`/`readonly instance` na classe; atribuição no construtor. | `src/error.ts:6-26`, `:82-119`, `:199-209` |
| `src/utils/internal/problem.ts` | **Novo.** `ProblemDetails`, `toProblemDetails()`, tabela `STATUS_PHRASES`. | — |
| `src/response.ts` | `errorResponse` recebe `config`; ramo para `problemHeaders` e para o corpo de problema; `problemHeaders` ao lado de `jsonHeaders`; chamada em `:173` passa `config`. | `src/response.ts:129`, `:173`, `:270-272`, `:358-380` |
| `test/unit/error.test.ts` | **Novo.** Testes de `type`/`instance` (RF-04). | — |
| `test/problem-details.test.ts` | **Novo.** Testes de matriz `web`/`node` (RF-01 a RF-07, D-03, D-06, D-08). | padrão de `test/errors.test.ts:6-22` |
| `test/unit/types.test-d.ts` | Tipos: `problemDetails` aceito em `H3Config`; `HTTPError.type`/`instance` tipados como `string \| undefined`. | arquivo existente |
| `docs/1.guide/900.api/1.h3.md` | Uma linha para `problemDetails` na lista de opções (ao lado de `debug` em `:111`). Opcional, conforme o PRD ("documentação mínima"). | `docs/1.guide/900.api/1.h3.md:111` |

Não alterar: `src/index.ts` (nenhum export novo, D-02), `src/_deprecated.ts` (PRD), `HTTPError.toJSON` (D-02), `test/unit/package.test.ts` (sem export novo).

---

## 5. Contratos e assinaturas

### 5.1 `src/types/h3.ts`

```ts
export interface H3Config {
  /** ...debug... */
  debug?: boolean;
  /** ...silent... */
  silent?: boolean;

  /**
   * When enabled, HTTP errors are rendered as `application/problem+json` (RFC 9457 Problem Details)
   * instead of the default JSON body.
   * @default false
   */
  problemDetails?: boolean;

  // ...demais campos inalterados
}
```

`H3CoreConfig = Omit<H3Config, "plugins">` (`src/types/h3.ts:55`) herda o campo sem mudança.

### 5.2 `src/error.ts`

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  cause?: unknown;
  headers?: HeadersInit;

  /** RFC 9457 `type`: URI reference that identifies the problem type. Used when `problemDetails` is enabled. */
  type?: string;

  /** RFC 9457 `instance`: URI reference for this occurrence of the problem. */
  instance?: string;

  /** @deprecated use `status` */
  statusCode?: number;
  /** @deprecated use `statusText` */
  statusMessage?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes...

  /** RFC 9457 `type` from the constructor input (not from `cause`). */
  readonly type: string | undefined;

  /** RFC 9457 `instance` from the constructor input (not from `cause`). */
  readonly instance: string | undefined;

  constructor(/* assinaturas inalteradas */);
  // Dentro do construtor, após `this.body = ...`:
  //   this.type = (details as ErrorInput)?.type;
  //   this.instance = (details as ErrorInput)?.instance;
}
```

Notas de tipo:
- `ErrorDetails` (`src/error.ts:28`) continua sendo uma união. `HTTPError` como entrada passa a copiar `type`/`instance` do erro original. Isso é desejado.
- `isolatedDeclarations` exige tipo explícito nos campos de classe, por isso `string | undefined` e não inferido.

### 5.3 `src/utils/internal/problem.ts` (novo, não exportado)

```ts
import type { HTTPError } from "../../error.ts";

/** Objeto de problema da RFC 9457, com membros de extensão. */
export interface ProblemDetails {
  type: string;
  title: string | undefined;
  status: number;
  detail?: string;
  instance?: string;
  stack?: string[];
  [member: string]: unknown;
}

/**
 * Monta o corpo `application/problem+json` a partir de um `HTTPError`.
 *
 * - `data` e os campos de `body` viram extensões (`body` vence `data`, como em `toJSON`).
 * - `type`, `title`, `status`, `detail` e `instance` vêm por último e vencem (D-03).
 * - Erro `unhandled`: sem `detail`, sem `data`, sem `body` (RF-05).
 */
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails;

/** Frase padrão de status (IANA). Usada quando `statusText` está ausente (D-04). */
const STATUS_PHRASES: Readonly<Record<number, string>>;
```

Forma esperada da implementação (para a revisão, não é código final):

```ts
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : { data: error.data, ...error.body }),
    type: error.type ?? "about:blank",
    title: error.statusText ?? STATUS_PHRASES[error.status],
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance: error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

### 5.4 `src/response.ts`

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

// prepareResponse, no ramo de erro (src/response.ts:172-173):
(event as any)[kEventRes] = undefined;
val = errorResponse(error, config, errHeaders);

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const problem = config.problemDetails;
  const baseHeaders = problem ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = problem
    ? toProblemDetails(error, config.debug)
    : { ...error.toJSON(), stack: config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined };
  return new FastResponse(JSON.stringify(body, undefined, config.debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

A forma exata do ramo legado fica para a implementação; o requisito é que, com `problem` falso, o corpo e os cabeçalhos sejam idênticos aos de hoje (RF-03).

---

## 6. Estratégia de testes

Seguir o fluxo de bug/feature do AGENTS.md: escrever os testes, confirmar que os de comportamento novo **falham** antes da mudança, implementar, confirmar que **passam**. Os testes de guarda (RF-03) devem **passar** antes e depois.

### 6.1 Unitários — `test/unit/error.test.ts` (novo)

- `type` e `instance` lidos do input (RF-04, primeiro exemplo).
- Ausentes: ambos `undefined` (RF-04, segundo exemplo).
- `cause: { type: "x" }` não preenche `type` (RF-04, terceiro exemplo).
- `new HTTPError({ status: 409, type, instance })` preserva os valores.
- `toJSON()` não contém `type` nem `instance` (guarda de RF-03).

### 6.2 Matriz — `test/problem-details.test.ts` (novo)

Usar `describeMatrix` (cobre `web` e `node`). Ligar a opção com `t.app.config.problemDetails = true` (mesmo padrão de `test/errors.test.ts:14`). Para o caso não tratado, seguir `test/errors.test.ts:107-122`: após a asserção, `t.errors = []`.

| # | Cenário | Asserções | Ref. |
|---|---|---|---|
| T1 | Opção ausente; `HTTPError({ status: 422, data, body })` | `content-type` é o JSON atual; corpo sem `type`/`instance` | RF-01, RF-03 |
| T2 | `problemDetails: true`; `HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })` | status 404; `content-type` exato `application/problem+json`; corpo com `status`, `title`, `detail`, `type: "about:blank"` | RF-02 |
| T3 | Mesmo app; `type` e `instance` informados | corpo com `type` e `instance` | RF-02 |
| T4 | `HTTPError({ status: 409 })` sem `statusText` | `title: "Conflict"` | RF-02, D-04 |
| T5 | `throw new Error("senha do banco: 123")` | status 500; `content-type` problem; corpo sem `detail`/`data`; texto `"senha do banco"` ausente | RF-05 |
| T6 | `onError` configurado; `HTTPError({ headers: { "x-erro": "1" } })` | `onError` chamado 1 vez; `x-erro: 1`; problem | RF-06 |
| T7 | `GET /nada` sem rota | 404; problem; `status: 404` | RF-07 |
| T8 | `HEAD /nada` sem rota | 404; corpo vazio; sem `content-length` | guarda de `errors.test.ts:13-22` |
| T9 | `onError` devolve `new HTTPError(...)` | resposta sai em problem | D-08 |
| T10 | `onError` devolve `{ message: "x" }` | resposta de sucesso como hoje (documenta D-08) | D-08, precisão RF-06 |
| T11 | `body: { status: 200, title: "x" }` em `HTTPError({ status: 404 })` | `status` 404 e `title` da frase padrão vencem | D-03 |
| T12 | `debug: true` (padrão de `test/_setup.ts:135-141`) e `debug` desligado | `stack` presente só com debug | D-06 |
| T13 | `set-cookie` com `onError` e opção ligada | `getSetCookie()` tem uma única entrada (regressão de `src/response.ts:167-171`) | risco R-03 |
| T14 | `HTTPError` com `data` e `body` de extensão, opção ligada | `data` e campos de `body` aparecem como extensões | RF-02 |

### 6.3 Tipos — `test/unit/types.test-d.ts`

- `new H3({ problemDetails: true })` compila; `problemDetails: "sim"` falha.
- `HTTPError.type` tem tipo `string | undefined`.

### 6.4 Regressão

- `pnpm vitest run test/errors.test.ts test/hooks.test.ts test/body-limit.test.ts test/mount.test.ts test/json-rpc.test.ts test/unit/package.test.ts`.
- `pnpm vitest run` completo.
- `pnpm lint` (inclui `oxfmt --check`) e `pnpm typecheck` (`package.json:46` e `:54`).

---

## 7. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-01 | Regressão silenciosa no corpo ou `Content-Type` com a opção desligada (PRD, "Regressão silenciosa"). | T1 e a suíte existente; `errorResponse` deve manter exatamente o ramo legado com `problem` falso. |
| R-02 | Duplicação de `set-cookie` ao passar pelo `onError`. | Nenhuma mudança em `kEventRes` (`src/response.ts:172`); T13. |
| R-03 | Mesmo risco, pelo novo ramo. | T13 cobre o caminho com `onError`. |
| R-04 | `error.headers` com `content-type` sobrescreve `application/problem+json`. | Mantido por D-05 (igual ao legado). Documentar. Se o time não quiser, bloquear só `content-type` no ramo problem. |
| R-05 | Colisão entre `body` e membros da RFC. | D-03 e T11. |
| R-06 | Vazamento de detalhes. `detail` com `message` de erros tratados fica público; `stack` aparece com `debug`. | RF-05 para não tratados (T5); para tratados, a responsabilidade é de quem lança (PRD). `debug` continua sendo o controle. |
| R-07 | Tipos: incluir `type`/`instance` em `ErrorInput` altera o tipo de entrada. | D-07 (só em `ErrorInput`); `pnpm typecheck`; testes de tipo (6.3). |
| R-08 | Tamanho do bundle pela tabela de frases (D-04). | Aceito; alternativa (a) de D-04 se o custo não couber. |
| R-09 | `src/error.ts` já tem 237 linhas, acima da meta de 200 do AGENTS.md. | Não piora com esta mudança (só ~6 linhas). Dividir não faz parte do escopo. |
| R-10 | Sub-apps montados com `mount()` seguem a opção do app pai (D-01). | Documentar na nota de `mount` (`src/types/h3.ts:211`) se o time quiser; não é bloqueante. |
| R-11 | Reuso de `prepareResponse` fora de `H3` (`toResponse` sem config). | Fica desligado, como `debug`. Confirmado por leitura de `src/response.ts:13-16`. |

---

## 8. Pontos a confirmar antes da implementação

1. **D-04**: a tabela de frases (cerca de 1,5 KB) é aceitável, ou `title` deve ser omitido quando `statusText` está ausente (contra RF-02)?
2. **RF-06 no PRD**: confirmar que o texto deve dizer "quando `onError` devolve um erro" (D-08), e não "um valor".
3. **D-05 / R-04**: `error.headers` pode sobrescrever `content-type` no modo problem?
4. **Documentação**: incluir a linha em `docs/1.guide/900.api/1.h3.md` nesta entrega ou depois?

---

## 9. Ordem de implementação

1. `src/types/h3.ts` (`problemDetails`) e `src/error.ts` (`type`/`instance`), com `test/unit/error.test.ts` e `test/unit/types.test-d.ts`. Testes de comportamento novo falham antes.
2. `src/utils/internal/problem.ts` (`toProblemDetails`, `STATUS_PHRASES`).
3. `src/response.ts`: `problemHeaders`, `errorResponse(error, config, errHeaders)` e a chamada em `:173`.
4. `test/problem-details.test.ts` (T1 a T14). T1 e T8 passam antes e depois; os demais passam só depois.
5. Opcional: linha em `docs/1.guide/900.api/1.h3.md`.
6. `pnpm vitest run` completo, `pnpm lint`, `pnpm typecheck`.
