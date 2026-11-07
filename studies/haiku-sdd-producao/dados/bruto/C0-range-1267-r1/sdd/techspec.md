# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` e `sdd/prd.md`. Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests). Todas as citações `arquivo:linha` foram conferidas no código atual (commit `8c2d70a`).

## 1. Estado atual (resumo do código)

`serveStatic` (`src/utils/static.ts:101`) segue este fluxo:

1. copia `options.headers` para `event.res.headers` (`static.ts:105-114`);
2. rejeita métodos diferentes de GET/HEAD com 405 + `Allow` (`static.ts:116-122`) e caminhos não canônicos com 404 (`static.ts:142-147`);
3. resolve `getMeta` pelas variantes de encoding e index (`static.ts:187-215`);
4. define `Vary` (`static.ts:220-225`), `Last-Modified` (`static.ts:227-237`) e `ETag` (`static.ts:239-241`);
5. responde 304 via `isCacheMatch` (`static.ts:243-248`);
6. define `Content-Type` (`static.ts:250-262`), `Content-Encoding` (`static.ts:264-266`) e `Content-Length` só se ainda ausente e `size > 0` (`static.ts:268-270`);
7. HEAD devolve `HTTPResponse(null, 200)` (`static.ts:272-274`); GET chama `getContents` e devolve `HTTPResponse(contents, 200)` (`static.ts:276-277`).

O pipeline de resposta (`src/response.ts`) aceita `HTTPResponse` como "resposta parcial": `prepareResponseBody` o devolve como está (`response.ts:304-306`), o status vem de `HTTPResponse.status` (`response.ts:114-116`, `response.ts:195-197`) e os cabeçalhos de `event.res.headers` são mesclados em `FastResponse` (`response.ts:198-205`). Em HEAD o corpo é sempre anulado por `nullBody` (`response.ts:350-356`). O ramo `status >= 400` que descarta cabeçalhos preparados vale só para `Response` nativo (`response.ts:211-213`), não para `HTTPResponse`; logo um `HTTPResponse` com status 416 mantém os cabeçalhos de `event.res`.

Exportação pública: `src/index.ts:193` exporta apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. `test/unit/package.test.ts:133` lista `serveStatic` entre as exportações esperadas, o que serve de guarda para RF-13.

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica: tudo privado em `src/utils/static.ts`

**Alternativas**
- (a) Novo módulo `src/utils/internal/range.ts` com parser e fatiador, importado por `static.ts`.
- (b) Funções privadas (não exportadas) no fim de `static.ts`, na seção `// --- Internal Utils ---` (`static.ts:280`).
- (c) Estender `src/utils/internal/cache.ts` (onde vivem `matchETag` e `isCacheMatch`) com `If-Range`.

**Escolha: (b).** A issue pede "manter toda a lógica auxiliar privada dentro do módulo serveStatic" e o PRD (RF-13) exige funções privadas do módulo. Um arquivo interno sob `utils/internal/` também não vai para `index.ts`, mas obrigaria a exportar símbolos entre módulos (fora do espírito do pedido). O AGENTS.md pede "internal helpers no fim dos arquivos" e arquivos curtos (<200 LoC): `static.ts` tem 351 linhas e já passa disso, e isso é aceito porque o pedido manda manter no módulo. (c) foi descartada porque `cache.ts` é compartilhado com outros utilitários e a validação forte de `If-Range` é específica do Range.

### D-02 — Ponto de inserção no fluxo: depois do 304, substituindo o bloco final

**Alternativas**
- (a) Avaliar `Range` antes do `isCacheMatch`.
- (b) Avaliar `Range` depois do 304 e depois de definir `Content-Type`/`Content-Encoding`, no lugar do trecho `static.ts:268-277`.

**Escolha: (b).** RF-08 e RFC 9110 §13.2.2 pedem que `If-None-Match`/`If-Modified-Since` sejam avaliados antes de `Range`; o 304 já retorna em `static.ts:243-248`, então basta não mexer nele. Os cabeçalhos do asset (tipo, encoding, ETag, Last-Modified, Vary, `options.headers`) já estão em `event.res.headers` no ponto do `static.ts:268`, o que cumpre RF-09 sem código extra.

Esboço do novo trecho (substitui `static.ts:268-277`):

```ts
const size = isRangeableSize(meta.size) ? meta.size : undefined;

if (size === undefined) {
  // RF-10: comportamento atual, sem Accept-Ranges
  if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
    event.res.headers.set("content-length", meta.size + "");
  }
  return event.req.method === "HEAD" ? new HTTPResponse(null, { status: 200 }) : fullResponse(...);
}

event.res.headers.set("accept-ranges", "bytes");
const range = resolveRange(event.req.headers, size, { etag: meta.etag, lastModified: mtimeDate });
// range: undefined (ignorar) | { start, end } | "unsatisfiable"
```

Casos: `undefined` → fluxo 200 atual (inclusive o `Content-Length` condicional existente em `static.ts:268`); `"unsatisfiable"` → 416; `{start,end}` → 206.

### D-03 — Tamanho "suportado" e leitura restritiva de `Accept-Ranges`

**Alternativas**
- (a) Anunciar `Accept-Ranges: bytes` sempre (leitura literal de "Always advertise" na issue).
- (b) Anunciar apenas quando `meta.size` é inteiro > 0 (PRD RF-01/RF-10).

**Escolha: (b).** A própria issue restringe o recurso a "quando o tamanho do asset é conhecido"; anunciar sem tamanho seria promessa falsa. A guarda é `Number.isSafeInteger(size) && size > 0` (cobre ausente, 0, negativo, fracionário, `NaN`, `Infinity`). Como o código atual usa `meta.size > 0` sem checar inteiro (`static.ts:268`), o caso de tamanho fracionário passa a só emitir `Content-Length` como hoje, sem `Accept-Ranges` (comportamento de 200 inalterado). Item a confirmar com quem pediu a issue (já registrado no PRD).

### D-04 — Parser de `Range`: estrito, de intervalo único, falhas viram "ignorar"

**Alternativas**
- (a) Regex única `^bytes=(\d*)-(\d*)$` com `i`.
- (b) Parser manual por `indexOf`/`split`.

**Escolha: (a)**, aplicando `trim()` ao valor antes, com a unidade comparada sem distinção de maiúsculas. Regex: `/^bytes=(\d*)-(\d*)$/i`. Resultado de `parseRange(header, size)`:

| Entrada (size=10) | Resultado |
| --- | --- |
| `bytes=2-5` | `{2,5}` |
| `bytes=7-`, `bytes=7-999` | `{7,9}` (trunca `last` em `size-1`) |
| `bytes=-3` | `{7,9}` |
| `bytes=-999` | `{0,9}` |
| `bytes=-0`, `bytes=10-`, `bytes=20-30` | `"unsatisfiable"` |
| `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=`, `bytes=-`, `bytes=0-1,4-5`, `bytes=-1-2`, `bytes=+1-2` | `undefined` (ignorar) |

Pontos de cuidado:
- `5-2` (`first > last`) é sintaxe inválida (RFC 9110 §14.1.2) → ignorar, e **não** 416.
- A vírgula não casa a regex, então multi-intervalo cai em "ignorar" sem lógica adicional, como a issue pede.
- Números enormes: `\d+` pode exceder `Number.MAX_SAFE_INTEGER`; se `!Number.isSafeInteger(n)` para `first` ou `last`, tratar `first` fora de faixa como inalcançável (`unsatisfiable` quando `first >= size`) e `last` enorme como truncado. Implementação: converter com `Number`, e como `size` é safe integer, qualquer valor inseguro é ≥ `size`, então a regra "≥ size" já trata. Para `-N` com N inseguro, equivale a "asset inteiro".
- Um cabeçalho `Range` repetido chega concatenado por vírgula pelo `Headers` e cai em "ignorar".

### D-05 — Avaliação de `If-Range` (comparação forte)

**Alternativas**
- (a) Reutilizar `matchETag`/`opaqueTag` de `cache.ts:11,51` (comparação fraca).
- (b) Função privada com comparação forte, em `static.ts`.

**Escolha: (b).** `matchETag` usa comparação fraca (ignora `W/`, `cache.ts:15-16`), contrária a RFC 9110 §13.1.5, que exige comparação forte. Regras da função privada `ifRangeAllows(value, { etag, lastModified })`:

1. Sem `If-Range` → `true` (aplicar `Range`). `If-Range` sem `Range` nem é consultado (a avaliação só ocorre depois de achar um `Range`).
2. Valor (após `trim()`) começa com `"` → é entity-tag: `true` somente se `meta.etag` existe, **não** começa com `W/`, e `value === meta.etag` (comparação byte a byte). `W/"abc"` na requisição nunca casa (começa com `W/`, não com `"`, cai no ramo 3 e falha o parse de data → `false`).
3. Caso contrário é data: `Date.parse(value)`; `NaN` → `false`; senão `true` somente se `lastModified` existe e `Date.parse(value) === lastModified.getTime()` (igualdade exata, `mtimeDate` já truncado em `static.ts:232`).
4. Qualquer falha → ignorar o `Range` (200 completo, mantendo `Accept-Ranges`).

Observação sobre os testes existentes: o ETag de fixture é `w/123` (minúsculo, `test/static.test.ts:15`), que **não** é fraco pela sintaxe da RFC (`W/` maiúsculo) nem é entity-tag válido (sem aspas). Os novos testes de `If-Range` devem usar ETags com aspas (`"abc"`), como no PRD. Por tolerância, tratar `w/` minúsculo também como fraco (`/^w\//i`) evita dar `206` indevido sobre um validador que o usuário pretendia fraco; essa tolerância é decisão deste design.

### D-06 — Cabeçalhos do 206 e do 416: o calculado prevalece

**Alternativas**
- (a) Manter a regra "só define se ainda ausente" também no `Content-Length` do 206/416.
- (b) Sobrescrever `Content-Length` (e definir `Content-Range`) nas respostas 206/416.

**Escolha: (b).** Em 200 mantém-se a regra atual (teste `test/static.test.ts:600-617` exige que `content-length: 999` vindo de `options.headers` vença). Em 206/416 um `Content-Length` vindo de `options.headers` contradiria o corpo e quebraria proxies; PRD §4 manda o calculado prevalecer. Para `Content-Range` também sobrescreve (`set`), e `Accept-Ranges` usa `set`.

- 206: `Content-Range: bytes ${start}-${end}/${size}`, `Content-Length: ${end - start + 1}`, status 206, `statusText: "Partial Content"`.
- 416: `Content-Range: bytes */${size}`, `Content-Length: 0`, status 416, `statusText: "Range Not Satisfiable"`, corpo `null`, `getContents` não chamado.
- Mantêm-se `ETag`, `Last-Modified`, `Vary`, `Content-Type`, `Content-Encoding` e `options.headers` (RF-09), pois já estão em `event.res.headers`. No 416 não se removem cabeçalhos de representação (decisão: o PRD só exige os três cabeçalhos do RF-05; ver risco R-05).

Retornos usam `HTTPResponse` (como `static.ts:244`), então o status passa por `sanitizeStatusCode` (`response.ts:196`).

### D-07 — HEAD: mesma decisão que GET, sem chamar `getContents`

**Escolha única.** O cálculo de `range` ocorre antes de distinguir método. Para HEAD, 206 e 416 retornam `HTTPResponse(null, …)` com os cabeçalhos do D-06; nenhum chama `getContents` (RF-05, RF-06). `nullBody` garante corpo vazio mesmo se algo escapasse (`response.ts:350-352`). O `Content-Length` do 206 vem do cabeçalho calculado, não do corpo, então HEAD informa `4` mesmo com corpo nulo.

### D-08 — Fatiamento do corpo por tipo de `BodyInit`

`getContents` é chamado uma única vez (RF-12) e o resultado é fatiado em `sliceBody(contents, start, end): BodyInit` (privada, `[start, end]` inclusivo).

**Alternativas**
- (a) Converter tudo para `ArrayBuffer` (`new Response(contents).arrayBuffer()`) e fazer `subarray`.
- (b) Despachar por tipo: `Blob.slice`, `ArrayBufferView`/`ArrayBuffer` com `subarray`/`slice`, `string` via `TextEncoder`, `ReadableStream` por leitor, e fallback `new Response(x).blob()` para o resto.

**Escolha: (b)**, pela mitigação de memória do PRD.

| Tipo | Estratégia |
| --- | --- |
| `Blob`/`File` | `blob.slice(start, end + 1)`: não copia, sem leitura total |
| `Uint8Array`/`ArrayBufferView` | `new Uint8Array(v.buffer, v.byteOffset + start, len)`, respeitando `byteOffset` da view |
| `ArrayBuffer` | `new Uint8Array(buf, start, len)` |
| `string` | `new TextEncoder().encode(s).subarray(start, end + 1)`: offsets são em **bytes UTF-8**, não em caracteres |
| `ReadableStream` | novo `ReadableStream` que lê `getReader()`, descarta bytes até `start`, emite até `end`, e chama `reader.cancel()` ao terminar. Streams de chunks não-`Uint8Array` não são suportados (limitação registrada) |
| outros (`FormData`, `URLSearchParams`, objeto com `[Symbol.asyncIterator]`) | fallback `await new Response(x).blob()` e `blob.slice` |

O tipo resultante tem `Content-Length` explícito; se o conteúdo real for menor que `size`, o corpo fica mais curto que o `Content-Length` (premissa de `meta.size` correto, risco R-03). Um `ReadableStream` com `type: "bytes"` e fontes Node `Readable` não entram no `BodyInit` tipado do `getContents`; ficam fora.

### D-09 — Fronteira da API pública

`ServeStaticOptions`, `StaticAssetMeta` e `src/index.ts:193` não mudam. As novas funções (`isRangeableSize`, `parseRange`, `ifRangeAllows`, `resolveRange`, `sliceBody`, `sliceStream`) não têm `export`. Com `isolatedDeclarations`, funções não exportadas dispensam anotações explícitas, mas serão anotadas por consistência com `parseAcceptEncoding` (`static.ts:292`). Nenhum novo `import` de módulo externo é necessário (`TextEncoder`, `Blob`, `ReadableStream` são globais da web).

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts:268-277` | Substituir o bloco de `Content-Length` + HEAD + corpo pela lógica do D-02/D-06/D-07 |
| `src/utils/static.ts:280` (seção `// --- Internal Utils ---`, e fim do arquivo `:351`) | Adicionar helpers privados do D-04, D-05, D-08, seguindo o estilo de `parseAcceptEncoding` (`:292`) e `idSearchPaths` (`:340`) |
| `test/static.test.ts` | Novo bloco `describeMatrix("serve static range", …)` ao final (antes ou depois de `:626`); ajustes mínimos listados na seção 5 |

Arquivos de leitura apenas (sem alteração): `src/index.ts:193` (guarda de RF-13), `src/utils/internal/cache.ts:11,29,51` (referência: D-05 não o reutiliza), `src/response.ts:96,304,350` (contrato de `HTTPResponse`), `test/_setup.ts:11` (`describeMatrix`), `test/unit/package.test.ts:133` (lista de exports).

## 4. Contratos e assinaturas (todas privadas, no módulo)

```ts
type ByteRange = { start: number; end: number }; // inclusivo, 0 <= start <= end < size
type RangeResult = ByteRange | "unsatisfiable" | undefined; // undefined = ignorar o Range

function isRangeableSize(size: number | undefined): size is number;

function parseRange(header: string, size: number): RangeResult;

function ifRangeAllows(
  value: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean;

function resolveRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; lastModified?: Date },
): RangeResult; // lê "range"; sem range → undefined; If-Range falho → undefined

function sliceBody(contents: BodyInit, range: ByteRange): BodyInit | Promise<BodyInit>;
```

Contrato de resposta de `serveStatic` (exportada, assinatura **inalterada**: `serveStatic(event, options): Promise<HTTPResponse | undefined>`):

| Situação (size suportado) | Status | Cabeçalhos adicionais | Corpo |
| --- | --- | --- | --- |
| Sem `Range` ou ignorado | 200 | `Accept-Ranges: bytes` | completo (nulo em HEAD) |
| Intervalo válido | 206 | `Accept-Ranges`, `Content-Range: bytes s-e/size`, `Content-Length: e-s+1` | fatia (nulo em HEAD) |
| Não satisfazível | 416 | `Accept-Ranges`, `Content-Range: bytes */size`, `Content-Length: 0` | nulo |
| Casou `If-None-Match`/`If-Modified-Since` | 304 | (como hoje, sem `Content-Range`) | nulo |
| `size` ausente/0/inválido | como hoje | sem `Accept-Ranges` | como hoje |

Ordem de avaliação: método (405) → caminho canônico (404) → `getMeta` (404/fallthrough) → 304 → `Range`/`If-Range`.

## 5. Estratégia de testes

Framework: `describeMatrix` (`test/_setup.ts:11`), roda em `web` e `node`. Novo `describeMatrix("serve static range", …)` em `test/static.test.ts`, com `getMeta` retornando `{ size: 10, etag: '"abc"', mtime: 1_700_000_000_000, type: "text/plain" }` e `getContents: vi.fn(() => "0123456789")`, para asserções sobre `getContents` com `toHaveBeenCalledTimes`.

| RF | Casos |
| --- | --- |
| RF-01 | GET e HEAD sem `Range` → 200 + `Accept-Ranges: bytes` |
| RF-02 | `bytes=2-5` → 206, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, `Content-Type` preservado |
| RF-03 | tabela `it.each`: `7-`, `-3`, `7-999`, `BYTES=0-0`, `-999` (e `0-9`, `9-9`, `0-`) |
| RF-04 | `it.each`: `items=0-1`, `abc`, `5-2`, `bytes=`, `bytes=-`, `-1-2`, `+1-2`, `0-1,4-5`, números negativos → 200 completo, sem `Content-Range`, com `Accept-Ranges` |
| RF-05 | `10-`, `20-30`, `-0` → 416, `Content-Range: bytes */10`, `Content-Length: 0`, corpo vazio, `getContents` não chamado |
| RF-06 | HEAD com intervalo válido e inválido; corpo vazio e `getContents` não chamado |
| RF-07 | `If-Range` com ETag igual, diferente, `W/"abc"`; data igual (206) e diferente/inválida (200); `If-Range` sem `Range` ignorado |
| RF-08 | `Range` + `If-None-Match` igual → 304, sem `Content-Range`; também `If-Modified-Since` |
| RF-09 | `encodings: { gzip: ".gz" }` com `accept-encoding: gzip` → 206 com `Content-Encoding`, `Vary`, `Content-Type` do original, `Content-Range`/`Content-Length` sobre o tamanho da `.gz`; `ETag`, `Last-Modified`, `options.headers` presentes |
| RF-10 | meta sem `size`, `0`, `-1`, `1.5` → 200 integral, sem `Accept-Ranges` e sem `Content-Range` |
| RF-11 | 404 (com e sem fallthrough), 405 com `Allow`, caminho não canônico: sem `Accept-Ranges`/`Content-Range` |
| RF-12 | `it.each` sobre `string`, `Uint8Array`, subview de `Uint8Array` com `byteOffset > 0`, `ArrayBuffer`, `Blob`, `File`, `ReadableStream` (um e vários chunks, para cobrir descarte de início e truncamento) → corpo `2345`; `string` multibyte (ex. `"é0123"`) valida offset em bytes; `getContents` chamado uma vez |
| D-06 | `options.headers` com `content-length: 999` + `Range` → 206 usa `4`; em 200 continua `999` |
| RF-13 | já coberto por `test/unit/package.test.ts:133`; acrescentar verificação manual `git diff -- src/index.ts` vazio |

Testes existentes a revisar: os de `test/static.test.ts:42-71` e `:439-467` usam `toMatchObject` e apenas listam os cabeçalhos esperados, então o novo `Accept-Ranges` **não** os quebra; o teste de `:600-617` permanece válido (200 mantém a regra "ausente"). Os casos de fixture com `size` válido passam a receber `Accept-Ranges`; opcionalmente acrescentar `"accept-ranges": "bytes"` ao `expectedHeaders` (`:33-40` e `:431-437`) sem remover nada. Os testes de segurança (`test/security.test.ts:243-395`) chamam `serveStatic` com e sem `size`; devem continuar passando sem alteração.

Verificação final: `pnpm vitest run test/static.test.ts`, `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`. Seguir o fluxo de bug/feature do AGENTS.md: escrever os testes primeiro e vê-los falhar antes de implementar.

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | "Sempre anunciar" (issue) vs "só com size" (D-03). | Adotada a leitura restritiva; confirmar com o autor da issue. |
| R-02 | `ReadableStream` não tem seek: ler e descartar o início custa tempo em arquivos grandes. | `Blob.slice`/`subarray` onde possível; no stream, cancelar o leitor ao atingir `end` para não ler o resto. Limitação documentada em comentário. |
| R-03 | `meta.size` incorreto produz `Content-Range`/`Content-Length` errados (corpo truncado). | Premissa registrada; o `serveStatic` não relê o tamanho real. |
| R-04 | `string` tratada em bytes UTF-8 exige codificar tudo em memória. | Aceito: strings já estão em memória; teste com multibyte. |
| R-05 | 416 mantém `Content-Type`/`Content-Encoding`/`ETag` do asset em `event.res.headers`. | RFC 9110 §15.5.17 não proíbe; mantido para não divergir do 200/304. Se um cliente reclamar, remover `Content-Encoding` no 416. |
| R-06 | Compressão dinâmica por middleware posterior invalida os offsets. | Fora de escopo (PRD); documentar em comentário que o `Range` vale para o conteúdo/`size` de `getMeta`. |
| R-07 | HEAD com Range não é obrigatório pela RFC. | Segue a issue; comportamento equivalente ao GET sem corpo. |
| R-08 | Regressão em precedência de condicionais. | O 304 continua antes do `Range` (D-02), com teste dedicado (RF-08). |
| R-09 | ETag fixture `w/123` (sem aspas) difere da sintaxe da RFC. | D-05 trata `w/` como fraco; testes de `If-Range` usam ETags com aspas. |
| R-10 | `static.ts` cresce além de 200 LoC. | Aceito por D-01 (helpers privados no módulo, exigência da issue). |
