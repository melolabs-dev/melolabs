# Tarefas — HTTP Range em `serveStatic`

**Fontes:** `sdd/prd.md` (RF-01 a RF-15) e `sdd/techspec.md` (D-01 a D-09).

**Regras gerais**

- Cada tarefa é verificada com `pnpm vitest run <arquivo>` nos alvos `web` e `node` (describeMatrix).
- Seguir o Bug Fix Workflow do AGENTS.md: o teste vem antes da implementação, e a falha é confirmada antes de codar.
- Tarefas que tocam o mesmo arquivo estão encadeadas em "Depende de", para não haver edições concorrentes.

**Trilhas**

- Trilha A (módulo `src/utils/internal/range.ts`): T-01 a T-08.
- Trilha B (testes de integração em `test/static-range.test.ts`): T-09 a T-16. Pode rodar em paralelo com a trilha A.
- Trilha C (`src/utils/static.ts`): T-17 a T-21. Converge com as trilhas A e B.
- Fechamento: T-22.

---

## Trilha A — módulo interno de Range

### T-01 — Esqueleto de `src/utils/internal/range.ts`

**Cobre:** RF-12
**Depende de:** nenhuma
**Aceite:** o arquivo exporta `ParsedRange`, `parseRange`, `matchIfRange` e `sliceBody` com as assinaturas da techspec (seção "Contratos e assinaturas"). O corpo das funções é provisório e lança `Error("not implemented")`. `pnpm lint` passa (inclui typecheck e formatação). `pnpm vitest run test/unit/package.test.ts` passa sem alterar o snapshot de exports.
**Arquivos:** `src/utils/internal/range.ts`

### T-02 — Testes unitários de `parseRange`

**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-01
**Aceite:** `test/unit/range.test.ts` tem um caso para cada uma das 18 linhas da tabela de `parseRange` da techspec (size = 1000, salvo indicação). Com o esqueleto, os testes falham; a falha é confirmada no output antes da T-03.
**Arquivos:** `test/unit/range.test.ts`

### T-03 — Implementar `parseRange`

**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-02
**Aceite:** `pnpm vitest run test/unit/range.test.ts -t parseRange` passa. A ordem de verificações de D-02 é respeitada: `bytes=1000-100` com size 500 devolve `undefined`, não 416. O regex é `/^bytes\s*=\s*(\d*)-(\d*)$/i` sobre o cabeçalho com `trim()`.
**Arquivos:** `src/utils/internal/range.ts`

### T-04 — Testes unitários de `matchIfRange`

**Cobre:** RF-06
**Depende de:** T-03
**Aceite:** em `test/unit/range.test.ts`, há casos para: `null` → true; ETag forte igual → true; ETag forte diferente → false; `W/` no pedido → false; `W/` no asset → false; `W/` nos dois lados → false; data igual a `lastModified` → true; data diferente → false; data inválida → false; data sem `lastModified` → false; ETag no pedido sem `etag` no asset → false. Os casos falham com a implementação atual.
**Arquivos:** `test/unit/range.test.ts`

### T-05 — Implementar `matchIfRange`

**Cobre:** RF-06
**Depende de:** T-04
**Aceite:** o bloco de `matchIfRange` em `test/unit/range.test.ts` passa. A comparação é exata, em string, sem normalizar aspas (D-03). Não há mudança em `parseRange`.
**Arquivos:** `src/utils/internal/range.ts`

### T-06 — Testes unitários de `sliceBody`

**Cobre:** RF-09
**Depende de:** T-05
**Aceite:** `test/unit/range.test.ts` cobre: string `"ação"` com bytes 1-2 → `C3 A7`; `ArrayBuffer`; `Uint8Array` com `byteOffset` 4 e length 10 (o corte cai na janela certa); `DataView`; `Blob` (tamanho e bytes conferidos com `arrayBuffer()`); `null` e `undefined` → `undefined`; `FormData` e `URLSearchParams` → `undefined`. Os casos falham com a implementação atual.
**Arquivos:** `test/unit/range.test.ts`

### T-07 — Implementar `sliceBody` para os tipos que não são stream

**Cobre:** RF-09
**Depende de:** T-06
**Aceite:** o bloco de `sliceBody` passa, exceto o caso de `ReadableStream`, que fica com `throw` provisório até a T-08. Strings são codificadas em UTF-8 inteiras antes do corte. `ArrayBuffer.isView` usa `byteOffset` e `byteLength` (sem cópia). `Blob` usa `slice`.
**Arquivos:** `src/utils/internal/range.ts`

### T-08 — `sliceStream` com leitura preguiçosa e parada antecipada

**Cobre:** RF-10
**Depende de:** T-07
**Aceite:** em `test/unit/range.test.ts`, com origem de chunks de 64 KB que contam os chunks entregues: (a) `[0, 99]` entrega 100 bytes, e a origem entrega no máximo 1 chunk; (b) um intervalo que cruza a fronteira de dois chunks entrega os bytes corretos; (c) origem menor que o intervalo termina sem erro; (d) `cancel` do stream de saída propaga para a origem. A implementação segue D-08, com `highWaterMark: 0` no stream de saída. `toUint8Array` aceita `Uint8Array`, `ArrayBuffer`, views e `string`.
**Arquivos:** `src/utils/internal/range.ts`, `test/unit/range.test.ts`

---

## Trilha B — testes de integração

Todos os testes desta trilha ficam em `test/static-range.test.ts`, com `describeMatrix`, asset fixo de 1000 bytes (ETag `"abc"` e `last-modified` fixo, salvo indicação) e `getContents` que conta chamadas. Os cenários de 206 e 416 falham até a trilha C. Os cenários de 200 sem `Range`, 405 e 304 já passam com o código atual e servem de guarda de regressão.

### T-09 — Integração: 200 e 206 básicos

**Cobre:** RF-01, RF-03, RF-05
**Depende de:** nenhuma
**Aceite:** GET e HEAD sem `Range` → 200 com `accept-ranges: bytes` e `content-length: 1000`. `bytes=100-199` → 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo = bytes 100 a 199. `bytes=900-` → 900-999. `bytes=-100` → 900-999. `bytes=-5000` → 0-999 com `content-length: 1000`. `bytes=0-5000` → 0-999. `HEAD bytes=0-99` → 206 com corpo vazio e `getContents` não chamado.
**Arquivos:** `test/static-range.test.ts`

### T-10 — Integração: 416

**Cobre:** RF-04, RF-05
**Depende de:** T-09
**Aceite:** `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. `bytes=1000-` → 416. `bytes=-0` → 416. Asset de size 0 com `bytes=0-` → 416 com `content-range: bytes */0`. `HEAD bytes=1000-` → 416 sem corpo e sem chamar `getContents`.
**Arquivos:** `test/static-range.test.ts`

### T-11 — Integração: `Range` ignorado e método

**Cobre:** RF-02, RF-11
**Depende de:** T-10
**Aceite:** `bytes=0-1,5-6`, `items=0-9`, `bytes=5-2`, `bytes=abc`, `bytes=-` e `bytes=` → 200 com corpo completo e sem `content-range`. Asset com `meta.size` indefinido e `Range` → 200 sem `content-length` e sem `content-range`. `POST` com `Range` → 405 com `allow: GET, HEAD`.
**Arquivos:** `test/static-range.test.ts`

### T-12 — Integração: `If-Range` e 304

**Cobre:** RF-06, RF-07
**Depende de:** T-11
**Aceite:** `If-Range: W/"abc"` com ETag `"abc"` → 200 completo. `If-Range: "xyz"` → 200 completo. `If-Range: "abc"` → 206 com `content-range: bytes 0-99/1000`. Com ETag fraco no asset (`W/"abc"`) e `If-Range: W/"abc"` → 200 completo. `If-Range` com a data igual ao `Last-Modified` → 206. Com data diferente → 200. Com data inválida → 200. `If-None-Match: "abc"` + `Range: bytes=0-99` → 304, sem `content-range`, sem corpo, com `accept-ranges: bytes`.
**Arquivos:** `test/static-range.test.ts`

### T-13 — Integração: encoding e tipos de corpo

**Cobre:** RF-08, RF-09
**Depende de:** T-12
**Aceite:** com `encodings: { gzip: ".gz" }`, `app.js` de 1000 bytes e `app.js.gz` de 400 bytes, `Accept-Encoding: gzip` e `bytes=0-99` → 206, `content-range: bytes 0-99/400`, `content-length: 100`, `content-encoding: gzip` e `content-type: text/javascript`. A verificação do corpo fica restrita a `web` (`it.skipIf(ctx.target === "node")` ou `if` explícito), por causa do undici. O encoding do teste não é trocado. `getContents` devolve `"ação"` com `bytes=1-2` → 206 com corpo `C3 A7`. `getContents` devolve `FormData` com `Range` → 200 completo. `encodings: { gzip: ".gz" }` sem variante e com `Range` → 206 sobre o arquivo original.
**Arquivos:** `test/static-range.test.ts`

### T-14 — Integração: stream e Blob

**Cobre:** RF-10
**Depende de:** T-13
**Aceite:** `getContents` devolve `ReadableStream` de 10 MB, em chunks de 64 KB, com contador de chunks entregues. Com `bytes=0-99`, o corpo tem 100 bytes e o contador é no máximo 1. `getContents` devolve `Blob` com `bytes=10-19` → 206 com corpo de 10 bytes. Se algum runtime divergir, o teste registra a diferença sem mudar o critério (techspec, Riscos).
**Arquivos:** `test/static-range.test.ts`

### T-15 — Integração: `content-length` definido pelo chamador

**Cobre:** RF-15
**Depende de:** T-14
**Aceite:** `options.headers: { "content-length": "5" }` com `bytes=0-99` → 206 com `content-length: 100`. O mesmo com `event.res.headers.set("content-length", "5")` antes de `serveStatic` → 206 com `content-length: 100`. `options.headers: { "content-length": "5" }` com `bytes=1000-` → 416 com `content-length: 0`. Sem `Range` → 200 com `content-length: 5` (regra atual, sem sobrescrever).
**Arquivos:** `test/static-range.test.ts`

### T-16 — Integração: regressão sem `Range`

**Cobre:** RF-11
**Depende de:** T-15
**Aceite:** GET e HEAD sem `Range` mantêm status, cabeçalhos (`vary: accept-encoding`, `content-type`, `content-length`, `etag`, `last-modified`) e corpo iguais aos atuais. Os 304 por `If-None-Match` e `If-Modified-Since` continuam iguais. Asset ausente → 404 e `fallthrough` como hoje. Caminho não canônico continua rejeitado. Os casos passam com o código atual e devem continuar passando na T-22.
**Arquivos:** `test/static-range.test.ts`

---

## Trilha C — `serveStatic`

### T-17 — `accept-ranges: bytes` em todo asset encontrado

**Cobre:** RF-01
**Depende de:** T-09
**Aceite:** em `src/utils/static.ts`, `accept-ranges: bytes` é gravado com `if (!event.res.headers.has("accept-ranges"))`, depois do bloco de `etag` e antes de `isCacheMatch` (D-05). Os casos de `accept-ranges` de T-09 e T-12 passam. 404 e 405 não ganham o cabeçalho. `pnpm vitest run test/static.test.ts` passa.
**Arquivos:** `src/utils/static.ts`

### T-18 — Fluxo de `Range` em `serveStatic`: `resolveRange`, 200 e 416

**Cobre:** RF-02, RF-04, RF-06, RF-07
**Depende de:** T-03, T-05, T-10, T-11, T-12, T-17
**Aceite:** há uma função privada `resolveRange(event, size)` no fim de `src/utils/static.ts`, que chama `matchIfRange` com os validadores de `event.res.headers`. `size` indefinido faz `Range` ser ignorado. O ramo 416 grava `content-range: bytes */size` e `content-length: 0` com `event.res.headers.set`, devolve `HTTPResponse` 416 sem corpo, e não chama `getContents` em HEAD. Os cenários de 200, 304 e 416 de T-10, T-11 e T-12 passam. Os cenários de 206 continuam falhando até a T-19, o que é esperado nesta fase.
**Arquivos:** `src/utils/static.ts`

### T-19 — Ramo 206 em `serveStatic` (GET e HEAD)

**Cobre:** RF-03, RF-05, RF-09, RF-10
**Depende de:** T-07, T-08, T-14, T-18
**Aceite:** a função `partial` fica dentro de `serveStatic` e grava `content-range` e `content-length` com `event.res.headers.set` antes de devolver o `HTTPResponse` 206. Em GET, `getContents` é chamado uma vez e depois `sliceBody` é aplicado. Se `sliceBody` devolver `undefined` (ex.: `FormData`), o fallback é 200 completo, reaproveitando o `contents` já lido. Em HEAD, o 206 sai sem chamar `getContents`. Os cenários de T-09, T-10, T-12, T-13 e T-14 passam em `web` e `node`.
**Arquivos:** `src/utils/static.ts`

### T-20 — `content-length` do chamador em 206 e 416, e cabeçalhos de encoding

**Cobre:** RF-08, RF-15
**Depende de:** T-13, T-15, T-19
**Aceite:** 206 e 416 sobrescrevem `content-length` do chamador, seja de `options.headers` ou de `event.res.headers`, porque ele é gravado com `set` (D-04). Nenhum código chama `delete` em `content-length` (D-06). Em 200, a regra atual é mantida. `content-type` e `content-encoding` continuam no 206. Os cenários de T-13 e T-15 passam em `web` e `node`.
**Arquivos:** `src/utils/static.ts`

### T-21 — JSDoc de `serveStatic` (opcional)

**Cobre:** RF-14
**Depende de:** T-20
**Aceite:** o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) ganha um parágrafo sobre `GET` e `HEAD` com intervalo de bytes. Esse parágrafo também diz que `getContents` devolve a representação completa (premissa 2 do PRD). `pnpm fmt` roda sem erro. `git diff --stat` mostra `docs/2.utils/2.response.md` alterado apenas por essa mudança, e `pnpm lint` passa.
**Arquivos:** `src/utils/static.ts`, `docs/2.utils/2.response.md` (gerado pelo `pnpm fmt`)

---

## Fechamento

### T-22 — Verificação final

**Cobre:** RF-11, RF-12, RF-13, RF-14
**Depende de:** T-16, T-20, T-21
**Aceite:**

- `pnpm vitest run test/static-range.test.ts test/unit/range.test.ts` passa em `web` e `node`.
- `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` passa, com o snapshot de exports inalterado.
- `pnpm test` (lint, typecheck e coverage) passa.
- `git diff` não toca `src/index.ts`, `ServeStaticOptions` nem `package.json`.
- Cada cenário listado no RF-13 tem pelo menos um teste com nome correspondente.
- Qualquer ajuste em teste existente que envolvia `Range` está listado para o PR. A busca feita na techspec não encontrou nenhum.

**Arquivos:** nenhum (só verificação)

---

## Mapa de cobertura

| RF | Tarefas |
| --- | --- |
| RF-01 | T-09, T-17 |
| RF-02 | T-02, T-03, T-11, T-18 |
| RF-03 | T-02, T-03, T-09, T-19 |
| RF-04 | T-02, T-03, T-10, T-18 |
| RF-05 | T-09, T-10, T-19 |
| RF-06 | T-04, T-05, T-12, T-18 |
| RF-07 | T-12, T-18 |
| RF-08 | T-13, T-20 |
| RF-09 | T-06, T-07, T-13, T-19 |
| RF-10 | T-08, T-14, T-19 |
| RF-11 | T-11, T-16, T-22 |
| RF-12 | T-01, T-22 |
| RF-13 | T-09 a T-15, T-22 |
| RF-14 | T-21, T-22 |
| RF-15 | T-15, T-20 |
