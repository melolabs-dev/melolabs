# Especificação técnica — `problem()` (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-08). Citações `arquivo:linha` conferidas no código atual (commit `9b34ab7`).

## 1. Contexto no código

- Todo erro vira resposta em `prepareResponse`: `src/response.ts:146-174`. Erros que não são `HTTPError` são reembrulhados com `new HTTPError(val)` e marcados `unhandled` (`src/response.ts:147-155`). O corpo é montado por `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`, definição em `src/response.ts:358-380`).
- `errorResponse` parte de `jsonHeaders` (`src/response.ts:270-272`, `content-type: application/json;charset=UTF-8`), mescla `error.headers` e depois `errHeaders` com `mergeHeaders` (`src/response.ts:243-252`, `src/response.ts:359-364`). Serializa `error.toJSON()` mais `stack` (só em `debug`) (`src/response.ts:366-373`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) mascara `message`/`data`/`body` quando `unhandled`. Ele não muda.
- O construtor de `HTTPError` (`src/error.ts:162-210`) **normaliza** a entrada, e isso importa para o problem details:
  - `statusText` passa por `sanitizeStatusMessage` (`src/error.ts:180-185`), que remove tudo fora de ASCII visível (`src/utils/sanitize.ts:3,10-12`). `"Entidade inválida"` vira `"Entidade invlida"`.
  - `message` ganha fallback (`src/error.ts:187-193`): sem `message`, usa o `statusText` ou `"HTTPError 404 …"`.
  - `cause` recebe o próprio objeto de entrada (`src/error.ts:195-197`).
  - `type` e `instance` seriam descartados, pois o construtor não os lê.
- `index.ts` exporta o erro em `src/index.ts:72` e os utilitários de resposta em `src/index.ts:112-125`. Todas as entradas de plataforma fazem `export * from "../index.ts"` (ex.: `src/_entries/generic.ts:7`).
- Convenção de propriedades privadas com `~`: `src/h3.ts:42,46-51`.

## 2. Decisões de arquitetura

### D-01 — Onde fica `problem()` e o tipo `ProblemInput`

**Alternativas**
1. Método estático `HTTPError.problem(...)`. Adicionaria superfície em `HTTPError` e `error.ts` já passa de 200 linhas (237). Foge do pedido, que fixa a *função* `problem`.
2. Colocar em `src/error.ts`. Mesmo problema de tamanho.
3. Novo módulo `src/utils/problem.ts`, reexportado em `src/index.ts`.

**Escolha: 3.** Segue "short files" e o padrão de `utils/*` público (AGENTS.md). Exporta apenas `problem` e `ProblemInput` (nomes permitidos pelo contrato). O reexport vai ao lado do bloco "Error" (`src/index.ts:70-72`):
`export { problem, type ProblemInput } from "./utils/problem.ts";`.

### D-02 — Como marcar o erro como problem details

**Alternativas**
1. Subclasse `ProblemError extends HTTPError`. `HTTPError.isError` exige `name === "HTTPError"` (`src/error.ts:129-133`), então a subclasse teria de manter o nome, e viraria uma classe exportada (nome público novo, vetado).
2. Símbolo exportado. Também é nome público novo.
3. Propriedade `"~problem"` não enumerável, definida com `Object.defineProperty` sobre a instância de `HTTPError`. Segue a convenção `~` (`src/h3.ts:46`) e a premissa do PRD (§4).

**Escolha: 3.** Não enumerável, para não aparecer em `JSON.stringify(error)`, em `toJSON` nem em logs. O valor é um objeto interno congelável:

```ts
// src/utils/internal/problem.ts
export interface ProblemMeta {
  type?: string;
  instance?: string;
  title?: string;   // statusText cru da entrada (ver D-03)
  detail?: string;  // message crua da entrada (ver D-03)
}
export const kProblem = "~problem"; // chave string, não exportada pelo pacote
```

### D-03 — O corpo usa os valores CRUS da entrada, não os do `HTTPError`

O construtor altera dois campos que o corpo precisa. O critério do RF-02 espera `title: "Entidade inválida"`, mas `error.statusText` é `"Entidade invlida"` (`src/error.ts:180-185`). Sem `message`, `error.message` não é vazio (`src/error.ts:187-193`) e produziria um `detail` espúrio como `"HTTPError 404"`, contra o RF-04.

**Alternativas**
1. Ler `error.statusText` e `error.message`. Quebra RF-02 (acento) e RF-04 (`detail` falso).
2. Alterar o construtor para guardar o texto cru. Mexe em código compartilhado e arrisca RF-07.
3. `problem()` captura `title = input.statusText ?? input.statusMessage` e `detail = input.message` **antes** de construir o erro e guarda em `"~problem"`.

**Escolha: 3.** `error.ts` fica intocado. O `statusText` do status line HTTP continua sanitizado (comportamento atual); só o `title` do corpo preserva Unicode. Strings vazias contam como ausentes. O corpo é JSON UTF-8, então não há risco de injeção de header.

### D-04 — Montagem do corpo em `errorResponse`

`errorResponse` (`src/response.ts:358`) lê `error["~problem"]`. Se existir, usa o helper `toProblemJSON(error, meta)` e o content-type de problem. Se não, o fluxo atual permanece inalterado (RF-07).

Regras de `toProblemJSON` (arquivo `src/utils/internal/problem.ts`):

1. `status = error.status` (já sanitizado, padrão 500). Sempre igual ao status HTTP (RF-04).
2. `type = meta.type || "about:blank"`.
3. `title = meta.title || statusTexts[status]`. Para status sem texto padrão e sem `statusText`, o campo é omitido (a RFC 9457 §3.1.3 trata `title` como SHOULD; `undefined` some no `JSON.stringify`).
4. `detail = meta.detail`, `instance = meta.instance` (omitidos se ausentes).
5. Extensões: primeiro `data` (se for objeto simples, é espalhado; se for outro tipo, vai sob a chave `data`), depois `body` por cima. Por último os membros padrão, que têm precedência (RF-02, risco "conflito de membros"). Ordem de chaves no resultado: padrão primeiro, extensões depois (só estética; a precedência é garantida pelo spread final dos padrão, então a implementação monta `{...ext, type, status, title, detail, instance}` e reordena se quiser).
6. **Não tratado (`error.unhandled`)**: corpo mínimo `{ type: "about:blank", status, title }`. Sem `detail`, `instance`, `type` customizado, `data` nem `body` (RF-06; decisão conservadora, ver risco R-05).
7. `stack` é anexado em `errorResponse` exatamente como hoje, quando `debug` (`src/response.ts:369`). `JSON.stringify` indentado em `debug` fica igual (`src/response.ts:371`).

**Alternativas para o texto padrão do status:** (a) dependência externa, vetada pelo PRD (§4, premissas); (b) `Response.statusText`/`http.STATUS_CODES`, que não são portáveis entre runtimes; (c) **mapa mínimo interno** `Record<number, string>` com os códigos 400-451 e 500-511 mais comuns. Escolha (c), em `src/utils/internal/problem.ts`, ~50 linhas.

### D-05 — Content-Type

Novo `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` em `src/response.ts`, junto a `jsonHeaders` (`src/response.ts:270`), pois `FrozenHeaders` é local daquele arquivo (`src/response.ts:260-264`).

**Alternativas:** (1) trocar o header depois de montar a resposta, que é frágil e sobrescreve o valor do chamador; (2) escolher a base de headers antes do merge. **Escolha 2**: em `errorResponse`, `const base = meta ? problemHeaders : jsonHeaders` e o merge existente (`src/response.ts:359-364`) permanece. Assim `error.headers` e depois `errHeaders` prevalecem sobre o content-type padrão (RF-03), como já ocorre com os demais headers.

### D-06 — Reembrulho do erro (marca se perde)

Entender o que acontece:
- `throw problem(...)` e `return problem(...)`: `HTTPError.isError` é verdadeiro, a mesma instância segue (`src/response.ts:147-148`). Marca preservada. Idem em `onError` (middleware) sem retorno (`src/utils/middleware.ts:47-60`) e no hook global que devolve `undefined` (`src/response.ts:165`, `newVal ?? val`).
- `new HTTPError(problemError)` ou `new HTTPError({ cause: problemError })`: o construtor herda `status`, `statusText`, `headers`, `unhandled` do `cause` (`src/error.ts:172-206`), mas não copiaria a marca.

**Alternativas:** (1) estender o construtor para herdar `"~problem"` do `cause`, que altera `error.ts` e muda a semântica de erros "embrulhados" (risco para RF-07); (2) **não herdar**: apenas o erro criado por `problem()` e repassado como instância usa o formato.

**Escolha: 2.** Alinhado ao PRD ("somente as respostas que usam o utilitário mudam"). Fica coberto por teste que documenta o comportamento (§5, T-09).

### D-07 — Assinatura e tipos

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI que identifica o tipo do problema. Padrão: `"about:blank"`. */
  type?: string;
  /** URI que identifica esta ocorrência específica do problema. */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

- `ProblemInput` estende `ErrorInput` (`src/error.ts:6-26`) e herda `status`, `statusText`, `message`, `data`, `body`, `unhandled`, `cause`, `headers` e os `@deprecated` `statusCode`/`statusMessage`.
- `isolatedDeclarations`: a função e a interface têm tipos explícitos de entrada e retorno (AGENTS.md; PRD §4).
- Corpo: `const error = new HTTPError(input)`, depois `Object.defineProperty(error, "~problem", { value: meta })` (não enumerável, não gravável). Retorna `error`, portanto `HTTPError.isError(error)` é `true` (RF-01).
- `type`/`instance` vazios ou não-string são ignorados. Mesmo critério de D-03 para strings vazias.

### D-08 — Fora do caminho do `toJSON`

`HTTPError.toJSON()` (`src/error.ts:226`) continua sendo o formato padrão e não é alterado. Quem chama `JSON.stringify(error)` de um erro de `problem()` obtém o formato h3. O formato problem existe só na camada de resposta. Isso mantém RF-07 e evita que `json-rpc` (`src/utils/json-rpc.ts:483-488`) e outros consumidores de `HTTPError` mudem.

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/problem.ts` (novo) | — | `problem`, `ProblemInput` (D-01, D-07). |
| `src/utils/internal/problem.ts` (novo) | — | `ProblemMeta`, mapa de status, `toProblemJSON` (D-02, D-04). Sem exportar pelo `index.ts`. |
| `src/response.ts` | `270-272` (junto), `358-380` | Adicionar `problemHeaders`; em `errorResponse` escolher a base de headers e o corpo pela marca `"~problem"` (D-04, D-05). Import do helper no topo (`src/response.ts:1-8`). |
| `src/index.ts` | `70-72` | Reexportar `problem` e `type ProblemInput`. |
| `test/unit/package.test.ts` | `104-105` | Inserir `"problem",` entre `"parseCookies"` e `"proxy"` no snapshot de exports. É o único teste existente que a mudança altera (lista de exports ordenada); o que ele verifica (conjunto exato de exports) permanece. |
| `test/problem.test.ts` (novo) | — | Integração, `describeMatrix` (§4). |
| `test/unit/types.test-d.ts` | `11`, `35-40` | Teste de tipos de `ProblemInput`/`problem`. Importa de `../../src/index.ts` (imports em `test/unit/types.test-d.ts:1-26`). |
| `docs/1.guide/1.basics/6.error.md` | seções `## Unhandled Errors` (linha 78) | Opcional: parágrafo curto com exemplo de `problem()`. Não altera código. |

Não mudam: `src/error.ts`, `src/h3.ts`, `src/middleware.ts`, `src/utils/middleware.ts`, `src/utils/json-rpc.ts`, `src/_deprecated.ts`.

## 4. Contratos de comportamento

Exemplo ponta a ponta (RF-02), com `debug: false`:

```ts
app.get("/cadastro/42", () => {
  throw problem({
    status: 422,
    type: "https://exemplo.com/erros/validacao",
    statusText: "Entidade inválida",
    message: "Campo email ausente",
    instance: "/cadastro/42",
  });
});
// 422, content-type: application/problem+json;charset=UTF-8
// { "type": "https://exemplo.com/erros/validacao", "status": 422,
//   "title": "Entidade inválida", "detail": "Campo email ausente",
//   "instance": "/cadastro/42" }
```

| Entrada | Corpo |
| --- | --- |
| `problem({ status: 404 })` | `{ type: "about:blank", status: 404, title: "Not Found" }` |
| `problem({ status: 429, headers: {"retry-after":"30"}, body: { saldo: 0 } })` | `{ type, status: 429, title: "Too Many Requests", saldo: 0 }` + header `retry-after: 30` |
| `problem({ status: 500, unhandled: true, message: "segredo", body: { x: 1 } })` | `{ type: "about:blank", status: 500, title: "Internal Server Error" }` |
| `problem({ status: 400, body: { status: 999, title: "x" } })` | `status: 400`, `title: "Bad Request"` (padrão vence) |
| `problem({})` | status 500 |
| `new HTTPError({ status: 400, message: "ruim" })` | formato atual, `application/json;charset=UTF-8` |

## 5. Estratégia de testes

Unitário e integração em `test/problem.test.ts`, com `describeMatrix` (web e node), no padrão de `test/errors.test.ts:6` (`describeMatrix("errors", (t, { it, expect, describe }) => …)`).

**Atenção ao setup:** `test/_setup.ts:136` cria o app com `debug: true`, e o corpo ganha `stack`. Para igualdade exata do RF-02, os testes fazem `t.app.config.debug = false` (o padrão de mutar `t.app.config` já existe em `test/errors.test.ts:14`), ou removem `stack` antes de `toEqual`. O hook `onError` do setup guarda erros em `t.errors` e falha em erros `unhandled` (`test/_setup.ts:128-132,153-155`), então os testes de `unhandled: true` limpam `t.errors = []` como em `test/errors.test.ts:116`.

| ID | Cobre | Caso |
| --- | --- | --- |
| T-01 | RF-01 | `problem({status:404})` é `instanceof HTTPError`; `HTTPError.isError` é `true`; `status` 404. |
| T-02 | RF-02 | Exemplo 422 completo: corpo exato (`toEqual`), sem `statusText`/`message`; `title` mantém acento (D-03). |
| T-03 | RF-03 | `content-type` começa com `application/problem+json`, status 400; com `headers: {"content-type": "application/x+json"}` o valor do chamador prevalece. |
| T-04 | RF-04 | `{status:404}` → `type: "about:blank"`, `status: 404`, `title: "Not Found"`, sem `detail` falso. |
| T-05 | RF-05 | `retry-after`, `body: { saldo: 0 }`, `data` objeto espalhado, `data` não-objeto sob `data`, `cause` preservada em `t.errors[0].cause`. |
| T-06 | RF-02 | Precedência: `body`/`data` com `type`, `status`, `title`, `detail`, `instance` não sobrescrevem os padrão. |
| T-07 | RF-06 | `unhandled: true`: corpo sem `segredo` e sem `x`, nem `instance`/`type` custom. Também com `debug: false`. |
| T-08 | RF-07 | `new HTTPError`, `HTTPError.status`, `throw new Error`, `kNotFound` (404 por rota ausente) e `throw 404`: content-type e corpo atuais. Os testes existentes de `test/errors.test.ts` rodam sem alteração e cobrem a regressão. |
| T-09 | D-06 | `throw problem(...)` com `onError` global devolvendo `undefined`: formato mantido. `throw new HTTPError({ cause: problem(...) })`: herda status/headers, mas responde com `application/json` (documenta que a marca não é herdada). |
| T-10 | RF-03 | `HEAD` e `GET` com `problem()` e `event.res.errHeaders`: `set-cookie` não duplica, corpo vazio no HEAD (espelha `test/errors.test.ts:26-61`). |
| T-11 | RF-02 | `debug: true` adiciona `stack` ao corpo problem. |
| T-12 | RF-08 | Tipos (`expectTypeOf`): `problem` aceita `type`/`instance` strings e todos os campos de `ErrorInput`; retorna `HTTPError<DataT>`; `type: 123` é erro (`// @ts-expect-error`). |
| T-13 | Exports | `test/unit/package.test.ts` com `"problem"` no snapshot. |

Comandos de verificação: `pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test` (RF-08). Antes de implementar, confirmar que T-02 a T-07 **falham** (fluxo de correção do AGENTS.md).

## 6. Riscos

- **R-01 — Valores crus vs. normalizados (D-03).** Um futuro refactor do construtor pode tornar o `title` inconsistente. Mitigação: T-02 fixa o acento; `meta` é a fonte única.
- **R-02 — Marca perdida no reembrulho (D-06).** Mitigação: T-09 documenta e fixa o comportamento. Se virar requisito, a evolução é herdar do `cause` em `error.ts:195-206`, com novo teste de regressão em T-08.
- **R-03 — Conflito de membros.** Resolvido por precedência dos padrão (T-06). `stack` vindo de `body` continua sendo sobrescrito por `stack: undefined`/valor de debug, como hoje (`src/response.ts:369`).
- **R-04 — Content-type e headers do chamador.** Escolha da base antes do merge (D-05) preserva a ordem atual; T-03 e T-10 cobrem.
- **R-05 — Erro não tratado.** O formato é um segundo caminho de serialização. O corpo mínimo oculta também `type` e `instance`, mais restritivo que o literal do RF-06 (que cita só `message`, `data`, `body`). Se o PRD preferir manter `type`/`instance` em `unhandled`, é uma linha em `toProblemJSON`. **Ponto a confirmar com o dono do PRD.**
- **R-06 — Texto de status incompleto.** Códigos fora do mapa sem `statusText` ficam sem `title`. Aceitável pela RFC; T-04 cobre os comuns.
- **R-07 — `isolatedDeclarations`/lint.** Mitigação: tipos explícitos em exports (D-07); validar com `pnpm lint` e `pnpm typecheck`.
- **R-08 — Tamanho de `response.ts`.** O arquivo já tem 380 linhas; por isso a lógica pesada fica em `src/utils/internal/problem.ts` e só ~6 linhas entram em `errorResponse`.
