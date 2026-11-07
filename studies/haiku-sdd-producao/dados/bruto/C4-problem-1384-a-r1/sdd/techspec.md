# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08).

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `d14f2f2`).

## Visão geral

- Uma opção booleana `problemDetails` em `H3Config` (padrão desligado) escolhe o formato da resposta de erro.
- Quando ligada, `errorResponse` em `src/response.ts` renderiza `application/problem+json` a partir de um helper interno novo.
- `HTTPError` ganha `type` e `instance` (somente leitura), vindos de `ErrorInput`. Eles não entram em `toJSON()`.
- Sem a opção, o caminho atual não muda: mesmo `Content-Type`, mesmo corpo, mesmos campos.

Fluxo de renderização (já existente, só o último passo muda):

1. `H3Core["~request"]` chama `toResponse(handlerRes, event, this.config)` (`src/h3.ts:99`).
2. Erros passam por `prepareResponse` (`src/response.ts:146`), que chama `onError` (`src/response.ts:159-166`).
3. `errorResponse` monta o `Response` de erro (`src/response.ts:173`, função em `src/response.ts:358`).

---

## Decisões de arquitetura

### D-01 — Opção global `problemDetails` em `H3Config`

**Decisão:** adicionar `problemDetails?: boolean` a `H3Config`, com a mesma forma das demais opções booleanas (`debug`, `silent`, `allowMalformedURL`). O valor é lido de `app.config`.

**Alternativas consideradas:**

- *Opção por rota ou por handler* (ex.: `defineHandler({ problemDetails: true })`). Rejeitada: o PRD coloca a opção como global e fora de escopo por rota (PRD linha 113).
- *Novo método ou formato separado* (`app.problemFetch`). Rejeitada: criaria um nome público novo, o que o contrato proíbe.

**Justificativa:** `H3Core.config` já é tipado como `H3CoreConfig = Omit<H3Config, "plugins">` (`src/h3.ts:44`, `src/types/h3.ts:55`). Adicionar o campo em `H3Config` o torna visível em `app.config` sem mexer em mais tipos.

### D-02 — Renderização em `errorResponse`, com `config` passado explicitamente

**Decisão:** trocar a assinatura de `errorResponse` para receber o `config` inteiro, em vez de só `debug`. A chamada em `src/response.ts:173` passa `config`. Dentro da função, um ramo `if (config.problemDetails)` escolhe o corpo e o `Content-Type`.

**Alternativas consideradas:**

- *Função separada `problemResponse(error, config, errHeaders)` chamada por `prepareResponse`.* Rejeitada: duplicaria a lógica de headers (`jsonHeaders`, `error.headers`, `errHeaders`) e a limpeza de `kEventRes`, que precisa ficar exatamente no mesmo ponto (`src/response.ts:172`).
- *Passar só `config.problemDetails` (booleano) e manter `debug` separado.* Rejeitada: obriga a mudar duas vezes a assinatura quando o próximo campo for necessário, e `config.debug` já é lido ali.

**Justificativa:** um único ponto de renderização de erro. A limpeza de `kEventRes` antes de `errorResponse` (`src/response.ts:172-173`) continua valendo para os dois formatos, o que preserva a proteção contra `set-cookie` duplicado descrita em `src/response.ts:167-171`.

### D-03 — Membros do corpo: só os da RFC 9457 e `stack` em debug

**Decisão:** o corpo problem details contém somente:

| Membro     | Origem                                                                 | Regra                                            |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `type`     | `error.type`                                                           | padrão `"about:blank"`                           |
| `status`   | `error.status`                                                         | sempre                                           |
| `title`    | `error.statusText`, senão tabela de `src/utils/internal/problem-details.ts` | omitido se nenhum dos dois existir          |
| `detail`   | `error.message`                                                        | omitido quando `error.unhandled` é verdadeiro    |
| `instance` | `error.instance`                                                       | omitido quando indefinido                        |
| `stack`    | `error.stack` (linhas aparadas)                                        | só com `debug` ligado, como hoje                 |

`data`, `body` e `unhandled` **não** entram no corpo problem details.

**Alternativas consideradas:**

- *Incluir `data` e `body` como extensões*, como hoje no JSON padrão. Rejeitada: `body` é espalhado no objeto (`src/error.ts:234`) e poderia sobrescrever `type`/`status`/`title`/`detail`, quebrando a semântica da RFC. O PRD também lista os membros explicitamente em RF-02.
- *Usar `error.toJSON()` como base e sobrescrever campos.* Rejeitada: `toJSON()` inclui `unhandled`, `statusText`, `data` e `body`, que não pertencem ao formato. Reaproveitar `toJSON()` obrigaria a removê-los um a um.

**Ponto a confirmar:** a linha 112 do PRD ("Extensões ... além de `stack` (em debug) e dos campos já existentes de `HTTPError`") pode ser lida como permissão para `data`/`body`. A escolha acima segue RF-02, que é o critério de aceite. Se o time quiser `data` como extensão, é uma mudança de uma linha no helper.

### D-04 — Fonte do `title` padrão: tabela interna nova para todos os códigos IANA

**Decisão:** criar uma tabela `STATUS_TITLE: Record<number, string>` com os códigos de status IANA, em `src/utils/internal/problem-details.ts`. Ela é usada só quando `error.statusText` está ausente.

**Alternativas consideradas:**

- *Reutilizar `STATUS_TEXT` de `src/utils/response.ts:347-354`.* Rejeitada: a própria tabela diz que contém só os códigos de `noContent` e `redirect` (`src/utils/response.ts:344-345`). Ela não cobre `404` nem `500`, e ampliar seu escopo mudaria `noContent`/`redirect`, que hoje não devolvem texto para outros códigos.
- *Importar uma tabela de `node:http` (`STATUS_CODES`).* Rejeitada: viola o princípio de web standards e de multi-runtime (AGENTS.md, "Web standards first").
- *Omitir `title` sempre que `statusText` faltar.* Rejeitada: a RFC recomenda `title` e o PRD pede o texto padrão (RF-02).

**Justificativa:** a tabela é um dado estático pequeno, sem dependência nova. Fica em arquivo próprio para respeitar o limite de ~200 linhas por arquivo (AGENTS.md, "Short files"). Para código desconhecido, o `title` é omitido, o que é permitido pela RFC.

### D-05 — Erros não tratados: sem `detail`

**Decisão:** quando `error.unhandled` é verdadeiro, o corpo não tem `detail`. O status continua sendo o do erro (500 para `toError`/`new Error`), e o `title` segue D-04.

**Alternativas consideradas:**

- *Usar o placeholder de `toJSON()`*, que põe `message: "HTTPError"` (`src/error.ts:232`). Rejeitada: é um texto inventado no campo de detalhe, sem valor para o cliente.

**Justificativa:** RF-06 exige que a mensagem original não apareça. Omitir o campo é a forma mais simples de garantir isso e de manter o corpo honesto.

### D-06 — `Content-Type` problem details prevalece sobre headers de erro

**Decisão:** o `Content-Type` de problem details é definido com `headers.set(...)` depois de todas as mesclagens (`error.headers` e `errHeaders`). Os demais headers continuam sendo mesclados como hoje.

**Alternativas consideradas:**

- *Deixar `error.headers` sobrescrever o `Content-Type`*, como acontece hoje no JSON padrão. Rejeitada: RF-02 e RF-05 exigem `application/problem+json`.

**Justificativa:** `mergeHeaders` usa `set` para tudo que não é `set-cookie` (`src/response.ts:243-252`). Aplicar o `set` do content-type por último garante a precedência sem alterar `mergeHeaders`.

### D-07 — `type` e `instance` em `HTTPError`, fora de `toJSON()`

**Decisão:**

- `ErrorInput` ganha `type?: string` e `instance?: string`. `ErrorBody` **não** muda (PRD linha 118).
- `HTTPError` ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor a partir de `details`, como `data` e `body` (`src/error.ts:208-209`).
- `toJSON()` não muda (RF-04).

**Alternativas consideradas:**

- *Herdar de `cause`, como `unhandled` e `headers`* (`src/error.ts:202-206`). Rejeitada: `data` e `body` não herdam, e `type`/`instance` são campos de resposta, não de causa interna. Herdar de `cause` poderia vazar um `instance` de erro interno.
- *Validar `type` como URI.* Rejeitada: o PRD exclui a validação (PRD linha 111).

**Justificativa:** segue o padrão de `data`/`body`, que são os campos mais parecidos com os novos.

### D-08 — Erros renderizados sem `config`

**Decisão:** os dois pontos que chamam `toResponse` sem `config` não recebem a opção nesta entrega:

- `src/handler.ts:122-124` (`handlerWithFetch`, quando o handler é usado via `.fetch()` direto, sem app).
- `src/utils/middleware.ts:26` (`onResponse`, que renderiza o valor retornado pelo `next()`).

**Alternativas consideradas:**

- *Ler `event.app?.config` como fallback dentro de `prepareResponse`.* Rejeitada nesta entrega: `event.app` existe em `src/event.ts:40`, mas o fallback só cobriria o problem details e não `onError` nem `debug`, criando um comportamento parcial e difícil de explicar.

**Justificativa:** esses dois caminhos já não aplicam `debug` nem `onError`. Manter o problem details consistente com o `debug` existente é o critério mais simples. O caminho principal, `app.fetch`/`app.request`, cobre a maioria dos casos. A limitação fica registrada nos riscos.

### D-09 — Testes com `describeMatrix` e configuração mutável do app de teste

**Decisão:** criar `test/problem-details.test.ts` usando `describeMatrix`. O app de teste já vem com `debug: true` (`test/_setup.ts:135-141`). Os testes que exigem modo não-debug definem `t.app.config.debug = false`, como `test/errors.test.ts:14` já faz com `onError`.

**Alternativas consideradas:**

- *Criar um app novo dentro de cada teste.* Rejeitada: foge do padrão `describeMatrix` e perde a cobertura de `node`/`web` do helper.

**Justificativa:** segue o padrão já usado em `test/errors.test.ts`.

---

## Contratos e assinaturas

```ts
// src/types/h3.ts — interface H3Config (após `debug`, src/types/h3.ts:32)
/**
 * When enabled, H3 renders HTTP errors as RFC 9457 problem details
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;
```

```ts
// src/error.ts — interface ErrorInput (src/error.ts:6)
/** RFC 9457 `type` URI. Defaults to `about:blank` when rendered. */
type?: string;
/** RFC 9457 `instance` URI reference. */
instance?: string;
```

```ts
// src/error.ts — class HTTPError (após `unhandled`, src/error.ts:119)
/** RFC 9457 `type`, rendered only with `problemDetails` enabled. */
readonly type: string | undefined;
/** RFC 9457 `instance`, rendered only with `problemDetails` enabled. */
readonly instance: string | undefined;
```

```ts
// src/utils/internal/problem-details.ts (arquivo novo, não exportado em src/index.ts)
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface ProblemDetails {
  type: string;
  status: number;
  title?: string;
  detail?: string;
  instance?: string;
  stack?: string[];
}

/** Builds the RFC 9457 body. `stack` is included only when `debug` is set. */
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails;
```

```ts
// src/response.ts — assinatura de errorResponse (src/response.ts:358)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

// chamada em src/response.ts:173
val = errorResponse(error, config, errHeaders);
```

Nenhum nome público novo é exportado. `ProblemDetails`, `toProblemDetails` e `PROBLEM_CONTENT_TYPE` ficam no módulo interno, como `STATUS_TEXT` fica em `src/utils/response.ts`.

Formato da resposta com `problemDetails: true` (exemplo do PRD, linhas 32-41):

```
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type":"about:blank","status":404,"title":"Not Found","detail":"User 42 not found"}
```

---

## Arquivos a alterar

| Arquivo | Alteração | Referências conferidas |
| ------- | --------- | ---------------------- |
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` em `H3Config`. | `src/types/h3.ts:28` (início de `H3Config`), `src/types/h3.ts:29-32` (`debug`, modelo do novo campo), `src/types/h3.ts:55` (`H3CoreConfig`). |
| `src/error.ts` | `ErrorInput` ganha `type`/`instance`; `HTTPError` ganha propriedades e atribuição no construtor. `toJSON` não muda. | `src/error.ts:6` (início de `ErrorInput`), `src/error.ts:97` (`headers`, modelo de campo), `src/error.ts:119` (`unhandled`), `src/error.ts:208-209` (`data`/`body`, padrão de atribuição), `src/error.ts:226-236` (`toJSON`, sem mudança). |
| `src/response.ts` | Trocar `errorResponse(error, config.debug, errHeaders)` por `errorResponse(error, config, errHeaders)`; novo ramo de problem details. | `src/response.ts:146-148` (entrada de `HTTPError`), `src/response.ts:159-166` (`onError`), `src/response.ts:172-173` (limpeza de `kEventRes` e chamada), `src/response.ts:243-252` (`mergeHeaders`), `src/response.ts:270-272` (`jsonHeaders`), `src/response.ts:358-380` (`errorResponse`). |
| `src/utils/internal/problem-details.ts` | **Novo.** Tabela `STATUS_TITLE`, `toProblemDetails`, `PROBLEM_CONTENT_TYPE`. | `src/utils/response.ts:344-354` (`STATUS_TEXT`, não reutilizado), `src/utils/sanitize.ts` (helpers de status já existentes). |
| `test/problem-details.test.ts` | **Novo.** Cenários RF-01 a RF-07 com `describeMatrix`. | `test/_setup.ts:135-141` (app com `debug: true`), `test/errors.test.ts:1-6` (imports e padrão de `describeMatrix`). |
| `test/errors.test.ts` | Teste de `HTTPError` com `type`/`instance` (RF-03), sem alterar os existentes. | `test/errors.test.ts:67-86` ("throw HTTPError"), `test/errors.test.ts:247-265` (não-Error, para checar que não há vazamento). |
| `test/unit/types.test-d.ts` | Checagem de tipos: `H3Config` aceita `problemDetails: true`; `ErrorInput` aceita `type`/`instance`. | arquivo existente, `test/unit/types.test-d.ts`. |

`src/h3.ts` e `src/handler.ts` **não** mudam. `src/h3.ts:99` já passa `this.config`.

### Esboço do helper

```ts
// src/utils/internal/problem-details.ts
import type { HTTPError } from "../../error.ts";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails {
  return {
    type: error.type ?? "about:blank",
    status: error.status,
    title: error.statusText ?? STATUS_TITLE[error.status],
    detail: error.unhandled ? undefined : error.message,
    instance: error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

Ramo novo dentro de `errorResponse`:

```ts
if (config.problemDetails) {
  headers.set("content-type", PROBLEM_CONTENT_TYPE);
  body = toProblemDetails(error, config.debug);
}
```

O `headers.set` vem depois de `mergeHeaders` (D-06). `body` é o objeto que o ramo padrão monta com `error.toJSON()`, então a forma do código é: montar `body` em um `if`/`else`, e fazer um único `JSON.stringify` no fim.

---

## Estratégia de testes

Seguir o AGENTS.md, "Bug Fix Workflow": escrever os testes antes da implementação e confirmar que falham.

### Integração — `test/problem-details.test.ts` (`describeMatrix`, modos `web` e `node`)

| Teste | Requisito | Verificação |
| ----- | --------- | ----------- |
| `problemDetails` ausente em `app.config` | RF-01 | `t.app.config.problemDetails` é `undefined` ou `false` em app sem a opção. |
| Erro 404 com `title`/`detail` | RF-02 | `status` 404, `Content-Type` `application/problem+json`, corpo com `type: "about:blank"`, `status`, `title: "Not Found"`, `detail: "User 42 not found"`. |
| `instance` presente e ausente | RF-02, RF-03 | `instance` aparece quando definido e não aparece quando não é. |
| `title` pela tabela | D-04 | `HTTPError({ status: 404, message })` sem `statusText` → `title: "Not Found"`. |
| `title` omitido para código desconhecido | D-04 | status fora da tabela, sem `statusText` → sem `title`. |
| `type` e `instance` em problem | RF-03 | `error.type` e `error.instance` aparecem no corpo quando `problemDetails` está ligado. |
| Sem a opção, nada muda | RF-04 | `Content-Type` `application/json;charset=UTF-8`, corpo sem `type` nem `instance`. |
| Headers preservados | RF-05 | `headers: { "retry-after": "120" }` aparece na resposta; `Content-Type` continua problem+json mesmo com `headers: { "content-type": "text/plain" }`. |
| `errHeaders` preservados | RF-05 | `event.res.errHeaders.set("x-error", "prepared")` aparece na resposta problem. |
| `set-cookie` sem duplicação com `onError` | Risco R-03 | Com `onError` e `errHeaders.append("set-cookie", ...)`, `getSetCookie()` tem uma ocorrência por cookie. |
| Erro não tratado sem vazamento | RF-06 | `throw new Error("senha do banco: x")` com `debug = false`: status 500, problem+json, corpo sem `"senha do banco"`, sem `stack`, sem `detail`. |
| Debug inclui `stack` | RF-07 | `debug = true`: corpo tem `stack` como array. |
| `onError` retorna `Response` | RF-07 | `onError` retorna `new Response("custom", { status: 418 })` → corpo `"custom"`, sem problem+json. |
| `onError` sem retorno | D-02 | `onError` retorna `undefined` → resposta é problem+json (cobre o caminho `nested`). |
| HEAD com problem | D-02 | Corpo vazio, `Content-Type` problem+json, sem `content-length` divergente. |

Os testes de `HEAD` e `onError` espelham `test/errors.test.ts:13-65`.

### Unitários e tipos

- `test/unit/types.test-d.ts`: `expectTypeOf` para `H3Config["problemDetails"]`, `ErrorInput["type"]`, `ErrorInput["instance"]` e `HTTPError["type"]`.
- Opcional: `toProblemDetails` direto, com `error.unhandled` e `error.stack`.

### Regressão

- `pnpm vitest run test/errors.test.ts` deve passar sem alterações nos testes existentes.
- `pnpm vitest run` completo nos modos `web` e `node`.
- `pnpm lint` (oxlint + oxfmt --check).
- `pnpm typecheck` (`tsc --noEmit`), que valida `isolatedDeclarations` nas novas propriedades de `HTTPError`.

Comandos de verificação não foram executados nesta etapa; esta é só a especificação.

---

## Riscos

| ID | Risco | Impacto | Mitigação |
| -- | ----- | ------- | --------- |
| R-01 | Vazamento de mensagem interna em erro não tratado. | Alto | D-05 (sem `detail`) e teste de RF-06 com `debug = false`. A regra existente de `toJSON()` (`src/error.ts:232-233`) não é reutilizada, então o teste é obrigatório. |
| R-02 | Opção não alcança os caminhos sem `config` (D-08). | Médio | Documentado em D-08. O caminho `app.fetch`/`app.request` é o principal. Um follow-up pode ler `event.app?.config` quando o problema aparecer. |
| R-03 | `set-cookie` duplicado ao renderizar com `onError`. | Médio | A limpeza de `kEventRes` (`src/response.ts:172`) continua antes de `errorResponse`. Teste específico. |
| R-04 | `Content-Type` de `error.headers` sobrescreve problem+json. | Médio | D-06 (`headers.set` depois de `mergeHeaders`). Teste de RF-05. |
| R-05 | Clientes que leem `message` deixam de funcionar quando a opção é ligada. | Baixo (opt-in) | Opção desligada por padrão. `detail` mantém o texto de `message` (D-03). |
| R-06 | Quebra de tipos com `isolatedDeclarations`. | Baixo | Propriedades de `HTTPError` com tipo explícito (D-07). `pnpm typecheck` como critério. |
| R-07 | Tabela de status cresce demais e infla o bundle. | Baixo | Tabela pequena e estática, em arquivo próprio (D-04). |
| R-08 | Teste existente com `debug: true` (`test/_setup.ts:135-141`) esconde vazamento em modo não-debug. | Médio | Testes de RF-06 definem `debug = false` explicitamente. |
| R-09 | `data`/`body` ficam fora do corpo problem details; a leitura do PRD linha 112 pode pedir o contrário. | Médio | Ponto a confirmar, registrado em D-03. |
| R-10 | `type` aceita qualquer string sem validação. | Baixo | Fora de escopo (PRD linha 111). Valor é repassado como foi informado. |
