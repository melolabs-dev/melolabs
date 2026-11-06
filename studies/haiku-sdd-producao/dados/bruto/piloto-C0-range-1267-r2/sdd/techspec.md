# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-11). Convenções: `AGENTS.md` (ESM, imports com `.ts`, helpers privados no fim do arquivo, `describeMatrix` nos testes). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (antes de qualquer alteração).

## 1. Estado atual (resumo do código)

- `serveStatic` é uma única função assíncrona: `src/utils/static.ts:101-278`.
- Ordem atual do fluxo: cabeçalhos de `options.headers` (`static.ts:105-114`) → 405 (`static.ts:116-122`) → validação de path canônico (`static.ts:142-147`) → cálculo do `id` (`static.ts:170-185`) → `parseAcceptEncoding` (`static.ts:187-190`) → busca de meta por variante (`static.ts:198-208`) → 404/fallthrough (`static.ts:210-215`) → `Vary` (`static.ts:220-225`) → `Last-Modified` (`static.ts:227-237`) → `ETag` (`static.ts:239-241`) → 304 (`static.ts:243-248`) → `Content-Type` (`static.ts:250-262`) → `Content-Encoding` (`static.ts:264-266`) → `Content-Length` (`static.ts:268-270`) → HEAD (`static.ts:272-274`) → `getContents` e resposta 200 (`static.ts:276-277`).
- `meta.size` e `id` já correspondem à variante efetivamente escolhida (`static.ts:201-206`), logo o tamanho usado para Range é o da representação enviada (RF-07) sem lógica extra.
- `content-length` só é definido quando `size > 0` e ainda não existe no response (`static.ts:268-270`); o teste `test/static.test.ts:600-617` garante que um `content-length` vindo de `options.headers` prevalece no `200`.
- `HTTPResponse` aceita `status`/`statusText` (`src/response.ts:96-122`). Em `prepareResponse`, os cabeçalhos staged em `event.res.headers` são mesclados por cima dos do `HTTPResponse` com `set` (`src/response.ts:76-86` e `124-133`), então basta escrever os cabeçalhos em `event.res.headers`. `416` retornado como `HTTPResponse` (não como erro lançado) mantém todos os cabeçalhos; o corpo é nulo para HEAD (`src/response.ts:350-356`).
- `isCacheMatch` (`src/utils/internal/cache.ts:29-49`) usa comparação fraca (`opaqueTag`, `src/utils/internal/cache.ts:51-53`); não serve para `If-Range`, que exige comparação forte.
- Exportação pública: `src/index.ts:193` exporta somente `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Não será tocado.

## 2. Decisões de arquitetura

### D-01 — Helpers privados dentro de `src/utils/static.ts`
- Alternativas: (a) novo arquivo `src/utils/internal/range.ts` com funções exportadas; (b) helpers no próprio `static.ts`, sem `export`.
- Escolha: (b). O contrato exige "funções auxiliares privadas dentro do módulo, sem `export`" e RF-11 verifica isso. (a) exigiria `export` (ainda que interno) e contraria o texto literal.
- Consequência: `static.ts` passa de 351 para ~480 linhas, acima da meta de ~200 do `AGENTS.md`. O arquivo já excede a meta; o contrato prevalece e o risco R-01 registra isso. Helpers vão na seção `// --- Internal Utils ---` (`static.ts:280`), depois de `idSearchPaths` (`static.ts:340-351`).

### D-02 — Parsing estrito do `Range` com uma expressão regular
- Alternativas: (a) split manual por `,` e `-`; (b) regex única `^bytes=(\d*)-(\d*)$` sobre o valor aparado.
- Escolha: (b), com unidade `bytes` sem diferenciar maiúsculas (a norma trata unidades como case-insensitive). Qualquer valor que não case é "ignorar Range" (RF-05): multi-range (contém vírgula, não casa), unidade diferente, sintaxe inválida, `bytes=-` (ambos vazios). Números convertidos com `Number()`; se `!Number.isSafeInteger` → ignorar (risco de números gigantes do PRD). Para `a-b` com `a > b` → ignorar (RF-05), e não 416.
- Retorno interno: `undefined` (ignorar) ou `{ start?: number; end?: number }` onde exatamente um dos três formatos é representado: `a-b` (start e end), `a-` (só start), `-n` (suffix, representado como `{ suffix: number }`).

### D-03 — Resolução do intervalo contra o tamanho da variante
- Alternativas: (a) resolver no parser; (b) função separada `resolveRange(parsed, size)` que devolve `{ start, end } | "unsatisfiable"`.
- Escolha: (b), para que o parser seja puro e testável mentalmente.
- Regras: `a-b`/`a-`: `a >= size` → `"unsatisfiable"`; `end = min(b ?? size-1, size-1)`. Sufixo `-n`: `n === 0` → `"unsatisfiable"`; `start = max(size - n, 0)`, `end = size-1` (sufixo maior que o asset devolve tudo como `206`, RF-03). `size === 0`: qualquer intervalo é `"unsatisfiable"` (decisão sobre o risco do PRD: `416` com `Content-Range: bytes */0`).
- Quando `meta.size` é `undefined` (ou não é inteiro seguro >= 0) o Range é ignorado e a resposta é `200` normal (fora de escopo do PRD, seção 3).

### D-04 — Posição no fluxo e precedência (RFC 9110, 13.2.2)
- Alternativas: (a) avaliar Range antes do 304; (b) depois do 304 e depois de montar `Content-Type`/`Content-Encoding`.
- Escolha: (b). O bloco entra no lugar de `static.ts:268-277`. Assim `If-None-Match`/`If-Modified-Since` continuam vencendo (`static.ts:243-248`, RF-10), e `ETag`, `Last-Modified`, `Vary`, `Cache-Control`, `Content-Type`, `Content-Encoding` já estão escritos em `event.res.headers` quando o `206`/`416` é construído (RF-09).
- `Accept-Ranges: bytes` é escrito logo após o 304 (antes do bloco de Range), com `set` incondicional, em todo `200`/`206`/`416` de asset encontrado (RF-01). Não é escrito em `304` (não é obrigatório na norma; evita mudar respostas 304 existentes) nem em fallthrough/404/405.

### D-05 — `If-Range` com comparação forte
- Alternativas: (a) reutilizar `isCacheMatch`/`matchETag` (fraca); (b) helper privado `ifRangeMatches(value, etag, lastModified)`.
- Escolha: (b). Regras (RFC 9110, 13.1.5): valor aparado; se começa com `W/` → não corresponde; se começa com `"` → corresponde somente se `meta.etag` existe, não começa com `W/` e é string idêntica ao valor; caso contrário o valor é tratado como data HTTP e corresponde somente se igual (string exata) ao `Last-Modified` efetivamente emitido (`event.res.headers.get("last-modified")`). Sem validador correspondente no asset → não corresponde. Não correspondeu → ignorar Range (`200` completo). Sem `If-Range` no pedido → aplicar Range. `If-Range` sem `Range` não tem efeito.
- Observação: o etag usado nos testes atuais é `w/123` em minúsculas (`test/static.test.ts:15`), que não é uma tag fraca válida; é tratado como opaco, e só comparação exata o aceitaria. Os novos testes usam etags próprios (`"v1"`).

### D-06 — Recorte do corpo por tipo de `BodyInit`
- Alternativas: (a) ler tudo em memória (`new Response(body).arrayBuffer()`) e fatiar; (b) fatiar por tipo, com stream incremental para streams.
- Escolha: (b), para não carregar assets grandes em memória (PRD, premissas):
  - `Blob` → `blob.slice(start, end + 1)`.
  - `ArrayBuffer` e views (`ArrayBuffer.isView`) → `new Uint8Array(buf, byteOffset + start, length)` sem cópia.
  - `string` → `new TextEncoder().encode(s).subarray(start, end + 1)` (o `size` é em bytes).
  - `ReadableStream` (e demais tipos, via `new Response(body).body`) → helper `sliceStream(stream, start, length)`: `ReadableStream` com `pull` que lê chunks `Uint8Array` do leitor, descarta os `start` primeiros bytes, emite no máximo `length` bytes e, ao completar, chama `reader.cancel()` e fecha. `cancel()` do resultado propaga ao leitor de origem.
- Se `getContents` devolver `null`/`undefined` em GET com range: mesmo comportamento do `200` atual (`HTTPResponse(null)`), sem `206` (cai no ramo normal para não anunciar `Content-Range` sem corpo). 

### D-07 — `Content-Length` e `Content-Range` sobrescrevem valores prévios
- Alternativas: (a) respeitar `content-length` vindo de `options.headers` também no 206; (b) sobrescrever sempre em `206`/`416`.
- Escolha: (b). Num `206`/`416` o valor correto é o do trecho; manter um valor antigo geraria resposta inválida. O `200` continua inalterado (`static.ts:268-270`, teste `test/static.test.ts:600-617`). Para o `200` do caso "Range ignorado" mantém-se exatamente o código atual.
- `206`: `content-range: bytes s-e/size`, `content-length: e-s+1`, `statusText: "Partial Content"`. `416`: `content-range: bytes */size`, `content-length: 0`, `statusText: "Range Not Satisfiable"`, corpo `null`, `getContents` não é chamado.
- HEAD: mesmas decisões, mas sem chamar `getContents` (RF-06).

### D-08 — Sem mudança de API
- `ServeStaticOptions`/`StaticAssetMeta` (`static.ts:9-66`) e `src/index.ts:193` não mudam (RF-11). Nenhuma opção para desligar Range; quem não quiser pode não informar `size` em `getMeta`.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Substituir o trecho `static.ts:268-277` pelo bloco de Range (ver 4.1); adicionar helpers privados na seção Internal Utils após `static.ts:351` (ou entre `static.ts:338` e `340`). Nenhuma mudança em `static.ts:1-66` (import novo não é necessário; `HTTPResponse` já importado em `static.ts:7`). |
| `test/static.test.ts` | Novo `describeMatrix("serve static range", ...)` ao final do bloco principal (ex.: após `test/static.test.ts:623`, antes de `describe("serve static (malformed url)")` em `test/static.test.ts:626`). Reusa os imports de `test/static.test.ts:1-3`. |
| `src/index.ts` | Não alterar (`src/index.ts:193`). Conferido via `git diff` na verificação. |
| `docs/` | Opcional: se houver página de `serveStatic`, acrescentar nota de Range (não obrigatório pelo contrato). |

## 4. Contratos e assinaturas

### 4.1 Fluxo novo (pseudocódigo, substitui `static.ts:268-277`)

```ts
event.res.headers.set("accept-ranges", "bytes");

const size = meta.size;
const range =
  size !== undefined && Number.isSafeInteger(size) && size >= 0
    ? resolveRequestRange(event, size, mtimeDate, meta.etag)   // undefined = servir 200
    : undefined;

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range) {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(contents ? sliceBody(contents, range.start, range.end) : null, {
    status: contents ? 206 : 200, ...
  });
}

// caminho sem range: código atual (static.ts:268-277) intacto
```

Obs.: no ramo `contents` ausente, os cabeçalhos `content-range`/`content-length` de range devem ser removidos antes de responder `200` (ou o `getContents` deve ser chamado antes de escrever esses cabeçalhos). Implementar chamando `getContents` primeiro em GET e só então escrevendo os cabeçalhos.

### 4.2 Helpers privados (sem `export`)

```ts
type ByteRange = { start: number; end: number };

/** Interpreta o Range do pedido; undefined = ignorar e servir 200. */
function resolveRequestRange(
  headers: Headers, size: number, lastModified: string | null, etag?: string,
): ByteRange | "unsatisfiable" | undefined;

/** `bytes=a-b | a- | -n` -> forma crua; undefined se malformado/multi/unidade errada/inseguro. */
function parseRangeHeader(value: string):
  | { start: number; end?: number }
  | { suffix: number }
  | undefined;

/** Aplica o tamanho da variante (D-03). */
function resolveByteRange(
  parsed: { start: number; end?: number } | { suffix: number }, size: number,
): ByteRange | "unsatisfiable";

/** RFC 9110 13.1.5, comparação forte (D-05). */
function ifRangeMatches(value: string, etag: string | undefined, lastModified: string | null): boolean;

/** Recorta [start, end] inclusivo (D-06). */
function sliceBody(body: BodyInit, start: number, end: number): BodyInit;
function sliceStream(stream: ReadableStream<Uint8Array>, start: number, length: number): ReadableStream<Uint8Array>;
```

Todas as funções acima ficam sem `export` e não aparecem em `src/index.ts`. Tipos auxiliares (`ByteRange`) também sem `export`.

## 5. Estratégia de testes

Arquivo: `test/static.test.ts`, novo `describeMatrix("serve static range", (t, { it, expect }) => ...)` (roda em `web` e `node`, padrão de `test/static.test.ts:5`). Opções dedicadas: `getContents` devolve `"0123456789"`, `getMeta` devolve `{ size: 10, etag: '"v1"', mtime: 1_700_000_000_000, type: "text/plain" }`, `headers: { "cache-control": "public, max-age=60" }`, `encodings: { gzip: ".gz" }`.

Casos (um `it` por linha, cobrindo cada RF):
1. RF-01: GET e HEAD sem Range → `200`, `accept-ranges: bytes`, corpo completo no GET.
2. RF-02/03: `bytes=2-5` → `2345`; `bytes=7-` → `789`; `bytes=-3` → `789`; `bytes=5-100` → `206`, `content-range: bytes 5-9/10`, `content-length: 5`; `bytes=-100` → `206` com os 10 bytes; `bytes=0-0` → `0`.
3. RF-04: `bytes=10-20`, `bytes=10-`, `bytes=-0` → `416`, `content-range: bytes */10`, `content-length: 0`, corpo vazio; `getContents` não chamado.
4. RF-05: `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=-`, `bytes=99999999999999999999-` → `200` completo, sem `content-range`, com `accept-ranges`.
5. RF-06: HEAD com `bytes=2-5` e `bytes=10-20` → mesmos status/cabeçalhos do GET (comparação de `Object.fromEntries(headers)`), sem corpo; `getContents` não chamado.
6. RF-07: variante `.gz` com `size: 6` e `Accept-Encoding: gzip`, `bytes=0-2` → `206`, `content-range: bytes 0-2/6`, `content-encoding: gzip`, 3 primeiros bytes da variante.
7. RF-08: `If-Range: "v2"` → `200`; `"v1"` → `206`; `W/"v1"` → `200`; data igual ao `last-modified` → `206`; data diferente → `200`; asset sem validadores → `200`.
8. RF-09: `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` de `206` e `416` iguais aos do `200` completo.
9. RF-10: Range + `If-None-Match` correspondente → `304`; asset inexistente → `404` (e `undefined` com `fallthrough`); `POST` com Range → `405` com `Allow: GET, HEAD`.
10. Tipos de corpo (D-06): `getContents` devolvendo `Blob`, `Uint8Array` com `byteOffset` diferente de 0, `ReadableStream` com vários chunks (intervalo atravessando chunks) e string com caracteres multibyte (tamanho em bytes).
11. `content-length` vindo de `options.headers` é sobrescrito no `206`/`416`, mas continua prevalecendo no `200` (preserva `test/static.test.ts:600-617`).
12. `size` ausente → Range ignorado (`200`); `size: 0` com `bytes=0-` → `416` `bytes */0`.
13. RF-11: teste que `Object.keys` de `import * as h3 from "../src/index.ts"` não contém nome com `range` (case-insensitive) + verificação manual do `git diff -- src/index.ts` vazio e `grep -n "export" src/utils/static.ts` sem novos nomes.

Seguindo o fluxo de bug/feature do `AGENTS.md`: escrever os testes primeiro, confirmar que falham, implementar, rodar `pnpm vitest run test/static.test.ts`, depois `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` completo.

## 6. Riscos

- R-01 Tamanho do arquivo: `static.ts` ~480 linhas contra a meta de ~200 (já em 351). Aceito por exigência do contrato (D-01); mitigar mantendo helpers curtos e comentados.
- R-02 `content-length` de `options.headers`: sobrescrito em 206/416 (D-07); documentado e testado.
- R-03 `size` incorreto ou `0` como "desconhecido": um backend que reporta `size: 0` para tamanho desconhecido receberia `416` em qualquer Range. Decisão do PRD (`bytes */0`); alternativa mais conservadora (tratar `0` como desconhecido, como `static.ts:268` já faz para content-length) fica como ponto de revisão antes da implementação.
- R-04 Divergência `web`/`node` ao fatiar streams e `Blob`: coberta pela matriz; streams precisam cancelar a origem para não vazar descritores de arquivo.
- R-05 Se o conteúdo real for menor que `size`, o `Content-Length` não bate com o corpo (mesmo risco que o `200` atual).
- R-06 `If-Range` com data: igualdade exata de string com o `Last-Modified` emitido; não implementa a regra de "validador forte" por diferença de 1 s da RFC (simplificação aceita pelo PRD, RF-08).
- R-07 `Accept-Ranges` não vai em `304` (D-04); se algum consumidor esperar, é ajuste de uma linha.
- R-08 Etag de teste `w/123` minúsculo (`test/static.test.ts:15`) não é tag fraca válida; novos testes não dependem dele.
- R-09 Regressão de `Vary`/`ETag`: cobertos pelo teste 8 (comparação 200 x 206 x 416).
