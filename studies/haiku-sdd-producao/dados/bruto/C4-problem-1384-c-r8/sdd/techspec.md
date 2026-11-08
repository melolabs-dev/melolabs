# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

- Origem: `sdd/pedido.md` (contrato enxuto #1384-C) e `sdd/prd.md`
- Data: 2026-11-07
- Escopo: pacote `h3` (v2)

## Visão geral

Um novo utilitário `problem(input)` cria um `HTTPError` marcado internamente. Quando esse erro chega ao responder de erros (`errorResponse`), a resposta sai como `application/problem+json`, com o corpo montado conforme a RFC 9457. Erros criados de outras formas seguem pelo caminho atual, sem nenhuma alteração de comportamento.

Fluxo resumido:

1. `problem({ status, message, type, instance, ... })` → `HTTPError` com `type`, `instance` e uma marca interna `kProblem`.
2. O erro é lançado ou retornado; `prepareResponse` (`src/response.ts:146`) o reconhece como `HTTPError` e o envia a `errorResponse` (`src/response.ts:173`).
3. `errorResponse` detecta `kProblem`, serializa com `toProblemJSON` e força `Content-Type: application/problem+json`.

---

## Decisões de arquitetura

### D-01 — Marca interna do erro: símbolo na instância

**Alternativas consideradas**

- (a) Subclasse `ProblemError extends HTTPError` não exportada.
- (b) Flag pública no `HTTPError` (ex.: `problem: true`).
- (c) Símbolo interno `kProblem` gravado na própria instância.

**Escolha: (c).**

- (a) criaria uma classe nova. `HTTPError.isError` (`src/error.ts:129`) aceita a subclasse por causa do getter `name`, mas a classe adicionaria superfície sem ganho. Além disso, o `ProblemInput` precisa ser só um tipo.
- (b) mexe no tipo público de `HTTPError`, o que contradiz "nenhum outro nome público novo" e RF-08.
- (c) segue o padrão já usado no projeto para marcas internas (`kHTTPResponse`, `src/response.ts:94`; `kEventRes`, `src/event.ts:16`), com `Symbol.for` para valer entre cópias do módulo. Não aparece em `JSON.stringify`.

Limitação aceita: `new HTTPError({ cause: problemError })` não herda a marca (o `HTTPError` herda só `status`, `statusText`, `headers`, `unhandled`, `data`, `body` do `cause`, `src/error.ts:162-209`). Isso é o comportamento esperado: o formato é escolhido pelo ponto de criação.

### D-02 — Campos `type` e `instance` e tipo de retorno sem novo nome público

**Escolha:** `problem()` grava `type` e `instance` como propriedades da instância, e a assinatura de retorno é o intersection inline `HTTPError & Pick<ProblemInput, "type" | "instance">`.

- O PRD (RF-02) exige que os campos fiquem disponíveis no erro retornado. Uma propriedade própria cumpre isso.
- Um alias como `ProblemError` seria um nome público novo, o que o contrato proíbe. O intersection inline evita isso.
- `isolatedDeclarations` (`tsconfig.json:21`) exige a anotação explícita de retorno, que já está prevista.

### D-03 — Ponto de serialização: ramificação dentro de `errorResponse`

**Alternativas consideradas**

- (a) Alterar `HTTPError.prototype.toJSON` (`src/error.ts:226`) para devolver o formato RFC quando marcado.
- (b) Ramificar em `errorResponse` (`src/response.ts:358`) e deixar `toJSON` intacto.
- (c) Um `onError` padrão que converte o erro antes de `prepareResponse`.

**Escolha: (b).**

- (a) mudaria `JSON.stringify(err)` e também os consumidores de `toJSON`, como o JSON-RPC (`src/utils/json-rpc.ts:483-488`). Quebra RF-08 por efeito colateral.
- (c) depende de `config.onError`, que é opcional, e o PRD proíbe novas opções globais.
- (b) é o único ponto que decide a resposta. Erros sem marca passam pelo mesmo código de hoje, só que com um `if` a mais.

### D-04 — `Content-Type` exato, aplicado por último

**Escolha:** em `errorResponse`, quando o erro tem a marca, `content-type` vira exatamente `application/problem+json` depois de todas as mesclagens (`error.headers`, `errHeaders`).

- `jsonHeaders` define `application/json;charset=UTF-8` (`src/response.ts:270`). Para problem, esse valor é trocado.
- Aplicar por último garante RF-03 mesmo se o usuário passar `Content-Type` em `headers` (RF-06). Um header de usuário com outro `Content-Type` perde para o formato. Isso precisa estar documentado.

### D-05 — `detail` só vem do `message` informado

**Escolha:** `detail` recebe `input.message` apenas quando ele foi informado. Não se usa `error.message`.

- `HTTPError` preenche `message` com um padrão, por exemplo `"HTTPError 422 Unprocessable"` (`src/error.ts:187-193`). Usar esse valor geraria um `detail` sem sentido em `problem({ status: 422 })`, que é o caso de RF-04.
- Sem `message` informado, `detail` fica ausente, o que a RFC permite (§3.1.4).
- O valor é guardado na marca: `[kProblem]: { detail: input.message }`.

### D-06 — `title`: texto de status completo, em tabela interna separada

**Alternativas consideradas**

- (a) Estender `STATUS_TEXT` (`src/utils/response.ts:347`) com todos os códigos.
- (b) Tabela própria, interna, só para problem.
- (c) Não ter `title` quando `statusText` não for informado.

**Escolha: (b).**

- O comentário em `src/utils/response.ts:346` diz que `STATUS_TEXT` só cobre os códigos de `noContent` e `redirect`, e que outros códigos não recebem frase. Ampliar a tabela mudaria `noContent(205)` e outros casos, o que viola RF-08.
- (c) não atende RF-04 (`title` com o texto padrão de `422`).
- A tabela interna segue RFC 9110 (§15) para os códigos de 4xx e 5xx, mais 2xx e 3xx em uso comum. Ela fica em `src/utils/internal/problem.ts`.
- `title` = `error.statusText` (já sanitizado, `src/error.ts:180-200`) ou, se ausente, a entrada da tabela. Se nenhuma existir, o membro fica ausente (JSON não serializa `undefined`).

### D-07 — Membros de extensão: `data` e `body` espalhados, membros padrão por último

**Escolha**

- Se `data` for objeto simples, suas chaves vão ao nível superior. Se não for (array, string, número), o valor vai no membro `data`.
- `body` (objeto) tem suas chaves espalhadas no nível superior, como hoje em `HTTPError.toJSON` (`src/error.ts:234`).
- Ordem de montagem: `...data`, `...body`, depois `type`, `title`, `status`, `detail`, `instance`. Assim os membros padrão sempre vencem (RF-05).

**Por que não `data` como membro literal sempre:** RF-05 pede explicitamente que as chaves de `data` apareçam no nível superior (`campo: "email"`).

### D-08 — Erros `unhandled` expõem só `type`, `title` e `status`

**Escolha:** com `unhandled: true`, o corpo tem apenas `type`, `title` e `status`. `detail`, `instance`, `data`, `body` e `stack` (fora de debug) ficam de fora.

- RF-07 proíbe `detail`, `data`, `body` e stack. Omitir `instance` também é uma escolha conservadora, porque ele pode identificar a ocorrência internamente.
- `title` vem do status, não da mensagem, então não vaza informação interna.
- Em debug, o `stack` segue a regra atual de `errorResponse` (`src/response.ts:369`).

### D-09 — Exportação e nomes públicos

- `problem` e `type ProblemInput` são exportados por `src/index.ts`, junto de `HTTPError` (`src/index.ts:72`).
- `src/_entries/generic.ts:5` re-exporta `index.ts`, então todos os entries ganham `problem` automaticamente.
- `kProblem`, `toProblemJSON` e a tabela de títulos ficam **fora** de `index.ts`.
- `ProblemInput` é o nome do tipo de entrada (premissa do PRD).

### D-10 — `onError` e `kEventResErrHeaders` não mudam

- O erro de `problem()` tem `instanceof Error` e é `HTTPError`, então passa por `onError` do mesmo jeito (`src/response.ts:161-166`).
- Se `onError` devolver um novo valor, a resposta segue por `prepareResponse` com `nested = true`, e a marca só é lida na hora de `errorResponse`. Nada muda aqui.
- `errHeaders` (`src/response.ts:160`) continua sendo mesclado, antes da troca de `content-type` (D-04).

---

## Arquivos a alterar

| Arquivo | Alteração | Tamanho esperado |
| --- | --- | --- |
| `src/utils/problem.ts` | **novo.** `problem()` e `ProblemInput` (público). | ~40 linhas |
| `src/utils/internal/problem.ts` | **novo.** `kProblem`, `toProblemJSON()`, tabela de títulos. | ~110 linhas |
| `src/response.ts` | `errorResponse` ramifica em `kProblem` e fixa `content-type` (D-03, D-04). | +10 linhas em `src/response.ts:358-380` |
| `src/index.ts` | Exportar `problem` e `type ProblemInput` perto de `src/index.ts:72`. | +1 linha |
| `test/problem.test.ts` | **novo.** Testes de comportamento, `describeMatrix` (ver estratégia). | ~150 linhas |
| `test/unit/types.test-d.ts` | Teste de tipo de `ProblemInput` e do retorno de `problem()`. | +15 linhas |
| `test/unit/package.test.ts` | Atualizar o snapshot de exports (`src/_entries/generic.ts`), incluindo `problem`. | ajuste de snapshot (`test/unit/package.test.ts:4-6`) |
| `docs/1.guide/1.basics/6.error.md` | Opcional: seção curta sobre `problem()`. | — |

Não alterar: `src/error.ts` (nenhuma mudança em `ErrorInput`, `HTTPError` ou `toJSON`), `src/utils/response.ts` (`STATUS_TEXT` fica como está), `src/utils/sanitize.ts`, `src/h3.ts`, nem `test/errors.test.ts`.

---

## Contratos e assinaturas

### `src/utils/problem.ts` (público)

```ts
import { HTTPError } from "../error.ts";
import type { ErrorInput } from "../error.ts";
import { kProblem } from "./internal/problem.ts";

/**
 * Input for `problem()`: the `HTTPError` input plus the RFC 9457 `type` and `instance` members.
 */
export interface ProblemInput extends ErrorInput {
  /** URI reference that identifies the problem type (RFC 9457 §3.1.1). Defaults to `about:blank`. */
  type?: string;
  /** URI reference that identifies this occurrence of the problem (RFC 9457 §3.1.5). */
  instance?: string;
}

/**
 * Create an `HTTPError` that is rendered as `application/problem+json` (RFC 9457).
 */
export function problem(
  input: ProblemInput,
): HTTPError & Pick<ProblemInput, "type" | "instance">;
```

Corpo (contrato, não implementação final):

- Desestrutura `{ type, instance, ...errorInput }`.
- `new HTTPError(errorInput)`.
- `Object.assign(error, { type, instance, [kProblem]: { detail: input.message } })` e retorna o resultado.

### `src/utils/internal/problem.ts` (interno)

```ts
import type { HTTPError } from "../../error.ts";

/** Marca interna de erros criados por `problem()` (D-01). */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

/** Corpo RFC 9457 de um erro marcado. Não inclui `stack`: o responder o acrescenta em debug. */
export function toProblemJSON(error: HTTPError): Record<string, unknown>;
```

Regras de `toProblemJSON` (D-05 a D-08):

- `unhandled`: `{ type: type ?? "about:blank", title, status }`.
- Caso normal: `{ ...dataMembers, ...body, type: type ?? "about:blank", title, status, detail, instance }`.
- `title = error.statusText ?? PROBLEM_TITLES[error.status]`.
- `detail = marca.detail`, ausente se `undefined`.
- `instance` ausente se `undefined`.

### `src/response.ts` (alteração em `errorResponse`, `src/response.ts:358`)

Forma pretendida:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const isProblem = (error as any)[kProblem] !== undefined;
  let headers: Headers = error.headers
    ? mergeHeaders(jsonHeaders, error.headers)
    : new Headers(jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  if (isProblem) {
    headers.set("content-type", "application/problem+json");
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...(isProblem ? toProblemJSON(error) : error.toJSON()),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Os demais caminhos de `errorResponse` não mudam: quando `isProblem` é `false`, o código executa exatamente as mesmas operações de hoje.

### `src/index.ts`

```ts
export { problem, type ProblemInput } from "./utils/problem.ts";
```

---

## Estratégia de testes

Seguindo `AGENTS.md`: teste de regressão antes da implementação, `describeMatrix` para comportamento e confirmação de que os testes falham antes da mudança.

### Testes de comportamento: `test/problem.test.ts` (novo, `describeMatrix`)

| Teste | Requisito | Verificação |
| --- | --- | --- |
| `problem()` devolve `HTTPError` com status | RF-01 | `HTTPError.isError(e)`, `e.status === 404` |
| `type`, `instance`, `headers`, `data` ficam no objeto | RF-02 | propriedades presentes; compila (typecheck) |
| Lançado no handler: status, `Content-Type` exato, `detail` | RF-03 | `t.fetch` → 403, `application/problem+json`, `detail: "Acesso negado"` |
| Retornado (não lançado) pelo handler: mesmo resultado | RF-01 | igual ao anterior |
| Sem `type`/`statusText`/`message`: `type: "about:blank"`, `title` de 422, sem `instance`, sem `detail` | RF-04, D-05 | `toEqual` do corpo |
| Sem `message`, `detail` ausente (não usa `HTTPError 422 …`) | D-05 | `"detail" in body === false` |
| `data` com `campo: "email"` vira membro de topo; `detail` vence em conflito | RF-05, D-07 | `body.campo === "email"`; `data: { detail: "x" }` não altera `detail` |
| `body` espalhado; data não-objeto (array) fica em `data` | D-07 | `toMatchObject` |
| `headers: { "WWW-Authenticate": "Bearer" }` aparece; `Content-Type` continua exato | RF-06 | headers da resposta |
| `headers: { "Content-Type": "text/plain" }` é sobrescrito | D-04 | `content-type === application/problem+json` |
| `unhandled: true`: sem `detail`, `data`, `body`, stack; só `type/title/status` | RF-07, D-08 | corpo com `toEqual` exato, fora de debug |
| `unhandled` em debug: `stack` presente | D-08 | `stack` é array |
| `onError` recebe o erro de problem e pode devolver outra resposta | D-10 | `onError` chamado uma vez; resposta do hook |
| `event.res.errHeaders` mesclado e `content-type` continua exato | D-04, D-10 | `set-cookie` aparece uma vez |
| `HEAD` sem corpo | D-03 | `nullBody` |

### Regressão: testes existentes (RF-08)

- `test/errors.test.ts` **não deve ser alterado**. Ele cobre `throw HTTPError` (`:67`), `return HTTPError` (`:88`), erros `unhandled` (`:107`), `error headers` (`:202`) e `onError` (`:355`). Ele é a prova de RF-08.
- `test/unit/package.test.ts:4-6` tem snapshot de exports. Ele **deve** ser atualizado para incluir `problem`. Esse é o único ajuste em teste existente, permitido pelo PRD, e não perde nada do que verifica.

### Tipos: `test/unit/types.test-d.ts`

- `expectTypeOf(problem({ status: 400, type: "https://x", instance: "/a" })).toHaveProperty("type")`.
- `expectTypeOf<ProblemInput>().toExtend<ErrorInput>()`, que cobre RF-02.
- `// @ts-expect-error` para `problem({ status: 400, type: 1 })`.

### Unitários: `test/unit/problem.test.ts` (opcional)

Se `toProblemJSON` virar difícil de cobrir pelo `fetch`, testar a função direto: precedência de membros (D-07), `title` ausente para status fora da tabela, e `unhandled` (D-08).

### Comandos de verificação

```bash
pnpm vitest run test/problem.test.ts          # novo
pnpm vitest run test/errors.test.ts           # regressão (RF-08)
pnpm vitest run test/unit/package.test.ts     # snapshot de exports
pnpm vitest run test/unit/types.test-d.ts     # tipos
pnpm lint                                     # oxlint + oxfmt --check
pnpm typecheck                                # tsc --noEmit
pnpm vitest run                               # suíte completa
```

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Vazamento de detalhes em `unhandled` | Alto | D-08 e teste `unhandled` com corpo `toEqual` exato, fora de debug |
| Mudança silenciosa em erros comuns | Médio | `errorResponse` só muda quando `kProblem` existe; `test/errors.test.ts` fica intacto e roda na suíte |
| Marca `Symbol.for` forjada por código de usuário | Baixo | Só um `Error` com o símbolo, nunca um valor qualquer lançado (`toError` em `src/response.ts:73` embrulha o resto). Mesma postura de `kHTTPResponse` (`src/response.ts:94`) |
| Colisão entre `data`/`body` e membros padrão | Médio | D-07: membros padrão por último; teste de precedência |
| `data` com chaves `__proto__` | Baixo | Espalhar com `...` cria propriedades próprias, sem poluir o protótipo |
| `type` e `instance` não são validados como URI | Baixo | Sem validação, por decisão: a RFC pede URI reference, mas validar exigiria dependência ou regra nova. Documentar |
| `Content-Type` do usuário é sobrescrito | Baixo | D-04, documentado e testado |
| Erro reencapsulado em `new HTTPError({ cause })` perde o formato | Baixo | Limitação de D-01, documentada |
| Snapshot de exports muda | Baixo | Ajuste esperado do snapshot, permitido pelo PRD |
| Tabela de títulos pode ficar desatualizada | Baixo | Tabela pequena, só códigos comuns; sem título para os demais |
| `isolatedDeclarations` recusa `Object.assign` ou o tipo de retorno | Médio | Anotação explícita de retorno em `problem()` e `toProblemJSON()` (D-02) |
| Adoção parcial (PRD, risco já aceito) | — | Sem mitigação técnica; é o comportamento pedido |
