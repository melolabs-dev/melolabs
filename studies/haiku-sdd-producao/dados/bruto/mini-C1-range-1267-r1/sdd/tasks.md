# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-11, seção 5 para a ordem de testes).

Ordem geral: testes primeiro (T-01 a T-05, devem falhar antes da implementação), depois implementação (T-06 a T-08), depois exports e verificação final (T-09 e T-10).

**Decisões assumidas (confirmar antes de T-06):** anúncio de `Accept-Ranges` só com `size` numérico (RF-01, techspec D-03) e aceitação das formas `a-` e `-n` (RF-02, techspec D-02). Se alguma for rejeitada, T-02, T-03 e T-06 mudam.

---

### T-01 — Testes de `Accept-Ranges` e de requisições sem `Range`

**Cobre:** RF-01, RF-08

**Depende de:** nenhuma

**Aceite:** em `describeMatrix("serve static range", ...)` existem casos que verificam: `GET` e `HEAD` sem `Range` retornam `200`, `accept-ranges: bytes` e corpo completo (`HEAD` sem corpo); asset sem `size` não recebe `accept-ranges` e `Range` é ignorado (`200` completo); `fallthrough: true` com asset inexistente e `Range` devolve `undefined`; `POST` com `Range` continua `405` com `allow: GET, HEAD`. Rodando `pnpm vitest run test/static.test.ts`, os casos de `accept-ranges` falham antes da implementação e os de fallthrough e 405 passam. Asset de referência: 1000 bytes com conteúdo `"0123456789".repeat(100)`.

**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes de respostas `206` (formas de intervalo, `HEAD`, encoding)

**Cobre:** RF-02, RF-03

**Depende de:** T-01

**Aceite:** casos para `bytes=0-499` (`206`, `content-range: bytes 0-499/1000`, `content-length: 500`, corpo exato); `bytes=-100` (`bytes 900-999/1000`, `content-length: 100`); `bytes=500-` (`bytes 500-999/1000`); `bytes=-5000` e `bytes=0-5000` (arquivo inteiro, `206`, `content-length: 1000`); `HEAD` com `bytes=500-` (mesmos cabeçalhos, corpo vazio); `accept-encoding: gzip` com variante `.gz` de tamanho diferente (`content-range` e `content-length` usam o tamanho do `.gz`, o que também cobre a ordem do `mergeHeaders`, D-05). Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

---

### T-03 — Testes de `200` para `Range` ignorado e de `416`

**Cobre:** RF-04, RF-05

**Depende de:** T-01

**Aceite:** casos com `200` completo e sem `content-range` para `bytes=0-1,5-9` (múltiplos intervalos), `itens=0-9` (unidade diferente), `bytes=abc` (sintaxe inválida) e `bytes=5-2` (intervalo invertido); casos com `416`, `content-range: bytes */1000` e `content-length: 0` para `bytes=1000-1500` e `bytes=-0`, com `getContents` (`vi.fn`) não chamado; asset com `size: 0` e `Range: bytes=0-9` retorna `416` com `bytes */0`. Cada caso de `it.each` ou `for` tem mensagem própria.

**Arquivos:** `test/static.test.ts`

---

### T-04 — Testes de `If-Range` e de precedência do `304`

**Cobre:** RF-06, RF-07

**Depende de:** T-01

**Aceite:** `If-Range: "abc"` com ETag forte `"abc"` retorna `206`; `If-Range: "xyz"` retorna `200` completo; `If-Range: W/"abc"` retorna `200` mesmo com ETag servido igual (ETag fraca nunca casa; usar `W/"..."` explícito); `If-Range` com data igual ao `last-modified` servido retorna `206`, e data diferente ou inválida retorna `200`; `If-None-Match: "abc"` com `Range: bytes=0-9` retorna `304` sem corpo e `getContents` não chamado. Os casos falham antes da implementação.

**Arquivos:** `test/static.test.ts`

---

### T-05 — Testes de corpo por tipo (`string`, `Blob`, `ReadableStream`)

**Cobre:** RF-02, RF-10

**Depende de:** T-01

**Aceite:** um caso para cada tipo de retorno de `getContents` (`string`, `Blob`, `ReadableStream<Uint8Array>`) com `bytes=450-549`, comparando com `body.slice(450, 550)`; para o stream, o chunk de 300 bytes faz o corte cair no meio de um chunk; para o stream de 1000 bytes com `bytes=0-9`, o `cancel` da origem é chamado (prova de que não se drena tudo, techspec D-08). O stream é criado a cada chamada de `getContents`.

**Arquivos:** `test/static.test.ts`

---

### T-06 — Anúncio `Accept-Ranges`, parse de `Range` e respostas `416`/`206` em `serveStatic`

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

**Depende de:** T-01, T-02, T-03

**Aceite:** os casos de T-01, T-02 e T-03 passam em `web` e `node`, exceto os de `If-Range` e de `304`, que são de T-07. Em `src/utils/static.ts`, `parseRange` e os helpers privados ficam no fim do arquivo; nada novo é exportado. `event.res.headers` recebe `accept-ranges`, `content-range` e `content-length` do trecho antes de montar o `HTTPResponse`. `HEAD` com `206` não chama `getContents`. `pnpm vitest run test/static.test.ts` passa para os casos desta tarefa.

**Arquivos:** `src/utils/static.ts`

---

### T-07 — `If-Range` e ordem do `304` antes de `Range`

**Cobre:** RF-06, RF-07

**Depende de:** T-04, T-06

**Aceite:** `ifRangeMatches` compara entity-tag só com ETag forte servido, byte a byte, sem usar `matchETag` de `src/utils/internal/cache.ts`; compara data com `last-modified` servido em segundos, via `getTime()` após truncamento; `If-Range` sem `Range` é ignorado. Os casos de T-04 passam nos dois alvos. O `304` continua sendo devolvido antes da avaliação de `Range` (techspec D-04).

**Arquivos:** `src/utils/static.ts`

---

### T-08 — Fatiamento do corpo sem ler mais do que o necessário

**Cobre:** RF-02, RF-10

**Depende de:** T-05, T-06

**Aceite:** `sliceContents` trata `Blob` com `slice`, `ReadableStream` com `sliceStream` (descarta `start` bytes, emite `length`, chama `cancel` ao terminar) e os demais `BodyInit` com `new Response(contents).blob()` seguido de `slice`. `null` ou `undefined` de `getContents` no caminho `206` devolvem `HTTPResponse(null, { status: 200 })`, como hoje (techspec D-07). Os casos de T-05 passam nos dois alvos, incluindo o `cancel` da origem.

**Arquivos:** `src/utils/static.ts`

---

### T-09 — Exports inalterados e JSDoc de `serveStatic`

**Cobre:** RF-09

**Depende de:** T-07, T-08

**Aceite:** `pnpm vitest run test/unit/package.test.ts` passa sem atualizar o snapshot de exports (a lista de `src/index.ts` e dos subcaminhos é idêntica à anterior). `ServeStaticOptions`, `StaticAssetMeta`, `getMeta` e `getContents` mantêm a mesma assinatura. A JSDoc de `serveStatic` ganha um parágrafo curto sobre `Range` (techspec D-11), sem documentação extensa.

**Arquivos:** `src/utils/static.ts`, `test/unit/package.test.ts` (somente leitura, sem alteração)

---

### T-10 — Verificação de regressão e de qualidade

**Cobre:** RF-08, RF-10

**Depende de:** T-09

**Aceite:** `pnpm vitest run test/static.test.ts test/security.test.ts test/rules/cache.test.ts` passa sem alterar testes existentes, incluindo `"does not overwrite a content-length already set on the response"` (`test/static.test.ts:600-617`). `pnpm lint` e `pnpm typecheck` passam. `pnpm test` (suíte completa com cobertura) passa. Se algum teste existente precisar de ajuste, o ajuste é mínimo e registrado na descrição da entrega.

**Arquivos:** `test/static.test.ts`, `src/utils/static.ts` (somente correções pontuais, se necessárias)
