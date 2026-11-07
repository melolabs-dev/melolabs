# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

- Pedido: `sdd/pedido.md`
- PRD: `sdd/prd.md` (requisitos RF-01 a RF-15 e fora de escopo)
- Norma: RFC 9110, §13.1.5 (If-Range) e §14 (Range Requests)
- Código afetado: `src/utils/static.ts`, um módulo interno novo em `src/utils/internal/range.ts` e testes em `test/`

Esta especificação resolve as decisões que o PRD deixou em aberto (onde ficam os helpers e o tratamento de tipos de `BodyInit` fora da lista) e define assinaturas, a ordem exata das checagens dentro de `serveStatic` e a lista de testes. O engenheiro implementa sem tomar decisões de arquitetura novas; qualquer desvio deve ser registrado no PR.

---

## 1. Visão geral

`serveStatic` passa a aceitar um único intervalo de bytes (`Range: bytes=…`) em `GET` e `HEAD`:

- anuncia `accept-ranges: bytes` em toda resposta de asset;
- valida `Range` e `If-Range` depois da avaliação de cache (`304`), como manda a RFC 9110;
- responde `206` com `content-range` e `content-length` da faixa, ou `416` quando a faixa não é satisfazível;
- ignora `Range` (responde `200` completo) quando ele é malformado, de outra unidade, multi-intervalo, com `If-Range` que não confere, com tamanho desconhecido ou com um tipo de corpo que não sabemos fatiar.

A API pública não muda. `getMeta` e `getContents` continuam recebendo só `id`. O fatiamento acontece depois que `getContents` devolve o corpo.

---

## 2. Estado atual (conferido no código)

| Ponto | Onde | Comportamento hoje |
| --- | --- | --- |
| Opções e tipos públicos | `src/utils/static.ts:9-15` (`StaticAssetMeta`), `:17-66` (`ServeStaticOptions`), `:25` (`getMeta`), `:33` (`getContents`) | Não mudam. |
| Assinatura de `serveStatic` | `src/utils/static.ts:101-104` | Retorna `Promise<HTTPResponse \| undefined>`. Não mudará. |
| Headers de `options.headers` | `src/utils/static.ts:105-114` | Aplicados em `event.res.headers` antes de tudo. É aqui que `accept-ranges` do app já existe. |
| Método | `src/utils/static.ts:116-122` | Só `GET`/`HEAD`; senão `405` com `allow: GET, HEAD` (ou `fallthrough`). |
| Caminho canônico | `src/utils/static.ts:142-147` | Caminho não canônico → 404 ou `fallthrough`. |
| Busca de meta | `src/utils/static.ts:198-215` | Procura o `id` com encoding e index; sem meta → 404 ou `fallthrough`. |
| `vary` | `src/utils/static.ts:220-225` | Acrescenta `accept-encoding` quando há encodings. |
| `last-modified` (`mtimeDate`, truncado em segundos) | `src/utils/static.ts:227-237` | Já calculado antes do cache. Será reutilizado por `If-Range`. |
| `etag` | `src/utils/static.ts:239-241` | Definido só se o `event.res` ainda não tem `etag`. |
| Cache (304) | `src/utils/static.ts:243-248` | `isCacheMatch` antes de qualquer outra coisa. |
| `content-type`, `content-encoding` | `src/utils/static.ts:250-266` | Definidos só se ausentes. |
| `content-length` | `src/utils/static.ts:268-270` | Definido de `meta.size` só se `size > 0` e se o app não definiu o header. |
| HEAD | `src/utils/static.ts:272-274` | `200` sem corpo. |
| GET | `src/utils/static.ts:276-277` | `getContents(id)` e `200` com `contents \|\| null`. |
| Comparação de ETag | `src/utils/internal/cache.ts:11` (`matchETag`, fraca), `:29` (`isCacheMatch`) | Comparação fraca, usada pelo 304. `If-Range` precisa de comparação **forte**, então não reaproveitamos `matchETag`. |
| `HTTPResponse` | `src/response.ts:96-124` | `status` e `statusText` vêm do init; `headers` é um `Headers` próprio. |
| Mesclagem de headers na resposta final | `src/response.ts:181-200` | `event.res.headers` é mesclado com os headers do `HTTPResponse`; o `status` do `HTTPResponse` prevalece sobre `event.res.status`. |
| Export | `src/index.ts:193` | `export { type ServeStaticOptions, type StaticAssetMeta, serveStatic } from "./utils/static.ts"`. Não muda. |
| Bypass de Range no cache de regras | `src/rules/cache.ts:143-148` | Requisições com `range` já não passam pelo cache de regras. |
| Helper de teste | `test/_setup.ts:11` (`describeMatrix`) | Roda cada teste em `web` e `node`. |
| Testes existentes de static | `test/static.test.ts:5` (bloco principal), `:396` (fallthrough), `:525` (MIME), `:626` (URL malformada) | Nenhum envia `Range` nem verifica `accept-ranges`. |

Tamanho: `src/utils/static.ts` tem 352 linhas. `AGENTS.md` pede menos de 200 linhas por arquivo.

---

## 3. Decisões de arquitetura

### D-01 — Onde ficam os helpers de Range

**Escolha:** criar `src/utils/internal/range.ts` com os helpers de parsing, `If-Range`, cálculo de faixa e fatiamento de `BodyInit`. `src/utils/static.ts` importa só o que precisa. Nenhum dos helpers entra em `src/index.ts`.

**Alternativas:**
- (a) Tudo dentro de `src/utils/static.ts`. Fiel à issue ("manter helpers privados no módulo `serveStatic`"), mas o arquivo passaria de 500 linhas, longe da meta de 200 do `AGENTS.md`.
- (b) Arquivo `src/utils/range.ts` fora de `internal/`. Vira candidato a API, contra a restrição de não ter exportações novas.

**Justificativa:** `AGENTS.md` manda helpers internos em `utils/internal/` e o `index.ts` não os reexporta. Assim a superfície pública não muda, e o arquivo de `serveStatic` fica menor. **Desvio consciente da letra da issue** ("dentro do módulo"): a intenção da issue, que é não expandir a API, é preservada. O PR deve citar esta decisão, como pede o PRD (seção 4, "Tamanho do arquivo").

### D-02 — Gramática do `Range` aceito

**Escolha:**
- Regex única, sem `split`: `/^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i`, aplicada ao valor de `range` já trimado pelo `Headers`.
- A unidade é comparada sem diferenciar maiúsculas (a RFC 9110, §14.1, trata nomes de unidade como case-insensitive; confirmar o trecho antes de fechar o PR).
- Os dois campos não podem estar vazios ao mesmo tempo (`bytes=-` é malformado).
- Intervalo com `início > fim` (`bytes=5-3`) é malformado.
- Qualquer coisa além do regex (vírgula, outra unidade, lixo) é malformada.
- Malformado é sempre **ignorado** (`200` completo), nunca `400`, conforme RF-03 e a RFC 9110 §14.2.

**Alternativas:**
- (a) Unidade exatamente `bytes`. Mais simples, mas contraria a RFC.
- (b) Aceitar multi-intervalo e responder `multipart/byteranges`. Fora de escopo (PRD, seção 3).

**Justificativa:** o regex cobre as três formas de RF-02 e os casos de RF-03 com uma só linha. O único comportamento não coberto pelo PRD é a caixa da unidade; escolhemos a RFC.

### D-03 — Resultado do cálculo de faixa e ordem das checagens

**Escolha:** um único helper `resolveByteRange` devolve:
- `undefined` → `Range` é ignorado (o caminho de `200` de hoje);
- `{ unsatisfiable: true, size }` → `416`;
- `{ start, end, size }` → `206` (intervalo inclusivo, já limitado ao arquivo).

A ordem em `serveStatic` é: `accept-ranges` → cache (`304`) → `content-type`/`content-encoding`/`content-length` → cálculo de faixa → `416` ou `206` ou `200`. `304` sempre vem antes de `Range` (RF-08).

**Alternativas:**
- (a) Calcular a faixa antes do cache. Viola RF-08 e a ordem da RFC 9110 §13.2.2 (condicionais de cache antes de `Range`).
- (b) Três helpers separados (`parse`, `check`, `resolve`). Mais código e mais pontos de erro para o mesmo fluxo.

**Justificativa:** uma função com três saídas bem definidas é o menor contrato que cobre RF-02, RF-04 a RF-07 e RF-11.

### D-04 — `If-Range`

**Escolha:**
- Sem `If-Range`: `Range` vale.
- Valor começando com `"` (ETag): vale só se for **idêntico** a `meta.etag` e `meta.etag` não começar com `W/`. Comparação forte: sem `W/` de nenhum dos lados (RFC 9110 §13.1.5). Se `meta.etag` estiver ausente, não vale.
- Qualquer outro valor é tratado como data HTTP: vale só se `new Date(valor).getTime()` for igual a `mtimeDate.getTime()`. Sem `mtimeDate`, não vale.
- `W/"…"` cai no ramo de data e falha, porque `new Date` não o interpreta: fica ignorado, como RF-07 pede.

**Alternativas:**
- (a) Reaproveitar `matchETag` (`src/utils/internal/cache.ts:11`). Não serve: a comparação é fraca e ignora `W/`.
- (b) Aceitar `W/` do lado da resposta. Contraria RF-07.

**Justificativa:** a regra é curta e segue a RFC 9110 §13.1.5. `mtimeDate` já está truncado em segundos (`src/utils/static.ts:232`), o que casa com a precisão de data HTTP.

### D-05 — Tamanho desconhecido e `size` inválido

**Escolha:** `resolveByteRange` devolve `undefined` se `size` não for número finito ou for negativo (RF-11). O `accept-ranges` continua sendo anunciado, como manda a issue (PRD, seção 4, riscos). `Accept-Ranges` é definido no mesmo ponto dos headers de `etag`, antes do cache, então ele também aparece em `304`. É uma consequência aceita: a RFC 9110 permite o header em qualquer resposta.

**Justificativa:** o PRD pede anunciar sempre. Definir antes do cache segue o padrão já usado por `etag` e `last-modified` (`src/utils/static.ts:234-241`).

### D-06 — Sobrescrita de `content-length` e `content-range`

**Escolha:**
- `200` continua com a regra de hoje: `content-length` só é definido se o app não definiu (`src/utils/static.ts:268`).
- `206` e `416` **sobrescrevem** `content-length` (e definem `content-range`) com `event.res.headers.set`. O PRD exige isso (seção 4, "Conflito com `headers` do usuário").

**Justificativa:** um `content-length: 999` vindo de `options.headers` faria o `206` estar errado. O teste existente `does not overwrite a content-length already set on the response` (`test/static.test.ts:600-617`) não envia `Range`, então continua válido.

### D-07 — Fatiamento por tipo de `BodyInit`

**Escolha:** `sliceBody(body, range)` é síncrono e trata estes tipos:

| Tipo de `getContents` | Fatia |
| --- | --- |
| `string` | `new TextEncoder().encode(body).subarray(start, end + 1)` (bytes UTF-8, não caracteres) |
| `ArrayBuffer` | `body.slice(start, end + 1)` |
| `ArrayBuffer.isView(body)` (`Uint8Array`, `DataView` etc.) | `new Uint8Array(body.buffer, body.byteOffset + start, end - start + 1)` |
| `Blob` (inclui `File`) | `body.slice(start, end + 1)` |
| `ReadableStream` | `sliceStream(body, start, end)` (D-08) |
| `null`, `undefined`, qualquer outro (`FormData`, `URLSearchParams`) | `undefined` → `serveStatic` responde `200` completo |

**Alternativas:**
- (a) Converter tudo para `Uint8Array` antes de fatiar. Mais simples, mas copia o arquivo inteiro na memória, o que o PRD quer evitar.
- (b) Lançar erro para tipos não suportados. Quebra um caso que hoje funciona (`200`).

**Justificativa:** `string` é codificado para bytes porque `size` é em bytes; fatiar caracteres daria `Content-Length` errado para texto não ASCII. Os tipos não listados ficam com o `200` completo, que é o comportamento de hoje.

### D-08 — Fatiamento de `ReadableStream`

**Escolha:** `sliceStream` cria um `ReadableStream` novo que:
1. lê do reader de origem, contando o offset absoluto;
2. descarta chunks que terminam antes de `start`;
3. recorta o primeiro e o último chunk com `subarray`;
4. ao alcançar `end`, fecha o stream novo e cancela a origem (`reader.cancel()`), para não ler o resto do arquivo;
5. repassa `cancel(reason)` à origem.

Os chunks são tratados como `Uint8Array`, o formato que `BodyInit` produz para bytes.

**Alternativas:**
- (a) `TransformStream` com estado. Mesmo resultado, mais código.
- (b) Ler tudo em memória. Contra o PRD.

**Justificativa:** o custo é o mesmo que o PRD já aceitou (ler desde o início até o fim da faixa). O cancelamento da origem é o que evita ler o resto.

### D-09 — Respostas sem corpo e fallback

**Escolha:**
- `HEAD` com faixa válida: `206` com headers e `null` como corpo. Não chama `getContents`.
- `GET` com faixa válida: chama `getContents(id)` uma vez. Se `sliceBody` devolver `undefined` (tipo não suportado ou `contents` vazio), responde `200` com `contents || null`, sem `content-range`.
- `416` não chama `getContents` nem `getMeta` de novo.

**Justificativa:** `content-range` só é definido depois de se saber que o corpo será fatiado. Assim, nenhum header de `206` vaza para um `200`.

### D-10 — Escopo de headers na resposta `206`

**Escolha:** `206` herda `content-type`, `content-encoding`, `etag`, `last-modified`, `vary` e `cache-control` do fluxo atual, sem alteração. `content-encoding` vale para a variante escolhida, como RF-10 pede. `content-range` e `content-length` são os únicos headers novos.

**Justificativa:** o PRD pede que `Content-Encoding` continue igual ao de hoje (RF-10) e não lista mais nada.

### D-11 — Interação com caches

**Escolha:** nenhuma alteração em `src/rules/cache.ts`. A proteção que já existe (`src/rules/cache.ts:143-148`) impede que o cache de regras guarde ou sirva respostas para requisições com `range`. Usuários que envolvem `serveStatic` com `defineCachedHandler` próprio **não** têm essa proteção. Documentar no PR (ver riscos).

**Justificativa:** mudar o cache está fora de escopo (PRD, seção 3, "Cache de respostas parciais").

---

## 4. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/internal/range.ts` | **Novo.** Helpers internos (contrato na seção 5). |
| `src/utils/static.ts` | Importar helpers; definir `accept-ranges` antes do cache (`:243` e antes); inserir o bloco de faixa entre `:270` e `:272`; trocar o retorno final de GET (`:276-277`); adicionar `setPartialHeaders` privada no fim do arquivo, depois de `idSearchPaths` (`:340-351`), na seção `// --- Internal Utils ---` (`:280`). |
| `test/static-range.test.ts` | **Novo.** Testes `describeMatrix` (seção 6). |
| `test/static.test.ts` | Nenhuma alteração prevista. Só mudar se um teste existente quebrar. Se isso acontecer, ajustar apenas a asserção afetada, sem remover o que ela verifica (PRD, RF-13). |
| `src/index.ts` | **Não muda** (`:193`). |

Não há alteração em `package.json`, `build.config` nem em documentação.

---

## 5. Contratos e assinaturas

### 5.1 `src/utils/internal/range.ts` (novo)

```ts
/** Inclusive byte range within the representation, already clamped to its size. */
export interface ByteRange {
  start: number;
  end: number;
  /** Total size of the representation (the `size` from `getMeta`). */
  size: number;
}

/** A satisfiable range or a range that cannot be met (`416`). */
export type ByteRangeResult = ByteRange | { unsatisfiable: true; size: number };

/**
 * Parsed `Range` header. A suffix form (`bytes=-n`) has no start.
 */
export type RangeSpec =
  | { type: "suffix"; length: number }
  | { type: "range"; start: number; end?: number };

/**
 * Resolve the `Range` request header against the asset's validators.
 *
 * Returns `undefined` when the range must be ignored: no `Range` header, malformed or
 * multi-range syntax, an unknown unit, a non-finite `size`, or an `If-Range` that does not match.
 */
export function resolveByteRange(
  headers: Headers,
  validators: { size: number | undefined; etag?: string; lastModified?: Date },
): ByteRangeResult | undefined;

/** Parse a `Range` header value. Returns `undefined` for anything that is not one `bytes` range. */
export function parseRange(value: string): RangeSpec | undefined;

/**
 * Slice a `BodyInit` returned by `getContents` to the inclusive range.
 * Returns `undefined` when the body type cannot be sliced, so the caller responds `200`.
 */
export function sliceBody(
  body: BodyInit | null | undefined,
  range: Pick<ByteRange, "start" | "end">,
): BodyInit | undefined;

/** Fresh stream that yields only bytes `start..end` (inclusive) of `source`. */
export function sliceStream(
  source: ReadableStream,
  start: number,
  end: number,
): ReadableStream<Uint8Array>;

function ifRangeMatches(
  value: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean; // private, not exported
```

Regras obrigatórias:
- `isolatedDeclarations` está ativo (`AGENTS.md`, seção TypeScript): toda função exportada precisa de tipo de retorno explícito. As assinaturas acima já trazem.
- Os helpers não usam `any`. `ReadableStream` sem parâmetro de tipo não é aceito pelo `tsc` com as libs do projeto; usar `ReadableStream<unknown>` ou o tipo que o `BodyInit` estreitar, se o typecheck reclamar, e registrar no PR.
- Nenhum `export` desse arquivo entra em `src/index.ts`.

### 5.2 Algoritmo de `resolveByteRange`

1. `raw = headers.get("range")`. Se `null`, retorna `undefined`.
2. Se `typeof size !== "number" || !Number.isFinite(size) || size < 0`, retorna `undefined` (RF-11).
3. Se `!ifRangeMatches(headers.get("if-range"), validators)`, retorna `undefined` (RF-07).
4. `spec = parseRange(raw)`. Se `undefined`, retorna `undefined` (RF-03).
5. Se `spec.type === "suffix"`:
   - se `spec.length === 0` ou `size === 0` → `{ unsatisfiable: true, size }` (RF-06);
   - senão `start = Math.max(size - spec.length, 0)`, `end = size - 1`.
6. Se `spec.type === "range"`:
   - se `spec.start >= size` → `{ unsatisfiable: true, size }` (RF-06, inclui `size === 0`);
   - senão `end = spec.end === undefined || spec.end >= size ? size - 1 : spec.end` (RF-05).
7. Retorna `{ start, end, size }`.

### 5.3 `parseRange`

```ts
const RANGE_RE = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i;

export function parseRange(value: string): RangeSpec | undefined {
  const match = RANGE_RE.exec(value);
  if (!match) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;     // `bytes=-`
  if (first === "") return { type: "suffix", length: Number(last) };
  const start = Number(first);
  if (last === "") return { type: "range", start };
  const end = Number(last);
  return end < start ? undefined : { type: "range", start, end }; // `bytes=5-3`
}
```

Observação: os `\s*` ao redor de `=` e `-` aceitam `bytes=0 - 9` como OWS tolerado (RF-02). O `Headers` já remove espaços nas bordas do valor inteiro.

### 5.4 `ifRangeMatches`

```ts
function ifRangeMatches(value, { etag, lastModified }): boolean {
  if (value === null) return true;
  if (value.startsWith('"')) {
    return !!etag && !etag.startsWith("W/") && value === etag;
  }
  return !!lastModified && new Date(value).getTime() === lastModified.getTime();
}
```

### 5.5 Mudanças em `serveStatic` (`src/utils/static.ts`)

Ordem das inserções:

**(a)** Depois do bloco de `etag` (`:239-241`) e antes do cache (`:243`), inserir:

```ts
  if (!event.res.headers.get("accept-ranges")) {
    event.res.headers.set("accept-ranges", "bytes");
  }
```

**(b)** Depois de `content-length` (`:268-270`) e antes de `if (event.req.method === "HEAD")` (`:272`), substituir o trecho por:

```ts
  const range = resolveByteRange(event.req.headers, {
    size: meta.size,
    etag: meta.etag,
    lastModified: mtimeDate,
  });

  if (range && "unsatisfiable" in range) {
    event.res.headers.set("content-range", `bytes */${range.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }

  if (event.req.method === "HEAD") {
    if (!range) {
      return new HTTPResponse(null, { status: 200 });
    }
    setPartialHeaders(event, range);
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }

  const contents = await options.getContents(id);
  if (range) {
    const body = sliceBody(contents, range);
    if (body !== undefined) {
      setPartialHeaders(event, range);
      return new HTTPResponse(body, { status: 206, statusText: "Partial Content" });
    }
  }
  return new HTTPResponse(contents || null, { status: 200 });
```

Observação de tipo: `range` precisa estreitar para `ByteRange` depois do `return` de 416. Se o TypeScript não estreitar com `"unsatisfiable" in range`, usar uma função de tipo (`isUnsatisfiable`) exportada pelo mesmo módulo interno. Não usar `as`.

**(c)** Helper privado no fim de `src/utils/static.ts`, depois de `idSearchPaths`:

```ts
function setPartialHeaders(event: H3Event, range: ByteRange): void {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${range.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
}
```

`ByteRange` é importado de `./internal/range.ts` com `import type`.

**(d)** Imports (`src/utils/static.ts:1-7`): acrescentar

```ts
import { resolveByteRange, sliceBody, type ByteRange } from "./internal/range.ts";
```

Nenhuma outra linha de `serveStatic` muda.

---

## 6. Estratégia de testes

Testes novos em `test/static-range.test.ts`, usando `describeMatrix` (`test/_setup.ts:11`) para rodar em `web` e `node`. Cada teste monta uma app com `serveStatic` e um `getMeta`/`getContents` controlado, como em `test/static.test.ts:5-40`.

**Regra do AGENTS.md (correção de bug):** os testes de regressão são escritos antes do código. Devem falhar antes da mudança (`200` no lugar de `206`, ou ausência de `accept-ranges`). Registrar a saída desse teste no PR.

Casos obrigatórios (mapeados ao PRD):

| Grupo | Casos | RF |
| --- | --- | --- |
| Anúncio | `accept-ranges: bytes` em `200`, `206`, `416`, `HEAD`; app define `accept-ranges: none` e o valor do app vence | RF-01 |
| Formas válidas | `bytes=10-19`, `bytes=90-`, `bytes=-10` (100 bytes) → `206`, corpo correto | RF-02, RF-04 |
| Tolerância | `bytes= 10 - 19 ` → `206` | RF-02 |
| Malformados | `bytes=abc`, `bytes=`, `bytes=-`, `bytes=5-3`, `bytes=0-1,3-4`, `items=0-1` → `200` completo, sem `content-range` | RF-03 |
| Limites | `bytes=90-999` → `bytes 90-99/100`; `bytes=-500` → `bytes 0-99/100` | RF-05 |
| Insatisfazível | `bytes=100-`, `bytes=-0` → `416`, `content-range: bytes */100`, `content-length: 0`, corpo vazio; asset de 0 bytes com `bytes=0-` → `416`, `bytes */0` | RF-06 |
| If-Range | `"v1"` confere → `206`; `"v0"` → `200`; `W/"v1"` → `200`; data igual ao `last-modified` → `206`; data diferente → `200`; `If-Range` sem `Range` → `200` | RF-07 |
| Precedência | `If-None-Match` igual + `Range` → `304` sem corpo | RF-08 |
| HEAD | `HEAD` + `Range` → `206`, headers corretos, corpo vazio; `HEAD` + `Range` insatisfazível → `416` | RF-09 |
| Encoding | `app.js` 100 bytes, `app.js.gz` 40 bytes, `Accept-Encoding: gzip`, `bytes=0-9` → `206`, `content-encoding: gzip`, `bytes 0-9/40`, corpo = 10 primeiros de `.gz` | RF-10 |
| Tamanho desconhecido | `getMeta` sem `size` → `200` completo sem `content-range`; `size` string → `200` | RF-11 |
| Tipos de corpo | mesmo conteúdo como `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` (com chunks de tamanhos irregulares, faixa cruzando fronteira de chunk); `bytes=20-29` → corpo = bytes 20-29 | RF-12 |
| Stream cancelado | `ReadableStream` com `cancel` espiado: após a faixa, a origem é cancelada | D-08 |
| Tipo não suportado | `getContents` devolve `FormData` com `Range` → `200` completo | D-07 |
| Preservação | `POST` com `Range` → `405` com `allow: GET, HEAD`; `fallthrough` com `POST` cai no próximo handler; asset inexistente com `Range` → `404`; `fallthrough` com asset inexistente → cai no próximo handler | RF-13 |
| `content-length` do app | `options.headers: { "content-length": "999" }` + `Range` → `206` com `content-length` da faixa | D-06 |

Testes existentes: rodar `test/static.test.ts` sem alterações antes e depois. Nenhum deles envia `Range`, então o esperado é que passem sem mudança.

Verificações de API e build:
- `git diff -- src/index.ts` deve estar vazio (RF-14).
- `pnpm build` gera `dist/_entries/*.d.mts`; comparar a lista de exportações antes e depois (não deve haver diferença).

Comandos de verificação, na ordem:

```bash
pnpm vitest run test/static-range.test.ts
pnpm vitest run test/static.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Cobertura: `src/utils/internal/range.ts` deve ficar com cobertura de linhas próxima de 100% pelos testes HTTP. Ramos de `sliceStream` (chunk antes da faixa, chunk que cruza `end`, cancelamento) precisam aparecer no relatório.

---

## 7. Riscos

1. **Custo de `ReadableStream` (PRD, seção 4).** Para arquivos grandes, pular bytes lê o arquivo desde o início. Aceito pelo PRD para a v1. O cancelamento (D-08) evita ler o resto.
2. **Tamanho errado de `getMeta` (premissa do PRD).** `Content-Range` e `Content-Length` confiam em `meta.size`. Se o backend devolver mais ou menos bytes, a resposta fica inconsistente. Não há validação extra por custo.
3. **`string` e codificação.** Um backend que devolva `string` com caracteres não ASCII tem `size` em bytes UTF-8 esperados. Se `size` foi calculado em caracteres, a faixa sai errada. Documentar no PR; o teste de tipos usa ASCII.
4. **Cache próprio do usuário (D-11).** `src/rules/cache.ts:143-148` protege o cache de regras, mas um `defineCachedHandler` escrito pelo usuário em volta de `serveStatic` pode guardar um `206` e servi-lo a quem pediu o arquivo inteiro. Mitigação na v1: documentar no PR; não há como detectar isso dentro de `serveStatic`.
5. **`If-Range` com data lenient.** `new Date` aceita formatos variados (por exemplo `"1"`). Na prática, só casa se for exatamente o `last-modified`, então o risco é baixo, mas o teste de data deve incluir uma entrada inválida.
6. **`accept-ranges` em `304`.** Pelo D-05, o header também aparece em `304`. É válido pela RFC, mas diferente do PRD, que cita `200`, `206`, `416` e `HEAD`. Se o time preferir só nesses casos, mover a inserção para depois de `isCacheMatch` (`:243-248`). Decidir antes do PR.
7. **Tamanho de `src/utils/static.ts`.** Continua acima de 200 linhas (agora ~380). A meta do `AGENTS.md` não é atingida por completo nesta mudança; o novo `range.ts` reduz o crescimento. Um PR futuro pode dividir `serveStatic` (`parseAcceptEncoding`, `idSearchPaths`), fora de escopo.
8. **Tipos de `ReadableStream` no Node.** A libs do projeto inclui `DOM` e `WebWorker`, o que pode dar conflito de tipo com `ReadableStream<Uint8Array>` em `sliceStream`. Se acontecer, resolver com o tipo mais estreito que o `tsc` aceitar, sem `any`.
9. **Chunks que não são `Uint8Array`.** Um `ReadableStream` cujos chunks sejam `string` quebra `subarray`. `BodyInit` de bytes não produz isso, mas a regra precisa ficar explícita no JSDoc de `sliceStream`.
10. **`Content-Length` no Node.** Com `206` e corpo em stream, o adaptador Node precisa aceitar o `content-length` definido manualmente. Coberto pelos testes na matriz `node`.
