# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (contrato #1384-A), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1384.

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `5090ee6`).

---

## 1. Resumo

Uma opção booleana `problemDetails` em `H3Config` (padrão `false`) faz o renderizador de erros do h3 emitir o corpo RFC 9457 com `Content-Type: application/problem+json`. Com a opção desligada, o caminho de código atual não é alterado. `HTTPError` passa a aceitar e expor `type` e `instance`. Não há método público novo, não há nome público novo além dos já previstos e o formato de `toJSON()` não muda.

A mudança fica concentrada em três arquivos de produção: `src/types/h3.ts`, `src/error.ts` e `src/response.ts`. Os chamadores de `toResponse` que hoje não passam `config` não precisam de alteração, porque a opção é resolvida a partir de `event.app` (ver D-02).

---

## 2. Decisões de arquitetura

### D-01 — Opção `problemDetails` em `H3Config`, lida na hora de renderizar

**Decisão.** Adicionar `problemDetails?: boolean` em `H3Config`, logo após `silent`. O valor é lido a cada requisição em `prepareResponse`, como `debug` e `silent` já são.

**Alternativas consideradas.**
- *Flag por rota ou por grupo de rotas.* Fora de escopo (PRD, "Fora do objetivo" e "Opção por rota").
- *Novo parâmetro em `toResponse`.* Mudaria a assinatura pública de `toResponse` (exportada em `src/index.ts:68`). Descartado.
- *Ler a flag de `event.res` ou de `event.context`.* Exigiria que cada middleware a propagasse. Descartado.

**Justificativa.** Segue o padrão já usado por `debug` e `silent`: uma opção global lida de `app.config`. Como `config.problemDetails` é lido em tempo de render, alterar `app.config.problemDetails` em testes funciona da mesma forma que `t.app.config.onError` já funciona (`test/errors.test.ts:14`).

### D-02 — Resolver a opção no renderizador, com fallback para `event.app`

**Problema.** Alguns caminhos chamam `toResponse` sem `config`:
- `src/utils/middleware.ts:26` (`onResponse`): `toResponse(rawBody, event)`.
- `src/handler.ts:122` e `src/handler.ts:124` (`handler.fetch`): `toResponse(..., event)`.
- `src/rules/cache.ts:314`: chamada interna sem config. Também há chamadas do próprio usuário sem config, como o exemplo de `src/utils/cache.ts:107`.

Sem tratamento, uma `HTTPError` renderizada por esses caminhos sairia no formato antigo, violando RF-08.

**Alternativas consideradas.**
- *(a) Passar `{ problemDetails: event.app?.config.problemDetails }` em cada chamador.* Espalha a lógica em quatro ou mais arquivos e não cobre chamadas feitas pelo usuário.
- *(b) Fazer `toResponse` ler `event.app?.config` inteiro quando `config` não é passado.* Muda também `debug` e `silent` nesses caminhos, o que quebra RF-02 ("sem a opção, nada muda").
- *(c) Fallback central, somente para `problemDetails`, em `prepareResponse`.* Escolhida.

**Escolha (c).** Em `src/response.ts`, dentro de `prepareResponse`, resolver:

```ts
const problemDetails = config.problemDetails ?? event.app?.config.problemDetails;
```

`H3Event.app` é preenchido por `H3Core["~request"]` (`src/event.ts:95`, `src/h3.ts:75`), então qualquer evento despachado por um app já carrega a configuração. `??` preserva `false` explícito. `debug` e `silent` continuam vindo somente de `config`, como hoje.

**Justificativa.** Uma única linha cobre `onResponse`, `onError`, cache e chamadores do usuário, e nenhum comportamento muda quando a opção está desligada. A limitação do `handler.fetch` sem app é tratada em "Pendências" (P-02).

### D-03 — `type` e `instance` em `ErrorInput` e `HTTPError`, fora de `ErrorBody`

**Decisão.** Declarar `type?: string` e `instance?: string` diretamente em `ErrorInput` (`src/error.ts:6`) e como propriedades `readonly` em `HTTPError` (`src/error.ts:74`). Não adicioná-los a `ErrorBody` (`src/error.ts:30`).

**Alternativas consideradas.**
- *Adicionar em `ErrorBody`.* `HTTPError` implementa `ErrorBody` e `toJSON()` é tipado como `Omit<ErrorBody, "body"> & ErrorBody["body"]` (`src/error.ts:226`). Os campos entrariam no tipo do `toJSON()`, e o tipo mentiria sobre o runtime porque `toJSON()` não os emite. Descartado.

**Justificativa.** `toJSON()` continua emitindo exatamente o que emite hoje, o que garante RF-02 (corpo idêntico com a opção desligada). `ErrorInput` herda os demais campos de `Partial<ErrorBody>`, então só precisa dos dois novos campos explícitos.

### D-04 — Montagem do corpo RFC 9457 em função interna de `response.ts`

**Decisão.** Criar `problemDetailsBody(error, debug)` como função não exportada em `src/response.ts`, junto de `errorResponse` (`src/response.ts:358`). `HTTPError` não ganha método novo.

**Alternativas consideradas.**
- *`HTTPError.prototype.toProblemJSON()`.* Adiciona um nome público novo. A restrição "Nenhum outro nome público novo" (`sdd/pedido.md`, Restrições) proíbe.
- *Método em `src/error.ts` sem export.* Não é alcançável pelo renderizador sem export, o que obrigaria a exportar um símbolo interno.

**Justificativa.** A montagem é um detalhe de renderização, junto de `errorResponse` e de `prepareResponseBody`, que já moram em `response.ts`. Nada novo entra na API.

### D-05 — Precedência de membros e mascaramento de erros `unhandled`

**Decisão.**
1. Os campos de `error.body` são espalhados primeiro. Depois vêm os membros reservados: `type`, `title`, `status`, `detail`, `instance`, `data` e `stack`. Assim, uma chave de `body` com nome reservado é sobrescrita e nunca altera um membro da RFC (RF-07, risco "Colisão de extensões").
2. Para erros `unhandled`, o corpo contém somente `type: "about:blank"`, `title` (quando definido) e `status`. `detail`, `instance`, `data`, `body` e `stack` (fora de debug) não aparecem. `type` é forçado para `about:blank` porque um `Error` comum pode carregar uma propriedade `type` arbitrária, que `new HTTPError(val)` copiaria (ver `src/response.ts:148`).

**Alternativas consideradas.**
- *Body vence os membros (ordem atual de `toJSON`, `src/error.ts:234`).* Permitiria `body: { status: 200 }` em erro 500. Descartado.
- *Mascarar só `detail` em erros `unhandled`.* Deixaria vazar `type`/`instance` arbitrários de um `Error` comum. Descartado.

### D-06 — Media type sem `charset`, headers do `HTTPError` continuam sobrescrevendo

**Decisão.** Usar `application/problem+json` exato (sem `charset`, PRD "Premissas"). A base de headers passa a ser um `FrozenHeaders` análogo a `jsonHeaders` (`src/response.ts:270`). `error.headers` continua sendo mesclado por cima, como hoje (`src/response.ts:359-361`). `errHeaders` do `event.res` também continua sendo aplicado depois.

**Justificativa.** Mantém o comportamento atual de headers e cumpre RF-03 e RF-09. Se o usuário definir `content-type` em `HTTPError.headers`, o valor dele vence, como já acontece no modo antigo.

### D-07 — Testes ativam a opção por `t.app.config`, sem mudar `_setup.ts`

**Decisão.** Os novos testes ligam `t.app.config.problemDetails = true` e desligam `t.app.config.debug = false` quando necessário. O padrão já existe em `test/errors.test.ts:14`.

**Alternativa.** Adicionar `problemDetails` a `TestOptions` em `test/_setup.ts`. Descartada, porque o padrão existente resolve sem tocar na infraestrutura, e `_setup.ts` cria o app com `debug: true` em todos os testes (`test/_setup.ts:136`), o que exige desligar debug de qualquer forma.

---

## 3. Divergências entre PRD e código

Estes pontos precisam de decisão antes da implementação. Os detalhes estão em "Pendências".

1. **RF-06 diz que, em `debug`, `message` e `data` de erros `unhandled` aparecem.** O código atual não faz isso. `HTTPError.toJSON()` oculta `message` e `data` de `unhandled` sempre (`src/error.ts:232-233`). `debug` só adiciona `stack` (`src/response.ts:369`). A especificação segue o código (ver P-01).
2. **O PRD afirma que a opção chega ao renderizador "pela mesma configuração que hoje alimenta toResponse".** Isso não vale para `src/utils/middleware.ts:26` nem para `src/handler.ts:122,124`. D-02 resolve esse ponto para a opção, sem depender de `config` ser passado.
3. **RF-08 pede que "erros de handlers chamados diretamente" também usem o formato.** `handler.fetch` (`src/handler.ts:113-126`) cria o `H3Event` sem `app` (`src/handler.ts:120`), então não há configuração de app para ler. Ver P-02.

---

## 4. Arquivos a alterar

| Arquivo | Mudança | Referências no código atual |
|---|---|---|
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` com JSDoc, após `silent`. `H3CoreConfig` herda o campo. | `src/types/h3.ts:28` (início de `H3Config`), `:34-37` (`silent`), `:55` (`H3CoreConfig`) |
| `src/error.ts` | Adicionar `type?` e `instance?` em `ErrorInput`. Adicionar `readonly type` e `readonly instance` em `HTTPError`. Atribuir no construtor. **Não** alterar `ErrorBody` nem `toJSON()`. | `src/error.ts:6` (`ErrorInput`), `:26` (fim), `:74` (`HTTPError`), `:112` (`body`, após o qual entram os novos campos), `:208-209` (atribuições de `data` e `body`, onde entram as novas), `:226-236` (`toJSON`, sem mudança) |
| `src/response.ts` | Em `prepareResponse`, resolver `problemDetails` e passar ao `errorResponse`. Em `errorResponse`, escolher base de headers e corpo. Criar `problemDetailsBody` e `problemJsonHeaders`. | `src/response.ts:129` (`prepareResponse`), `:173` (chamada de `errorResponse`), `:260-264` (`FrozenHeaders`), `:270-272` (`jsonHeaders`, modelo para o novo), `:358-380` (`errorResponse`), `:368-369` (`toJSON` e `stack` no corpo atual) |
| `test/errors.test.ts` | Novo `describe` para `type`/`instance` em `HTTPError` (RF-05). Os testes existentes não mudam. | `test/errors.test.ts:6` (`describeMatrix`), `:14` (padrão de mutar `t.app.config`), `:44` e `:140` (asserções de `application/json` que devem continuar válidas) |
| `test/problem-details.test.ts` (novo) | Casos RF-01 a RF-09, em `describeMatrix`, com `t.app.config.problemDetails = true`. | `test/_setup.ts:11` (`describeMatrix`), `:135-141` (app criado com `debug: true`) |
| `test/unit/types.test-d.ts` | `expectTypeOf` para `H3Config["problemDetails"]`, `HTTPError["type"]` e `HTTPError["instance"]`. | Hoje o arquivo (`:1-543`) não tem asserções para `H3Config` nem `HTTPError`. |

**Sem alteração:**
- `src/h3.ts:99` já passa `this.config` a `toResponse`. Nada muda.
- `src/handler.ts:122,124` e `src/utils/middleware.ts:26` não mudam. Com D-02, `event.app` cobre os casos que têm app.
- `src/event.ts` não muda. `app` já existe (`src/event.ts:40`).
- `src/index.ts` não muda. Não há export novo. `ErrorInput` e `HTTPError` já são exportados (`src/index.ts:72`).
- `AGENTS.md` pode receber uma linha em "Response Handling" ou em "Key Classes" se o time quiser documentar a opção. Não é obrigatório.

---

## 5. Contratos e assinaturas

### 5.1 Configuração

```ts
// src/types/h3.ts
export interface H3Config {
  /**
   * When enabled, error responses use the RFC 9457 problem details format
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
  // ...
}
```

### 5.2 `HTTPError`

```ts
// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  /** RFC 9457 `type` URI reference. Passed through as is, without validation. */
  type?: string;
  /** RFC 9457 `instance` URI reference. Passed through as is. */
  instance?: string;
  // ...
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** RFC 9457 `type`, or `undefined` when not set. */
  readonly type: string | undefined;
  /** RFC 9457 `instance`, or `undefined` when not set. */
  readonly instance: string | undefined;
  // ...
}
```

Atribuição no construtor, após `this.body`, seguindo o padrão de `headers` e `unhandled` (que também consultam `cause`):

```ts
this.type = (details as ErrorInput)?.type || (details?.cause as ErrorInput)?.type || undefined;
this.instance =
  (details as ErrorInput)?.instance || (details?.cause as ErrorInput)?.instance || undefined;
```

### 5.3 Renderização (interno a `src/response.ts`)

```ts
// Resolvido em prepareResponse (D-02)
const problemDetails = config.problemDetails ?? event.app?.config.problemDetails;
val = errorResponse(error, config.debug, errHeaders, problemDetails);

// Assinatura nova (somente um chamador)
function errorResponse(
  error: HTTPError,
  debug?: boolean,
  errHeaders?: Headers,
  problemDetails?: boolean,
): Response;

// Novo, não exportado
function problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Referência de implementação para `problemDetailsBody` (D-05):

```ts
function problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : error.body),
    type: (!unhandled && error.type) || "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance: unhandled ? undefined : error.instance,
    data: unhandled ? undefined : error.data,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

Em `errorResponse`, a base de headers e o corpo passam a depender de `problemDetails`:

```ts
const problemJsonHeaders = new FrozenHeaders({ "content-type": "application/problem+json" });

// base:  problemDetails ? problemJsonHeaders : jsonHeaders
// corpo: problemDetails ? problemDetailsBody(error, debug) : { ...error.toJSON(), stack: ... }
```

`JSON.stringify` continua usando `debug ? 2 : undefined` para indentação, e `status`, `statusText` e `errHeaders` não mudam.

### 5.4 Formato de resposta

Com `problemDetails: false`: igual ao atual. Corpo de `toJSON()`, `Content-Type: application/json;charset=UTF-8`.

Com `problemDetails: true`:

| Caso | Status | Content-Type | Corpo |
|---|---|---|---|
| `HTTPError` 404, `statusText: "Not Found"`, `message: "Usuário não existe"` | 404 | `application/problem+json` | `{"type":"about:blank","title":"Not Found","status":404,"detail":"Usuário não existe"}` |
| `HTTPError` 400, `body: {campo:"email"}`, `data: {tentativas:2}` | 400 | `application/problem+json` | `{"campo":"email","type":"about:blank","status":400,"detail":"Campo inválido","data":{"tentativas":2}}` (ordem de chaves não é contrato) |
| `Error` comum com `"segredo do banco"` | 500 | `application/problem+json` | `{"type":"about:blank","title":"Internal Server Error","status":500}` (sem `stack` fora de debug) |
| `HTTPError` 503 com `headers: {"retry-after":"30"}` | 503 | `application/problem+json` | corpo RFC; header `retry-after: 30` preservado |

Observação: `title` para erro `unhandled` vem de `statusText`, como no `toJSON()` atual (`src/error.ts:230`). Se o `Error` comum não tiver `statusText`, `title` fica ausente.

---

## 6. Estratégia de testes

Seguir o AGENTS.md ("Bug Fix Workflow" adaptado a feature): escrever os testes primeiro, rodar e confirmar a falha pelo motivo certo, depois implementar.

### 6.1 Casos (IDs usados nos riscos e pendências)

| ID | Cobre | Arquivo | Descrição |
|---|---|---|---|
| T-01 | RF-01 | `test/problem-details.test.ts` | `app.config.problemDetails` é `false` por padrão e `true` quando definido na construção. |
| T-02 | RF-02 | `test/problem-details.test.ts` | Com a opção desligada, `HTTPError` 404 retorna `application/json;charset=UTF-8`, corpo igual a `toJSON()` e sem chaves `type` nem `instance`. |
| T-03 | RF-03 | `test/problem-details.test.ts` | Com a opção ligada, 422 retorna `application/problem+json` sem `charset`. |
| T-04 | RF-04 | `test/problem-details.test.ts` | Corpo exato do exemplo do PRD (`toEqual`), com `debug = false`. |
| T-05 | RF-05 | `test/errors.test.ts` | `new HTTPError({..., type, instance})` expõe os valores; sem os campos, ambos são `undefined`. |
| T-06 | RF-06 | `test/problem-details.test.ts` | `Error` comum com "segredo do banco": 500, sem a string, sem `stack`, com `debug = false`. Com `debug = true`: `stack` presente e a string continua ausente (ver P-01). |
| T-07 | RF-07, D-05 | `test/problem-details.test.ts` | `body` vai ao nível superior, `data` continua em `data`. Um `body` com `{type:"x", status:200}` não altera os membros. |
| T-08 | RF-08, D-02 | `test/problem-details.test.ts` | (a) `app.use` lança `HTTPError` 403: formato novo. (b) `onResponse(...)` com handler que **retorna** `HTTPError`: passa por `src/utils/middleware.ts:26` sem config e precisa do fallback. |
| T-09 | RF-09 | `test/problem-details.test.ts` | `retry-after: 30` preservado com 503 e `Content-Type` `application/problem+json`. |
| T-10 | D-05 | `test/problem-details.test.ts` | `Object.assign(new Error("x"), {type: "secret", instance: "/x"})` não tratado: `type` vira `about:blank`, `instance` ausente. |
| T-11 | D-02 | `test/problem-details.test.ts` | Sub-app montado com `mount` e `problemDetails` diferente do pai: o erro segue a configuração do app que renderiza (pai). Documenta o comportamento de `mount`. |
| T-12 | RF-10 | suíte completa | Toda a suíte existente passa sem alteração de asserção. |

Todos os testes em `describeMatrix`, para cobrir `web` e `node`. Headers e corpo devem ser iguais nos dois modos (PRD, risco "Matriz web/node").

### 6.2 Comandos

```bash
pnpm vitest run test/problem-details.test.ts   # novos testes (antes: falhando)
pnpm vitest run test/errors.test.ts test/security.test.ts
pnpm lint                                       # oxlint + oxfmt --check + typecheck
pnpm test                                       # suíte completa com cobertura
```

### 6.3 Pontos de atenção

- `_setup.ts` faz `afterEach` falhar em erros `unhandled` não permitidos. Os testes de T-06 e T-10 devem usar `t.errors = []` ao final, como `test/errors.test.ts:247-265` já faz, ou o `afterEach` lança.
- Como `_setup.ts` define `debug: true`, os testes de "sem vazamento" devem setar `t.app.config.debug = false` explicitamente.
- A asserção de T-02 deve comparar com `JSON.parse` do corpo, não com string, para não depender da ordem das chaves.

---

## 7. Riscos

| ID | Risco | Probabilidade | Mitigação | Teste |
|---|---|---|---|---|
| R-01 | Caminho sem config (`onResponse`, cache, chamadores do usuário) sai no formato antigo. | Média | D-02 (fallback via `event.app`). | T-08 |
| R-02 | Vazamento de `detail` ou `data` de erro `unhandled`. | Média | D-05, `detail`/`data`/`instance` omitidos. | T-06 |
| R-03 | `type` ou `instance` arbitrários de `Error` comum chegam ao corpo. | Média | D-05, `type` forçado para `about:blank`, `instance` omitido. | T-10 |
| R-04 | Colisão entre chaves de `body` e membros da RFC. | Baixa | D-05, membros vencem. | T-07 |
| R-05 | Quebra de testes existentes que checam `application/json`. | Baixa | Opção desligada por padrão. `errors.test.ts:44,140` e `security.test.ts:556` não mudam. | T-12 |
| R-06 | Mudança em `debug` para caminhos sem config, por engano. | Baixa | D-02 limita o fallback a `problemDetails`. | T-02 (com debug ligado) |
| R-07 | Aumento de superfície pública. | Baixa | Só `type` e `instance` (em `ErrorInput`/`HTTPError`) e `problemDetails` (em `H3Config`). Sem export novo. | Revisão, `pnpm lint` |
| R-08 | Sub-app com opção diferente do pai. Não há herança de config em `mount`. | Média | Documentar. O pai decide, o que está de acordo com "configuração global da aplicação". | T-11 |
| R-09 | `ErrorBody` ou `toJSON()` ganharem campos por engano. Isso mudaria RF-02. | Baixa | D-03. | T-02, `types.test-d.ts` |

---

## 8. Pendências

Estas questões precisam de resposta do time. Cada uma traz a recomendação.

**P-01 — Em `debug`, `message` e `data` de erro `unhandled` devem aparecer?**
O PRD (RF-06) diz que sim. O código atual não expõe, e a especificação segue o código: `debug` só adiciona `stack`. **Recomendação:** manter o código e corrigir RF-06 no PRD. Expor `message` de erro interno em debug quebraria a regra de hoje e pode ser usado de forma indevida em produção com debug ligado.

**P-02 — `handler.fetch` chamado diretamente, sem app, usa o formato antigo?**
Não há configuração de app para ler (`src/handler.ts:120`). Sem novo nome público, não existe forma de passar a opção. **Recomendação:** aceitar a limitação, documentar que o formato depende de o erro ser renderizado por um app, e registrar o caso como limitação em RF-08. Se o time quiser o formato também nesse caso, a solução exige um parâmetro público novo, o que a restrição do pedido proíbe.

**P-03 — O campo `unhandled: true` deve sair do corpo problem details?**
Hoje `toJSON()` o inclui (`src/error.ts:231`). A especificação o omite no corpo RFC, pois é um flag interno e não é membro da RFC. **Recomendação:** omitir. Se o time preferir mantê-lo como extensão, basta incluí-lo em `problemDetailsBody` e ajustar T-06.

**P-04 — Sub-app com `problemDetails` próprio.**
Confirmado que `mount` copia rotas e middleware para o pai (`src/h3.ts:170-229`) e que a configuração do sub-app não é herdada. **Recomendação:** aceitar e documentar, como R-08.
