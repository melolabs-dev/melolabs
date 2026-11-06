# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md`, `sdd/prd.md` (RF-01 a RF-11). Norma: RFC 9110 §13.1.5 e §14. Todas as citações de linha abaixo se referem ao código atual (antes da mudança).

## 1. Estado atual (conferido no código)

O fluxo de `serveStatic` em `src/utils/static.ts:101-278` é linear:

1. copia `options.headers` para `event.res.headers` (`src/utils/static.ts:105-114`);
2. rejeita métodos que não sejam GET/HEAD com `405` + `Allow` ou `undefined` com `fallthrough` (`src/utils/static.ts:116-122`);
3. rejeita caminho não canônico (`src/utils/static.ts:142-147`);
4. escolhe o asset/variante via `idSearchPaths` + `getMeta` (`src/utils/static.ts:198-208`), com `404`/`fallthrough` em `src/utils/static.ts:210-215`;
5. define `vary` (`src/utils/static.ts:220-225`), `last-modified` (`src/utils/static.ts:227-237`) e `etag` (`src/utils/static.ts:239-241`);
6. devolve `304` se `isCacheMatch` casar (`src/utils/static.ts:243-248`);
7. define `content-type` (`src/utils/static.ts:250-262`), `content-encoding` (`src/utils/static.ts:264-266`) e `content-length` a partir de `meta.size`, sem sobrescrever valor já existente (`src/utils/static.ts:268-270`);
8. HEAD devolve `HTTPResponse(null, {status: 200})` (`src/utils/static.ts:272-274`); GET chama `getContents` e devolve `HTTPResponse(contents || null, {status: 200})` (`src/utils/static.ts:276-277`).

Fatos de infraestrutura que condicionam o projeto:

- `prepareResponse` mescla `event.res.headers` **por cima** dos cabeçalhos do `HTTPResponse` (`src/response.ts:195-205`, `mergeHeaders` em `src/response.ts:243-252`). Logo, escrever em `event.res.headers` sobrescreve qualquer `content-length` anterior, inclusive o de `options.headers`; o `HTTPResponse` só serve para carregar status e corpo.
- Para HEAD e status 304 o corpo é descartado em `nullBody` (`src/response.ts:350-356`); para `206`/`416` em GET o corpo é mantido.
- `isCacheMatch` está em `src/utils/internal/cache.ts:29-49`; `matchETag` usa comparação **fraca** (`src/utils/internal/cache.ts:11-17`) e não serve para `If-Range`, que exige comparação forte.
- `src/index.ts:193` exporta apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic` de `static.ts`; o snapshot de exports está em `test/unit/package.test.ts:4`.
- O `Accept-Ranges` novo não quebra as asserções existentes: `test/static.test.ts:53`, `:69`, `:450` e `:466` usam `toMatchObject`, que tolera cabeçalhos extras. Nenhum teste existente precisa mudar, salvo se a verificação final provar o contrário.
- O teste `test/static.test.ts:600-617` fixa que um `content-length` de `options.headers` vence o derivado de `meta.size` na resposta `200`. Esse comportamento é preservado (só `206`/`416` sobrescrevem).

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica: dentro de `static.ts`, helpers privados

**Alternativas:** (a) novo módulo `src/utils/internal/range.ts` exportando funções para uso interno; (b) funções privadas no próprio `static.ts`, junto da seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Escolha: (b).** A issue pede "manter toda a lógica auxiliar privada dentro do módulo serveStatic" e RF-10 exige que `static.ts` não ganhe nomes exportados. Um módulo `internal/` não violaria `src/index.ts`, mas aumentaria a superfície de `export` do repositório sem necessidade, e o `AGENTS.md` prefere helpers internos no fim do arquivo. Custo: `static.ts` passa de 350 para cerca de 550 linhas, acima da meta "< 200 LoC" do AGENTS.md (já excedida hoje, 351 linhas). Aceito, porque o requisito explícito do pedido prevalece sobre a meta de estilo.

### D-02 — Ponto de inserção no fluxo: depois do `304`, antes de `content-type`

**Alternativas:** (a) avaliar Range antes de `isCacheMatch`; (b) avaliar logo depois do `304` (`src/utils/static.ts:248`) e antes de definir `content-type`/`content-encoding`/`content-length` (`src/utils/static.ts:250-270`); (c) avaliar só no final, antes de `getContents` (`src/utils/static.ts:276`).

**Escolha: (b).** (a) violaria RF-07 (o `304` deve prevalecer). (c) obrigaria a desfazer `content-type`/`content-encoding` já escritos em `event.res.headers` para montar o `416` (RF-04 diz que eles não se aplicam). Em (b) o `416` retorna antes de escrever esses dois cabeçalhos; `ETag`, `Last-Modified` e `Vary` já foram escritos e são preservados, como pede RF-04. O `Content-Type`/`Content-Encoding` vindos de `options.headers` (copiados na linha 105-114) **não** são removidos: são cabeçalhos do operador, não "do asset"; ver risco R-05.

Sequência alvo após a mudança:

1. (inalterado) linhas 105-248, até o `304`;
2. `rangeable = event.req.method` é GET/HEAD (sempre, aqui) e `meta.size !== undefined && meta.size > 0`; se `rangeable`, `event.res.headers.set("accept-ranges", "bytes")` (RF-01). Fica depois do `304` para que o `304` continue idêntico ao de hoje (RF-09);
3. se `rangeable`, `const range = resolveRange(event.req.headers, meta.size, event.res.headers)` (D-03/D-04);
4. `range.kind === "unsatisfiable"` → `416` (D-06), retorno imediato;
5. `content-type` e `content-encoding` (inalterados, linhas 250-266);
6. caminho `satisfiable`: HEAD → `206` sem corpo (D-06); GET → `getContents` e fatiamento (D-05);
7. caminho completo (sem range, range ignorado ou fallback): `content-length` por `meta.size` como hoje (`src/utils/static.ts:268-270`), HEAD → `200` sem corpo, GET → `200` com `contents`.

O bloco de `content-length` (`src/utils/static.ts:268-270`) passa a rodar só no caminho completo, depois da decisão de fallback do corpo; assim, o fallback de D-05 mantém o `content-length` original e o `206` define o seu.

### D-03 — Parse do `Range`: gramática estrita de um único intervalo, resultado em três estados

**Alternativas:** (a) regex única `^bytes=(\d*)-(\d*)$`; (b) tokenizador manual que aceita espaços e múltiplos intervalos para depois rejeitá-los; (c) regex estrita com `trim()` e validação numérica segura.

**Escolha: (c).** Aceita `bytes=a-b`, `bytes=a-`, `bytes=-n` (sem espaço, unidade `bytes` sem diferenciar maiúsculas, conforme RFC 9110 §14.1: nomes de unidade são case-insensitive). Retorna:

- `"ignore"`: sintaxe inválida, unidade diferente de `bytes`, vírgula (multi-intervalo), `bytes=-` (nem início nem fim), início > fim (`bytes=5-2`), número que não é inteiro seguro (`Number.isSafeInteger`) → resposta completa (RF-03);
- `"unsatisfiable"`: início ≥ tamanho, ou sufixo `bytes=-0` (RF-04);
- `{ start, end }`: intervalo satisfazível já normalizado, com `end` limitado a `size - 1` e sufixo maior que o tamanho cobrindo `[0, size-1]` (RF-02).

Detalhes: `bytes=a-b` com `a ≤ b` e `a ≥ size` é `unsatisfiable`, não `ignore` (RFC 9110 §14.1.2). O teste `início > fim` vem **antes** do teste contra o tamanho, de modo que `bytes=50-2` é ignorado, não 416. Números com mais de 15 dígitos ou não seguros → `ignore` (evita imprecisão de ponto flutuante gerando `Content-Range` errado). Uma regex ancorada sem backtracking perigoso (`\d+`, sem aninhamento) evita ReDoS.

### D-04 — `If-Range`: comparação forte de ETag ou igualdade exata de data

**Alternativas:** (a) reutilizar `matchETag` de `src/utils/internal/cache.ts:11`; (b) função privada nova com comparação forte; (c) tratar `If-Range` como `If-Match`/`If-Unmodified-Since` reaproveitando `isCacheMatch`.

**Escolha: (b).** `matchETag` faz comparação fraca (`src/utils/internal/cache.ts:15-16`), contrária ao §13.1.5 ("MUST use the strong comparison function"); `isCacheMatch` usa `>=` para datas, enquanto `If-Range` exige igualdade. Regra de `evalIfRange(value, resp)`:

- valor vazio/ausente → sem condição (Range segue);
- se o valor começa com `"` ou `W/`/`w/`: é ETag. Casa só se o ETag da resposta (`event.res.headers.get("etag")`, que já inclui `meta.etag` e eventual cabeçalho de `options.headers`) existir, nenhum dos dois for fraco e os dois forem textualmente iguais. O prefixo fraco é testado sem diferenciar maiúsculas (`w/`), porque os testes existentes usam `etag: "w/123"` (`test/static.test.ts:15`) e tratar isso como forte serviria um intervalo sobre um validador que o autor quis fraco;
- caso contrário é data: faz `Date.parse` do valor e do `last-modified` da resposta (`event.res.headers.get("last-modified")`); casa só se ambos forem válidos e os instantes forem iguais. Valor inválido, resposta sem `last-modified`, ou data diferente → não casa;
- não casa → `ignore` (200 completo); casa → segue para o intervalo.

`If-Range` só é lido se o `Range` for elegível (parse ≠ `ignore`) (RF-06: "`If-Range` sem `Range` é ignorado"). Para um `Range` insatisfazível com `If-Range` que casa → `416`; com `If-Range` que não casa → `200` completo (§13.1.5: a condição vem antes).

Usar `event.res.headers` como fonte do validador (e não `meta` direto) garante que o `If-Range` se refira exatamente ao validador que o cliente receberá na resposta, como o PRD pede ("`Last-Modified` da resposta").

### D-05 — Fatiamento do corpo por tipo de `BodyInit`, com validação e fallback para 200

**Alternativas:** (a) sempre ler tudo para `Uint8Array` e fatiar; (b) fatiar por tipo preservando o formato (Blob → `slice`, stream → transformação); (c) pedir ao backend leitura parcial (novo `getContents(id, range)`).

**Escolha: (b).** (a) carrega arquivos de vídeo inteiros em memória, o que anula o sentido da feature para `Blob`/`File`/stream. (c) está fora de escopo (PRD §3: não mudar `getMeta`/`getContents`).

Função privada `sliceBody(contents, start, end, size): BodyInit | undefined` (retorna `undefined` quando não consegue fatiar com segurança):

| Tipo devolvido | Fatiamento |
| --- | --- |
| `string` | `new TextEncoder().encode(s)`; se `byteLength !== size` → `undefined`; senão `subarray(start, end + 1)` |
| `Blob`/`File` | se `blob.size !== size` → `undefined`; senão `blob.slice(start, end + 1)` (preserva `File` lazy no Node) |
| `ArrayBuffer`/`SharedArrayBuffer` | se `byteLength !== size` → `undefined`; senão `new Uint8Array(buf, start, len)` |
| `ArrayBufferView` (`TypedArray`/`DataView`) | usa `byteOffset/byteLength`; se `byteLength !== size` → `undefined`; senão `new Uint8Array(buffer, byteOffset + start, len)` |
| `ReadableStream` | novo `ReadableStream` (pull) sobre o reader original: descarta os `start` primeiros bytes (cortando o chunk que cruza a fronteira), emite até `len` bytes, ao terminar chama `reader.cancel()` e fecha; `cancel` do consumidor propaga `reader.cancel()`; chunks que não são `Uint8Array` → erro do stream |
| `FormData`, `URLSearchParams`, outros | `undefined` |

A checagem `byteLength !== size` converte o risco "`size` mentiroso" (PRD §4) em fallback `200` completo para os tipos materializados, em vez de um `206` incoerente. Para stream não há como validar de antemão (limitação documentada, R-02).

Quando `sliceBody` devolve `undefined` ou `getContents` devolve vazio (`null`/`undefined`/`""`): resposta `200` completa idêntica à de hoje, sem `Content-Range` (RF-08). Para isso o `accept-ranges` já definido no passo 2 permanece (o asset suporta intervalos em geral).

### D-06 — Montagem das respostas 206 e 416

**Alternativas:** (a) lançar `HTTPError({status: 416})`; (b) devolver `HTTPResponse` com status e cabeçalhos via `event.res.headers`; (c) devolver `HTTPResponse` com cabeçalhos próprios no `init`.

**Escolha: (b).** `HTTPError` (a) geraria corpo JSON de erro e descartaria cabeçalhos de sucesso (em `prepareResponse` erros recebem só `errHeaders`, `src/response.ts:211-213`), contrariando RF-04 (corpo vazio, `ETag`/`Vary` preservados). (c) seria sobrescrito por `event.res.headers` na mescla (`src/response.ts:243-252`), então não garante o valor de `content-length` quando `options.headers` o definiu. Com (b):

- **206:** `event.res.headers.set("content-range", \`bytes ${start}-${end}/${size}\`)` e `set("content-length", String(end - start + 1))` (sempre `set`, nunca "se vazio", para vencer `options.headers`); `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`; para HEAD, `body = null` e `getContents` não é chamado (RF-05).
- **416:** `set("content-range", \`bytes */${size}\`)`, `set("content-length", "0")`; `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`. Nesse retorno antecipado `content-type`/`content-encoding` do asset não foram escritos (D-02). Para GET e HEAD o comportamento é o mesmo (corpo vazio).
- Nota: `HTTPResponse` para status 416 passa por `sanitizeStatusCode` (`src/response.ts:195-196`) sem alteração; o ramo `val.status >= 400` de `src/response.ts:211` só vale para `Response` nativo, não para `HTTPResponse`, portanto os cabeçalhos preparados continuam sendo mesclados. Confirmar no teste (cabeçalho `etag` presente no 416).

### D-07 — Sem exportações novas e sem mudança de tipos públicos

Nenhuma mudança em `src/index.ts`, `ServeStaticOptions` nem `StaticAssetMeta` (RF-10). Funções novas ficam sem `export`; tipos auxiliares (`type ByteRange`) também sem `export`. Com `isolatedDeclarations` (AGENTS.md), funções não exportadas não exigem anotação de retorno, mas serão anotadas para seguir o estilo de `parseAcceptEncoding` (`src/utils/static.ts:292`). Verificação: comparar `grep -n "^export" src/utils/static.ts` antes/depois e rodar `test/unit/package.test.ts`.

### D-08 — `Accept-Ranges` só quando o tamanho é conhecido

**Alternativas:** (a) sempre anunciar `Accept-Ranges: bytes` (literal da issue); (b) anunciar só com `size > 0` (PRD, premissa §4).

**Escolha: (b)**, conforme RF-01/RF-09 e a premissa do PRD (não prometer o que não se cumpre). Mudar para (a) é remover a condição na etapa 2 de D-02. O cabeçalho é omitido nos caminhos `304`, `404`, `405` e asset sem `size`.

## 3. Arquivos a alterar

| Arquivo | Local | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `src/utils/static.ts:243-278` | inserir etapas 2-4 de D-02 após o `304` (linha 248); mover o bloco de `content-length` (`:268-270`) para o caminho completo; ramificar HEAD (`:272-274`) e GET (`:276-277`) em 206/200 |
| `src/utils/static.ts` | `src/utils/static.ts:280` (seção `// --- Internal Utils ---`) | acrescentar `resolveRange`, `parseRange`, `ifRangeMatches`, `sliceBody`, `sliceStream` (privadas) |
| `test/static.test.ts` | após `test/static.test.ts:394` (fim do primeiro `describeMatrix`) e/ou novo `describeMatrix("serve static range", ...)` ao final | testes de Range (seção 5) |
| `docs/4.examples/serve-static-assets.md` | após `docs/4.examples/serve-static-assets.md:69` | (opcional) nota curta: `size` deve ser exato; `Range` suportado para um único intervalo |

Não alterar: `src/index.ts:193`, `src/response.ts`, `src/utils/internal/cache.ts`, `test/unit/package.test.ts`.

## 4. Contratos e assinaturas (todos privados em `src/utils/static.ts`)

```ts
type ByteRange = { start: number; end: number }; // inclusivos, já normalizados

type RangeResult = ByteRange | "unsatisfiable" | undefined; // undefined = ignorar o Range

/** Avalia Range + If-Range da requisição contra o tamanho e os validadores da resposta. */
function resolveRange(reqHeaders: Headers, resHeaders: Headers, size: number): RangeResult;

/** Parse de um único intervalo `bytes=`; "invalid" cobre sintaxe, unidade, multi-intervalo, início>fim. */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | "invalid";

/** If-Range (RFC 9110 §13.1.5): ETag forte idêntico ou data exatamente igual ao Last-Modified. */
function ifRangeMatches(value: string, resHeaders: Headers): boolean;

/** Recorta o corpo; `undefined` quando o tipo não é fatiável com segurança ou o tamanho diverge. */
function sliceBody(body: BodyInit, range: ByteRange, size: number): BodyInit | undefined;

/** ReadableStream que descarta `start` bytes e termina após `end`. */
function sliceStream(source: ReadableStream<Uint8Array>, range: ByteRange): ReadableStream<Uint8Array>;
```

Contrato de respostas (tamanho = `meta.size` do asset escolhido):

| Situação | Status | Cabeçalhos relevantes | Corpo |
| --- | --- | --- | --- |
| sem Range / ignorado / fallback | 200 | `Accept-Ranges: bytes` (se `size>0`), `Content-Length: size` (como hoje) | completo |
| Range válido | 206 | `Content-Range: bytes s-e/size`, `Content-Length: e-s+1`, `Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary` | só o trecho (vazio em HEAD) |
| insatisfazível | 416 | `Content-Range: bytes */size`, `Content-Length: 0`, `ETag`, `Last-Modified`, `Vary`; sem `Content-Type`/`Content-Encoding` do asset | vazio |
| `If-None-Match`/`If-Modified-Since` casa | 304 | como hoje, sem `Content-Range` | vazio |
| asset sem `size` | 200 | sem `Accept-Ranges`, sem `Content-Range` | completo |

Tabela de verdade do `Range` (tamanho 10): `2-5` → 2..5; `7-` → 7..9; `-3` → 7..9; `8-99` → 8..9; `-99` → 0..9; `10-`, `50-60`, `-0` → 416; `5-2`, `0-1,4-5`, `abc`, `items=0-1`, `bytes=-`, `bytes=` → ignorado.

## 5. Estratégia de testes

Arquivo: `test/static.test.ts`, novo `describeMatrix("serve static range", (t, { it, expect }) => { ... })` (roda em `web` e `node`, RF-11). Fixture: asset de 10 bytes `0123456789`, `etag: "\"abc\""`, `mtime` fixo, `encodings: { gzip: ".gz" }` com variante `.gz` de tamanho distinto; `getContents` como `vi.fn` para provar que HEAD não o chama. Casos (cada um com `expect` do status, `content-range`, `content-length` e corpo):

1. RF-01: GET e HEAD sem Range → 200, `accept-ranges: bytes`, corpo e `content-length` iguais aos de hoje.
2. RF-02: `2-5`, `7-`, `-3`, `8-99`, `-99`, `0-0`, `9-9` (início, fim, sufixo, fim além, sufixo maior que o asset).
3. RF-02: `options.headers` com `content-length: "999"` → `206` traz o length correto do trecho.
4. RF-03: `0-1,4-5`, `abc`, `items=0-1`, `5-2`, `bytes=-`, valor com número gigante → 200 completo, sem `content-range`, `content-length: 10`.
5. RF-04: `10-`, `50-60`, `-0` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, `etag`/`last-modified`/`vary` presentes, `content-type` do meta ausente.
6. RF-05: HEAD com `2-5` → 206, `content-length: 4`, corpo vazio, `getContents` não chamado; HEAD com `10-` → 416.
7. RF-06: `If-Range` com ETag igual → 206; ETag diferente, `W/"abc"`, data diferente, data igual ao `Last-Modified` → (206 só no último), valor inválido → 200; `If-Range` sem `Range` → 200 normal; asset só com `mtime` e `If-Range` ETag → 200; 416 com `If-Range` que casa vs. não casa.
8. RF-07: `If-None-Match` casando + `Range` → 304 sem `content-range`; sem condicional, `Accept-Encoding: gzip` + Range → 206 da variante `.gz` com `content-encoding`, `vary` e `content-range` com o `size` da variante.
9. RF-08: `getContents` devolvendo `string`, `Uint8Array` (incluindo uma view com `byteOffset ≠ 0`), `ArrayBuffer`, `Blob`, `ReadableStream` (em chunks pequenos, para exercitar o corte no meio de um chunk) → todos `206` com `2345`; `FormData` → 200 completo; `null` → 200 vazio; string multibyte (UTF-8) com `size` correto → fatia por bytes; `size` divergente do conteúdo → 200 completo.
10. RF-09: asset sem `size` (e `size: 0`) com `Range: bytes=0-1` → 200 completo, sem `accept-ranges` nem `content-range`; 405 (POST), 404 e `fallthrough` sem avaliar Range; testes existentes sem alteração.
11. Mutação: os testes de 2, 5 e 7 devem falhar se o bloco de Range for removido (verificar manualmente com `git stash` do `static.ts`, RF-11).

Comandos de verificação: `pnpm vitest run test/static.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. O fluxo de bug-fix do AGENTS.md (teste falhando antes) vale aqui por analogia: escrever os testes primeiro, vê-los falhar, depois implementar.

## 6. Riscos

- **R-01 — `size` incorreto/desatualizado.** Para `string`/`Blob`/buffers, a validação de D-05 cai em `200` completo; para `ReadableStream` não há validação possível e o `Content-Length` pode divergir do corpo real. Mitigação: documentar que `size` deve ser exato; o stream é limitado a `len` bytes, nunca excede o `Content-Length` declarado.
- **R-02 — Custo de stream distante.** Descartar `start` bytes lê o arquivo desde o início. Recomendação na nota de docs: devolver `Blob`/`File` para fatiamento eficiente.
- **R-03 — Cancelamento de stream.** Se o cliente interromper, `cancel` precisa liberar o reader original (senão vaza descritor de arquivo). Cobrir com teste unitário do `sliceStream` (cancel propaga) e fechamento correto ao atingir `end`.
- **R-04 — Precisão numérica.** Valores > `Number.MAX_SAFE_INTEGER` poderiam produzir `Content-Range` errado; mitigado com `Number.isSafeInteger` em D-03.
- **R-05 — `content-type`/`content-encoding` em 416 vindos de `options.headers`.** Ficam, pois são cabeçalhos do operador aplicados desde o início (`src/utils/static.ts:105-114`). Um `Content-Length` do operador é sobrescrito. Se o dono do projeto quiser removê-los no 416, é um `headers.delete` no ramo 416.
- **R-06 — `Accept-Ranges` ausente no `304`.** Decisão deliberada (D-02) para manter o `304` byte a byte igual; o RFC permite e o cliente já aprendeu o suporte na resposta `200`. Reversível movendo o `set` para antes de `isCacheMatch`.
- **R-07 — `etag` fraco com minúscula (`w/`).** Tratado como fraco em `If-Range` (D-04), mais restritivo que a letra da RFC (case-sensitive `W/`); consequência: um `If-Range` com ETag `w/...` nunca casa. Aceito por segurança e coerência com os fixtures atuais.
- **R-08 — Interação com `onResponse` e adaptadores.** `206`/`416` com corpo `Blob`/stream/vazio precisam funcionar em Node e Web; coberto por `describeMatrix`. O `HTTPResponse` com `Blob` já é aceito hoje (corpo livre em `FastResponse`); validar que `Content-Length` explícito do `206` não conflita com o `Blob` fatiado no Node.
- **R-09 — Regressão em testes existentes.** Esperado nenhum ajuste (usam `toMatchObject`); se algum teste comparar o conjunto exato de cabeçalhos, ajustar apenas a asserção, mantendo o que ele verifica (RF-09).
- **R-10 — Meta de tamanho de arquivo.** `static.ts` ultrapassa a diretriz de < 200 LoC do AGENTS.md (D-01); decisão consciente, registrada aqui.
