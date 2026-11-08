# Especificação técnica — Problem details (RFC 9457) por `problem()`

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C), `sdd/prd.md` (RF-01 a RF-10).
Código lido em `master` (commit `3db3b88`). Todas as citações `arquivo:linha` foram conferidas nesta leitura.

## 1. Resumo

Um utilitário `problem(input)` exportado por `h3` cria um `HTTPError` marcado. Só esse erro é respondido como `application/problem+json`. A marca é um símbolo interno gravado no próprio erro. A renderização entra num único ponto existente, `errorResponse`. O resto do fluxo de erro (`onError`, `errHeaders`, `toJSON`, `isError`) não muda.

---

## 2. Decisões de arquitetura

### D-01 — Marca interna do erro criado por `problem`

**Escolha.** Um símbolo `kProblem = Symbol.for("h3.problem")`, gravado com `Object.defineProperty` como propriedade **não enumerável** do próprio `HTTPError`. A leitura acontece só sobre o erro recebido, nunca sobre `cause`.

**Alternativas consideradas.**
- *Subclasse* `HTTPProblemError extends HTTPError`. Descartada: exigiria exportar outro nome ou deixar uma classe pública sem uso direto, o que a PRD proíbe (RF-01, "nenhum outro nome público novo"). Também mudaria `instanceof` para quem recebe o erro.
- *Campo público* (`problem`, `type`, `instance`) em `HTTPError`. Descartado: cria API pública nova em `src/error.ts`, e a propriedade apareceria em qualquer leitura por chaves.
- *`WeakSet` de instâncias*. Descartado: não atravessa cópias duplicadas do módulo `h3`. O `Symbol.for` atravessa, como já acontece com `kHTTPResponse` (`src/response.ts:94`).
- *Símbolo sem registro (`Symbol()`)*. Descartado: duas cópias do pacote não reconhecem a marca uma da outra.

O `Symbol.for` também não pode vir de JSON. O comentário de `src/response.ts:88-93` já usa esse argumento para `kHTTPResponse`, e vale aqui pelo mesmo motivo.

### D-02 — Onde ficam `type` e `instance`

**Escolha.** Os dois valores ficam dentro do payload da marca (`ProblemMeta`), não como campos de `HTTPError`. Assim a superfície pública de `HTTPError` não muda.

**Alternativa descartada.** Estender `ErrorBody` com `type` e `instance`. Isso alteraria `HTTPError` para todos os usuários, contra RF-07.

### D-03 — A marca não é herdada via `cause`

**Escolha.** Só o erro lançado diretamente tem a marca. `new HTTPError({ cause: problem(...) })` e `new HTTPError(erro)` continuam no formato atual.

**Motivo.** O construtor herda `status`, `statusText`, `headers` e `unhandled` do `cause` (`src/error.ts:172-206`). Esses campos são dados. A marca muda o *formato* da resposta. Se ela fosse herdada, um app que só embrulhou um erro veria o formato trocar sem ter pedido. RF-07 e o risco "Marca em `cause`" da PRD exigem essa separação.

**Consequência.** `src/response.ts:148` (`new HTTPError(val)` para erros que não são `HTTPError`) nunca produz marca, o que é o comportamento desejado.

### D-04 — Divisão em módulos

**Escolha.**
- `src/utils/problem.ts` (novo, público): `ProblemInput` e `problem()`.
- `src/utils/internal/problem-body.ts` (novo, interno): `kProblem`, `setProblem`, `getProblem`, `PROBLEM_CONTENT_TYPE`, `toProblemBody`.
- `src/utils/internal/status-text.ts` (novo, interno): `defaultStatusText`.
- `src/error.ts`: **não muda**.

Dependências: `utils/problem.ts` → `utils/internal/problem-body.ts` → `error.ts` (só tipo). `response.ts` → `utils/internal/problem-body.ts`. Não há ciclo.

**Alternativa descartada.** Colocar a lógica em `src/error.ts`. Esse arquivo já tem 237 linhas, acima da meta de 200 do projeto (`AGENTS.md`, "Short files"), e o PRD (Riscos, "Tamanho de arquivo") pede módulo próprio.

### D-05 — Renderização dentro de `errorResponse`

**Escolha.** Ramificar dentro de `errorResponse` (`src/response.ts:358-380`), que já é o único ponto que monta a resposta de erro. Cabeçalhos e stack continuam na mesma função.

**Alternativa descartada.** Uma `problemResponse` separada chamada por `prepareResponse`. Ela duplicaria a mescla de `errHeaders` e o tratamento de `stack`. Além disso, `prepareResponse` limpa `kEventRes` antes de chamar `errorResponse` (`src/response.ts:172-173`). Qualquer desvio desse fluxo ameaça o comportamento de `errHeaders` que os testes já cobrem (`test/errors.test.ts:202-221`).

### D-06 — `Content-Type` é fixado por último

**Escolha.** Ordem de montagem: base `problemHeaders` → `error.headers` → `errHeaders` → `set("content-type", "application/problem+json")`. Com isso, nem `headers` do erro (RF-06) nem `event.res.errHeaders` trocam o tipo.

**Alternativa descartada.** Manter a ordem atual, em que `error.headers` sobrescreve o padrão (`src/response.ts:360`). Isso viola RF-06.

**Consequência.** Para erros comuns nada muda, porque a ramificação só vale quando há marca.

### D-07 — Montagem do corpo e precedência dos membros

**Escolha.** O corpo é montado como `{ ...extensões, ...membrosReservados }`:
- `extensões`: `error.body` espalhado no topo, e `data` como membro `data` quando definido. Vazio quando `unhandled`.
- `membrosReservados`: `type`, `title`, `status`, `detail` e `instance` (este só quando informado). São aplicados por último, então nenhuma extensão os sobrescreve (RF-04).
- `stack`: só em modo `debug`, com a mesma regra de `src/response.ts:369`.

**Alternativa descartada.** Reaproveitar `error.toJSON()`. Ele espalha `...this.body` por último (`src/error.ts:234`). Um `body: { status: 200 }` sobrescreveria `status` ali. É exatamente o que RF-04 proíbe. Não se altera `toJSON` porque está fora do escopo da PRD.

### D-08 — `title`, `type` e tabela de frases

**Escolha.**
- `type`: `input.type` ou `"about:blank"` (RF-03).
- `title`: `error.statusText`, ou `defaultStatusText(status)`, ou `"HTTPError"` quando o código não tem frase registrada. O último fallback segue o padrão de nome já usado em `src/error.ts:193`.
- Tabela de frases em `src/utils/internal/status-text.ts`, com as frases registradas no IANA. Mantida dentro do projeto.

**Alternativas descartadas.**
- `node:http` `STATUS_CODES`: depende de runtime, contra "Prefer web standard APIs" do `AGENTS.md`. Não funciona em Workers.
- `new Response(...).statusText`: a frase depende da implementação do runtime. Não é fonte confiável de frase padrão.

### D-09 — Modo `unhandled` (RF-05)

**Escolha.** Com `unhandled: true`: `detail = "HTTPError"`, sem `data` e sem `body`. `status` e `title` continuam. **`instance` é omitido** também, mesmo que a PRD só cite `data` e `body`. Motivo: `instance` é um caminho livre que o app informa, e pode expor detalhe interno num erro que o próprio app não tratou. A PRD não contradiz essa escolha. Ela precisa de confirmação (ver seção 8).

### D-10 — Exports públicos

**Escolha.** Em `src/index.ts`, logo após o export de erro (`src/index.ts:72`), uma única linha: `export { problem, type ProblemInput } from "./utils/problem.ts";`. `src/_entries/generic.ts:7` faz `export * from "../index.ts"`, então o pacote inteiro recebe os dois nomes. O nome `ProblemInput` segue `ErrorInput`. É uma escolha de nome, a confirmar.

### D-11 — `onError` e outros caminhos (sem mudança)

- `onError` recebe o `HTTPError` marcado sem alteração (`src/utils/middleware.ts:47-48`, `isError` aceita o erro).
- Se o hook retornar `undefined`, o erro marcado é renderizado como problem+json.
- Se o hook retornar outro valor, esse valor é renderizado no formato dele. Isso é consistente com o contrato atual.
- `src/utils/json-rpc.ts:484-491` monta o próprio erro JSON-RPC e não passa por `errorResponse`. Não muda.

---

## 3. Arquivos a alterar

| Arquivo | Ação | Referência e motivo |
|---|---|---|
| `src/utils/problem.ts` | criar | `ProblemInput`, `problem()` (seção 4). |
| `src/utils/internal/problem-body.ts` | criar | Marca, leitura, cabeçalho e montagem do corpo (seção 4). Modelo de símbolo: `src/response.ts:94`. |
| `src/utils/internal/status-text.ts` | criar | Tabela de frases padrão (D-08). |
| `src/response.ts` | alterar | `errorResponse` em `src/response.ts:358-380`. Ramificar em `getProblem(error)`. Imports em `src/response.ts:1-8`. Mantém `toError` (`:73-83`) e a limpeza de `kEventRes` (`:172`). |
| `src/index.ts` | alterar | Adicionar o export em `src/index.ts:70-72` (seção `// Error`). |
| `src/error.ts` | **não alterar** | Usado como base: `src/error.ts:129-133` (`isError`), `:175-206` (herança via `cause`), `:226-236` (`toJSON`). |
| `test/problem.test.ts` | criar | Testes novos com `describeMatrix` (seção 6). Padrão de `test/errors.test.ts:1-6`. |
| `test/unit/package.test.ts` | alterar (mínimo) | Snapshot de exports, `:104-105`: inserir `"problem"` entre `"parseCookies"` e `"proxy"`. Verificação preservada: a lista continua completa e ordenada. Esse é o único teste existente que muda, e só porque o export novo é o objetivo (RF-08). |
| `test/unit/types.test-d.ts` | alterar | Teste de tipo: `ProblemInput` aceita `type` e `instance`; `problem()` devolve `HTTPError`. Arquivo existe, verificado. |
| `docs/1.guide/1.basics/6.error.md` | alterar (recomendado) | Nova subseção sobre `problem()`, perto de `### HTTPError Fields` (`:51`). Sem essa doc, o utilitário fica invisível para quem usa a lib. |
| `AGENTS.md` | opcional | Árvore de `utils/` em `AGENTS.md:72-92`. Só se o time quiser manter a árvore em dia (o próprio arquivo pede isso). |

---

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import type { HTTPError, ErrorInput } from "../error.ts";

/**
 * Entrada de `problem()`: campos de `ErrorInput` mais os membros opcionais da RFC 9457.
 */
export interface ProblemInput extends ErrorInput {
  /** URI que identifica o tipo do problema (RFC 9457, 3.1.1). Padrão: `"about:blank"`. */
  type?: string;
  /** URI que identifica a ocorrência do problema (RFC 9457, 3.1.5). */
  instance?: string;
}

/**
 * Cria um `HTTPError` que será respondido como `application/problem+json`.
 */
export function problem(input: ProblemInput): HTTPError;
```

Implementação esperada (ilustrativa):

```ts
export function problem(input: ProblemInput): HTTPError {
  const { type, instance, ...details } = input;
  const error = new HTTPError(details);
  setProblem(error, { type, instance });
  return error;
}
```

```ts
// src/utils/internal/problem-body.ts
import type { HTTPError } from "../../error.ts";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemMeta {
  type?: string;
  instance?: string;
}

/** Grava a marca como propriedade não enumerável (D-01). */
export function setProblem(error: HTTPError, meta: ProblemMeta): void;

/** Lê a marca só do próprio erro, nunca de `cause` (D-03). */
export function getProblem(error: HTTPError): ProblemMeta | undefined;

/** Monta o corpo problem+json (D-07, D-08, D-09). */
export function toProblemBody(
  error: HTTPError,
  meta: ProblemMeta,
  debug?: boolean,
): Record<string, unknown>;
```

```ts
// src/utils/internal/status-text.ts
/** Frase padrão do código HTTP (IANA), ou `undefined` se o código não tem frase registrada. */
export function defaultStatusText(status: number): string | undefined;
```

Mudança em `errorResponse` (`src/response.ts:358`), forma esperada:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problem = getProblem(error);
  const baseHeaders = problem ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  if (problem) {
    headers.set("content-type", PROBLEM_CONTENT_TYPE); // D-06: por último, sempre
  }
  const body = problem
    ? toProblemBody(error, problem, debug)
    : { ...error.toJSON(), stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined };
  return new FastResponse(JSON.stringify(body, undefined, debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

`problemHeaders` é um `FrozenHeaders` com `content-type: application/problem+json`, no mesmo padrão de `jsonHeaders` (`src/response.ts:270-272`). Para o ramo comum, o código e o resultado não mudam.

**Regra de `title`** (D-08): `error.statusText ?? defaultStatusText(error.status) ?? "HTTPError"`.
**Regra de `detail`** (D-07, D-09): `error.unhandled ? "HTTPError" : error.message`.

---

## 5. Fluxo de renderização

1. Handler lança (ou retorna) `problem({...})`.
2. `prepareResponse` (`src/response.ts:146`) entra no ramo de erro. `HTTPError.isError` (`src/error.ts:129`) aceita o erro e não o embrulha.
3. Se houver `onError`, o hook recebe o erro. Se retornar `undefined`, segue com o erro (D-11).
4. `errorResponse` lê a marca (`getProblem`). Ramo problem: monta cabeçalhos (D-06) e corpo (D-07).
5. `prepareResponse` segue com o `Response` pronto. Em `HEAD`, o corpo é removido como hoje (`src/response.ts:234-240`).

---

## 6. Estratégia de testes

Os testes novos ficam em `test/problem.test.ts`, com `describeMatrix` (`test/_setup.ts:11`), para rodar em `web` e `node` (RF-09). O padrão de `test/errors.test.ts` é referência: `t.app.use`, `t.fetch`, `t.errors`, `consoleMock`.

Casos, por requisito:

- **RF-01.** `problem({status: 404, message})` devolve `HTTPError` com `status` e `message`. `HTTPError.isError` é `true`.
- **RF-02.** `type` e `instance` são aceitos em tempo de tipo (`test/unit/types.test-d.ts`) e não viram campos de `HTTPError`.
- **RF-03.** Status, `Content-Type: application/problem+json` e corpo com `type`, `title`, `status`, `detail`, `instance`. Casos: com `statusText`, sem `statusText` (frase padrão), código sem frase (`"HTTPError"`), `type` ausente (`about:blank`), `instance` ausente (chave ausente).
- **RF-04.** `body` no topo, `data` como membro. `body: { status: 200, title: "x", codigo: "X1" }` não altera `status` nem `title`.
- **RF-05.** `unhandled: true`: sem `data`, sem `body`, `detail === "HTTPError"`, `status` mantido, `instance` ausente (D-09). Usar `t.errors = []` depois (padrão de `test/errors.test.ts:116`), e `consoleMock` para o `console.error` (`test/errors.test.ts:7`).
- **RF-06.** `headers` com `WWW-Authenticate` aplicado e `Content-Type` forçado. Também com `event.res.errHeaders.set("content-type", ...)` e `set-cookie` acumulado, para confirmar a ordem de D-06.
- **RF-07.** Regressão: `HTTPError.status(404, "Not Found", {...})` mantém o formato atual. `new HTTPError({ cause: problem(...) })` não vira problem+json (D-03).
- **Debug.** Com `debug: true`, `stack` aparece igual ao ramo comum.
- **`onError`.** O hook recebe o erro marcado. Hook que retorna `undefined` mantém problem+json. Hook que retorna um `Response` usa esse `Response`.
- **`HEAD`.** Status e `Content-Type` corretos, corpo vazio (padrão de `test/errors.test.ts:13-22`).
- **RF-08.** `pnpm vitest run test/errors.test.ts test/unit/package.test.ts` (o snapshot é o único ajuste). Suíte completa depois.
- **RF-10.** `pnpm lint` (`oxlint` + `oxfmt --check`) e `pnpm typecheck` (`package.json:46,54`).

Ordem de trabalho: escrever os testes de RF-03 a RF-06 antes da implementação e confirmar que falham (fluxo de bug do `AGENTS.md`, aplicado aqui por se tratar de comportamento novo com contrato fechado).

Opcional: `pnpm build` e `test/dist.test.ts`, para validar que o export entra no bundle.

---

## 7. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Vazamento em erro não tratado (PRD, Riscos) | Alto | D-09 e teste de RF-05. `data`, `body` e `instance` ficam fora. |
| `body` sobrescrevendo membros reservados por `toJSON` | Médio | D-07 não usa `toJSON` no ramo problem. Teste de RF-04. O bug em `toJSON` (`src/error.ts:234`) continua no ramo comum e fica fora de escopo. |
| Marca herdada por `cause` | Médio | D-03 e teste de RF-07. |
| `type` aceito sem validação de URI | Baixo | A PRD não pede validação. Anotar como limitação na doc. |
| `errHeaders` ou `headers` tentando trocar `Content-Type` | Baixo | D-06, forçado por último. |
| `Symbol.for` com nome colidindo com outra lib | Baixo | Nome com prefixo `h3.`, mesmo padrão de `h3.HTTPResponse`. |
| `response.ts` continua acima de 200 linhas | Baixo | Só a ramificação entra ali. A lógica ocupa módulos próprios (D-04). |
| Tabela de frases cresce o pacote | Baixo | Só frases do IANA, em módulo interno, carregado só via `response.ts`. |
| JSON-RPC ignora o formato | Nenhum para RF | Fora de escopo, como em `src/utils/json-rpc.ts:484-491`. Registrar na doc. |

---

## 8. Decisões a confirmar pelo time

1. **Nome do tipo de entrada**: `ProblemInput` (D-10).
2. **`instance` omitido em `unhandled`** (D-09). A PRD não diz; a recomendação é omitir.
3. **`stack` em modo `debug`** dentro de problem+json (seção 4). Mantém o comportamento do ramo comum.
4. **`title` de código sem frase registrada** = `"HTTPError"` (D-08).
5. **Doc e `AGENTS.md`**: atualizar só `docs/1.guide/1.basics/6.error.md`, ou também a árvore do `AGENTS.md`.
