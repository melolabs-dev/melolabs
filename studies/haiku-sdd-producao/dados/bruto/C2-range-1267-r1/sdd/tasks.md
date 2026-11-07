# Tarefas: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (D-01 a D-09).

Premissas adotadas a partir dos pontos a confirmar da techspec (seção 8). Se alguma mudar, ajustar as tarefas afetadas:
- Helpers ficam em `src/utils/static.ts`, sem `export` (D-01).
- Range é ignorado quando há `Content-Encoding` (D-07).
- Range com conteúdo ausente responde 404 (D-09).
- `accept-ranges` definido pelo usuário em `options.headers` não é tratado de forma especial (R-h).

Ordem de trabalho: escrever os testes primeiro (T-01 e T-02), confirmar que os novos casos falham com a implementação atual, e só então implementar (fluxo de correção de `AGENTS.md`).

---

### T-01 — Testes de cabeçalhos e intervalos válidos

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-12

**Depende de:** nenhuma

**Aceite:** Em `test/static.test.ts`, um novo bloco `describeMatrix("serve static range requests", ...)` cobre, nos modos `web` e `node`:
- GET e HEAD sem `Range` devolvem 200 com `accept-ranges: bytes` (RF-01);
- `bytes=0-99` devolve 206, `content-range: bytes 0-99/1000`, `content-length: 100` e o corpo `content.slice(0, 100)` (RF-02);
- `bytes=900-` devolve `900-999`, `bytes=-50` devolve `950-999` e `bytes=900-5000` devolve `900-999` (RF-03);
- HEAD com `Range: bytes=0-99` devolve 206, os mesmos cabeçalhos do GET e corpo vazio (RF-04).
Com a implementação atual, os casos que exigem 206 devem falhar. Os casos de `accept-ranges` também devem falhar. Os testes existentes devem continuar passando.

**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes de 416, ignorados, If-Range, precedência e casos especiais

**Cobre:** RF-05, RF-06, RF-07, RF-08, RF-09, RF-12

**Depende de:** nenhuma

**Aceite:** No mesmo bloco de `test/static.test.ts` (ou em um bloco vizinho), cada caso roda nos modos `web` e `node`:
- 416: `bytes=1000-` e `bytes=-0` devolvem 416, `content-range: bytes */1000`, `content-length: 0` e corpo vazio (RF-05);
- Ignorados com 200 completo e sem `content-range`: `bytes=abc`, `items=0-9`, `bytes=0-9,20-29` e `bytes=50-10` (RF-06);
- If-Range: ETag forte igual a `"abc"` com `bytes=0-99` devolve 206; `If-Range: "outro"` devolve 200; ETag fraco `W/"abc"` no asset nunca confere e devolve 200; data igual ao `last-modified` devolve 206; data diferente devolve 200 (RF-07);
- `If-None-Match: "abc"` com `bytes=0-99` devolve 304 sem corpo e sem `accept-ranges` (RF-08);
- `getMeta` sem `size` devolve 200 completo, com `accept-ranges` e sem `content-range` (RF-09);
- `getMeta` com `encoding` e `bytes=0-99` devolve 200 completo (D-07);
- `getContents` devolvendo `undefined` com `bytes=0-99` devolve 404 (D-09);
- Os casos de 206 de T-01 repetidos com `getContents` devolvendo `Blob`, `ReadableStream` e `Uint8Array`, para cobrir os dois ramos de `sliceContents` (D-04).
Com a implementação atual, os casos que exigem 416, 206 ou 304 com Range devem falhar. Os casos "ignorados" e de 200 podem passar.

**Arquivos:** `test/static.test.ts`

---

### T-03 — Parser de `Range`, avaliação de `If-Range` e resolução do intervalo

**Cobre:** RF-03, RF-05, RF-06, RF-07, RF-09

**Depende de:** T-01, T-02

**Aceite:** Em `src/utils/static.ts`, no fim do arquivo (seção `// --- Internal Utils ---`), sem `export`, estão as funções:
- `parseRangeSpec(value)`: aceita só `bytes=` (sem diferença de caixa) com uma range-spec `first-last`, `first-` ou `-suffix`. Devolve `undefined` para outra unidade, sintaxe inválida, mais de uma range-spec ou `first > last` (D-02);
- `ifRangeMatches(value, validators)`: ETag só confere se for forte e idêntico; data só confere se for igual ao `mtime` truncado para segundos (D-03, R-f);
- `resolveRange(headers, validators)`: segue a ordem de regras da techspec (seção 4), devolvendo `ByteRange`, `"unsatisfiable"` ou `undefined`.
Os tipos `ByteRange` e `RangeOutcome` também são privados. Os casos de T-02 que dependem só de parsing e de `If-Range` passam após esta tarefa, e os casos de 416 passam após T-05.

**Arquivos:** `src/utils/static.ts`

---

### T-04 — Integração no fluxo de `serveStatic`: `accept-ranges`, 304 e `Content-Encoding`

**Cobre:** RF-01, RF-08, RF-09, RF-10

**Depende de:** T-03

**Aceite:** Em `src/utils/static.ts`:
- Logo após o bloco de 304 (`src/utils/static.ts:243-248`), `accept-ranges: bytes` é definido se ainda não existir (D-05). Um 304 não recebe o cabeçalho;
- Quando há `content-encoding` depois de `src/utils/static.ts:264-266`, o Range é ignorado (D-07);
- `resolveRange` é chamado com `size`, `etag` e `mtime` do asset, e só quando `meta.size` é maior que zero (RF-09);
- A busca de meta, o `fallthrough`, a canonicalização e o cache permanecem como antes. Nenhum cabeçalho de Range é definido antes de o asset ser encontrado (R-d, R3).
Os casos de `accept-ranges`, 304, tamanho desconhecido, encoding e fallthrough de T-01 e T-02 passam. Os testes existentes de cache, 404 e `vary` continuam passando.

**Arquivos:** `src/utils/static.ts`

---

### T-05 — Respostas 206, 416 e HEAD; fatiamento do corpo

**Cobre:** RF-02, RF-04, RF-05, RF-09, RF-12

**Depende de:** T-03, T-04

**Aceite:** Em `src/utils/static.ts`:
- Em 206 e 416, `content-range` e `content-length` são definidos com `event.res.headers.set`, sobrescrevendo valor preexistente (D-06). Em 416 a resposta é `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })` (D-08);
- HEAD com Range devolve 206 com o mesmo `content-range` e `content-length` do GET e corpo vazio;
- GET com Range chama `getContents`, fatia com `sliceContents` (`Blob.slice` para `Blob`; `arrayBuffer` + `subarray` para os demais tipos, D-04) e devolve 206. Se `getContents` devolver `null` ou `undefined`, lança `HTTPError` 404 (D-09);
- GET e HEAD sem Range aplicável continuam iguais a antes, com apenas `accept-ranges` extra.
Todos os casos de T-01 e T-02 passam. `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`.

**Arquivos:** `src/utils/static.ts`

---

### T-06 — Confirmar ausência de novas exportações e documentar `size` em bytes

**Cobre:** RF-11

**Depende de:** T-05

**Aceite:**
- `src/index.ts` não muda. `pnpm vitest run test/unit/package.test.ts` passa sem alterar o snapshot de exports;
- As assinaturas públicas de `serveStatic`, `ServeStaticOptions`, `StaticAssetMeta`, `getMeta` e `getContents` não mudam (comparação com a versão anterior via `git diff`);
- O JSDoc de `size` em `StaticAssetMeta` diz que o valor é o número de bytes do corpo, não o número de caracteres (R-a, R-c). Essa é a única alteração permitida em tipos públicos.

**Arquivos:** `src/utils/static.ts`, `src/index.ts` (verificação, sem alteração), `test/unit/package.test.ts` (verificação, sem alteração)

---

### T-07 — Verificação final e regressão

**Cobre:** RF-10, RF-12

**Depende de:** T-05, T-06

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`;
- `pnpm lint` passa (inclui typecheck, segundo `AGENTS.md`);
- `pnpm test` (suíte completa com cobertura) passa;
- Os testes existentes de `test/static.test.ts` (linhas 42, 57, 199, 219, 470, 516, 600-617 e 626-678) continuam iguais ou só com ajuste mínimo e justificado (R4 do PRD, R-e da techspec). Qualquer ajuste deve ser listado no relatório da tarefa;
- Nenhum arquivo fora de `src/utils/static.ts` e `test/static.test.ts` foi alterado.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts` (verificação do conjunto completo de testes)
