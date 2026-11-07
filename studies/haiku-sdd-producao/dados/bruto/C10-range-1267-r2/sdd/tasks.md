# Tarefas: HTTP Range em `serveStatic`

- PRD: `sdd/prd.md` (RF-01 a RF-12)
- Especificação técnica: `sdd/techspec.md` (D-01 a D-10)
- Issue: h3js/h3#1267

## Regras de execução

- Seguir o fluxo de bug fix de `AGENTS.md`: primeiro os testes (T-01 a T-12), confirmados como falhos em `master` antes de qualquer mudança em `src/utils/static.ts` (T-13), depois a implementação (T-14 a T-19).
- Tarefas que tocam o mesmo arquivo estão encadeadas. Não rodar duas delas em paralelo, para evitar conflito de edição.
- Cada tarefa termina com os testes dela passando e sem regressão nos testes anteriores.

## Pendências antes de começar

- **Conflito PRD x techspec sobre `Accept-Ranges` na 304.** RF-01 pede o header em "respostas GET e HEAD" de asset com tamanho conhecido. A 304 também é uma resposta GET, mas o techspec (D-03, R11) decide não definir o header nela. T-02 segue o techspec. Os mantenedores precisam confirmar antes de T-02. Se a decisão mudar, só o teste "sem `accept-ranges` na 304" e o bloco de D-03 mudam.
- **P4 do PRD.** A issue pede "sempre anunciar `Accept-Ranges`". O PRD restringe a asset com tamanho conhecido. Vale confirmar com os mantenedores, como diz o próprio PRD. Não bloqueia as tarefas, porque o escopo já está definido no PRD.

---

## Testes

### T-01 — Fixture de Range e `Accept-Ranges` em 200 e HEAD

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:** O bloco `describeMatrix` de Range, com a rota `/range/**`, `getMeta` com `size: 1000`, `etag: '"abc"'` e `mtime`, e `getContents` com `"abcdefghij".repeat(100)`, existe em `test/static.test.ts`. Os testes de GET 200 e HEAD 200 verificam `accept-ranges: bytes` e `content-length: 1000`. Rodando `pnpm vitest run test/static.test.ts -t "Range"` em `master`, esses testes falham nas duas matrizes (`web` e `node`).

**Arquivos:** `test/static.test.ts`

### T-02 — `Accept-Ranges` ausente sem `size` e na 304; 304 tem precedência sobre Range

**Cobre:** RF-01, RF-08

**Depende de:** T-01

**Aceite:** Testes que cobrem: `getMeta` sem `size` não recebe `accept-ranges`; `if-none-match` que coincide retorna 304 sem corpo e sem `accept-ranges` (decisão D-03, ver pendência acima); `if-none-match: "abc"` com `Range: bytes=0-9` retorna 304 sem corpo. Os testes sem `accept-ranges` passam em `master` e continuam passando depois; o teste de precedência também passa em `master`.

**Arquivos:** `test/static.test.ts`

### T-03 — 206 para intervalo de faixa única

**Cobre:** RF-02

**Depende de:** T-02

**Aceite:** Para `Range: bytes=100-199`, o teste verifica status 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo igual a `CONTENT.slice(100, 200)`, e `etag` e `last-modified` iguais aos do 200. Um teste com `headers: { "content-length": "999" }` verifica que o 206 usa `100`. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-04 — Limites do intervalo e números muito grandes

**Cobre:** RF-03

**Depende de:** T-03

**Aceite:** `bytes=900-5000` gera 206 com `bytes 900-999/1000` e `content-length: 100`. `bytes=-5000` gera 206 com `bytes 0-999/1000` e `content-length: 1000`. `bytes=0-99999999999999999999999` gera 206 com `bytes 0-999/1000`. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-05 — 416 para intervalo não satisfatível

**Cobre:** RF-04

**Depende de:** T-04

**Aceite:** Para `bytes=1000-`, `bytes=-0`, e para um asset de `size: 0` com `bytes=0-0`, o teste verifica status 416, `content-range: bytes */<tamanho>`, `content-length: 0`, `accept-ranges: bytes` e corpo vazio. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-06 — Range inválido ou múltiplo é ignorado

**Cobre:** RF-05

**Depende de:** T-05

**Aceite:** Para `bytes=0-1,5-9`, `items=0-5`, `bytes=500-100` e `bytes=abc`, o teste verifica status 200, `content-length: 1000`, corpo completo, ausência de `content-range` e presença de `accept-ranges: bytes`. A asserção de `accept-ranges` faz o teste falhar em `master`, como pede a correção do critério no techspec.

**Arquivos:** `test/static.test.ts`

### T-07 — HEAD com Range não chama `getContents`

**Cobre:** RF-06

**Depende de:** T-06

**Aceite:** Para HEAD com `Range: bytes=0-99`, o teste verifica status 206, `content-length: 100`, `content-range: bytes 0-99/1000`, corpo vazio, e que o `vi.fn` de `getContents` não foi chamado. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-08 — `If-Range` com ETag e data

**Cobre:** RF-07

**Depende de:** T-07

**Aceite:** Com `If-Range: "xyz"` o teste retorna 200 completo, e com `If-Range: "abc"` retorna 206 com `content-length: 10`. Com `getMeta` de `etag: 'W/"abc"'`, tanto `If-Range: 'W/"abc"'` quanto `If-Range: '"abc"'` retornam 200. Com `If-Range` igual a `new Date(1_700_000_000_000).toUTCString()` retorna 206; com data de um segundo antes retorna 200; asset sem `mtime` retorna 200. Os casos de 206 falham em `master`.

**Arquivos:** `test/static.test.ts`

### T-09 — Range sobre variante pré-comprimido

**Cobre:** RF-09

**Depende de:** T-08

**Aceite:** Com `encodings: { gzip: ".gz" }`, arquivo `.gz` de 300 bytes, `Accept-Encoding: gzip` e `Range: bytes=0-99`, o teste verifica status 206, `content-range: bytes 0-99/300`, `content-length: 100` e `content-encoding: gzip`. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-10 — Stream lido só até o último byte

**Cobre:** RF-10

**Depende de:** T-09

**Aceite:** Um `ReadableStream` de 1000 pedaços de 1 byte, com `highWaterMark: 0` na origem e contador de `pull`, recebe `Range: bytes=0-9`. O corpo tem 10 bytes, o contador de leituras é 10 (ou, em `node`, no máximo 10, conforme R4 do techspec), e o `cancel` da origem é chamado. Em `master` falha.

**Arquivos:** `test/static.test.ts`

### T-11 — Corpo igual para cada tipo de `getContents`

**Cobre:** RF-02 (corpo), D-07

**Depende de:** T-10

**Aceite:** Para `bytes=100-199`, `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` devolvem o mesmo corpo de 100 bytes. Em `master` falha pelo menos para os tipos que dependem do recorte.

**Arquivos:** `test/static.test.ts`

### T-12 — 404 e 405 continuam iguais com Range

**Cobre:** RF-11

**Depende de:** T-11

**Aceite:** GET com `Range` para asset inexistente retorna 404. POST com `Range` retorna 405 com `allow: GET, HEAD`. Esses testes passam em `master` e continuam passando depois.

**Arquivos:** `test/static.test.ts`

---

## Gate de falha em `master`

### T-13 — Confirmar que os testes de RF-02, RF-04 e RF-05 falham em `master`

**Cobre:** RF-02, RF-04, RF-05 (critério transversal do PRD)

**Depende de:** T-12

**Aceite:** Com `src/utils/static.ts` ainda sem alteração (`git diff master -- src/utils/static.ts` vazio), `pnpm vitest run test/static.test.ts` falha nos testes de RF-02 (206), RF-04 (416) e RF-05 (com `accept-ranges`). O resultado (lista dos testes que falham) é registrado na mensagem de conclusão da tarefa. Se algum teste de RF-02, RF-04 ou RF-05 passar em `master`, a asserção dele é reforçada antes de seguir.

**Arquivos:** `test/static.test.ts` (somente leitura nesta tarefa; ajustes, se necessários, entram aqui)

---

## Implementação

### T-14 — Parsing do cabeçalho `Range`

**Cobre:** RF-02, RF-03, RF-04, RF-05

**Depende de:** T-13

**Aceite:** Em `src/utils/static.ts`, no fim do arquivo, existem `RANGE_RE` e `parseByteRange` sem `export`, como em D-05 e no contrato do techspec. Retornam `{ start, end }`, `"unsatisfiable"` ou `undefined` conforme a tabela de D-04. Os testes de T-03 a T-06 passam (exceto os que dependem de integração com `serveStatic`, que ficam para T-18). `pnpm typecheck` passa.

**Arquivos:** `src/utils/static.ts`

### T-15 — Validação de `If-Range` e leitura do `Range` da requisição

**Cobre:** RF-07

**Depende de:** T-14

**Aceite:** `isIfRangeMatch` e `readRange` existem sem `export`, com a lógica de D-06 (ETag forte com comparação exata, `W/` com caixa exata, data por `Date.parse` contra `mtime` truncado em segundos, sem `mtime` nunca coincide). `readRange` retorna `undefined` quando não há `Range`, quando `If-Range` não coincide, ou delega a `parseByteRange`. Os testes de If-Range em T-08 passam quando chamados pela integração (T-18), e os casos unitários de `isIfRangeMatch` passam.

**Arquivos:** `src/utils/static.ts`

### T-16 — Recorte do corpo por tipo de `getContents`

**Cobre:** RF-02 (corpo), D-07

**Depende de:** T-13

**Aceite:** `sliceContents` existe sem `export` e trata `string`, `ArrayBuffer`, `ArrayBufferView`, `Blob` e, por fallback, `BodyInit` via `new Response(contents).body`. Para `string`, `Blob`, `ArrayBuffer` e views, o recorte não lê o conteúdo além do necessário. Os testes de T-11 passam (com a integração de T-18) para os tipos que não são stream.

**Arquivos:** `src/utils/static.ts`

### T-17 — Recorte de `ReadableStream` com demanda e cancelamento

**Cobre:** RF-10

**Depende de:** T-16

**Aceite:** `sliceStream` existe sem `export`, com `highWaterMark: 0` na saída, emite só os bytes do intervalo, fecha e cancela a origem ao passar de `end`, e encaminha `cancel` ao leitor. O teste de T-10 passa com a integração de T-18. Não há vazamento de leitor: o `reader.cancel()` é chamado no caso normal.

**Arquivos:** `src/utils/static.ts`

### T-18 — Integração em `serveStatic`: `Accept-Ranges`, 206, 416 e HEAD

**Cobre:** RF-01, RF-02, RF-04, RF-06, RF-08

**Depende de:** T-14, T-15, T-16, T-17

**Aceite:** Entre o `content-length` do 200 e o HEAD 200 de `serveStatic`, entram os blocos de D-03 (`accept-ranges` só com `size` numérico e só se o header não existir), D-04 (chamada a `readRange`), D-08 (`content-range` e `content-length` via `event.res.headers.set`, `statusText` "Partial Content" e "Range Not Satisfiable") e D-09 (HEAD e 416 não chamam `getContents`). O bloco de 304 não muda. Todos os testes de T-01 a T-11 passam em `web` e `node`. `pnpm vitest run test/static.test.ts` passa para os testes novos e existentes.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts` (somente se algum teste existente precisar de ajuste por causa de `accept-ranges`, conforme R5)

---

## Verificação e documentação

### T-19 — Ajustar testes existentes afetados por `Accept-Ranges`

**Cobre:** RF-11

**Depende de:** T-18

**Aceite:** Rodando `pnpm vitest run test/static.test.ts test/security.test.ts`, todos os testes existentes passam. Se algum teste anterior comparar o conjunto de headers de forma exata e falhar por causa de `accept-ranges`, só essa asserção é ajustada e o que o teste verifica continua verificado. Nenhum teste é removido.

**Arquivos:** `test/static.test.ts`, `test/security.test.ts` (somente se necessário)

### T-20 — Documentar Range no JSDoc de `serveStatic`

**Cobre:** RF-12 (documentação gerada, sem nova API)

**Depende de:** T-18

**Aceite:** O JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) ganha um parágrafo curto sobre suporte a Range em GET e HEAD, com o que não é suportado (múltiplas faixas). Rodando `pnpm fmt`, `docs/2.utils/2.response.md` é regenerado pelo `automd`, e a seção não é editada à mão. `git diff` mostra só o parágrafo novo e a regeneração esperada.

**Arquivos:** `src/utils/static.ts`, `docs/2.utils/2.response.md`

### T-21 — Nenhuma API pública nova

**Cobre:** RF-12

**Depende de:** T-18

**Aceite:** `src/index.ts` não muda, e `git diff master -- src/index.ts` fica vazio. `ServeStaticOptions`, `getMeta`, `getContents` e a assinatura de `serveStatic` não mudam. Os helpers novos não aparecem em nenhum `export`. `pnpm vitest run test/unit/package.test.ts` passa e `pnpm typecheck` passa.

**Arquivos:** `src/index.ts` (somente leitura; alterar só se o teste de exportações exigir)

### T-22 — Verificação final

**Cobre:** RF-01 a RF-12

**Depende de:** T-19, T-20, T-21

**Aceite:** `pnpm fmt` roda antes de `pnpm lint` e não deixa diferenças. `pnpm test` passa: lint, typecheck e cobertura. `pnpm build` passa. Os testes de Range passam em `web` e `node`. Os riscos R1 a R12 do PRD e do techspec ficam registrados na descrição do PR, com a decisão de cada um (aceito, mitigado, ou pendente de mantenedor).

**Arquivos:** nenhum arquivo novo; revisão de `src/utils/static.ts`, `test/static.test.ts`, `docs/2.utils/2.response.md`
