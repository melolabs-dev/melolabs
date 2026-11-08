# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-11).

Esta especificação não altera código. Todas as citações `arquivo:linha` foram conferidas na árvore atual (`3cbb0fa`).

## Visão geral

`problem(input)` é uma função exportada por `h3` que devolve um `HTTPError` comum, marcado com um símbolo interno não exportado. Quando esse erro chega a `prepareResponse`, `errorResponse` detecta a marca e renderiza o corpo RFC 9457 com `Content-Type: application/problem+json`. Erros sem a marca seguem o caminho atual, byte a byte.

Fluxo, sem mudança na ordem de hooks:

1. Handler faz `throw problem(...)` ou `return problem(...)`.
2. `toResponse` → `prepareResponse` (`src/response.ts:129`) recebe um `HTTPError`, que já passa direto pelo ramo de `src/response.ts:146-148` sem reembrulhar.
3. `onError`, se houver, recebe a mesma instância (`src/response.ts:159-166`).
4. `errorResponse` (`src/response.ts:358`) escolhe o formato pela marca.

---

## Decisões de arquitetura

### D-01 — Marca interna por símbolo não exportado, em vez de subclasse ou propriedade pública

**Escolha:** `problem` cria um `HTTPError` e grava os membros de problema em uma propriedade com a chave `kProblem`, um `Symbol.for("h3.problem")` definido em `src/error.ts`, não reexportado por `src/index.ts`. A propriedade é definida com `Object.defineProperty` e fica não enumerável.

**Alternativas consideradas:**

- *Subclasse `ProblemError extends HTTPError`.* Rejeitada: adiciona um nome público e um `instanceof` que o restante do h3 não usa. Também obriga a mudar `name` ou `isError`, que dependem de `name === "HTTPError"` (`src/error.ts:129-133`).
- *Propriedade pública (`error.problem`, `error.type`).* Rejeitada pelo RF-10: a superfície pública deve ganhar apenas `problem` e `ProblemInput`.
- *Acrescentar `type`/`instance` a `ErrorInput`.* Rejeitada pelo PRD (risco "crescimento do tipo `ErrorInput`") e por ampliar a superfície de todo `HTTPError`.
- *Propriedade enumerável com símbolo.* Rejeitada: um spread como `{ ...erro }` copiaria a marca sem querer, por exemplo em `HTTPError.status` (`src/error.ts:149`).

**Justificativa:** `Symbol.for` segue o padrão já usado para `kHTTPResponse` (`src/response.ts:94`) e `kEventResErrHeaders` (`src/event.ts:19`), e funciona entre cópias duplicadas do módulo. Como JSON não representa símbolos, a marca não pode vir de um corpo de requisição, o mesmo argumento usado para `kHTTPResponse` em `src/response.ts:88-93`.

### D-02 — `ProblemInput` é um tipo próprio que estende `ErrorInput`

**Escolha:** `export interface ProblemInput extends ErrorInput { type?: string; instance?: string }` em `src/error.ts`, reexportado por `src/index.ts`. `ErrorInput` (`src/error.ts:6`) não muda.

**Alternativas:** usar `ErrorDetails & {...}` ou um parâmetro `Omit<...>`. Descartadas: um tipo nomeado é o que o RF-02 pede e aparece nos documentos gerados.

**Justificativa:** `problem` desestrutura `type` e `instance` antes de chamar o construtor, então `ErrorDetails` nunca recebe campos desconhecidos. Isso mantém `HTTPError.cause` (`src/error.ts:197`) livre de `type` e `instance`.

### D-03 — Renderização em `errorResponse`, sem tocar em `toJSON`

**Escolha:** `errorResponse` (`src/response.ts:358-380`) ganha um ramo: se houver membros de problema, monta o corpo com uma função `toProblemJSON` e o `Content-Type` de problema. Caso contrário, mantém o código atual.

**Alternativas:**

- *Mudar `HTTPError.prototype.toJSON` (`src/error.ts:226-236`) para devolver o formato de problema quando marcado.* Rejeitada: `toJSON` é público e chamado por código de usuário e por integrações; mudá-lo viola o RF-06 para quem serializa um erro por conta própria.
- *Criar um segundo caminho de renderização em `prepareResponse`.* Rejeitada: duplicaria a lógica de `errHeaders` e de `onError` (`src/response.ts:160-172`).

**Justificativa:** o ramo fica num único lugar, `errorResponse`, que já cuida de headers, `errHeaders` e `debug`. O caminho antigo permanece intacto, o que garante o RF-06.

### D-04 — Precedência: membros reservados vencem `body`; `Content-Type` de problema vence `headers`

**Escolha:**

- Corpo: `body` é espalhado primeiro; `type`, `title`, `status`, `detail` e `instance` vêm depois e sobrescrevem. Isso cumpre o RF-05.
- Headers: `Content-Type: application/problem+json` é definido depois de `error.headers`, então um `headers: { "content-type": ... }` do usuário não o substitui. `errHeaders` continua sendo mesclado como hoje, em `src/response.ts:362-364`.

**Alternativas:** deixar `error.headers` sobrescrever o `Content-Type`. Rejeitada: o RF-03 exige o tipo de problema, e o RF-08 diz que os headers são mesclados *ao* `Content-Type` do problema.

**Atenção:** o JSON atual já deixa `body` sobrescrever `status` (`src/error.ts:234`, `...this.body` depois de `status`). Esse comportamento não muda, porque mudá-lo violaria o RF-06. Só o formato de problema tem a precedência nova.

### D-05 — Erro `unhandled` em problema: status 500, sem `detail` nem extensões

**Escolha:** se `error.unhandled` for verdadeiro (`src/error.ts:205-207`):

- `status` no corpo e no status HTTP vira 500, como pede o RF-07;
- `title` vira a frase de 500 (`"Internal Server Error"`) em vez de `statusText`;
- `detail` e `body` não aparecem;
- `type` e `instance` continuam, porque foram definidos pelo desenvolvedor;
- `stack` aparece só com `debug`, como hoje (`src/response.ts:369`).

**Alternativas:** ocultar também `type` e `instance`. Rejeitada: o RF-07 só fala em `detail` e extensões, e esses campos são identificadores definidos pelo código, não conteúdo de exceção.

### D-06 — Título padrão: nova tabela interna de frases, sem reaproveitar `STATUS_TEXT`

**Escolha:** criar `src/utils/internal/status-text.ts` com a tabela de frases de razão para 4xx e 5xx do registro IANA e a função `getReasonPhrase(status: number): string | undefined`. Quando não houver frase, `title` é omitido.

**Alternativas:**

- *Reaproveitar `STATUS_TEXT` de `src/utils/response.ts:347-354`.* Rejeitada: o comentário em `src/utils/response.ts:345-346` diz que a tabela é restrita de propósito, com frases só para 204 e 30x, e que outros códigos recebem frase nenhuma. Ampliá-la mudaria `noContent` e `redirect`.
- *`node:http` `STATUS_CODES`.* Rejeitada: API específica de Node, contra o princípio "web standards first" do AGENTS.md.
- *Tabela no `srvx`.* Rejeitada: a dependência não exporta tabela de frases (verificado em `node_modules/srvx/dist`).
- *Usar `new Response(null, { status }).statusText`.* Rejeitada: runtimes diferentes devolvem texto diferente ou vazio.

**Justificativa:** o RF-04 pede "a frase padrão do status HTTP". Uma tabela fixa é previsível e não depende do runtime. O `title` é opcional na RFC 9457, então omitir quando não há frase é válido.

### D-07 — `detail` vem da entrada, não do `message` calculado

**Escolha:** `problem` guarda `detail: input.message` em `ProblemMembers`. Sem `message` na entrada, `detail` não aparece no corpo.

**Alternativas:** usar `error.message`. Rejeitada: o construtor calcula um texto de fallback, como `"HTTPError 409"` (`src/error.ts:187-193`), que não é um detalhe escrito pelo desenvolvedor e poluiria o corpo de problema.

**Consequência:** `problem({ status: 409 })` gera corpo sem `detail`. Isso segue o RF-04 literalmente ("`detail` recebe `message`") e a RFC, em que `detail` é opcional.

### D-08 — `data` não é emitido no formato de problema

**Escolha:** o corpo de problema não tem o membro `data`. Para extensões, o caminho é `body` (RF-05), como diz o PRD em "Fora de escopo".

**Justificativa:** `data` não é membro da RFC 9457. Emiti-lo como extensão implicaria um mapeamento que o PRD exclui.

**Atenção para o usuário:** esta é uma escolha minha que o PRD não fixa explicitamente. Se preferirem que `data` apareça como extensão, é uma linha em `toProblemJSON`.

### D-09 — Snapshot de exports e superfície pública

**Escolha:** `src/index.ts:72` passa a exportar `problem` e `type ProblemInput`. O snapshot de `test/unit/package.test.ts` ganha `"problem"` na ordem alfabética, entre `"parseCookies"` (`test/unit/package.test.ts:104`) e `"proxy"` (`test/unit/package.test.ts:105`). `ProblemInput` é só tipo, então não aparece no snapshot.

**Justificativa:** esse teste é o guardião do RF-10. Atualizá-lo é o ajuste permitido pelo PRD ("ajuste só os testes existentes que dependem do que a sua mudança altera"), e o diff deve conter apenas `problem`.

---

## Arquivos a alterar

| Arquivo | Ponto de alteração | Motivo |
|---|---|---|
| `src/error.ts` | `ErrorInput` em `:6`; classe `HTTPError` em `:74`; construtor em `:162-210`; `toJSON` em `:226-236` (não muda) | Adicionar `kProblem`, `ProblemMembers`, `ProblemInput` e `problem()`. Acrescentar ao fim do arquivo, conforme a convenção de helpers no fim de arquivo do AGENTS.md. |
| `src/response.ts` | `prepareResponse` em `:129`; ramo de erro em `:146-174` (`new HTTPError(val)` em `:148`, `errHeaders` em `:160`, `errorResponse` em `:173`); `jsonHeaders` em `:270-272`; `mergeHeaders` em `:243-252`; `errorResponse` em `:358-380` | Ramo de problema em `errorResponse`; `toProblemJSON`. `prepareResponse` não muda. |
| `src/utils/internal/status-text.ts` | arquivo novo | Tabela de frases e `getReasonPhrase` (D-06). |
| `src/index.ts` | `:72` | Reexportar `problem` e `ProblemInput`. |
| `test/unit/package.test.ts` | `:104-105` | Incluir `"problem"` no snapshot (D-09). |
| `test/unit/types.test-d.ts` | arquivo existente, importações em `:1-12` | Casos de tipo para `ProblemInput` (ver estratégia). |
| `test/problem.test.ts` | arquivo novo | Testes de comportamento, em `describeMatrix` (ver estratégia). |

Não alterar: `src/utils/response.ts:347` (`STATUS_TEXT`, D-06), `src/event.ts`, `src/h3.ts`, `src/types/h3.ts`, `src/utils/json-rpc.ts`.

---

## Contratos e assinaturas

```ts
// src/error.ts

/** Membros de problema guardados na instância. Interno: não reexportado. */
export interface ProblemMembers {
  detail?: string;
  type?: string;
  instance?: string;
}

/** Marca interna de erros criados por `problem`. Interno: não reexportado. */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

/** Entrada de `problem`: `ErrorInput` mais os membros da RFC 9457 que o h3 repassa. */
export interface ProblemInput extends ErrorInput {
  /** URI que identifica o tipo do problema. Sem valor, o corpo usa `"about:blank"`. */
  type?: string;
  /** URI-reference que identifica a ocorrência. Omitido do corpo quando ausente. */
  instance?: string;
}

/**
 * Cria um `HTTPError` que é renderizado como `application/problem+json`.
 * Pode ser usado com `throw problem(...)` ou `return problem(...)`.
 */
export function problem(input: ProblemInput): HTTPError {
  const { type, instance, ...details } = input;
  const error = new HTTPError(details);
  Object.defineProperty(error, kProblem, {
    value: { detail: input.message, type, instance } satisfies ProblemMembers,
  });
  return error;
}
```

```ts
// src/response.ts (interno)

const kProblemContentType = "application/problem+json";

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
// Se `error[kProblem]` existir:
//   - headers = new Headers(error.headers); headers.set("content-type", kProblemContentType)
//   - corpo = JSON de toProblemJSON(error, members, debug)
//   - status = unhandled ? 500 : error.status; statusText = unhandled ? undefined : error.statusText
// Senão: comportamento atual, sem alteração.
// Em ambos os casos, errHeaders é mesclado com mergeHeaders(headers, errHeaders), como hoje.

function toProblemJSON(
  error: HTTPError,
  members: ProblemMembers,
  debug?: boolean,
): Record<string, unknown>;
// Ordem de montagem (reservados por último, vencendo `body`):
//   ...(unhandled ? undefined : error.body)
//   type:     members.type ?? "about:blank"
//   title:    unhandled ? getReasonPhrase(500) : error.statusText ?? getReasonPhrase(status)
//   status:   unhandled ? 500 : error.status
//   detail:   unhandled ? undefined : members.detail
//   instance: members.instance            (mantido também em unhandled, D-05)
//   stack:    debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined
// `title` fica undefined (e some do JSON) quando não há frase.
```

```ts
// src/utils/internal/status-text.ts

/** Frase de razão do registro IANA para 4xx e 5xx. Undefined para outros códigos. */
export function getReasonPhrase(status: number): string | undefined;
```

```ts
// src/index.ts:72 (depois)
export {
  type ErrorDetails,
  type ErrorBody,
  type ErrorInput,
  type ProblemInput,
  HTTPError,
  problem,
} from "./error.ts";
```

Observações sobre o contrato:

- `ProblemMembers` e `kProblem` ficam fora de `src/index.ts`. `src/response.ts` importa de `./error.ts` diretamente, como já faz com `HTTPError` (`src/response.ts:2`).
- `problem` aceita `status` inválido sem tratamento extra: a sanitização vem do construtor (`src/error.ts:172-178`, com padrão 500), o que cumpre o RF-11.
- `problem` não reembrulha erros: se `input.cause` for um `problem`, o `cause` aponta para a entrada sem a marca. O erro externo não herda o formato. Isso cobre o risco "marcação que se perde" do PRD.

---

## Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever os testes primeiro, confirmar que falham, depois implementar.

**`test/problem.test.ts` (novo, `describeMatrix`, mesmo padrão de `test/errors.test.ts:6`).** Um caso por RF:

- RF-01: `problem({ status: 404, message })` retorna `HTTPError`, com `status` 404 e `HTTPError.isError` verdadeiro. Testar `throw` e `return` (PRD, risco "marcação que se perde").
- RF-02: entrada com `type` e `instance` compila; os valores aparecem na resposta (verificação de tipo em `types.test-d.ts`).
- RF-03: `throw problem({ status: 403, message, type, instance })` → status 403, `content-type` exatamente `application/problem+json`, corpo com `type`, `status`, `detail`, `instance` e `title`.
- RF-04: `problem({ status: 409 })` → `type` "about:blank", `status` 409, `title` "Conflict", sem chave `instance` e sem chave `detail`. Também: `statusText` informado vence a frase; status sem frase (ex.: 499) não tem `title`.
- RF-05: `body: { campos: ["email"], status: 999 }` → `campos` no topo e `status` 422. Testar também `type`, `title`, `detail` e `instance` vindos de `body`, que devem ser ignorados.
- RF-06: `new HTTPError({ status: 404, message })` e `HTTPError.status(...)` → `application/json`, corpo idêntico ao atual (`status`, `statusText`, `unhandled`, `message`, `data`). Esse teste fixa o comportamento antigo antes da mudança.
- RF-07: `new Error("segredo do banco")` → 500, `application/json`, sem o texto, sem stack fora de `debug`. Caso novo para problema: `problem({ status: 503, message: "segredo", unhandled: true, body: { x: 1 } })` → 500, `application/problem+json`, sem `detail` nem `x`, com `title` "Internal Server Error". Com `debug: true`, `stack` aparece.
- RF-08: `headers: { "WWW-Authenticate": "Bearer" }` → header presente. Caso com `headers: { "content-type": "text/plain" }` → `content-type` continua `application/problem+json`. `event.res.errHeaders` continua mesclado.
- RF-09: `onError` recebe `HTTPError` com `status` 400 e `message` "x". `onResponse` é chamado uma vez.
- RF-10: coberto por `test/unit/package.test.ts` (snapshot) e pelo teste de tipo abaixo.
- RF-11: `problem({ status: 42, message: "x" })` → status HTTP 500 e corpo `status` 500.

Os testes de RF-03 a RF-11 devem rodar em `web` e `node` pelo `describeMatrix`. Usar `it.skipIf` só se algum comportamento for específico de runtime, o que não se espera.

**`test/unit/types.test-d.ts`:** usar `expectTypeOf` (já importado em `types.test-d.ts:12`) para:

- `problem({ status: 400, type: "x", instance: "/y" })` retorna `HTTPError`;
- `ProblemInput` aceita `type` e `instance`;
- `new HTTPError({ status: 400, type: "x" })` continua sendo erro de tipo (`// @ts-expect-error`). Esse caso protege o risco "crescimento do `ErrorInput`".

**`test/unit/package.test.ts`:** o snapshot inline precisa incluir `"problem"`. Não adicionar `ProblemInput`, porque é tipo.

**`test/unit/status-text.test.ts` (opcional, se quiserem cobertura da tabela):** `getReasonPhrase(409) === "Conflict"`, `getReasonPhrase(499)` é `undefined`, `getReasonPhrase(200)` é `undefined`. Com os testes de RF-04, isso já fica coberto indiretamente; a unidade seria redundante.

**Regressão:** `pnpm vitest run test/errors.test.ts` e `pnpm vitest run` completo. Os testes existentes em `test/errors.test.ts` (ex.: linha 44, `application/json;charset=UTF-8`) não devem mudar. Se algum mudar, é sinal de regressão no caminho antigo, não ajuste de teste.

**Qualidade:** `pnpm typecheck` e `pnpm lint` (inclui `oxfmt --check`, então os arquivos novos precisam estar formatados).

**Verificação não feita:** esta especificação não executou testes; é um documento. Os comandos acima são o critério de aceitação da implementação.

---

## Riscos

| Risco | Probabilidade / impacto | Mitigação |
|---|---|---|
| A marca se perde ao reembrulhar o erro (`new HTTPError({ cause: erro })`, cópia por spread). | Média / médio: o cliente recebe JSON antigo sem aviso. | D-01 (propriedade não enumerável, não copiada por spread); testes de `throw`/`return`; documentar que o formato é do erro original, não do embrulho. |
| `unhandled` vaza `detail` ou extensões. | Baixa / alto: vazamento de informação. | D-05 e teste de RF-07 com `body` e `message` sensíveis. |
| `body` sobrescreve membros reservados. | Baixa / médio: corpo inválido. | D-04: reservados por último; teste de RF-05 com `status` e `type` em `body`. |
| `headers` com `content-type` desfaz o formato de problema. | Baixa / médio. | D-04: `Content-Type` definido depois de `error.headers`; teste de RF-08. |
| Divergência entre `statusText` e `title` para o cliente. | Baixa / baixo: risco aceito no PRD. | Mapeamento documentado em D-06 e no RF-04. |
| Clientes que leem `message` do JSON antigo. | Nenhum para erros antigos; só respostas com `problem` mudam. | RF-06 com teste de compatibilidade byte a byte. |
| Duas tabelas de frases no código (`STATUS_TEXT` e a nova). | Baixa / baixo: manutenção. | D-06 explica a separação; o comentário em `src/utils/response.ts:345-346` deve ser mantido. |
| `detail` ausente quando não há `message` (D-07). | Baixa / baixo: é uma escolha. | Confirmar com o time; a mudança é uma linha em `problem` se preferirem o `error.message` calculado. |
| `data` não aparece em problema (D-08). | Média / baixo: quem esperava `data` em problema. | Documentado; caminho é `body`. Decisão a confirmar. |
| `instance` aparece em erro `unhandled` (D-05). | Baixa / baixo. | Decisão a confirmar; é uma linha se preferirem ocultar. |
| `Symbol.for` pode ser usado por código malicioso para forjar a marca. | Muito baixa / baixo: exige acesso ao código do servidor, e um atacante com isso já controla o processo. | Mesmo argumento de `kHTTPResponse` (`src/response.ts:88-93`). |
| Snapshot de exports quebra por causa de `problem`. | Certa / nenhum: é o ajuste esperado. | D-09; o diff do snapshot contém só `"problem"`. |
| Arquivos já acima do limite de ~200 linhas (`src/response.ts` tem 380). | Certa / baixo. | Não dividir neste trabalho; `toProblemJSON` vai para `response.ts` e a tabela de frases para arquivo próprio, para não crescer mais. |

## Pendências para confirmação

1. D-07: `detail` só com `message` explícito (recomendado) ou o `message` calculado pelo construtor.
2. D-08: `data` fora do corpo de problema (recomendado, conforme o PRD) ou como extensão.
3. D-05: `instance` mantido em erros `unhandled` (recomendado) ou ocultado.
