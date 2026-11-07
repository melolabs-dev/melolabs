# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md`, `sdd/prd.md`, `AGENTS.md`. Norma: RFC 9110 §13.1.5, §13.2.2, §14. Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `4caa74e`).

## 1. Visão geral do fluxo atual

`serveStatic` (`src/utils/static.ts:101`) segue esta ordem:

1. aplica `options.headers` em `event.res.headers` (`static.ts:105-114`);
2. rejeita métodos ≠ GET/HEAD com 405 ou `undefined` (`static.ts:116-122`);
3. rejeita caminho não canônico (`static.ts:142-147`);
4. escolhe a variante via `getMeta` (`static.ts:198-208`), 404/fallthrough se não houver (`static.ts:210-215`);
5. acrescenta `vary: accept-encoding` (`static.ts:220-225`), `last-modified` (`static.ts:227-237`) e `etag` (`static.ts:239-241`);
6. devolve 304 se `isCacheMatch` casar (`static.ts:243-248`);
7. define `content-type` (`static.ts:250-262`), `content-encoding` (`static.ts:264-266`) e `content-length` a partir de `meta.size`, sem sobrescrever valor existente (`static.ts:268-270`);
8. `HEAD` → `HTTPResponse(null, 200)` (`static.ts:272-274`); `GET` → `getContents(id)` e `HTTPResponse(contents || null, 200)` (`static.ts:276-277`).

Os cabeçalhos de `event.res.headers` são mesclados com `set` sobre os do `HTTPResponse` em `prepareResponse` (`src/response.ts:195-205`). Portanto, um `content-length` ou `content-range` posto em `event.res.headers` vence qualquer valor do `HTTPResponse`. `HEAD` já tem o corpo anulado por `nullBody` (`src/response.ts:350-356`).

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica: `src/utils/internal/range.ts` (novo, não exportado)

**Alternativas:**
(a) tudo em `static.ts`; (b) novo arquivo interno `src/utils/internal/range.ts`; (c) utilitário público `parseRange`.

**Escolha: (b).** `static.ts` já tem 352 linhas, e o AGENTS.md pede arquivos curtos (< 200 LoC) com auxiliares em `utils/internal/`. (c) viola RF-13 e o pedido ("sem novas exportações"). O módulo interno não é reexportado por `src/index.ts` (que só exporta `serveStatic` e tipos em `src/index.ts:193`). O guard `test/unit/package.test.ts:4-6` (snapshot de exports de `_entries/generic.ts`) já pega qualquer vazamento. O padrão segue `src/utils/internal/cache.ts`.

### D-02 — Ponto de inserção e ordem de avaliação (RFC 9110 §13.2.2)

**Alternativas:** (a) avaliar `Range` antes do 304; (b) avaliar depois do 304 e antes de `content-length`; (c) refatorar `serveStatic` em etapas.

**Escolha: (b).** A RFC manda avaliar as condicionais (`If-None-Match`/`If-Modified-Since`) antes de `Range`+`If-Range`, e o PRD (RF-09) pede que o 304 continue decidindo primeiro. O bloco novo entra entre `static.ts:266` (`content-encoding`) e `static.ts:268` (`content-length`), para que o 416 e o 206 sobrescrevam `content-length` e `content-encoding` com valores coerentes. (c) aumentaria o diff sem necessidade. `If-Match`/`If-Unmodified-Since` não existem hoje e ficam fora de escopo (registrado em R-08).

### D-03 — `Accept-Ranges: bytes` condicionado a `size` conhecido, inclusive no 304

**Alternativas:** (a) sempre anunciar (como a issue propõe); (b) só quando `meta.size > 0`; (c) anunciar só em 200/206.

**Escolha: (b), emitido antes do teste de cache.** RF-07 exige não anunciar sem `size`, e RF-01 inclui o 304. Por isso a definição do cabeçalho vai logo após o `etag` (`static.ts:241`), antes de `static.ts:243`. Isso evita anunciar uma capacidade que não será honrada. Não sobrescreve um `accept-ranges` já definido pelo usuário. Em fallthrough/404/405 nada é emitido, porque o código só chega ali depois de achar o asset (`static.ts:210-215`).

### D-04 — Parser de `Range`: função pura que devolve resultado em 3 estados

**Alternativas:** (a) lançar exceção em caso inválido; (b) devolver `undefined | {start,end} | "unsatisfiable"`; (c) usar biblioteca externa (ex.: `range-parser`).

**Escolha: (b).** O contrato do PRD tem exatamente três saídas: ignorar (RF-06), satisfatório (RF-02/03), insatisfatório (RF-05). (c) quebraria "2 deps de produção" do AGENTS.md. Regras (RFC 9110 §14.1.1–14.1.2, §14.2):

- unidade `bytes` sem diferenciar maiúsculas; outra unidade → `undefined`;
- um único `range-spec` (vírgula → `undefined`, ignora multi-range);
- `a-b`: `b < a` → `undefined` (inválido); `a >= size` → `"unsatisfiable"`; `b` é limitado a `size-1`;
- `a-`: `a >= size` → `"unsatisfiable"`; fim = `size-1`;
- `-n`: `n = 0` → `"unsatisfiable"`; `n >= size` → `{0, size-1}`; senão `{size-n, size-1}`;
- `bytes=`, `bytes=-`, texto não numérico, sinais, espaços internos → `undefined`. OWS nas pontas é tolerado.

A validação usa regex `^bytes=(\d*)-(\d*)$` após `trim`, sem aritmética com números fora do intervalo seguro: `Number()` de dígitos enormes dá um valor grande, que cai no ramo "insatisfatório" ou é limitado a `size-1`.

### D-05 — `If-Range`: comparação forte de ETag e igualdade exata de data

**Alternativas:** (a) reutilizar `matchETag` de `internal/cache.ts` (comparação fraca); (b) função própria com comparação forte; (c) ignorar `If-Range`.

**Escolha: (b).** `matchETag` ignora `W/` (`src/utils/internal/cache.ts:51-53`), o que contraria RF-08 (ETag fraco nunca satisfaz). Regras de `ifRangeAllows(ifRange, { etag, lastModified })`:

- sem `If-Range` → `true`;
- valor começando com `"` ou `W/` é entity-tag: `true` só se **ambos** (o do cliente e o `etag` da resposta) forem fortes (começam com `"`, sem `W/`) e idênticos como string;
- caso contrário é data: faz `Date.parse` e compara com `Date.parse(last-modified da resposta)`; igualdade exata de milissegundos; data inválida ou sem `last-modified` → `false`;
- `false` significa "ignore o `Range`": resposta 200 completa.

Os validadores vêm de `event.res.headers.get("etag")` / `get("last-modified")` (valores finais que o cliente vê, inclusive os definidos pelo usuário em `options.headers`), não de `meta`. Observação: os testes existentes usam `etag: "w/123"` (minúsculo, que não é `W/` nem tem aspas); com a regra "forte = começa com `"`" ele é tratado como não forte, o que é o comportamento seguro.

### D-06 — Corte do corpo sem carregar tudo, por tipo de `BodyInit`

**Alternativas:** (a) sempre `new Response(body).arrayBuffer()` e `subarray`; (b) cortar por tipo, com stream contado para `ReadableStream`; (c) pedir fatia ao `getContents` (novo parâmetro).

**Escolha: (b).** (c) muda API pública (fora de escopo, PRD §3). (a) carrega arquivos grandes na memória (risco do PRD). `sliceBody(body, start, end)` (interno, assíncrono) faz:

- `string` → `TextEncoder().encode(s).subarray(start, end + 1)` (a string já está em memória);
- `Blob`/`File` → `blob.slice(start, end + 1)` (preguiçoso, sem copiar);
- `ArrayBuffer` → `new Uint8Array(buf, start, len)`; `ArrayBufferView` → `new Uint8Array(v.buffer, v.byteOffset + start, len)`;
- `ReadableStream` → novo `ReadableStream` que lê do leitor original, descarta `start` bytes, repassa até `len` bytes e depois chama `cancel()` na origem e fecha; chunks `Uint8Array` (strings são codificadas; outro tipo → erro do stream);
- demais tipos (`FormData`, `URLSearchParams`) → `new Response(body).arrayBuffer()` e `subarray` (fallback razoável, documentado no código).

O `Content-Length` do 206 é `end - start + 1`; se a origem for mais curta que `size`, o stream encerra antes (risco R-01).

### D-07 — Montagem das respostas 206 e 416

**Alternativas:** (a) devolver `Response` nativa; (b) `HTTPResponse` com `status` e cabeçalhos em `event.res.headers`; (c) lançar `HTTPError(416)`.

**Escolha: (b).** Mantém o padrão do arquivo (`HTTPResponse`, `static.ts:244`, `:273`, `:277`) e herda a mesclagem de cabeçalhos de `event.res`. (c) produz corpo JSON de erro e descarta cabeçalhos de sucesso (`src/response.ts:211-213`), contrariando `Content-Length: 0`.

- **206:** `event.res.headers.set("content-range", "bytes S-E/SIZE")` e `set("content-length", String(E-S+1))`, ambos **incondicionais** (RF-12: o valor do usuário só vale sem `Range`). `etag`, `last-modified`, `vary` e `cache-control` permanecem (RF-09). `HEAD` devolve `new HTTPResponse(null, { status: 206 })` sem chamar `getContents`.
- **416:** `content-range: bytes */SIZE`, `content-length: 0`, `delete("content-encoding")` (não há corpo codificado), `HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`; vale também para `HEAD`; `getContents` não é chamado.
- **`getContents` sem conteúdo** (`null`/`undefined`) com `Range` válido: cai no comportamento atual (200 com corpo `null`), sem `content-range`. Por isso, no `GET`, o conteúdo é obtido **antes** de fixar os cabeçalhos do 206.

### D-08 — Sem `size` (ausente ou `0`) desativa tudo

**Alternativas:** (a) tentar descobrir o tamanho lendo o corpo; (b) desativar.

**Escolha: (b)** (RF-07). A condição reutiliza o teste existente de `static.ts:268` (`meta.size !== undefined && meta.size > 0`) como uma `const knownSize`. `Range` é ignorado, nenhum `accept-ranges` é emitido, e o `content-length` do usuário ou a ausência dele ficam como hoje.

### D-09 — Cabeçalhos do 200 com `Range` ignorado

Quando o `Range` é ignorado (malformado, multi, `If-Range` falso, sem `size`), o fluxo segue exatamente o caminho atual (`static.ts:268-277`) e produz 200. Só se acrescenta `accept-ranges: bytes` quando há `size` (D-03). `Range` com `If-Range` falso não deve gerar `Vary`: o resultado depende de validadores já enviados, como a RFC espera.

## 3. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `1-7` | importar `parseRange`, `ifRangeAllows`, `sliceBody` de `./internal/range.ts` |
| `src/utils/static.ts` | `241-243` | `accept-ranges: bytes` quando `size` conhecido, antes do teste `isCacheMatch` (D-03) |
| `src/utils/static.ts` | `264-270` | resolver o intervalo após `content-encoding` e antes de `content-length`; 416 imediato (D-02, D-07) |
| `src/utils/static.ts` | `272-277` | ramos `HEAD`/`GET` com 206 e corte do corpo; manter 200 atual como padrão |
| `src/utils/internal/range.ts` | novo | `parseRange`, `ifRangeAllows`, `sliceBody` (≈ 120 LoC) |
| `test/static.test.ts` | novo `describeMatrix` após `:394` | cobrir RF-01…RF-12 |
| `test/unit/range.test.ts` | novo | testes unitários do parser, de `If-Range` e de `sliceBody` |

Não alterar: `src/index.ts:193` (nenhum nome novo), `src/utils/internal/cache.ts`, `src/response.ts`, `ServeStaticOptions` (`static.ts:17-66`) e `StaticAssetMeta` (`static.ts:9-15`). Os testes existentes em `test/static.test.ts:42-71`, `:439-468` usam `toMatchObject` e continuam válidos; apenas `accept-ranges` surge como cabeçalho extra, sem exigir edição. `test/static.test.ts:600-617` (content-length do usuário em `HEAD` sem `Range`) segue valendo.

## 4. Contratos e assinaturas (todos internos, em `src/utils/internal/range.ts`)

```ts
/** Intervalo inclusivo de bytes, já normalizado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * RFC 9110 §14.1–14.2. `undefined`: ignorar o cabeçalho (malformado, unidade
 * desconhecida, multi-range). `"unsatisfiable"`: responder 416.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | undefined;

/**
 * RFC 9110 §13.1.5. `false`: o `Range` deve ser ignorado.
 * ETag: comparação forte. Data: igualdade exata com `last-modified`.
 */
export function ifRangeAllows(
  ifRange: string | null,
  validators: { etag?: string | null; lastModified?: string | null },
): boolean;

/** Fatia `body` para `[start, end]` (inclusivo) sem carregar tudo quando possível. */
export function sliceBody(
  body: BodyInit,
  range: ByteRange,
): BodyInit | Promise<BodyInit>;
```

`ByteRange` deve ser `export interface` dentro do módulo interno, pois com `isolatedDeclarations` as assinaturas exportadas precisam de tipo nomeado. Isso não o expõe em `src/index.ts`, e RF-13 trata da API pública. Esboço do uso em `serveStatic`:

```ts
const knownSize = meta.size !== undefined && meta.size > 0;
// ... após o etag:
if (knownSize && !event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
// ... após content-encoding:
let range: ByteRange | undefined;
const rangeHeader = event.req.headers.get("range");
if (knownSize && rangeHeader && ifRangeAllows(event.req.headers.get("if-range"), {
  etag: event.res.headers.get("etag"),
  lastModified: event.res.headers.get("last-modified"),
})) {
  const parsed = parseRange(rangeHeader, meta.size!);
  if (parsed === "unsatisfiable") {
    event.res.headers.delete("content-encoding");
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }
  range = parsed;
}
```

No `HEAD` com `range`: define `content-range`/`content-length` e devolve 206. No `GET`: `getContents`; se houver conteúdo, `sliceBody`, define os cabeçalhos e devolve 206; senão 200 como hoje. O `If-Range` é avaliado só quando há `Range` (a condição acima já garante isso).

## 5. Estratégia de testes

Seguir `describeMatrix` (web + node), com `ctx.app` novo por teste e `vi.fn` para `getContents`/`getMeta`, como em `test/static.test.ts:5-31`. Pedido base: asset de 100 bytes (`"0123456789".repeat(10)`), `etag: '"v1"'`, `mtime` fixo.

**Integração (`test/static.test.ts`, novo `describeMatrix("serve static range")`):**

- RF-01: 200 completo com `accept-ranges: bytes`, em `GET` e `HEAD`; 304 também traz `accept-ranges`.
- RF-02/03: `10-19`, `90-`, `-10`, `90-999`, `-500` com corpo, `content-range` e `content-length` exatos.
- RF-04: `HEAD` com `Range` → 206, mesmos cabeçalhos do `GET`, corpo vazio, `getContents` não chamado (`not.toHaveBeenCalled`).
- RF-05: `100-`, `150-200`, `-0` → 416, `content-range: bytes */100`, `content-length: 0`, corpo vazio; `HEAD` idem; `getContents` não chamado.
- RF-06: `abc`, `5-2`, vazio, `items=0-1`, `0-1,5-6` → 200 completo.
- RF-07: `getMeta` sem `size` e com `size: 0` → 200, sem `accept-ranges`.
- RF-08: `If-Range` com ETag forte igual → 206; ETag diferente, `W/"v1"` e data diferente → 200 completo; data igual ao `Last-Modified` → 206; `If-Range` sem `Range` → 200.
- RF-09: `If-None-Match` casando + `Range` → 304 sem `content-range`; `etag`, `last-modified`, `vary` e `cache-control` presentes no 206.
- RF-10: `encodings: { gzip: ".gz" }`, `accept-encoding: gzip` + `Range` → fatia da variante `.gz` com o `size` dela, `content-encoding: gzip`, `vary: accept-encoding`, `content-type` do original.
- RF-11: asset inexistente, `POST` e caminho não canônico com `Range` → 404/405 com `Allow` ou `undefined` em fallthrough, sem `accept-ranges`/`content-range`.
- RF-12: `headers: { "content-length": "999" }` com `Range` válido → `content-length` do intervalo; sem `Range`, 999 (como `static.test.ts:600-617`).
- Corpos: `getContents` devolvendo `string`, `Blob`, `Uint8Array`/`ArrayBuffer` e `ReadableStream` produzem o mesmo corpo fatiado; `getContents` sem conteúdo com `Range` → 200 vazio como hoje.

**Unitários (`test/unit/range.test.ts`):** tabela de `parseRange` (incluindo `Bytes=`, espaços nas pontas, números enormes, `-`, `bytes=0-0` com `size=1`); `ifRangeAllows` (ETag forte/fraco/minúsculo, datas inválidas); `sliceBody` para cada tipo, incluindo stream com chunks que cruzam `start` e `end` e `cancel()` da origem após o último byte.

**Regressão e RF-13:** `pnpm vitest run test/static.test.ts test/unit/range.test.ts`; `test/unit/package.test.ts` (snapshot de exports) deve passar sem edição; depois `pnpm lint`, `pnpm typecheck` e `pnpm test`. Seguindo o fluxo de bug do AGENTS.md, os testes de integração são escritos primeiro e confirmados falhando antes da implementação.

## 6. Riscos

- **R-01 — `size` incoerente com o corpo real.** `Content-Length`/`Content-Range` ficam errados e o cliente pode truncar. Mitigação: premissa documentada no comentário do módulo; `size` ausente/0 desativa (D-08); stream encerra no fim real.
- **R-02 — Memória em corpos grandes.** `string` e o fallback de `FormData` carregam em memória. Mitigação: `Blob.slice` e stream contado cobrem o caso real de arquivos (D-06).
- **R-03 — Cancelamento do stream de origem** (ex.: `fs` stream aberto). Se não houver `cancel()`, o descritor vaza. Mitigação: o stream fatiado chama `reader.cancel()` ao concluir ou quando o consumidor cancela; coberto em teste unitário.
- **R-04 — `HEAD` vs `GET` divergentes.** Mitigação: um único cálculo de intervalo e dos cabeçalhos antes do ramo por método; teste compara os dois.
- **R-05 — Vazamento de cabeçalhos no 416** (ex.: `content-encoding` sem corpo). Mitigação: remoção explícita (D-07). `content-type` é mantido de propósito; é inofensivo com `Content-Length: 0`.
- **R-06 — Divergência issue × norma.** A issue cita a RFC 7233; seguimos a 9110 (comparação forte no `If-Range`, `bytes=5-2` inválido ignorado, 304 antes de `Range`). Decisões registradas nos nomes dos testes.
- **R-07 — Cache intermediário.** Respostas 206 só saem com `Range` explícito e com validadores presentes; sem `etag`/`last-modified`, um `If-Range` com ETag nunca habilita o intervalo (D-05).
- **R-08 — Escopo da ordem de condicionais.** `If-Match`/`If-Unmodified-Since` não são tratados hoje por `serveStatic` e continuam fora; a ordem entre 304 e `Range` está garantida (D-02).
- **R-09 — Versões de runtime.** `ReadableStream`/`Blob.slice` com `HTTPResponse` precisam funcionar em web e node (srvx `FastResponse`); a matriz de testes cobre os dois alvos.
- **R-10 — Documentação gerada.** `docs/2.utils/2.response.md:37` extrai o JSDoc de `static.ts` via automd; se o comentário de `serveStatic` for ampliado, rodar `pnpm fmt` para regenerar.
