# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08). Ordem: testes primeiro (devem falhar), depois a implementação, por último verificação e documentação. Todos os helpers ficam privados em `src/utils/static.ts` (sem `export`).

### T-01 — Testes de Range: fixture e cenários de RF-01 a RF-05

Criar em `test/static.test.ts` um novo `describeMatrix("serve static range", ...)` com o fixture da techspec §5 (asset de 10 bytes `0123456789`, `etag: "\"abc\""`, `mtime` fixo, `encodings: { gzip: ".gz" }` com variante de tamanho distinto, `getContents` como `vi.fn`). Escrever os casos: `Accept-Ranges` em GET/HEAD sem Range; `2-5`, `7-`, `-3`, `8-99`, `-99`, `0-0`, `9-9`; `options.headers` com `content-length: "999"` no 206; Range ignorado (`0-1,4-5`, `abc`, `items=0-1`, `5-2`, `bytes=-`, número gigante); 416 (`10-`, `50-60`, `-0`) com `etag`/`last-modified`/`vary` presentes e sem `content-type`; HEAD com Range sem chamar `getContents`.

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-11
- Arquivos: `test/static.test.ts`
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/static.test.ts` executa os novos testes nos modos `web` e `node` e eles **falham** (antes da implementação), enquanto os testes existentes continuam passando.

### T-02 — Testes de Range: If-Range, precedência, tipos de corpo e preservação

No mesmo `describeMatrix` de T-01, adicionar: `If-Range` com ETag igual (206), ETag diferente, `W/"abc"`, data diferente, data igual ao `Last-Modified` (206), valor inválido, `If-Range` sem `Range`, asset só com `mtime` e `If-Range` ETag, 416 com `If-Range` que casa e que não casa; `If-None-Match` + Range → 304 sem `Content-Range`; `Accept-Encoding: gzip` + Range → 206 da variante `.gz` com `Content-Encoding`, `Vary` e `Content-Range` pelo `size` da variante; `getContents` devolvendo `string`, `Uint8Array` (inclusive com `byteOffset ≠ 0`), `ArrayBuffer`, `Blob` e `ReadableStream` em chunks pequenos (todos 206 com `2345`), `FormData` → 200 completo, `null` → 200 vazio, string multibyte UTF-8, `size` divergente → 200 completo; asset sem `size` e com `size: 0` + `Range: bytes=0-1` → 200 sem `accept-ranges`/`content-range`; 405, 404 e `fallthrough` sem avaliar Range.

- Cobre: RF-06, RF-07, RF-08, RF-09, RF-11
- Arquivos: `test/static.test.ts`
- Depende de: T-01
- Aceite: os novos testes rodam nos dois modos e falham antes da implementação (exceto os que verificam preservação de comportamento atual); nenhum teste pré-existente foi alterado.

### T-03 — Parse do `Range` (`parseRange`) e tipos privados

Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, adicionar `type ByteRange`, `type RangeResult` e `parseRange(header, size)` conforme D-03: regex ancorada estrita para `bytes=a-b`, `bytes=a-`, `bytes=-n` (unidade case-insensitive), `Number.isSafeInteger`, fim limitado a `size - 1`, sufixo maior que o asset cobre tudo, `início > fim` testado antes do tamanho, `bytes=-0` e início ≥ tamanho → `"unsatisfiable"`; sintaxe inválida, outra unidade, vírgula e `bytes=-` → `"invalid"`. Sem `export`.

- Cobre: RF-02, RF-03, RF-04, RF-10
- Arquivos: `src/utils/static.ts`
- Depende de: T-01
- Aceite: a tabela de verdade da techspec §4 (tamanho 10) é satisfeita (`2-5`→2..5, `7-`→7..9, `-3`→7..9, `8-99`→8..9, `-99`→0..9, `10-`/`50-60`/`-0`→416, `5-2`/`0-1,4-5`/`abc`/`items=0-1`/`bytes=-`→ignorado); `pnpm typecheck` passa.

### T-04 — Avaliação de `If-Range` (`ifRangeMatches`) e `resolveRange`

Em `src/utils/static.ts`, adicionar `ifRangeMatches(value, resHeaders)` (D-04): valor que começa com `"`, `W/` ou `w/` é ETag e casa só com comparação forte e igualdade textual com o `etag` de `event.res.headers`; senão é data, casando só se `Date.parse` de ambos for válido e igual ao `last-modified` da resposta. Adicionar `resolveRange(reqHeaders, resHeaders, size)` que lê `Range`, chama `parseRange`, só consulta `If-Range` se o Range for elegível e devolve `ByteRange`, `"unsatisfiable"` ou `undefined` (ignorar).

- Cobre: RF-06, RF-03, RF-10
- Arquivos: `src/utils/static.ts`
- Depende de: T-03
- Aceite: `If-Range` com ETag forte igual libera o intervalo; ETag diferente, fraco (`W/`/`w/`), data diferente, valor inválido ou resposta sem o validador correspondente resultam em `undefined`; `If-Range` sem `Range` é ignorado; `pnpm typecheck` passa.

### T-05 — Fatiamento de corpo (`sliceBody` e `sliceStream`)

Em `src/utils/static.ts`, adicionar `sliceBody(body, range, size)` conforme tabela de D-05: `string` (UTF-8 via `TextEncoder`), `Blob`/`File` (`slice`), `ArrayBuffer`/`SharedArrayBuffer`, `ArrayBufferView` (respeitando `byteOffset`) e `ReadableStream`; devolver `undefined` para `FormData`, `URLSearchParams` e outros, ou quando o tamanho materializado diverge de `size`. Adicionar `sliceStream(source, range)`: descarta `start` bytes (cortando o chunk de fronteira), emite no máximo `end - start + 1` bytes, chama `reader.cancel()` ao terminar, propaga `cancel` do consumidor e gera erro para chunk que não seja `Uint8Array`.

- Cobre: RF-08, RF-10
- Arquivos: `src/utils/static.ts`
- Depende de: T-03
- Aceite: para `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` com `0123456789` e intervalo 2-5 o corpo resultante é `2345`; `FormData` e `size` divergente devolvem `undefined`; cancelar o stream fatiado cancela o reader original; `pnpm typecheck` passa.

### T-06 — Integração no fluxo de `serveStatic`: `Accept-Ranges`, 206, 416 e HEAD

Em `src/utils/static.ts`, alterar `serveStatic` conforme D-02, D-06 e D-08: após o `304` (`isCacheMatch`) e antes de `content-type`, definir `accept-ranges: bytes` só quando `meta.size > 0` e chamar `resolveRange`. `"unsatisfiable"` → retorno antecipado `416` (`content-range: bytes */size`, `content-length: 0`, corpo vazio, via `event.res.headers.set`, sem escrever `content-type`/`content-encoding`). Range válido → `set` de `content-range` e `content-length` (sobrescrevendo `options.headers`), `HTTPResponse` 206; HEAD sem corpo e sem chamar `getContents`; GET com `sliceBody`. Se `sliceBody` devolver `undefined` ou `getContents` vier vazio, cair no `200` completo de hoje. Mover o bloco de `content-length` por `meta.size` para o caminho completo. Os caminhos 304, 404, 405, caminho não canônico e `fallthrough` não avaliam Range.

- Cobre: RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
- Arquivos: `src/utils/static.ts`
- Depende de: T-02, T-04, T-05
- Aceite: `pnpm vitest run test/static.test.ts` passa por inteiro nos modos `web` e `node` (novos e existentes, inclusive o teste de `content-length` de `options.headers` no 200); `304` prevalece sobre Range; 206 da variante `.gz` traz `Content-Range` com o `size` da variante.

### T-07 — Verificação de exports, lint e suíte completa

Comparar `grep -n "^export" src/utils/static.ts` com a versão original (`git show HEAD:src/utils/static.ts`), confirmar que `src/index.ts` e `ServeStaticOptions`/`StaticAssetMeta` não mudaram e rodar `test/unit/package.test.ts`. Rodar lint, typecheck e a suíte completa; se algum teste existente comparar o conjunto exato de cabeçalhos por causa de `Accept-Ranges`, ajustar apenas a asserção, mantendo o que ela verifica.

- Cobre: RF-10, RF-09
- Arquivos: `src/utils/static.ts`, `src/index.ts`, `test/unit/package.test.ts`
- Depende de: T-06
- Aceite: nenhum nome novo exportado; `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam; `git diff --stat` não mostra mudanças em `src/index.ts`, `src/response.ts` nem `src/utils/internal/cache.ts`.

### T-08 — Verificação por mutação dos testes

Provar que os testes novos detectam a ausência da feature: desativar temporariamente o bloco de Range em `src/utils/static.ts` (por exemplo com `git stash` do arquivo) e executar `pnpm vitest run test/static.test.ts`; restaurar em seguida.

- Cobre: RF-11
- Arquivos: `test/static.test.ts`
- Depende de: T-06
- Aceite: sem a implementação, os testes de intervalo válido (RF-02), 416 (RF-04) e `If-Range` (RF-06) falham nos dois modos; com a implementação restaurada, todos passam e `git status` não mostra resíduo do stash.

### T-09 — Nota de documentação (opcional)

Acrescentar em `docs/4.examples/serve-static-assets.md`, após a linha 69, uma nota curta: `serveStatic` atende `Range` de um único intervalo, `size` de `getMeta` deve ser exato (tamanho da variante servida) e `Blob`/`File` fatiam com mais eficiência que `ReadableStream`.

- Cobre: RF-08
- Arquivos: `docs/4.examples/serve-static-assets.md`
- Depende de: T-06
- Aceite: a nota existe, está em linha com o estilo do documento e `pnpm lint` (formatação) continua passando.
