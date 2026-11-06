# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-09, premissas P1 a P7) e `sdd/techspec.md` (decisões D-01 a D-09).

Ordem: primeiro os testes (regressão e casos de Range), depois a implementação, seguindo o fluxo de bug fix do `AGENTS.md`. Os testes ficam em `test/static.test.ts`, em um novo `describeMatrix` com `beforeEach` próprio, rodando em `web` e `node`.

### T-01 — Baseline de regressão do comportamento atual
Cobre: RF-09
Depende de: nenhuma
Aceite: testes sem `Range` cobrem 200, 304 (`If-None-Match` e `If-Modified-Since`), 404, 405, fallthrough e seleção de encoding. Todos passam antes de qualquer mudança em `src/utils/static.ts`. O teste existente `test/static.test.ts:600-617` continua passando.
Arquivos: `test/static.test.ts`

### T-02 — Testes de Accept-Ranges
Cobre: RF-01
Depende de: T-01
Aceite: `GET` e `HEAD` sem `Range` em asset encontrado trazem `accept-ranges: bytes`. 304, 404 e 405 não trazem. Os casos de 200 falham antes da implementação.
Arquivos: `test/static.test.ts`

### T-03 — Testes de intervalo único e limites
Cobre: RF-02, RF-03
Depende de: T-01
Aceite: `bytes=a-b`, `bytes=a-` e `bytes=-n` retornam 206 com `content-range` e `content-length` exatos, e o corpo é igual ao `slice` do conteúdo. `b >= N` é limitado a `N-1`. `bytes=-n` com `n > N` devolve o arquivo inteiro com 206 (P7). Os casos falham antes da implementação.
Arquivos: `test/static.test.ts`

### T-04 — Testes de 416 e de Range ignorado
Cobre: RF-04, RF-05
Depende de: T-01
Aceite: `a >= N` (em `bytes=a-` e `bytes=a-b`) retorna 416 com `content-range: bytes */N`, `content-length: 0` e corpo vazio, inclusive com N = 0. Retornam 200 completo, sem `content-range`: multi-range (`bytes=0-1,3-4`), unidade `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=-` e dígitos com 16 ou mais caracteres. `bytes=-0` retorna 416 (P3).
Arquivos: `test/static.test.ts`

### T-05 — Testes de HEAD com Range
Cobre: RF-06
Depende de: T-01
Aceite: `HEAD` com Range válido (206) e com Range não satisfazível (416) tem o mesmo status, `content-range` e `content-length` do `GET` equivalente, com corpo vazio. Um spy confirma que `getContents` não é chamado no `HEAD`.
Arquivos: `test/static.test.ts`

### T-06 — Testes de representação pré-comprimida
Cobre: RF-07
Depende de: T-01
Aceite: com `encodings: { gzip: ".gz" }` e `accept-encoding: gzip`, `Range: bytes=0-9` usa o `size` que `getMeta` devolve para o id `.gz` em `content-range`. `content-encoding: gzip` e `vary: accept-encoding` são mantidos.
Arquivos: `test/static.test.ts`

### T-07 — Testes de If-Range
Cobre: RF-08
Depende de: T-01
Aceite: com `ETag` `"v1"`, `If-Range: "v0"` retorna 200 completo, `If-Range: "v1"` retorna 206, e `If-Range: W/"v1"` retorna 200. Sem `If-Range`, retorna 206. `If-Range` com data HTTP retorna 200 (P6). `ETag` ausente retorna 200.
Arquivos: `test/static.test.ts`

### T-08 — Testes de fatiamento do corpo
Cobre: RF-02, RF-03
Depende de: T-01
Aceite: `getContents` que devolve `ReadableStream` com chunks de tamanhos irregulares e `getContents` que devolve `Blob` produzem o mesmo trecho para o mesmo Range. Para o stream, um contador de chunks lidos mostra que a leitura para após `end`. Se algum runtime não cancelar a origem, aplica-se o fallback de R11 do techspec e o teste registra a diferença.
Arquivos: `test/static.test.ts`

### T-09 — Parser de Range e validação de If-Range
Cobre: RF-02, RF-03, RF-04, RF-05, RF-08
Depende de: T-03, T-04, T-07
Aceite: `parseRangeHeader`, `ifRangeMatches` e `strongETagMatch` existem em `src/utils/static.ts` sem `export`, seguindo a tabela de D-04 e as regras de D-05. Os casos de parsing de T-03, T-04 e T-07 passam.
Arquivos: `src/utils/static.ts`

### T-10 — Fatiamento do corpo com sliceBody
Cobre: RF-02, RF-03
Depende de: T-08
Aceite: `sliceBody` (D-02) usa `Blob.slice` para `Blob` e, para os demais tipos, `Response` com `TransformStream` que chama `terminate` após `end`. Não há leitura integral do conteúdo para `Blob`. Os testes de T-08 passam. A função não tem `export`.
Arquivos: `src/utils/static.ts`

### T-11 — Accept-Ranges nas respostas que servem asset
Cobre: RF-01, RF-09
Depende de: T-02
Aceite: `accept-ranges: bytes` é definido depois do bloco 304 (D-03 e D-08) e aparece em 200, 206 e 416. Não aparece em 304, 404 nem 405. Os testes de T-02 passam. A premissa P4 é confirmada antes da entrega.
Arquivos: `src/utils/static.ts`

### T-12 — Ramo 206 e 416 no fluxo de serveStatic
Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-03, T-04, T-05, T-06, T-09, T-10, T-11
Aceite: o ramo do Range fica entre `content-encoding` e `content-length` (D-03). Em 206 e 416, `content-length` é sobrescrito (D-06). Se `getContents` devolve `null` com Range válido, a resposta é 200 como hoje (D-07). `meta.size === 0` retorna 416. O `size` usado é o da variante (RF-07). `HEAD` não chama `getContents`. Os testes de T-03, T-04, T-05, T-06 e T-08 passam. O teste de `test/static.test.ts:600-617` continua passando.
Arquivos: `src/utils/static.ts`

### T-13 — Ordem condicional: 304, If-Range e Range
Cobre: RF-08, RF-09
Depende de: T-07, T-09, T-12
Aceite: `If-None-Match` com Range retorna 304, porque a checagem condicional vem antes do Range. `If-Range` é avaliado depois do 304 e antes do Range. Fallthrough com Range em asset inexistente segue adiante. Os testes de T-07 e T-01 passam. A premissa P6 é confirmada antes da entrega.
Arquivos: `test/static.test.ts`, `src/utils/static.ts`

### T-14 — Verificação final de API pública e qualidade
Cobre: RF-09
Depende de: T-11, T-12, T-13
Aceite: `git diff -- src/index.ts` está vazio. As funções auxiliares não têm `export`. `pnpm vitest run test/static.test.ts`, `pnpm test`, `pnpm lint`, `pnpm typecheck` e `pnpm build` passam. As premissas P4 e P6 e o desvio de tamanho de D-01 (R7) ficam registrados para revisão.
Arquivos: nenhum arquivo alterado; somente verificação

---

## Cobertura dos requisitos

| RF | Tarefas |
|---|---|
| RF-01 | T-02, T-11 |
| RF-02 | T-03, T-08, T-09, T-10, T-12 |
| RF-03 | T-03, T-08, T-09, T-10, T-12 |
| RF-04 | T-04, T-09, T-12 |
| RF-05 | T-04, T-09 |
| RF-06 | T-05, T-12 |
| RF-07 | T-06, T-12 |
| RF-08 | T-07, T-09, T-13 |
| RF-09 | T-01, T-11, T-13, T-14 |
