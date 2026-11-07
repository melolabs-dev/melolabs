# Techspec — Problem details (RFC 9457) como formato padrão de erro no h3

Referências: issue h3js/h3#1384, contrato #1384-B (`sdd/pedido.md`), requisitos RF-01..RF-09 (`sdd/prd.md`).
Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `e139a79`).

## 1. Estado atual (resumo verificado)

- `HTTPError#toJSON()` (`src/error.ts:226-236`) emite `status`, `statusText`, `unhandled`, `message` (mascarado como `"HTTPError"` se `unhandled`), `data` e o spread de `body` **por último** (portanto hoje `body` pode sobrescrever `status`).
- `errorResponse()` (`src/response.ts:358-380`) é o único ponto que transforma `HTTPError` em `Response`. Chama `error.toJSON()` (`:368`), acrescenta `stack` só em debug (`:369`) e usa `jsonHeaders` (`:360-361`), definido em `src/response.ts:270-272` como `application/json;charset=UTF-8`. `jsonHeaders` também é usado por respostas que não são erro (`:312`, `:318`) — não pode ser alterado.
- `prepareResponse()` (`src/response.ts:129`) converte tudo em `HTTPError`: `kNotFound` → 404 (`:139-144`), `Error` genérico → `new HTTPError(val)` com `unhandled = true` (`:146-155`), e chama `errorResponse` em `:173`. O hook `onError` do usuário passa por aqui (`:159-166`); a resposta de um `onError` que devolve valor próprio não é tocada.
- `toError()` (`src/response.ts:73-83`) e os adaptadores (`src/adapters.ts:122,143,145,149,152`) criam `HTTPError` com `unhandled: true`; todos acabam em `errorResponse`.
- Erros "em formato HTTPError" de outros pacotes passam por `HTTPError.isError` (`src/error.ts:129-133`) e vão a `errorResponse` sem serem instância de `HTTPError`. Exemplo: `BodyTooLargeError` do srvx (`node_modules/.pnpm/srvx@1.0.6/.../body-limit.mjs:61-76`) tem `toJSON()` próprio com apenas `status`, `statusText`, `message`; **não** tem `title`, `detail`, `type`, `instance`, `data`, `body` nem `unhandled`. `src/utils/body.ts:65-69` re-lança esse erro como está.
- `STATUS_TEXT` em `src/utils/response.ts:347-354` cobre só 204/3xx (não serve para `title`) e não é exportado.
- O JSON-RPC (`src/utils/json-rpc.ts:476-498`) tem formato próprio (`createJsonRpcError`), apenas replica a regra de mascaramento; está fora do escopo.

## 2. Decisões de arquitetura

### D-01 — Um serializador interno único, usado por `toJSON()` e por `errorResponse`

**Alternativas**

- (a) Alterar só `toJSON()` e manter `errorResponse` chamando `error.toJSON()`.
- (b) Montar o objeto direto em `errorResponse`, deixando `toJSON()` como está.
- (c) Função interna `toProblemDetails(error)` em arquivo `_`/internal; `HTTPError#toJSON()` delega a ela e `errorResponse` também a chama diretamente.

**Escolha: (c).** Em (a), erros de formato HTTPError de outros pacotes (srvx `BodyTooLargeError`) têm `toJSON()` próprio sem `title`/`detail`, então RF-08 (corpo grande demais) não seria atendido. Em (b), `toJSON()` (RF-04) e a resposta divergiriam. Em (c) o corpo é calculado a partir dos campos públicos do erro (`status`, `statusText`, `message`, `unhandled`, `data`, `body`, `type`, `instance`), lidos de forma defensiva (podem ser `undefined` em erros externos), e nunca de `error.toJSON()`. A função fica em `src/utils/internal/problem.ts` (novo, não exportado em `src/index.ts`; atende "nenhum nome público novo" e a convenção de helpers internos de `AGENTS.md`). Quando o erro é uma instância de `HTTPError`, `toJSON()` e `errorResponse` produzem o mesmo objeto.

### D-02 — Mapeamento dos membros padrão

| Membro     | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| `status`   | `error.status` (sempre; imutável por `body`)                                       |
| `title`    | `error.statusText` se houver; senão texto padrão do status (D-03); senão `"Error"` |
| `detail`   | `error.message` se tratado; se `unhandled`, ver D-05                               |
| `type`     | `error.type`, apenas se definido (nada de `"about:blank"` implícito)               |
| `instance` | `error.instance`, apenas se definido                                               |

Chaves ausentes são **omitidas** do objeto (não atribuídas como `undefined`), para `toJSON()` ficar limpo mesmo em `toEqual` estrito.

**Alternativas:** emitir `type: "about:blank"` por padrão (rejeitado: RF-04 proíbe valor padrão e a RFC trata ausência como `about:blank`); derivar `title` só do texto padrão ignorando `statusText` (rejeitado: RF-01 manda preferir `statusText`, que é a descrição curta já usada pelos utilitários, ex. `"Bad Request"` em `src/utils/body.ts:72`).

### D-03 — Tabela de texto padrão por status, interna

Para `title` sem `statusText` (ex.: `new HTTPError({ status: 404, message })`, `kNotFound` em `src/response.ts:140`) é preciso o texto padrão. Não existe tabela completa no projeto.

**Alternativas:** (a) reutilizar `STATUS_TEXT` de `src/utils/response.ts:347` (só 6 códigos); (b) tabela nova em `src/utils/internal/status-text.ts`; (c) obter de `new Response(null,{status}).statusText` (vazio nos runtimes; inútil).

**Escolha: (b)**, tabela `Record<number,string>` com os códigos 4xx/5xx e 1xx–3xx comuns da RFC 9110, não exportada em `index.ts`. Status sem entrada usam o fallback por classe (`"Client Error"` / `"Server Error"` / `"Error"`). A tabela vai em arquivo próprio para respeitar "arquivos < 200 LoC" e não tocar `STATUS_TEXT`, que tem semântica restrita (comentário em `src/utils/response.ts:345-346`).

### D-04 — Extensões (`data`, `body`) e compatibilidade (decisões pendentes do PRD)

Resolução das duas decisões pendentes do PRD, justificada pelo conflito "substitui" vs. "não quebrar o que já existe" (`sdd/pedido.md`, Restrições):

- **Manter `message`, `statusText` e `unhandled` no corpo como membros de extensão** (a RFC 9457 §3.2 permite extensões). Isso preserva clientes e testes existentes que leem `message` (`test/errors.test.ts:82,102,350`) e `unhandled` (`:257,309,350,384,420,442`). `detail` e `message` carregam o mesmo texto; a duplicação é aceita para evitar quebra.
- **Alternativa rejeitada:** remover `message`/`statusText`/`unhandled` (alinha ao padrão mínimo, mas quebra consumidores sem necessidade; a RFC não exige remoção).
- **Precedência:** membros padrão (`type`, `title`, `status`, `detail`, `instance`) são aplicados **depois** do spread de `body` e vencem sempre (RF-05). As extensões de compatibilidade (`message`, `statusText`, `unhandled`, `data`) mantêm a precedência atual (o spread de `body` vem depois delas e pode sobrescrevê-las, como em `src/error.ts:234`). Ou seja: `{...compat, ...body}` seguido de `type/title/status/detail/instance` atribuídos por último; `body` não pode adicionar `type`/`instance` quando o erro não os define (a chave `body.type` é descartada).
- `stack` (debug) segue como extensão adicionada em `errorResponse` (`src/response.ts:369`), fora de `toProblemDetails`/`toJSON`, exatamente como hoje.

### D-05 — Erros não tratados (`unhandled`)

Com `unhandled: true`: `message` continua `"HTTPError"` (`src/error.ts:232`, preserva `test/errors.test.ts:350`), `data` e `body` não são emitidos, e `detail` **não** usa a mensagem original: usa o `title` (texto padrão do status ou `statusText`). Assim `detail` nunca vaza (RF-06). `title` de erro não tratado vem do `statusText` somente se existir; o construtor só o obtém de entrada explícita, o mesmo risco de hoje (`src/error.ts:180-185`, `toJSON` já o expunha).

**Alternativas:** `detail: "HTTPError"` (idêntico a `message`, sem valor semântico) ou omitir `detail` (RF-01 exige `detail`). Escolhido o texto padrão do status por ser legível e seguro.

### D-06 — `Content-Type: application/problem+json;charset=UTF-8` apenas para erros

**Alternativas:** (a) trocar `jsonHeaders` globalmente (quebra respostas não-erro: proibido em "Fora de escopo"); (b) cabeçalho condicional em `errorResponse`; (c) nova constante `problemHeaders`.

**Escolha: (c)**, constante `FrozenHeaders` ao lado de `jsonHeaders` (`src/response.ts:270`), usada nas linhas 360-361. Mantém o charset atual (RF-02) e o custo mínimo (objeto congelado, mesmo padrão). `error.headers` e `errHeaders` continuam mesclados por cima (`:360-364`); se o erro definir `content-type` próprio, ele vence como hoje (RF-07).

### D-07 — `type` e `instance` em `HTTPError`

Campos opcionais `type?: string` e `instance?: string` entram em `ErrorBody` (`src/error.ts:30-69`), que `ErrorInput` já estende via `Partial<ErrorBody>` (`:6`) — logo `ErrorInput` os herda sem edição extra. Em `HTTPError` entram como `readonly type: string | undefined` e `readonly instance: string | undefined` (`src/error.ts:74-119`), atribuídos no construtor junto de `data`/`body` (`:208-209`) a partir de `details` **ou** `details.cause` (mesmo padrão de `unhandled`, `:205-206`), o que cobre `HTTPError.status(...)` (`:144-150`, que faz spread de `details`), `new HTTPError(message, details)` (`:160-170`) e `cause` (RF-03).

**Alternativas:** colocar `type`/`instance` em `body` (rejeitado: contrato pede campos tipados e expostos); validar como URI (rejeitado: RFC permite referência relativa; PRD fixa "não validado"). Valores não-string são ignorados (`typeof === "string"`), para não repassar objetos arbitrários vindos de `cause`.

Atenção: `HTTPError implements ErrorBody` (`src/error.ts:74`) e `isError` (`:129`); nada a mudar neles. Os tipos `ErrorBody`, `ErrorInput`, `HTTPError` já são exportados em `src/index.ts:72`; nenhum export novo.

### D-08 — Superfície pública e demais camadas

Nenhum export novo em `src/index.ts`. `h3/rules` e `src/utils/proxy.ts:355,380` apenas lançam `HTTPError` e passam por `errorResponse`; nenhuma alteração. `src/utils/json-rpc.ts` fica inalterado (formato JSON-RPC próprio; só o comentário `:483` referencia `toJSON()`, ainda válido). Respostas devolvidas por `onError` do usuário continuam intactas.

## 3. Arquivos a alterar

| Arquivo                             | Linhas                       | Mudança                                                                                                                                                 |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/error.ts`                      | `30-69`                      | `ErrorBody`: adicionar `type?: string` e `instance?: string` com JSDoc (membros RFC 9457)                                                               |
| `src/error.ts`                      | `74-119`                     | `HTTPError`: propriedades `readonly type`, `readonly instance`                                                                                          |
| `src/error.ts`                      | `205-209`                    | construtor: atribuir `type`/`instance` (de `details` ou `details.cause`, só strings)                                                                    |
| `src/error.ts`                      | `226-236`                    | `toJSON()` delega a `toProblemDetails(this)`; atualizar tipo de retorno                                                                                 |
| `src/utils/internal/problem.ts`     | novo                         | `toProblemDetails()` (D-01, D-02, D-04, D-05)                                                                                                           |
| `src/utils/internal/status-text.ts` | novo                         | tabela de texto por status e fallback por classe (D-03)                                                                                                 |
| `src/response.ts`                   | `270-272`                    | adicionar `problemHeaders` (`application/problem+json;charset=UTF-8`)                                                                                   |
| `src/response.ts`                   | `358-380`                    | `errorResponse`: usar `problemHeaders` (`:360-361`) e `toProblemDetails(error)` (`:368`) em vez de `error.toJSON()`; manter `stack`/indentação em debug |
| `test/errors.test.ts`               | `44`, `140`                  | content-type esperado passa a `application/problem+json…`                                                                                               |
| `test/errors.test.ts`               | novo `describeMatrix`        | testes RF-01..RF-08 (seção 5)                                                                                                                           |
| `test/unit/types.test-d.ts`         | fim do arquivo               | tipos de `type`/`instance` em `ErrorInput`/`HTTPError`                                                                                                  |
| `docs/1.guide/1.basics/6.error.md`  | `37-49`, `53-60`, `76`, `90` | novo JSON de exemplo, campos `type`/`instance`, nota de `application/problem+json` e de compatibilidade (`message`/`statusText`/`unhandled`)            |

`src/response.ts:270` (`jsonHeaders`) e `src/utils/response.ts:347` (`STATUS_TEXT`) **não** mudam.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  // ...campos atuais...
  /** RFC 9457 `type`: URI de referência do tipo de problema. Ausente = "about:blank". */
  type?: string;
  /** RFC 9457 `instance`: URI de referência desta ocorrência. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): ProblemDetails; // Omit<ErrorBody, "body"> & ErrorBody["body"] ampliado com title/detail
}
```

```ts
// src/utils/internal/problem.ts  (interno, sem export em index.ts)
export function toProblemDetails(error: HTTPError | ErrorLike): Record<string, unknown>;
// ErrorLike = { status: number; statusText?: string; message: string; unhandled?: boolean;
//               data?: unknown; body?: Record<string, unknown>; type?: unknown; instance?: unknown }
```

Para `toJSON()` o retorno é tipado sem criar novo nome público: usar o tipo inline `Omit<ErrorBody, "body"> & { title: string; detail: string } & ErrorBody["body"]` (como o retorno atual já é um tipo anônimo, `src/error.ts:226`). O `isolatedDeclarations` exige anotação explícita de retorno (já presente).

Corpo resultante, exemplo RF-01/RF-04:

```json
{
  "type": "https://example.com/probs/x",
  "title": "Forbidden",
  "status": 403,
  "detail": "…",
  "instance": "/contas/42",
  "statusText": "Forbidden",
  "message": "…",
  "data": {}
}
```

Cabeçalho: `content-type: application/problem+json;charset=UTF-8`. Status, `statusText` e `headers` do erro inalterados (RF-07); HEAD/204/304 seguem sem corpo, pois `nullBody` (`src/response.ts:350-356`) só atua no caminho de não-`Response` e `errorResponse` produz `Response` — a conferir no teste (hoje HEAD já é tratado em `:234`).

## 5. Estratégia de testes

Todos em `describeMatrix` (`test/_setup.ts`), `ctx.app` fresco; rodar com `pnpm vitest run test/errors.test.ts`. Fluxo de correção de bug do `AGENTS.md`: escrever primeiro os testes novos, confirmar que falham, implementar, confirmar que passam.

| RF    | Teste (novo, em `test/errors.test.ts`)                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-01 | 404 com `message` próprio: `status`, `title` não vazio, `detail` igual à mensagem, sem chaves `type`/`instance` (`"type" in json === false`)                                                                                                     |
| RF-02 | `content-type` começa com `application/problem+json`; respostas não-erro seguem `application/json`                                                                                                                                               |
| RF-03 | `error.type`/`error.instance` via objeto, `HTTPError.status(..., { type })`, `new HTTPError(msg, { instance })`, `cause`; `undefined` quando omitidos (também em `test/unit/`, sem servidor)                                                     |
| RF-04 | corpo e `toJSON()` contêm `type`/`instance`; ausentes → sem chave nem `null`                                                                                                                                                                     |
| RF-05 | `data` sob `data`, `codigo` no topo, `body: { status: 200, title: "x", type: "y" }` não altera `status`/`title`/`type`                                                                                                                           |
| RF-06 | `throw new Error("segredo interno")` fora de debug: sem o texto, sem `stack`, `detail` sem mensagem, content-type problem; em debug `stack` presente (`config.debug`)                                                                            |
| RF-07 | 401 com `statusText` e `www-authenticate`; HEAD/304 sem corpo                                                                                                                                                                                    |
| RF-08 | rota inexistente (404), erro de validação (`readValidatedBody`), `BodyTooLargeError` via `bodyLimit`/`assertBodySize` (cobre erro externo sem `title`), `requireBasicAuth`, `onError` que não sobrescreve; todos com `status`, `title`, `detail` |
| D-01  | teste unitário de `toProblemDetails` com objeto "ErrorLike" externo (como o do srvx)                                                                                                                                                             |

**Ajustes em testes existentes (sem perder o que verificam):**

- `test/errors.test.ts:44` e `:140`: trocar `application/json…` por `application/problem+json…`.
- `test/errors.test.ts:82,102,350` e demais asserções de `message`/`unhandled`/`statusText` permanecem válidas por D-04 (são `toMatchObject`).
- `test/security.test.ts:556` e `test/proxy.test.ts:1531` verificam respostas **não-erro**: não mudam.
- Rodar a suíte completa e revisar quaisquer outras falhas por `content-type`/formato de corpo em `test/status.test.ts`, `test/validate.test.ts`, `test/body-limit.test.ts`, `test/auth.test.ts`, `test/handler.test.ts`, `test/query.test.ts`, `test/proxy.test.ts` (grep indica asserções de `message`/`statusText` nesses arquivos; esperado nenhuma quebra por D-04, mas não foi executado).

Validação final: `pnpm vitest run`, `pnpm lint`, `pnpm typecheck` (`package.json:46,54`). `pnpm fmt` para formatar o novo markdown/TS.

## 6. Riscos

1. **Quebra de compatibilidade visível:** o `content-type` muda para `application/problem+json`; clientes que comparam `application/json` exatamente quebram, mesmo mantendo `message`/`statusText`/`unhandled`. Documentar em `docs/1.guide/1.basics/6.error.md`. Sem opção de desativar (fora de escopo).
2. **Erros externos em formato HTTPError** (srvx) sem `toJSON` completo ou sem campos: mitigado por D-01 (leitura defensiva) e teste dedicado.
3. **Vazamento em `unhandled`:** `detail`/`title` não podem derivar de `message`. Teste RF-06 inclui a verificação de que a mensagem original não aparece em nenhum membro.
4. **Colisão de chaves:** `body` com `status`, `title`, `type`, `detail`, `instance` é ignorado nesses membros (D-04); comportamento antes diferente (`body` sobrescrevia `status`, `src/error.ts:234`) — aceito e coberto por RF-05.
5. **Duplicação `detail`/`message`** aumenta o corpo; aceito (D-04).
6. **`title` de status incomuns:** tabela interna incompleta cai no fallback por classe; testar 418, 499 e 599.
7. **Bundle/`test/dist.test.ts` e `test/unit/package.test.ts`:** arquivos novos em `src/utils/internal/` entram no bundle; conferir que nenhum export público novo aparece (`test/unit/package.test.ts`, `test/unit/meta.test.ts`) e o tamanho de bundle não explode (tabela pequena).
8. **Ponto não executado:** nenhuma suíte foi rodada na elaboração desta spec; as asserções existentes afetadas foram identificadas por leitura/grep, então podem existir outras a ajustar.
