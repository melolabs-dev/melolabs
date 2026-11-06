# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-11). Todos os helpers ficam privados (sem `export`) em `src/utils/static.ts`, na seção `// --- Internal Utils ---`. Os testes entram em `test/static.test.ts`, com `describeMatrix` (modos `web` e `node`). Seguir o fluxo do `AGENTS.md`: escrever o teste, confirmar que falha, implementar, confirmar que passa.

### T-01 — Cabeçalho `Accept-Ranges` em todo asset encontrado

Gravar `accept-ranges: bytes` em `event.res.headers` logo depois de o meta ser encontrado (perto de `Vary`), antes da checagem de 304. Não gravar em fallthrough, 404 e 405, que retornam antes. Escrever primeiro os testes: GET e HEAD, com e sem `Range`, e também no 304; ausente em 404, 405 e fallthrough.

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`; os testes novos falham antes da mudança e passam depois; a resposta de asset encontrado (200, 304, HEAD) traz `Accept-Ranges: bytes`; 404, 405 e fallthrough não trazem; os testes existentes seguem verdes.
Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-02 — Parser privado `parseRange`

Implementar `parseRange(header, size)` retornando `ByteRange | "unsatisfiable" | undefined`, conforme D-04. Unidade só `bytes` (sem diferenciar maiúsculas); qualquer `,` retorna `undefined`; formas `a-b`, `a-` e `-n`; sintaxe inválida e `a > b` retornam `undefined`; início `>= size` retorna `"unsatisfiable"`; fim além do arquivo é limitado a `size - 1`; `-0` retorna `"unsatisfiable"`; sufixo maior que o arquivo vira `0-(size-1)`; números fora do intervalo seguro tratados como além do arquivo. Declarar o tipo local `ByteRange` sem `export` e anotar o retorno.

Cobre: RF-02, RF-03, RF-04, RF-05
Depende de: nenhuma
Aceite: para um asset de 100 bytes, `bytes=10-19`, `bytes=90-`, `bytes=-10`, `bytes=50-999` e `bytes=-500` resultam nos intervalos da tabela da techspec; `bytes=100-`, `bytes=150-200` e `bytes=-0` resultam em `"unsatisfiable"`; `bytes=0-4,10-14`, `items=0-4`, `bytes=abc`, `bytes=20-10`, `bytes=` e `bytes=-` resultam em `undefined`. Como o helper é privado, a verificação é feita pelos testes de integração de T-05; `pnpm typecheck` passa.
Arquivos: `src/utils/static.ts`

### T-03 — Condição `If-Range` privada

Implementar `isRangeConditionMet(ifRange, { etag, lastModified })` conforme D-05. `If-Range` ausente atende. Valor iniciando com `"` ou `W/` é entity-tag: atende só com comparação forte (nenhum dos dois fraco, cadeias idênticas, ETag atual existente). Demais valores são data: atende só com `Date.parse` válido e igualdade exata com `mtimeDate` (já truncado a segundos). Não reutilizar `matchETag` (comparação fraca).

Cobre: RF-08
Depende de: nenhuma
Aceite: ETag forte igual atende; ETag diferente não atende; `W/"x"` no pedido ou no meta não atende; data igual ao `Last-Modified` atende; data diferente ou inválida não atende. A verificação por comportamento é feita nos testes de T-05 (casos de `If-Range`); `pnpm typecheck` passa.
Arquivos: `src/utils/static.ts`

### T-04 — Fatiamento do corpo: `sliceBody` e `sliceStream`

Implementar `sliceBody(body, start, end)` e `sliceStream(stream, start, endExclusive)` conforme D-06, sem mudar o contrato de `getContents`. `string` codificada em UTF-8 e fatiada por bytes; `ArrayBuffer` e views via `subarray`; `Blob` via `slice(start, end + 1)`; `ReadableStream` fatiado em fluxo (descarta até `start`, emite até `end + 1` e cancela o leitor ao terminar); `FormData` e `URLSearchParams` via `new Response(c).blob()` (caminho raro, com comentário). O corpo fatiado nunca excede o intervalo pedido.

Cobre: RF-03, RF-07
Depende de: nenhuma
Aceite: testes de integração (em T-05) com `getContents` devolvendo string, `Uint8Array`, `Blob` e `ReadableStream` retornam exatamente os bytes do intervalo nos modos `web` e `node`; corpo multibyte (UTF-8) com `size` em bytes é fatiado por byte; o stream de origem é cancelado ao fim; `pnpm lint` e `pnpm typecheck` passam.
Arquivos: `src/utils/static.ts`

### T-05 — Integração em `serveStatic`: 206, 416, 200 e HEAD

Substituir o bloco final de `serveStatic` (cálculo de `Content-Length` e retorno 200) conforme D-02, D-03, D-07 e D-08, mantendo o 304 inalterado e antes do `Range`. Considerar `size` apenas se for inteiro seguro `> 0`. Com `Range` e `If-Range` atendido: 416 grava `content-range: bytes */<size>` e `content-length: 0`, corpo `null`, sem chamar `getContents`, status "Range Not Satisfiable"; 206 grava `content-range: bytes <início>-<fim>/<size>` e `content-length` com `set` incondicional, status "Partial Content". Os cabeçalhos vão em `event.res.headers` e a resposta é `HTTPResponse` (não `HTTPError`). `HEAD` usa o mesmo cálculo e devolve `HTTPResponse(null, { status })`. `GET` fatia com `sliceBody`. Se `getContents` devolver `null`/`undefined`, manter 200 como hoje. Range ignorado resulta em 200 completo sem `Content-Range`, com o comportamento atual de `Content-Length`. Escrever os testes antes: três formas de intervalo, limite do fim, sufixo maior que o arquivo, 416, intervalos ignorados, HEAD válido e inválido, `If-Range` (ETag forte, diferente, fraco, data igual, data diferente, sem `Range`), tipos de corpo e `size` ausente ou 0.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-08
Depende de: T-01, T-02, T-03, T-04
Aceite: `pnpm vitest run test/static.test.ts` passa nos dois modos. Para o asset de 100 bytes: `bytes=10-19` dá 206, `bytes 10-19/100`, `Content-Length: 10`; `bytes=50-999` dá `bytes 50-99/100`, `Content-Length: 50`; `bytes=100-` dá 416 com `bytes */100`, `Content-Length: 0` e corpo vazio; `bytes=0-4,10-14`, `items=0-4`, `bytes=abc` e `bytes=20-10` dão 200 com corpo completo e sem `Content-Range`; `HEAD` com `bytes=0-9` dá 206 com `Content-Range: bytes 0-9/100`, `Content-Length: 10`, sem corpo; `HEAD` inválido dá 416 com os mesmos cabeçalhos do GET; `If-Range` com ETag forte igual dá 206 e com ETag diferente ou `W/` dá 200 completo; `size` ausente ou 0 dá 200.
Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-06 — Representação codificada e preservação de cabeçalhos

Cobrir com testes (sem lógica nova, conforme D-09) que: com `Accept-Encoding` selecionando variante pré-comprimida (`.gz`) e `size` da variante, o 206 usa os bytes e o tamanho da variante, mantendo `Content-Encoding` e `Vary`; um 206 mantém `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` e `Content-Encoding` iguais aos do 200 do mesmo asset; `If-None-Match` casando junto com `Range` resulta em 304; os casos 304, 404, 405 e fallthrough sem `Range` seguem como antes; o teste existente de `content-length` já definido (`test/static.test.ts:600`) passa sem alteração. Se algo falhar, ajustar `src/utils/static.ts` o mínimo necessário.

Cobre: RF-07, RF-09
Depende de: T-05
Aceite: os testes novos passam nos modos `web` e `node`; a comparação de cabeçalhos entre 206 e 200 é idêntica para os seis cabeçalhos listados; a suíte existente de `test/static.test.ts` passa sem edição dos testes antigos.
Arquivos: `test/static.test.ts`, `src/utils/static.ts`

### T-07 — Guarda de API pública e verificação final

Conferir que nenhum helper novo foi exportado: `grep "export" src/utils/static.ts` lista só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`; `src/index.ts` e `test/unit/package.test.ts` ficam sem alteração. Rodar a verificação completa. Opcional: nota curta sobre suporte a `Range` em `docs/4.examples/serve-static-assets.md`.

Cobre: RF-10
Depende de: T-06
Aceite: `git diff --stat` não mostra `src/index.ts` nem `test/unit/package.test.ts`; o snapshot de `test/unit/package.test.ts` passa; `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` passam; `pnpm test` passa.
Arquivos: `src/utils/static.ts`, `src/index.ts`, `test/unit/package.test.ts`, `docs/4.examples/serve-static-assets.md`
