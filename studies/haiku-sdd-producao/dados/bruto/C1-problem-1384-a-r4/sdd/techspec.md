# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-09).
Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `0fd23f8`).

## 1. Visão geral

Uma nova opção booleana `problemDetails` em `H3Config` (desligada por padrão) faz o h3 renderizar erros
em `application/problem+json`, conforme RFC 9457. A mudança concentra-se em três pontos:

1. **Opção** — `problemDetails?: boolean` em `H3Config` (`src/types/h3.ts:28`), lida de `app.config`.
2. **Modelo de erro** — `HTTPError` aceita e expõe `type` e `instance` (`src/error.ts:6`, `:30`, `:74`, `:162`).
3. **Renderização** — `errorResponse` (`src/response.ts:358`) escolhe entre o formato atual e o formato problem details.
   Nada muda no caminho de sucesso nem em `HTTPError.toJSON()`, que continua sendo o formato padrão.

Não há nome público novo além de `problemDetails`, `type` e `instance`. Os helpers novos ficam não exportados.

## 2. Decisões de arquitetura

### D-01 — Onde a opção vive: `H3Config`, lida em tempo de requisição

**Escolha:** adicionar `problemDetails?: boolean` a `H3Config` (`src/types/h3.ts:28-53`), com JSDoc no mesmo
estilo de `debug` e `silent` (`src/types/h3.ts:29-37`). Como `H3CoreConfig` é `Omit<H3Config, "plugins">`
(`src/types/h3.ts:55`), a opção entra em `app.config` sem mudança adicional.

**Por quê:** o PRD exige que a opção seja global, lida de `app.config` e não alterada em tempo de execução.
`H3Core` já guarda o config em `this.config` (`src/h3.ts:53-55`) e `toResponse` já recebe esse objeto em
`src/h3.ts:99`. Um campo a mais nesse objeto é a forma mais simples de propagar a escolha.

**Alternativas consideradas:**
- *Opção por rota ou por handler* — fora de escopo (PRD, "Fora de escopo").
- *Middleware de usuário que reescreve o erro via `onError`* — obriga cada projeto a montar o formato,
  que é exatamente o problema do PRD.

### D-02 — Renderização dentro de `errorResponse`, sem nova camada

**Escolha:** `errorResponse` passa a receber o `config` inteiro (em vez de só `debug`) e escolhe o corpo e
o `Content-Type`. O fluxo de erro de `prepareResponse` (`src/response.ts:146-174`) não muda: `onError`
continua rodando antes (`src/response.ts:159-166`), e os headers de erro (`error.headers` e `errHeaders`)
continuam sendo mesclados em `errorResponse`.

**Por quê:** é o único lugar que já reúne `debug`, `error.headers` e `errHeaders`. Uma camada separada
duplicaria essa lógica e arriscaria a ordem dos headers, que os testes existentes verificam
(`test/errors.test.ts:29-48`, incluindo `set-cookie`).

**Alternativas consideradas:**
- *Passar um booleano `problemDetails` como novo parâmetro* — funciona, mas `errorResponse` já recebe `debug`
  por parâmetro posicional; passar `config` evita crescer a assinatura.

### D-03 — `type` e `instance` em `ErrorBody`, lidos só de entrada literal

**Escolha:**
- Adicionar `type?: string` e `instance?: string` em `ErrorBody` (`src/error.ts:30-69`). `ErrorInput` já
  herda `Partial<ErrorBody>` (`src/error.ts:6`), então o construtor aceita os dois campos sem outra mudança de tipo.
  `HTTPError implements ErrorBody` (`src/error.ts:74`), então a classe ganha `readonly type` e `readonly instance`.
- No construtor, ler os dois campos **apenas** quando `details` é um objeto de entrada e **não** é uma `Error`,
  e aceitar só valores `string`.

**Por quê:** `new HTTPError(val)` em `src/response.ts:148` recebe qualquer `Error`, inclusive erros de
terceiros. Muitos deles têm uma propriedade `type` com outro significado (por exemplo, erros de parsing de
body com `type: "entity.parse.failed"`). Se o construtor copiasse `type` de uma `Error` qualquer, esse valor
iria para a resposta como URI de problema. O comentário de `toError` (`src/response.ts:63-71`) já estabelece
que objeto não-Error não pode moldar a resposta, e a regra acima mantém essa postura.

**Alternativas consideradas:**
- *Ler `type` e `instance` também de `details.cause`, como `unhandled` (`src/error.ts:205-206`)* — rejeitada.
  `toError` define `cause` com o valor lançado (`src/response.ts:80-81`), então um `throw { type: "..." }`
  moldaria a resposta.
- *Campos só em `ErrorInput`, sem `ErrorBody`* — rejeitada, porque `HTTPError` precisa expô-los na instância
  e `implements ErrorBody` já obriga a declarar os campos opcionais na classe.

**Consequência:** `new HTTPError(existente)` em que `existente` é um `HTTPError` perde `type` e `instance`.
Aceitável: o padrão do projeto é criar um novo erro a partir de um objeto de entrada.

### D-04 — Valor padrão e fonte de `title`

**Escolha:**
- `type` ausente → `"about:blank"` (RF-05, RFC 9457 §4.2.1).
- `title` = `error.statusText` (`src/error.ts:92`). Se `statusText` estiver ausente, `title` **não é enviado**
  (`undefined` some no `JSON.stringify`). RFC 9457 torna `title` opcional.

**Por quê:** o projeto não tem tabela de textos padrão de status. Pesquisa em `src/` por `Not Found`,
`Internal Server Error` e `STATUS_CODES` não encontrou nada. Criar a tabela aumentaria o núcleo sem
necessidade, contra a diretriz de núcleo mínimo do `AGENTS.md`.

**Alternativas consideradas:**
- *Tabela de textos padrão (`404 → "Not Found"`)* — mais fiel ao espírito da RFC, mas adiciona ~60 linhas de
  dados. Fica como alternativa se o revisor preferir `title` sempre presente.

### D-05 — Corpo problem details: campos de extensão e precedência

**Escolha:** o corpo é montado por uma função interna `toProblemDetails(error, debug)` (contrato em §4), com
esta ordem:
1. membros de `error.body`, quando não `unhandled`;
2. `data`, quando não `unhandled` e definido;
3. os membros reservados da RFC (`type`, `title`, `status`, `detail`, `instance`), que **sempre prevalecem**
   sobre os anteriores;
4. `stack`, só com `debug` (mesmo comportamento de `src/response.ts:369`).

`detail` = `error.message`, omitido para `unhandled` (RF-07). Para `unhandled`, `type` continua sendo
`"about:blank"` e não há `detail`, `data` nem `body` (mesma regra de `HTTPError.toJSON`, `src/error.ts:226-236`).

**Por quê:** RF-08 pede preservar `data` e `body`. Como `body` é espalhado no topo, um `body` com chave
`status` ou `type` poderia sobrescrever os campos da RFC. Dar precedência aos reservados evita isso.
Manter `stack` em `debug` preserva o que o modo debug já mostra hoje.

**Alternativas consideradas:**
- *Reaproveitar `toJSON()` e remapear* — rejeitada: `toJSON` mescla `data` e `body` e inclui `unhandled` e
  `statusText`, o que obrigaria a desfazer a mistura. Uma função própria é mais clara.
- *Incluir `unhandled: true` no corpo problem details* — rejeitada: é campo interno do formato próprio, sem
  equivalente na RFC.

### D-06 — `Content-Type` exato, sem parâmetro `charset`

**Escolha:** `application/problem+json`, sem `;charset=UTF-8`. O PRD (RF-03) pede esse valor exato, e JSON é
UTF-8 por definição (RFC 8259). O padrão atual `application/json;charset=UTF-8` fica em `jsonHeaders`
(`src/response.ts:270-272`), intacto.

**Alternativa:** `application/problem+json;charset=UTF-8`. Rejeitada porque diverge do texto do PRD e dos
testes de aceite.

### D-07 — Propagação da opção para `toResponse` aninhados

Há três chamadas de `toResponse` que não recebem o `config` do app:

| Local | Situação | Decisão |
|---|---|---|
| `src/utils/middleware.ts:26` (`onResponse`) | Um handler que *retorna* (não lança) um `HTTPError` é renderizado aqui antes do `toResponse` de `src/h3.ts:99`. Sem a opção, o erro sai no formato padrão. | **Passar a opção** (ver abaixo). |
| `src/rules/cache.ts:314` (`toResponse` do ocache) | Mesmo caso para um handler com cache que retorna `HTTPError`. | **Passar a opção** (ver abaixo). |
| `src/handler.ts:122,124` (`.fetch` de handler avulso) | Não há app associado; já não recebe `debug` nem `onError`. | **Manter como está** e documentar. |

Para os dois primeiros, passar **só** a opção, não o config inteiro:

```ts
toResponse(rawBody, event, { problemDetails: event.app?.config.problemDetails });
```

Passar o config inteiro faria o `onResponse` do app rodar duas vezes: `toResponse` chama `config.onResponse`
(`src/response.ts:35-53`), e o `toResponse` de `src/h3.ts:99` também. `event.app` existe em `src/event.ts:40`
e é usado em `src/adapters.ts:116`.

### D-08 — `HTTPError.toJSON()` e formato padrão ficam intactos

`toJSON` (`src/error.ts:226-236`) não muda. O formato padrão sai do mesmo caminho de `errorResponse` (quando a
opção está desligada), então `test/errors.test.ts` continua verificando o comportamento antigo sem edição.

### D-09 — Opção imutável em runtime

O PRD diz que a opção não muda em tempo de execução. As entradas (`src/_entries/_common.ts:5`) congelam
`app.config` com `Object.freeze`, então a alteração em runtime já é impedida nas entradas oficiais. Nos testes
ela pode ser alterada antes da requisição, como `t.app.config.onError = undefined` em `test/errors.test.ts:14`.

## 3. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/types/h3.ts:28-53` | Adicionar `problemDetails?: boolean` a `H3Config`, com JSDoc como `debug` (`:29-32`). |
| `src/error.ts:30-69` | Adicionar `type?: string` e `instance?: string` a `ErrorBody`, com JSDoc (RFC 9457 §3.1.1 e §3.1.5). |
| `src/error.ts:74-119` | Declarar `readonly type: string \| undefined` e `readonly instance: string \| undefined` na classe. |
| `src/error.ts:162-210` | No construtor, após `this.body` (`:209`): ler `type` e `instance` só de entrada literal e só se `string` (D-03). |
| `src/response.ts:270-272` | Adicionar `problemHeaders` (`new FrozenHeaders({ "content-type": "application/problem+json" })`), ao lado de `jsonHeaders`. |
| `src/response.ts:358-380` | `errorResponse` recebe `config: H3Config`; escolhe headers e corpo conforme `config.problemDetails`. |
| `src/response.ts:172-173` | Trocar `errorResponse(error, config.debug, errHeaders)` por `errorResponse(error, config, errHeaders)`. |
| `src/response.ts` (novo, não exportado) | `toProblemDetails(error, debug)` (§4), perto de `errorResponse`. |
| `src/utils/middleware.ts:26` | `toResponse(rawBody, event, { problemDetails: event.app?.config.problemDetails })` (D-07). |
| `src/rules/cache.ts:314` | Mesmo ajuste de D-07. |
| `docs/1.guide/900.api/1.h3.md:111-113` | Incluir a opção `problemDetails` na lista de opções do app. |
| `docs/1.guide/1.basics/6.error.md:51-59` | Documentar `type` e `instance` nos campos do `HTTPError` e o formato problem details. |

Arquivos novos de teste: ver §5. Não há mudança em `src/index.ts`, porque nenhum tipo ou função novo é exportado
(`ErrorBody`, `ErrorInput` e `HTTPError` já são exportados em `src/index.ts:72`).

## 4. Contratos e assinaturas

### 4.1 Opção (`src/types/h3.ts`)

```ts
export interface H3Config {
  // ...campos existentes...

  /**
   * When enabled, errors are rendered as RFC 9457 problem details (`application/problem+json`).
   * Disabled by default; read from `app.config` on every error response.
   */
  problemDetails?: boolean;
}
```

### 4.2 Modelo de erro (`src/error.ts`)

```ts
export interface ErrorBody<DataT = unknown> {
  // ...campos existentes...

  /**
   * RFC 9457 `type`: URI reference that identifies the problem type.
   * Defaults to `"about:blank"` in problem details responses.
   */
  type?: string;

  /**
   * RFC 9457 `instance`: URI reference that identifies this occurrence of the problem.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // constructor: ver regra de D-03
}
```

Trecho do construtor (acrescentar após `this.body = ...`, `src/error.ts:209`):

```ts
const input = details && !(details instanceof Error) ? (details as ErrorBody) : undefined;
this.type = typeof input?.type === "string" ? input.type : undefined;
this.instance = typeof input?.instance === "string" ? input.instance : undefined;
```

`toJSON()` não muda.

### 4.3 Renderização (`src/response.ts`, interno)

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

/** RFC 9457 body. Reserved members win over `body` and `data`; `stack` only in debug. */
function toProblemDetails(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const hidden = error.unhandled;
  return {
    ...(hidden ? undefined : error.body),
    ...(hidden ? undefined : { data: error.data }),
    type: error.type ?? "about:blank",
    title: error.statusText,
    status: error.status,
    detail: hidden ? undefined : error.message,
    instance: error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const problem = config.problemDetails;
  const baseHeaders = problem ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers
    ? mergeHeaders(baseHeaders, error.headers)
    : new Headers(baseHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  const body = problem
    ? toProblemDetails(error, config.debug)
    : { ...error.toJSON(), stack: config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined };
  return new FastResponse(JSON.stringify(body, undefined, config.debug ? 2 : undefined), {
    status: error.status,
    statusText: error.statusText,
    headers,
  });
}
```

Observações sobre o trecho:
- Ao escrever o código, preservar a forma original de `errorResponse` (`src/response.ts:369-372`) no ramo padrão;
  o trecho acima é um esboço de contrato, não um diff final.
- `error.statusText` continua sendo o status text da resposta HTTP, como hoje. Com `title` vindo do mesmo campo,
  o texto não é sanitizado a mais: `statusText` já passa por `sanitizeStatusMessage` no construtor (`src/error.ts:180-185`).

### 4.4 Sem mudança de assinatura pública

`toResponse(val, event, config)` (`src/response.ts:13-17`) permanece igual. O `config` de `toResponse` já é a
fonte de `problemDetails` quando chega por `src/h3.ts:99`.

## 5. Estratégia de testes

Segue `AGENTS.md`: testes de integração com `describeMatrix` (web e node). O padrão de configuração por teste é
`t.app.config.X = ...`, como em `test/errors.test.ts:14`. A suíte base cria o app com `debug: true`
(`test/_setup.ts:135-141`), então testes de RF-07 precisam de `t.app.config.debug = false`.

### 5.1 `test/problem-details.test.ts` (novo, `describeMatrix`)

| Caso | Requisito |
|---|---|
| App novo sem a opção: `app.config.problemDetails` ausente ou falso | RF-01 |
| Opção desligada, `HTTPError` 404: mesmo status, `Content-Type` `application/json;charset=UTF-8` e mesmo corpo | RF-02 |
| Opção ligada, `HTTPError` 404 com `statusText` e `message`: `application/problem+json`, `title`, `detail`, `status` | RF-03 |
| Opção ligada, `HTTPError` 500 sem `type`: `type: "about:blank"` | RF-05 |
| Opção ligada, `throw new Error("falha inesperada")`: status 500 e `application/problem+json` | RF-06 |
| Opção ligada, `debug` desligado, erro não tratado com `"segredo interno"`: ausente do corpo, sem `stack` | RF-07 |
| Opção ligada, `HTTPError` 422 com `data` e `body`: `data` presente e membros de `body` no topo | RF-08 |
| Opção ligada, `debug` ligado: `stack` presente | D-05 |
| `body` com chave `status` ou `type` não sobrescreve os reservados | D-05 |
| `error.headers` (ex.: `x-error-own`) e `errHeaders` continuam na resposta | D-02 |
| `set-cookie` de `errHeaders` aparece uma vez (regressão de `src/response.ts:170-172`) | D-02 |
| HEAD: sem corpo e sem `content-length` | D-02 |
| `onError` roda antes da renderização e pode retornar `Response` que substitui o formato | D-02 |
| Handler que *retorna* `HTTPError` com `onResponse` middleware: formato problem details | D-07 |
| `kNotFound` (rota inexistente): problem details | D-02 |

### 5.2 `test/unit/error.test.ts` (novo, sem `describeMatrix`)

| Caso | Requisito |
|---|---|
| `new HTTPError({ status: 403, type, instance })`: `type` e `instance` na instância | RF-04 |
| Campos ausentes: `type` e `instance` `undefined` | RF-04 |
| Campo não-string (ex.: `type: 42`): ignorado | D-03 |
| `new HTTPError(new Error("x"))` com `error.type = "entity.parse.failed"`: `type` `undefined` | D-03 |
| `throw { type: "x" }` pelo `toError`: `type` `undefined` | D-03 |
| `toJSON()` não contém `type` nem `instance` (formato padrão intacto) | D-08 |

### 5.3 Testes existentes

Não editar `test/errors.test.ts`. Se algum teste existente falhar, a causa é regressão, não ajuste de expectativa.
O PRD aceita ajuste só com motivo claro no diff, mas o desenho acima não deve exigir isso.

### 5.4 Tipos

Opcional: uma verificação de tipo em `test/unit/types.test-d.ts` confirmando que `new H3({ problemDetails: true })`
compila e que `ErrorBody` aceita `type` e `instance`. Cobertura de `tsc --noEmit` (`package.json:54`) já valida
o restante.

### 5.5 Comandos de validação

```bash
pnpm vitest run test/problem-details.test.ts
pnpm vitest run test/unit/error.test.ts
pnpm vitest run test/errors.test.ts          # regressão do formato padrão
pnpm vitest run                              # suíte completa
pnpm lint                                    # oxlint + oxfmt --check (package.json:46)
pnpm typecheck                               # tsc --noEmit (package.json:54)
```

Seguindo `AGENTS.md` (Bug Fix Workflow), os testes de RF-02 (formato padrão) devem ser escritos e executados antes
das mudanças em `src/`, para confirmar que passam no código atual.

## 6. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Erros de terceiros com propriedade `type` (ex.: parsing de body) virarem a URI `type` da resposta. | Vazamento de valor não controlado; cliente recebe `type` inválido. | D-03: ler `type` e `instance` só de entrada literal e só se `string`; teste de regressão em §5.2. |
| R-02 | `title` ausente quando `statusText` não é informado. | Cliente sem texto curto para o erro. | D-04: RFC 9457 torna `title` opcional. Alternativa com tabela de status fica para decisão do revisor. |
| R-03 | Erro retornado (não lançado) dentro de `onResponse` middleware ou de handler com cache ficar no formato padrão. | Formato inconsistente. | D-07: passar a opção nos dois pontos e testar. |
| R-04 | `handler.ts:122,124` (`.fetch` de handler avulso) não aplicar a opção. | Formato inconsistente nesse caminho. | Documentar. O caminho não tem app, então não recebe `debug` nem `onError` hoje. |
| R-05 | Clientes que checam `application/json` deixarem de funcionar. | Quebra para quem liga a opção. | Opção desligada por padrão (PRD, Riscos). Documentar a mudança de `Content-Type` nas docs. |
| R-06 | `body` com chaves reservadas sobrescrever `status`, `type` etc. | Resposta incorreta. | D-05: reservados têm precedência; teste em §5.1. |
| R-07 | Opção alterada depois do primeiro erro ter sido renderizado. | Comportamento não previsível. | D-09: `app.config` congelado nas entradas; a opção é lida a cada resposta, então a mudança passa a valer no próximo erro. Documentar. |
| R-08 | `stack` em `debug` aumentar o vazamento se `debug` for ligado em produção. | Vazamento de stack. | Mesmo risco já existente para o formato padrão; o aviso de `debug` em `docs/1.guide/900.api/1.h3.md:117` continua válido. |
| R-09 | Custo de validação na matriz web e node. | Mais tempo de CI. | Testes focados em `describeMatrix`, sem multiplicar casos desnecessariamente. |
| R-10 | Lint e tipos (`isolatedDeclarations`, `erasableSyntaxOnly`) em código novo. | Falha de `pnpm lint` ou `pnpm typecheck`. | Helpers internos sem `export`; `FrozenHeaders` já existe no módulo. Rodar `pnpm lint` e `pnpm typecheck` antes de concluir. |

## 7. Itens em aberto

- Confirmar D-04 (`title` omitido sem `statusText`) ou trocar por tabela de textos padrão.
- Confirmar D-05 (`stack` em modo `debug` dentro do corpo problem details).
- Confirmar D-07 para `src/rules/cache.ts:314`: é um caminho de `h3/rules/cache`, opcional, e a mudança afeta esse módulo.
- Não foi executada a suíte nesta etapa: a tarefa é só especificação e nenhum código foi alterado.
