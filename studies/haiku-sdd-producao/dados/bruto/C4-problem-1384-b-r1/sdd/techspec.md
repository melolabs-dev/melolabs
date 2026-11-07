# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-09).
Esta spec não altera código do projeto. Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `598cf8f`).

## Resumo

- Toda resposta de erro passa a ser um documento `application/problem+json` com `type`, `title`, `status`, `detail`, `instance`, mais os membros de extensão `data` e as chaves de `body`.
- A montagem do corpo fica concentrada em `HTTPError.toJSON()`. `errorResponse()` só troca o `Content-Type`, mantém os headers do erro e o `stack` de debug.
- `HTTPError` ganha `type` e `instance` (entrada e propriedade readonly). Nenhum export novo em `src/index.ts`.
- Um novo módulo interno com a tabela de frases de status (`src/utils/internal/status-text.ts`) fornece o `title` quando o erro não tem `statusText`.

## Estado atual (verificado)

- `HTTPError.toJSON()` monta `{ status, statusText, unhandled, message, data, ...body }` e, para erros não tratados, troca `message` por `"HTTPError"` e omite `data`/`body` — `src/error.ts:226-236`.
- O `Content-Type` de erro vem de `jsonHeaders` (`application/json;charset=UTF-8`) — `src/response.ts:270-272`, usado em `src/response.ts:360-361`.
- `errorResponse()` serializa `error.toJSON()` mais `stack` quando `debug` — `src/response.ts:358-380`, com o corpo em `src/response.ts:366-373`.
- O caminho de erro de `prepareResponse` chama `errorResponse` em `src/response.ts:173`; erros não-`HTTPError` viram `unhandled` em `src/response.ts:146-155`.
- `toError()` converte qualquer valor não-`Error` em `HTTPError` 500 `unhandled` com `cause` preservado — `src/response.ts:73-83`. Os caminhos de `onError` (`src/utils/middleware.ts:37-63`) usam a mesma marcação.
- `HTTPError` aceita `statusText` e `message` com fallback para `cause` (herança) — `src/error.ts:180-193`. Já herda `headers` e `unhandled` de `cause` em `src/error.ts:202-206`.
- `ErrorInput` e `ErrorBody` estão em `src/error.ts:6-69`; `message` documentado como chave do corpo em `src/error.ts:46-50`.
- `src/index.ts:72` exporta `ErrorDetails`, `ErrorBody`, `ErrorInput`, `HTTPError`.
- Já existe uma tabela de frases em `src/utils/response.ts:347` (`STATUS_TEXT`), limitada a 204 e redirects, e documentada como intencionalmente restrita.
- `createValidationError` monta `statusText: "Validation failed"` e `message` — `src/utils/internal/validate.ts:217-231` (`VALIDATION_FAILED` em `:19`). Ambos viram `title`/`detail` sem alteração no módulo.
- `json-rpc` tem mascaramento próprio (`src/utils/json-rpc.ts:479-488`) e não depende de `toJSON()`. Fica fora do escopo.
- Não há outro consumidor de `toJSON()` em `src/` (busca feita: só `src/error.ts`, `src/response.ts` e um comentário em `src/utils/json-rpc.ts:483`).
- `test/_setup.ts:129-136` roda os testes com `debug: true` por padrão, então `stack` aparece nas respostas de teste.

## Decisões de arquitetura

### D-01 — Formato de problem details sempre ativo, sem opção

**Decisão:** o corpo de erro passa a ser problem details em todas as respostas de erro. Não há flag, nem negociação por `Accept`, nem opção no `H3Config`.

**Alternativas consideradas:**
- Opção `errorFormat: "problem" | "legacy"` em `H3Config`: mantém compatibilidade, mas adiciona nome público e contradiz o pedido ("sem configuração", "nenhum outro nome público novo").
- Negociação por `Accept: application/problem+json`: fora de escopo (PRD, "Fora de escopo").

**Justificativa:** segue o contrato #1384-B literalmente. A quebra de clientes que leem `message`/`statusText` é aceita pelo pedido e entra em risco (ver Riscos).

### D-02 — `HTTPError.toJSON()` passa a devolver o corpo problem details

**Decisão:** `toJSON()` em `src/error.ts:226` retorna o corpo RFC 9457 (ver contrato abaixo). `errorResponse()` continua chamando `error.toJSON()` e só acrescenta `stack` em debug.

**Alternativas consideradas:**
- Criar uma função interna `toProblemDetails(error)` em `src/utils/internal/` e deixar `toJSON()` com o formato antigo: preserva `JSON.stringify(err)` como estava, mas deixa duas fontes de verdade para o mesmo formato e `toJSON()` mentiria sobre o que a resposta envia.
- Montar o corpo dentro de `errorResponse()`: tira a lógica de `HTTPError`, que é quem conhece `unhandled`, `data` e `body`.

**Justificativa:** uma única fonte de verdade. O custo é que `JSON.stringify(httpError)` passa a produzir o novo formato; isso é listado em Riscos.

### D-03 — `Content-Type: application/problem+json`, sem `charset`

**Decisão:** novo `FrozenHeaders` `problemHeaders` em `src/response.ts`, próximo de `jsonHeaders` (`src/response.ts:270-272`), com `content-type: application/problem+json`. `errorResponse()` passa a usar `problemHeaders` no lugar de `jsonHeaders` (`src/response.ts:360-361`). `jsonHeaders` continua sendo usado no sucesso.

**Alternativas consideradas:**
- `application/problem+json;charset=UTF-8`, mantendo o padrão antigo: a RFC 9457 não define parâmetro `charset`, e JSON é UTF-8 por definição (RFC 8259).

**Justificativa:** segue a RFC; o teste do PRD (RF-01) usa `startsWith`, então aceita os dois, mas o sem-`charset` é o correto.

### D-04 — `title`: `statusText` ou frase padrão; erro não tratado usa só a frase padrão

**Decisão:** novo módulo `src/utils/internal/status-text.ts` com a tabela de frases RFC 9110 e a função `reasonPhrase(status: number): string | undefined`. Em `toJSON()`:
- erro tratado: `title = this.statusText || reasonPhrase(this.status)`;
- erro `unhandled`: `title = reasonPhrase(this.status)`, ignorando `statusText`.

**Alternativas consideradas:**
- Reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`: rejeitado. Essa tabela é restrita de propósito (o comentário diz que outros status "não recebem frase"), e ampliá-la mudaria `noContent`/`redirect`, que usam `STATUS_TEXT[status]` em `src/utils/response.ts:44` e `:79`.
- Usar `statusText` sempre, mesmo para `unhandled`: `statusText` pode vir de `cause` herdado (`src/error.ts:180-185`) e carregar texto interno. Para não tratados, a frase padrão é mais segura e bate com o exemplo do PRD (RF-04: `"Internal Server Error"`).
- Omitir `title` quando não há frase: aceito só para códigos sem frase (ver abaixo).

**Justificativa:** `statusText` continua tendo prioridade quando o autor informa, o que preserva o valor que os testes atuais já verificam (ex.: `"Unprocessable"`).

Frases: usar os nomes RFC 9110 (ex.: 422 = `"Unprocessable Content"`, como em `src/utils/query.ts:77`; 413 = `"Content Too Large"`). Códigos fora da tabela (ex.: 499) não recebem `title` quando não há `statusText`. Isso viola uma leitura literal de RF-01 e precisa de confirmação (ver Pendências).

### D-05 — `detail` vem de `message` e some em erro não tratado

**Decisão:** `detail = unhandled ? undefined : this.message`. Como o construtor já garante `message` não vazio (`src/error.ts:187-193`), todo erro tratado tem `detail`. Isso é um desvio leve de RF-01 ("quando houver"): não há caso em que `message` esteja ausente para erro tratado.

**Alternativas consideradas:**
- Omitir `detail` quando `message` for igual ao texto gerado por padrão (`"HTTPError 404"`): mais detalhe, mas lógica frágil sem ganho real.

### D-06 — `type` e `instance`: entrada em `ErrorInput`, herança de `cause`, default só no corpo

**Decisão:**
- `ErrorInput` (`src/error.ts:6-26`) ganha `type?: string` e `instance?: string`, com comentário de uma linha cada. `ErrorBody` não muda.
- `HTTPError` ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, lidos no construtor de `details` ou de `details.cause`, no mesmo padrão de `headers` (`src/error.ts:202-203`).
- No corpo: `type: this.type ?? "about:blank"`; `instance` só aparece quando definido (JSON omite `undefined`).

**Alternativas consideradas:**
- `type` default `"about:blank"` na propriedade: esconde se o autor informou algo. Rejeitado: o padrão da RFC é semântica do corpo, não do objeto.
- Adicionar `type`/`instance` em `ErrorBody`: `ErrorBody` descreve os campos de entrada documentados; `ErrorInput` já estende `Partial<ErrorBody>` e é o lugar do construtor. Adicionar só em `ErrorInput` mantém a mudança de API mínima.

### D-07 — Membro `unhandled` sai do corpo

**Decisão:** `unhandled` deixa de aparecer no corpo. A propriedade `HTTPError.unhandled` (`src/error.ts:119`) continua existindo; só o JSON muda.

**Alternativas consideradas:**
- Manter `unhandled: true` como extensão: preserva um campo que clientes podem usar, mas não está na lista de membros do PRD (RF-01) e é um sinal interno do framework. Fica como alternativa se o autor preferir compatibilidade.

**Impacto:** testes que checam `unhandled` no corpo mudam (ver Estratégia de testes).

### D-08 — Membros RFC têm precedência sobre `body`

**Decisão:** `toJSON()` coloca `...body` primeiro e os membros RFC depois, para que `body` não consiga sobrescrever `type`, `title`, `status`, `detail` ou `instance`. `data` também vem depois, como hoje (`src/error.ts:233`).

**Alternativas consideradas:**
- Manter `body` por último (como hoje, `src/error.ts:234`): hoje `body` pode sobrescrever `status` no corpo. Com o formato novo, isso faria um corpo de erro declarar outro `status`, o que é um problema de consistência. Mudança de comportamento só para quem usa essa chave de propósito.

### D-09 — Extensões preservadas: `data`, `body` e `stack` em debug

**Decisão:** `data` como chave `data`; chaves de `body` no nível superior (RF-05); `stack` continua acrescentado em `errorResponse()` (`src/response.ts:369`) somente com `debug`.

### D-10 — Nenhum export novo; módulo interno e tipo não exportado

**Decisão:** `src/index.ts` não muda. `src/utils/internal/status-text.ts` é interno. O tipo do retorno de `toJSON()` é uma `interface ProblemDetails` local em `src/error.ts`, sem `export`.

**Verificação:** `test/unit/package.test.ts:4` faz snapshot das exports e continua igual. `isolatedDeclarations` (AGENTS.md, TypeScript) exige tipo explícito no método público; uma interface local é aceita na emissão de `.d.ts`. Confirmar com `pnpm typecheck` (ver Estratégia).

### D-11 — Não mudar `validate.ts`, `h3.ts`, `json-rpc.ts`

**Decisão:** `createValidationError` (`src/utils/internal/validate.ts:217-231`), o `400` de corpo malformado (`src/h3.ts:83`), o `404` de rota (`src/response.ts:139-143`) e o mascaramento do JSON-RPC (`src/utils/json-rpc.ts:479-488`) continuam como estão. Eles produzem `statusText`/`message`, que o novo `toJSON()` traduz para `title`/`detail`.

### D-12 — Documentação de usuário

**Decisão:** atualizar `docs/1.guide/1.basics/6.error.md` (exemplo de JSON em `:37-45`, lista de campos em `:54-60`, nota de mascaramento em `:90`). `CHANGELOG.md` é gerado pelo `changelogen` no release (`package.json:52`), então não é editado; a nota de quebra vai na descrição do PR.

## Arquivos a alterar

| Arquivo | O que muda | Referências |
| --- | --- | --- |
| `src/error.ts` | `ErrorInput` ganha `type`/`instance`; `HTTPError` ganha `type`/`instance` e nova `toJSON()`; doc de `message` (`:46-50`) passa a dizer `detail` | `src/error.ts:6`, `:46-50`, `:82-119`, `:162-210`, `:226-236` |
| `src/response.ts` | `problemHeaders`; `errorResponse()` usa `problemHeaders` | `src/response.ts:270-272`, `:358-361` |
| `src/utils/internal/status-text.ts` (novo) | Tabela RFC 9110 e `reasonPhrase()` | — |
| `docs/1.guide/1.basics/6.error.md` | Exemplo e lista de campos | `:37-60`, `:76`, `:90` |
| `test/errors.test.ts` | Ajustes e novos testes (ver estratégia) | ver lista abaixo |
| `test/unit/error.test.ts` (novo) | Testes unitários de `type`/`instance`/`toJSON()`/`reasonPhrase()` | — |
| Testes existentes com corpo antigo | Ajuste de asserção (ver lista) | ver lista abaixo |

Não alterar `src/index.ts`, `src/utils/response.ts`, `src/utils/internal/validate.ts`, `src/h3.ts`, `src/utils/json-rpc.ts`.

### Contrato de `src/error.ts` (sem novo export)

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...existentes
  /** RFC 9457 `type` URI. Sent as `about:blank` when omitted. */
  type?: string;
  /** RFC 9457 `instance` URI. Omitted from the body when not set. */
  instance?: string;
}

// não exportada
interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  data?: unknown;
  [member: string]: unknown;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // ...existentes
  toJSON(): ProblemDetails;
}
```

Implementação esperada de `toJSON()`:

```ts
toJSON(): ProblemDetails {
  const unhandled = this.unhandled;
  return {
    ...(unhandled ? undefined : this.body),
    type: this.type ?? "about:blank",
    title: unhandled ? reasonPhrase(this.status) : this.statusText || reasonPhrase(this.status),
    status: this.status,
    detail: unhandled ? undefined : this.message,
    instance: this.instance,
    data: unhandled ? undefined : this.data,
  };
}
```

No construtor, após `this.headers` (`src/error.ts:202-203`):

```ts
const type = (details as ErrorInput)?.type || (details?.cause as ErrorInput)?.type;
this.type = type || undefined;
const instance = (details as ErrorInput)?.instance || (details?.cause as ErrorInput)?.instance;
this.instance = instance || undefined;
```

### Contrato de `src/utils/internal/status-text.ts`

```ts
/** RFC 9110 reason phrase for `status`, or `undefined` for codes not in the table. */
export function reasonPhrase(status: number): string | undefined;
```

Tabela `Record<number, string>` cobrindo 400–431, 451, 500–505, 507, 508, 511 (nomes RFC 9110). Os códigos que `h3` gera (400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502, 504) precisam estar presentes.

### Contrato de `src/response.ts`

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = error.headers
    ? mergeHeaders(problemHeaders, error.headers)
    : new Headers(problemHeaders);
  // ...resto igual (errHeaders, JSON.stringify com stack em debug)
}
```

`FrozenHeaders` é declarada em `src/response.ts:260`, antes de `jsonHeaders` (`:270`). `problemHeaders` deve ser declarada depois da classe.

## Exemplos de corpo esperado

Handler que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Usuário não encontrado"
}
```

Erro não tratado (`new Error("falha inesperada")`, sem debug):

```json
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500
}
```

## Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever os testes de regressão primeiro, rodar e ver falhar, depois implementar.

### Novos testes em `test/errors.test.ts` (dentro de `describeMatrix`, rodam em web e node)

Um `describe("problem details (RFC 9457)")` com um caso por RF:
- **RF-01:** `throw new HTTPError({ status: 404, message: "Usuário não encontrado" })` → status 404; `content-type` começa com `application/problem+json`; corpo com `status: 404`, `detail`, `title: "Not Found"`.
- **RF-02:** `type` e `instance` lidos na instância (unit, ver abaixo) e presentes no corpo.
- **RF-03:** `status: 400` sem `type`/`instance` → `type: "about:blank"` e `"instance" in body` é `false`.
- **RF-04:** `unhandled: true`, `message: "segredo do banco"`, `data: { senha: "x" }` → corpo sem `"segredo do banco"` nem `"senha"` (checar `res.text()`), `title: "Internal Server Error"`. Erro vindo de `foreign` com `token=secret` (reaproveitar `test/errors.test.ts:339-353`) também não pode vazar a URL.
- **RF-05:** `status: 422`, `data: { campo: "email" }`, `body: { codigo: "INVALIDO" }` → `data` e `codigo` no nível superior.
- **RF-06:** `status: 401`, `headers: { "WWW-Authenticate": "Bearer" }` → header presente e `content-type` novo.
- **RF-07:** `throw new Error("falha inesperada")` → 500, `application/problem+json`, `type: "about:blank"`, sem a mensagem original.
- **D-08:** `body: { status: 999, type: "x" }` não sobrescreve `status`/`type`.
- **D-04:** `title` vem de `statusText` quando informado; erro não tratado com `statusText` herdado de `cause` usa a frase padrão.

### Novo `test/unit/error.test.ts`

- `new HTTPError({ status: 403, type: "...", instance: "/pedidos/42" })` → `error.type` e `error.instance` (RF-02).
- Herança: `type`/`instance` de `cause` (`new HTTPError({ cause: { status: 400, type: "u", instance: "i" } })`).
- `toJSON()` para cada código da tabela que `h3` usa.
- `reasonPhrase(499)` → `undefined`; `reasonPhrase(422)` → `"Unprocessable Content"`.

### Testes existentes que mudam (lista para ajuste de asserção, sem remover verificação)

Tudo que leia o corpo JSON de erro. Trocar `statusText` → `title`, `message` → `detail`, `unhandled` → ausência ou `title`. Não remover o que o teste verifica.

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `test/errors.test.ts` | `44` | `content-type` → `application/problem+json` |
| `test/errors.test.ts` | `53-57` | `statusText` → `title` |
| `test/errors.test.ts` | `79-85`, `99-104` | `statusText` → `title`; `message` → `detail` |
| `test/errors.test.ts` | `140` | regex `application/json` → `application/problem+json` |
| `test/errors.test.ts` | `144-150` | `statusText` → `title` |
| `test/errors.test.ts` | `257`, `309`, `384`, `420`, `442` | `unhandled: true` → `type: "about:blank"` e `title: "Internal Server Error"` |
| `test/errors.test.ts` | `350` | `{ unhandled: true, message: "HTTPError" }` → `title: "Internal Server Error"` e `detail` ausente |
| `test/handler.test.ts` | `222-223`, `238-239`, `272-273`, `297-298`, `312-313`, `328-329` | `statusText` → `title`; `message` → `detail` |
| `test/handler.test.ts` | `258` | `message` → `detail` |
| `test/validate.test.ts` | `182-183`, `194-196`, `279-280`, `288-290`, `379-381` | `statusText` → `title`; `message` → `detail` |
| `test/route.test.ts` | `72`, `91` | `statusText` → `title`; `message` → `detail` |
| `test/body.test.ts` | `457` | `statusText` → `title` (manter `stack[0]`, linha `458`) |
| `test/app.test.ts` | `205` | `statusText` → `title` |
| `test/body-limit.test.ts` | `122` | `message` → `detail` |
| `test/dist.test.ts` | `57` | `message` → `detail` (roda só com `dist/` construído) |
| `test/rules/cache.test.ts` | `251` | `message` → `detail` |
| `test/router.test.ts` | `110` | `message` → `detail` |
| `test/proxy.test.ts` | `1027-1028` | `statusText` → `title`; `message` → `detail` |

Não mudam: `test/validate.test.ts:161-163` (o `message` é de `data`), `test/auth.test.ts:12,25` e `test/middleware.test.ts:143` (leem `result.statusText` do header, não do corpo), `test/security.test.ts:540-556` (caminho 200), `test/json-rpc*.test.ts` (JSON-RPC), `test/unit/cookie-validation.test.ts:68` (inspeciona o erro, não o corpo), `test/mount.test.ts:294,314` (sem asserção de corpo).

### Verificação

1. `pnpm vitest run test/errors.test.ts` — novos testes falham antes da mudança e passam depois.
2. `pnpm vitest run test/unit/error.test.ts`.
3. `pnpm vitest run` — suíte completa.
4. `pnpm build` e depois `pnpm vitest run test/dist.test.ts` (o teste é pulado sem `dist/`).
5. `pnpm lint` (oxlint + oxfmt --check) **e** `pnpm typecheck` (`tsc --noEmit`, `package.json:54`). Ver Pendências: `pnpm lint` não roda tipos.

## Riscos

1. **Quebra para clientes.** Quem lê `message`, `statusText`, `unhandled` ou checa `application/json` quebra sem migração. Não há opção de volta (pedido). Registrar no PR e nas notas de release.
2. **`JSON.stringify(httpError)` muda.** Por D-02, `toJSON()` passa a devolver problem details. Quem serializa erros para log com `JSON.stringify` vê campos novos e perde `message`/`statusText`. Mitigação: nota no PR; `error.message` e `error.statusText` continuam existindo como propriedades.
3. **Vazamento em erro não tratado.** Se `unhandled` não for respeitado em `detail`, `data` ou `title` (D-04), detalhes internos aparecem. Coberto pelos testes RF-04 e RF-07 nos dois caminhos (`toError` e `onError`).
4. **Precedência do `body` (D-08).** Quem usava `body: { status: ... }` para mudar o status do corpo deixa de conseguir. É intencional, mas é mudança de comportamento.
5. **Cache de respostas de erro.** `h3/rules/cache` e `withCacheIsolation` podem guardar respostas com o `Content-Type` antigo. Entradas em memória somem no restart; armazenamento externo pode servir o formato antigo até o TTL. Checar `test/rules/cache.test.ts` com erros cacheados (há asserção de corpo em `:251`).
6. **Ruído de testes.** Muitas asserções mudam (lista acima). O risco é enfraquecer asserções; por isso a regra de manter cada verificação com a chave nova.
7. **Mudança de `unhandled` no corpo (D-07).** Clientes que usavam `body.unhandled` deixam de vê-lo.
8. **Tabela de frases.** Erro de código fora da tabela sem `statusText` fica sem `title`. Para status que `h3` gera, a tabela cobre o caso.
9. **Expectativa de lint.** `AGENTS.md:18` diz que `pnpm lint` inclui tipos, mas `package.json:46` não roda `tsc`. Se a checagem de tipos não for rodada separadamente, um erro de tipo passa despercebido.

## Pendências (confirmar com o autor do pedido)

- **Membro `unhandled` no corpo (D-07):** remover (proposta) ou manter como extensão?
- **`title` ausente para códigos fora da tabela (D-04):** aceitar a omissão ou usar um texto genérico?
- **`detail` sempre presente em erro tratado (D-05):** aceitar ou exigir a omissão quando `message` é o texto gerado por padrão?
- **Precedência `body` vs. membros RFC (D-08):** confirmar.
- **Verificação de tipos:** o pedido manda `pnpm lint` e `pnpm typecheck`; a spec roda os dois. A doc `AGENTS.md:18` diz que `lint` inclui tipos — inconsistência a corrigir fora desta mudança, se o autor quiser.
