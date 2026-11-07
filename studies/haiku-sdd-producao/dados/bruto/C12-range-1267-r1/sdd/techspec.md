# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

**Entrada:** `sdd/pedido.md` · `sdd/prd.md` (RF-01 a RF-13, premissas 1 a 8)
**Código de referência:** `src/utils/static.ts` · `src/response.ts` · `src/utils/internal/cache.ts` · `test/static.test.ts`
**Norma:** RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests)

Esta especificação decide *como* implementar o PRD. O que e por quê estão no PRD; aqui ficam arquivos, assinaturas, ordem de avaliação e testes.

---

## 1. Estado atual relevante

- `serveStatic` define `content-length` a partir de `meta.size` só quando o cabeçalho ainda não existe (`src/utils/static.ts:268-270`). Um `content-length` vindo de `options.headers` vence (`test/static.test.ts:600`).
- Respostas `HEAD` retornam antes de `getContents` (`src/utils/static.ts:272-274`). `GET` chama `getContents` e devolve `200` (`src/utils/static.ts:276-277`).
- A `Accept-Ranges` não existe em lugar nenhum do módulo.
- Ao retornar um `HTTPResponse`, o h3 mescla `res.headers` (init) com os cabeçalhos staged em `event.res.headers`, e **os staged vencem** (`src/response.ts:201-204`, `mergeHeaders` em `src/response.ts:243`). Esse fato dirige a D-04.
- `src/index.ts:193` exporta `serveStatic` e os tipos `ServeStaticOptions` e `StaticAssetMeta`. `test/unit/package.test.ts:133` confere a lista de exports.
- `textEncoder` já existe em `src/utils/internal/encoding.ts:7` e pode ser reutilizado.

---

## 2. Decisões de arquitetura

### D-01 — Helpers em `src/utils/internal/range.ts`, ligação em `static.ts`

**Alternativas**
- (a) Todos os helpers no fim de `src/utils/static.ts`. Segue literalmente a issue ("manter a lógica privada ao módulo").
- (b) Helpers em `src/utils/internal/range.ts`, importados por `static.ts`.
- (c) Novo arquivo público exportado por `src/index.ts`. Proibido pelo PRD (RF-12).

**Escolha: (b).** `static.ts` já tem 351 linhas, e o AGENTS.md pede arquivos curtos (< 200 linhas) e helpers em `utils/internal/`. Com (a), o arquivo passaria de 450 linhas. Com (b), nada muda na superfície pública: `utils/internal/` não é exportado. A intenção da issue (não criar API nova) é preservada.

### D-02 — Interpretação estrita do `Range`

Regra única, aplicada sobre o valor com `trim()`:

- Regex: `/^bytes=(\d*)-(\d*)$/i` sobre o valor completo. A unidade é comparada sem diferenciar maiúsculas. **Confirmar no texto da RFC 9110 §14.1 antes do merge**; se a norma exigir caixa exata, troca-se só essa comparação.
- Vírgula, `items=`, `bytes=` vazio, `bytes=-` (os dois lados vazios), `bytes=5-2` (início > fim com os dois presentes) → `undefined` (Range ignorado, RF-02).
- `size` ausente ou `<= 0` → `undefined` (premissa 5).
- Sufixo `-0` → `unsatisfiable` (RF-04). Início `>= size` → `unsatisfiable`.
- Demais casos: intervalo resolvido com `end = min(fim, size - 1)`; `-sufixo` com `start = max(size - sufixo, 0)`, `end = size - 1`.

Números com mais de 15 dígitos: a comparação com `size` continua correta (um início enorme cai em `unsatisfiable`). Não é preciso tratar caso especial; cobrir com um teste.

### D-03 — Ordem de avaliação dentro de `serveStatic`

Fixada pela premissa 7 do PRD e pelo RF-07:

1. Método (405) e caminho canônico (404) — inalterados.
2. Lookup de `meta` (404) — inalterado.
3. `vary` — inalterado.
4. `last-modified`, `etag` — inalterados.
5. **`accept-ranges: bytes` (novo)**, só se ainda não existir. Fica antes do `304` para que o `304` também o carregue (RF-01).
6. `304` via `isCacheMatch` — inalterado, vem antes de Range (RF-07).
7. `content-type`, `content-encoding`, `content-length` — inalterados.
8. **Range (novo):** `parseRange` → If-Range → resposta `416`, `206` ou o fluxo de `200` existente.

`If-Range` só é avaliado quando `parseRange` devolve um intervalo válido (RF-06). Sem `Range` válido, o cabeçalho é ignorado.

### D-04 — Cabeçalhos de `206` e `416` gravados em `event.res.headers`

**Problema:** o `HTTPResponse` init aceita `headers`, mas os staged de `event.res.headers` vencem na mescla (`src/response.ts:201-204`). Como `content-length` já foi staged com `meta.size` (`src/utils/static.ts:269`), um `content-length` no init de `206` seria sobrescrito pelo tamanho total.

**Alternativas**
- (a) Passar `content-length` e `content-range` em `new HTTPResponse(..., { headers })`. Não funciona, pelo motivo acima.
- (b) Remover o `content-length` staged e depois passar o do intervalo no init. Frágil: depende da ordem da mescla e apaga o valor de `options.headers`, que a premissa 4 manda sobrescrever.
- (c) `event.res.headers.set("content-length", …)` e `set("content-range", …)`, e retornar `new HTTPResponse(corpo, { status })`.

**Escolha: (c).** `set` sobrescreve o valor de `options.headers` (premissa 4) e o staged vence na mescla, então o resultado é o esperado nos dois alvos. Em `200`, nada muda: continua valendo o `if (!get)` atual.

### D-05 — If-Range: comparação exata

- ETag: o valor de `If-Range` deve começar com `"` (não é `W/`) **e** ser igual à string de `meta.etag`, que também não pode começar com `W/`. Comparação de string, sem normalização (RF-06).
- Data: o valor de `If-Range` deve ser **idêntico como string** ao `last-modified` que está em `event.res.headers`. Não se converte para `Date` (um formato equivalente, como RFC 850, daria `200` completo, que é o caminho seguro).

**Alternativas:** comparar timestamps com `Date.parse`. Rejeitada: aceita formatos diferentes do que o servidor emitiu e pode dar `206` a um validador que o cliente não enviou exatamente.

### D-06 — Recorte do corpo por tipo: helper `sliceBody`

Função única, por tipo de `BodyInit`, na ordem abaixo:

| Tipo | Estratégia | Observação |
|---|---|---|
| `string` | `textEncoder.encode(s).subarray(start, end + 1)` | `size` é em bytes UTF-8 (RF-10, risco 4) |
| `ArrayBuffer` | `buf.slice(start, end + 1)` | |
| `ArrayBufferView` | `new Uint8Array(v.buffer, v.byteOffset, v.byteLength).subarray(start, end + 1)` | cobre TypedArray e DataView |
| `Blob` | `blob.slice(start, end + 1)` | não carrega o blob inteiro na memória |
| `ReadableStream` | `sliceStream(...)` (ver abaixo) | cancela a origem após o último byte |
| demais (`URLSearchParams`, `FormData`, ...) | `new Uint8Array(await new Response(body).arrayBuffer())` e depois o `subarray` | |

`sliceStream` (referência de implementação):

```ts
function sliceStream(source: ReadableStream, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const last = end + 1; // exclusivo
  let offset = 0; // bytes já lidos da origem
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunk = toBytes(value); // string -> textEncoder, Uint8Array direto
        const chunkStart = offset;
        offset += chunk.byteLength;
        const from = Math.max(start - chunkStart, 0);
        const to = Math.min(last - chunkStart, chunk.byteLength);
        if (from < to) {
          controller.enqueue(chunk.subarray(from, to));
        }
        if (offset >= last) {
          controller.close();
          await reader.cancel();
          return;
        }
        if (from < to) {
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
```

`toBytes` converte `string` com `textEncoder` e `ArrayBuffer`/views para `Uint8Array`. Nenhum outro helper novo.

### D-07 — `416` e `HEAD` não chamam `getContents`

- `416`: não há corpo a obter. Sem chamada.
- `HEAD` com `206`: cabeçalhos iguais ao `GET`, sem chamada (RF-05).
- `GET` com `206`: `getContents` é chamado **depois** de decidir o intervalo, para que o `416` nunca o chame.

### D-08 — `getContents` devolve vazio com Range válido

Premissa 8: a resposta segue como hoje, `200` sem corpo. Os cabeçalhos `content-range` e `content-length` do intervalo **não** podem vazar para esse `200`. Por isso, em `GET`, os cabeçalhos de `206` só são gravados depois que o corpo existe (ver fluxo abaixo). `accept-ranges` continua presente (já foi gravado no passo 5 da D-03).

### D-09 — Sem mudança em cache, encoding e fallthrough

`getMeta` e `getContents` continuam recebendo o mesmo `id`. A seleção de variante (`idSearchPaths`, `parseAcceptEncoding`) não muda. Respostas `404`, `405` e fallthrough não gravam `accept-ranges`, porque o passo 5 vem depois de todas elas.

---

## 3. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/utils/internal/range.ts` | **Novo.** `parseRange`, `matchesIfRange`, `sliceBody`, `sliceStream`, `toBytes`. Não é exportado por `src/index.ts`. |
| `src/utils/static.ts` | Inserir o passo 5 (accept-ranges) entre `src/utils/static.ts:241` e `:243`. Trocar o trecho de `src/utils/static.ts:272-277` pelo fluxo da seção 4. Importar de `./internal/range.ts`. Nenhuma assinatura pública muda (`:101-104`, `:9-15`, `:17-66`). |
| `test/static-range.test.ts` | **Novo.** `describeMatrix` cobrindo RF-01 a RF-10 e RF-13 (ver seção 6). |
| `test/unit/range.test.ts` | **Novo.** Testes unitários puros de `parseRange`, `matchesIfRange` e `sliceBody`. Não usam `describeMatrix`, porque não dependem de runtime. |
| `src/index.ts` | **Sem mudança.** `src/index.ts:193` continua igual. |
| `test/static.test.ts` | **Sem mudança.** RF-11: as asserções existentes devem passar como estão. |

---

## 4. Contratos e assinaturas

### 4.1 `src/utils/internal/range.ts` (novo, privado)

Todas as funções exportadas **com tipo de retorno explícito** (`isolatedDeclarations` está ativo).

```ts
/** Intervalo inclusivo em bytes, já limitado a `size - 1`. */
export type ByteRange = { start: number; end: number; size: number };

/**
 * `undefined`: Range ignorado (resposta 200 completa).
 * `"unsatisfiable"`: responder 416.
 * `ByteRange`: responder 206.
 */
export function parseRange(
  header: string | null | undefined,
  size: number | undefined,
): ByteRange | "unsatisfiable" | undefined;

/**
 * Avalia `If-Range` (RFC 9110 §13.1.5).
 * `etag` é o ETag do asset; `lastModified` é o valor de `last-modified` servido.
 */
export function matchesIfRange(
  ifRange: string,
  validators: { etag?: string; lastModified?: string | null },
): boolean;

/** Recorta o corpo para os bytes `[start, end]` (inclusivos). */
export function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit>;
```

Notas de contrato:
- `parseRange(null, …)` retorna `undefined`.
- `matchesIfRange` retorna `false` quando `etag` ou `lastModified` faltam.
- `sliceBody` não altera `body` (um `ReadableStream` é consumido; o chamador não o reutiliza).

### 4.2 Fluxo de `serveStatic` (substitui `src/utils/static.ts:268-277`)

```ts
// passo 7 (inalterado): content-length do asset
if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
  event.res.headers.set("content-length", meta.size + "");
}

// passo 8 (novo)
let range = parseRange(event.req.headers.get("range"), meta.size);
const ifRange = event.req.headers.get("if-range");
if (
  range &&
  ifRange !== null &&
  !matchesIfRange(ifRange, { etag: meta.etag, lastModified: event.res.headers.get("last-modified") })
) {
  range = undefined;
}

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416 });
}

// `getContents` runs once, and never for HEAD or for a 416.
const isHead = event.req.method === "HEAD";
const contents = isHead ? undefined : await options.getContents(id);

if (range && isHead) {
  setPartialHeaders(event, range);
  return new HTTPResponse(null, { status: 206 });
}

if (range && contents) {
  setPartialHeaders(event, range);
  return new HTTPResponse(await sliceBody(contents, range.start, range.end), { status: 206 });
}

// Without `range`, or with a range but empty `contents` (premissa 8): the 200 as today,
// without the range headers set above.
if (isHead) {
  return new HTTPResponse(null, { status: 200 });
}
return new HTTPResponse(contents || null, { status: 200 });
```

Com `setPartialHeaders` definido como função privada em `static.ts`:

```ts
function setPartialHeaders(event: H3Event, range: ByteRange): void {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${range.size}`);
  event.res.headers.set("content-length", `${range.end - range.start + 1}`);
}
```

Regra para quem implementar: `getContents` é chamado **no máximo uma vez** por requisição, e **nunca** em `HEAD` nem em `416`. Por isso `contents` é buscado uma única vez, depois do `416`, e reaproveitado pelos ramos de `206` e `200`.

### 4.3 Accept-Ranges (passo 5, entre `src/utils/static.ts:241` e `:243`)

```ts
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
```

---

## 5. Estratégia de testes

Ordem obrigatória (AGENTS.md, "Bug Fix Workflow" adaptado a feature): escrever os testes, ver falhar, implementar, ver passar.

### 5.1 `test/unit/range.test.ts` (vitest puro)

- `parseRange`: `bytes=0-4`, `bytes=4-`, `bytes=-10`, `bytes=-200` (size 100 → início 0), `bytes=-0` (416), `bytes=100-` (416 em size 100), `bytes=95-200` (fim limitado a 99), `bytes=5-2` (ignorado), `bytes=0-4,10-14` (ignorado), `items=0-4` (ignorado), `bytes=abc`, `bytes=`, `bytes=-` (ignorados), `size` undefined e `0` (ignorados), `null` (ignorado), unidade `BYTES=0-4` (ver D-02).
- `parseRange` com número acima de `Number.MAX_SAFE_INTEGER` como início → `unsatisfiable`.
- `matchesIfRange`: ETag forte igual (true), ETag diferente (false), `W/` em qualquer lado (false), ETag ausente (false), data igual (true), data um segundo diferente (false), data inválida (false), `lastModified` ausente (false).
- `sliceBody`: string multibyte (`aé`, bytes 1-2 → `é`), `ArrayBuffer`, `Uint8Array` com `byteOffset` não zero, `DataView`, `Blob`, `ReadableStream` (1 chunk e vários chunks, com intervalo cruzando a fronteira dos chunks), `cancel` da origem chamado após o último byte (spy).

### 5.2 `test/static-range.test.ts` (`describeMatrix`, roda em `web` e `node`)

Montar o `H3` como em `test/static.test.ts:5-40`. Um arquivo novo evita inflar `test/static.test.ts` (678 linhas), e nenhuma asserção existente é tocada.

Cobertura por requisito:

- **RF-01:** `GET` sem Range → `accept-ranges: bytes`, corpo completo. `404` → sem `accept-ranges`. `405` (`POST`) → sem `accept-ranges`. Fallthrough → sem `accept-ranges`. `options.headers` com `accept-ranges: none` → mantido.
- **RF-02:** tabela de ignorados (sem `content-range`, corpo com 100 bytes).
- **RF-03:** os quatro casos do PRD (`10-19`, `95-200`, `-10`, `-200`, `50-`), com corpo conferido byte a byte.
- **RF-04:** `100-` e `-0` → `416`, `content-range: bytes */100`, `content-length: 0`, corpo vazio, `accept-ranges` presente.
- **RF-05:** `HEAD` com Range → `206`, cabeçalhos iguais ao `GET`, corpo vazio, spy de `getContents` não chamado. `HEAD` com `416` → idem.
- **RF-06:** ETag forte (`"v1"`) → 206; `"v2"` → 200; `W/"v1"` → 200; data igual → 206; data um segundo diferente → 200; sem `If-Range` → 206.
- **RF-07:** `If-None-Match` casando com Range → `304` sem corpo.
- **RF-08:** `206` e `416` com o mesmo `etag`, `last-modified`, `content-type` do `200`; `options.headers` com `content-length: 999` → em `206` vence o do intervalo.
- **RF-09:** `encodings: { gzip: ".gz" }`, `app.js.gz` de 50 bytes, `Accept-Encoding: gzip` e `Range: bytes=0-9` → `206`, `content-encoding: gzip`, `content-range: bytes 0-9/50`, corpo = primeiros 10 bytes de `app.js.gz`.
- **RF-10:** para cada tipo de corpo (`string`, `ArrayBuffer`, `Blob`, `ReadableStream`), `abcdefgh` com `bytes=2-4` → `cde`. `aé` com `size: 3` e `bytes=1-2` → `é`. `ReadableStream` com `cancel` monitorado e `bytes=0-1` em 8 bytes → corpo `ab` e `cancel` chamado. Repetir o loop de tipos dentro de um único `it` (o wrapper de `describeMatrix` não garante `it.each`).
- **RF-11:** `test/static.test.ts` passa sem alteração em `web` e `node`.
- **Caso de premissa 8:** `getContents` devolve `undefined` com Range válido → `200`, sem `content-range`, sem corpo, `getContents` chamado uma vez.
- **Caso de tamanho desconhecido:** `getMeta` sem `size` com `Range: bytes=0-4` → `200` completo, `accept-ranges: bytes` presente.

### 5.3 Verificação de RF-12

- `test/unit/package.test.ts:133` já compara a lista de exports. Deve passar sem alteração.
- Conferência manual: `git diff -- src/index.ts` vazio.

### 5.4 Gates

- `pnpm vitest run test/static` (cobre `static.test.ts`, `static-range.test.ts`, `static.test.ts` fallthrough).
- `pnpm vitest run test/security.test.ts test/unit/` (outros usuários de `serveStatic`, `security.test.ts:243-395`).
- `pnpm lint` e `pnpm typecheck`.
- `pnpm test` completo antes do PR.
- Verificação manual com um player real de vídeo (PRD, risco 5), fora do CI.

---

## 6. Riscos

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| 1 | `getContents` vai chamar a origem por completo mesmo para um Range pequeno (sem API de leitura parcial). | Média | Cancelamento do stream após o último byte (D-06). Melhoria futura fora de escopo. |
| 2 | `size` de `getMeta` não bate com o corpo: `Content-Length` errado ou stream terminando cedo. | Alta | Testes de RF-10 com todos os tipos. Documentar a premissa 1 no JSDoc de `StaticAssetMeta` (sem mudar o tipo). |
| 3 | RFC 9110 trata validadores de data com ressalvas de "forte"; a regra do PRD (data idêntica) pode dar `206` onde a norma pede o `200`. | Média | **Confirmar no texto de §13.1.5 antes da implementação.** Se a norma for mais restritiva, a mudança fica restrita a `matchesIfRange`. |
| 4 | Unidade de `Range` sensível a caixa (D-02). | Baixa | Confirmar em §14.1; a mudança é de uma linha. |
| 5 | `h3/rules/cache` (ocache, `src/utils/cache.ts`) ou um cache de CDN pode guardar um `206` pela URL e servi-lo como `200`. | Média | Fora de escopo para o código. Registrar para revisão: testar `routeRules` com `cache` sobre rota de `serveStatic`, se for usada. |
| 6 | `string` com `size` em caracteres (não bytes) produz recorte errado. | Média | RF-10 com `aé`. A premissa 1 já exige bytes. |
| 7 | `static.ts` cresce por causa do passo 8 e da função `setPartialHeaders`. | Baixa | D-01: lógica de intervalo em `utils/internal/range.ts`. `static.ts` ganha ~25 linhas. |
| 8 | Chamada dupla de `getContents` no caminho de premissa 8. | Média | Regra da seção 4.2: buscar `contents` uma vez. Teste de contagem de chamadas. |
| 9 | Número muito grande em `Range` (perda de precisão). | Baixa | Teste de `parseRange` com inteiro acima de `MAX_SAFE_INTEGER`. |

---

## 7. Pendências para quem implementa

1. Confirmar D-02 (caixa da unidade) e D-05/risco 3 (validador por data) no texto da RFC 9110. Esta especificação não pôde fazer essa checagem.
2. Decidir se a documentação de `serveStatic` (JSDoc em `src/utils/static.ts:68-100`) ganha um parágrafo sobre Range. O PRD proíbe mudança em README, não em JSDoc.
3. Abrir issue separada para o risco 5 (cache de `206`), se `h3/rules/cache` for usado com `serveStatic`.
