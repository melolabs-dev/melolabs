# Techspec: Problem Details (RFC 9457) em erros do h3, ativado por opção

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08, premissas 1 a 6).

Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `b19b451`).

## 1. Visão geral

Uma opção booleana `problemDetails` em `H3Config` faz `errorResponse` (`src/response.ts:358`) responder erros como documento RFC 9457 com `Content-Type: application/problem+json`. Com a opção desligada, o caminho atual é executado sem nenhuma alteração. `HTTPError` ganha os campos opcionais `type` e `instance`, expostos na instância, mas que não entram no corpo do formato antigo.

Fluxo, com a mudança destacada:

1. `H3Core["~request"]` passa `this.config` para `toResponse` (`src/h3.ts:99`).
2. `prepareResponse` monta a resposta de erro chamando `errorResponse(error, config, errHeaders)` (`src/response.ts:173`, assinatura alterada).
3. **Novo:** se `config.problemDetails`, `errorResponse` retorna `problemDetailsResponse(...)`, que usa `toProblemDetails` (`src/utils/internal/problem.ts`, arquivo novo).
4. Senão, o código atual (`error.toJSON()` + `stack`) roda igual a hoje.

## 2. Decisões de arquitetura

### D-01 — Ler a opção a partir de `config` no momento da resposta

**Escolha:** `errorResponse` passa a receber o `H3Config` inteiro (em vez de `config.debug`). A flag é lida em cada requisição, do mesmo objeto `this.config` que `H3Core` já usa.

**Por quê:** `this.config` é o mesmo objeto por toda a vida do app e é lido a cada `~request` (`src/h3.ts:99`). Assim `app.config.problemDetails = true` após a criação funciona, como o próprio harness de testes já faz com `onError` (`test/errors.test.ts:14`). Passar `config` também evita um segundo parâmetro booleano só para essa flag.

**Alternativas consideradas:**
- Passar um booleano extra (`errorResponse(error, debug, errHeaders, problemDetails)`). Descartada: a lista de parâmetros cresce a cada opção nova e a função é interna.
- Ler a flag de `event.app?.config` (como `src/adapters.ts:118` faz). Descartada: `errorResponse` não recebe `event` e o `config` já chega até ali.

### D-02 — Corpo de problem details em módulo interno separado; `HTTPError.toJSON()` não muda

**Escolha:** a montagem do corpo fica em `src/utils/internal/problem.ts` (função `toProblemDetails`). `HTTPError.prototype.toJSON` (`src/error.ts:226-236`) permanece idêntico, então o formato antigo não ganha `type` nem `instance` (PRD premissa 5, RF-02).

**Por quê:** é a forma de cumprir RF-02 sem condicionais dentro de `toJSON`. Também isola a ramificação do caminho quente (PRD risco 6). `src/response.ts` já tem cerca de 380 linhas e a convenção do projeto pede arquivos curtos e helpers em `utils/internal/` (`AGENTS.md`, "Code Conventions").

**Alternativas consideradas:**
- Método público `HTTPError#toProblemDetails()`. Descartada: cria um nome público novo, proibido pelo contrato #1384-A ("Nenhum outro nome público novo").
- Colocar a função em `src/response.ts`. Descartada pelo tamanho do arquivo e pela convenção acima.
- Acrescentar `type`/`instance` ao `toJSON` com ramificação por opção. Descartada: `toJSON` tem tipo de retorno `Omit<ErrorBody, "body"> & ErrorBody["body"]` e seria mais difícil de manter.

### D-03 — Mapeamento de campos e precedência

**Escolha** (fixa as premissas 1, 3 e 4 da PRD):

| Campo RFC | Origem | Regra |
|---|---|---|
| `type` | `error.type` | `"about:blank"` se ausente. Para `unhandled`, sempre `"about:blank"` (D-06). |
| `title` | `error.statusText` | Omitido se `statusText` for `undefined`. Não há tabela de frases de status no projeto e não vamos criar uma. |
| `status` | `error.status` | Sempre presente. |
| `detail` | `error.message` | Para `unhandled`, usa o mesmo texto que `toJSON` usa: `"HTTPError"`. |
| `instance` | `error.instance` | Omitido se ausente. Para `unhandled`, omitido. |
| extensões | `error.data`, `error.body` | Presentes só quando não é `unhandled`. `data` vem antes de `...body`, como em `toJSON` (`src/error.ts:233-234`). |
| `stack` | `error.stack` | Só com `debug` e se houver stack. Mesma regra de `src/response.ts:369`. |

Os campos RFC são escritos **por último** no objeto, então sempre vencem chaves homônimas de `data` e `body`. Um `body: { status: 200 }` não consegue alterar o status do problema (PRD risco 4). Chaves `statusText`, `message` e `unhandled` não são copiadas para o corpo nesse modo.

**Por quê:** a RFC pede que `status`, `type` e `title` sejam controlados pelo servidor. Deixar `body` sobrescrevê-los seria uma regressão de segurança. Com `title` omitido, `body.title` também sai do corpo, porque a chave RFC `title: undefined` substitui a chave homônima. Isso é aceito e documentado (ver riscos).

**Alternativas consideradas:**
- `body` sobrescreve os campos RFC, como `toJSON` faz hoje. Descartada pelo motivo acima.
- Gerar `title` a partir de um mapa de status. Descartada: código novo e tabela para manter, sem exigência do contrato.

### D-04 — `Content-Type: application/problem+json`, sem charset

**Escolha:** constante `problemJsonHeaders` do tipo `FrozenHeaders` em `src/response.ts`, ao lado de `jsonHeaders` (`src/response.ts:270-272`), com `content-type: application/problem+json`.

**Por quê:** é a media type definida pela RFC 9457 §3, e o RF-03 exige o valor exato. Confirma a premissa 2 da PRD.

**Alternativas consideradas:**
- `application/problem+json;charset=UTF-8`, para espelhar `jsonHeaders`. Descartada: a RFC não define `charset` para essa mídia, e o JSON é UTF-8 por definição. O teste de RF-03 comparia o valor exato.
- Manter `application/json` (PRD risco 5). Descartada pelo PRD, que pede `application/problem+json`. Se o time mudar de ideia, só a constante muda.

### D-05 — `type` e `instance` entram em `ErrorInput` e na classe, não em `ErrorBody`

**Escolha:**
- `ErrorInput` (`src/error.ts:6`) ganha `type?: string` e `instance?: string`.
- Classe `HTTPError` (`src/error.ts:74`) ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, seguindo o padrão de `statusText` (`src/error.ts:92`).
- `ErrorBody` (`src/error.ts:30`) **não** muda.
- O construtor lê `type` e `instance` de `details` e, se ausentes, de `details.cause`, como já acontece com `unhandled` (`src/error.ts:205-206`) e `headers` (`src/error.ts:202`).

**Por quê:** `toJSON` tem o tipo `Omit<ErrorBody, "body">`. Pôr `type` e `instance` em `ErrorBody` faria o tipo público anunciar campos que o formato antigo não emite (PRD risco 2 e 3). O fallback para `cause` segue a mesma regra de `status` e `statusText` (`src/error.ts:173-176`).

**Alternativas consideradas:**
- Adicionar em `ErrorBody`. Descartada pelo motivo acima.
- Ler apenas de `details`, sem `cause`. Descartada: quebraria a consistência com o restante do construtor. O risco de herdar `type` de um erro externo é tratado em D-06.

### D-06 — Erros `unhandled` nunca expõem `type`, `instance`, `data`, `body` ou a mensagem

**Escolha:** em `toProblemDetails`, se `error.unhandled`, o corpo recebe `type: "about:blank"`, `detail: "HTTPError"` e omite `instance`, `data`, `body`. `stack` segue a regra de `debug`, como hoje (`src/response.ts:369`).

**Por quê:** `prepareResponse` cria o `HTTPError` de erros comuns com `new HTTPError(val)` (`src/response.ts:148`), então `type` e `instance` podem vir de qualquer objeto `Error` lançado. Tratar `unhandled` como caso fechado evita vazar esses campos de erros internos. O literal `"HTTPError"` é o mesmo de `src/error.ts:232`.

**Alternativa considerada:** texto genérico próprio (por exemplo, "Internal Server Error"). Descartada por enquanto para manter uma única regra de mascaramento, já usada em `toJSON` e em `src/utils/json-rpc.ts:483-491`. Pode ser trocado depois sem mudar a API.

### D-07 — Escopo: só o `config` do app

**Escolha:** a opção vale para respostas geradas por `H3Core["~request"]` (`src/h3.ts:99`). Os pontos que chamam `toResponse` sem `config` continuam no formato padrão, como acontece hoje com `debug`:
- `src/handler.ts:122` e `src/handler.ts:124` (`handler.fetch` de handler avulso, sem app).
- `src/utils/middleware.ts:26` (`onResponse` de middleware, para respostas de sucesso).

**Por quê:** esses caminhos não têm acesso ao `config` do app. Passá-lo é uma mudança de API interna que foge do escopo (PRD "Fora de escopo": "A opção é global da aplicação").

**Alternativa considerada:** propagar `config` até esses pontos. Descartada por escopo; fica registrada como risco (R-04).

### D-08 — Documentação

**Escolha:** acrescentar uma linha da opção em `docs/1.guide/900.api/1.h3.md`, na lista "Supported options" (linha 113, ao lado de `allowMalformedURL`). Não há entrada no `CHANGELOG.md` manual: ele é gerado pelo `changelogen` no `release`.

## 3. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/types/h3.ts:28-46` | Adicionar `problemDetails?: boolean` em `H3Config`, depois de `allowMalformedURL` (`src/types/h3.ts:46`), com JSDoc. `H3CoreConfig` (`src/types/h3.ts:55`) herda sem alteração. |
| `src/error.ts:6-26` | Adicionar `type?: string` e `instance?: string` em `ErrorInput`. |
| `src/error.ts:74-119` | Adicionar `readonly type` e `readonly instance` na classe, com JSDoc citando a RFC 9457. |
| `src/error.ts:162-210` | No construtor, ler `type` e `instance` de `details`, com fallback para `details.cause`, e atribuir (depois de `src/error.ts:206`). |
| `src/error.ts:226-236` | **Sem alteração** em `toJSON`. |
| `src/response.ts:173` | Trocar `errorResponse(error, config.debug, errHeaders)` por `errorResponse(error, config, errHeaders)`. |
| `src/response.ts:270-272` | Adicionar `problemJsonHeaders = new FrozenHeaders({ "content-type": "application/problem+json" })`. |
| `src/response.ts:358-380` | Alterar a assinatura para `errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers)`. No início: `if (config.problemDetails) return problemDetailsResponse(error, config.debug, errHeaders);`. O restante fica igual, com `config.debug` no lugar de `debug`. |
| `src/response.ts` (novo, após `errorResponse`) | `problemDetailsResponse` monta cabeçalhos com `problemJsonHeaders` (mesma lógica de `error.headers` e `errHeaders` de `src/response.ts:359-365`), chama `toProblemDetails` e serializa com `JSON.stringify(body, undefined, debug ? 2 : undefined)`. Fica dentro do mesmo `try` do `toResponse` (`src/response.ts:26-30`), para que o erro de serialização continue virando 500. |
| `src/utils/internal/problem.ts` (novo) | `export interface ProblemDetails` e `export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails`. Implementa D-03 e D-06. |
| `src/index.ts:72` | **Sem alteração.** `HTTPError` e `ErrorInput` já são exportados. `ProblemDetails` não é exportado (nome público novo proibido). |
| `docs/1.guide/900.api/1.h3.md:113` | Linha nova para `problemDetails`. |
| `test/problem-details.test.ts` (novo) | Testes de RF-01 a RF-07 com `describeMatrix` (ver seção 5). |
| `test/errors.test.ts` | Sem alteração nos testes existentes. Pode receber um caso de regressão para `toJSON` sem `type`/`instance` (ver seção 5). |
| `test/unit/types.test-d.ts` | Acrescentar checagem de tipo de `type`/`instance` em `HTTPError` e `ErrorInput`. |

Arquivos que **não** mudam, mas são afetados pela regra de `toResponse` sem `config` (D-07): `src/handler.ts:122-124`, `src/utils/middleware.ts:26`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — dentro de H3Config
/**
 * When enabled, error responses use the RFC 9457 "problem details" format
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;

// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /** RFC 9457 `type`: URI reference that identifies the problem type. */
  type?: string;
  /** RFC 9457 `instance`: URI reference that identifies this occurrence. */
  instance?: string;
  // ...campos atuais
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // ...campos atuais
}

// src/response.ts (interno)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
function problemDetailsResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
const problemJsonHeaders: Headers; // FrozenHeaders

// src/utils/internal/problem.ts (interno)
export interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  stack?: string[];
  [extension: string]: unknown;
}
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails;
```

Exemplo do corpo esperado (`problemDetails: true`, `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`):

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Usuário não encontrado"
}
```

Com `data: { id: 42 }` e `instance: "/usuarios/42"`, o corpo ganha `"id"` dentro de `data` (`"data": { "id": 42 }`) e `"instance": "/usuarios/42"`.

Exemplo do `HTTPError` (RF-04): `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` expõe `error.type` e `error.instance`, e `error.toJSON()` **não** contém essas chaves.

Sem alteração de API: `HTTPError.status`, `HTTPError#toJSON`, `toResponse`, `ErrorBody`, `ErrorDetails`, `kNotFound`, `kHandled`.

## 5. Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: escrever os testes, ver que falham, implementar, ver que passam.

**`test/problem-details.test.ts` (novo, `describeMatrix`, roda em `web` e `node`):**

Atenção: o `describeMatrix` cria o app com `debug: true` (`test/_setup.ts:135-140`). Os casos sem `debug` precisam definir `t.app.config.debug = false` explicitamente, como `test/errors.test.ts:14` faz com `onError`.

| Caso | Requisito | Verificação |
|---|---|---|
| `problemDetails` ausente, `HTTPError.status(404, "Not Found")` | RF-01, RF-02 | `app.config.problemDetails` é `undefined`; status 404; `content-type` `application/json;charset=UTF-8`; corpo com `status`, `statusText`, `message`, `unhandled`, `data` como hoje. |
| `new H3({ problemDetails: true })` | RF-01 | `app.config.problemDetails === true`. |
| `problemDetails: true`, `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })` | RF-03 | status 404; `content-type` `application/problem+json`; `status`, `title`, `detail`, `type` exatos; sem `statusText`, `message`, `unhandled`. |
| `problemDetails: true` com `data` e `body` | RF-03, D-03 | `data` e `body` aparecem como extensões; `body: { status: 200, title: "x" }` não altera `status` nem `title`. |
| `problemDetails: true`, `instance` e `type` no `HTTPError` | RF-04, D-03 | `instance` e `type` aparecem no corpo quando definidos; `type` ausente vira `"about:blank"`. |
| `problemDetails: true`, `new Error("segredo do banco")` | RF-05 | status 500; `content-type` problem; nenhum valor do corpo contém `"segredo do banco"`; `detail` é `"HTTPError"`. |
| `problemDetails: true`, `new Error` com propriedade `type: "x"` | D-06 | `type` no corpo é `"about:blank"`. |
| `debug: true` e `problemDetails: true`, rota que lança erro | RF-06 | corpo tem `stack` como array de strings. |
| `problemDetails: true`, `onError` registrado, `HTTPError` com `headers: { "Retry-After": "120" }` | RF-07 | `onError` chamado uma vez; resposta tem `retry-after: 120`; `onResponse` chamado uma vez. |
| `problemDetails: true`, `data` circular, sem `onError` | Regressão de `src/response.ts:26-30` | status 500, sem exceção vazando de `fetch()`. |
| `problemDetails: true` com `HEAD` | Regressão de `src/response.ts:234` | corpo vazio, sem `content-length` divergente. |

**Testes existentes:**

- `test/errors.test.ts` passa sem alteração (o formato padrão não muda).
- Acrescentar a `test/errors.test.ts` um caso: `new HTTPError({ status: 400, type: "x", instance: "/y" }).toJSON()` não contém `type` nem `instance` (regressão da premissa 5 da PRD e da D-02).

**Testes de tipo (`test/unit/types.test-d.ts`):**

- `new HTTPError({ status: 400, type: "x" }).type` tem tipo `string | undefined`.
- `ErrorInput` aceita `type` e `instance` (`string`).
- `H3Config` aceita `problemDetails: boolean`.
- `ErrorBody` não ganha `type` nem `instance` (`@ts-expect-error` ao acessar `ErrorBody["type"]`).

**Comandos:**

```bash
pnpm vitest run test/problem-details.test.ts   # novos
pnpm vitest run test/errors.test.ts            # regressão do formato atual
pnpm vitest run                                # suíte completa
pnpm lint && pnpm typecheck                    # RF-08
pnpm test                                      # pipeline completo com cobertura
```

Não há teste de desempenho novo. A ramificação de `errorResponse` é uma única comparação booleana antes do caminho padrão. Se for preciso medir, usar `pnpm bench:node`.

## 6. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Vazamento de `message`, `data`, `body` ou stack de erro não tratado. | Alto | D-06 e caso de teste de RF-05 com `debug: false` explícito. |
| R-02 | `type` ou `instance` de um objeto `Error` externo (via `new HTTPError(val)`, `src/response.ts:148`) aparecer em resposta de erro não tratado. | Médio | D-06: `unhandled` força `"about:blank"` e omite `instance`. Teste específico. |
| R-03 | Mudança silenciosa no formato antigo. | Alto | `toJSON` intocado (D-02). Teste de regressão de `toJSON` e dos casos atuais de `test/errors.test.ts`. |
| R-04 | Erros retornados por `handler.fetch` (`src/handler.ts:122-124`) e por `onResponse` de middleware (`src/utils/middleware.ts:26`) saem no formato padrão, mesmo com `problemDetails: true`. | Médio | Documentar como limitação, igual a `debug` hoje (D-07). Registrar caso em aberto se o time quiser propagar `config`. |
| R-05 | `body` com chave `title` é perdido quando `statusText` não existe, porque a chave RFC sobrescreve com `undefined`. | Baixo | Documentar. Caso de teste mostra o comportamento. Alternativa: omitir a chave com `delete` quando `undefined`. |
| R-06 | Tipos públicos mudam (`ErrorInput`, `HTTPError`, `H3Config`). | Baixo | Campos opcionais e readonly; `ErrorBody` intocado; testes de tipo. |
| R-07 | Ramificação em `errorResponse` penaliza o caminho quente. | Baixo | Um `if` antes do caminho padrão; `problemDetailsResponse` separado. Opcional: `pnpm bench:node` antes e depois. |
| R-08 | `type` é aceito como texto livre, sem validar que é URI reference. | Baixo | Fora do escopo (PRD: sem registro de tipos). Documentar no JSDoc. |
| R-09 | `Content-Type` `application/problem+json` pode não ser o desejado pelo time (PRD risco 5). | Médio | Decisão D-04 registrada. Mudar só a constante `problemJsonHeaders`. Confirmar antes da implementação. |
| R-10 | `error.headers` com `content-type` sobrescreve o `application/problem+json`. | Baixo | Mesmo comportamento de hoje com `application/json`. Documentar. |

## 7. Pendências para confirmar antes de implementar

1. Confirmar `Content-Type: application/problem+json` sem charset (D-04, R-09).
2. Confirmar que `detail` de erro não tratado usa `"HTTPError"`, o mesmo texto de `toJSON`, em vez de um texto próprio (D-06).
3. Confirmar que `title` é omitido quando `statusText` não existe (D-03).

As três decisões acima seguem a recomendação desta techspec, e a implementação pode começar com elas se não houver objeção.
