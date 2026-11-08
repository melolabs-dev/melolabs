# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01..RF-12) e `sdd/techspec.md` (D-01..D-10). Toda a mudança de código fica em `src/utils/static.ts`; nenhuma exportação pública nova. Seguir o fluxo de bug do AGENTS.md: testes primeiro (devem falhar), depois a implementação.

### T-01 — Fixture e testes de Range (fase vermelha)

Criar em `test/static.test.ts` um fixture com asset de 10 bytes `"0123456789"`, `etag: '"abc"'` (forte), `mtime`, `getContents: vi.fn`, e os `describeMatrix` (web e node) cobrindo: `Accept-Ranges` em GET/HEAD; formas `a-b`, `a-`, `-n`, `8-99`, `-50`, `0-0`; HEAD com Range sem chamar `getContents`; 416 (`10-20`, `-0`, `99-`) em GET e HEAD; Range ignorado (`abc`, `5-2`, `bytes=`, `bytes=-`, `0-1,4-5`, `items=0-1`, `5abc-6`, `-1-2`); `BYTES=2-5`, espaços e inteiro enorme válidos; `If-Range` (ETag forte, outro, `W/"abc"`, data igual/diferente, asset sem etag, `If-Range` sem `Range`); 304 com `If-None-Match`/`If-Modified-Since` + Range; `encodings: { gzip: ".gz" }` com variante de `size` 20 (206 e 416 mantêm `etag`, `last-modified`, `content-type`, `content-encoding`, `vary` e `headers` configurados); `getContents` devolvendo `string` (incluindo multibyte), `Uint8Array`, `ArrayBuffer`, `Blob`/`File` e `ReadableStream` (um e vários chunks, `cancel` do upstream ao fim); `getMeta` sem `size` e com `size: 0`; 404, `fallthrough` e 405 (`Allow: GET, HEAD`) com Range; `headers: { "content-length": "999" }` (999 sem Range, 4 em 206).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` executa os novos testes e os de Range/`Accept-Ranges` **falham** (confirmar antes de implementar); os testes já existentes continuam passando; `ctx.errors` vazio nos testes que não esperam erro.
Arquivos: `test/static.test.ts`

### T-02 — Parsing de `Range` e validação de `If-Range` (helpers privados)

Na seção "Internal Utils" de `static.ts`, adicionar o tipo `ByteRange` e as funções sem `export`: `parseRange(header, size)` (regex ancorada `/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i`, sem `parseInt`; retorna `ByteRange`, `"unsatisfiable"` ou `undefined`, conforme D-05), `isIfRangeValid(ifRange, { etag, lastModified })` (comparação forte de ETag, `W/` em qualquer caixa nunca casa, data por igualdade exata, conforme D-06) e `resolveRange(event, size)` (lê `Range`/`If-Range` de `event.req.headers`, ignora `If-Range` sem `Range`, e usa os validadores de `event.res.headers`). Retornos explícitos por causa de `isolatedDeclarations`.

Cobre: RF-02, RF-04, RF-05, RF-06
Depende de: T-01
Aceite: os testes de parsing (RF-02, RF-04, RF-05) e de `If-Range` (RF-06) de T-01 passam depois da integração em T-04; `pnpm lint` sem erros de tipo ou lint nos helpers; nenhum `export` novo em `static.ts`.
Arquivos: `src/utils/static.ts`

### T-03 — Fatiamento do corpo por tipo de `BodyInit`

Na mesma seção, adicionar `sliceBody(body, range)` privada (D-08): `string` via `TextEncoder` e `subarray` (corte em bytes UTF-8); `ArrayBuffer`/`ArrayBufferView` via `Uint8Array` sem cópia; `Blob`/`File` via `slice(start, end + 1)`; `ReadableStream` (e `URLSearchParams`/`FormData` via `new Response(body).body`) com `pull` que descarta `start` bytes, emite até `end - start + 1` bytes e faz `cancel()` do upstream ao terminar ou quando o consumidor cancelar.

Cobre: RF-09
Depende de: T-01
Aceite: com o Range `bytes=2-5`, os testes de RF-09 (string, multibyte, `Uint8Array`, `ArrayBuffer`, `Blob`/`File`, `ReadableStream` de um e de vários chunks) entregam exatamente 4 bytes (`2345`) em web e node, e o upstream do stream recebe `cancel` após o fim.
Arquivos: `src/utils/static.ts`

### T-04 — Integrar Range, `Accept-Ranges`, 206 e 416 em `serveStatic`

Substituir o trecho de `content-length`/HEAD/`getContents` (`static.ts:268-277`) pelo fluxo de D-09, mantendo-o depois do 304 (`isCacheMatch`) e dos cabeçalhos de representação (D-01): calcular `hasSize` (`size > 0` e `Number.isSafeInteger`); manter o `content-length` atual no 200; setar `accept-ranges: bytes` se ausente e só com tamanho conhecido; chamar `resolveRange`; em `"unsatisfiable"` responder `416` (`content-range: bytes */size`, `content-length: 0`, corpo `null`, sem `getContents`); em intervalo válido responder `206` (`content-range`, `content-length` sobrescritos com `set`), HEAD sem chamar `getContents`, GET com `await getContents` seguido de `sliceBody`; se `getContents` devolver vazio, manter o 200 atual sem `content-range`. Comentar a premissa de que `size` é em bytes da representação servida. 405, 404, `fallthrough` e caminho canônico permanecem antes, inalterados.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-07, RF-08, RF-10, RF-11
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/static.test.ts` passa por inteiro (novos e existentes, inclusive `content-length: 999` sem Range e 304 com Range); 416 e 206 mantêm `etag`, `last-modified`, `content-type`, `content-encoding`, `vary` e `headers` configurados; sem `size` (ou `size: 0`) não há `accept-ranges` nem `content-range`.
Arquivos: `src/utils/static.ts`

### T-05 — Verificação da API pública e da suíte completa

Conferir que nada público mudou e rodar a validação final.

Cobre: RF-12
Depende de: T-04
Aceite: `git diff src/index.ts` vazio; `test/unit/package.test.ts` passa sem alteração (snapshot de exports intacto); `static.ts` não exporta nomes novos (valores ou tipos); `pnpm vitest run test/unit/`, `pnpm lint` (inclui typecheck) e `pnpm test` passam.
Arquivos: `src/index.ts`, `src/utils/static.ts`, `test/unit/package.test.ts`

### T-06 — Documentar o suporte a Range (opcional)

Acrescentar uma frase em `docs/4.examples/serve-static-assets.md` informando que `serveStatic` atende `Range` de um intervalo (GET/HEAD) quando `getMeta` informa `size` em bytes da representação servida, e que sem `size` o comportamento não muda.

Cobre: RF-01, RF-10
Depende de: T-04
Aceite: a frase aparece na doc, o texto é fiel ao comportamento implementado e `pnpm fmt`/`pnpm lint` não reportam diferenças de formatação no arquivo.
Arquivos: `docs/4.examples/serve-static-assets.md`
