# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09).

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow"): primeiro os testes, com confirmação de que falham; depois a implementação, em `src/utils/static.ts`. Todos os testes novos ficam em `test/static-range.test.ts`, com `describeMatrix`.

Pontos em aberto da techspec que valem para as tarefas abaixo (§7): manter os helpers em `static.ts` (D-01, padrão deste plano), aceitar a leitura integral de `ReadableStream` (D-05, padrão deste plano) e o limite de custo do benchmark (T-17).

---

### T-01 — Fixture e base dos testes de Range

Criar `test/static-range.test.ts` com `describeMatrix`. Fixture: asset de 1000 bytes com conteúdo `"0123456789".repeat(100)`, de modo que o byte na posição `i` seja `i % 10`. Usar `etag: "v1"` (não `"w/123"`, ver techspec §1) e um `last-modified` fixo. Incluir helper de requisição que aceita método e cabeçalhos. Nenhum caso de comportamento nesta tarefa, só a base e um teste de sanidade (GET sem `Range` devolve 200 com o corpo completo).

**Cobre:** RF-11
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static-range.test.ts` roda nos modos `web` e `node` e o teste de sanidade passa sem nenhuma alteração em `src/`.

**Arquivos:** `test/static-range.test.ts`

---

### T-02 — Testes de `Accept-Ranges` em 200 (GET e HEAD)

Escrever os casos de RF-01: GET sem `Range` retorna 200 com `accept-ranges: bytes`; HEAD também. Escrever também o caso de RF-09 de 404 e 405 sem `accept-ranges`, para fixar o comportamento que deve continuar igual. O caso de 405 usa `POST` com `Range` e verifica `allow: GET, HEAD`.

**Cobre:** RF-01, RF-09
**Depende de:** T-01
**Aceite:** os casos de GET/HEAD 200 com `accept-ranges` falham antes da implementação (T-11); os casos de 404 e 405 passam já na base.

**Arquivos:** `test/static-range.test.ts`

---

### T-03 — Testes de 206 para intervalo único válido

Escrever os casos de RF-02 e RF-03 com o asset de 1000 bytes: `bytes=0-99` (corpo com bytes 0 a 99, `content-range: bytes 0-99/1000`); `bytes=500-` e `bytes=-100`. Para `bytes=-100`, verificar `content-range: bytes 900-999/1000`, `content-length: 100`, o corpo com os últimos 100 bytes e a presença de `content-type`, `etag`, `last-modified` e `vary`.

**Cobre:** RF-02, RF-03
**Depende de:** T-01
**Aceite:** os casos falham antes da implementação (T-14) e passam depois, nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-04 — Testes de HEAD com `Range`

Escrever o caso de RF-04: HEAD com `bytes=0-99` retorna 206, `content-range: bytes 0-99/1000`, `content-length: 100`, os mesmos cabeçalhos do GET e corpo vazio.

**Cobre:** RF-04
**Depende de:** T-01
**Aceite:** o caso falha antes de T-14 e passa depois, nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-05 — Testes de 416 (intervalo não satisfazível)

Escrever os casos de RF-05: `bytes=1000-1100` retorna 416, `content-range: bytes */1000`, `content-length: 0` e sem corpo. Incluir `bytes=-0`, e qualquer `Range` (por exemplo `bytes=0-9`) em um asset de tamanho zero. Incluir também um `last` grande (`bytes=0-99999999999999999999`), que tem que cair em 200 ou 206 e não em erro (ver techspec §6, números grandes).

**Cobre:** RF-05
**Depende de:** T-01
**Aceite:** os casos falham antes de T-12 e T-14 e passam depois, nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-06 — Testes de `Range` ignorado (malformado ou múltiplo)

Escrever os casos de RF-06, todos com resposta 200 completo e sem `content-range`: `bytes=0-10,20-30`; `items=0-9`; `bytes=5-2`; `bytes=-`; `bytes= 0-9`.

**Cobre:** RF-06
**Depende de:** T-01
**Aceite:** os casos passam depois de T-12 e falham antes (porque hoje não há 200 com `accept-ranges`, ou por causa do corpo, conforme o caso), nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-07 — Testes de `If-Range`

Escrever os casos de RF-07: `If-Range: "v1"` (igual) retorna 206; `If-Range: "v0"` retorna 200; `If-Range: W/"v1"` retorna 200 (ETag fraco nunca casa); data igual ao `last-modified` retorna 206; data diferente retorna 200; `If-Range` sem validador compatível (valor vazio ou lixo) retorna 200.

**Cobre:** RF-07
**Depende de:** T-01
**Aceite:** os casos de 206 falham antes de T-13 e os de 200 passam já na base ou depois de T-13, nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-08 — Testes de ordem de avaliação e tamanho desconhecido

Escrever os casos de RF-08: `getMeta` sem `size` com `Range: bytes=0-99` retorna 200 completo sem `content-range`. Escrever também: `If-None-Match: "v1"` com `Range: bytes=0-99` retorna 304 sem `content-range` e sem `accept-ranges` (D-02 da techspec: o 304 não recebe o cabeçalho).

**Cobre:** RF-08
**Depende de:** T-01
**Aceite:** o caso de 304 passa na base (porque o 304 não muda) e continua passando depois de T-11; o caso de tamanho desconhecido passa depois de T-12. Nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-09 — Testes de preservação: variante `.gz`, cache, fallthrough

Escrever os casos de RF-09 com `app.js` e `app.js.gz` de tamanho diferente: `accept-encoding: gzip` com `Range: bytes=0-9` retorna 206 com `content-encoding: gzip`, e `content-range` e `content-length` referentes ao `.gz`. Escrever também os casos D-06 (`getContents` devolve `undefined` com `Range`, resposta 200 sem `content-range`) e D-07 (`options.headers` com `content-length: 999` mais `Range` retorna 206 com `content-length` do trecho).

**Cobre:** RF-09
**Depende de:** T-01
**Aceite:** o caso `.gz` falha antes de T-14; os casos D-06 e D-07 falham ou passam conforme a implementação, e passam depois de T-14. Nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-10 — Testes de tipos de corpo (D-05)

Escrever um caso parametrizado de recorte de corpo com `Range: bytes=10-19`, para `string` (UTF-8, com caractere multibyte no meio do intervalo para cobrir a premissa de tamanho), `Blob`, `Uint8Array`, `ArrayBuffer` e `ReadableStream`. Conferir os bytes exatos do corpo retornado em cada um.

**Cobre:** RF-02
**Depende de:** T-01
**Aceite:** os casos falham antes de T-14 e passam depois, nos dois modos.

**Arquivos:** `test/static-range.test.ts`

---

### T-11 — Implementar `Accept-Ranges` depois do bloco 304

Em `src/utils/static.ts`, setar `event.res.headers.set("accept-ranges", "bytes")` logo após o bloco do 304 (`src/utils/static.ts:243-248`), e não no início de `serveStatic` (D-02). Assim o cabeçalho não vaza para o 304 por `src/response.ts:201-204`.

**Cobre:** RF-01, RF-09
**Depende de:** T-02, T-08
**Aceite:** os casos de T-02 e T-08 passam (o de 304 sem `accept-ranges` continua verde); os casos de 404 e 405 continuam verdes; `pnpm vitest run test/static.test.ts` continua verde.

**Arquivos:** `src/utils/static.ts`

---

### T-12 — Parser de intervalo único, `selectRange` e regra de tamanho desconhecido

Em `src/utils/static.ts`, implementar as funções privadas `parseRange` e `selectRange`, com a regex estrita de D-03 e a ordem de checagem de techspec §4 (sufixo, `last < first`, `first >= size`, limite de `last` ao fim do asset). `selectRange` retorna `undefined` sem `Range` ou sem `size` (RF-08). Nesta tarefa `If-Range` ainda não é avaliado (entra em T-13). Não há ainda resposta 206 nem 416 (entram em T-14).

**Cobre:** RF-02, RF-05, RF-06, RF-08
**Depende de:** T-03, T-05, T-06, T-08, T-11
**Aceite:** os casos de RF-06 e de tamanho desconhecido (RF-08) passam; os casos de RF-02 e RF-05 que dependem só da seleção (por exemplo, a função devolve `"unsatisfiable"` para `bytes=1000-1100`) passam em testes unitários de `parseRange` em `test/unit/` ou via integração, conforme o estilo do projeto; o restante continua falhando até T-14.

**Arquivos:** `src/utils/static.ts`, `test/unit/` (somente se houver teste unitário de `parseRange`; caso contrário, o teste fica em `test/static-range.test.ts`)

---

### T-13 — Implementar `If-Range`

Em `src/utils/static.ts`, implementar `ifRangeMatches(validator, headers)` seguindo D-04: compara com `event.res.headers` (`etag` e `last-modified` que de fato saem); validador que começa com `W/` nunca casa; validador que começa com `"` casa só por igualdade exata com ETag forte atual; caso contrário, igualdade exata com `last-modified` (data inválida nunca casa). Ligar a função em `selectRange`: `If-Range` que não casa faz `selectRange` devolver `undefined`.

**Cobre:** RF-07
**Depende de:** T-07, T-12
**Aceite:** todos os casos de T-07 passam, nos dois modos; `W/"v1"` nunca produz 206.

**Arquivos:** `src/utils/static.ts`

---

### T-14 — Respostas 206, 416 e HEAD com corpo recortado

Em `src/utils/static.ts`, implementar `sliceBody` (D-05: `string` por `TextEncoder` com `subarray`; `Blob` com `slice`; demais tipos por `new Response(body).blob()`), `setPartialHeaders` (define `content-range` e `content-length`, sobrescrevendo valor anterior, D-07) e o fluxo final de techspec §3: 416 com `content-range: bytes */<size>` e `content-length: 0`; HEAD com range retorna 206 sem corpo; GET chama `getContents` e retorna 206 com o trecho, ou 200 completo se `getContents` devolver vazio (D-06). A seleção de `Range` acontece antes de `getContents` (D-08), então 416 não lê o corpo. Manter os helpers no próprio `static.ts` (D-01); se o mantenedor preferir `src/utils/internal/range.ts`, a troca é só de arquivo e não muda a API.

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-09
**Depende de:** T-04, T-05, T-09, T-10, T-13
**Aceite:** todos os casos de T-03, T-04, T-05, T-09 e T-10 passam, nos modos `web` e `node`; o 416 não chama `getContents` (checar com um spy no teste de T-05); `pnpm lint` passa.

**Arquivos:** `src/utils/static.ts`

---

### T-15 — Ajustar asserções existentes, se a suíte quebrar

Rodar `pnpm vitest run test/static.test.ts test/security.test.ts`. Se algum teste de cabeçalho quebrar por causa do novo `accept-ranges`, ajustar só a asserção afetada, sem remover o que ela verifica (techspec §3 e PRD, Premissas). Não alterar os fixtures `etag: "w/123"` sem necessidade (techspec §1 e §6).

**Cobre:** RF-11
**Depende de:** T-14
**Aceite:** `pnpm vitest run test/static.test.ts test/security.test.ts` passa nos modos `web` e `node`; o diff dos testes existentes só toca asserções de cabeçalho afetadas.

**Arquivos:** `test/static.test.ts`, `test/security.test.ts` (somente se houver quebra)

---

### T-16 — Verificar que não há novas exportações públicas

Confirmar que `src/index.ts` não mudou (RF-10) e que `ServeStaticOptions` e `StaticAssetMeta` mantêm o formato. Rodar `test/unit/package.test.ts`, que já compara a lista de exports (`test/unit/package.test.ts:133`). Comparar a lista de exports com a versão anterior ao commit de trabalho.

**Cobre:** RF-10
**Depende de:** T-14
**Aceite:** `pnpm vitest run test/unit/package.test.ts` passa; `git diff -- src/index.ts` vazio; a lista de exports é idêntica à anterior.

**Arquivos:** nenhum arquivo alterado; a verificação é de leitura e execução de `test/unit/package.test.ts`

---

### T-17 — Benchmark de custo do 206 e regressão do 200

Criar o benchmark em `test/bench/` seguindo o formato dos benches existentes (techspec §5). Medir: 200 sem `Range` antes e depois da mudança (não pode regredir); 206 com asset de 1 MB, 50 MB e `ReadableStream` do mesmo tamanho. Rodar `pnpm bench:node`. Registrar os números no PR. Definir com o mantenedor o limite aceitável de custo do 206 (PRD, Riscos; techspec §7, item 3) antes de dar a entrega por concluída.

**Cobre:** RF-02 (custo do 206), RF-09 (200 sem regressão)
**Depende de:** T-14
**Aceite:** o benchmark roda com `pnpm bench:node`; a comparação do 200 antes e depois está registrada; os números do 206 estão no PR e o limite foi decidido com o mantenedor.

**Arquivos:** `test/bench/static-range.bench.ts` (nome a confirmar pelo formato dos benches existentes)

---

### T-18 — Verificação final: lint, typecheck e suíte completa

Rodar `pnpm lint`, `pnpm typecheck` e `pnpm test` (lint, typecheck e cobertura). Garantir que a cobertura não cai nos arquivos tocados. Se algo falhar, corrigir na tarefa de origem, não aqui.

**Cobre:** RF-11
**Depende de:** T-15, T-16, T-17
**Aceite:** `pnpm lint`, `pnpm typecheck` e `pnpm test` passam sem erros. Os testes de `serveStatic` passam nos modos `web` e `node`.

**Arquivos:** nenhum arquivo novo; a verificação roda sobre os arquivos das tarefas anteriores
