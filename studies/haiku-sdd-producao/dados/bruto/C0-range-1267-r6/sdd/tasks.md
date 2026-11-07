# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/prd.md` (RF-01..RF-12) e `sdd/techspec.md` (D-01..D-09). Fluxo de AGENTS.md: escrever os testes, confirmar que falham, implementar, confirmar que passam, rodar a suíte ampla.

## Cobertura dos requisitos

| Requisito | Tarefas          |
| --------- | ---------------- |
| RF-01     | T-01, T-05       |
| RF-02     | T-01, T-02, T-06 |
| RF-03     | T-01, T-06       |
| RF-04     | T-01, T-02, T-06 |
| RF-05     | T-01, T-02       |
| RF-06     | T-01, T-05       |
| RF-07     | T-01, T-03, T-06 |
| RF-08     | T-01, T-05, T-08 |
| RF-09     | T-01, T-06       |
| RF-10     | T-01, T-05, T-08 |
| RF-11     | T-07, T-08       |
| RF-12     | T-01, T-04, T-06 |

---

### T-01 — Escrever os testes de Range (devem falhar de início)

Criar `test/static-range.test.ts` com `describeMatrix` (web + node), asset `"0123456789"` (size 10) e um caso por critério de aceite do PRD, conforme techspec §5: RF-01 (GET/HEAD sem Range, `accept-ranges: bytes`), RF-02 (`2-5`, `7-`, `-3`, `8-99`, `-99`, `0-0`), RF-03 (HEAD com `getContents` em `vi.fn` não chamado), RF-04 (`10-`, `50-60`, `-0`, `size: 0`, valor gigante), RF-05 (`0-1,4-5`, `5-2`, `abc`, `5`, `--1`, vazio, `items=0-1`), RF-06 (sem `size`, sem `accept-ranges`), RF-07 (etag forte, etag diferente, `W/`, data igual/diferente/inválida, `If-Range` sem `Range`, `If-Range` falho com range que seria 416), RF-08 (`If-None-Match` e `If-Modified-Since` + `Range` ⇒ 304), RF-09 (variante `.gz` de 20 bytes com `encoding` neutro em `getMeta`; `options.headers` com `content-length: "999"` prevalecendo só no 200), RF-10 (404, `fallthrough`, POST ⇒ 405 com `allow: GET, HEAD`, caminho não canônico) e RF-12 (`string` incl. multibyte, `Uint8Array` com `byteOffset` ≠ 0, `ArrayBuffer`, `Blob`, `File`, `ReadableStream` com um e vários chunks, e `FormData`/`URLSearchParams`/`null` ⇒ 200 completo). Incluir também o teste de regressão de `size` 0 sem `content-length` no 200.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-12
Arquivos:

- `test/static-range.test.ts` (novo)

Depende de: nenhuma
Aceite: `pnpm vitest run test/static-range.test.ts` executa e os casos de 206/416/`accept-ranges` falham antes da implementação (os de 200/304/404/405 já passam); nenhum erro de sintaxe ou de tipos no arquivo.

---

### T-02 — Helper privado `resolveRange`

Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, adicionar (sem `export`) o tipo `ByteRange` e `resolveRange(header, size)` conforme D-04: regex estrita `/^bytes=(\d*)-(\d*)$/i` sobre `header.trim()`; ignorar (`undefined`) cabeçalho ausente, sintaxe inválida, `bytes=-`, intervalo invertido e múltiplos intervalos; `"unsatisfiable"` para início ≥ `size`, sufixo `-0` e qualquer intervalo com `size` 0; sufixo `-n` com `n ≥ size` devolve o arquivo todo; fim ajustado a `size - 1`. Anotar o tipo de retorno explicitamente.

Cobre: RF-02, RF-04, RF-05
Arquivos:

- `src/utils/static.ts`

Depende de: T-01
Aceite: `pnpm typecheck` passa e a função não aparece nas exportações do módulo; os casos de parsing (RF-02/04/05) de T-01 passam depois de T-06.

---

### T-03 — Helper privado `ifRangeMatches`

Em `src/utils/static.ts`, adicionar (sem `export`) `ifRangeMatches(ifRange, etag, lastModified)` conforme D-05: valor iniciado por `"` ou `W/` é entity-tag e só casa se o `etag` enviado existir, não for fraco (`/^w\//i`) e for idêntico byte a byte; caso contrário, comparar como data HTTP com igualdade exata (`Date.parse` válido e `===` ao `last-modified` enviado); inválido ou sem validador ⇒ `false`.

Cobre: RF-07
Arquivos:

- `src/utils/static.ts`

Depende de: T-01
Aceite: `pnpm typecheck` passa e a função não é exportada; os casos de `If-Range` de T-01 passam depois de T-06.

---

### T-04 — Helper privado `sliceBody`

Em `src/utils/static.ts`, adicionar (sem `export`) `sliceBody(body, start, end)` conforme D-07: `string` via `TextEncoder` + `subarray` (bytes UTF-8); views via `new Uint8Array(buffer, byteOffset + start, len)`; `ArrayBuffer` idem; `Blob`/`File` via `slice(start, end + 1)`; `ReadableStream` envolvente que descarta `start` bytes, emite até `len` bytes e faz `cancel()` da origem; `null`/`undefined`, `FormData`, `URLSearchParams` e demais ⇒ `undefined` (fallback para 200).

Cobre: RF-12
Arquivos:

- `src/utils/static.ts`

Depende de: T-01
Aceite: `pnpm typecheck` passa e a função não é exportada; os casos de RF-12 de T-01 (todos os tipos de corpo, stream em um e vários chunks, multibyte) passam depois de T-06.

---

### T-05 — `Accept-Ranges` e preservação do caminho 200

No fim de `serveStatic` (`static.ts`, trecho de `content-length`/HEAD/GET), calcular `size` conhecido (inteiro seguro ≥ 0 vindo de `meta.size`) e, só então, gravar `accept-ranges: bytes` com "set se ausente" (D-03). Manter o `content-length` do 200 como hoje (só com `size > 0` e se ausente) e o 200 de HEAD/GET inalterados. A lógica nova entra depois do 304 e dos cabeçalhos de tipo/encoding (D-02), sem tocar 404/405/`fallthrough`. Sem `size`, não anunciar nem aplicar range.

Cobre: RF-01, RF-06, RF-08, RF-10
Arquivos:

- `src/utils/static.ts`

Depende de: T-02
Aceite: `pnpm vitest run test/static-range.test.ts -t "RF-01|RF-06|RF-08|RF-10"` passa e `pnpm vitest run test/static.test.ts` segue verde; 404/405/304 não trazem `accept-ranges` nem `content-range`.

---

### T-06 — Emitir 206, 416 e HEAD com range

Ainda em `serveStatic`, após `accept-ranges`: resolver o range (`resolveRange` com `event.req.headers.get("range")`), aplicar `ifRangeMatches` com os valores efetivamente enviados em `etag`/`last-modified` de `event.res.headers` quando houver `If-Range` (D-05), e então:

- `"unsatisfiable"` ⇒ 416, `content-range: bytes */<size>`, `content-length: 0` (set incondicional), corpo `null`, `statusText` explícito, sem chamar `getContents`;
- range válido + HEAD ⇒ 206 com `content-range` e `content-length` do trecho, corpo vazio, sem chamar `getContents`;
- range válido + GET ⇒ chamar `getContents(id)` uma vez, `sliceBody`; se houver trecho, 206; senão cair para o 200 completo reutilizando o `contents` obtido;
- em 206/416 o `content-length` do trecho sobrescreve o de `options.headers`; `Content-Encoding`, `Content-Type`, `Vary`, `ETag`, `Last-Modified` e `headers` das opções permanecem (RF-09).

Cobre: RF-02, RF-03, RF-04, RF-07, RF-09, RF-12
Arquivos:

- `src/utils/static.ts`

Depende de: T-02, T-03, T-04, T-05
Aceite: `pnpm vitest run test/static-range.test.ts` passa por inteiro, em `web` e `node`; `getContents` não é chamado em HEAD nem em 416; o 200 com `content-length: "999"` das opções continua `999` e o 206/416 usam o valor do trecho.

---

### T-07 — Documentar o suporte a ranges

Acrescentar ao JSDoc de `serveStatic` (`static.ts`) um parágrafo sobre ranges: um único intervalo `bytes`, necessidade de `meta.size` correto em bytes da variante enviada (`size` incorreto gera `Content-Range` incorreto), fatiamento feito sobre o que `getContents` devolve, `If-Range` com validador forte, range sobre a representação codificada e ETags distintos por variante. Espelhar o mesmo texto no bloco `automd` de `docs/2.utils/2.response.md` (manualmente ou via `pnpm fmt`), mantendo os dois em sincronia. Não alterar `src/index.ts` nem os tipos públicos.

Cobre: RF-11
Arquivos:

- `src/utils/static.ts`
- `docs/2.utils/2.response.md`

Depende de: T-06
Aceite: o texto do JSDoc e o do bloco `automd` são idênticos (`pnpm fmt` não gera diff adicional); `git diff` não mostra alteração em `src/index.ts`.

---

### T-08 — Verificação final e regressão

Rodar `pnpm vitest run test/static-range.test.ts test/static.test.ts test/security.test.ts test/router.test.ts` e depois `pnpm test` (lint + typecheck + cobertura). Conferir que `test/unit/package.test.ts` (snapshot de exports) passa sem alteração e que nenhum nome novo foi exportado de `src/index.ts` ou de `src/utils/static.ts`. Se algum teste existente falhar por causa do novo `accept-ranges`, ajustar somente a expectativa de cabeçalho (opcionalmente incluir `"accept-ranges": "bytes"` nos `expectedHeaders` de `test/static.test.ts`), sem enfraquecer o que ele verifica.

Cobre: RF-08, RF-10, RF-11
Arquivos:

- `test/static.test.ts` (somente se algum ajuste for necessário)

Depende de: T-06, T-07
Aceite: `pnpm test` termina sem falhas, `pnpm lint` e `pnpm typecheck` passam, e `git status` mostra apenas `src/utils/static.ts`, `docs/2.utils/2.response.md`, `test/static-range.test.ts` (e `test/static.test.ts` se ajustado) além de `sdd/`.
