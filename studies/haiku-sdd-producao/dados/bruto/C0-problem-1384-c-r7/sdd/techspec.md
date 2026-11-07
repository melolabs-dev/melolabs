# Techspec — `problem()` (RFC 9457 Problem Details)

Origem: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`) e `sdd/prd.md` (RF-01 a RF-08).
Escopo: apenas especificação; nenhum código do projeto foi alterado.

## 1. Estado atual (conferido no código)

- `HTTPError` guarda `status`, `statusText`, `headers`, `data`, `body`, `unhandled`; não tem `type`/`instance` (`src/error.ts:74-119`). O construtor copia `headers` de `details.headers` ou `details.cause.headers` (`src/error.ts:202-203`) e usa `message` ou, na falta dela, `statusText` ou `"HTTPError <status> <texto>"` como mensagem (`src/error.ts:187-193`).
- `toJSON()` emite `status`, `statusText`, `unhandled`, `message`, `data` e espalha `body`; quando `unhandled`, mascara `message` e omite `data`/`body` (`src/error.ts:226-236`).
- A serialização acontece em `errorResponse` (`src/response.ts:358-380`): parte de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`), faz `mergeHeaders(jsonHeaders, error.headers)` (`src/response.ts:359-361`; `mergeHeaders` em `src/response.ts:243-252` usa `set`, então o valor do erro substitui o padrão), depois mescla `errHeaders` (`src/response.ts:362-364`) e escreve `stack` só em `debug` (`src/response.ts:369`).
- `errorResponse` é chamado em `prepareResponse` para qualquer `Error` (`src/response.ts:146-173`); um `HTTPError` já existente é reutilizado sem recriação (`src/response.ts:147-148`), inclusive depois de `onError` (`src/response.ts:161-165`).
- Exports públicos de erro: `src/index.ts:72`. O snapshot de exports é `test/unit/package.test.ts:6-158`.
- Não existe tabela de status→texto-padrão no `src/` (busca por `STATUS_CODES`/textos retornou só ocorrências pontuais). `Response` web não preenche `statusText`.
- Padrão de chaves internas: `Symbol.for("h3.internal....")` com prefixo `k` (`src/event.ts:14-23`).

## 2. Decisões de arquitetura

### D-01 — Como marcar um `HTTPError` como "problem details"

Alternativas:

1. Subclasse `ProblemError extends HTTPError` — cria um nome público (proibido pelo contrato) ou um nome interno que pode quebrar `isError` (depende de `name`, `src/error.ts:129-133`) e a identidade entre realms.
2. Novo campo público em `HTTPError` (`problem?: ...`) — altera a API e o tipo `ErrorBody`.
3. Guardar `type`/`instance` em `body` e detectar por convenção — colide com `body.type` do usuário e polui o payload (risco do PRD).
4. Propriedade não enumerável sob símbolo registrado (`Symbol.for`) definida por `problem()`; `errorResponse` consulta o símbolo.

**Escolha: 4.** Sem novo nome público, sem mudar o shape/`toJSON()` do erro (RF-07), sobrevive a `onError` (o mesmo objeto é reaproveitado, `src/response.ts:147-148`) e segue a convenção `k*`/`Symbol.for` do projeto (`src/event.ts:14-23`). O símbolo fica em módulo interno, fora de `src/index.ts`.

### D-02 — Onde o corpo problem+json é montado

Alternativas:

1. Sobrescrever `toJSON()` na instância criada por `problem()` — `toJSON` é usado só em `errorResponse` (`src/response.ts:368`), mas teria de reimplementar a máscara de `unhandled` e não conseguiria saber `debug`.
2. Montar o corpo em `errorResponse` por um helper interno `problemBody(error)` quando o símbolo estiver presente.
3. Criar um segundo serializador de resposta separado de `errorResponse`.

**Escolha: 2.** O ramo padrão de `errorResponse` permanece intocado (só um `if`), o `stack`/indentação de `debug` e o merge de cabeçalhos continuam compartilhados (`src/response.ts:365-379`), e a ocultação de `unhandled` fica num único ponto.

### D-03 — Content-Type e precedência de cabeçalhos

Alternativas:

1. Trocar `jsonHeaders` por um `problemHeaders` dentro de `errorResponse` — um `content-type` explícito do usuário seria sobrescrito ou exigiria lógica extra.
2. `problem()` injeta `content-type: application/problem+json;charset=UTF-8` em `headers` do erro só se o usuário não informou `content-type`; `errorResponse` não muda no merge.

**Escolha: 2.** O merge atual já faz `error.headers` vencer `jsonHeaders` (`src/response.ts:359-361`), logo o `content-type` do erro substitui o padrão e o do usuário (verificado via `Headers.has`, case-insensitive) prevalece (RF-02, RF-05). `errHeaders` de `event.res` continua sendo mesclado por último (`src/response.ts:362-364`); é o comportamento já existente para qualquer erro e fica documentado como risco (R-03). O `charset=UTF-8` mantém o padrão de `jsonHeaders`.

### D-04 — Membros do corpo e precedência

O corpo é `{ ...extensões, type, title, status, detail?, instance?, stack? }`:

- Extensões (`data` e o espalhamento de `body`) entram **antes** dos membros padrão, de modo que `body.type`/`body.title`/... do usuário nunca substituem os membros da RFC (o campo explícito de `problem()` vence, como exige o PRD).
- Os campos legados `statusText`, `message` e `unhandled` **não** são emitidos (preferência declarada no PRD, seção de riscos). `title` ← `error.statusText`, `detail` ← `message` informado.
- `type` padrão `"about:blank"`; `instance` só quando informado; `detail` só quando `message` foi informado explicitamente (o `message` sintetizado pelo construtor, `src/error.ts:187-193`, não vira `detail`, evitando `"HTTPError 404"` no payload).

Alternativa considerada: manter `toJSON()` e apenas acrescentar `type/title/detail` (compatibilidade com consumidores atuais). Rejeitada: duplica informação, e o contrato define o formato como RFC 9457 + extensões.

### D-05 — Título padrão (texto do status)

Alternativas:

1. Tabela em `src/response.ts`/`error.ts` (núcleo) — aumenta o bundle de quem não usa `problem()`.
2. `node:http` `STATUS_CODES` — viola "web standards first"/multi-runtime.
3. Pequena tabela interna dentro do módulo de `problem()`; o título é resolvido na criação e guardado no metadado do símbolo.

**Escolha: 3.** Só quem importa `problem` paga o custo (o tree-shaking descarta a tabela, e `response.ts` importa apenas o símbolo/helper). Cobre os códigos 4xx/5xx comuns e 2xx/3xx usuais; status sem entrada ficam sem `title` (membro omitido pelo `JSON.stringify`), pois `title` é recomendável mas opcional na RFC.

### D-06 — Erros `unhandled`

Quando `error.unhandled`, `problemBody` emite apenas `type`, `title`, `status` (e `stack` em debug, igual ao fluxo atual): omite `detail`, `instance`, `data` e `body`. `instance` é omitido por precaução: é texto livre do chamador e o contrato de ocultação do h3 trata tudo que não é status como sensível. Isso satisfaz RF-06 (nem `"segredo"`, nem `data`, nem `stack` sem debug). Alternativa (manter `instance`) rejeitada por ser a escolha menos segura sem ganho para o cliente.

### D-07 — Local dos arquivos e exports

- `problem()` e `ProblemInput` em novo `src/utils/problem.ts` (`src/error.ts` já tem 237 linhas, acima da meta de < 200 LoC do AGENTS.md; utilitários públicos vivem em `src/utils/`).
- Símbolo, metadado e `problemBody` em novo `src/utils/internal/problem.ts` (não exportado; convenção de helpers internos).
- Export em `src/index.ts` ao lado dos utilitários, importando direto do módulo (sem barrel).

## 3. Arquivos a alterar

| Arquivo                                | Ponto           | Mudança                                                                                                                                         |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/problem.ts` (novo)          | —               | `problem()`, `ProblemInput`, tabela de títulos                                                                                                  |
| `src/utils/internal/problem.ts` (novo) | —               | `kProblem`, `ProblemMeta`, `problemBody()`                                                                                                      |
| `src/response.ts:2`                    | imports         | importar `kProblem`/`problemBody`                                                                                                               |
| `src/response.ts:358-380`              | `errorResponse` | escolher o corpo: `problemBody(error)` se `error[kProblem]`, senão `error.toJSON()`; o restante (stack, indentação, headers, status) inalterado |
| `src/index.ts:72` (vizinhança)         | exports         | `export { problem, type ProblemInput } from "./utils/problem.ts";`                                                                              |
| `test/unit/package.test.ts:104-105`    | snapshot        | inserir `"problem",` entre `"parseCookies"` e `"proxy"` (ordem de `sort()`); é o único teste existente afetado                                  |
| `test/problem.test.ts` (novo)          | —               | testes novos (seção 5)                                                                                                                          |

Não alteram: `src/error.ts` (nenhuma mudança em classe, `toJSON` ou construtor), `src/h3.ts`, `src/utils/internal/validate.ts`, `src/rules/**`, `src/_deprecated.ts`.

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import type { ErrorInput } from "../error.ts";
import { HTTPError } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI de referência que identifica o tipo do problema. Padrão: "about:blank". */
  type?: string;
  /** URI de referência que identifica esta ocorrência do problema. */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

```ts
// src/utils/internal/problem.ts
export const kProblem: unique symbol; // Symbol.for("h3.internal.problem")

export interface ProblemMeta {
  type: string; // já resolvido ("about:blank" por padrão)
  title?: string; // statusText sanitizado ou texto-padrão
  detail?: string; // message informada pelo chamador
  instance?: string;
}

export function problemBody(error: HTTPError, meta: ProblemMeta, debug?: boolean): Record<string, unknown>;
```

Comportamento de `problem(input)`:

1. `const { type, instance, ...rest } = input;`
2. Monta `headers = new Headers(rest.headers ?? (rest.cause as ErrorInput)?.headers)`; se `!headers.has("content-type")`, `headers.set("content-type", "application/problem+json;charset=UTF-8")`.
3. `const error = new HTTPError({ ...rest, headers })` (a sanitização de `status`/`statusText` e o tratamento de `statusCode`/`statusMessage`/`cause` do construtor, `src/error.ts:172-185`, são reaproveitados).
4. `title = error.statusText ?? defaultTitle(error.status)`; `detail = rest.message || undefined`.
5. `Object.defineProperty(error, kProblem, { value: { type: type || "about:blank", title, detail, instance } })` (não enumerável, não gravável).
6. Retorna `error`; `HTTPError.isError(error)` continua `true` (RF-01).

Forma do corpo (`problemBody`), com `JSON.stringify` descartando `undefined`:

```
unhandled: { type, title, status, stack? }
demais:    { ...(data !== undefined ? { data } : {}), ...error.body, type, title, status, detail, instance, stack? }
```

Exemplo (RF-03): `{"type":"https://example.com/probs/validation","title":"Unprocessable","status":422,"detail":"Campo email inválido","instance":"/users/42"}`.

## 5. Estratégia de testes

Novo `test/problem.test.ts` com `describeMatrix` (web e node), no padrão de `test/errors.test.ts:1-6`:

- RF-01: `problem({ status: 404 })` é `HTTPError` (`HTTPError.isError`) com `status` 404; teste unitário do snapshot de exports cobre "só `problem` de novo".
- RF-02: `throw problem({ status: 400 })` → status 400 e `content-type` começando com `application/problem+json`.
- RF-03: caso 422 completo com `type`, `instance`, `statusText`, `message`; assertar `toEqual` do corpo (e ausência de `statusText`/`message`/`unhandled`).
- RF-04: só `status: 404` → `type: "about:blank"`, `title: "Not Found"`, sem `instance`/`detail`.
- RF-05: 429 com `retry-after` e `body: { balance: 0 }`; `content-type` explícito do usuário prevalece; `body.type` do usuário não substitui `type` de `problem()`; `data` no nível superior.
- RF-06: `unhandled: true` com `message`/`data`/`body`/`instance` → corpo sem `segredo`, `data`, `stack`; com `debug` (config do app) `stack` aparece.
- RF-07: `new HTTPError({ status: 400, message: "ruim" })`, `HTTPError.status(...)`, erro genérico e 404 automático mantêm `application/json;charset=UTF-8` e o formato atual, sem `type`/`title`/`detail`.
- Extra: `problem()` com `onError` configurado (o erro passa por `prepareResponse` duas vezes, `src/response.ts:161-165`) mantém o formato; `HEAD`/status sem corpo não quebram.
- Regressão: ajustar apenas `test/unit/package.test.ts` (adicionar `"problem"`); rodar `pnpm vitest run` completo para provar que `test/errors.test.ts` e demais seguem verdes sem edição.
- Qualidade: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/problem.test.ts`, `pnpm vitest run test/unit/`. Seguir o fluxo do AGENTS.md: escrever os testes, vê-los falhar, implementar, vê-los passar.

## 6. Riscos

- **R-01 — Peso do bundle do núcleo:** `response.ts` passa a importar o helper interno; manter `problemBody` pequeno e a tabela de títulos fora do caminho importado por `response.ts` (D-05). Verificar `test/rules/treeshake.test.ts` (orçamentos de bytes) após a mudança.
- **R-02 — `detail` vazando dado sensível:** `detail` vem de `message` e `instance` é livre; só o caso `unhandled` é protegido (D-06). Documentar na JSDoc de `problem()`.
- **R-03 — `errHeaders` pode sobrescrever `content-type`:** `event.res` de erro é mesclado depois (`src/response.ts:362-364`); é o comportamento já existente para qualquer erro, não alterado.
- **R-04 — `cause`/`details` aninhados:** o construtor lê `status`/`headers`/`unhandled` também de `details.cause` (`src/error.ts:172-206`); `problem()` cobre `headers` via `cause` (passo 2), mas `type`/`instance` só valem quando passados no próprio `input`.
- **R-05 — Mudança de formato frente ao `HTTPError` padrão:** consumidores que leiam `statusText`/`message` do JSON de erros criados por `problem()` não os encontrarão (campos legados omitidos, D-04). Decisão explícita; opt-in apenas via `problem()`.
- **R-06 — Realms diferentes:** `Symbol.for` mantém o metadado reconhecível entre cópias do módulo, alinhado a `HTTPError.isError` (`src/error.ts:129-133`).
- **R-07 — Cobertura de títulos:** status fora da tabela ficam sem `title`; aceitável pela RFC, mas deve ser coberto por teste para não virar `"undefined"`.
