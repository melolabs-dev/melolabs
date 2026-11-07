# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` e `sdd/techspec.md`. A ordem segue o §7 da techspec: primeiro os testes (que devem falhar), depois a implementação e a integração, e por fim a verificação. Os testes ficam em `test/static.test.ts`, dentro de um novo `describeMatrix("serve static range", ...)`, para rodar em `web` e `node`.

### T-01 — Testes de `Accept-Ranges` e resposta 200 sem Range

**Cobre:** RF-01, RF-09

**Depende de:** nenhuma

**Aceite:** com o novo `describeMatrix` criado e o fixture de 1000 bytes (`etag: '"v1"'`, `mtime` fixo, `getContents` como `vi.fn`), os casos de GET e HEAD sem `Range` esperam status 200 e `accept-ranges: bytes`. Os casos de 404, 405 e 304 esperam ausência de `accept-ranges`. Os casos de 200 falham antes da implementação. Os casos de 404, 405 e 304 passam antes da implementação, o que confirma que o comportamento atual é preservado.

**Arquivos:** `test/static.test.ts`

### T-02 — Testes de 206 e de HEAD com intervalo válido

**Cobre:** RF-02, RF-03, RF-09

**Depende de:** T-01

**Aceite:** os casos esperam, em GET, `bytes=0-99` com status 206, `content-range: bytes 0-99/1000`, `content-length: 100` e corpo com exatamente os bytes 0 a 99. Também cobrem `bytes=900-` (até o fim), `bytes=-100` (últimos 100 bytes), `bytes=900-5000` (limitado a 999) e `bytes=-5000` (asset inteiro, `0-999/1000`). Em HEAD, `bytes=0-99` espera 206 com os mesmos cabeçalhos, corpo vazio e `getContents` sem chamada. Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

### T-03 — Testes de 416 e de Range ignorado

**Cobre:** RF-04, RF-05, RF-09

**Depende de:** T-02

**Aceite:** `bytes=1000-` e `bytes=-0` esperam 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio e `getContents` sem chamada. O mesmo vale para HEAD. Para `bytes=0-10,20-30`, `itens=0-10`, `bytes=abc`, `bytes=-` e `bytes=5-2`, a resposta esperada é 200 com corpo completo e sem `content-range`. Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

### T-04 — Testes de `If-Range`

**Cobre:** RF-06, RF-09

**Depende de:** T-03

**Aceite:** com `etag: '"v1"'`, `If-Range: "v1"` espera 206, e `If-Range: "v0"` espera 200 completo. `If-Range: W/"v1"` (ETag fraco) espera 200. Uma data igual ao `last-modified` espera 206. Uma data diferente, ou uma data inválida, espera 200. Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

### T-05 — Testes de preservação do comportamento existente

**Cobre:** RF-07, RF-09

**Depende de:** T-04

**Aceite:** `if-none-match` que casa com o ETag responde 304 mesmo com `Range` presente, e a resposta 304 não tem `accept-ranges`. Com uma variante `.gz`, `accept-encoding: gzip` e `bytes=0-9`, o corpo é o trecho da `.gz`, com `content-encoding: gzip`, `content-length: 10` e `vary` presente. Com `fallthrough: true` e asset ausente, mais `Range`, o resultado é `undefined`. Um 405 com `Range` continua 405. Um teste novo confirma que `getMeta` e `getContents` recebem o mesmo `id` com e sem `Range`, e os testes de traversal existentes continuam passando. Os casos de 304, 405, fallthrough e `id` passam antes da implementação, e o caso de `gz` deve falhar.

**Arquivos:** `test/static.test.ts`

### T-06 — Testes de tipos de corpo, `size` ausente ou zero e `size` divergente

**Cobre:** RF-02, RF-05, RF-09

**Depende de:** T-05

**Aceite:** o recorte é testado com `Blob`, `Uint8Array`, `ReadableStream` (com chunks que cruzam `start` e `end`) e string com caracteres multibyte, em que o corpo é fatiado em bytes UTF-8. Para `ReadableStream`, um `cancel` espiado no stream de origem é chamado. Com `size` divergente do `byteLength` de um buffer, a resposta é 200 completa. Com `size` ausente ou `size: 0` e `Range` válido, a resposta é 200 completa, sem `content-range`. Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

### T-07 — Testes de precedência de cabeçalhos do usuário

**Cobre:** RF-07, RF-09

**Depende de:** T-05

**Aceite:** com `headers: { "content-length": "999", "content-range": "x" }` e um `Range` válido, a resposta 206 usa o `content-length` calculado e não exibe o `content-range` do usuário. Sem `Range`, o `content-length` do usuário continua valendo, como no teste existente de HEAD (`test/static.test.ts:600-617`), e o `content-range` do usuário não aparece. Os testes existentes de cabeçalhos (`toMatchObject` e `get`) continuam passando sem ajuste.

**Arquivos:** `test/static.test.ts`

### T-08 — Teste de exports públicos inalterados

**Cobre:** RF-08

**Depende de:** nenhuma

**Aceite:** um teste compara a lista de nomes de valor exportados por `src/index.ts` com a lista esperada, que deve ser idêntica à de antes da mudança. O teste passa antes e depois da implementação. Os tipos são conferidos por `pnpm typecheck`.

**Arquivos:** `test/static.test.ts`

### T-09 — Implementar helpers privados de Range

**Cobre:** RF-02, RF-04, RF-05, RF-06, RF-08

**Depende de:** T-06, T-07, T-08

**Aceite:** em `src/utils/static.ts`, depois de `idSearchPaths`, existem `parseRange`, `resolveRange`, `ifRangeMatches` e `sliceBody`, sem `export`, com tipos anotados e helpers no fim do arquivo, como o `AGENTS.md` pede. `resolveRange` segue a tabela da techspec §4 (`bytes=0-99` e size 1000 dá `{ start: 0, end: 99 }`, `bytes=-0` e `bytes=1000-` dão `"unsatisfiable"`, e as sintaxes inválidas dão `undefined`). `ifRangeMatches` faz comparação forte de ETag, rejeita ETag fraco (`W/` ou `w/`, sem diferenciar maiúsculas) e exige igualdade exata de data. `sliceBody` fatia `Blob`, buffers, `ReadableStream` (cancelando o original) e outros tipos por bytes. Os testes unitários dos helpers passam, se forem criados, e a suíte de T-02 a T-07 deixa de falhar nos pontos cobertos pelos helpers.

**Arquivos:** `src/utils/static.ts`

### T-10 — Integrar o Range no fluxo de `serveStatic`

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** T-09

**Aceite:** o ponto de inserção segue a decisão D-01 da techspec, entre o bloco de `content-length` e o ramo de HEAD. `accept-ranges: bytes` é escrito só se ausente, logo depois do bloco do 304. O Range só é avaliado com `meta.size` finito e maior que zero, e com `If-Range` válido ou ausente. Em 206 e 416, `content-length` e `content-range` são escritos com `headers.set` em `event.res.headers`. Em 416, `content-encoding` é removido. Em 200 com Range ignorado, `content-range` do usuário é removido. O `id` usado em `getMeta` e `getContents` não muda. O JSDoc de `serveStatic` documenta o custo de I/O de ler o arquivo desde o início (R-01). Todos os testes de T-01 a T-08 passam nos dois runtimes.

**Arquivos:** `src/utils/static.ts`

### T-11 — Verificação final e revisão de exports

**Cobre:** RF-08, RF-09

**Depende de:** T-10

**Aceite:** `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` passam, em `web` e `node`. `git diff src/index.ts` está vazio. `git diff` não toca `src/utils/internal/cache.ts`, `src/response.ts` nem outros utilitários. O tamanho de `src/utils/static.ts` é registrado no relatório (R-07 da techspec aceita que passe de 200 linhas).

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`, `src/index.ts` (apenas verificação, sem alteração)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-10 |
| RF-02 | T-02, T-06, T-09, T-10 |
| RF-03 | T-02, T-10 |
| RF-04 | T-03, T-09, T-10 |
| RF-05 | T-03, T-06, T-09, T-10 |
| RF-06 | T-04, T-09, T-10 |
| RF-07 | T-05, T-07, T-10 |
| RF-08 | T-08, T-09, T-11 |
| RF-09 | T-01 a T-08, T-11 |
