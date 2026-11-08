# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09). Todos os helpers são privados em `src/utils/static.ts` e nada novo é exportado. Cada tarefa segue o Bug Fix Workflow do AGENTS.md: escrever os testes, confirmar que falham, implementar, confirmar que passam. Os testes usam `describeMatrix` e rodam nos modos `web` e `node`.

### T-01 — Base de testes de Range (fixture e bloco `serve static range`)

Criar o `describeMatrix("serve static range", ...)` após o bloco que termina em `test/static.test.ts:624`. Montar a fixture: asset de 10 bytes `0123456789`, com `getMeta` → `{ size: 10, etag: '"abc"', mtime: 1_700_000_000_000 }` e `getContents` → string, ambos `vi.fn`. Incluir um helper para fazer pedidos com `Range`, `If-Range` e método variáveis. As tarefas seguintes acrescentam os casos nesse bloco.

Cobre: RF-11
Arquivos: `test/static.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` roda o bloco novo nos modos `web` e `node` e todos os testes existentes continuam passando.

### T-02 — Tamanho conhecido e `Accept-Ranges`

Testes primeiro: `GET` e `HEAD` sem `Range` retornam `200`, corpo de hoje e `Accept-Ranges: bytes`. `getMeta` sem `size`, ou com `size: 0`, mais `Range: bytes=0-3` retorna `200` completo, sem `Accept-Ranges` e sem `Content-Range`. Implementação: calcular `size` (definido e `> 0`) entre `src/utils/static.ts:241` e `:243`, antes de `isCacheMatch`, e definir `accept-ranges: bytes` só se ausente (D-03), de modo que o `304` também o carregue. Sem `size`, nenhum tratamento de `Range`.

Cobre: RF-01, RF-10
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-01
Aceite: os testes novos de RF-01 e RF-10 passam. Os testes existentes de `serveStatic` seguem passando, pois usam `toMatchObject`. Um `304` traz `Accept-Ranges: bytes`.

### T-03 — Parser de `Range` e resposta `206` em `GET`

Testes primeiro: `bytes=2-5` retorna `206`, corpo `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`. `bytes=7-99` é truncado em `7-9/10`. `bytes=7-` e `bytes=-3` retornam `789` com `7-9/10`. `bytes=-99` retorna o asset inteiro. `Bytes=0-1` e espaços ao redor valem. Casos ignorados com `200` completo e sem `Content-Range`: `bytes=abc`, `bytes=5-2`, `bytes=`, `bytes=-`, `bytes=0-1,4-5`, `items=0-1`. Implementação: tipo `ByteRange` e `parseRange(header, size)` com a regex `/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i` e a semântica de D-04. No fluxo, adicionar o bloco de decisão no lugar de `src/utils/static.ts:268-277` (D-02) com `Content-Range`, `Content-Length` e `Accept-Ranges` sobrescritos no `206`. Manter o `Content-Length` condicional apenas no caminho `200` (D-08). Para `GET`, chamar `getContents` antes de fixar os cabeçalhos de `206` (D-07).

Cobre: RF-02, RF-03, RF-06
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-02
Aceite: todos os casos acima passam nos modos `web` e `node`. O teste existente "does not overwrite a content-length already set" (`test/static.test.ts:600-617`) continua passando no `200`. Um teste novo mostra que um `content-length: 999` vindo de `options.headers` é sobrescrito no `206`.

### T-04 — `If-Range` com validação forte

Testes primeiro: `If-Range: "abc"` com `Range: bytes=0-3` retorna `206` com 4 bytes. `If-Range: "outro"` retorna `200` com 10 bytes. ETag fraco (`W/"abc"`) no `If-Range`, ou `etag` fraco no asset, retorna `200`. Data igual a `Last-Modified` retorna `206`. Data diferente ou inválida retorna `200`. `If-Range` sem `Range` é ignorado. Implementação: `ifRangeMatches(ifRange, { etag, lastModified })` conforme D-05 (comparação forte, data exata em segundos, sem reaproveitar `matchETag`). Chamá-la antes de `parseRange`. Se não confere, `range` fica `undefined` e a resposta é `200`.

Cobre: RF-07
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-03
Aceite: os casos de ETag e de data passam nos dois modos. Nenhuma importação de `src/utils/internal/cache.ts` é adicionada em `static.ts` para essa lógica.

### T-05 — `416` e `HEAD` com intervalo

Testes primeiro: `bytes=10-20` e `bytes=-0` retornam `416`, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio, em `GET` e `HEAD`. `HEAD` com `bytes=2-5` retorna `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, corpo vazio, e `getContents` não é chamado. Um `content-length: 999` de `options.headers` é sobrescrito no `416`. Implementação: no ramo `range === "unsatisfiable"`, escrever os cabeçalhos em `event.res.headers` e retornar `new HTTPResponse(null, { status: 416 })`, sem `getContents` e sem `HTTPError` (D-06, D-09). No ramo `range` com `HEAD`, retornar `206` só com cabeçalhos.

Cobre: RF-04, RF-05
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-03
Aceite: os testes de `416` e de `HEAD` passam idênticos em `web` e `node`, e `getContents` tem zero chamadas nos casos `HEAD` e `416`.

### T-06 — Recorte do corpo por tipo (`sliceBody`)

Testes primeiro, com `meta.size` igual ao tamanho em bytes do conteúdo: `string` multibyte (`"é"` ocupa 2 bytes), `Blob`, `Uint8Array` com `byteOffset`, `ArrayBuffer`, `ReadableStream` em vários chunks (incluindo chunk em `string`) e `URLSearchParams`, que cai em `200` completo sem cabeçalhos de intervalo. Também: `getContents` devolvendo `null`/`undefined` cai em `200`. Teste do `ReadableStream` com origem mock que verifica o cancelamento ao atingir o fim do intervalo e a propagação do `cancel`. Implementação: `sliceBody(body, start, end)` conforme a tabela de D-07, retornando `undefined` para tipos não recortáveis. O `ReadableStream` descarta `start` bytes e emite até `len` sem carregar tudo na memória. Quando `sliceBody` devolve `undefined`, cair no `200` completo (decisão tardia).

Cobre: RF-02
Arquivos: `src/utils/static.ts`, `test/static.test.ts`
Depende de: T-03
Aceite: um teste por tipo de corpo passa nos dois modos. O recorte nunca produz `206` com corpo inteiro. A origem do stream mock é cancelada.

### T-07 — Precedência de condicionais, encoding e sem regressão

Testes primeiro: `If-None-Match` igual ao `etag` mais `Range: bytes=0-3` retorna `304`, sem corpo e sem `Content-Range`. `If-Modified-Since` que já casa mais `Range` também retorna `304`. Com `encodings: { gzip: ".gz" }`, variante de 20 bytes, `Accept-Encoding: gzip` e `bytes=0-4`: `206`, `Content-Encoding: gzip`, `Content-Range: bytes 0-4/20`, `Content-Length: 5`, `Vary: accept-encoding` e o `Content-Type` do asset original. Asset inexistente mais `Range` retorna `404`, ou segue com `fallthrough`. `POST` mais `Range` retorna `405` com `Allow: GET, HEAD`. Implementação: normalmente nenhuma, pois D-02 já mantém a ordem. Corrigir `static.ts` só se algum teste falhar. Conferir que `src/index.ts` e os tipos `ServeStaticOptions`/`StaticAssetMeta` não têm diff.

Cobre: RF-08, RF-09, RF-11
Arquivos: `test/static.test.ts`, `src/utils/static.ts`
Depende de: T-03, T-05
Aceite: os casos acima passam nos dois modos. `pnpm vitest run test/unit/package.test.ts` passa, e `git diff --stat -- src/index.ts` é vazio.

### T-08 — Documentação (JSDoc e docs)

Atualizar o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com um parágrafo sobre `Range`, `If-Range`, e a exigência de que `meta.size` seja o tamanho em bytes da representação servida. Acrescentar uma nota curta sob `### serveStatic(event, options)` em `docs/2.utils/2.response.md:39`. Não alterar o contrato.

Cobre: RF-01, RF-10, RF-11
Arquivos: `src/utils/static.ts`, `docs/2.utils/2.response.md`
Depende de: T-07
Aceite: o JSDoc e a nota de docs descrevem `Range`, `If-Range` e `meta.size`, e `pnpm lint` passa.

### T-09 — Verificação final

Rodar `pnpm vitest run test/static.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm test` (lint, typecheck e cobertura) e `pnpm lint`. Conferir que nenhum helper foi exportado e que `src/index.ts` não tem diff. Ajustar só as asserções afetadas, caso algum teste existente quebre por causa do `Accept-Ranges`. Se o tamanho de `static.ts` for questionado na revisão, os helpers podem migrar para `src/utils/internal/` sem mudar contratos (D-01).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
Arquivos: `src/utils/static.ts`, `test/static.test.ts`, `test/unit/package.test.ts`
Depende de: T-08
Aceite: `pnpm test` e `pnpm lint` terminam sem erro, e a suíte completa passa nos modos `web` e `node`.
