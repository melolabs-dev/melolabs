# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-15). Esta especificação escolhe a implementação e aponta os pontos em que o PRD precisa de decisão ou ajuste (seção 8).

Estado de partida: `pnpm vitest run test/static.test.ts` passa com 76 testes neste checkout, antes de qualquer alteração.

## 1. Estado atual relevante

- `src/utils/static.ts:101-104`: assinatura de `serveStatic(event, options)`. Não há nenhum tratamento de `Range`.
- `src/utils/static.ts:116-122`: só `GET` e `HEAD` passam; os demais recebem `405` com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`).
- `src/utils/static.ts:227-237`: `mtimeDate` já é truncado em segundos. A comparação de `If-Range` por data reaproveita esse valor.
- `src/utils/static.ts:243-248`: a checagem de pré-condição (`304`) acontece antes de qualquer cabeçalho de corpo. O `Range` deve ficar depois dela (RF-08).
- `src/utils/static.ts:268-270`: `content-length` é definido com `meta.size` somente se `meta.size > 0` e se ainda não existe em `event.res`.
- `src/utils/static.ts:272-274`: `HEAD` retorna sem chamar `getContents`.
- `src/utils/static.ts:276-277`: `GET` chama `getContents(id)` e devolve `new HTTPResponse(contents || null, { status: 200 })`.
- `src/response.ts:96-124`: `HTTPResponse` aceita `status` e `headers` no construtor e expõe `status` como `undefined` quando não definido.
- `src/response.ts:189-204`: o `HTTPResponse` é processado por `prepareResponseBody`, e os cabeçalhos de `event.res` (`preparedHeaders`) são mesclados **por cima** dos cabeçalhos do `HTTPResponse` (`mergeHeaders(res.headers, preparedHeaders)`, com `mergeHeaders` em `src/response.ts:243-252`, onde `overrides` sobrescreve `base`). Consequência: um `content-length` já gravado em `event.res` vence o `content-length` passado no `init` do `HTTPResponse`. Esse fato dirige a decisão D-03.
- `src/utils/internal/cache.ts:11-17` (`matchETag`) e `:29-49` (`isCacheMatch`) implementam comparação **fraca** para `If-None-Match`. Não servem para `If-Range`, que exige comparação forte (D-06).
- `src/utils/internal/encoding.ts:7`: `textEncoder` já exportado para uso interno.
- `src/index.ts:193`: única linha pública de `static.ts`. Não será alterada.
- `test/_setup.ts:11`: `describeMatrix` gera os alvos `web` e `node`.
- `test/static.test.ts:5-31`: fixture principal, com `size` igual ao comprimento da string de conteúdo.
- `test/static.test.ts:528-531` e `:542-543`: fixtures com `size: 10` e conteúdo maior que 10 bytes. Não há `Range` neles, mas mostram que divergência entre `size` e conteúdo já existe nos testes.
- `test/static.test.ts:600-618`: teste de `content-length` explícito em `event.res` (`999` vence `meta.size`). Precisa continuar passando (sem `Range`, nada muda).
- `test/unit/encoding.test.ts`: já importa módulos de `src/utils/internal/` diretamente. Esse é o padrão para testes unitários do parser.

## 2. Decisões de arquitetura

### D-01 — Ponto de integração: dentro de `serveStatic`, sem mudar `getMeta` nem `getContents`

**Escolha:** `serveStatic` decide o `Range`, calcula o intervalo com `meta.size` e recorta o corpo que `getContents` devolve. A assinatura de `getContents` continua `(id) => BodyInit | null | undefined`.

**Alternativas:**
- Passar o intervalo para `getContents(id, range)` e deixar o backend recortar. Permitiria economizar I/O em arquivos grandes, mas muda a assinatura pública de `ServeStaticOptions` e entra no fora de escopo do PRD (`prd.md`, "Fora de escopo", segundo item).
- Adicionar opção `ServeStaticOptions.range`. Viola RF-14.

**Justificativa:** é a única opção que cumpre RF-14 e RF-09 sem mudar a API. O custo (leitura e descarte de bytes em `ReadableStream`) é o risco já registrado no PRD, mitigado em D-07.

### D-02 — Módulo privado `src/utils/internal/range.ts`

**Escolha:** parser de `Range`, avaliação de `If-Range` e recorte de corpo ficam em `src/utils/internal/range.ts`, sem reexportação.

**Alternativas:**
- Colocar os helpers no fim de `src/utils/static.ts`. É o que AGENTS.md permite ("Internal helpers go at the end of files or in `utils/internal/`"), mas `static.ts` já tem 351 linhas, acima da meta de 200 do projeto. Somaria ~120 linhas ao arquivo.

**Justificativa:** `utils/internal/` não entra em `src/index.ts` nem em `package.json#exports`, então atende RF-14. Também evita aumentar um arquivo que já passa da meta. `static.ts` fica com a orquestração: ordem de cabeçalhos, status e chamada a `getContents`.

### D-03 — Cabeçalhos de tamanho e intervalo são gravados em `event.res.headers`; o status vai no `init` do `HTTPResponse`

**Escolha:**
- `content-length`, `content-range` e `accept-ranges` são definidos com `event.res.headers.set(...)`, para valer depois da mescla de `src/response.ts:202-204`.
- O status `206` e `416` vai no `init` do `HTTPResponse`, como o `304` já faz em `src/utils/static.ts:244-247`.
- Para `206`, `content-length` **sobrescreve** um `content-length` explícito do usuário (diferente de `src/utils/static.ts:268`, que respeita). Motivo: um `206` com `Content-Length` de outro tamanho é resposta inválida. Registrar isso na documentação do JSDoc de `serveStatic`.

**Alternativas:**
- Passar `headers` no `init` do `HTTPResponse`. Descartado: `src/response.ts:202-204` faz `event.res` vencer, e `content-length` de `static.ts:268-270` já estaria ali com o tamanho total.
- Respeitar `content-length` explícito também em `206`. Descartado: produz resposta inconsistente.

**Justificativa:** sem essa escolha, o `206` sairia com `Content-Length` do arquivo inteiro e corpo parcial. Esse é o defeito mais provável da implementação, e precisa de teste específico (seção 6).

### D-04 — Semântica do `Range`: RFC 9110 §14.1 e §14.2 com o recorte da issue

Regras de `parseRange(header, size)`, com `size > 0`:

1. Header aceito somente no formato `bytes=<first>-<last>` ou `bytes=-<suffix>` (unidade sem diferenciação de caixa, sem espaços dentro da especificação, sem vírgula). Qualquer outra coisa → `undefined` (responder `200` completo). Cobre unidade diferente, malformado e multi-range (RF-06).
2. Ambos vazios (`bytes=-`) → malformado → `undefined`.
3. `first > last` → malformado → `undefined`.
4. Número que não é inteiro seguro (`Number.isSafeInteger`) → malformado → `undefined`.
5. Sufixo `-0` → não satisfazível (`unsatisfiable`), conforme RFC 9110 §14.1.1.
6. Sufixo `-N`: `start = max(0, size - N)`, `end = size - 1`.
7. `first >= size` → não satisfazível.
8. Aberto `first-`: `end = size - 1`. Fechado `first-last`: `end = min(last, size - 1)`.
9. Resultado `partial` com `start` e `end` inclusivos.

**Alternativas:** aceitar multi-range e responder `multipart/byteranges` (fora de escopo do PRD); responder `416` para qualquer header inválido (viola RFC, que permite ignorar `Range`).

**Justificativa:** o PRD exige que malformado e multi-range voltem `200`. O item 5 é a única decisão que o PRD não cobre; segue a RFC.

### D-05 — `size: 0` significa "tamanho desconhecido" (conflito PRD RF-05 × RF-12)

**Escolha:** `size` igual a `0`, `undefined` ou inválido significa desconhecido. `Range` é ignorado e `Accept-Ranges` não é anunciado. Isso segue a regra existente de `src/utils/static.ts:268` (`meta.size > 0`).

**Alternativas:**
- Tratar `size: 0` como tamanho conhecido e responder `416` com `Content-Range: bytes */0` para qualquer `Range` (o exemplo de RF-05). É o mais próximo da RFC para arquivo vazio, mas exige mudar a regra de `content-length` (`static.ts:268`), porque `size: 0` hoje é tratado como "sem tamanho" de propósito: backends que não sabem o tamanho costumam devolver `0`.

**Justificativa:** evita anunciar `Accept-Ranges` e responder `416` com base num `0` que pode significar "não sei". O custo é um `200` para `Range` em arquivo vazio, o que é permitido pela RFC. **Confirmar com o usuário** (seção 8, item 1). Se a decisão for a alternativa, o teste de `size: 0` muda e o `static.ts:268` também.

### D-06 — `If-Range` com comparação forte

**Escolha:** `matchIfRange(ifRange, { etag, lastModified })`:
- Se `ifRange` começa com `W/`: não bate.
- Se `ifRange` começa com `"`: bate somente se `etag` existe, não começa com `W/` e é igual a `ifRange`.
- Caso contrário, tenta `Date.parse(ifRange)`. Bate somente se for `NaN`-free e `getTime()` for igual ao de `lastModified` (já truncado em segundos).
- `If-Range` é ignorado quando não há `Range` (RF-07, `prd.md`).

**Alternativas:** reutilizar `matchETag` de `src/utils/internal/cache.ts:11-17`. Descartado: é comparação fraca, e RFC 9110 §13.1.5 exige forte para `If-Range`.

**Justificativa:** segue o PRD (RF-07). Não há "maior ou igual" para data em `If-Range`; é igualdade exata.

### D-07 — Recorte do corpo por tipo de `BodyInit`

| Tipo devolvido por `getContents` | Estratégia | Tamanho conhecido? |
| --- | --- | --- |
| `string` | `textEncoder.encode` (`internal/encoding.ts:7`) e `subarray` | sim, síncrono |
| `ArrayBuffer` | `slice(start, end + 1)` | sim, síncrono |
| `ArrayBufferView` | `new Uint8Array(view.buffer, view.byteOffset, view.byteLength).subarray(...)` | sim, síncrono |
| `Blob` | `blob.slice(start, end + 1)`, sem ler o conteúdo | sim, `blob.size` |
| `URLSearchParams` | `toString()` e depois como `string` | sim, síncrono |
| `ReadableStream` | lê e descarta até `start`, emite até `end`, cancela a fonte ao terminar | não até ler |
| `FormData` e demais | **não fatiável**: `sliceBody` devolve `undefined` e `serveStatic` responde `200` completo | — |

**Alternativas:** bufferizar todo `ReadableStream` (memória proporcional ao arquivo; rejeitado). Usar `TransformStream` em vez de `ReadableStream` manual (mesmo resultado, mais código; fica a critério da implementação).

**Justificativa:** `Blob.slice` evita o custo do PRD para o caso comum de arquivo em disco. Para stream, o custo é inevitável sem mudar a API (D-01). `FormData` não tem representação de bytes fatiável, então cai no fallback.

Em `ReadableStream`, os chunks devem ser `Uint8Array`. Chunk que não for `Uint8Array` faz o `controller.error(...)`, porque não há como contar bytes.

### D-08 — Divergência entre `size` e o corpo

- **Tipos síncronos** (`string`, `ArrayBuffer`, `ArrayBufferView`, `Blob`, `URLSearchParams`): se `byteLength` (ou `size`) do corpo for diferente de `meta.size`, `sliceBody` lança `HTTPError({ status: 500 })` antes de gravar qualquer cabeçalho de `206`. A resposta vira erro, e não um `Content-Range` falso.
- **`ReadableStream`**: se terminar antes de `end + 1` bytes, `controller.error(...)`. Em Node, isso encerra a conexão, como um `Content-Length` não cumprido.

**Alternativas:** confiar em `meta.size` sem checar. Descartado: em Node a conexão cai sem aviso, e o cliente recebe um arquivo truncado sem erro legível.

### D-09 — `getContents` sem corpo com `Range` válido

Quando `getContents` devolve `null` ou `undefined` e a resposta seria `206`, `serveStatic` lança `HTTPError({ status: 500 })`. Sem `Range`, mantém o comportamento atual (`contents || null`, `static.ts:277`).

**Justificativa:** `meta.size > 0` com corpo vazio é inconsistência de backend, o mesmo caso de D-08. Responder `200` vazio aqui seria pior, porque o cliente acharia que o arquivo é vazio.

### D-10 — `Accept-Ranges` e opt-out

- `accept-ranges: bytes` é gravado com `event.res.headers.set` quando `meta.size > 0`, mas só se `event.res.headers` ainda não tiver `accept-ranges`. Isso permite que o usuário passe `headers: { "accept-ranges": "none" }` em `ServeStaticOptions.headers` (`static.ts:105-114`) para desligar o recurso.
- Se `event.res.headers.get("accept-ranges")` existir e não for `bytes`, `serveStatic` ignora o `Range` e não responde `206`/`416`.

**Justificativa:** o PRD diz que `Accept-Ranges` é sempre `bytes` quando há `size`. Com a opção de opt-out, o recurso fica desligável sem API nova (RF-14).

### D-11 — Testes em arquivos novos

- `test/static-range.test.ts`: integração com `describeMatrix` cobrindo RF-01 a RF-12 nos alvos `web` e `node`.
- `test/unit/static-range.test.ts`: tabela de casos de `parseRange` e `matchIfRange`, importando de `src/utils/internal/range.ts` (padrão de `test/unit/encoding.test.ts`).
- `test/static.test.ts`: sem alteração prevista. Confirmar com a suíte completa. Se algum teste existente quebrar, ajustar só o que depende do novo comportamento (RF-15).

**Alternativas:** acrescentar em `test/static.test.ts` (678 linhas). Descartado para não misturar a suíte existente com a funcionalidade nova. O PRD aceita "arquivo equivalente".

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Importa de `./internal/range.ts`. Insere um bloco entre `static.ts:270` e `static.ts:272` que decide `Accept-Ranges`, `416`, `206` para `HEAD` e `206` para `GET`. Ajusta o JSDoc de `serveStatic` (`static.ts:68-100`) com um parágrafo sobre `Range`. Não muda `getMeta`, `getContents` nem `ServeStaticOptions`. |
| `src/utils/internal/range.ts` | **Novo.** `parseRange`, `matchIfRange`, `sliceBody` e helpers internos. Sem `export` para `src/index.ts`. |
| `test/static-range.test.ts` | **Novo.** Cobertura de RF-01 a RF-13 com `describeMatrix`. |
| `test/unit/static-range.test.ts` | **Novo.** Tabela de `parseRange` e `matchIfRange`. |
| `AGENTS.md` | Opcional. Adicionar `range.ts` na árvore de `src/utils/internal/` (`AGENTS.md:89-93`) para manter a documentação de arquitetura correta. |

Não alterar: `src/index.ts` (`:193`), `package.json`, `src/response.ts`, `src/utils/internal/cache.ts`.

## 4. Contratos e assinaturas

### 4.1 Público (sem mudança)

```ts
// src/utils/static.ts — inalterado
export interface StaticAssetMeta { type?; etag?; mtime?; size?; encoding? }
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType? }
export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

### 4.2 Privado: `src/utils/internal/range.ts`

Todas as funções exportadas precisam de tipo de retorno explícito, porque o projeto usa `isolatedDeclarations`.

```ts
import type { HTTPError } from "../../error.ts"; // só para tipagem, se necessário

/** Intervalo inclusivo em bytes. */
export interface ByteSpan {
  start: number;
  end: number;
}

/** Resultado de `parseRange`: `undefined` significa "ignorar o Range e responder 200". */
export type RangeRequest =
  | { type: "partial"; span: ByteSpan }
  | { type: "unsatisfiable" };

/**
 * Interpreta o cabeçalho `Range` para um recurso de `size` bytes (`size > 0`).
 * Retorna `undefined` para unidade diferente de `bytes`, malformado e multi-range (D-04).
 */
export function parseRange(header: string, size: number): RangeRequest | undefined;

/**
 * Avalia `If-Range` com comparação forte (D-06). Retorna `true` se o intervalo deve ser atendido.
 */
export function matchIfRange(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/**
 * Recorta `body` para o intervalo, respeitando D-07 e D-08.
 * Retorna `undefined` para tipos não fatiáveis (`FormData` e demais).
 * Lança `HTTPError` (500) quando o tamanho síncrono diverge de `size` (D-08).
 */
export function sliceBody(
  body: BodyInit,
  span: ByteSpan,
  size: number,
): Promise<BodyInit | undefined>;
```

### 4.3 Fluxo em `serveStatic` (depois de `static.ts:270`)

Pseudocódigo, para orientar a implementação. Não é o código final.

```text
if meta.size > 0 and event.res não tem accept-ranges:
    set accept-ranges = "bytes"

rangeHeader = event.req.headers.get("range")
if rangeHeader e meta.size > 0 e accept-ranges de event.res == "bytes":
    request = parseRange(rangeHeader, meta.size)
    ifRange = event.req.headers.get("if-range")
    if ifRange e not matchIfRange(ifRange, { etag: meta.etag, lastModified: mtimeDate }):
        request = undefined                         # If-Range falhou → 200 completo (RF-07)

    if request.type == "unsatisfiable":
        set content-range = "bytes */<size>"; set content-length = "0"
        return HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })

    if request.type == "partial":
        if HEAD:
            set content-range, content-length = span length
            return HTTPResponse(null, { status: 206, statusText: "Partial Content" })
        contents = await getContents(id)
        if contents == null: throw HTTPError(500)           # D-09
        body = await sliceBody(contents, span, meta.size)   # pode lançar 500 (D-08)
        if body is undefined: fall through to 200 (não fatiável, D-07)
        else:
            set content-range, content-length = span length
            return HTTPResponse(body, { status: 206, statusText: "Partial Content" })

# caminho atual, sem alteração:
if HEAD: return HTTPResponse(null, 200)
contents = await getContents(id)
return HTTPResponse(contents || null, 200)
```

Pontos de ordem obrigatórios:
- Todo esse bloco vem **depois** de `isCacheMatch` (`static.ts:243-248`) → RF-08.
- Os cabeçalhos `content-range` e `content-length` do `206` só são gravados **depois** de `sliceBody` ter sucesso (para não vazar cabeçalho de `206` quando cai no fallback de `200`).
- `Range` com `POST` nunca chega aqui: o `405`/`fallthrough` de `static.ts:116-122` já terminou antes.

## 5. Estratégia de testes

Seguir a ordem de AGENTS.md ("Bug Fix Workflow" serve como disciplina mesmo para feature): escrever os testes, vê-los falhar, implementar, vê-los passar.

### 5.1 `test/static-range.test.ts` (`describeMatrix`, `web` e `node`)

| Caso | RF | Asserção principal |
| --- | --- | --- |
| Sem `Range` | RF-01, RF-09 | `200`, `accept-ranges: bytes`, corpo completo, `content-length` igual ao antes |
| `bytes=2-5` em GET | RF-02 | `206`, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345` |
| `bytes=7-` | RF-03 | `206`, `bytes 7-9/10`, `content-length: 3` |
| `bytes=-100` | RF-03 | `206`, `bytes 0-9/10`, `content-length: 10` |
| `bytes=2-5` em HEAD | RF-04 | `206`, mesmos cabeçalhos, corpo vazio |
| `bytes=10-20` | RF-05 | `416`, `content-range: bytes */10`, `content-length: 0` (GET e HEAD) |
| `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=` | RF-06 | `200`, sem `content-range`, corpo completo |
| `If-Range: "abc"` com ETag `"abc"` | RF-07 | `206` com 4 bytes |
| `If-Range: "outro"` | RF-07 | `200` completo |
| `If-Range` com data igual ao `Last-Modified` | RF-07 | `206` |
| `If-Range` com ETag fraco `W/"abc"` | RF-07 | `200` |
| `If-None-Match: "abc"` + `Range` | RF-08 | `304`, sem corpo, sem `content-range` |
| `getMeta` sem `size` + `Range` | RF-12 | `200`, sem `accept-ranges`, sem `content-range` |
| `encodings: { gzip: ".gz" }` + `Accept-Encoding: gzip` + `Range` | RF-10 | `206`, `bytes 0-4/20`, `content-encoding: gzip`, 5 bytes de `app.js.gz` |
| `getContents` com `"héllo"` + `bytes=1-2` | RF-11 | corpo = bytes 1 e 2 do UTF-8, `content-length: 2` |
| `ReadableStream` de 10 bytes + `bytes=2-5` | RF-11 | 4 bytes `2345`; a fonte é cancelada |
| `Blob`, `ArrayBuffer`, `ArrayBufferView` | RF-11 | bytes exatos |
| POST com `fallthrough: true` + `Range` | RF-09 | `undefined`, sem `accept-ranges` |
| `headers: { "content-length": "999" }` + `Range` | D-03 | `206` com `content-length` do intervalo (não `999`) |
| `headers: { "accept-ranges": "none" }` + `Range` | D-10 | `200` completo |
| `getContents` devolve `"abc"` com `size: 10` + `Range` | D-08 | `500` |
| `getContents` devolve `null` + `Range` | D-09 | `500` |

Em `node`, cada caso verifica que `content-length` declarado coincide com os bytes lidos (RF-13). Usar `arrayBuffer()` e comparar `byteLength`.

### 5.2 `test/unit/static-range.test.ts`

Tabela de `parseRange`:
- `("bytes=2-5", 10)` → partial `{2,5}`.
- `("bytes=7-", 10)` → partial `{7,9}`.
- `("bytes=-100", 10)` → partial `{0,9}`.
- `("bytes=-0", 10)` → unsatisfiable.
- `("bytes=10-20", 10)` → unsatisfiable.
- `("BYTES=0-1", 10)` → partial `{0,1}` (unidade sem diferenciação de caixa).
- `("bytes=0-1,4-5", 10)`, `("items=0-1", 10)`, `("bytes=abc", 10)`, `("bytes=5-2", 10)`, `("bytes=-", 10)` → `undefined`.
- `("bytes=99999999999999999999-", 10)` → `undefined` (inteiro não seguro).

Tabela de `matchIfRange`: `"abc"` com etag `"abc"` → true; `"outro"` → false; `W/"abc"` → false; etag `W/"abc"` → false; data igual a `lastModified` → true; data diferente → false; data inválida → false; sem `lastModified` e data → false.

Tabela de `sliceBody`: `string` multibyte, `ReadableStream` com chunks de tamanhos irregulares (ex.: 3, 3, 4 bytes para testar corte no meio de chunk), `Blob` (confirmar que `blob.slice` é usado sem `text()`/`arrayBuffer()` completo, pela forma do resultado), `FormData` → `undefined`.

### 5.3 Suíte existente e qualidade

- `pnpm vitest run test/static.test.ts` deve continuar com 76 testes passando.
- `pnpm vitest run test/security.test.ts` (usa `serveStatic`, `:243`, `:274`, `:287`, `:307`, `:338`) deve continuar passando: D-01 não toca `id`, canonicalização nem `idSearchPaths`.
- `pnpm lint` (oxlint + oxfmt) e `pnpm typecheck` (`tsc --noEmit`) passando.
- `pnpm test` completo (com cobertura) antes de fechar.

## 6. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |
| `Content-Length` de `event.res` sobrescrever o do `206`/`416` (`src/response.ts:202-204`) | alta se ignorado | alto: resposta inválida | D-03 e teste dedicado (`content-length` no `206` e `0` no `416`) |
| Custo de I/O e memória ao descartar bytes de `ReadableStream` | certo para arquivo grande servido por stream | médio | `Blob.slice` para o caso comum; documentar no JSDoc; caminho futuro com API de intervalo (fora de escopo) |
| `size` diverge do conteúdo | médio, já existe em fixtures de teste (`:528-531`) | alto em Node (conexão cai) | D-08 e D-09: erro 500 explícito |
| Stream cancelado mal (fonte aberta) | baixo | médio (handle de arquivo vaza) | `reader.cancel()` quando `end` é atingido e no `cancel` do próprio stream |
| `Accept-Ranges: bytes` anunciado para `FormData` (não fatiável) | baixo | baixo | `200` completo como fallback (D-07); cabeçalho permanece |
| Usuário passa `content-length` explícito e perde a regra em `206` | baixo | baixo | D-03 documentado no JSDoc |
| Cache intermediário guardar `206` | médio | baixo | nenhum `Cache-Control` novo (fora de escopo); herda o do usuário (`static.ts:105-114`) |
| `If-Range` por data com precisão de segundos | baixo | baixo | comparação com `mtimeDate` já truncado (`static.ts:232`) |
| Inteiros grandes em `Range` | baixo | baixo | `Number.isSafeInteger` (D-04, item 4) |
| `Range` com `encodings` escolhe variante errada | baixo | médio | `size` vem de `getMeta` da variante escolhida (`static.ts:192-208`), então o intervalo é da variante (RF-10) |
| Quebra de API pública por export acidental | baixo | alto | `range.ts` fora de `index.ts`; verificar `src/index.ts:193` sem mudança |

## 7. Ordem de implementação sugerida

1. Escrever `test/unit/static-range.test.ts` e `test/static-range.test.ts` (vermelhos).
2. Criar `src/utils/internal/range.ts` com `parseRange` e `matchIfRange`; passar a tabela unitária.
3. Implementar `sliceBody` para `string`, `ArrayBuffer`, `ArrayBufferView`, `Blob` e `URLSearchParams`; depois `ReadableStream`.
4. Integrar em `src/utils/static.ts` (fluxo da seção 4.3).
5. Rodar `pnpm vitest run test/static-range.test.ts test/unit/static-range.test.ts`, depois `test/static.test.ts` e `test/security.test.ts`.
6. `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## 8. Pontos a confirmar

1. **`size: 0` (D-05).** O PRD diz em RF-05 que arquivo de 0 byte com `bytes=0-` responde `416`, e em RF-12 que `size` igual a `0` é tratado como desconhecido (sem `Range`). Esta especificação segue RF-12 e tira o exemplo de 0 byte de RF-05. Confirmar. Se preferir a RFC para arquivo vazio, o `static.ts:268` muda também.
2. **`Accept-Ranges` só com `size` conhecido.** Já é premissa do PRD (`prd.md`, "Premissas", quarto item). Mantido.
3. **`content-length` explícito do usuário em `206`.** D-03 faz o `Range` vencer. Confirmar, porque é uma mudança de precedência em relação ao que `static.ts:268` faz hoje.
4. **`FormData` e tipos não fatiáveis (D-07).** Esta especificação responde `200` completo, sem erro. Confirmar.
5. **Divergência com erro `500` (D-08, D-09).** O PRD deixa a decisão em aberto (`prd.md`, "Riscos", itens 2 e 3). Esta especificação escolhe `500` explícito.
6. **Opt-out via `accept-ranges: none` (D-10).** Não está no PRD. É uma decisão de baixo custo; confirmar se deve entrar nesta entrega.
7. **Documentação do site** (`prd.md`, "Fora de escopo") fica fora deste repositório, como o PRD já diz.
