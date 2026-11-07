# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-08). Segue o fluxo de correção do AGENTS.md: testes primeiro (T-01, T-02), confirmar que falham, implementar (T-03 a T-06), confirmar que passam.

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-05 |
| RF-02 | T-01, T-02, T-03, T-06 |
| RF-03 | T-01, T-02, T-03, T-06 |
| RF-04 | T-01, T-05 |
| RF-05 | T-01, T-02, T-03, T-05 |
| RF-06 | T-01, T-02, T-03, T-05 |
| RF-07 | T-01, T-02, T-03, T-05 |
| RF-08 | T-01, T-05 |
| RF-09 | T-01, T-05, T-08 |
| RF-10 | T-01, T-06 |
| RF-11 | T-01, T-05, T-08 |
| RF-12 | T-01, T-02, T-04, T-06 |
| RF-13 | T-01, T-05, T-06 |

---

### T-01 — Escrever os testes de integração de Range (devem falhar)

Adicionar a `test/static.test.ts` um novo `describeMatrix("serve static range", …)` (web + node), com `getMeta`/`getContents` via `vi.fn` e asset `0123456789` (`size: 10`), no estilo do setup existente. Casos: GET/HEAD sem Range → 200 + `accept-ranges: bytes`; `2-5`, `4-`, `-3`, `8-999`, `-50`; HEAD com Range sem chamar `getContents`; `10-20`, `-0`, `0-99999999999999999999` e `99999999999999999999-`; Range ignorado (`abc`, `5-2`, `0-1,4-5`, `items=0-1`, `bytes=`, `bytes=-`); `If-Range` (ETag igual e data exata → 206; ETag diferente, `W/"abc"`, data diferente, data inválida, asset sem validador → 200); `size` ausente e `size: 0`; `If-None-Match` + Range → 304; `etag`/`last-modified` em 206 e 416; variante `gzip`; 404/405/`fallthrough` com Range; `getContents` devolvendo `string` (multibyte), `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` em vários chunks (intervalo no início cancela a leitura); `options.headers` com `cache-control` e `content-length: 999`; `getContents` nulo com Range válido → 200 sem `content-range`. Não enfraquecer nenhuma asserção existente.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-12, RF-13
Arquivos: `test/static.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` executa os testes novos e os de Range/`accept-ranges` falham antes da implementação; os testes antigos seguem passando.

### T-02 — Escrever os testes unitários do módulo interno (devem falhar)

Criar `test/unit/range.test.ts` importando `../../src/utils/internal/range.ts` diretamente. Cobrir `parseRange` (formas válidas, `bytes` case-insensitive, espaços, `-`, `5-2`, `-0`, início ≥ size, fim ≥ size, sufixo > size, números com 20+ dígitos sem exceção), `isIfRangeFresh` (comparação forte de ETag, `W/` em qualquer lado, data exata/diferente/inválida, ausência de validador, `If-Range` nulo) e `resolveRange` (sem `Range`, `If-Range` inválido). Cobrir `sliceBody` para `string` UTF-8, `Uint8Array` com `byteOffset`, `ArrayBuffer`, `Blob`, `ReadableStream` e `URLSearchParams`.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-12
Arquivos: `test/unit/range.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/range.test.ts` falha por o módulo ainda não existir; depois de T-03 e T-04 todos os casos passam.

### T-03 — Implementar `parseRange`, `isIfRangeFresh` e `resolveRange`

Criar `src/utils/internal/range.ts` (D-01, D-04, D-05) com `ByteRange`, `parseRange` (regex estrita `/^bytes=(\d*)-(\d*)$/i` sobre o valor com `trim()`, `Number()`, clamp a `size`, `undefined` para formas inválidas, `"unsatisfiable"` para 416), `isIfRangeFresh` (comparação forte de ETag; data por `Date.parse` com igualdade exata; sem validador → falso) e `resolveRange` (devolve `undefined` sem `Range`, com `If-Range` inválido ou com parser ignorando). Assinaturas conforme o §4 da techspec, com tipos explícitos (`isolatedDeclarations`), importações com `.ts` e sem barrel.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Arquivos: `src/utils/internal/range.ts`
Depende de: T-02
Aceite: os testes de `parseRange`, `isIfRangeFresh` e `resolveRange` em `test/unit/range.test.ts` passam; `pnpm lint` sem erros no arquivo; nenhum valor numérico enorme lança exceção.

### T-04 — Implementar `sliceBody`

Em `src/utils/internal/range.ts` (D-06): `string` via `TextEncoder` + `subarray`; `ArrayBufferView` respeitando `byteOffset`; `ArrayBuffer`/`SharedArrayBuffer` via `Uint8Array(buf, start, len)`; `Blob`/`File` via `slice`; `ReadableStream` com leitura incremental (descarta `start` bytes, repassa no máximo `len`, chama `reader.cancel()` ao terminar, sem acumular chunks); `FormData`/`URLSearchParams` via `new Response(body).body`.

Cobre: RF-12
Arquivos: `src/utils/internal/range.ts`
Depende de: T-03
Aceite: os testes de `sliceBody` em `test/unit/range.test.ts` passam, incluindo o cancelamento do stream ao atingir o fim do intervalo e o caso de string multibyte.

### T-05 — Integrar `Accept-Ranges`, 416, HEAD e `If-Range` em `serveStatic`

Em `src/utils/static.ts`, depois do 304 e da definição de `content-length` (D-02, D-03, D-07, D-08): se `Number.isSafeInteger(meta.size) && meta.size > 0`, definir `accept-ranges: bytes` quando ausente e chamar `resolveRange` com `etag`/`last-modified` efetivos de `event.res.headers`. Tratar `"unsatisfiable"` (GET e HEAD) com `content-range: bytes */size`, `content-length: 0`, corpo nulo e status 416, sem chamar `getContents`. Tratar HEAD com intervalo válido como 206 com `content-range` e `content-length` do trecho, sem corpo e sem chamar `getContents`. Sem tamanho válido, nada muda (200 como hoje). Escrever os cabeçalhos com `event.res.headers.set`. Não mexer em 404/405/`fallthrough`/304 nem em `src/response.ts`.

Cobre: RF-01, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-11, RF-13
Arquivos: `src/utils/static.ts`
Depende de: T-01, T-03
Aceite: `pnpm vitest run test/static.test.ts` passa nos casos de `accept-ranges`, HEAD com Range, 416, Range ignorado, `If-Range`, `size` ausente/0, 304 com Range, 404/405/`fallthrough` e `options.headers` (incluindo `content-length: 999` preservado em 200).

### T-06 — Responder 206 em GET com corpo cortado

Em `src/utils/static.ts` (D-07): para intervalo válido em GET, chamar `getContents(id)` antes de escrever `content-range`/`content-length`; se devolver `null`/`undefined`, responder como hoje (200 sem cabeçalhos de Range); senão aplicar `sliceBody`, definir `content-range: bytes s-e/size` e `content-length: e-s+1` e devolver `new HTTPResponse(body, { status: 206 })`. Manter `content-type`, `content-encoding`, `vary`, `etag` e `last-modified` da variante escolhida.

Cobre: RF-02, RF-03, RF-10, RF-12, RF-13
Arquivos: `src/utils/static.ts`
Depende de: T-04, T-05
Aceite: `pnpm vitest run test/static.test.ts` passa por inteiro, incluindo `2-5` → `2345` com `content-range: bytes 2-5/10` e `content-length: 4`, as formas `4-`, `-3`, `8-999`, `-50`, a variante `gzip` com `content-range` do tamanho da variante, todos os tipos de `BodyInit` e `getContents` nulo.

### T-07 — Documentar o comportamento (opcional pelo PRD)

Acrescentar à seção `serveStatic` um parágrafo curto: suporte a um único intervalo `bytes` em GET e HEAD, `Accept-Ranges`, `If-Range`, 416, e a exigência de `size` exato em `getMeta` (da variante servida, quando houver `encodings`). Sem alterar a API descrita.

Cobre: RF-01, RF-02, RF-08
Arquivos: `docs/2.utils/2.response.md`
Depende de: T-06
Aceite: o texto descreve o comportamento sem citar nomes novos exportados; `pnpm fmt`/`pnpm lint` não reportam diferenças no arquivo.

### T-08 — Verificação final e garantia de API pública inalterada

Rodar a suíte completa e confirmar que nenhuma exportação mudou e que nenhuma asserção existente foi enfraquecida.

Cobre: RF-09, RF-11
Arquivos: `src/index.ts` (somente leitura, sem alteração), `test/static.test.ts` (somente conferência)
Depende de: T-06, T-07
Aceite: `pnpm vitest run test/static.test.ts test/unit/range.test.ts`, `pnpm test` e `pnpm lint` (inclui typecheck) passam; `git diff src/index.ts src/response.ts src/utils/internal/cache.ts` está vazio; o diff de `test/static.test.ts` só adiciona linhas.
