# Tarefas: HTTP Range no `serveStatic`

**Referência:** h3js/h3#1267 · `sdd/prd.md` (RF-01 a RF-12) · `sdd/techspec.md` (D-01 a D-10)
**Fluxo:** testes primeiro (T-01 a T-05), confirmação de falha (T-06), implementação (T-07 a T-11), verificação (T-12 e T-13), conforme "Bug Fix Workflow" do `AGENTS.md`.

## Decisões adotadas nas tarefas

Estas são as pendências da techspec. Onde o PRD e a spec se contradizem, as tarefas seguem a spec. Confirmar antes de iniciar T-07.

1. **`Accept-Ranges` sem `size` (D-02, RF-01 x RF-09).** Adotado: o cabeçalho sai somente quando `size > 0`. O texto literal de RF-01 ficaria como anúncio falso.
2. **Arquivo de tamanho zero (D-08, P3).** Adotado: `size = 0` é tratado como desconhecido, o Range é ignorado e a resposta é 200. A RFC 9110 daria 416. Confirmar antes de implementar.
3. **`If-Match` e `If-Unmodified-Since` (D-09).** Adotado: fora desta issue. Abrir issue separada.
4. **Localização dos helpers (D-10).** Adotado: helpers privados no fim de `src/utils/static.ts`, como pede o PRD (RF-11). A convenção do `AGENTS.md` pede `utils/internal/`. Se o time preferir, a migração é mecânica.

---

### T-01 — Testes de `Accept-Ranges` e regressão sem Range

- Cobre: RF-01, RF-10
- Depende de: nenhuma
- Aceite: dentro de `describeMatrix("serve static range")`, em `web` e `node`, há testes que verificam `accept-ranges: bytes` em GET e HEAD, com e sem `Range`, para asset com `size`. Sem `size` (ou `size: 0`), o cabeçalho está ausente (D-02). Testes de 404 com `Range`, 405 com POST e `Range`, e `undefined` com `fallthrough` existem e já passam antes da implementação, por serem guarda de regressão. Os 76 testes atuais continuam sem edição.
- Arquivos: `test/static.test.ts`

### T-02 — Testes de resposta 206

- Cobre: RF-02, RF-03, RF-09
- Depende de: nenhuma
- Aceite: com fixture de 10 bytes (`"0123456789"`, `size: 10`, `etag: '"abc"'`), `bytes=2-5` retorna 206, `content-range: bytes 2-5/10`, `content-length: 4` e corpo `2345`. Também existem casos para `bytes=a-` (até o fim), `bytes=-3`, `bytes=-99` (arquivo inteiro) e `bytes=5-99` (fim limitado a 9). HEAD com `bytes=2-5` retorna 206 sem corpo, e `getContents` (`vi.fn`) não é chamado. Com `size` ausente ou `0`, o `Range` é ignorado e a resposta é 200 completa. Os testes falham antes da implementação.
- Arquivos: `test/static.test.ts`

### T-03 — Testes de 416 e de `Range` ignorado

- Cobre: RF-04, RF-05
- Depende de: nenhuma
- Aceite: `bytes=10-20`, `bytes=10-` e `bytes=-0` retornam 416, com `content-range: bytes */10`, `content-length: 0`, sem corpo, com `getContents` não chamado e com `vary` e `etag` preservados (D-07). `bytes=abc`, `items=0-1`, `bytes=5-2`, `bytes=0-1,4-5` e `bytes=-` retornam 200 completo, sem `content-range`. Os casos de 416 falham antes da implementação.
- Arquivos: `test/static.test.ts`

### T-04 — Testes de `If-Range` e condicionais

- Cobre: RF-06, RF-07
- Depende de: nenhuma
- Aceite: `If-Range` com ETag forte igual ao atual retorna 206. Com ETag diferente, retorna 200. Com `W/"abc"` (validador fraco), retorna 200. Com a data exata de `last-modified`, retorna 206. Com data diferente, retorna 200. Usar `mtime` com milissegundos para checar o truncamento (R-02). `If-None-Match` casando com `Range` válido retorna 304, sem 206 nem 416. O mesmo vale para `If-Modified-Since`.
- Arquivos: `test/static.test.ts`

### T-05 — Testes de variante codificada e de corpo por tipo

- Cobre: RF-08
- Depende de: nenhuma
- Aceite: `GET /app.js` com `accept-encoding: gzip` e `Range` usa `content-range` e `content-length` com o `size` de `getMeta` do `.gz`. `content-encoding: gzip` e `vary` continuam presentes. Para o recorte por tipo de `getContents` (D-05), há casos com o mesmo intervalo para: `string` com `"é"` (conta UTF-8, 2 bytes); `Blob`; `ArrayBuffer`; `Uint8Array` criado por `subarray` com `byteOffset` diferente de zero; e `ReadableStream` em vários chunks, com `start` caindo no meio de um chunk.
- Arquivos: `test/static.test.ts`

### T-06 — Confirmar que os testes novos falham antes da implementação

- Cobre: RF-12
- Depende de: T-01, T-02, T-03, T-04, T-05
- Aceite: `pnpm vitest run test/static.test.ts` mostra os testes de Range de T-02, T-03, T-04 e T-05 falhando, e os de T-01 passando (são regressão). Os 76 testes originais passam. A saída do comando é registrada no PR.
- Arquivos: nenhum (somente execução)

### T-07 — Parser de `Range` e resolução do intervalo

- Cobre: RF-02, RF-04, RF-05
- Depende de: T-06
- Aceite: existem as funções privadas `parseRange` (valida sintaxe: `a-b`, `a-`, `-n`; devolve `undefined` para o resto) e `resolveRange` (aplica o `size`; devolve `undefined` para não satisfazível), como em D-03. A unidade `bytes` é case-insensitive, depois de confirmar RFC 9110 §14.1. Nenhuma das funções é exportada. Os casos de sintaxe e resolução de T-02 e T-03 passam.
- Arquivos: `src/utils/static.ts`

### T-08 — Validação de `If-Range`

- Cobre: RF-06
- Depende de: T-06
- Aceite: existe a função privada `matchesIfRange` (D-04). Retorna `true` sem `If-Range`. ETag forte igual retorna `true`. ETag fraca (`W/`) ou diferente retorna `false`. Data igual ao `mtime` truncado a segundos retorna `true`. Data diferente retorna `false`. Se não há `etag` nem `mtime`, retorna `false`. `isCacheMatch` não é reutilizado, e `src/utils/internal/cache.ts` não muda. Os casos de T-04 passam.
- Arquivos: `src/utils/static.ts`

### T-09 — Recorte do corpo por tipo (`sliceBody`)

- Cobre: RF-02, RF-08
- Depende de: T-06
- Aceite: existe a função privada `sliceBody` (D-05), síncrona, com um ramo por tipo: `string` por bytes UTF-8; `Blob` por `slice`; `ArrayBuffer` por `Uint8Array` com offset; `ArrayBufferView` respeitando `byteOffset`; `ReadableStream` e os demais via `new Response(contents).body`, descartando bytes até `start`, emitindo até `end` e cancelando o leitor no fim. Os casos de corpo de T-05 passam, em `web` e `node`.
- Arquivos: `src/utils/static.ts`

### T-10 — Integração do Range no `serveStatic`

- Cobre: RF-01, RF-03, RF-04, RF-07, RF-08, RF-09, RF-10
- Depende de: T-07, T-08, T-09
- Aceite: `accept-ranges: bytes` é definido quando `meta.size > 0`, no bloco de `etag`, antes do 304, para aparecer também em 304 (D-02). O 304 continua antes da avaliação de Range (D-01). O bloco de Range fica depois de `content-length` e antes do ramo HEAD. Em 206, `content-length` é sobrescrito (D-06). Em 416, a resposta é `new HTTPResponse(null, { status: 416, headers })`, com cópia de `event.res.headers` e `content-range: bytes */N` (D-07). HEAD com intervalo não chama `getContents`. GET com intervalo passa o corpo por `sliceBody`. Todos os testes de T-01 a T-05 passam, e os 76 originais continuam passando.
- Arquivos: `src/utils/static.ts`

### T-11 — JSDoc e garantia da API pública

- Cobre: RF-11
- Depende de: T-10
- Aceite: o JSDoc de `serveStatic` ganha uma frase sobre Range e `Accept-Ranges`, e registra que `size` deve ser exato (R-04). `StaticAssetMeta` e `ServeStaticOptions` têm diff vazio. `src/index.ts` não tem diff. Nenhum helper novo é exportado. `pnpm build` gera o mesmo conjunto de exports de antes.
- Arquivos: `src/utils/static.ts`, `src/index.ts` (somente verificação, sem alteração)

### T-12 — Verificação final da suíte

- Cobre: RF-12
- Depende de: T-10, T-11
- Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/static.test.ts` passam em `web` e `node`. `pnpm test` cobre o novo código acima do limiar de cobertura do projeto. Se algum teste existente falhar, ele é ajustado sem perder a verificação original (R4). A spec prevê que nenhum falhe. Bun não é coberto pelos testes automatizados (R-03): registrar essa lacuna no PR.
- Arquivos: nenhum (somente execução)

### T-13 — Medição do caminho de stream para o PR

- Cobre: RF-02
- Depende de: T-12
- Aceite: um seek para o fim em arquivo grande, servido por `ReadableStream`, é medido em tempo e memória. O resultado, com a decisão de manter o descarte de prefixo (D-05, R-01 do PRD), é registrado no PR.
- Arquivos: nenhum (medição fora do repositório)
