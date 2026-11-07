# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08). A ordem segue o fluxo de correção do `AGENTS.md`: testes primeiro, confirmados falhando antes da implementação.

Grafo de dependências: T-01 → T-02 → (T-03, T-04) → T-05 → T-07; T-06 depende de T-04.

### T-01 — Escrever os testes de Range (vermelhos)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-08, RF-11

**Depende de:** nenhuma

**Aceite:**
- Criar `test/static-range.test.ts` com `describeMatrix` (modos `web` e `node`), no padrão de `test/static.test.ts:5`.
- Fixture: asset `"0123456789"` (10 bytes), `etag: '"v1"'`, `mtime` fixo, `getContents` como `vi.fn`, rota `app.all("/**", e => serveStatic(e, opts))`.
- Casos: GET e HEAD sem Range com `accept-ranges: bytes`; `2-5` → 206 com `bytes 2-5/10`, `content-length: 4`, corpo `"2345"`; `8-99` → 206 limitado; `7-` e `-3` → 206 `bytes 7-9/10`; `-99` → 206 `bytes 0-9/10`; `0-1,4-5`, `itens=0-1`, `bytes=5-2`, `bytes=`, `bytes=a-b` → 200 completo sem `content-range`; `20-30`, `10-`, `-0` → 416 com `content-range: bytes */10`, `content-length: 0`, corpo vazio e `getContents` não chamado; HEAD com `2-5` → 206 e corpo vazio sem chamar `getContents`; `getMeta` sem `size` e com `size: 0` + Range → 200 sem `content-range`.
- Rodar `pnpm vitest run test/static-range.test.ts` e confirmar que os casos de 206/416 falham antes de qualquer mudança em `src/`. Registrar a saída.

**Arquivos:** `test/static-range.test.ts`

### T-02 — Implementar Accept-Ranges, interpretação de Range e respostas 206/416 para asset de tamanho conhecido

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-08

**Depende de:** T-01

**Aceite:**
- Em `src/utils/static.ts`, substituir o trecho entre `content-encoding` e o retorno final pela sequência da D-02: `accept-ranges` (escrito só se ausente em `event.res.headers`, sem 304), decisão de Range, ramo 200 atual.
- Helper privado `parseRange(header, size)` no fim do arquivo, na seção `// --- Internal Utils ---`, com a regex de faixa única da D-04 (`/^bytes=(\d*)-(\d*)$/i`), tabela de classificação e tratamento de inteiros fora do seguro como `Infinity`.
- `size` só conta se `Number.isSafeInteger(size) && size > 0` (D-07); caso contrário, Range é ignorado.
- 206: `set("content-range")` e `set("content-length")` em `event.res.headers`; HEAD retorna `HTTPResponse(null, { status: 206 })` sem chamar `getContents`.
- 416: `set("content-range", "bytes */<size>")`, `set("content-length", "0")`, `delete("content-encoding")`, retorno `HTTPResponse(null, { status: 416 })` em GET e HEAD.
- Ao final, `pnpm vitest run test/static-range.test.ts` passa nos modos `web` e `node` para os casos de T-01; os casos de `If-Range` (T-03) e de corpo (T-04) podem continuar vermelhos.
- Não exportar nada novo (RF-10).

**Arquivos:** `src/utils/static.ts`

### T-03 — Validar If-Range

**Cobre:** RF-07

**Depende de:** T-02

**Aceite:**
- Helper privado `isIfRangeValid(ifRange, etag, lastModified)` conforme D-05: valor com `"` → ETag por comparação forte (idêntico ao `etag` efetivo, sem `W/` em nenhum dos dois); valor com `W/` → não casa; senão, data HTTP válida e igual (`getTime`) ao `last-modified` efetivo.
- Validadores efetivos lidos de `event.res.headers`, não de `meta`.
- `If-Range` sem `Range` é ignorado.
- Não casando, responde 200 completo com `accept-ranges: bytes`.
- Testes em `test/static-range.test.ts`: `If-Range: "v0"` → 200; `"v1"` → 206; `W/"v1"` → 200; data igual ao `last-modified` → 206; data diferente → 200; `If-Range` sem `Range` → 200.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

### T-04 — Recortar o corpo por tipo (sliceBody e sliceStream)

**Cobre:** RF-02, RF-06, RF-11

**Depende de:** T-02

**Aceite:**
- Helper privado `sliceBody(body, range, size)` conforme D-06: `string` por `TextEncoder` e `subarray`; `ArrayBuffer`/`ArrayBufferView` sem cópia (respeitando `byteOffset`); `Blob`/`File` por `slice`; `ReadableStream` por `sliceStream`; demais tipos devolvem `undefined`.
- Se o tamanho real de string, buffer ou Blob diferir de `size`, devolve `undefined` e serve 200 completo.
- `sliceStream` descarta bytes até `start`, repassa até `end`, depois chama `reader.cancel()` e fecha.
- Escrever `content-range` e `content-length` só depois de `sliceBody` ter sucesso (D-08); queda para 200 não pode deixar cabeçalhos de 206.
- Testes: matriz de recorte para `string` com caracteres multibyte, `Uint8Array` com `byteOffset` ≠ 0, `ArrayBuffer`, `Blob` e `ReadableStream` (verificando que o stream original é cancelado após o fim do intervalo); `FormData`/`URLSearchParams` → 200 completo; tamanho real diferente de `size` → 200 completo.
- Sem mudança na assinatura de `getContents` (RF-10 e PRD).

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

### T-05 — Preservar 304, encoding, fallthrough, 404 e 405 com Range

**Cobre:** RF-09, RF-11

**Depende de:** T-03, T-04

**Aceite:**
- Testes em `test/static-range.test.ts`: `If-None-Match` casando + Range → 304 sem corpo; `If-Modified-Since` casando + Range → 304; asset inexistente + Range → 404, e com `fallthrough: true` o handler seguinte responde; POST → 405; variante `.gz` via `accept-encoding` + Range → 206 com `content-encoding: gzip`, `vary: accept-encoding` e recorte da variante; 416 de variante `.gz` sem `content-encoding`.
- `content-length` pré-definido em `headers` com Range válido → 206 com o comprimento do intervalo; `accept-ranges: none` em `headers` → Range ignorado.
- Rodar `pnpm vitest run test/static.test.ts test/static-range.test.ts`; se algum teste existente falhar, ajustá-lo somente se depender explicitamente do comportamento alterado (RF-11), e registrar o motivo.

**Arquivos:** `test/static-range.test.ts`, `src/utils/static.ts`, `test/static.test.ts` (somente se necessário)

### T-06 — Confirmar que não há novas exportações públicas

**Cobre:** RF-10

**Depende de:** T-04

**Aceite:**
- `src/index.ts` permanece igual (`ServeStaticOptions`, `StaticAssetMeta`, `serveStatic` no export da linha ~193), sem edição.
- `pnpm vitest run test/unit/package.test.ts` passa sem alteração do snapshot.
- `ServeStaticOptions` e `StaticAssetMeta` não mudam; `parseRange`, `isIfRangeValid`, `sliceBody` e `sliceStream` não são exportadas.

**Arquivos:** `src/utils/static.ts` (verificação de leitura), `src/index.ts` (sem alteração), `test/unit/package.test.ts` (sem alteração)

### T-07 — Verificação final e regressão

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11

**Depende de:** T-05, T-06

**Aceite:**
- `pnpm vitest run test/static-range.test.ts test/static.test.ts` verde nos modos `web` e `node`.
- `pnpm vitest run` (suíte completa) verde.
- `pnpm lint` (oxlint + oxfmt --check + typecheck) sem erros.
- `pnpm typecheck` sem erros.
- Conferir que o tamanho de `src/utils/static.ts` e o alvo de <200 LoC do `AGENTS.md` são uma exceção registrada (R-06 da techspec), não um efeito colateral não documentado.
- Relatar a saída de cada comando; qualquer falha é reportada com o output, não omitida.

**Arquivos:** nenhum (somente execução de comandos de verificação)
