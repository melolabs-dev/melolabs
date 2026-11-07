# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1384.

## 1. Estado atual verificado no código

- `HTTPError` é a única forma de erro serializada. Propriedades e normalização estão em `src/error.ts:74` (classe), `src/error.ts:199-209` (status, statusText, headers, unhandled, data, body) e `src/error.ts:226-236` (`toJSON`, com máscara de `message` e `data` quando `unhandled`, em `src/error.ts:232-234`).
- A serialização de erro acontece em um único ponto: `errorResponse` em `src/response.ts:358-380`, chamada só de `src/response.ts:173` dentro de `prepareResponse` (`src/response.ts:129`). Todo erro (lançado, rejeitado, `onError`, `toError`) converge aí.
- O caminho web é `H3Core["~request"]` (`src/h3.ts:73-100`, com `toResponse` em `src/h3.ts:99`). O entry Node usa `app.fetch` (`src/_entries/node.ts`), então passa pelo mesmo pipeline. Erros de handlers Node viram `HTTPError` `unhandled` em `src/adapters.ts:143-152`. **A premissa do PRD de caminho único para web e Node está confirmada.**
- `errorResponse` monta os headers como `jsonHeaders` (`src/response.ts:270-272`, `content-type: application/json;charset=UTF-8`), mescla `error.headers` (`src/response.ts:360`) e depois `errHeaders` (`src/response.ts:362-364`). Um `content-type` vindo de `headers` hoje sobrescreve o padrão.
- `debug` afeta apenas o campo `stack` (`src/response.ts:369`). A máscara de `unhandled` **não depende de `debug`**. Isso conflita com a redação de RF-05 (ver D-03).
- Exports públicos: `src/index.ts:70-72` (bloco `// Error`). Todos os entries fazem `export * from "../index.ts"` (`src/_entries/generic.ts`, `src/_entries/node.ts`).
- Há um snapshot inline de todos os exports em `test/unit/package.test.ts:4-6`. A lista está em ordem alfabética (`"parseCookies"` na linha 104, `"proxy"` na linha 105). Adicionar `problem` exige atualizar esse snapshot. É o "ajuste em teste existente" previsto na restrição do contrato.
- Padrão de símbolos internos já usado: `src/event.ts:14-23` (`Symbol.for` com namespace e `unique symbol`), com acesso por `(obj as any)[sym]`, por exemplo `src/response.ts:160`.
- Testes de erro: `test/errors.test.ts` (asserções de `content-type` em `:44`, erros `HTTPError` estrangeiros em `:339-351`, `onError` que relança em `:431`). Helper: `describeMatrix` em `test/_setup.ts:11`.

## 2. Decisões de arquitetura

### D-01 — Marcar o erro com um slot interno por símbolo, sem subclasse nem campo público

`problem(input)` cria um `HTTPError` comum e grava nele, sob um símbolo não exportado pelo entry principal, os campos `type` e `instance`. A serialização (`errorResponse`) lê esse slot.

- **Alternativas consideradas:**
  - *Subclasse pública `ProblemError extends HTTPError`:* funciona, mas adiciona um nome público, o que o `pedido.md` proíbe.
  - *Subclasse interna não exportada:* `instanceof` e o `name` continuam funcionando, mas um `class` local dificulta o compartilhamento entre módulos, e `isError` continuaria aceitando o erro sem marcação.
  - *Campos `type`/`instance` em `HTTPError`:* muda `HTTPError`, que o PRD declara fora de escopo.
  - *`problem()` devolver uma `Response` pronta:* quebra RF-01 (retorno deve ser `HTTPError`) e perde o tratamento por `onError`, `onResponse` e `errHeaders`.
- **Escolha:** slot por símbolo `Symbol.for("h3.problem")`. Usa o mesmo padrão de `src/event.ts:14-23`. `Symbol.for` mantém a marcação válida entre cópias duplicadas do h3 (multi-instância, realms), e como símbolo ele não entra em JSON, então um corpo de requisição não consegue forjar a marcação. Não há nenhum nome público novo além de `problem` e `ProblemInput`.

### D-02 — Renderizar em `errorResponse`, o único ponto de serialização

A montagem do corpo RFC 9457 fica em uma função interna `toProblemJSON` (em `src/utils/internal/problem.ts`). `errorResponse` escolhe entre `error.toJSON()` e `toProblemJSON(...)`.

- **Alternativas consideradas:**
  - *Alterar `HTTPError.toJSON`:* mudaria o formato padrão para todos os erros e tiraria a garantia de RF-06. Descartado.
  - *Interceptar em `toResponse` ou `prepareResponse`:* duplicaria a lógica de `errHeaders`, `HEAD` e `onError`. Descartado.
- **Escolha:** `errorResponse`. É o ponto que já cuida de headers, `stack` e status, e a mudança fica pequena (ver §4).

### D-03 — Mascarar `unhandled` sempre, como `HTTPError`, e não só "fora do modo debug"

RF-05 do PRD diz "segue a mesma regra de `HTTPError`", mas o critério de aceite diz "fora do modo debug". No código atual, `HTTPError` mascara `message` e `data` em qualquer modo (`src/error.ts:232-233`), e `debug` só controla `stack`.

- **Alternativas consideradas:**
  - *Mascarar só fora de debug:* vaza `detail` e `data` em produção quando `debug` está ligado, o que é menos seguro que hoje e diverge de `HTTPError`.
  - *Mascarar sempre:* igual a `HTTPError`, sem vazamento novo.
- **Escolha:** mascarar sempre. Erros `unhandled` com `problem()` não têm `detail`, `data` nem membros de `body`. `type`, `instance`, `title` e `status` continuam, por serem definidos pelo desenvolvedor. **Ponto a confirmar com o usuário** (ver §6).

### D-04 — Membros de extensão primeiro, membros RFC por último

No corpo, `data` e as chaves de `body` vêm antes; `type`, `title`, `status`, `detail` e `instance` vêm depois e sobrescrevem.

- **Alternativas consideradas:**
  - *Seguir `HTTPError.toJSON`, que põe `...body` por último (`src/error.ts:234`):* um `body: { status: 999 }` trocaria o status no JSON. Isso é um vetor de inconsistência entre o status HTTP e o corpo.
  - *Membros RFC por último:* o corpo sempre reflete o status real e o `type` declarado.
- **Escolha:** membros RFC por último. É uma divergência deliberada de `HTTPError`, documentada aqui e coberta por teste.

### D-05 — `Content-Type: application/problem+json` é definido por último em `errorResponse`

Depois de montar `error.headers` e `errHeaders`, `errorResponse` faz `headers.set("content-type", "application/problem+json")` quando há slot.

- **Alternativas consideradas:**
  - *Definir antes da mescla:* um `content-type` em `headers` ou `errHeaders` prevaleceria, o que contraria RF-04.
- **Escolha:** definir por último. Assim o `problem()` prevalece sobre `headers` e sobre `errHeaders`. O PRD só pede a precedência sobre `headers`; estender para `errHeaders` é uma decisão minha, e ela está registrada aqui.

### D-06 — Tipo de entrada público `ProblemInput`, derivado de `ErrorInput`

- **Alternativas consideradas:** usar `ErrorInput & { type?; instance? }` direto na assinatura, sem nome. Fica ilegível na documentação gerada e não permite reuso.
- **Escolha:** `export interface ProblemInput<DataT>` em `src/utils/problem.ts`, reexportado em `src/index.ts`. É o "tipo da sua entrada" que o `pedido.md` permite.

### D-07 — Dois arquivos novos, um público e um interno

- `src/utils/problem.ts`: `problem` e `ProblemInput`. Público.
- `src/utils/internal/problem.ts`: `kProblem`, `ProblemSlot` e `toProblemJSON`. Interno.
- **Alternativa:** colocar tudo em `src/error.ts`. Descartado: o arquivo já tem 237 linhas, acima da meta de 200 do `AGENTS.md`, e o conteúdo novo não é parte do `HTTPError`.

### D-08 — `title` e `detail` seguem a normalização de `HTTPError`

- `title` vem de `error.statusText`, que já é sanitizado e vira `undefined` quando vazio (`src/error.ts:200`). A chave some do JSON.
- `detail` vem de `error.message`. Sem `message` explícita, o construtor usa `statusText` ou `"HTTPError <status> <statusText>"` (`src/error.ts:187-193`). Esse valor padrão é aceito como está.
- `type` default é `"about:blank"`. `instance` é omitida quando não informada.
- **Não entra no corpo:** `unhandled`. A chave existe em `HTTPError.toJSON`, mas não é membro da RFC.
- `stack` continua apenas com `debug`, como hoje (`src/response.ts:369`).

## 3. Contratos e assinaturas

```ts
// src/utils/problem.ts (novo, público)
import { HTTPError, type ErrorInput } from "../error.ts";
import { kProblem, type ProblemSlot } from "./internal/problem.ts";

/**
 * Input for {@link problem}: the `HTTPError` fields plus the RFC 9457 `type` and `instance` members.
 */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** RFC 9457 `type` URI. Defaults to `about:blank` when omitted. */
  type?: string;
  /** RFC 9457 `instance` URI reference. Omitted from the body when not set. */
  instance?: string;
}

/**
 * Create an `HTTPError` that is serialized as RFC 9457 problem details (`application/problem+json`).
 */
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...details } = input;
  const error = new HTTPError<DataT>(details);
  (error as any)[kProblem] = { type, instance } satisfies ProblemSlot;
  return error;
}
```

```ts
// src/utils/internal/problem.ts (novo, interno; não reexportado por src/index.ts)
import type { HTTPError } from "../../error.ts";

export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemSlot {
  type?: string;
  instance?: string;
}

/**
 * Body members of an RFC 9457 response. Extension members (`data`, `body`) come first so that
 * the standard members always win; `unhandled` errors expose neither `detail`, `data` nor `body`.
 */
export function toProblemJSON(error: HTTPError, slot: ProblemSlot): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : { ...error.body, data: error.data }),
    type: slot.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance: slot.instance,
  };
}
```

```ts
// src/response.ts — errorResponse alterado (substitui src/response.ts:358-380)
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problemSlot = (error as any)[kProblem] as ProblemSlot | undefined;
  let headers: Headers = error.headers
    ? mergeHeaders(jsonHeaders, error.headers)
    : new Headers(jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  if (problemSlot) {
    headers.set("content-type", "application/problem+json");
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...(problemSlot ? toProblemJSON(error, problemSlot) : error.toJSON()),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

```ts
// src/index.ts — acrescentar no bloco "// Error" (src/index.ts:70-72)
export { problem, type ProblemInput } from "./utils/problem.ts";
```

Não há mudança em `HTTPError` (`src/error.ts`), em `toJSON`, nem em `prepareResponse`.

**Exemplo de corpo** (`problem({ status: 404, statusText: "Not Found", message: "Pedido inexistente", data: { id: 42 } })`):

```json
{ "data": { "id": 42 }, "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Pedido inexistente" }
```

## 4. Lista de arquivos

| Arquivo | Tipo | Mudança |
| --- | --- | --- |
| `src/utils/problem.ts` | novo | `problem`, `ProblemInput` (D-01, D-06, D-07) |
| `src/utils/internal/problem.ts` | novo | `kProblem`, `ProblemSlot`, `toProblemJSON` (D-02 a D-04, D-07) |
| `src/response.ts:358-380` | alterado | `errorResponse` escolhe o corpo e define `content-type` por último (D-02, D-05) |
| `src/index.ts:70-72` | alterado | exporta `problem` e `ProblemInput` |
| `test/problem.test.ts` | novo | testes com `describeMatrix` (§5) |
| `test/unit/package.test.ts:104` | alterado | inclui `"problem"` no snapshot de exports, entre `"parseCookies"` e `"proxy"` |
| `AGENTS.md` (Project Structure) | opcional | incluir `utils/problem.ts` e `utils/internal/problem.ts` |

Sem alteração em `src/error.ts`, `src/h3.ts`, `src/adapters.ts`, `src/_entries/*`.

## 5. Estratégia de testes

Seguindo o ciclo de bug fix do `AGENTS.md`, escrever primeiro os testes e confirmar que falham antes de implementar.

`test/problem.test.ts` com `describeMatrix` (`test/_setup.ts:11`), rodando em `web` e `node`:

1. **RF-01:** `problem({ status: 404, message })` retorna `HTTPError` e `HTTPError.isError(...)` é `true`.
2. **RF-02:** `type` e `instance` informados aparecem no corpo. Sem `type`, o corpo tem `type: "about:blank"` e não tem `instance`.
3. **RF-03:** mapeamento `title`/`statusText`, `detail`/`message`, `status`, `data`. Sem `statusText`, a chave `title` não existe.
4. **RF-04:** `content-type` é `application/problem+json`. `retry-after` de `headers` é mantido. `headers: { "content-type": "text/plain" }` não vence (D-05). `event.res.errHeaders` com `content-type` também não vence.
5. **RF-05:** erro `unhandled` com `problem()` não contém a mensagem nem `data` (D-03), e o status continua `500`. Testar com e sem `debug`.
6. **D-04:** `body: { status: 999, type: "x" }` não altera o status nem o `type` no JSON.
7. **RF-06:** `new HTTPError(...)` continua com `application/json;charset=UTF-8` e o formato atual. Já coberto por `test/errors.test.ts:44`; repetir um caso mínimo para evidenciar a compatibilidade.
8. **Fluxo:** `problem()` lançado em handler `async` e em handler síncrono; `onError` que não retorna nada (o erro original continua sendo renderizado como problem, porque `prepareResponse` usa `newVal ?? val`, `src/response.ts:165`); `HEAD` sem corpo.
9. **Exports:** `test/unit/package.test.ts` com o snapshot atualizado.
10. **Tipos:** `problem({ status: 400, type: 1 })` deve falhar em `pnpm typecheck`. Se o projeto já tem `test/unit/types.test-d.ts`, o caso pode entrar lá.

Comandos de verificação, nesta ordem:

```bash
pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/package.test.ts
pnpm vitest run                 # suíte completa
pnpm lint                       # oxlint + oxfmt --check
pnpm typecheck                  # tsc --noEmit
pnpm build && pnpm vitest run test/dist.test.ts   # o export novo precisa aparecer no dist
```

Não consegui ler `test/dist.test.ts` nesta etapa; ele deve ser verificado na implementação.

## 6. Riscos e pontos a confirmar

1. **RF-05 vs. HTTPError (D-03).** O PRD diz "fora do modo debug", mas `HTTPError` mascara sempre. A recomendação é mascarar sempre. **Precisa de confirmação do usuário.**
2. **Precedência do corpo (D-04).** Diverge de `HTTPError`, onde `body` sobrescreve. Recomendo manter, por segurança. **Confirmar.**
3. **`errHeaders` com `content-type` (D-05).** O PRD não trata esse caso. Recomendo que `problem()` vença. **Confirmar.**
4. **Snapshot de exports.** Adicionar `problem` altera `test/unit/package.test.ts`. É um ajuste previsto, mas precisa aparecer explicitamente no diff.
5. **Colisão de nome `problem`.** Já listada no PRD. Sem alias, aplicações que importam `problem` de `h3` terão conflito. Aceito pelo escopo.
6. **`onError` que devolve outro valor ou relança.** Se o hook substituir o erro por um `HTTPError` comum, a resposta volta ao formato padrão. Comportamento esperado; coberto pelo teste 8 apenas no caso sem retorno.
7. **Erros de `fromNodeHandler`.** Continuam virando `unhandled` 500 (`src/adapters.ts:143-152`). Não há mudança de formato, porque não usam `problem()`.
8. **Cópias duplicadas do h3.** `Symbol.for` reconhece `problem()` de outra cópia do pacote. É o comportamento desejado, mas precisa de um comentário no código.
9. **Build e dist.** A verificação do dist não foi feita nesta etapa. Se `test/dist.test.ts` depender de lista de exports, ele também precisa de ajuste.
