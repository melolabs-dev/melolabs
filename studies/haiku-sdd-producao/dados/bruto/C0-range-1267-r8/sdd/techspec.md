# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue + contrato) e `sdd/prd.md` (RF-01 a RF-13). Norma: RFC 9110 §13.1.5 e §14.
Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `a547fb2`).

## 1. Resumo da abordagem

A mudança fica toda em `src/utils/static.ts`. Depois da avaliação de `isCacheMatch` (304) e do cálculo de `content-length`, `serveStatic` passa a:

1. anunciar `Accept-Ranges: bytes` quando o tamanho é conhecido (`size > 0`);
2. interpretar `Range` + `If-Range` com um helper privado, que devolve "sem range", "intervalo" ou "insatisfazível";
3. responder `416` sem ler o conteúdo, `206` com cabeçalhos coerentes (e sem `getContents` em `HEAD`), ou recortar o corpo devolvido por `getContents` para `GET`.

Nenhum arquivo além de `src/utils/static.ts` (código) e `test/static.test.ts` (testes) muda. `src/index.ts` não é tocado.

## 2. Decisões de arquitetura

### D-01 — Ponto de inserção no fluxo existente

- **Contexto:** o PRD (§4) manda manter a ordem: cabeçalhos de asset → `isCacheMatch` → range.
- **Alternativas:**
  - (a) tratar range antes do 304;
  - (b) tratar range depois do 304 e depois da definição de `content-length`, substituindo o bloco `HEAD`/`getContents`;
  - (c) extrair um segundo handler para respostas parciais.
- **Escolha: (b).** A RFC 9110 §13.2.2 põe `If-None-Match`/`If-Modified-Since` antes de `Range` e `If-Range` (RF-08). Assim a lógica entra entre `src/utils/static.ts:268` (cálculo de `content-length`) e `src/utils/static.ts:272` (ramo `HEAD`), sem reordenar nada do que já existe. (c) foi descartada: duplicaria a montagem de cabeçalhos feita em `src/utils/static.ts:227-266`.

### D-02 — `Accept-Ranges` só com tamanho conhecido

- **Alternativas:** (a) sempre anunciar, como diz a issue; (b) anunciar só se `size > 0`.
- **Escolha: (b).** O PRD (RF-01, RF-10) limita range a `size > 0` e a própria issue restringe o recurso a "asset size known". Anunciar suporte que depois é ignorado seria enganoso. A condição é a mesma que já decide `content-length` (`src/utils/static.ts:268`), então os dois cabeçalhos aparecem juntos. O cabeçalho é gravado depois do 304 (após `src/utils/static.ts:243-248`), portanto 304, 404 e 405 não o recebem (RF-12). Usa-se `event.res.headers.set`, como os demais cabeçalhos do arquivo.

### D-03 — Onde gravar `Content-Length`/`Content-Range` nas respostas 206 e 416

- **Alternativas:** (a) passar cabeçalhos no `init` do `HTTPResponse`; (b) gravar em `event.res.headers`.
- **Escolha: (b), com `set` incondicional.** Em `src/response.ts:201-204`, quando o valor retornado é um `HTTPResponse`, os cabeçalhos preparados (`event.res.headers`) são mesclados *por cima* dos de `HTTPResponse.headers` via `mergeHeaders` (`src/response.ts:243-252`, que usa `target.set`). Um `content-length` vindo de `options.headers` ficaria vencedor sobre o do `init`, violando RF-11. Gravando direto em `event.res.headers` com `set` (e não com a guarda `!get("content-length")` de `src/utils/static.ts:268`) o valor do intervalo prevalece. A diferença em relação à regra de `200` é deliberada: no `200` o teste `test/static.test.ts:600-617` exige que o valor do chamador vença; no `206`/`416` o valor do asset inteiro estaria errado.
- Status e `statusText` vão no `init` do `HTTPResponse` (`206 Partial Content`, `416 Range Not Satisfiable`), como o `304` em `src/utils/static.ts:244-247`. Como o retorno não é um `Response`, a regra de `src/response.ts:211-213` (cortar cabeçalhos em status ≥ 400) não se aplica e os cabeçalhos de `event.res` são preservados.

### D-04 — Recorte do corpo feito sobre o que `getContents` devolve

- **Alternativas:** (a) passar o intervalo a `getContents` (muda a API; fora de escopo no PRD §3); (b) recortar o `BodyInit` por tipo, dentro do módulo.
- **Escolha: (b).** Helper privado `sliceBody(body, start, end)` que devolve o corpo recortado ou `undefined` quando o tipo não é suportado:

  | Tipo de `body` | Recorte |
  | --- | --- |
  | `string` | `new TextEncoder().encode(body).subarray(start, end + 1)` (bytes UTF-8, não caracteres) |
  | `ArrayBuffer` | `new Uint8Array(body, start, len)` |
  | `ArrayBuffer.isView` (`Uint8Array`, `Buffer`, `DataView`...) | `new Uint8Array(body.buffer, body.byteOffset + start, len)` (sem cópia) |
  | `Blob`/`File` | `body.slice(start, end + 1)` |
  | `ReadableStream` | `TransformStream`/`ReadableStream` próprio que descarta `start` bytes, emite até `len` bytes e cancela a fonte ao terminar |
  | `URLSearchParams`, `FormData`, outros | não suportado → `undefined` |

  `len` é limitado ao tamanho real quando ele é conhecido de antemão (`subarray`/`slice` já limitam). No stream, chunks que não sejam `Uint8Array` fazem o stream falhar com `TypeError` (conteúdo inesperado, não há como contar bytes).
- **Tipo não suportado:** serve-se o `200` completo (degradação segura do PRD §4). Por isso a decisão `206` vs `200` só se fixa *depois* de recortar (ver D-05).

### D-05 — Ordem de cálculo em `GET` para permitir o fallback

- **Problema:** se os cabeçalhos de `206` fossem gravados antes do recorte e o tipo fosse não suportado, a resposta `200` sairia com `Content-Range` e `Content-Length` errados.
- **Escolha:** em `GET` com intervalo válido, ler `getContents(id)`, tentar `sliceBody`; só se devolver um corpo gravar `content-range`, `content-length` e retornar `206`. Caso contrário retornar o `200` original (cabeçalhos ainda intactos, incluindo `Accept-Ranges`). `416` e `HEAD` não leem conteúdo (RF-04, RF-05), então gravam os cabeçalhos imediatamente. Se `getContents` devolver `null`/`undefined`, mantém-se o comportamento atual (`200` com corpo `null`, `src/utils/static.ts:277`), sem tentar range.

### D-06 — Interpretação do cabeçalho `Range`

- **Alternativas:** (a) parser genérico de múltiplos intervalos que depois rejeita; (b) uma expressão regular de intervalo único.
- **Escolha: (b).** Função privada `parseRange(header, size)` com `^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$` (flag `i`, unidade sem diferenciar maiúsculas, RF-06). Resultado:
  - não casa (unidade ≠ `bytes`, vírgula/multi-range, não numérico, negativo, vazio, `bytes=`, ambos lados vazios) → ignorar (`undefined`);
  - `a-b` com `b < a` → ignorar (RF-06, `bytes=5-2`);
  - `a-` ou `a-b` com `a >= size` → insatisfazível (RF-05);
  - `-n` com `n === 0` → insatisfazível; `-n` com `n >= size` → `{0, size-1}`;
  - `a-b` com `b >= size` → `end = size-1`.
  Números são lidos com `Number`; valores acima de `Number.MAX_SAFE_INTEGER` perdem precisão, mas continuam caindo corretamente em "insatisfazível" (início) ou "limitado ao fim" (fim/sufixo). Múltiplos cabeçalhos `Range` chegam concatenados com `, ` por `Headers.get`, logo viram multi-range e são ignorados.

### D-07 — `If-Range` (RFC 9110 §13.1.5)

- **Alternativas:** (a) reutilizar `matchETag` de `src/utils/internal/cache.ts:11`; (b) comparação forte dedicada.
- **Escolha: (b).** `matchETag` usa comparação **fraca** (`opaqueTag` remove `W/` dos dois lados, `src/utils/internal/cache.ts:51-53`), exatamente o contrário do que RF-07 exige. Regras no helper privado `ifRangeAllows(headers, validators)`:
  - sem `If-Range` → permite;
  - valor que começa com `"` ou `W/` é ETag: permite só se o `etag` da resposta existir, nenhum dos dois começar com `W/` e as strings forem idênticas;
  - caso contrário é data: `Date.parse` do valor e do `Last-Modified` *da resposta*; permite só se ambos forem válidos e iguais em segundos (RF-07);
  - valor vazio/inválido ou asset sem validador → nega (o range é ignorado, `200`).
- **Fonte dos validadores:** `event.res.headers.get("etag")` e `get("last-modified")`, lidos depois de `src/utils/static.ts:234-241`. Assim valem tanto os de `meta` quanto os de `options.headers` (premissa do PRD §4). Para a data isso difere do rascunho do PRD ("reaproveitar `mtimeDate`"): o cabeçalho cobre também `last-modified` vindo de `options.headers`, e quando vem de `meta` é o mesmo valor já truncado em `src/utils/static.ts:232`. `If-Range` só é avaliado quando há `Range` sintaticamente válido (D-06); com `Range` ignorado ele também é ignorado.
- `isCacheMatch` não muda; continua exportado só internamente.

### D-08 — Helpers privados, sem exportação nova

- **Escolha:** `parseRange`, `ifRangeAllows`, `sliceBody` (e um tipo local do resultado) ficam na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`. Não se cria `src/utils/internal/range.ts`: o pedido fala em lógica "privada dentro do módulo" e o PRD (RF-13) diz "seção `Internal Utils`". O arquivo hoje tem 351 linhas, acima da meta de 200 do AGENTS.md; a regra cede ao requisito explícito do pedido. `src/index.ts:193` (`export { type ServeStaticOptions, type StaticAssetMeta, serveStatic }`) fica intacto, assim como a forma de `StaticAssetMeta` (`src/utils/static.ts:9-15`) e `ServeStaticOptions` (`src/utils/static.ts:17-66`).
- Com `isolatedDeclarations`, funções não exportadas não exigem anotação, mas as assinaturas abaixo trazem tipos explícitos por clareza.

### D-09 — `HEAD`

- **Escolha:** `HEAD` com intervalo válido devolve `206` com `Content-Range` e `Content-Length` do `GET`, `HTTPResponse(null, …)`, sem chamar `getContents` (RF-04). `HEAD` com intervalo insatisfazível devolve `416`. `src/response.ts:350-356` (`nullBody`) já garante corpo nulo para `HEAD`.

## 3. Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `:268-270` (bloco `content-length`) | calcular `size` conhecido; gravar `accept-ranges: bytes` quando `size > 0` |
| `src/utils/static.ts` | `:272-277` (ramo `HEAD` + `getContents`) | inserir a resolução de range (D-05/D-09) antes do `200` atual, que permanece como caminho padrão |
| `src/utils/static.ts` | `:280` em diante (`Internal Utils`) | adicionar `parseRange`, `ifRangeAllows`, `sliceBody` |
| `test/static.test.ts` | novo `describeMatrix("serve static range", …)` ao final, mais ajustes do §5 | cobertura RF-01…RF-12 |

Não mudam (só referência): `src/utils/internal/cache.ts:29` (`isCacheMatch`), `src/response.ts:96` (`HTTPResponse`) e `src/response.ts:243` (`mergeHeaders`), `src/index.ts:193`, `test/unit/package.test.ts:133` (lista de exportações públicas, serve de guarda de RF-13).

Documentação: `docs/2.utils/2.response.md:39-49` descreve `serveStatic`; acrescentar um parágrafo curto sobre Range é opcional e não faz parte do contrato (o pedido não exige).

## 4. Contratos e assinaturas

```ts
// Tudo privado em src/utils/static.ts (seção Internal Utils)

type ByteRange = { start: number; end: number }; // ambos inclusivos, 0 <= start <= end < size

/** `undefined` = ignorar o Range (serve 200); `"unsatisfiable"` = 416. */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined;

/** Avalia If-Range com comparação forte. `true` quando ausente ou satisfeito. */
function ifRangeAllows(
  headers: Headers,
  validators: { etag: string | null; lastModified: string | null },
): boolean;

/** `undefined` quando o tipo de corpo não é suportado (cai no 200 completo). */
function sliceBody(body: BodyInit, range: ByteRange): BodyInit | undefined;
```

Fluxo em `serveStatic` (pseudocódigo do trecho substituído):

```ts
const size = meta.size !== undefined && meta.size > 0 ? meta.size : undefined;
// ...content-length como hoje...
if (size) event.res.headers.set("accept-ranges", "bytes");

const range =
  size && ifRangeAllows(event.req.headers, { etag: res.get("etag"), lastModified: res.get("last-modified") })
    ? parseRange(event.req.headers.get("range"), size)
    : undefined;
```

Ordem importante: `parseRange` primeiro decide "Range válido?"; `If-Range` só entra se o resultado não for `undefined`. Na implementação, chamar `parseRange` e só então `ifRangeAllows` (o pseudocódigo acima é só ilustrativo).

Tabela de respostas:

| Situação | Status | Cabeçalhos extras (via `event.res.headers.set`) | Corpo |
| --- | --- | --- | --- |
| sem range / ignorado / sem `size` | 200 | `accept-ranges` (só com `size`) | completo, como hoje |
| intervalo válido, `GET` | 206 `Partial Content` | `content-range: bytes s-e/size`, `content-length: e-s+1` | `sliceBody(...)` |
| intervalo válido, `HEAD` | 206 | idem | nenhum; `getContents` não é chamado |
| insatisfazível | 416 `Range Not Satisfiable` | `content-range: bytes */size`, `content-length: 0` | nenhum; `getContents` não é chamado |
| 304, 404, 405, fallthrough | inalterado | nenhum de range | inalterado |

`ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary` e os de `options.headers` permanecem (RF-09, RF-11). O `size` usado é o do `meta` da variante escolhida no laço de `src/utils/static.ts:200-208`, então RF-09 sai sem código extra.

## 5. Estratégia de testes

Seguir o fluxo de correção de bug do AGENTS.md: escrever os testes de range primeiro, confirmar que falham, implementar, confirmar que passam, rodar a suíte inteira. Usar `describeMatrix` (`test/_setup.ts:11`, `test/static.test.ts:5`) para rodar em `web` e `node`.

**Novo bloco** `describeMatrix("serve static range", …)` em `test/static.test.ts`, com asset de 10 bytes `0123456789`, `size: 10`, `etag: '"v1"'`, `mtime` fixo, e `getContents` como `vi.fn` (para verificar chamadas):

| Teste | RF |
| --- | --- |
| `GET`/`HEAD` sem `Range` → `200` + `Accept-Ranges: bytes` + corpo inteiro | RF-01 |
| `bytes=2-5` → `206`, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` | RF-02 |
| `bytes=7-`, `-3`, `8-99`, `-99` → `7-9`, `7-9`, `8-9`, `0-9` e comprimentos 3/3/2/10 | RF-03 |
| `HEAD` + `bytes=2-5` → `206`, mesmos cabeçalhos, sem corpo, `getContents` não chamado | RF-04 |
| `bytes=10-` e `bytes=-0` → `416`, `bytes */10`, `Content-Length: 0`, `getContents` não chamado | RF-05 |
| `bytes=0-1,4-5`, `5-2`, `items=0-1`, `abc`, `bytes=`, `BYTES=2-5` (este deve dar `206`) | RF-06 |
| `If-Range`: ETag igual → `206`; `"v2"`, `W/"v1"` → `200`; asset com ETag fraca → `200`; data igual ao `Last-Modified` → `206`; data diferente/inválida → `200`; asset sem validador → `200` | RF-07 |
| `Range` + `If-None-Match: "v1"` → `304`, sem `Content-Range` | RF-08 |
| `encodings: { gzip: ".gz" }`, `/app.js.gz` com `size: 20`, `Accept-Encoding: gzip`, `bytes=0-4` → `206`, `Content-Encoding: gzip`, `bytes 0-4/20`, `Vary: accept-encoding` | RF-09 |
| `getMeta` sem `size` e `size: 0` + `Range` → `200` sem `Content-Range` e sem `Accept-Ranges` | RF-10 |
| `options.headers: { "content-length": "10" }` + `bytes=2-5` → `Content-Length: 4`; ETag/Last-Modified/Content-Type iguais aos do `200`; `416` também ignora o `content-length` do chamador | RF-11 |
| `Range` em asset inexistente → `404`; com `fallthrough` → próximo handler sem cabeçalhos de range; `POST` + `Range` → `405` com `Allow: GET, HEAD` | RF-12 |
| Tipos de corpo: `string` com caractere multibyte (`"héllo"`, `size` em bytes UTF-8), `Uint8Array` com `byteOffset` ≠ 0, `Blob`, `ReadableStream` (vários chunks, intervalo cruzando chunks e cancelamento), `ArrayBuffer`; tipo não suportado (`URLSearchParams`) → `200` completo sem `Content-Range` | D-04/D-05 |

**RF-13 (sem exportação nova):** `test/unit/package.test.ts:133` já lista as exportações públicas; rodar esse teste. Não criar teste novo para isso.

**Testes existentes:** os de `test/static.test.ts` usam `toMatchObject` em cabeçalhos (`:53`, `:69`, `:450`, `:466`), então o novo `Accept-Ranges` não os quebra. Por inspeção, nenhum precisa de ajuste. Se `pnpm vitest run test/static.test.ts test/security.test.ts` mostrar uma falha por esse motivo, ajustar só a afirmação afetada. Vale conferir o teste de `content-length` do chamador (`test/static.test.ts:600-617`): ele usa `HEAD` sem `Range` e continua devolvendo `999`.

**Comandos de verificação:** `pnpm vitest run test/static.test.ts`, `pnpm vitest run test/security.test.ts`, `pnpm vitest run test/unit/`, depois `pnpm test` (inclui `pnpm lint`, com `oxlint`/`oxfmt`, e typecheck).

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `meta.size` diferente do tamanho real do corpo | `Content-Length`/`Content-Range` inconsistentes; a conexão pode ser cortada ou ficar pendente | Tratar `meta.size` como contrato do `getMeta` (premissa do PRD). Para tipos de tamanho conhecido, `subarray`/`slice` limitam ao corpo real; `Content-Length` continua vindo do intervalo calculado. Documentar nos testes. Alternativa mais defensiva (comparar `byteLength` com `size` e cair em `200`) foi descartada para não contradizer o PRD, mas fica registrada como melhoria possível. |
| `string` com `size` em caracteres em vez de bytes | recorte errado em texto multibyte | Recortar sobre bytes UTF-8 (D-04); teste com caractere multibyte |
| Stream: descartar `start` bytes lê o início inteiro da fonte | custo O(start) por pedido | Aceito (PRD: leitura parcial otimizada fora de escopo); só um intervalo, sem `multipart`, então não há amplificação |
| Stream: cancelamento do cliente deixa a fonte aberta | vazamento de handle/arquivo | Propagar `cancel` à fonte e cancelá-la ao atingir `len`; teste de cancelamento |
| `Range` malformado/enorme | número impreciso | Tratado em D-06; resultado sempre cai em "ignorar", "insatisfazível" ou "limitado ao fim" |
| Conflito com `content-length` de `options.headers` | cabeçalho do asset inteiro em `206` | `set` incondicional em `206`/`416` (D-03), com teste |
| `If-Range` com ETag fraca ou data com milissegundos | `206` indevido | Comparação forte própria (D-07) e truncamento a segundos; testes para cada caso |
| Cabeçalho `Accept-Ranges` em resposta de `options.headers` do chamador que já o define (por exemplo `none`) | sobrescrita | Gravar com `set` apenas se o chamador não definiu (`!headers.has("accept-ranges")`), seguindo a regra de `etag` em `src/utils/static.ts:239` |
| `serveStatic` com `Range` em `GET` onde o app já usa cache de CDN/`Vary` | respostas 206 cacheadas por CDN sem `Vary: Range` | Comportamento correto pela RFC 9110 (CDN trata `Range` por conta própria); nenhum `Vary: Range` é adicionado |
| Arquivo `static.ts` passa de ~350 para ~500 linhas | conflito com a meta de < 200 LoC do AGENTS.md | Aceito por exigência do pedido (D-08); se a revisão preferir, os helpers podem ir para `src/utils/internal/range.ts` sem alterar o contrato público |

## 7. Fora de escopo (confirmado)

`multipart/byteranges`; unidades ≠ `bytes`; novas opções em `ServeStaticOptions` ou campos em `StaticAssetMeta`; passar o intervalo a `getContents`; range em outros utilitários; alterações de cache, encoding, `fallthrough`, 404 e 405.
