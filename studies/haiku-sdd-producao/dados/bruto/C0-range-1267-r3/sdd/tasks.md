# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md`. Todos os auxiliares ficam privados em `src/utils/static.ts` (D-01), na seção "Internal Utils". Seguir o fluxo do AGENTS.md: escrever o teste, confirmar que falha, implementar, confirmar que passa. Os testes novos usam `describeMatrix` (web e node) em `test/static.test.ts`.

### T-01 — Anunciar `Accept-Ranges` e preparar o ponto de inserção

Cobre: RF-01, RF-07, RF-09, RF-11

Depende de: nenhuma

Descrição: depois do 304 (`src/utils/static.ts:243-248`, que fica intocado) e antes do bloco de `content-length`/HEAD/`getContents` (`src/utils/static.ts:268-277`), calcular "tamanho conhecido" (`Number.isSafeInteger(meta.size) && meta.size >= 0`, D-03) e, se verdadeiro, fazer `event.res.headers.set("accept-ranges", "bytes")`. Manter a condição atual `size > 0` para o `Content-Length` do 200. Sem `size` válido, não enviar `Accept-Ranges`. Escrever primeiro os testes de regressão: 200 com `accept-ranges: bytes` em GET e HEAD; sem `size` não há `accept-ranges`; 404, 405 (`Allow: GET, HEAD`) e `fallthrough` com `Range` presente continuam iguais (no `fallthrough`, sem vazar `accept-ranges` nem `vary`); `If-None-Match` igual ao ETag + `Range` continua 304 sem corpo.

Aceite: `pnpm vitest run test/static.test.ts` passa, com os testes novos falhando antes da mudança e passando depois; os testes existentes seguem verdes (ajustar apenas expectativas que comparem o conjunto exato de headers, para aceitar `accept-ranges`); o 304 não contém `accept-ranges`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-02 — Parser de `Range` (`parseRange`)

Cobre: RF-02, RF-05, RF-06

Depende de: nenhuma

Descrição: implementar a função privada `parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined` (D-04, `ByteRange` com `end` inclusivo) usando `/^bytes=(\d*)-(\d*)$/i` sobre o valor com `trim()`. Regras: grupos ambos vazios, número fora de `Number.isSafeInteger` ou `fim < início` → `undefined` (avaliado antes da satisfazibilidade); `início` ≥ `size` → `"unsatisfiable"`; `fim` limitado a `size - 1`; `início-` vai até `size - 1`; `-n` com `n = 0` ou `size = 0` → `"unsatisfiable"`, senão `start = max(size - n, 0)` e `end = size - 1`. Multi-range, outras unidades, `abc` e espaços internos não casam a regex e viram `undefined`. A unidade não diferencia maiúsculas. A função nunca lança e tem tipo de retorno explícito (`isolatedDeclarations`).

Aceite: com `size = 10`, `bytes=2-5` → `{2,5}`; `7-` → `{7,9}`; `-3` → `{7,9}`; `8-99` → `{8,9}`; `-99` → `{0,9}`; `BYTES=2-5` → `{2,5}`; `10-20` e `-0` → `"unsatisfiable"`; com `size = 0` qualquer faixa válida → `"unsatisfiable"`; `0-1,4-5`, `abc`, `5-2`, `items=0-1`, `bytes=-`, `bytes=1.5-3` e `bytes=0-99999999999999999999` → `undefined`. A verificação acontece pelos testes de integração da T-04 (a função não é exportada).

Arquivos: `src/utils/static.ts`

### T-03 — Fatiamento do corpo por bytes (`sliceBody` e `sliceStream`)

Cobre: RF-10

Depende de: nenhuma

Descrição: implementar `sliceBody(body: BodyInit, start: number, end: number): BodyInit` e `sliceStream(source, start, end)` privados (D-07). `string` → `TextEncoder` + `subarray` (offsets em bytes UTF-8); `ArrayBuffer` e views → `Uint8Array` sobre o mesmo buffer com `subarray`; `Blob`/`File` → `slice(start, end + 1)`; `ReadableStream` e outros `BodyInit` (`new Response(body).body`) → novo `ReadableStream` que descarta `start` bytes, emite no máximo `end - start + 1` bytes e, ao completar, cancela a origem; o `cancel()` do novo stream também cancela a origem; chunk que não seja `Uint8Array` faz o stream falhar com `TypeError`. Se o corpo real for menor que `size`, o corpo sai truncado (premissa R-01).

Aceite: o recorte é o mesmo para `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` com o mesmo conteúdo; string multibyte (`"áéí"`) é cortada por bytes; num teste unitário com `mockEvent` e `serveStatic`, o stream de origem é cancelado ao fim do intervalo, não é lido além do necessário, e chunks fragmentados em limites arbitrários dão o mesmo recorte. Os testes de integração desta cobertura são concluídos na T-06.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-04 — Respostas 206 e 416 em GET e HEAD

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

Depende de: T-01, T-02, T-03

Descrição: no lugar dos blocos `src/utils/static.ts:268-277` (D-02, D-06, D-08), quando o tamanho é conhecido, chamar `parseRange(event.req.headers.get("range"), size)`. `undefined` (ou tamanho desconhecido) segue o 200 atual. Faixa válida: `set("content-range", "bytes a-b/S")` e `set("content-length", String(b - a + 1))`, sobrescrevendo o `content-length` de `options.headers` (comentar a assimetria com o 200, R-04); status `206`, `statusText: "Partial Content"`; em HEAD, corpo `null` sem chamar `getContents`; em GET, `sliceBody(contents, a, b)`, e `getContents` vazio mantém `null` com 206. `"unsatisfiable"`: `set("content-range", "bytes */S")`, `set("content-length", "0")`, corpo `null`, status `416`, `statusText: "Range Not Satisfiable"`, sem chamar `getContents`, em GET e HEAD. `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary`, `Accept-Ranges` e `options.headers` permanecem. Testes primeiro, com ativo de 10 bytes (`0123456789`) via `vi.fn`.

Aceite: `GET` com `bytes=2-5` → 206, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4`; `7-` e `-3` → `789`; `8-99` → `89` (`bytes 8-9/10`); `-99` → `bytes 0-9/10`; `BYTES=2-5` funciona; o 206 tem os mesmos `ETag`, `Last-Modified`, `Content-Type` e `Vary` do 200 e `Content-Length` do intervalo mesmo com `options.headers` definindo `content-length: 999`; `HEAD` com `bytes=2-5` → 206, corpo vazio e `getContents` não chamado; `10-20`, `-0` e qualquer faixa com `size: 0` → 416, `Content-Range: bytes */S`, `Content-Length: 0`, sem corpo, em GET e HEAD, sem chamar `getContents`; `0-1,4-5`, `abc`, `5-2`, `items=0-1`, `bytes=-`, `bytes=1.5-3` e `bytes=0-99999999999999999999` → 200 inteiro com `Content-Length: 10` e sem `Content-Range`; sem `size` em `getMeta`, `bytes=0-3` → 200 completo sem `Accept-Ranges` nem `Content-Range`. Tudo em `web` e `node`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-05 — Respeitar `If-Range`

Cobre: RF-08

Depende de: T-04

Descrição: implementar `isIfRangeFresh(ifRange: string | null, sent: { etag: string | null; lastModified: string | null }): boolean` privada (D-05), usando os valores efetivamente enviados (`event.res.headers.get("etag")` e `get("last-modified")`). Valor começando com `"` ou `W/` é ETag: casa só se o ETag enviado tiver o formato forte `"..."` (sem `W/`, e `w/123` minúsculo não conta) e for idêntico byte a byte. Caso contrário é data: casa só se for string idêntica ao `Last-Modified` enviado. Sem validador correspondente ou valor inválido → não casa. Integrar no fluxo da T-04: `If-Range` só é avaliado quando há `Range` presente e válido; se não casar, a resposta é 200 completa (sem 416); `If-Range` sem `Range` é ignorado. Testes primeiro.

Aceite: ativo de 10 bytes com `etag: "abc"` e `mtime`: `Range: bytes=2-5` com `If-Range: "abc"` e com a data exata de `Last-Modified` → 206; com `If-Range: "outro"`, data diferente, `W/"abc"`, e `If-Range` quando o asset não tem validador → 200 com o corpo inteiro; `If-Range` sem `Range` → 200 normal; com ETag fraco no asset (`w/123`), nenhum `If-Range` valida o intervalo.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-06 — Testes de encoding e de tipos de corpo

Cobre: RF-10

Depende de: T-04

Descrição: cobrir o recorte sobre a representação efetivamente servida. Com `encodings: { gzip: ".gz" }`, `/a.txt.gz` com `size: 20` e `Accept-Encoding: gzip`, `Range: bytes=0-4` → 206 com `Content-Encoding: gzip`, `Vary: accept-encoding` e `Content-Range: bytes 0-4/20`, com os 5 primeiros bytes do `.gz`. Repetir o mesmo recorte com `getContents` devolvendo `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream`; string multibyte com `size` em bytes; `getContents` devolvendo `undefined`/`null` mantém o comportamento atual. Incluir o teste unitário de stream (via `mockEvent`, como em `test/security.test.ts`) descrito na T-03.

Aceite: `pnpm vitest run test/static.test.ts` passa em `web` e `node`, com todos esses cenários cobertos e os bytes do corpo conferidos.

Arquivos: `test/static.test.ts`

### T-07 — Documentação

Cobre: RF-01, RF-02, RF-05

Depende de: T-04

Descrição: acrescentar um parágrafo curto em `docs/4.examples/serve-static-assets.md` (depois da linha 71) e uma frase na seção `serveStatic` de `docs/2.utils/2.response.md` (a partir da linha 39), dizendo que, com `size` em `getMeta`, `serveStatic` envia `Accept-Ranges: bytes` e atende `Range` de um intervalo (206/416), que `size` deve ser o tamanho em bytes da representação servida e que multi-range é ignorado. Não alterar `src/index.ts`.

Aceite: os dois textos descrevem o novo comportamento sem prometer multi-range nem outras unidades; `pnpm lint` passa (formatação dos `.md`, se aplicável).

Arquivos: `docs/4.examples/serve-static-assets.md`, `docs/2.utils/2.response.md`

### T-08 — Verificação final e ausência de API nova

Cobre: RF-09, RF-11, RF-12

Depende de: T-05, T-06, T-07

Descrição: rodar a suíte completa e conferir que nada público mudou. Se algum teste existente comparar o conjunto exato de headers, ajustar apenas a expectativa para aceitar `accept-ranges`. Confirmar com `git diff` que `src/index.ts` e `test/unit/package.test.ts` não mudaram e que `src/utils/static.ts` não exporta nomes novos (todos os auxiliares sem `export`, com tipos de retorno explícitos).

Aceite: `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` passa; `pnpm lint` e `pnpm typecheck` passam; `pnpm test` passa; `git diff -- src/index.ts test/unit/package.test.ts` está vazio; a lista de exports de `src/utils/static.ts` é a da base (`ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`); `Range` em asset inexistente continua 404 (ou `fallthrough`) e `Range` em `POST` continua 405; o 304 com `Range` segue 304.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-07 |
| RF-02 | T-02, T-04, T-07 |
| RF-03 | T-04 |
| RF-04 | T-04 |
| RF-05 | T-02, T-04, T-07 |
| RF-06 | T-02, T-04 |
| RF-07 | T-01, T-04 |
| RF-08 | T-05 |
| RF-09 | T-01, T-08 |
| RF-10 | T-03, T-06 |
| RF-11 | T-01, T-08 |
| RF-12 | T-08 |
