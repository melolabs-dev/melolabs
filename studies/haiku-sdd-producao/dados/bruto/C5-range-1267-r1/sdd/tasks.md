# Tarefas: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-12), `sdd/techspec.md` (D-01 a D-09, R-01 a R-10).

Ordem de trabalho: seguir a ordem de dependências. A T-01 escreve os testes antes de qualquer mudança em `src/utils/static.ts` (ciclo de bug fix do `AGENTS.md`).

## Tarefas

### T-01 — Escrever os testes de Range antes da implementação

Criar o bloco `describeMatrix("serve static range", …)` em `test/static.test.ts`, antes de `:396`, com os casos da seção "Estratégia de testes" da techspec: 200 com `accept-ranges`, 206 (`bytes=2-5`, `bytes=-3`, `bytes=6-99`, `bytes=-99`), Range inválido ignorado, 416 (`bytes=10-20`, `bytes=-0`), HEAD, `size` ausente ou `0`, `If-Range`, 304 com `If-None-Match`, variante `.gz`, `fallthrough` e 405. Usar asset de 10 bytes com `getContents` devolvendo `"0123456789"` e `size: 10`. Usar `vi.fn` para confirmar que `getContents` não é chamado em HEAD.

Os casos novos devem falhar no código atual (200 completo, sem `content-range`). Os testes existentes devem continuar passando.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-12
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static.test.ts` mostra os casos novos falhando pelo motivo esperado (ausência de `206`/`416`/`accept-ranges`) e todos os casos antigos passando. Os casos rodam em `web` e `node`.

**Arquivos:** `test/static.test.ts`

### T-02 — `Accept-Ranges` em 200 e 304

Antes do bloco de cache (`src/utils/static.ts:243`), definir `accept-ranges: bytes` em `event.res.headers`, somente se o cabeçalho ainda não existir (D-05). Assim o cabeçalho aparece também no 304.

Registrar a divergência do PRD (RF-01 cita 200/206/416; a techspec escolhe também o 304). Pendência: confirmar com o time (R-07).

**Cobre:** RF-01, RF-08
**Depende de:** T-01
**Aceite:** os casos de `accept-ranges` do bloco novo passam em `web` e `node`, inclusive no 304. Os testes de cache existentes continuam passando.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-03 — Parser de `Range` e respostas 206/416 em GET

Antes de implementar, conferir `src/response.ts` para confirmar que `content-range` definido em `event.res.headers` chega à resposta quando `HTTPResponse` tem `status` customizado (R-09). Se não chegar, parar e registrar o problema antes de seguir.

Implementar:

- `RANGE_RE` e `parseRange(value, size)`, privadas em `src/utils/static.ts` (D-01, D-02): rejeita unidade diferente de `bytes`, múltiplas faixas, valores não numéricos, `bytes=-` e `first > last` (ignorados); `first >= size` e `-0` retornam `"unsatisfiable"`; fim maior que o arquivo é ajustado; sufixo maior que o arquivo devolve o arquivo inteiro como 206.
- Sequência nova no lugar de `src/utils/static.ts:268-277` (D-04, D-06, D-09): `Range` só é avaliado com `meta.size > 0`; 416 com `content-range: bytes */tamanho` e `content-length: 0`; 206 com `content-range` e `content-length` definidos com `set` (sobrescrevendo o valor do usuário).
- Para GET, usar `options.getContents(id)` e passar o resultado a `sliceBody` (a implementação de `sliceBody` entra na T-05; nesta tarefa basta um recorte para `string` e `ArrayBuffer`/`TypedArray`).

Garantir que o teste "does not overwrite a content-length already set on the response" (`test/static.test.ts:600-617`) continua passando (D-06).

**Cobre:** RF-02, RF-03, RF-04, RF-06
**Depende de:** T-02
**Aceite:** os casos de 206 (`bytes=2-5`, `bytes=-3`, `bytes=6-99`, `bytes=-99`), de Range ignorado (`bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=-`), de 416 (`bytes=10-20`, `bytes=-0`) e de `size` ausente ou `0` passam em `web` e `node`. O teste de `content-length` do usuário continua passando, e o caso com `headers: { "content-length": "999" }` e Range devolve `content-length` correto (D-06).

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-04 — Avaliação de `If-Range`

Implementar `ifRangeMatches(ifRange, { etag, mtime })`, privada (D-03):

- Se `If-Range` começa com `"`, comparar com igualdade exata, e só casar se o `etag` do asset for forte (não começa com `W/`).
- Caso contrário, tratar como data: casar se `new Date(ifRange).getTime()` for igual ao `mtime` já truncado a segundos (`src/utils/static.ts:232`).
- Sem validador no asset, não casar.
- Avaliar `If-Range` somente quando há `Range` (techspec, observações). Se não casar, ignorar o `Range` e responder 200 completo.

Não usar `isCacheMatch` (`src/utils/internal/cache.ts:29`), pois faz comparação fraca.

**Cobre:** RF-07
**Depende de:** T-03
**Aceite:** `etag: '"v1"'` com `If-Range: "v1"` dá 206; com `"v2"` dá 200. Data igual a `last-modified` dá 206; data diferente dá 200. `W/"v1"` com `If-Range: W/"v1"` dá 200. `If-Range` sem `Range` dá 200 completo. Caso R-04 (data com fração de segundo) dá 200, coberto por teste.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-05 — Recorte de corpo por tipo (`sliceBody`)

Implementar `sliceBody(contents, start, end)`, privada, com a estratégia por tipo da D-07:

- `string`: `TextEncoder` e `subarray`.
- `ArrayBuffer` e `ArrayBufferView`: `slice` ou `subarray`, respeitando `byteOffset`.
- `Blob` (inclui `File`): `blob.slice(start, end + 1)`.
- `ReadableStream`: `pipeThrough` com `TransformStream` que descarta `start` bytes e termina após `end - start + 1`. O upstream deve ser cancelado ao terminar (verificar pelo `cancel` do source no teste).
- Outros (`FormData`, `URLSearchParams`): `new Response(contents).arrayBuffer()` e depois `slice`.

Documentar no JSDoc de `serveStatic` o risco de I/O de R-01 e a premissa de `meta.size` de R-02.

**Cobre:** RF-02, RF-09
**Depende de:** T-03
**Aceite:** o mesmo intervalo (ex.: `bytes=2-5`) dá o mesmo corpo para `string`, `ArrayBuffer`, `Uint8Array` com `byteOffset` diferente de zero, `Blob` e `ReadableStream` com chunks que cruzam a fronteira do intervalo. No `ReadableStream`, o `cancel` do source é chamado após o último byte. Passa em `web` e `node`.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-06 — HEAD com Range

Garantir que a decisão de Range roda antes do ramo HEAD (`src/utils/static.ts:272-274`), para que HEAD receba o mesmo status e os mesmos cabeçalhos do GET, sem corpo (D-08). Em HEAD, 206 e 416 não chamam `getContents`. Sem Range, HEAD continua como hoje.

**Cobre:** RF-05, RF-08
**Depende de:** T-03
**Aceite:** HEAD com `bytes=2-5` dá 206 com `content-length: 4` e sem corpo. HEAD com `bytes=10-20` dá 416. `getContents` (`vi.fn`) não é chamado em nenhum dos dois. Um `If-None-Match` que casa com `Range` dá 304 sem corpo (RF-08).

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-07 — Preservar comportamentos existentes e variante pré-comprimida

Verificar que cache, seleção de encoding, `fallthrough`, 404 e 405 não mudaram quando não há `Range`. Confirmar que, com `fallthrough: true` e asset inexistente, o `Range` não altera o retorno. Confirmar que `POST` com `Range` dá 405 com `allow: GET, HEAD`.

Confirmar o RF-09 com a variante `.gz` de 50 bytes e `accept-encoding: gzip`: 206, `content-encoding: gzip`, `content-range: bytes 0-9/50`, 10 bytes no corpo. Verificar que `Content-Length` e `Content-Range` usam o tamanho da variante.

Ajustar `src/utils/static.ts` somente se algum caso falhar. Não alterar testes existentes sem necessidade (PRD, RF-12).

**Cobre:** RF-09, RF-10
**Depende de:** T-06
**Aceite:** os casos de `fallthrough`, 405 e variante `.gz` do bloco novo passam em `web` e `node`. A suíte completa de `test/static.test.ts`, `test/security.test.ts`, `test/rules/cache.test.ts` e `test/unit/package.test.ts` passa.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

### T-08 — Comentários do módulo e confirmação de exports

Atualizar o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com um parágrafo curto sobre Range: suporte a `bytes` de uma faixa, limitações de I/O (R-01) e a premissa de `meta.size` (R-02). Não alterar `ServeStaticOptions` (RF-11).

Confirmar que `src/index.ts` não mudou e que o snapshot de exports em `test/unit/package.test.ts:133` continua igual. Não adicionar nomes públicos (RF-11).

Registrar para o time que `src/utils/static.ts` passa de ~350 para ~480 linhas, acima da orientação do `AGENTS.md` (R-06). A alternativa, mover os auxiliares para `src/utils/internal/range.ts`, fica como decisão pendente.

**Cobre:** RF-11
**Depende de:** T-07
**Aceite:** `git diff -- src/index.ts` vazio. `pnpm vitest run test/unit/package.test.ts` passa sem alterar o snapshot. O JSDoc de `serveStatic` menciona Range.

**Arquivos:** `src/utils/static.ts`, `test/unit/package.test.ts` (somente leitura, se o snapshot não mudar)

### T-09 — Verificação final

Rodar `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck`. Rodar também a suíte de regressão da techspec (`test/security.test.ts`, `test/rules/cache.test.ts`, `test/unit/package.test.ts`). Se algum teste falhar, registrar a saída completa antes de corrigir.

Pendências a reportar, sem resolver sozinho: confirmação do time sobre `Accept-Ranges` em 304 (R-07) e sobre a manutenção dos auxiliares em `static.ts` (R-06).

**Cobre:** RF-12
**Depende de:** T-08
**Aceite:** `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck` passam, com a saída reportada.

**Arquivos:** nenhum (somente verificação)

## Cobertura dos requisitos

| RF | Tarefas |
|---|---|
| RF-01 | T-01, T-02 |
| RF-02 | T-01, T-03, T-05 |
| RF-03 | T-01, T-03 |
| RF-04 | T-01, T-03 |
| RF-05 | T-01, T-06 |
| RF-06 | T-01, T-03 |
| RF-07 | T-01, T-04 |
| RF-08 | T-01, T-02, T-06 |
| RF-09 | T-01, T-05, T-07 |
| RF-10 | T-01, T-07 |
| RF-11 | T-08 |
| RF-12 | T-01, T-09 |
