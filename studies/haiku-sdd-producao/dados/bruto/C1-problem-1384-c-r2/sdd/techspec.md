# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-08, premissas P1 a P5, riscos R1 a R5).

Esta especificação parte do código atual de `src/` e não altera nada do projeto. Todas as referências `arquivo:linha` foram conferidas lendo os arquivos nesta data.

---

## 1. Visão geral

Hoje, todo erro que chega ao fim do pipeline passa por `errorResponse` em `src/response.ts:358`, que serializa `HTTPError.toJSON()` com `Content-Type: application/json;charset=UTF-8`. A mudança acrescenta um caminho alternativo, ativado apenas por erros criados com `problem(input)`:

1. `problem(input)` cria um `HTTPError` normal e marca a instância com um símbolo interno não enumerável, guardando `type` e `instance`.
2. `errorResponse` consulta essa marca. Se ela existe, monta o corpo RFC 9457 e usa `application/problem+json`. Se não existe, o caminho atual roda sem nenhuma alteração.

A forma pública de `HTTPError` não muda. O único nome público novo é `problem`, mais o tipo de entrada `ProblemInput`.

---

## 2. Decisões de arquitetura

### D-01 — Marca do erro: símbolo `Symbol.for` não enumerável

**Decisão.** `problem` grava a marca com `Object.defineProperty(error, kProblem, { value: { type, instance } })`, onde `kProblem = Symbol.for("h3.problem")`. A propriedade fica não enumerável e não aparece em `Object.keys`, `JSON.stringify` nem em spreads.

**Por que.**
- Spread (`{ ...err }`) e `Object.assign` copiam apenas propriedades enumeráveis, então o marcador não vaza para outro erro que copie o objeto (R1 do PRD).
- `JSON.parse` não consegue criar um símbolo, então um corpo de requisição não consegue forjar a marca (mesma razão do `kHTTPResponse` em `src/response.ts:94-97`).
- `Symbol.for` faz a marca valer entre cópias duplicadas do módulo `h3`, o mesmo motivo do `kHTTPResponse`.
- O padrão já existe no código: `kEventRes`, `kEventResErrHeaders` (`src/event.ts:16-21`) e `kHTTPResponse` (`src/response.ts:94`).

**Alternativas consideradas.**
- *Subclasse `HTTPProblemError extends HTTPError`.* Exigiria uma classe extra, possivelmente exportada, e `isError` (`src/error.ts:129`) exige `name === "HTTPError"`, o que obrigaria a sobrescrever o getter `name` (`src/error.ts:75-77`). Mais superfície e mais risco que um símbolo.
- *`WeakSet<HTTPError>` de módulo.* Funciona, mas não atravessa cópias duplicadas do `h3` e exige um conjunto global.
- *Propriedade pública `problem` ou `type`/`instance` em `HTTPError`.* Muda a forma pública da classe, o que o PRD veta (fora de escopo: "alterar a classe `HTTPError`").
- *Símbolo enumerável.* Spread copiaria a marca, o que é exatamente o risco R1.

**Consequência.** RF-02 ("o erro resultante guarda esses dois valores") é atendido pela marca interna. Os valores não aparecem na API pública do erro; os testes verificam pelo corpo da resposta.

### D-02 — Localização: novo arquivo `src/problem.ts`

**Decisão.** `problem`, `ProblemInput`, `kProblem`, `getProblem` e `toProblemJSON` ficam em `src/problem.ts`. `src/index.ts` reexporta `problem` e `ProblemInput` a partir dele.

**Por que.** `src/error.ts` tem 237 linhas, e o `AGENTS.md` pede arquivos com menos de 200 linhas e "helpers no fim dos arquivos ou em `utils/internal/`". Colocar a lógica em `error.ts` aumentaria um arquivo que já está acima do alvo. `src/response.ts` já tem 380 linhas e não deve crescer além do necessário; nele só entram as duas linhas de ramificação dentro de `errorResponse`.

**Alternativas consideradas.**
- *Tudo em `src/error.ts`.* Mais simples de importar, mas piora o tamanho do arquivo.
- *Em `src/utils/problem.ts`.* Se o símbolo e `getProblem` precisam ser usados por `response.ts`, o módulo fica em `src/` pela mesma razão que `error.ts`: é núcleo, não utilitário opcional.
- *`src/utils/internal/problem.ts`.* Serve para helpers internos, mas `problem` precisa ser exportado publicamente. Partir o módulo entre `utils/` e `utils/internal/` não traz ganho.

**Dependências.** `src/problem.ts` importa de `./error.ts`. `src/response.ts` importa de `./problem.ts`. Não há ciclo, porque `error.ts` não importa nada de `response.ts` nem de `problem.ts`.

### D-03 — Mapeamento de campos (premissa P2)

**Decisão.**

| Membro RFC 9457 | Origem | Quando ausente |
|---|---|---|
| `type` | `input.type` | `"about:blank"` (RF-04) |
| `title` | `error.statusText` | membro omitido |
| `status` | `error.status` | sempre presente (já sanitizado por `sanitizeStatusCode`, `src/utils/sanitize.ts:17`) |
| `detail` | `error.message` | omitido quando `unhandled` (D-05) |
| `instance` | `input.instance` | membro omitido |

**Por que o `title` sem tabela de frases.** O PRD (P2) pede `title` = texto padrão do status quando `statusText` está ausente. O repositório não tem tabela de frases de status (busca por `Not Found`, `reasonPhrase`, `STATUS_CODES` sem resultado de tabela; só aparece `-32_004; // Not Found` em `src/utils/json-rpc.ts:522`). Criar uma tabela agora adicionaria dezenas de linhas de dados sem decisão do dono do projeto. Por isso a implementação segue assim: `title` = `statusText` quando existe, e omitido quando não existe. A RFC 9457 torna `title` opcional (RECOMMENDED), então a omissão é válida. **Esta é a parte de P2 que precisa de confirmação**; ver seção 8.

**Alternativas consideradas.**
- *Tabela de frases padrão (IANA) para `title`.* Fiel ao PRD P2, mas adiciona código e dados que o projeto não tem hoje.
- *`title` = `message`.* Duplica `detail` e confunde os significados que a RFC separa.

### D-04 — Membros de extensão e precedência

**Decisão.** Ordem de montagem do corpo, em `toProblemJSON`:

1. Membros de extensão, na ordem: se `data` é objeto simples (não nulo, não array), espalha suas chaves; se `data` é outro valor definido, grava como membro `data`. Depois espalha `body` (como `HTTPError.toJSON` faz em `src/error.ts:234`, `body` sobrescreve `data`).
2. Membros reservados por último: `type`, `title`, `status`, `detail`, `instance`, e `stack` no modo `debug`. Assim, uma chave `status` dentro de `data` não substitui o status HTTP.

Valores `undefined` são descartados pelo `JSON.stringify`, então `title`, `instance` e `detail` omitidos simplesmente não aparecem.

**Por que.** RF-04 pede `data` espalhado no nível superior ("sem um membro `data` aninhado"). Os membros reservados têm que vencer para o corpo continuar válido como problem details.

**Alternativas consideradas.**
- *Espalhar qualquer `data` com `Object.assign`.* Quebra com `data` string ou array: o espalhamento de string produz chaves numéricas.
- *Sempre gravar `data` como membro nomeado.* Contraria RF-04.
- *Deixar `data` reservado e rejeitar valores não objeto na criação.* Mais restritivo do que o pedido; o PRD não pede validação de extensões (fora de escopo).

**Caso não coberto pelo PRD.** `data` primitivo ou array não é espalhado. A escolha de gravar como `data` é uma decisão minha; ver seção 8.

### D-05 — Erros `unhandled` (RF-06)

**Decisão.** Com `error.unhandled === true`:
- `detail` é omitido (equivale a `message: "HTTPError"` em `src/error.ts:232`, mas sem repetir um nome fixo, porque a RFC não exige `detail`).
- `data` e `body` não entram no corpo (mesma regra de `src/error.ts:233-234`).
- `title`, `type`, `instance` e `status` continuam, como `statusText` continua em `toJSON` (`src/error.ts:228-231`).
- `stack` só aparece com `debug`, como hoje (`src/response.ts:369`).

**Por que.** Espelha exatamente a regra que já existe para `HTTPError`. `type` e `instance` são escritos pelo próprio handler, então não são dados de cliente; ainda assim, `instance` pode conter caminhos internos. Ver R2 na seção 7.

### D-06 — Cabeçalhos e `Content-Type` (RF-03, RF-07)

**Decisão.**
- O corpo problem usa `Content-Type: application/problem+json`, sem parâmetro `charset`. O JSON é UTF-8 por definição, e a RFC 9457 nomeia o media type sem parâmetro.
- Os `headers` da entrada são mesclados (`mergeHeaders`, `src/response.ts:243`), e depois o `content-type` é fixado em `application/problem+json`. Assim, um `headers: { "Content-Type": ... }` informado pelo handler não troca o media type. Esta é uma escolha minha; ver seção 8.
- `errHeaders` (`event.res.errHeaders`, `src/event.ts:19-21`) continua mesclado no fim, exatamente como em `errorResponse` hoje (`src/response.ts:362-364`).

**Por que a ordem.** O `Content-Type` deve ser verdadeiro para o corpo que está sendo enviado. `errHeaders` vem por último porque é uma escolha explícita de quem escreveu o middleware.

**Alternativas consideradas.**
- *Deixar `headers` sobrescrever o `Content-Type`.* Permite produzir `application/json` com corpo problem por engano.
- *Usar `application/problem+json;charset=UTF-8`, espelhando `jsonHeaders`.* Diverge do media type nomeado no RF-03.

### D-07 — Lançar ou retornar, e `onError` (P3)

**Decisão.** `problem` só constrói o erro (P3). Ele é lançado ou retornado como `HTTPError`. O fluxo de `prepareResponse` (`src/response.ts:146-174`) não muda: `HTTPError.isError(val)` é verdadeiro para o erro de `problem`, então ele entra no mesmo caminho. Se `onError` (`src/response.ts:159-165`) devolver outro valor, a marca não está mais presente e a resposta usa o formato antigo. Esse é o comportamento esperado para um hook que substitui o erro.

**Por que.** Não criar um segundo caminho de erro. Quem decide o formato é a marca; quem decide o valor é o handler ou `onError`.

### D-08 — Superfície pública

**Decisão.** Exportações novas, somente:
- `problem` (função)
- `ProblemInput` (tipo, reexportado em `src/index.ts` junto de `ErrorInput`, `src/index.ts:72`)

`kProblem`, `getProblem` e `toProblemJSON` são exportados apenas para uso entre módulos internos e não entram em `src/index.ts`. `test/unit/package.test.ts` lista apenas nomes de runtime, então o tipo não altera o snapshot; só `problem` altera.

---

## 3. Arquivos a alterar

### 3.1 `src/problem.ts` (novo)

Conteúdo previsto: tipo `ProblemInput`, símbolo `kProblem`, função `problem`, helper `getProblem` e helper `toProblemJSON`. Ver seção 4 para as assinaturas.

Referências usadas:
- `src/error.ts:6` — `ErrorInput`, que `ProblemInput` estende.
- `src/error.ts:74` — `HTTPError`, instanciado por `problem`.
- `src/error.ts:162` — construtor, que aceita `ErrorDetails`, incluindo o `ErrorInput` sem `type` e `instance`.
- `src/error.ts:226-236` — `toJSON`, cuja regra de `unhandled` é espelhada em D-05.
- `src/event.ts:14` — convenção `kEventNS` para nomes de símbolos internos (`Symbol.for`).

### 3.2 `src/response.ts` (alteração pequena)

- `src/response.ts:358-380` — `errorResponse`. É o único ponto que muda:
  - detectar a marca com `getProblem(error)`;
  - escolher o corpo: `toProblemJSON(error, debug)` no caso problem; `{ ...error.toJSON(), stack: ... }` no caso atual (`src/response.ts:368-369`, sem mudança);
  - escolher os cabeçalhos base: `problemHeaders` (um `FrozenHeaders` com `content-type: application/problem+json`, na mesma forma de `jsonHeaders`, `src/response.ts:270-272`) ou `jsonHeaders`;
  - fixar `content-type` depois de `mergeHeaders(..., error.headers)`, no caso problem (D-06).
- `src/response.ts:173` — a chamada `errorResponse(error, config.debug, errHeaders)` não muda.
- `src/response.ts:146-158` — não muda. O erro `problem` já é `HTTPError`, então `error.unhandled` e o `console.error` (`src/response.ts:156-158`) continuam como estão.

Nenhuma outra linha de `response.ts` muda. O caminho de `HTTPResponse`, `kHandled`, `kNotFound` e `toError` (`src/response.ts:73-83`) fica intacto.

### 3.3 `src/index.ts` (reexportação)

Adicionar após `src/index.ts:72`:

```ts
export { problem, type ProblemInput } from "./problem.ts";
```

O bloco `// Error` (`src/index.ts:70-72`) é o lugar natural.

### 3.4 `src/error.ts` (sem alteração)

Nenhuma mudança é necessária. `ErrorInput` (`src/error.ts:6`) já é exportado e cobre os campos pedidos em RF-02. `HTTPError` não muda (D-01, D-08).

### 3.5 `test/problem.test.ts` (novo)

Teste de integração com `describeMatrix` (`test/_setup.ts:11`), no mesmo padrão de `test/errors.test.ts:9`. Ver seção 6.

### 3.6 `test/unit/package.test.ts` (snapshot)

Adicionar `"problem",` no snapshot inline, entre `"parseCookies",` (`test/unit/package.test.ts:104`) e `"proxy",` (`test/unit/package.test.ts:105`). A ordem é alfabética (`"problem"` vem antes de `"proxy"` porque `b` < `x`). Essa é uma mudança intencional, não um ajuste para fazer o teste passar.

### 3.7 `test/unit/types.test-d.ts` (tipos)

Adicionar verificação de tipo para `ProblemInput` (campos `type` e `instance` opcionais, herança de `ErrorInput`) e para o retorno de `problem` (`HTTPError<DataT>`). Ver seção 6.

---

## 4. Contratos e assinaturas

```ts
// src/problem.ts

import { HTTPError, type ErrorInput } from "./error.ts";

/**
 * Input of {@link problem}: every `HTTPError` input field plus the RFC 9457 members `type` and `instance`.
 */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** RFC 9457 `type` URI reference. Defaults to `about:blank` in the response body. */
  type?: string;
  /** RFC 9457 `instance` URI reference, identifying this occurrence of the problem. */
  instance?: string;
}

/** Internal: RFC 9457 members kept on the error. Not exported from `src/index.ts`. */
export interface ProblemDetails {
  type?: string;
  instance?: string;
}

/** Internal marker key. `Symbol.for` so it matches across duplicate h3 copies, like `kHTTPResponse`. */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

/**
 * Create an `HTTPError` whose response is rendered as `application/problem+json`.
 *
 * Only the returned error changes. Errors built with `new HTTPError(...)` keep their current format.
 */
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;

/** Internal: problem details recorded on an error by {@link problem}, or `undefined`. */
export function getProblem(error: HTTPError): ProblemDetails | undefined;

/** Internal: RFC 9457 body for an error built by {@link problem}. */
export function toProblemJSON(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Corpo da implementação de `problem`, em forma de contrato (não é o código final):

```ts
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...errorInput } = input;
  const error = new HTTPError<DataT>(errorInput);
  Object.defineProperty(error, kProblem, {
    value: { type, instance } satisfies ProblemDetails,
  });
  return error;
}
```

Notas:
- `isolatedDeclarations` (`AGENTS.md`, seção TypeScript) exige tipo de retorno explícito em `problem`, `getProblem` e `toProblemJSON`. Os tipos acima já o fazem.
- `Object.defineProperty` sem `enumerable`, `writable` ou `configurable` deixa a propriedade não enumerável e não configurável. É o comportamento desejado.
- O erro é criado com `errorInput` sem `type`/`instance`, então `cause` (`src/error.ts:197`) não guarda esses campos. Isso evita duplicar dados na cadeia de causa.

Corpo previsto de `toProblemJSON`:

```ts
export function toProblemJSON(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const { type, instance } = getProblem(error)!;
  const unhandled = error.unhandled;
  const extensions = unhandled ? {} : { ...extensionMembers(error.data), ...error.body };
  return {
    ...extensions,
    type: type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

`extensionMembers(data)` retorna `data` quando é objeto simples, `{}` quando `data` é `undefined`, e `{ data }` nos outros casos (D-04).

Mudança em `errorResponse` (`src/response.ts:358`), em forma de contrato:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problem = getProblem(error);
  let headers: Headers = error.headers
    ? mergeHeaders(problem ? problemHeaders : jsonHeaders, error.headers)
    : new Headers(problem ? problemHeaders : jsonHeaders);
  if (problem) {
    headers.set("content-type", "application/problem+json");
  }
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = problem
    ? toProblemJSON(error, debug)
    : { ...error.toJSON(), stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined };
  return new FastResponse(JSON.stringify(body, undefined, debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

Com `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json" })`, declarado junto de `jsonHeaders` (`src/response.ts:270-272`).

O ramo `getProblem(error) === undefined` produz exatamente o mesmo corpo e os mesmos cabeçalhos de hoje. Os testes existentes em `test/errors.test.ts` cobrem esse caminho (ver seção 6).

---

## 5. Fluxo de execução

1. Handler faz `throw problem({...})` ou `return problem({...})`.
2. `toResponse` (`src/response.ts:13`) recebe o valor. Se for promise, aguarda; depois chama `prepareResponse`.
3. `prepareResponse` (`src/response.ts:146`): `HTTPError.isError` é verdadeiro. Se `unhandled`, loga como hoje (`src/response.ts:156-158`).
4. Se `onError` está configurado (`src/response.ts:159-165`), ele roda com o mesmo erro. O valor retornado segue o fluxo normal.
5. `errorResponse` detecta a marca e monta o corpo problem (D-04 a D-06).
6. A resposta sai com `Content-Type: application/problem+json`.

---

## 6. Estratégia de testes

Seguindo `AGENTS.md`: os testes novos rodam nos modos `web` e `node` com `describeMatrix`, e cada teste de comportamento deve falhar antes da implementação.

### 6.1 `test/problem.test.ts` (novo)

Um teste por requisito. Nomes em inglês, no estilo de `test/errors.test.ts`.

| Caso | Requisito | Verificação |
|---|---|---|
| `problem()` devolve `HTTPError` com `status` e `message` | RF-01 | `expect(err).toBeInstanceOf(HTTPError)`, `err.status === 404`, `err.message === ...` |
| `type` e `instance` chegam ao corpo | RF-02, RF-03 | status 422, `content-type` exato `application/problem+json`, corpo com `type`, `instance`, `status`, `detail` |
| `type` padrão é `about:blank` | RF-04 | corpo sem `type` informado tem `"type": "about:blank"` |
| `data` espalhado no nível superior | RF-04 | `problem({ status: 409, message: "Conflito", data: { campo: "email" } })` → `campo: "email"` e sem chave `data` |
| `body` espalhado no nível superior | D-04 | `body: { topLevel: 1 }` aparece no corpo |
| membros reservados vencem extensões | D-04 | `data: { status: 1, detail: "x" }` não altera `status` nem `detail` |
| `data` primitivo vai como `data` | D-04 | `data: "texto"` → corpo com `"data": "texto"` |
| `unhandled` esconde `detail`, `data`, `body` | RF-06 | `problem({ status: 500, unhandled: true, message: "segredo", data: { senha: "x" } })` → corpo sem `segredo` nem `senha`, status 500 |
| `headers` aplicados, `Content-Type` fixo | RF-07 | `Retry-After: 30` presente; `content-type` continua `application/problem+json` mesmo com `headers: { "Content-Type": "text/plain" }` |
| `new HTTPError` continua no formato antigo | RF-05, R1 | mesmo `content-type` `application/json;charset=UTF-8` e mesmo corpo de `test/errors.test.ts:67-86` |
| spread não copia a marca | R1 | `{ ...problemErr }` renderizado como `new HTTPError` (formato antigo) |
| marca não aparece em JSON | D-01 | `JSON.stringify(err)` não contém `h3.problem`; `Object.keys(err)` não inclui o símbolo |
| `throw` e `return` produzem o mesmo corpo | P3 | dois handlers, mesmo corpo |
| `onError` que devolve outro valor usa o formato antigo | D-07 | `onError` retorna `new HTTPError(...)` → `application/json` |
| `onError` que devolve o próprio erro mantém o formato | D-07 | `onError` retorna `error` → `application/problem+json` |
| HEAD sem corpo | cobertura | `HEAD` com problem: status correto, sem corpo |
| `errHeaders` mesclado | D-06 | `event.res.errHeaders.set("x-error", "prepared")` aparece na resposta problem |

Todos os testes usam `t.fetch`, `t.app` e `t.hooks` do `describeMatrix`, no padrão de `test/errors.test.ts`.

### 6.2 Ajustes em testes existentes

- `test/unit/package.test.ts:104-105` — adicionar `"problem"` ao snapshot (mudança intencional, seção 3.6).
- Nenhum outro teste existente precisa mudar. `test/errors.test.ts` testa o caminho que não muda, e deve continuar passando sem alteração. Se algum falhar, a implementação quebrou o formato antigo e isso deve ser corrigido no código, não no teste.

### 6.3 Testes de tipo — `test/unit/types.test-d.ts`

- `ProblemInput` aceita `type` e `instance` como `string` opcionais.
- `ProblemInput` aceita tudo que `ErrorInput` aceita (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`).
- `problem({ status: 404, message: "x" })` retorna `HTTPError`.
- `problem<{ campo: string }>({ data: { campo: "x" }, status: 400 })` retorna `HTTPError<{ campo: string }>`.

### 6.4 Comandos de verificação

```bash
pnpm vitest run test/problem.test.ts          # novos testes (devem falhar antes da implementação)
pnpm vitest run test/errors.test.ts test/unit/package.test.ts   # regressão e snapshot
pnpm vitest run                               # suíte completa
pnpm lint                                     # oxlint + oxfmt --check
pnpm typecheck                                # tsc --noEmit
```

A ordem de execução é: escrever `test/problem.test.ts` e o snapshot; rodar e ver os testes novos falharem; implementar `src/problem.ts`, `src/response.ts` e `src/index.ts`; rodar de novo até passar.

---

## 7. Riscos

| ID | Risco | Mitigação na especificação |
|---|---|---|
| R1 | Marca copiada por spread ou serialização passa o erro para o formato problem por engano | D-01: símbolo não enumerável. Testes "spread não copia a marca" e "marca não aparece em JSON" (seção 6.1). |
| R2 | `data`, `body`, `detail` ou `stack` vazam em erro `unhandled` | D-05 e teste de RF-06. `type` e `instance` continuam visíveis em erros `unhandled`; se o dono quiser escondê-los, é uma mudança de uma linha em `toProblemJSON`. |
| R3 | P2 rejeitada pelo dono do projeto (`title` e `detail`) | D-03 deixa o `title` sem frase padrão e o `detail` = `message`. Se P2 mudar, só `toProblemJSON` muda e os testes de corpo são refeitos. Confirmar antes de implementar (PRD R3). |
| R4 | Pedidos de novas opções (registro de `type`, negociação por `Accept`) | Fora de escopo, conforme PRD. Nenhum código de negociação entra nesta mudança. |
| R5 | Colisão do nome `problem` com exports existentes | Verificado: nenhum `problem` exportado em `src/index.ts`, `src/_deprecated.ts` ou nos módulos reexportados. `src/tracing.ts:93` e `test/rules/scope.test.ts:75` usam a palavra só em comentários. |
| R6 | `data` com chaves reservadas ou valores não objeto gera corpo inválido | D-04: reservados vencem; não objeto vai como `data`. Testes na seção 6.1. |
| R7 | `Content-Type` sobrescrito por `headers` informado pelo handler | D-06: `content-type` fixado depois da mesclagem. Teste em seção 6.1. |
| R8 | Snapshot de exports quebra | É a única mudança de snapshot, intencional (seção 3.6). |
| R9 | `src/response.ts` ultrapassa o limite de tamanho do `AGENTS.md` | Já está em 380 linhas, acima do alvo de 200. A mudança acrescenta poucas linhas e a lógica de corpo fica em `src/problem.ts` (D-02). Não é tarefa desta mudança dividir `response.ts`. |
| R10 | `onError` que devolve outro erro perde o formato problem sem aviso | Comportamento intencional (D-07), coberto por teste. Documentar no JSDoc de `problem`. |
| R11 | Ambiente: o PRD (P5) pressupõe que `pnpm install` e os comandos funcionam neste clone | Não verificado nesta etapa: a tarefa não rodou comandos. Confirmar antes da implementação. |

---

## 8. Pontos que precisam de confirmação do dono do projeto

1. **P2 — `title`.** Implementado como `statusText` ou omitido, sem tabela de frases padrão (D-03). Se o dono quiser a frase padrão, é preciso decidir se uma tabela pequena entra no código.
2. **`data` não objeto.** Gravado como membro `data` (D-04). A alternativa é descartar silenciosamente, o que perderia informação.
3. **`headers` com `Content-Type`.** O `Content-Type` problem vence (D-06). A alternativa é deixar o handler escolher.
4. **`type` e `instance` em erro `unhandled`.** Mantidos (D-05). Se o dono preferir escondê-los, muda uma linha.
5. **`stack` em modo `debug`.** Mantido, como no formato atual (D-05).

Se o dono não responder, a implementação segue as escolhas acima, que são as que mais se aproximam do PRD e da RFC 9457, e cada uma está isolada em `toProblemJSON` ou em `errorResponse`.
