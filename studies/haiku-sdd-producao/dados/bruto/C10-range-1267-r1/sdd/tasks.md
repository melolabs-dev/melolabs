# Tarefas: HTTP Range em `serveStatic`

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-09, §3 e §5).

Ordem de trabalho: os testes (T-01 a T-06) são escritos e confirmados falhando nos casos de 206/416 antes da implementação (T-07 a T-09), como manda o `AGENTS.md` (bug-fix workflow adaptado).

Observação de edição: T-02 a T-06 editam o mesmo arquivo de teste (`test/static-range.test.ts`), cada uma com seu próprio bloco `describeMatrix`. Execute-as em sequência para evitar conflito de edição. T-07 e T-08 editam o mesmo arquivo de código, então também seguem em sequência.

---

### T-01 — Criar arquivo de testes com fixture comum e cobrir não-regressão

**Cobre:** RF-10, RF-11

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/static-range.test.ts` passa nos modos `web` e `node` para os casos de regressão: POST em asset existente com `Range` responde 405 com `Allow: GET, HEAD`; GET em asset inexistente com `Range` responde 404; com `fallthrough: true` retorna `undefined`; nenhuma dessas respostas traz `Content-Range` nem `Accept-Ranges`. O arquivo define a fixture de §5 (`/file.bin`, 1000 bytes, `byte[i] = i % 256`, `etag: '"abc"'`, `mtime: 1_700_000_000_000`) e o `getContents` como `vi.fn`. `pnpm vitest run test/unit/package.test.ts` passa sem edição, o que prova RF-11.

**Arquivos:** `test/static-range.test.ts` (novo)

---

### T-02 — Cobrir anúncio de `Accept-Ranges` e ignorar `Range` inaplicável

**Cobre:** RF-01, RF-02

**Depende de:** T-01

**Aceite:** Nos modos `web` e `node`, os casos a seguir estão escritos e, antes de T-09, falham só onde o cabeçalho `accept-ranges` é exigido. Casos: GET sem `Range` responde 200 com `accept-ranges: bytes`, sem `content-range` e com corpo de 1000 bytes. `bytes=5-2`, `items=0-9`, `bytes=0-1,3-4`, `bytes=abc` e asset com `getMeta` sem `size` respondem 200 com corpo completo, `content-length: 1000` e sem `content-range`. Caso `options.headers` com `accept-ranges` definido pelo usuário: o valor do usuário é preservado (D-07).

**Arquivos:** `test/static-range.test.ts`

---

### T-03 — Cobrir 206 em GET e 416 com intervalos abertos, sufixos e override de `Content-Length`

**Cobre:** RF-03, RF-04, RF-05

**Depende de:** T-01

**Aceite:** Nos modos `web` e `node`, os casos a seguir estão escritos e falham antes de T-09. `bytes=100-199` responde 206 com `content-range: bytes 100-199/1000`, `content-length: 100` e corpo igual aos bytes 100 a 199. `bytes=-50`, `bytes=900-` e `bytes=500-5000` respondem 206 com `bytes 950-999/1000`, `900-999/1000` e `500-999/1000`, nessa ordem. `bytes=-5000` responde 206 com `bytes 0-999/1000`. `bytes=1000-1100`, `bytes=-0` e `bytes=0-0` em asset de `size: 0` respondem 416 com `content-range: bytes */<tamanho>`, `content-length: 0` e corpo vazio. Caso `options.headers: { "content-length": "999" }` com `bytes=0-9` responde 206 com `content-length: 10` (P4). Caso `getContents` chamado uma vez em 206 (`toHaveBeenCalledTimes(1)`).

**Arquivos:** `test/static-range.test.ts`

---

### T-04 — Cobrir HEAD com `Range`

**Cobre:** RF-06

**Depende de:** T-01

**Aceite:** Nos modos `web` e `node`, HEAD com `bytes=100-199` responde 206 com `content-range: bytes 100-199/1000` e `content-length: 100`, sem corpo, e `expect(getContents).not.toHaveBeenCalled()`. HEAD com `bytes=1000-1100` responde 416 com `content-range: bytes */1000`, sem corpo e sem chamar `getContents`.

**Arquivos:** `test/static-range.test.ts`

---

### T-05 — Cobrir `If-Range` e precedência do 304 sobre `Range`

**Cobre:** RF-07, RF-08

**Depende de:** T-01

**Aceite:** Nos modos `web` e `node`, os casos a seguir estão escritos. `If-Range: "xyz"` com `bytes=0-9` responde 200 completo sem `content-range`. `If-Range: "abc"` responde 206 com `bytes 0-9/1000`. `If-Range: W/"abc"` responde 200. `If-Range` com data igual a `Last-Modified` responde 206. `If-Range` com data diferente responde 200. `If-None-Match: "abc"` com `bytes=0-9` responde 304, sem `content-range` e com corpo vazio. Ao menos um caso de `If-Range` com `If-Range` inválido e `bytes=1000-1100` responde 200, não 416 (D-03).

**Arquivos:** `test/static-range.test.ts`

---

### T-06 — Cobrir variante pré-comprimida, corpo por tipo e `getContents` nulo

**Cobre:** RF-09, RF-12

**Depende de:** T-01

**Aceite:** Nos modos `web` e `node`, com `encodings: { br: ".br" }`, `app.js.br` de 500 bytes, `Accept-Encoding: br` e `bytes=0-9`, a resposta é 206 com `content-encoding: br`, `content-range: bytes 0-9/500` e `content-length: 10`. Para `getContents` que devolve `ReadableStream` de 1000 bytes, `Blob`, `ArrayBuffer`, string ASCII e `Uint8Array`, `bytes=100-199` devolve corpo de 100 bytes iguais a 100..199. Caso de stream em que o intervalo termina no meio de um chunk, com fronteiras de início e fim corretas. Caso `getContents` devolvendo `null` com `bytes=0-9` responde 200 com corpo vazio e sem `content-range` (D-08).

**Arquivos:** `test/static-range.test.ts`

---

### T-07 — Implementar parser de `Range`, `If-Range` e resolução de intervalo

**Cobre:** RF-02, RF-04, RF-05, RF-07, RF-11

**Depende de:** nenhuma

**Aceite:** Em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (no fim do arquivo), existem `parseByteRange`, `ifRangeMatches` e `resolveRange` conforme techspec §3.2 e D-02, D-06. Nada é exportado. `pnpm typecheck` e `pnpm lint` passam. `pnpm vitest run test/unit/package.test.ts` passa sem edição. Os casos de T-02, T-03 e T-05 que dependem só dessa lógica passam depois de T-09. Regex `/^bytes=(\d*)-(\d*)$/i` aplicada ao valor com `trim()`, sem usar `matchETag`.

**Arquivos:** `src/utils/static.ts`

---

### T-08 — Implementar gravação de headers de range e fatiamento do corpo

**Cobre:** RF-03, RF-11, RF-12

**Depende de:** T-07

**Aceite:** Em `src/utils/static.ts`, no fim do arquivo, existem `setRangeHeaders`, `sliceBody` e `sliceStream` conforme techspec §3.3 e D-04, D-05. Headers são gravados com `event.res.headers.set` sem `has`/`get` antes. `sliceBody` usa `Blob.slice` para string, `Blob`, `ArrayBuffer` e views, `sliceStream` para `ReadableStream` e para os demais `BodyInit`, e `sliceStream` cancela a origem ao terminar. Nada é exportado. `pnpm typecheck` e `pnpm lint` passam. Após T-09, os casos de corpo de T-03 e T-06 passam.

**Arquivos:** `src/utils/static.ts`

---

### T-09 — Integrar Range e `Accept-Ranges` em `serveStatic`

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-12

**Depende de:** T-02, T-03, T-04, T-05, T-06, T-07, T-08

**Aceite:** Inserção 1 de techspec §3.1 (`accept-ranges`, só se ausente) está depois do bloco de `etag` e antes da validação de 304. Bloco de §3.1 substitui o HEAD e o GET finais, nessa ordem: 416, 206 (HEAD ou GET), 200 sem corpo quando `getContents` é nulo (D-08), depois o caminho atual. `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`. `pnpm vitest run test/static.test.ts test/security.test.ts test/rules/cache.test.ts test/unit/package.test.ts` passa sem edição desses arquivos. Antes da mudança, os casos de 206/416 de T-02 a T-06 falham (confirmar em registro de execução).

**Arquivos:** `src/utils/static.ts`

---

### T-10 — Registrar mudança de comportamento no changelog

**Cobre:** RF-01, RF-03 (documenta riscos R2 e R4 do PRD)

**Depende de:** nenhuma

**Aceite:** `CHANGELOG.md` tem entrada nova que diz: `serveStatic` suporta `Range` de intervalo único em GET e HEAD, com 206 e 416 e `Accept-Ranges: bytes`. Nota de R2: cliente que enviava `Range` válido e recebia 200 passa a receber 206. Nota de R4: `Content-Length` definido em `options.headers` é sobreposto em 206. Nota de que `size` de `getMeta` deve ser em bytes (R-05). Nenhuma outra linha do changelog é alterada.

**Arquivos:** `CHANGELOG.md`

---

### T-11 — Verificação final da entrega

**Cobre:** RF-13, RF-11

**Depende de:** T-09, T-10

**Aceite:** `pnpm lint` e `pnpm typecheck` passam sem erro. `pnpm test` (lint, typecheck e cobertura) passa. `test/static-range.test.ts` cobre RF-01 a RF-12 e roda em `web` e `node`. `test/static.test.ts`, `test/rules/cache.test.ts`, `test/security.test.ts` e `test/unit/package.test.ts` não têm edição no diff. Diff de `src/index.ts` e dos entry points está vazio (RF-11). Diff de `src/utils/static.ts` não altera `ServeStaticOptions` nem `StaticAssetMeta`.

**Arquivos:** nenhum arquivo novo; verificação de `test/static-range.test.ts`, `src/utils/static.ts`, `src/index.ts`, `CHANGELOG.md`

---

## Fora desta lista

- Mover os helpers de `src/utils/static.ts` para `src/utils/internal/range.ts` (techspec R-06). Só quando o requisito de escopo de RF-11 puder ser revisto. Não é requisito do PRD.
