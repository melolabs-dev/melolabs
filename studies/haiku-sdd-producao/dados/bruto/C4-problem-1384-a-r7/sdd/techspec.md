# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Fontes: `sdd/pedido.md` (contrato #1384-A, fonte de verdade para nomes públicos e restrições), `sdd/prd.md` (RF-01 a RF-08) e issue h3js/h3#1384.

Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `88a1076`).

## 1. Resumo

Uma opção booleana `problemDetails` em `H3Config` (padrão desligada) faz o h3 renderizar todo erro como `application/problem+json` (RFC 9457). Sem a opção, a resposta de erro não muda. A única API pública nova é `problemDetails` (opção) e os campos `type` e `instance` de `HTTPError`. A renderização continua no ponto único que já existe, `errorResponse` em `src/response.ts`.

## 2. Situação atual

- Todo erro é renderizado por `errorResponse` (`src/response.ts:358-380`), chamada apenas em `prepareResponse` (`src/response.ts:173`). Ela monta o corpo com `error.toJSON()` mais `stack` (só com `debug`), e usa `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) já faz a máscara de erros não tratados: `message` vira `"HTTPError"`, e `data` e `body` somem quando `unhandled` é verdadeiro. Essa máscara precisa ser reaproveitada, não duplicada.
- `HTTPError` não tem `type` nem `instance`. Os campos existentes são `status`, `statusText`, `headers`, `cause`, `unhandled`, `data`, `body` (`src/error.ts:82-119`). `unhandled` e `status` são lidos de `details` e também de `details.cause` (`src/error.ts:205-206`).
- `H3Config` está em `src/types/h3.ts:28-53`. `debug` e `silent` ficam em `src/types/h3.ts:32` e `src/types/h3.ts:37`.
- A config chega até a renderização por `H3Core.~request` (`src/h3.ts:99`, `toResponse(handlerRes, event, this.config)`). Parte dos caminhos chama `toResponse` sem `config` (ver D-08).
- O 404 de rota inexistente é um `HTTPError` criado em `prepareResponse` (`src/response.ts:139-144`), então passa pelo mesmo `errorResponse`.
- `src/index.ts:72` exporta `ErrorBody`, `ErrorInput` e `HTTPError`. O snapshot de exports (`test/unit/package.test.ts`) não muda, porque `problemDetails` é opção e não export.

## 3. Decisões de arquitetura

### D-01 — Gatilho é uma opção global em `H3Config`

**Alternativas consideradas**

- (a) Opção booleana `problemDetails` em `H3Config`, lida de `config` junto com `debug`.
- (b) Opção por rota ou por handler (ex.: `defineHandler({ problemDetails: true })`).
- (c) Negociação por `Accept: application/problem+json`.

**Escolha: (a).** É o que o pedido define (`sdd/pedido.md`, "Gatilho") e o que o PRD pede (RF-01). A opção segue o padrão de `debug` e `silent`, então não cria um segundo mecanismo. (b) espalha a decisão pelo código da aplicação e não cobre o 404 nem os erros não tratados. (c) mudaria o formato sem a opção ligada, o que o RF-05 proíbe.

### D-02 — Renderização no ponto único `errorResponse`, com helper interno

**Alternativas consideradas**

- (a) Ramificar dentro de `errorResponse` e montar o corpo com uma função interna `toProblemDetails` em `src/response.ts`.
- (b) Criar um método público `HTTPError.toProblemJSON()`.
- (c) Criar um novo ponto de renderização em outro arquivo.

**Escolha: (a).** (b) introduz um nome público novo, o que o pedido proíbe ("Nenhum outro nome público novo"). (c) viola a premissa do PRD de não criar novo ponto de renderização. O helper `toProblemDetails` e a constante `problemHeaders` ficam sem `export`.

### D-03 — Reaproveitar `toJSON()` para dados e máscara, sem alterá-lo

**Alternativas consideradas**

- (a) Chamar `error.toJSON()` dentro de `toProblemDetails`, desestruturar `status`, `statusText`, `message`, `unhandled` e usar o resto como extras (`data`, membros de `body`).
- (b) Reescrever a máscara de `unhandled` dentro de `toProblemDetails`.
- (c) Mudar `toJSON()` para incluir `type` e `instance`.

**Escolha: (a).** A máscara fica em um único lugar (`src/error.ts:226-236`). (c) muda o corpo atual, o que o RF-05 proíbe: `type` e `instance` não devem aparecer no JSON padrão.

### D-04 — `type` e `instance` são lidos só do input, e erros não tratados não expõem `type` de origem

**Alternativas consideradas**

- (a) Ler `type` e `instance` de `details` e também de `details.cause`, como `unhandled` e `status`.
- (b) Ler só de `details`.
- (c) Em erros não tratados, copiar `type` de `details`.

**Escolha: (b), e em erros não tratados `type` vira `"about:blank"` e `instance` é omitido.**

- Em `prepareResponse`, erros que não são `HTTPError` viram `new HTTPError(val)` (`src/response.ts:148`). Então `details` é o próprio `Error` original. Alguns erros de terceiros carregam uma propriedade `type` (ex.: erros de parser), e isso não deve virar a URI de problema de uma resposta 500 oculta. Com (a) ou (c), esse valor vazaria.
- Em (a), o `cause` também seria lido, o que aumenta o vazamento pelo mesmo motivo.
- Esta escolha diverge de `unhandled` e `status`, que usam fallback em `cause`. A divergência é intencional e documentada aqui.

### D-05 — Precedência entre membros padrão e `data`/`body`

**Alternativas consideradas**

- (a) Membros padrão (`type`, `title`, `status`, `detail`, `instance`) sobrescrevem as extras de `data` e `body` quando definidos.
- (b) `body` sobrescreve os membros padrão, como acontece com `...this.body` em `toJSON()` (`src/error.ts:234`).
- (c) Remover `data` e `body` do formato problem.

**Escolha: (a).** Com (b), `new HTTPError({ body: { status: 200 } })` forjaria o `status` do problema. O pedido mantém `data` e `body` como membros extras (`sdd/prd.md`, premissa), então (c) fica de fora. Um membro padrão sem valor (ex.: `statusText` ausente) não sobrescreve `body.title`, por isso a sobrescrita é condicional.

Também não sai `unhandled`, que é extensão do formato atual, do corpo problem. Os membros listados em RF-03 são o contrato. Ver pendência P-1.

### D-06 — Content-Type exato e headers de erro preservados

**Alternativas consideradas**

- (a) `application/problem+json`, sem `charset`.
- (b) `application/problem+json;charset=UTF-8`, como `jsonHeaders` (`src/response.ts:271`).

**Escolha: (a)**, porque RF-02 e o teste de aceite pedem a igualdade exata. JSON é UTF-8 por padrão (RFC 8259). `error.headers` (`src/response.ts:359-361`) e `errHeaders` (`src/response.ts:362-364`) continuam sendo mesclados da mesma forma, e isso cobre RF-08.

### D-07 — `errorResponse` recebe `config` em vez de `debug`

**Alternativas consideradas**

- (a) Trocar a assinatura para `errorResponse(error, config, errHeaders)` e ler `config.debug` e `config.problemDetails` dentro.
- (b) Acrescentar um terceiro parâmetro posicional booleano, `errorResponse(error, debug, errHeaders, problemDetails)`.

**Escolha: (a).** A função é interna e tem um único chamador (`src/response.ts:173`). Dois booleanos posicionais são ilegíveis no call site.

### D-08 — Caminhos sem `config` seguem a mesma regra de `debug`

Alguns caminhos chamam `toResponse` sem `config`, então ignoram `debug`, `onError` e agora `problemDetails`:

- `src/handler.ts:122` e `src/handler.ts:124` (`.fetch` de handler sem app).
- `src/utils/middleware.ts:26` (`onResponse`, quando o handler retorna um erro sem lançá-lo).
- `src/rules/cache.ts:314`.

**Escolha: manter a paridade com `debug` nesta entrega e registrar a lacuna** (ver R-4 e P-2). Corrigir exigiria passar `event.app?.config` nesses pontos, o que é uma mudança de comportamento para `debug` e `onError` também. Não é o escopo do pedido.

## 4. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/types/h3.ts:37` | Adicionar `problemDetails?: boolean;` logo após `silent`, com JSDoc no padrão das opções vizinhas. |
| `src/error.ts:30-69` | Em `ErrorBody`, adicionar `type?: string;` e `instance?: string;` com JSDoc. Como `ErrorInput` estende `Partial<ErrorBody>` (`src/error.ts:6`), o input aceita os dois campos sem outra mudança. |
| `src/error.ts:119` | Em `HTTPError`, declarar `readonly type: string \| undefined;` e `readonly instance: string \| undefined;` logo após `unhandled`. Tipo explícito, por causa de `isolatedDeclarations`. |
| `src/error.ts:205-209` | No construtor, atribuir `this.type = (details as ErrorBody)?.type;` e `this.instance = (details as ErrorBody)?.instance;`, sem fallback em `cause` (D-04). |
| `src/error.ts:226-236` | `toJSON()` **não muda** (D-03). |
| `src/response.ts:173` | Trocar `errorResponse(error, config.debug, errHeaders)` por `errorResponse(error, config, errHeaders)`. |
| `src/response.ts:270-272` | Acrescentar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`), ao lado de `jsonHeaders`. |
| `src/response.ts:358-380` | `errorResponse` escolhe `problemHeaders` ou `jsonHeaders` e o corpo entre `toJSON()` (padrão) e `toProblemDetails()`. A função `toProblemDetails` fica em seguida, sem `export`. |
| `test/_setup.ts:135-136` e `test/_setup.ts:166` | Ver seção 6: o harness fixa `debug: true` e não aceita config extra. |
| `test/errors.test.ts` | Nenhuma asserção existente muda (ver seção 6). |
| `test/problem-details.test.ts` | Arquivo novo, com `describeMatrix`, cobrindo RF-02 a RF-08. |
| `test/unit/error.test.ts` | Arquivo novo, cobrindo RF-04 sem HTTP. |
| `docs/1.guide/1.basics/6.error.md:51` (seção "`HTTPError` Fields") | Documentar `type` e `instance` e a opção `problemDetails`. Recomendado, não obrigatório pelo pedido. |

## 5. Contratos e assinaturas

```ts
// src/types/h3.ts — dentro de H3Config
/**
 * When enabled, H3 renders error responses as RFC 9457 problem details
 * (`application/problem+json`). Disabled by default.
 */
problemDetails?: boolean;

// src/error.ts — dentro de ErrorBody (entram também em ErrorInput e em HTTPError)
/** RFC 9457 `type` URI. Used only when `problemDetails` is enabled. */
type?: string;
/** RFC 9457 `instance` URI reference. Used only when `problemDetails` is enabled. */
instance?: string;

// src/error.ts — HTTPError (campos novos, somente leitura)
readonly type: string | undefined;
readonly instance: string | undefined;

// src/response.ts — interno, sem export
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

function toProblemDetails(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Comportamento de `toProblemDetails` (pseudocódigo):

```ts
// unhandled: toJSON() já mascarou message, data e body
const { status, statusText, message, unhandled, ...extras } = error.toJSON();
return {
  ...extras,                                           // data e membros de body
  type: unhandled ? "about:blank" : error.type || "about:blank", // ver D-04
  ...(statusText !== undefined && { title: statusText }),
  status,
  ...(!unhandled && { detail: message }),
  ...(!unhandled && error.instance !== undefined && { instance: error.instance }),
  ...(debug && error.stack && { stack: error.stack.split("\n").map((l) => l.trim()) }),
};
```

Exemplo de corpo (RF-03, com `debug` desligado):

```json
{
  "type": "https://exemplo.com/erros/sem-permissao",
  "title": "Forbidden",
  "status": 403,
  "detail": "Sem permissão",
  "instance": "/pedidos/42"
}
```

Erro não tratado (`new Error("segredo do banco")`), com `problemDetails: true` e `debug` desligado:

```json
{ "type": "about:blank", "status": 500 }
```

Nenhum membro leva `"segredo do banco"`. O `title` não aparece porque o erro não tem `statusText`.

## 6. Estratégia de testes

### Ordem (TDD, como manda `AGENTS.md`, "Bug Fix Workflow")

1. Escrever os testes novos antes de qualquer código de produção.
2. Rodar e confirmar que falham pelo motivo esperado (opção ignorada, campos `type` e `instance` inexistentes).
3. Implementar a seção 4.
4. Rodar de novo e confirmar que passam.
5. Rodar a suíte completa.

### Ajuste de infraestrutura (necessário antes dos testes)

- `test/_setup.ts:135-136` cria `new H3({ debug: true, ... })`, fixo. O `ctx.app` é criado em `beforeEach` e o alvo `node` já liga `toNodeHandler(ctx.app)` na mesma fase (`test/_setup.ts`, `setupNodeTest`). Por isso não dá para trocar `ctx.app` dentro do teste.
- Adicionar em `TestOptions` (`test/_setup.ts:164-170`) um campo `config?: Partial<H3Config>`, espalhado no `new H3({...})`. Assim, o teste declara `describeMatrix("...", fn, { config: { problemDetails: true, debug: false } })`.
- Para RF-06, o teste gera erro não tratado. O `afterEach` de `test/_setup.ts:152` falha se houver erro não tratado sem `allowUnhandledErrors`. Usar `allowUnhandledErrors: true` nesse caso. Usar também `silent: true` para não poluir o console (`src/response.ts:156`).

### Testes de unidade (`test/unit/error.test.ts`, sem HTTP)

- RF-04: `new HTTPError({ status: 400, message: "x", type: "urn:erro:x", instance: "/a" })` expõe `type` e `instance`.
- RF-04: sem os campos, ambos são `undefined`.
- D-04: `new HTTPError({ cause: new HTTPError({ status: 400, type: "urn:x" }) })` tem `type` `undefined`. Esse teste fixa a decisão de não ler `cause`.
- D-03: `toJSON()` não contém `type` nem `instance`, mesmo quando definidos (RF-05).

### Testes de integração (`test/problem-details.test.ts`, `describeMatrix`, web e node)

| Requisito | Cenário |
|---|---|
| RF-01 | `app.config.problemDetails` é `undefined` sem a opção, e `true` com `new H3({ problemDetails: true })`. |
| RF-02 | `HTTPError` 422 com `message` vira status 422, `Content-Type: application/problem+json`, `detail` e `status`. |
| RF-02 | Rota inexistente retorna 404 com `application/problem+json`. |
| RF-03 | Erro com `type`, `statusText`, `message` e `instance` gera o corpo esperado. |
| RF-03 | Erro sem `type` gera `type: "about:blank"`. |
| RF-03 | Erro sem `statusText` não tem `title`. |
| RF-05 | Sem a opção, `Content-Type` continua `application/json;charset=UTF-8` e o corpo tem exatamente as chaves de antes. |
| RF-06 | `debug: false`, `new Error("segredo do banco")`: status 500, `application/problem+json`, corpo sem a string secreta (checar o texto bruto, não só as chaves). |
| RF-07 | `debug: true`: corpo com `stack`. `debug: false`: sem `stack`. |
| RF-08 | `headers: { "retry-after": "30" }` aparece na resposta com `application/problem+json`. |
| RF-08 | `onError` que retorna `Response` próprio: essa é a resposta entregue. |
| D-05 | `body: { status: 200, title: "x" }` não sobrescreve `status` nem `title` quando estes estão definidos. |
| D-04 | Erro não tratado com `type` de origem (`Object.assign(new Error("x"), { type: "entity.too.large" })`) entrega `type: "about:blank"`. |

### Regressão

- Nenhuma asserção existente precisa mudar, pela análise. As que tocam em `content-type` de erro são de formato padrão: `test/errors.test.ts:44` (`application/json;charset=UTF-8`) e `test/errors.test.ts:140` (`toMatch("application/json")`). Continuam valendo porque a opção está desligada. Se algum teste quebrar, ajustar só o que mudou, sem perder o que ele verifica (`sdd/pedido.md`).
- `test/unit/package.test.ts` (snapshot de exports) não deve mudar. Se mudar, há export vazado.
- `test/app.test.ts:265` (404) e `test/hooks.test.ts` (`onError`) cobrem caminhos que passam pelo mesmo `errorResponse`.
- Comandos: `pnpm vitest run test/problem-details.test.ts`, `pnpm vitest run test/unit/error.test.ts`, `pnpm vitest run test/errors.test.ts test/hooks.test.ts test/app.test.ts`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test`.
- Tipos: opcionalmente, um caso em `test/unit/types.test-d.ts` confirmando que `H3Config["problemDetails"]` é `boolean | undefined` e que `HTTPError["type"]` é somente leitura.

## 7. Riscos

- **R-1 — Clientes com `Content-Type` estrito.** Quem liga a opção e checa `application/json` quebra. Mitigação: padrão desligado e nota de mudança de formato na documentação.
- **R-2 — Vazamento de dados de erro não tratado.** Mitigado por D-03 (reuso da máscara de `toJSON`) e D-04 (`type` de origem não vai para a resposta), com testes de RF-06 e de D-04.
- **R-3 — Colisão entre `body` e membros padrão.** Mitigado por D-05 e coberto por teste.
- **R-4 — Caminhos sem `config` (D-08).** Erros renderizados por `src/handler.ts:122-124`, `src/utils/middleware.ts:26` e `src/rules/cache.ts:314` saem em JSON padrão mesmo com a opção ligada. A lacuna já existe para `debug` e `onError`. Se o usuário quiser fechá-la nesta entrega, a correção é passar `event.app?.config` nesses pontos (ver P-2).
- **R-5 — Harness com `debug: true` fixo.** Sem a opção nova em `TestOptions`, os testes de RF-06 e RF-07 não conseguem rodar com `debug: false`. Mitigado pela seção 6.
- **R-6 — `content-type` vindo de `error.headers`.** Um `HTTPError` com `headers: { "content-type": ... }` sobrescreve o `application/problem+json`. Já acontece hoje com `application/json` (`src/response.ts:359-361`). Mantido, mas vale saber.
- **R-7 — Tipos e lint.** Os campos novos precisam de tipo explícito por causa de `isolatedDeclarations`. Rodar `pnpm lint` e `pnpm typecheck`, como pede o pedido.
- **R-8 — HEAD e status sem corpo.** `errorResponse` continua devolvendo `FastResponse` com corpo, e `nullBody` (`src/response.ts:350-356`) é aplicado depois, no caminho `val instanceof Response` (`src/response.ts:188`, `src/response.ts:234`). A mudança não toca esse caminho, mas um teste de HEAD com a opção ligada é barato e vale incluir.

## 8. Pendências para confirmação

- **P-1.** Em problem details, `unhandled` não aparece no corpo. Isso é consistente com RF-03 ("o corpo contém" a lista). Se o usuário quiser manter `unhandled: true` como extensão para quem já lê esse campo, é uma linha em `toProblemDetails`.
- **P-2.** Fechar a lacuna D-08 (passar `event.app?.config` nos caminhos sem `config`) altera também `debug` e `onError` nesses caminhos. Recomendo tratar em uma entrega separada. Confirmar.
- **P-3.** Em erro não tratado, `type` vira `"about:blank"` (D-04). O PRD diz que `type` "continua presente" (RF-06), o que bate com isso. Confirmar que é a leitura desejada.
