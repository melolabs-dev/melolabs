# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue + contrato) e `sdd/prd.md` (RF-01 a RF-13). Norma: RFC 9110 §13.1.5 e §14. Esta especificação não altera código; descreve o que será feito.

## 1. Estado atual do código (conferido)

- `src/utils/static.ts:101` — `serveStatic(event, options)`. Os cabeçalhos de `options.headers` são copiados para `event.res.headers` em `static.ts:105-114`; o filtro de método (405/fallthrough) está em `static.ts:116-122`; o 404 de asset inexistente em `static.ts:210-215`.
- `static.ts:217-225` — `Vary: accept-encoding`, só depois de achar o asset (não vaza no fallthrough).
- `static.ts:227-241` — `mtimeDate` (truncado em segundos), `Last-Modified` e `ETag`.
- `static.ts:243-248` — `isCacheMatch(...)` devolve `HTTPResponse(null, { status: 304 })`.
- `static.ts:250-266` — `Content-Type` e `Content-Encoding`.
- `static.ts:268-270` — `Content-Length` só quando `size > 0` e ainda não definido.
- `static.ts:272-277` — `HEAD` devolve `200` sem corpo; `GET` chama `getContents(id)` e devolve `HTTPResponse(contents || null, { status: 200 })`.
- `static.ts:280` — início da seção `// --- Internal Utils ---` (helpers privados já vivem no arquivo, com 351 linhas).
- `src/index.ts:193` — única exportação de static: `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`.
- `src/utils/internal/cache.ts:29` — `isCacheMatch`; `cache.ts:11` — `matchETag` (comparação fraca; **não** serve para If-Range, que exige comparação forte).
- `src/response.ts:304-306` — um `HTTPResponse` passa direto por `prepareResponseBody`; `response.ts:195-205` aplica `status` (o do `HTTPResponse` vence o de `event.res`) e mescla os cabeçalhos de `event.res` com `set`, que sobrescreve os de mesmo nome; `response.ts:350-356` — `nullBody` zera o corpo de `HEAD` e de 304.
- `test/static.test.ts:5-40` e `:396-437` — fixtures com `etag: "w/123"`, `size = "asset:<id>".length`, `getContents` devolvendo `string`; `:600-617` — teste que exige que um `content-length: 999` vindo de `options.headers` não seja sobrescrito num `HEAD` **sem** Range.

## 2. Decisões de arquitetura

### D-01 — Lógica de Range em módulo interno `src/utils/internal/range.ts`

- **Alternativas:** (a) funções privadas dentro de `static.ts`; (b) módulo interno novo.
- **Escolha: (b).** `static.ts` já tem 351 linhas e o `AGENTS.md` pede arquivos < 200 LoC e helpers em `utils/internal/`. O módulo não é reexportado, então `src/index.ts:193` fica intacto (RF-13). `static.ts` ganha só um import ao lado de `static.ts:3-7` e a orquestração.

### D-02 — Ponto de inserção no fluxo: depois do 304, substituindo o bloco final

- **Alternativas:** (a) avaliar Range antes de `isCacheMatch`; (b) depois.
- **Escolha: (b).** RFC 9110 §13.2.2 avalia `If-None-Match`/`If-Modified-Since` antes de `Range`/`If-Range` (RF-09). O 304 (`static.ts:243-248`) continua inalterado e não leva `Accept-Ranges`. O Range é resolvido depois de `Content-Encoding` (`static.ts:264-266`), no lugar do bloco `static.ts:268-277`. Como `Vary` (`:217-225`) e os validadores (`:227-241`) já foram definidos, a seleção de encoding e `Vary` ficam intactos (RF-10, RF-12).

### D-03 — `Accept-Ranges` só com `size` conhecido, e sem sobrescrever o do usuário

- **Alternativas:** (a) sempre anunciar (literal da issue); (b) só com `size` inteiro > 0.
- **Escolha: (b)**, conforme PRD RF-07 e premissas: não anunciar o que não se cumpre. A condição é a mesma de `static.ts:268` (`meta.size !== undefined && meta.size > 0`); acrescenta-se `Number.isSafeInteger`. O cabeçalho é definido apenas se `event.res.headers` ainda não o tiver, igual a `Content-Type`/`Content-Length` (`static.ts:250`, `:268`). Fica depois do 304 e depois do fallthrough/404/405, então não vaza em nenhum deles.

### D-04 — Parser estrito de um único `byte-range-spec`

- **Alternativas:** (a) regex única; (b) parser manual com `split`.
- **Escolha: (a)** `/^bytes=(\d*)-(\d*)$/i` aplicada ao valor com `trim()`. Rejeita sem código extra: multi-range (vírgula), `bytes 0-5` (sem `=`), `bytes=` e `bytes=-` (ambos os lados vazios) e unidades desconhecidas. `bytes=5-2` (fim < início) é rejeitado explicitamente. Números gigantes viram `Number` impreciso/`Infinity`, mas as comparações com `size` continuam corretas (início ≥ size → 416; fim é limitado; sufixo ≥ size → tudo), então não é preciso `BigInt`.
- Resultado tipado: `{ start, end } | "unsatisfiable" | undefined` (`undefined` = ignorar o Range).

### D-05 — `If-Range` por comparação forte de ETag ou igualdade exata de data

- **Alternativas:** (a) reutilizar `matchETag` (fraca); (b) função própria; (c) `Date.parse` e comparar números.
- **Escolha: (b).** O valor que começa com `"` ou `W/` é tratado como ETag: o range só vale se não é fraco (`W/`, aceitando também `w/` como o `opaqueTag` da base não aceita — ver risco R-05), se o `etag` do asset também não é fraco e se as strings são idênticas. Caso contrário o valor é tratado como data: o range vale somente se `ifRange.trim() === mtimeDate.toUTCString()` (precisão de segundos, RF-08). `Date.parse` (c) é descartado porque aceita formatos não-HTTP e, com `>=`, violaria "igual". Sem `etag`/`mtime` para comparar, ou valor inválido → ignorar o Range. `If-Range` sem `Range` nunca é lido.

### D-06 — Fatiamento do corpo com função própria por tipo de `BodyInit`

- **Alternativas:** (a) pedir ao backend só o trecho (nova API); (b) fatiar após `getContents`; (c) sempre converter para `Uint8Array` via `Response.arrayBuffer()`.
- **Escolha: (b)**, pois nova API está fora de escopo (PRD §3). (c) é descartada porque carrega streams grandes inteiros na memória. `sliceBody(body, start, end)` devolve `BodyInit | undefined` (`undefined` = tipo não fatiável):
  - `string` → `TextEncoder().encode(s).subarray(start, end + 1)` (bytes UTF-8);
  - `Uint8Array`/outros `ArrayBufferView` e `ArrayBuffer` → `subarray`/`slice` pelos bytes (respeitando `byteOffset`);
  - `Blob` → `blob.slice(start, end + 1)`;
  - `ReadableStream` → `ReadableStream` novo que lê o original com `getReader()`, descarta os bytes antes de `start`, repassa o trecho e, ao completar `end + 1` bytes, chama `reader.cancel()` e fecha; `cancel()` do consumidor propaga para o original;
  - `FormData`, `URLSearchParams` e o restante → `undefined`: o Range é ignorado e responde-se `200` completo (RF-11).

### D-07 — `206` e `416` sobrescrevem `Content-Length`; `200` mantém a regra atual

- **Alternativas:** (a) trocar a regra de `static.ts:268` para sempre sobrescrever; (b) sobrescrever só em 206/416.
- **Escolha: (b).** O teste `test/static.test.ts:600-617` exige que, sem Range, um `content-length` preexistente vença. Em 206/416 o valor de `options.headers` seria incorreto, então `content-length` e `content-range` são definidos incondicionalmente. Em `200` (inclusive Range ignorado) vale o código de hoje.

### D-08 — Respostas via `HTTPResponse` com cabeçalhos em `event.res.headers`

- **Alternativas:** (a) devolver `Response` pronta; (b) continuar com `HTTPResponse` e `event.res.headers`.
- **Escolha: (b)**, como o código atual. `HTTPResponse` com `status: 206/416` prevalece (`response.ts:195-197`) e os cabeçalhos de `event.res` são mesclados com `set` (`response.ts:201-204`). `416` e `HEAD` devolvem `body: null`; `getContents` não é chamado em nenhum dos dois (RF-04, RF-05). O `416` mantém `Accept-Ranges`, `ETag`, `Vary` etc., e leva `Content-Range: bytes */<size>` e `Content-Length: 0`. `Content-Type` e `Content-Encoding` do asset também permanecem, como no `200`: o PRD só exige esses três cabeçalhos e remover os demais complicaria o código sem ganho.

### D-09 — `getContents` devolve vazio com Range

- **Alternativas:** (a) responder 206 com corpo vazio; (b) `200` com corpo `null`.
- **Escolha: (b).** Se `contents` é `null`/`undefined` ou não fatiável, mantém o comportamento atual (`HTTPResponse(contents || null, { status: 200 })`), sem `Content-Range`.

## 3. Arquivos a alterar

| Arquivo                                 | Mudança                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/internal/range.ts` (novo)    | `parseRange`, `isIfRangeValid`, `sliceBody` (D-04 a D-06). Sem reexportação.                                                      |
| `src/utils/static.ts:7` (imports)       | importar os helpers de `./internal/range.ts`.                                                                                     |
| `src/utils/static.ts:268-277`           | substituir o bloco de `Content-Length`/HEAD/GET pela orquestração de Range (D-02, D-03, D-07 a D-09).                             |
| `test/static.test.ts`                   | novo `describeMatrix("serve static range", ...)` ao fim do bloco principal; ajustes só se algum teste existente quebrar (ver §6). |
| `test/unit/static-range.test.ts` (novo) | testes unitários dos helpers internos.                                                                                            |
| `src/index.ts:193`                      | **não muda** (verificado por teste/`git diff`).                                                                                   |

## 4. Contratos e assinaturas

```ts
// src/utils/internal/range.ts — nada é reexportado por src/index.ts
export type ByteRange = { start: number; end: number }; // inclusivos, 0 <= start <= end < size

/** Range ignorado => undefined. */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | undefined;

export function isIfRangeValid(
  ifRange: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/** `undefined` quando o tipo de corpo não pode ser fatiado com segurança. */
export function sliceBody(body: BodyInit, range: ByteRange): BodyInit | undefined;
```

Pseudofluxo no lugar de `static.ts:268-277`:

```ts
const size = meta.size;
const known = size !== undefined && Number.isSafeInteger(size) && size > 0;
if (known && !event.res.headers.has("accept-ranges")) event.res.headers.set("accept-ranges", "bytes");

let range: ByteRange | "unsatisfiable" | undefined;
const rangeHeader = event.req.headers.get("range");
if (known && rangeHeader !== null) {
  range = parseRange(rangeHeader, size);
  if (range && !isIfRangeValid(event.req.headers.get("if-range") (só se presente), { etag: meta.etag, lastModified: mtimeDate })) range = undefined;
}

if (range === "unsatisfiable") {           // 416
  headers.set("content-range", `bytes */${size}`); headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416 });
}
if (range) { /* 206: content-range + content-length (end-start+1), HEAD => null body */ }
// caminho atual: content-length condicional (static.ts:268-270), HEAD 200, GET 200
```

Para `GET` com range: `contents = await options.getContents(id)`; `sliceBody` `undefined` ou `contents` vazio → `200` completo, sem `Content-Range`, e o `content-length` de meta volta à regra atual (por isso `content-length`/`content-range` do 206 só são escritos depois de o fatiamento ter dado certo).

## 5. Mapeamento RF → decisão

RF-01/07 → D-03; RF-02/05/06 → D-04; RF-03/04/05 → D-07, D-08; RF-08 → D-05; RF-09/10/12 → D-02; RF-11 → D-06; RF-13 → D-01; vazio com Range → D-09.

## 6. Estratégia de testes

Seguir `AGENTS.md`: `describeMatrix` (modos `web` e `node`), `pnpm vitest run test/static.test.ts test/unit/static-range.test.ts`; fluxo de correção: escrever os testes de Range primeiro, ver falhar, implementar, ver passar; depois `pnpm lint`, `pnpm typecheck` e a suíte completa.

- **Integração (`test/static.test.ts`)**, asset de 1000 bytes com `etag: '"v1"'` e `mtime` fixo: RF-01 (GET/HEAD sem Range → 200 com `accept-ranges`); RF-02 (`100-199`, `900-`, `-100`, `0-5000`, `-5000`, `Bytes=`, maiúsculas); RF-03 (cabeçalhos preservados e `content-length` de `options.headers` substituído); RF-04 e RF-05 (`getContents` não chamado: `vi.fn` com `not.toHaveBeenCalled`; `1000-`, `2000-3000`, `-0`, `Content-Length: 0`, corpo vazio); RF-06 (`0-1,5-9`, `5-2`, `items=0-5`, `abc`, `bytes=`, `bytes 0-5`); RF-07 (sem `size` e `size: 0`: sem `accept-ranges` e sem `content-range`); RF-08 (`If-Range` ETag igual, diferente, fraco, data igual, data diferente/inválida, sem etag/mtime, e `If-Range` sem `Range`); RF-09 (`If-None-Match` + Range → 304 sem `content-range`); RF-10 (`encodings: { gzip: ".gz" }`, variante de 500 bytes); RF-12 (404/405 com Range, fallthrough sem `Vary`/`Accept-Ranges`).
- **RF-11:** mesma tabela de conteúdo com `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` em vários chunks, `Range: bytes=2-5` → mesmos 4 bytes; texto multibyte (`"héllo"`) fatiado por bytes; `FormData`/`URLSearchParams` → 200 completo.
- **Unitários (`test/unit/static-range.test.ts`):** tabela de `parseRange` e `isIfRangeValid`; `sliceBody` com stream que cancela o original ao passar do fim (spy em `cancel`).
- **Existentes:** os testes com `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`) toleram o novo `accept-ranges`; o teste `:600-617` deve continuar passando sem alterações (D-07). Só se algum comparar o conjunto exato de cabeçalhos será ajustado, preservando o que verifica.
- **RF-13:** `git diff --stat` mostra `src/index.ts` sem alterações; opcionalmente um teste que importa `../src/index.ts` e confirma a ausência de `parseRange`/`sliceBody`.

## 7. Riscos

- **R-01 Memória/latência:** `sliceBody` roda depois de `getContents`; I/O não diminui. Aceito (PRD §3). `string` é codificada inteira; stream não acumula.
- **R-02 `size` errado do backend:** o `Content-Range` e o `Content-Length` ficarão incoerentes com o corpo real. Não há como verificar sem ler o corpo; documentar em comentário.
- **R-03 Adapter Node:** `Content-Length: 0` em `416` e `Content-Length: n` em `HEAD 206` precisam sair corretos; coberto pela matriz `web`/`node`.
- **R-04 Streams com chunks que não são bytes:** um chunk que não seja `Uint8Array` quebra o descarte; tratar como erro do stream (propagar), sem engolir.
- **R-05 ETags fracos em minúsculas:** as fixtures usam `"w/123"` (minúsculo, que não é ETag válido). `isIfRangeValid` trata `w/` e `W/` como fraco para nunca servir range por ETag duvidoso. A comparação fraca de `isCacheMatch` (`cache.ts:51-53`) só aceita `W/`; não se mexe nela.
- **R-06 Divergência da RFC:** Range em `HEAD` e `size: 0` como "desconhecido" seguem o PRD, não a RFC literal.
- **R-07 `Content-Type`/`Content-Encoding` em `416`:** permanecem como no `200` (D-08); se um cache intermediário se incomodar, é ajuste trivial posterior.
- **R-08 Tamanho de `static.ts`:** a orquestração soma ~35 linhas ao arquivo; mitigado por manter os helpers em `range.ts`.
- **R-09 Ordem das condicionais:** servir `206` antes do 304 devolveria conteúdo errado a caches; coberto por RF-09 e pela posição fixada em D-02.
