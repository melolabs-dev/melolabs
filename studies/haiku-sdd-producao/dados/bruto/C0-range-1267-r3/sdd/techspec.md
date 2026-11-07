# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md`, `sdd/prd.md` (RF-01 a RF-12) e o código atual. Norma: RFC 9110 §13.1.5 e §14. Todas as citações `arquivo:linha` abaixo foram conferidas no código da base (commit `5e0ce73`).

## 1. Estado atual (resumo do que importa)

`serveStatic` é uma função única em `src/utils/static.ts:101-278`. O fluxo relevante é:

1. Copia `options.headers` para `event.res.headers` (`src/utils/static.ts:105-114`).
2. Rejeita métodos que não sejam GET/HEAD com 405 + `Allow` (`src/utils/static.ts:116-122`) e caminhos não canônicos com 404 (`src/utils/static.ts:142-147`).
3. Resolve o `meta` pelas variantes de encoding (`src/utils/static.ts:198-215`) e acrescenta `Vary: accept-encoding` só depois de achar o asset (`src/utils/static.ts:220-225`).
4. Define `Last-Modified` (`src/utils/static.ts:227-237`) e `ETag` (`src/utils/static.ts:239-241`) em `event.res.headers`, só se ainda não existirem.
5. Avalia o cache e devolve 304 (`src/utils/static.ts:243-248`).
6. Define `Content-Type` (`src/utils/static.ts:250-262`), `Content-Encoding` (`src/utils/static.ts:264-266`) e `Content-Length` quando `size > 0` e o header ainda não existe (`src/utils/static.ts:268-270`).
7. HEAD devolve `HTTPResponse(null, {status: 200})` (`src/utils/static.ts:272-274`); GET chama `getContents` e devolve `HTTPResponse(contents || null, {status: 200})` (`src/utils/static.ts:276-277`).

Fatos de `src/response.ts` que condicionam o desenho:

- Um `HTTPResponse` é aceito como "resposta parcial" e tem os headers de `event.res.headers` mesclados por cima (`src/response.ts:304`, `src/response.ts:198-205`, `mergeHeaders` em `src/response.ts:243-252`). Por isso `status` e `statusText` vêm do `HTTPResponse`, e os headers vêm de `event.res.headers`.
- O corpo é descartado em HEAD e em 100/101/102/204/205/304 (`src/response.ts:350-356`). 206 e 416 não estão nessa lista, então o corpo precisa ser `null` explicitamente quando não deve existir.
- `isCacheMatch` (`src/utils/internal/cache.ts:29`) já implementa `If-None-Match`/`If-Modified-Since`. Não será alterado.

Exportações: `src/index.ts:193` exporta só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic` de `static.ts`. O snapshot de exports está em `test/unit/package.test.ts:4-6` (`serveStatic` na linha 133) e **não deve mudar**.

## 2. Decisões de arquitetura

### D-01 — Onde ficam os auxiliares

- **Alternativas:** (a) novo arquivo `src/utils/internal/range.ts` com `export`; (b) funções não exportadas no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).
- **Escolha: (b).** O pedido e a issue exigem "auxiliares privados no módulo" e RF-12 exige que o módulo `static.ts` não ganhe exports. Um arquivo interno com `export` seria um nome novo exportado por outro módulo e fugiria da letra do pedido. Custo aceito: `static.ts` passa de ~350 para ~520 linhas, acima da meta de 200 do AGENTS.md. A restrição explícita do pedido prevalece sobre essa meta; o arquivo já tem o padrão de "Internal Utils" no fim.

### D-02 — Ponto de inserção no fluxo

- **Alternativas:** (a) decidir Range antes do 304; (b) logo depois de montar os headers do asset e depois do 304, no lugar dos blocos `src/utils/static.ts:268-277`.
- **Escolha: (b).** RF-09 exige que `If-None-Match`/`If-Modified-Since` continuem valendo antes do Range, e o 304 atual (`src/utils/static.ts:243-248`) fica intocado. Consequência: `Accept-Ranges` é definido **depois** do 304 e o 304 mantém exatamente os headers de hoje. O `Range` só é consultado quando o asset existe e o método já passou por GET/HEAD, logo 404, 405 e `fallthrough` não mudam (RF-11), e `Accept-Ranges` não vaza para o próximo handler.

### D-03 — Quando há suporte a Range ("tamanho conhecido")

- **Alternativas:** (a) `meta.size !== undefined`; (b) `Number.isSafeInteger(meta.size) && meta.size >= 0`.
- **Escolha: (b)**, como o PRD (RF-01/RF-07). Isso rejeita `NaN`, fracionários e negativos. `size === 0` conta como conhecido: anuncia `Accept-Ranges` e qualquer Range vira 416. O `Content-Length` do 200 continua com a condição atual `size > 0` (`src/utils/static.ts:268`), sem alteração, para não mudar respostas sem Range.

### D-04 — Parser de Range

- **Alternativas:** (a) usar uma lib (ex.: `range-parser`) — viola "2 deps de produção"; (b) regex estrita por uma única faixa.
- **Escolha: (b).** `/^bytes=(\d*)-(\d*)$/i` aplicado ao valor com `trim()`. Isso ignora, por construção, multi-range (vírgula não casa), outras unidades, `abc` e valores com espaços internos. O parser devolve `{ start, end } | "unsatisfiable" | undefined` (`undefined` = ignorar o header):
  - ambos os grupos vazios → `undefined`;
  - qualquer número com `!Number.isSafeInteger` → `undefined` (RF-06, risco de inteiros grandes);
  - `início-fim` com `fim < início` → `undefined` (inválido, avaliado **antes** da satisfazibilidade);
  - `início` ≥ `size` → `"unsatisfiable"`; `fim` é limitado a `size - 1`;
  - `-n`: `n = 0` ou `size = 0` → `"unsatisfiable"`; senão `start = max(size - n, 0)`, `end = size - 1`;
  - `início-`: `end = size - 1`.
  A unidade `bytes` não diferencia maiúsculas (flag `i`).

### D-05 — Avaliação de `If-Range`

- **Alternativas:** (a) reutilizar `matchETag` de `src/utils/internal/cache.ts:11` (comparação fraca); (b) função própria com comparação forte e data idêntica.
- **Escolha: (b).** `matchETag` usa comparação fraca (`opaqueTag` ignora `W/`, `src/utils/internal/cache.ts:51-53`), que a RFC 9110 §13.1.5 proíbe no `If-Range`. Regras:
  - sem `Range` válido, `If-Range` é ignorado (não é avaliado);
  - se o valor de `If-Range` começa com `"` ou `W/`, é um ETag: casa só se o ETag **efetivamente enviado** (`event.res.headers.get("etag")`) for forte (formato `"..."`, sem prefixo `W/`) e **idêntico** byte a byte. O requisito de formato `"..."` mantém o ETag `w/123` (minúsculo, não conforme) usado em `test/static.test.ts:15` fora do caso forte;
  - caso contrário é tratado como data: casa só se for string **idêntica** ao `Last-Modified` efetivamente enviado (`event.res.headers.get("last-modified")`);
  - sem validador correspondente no asset, ou valor inválido → não casa → resposta 200 completa (e então nem 416 se aplica).
  Usa-se o header enviado, e não `meta`, para respeitar valores vindos de `options.headers` (`src/utils/static.ts:234`, `:239`).

### D-06 — Montagem das respostas 206 e 416

- **Alternativas:** (a) devolver um `Response` nativo; (b) `HTTPResponse` com `status` explícito e headers em `event.res.headers`, como o 200 de hoje.
- **Escolha: (b).** Mantém o caminho único de merge de headers (`src/response.ts:198-205`) e o comportamento de `options.headers`, `Vary`, `ETag` etc. (RF-03).
  - **206:** `event.res.headers.set("content-range", \`bytes ${start}-${end}/${size}\`)`; `set("content-length", String(end - start + 1))`, **sobrescrevendo** qualquer valor de `options.headers` (RF-03; diferente do 200, que preserva o valor existente conforme o teste `test/static.test.ts:600-617`). Status `206`, `statusText: "Partial Content"`.
  - **416:** `set("content-range", \`bytes */${size}\`)`, `set("content-length", "0")`, corpo `null`, status `416`, `statusText: "Range Not Satisfiable"`. Não chama `getContents`, em GET ou HEAD.
  - **HEAD + Range válido:** mesmo 206 com corpo `null`, sem `getContents` (RF-04).
  - Os demais headers (`Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary`, `Accept-Ranges`, `options.headers`) permanecem os já montados. No 416 também se mantêm (o PRD não pede removê-los; ver R-05).
  - `Accept-Ranges: bytes` é definido por `set` em `event.res.headers` quando o tamanho é conhecido (D-03), logo após o 304 e antes do tratamento de Range, de modo que 200, 206 e 416 o carregam.

### D-07 — Fatiamento do corpo por bytes

- **Alternativas:** (a) materializar tudo com `new Response(body).arrayBuffer()` e `slice`; (b) fatiar por tipo, usando `Blob.slice` e `Uint8Array.subarray` onde possível e transformando o stream nos demais casos.
- **Escolha: (b)**, para não materializar corpos grandes (risco do PRD). Função privada `sliceBody(body: BodyInit, start: number, endInclusive: number): BodyInit`:
  - `string` → `new TextEncoder().encode(body)` e `subarray` (offsets em bytes UTF-8, não em caracteres);
  - `ArrayBuffer` → `new Uint8Array(body)`, e `ArrayBuffer.isView` → `Uint8Array` sobre o mesmo buffer (`byteOffset`/`byteLength`), com `subarray`;
  - `Blob`/`File` → `body.slice(start, endInclusive + 1)`;
  - `ReadableStream` e qualquer outro `BodyInit` (`FormData`, `URLSearchParams`, via `new Response(body).body`) → `ReadableStream` novo que lê o reader de origem, descarta `start` bytes, emite no máximo `length` bytes e, ao completar, chama `reader.cancel()` na origem; `cancel()` do stream novo também cancela a origem. Chunks que não são `Uint8Array` fazem o stream falhar com `TypeError`.
  O tamanho real do corpo manda: se `getContents` devolver menos bytes que `meta.size`, o corpo sai truncado (premissa documentada, R-01). `getContents` vazio (`null`/`undefined`) mantém o comportamento atual: `HTTPResponse(null, ...)` (RF-10); no caso de 206 com corpo vazio mantém-se `null` e o status 206.

### D-08 — Pedidos que mantêm o 200

Qualquer condição fora do caminho feliz (tamanho desconhecido, Range ausente/inválido/multi/outra unidade, `If-Range` que não casa) segue o código de hoje (`src/utils/static.ts:268-277`), apenas com `Accept-Ranges` quando D-03 vale (RF-06, RF-07, RF-08, RF-11). Os helpers nunca lançam: entradas inválidas viram "ignorar".

### D-09 — Testes existentes e documentação

- **Testes existentes:** os que comparam headers usam `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`), e uma busca por `toEqual`/`toStrictEqual` sobre o conjunto de headers em `test/` não achou nenhum de `serveStatic`. Portanto, em princípio **nenhum teste existente precisa mudar**; se a execução real mostrar algum que dependa do conjunto exato, ajusta-se só a expectativa para aceitar `accept-ranges`.
- **Docs:** acrescentar um parágrafo curto em `docs/4.examples/serve-static-assets.md` (depois da linha 71) dizendo que, com `size` em `getMeta`, o `serveStatic` atende `Range` (206/416) e envia `Accept-Ranges`; e uma frase em `docs/2.utils/2.response.md` (seção `serveStatic`, a partir da linha 39). Sem alterar `src/index.ts`.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts:268-277` | Substituir os blocos de `content-length`, HEAD e `getContents` pela lógica de Range (D-02, D-03, D-06, D-08). |
| `src/utils/static.ts:280-351` | Acrescentar auxiliares privados na seção "Internal Utils": `parseRange`, `isIfRangeFresh`, `sliceBody`, `sliceStream` (D-04, D-05, D-07). |
| `test/static.test.ts` | Novos `describeMatrix` de Range (seção 5). Estrutura-modelo: `test/static.test.ts:5` e `:525`. |
| `docs/4.examples/serve-static-assets.md:71` | Parágrafo sobre Range. |
| `docs/2.utils/2.response.md:39-49` | Frase sobre Range em `serveStatic`. |

Não são alterados: `src/index.ts:193`, `src/utils/internal/cache.ts`, `src/response.ts`, `test/unit/package.test.ts` e qualquer outro arquivo de `src/`.

## 4. Contratos e assinaturas

Nenhuma assinatura pública muda: `serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>`, `ServeStaticOptions` e `StaticAssetMeta` ficam como em `src/utils/static.ts:9-17` e `:101-104`. Auxiliares **não exportados**:

```ts
type ByteRange = { start: number; end: number }; // end inclusivo

// undefined = ignorar o header; "unsatisfiable" = 416
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined;

// Comparação forte do ETag enviado ou data idêntica ao Last-Modified enviado.
function isIfRangeFresh(
  ifRange: string | null,
  sent: { etag: string | null; lastModified: string | null },
): boolean;

function sliceBody(body: BodyInit, start: number, end: number): BodyInit;
function sliceStream(source: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array>;
```

Contrato de respostas (tamanho conhecido = `S`, faixa `a-b`):

| Situação | Status | Headers próprios do Range | Corpo |
| --- | --- | --- | --- |
| Sem `Range` válido / ignorado | 200 | `Accept-Ranges: bytes` | completo |
| Faixa válida, GET | 206 | `Content-Range: bytes a-b/S`, `Content-Length: b-a+1` | bytes `a..b` |
| Faixa válida, HEAD | 206 | idem | nenhum; `getContents` não é chamado |
| Faixa não satisfazível (GET/HEAD) | 416 | `Content-Range: bytes */S`, `Content-Length: 0` | nenhum |
| Tamanho desconhecido | 200 | sem `Accept-Ranges`/`Content-Range` | completo |

## 5. Estratégia de testes

Seguindo o fluxo de correção do AGENTS.md (teste de regressão primeiro, confirmar falha, implementar, confirmar sucesso) e `describeMatrix` para rodar em `web` e `node` (`test/static.test.ts:5`). Os arquivos de asset de 10 bytes (`0123456789`) vêm de `getMeta`/`getContents` com `vi.fn`.

1. **RF-01/RF-11:** 200 com `accept-ranges: bytes` em GET e HEAD; sem `size` não há `accept-ranges`; 404, 405 (`Allow: GET, HEAD`) e `fallthrough` com `Range` presente continuam iguais e, em `fallthrough`, não vazam `accept-ranges` nem `vary`.
2. **RF-02:** `bytes=2-5` → `2345`; `7-` → `789`; `-3` → `789`; `8-99` → `89` (`bytes 8-9/10`); `-99` → `0123456789` como `bytes 0-9/10`; `BYTES=2-5` (unidade em maiúsculas).
3. **RF-03:** 206 tem os mesmos `ETag`, `Last-Modified`, `Content-Type`, `Vary` do 200; `Content-Length` do intervalo mesmo com `options.headers` definindo `content-length: 999`.
4. **RF-04:** HEAD + `bytes=2-5` → 206, headers corretos, corpo vazio, `getContents` não chamado.
5. **RF-05:** `10-20`, `-0` e qualquer faixa com `size: 0` → 416 com `content-range: bytes */S`, `content-length: 0`, GET e HEAD; `getContents` não chamado.
6. **RF-06:** `0-1,4-5`, `abc`, `5-2`, `items=0-1`, `bytes=-`, `bytes=1.5-3`, `bytes=0-99999999999999999999` → 200 inteiro, sem `Content-Range`.
7. **RF-08:** `If-Range` com ETag forte igual e com data exata → 206; ETag diferente, `W/"abc"`, data diferente, `If-Range` sem validador no asset → 200; `If-Range` sem `Range` → 200 normal.
8. **RF-09:** `If-None-Match` igual ao ETag + `Range` → 304 sem corpo.
9. **RF-10:** com `encodings: { gzip: ".gz" }`, `accept-encoding: gzip` e `Range: bytes=0-4` → 206 com `content-encoding`, `vary: accept-encoding`, `bytes 0-4/20`; mesmo recorte para `getContents` devolvendo `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream`; string com caracteres multibyte (ex.: `"áéí"`, `size` em bytes) para provar offsets em bytes; `getContents` devolvendo `undefined` mantém o comportamento atual.
10. **Stream (unitário, direto):** chamar `serveStatic` com `mockEvent` (exportado em `src/index.ts:28`, já usado em `test/security.test.ts:3`) e ler `result.body`: o stream de origem é cancelado ao fim do intervalo e não é lido além do necessário; chunks fragmentados em limites arbitrários dão o mesmo recorte.
11. **RF-12:** o snapshot de `test/unit/package.test.ts:6` continua passando sem alteração; conferir por `git diff` que `src/index.ts` não mudou.
12. **Regressão geral:** `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts`, depois `pnpm lint` e `pnpm typecheck` (e `pnpm test` completo ao final).

## 6. Riscos

- **R-01 — `size` incorreto em `getMeta`:** `Content-Range`/`Content-Length` ficam inconsistentes com o corpo real. Mitigação: o fatiamento usa os bytes reais; premissa documentada nos docs (D-09). Não há como validar sem ler o corpo (fora de escopo).
- **R-02 — Streams:** consumo de memória e cancelamento. Mitigação: descarte incremental de chunks, `cancel()` propagado nos dois sentidos (D-07), teste dedicado (item 10). `getContents` ainda devolve o corpo inteiro da origem; não se otimiza a leitura (fora de escopo).
- **R-03 — Strings e multibyte:** offsets em bytes UTF-8; `size` precisa ser em bytes. Coberto pelo teste do item 9.
- **R-04 — `Content-Length` configurado em `options.headers`:** no 206/416 é sobrescrito; no 200 continua preservado (comportamento atual e teste `test/static.test.ts:600-617`). A assimetria é intencional e deve ficar comentada no código.
- **R-05 — Headers de representação no 416:** `Content-Encoding`/`Content-Type` permanecem num 416 sem corpo. É compatível com o PRD e com a RFC, mas um cliente estrito poderia tentar descomprimir um corpo vazio. Alternativa (remover `content-encoding` no 416) fica como decisão de revisão; hoje o PRD não pede.
- **R-06 — `If-Range` e caches:** comparação fraca serviria bytes de representações diferentes. Mitigado por D-05 (forte e data idêntica); o ETag `w/123` dos testes existentes nunca valida `If-Range`, e isso é testado.
- **R-07 — HEAD + Range:** a RFC 9110 define `Range` só para GET; o PRD manda tratar HEAD como o GET equivalente. Decisão herdada do pedido; coberta pelo item 4.
- **R-08 — Tamanho do arquivo:** `static.ts` passa da meta de ~200 linhas do AGENTS.md (D-01). Aceito por exigência do pedido; reavaliar se a revisão preferir mover para `utils/internal/` com a ressalva de exports.
- **R-09 — Formatação/lint:** código novo deve passar em `oxlint`/`oxfmt` e em `isolatedDeclarations` (tipos de retorno explícitos nos auxiliares, sem enums) conforme AGENTS.md.
