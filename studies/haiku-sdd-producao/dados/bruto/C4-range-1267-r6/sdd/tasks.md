# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-14) e `sdd/techspec.md` (decisões D-01 a D-10, riscos R-01 a R-14).

Ordem geral: T-01 primeiro (testes de regressão que falham, conforme R7 do PRD e o fluxo de bug do `AGENTS.md`). Depois os helpers (T-02, T-03), a integração em `serveStatic` (T-04), os testes restantes (T-05 a T-07), a verificação de API (T-08) e a bateria final (T-09).

Comandos de verificação usados nos aceites:
- `pnpm vitest run test/static.test.ts` (roda nos modos `web` e `node`)
- `pnpm lint`
- `pnpm typecheck`

---

### T-01 — Testes de regressão para Range, validador e 416

Cobre: RF-02, RF-06, RF-08

Depende de: nenhuma

Aceite: Em `test/static.test.ts`, um novo bloco `describeMatrix("serve static range", …)` com um asset de 1000 bytes (conteúdo previsível, `etag: '"v1"'`, `mtime` fixo) e os casos: `bytes=0-499` → 206 com `content-range: bytes 0-499/1000`, `content-length: 500` e corpo igual a `slice(0, 500)`; `bytes=1000-1500` e `bytes=-0` → 416 com `content-range: bytes */1000` e `content-length: 0`; asset de 0 bytes com `bytes=0-` → 416 com `bytes */0`; `If-Range: "v1"` → 206, `"v0"` → 200 completo, `W/"v1"` com ETag fraco → 200 completo, data igual em `If-Range` → 206 e data diferente → 200. Ao rodar `pnpm vitest run test/static.test.ts` antes da implementação, esses casos devem falhar (confirmar e registrar a saída). Nenhum teste existente é alterado.

Arquivos: `test/static.test.ts`

---

### T-02 — Helpers `parseRange` e `matchesIfRange`

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-08

Depende de: T-01

Aceite: Em `src/utils/static.ts`, no fim do arquivo, existem `const kUnsatisfiable: unique symbol`, o tipo `ByteRange`, `parseRange(header, size)` com a regex `RANGE_RE` da techspec (D-02) e `matchesIfRange(ifRange, validators)` (D-03), sem `export`. `parseRange` devolve `ByteRange`, `kUnsatisfiable` ou `undefined` nos casos da D-02 (sem `size`, sintaxe inválida, `bytes=500-200`, `bytes=-`, lista com vírgula, outra unidade, `bytes=-0`, início ≥ tamanho). `matchesIfRange` compara ETag forte exato e data por igualdade após `mtimeDate` truncado em segundos. Os casos de T-01 passam a valer depois da integração de T-04. `pnpm typecheck` passa.

Arquivos: `src/utils/static.ts`

---

### T-03 — Fatiamento do corpo: `sliceBody` e `sliceStream`

Cobre: RF-12

Depende de: T-01

Aceite: Em `src/utils/static.ts`, `sliceBody(body, start, end)` e `sliceStream(source, start, end)` (D-06), privados e sem `export`. `Blob` é fatiado com `body.slice(start, end + 1)`, sem leitura antecipada. Os demais `BodyInit` passam por `new Response(body).body` e depois por `sliceStream`. `sliceStream` descarta bytes antes de `start`, entrega `[start, end]`, fecha a saída ao atingir `end` e chama `reader.cancel()` na origem; o `cancel` da saída repassa para a origem. `pnpm typecheck` passa.

Arquivos: `src/utils/static.ts`

---

### T-04 — Integração de Range em `serveStatic`

Cobre: RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11

Depende de: T-02, T-03

Aceite: Em `serveStatic`, `accept-ranges: bytes` é definido em `event.res.headers` logo após a seleção do asset e antes da checagem de cache (techspec D-04, passo 1). A decisão de intervalo fica entre o cálculo de `Content-Encoding` e o bloco de `Content-Length` do `meta`, para GET e HEAD. 206 e 416 definem `content-length` com `event.res.headers.set` (D-05), e 416 define `content-range: bytes */N` (D-08). HEAD com intervalo válido responde 206 sem chamar `getContents` (D-07). Para GET, se `getContents` devolver `null` ou `undefined`, o fluxo cai no 200 completo (D-09). Sem alteração para 404, 405, `fallthrough` e 304 (D-04). Ao final, `pnpm vitest run test/static.test.ts` passa para os casos de T-01 e os testes existentes continuam passando sem alteração.

Arquivos: `src/utils/static.ts`

---

### T-05 — Testes de cabeçalhos, intervalos abertos e de sufixo, HEAD e Range inválido

Cobre: RF-01, RF-03, RF-04, RF-05, RF-07

Depende de: T-04

Aceite: No bloco `serve static range`, casos com `describeMatrix`: GET sem `Range` tem `accept-ranges: bytes` (e um 304 também tem); `bytes=500-` → 500-999; `bytes=-200` → 800-999; `bytes=900-5000` → 900-999; `bytes=-5000` → 0-999 completo; HEAD com `bytes=0-499` → 206 com cabeçalhos e corpo vazio; `bytes=500-200`, `bytes=0-1,3-4`, `items=0-1` e `bytes=abc` → 200 sem `content-range`, com `content-length: 1000` e corpo completo; `getMeta` sem `size` com `bytes=0-99` → 200 completo sem `content-range`. `pnpm vitest run test/static.test.ts` passa.

Arquivos: `test/static.test.ts`

---

### T-06 — Testes de condicionais, encoding pré-comprimido e preservação de 404/405/fallthrough

Cobre: RF-09, RF-10, RF-11

Depende de: T-04

Aceite: No bloco `serve static range`: `If-None-Match: "v1"` com `Range: bytes=0-99` → 304 sem corpo e sem `content-range`; `encodings: { gzip: ".gz" }`, `app.js.gz` de 1000 bytes, `accept-encoding: gzip` e `bytes=0-99` → 206 com `content-encoding: gzip`, `content-range: bytes 0-99/1000`, `content-length: 100` e `vary: accept-encoding`; caminho inexistente com `Range` → 404, e com `fallthrough: true` a função devolve `undefined`; POST com `Range` → 405 com `allow: GET, HEAD`. `pnpm vitest run test/static.test.ts` passa.

Arquivos: `test/static.test.ts`

---

### T-07 — Testes de recorte do corpo para string, Blob, stream e HEAD

Cobre: RF-12

Depende de: T-04

Aceite: No bloco `serve static range`, `getContents` com string, `Blob` e `ReadableStream` de 1000 bytes e `bytes=500-599` → corpo com exatamente os bytes 500 a 599 nos três casos. Para o stream, o `cancel` da origem é um `vi.fn()` e o teste verifica que foi chamado depois de entregar o último byte do intervalo. Um teste de HEAD com `Range` válido verifica que `getContents` não foi chamado (`not.toHaveBeenCalled()`). Um teste de GET em que `getContents` devolve `null` verifica o 200 completo (D-09). `pnpm vitest run test/static.test.ts` passa.

Arquivos: `test/static.test.ts`

---

### T-08 — Verificar ausência de exports e de mudança na API pública

Cobre: RF-13

Depende de: T-04

Aceite: `git diff -- src/index.ts` vazio. `git diff -- src/utils/static.ts` não mostra linha nova com `export` (por exemplo, `git diff -- src/utils/static.ts | grep "^+export"` sem saída). `ServeStaticOptions` sem campos novos. Registrar o resultado na revisão, porque a techspec não prevê teste automatizado para RF-13. Nenhum arquivo fora de `src/utils/static.ts` e `test/static.test.ts` é alterado (`git status` confere).

Arquivos: `src/utils/static.ts`, `src/index.ts` (apenas leitura, sem alteração)

---

### T-09 — Verificação final: suíte, lint e typecheck

Cobre: RF-14

Depende de: T-05, T-06, T-07, T-08

Aceite: `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` (suíte completa) passam. Os testes novos rodam nos modos `web` e `node`. Nenhum teste existente foi alterado; se algum precisou de mudança, a justificativa é registrada, conforme RF-14. A saída dos comandos é anotada na revisão. Se algo falhar, reportar a saída real em vez de declarar sucesso.

Arquivos: `test/static.test.ts`, `src/utils/static.ts`

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-04, T-05 |
| RF-02 | T-01, T-02, T-04 |
| RF-03 | T-02, T-05 |
| RF-04 | T-04, T-05 |
| RF-05 | T-02, T-05 |
| RF-06 | T-01, T-02, T-04 |
| RF-07 | T-02, T-05 |
| RF-08 | T-01, T-02, T-04 |
| RF-09 | T-04, T-06 |
| RF-10 | T-04, T-06 |
| RF-11 | T-04, T-06 |
| RF-12 | T-03, T-04, T-07 |
| RF-13 | T-08 |
| RF-14 | T-09 |
