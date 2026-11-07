# Techspec — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-07). Este documento não altera código.

## 1. Estado atual (conferido no código)

- Toda resposta de erro passa por **um único ponto**: `errorResponse` (`src/response.ts:358`), chamada só em `src/response.ts:173`, dentro de `prepareResponse`. Isso cobre `HTTPError` lançado, erro desconhecido (embrulhado em `HTTPError` com `unhandled`, `src/response.ts:147-155`), `kNotFound` (404, `src/response.ts:139-144`) e número lançado/retornado (`toError`, `src/response.ts:77-79`).
- `errorResponse` parte de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`), mescla `error.headers` e depois `errHeaders` com `mergeHeaders` (`src/response.ts:243-252`, que usa `set`, então o header do usuário vence), e serializa `{ ...error.toJSON(), stack }` (`src/response.ts:365-373`).
- `jsonHeaders` também é usado para respostas **não erro** (`src/response.ts:312`, `:318`). Não pode ser alterado.
- `HTTPError.toJSON()` (`src/error.ts:226-236`) emite `status`, `statusText`, `unhandled`, `message`, `data` e o spread de `body`. Com `unhandled`, `message` vira `"HTTPError"` e `data`/`body` somem.
- `ErrorInput` (`src/error.ts:6`) estende `Partial<ErrorBody>`; `ErrorBody` (`src/error.ts:30`) é implementado por `HTTPError` (`src/error.ts:74`). O construtor está em `src/error.ts:162-210`; `HTTPError.status()` em `src/error.ts:144-150`.
- Não existe tabela completa de textos de razão. `STATUS_TEXT` em `src/utils/response.ts:347-354` é parcial de propósito (só 204 e redirects).
- JSON-RPC monta seu próprio erro (`src/utils/json-rpc.ts:476-490`) e não usa `errorResponse`; fica fora de escopo.

## 2. Decisões de arquitetura

### D-01 — Mudar apenas `errorResponse` e `toJSON()`, sem novo caminho de emissão

- **Alternativas:** (a) criar um módulo/função pública `problemResponse`; (b) negociar por `Accept`; (c) alterar `errorResponse` e `toJSON()`.
- **Escolha:** (c). O PRD proíbe nomes públicos novos e negociação. `errorResponse` já é o ponto único, então hooks, middleware, 404 e status numérico herdam o formato sem tocar neles (RF-01). `onError` que devolve resposta própria continua livre para ignorar o formato, como hoje.

### D-02 — Content-type `application/problem+json` sem parâmetro `charset`

- **Alternativas:** (a) `application/problem+json;charset=UTF-8`, espelhando `jsonHeaders`; (b) `application/problem+json` puro.
- **Escolha:** (b). A RFC 9457 §3 registra o tipo sem parâmetros e JSON é sempre UTF-8, então `charset` é redundante. O critério do PRD ("começa com") aceita as duas formas. Criar uma constante `problemHeaders` em `src/response.ts`, ao lado de `jsonHeaders`, também como `FrozenHeaders`. `jsonHeaders` não muda. A mesclagem existente (`mergeHeaders`) garante RF-06: um `content-type` em `error.headers` ou `errHeaders` prevalece.

### D-03 — Título padrão via tabela interna nova em `src/utils/internal/status-text.ts`

- **Alternativas:** (a) reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`; (b) completá-la e exportá-la; (c) novo arquivo interno com a tabela completa de reason phrases; (d) usar uma API do runtime.
- **Escolha:** (c). (a) e (b) mudariam a semântica de `noContent`/`redirect` (`src/utils/response.ts:44`, `:79`), que hoje deliberadamente não põem texto em outros códigos. (d) não existe de forma portável em Workers/Deno/Bun. O arquivo fica em `utils/internal/` (convenção "não exportado", sem barrel) e exporta `getStatusText(status: number): string | undefined`. Cobre os códigos 4xx/5xx e 1xx–3xx de RFC 9110, sem dependência nova. Usar "Content Too Large" (413) e "Unprocessable Content" (422), nomes atuais da RFC 9110, já usados em `src/utils/query.ts:77`.
- **Regra de `title`:** `error.statusText || getStatusText(error.status) || "HTTPError"` (RF-02). O `title` do erro não tratado é calculado do mesmo jeito.

### D-04 — `type` e `instance` entram em `ErrorBody`

- **Alternativas:** (a) só em `ErrorInput`; (b) em `ErrorBody` (herdado por `ErrorInput` via `Partial`, implementado por `HTTPError`).
- **Escolha:** (b). Uma declaração só, e `HTTPError implements ErrorBody` obriga a propriedade existir na instância, garantindo RF-03 em tempo de compilação. Não cria nomes públicos novos além dos dois campos. `HTTPError.status(...)` (`src/error.ts:144`) e `new HTTPError(msg, detalhes)` herdam o campo, porque usam `ErrorDetails`/`ErrorInput`.

### D-05 — Composição do corpo: legado primeiro, membros RFC por último

- **Alternativas:** (a) manter a ordem atual e acrescentar membros RFC antes do spread de `body`; (b) membros RFC depois do spread de `body`.
- **Escolha:** (b). O RF-04 exige que extensões (`body`) não sobrescrevam `type`, `title`, `status`, `detail`, `instance`. Ordem em `toJSON()`: `statusText`, `unhandled`, `message`, `data`, `...body` (comportamento atual, `body` ainda pode sobrescrever `message`/`data` como hoje), depois `type`, `title`, `status`, `detail`, `instance`. Chaves `undefined` somem na serialização, então `instance` ausente não aparece (RF-02) e `statusText`/`data` ausentes continuam sumindo como hoje. `status` já era vencedor implícito apenas por ordem; agora é explícito. `detail` é igual a `message` do erro (e não ao `message` possivelmente sobrescrito por `body`).

### D-06 — Erro não tratado: `type` fixo, sem `detail`, sem `instance`

- **Alternativas:** (a) emitir `type`/`instance` informados mesmo com `unhandled`; (b) fixar `about:blank` e omitir `instance`.
- **Escolha:** (b). Alinha-se ao RF-05 ("mensagem, data e body ocultos") e evita vazamento por qualquer valor que a cadeia de `cause` carregue. `title` e `status` são mantidos; `message` segue `"HTTPError"` (`src/error.ts:232`) e `detail` é `undefined`. O `stack` continua sendo acrescentado só em `errorResponse` com `debug` (`src/response.ts:369`).

### D-07 — `type`/`instance` lidos apenas do próprio objeto de entrada, não de `cause`

- **Alternativas:** (a) seguir o padrão de `status`/`headers`, que olham também `details.cause` (`src/error.ts:173-177`, `:202`); (b) ler só de `details`.
- **Escolha:** (b). Erros de terceiros trazem `type` com outro sentido (ex.: `entity.too.large` de body parsers) e `new HTTPError(erro)` é chamado para qualquer `Error` (`src/response.ts:148`). Ler do `cause` poluiria o campo `type` com valores que não são URI. Como `details` também pode ser um `Error` comum, validar `typeof === "string"` antes de atribuir; caso contrário, `undefined`. Valor `undefined`/vazio em `type` vira `"about:blank"` apenas na serialização, mantendo `error.type` fiel ao informado (RF-03).

### D-08 — Ajuste mínimo dos testes existentes, sem afrouxar asserções

- **Alternativas:** (a) trocar `toBe` por `toMatch(/json/)`; (b) trocar o valor esperado exato pelo novo.
- **Escolha:** (b). Mantém a verificação de igualdade exata. Testes conhecidos que quebram:
  - `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` → `toBe("application/problem+json")`.
  - `test/errors.test.ts:140`: `toMatch("application/json")` (casa por substring, seria quebrado por `problem+json`) → `toMatch("application/problem+json")`.
  - Os demais acessos de `content-type` JSON em `test/router.test.ts:422`, `test/security.test.ts:556` e `test/proxy.test.ts:1531` são de respostas não erro e não mudam.
  - Os `toMatchObject` sobre corpos de erro (`test/errors.test.ts:53`, `:79`, `:99`, `:144` etc.) continuam válidos pela compatibilidade do RF-04.
  - Rodar a suíte inteira para achar casos com `toEqual`/snapshot de corpo de erro em outros arquivos (a busca por texto não achou nenhum, mas não substitui a execução).

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/error.ts` | `:30-69` | `ErrorBody` ganha `type?: string` e `instance?: string` (com JSDoc). |
| `src/error.ts` | `:109-119` | declarar `readonly type: string \| undefined` e `readonly instance: string \| undefined`. |
| `src/error.ts` | `:208-209` | atribuir `type`/`instance` no construtor (D-07). |
| `src/error.ts` | `:226-236` | `toJSON()` com novo formato e tipo de retorno (D-05, D-06). |
| `src/error.ts` | `:1` | importar `getStatusText` de `./utils/internal/status-text.ts`. |
| `src/utils/internal/status-text.ts` | novo | tabela e `getStatusText` (D-03). |
| `src/response.ts` | `:270-272` | adicionar `problemHeaders` ao lado de `jsonHeaders` (D-02). |
| `src/response.ts` | `:358-361` | `errorResponse` parte de `problemHeaders` em vez de `jsonHeaders`. |
| `test/errors.test.ts` | `:44`, `:140` | ajustes de D-08; novos testes (seção 5). |
| `docs/1.guide/1.basics/6.error.md` | `:37-50`, `:55-57`, `:90` | exemplo de resposta, lista de campos (`type`, `instance`), nota de content-type. |

`src/response.ts:173` (chamada) e `src/utils/json-rpc.ts` não mudam.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  // ...campos atuais...
  /** URI de referência do tipo do problema (RFC 9457 §3.1.1). Padrão na resposta: "about:blank". */
  type?: string;
  /** URI de referência da ocorrência específica (RFC 9457 §3.1.5). Omitido quando ausente. */
  instance?: string;
}

class HTTPError<DataT = unknown> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): ProblemJSON; // tipo inline (sem nome exportado), exigido por isolatedDeclarations
}

// src/utils/internal/status-text.ts (interno)
export function getStatusText(status: number): string | undefined;
```

Forma do retorno de `toJSON()` (tipo anônimo, sem novo nome público):

```ts
Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"] & {
  type: string;        // type informado ou "about:blank" (sempre "about:blank" se unhandled)
  title: string;       // statusText || getStatusText(status) || "HTTPError"
  status: number;
  detail: string | undefined; // this.message; undefined se unhandled
  instance: string | undefined; // undefined se ausente ou unhandled
}
```

Exemplo, `new HTTPError({ status: 422, message: "inválido", data: { campo: "nome" }, body: { codigo: "E42" } })`:

```json
{ "message": "inválido", "data": { "campo": "nome" }, "codigo": "E42",
  "type": "about:blank", "title": "Unprocessable Content", "status": 422, "detail": "inválido" }
```

Resposta HTTP: mesmo `status` e `statusText` de hoje; `content-type: application/problem+json`; headers de `error.headers`/`errHeaders` mesclados após o content-type padrão.

## 5. Estratégia de testes

Tudo em `test/errors.test.ts` com `describeMatrix` (web e node). Regressão e novos testes, um por requisito:

1. **RF-01 (regressão, falha antes da mudança):** handler lança `new HTTPError({ status: 400 })`; `status === 400` e `content-type` começa com `application/problem+json`. Confirmar a falha antes de implementar (fluxo "Bug Fix Workflow" do `AGENTS.md`). Variantes: 404 por rota inexistente, `throw 404`, erro desconhecido e erro de middleware.
2. **RF-02:** `HTTPError({ status: 404, message: "Usuário não existe" })` → `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail`, sem `instance` (`not.toHaveProperty("instance")`). Casos de `title`: com `statusText` próprio, status sem texto padrão (ex.: 599 → `"HTTPError"`).
3. **RF-03:** `type`/`instance` informados aparecem em `error.type`, `error.instance` (capturar o erro por `onError`) e no corpo; também via `HTTPError.status(409, undefined, { type, instance })` e `new HTTPError("msg", { status, type })`.
4. **RF-04:** corpo mantém `message`, `statusText`, `data` e chaves de `body`; `body: { type: "x", title: "x", status: 1, detail: "x", instance: "x" }` não sobrescreve os membros do `HTTPError`; `toJSON()` direto retorna o mesmo formato.
5. **RF-05:** `throw new Error("segredo interno")` sem debug → 500, `title: "Internal Server Error"`, `type: "about:blank"`, sem `detail`, sem `stack`, texto "segredo interno" ausente de `JSON.stringify` do corpo. Com `unhandled: true` e `type`/`instance` informados, eles não saem. Com `debug: true`, `stack` presente.
6. **RF-06:** `www-authenticate` preservado, 401, `content-type` problem+json; header `content-type` custom em `error.headers` prevalece; `statusText` HTTP inalterado.
7. **Unitário** de `getStatusText` em `test/unit/` (códigos comuns, código desconhecido → `undefined`).

Verificação final: `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`. Conferir se os testes de tipo (`test/unit/types.test-d.ts`) continuam passando com os campos novos.

## 6. Riscos

- **Content-type exato:** clientes que comparam `application/json` por igualdade quebram. É inerente ao pedido; registrar nas notas de versão e na documentação. `response.json()` segue funcionando.
- **`toMatch` por substring:** testes ou código que usam `includes("application/json")` deixam de casar com `application/problem+json`. Mitigação: busca textual no repositório e execução completa da suíte (D-08).
- **Colisão `type`/`instance`/`title`/`detail` em `body` ou `data`:** precedência dos campos do `HTTPError` (D-05). `data` fica isolada sob a chave `data`, sem colisão.
- **Vazamento em erros não tratados:** `detail`, `type` e `instance` omitidos/fixos (D-06); teste dedicado.
- **`title` vindo de `statusText` de usuário:** já sanitizado por `sanitizeStatusMessage` (`src/error.ts:180`), mas pode ser longo; sem limite novo, comportamento igual ao header atual.
- **Tabela de status desatualizada ou divergente** da RFC 9110: mitigado por teste unitário e por usar só nomes atuais da RFC.
- **`isolatedDeclarations`:** `toJSON()` precisa de tipo de retorno explícito (inline); um tipo nomeado exportado violaria "nenhum nome público novo".
- **Conflito do pedido** (formato padrão × não quebrar): resolvido mantendo campos legados como extensões (RF-04), decisão herdada do PRD.
- **`onError` com resposta própria:** não recebe o formato automaticamente; é comportamento esperado e fica documentado.
