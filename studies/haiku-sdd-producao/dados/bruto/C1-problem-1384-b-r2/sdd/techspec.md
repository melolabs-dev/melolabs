# Especificação técnica — Respostas de erro no formato problem details (RFC 9457)

Base: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-05, premissas P1–P5, riscos R1–R5) e o código de `h3` v2.0.8 (`package.json`).

Esta especificação não altera código do projeto. As citações `arquivo:linha` foram conferidas lendo os arquivos nesta data.

---

## 1. Contexto técnico

Hoje, todo erro que chega a `toResponse()` passa por `prepareResponse()` e, no ramo de erro, por `errorResponse()`:

- `src/response.ts:146-174` normaliza o erro (`HTTPError.isError` / `new HTTPError(val)`), marca `unhandled`, chama `onError` e depois renderiza com `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`).
- `errorResponse()` (`src/response.ts:358-380`) monta o corpo como `JSON.stringify({ ...error.toJSON(), stack })` e usa `jsonHeaders` (`application/json;charset=UTF-8`, `src/response.ts:270-272`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) devolve `status`, `statusText`, `unhandled`, `message` (mascarado como `"HTTPError"` quando `unhandled`), `data` e os campos de `body` espalhados no topo (exceto quando `unhandled`).

Não há outro gerador de corpo de erro. Verificado: `errorResponse` só é chamado em `src/response.ts:173`; `toJSON()` só é usado em `src/response.ts:368`. O caminho de `onError` em `src/adapters.ts:122` só repassa o erro ao hook e não gera resposta, então não é um caminho divergente (fecha a premissa P3 do PRD). Os erros de JSON-RPC são tratados à parte em `src/utils/json-rpc.ts:483-493`, sem passar por `errorResponse`.

---

## 2. Decisões de arquitetura

### D-01 — Substituição direta do formato de erro, sem opção de configuração

- **Decisão:** `errorResponse()` passa a emitir problem details para todos os erros, sem flag nova em `H3Config` e sem negociação por `Accept`.
- **Alternativas consideradas:**
  - (a) Opção `problemDetails: true` em `H3Config` — rejeitada: o pedido diz "sem configuração" e "sem opção nova".
  - (b) Manter o JSON atual por padrão e servir problem details por `Accept: application/problem+json` — rejeitada: contraria "o novo formato substitui" e exige negociação fora do escopo (PRD, "Fora de escopo").
  - (c) Substituição direta — escolhida, porque é o que o pedido pede.
- **Consequência:** é uma mudança observável de contrato (Content-Type e forma do corpo). O conflito com "não quebrar o que já existe" (PRD P1) continua aberto; ver seção 7, questão Q1.

### D-02 — Helper de montagem em arquivo interno próprio

- **Decisão:** a lógica de montagem do documento fica em `src/utils/internal/problem.ts`, com a função `toProblemDetails(error, debug)` e a tabela de frases padrão. `errorResponse()` continua em `src/response.ts`, que hoje tem 380 linhas, e só troca o corpo e o cabeçalho.
- **Alternativas:**
  - Colocar o helper no fim de `src/response.ts` — rejeitada: o arquivo já passa do limite de ~200 LoC do AGENTS.md (PRD R5), e a tabela de frases faria o problema crescer.
  - Colocar em `src/error.ts` — rejeitada: `error.ts` é o tipo público de `HTTPError`; a montagem do corpo HTTP é responsabilidade da resposta.
- **Convenção:** `src/utils/internal/` (AGENTS.md: "Internal helpers go at the end of files or in `utils/internal/`").

### D-03 — Membros de extensão: `data`, `body` espalhado no topo, `unhandled` e `stack`

- **Decisão:**
  - `body` continua espalhado no topo do documento, como hoje (`src/error.ts:234`), e não como um membro chamado `body`.
  - `data` continua como membro `data`.
  - `unhandled` continua no topo quando verdadeiro, como hoje.
  - `stack` continua no topo, só em modo debug, como hoje.
  - Os membros da RFC têm precedência sobre qualquer chave de extensão (PRD R4).
- **Motivo:** o objetivo do PRD é "não perder informação já exposta hoje" (PRD, "Requisitos funcionais", RF-01). `unhandled` e `stack` já são expostos hoje, então não são "novos membros de extensão" (PRD, "Fora de escopo"). `body` como membro aninhado quebraria clientes sem ganho.
- **Alternativa rejeitada:** descartar `unhandled` e `stack` para seguir o PRD ao pé da letra. Isso removeria informação que hoje existe, e os testes atuais dependem de `unhandled: true` (`test/errors.test.ts:257, 309, 384, 420, 442`) e de `stack` (`test/body.test.ts:458`).
- **Confirmação necessária:** ver Q2.

### D-04 — `title` com frase padrão do status, sem `statusText` quando não há

- **Decisão:** `title` = `statusText` do erro, se existir; senão, a frase padrão do registro IANA para o status (tabela em `src/utils/internal/problem.ts`). Se o código não estiver na tabela, `title` é omitido.
- **Alternativas:**
  - Usar `statusText` e omitir `title` quando ausente — rejeitada: o PRD RF-01 exige a frase padrão.
  - Importar `STATUS_CODES` de `node:http` — rejeitada: quebra a regra "web standard first" e o alvo de workers/browser (AGENTS.md, "Core Design").
  - Não existe tabela de frases no projeto (verificado: nenhum match para `"Not Found"` em `src/`, exceto comentários em `src/error.ts:141,158`). Por isso a tabela é nova.
- **Para erros `unhandled`:** `title` usa a frase padrão e ignora `statusText`. Motivo: hoje `toJSON()` expõe `statusText` mesmo quando `unhandled` (`src/error.ts:230`), e `statusText` pode vir de `cause` (`src/error.ts:180-185`). Isso é um vazamento latente que não pode ser copiado para `title`.

### D-05 — Erros `unhandled`: detail fixo, sem `type` nem `instance`

- **Decisão:** para `unhandled`, `detail` = `"HTTPError"`, `type` = `"about:blank"`, `instance` omitido, `title` = frase padrão. `data` e `body` não entram. `unhandled: true` e `stack` (em debug) continuam, como hoje.
- **Motivo:** PRD RF-04 e R3. `type` e `instance` poderiam, se viessem de `cause`, expor detalhe interno (ex.: um caminho de arquivo em `instance`). Por isso `HTTPError` não lê `type`/`instance` de `cause` (D-06).

### D-06 — `type` e `instance` são lidos apenas do objeto de entrada direto

- **Decisão:** o construtor de `HTTPError` lê `type` e `instance` somente de `details` (o objeto de entrada), não de `details.cause`. Aceita apenas strings; qualquer outro tipo vira `undefined`.
- **Alternativa:** seguir o padrão de `headers`, `status` e `statusText`, que caem para `cause` (`src/error.ts:172-203`) — rejeitada: `cause` é, em geral, um erro arbitrário (`toError()` em `src/response.ts:80-81` embrulha qualquer valor), e um `type` ou `instance` de um driver seria copiado para a resposta.
- **Exposição:** `readonly` na instância (PRD RF-02). Não entram em `toJSON()`, para manter RF-05.
- **Tipo de entrada:** os campos vão em `ErrorInput` (`src/error.ts:6-26`), não em `ErrorBody`. Assim `toJSON()` não ganha campos opcionais novos na sua tipagem.

### D-07 — Content-Type exato `application/problem+json`

- **Decisão:** `Content-Type: application/problem+json`, sem `;charset=UTF-8`, como pede RF-01 e a RFC 9457 §3. JSON é UTF-8 por padrão (RFC 8259), então o parâmetro não é necessário.
- **Preservado:** se `HTTPError.headers` definir `content-type`, o valor do erro vence, como hoje (`mergeHeaders(base, error.headers)` em `src/response.ts:360`). Só a base muda (P4).

### D-08 — Erros HTTP lançados dentro do handler JSON-RPC mudam junto

- **Decisão:** os `HTTPError` lançados em `src/utils/json-rpc.ts:168` (405), `:176` (415) e `:235` (403) são erros HTTP e passam pelo mesmo `errorResponse()`. Eles passam a ser problem details. As respostas de erro de payload JSON-RPC (`code`/`message` do protocolo, `src/utils/json-rpc.ts:483-493`) não mudam.
- **Motivo:** o PRD exclui "erros de JSON-RPC" por seu formato de protocolo. Os três casos acima são erros de HTTP, e tratá-los de forma diferente exigiria um caminho paralelo.
- **Confirmação necessária:** ver Q3.

### D-09 — Ordem de construção do documento: extensões primeiro, membros RFC por último

- **Decisão:** o objeto retornado começa pelas extensões (`body`, `data`, `unhandled`, `stack`) e termina com `type`, `title`, `status`, `detail`, `instance`. Assim, uma chave de `body` chamada `status` não sobrescreve o status real (PRD R4). Por isso `toProblemDetails()` não usa `toJSON()` como fonte: `toJSON()` espalha `body` depois de `status` (`src/error.ts:228-235`), e isso faria `body.status` vencer.

---

## 3. Arquivos a alterar

### Código de produção

| Arquivo | Alteração |
| --- | --- |
| `src/error.ts` | Acrescentar `type?` e `instance?` em `ErrorInput` (`src/error.ts:6-26`). Declarar `readonly type` e `readonly instance` na classe (`src/error.ts:82-119`, após `unhandled` em `:119`). Preencher no construtor, perto de `this.body` (`src/error.ts:209`), lendo só de `details` e aceitando só strings. `toJSON()` (`src/error.ts:226-236`) não muda (RF-05). |
| `src/utils/internal/problem.ts` | **Novo.** Exporta `ProblemDetails`, `toProblemDetails(error, debug)` e a tabela `kReasonPhrases` (frases do registro IANA). |
| `src/response.ts` | Trocar `jsonHeaders` por `problemHeaders` em `errorResponse()` (`src/response.ts:358-380`), com `content-type: application/problem+json` (`src/response.ts:270-272` fica para respostas de sucesso). Trocar `JSON.stringify({...error.toJSON(), stack})` (`src/response.ts:365-374`) por `JSON.stringify(toProblemDetails(error, debug), undefined, debug ? 2 : undefined)`. `prepareResponse()` (`src/response.ts:129-174`) não muda. |

Não mudam: `src/adapters.ts`, `src/utils/json-rpc.ts`, `src/utils/middleware.ts` (`onError`, `:37-50`), `src/index.ts` (`:72`, já exporta `ErrorInput`/`ErrorBody`; nenhum nome público novo, RF-02).

### Testes

| Arquivo | Alteração | Motivo |
| --- | --- | --- |
| `test/problem-details.test.ts` | **Novo**, usando `describeMatrix`. Cobre RF-01 a RF-05 (seção 5). | Cobertura nova. |
| `test/errors.test.ts:44` | `content-type` passa a `application/problem+json`. | D-07 |
| `test/errors.test.ts:53-57` | `statusText` → `title`; `message` → `detail`; `status` e `data` ficam. | D-03, D-04 |
| `test/errors.test.ts:79-84` | `statusText` → `title`; `message` → `detail`. | Idem |
| `test/errors.test.ts:99-104` | Idem `:79-84`. | Idem |
| `test/errors.test.ts:140` | `toMatch("application/json")` → `toMatch("application/problem+json")`. Não passaria com o novo valor, pois `"application/problem+json"` não contém a substring `"application/json"`. | D-07 |
| `test/errors.test.ts:350` | `message: "HTTPError"` → `detail: "HTTPError"`. `unhandled: true` fica. | D-05 |
| `test/router.test.ts:110-112` | `message: expect.stringMatching(...)` → `detail: ...`. | D-03 |
| `test/body.test.ts:457` | `resultJson.statusText` → `resultJson.title`. `stack` (`:458`) fica. | D-03, D-04 |
| `test/body-limit.test.ts:120-122` | `message` → `detail`. `status` fica. | D-03 |
| `test/unit/types.test-d.ts` | Acrescentar `expectTypeOf` para `ErrorInput["type"]`, `ErrorInput["instance"]`, `HTTPError["type"]` e `HTTPError["instance"]`. O arquivo já usa `expectTypeOf` (`:12`). | RF-02 |

Testes a conferir na implementação (não confirmei se são corpo de resposta de erro ou entrada de `HTTPError`): `test/handler.test.ts:206-402` (há `status: 400` e `status: 500` em `:221, :237, :257, :271, :296, :311, :327`) e `test/validate.test.ts:55-70, :160-200, :233, :335`. Se forem asserções sobre o corpo de resposta, `message` vira `detail`. Se forem entrada de `HTTPError` ou `data`, não mudam.

Testes que não mudam: `test/errors.test.ts:257, 309, 384, 420, 442` (`status` e `unhandled`), `test/json-rpc.test.ts:1052-1080` (formato de protocolo), `test/body-limit.test.ts:22, 157` e os testes de `data` em `test/validate.test.ts:163-170`.

---

## 4. Contratos e assinaturas

### 4.1 `src/error.ts`

```ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ... campos existentes ...

  /**
   * RFC 9457 `type`: URI que identifica o tipo do problema.
   * Só strings são aceitas; qualquer outro valor é ignorado.
   * Não é lido de `cause`.
   */
  type?: string;

  /**
   * RFC 9457 `instance`: URI (ou referência) da ocorrência do problema.
   * Só strings são aceitas; qualquer outro valor é ignorado.
   * Não é lido de `cause`.
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ... campos existentes ...

  /** RFC 9457 `type` do erro. `undefined` quando não informado. */
  readonly type: string | undefined;

  /** RFC 9457 `instance` do erro. `undefined` quando não informado. */
  readonly instance: string | undefined;

  constructor(message: string, details?: ErrorDetails);
  constructor(details: ErrorDetails);
  // Construtor: após `this.body = ...`
  //   this.type = typeof (details as ErrorInput)?.type === "string" ? (details as ErrorInput).type : undefined;
  //   this.instance = typeof (details as ErrorInput)?.instance === "string" ? (details as ErrorInput).instance : undefined;

  toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]; // sem mudança (RF-05)
}
```

### 4.2 `src/utils/internal/problem.ts` (novo)

```ts
import type { HTTPError } from "../../error.ts";

/**
 * Documento RFC 9457 com membros de extensão.
 * Os membros da RFC têm precedência sobre as chaves de extensão.
 */
export interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  [extension: string]: unknown;
}

/**
 * Frases padrão do registro IANA para os códigos de status HTTP.
 * Usada como `title` quando o erro não tem `statusText`. Códigos fora da tabela não têm `title`.
 */
const kReasonPhrases: Readonly<Record<number, string>> = {
  /* ... ~60 entradas, 1xx a 5xx ... */
};

/**
 * Monta o documento de problema a partir de um `HTTPError`.
 *
 * - `unhandled`: `detail` fixo, sem `type`/`instance`/`data`/`body`/`statusText` (D-03, D-04, D-05)
 * - `stack` só com `debug` (como hoje)
 */
export function toProblemDetails(error: HTTPError, debug?: boolean): ProblemDetails {
  const unhandled = error.unhandled;
  const stack = debug && error.stack ? error.stack.split("\n").map((line) => line.trim()) : undefined;
  return {
    // Extensões (D-03, D-09): primeiro, para que os membros RFC vençam
    ...(unhandled ? undefined : error.body),
    ...(unhandled ? undefined : { data: error.data }),
    unhandled,
    stack,
    // Membros RFC
    type: (!unhandled && error.type) || "about:blank",
    title: (!unhandled && error.statusText) || kReasonPhrases[error.status],
    status: error.status,
    detail: unhandled ? "HTTPError" : error.message,
    ...(!unhandled && error.instance ? { instance: error.instance } : undefined),
  };
}
```

Observação de implementação: o esboço acima mostra a forma do retorno e a ordem dos membros. A forma final deve respeitar as regras de `unhandled` e a convenção de `undefined` (JSON.stringify omite as chaves `undefined`). Confira com `pnpm lint` (oxlint) para evitar objetos e spreads sem efeito.

### 4.3 `src/response.ts`

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = error.headers
    ? mergeHeaders(problemHeaders, error.headers)
    : new Headers(problemHeaders);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(toProblemDetails(error, debug), undefined, debug ? 2 : undefined),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

`jsonHeaders` continua existindo para respostas de sucesso (`src/response.ts:270-272`). `FrozenHeaders` precisa ser declarada antes de `problemHeaders` (`src/response.ts:260-268`).

### 4.4 Sem mudanças públicas

- `src/index.ts` não ganha exports. `toProblemDetails` e `kReasonPhrases` são internos.
- `HTTPError` ganha só as propriedades `type` e `instance`, como exige RF-02.
- `H3Config` não muda.

---

## 5. Estratégia de testes

Seguindo o fluxo de correção de bug do AGENTS.md (teste de regressão antes da implementação): primeiro escrever os testes novos e confirmar que eles falham, depois implementar.

### 5.1 `test/problem-details.test.ts` (novo, `describeMatrix` web e node)

| Teste | Critério | Requisito |
| --- | --- | --- |
| `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })` | status 404, `content-type` `application/problem+json`, corpo com `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"`, `type: "about:blank"` | RF-01 |
| `data` e `body` no erro | `data` como membro `data`; chaves de `body` no topo | RF-01, D-03 |
| `data`/`body` com chave `status` ou `detail` | Membros RFC vencem | R4, D-09 |
| `type` e `instance` informados | corpo com `type` e `instance` | RF-03 |
| Sem `type` e sem `instance` | `type: "about:blank"`, sem a chave `instance` | RF-03 |
| `statusText` ausente | `title` = frase IANA (ex.: 500 → `"Internal Server Error"`) | D-04 |
| Código fora da tabela | sem `title` | D-04 |
| Erro não tratado `new Error("senha do banco: 123")`, debug desligado | `status: 500`, `detail: "HTTPError"`, `type: "about:blank"`, sem `"senha do banco"`, sem `stack` | RF-04 |
| Erro não tratado com `cause` que tem `statusText` e `type` | `title` não usa o `statusText` do cause; `type` = `about:blank` | D-04, D-05, D-06 |
| Erro não tratado com debug ligado | `stack` presente como hoje | RF-04 |
| Erro `HTTPError` com `headers: { "x-foo": "1" }` | cabeçalho aplicado; `content-type` do erro vence se definido | P4, D-07 |
| `errHeaders` via `event.res` em erro | cabeçalhos extras presentes, como em `test/errors.test.ts:40-60` | Preservação |
| HEAD em erro | corpo vazio, `content-length` ausente | Preservação |
| `onError` configurado | corpo final é o problem document | P3 |

### 5.2 `HTTPError` (unitário)

Em `test/unit/` (ou em `test/errors.test.ts`, se preferido):

- `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` → `type` e `instance` com os valores informados (RF-02).
- `new HTTPError({ status: 500, message: "Falhou" })` → `type` e `instance` `undefined`.
- `new HTTPError({ status: 500, cause: { type: "x", instance: "y" } })` → `type` e `instance` `undefined` (D-06).
- `type: 42` → `undefined` (D-06).
- `HTTPError.status(400, "Bad Request", { message: "Inválido" }).toJSON()` deepEqual ao objeto de antes da mudança (RF-05). Escrever o valor esperado literalmente no teste, para que o teste não dependa do código novo.

### 5.3 Tipos

`test/unit/types.test-d.ts`: `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()`, o mesmo para `instance`, e `expectTypeOf<ErrorInput["type"]>()` aceitando `string | undefined`.

### 5.4 Regressão

Rodar, nesta ordem:

1. `pnpm vitest run test/problem-details.test.ts test/errors.test.ts test/router.test.ts test/body.test.ts test/body-limit.test.ts`
2. `pnpm vitest run test/unit/`
3. `pnpm test` (lint, typecheck e cobertura completa)
4. `pnpm build` e `test/dist.test.ts`, para validar o bundle (novo arquivo interno em `utils/internal`)

### 5.5 Não coberto pelos testes

- Clientes reais (curl, navegadores) lendo `application/problem+json`. Fica como verificação manual antes de publicar.

---

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Quebra de clientes que leem `message`, `statusText` ou `Content-Type` `application/json` (PRD R1). | Q1 (versionamento) e nota no changelog com antes e depois. |
| R-02 | Vazamento via `statusText` de `cause` em erros não tratados. Já existe em `toJSON()` (`src/error.ts:230`) e agora seria copiado para `title` se não fosse tratado. | D-04: `title` ignora `statusText` para `unhandled`. Teste em 5.1. |
| R-03 | Vazamento de `type`/`instance` vindos de `cause`. | D-05 e D-06. Testes em 5.1 e 5.2. |
| R-04 | Chave de `body` ou `data` colidindo com membro RFC (PRD R4). | D-09: RFC por último. Teste em 5.1. |
| R-05 | Tabela de frases cresce o arquivo ou a árvore de testes. | Arquivo novo em `utils/internal`, com tabela enxuta. Verificar LoC com a regra de 200 linhas. |
| R-06 | `application/problem+json` tratado de forma diferente por proxies e CDNs (PRD R2). | Testes nos dois runtimes do `describeMatrix`. Verificação manual de um proxy comum, se houver disponível. |
| R-07 | Erros HTTP de JSON-RPC (405, 415, 403) mudam de formato junto (D-08). | Q3. Testes em `test/json-rpc.test.ts` continuam verificando status. |
| R-08 | Alteração de tipo público de `HTTPError` (novas propriedades `readonly`). Quem estende a classe ou faz `implements ErrorBody` pode ver conflito de nome. | Nomes pedidos pelo PRD. Checar `test/unit/types.test-d.ts` e `pnpm typecheck`. |
| R-09 | Limite de 200 LoC em `src/response.ts` (já com 380) e `src/error.ts` (237). | Lógica em `src/utils/internal/problem.ts` (D-02). A mudança em `src/error.ts` é de poucas linhas. |

---

## 7. Questões abertas (confirmar com o responsável antes de implementar)

- **Q1 — Versionamento (P1 do PRD).** O pedido manda substituir o formato sem opção nova e, ao mesmo tempo, não quebrar o existente. A especificação segue a substituição (D-01). Como a mudança quebra clientes, a recomendação é publicar como mudança major (ou documentar como breaking em uma versão minor, se o projeto aceitar isso). Confirmar qual.
- **Q2 — `unhandled` e `stack` no corpo (D-03).** O PRD diz "só `data` e `body`" como extensões, mas também pede "não perder informação já exposta". A especificação mantém `unhandled` e `stack`. Se o responsável preferir o texto literal do PRD, os testes em `test/errors.test.ts:257, 309, 384, 420, 442` e `test/body.test.ts:458` precisam ser ajustados.
- **Q3 — Erros HTTP de JSON-RPC (D-08).** A especificação deixa 405, 415 e 403 de `src/utils/json-rpc.ts:168,176,235` seguirem o formato geral. A alternativa é manter esses três como JSON atual, o que exige um caminho separado em `errorResponse`.
- **Q4 — Forma do `body`.** A especificação espalha as chaves de `body` no topo, como hoje (D-03). O PRD diz "incluídos como membros de extensão", o que também pode ser lido como um membro chamado `body`. Confirmar a leitura.

---

## 8. Ordem de implementação sugerida

1. Escrever `test/problem-details.test.ts` e os testes unitários de `HTTPError`. Confirmar que falham.
2. `src/error.ts`: campos `type`/`instance` (D-06). Testes unitários passam.
3. `src/utils/internal/problem.ts`: tabela e `toProblemDetails` (D-02, D-03, D-04, D-05, D-09).
4. `src/response.ts`: `problemHeaders` e `errorResponse` (D-07).
5. Ajustar os testes existentes listados na seção 3, sem remover asserções que verificam status, cabeçalhos ou mascaramento.
6. `pnpm test`, `pnpm build` e `test/dist.test.ts`.
7. Changelog com exemplo antes e depois (R-01).
