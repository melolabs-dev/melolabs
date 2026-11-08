# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md`, `sdd/prd.md` (RF-01..RF-12), RFC 9110 §13.1.5 e §14. Toda a mudança fica em `src/utils/static.ts`; nenhuma exportação pública nova.

## 1. Estado atual (conferido no código)

- `serveStatic` é definido em `src/utils/static.ts:101`. Ordem do fluxo: aplica `options.headers` em `event.res.headers` (`:105-114`), valida método (`:116-122`, 405 + `allow`), valida caminho canônico (`:142-147`), resolve `meta` (`:198-215`), `vary` (`:220-225`), `last-modified` (`:227-237`), `etag` (`:239-241`), 304 via `isCacheMatch` (`:243-248`), `content-type` (`:250-262`), `content-encoding` (`:264-266`), `content-length` a partir de `meta.size` (`:268-270`), HEAD (`:272-274`) e `getContents` (`:276-277`).
- `isCacheMatch` (`src/utils/internal/cache.ts:29`) e `matchETag` (`:11`) fazem comparação **fraca** (ignoram `W/`), inadequada ao `If-Range`, que exige comparação forte.
- O retorno é sempre um `HTTPResponse` (`src/response.ts:96`); os cabeçalhos escritos em `event.res.headers` são mesclados na resposta final. No caminho de `HTTPResponse` (não-`Response`), `src/response.ts:188-205`, **todos** os cabeçalhos preparados são mesclados, inclusive em status ≥ 400; já para um `Response` real com status ≥ 400 só `errHeaders` são mesclados (`:211-213`).
- `nullBody` (`src/response.ts:350`) só zera o corpo para HEAD e 1xx/204/205/304, então 206/416 mantêm o corpo que passarmos.
- Exportação pública: `src/index.ts:193` (`ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`). `test/unit/package.test.ts:133` lista `serveStatic` no snapshot de exports.

## 2. Decisões de arquitetura

### D-01 — Ponto de inserção no fluxo: depois do 304 e dos cabeçalhos de representação

**Alternativas:** (a) avaliar Range antes de `isCacheMatch`; (b) avaliar logo antes de `content-length`/HEAD (`static.ts:268`); (c) separar em outra função chamada pelo handler.
**Escolha:** (b). O RF-07 exige que `If-None-Match`/`If-Modified-Since` vençam (RFC 9110 §13.2.2: Range só é avaliado depois das precondições de cache), então o código novo vem após `static.ts:243-248`. Ali `content-type`, `content-encoding`, `etag`, `last-modified` e `vary` já estão definidos, e `meta` já é o da variante pré-comprimida selecionada (`:200-207`), o que atende o RF-08 sem código extra. (a) violaria o RF-07; (c) não agrega nada, pois a decisão precisa das mesmas variáveis locais.

### D-02 — Helpers privados na seção "Internal Utils" de `static.ts`

**Alternativas:** (a) novo arquivo `src/utils/internal/range.ts`; (b) helpers privados em `static.ts` após `// --- Internal Utils ---` (`:280`); (c) estender `internal/cache.ts`.
**Escolha:** (b), como o pedido ("helpers privados dentro do módulo serveStatic") e o RF-12 determinam. (a) seria aceitável pelo AGENTS.md (internos em `utils/internal/`), mas o pedido manda manter no módulo; `static.ts` tem ~350 linhas e vai crescer ~120 — aceitável, sem barrel nem export. (c) mistura `If-None-Match` (fraco) com `If-Range` (forte) e aumenta a superfície de erro.

### D-03 — Assinaturas e contratos internos (não exportados)

```ts
type ByteRange = { start: number; end: number }; // inclusivo, 0 <= start <= end < size

/** `undefined` = ignorar o Range (serve 200); "unsatisfiable" = 416. */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** RFC 9110 §13.1.5. `true` quando o Range deve ser honrado. */
function isIfRangeValid(ifRange: string, validators: { etag?: string | null; lastModified?: string | null }): boolean;

/** Corta `body` em [start, end] (inclusivo) preservando o tipo quando possível. */
function sliceBody(body: BodyInit, range: ByteRange): BodyInit;
```

Todos `function` simples sem `export` (com `isolatedDeclarations`, o tipo `ByteRange` também não é exportado; os retornos são explícitos). Nenhum nome novo em `src/index.ts`.

### D-04 — "Tamanho conhecido" e anúncio de `Accept-Ranges`

**Alternativas:** (a) anunciar `Accept-Ranges: bytes` sempre (literal da issue); (b) só com `meta.size` > 0; (c) `Accept-Ranges: none` sem tamanho.
**Escolha:** (b), conforme RF-01/RF-10 e a premissa do PRD (leitura conservadora; anunciar sem poder atender seria mentir ao cliente). (c) não é pedido e mudaria cabeçalhos de assets sem tamanho. Condição reutiliza a de `static.ts:268` (`meta.size !== undefined && meta.size > 0`) acrescida de `Number.isSafeInteger(meta.size)`, para não calcular offsets com `NaN`/fração. O cabeçalho é setado apenas se ainda ausente (`!event.res.headers.has("accept-ranges")`), no mesmo estilo de `content-type`/`etag` (`:239`, `:250`), respeitando o que o usuário configurou em `options.headers`. Vai nas respostas 200, 206 e 416; não vai em 304, 404 nem 405 (essas saem antes).

### D-05 — Parsing estrito do `Range`; qualquer dúvida vira "ignorar"

**Alternativas:** (a) parser permissivo com `split`/`parseInt`; (b) regex única ancorada; (c) biblioteca externa (`range-parser`).
**Escolha:** (b), sem dependência nova (o AGENTS.md pede core mínimo). Algoritmo de `parseRange(header, size)`:
1. `m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)` — unidade case-insensitive (RF-05); qualquer vírgula, outra unidade ou lixo não casa → `undefined` (200 completo). A tolerância a espaços é intencional; sem ela, clientes tolerantes quebrariam por pouco.
2. `a` e `b` vazios (`bytes=-`) → `undefined`.
3. `a` vazio (sufixo `-n`): `n = Number(b)`; `n === 0` → `"unsatisfiable"` (RF-04); senão `{ start: max(size - n, 0), end: size - 1 }` (n ≥ size devolve tudo como 206, RF-02).
4. `a` presente: `first = Number(a)`; se `b` presente e `Number(b) < first` → `undefined` (`bytes=5-2` malformado, RF-05); `first >= size` → `"unsatisfiable"`; `end = b ? min(Number(b), size - 1) : size - 1`.
Inteiros enormes: `Number()` perde precisão acima de 2^53, mas a comparação com `size` (safe integer) continua correta (valor gigante é "≥ size"/"clampado"); `Infinity` (string de 400+ dígitos) também se comporta (`min` clampa, `first >= size` → 416). Não se usa `parseInt` (aceitaria `5abc`).
Múltiplos intervalos não são coalescidos nem atendidos: ignorados (RFC 9110 §14.2 permite ignorar Range; o PRD o fixa fora de escopo).

### D-06 — `If-Range` com comparação forte, usando os validadores efetivamente enviados

**Alternativas:** (a) reaproveitar `matchETag`/`isCacheMatch` (fraca); (b) nova função com comparação forte e comparação de data exata; (c) ignorar `If-Range`.
**Escolha:** (b). RFC 9110 §13.1.5: o cliente só pode enviar ETag **forte** ou data; o servidor honra o Range só se casar com igualdade forte (ETag) ou data idêntica ao `Last-Modified` (comparação exata, não `>=`). `isIfRangeValid(ifRange, { etag, lastModified })`:
- valor começa com `"` (entity-tag): `true` só se `etag` existe, **não** é fraco (começa com `W/`, comparado sem diferenciar caixa, pois os fixtures do repo usam `w/123`, ex. `test/static.test.ts:15`) e `ifRange.trim() === etag`. ETag fraco no `If-Range` (`W/"abc"`) → `false` (RF-06).
- caso contrário trata como HTTP-date: `true` só se `lastModified` existe e `ifRange.trim() === lastModified`.
- Os validadores vêm de `event.res.headers.get("etag")` e `.get("last-modified")` (o que será de fato enviado, inclusive valores vindos de `options.headers`), não de `meta`: o contrato da RFC é com o que o cliente viu.
- Sem `Range`, `If-Range` é ignorado (a função nem é chamada).
- `If-Range` presente porém inválido/sem validador correspondente → `Range` ignorado, 200 completo.

### D-07 — 206/416 como `HTTPResponse` com cabeçalhos em `event.res.headers`

**Alternativas:** (a) `throw new HTTPError({ status: 416, headers })`; (b) retornar `Response` nativa; (c) `HTTPResponse` com `status` explícito, escrevendo cabeçalhos em `event.res.headers`.
**Escolha:** (c), igual aos retornos atuais (`static.ts:244,273,277`). (a) produz corpo JSON de erro (viola "Content-Length: 0"/sem corpo) e passa por `onError`; (b) sofre o filtro de `src/response.ts:211-213`, que descartaria `ETag`, `Vary`, `Content-Type` e os `headers` configurados em 416, quebrando o RF-08. Em (c) o caminho `response.ts:188-205` mescla todos os cabeçalhos preparados e `sanitizeStatusCode` aceita 206/416.
Cabeçalhos por desfecho (sempre com `set`, para sobrescrever o `content-length` de `meta.size`/`options.headers` e não vazar o tamanho total — risco do PRD §4):
- **206:** `content-range: bytes {start}-{end}/{size}`, `content-length: {end-start+1}`; corpo = fatia (GET) ou `null` (HEAD, sem chamar `getContents`).
- **416:** `content-range: bytes */{size}`, `content-length: 0`; corpo `null`; `getContents` não é chamado (GET e HEAD).
Observação: um `content-length: 999` vindo de `options.headers` continua valendo no **200** (teste existente `test/static.test.ts:600-617`), mas é sobrescrito em 206/416, onde o valor completo seria incorreto.

### D-08 — Fatiamento após `getContents`, por tipo de `BodyInit`

**Alternativas:** (a) converter tudo para `Uint8Array` via `new Response(body).arrayBuffer()` e `subarray`; (b) fatiar por tipo preservando streaming; (c) mudar `getContents` para receber o range (API nova — fora de escopo).
**Escolha:** (b), conforme RF-09 e "fora de escopo: otimizar backend". `sliceBody(body, {start,end})`, fim exclusivo = `end + 1`:
- `string` → `new TextEncoder().encode(body).subarray(start, end + 1)` (o corte é em **bytes** UTF-8, não em caracteres; coerente com `size` em bytes).
- `ArrayBuffer`/`ArrayBufferView` → `new Uint8Array(buf, byteOffset, byteLength).subarray(...)` (sem cópia).
- `Blob` (inclui `File`) → `body.slice(start, end + 1)` (preguiçoso).
- `ReadableStream` (e fallback para `URLSearchParams`/`FormData` via `new Response(body).body`) → `ReadableStream` com `pull` que lê o upstream, descarta os `start` primeiros bytes, emite até `end - start + 1` bytes e então `cancel()` no upstream e fecha. Memória limitada a um chunk; os bytes descartados ainda são consumidos (limitação aceita no PRD).
(a) carregaria streams grandes (vídeos) inteiros em memória, justamente o caso de uso da issue. O resultado é passado ao `HTTPResponse`; para `Uint8Array`/`Blob`/stream o `content-length` já foi fixado por D-07 e o runtime não o recalcula porque `HTTPResponse` carrega os cabeçalhos mesclados.
Se `getContents` devolver `null`/`undefined` numa decisão 206, mantém-se o comportamento atual (`contents || null`, `static.ts:277`: 200 sem corpo), sem `content-range` e com o `content-length` original, para não anunciar um corpo inexistente. Por isso o `await getContents` ocorre antes de setar `content-range`/`content-length` de 206 (só no GET; HEAD não chama `getContents`).

### D-09 — Ordem final do trecho novo em `serveStatic`

Pseudocódigo (substitui `static.ts:268-277`):

```
const hasSize = meta.size !== undefined && meta.size > 0 && Number.isSafeInteger(meta.size)  // mantém o `> 0` atual
if (hasSize && !event.res.headers.get("content-length")) set content-length = size   // inalterado
if (hasSize && !has("accept-ranges")) set accept-ranges = bytes

const range = hasSize ? resolveRange(event, meta.size) : undefined   // Range + If-Range (D-05, D-06)
if (range === "unsatisfiable") { set content-range "bytes */size"; set content-length "0"; return new HTTPResponse(null, {status: 416}) }
if (range) { set content-range; set content-length len;
             if HEAD return new HTTPResponse(null, {status: 206})
             contents = await getContents(id); if (!contents) → desfaz (D-08) e cai no 200
             return new HTTPResponse(sliceBody(contents, range), {status: 206}) }
// HEAD e GET 200 como hoje
```

`resolveRange` é um helper privado que lê `Range`/`If-Range` de `event.req.headers` e chama `parseRange`/`isIfRangeValid`. 405, 404, `fallthrough` e caminho canônico permanecem **antes** (`static.ts:116-215`), logo Range não os altera (RF-11).

### D-10 — Sem mudanças em `HTTPResponse`, `toResponse`, `ServeStaticOptions`, `StaticAssetMeta`

**Alternativa:** adicionar opção `ranges?: boolean` para desligar. **Rejeitada:** o PRD proíbe novas opções; o recurso é retrocompatível e ignorável por cliente (sem `Range` nada muda além do `Accept-Ranges`).

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts:268-277` | Substituir o trecho de `content-length`/HEAD/`getContents` pelo fluxo de D-09; adicionar `accept-ranges`. |
| `src/utils/static.ts:280` (seção "Internal Utils") | Adicionar `parseRange`, `isIfRangeValid`, `sliceBody`, `resolveRange` e o tipo `ByteRange` (privados, sem `export`). |
| `test/static.test.ts` | Novos `describeMatrix` de Range (ver §4); ajustes só se algum teste existente falhar por `accept-ranges` (hoje todos usam `toMatchObject`/`get`: `:53`, `:69`, `:450`, `:466`, então não se prevê ajuste). |
| `docs/4.examples/serve-static-assets.md` (opcional) | Uma frase informando suporte a Range quando `size` é informado. |

**Não alterar:** `src/index.ts:193` (RF-12), `src/response.ts`, `src/utils/internal/cache.ts`, `test/unit/package.test.ts:133` (snapshot de exports permanece igual — serve de verificação do RF-12).

## 4. Estratégia de testes

Framework: Vitest + `describeMatrix` (web e node), como em `test/static.test.ts:5`, `:396`, `:525`. Fixture nova com asset de 10 bytes `"0123456789"`, `etag: '"abc"'` (forte), `mtime`, `getContents: vi.fn`. Seguir o fluxo de bug: escrever os testes, ver falharem, implementar.

1. **RF-01:** GET/HEAD sem Range → 200, corpo e `content-length` iguais, `accept-ranges: bytes`.
2. **RF-02:** `bytes=2-5` → 206 `2345`, `content-range: bytes 2-5/10`, `content-length: 4`; `7-`, `-3`, `8-99`, `-50` (n ≥ size → `0-9/10`), `0-0`.
3. **RF-03:** HEAD `2-5` → 206, corpo vazio, `getContents` não chamado.
4. **RF-04:** `10-20`, `-0`, `99-` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, `getContents` não chamado (GET e HEAD).
5. **RF-05 (borda de parsing):** `bytes=abc`, `5-2`, `bytes=`, `bytes=-`, `0-1,4-5`, `items=0-1`, `BYTES=2-5` (válido, 206), `bytes=2-5` com espaços, `bytes=0-99999999999999999999999` (clampa), `bytes=5abc-6`, `bytes=-1-2`.
6. **RF-06:** `If-Range: "abc"` → 206; `"outro"` → 200; `W/"abc"` → 200; data igual ao `last-modified` → 206; data diferente → 200; asset sem etag + If-Range de etag → 200; `If-Range` sem `Range` → 200.
7. **RF-07:** `If-None-Match` com etag atual + Range → 304 sem corpo; `If-Modified-Since` idem.
8. **RF-08:** com `encodings: { gzip: ".gz" }` e variante `.gz` de `size` 20: `Range: bytes=0-9` → 206, `content-range: bytes 0-9/20`, `content-encoding`, `vary: accept-encoding`, `etag`, `last-modified`, `content-type` e `headers` configurados presentes também em 416.
9. **RF-09:** `getContents` devolvendo `string`, `Uint8Array`, `ArrayBuffer`, `Blob`/`File` e `ReadableStream` (um chunk e vários chunks que cruzam `start`/`end`): corpo `2345`. Caso string multibyte (corte em bytes). Stream: verificar que o upstream recebe `cancel` após o fim.
10. **RF-10:** `getMeta` sem `size` (e `size: 0`) + Range → 200 completo, sem `accept-ranges`/`content-range`.
11. **RF-11:** asset inexistente + Range → 404; com `fallthrough` → cai no próximo handler; `POST` + Range → 405 com `allow: GET, HEAD`.
12. **Content-Length pré-definido:** `headers: { "content-length": "999" }` + Range → 206 com `content-length: 4`, e sem Range continua 999 (preserva `test/static.test.ts:600-617`).
13. **RF-12:** manter `test/unit/package.test.ts` passando sem alteração (snapshot de exports) e conferir `git diff src/index.ts` vazio.
14. `ctx.errors` (auto-assert no `afterEach`) garante que nenhum erro não tratado ocorra.

Execução: `pnpm vitest run test/static.test.ts`, depois `pnpm vitest run test/unit/`, `pnpm lint` (inclui typecheck) e `pnpm test` ao final.

## 5. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| `meta.size` diverge do corpo real → `Content-Range`/`Content-Length` incoerentes ou corpo truncado. | Premissa documentada (PRD §4); testes cobrem o caso coerente; não se mede o corpo (fora de escopo). Comentário no código. |
| `content-length` pré-existente vazando o tamanho total em 206/416. | Sempre `set` em 206/416 (D-07) com teste dedicado. |
| Fatiar `ReadableStream` consome bytes descartados e pode vazar o leitor. | `pull` com limite de um chunk, `cancel` do upstream ao terminar ou quando o consumidor cancelar; teste com múltiplos chunks. |
| `If-Range` com ETag fraco/aberto comparado fracamente serviria bytes de representações diferentes. | Comparação forte própria (D-06); ETags `w/` minúsculos tratados como fracos. |
| Cabeçalho `Range` gigante ou com inteiros enormes (`Number` impreciso, `Infinity`). | Regex ancorada, só dígitos; comparações via `min`/`>=` robustas; testes de borda. |
| Caches/CDN: 206/416 sem `Vary`/validadores corrompem cache. | Cabeçalhos preservados porque o retorno é `HTTPResponse` (D-07); testes RF-08. |
| `Accept-Ranges` aparece em respostas 200 existentes e pode quebrar assert de cabeçalhos exatos de terceiros. | Mudança intencional (RF-01); suíte atual usa `toMatchObject`, sem ajuste previsto. |
| `string` com `size` calculado em caracteres pelo backend (ex. `str.length` no fixture, `test/static.test.ts:18`) diverge dos bytes UTF-8 para texto não ASCII. | Documentar que `size` é em bytes; o fixture é ASCII. |
| Divergência entre GET e HEAD. | Mesma `resolveRange` para ambos; HEAD só omite o corpo (teste RF-03). |
| Pergunta aberta com o mantenedor: anunciar `Accept-Ranges` apenas com tamanho conhecido (D-04). | Escolha conservadora; fácil de relaxar depois. |
