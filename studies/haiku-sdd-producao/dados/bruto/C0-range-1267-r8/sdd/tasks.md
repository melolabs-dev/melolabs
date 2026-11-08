# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-09).
Fluxo de correção do AGENTS.md: testes primeiro (devem falhar), depois a implementação (devem passar), por fim a suíte completa.
Todo o código novo fica em `src/utils/static.ts`; os testes, em `test/static.test.ts`. `src/index.ts` não é tocado.

### T-01 — Testes de range: anúncio, 206, formas de intervalo, HEAD, 416, Range ignorado e sem tamanho

Criar o bloco `describeMatrix("serve static range", …)` ao final de `test/static.test.ts`, com asset de 10 bytes `0123456789`, `size: 10`, `etag: '"v1"'`, `mtime` fixo e `getContents` como `vi.fn`. Escrever os casos:

- `GET`/`HEAD` sem `Range` → `200`, `Accept-Ranges: bytes`, corpo inteiro (RF-01);
- `bytes=2-5` → `206`, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` (RF-02);
- `bytes=7-`, `-3`, `8-99`, `-99` → `7-9`, `7-9`, `8-9`, `0-9`, com comprimentos 3/3/2/10 (RF-03);
- `HEAD` + `bytes=2-5` → `206`, mesmos cabeçalhos, sem corpo, `getContents` não chamado (RF-04);
- `bytes=10-` e `bytes=-0` → `416`, `Content-Range: bytes */10`, `Content-Length: 0`, `getContents` não chamado (RF-05);
- `bytes=0-1,4-5`, `bytes=5-2`, `items=0-1`, `bytes=abc`, `bytes=` → `200` completo, sem `Content-Range`, com `Content-Length: 10` e `Accept-Ranges`; `BYTES=2-5` → `206` (RF-06);
- `getMeta` sem `size` e com `size: 0` + `Range` → `200` sem `Content-Range` e sem `Accept-Ranges` (RF-10).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-10
Arquivos: `test/static.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` roda e os casos novos **falham** (por ausência do recurso), enquanto os testes pré-existentes continuam passando.

### T-02 — Testes de range: If-Range, 304, encoding, content-length do chamador, fallthrough/404/405

No mesmo bloco, acrescentar:

- `If-Range`: ETag igual → `206`; `"v2"` e `W/"v1"` → `200` completo; asset com ETag fraca → `200`; data igual ao `Last-Modified` → `206`; data diferente ou inválida → `200`; asset sem validador → `200` (RF-07);
- `Range: bytes=2-5` + `If-None-Match: "v1"` → `304` sem corpo e sem `Content-Range` (RF-08);
- `encodings: { gzip: ".gz" }`, `/app.js.gz` com `size: 20`, `Accept-Encoding: gzip`, `bytes=0-4` → `206`, `Content-Encoding: gzip`, `bytes 0-4/20`, `Content-Length: 5`, `Vary: accept-encoding`, corpo com os 5 primeiros bytes da variante (RF-09);
- `options.headers: { "content-length": "10" }` + `bytes=2-5` → `Content-Length: 4`, com `ETag`, `Last-Modified` e `Content-Type` iguais aos do `200`; o `416` também ignora o `content-length` do chamador; `options.headers` com `accept-ranges` próprio não é sobrescrito (RF-11);
- `Range` em asset inexistente → `404`; com `fallthrough` → `undefined`/próximo handler, sem cabeçalhos de range; caminho não canônico idem; `POST` + `Range` → `405` com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`), sem `Accept-Ranges` (RF-12).

Cobre: RF-07, RF-08, RF-09, RF-11, RF-12
Arquivos: `test/static.test.ts`
Depende de: T-01
Aceite: os casos novos de `If-Range`, encoding e content-length **falham** antes da implementação; os casos de 304/404/405/fallthrough já passam (documentam o comportamento preservado).

### T-03 — Testes de range: tipos de corpo devolvidos por `getContents`

Acrescentar casos com `bytes=1-3` (e um que cruze chunks) para cada tipo de corpo: `string` com caractere multibyte (`"héllo"`, `size` em bytes UTF-8), `Uint8Array` com `byteOffset` ≠ 0, `ArrayBuffer`, `Blob`, `ReadableStream` com vários chunks (intervalo cruzando chunks, parada ao atingir o limite e cancelamento da fonte). Tipo não suportado (`URLSearchParams`) → `200` completo, sem `Content-Range` e com `Content-Length` do asset inteiro. Documentar no teste a premissa de que `meta.size` é o tamanho real do corpo.

Cobre: RF-02, RF-09
Arquivos: `test/static.test.ts`
Depende de: T-01
Aceite: os casos de tipo de corpo **falham** antes da implementação (exceto o do tipo não suportado, que já devolve `200`).

### T-04 — Helper privado `parseRange`

Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, adicionar o tipo local `ByteRange` e `parseRange(header, size)` sem `export`, com a regex `^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$` (flag `i`). Regras: não casa, `b < a` ou ambos os lados vazios → `undefined` (ignorar); `a >= size` ou sufixo `-0` → `"unsatisfiable"`; `b >= size` → `end = size - 1`; sufixo `-n` com `n >= size` → `{ start: 0, end: size - 1 }`.

Cobre: RF-03, RF-05, RF-06
Arquivos: `src/utils/static.ts`
Depende de: T-01
Aceite: `pnpm typecheck` passa e `parseRange` não aparece nas exportações do módulo; fica validado pelos testes de T-01 depois de T-07.

### T-05 — Helper privado `ifRangeAllows`

Em `src/utils/static.ts` (Internal Utils), adicionar `ifRangeAllows(headers, { etag, lastModified })` sem `export`, com comparação **forte** (não reutilizar `matchETag`, que é fraca): sem `If-Range` → `true`; valor iniciado por `"` ou `W/` é ETag e só permite se `etag` existir, nenhum dos dois começar com `W/` e as strings forem idênticas; caso contrário é data, e só permite se o valor e o `Last-Modified` forem datas válidas e iguais em segundos; vazio, inválido ou sem validador → `false`.

Cobre: RF-07
Arquivos: `src/utils/static.ts`
Depende de: T-02
Aceite: `pnpm typecheck` passa e a função não é exportada; o comportamento é validado pelos testes de `If-Range` de T-02 depois de T-07.

### T-06 — Helper privado `sliceBody`

Em `src/utils/static.ts` (Internal Utils), adicionar `sliceBody(body, range)` sem `export`, que devolve o corpo recortado ou `undefined` para tipo não suportado: `string` (bytes UTF-8 via `TextEncoder` + `subarray`), `ArrayBuffer`, `ArrayBuffer.isView` (sem cópia, respeitando `byteOffset`), `Blob`/`File` (`slice`) e `ReadableStream` (descarta `start` bytes, emite até o comprimento do intervalo, cancela a fonte ao terminar e propaga `cancel`; chunk que não seja `Uint8Array` faz o stream falhar com `TypeError`). `URLSearchParams`, `FormData` e outros → `undefined`.

Cobre: RF-02, RF-09
Arquivos: `src/utils/static.ts`
Depende de: T-03
Aceite: `pnpm typecheck` passa e a função não é exportada; validada pelos testes de T-03 depois de T-07.

### T-07 — Integrar range em `serveStatic` (Accept-Ranges, 206, 416, HEAD)

Em `src/utils/static.ts`, entre o cálculo de `content-length` e o ramo `HEAD`/`getContents` (depois do `isCacheMatch`, sem reordenar nada existente):

- calcular `size` conhecido (`size > 0`) e gravar `accept-ranges: bytes` com `set` apenas se o chamador não definiu o cabeçalho (RF-01, RF-10);
- chamar `parseRange` e só então `ifRangeAllows`, com `etag` e `last-modified` lidos de `event.res.headers` (RF-07);
- `416`: gravar `content-range: bytes */size` e `content-length: 0` com `set` incondicional, retornar `HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })` sem chamar `getContents` (RF-05, RF-11);
- `206` em `HEAD`: gravar `content-range` e `content-length` do intervalo e retornar sem chamar `getContents` (RF-04);
- `206` em `GET`: ler `getContents`, aplicar `sliceBody`, e só se devolver corpo gravar os cabeçalhos e retornar `206`; senão retornar o `200` completo original (D-05); `getContents` nulo mantém o comportamento atual;
- 304, 404, 405 e `fallthrough` ficam intactos, sem cabeçalhos de range (RF-08, RF-12); o `size` usado é o da variante com encoding escolhida (RF-09).

Cobre: RF-01, RF-02, RF-04, RF-05, RF-08, RF-09, RF-10, RF-11, RF-12
Arquivos: `src/utils/static.ts`
Depende de: T-04, T-05, T-06
Aceite: `pnpm vitest run test/static.test.ts` passa por inteiro (casos novos de T-01, T-02 e T-03 e os pré-existentes, inclusive o de `content-length` do chamador em `HEAD` sem `Range`); `pnpm vitest run test/security.test.ts` passa.

### T-08 — Verificação final e garantia de API pública inalterada

Conferir que `src/index.ts` não mudou, que `StaticAssetMeta` e `ServeStaticOptions` mantêm a forma e que `parseRange`, `ifRangeAllows`, `sliceBody` e `ByteRange` não são exportados. Rodar `pnpm vitest run test/unit/` (guarda de exportações em `test/unit/package.test.ts`), depois `pnpm test` (lint com `oxlint`/`oxfmt`, typecheck e cobertura). Ajustar só afirmações de testes antigos que quebrem por causa do novo `Accept-Ranges`, sem perder o que verificam. Opcional: um parágrafo curto sobre Range em `docs/2.utils/2.response.md` (não faz parte do contrato).

Cobre: RF-13
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-07
Aceite: `git diff --stat` mostra alterações apenas em `src/utils/static.ts` e `test/static.test.ts` (mais a doc, se feita); `git diff src/index.ts` vazio; `pnpm test` passa sem falhas.
