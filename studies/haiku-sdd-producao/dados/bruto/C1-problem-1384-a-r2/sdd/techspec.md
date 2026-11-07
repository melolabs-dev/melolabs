# Especificação técnica: problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-06).

Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `541d063`).

## Visão geral

- `H3Config` ganha `problemDetails?: boolean` (default desligado).
- `ErrorInput` ganha `type?` e `instance?`; `HTTPError` expõe `type` e `instance` como `readonly`.
- Quando a opção está ligada, `errorResponse` (`src/response.ts:358`) renderiza o corpo com um helper interno que reaproveita `HTTPError.toJSON()` e muda só o envelope (campos RFC 9457 e `Content-Type`).
- Sem a opção, o caminho atual é executado sem nenhuma mudança de saída.

Fluxo de erro atual, para referência: `"~request"` (`src/h3.ts:73`) → `toResponse(handlerRes, event, this.config)` (`src/h3.ts:99`) → `prepareResponse` (`src/response.ts:129`) → `errorResponse` (`src/response.ts:173`). O `config` já chega em `prepareResponse`, então a opção é lida do mesmo lugar que `debug` hoje.

---

### D-01 — Onde a opção é lida: `config` que já é passado para `toResponse`

**Contexto.** `toResponse(val, event, config)` (`src/response.ts:13`) recebe `config` e o repassa a `prepareResponse`, onde `config.debug` e `config.silent` já são lidos. `H3Core.config` é congelado na inicialização por `freezeApp` (`src/_entries/_common.ts:4-5`), então a leitura em tempo de resposta é estável (premissa do PRD).

**Alternativas consideradas.**

1. Ler `event.app?.config.problemDetails` dentro de `errorResponse`. Não exige mudar assinaturas, mas `handler.fetch` cria `H3Event` sem app (`src/handler.ts:120`), e a leitura passaria a depender de um campo opcional da entrada.
2. Passar um novo parâmetro booleano para `toResponse`. Quebra o padrão existente e aumenta a superfície interna.
3. Usar o `config` que já existe e completar os pontos de chamada que hoje não o passam (escolhida).

**Escolha: 3.** `errorResponse` recebe `config` inteiro (em vez de `config.debug`), igual a `prepareResponse`. Os chamadores sem `config` são tratados em D-07.

---

### D-02 — Helper interno de serialização em `utils/internal`

**Contexto.** AGENTS.md pede que helpers internos fiquem em `src/utils/internal/` e que o `toJSON` seja reutilizado (premissa do PRD: "não duplicar regras").

**Alternativas consideradas.**

1. Novo método público `HTTPError.toProblemDetails()`. Cria um nome público novo, o que o PRD proíbe (RF-03, "Nenhum outro nome público novo").
2. Montar o objeto dentro de `errorResponse` em `src/response.ts`. Aumenta um arquivo que já passa de 380 linhas (o guia pede < 200 por arquivo).
3. Função interna `toProblemDetails(error)` em `src/utils/internal/problem-details.ts` (escolhida).

**Escolha: 3.** A função não é exportada pelo `index.ts`; só `response.ts` a importa.

---

### D-03 — Mapeamento de campos e precedência da RFC

**Regra.**

- A partir de `error.toJSON()` (`src/error.ts:226`), removem-se `status`, `statusText`, `unhandled` e `message`; o restante (`data`, membros de `body`) vira membro de extensão.
- Os campos RFC são aplicados por último, então vencem em colisão com `body` (ex.: `body: { title: "x" }`).
- `type` = `error.type` ou `"about:blank"`; `title` = `statusText`; `status`; `detail` = `message` (que já é `"HTTPError"` quando `unhandled`); `instance` = `error.instance`.
- Valores `undefined` somem na serialização JSON, então `title` e `instance` ausentes não aparecem no corpo.

**Alternativas consideradas.**

1. Ignorar `body` no modo problem details. Perde o que a aplicação já expõe hoje, e o PRD pede que `data`/`body` continuem no nível superior.
2. Deixar `body` vencer em colisão. Permitiria que a aplicação sobrescreva `status` ou `type` do envelope.
3. RFC vence em colisão (escolhida), conforme PRD (Riscos, "Conflito de nomes de campos").

**Escolha: 3.**

---

### D-04 — `type` e `instance` em `ErrorInput` e campos `readonly` em `HTTPError`

**Regra.**

- `ErrorInput` (`src/error.ts:6`) ganha `type?: string` e `instance?: string`, com comentário no estilo do arquivo.
- Não entram em `ErrorBody`: `ErrorBody` descreve o que `HTTPError` serializa e `implements` na classe (`src/error.ts:74`); `type`/`instance` são entrada, não corpo. Isso evita mudar `toJSON`.
- `HTTPError` declara `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor (`src/error.ts:162`) a partir de `details`, sem fallback para `cause` (diferente de `status`/`statusText`/`headers`, que têm fallback). `data` e `body` também não têm fallback (`src/error.ts:208-209`), e `type`/`instance` seguem esse padrão.

**Alternativas consideradas.**

1. Adicionar em `ErrorBody` (e aparecer em `toJSON`). Muda o formato atual de erro sem a opção ligada, o que viola RF-01.
2. Fallback para `cause`, como `status`. Um `HTTPError` embrulhando outro erro com `type` (ex.: erro de parser) herdaria o `type` sem intenção.
3. Campos só em `ErrorInput`, sem fallback (escolhida).

**Escolha: 3.** Mudança aditiva; `ErrorBody` e `toJSON()` ficam iguais.

---

### D-05 — `unhandled` oculta `type` e `instance`

**Regra.** Erros `unhandled` (ex.: `new Error("segredo")` convertido em 500 em `src/response.ts:146-155`) têm `type` e `instance` omitidos no modo problem details, do mesmo modo que `data` e `body`. `unhandled` em si não é serializado nesse modo (não faz parte da RFC; PRD, premissa 2).

**Justificativa.** `type`/`instance` vêm da aplicação; em erro não tratado, a aplicação não controla o conteúdo, e o PRD quer zero vazamento nesse caso (RF-04).

**Alternativa.** Mostrar `type`/`instance` mesmo em `unhandled`. Descartada por ser superfície de vazamento sem ganho.

---

### D-06 — `Content-Type` exato e headers de erro preservados

**Regra.**

- Constante `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json" })` ao lado de `jsonHeaders` (`src/response.ts:270-272`), sem `charset`, conforme RF-02.
- `errorResponse` escolhe a base (`problemHeaders` ou `jsonHeaders`) e aplica `error.headers` e `errHeaders` por cima, como hoje (`src/response.ts:359-364`). Assim, `WWW-Authenticate` (RF-05) continua saindo, e um `content-type` explícito no `HTTPError.headers` continua vencendo (comportamento atual).
- A ordem de leitura de `errHeaders` (`src/response.ts:160`) antes de `kEventRes` ser limpo (`src/response.ts:172`) não muda.

**Alternativas consideradas.**

1. `application/problem+json;charset=UTF-8`, espelhando `jsonHeaders`. Diverge do texto do RF-02.
2. Trocar o `Content-Type` só após construir a resposta. Mais código e duplica `mergeHeaders`.

**Escolha: a regra acima** (sem `charset`, conforme RF-02).

---

### D-07 — Pontos de chamada sem `config`

Levantamento em `src/`:

| Local | Situação | Decisão |
| --- | --- | --- |
| `src/h3.ts:99` (`"~request"`) | Passa `this.config`. | Nada a fazer. |
| `src/handler.ts:122`, `:124` (`handlerWithFetch`) | `toResponse` sem `config`; o `H3Event` é criado sem app (`src/handler.ts:120`). | **Não** é alterado. Sem app não há opção; continua o formato atual, como já acontece com `debug` hoje. Documentar no teste. |
| `src/utils/middleware.ts:26` (`onResponse`) | Renderiza o valor de retorno do handler sem `config`. Um `HTTPError` retornado (não lançado) sairia no formato antigo. | Passar `{ problemDetails: event.app?.config.problemDetails }`. |
| `src/rules/cache.ts:314` (`toResponse` do ocache) | Mesmo problema; a resposta é cacheada, então o formato errado ficaria em cache. | Mesma escolha do item anterior. |

**Alternativas consideradas.**

1. Passar `event.app?.config` inteiro nos dois pontos. Mais simples, mas `debug` e `silent` passariam a valer nesses caminhos: `stack` apareceria em erros retornados com `debug: true`, mudança de comportamento fora do escopo (o PRD exige "sem a opção, nada muda").
2. Passar só `problemDetails` (escolhida). Escopo mínimo; o custo é um objeto literal de uma propriedade.
3. Deixar os dois pontos como estão. Erro silencioso de formato; descartada por ser o risco principal do PRD.

**Escolha: 2.** Se o time preferir a opção 1, a mudança de `debug` nesses caminhos precisa ser aprovada explicitamente.

---

### D-08 — Interação com `onError`

**Regra.** Nada muda no fluxo de `onError`. Quando o hook retorna um erro, `prepareResponse` é chamado com `nested = true` (`src/response.ts:161-165`) e renderiza com o mesmo `config`, então o formato problem details também vale para o erro devolvido pelo hook. `kEventRes` continua limpo antes da renderização (`src/response.ts:172`), evitando `set-cookie` duplicado.

---

## Contratos e assinaturas

### `src/types/h3.ts` (`H3Config`, linha 28)

```ts
export interface H3Config {
  // ...campos existentes (debug, silent, allowMalformedURL, plugins, onRequest, onResponse, onError)

  /**
   * When enabled, error responses use the RFC 9457 "problem details" format
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
}
```

`H3CoreConfig` (`src/types/h3.ts:55`) herda o campo por `Omit`.

### `src/error.ts`

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...campos existentes

  /**
   * RFC 9457 problem type URI. Defaults to `about:blank` in problem details responses.
   */
  type?: string;

  /**
   * RFC 9457 URI reference identifying this occurrence of the problem.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** RFC 9457 problem type URI, if provided. */
  readonly type: string | undefined;

  /** RFC 9457 instance URI, if provided. */
  readonly instance: string | undefined;

  // construtor: this.type = (details as ErrorInput)?.type;
  //             this.instance = (details as ErrorInput)?.instance;
  // toJSON(): inalterado
}
```

### `src/utils/internal/problem-details.ts` (novo)

```ts
import type { HTTPError } from "../../error.ts";

/**
 * Builds the RFC 9457 members of an error. Extension members (`data`, `body`) come from
 * `HTTPError.toJSON()`; RFC members are applied last so they win on collision.
 */
export function toProblemDetails(error: HTTPError): Record<string, unknown> {
  const { status, statusText, unhandled, message, ...extensions } = error.toJSON();
  return {
    ...extensions,
    type: unhandled ? undefined : (error.type ?? "about:blank"),
    title: statusText,
    status,
    detail: message,
    instance: unhandled ? undefined : error.instance,
  };
}
```

### `src/response.ts`

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
  // base = config.problemDetails ? problemHeaders : jsonHeaders
  // body = config.problemDetails ? toProblemDetails(error) : error.toJSON()
  // stack: config.debug && error.stack ? ... : undefined   (inalterado)
}
```

Chamada em `prepareResponse` (`src/response.ts:173`): `val = errorResponse(error, config, errHeaders);`.

### `src/utils/middleware.ts:26` e `src/rules/cache.ts:314`

```ts
const response = await toResponse(rawBody, event, { problemDetails: event.app?.config.problemDetails });
```

### Formato do corpo (modo ligado)

```jsonc
// 404 de HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "Usuário não encontrado"
  // + data/body da aplicação, se houver; + "stack" apenas com debug
}
```

---

## Arquivos a alterar

| Arquivo | Mudança | Referências conferidas |
| --- | --- | --- |
| `src/types/h3.ts` | Campo `problemDetails` em `H3Config`. | `:28` (interface), `:32` (`debug`), `:52` (`onError`), `:55` (`H3CoreConfig`). |
| `src/error.ts` | `type`/`instance` em `ErrorInput`; `readonly` e atribuição no construtor. | `:6` (`ErrorInput`), `:15` (`headers`), `:74` (classe), `:107` (`data`), `:112` (`body`), `:119` (`unhandled`), `:162` (construtor), `:209` (`this.body`), `:226` (`toJSON`). |
| `src/response.ts` | `problemHeaders`; `errorResponse` recebe `config`; chamada em `prepareResponse`. | `:13` (`toResponse`), `:73` (`toError`), `:129` (`prepareResponse`), `:146-155` (erro não tratado), `:160` (`errHeaders`), `:167-172` (comentário e limpeza de `kEventRes`), `:173` (chamada), `:270-272` (`jsonHeaders`), `:358-380` (`errorResponse`). |
| `src/utils/internal/problem-details.ts` | Novo: `toProblemDetails`. | AGENTS.md (helpers internos em `utils/internal/`). |
| `src/utils/middleware.ts` | Passar `problemDetails` em `onResponse`. | `:26`. |
| `src/rules/cache.ts` | Passar `problemDetails` no `toResponse` do ocache. | `:314`. |
| `src/index.ts` | Nenhuma mudança (sem nome público novo). | `:72` (exports de `ErrorInput`, `HTTPError`). |
| `src/handler.ts` | Nenhuma mudança (D-07). | `:105` (`handlerWithFetch`), `:122`, `:124`. |
| `src/h3.ts` | Nenhuma mudança; já passa `this.config`. | `:73` (`"~request"`), `:99`. |

Testes (novos ou ajustados):

| Arquivo | Mudança |
| --- | --- |
| `test/problem-details.test.ts` (novo) | Cobertura de RF-01 a RF-05 com `describeMatrix`. |
| `test/unit/error.test.ts` (novo) | `type`/`instance` no construtor (RF-03). |
| `test/unit/types.test-d.ts` | Tipos de `ErrorInput.type`/`instance` e de `H3Config.problemDetails`. |

Nenhum teste existente deve precisar de ajuste, porque o default é desligado. Se algum falhar, a causa é um bug desta mudança, não um ajuste aceitável.

---

## Estratégia de testes

Seguir o fluxo de AGENTS.md ("Bug Fix Workflow" adaptado para feature): escrever os testes primeiro, confirmar que falham, implementar, confirmar que passam.

1. **Padrão.** `describeMatrix` (`test/_setup.ts`). A instância de teste é criada com `debug: true` (`test/_setup.ts:135-136`). Para o modo sem `debug`, usar `t.app.config.debug = false`, como `test/errors.test.ts:14` já faz com `onError`. Para ligar a opção, usar `t.app.config.problemDetails = true` ou criar uma app própria com `new H3({ problemDetails: true })`.
2. **Regressão do padrão (RF-01).** Sem a opção, `Content-Type` e corpo idênticos aos atuais: `application/json;charset=UTF-8` e chaves `status`, `statusText`, `unhandled`, `message`, `data`. Reaproveitar as asserções já existentes em `test/errors.test.ts`.
3. **RF-02.** Campos `type`, `title`, `status`, `detail` e `instance` do exemplo do PRD; `404` de rota inexistente (`src/response.ts:139-143`, via `kNotFound`); `HTTPError` sem `statusText` (`title` ausente).
4. **RF-03 (unitário).** `new HTTPError({ status: 409, message: "Conflito", type, instance })`; sem os campos, `type` e `instance` são `undefined`; `toJSON()` idêntico ao atual.
5. **RF-04.** Erro `new Error("segredo do banco")` com `debug: false`: 500, `application/problem+json`, corpo sem `"segredo do banco"` e sem `stack`, e `detail` igual a `"HTTPError"`. Com `debug: true`: `stack` presente como lista de linhas.
6. **RF-05.** `HTTPError` com `headers: { "WWW-Authenticate": "Bearer" }` e `event.res.errHeaders` com `set-cookie`: ambos presentes, `set-cookie` não duplicado (regressão do comentário em `src/response.ts:167-171`).
7. **Colisão.** `body: { title: "x", status: 999 }` com a opção ligada: `title` e `status` da RFC prevalecem; `body` extra continua no topo.
8. **Caminhos D-07.** `onResponse` middleware com handler que *retorna* um `HTTPError` (sem lançar) e opção ligada: formato problem details. Cache (`test/rules/cache.test.ts`): erro retornado sob regra de cache sai em problem details.
9. **Caminho sem app (D-07).** `defineHandler(...).fetch(url)` com erro: formato atual, documentado como comportamento esperado.
10. **Hook `onError`.** Hook que retorna `HTTPError` novo: renderizado com problem details.
11. **HEAD.** Rota ausente com `HEAD`: corpo vazio e `content-length` nulo, como hoje (`test/errors.test.ts:13`).
12. **Tipos.** `test/unit/types.test-d.ts`: `ErrorInput` aceita `type`/`instance`; `HTTPError.type` é `string | undefined` e somente leitura.
13. **Comandos finais.** `pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts`, depois `pnpm vitest run` completo, `pnpm lint` (inclui `tsc --noEmit` pelo script `typecheck` em `package.json`; o `lint` por si só é `oxlint . && oxfmt --check .`, então rodar também `pnpm typecheck`).

---

## Riscos

1. **Chamadores sem `config` (PRD, risco 1).** Coberto por D-07 para os três pontos que renderizam erro. Os 2 pontos de `handler.ts` continuam sem a opção por design; o teste da seção 9 documenta isso. Revisão futura: se alguém adicionar um novo `toResponse` sem `config`, a opção será ignorada em silêncio. Mitigação: o teste de matriz da seção 8.
2. **`type`/`instance` lidos de qualquer objeto passado ao construtor (novo).** `new HTTPError(err)` copia `type`/`instance` de qualquer `err` com essas propriedades. Erros de parser de outras bibliotecas costumam ter `type` (ex.: `entity.parse.failed`), e isso viraria `type` RFC na resposta quando o erro é `HTTPError` (status > 99) e não `unhandled`. Mitigação possível, não adotada: aceitar `type`/`instance` só quando `details` não é `Error`. Decisão a confirmar com o time.
3. **Clientes que checam `application/json` (PRD, risco 2).** Com a opção ligada, o `Content-Type` muda. A opção é desligada por padrão; documentar a mudança.
4. **Colisão de nomes (PRD, risco 3).** Coberto em D-03 e teste 7.
5. **Vazamento em erros não tratados (PRD, risco 4).** Coberto pelo teste 5 nos dois modos. `toProblemDetails` nunca lê `message` ou `stack` direto, só via `toJSON()`, o que mantém a regra de `unhandled` em um lugar só.
6. **Tipos públicos (PRD, risco 5).** Mudança aditiva em `ErrorInput`; checar com `test/unit/types.test-d.ts`.
7. **`errHeaders` e `set-cookie` duplicado (PRD, risco 7).** Ordem de `src/response.ts:160` e `:172` preservada; teste 6 cobre.
8. **Cache (`src/rules/cache.ts:314`).** A resposta de erro é cacheada pelo ocache. Como `problemDetails` é fixo na inicialização, o formato em cache é consistente; mas uma aplicação que altera `config` em tempo de execução (só em testes) pode ver cache antigo. Aceitável.
9. **Ambiguidade de `title` (PRD, decisão a confirmar).** Proposta: omitir `title` quando `statusText` não existe, e não derivar do código HTTP. Confirmar com o time.
10. **Ambiguidade de `unhandled` (PRD, decisão a confirmar).** Proposta: `unhandled` não aparece no formato problem details, e `type`/`instance` também são omitidos (D-05). Confirmar.
