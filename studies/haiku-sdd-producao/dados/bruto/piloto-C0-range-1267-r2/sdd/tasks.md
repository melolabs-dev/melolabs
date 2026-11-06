# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08). Ordem segue o fluxo do `AGENTS.md`: testes primeiro (devem falhar), depois implementação. Todos os helpers ficam privados (sem `export`) em `src/utils/static.ts`, na seção Internal Utils.

### T-01 — Escrever os testes de Range (falhando)
Criar `describeMatrix("serve static range", ...)` com as opções dedicadas da techspec (seção 5): `getContents` devolve `"0123456789"`, `getMeta` com `size: 10`, `etag: '"v1"'`, `mtime`, `type`, `headers` de cache e `encodings: { gzip: ".gz" }`. Um `it` por caso: anúncio de `Accept-Ranges` (GET/HEAD), três formas de intervalo, limite de fim e sufixo grande, 416 (`10-20`, `10-`, `-0`), ranges ignorados (multi-range, unidade errada, sintaxe inválida, `5-2`, `-`, número gigante), HEAD igual ao GET, variante `.gz`, `If-Range` (forte, fraca, data igual/diferente, sem validadores), cabeçalhos preservados em 200/206/416, 304/404/fallthrough/405 com Range, tipos de corpo (`Blob`, `Uint8Array` com `byteOffset`, `ReadableStream` multi-chunk, string multibyte), `content-length` de `options.headers` (sobrescrito em 206/416, preservado em 200), `size` ausente e `size: 0`, e ausência de nomes `range` em `src/index.ts`.
- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/static.test.ts` executa os novos testes nas matrizes `web` e `node` e os de Range falham antes da implementação; os testes antigos continuam passando.
- Arquivos: `test/static.test.ts`

### T-02 — Parser do cabeçalho `Range`
Adicionar `parseRangeHeader(value)` com a regex estrita `^bytes=(\d*)-(\d*)$` (unidade sem diferenciar maiúsculas, valor aparado). Retorna `{ start, end? }`, `{ suffix }` ou `undefined` para multi-range, unidade diferente, sintaxe inválida, `bytes=-`, números fora de `Number.isSafeInteger` e `a > b`.
- Cobre: RF-02, RF-05
- Depende de: nenhuma
- Aceite: os casos de RF-02 e RF-05 do T-01 passam no nível do `serveStatic` após T-06; `pnpm typecheck` e `pnpm lint` sem erros; a função não tem `export`.
- Arquivos: `src/utils/static.ts`

### T-03 — Resolução do intervalo contra o tamanho da variante
Adicionar `resolveByteRange(parsed, size)` retornando `{ start, end }` ou `"unsatisfiable"`: `a >= size` e `-0` não satisfazíveis; fim limitado a `size - 1`; sufixo maior que o asset devolve tudo; `size === 0` sempre não satisfazível (`bytes */0`).
- Cobre: RF-02, RF-03, RF-04
- Depende de: T-02
- Aceite: casos `bytes=2-5`, `7-`, `-3`, `5-100`, `-100`, `0-0`, `10-20`, `10-`, `-0` e `size: 0` do T-01 passam após T-06.
- Arquivos: `src/utils/static.ts`

### T-04 — Avaliação de `If-Range` com comparação forte
Adicionar `ifRangeMatches(value, etag, lastModified)`: etag fraca (`W/`) nunca corresponde; etag entre aspas corresponde só se `meta.etag` existe, não é fraco e é idêntico; caso contrário o valor é data e corresponde só por igualdade exata com o `Last-Modified` emitido. Adicionar `resolveRequestRange(headers, size, lastModified, etag)` que lê `Range`/`If-Range`, combina T-02, T-03 e T-04 e devolve `undefined` quando o Range deve ser ignorado.
- Cobre: RF-05, RF-08
- Depende de: T-02, T-03
- Aceite: testes de `If-Range` do T-01 (`"v2"` gera 200, `"v1"` gera 206, `W/"v1"` gera 200, data igual gera 206, data diferente gera 200, sem validadores gera 200) passam após T-06; funções sem `export`.
- Arquivos: `src/utils/static.ts`

### T-05 — Recorte do corpo por tipo de `BodyInit`
Adicionar `sliceBody(body, start, end)` e `sliceStream(stream, start, length)`: `Blob` via `slice`; `ArrayBuffer`/views via `Uint8Array` sem cópia respeitando `byteOffset`; string via `TextEncoder` (tamanho em bytes); `ReadableStream` e demais tipos via stream incremental que descarta o prefixo, emite no máximo `length` bytes e cancela a origem ao terminar ou ser cancelado.
- Cobre: RF-03, RF-06
- Depende de: nenhuma
- Aceite: testes de tipos de corpo do T-01 (Blob, Uint8Array com offset, stream com intervalo atravessando chunks, string multibyte) passam nas matrizes `web` e `node`, após T-06.
- Arquivos: `src/utils/static.ts`

### T-06 — Integrar Range ao fluxo de `serveStatic`
Substituir o trecho final do `serveStatic` (após o 304 e `Content-Encoding`, hoje `static.ts:268-277`) pelo bloco da techspec 4.1: `Accept-Ranges: bytes` incondicional em asset encontrado (não em 304/404/405); Range só quando `meta.size` é inteiro seguro >= 0; `416` com `Content-Range: bytes */<size>`, `Content-Length: 0` e corpo nulo sem chamar `getContents`; `206` com `Content-Range`, `Content-Length` do trecho e `statusText`; HEAD sem chamar `getContents`; em GET chamar `getContents` antes de escrever os cabeçalhos de range e, se vier vazio, cair no `200` normal; `content-length` sobrescrito em 206/416 e mantido no 200. Caminho sem range permanece idêntico ao atual.
- Cobre: RF-01, RF-03, RF-04, RF-06, RF-07, RF-09, RF-10
- Depende de: T-02, T-03, T-04, T-05
- Aceite: `pnpm vitest run test/static.test.ts` passa por completo (novos e antigos, `web` e `node`), incluindo variante `.gz` com `Content-Range: bytes 0-2/6`, comparação de cabeçalhos 200 x 206 x 416 e `304`/`404`/`405` inalterados.
- Arquivos: `src/utils/static.ts`

### T-07 — Verificação final e ausência de API nova
Rodar a verificação completa e confirmar que nada público mudou: `src/index.ts` sem diff, nenhum `export` novo em `src/utils/static.ts`, `ServeStaticOptions`/`StaticAssetMeta` intactos. Opcional: nota de Range na página de docs do `serveStatic`, se existir.
- Cobre: RF-11
- Depende de: T-06
- Aceite: `git diff -- src/index.ts` vazio; `grep -n "export" src/utils/static.ts` sem nomes novos; `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` passam.
- Arquivos: `src/utils/static.ts`, `src/index.ts`, `test/static.test.ts`

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-06 |
| RF-02 | T-01, T-02, T-03 |
| RF-03 | T-01, T-03, T-05, T-06 |
| RF-04 | T-01, T-03, T-06 |
| RF-05 | T-01, T-02, T-04 |
| RF-06 | T-01, T-05, T-06 |
| RF-07 | T-01, T-06 |
| RF-08 | T-01, T-04 |
| RF-09 | T-01, T-06 |
| RF-10 | T-01, T-06 |
| RF-11 | T-01, T-07 |
