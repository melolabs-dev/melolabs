# Especificação técnica — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md`. Este documento não altera código; descreve como implementar.

## 1. Estado atual (conferido no código)

- `errorResponse()` (`src/response.ts:358`) monta o corpo com `{ ...error.toJSON(), stack }`, serializa com `JSON.stringify` (indentação 2 se `debug`, `src/response.ts:372`) e parte de `jsonHeaders` (`src/response.ts:360-361`), cujo valor é `application/json;charset=UTF-8` (`src/response.ts:270-272`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) produz `{ status, statusText, unhandled, message, data, ...body }`. Em erro `unhandled`, `message` vira `"HTTPError"` e `data`/`body` somem.
- `errorResponse` é chamado em um único ponto, `src/response.ts:173`, dentro de `prepareResponse`. Esse ponto cobre erro lançado, `throw 404` (`toError`, `src/response.ts:77-79`), 404 de rota inexistente (`kNotFound`, `src/response.ts:139-144`), validação (`src/utils/internal/validate.ts:217-232`), limite de corpo e retorno de `onError` (reentrada com `nested`, `src/response.ts:161-166`). Não há outro renderizador de erro em `src/` (grep por `application/json` e `toJSON`).
- Já existe uma tabela de frases de status em `src/utils/response.ts:347`, mas só cobre 204 e 3xx, é privada e usada por `noContent`/`redirect`. Não serve para `title`.
- `ErrorInput` estende `Partial<ErrorBody>` (`src/error.ts:6`) e `HTTPError implements ErrorBody` (`src/error.ts:74`). O construtor lê `status`, `statusText`, `headers` e `unhandled` de `details` e de `details.cause` (`src/error.ts:172-206`).
- `src/utils/json-rpc.ts:483` menciona o mascaramento de `HTTPError.toJSON()` apenas em comentário. JSON-RPC tem formato próprio e está fora de escopo.

## 2. Decisões de arquitetura

### D-01 — Onde declarar `type` e `instance`

- **Alternativas:** (a) acrescentar só em `ErrorInput` e na classe; (b) acrescentar em `ErrorBody`, herdado por `ErrorInput` e implementado por `HTTPError`; (c) novo tipo exportado.
- **Escolha: (b).** `ErrorInput` já deriva de `Partial<ErrorBody>` (`src/error.ts:6`) e a classe `implements ErrorBody` (`src/error.ts:74`), então um só ponto de declaração mantém entrada e instância coerentes. (c) violaria "nenhum outro nome público novo". Em (a) `ErrorBody` e a classe divergiriam.
- Contrato: `type?: string` e `instance?: string` em `ErrorBody` (após `message`, `src/error.ts:51`); `readonly type: string | undefined` e `readonly instance: string | undefined` na classe (após `unhandled`, `src/error.ts:119`). Tipos explícitos por causa de `isolatedDeclarations`.

### D-02 — Leitura de `type`/`instance` também de `cause`

- **Alternativas:** só de `details`; de `details` e `details.cause`.
- **Escolha:** de ambos, na mesma forma de `unhandled` (`src/error.ts:205-206`): `details?.type ?? details?.cause?.type ?? undefined`. Exigência do RF-03 ("como já acontece com `status`").
- **Cuidado:** usar `typeof === "string"` para aceitar só strings. `type`/`instance` vêm de um objeto que pode ser `Error` de terceiros (por exemplo, um erro com `type` numérico); valor não string é ignorado. Isso evita emitir lixo no corpo.

### D-03 — Construção do corpo: helper interno em `utils/internal/problem.ts`

- **Alternativas:** (a) montar tudo em `toJSON()`; (b) montar tudo em `errorResponse()`; (c) helper interno único, chamado por `toJSON()`, e `errorResponse` só acrescenta `stack`.
- **Escolha: (c).** Mantém `error.ts` e `response.ts` curtos (meta < 200 LoC, AGENTS.md) e põe a regra de segurança de `unhandled` num só lugar. O helper não é exportado em `src/index.ts`.
- Novo arquivo `src/utils/internal/problem.ts` com:
  - `problemDetails(error: HTTPError): Record<string, unknown>` (uso interno);
  - `STATUS_PHRASES: Record<number, string>` (privado ao módulo) com as frases do RFC 9110 para 1xx–5xx usuais, incluindo `418: "I'm a Teapot"` e `422: "Unprocessable Content"`, consistente com `src/utils/query.ts:77`.
- Regras de `problemDetails` (ordem das chaves: `type`, `title`, `status`, `detail`, `instance`, `data`, extensões):
  1. `title = error.statusText ?? STATUS_PHRASES[status]`. Em `unhandled`, `title` vem **só** da tabela, ignorando `statusText` (que pode vir de `cause` arbitrário, `src/error.ts:180-185`). Status sem frase: `title` omitido.
  2. `detail = error.message`, omitido se igual a `title`. Em `unhandled`: sem `detail`, `type`, `instance`, `data` nem `body` (RF-05).
  3. Extensões: `{ ...body }` entra primeiro; depois cada membro padrão é atribuído **apenas se definido** na instância. Atribuir `undefined` apagaria `body.type` do usuário, por isso a atribuição condicional (RF-04). `data` é atribuído antes de espalhar `body`, preservando o comportamento atual em que `body.data` vence (`src/error.ts:233-234`).
  4. `status` e `title` sempre vencem `body`; `title` só quando existe valor.

### D-04 — `toJSON()` passa a devolver o formato novo

- **Alternativas:** (a) manter `toJSON()` antigo e criar outro método; (b) `toJSON()` devolve problem details.
- **Escolha: (b).** (a) criaria nome público novo (proibido). `toJSON()` é a fonte única do corpo, e quem serializa um `HTTPError` por conta própria passa a ver o mesmo corpo da fiação (premissa do PRD, §4). É breaking para quem lia `message`/`statusText`/`unhandled` de `toJSON()`; registrar na mensagem de versão.
- Assinatura: `toJSON(): Record<string, unknown> & { status: number }` (explícita, `isolatedDeclarations`). Corpo: `return problemDetails(this)`. Substitui `src/error.ts:226-236`. A guarda de `unhandled` fica dentro do helper.
- Atualizar o comentário de `src/utils/json-rpc.ts:480-483` ("masks them exactly like `HTTPError.toJSON()`"), que continua verdadeiro em essência (a máscara existe), mas cita o formato antigo. Mudança só de comentário, opcional.

### D-05 — Content-Type e precedência de headers

- **Alternativas:** (a) trocar o valor de `jsonHeaders` (`src/response.ts:270`), afetando todo JSON; (b) criar `problemHeaders` ao lado, usado só por `errorResponse`.
- **Escolha: (b).** (a) mudaria o `content-type` de respostas JSON não erro (`src/response.ts:312`, `:318`), proibido pelo PRD (RF-07, "não alteradas"). Valor: `application/problem+json;charset=UTF-8` (mesmo charset atual, RF-01), em `FrozenHeaders`, definido junto de `jsonHeaders`.
- `errorResponse` usa `problemHeaders` nas linhas `src/response.ts:359-361`. A ordem de mescla não muda: base, depois `error.headers`, depois `errHeaders` (`src/response.ts:362-364`). Assim um `content-type` em `error.headers` continua vencendo (RF-06). `mergeHeaders` copia a base antes de `set` (`target = new Headers(base)`, `src/response.ts:243`), então o objeto congelado não é mutado.

### D-06 — `stack` em debug

- **Escolha:** mantém exatamente o código atual: `stack` é atribuído por último em `errorResponse` (`src/response.ts:369`). Efeito colateral preservado: `stack: undefined` fora de debug remove um `body.stack` de usuário, o que é desejável (não vaza stack). Indentação 2 em debug inalterada (`src/response.ts:372`).

### D-07 — Sem negociação nem opção

- **Alternativas:** flag em `H3Config`; negociação por `Accept`.
- **Escolha:** nenhuma; exigido pelo contrato (gatilho: nenhum). Não alterar `src/types/h3.ts`.

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/error.ts` | `:30-69` | `type?`/`instance?` em `ErrorBody`; atualizar doc de `message` (`:46-51`) para "vai em `detail`" |
| `src/error.ts` | `:114-119` | propriedades `readonly type`/`instance` |
| `src/error.ts` | `:205-209` | atribuição no construtor (D-02) |
| `src/error.ts` | `:226-236` | `toJSON()` delega ao helper (D-04); importar `./utils/internal/problem.ts` (junto de `:1`) |
| `src/utils/internal/problem.ts` | novo | `problemDetails` + tabela de frases (D-03) |
| `src/response.ts` | `:270-272` | acrescentar `problemHeaders` |
| `src/response.ts` | `:358-361` | `errorResponse` usa `problemHeaders` |
| `src/utils/json-rpc.ts` | `:480-483` | só comentário (opcional) |
| `src/index.ts` | `:72` | **sem mudança**; nada novo é exportado |
| `docs/` | — | fora de escopo |

Não mexer em `src/response.ts:173` (único chamador), `prepareResponse` nem `toError`.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  // ...membros atuais
  /** URI reference identifying the problem type (RFC 9457 `type`). Omitted means `about:blank`. */
  type?: string;
  /** URI reference identifying this occurrence (RFC 9457 `instance`). */
  instance?: string;
}
class HTTPError {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): Record<string, unknown> & { status: number };
}

// src/utils/internal/problem.ts (não exportado no índice público)
export function problemDetails(error: HTTPError): Record<string, unknown> & { status: number };
```

Exemplos de corpo:

| Entrada | Corpo |
| --- | --- |
| `{status:404, statusText:"Not Found", message:"Usuário 42 não existe"}` | `{"title":"Not Found","status":404,"detail":"Usuário 42 não existe"}` |
| `{status:403, type:"https://example.com/probs/x", instance:"/c/12"}` | `{"type":"https://example.com/probs/x","title":"Forbidden","status":403,"detail":"HTTPError 403","instance":"/c/12"}` |
| `{status:422, data:{campo:"email"}, body:{code:"E_VALID"}}` | `{"title":"Unprocessable Content","status":422,"detail":"HTTPError 422","data":{...},"code":"E_VALID"}` |
| `new Error("senha do banco: x")` | `{"title":"Internal Server Error","status":500}` |
| `GET /nada` | `{"title":"Not Found","status":404,"detail":"Cannot find any route matching [GET] http://.../nada"}` |

Observação: a mensagem padrão `"HTTPError <status> [<statusText>]"` (`src/error.ts:193`) passa a aparecer em `detail` quando não há `message` nem `statusText`. É ruidosa; ver risco R-03.

## 5. Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever primeiro os testes novos, vê-los falhar, depois implementar.

**Testes novos** (`test/problem-details.test.ts`, com `describeMatrix`, modos web e node), um por critério de aceite:
- RF-01: `content-type` começa com `application/problem+json`, corpo JSON válido.
- RF-02: `title` de `statusText`; `title` da tabela quando não há `statusText`; `detail` omitido se `message === title`; ausência de `message`/`statusText`/`unhandled` e de `type`.
- RF-03: `error.type`/`error.instance` na instância; corpo idêntico; leitura via `cause`; valor não string ignorado.
- RF-04: `data` e `body`; colisão `body: { title, type, status }` (vence a instância; `body.type` sobrevive quando a instância não define `type`).
- RF-05: `new Error("senha do banco: x")` sem `debug`: 500, `title` genérico, a string não aparece; repetir com `unhandled: true` e com `type`/`instance`/`data`/`body`/`statusText` presentes (nada vaza).
- RF-06: `debug: true` com `x-trace`; `stack` como `string[]`; `content-type` definido em `error.headers` prevalece.
- RF-07: 404 de rota inexistente, `throw 404`, validação, limite de corpo, `onError` devolvendo `HTTPError`, e `onError` devolvendo `Response` próprio (inalterada, ainda `application/json` se for o caso).
- Unitário de `problemDetails` e `toJSON()` em `test/unit/`: status sem frase, ordem de chaves.
- Tipos: caso em `test/unit/types.test-d.ts` aceitando `type`/`instance` em `ErrorInput`.

**Testes existentes a ajustar** (mantendo o que verificam):

| Teste | Mudança |
| --- | --- |
| `test/errors.test.ts:44` | `content-type` esperado vira `application/problem+json;charset=UTF-8` |
| `test/errors.test.ts:78-83` | `statusText`/`message` viram `title: "Unprocessable"`, `status: 422`, `data`, `topLevel`; `message`/`statusText` ausentes |
| `test/errors.test.ts:98-103` | idem |
| `test/errors.test.ts:140,146-151` | `toMatch("application/problem+json")`; `title: "Bad Request"`, `data.message` |
| `test/errors.test.ts:257,309,384,420,442` | `unhandled: true` no corpo vira `title: "Internal Server Error"` + `not.toHaveProperty("unhandled")`/`detail`. O estado `unhandled` continua verificado por `t.errors[0].unhandled` (já presente em `:259`, `:351`; acrescentar nos demais) |
| `test/errors.test.ts:350` | `message: "HTTPError"` vira `title: "Internal Server Error"` e `not.toContain("secret")` no texto |
| `test/app.test.ts:205` | `.statusText` vira `.title` (`"test"`) |
| `test/dist.test.ts:57` | `.message` vira `.detail`; também usa `dist`, exige build (`pnpm build`) |
| `test/iterable.test.ts:145` | `.message` vira `.detail` |
| `test/rules/cache.test.ts:251` | `.message` vira `.detail` |

Pontos a conferir ao rodar a suíte, pois asserções por regex/`toMatchObject` em `validate.test.ts` (`:290`, `:381`), `handler.test.ts` (`:278`, `:298`, `:329`) e `router.test.ts:111` leem `data.message` (inalterado) ou texto de rota (agora em `detail`). `test/security.test.ts:556`, `test/happydom.test.ts:41` e `test/proxy.test.ts:1531` afirmam JSON de sucesso e **não mudam**. Rodar `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`.

## 6. Riscos

- **R-01 Breaking de fiação.** Clientes que leem `message`/`statusText`/`unhandled` ou `application/json` quebram. É pedido pelo contrato; comunicar como breaking. Recomenda-se confirmação do dono do pedido antes de mesclar.
- **R-02 Vazamento em `unhandled`.** Qualquer membro novo pode vazar. Mitigação: guarda única no helper (D-03.2), `title` só da tabela, teste de RF-05 com `statusText`/`type`/`instance` presentes.
- **R-03 `detail` ruidoso.** Mensagem padrão `"HTTPError 403"` vira `detail`. Segue o PRD (`detail` = `message`). Alternativa não adotada: suprimir `detail` quando `message` é a mensagem gerada; exigiria rastrear essa origem no construtor e diverge do PRD. Documentar no teste.
- **R-04 Colisão de extensões.** `body.title`/`body.status` são sobrescritos; `body.type` só se a instância definir `type`. Testado.
- **R-05 `title` ausente** para status sem frase. A RFC permite omitir; documentado no teste unitário.
- **R-06 Consumidores de `toJSON()`** (Nitro, `onError` de terceiros) veem o formato novo (D-04).
- **R-07 `dist.test.ts`** testa o artefato; precisa `pnpm build` antes e pode falhar em ambiente sem build.
- **R-08 Tamanho/lint.** `isolatedDeclarations` exige tipos de retorno explícitos em `toJSON` e nas propriedades; `oxfmt` formata o arquivo novo. Tabela de frases sem exportação pública (conferir `test/unit/package.test.ts` e `meta.test.ts` para snapshots de exports).
