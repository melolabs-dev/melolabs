# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue e contrato enxuto) e `sdd/prd.md` (requisitos RF-01 a RF-13, ordem de avaliação, premissas e riscos). Este documento não repete os requisitos; registra as decisões técnicas que os implementam, os arquivos a alterar, os contratos internos e a estratégia de testes.

Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests).

As linhas citadas (`arquivo:linha`) são do código atual, antes da mudança. Elas mudam conforme a implementação avança.

## 1. Verificações feitas no código

- `src/utils/static.ts` tem 352 linhas. `serveStatic` começa em `src/utils/static.ts:101`. Nenhum código de Range existe no projeto (busca por `range`, `accept-ranges` e `content-range` em `src/` sem resultado relevante fora de `src/rules/cache.ts`).
- `src/rules/cache.ts:146-148` já ignora requisições com `Range` no cache de regras (`isBypassedRequest`). Isso não conflita com a mudança: ocache não armazena respostas parciais. Fica fora de escopo, como diz o PRD.
- **Precedência de cabeçalhos (ponto crítico).** `prepareResponse` monta a resposta de um `HTTPResponse` com `mergeHeaders(res.headers, preparedHeaders)` (`src/response.ts:202`), onde `preparedHeaders` são os cabeçalhos de `event.res.headers`. Em `mergeHeaders` (`src/response.ts:243-252`) o segundo argumento sobrescreve o primeiro. Consequência: um `content-length` já gravado em `event.res.headers` pelo `src/utils/static.ts:268-270` vence um `content-length` passado no `init` do `HTTPResponse`. Por isso a decisão D-03.
- `HTTPResponse` com status ≥ 400 **não** é filtrado para só `errHeaders`: esse filtro (`src/response.ts:211`, no caminho de `val instanceof Response`) não se aplica ao ramo de `HTTPResponse`, que retorna antes, em `src/response.ts:189-202`, depois de `prepareResponseBody` tratar `HTTPResponse` em `src/response.ts:304`. Logo, cabeçalhos de `event.res.headers` chegam também ao 416. Isso precisa de teste de regressão (ver §5.2).
- `nullBody` (`src/response.ts:350`) zera o corpo em HEAD, 304 e 204/205. O corpo de HEAD já é suprimido pelo runtime, mas o `getContents` não pode ser chamado nesse caso (RF-04).
- `describeMatrix` (`test/_setup.ts:11`) expõe `it` como wrapper de `interceptFnWithSuffix` (`test/_setup.ts:206`), com `skip`, `skipIf`, `runIf` e `only`, **mas sem `it.each`**. Casos parametrizados precisam de laço `for` dentro do bloco.
- `test/static.test.ts` tinha 76 testes passando em uma execução anterior (2026-11-06). Esta revisão não rodou testes, por pedido explícito. Reconfirmar antes de começar a implementação. Todas as asserções de cabeçalho em `test/static.test.ts` usam `toMatchObject` (ex.: `test/static.test.ts:53`, `:69`, `:450`, `:466`), então um `accept-ranges` novo não quebra nenhum teste existente.
- Scripts: `package.json:46` define `lint` como `oxlint . && oxfmt --check .`. `package.json:54` define `typecheck` como `tsc --noEmit` separado. **`AGENTS.md:18` diz que `pnpm lint` faz "lint + typecheck", o que não é verdade.** Para verificar tipos é preciso rodar `pnpm typecheck`; `pnpm test` roda os dois. O PRD pedia essa confirmação.
- `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic` de `./utils/static.ts`. Nada novo deve ser adicionado nessa linha.
- `docs/2.utils/2.response.md:39` documenta `serveStatic` por meio de `automd` a partir do JSDoc de `src/utils/static.ts:68-100`. A documentação deve vir do JSDoc, não ser editada à mão.

## 2. Decisões de arquitetura

### D-01 — Lógica de Range fica em `src/utils/static.ts`, sem exportação

**Escolha.** Os helpers novos (`resolveRange`, `parseRange`, `ifRangeMatches`) ficam no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`.

**Alternativas.**
- (a) Mover para `src/utils/internal/range.ts`, seguindo a convenção de `AGENTS.md` ("helpers internos em `utils/internal/`") e a de `isCacheMatch`, que já vive em `src/utils/internal/cache.ts:29`.
- (b) Ficar em `static.ts`.

**Justificativa.** O texto da issue (`sdd/pedido.md:51`) e o contrato (`sdd/pedido.md:92`) pedem que "a lógica auxiliar fique privada ao módulo `serveStatic`". A alternativa (a) não viola a exportação pública, mas contraria o texto literal do pedido. Escolhemos (b). **Custo:** `static.ts` passa de 352 para cerca de 480 linhas, acima da meta de "< 200 LoC por arquivo" de `AGENTS.md`. O arquivo já estava acima da meta. Se o revisor preferir a convenção, a migração para `utils/internal/range.ts` é mecânica e não muda contratos. Ver §9.

### D-02 — Ordem de avaliação do PRD é a ordem do código

**Escolha.** Respeitar a ordem da seção "Ordem de avaliação" do PRD: método (405) → cache (304) → `If-Range` → sintaxe de `Range` → satisfazibilidade (416) → 206. A verificação de cache continua antes de qualquer leitura de `Range`.

**Onde no código.**
- Método: `src/utils/static.ts:116-122`, sem mudança.
- Cache: `src/utils/static.ts:243-248`, sem mudança de lógica. A decisão de `accept-ranges` (D-10) fica antes dela.
- Range: depois de `content-length` (`src/utils/static.ts:268-270`) e antes do bloco de HEAD (`src/utils/static.ts:272-274`).

**Justificativa.** O PRD define que um `If-Range` que não casa nunca vira 416 (PRD, "Ordem de avaliação", e risco "Ordem de If-Range e 416"). Com a ordem acima isso segue sem código extra: `resolveRange` checa `If-Range` antes de qualquer conta com o tamanho.

### D-03 — Cabeçalhos de Range vão em `event.res.headers`, não no `init` do `HTTPResponse`

**Escolha.** `Accept-Ranges`, `Content-Range` e `Content-Length` são gravados com `event.res.headers.set(...)`. O `HTTPResponse` recebe só `status` e `statusText`.

**Alternativas.**
- (a) Passar `headers` no `init` do `HTTPResponse` de 206/416.
- (b) Gravar em `event.res.headers`.

**Justificativa.** Por `src/response.ts:202` e `src/response.ts:243-252`, `event.res.headers` sobrescreve o `init`. Com (a), o `content-length` do arquivo inteiro (gravado em `src/utils/static.ts:269`) venceria silenciosamente e a resposta sairia com `Content-Length: 1000` em vez de `100`. Com (b), `set` sobrescreve o valor anterior e os três cabeçalhos chegam a 206, 304, 416 e HEAD pelo mesmo caminho. Esse caminho é o único que funciona para 416, porque o filtro `errHeaders` não se aplica a `HTTPResponse` (ver §1).

### D-04 — Análise sintática estrita com regex e `Number.isSafeInteger`

**Escolha.** Duas expressões regulares, sem espaço e sem sinal:
- `/^bytes=(\d+)-(\d*)$/` para `início-fim` e `início-`;
- `/^bytes=-(\d+)$/` para `-n`.

Cada número capturado passa por `Number(...)` e `Number.isSafeInteger`. `\d` em JavaScript é ASCII-only, então não há dígitos Unicode. Vírgula, unidade diferente, `fim < início` e número fora da faixa segura também tornam o `Range` malformado (RF-05, "dígitos demais"). Com `bytes=-0`, o número é 0 e vira 416, como manda RF-06.

**Sufixo grande demais.** Um `-n` com `n` fora da faixa segura é tratado como malformado (200 completo). A RFC 9110 §14.1.1 manda cobrir o arquivo inteiro nesse caso, com 206. A diferença troca só o status (200 em vez de 206), com o mesmo corpo. **A confirmar** (§9).

**Unidade.** Recomendação: aceitar `bytes` sem diferenciar maiúsculas de minúsculas. A RFC 9110 §14.1 trata o nome da unidade como `token`. O PRD diz "unidade não é `bytes`" e não fala em caixa. **A confirmar** (§9).

**Alternativa rejeitada.** Um parser manual com `split("-")` e `Number()` sem validação extra. Aceitaria `1e3`, `0x10` e `""`. A regex é mais curta e mais fácil de ler que essa validação.

### D-05 — `If-Range`: ETag forte e data por igualdade exata

**Escolha.** `ifRangeMatches` decide o tipo do validador pelo primeiro caractere, com comparação sensível a caixa:
- começa com `"` → entity-tag. Casa somente se o asset tem `etag`, o `etag` do asset não começa com `W/` e os dois são idênticos como string. Um `If-Range` que começa com `W/` nunca casa;
- qualquer outro valor → data. Casa somente se o asset tem `Last-Modified` (ou seja, `mtimeDate` existe) e o valor é **idêntico** à string que `serveStatic` grava em `Last-Modified`. O `If-Range` vazio cai aqui e não casa.

**Por que string e não `new Date(valor)`.** `new Date` aceita formatos que não são HTTP-date (`"2020"`, `"1"`), o que afrouxa a análise. RFC 9110 §13.1.5 pede igualdade exata com o `Last-Modified`. A comparação usa o `mtimeDate` já truncado a segundos (`src/utils/static.ts:227-232`), a mesma base do `Last-Modified`. Comparar com `meta.mtime` bruto daria falso negativo para mtimes com milissegundos.

**Custo.** Um cliente que converta a data para outro formato HTTP-date não casa e recebe 200 completo. É uma degradação segura, não erro.

Sem `Range`, `If-Range` é ignorado (RFC 9110 §13.1.5).

**Consistência com o código existente.** `opaqueTag` em `src/utils/internal/cache.ts:51` já trata `W/` com caixa alta, e `isCacheMatch` (`src/utils/internal/cache.ts:29`) é o precedente. Mantemos a mesma convenção. O fixture `etag: "w/123"` (`test/static.test.ts:15`) não tem aspas, não é um ETag válido e não é usado pelos casos novos. Os casos novos usam só ETags entre aspas.

### D-06 — Satisfazibilidade usa `meta.size`; GET só lê o corpo para montar 206

**Escolha.** 416 é decidido só com `meta.size`, antes de qualquer chamada a `getContents`. Vale para GET e HEAD, e por isso RF-04 ("`getContents` não é chamado") vale também para 416. `getContents` só é chamado para GET com 206 aplicável.

**Justificativa.** Premissa do PRD: `size` vem de `getMeta` e é a única fonte de tamanho (`sdd/prd.md:191`). Ler o corpo para decidir 416 seria custo sem ganho.

### D-07 — Recorte de GET: `arrayBuffer` do `Response` e `subarray`

**Escolha.** Para um 206 de GET:

```ts
const bytes = new Uint8Array(await new Response(contents).arrayBuffer());
```

O trecho é `bytes.subarray(start, end + 1)`. `new Response(BodyInit)` aceita `string`, `ArrayBuffer`, `ArrayBufferView`, `Blob`, `FormData`, `URLSearchParams` e `ReadableStream`, então um único caminho cobre todos os tipos de `BodyInit` (risco do PRD, "Fatiar `BodyInit` de tipos diferentes").

**Alternativas.**
- (a) Um ramo por tipo (`typeof string`, `instanceof ArrayBuffer`, `Blob.slice`, stream com leitor). Mais código e mais casos a testar, sem ganho de memória, porque qualquer stream já é lido inteiro para satisfazer o PRD ("Quando o `Range` é aplicado em GET, `getContents` é chamado por inteiro").
- (b) `Blob.slice`. Tem um efeito colateral: o `Blob` herda o `type` de `new Response(...).blob()`, que para string é `text/plain;charset=UTF-8`, e um `Response` com corpo `Blob` pode acrescentar `content-type` que não existia. Seria preciso passar `""` como terceiro argumento de `slice`. Evitado.

**Custo.** Memória: o asset inteiro fica em memória em cada GET com Range. Já aceito pelo PRD (premissa final). Ver R-03.

### D-08 — Divergência entre `size` e o corpo real: cai para 200 sem Range

**Escolha.** Depois de `bytes` ser lido, se `bytes.byteLength !== meta.size`, o `Range` não é aplicado: a resposta é 200 com o corpo lido (`bytes`), como hoje. Nenhum `Content-Range` sai com um total que não corresponde ao corpo.

**Alternativas.** (a) Usar `bytes.byteLength` como total no `Content-Range` (o PRD recomendou isso como "recomendado", `sdd/prd.md:203`). Isso faria o 416 e o 206 usarem tamanhos diferentes conforme o método (HEAD usa `size`, GET usa o real), e o `Content-Length` do 200 já é `size` hoje. (b) Gerar erro 500. Desproporcional.

**Justificativa.** Mantém HEAD e GET coerentes (ambos decidem com `size`) e trata a divergência da mesma forma que `size` ausente (RF-10). **Ponto a confirmar** (§9): o PRD sugeriu usar o tamanho real; esta escolha troca isso por consistência com HEAD.

### D-09 — `getContents` que devolve `null` com Range aplicável: 200 como hoje

**Escolha.** Se `getContents` devolve `null` ou `undefined` num GET com 206 aplicável, a resposta é o 200 atual (`new HTTPResponse(contents || null, { status: 200 })`, `src/utils/static.ts:277`). `Content-Range` não é gravado. `Accept-Ranges` já foi gravado (D-10).

**Justificativa.** Não há corpo para recortar (risco do PRD, "`getContents` devolve `null` com `size` conhecido"). Responder 416 seria mentir sobre a satisfazibilidade; 500 seria desproporcional.

### D-10 — `Accept-Ranges` segue o padrão de `etag` e `last-modified`

**Escolha.**

```ts
if (!event.res.headers.get("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
```

Colocado logo depois do bloco de `etag` (`src/utils/static.ts:239-241`) e antes da checagem de cache, para que 304 também receba o cabeçalho (RF-01).

**Justificativa.** Segue o padrão dos cabeçalhos já definidos por `serveStatic` (que respeitam o que o usuário pôs em `options.headers`). Um usuário que passe `accept-ranges: none` mantém a escolha. **Ponto a confirmar** se o cabeçalho deve ser sempre `bytes` (RF-01 diz "deve enviar `Accept-Ranges: bytes`"; §9).

### D-11 — `Content-Length` e `Content-Range` são sempre substituídos em 206 e 416

**Escolha.** Em 206 e 416, `content-length` e `content-range` são gravados com `set`, mesmo quando o usuário definiu `content-length` em `options.headers`. O teste existente em `test/static.test.ts:600-617` (`HEAD` sem Range, espera `999`) continua verdadeiro porque não há Range.

**Justificativa.** Premissa do PRD (`sdd/prd.md:196`). Um `Content-Length` do usuário que não batesse com o trecho corromperia a resposta.

### D-12 — Tamanho zero é desconhecido e ignora Range

**Escolha.** `meta.size` igual a 0 ou ausente desliga o Range, como RF-10. A checagem é `meta.size` truthy no ponto de decisão. O código atual já trata 0 como desconhecido (`src/utils/static.ts:268`: `meta.size > 0`).

**Consequência.** A RFC 9110 §14.1.1 manda 416 para `Range` em representação vazia, mas `size: 0` é indistinguível de "tamanho não informado" nessa API. **A confirmar** (premissa do PRD, `sdd/prd.md:192`).

### D-13 — Sem opção nova e sem alteração em `index.ts`

**Escolha.** `ServeStaticOptions` (`src/utils/static.ts:17-66`) não muda. `src/index.ts:193` não muda. Os tipos novos (`ByteRange`) ficam sem `export`.

**Justificativa.** RF-12 e a issue ("No API changes are required").

### D-14 — `If-Range` com ETag usa o ETag da variante servida

**Escolha.** Com `encodings`, `resolveRange` recebe como `etag` o mesmo valor que `serveStatic` põe em `ETag` na resposta da variante servida. O original não entra na comparação.

**Justificativa.** RF-09 e a premissa do PRD (`sdd/prd.md:194`): o intervalo e o validador referem-se à representação que foi enviada. Se a variante não tiver ETag próprio, R-05 vale: `If-Range` com ETag não casa e a resposta é 200. **A confirmar** no código que monta o ETag por variante (§9).

## 3. Arquivos a alterar

| Arquivo | Trecho | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `:68-100` (JSDoc de `serveStatic`) | Parágrafo curto sobre Range: 206/416/ignorado, `If-Range`, e que o corpo de GET é lido por inteiro. Fonte da documentação gerada (ver R-12). |
| `src/utils/static.ts` | `:239-241` | Gravar `accept-ranges: bytes` (D-10). |
| `src/utils/static.ts` | `:268-274` | Inserir a decisão de Range entre `content-length` e o bloco de HEAD (D-02). HEAD ganha ramo 206/416. |
| `src/utils/static.ts` | `:276-277` | GET: ramo de 206 com `getContents`, `toBytes` e fallback (D-07, D-08, D-09). O retorno de 200 atual fica como fallback. |
| `src/utils/static.ts` | `:280` em diante | Helpers privados: `resolveRange`, `parseRange`, `ifRangeMatches` (D-04, D-05). |
| `test/static.test.ts` | novo bloco `describeMatrix("serve static range", ...)` no fim do arquivo | Testes de §5.2. Nenhum teste existente deve mudar (§5.3). |
| `docs/2.utils/2.response.md` | `:39` (seção gerada) | Não editar à mão. Regenerar com `automd` após alterar o JSDoc (R-12). |

Não alterar: `src/index.ts`, `src/response.ts`, `src/rules/*`, `src/utils/internal/cache.ts`, `src/utils/proxy.ts`.

## 4. Contratos e assinaturas

Nenhum contrato público muda. Abaixo, a forma dos helpers privados (não exportados).

```ts
/** Intervalo inclusivo, já limitado a [0, size - 1]. */
interface ByteRange {
  start: number;
  end: number;
}

/** Validadores do asset usados por `If-Range`. */
interface RangeValidators {
  etag?: string;
  lastModified?: string;
}

/**
 * Decide o `Range` de uma requisição a um asset com tamanho conhecido.
 * - `undefined`: não há Range aplicável (sem cabeçalho, `If-Range` não casou, ou Range malformado) → 200.
 * - `"unsatisfiable"`: 416.
 * - `ByteRange`: 206 com o trecho.
 * Pré-condição: `size > 0`.
 */
function resolveRange(
  headers: Headers,
  validators: RangeValidators,
  size: number,
): ByteRange | "unsatisfiable" | undefined;

/** `If-Range` (RFC 9110 §13.1.5): comparação forte para ETag, igualdade exata para data. */
function ifRangeMatches(ifRange: string, validators: RangeValidators): boolean;

/**
 * Análise estrita de `bytes=...` para um único intervalo (RF-03, RF-05, RF-06).
 * - `undefined`: malformado ou múltiplo → ignorar.
 * - `"unsatisfiable"`: início além do fim ou sufixo zero.
 * - `ByteRange`: intervalo válido, limitado ao tamanho.
 */
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;
```

`RangeValidators.lastModified` é a string de `Last-Modified` já gravada na resposta, não um `Date`. Assim a comparação de D-05 usa a mesma forma que o cliente recebe.

**Cabeçalhos e status em cada caso** (todos gravados em `event.res.headers` salvo indicação):

| Caso | Status | Cabeçalhos | Corpo | `getContents` |
| --- | --- | --- | --- | --- |
| Sem Range / Range ignorado | 200 | `accept-ranges` (+ atuais) | completo | como hoje |
| `If-Range` não casa | 200 | `accept-ranges` | completo | como hoje |
| 206 GET | 206 `statusText: "Partial Content"` | `content-range: bytes s-e/size`, `content-length: n` | `bytes.subarray(s, e+1)` | chamado 1× |
| 206 HEAD | 206 | `content-range`, `content-length: n` | `null` | **não chamado** |
| 416 | 416 `statusText: "Range Not Satisfiable"` | `content-range: bytes */size`, `content-length: 0` | `null` | **não chamado** |
| 304 | 304 | `accept-ranges` | `null` | não chamado |

**Fluxo sugerido (pseudocódigo do trecho novo em `serveStatic`).**

```ts
if (!event.res.headers.get("accept-ranges")) event.res.headers.set("accept-ranges", "bytes"); // após etag

// ... cache (304), content-type, content-encoding, content-length como hoje ...

const range = meta.size ? resolveRange(event.req.headers, { etag: meta.etag, lastModified: lastModifiedValue }, meta.size) : undefined;

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range && event.req.method === "HEAD") {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
}

if (event.req.method === "HEAD") return new HTTPResponse(null, { status: 200 }); // como hoje

const contents = await options.getContents(id);
if (range && contents) {
  const bytes = new Uint8Array(await new Response(contents).arrayBuffer());
  if (bytes.byteLength === meta.size) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    event.res.headers.set("content-length", String(range.end - range.start + 1));
    return new HTTPResponse(bytes.subarray(range.start, range.end + 1), { status: 206, statusText: "Partial Content" });
  }
  return new HTTPResponse(bytes, { status: 200 }); // divergência de tamanho (D-08)
}
return new HTTPResponse(contents || null, { status: 200 });
```

Observações sobre o fluxo:
- `"unsatisfiable"` só existe quando `range` vem de `resolveRange`; a checagem de HEAD usa `range` como `ByteRange`. O tipo fica restrito pela própria forma do `if`.
- `event.req.method` já foi restrito a GET/HEAD por `src/utils/static.ts:116`.
- `lastModifiedValue` é a string que `serveStatic` grava em `Last-Modified`, calculada a partir de `mtimeDate`. Se não há `mtime`, é `undefined` e `If-Range` com data não casa (RF-07).
- No ramo de divergência (D-08), o `Content-Length` já gravado é `size`, como no código atual. Se `bytes.byteLength !== size`, esse valor não bate com o corpo. É comportamento pré-existente, fora do escopo, mas o revisor deve saber.
- Os dois blocos de `content-range`/`content-length` repetidos podem virar um helper local (`setRangeHeaders(event, range, size)`), mas o pseudocódigo deixa claro cada caso. Decisão de estilo do implementador.

## 5. Estratégia de testes

### 5.1 Ciclo de correção (AGENTS.md "Bug Fix Workflow", seguido também para feature)

1. Escrever todos os casos de §5.2 em `test/static.test.ts`, num bloco novo.
2. Rodar `pnpm vitest run test/static.test.ts` e confirmar que os casos novos **falham** pelo motivo esperado (cabeçalho ausente, status 200), não por erro de sintaxe.
3. Implementar D-01 a D-14.
4. Rodar de novo e confirmar que tudo passa nos modos `web` e `node`.

### 5.2 Casos (cada um roda em `web` e `node` via `describeMatrix`)

Fixture: asset de 1000 bytes gerado com `"abcdefghij".repeat(100)`, `getMeta` com `size: 1000`, `etag: '"v2"'`, `mtime` fixo com milissegundos, `type: "text/plain"`. `getContents` é `vi.fn(() => body)`. Os testes usam `t.app.all("/range/**", ...)` com `serveStatic`.

| RF | Caso | Esperado |
| --- | --- | --- |
| RF-01 | GET sem Range | 200, `accept-ranges: bytes` |
| RF-01 | HEAD sem Range | 200, `accept-ranges: bytes` |
| RF-01 | 404 e 405 | sem `accept-ranges` |
| RF-02 | GET `bytes=0-99` | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo = `body.slice(0, 100)` |
| RF-03 | `bytes=500-` | 206, `500-999/1000` |
| RF-03 | `bytes=0-` (arquivo inteiro) | 206, `0-999/1000` |
| RF-03 | `bytes=999-999` (último byte) | 206, `999-999/1000`, `content-length: 1` |
| RF-03 | `bytes=-100` | 206, `900-999/1000` |
| RF-03 | `bytes=-5000` | 206, `0-999/1000` |
| RF-03 | `bytes=990-5000` | 206, `990-999/1000` |
| RF-04 | HEAD `bytes=0-99` | 206, cabeçalhos de RF-02, corpo vazio, `getContents` não chamado |
| RF-05 | laço sobre `items=0-1`, `bytes=0-1,5-9`, `bytes=+1-2`, `bytes= 1-2`, `bytes=500-100`, `bytes=-`, `bytes=abc`, `bytes=99999999999999999999-`, `bytes=0-99999999999999999999`, `bytes=-99999999999999999999` | 200, corpo completo, sem `content-range` |
| RF-05 | `Bytes=0-9` | **Pendente §9.2.** Se a caixa for aceita, 206; se não, 200 |
| RF-06 | GET `bytes=1000-1100` | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| RF-06 | GET `bytes=1000-` | 416, mesmos cabeçalhos |
| RF-06 | GET `bytes=-0` | 416 |
| RF-06 | HEAD `bytes=1000-1100` | 416, `content-range: bytes */1000`, `content-length: 0`, `getContents` não chamado |
| RF-07 | `If-Range: "v1"` | 200, sem `content-range` |
| RF-07 | `If-Range: "v2"` | 206 |
| RF-07 | `If-Range: W/"v2"` | 200 |
| RF-07 | `If-Range` com a string exata de `Last-Modified` (mtime com milissegundos) | 206 |
| RF-07 | `If-Range` com data diferente | 200 |
| RF-07 | `If-Range` com data em outro formato (ex.: `2020`) | 200 |
| RF-07 | `If-Range` vazio | 200 |
| RF-07 | asset sem ETag + `If-Range: "v2"` | 200 |
| RF-07 | asset sem `mtime` + `If-Range` com data | 200 |
| RF-07 | HEAD + `If-Range: "v1"` + `bytes=0-99` | 200, sem `content-range` |
| RF-07 + ordem | `If-Range: "v1"` + `bytes=5000-` | 200, **não** 416 |
| RF-08 | `If-None-Match: "v2"` + `Range: bytes=0-99` | 304, `accept-ranges`, sem corpo |
| RF-09 | `app.js` com variante `app.js.gz` de 300 bytes, `accept-encoding: gzip`, `Range: bytes=0-9` | 206, `bytes 0-9/300`, `content-encoding: gzip`, `vary` com `accept-encoding` |
| RF-10 | `getMeta` sem `size` + Range | 200, corpo completo |
| RF-10 | `getMeta` com `size: 0` + Range | 200, corpo completo |
| RF-11 | POST com Range | 405, `allow: GET, HEAD` |
| RF-11 | `fallthrough: true` + POST com Range | cai no próximo handler |
| D-07 | laço sobre tipos de corpo: `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` | mesmo 206 (`bytes=100-199`) |
| D-08 | `getMeta.size = 1000`, corpo de 900 bytes + `Range: bytes=0-99` | 200, corpo de 900 bytes, sem `content-range` |
| D-09 | `getContents` devolve `null` + `Range: bytes=0-99` | 200, sem `content-range`, sem corpo |
| D-10 | `options.headers: { "accept-ranges": "none" }` + GET sem Range | **Pendente §9.4.** Se o usuário pode sobrescrever, `accept-ranges: none` |
| D-11 | `options.headers: { "content-length": "999" }` + `Range: bytes=0-99` (GET) | 206, `content-length: 100` |
| D-11 | `options.headers: { "content-length": "999" }` + `Range: bytes=0-99` (HEAD) | 206, `content-length: 100`, sem corpo |
| D-14 | `app.js` com variante gzip sem ETag próprio + `If-Range: "v2"` (ETag do original) | 200, sem `content-range` |
| RF-12 | conferência de exportações | ver §5.4 |

Os casos de laço (RF-05, D-07) usam `for` dentro de `describeMatrix`, com o nome do caso interpolado (`it(\`ignora ${range}\`, ...)\`), porque `it.each` não existe no wrapper (`test/_setup.ts:17-27`). Os nomes precisam ser únicos por modo (`web`/`node`), e o nome de cada caso inclui o valor do cabeçalho para isso.

### 5.3 Testes existentes

Nenhum teste existente deve precisar de ajuste. Motivos:
- As asserções de cabeçalho usam `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`), que ignora `accept-ranges` extra.
- Nenhum teste existente envia `Range`, então o caminho de 206/416 não é exercido por eles.
- O teste de `content-length` em `test/static.test.ts:600-617` não envia Range.

Se algum teste existente quebrar, a causa deve ser estudada antes de ajustar: o PRD exige que a mudança seja intencional (RF-13).

### 5.4 Exportações (RF-12)

Não há teste de runtime para a lista de exportações. Verificação antes do PR:
- `git diff -- src/index.ts` vazio;
- `git diff -- src/utils/static.ts | grep "^+export"` vazio;
- `pnpm build` e `pnpm test` passam.

Se o projeto já tiver teste de tipos de exportação (AGENTS.md menciona `types.test-d.ts` em `test/unit/`), usar esse em vez de depender de `grep`.

### 5.5 Comandos de verificação (ordem)

1. `pnpm vitest run test/static.test.ts` (vermelho antes, verde depois)
2. `pnpm lint` (oxlint + oxfmt --check)
3. `pnpm typecheck` (tsc, separado de `lint`)
4. `pnpm build` (precisa vir antes de `pnpm test`, porque `test/dist.test.ts` lê o `dist/`)
5. `pnpm test` (lint + typecheck + cobertura de todo o projeto)

## 6. Estimativa e ordem de trabalho

**Tamanho.** Mudança pequena em um arquivo de código: cerca de 120 linhas novas em `src/utils/static.ts`, mais o JSDoc. Cerca de 50 linhas de tabela em §5.2, cada uma rodando em `web` e `node`. Regeneração de docs. Sem estimativa de tempo: depende da resposta aos pontos de §9.

**Ordem.**
1. Testes em vermelho (§5.2).
2. Análise sintática e `If-Range` (`parseRange`, `ifRangeMatches`), com testes de unidade indiretos pelo caminho HTTP.
3. Ramo de HEAD (206/416), que é o mais simples de validar sem `getContents`.
4. Ramo de GET com `toBytes` e fallback (D-07, D-08, D-09).
5. `accept-ranges` em 200/304 (D-10) e JSDoc (R-12).
6. `lint`, `typecheck`, `build`, `test` (nessa ordem, ver §5.5).

## 7. Riscos

- **R-01 — `Content-Length` do arquivo inteiro em 206/416.** Mitigado por D-03 e D-11. Testado por "D-11" e pelos casos de 206 e 416 (que verificam o valor exato).
- **R-02 — Mudança de precedência de cabeçalhos.** Se um dia `mergeHeaders` mudar em `src/response.ts:243`, o `event.res` deixa de vencer e o `content-length` do 206 quebra. Os testes de RF-02 e RF-06 pegam a regressão, porque verificam o valor exato.
- **R-03 — Custo de memória e de CPU em GET com Range.** Cada GET com Range lê o asset inteiro (D-07). Para vídeo, cada seek relê o arquivo. Aceito pelo PRD, mas é o maior custo real desta entrega. A solução é ler parcialmente no backend, o que altera `getContents` e está fora de escopo (`sdd/prd.md:183`). **Recomendação:** abrir uma issue de seguimento antes de documentar a feature como "pronta para vídeo".
- **R-04 — Tamanho divergente entre `getMeta.size` e o corpo.** Tratado por D-08 (200 sem Range). Um `FormData` como corpo gera multipart com boundary e tamanho diferente de `size`, cai nesse mesmo fallback. Nesse fallback o `Content-Length` gravado (`size`) não bate com o corpo enviado. É pré-existente, mas os testes de D-08 não devem fixar esse valor como correto.
- **R-05 — `If-Range` com ETag de variante.** Se a variante pré-comprimida não tiver ETag próprio, `If-Range` com ETag nunca casa e a resposta é 200 completo. Degradação segura, não erro. Premissa do PRD (`sdd/prd.md:194`). Ver D-14.
- **R-06 — Ordem de 416 e `If-Range`.** Coberta pelo caso "`If-Range: "v1"` + `bytes=5000-` → 200" (§5.2). Regressão se alguém mover `resolveRange` para antes de `If-Range`.
- **R-07 — Interação com 304.** Coberta pelo caso de RF-08. Regressão se `accept-ranges` ou `resolveRange` forem movidos para antes da checagem de cache.
- **R-08 — Tamanho de `static.ts`.** Passa de 352 para cerca de 480 linhas, acima da meta de `AGENTS.md`. Ver D-01.
- **R-09 — Cache intermediário.** Respostas 206 são armazenadas por proxies e CDNs de acordo com a RFC 9110. O `Vary` atual (`accept-encoding`) continua correto para variantes. Nenhuma mudança de `Vary` é necessária para Range.
- **R-10 — `Accept-Ranges` pode ser sobrescrito por `options.headers`.** Coberto por D-10. Um usuário que queira anunciar `none` pode. Isso é diferente do que RF-01 diz literalmente.
- **R-11 — `it.each` ausente no `describeMatrix`.** Testes parametrizados precisam de laço, e os nomes dos casos precisam ser únicos por modo (`web`/`node`). Já anotado em §5.2.
- **R-12 — Documentação gerada.** `docs/2.utils/2.response.md` é gerado a partir do JSDoc de `src/utils/static.ts:68-100`. Para regenerar, rodar só `pnpm exec automd`. Não usar `pnpm fmt` para isso, porque ele roda `oxlint --fix` e `oxfmt` no repositório inteiro e pode alterar arquivos não relacionados.
- **R-13 — Falsa expectativa sobre `pnpm lint`.** `AGENTS.md:18` diz que `pnpm lint` inclui tipos, mas `package.json:46` não roda `tsc`. Quem seguir o `AGENTS.md` pode achar que tipos passaram quando não passaram. Rodar `pnpm typecheck` explicitamente. Vale corrigir `AGENTS.md` em separado; esta entrega não altera o arquivo.
- **R-14 — Tamanho zero.** Ver D-12 e §9. Se a decisão mudar para 416, os testes de RF-10 com `size: 0` mudam.

## 8. Itens fora de escopo confirmados

Conforme `sdd/prd.md:180-187`: `multipart/byteranges`, leitura parcial no backend, `If-Match`/`If-Unmodified-Since` (412), Range em `proxy`/`proxyRequest`/`h3/rules/proxy`, opção de configuração para desligar Range, e alterações em `h3/rules/cache`.

## 9. Pontos a confirmar

1. **Tamanho zero** (D-12): ignorar Range (como o PRD escreveu) ou responder 416 (como a RFC sugere para representações vazias)?
2. **Unidade `bytes` com caixa** (D-04): aceitar `Bytes=` também? Recomendação: sim.
3. **Divergência de tamanho** (D-08): 200 sem Range (recomendado aqui) ou usar o tamanho real no `Content-Range` (recomendação do PRD)?
4. **`Accept-Ranges` sobrescrevível** (D-10): manter o padrão de `etag` ou sempre forçar `bytes`?
5. **Localização dos helpers** (D-01): manter em `static.ts` (texto da issue) ou mover para `src/utils/internal/range.ts` (convenção de `AGENTS.md`)?
6. **Sufixo ou intervalo fora da faixa segura** (D-04): tratar como malformado (200, recomendado aqui) ou cobrir o arquivo inteiro com 206 como manda a RFC 9110?
7. **Validador de data** (D-05): aceitar só a string exata de `Last-Modified` (recomendado) ou também outras formas de HTTP-date, com análise mais ampla?
8. **ETag por variante** (D-14): confirmar no código como o `etag` é montado para cada variante de `encodings`. Se ele for igual ao do original, `If-Range` com ETag de variante casa com o original, e D-14 muda.
9. **Existência de `sdd/pedido.md`**: este arquivo não foi lido nesta revisão. O PRD (Riscos, "Base documental") pede confirmar que existe. Esta especificação cita `sdd/pedido.md:51` e `:92`, então a confirmação é necessária antes de usar essas referências.
