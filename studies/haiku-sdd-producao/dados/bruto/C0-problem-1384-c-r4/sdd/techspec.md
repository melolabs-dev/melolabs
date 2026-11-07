# Especificação técnica — `problem(input)` (RFC 9457) por utilitário explícito

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-12).
Nenhum código do projeto é alterado por este documento.

## 1. Estado atual (conferido no código)

- `HTTPError` é definido em `src/error.ts:74`; o construtor está em `src/error.ts:162`. Ele normaliza `status` (`src/error.ts:172`, padrão 500), `statusText` (`src/error.ts:180`) e `message` (`src/error.ts:187`). Quando não há `message`, o `message` recebe `statusText`/`statusMessage` ou `"HTTPError <status> ..."` (`src/error.ts:191-193`). Por isso `error.message` sozinho não diz se a mensagem foi explícita.
- O input do construtor é guardado como `cause` (`src/error.ts:196-197`).
- `ErrorInput` está em `src/error.ts:6`. `HTTPError.isError` (`src/error.ts:129`) testa `instanceof Error`, `name === "HTTPError"` e `status > 99`.
- `HTTPError.toJSON()` (`src/error.ts:226`) gera o corpo legado. Esse corpo não pode mudar (RF-10).
- Todo erro é renderizado em um único ponto. `prepareResponse` (`src/response.ts:129`) trata `val instanceof Error` em `src/response.ts:146-174`. Ele reaproveita a instância se `HTTPError.isError` for verdadeiro (`src/response.ts:147-148`), chama `onError` (`src/response.ts:159-166`) e monta a resposta em `errorResponse(...)` (`src/response.ts:173`).
- `errorResponse` (`src/response.ts:358-380`) mescla `jsonHeaders` (`src/response.ts:270`), `error.headers` e `errHeaders` com `mergeHeaders` (`src/response.ts:243`). Em seguida serializa `{...error.toJSON(), stack}`.
- `toError` (`src/response.ts:73`) deixa passar qualquer `Error`. Uma instância `HTTPError` chega intacta a `prepareResponse`, e a mesma instância é entregue aos hooks `onError`.
- Há outros dois pontos que reaproveitam a instância:
  - O middleware `onError` (`src/utils/middleware.ts:37-63`) reaproveita `rawError` se `isError` for verdadeiro (`src/utils/middleware.ts:47-48`).
  - `handlerWithFetch` (`src/handler.ts:122-124`) usa `toResponse`/`toError`.
- Exports: `src/index.ts:68` (`toResponse`, `HTTPResponse`), `src/index.ts:72` (`HTTPError` e tipos) e o bloco de utils a partir de `src/index.ts:86` (ex.: Proxy em `src/index.ts:135-143`).
- O snapshot de exports está em `test/unit/package.test.ts:5-` (`proxy` em `:105`, `parseCookies` em `:104`). Ele falha com qualquer export novo e precisa de ajuste.
- Convenção: `response.ts` já tem 380 linhas e `error.ts` 237. A meta é < 200 LoC por arquivo, então a lógica nova vai para arquivos novos.

## 2. Decisões de arquitetura

### D-01 — Marca "problem" como propriedade interna não enumerável `~problem` na instância

- **Alternativas:**
  1. Subclasse `ProblemError`: viola a restrição de nomes públicos e muda `name`, que `isError` usa.
  2. `Symbol` registrado como chave: funcionaria, mas a convenção do projeto para propriedade privada/não enumerável é o prefixo `~` (AGENTS.md, Naming; premissa do PRD §4).
  3. Campo público novo em `HTTPError` (ex.: `problem: true`): vira API pública e muda `toJSON`/forma observável.
  4. Marca interna `~problem`: escolhida.
- **Escolha:** `Object.defineProperty(error, "~problem", { value: { type, instance, detail } })`, com `enumerable: false`, `writable: false` e `configurable: false`. Ela guarda o que o formato problem precisa e que o `HTTPError` não preserva: `type`, `instance` e `detail`, que é a `message` explícita.
- **Justificativa:**
  - Não altera `toJSON`, `Object.keys` nem `JSON.stringify(error)` (RF-10).
  - Não cria nome público.
  - Sobrevive às passagens por `toError`, `onError` (app e middleware) e `prepareResponse`, porque todas reaproveitam a mesma instância (ver §1).
  - O valor guardado é um objeto simples, sem classe, então funciona entre cópias do módulo.

### D-02 — `detail` é capturado em `problem()`, a partir de `input.message`, e não de `error.message`

- **Alternativas:**
  1. Comparar `error.message` com o texto gerado automaticamente (`"HTTPError 404"` etc.): frágil, porque `statusText` também vira `message` (`src/error.ts:191`).
  2. Sempre emitir `error.message` como `detail`: viola a premissa do PRD, pois `{status:404}` passaria a ter `detail: "HTTPError 404"`, e o critério de RF-04 exige que `detail` não exista nesse caso.
  3. Capturar `input.message` na criação: escolhida.
- **Escolha:** `detail = typeof input.message === "string" && input.message ? input.message : undefined`, guardado em `~problem`.
- **Justificativa:** é a única forma de distinguir "explícito" de "gerado" sem tocar no construtor. `statusText` sem `message` não vira `detail`; ele vira `title` (D-05).

### D-03 — Renderização em um helper interno, com um ramo mínimo em `errorResponse`

- **Alternativas:**
  1. Fazer `HTTPError.toJSON()` devolver o corpo problem quando marcado: muda `toJSON` (RF-10) e não resolve o `content-type`.
  2. Criar um segundo caminho paralelo em `prepareResponse`: duplica o tratamento de `errHeaders`/`onError`.
  3. Ramo em `errorResponse` (`src/response.ts:358`), delegando a montagem do corpo a `problemBody(error, debug)` em arquivo interno: escolhida.
- **Escolha:** `errorResponse` lê `error["~problem"]`. Se existir, o `content-type` é `application/problem+json;charset=UTF-8` e o corpo vem de `problemBody`. Se não existir, o código legado roda sem nenhuma alteração.
- **Justificativa:**
  - `errorResponse` é o único ponto onde todo erro vira `Response`. Isso cobre handler, middleware, retorno de valor e `onError` (RF-11).
  - A diferença em `response.ts` fica em poucas linhas.
  - Aplicar o ramo só quando a marca existe garante RF-10.

### D-04 — Onde ficam os arquivos novos

- **Alternativas:**
  1. Tudo em `src/error.ts`: estoura a meta de tamanho e mistura erro com utilitário.
  2. Tudo em `src/utils/problem.ts`, incluindo a tabela de frases: o arquivo público passa a carregar internals.
  3. `src/utils/problem.ts` (API pública: `problem`, `ProblemInput`) e `src/utils/internal/problem.ts` (`kProblem`, `problemBody`, tabela de frases): escolhida.
- **Escolha:** a divisão acima. `utils/internal/` não é exportado (AGENTS.md) e mantém a regra de "helpers internos em `utils/internal/`".
- **Justificativa:** respeita "sem barrel files" e as importações diretas com `.ts`. O `response.ts` importa apenas `problemBody` e a chave do helper interno. Não há dependência circular nova: `utils/problem.ts` importa `error.ts`, e `response.ts` já importa `error.ts`.

### D-05 — Regras do corpo (`problemBody`)

- **Alternativas para `title`:**
  1. Sempre a frase padrão.
  2. `statusText` quando informado, senão a frase padrão: escolhida (PRD RF-04).
  3. Usar `message` como `title`: contraria a RFC, que reserva `detail` para a mensagem.
- **Escolha (ordem de inserção no objeto):**
  - `type`: `~problem.type ?? "about:blank"`.
  - `status`: `error.status`. Isso satisfaz RF-05, já que `HTTPError` já normalizou o status (`src/error.ts:172`).
  - `title`: `error.statusText ?? PHRASES[error.status]`. Sem frase conhecida, o membro é omitido (via `undefined`, removido pelo `JSON.stringify`).
  - `detail` e `instance`: os valores guardados.
- **Extensões (RF-06):**
  - Para as chaves de `error.body` que não sejam membros padrão (`type`, `status`, `title`, `detail`, `instance`), emite-se `...body` filtrado.
  - `data` sai em `data`. A ordem legada é mantida: `data` primeiro e depois as chaves de `body`, de modo que uma chave `data` em `body` sobrescreve o membro `data`, como no `toJSON` atual (`src/error.ts:233-234`).
  - Os membros padrão são escritos por último, ou as chaves reservadas são filtradas, para que uma extensão nunca os sobrescreva.
- **`stack` (RF-09):** `debug && error.stack ? error.stack.split("\n").map(l => l.trim()) : undefined`, como em `src/response.ts:369`. É escrito depois das extensões.
- **`unhandled` (RF-07):** com `error.unhandled` verdadeiro, o corpo tem `type`, `status` e `title`, este último só com a frase padrão. Não há `detail`, `instance`, `data` nem extensões.
  - `instance` também é omitido. É o comportamento conservador, igual ao do `toJSON` (que oculta tudo o que o chamador informou), e o PRD enumera `detail`, `data` e extensões como os campos que não vazam. **Ponto de atenção:** se o PRD pretender manter `instance`, é só tirá-lo do ramo `unhandled`. Decisão registrada aqui para revisão.
  - A mesma regra vale no modo `debug`: `stack` só entra se o erro for tratado de acordo com a regra legada. Hoje o legado inclui `stack` em `debug` mesmo para `unhandled` (`src/response.ts:369`), e a spec mantém essa regra por RF-09.
- **Justificativa:** reproduz a semântica de hoje (`toJSON` + `stack`), mapeando-a para os membros da RFC 9457. `statusText` e `unhandled` não aparecem no corpo.

### D-06 — Tabela de frases HTTP enxuta e interna

- **Alternativas:**
  1. Importar uma tabela de runtime (`node:http`.`STATUS_CODES`): quebra a portabilidade (Workers, browsers).
  2. Tabela completa de todos os códigos IANA: aumenta o bundle sem necessidade.
  3. Objeto literal `Record<number, string>` com os códigos comuns (400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 507, 508, 511 e os 2xx/3xx mais usados): escolhida.
- **Escolha:** a opção 3, em `src/utils/internal/problem.ts`, com anotação `/* @__PURE__ */` onde couber.
- **Justificativa:** é independente de runtime e mantém o bundle pequeno. Código ausente da tabela resulta em `title` omitido, que a RFC permite.

### D-07 — Cabeçalhos: `content-type` forçado depois da mesclagem

- **Alternativas:**
  1. Partir de `problemHeaders` congelado e mesclar `error.headers`: o `content-type` do usuário o sobrescreveria, contra RF-08.
  2. Mesclar tudo como hoje (partindo de um `Headers` com o content-type) e fazer `headers.set("content-type", ...)` por último: escolhida.
- **Escolha:** no ramo problem de `errorResponse`, depois de `mergeHeaders(..., error.headers)` e `mergeHeaders(..., errHeaders)` (linhas `src/response.ts:359-364`), chama-se `headers.set("content-type", "application/problem+json;charset=UTF-8")`.
- **Justificativa:** cumpre "sempre `application/problem+json`" mesmo se `errHeaders` (`event.res.errHeaders`) trouxer outro `content-type`. Os demais cabeçalhos, incluindo `set-cookie` por `append`, continuam funcionando como hoje.

### D-08 — Assinatura pública e tipo de entrada

- **Alternativas:**
  1. `problem(input: ErrorInput & { type?: string; instance?: string })` com tipo anônimo: obriga a repetir o tipo e o export do tipo fica ausente (PRD pede o tipo exportado).
  2. `interface ProblemInput<DataT = unknown> extends ErrorInput<DataT>`: escolhida.
  3. Tipo literal restrito apenas aos campos da RFC: perde `headers`, `cause`, etc. (RF-02).
- **Escolha:** o nome `ProblemInput` para o tipo (nome único, sem conflito com os exports existentes). Ver contratos em §4.
- **Justificativa:** herdar de `ErrorInput` dá, de graça, todos os campos exigidos por RF-02, incluindo os descontinuados `statusCode`/`statusMessage`. `type?: string` e `instance?: string` fazem o compilador rejeitar valores não string. `isolatedDeclarations` exige o retorno anotado explicitamente.

### D-09 — Sem herança da marca ao reembrulhar o erro

- **Alternativas:**
  1. Fazer o construtor de `HTTPError` copiar `~problem` quando o `cause` tiver a marca: altera `HTTPError`, contra RF-10 e a restrição "não mudar a semântica de `HTTPError`".
  2. Não herdar; a marca vale apenas para a própria instância: escolhida.
- **Escolha:** a opção 2. Os caminhos do h3 não recriam um `HTTPError` já válido, pois `isError` é verdadeiro em `src/response.ts:147`, em `src/utils/middleware.ts:47` e em `toError` (`src/response.ts:74`). O risco de "perda da marca" (PRD §4) só ocorre se o usuário embrulhar o erro manualmente, e isso será documentado nos testes.
- **Justificativa:** mantém o contrato mínimo. A marca é preservada por onde o h3 passa, e é isso que RF-11 testa.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/problem.ts` (novo) | `problem()` e `ProblemInput`. |
| `src/utils/internal/problem.ts` (novo) | Chave `"~problem"`, tipo da marca, `problemBody()`, tabela de frases. |
| `src/response.ts:358-380` | Ramo problem em `errorResponse`; importar o helper interno junto aos imports de `src/response.ts:1-8`. |
| `src/index.ts` | Nova seção `// Problem` perto de `src/index.ts:135-143` (Proxy) ou de `src/index.ts:112` (Response utils), exportando `problem` e `type ProblemInput` de `./utils/problem.ts`. |
| `test/unit/package.test.ts:104-105` | Inserir `"problem"` no snapshot, entre `"parseCookies"` e `"proxy"` (ordem alfabética). É o único ajuste em teste existente; ele não enfraquece nenhuma asserção. |
| `test/problem.test.ts` (novo) | Testes de integração (ver §5). |
| `test/unit/types.test-d.ts:35` | Novo bloco `describe("problem")` para a entrada. |
| `docs/1.guide/1.basics/6.error.md` | Seção curta sobre `problem` (opcional; "documentação além do necessário" está fora de escopo). |

Não se altera: `src/error.ts`, `src/handler.ts`, `src/utils/middleware.ts`. O fluxo existente já preserva a instância.

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import type { ErrorInput } from "../error.ts";
import { HTTPError } from "../error.ts";

/**
 * Input of {@link problem}: everything accepted by `HTTPError`, plus RFC 9457 `type` and `instance`.
 */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference identifying the problem type (RFC 9457 §3.1.1). Defaults to `"about:blank"`. */
  type?: string;
  /** URI reference identifying this occurrence of the problem (RFC 9457 §3.1.5). */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

```ts
// src/utils/internal/problem.ts
export const kProblem = "~problem"; // chave (string, convenção ~)

export interface ProblemMark {
  type?: string;
  instance?: string;
  detail?: string;
}

export function problemBody(
  error: HTTPError & { [kProblem]?: ProblemMark },
  debug?: boolean,
): Record<string, unknown>;
```

Comportamento de `problem()`: `const error = new HTTPError(input)`. Depois define `~problem` com `Object.defineProperty` (não enumerável) e devolve `error`.

Exemplos de saída (contrato de resposta):

- `problem({ status: 404 })` → `404`, `application/problem+json;charset=UTF-8`, `{"type":"about:blank","status":404,"title":"Not Found"}`.
- `problem({ status: 422, statusText: "Entidade inválida", message: "O campo email é obrigatório", type: "https://example.com/probs/validacao", instance: "/cadastro" })` → corpo com exatamente `type`, `status: 422`, `title`, `detail`, `instance`.
- `problem({ message: "falha" })` → status 500 e `body.status === 500`.
- `problem({ status: 400, body: { errors: ["a"], status: 999 }, data: { campo: "email" } })` → `errors` na raiz, `data: { campo: "email" }` e `status: 400`.

## 5. Estratégia de testes

Seguir o fluxo do AGENTS.md: escrever os testes primeiro, confirmar que falham (a falha é a ausência do export `problem`) e então implementar.

**`test/problem.test.ts`**, com `describeMatrix` (modos `web` e `node`), no padrão de `test/errors.test.ts:6`:

- RF-01: `problem` importável de `../src/index.ts`; `HTTPError.isError(problem({...}))` verdadeiro; `throw` produz o status 404.
- RF-03/04: `content-type` começa com `application/problem+json`; `title` padrão; ausência de `detail` e `instance` em `{status:404}`; caso completo do 422 com `toEqual` nas chaves exatas.
- RF-05: sem `status` → 500 com `body.status === 500`; também `statusCode` descontinuado.
- RF-06: extensões na raiz, `data` sob `data`, e `body: { status: 999, type: "x" }` sem sobrescrever os membros padrão.
- RF-07: `unhandled: true` não vaza `segredo`, `data` nem `x`; mantém `type`, `status`, `title`.
- RF-08: `www-authenticate` preservado; `headers: { "content-type": "text/plain" }` ignorado; `event.res.errHeaders` mesclado, inclusive um `content-type` vindo dele.
- RF-09: com `debug: true` há `stack` (array); sem `debug`, não há.
- RF-10 (regressão): `new HTTPError({...})` e `HTTPError.status(...)` continuam com `application/json`; `new HTTPError({status:404}).toJSON()` inalterado; o corpo de um erro comum no mesmo app que usa `problem` em outra rota não muda.
- RF-11: `problem({status:409})` lançado em handler, lançado em middleware (`t.app.use`), retornado por outro handler, lançado dentro de um hook `onError` do app e de `onError` (middleware): mesmas respostas, status 409 e mesmo corpo.
- Marca ao passar por `onError(error)` que devolve `undefined` e relança, e por `config.onError`; erros comuns continuam JSON.
- HEAD: resposta sem corpo, com `content-type` problem (caminho já coberto por `FastResponse`; ver risco R-05).

**Testes de tipos** (`test/unit/types.test-d.ts`, estilo `expectTypeOf`/`@ts-expect-error`):

- A chamada completa do RF-02 compila.
- `// @ts-expect-error` para `type: 1` e `instance: {}`.
- `problem<{ a: number }>({ data: { a: 1 } })` retorna `HTTPError<{ a: number }>`.

**Testes existentes afetados:** apenas `test/unit/package.test.ts` (snapshot de exports). Executar a suíte completa em `pnpm vitest run` e depois `pnpm lint`, `pnpm typecheck` e `pnpm test`.

## 6. Riscos

- **R-01 — Perda da marca por reembrulho manual** (ver D-09): quem fizer `new HTTPError({ cause: problem(...) })` obtém uma resposta JSON legada. Mitigação: o h3 nunca recria um `HTTPError` válido (`src/response.ts:147`, `src/utils/middleware.ts:47`); teste de RF-11 cobre toda a cadeia.
- **R-02 — Vazamento em `unhandled`:** mitigado em `problemBody` (D-05) e testado. O ponto de atenção sobre `instance` e o `stack` em `debug` está descrito em D-05.
- **R-03 — Colisão de extensões:** mitigada com chaves reservadas e testes (D-05).
- **R-04 — Snapshot de exports** (`test/unit/package.test.ts`): ajuste obrigatório e mínimo. Exportar qualquer outro nome faria o snapshot falhar de propósito, o que também protege a restrição de nomes públicos.
- **R-05 — Respostas sem corpo:** `errorResponse` não trata HEAD ou 204 de forma especial (isso é feito depois, em `prepareResponse`, quando o val é `Response`: `src/response.ts:234`). O comportamento do ramo problem é o mesmo do legado; o teste de HEAD confirma.
- **R-06 — Tamanho de `response.ts`** (já 380 linhas): mitigado levando a lógica para `utils/internal/problem.ts` e deixando só o ramo.
- **R-07 — `toJSON` usado por terceiros:** `JSON.stringify(error)` de um `problem()` retorna o corpo legado, e não o problem. É intencional (RF-10), mas fica documentado.
- **R-08 — Segurança do `content-type`:** não há entrada do usuário no valor. `type` e `instance` só vão no corpo JSON, serializado por `JSON.stringify`, sem risco de injeção de cabeçalho.
- **R-09 — `isolatedDeclarations`:** `problem`, `ProblemInput` e as constantes exportadas precisam de tipos explícitos, ou `pnpm typecheck` falha.
