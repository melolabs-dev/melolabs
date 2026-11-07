# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md` (contrato) e `sdd/prd.md` (requisitos RF-01 a RF-10).
Código afetado: `src/utils/static.ts`. Testes novos em `test/static-range.test.ts`.

## Resumo

O `serveStatic` passa a tratar `Range` para `GET` e `HEAD` de assets com tamanho conhecido:
anuncia `Accept-Ranges: bytes`, responde `206` para um intervalo único válido, `416` para intervalo
não satisfazível, e ignora (responde `200` completo) o que for malformado, de outra unidade, com
múltiplos intervalos ou com `If-Range` que não confere. A ordem de avaliação fica
**304 → Range → corpo**. Nenhuma assinatura pública muda e nenhuma exportação nova é criada.

## Estado atual do código

Pontos verificados em `src/utils/static.ts`:

- `src/utils/static.ts:13` — `StaticAssetMeta.size` existe, mas sem documentação de que é o tamanho em bytes do corpo devolvido por `getContents`.
- `src/utils/static.ts:33` — `getContents` devolve `BodyInit`, sem parâmetro de intervalo. O corpo completo é sempre devolvido.
- `src/utils/static.ts:116-122` — método diferente de `GET`/`HEAD` retorna `undefined` com `fallthrough`, senão `405` com `Allow: GET, HEAD`. Não muda.
- `src/utils/static.ts:142-147` — caminho não canônico gera `404` ou `undefined`. Não muda.
- `src/utils/static.ts:239-241` — `etag` é definido na resposta quando há `meta.etag`.
- `src/utils/static.ts:243-248` — `304` quando `isCacheMatch` confere. Precisa continuar antes de Range (RF-07).
- `src/utils/static.ts:268-270` — `content-length` vem de `meta.size` só se `size > 0` e se o header ainda não existe. Essa regra vale para `200`; ver D-08.
- `src/utils/static.ts:272-274` — `HEAD` retorna `200` sem corpo, sem chamar `getContents`.
- `src/utils/static.ts:276-277` — `GET` chama `getContents` e retorna `200` com o corpo.
- `src/utils/static.ts:214` — `throw new HTTPError({ statusCode: 404 })`, enquanto `src/utils/static.ts:121` usa `{ status: 405 }`. Inconsistência pré-existente; o novo código usa `status`.
- `src/utils/static.ts` tem 352 linhas, acima da convenção de `< 200 LoC` do `AGENTS.md`. Ver D-01.
- `src/index.ts:193` — exporta só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Não muda.
- `src/response.ts:96` — `HTTPResponse` aceita `status` e `statusText` no `init`. Para `206`/`416` basta passar esses campos.
- `src/response.ts:202-204` — os headers de `event.res` são mesclados com os do `HTTPResponse` na conversão final. Por isso `accept-ranges` definido em `event.res.headers` aparece também no `304`.
- `src/utils/internal/cache.ts:29` — `isCacheMatch` já cobre `If-None-Match` e `If-Modified-Since`. A lógica de `If-Range` é nova e fica em `static.ts`.
- `src/rules/cache.ts:143-148` — o `h3/rules/cache` já ignora requisições com `Range`. Não há interação a corrigir (fora de escopo, conforme PRD).
- Não há nenhum teste de `Range` hoje (`test/static.test.ts` não menciona `range`).

## Decisões de arquitetura

### D-01 — Onde ficam os helpers de Range

**Escolha:** helpers privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem export.

**Alternativas consideradas:**
- `src/utils/internal/range.ts`. Segue a convenção do `AGENTS.md` (`< 200 LoC`, helpers em `utils/internal/`) e mantém `static.ts` menor. Não é exportado pelo `index.ts`, então a API pública também não muda.
- Módulo novo público. Rejeitado: viola RF-09 e o pedido.

**Justificativa:** o `sdd/pedido.md` diz literalmente "Keep all helper logic private within the serveStatic module" e "as funções auxiliares ficam privadas no módulo". Seguir o texto do contrato é mais seguro do que a convenção geral. O custo é o arquivo passar de ~352 para ~470 linhas. **Pendente de confirmação:** se os mantenedores preferirem `utils/internal/range.ts`, a mudança é só mover as funções `parseRange`, `resolveRange` e `sliceBody`.

### D-02 — Interface do parser de Range

**Escolha:** uma função que devolve o intervalo, a indicação de "não satisfazível" ou `undefined` para "ignorar".

```ts
type ByteRange = { start: number; end: number }; // inclusivo nos dois lados
type RangeResult = ByteRange | "unsatisfiable" | undefined;
```

`undefined` significa "ignorar o Range e responder 200 completo". Essa forma deixa claro que malformado não é erro (RF-03) e que `416` só sai para intervalo sintaticamente válido (RF-04).

**Alternativas consideradas:**
- Lançar `HTTPError` 400 para malformado. Rejeitado: RF-03 pede ignorar, sem erro.
- Usar regex permissiva (aceitar espaços em volta de `=` e de `-`). Rejeitado: a gramática da RFC 9110 §14.1 é estrita; relaxar aceita pedidos que a norma não define.

**Gramática aceita** (RFC 9110 §14.1.1 e §14.2): `bytes=` seguido de exatamente um `first-last`, `first-`, ou `-suffix`. A unidade é comparada sem diferenciar maiúsculas (a norma trata nomes de unidade como case-insensitive). Sem espaços.

### D-03 — Ordem de avaliação

**Escolha:** `accept-ranges` é definido logo após `etag` (`src/utils/static.ts:241`), então vale para `200`, `206`, `416` e `304`. A avaliação de Range fica depois de `content-length` (`src/utils/static.ts:270`) e antes de `HEAD` (`src/utils/static.ts:272`).

**Justificativa:** RFC 9110 §13.2.2 manda avaliar condicionais (incluindo `If-None-Match`) antes de `Range`. Isso cumpre RF-07 sem código extra. Pôr `accept-ranges` antes do `304` é inofensivo, porque a RFC só o exige para o `200`, e o `304` herda os headers por `src/response.ts:202`.

**Alternativas consideradas:** definir `accept-ranges` só nos caminhos `200`/`206`/`416`. Mais código, sem ganho.

### D-04 — Validação de `If-Range`

**Escolha:** `If-Range` é avaliado só quando há `Range`. Regras (RFC 9110 §13.1.5):

- Se o valor começa com `"` ou `W/`, é uma ETag. Confere somente se a ETag é **forte** (não começa com `W/`) e é idêntica ao `meta.etag` (comparação byte a byte). ETag fraca nunca confere.
- Caso contrário, é uma data HTTP. Confere somente se `new Date(valor).getTime() === mtimeDate.getTime()`. `mtimeDate` já vem truncado para segundos (`src/utils/static.ts:232`). Data inválida (`NaN`) não confere.
- Sem `meta.etag` e com `If-Range` de ETag: não confere.
- Não conferiu: `Range` é ignorado, resposta `200` completa (RF-06).

**Alternativas consideradas:** comparar a ETag com `isCacheMatch`. Rejeitado: ele usa comparação fraca, e `If-Range` exige forte.

### D-05 — Tamanho desconhecido e tamanho zero

**Escolha:**
- `meta.size === undefined` → sem Range; `200` completo (premissa do PRD).
- `meta.size === 0` → Range é avaliado: qualquer intervalo é `416` com `Content-Range: bytes */0` (RFC 9110 §14.1.1: sufixo com representação vazia não é satisfazível).

**Justificativa:** o valor `0` é tamanho conhecido. Tratar como desconhecido daria `200` para um pedido que a norma manda rejeitar. O `size > 0` de `src/utils/static.ts:268` continua valendo para `content-length` de `200`.

**Pendente de confirmação:** se os mantenedores preferirem ignorar Range quando `size` é `0`, a mudança é uma condição.

### D-06 — Fatiamento do `BodyInit`

**Escolha:** `sliceBody(body, start, endExclusive)` devolve um `BodyInit` com os bytes pedidos, convertendo conforme o tipo:

| Tipo de `body`                          | Tratamento                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `string`                                | `new TextEncoder().encode(body)`, depois fatia `Uint8Array.subarray`    |
| `ArrayBuffer`                           | `body.slice(start, end)`                                                |
| `ArrayBuffer.isView(body)` (TypedArray/DataView) | `new Uint8Array(body.buffer, body.byteOffset + start, end - start)` |
| `Blob`                                  | `body.slice(start, end)`                                                |
| `ReadableStream`, `FormData`, `URLSearchParams` | `await new Response(body).blob()` e depois `.slice(start, end)`   |

**Justificativa:** `Content-Length` e `Content-Range` são em bytes; `string.slice` é em UTF-16 e erraria com caracteres multibyte. Os casos de `Blob`/`ArrayBuffer` são baratos. O caso de stream lê o corpo inteiro na memória; isso é uma limitação já listada no PRD (ver riscos).

**Alternativas consideradas:**
- Fatiar o stream descartando bytes sem bufferizar tudo. Melhor para memória, mas é mais código e mais caminhos a testar. Fica como evolução futura, junto com uma mudança de `getContents` que receba o intervalo (fora de escopo).
- Recusar Range para stream (responder `200`). Rejeitado: quebra RF-02 para um tipo de corpo que o `getContents` pode devolver.

### D-07 — Range sobre variante pré-comprimida

**Escolha:** o intervalo é aplicado aos bytes da variante escolhida (`app.js.gz` com `Content-Encoding: gzip`), como pede RF-08.

**Justificativa:** pela RFC 9110 §14.1, o intervalo é sobre a representação selecionada, que inclui o content-coding. O cliente que pediu `gzip` recebe bytes de `gzip` e retoma com eles. O risco de downloads inúteis (PRD) é do lado do cliente e fica documentado.

**Alternativas consideradas:** ignorar Range quando há `Content-Encoding` (PRD, "decisão a confirmar"). Rejeitado: contraria RF-08 e a norma; é uma escolha que o PRD prevê só como mitigação.

### D-08 — `content-length` e `content-range` em `206`/`416`

**Escolha:** em `206` e `416`, `content-length` é definido com `set`, substituindo o valor existente. Diferente de `200`, que respeita um `content-length` já presente (`src/utils/static.ts:268`, teste em `test/static.test.ts:600`).

**Justificativa:** o tamanho de um `206` é o do trecho, que o usuário não conhece. Respeitar o header dele daria uma resposta inconsistente. O teste em `test/static.test.ts:600` cobre só `200` (`HEAD` sem Range), então continua válido.

### D-09 — `getContents` devolve vazio em `206`

**Escolha:** se `getContents` devolver `null`/`undefined` para um pedido de trecho, lançar `HTTPError({ status: 404 })`, sem olhar `fallthrough`.

**Justificativa:** neste ponto `event.res.headers` já tem `vary`, `etag`, `last-modified`, `content-type` etc. Retornar `undefined` com `fallthrough` faria esses headers vazarem para o próximo handler, o que o teste em `test/static.test.ts:516` existe para impedir. Lançar o erro evita o vazamento.

**Alternativas consideradas:** reordenar para chamar `getContents` antes de definir headers. Mais código e mexe na ordem que RF-07 depende. Rejeitado para esta entrega.

### D-10 — Cobertura de respostas que não mudam

**Escolha:** `405` (`src/utils/static.ts:116-122`), `404` de caminho não canônico (`src/utils/static.ts:142-147`), `404` de asset ausente (`src/utils/static.ts:210-215`), seleção de encoding e `vary` não são alterados. O `Range` só é avaliado depois que o asset foi achado e a resposta condicional não casou.

### D-11 — Casos de sintaxe

| Entrada                                  | Resultado                                  |
| ---------------------------------------- | ------------------------------------------ |
| `bytes=100-199`                          | `206` `100-199`                            |
| `bytes=900-` / `bytes=900-5000` (size 1000) | `206` `900-999`                         |
| `bytes=-200` (size 1000)                 | `206` `800-999`                            |
| `bytes=-5000` (size 1000)                | `206` `0-999` (sufixo maior que o arquivo) |
| `bytes=1000-1100` (size 1000)            | `416`, `bytes */1000`                      |
| `bytes=-0`                               | `416`                                      |
| `bytes=5-3`                              | ignorado (`200`); last < first é malformado |
| `bytes=0-1,5-9`                          | ignorado (`200`)                           |
| `items=0-1`                              | ignorado (`200`)                           |
| `bytes=abc`, `bytes=-`, `bytes=`         | ignorado (`200`)                           |

## Contratos e assinaturas

Mudanças só em `src/utils/static.ts`. Nenhuma assinatura pública muda: `serveStatic(event, options)`, `ServeStaticOptions`, `StaticAssetMeta` ficam iguais. A única mudança em tipo público é JSDoc.

Helpers privados (não exportados):

```ts
/** Resultado de `resolveRange`: intervalo inclusivo, "unsatisfiable", ou undefined para ignorar. */
type ByteRange = { start: number; end: number };

/**
 * Decide a resposta de Range. `undefined` = ignorar (200 completo).
 * Só é chamada quando há `range` no request e `meta.size` é conhecido.
 */
function resolveRange(
  headers: Headers,
  meta: { size: number; etag?: string },
  mtime?: Date,
): ByteRange | "unsatisfiable" | undefined;

/** Confere `If-Range` contra a ETag forte ou a data (já truncada para segundos). */
function ifRangeMatches(value: string, meta: { etag?: string }, mtime?: Date): boolean;

/** Fatia o corpo em bytes; `end` é exclusivo. */
function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit>;
```

Trecho de `serveStatic`, inserido depois de `src/utils/static.ts:270` e antes de `src/utils/static.ts:272`:

```ts
  const range =
    event.req.headers.has("range") && meta.size !== undefined
      ? resolveRange(event.req.headers, { size: meta.size, etag: meta.etag }, mtimeDate)
      : undefined;

  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }

  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    event.res.headers.set("content-length", String(range.end - range.start + 1));
    if (event.req.method === "HEAD") {
      return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
    }
    const contents = await options.getContents(id);
    if (contents === null || contents === undefined) {
      throw new HTTPError({ status: 404 });
    }
    return new HTTPResponse(await sliceBody(contents, range.start, range.end + 1), {
      status: 206,
      statusText: "Partial Content",
    });
  }
```

Trecho inserido depois de `src/utils/static.ts:241`:

```ts
  event.res.headers.set("accept-ranges", "bytes");
```

Observação: `meta.size` precisa ser checado por `!== undefined` antes do `resolveRange`, senão o `TypeScript` não estreita o tipo. `mtimeDate` é `Date | undefined` (`src/utils/static.ts:227`).

JSDoc a adicionar:

- `src/utils/static.ts:13` — em `StaticAssetMeta.size`: "Tamanho do corpo em bytes devolvido por `getContents`. Usado para responder a `Range`; sem ele, a resposta é sempre completa."
- `src/utils/static.ts:33` — em `getContents`: "Devolve o corpo completo. Para `Range`, o trecho é fatiado a partir deste corpo."

## Estratégia de testes

Arquivo novo `test/static-range.test.ts`, com `describeMatrix` (web e node). Motivo: `test/static.test.ts` já tem 678 linhas e o novo bloco fica isolado. Os testes existentes não são alterados (nenhum deles usa `Range`).

Casos, por requisito:

1. **RF-01** — `GET` e `HEAD` sem Range em asset encontrado retornam `accept-ranges: bytes` e `200` completo.
2. **RF-02** — `bytes=100-199` (size 1000): `206`, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo com bytes 100–199. Também `900-`, `900-5000`, `-200`, `-5000`.
3. **RF-03** — `bytes=0-1,5-9`, `items=0-1`, `bytes=abc`, `bytes=5-3`, `bytes=-`: `200` completo, sem `content-range`.
4. **RF-04** — `bytes=1000-1100`: `416`, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. `bytes=-0`: `416`. Size 0 com qualquer Range: `416` `bytes */0`.
5. **RF-05** — `HEAD` com Range: mesmos headers de `206`/`416`, corpo vazio.
6. **RF-06** — `If-Range` com ETag forte igual: `206`. Com ETag diferente, ETag fraca `W/"abc"`, data diferente ou inválida: `200` completo. Data igual a `last-modified`: `206`.
7. **RF-07** — `Range` + `If-None-Match` casando: `304` sem corpo. `Range` + `If-Modified-Since` casando: `304`.
8. **RF-08** — variante `.gz` com `accept-encoding: gzip` e Range: `content-encoding: gzip`, bytes da variante. `POST` com Range: `405` com `allow: GET, HEAD`. `fallthrough` com Range em método não permitido: `undefined`, sem vazar headers (reutilizar o padrão de `test/static.test.ts:516`).
9. **Fatiamento por tipo** — `getContents` devolvendo `string` com caracteres multibyte (ex.: `"héllo"`, com `size` = bytes UTF-8), `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`. Mesmo trecho em todos.
10. **D-08** — `HEAD` com `headers: { "content-length": "999" }` e Range: `206` com o `content-length` do trecho, não `999`.
11. **D-09** — `getContents` devolve `undefined` com Range: `404`; com `fallthrough` também `404`.
12. **Sem size** — `getMeta` sem `size` e Range: `200` completo, sem `content-range`.
13. **RF-09** — checagem manual: `git diff master -- src/index.ts` vazio, e `src/index.ts` sem linhas novas de export. Não há teste automatizado; é um passo da revisão.
14. **RF-10** — `pnpm vitest run test/static-range.test.ts`, depois `pnpm vitest run test/static.test.ts`, depois `pnpm test` (lint + typecheck + coverage).

Ordem do ciclo (`AGENTS.md`, Bug Fix Workflow): escrever os testes primeiro, ver os de `206`/`416` falharem, depois implementar.

## Riscos

1. **Memória em streams (`ReadableStream`).** `sliceBody` lê o corpo inteiro. Para vídeos grandes, cada requisição de trecho ocupa o tamanho do arquivo na memória. Mitigação: documentar na JSDoc de `getContents`; tratar streaming em trabalho futuro.
2. **I/O por requisição.** `getContents` sempre devolve o arquivo inteiro, então cada trecho lê tudo do disco. Só se resolve mudando a assinatura, fora de escopo.
3. **Tamanho inconsistente entre `getMeta` e `getContents`.** Se `size` for diferente do número de bytes do corpo (ex.: `size` em caracteres com texto multibyte, como o próprio teste em `test/static.test.ts:18` faz com `.length`), o `Content-Range` mente. Mitigação: o contrato pede `size` em bytes (JSDoc de D-06); o teste de multibyte (caso 9) pega o erro. Os testes existentes usam `.length` com ASCII, então não são afetados.
4. **Arquivo mudar entre `getMeta` e `getContents`.** Uma escrita entre as duas chamadas deixa `Content-Range` e corpo com tamanhos diferentes. Já existe no `200` (`content-length` vs. corpo). Não é novo, mas Range deixa mais visível. Documentar.
5. **Variantes comprimidas (D-07).** Trechos de `gzip` não descomprimem sozinhos. Aceito pela norma; o cliente deve saber disso.
6. **Mudança observável.** Clientes que mandavam `Range` e recebiam `200` passam a receber `206`/`416`. É o comportamento pedido, mas deve entrar no changelog.
7. **`If-Range` por data.** Comparação exata é frágil com precisão de segundos. Mitigação: `mtimeDate` já é truncado (`src/utils/static.ts:232`); o teste de data igual (caso 6) cobre.
8. **Ordem de avaliação.** Trocar 304 e Range quebra RF-07. Mitigação: teste do caso 7.
9. **Tamanho do arquivo.** `static.ts` cresce ~120 linhas, acima do limite de 200 do `AGENTS.md`. Ver D-01.
10. **`accept-ranges` em `304`.** Não exigido pela RFC; inofensivo. Se os mantenedores preferirem só em `200`/`206`/`416`, é uma linha a mover.
11. **Números grandes.** `Number` perde precisão acima de 2^53. Irrelevante para tamanhos reais de arquivo; não tratado.

## Pendências para confirmação

- D-01: helpers em `static.ts` (contrato) ou em `utils/internal/range.ts` (convenção de tamanho).
- D-05: `size: 0` com Range → `416` (proposto) ou ignorar.
- D-07: Range sobre variante comprimida (proposto: aplicar, conforme RF-08).
- Risco 10: `accept-ranges` em `304`.
- Inconsistência pré-existente `statusCode` (`src/utils/static.ts:214`) vs `status` (`src/utils/static.ts:121`): não mexer nesta entrega; mencionar ao mantenedor.
