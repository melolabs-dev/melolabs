# Tarefas de implementação: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (decisões D-01 a D-11 e casos da seção 5).

A ordem segue AGENTS.md: testes primeiro (vermelho), depois implementação (verde), depois regressão e qualidade. Todas as tarefas de implementação dependem das tarefas de teste correspondentes.

## Pendências antes de T-09

Os pontos da techspec (seção 7) ainda não foram confirmados pelo time. T-09 só deve começar depois que cada um for confirmado ou aceito com o padrão já escrito na techspec:

1. `If-Range` com data: ignorar (D-08, padrão adotado).
2. `bytes=-n` com `n` maior que o arquivo (206 com o arquivo inteiro) e `bytes=-0` (416) (D-07).
3. `Vary` sem `range` (D-10, padrão adotado).
4. `accept-ranges` emitido mesmo sem `size` (D-02 e D-09, padrão adotado).
5. Helpers em `static.ts` e não em `utils/internal/range.ts` (D-11, padrão adotado).

## Testes

### T-01 — Testes de Accept-Ranges em respostas 200
Cobre: RF-01
Depende de: nenhuma
Descrição: criar o bloco `describeMatrix("serve static range", ...)` no fim de `test/static.test.ts`, com fixture de 1000 bytes (`"0123456789"` repetido 100 vezes), parametrizado por `string`, `Blob` e `ReadableStream` (um stream novo por requisição). Incluir o caso sem `Range`.
Aceite: rodando `pnpm vitest run test/static.test.ts`, o caso sem `Range` falha antes da implementação, porque falta `accept-ranges: bytes`. Os blocos existentes continuam sem alteração.
Arquivos: `test/static.test.ts`

### T-02 — Testes de intervalo único e 206
Cobre: RF-02, RF-03
Depende de: T-01
Descrição: testes para `bytes=100-199`, `bytes=900-` e `bytes=-100` (bytes e `Content-Range` corretos) e para `bytes=500-1500`, que deve retornar 206, `bytes 500-999/1000`, `Content-Length: 500` e os bytes 500 a 999.
Aceite: os casos falham antes da implementação. Depois, cada um confere o corpo byte a byte nos três tipos de `getContents`.
Arquivos: `test/static.test.ts`

### T-03 — Testes de 416 para intervalo não satisfazível
Cobre: RF-04
Depende de: T-02
Descrição: `bytes=1000-` e `bytes=1000-1200` retornam 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio. Incluir também o caso de size 0 com qualquer `Range` (416, `bytes */0`).
Aceite: os casos falham antes da implementação e passam depois, nos modos `web` e `node`.
Arquivos: `test/static.test.ts`

### T-04 — Testes de Range ignorado
Cobre: RF-05
Depende de: T-01
Descrição: `bytes=0-1,5-9` (multi-range), `items=0-9` (unidade diferente), `bytes=abc`, `bytes=-` e `bytes=9-3` (início maior que o fim) devem retornar 200 com corpo completo e sem `Content-Range`.
Aceite: os casos passam sem erro e sem `Content-Range`, e nenhum deles gera 416 nem exceção.
Arquivos: `test/static.test.ts`

### T-05 — Testes de HEAD com Range
Cobre: RF-06
Depende de: T-02
Descrição: `HEAD` com `bytes=0-99` deve retornar 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.
Aceite: o caso falha antes da implementação e passa depois, com o mesmo status e cabeçalhos do `GET` equivalente.
Arquivos: `test/static.test.ts`

### T-06 — Testes de Range sobre variante pré-comprimida
Cobre: RF-07
Depende de: T-02
Descrição: fixture `app.js` (1000 bytes) e `app.js.gz` (300 bytes), com `getMeta` que devolve `size` diferente para `.gz`. Com `accept-encoding: gzip` e `bytes=0-99`, a resposta deve ser 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/300` e os bytes 0 a 99 da variante.
Aceite: o caso falha antes da implementação e passa depois, usando o `size` da variante e não o do asset base.
Arquivos: `test/static.test.ts`

### T-07 — Testes de If-Range
Cobre: RF-08
Depende de: T-02
Descrição: com `ETag: "abc"`, `Range: bytes=0-9` e `If-Range: "xyz"` retornam 200 completo; `If-Range: "abc"` retorna 206 com bytes 0 a 9; `If-Range: W/"abc"` retorna 200; `If-Range` com data HTTP retorna 200 (padrão D-08).
Aceite: os casos passam conforme o critério do PRD, e o caso de `If-Range` que falha não gera 416 quando o `Range` é insatisfazível.
Arquivos: `test/static.test.ts`

### T-08 — Testes de preservação de comportamento
Cobre: RF-09
Depende de: T-02, T-03
Descrição: `If-None-Match` igual ao `ETag` com `Range` válido retorna 304 sem corpo e sem `Content-Range`; `POST` com `Range` continua 405; asset inexistente com `Range` continua 404 (e com `fallthrough: true` segue para o próximo handler); asset sem `size` retorna 200 sem `Content-Range`, com `accept-ranges`; `options.headers` com `content-length` e `Range` válido resulta no `content-length` do trecho (D-05); 206 e 416 mantêm `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` e `Content-Encoding` da resposta completa.
Aceite: os casos falham ou passam conforme o estado atual, e os blocos existentes de `test/static.test.ts` (em especial as linhas 199-207, 251-254 e 600-617) continuam sem mudança de expectativa.
Arquivos: `test/static.test.ts`

## Implementação

### T-09 — Helpers privados de Range em `static.ts`
Cobre: RF-02, RF-05, RF-08
Depende de: T-01, T-02, T-04, T-07
Descrição: adicionar ao fim de `src/utils/static.ts`, sem `export`, as funções `parseByteRange`, `matchesIfRange`, `evaluateRange` e `sliceBody` (contratos na techspec, seção 4). `parseByteRange` usa a regex de D-07 sobre o valor com `trim()`. `matchesIfRange` aceita só entity-tag forte idêntica ao `ETag` do asset. `sliceBody` usa `slice` para `Blob` e `TransformStream` para os demais `BodyInit`.
Aceite: os testes de T-02, T-04 e T-07 passam nos modos `web` e `node`. Nenhuma função nova aparece em `src/index.ts`.
Arquivos: `src/utils/static.ts`

### T-10 — Integração do Range no fluxo de `serveStatic`
Cobre: RF-01, RF-03, RF-04, RF-06, RF-07
Depende de: T-03, T-05, T-06, T-09
Descrição: (1) definir `accept-ranges: bytes` após `ETag` e `Last-Modified` e antes do 304 (D-02); (2) inserir o bloco de Range entre `content-length` e o ramo HEAD (D-01), com `content-range` e `content-length` definidos por `set` (D-05), 416 e 206 retornados como `HTTPResponse` (D-06), e HEAD sem corpo (D-03 para a variante escolhida).
Aceite: os testes de T-01, T-02, T-03, T-05 e T-06 passam nos modos `web` e `node`, e o bloco de 200 existente não muda.
Arquivos: `src/utils/static.ts`

## Verificação

### T-11 — Regressão, lint, tipos e exportações
Cobre: RF-09, RF-10, RF-11
Depende de: T-08, T-10
Descrição: rodar `pnpm vitest run test/static.test.ts` e confirmar que todos os casos de T-01 a T-08 passam sem alterar expectativas dos blocos existentes; rodar `pnpm lint` e `pnpm typecheck`; conferir que `src/index.ts` não foi alterado e que não há nomes novos exportados (RF-10). Opcional: `pnpm vitest --run --coverage` para ver os ramos novos de `static.ts`.
Aceite: `pnpm lint` e `pnpm typecheck` terminam sem erros; `git diff -- src/index.ts` vazio; suíte de `serveStatic` verde.
Arquivos: `test/static.test.ts`, `src/utils/static.ts`, `src/index.ts` (apenas verificação, sem alteração)

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 Accept-Ranges | T-01, T-10 |
| RF-02 Intervalo único | T-02, T-09 |
| RF-03 Resposta 206 | T-02, T-10 |
| RF-04 Resposta 416 | T-03, T-10 |
| RF-05 Range ignorado | T-04, T-09 |
| RF-06 HEAD com Range | T-05, T-10 |
| RF-07 Variante pré-comprimida | T-06, T-10 |
| RF-08 If-Range | T-07, T-09 |
| RF-09 Preservação | T-08, T-11 |
| RF-10 Sem exportações novas | T-11 |
| RF-11 Qualidade | T-11 |
