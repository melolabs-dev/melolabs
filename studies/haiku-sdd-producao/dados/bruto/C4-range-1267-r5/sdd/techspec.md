# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md`, `sdd/prd.md` · Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests) · Módulo: `src/utils/static.ts`

Todas as citações `caminho:linha` foram conferidas no código atual (commit `5405ac8`).

## 1. Visão geral

`serveStatic` passa a atender um único intervalo de bytes em GET e HEAD:

- `206 Partial Content` para intervalo válido (`a-b`, `a-`, `-n`);
- `416 Range Not Satisfiable` para intervalo não satisfazível;
- `200` completo nos demais casos (Range malformado, múltiplos intervalos, unidade diferente de `bytes`, `If-Range` divergente, asset sem `size`, variante comprimida).

Nenhuma exportação nova. Nenhum novo parâmetro em `ServeStaticOptions` nem mudança em `getMeta`/`getContents`. Toda a lógica nova é privada em `src/utils/static.ts`.

Fluxo resultante (a ordem dos passos novos é a decisão D-02):

```
serveStatic
  ├─ método / canonicidade / lookup / vary              (inalterado)
  ├─ last-modified, etag, 304                           (inalterado, static.ts:227-248)
  ├─ content-type, content-encoding                     (inalterado, static.ts:250-266)
  ├─ content-length (size > 0)                          (inalterado, static.ts:268-270)
  ├─ NOVO: accept-ranges: bytes                         (D-08)
  ├─ NOVO: decide Range
  │    ├─ ignora se: size ausente/0, variante comprimida, If-Range diverge, Range inválido
  │    ├─ 416 se intervalo não satisfazível             → retorna sem corpo
  │    └─ 206 com content-range e content-length do trecho
  ├─ HEAD → 200 ou 206 sem corpo                        (static.ts:272-274, ajustado)
  └─ getContents → fatia se 206 → 200/206 com corpo     (static.ts:276-277, ajustado)
```

## 2. Decisões de arquitetura

### D-01 — Local do código auxiliar: dentro de `static.ts`

**Escolha:** parsing de `Range`, avaliação de `If-Range` e fatiamento do corpo ficam como funções privadas na seção `// --- Internal Utils ---` ao final de `src/utils/static.ts` (hoje a seção começa em `src/utils/static.ts:280`).

**Alternativas consideradas:**
- `src/utils/internal/range.ts`: respeita a convenção de arquivos curtos (< 200 LoC, `AGENTS.md`), mas contraria a restrição explícita da issue ("Keep all helper logic private within the serveStatic module") e não há segundo consumidor interno.
- Exportar os helpers para testá-los isoladamente: rejeitada, viola RF-11 e a restrição de exports.

**Justificativa:** a restrição da issue é mais forte que a convenção de tamanho. O arquivo passa de ~350 para ~480 linhas; a divisão em `utils/internal/range.ts` fica registrada como possível refatoração posterior, fora desta entrega.

### D-02 — Ordem de avaliação: 304 → If-Range → Range

**Escolha:** a checagem condicional existente (`isCacheMatch`, `static.ts:243-248`) continua antes de qualquer lógica de Range. Em seguida, `If-Range` é avaliado. Só depois o `Range` é interpretado, o que decide entre 416, 206 e 200.

Consequências:
- `If-None-Match` com match devolve `304` mesmo com `Range` (RF-07, R3).
- `If-Range` divergente com Range não satisfazível devolve `200`, não `416`. A RFC 9110 §13.1.5 manda ignorar o Range nesse caso.

**Alternativas consideradas:**
- Avaliar Range antes de 304: rejeitada, permitiria `206` onde deveria haver `304` (R3).
- Avaliar Range antes de If-Range: rejeitada, daria `416` a um cliente cujo validador já não bate.

### D-03 — Parsing estrito de `Range`

**Escolha:** a função de parsing aceita somente:
- unidade `bytes` (sem diferenciação de maiúsculas na unidade, por ser `token` da RFC);
- um único `range-spec` após separar por `,` e descartar elementos vazios/espaços em branco (OWS), conforme a regra `#` da RFC;
- formatos `a-b`, `a-` e `-n`, com dígitos decimais.

Regras de satisfação, para `size > 0`:

| Entrada | Resultado |
|---|---|
| `a-b`, com `a <= b`, `a < size` | `206`, `[a, min(b, size-1)]` |
| `a-`, com `a < size` | `206`, `[a, size-1]` |
| `-n`, com `n > 0` | `206`, `[max(0, size-n), size-1]` |
| `-0` | `416` (sufixo de comprimento zero, RF-04) |
| `a` ≥ `size` | `416` |
| `a > b` (ex.: `5-2`) | ignorar Range, `200` (RF-05) |
| mais de um `range-spec`, unidade ≠ `bytes`, sintaxe inválida, `-` puro | ignorar Range, `200` |

**Alternativas consideradas:**
- Atender o primeiro intervalo de uma lista múltipla: rejeitada, PRD e issue pedem `200` completo.
- Tratar `a > b` como `416`: rejeitada, RF-05 manda ignorar.

### D-04 — Avaliação de `If-Range`

**Escolha:** `If-Range` só aceita:
- ETag forte (começa com `"`, não começa com `W/`) exatamente igual a `meta.etag`. Se `meta.etag` for fraco (`W/`) ou ausente, não há match;
- data HTTP que, convertida para `Date`, tenha o mesmo `getTime()` do `mtimeDate` truncado para segundos (`static.ts:227-232`). Sem `meta.mtime`, não há match.

Qualquer outro valor (ETag fraco no cabeçalho, data inválida, valor sem aspas) não casa e o Range é ignorado. A ausência de `If-Range` não restringe o Range.

**Alternativas consideradas:**
- Comparação fraca de ETag: rejeitada, RFC 9110 §13.1.5 exige comparação forte aqui (R2).
- Comparar data com precisão de milissegundos: rejeitada, `mtimeDate` já é truncado para segundos e a data HTTP também tem essa precisão (R2).

### D-05 — Quando o Range é ignorado (ou não se aplica)

**Escolha:** o Range é ignorado (resposta `200` completa, sem `content-range`) quando qualquer condição abaixo for verdadeira:

1. `meta.size` é `undefined`, `0` ou negativo (RF-08). Quando `size` é `0`, o comportamento atual é preservado (R5);
2. a variante servida é comprimida: `id !== assetId` (variante `.gz`/`.br` escolhida por `idSearchPaths`, `static.ts:192-205`) **ou** `meta.encoding` está definido (RF-09);
3. `If-Range` não casa (D-04).

`id` e `assetId` já existem no fluxo (`static.ts:192-205`), então a checagem é local.

**Alternativas consideradas:**
- Atender Range sobre a variante comprimida, com `Content-Length` da variante: rejeitada, é a opção "R7" do PRD e está fora de escopo; exige decisão de produto antes.
- Considerar só `meta.encoding` e ignorar `id !== assetId`: rejeitada, um `.gz` servido sem `encoding` no meta ainda seria fatiado sobre bytes comprimidos.

### D-06 — Fatiamento do corpo sem carregar o arquivo inteiro

**Escolha:** `getContents(id)` continua sendo a única fonte do corpo (PRD P4). A fatia é feita por tipo:

- `Blob` (inclui `File`): `body.slice(start, end + 1)`. É preguiçoso e não lê o arquivo inteiro;
- demais `BodyInit` (string, `ArrayBuffer`, views, `ReadableStream`, `FormData`, `URLSearchParams`): normalizados por `new Response(body).body`, que entrega um `ReadableStream<Uint8Array>` com os bytes na codificação que o cliente receberia. Sobre esse stream, a função descarta `start` bytes e emite `end - start + 1` bytes, sem acumular o conteúdo.

Para `null`/`undefined`, o corpo é `null` (mantém o comportamento atual de `contents || null`, `static.ts:277`).

**Alternativas consideradas:**
- Ler tudo em memória (`arrayBuffer()`) e fatiar: rejeitada, anula o ganho de seek em arquivos grandes (R1).
- Passar o intervalo a `getContents`: rejeitada, muda a assinatura pública (PRD, "Fora de escopo").
- Nova opção pública para fatiamento por backend: rejeitada, fora de escopo.

### D-07 — `Content-Length` e `Content-Range` sobrescrevem headers existentes em 206 e 416

**Escolha:** em respostas `206` e `416`, `content-length` e `content-range` são definidos com `event.res.headers.set(...)`, substituindo qualquer valor anterior. Isso inclui `content-length` vindo de `options.headers`.

O teste existente de `content-length` explícito (`test/static.test.ts:600-616`) cobre só `200`. Continua passando sem alteração, e nada nele muda.

**Alternativas consideradas:**
- Respeitar `content-length` já definido, como no `200` (`static.ts:268`): rejeitada, produziria um `206` com framing inconsistente.

### D-08 — `Accept-Ranges: bytes` em todas as respostas servidas a partir do asset

**Escolha:** `event.res.headers.set("accept-ranges", "bytes")` é executado depois de `content-length` (`static.ts:268-270`) e antes do bloco de Range. Assim o header aparece em `200`, `206`, `416`, e em HEAD. Não aparece em `304` nem em `404`/`405`, que saem antes.

Conforme RF-01 e a issue ("Always advertise"), o header é enviado mesmo quando o `size` é desconhecido (ver R-04).

**Alternativas consideradas:**
- Anunciar só quando `size > 0`: mais correto semanticamente, mas contraria RF-01 literal. Fica registrado como alternativa caso o time prefira (R-04).

### D-09 — Tamanho zero

**Escolha:** `meta.size === 0` ignora Range e responde `200`, como hoje (PRD RF-08 e R5). A RFC 9110 trataria qualquer Range em recurso vazio como não satisfazível (`416`). Esse desvio está registrado e precisa de confirmação.

### D-10 — Estrutura de testes

**Escolha:** novo bloco `describeMatrix` em `test/static.test.ts`, com rota própria (`/range/**`) registrada dentro do teste, no mesmo padrão de `/clen/**` (`test/static.test.ts:600-616`). O fixture **não** usa o `beforeEach` existente, porque o fixture atual define `encoding: "utf8"` (`test/static.test.ts:14`) e isso faria todo Range ser ignorado por D-05.

Fixture do bloco: corpo de 1000 bytes (string ASCII ou `Blob`), `size: 1000`, `etag: '"abc"'` (forte), `mtime` fixo sem milissegundos, sem `encoding`.

## 3. Arquivos a alterar

### `src/utils/static.ts`

| Trecho | Linhas atuais | Alteração |
|---|---|---|
| Imports | `src/utils/static.ts:1-7` | Nenhum import novo é obrigatório. `HTTPResponse` já está importado (`:7`). |
| Assinatura de `serveStatic` | `src/utils/static.ts:101-104` | Sem mudança. |
| Checagem de método | `src/utils/static.ts:116-122` | Sem mudança (RF-07). |
| Variantes e lookup | `src/utils/static.ts:192-208` | Sem mudança; `id` e `assetId` são lidos em D-05. |
| `last-modified` / `mtimeDate` | `src/utils/static.ts:227-237` | Sem mudança; `mtimeDate` é reutilizado por D-04. |
| 304 | `src/utils/static.ts:243-248` | Sem mudança; precede o bloco de Range (D-02). |
| `content-length` do tamanho | `src/utils/static.ts:268-270` | Sem mudança; o bloco de Range sobrescreve quando há 206/416 (D-07). |
| HEAD | `src/utils/static.ts:272-274` | Retorna `206` quando há range; senão `200`. |
| Corpo | `src/utils/static.ts:276-277` | Fatia o corpo quando há range (D-06); senão igual ao atual. |
| Internal Utils | `src/utils/static.ts:280-351` | Recebe as funções privadas novas (seção 4). |

Bloco novo, inserido entre `static.ts:270` e `static.ts:272`:

```ts
event.res.headers.set("accept-ranges", "bytes");

const range = resolveRange(event, meta, {
  id,
  assetId,
  mtimeDate,
});
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (range) {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
}
```

Ajuste em `static.ts:272-277`:

```ts
const status = range ? 206 : 200;
const statusText = range ? "Partial Content" : undefined;

if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status, statusText });
}

const contents = await options.getContents(id);
if (range) {
  return new HTTPResponse(sliceBody(contents, range), { status, statusText });
}
return new HTTPResponse(contents || null, { status: 200 });
```

### `test/static.test.ts`

- Novo `describeMatrix` após o bloco principal (que termina em `test/static.test.ts:624`). Cobre RF-01 a RF-10 (seção 5).
- Nenhum teste existente é alterado. O único que toca `content-length` (`:600-616`) continua válido (D-07).

### Arquivos que **não** mudam

- `src/index.ts:193`: exporta `serveStatic`, `ServeStaticOptions`, `StaticAssetMeta` sem alteração. A snapshot de exports em `test/unit/package.test.ts:4` cobre RF-11 automaticamente.
- `src/response.ts`: `HTTPResponse` (`:96`) e o merge de headers (`:218-227`, `mergeHeaders` em `:243`) já fazem o que é necessário. Note que headers de `event.res.headers` sobrescrevem os de `HTTPResponse` nesse merge; isso é o que permite D-07.
- `src/utils/internal/cache.ts`: `isCacheMatch` (`:29`) e `matchETag` (`:11`) não mudam.

## 4. Contratos e assinaturas (privadas em `static.ts`)

Nenhum tipo ou função é exportado. Assinaturas propostas:

```ts
/** Intervalo inclusivo já limitado ao tamanho do asset. */
type ByteRange = { start: number; end: number };

/**
 * Interpreta `Range` para um asset de `size` bytes.
 * - `ByteRange`: atender com 206.
 * - `"unsatisfiable"`: responder 416.
 * - `undefined`: ignorar Range e responder 200 (malformado, unidade diferente,
 *   múltiplos intervalos, `start > end`).
 */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/**
 * Avalia `If-Range` (RFC 9110 §13.1.5). `true` só para ETag forte exatamente
 * igual ao `etag` do asset, ou data HTTP igual ao `mtime` truncado.
 */
function ifRangeMatches(
  ifRange: string,
  validators: { etag?: string; mtime?: Date },
): boolean;

/**
 * Resolve o Range aplicável a esta requisição. Chama `parseRange` somente se
 * D-05 não ignorar o Range e `If-Range` casar.
 */
function resolveRange(
  event: H3Event,
  meta: StaticAssetMeta,
  context: { id: string; assetId: string; mtimeDate?: Date },
): ByteRange | "unsatisfiable" | undefined;

/**
 * Fatia o corpo para o intervalo. `Blob` usa `slice`; os demais tipos passam por
 * `new Response(body).body` e um stream que descarta `start` bytes e emite o trecho.
 */
function sliceBody(body: BodyInit | null | undefined, range: ByteRange): BodyInit | null;
```

Notas de contrato:
- `resolveRange` retorna `undefined` quando `event.req.headers.get("range")` está ausente, o que mantém o caminho 200 idêntico ao atual.
- `sliceBody` é síncrono. A função de stream usa `ReadableStream` com `pull`, e não lê o corpo antes da primeira chamada de `pull` pelo runtime.
- `statusText` de `206` e `416` segue o padrão de `304` (`static.ts:246`).

## 5. Estratégia de testes

Todos os testes novos usam `describeMatrix` (modos `web` e `node`), em `test/static.test.ts`. Como os helpers são privados, toda cobertura é por `serveStatic` via `t.fetch`. Não há testes unitários diretos.

Regra do `AGENTS.md` (Bug Fix Workflow): cada RF tem ao menos um teste que **falha** antes da implementação. Com o código atual, todo caso de Range retorna `200` e falha por `status`/`content-range`.

| RF | Casos | Esperado |
|---|---|---|
| RF-01 | GET e HEAD sem Range | `200`, `accept-ranges: bytes`, corpo completo |
| RF-02 | `bytes=100-199`; `bytes=-200`; `bytes=900-5000` | `206` com `content-range`/`content-length` e corpo exato dos bytes |
| RF-03 | HEAD com `bytes=100-199` | `206`, headers do trecho, corpo vazio |
| RF-04 | `bytes=1000-1100`; HEAD `bytes=1000-`; `bytes=-0` | `416`, `content-range: bytes */1000`, `content-length: 0` |
| RF-05 | `bytes=0-1,5-9`; `items=0-9`; `bytes=abc`; `bytes=5-2`; `bytes=-` | `200`, sem `content-range`, corpo completo |
| RF-06 | `If-Range: "abc"` (match); `"outro"`; `W/"abc"`; data igual ao mtime; data diferente | `206` só no match; `200` nos demais |
| RF-07 | `If-None-Match` com match + Range; asset inexistente + Range; `fallthrough` + Range; POST + Range | `304`; `404`/fallthrough; `405` inalterado |
| RF-08 | `getMeta` sem `size`; `size: 0` | `200`, sem `content-range` |
| RF-09 | `encodings: { gzip: ".gz" }` + `accept-encoding: gzip` + Range | `200`, `content-encoding: gzip`, corpo comprimido completo |
| RF-10 | Range válido com `etag`, `mtime`, `type`, `options.headers.cache-control` | `206` com os mesmos `content-type`, `etag`, `last-modified`, `cache-control` do `200` |
| RF-11 | Snapshot de exports | Já coberto por `test/unit/package.test.ts:4`; nada a adicionar |
| D-06 | Corpo como `Blob` e como string; trecho que cruza chunks de stream | Bytes exatos nos dois tipos |

Verificações finais, na ordem:

1. `pnpm vitest run test/static.test.ts`
2. `pnpm vitest run test/unit/package.test.ts`
3. `pnpm lint` (oxlint + oxfmt --check)
4. `pnpm typecheck`
5. `pnpm test` completo, com cobertura, antes de considerar a entrega concluída

## 6. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R1 | Arquivos grandes: fatiar em memória anula o seek | D-06: `Blob.slice` e stream sem acumular; teste de corpo em `Blob` |
| R2 | `If-Range` comparado de forma errada entrega trechos de versões diferentes | D-04 com comparação forte e precisão de segundos; testes de RF-06 cobrem fraco, data e divergência |
| R3 | Ordem 304 × 206 trocada | D-02; teste de RF-07 com `If-None-Match` + Range |
| R4 | Cache intermediário guarda `206` e serve a outro intervalo | Vary atual mantido (`static.ts:220-225`); nenhum cache de `206` é criado no módulo |
| R5 | `size: 0`: RFC pediria `416` | D-09, comportamento do PRD; **decisão a confirmar** |
| R6 | Testes existentes assumem `200` com Range | Busca feita: nenhum teste em `test/static.test.ts` menciona `range` hoje |
| R7 | RF-09: servir Range sobre variante comprimida | D-05 ignora Range; **decisão a confirmar** antes de qualquer mudança |
| R-01 | Fixture atual com `encoding: "utf8"` (`test/static.test.ts:14`) faz todo Range ser ignorado | D-10: fixture próprio sem `encoding` |
| R-02 | Fixture atual usa `etag: "w/123"` (minúsculo, sem `W/` maiúsculo) | Não afeta os testes novos, que usam `'"abc"'`. Em `ifRangeMatches`, `W/` maiúsculo é o único marcador de fraco |
| R-03 | `getContents` devolve `null` com `size > 0` e há Range: corpo vazio com `content-length` do trecho | Mesma inconsistência que já existe no `200` atual. Fora de escopo; registrar como dívida |
| R-04 | `Accept-Ranges` anunciado sem `size`, onde Range é ignorado | D-08 segue o PRD. Alternativa: anunciar só com `size > 0`. **Decisão a confirmar** |
| R-05 | Números muito grandes em `bytes=...` perdem precisão ao converter com `Number` | Validar com `Number.isSafeInteger`; valor fora do intervalo seguro é tratado como malformado (`undefined`) |
| R-06 | Arquivo passa de ~480 linhas, acima da convenção de 200 LoC | D-01; possível extração para `utils/internal/range.ts` em tarefa separada |
| R-07 | `new Response(body)` para `ReadableStream` consome o stream original | Em `sliceBody`, o stream recebido de `getContents` é usado uma única vez, já que o corpo só é lido nesse caminho |

## 7. Pendências de decisão (confirmar antes da implementação)

1. **R7 / D-05**: confirmar que Range sobre variante comprimida é ignorado.
2. **R5 / D-09**: confirmar que `size: 0` mantém `200` (desvio da RFC).
3. **R-04 / D-08**: confirmar que `Accept-Ranges` é anunciado mesmo sem `size`.
