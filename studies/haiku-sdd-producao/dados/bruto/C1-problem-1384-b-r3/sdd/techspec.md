# Especificação técnica — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-09, P1 a P5, R1 a R6).

Todas as citações `caminho:linha` foram conferidas no código atual (branch `master`, commit `f064597`). Os caminhos são relativos à raiz do projeto.

## 1. Estado atual

- `src/error.ts:30-69` — interface `ErrorBody`: `status`, `statusText?`, `message` (obrigatório), `unhandled?`, `data?`, `body?`. Não há `type` nem `instance`.
- `src/error.ts:74` — classe `HTTPError`. Campos `readonly` em `src/error.ts:82-119`.
- `src/error.ts:162-210` — construtor. Lê `status`, `statusText`, `headers`, `unhandled`, `data` e `body` do objeto de entrada e, quando falta, de `details.cause` (`src/error.ts:202-203` e `:205-206` são os padrões que vamos repetir).
- `src/error.ts:226-236` — `toJSON()` devolve `{ status, statusText, unhandled, message, data, ...body }`. Para erros `unhandled`, `message` vira `"HTTPError"`, `data` e `body` somem.
- `src/response.ts:139-144` — rota não encontrada: vira `new HTTPError({ status: 404, message: "Cannot find any route..." })`, sem `statusText`.
- `src/response.ts:146-174` — `prepareResponse` trata erros; `src/response.ts:173` chama `errorResponse`.
- `src/response.ts:270-272` — `jsonHeaders` (`application/json;charset=UTF-8`). É usado tanto no sucesso (`src/response.ts:312`) quanto no erro (`src/response.ts:360-361`).
- `src/response.ts:358-380` — `errorResponse(error, debug, errHeaders)`: monta `JSON.stringify({ ...error.toJSON(), stack })` com `mergeHeaders(jsonHeaders, error.headers)` (`src/response.ts:360`).
- `src/utils/internal/validate.ts:217-233` — erro de validação usa `statusText: "Validation failed"` e `message` do mesmo texto.
- `src/index.ts:72` — exporta `ErrorDetails`, `ErrorBody`, `ErrorInput` e `HTTPError`.
- Não existe tabela de textos padrão de status no projeto (busca por `Not Found`, `STATUS_CODES` e `statusTexts` em `src/` e `test/` sem resultado de tabela).

## 2. Decisões de arquitetura

### D-01 — Content-Type de erro por constante própria, sem tocar no sucesso

**Escolha:** criar `problemHeaders` em `src/response.ts`, logo após `jsonHeaders` (`src/response.ts:270-272`), com a mesma forma (`FrozenHeaders`) e o valor `application/problem+json`. `errorResponse` passa a usar `problemHeaders` em `src/response.ts:360-361`. `jsonHeaders` permanece igual e continua servindo o sucesso (`src/response.ts:312`, `:318`).

**Alternativas consideradas:**
1. Trocar `jsonHeaders` globalmente. Rejeitada: mudaria toda resposta JSON de sucesso, o que contraria RF-01 e o PRD (que fala só em erros). Também quebraria `test/security.test.ts:556`, que verifica `application/json;charset=UTF-8` numa resposta 200.
2. Criar os headers a cada erro com uma função. Rejeitada: aloca sem necessidade; a constante congelada já é o padrão do arquivo.
3. Escolhida: constante congelada específica para erros, simétrica a `jsonHeaders`.

**Assinatura:**
```ts
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

### D-02 — Corpo de `toJSON()` com membros RFC por último

**Escolha:** `HTTPError.toJSON()` mantém os membros atuais (`statusText`, `unhandled`, `message`, `data`, `...body`) e acrescenta `status`, `title`, `detail`, `type` e `instance`. Os membros RFC são colocados **depois** do `...body`, para que o objeto `body` do usuário não consiga sobrescrever `status`, `type` ou `detail`.

Hoje o `...body` vem por último (`src/error.ts:234`) e pode sobrescrever qualquer campo. Com os campos RFC, isso passaria a permitir que `body` falsifique `type`. A nova ordem fecha esse caminho sem alterar nada do que os testes atuais verificam (`test/errors.test.ts:79-85` usa `topLevel` em `body`, que continua funcionando).

**Alternativas consideradas:**
1. Manter a ordem atual. Rejeitada: deixa `body` capaz de forjar `type` e `status` no corpo. Como `errorResponse` usa `error.status` no código HTTP (`src/response.ts:375`), o corpo ficaria inconsistente com o status real.
2. Remover `statusText` e `message` do corpo, seguindo a RFC à risca. Rejeitada: P1 e R2 do PRD exigem manter os membros de extensão, e `test/errors.test.ts:55,81` e `test/app.test.ts:205` leem `statusText` do corpo.
3. Escolhida: manter tudo e colocar os membros RFC por último.

**Assinatura proposta** (o tipo de retorno fica local, sem exportação, para não criar nome público; ver D-05):
```ts
type ErrorJSON = Omit<ErrorBody, "body"> &
  ErrorBody["body"] & {
    title: string;
    detail: string;
    type: string;
    instance?: string;
  };

toJSON(): ErrorJSON {
  const unhandled = this.unhandled;
  const message = unhandled ? "HTTPError" : this.message;
  return {
    statusText: this.statusText,
    unhandled,
    message,
    data: unhandled ? undefined : this.data,
    ...(unhandled ? undefined : this.body),
    status: this.status,
    title: this.statusText ?? getDefaultStatusText(this.status),
    detail: message,
    type: (unhandled ? undefined : this.type) || "about:blank",
    instance: unhandled ? undefined : this.instance,
  };
}
```

### D-03 — Tabela interna de textos padrão para `title`

**Escolha:** criar `src/utils/internal/status-text.ts` com a função `getDefaultStatusText(status: number): string`. Ela consulta uma tabela de frases de status IANA (cerca de 60 códigos) e devolve `"Unknown Error"` quando o código não está na tabela. Use-a apenas como fallback de `title` (`statusText` vence quando existe, conforme P2 do PRD).

**Alternativas consideradas:**
1. `title` vazio quando não há `statusText`. Rejeitada: RF-02 torna `title` obrigatório e o exemplo de RF-02 espera `"Not Found"` para o 404 do roteador (`src/response.ts:139-144`), que não tem `statusText`.
2. Importar `STATUS_CODES` de `node:http`. Rejeitada: quebra a regra de "web standards first" do `AGENTS.md`, porque Cloudflare Workers e navegador não têm `node:http`.
3. Dependência externa. Rejeitada: o projeto tem duas dependências de produção por regra do `AGENTS.md`.
4. Escolhida: tabela interna. Custo estimado: poucos KB no bundle, sem efeito colateral (`sideEffects: false` em `package.json`).

**Assinatura:**
```ts
// src/utils/internal/status-text.ts
export function getDefaultStatusText(status: number): string;
```
A tabela não é exportada; `getDefaultStatusText` é usada só por `src/error.ts`. Não entra em `src/index.ts`.

### D-04 — `type` e `instance` como campos de `HTTPError`, lidos como os demais

**Escolha:** acrescentar `type?` e `instance?` a `ErrorBody` (`src/error.ts:30-69`). Como `ErrorInput` herda de `Partial<ErrorBody>` (`src/error.ts:6`), o objeto de entrada passa a aceitar os dois campos sem mudança extra. Na classe, acrescentar dois campos `readonly` (após `src/error.ts:119`) e lê-los no construtor logo após `unhandled` (`src/error.ts:205-206`), com a precedência `details` e depois `cause`. Usamos `||` para que string vazia caia no padrão `about:blank`.

**Assinaturas:**
```ts
// ErrorBody (src/error.ts)
/** URI que identifica o tipo do problema (RFC 9457). Ausente na resposta: "about:blank". */
type?: string;
/** URI que identifica a ocorrência do problema (RFC 9457). */
instance?: string;

// HTTPError (src/error.ts)
readonly type: string | undefined;
readonly instance: string | undefined;

// construtor (src/error.ts, após a linha 206)
this.type = (details as ErrorBody)?.type || (details?.cause as ErrorBody)?.type || undefined;
this.instance = (details as ErrorBody)?.instance || (details?.cause as ErrorBody)?.instance || undefined;
```
Não há nome público novo: `type` e `instance` são propriedades, não exports.

### D-05 — Erros `unhandled` não expõem `type` nem `instance`

**Escolha:** em erros `unhandled`, `detail` recebe o mesmo valor de `message` (`"HTTPError"`, RF-06). `type` vira `"about:blank"` e `instance` é omitido. A regra segue a de `data` e `body`: campos fornecidos pelo app ficam ocultos quando o erro é tratado como interno.

**Alternativas consideradas:**
1. Expor `type` e `instance` mesmo em erros `unhandled`. Rejeitada por enquanto: esses campos também são preenchidos a partir de `cause` (D-04), e um `cause` de driver poderia trazer texto interno. O PRD não fala deles, então a escolha conservadora é a ideia de RF-06 estendida.
2. Escolhida: ocultar. **Ponto a confirmar com o usuário** (ver seção 7).

### D-06 — `detail` e `title` sem novo nome público e sem mudança de `HTTPError.status()`

**Escolha:** `HTTPError.status(...)` e o construtor mantêm as mesmas assinaturas. O tipo de retorno de `toJSON()` usa o alias local `ErrorJSON` (D-02), não exportado. `src/index.ts:72` não muda.

Isso atende à restrição "Nenhum outro nome público novo" do `sdd/pedido.md`, e também evita que `isolatedDeclarations` (ativo, `AGENTS.md` seção TypeScript) exija anotação extra além da já fornecida em D-02.

### D-07 — Precedência de `headers` e `Content-Type` (RF-07) sem mudança de lógica

**Escolha:** `errorResponse` já faz `mergeHeaders(base, error.headers)` (`src/response.ts:360`), com `error.headers` sobrescrevendo a base. Basta trocar a base para `problemHeaders` (D-01). Assim, `headers: { "Content-Type": "text/plain" }` no `HTTPError` vence o padrão, como RF-07 pede. `errHeaders` continua sendo aplicado depois (`src/response.ts:362-364`), sem mudança.

### D-08 — Nenhuma opção de configuração (RF-09)

**Escolha:** `H3Config` (`src/types/h3.ts`) não muda. O formato é único, sem chave nova.

## 3. Arquivos a alterar

| Arquivo | Mudança | Referência |
| --- | --- | --- |
| `src/error.ts` | Campos `type?` e `instance?` em `ErrorBody`; campos `readonly` na classe; leitura no construtor; novo `toJSON()` com alias `ErrorJSON`; import de `getDefaultStatusText` | `src/error.ts:30-69`, `:119`, `:205-206`, `:226-236` |
| `src/response.ts` | Constante `problemHeaders`; `errorResponse` usa `problemHeaders` | `src/response.ts:270-272` (inserir após), `:358-361` |
| `src/utils/internal/status-text.ts` | **Novo.** Tabela de frases de status e `getDefaultStatusText` | — |
| `test/errors.test.ts` | Ajustar as duas asserções de `Content-Type` de erro | `test/errors.test.ts:44`, `:140` |
| `test/problem-details.test.ts` | **Novo.** Testes de regressão RF-01 a RF-08 em `describeMatrix` | `test/_setup.ts` |
| `test/unit/status-text.test.ts` | **Novo.** Testes da tabela e do fallback | — |
| `test/unit/types.test-d.ts` | Asserções de tipo para `type`, `instance` e `ErrorInput` | `test/unit/types.test-d.ts` |

**Não alterar** (verificados, continuam válidos):

- `src/h3.ts:83`, `:187`, `:223`: lançam `HTTPError` com status; passam pelo mesmo caminho.
- `src/response.ts:139-144`: rota 404 ganha `title` do fallback (D-03).
- `src/utils/internal/validate.ts:217-233`: `statusText` vira `title`, `message` vira `detail`.
- `src/utils/json-rpc.ts:484-498`: monta o próprio envelope JSON-RPC; não usa `toJSON()`. Os testes de JSON-RPC checam o envelope, não o `Content-Type` HTTP.
- `test/security.test.ts:556`: resposta **200**, precisa continuar `application/json;charset=UTF-8`.
- `test/router.test.ts:422`: HEAD de rota **de sucesso**.
- `test/validate.test.ts:109`, `:253`, `:354`: verificam texto no corpo de erro, não `Content-Type`. Os `toEqual` em `:244`, `:261`, `:346` e `:362` são de respostas 200.

## 4. Contratos e comportamento

### 4.1 Corpo de erro (sem `unhandled`)

```json
{
  "statusText": "Not Found",
  "unhandled": undefined,
  "message": "Usuário não encontrado",
  "data": undefined,
  "status": 404,
  "title": "Not Found",
  "detail": "Usuário não encontrado",
  "type": "about:blank"
}
```
`undefined` some na serialização. `instance` aparece só quando informado.

### 4.2 Corpo de erro `unhandled`

Mesma estrutura, mas `message` e `detail` valem `"HTTPError"`, `data`, `body` e `instance` somem, `type` é `"about:blank"`, `status` é 500 quando o erro veio de `toError` (`src/response.ts:80`), e `stack` só aparece com `debug` (`src/response.ts:369`).

### 4.3 Cabeçalhos

- `Content-Type: application/problem+json` por padrão.
- Headers de `HTTPError.headers` são mesclados por cima (`mergeHeaders`).
- `event.res.errHeaders` continua sendo mesclado depois (`src/response.ts:362-364`).
- HEAD não recebe corpo (`src/response.ts:198`, `:224`), mas mantém `Content-Type`.

### 4.4 Assinaturas públicas afetadas

- `ErrorBody`: ganha `type?` e `instance?` (mudança aditiva).
- `ErrorInput`: ganha os dois campos via `Partial<ErrorBody>`.
- `HTTPError`: ganha `readonly type` e `readonly instance` (aditivo).
- `HTTPError.prototype.toJSON()`: o retorno passa a ter `title`, `detail`, `type`, `instance` (aditivo; é um método público, por isso listado).
- Nenhum export novo. `H3Config` inalterado.

## 5. Estratégia de testes

Seguir o fluxo "Bug Fix Workflow" do `AGENTS.md`: escrever os testes de regressão antes da implementação e confirmar que falham.

**Regressão primeiro (`test/problem-details.test.ts`, `describeMatrix`):**

- RF-01: rota que lança `new HTTPError({ status: 422, message: "Dados inválidos" })` → status 422 e `Content-Type` `application/problem+json`.
- RF-02: `{ status: 404, statusText: "Not Found", message: "Usuário não encontrado" }` → corpo com `status`, `title`, `detail`, `type: "about:blank"`.
- RF-02 (fallback): rota 404 do roteador sem handler → `title: "Not Found"`; erro 500 `unhandled` sem `statusText` → `title: "Internal Server Error"`.
- RF-03: `{ status: 403, type, instance }` → `error.type`, `error.instance` e corpo com os mesmos valores.
- RF-04: `{ status: 500, cause: { status: 409, type: "https://exemplo.com/erros/conflito" } }` → `error.type` herdado do `cause`.
- RF-05: `message`, `data`, `body` continuam presentes; `body: { type: "x", status: 1 }` **não** sobrescreve `type` nem `status` (D-02).
- RF-06: erro `unhandled` com segredo no `cause` → corpo sem o segredo, sem `stack`, `status` 500, `detail: "HTTPError"`. Com `t.app.config.debug = true`, `stack` aparece.
- RF-07: `headers: { "Retry-After": "30" }` → `Retry-After: 30` e `Content-Type` padrão; `headers: { "Content-Type": "text/plain" }` → vence.
- RF-08: a própria `describeMatrix` cobre `web` e `node`; asserção explícita de que o corpo e o `Content-Type` são iguais nos dois modos.
- RF-09: `new H3({})` com `HTTPError` → `application/problem+json`. A ausência de nova opção é garantida pela checagem de tipo em `test/unit/types.test-d.ts`.

**Unitários:**

- `test/unit/status-text.test.ts`: 400→"Bad Request", 404→"Not Found", 500→"Internal Server Error", código fora da tabela (ex.: 599) → "Unknown Error".
- `HTTPError.toJSON()`: conjunto exato de chaves para erro tratado e para erro `unhandled`.

**Tipos (`test/unit/types.test-d.ts`):**

- `error.type` é `string | undefined`; `error.instance` é `string | undefined`.
- `ErrorInput` aceita `type` e `instance`.

**Ajustes em testes existentes (só o que depende da mudança, conforme P4):**

- `test/errors.test.ts:44`: `"application/json;charset=UTF-8"` → `"application/problem+json"`.
- `test/errors.test.ts:140`: `toMatch("application/json")` → `toMatch("application/problem+json")`. Atenção: `application/problem+json` **não** contém `application/json` como substring, por isso a asserção precisa mudar.
- Nenhum outro ajuste previsto. Os demais testes de erro usam `toMatchObject` (`test/errors.test.ts:53-57`, `:79-85`, `:99-104`, `:119-121`), que aceita os campos novos.

**Comandos de verificação:**

```bash
pnpm vitest run test/problem-details.test.ts test/errors.test.ts test/unit/status-text.test.ts
pnpm vitest run test/security.test.ts test/router.test.ts test/validate.test.ts
pnpm vitest run                 # suíte completa
pnpm typecheck
pnpm lint
```
`pnpm test` executa lint, typecheck e cobertura; é a verificação final.

**Correção ao PRD (R4 e P4):** o PRD estima cerca de 120 ocorrências em 18 arquivos. A leitura mostrou que só **duas** asserções dependem do `Content-Type` de erro (`test/errors.test.ts:44` e `:140`). As demais ocorrências de `application/json` são cabeçalhos de requisição ou respostas de sucesso. Nenhum teste compara o corpo de erro com `toEqual`, então os campos novos não quebram asserções existentes. O PRD também sugere ajustar testes de JSON-RPC e SSE; não há necessidade, pelas razões da seção 3.

## 6. Riscos

- **R-01 — Clientes que checam `application/json`.** É a quebra conhecida do PRD (R1). Não há opt-out, pelo contrato. Mitigação: nota de release destacando a mudança.
- **R-02 — Trocar `jsonHeaders` globalmente.** Quebraria o sucesso (`test/security.test.ts:556`). Mitigado por D-01; o teste de sucesso serve de guarda.
- **R-03 — Forjar campos RFC via `body`.** Mitigado por D-02, com teste dedicado em RF-05.
- **R-04 — Vazamento em `unhandled`.** `detail` herda o valor genérico de `message`. `title` vem de `statusText`, que hoje já é exposto no corpo de erros `unhandled` (`src/error.ts:230`, sem filtro). A exposição não aumenta, mas merece nota. `type` e `instance` ficam ocultos (D-05).
- **R-05 — `type` e `instance` sem validação de URI.** P3 do PRD aceita strings sem validação. Quem usa `instance` com caminho interno expõe o caminho; é responsabilidade de quem lança o erro.
- **R-06 — Tipo de `toJSON()` e `isolatedDeclarations`.** Sem anotação explícita, a declaração falha. Mitigado por D-02 (`ErrorJSON` anotado) e D-06 (não exportado). Verificar com `pnpm typecheck` e `pnpm build`.
- **R-07 — `detail` pouco informativo em erros sem `message`.** `new HTTPError({ status: 404 })` gera `message` `"HTTPError 404"` (`src/error.ts:193`), então `detail` também fica assim. Comportamento já existente; não é escopo desta entrega.
- **R-08 — Respostas feitas pelo `onError` não passam pelo formato.** Se o usuário devolve um `Response` próprio em `onError`, o h3 não o reescreve. Isso é esperado, mas precisa estar na documentação de migração.
- **R-09 — Tamanho da tabela de status.** Cerca de 60 linhas no bundle. Aceitável para o custo de não depender de `node:http`.

## 7. Perguntas em aberto

1. **Erros `unhandled` e `type`/`instance` (D-05):** confirmar que ficam ocultos. A recomendação é ocultar, pelo mesmo critério de `data` e `body`.
2. **Tabela interna de textos (D-03):** confirmar que a tabela é aceitável. A alternativa, `title` vazio sem `statusText`, contradiz RF-02.

Nenhuma delas bloqueia a implementação: adotamos a recomendação e a reportamos no PR.
