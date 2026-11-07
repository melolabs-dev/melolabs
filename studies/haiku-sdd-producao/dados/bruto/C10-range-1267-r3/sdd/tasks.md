# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

- PRD: `sdd/prd.md` (RF-01 a RF-15)
- Especificação: `sdd/techspec.md` (D-01 a D-11, seções 5 e 6)

Regra de ordem: os testes vermelhos (T-01, T-03, T-05, T-06) vêm antes das implementações, como pede o `AGENTS.md` (fluxo de correção de bug). Tarefas sem dependência entre si podem rodar em paralelo: T-01, T-03, T-05 e T-06 são independentes. T-02 e T-04 tocam o mesmo arquivo (`src/utils/internal/range.ts`), por isso T-04 espera T-02.

Desvio da técnica: a techspec (seção 4) põe todos os testes HTTP em `test/static-range.test.ts`. Esta lista divide em dois arquivos (T-05 e T-06) para que as duas tarefas possam rodar em paralelo sem editar o mesmo arquivo.

---

### T-01 — Testes unitários de `parseRange` e `resolveByteRange` (vermelho)

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-11

Depende de: nenhuma

Aceite: `pnpm vitest run test/unit/range.test.ts` falha antes de T-02 (módulo ausente ou asserções falhando). Os casos cobrem:
- `parseRange`: as três formas (`bytes=10-19`, `bytes=90-`, `bytes=-10`); OWS (`bytes= 10 - 19 `); unidade em caixa alta (`BYTES=0-1`, D-02); malformados (`bytes=abc`, `bytes=`, `bytes=-`, `bytes=5-3`, `bytes=0-1,3-4`, `items=0-1`) retornam `undefined`.
- `resolveByteRange` sem `Range` retorna `undefined`; `size` `undefined`, `NaN`, negativo ou string retorna `undefined`.
- Limites: `bytes=90-999` em 100 bytes dá `{ start: 90, end: 99, size: 100 }`; `bytes=-500` dá `{ start: 0, end: 99, size: 100 }`.
- 416: `bytes=100-` e `bytes=-0` em 100 bytes; `bytes=0-` em 0 bytes.
- `If-Range`: `"v1"` igual ao etag confere; `"v0"` não confere; `W/"v1"` não confere; data igual ao `lastModified` confere; data diferente não confere; `1` (data inválida) não confere; `If-Range` sem `Range` não muda nada.

Arquivos: test/unit/range.test.ts

---

### T-02 — Implementar `parseRange`, `ifRangeMatches` e `resolveByteRange`

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-11

Depende de: T-01

Aceite: `pnpm vitest run test/unit/range.test.ts` passa para os casos de `parseRange` e `resolveByteRange`. `pnpm typecheck` não reporta erro no arquivo. Não há nenhum `export` novo além dos listados na techspec 5.1, e nada disso é reexportado por `src/index.ts`. O arquivo fica abaixo de 200 linhas (`AGENTS.md`). Seguir as seções 5.1 a 5.4 da techspec.

Arquivos: src/utils/internal/range.ts

---

### T-03 — Testes unitários de `sliceBody` e `sliceStream` (vermelho)

Cobre: RF-12

Depende de: nenhuma

Aceite: `pnpm vitest run test/unit/range-slice.test.ts` falha antes de T-04. Os casos cobrem:
- `string` com caracteres não ASCII (ex.: `"é"` ocupa 2 bytes): a fatia é em bytes UTF-8, não em caracteres (D-07).
- `Uint8Array` com `byteOffset` diferente de zero, para garantir que a fatia respeita o offset da view.
- `ArrayBuffer`, `Blob` (e `File`) fatiados corretamente.
- `ReadableStream` com chunks de tamanhos irregulares, com a faixa cruzando a fronteira de chunk, incluindo faixa dentro de um único chunk (D-08).
- `ReadableStream`: após chegar em `end`, a origem recebe `cancel()`, e `cancel(reason)` do stream novo é repassado à origem (D-08).
- `null`, `undefined` e `FormData` retornam `undefined` (D-07).

Arquivos: test/unit/range-slice.test.ts

---

### T-04 — Implementar `sliceBody` e `sliceStream`

Cobre: RF-12

Depende de: T-02, T-03

Aceite: `pnpm vitest run test/unit/range-slice.test.ts` passa. `pnpm vitest run test/unit/range.test.ts` continua passando. Seguir a tabela de D-07 e o algoritmo de D-08. Se o `tsc` reclamar do tipo de `ReadableStream`, usar o tipo mais estreito que ele aceite, sem `any`, e registrar no PR (techspec riscos 8).

Arquivos: src/utils/internal/range.ts

---

### T-05 — Testes HTTP de `serveStatic` para anúncio, `206`, `416`, `If-Range`, `304` e `HEAD` (vermelho)

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-13

Depende de: nenhuma

Aceite: `pnpm vitest run test/static-range.test.ts` falha antes de T-07 nos casos de faixa (`200` no lugar de `206`, ausência de `accept-ranges`). Os casos de preservação (`405` para `POST` com `Range`, `404` para asset inexistente, `fallthrough`) podem já passar. O arquivo usa `describeMatrix` e roda em `web` e `node`. Casos:
- `accept-ranges: bytes` em `200`, `206`, `416` e `HEAD`; `options.headers` com `accept-ranges: none` vence.
- `bytes=10-19`, `bytes=90-`, `bytes=-10` em 100 bytes dão `206` com o corpo certo; `bytes= 10 - 19 ` dá `206`.
- Malformados dão `200` completo sem `content-range`.
- `bytes=90-999` dá `bytes 90-99/100`; `bytes=-500` dá `bytes 0-99/100`.
- `bytes=100-` e `bytes=-0` dão `416` com `content-range: bytes */100`, `content-length: 0` e corpo vazio; asset de 0 bytes com `bytes=0-` dá `416` com `bytes */0`.
- `If-Range`: `"v1"` dá `206`; `"v0"` dá `200`; `W/"v1"` dá `200`; data igual ao `last-modified` dá `206`; data diferente dá `200`; `If-Range` sem `Range` dá `200`.
- `If-None-Match: "v1"` com `Range` dá `304` sem corpo.
- `HEAD` com `Range` dá `206` com `content-range` e `content-length` da faixa e corpo vazio; `HEAD` insatisfazível dá `416`.
- `POST` com `Range` dá `405` com `allow: GET, HEAD`; asset inexistente com `Range` dá `404`.

Arquivos: test/static-range.test.ts

---

### T-06 — Testes HTTP de `serveStatic` para encoding, tamanho desconhecido, tipos de corpo e `content-length` do app (vermelho)

Cobre: RF-10, RF-11, RF-12

Depende de: nenhuma

Aceite: `pnpm vitest run test/static-range-body.test.ts` falha antes de T-07 nos casos de faixa; o caso de `FormData` e o de tamanho desconhecido já passam hoje (`200`). O arquivo usa `describeMatrix`. Casos:
- Encoding: `app.js` com 100 bytes e `app.js.gz` com 40 bytes, `encodings: { gzip: ".gz" }`, `Accept-Encoding: gzip`, `bytes=0-9` dá `206`, `content-encoding: gzip`, `bytes 0-9/40`, corpo = 10 primeiros bytes de `.gz`.
- Tamanho desconhecido: `getMeta` sem `size` dá `200` sem `content-range`; `size` do tipo string dá `200`.
- Mesmo conteúdo de 100 bytes como `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` (chunks irregulares); `bytes=20-29` dá `206` com os bytes 20 a 29 em cada caso.
- `getContents` devolve `FormData` com `Range` dá `200` completo (D-07).
- `options.headers: { "content-length": "999" }` com `Range` dá `206` com `content-length` da faixa (D-06).

Arquivos: test/static-range-body.test.ts

---

### T-07 — Integrar `Range` em `serveStatic`

Cobre: RF-01, RF-04, RF-06, RF-08, RF-09, RF-10, RF-13

Depende de: T-02, T-04, T-05, T-06

Aceite: `pnpm vitest run test/static-range.test.ts` e `pnpm vitest run test/static-range-body.test.ts` passam em `web` e `node`. Aplicar exatamente a techspec 5.5:
- (a) `accept-ranges` antes do bloco de cache;
- (b) bloco de faixa entre `content-length` e o `HEAD`, com `416`, `206` e `200` (D-03, D-09);
- (c) `setPartialHeaders` privada no fim do arquivo, depois de `idSearchPaths`;
- (d) import de `./internal/range.ts`.
Não alterar as linhas de `ServeStaticOptions` nem `StaticAssetMeta` (RF-14). O arquivo passa de 350 linhas, o que a techspec já aceita (riscos 7): registrar no PR.

Arquivos: src/utils/static.ts

---

### T-08 — Rodar a suíte existente de `serveStatic` e ajustar só o que quebrar

Cobre: RF-13

Depende de: T-07

Aceite: `pnpm vitest run test/static.test.ts` passa em `web` e `node`. Se algum teste quebrar, ajustar apenas a asserção afetada, sem remover o que ela verifica (PRD RF-13). Se nada quebrar, a tarefa termina sem alteração no arquivo, e isso deve ser dito no PR.

Arquivos: test/static.test.ts (somente se algum teste quebrar)

---

### T-09 — Verificar superfície pública e build

Cobre: RF-14

Depende de: T-07

Aceite:
- `git diff -- src/index.ts` está vazio.
- `git diff -- src/utils/static.ts` não mexe nas linhas de `StaticAssetMeta`, `ServeStaticOptions` nem nas assinaturas de `getMeta`, `getContents` e `serveStatic`.
- `pnpm build` termina sem erro, e `dist/_entries/*.d.mts` não contém nomes novos de `src/utils/internal/range.ts` (`parseRange`, `resolveByteRange`, `sliceBody`, `sliceStream`, `ByteRange`).

Arquivos: nenhum (tarefa de verificação; só lê o diff e o `dist`)

---

### T-10 — Verificação final: lint, typecheck, suíte completa e cobertura

Cobre: RF-15

Depende de: T-08, T-09

Aceite:
- `pnpm lint` passa.
- `pnpm typecheck` passa.
- `pnpm test` passa, em `web` e `node`.
- Cobertura de linhas de `src/utils/internal/range.ts` próxima de 100% pelos testes HTTP e unitários; os ramos de `sliceStream` (chunk antes da faixa, chunk que cruza `end`, cancelamento) aparecem no relatório.
- No PR, citar as decisões D-01 (helpers em `utils/internal/`), D-05 (`accept-ranges` também em `304`), D-11 (cache próprio do usuário sem proteção) e a riscos 3 (`string` com caracteres não ASCII).

Arquivos: nenhum (só comandos de verificação; corrigir lint ou tipo apenas nos arquivos já listados nas tarefas anteriores)
