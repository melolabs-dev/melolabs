# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` e `sdd/techspec.md`. Ordem sugerida: T-01 → T-08. Seguindo o fluxo de bug do AGENTS.md, os testes de integração são escritos primeiro e confirmados falhando (T-01); as tarefas seguintes os fazem passar. Nenhuma tarefa cria exportação pública (RF-13).

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-05 |
| RF-02 | T-01, T-02, T-04, T-07 |
| RF-03 | T-01, T-02, T-07 |
| RF-04 | T-01, T-07 |
| RF-05 | T-01, T-02, T-06 |
| RF-06 | T-01, T-02, T-06 |
| RF-07 | T-01, T-05, T-06 |
| RF-08 | T-01, T-03, T-06 |
| RF-09 | T-01, T-05, T-06, T-07 |
| RF-10 | T-01, T-06, T-07 |
| RF-11 | T-01, T-06, T-08 |
| RF-12 | T-01, T-07 |
| RF-13 | T-02, T-03, T-04, T-08 |

---

### T-01 — Escrever os testes de integração de Range (e vê-los falhar)

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-12

Criar `describeMatrix("serve static range")` em `test/static.test.ts`, após o último `describeMatrix` existente, com `getContents`/`getMeta` em `vi.fn` como no início do arquivo. Asset base: 100 bytes (`"0123456789".repeat(10)`), `etag: '"v1"'`, `mtime` fixo. Casos:

- RF-01: `GET` e `HEAD` sem `Range` → 200 completo com `accept-ranges: bytes`; `304` também traz `accept-ranges`.
- RF-02/03: `bytes=10-19`, `90-`, `-10`, `90-999`, `-500` com corpo, `content-range` e `content-length` exatos.
- RF-04: `HEAD` com `Range` → 206, mesmos cabeçalhos do `GET`, corpo vazio, `getContents` não chamado.
- RF-05: `100-`, `150-200`, `-0` → 416, `content-range: bytes */100`, `content-length: 0`, sem corpo; `HEAD` idem; `getContents` não chamado.
- RF-06: `abc`, `5-2`, `bytes=`, `items=0-1`, `0-1,5-6` → 200 completo.
- RF-07: `getMeta` sem `size` e com `size: 0` → 200 completo, sem `accept-ranges`.
- RF-08: `If-Range` com ETag forte igual → 206; ETag diferente, `W/"v1"` e data diferente → 200 completo; data igual ao `Last-Modified` → 206; `If-Range` sem `Range` → 200.
- RF-09: `If-None-Match` casando + `Range` → 304 sem `content-range`; `etag`, `last-modified`, `vary` e `cache-control` presentes no 206.
- RF-10: `encodings: { gzip: ".gz" }` + `accept-encoding: gzip` + `Range` → fatia da variante `.gz` com o `size` dela, `content-encoding: gzip`, `vary: accept-encoding`, `content-type` do original.
- RF-11: asset inexistente, `POST` e caminho não canônico com `Range` → 404/405 com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`), sem `accept-ranges` nem `content-range`.
- RF-12: `headers: { "content-length": "999" }` com `Range` válido → `content-length` do intervalo; sem `Range`, `999` (como no teste existente de `HEAD`).
- Tipos de corpo: `getContents` devolvendo `string`, `Blob`, `Uint8Array`, `ArrayBuffer` e `ReadableStream` produzem o mesmo corpo fatiado; `getContents` sem conteúdo com `Range` → 200 vazio como hoje.

Nomear os testes de forma a registrar as decisões RFC 9110 (comparação forte no `If-Range`, `bytes=5-2` ignorado, 304 antes de `Range`).

Arquivos:
- `test/static.test.ts`

Depende de: nenhuma

Aceite: `pnpm vitest run test/static.test.ts` roda e os casos novos de 206/416/`accept-ranges` **falham** (os de regressão RF-06, RF-07, RF-11 e o 304 sem `Range` já passam); os testes antigos do arquivo continuam passando; `pnpm lint` sem erros no arquivo.

---

### T-02 — `parseRange` interno e seus testes unitários

Cobre: RF-02, RF-03, RF-05, RF-06, RF-13

Criar `src/utils/internal/range.ts` com `export interface ByteRange` e `export function parseRange(header, size)` conforme a seção 4 e D-04 da techspec: resultado `ByteRange | "unsatisfiable" | undefined`, unidade `bytes` sem diferenciar maiúsculas, um único `range-spec`, validação por `^bytes=(\d*)-(\d*)$` após `trim`, formas `a-b`, `a-` e `-n` normalizadas ao tamanho. Comentário de módulo com a premissa de que `size` é o tamanho real do corpo (R-01). Não reexportar em `src/index.ts`. Imports com extensão `.ts`, tipos explícitos (`isolatedDeclarations`).

Criar `test/unit/range.test.ts` com tabela de `parseRange`: `Bytes=`, espaços nas pontas, números enormes, `bytes=-`, `bytes=`, `bytes=0-0` com `size=1`, `5-2`, `0-1,5-6`, `items=0-1`, `-0`, `-500`, `100-` com `size=100`.

Arquivos:
- `src/utils/internal/range.ts`
- `test/unit/range.test.ts`

Depende de: nenhuma

Aceite: `pnpm vitest run test/unit/range.test.ts` passa com todos os casos de `parseRange`; `pnpm typecheck` e `pnpm lint` passam; `src/index.ts` não foi alterado.

---

### T-03 — `ifRangeAllows` interno e seus testes unitários

Cobre: RF-08, RF-13

Acrescentar `export function ifRangeAllows(ifRange, { etag, lastModified })` em `src/utils/internal/range.ts` (D-05): sem `If-Range` → `true`; entity-tag (começa com `"` ou `W/`) só vale se ambos forem fortes e idênticos como string; caso contrário trata como data e exige igualdade exata de milissegundos com `last-modified`; data inválida ou sem `last-modified` → `false`. Não reutilizar `matchETag` (comparação fraca).

Estender `test/unit/range.test.ts` com `ifRangeAllows`: ETag forte igual/diferente, `W/"v1"` do cliente, ETag fraco da resposta, `w/123` minúsculo, resposta sem `etag`, data igual, data diferente, data inválida, ausência de `If-Range`.

Arquivos:
- `src/utils/internal/range.ts`
- `test/unit/range.test.ts`

Depende de: T-02

Aceite: `pnpm vitest run test/unit/range.test.ts` passa incluindo os casos de `ifRangeAllows`; `pnpm typecheck` e `pnpm lint` passam; o arquivo `src/utils/internal/range.ts` continua abaixo de ~200 linhas.

---

### T-04 — `sliceBody` interno e seus testes unitários

Cobre: RF-02, RF-13

Acrescentar `export function sliceBody(body, range)` em `src/utils/internal/range.ts` (D-06): `string` → `TextEncoder` + `subarray`; `Blob`/`File` → `slice`; `ArrayBuffer` e `ArrayBufferView` → `Uint8Array` sobre o intervalo; `ReadableStream` → novo stream que descarta `start` bytes, repassa até `end - start + 1` bytes e chama `cancel()` na origem ao concluir ou quando o consumidor cancela (R-03); demais tipos → `new Response(body).arrayBuffer()` + `subarray`, com comentário explicando o fallback. Se a origem for mais curta que `size`, o stream encerra no fim real.

Estender `test/unit/range.test.ts` com `sliceBody` para cada tipo, incluindo stream com chunks que cruzam `start` e `end`, chunk de string no stream, e verificação de que `cancel()` da origem é chamado após o último byte e quando o consumidor cancela.

Arquivos:
- `src/utils/internal/range.ts`
- `test/unit/range.test.ts`

Depende de: T-02

Aceite: `pnpm vitest run test/unit/range.test.ts` passa com os casos de `sliceBody`; `pnpm typecheck` e `pnpm lint` passam. Se o módulo passar de ~200 linhas, dividir em arquivo interno adicional sem reexportação.

---

### T-05 — Anunciar `Accept-Ranges: bytes` quando o tamanho é conhecido

Cobre: RF-01, RF-07, RF-09

Em `src/utils/static.ts`, introduzir `const knownSize = meta.size !== undefined && meta.size > 0` (D-08) e, logo após o `etag` e antes do teste `isCacheMatch` (D-03), definir `accept-ranges: bytes` quando `knownSize` e o cabeçalho ainda não existir. Reutilizar `knownSize` no bloco existente de `content-length`. Não emitir nada em 404/405/fallthrough.

Arquivos:
- `src/utils/static.ts`

Depende de: T-01

Aceite: `pnpm vitest run test/static.test.ts` — passam os casos de RF-01 (200 `GET`/`HEAD` e 304 com `accept-ranges`) e de RF-07 (sem `size` ou `size: 0` → sem `accept-ranges`); os testes antigos do arquivo seguem passando sem edição.

---

### T-06 — Resolver `Range`/`If-Range` e responder `416`

Cobre: RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11

Em `src/utils/static.ts`, importar `parseRange` e `ifRangeAllows` de `./internal/range.ts` e inserir o bloco da seção 4 da techspec entre `content-encoding` e `content-length` (D-02): só avalia com `knownSize` e `Range` presente; `If-Range` usa `etag`/`last-modified` de `event.res.headers`; `"unsatisfiable"` → remove `content-encoding`, define `content-range: bytes */SIZE` e `content-length: 0` e devolve `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })` (também para `HEAD`, sem chamar `getContents`). `undefined` (ignorar) deixa o fluxo atual produzir 200. O 304 continua decidindo antes (RF-09) e 404/405/caminho não canônico não são tocados (RF-11).

Arquivos:
- `src/utils/static.ts`

Depende de: T-02, T-03, T-05

Aceite: `pnpm vitest run test/static.test.ts` — passam RF-05 (416 em `GET` e `HEAD`, `getContents` não chamado), RF-06 (200 completo para `Range` inválido/multi/unidade desconhecida), RF-08 nos casos que resultam em 200, RF-09 (304 com `Range`) e RF-11; o caso RF-10 com `bytes=100-` sobre a variante `.gz` devolve 416 sem `content-encoding`.

---

### T-07 — Responder `206` em `GET` e `HEAD` com corte do corpo

Cobre: RF-02, RF-03, RF-04, RF-09, RF-10, RF-12

Em `src/utils/static.ts`, importar `sliceBody` e tratar o intervalo satisfatório (D-07): `HEAD` define `content-range: bytes S-E/SIZE` e `content-length` (`E-S+1`) incondicionalmente (RF-12) e devolve `new HTTPResponse(null, { status: 206 })` sem chamar `getContents`; `GET` obtém `getContents(id)` **antes** de fixar os cabeçalhos, aplica `sliceBody` e devolve 206; sem conteúdo, cai no 200 atual sem `content-range`. Calcular intervalo e cabeçalhos uma única vez antes do ramo por método (R-04). `etag`, `last-modified`, `vary`, `cache-control` e `content-encoding` da variante escolhida permanecem; `content-type` continua o do asset original. Sem `Range`, o `content-length` do usuário continua valendo.

Arquivos:
- `src/utils/static.ts`

Depende de: T-04, T-06

Aceite: `pnpm vitest run test/static.test.ts test/unit/range.test.ts` passa por inteiro, nos modos `web` e `node`: RF-02/03 (`10-19`, `90-`, `-10`, `90-999`, `-500`), RF-04 (`HEAD` igual ao `GET`, sem corpo), RF-08 (casos 206), RF-09 (cabeçalhos no 206), RF-10 (fatia da `.gz`), RF-12 (`content-length` do intervalo com `content-length: 999` do usuário) e todos os tipos de corpo (`string`, `Blob`, `Uint8Array`, `ArrayBuffer`, `ReadableStream`).

---

### T-08 — Verificação final, API pública e documentação gerada

Cobre: RF-11, RF-13

Garantir que nenhuma exportação pública mudou (`src/index.ts`, `ServeStaticOptions` e `StaticAssetMeta` intactos; `test/unit/package.test.ts` passa sem edição de snapshot). Rodar a suíte completa e corrigir apenas o que a mudança afetou. Se o JSDoc de `serveStatic` for ampliado, rodar `pnpm fmt` para regenerar `docs/2.utils/2.response.md` (R-10). Confirmar que `test/static.test.ts` não teve asserção enfraquecida e que RF-11 segue verde (404/405/`fallthrough` sem cabeçalhos de `Range`).

Arquivos:
- `src/utils/static.ts`
- `src/utils/internal/range.ts`
- `test/static.test.ts`
- `test/unit/range.test.ts`
- `docs/2.utils/2.response.md`

Depende de: T-07

Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` passam; `git diff --stat` mostra alterações apenas nos arquivos acima (mais `docs/2.utils/2.response.md` se regenerado); `git diff src/index.ts` está vazio; `pnpm build` conclui sem erros.
