# Tarefas: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-14) e `sdd/techspec.md` (D-01 a D-08).

Ordem geral: primeiro os testes (T-01), depois a lógica em `src/utils/static.ts`, depois a verificação final. Em cada tarefa de implementação, o teste novo deve falhar antes da mudança de código (Bug Fix Workflow do `AGENTS.md`).

### T-01 — Criar o bloco de testes de Range

Cobre: RF-13

Depende de: nenhuma

Aceite: `test/static.test.ts` ganha `describeMatrix("serve static range", ...)` com rotas próprias (`t.app.all(...)`), fixtures com ETags quotadas (`"abc"`, `W/"abc"`) e um asset de 10 bytes. Os cenários novos de RF-01 a RF-11 existem como `it` (podem ainda falhar). `pnpm vitest run test/static.test.ts` executa o bloco nos alvos `web` e `node`, e os testes novos que cobrem comportamento ainda não implementado falham, como esperado. Os testes existentes continuam passando.

Arquivos: `test/static.test.ts`

### T-02 — Parser de `Range` e casos que ignoram o cabeçalho

Cobre: RF-04, RF-05

Depende de: T-01

Aceite: `parseRange` (privada, em `src/utils/static.ts`, D-03) segue a ordem de decisão da techspec. Os testes passam nos dois alvos para: `bytes=0-1,4-5` → 200 sem `content-range`; `bytes=5-2` → 200 com 10 bytes; `items=0-1` → 200; `bytes=-` → 200; `bytes=10-20` → classificado como `unsatisfiable`; `bytes=-0` → `unsatisfiable`. Não há exportação nova.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-03 — `Accept-Ranges` e gate pelo tamanho conhecido

Cobre: RF-01, RF-09

Depende de: T-01

Aceite: `GET` e `HEAD` sem `Range` respondem 200 com o corpo completo e `accept-ranges: bytes` quando `meta.size > 0` (D-07). Com `size` ausente ou `0`, a resposta é 200 completo, sem `accept-ranges`, e `Range` é ignorado. Os testes passam em `web` e `node`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-04 — Respostas `206` e `416` com cabeçalhos corretos

Cobre: RF-02, RF-03, RF-04

Depende de: T-02, T-03

Aceite: implementa o fluxo da techspec (D-02 e D-05):
- `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo com os bytes 2 a 5;
- `bytes=-3` → `7-9`; `bytes=8-100` → `8-9`; `bytes=-100` → `0-9`;
- `HEAD` com `bytes=0-4` → 206, cabeçalhos da faixa, corpo vazio;
- `bytes=10-20` → 416 com `content-range: bytes */10`, `content-length: 0` e `accept-ranges`, também em `HEAD`;
- o 416 carrega `vary` copiado de `event.res` quando há `encodings`;
- o `content-length` da faixa sobrescreve o valor de `options.headers` no 206.
Os testes passam em `web` e `node`. No `node`, o servidor HTTP real confirma que o `content-length` e o corpo batem.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-05 — Validação de `If-Range`

Cobre: RF-06

Depende de: T-02

Aceite: `ifRangeMatches` (privada, D-04) compara por igualdade. `If-Range: "abc"` com ETag `"abc"` → 206. `If-Range: "xyz"` → 200 completo. `If-Range: W/"abc"` com ETag `"abc"` → 200. Data igual a `Last-Modified` → 206. Data diferente → 200. Asset sem `etag` com `If-Range` de ETag → 200. Os testes passam em `web` e `node`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-06 — Precedência de pré-condições e preservação de 404, 405, `fallthrough` e canonicalização

Cobre: RF-07, RF-08

Depende de: T-04, T-05

Aceite: `If-None-Match: "abc"` com `Range` → 304 sem corpo (a checagem de 304 continua antes de `Range`). `POST` com `Range` → 405 com `allow: GET, HEAD`. Asset inexistente com `Range` → 404. Com `fallthrough: true`, a requisição passa adiante. Caminho não canônico com `Range` → 404. Os cabeçalhos `vary`, `content-type` e `content-encoding` continuam presentes no 206 quando configurados. Os testes existentes em `test/static.test.ts` (incluindo os blocos de 304, 404, 405 e `fallthrough`) passam sem alteração.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-07 — Faixa sobre a variante comprimida

Cobre: RF-10

Depende de: T-04

Aceite: com `accept-encoding: gzip` e variante `.gz` de 40 bytes, `bytes=0-9` → 206, `content-range: bytes 0-9/40`, `content-encoding: gzip` e os 10 primeiros bytes do `.gz`. O `size` usado é o da variante escolhida (`getMeta` com o `id` comprimido). Os testes passam em `web` e `node`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-08 — Fatiamento do corpo para qualquer `BodyInit`

Cobre: RF-11

Depende de: T-04

Aceite: `sliceBody` (privada, D-06) entrega exatamente os bytes da faixa para `string`, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream`. `Blob` é fatiado com `blob.slice` sem leitura completa. Para `ReadableStream`, chunks que cruzam a fronteira (`["ab", "cdef", "gh"]` com `bytes=2-5`) produzem `cdef`. Um teste com `cancel` confirma que a fonte é cancelada depois que a faixa termina. Se a fonte não for cancelada, cancelar explicitamente conforme o risco 3 da techspec. Os testes passam em `web` e `node`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-09 — API pública intacta

Cobre: RF-12

Depende de: T-06, T-07, T-08

Aceite: `src/index.ts` não muda (continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`). Os helpers de `Range` (`parseRange`, `resolveRange`, `ifRangeMatches`, `sliceBody`, interfaces e tipos internos) não são exportados. `ServeStaticOptions` e `StaticAssetMeta` mantêm os mesmos campos. `pnpm vitest run test/unit/` passa, incluindo `test/unit/package.test.ts`, e a lista de exports não muda.

Arquivos: `src/utils/static.ts`, `src/index.ts`, `test/unit/package.test.ts`

### T-10 — Verificação final: suíte, lint e typecheck

Cobre: RF-13, RF-14

Depende de: T-09

Aceite: `pnpm vitest run test/static.test.ts` passa nos alvos `web` e `node`. `pnpm typecheck` e `pnpm lint` terminam com código de saída 0. `pnpm test` (suíte completa com cobertura) passa. Se algo falhar, registrar a saída do comando e a causa, em vez de contornar o teste.

Arquivos: nenhum arquivo novo; verificação sobre `src/utils/static.ts` e `test/static.test.ts`
