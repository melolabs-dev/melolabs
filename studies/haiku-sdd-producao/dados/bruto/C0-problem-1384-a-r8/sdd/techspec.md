# Techspec — Problem Details (RFC 9457) por opção de configuração (h3js/h3#1384, variante A)

Documento derivado de `sdd/pedido.md` e `sdd/prd.md`. Todas as citações `arquivo:linha` foram conferidas no código atual (commit `8a279c2`).

## 1. Contexto no código

- Ponto único de renderização de erros: `errorResponse` (`src/response.ts:358`), chamada por `prepareResponse` em `src/response.ts:173` (`val = errorResponse(error, config.debug, errHeaders)`).
- `prepareResponse` recebe o `config` repassado por `toResponse` (`src/response.ts:13-17`), que por sua vez vem de `H3Core["~request"]` (`src/h3.ts:99`, `toResponse(handlerRes, event, this.config)`). `this.config` é o próprio objeto passado ao construtor (`src/h3.ts:55`); por isso `app.config.problemDetails` é lido em tempo de requisição, como `debug`/`silent`.
- O 404 sem rota nasce em `src/response.ts:139-144` (`kNotFound` → `new HTTPError({ status: 404, message: "Cannot find any route matching ..." })`) e o 400 de URL malformada em `src/h3.ts:83`; ambos passam por `errorResponse`, então RF-08 é coberto sem código extra.
- Cabeçalho JSON atual: `jsonHeaders` (`src/response.ts:270-272`), um `FrozenHeaders`; `errorResponse` o mescla com `error.headers` e `errHeaders` via `mergeHeaders` (`src/response.ts:243-252`, uso em `359-364`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) monta o corpo antigo e mascara `message`/`data`/`body` quando `unhandled`. Também é usado por JSON-RPC (`src/utils/json-rpc.ts:483-484` comenta essa máscara) — não pode mudar.
- `H3Config` está em `src/types/h3.ts:28-53` (`debug` na linha 32, `silent` na 37).
- Construção de `HTTPError`: leitura de `headers` de `details`/`cause` em `src/error.ts:202`, `unhandled` em `205-206`, `data`/`body` em `208-209`; campos declarados em `src/error.ts:107-119`; `ErrorInput` em `src/error.ts:6-26`.
- Chamadas de `toResponse` sem `config`: `src/handler.ts:122,124` (`handler.fetch` de handler avulso), `src/utils/middleware.ts:26`, `src/rules/cache.ts:314`. Esses caminhos já ignoram `debug`/`silent`/`onError`; ver D-06.

## 2. Decisões de arquitetura

### D-01 — Onde fica o novo formato: no renderizador (`errorResponse`), não em `toJSON()`
**Alternativas**
1. Alterar `HTTPError.toJSON()` para devolver o formato RFC conforme a opção.
2. Adicionar método novo em `HTTPError` (ex.: `toProblem()`).
3. Ramificar em `errorResponse` e montar o corpo em helper interno.

**Escolha: 3.** `toJSON()` é consumido por JSON-RPC (`src/utils/json-rpc.ts:483`) e por quem serializa erros; mudá-lo quebraria compatibilidade silenciosamente (risco do PRD §4). A opção 2 cria nome público novo, proibido pelo pedido ("Nenhum outro nome público novo"). O helper fica interno, sem export em `src/index.ts`.

### D-02 — Helper interno em arquivo próprio: `src/utils/internal/problem.ts`
**Alternativas:** (a) inline em `src/response.ts` (já com 380 linhas; AGENTS.md pede < 200 LoC por arquivo e helpers internos em `utils/internal/`); (b) arquivo novo em `utils/internal/`.

**Escolha: (b).** Contém `problemHeaders`, a tabela de frases e `problemBody`. Nada é reexportado (sem barrel; `src/index.ts` intocado). Importado com extensão `.ts` por `src/response.ts`.

### D-03 — Assinatura de `errorResponse`: recebe `config`
Hoje `errorResponse(error, debug?, errHeaders?)` (`src/response.ts:358`). Para ler duas opções, trocar `debug` por `config: H3Config`:
`errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response`, chamada em `src/response.ts:173` como `errorResponse(error, config, errHeaders)`.

**Alternativas:** adicionar um 4º parâmetro booleano (assinatura cresce, ordem confusa; AGENTS.md pede objeto de opções para multi-arg) ou passar `config`. **Escolha:** `config` — função é privada ao módulo, sem impacto público.

### D-04 — Opção `problemDetails?: boolean` em `H3Config`
Adicionar em `src/types/h3.ts` logo após `silent` (linha 37), com JSDoc. Lida de `config.problemDetails` a cada erro (sem cache), truthy liga. `H3CoreConfig` (`src/types/h3.ts:55`) herda automaticamente. Ausente/`false` ⇒ caminho antigo, byte a byte idêntico (RF-01): o ramo antigo permanece com o código atual (`jsonHeaders` + `error.toJSON()` + `stack`), apenas atrás de `if (!config.problemDetails)`.

### D-05 — `type` e `instance` em `HTTPError`
**Alternativas:** colocar em `ErrorBody` (`src/error.ts:30`) ou só em `ErrorInput` (`src/error.ts:6`).

**Escolha: `ErrorInput` + campos da classe.** `ErrorBody` descreve o corpo JSON antigo e é o tipo de retorno de `toJSON()` (`src/error.ts:226`); incluir lá sugeriria que o formato antigo emite os campos (RF-04 diz que não). `ErrorDetails` (`src/error.ts:28`) já inclui `ErrorInput`, logo `HTTPError.status(..., details)` (`src/error.ts:144-150`) aceita os campos sem alteração.

Leitura no construtor, ao lado de `headers` (`src/error.ts:202`): de `details` e, na ausência, de `details.cause`, aceitando **somente `typeof === "string"`** (um `Error` arbitrário usado como `details` pode ter `.type` não-string — ex.: erros de bibliotecas — e não deve virar membro RFC).

### D-06 — Escopo do `config`: só quando o `config` chega a `toResponse`
O formato depende de `config` chegar ao `toResponse`. Fluxo `H3.fetch`/`toWebHandler`/Node (`src/h3.ts:99`) cobre todos os requisitos (RF-02..RF-08). Os caminhos `src/handler.ts:122,124`, `src/utils/middleware.ts:26`, `src/rules/cache.ts:314` chamam `toResponse(value, event)` sem config e já hoje ignoram `debug`; não serão alterados (fora de escopo: "só a opção global de `H3Config`"). Registrar como limitação conhecida nos riscos (R-05).

**Alternativa rejeitada:** resolver o config via `event.app?.config` dentro de `prepareResponse` — mudaria também `debug`/`silent` nesses caminhos (alteração de comportamento fora do pedido).

### D-07 — Construção do corpo (`problemBody`)
Entrada: `error: HTTPError`, `debug: boolean | undefined`. Saída: objeto serializável, nesta ordem de chaves:

1. `type`: `error.type ?? "about:blank"`; se `unhandled`, sempre `"about:blank"` (não confiar em dado de erro não tratado).
2. `title`: `error.statusText ?? statusPhrase(error.status)`.
3. `status`: `error.status` (já sanitizado em `src/error.ts:172`; é o mesmo valor passado ao `FastResponse`).
4. `detail`: `error.toJSON().message` — i.e. `error.message`, ou `"HTTPError"` mascarado se `unhandled` (mesmo mascaramento do formato antigo; RF-06).
5. `instance`: `error.instance`, somente se definido e não `unhandled`.
6. Extensões (omitidas se `unhandled`): chaves de `error.body` exceto as reservadas `type|title|status|detail|instance`; depois `data: error.data` se `!== undefined`. `data` explícito vence `body.data`.
7. `stack` (somente `debug` e `error.stack`), na mesma forma do ramo antigo (`split("\n").map(trim)`), por último.

**Mecânica anti-colisão:** copiar `error.body` com spread para um objeto novo, remover as chaves reservadas com `delete`, e compor `{ type, title, status, detail, instance?, ...ext, ...(data), stack }`. Spread (e não atribuição por chave) evita que uma chave `__proto__` vinda de `JSON.parse` altere o protótipo. Chaves `undefined` somem em `JSON.stringify`, então `instance` pode ser `undefined` sem poluir o corpo (RF-03: "sem a chave `instance`").

**Indentação:** `debug ? 2 : undefined`, como em `src/response.ts:372`.

**Alternativa considerada:** derivar de `error.toJSON()` e renomear chaves. Rejeitada: `toJSON()` já mistura `body` por cima de `status`/`message` (`src/error.ts:234`), o que impediria garantir precedência dos membros padrão (RF-05) e traria `statusText`/`unhandled` para a raiz.

### D-08 — `title` padrão: tabela interna de frases HTTP
Sem usar `node:http` (framework multi-runtime, AGENTS.md "Web standards first"). Tabela `Record<number, string>` em `problem.ts` com os status registrados mais comuns (100–511: 400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 418, 422, 429, 500, 501, 502, 503, 504 e demais da IANA). Status fora da tabela: `title` = `"Error"`. Custo: ~2 KB no bundle, aceito (PRD §4 premissa 2). Tabela não exportada.

**Alternativas:** `Response.statusText` do runtime (vazio em HTTP/2 e na maioria dos Fetch); omitir `title` (viola RF-03). Rejeitadas.

### D-09 — Content-type e mesclagem de cabeçalhos
Novo `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })`. `FrozenHeaders` é local de `src/response.ts:260`, não exportado; para evitar import circular e duplicação, `problemHeaders` é definido em `src/response.ts` ao lado de `jsonHeaders` (linha 270), e `problem.ts` exporta só `problemBody`. A mesclagem em `errorResponse` fica igual: `base = config.problemDetails ? problemHeaders : jsonHeaders`; `mergeHeaders(base, error.headers)` e depois `errHeaders`. Assim `content-type` do erro/`errHeaders` prevalece (RF-07) e `set-cookie` continua sendo anexado.

Resultado esperado de `errorResponse` (esboço):

```ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const base = config.problemDetails ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers ? mergeHeaders(base, error.headers) : new Headers(base);
  if (errHeaders) headers = mergeHeaders(headers, errHeaders);
  const body = config.problemDetails
    ? problemBody(error, config.debug)
    : { ...error.toJSON(), stack: /* inalterado */ };
  return new FastResponse(JSON.stringify(body, undefined, config.debug ? 2 : undefined), {
    status: error.status, statusText: error.statusText, headers,
  });
}
```

### D-10 — `onError` e HEAD
Nenhuma mudança em `onError` (`src/response.ts:159-166`): continua recebendo o `HTTPError`; o formato só afeta a renderização padrão (`:173`). Se `onError` devolver `Response`, vale a resposta dele. HEAD segue com corpo nulo via `nullBody` no reprocessamento (`src/response.ts:224,234`); o content-type de erro permanece (hoje já é assim para JSON, ver `test/errors.test.ts:44,49-52`).

## 3. Arquivos a alterar

| Arquivo | Linhas de referência | Mudança |
| --- | --- | --- |
| `src/types/h3.ts` | `:37` (após `silent`) | `problemDetails?: boolean` + JSDoc |
| `src/error.ts` | `:6-26` (`ErrorInput`), `:107-119` (campos), `:202-209` (construtor) | campos `type`/`instance` em `ErrorInput`; `readonly type`/`instance: string \| undefined`; leitura de `details`/`cause` só se string |
| `src/response.ts` | `:173` (chamada), `:270` (junto a `jsonHeaders`), `:358-380` (`errorResponse`) | `problemHeaders`; nova assinatura; ramo condicional |
| `src/utils/internal/problem.ts` | novo | `problemBody`, tabela de frases |
| `test/problem-details.test.ts` | novo | testes RF-01..RF-08 |
| `test/unit/types.test-d.ts` | verificar | (opcional) asserção de tipo de `problemDetails`, `type`, `instance` |

Não alterados: `src/index.ts`, `toJSON()` (`src/error.ts:226`), `src/utils/json-rpc.ts`, `src/handler.ts`, `src/h3.ts`. Nenhum teste existente deve mudar (padrão desligado; `test/_setup.ts:135-141` não liga a opção). Se algum quebrar na execução, ajustar sem perder a verificação e registrar.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
export interface H3Config {
  /**
   * When enabled, error responses use the RFC 9457 problem details format
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
}

// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  type?: string;      // URI reference (RFC 9457 §3.1.1)
  instance?: string;  // URI reference (RFC 9457 §3.1.5)
}
export class HTTPError<DataT = unknown> /* ... */ {
  readonly type: string | undefined;
  readonly instance: string | undefined;
}

// src/utils/internal/problem.ts (interno, sem export público)
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Corpo (RF-03), exemplo: `{"type":"about:blank","title":"Entidade inválida","status":422,"detail":"campo x ausente"}`; 404 de framework: `detail` = `Cannot find any route matching [GET] http://.../nada`; `HTTPError({status:404})` sem mensagem ⇒ `detail` = `"HTTPError 404"` (mensagem padrão do construtor, `src/error.ts:193`).

Decisão sobre erro não tratado (RF-06): `{"type":"about:blank","title":"Internal Server Error","status":500,"detail":"HTTPError"}`; com `debug: true` acrescenta `stack`, como no formato antigo.

## 5. Estratégia de testes

Seguir o fluxo do AGENTS.md: escrever primeiro `test/problem-details.test.ts` (falha antes do código), confirmar falha com `pnpm vitest run test/problem-details.test.ts`, implementar, confirmar verde, depois suíte completa.

Usar `describeMatrix` (`test/_setup.ts`), `ctx.app.config.problemDetails = true` por teste (config mutável; a fábrica em `test/_setup.ts:135` cria app novo por teste, sem vazamento entre testes). Atenção: o setup liga `debug: true`, então os testes de corpo exato (RF-03, RF-05) devem ajustar `t.app.config.debug = false` — ou usar `toEqual` sem `stack` com debug desligado — e o de RF-06 precisa `debug` desligado. Erros não tratados: usar `allowUnhandledErrors` conforme `test/_setup.ts:152` (ver o uso em `test/errors.test.ts` para o padrão de `t.errors = []`).

| Teste | Requisito |
| --- | --- |
| opção ausente e `false`: content-type `application/json;charset=UTF-8`, corpo com `status`/`message`, sem `title`/`detail`/`type`; comparar com texto bruto | RF-01 |
| 404 lançado ⇒ `application/problem+json` (prefixo) | RF-02 |
| 422 com `statusText` e `message`: `toEqual` exato do corpo; sem `instance`, `statusText`, `message`, `unhandled` | RF-03 |
| `title` cai na frase padrão sem `statusText` (ex.: 404 ⇒ "Not Found"); status desconhecido ⇒ "Error" | RF-03/D-08 |
| `type`/`instance` lidos de propriedade, de `cause`, via `HTTPError.status(...)`; no corpo com a opção ligada; ausentes do corpo antigo; `type` não-string ignorado | RF-04 |
| `body` espalhado, `data` sob `data`, reservadas não sobrescritas (`status: 999`, `type`, `title`, `detail`, `instance` em `body`); `data` explícito vence `body.data`; chave `__proto__` em `body` (via `JSON.parse`) não altera protótipo | RF-05 |
| `throw new Error("segredo interno")` ⇒ 500 problem+json, corpo sem o texto, sem `data`/`body`; `type`/`instance` de erro não tratado ignorados | RF-06 |
| `debug: true` + `headers` ⇒ `x-id`, content-type e `stack` como array; `content-type` definido no erro prevalece; `errHeaders` mesclados; `onError` chamado com `HTTPError` e, se devolve `Response`, ela vale | RF-07 |
| `GET /nada` ⇒ 404 problem+json com `detail` contendo `Cannot find any route matching` | RF-08 |
| HEAD com a opção: sem corpo, content-type problem+json | D-10 |
| unitário de `HTTPError`: `type`/`instance` e `toJSON()` inalterado (sem as chaves) | RF-04, D-01 |

Execução final (RF-09): `pnpm lint`, `pnpm typecheck` (via `pnpm lint`/scripts do `package.json`), `pnpm vitest run`. Cobertura dos ramos novos pelo v8 deve vir dos testes acima.

## 6. Riscos

- **R-01 Regressão do formato antigo.** Mitigação: ramo antigo preservado literalmente; teste RF-01 compara texto bruto; suíte existente sem edição.
- **R-02 Vazamento em erros não tratados.** `detail` mascarado, extensões e `type`/`instance` ignorados quando `unhandled` (D-07); teste dedicado. Observação: `new HTTPError(val)` para um `Error` genérico lê `details.type`/`instance` (D-05); como só são emitidos quando `!unhandled`, não há exposição.
- **R-03 Colisão de chaves.** Reservadas removidas de `body` e `data` explícito com precedência; teste com `__proto__`.
- **R-04 Mensagem padrão pouco útil em `detail`** (`"HTTPError 404"`) quando o erro não tem `message`. Comportamento herdado do construtor; aceito pelo PRD (`detail` = `message`).
- **R-05 Caminhos sem `config`** (`src/handler.ts:122,124`, `src/utils/middleware.ts:26`, `src/rules/cache.ts:314`) continuam no formato antigo mesmo com a opção ligada na app. Documentar no JSDoc de `problemDetails` que vale para respostas renderizadas pela aplicação H3; estender é decisão futura.
- **R-06 Configuração congelada.** `freezeApp` (`src/_entries/_common.ts:5`) congela `app.config` na inicialização do servidor; a opção deve ser passada no construtor, não mutada depois (testes mutam antes de servir).
- **R-07 `title` com `statusText` do usuário.** `statusText` já é sanitizado (`src/utils/sanitize.ts:10`), mas o título agora vai ao corpo JSON; sem risco de injeção, pois `JSON.stringify` escapa.
- **R-08 Divergência web vs node.** `describeMatrix` roda ambos; a lógica é independente de runtime (sem `node:http`).
- **R-09 Tamanho do bundle** pela tabela de frases (~2 KB); aceito, mantida fora do caminho quente (módulo carregado junto a `response.ts`, uso só com a opção ligada).
- **R-10 Lint/format.** `oxfmt`/`oxlint` sem config; `isolatedDeclarations` exige tipos de retorno explícitos nas funções exportadas de `problem.ts`.
