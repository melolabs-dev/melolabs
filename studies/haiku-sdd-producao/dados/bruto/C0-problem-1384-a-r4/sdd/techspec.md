# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-09). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `7f3209a`).

## 1. Visão geral

A resposta de erro é montada em um único ponto: `errorResponse()` em `src/response.ts:358`, chamada de `prepareResponse()` em `src/response.ts:173` com `config.debug`. A mudança consiste em:

1. adicionar `problemDetails?: boolean` a `H3Config`;
2. adicionar `type`/`instance` a `ErrorInput` e a `HTTPError`;
3. fazer `errorResponse()` receber o `config` e, com `problemDetails` ligado, emitir o corpo RFC 9457 com `Content-Type: application/problem+json`;
4. isolar a montagem do corpo e a tabela de frases de status em um módulo interno novo (`src/utils/internal/problem.ts`), sem novas exportações públicas.

`HTTPError.toJSON()` (`src/error.ts:226`) e o formato legado ficam intactos.

## 2. Decisões de arquitetura

### D-01 — Ponto de conversão: `errorResponse` em `src/response.ts`

- **Alternativas:** (a) alterar `HTTPError.toJSON()`; (b) um middleware/plugin que reescreve a resposta; (c) converter dentro de `errorResponse`.
- **Escolha:** (c). `toJSON()` não conhece a configuração e é usado como contrato do formato legado (comentário em `src/utils/json-rpc.ts:483` depende do mascaramento dele). Um middleware não veria erros gerados por `kNotFound`, 400 de URL malformada (`src/h3.ts:83`) nem os de `onError`. `errorResponse` já é o único lugar que serializa erros e já recebe `debug`/`errHeaders`.
- **Consequência:** a assinatura interna passa de `errorResponse(error, debug?, errHeaders?)` para `errorResponse(error, config, errHeaders?)`; `debug` e `problemDetails` são lidos uma vez de `config` no mesmo ponto (`src/response.ts:173`).

### D-02 — Opção `problemDetails` em `H3Config`

- **Alternativas:** opção por rota/cabeçalho `Accept` (fora de escopo, PRD §3); opção booleana global.
- **Escolha:** `problemDetails?: boolean` em `H3Config` (`src/types/h3.ts:28-32`, logo após `debug`), com JSDoc avisando que troca o contrato do corpo de erro (`message` → `detail`). `H3CoreConfig` é `Omit<H3Config, "plugins">` (`src/types/h3.ts:55`), então herda a opção sem mudança. `H3Core` guarda o config em `this.config` (`src/h3.ts:53-55`) e o passa a `toResponse` em `src/h3.ts:99`. Padrão: ausente = `false`.

### D-03 — `type` e `instance` só em `ErrorInput`/`HTTPError`, não em `ErrorBody`

- **Alternativas:** (a) acrescentar a `ErrorBody` (`src/error.ts:30`); (b) acrescentar só a `ErrorInput` (`src/error.ts:6`).
- **Escolha:** (b). `ErrorBody` descreve o corpo legado e é o tipo de retorno de `toJSON()` (`src/error.ts:226`); incluir os campos ali sugeriria que o formato legado os emite. O PRD (RF-04) fala em `ErrorInput`. Como `ErrorInput extends Partial<ErrorBody>`, nada mais muda em tipos exportados (`src/index.ts:72` não muda).
- **Em `HTTPError`:** `readonly type: string | undefined;` e `readonly instance: string | undefined;`, com anotação explícita (exigência de `isolatedDeclarations`), declaradas junto de `data`/`body` (`src/error.ts:107-112`) e atribuídas no construtor após `src/error.ts:208-209`.

### D-04 — Herança de `type`/`instance` a partir de `details` e `cause`

- **Problema:** o construtor herda `status`, `statusText`, `headers` e `unhandled` de `details.cause` (`src/error.ts:172-206`). Mas em `prepareResponse` um erro qualquer vira `new HTTPError(val)` (`src/response.ts:148`), ou seja, `details` é um `Error` arbitrário. Erros de bibliotecas costumam ter `type` próprio (ex.: `"entity.parse.failed"`), que vazaria como `type` do problema — e não é URI.
- **Alternativas:** (a) ler `details.type` e `details.cause.type` sem filtro (igual a `status`); (b) ler só do `details` literal; (c) ler de `details`/`cause` somente quando a fonte é um `ErrorInput` ou `HTTPError` (não um `Error` estrangeiro) e o valor é string não vazia.
- **Escolha:** (c). Segue o padrão de herança do PRD (§4, risco "cause") sem importar `type` de erros de terceiros. Regra: `fonte instanceof Error && !HTTPError.isError(fonte)` ⇒ ignorar; senão `typeof v === "string" && v ? v : undefined`. Ordem: `details` antes de `cause`. Implementado como função interna ao final de `src/error.ts` (sem export).
- **Defesa adicional:** erros `unhandled` nunca emitem `type`/`instance` reais no corpo (ver D-06).

### D-05 — Frase padrão de `title`: tabela interna nova

- **Alternativas:** (a) reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`; (b) `http.STATUS_CODES` do Node; (c) tabela interna nova.
- **Escolha:** (c). (a) só tem 6 códigos e o comentário em `src/utils/response.ts:345-346` diz que isso é intencional: ampliar mudaria `noContent`/`redirect` (linhas 44 e 79). (b) viola "web standards first"/multi-runtime (Workers, browsers). Criar `STATUS_PHRASES` em `src/utils/internal/problem.ts` com as frases RFC 9110 dos códigos 4xx/5xx comuns (400…451, 500…511) e 1xx/2xx/3xx usuais.
- **Status sem frase conhecida:** `title` é omitido (a RFC trata `title` como SHOULD; evita inventar frase de outro código).
- **Precedência de `title`:** `error.statusText` (já sanitizado em `src/error.ts:180-185`) → frase da tabela → omitido.

### D-06 — Montagem do corpo problem details

Função interna `problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>` em `src/utils/internal/problem.ts`.

- **Alternativas:** (a) pós-processar `error.toJSON()`; (b) montar o objeto a partir dos campos do erro.
- **Escolha:** (b). `toJSON()` já faz o spread de `body` por cima de `status`/`message`/`data` (`src/error.ts:228-235`), então um `body: { status: 200 }` sobrescreveria; filtrar depois é frágil. Em (b) a ordem é explícita: extensões primeiro, membros padrão por último (RF-06).
- **Ordem de construção:**
  1. se `!error.unhandled`: espalhar `error.body`, depois `data: error.data`;
  2. membros padrão sobrescrevem: `type` (`error.type` ou `"about:blank"`), `title` (D-05), `status: error.status`, `detail`, e `instance` só se definido;
  3. `unhandled: error.unhandled` (mantém paridade com o legado; omitido pelo `JSON.stringify` quando `undefined`);
  4. `stack` por último, igual ao legado (`src/response.ts:369`): `debug && error.stack` → linhas aparadas; caso contrário `undefined`.
- **`detail`:** `error.toJSON().message`, reaproveitando o mascaramento existente (`"HTTPError"` quando `unhandled`, mensagem real caso contrário, `src/error.ts:232`). Assim RF-07 depende de um único ponto de mascaramento.
- **Não emitidos:** `message` e `statusText` do formato legado (RF-03). Uma chave `message` vinda de `body` do usuário é extensão explícita e permanece (só os membros padrão têm precedência).
- **`unhandled`:** `data`/`body` não são enviados e `type`/`instance` ficam `about:blank`/omitido, mesmo que o erro original os tenha (D-04).
- **Indentação:** `JSON.stringify(corpo, undefined, debug ? 2 : undefined)`, como hoje (`src/response.ts:366-373`).

### D-07 — Cabeçalhos e `Content-Type`

- **Alternativas:** (a) apenas trocar o valor-base e deixar `error.headers` poder sobrescrever (como hoje); (b) forçar `Content-Type` ao final.
- **Escolha:** (b) no modo problem details. RF-08 exige `Content-Type` `application/problem+json` mesmo com `error.headers`/`errHeaders`. Hoje `mergeHeaders(jsonHeaders, error.headers)` (`src/response.ts:359-364`) deixa um `content-type` do erro vencer; no novo modo, após as duas mesclagens faz-se `headers.set("content-type", problemType)`. O modo legado não muda.
- **Valor:** constante `application/problem+json` (sem `charset`; o tipo de mídia da RFC 9457 não define o parâmetro), declarada como `FrozenHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`) ou como string simples usada no `set`. `statusText` continua `error.statusText` (`src/response.ts:376`).
- `onError` continua rodando antes (`src/response.ts:159-166`); a conversão só afeta o que é renderizado depois dele. Se `onError` devolver uma `Response`/valor próprio, ele vence como hoje.

### D-08 — Sem novas exportações públicas

`src/utils/internal/problem.ts` não é reexportado; `src/index.ts` não muda (RF-09). Segue a convenção de helpers internos em `utils/internal/` (AGENTS.md). O módulo deve ficar abaixo de ~200 linhas.

## 3. Arquivos a alterar

| Arquivo                                             | Linha(s) atual(is) | Mudança                                                                                                   |
| --------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `src/types/h3.ts`                                   | `28-32`            | Adicionar `problemDetails?: boolean` a `H3Config` com JSDoc (após `debug`).                               |
| `src/error.ts`                                      | `6-26`             | `type?: string` e `instance?: string` em `ErrorInput`, com JSDoc (URI reference, RFC 9457 §3.1.1/§3.1.5). |
| `src/error.ts`                                      | `107-112`          | Declarar `readonly type: string \| undefined` e `readonly instance: string \| undefined`.                 |
| `src/error.ts`                                      | `202-209`          | Atribuir `this.type`/`this.instance` via helper interno (D-04).                                           |
| `src/error.ts`                                      | `226-236`          | **Sem mudança** (`toJSON` legado).                                                                        |
| `src/response.ts`                                   | `173`              | Chamar `errorResponse(error, config, errHeaders)`.                                                        |
| `src/response.ts`                                   | `358-380`          | Nova assinatura; ramo `config.problemDetails` usa `problemBody` e força `content-type` (D-06/D-07).       |
| `src/utils/internal/problem.ts`                     | novo               | `problemBody`, `STATUS_PHRASES`, constante do media type.                                                 |
| `test/problem-details.test.ts`                      | novo               | Testes de RF-01…RF-08 (ver §5).                                                                           |
| `test/unit/` (ex.: `error.test.ts` ou novo arquivo) | novo/ajuste        | Testes unitários de `HTTPError.type`/`instance`.                                                          |
| `test/unit/types.test-d.ts`                         | existente          | Asserção de tipo de `H3Config.problemDetails` e `ErrorInput.type/instance`.                               |

Não alterar: `src/index.ts:72`, `src/h3.ts:99`, `src/utils/response.ts:347`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
export interface H3Config {
  /**
   * Quando ligado, respostas de erro seguem a RFC 9457 (`application/problem+json`):
   * `type`, `title`, `status`, `detail` (+ `instance`, `data`, `body`). O membro legado
   * `message` deixa de ser emitido. Desligado por padrão.
   */
  problemDetails?: boolean;
  // ...demais opções inalteradas
}

// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /** URI reference que identifica o tipo do problema (RFC 9457 §3.1.1). */
  type?: string;
  /** URI reference que identifica esta ocorrência (RFC 9457 §3.1.5). */
  instance?: string;
  // ...
}
export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
}

// src/utils/internal/problem.ts  (interno, não exportado em src/index.ts)
export const kProblemContentType: string; // "application/problem+json"
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/response.ts  (interno)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Corpo de exemplo (`problemDetails: true`):

```json
{
  "type": "https://example.com/probs/conflito",
  "title": "Conflict",
  "status": 409,
  "detail": "Pedido duplicado",
  "instance": "/pedidos/42",
  "data": { "campo": "email" },
  "code": "E_VALID"
}
```

## 5. Estratégia de testes

Seguir o Bug Fix Workflow do AGENTS.md: escrever os testes primeiro e ver falhar.

**Infra:** `describeMatrix` (web + node, `test/_setup.ts`). O `ctx.app` é criado com `debug: true` fixo (`test/_setup.ts:135-141`); portanto cada teste liga a opção por mutação do config (`ctx.app.config.problemDetails = true`, e `ctx.app.config.debug = false` quando necessário), já que `toResponse` lê `this.config` a cada requisição (`src/h3.ts:99`). Sem alterar `_setup.ts`.

**`test/problem-details.test.ts`** (um `it` por critério de aceite):

- RF-01: sem opção e com `false`, 404 mantém `application/json` e `message`/`statusText`.
- RF-02: `Content-Type` começa com `application/problem+json`; corpo é JSON válido.
- RF-03: `type: "about:blank"`, `title: "Not Found"`, `status`, `detail`; sem `message`. Também: `statusText` customizado vira `title`; status sem frase (ex.: 599) omite `title`.
- RF-05: `type`/`instance` emitidos; sem `instance`, a chave não existe.
- RF-06: `data` e `body` como extensões; `body: { status: 200, type: "x", detail: "y" }` não sobrescreve os padrão.
- RF-07 (`debug` off): `Error("segredo interno")` → 500, `application/problem+json`, corpo sem o texto nem `stack`; `data`/`body` ocultos; `type`/`instance` do erro ignorados quando `unhandled`.
- RF-08 (`debug` on): `x-id: 1` presente, `stack` no corpo, content-type problem+json; `error.headers` com `content-type: text/plain` não vence; `event.res.errHeaders` e `set-cookie` preservados sem duplicar; `onError` chamado uma vez (`ctx.hooks.onError`).
- Casos de borda: `kNotFound` (rota inexistente) e 400 de URL malformada também saem em problem details; `HEAD` mantém corpo nulo.

**Unitários de `HTTPError`** (RF-04): valores informados; `undefined` quando ausentes; herança via `cause` com `HTTPError`/objeto simples; `Error` estrangeiro com `type: "entity.parse.failed"` **não** vira `error.type`; valor não string ignorado; `toJSON()` não ganha `type`/`instance`.

**Tipos:** `test/unit/types.test-d.ts` — `H3Config["problemDetails"]` é `boolean | undefined`; `ErrorInput` aceita `type`/`instance`.

**Regressão (RF-09):** `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`; conferir que `src/index.ts` não mudou (`git diff --stat`). Em tese nenhum teste existente muda: `type`/`instance` são propriedades próprias novas (`undefined`) em `HTTPError`, e nenhum teste de `errors.test.ts`/`status.test.ts` enumera chaves da instância (busca por `Object.keys`/`toStrictEqual` sem ocorrências). Se algum teste comparar a forma da instância, ajustar somente o necessário, mantendo a asserção.

## 6. Riscos

| Risco                                                                                                                                                                                                                                                                                             | Mitigação                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Caminhos que chamam `toResponse` sem `config`**: `src/handler.ts:122-124` (`toWebHandler`/`.fetch` de handler avulso), `src/utils/middleware.ts:26` (`onResponse`) e `src/rules/cache.ts:314` usam `config = {}` (`src/response.ts:16`), logo não aplicam `problemDetails` (nem `debug`, hoje). | Comportamento idêntico ao de `debug`; registrar como limitação conhecida. Erros que passam por `H3.fetch` (inclusive sub-apps via `mount`, que não chamam `toResponse` — única chamada em `src/h3.ts:99`) usam o config da app raiz. |
| **Corpo quebra clientes** que leem `message`.                                                                                                                                                                                                                                                     | Opção desligada por padrão; aviso no JSDoc.                                                                                                                                                                                          |
| **Vazamento em erros não tratados** (`detail`, `type`, `instance`, `data`, `body`, `stack`).                                                                                                                                                                                                      | `detail` via `toJSON().message` (mascarado); `data`/`body`/`type`/`instance` ignorados quando `unhandled`; `stack` só com `debug`; teste dedicado.                                                                                   |
| **`type` de erro de terceiros virar `type` do problema.**                                                                                                                                                                                                                                         | D-04: ignorar fonte `Error` estrangeira e valores não string.                                                                                                                                                                        |
| **Colisão de chaves** (`body` × membros padrão; `stack` × `body.stack`).                                                                                                                                                                                                                          | Padrão por último; `stack` por último como no legado.                                                                                                                                                                                |
| **`Content-Type` sobrescrito por `error.headers`.**                                                                                                                                                                                                                                               | `set` forçado após as mesclagens (D-07).                                                                                                                                                                                             |
| **Tabela de frases incompleta/divergente.**                                                                                                                                                                                                                                                       | `title` omitido para status sem frase; `statusText` do erro tem precedência.                                                                                                                                                         |
| **`isolatedDeclarations`**: novos membros públicos sem anotação quebram `tsc`.                                                                                                                                                                                                                    | Anotar `string \| undefined` e `boolean` explicitamente; rodar `pnpm typecheck`.                                                                                                                                                     |
| **Tamanho de arquivo / lint** (`oxlint`, `oxfmt`).                                                                                                                                                                                                                                                | Módulo novo < 200 LoC; rodar `pnpm fmt` e `pnpm lint`.                                                                                                                                                                               |

## 7. Fora do escopo (reafirmado)

Negociação via `Accept`, `application/problem+xml`, opção por rota/requisição, helpers públicos, catálogo de tipos, JSON-RPC/WebSocket/SSE, mudança do formato padrão e documentação do site além do JSDoc.
