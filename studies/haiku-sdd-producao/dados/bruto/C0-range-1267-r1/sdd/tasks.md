# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` e `sdd/techspec.md`. Seguir o fluxo do AGENTS.md: os testes (T-01 a T-03) são escritos primeiro e devem **falhar** antes da implementação (T-04 a T-07). Todos os helpers são privados em `src/utils/static.ts` (D-01, RF-13); nenhuma exportação nova.

## Ordem sugerida

T-01, T-02, T-03 (testes, em paralelo) → T-04 → T-05 → T-06 → T-07 → T-08 → T-09.

---

### T-01 — Testes: anúncio, 206, formas de intervalo, Range inválido, 416 e HEAD

Criar o bloco `describeMatrix("serve static range", …)` ao final de `test/static.test.ts`, com `getMeta` devolvendo `{ size: 10, etag: '"abc"', mtime: 1_700_000_000_000, type: "text/plain" }` e `getContents: vi.fn(() => "0123456789")`. Casos conforme a seção 5 do techspec:

- GET e HEAD sem `Range` → 200 com `Accept-Ranges: bytes`.
- `bytes=2-5` → 206, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, `Content-Type` preservado; `Accept-Ranges` também no 206.
- `it.each` das formas aceitas: `7-`, `-3`, `7-999`, `BYTES=0-0`, `-999`, `0-9`, `9-9`, `0-`.
- `it.each` de Range ignorado: `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=`, `bytes=-`, `bytes=-1-2`, `bytes=+1-2`, `bytes=0-1,4-5`, valores negativos → 200 completo, sem `Content-Range`, com `Accept-Ranges`.
- 416 para `10-`, `20-30` e `-0`: `Content-Range: bytes */10`, `Content-Length: 0`, corpo vazio, `Accept-Ranges` presente, `getContents` não chamado.
- HEAD com intervalo válido (206) e não satisfazível (416): corpo vazio, cabeçalhos corretos, `getContents` não chamado.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-14
Arquivos: `test/static.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` executa os novos casos nos alvos `web` e `node` e eles **falham** antes de T-07 (confirmar a falha e registrar); lint dos testes passa.

---

### T-02 — Testes: If-Range, precedência do 304, encoding, sem size, 404/405 e Content-Length

No mesmo bloco de `test/static.test.ts`, acrescentar:

- `If-Range` (RF-07): ETag igual (`"abc"`) → 206; ETag diferente e `W/"abc"` → 200 completo; data igual ao `Last-Modified` → 206; data diferente e data inválida → 200; `If-Range` sem `Range` ignorado. Usar ETags com aspas (R-09).
- Precedência (RF-08): `Range` + `If-None-Match` igual ao `etag` → 304 sem corpo e sem `Content-Range`; idem com `If-Modified-Since`.
- Encoding (RF-09): `encodings: { gzip: ".gz" }` com `accept-encoding: gzip` e `Range: bytes=0-3` → 206 com `Content-Encoding: gzip`, `Vary: accept-encoding`, `Content-Type` do original, `Content-Range`/`Content-Length` sobre o tamanho da `.gz`; `ETag`, `Last-Modified` e `options.headers` presentes.
- Sem size utilizável (RF-10): `getMeta` sem `size`, com `0`, `-1` e `1.5` → resposta idêntica à atual (200 integral, sem `Accept-Ranges`, sem `Content-Range`) mesmo com `Range` válido.
- Fallthrough/404/405 (RF-11): asset inexistente (com e sem `fallthrough`), `POST` com `Allow: GET, HEAD`, caminho não canônico, todos com `Range` → sem `Accept-Ranges` e sem `Content-Range`.
- `options.headers` com `content-length: 999` (D-06): em 200 continua `999`; em 206 vale o calculado (`4`).

Cobre: RF-07, RF-08, RF-09, RF-10, RF-11, RF-14
Arquivos: `test/static.test.ts`
Depende de: T-01
Aceite: os casos novos rodam em `web` e `node`; os que dependem de Range/`Accept-Ranges` falham antes de T-07, e os de RF-10, RF-11 e `content-length: 999` em 200 já passam (regressão). Registrar quais falham.

---

### T-03 — Testes: fatiamento do corpo por tipo de `BodyInit`

No mesmo bloco, acrescentar `it.each` (RF-12, D-08) com `Range: bytes=2-5` sobre o conteúdo `0123456789`, com `getContents` devolvendo: `string`, `Uint8Array`, subview de `Uint8Array` com `byteOffset > 0`, `ArrayBuffer`, `Blob`, `File`, `ReadableStream` de um chunk e de vários chunks (cobre descarte do início e truncamento). Verificar:

- corpo recebido `2345` em todos os casos e número de bytes igual ao `Content-Length`;
- `getContents` chamado uma única vez (`toHaveBeenCalledTimes(1)`);
- `string` multibyte (ex.: `"é0123"`) com offsets em bytes UTF-8.

Cobre: RF-12, RF-14
Arquivos: `test/static.test.ts`
Depende de: T-01
Aceite: os casos rodam em `web` e `node` e falham antes de T-06/T-07 (hoje o corpo vem inteiro, com 200).

---

### T-04 — Helpers privados: `isRangeableSize` e `parseRange`

Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, adicionar (sem `export`, com anotações de tipo como `parseAcceptEncoding`) os tipos `ByteRange` e `RangeResult`, `isRangeableSize(size)` (`Number.isSafeInteger(size) && size > 0`, D-03) e `parseRange(header, size)` com a regex `/^bytes=(\d*)-(\d*)$/i` após `trim()` (D-04):

- `first-last`, `first-` e `-N` conforme a tabela do techspec;
- `last >= size` truncado em `size-1`; `-N` com N > size → `{0, size-1}`;
- `first > last`, `bytes=`, `bytes=-`, unidade desconhecida, multi-intervalo e sinais → `undefined` (ignorar);
- `first >= size` e `-0` → `"unsatisfiable"`; números inseguros tratados como ≥ `size`.

Cobre: RF-03, RF-04, RF-05, RF-10, RF-13
Arquivos: `src/utils/static.ts`
Depende de: T-01
Aceite: `pnpm typecheck` e `pnpm lint` passam; `git diff -- src/index.ts` vazio; nenhum nome novo com `export` em `static.ts`; os helpers ainda não são chamados (ficam ligados em T-07).

---

### T-05 — Helpers privados: `ifRangeAllows` e `resolveRange`

Em `src/utils/static.ts`, adicionar `ifRangeAllows(value, { etag, lastModified })` com comparação **forte** (D-05) e `resolveRange(headers, size, validators)`:

- sem `If-Range` → `true`; valor iniciando com `"` é entity-tag e só vale se `meta.etag` existir, não for fraco (`/^w\//i`) e for igual byte a byte;
- caso contrário, data: `Date.parse` `NaN` → `false`; vale só com igualdade exata a `lastModified.getTime()`;
- `W/"abc"` na requisição nunca casa;
- `resolveRange` lê `range`; sem `Range` → `undefined` (e `If-Range` nem é consultado); `If-Range` falho → `undefined`; senão devolve o resultado de `parseRange`.

Cobre: RF-07, RF-13
Arquivos: `src/utils/static.ts`
Depende de: T-04
Aceite: `pnpm typecheck` e `pnpm lint` passam; funções sem `export`; não reutilizam `matchETag` (comparação fraca) de `src/utils/internal/cache.ts`.

---

### T-06 — Helper privado: `sliceBody` por tipo de `BodyInit`

Em `src/utils/static.ts`, adicionar `sliceBody(contents, range)` (e o auxiliar de stream, `sliceStream`) conforme D-08:

- `Blob`/`File` → `blob.slice(start, end + 1)`;
- `ArrayBufferView` → `new Uint8Array(v.buffer, v.byteOffset + start, len)`; `ArrayBuffer` → `new Uint8Array(buf, start, len)`;
- `string` → `TextEncoder` + `subarray` (offsets em bytes UTF-8);
- `ReadableStream` → novo stream que descarta bytes até `start`, emite até `end` e chama `reader.cancel()` ao terminar, sem acumular tudo;
- demais tipos (`FormData`, `URLSearchParams`, etc.) → `await new Response(x).blob()` e `blob.slice`.

Comentar no código a limitação de streams (sem seek, só chunks `Uint8Array`) e a premissa de que `Range` vale para o conteúdo e o `size` de `getMeta` (R-02, R-06).

Cobre: RF-12, RF-13
Arquivos: `src/utils/static.ts`
Depende de: T-04
Aceite: `pnpm typecheck` e `pnpm lint` passam; função sem `export`; nenhum `import` novo de módulo externo.

---

### T-07 — Integrar Range em `serveStatic` (206, 416, HEAD, 200 com `Accept-Ranges`)

Em `src/utils/static.ts`, substituir o bloco final atual (`static.ts:268-277`: `Content-Length`, HEAD e corpo) pela lógica do D-02/D-06/D-07, mantendo intactos o 304 e tudo antes dele:

- `size` não suportado (`isRangeableSize` falso): comportamento atual, sem `Accept-Ranges` (RF-10), incluindo o `Content-Length` condicional existente;
- `size` suportado: `set("accept-ranges", "bytes")`, `resolveRange(...)` com `meta.etag` e `mtimeDate`;
  - `undefined` → 200 atual (regra "só define `Content-Length` se ausente");
  - `"unsatisfiable"` → `HTTPResponse(null, 416, "Range Not Satisfiable")` com `Content-Range: bytes */size` e `Content-Length: 0` (sobrescreve);
  - `{start,end}` → 206 `"Partial Content"` com `Content-Range: bytes s-e/size` e `Content-Length: e-s+1` (sobrescreve);
- HEAD devolve `HTTPResponse(null, …)` sem chamar `getContents` em 200, 206 e 416; GET chama `getContents` uma única vez e passa o resultado por `sliceBody` no 206;
- 404/405/fallthrough e 304 permanecem como hoje, sem `Accept-Ranges`/`Content-Range`.

Cobre: RF-01, RF-02, RF-05, RF-06, RF-08, RF-09, RF-10, RF-11, RF-12
Arquivos: `src/utils/static.ts`
Depende de: T-04, T-05, T-06
Aceite: `pnpm vitest run test/static.test.ts` passa por inteiro (T-01, T-02, T-03 e os testes existentes) em `web` e `node`; `pnpm vitest run test/security.test.ts` passa sem alterações; `serveStatic` mantém a assinatura `(event, options) => Promise<HTTPResponse | undefined>`.

---

### T-08 — Ajustar testes existentes ao novo `Accept-Ranges`

Em `test/static.test.ts`, onde o cabeçalho passa a existir em respostas 200 com `size` válido, acrescentar `"accept-ranges": "bytes"` aos `expectedHeaders` (`:33-40` e `:431-437`) sem remover nenhuma verificação existente. Manter o teste de `content-length: 999` (`:600-617`) como está, pois o 200 mantém a regra "ausente".

Cobre: RF-14
Arquivos: `test/static.test.ts`
Depende de: T-07
Aceite: `pnpm vitest run test/static.test.ts` passa; `git diff` do arquivo mostra apenas adições nos testes existentes (nada removido ou enfraquecido).

---

### T-09 — Verificação final e guarda da API pública

Executar a verificação completa e conferir as métricas do PRD:

- `pnpm vitest run test/static.test.ts`, depois `pnpm vitest run` (suíte inteira, matriz `web` e `node`, incluindo `test/unit/package.test.ts`);
- `pnpm lint` e `pnpm typecheck`;
- `git diff -- src/index.ts` vazio; `git diff` de `src/utils/static.ts` sem `export` novo e sem mudança em `ServeStaticOptions` e `StaticAssetMeta`;
- sanity manual: baixar um asset em partes (`Range`) e confirmar que a concatenação é idêntica ao original.

Cobre: RF-13, RF-14
Arquivos: `src/utils/static.ts`, `src/index.ts`, `test/static.test.ts`
Depende de: T-07, T-08
Aceite: todos os comandos acima passam sem falhas; o diff final toca apenas `src/utils/static.ts` e `test/static.test.ts`; resultados reportados fielmente (incluindo qualquer pendência).

---

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-07 |
| RF-02 | T-01, T-07 |
| RF-03 | T-01, T-04 |
| RF-04 | T-01, T-04 |
| RF-05 | T-01, T-04, T-07 |
| RF-06 | T-01, T-07 |
| RF-07 | T-02, T-05 |
| RF-08 | T-02, T-07 |
| RF-09 | T-02, T-07 |
| RF-10 | T-02, T-04, T-07 |
| RF-11 | T-02, T-07 |
| RF-12 | T-03, T-06, T-07 |
| RF-13 | T-04, T-05, T-06, T-09 |
| RF-14 | T-01, T-02, T-03, T-08, T-09 |
