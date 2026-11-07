# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08).

## 1. Estado atual (conferido no código)

- `H3Config` (`src/types/h3.ts:28`) tem `debug` (`src/types/h3.ts:32`) e `silent`; `app.config` é `readonly config: H3Config` (`src/types/h3.ts:99`) e `H3Core` guarda o objeto recebido (`src/h3.ts:55`).
- `H3Core["~request"]` chama `toResponse(handlerRes, event, this.config)` (`src/h3.ts:99`), então `config` chega a todo o pipeline de erro.
- `prepareResponse` (`src/response.ts:129`) normaliza qualquer `Error` em `HTTPError` (`src/response.ts:146-155`), executa `onError` (`src/response.ts:159-166`) e renderiza com `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`).
- `errorResponse` (`src/response.ts:358-380`) monta os cabeçalhos a partir de `jsonHeaders` (`src/response.ts:270`), mescla `error.headers` e depois `errHeaders`, e serializa `{...error.toJSON(), stack}` (`src/response.ts:366-373`).
- `ErrorBody` (`src/error.ts:30-69`) é a interface do corpo; `ErrorInput` (`src/error.ts:6`) a estende via `Partial<ErrorBody>`; `HTTPError` (`src/error.ts:74`) implementa `ErrorBody`, declara as propriedades readonly (`src/error.ts:82-119`) e as preenche no construtor (`src/error.ts:162-210`, `data`/`body` em `src/error.ts:208-209`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) mascara `message`, `data` e `body` quando `unhandled`.
- Fora do fluxo da aplicação, `handlerWithFetch` (`src/handler.ts:122,124`) e `onResponse` (`src/utils/middleware.ts:26`) chamam `toResponse` **sem** `config`.
- `describeMatrix` (`test/_setup.ts:11`) cria `ctx.app = new H3({ debug: true, ... })` a cada teste (`test/_setup.ts:135-141`). Os testes existentes de erro fixam `application/json;charset=UTF-8` (`test/errors.test.ts:44`, `test/errors.test.ts:140`).
- A lista de exports públicos é fixada por snapshot em `test/unit/package.test.ts:6`.

## 2. Decisões de arquitetura

### D-01 — Gatilho: `problemDetails` lido de `config` em tempo de resposta

**Alternativas:** (a) negociação por `Accept`; (b) opção por rota/requisição; (c) opção booleana em `H3Config`, lida em `errorResponse`.
**Escolha: (c).** É o que o contrato #1384-A define; (a) e (b) estão fora de escopo no PRD. Ler em tempo de resposta (e não no construtor) segue o padrão de `debug` e permite alterar `app.config.problemDetails` nos testes. `errorResponse` deixa de receber `debug` solto e passa a receber o `H3Config` inteiro.

### D-02 — `toJSON()` de `HTTPError` permanece intacto; o corpo problem details é montado fora dele

**Alternativas:** (a) fazer `toJSON()` depender do modo; (b) criar um método público novo (ex.: `toProblem()`); (c) função interna que monta o corpo a partir da instância.
**Escolha: (c).** (a) é impossível sem acesso à config (o erro não conhece a app) e quebraria RF-08; (b) viola "nenhum outro nome público novo". `toJSON()` não ganha `type`/`instance`, para manter o formato antigo idêntico (RF-01, RF-08).

### D-03 — Helper interno em arquivo próprio: `src/utils/internal/problem-details.ts`

**Alternativas:** (a) tudo em `src/response.ts` (como sugere a premissa do PRD); (b) arquivo interno novo.
**Escolha: (b).** `src/response.ts` já tem 380 linhas e a convenção do projeto é arquivos curtos e helpers internos em `utils/internal/`. O arquivo não é exportado por `src/index.ts`, logo não cria nome público (o snapshot `test/unit/package.test.ts:6` não muda). Conteúdo: `problemDetailsBody(error, debug)` e a tabela mínima de frases de razão. A mudança de comportamento continua só em `response.ts`, `error.ts` e `types/h3.ts`.

### D-04 — `type` e `instance` entram em `ErrorBody` e viram propriedades readonly

**Alternativas:** (a) só em `ErrorInput`; (b) em `ErrorBody` (herdado por `ErrorInput` via `Partial`).
**Escolha: (b).** O PRD (RF-02) cita `ErrorInput`/`ErrorBody`, e `HTTPError implements ErrorBody` mantém interface e classe alinhadas. Os campos são `type?: string` e `instance?: string` na interface; na classe, `readonly type: string | undefined` e `readonly instance: string | undefined`.
**Origem do valor:** lidos só de `details` (o objeto de entrada), **não** de `details.cause`, ao contrário de `status`/`statusText`. Motivo: `new HTTPError(err)` embrulha erros arbitrários (`src/response.ts:148`) e algumas classes de erro têm `.type` próprio; ler de `cause` poderia promover um valor alheio a membro padrão da RFC. `HTTPError.status(...)` propaga `details` por spread (`src/error.ts:149`) e continua funcionando.

### D-05 — Montagem do corpo e precedência dos membros padrão

Ordem de construção do objeto (a última chave vence):

1. extensões de `body` (somente se não `unhandled`);
2. `data` sob a chave `data` (somente se não `unhandled` e definido);
3. membros padrão `type`, `title`, `status`, `detail`, `instance`;
4. `stack` (somente com `debug`).

**Alternativa:** filtrar chaves reservadas de `body`. **Escolha:** posicionar os membros padrão depois do spread, que é mais simples e dá o mesmo resultado para RF-05 (`status: 999` em `body` perde para o status real). `data` vem antes dos padrão, então `data` não sobrescreve `type`; já uma chave `data` em `body` é substituída por `error.data` quando este existe (mesmo comportamento atual de `toJSON`).

Regras dos membros:

| Membro     | Regra                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| `type`     | `error.type`, senão `"about:blank"`; `"about:blank"` sempre quando `unhandled`   |
| `title`    | `error.statusText`, senão frase padrão do status (D-06)                          |
| `status`   | `error.status` (status HTTP real)                                                |
| `detail`   | `error.message`, omitido quando `unhandled` ou quando é só o padrão (ver abaixo) |
| `instance` | `error.instance`, omitido se ausente ou `unhandled`                              |

`detail` é omitido quando `message` é igual ao que o construtor gera sozinho: `["HTTPError", status, statusText].filter(Boolean).join(" ")` (`src/error.ts:193`) ou o próprio `statusText` (`src/error.ts:191`, fallback quando só há `statusText`). Sem isso `HTTPError.status(404)` produziria `detail: "HTTPError 404"`, ruído sem valor (RF-04).

### D-06 — Frase de razão padrão por tabela interna mínima

**Alternativas:** (a) `Response`/`statusText` do runtime; (b) tabela interna; (c) omitir `title`.
**Escolha: (b).** (a) é inconsistente entre runtimes (risco listado no PRD) e `new Response(null,{status})` retorna `statusText` vazio; (c) quebra RF-04 (`title` não vazio). Tabela com os códigos comuns (400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 418, 422, 429, 500, 501, 502, 503, 504, entre outros). Para código fora da tabela, `title` usa `"Client Error"` (4xx), `"Server Error"` (5xx) ou `"Error"`. Tabela não exportada.

### D-07 — Cabeçalhos: novo `problemHeaders` congelado e mesma ordem de mescla

`const problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` ao lado de `jsonHeaders` (`src/response.ts:270`; `FrozenHeaders` é declarado antes, em `src/response.ts:260`). `errorResponse` escolhe a base conforme a config e mantém a ordem atual: base → `error.headers` → `errHeaders` (`src/response.ts:359-364`). Assim `x-id` do erro sobrevive e o `Content-Type` problem details substitui o JSON padrão (RF-07). Um `content-type` definido explicitamente em `error.headers` continua vencendo, exatamente como hoje com o JSON; isso é intencional e não é alterado.
O `charset` é mantido por consistência com `jsonHeaders`; os testes verificam "começa com `application/problem+json`".

### D-08 — Erros não tratados

`unhandled` segue a mesma proteção de `toJSON` (`src/error.ts:227-234`): sem `message`, `data`, `body`, `instance`; `type = "about:blank"`; `detail` omitido. `title` vem da frase padrão do status (500 → "Internal Server Error"), mas **não** de `statusText` (que pode vir de `cause` arbitrário via `src/error.ts:180-185`). `stack` só aparece com `debug` (RF-06/RF-07), como hoje (`src/response.ts:369`).

### D-09 — Caminhos que chamam `toResponse` sem config ficam como estão

`src/handler.ts:122,124` (`.fetch` de um handler avulso) e `src/utils/middleware.ts:26` (middleware `onResponse` que renderiza um `Error` _retornado_) não recebem `config`; hoje também ignoram `debug`. **Alternativas:** propagar a config por `event.app?.config`; **escolha:** não alterar. O PRD limita o escopo a `error.ts`, `response.ts` e `types/h3.ts`, e o gatilho é "da aplicação" (RF-01). Fica registrado como limitação conhecida (seção 6).

### D-10 — `onError` e erros retornados

Nada muda no encadeamento de `onError`: o `HTTPError` entregue ao hook é o mesmo, e o render problem details só ocorre na linha `src/response.ts:173`, depois do hook. Erros _retornados_ (`return new HTTPError(...)`) passam pelo mesmo ramo `val instanceof Error` (`src/response.ts:146`), então RF-03 vale para lançados e retornados. `kNotFound` (`src/response.ts:139-144`) também sai como problem details (404, `detail` = "Cannot find any route matching ...").

## 3. Arquivos a alterar

| Arquivo                                 | Linhas                    | Mudança                                                                                                      |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/types/h3.ts`                       | `src/types/h3.ts:32`      | adicionar `problemDetails?: boolean` com JSDoc após `debug`                                                  |
| `src/error.ts`                          | `src/error.ts:30-69`      | `type?: string`, `instance?: string` em `ErrorBody` (JSDoc citando RFC 9457)                                 |
| `src/error.ts`                          | `src/error.ts:112`        | propriedades `readonly type` e `readonly instance` após `body`                                               |
| `src/error.ts`                          | `src/error.ts:208-209`    | no construtor: `this.type = (details as ErrorBody)?.type; this.instance = (details as ErrorBody)?.instance;` |
| `src/error.ts`                          | `src/error.ts:226-236`    | **sem alteração** (`toJSON` intacto)                                                                         |
| `src/response.ts`                       | `src/response.ts:173`     | `errorResponse(error, config, errHeaders)`                                                                   |
| `src/response.ts`                       | `src/response.ts:270`     | novo `problemHeaders`                                                                                        |
| `src/response.ts`                       | `src/response.ts:358-380` | `errorResponse` escolhe base de cabeçalhos e corpo conforme `config.problemDetails`                          |
| `src/utils/internal/problem-details.ts` | novo                      | helper interno (D-03)                                                                                        |
| `test/problem-details.test.ts`          | novo                      | testes RF-01 a RF-07                                                                                         |
| `src/index.ts`                          | `src/index.ts:72`         | **sem alteração** (tipos já exportados)                                                                      |

Nenhum teste existente precisa mudar: a opção é desligada por padrão e `test/errors.test.ts:44,140` continuam válidos. Se algum falhar na execução, o ajuste deve manter o que o teste verifica.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — H3Config
/**
 * When enabled, errors are sent as RFC 9457 problem details (`application/problem+json`).
 */
problemDetails?: boolean;

// src/error.ts — ErrorBody
type?: string;      // URI reference identifying the problem type (RFC 9457 `type`)
instance?: string;  // URI reference identifying this occurrence (RFC 9457 `instance`)

// src/error.ts — HTTPError
readonly type: string | undefined;
readonly instance: string | undefined;

// src/utils/internal/problem-details.ts (não exportado por src/index.ts)
export function problemDetailsBody(
  error: HTTPError,
  debug?: boolean,
): Record<string, unknown>;

// src/response.ts (função interna, não exportada)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Exemplo de saída (`problemDetails: true`, `debug: false`):

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json;charset=UTF-8

{"codigo":"E42","data":{"campo":"nome"},"type":"https://exemplo.com/erros/nao-encontrado","title":"Not Found","status":404,"detail":"Usuário não existe","instance":"/usuarios/7"}
```

Serialização: `JSON.stringify(body, undefined, config.debug ? 2 : undefined)`, igual ao caminho atual (`src/response.ts:366-373`); chaves `undefined` somem sozinhas.

## 5. Estratégia de testes

Novo `test/problem-details.test.ts` com `describeMatrix` (web + node, `test/_setup.ts:11`). Como `ctx.app` já nasce com `debug: true` (`test/_setup.ts:136`), cada teste liga a opção com `t.app.config.problemDetails = true` (o campo é mutável; só a propriedade `config` é readonly) e, onde `stack` não deve aparecer, `t.app.config.debug = false`. Erros `unhandled` exigem `describeMatrix(..., { allowUnhandledErrors: true })` (`test/_setup.ts:152`).

| RF    | Teste                                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-01 | sem opção e com `false`: 404 mantém `application/json`, corpo com `status`, `statusText`, `message`; sem chaves `title`/`type`/`detail`                                                                                     |
| RF-02 | unit: `type`/`instance` informados lidos na instância; ausentes → `undefined`; `toJSON()` não os contém; `HTTPError.status(400, undefined, { type })` preserva                                                              |
| RF-03 | erro com `statusText`, `message`, `type`, `instance` → status 404, content-type `application/problem+json`, corpo com os cinco membros; também erro **retornado** (`return new HTTPError`) e rota inexistente (`kNotFound`) |
| RF-04 | `HTTPError.status(404)`: `type: "about:blank"`, `status: 404`, `title` não vazio, sem `instance`, sem `detail`; código fora da tabela (ex.: 499) tem `title` não vazio                                                      |
| RF-05 | `body: { codigo, status: 999 }` + `data` → `codigo` no topo, `data` sob a chave, `status` 404 real; `body: { title: "x" }` não sobrescreve `title`                                                                          |
| RF-06 | `throw new Error("segredo interno")`, `debug` off → 500, problem+json, corpo sem `segredo interno` e sem `stack`; `unhandled` com `type`/`instance`/`data` no input não os vaza                                             |
| RF-07 | `headers: { "x-id": "1" }` → `x-id` e content-type problem+json; `event.res.errHeaders`/`set-cookie` ainda mesclados sem duplicar (com `onError` do `ctx.hooks`); com `debug` on, `stack` presente                          |
| RF-08 | `pnpm vitest run` (suíte completa), `pnpm lint`, `pnpm typecheck`; snapshot de exports (`test/unit/package.test.ts:6`) inalterado                                                                                           |

Seguir o fluxo de correção do AGENTS.md: escrever os testes antes, confirmar que falham, implementar e então rodar a suíte completa. Cuidado nos testes de `message`: o corpo de `kNotFound` carrega a URL da requisição (nos testes de node, porta variável), então não comparar o `detail` completo.

## 6. Riscos

| Risco                                                                                                  | Mitigação                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Colisão `type`/`instance` com `cause`** — erros embrulhados com `.type` próprio virariam membros RFC | D-04: lidos só de `details`, nunca de `cause`                                                               |
| **Colisão com `body`** — `body: { type }`                                                              | D-05: membros padrão vêm depois do spread e vencem; `toJSON` (modo desligado) mantém o comportamento antigo |
| **Vazamento via `detail`**                                                                             | D-08: `unhandled` omite `detail`, `instance`, `data`, `body`; teste RF-06                                   |
| **`title` vindo de `statusText` controlado por usuário**                                               | `statusText` já é sanitizado no construtor (`src/error.ts:180-185`, `src/utils/sanitize.ts:10`)             |
| **Regressão no formato antigo**                                                                        | ramo desligado não toca em `toJSON` nem em `jsonHeaders`; testes existentes de erro rodam sem alteração     |
| **Cobertura parcial** — `handler.ts:122,124` e `utils/middleware.ts:26` ignoram a opção                | D-09: limitação documentada; mesma situação de `debug` hoje                                                 |
| **Content-Type exato** — consumidores que checam `application/json` quebram ao ligar                   | esperado por ser opt-in; `charset=UTF-8` mantido por consistência                                           |
| **Mutação de `config` nos testes** (`readonly config`)                                                 | só o campo é atribuído; se o typecheck reclamar, passar a opção via `new H3({ ... })` em `describe` próprio |
| **Tabela de frases incompleta**                                                                        | fallback por classe de status (D-06); nenhum caso termina com `title` vazio                                 |
| **Tamanho de `response.ts`** (já > 200 linhas)                                                         | lógica nova isolada em `utils/internal/problem-details.ts`                                                  |
