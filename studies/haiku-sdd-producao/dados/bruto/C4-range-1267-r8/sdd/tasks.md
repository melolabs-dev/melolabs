# Tarefas de implementação: HTTP Range em `serveStatic` (h3js/h3#1267)

Referências: `sdd/prd.md` (RF-01 a RF-14) e `sdd/techspec.md` (D-01 a D-11).

Ordem sugerida: testes primeiro (T-01 a T-04), depois implementação (T-05 a T-08), depois medição e verificação final (T-09 e T-10). Conforme `AGENTS.md`, os testes de 206 devem falhar na base atual antes da implementação.

---

### T-01 — Testes de intervalo básico: cabeçalhos, 206, HEAD, 416 e limites

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-09, RF-10

Depende de: nenhuma

Aceite: novo bloco `describeMatrix("serve static with Range", ...)` em `test/static.test.ts`, com `getMeta` e `getContents` controlados. Cobre: 200 sem Range com `accept-ranges: bytes`; `bytes=0-99` em arquivo de 1000 bytes (206, 100 bytes exatos); `bytes=100-199` (`content-range: bytes 100-199/1000`); `bytes=0-0`; `bytes=0-` e `bytes=-N`; HEAD com `bytes=0-9` (206, corpo vazio); `bytes=1000-1100` (416, `content-range: bytes */1000`, `content-length: 0`, `getContents` não chamado via `vi.fn`); `bytes=-0` (416); `bytes=900-5000` (`900-999/1000`, length 100); `bytes=-5000` (`0-999/1000`, length 1000); `bytes=999-999`; `getMeta` sem `size` e com `size: 0` (200 completo, sem `content-range`); arquivo de 1 byte com `bytes=0-0` e `bytes=0-`. Nos testes de 206 e 416, a suíte deve falhar na base atual. Os testes existentes continuam verdes.

Arquivos: `test/static.test.ts`

---

### T-02 — Testes de Range inválido e de If-Range

Cobre: RF-06, RF-07

Depende de: nenhuma

Aceite: em `test/static.test.ts`, dentro do bloco de T-01 ou em bloco irmão em `describeMatrix`. Cobre: `bytes=0-1,5-9`, `items=0-9`, `bytes=5-2`, `bytes=-` e `bytes=abc` (200 completo, sem `content-range`); If-Range com ETag forte igual (206); If-Range com ETag diferente (200 completo); `W/"abc"` em `meta.etag` com If-Range `W/"abc"` (200); If-Range com data igual ao `Last-Modified` (206); If-Range com data diferente (200 completo). Os casos de 206 devem falhar na base atual.

Arquivos: `test/static.test.ts`

---

### T-03 — Testes de precedência de cache, variante pré-comprimida e compatibilidade

Cobre: RF-08, RF-11, RF-12

Depende de: nenhuma

Aceite: em `test/static.test.ts`. Cobre: `if-none-match: "abc"` com `Range: bytes=0-9` (304, sem corpo, sem `accept-ranges`); `app.js` com `app.js.gz` de 300 bytes, `encodings: { gzip: ".gz" }`, `accept-encoding: gzip` e `bytes=0-9` (206, `content-encoding: gzip`, `content-range: bytes 0-9/300`, `content-length: 10`); 404 com `fallthrough: false` sem Range (continua 404); POST com `fallthrough: true` (retorna `undefined`); `options.headers` com `content-length: 999` em HEAD 200 continua valendo 999 (D-05, teste existente em `test/static.test.ts:600-616` sem alteração), e em 206 com a mesma configuração o valor passa a ser o do trecho. Os testes existentes em `test/static.test.ts:396` e os asserts de `toMatchObject` não são alterados.

Arquivos: `test/static.test.ts`

---

### T-04 — Testes de tipos de corpo do trecho

Cobre: RF-02

Depende de: nenhuma

Aceite: em `test/static.test.ts`, a mesma requisição `bytes=2-5` com `getContents` retornando cada um destes tipos produz o mesmo corpo de 4 bytes: `string` com caracteres multibyte UTF-8 (por exemplo `"é"` com `size` em bytes), `Blob`, `ArrayBuffer`, `Uint8Array` com `byteOffset` diferente de zero e `ReadableStream`. No caso de `ReadableStream`, o teste confirma que a stream foi cancelada após o trecho. Os testes devem falhar na base atual.

Arquivos: `test/static.test.ts`

---

### T-05 — Helpers privados de parsing: `parseRange` e `matchesIfRange`

Cobre: RF-06, RF-07, RF-09, RF-13

Depende de: T-01, T-02

Aceite: `parseRange(value, size)` e `matchesIfRange(value, validators)` são funções não exportadas no fim de `src/utils/static.ts` (D-01). O parser aceita só `^bytes=(\d*)-(\d*)$` após `trim()`, com exatamente um lado preenchido e `start <= end` quando ambos existem. Retorna `"unsatisfiable"` quando `start >= size` ou sufixo `0`, e aplica os limites de RF-09 (D-06). `matchesIfRange` segue D-07: `W/` ou `"` indica ETag; ETag fraca nunca casa; data casa por igualdade de `getTime()` com `mtimeDate`. Os testes de T-01 e T-02 para esses casos passam a verde. Em `src/index.ts`, `git diff` mostra nenhuma linha alterada (RF-13).

Arquivos: `src/utils/static.ts`

---

### T-06 — `resolveRange` e `Accept-Ranges` dentro de `serveStatic`

Cobre: RF-01, RF-07, RF-08, RF-10, RF-12

Depende de: T-03, T-05

Aceite: `Accept-Ranges: bytes` é definido após o bloco de 304, com `if (!event.res.headers.has("accept-ranges"))` (D-02). `resolveRange` é chamado depois de `Content-Type` e `Content-Encoding` e antes do bloco de `Content-Length` (D-03). Sem `size` positivo, o `Range` é ignorado (RF-10). Os testes de T-01, T-02 e T-03 que dependem só de 200, 304 e de decisão de Range passam. Os testes de `test/static.test.ts` e `test/security.test.ts` que já existiam continuam verdes. Respostas 404 e 405 não ganham `accept-ranges`.

Arquivos: `src/utils/static.ts`

---

### T-07 — Respostas 206 e 416 como `HTTPResponse` com cabeçalhos corretos

Cobre: RF-02, RF-03, RF-04, RF-05, RF-09

Depende de: T-06

Aceite: 206 define `content-range: bytes s-e/size` e `content-length: e-s+1` com `set` incondicional (D-05). 416 é retornado como `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `content-range: bytes */size` e `content-length: 0`, sem chamar `getContents` (D-04). HEAD com Range válido retorna 206 com corpo `null`, sem chamar `getContents` (D-11). Os testes de T-01 e de D-05 em T-03 passam. O teste em `test/static.test.ts:600-616` continua verde sem alteração.

Arquivos: `src/utils/static.ts`

---

### T-08 — Fatiamento do corpo por tipo de `BodyInit` (`sliceBody`)

Cobre: RF-02

Depende de: T-04, T-07

Aceite: `sliceBody(contents, start, end)` é privada e segue a tabela de D-08. `string` é codificada com `TextEncoder` e recortada com `subarray` por bytes. `ArrayBuffer` e `ArrayBufferView` usam `new Uint8Array(buf, byteOffset, byteLength).subarray(...)`. `Blob` usa `slice`. `ReadableStream` e os demais tipos passam por `new Response(contents).body`, descartam `start` bytes, emitem até `end + 1` e cancelam o reader. Os cinco casos de T-04 produzem o mesmo corpo, e a stream é cancelada. A suíte completa de `test/static.test.ts` passa.

Arquivos: `src/utils/static.ts`

---

### T-09 — Medição manual de memória com arquivo grande

Cobre: RF-02, RF-14

Depende de: T-08

Aceite: gerar um arquivo de cerca de 1 GB e medir RSS antes e depois de requisições `bytes=0-99` e `bytes=900000000-900000099`, nos caminhos `Blob` e `ReadableStream`, em Node e, se disponível, Bun. Se `Blob.slice` não for lazy em algum runtime, registrar isso e avaliar o caminho de stream (techspec, riscos). O resultado (números de RSS e runtime usado) entra na descrição do PR. Esta etapa fica fora da suíte, como verificação manual, e é pré-requisito para o merge (risco alto do PRD).

Arquivos: nenhum arquivo do repositório (medição local, script fora da árvore ou em `sdd/`, conforme decidido na execução)

---

### T-10 — Verificação final: suíte, lint, typecheck e escopo da mudança

Cobre: RF-13, RF-14

Depende de: T-09

Aceite: `pnpm vitest run test/static.test.ts test/security.test.ts` passa (linha de base de 271 testes mais os novos). `pnpm vitest run` completo passa, incluindo `test/unit/package.test.ts`. `pnpm lint` e `pnpm typecheck` terminam sem erro. `git diff --stat` mostra alterações só em `src/utils/static.ts` e `test/static.test.ts` (mais `sdd/` se aplicável). `src/index.ts`, `ServeStaticOptions` e `StaticAssetMeta` não mudam (D-10).

Arquivos: `src/utils/static.ts`, `test/static.test.ts`
