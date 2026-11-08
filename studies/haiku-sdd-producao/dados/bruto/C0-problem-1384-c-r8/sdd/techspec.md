# Techspec — Problem Details (RFC 9457) via `problem()`

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01…RF-10). Citações `arquivo:linha` conferidas no código atual (commit `d9e379e`).

## 1. Visão geral

`problem(input)` cria um `HTTPError` comum e lhe anexa uma marca interna não enumerável (`~problem`) com os membros específicos da RFC 9457 (`type`, `instance`, `detail`). `errorResponse` (`src/response.ts:358`) passa a consultar essa marca: se existir, serializa o corpo no formato Problem Details e usa `application/problem+json`; se não existir, o caminho atual fica byte a byte igual. `HTTPError`, `ErrorBody` e `toJSON()` não mudam.

Fluxo (já existente) que cobre `throw` e `return`: `prepareResponse` trata qualquer `val instanceof Error` (`src/response.ts:146`), usa `HTTPError.isError` (`:147`) e chama `errorResponse` (`:173`). Como `problem()` devolve um `HTTPError` real, ambos os caminhos (RF-06) passam por aí sem código adicional.

## 2. Decisões de arquitetura

### D-01 — A marca do formato é uma propriedade `~problem` não enumerável no próprio erro

- **Alternativas:**
  1. Subclasse não exportada de `HTTPError` (`ProblemError`), detectada com `instanceof`.
  2. Marca em `WeakSet`/`WeakMap` de módulo.
  3. Propriedade `~problem` definida com `Object.defineProperty` (não enumerável), contendo os dados do problema.
- **Escolha: 3.** A convenção do projeto já prevê `~` para propriedades privadas/não enumeráveis (`AGENTS.md`). Uma subclasse exigiria `name` e `isError` coerentes (`src/error.ts:75`, `:129`) e quebraria com cópias duplicadas do módulo (a razão de `isError` não usar `instanceof`). `WeakMap` também não atravessa instâncias duplicadas do h3. A propriedade fica fora de `toJSON()`, de `JSON.stringify` e de `Object.keys`, então nada muda para quem não usa `problem()` (RF-08). Um `Error` não pode ser forjado a partir de JSON de entrada, portanto a marca não é vetor de injeção (ao contrário do caso de `HTTPResponse`, `src/response.ts:85-94`).

### D-02 — `problem()` não altera `HTTPError`; guarda `detail` explícito na marca

- **Alternativas:** (a) novos campos `type`/`instance` em `HTTPError`; (b) derivar `detail` de `error.message`; (c) capturar `input.message` no momento da criação e guardá-lo na marca.
- **Escolha: c.** O construtor sempre sintetiza `message` (`"HTTPError 404"`, `src/error.ts:187-193`), então não dá para distinguir mensagem explícita de sintética a partir do erro. Capturar `input.message` (string não vazia) em `problem()` atende a premissa do PRD (“sem `message`, `detail` é omitido”) sem tocar na classe (fora de escopo: PRD §3, “mudar `HTTPError` … de forma observável”). `statusMessage`/`statusText` usados como `message` pelo construtor (`:191-192`) também não viram `detail`, pois o RF só cita `message` explícita.

### D-03 — Renderização isolada em `src/utils/internal/problem.ts`, chamada por `errorResponse`

- **Alternativas:** (a) sobrescrever `toJSON()` na instância criada por `problem()`; (b) ramificar dentro de `errorResponse` com a lógica inline; (c) helper interno `problemBody(error, debug)` + ramificação mínima em `errorResponse`.
- **Escolha: c.** (a) é observável em `toJSON()` e vazaria para `onError`/logs; o PRD proíbe mudar `toJSON` e o content-type também precisa ser trocado, o que só `errorResponse` controla. (b) incharia `response.ts`, que já é grande (>380 linhas; meta “<200 LoC por arquivo”). O helper concentra: leitura da marca, tabela de títulos, montagem do corpo e regras de `unhandled`. `internal/` não é exportado (`AGENTS.md`), logo nenhum nome público extra (RF-01).

### D-04 — Local e exportação de `problem` e `ProblemInput`

- **Alternativas:** `src/error.ts` (junto de `HTTPError`) vs. `src/utils/problem.ts` novo.
- **Escolha: `src/utils/problem.ts`.** `error.ts` já tem 237 linhas (`src/error.ts:237`) e a convenção coloca funções utilitárias públicas em `utils/`. A exportação vai em `src/index.ts` ao lado do bloco “Error” (`src/index.ts:70-72`), com import direto do módulo (sem barrel). Exports públicos novos: exatamente `problem` e `type ProblemInput`. O snapshot de `test/unit/package.test.ts` só enxerga valores, logo ganha apenas `"problem"`.

### D-05 — Formato do corpo e precedência (RF-03, RF-05, RF-09)

Corpo = `{ ...extensões, type, status, title, detail, instance }`, sendo as extensões `{ data, ...body }` espalhadas **antes** dos membros padrão para que estes tenham precedência na colisão. Detalhes:

- `type`: `marca.type ?? "about:blank"`.
- `status`: `error.status`.
- `title`: `error.statusText || STATUS_TITLES[status]`; omitido se ambos faltarem (premissa do PRD).
- `detail`/`instance`: omitidos quando ausentes; `JSON.stringify` já descarta `undefined`, mas o helper só adiciona a chave quando há valor, para o objeto não carregar `undefined` (RF-05).
- `data`: entra como membro raiz `data` (decisão sobre a ambiguidade do RF-03: “`data` e as chaves de `body` aparecem no nível raiz” — `data` vira o membro de extensão `data`, o `body` é espalhado). Não é espalhado, porque `data` pode não ser objeto.
- `unhandled`: mantém a regra de `toJSON()` (`src/error.ts:227-235`): extensões (`data`, `body`) e `detail` são omitidos; `type`/`status`/`title` continuam. Não usa a mensagem `"HTTPError"` como `detail`.
- Debug: `stack` continua sendo acrescentado por `errorResponse` como hoje (`src/response.ts:369`) e fica por último, depois do corpo, mesmo comportamento atual. `stack` não é membro RFC mas é extensão só em debug; documentado no risco R-04.
- **Alternativa descartada:** manter `statusText`/`unhandled`/`message` no corpo por compatibilidade — contraria a RFC e o RF-05 (corpo exato `{type,status,title}`).

### D-06 — Tabela de títulos mínima interna

- **Alternativas:** `http.STATUS_CODES` do Node (viola multi-runtime), `Response.statusText` (vazio em runtimes), tabela própria.
- **Escolha:** `Record<number, string>` pequeno em `internal/problem.ts` cobrindo os status comuns de erro (400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 507, 508, 511). Fora dela, `title` é omitido. Custo de bundle baixo, sem dependência de runtime.

### D-07 — Content-type `application/problem+json;charset=UTF-8` com headers do usuário vencendo

- **Escolha:** nova constante `problemHeaders` (`FrozenHeaders`, como `jsonHeaders`, `src/response.ts:270`) usada como base em `errorResponse`; o merge existente com `error.headers` e `errHeaders` (`:359-364`) é preservado, então o usuário só troca o content-type se o definir explicitamente (RF-07). Charset UTF-8 espelha `jsonHeaders`.
- **Alternativa:** sem charset (`application/problem+json`). Descartada: o PRD pede coerência com o framework; o teste usa `toMatch`/`startsWith`, compatível.

### D-08 — Sem propagação da marca em `new HTTPError(cause)`

- **Alternativas:** propagar a marca no construtor (lendo `details.cause["~problem"]`) vs. não propagar.
- **Escolha: não propagar.** O construtor só é usado em erros novos; `prepareResponse` reaproveita erros que já são `HTTPError` (`src/response.ts:147-148`), e `onError` também (`src/utils/middleware.ts:47-48`). Propagar exigiria alterar `HTTPError` (observável, fora de escopo). O comportamento “perde a marca ao embrulhar” é explícito e testado (seção 5), e documentado no risco R-01.

## 3. Arquivos a alterar

| Arquivo | Ponto de mudança | Mudança |
| --- | --- | --- |
| `src/utils/problem.ts` (novo) | — | `problem()`, `ProblemInput`. |
| `src/utils/internal/problem.ts` (novo) | — | `kProblem`, `getProblem()`, `problemBody()`, tabela de títulos. |
| `src/response.ts:2-8` | imports | importar `problemBody`/`getProblem`. |
| `src/response.ts:270-272` | `jsonHeaders` | adicionar `problemHeaders` ao lado. |
| `src/response.ts:358-380` | `errorResponse` | escolher base de headers e corpo conforme a marca. |
| `src/index.ts:70-72` | bloco `// Error` | exportar `problem` e `type ProblemInput`. |
| `test/unit/package.test.ts:104-105` | snapshot de exports | inserir `"problem"` entre `"parseCookies"` e `"proxy"` (ordem alfabética). |
| `test/problem.test.ts` (novo) | — | testes de integração (`describeMatrix`). |
| `test/unit/types.test-d.ts:35` | `describe("types")` | testes de tipo de `ProblemInput` (imports em `:1-10`). |
| `docs/1.guide/1.basics/6.error.md` | seção nova | (opcional, recomendado) documentar `problem()`; sem efeito em testes. |

Arquivos **não** alterados: `src/error.ts` (`HTTPError`, `ErrorBody`, `toJSON` — `:74`, `:30`, `:226`), `src/h3.ts`, `src/adapters.ts`, `src/utils/middleware.ts`, `src/rules/handlers/headers.ts:41` (inline de `isError`; a marca não interfere), `src/utils/json-rpc.ts:484` (usa `isError`/`unhandled`, independente).

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

/** Input of {@link problem}: `HTTPError` input plus RFC 9457 `type` and `instance`. */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference identifying the problem type. Defaults to `"about:blank"`. */
  type?: string;
  /** URI reference identifying this occurrence of the problem. */
  instance?: string;
}

/** Create an `HTTPError` rendered as `application/problem+json` (RFC 9457). */
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

`isolatedDeclarations` exige tipos explícitos nos exports; a `interface` acima atende. `ErrorInput` já tem `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled` e os depreciados (`src/error.ts:6-26`); `type: 123` não compila (RF-02).

```ts
// src/utils/internal/problem.ts (não exportado no pacote)
export const kProblem = "~problem";
export interface ProblemMark { type?: string; instance?: string; detail?: string }
export function markProblem(error: HTTPError, mark: ProblemMark): void; // defineProperty, enumerable:false
export function getProblem(error: HTTPError): ProblemMark | undefined;
export function problemBody(error: HTTPError, mark: ProblemMark): Record<string, unknown>;
```

Implementação de `problem()`:
`const { type, instance, ...rest } = input; const error = new HTTPError(rest); markProblem(error, { type, instance, detail: rest.message || undefined }); return error;` — `type`/`instance` são removidos antes de chegar ao `cause` do `HTTPError` (o construtor guarda o `details` em `cause`, `src/error.ts:196-197`), evitando duplicar o objeto de entrada.

Mudança em `errorResponse` (esboço):

```ts
const mark = getProblem(error);
let headers = error.headers
  ? mergeHeaders(mark ? problemHeaders : jsonHeaders, error.headers)
  : new Headers(mark ? problemHeaders : jsonHeaders);
// ... merge de errHeaders inalterado
JSON.stringify({ ...(mark ? problemBody(error, mark) : error.toJSON()), stack: ... }, undefined, debug ? 2 : undefined)
```

Sem marca, a expressão avaliada é idêntica à atual (RF-08).

## 5. Estratégia de testes

Ordem (Bug Fix Workflow do `AGENTS.md`): escrever primeiro o teste de regressão de RF-08 e confirmar que **passa antes** da mudança; depois os testes de `problem()` (falham sem a implementação), implementar e rodar tudo.

**`test/problem.test.ts`** com `describeMatrix` (padrão em `test/errors.test.ts:6`), cobrindo web e node:

- RF-01: `problem({status:404})` → `HTTPError.isError` e `status 404`.
- RF-02: preserva `status`, `message`, `headers`, `data`.
- RF-03: exemplo completo do PRD (corpo exato com `toEqual`); extensão `data` no nível raiz; colisão (`body: { title: "x", status: 1 }`) não sobrescreve membros padrão.
- RF-04: `content-type` começa com `application/problem+json`.
- RF-05: `problem({status:403})` → corpo exato `{type:"about:blank",status:403,title:"Forbidden"}`; `problem({})` → 500; texto do corpo bruto sem a string `undefined`/`null`; status sem frase conhecida → sem `title`.
- RF-06: rotas `throw` e `return` com status 409 → mesmos status, content-type e corpo.
- RF-07: `retry-after: 30` presente, `title` = `statusText` informado; `headers: { "content-type": "application/x-custom" }` sobrescreve; `errHeaders` do evento continuam sendo aplicados.
- RF-08: erro sem `problem()` mantém `application/json;charset=UTF-8` e corpo exato anterior (`status`, `message`, `data`, sem `type`/`title`/`detail`); também 404 de rota inexistente e `Error` comum.
- RF-09: `unhandled: true` com `message: "segredo"`/`data` → corpo sem esses valores, mantém `type/status/title`; modo debug (`new H3({ debug: true })`) inclui `stack`.
- Extras: `onError` configurado recebe o erro e a resposta continua `problem+json` (cobre `prepareResponse` aninhado, `src/response.ts:161-165`); `new HTTPError(problemErr)` perde a marca (documenta D-08); a marca não aparece em `JSON.stringify(err)` nem em `Object.keys(err)`.

**`test/unit/types.test-d.ts`**: `ProblemInput` aceita `{status, message, data, headers, type, instance}`; `// @ts-expect-error` para `type: 123` e `instance: 1`; `problem()` retorna `HTTPError`.

**Ajuste de teste existente:** só `test/unit/package.test.ts` (snapshot de exports, +`"problem"`), sem enfraquecer a verificação.

**Verificação final:** `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt `--check`; formatar os arquivos novos com `pnpm fmt`) e `pnpm typecheck` (`tsc --noEmit`, `package.json:54`).

## 6. Riscos

- **R-01 — Marca perdida em cópias:** `new HTTPError(problemErr)` não herda a marca (D-08). Mitigação: `prepareResponse`/`onError` reaproveitam `HTTPError`s existentes; comportamento testado e documentado.
- **R-02 — Regressão no formato atual:** `errorResponse` é o caminho de todos os erros. Mitigação: ramificação por marca com o ramo antigo literalmente inalterado; teste de RF-08 escrito e verde antes da implementação; suíte de `test/errors.test.ts` (`:44`, `:140` verificam o content-type atual) deve continuar passando sem ajuste.
- **R-03 — Snapshot de exports:** esquecer o `"problem"` quebra `test/unit/package.test.ts`; ordem alfabética (`parseCookies` < `problem` < `proxy`).
- **R-04 — Extensões vazando/colidindo:** `data`/`body` de erros tratados são públicos por desenho; a precedência dos membros padrão evita sobrescrita, mas `stack` em debug é extensão não padrão (igual ao comportamento atual). `unhandled` oculta tudo (RF-09).
- **R-05 — `title` ausente para status fora da tabela:** a RFC marca `title` como SHOULD; aceito pelo PRD. Mitigação: tabela cobre os status de erro usuais; `statusText` explícito sempre vence.
- **R-06 — Divergência web/node no content-type:** ambos passam por `FastResponse` com os mesmos headers; coberto pela matriz.
- **R-07 — Bundle/tree-shaking:** helper interno só é importado por `response.ts`; `problem.ts` só entra se importado. `rules/handlers/headers.ts` evita importar `error.ts` de propósito (`:38`) e não é afetado.
- **R-08 — Mensagem explícita igual à sintética:** `problem({ message: "HTTPError 404" })` gera `detail` com esse texto; aceito (explícita é explícita).
