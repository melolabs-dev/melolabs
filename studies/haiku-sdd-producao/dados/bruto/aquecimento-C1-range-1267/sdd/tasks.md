# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (decisões D-01 a D-10, estratégia de testes), `AGENTS.md` (fluxo de bug fix: teste vermelho antes do código).

Ordem geral: primeiro os testes de regressão (T-01, T-02), depois a implementação (T-03 a T-07), por último a verificação (T-08, T-09). Todas as tarefas tocam só o que está listado no rodapé de cada uma.

### T-01 — Testes de regressão: anúncio, intervalo e 416
Cobre: RF-01, RF-02, RF-03, RF-04, RF-05
Depende de: nenhuma
Aceite: em `test/static.test.ts`, novo `describeMatrix("serve static range", ...)` no fim do arquivo com os casos 1 a 5 da techspec. Cobre: `accept-ranges: bytes` em 200 e ausente em 404; `bytes=100-199`, `bytes=900-` e `bytes=-100` em asset de 1000 bytes dão 206 com os bytes certos; `bytes=500-2000` dá `content-range: bytes 500-999/1000` e `content-length: 500`; `bytes=1000-1100` e `bytes=-0` dão 416 com `content-range: bytes */1000`, `content-length: 0` e corpo vazio; `bytes=0-9,20-29`, `items=0-9`, `bytes=abc`, `bytes=500-100`, `bytes=` e `bytes=-` dão 200 sem `content-range` e com corpo completo. Rodando `pnpm vitest run test/static.test.ts`, os casos novos falham e os existentes continuam verdes, antes de qualquer alteração em `src/`.
Arquivos: `test/static.test.ts`

### T-02 — Testes de regressão: HEAD, encoding, If-Range, preservação e tamanho
Cobre: RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: no mesmo bloco `describeMatrix("serve static range", ...)`, casos 6 a 10 da techspec. Cobre: HEAD com `bytes=0-9` dá 206, `content-range: bytes 0-9/1000`, `content-length: 10`, corpo vazio, e `getContents` não é chamado (espião `vi.fn`); HEAD com Range que resulta em 416 segue a mesma regra. Com `app.js` de 1000 bytes e `app.js.gz` de 300 bytes, `accept-encoding: gzip` e `bytes=0-99` dão 206 com `content-encoding: gzip`, `content-range: bytes 0-99/300` e `content-length: 100`. If-Range: etag divergente dá 200 completo; etag igual dá 206 com bytes 0 a 9; `W/"abc"` dá 200; data igual ao `last-modified` dá 206; data diferente dá 200; unidade inválida dá 200. `If-None-Match` igual ao etag com `Range` dá 304 sem corpo; `POST` com `fallthrough: false` dá 405 com `allow: GET, HEAD`; `etag`, `last-modified`, `cache-control`, `vary`, `content-type` e `content-encoding` são iguais entre 200 e 206; `size: 0` e `size` ausente ignoram Range e dão 200. Os casos novos falham antes da implementação.
Arquivos: `test/static.test.ts`

### T-03 — Auxiliares privados de parsing de Range e If-Range
Cobre: RF-02, RF-05, RF-08
Depende de: T-01, T-02
Aceite: em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, sem nenhum `export`: tipo `RangeOutcome`, `parseRangeValue`, `matchesIfRange` e `resolveRange`, seguindo D-03 a D-05 da techspec. Regras: unidade sem diferenciar maiúsculas; multi-range, unidade diferente, sintaxe inválida e início maior que fim geram `ignore`; regex `^(\d*)-(\d*)$` com ambos os lados vazios gerando `ignore`; `bytes=-0` gera `unsatisfiable`; sufixo `-n` vira `[max(0, size-n), size-1]`; fim limitado a `size-1`; início >= `size` gera `unsatisfiable`. If-Range: weak nunca casa, etag forte exige igualdade byte a byte, data casa por igualdade exata com `mtime` truncado para segundos, data inválida não casa. `pnpm typecheck` passa. A verificação HTTP fica para T-04, pois sem a ligação ao `serveStatic` os testes de T-01 e T-02 seguem vermelhos.
Arquivos: `src/utils/static.ts`

### T-04 — Integração no `serveStatic`: Accept-Ranges, 206, 416 e HEAD
Cobre: RF-01, RF-03, RF-04, RF-06, RF-09
Depende de: T-03, T-05
Aceite: em `src/utils/static.ts`, seguindo os passos 1, 5 e 6 do "Fluxo proposto" da techspec. `accept-ranges: bytes` com guarda `has`, logo após o etag e antes do 304. Bloco de Range logo após o `content-length` do asset completo e antes do HEAD. 206 com `content-range` e `content-length` definidos com `set` (sobrescreve `options.headers` só nesse caso). 416 com `new HTTPResponse(null, ...)`, `content-range: bytes */<size>` e `content-length: 0`. HEAD com Range não chama `getContents`. Os casos de RF-01, RF-03, RF-04 e RF-06 de T-01 e T-02 passam, junto com os testes existentes de `test/static.test.ts` (200, 304, 404, 405, encodings e o teste de `content-length` de `options.headers` nas linhas 600 a 617).
Arquivos: `src/utils/static.ts`

### T-05 — Corte do corpo por tipo (`sliceBody`)
Cobre: RF-03
Depende de: T-02
Aceite: função privada `sliceBody(body, start, endExclusive)` conforme D-07. Fatia por bytes, nunca por caracteres: `Blob.slice`; `ArrayBuffer` e `Uint8Array` por cópia ou `subarray`; `string` codificada em UTF-8 antes do corte; `ReadableStream` descarta bytes antes de `start` e cancela a leitura ao chegar em `end`; demais `BodyInit` via `new Response(body).arrayBuffer()`; `null` ou `undefined` devolve `null`. Caso 11 da techspec escrito antes da implementação, com `ReadableStream`, `Blob`, `Uint8Array`, `ArrayBuffer` e `string` com UTF-8 multibyte, todos com o trecho esperado. JSDoc registra o custo de memória dos tipos que não são stream (R-01).
Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-06 — Intervalo sobre a variante pré-comprimida
Cobre: RF-07
Depende de: T-04
Aceite: confirmar, no fluxo de seleção de encoding atual de `src/utils/static.ts`, que o `size` usado pelo Range é o da variante escolhida (`.gz` ou `.br`), e ajustar se não for. Caso de `app.js.gz` de T-02 passa: 206, `content-encoding: gzip`, `content-range: bytes 0-99/300`, `content-length: 100`. `vary` continua correto.
Arquivos: `src/utils/static.ts`, `test/static.test.ts` (somente se faltar caso)

### T-07 — Preservação de 304, 404, 405, cache e encoding
Cobre: RF-09
Depende de: T-04
Aceite: 304 por `If-None-Match` com `Range` continua sem corpo e sem alteração de fluxo (premissa 3 do PRD); `fallthrough: false` com `POST` continua 405 com `allow: GET, HEAD`; `etag`, `last-modified`, `cache-control`, `vary`, `content-type` e `content-encoding` iguais entre 200 e 206; `content-length` de `options.headers` preservado quando não há Range. Adicionar caso de regressão só se algum comportamento ficar descoberto.
Arquivos: `src/utils/static.ts`, `test/static.test.ts` (somente se faltar caso)

### T-08 — Confirmar que nenhuma exportação pública foi adicionada
Cobre: RF-10
Depende de: T-04, T-05
Aceite: a lista de exports de `src/index.ts` é idêntica à de antes da mudança (`src/index.ts` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`). `pnpm vitest run test/unit/package.test.ts` passa sem alterar o snapshot (linhas 4 a 6 e 133). Nenhum símbolo novo de Range tem `export`.
Arquivos: nenhum alterado (verificação de `src/index.ts` e `test/unit/package.test.ts`)

### T-09 — Gates de qualidade e documentação de riscos
Cobre: RF-09, RF-10
Depende de: T-06, T-07, T-08
Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/rules` e `pnpm test` completo passam, sem alterar configuração de lint, typecheck ou testes. Eventuais erros de `BodyInit` com `Uint8Array` resolvidos conforme R-07. JSDoc de `serveStatic` registra o override de `content-length` em 206 (R-09). A PR registra o tamanho de `static.ts` acima da recomendação de `AGENTS.md` (R-06) e o custo de corte de corpo (R-01).
Arquivos: `src/utils/static.ts` (JSDoc), eventuais ajustes de `test/static.test.ts`

## Pendências que afetam as tarefas

Confirmar com o responsável antes de fechar a tarefa indicada. Até lá, a implementação segue a decisão padrão da techspec.

- **P-01** (`bytes=-0` como 416): afeta T-01 e T-03. Decisão padrão: 416.
- **P-02** (`size` 0 ignora Range, em vez de 416 da RFC): afeta T-02 e T-03. Decisão padrão: ignorar.
- **P-03** (If-Range com data sem a regra de idade mínima de 1 segundo): afeta T-03. Decisão padrão: igualdade exata, divergência documentada no PR.
- **P-04** (416 mantém cabeçalhos de cache e conteúdo): afeta T-04. Decisão padrão: manter.

## Cobertura dos requisitos do PRD

| Requisito | Tarefas |
| --- | --- |
| RF-01 Accept-Ranges | T-01, T-04 |
| RF-02 Formas de intervalo | T-01, T-03 |
| RF-03 Resposta 206 | T-01, T-04, T-05 |
| RF-04 Resposta 416 | T-01, T-04 |
| RF-05 Range ignorado | T-01, T-03 |
| RF-06 HEAD com Range | T-02, T-04 |
| RF-07 Variante pré-comprimida | T-02, T-06 |
| RF-08 If-Range forte | T-02, T-03 |
| RF-09 Preservação | T-02, T-07, T-09 |
| RF-10 Sem exportação nova | T-08, T-09 |
