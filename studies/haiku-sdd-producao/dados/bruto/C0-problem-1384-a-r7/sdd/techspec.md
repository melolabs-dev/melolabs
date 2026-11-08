# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-10). Todas as citações `arquivo:linha` foram conferidas no código atual (commit `a599308`).

## 1. Estado atual (resumo verificado)

- Erros são renderizados por `errorResponse(error, debug, errHeaders)` em `src/response.ts:358`. Ela monta os cabeçalhos a partir de `jsonHeaders` (`src/response.ts:270`), mescla `error.headers` e `errHeaders` com `mergeHeaders` (`src/response.ts:243`) e serializa `{ ...error.toJSON(), stack }`, com indentação 2 em debug (`src/response.ts:365-379`).
- A única chamada está em `prepareResponse`, `src/response.ts:173` (`val = errorResponse(error, config.debug, errHeaders)`). `config` (`H3Config`) já está em escopo nessa função (`src/response.ts:129-134`), e vem de `this.config` em `src/h3.ts:99`.
- `onError` roda antes (`src/response.ts:159-166`). O valor devolvido volta por `prepareResponse(..., nested = true)`, então o novo formato vale também quando `onError` devolve um `Error`, e uma `Response` própria continua tendo precedência (RF-09).
- `HTTPError` (`src/error.ts:74`) lê `status`/`statusText`/`headers`/`unhandled` do próprio input ou de `cause` (`src/error.ts:172-206`) e guarda `data`/`body` em `src/error.ts:208-209`. `toJSON()` (`src/error.ts:226-236`) mascara `message`, `data` e `body` quando `unhandled`.
- `ErrorInput` estende `Partial<ErrorBody>` (`src/error.ts:6`) e `ErrorBody` está em `src/error.ts:30-69`; `HTTPError implements ErrorBody` (`src/error.ts:74`).
- `H3Config` está em `src/types/h3.ts:28-53`.
- A `STATUS_TEXT` de `src/utils/response.ts:347` só cobre 204 e 3xx e é local do módulo. Não serve para `title`.
- Erros do framework (rota não encontrada) passam pelo mesmo caminho: `kNotFound` vira `HTTPError` 404 em `src/response.ts:139-144`.
- Fora do caminho de `errorResponse`: JSON-RPC e WebSocket (`src/utils/json-rpc.ts:483`) têm formato próprio e ficam intocados (PRD §3).

## 2. Decisões de arquitetura

### D-01 — Conversão para problem details em `errorResponse`, com `toJSON()` legado intacto

- **Alternativas**
  - (a) Alterar `HTTPError.toJSON()` para devolver problem details.
  - (b) Adicionar um método público novo em `HTTPError`.
  - (c) Converter na renderização, dentro de `errorResponse`.
- **Escolha: (c).**
  - (a) mudaria o formato de todos os consumidores de `toJSON()` (testes e usuários), contra "não quebrar o que existe".
  - (b) cria nome público novo, vetado pelo contrato.
  - Em (c), `toJSON()` fica byte a byte igual, o que garante RF-01 e a métrica "sem a opção, nada muda".
- **Consequência:** `toJSON()` **não** passa a incluir `type`/`instance`. No modo legado esses dois campos ficam só na instância. Isso difere da sugestão do PRD §4 ("incluir só quando definidos"). Escolhi não incluí-los porque o PRD também exige respostas byte a byte iguais sem a opção, e a RFC só pede esses membros no formato novo.

### D-02 — `errorResponse` recebe `config` em vez de `debug`

- **Alternativas**
  - (a) Acrescentar um 4º parâmetro booleano `problemDetails`.
  - (b) Ler a config de estado global ou módulo.
  - (c) Trocar `debug?: boolean` por `config: H3Config`.
- **Escolha: (c).**
  - Mantém a config lida de `app.config` na renderização, sem estado global (PRD §4, premissa 1).
  - Evita lista crescente de booleanos.
  - A função não é exportada, então a mudança de assinatura é interna.
- A chamada em `src/response.ts:173` passa a ser `errorResponse(error, config, errHeaders)`.

### D-03 — Montagem do corpo em helper interno novo, `src/utils/internal/problem-details.ts`

- **Alternativas**
  - (a) Inline em `errorResponse`.
  - (b) Helper interno exportado só para uso do projeto, sem entrar em `src/index.ts`.
- **Escolha: (b).**
  - `src/response.ts` já tem 380 linhas, e o projeto pede arquivos curtos e helpers internos em `utils/internal/`.
  - Nenhum export em `src/index.ts` (`src/index.ts:68` fica igual).
  - Sem barrel: `response.ts` importa direto do arquivo, com extensão `.ts`.
- O arquivo contém a tabela de frases e a função de montagem (seção 3).

### D-04 — Tabela própria e determinística de frases de status (RFC 9110)

- **Alternativas**
  - (a) Reaproveitar `STATUS_TEXT` de `src/utils/response.ts:347`.
  - (b) Usar `Response`/runtime para obter a frase.
  - (c) Tabela nova no helper.
- **Escolha: (c).**
  - (a) cobre só 204/3xx, e ampliá-la mudaria `noContent`/`redirect` (`src/utils/response.ts:44`, `:79`), que usam `STATUS_TEXT[status]` e hoje devolvem `undefined` para os demais.
  - (b) varia entre `web` e `node` (PRD §4).
- A tabela cobre 4xx e 5xx (e os 1xx/2xx/3xx comuns), por exemplo 400 "Bad Request", 404 "Not Found", 422 "Unprocessable Content", 500 "Internal Server Error". Status sem frase conhecida resulta em `title: ""`, como o PRD aceita.
- `title = error.statusText || TABELA[status] || ""`.
- Para `unhandled`, `title` é sempre a frase padrão do status, não o `statusText` (RF-07). Um `statusText` de erro desconhecido não deve vazar.

### D-05 — Ordem de montagem e precedência de membros

O corpo é construído nesta ordem, e **os membros padrão vêm por último e vencem as extensões** (RF-06):

1. Extensões: `...error.body` (apenas se não `unhandled`) e `data` (já mascarado pelo `toJSON()`).
2. Membros padrão: `type`, `title`, `status`, `detail`, `instance`.
3. `stack` (somente em `debug` e se houver stack).

- `body: { type: "x" }` não sobrescreve `type`, que vem do campo direto ou de `"about:blank"`.
- `body: { title }`, `{ status }`, `{ detail }` e `{ instance }` também são descartados em favor dos membros padrão.
- `detail` vem de `error.toJSON().message`, reutilizando o mascaramento (para `unhandled` resulta em `"HTTPError"`, nunca na mensagem original).
- `data` vem de `toJSON().data`, que já é `undefined` para `unhandled`.
- `instance` é omitido quando ausente (chave inexistente, não `null`).
- Chaves legadas (`statusText`, `unhandled`, `message`) **não** entram no corpo novo.
- O `JSON.stringify` com `undefined` descarta as chaves vazias, como hoje.

### D-06 — `type`/`instance` ignorados em erros `unhandled`

- **Problema:** o construtor lê campos de `cause`, e para um `Error` qualquer (`new HTTPError(val)` em `src/response.ts:148`) `val.type` poderia ser um valor interno. Exemplo: erros de bibliotecas com propriedade `type`.
- **Alternativas**
  - (a) Expor `type`/`instance` sempre.
  - (b) Não ler de `cause`.
  - (c) Ler de `cause` como `status` e `headers`, mas ignorar na renderização quando `unhandled`.
- **Escolha: (c).**
  - Mantém consistência com o construtor atual (RF-04).
  - Fecha o vazamento (RF-07).
  - Em erro `unhandled`, `type` = `"about:blank"` e sem `instance`.
- Validação: apenas `typeof === "string"` (PRD §4). Valor não string vira `undefined` na instância, para não quebrar a tipagem `string | undefined`.

### D-07 — Content-Type `application/problem+json;charset=UTF-8`

- **Alternativas**
  - (a) Mutar `jsonHeaders`.
  - (b) Criar um segundo `FrozenHeaders`.
- **Escolha: (b).**
  - `jsonHeaders` é compartilhado e congelado (`src/response.ts:260-272`).
  - O novo `problemHeaders` mantém o charset de `jsonHeaders`, como o RF-03 exige.
  - Fica em `src/response.ts`, ao lado de `jsonHeaders`, porque `FrozenHeaders` é local dali.
- A mescla continua igual: `mergeHeaders(base, error.headers)` e depois `errHeaders`. Quem definir `content-type` no erro continua sobrescrevendo, como hoje.

### D-08 — `type` e `instance` em `ErrorBody`, e não só em `ErrorInput`

- **Alternativas**
  - (a) Adicionar só a `ErrorInput`.
  - (b) Adicionar a `ErrorBody`, que `ErrorInput` herda por `Partial<ErrorBody>` (`src/error.ts:6`).
- **Escolha: (b).**
  - O PRD (RF-04) cita `ErrorInput`/`ErrorBody`.
  - `HTTPError implements ErrorBody` passa a exigir as propriedades, que a classe declara de qualquer forma.
  - Tipos: `type?: string` e `instance?: string` em `ErrorBody`; `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`.
- **Efeito colateral de tipos:** `toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]` (`src/error.ts:226`) passa a admitir `type`/`instance` opcionais no tipo de retorno, sem alterar o valor retornado. Isso é aceitável e não exige mudar a assinatura.

### D-09 — Opção `problemDetails` booleana em `H3Config`, sem normalização

- **Alternativas**
  - (a) Aceitar objeto de configuração (`{ type, ... }`).
  - (b) Apenas booleano.
- **Escolha: (b).**
  - O contrato diz "opção booleana".
  - Sem nome público adicional.
  - Lida na renderização como `config.problemDetails` (truthy), como `debug`.

## 3. Arquivos a alterar e contratos

### 3.1 `src/types/h3.ts` (RF-01)

Inserir após `debug` (`src/types/h3.ts:30-32`), na interface `H3Config` (`src/types/h3.ts:28`):

```ts
  /**
   * When enabled, error responses follow RFC 9457 (Problem Details for HTTP APIs) and use
   * the `application/problem+json` content type. Disabled by default.
   */
  problemDetails?: boolean;
```

`H3CoreConfig` (`src/types/h3.ts:55`) herda sem mudança.

### 3.2 `src/error.ts` (RF-04)

- `ErrorBody` (`src/error.ts:30-69`): acrescentar após `message`/`unhandled`:

  ```ts
  /** RFC 9457 problem `type` URI reference (only used when `problemDetails` is enabled). */
  type?: string;
  /** RFC 9457 problem `instance` URI reference (only used when `problemDetails` is enabled). */
  instance?: string;
  ```

- `HTTPError` (`src/error.ts:74`): campos `readonly type: string | undefined;` e `readonly instance: string | undefined;`, declarados junto de `body` (`src/error.ts:112`).
- Construtor: depois de `this.body = ...` (`src/error.ts:209`), atribuir lendo do input e de `cause`, no padrão de `headers` (`src/error.ts:202`) e `unhandled` (`src/error.ts:205-206`):

  ```ts
  const type = (details as ErrorBody)?.type ?? (details?.cause as ErrorBody)?.type;
  this.type = typeof type === "string" ? type : undefined;
  // idem para instance
  ```

- `toJSON()` (`src/error.ts:226-236`): sem alteração (D-01).
- A mensagem do erro e o cálculo de `status`/`statusText` (`src/error.ts:172-193`) não mudam.

### 3.3 `src/utils/internal/problem-details.ts` (novo, não exportado)

```ts
import type { HTTPError } from "../../error.ts";

/** Build the RFC 9457 JSON body of an error; standard members win over extensions. */
export function problemDetailsBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Comportamento:

- `const legacy = error.toJSON()` fornece `message` e `data` já mascarados.
- `const unhandled = !!error.unhandled`.
- Retorna `{ ...(unhandled ? undefined : error.body), data: legacy.data, type: (!unhandled && error.type) || "about:blank", title: (!unhandled && error.statusText) || STATUS_PHRASES[error.status] || "", status: error.status, detail: legacy.message, instance: unhandled ? undefined : error.instance, stack }`.
- `stack` segue a regra atual: `debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined`, mantida idêntica à de `src/response.ts:369`. Para evitar duplicar a lógica, o cálculo pode ficar no helper e `errorResponse` legado manter o seu (duas linhas).
- A tabela `STATUS_PHRASES: Record<number, string>` é interna ao arquivo, com `/* @__PURE__ */` desnecessário (é um literal).
- Tamanho esperado: abaixo de 100 linhas.

### 3.4 `src/response.ts` (RF-02, RF-03, RF-05, RF-07, RF-08, RF-09)

- Importar `problemDetailsBody` do helper (junto dos imports em `src/response.ts:1-8`).
- `src/response.ts:173`: `val = errorResponse(error, config, errHeaders);`
- `src/response.ts:270`: manter `jsonHeaders` e acrescentar logo abaixo:

  ```ts
  const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
    "content-type": "application/problem+json;charset=UTF-8",
  });
  ```

- `src/response.ts:358-380` (`errorResponse`):

  ```ts
  function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response {
    const { debug, problemDetails } = config;
    const base = problemDetails ? problemHeaders : jsonHeaders;
    let headers: Headers = error.headers ? mergeHeaders(base, error.headers) : new Headers(base);
    if (errHeaders) headers = mergeHeaders(headers, errHeaders);
    const body = problemDetails
      ? problemDetailsBody(error, debug)
      : { ...error.toJSON(), stack: /* igual a hoje */ };
    return new FastResponse(JSON.stringify(body, undefined, debug ? 2 : undefined), {
      status: error.status,
      statusText: error.statusText,
      headers,
    });
  }
  ```

  O ramo legado produz exatamente o mesmo corpo e cabeçalhos de hoje.

- `statusText` da resposta HTTP continua sendo `error.statusText`, como hoje.

### 3.5 Documentação (RF-10)

- `docs/1.guide/900.api/1.h3.md:111`: nova linha em "Supported options" descrevendo `problemDetails`, com nota sobre `application/problem+json`.
- `docs/1.guide/1.basics/6.error.md:51-60` (`HTTPError Fields`): adicionar `type` e `instance`.
- `docs/1.guide/1.basics/6.error.md`: nova subseção curta "Problem Details (RFC 9457)" antes de "Unhandled Errors" (`:78`), com exemplo de config e corpo de saída, a regra de precedência (membros padrão vencem `body`) e a nota de que `unhandled` ignora `type`/`instance`/`statusText`.

## 4. Estratégia de testes

Convenções do projeto: `describeMatrix` (modos `web` e `node`), `ctx.app` novo por teste.

- **Setup:** `test/_setup.ts:135` cria o app com `debug: true`. Nos testes novos, ligar a opção por `ctx.app.config.problemDetails = true` (e `ctx.app.config.debug = false` quando o caso exigir) em um `beforeEach` local. Se `config` não se mostrar mutável nessa versão, criar o app com `new H3({...})` local em vez disso, sem tocar em `_setup.ts`. A mutabilidade de `app.config` será confirmada no início da implementação.
- **Integração, `test/problem-details.test.ts` (novo, `describeMatrix`)**
  - RF-01: sem a opção, `HTTPError.status(404)` dá `application/json`, com `status` e `statusText`, sem `title` nem `type`.
  - RF-02: `403` com `statusText`/`message` dá `type: "about:blank"`, `title: "Forbidden"`, `status: 403`, `detail: "Sem permissão"`. Também `title` caindo na tabela quando não há `statusText`.
  - RF-03: `content-type` começa com `application/problem+json`; `x-custom: 1` preservado; teste adicional de `event.res.errHeaders`.
  - RF-05: `type`/`instance` informados aparecem; ausentes dão `about:blank` e sem a chave `instance` (`"instance" in body === false`).
  - RF-06: `data` e `body: { code }` preservados; `body: { type: "x", title: "y" }` não sobrescreve os membros padrão.
  - RF-07: `throw new Error("segredo interno")` com `debug` desligado: 500, `application/problem+json`, corpo sem a string `segredo interno` e sem `stack`. Variante com `cause` carregando `type: "interno"`, que não deve aparecer (D-06).
  - RF-08: rota inexistente com `debug: true` dá 404, `title: "Not Found"` e `stack`; com `debug` desligado, sem `stack`.
  - RF-09: `onError` devolvendo uma `Response` própria é o que o cliente recebe; `onError` devolvendo um `HTTPError` novo sai em problem details.
- **Unitários, `test/unit/error.test.ts` (novo)**
  - RF-04: `type`/`instance` lidos do input; `undefined` quando ausentes; herdados de `cause`; valor não string vira `undefined`.
  - `toJSON()` inalterado: com `type`/`instance` informados, o JSON não ganha essas chaves.
- **Tipos:** um caso em `test/unit/types.test-d.ts` para `H3Config.problemDetails` e `ErrorInput.type`/`instance`.
- **Regressão:** `pnpm vitest run` completo (inclui `test/errors.test.ts`, `test/security.test.ts`, `test/json-rpc.test.ts`), `pnpm lint` e `pnpm typecheck`. Nenhum teste existente deve precisar de ajuste, pois `toJSON()` e o ramo legado não mudam. Se algum quebrar, será ajustado preservando o que verifica (RF-09).
- Fluxo da correção (AGENTS.md): escrever primeiro os testes e confirmar que falham antes da implementação.

## 5. Riscos

| Risco                                                                                     | Mitigação                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Vazamento em `unhandled` pelos campos lidos de `cause` (`type`, `instance`, `statusText`) | D-04 e D-06: `unhandled` usa `about:blank`, frase padrão e sem `instance`; teste dedicado em RF-07                 |
| Colisão entre `body` do usuário e membros padrão                                          | D-05: padrão por último; testes com `body: { type, title }`                                                        |
| Divergência entre este plano e o PRD §4 sobre `toJSON()` incluir `type`/`instance`        | D-01 registra a escolha (não incluir) e o motivo; revisar se o PRD exigir o contrário                              |
| Frases de status diferentes por runtime                                                   | D-04: tabela própria, sem depender do runtime                                                                      |
| Mudança de tipos em `ErrorBody` afetar `toJSON()` ou código que implementa `ErrorBody`    | D-08: campos opcionais; `pnpm typecheck` valida                                                                    |
| Regressão do ramo legado ao refatorar `errorResponse`                                     | Ramo legado idêntico ao atual; suíte existente roda sem ajustes                                                    |
| `FrozenHeaders` lança em mutação                                                          | O `problemHeaders` só é lido por `new Headers(...)` e `mergeHeaders(base, ...)`, que copiam, como em `jsonHeaders` |
| `app.config` imutável nos testes                                                          | Plano B descrito na seção 4                                                                                        |
| Limite de 200 linhas por arquivo                                                          | Helper novo isolado (D-03); `src/response.ts` cresce poucas linhas                                                 |
