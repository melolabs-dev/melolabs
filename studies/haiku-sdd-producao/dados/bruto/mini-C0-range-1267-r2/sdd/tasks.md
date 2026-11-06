# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-09). Fluxo do `AGENTS.md`: escrever o teste primeiro, vê-lo falhar, implementar o mínimo, vê-lo passar e rodar a suíte mais ampla. Os testes de integração usam `describeMatrix` (modos `web` e `node`).

Ordem sugerida: T-01 → T-02 → T-03 → T-04 → T-05 → T-06 → T-07 → T-08 → T-09.

### T-01 — Parser de `Range` (`parseRange`)

Criar `src/utils/internal/range.ts` com o tipo `ByteRange` e `parseRange(header, size)`. Usar a regex estrita `/^bytes=(\d*)-(\d*)$/i` sobre o valor com `trim()`. Resultado: `{ start, end } | "unsatisfiable" | undefined` (`undefined` = ignorar o Range). O módulo não é reexportado.

Regras:

- `a-b`, `a-` e `-n` são aceitos.
- O fim é limitado a `size - 1`.
- Sufixo maior ou igual a `size` devolve tudo.
- `a >= size` e `-0` devolvem `"unsatisfiable"`.
- `bytes=5-2`, `bytes=`, `bytes=-`, `bytes 0-5`, `abc`, multi-range e unidade diferente devolvem `undefined`.

Primeiro escrever `test/unit/static-range.test.ts` (tabela de `parseRange`), ver falhar e depois implementar.

Cobre: RF-02, RF-05, RF-06, RF-13
Arquivos: `src/utils/internal/range.ts` (novo), `test/unit/static-range.test.ts` (novo)
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/static-range.test.ts` passa com a tabela. Ela cobre `100-199`, `900-`, `-100`, `0-5000`, `-5000`, `Bytes=0-1`, `1000-`, `2000-3000`, `-0`, `5-2`, `abc`, `bytes=`, `bytes 0-5`, `0-1,5-9` e `items=0-5`, com `size` 1000. Nada é exportado por `src/index.ts`.

### T-02 — Validação de `If-Range` (`isIfRangeValid`)

Adicionar a `range.ts` a função `isIfRangeValid(ifRange, { etag, lastModified })`.

- Valor que começa com `"` ou `W/`/`w/` é tratado como ETag. O range só vale se nem o valor nem o `etag` do asset forem fracos e se as strings forem idênticas (comparação forte, sem reutilizar `matchETag`).
- Qualquer outro valor é data. O range só vale se `ifRange.trim() === lastModified.toUTCString()` (precisão de segundos). Não usar `Date.parse`.
- Sem `etag`/`lastModified` para comparar, ou valor malformado, devolve `false`.
- Com `ifRange` ausente (`null`), devolve `true`, porque `If-Range` sem valor não condiciona nada.

Testes unitários primeiro, no mesmo arquivo da T-01.

Cobre: RF-08
Arquivos: `src/utils/internal/range.ts`, `test/unit/static-range.test.ts`
Depende de: T-01
Aceite: a tabela unitária passa com estes casos: ETag forte igual → `true`; ETag diferente → `false`; `W/"v1"` → `false`; asset com etag fraco (`"w/123"` e `W/"x"`) → `false`; data igual ao `Last-Modified` → `true`; data diferente ou inválida → `false`; sem etag/mtime → `false`; `null` → `true`.

### T-03 — Fatiamento do corpo (`sliceBody`)

Adicionar a `range.ts` a função `sliceBody(body, { start, end })`, que devolve `BodyInit | undefined` (`undefined` = tipo não fatiável).

- `string`: bytes UTF-8, com `TextEncoder().encode(s).subarray(start, end + 1)`.
- `Uint8Array`/`ArrayBufferView` e `ArrayBuffer`: fatiar respeitando `byteOffset`.
- `Blob`: `blob.slice(start, end + 1)`.
- `ReadableStream`: novo stream que lê o original com `getReader()`, descarta os bytes antes de `start`, repassa o trecho e, ao completar `end + 1` bytes, chama `reader.cancel()` e fecha. O `cancel()` do consumidor propaga para o original. Chunk que não seja `Uint8Array` é erro do stream (propagar). Não acumular o stream inteiro na memória.
- `FormData`, `URLSearchParams` e o restante: `undefined`.

Testes unitários primeiro.

Cobre: RF-11
Arquivos: `src/utils/internal/range.ts`, `test/unit/static-range.test.ts`
Depende de: T-01
Aceite: com o conteúdo `0123456789` e o range 2-5, `string`, `Uint8Array` (inclusive com `byteOffset` ≠ 0), `ArrayBuffer`, `Blob` e `ReadableStream` em vários chunks resultam todos nos mesmos 4 bytes. `"héllo"` é fatiado por bytes, não por caracteres. `FormData` e `URLSearchParams` devolvem `undefined`. Um spy em `cancel` do stream original confirma que ele é cancelado ao passar do fim.

### T-04 — `Accept-Ranges` e ponto de inserção no `serveStatic`

Em `src/utils/static.ts`, importar os helpers de `./internal/range.ts` (junto aos imports atuais) e criar o bloco de Range no lugar de `static.ts:268-277`, depois de `Content-Encoding` e depois do 304.

- Calcular `known = size !== undefined && Number.isSafeInteger(size) && size > 0`.
- Se `known` e `event.res.headers` ainda não tiver `accept-ranges`, definir `Accept-Ranges: bytes`.
- Manter o caminho atual de `Content-Length` condicional, de `HEAD` 200 e de `GET` 200 (`HTTPResponse(contents || null, { status: 200 })`).
- O cabeçalho só é definido depois do fallthrough/404/405 e do 304, para não vazar nesses casos.

Escrever primeiro os testes de integração em um novo `describeMatrix("serve static range", ...)` em `test/static.test.ts`, com asset de 1000 bytes, `etag: '"v1"'` e `mtime` fixo.

Cobre: RF-01, RF-07, RF-09, RF-12
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-01
Aceite: `GET` e `HEAD` sem `Range` devolvem `200` com `accept-ranges: bytes` e o corpo e os demais cabeçalhos de hoje. Sem `size` e com `size: 0`, não há `accept-ranges`. `If-None-Match` com o etag mais `Range` devolve `304` sem `content-range` e sem `accept-ranges`. Fallthrough não vaza `Vary` nem `Accept-Ranges`. `404` e `405` (`Allow: GET, HEAD`) com `Range` continuam normais. Passa em `web` e `node`.

### T-05 — Resposta `206` para `GET` e `HEAD`

No bloco de Range de `static.ts`, quando `known` e há `Range`: chamar `parseRange` e, se houver `If-Range` na requisição, `isIfRangeValid` com `{ etag: meta.etag, lastModified: mtimeDate }`. Se o resultado for um `ByteRange`:

- `HEAD`: devolver `HTTPResponse(null, { status: 206 })` sem chamar `getContents`.
- `GET`: `contents = await options.getContents(id)` e `sliceBody`. Só depois de o fatiamento dar certo, definir `content-range: bytes a-b/size` e `content-length` (`end - start + 1`) incondicionalmente, substituindo o valor de `options.headers`, e devolver `HTTPResponse(sliced, { status: 206 })`.
- `contents` vazio ou tipo não fatiável: voltar ao `200` completo, sem `Content-Range`, com a regra atual de `Content-Length` (D-07 e D-09).
- Preservar `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary` e `Accept-Ranges`.

Testes de integração primeiro: RF-02, RF-03, RF-04, RF-06, RF-07, RF-10 e RF-11 (`string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` com `Range: bytes=2-5`; `"héllo"`; `FormData`/`URLSearchParams` → `200`).

Cobre: RF-02, RF-03, RF-04, RF-06, RF-07, RF-10, RF-11
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-03, T-04
Aceite:

- `bytes=100-199` → `206`, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo igual aos bytes 100 a 199. `900-` e `-100` → `bytes 900-999/1000`. `0-5000` e `-5000` → `bytes 0-999/1000`. A unidade `Bytes` funciona.
- Um `content-length: 999` de `options.headers` é substituído por `100` no `206`. O teste existente de `HEAD` sem Range (`test/static.test.ts:600-617`) continua passando sem alterações.
- `HEAD` com `bytes=0-99` → `206`, `Content-Length: 100`, corpo vazio e `getContents` não chamado (`vi.fn`).
- `0-1,5-9`, `5-2`, `items=0-5`, `abc`, `bytes=` e `bytes 0-5` → `200` completo, `Content-Length: 1000`, sem `Content-Range` e com `Accept-Ranges`. Sem `size` → `200`, sem `Content-Range` e sem `Accept-Ranges`.
- Com `encodings: { gzip: ".gz" }`, `Accept-Encoding: gzip` e variante de 500 bytes, `0-99` → `206`, `bytes 0-99/500`, `Content-Encoding: gzip`, `Vary: accept-encoding` e os 100 primeiros bytes da variante.
- Os cinco tipos de corpo devolvem os mesmos 4 bytes. Passa em `web` e `node`.

### T-06 — Resposta `416`

No bloco de Range, quando `parseRange` devolve `"unsatisfiable"` (`a >= size` ou `-0`): definir `content-range: bytes */size` e `content-length: 0` incondicionalmente, devolver `HTTPResponse(null, { status: 416 })` e não chamar `getContents`. Manter `Accept-Ranges`, `ETag`, `Vary` e os demais metadados (D-08). O `416` deve vir depois da avaliação do `If-Range`, para um `If-Range` inválido não gerar `416` (o Range é ignorado nesse caso).

Testes de integração primeiro.

Cobre: RF-05
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-02, T-04
Aceite: com `bytes=1000-`, `bytes=2000-3000` e `bytes=-0`, em `GET` e `HEAD`, a resposta é `416` com `Content-Range: bytes */1000`, `Content-Length: 0`, `Accept-Ranges: bytes`, corpo vazio e `getContents` não chamado. `Content-Length` de `options.headers` é sobrescrito. Um `If-Range` que não confere com `bytes=1000-` devolve `200` completo. Passa em `web` e `node`.

### T-07 — Integração do `If-Range`

Conectar de ponta a ponta o `If-Range` ao bloco de Range. O cabeçalho só é lido quando há `Range` e `size` conhecido. `If-Range` sem `Range` não tem efeito.

Testes de integração do RF-08: ETag forte igual → `206`; diferente → `200`; fraco → `200`; data igual ao `Last-Modified` → `206`; data diferente ou inválida → `200`; asset sem `etag`/`mtime` → `200`; `If-Range` sem `Range` → `200` normal. Se a T-05 já tiver ligado o `isIfRangeValid`, esta tarefa fica só com os testes e com o ajuste do que faltar.

Cobre: RF-08
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-02, T-05
Aceite: com `etag: '"v1"'`, `Range: bytes=0-9` + `If-Range: "v1"` → `206`, e `If-Range: "v2"` → `200` completo sem `Content-Range`. Os demais casos da lista acima se comportam como descrito. Passa em `web` e `node`.

### T-08 — Revisão dos testes existentes e da API pública

Rodar a suíte existente de `serveStatic` e ajustar só os testes que quebrarem por causa do novo `Accept-Ranges` (por exemplo, os que comparam o conjunto exato de cabeçalhos), preservando o que cada um verifica. Os que usam `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`) devem passar sem alterações. Confirmar que `src/index.ts` não foi tocado e que as funções de Range não são exportadas por ele.

Cobre: RF-12, RF-13
Arquivos: `test/static.test.ts`, `test/unit/static-range.test.ts`
Depende de: T-05, T-06, T-07
Aceite: `pnpm vitest run test/static.test.ts` passa e continuam valendo `404` (inexistente e path não canônico), `405` com `Allow: GET, HEAD`, fallthrough, cache (`304`, `ETag`, `Last-Modified`), `Content-Type`, seleção de encoding e `indexNames`. `git diff --stat -- src/index.ts` não mostra alterações. Um teste (opcional) que importa `../src/index.ts` confirma a ausência de `parseRange`, `isIfRangeValid` e `sliceBody`.

### T-09 — Verificação final

Rodar `pnpm lint`, `pnpm typecheck` e `pnpm test` (suíte completa com cobertura). Corrigir o que aparecer, incluindo a formatação com `pnpm fmt` se `oxfmt --check` reclamar. Conferir que `range.ts` e `static.ts` seguem as convenções do `AGENTS.md` (imports com `.ts`, sem barrel, helpers internos em `utils/internal/`, `isolatedDeclarations` satisfeito). Comentar em `range.ts` a premissa de que `meta.size` é o tamanho da representação servida (R-02).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-12, RF-13
Arquivos: `src/utils/internal/range.ts`, `src/utils/static.ts`, `test/static.test.ts`, `test/unit/static-range.test.ts`
Depende de: T-08
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` terminam sem erros. Um cliente com `Range: bytes=0-99` recebe `206` com exatamente esses bytes, em `web` e `node`. `src/index.ts` não tem diferença.
