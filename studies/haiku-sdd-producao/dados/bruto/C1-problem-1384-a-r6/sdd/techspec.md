# Especificação técnica — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (contrato #1384-A), `sdd/prd.md` (RF-01 a RF-10, premissas P1–P6, riscos R1–R5), issue h3js/h3#1384.

Este documento fixa as decisões de implementação. Onde o PRD deixou uma escolha em aberto (P3, R2, R3), a escolha aparece como decisão e deve ser confirmada antes do merge.

## 1. Visão geral

O formato atual de erro é montado em `errorResponse` (`src/response.ts:358`), a partir de `HTTPError#toJSON()` (`src/error.ts:226`). A mudança adiciona um segundo formato de corpo, escolhido por `config.problemDetails`, lido no momento da renderização. Com a opção desligada, o caminho de código e a saída são os mesmos de hoje.

Mudanças:

1. `H3Config` ganha `problemDetails?: boolean`.
2. `ErrorInput` aceita `type` e `instance`; `HTTPError` os expõe como `readonly`.
3. `errorResponse` recebe a configuração inteira (em vez de só `debug`) e, quando `problemDetails` está ligado, monta o corpo RFC 9457 e o `Content-Type: application/problem+json`.

Nenhum nome público novo além de `problemDetails`, `type` e `instance`. Helpers novos ficam não exportados.

## 2. Decisões de arquitetura

### D-01 — Ativação por opção de configuração lida na renderização

- **Escolha:** `problemDetails?: boolean` em `H3Config`, lido de `config` dentro de `prepareResponse` a cada erro, do mesmo jeito que `config.debug` (`src/response.ts:173`). Como `H3.fetch` passa `this.config` (`src/h3.ts:99`), que é o próprio objeto `app.config`, alterar `app.config.problemDetails` em tempo de execução tem efeito imediato, como já acontece com `onError`.
- **Alternativas consideradas:**
  - Negociação de conteúdo pelo header `Accept: application/problem+json`. Rejeitada: o PRD pede uma opção de configuração e desligada por padrão; negociação mudaria o corpo de clientes existentes sem aviso.
  - Opção por rota ou por erro. Rejeitada: fora do escopo (PRD, "Novos nomes públicos" e objetivo de uma chave global).
- **Justificativa:** segue o padrão de `debug`/`silent`, não cria mecanismo novo e mantém o default `false` como no PRD.

### D-02 — Montagem do corpo em função interna, não em `toJSON()`

- **Escolha:** nova função interna `problemBody(error, debug)` em `src/response.ts`, chamada só por `errorResponse` quando a opção está ligada. `HTTPError#toJSON()` não muda (premissa P4).
- **Alternativas consideradas:**
  - Novo método público `toProblemJSON()` em `HTTPError`. Rejeitada: cria nome público, proibido pelo PRD.
  - Parâmetro em `toJSON()` (`toJSON({ problemDetails })`). Rejeitada: mistura dois formatos num método que é serialização padrão de `JSON.stringify` e altera a assinatura usada por código de terceiros.
- **Justificativa:** a mudança fica restrita à renderização da resposta, como diz P4, e `toJSON()` continua sendo a forma "pública" de serializar o erro.

### D-03 — `errorResponse` recebe `config` em vez de `debug`

- **Escolha:** a assinatura passa de `errorResponse(error, debug?, errHeaders?)` para `errorResponse(error, config, errHeaders?)`, onde `config: H3Config` (`src/response.ts:358`). O único chamador é `src/response.ts:173`.
- **Alternativas consideradas:**
  - Acrescentar `problemDetails` como quarto parâmetro posicional. Rejeitada: o terceiro parâmetro já é opcional e a lista cresceria a cada opção futura.
  - Objeto de opções `{ debug, problemDetails }` como segundo parâmetro. Equivalente em clareza, mas exige montar um objeto por erro; passar `config` que já existe não aloca nada.
- **Justificativa:** uma leitura de `config` por erro, sem novos parâmetros. Segue a convenção de AGENTS.md de "options object" para funções com vários argumentos, pois `config` já é esse objeto.

### D-04 — `type` e `instance` como campos de entrada e de instância, sem entrar em `ErrorBody`

- **Escolha:**
  - `type?: string` e `instance?: string` em `ErrorInput` (`src/error.ts:6`).
  - `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`, no mesmo estilo de `statusText` (`src/error.ts:92`).
  - Valor aceito só se for string não vazia; caso contrário `undefined` (RF-04 pede "não string = ausente"; a string vazia foi incluída porque `type: ""` não tem significado na RFC e renderizaria `"type":""`).
- **Alternativas consideradas:**
  - Adicionar `type`/`instance` a `ErrorBody`. Rejeitada: `HTTPError#toJSON()` tipa o retorno como `Omit<ErrorBody, "body"> & ErrorBody["body"]` (`src/error.ts:226`), então os campos apareceriam no tipo de `toJSON()` sem existirem na saída, quebrando P4.
- **Justificativa:** a superfície de `ErrorBody` (que descreve o JSON do formato atual) não muda.

### D-05 — Herança de `type`/`instance` a partir de `cause`: não herdar

- **Escolha:** `type` e `instance` leem só `details`, nunca `details.cause`. Os campos `status`, `statusText`, `headers` e `unhandled` continuam herdando de `cause` como hoje (`src/error.ts:173-206`).
- **Alternativas consideradas:** herdar de `cause` como os demais campos. Rejeitada por P3 e pelo escopo mínimo: `cause` pode ser um erro de outra camada com um `type` que não é o tipo de problema da API. Esta é a recomendação do PRD; deve ser confirmada.

### D-06 — Regras de precedência e de omissão do corpo

- **Escolha:** `problemBody` monta o objeto nesta ordem de chaves:
  1. extensões, só quando o erro não é `unhandled`: `data` e depois `...error.body` (mesma ordem de `toJSON()`, `src/error.ts:228-235`);
  2. membros RFC, que sobrescrevem qualquer chave homônima das extensões (P6):
     - `type`: `error.type` quando definido e o erro não é `unhandled`; senão `"about:blank"`;
     - `title`: `error.statusText` (pode ser `undefined`, então o JSON omite a chave);
     - `status`: `error.status`;
     - `detail`: `error.message` quando não `unhandled`; senão `undefined` (omitido);
     - `instance`: `error.instance` quando não `unhandled`; senão `undefined`;
  3. `stack`, só com `debug` (mesma regra de `src/response.ts:369`).

  Como `JSON.stringify` omite `undefined`, a RF-03 e a RF-05 ("não contém a chave `instance`") saem sem código de filtragem.
- **Por que `type` ignora o valor em erro `unhandled`:** erros não tratados chegam como `HTTPError` com `unhandled: true` a partir de qualquer `Error` (`src/response.ts:146-155`). Esses erros podem carregar uma propriedade `type` de outra biblioteca (por exemplo, `"entity.parse.failed"`), que não é uma URI de tipo. Expor isso vazaria detalhe interno e geraria `type` inválido. Por isso, para erros `unhandled`, `type` e `instance` são sempre omitidos ou fixados.
- **Por que `detail` é omitido (e não `"HTTPError"`) em `unhandled`:** `toJSON()` usa `"HTTPError"` como `message` nesse caso (`src/error.ts:232`), o que não é um detalhe útil em problem details. Omitir é mais limpo e atende RF-07, que só exige que a mensagem original não apareça.
- **Por que `title` não recebe texto padrão do status:** o RF-03 manda omitir `title` quando não há `statusText`, e o exemplo de RF-03 não cobre esse caso. Isto contraria o "SHOULD" da RFC (R2). Decisão: manter a omissão do PRD. Se for trocada por texto padrão (`http.STATUS_CODES`-like), o custo é um mapa de textos em `src/`.

### D-07 — `Content-Type` definido por último

- **Escolha:** em `errorResponse`, quando a opção está ligada, `headers.set("content-type", "application/problem+json")` roda depois de `error.headers` e de `errHeaders` terem sido mesclados. Sem `charset` (P5).
- **Justificativa:** a RF-08 diz que o `Content-Type` de problem details tem precedência sobre o do erro. Fazer o `set` por último cobre também `event.res.errHeaders`, que é mesclado depois de `error.headers` (`src/response.ts:358-364`).

### D-08 — `onError` não exige mudança de fluxo

- **Escolha:** nenhuma mudança no fluxo de `onError`. Quando o hook devolve um `HTTPError`, `prepareResponse` é chamado de novo com `nested = true` (`src/response.ts:161-165`), passa pelo ramo de erro e chega a `errorResponse`, que já usa a opção. Quando devolve um objeto simples, segue o caminho de JSON (`src/response.ts:309-313`), sem conversão (RF-09).
- **Verificação:** os testes da seção 5 cobrem os dois casos. Não há risco de cabeçalhos duplicados porque `kEventRes` é limpo antes de `errorResponse` (`src/response.ts:172`), como já é hoje.

### D-09 — `defineHandler(...).fetch` continua sem `config`

- **Escolha:** `src/handler.ts:122-124` chama `toResponse` sem configuração. Com isso, `problemDetails` (e também `debug`, `onError` e `onResponse`) não se aplica a handlers usados sozinhos via `.fetch`, o que já acontece hoje com `debug`.
- **Justificativa:** o handler não pertence a um app, então não há `app.config` para ler. Mudar isso é um ajuste de comportamento existente e está fora do escopo do PRD. Registrado em R-04 abaixo.

## 3. Arquivos a alterar

| Arquivo | Linhas de referência (estado atual) | Mudança |
|---|---|---|
| `src/types/h3.ts` | `:28-37` (`H3Config`, `debug` em `:32`, `silent` em `:37`) | Adicionar `problemDetails?: boolean` com JSDoc logo após `silent` (`:37`). |
| `src/error.ts` | `:6-26` (`ErrorInput`), `:92` (`statusText`), `:112` (`body`), `:162-210` (construtor), `:226-237` (`toJSON`) | Adicionar `type?`/`instance?` a `ErrorInput`; campos `readonly type`/`readonly instance` após `:112`; atribuição no construtor após `:209`; `toJSON` **sem mudança**. |
| `src/response.ts` | `:146-174` (ramo de erro), `:173` (chamada de `errorResponse`), `:270-272` (`jsonHeaders`), `:358-380` (`errorResponse`) | Passar `config` a `errorResponse`; nova lógica de corpo e `Content-Type` em `errorResponse`; nova função interna `problemBody`. |
| `src/h3.ts` | `:53-55` (`this.config = config`), `:99` (`toResponse(..., this.config)`) | Sem mudança; confirma que o `config` lido é `app.config`. |
| `test/errors.test.ts` | `:9` (`describe("error response bodies")`), `:14` e `:27` (`t.app.config.onError = undefined`), `:202` ("error headers"), `:246` ("non-Error throws"), `:339`, `:355` | Novo bloco `describe("problem details")` (ver seção 5). |
| `test/_setup.ts` | `:11` (`describeMatrix`) | Sem mudança. |

Não é necessário alterar `src/index.ts` (`:72` já exporta `ErrorInput`, `ErrorBody`, `HTTPError`) nem `src/handler.ts`.

Arquivos de documentação: AGENTS.md não lista opções de `H3Config`, então não exige atualização. Se a documentação pública de `H3Config` existir fora do repositório, ela fica fora desta entrega.

## 4. Contratos e assinaturas

### 4.1 `src/types/h3.ts`

```ts
export interface H3Config {
  debug?: boolean;
  silent?: boolean;

  /**
   * When enabled, error responses use the RFC 9457 problem details format
   * (`application/problem+json`) instead of the default H3 error JSON.
   *
   * @default false
   */
  problemDetails?: boolean;

  allowMalformedURL?: boolean;
  // ...demais campos inalterados
}
```

`H3CoreConfig` (`src/types/h3.ts:55`) é `Omit<H3Config, "plugins">`, então herda a opção sem alteração.

### 4.2 `src/error.ts`

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  cause?: unknown;
  headers?: HeadersInit;

  /** RFC 9457 `type` URI. Used only when `problemDetails` is enabled. */
  type?: string;

  /** RFC 9457 `instance` URI reference. Used only when `problemDetails` is enabled. */
  instance?: string;

  /** @deprecated use `status` */ statusCode?: number;
  /** @deprecated use `statusText` */ statusMessage?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes

  /**
   * RFC 9457 problem type URI. `undefined` when not set; `about:blank` is applied when rendering.
   */
  readonly type: string | undefined;

  /**
   * RFC 9457 problem instance URI reference.
   */
  readonly instance: string | undefined;

  // construtor: sem assinatura nova; atribuições adicionadas após `this.body = ...` (linha 209)
  //   this.type = optionalString((details as ErrorInput)?.type);
  //   this.instance = optionalString((details as ErrorInput)?.instance);

  // toJSON(): inalterado
}

/** Internal helper, at end of file. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
```

`HTTPError` continua `implements ErrorBody<DataT>` sem alteração de `ErrorBody`.

### 4.3 `src/response.ts`

Assinatura interna (não exportada):

```ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Chamada (`src/response.ts:173`):

```ts
val = errorResponse(error, config, errHeaders);
```

Corpo montado quando `config.problemDetails` é verdadeiro (interno):

```ts
function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown> {
  const unhandled = error.unhandled;
  return {
    ...(unhandled ? undefined : { data: error.data, ...error.body }),
    type: (!unhandled && error.type) || "about:blank",
    title: error.statusText,
    status: error.status,
    detail: unhandled ? undefined : error.message,
    instance: unhandled ? undefined : error.instance,
    stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
  };
}
```

Em `errorResponse`:

```ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  const problem = config.problemDetails;
  let headers: Headers = error.headers
    ? mergeHeaders(jsonHeaders, error.headers)
    : new Headers(jsonHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  if (problem) {
    headers.set("content-type", "application/problem+json");
  }
  return new FastResponse(
    JSON.stringify(
      problem
        ? problemBody(error, config.debug)
        : { ...error.toJSON(), stack: config.debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined },
      undefined,
      config.debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

Observações sobre a implementação:

- O ramo sem a opção deve ficar o mais próximo possível do código atual, para o diff ser pequeno e a saída idêntica. A forma acima é ilustrativa; a versão final pode separar `problemBody` e manter a linha de `stack` do caminho padrão sem duplicação, desde que a saída não mude.
- `status` e `statusText` do `FastResponse` continuam vindo de `error` (não do corpo), então o status HTTP não muda com a opção (RF-02).
- `mergeHeaders` (`src/response.ts:243`) já retorna um `Headers` novo, então `set` não altera `jsonHeaders` (que é `FrozenHeaders`, `src/response.ts:260-272`).
- A ordem das chaves do exemplo da RF-03 (`type`, `title`, `status`, `detail`) é preservada quando não há extensões. Com extensões, elas aparecem antes dos membros RFC; isso é válido em JSON.

### 4.4 Comportamento observável (resumo)

| Situação | Status | Content-Type | Corpo |
|---|---|---|---|
| Opção desligada (qualquer erro) | igual a hoje | `application/json;charset=UTF-8` | igual a hoje (`toJSON()` + `stack`) |
| Opção ligada, `HTTPError` com `status`, `statusText`, `message` | `error.status` | `application/problem+json` | `{"type":"about:blank","title":…,"status":…,"detail":…}` |
| Opção ligada, `type`/`instance` definidos | `error.status` | `application/problem+json` | inclui `type` e `instance` |
| Opção ligada, `data`/`body` definidos, não `unhandled` | `error.status` | `application/problem+json` | `data` e chaves de `body` na raiz |
| Opção ligada, erro `unhandled` (ex.: `new Error(...)`) | `500` | `application/problem+json` | `{"type":"about:blank","status":500}`; sem `detail`, `data`, `body`, `instance`; `title` ausente |
| Opção ligada, `onError` devolve `HTTPError` | do erro devolvido | `application/problem+json` | problem details do erro devolvido |
| Opção ligada, `onError` devolve `{ ok: false }` | do `event.res` ou 200 | `application/json` | `{"ok":false}` (sem conversão) |

## 5. Estratégia de testes

Todos os testes novos usam `describeMatrix` (`test/_setup.ts:11`), que roda cada caso em `web` e `node`. O `t.app` é fresco por teste e a opção é ligada por `t.app.config.problemDetails = true`, seguindo o padrão de `t.app.config.onError = undefined` (`test/errors.test.ts:14`).

Novo bloco `describe("problem details", ...)` em `test/errors.test.ts`, inserido logo após o bloco `"non-Error throws"` (depois de `:245`). Casos:

1. **RF-01 — opção desligada.** Sem `problemDetails` (e com `problemDetails: false`): `Content-Type` é `application/json;charset=UTF-8` e corpo igual ao atual. Serve de regressão: o teste deve passar antes e depois da mudança.
2. **RF-02 — status e content-type.** `new HTTPError({ status: 404, message: "não encontrado" })` → status 404, `application/problem+json`, corpo JSON.
3. **RF-03 — membros.** `{ status: 404, statusText: "Not Found", message: "Usuário não existe" }` → corpo exatamente `{"type":"about:blank","title":"Not Found","status":404,"detail":"Usuário não existe"}`. Sem a chave `message`.
4. **RF-03 — sem `statusText`.** Erro sem `statusText` → chave `title` ausente.
5. **RF-04 — construtor e instância (sem HTTP).** `new HTTPError({ status: 403, type: "...", instance: "/contas/42" })` → `err.type` e `err.instance` com os valores. Sem os campos → `undefined`. Valores não string (`type: 42`) e string vazia → `undefined`. `cause` com `type` não é herdado (D-05). Podem ser testes em `describe` simples, sem matriz, ou dentro de `describeMatrix` por consistência.
6. **RF-05 — `type` e `instance` no corpo.** Com a opção ligada, `"type":"https://exemplo.com/erros/sem-saldo"` e `"instance":"/contas/42"` no corpo. Sem `instance` definido, o corpo não tem a chave.
7. **RF-05 — `type` padrão.** Sem `type` → `"type":"about:blank"`.
8. **RF-06 — extensões.** `{ status: 422, message: "inválido", data: { campo: "email" }, body: { codigo: 7 } }` com `debug: false` → `"data":{"campo":"email"}`, `"codigo":7` na raiz, sem `stack`.
9. **RF-06 — debug.** Mesmo caso com `debug: true` → `stack` presente como array de strings.
10. **D-06 — precedência.** `body: { status: 999, type: "x", detail: "y" }` com `message: "ok"` → membros RFC prevalecem (`status` 422, `type` `about:blank`, `detail` `"ok"`).
11. **RF-07 — erro não tratado.** `throw new Error("senha do banco: 123")` → status 500, `application/problem+json`, `type` `about:blank`, corpo sem `"senha do banco"`, sem `detail`, sem `title`. Também com `type` no `Error` (ex.: `Object.assign(new Error("x"), { type: "entity.parse.failed" })`) → `type` continua `about:blank` (D-06).
12. **RF-07 — `throw` de objeto.** `throw { secret: "db-password" }` → corpo sem o segredo.
13. **RF-08 — headers.** `new HTTPError({ status: 401, headers: { "www-authenticate": "Bearer" } })` → `www-authenticate: Bearer` e `application/problem+json`. Também `headers: { "content-type": "text/plain" }` no erro → `application/problem+json` prevalece (D-07).
14. **RF-08 — `errHeaders`.** `event.res.errHeaders.set("content-type", "text/html")` → `application/problem+json` prevalece.
15. **RF-09 — `onError` devolve `HTTPError`.** `onError` retorna `new HTTPError({ status: 503, message: "indisponível" })` → status 503, `application/problem+json`, `detail` `"indisponível"`. `onError` chamado uma vez.
16. **RF-09 — `onError` devolve objeto simples.** `onError` retorna `{ ok: false }` → `application/json` com `{"ok":false}`.
17. **RF-09 — `onError` devolve `HTTPError` sem `set-cookie` duplicado.** `errHeaders.append("set-cookie", "a=1")` + `onError` devolvendo erro → um único `a=1` em `getSetCookie()` (protege a lógica de `src/response.ts:167-171`).
18. **Regressão existente.** A suíte atual (`test/errors.test.ts` inteiro) deve passar **sem alteração**, porque a opção default é `false`. Se algum teste existente falhar, é sinal de quebra de RF-01, não de ajuste de teste.
19. **Tipos.** Em `test/unit/types.test-d.ts`, `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()` e `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()`. Opcional, mas barato e cobre a superfície pública.

Verificação de qualidade (ordem sugerida, conforme AGENTS.md "Bug Fix Workflow"):

1. Escrever os testes 2, 3, 5, 6, 11 e 15 primeiro, rodar `pnpm vitest run test/errors.test.ts` e confirmar que **falham** (o campo `type` não existe e a opção não é lida).
2. Implementar: `src/types/h3.ts`, `src/error.ts`, `src/response.ts`.
3. Confirmar que os testes passam.
4. `pnpm vitest run test/errors.test.ts test/unit`.
5. `pnpm test` (lint + typecheck + coverage). Lint: `oxlint . && oxfmt --check .`; typecheck: `tsc --noEmit`.

Cobertura: `vitest --coverage` é parte de `pnpm test`. Os ramos novos (`problemBody` com e sem `unhandled`, `optionalString` com valor não string) devem ser cobertos pelos casos acima.

## 6. Riscos e pontos de atenção

- **R-01 (PRD R1) — quebra de clientes ao ligar a opção.** Clientes que leem `message` deixam de ver a chave. Mitigação: default `false`; a documentação da opção deve dizer isso. Nenhuma mudança de comportamento sem ligar a opção.
- **R-02 (PRD R2) — `title` ausente em 500 não tratados.** Contraria o "SHOULD" da RFC. Decisão desta spec: manter a omissão (D-06). Decisão a confirmar.
- **R-03 (PRD R3) — colisão de chaves.** Resolvida por D-06: membros RFC sobrescrevem `body`/`data`. Coberta pelo teste 10.
- **R-04 — `defineHandler(...).fetch` ignora `config` (D-09).** Afeta `problemDetails`, `debug`, `onError` e `onResponse` igualmente. Não é regressão introduzida aqui; fica documentado.
- **R-05 (PRD R4) — `stack` em debug.** Igual ao atual. Não muda a exposição com a opção ligada; ligar `debug` em produção continua vazando detalhes.
- **R-06 — `type` vindo de erros de outras bibliotecas.** Erros não tratados que trazem `type` (como exemplos de parsers) são cobertos por D-06: para `unhandled`, `type` nunca vai ao corpo. Erros tratados (`isError` verdadeiro, sem `unhandled`) com `type` não-URI passam o valor adiante; isso é responsabilidade de quem cria o `HTTPError`, e a validação de URI está fora do escopo (PRD).
- **R-07 — `HTTPError` como `details`.** `new HTTPError(existingHttpError)` copia `type`/`instance` por `(details as ErrorInput)?.type`, então a cópia preserva os campos. Não há teste específico no PRD; recomendado incluir um caso.
- **R-08 — mudança de forma da instância.** `HTTPError` ganha duas propriedades `readonly`. Código que faz `Object.keys(err)` ou snapshot de instâncias pode ver campos novos (com `undefined`). Risco baixo; checar snapshots de teste ao rodar a suíte.
- **R-09 — `errorResponse` muda de assinatura.** É função interna (não exportada em `src/index.ts`), então não é mudança pública. Confirmar com `grep` que não há outro chamador antes do merge (o levantamento atual encontrou apenas `src/response.ts:173`).
- **R-10 — ordem de chaves.** Quando há `data`/`body`, eles vêm antes dos membros RFC. Não é quebra de contrato; se a equipe preferir membros RFC primeiro, basta inverter a ordem em `problemBody` sem mudar a precedência.
- **R-11 — `build`/`dist`.** `test/dist.test.ts` testa a saída compilada. A mudança não cria entrada nova, então não deve exigir ajuste, mas rodar `pnpm build` antes do merge confirma.

## 7. Itens a confirmar antes do merge

1. D-05: não herdar `type`/`instance` de `cause` (P3).
2. D-06: `title` omitido quando não há `statusText` (R2).
3. D-04: string vazia tratada como ausente.
4. D-06: `detail` omitido (não `"HTTPError"`) em erros `unhandled`.
5. D-09: aceitar que `defineHandler(...).fetch` continua sem `problemDetails`.
