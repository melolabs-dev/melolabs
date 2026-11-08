# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-09, Estratégia de testes).

Ordem: os testes vêm antes da implementação (fluxo de bug fix de `AGENTS.md`, aplicado a feature). Cada teste novo deve falhar antes da tarefa de implementação correspondente.

**Pendência:** D-05 (ignorar Range quando a resposta é codificada) aguarda confirmação do responsável. As tarefas seguem a recomendação do techspec. Se D-05 for rejeitada, T-06 (caso `.gz`) passa a testar o comportamento da premissa do PRD e a condição de gating em T-11 muda.

---

### T-01 — Baseline dos testes existentes

**Cobre:** RF-08, RF-09, RF-10
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static.test.ts test/unit/package.test.ts test/security.test.ts` passa antes de qualquer alteração. O resultado é anotado na descrição da entrega. Nenhum arquivo é alterado nesta tarefa.
**Arquivos:** `test/static.test.ts`, `test/unit/package.test.ts`, `test/security.test.ts` (somente execução)

---

### T-02 — Testes de anúncio de Range e de asset sem tamanho

**Cobre:** RF-01, RF-07, RF-10
**Depende de:** T-01
**Aceite:** Novo `describeMatrix` "serve static range requests" em `test/static.test.ts`, com a fixture do techspec: `getMeta` retorna `{ type: "text/plain", etag: "\"abc\"", mtime: 1_700_000_000_000, size: 1000 }`, `getContents` retorna `"0123456789".repeat(100)`, sem `encoding` e sem `encodings`. Casos:
- GET sem Range → 200, corpo completo, `accept-ranges: bytes`;
- HEAD sem Range → 200, `accept-ranges: bytes`, corpo vazio;
- `getMeta` sem `size` e com `size: 0`, mesmo com `Range: bytes=0-99` → 200 completo, sem `accept-ranges`.

Os casos com `accept-ranges` devem falhar antes de T-11.
**Arquivos:** `test/static.test.ts`

---

### T-03 — Testes de parse: intervalos válidos, inválidos e 416

**Cobre:** RF-02, RF-03, RF-04, RF-10
**Depende de:** T-01
**Aceite:** Casos em `test/static.test.ts`, com a fixture de T-02:
- `bytes=0-99` → 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo = bytes 0 a 99;
- `bytes=900-` → 206, `bytes 900-999/1000`, `content-length: 100`;
- `bytes=-100` → 206, `bytes 900-999/1000`;
- `bytes=-5000` → 206, `bytes 0-999/1000`, corpo completo;
- `Bytes=0-99` → 206 (unidade sem diferença de caixa);
- `bytes=0-10,20-30`, `items=0-10`, `bytes=abc`, `bytes=5-3`, `bytes=-` → 200 completo, sem `content-range`;
- `bytes=2000-3000` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio;
- `bytes=-0` → 416.

**Arquivos:** `test/static.test.ts`

---

### T-04 — Testes de HEAD com Range

**Cobre:** RF-05, RF-10
**Depende de:** T-01
**Aceite:** Em `test/static.test.ts`, nos modos `web` e `node`:
- HEAD com `Range: bytes=0-99` → 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo vazio, e os mesmos cabeçalhos do GET correspondente;
- HEAD com `Range: bytes=2000-` → 416, `content-range: bytes */1000`, corpo vazio.

Cobre o Risco 7 do techspec (HEAD em Node).
**Arquivos:** `test/static.test.ts`

---

### T-05 — Testes de If-Range

**Cobre:** RF-06, RF-10
**Depende de:** T-01
**Aceite:** Em `test/static.test.ts`, com `Range: bytes=0-99`:
- `If-Range: "xyz"` → 200 completo;
- `If-Range: "abc"` → 206;
- `If-Range: W/"abc"` → 200 completo (ETag fraco nunca casa);
- `If-Range` com a data exata do `Last-Modified` (formato HTTP) → 206;
- `If-Range` com data diferente → 200 completo;
- `Range: bytes=2000-` com `If-Range: "xyz"` → 200 completo, não 416.

**Arquivos:** `test/static.test.ts`

---

### T-06 — Testes de preservação de comportamento e de cabeçalhos

**Cobre:** RF-08, RF-10
**Depende de:** T-01
**Aceite:** Em `test/static.test.ts`:
- `If-None-Match: "abc"` + `Range: bytes=0-99` → 304, como hoje;
- `fallthrough: true`, asset inexistente, com `Range` → a função retorna `undefined`;
- `options.headers` com `content-length: 999`, mais `Range: bytes=0-99` → 206 com `content-length: 100`;
- variante `.gz` com `accept-encoding: gzip` e `Range` → 200 completo, sem `content-range` (D-05);
- GET sem Range com variante `.gz` → resposta idêntica à de hoje (headers e corpo).

**Arquivos:** `test/static.test.ts`

---

### T-07 — Testes de fatiamento por tipo de corpo

**Cobre:** RF-02, RF-10
**Depende de:** T-01
**Aceite:** Em `test/static.test.ts`, com `Range: bytes=10-19`:
- `getContents` como `ReadableStream` emitindo chunks que cruzam o `start` (por exemplo, chunks de 7 bytes) → 206 com os bytes 10 a 19 corretos;
- o mesmo stream não é lido além de `end`: um contador de `pull` ou de chunks lidos confirma que a leitura para perto do fim do intervalo;
- `getContents` como `Blob` → 206 com os bytes 10 a 19 corretos.

Strings, `ArrayBuffer` e `TypedArray` já são cobertos por T-03.
**Arquivos:** `test/static.test.ts`

---

### T-08 — Implementar `parseRange` (privado)

**Cobre:** RF-02, RF-03, RF-04, RF-09
**Depende de:** T-03
**Aceite:** T-03 passa ao final desta tarefa (ainda pode haver falhas de T-02, T-04 e T-05, que dependem de T-11). `parseRange(header, size)` é uma função não exportada em `src/utils/static.ts`, abaixo de `// --- Internal Utils ---`, que devolve `ByteRange`, `"unsatisfiable"` ou `undefined`, conforme D-04:
- regex de um único `range-spec`, com OWS ao redor e unidade sem diferença de caixa;
- vírgula, `a > b`, valores não decimais → `undefined`;
- `bytes=-0` e `a >= size` → `"unsatisfiable"`;
- `bytes=-n` com `n > size` → início em 0.

`test/unit/package.test.ts` continua passando sem alteração (RF-09).
**Arquivos:** `src/utils/static.ts`

---

### T-09 — Implementar `ifRangeMatches` (privado)

**Cobre:** RF-06
**Depende de:** T-05
**Aceite:** T-05 passa ao final desta tarefa, exceto os casos que dependem de T-11. `ifRangeMatches(ifRange, validators)` é privada em `src/utils/static.ts`, conforme D-03:
- valor que começa com `"` ou `W/"` é entity-tag: casa só se `etag` é forte (não começa com `W/`) e é idêntico, caractere a caractere, ao valor de `If-Range`;
- outros valores são datas: casam se `Date.parse(valor)` é igual a `mtimeDate` truncado em segundos;
- sem `etag` ou sem `mtime` não há casamento.

Não reutilizar `matchETag` de `src/utils/internal/cache.ts` (comparação fraca).
**Arquivos:** `src/utils/static.ts`

---

### T-10 — Implementar `sliceBody` e `takeBytes` (privados)

**Cobre:** RF-02
**Depende de:** T-07
**Aceite:** T-07 passa ao final desta tarefa, exceto os casos que dependem de T-12. Conforme D-06, em `src/utils/static.ts`:
- `Blob` → `blob.slice(start, end + 1)`, sem ler a fonte inteira;
- `ReadableStream` → `takeBytes` descarta `start` bytes e emite `end - start + 1` bytes, cancelando a fonte ao atingir o fim do intervalo;
- demais tipos (`string`, `ArrayBuffer`, `TypedArray`, `DataView`, `URLSearchParams`, `FormData`) → `new Response(contents).arrayBuffer()` e `subarray`;
- `null` e `undefined` tratados sem erro.

Nenhum caminho lê um stream inteiro antes de fatiar.
**Arquivos:** `src/utils/static.ts`

---

### T-11 — Integrar a decisão de Range em `serveStatic` (Accept-Ranges, gating e If-Range)

**Cobre:** RF-01, RF-06, RF-07, RF-08
**Depende de:** T-02, T-06, T-08, T-09
**Aceite:** Bloco novo em `src/utils/static.ts` depois da seleção de `content-length` (após a linha 270) e antes do retorno antecipado de HEAD, conforme techspec D-02, D-03, D-05 e D-07:
- se `meta.size > 0`, `accept-ranges: bytes` é definido com `set` somente se ainda não existir; 304 e erros não recebem o cabeçalho;
- se há `content-encoding` ou `id !== assetId`, o Range é ignorado (D-05);
- se `If-Range` está presente e não casa, o Range é ignorado;
- o resultado de `parseRange` define o ramo: `undefined` → 200 atual, `"unsatisfiable"` → 416, `ByteRange` → 206 (a formatação dos cabeçalhos e do corpo fica em T-12);
- o 304 continua avaliado antes de tudo.

Os casos de T-02 e T-06 passam, nos modos `web` e `node`.
**Arquivos:** `src/utils/static.ts`

---

### T-12 — Cabeçalhos e corpo das respostas 206 e 416, inclusive HEAD

**Cobre:** RF-02, RF-04, RF-05
**Depende de:** T-03, T-04, T-07, T-10, T-11
**Aceite:** Conforme D-06, D-07 e D-08, em `src/utils/static.ts`:
- 206: `content-range: bytes <start>-<end>/<size>` e `content-length: <end - start + 1>` definidos com `event.res.headers.set`, sobrescrevendo `options.headers`; corpo vindo de `sliceBody`;
- 416: `content-range: bytes */<size>`, `content-length: 0`, corpo `null`; sem `fallthrough`;
- HEAD com 206 ou 416 envia os mesmos cabeçalhos, com corpo vazio.

Os casos de T-03, T-04 e T-07 passam, nos modos `web` e `node`.
**Arquivos:** `src/utils/static.ts`

---

### T-13 — Revisão final: regressão, exports, documentação e cobertura

**Cobre:** RF-08, RF-09, RF-10
**Depende de:** T-12
**Aceite:**
- `pnpm vitest run test/static.test.ts test/unit/package.test.ts test/security.test.ts` passa, e os testes existentes de `test/static.test.ts` não foram alterados (diff confirma);
- `pnpm test` (lint, typecheck e cobertura) passa;
- a lista de exports de `src/index.ts` e dos entries de plataforma é idêntica à de T-01 (RF-09);
- JSDoc de `StaticAssetMeta.size` registra que o tamanho deve corresponder aos bytes servidos (Risco 2 do techspec);
- o resumo da entrega informa que `src/utils/static.ts` ficou com aproximadamente 450 linhas, acima da convenção de `AGENTS.md`, conforme D-01 e Risco 6.
**Arquivos:** `src/utils/static.ts` (JSDoc), `test/static.test.ts` (somente verificação)
