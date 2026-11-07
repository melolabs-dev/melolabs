# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08).

Ordem: testes primeiro (vermelhos), depois helpers privados, depois integração em `serveStatic`, depois verificação. Seguir o fluxo de correção do AGENTS.md: o teste precisa falhar antes da implementação.

---

### T-01 — Criar o bloco de testes de Range

**Cobre:** RF-11

**Depende de:** nenhuma

**Aceite:** Existe `describeMatrix("serve static range", ...)` em `test/static.test.ts`, depois do bloco atual. O asset de teste tem 1000 bytes ASCII (`"0123456789".repeat(100)`), ETag forte `"abc"` e `mtime` fixo. Um `it` de fumaça faz `GET` sem `Range` e recebe 200 com o corpo completo. `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`.

**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes de status e cabeçalhos de Range (RF-01 a RF-05)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

**Depende de:** T-01

**Aceite:** Os casos abaixo estão escritos e falham antes da implementação (hoje qualquer `Range` devolve 200):
- `Accept-Ranges: bytes` em GET 200, HEAD 200, 206 e 416.
- `0-499` retorna 206, `content-range: bytes 0-499/1000`, `content-length: 500` e os bytes 0 a 499.
- `500-` retorna os 500 bytes finais. `-100` retorna os 100 bytes finais. `900-5000` é limitado a `900-999`.
- `bytes=abc`, `items=0-10`, `bytes=0-10, 20-30`, `bytes=5-3` e `bytes=` retornam 200, sem `content-range`, com corpo completo.
- `bytes=1000-1200` e `bytes=-0` retornam 416, `content-range: bytes */1000`, `content-length: 0` e corpo vazio.
- HEAD com `0-499` retorna 206 com os cabeçalhos e corpo vazio. HEAD com `1000-` retorna 416.

**Arquivos:** `test/static.test.ts`

---

### T-03 — Testes de condicionais, tamanho desconhecido e fallthrough (RF-06 a RF-09)

**Cobre:** RF-06, RF-07, RF-08, RF-09

**Depende de:** T-01

**Aceite:** Os casos abaixo estão escritos e os que dependem de Range falham antes da implementação:
- If-Range com ETag forte igual retorna 206. Com ETag diferente retorna 200. Com ETag fraco igual (`W/"abc"`) retorna 200. Com data igual ao `last-modified` retorna 206. Com data diferente retorna 200.
- `If-None-Match: "abc"` com `Range` retorna 304, sem `content-range`.
- `getMeta` sem `size` com `Range` retorna 200 completo. `size: 0` também retorna 200 completo.
- Com `fallthrough: true`, POST com `Range: bytes=0-10` retorna `undefined`. Sem `fallthrough`, POST continua 405 com `allow: GET, HEAD`.

**Arquivos:** `test/static.test.ts`

---

### T-04 — Testes de corpo, Content-Length e 416 sem cache (RF-02, RF-04)

**Cobre:** RF-02, RF-04

**Depende de:** T-01

**Aceite:** Os casos abaixo estão escritos e falham antes da implementação:
- Para `0-499` e `990-999`, `getContents` devolvendo string, `Uint8Array`, `Blob` e `ReadableStream` produz os mesmos bytes.
- Para o `ReadableStream`, `cancel` do upstream é chamado depois que a fatia completa é emitida (`vi.fn` no `underlyingSource.cancel`).
- Com `headers: { "content-length": "999" }` e `bytes=0-499`, a resposta é 206 com `content-length: 500`. Sem `Range`, a resposta 200 continua com `999`.
- Com `encodings: { gzip: ".gz" }` e `accept-encoding: gzip`, o `Range` vale para os bytes da variante `.gz`, e `size` é o tamanho dessa variante.
- Com `headers: { "cache-control": ... }`, o 416 não contém `cache-control`.

**Arquivos:** `test/static.test.ts`

---

### T-05 — Helpers privados de parsing, resolução e If-Range

**Cobre:** RF-02, RF-03, RF-04, RF-06

**Depende de:** T-02, T-03, T-04

**Aceite:** Em `src/utils/static.ts`, no fim do arquivo, ficam `parseRange`, `resolveRange`, `matchesIfRange` e a interface `RangeSpec`, todos sem `export`. As regras são as do techspec D-02 e D-04:
- A unidade `bytes` não diferencia maiúsculas. Só dígitos. `b < a` é inválido e devolve `undefined`.
- Elementos vazios da lista são tolerados. Com dois ou mais intervalos devolve `undefined`.
- `-0` e `a >= size` devolvem `null`. `b >= size` é limitado a `size - 1`. `-n` com `n > size` vira `0-(size-1)`.
- `matchesIfRange` casa só ETag forte por igualdade exata, ou `Last-Modified` por igualdade exata. `W/` nunca casa.
- Os testes de T-02 a T-04 continuam vermelhos (a integração ainda não existe), mas os helpers são cobertos pelos casos de parsing de T-02 e T-03.

**Arquivos:** `src/utils/static.ts`

---

### T-06 — Fatiamento do corpo: `sliceContents` e `sliceStream`

**Cobre:** RF-02

**Depende de:** T-04

**Aceite:** `sliceContents(contents, start, length)` devolve `contents.slice(start, start + length)` para `Blob`. Para os demais tipos, usa `sliceStream(new Response(contents).body!, start, length)`. `sliceStream` descarta até `start` bytes, emite até `length` bytes, fecha o controlador ao completar e cancela o `reader` nesse momento. `cancel` repassa ao `reader`. Os casos de T-04 passam para string, `Uint8Array`, `Blob` e `ReadableStream`. Decidir e registrar no código o comportamento para os Riscos 1 (`Blob` com tamanho diferente de `meta.size`) e 2 (stream que termina antes de `length`), conforme o techspec.

**Arquivos:** `src/utils/static.ts`

---

### T-07 — Integrar o Range em `serveStatic`

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-07, RF-08, RF-09

**Depende de:** T-05, T-06

**Aceite:** A ordem de decisão segue o techspec D-05, sem alterar o 304 nem o caminho 200:
1. O bloco de 304 (`src/utils/static.ts:243-248`) fica como está.
2. `accept-ranges: bytes` é definido em `event.res.headers`, só se ainda não existir.
3. Se há `range`, `meta.size` é inteiro positivo, e `If-Range` (se houver) casa, `parseRange` é chamado. Se devolver `undefined`, segue como 200.
4. Se `resolveRange` devolve `null`, responde 416 com `event.res.errHeaders` (`accept-ranges`, `content-range: bytes */<size>`, `content-length: 0`) e corpo `null`. Não chama `getContents`.
5. Em `GET` válido, chama `getContents` antes de escrever `content-range` e `content-length`. Se o conteúdo for `null`/`undefined`, segue como 200. Caso contrário, sobrescreve `content-length` com `set` e retorna 206 com `sliceContents`.
6. Em `HEAD` válido, escreve os mesmos cabeçalhos e retorna 206 com corpo `null`, sem chamar `getContents`.
7. Sem Range atendível, o caminho atual (`src/utils/static.ts:272-277`) fica inalterado.

O docblock de `serveStatic` (`src/utils/static.ts:68-100`) ganha um parágrafo curto sobre Range, no mesmo tom dos demais. `pnpm vitest run test/static.test.ts` passa com todos os casos de T-02 a T-04, nos modos `web` e `node`.

**Arquivos:** `src/utils/static.ts`

---

### T-08 — Garantir que nenhum export público novo foi criado (RF-10)

**Cobre:** RF-10

**Depende de:** nenhuma

**Aceite:** `git diff -- src/index.ts` fica vazio. A lista de nomes exportados por `src/index.ts` é idêntica antes e depois da mudança, e a lista de `ServeStaticOptions` e `StaticAssetMeta` não ganhou campo. Nenhum helper de `src/utils/static.ts` é exportado. Registrar a lista de exports antes da implementação para comparar no fim.

**Arquivos:** `src/index.ts` (sem alteração), `src/utils/static.ts`

---

### T-09 — Verificação final e regressão

**Cobre:** RF-09, RF-11

**Depende de:** T-07, T-08

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa em `web` e `node`, sem alterar expectativa de nenhum teste existente.
- `pnpm vitest run test/security.test.ts test/unit/` continua verde.
- `pnpm typecheck` e `pnpm lint` passam.
- `pnpm test` passa, ou a falha é registrada com a saída.
- `git diff --stat` mostra só `src/utils/static.ts`, `test/static.test.ts` e `sdd/tasks.md`.

**Arquivos:** `test/static.test.ts`, `src/utils/static.ts`
