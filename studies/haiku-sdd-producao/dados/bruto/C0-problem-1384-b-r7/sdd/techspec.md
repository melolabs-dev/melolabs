# Especificação técnica — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md`. Nenhum código do projeto é alterado por este documento.

## 1. Visão geral

Hoje toda resposta de erro HTTP passa por um único ponto: `errorResponse()` (`src/response.ts:358`), chamado por `prepareResponse()` (`src/response.ts:173`) e alimentado por `HTTPError.toJSON()` (`src/error.ts:226`). Esse funil cobre erro lançado, erro não tratado, `kNotFound` (convertido em `HTTPError` 404 em `src/response.ts:139-144`), `onError` de middleware (`src/utils/middleware.ts:37-63`, que relança o erro até chegar a `prepareResponse`), validação (`src/utils/internal/validate.ts:120,218`) e o adaptador Node (`src/adapters.ts:122-152`, que embrulha causas em `HTTPError` com `unhandled: true`). A mudança é, portanto, pequena e concentrada em dois arquivos de produção: `src/error.ts` e `src/response.ts`, mais um helper interno.

## 2. Decisões de arquitetura

### D-01 — Ponto único de mudança: `HTTPError.toJSON()` + `errorResponse()`

- **Alternativas:** (a) montar o corpo RFC 9457 só em `errorResponse()`; (b) montar tudo em `toJSON()`; (c) criar um serializador novo exportado.
- **Escolha:** `toJSON()` passa a devolver os membros padrão (`type`, `title`, `status`, `detail`, `instance`) mais os campos legados; `errorResponse()` só troca o cabeçalho e acrescenta `stack`.
- **Justificativa:** `toJSON()` é o contrato de serialização já existente e é o lugar onde o mascaramento de `unhandled` já vive (`src/error.ts:227-235`); manter a regra de vazamento junto dela evita duplicar a lógica de RF-05. (c) viola a restrição de "nenhum outro nome público novo". O JSON-RPC **não** usa `toJSON()` (monta o próprio envelope em `src/utils/json-rpc.ts:484-498`, lendo `status`/`message`/`data` direto do erro), logo o RF-08 se cumpre sem tocar nele.

### D-02 — Content-Type `application/problem+json;charset=UTF-8` via headers congelados próprios

- **Alternativas:** (a) reutilizar `jsonHeaders` e sobrescrever `content-type` em cada chamada; (b) novo `FrozenHeaders` dedicado a erros; (c) negociar por `Accept` (fora de escopo, PRD §3).
- **Escolha:** (b). Criar `problemHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`) com `content-type: application/problem+json;charset=UTF-8`, e usá-lo em `errorResponse()` no lugar de `jsonHeaders` (`src/response.ts:359-361`).
- **Justificativa:** `jsonHeaders` continua servindo respostas de sucesso (`src/response.ts:311,318`), que não mudam. Manter o mesmo padrão `/* @__PURE__ */ new FrozenHeaders(...)` preserva o tree-shaking e a imutabilidade. `mergeHeaders` (`src/response.ts:243`) continua permitindo que `HTTPError.headers` sobrescreva `content-type` (comportamento atual preservado).

### D-03 — `type` e `instance` entram em `ErrorBody` (e portanto em `ErrorInput`)

- **Alternativas:** (a) adicionar só em `ErrorInput` (`src/error.ts:6`); (b) adicionar em `ErrorBody` (`src/error.ts:30`), de que `ErrorInput` herda via `Partial<ErrorBody>` e que `HTTPError` implementa (`src/error.ts:74`).
- **Escolha:** (b), como `type?: string` e `instance?: string`.
- **Justificativa:** `HTTPError implements ErrorBody`, e `ErrorInput extends Partial<ErrorBody>`; uma única declaração cobre o construtor, `HTTPError.status(...)` (`src/error.ts:144-150`, que repassa `details` com spread) e o tipo de retorno de `toJSON`. Nenhum export novo: `ErrorBody`/`ErrorInput` já são exportados (`src/index.ts:72`).

### D-04 — Propriedades `readonly type: string | undefined` e `readonly instance: string | undefined`

- **Alternativas:** (a) opcionais (`type?: string`); (b) `string | undefined` explícito, como `statusText`/`data`/`body` (`src/error.ts:92,107,112`).
- **Escolha:** (b), anotadas explicitamente (exigência de `isolatedDeclarations`), declaradas junto das demais (`src/error.ts:82-119`).
- **Justificativa:** consistência com o estilo existente; RF-03 pede `undefined` quando ausentes. Atribuição no construtor depois de `this.body` (`src/error.ts:209`), lendo `details` e `details.cause` com `typeof === "string"` (ignora valores não-string vindos de causas arbitrárias, p.ex. `error.type` numérico de libs). Segue o padrão `details ?? cause` de `status`/`statusText` (`src/error.ts:172-185`). `type` herdado de `cause` só é lido se `cause` for objeto; strings vazias são tratadas como ausentes.

### D-05 — Mapeamento dos membros RFC 9457 e política de precedência

Corpo de `toJSON()` (ordem de chaves estável):

| Membro | Origem | Regra |
| --- | --- | --- |
| `type` | `this.type` | `"about:blank"` se ausente ou se `unhandled` |
| `title` | `statusText` ou frase-padrão do status | `statusText` quando houver, senão `statusPhrase(status)`; se o status não tiver frase conhecida, omitir |
| `status` | `this.status` | sempre |
| `detail` | `this.message` | omitido se `unhandled` |
| `instance` | `this.instance` | omitido se `undefined` ou `unhandled` (nunca `null`) |
| `statusText`, `unhandled`, `message`, `data` | como hoje (`src/error.ts:228-233`) | compat aditiva (RF-06) |
| extensões de `body` | `...this.body` | espalhadas **antes** dos membros padrão |

- **Alternativas de precedência:** (a) `body` por último, como hoje (`src/error.ts:234`), permitindo que sobrescreva tudo; (b) membros padrão (`type`, `title`, `status`, `detail`, `instance`) por último, enquanto os campos legados mantêm a ordem atual.
- **Escolha:** (b). Espalhar `this.body` primeiro e depois os cinco membros padrão; os campos legados (`message`, `statusText`, `unhandled`, `data`) continuam sendo sobrescritíveis por `body`, como já eram (comportamento atual preservado). Para tanto a ordem é: legados → `...body` → padrão.
- **Justificativa:** RF-06 proíbe `status` do corpo divergir do HTTP e proíbe sobrescrever os membros padrão. Efeito colateral aceito e registrado em R-02: um `body.type` ou `body.title` do usuário deixa de prevalecer.
- **`unhandled`:** mantém-se o mascaramento (`message: "HTTPError"`, sem `data`, sem `body`); `detail` e `instance` omitidos e `type` fixo em `about:blank` (RF-05). `title` usa a frase-padrão do status (não a `message`), portanto nada interno vaza. Atenção: hoje `statusText` de erro não tratado já é emitido (`src/error.ts:230`) e vem de `cause`; isto não é alterado, mas `title` de não tratado usa apenas `statusText` se existir, por coerência com o campo legado.

### D-06 — Frase-padrão do status em helper interno, sem usar `node:http`

- **Alternativas:** (a) `STATUS_CODES` de `node:http` (viola "web standards first" e quebra Workers/Deno/browser); (b) tabela interna mínima; (c) usar sempre `statusText` e cair em `"HTTPError"`.
- **Escolha:** (b): novo arquivo interno `src/utils/internal/status-phrase.ts` com `statusPhrase(status: number): string | undefined`, não exportado de `src/index.ts`. Cobre os códigos 4xx/5xx comuns (400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 413, 415, 418, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500–511); para códigos fora da tabela devolve `undefined` e `title` é omitido (o membro é opcional na RFC).
- **Justificativa:** o repositório não tem hoje tabela de frases (`grep` de `STATUS_CODES` em `src/` sem resultados). Arquivos internos ficam em `src/utils/internal/` com helper no fim (AGENTS.md), menos de 200 linhas. É um nome interno, não público.

### D-07 — `stack` e debug continuam em `errorResponse()`

- **Escolha:** manter `stack` fora de `toJSON()`, como em `src/response.ts:369`, e a indentação por `debug ? 2 : undefined` (`src/response.ts:372`). Só `jsonHeaders` → `problemHeaders` e o spread de `toJSON()` mudam.
- **Justificativa:** `stack` depende de `config.debug`, que `toJSON()` não conhece. Cumpre RF-07 sem alterar assinatura.

### D-08 — Tipo de retorno de `toJSON()`

- **Alternativas:** (a) manter `Omit<ErrorBody, "body"> & ErrorBody["body"]` (`src/error.ts:226`); (b) tipo explícito com os membros novos.
- **Escolha:** (a) é insuficiente porque `title`/`detail` não existem em `ErrorBody`. Usar um tipo inline `Omit<ErrorBody, "body"> & { title?: string; detail?: string } & ErrorBody["body"]`, sem nomear/exportar interface nova (restrição "nenhum nome público novo", requisito de `isolatedDeclarations` atendido por anotação inline).

### D-09 — Não alterar JSON-RPC, `h3/rules` nem adaptadores

- **Justificativa:** o envelope JSON-RPC está fora de escopo (PRD §3) e não consome `toJSON()` (`src/utils/json-rpc.ts:484-498`); `src/rules/handlers/headers.ts:38` apenas replica `isError`; `src/adapters.ts:122-152` produz `HTTPError` com `unhandled: true`, que passam pelo funil. Nada a mudar, só cobrir por teste (seção 5).

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/error.ts` | 30-69 | `ErrorBody`: adicionar `type?: string` e `instance?: string` com JSDoc (D-03) |
| `src/error.ts` | 82-119 | declarar `readonly type`/`readonly instance` (D-04) |
| `src/error.ts` | 205-209 | atribuir `type` e `instance` no construtor, lendo `details` e `details.cause` |
| `src/error.ts` | 226-236 | reescrever `toJSON()` conforme D-05 e D-08 |
| `src/utils/internal/status-phrase.ts` | novo | `statusPhrase()` interno (D-06) |
| `src/response.ts` | 270-272 | acrescentar `problemHeaders` (D-02) |
| `src/response.ts` | 358-380 | `errorResponse()` usa `problemHeaders` (linhas 359-361) |
| `src/response.ts` | 1-30 (imports) | nada novo necessário; `title` é montado em `error.ts` |
| `test/errors.test.ts` | 44, 140 | `application/json` → `application/problem+json` |
| `test/errors.test.ts` | novos casos | testes dos RF-01…RF-08 (seção 5) |
| `test/unit/` | novo `problem-details.test.ts` | testes unitários de `toJSON()` e `statusPhrase()` |
| `test/unit/types.test-d.ts` | existente | asserções de tipo para `type`/`instance` |

Lista de testes existentes a revisar (dependem do `Content-Type` ou do corpo exato de erro): `test/errors.test.ts:44,140` (content-type confirmado no código); `test/body.test.ts:457` (`statusText` de erro, continua válido por ser aditivo); `test/app.test.ts:205`; `test/proxy.test.ts:1025-1029`; `test/handler.test.ts`/`test/validate.test.ts`/`test/route.test.ts:72` (corpos de validação com `toEqual`/`toMatchObject` — verificar com a execução da suíte quais usam `toEqual` sobre corpo de erro e ajustar acrescentando os novos membros, sem remover asserções). `test/security.test.ts:556` e `test/proxy.test.ts:1531` são respostas de **sucesso** e **não** mudam. Como a lista de `toEqual` sobre corpos de erro não pôde ser confirmada só por leitura, a execução de `pnpm vitest run` é o critério.

## 4. Contratos e assinaturas

```ts
// src/error.ts
export interface ErrorBody<DataT = unknown> {
  status: number;
  statusText?: string;
  message: string;
  unhandled?: boolean;
  data?: DataT;
  body?: Record<string, unknown>;
  /** RFC 9457 `type`: URI de referência do tipo de problema. */
  type?: string;
  /** RFC 9457 `instance`: URI de referência desta ocorrência. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  toJSON(): Omit<ErrorBody, "body"> & { title?: string; detail?: string } & ErrorBody["body"];
}

// src/utils/internal/status-phrase.ts (interno, não exportado em src/index.ts)
export function statusPhrase(status: number): string | undefined;
```

Corpo de resposta (exemplo, RF-03/RF-06, `debug` desligado):

```json
{
  "status": 403,
  "statusText": "Forbidden",
  "message": "Saldo insuficiente",
  "data": {"campo": "email"},
  "traceId": "abc",
  "type": "https://example.com/probs/sem-saldo",
  "title": "Forbidden",
  "detail": "Saldo insuficiente",
  "instance": "/contas/12/saques/7"
}
```

(`undefined` some na serialização; o exemplo mostra todos os membros presentes só para ilustrar.) Cabeçalho: `Content-Type: application/problem+json;charset=UTF-8`.

## 5. Estratégia de testes

Seguir o fluxo "Bug Fix Workflow" do `AGENTS.md` adaptado: escrever primeiro os testes novos, confirmar que falham, implementar, confirmar que passam, rodar a suíte completa. Usar `describeMatrix` (modos `web` e `node`).

1. **RF-01:** `throw new HTTPError({ status: 400 })` → `content-type` começa com `application/problem+json` e contém `charset=UTF-8`; repetir para `throw 404`, rota inexistente (`kNotFound`), erro de middleware e erro de validação (`readValidatedBody`).
2. **RF-02:** corpo de `HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" })` → `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail`. Caso sem `statusText`: `title` vem de `statusPhrase`; status sem frase (ex. 599): sem `title`.
3. **RF-03:** `error.type`/`error.instance` na instância e no corpo; via `HTTPError.status(403, undefined, { type, instance })`; via `cause` objeto; `cause` com `type` não-string é ignorado.
4. **RF-04:** `new HTTPError("falhou")` e `throw 404` → `type: "about:blank"`, `"instance" in body === false`.
5. **RF-05:** `throw new Error("segredo interno")`, depois `throw Object.assign(new Error("x"), { type: "t", instance: "i" })` → 500, corpo sem `segredo interno`, sem `stack`/`data`/`detail`/`instance`, `type: "about:blank"`; confirmar também com `fromNodeHandler` (`src/adapters.ts:122`) lançando erro com campo `type`.
6. **RF-06:** `data`, `body.traceId`, `status: 422`; `body: { status: 200, type: "x", title: "y" }` não sobrescrevem os membros padrão; `body.message` continua sobrescrevendo `message` (compat).
7. **RF-07:** `debug: true` → `stack` array, indentação de 2 espaços, `x-id: 1` presente, `content-type` correto; `event.res.errHeaders` mesclado (já coberto em `test/errors.test.ts:30-48`, atualizar o `content-type` esperado).
8. **RF-08:** JSON-RPC: um handler que lança `HTTPError` continua retornando o envelope JSON-RPC com `application/json` (testes existentes de `test/json-rpc.test.ts` devem passar inalterados). `h3/rules`: rodar `test/rules/*`, sem mudanças esperadas.
9. **Tipos:** em `test/unit/types.test-d.ts`, `expectTypeOf<ErrorInput>().toHaveProperty("type")`, `HTTPError["type"]` é `string | undefined`.
10. **Regressão:** `pnpm vitest run` completo; depois `pnpm lint` (inclui typecheck) e `pnpm test`.

## 6. Riscos

- **R-01 — Clientes dependentes de `application/json` ou do corpo exato.** Mitigação: campos legados mantidos; avisar nas notas de versão (mudança sem opt-out é do contrato #1384-B).
- **R-02 — Colisão com extensões de `body`.** `body.type`/`body.title`/`body.detail`/`body.instance`/`body.status` passam a ser sobrescritos (D-05). Quem usava `body: { type: "x" }` perde o valor. Mitigação: documentar; teste dedicado.
- **R-03 — Vazamento em erro não tratado.** `type`/`instance` poderiam vir de uma `cause` arbitrária (erros de drivers). Mitigação: ignorar em `unhandled` dentro de `toJSON()` e exigir `typeof string` no construtor; teste com `fromNodeHandler`.
- **R-04 — `title` redundante com `statusText`/`detail` com `message`.** Corpo maior; aceito para compatibilidade (PRD §4).
- **R-05 — Cobertura de testes existentes incompleta nesta leitura.** Os testes com `toEqual` sobre corpo de erro (`validate`, `handler`, `route`) não foram todos inspecionados; a execução da suíte é a verificação final. Ajustar acrescentando os membros novos, sem remover asserções.
- **R-06 — `isolatedDeclarations`/`erasableSyntaxOnly`.** Todos os campos e o retorno de `toJSON()` com anotação explícita; validar com `pnpm typecheck`.
- **R-07 — Tabela de frases incompleta.** Códigos fora da tabela ficam sem `title` (membro opcional na RFC); aceitável.
- **R-08 — Efeito em HEAD e `onError` aninhado.** `errorResponse` não muda de estrutura; a lógica de HEAD (`src/response.ts:234-240`) e a de `nested` (`src/response.ts:161-165`) permanecem. Cobrir com o caso HEAD já existente (`test/errors.test.ts:49-51`).
