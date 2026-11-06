# Tarefas de implementação: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (requisitos RF/RNF) e `sdd/techspec.md` (decisões D-01 a D-10 e riscos R-01 a R-12).

Convenções seguidas (`AGENTS.md`):
- Cada tarefa que altera comportamento começa por um teste que falha antes da mudança em `src/utils/static.ts`, depois o teste passa.
- Testes com `describeMatrix` (`test/_setup.ts`), rodando em `web` e `node`.
- A fixture de `test/static.test.ts` usa `etag: "w/123"`, que não é entity-tag válido (R-09). Os testes novos usam ETags com aspas duplas, como `"abc"`.
- Tamanhos em bytes calculados com `TextEncoder` quando o conteúdo não for ASCII (R-08).

Ordem sugerida: T-01, T-02, T-03, T-04, T-10, T-05, T-07, T-08, T-06, T-09, T-11, T-12. As dependências abaixo são as que realmente existem.

---

### T-01 — Anunciar `Accept-Ranges: bytes` em respostas de asset

Adicionar `accept-ranges: bytes` em `event.res.headers`, junto do bloco de `etag`, antes da checagem de `isCacheMatch` (D-03). O cabeçalho sai em 200, 206, 304 e HEAD. Não é definido em 404, 405 nem em `fallthrough`. O `416` recebe o cabeçalho no init, na tarefa T-04.

Cobre: RF-01

Depende de: nenhuma

Aceite:
- Teste novo escrito antes falha: `GET` sem `Range` em asset existente retorna `200` com `accept-ranges: bytes`.
- Também têm o cabeçalho: `304` (com `If-None-Match` que casa) e `HEAD` sem `Range`.
- Não têm o cabeçalho: `404` para asset inexistente e `405` para método diferente de `GET`/`HEAD`.
- A suíte existente de `test/static.test.ts` continua passando sem alteração.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-02 — Parser de um único intervalo e resolução de `Range`

Criar, sem `export`, na seção `// --- Internal Utils ---`, os helpers `parseSingleByteRange` e `resolveRange` (techspec 4.2). O parser aceita só `bytes=<a>-<b>` (com `a <= b`), `bytes=<a>-` e `bytes=-<n>`, todos com dígitos. A unidade `bytes` é comparada sem diferenciar maiúsculas. Não há espaço depois de `=`. Qualquer outra entrada resulta em `none`, e a resposta segue como 200 completo (D-04, D-05).

Cobre: RF-02, RF-05

Depende de: T-01 (mesmo arquivo; ordem de execução)

Aceite:
- Teste novo: em asset de 1000 bytes, `bytes=100-199`, `bytes=900-` e `bytes=-50` retornam `206` com os trechos 100-199, 900-999 e 950-999 (o corpo é verificado após T-03; aqui basta conferir o resultado do parser por teste unitário em `test/unit/` ou pelo `Content-Range`).
- Teste novo: `bytes=0-1,5-9`, `items=0-5`, `bytes=9-3`, `bytes=abc` e `bytes=` retornam `200` com corpo inteiro e sem `content-range`.
- Os helpers não aparecem em `src/index.ts`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts` (ou `test/unit/static-range.test.ts`, se o time preferir teste unitário)

---

### T-03 — Resposta 206 com `Content-Range` e `Content-Length`

Quando `resolveRange` retornar `partial`, definir em `event.res.headers` `content-range: bytes <start>-<end>/<size>` e `content-length: <end - start + 1>`, com `set` (D-08). Os cabeçalhos de cache e de conteúdo já montados são reaproveitados pela mesclagem de `src/response.ts:201-204`. O corpo vem de `options.getContents(id)`, chamado uma vez, como hoje. O fatiamento fica para T-05. Esta tarefa cobre o caminho de `string` e `Blob`.

Cobre: RF-03

Depende de: T-02

Aceite:
- Teste novo: asset de 1000 bytes com `Range: bytes=500-9999` retorna `206`, `content-range: bytes 500-999/1000`, `content-length: 500` e corpo com os 500 últimos bytes.
- Teste novo: `Range: bytes=0-99` retorna `206` com `content-length: 100`.
- Teste novo escrito antes falha.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-04 — Resposta 416 para intervalo não satisfazível

Quando `resolveRange` retornar `unsatisfiable`, responder com `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable", headers })`, com `accept-ranges: bytes`, `content-range: bytes */<size>` e `content-length: 0` no init (D-09). Não chamar `getContents`. Os cabeçalhos vão no init porque `src/response.ts:211-213` descarta os cabeçalhos de sucesso em status `>= 400`.

Cobre: RF-04

Depende de: T-02

Aceite:
- Teste novo: asset de 1000 bytes com `Range: bytes=1000-1100` retorna `416`, corpo vazio, `content-range: bytes */1000` e `content-length: 0`.
- Teste novo com `vi.fn`: `getContents` não é chamado.
- Teste novo: `Range: bytes=0-99` em asset com `size = 0` retorna `416`.
- Teste novo escrito antes falha.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-05 — Fatiamento do corpo por tipo, sem alterar `getContents`

Criar o helper privado `sliceContents(contents, start, end)` (techspec 4.2 e D-07), usado em T-03. Tratamento por tipo:
- `string`: codifica em UTF-8 e fatia os bytes.
- `ArrayBuffer` ou `ArrayBufferView`: fatia com `subarray`/`slice`.
- `Blob`: `blob.slice(start, end + 1)`.
- `ReadableStream`: novo stream que descarta os bytes antes de `start`, emite até `end` e cancela a fonte ao terminar o trecho ou quando o consumidor cancelar (R-06). Também cancela a fonte em erro de leitura.
- Outros tipos (`URLSearchParams`, `FormData`): `new Response(contents).arrayBuffer()` seguido de fatiamento.
- `null` ou `undefined`: retorna `null`.

A assinatura de `ServeStaticOptions` e de `getContents` não muda (D-07).

Cobre: RF-03

Depende de: T-03

Aceite:
- Teste novo: `ReadableStream` de vários chunks, com faixa que começa e termina no meio dos chunks, entrega exatamente os bytes esperados.
- Teste novo: `cancel` do consumidor cancela a fonte (espião no `cancel` do stream de origem).
- Teste novo: ao terminar o trecho, a fonte também é cancelada.
- Teste novo: erro de leitura na fonte cancela ou propaga sem deixar stream aberto (R-06).
- Teste novo: `Blob` fatiado produz os bytes corretos.
- Teste novo: conteúdo não ASCII em `string` fatia pelos bytes UTF-8, não pelos caracteres.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-06 — `HEAD` com `Range`

Para `HEAD` com `resolveRange` em `partial`, responder `new HTTPResponse(null, { status: 206, statusText: "Partial Content" })` com os cabeçalhos de T-03, sem chamar `getContents` (D-10). O `416` em `HEAD` segue o caminho de T-04. Assim não há stream aberto que possa vazar (R-06).

Cobre: RF-06

Depende de: T-03, T-04

Aceite:
- Teste novo: `HEAD` com `Range: bytes=0-99` em asset de 1000 bytes retorna `206`, sem corpo, com `content-range: bytes 0-99/1000` e `content-length: 100`, iguais aos do `GET` com o mesmo `Range`.
- Teste novo com `vi.fn`: `getContents` não é chamado em `HEAD`.
- Teste novo: `HEAD` com `Range` não satisfazível retorna `416` sem corpo.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-07 — `Range` sobre representação pré-comprimida

Não adicionar lógica nova de busca. O `meta.size` já é o tamanho da variante escolhida (`src/utils/static.ts:201-208`). Esta tarefa garante, por teste, que `Content-Range` e `Content-Length` usam o tamanho da variante e que `content-encoding` continua correto.

Cobre: RF-07

Depende de: T-03

Aceite:
- Teste novo: asset de 1000 bytes com variante `.gz` de 300 bytes, `accept-encoding: gzip` e `Range: bytes=0-99` retorna `206`, `content-range: bytes 0-99/300`, `content-length: 100` e `content-encoding: gzip`.
- Teste novo escrito antes falha ou, se passar sem mudança, a tarefa vira só cobertura de regressão. Registrar no PR qual caso aconteceu.

Arquivos: `test/static.test.ts`, e `src/utils/static.ts` somente se o teste falhar

---

### T-08 — `If-Range` com comparação forte de ETag

Em `resolveRange`, se o pedido traz `If-Range`, aplicar o `Range` só quando o valor começa com `"`, não começa com `W/` e é idêntico a `meta.etag`, que também não pode começar com `W/`. Qualquer outro caso, inclusive `If-Range` com data, resulta em `none` (D-06). A função `matchesIfRange` fica privada, sem `export`. A data em `If-Range` fica fora do contrato (R-01).

Cobre: RF-08

Depende de: T-02

Aceite:
- Teste novo: `Range: bytes=0-99` com `If-Range: "xyz"` em asset com `ETag: "abc"` retorna `200` com corpo inteiro.
- Teste novo: o mesmo `Range` com `If-Range: "abc"` retorna `206` com `content-range: bytes 0-99/<tamanho>`.
- Teste novo: `If-Range` com data (`Last-Modified`) retorna `200`.
- Teste novo: `If-Range` com ETag fraco (`W/"abc"`) retorna `200`.
- Testes usam ETag com aspas (R-09), não a fixture `"w/123"`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-09 — Preservar cabeçalhos de cache e a precedência de `304`

Garantir que a checagem de `304` (`src/utils/static.ts:243-248`) continua antes de qualquer lógica de Range (D-02, risco de regressão de cache no PRD). Garantir que, em `206`, `etag`, `last-modified`, `cache-control`, `vary`, `content-type` e `content-encoding` têm os mesmos valores da resposta `200`.

Cobre: RNF-01, RNF-02

Depende de: T-03, T-06, T-08

Aceite:
- Teste novo: em `206`, os cabeçalhos listados são iguais aos da resposta `200` para o mesmo asset.
- Teste novo: `If-None-Match` que casa, junto com `Range`, retorna `304`, não `206`.
- Teste novo: `If-Modified-Since` com `Range` mantém a precedência atual.
- Toda a suíte de `test/static.test.ts` passa, inclusive os casos de `304`, seleção de encoding, `fallthrough`, `404` e `405`.

Arquivos: `test/static.test.ts`, e `src/utils/static.ts` somente se algum teste de regressão falhar

---

### T-10 — Casos de borda dos limites do intervalo

Cobrir e implementar as linhas da tabela de D-05 que ainda não tiverem teste nas tarefas anteriores. Casos obrigatórios:
- `bytes=-0` retorna `416` (premissa assumida, R-02).
- `bytes=-5000` em asset de 1000 bytes retorna `206` com `bytes 0-999/1000` (premissa assumida, R-02).
- `size` ausente em `getMeta` ignora o `Range` e retorna `200` (fora de escopo do PRD, premissa).
- `size = 0` com qualquer `Range` retorna `416`.
- `bytes=1000-` em asset de 1000 bytes retorna `416`.
- Números muito grandes não causam erro: o resultado é 416 ou clamp.

Cobre: RF-02, RF-04

Depende de: T-02, T-04

Aceite:
- Cada caso acima tem teste novo, escrito antes da implementação correspondente.
- As duas premissas em aberto (`-0` e `-n > size`) estão documentadas em comentário curto no código e no PR.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-11 — Sem novas exportações públicas

Verificar que `src/index.ts` não mudou e que nenhum helper novo de `src/utils/static.ts` tem `export`. O snapshot de exportações não deve ser atualizado.

Cobre: RNF-03

Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10

Aceite:
- `git diff` não mostra alteração em `src/index.ts`.
- `pnpm vitest run test/unit/package.test.ts` passa sem atualizar o snapshot.
- Busca por `export` nos helpers novos não encontra nada.

Arquivos: `src/index.ts` (somente leitura), `src/utils/static.ts`, `test/unit/package.test.ts` (somente leitura)

---

### T-12 — Qualidade, cobertura e registro de pendências

Rodar a verificação completa e registrar o estado do repositório. Também verificar o tamanho de `src/utils/static.ts`. A techspec (D-01, R-10) aceita que o arquivo passe de 200 linhas, mas o time deve decidir se mantém ou se move os helpers para `src/utils/internal/range.ts`.

Cobre: RNF-04, RNF-02

Depende de: T-11

Aceite:
- `pnpm lint` e `pnpm typecheck` terminam sem erros.
- `pnpm test` completo passa, com lint, typecheck e cobertura.
- Antes do PR, verificar `D test/unit/cli.test.ts` e `sdd/` não rastreado, conforme R-11. Não alterar esses arquivos nesta tarefa.
- Decisões ainda abertas a confirmar com o time: R-01 (`If-Range` com data), R-02 (`bytes=-0` e `-n > size`), R-03 (`Accept-Ranges` sem `size`), e D-01 (tamanho do arquivo).

Arquivos: nenhum arquivo de código. Esta tarefa só executa comandos e registra o resultado no PR.

---

## Cobertura dos requisitos do PRD

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01 |
| RF-02 | T-02, T-10 |
| RF-03 | T-03, T-05 |
| RF-04 | T-04, T-10 |
| RF-05 | T-02 |
| RF-06 | T-06 |
| RF-07 | T-07 |
| RF-08 | T-08 |
| RNF-01 | T-09 |
| RNF-02 | T-01, T-09, T-12 |
| RNF-03 | T-11 |
| RNF-04 | T-12 |
