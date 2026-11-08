# Tech spec: HTTP Range em `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-14), RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests).

Estado de partida conferido: `pnpm vitest run test/static.test.ts test/security.test.ts` passa com 271 testes. A árvore não tinha mudanças além de `sdd/prd.md` não versionado.

## Visão geral

Toda a mudança cabe em `src/utils/static.ts`, dentro de `serveStatic`, com helpers privados no fim do módulo. Nenhuma linha de `src/index.ts`, `ServeStaticOptions`, `StaticAssetMeta` ou da assinatura de `serveStatic` muda.

Fluxo resultante, dentro de `serveStatic`, após o ponto em que hoje a função já tem `meta`, `mtimeDate` e o resultado do cache:

1. Se `meta` não traz `size` válido (ausente ou 0), o `Range` é ignorado (RF-10).
2. Accept-Ranges entra no `event.res.headers` só depois do 304 (D-02).
3. Com `Range` presente e método GET/HEAD, `resolveRange` decide entre 200 (ignorar), 206 (trecho) e 416 (não satisfazível) (D-03, D-06, D-07).
4. 206 e 416 retornam `HTTPResponse`, não `HTTPError`, e sobrescrevem `Content-Length`/`Content-Range` (D-04, D-05).
5. Para 206 em GET, o corpo é fatiado conforme o tipo retornado por `getContents` (D-08).

---

## Decisões de arquitetura

### D-01 — Helpers de Range ficam no próprio `src/utils/static.ts`

- **Alternativa A:** criar `src/utils/internal/range.ts`, seguindo a convenção de `AGENTS.md` (helpers internos em `utils/internal/`, arquivos com menos de 200 linhas).
- **Alternativa B:** helpers privados no fim de `src/utils/static.ts`.
- **Escolha:** B. O contrato (`sdd/pedido.md`, linha 92; `sdd/prd.md` RF-13) pede que os helpers fiquem "privados dentro do módulo serveStatic". O arquivo já tem 351 linhas (`src/utils/static.ts:351`), acima da meta de 200 de `AGENTS.md`. A mudança deve levá-lo a cerca de 450 linhas. Isso é dívida registrada: se o contrato for relaxado, mover os helpers para `src/utils/internal/range.ts` é um corte limpo, porque são funções puras.

### D-02 — `Accept-Ranges: bytes` é definido após o 304 e só se ausente

- **Alternativa A:** definir antes de `isCacheMatch`. Isso faz o cabeçalho vazar para o 304, porque `toResponse` mescla `event.res.headers` em respostas `HTTPResponse` (`src/response.ts:203`).
- **Alternativa B:** definir sempre, sobrescrevendo `options.headers`. Isso quebra a premissa de que `options.headers` tem precedência (`sdd/prd.md`, premissas).
- **Escolha:** definir logo após o bloco de 304 (`src/utils/static.ts:243-248`), com `if (!event.res.headers.has("accept-ranges"))`. Assim o cabeçalho sai em 200, 206, 416 e HEAD, e não sai em 304, 404 ou 405 (RF-01 e premissas do PRD).

### D-03 — Range é avaliado depois do cache e antes do bloco de `Content-Length`

- **Alternativa A:** tratar Range antes de `isCacheMatch`. Quebra RF-08, que exige que o 304 vença.
- **Alternativa B:** tratar Range no fim, depois de `getContents`. Desperdiça IO em 416 e não permite decidir `Content-Length` a tempo.
- **Escolha:** avaliar depois de `Content-Type` e `Content-Encoding` (`src/utils/static.ts:250-266`) e antes de `Content-Length` (`src/utils/static.ts:268-270`). Assim `Content-Encoding` continua valendo para 206 (RF-11), e o `Content-Length` pode ser decidido de uma vez.

### D-04 — 206 e 416 são retornados como `HTTPResponse`, não como `HTTPError`

- **Alternativa A:** `throw new HTTPError({ status: 416 })`. Em respostas 4xx, `toResponse` só usa `errHeaders` (`src/response.ts:211`). Accept-Ranges e Content-Range preparados em `event.res.headers` seriam perdidos.
- **Escolha:** `return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `Content-Range` e `Content-Length` em `event.res.headers`. Assim os cabeçalhos preparados são mesclados (`src/response.ts:203`). Isso também evita chamar `getContents` (`src/utils/static.ts:276`) quando não há corpo a devolver.

### D-05 — Precedência de `Content-Length` e `Content-Range`

- **Alternativa A:** sobrescrever `Content-Length` sempre. Quebra o teste `test/static.test.ts:600-616`, que exige que `options.headers["content-length"]` vença em HEAD 200.
- **Alternativa B:** nunca sobrescrever. Um 206 com `Content-Length` de arquivo inteiro está errado.
- **Escolha:** manter a regra atual para 200 (`if (!has)`, `src/utils/static.ts:268`) e usar `set` incondicional apenas em 206 e 416. A exceção está documentada no PRD (premissas) e no comentário do código.

### D-06 — Parser de `Range` estrito, com um único intervalo

- **Escolha:** aceitar apenas `^bytes=(\d*)-(\d*)$` depois de `trim()`, com exatamente um dos dois lados preenchido e `start <= end` quando ambos existem. Qualquer outra forma (outra unidade, vírgula, `-` sem números, `end < start`) devolve "ignorar" e a resposta é 200 completo (RF-06).
- Limites (RF-05 e RF-09):
  - `start >= size` ⇒ 416.
  - `end >= size` ⇒ `end = size - 1`.
  - Sufixo `-N`: `N === 0` ⇒ 416; `N > size` ⇒ `start = 0`; senão `start = size - N`.
- Quando `size` não é número positivo, o `Range` é ignorado antes do parse (RF-10).

### D-07 — `If-Range` com ETag forte exato ou data idêntica ao `Last-Modified`

- **Regra:** se `If-Range` começa com `W/` ou com `"`, é tratado como ETag. Só casa se `meta.etag` existe, não começa com `W/` (ETag fraca nunca satisfaz If-Range) e é igual ao `If-Range`. Caso contrário, é tratado como data e casa se `new Date(value).getTime() === mtimeDate.getTime()`. Se não há `mtimeDate`, não casa.
- Sem `If-Range`, o `Range` é honrado.
- **Por que `W/` case-sensitive:** segue `opaqueTag` em `src/utils/internal/cache.ts:51`, que usa `startsWith("W/")`.
- **Alternativa:** comparação fraca no `If-Range`. Descartada, porque RF-07 e RFC 9110 §13.1.5 exigem comparação forte.

### D-08 — Fatiamento do corpo por tipo de `BodyInit`

`getContents` continua recebendo só `id` (`src/utils/static.ts:276`), sem parâmetro de intervalo (PRD, fora de escopo).

| Tipo retornado | Estratégia | Justificativa |
| --- | --- | --- |
| `string` | `new TextEncoder().encode(s).subarray(start, end + 1)` | `size` está em bytes; o recorte precisa ser por bytes e não por caracteres. |
| `ArrayBuffer` / `ArrayBufferView` | `new Uint8Array(buf, byteOffset, byteLength).subarray(start, end + 1)` | Sem cópia; respeita `byteOffset` de views (ex.: `Buffer`). |
| `Blob` | `blob.slice(start, end + 1)` | Lazy: não carrega o arquivo inteiro, e o seek em vídeo grande fica barato. |
| `ReadableStream` e demais (`FormData`, `URLSearchParams`) | Converter com `new Response(contents).body` e consumir pelo reader: descartar `start` bytes, emitir até `end + 1`, depois `reader.cancel()` | Uma única rotina cobre o restante. Para `ReadableStream`, o custo é ler até `start`. |

- **Alternativa A:** `new Response(contents).arrayBuffer()` para tudo. Carrega o arquivo inteiro e viola o risco de memória (alto) do PRD.
- **Alternativa B:** stream para tudo, inclusive `Blob`. Torna o seek para o fim de um arquivo grande O(offset) em I/O. Descartada.
- **Escolha:** tabela acima. A medição com arquivo grande (PRD, risco de memória) fica para a estratégia de testes.

### D-09 — Variante pré-comprimida usa o `size` da variante

Não há código novo para isso. `meta` já pertence ao id da variante escolhida (`src/utils/static.ts:201-205`), e `meta.size` é o da variante. A regra deve ser verificada por teste (RF-11).

### D-10 — API pública inalterada

`ServeStaticOptions`, `StaticAssetMeta`, `serveStatic` e `src/index.ts:193` ficam iguais. `test/unit/package.test.ts:133` lista `serveStatic` entre as exportações e continua passando sem mudança.

### D-11 — HEAD com `Range` válido

HEAD segue a mesma decisão do GET: 206 com `Content-Range` e `Content-Length` do trecho, corpo `null`. A chamada a `getContents` não acontece em HEAD (`src/utils/static.ts:272-274`), e isso não muda.

---

## Contratos e assinaturas

Helpers privados em `src/utils/static.ts`. Nenhum é exportado.

```ts
type RangeResult =
  | { status: 200 }                                  // Range ignorado ou não aplicável
  | { status: 206; start: number; end: number }      // trecho inclusivo, em bytes
  | { status: 416 };                                 // não satisfazível

function resolveRange(
  headers: Headers,
  size: number | undefined,
  validators: { etag?: string; lastModified?: Date },
): RangeResult;

function parseRange(
  value: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined;

function matchesIfRange(
  value: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

function sliceBody(
  contents: BodyInit | null | undefined,
  start: number,
  end: number,
): Promise<BodyInit | null>;
```

`resolveRange` faz, em ordem: retornar 200 se o método não é GET/HEAD (já tratado antes, por segurança), se não há `range`, se `size` não é positivo ou se `If-Range` existe e não casa (`matchesIfRange`); depois chama `parseRange`; `undefined` ⇒ 200, `"unsatisfiable"` ⇒ 416, objeto ⇒ 206.

Respostas por caso:

| Caso | Status | Cabeçalhos definidos por `serveStatic` | Corpo | `getContents` |
| --- | --- | --- | --- | --- |
| GET sem `Range` (ou ignorado) | 200 | `accept-ranges` (se ausente), `content-length` (só se ausente, como hoje) | `contents \|\| null` | chamado |
| GET com 206 | 206 | `accept-ranges`, `content-range: bytes s-e/size`, `content-length: e-s+1` (sobrescreve) | `sliceBody(...)` | chamado |
| HEAD com 206 | 206 | igual ao acima | `null` | não chamado |
| 416 | 416, `statusText` "Range Not Satisfiable" | `accept-ranges`, `content-range: bytes */size`, `content-length: 0` | `null` | não chamado |
| 304 | 304 | nenhum dos de Range; `accept-ranges` ausente | `null` | não chamado |
| 404 e 405 | inalterado | inalterado | inalterado | inalterado |

Pseudocódigo da inserção (posições atuais):

```ts
// após src/utils/static.ts:248
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

// substitui src/utils/static.ts:268-277
const range = resolveRange(event.req.headers, meta.size, { etag: meta.etag, lastModified: mtimeDate });
if (range.status === 416) {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (range.status === 206) {
  // D-05: 206 precisa refletir o trecho, mesmo que options.headers tenha definido content-length
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(await sliceBody(contents, range.start, range.end), { status: 206, statusText: "Partial Content" });
}
// 200: comportamento atual
if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
  event.res.headers.set("content-length", meta.size + "");
}
if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: 200 });
}
const contents = await options.getContents(id);
return new HTTPResponse(contents || null, { status: 200 });
```

Observação: no caminho 200, o bloco de `content-length` continua exatamente como está, e o caminho 206 precisa vir antes dele para que o `set` não seja bloqueado pelo `!has`.

---

## Estratégia de testes

Todos os testes novos são `describeMatrix` em `test/static.test.ts`, para rodar em `web` e `node` (`test/_setup.ts:11`). Eles usam o mesmo padrão do bloco existente em `test/static.test.ts:5`. Os helpers ficam privados, então o comportamento é testado só pela API pública `serveStatic`.

Novo bloco "serve static with Range", com `getMeta`/`getContents` controlados e tamanho conhecido:

1. **RF-01:** 200 sem Range traz `accept-ranges: bytes`. Também em 206, 416 e HEAD.
2. **RF-02, RF-03:** `bytes=0-99` em arquivo de 1000 bytes ⇒ 206, corpo de 100 bytes exatos, `content-range` e `content-length` corretos. Cobrir `bytes=100-199` e `bytes=0-0`.
3. **RF-04:** HEAD com `bytes=0-9` ⇒ 206, cabeçalhos corretos, corpo vazio.
4. **RF-05:** `bytes=1000-1100` ⇒ 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. `bytes=-0` ⇒ 416. Confirmar com `vi.fn` que `getContents` não foi chamado.
5. **RF-06:** `bytes=0-1,5-9`, `items=0-9`, `bytes=5-2`, `bytes=-`, `bytes=abc` ⇒ 200 completo, sem `content-range`.
6. **RF-07:** If-Range com ETag forte igual ⇒ 206; ETag diferente ⇒ 200; `W/"abc"` em `meta.etag` ou em If-Range ⇒ 200; data igual ao `Last-Modified` ⇒ 206; data diferente ⇒ 200.
7. **RF-08:** `if-none-match` igual com `Range` ⇒ 304 sem corpo e sem `accept-ranges`.
8. **RF-09:** `bytes=900-5000` ⇒ `900-999/1000`, `content-length: 100`. `bytes=-5000` ⇒ `0-999/1000`, `content-length: 1000`. `bytes=999-999` no último byte.
9. **RF-10:** `getMeta` sem `size` e com `size: 0` ⇒ 200 completo, sem `content-range`.
10. **RF-11:** `app.js` com `app.js.gz` de 300 bytes, `accept-encoding: gzip`, `bytes=0-9` ⇒ 206, `content-encoding: gzip`, `content-range: bytes 0-9/300`.
11. **RF-12:** 404 com `fallthrough: false` e POST com `fallthrough: true` continuam como hoje. Os testes existentes em `test/static.test.ts:396` cobrem isso; a suíte deve passar sem alteração neles.
12. **D-05:** `options.headers` com `content-length: 999` em HEAD 200 continua valendo 999 (teste existente em `test/static.test.ts:600-616`, sem mudança). Em 206 com a mesma configuração, o valor vira o do trecho.
13. **D-08, tipos de corpo:** a mesma requisição `bytes=2-5` com `getContents` retornando `string` (multibyte UTF-8, por exemplo `"é"` com `size` em bytes), `Blob`, `ArrayBuffer`, `Uint8Array` com `byteOffset` diferente de zero, e `ReadableStream`. O corpo deve ser igual nos cinco casos. Para `ReadableStream`, verificar que a stream foi cancelada após o trecho.
14. **Edge:** arquivo de 1 byte com `bytes=0-0` ⇒ 206 `0-0/1`, e `bytes=0-` ⇒ mesmo resultado.

Ajustes em testes existentes: o plano não prevê nenhum. Os asserts atuais de `test/static.test.ts:53`, `:69`, `:450` e `:466` usam `toMatchObject`, então cabeçalhos extras não quebram. `test/security.test.ts` checa só `x-inj`. Se algum teste falhar, o ajuste deve manter o que ele verifica (RF-14).

Verificação, na ordem:

- `pnpm vitest run test/static.test.ts test/security.test.ts` (linha de base: 271 testes verdes).
- `pnpm vitest run` completo.
- `pnpm lint` (`package.json:46`) e `pnpm typecheck` (`package.json:54`).
- Medição de memória (PRD, risco alto): gerar um arquivo grande (por exemplo 1 GB) e medir RSS para `bytes=0-99` e `bytes=900000000-900000099`, nos caminhos `Blob` e `ReadableStream`. Esta medição fica fora da suíte, como verificação manual. Resultado deve ir para o PR.

Regra de bug fix de `AGENTS.md`: como isto é feature, não correção, não há passo de "teste que falha antes". Mesmo assim, os testes de 206 devem falhar na base atual, o que é a confirmação de que cobrem o comportamento novo.

---

## Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| Memória em arquivo grande (PRD) | Alta | D-08 usa `Blob.slice` e `subarray`. `ReadableStream` ainda lê o prefixo até `start`. Medir conforme a seção de testes. |
| `Blob.slice` pode não ser lazy em todos os runtimes para blobs de arquivo | Média | Medir em Node e Bun. Se não for lazy, a alternativa é o caminho de stream com `start` grande. |
| `size` de `getMeta` diferente dos bytes de `getContents` | Média | Premissa do PRD. `Content-Range` e `Content-Length` ficam errados sem erro. Documentar no JSDoc de `StaticAssetMeta.size`. Não há como validar sem ler o conteúdo. |
| `getContents` retorna `null` ou `undefined` com `size > 0` em 206 | Baixa | Já existe em 200 hoje (`contents \|\| null`). Em 206 o cliente receberia `Content-Length` sem corpo. Aceito e anotado; não há cenário legítimo para isso. |
| `Accept-Ranges` vazar para 304 | Média | D-02, com teste em RF-08. |
| `HTTPError` 416 perder cabeçalhos | Média | D-04: retorno como `HTTPResponse`. |
| Sobrescrita de `Content-Length` mudar caso existente | Média | D-05: só 206 e 416. Teste `test/static.test.ts:600-616` preservado. |
| Ordem de inserção: `set` de `content-length` no 206 precisa vir antes do bloco com `!has` | Baixa | Pseudocódigo acima; coberto pelo teste 12. |
| Arquivo passa de 351 para cerca de 450 linhas, acima da meta de 200 de `AGENTS.md` | Baixa | D-01. Dívida registrada, com caminho de correção descrito. |
| Compressão e seek (PRD) | Baixa | Limitação da RFC com `content-encoding`; documentada no PRD. Sem mitigação no código. |
| Integração com `h3/rules/cache` | Baixa | `src/rules/cache.ts:143-148` já passa `Range` para a cadeia, então `serveStatic` recebe a requisição e responde 206. Não há mudança nesse módulo, mas o teste de integração não está no escopo. |
| Etag de fixture `"w/123"` em `test/static.test.ts:15` | Baixa | Minúsculo, então não é ETag fraca pela regra de D-07. Os testes novos usam `"abc"` e `W/"abc"` explicitamente. Não alterar a fixture existente. |

Nenhuma destas exige mudança de API. O risco de memória é o único que pode mudar a abordagem de D-08, e por isso a medição fica como etapa obrigatória antes do merge.
