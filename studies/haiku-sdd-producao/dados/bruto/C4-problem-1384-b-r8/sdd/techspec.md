# Especificação técnica — Respostas de erro em problem details (RFC 9457)

Referências: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-10, premissas P1–P4, riscos R1–R4).

**Status:** pronta para implementação, **condicionada à confirmação de P1** (formato novo como padrão, sem opção, com quebra de clientes). Enquanto P1 não for confirmada, nenhuma linha de `src/` deve ser alterada.

Todas as citações foram conferidas no código atual da raiz do projeto (`C:\dev\runs\r8f9b157ea2`, branch `master`).

---

## 1. Estado atual

| Ponto | Onde | Comportamento hoje |
| --- | --- | --- |
| Classe `HTTPError`, campos públicos | `src/error.ts:74` | `status`, `statusText`, `headers`, `cause`, `data`, `body`, `unhandled`. Não há `type` nem `instance`. |
| Interface `ErrorBody` | `src/error.ts:30` | Base de `ErrorInput` (`src/error.ts:6`), que é o tipo aceito pelo construtor. Herdar de `ErrorBody` já aceita novos campos no construtor. |
| Construtor | `src/error.ts:162` | `statusText` e `unhandled` podem ser herdados de `cause` (`src/error.ts:180-184`, `src/error.ts:205-206`). `data` e `body` não são herdados (`src/error.ts:208-209`). |
| Corpo de erro | `src/error.ts:226-236` (`toJSON`) | Monta `{ status, statusText, unhandled, message, data, ...body }`. Para não tratados, `message` vira `"HTTPError"` e `data`/`body` somem. |
| Serialização | `src/response.ts:358-380` (`errorResponse`) | Chama `error.toJSON()` e acrescenta `stack` só se `debug`. Content-Type vem de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`), mesclado com `error.headers` e `errHeaders` (`src/response.ts:359-364`). Status line usa `error.statusText` (`src/response.ts:376`). |
| Chamada | `src/response.ts:173` | `prepareResponse` chama `errorResponse(error, config.debug, errHeaders)`. O `config` é lido a cada requisição, então trocar `config.debug` em teste tem efeito. |
| Mesclagem de headers | `src/response.ts:243` (`mergeHeaders`) | `set-cookie` é anexado, os demais são sobrescritos. |
| Frases de status | `src/utils/response.ts:347` (`STATUS_TEXT`) | Tabela propositalmente curta (só 204 e redirects), não exportada. Não serve para `title`. |
| Dependência do `unhandled` | `src/utils/json-rpc.ts:484` | Lê `error_.unhandled` da instância, não do JSON. Comentário em `src/utils/json-rpc.ts:483` cita `HTTPError.toJSON()` como fonte do mascaramento; continua verdadeiro. |
| Único uso de `toJSON` | `src/error.ts:226`, `src/response.ts:368` | Nenhum outro consumidor em `src/`. |
| Modo debug nos testes | `test/_setup.ts:136` | A matriz roda com `debug: true`. Testes de modo não debug precisam desligar `t.app.config.debug`. |

---

## 2. Decisões de arquitetura

### D-01 — Formato problem details como padrão único, sem opção

**Escolha:** seguir o PRD literalmente. O corpo de todo erro de `HTTPError` passa a ser problem details, com `Content-Type: application/problem+json`, sem configuração nova.

**Alternativas consideradas:**
- *Opção de configuração (`H3Config`) para escolher o formato.* Resolve P1, mas cria nome público novo em `src/types/h3.ts`, o que a restrição do pedido proíbe.
- *Negociação por `Accept`.* Fora de escopo (PRD, "Fora de escopo").
- *Manter o formato atual e só acrescentar `type`/`instance`.* Não atende RF-01 nem o objetivo do pedido.

**Justificativa:** é a única opção que cumpre o pedido sem nome novo. A quebra de clientes (R1) fica registrada como mudança breaking, para changelog. **Pendência:** confirmar P1 antes de implementar.

### D-02 — `HTTPError.toJSON()` passa a ser a fonte única do corpo

**Escolha:** `toJSON()` devolve o objeto problem details (sem `stack`). `errorResponse` continua acrescentando `stack` apenas em debug (RF-05) e não monta o corpo por conta própria.

**Alternativas consideradas:**
- *Função interna nova (`toProblemDetails(error)`) chamada por `errorResponse`, com `toJSON()` mantendo o formato antigo.* Mantém o `JSON.stringify(err)` do usuário no formato antigo e cria dois formatos para o mesmo erro. Descartada.
- *Função interna nova usada também por `toJSON()`.* Equivalente à escolha, com um arquivo a mais. Descartada por ser indireção sem ganho.

**Justificativa:** um único lugar define o formato. `JSON.stringify(err)` e a resposta HTTP ficam iguais. A alteração em `errorResponse` fica restrita a `Content-Type` e ao `stack`.

### D-03 — Membros da RFC prevalecem sobre `body`

**Escolha:** `...body` vem primeiro no objeto devolvido por `toJSON()`, e `type`, `title`, `status`, `detail`, `instance` vêm depois, então não podem ser sobrescritos por `body` (ou por `data`, que vem por último). `data` fica por último, para continuar contendo o valor informado.

**Alternativas consideradas:**
- *Manter a ordem atual (`...body` por último, como em `src/error.ts:234`).* Permite que `body: { status: 999 }` quebre o contrato de RFC. Descartada.

**Justificativa:** um `body` com chaves `status` ou `title` não deve alterar os membros padronizados. A mudança é pequena e não afeta a RF-06, que só exige que os campos de `body` apareçam no nível superior.

### D-04 — `title`: `statusText` para erros tratados, frase padrão para não tratados

**Escolha:**
- Erro tratado: `title = statusText` quando existir; senão, a frase padrão do status.
- Erro não tratado: `title` é sempre a frase padrão do status. `statusText` é ignorado no corpo.
- Sem frase conhecida (status fora da tabela): `title` é omitido. RFC 9457 torna os membros opcionais, então a omissão é válida e não gera texto genérico enganoso (fecha R4).
- A frase padrão vem de uma tabela nova e interna, `src/utils/internal/status-text.ts`, cobrindo 4xx e 5xx conforme RFC 9110 e registro IANA.

**Alternativas consideradas:**
- *Reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`.* Descartada: a tabela é de propósito pequena (comentário em `src/utils/response.ts:346`), e importar `utils/response.ts` de `error.ts` cria ciclo (`src/utils/response.ts:2` importa `src/response.ts`, que importa `src/error.ts`).
- *Usar `statusText` também em erros não tratados.* Descartada: um `Error` com `statusText` arbitrário vazaria texto interno para o corpo (ver R-02). A RF-04 proíbe esse vazamento.

**Justificativa:** o corpo nunca mostra texto que não foi escolhido para aparecer. A status line (`src/response.ts:376`) continua usando `error.statusText`, sem mudança.

### D-05 — `type` e `instance` não são herdados de `cause`

**Escolha:** `type` e `instance` só são lidos de `details` (o objeto passado ao construtor). Não são lidos de `details.cause`, ao contrário de `statusText` e `unhandled`.

**Alternativas consideradas:**
- *Herdar de `cause` como `statusText`.* Descartada: `cause` costuma ser erro de driver ou de biblioteca externa, cujos campos não são controlados pela aplicação. O comentário de `toError` (`src/response.ts:63-72`) já adota a regra de não confiar em valores de objetos lançados.

**Justificativa:** evita que um erro externo defina `type`/`instance` na resposta. A RF-02 pede só os valores informados no `HTTPError`, então não há perda funcional.

### D-06 — `Content-Type` do h3 é aplicado por último

**Escolha:** `errorResponse` monta os headers na ordem: `error.headers`, depois `errHeaders` (mesclados como hoje), e por último `set("content-type", "application/problem+json")`. Assim o valor do h3 prevalece sobre qualquer `content-type` vindo de `error.headers` ou de `event.res.errHeaders` (RF-07).

**Alternativas consideradas:**
- *Pôr `application/problem+json` como base e deixar os headers do erro sobrescrevê-lo.* É o comportamento de `mergeHeaders(jsonHeaders, error.headers)` hoje (`src/response.ts:359-361`). Descartada, porque violaria RF-07.

**Justificativa:** a RF-07 exige a precedência do h3. Aplicar por último é a forma mais simples de garantir isso.

### D-07 — `unhandled` e `statusText` saem do corpo; permanecem na instância

**Escolha:** o corpo deixa de conter `unhandled` e `statusText` (P3 permite). As propriedades da instância `unhandled` e `statusText` continuam existindo, porque `src/utils/json-rpc.ts:484` e os testes de `test/errors.test.ts` dependem delas.

**Alternativas consideradas:**
- *Manter `unhandled` e `statusText` no corpo como extensão.* Compatibilidade maior, mas polui o corpo com campos fora da RFC e repete informação já coberta por `title` e `detail`. Fica como alternativa caso P3 seja revista (ver R-01).

**Justificativa:** o corpo fica no formato da RFC, sem campos duplicados. A mudança é quebra de compatibilidade e entra no mesmo changelog da D-01.

### D-08 — `stack` continua só em debug

**Escolha:** sem mudança de regra. `errorResponse` acrescenta `stack` quando `debug && error.stack` (`src/response.ts:369`). O mecanismo de debug é o mesmo (P4).

---

## 3. Arquivos a alterar

### Código

1. **`src/error.ts`**
   - `ErrorBody` (`src/error.ts:30`): adicionar `type?: string` e `instance?: string`, com doc da RFC 9457. Atualizar a doc de `statusText` (`src/error.ts:44`), que hoje diz que `message` vai "in JSON body under `message` key".
   - Classe `HTTPError` (`src/error.ts:74`): adicionar `readonly type: string | undefined` e `readonly instance: string | undefined`, junto dos demais campos (perto de `src/error.ts:107-112`).
   - Construtor (`src/error.ts:162`): atribuir `this.type = (details as ErrorBody)?.type;` e `this.instance = (details as ErrorBody)?.instance;` após `src/error.ts:209`. Sem herança de `cause` (D-05).
   - `toJSON()` (`src/error.ts:226-236`): reescrever conforme o contrato da seção 4.
   - Importar `STATUS_PHRASES` de `./utils/internal/status-text.ts`.
   - Campo `unhandled` (`src/error.ts:119`) e `statusText` (`src/error.ts:92`): sem mudança.

2. **`src/utils/internal/status-text.ts`** (novo, pequeno)
   - Exporta `STATUS_PHRASES`. Sem imports, para não criar ciclo.

3. **`src/response.ts`**
   - `errorResponse` (`src/response.ts:358-380`): montar headers como em D-06, sem `jsonHeaders` para erros. O corpo continua `JSON.stringify({ ...error.toJSON(), stack }, undefined, debug ? 2 : undefined)`.
   - Acrescentar a constante `PROBLEM_CONTENT_TYPE = "application/problem+json"` perto de `jsonHeaders` (`src/response.ts:270`), ou usar literal no ponto de uso, seguindo o estilo do arquivo.
   - `jsonHeaders` (`src/response.ts:270`) continua sendo usado por outros caminhos (JSON comum em `src/response.ts:311`, BigInt). Não remover.
   - `prepareResponse` (`src/response.ts:129`) e a chamada em `src/response.ts:173`: sem mudança.

### Não alterar

- `src/utils/json-rpc.ts`: depende só de `unhandled` na instância e do comentário em `:483`, que continua válido.
- `src/utils/response.ts:347` (`STATUS_TEXT`): sem mudança (D-04).
- `src/index.ts:72`: sem novos exports. `ErrorBody` já é exportado. `test/unit/package.test.ts` (snapshot de exports) deve continuar passando sem edição.
- `src/_deprecated.ts`: fora de escopo (PRD).
- `src/rules/*`, `src/tracing.ts`: fora de escopo, salvo se os testes deles dependerem do formato (verificado na seção 5).

### Testes

Lista de asserts do formato antigo que precisam de ajuste (RF-08). A intenção de cada teste é mantida.

| Arquivo:linha | Assert atual | Ajuste |
| --- | --- | --- |
| `test/errors.test.ts:44` | `content-type` = `application/json;charset=UTF-8` (erro com `set-cookie` e `errHeaders`) | `application/problem+json`. Manter `x-error`, `x-error-own`, `x-success` e a ordem de `set-cookie`. |
| `test/errors.test.ts:67-86` | `message: "Unprocessable"`, `statusText: "Unprocessable"` | `detail: "Unprocessable"`, `title: "Unprocessable"`, `type: "about:blank"`. Manter `data` e `topLevel`. |
| `test/errors.test.ts:88-100` | mesmo padrão em `return new HTTPError` | Mesmo ajuste. |
| `test/errors.test.ts:137-150` | `content-type` com `application/json`, `statusText: "Bad Request"` no corpo | `application/problem+json`, `title: "Bad Request"`. Manter `data.message`. |
| `test/errors.test.ts:257` | `unhandled: true` no corpo | Trocar por `detail: "HTTPError"`, `title: "Internal Server Error"`. Manter a verificação de que `db-password` e `internal detail` não aparecem (`:251-255`). |
| `test/errors.test.ts:309`, `:384`, `:420`, `:442` | `toMatchObject({ status: 500, unhandled: true })` | Trocar `unhandled: true` por `detail: "HTTPError"` (ou pelo `detail` equivalente). |
| `test/errors.test.ts:350` | `toMatchObject({ unhandled: true, message: "HTTPError" })` | `detail: "HTTPError"`. Manter `t.errors[0].unhandled` (`:351`), que é a instância. |
| `test/errors.test.ts:173-183` | Verifica `t.errors[0].unhandled` | Sem mudança (instância). |
| `test/body.test.ts:454-458` | `resultJson.statusText` = `"Bad Request"` e `resultJson.stack[0]` | `title` no lugar de `statusText`. Manter `stack`. |
| `test/handler.test.ts:222-223`, `:238-239`, `:272-273` | `statusText`, `message: "Validation failed"` no nível superior | `title`, `detail`. Manter `data.issues`. |
| `test/handler.test.ts:258` | `message: "Invalid JSON body"` | `detail`. |
| `test/handler.test.ts` (demais `message` no nível superior) | a confirmar linha a linha | Verificar se é corpo de erro (`HTTPError`) ou `data`. Ajustar só o nível superior. |
| `test/body-limit.test.ts:122` | `message: "Request body exceeds..."` | `detail`. |
| `test/proxy.test.ts:1027-1028` | `statusText: "Bad Gateway"`, `message: "Bad Gateway"` | `title`, `detail`. |
| `test/rules/cache.test.ts:251` | `(await res.json()).message` | `detail`. |
| `test/dist.test.ts:57` | `.message` = `"teapot"` | `detail`. Depende de `pnpm build` (ver seção 6). |
| `test/iterable.test.ts:145` | `.message` = `"nope"` | Verificar se o erro é `HTTPError`. Se for, `detail`. |

**Não alterar:** `test/route.test.ts:84-91` (o `onError` retorna objeto simples, não `HTTPError`, então o corpo continua JSON comum). `test/validate.test.ts` (asserts em `data.message`, dentro de `data`). `test/json-rpc*.test.ts` (envelope JSON-RPC, outro formato).

---

## 4. Contratos e assinaturas

```ts
// src/error.ts

export interface ErrorBody<DataT = unknown> {
  // ...campos existentes...

  /**
   * URI que identifica o tipo do problema (RFC 9457).
   * Quando ausente, o corpo usa `"about:blank"`.
   */
  type?: string;

  /**
   * URI que identifica a ocorrência do problema (RFC 9457).
   */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  // ...campos existentes...

  /** RFC 9457 `type` informado, ou `undefined`. Não herdado de `cause`. */
  readonly type: string | undefined;

  /** RFC 9457 `instance` informado, ou `undefined`. Não herdado de `cause`. */
  readonly instance: string | undefined;

  /**
   * Corpo problem details (RFC 9457), sem `stack`.
   *
   * - Erro tratado: `type`, `title`, `status`, `detail`, `instance`, `data` e membros de `body`.
   * - Erro não tratado (`unhandled`): `detail` é `"HTTPError"`, `title` é a frase padrão do status,
   *   e `data` e `body` são omitidos.
   * - `title` é omitido quando não há frase conhecida para o status.
   */
  toJSON(): Record<string, unknown>;
}
```

Observação: se `isolatedDeclarations` reclamar do retorno `Record<string, unknown>`, usar uma `interface ProblemBody` não exportada no próprio `src/error.ts`. Não criar nome público novo. Validar com `pnpm typecheck`.

Implementação de referência para `toJSON()`:

```ts
toJSON(): Record<string, unknown> {
  const unhandled = this.unhandled;
  return {
    ...(unhandled ? undefined : this.body),
    type: this.type ?? "about:blank",
    title: unhandled ? STATUS_PHRASES[this.status] : (this.statusText ?? STATUS_PHRASES[this.status]),
    status: this.status,
    detail: unhandled ? "HTTPError" : this.message,
    instance: this.instance,
    data: unhandled ? undefined : this.data,
  };
}
```

`undefined` some no `JSON.stringify`, então `title` e `instance` ausentes não aparecem no corpo.

```ts
// src/utils/internal/status-text.ts

/**
 * Frases padrão (RFC 9110 e registro IANA) para os status de erro 4xx e 5xx.
 * Status fora da tabela não têm frase: o `title` do problem details é omitido.
 */
export const STATUS_PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  // ...demais códigos 4xx e 5xx do registro IANA...
  500: "Internal Server Error",
  // ...
};
```

```ts
// src/response.ts

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  let headers: Headers = error.headers ? new Headers(error.headers) : new Headers();
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  // Applied last so the h3 problem media type wins over any `content-type` from the error or `errHeaders` (RF-07)
  headers.set("content-type", "application/problem+json");
  return new FastResponse(
    JSON.stringify(
      {
        ...error.toJSON(),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    {
      status: error.status,
      statusText: error.statusText,
      headers,
    },
  );
}
```

Pontos de atenção na implementação:
- `new Headers(error.headers)` copia cada `set-cookie` separadamente. Confirmar com o teste `getSetCookie()` de `test/errors.test.ts:48`.
- A ordem de `mergeHeaders` com `errHeaders` mantém `set-cookie` como antes (`src/response.ts:243-252`).
- Nenhuma mudança em `HTTPError.isError`, em `toError` (`src/response.ts:73-84`) nem em `prepareResponse`.

---

## 5. Estratégia de testes

Seguindo o fluxo de correção de bug do AGENTS.md (teste de regressão primeiro, ver que falha, depois implementar), mesmo para a feature, porque ela altera respostas existentes.

**a) Testes novos em `test/errors.test.ts`** (novo `describe("problem details")`, usando `describeMatrix`, o que cobre RF-09 nos modos web e node):
- RF-01: 404 com mensagem em português. Asserts: status 404, `content-type` `application/problem+json`, corpo com `toEqual` exato em `{ type, title, status, detail }` (sem `statusText`, `unhandled` ou `message`).
- RF-03: `type` e `instance` aparecem no corpo.
- RF-04: `throw new Error("senha do banco: 123")` com `t.app.config.debug = false`. Asserts: corpo sem `"senha do banco"`, `detail` = `"HTTPError"`, status 500, `title` = `"Internal Server Error"`.
- RF-04 (regressão de D-04): `Error` com `status: 403` e `statusText: "Leaky"`, não tratado. `title` deve ser `"Forbidden"`, não `"Leaky"`.
- RF-05: com `debug` ligado, `stack` é array de strings; com `debug` desligado, a chave `stack` não existe.
- RF-06: `data: { campo: "x" }` e `body: { codigo: "E42" }` aparecem no nível superior.
- RF-06 (D-03): `body: { status: 999, title: "x" }` não sobrescreve os membros da RFC.
- RF-07: `headers: { "x-request-id": "abc", "content-type": "text/plain" }` → `x-request-id: abc` e `content-type: application/problem+json`.
- R4/D-04: status sem frase (ex.: `499` sem `statusText`) → corpo sem a chave `title`.

**b) Teste unitário novo `test/unit/error.test.ts`** (sem HTTP):
- RF-02: `new HTTPError({ status: 403, type, instance })` expõe `error.type` e `error.instance`. Sem os campos, ambos são `undefined`.
- D-05: `new HTTPError({ cause: { type: "x", instance: "y", status: 400 } })` não herda `type` nem `instance`.
- D-04: `toJSON()` de erro não tratado ignora `statusText`.
- D-07: `error.unhandled` e `error.statusText` continuam na instância.

**c) Tipos:** em `test/unit/types.test-d.ts`, `expectTypeOf` para `ErrorInput` aceitando `type` e `instance`, e para `HTTPError.type`/`instance` sendo `string | undefined`.

**d) Ajuste de testes existentes** conforme a tabela da seção 3. Nenhum assert de dado é removido: ao trocar `message` por `detail`, a verificação do valor é mantida.

**e) Export snapshot:** `test/unit/package.test.ts` deve passar sem alteração (prova de que não há nome público novo).

**f) Comandos de verificação:**
1. `pnpm vitest run test/errors.test.ts` (regressão antes e depois).
2. `pnpm vitest run test/unit` (unitários e tipos).
3. `pnpm vitest run` (suíte completa, RF-08).
4. `pnpm typecheck` e `pnpm lint` (RF-10).
5. `pnpm build` e depois `pnpm vitest run test/dist.test.ts`, porque `dist.test.ts:57` lê o build.

---

## 6. Riscos

- **R-01 — Quebra de clientes (PRD R1).** Consumidores que leem `message`, `statusText`, `unhandled` ou checam `application/json` vão falhar. Mitigação: confirmar P1 antes de implementar; changelog como breaking; se P3 for revista, `unhandled` e `statusText` podem voltar como extensão (ver D-07), sem mudança de arquitetura.
- **R-02 — Vazamento de texto via `statusText` em erros não tratados.** Um `Error` com `statusText` interno poderia aparecer no corpo. Mitigação: D-04 (título de não tratado sempre vem da tabela) e o teste de regressão de RF-04 descrito na seção 5a. A status line (`src/response.ts:376`) ainda usa `error.statusText`, como hoje; é o comportamento atual, não uma regressão.
- **R-03 — Sobrescrita de membros por `body`.** Quem usava `body: { status }` ou `body: { title }` para mudar o corpo vai ver outro resultado (D-03). Mitigação: documentar no changelog junto com R-01.
- **R-04 — `toJSON()` muda o retorno público.** Quem chama `JSON.stringify(err)` ou `err.toJSON()` recebe o formato novo. Mitigação: é consistente com a resposta; mencionar no changelog. Não há consumidor interno além de `src/response.ts:368`.
- **R-05 — Tipagem de `toJSON()`.** `isolatedDeclarations` pode exigir retorno explícito não exportado (seção 4). Mitigação: `pnpm typecheck` cedo, depois de alterar `src/error.ts`.
- **R-06 — Tabela de frases.** Erro de digitação ou frase desatualizada gera `title` errado sem falhar nenhum teste. Mitigação: testar pelo menos 404, 422, 500 e um código sem frase (499), e conferir a tabela contra o registro IANA na revisão.
- **R-07 — Testes de `handler.test.ts` e `proxy.test.ts`.** Algumas asserções estão em erros de validação, que passam por `createValidationError` (`src/utils/internal/validate.ts:217-225`) e continuam sendo `HTTPError`. Conferir linha a linha na implementação; a seção 3 marca os casos ainda não confirmados.
- **R-08 — `iterable.test.ts:145`.** Não confirmei se o erro dali é `HTTPError`. Confirmar ao implementar.
- **R-09 — Acoplamento com `rules/` e `tracing`.** Não encontrei dependência do formato de corpo em `src/rules/*` nem em `src/tracing.ts` (grep de `toJSON` e de `statusText` no corpo). Os testes desses módulos devem continuar passando; se algum falhar, é regressão e deve ser reportada, não ajustada às cegas.

---

## 7. Pendências antes da implementação

1. Confirmar P1 (formato novo como padrão, sem opção) com quem definiu o pedido. Sem essa confirmação, não implementar.
2. Confirmar D-03 a D-07 se houver objeção; cada uma é independente e pode ser trocada sem refazer as outras.
3. Confirmar com a equipe a escrita da entrada de changelog (breaking).
