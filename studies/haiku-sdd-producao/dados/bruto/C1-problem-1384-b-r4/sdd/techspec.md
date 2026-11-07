# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Referências: `sdd/pedido.md` (contrato 1384-B), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1384.

Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `ac96d81`).

## 1. Resumo

Toda resposta de erro gerada pelo h3 passa a ter corpo `application/problem+json` com os membros `type`, `title`, `status`, `detail` e `instance`. O formato substitui o atual sem opção de configuração. A API de programação de `HTTPError` ganha apenas os campos `type` e `instance` na entrada e na instância. Nenhum outro nome público é criado.

A montagem do corpo fica concentrada em dois pontos já existentes:

- `HTTPError.toJSON()` em `src/error.ts:226` passa a devolver os membros da RFC.
- `errorResponse()` em `src/response.ts:358` passa a usar o media type `application/problem+json`.

Não há mudança no caminho de `toResponse`/`prepareResponse`, nos hooks `onError`/`onResponse`, nem no JSON-RPC (`src/utils/json-rpc.ts`), que segue o próprio protocolo.

## 2. Decisões de arquitetura

### D-01 — Formato novo substitui o atual, sem opção de configuração

**Contexto.** O pedido proíbe novos nomes públicos e exige que o formato novo seja o padrão. O PRD (Fora de escopo) veta a opção de alternância.

**Alternativas consideradas.**
1. Opção `H3Config.errorFormat: "problem" | "legacy"`. Rejeitada: cria nome público de configuração, proibido pelo pedido.
2. Formato novo e antigo juntos (campos legados mantidos ao lado dos da RFC). Rejeitada: o pedido diz que o novo formato *substitui*, e a RFC permite extensões mas não duplicação de `status`/`detail`.
3. Substituição direta (escolhida), com `toJSON()` devolvendo o formato novo.

**Escolha.** Opção 3. O `toJSON()` passa a ser a fonte única do corpo, pois `errorResponse()` já o usa (`src/response.ts:368`). Quem chama `JSON.stringify(error)` também recebe o formato novo; isso é aceito como parte da mudança incompatível (ver Riscos).

### D-02 — Media type `application/problem+json`, sem `charset`

**Alternativas.** (a) Reusar `jsonHeaders` (`src/response.ts:270-272`, com `charset=UTF-8`). (b) Constante nova `problemHeaders` com `application/problem+json`.

**Escolha.** (b). A RFC 9457 define o media type sem parâmetro de charset (JSON é sempre UTF-8). O PRD (RF-02) pede a string exata. A constante segue o mesmo padrão de `FrozenHeaders` usado em `jsonHeaders`, para que `mergeHeaders` continue criando uma cópia e não mutando a constante. Respostas de sucesso continuam com `jsonHeaders`.

### D-03 — Mapeamento de campos e `title` com fallback em tabela interna

**Mapeamento.**

| Membro RFC | Origem                                                                             |
| ---------- | ---------------------------------------------------------------------------------- |
| `type`     | `error.type` (padrão `"about:blank"`)                                              |
| `title`    | `error.statusText`; se ausente, frase padrão do status (tabela interna, ver abaixo) |
| `status`   | `error.status`                                                                     |
| `detail`   | `error.message`                                                                    |
| `instance` | `error.instance` (omitido quando `undefined`)                                      |

**Conflito com o PRD.** A premissa do PRD diz que, sem `statusText`, `title` fica ausente, porque o h3 não tem tabela de frases. Mas RF-05 exige `title` no erro não tratado `new Error(...)`, que é criado como `new HTTPError({ status: 500, unhandled: true })` (`src/response.ts:80`) e não tem `statusText`. RF-07 (404 de rota inexistente, `src/response.ts:140`) também não tem `statusText`. Os dois casos ficam sem `title` com a premissa original.

**Alternativas.**
1. Manter a premissa: `title` ausente quando não há `statusText`. Viola RF-05.
2. Definir `statusText` padrão no construtor. Muda o comportamento de `statusText` na API pública (RF-08), o que é pior.
3. Tabela interna pequena de frases padrão, consultada só quando `statusText` está vazio (escolhida).

**Escolha.** Opção 3. Arquivo novo `src/utils/internal/status.ts`, com um `Record<number, string>` não exportado publicamente (só em `internal/`) cobrindo os códigos que o próprio h3 produz: 400, 401, 403, 404, 405, 413, 415, 500, 502, 503, 504. Código fora da tabela deixa `title` ausente, o que a RFC permite (`title` é opcional). **Precisa de confirmação do solicitante**, porque contraria a premissa escrita no PRD.

### D-04 — Membros da RFC têm precedência sobre o `body` de extensão

**Contexto.** Hoje `toJSON()` coloca `...this.body` por último (`src/error.ts:234`), então `body: { status: 200 }` sobrescreve o status no corpo. Com a RFC, isso deixaria o corpo de erro contradizer o status HTTP.

**Escolha.** O objeto final é montado com `...body` primeiro e os membros RFC depois, então `type`, `title`, `status`, `detail` e `instance` não podem ser sobrescritos por `body`. `data` e `stack` também vêm depois. Isso é uma mudança de comportamento intencional e está coberta por teste (ver seção 6). Os demais pares de `body` continuam no topo, como RF-04 exige.

### D-05 — Campos legados saem do topo do corpo

`message`, `statusText` e `unhandled` deixam de aparecer no topo (PRD, premissas). Alternativa considerada: manter `unhandled: true` como membro de extensão, por ser um sinal que clientes podem usar. Não foi adotada porque o PRD define o corpo como formato limpo da RFC. Se o solicitante quiser manter `unhandled`, a mudança é um único campo em `toJSON()` (`src/error.ts:226`).

### D-06 — Mascaramento de erros não tratados

Quando `error.unhandled` é verdadeiro:

- `type` é sempre `"about:blank"`, e `instance` é omitido;
- `detail` é o literal atual `"HTTPError"` (`src/error.ts:232`). É genérico e mantém os testes que já verificam esse valor (`test/errors.test.ts:350`);
- `data` e `body` não aparecem;
- `title` vem de `statusText` ou da tabela (para 500: "Internal Server Error").

`stack` só aparece com `debug` (`src/response.ts:369`), como hoje.

### D-07 — `type` e `instance` são lidos somente de `details`, nunca de `cause`

`status`, `statusText` e `headers` leem também de `details.cause` (`src/error.ts:172-202`). Para `type` e `instance` a leitura de `cause` é proibida. Exemplo: `proxy.ts:380` cria `new HTTPError({ ..., cause: error })`, e `error` pode ser de outro serviço com seu próprio `type`/`instance`. Ler de `cause` vazaria esses valores para o cliente final.

### D-08 — `instance` não é preenchido automaticamente

Conforme o PRD (fora de escopo), `instance` só vem do que o app informa. `type` padrão é `"about:blank"`. Nenhum catálogo de tipos do h3 é criado.

### D-09 — Erros de validação não mudam de código

`createValidationError()` (`src/utils/internal/validate.ts:217-230`) já define `status`, `statusText: "Validation failed"` (`VALIDATION_FAILED`, linha 19) e `message`. Com D-03, `title` vem de `statusText` e `detail` de `message`. `data.issues` continua em `data`. Nenhuma alteração no arquivo.

### D-10 — JSON-RPC e hooks ficam como estão

`src/utils/json-rpc.ts:479-490` monta o erro do protocolo JSON-RPC, não o corpo HTTP. Não muda. `onError` (`src/utils/middleware.ts:37-60`) e o `onError` do app (`src/response.ts:159-166`) recebem a instância `HTTPError` e podem devolver resposta própria, que não passa por `errorResponse()`.

## 3. Arquivos a alterar

### 3.1 `src/error.ts`

- `src/error.ts:6` — `ErrorInput`: adicionar `type?: string` e `instance?: string`, com JSDoc citando RFC 9457. Ficam fora de `ErrorBody` (`src/error.ts:30`) para não tornar campos obrigatórios em um tipo exportado.
- `src/error.ts:74` — classe `HTTPError`: declarar `readonly type: string` e `readonly instance: string | undefined`, junto de `data` (`src/error.ts:107`) e `body` (`src/error.ts:112`).
- `src/error.ts:199-209` — construtor: atribuir
  `this.type = (details as ErrorInput)?.type || "about:blank";`
  `this.instance = (details as ErrorInput)?.instance;`
  (sem leitura de `cause`, D-07).
- `src/error.ts:226-236` — `toJSON()`: nova forma, conforme D-03, D-04 e D-06 (ver 4.1).

### 3.2 `src/response.ts`

- `src/response.ts:270-272` — adicionar `problemHeaders` (`FrozenHeaders`, `application/problem+json`), ao lado de `jsonHeaders`.
- `src/response.ts:358-380` — `errorResponse()`: trocar `jsonHeaders` por `problemHeaders` em `src/response.ts:360`; `stack` continua somente com `debug` em `src/response.ts:369`.

### 3.3 `src/utils/internal/status.ts` (novo)

- Tabela `kReasonPhrases` e função `reasonPhrase(status: number): string | undefined`, usada só por `toJSON()`. Arquivo pequeno, dentro de `utils/internal/` (convenção do AGENTS.md).

### 3.4 `src/index.ts`

- `src/index.ts:72` — sem alteração. Nenhum símbolo novo é exportado.

### 3.5 Testes existentes que mudam (adaptação mínima, RF-10)

| Arquivo:linha                | O que verifica hoje                             | Ajuste                                                                                         |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `test/errors.test.ts:44`     | `content-type` `application/json;charset=UTF-8` | `application/problem+json`                                                                     |
| `test/errors.test.ts:140`    | `toMatch("application/json")`                   | `toMatch("application/problem+json")`                                                          |
| `test/errors.test.ts:146-150`| corpo com `statusText` e `data`                 | `title` no lugar de `statusText`; `data` mantido                                              |
| `test/errors.test.ts:257`    | corpo de não tratado com `unhandled: true`      | `status: 500`, `detail` genérico; `unhandled` não é mais verificado no corpo                  |
| `test/errors.test.ts:309`    | idem                                            | idem                                                                                           |
| `test/errors.test.ts:350`    | `{ unhandled: true, message: "HTTPError" }`     | `{ status: 500, detail: "HTTPError" }`; o `t.errors[0].unhandled` (`:351`) continua igual      |
| `test/errors.test.ts:384`    | `unhandled: true` no corpo                      | `status: 500`                                                                                  |
| `test/errors.test.ts:420`    | idem                                            | idem                                                                                           |
| `test/errors.test.ts:442`    | idem                                            | idem                                                                                           |
| `test/app.test.ts:205`       | `.statusText` no corpo                          | `.title`                                                                                       |
| `test/body.test.ts:457`      | `resultJson.statusText`                         | `resultJson.title`; `stack[0]` (`:458`) inalterado                                             |
| `test/iterable.test.ts:145`  | `.message` no corpo                             | `.detail`                                                                                      |
| `test/dist.test.ts:57`       | `.message` no corpo                             | `.detail`                                                                                      |
| `test/rules/cache.test.ts:251` | `.message` no corpo                           | `.detail`                                                                                      |
| `test/handler.test.ts:222,238,272` | `statusText`/`message` no corpo de validação | `title`/`detail`; `data.issues` inalterado                                               |
| `test/route.test.ts:72`      | `statusText` no corpo de validação              | `title`                                                                                        |

Antes de editar, rodar `grep` por `\.json()` e `text()` seguido de `statusText`/`message`/`unhandled` em `test/` para confirmar que a lista está completa. Os itens acima foram lidos no código; testes que só checam `res.statusText` (ex.: `test/errors.test.ts:43`, `test/mount.test.ts:294`) não mudam, pois o status line não é alterado.

### 3.6 Documentação

- `docs/1.guide/1.basics/6.error.md:43-44` — exemplo de corpo JSON: trocar pelo formato novo.
- `docs/1.guide/1.basics/6.error.md:54,60,76` — descrever `type`, `instance` e a troca de `message` por `detail`.
- `docs/1.guide/1.basics/6.error.md:90` — campos ocultos em erros não tratados passam a ser `type`/`instance`/`data`/`body`/`detail`.

Não há entrada de `CHANGELOG.md` nesta mudança; a release (`changelogen`) gera. Recomenda-se marcar a quebra como *breaking change* no release.

## 4. Contratos e assinaturas

### 4.1 `HTTPError.toJSON()` (`src/error.ts:226`)

```ts
toJSON(): {
  type: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  data?: DataT;
  [extension: string]: unknown;
}
```

Regras de montagem (ordem de chaves é a de inserção):

```ts
const unhandled = this.unhandled;
return {
  ...(unhandled ? undefined : this.body),          // D-04: extensões primeiro
  type: unhandled ? "about:blank" : this.type,
  title: this.statusText || reasonPhrase(this.status),
  status: this.status,
  detail: unhandled ? "HTTPError" : this.message,
  instance: unhandled ? undefined : this.instance,
  data: unhandled ? undefined : this.data,
};
```

Observações:

- `...undefined` em objeto literal é válido em JS e não adiciona chaves. `JSON.stringify` omite chaves com `undefined`, então `title` e `instance` ausentes não aparecem no corpo.
- Para `unhandled`, `body` não é espalhado (mascaramento de RF-05, o mesmo que hoje em `src/error.ts:234`).
- Tipo de retorno escrito inline, sem nome novo exportado. Necessário por causa de `isolatedDeclarations` (`tsconfig.json`).

### 4.2 `ErrorInput` (`src/error.ts:6`)

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...campos existentes...

  /**
   * URI reference that identifies the problem type (RFC 9457). Defaults to `"about:blank"`.
   */
  type?: string;

  /**
   * URI reference that identifies this occurrence of the problem (RFC 9457). Omitted when not set.
   */
  instance?: string;
}
```

### 4.3 `HTTPError` (`src/error.ts:74`)

```ts
/** Problem type (RFC 9457). `"about:blank"` when not informed. */
readonly type: string;

/** Problem instance (RFC 9457). `undefined` when not informed. */
readonly instance: string | undefined;
```

Assinaturas inalteradas: `constructor(message, details?)`, `constructor(details)`, `static status(...)`, `static isError(...)`, `statusCode`, `statusMessage`, `status`, `statusText`, `headers`, `cause`, `data`, `body`, `unhandled` (RF-08).

### 4.4 `reasonPhrase` (`src/utils/internal/status.ts`, novo)

```ts
/** Standard reason phrase for the statuses h3 produces, or `undefined` for others. */
export function reasonPhrase(status: number): string | undefined;
```

### 4.5 `errorResponse` (`src/response.ts:358`)

Assinatura inalterada. Muda o media type (`problemHeaders`) e o corpo (vem de `toJSON()`).

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
```

## 5. Exemplos de corpo esperado

Erro de handler (`HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`):

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Usuário não encontrado"
}
```

Erro com extensões (`data` e `body`), status 422:

```json
{
  "type": "about:blank",
  "title": "Unprocessable",
  "status": 422,
  "detail": "Inválido",
  "data": { "campo": "email" },
  "codigo": "E_EMAIL"
}
```

Erro não tratado (`new Error("senha do banco: 123")`), sem `debug`:

```json
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "HTTPError"
}
```

Com `debug: true`, acrescenta `"stack": ["...", "..."]`.

## 6. Estratégia de testes

Seguir o fluxo de correção de bug do AGENTS.md: primeiro os testes novos, rodando e vendo falhar; depois a implementação; depois a suíte completa.

**Arquivo novo:** `test/problem-details.test.ts`, com `describeMatrix` para rodar em `web` e `node` (`test/_setup.ts`). Mantém cada arquivo curto (convenção de < 200 LoC).

Casos mapeados para os requisitos:

| Requisito | Casos                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| RF-01     | 404 com `message` e `statusText`: `status`, `title`, `detail`, `type: "about:blank"`; `instance` ausente do corpo.                       |
| RF-02     | Erro 400 → `content-type` exato `application/problem+json`; rota que retorna objeto 200 → `application/json;charset=UTF-8` (inalterado). |
| RF-03     | Unit: `new HTTPError({ status: 403, type, instance })` expõe os valores; `new HTTPError({ status: 403 })` → `type === "about:blank"`, `instance === undefined`; `type`/`instance` de `cause` são ignorados (D-07). |
| RF-04     | `data` e `body` no topo; `body: { status: 200 }` não sobrescreve o status (D-04).                                                       |
| RF-05     | `new Error("senha do banco: 123")` → 500, `title: "Internal Server Error"`, `detail: "HTTPError"`; string `"senha do banco"` não aparece no corpo nem com `data`/`body` definidos num `HTTPError` com `unhandled: true`. |
| RF-06     | Sem `debug`: sem `stack`. Com `debug: true`: `stack` é array de strings.                                                                |
| RF-07     | `GET /inexistente` → 404, `application/problem+json`, `status: 404`. Também: `throw new HTTPError({ status: 400 })` de validação de body (`src/utils/body.ts:225`) e `405` de `src/utils/static.ts:121`. |
| RF-08     | Suíte existente de `HTTPError` (`test/errors.test.ts`, `test/unit/`) continua passando sem mudança de assinatura; `HTTPError.isError` continua `true`. |
| RF-09     | `new HTTPError({ status: 401, headers: { "WWW-Authenticate": "Basic" } })` → header presente e `application/problem+json`.             |

Casos extras de risco (não estão no PRD, mas cobrem D-03, D-04, D-06 e D-09):

- Tabela de frases: 500 sem `statusText` → `title` da tabela; status fora da tabela sem `statusText` → `title` ausente, sem erro.
- `statusText` vazio (`""`) cai no fallback da tabela.
- Erro de validação (`validate.ts:217`) mantém `title: "Validation failed"` e `data.issues`.
- `onError` do app que devolve `Response` própria não é afetado.
- `errHeaders` com `set-cookie` continua aparecendo uma vez (regressão de `src/response.ts:167-173`).
- Requisição `HEAD` a rota inexistente continua sem corpo (`test/errors.test.ts:17-24`).

Ajustes nos testes existentes conforme seção 3.5. Cada ajuste mantém a verificação original (status, mensagem, mascaramento, debug), só trocando nomes de campo ou media type.

**Comandos de verificação:**
1. `pnpm vitest run test/problem-details.test.ts` (deve falhar antes da implementação)
2. `pnpm vitest run test/errors.test.ts test/body.test.ts test/app.test.ts test/handler.test.ts`
3. `pnpm lint` (oxlint + oxfmt --check)
4. `pnpm typecheck` (`tsc --noEmit`, valida `isolatedDeclarations` no `toJSON()`)
5. `pnpm test` (lint + typecheck + cobertura completa)
6. `pnpm build` — checar que `h3.d.mts` não ganhou tipos não exportados referenciados.

## 7. Riscos

1. **Quebra para clientes (alto).** Quem lê `message`, `statusText`, `unhandled` ou compara `Content-Type` com `application/json` quebra. Mitigação: marcar como *breaking change* na release; documentar em `docs/1.guide/1.basics/6.error.md`.
2. **Conflito no pedido (alto, precisa de decisão).** "Não quebrar o que já existe" e "o novo formato substitui o atual" são contraditórios no corpo. A leitura do PRD (quebra só no corpo e no `Content-Type` das respostas de erro, API de `HTTPError` preservada) é a adotada aqui. Confirmar antes de implementar.
3. **`title` ausente (médio, precisa de decisão).** Premissa do PRD contradiz RF-05. Solução proposta em D-03 (tabela interna). Se o solicitante preferir a premissa original, RF-05 deve ser ajustado.
4. **Vazamento em erros não tratados (alto).** Mudar a montagem do corpo pode expor `data`, `body` ou `instance`. Mitigação: D-06 e teste explícito de RF-05 com `data`/`body` preenchidos.
5. **Colisão de chaves do `body` (médio).** Antes, `body` sobrescrevia `status`. Agora os membros RFC vencem (D-04). Quem dependia disso quebra. Caso raro, mas é mudança de comportamento e precisa estar no changelog.
6. **`toJSON()` com formato novo (baixo a médio).** Quem serializa `HTTPError` com `JSON.stringify` recebe o formato novo. Aceito como parte da troca; citar na release.
7. **Cabeçalhos do usuário (baixo).** `mergeHeaders(problemHeaders, error.headers)` deixa um `content-type` definido pelo app sobrescrever o media type. Hoje acontece com `jsonHeaders` da mesma forma; não é regressão, mas vale um teste.
8. **Tabela de frases incompleta (baixo).** Códigos fora da tabela ficam sem `title`. Aceitável pela RFC, mas diferente de RF-05 se o código for 500 e a tabela for alterada no futuro. Teste cobre 500.
9. **Dependências (nenhum).** Nenhuma biblioteca externa. Mudança restrita a `src/error.ts`, `src/response.ts`, um arquivo interno novo e os testes/docs listados.
10. **Pedidos fora de escopo que ficaram de fora (informativo).** `instance` automático, catálogo de `type`, i18n e integração com Nitro não estão nesta especificação, conforme o PRD.
