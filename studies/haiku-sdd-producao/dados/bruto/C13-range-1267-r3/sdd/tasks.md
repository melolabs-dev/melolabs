# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08, R-1 a R-8).

Ordem: primeiro os testes, que precisam falhar antes do código (fluxo de correção do `AGENTS.md`). Depois os helpers, o bloco em `serveStatic` e, por fim, a verificação.

### T-01 — Testes de Range para os requisitos principais

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10

**Depende de:** nenhuma

**Aceite:**
- Existe `describeMatrix("serve static range", ...)` em `test/static.test.ts`, rodando em `web` e `node`.
- Fixture: `getContents` devolve `"0123456789"`, `getMeta` devolve `size: 10`, `etag: '"abc"'` e `mtime` fixo.
- Casos conforme a tabela da techspec (seção "Estratégia de testes"): `bytes=2-5`, `bytes=7-`, `bytes=-3`, `bytes=8-100`, `bytes=-100`, `HEAD` com `Range`, `bytes=10-20`, `bytes=-0`, `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2`, `BYTES=0-1`, `If-Range` (ETag forte, fraca e data), `If-None-Match` + `Range`, `getMeta` sem `size`, asset inexistente com `fallthrough` desligado, `POST` com `405`.
- Antes de qualquer mudança em `src/`, `pnpm vitest run test/static.test.ts` falha nos casos de RF-01, RF-02, RF-03, RF-04, RF-05 e RF-07 (caso `206`). Os casos de RF-06, RF-08, RF-09 e RF-10 passam, porque são guardas do comportamento atual.
- O registro dessa execução (quais falharam e quais passaram) fica na descrição do PR.

**Arquivos:** `test/static.test.ts`

### T-02 — Testes de casos de borda: encoding, corte em bytes, stream, Blob e tamanho zero

**Cobre:** RF-02, RF-03, RF-10

**Depende de:** T-01

**Aceite:**
- Em `test/static.test.ts`, dentro do mesmo `describeMatrix`:
  - `GET /app.js` com `accept-encoding: gzip` e `Range` → `206`, bytes do variante `.gz` e `content-encoding: gzip`.
  - String `"açaí"` com intervalo que cai no meio de um caractere multibyte → corte em bytes UTF-8.
  - `ReadableStream` com chunks `"01"`, `"2345"`, `"6789"` e intervalo que cruza início e fim do trecho.
  - `Blob` com intervalo.
  - `options.headers: { "content-length": "999" }` + `Range` → `206` com o tamanho do trecho.
  - Arquivo de tamanho `0` + qualquer intervalo → `416` com `bytes */0`.
  - `getContents` devolvendo `undefined` + `Range` → `200` sem `Content-Range`.
- Os testes novos que dependem da implementação falham antes de T-06 e T-07. Os de guarda (sem `Range`, encoding atual) passam.

**Arquivos:** `test/static.test.ts`

### T-03 — Garantir que a lista de exportações é comparada por inteiro

**Cobre:** RF-11

**Depende de:** nenhuma

**Aceite:**
- `test/unit/package.test.ts` compara a lista inteira de exportações de `src/index.ts` (não só a presença de `serveStatic`). Ajustar apenas se o teste atual não comparar a lista toda.
- `pnpm vitest run test/unit/package.test.ts` passa sem mudança em `src/index.ts`.
- `git diff -- src/index.ts` não mostra alteração ao final da entrega.

**Arquivos:** `test/unit/package.test.ts`, `src/index.ts` (somente leitura, para conferência)

### T-04 — Helpers `parseRange` e `isIfRangeMatch`

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07

**Depende de:** T-01

**Aceite:**
- Em `src/utils/static.ts`, depois do marcador `// --- Internal Utils ---`, sem `export`:
  - `parseRange(header, size)` retorna `ByteRange`, `"unsatisfiable"` ou `undefined`, seguindo a tabela D-02 da techspec. A unidade é comparada sem diferenciar maiúsculas.
  - `isIfRangeMatch(value, { etag, mtime })` aceita ETag forte igual a `etag` byte a byte e data igual a `mtime`. ETag com `W/` nunca corresponde.
- Os dois helpers ficam no próprio arquivo, sem nova dependência.
- Nenhuma linha nova em `src/index.ts`.

**Arquivos:** `src/utils/static.ts`

### T-05 — Helper `sliceBody`

**Cobre:** RF-02, RF-03, RF-04

**Depende de:** T-01

**Aceite:**
- `sliceBody(body, range)` em `src/utils/static.ts`, sem `export`, tratando os tipos da tabela D-04:
  - `string` → `TextEncoder` e corte do `Uint8Array`.
  - `ArrayBuffer` e `ArrayBufferView` → `subarray`.
  - `Blob` → `slice(start, end + 1)`.
  - `ReadableStream` → novo stream que descarta os bytes antes de `start`, repassa até `end` e cancela a origem ao terminar (R-2).
  - Demais tipos → `new Response(body).arrayBuffer()` e corte do resultado.
- Os casos de corte em T-02 passam quando o bloco de T-07 estiver integrado.

**Arquivos:** `src/utils/static.ts`

### T-06 — Integrar Range em `serveStatic`

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-07, RF-08, RF-09, RF-10

**Depende de:** T-04, T-05

**Aceite:**
- Bloco novo em `src/utils/static.ts`, entre `content-length` e o retorno de `HEAD`, na ordem da D-03 da techspec:
  - `accept-ranges: bytes` em `200`, `206` e `416` de `GET` e `HEAD`, mas não na `304`.
  - `If-Range` avaliado só quando há `Range` (D-06).
  - `Range` ignorado quando `meta.size` é `undefined` (RF-09).
  - `416` com `content-range: bytes */{size}` e `content-length: 0`, sem `getContents`.
  - `206` com `content-range` e `content-length` do trecho, escritos em `event.res.headers` (D-05).
  - `HEAD` com intervalo válido: cabeçalhos de `206` e sem corpo, sem chamar `getContents` (D-07).
  - `GET` com intervalo válido: `getContents` chamado uma vez; se devolver `null` ou `undefined`, segue como `200` sem cabeçalhos de intervalo.
- `304` continua vencendo `Range` sem código novo (RF-08).
- `ServeStaticOptions`, `serveStatic(event, options)` e as exportações não mudam.
- Após T-06, `pnpm vitest run test/static.test.ts` passa nos casos de T-01 e T-02.

**Arquivos:** `src/utils/static.ts`

### T-07 — Ajustar testes existentes que dependam de `200` com `Range`

**Cobre:** RF-10

**Depende de:** T-06

**Aceite:**
- Se algum teste atual de `test/static.test.ts` esperava `200` ou um `Content-Length` fixo com `Range`, ajustar só esse caso, mantendo o que ele verifica (Riscos, item 4 do PRD).
- Os 76 testes de `test/static.test.ts` do baseline seguem passando, mais os novos.
- A alteração de cada teste existente é listada na descrição do PR.

**Arquivos:** `test/static.test.ts`

### T-08 — Medir custo de `206` em arquivo grande

**Cobre:** RF-02, RF-03

**Depende de:** T-06

**Aceite:**
- Medir arquivo de 50 MB com 100 requisições `206` seguidas (R-1 da techspec), com `pnpm bench:node` ou script local em `C:\Users\caiog\AppData\Local\Temp\claude\C--dev-runs-r14a2d37d00\815b9dce-b4b6-4fed-8364-74146f4b0600\scratchpad`, fora do projeto.
- O tempo e o pico de memória ficam registrados na descrição do PR. Não há meta de desempenho nova: o PRD aceita o custo e pede só a medição.

**Arquivos:** `src/utils/static.ts` (somente leitura), `test/bench/` (somente se um benchmark existente servir de modelo)

### T-09 — Verificação final e pendências

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11

**Depende de:** T-02, T-03, T-07, T-08

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa.
- `pnpm vitest run` (suíte completa) passa.
- `pnpm lint` e `pnpm typecheck` passam.
- `src/index.ts` sem diff (RF-11).
- Pendências P-1, P-2 e P-3 da techspec são respondidas ou levadas ao mantenedor antes do merge.

**Arquivos:** nenhum arquivo novo; checagem sobre `src/utils/static.ts`, `src/index.ts` e `test/`

## Pendências da techspec (não são tarefas de código)

- **P-1:** `src/utils/static.ts` vai passar de 200 LoC (AGENTS.md). Manter os helpers no arquivo, como pedem o PRD e a techspec, ou mover para `src/utils/internal/range.ts` sem exportação. Decidir antes de T-04.
- **P-2:** confirmar com o mantenedor que `Content-Length` de `options.headers` deixa de valer em respostas de intervalo (R-4). Antes do merge.
- **P-3:** a suíte com os testes novos ainda não foi executada. `pnpm lint` e `pnpm typecheck` também não. Ficam para T-01 e T-09.
