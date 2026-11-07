# Tarefas: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-11).
Código afetado: `src/utils/static.ts`. Testes: `test/static-range.test.ts` (novo). Testes existentes não são alterados.

## Ordem sugerida

Testes primeiro (ciclo de bug fix do `AGENTS.md`): T-01 a T-05 escrevem o vermelho; T-06 a T-09 implementam; T-10 a T-13 fecham.

```
T-01 → T-02 → T-03 → T-04
T-01 → T-06
T-05 → T-07
T-02, T-05, T-06, T-07 → T-08 → T-09 (também depende de T-03) → T-10 (também depende de T-04)
T-08 → T-11 → T-12
T-10, T-12 → T-13
```

## Decisões assumidas (a confirmar com os mantenedores)

- Helpers privados ficam em `src/utils/static.ts` (techspec D-01). Se virar `src/utils/internal/range.ts`, só mudam T-06 e T-07.
- `size: 0` com `Range` responde `416` com `Content-Range: bytes */0` (techspec D-05).
- `Range` é aplicado aos bytes da variante pré-comprimida (techspec D-07).
- `accept-ranges` também sai no `304`, por ser definido antes da checagem condicional (techspec risco 10).
- A inconsistência `statusCode` vs `status` em `static.ts` não é corrigida nesta entrega.

---

### T-01 — Arquivo de testes e casos de anúncio e de Range ignorado

Cobre: RF-01, RF-03
Depende de: nenhuma
Aceite: `test/static-range.test.ts` criado com `describeMatrix`, com fixture de asset de 1000 bytes. Casos: `GET` e `HEAD` sem `Range` retornam `200` completo com `accept-ranges: bytes`; `bytes=0-1,5-9`, `items=0-1`, `bytes=abc`, `bytes=5-3`, `bytes=-` e `bytes=` retornam `200` completo sem `content-range`; asset com `size` ausente e `Range` retorna `200` completo (techspec D-05 e premissa do PRD). Antes da implementação, só os casos de `accept-ranges` falham; os de `200` já passam e servem de guarda de regressão. Rodar `pnpm vitest run test/static-range.test.ts` nos dois modos.
Arquivos: `test/static-range.test.ts`

### T-02 — Testes de 206 e 416 com GET e HEAD (vermelho)

Cobre: RF-02, RF-04, RF-05
Depende de: T-01
Aceite: casos sobre o asset de 1000 bytes: `bytes=100-199` dá `206`, `content-range: bytes 100-199/1000`, `content-length: 100` e corpo com os bytes 100 a 199; `bytes=900-`, `bytes=900-5000` dão `bytes 900-999/1000`; `bytes=-200` dá `bytes 800-999/1000`; `bytes=-5000` dá `bytes 0-999/1000`. `bytes=1000-1100` dá `416`, `content-range: bytes */1000`, `content-length: 0`, corpo vazio; `bytes=-0` dá `416`; `size: 0` com qualquer `Range` dá `416` com `bytes */0`. Os mesmos casos de `206`/`416` em `HEAD`, sem corpo. Todos falham antes da implementação; confirmar o vermelho.
Arquivos: `test/static-range.test.ts`

### T-03 — Testes de If-Range e precedência do 304 (vermelho nos casos de 206)

Cobre: RF-06, RF-07
Depende de: T-02
Aceite: `Range: bytes=0-9` com `If-Range: "abc"` (ETag forte igual) dá `206`; com `If-Range: "outro"`, com `If-Range: W/"abc"` ou com data diferente/inválida dá `200` completo; `If-Range` com a data igual ao `last-modified` dá `206`. `Range` com `If-None-Match: "abc"` dá `304` sem corpo; `Range` com `If-Modified-Since` casando dá `304`. Os casos de `304` passam já hoje (guarda de regressão); os de `206` falham antes da implementação.
Arquivos: `test/static-range.test.ts`

### T-04 — Testes de preservação de encoding, 405, fallthrough e 404 de trecho vazio

Cobre: RF-08
Depende de: T-03
Aceite: `app.js` com variante `app.js.gz` e `encodings: { gzip: ".gz" }`, com `accept-encoding: gzip` e `Range: bytes=0-9`, dá `content-encoding: gzip` e os bytes 0 a 9 da variante. `POST` com `Range` dá `405` com `allow: GET, HEAD`. `fallthrough` com `Range` em método não permitido dá `undefined` sem vazar headers, seguindo o padrão de `test/static.test.ts:516`. `getContents` devolvendo `undefined` com `Range` dá `404`, inclusive com `fallthrough` (techspec D-09). Só o caso de `404` do D-09 deve falhar antes da implementação.
Arquivos: `test/static-range.test.ts`

### T-05 — Testes de fatiamento por tipo de body e de `content-length` em HEAD (vermelho)

Cobre: RF-02, RF-05
Depende de: T-01
Aceite: com `getContents` devolvendo `string` com multibyte (ex.: `"héllo"`, `size` em bytes UTF-8), `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream`, o mesmo `Range` devolve o mesmo trecho de bytes em todos os tipos. `HEAD` com `headers: { "content-length": "999" }` e `Range` dá `206` com `content-length` igual ao tamanho do trecho, não `999` (techspec D-08). Falham antes da implementação.
Arquivos: `test/static-range.test.ts`

### T-06 — Helpers privados de parse de `Range` e cabeçalho `Accept-Ranges`

Cobre: RF-01, RF-03, RF-04
Depende de: T-01
Aceite: em `src/utils/static.ts`, função privada `resolveRange` (sem `export`) com a gramática e a tabela de sintaxe da techspec (D-02 e D-11): devolve intervalo inclusivo, `"unsatisfiable"` ou `undefined`; unidade case-insensitive; `last < first` e múltiplos intervalos devolvem `undefined`; sufixo `-0` ou size `0` devolve `"unsatisfiable"`. `accept-ranges: bytes` definido logo após `etag` (D-03). T-01 passa integralmente; `pnpm vitest run test/static.test.ts` continua verde.
Arquivos: `src/utils/static.ts`

### T-07 — Helper privado `sliceBody` para fatiar o `BodyInit` em bytes

Cobre: RF-02
Depende de: T-05
Aceite: `sliceBody(body, start, endExclusive)` privada, sem `export`, cobre os tipos da techspec D-06: `string` por `TextEncoder` e `subarray`; `ArrayBuffer` por `slice`; `ArrayBuffer.isView` por `Uint8Array` com `byteOffset`; `Blob` por `slice`; `ReadableStream`, `FormData` e `URLSearchParams` por `new Response(body).blob()` e `slice`. Teste de T-05 passa para todos os tipos.
Arquivos: `src/utils/static.ts`

### T-08 — Bloco de `Range` em `serveStatic`: 206, 416, HEAD e 404 de trecho vazio

Cobre: RF-02, RF-04, RF-05
Depende de: T-02, T-05, T-06, T-07
Aceite: trecho inserido entre `content-length` e a ramificação de `HEAD` (techspec, trecho de `serveStatic`, D-05/D-08/D-09). Para `Range` avaliado: `416` com `content-range: bytes */<size>`, `content-length: 0` e corpo vazio; `206` com `content-range` e `content-length` definidos com `set` (substituem valores existentes); `HEAD` responde `206` sem chamar `getContents`; `GET` responde `206` com `sliceBody`; `getContents` vazio lança `HTTPError({ status: 404 })`. Usar `status` (não `statusCode`). Todos os casos de T-02, T-04 (D-09) e T-05 passam; `test/static.test.ts` continua verde.
Arquivos: `src/utils/static.ts`

### T-09 — Validação de `If-Range` e ordem 304 → Range

Cobre: RF-06, RF-07
Depende de: T-03, T-08
Aceite: helper privado `ifRangeMatches(value, meta, mtime)` (techspec D-04): ETag forte com comparação byte a byte, ETag fraca (`W/`) nunca confere, data confere só se `new Date(valor).getTime()` for igual a `mtimeDate` (já truncado), data inválida não confere, `If-Range` com ETag e sem `meta.etag` não confere. `If-Range` não conferindo faz `Range` ser ignorado (`200` completo). A avaliação de `Range` fica depois de `304` (techspec D-03). Todos os casos de T-03 passam.
Arquivos: `src/utils/static.ts`

### T-10 — Verificação de preservação: encoding, 405, fallthrough e 404

Cobre: RF-08
Depende de: T-04, T-09
Aceite: todos os casos de T-04 passam. `test/static.test.ts` passa sem nenhuma alteração no arquivo (`git diff -- test/static.test.ts` vazio). Seleção de encoding, `vary`, caminho não canônico (techspec D-10) e `405` continuam iguais ao `master`. Só alterar `src/utils/static.ts` se um caso falhar, e registrar o motivo.
Arquivos: `test/static-range.test.ts`, `test/static.test.ts` (somente leitura), `src/utils/static.ts` (somente se necessário)

### T-11 — JSDoc em `StaticAssetMeta.size` e em `getContents`

Cobre: RF-02
Depende de: T-08
Aceite: JSDoc em `StaticAssetMeta.size` (`src/utils/static.ts:13`) diz que é o tamanho em bytes do corpo devolvido por `getContents` e que, sem ele, a resposta é sempre completa. JSDoc em `getContents` (`src/utils/static.ts:33`) diz que devolve o corpo completo, que o trecho é fatiado dele e que streams são lidos inteiros na memória (techspec riscos 1 e 3). Nenhuma assinatura muda; `pnpm lint` passa.
Arquivos: `src/utils/static.ts`

### T-12 — Conferência de exportações públicas inalteradas

Cobre: RF-09
Depende de: T-11
Aceite: `git diff master -- src/index.ts` vazio. Nenhum helper novo é exportado: `resolveRange`, `ifRangeMatches` e `sliceBody` não aparecem em `export`. `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic` mantêm a mesma assinatura. Verificação manual, registrada na revisão.
Arquivos: `src/index.ts` (somente leitura), `src/utils/static.ts`

### T-13 — Verificação final: testes, tipos e lint

Cobre: RF-10
Depende de: T-10, T-12
Aceite: `pnpm vitest run test/static-range.test.ts` passa nos modos web e node; `pnpm vitest run test/static.test.ts` passa; `pnpm test` passa (lint, typecheck e coverage); `pnpm lint` e `pnpm typecheck` passam. Registrar a saída de cada comando; qualquer falha é reportada com a saída, não omitida.
Arquivos: nenhum (apenas execução)
