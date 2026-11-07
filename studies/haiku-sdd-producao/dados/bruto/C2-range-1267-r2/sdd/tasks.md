# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-09, premissas P-01 a P-05, riscos R-01 a R-06) e `sdd/techspec.md` (decisões D-01 a D-09, riscos R-01 a R-10).

Ordem de trabalho: primeiro os testes de regressão (T-01 a T-07), confirmando que falham pelo motivo esperado antes de qualquer mudança em `src/` (fluxo "Bug Fix Workflow" de `AGENTS.md`). Depois a implementação (T-08 a T-11). Por fim a verificação (T-12).

## Cobertura dos requisitos

| RF | Tarefas |
| --- | --- |
| RF-01 | T-01, T-08 |
| RF-02 | T-02, T-06, T-09, T-10, T-11 |
| RF-03 | T-03, T-09 |
| RF-04 | T-04, T-09 |
| RF-05 | T-05, T-09 |
| RF-06 | T-01, T-09 |
| RF-07 | T-01, T-06, T-10 |
| RF-08 | T-07, T-12 |
| RF-09 | T-01 a T-06, T-12 |

---

### T-01 — Testes de Accept-Ranges e precedência do cache

Cobre: RF-01, RF-06, RF-07
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Criar o `describeMatrix("serve static range requests", ...)` no fim do arquivo (após o último bloco, ver techspec, seção "Estratégia de testes"). Usar o asset determinístico: `body = "abcdefghij".repeat(100)`, `getMeta` retornando `{ size: 1000, etag: "abc", mtime: 1_700_000_000_000, type: "text/plain" }`, `getContents` retornando `body`.

Casos:
- GET sem Range: 200, `accept-ranges: bytes`, corpo completo.
- HEAD sem Range: 200, `accept-ranges: bytes`, sem corpo.
- GET com `If-None-Match: "abc"` e `Range: bytes=0-9`: 304, sem corpo, `accept-ranges` presente.
- POST com `Range: bytes=0-9`: 405 com `allow: GET, HEAD` (comportamento existente, serve de guarda).

Aceite: `pnpm vitest run test/static.test.ts -t "serve static range requests"` roda nos dois alvos (web e node). Os casos de GET/HEAD e 304 que verificam `accept-ranges` falham com a ausência do header. O caso de 405 já passa hoje e deve continuar passando.

---

### T-02 — Testes de 206 para intervalo válido

Cobre: RF-02
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Adicionar ao mesmo `describeMatrix` de T-01 os casos:
- `Range: bytes=100-199` em GET: 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo igual a `body.slice(100, 200)`.
- `Range: bytes=-50` em HEAD: 206, `content-range: bytes 950-999/1000`, `content-length: 50`, sem corpo, `getContents` não chamado.
- `Range: bytes=990-` em GET: 206, `bytes 990-999/1000`.
- `Range: bytes=900-5000` em GET: 206, `bytes 900-999/1000`.
- `Range: bytes=-5000` em GET: 206, `bytes 0-999/1000`, corpo inteiro.

Os corpos devem ser comparados com `res.arrayBuffer()` ou `res.text()` contra `body.slice(...)`.

Aceite: os casos falham com 200 (ou sem `content-range`) antes da implementação. Não confundir: os casos de GET com corpo dependem de T-10 para passar por completo.

---

### T-03 — Testes de 416 para intervalo não satisfazível

Cobre: RF-03
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Adicionar ao mesmo `describeMatrix`:
- `Range: bytes=1000-1100` em GET: 416, `content-range: bytes */1000`, `content-length: 0`, sem corpo.
- `Range: bytes=-0` em GET: 416 (sufixo de comprimento zero, D-03).

Aceite: os casos falham com 200 antes da implementação.

---

### T-04 — Testes de Range ignorado (malformado, outra unidade, multi-range)

Cobre: RF-04
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Adicionar ao mesmo `describeMatrix`, todos em GET, todos esperando 200 completo e sem `content-range`:
- `Range: bytes=0-9,20-29` (multi-range, D-03).
- `Range: itens=0-9` (outra unidade).
- `Range: bytes=5-2` (intervalo invertido).
- `Range: bytes=-` e `Range: bytes=abc` (malformados).

Aceite: os casos passam já hoje, porque o comportamento atual é ignorar `Range`. São guardas de regressão e devem continuar passando após a implementação. Registrar isso na descrição do PR.

---

### T-05 — Testes de If-Range

Cobre: RF-05
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Adicionar ao mesmo `describeMatrix`, em GET com `Range: bytes=0-9`:
- `If-Range: "xyz"` com etag `"abc"`: 200 completo.
- `If-Range: "abc"`: 206, `bytes 0-9/1000`, corpo `body.slice(0, 10)`.
- Meta com etag fraca (`etag: 'W/"abc"'`) e `If-Range: W/"abc"`: 200 completo (ETag fraca nunca satisfaz If-Range, D-04 e R-03).
- `If-Range` igual à data de `last-modified` (`new Date(1_700_000_000_000).toUTCString()`): 206.
- `If-Range` com data diferente: 200 completo.

Aceite: os casos de 206 falham antes da implementação. Os casos de 200 passam já hoje e devem continuar passando.

---

### T-06 — Testes de corpo: encoding, tipos de BodyInit, ReadableStream, size ausente e headers do usuário

Cobre: RF-02, RF-07
Depende de: nenhuma
Arquivos:
- `test/static.test.ts`

Adicionar ao mesmo `describeMatrix`:
- Variante `.gz` aceita pelo cliente (`accept-encoding: gzip`) com `Range: bytes=0-9`: 206, `content-encoding: gzip`, `content-range` calculado sobre o tamanho do `.gz` (RF-07, D-02 e `meta.size` por variante).
- Recorte exato de corpo `string`, `ArrayBuffer`, `Uint8Array` e `Blob` (D-05).
- `ReadableStream` entregue em pedaços de 7 bytes, com um intervalo que cruza pedaços e outro que começa e termina no limite de um pedaço (D-05).
- `ReadableStream` com `cancel` espionado: a origem é cancelada após `end`, sem ser lida até o fim (D-05 e R-01).
- Corpo não suportado (`URLSearchParams`) com Range: 200 completo (D-05).
- `size` ausente, e `size: 0`, com Range: 200 completo, sem `content-range` (D-06, P-01).
- `options.headers` com `content-length: 999` e um Range válido: o `content-length` do 206 é o do intervalo (D-07 e R-08).

Aceite: os casos de 206 falham antes da implementação. Os casos de `URLSearchParams`, `size` ausente/zero passam já hoje. Se o time decidir pelo comportamento do PRD para `ReadableStream` (R-01, `200` completo), o caso de stream deve ser reescrito antes do merge.

---

### T-07 — Verificação da superfície pública

Cobre: RF-08
Depende de: nenhuma
Arquivos:
- `test/unit/package.test.ts` (somente verificação, sem alteração)
- `src/index.ts` (somente verificação, sem alteração)

Confirmar que a lista de exportações em `test/unit/package.test.ts` (linha 133, `serveStatic`) passa sem alteração e que `src/index.ts` não muda. Nenhuma função auxiliar, tipo ou valor novo pode ser exportado.

Aceite: `pnpm vitest run test/unit/package.test.ts` passa. `git diff -- src/index.ts test/unit/package.test.ts` não mostra alterações.

---

### T-08 — Anunciar `Accept-Ranges: bytes`

Cobre: RF-01
Depende de: T-01
Arquivos:
- `src/utils/static.ts`

Adicionar `event.res.headers.set("accept-ranges", "bytes")` logo após a definição de `etag` (`src/utils/static.ts:239-241`) e antes do bloco de cache, para que o header esteja presente em 200, 206, 416 e 304 (D-08 e R-10).

Aceite: os casos de `accept-ranges` de T-01 passam. Os demais casos de T-01 continuam passando.

---

### T-09 — Resolução de Range: parse, If-Range, 416 e 206 sem corpo

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06
Depende de: T-02, T-03, T-04, T-05, T-08
Arquivos:
- `src/utils/static.ts`

Implementar, como funções privadas no fim do arquivo, na seção `// --- Internal Utils ---`:
- `parseRange` com a expressão `/^bytes=(\d*)-(\d*)$/i` e as regras de D-03 (multi-range, unidade diferente, campos vazios e intervalo invertido são ignorados; `bytes=-0` é não satisfazível).
- `ifRangeMatches` com as regras de D-04 (ETag forte por igualdade exata; data por `mtime` truncado em segundos; sem validadores nunca casa).
- `resolveByteRange` com a tabela de cálculo do techspec (undefined, `"unsatisfiable"` ou `ByteRange`), com `size` zero ou ausente retornando `undefined` (D-06).
- `partialResponse`, que define `content-range` e `content-length` com `set` (D-07) e devolve `HTTPResponse` com status 206 e texto `Partial Content`.

Integrar em `serveStatic` na ordem de D-02: após o bloco de cache (304, `src/utils/static.ts:243-248`) e depois de `content-length` (`src/utils/static.ts:268-270`). A resposta 416 usa `content-range: bytes */<size>`, `content-length: 0` e texto `Range Not Satisfiable` (D-09). Para HEAD com intervalo válido, responder 206 sem chamar `getContents` (`src/utils/static.ts:272-274`). Para GET, o corpo recortado entra na tarefa T-10; nesta tarefa o GET pode responder 200 completo quando não há recorte.

Incluir um comentário de bloco acima de `resolveByteRange` explicando a regra de If-Range e o motivo de ignorar multi-range, no estilo dos comentários de `src/utils/static.ts:124-169`.

Aceite: `pnpm vitest run test/static.test.ts -t "serve static range requests"` passa para os casos de 416 (T-03), de Range ignorado (T-04), de If-Range (T-05), de 304 e de HEAD (T-01 e T-02). Os casos de GET com corpo de T-02 só passam depois de T-10.

---

### T-10 — Recorte do corpo por tipo de `BodyInit`

Cobre: RF-02, RF-07
Depende de: T-06, T-09
Arquivos:
- `src/utils/static.ts`

Implementar as funções privadas `sliceBody` e `sliceStream` (D-05):
- `string`: `new TextEncoder().encode(body).subarray(start, end + 1)`.
- `ArrayBuffer` ou `ArrayBufferView` (inclui `Uint8Array`): `new Uint8Array(buffer, offset, length).subarray(...)`, sem cópia.
- `Blob` (inclui `File`): `body.slice(start, end + 1)`, sem leitura.
- `ReadableStream`: `sliceStream` lê e descarta até `start`, enfileira `[start, end]` e cancela a origem ao passar de `end`.
- `null`, `undefined` e outros tipos: `undefined`, o que responde 200 completo.

No GET com intervalo válido, chamar `getContents` uma vez e usar `partialResponse` com o corpo recortado. Se `sliceBody` devolver `undefined`, responder 200 completo como hoje.

Aceite: todos os casos de GET com corpo de T-02 e T-06 passam em web e node. `pnpm vitest run test/static.test.ts` passa para o novo `describeMatrix`.

---

### T-11 — Documentar o contrato de `size` em `getMeta`

Cobre: RF-02
Depende de: T-09
Arquivos:
- `src/utils/static.ts`

Acrescentar, somente em comentário, no doc de `ServeStaticOptions.getMeta` (`src/utils/static.ts:18-25`), que `size` é o número de bytes do corpo devolvido por `getContents`. Para `string`, o tamanho é o de `TextEncoder`, e não `.length` (R-02 e techspec, seção "Riscos"). Não alterar tipos de `ServeStaticOptions` nem de `StaticAssetMeta` (RF-08).

Aceite: o comentário existe no doc de `getMeta`. `git diff` das linhas de `ServeStaticOptions` e `StaticAssetMeta` contém só comentários. `pnpm lint` passa.

---

### T-12 — Verificação final da suíte

Cobre: RF-08, RF-09
Depende de: T-07, T-09, T-10, T-11
Arquivos:
- `test/static.test.ts` (verificação)
- `test/security.test.ts` (verificação, usa `serveStatic` em guards de path)
- `test/unit/package.test.ts` (verificação)

Executar, nesta ordem:
1. `pnpm vitest run test/static.test.ts`
2. `pnpm vitest run test/security.test.ts`
3. `pnpm vitest run test/unit/package.test.ts`
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm vitest run` (suíte completa)

Conferir também que `git diff test/static.test.ts` mostra só adições ao final do arquivo: nenhum teste existente foi alterado (R-05 do PRD). Registrar no PR que Bun, Deno e Workers não entram na matriz `describeMatrix` (R-06 e techspec, R-06).

Aceite: todos os comandos terminam com código de saída 0. O diff de `test/static.test.ts` contém apenas adições.

---

## Pendências de decisão (confirmar antes do merge)

Estas escolhas divergem do PRD e não bloqueiam a implementação, mas precisam de confirmação do revisor:

1. D-05 / R-01: recorte de `ReadableStream` por leitura e cancelamento, em vez de `200` completo (afeta T-06 e T-10).
2. D-06 / R-04: tamanho zero mantém `200` completo, em vez de `416` (afeta T-06 e T-09).
3. D-08 / R-10: `Accept-Ranges` também em `304` (afeta T-01 e T-08).
