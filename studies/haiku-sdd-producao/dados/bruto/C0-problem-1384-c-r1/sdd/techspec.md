# Techspec — `problem()` (RFC 9457) no h3

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C), `sdd/prd.md` (RF-01…RF-08).
Todas as citações `arquivo:linha` foram conferidas no código atual (commit `16c3209`).

## 1. Visão geral

`problem(input)` constrói um `HTTPError` comum e o marca com uma propriedade privada e não enumerável (`~problem`) que guarda os membros RFC 9457 já calculados. O único ponto que muda é `errorResponse` (`src/response.ts:358`): se o erro tem a marca, serializa como `application/problem+json`; senão, segue o caminho atual, byte a byte. `toJSON()` não muda.

Fluxo: `problem()` → `throw`/`return` → `prepareResponse` (`src/response.ts:146-173`, inclui `onError`) → `errorResponse` → `Response`.

## 2. Decisões de arquitetura

### D-01 — Como o erro carrega o formato problem: propriedade `~problem` não enumerável em um `HTTPError` comum

- **Alternativas**:
  1. Nova subclasse `ProblemError` — viola a restrição (nenhum nome público novo) e o PRD (sem novas classes).
  2. Detectar pelo `body`/`headers` (ex.: `content-type: application/problem+json` em `error.headers`) — frágil: o chamador pode definir `content-type` (RF-04) e `body` é do usuário.
  3. `WeakSet<HTTPError>` interno — não sobrevive a cópias/contextos de módulo duplicados, e `HTTPError.isError` existe justamente por causa de contextos diferentes (`src/error.ts:121-133`).
  4. **Propriedade `~problem` não enumerável via `Object.defineProperty`.**
- **Escolha**: 4. A convenção do projeto reserva o prefixo `~` para propriedades privadas e não enumeráveis (AGENTS.md, "Naming"). Não enumerável mantém o objeto fora de `JSON.stringify(error)`, de `toJSON()` e de logs. `HTTPError` continua com a mesma forma pública; nenhum tipo novo é exportado por causa da marca.

### D-02 — Onde serializar: em `errorResponse`, não em `toJSON()`

- **Alternativas**: (a) alterar `toJSON()` — quebra RF-06 e consumidores como hooks/logs; (b) retornar um `Response` pronto de `problem()` — não seria `HTTPError` (RF-01 exige `instanceof`) e `onError` não receberia o erro (RF-07); (c) **ramificar em `errorResponse`**.
- **Escolha**: (c). `errorResponse` já é o único ponto que transforma `HTTPError` em `Response` (chamado em `src/response.ts:173`), depois de `onError` (`:161-165`). Assim middleware (`src/utils/middleware.ts:37-63`), handlers assíncronos e o modo `web`/`node` passam pelo mesmo caminho (RF-07) sem tocar em adaptadores.

### D-03 — Os membros são calculados em `problem()` a partir da entrada crua

- **Problema detectado**: o construtor aplica `sanitizeStatusMessage` ao `statusText` (`src/error.ts:180-185`, `src/utils/sanitize.ts:3,10`), que remove tudo fora de ASCII visível. `statusText: "Não encontrado"` (exemplo do RF-03) viraria `"No encontrado"` em `error.statusText`. Além disso `error.message` cai para `statusText` ou `"HTTPError <status> <texto>"` quando não há mensagem (`src/error.ts:187-193`), então não dá para saber depois se `message` foi explícito.
- **Alternativas**: (a) derivar `title`/`detail` de `error.statusText`/`error.message` em `errorResponse` — perde acentos e confunde `detail` implícito com explícito; (b) **capturar `input.statusText` e `input.message` crus em `problem()`** e guardá-los na marca.
- **Escolha**: (b). `title` = `input.statusText` cru, não vazio após `trim`; senão texto de razão padrão (D-05). `detail` = `input.message` só se for string não vazia. O header HTTP `statusText` continua sanitizado (comportamento atual do `HTTPError`); o corpo JSON (UTF-8) preserva acentos.
- Também considerar `statusCode`/`statusMessage` (depreciados, `src/error.ts:17-26`): `problem()` aceita-os via `ErrorInput`, mas o `title` usa `statusText ?? statusMessage` crus. `status` do corpo = `error.status` já sanitizado (`src/error.ts:172-178`), garantindo igualdade com o status HTTP (RF-04).

### D-04 — Montagem do corpo e precedência de chaves

Ordem de montagem em `errorResponse` (membros padrão por último, logo prevalecem — risco de colisão do PRD §4):

```
{ ...(unhandled ? undefined : extensions /* input.body */),
  data: unhandled ? undefined : error.data,
  stack: debug ? [...] : undefined,
  type, title, status, detail?, instance? }
```

- `type` = `input.type` ou `"about:blank"`; `instance` só se informado; `detail` só se explícito e `!unhandled`.
- `data` fica sob a chave `data` (RF-03), omitido se `undefined` (JSON.stringify já descarta `undefined`). Se `body.data` existir, o `data` explícito prevalece quando definido; documentar.
- Com `unhandled: true` (`src/error.ts:205-206`): somente `type`, `title`, `status` (RF-05). `instance` também é omitido por prudência? **Não**: `instance` identifica a ocorrência e não é segredo, mas o PRD diz "apenas type, title, status"; seguimos o PRD e omitimos `instance` e `stack` de erros `unhandled` sem `debug`. Em `debug` o `stack` continua exposto como hoje (`src/response.ts:369`).
- **Alternativa rejeitada**: reaproveitar `error.toJSON()` e renomear chaves — carregaria `statusText`, `unhandled` e `message`, que não pertencem ao formato.

### D-05 — Texto de razão padrão: tabela interna mínima

- **Alternativas**: `http.STATUS_CODES` (Node-only, viola "web standards first"); `new Response(null,{status}).statusText` (vazio em Node/undici e em Workers); **tabela estática interna**. O repositório não tem tabela (busca em `src/` sem resultados).
- **Escolha**: `src/utils/internal/status-text.ts` com `Record<number,string>` dos códigos IANA comuns (4xx/5xx e 2xx/3xx usuais) e `getStatusText(status): string | undefined`. Fallback determinístico final: `"Error"`... melhor `undefined` omitindo `title`? A RFC permite omitir `title`, mas o PRD manda derivar sempre; usamos `"Unknown Error"` para status fora da tabela. Fica dentro do limite de < 200 LoC.

### D-06 — Não sobrescrever `content-type` do chamador (RF-04)

- `errorResponse` hoje parte de `jsonHeaders` (`src/response.ts:270`) e faz `mergeHeaders` com `error.headers` (`:359-361`), então um `content-type` do usuário já vence. Para problem, a base será `{"content-type": "application/problem+json;charset=UTF-8"}` (novo `FrozenHeaders` local, ao lado de `jsonHeaders`) mantendo o mesmo merge. `errHeaders` (`:362-364`) continua sendo mesclado depois, como hoje.
- Alternativa: omitir `;charset=UTF-8`. Rejeitada: `jsonHeaders` já o inclui; manter paridade. Testes usam `toMatch`/`startsWith`.

### D-07 — Superfície pública e tipo da entrada

- Exportar `problem` e `ProblemInput` — o tipo da entrada (única adição além da função). Em `src/index.ts:72` (bloco `// Error`) acrescentar `export { problem, type ProblemInput } from "./utils/problem.ts"`.
- `ProblemInput` estende `ErrorInput` (`src/error.ts:6`), adicionando `type?: string; instance?: string`. Como `ErrorInput` é `interface` fechada, campos desconhecidos já falham no literal (RF-02). Nome final do tipo: `ProblemInput` (uma alternativa, `ProblemDetailsInput`, é mais longa sem ganho).
- **Rejeitado**: sobrecarga `problem(message, details)` — o pedido define só `problem(input)`.
- `problem` fica em `src/utils/problem.ts` (utilitários públicos são arquivos em `src/utils/`, AGENTS.md) para não inflar `error.ts`; a lógica de serialização fica em `src/utils/internal/problem.ts` (`problemBody`) importada por `response.ts`, mantendo helpers internos fora dos exports públicos. Atenção a ciclos: `utils/problem.ts` importa `error.ts`; `response.ts` já importa `error.ts` (`src/response.ts:2`), e o helper interno não importa `response.ts`.
- `h3/rules`: `src/rules/handlers/headers.ts:38-42` inlina `isError` por tamanho de bundle; não é afetado, pois a marca é só leitura em `errorResponse`.

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Mudança |
| --- | --- | --- |
| `src/utils/problem.ts` (novo) | — | `problem()`, `ProblemInput`. |
| `src/utils/internal/problem.ts` (novo) | — | `kProblem = "~problem"`, tipo `ProblemMeta`, `problemBody(error, debug)`. |
| `src/utils/internal/status-text.ts` (novo) | — | tabela e `getStatusText`. |
| `src/index.ts` | `:72` | export de `problem` e `ProblemInput`. |
| `src/response.ts` | `:270` (junto a `jsonHeaders`), `:358-380` (`errorResponse`) | header base problem; ramo `if (error["~problem"])` com `JSON.stringify(problemBody(...))`. Chamada em `:173` não muda. |
| `docs/1.guide/1.basics/6.error.md` | após `:60`/antes de `:78` | nova seção "Problem Details (RFC 9457)" com exemplo, mapeamento de campos e nota de precedência. |
| `test/problem.test.ts` (novo) | — | integração, `describeMatrix` (como `test/errors.test.ts:4-6`). |
| `test/unit/types.test-d.ts` | fim do arquivo / novo `describe` (padrão em `:35`, `:471`) | testes de tipos de `ProblemInput`. |

Não alterar: `src/error.ts` (nenhuma mudança necessária: `toJSON` em `:226-236` e o construtor ficam intactos), `src/h3.ts`, `src/adapters.ts`, `src/utils/middleware.ts`, `src/rules/**`.

Testes existentes: `test/errors.test.ts:44` e `:140` verificam `application/json` para `HTTPError` comum — **não mudam** (RF-06) e servem de regressão. Nenhum ajuste previsto; se a suíte revelar dependência, ajustar sem perder asserção.

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI de referência que identifica o tipo do problema (padrão: "about:blank"). */
  type?: string;
  /** URI de referência que identifica esta ocorrência. */
  instance?: string;
}

export function problem<DataT = unknown>(input?: ProblemInput<DataT>): HTTPError<DataT>;
```

`ErrorInput<DataT>` exige que `ProblemInput` seja genérico por causa de `data` (`src/error.ts:6`); `HTTPError<DataT>` mantém a inferência. `isolatedDeclarations` exige anotar tipos de retorno explicitamente.

```ts
// src/utils/internal/problem.ts
export const kProblem = "~problem";
export interface ProblemMeta { type: string; title: string; detail?: string; instance?: string }
export function problemBody(error: HTTPError, meta: ProblemMeta, debug?: boolean): Record<string, unknown>;
```

Implementação de `problem()`:

```ts
const error = new HTTPError(input as ErrorInput);          // reutiliza status/headers/unhandled/data/body
Object.defineProperty(error, kProblem, { value: meta, enumerable: false });
```

`meta` usa `input.statusText ?? input.statusMessage` e `input.message` crus (D-03). `problem()` sem argumento (`problem()`) deve funcionar: status 500, `type: "about:blank"`. Cuidado: `new HTTPError(input)` com `input` indefinido cai no ramo `details` indefinido, já suportado (`src/error.ts:165-170`).

Resposta resultante (RF-03): status HTTP = `error.status`; `content-type: application/problem+json;charset=UTF-8`; corpo JSON descrito em D-04.

## 5. Estratégia de testes

Seguindo o fluxo de correção do AGENTS.md: escrever os testes primeiro e confirmar que **falham** sem `problem` (RF-08); depois implementar.

`test/problem.test.ts` com `describeMatrix` (web + node):
- **RF-01**: `problem({status:404})` é `instanceof HTTPError` e `HTTPError.isError`; status 404 lançando e retornando.
- **RF-03**: exemplo completo do PRD (inclui `statusText: "Não encontrado"` com acento → `title` intacto; prova D-03) comparando o JSON com `toEqual`.
- **RF-04**: 422 com `x-request-id`; `content-type` começa com `application/problem+json`; `content-type` custom no `headers` prevalece.
- **RF-05**: `problem({})`/só `status`; `unhandled: true` oculta `detail`, `data`, extensões, `instance`; o corpo não contém `segredo`.
- **Defaults**: `title` derivado do status (404 → "Not Found"; status fora da tabela → fallback), `detail` ausente sem `message` explícito (não vaza `"HTTPError 500"`).
- **Colisão**: `body: { status: 1, title: "x" }` não sobrescreve membros padrão.
- **RF-06**: `new HTTPError({status:400,message:"ruim",data:{a:1}})` continua `application/json;charset=UTF-8` com `status`, `message`, `data`; `toJSON()` de um erro de `problem()` igual ao de um `HTTPError` equivalente (sem `type`/`title`).
- **RF-07**: `onError` global (`onError` de `src/utils/middleware.ts:37`) e `config.onError` (`src/response.ts:161`) recebem a instância; handler assíncrono e middleware lançando `problem({status:409})` → 409 problem+json nos dois modos; `onError` que devolve `Response` própria substitui o resultado.
- **HEAD** e `debug: true` (stack como extensão, indentação) como casos extras.

`test/unit/types.test-d.ts`: `expectTypeOf(problem).returns.toEqualTypeOf<HTTPError<unknown>>()`; chamada válida do RF-02 compila; `// @ts-expect-error` para campo desconhecido e para `type: 42`; `ProblemInput` estende `ErrorInput`.

Verificação final: `pnpm vitest run test/problem.test.ts test/errors.test.ts`, depois `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| Perda de acentos em `title` por `sanitizeStatusMessage` | D-03: usar `statusText` cru; teste com acento. |
| `detail` vazando mensagem sintética (`"HTTPError 500"`) ou segredo em `unhandled` | `detail` só de `message` explícito e `!unhandled`; testes dedicados. |
| Colisão de chaves de `body`/`data` com membros padrão | Membros padrão por último (D-04); documentar. |
| Marca perdida se o erro for clonado/reembrulhado (ex.: `new HTTPError({cause: err})` em `src/utils/body.ts:70`, `validate.ts:123`) | Comportamento aceito: o construtor só herda `status`/`headers`/`unhandled` do `cause` (`src/error.ts:172-206`), não a marca; documentar que `problem()` deve ser lançado diretamente. |
| Regressão em `HTTPError` comum | Ramo novo só com marca; `errors.test.ts` e demais testes existentes como guarda. |
| Tabela de status incompleta | Fallback determinístico; teste de status fora da tabela. |
| Ciclo de imports ou bundle maior no core | Helper interno sem import de `response.ts`; tabela pequena; checar `pnpm build`. |
| Paridade de runtimes | `describeMatrix`; sem APIs específicas de runtime. |
| `data` em `debug`: `stack` mapeado como extensão | Mesmo comportamento atual de `errorResponse`; coberto por teste. |

## 7. Pendências em aberto

- Confirmar na revisão se `instance` deve aparecer em erros `unhandled` (a spec omite, seguindo RF-05 literalmente).
- Conjunto exato de códigos na tabela de status (D-05) é decisão de implementação.
