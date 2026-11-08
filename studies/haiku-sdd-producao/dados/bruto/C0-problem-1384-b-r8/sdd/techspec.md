# Techspec — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-10). Citações `arquivo:linha` conferidas no código atual (commit `f91573f`).

## 1. Visão geral do fluxo atual

- Todo erro tratado converge em `errorResponse()` (`src/response.ts:358`), chamado por `prepareResponse()` em `src/response.ts:173`. Ali o corpo vem de `error.toJSON()` (`src/response.ts:368`) e o `content-type` de `jsonHeaders` (`src/response.ts:270-272`, usado em `src/response.ts:360-361`).
- `prepareResponse` normaliza as origens de erro antes de chegar lá: `kNotFound` vira `HTTPError` 404 (`src/response.ts:139-144`), qualquer `Error` não-HTTP vira `HTTPError` com `unhandled = true` (`src/response.ts:146-155`), `throw <número>` vira `HTTPError` via `toError` (`src/response.ts:77-79`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) monta hoje `status, statusText, unhandled, message, data` e espalha `body` por último (`src/error.ts:234`), ocultando `message`/`data`/`body` quando `unhandled`.
- Os 404 de `src/h3.ts:187` e `src/h3.ts:223`, os erros de utilitários (`src/utils/auth.ts`, `body.ts`, `cookie.ts`, `proxy.ts`, `query.ts`, `static.ts`, `validate.ts`, `rules/**`) e o `onError` (`src/utils/middleware.ts:37-63`) apenas lançam/relançam `HTTPError`; passam todos por `errorResponse`. **Logo, uma única mudança em `error.ts` + `errorResponse` cobre RF-08**, sem tocar nesses arquivos.
- JSON-RPC (`src/utils/json-rpc.ts:476-498`) lê só `status`/`message`/`data` do erro e não usa `toJSON`; fora de escopo e não afetado.

## 2. Decisões de arquitetura

### D-01 — Um único ponto de serialização, reutilizado por `toJSON` e por `errorResponse`

**Contexto.** `HTTPError.isError()` (`src/error.ts:129-133`) aceita qualquer `Error` com `name === "HTTPError"` e `status > 99`, e `prepareResponse` usa esse objeto como está (`src/response.ts:147-148`). Isso inclui o `BodyTooLargeError` do srvx (`node_modules/srvx/dist/body-limit.mjs:60-73`, coberto por `test/body-limit.test.ts:109-124`), cujo `toJSON()` próprio devolve só `status/statusText/message`. Se `errorResponse` continuasse chamando `error.toJSON()`, esse 413 sairia sem `type`/`title`/`detail`, violando RF-08.

**Alternativas.**
1. Manter `error.toJSON()` em `errorResponse`. Mais simples, mas deixa erros "HTTPError-shaped" de terceiros fora do formato.
2. `HTTPError.prototype.toJSON.call(error)`. Funciona por duck typing, mas é um truque frágil e obscuro.
3. Função interna `toProblemDetails(error)` em `src/error.ts`, **não exportada** de `src/index.ts`; `HTTPError.toJSON()` delega a ela e `errorResponse` a chama diretamente.

**Escolha: 3.** Respeita "nenhum outro nome público novo" (o export fica só em `src/error.ts`; `src/index.ts:72` não muda e o snapshot de `test/unit/package.test.ts` segue igual). Garante que erros de terceiros no formato HTTPError recebam o mesmo documento e que `JSON.stringify(error)` e a resposta sejam idênticos (RF-09). Regra do projeto "helpers internos ao final do arquivo" (AGENTS.md) é seguida.

### D-02 — `type` e `instance` só em `ErrorInput` e `HTTPError`, não em `ErrorBody`

`ErrorBody` (`src/error.ts:30-69`) é compartilhado e `ErrorInput` o estende via `Partial<ErrorBody>` (`src/error.ts:6`). Adicionar `type`/`instance` a `ErrorBody` os tornaria parte de todo uso do tipo e de `implements ErrorBody` (`src/error.ts:74`).

**Alternativas.** (a) campos em `ErrorBody` como opcionais; (b) campos em `ErrorInput` e propriedades `readonly` direto em `HTTPError`.

**Escolha: (b).** Atende RF-02 ("`ErrorInput`" e instância) sem ampliar `ErrorBody`, que o PRD manda proteger (seção 4, `isolatedDeclarations`/tipos). `HTTPError.status(...)` (`src/error.ts:144-150`) e o construtor com mensagem (`src/error.ts:160-162`) herdam o suporte por usarem `ErrorDetails`/`ErrorInput`, sem alteração de assinatura.

### D-03 — Sem herança de `type`/`instance` via `cause`; só valores `string`

O PRD pede herança "se couber sem complexidade". **Não cabe com segurança.** O construtor lê `details` diretamente (`src/error.ts:173-185`), e `prepareResponse` faz `new HTTPError(val)` com erros arbitrários (`src/response.ts:148`; também `src/utils/middleware.ts:48`). Bibliotecas comuns expõem `err.type` com outro significado (ex.: `"entity.too.large"` do body-parser), que viraria um `type` que não é URI.

**Alternativas.** (1) herdar de `details` e de `details.cause` como `status`; (2) ler somente `details.type`/`details.instance` do objeto de entrada; (3) não ler de `cause`, só de `details` diretamente, aceitando apenas `typeof === "string"`.

**Escolha: (3)**, somada à regra de D-04 (erros `unhandled` nunca expõem `type`/`instance` no corpo). Isso elimina a fonte de vazamento (`cause` arbitrário) e a leitura de `details` de `Error` estranho fica inofensiva, pois ele é sempre `unhandled`. Registrar no JSDoc que `type`/`instance` não são herdados de `cause`. Cumpre a premissa do PRD: valores vêm só do código da aplicação.

### D-04 — Regras do documento: precedência, omissões e `unhandled`

`toProblemDetails(error)` devolve (tipo explícito exigido por `isolatedDeclarations`):

```ts
{
  ...legacy,          // statusText, unhandled, message, data  (como hoje, src/error.ts:228-233)
  ...body,            // extension members; omitido se unhandled (como hoje, src/error.ts:234)
  type, title, status, detail, instance, // por último: RFC vence body (RF-07)
}
```

- `type`: `error.type ?? "about:blank"`; se `unhandled`, sempre `"about:blank"` (RF-03, e D-03).
- `title`: `error.statusText || phrase(status)`; `undefined` se não houver frase (RF-04).
- `status`: `error.status`.
- `detail`: `error.message`; `undefined` se `unhandled` (RF-05). `message` legado segue `"HTTPError"` quando `unhandled` (`src/error.ts:232`).
- `instance`: `error.instance`; `undefined` se `unhandled` (RF-06; reforça "nunca vem do cliente").
- As cinco chaves RFC são atribuídas **depois** do espalhamento de `body`. Atribuir `undefined` também sobrescreve o `body`, então `body: { title: "x" }` não vaza quando o status não tem frase. `JSON.stringify` descarta `undefined`, logo omitir = atribuir `undefined`.
- A ordem de `body` sobre as chaves legadas é mantida (hoje `body` pode sobrescrever `message`/`data`; não é alterado, "não quebrar o que existe").
- `stack` continua sendo acrescentado só em `errorResponse` (`src/response.ts:369`), fora de `toJSON`, igual ao PRD (RF-09, "exceto `stack`").

**Alternativa considerada:** remover os campos legados (substituição estrita). Rejeitada: contradiz "não quebrar o que já existe" (`sdd/pedido.md`) e RF-07; o risco de tensão do PRD (seção 4) já define a resolução aditiva.

### D-05 — Tabela de frases-padrão interna, sem dependência

**Alternativas.** (1) `STATUS_CODES` de `node:http`: quebra o requisito multi-runtime (Workers/browsers). (2) `Response.statusText` de uma resposta criada: vazio em runtimes web. (3) tabela literal pequena (`Record<number, string>`, ~60 entradas IANA 1xx–5xx) em novo `src/utils/internal/status-text.ts`, função `statusPhrase(status): string | undefined`.

**Escolha: (3).** Sem dependência nova, não exportada (pasta `internal/` não é entrada pública; AGENTS.md pede "internal helpers em `utils/internal/`"). Arquivo curto (<200 LoC). Frases no inglês canônico (404 → "Not Found", 500 → "Internal Server Error"); códigos fora da tabela devolvem `undefined` e o `title` é omitido, como no RF-04.

### D-06 — `content-type`: `application/problem+json;charset=UTF-8`

**Contexto.** O h3 emite hoje `application/json;charset=UTF-8` (`src/response.ts:271`); o PRD (RF-01) diz para manter `charset=utf-8` se já emitido.

**Alternativas.** (1) alterar `jsonHeaders`, o que mudaria também respostas de sucesso (`src/response.ts:311`, `:318`): errado. (2) novo `FrozenHeaders` `problemHeaders` ao lado de `jsonHeaders`. (3) definir o header dentro de `errorResponse` a cada chamada.

**Escolha: (2).** Mesmo padrão de `jsonHeaders` (instância congelada, sem custo de alocação por requisição), isolada do caminho de sucesso. `errorResponse` (`src/response.ts:359-361`) passa a partir de `problemHeaders`. Como `mergeHeaders` usa `set` (`src/response.ts:246-248`), um `content-type` em `error.headers` continua sobrescrevendo (RF-08); `errHeaders` já se comporta assim hoje (`src/response.ts:362-364`), sem mudança.

### D-07 — Fora do caminho de `errorResponse` nada é alterado

Não tocar em `onError` (`src/utils/middleware.ts`), `toError` (`src/response.ts:73-83`), `kNotFound` (`src/response.ts:139-144`), JSON-RPC, WebSocket, `h3/rules` e `HTTPResponse`. Um `Response` devolvido por `onError` com outro `content-type` continua intocado (RF-08 só obriga o formato quando há erro serializado pelo h3). O 404 de `kNotFound` já traz `message` "Cannot find any route matching ..." que vira `detail` (RF-08).

## 3. Arquivos a alterar

| Arquivo | Linhas atuais | Mudança |
| --- | --- | --- |
| `src/error.ts` | `:6-26` (`ErrorInput`) | adicionar `type?: string` e `instance?: string` com JSDoc |
| `src/error.ts` | `:74-119` (campos da classe) | adicionar `readonly type: string \| undefined` e `readonly instance: string \| undefined` |
| `src/error.ts` | `:199-209` (construtor) | atribuir `this.type`/`this.instance` de `details` só se `typeof === "string"` (D-03) |
| `src/error.ts` | `:226-236` (`toJSON`) | delegar a `toProblemDetails(this)`; novo tipo de retorno explícito |
| `src/error.ts` | fim do arquivo | `toProblemDetails()` interna (importa `statusPhrase`) |
| `src/utils/internal/status-text.ts` | novo | tabela e `statusPhrase()` |
| `src/response.ts` | `:270-272` | adicionar `problemHeaders` |
| `src/response.ts` | `:358-380` | usar `problemHeaders` e `toProblemDetails(error)` em vez de `error.toJSON()` (`:368`) |
| `src/index.ts` | `:72` | **sem mudança** (nenhum export novo) |
| `docs/1.guide/1.basics/6.error.md` | `:42`, `:60`, `:90` | atualizar exemplo de corpo, `content-type` e `type`/`instance` (a doc é a fonte do formato) |
| `test/errors.test.ts` | `:44`, `:140` | ajuste de `content-type` (ver seção 6) |
| `test/problem-details.test.ts` | novo | testes de RF-01 a RF-09 |

`src/error.ts` passa de ~237 para ~300 linhas; como `error.ts` já está acima do alvo de 200 LoC do AGENTS.md, a tabela fica em arquivo próprio (D-05) para não agravar.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  cause?: unknown;
  headers?: HeadersInit;
  /** RFC 9457 `type`: URI reference identifying the problem type. Defaults to "about:blank" in the body. */
  type?: string;
  /** RFC 9457 `instance`: URI reference identifying this occurrence. Omitted from the body when unset. */
  instance?: string;
  statusCode?: number;      // inalterado
  statusMessage?: string;   // inalterado
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): ProblemDetails;   // tipo local não exportado, ver abaixo
}

// src/error.ts (interno, não exportado de src/index.ts)
export function toProblemDetails(error: HTTPError): ProblemDetails;
```

`ProblemDetails` é declarado em `error.ts` como alias **não exportado pelo `index.ts`**:

```ts
type ProblemDetails = Omit<ErrorBody, "body"> & {
  type: string; title?: string; detail?: string; instance?: string;
} & ErrorBody["body"];
```

Com `isolatedDeclarations`, `toJSON()` precisa do tipo de retorno explícito; um tipo não exportado referenciado por método público é aceito pelo `tsc` desde que a declaração gerada o inclua. Se o `obuild`/`tsc` reclamar de `ProblemDetails` não exportado (TS4xxx), a alternativa é inline do tipo no retorno de `toJSON`, sem criar export público. Verificar com `pnpm typecheck` e `pnpm build`.

```ts
// src/utils/internal/status-text.ts
export function statusPhrase(status: number): string | undefined;

// src/response.ts (interno)
const problemHeaders: FrozenHeaders; // "content-type": "application/problem+json;charset=UTF-8"
```

Exemplos de corpo resultante (exemplo do RF-07):

```json
{
  "message": "Inválido",
  "data": { "campo": "nome" },
  "codigo": "E42",
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Inválido"
}
```

(`statusText` aparece só quando definido; a frase de 422 na tabela é a atual da IANA, "Unprocessable Content".)

Para erro `unhandled` (RF-05): `{ type: "about:blank", title: "Internal Server Error", status: 500, message: "HTTPError", unhandled: true }`, sem `detail`, `instance`, `data` nem `body`.

## 5. Estratégia de testes

Seguir AGENTS.md: `describeMatrix` (web + node), `ctx.app` novo por teste, `ctx.errors` auto-assertado (erros `unhandled` exigem `t.errors = []`, como em `test/errors.test.ts:116`).

**Novo arquivo `test/problem-details.test.ts`**, um grupo por requisito:
- RF-01: `new HTTPError({ status: 400 })` → `content-type` começa com `application/problem+json`; sucesso JSON continua `application/json;charset=UTF-8` (regressão do escopo de `jsonHeaders`).
- RF-02: `type`/`instance` lidos na instância; `undefined` sem informar; via `HTTPError.status(418, "x", { type })` e via `new HTTPError("msg", { type })`; **não** herdados de `cause` (D-03), inclusive com `cause` contendo `type: "entity.too.large"`.
- RF-03: `about:blank` por padrão e URI informado.
- RF-04: `title` por frase-padrão, por `statusText` custom, omitido para status sem frase (ex.: 599) e `body: { title }` não vaza nesse caso.
- RF-05: `detail` presente em erro tratado; ausente e sem o texto de `new Error("segredo interno")` em `unhandled` (500).
- RF-06: `instance` presente/ausente; `unhandled` com `instance` na entrada não o expõe.
- RF-07: exemplo completo do PRD; `body: { status: 200, title: "x", type: "y", detail: "z", instance: "w" }` não altera os cinco membros; `stack` em `config.debug`.
- RF-08: `kNotFound` (404 de rota inexistente com `detail` "Cannot find any route matching"), `throw 404` numérico, erro não-HTTP, erro lançado em middleware, erro de validação (`readValidatedBody`), `onError` retornando erro, HEAD sem corpo, `error.headers` com `content-type` próprio prevalecendo, `errHeaders` mesclados, e o `BodyTooLargeError` do srvx (`createBodyTooLargeError`, D-01) com os membros RFC.
- RF-09: `JSON.parse(JSON.stringify(error))` igual ao corpo da resposta (sem `stack`).
- Unitário (`test/unit/status-text.test.ts`, sem `describeMatrix`): `statusPhrase(404)`, `statusPhrase(418)`, `statusPhrase(599) === undefined`.

**Ajuste da suíte existente (RF-10).** A busca por asserções de `content-type` de erro e de corpo exato achou impacto apenas em dois pontos; o restante usa `toMatchObject` (aditivo, continua válido):
- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` → `toBe("application/problem+json;charset=UTF-8")`. Mesmo cenário (422 com `errHeaders`, GET e HEAD), mesma intenção (o tipo da resposta de erro).
- `test/errors.test.ts:140`: `toMatch("application/json")` → `toMatch("application/problem+json")`.
- `test/security.test.ts:556` e `test/router.test.ts:422` verificam respostas de **sucesso**; **não** mudam.
- `test/json-rpc*.test.ts` verificam o protocolo JSON-RPC; **não** mudam (D-07).
- Se a execução completa revelar outro teste dependente, aplicar a mesma regra (trocar só o que mudou, manter a asserção equivalente). Não foi possível executar a suíte nesta etapa (a tarefa não altera código).

**Validação final:** `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt `--check`), `pnpm typecheck`; opcionalmente `pnpm build` para checar as declarações `.d.mts` (D-04/contratos).

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **Tensão "substitui" × "não quebrar"** | Se a intenção for remover campos legados, o design aditivo está errado | Resolvido como aditivo (D-04, RF-07); confirmar com o autor do pedido antes de remover qualquer legado |
| **Quebra por natureza do `content-type`** | Clientes que comparam `application/json` exato falham; `res.json()` segue funcionando | Registrar como *breaking* no `CHANGELOG.md`/notas de release; testes ajustados (seção 5) |
| **Erros HTTPError-shaped de terceiros** (srvx) com `toJSON` próprio | Ficariam fora do formato | D-01: `errorResponse` não depende do `toJSON` do erro |
| **Vazamento via `type`/`instance`/`detail`** | Mensagem ou `type` de erro interno exposto | D-03/D-04: `unhandled` força `about:blank` e omite `detail`/`instance`; sem herança de `cause` |
| **Colisão de chaves `body`/`data`** | `body` sobrescrever membros RFC | D-04: membros RFC atribuídos por último, incluindo `undefined` |
| **`isolatedDeclarations` e tipo de retorno de `toJSON`** | Falha de typecheck/build ao referenciar tipo não exportado | Tipo explícito; fallback de inline (seção 4); validar com `typecheck` e `build` |
| **Tabela de frases desatualizada/divergente** | `title` diferente do esperado por clientes | Frases IANA canônicas, `statusText` do erro sempre prevalece; teste unitário |
| **Consumidores a jusante (ex.: Nitro) lendo `toJSON()`** | Dependem do formato antigo | Campos legados preservados; só há chaves novas |
| **Ordem de chaves no JSON** | Snapshots de terceiros que dependem da ordem | Sem garantia de ordem na RFC; manter legados antes e RFC depois (mais estável) |
| **HEAD e `content-length`** | Corpo de erro HEAD mal removido | Fluxo existente (`src/response.ts:234-240`) não muda; coberto por teste de HEAD em RF-08 |
| **Doc desatualizada** | `docs/1.guide/1.basics/6.error.md` descreve o formato antigo | Atualizar `:42`, `:60`, `:90` junto com a implementação |

## 7. Ordem de implementação sugerida

1. `status-text.ts` + teste unitário.
2. `error.ts` (campos, construtor, `toProblemDetails`, `toJSON`) → `pnpm typecheck`.
3. `response.ts` (`problemHeaders`, `errorResponse`).
4. Ajustar `test/errors.test.ts:44,140`; escrever `test/problem-details.test.ts`; seguir o fluxo do AGENTS.md (teste novo falhando antes da mudança, passando depois).
5. Docs e `CHANGELOG`; rodar `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
