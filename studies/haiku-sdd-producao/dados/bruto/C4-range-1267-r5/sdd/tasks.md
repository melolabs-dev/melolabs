# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/prd.md` (RF-01 a RF-12), `sdd/techspec.md` (D-01 a D-10).

Ordem de trabalho: primeiro os testes, que devem **falhar** antes de qualquer mudança em `src/` (Bug Fix Workflow do `AGENTS.md`). Depois a implementação, em camadas. Por fim a verificação final.

## Decisões a confirmar antes da T-07

A techspec (seção 7) deixa três decisões em aberto. As tarefas abaixo implementam o default da techspec. Se o time escolher outra opção, T-03 e T-08 mudam.

1. **D-05 / R7 (RF-09):** Range sobre variante comprimida é ignorado (`200` completo).
2. **D-09 / R5 (RF-08):** `size: 0` mantém `200`, sem `Content-Length` e sem `Range`. Desvio da RFC 9110, que pediria `416`.
3. **D-08 / R-04 (RF-01):** `Accept-Ranges: bytes` é anunciado mesmo sem `size`.

---

### T-01 — Fixture e esqueleto do bloco de testes de Range

Criar em `test/static.test.ts` um `describeMatrix` próprio para Range, com rota `/range/**` registrada dentro do teste, no mesmo padrão de `/clen/**`. O fixture não usa o `beforeEach` existente, porque ele define `encoding: "utf8"` (D-10, R-01). Fixture: corpo ASCII de 1000 bytes, `size: 1000`, `etag: '"abc"'`, `mtime` fixo sem milissegundos, sem `encoding`. Incluir o caso RF-01: GET e HEAD sem `Range` devolvem `200`, `accept-ranges: bytes` e corpo completo. Esse caso deve falhar antes da implementação, pois o header ainda não existe.

**Cobre:** RF-01, RF-12
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static.test.ts -t "range"` roda nos modos `web` e `node`. O teste de `accept-ranges` falha no código atual. Os testes existentes continuam passando sem alteração.
**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes de intervalo válido (206) e não satisfazível (416)

Adicionar os casos de RF-02, RF-03 e RF-04 ao bloco de T-01:
- GET `bytes=100-199` → `206`, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo exato dos bytes 100 a 199;
- GET `bytes=-200` → `206`, `bytes 800-999/1000`, `content-length: 200`;
- GET `bytes=900-5000` → `206`, `bytes 900-999/1000`, `content-length: 100`;
- GET `bytes=-0` e `bytes=1000-1100` → `416`, `content-range: bytes */1000`, `content-length: 0`;
- HEAD `bytes=100-199` → `206`, mesmos headers, corpo vazio;
- HEAD `bytes=1000-` → `416`, `content-range: bytes */1000`, sem corpo.

Todos devem falhar antes da implementação (status atual é `200`).

**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-01
**Aceite:** os casos existem e falham no código atual pelo `status` ou pelo `content-range`, nos dois modos.
**Arquivos:** `test/static.test.ts`

---

### T-03 — Testes de Range ignorado (200 completo)

Adicionar os casos em que o Range é ignorado:
- RF-05: `bytes=0-1,5-9` (múltiplos intervalos), `items=0-9` (unidade diferente), `bytes=abc` (malformado), `bytes=5-2` (início maior que fim), `bytes=-` (sem números). Todos devem responder `200`, sem `content-range`, com corpo completo, e nunca `416`.
- RF-08: `getMeta` sem `size` e `size: 0` (D-09). Ambos respondem `200` completo, sem `content-range`.
- RF-09: asset com `encodings: { gzip: ".gz" }`, `accept-encoding: gzip` e `Range: bytes=0-9`. Resposta `200`, `content-encoding: gzip`, corpo comprimido completo.

Esses casos já passam no código atual, porque o `serveStatic` ignora `Range`. Servem de guarda: a implementação não pode devolver `416` nem `206` neles. Os asserts devem verificar `status` e `content-range` explicitamente.

**Cobre:** RF-05, RF-08, RF-09
**Depende de:** T-01
**Aceite:** todos os casos passam no código atual (são o comportamento antigo que a feature preserva) e continuam passando depois da implementação. Cada um tem assert de `content-range` ausente.
**Arquivos:** `test/static.test.ts`

---

### T-04 — Testes de If-Range

Adicionar os casos de RF-06, com o asset de T-01 (`etag: '"abc"'`, `mtime` fixo):
- `If-Range: "abc"` com Range válido → `206`;
- `If-Range: "outro"` → `200` completo, sem `content-range`;
- `If-Range: W/"abc"` (ETag fraco no cabeçalho) → `200`;
- `If-Range` com a data HTTP igual ao `mtime` → `206`;
- `If-Range` com data diferente → `200`;
- asset sem `etag` e sem `mtime` com qualquer `If-Range` → `200` (P2).

Cobrir R2: a data é comparada em segundos, sem milissegundos.

**Cobre:** RF-06
**Depende de:** T-01
**Aceite:** os casos de `206` falham no código atual. Os de `200` passam. Todos passam após T-07 e T-08.
**Arquivos:** `test/static.test.ts`

---

### T-05 — Testes de precedência (304, 404, 405) e headers preservados (206)

Adicionar:
- RF-07: `If-None-Match` com match + `Range: bytes=0-9` → `304`; asset inexistente + Range → `404` (ou fallthrough, se `fallthrough` ativo); POST + Range → `405` inalterado.
- RF-10: asset com `etag`, `mtime`, `type` e `options.headers` com `cache-control`. Em `206`, `content-type`, `etag`, `last-modified` e `cache-control` são iguais aos da resposta `200` do mesmo asset. Se o asset tiver `encodings`, `vary` também deve estar presente.

Os casos de RF-07 passam hoje e devem continuar passando. Os de RF-10 falham antes da implementação, pois não há `206`.

**Cobre:** RF-07, RF-10
**Depende de:** T-01
**Aceite:** RF-07 passa antes e depois da implementação. RF-10 falha antes e passa depois de T-08.
**Arquivos:** `test/static.test.ts`

---

### T-06 — Testes de corpo fatiado (D-06) e de HEAD sem corpo

Adicionar testes de fatiamento para dois tipos de corpo, cobrindo R1:
- corpo como `Blob` (`new Blob([...])`), Range `bytes=100-199` → bytes exatos;
- corpo como string ASCII, Range `bytes=100-199` → bytes exatos;
- corpo como `ReadableStream` que emite o conteúdo em vários chunks, com o trecho cruzando a fronteira de dois chunks → bytes exatos.

Os casos de `Blob` e string devem falhar antes da implementação. O de stream também, pois o corpo hoje é o arquivo inteiro.

**Cobre:** RF-02, RF-03 (corpo), D-06 (R1)
**Depende de:** T-01
**Aceite:** os três casos falham antes e passam depois de T-09, nos dois modos.
**Arquivos:** `test/static.test.ts`

---

### T-07 — Helpers privados: `parseRange` e `ifRangeMatches`

Implementar em `src/utils/static.ts`, na seção `// --- Internal Utils ---` ao final do arquivo (D-01), as funções privadas:
- `parseRange(header, size)`: aceita só unidade `bytes` (sem diferença de maiúsculas), um `range-spec` após separar por `,` e descartar vazios/OWS, formatos `a-b`, `a-`, `-n`, com dígitos decimais. Retorna `ByteRange`, `"unsatisfiable"` ou `undefined` conforme a tabela de D-03. Valores fora de `Number.isSafeInteger` são tratados como malformados (R-05).
- `ifRangeMatches(ifRange, validators)`: `true` só para ETag forte (sem `W/`) igual a `meta.etag`, ou data HTTP com o mesmo `getTime()` do `mtimeDate` truncado para segundos (D-04, R2).

Não exportar nenhum dos dois (RF-11). Não criar `src/utils/internal/range.ts` (D-01, R-06).

**Cobre:** RF-02, RF-04, RF-05, RF-06, RF-11
**Depende de:** T-02, T-03, T-04
**Aceite:** os testes de T-02, T-03 e T-04 que tratam só de parsing e If-Range passam quando o fluxo estiver integrado (T-08). Os helpers não aparecem em `src/index.ts`. `pnpm typecheck` passa.
**Arquivos:** `src/utils/static.ts`

---

### T-08 — Integração de Range no fluxo do `serveStatic`

Em `src/utils/static.ts`, inserir o bloco entre `static.ts:270` e `static.ts:272`, conforme techspec seção 3:
- `accept-ranges: bytes` definido antes da decisão de Range (D-08, RF-01);
- `resolveRange(event, meta, { id, assetId, mtimeDate })` retorna `undefined` quando não há `Range`, quando `size` é ausente/0 (D-09), quando `id !== assetId` ou `meta.encoding` existe (D-05), e quando `If-Range` não casa (D-04);
- `416`: `content-range: bytes */<size>`, `content-length: 0`, `statusText` "Range Not Satisfiable", sem corpo (RF-04, D-07);
- `206`: `content-range` e `content-length` do trecho sobrescrevem qualquer valor anterior (D-07, RF-02);
- ordem: 304 antes de If-Range e de Range (D-02, RF-07).

Não mudar a assinatura de `serveStatic`, nem `getMeta`/`getContents` (RF-11).

**Cobre:** RF-01, RF-04, RF-07, RF-08, RF-09, RF-10
**Depende de:** T-07, T-05
**Aceite:** T-01 (accept-ranges), T-02 (416), T-03, T-04 e T-05 passam nos dois modos. Os casos de RF-07 continuam passando.
**Arquivos:** `src/utils/static.ts`

---

### T-09 — Corpo e HEAD para `206` (`sliceBody`)

Implementar `sliceBody(body, range)` em `src/utils/static.ts`, privada (D-06):
- `null`/`undefined` → `null`;
- `Blob` (inclui `File`) → `body.slice(start, end + 1)`;
- demais `BodyInit` → `new Response(body).body`, com `ReadableStream` (`pull`) que descarta `start` bytes e emite `end - start + 1` bytes, sem acumular o conteúdo.

Ajustar o fim de `serveStatic` (`static.ts:272-277` na techspec):
- `status = range ? 206 : 200`, com `statusText` "Partial Content" quando 206;
- HEAD devolve `206` sem corpo quando há range (RF-03);
- GET chama `getContents` e devolve `sliceBody(contents, range)` quando há range; senão mantém `contents || null` com `200`.

**Cobre:** RF-02, RF-03, RF-10
**Depende de:** T-08, T-06
**Aceite:** T-02 (206 e HEAD), T-06 (fatiamento) e T-05 (RF-10) passam nos dois modos. A resposta `200` sem Range é idêntica à anterior (comparar com os testes existentes).
**Arquivos:** `src/utils/static.ts`

---

### T-10 — Verificação final e regressão

Rodar, na ordem:
1. `pnpm vitest run test/static.test.ts`
2. `pnpm vitest run test/unit/package.test.ts` (snapshot de exports, RF-11)
3. `pnpm lint` (oxlint + oxfmt --check)
4. `pnpm typecheck`
5. `pnpm test` (suíte completa com cobertura)

Confirmar que cada RF de RF-01 a RF-10 tem ao menos um teste que falharia sem a implementação (critério do RF-12). Registrar o resultado de cada passo na entrega; se algum falhar, reportar com a saída.

**Cobre:** RF-11, RF-12
**Depende de:** T-09
**Aceite:** os cinco comandos passam. A lista de exports de `src/index.ts` não muda. Cada RF tem teste identificado.
**Arquivos:** `test/static.test.ts`, `test/unit/package.test.ts` (somente leitura)

---

## Cobertura dos requisitos

| RF | Tarefas |
|---|---|
| RF-01 | T-01, T-08 |
| RF-02 | T-02, T-06, T-07, T-09 |
| RF-03 | T-02, T-06, T-09 |
| RF-04 | T-02, T-07, T-08 |
| RF-05 | T-03, T-07 |
| RF-06 | T-04, T-07 |
| RF-07 | T-05, T-08 |
| RF-08 | T-03, T-08 |
| RF-09 | T-03, T-08 |
| RF-10 | T-05, T-08, T-09 |
| RF-11 | T-07, T-10 |
| RF-12 | T-01, T-10 |
