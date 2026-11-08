# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-09), issue h3js/h3#1384.

Este documento parte do código atual de `src/` (v2) e não altera nada no projeto. Todas as citações `arquivo:linha` foram conferidas com leitura direta do código.

## 1. Visão geral

`problem(input)` é um construtor de `HTTPError` marcado. Quando esse erro chega a `toResponse` (via `throw`, `return` ou `onError`), o ramo de serialização de erros em `src/response.ts` troca apenas o `Content-Type` e o corpo para o formato RFC 9457. Erros criados por `new HTTPError(...)` e `createError(...)` seguem o caminho atual, sem nenhuma mudança.

Fluxo resultante:

1. Handler faz `throw problem({...})` ou `return problem({...})`.
2. `H3.fetch` → `toResponse` → `prepareResponse` (`src/response.ts:129`) reconhece o `HTTPError` (`src/response.ts:147`).
3. `errorResponse` (`src/response.ts:358`) detecta a marca de problem e monta headers `application/problem+json` e corpo RFC 9457.

## 2. Decisões de arquitetura

### D-01 — Marca de "problem" como símbolo não enumerável no próprio `HTTPError`

**Escolha:** `problem()` cria uma instância de `HTTPError` (mesma classe, `name` continua `"HTTPError"`) e grava a marca `kProblem = Symbol.for("h3.problem")` com valor `true`, via `Object.defineProperties` (não enumerável).

**Por quê:**
- `HTTPError.isError` (`src/error.ts:129`) depende de `name === "HTTPError"` e de `status`. Manter a classe preserva o reconhecimento entre módulos duplicados, que é a razão declarada da função (`src/error.ts:122-128`).
- `Symbol.for` segue o precedente de `kHTTPResponse` (`src/response.ts:94`), que existe justamente para que o símbolo não possa vir de JSON enviado pelo cliente e ainda funcione entre cópias do h3.
- Símbolo não aparece em `JSON.stringify`, então não contamina `toJSON` (`src/error.ts:226`).

**Alternativas consideradas:**
- *Subclasse `ProblemError extends HTTPError`*: funciona com `instanceof`, mas introduz hierarquia de classe (o projeto evita padrões class-heavy, `AGENTS.md`) e exigiria cuidado para não mudar `name`.
- *Propriedade string (`"~problem"`)*: forjável por qualquer objeto com essa chave; o precedente de `kHTTPResponse` mostra por que isso é um problema.
- *Propriedade enumerável*: vaza no `JSON.stringify` e em `...spread` de objetos de erro.

### D-02 — `type` e `instance` como propriedades não enumeráveis; tipo de retorno sem nome novo

**Escolha:** `problem()` define `type` (padrão `"about:blank"`) e `instance` como propriedades de instância não enumeráveis. O retorno é tipado como `HTTPError & { readonly type: string; readonly instance: string | undefined }`, sem exportar um nome novo (o PRD proíbe novos nomes públicos além de `problem` e `ProblemInput`).

**Por quê:** RF-02 exige que o erro "guarde" `type` e `instance`. Com a propriedade, o consumidor lê `err.type` sem API extra. `type` sempre é `string` no retorno, o que cumpre RF-04 sem tratamento adicional.

**Alternativas consideradas:**
- *Adicionar `type`/`instance` em `HTTPError`/`ErrorBody`*: muda o tipo público de `HTTPError` e de `ErrorBody` (quebra o RF-08 e o item "Quebra de tipos" do PRD) e alteraria o `toJSON` de todos os erros (quebra o RF-05).
- *Guardar só dentro do símbolo*: o consumidor não consegue ler os valores sem importar o símbolo, o que não atende RF-02.

### D-03 — Localização do código: `src/utils/problem.ts`, reexportado em `src/index.ts`

**Escolha:**
- Novo arquivo `src/utils/problem.ts` com `problem`, `ProblemInput`, `kProblem`, `isProblemError` e `toProblemJSON`.
- Reexportação em `src/index.ts`, na seção `// Error` (`src/index.ts:70-72`), logo abaixo de `HTTPError`.

**Por quê:**
- `src/error.ts` já tem 237 linhas, acima do alvo de "< 200 LoC" do `AGENTS.md`. Adicionar a lógica ali agravaria isso.
- `src/utils/` é a superfície pública documentada (`AGENTS.md`, seção Project Structure). O utilitário é uma função `define*`/utilitária dessa natureza.
- Não há dependência circular: `utils/problem.ts` importa só `error.ts` e `utils/internal/status-text.ts`; `response.ts` importa `utils/problem.ts`.

**Alternativa considerada:** colocar tudo em `src/error.ts`. Descartada pelo limite de tamanho acima.

Os entries de runtime (`src/_entries/generic.ts`, `node.ts`, `bun.ts`, `cloudflare.ts`, `deno.ts`, `service-worker.ts`) fazem `export * from "../index.ts"`, então basta a reexportação em `index.ts`.

### D-04 — Serialização num ramo de `errorResponse`, sem alterar `toJSON`

**Escolha:** em `errorResponse` (`src/response.ts:358`), escolher entre `problemHeaders` (novo) e `jsonHeaders` (`src/response.ts:270`) como base de headers, e entre `toProblemJSON(error)` e `error.toJSON()` como corpo. O restante (merge de `error.headers`, `errHeaders`, `stack` em debug, `status`, `statusText`) não muda.

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

**Por quê:**
- Mantém um único ponto de serialização de erro: `errorResponse` continua sendo o responsável pelos headers de erro (incluindo `errHeaders`, que o `onError` depende; `src/response.ts:160-173`).
- `toJSON` continua sendo o formato de `HTTPError` comum, o que preserva RF-05 sem condicionais no método.

**Alternativas consideradas:**
- *Sobrescrever `toJSON` quando marcado*: mistura formatos no mesmo método e faz `JSON.stringify(err)` mudar de formato sem necessidade.
- *Tratar em `onError` ou no `H3`*: duplicaria a lógica de `errHeaders` e de ocultação de `unhandled`.

O `Content-Type` é exatamente `application/problem+json`, sem `charset` (PRD, "Premissas"). Diferente de `jsonHeaders` (`src/response.ts:271`), que tem `charset=UTF-8`.

### D-05 — Mapeamento dos membros e ocultação de erros `unhandled`

**Escolha:** `toProblemJSON(error)` devolve:

| Membro | Valor |
| --- | --- |
| `type` | `error.type` (sempre definido; padrão `about:blank`) |
| `title` | `error.statusText`, ou o texto padrão do status (D-06); omitido se nenhum for conhecido |
| `status` | `error.status` |
| `detail` | `error.message`; **omitido** quando `error.unhandled` |
| `instance` | `error.instance`; omitido quando `undefined` |
| `data` | `error.data`; **omitido** quando `unhandled` |
| demais chaves de `body` | espalhadas; **omitidas** quando `unhandled` |

Ordem de montagem: primeiro os membros de extensão (`body` e `data`), depois os membros padrão. Assim, uma chave de `body` com nome igual a um membro padrão (`type`, `title`, `status`, `detail`, `instance`) nunca sobrescreve o padrão (RF-07).

`stack` continua sendo acrescentada apenas em `debug`, como hoje (`src/response.ts:369`). Ela é um membro de extensão e não viola RF-06, porque RF-06 cobre erros `unhandled` e `debug` já é o modo de desenvolvimento.

**Por quê:** segue `HTTPError.toJSON` (`src/error.ts:226-236`), que já oculta `message`, `data` e `body` quando `unhandled`. Só muda o nome da chave (`message` vira `detail`).

### D-06 — Textos padrão de status: tabela interna

**Escolha:** `src/utils/internal/status-text.ts` com uma tabela `Record<number, string>` dos textos registrados pelo IANA para os códigos mais comuns (4xx e 5xx, e os 2xx/3xx usados em APIs), no mesmo estilo de `COMMON_MIME_TYPES` (`src/utils/internal/mime.ts:2`). Função exportada internamente: `getStatusText(status: number): string | undefined`.

**Por quê:** RF-04 exige `title` = texto padrão quando `statusText` não é informado. Não há tabela no projeto (busca por `Internal Server Error`/`STATUS_CODES` retornou nada em `src/`).

**Alternativas consideradas:**
- *`STATUS_CODES` de `node:http`*: não é web standard e quebra o suporte a Workers/Deno/browser (`AGENTS.md`, "Multi-runtime").
- *`new Response(null, { status }).statusText`*: não é confiável, porque runtimes como Node/undici retornam string vazia.
- *Deixar `title` vazio sempre*: viola RF-04.

Para códigos fora da tabela, `title` é omitido. RFC 9457 não exige `title` quando não há resumo confiável.

### D-07 — Entrada `ProblemInput` como extensão de `ErrorInput`

**Escolha:**

```ts
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference do tipo do problema. Padrão: `about:blank`. */
  type?: string;
  /** URI reference da ocorrência específica. */
  instance?: string;
}
```

**Por quê:** `ErrorInput` não muda (RF-08). `ProblemInput` é aditivo e aceita tudo o que `HTTPError` aceita, incluindo os campos depreciados `statusCode` e `statusMessage` (`src/error.ts:17-25`).

**Alternativa considerada:** adicionar `type`/`instance` a `ErrorInput`. Descartada: `ErrorInput` é o tipo de `ErrorDetails` (`src/error.ts:28`), usado por `HTTPError`, `createError` e `validate.ts`; mudá-lo espalharia campos que não fazem sentido para erros comuns.

### D-08 — Propagação da marca: identidade do objeto, não cópia

**Escolha:** a marca vale enquanto o mesmo objeto de erro chega a `errorResponse`. Isso cobre `throw`, `return`, e o `onError` que devolve o próprio erro recebido (`src/response.ts:161-165`). Um `new HTTPError(problemErr)` (ou `createError(problemErr)`) **não** herda a marca, porque o construtor copia apenas `status`, `statusText`, `headers` e `unhandled` do `cause` (`src/error.ts:172-206`).

**Por quê:** é o comportamento que já existe para qualquer propriedade não copiada pelo construtor. Herdar a marca por cópia exigiria mudar o construtor de `HTTPError`, o que contraria D-02.

**Consequência a documentar:** um `onError` que embrulha o erro em um `HTTPError` novo devolve o formato antigo. Isso é esperado pela escopo do PRD ("só `problem(...)` muda o formato").

## 3. Contratos e assinaturas

### 3.1 `src/utils/problem.ts` (novo)

```ts
import { HTTPError, type ErrorInput } from "../error.ts";
import { getStatusText } from "./internal/status-text.ts";

/** Marca interna de erro criado por `problem()`. `Symbol.for` para valer entre cópias do h3. */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference do tipo do problema. Padrão: `about:blank`. */
  type?: string;
  /** URI reference da ocorrência específica. */
  instance?: string;
}

/**
 * Cria um `HTTPError` que é serializado como `application/problem+json` (RFC 9457).
 *
 * @example
 * throw problem({ status: 404, message: "Usuário não encontrado" });
 */
export function problem<DataT = unknown>(
  input: ProblemInput<DataT>,
): HTTPError<DataT> & { readonly type: string; readonly instance: string | undefined };

/** Verdadeiro para erros criados por `problem()`. */
export function isProblemError(input: unknown): boolean;

/** Corpo RFC 9457 de um erro criado por `problem()`. Usado por `errorResponse`. */
export function toProblemJSON(error: HTTPError): Record<string, unknown>;
```

Notas de implementação:
- `problem` faz `new HTTPError(input)` e depois `Object.defineProperties(error, { [kProblem]: { value: true }, type: { value: input.type ?? "about:blank" }, instance: { value: input.instance } })`. Propriedades não enumeráveis por padrão.
- `isProblemError` retorna `input instanceof HTTPError && (input as any)[kProblem] === true`. Ver a seção de riscos sobre `instanceof` e o `HTTPError.isError` existente.
- `toProblemJSON` é a única fonte da forma do corpo (D-05).
- Os tipos de `type` e `instance` que `toProblemJSON` lê precisam de um cast local, porque `HTTPError` não os declara. Esse cast fica dentro do arquivo.

### 3.2 `src/utils/internal/status-text.ts` (novo)

```ts
/** Texto padrão do status HTTP (IANA). `undefined` quando o código não está na tabela. */
export function getStatusText(status: number): string | undefined;
```

### 3.3 `src/response.ts` — alteração em `errorResponse`

Assinatura inalterada (`src/response.ts:358`). Mudança de corpo:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problem = isProblemError(error);
  let headers: Headers = error.headers
    ? mergeHeaders(problem ? problemHeaders : jsonHeaders, error.headers)
    : new Headers(problem ? problemHeaders : jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...(problem ? toProblemJSON(error) : error.toJSON()),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Com isso `problemHeaders` é declarado junto de `jsonHeaders` (`src/response.ts:270-272`), no mesmo padrão `FrozenHeaders`.

### 3.4 `src/index.ts`

Na seção `// Error` (`src/index.ts:70-72`), exportar **somente** `problem` e o tipo `ProblemInput`. `isProblemError` e `kProblem` ficam internos (importados por `response.ts` diretamente de `utils/problem.ts`). Isso respeita o PRD: "Nenhum outro nome público novo além de `problem` e do tipo da sua entrada".

```ts
// Error
export { type ErrorDetails, type ErrorBody, type ErrorInput, HTTPError } from "./error.ts";
export { type ProblemInput, problem } from "./utils/problem.ts";
```

### 3.5 Não muda

- `src/error.ts`: `ErrorInput`, `ErrorBody`, `HTTPError` (construtor, `toJSON`, `isError`) ficam como estão (RF-05, RF-08).
- `src/_deprecated.ts`: `createError` e `isError` ficam como estão (PRD: "Alterações em `_deprecated.ts`" fora do escopo).
- `src/utils/internal/validate.ts`: erros de validação não mudam (PRD, fora de escopo).

## 4. Arquivos a alterar

| Arquivo | Mudança | Referência |
| --- | --- | --- |
| `src/utils/problem.ts` | **novo**: `problem`, `ProblemInput`, `kProblem`, `isProblemError`, `toProblemJSON` | D-01 a D-05, §3.1 |
| `src/utils/internal/status-text.ts` | **novo**: tabela e `getStatusText` | D-06, §3.2 |
| `src/response.ts` | `errorResponse` ganha ramo problem (`src/response.ts:358-380`); `problemHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`) | D-04, §3.3 |
| `src/index.ts` | reexportar `problem` e `ProblemInput` na seção de erro (`src/index.ts:70-72`) | D-03, §3.4 |
| `test/problem.test.ts` | **novo**: testes de comportamento (`describeMatrix`), RF-01 a RF-07 | §5 |
| `test/unit/types.test-d.ts` | acrescentar checagem de tipo: `ProblemInput` aceita `ErrorInput` e `type`/`instance`; `problem(...)` retorna `HTTPError` com `type: string` | RF-08, §5 |
| `test/unit/package.test.ts` | atualizar o snapshot inline: adicionar `"problem"` entre `"parseCookies"` (`test/unit/package.test.ts:104`) e `"proxy"` (`test/unit/package.test.ts:105`) | RF-09, §5 |
| `docs/1.guide/1.basics/6.error.md` | seção curta sobre `problem()`, o formato, e a nota de que só o utilitário muda o formato (mitigação de "dois formatos no mesmo app", PRD) | §6 |
| `AGENTS.md` | acrescentar `problem.ts` em `utils/` na Project Structure (`AGENTS.md`, seção Project Structure) e `status-text.ts` em `utils/internal/`; o próprio arquivo pede manter a estrutura atualizada | Convenções do projeto |

Os testes existentes em `test/errors.test.ts` não precisam mudar. Eles verificam `application/json;charset=UTF-8` para `HTTPError` comum (`test/errors.test.ts:44`, `:140`), e esse comportamento permanece.

## 5. Estratégia de testes

Seguir o padrão de `AGENTS.md` ("Writing Tests") e o Bug Fix Workflow para a parte de regressão. Como é uma funcionalidade nova, o fluxo é "teste primeiro" para cada RF.

### 5.1 `test/problem.test.ts` (novo, `describeMatrix`, roda em `web` e `node`)

| Teste | RF | Verificação |
| --- | --- | --- |
| `problem()` devolve `HTTPError` com `status` e `message` | RF-01 | `instanceof HTTPError`, `status === 404`, `message` igual |
| `type` e `instance` ficam no erro | RF-02 | `err.type`, `err.instance`; entrada sem eles tem `type === "about:blank"` |
| Resposta completa | RF-03 | exemplo do PRD: status 422, `content-type` exatamente `application/problem+json`, corpo com `type`, `title`, `status`, `detail`, `instance` |
| Padrões | RF-04 | `problem({status: 500, message})` → `type: "about:blank"`, `title: "Internal Server Error"` |
| `HTTPError` comum mantém formato | RF-05 | `new HTTPError({status: 400, message})` → `content-type` `application/json;charset=UTF-8`, corpo com `statusCode`/`statusMessage`/`message`, sem `title` |
| `unhandled` oculta | RF-06 | `problem({status: 500, message: "segredo do banco", unhandled: true})` → corpo sem `"segredo do banco"` e sem `stack` (checar string no `res.text()`) |
| `data` e `body` como extensão | RF-07 | `data: {campo: "email"}` aparece; `body: {type: "x"}` não sobrescreve `type` |
| `HEAD` | (complementar a RF-03) | sem corpo, `content-type` `application/problem+json` mesmo assim |
| `onError` devolvendo o mesmo erro | (D-08) | `onError` com o erro recebido → formato problem preservado |
| `new HTTPError(problemErr)` perde a marca | (D-08) | resposta em `application/json` (documenta a decisão) |
| `errHeaders` e `headers` do erro | (D-04) | `event.res.errHeaders` continua mesclado; `headers` do erro entram |

Para o caso `unhandled` (RF-06), o teste deve falhar se o `detail` vazar. Usar `expect(text).not.toContain("segredo do banco")`.

### 5.2 `test/unit/types.test-d.ts` (acrescentar)

- `expectTypeOf<ProblemInput>().toMatchTypeOf<ErrorInput>()` (ou equivalente do vitest v4 usado no arquivo).
- `expectTypeOf(problem({ status: 400, message: "x" })).toMatchTypeOf<HTTPError>()`.
- `expectTypeOf(problem({ status: 400 }).type).toEqualTypeOf<string>()`.
- Entrada de `HTTPError` (`new HTTPError({ status: 400, message: "x" })`) continua aceita sem mudança.

### 5.3 `test/unit/package.test.ts`

O snapshot inline (`test/unit/package.test.ts:4`) precisa receber `"problem"`. É uma atualização que o PRD prevê (RF-09, "ajuste só o ponto afetado"). `ProblemInput` é só tipo e não aparece no snapshot.

### 5.4 `test/unit/status-text.test.ts` (novo, opcional mas recomendado)

Cobrir: códigos da tabela retornam o texto; código fora da tabela retorna `undefined`; `400`, `404`, `422`, `500` têm textos certos.

### 5.5 Comandos de verificação

```bash
pnpm vitest run test/problem.test.ts
pnpm vitest run test/unit/
pnpm vitest run                 # suíte completa, RF-09
pnpm typecheck                  # RF-08
pnpm lint                       # RF-08
pnpm build && pnpm vitest run test/dist.test.ts   # opcional: confirma o bundle
```

Ordem de trabalho: escrever `test/problem.test.ts` primeiro e confirmar que falha (`pnpm vitest run test/problem.test.ts`). Depois implementar. O fluxo segue o Bug Fix Workflow do `AGENTS.md`, mesmo sendo funcionalidade nova.

## 6. Documentação

- `docs/1.guide/1.basics/6.error.md`: acrescentar seção "Problem details (RFC 9457)" com exemplo de `problem()`, o `Content-Type`, o mapeamento `statusText → title` e `message → detail`, e a nota de que `HTTPError` comum não muda.
- `AGENTS.md`: atualizar a árvore de `src/utils/` e `src/utils/internal/` (ver §4).
- `CHANGELOG.md` não é editado à mão: o projeto gera a partir de commits no `release` (`package.json` script `release`, `changelogen`).

## 7. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **Cabeçalho sobrescrito** depois da serialização (PRD) | `Content-Type` volta a `application/json` | Teste de integração que verifica o cabeçalho final em `web` e `node` (§5.1). O `errorResponse` monta os headers uma vez; o `prepareResponse` só mescla `errHeaders` no mesmo `FastResponse`. |
| **Usuário sobrescreve `content-type`** via `headers` do erro | Formato correto no corpo, mas header do usuário prevalece | Comportamento já existente para `HTTPError` (`mergeHeaders(..., error.headers)`, `src/response.ts:359-360`). Documentar; não tratar como erro. |
| **Vazamento de `detail`/`data` em `unhandled`** (PRD) | Dado sensível exposto | `toProblemJSON` omite `detail`, `data` e `body` quando `unhandled` (D-05); teste em §5.1. |
| **Marca forjável** | Cliente força formato | Símbolo `Symbol.for` não é serializável em JSON (D-01); `toError` já descarta qualquer objeto não-Error (`src/response.ts:73-83`). |
| **Perda de marca em re-embrulho** | Formato volta ao antigo em `onError` que cria `new HTTPError(err)` | Documentado (D-08) e coberto por teste. |
| **Colisão de nome `problem`** com `import *` | Shadowing de variável do usuário | Revisar exports: `problem` não existe em `src/` nem em `_deprecated.ts` (busca sem resultados). Mencionar na documentação. |
| **Tipo de `ErrorInput` mudar** | Quebra de consumidores | `ProblemInput` estende sem tocar em `ErrorInput` (D-07). Checagem em `types.test-d.ts`. |
| **Stack em debug** dentro do corpo problem | Membro não padrão | É extensão RFC 9457 (membros adicionais são permitidos); só aparece em `debug`. |
| **Tabela de textos desatualizada** | `title` ausente para código novo | Omitir `title` (D-06); a tabela é só de códigos registrados. |
| **Mais um ramo em `errorResponse`** | Complexidade no caminho de erro | Um ternário por linha; a ordem de merge de headers não muda. |
| **Erros de validação** | Usuário espera problem em `readValidatedBody` | Fora de escopo (PRD); documentar que só `problem()` muda o formato. |

## 8. Ordem de implementação sugerida

1. Escrever `test/problem.test.ts` e os testes de tipo; confirmar que falham.
2. `src/utils/internal/status-text.ts` + teste unitário.
3. `src/utils/problem.ts` (`problem`, `ProblemInput`, `kProblem`, `isProblemError`, `toProblemJSON`).
4. Ramo em `src/response.ts` (`errorResponse`) e `problemHeaders`.
5. Reexportação em `src/index.ts`; atualizar snapshot em `test/unit/package.test.ts`.
6. `pnpm vitest run`, `pnpm typecheck`, `pnpm lint`.
7. Documentação (`docs/` e `AGENTS.md`).
