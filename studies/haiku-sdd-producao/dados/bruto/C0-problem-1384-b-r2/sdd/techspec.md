# Techspec — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (#1384-B) e `sdd/prd.md`. Esta especificação não altera código; descreve como implementar RF-01 a RF-07.

## 1. Estado atual (conferido no código)

- `errorResponse(error, debug, errHeaders)` monta toda resposta de erro: `src/response.ts:358-380`. Usa `jsonHeaders` (`src/response.ts:270-272`, `content-type: application/json;charset=UTF-8`, `FrozenHeaders`) como base, faz merge de `error.headers` e `errHeaders` com `mergeHeaders` (`src/response.ts:243-252`) e serializa `{...error.toJSON(), stack}` com indentação 2 em debug.
- `errorResponse` é chamado em um único ponto: `src/response.ts:173` (dentro de `prepareResponse`). O `kNotFound` (404) e erros não-HTTPError (marcados `unhandled`, `src/response.ts:149-155`) passam por ele; `toError` cria `unhandled` em `src/response.ts:80`.
- `jsonHeaders` também serve respostas de sucesso (`src/response.ts:312`, `:318`) e **não** pode mudar.
- `HTTPError.toJSON()` em `src/error.ts:226-236` devolve `status`, `statusText`, `unhandled`, `message` (mascarada como `"HTTPError"` se `unhandled`), `data` e as chaves de `body` (ocultos se `unhandled`).
- `ErrorBody` (`src/error.ts:30-69`) é a base de `ErrorInput` (`src/error.ts:6`, via `Partial<ErrorBody>`) e `HTTPError implements ErrorBody` (`src/error.ts:74`). O construtor lê campos de `details` em `src/error.ts:172-209`.
- Já existe um `STATUS_TEXT` em `src/utils/response.ts:347-354`, mas só com 204/30x e não exportado; não serve para `title`.
- `src/utils/json-rpc.ts:480-491` cita `toJSON()` apenas em comentário e não o chama; não é afetado.
- Há um segundo ponto que muda `unhandled` em runtime: `src/utils/middleware.ts:50-51`.

## 2. Decisões de arquitetura

### D-01 — Onde montar o corpo Problem Details
**Alternativas**
1. Mudar `HTTPError.toJSON()` para devolver o formato RFC 9457.
2. Manter `toJSON()` e montar o corpo em `errorResponse`.
3. Novo método público (ex.: `toProblem()`).

**Escolha: 2.** `toJSON()` é usado implicitamente por `JSON.stringify(error)` em código de aplicação (logs, `onError` customizado); mudá-lo quebra "não quebrar o que existe" além do corpo HTTP. A opção 3 viola "nenhum outro nome público novo". A montagem fica em uma função interna (não exportada) em `src/response.ts`, ao lado de `errorResponse`.

### D-02 — Content-Type `application/problem+json`
**Alternativas**: (a) trocar `jsonHeaders` globalmente; (b) nova constante só de erro; (c) setar o header em `errorResponse` por `headers.set`.

**Escolha: (b).** Nova constante `problemHeaders` (`FrozenHeaders` com `application/problem+json;charset=UTF-8`) definida junto de `jsonHeaders` (`src/response.ts:270`). Substituir `jsonHeaders` por `problemHeaders` em `src/response.ts:360-361`. (a) mudaria respostas de sucesso; (c) seria equivalente, mas perde o reaproveitamento barato de headers congelados. Como `mergeHeaders` usa `set`, `content-type` explícito em `error.headers` ou `errHeaders` continua prevalecendo (RF-06) sem código extra.

### D-03 — `title` por status: mapa interno novo
**Alternativas**: (a) estender `STATUS_TEXT` de `src/utils/response.ts:347`; (b) usar `Response.statusText`/`new Response().statusText`; (c) novo mapa interno.

**Escolha: (c)**, em `src/utils/internal/status-text.ts`, exportando `statusPhrase(status: number): string | undefined` (interno, fora de `src/index.ts`). (a) mudaria a semântica documentada ali ("qualquer outro status não recebe frase", usado em `src/utils/response.ts:44` e `:79`, e há testes de `noContent`/`redirect` dependendo disso). (b) é rejeitado pelo PRD (runtime não garante `statusText`). O mapa cobre os códigos RFC 9110 de 400-599 (e os demais usados pelo h3, como 499 não é padrão: sem frase). Status sem frase: `title` omitido (a RFC permite).
`title = error.statusText ?? statusPhrase(error.status)`.

### D-04 — Contrato do corpo e precedência de membros
Ordem de montagem (últimos vencem): extensões de `body` → membros padrão. Assim `body: { status: 200 }` não sobrescreve `status` (RF-05).

```
{
  ...(unhandled ? undefined : error.body),   // extensões da aplicação
  type: unhandled ? "about:blank" : error.type ?? "about:blank",
  title,
  status: error.status,
  detail: <igual a message>,
  instance: unhandled ? undefined : error.instance,   // omitido quando undefined (JSON.stringify)
  message: <igual a detail>,                 // compat.; também não pode ser sobrescrito
  data: unhandled ? undefined : error.data,
  stack: debug && error.stack ? [...] : undefined,
}
```
- `detail`/`message` = `unhandled ? "HTTPError" : error.message` (reaproveita a máscara atual de `src/error.ts:232`; garante que `message === detail` e que a mensagem interna não vaza — RF-04). **Ponto a validar:** `"HTTPError"` como `detail` de um 500 é pouco informativo; alternativa é omitir `detail` e manter `message: "HTTPError"` (teste existente `test/errors.test.ts:350` exige `message`). Adotar a primeira por manter a invariante do RF-05 até haver decisão contrária.
- `statusText` e `unhandled` deixam de ser membros do corpo (premissa do PRD). A status line HTTP continua vindo de `error.statusText` (`src/response.ts:376`).
- `data` e `stack` ficam depois do spread, então `body: { data, stack }` também não os sobrescreve (hoje `stack` já vence, `src/response.ts:369`).
- Para reduzir risco de duplicação com `toJSON`, `errorResponse` **não** o chama mais; a lógica de mascaramento de `unhandled` fica concentrada na nova função interna `problemBody(error, debug)` em `src/response.ts` (arquivo passará de ~380 para ~410 linhas; se ultrapassar a convenção de < 200 LoC por arquivo já excedida hoje, não mover agora — fora do escopo).

### D-05 — `type` e `instance` em `HTTPError`
**Alternativas**: (a) declarar em `ErrorInput` apenas; (b) declarar em `ErrorBody` (herdado por `ErrorInput`, implementado por `HTTPError`); (c) herdar também de `cause` como `status`/`statusText`.

**Escolha: (b), sem (c).** (b) é um único ponto de declaração e `HTTPError.status(...)` já repassa `details` (`src/error.ts:149`), cumprindo RF-03 sem mudar a assinatura. (c) é rejeitado: o fluxo `new HTTPError({ cause, unhandled: true })` (`src/adapters.ts:122,143,145,149,152`) e `new HTTPError(val)` para erros genéricos poderiam herdar `type`/`instance` de objetos arbitrários em `cause`. Lido apenas do próprio `details` (que cobre o caso `new HTTPError(outroHTTPError)`).

### D-06 — Erros `unhandled` (RF-04)
Para `unhandled`, `type`/`instance`/`data`/`body`/`message` originais não são expostos; `type` é sempre `"about:blank"`. `title` continua `statusText ?? frase` (comportamento atual já expõe `statusText`; mantido). Cobre também o `unhandled` atribuído depois da construção (`src/response.ts:151`, `src/utils/middleware.ts:51`), pois a decisão é tomada em `problemBody` lendo `error.unhandled` no momento de renderizar.

### D-07 — Sem gatilho de configuração
Nenhuma opção em `H3Config` (`src/types/h3.ts`) nem leitura de `Accept`. O formato é incondicional (pedido #1384-B). Consequência aceita e registrada como risco.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/error.ts:30-69` | Adicionar `type?: string` e `instance?: string` a `ErrorBody` (com JSDoc). |
| `src/error.ts:74-119` | Adicionar `readonly type: string \| undefined` e `readonly instance: string \| undefined` à classe. |
| `src/error.ts:208-209` | No construtor, atribuir `this.type = (details as ErrorBody)?.type; this.instance = (details as ErrorBody)?.instance;` (sem herdar de `cause`, D-05). |
| `src/error.ts:226-236` | `toJSON()` permanece como está (D-01). Opcional: incluir `type`/`instance` não-unhandled; **decisão: não incluir**, para não mudar o contrato do `toJSON`. |
| `src/response.ts:270-272` | Adicionar `problemHeaders` abaixo de `jsonHeaders`. |
| `src/response.ts:358-380` | `errorResponse`: usar `problemHeaders` (linhas 360-361) e `problemBody` no lugar de `error.toJSON()` (linha 368). |
| `src/utils/internal/status-text.ts` | Novo arquivo, mapa interno + `statusPhrase()`. |
| `src/response.ts` (imports, topo) | Importar `statusPhrase` com extensão `.ts`. |
| `test/errors.test.ts:44, 53-57, 79-85, 99-104, 140, 144-150, 257, 309, 350, 384, 420, 442` | Ajustar asserts do formato antigo (ver §5). |
| `test/errors.test.ts` (ou `test/problem-details.test.ts`) | Novos testes RF-01 a RF-06. |

Não alterar `src/index.ts` (nenhum export novo), `src/rules/*`, `src/tracing.ts`, adaptadores.

## 4. Contratos e assinaturas

```ts
// src/error.ts — ErrorBody (adições)
/** RFC 9457 `type`: URI-reference que identifica o tipo do problema. Padrão no corpo: "about:blank". */
type?: string;
/** RFC 9457 `instance`: URI-reference da ocorrência específica. Omitido do corpo se ausente. */
instance?: string;

// src/error.ts — HTTPError (adições)
readonly type: string | undefined;
readonly instance: string | undefined;

// src/response.ts (internas, não exportadas)
const problemHeaders: FrozenHeaders;                       // application/problem+json;charset=UTF-8
function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/utils/internal/status-text.ts (interna)
export function statusPhrase(status: number): string | undefined;
```
Compatibilidade de tipos: `isolatedDeclarations` exige anotação explícita nas exportações do novo módulo (`statusPhrase` já a tem). Sem `enum`/`namespace` (`erasableSyntaxOnly`).

Corpo resultante (exemplo `new HTTPError("Sem permissão", { status: 403 })`):
```json
{"type":"about:blank","title":"Forbidden","status":403,"detail":"Sem permissão","message":"Sem permissão"}
```

## 5. Estratégia de testes

Usar `describeMatrix` (modos `web` e `node`), `ctx.app`/`ctx.fetch` como em `test/errors.test.ts:6`.

**Testes novos (ao menos um por requisito)**
- RF-01: `new HTTPError({ status: 404 })` → `content-type` começa com `application/problem+json`. Cobrir também `kNotFound` (rota inexistente) e erro lançado por handler assíncrono.
- RF-02: `new HTTPError("Sem permissão", { status: 403 })` → `type: "about:blank"`, `title: "Forbidden"`, `status: 403`, `detail`. Caso com `statusText` customizado → `title` customizado; status sem frase → sem `title`.
- RF-03: leitura de `error.type`/`error.instance` (inclusive `undefined` e via `HTTPError.status(409, undefined, { type, instance })`) e presença no corpo; `instance` ausente não aparece no JSON.
- RF-04: `throw new Error("segredo interno")` sem `debug` → corpo sem "segredo interno", `data`, `stack`; HTTPError com `unhandled: true`, `type` e `instance` → corpo com `type: "about:blank"` e sem `instance`.
- RF-05: `data`, `body: { codigo: "E42", status: 200, title: "x" }` → `data` aninhado, `codigo` na raiz, `message === detail`, `status` 422, `title` não sobrescrito.
- RF-06: `www-authenticate` preservado, status 401, `debug: true` → corpo indentado com `stack`, `content-type` problem+json; `content-type` explícito no erro prevalece; `errHeaders` e `onError` continuam fazendo merge (reaproveitar o loop de `test/errors.test.ts:10-64`).
- HEAD: corpo vazio e `content-type` problem+json preservados.

**Testes existentes a ajustar sem perder a verificação**
- `test/errors.test.ts:44` e `:140`: `application/json` → `application/problem+json` (mantendo o sufixo de charset em `:44`).
- `test/errors.test.ts:53-57`, `:79-85`, `:99-104`, `:144-150`: trocar `statusText: "..."` do corpo por `title: "..."`; `message`/`data`/`topLevel` seguem iguais. A checagem de `res.statusText` (status line) permanece.
- `test/errors.test.ts:257, 309, 350, 384, 420, 442`: remover `unhandled: true` do corpo e passar a verificar `status: 500` + ausência de vazamento (o que protegem); `:350` mantém `message: "HTTPError"`.
- Rodar `pnpm vitest run` e corrigir quaisquer outros testes que assertem corpo/`content-type` de erro; os pontos de partida são `test/status.test.ts`, `test/middleware.test.ts:56`, `test/mount.test.ts:294,314`, `test/handler.test.ts:222-328`, `test/route.test.ts:72`, `test/validate.test.ts` (casos de erro) e `test/proxy.test.ts:1027`. As ocorrências de `application/json` em `security.test.ts:556`, `proxy.test.ts:1531` e `body.test.ts` são respostas de sucesso e **não** mudam.

**Qualidade**: `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` (`tsc --noEmit`). Fluxo de bug/feature do AGENTS.md: escrever os testes novos primeiro e confirmar que falham antes de alterar `src/`.

## 6. Riscos

- **Quebra de contrato (principal):** substituição incondicional do formato conflita com "não quebrar o que existe". Consumidores que leem `statusText`/`unhandled` do corpo, ou comparam `content-type` por igualdade com `application/json`, quebram. Mitigação parcial: `message`, `data` e chaves de `body` mantidos. Registrar como breaking nas notas de versão e validar com o responsável.
- **Pacotes dependentes** (Nitro e afins) com formato de erro próprio ou que leem `statusText` do JSON podem precisar de adaptação.
- **Vazamento em `unhandled`:** mitigado por D-04/D-06 e teste dedicado; atenção ao `unhandled` atribuído tardiamente (`src/response.ts:151`).
- **Colisão de chaves** de `body` com membros padrão: mitigada pela ordem de montagem (D-04) e teste RF-05.
- **`detail: "HTTPError"` em 500:** pouco útil ao cliente; ponto aberto em D-04.
- **Mapa de frases incompleto/divergente** de runtimes: `title` pode divergir do `statusText` da status line apenas quando o erro define `statusText` próprio, o que é o comportamento desejado; códigos fora do mapa ficam sem `title`.
- **Valores de `type`/`instance` não validados** (premissa do PRD): URI inválida é repassada como informada.
- **Tamanho de arquivo:** `src/response.ts` já excede a convenção de < 200 LoC; a mudança adiciona poucas linhas e não justifica refatoração agora.
