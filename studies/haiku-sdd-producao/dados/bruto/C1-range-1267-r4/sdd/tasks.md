# Tarefas de implementação — HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-11), `sdd/techspec.md` (D-01 a D-09), issue h3js/h3#1267.

Ordem geral, conforme o `AGENTS.md` (Bug Fix Workflow adaptado): primeiro os testes, confirmando que falham contra o código atual; depois a implementação mínima; por fim a regressão.

Cobertura dos requisitos:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-06 |
| RF-02 | T-02, T-07, T-09, T-10 |
| RF-03 | T-02, T-07, T-10 |
| RF-04 | T-02, T-07 |
| RF-05 | T-02, T-07, T-10 |
| RF-06 | T-02, T-07 |
| RF-07 | T-03, T-08 |
| RF-08 | T-01, T-06 |
| RF-09 | T-04, T-08 |
| RF-10 | T-04, T-08 |
| RF-11 | T-01, T-11 |

---

### T-01 — Criar a suíte de Range e os testes de anúncio, precedência de 304 e erros
Cobre: RF-01, RF-08, RF-11
Depende de: nenhuma
Aceite:
- Existe `test/static-range.test.ts` usando `describeMatrix` (`test/_setup.ts:11`), com a fixture base: asset de 10 bytes `0123456789`, ETag forte `"v1"`, mtime fixo, `type: "text/plain"`, rota `t.app.all("/range/**", ...)` com `getMeta` e `getContents` controlados.
- Testes de RF-01 (GET sem Range: 200, `accept-ranges: bytes`, corpo completo) e de RF-08 (`If-None-Match: "v1"` com `Range: bytes=0-3` devolve 304 sem corpo). RF-01 deve **falhar** hoje (falta `accept-ranges`); RF-08 e RF-11 devem **passar** hoje, por serem comportamento preservado.
- Testes de RF-11: caminho inexistente com Range dá 404 (e `undefined` com `fallthrough`); POST com Range dá 405 com `allow: GET, HEAD`.
- Executar `pnpm vitest run test/static-range.test.ts` e registrar a saída antes de seguir para a implementação.

Arquivos: `test/static-range.test.ts` (novo)

---

### T-02 — Testes de intervalo: 206, HEAD, parser estrito e 416
Cobre: RF-02, RF-03, RF-04, RF-05, RF-06
Depende de: T-01
Aceite:
- Casos de `sdd/techspec.md` (tabela de testes) incluídos no arquivo de T-01:
  - `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345` (RF-02);
  - `bytes=7-` e `bytes=0-99` → fim reduzido ao último byte (RF-02);
  - HEAD com `bytes=0-3` → 206, mesmos cabeçalhos do GET, corpo vazio (RF-03);
  - `bytes=0-1,4-5`, `items=0-1`, `bytes=5-2`, `bytes=abc`, `bytes=-` → 200 completo, sem `content-range`, com `accept-ranges` (RF-04);
  - `bytes=10-20` e `bytes=-0` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, e `getContents` não chamado (RF-05);
  - `bytes=-3` → 206, `bytes 7-9/10`, corpo `789`; `bytes=-50` → 206, `bytes 0-9/10`, corpo completo (RF-06).
- Com a implementação ainda ausente, os casos 206, HEAD, 416 e sufixo falham; os casos de RF-04 podem passar só se o 200 completo já for o comportamento atual (confirmar e registrar).

Arquivos: `test/static-range.test.ts`

---

### T-03 — Testes de If-Range
Cobre: RF-07
Depende de: T-01
Aceite:
- `If-Range: "v2"` com `Range: bytes=0-3` → 200 completo; o mesmo Range com `If-Range: "v1"` → 206 `bytes 0-3/10` (RF-07).
- `If-Range` com data igual ao `last-modified` do asset → 206; data diferente → 200 completo; a comparação é em segundos (o `last-modified` é truncado, conforme `sdd/prd.md`, Riscos).
- `If-Range: W/"v1"` (ETag fraco na forma canônica) → nunca casa, 200 completo.
- Os testes falham hoje (o Range é sempre aplicado ou ignorado sem avaliar `If-Range`), e a falha deve ser registrada.

Arquivos: `test/static-range.test.ts`

---

### T-04 — Testes de asset sem tamanho e de representação codificada
Cobre: RF-09, RF-10
Depende de: T-01
Aceite:
- `getMeta` sem `size` e com `size: 0` + `Range: bytes=0-3` → 200 completo, sem `content-range` (RF-09).
- Asset pré-comprimido com `gzip` selecionado por `accept-encoding` + `Range: bytes=0-3` → 200, `content-encoding: gzip`, corpo completo (RF-10).
- Variante sem `meta.encoding` escolhida por `accept-encoding` (id diferente de `assetId`) + Range → 200 completo, sem 206 (D-05 do techspec).
- Registrar quais casos já passam hoje (o Range ainda não é avaliado) e quais falham.

Arquivos: `test/static-range.test.ts`

---

### T-05 — Testes de corpo por tipo, early termination e Content-Length
Cobre: RF-02, RF-03
Depende de: T-01
Aceite:
- `it.each` sobre o tipo de `getContents` com Range `bytes=…` cobrindo: `string` com caracteres não ASCII (ex.: `"é"` seguido de ASCII, para provar offset em bytes), `ArrayBuffer`, `Uint8Array`, `Blob`, e `ReadableStream` com chunks de 1 byte e com um chunk que cruza início e fim do intervalo (D-06).
- Teste de early termination: `ReadableStream` de 1000 chunks de 1 byte, `pull` contando leituras e `cancel` marcando cancelamento; com `bytes=0-1`, a origem é cancelada e menos de 1000 chunks são lidos (`sdd/techspec.md`, estratégia de testes).
- Teste de D-07: `options.headers` com `content-length: 999` e GET com `bytes=0-3` → 206 com `content-length: 4`; o teste existente de HEAD 200 em `test/static.test.ts:600` continua com 999.
- Teste de D-09: `getMeta` presente e `getContents` devolvendo `null` após decisão de 206 → 404 (ou `undefined` com `fallthrough`), nunca 206 vazio.

Arquivos: `test/static-range.test.ts`

---

### T-06 — Anunciar `Accept-Ranges` e manter a precedência do 304
Cobre: RF-01, RF-08
Depende de: T-01
Aceite:
- Em `src/utils/static.ts`, `event.res.headers.set("accept-ranges", "bytes")` entra depois do `etag` e antes do bloco de 304 (D-02, `src/utils/static.ts:241`).
- RF-01 e os demais testes de T-01 passam; o 304 com Range continua sem corpo (RF-08).
- Nenhum símbolo novo é exportado.

Arquivos: `src/utils/static.ts`

---

### T-07 — Parser de Range, satisfazibilidade e respostas 206/416/HEAD
Cobre: RF-02, RF-03, RF-04, RF-05, RF-06
Depende de: T-02
Aceite:
- Helper privado `parseByteRange(header, size)` no fim de `src/utils/static.ts`, abaixo de `// --- Internal Utils ---`, com a regex `^bytes=(\d*)-(\d*)$` (após `trim()`, flag `i` na unidade), retornando `undefined`, `{ unsatisfiable: true }` ou `{ start, end }` (D-03).
- Regras: início ≥ tamanho → 416; sufixo `-0` → 416; sufixo maior que o arquivo → `0..tamanho-1`; fim ≥ tamanho → reduzido; `início-` → até o fim.
- Decisão de Range inserida após `content-length` padrão (`src/utils/static.ts:270`), antes de `getContents`. 206 com `content-range` e `content-length` em `event.res.headers`; 416 sem chamar `getContents`; HEAD 206 com corpo `null` (D-08).
- Todos os testes de T-02 passam; `test/static.test.ts` segue passando.

Arquivos: `src/utils/static.ts`

---

### T-08 — Avaliação de If-Range e critérios de ignorar Range
Cobre: RF-07, RF-09, RF-10
Depende de: T-03, T-04, T-07
Aceite:
- Helper privado `isIfRangeMatch(ifRange, { etag, lastModified })`: ETag forte com igualdade exata (fraco nunca casa, detectado por `W/` como em `src/utils/internal/cache.ts:52`); data com igualdade exata a `mtimeDate` em segundos; valor inválido não casa (D-04).
- Range é ignorado (200 completo) quando: `meta.size` ausente ou 0 (RF-09); `event.res.headers` tem `content-encoding` (RF-10); `id !== assetId` (D-05); `If-Range` presente e não casa (RF-07).
- Todos os testes de T-03 e T-04 passam.

Arquivos: `src/utils/static.ts`

---

### T-09 — Recorte do corpo por tipo de `BodyInit`
Cobre: RF-02, RF-03
Depende de: T-05, T-07
Aceite:
- Helpers privados `sliceContents(contents, range)` e `sliceStream(body, range)` (D-06): stream com `TransformStream` que descarta o prefixo e chama `controller.terminate()` ao passar de `range.end`; demais tipos via `await new Response(contents).blob()` e `blob.slice(start, end + 1)`.
- Testes de tipo e de early termination de T-05 passam; o caso de `string` não ASCII prova o offset em bytes.
- Registrar em comentário ou na descrição do PR que o prefixo de stream ainda é lido do backend (risco 1 do techspec).

Arquivos: `src/utils/static.ts`

---

### T-10 — Content-Length em 206/416 e getContents vazio em resposta parcial
Cobre: RF-02, RF-05
Depende de: T-07, T-09
Aceite:
- 206 sobrescreve `content-length` com o tamanho do recorte, e 416 define `"0"`, mesmo quando `options.headers` trouxe um valor (D-07). Em 200 o valor explícito continua valendo.
- `getContents` devolvendo vazio depois da decisão 206 → 404 com `throw new HTTPError({ statusCode: 404 })`, ou `undefined` com `fallthrough` (D-09).
- Os testes de T-05 (D-07, D-09) e os casos de 416 de T-02 passam.

Arquivos: `src/utils/static.ts`

---

### T-11 — Regressão, lint, typecheck e snapshot de exports
Cobre: RF-11
Depende de: T-06, T-08, T-10
Aceite:
- `pnpm vitest run test/static-range.test.ts` passa por completo.
- `pnpm vitest run test/static.test.ts` passa. Se algum teste falhar só por `accept-ranges` extra ou por status de HEAD com Range, ajustar apenas esse teste, sem remover o que ele verifica (`sdd/techspec.md`, `test/static.test.ts`).
- `pnpm vitest run test/security.test.ts test/unit/package.test.ts` passa, e o snapshot de exports não muda (nenhuma exportação nova).
- `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` passam.
- `pnpm test` (suíte completa com coverage) passa.
- Caminhos de 404, 405 e fallthrough (RF-11) seguem verdes.
- Se `src/utils/static.ts` passar de 200 linhas, registrar no PR a meta do `AGENTS.md` como pendência (techspec, risco 6), sem dividir o arquivo nesta entrega.

Arquivos: `test/static.test.ts` (somente se necessário), `src/utils/static.ts` (somente se o lint pedir ajuste)
