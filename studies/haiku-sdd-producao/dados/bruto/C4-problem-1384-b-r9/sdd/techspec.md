# Especificação técnica — Erros em formato problem details (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-09), issue h3js/h3#1384.

Esta especificação foi conferida contra o código em `C:\dev\runs\r9d57487ea4`. As linhas citadas são do estado atual do repositório, antes da mudança.

## Visão geral

Hoje, toda resposta de erro passa por `errorResponse()` em `src/response.ts:358`, que monta o corpo com `HTTPError.toJSON()` (`src/error.ts:226`) e envia `Content-Type: application/json;charset=UTF-8` (vindo de `jsonHeaders`, `src/response.ts:270`). A mudança fica concentrada em três pontos:

1. `HTTPError` aceita e expõe `type` e `instance` (`src/error.ts`).
2. `toJSON()` passa a emitir os membros padrão da RFC 9457 (`type`, `title`, `status`, `detail`, `instance`) junto dos campos legados.
3. `errorResponse()` troca o `Content-Type` padrão de erro para `application/problem+json`.

Não há opção nova, gatilho novo nem export novo (RF-08). O formato vale para todos os caminhos que chegam a `errorResponse()`: `HTTPError` lançado ou retornado, erro comum (vira 500 não tratado), `throw` de número, e `kNotFound` (404).

---

## Decisões de arquitetura

### D-01 — Formato fixo, sem negociação por `Accept`

**Escolha:** todo erro gerado pelo h3 responde `application/problem+json`. Não há negociação por `Accept` e não há opção de configuração.

**Alternativas consideradas:**
- Negociar por `Accept` (problem+json só se o cliente pedir, JSON simples no resto). Descartado: o PRD (seção "Fora de escopo") e o contrato excluem isso, e exigiria uma opção ou uma lógica nova de conteúdo.
- Opção `errorFormat` em `H3Config`. Descartado: RF-08 proíbe opção nova.

**Justificativa:** é o caminho de menor superfície. Basta trocar um cabeçalho padrão e um corpo, sem nova API.

### D-02 — `HTTPError.toJSON()` como fonte única do corpo

**Escolha:** os membros RFC são montados em `toJSON()` (`src/error.ts:226`). `errorResponse()` continua só fazendo `JSON.stringify` e acrescentando `stack` em modo debug.

**Alternativas consideradas:**
- Montar o corpo RFC dentro de `errorResponse()` (`src/response.ts:358`) e deixar `toJSON()` como está. Descartado: duas fontes de verdade. `JSON.stringify(err)` e o `toJSON` usado pelos testes divergiriam.

**Efeito colateral aceito:** `JSON.stringify(new HTTPError(...))` em código do usuário passa a incluir `type`, `title`, `detail` e `instance`. Isso é consistente com o formato e é listado em Riscos.

### D-03 — Precedência entre membros RFC e `body`

**Problema:** hoje `toJSON()` espalha `this.body` por último (`src/error.ts:234`), então `body: { status: 999 }` sobrescreve o `status` real. Com os membros RFC, isso faria o corpo dizer um status diferente do status HTTP.

**Escolha:** os membros RFC (`type`, `title`, `status`, `detail`, `instance`) são colocados depois do espalhamento de `body`. Os campos legados (`statusText`, `unhandled`, `message`, `data`) mantêm a ordem atual, para não mudar o comportamento de quem já usa `body` para sobrescrever `message` ou `data`.

**Alternativas consideradas:**
- Manter `body` por último para tudo. Descartado: permite que `body` falsifique `status` e `type`, o que contraria a RFC.
- Colocar `body` antes de tudo. Descartado: muda o comportamento de `message` e `data` sem necessidade.

**Mudança de comportamento:** `body` com chave `status`, `type`, `title`, `detail` ou `instance` deixa de sobrescrever o membro RFC. Caso raro e incorreto hoje; fica documentado em Riscos.

### D-04 — `Content-Type` e headers do usuário (RF-07)

**Escolha:** o `Content-Type` padrão é `application/problem+json`. Se o usuário passar `Content-Type` em `HTTPError.headers`, ou se `event.res.errHeaders` trouxer um, esse valor vence, como já acontece hoje com `mergeHeaders(jsonHeaders, error.headers)` (`src/response.ts:360`). Não há sobrescrita silenciosa, porque a intenção explícita do usuário prevalece.

**Alternativas consideradas:**
- Forçar `application/problem+json` sempre. Descartado: impede um handler de escolher o tipo de erro quando precisa, e quebra o que já funciona.

**Documentação:** a regra entra em `docs/1.guide/1.basics/6.error.md`, junto da nota sobre o novo formato (PRD, seção "Fora de escopo").

### D-05 — Frase padrão do `title` vem de uma tabela interna nova

**Problema:** RF-02 pede a frase padrão do status quando `statusText` está ausente. A tabela `STATUS_TEXT` de `src/utils/response.ts:347` cobre só 204 e 301/302/303/307/308. Ela é restrita de propósito (o comentário na linha 346 diz que outros status "não recebem frase"), então não serve para 404 ou 500.

**Alternativas consideradas:**
- Reusar e ampliar `STATUS_TEXT`. Descartado: `noContent()` e `redirect()` (`src/utils/response.ts:44` e `:79`) dependem da restrição atual.
- `http.STATUS_CODES` do Node. Descartado: AGENTS.md pede APIs web padrão e suporte multi-runtime (Workers, Deno, Bun, browsers).

**Escolha:** novo módulo interno `src/utils/internal/status.ts`, com a tabela de frases registradas no RFC 9110 para os códigos de erro, e uma função `getStatusPhrase(status)` que devolve `undefined` quando não há frase. Esse módulo não é exportado por `src/index.ts`. `STATUS_TEXT` em `src/utils/response.ts` não muda.

**Duplicação aceita:** há duas tabelas de frases no código. A alternativa de unificar exige revisar `noContent` e `redirect`, o que fica fora deste escopo. Registrado em Riscos.

### D-06 — `type` e `instance` não são herdados de `cause`

**Escolha:** `type` e `instance` são lidos só de `details` (a entrada do construtor). Diferente de `status`, `statusText` e `unhandled`, que herdam de `cause` (`src/error.ts:173-184` e `:205-206`).

**Justificativa:** `cause` pode ser um erro de qualquer origem (um driver, um fetch client). Herdar `instance` dele poderia vazar uma URL interna no corpo. O contrato do PRD também fala apenas do objeto de entrada.

### D-07 — Erros não tratados: mesmo esquema, sem conteúdo original (RF-05, RF-06)

**Escolha:** para `unhandled: true`, `message` e `detail` valem `"HTTPError"`, `data` é omitido e o corpo legado (`body`) não é espalhado, como hoje (`src/error.ts:232-234`). `title` usa a frase padrão, porque `statusText` é indefinido nesses erros. `type` e `instance` seguem a regra normal, pois vêm só do app (D-06).

**Por que não gerar `detail` a partir de `cause`:** o contrato proíbe. O texto de `new Error("segredo do banco")` nunca entra no corpo.

### D-08 — `onError` que retorna objeto não é coberto

**Escolha:** se o hook `onError` retornar um valor que não é `Response`, o h3 serializa esse valor como antes, com `application/json`. Essa resposta é do usuário, não um erro gerado pelo h3.

**Alternativas consideradas:**
- Forçar `problem+json` em qualquer valor retornado por `onError`. Descartado: sobrescreveria respostas que o usuário montou de propósito.

**Documentação:** registrar a exceção em `docs/1.guide/1.basics/6.error.md`.

### D-09 — Mudança observável sem nova versão nesta especificação

**Escolha:** esta especificação implementa o que o PRD assume (RF-01 aceito, compatibilidade pelos campos legados). Pela restrição do PRD (risco 2), mudar o `Content-Type` padrão pode justificar versão maior. Essa decisão é de quem aprova a release e não muda o código. **Pendente de confirmação** antes de publicar.

---

## Arquivos a alterar

| Arquivo | Linhas atuais | Mudança |
|---|---|---|
| `src/error.ts` | `:6-26` (`ErrorInput`), `:82-119` (campos), `:162-210` (construtor), `:226-236` (`toJSON`) | Adicionar `type` e `instance` em `ErrorInput`, campos `readonly` em `HTTPError`, lê-los no construtor (sem herança de `cause`, D-06) e montar os membros RFC em `toJSON` com a ordem de D-03. |
| `src/response.ts` | `:260` (`FrozenHeaders`), `:270-272` (`jsonHeaders`), `:358-380` (`errorResponse`) | Criar `problemHeaders` com `application/problem+json` logo após a classe `FrozenHeaders`, e usá-lo em `errorResponse`. `jsonHeaders` continua para respostas JSON comuns. |
| `src/utils/internal/status.ts` | (novo) | Tabela de frases RFC 9110 e `getStatusPhrase(status)` (D-05). |
| `src/utils/internal/status.ts` consumido por `src/error.ts` | — | `toJSON` usa `getStatusPhrase` para `title` quando `statusText` está ausente. |
| `test/errors.test.ts` | `:44`, `:140` | Ajustar os dois `content-type` para `application/problem+json`. Ver Estratégia de testes. |
| `docs/1.guide/1.basics/6.error.md` | exemplo JSON em torno das linhas 37-50; nota em `:90` | Atualizar o exemplo de resposta, documentar `type` e `instance` e registrar D-04 e D-08. |

Não alterar `src/index.ts` (RF-08). A linha `src/index.ts:72` continua exportando `HTTPError` e os tipos já existentes.

Não alterar `src/utils/json-rpc.ts`. Ele tem o próprio mapeamento de erro (`:479-488`) e o protocolo JSON-RPC não usa `errorResponse`. Ver Riscos sobre os erros HTTP 403, 405 e 415 que esse módulo lança.

---

## Contratos e assinaturas

### `src/error.ts`

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  cause?: unknown;
  headers?: HeadersInit;
  statusCode?: number;   // @deprecated
  statusMessage?: string; // @deprecated

  /** URI reference que identifica o tipo do problema (RFC 9457). Padrão no corpo: "about:blank". */
  type?: string;
  /** URI reference da ocorrência do problema (RFC 9457). Ausente do corpo quando não informado. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** Tipo do problema (RFC 9457). `undefined` quando não informado. */
  readonly type: string | undefined;
  /** Ocorrência do problema (RFC 9457). `undefined` quando não informado. */
  readonly instance: string | undefined;

  // construtor e demais membros: assinaturas inalteradas

  toJSON(): Record<string, unknown>;
}
```

Corpo produzido por `toJSON()` (ordem de chaves, de D-03):

```ts
{
  // legado, na ordem atual (espalhamento de body fica depois de statusText/unhandled/message/data)
  statusText,            // this.statusText
  unhandled,             // this.unhandled
  message,               // unhandled ? "HTTPError" : this.message
  data,                  // unhandled ? undefined : this.data
  ...(unhandled ? undefined : this.body),

  // RFC 9457, por último: sempre refletem o erro (D-03)
  type: this.type ?? "about:blank",
  title: this.statusText ?? getStatusPhrase(this.status),  // ausente quando não há frase (D-05)
  status: this.status,
  detail: unhandled ? "HTTPError" : this.message,
  instance: this.instance,  // ausente do JSON quando undefined
}
```

Observação de implementação: `title` deve ser omitido quando `getStatusPhrase` devolve `undefined` e `statusText` é ausente. `JSON.stringify` já descarta chaves `undefined`, então basta deixar o valor `undefined`. Quando `unhandled` é verdadeiro e `statusText` não foi informado, `title` vem da frase padrão (D-07).

### `src/utils/internal/status.ts`

```ts
/** Frase padrão (RFC 9110) do status, ou `undefined` quando o código não tem frase registrada. */
export function getStatusPhrase(status: number): string | undefined;
```

Não exportado por `src/index.ts`. Documentar no próprio arquivo, pois é helper interno.

### `src/response.ts`

```ts
// depois de `class FrozenHeaders`
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

// assinatura inalterada; usa problemHeaders no lugar de jsonHeaders
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
```

Sem alteração em `toError` (`:73`), `prepareResponse` (`:129`) nem em `mergeHeaders` (`:243`).

### Nomes públicos

Nenhum novo símbolo exportado. Os únicos acréscimos públicos são `HTTPError.type` e `HTTPError.instance` e os campos correspondentes em `ErrorInput` (RF-08). O snapshot de exports em `test/unit/package.test.ts:4-6` deve continuar igual.

---

## Estratégia de testes

Seguir o Bug Fix Workflow do AGENTS.md: primeiro os testes novos, vendo-os falhar, depois a implementação.

Todos os testes novos ficam em `test/errors.test.ts`, dentro de `describeMatrix` (cobrem web e node). Usar `t.app`, `t.fetch` e `t.errors`, e limpar `t.errors = []` quando o teste gera erro não tratado, como os testes atuais fazem (ex.: `test/errors.test.ts:114-116`).

Casos novos, um por requisito:

1. **RF-01:** `new HTTPError({ status: 404 })` → status 404 e `content-type` igual a `application/problem+json`. Também em HEAD (cabeçalho presente, corpo vazio).
2. **RF-02:** `new HTTPError("Usuário não encontrado", { status: 404, statusText: "Not Found" })` → `type` "about:blank", `title` "Not Found", `status` 404, `detail` "Usuário não encontrado".
3. **RF-02, frase padrão:** `new HTTPError({ status: 404 })` → `title` "Not Found". Um status sem frase registrada (ex.: 599) → chave `title` ausente.
4. **RF-03:** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` → propriedades da instância e JSON com os mesmos valores. Também: sem `instance`, a chave não aparece (`"instance" in body` é `false`). E: `type` e `instance` não são herdados de `cause`.
5. **RF-04:** `{ status: 400, message: "inválido", data: { campo: "email" }, body: { codigo: "E01" } }` → `message`, `data` e `codigo` presentes, além dos membros RFC.
6. **D-03, precedência:** `body: { status: 999, type: "x", detail: "y" }` → `status` continua 400 e `type` "about:blank".
7. **RF-05:** `throw new Error("segredo do banco")` dentro de uma rota → corpo não contém "segredo do banco", `detail` e `message` valem "HTTPError", `data` ausente. Este é teste de regressão, e deve existir antes da mudança para ser comparado com o comportamento atual.
8. **RF-06:** `throw new TypeError("x is undefined")` → 500, `content-type` problem+json, corpo sem "x is undefined".
9. **RF-07:** `headers: { "Retry-After": "120" }` → header presente e `content-type` problem+json. Também: `headers: { "content-type": "text/plain" }` → o valor do usuário vence (D-04).
10. **Compatibilidade:** os testes atuais que verificam `statusText`, `data`, `message`, `unhandled` e `body` (`test/errors.test.ts:67-122`, `:124-150`, `test/app.test.ts:198-205`, `test/body.test.ts:450-457`) continuam verdes sem alteração.

Ajustes em testes existentes (somente os pontos que a mudança altera):
- `test/errors.test.ts:44`: `application/json;charset=UTF-8` → `application/problem+json`.
- `test/errors.test.ts:140`: `toMatch("application/json")` → `toMatch("application/problem+json")`. A string nova não contém a antiga como substring, então o teste falharia.

Verificação final, nesta ordem:
- `pnpm vitest run test/errors.test.ts`
- `pnpm vitest run test/unit/package.test.ts` (snapshot de exports, RF-08)
- `pnpm vitest run` (suíte completa, para pegar regressões em `json-rpc`, `validate`, `body-limit` e `rules`)
- `pnpm lint` e `pnpm typecheck`

Verificação de tipos: o contrato usa `isolatedDeclarations`, então `toJSON` precisa do tipo de retorno explícito, e `type` e `instance` precisam ser anotados no campo.

---

## Riscos

1. **Mudança de `Content-Type` (PRD risco 1 e 2).** Clientes que comparam `content-type` com `application/json` vão falhar. Não há como mitigar sem opção nova, que o PRD proíbe. Depende de confirmação e possivelmente de versão maior (D-09).
2. **Precedência com `body` (D-03).** `body` com `status`, `type`, `title`, `detail` ou `instance` deixa de sobrescrever. É uma correção, mas é mudança observável. Documentar no changelog.
3. **`JSON.stringify(err)` muda.** Como `toJSON` é usado pelo `JSON.stringify` de código do usuário, a saída ganha os membros RFC. Efeito aceito (D-02), mas pode aparecer em logs que serializam erros.
4. **Duas tabelas de frases (D-05).** Manter `STATUS_TEXT` e a nova tabela em paralelo é duplicação. Aceitável nesta entrega; unificar depois, com cuidado em `noContent` e `redirect`.
5. **`title` ausente para status sem frase.** RFC 9457 torna `title` opcional, então o corpo fica sem a chave. Se o contrato exigir `title` sempre, o fallback precisa ser decidido antes da implementação.
6. **Vazamento em erros não tratados (PRD risco 4).** `title` deriva de `statusText` do app ou da tabela, nunca de `cause`. `detail` nunca recebe `cause.message`. RF-05 e RF-06 são os testes de regressão para isso.
7. **Erros HTTP de `json-rpc` (`src/utils/json-rpc.ts`).** Os `throw new HTTPError({ status: 403 | 405 | 415 })` (`:168`, `:176`, `:235`) passam por `errorResponse`, então ganham `application/problem+json`. Os testes de `test/json-rpc.test.ts` não foram lidos em detalhe nesta especificação. Verificar na suíte completa antes de fechar.
8. **`type` não é validado como URI.** A RFC pede URI reference. O h3 aceita qualquer string, como faz com `statusText`. Risco baixo, mas registrado.
9. **`onError` que retorna objeto (D-08).** Continua `application/json`. Não é erro gerado pelo h3, mas pode surpreender quem espera o formato em todos os erros. Documentar.
10. **Exemplos e documentação.** `examples/errors.mjs` usa `createError` com `statusMessage`, que continua funcionando e não muda de corpo na prática. O exemplo JSON de `docs/1.guide/1.basics/6.error.md` fica desatualizado e precisa ser trocado.
