# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-13). Norma: RFC 9110 §13.1.5, §13.2.2 e §14. Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `5554f9b`).

## 1. Visão geral do fluxo atual e ponto de inserção

`serveStatic` (`src/utils/static.ts:101`) executa, em ordem:

1. aplica `options.headers` em `event.res.headers` (`static.ts:105-114`);
2. 405 / `fallthrough` para método fora de GET/HEAD (`static.ts:116-122`);
3. 404 / `fallthrough` para caminho não canônico (`static.ts:142-147`);
4. escolhe a variante via `getMeta` (`static.ts:198-208`) e responde 404 se não houver (`static.ts:210-215`);
5. `Vary` (`static.ts:220-225`), `Last-Modified` (`static.ts:227-237`), `ETag` (`static.ts:239-241`);
6. 304 por `isCacheMatch` (`static.ts:243-248`);
7. `Content-Type` (`static.ts:250-262`), `Content-Encoding` (`static.ts:264-266`), `Content-Length` = `meta.size` se ausente (`static.ts:268-270`);
8. HEAD → `HTTPResponse(null, 200)` (`static.ts:272-274`); GET → `getContents` e `HTTPResponse(contents || null, 200)` (`static.ts:276-277`).

O Range entra **entre os passos 6 e 8**, depois do 304 (RFC 9110 §13.2.2: pré-condições antes de Range) e depois de `Content-Encoding`/`Vary` já definidos (RF-10). Os passos 1–6 não mudam (RF-09, RF-11).

Como a resposta final é montada (`src/response.ts`): um `HTTPResponse` devolvido pelo handler não é `instanceof Response`, logo cai em `prepareResponseBody` (`response.ts:188-189`, `response.ts:304-306`) e os cabeçalhos de `event.res.headers` são mesclados **por cima** dos do `HTTPResponse` (`response.ts:201-204`, `mergeHeaders` em `response.ts:243-252` usa `set`). O filtro "4xx só recebe `errHeaders`" (`response.ts:211-213`) só vale para `Response` nativo; portanto um 416 devolvido como `HTTPResponse` mantém `ETag`, `Last-Modified`, `Vary` e cabeçalhos do usuário. `HEAD` tem o corpo removido por `nullBody` (`response.ts:350-352`).

## 2. Decisões de arquitetura

### D-01 — Onde fica o código auxiliar

- **Alternativas:** (a) tudo em `src/utils/static.ts`; (b) novo `src/utils/internal/range.ts`; (c) estender `src/utils/internal/cache.ts`.
- **Escolha: (b).** `static.ts` já tem 352 linhas e o AGENTS.md pede arquivos curtos (< 200 LoC) e helpers em `utils/internal/`. `cache.ts` trata validadores de pré-condição (304), não Range; misturar dificulta a leitura. O arquivo novo não é referenciado por `src/index.ts` (que só exporta `serveStatic` e tipos em `src/index.ts:193`), então nenhum nome público é criado. Não há barrel; `static.ts` importa direto com extensão `.ts`.

### D-02 — Escrever os cabeçalhos de Range em `event.res.headers`, não só no `HTTPResponse`

- **Alternativas:** (a) passar `Content-Range`/`Content-Length` em `new HTTPResponse(body, { headers })`; (b) `event.res.headers.set(...)`.
- **Escolha: (b).** Pela mesclagem de `response.ts:201-204`/`243-252`, o `Content-Length: <size>` já colocado em `event.res.headers` (`static.ts:268-270`) ou vindo de `options.headers` sobrescreveria o do `HTTPResponse`, gerando `Content-Length` errado no 206/416 (RF-13). Usar `event.res.headers.set("content-length", …)` e `set("content-range", …)` garante que o valor do corpo realmente enviado vença. Em 200 o comportamento atual (inclusive respeitar `content-length` já presente, teste `test/static.test.ts:600-617`) permanece intacto. O status vai em `new HTTPResponse(body, { status: 206 | 416 })`, como o 200/304 atuais.

### D-03 — Condição para aplicar Range e `Accept-Ranges`

- **Alternativas:** (a) anunciar `Accept-Ranges` sempre; (b) só com `size` válido; (c) só quando houver `Range`.
- **Escolha: (b)**, conforme RF-01/RF-08. "Tamanho válido" = `Number.isSafeInteger(meta.size) && meta.size > 0` (hoje o código só testa `> 0`, `static.ts:268`; inteiro seguro evita `NaN`/fração/infinito gerando `Content-Range` inválido). Com tamanho válido: `Accept-Ranges: bytes` é definido **se ainda ausente** (mesmo critério de `content-type`, `static.ts:250`, e `content-encoding`, `static.ts:264`), logo depois do 304 — o 304 continua exatamente como hoje. Sem tamanho válido: nenhum cabeçalho novo e o `Range` é ignorado (200 como hoje).
- O valor `bytes` é anunciado também em respostas 200, 206 e 416 e em HEAD.

### D-04 — Parser de `Range` estrito e seguro contra números enormes

- **Alternativas:** (a) `split`/`parseInt` tolerante; (b) regex estrita; (c) biblioteca externa (descartada: o projeto tem 2 deps de produção).
- **Escolha: (b)** `/^bytes=(\d*)-(\d*)$/i` aplicado ao valor com `trim()`. A unidade é case-insensitive (RFC 9110 §14.1). Qualquer outra forma — `bytes=abc`, `bytes=`, `items=0-1`, lista com vírgula (multi-range, inclusive vários cabeçalhos `Range`, que `Headers.get` une com `, `), espaços internos — não casa e o Range é **ignorado** (RF-06). Casos: início e fim vazios (`bytes=-`) → ignorar; `início-fim` com `fim < início` → ignorar (`5-2`); `início-` e `início-fim` com `início >= size` → insatisfazível (416); `-sufixo` com sufixo `0` → insatisfazível (`-0`); sufixo > size → `0..size-1`; `fim >= size` → `fim = size-1`.
- Números: convertidos com `Number()`; dígitos demais viram um float enorme (ou `Infinity`), nunca exceção. Como o resultado é sempre comparado/limitado a `size` (que é inteiro seguro), imprecisão acima de `MAX_SAFE_INTEGER` não altera o resultado: início enorme → 416, fim enorme → clamp, sufixo enorme → asset inteiro. Isso atende ao risco de segurança do PRD sem tratar o valor como inválido. O teste `bytes=0-99999999999999999999` fixa esse comportamento.

### D-05 — `If-Range`

- **Alternativas:** (a) ignorar `If-Range`; (b) reutilizar `isCacheMatch`/`matchETag` (`src/utils/internal/cache.ts:11-17`, `29-49`); (c) comparação própria.
- **Escolha: (c).** `matchETag` usa comparação **fraca** (ignora `W/`), mas `If-Range` exige comparação **forte** (RFC 9110 §13.1.5) — reutilizar aceitaria `W/"abc"`, contrariando RF-07. Regras:
  - valor de `If-Range` começando com `"` ou `W/` é ETag: só vale se for byte a byte igual ao `ETag` efetivo da resposta e **nenhum dos dois** começar com `W/`;
  - caso contrário é data HTTP: `Date.parse` do valor deve ser finito e igual a `Date.parse` do `Last-Modified` efetivo da resposta (igualdade exata; data inválida ou diferente → ignora Range);
  - sem validador correspondente disponível (asset sem `etag`/`mtime`) → `If-Range` presente invalida o Range (200).
- "Efetivo" = valor em `event.res.headers` (`etag` e `last-modified`), pois `options.headers` pode ter fixado esses cabeçalhos antes de `meta` (`static.ts:234`, `239`); assim o validador comparado é o mesmo que o cliente viu. `If-Range` sem `Range` é ignorado.

### D-06 — Corte do corpo por tipo de `BodyInit`

- **Alternativas:** (a) materializar tudo com `new Response(body).arrayBuffer()` e fatiar; (b) corte específico por tipo, com `ReadableStream` incremental.
- **Escolha: (b)** (mitiga o risco de bufferização do PRD). Função privada `sliceBody(body, start, end)` devolvendo `BodyInit`:
  - `string` → `TextEncoder().encode(body).subarray(start, end + 1)` (tamanho em UTF-8, RF-12);
  - `Uint8Array`/`ArrayBufferView` → `subarray` respeitando `byteOffset`; `ArrayBuffer`/`SharedArrayBuffer` → `new Uint8Array(buf, start, len)`;
  - `Blob` (inclui `File`) → `blob.slice(start, end + 1)` (sem leitura);
  - `ReadableStream` → novo `ReadableStream` com `pull` que lê do leitor original, descarta os primeiros `start` bytes, repassa no máximo `len` bytes e chama `reader.cancel()` ao terminar; sem acumular chunks;
  - demais (`FormData`, `URLSearchParams`) → `new Response(body).body` e cai no caso de stream.
- O intervalo é calculado a partir de `meta.size`, nunca do tamanho real do corpo (RF-12). Se o corpo real for menor que o declarado, o `Content-Length` não bate — risco documentado em §6.
- `getContents` continua recebendo só o `id` (fora de escopo mudá-lo).

### D-07 — Ordem de operações e tratamento de `getContents` vazio

Depois do 304, o fluxo novo é:

1. calcular `range = resolveRange(rangeHeader, size, ifRange, validators)` → `undefined` (ignorar) | `"unsatisfiable"` | `{ start, end }`;
2. **HEAD:** 206/416 só com cabeçalhos; `getContents` não é chamado (RF-04);
3. **416** (GET e HEAD): `Content-Range: bytes */<size>`, `Content-Length: 0`, corpo `null`, sem chamar `getContents` (RF-05);
4. **206 em GET:** chamar `getContents(id)` **antes** de escrever `Content-Range`/`Content-Length`; se devolver `null`/`undefined`, responder como hoje (200, corpo nulo, sem cabeçalhos de Range) para não anunciar parcial sem corpo; senão aplicar D-06 e então `set` dos cabeçalhos (D-02).

Isso preserva 404/405/`fallthrough` (retornam antes, `static.ts:116-122`, `142-147`, `210-215`) e o 304 (RF-09, RF-11).

### D-08 — Cabeçalhos em 416 e 206

- 206 e 416 mantêm `ETag`, `Last-Modified`, `Vary`, `Cache-Control` e cabeçalhos do usuário (RF-09, RF-13), `Content-Type` e `Content-Encoding` da variante (RF-10). Só `Content-Length` e `Content-Range` são sobrescritos.
- **Alternativa considerada:** remover `Content-Type`/`Content-Encoding` no 416. Descartada: o PRD não pede e manter evita divergir do que o cliente já cacheou; o `Content-Length: 0` torna o corpo vazio inequívoco.
- Em 200 sem `Range` nada muda além de `Accept-Ranges`.

## 3. Arquivos a alterar

| Arquivo | Linhas atuais | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `static.ts:1-7` (imports) | importar helpers de `./internal/range.ts` |
| `src/utils/static.ts` | `static.ts:268-270` | manter a lógica de `content-length`; acrescentar logo depois a definição de `Accept-Ranges` e o ramo de Range |
| `src/utils/static.ts` | `static.ts:272-277` | HEAD/GET passam a considerar `range` (D-07); caminho sem Range permanece idêntico |
| `src/utils/internal/range.ts` | novo | `parseRange`, `isIfRangeFresh`, `resolveRange`, `sliceBody` (todos privados ao módulo interno; só `static.ts` importa) |
| `test/static.test.ts` | `test/static.test.ts:5-40` (padrão de setup), fim do arquivo | novo `describeMatrix("serve static range", …)`; ver §5 |
| `docs/2.utils/2.response.md` | `docs/2.utils/2.response.md:39` (seção `serveStatic`) | parágrafo curto sobre Range, `Accept-Ranges` e exigência de `size` exato (opcional pelo PRD) |

**Não alterados:** `src/index.ts` (`src/index.ts:193` continua exportando apenas `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`), `src/response.ts`, `src/utils/internal/cache.ts`, interfaces `StaticAssetMeta`/`ServeStaticOptions` (`static.ts:9-66`).

## 4. Contratos e assinaturas

Tudo em `src/utils/internal/range.ts` (nenhum `export` é reexportado; `isolatedDeclarations` exige tipos explícitos nos exports):

```ts
export type ByteRange = { start: number; end: number }; // ambos inclusivos, 0 <= start <= end < size

/** `undefined` = ignorar Range (200 completo); "unsatisfiable" = 416. */
export function resolveRange(
  headers: Headers,
  size: number,
  validators: { etag?: string | null; lastModified?: string | null },
): ByteRange | "unsatisfiable" | undefined;

/** Passo estrito de D-04. */
export function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Comparação forte de D-05. `true` quando não há `If-Range`. */
export function isIfRangeFresh(
  ifRange: string | null,
  validators: { etag?: string | null; lastModified?: string | null },
): boolean;

/** Recorta `start..end` (inclusivos) em bytes do corpo (D-06). */
export function sliceBody(body: BodyInit, range: ByteRange): BodyInit;
```

`resolveRange` devolve `undefined` quando não há cabeçalho `Range`, quando `isIfRangeFresh` é falso ou quando o parser ignora o valor.

Resposta resultante (`size` = `meta.size`):

| Caso | Status | Cabeçalhos adicionais | Corpo |
| --- | --- | --- | --- |
| sem Range / ignorado | 200 | `Accept-Ranges: bytes` | completo (HEAD: nulo) |
| válido | 206 | `Content-Range: bytes s-e/size`, `Content-Length: e-s+1` | bytes `s..e` (HEAD: nulo) |
| insatisfazível | 416 | `Content-Range: bytes */size`, `Content-Length: 0` | nulo |
| 304 / 404 / 405 | como hoje | — | como hoje |

Esboço do ramo em `static.ts` (após o 304 e a definição de `content-length`):

```ts
const size = meta.size;
if (Number.isSafeInteger(size) && size! > 0) {
  if (!event.res.headers.has("accept-ranges")) {
    event.res.headers.set("accept-ranges", "bytes");
  }
  const range = resolveRange(event.req.headers, size!, {
    etag: event.res.headers.get("etag"),
    lastModified: event.res.headers.get("last-modified"),
  });
  // 416 / 206 conforme D-07; `return` aqui, senão cai no fluxo 200 atual
}
```

## 5. Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever os testes novos primeiro, confirmar que **falham** (`pnpm vitest run test/static.test.ts`), implementar, confirmar que passam, rodar a suíte.

Novos testes em `test/static.test.ts` usando `describeMatrix` (web + node), com `getMeta`/`getContents` via `vi.fn` e asset `0123456789` (`size: 10`), mesmo estilo de `test/static.test.ts:5-31`:

- **RF-01:** GET/HEAD sem Range → 200 + `accept-ranges: bytes`.
- **RF-02/03:** `2-5`, `4-`, `-3`, `8-999`, `-50` com corpo, `Content-Range` e `Content-Length` esperados.
- **RF-04:** HEAD com Range → 206 sem corpo e `getContents` não chamado.
- **RF-05:** `10-20`, `-0` e `bytes=0-99999999999999999999`/`bytes=99999999999999999999-` (GET e HEAD) → 416 / 206 conforme D-04, `content-range: bytes */10`, `content-length: 0`.
- **RF-06:** `bytes=abc`, `5-2`, `0-1,4-5`, `items=0-1`, `bytes=`, `bytes=-` → 200 completo, sem `content-range`.
- **RF-07:** `If-Range` com ETag igual / data exata → 206; ETag diferente, `W/"abc"`, data diferente, data inválida e `If-Range` sem validador no asset → 200.
- **RF-08:** `getMeta` sem `size` e com `size: 0` → 200, sem `content-range`/`accept-ranges`/416.
- **RF-09:** `If-None-Match` correspondente + Range → 304 sem `content-range`; 206 e 416 contêm `etag` e `last-modified`.
- **RF-10:** `encodings: { gzip: ".gz" }`, `accept-encoding: gzip`, `size` da variante → 206 dos primeiros bytes, `content-encoding: gzip`, `vary: accept-encoding`, `content-range` com o size da variante.
- **RF-11:** asset inexistente, caminho não canônico e método POST com `Range` → mesmos 404/405 (e `undefined` em `fallthrough`).
- **RF-12:** `getContents` devolvendo `string` (inclusive com caracteres multibyte, `size` em bytes UTF-8), `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream` em vários chunks → corpo exato do intervalo; para o stream, verificar que um intervalo no início cancela a leitura (não consome todos os chunks).
- **RF-13:** `options.headers` com `cache-control` e `content-length: 999` → preservados em 200; em 206/416 `content-length` e `content-range` refletem o corpo.
- `getContents` retornando `null` com Range válido → 200 sem `content-range` (D-07).

Testes unitários de `parseRange`/`isIfRangeFresh`/`sliceBody` em `test/unit/` (arquivo novo, importando `../../src/utils/internal/range.ts` diretamente) para os casos de borda numéricos.

Testes existentes: `test/static.test.ts:53`, `69`, `450`, `466` usam `toMatchObject`, portanto o novo `accept-ranges` não os quebra; `test/static.test.ts:600-617` (content-length 999 em 200/HEAD) continua verdadeiro porque o 200 não é alterado. Nenhuma asserção existente deve ser enfraquecida. Ao final: `pnpm vitest run test/static.test.ts`, `pnpm test` e `pnpm lint` (inclui typecheck); conferir que `git diff src/index.ts` está vazio.

## 6. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| `meta.size` diferente do corpo real (arquivo trocado entre `getMeta` e `getContents`) → `Content-Length` não bate | corte pelo intervalo calculado; documentar que `size` deve ser exato; mesma premissa que o `Content-Length` atual (`static.ts:268`) |
| `size` do original usado com variante comprimida | o `size` vem do `getMeta` da variante escolhida (`static.ts:200-206`); teste RF-10 |
| `Content-Length` de `options.headers` ou de `meta` sobrescrevendo o do 206/416 | D-02: `set` direto em `event.res.headers` |
| Streams grandes bufferizados | D-06: leitura incremental e `cancel()` ao atingir o fim; `Blob.slice` sem leitura |
| Corte de string com `TextEncoder` aloca o texto inteiro em memória | aceitável: a string já está em memória; `getContents` por range é otimização futura (fora de escopo) |
| `If-Range` com ETag fraco aceito por engano | D-05: comparação forte própria, sem reutilizar `matchETag` |
| `accept-ranges` definido em `options.headers` com outro valor | só definimos quando ausente; o Range continua processado — comportamento documentado, caso raro |
| Divergência Node × web no HEAD/206 | `describeMatrix`; remoção de corpo em HEAD já garantida por `nullBody` (`response.ts:350-352`) |
| Números enormes no Range | D-04: `Number()` + clamp a `size`; nunca lança |
| Vazamento de nome público | helpers só em `internal/range.ts`; verificar `src/index.ts` sem diff |
| `static.ts` crescer demais | lógica pesada fora do arquivo (D-01); o ramo em `static.ts` fica em ~25 linhas |
