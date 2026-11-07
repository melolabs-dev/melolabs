# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-13), RFC 9110 §13.1.5 e §14.
Escopo: `src/utils/static.ts` e testes. Nenhuma exportação pública nova (RF-12).

Todas as citações `arquivo:linha` foram conferidas no código em `master` (commit `35a668b`).

---

## 1. Visão geral do fluxo atual

`serveStatic` (`src/utils/static.ts:101`) já faz, nesta ordem:

| Etapa                                  | Linhas                        | Observação                          |
| -------------------------------------- | ----------------------------- | ----------------------------------- |
| Headers de `options.headers`           | `src/utils/static.ts:105-114` | `set` sobre `event.res.headers`     |
| 405 para método diferente de GET/HEAD  | `src/utils/static.ts:116-122` | `allow: GET, HEAD`                  |
| Caminho canônico (404/fallthrough)     | `src/utils/static.ts:142-147` | não muda                            |
| Busca de `getMeta` por variante/índice | `src/utils/static.ts:198-215` | `meta` e `id` da variante escolhida |
| `vary: accept-encoding`                | `src/utils/static.ts:220-225` | não muda                            |
| `last-modified` / `etag`               | `src/utils/static.ts:228-241` | `set` só se ausentes                |
| 304 (`isCacheMatch`)                   | `src/utils/static.ts:243-248` | antes de qualquer Range (RF-07)     |
| `content-type`, `content-encoding`     | `src/utils/static.ts:250-266` | só se ausentes                      |
| `content-length`                       | `src/utils/static.ts:268-270` | só se ausente e `size > 0`          |
| HEAD → 200 vazio                       | `src/utils/static.ts:272-274` |                                     |
| GET → `getContents` → 200              | `src/utils/static.ts:276-277` | `contents \|\| null`                |

Helpers internos ficam no fim do arquivo, a partir de `src/utils/static.ts:280` (`// --- Internal Utils ---`), e o último helper termina em `src/utils/static.ts:351`.

O 304 já é montado com `new HTTPResponse(null, …)` e os headers de `event.res.headers` são mesclados na resposta final (`src/response.ts:243`, `mergeHeaders`). Por isso basta gravar `accept-ranges`, `content-range` e `content-length` em `event.res.headers`: eles chegam em 200, 206, 304 e 416.

---

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Alternativas**

1. Helpers privados no fim de `src/utils/static.ts` (como os helpers atuais, `src/utils/static.ts:282-351`).
2. Novo módulo interno `src/utils/internal/range.ts`, importado por `static.ts`.
3. Novo módulo público.

**Escolha: 1.**

**Justificativa.** O RF-12 (`sdd/prd.md`) diz literalmente que a lógica de Range "fica em funções privadas do próprio `src/utils/static.ts`", e a issue pede "helper logic private within the serveStatic module". A opção 2 não expõe nada em `src/index.ts`, mas contraria o texto do RF-12. A opção 3 é descartada pelo RF-12.

**Custo aceito.** `static.ts` passa de 351 para cerca de 480 linhas, acima da meta de "< 200 LoC por arquivo" de `AGENTS.md`. Essa meta já não é respeitada hoje (351 linhas), e a divisão em módulo interno pode ser feita depois, sem mudança de API, se o time quiser.

### D-02 — Posição de cada etapa no fluxo

**Decisão**

- `accept-ranges: bytes` é gravado **antes** de `isCacheMatch` (`src/utils/static.ts:243`), para aparecer também no 304 (RF-01).
- A avaliação de Range (If-Range, parse, 416, 206) fica **depois** de `content-length` (`src/utils/static.ts:268-270`) e **antes** do ramo HEAD (`src/utils/static.ts:272`).
- Nada de Range é avaliado quando `isCacheMatch` devolve `true` (RF-07, R5 do PRD).

**Alternativas.** Avaliar Range logo após a busca de `meta` (`src/utils/static.ts:215`). Descartada: violaria RF-07, porque o 304 precisa ter precedência, e a avaliação de Range teria de ser desfeita se o cache casar.

### D-03 — `accept-ranges`: `set` ou só se ausente

**Escolha: só se ausente.** `if (!event.res.headers.has("accept-ranges")) event.res.headers.set("accept-ranges", "bytes")`.

**Justificativa.** Segue a regra já usada para `etag`, `last-modified` e `content-type` (`src/utils/static.ts:234`, `:239`, `:250`): um valor vindo de `options.headers` não é sobrescrito. Isso permite a quem usa o `serveStatic` desligar a anúncio com `accept-ranges: none`, sem nova opção (RF-12).

**Alternativa descartada.** `set` incondicional: torna impossível desligar o anúncio sem tocar no código.

### D-04 — `content-length` e `content-range` de 206 e 416 sobrescrevem

**Escolha.** Em 206 e 416, `content-length` e `content-range` são gravados com `event.res.headers.set(...)`, mesmo que `content-length` já exista (vindo de `options.headers` ou da linha `src/utils/static.ts:268-270`). Esta é a decisão P4 do PRD.

**Justificativa.** Um `content-length` do arquivo inteiro numa resposta parcial quebra o cliente. O teste existente `test/static.test.ts:600-616` (`content-length: 999` sem Range) continua passando, porque sem Range nenhum código novo escreve `content-length`.

### D-05 — Gramática e precedência de erros no `Range`

**Regex de entrada** (aplicada ao valor de `event.req.headers.get("range")`):

```ts
const RANGE_RE = /^[ \t]*bytes[ \t]*=[ \t]*(\d*)[ \t]*-[ \t]*(\d*)[ \t]*$/i;
```

- A unidade é comparada sem diferenciar maiúsculas (`/i`). RFC 9110 trata a unidade como `token`, cujo casamento é case-insensitive.
- `Headers.get` junta múltiplos cabeçalhos `Range` com `, `, então `bytes=0-1,4-5` não casa a regex (RF-05, múltiplos intervalos).
- Espaços e tabulações são aceitos ao redor de `=`, `-` e dos números. Quebras de linha e outros espaços não são aceitos (o valor de cabeçalho não as contém).

**Ordem de decisão** (dentro de `parseRange`):

1. Sem casamento na regex, ou os dois lados vazios (`bytes=-`): **ignorar** (200 completo).
2. Sufixo (`first` vazio): `n = Number(last)`. Se não for inteiro seguro, **ignorar**. Se `n === 0` ou `size === 0`: **416**. Senão `start = max(size - n, 0)`, `end = size - 1`.
3. Início (`first` preenchido): `start = Number(first)`; se não for inteiro seguro, **ignorar**. Se `last` preenchido, `end = Number(last)`; se não for inteiro seguro ou `end < start`, **ignorar** (RF-05, `bytes=5-2`).
4. Se `start >= size`: **416** (RF-04, inclui `size === 0`).
5. `end = last === "" ? size - 1 : Math.min(end, size - 1)` (RF-03, ajuste de limite).

A checagem de `start > end` (passo 3) vem **antes** da de `start >= size` (passo 4). Assim, `bytes=5-2` é ignorado mesmo quando `size` é 3, como pede RF-05.

**Alternativa descartada.** Tratar `start > end` como 416: contraria RF-05, que pede "ignorar" para intervalo invertido.

### D-06 — `If-Range`

**Regra.** Só é avaliado quando há `Range`. O valor é tratado como entity-tag quando começa com `"` ou com `W/"`; caso contrário é tratado como data HTTP.

- **Entity-tag:** verdadeiro somente se o ETag do asset (`meta.etag`) existir, **não** começar com `W/` e for idêntico ao valor de `If-Range`. Comparação forte (RFC 9110 §13.1.5).
- **Data:** verdadeiro somente se for idêntico (comparação de string exata) ao valor de `last-modified` que o serveStatic envia, lido de `event.res.headers.get("last-modified")` (pode ter vindo de `options.headers`). Sem `last-modified`, falso. Decisão P5 do PRD.
- Se `If-Range` for falso, o `Range` é ignorado e a resposta é 200 completa (RF-06). Isso inclui o caso em que o intervalo seria 416: com `If-Range` falso, a resposta é 200, não 416.

**Alternativa descartada.** Comparação "posterior a" para datas: é a regra de `If-Modified-Since`, não a de `If-Range` (P5).

### D-07 — `getContents` com Range: ordem de chamada e corpo nulo

**Ordem.**

- Para 416, `getContents` **não** é chamado (RF-04).
- Para HEAD com intervalo válido, `getContents` **não** é chamado (RF-02).
- Para GET com intervalo válido, `getContents(id)` é chamado **antes** de gravar `content-range` e o novo `content-length`. Assim a decisão de virar 206 depende do corpo que de fato existe.

**Corpo nulo.** Se `getContents` devolve falsy (`undefined`, `null`, `""`, o mesmo critério de `contents || null`, `src/utils/static.ts:277`) e há intervalo válido, a resposta é o **200 de hoje**: sem `content-range`, `content-length` com o valor já gravado (`src/utils/static.ts:268-270`), corpo nulo.

**Justificativa.** O PRD (R2) diz para não inventar bytes. Responder 206 com corpo vazio anunciaria bytes inexistentes. Responder 416 seria uma afirmação falsa sobre o recurso. O 200 é o comportamento atual e o que RF-11 manda preservar.

### D-08 — Recorte do corpo (`sliceBody`)

Conversão por tipo de `BodyInit` (`body` já é truthy):

| Tipo                                    | Estratégia                                                                               | Cópia            |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `ReadableStream`                        | lê e descarta `start` bytes; emite `end - start + 1` bytes; cancela a origem ao terminar | sem cópia total  |
| `Blob`                                  | `body.slice(start, end + 1)`                                                             | sem cópia (lazy) |
| `ArrayBuffer`                           | `new Uint8Array(body, start, end - start + 1)`                                           | sem cópia        |
| `ArrayBuffer` views (`Uint8Array` etc.) | `new Uint8Array(body.buffer, body.byteOffset + start, end - start + 1)`                  | sem cópia        |
| `string`                                | `new TextEncoder().encode(body)` e depois `subarray`                                     | cópia da string  |
| outros (`URLSearchParams`, `FormData`)  | `await new Response(body).blob()` e depois `slice`                                       | materializa      |

**Ordem de teste** no código: `ReadableStream` primeiro (é também um objeto), depois `Blob`, `ArrayBuffer`, `ArrayBuffer.isView`, `string`, e por último o caso geral.

**Alternativa descartada.** Materializar tudo com `new Response(body).blob()`. É o caminho mais simples, mas copia `ArrayBuffer` e `Uint8Array` inteiros mesmo para intervalos pequenos, o que contraria o objetivo de desempenho do projeto.

**Chunks de stream.** `Uint8Array` é o caso esperado. `string` é codificada em UTF-8 com `TextEncoder`. `ArrayBuffer` vira `new Uint8Array(chunk)`.

**Ligação com o 200.** O PRD (RF-10) pede que os bytes do 206 sejam os do intervalo do 200. Para as estratégias acima isso vale por construção. Para `FormData`, o boundary é aleatório a cada materialização (ver R-04).

### D-09 — Tamanho desconhecido e tipos de `size`

**Escolha.** `size` é considerado conhecido somente se `Number.isInteger(meta.size) && meta.size >= 0`. Caso contrário, não há `accept-ranges`, o `Range` é ignorado e a resposta é 200 completa (RF-08).

**Justificativa.** RF-08 exige ignorar qualquer `size` que não seja número. `Number.isInteger` também descarta `NaN` e `Infinity`. Um `size` negativo é tratado como desconhecido, porque não descreve um arquivo.

### D-10 — Onde os testes vão

**Escolha.** Novo arquivo `test/static-range.test.ts`, com `describeMatrix` (`test/_setup.ts:11`), para todos os casos de Range. `test/static.test.ts` não recebe casos novos.

**Justificativa.** O PRD (RF-13) permite arquivo irmão "se o engenheiro justificar". `test/static.test.ts` já tem 678 linhas, e o arquivo novo mantém os testes de Range focados. Os testes existentes em `test/static.test.ts` usam `toMatchObject` para cabeçalhos (`test/static.test.ts:53`, `:69`, `:450`, `:466`), então `accept-ranges` não quebra nenhum deles. A checagem de cabeçalhos completos com `toEqual` não aparece no arquivo (os `toEqual` das linhas `:513` e `:520` são sobre JSON).

---

## 3. Arquivos a alterar

### 3.1. `src/utils/static.ts` (alterar)

| Trecho atual                                                | Mudança                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/utils/static.ts:9-15` (`StaticAssetMeta`)              | sem mudança (RF-12)                                                                                                                                                            |
| `src/utils/static.ts:17-66` (`ServeStaticOptions`)          | sem campo novo (RF-12). Opcional: acrescentar uma linha ao JSDoc de `getContents` (`src/utils/static.ts:30-33`) dizendo que o recorte do Range é feito sobre o corpo devolvido |
| `src/utils/static.ts:101-104` (assinatura de `serveStatic`) | sem mudança                                                                                                                                                                    |
| após `src/utils/static.ts:241` e antes de `:243`            | gravar `accept-ranges: bytes` quando `size` é conhecido e o header não existe (D-03, D-09)                                                                                     |
| `src/utils/static.ts:268-270`                               | sem mudança no bloco (sem Range, o comportamento é o mesmo)                                                                                                                    |
| `src/utils/static.ts:272-277`                               | reescrever o trecho HEAD/GET com o ramo de Range (seção 4.2)                                                                                                                   |
| fim do arquivo, após `src/utils/static.ts:351`              | helpers privados `parseRange`, `isIfRangeMatch`, `sliceBody` (seção 4.1)                                                                                                       |

### 3.2. `test/static-range.test.ts` (criar)

Testes da seção 5.

### 3.3. Não alterar

- `src/index.ts:193`: exporta `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta`. Nada novo entra (RF-12).
- `test/unit/package.test.ts:133`: snapshot das exportações. Deve continuar igual. Ele é a verificação automática do RF-12.
- `src/rules/cache.ts:143-148`: já trata `Range` como bypass de cache. Fora de escopo (PRD).
- `src/utils/internal/cache.ts:29` (`isCacheMatch`): usado como está (D-02).
- `src/response.ts`: sem mudança.

### 3.4. Documentação (recomendado, fora do PRD)

- `docs/2.utils/2.response.md:39` (`### serveStatic(event, options)`): um parágrafo dizendo que o `serveStatic` atende `Range` com `bytes` e responde 206/416, e que o intervalo é aplicado sobre a variante escolhida. Não é exigido pelo PRD. Se for feito, é um parágrafo só.
- `CHANGELOG.md`: não editar. É gerado pelo `changelogen` no release.

---

## 4. Contratos e assinaturas

### 4.1. Helpers privados (em `src/utils/static.ts`, não exportados)

```ts
/** Resultado da leitura de um cabeçalho `Range`. */
type RangeResolution =
  | { type: "ignore" } // responde 200 completo (RF-05)
  | { type: "unsatisfiable" } // responde 416 (RF-04)
  | { type: "partial"; start: number; end: number }; // bytes inclusivos, já ajustados (RF-02, RF-03)

const RANGE_RE = /^[ \t]*bytes[ \t]*=[ \t]*(\d*)[ \t]*-[ \t]*(\d*)[ \t]*$/i;

/** Interpreta o valor de `Range` contra um asset de `size` bytes (D-05). */
function parseRange(value: string, size: number): RangeResolution;

/**
 * Avalia `If-Range` (D-06). `lastModified` é o valor de `last-modified` que o
 * serveStatic envia, ou `null` se não há.
 */
function isIfRangeMatch(
  ifRange: string,
  etag: string | undefined,
  lastModified: string | null,
): boolean;

/**
 * Recorta o corpo de `getContents` para `[start, end]` inclusivos (D-08).
 * Retorna um corpo que `Response` aceita. Não é chamada com corpo falsy.
 */
function sliceBody(body: NonNullable<BodyInit>, start: number, end: number): Promise<BodyInit>;
```

Notas de implementação:

- `parseRange` é síncrona. `sliceBody` é `async` apenas por causa de `Response.blob()` no caso geral.
- `RANGE_RE` fica no escopo do módulo, junto dos helpers, seguindo o estilo de `WEIGHT_RE` (`src/utils/static.ts:283`).
- Os números usam `Number(...)` seguido de `Number.isSafeInteger`. Acima disso, o intervalo é ignorado.

### 4.2. Fluxo em `serveStatic` (substitui `src/utils/static.ts:272-277`)

Pseudocódigo sobre o código existente. As etapas de 1 a 4 entram depois de `src/utils/static.ts:270`.

```ts
// 1. Avaliação de Range (só com size conhecido, RF-08)
let partial: { start: number; end: number } | undefined;
const rangeHeader = event.req.headers.get("range");
if (size !== undefined && rangeHeader !== null) {
  const ifRange = event.req.headers.get("if-range");
  const ifRangeOk =
    ifRange === null || isIfRangeMatch(ifRange, meta.etag, event.res.headers.get("last-modified"));
  if (ifRangeOk) {
    const resolved = parseRange(rangeHeader, size);
    if (resolved.type === "unsatisfiable") {
      event.res.headers.set("content-range", `bytes */${size}`); // RF-04
      event.res.headers.set("content-length", "0");
      return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
    }
    if (resolved.type === "partial") {
      partial = resolved;
    }
  }
}

// 2. HEAD
if (event.req.method === "HEAD") {
  if (partial) {
    event.res.headers.set("content-range", `bytes ${partial.start}-${partial.end}/${size}`);
    event.res.headers.set("content-length", String(partial.end - partial.start + 1)); // D-04
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  return new HTTPResponse(null, { status: 200 }); // comportamento atual
}

// 3. GET
const contents = await options.getContents(id);
if (partial && contents) {
  event.res.headers.set("content-range", `bytes ${partial.start}-${partial.end}/${size}`);
  event.res.headers.set("content-length", String(partial.end - partial.start + 1));
  return new HTTPResponse(await sliceBody(contents, partial.start, partial.end), {
    status: 206,
    statusText: "Partial Content",
  });
}
return new HTTPResponse(contents || null, { status: 200 }); // comportamento atual (D-07)
```

Pontos que o engenheiro não deve mudar:

- `statusText` de 206 é `"Partial Content"` e de 416 é `"Range Not Satisfiable"` (RFC 9110 reason phrases).
- O 416 e o 206 não tocam em `content-type`, `content-encoding`, `etag` ou `last-modified`. Eles já vêm de `event.res.headers` (RF-09).
- O `size` usado em `content-range` é o `size` do `meta` da variante escolhida (RF-09). Não há código novo para isso, porque `meta` já é o da variante (`src/utils/static.ts:201-206`).

### 4.3. Tabela de contrato da resposta

| Situação                                                                   | Status             | Cabeçalhos de intervalo                                                   | Corpo        | `getContents`   |
| -------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- | ------------ | --------------- |
| Sem `Range`, `size` conhecido                                              | 200                | `accept-ranges: bytes`                                                    | completo     | chamado         |
| `size` desconhecido                                                        | 200                | nenhum                                                                    | completo     | chamado         |
| `Range` válido, GET                                                        | 206                | `accept-ranges`, `content-range: bytes a-b/size`, `content-length: b-a+1` | intervalo    | chamado         |
| `Range` válido, HEAD                                                       | 206                | iguais ao GET                                                             | vazio        | **não** chamado |
| `Range` válido, `getContents` falsy                                        | 200                | `accept-ranges`                                                           | vazio (D-07) | chamado         |
| `Range` não satisfazível, GET ou HEAD                                      | 416                | `accept-ranges`, `content-range: bytes */size`, `content-length: 0`       | vazio        | **não** chamado |
| `Range` ignorado (sintaxe, múltiplo, unidade, invertido, `If-Range` falso) | 200                | `accept-ranges`                                                           | completo     | chamado         |
| `If-None-Match` ou `If-Modified-Since` casam                               | 304                | `accept-ranges`                                                           | vazio        | não chamado     |
| Método diferente de GET/HEAD                                               | 405                | nenhum                                                                    | —            | —               |
| Asset não encontrado                                                       | 404 ou fallthrough | nenhum                                                                    | —            | —               |

---

## 5. Estratégia de testes

Arquivo: `test/static-range.test.ts`, usando `describeMatrix` (`test/_setup.ts:11`), com `t.app.all("/**", …)` e `t.fetch(...)`, como em `test/static.test.ts:5-40`. Cada teste roda em `web` e `node`.

Asset padrão para a maioria dos casos: `getMeta` devolve `{ size: 10, type: "text/plain", etag: '"v1"', mtime: <data fixa> }`; `getContents` devolve `"0123456789"`. Os testes que precisam de outro caso usam um `serveStatic` próprio.

Todos os testes de Range usam `expect` e `it` do `describeMatrix`. Nada de `it.each`, porque o wrapper de `describeMatrix` não o oferece. Para tabelas, use um `for` que registra um `it` por caso.

### 5.1. Casos obrigatórios (mapeados aos RFs do PRD)

| #   | Teste                                                                                                                                                   | RF        | Verificação                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| 1   | GET sem Range com size 10                                                                                                                               | RF-01     | 200, `accept-ranges: bytes`, corpo completo                                                           |
| 2   | GET `bytes=2-4`                                                                                                                                         | RF-02     | 206, `content-range: bytes 2-4/10`, `content-length: 3`, corpo `234`                                  |
| 3   | HEAD `bytes=2-4`                                                                                                                                        | RF-02     | 206, mesmos headers, corpo vazio, `getContents` **não** chamado                                       |
| 4   | `bytes=7-100`, `bytes=-3`, `bytes=-50`                                                                                                                  | RF-03     | 206 com `bytes 7-9/10`, `bytes 7-9/10`, `bytes 0-9/10`, nessa ordem                                   |
| 5   | `bytes=10-20`                                                                                                                                           | RF-04     | 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, `getContents` **não** chamado     |
| 6   | `bytes=-0`                                                                                                                                              | RF-04     | 416                                                                                                   |
| 7   | Tabela de Range ignorado: `items=0-1`, `bytes=0-1,4-5`, `bytes=abc`, `bytes=`, `bytes=1`, `bytes=-`, `bytes=5-2`                                        | RF-05     | 200, sem `content-range`, corpo completo, nenhum 416                                                  |
| 8   | Tolerância a espaços: `bytes = 2 - 4` e `  bytes=2-4  `                                                                                                 | RF-05     | 206 `bytes 2-4/10`                                                                                    |
| 9   | `If-Range` com ETag forte igual                                                                                                                         | RF-06     | 206                                                                                                   |
| 10  | `If-Range: W/"v1"` com ETag forte `"v1"`                                                                                                                | RF-06     | 200 completo                                                                                          |
| 11  | `If-Range` igual ao ETag, mas o asset tem ETag fraco `W/"v1"`                                                                                           | RF-06     | 200 completo                                                                                          |
| 12  | `If-Range` com data exatamente igual ao `last-modified`                                                                                                 | RF-06     | 206                                                                                                   |
| 13  | `If-Range` com data diferente, ou sem `last-modified`                                                                                                   | RF-06     | 200 completo                                                                                          |
| 14  | `If-Range` sem `Range`                                                                                                                                  | RF-06     | 200 completo, sem `content-range`                                                                     |
| 15  | `If-Range` falso com intervalo inválido (`bytes=10-20`)                                                                                                 | RF-06     | 200 (não 416)                                                                                         |
| 16  | `Range: bytes=0-3` + `If-None-Match: "v1"`                                                                                                              | RF-07     | 304, sem `content-range`, sem corpo, `getContents` não chamado                                        |
| 17  | `Range` com `size` desconhecido                                                                                                                         | RF-08     | 200, sem `accept-ranges`, sem `content-range`                                                         |
| 18  | Variante gzip: `app.js` (size 10) e `app.js.gz` (size 6, `encoding: "gzip"`), `encodings: { gzip: ".gz" }`, `accept-encoding: gzip`, `Range: bytes=0-1` | RF-09     | 206, `content-range: bytes 0-1/6`, `content-encoding: gzip`, corpo = 2 primeiros bytes de `app.js.gz` |
| 19  | 416 da variante gzip mantém `content-encoding: gzip` e usa `/6`                                                                                         | RF-09     | 416, `content-range: bytes */6`                                                                       |
| 20  | Corpo `ReadableStream` em dois chunks (`01234` e `56789`), `bytes=3-6`                                                                                  | RF-10     | 206, corpo `3456`                                                                                     |
| 21  | Mesmo `Range` com corpos `string`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`                                                                | RF-10     | para cada tipo, os bytes do 206 são iguais aos bytes do mesmo intervalo na resposta 200               |
| 22  | `getContents` devolve `null` ou `undefined` com `Range` válido                                                                                          | R2 / D-07 | 200, sem `content-range`, corpo vazio                                                                 |
| 23  | `DELETE` com `Range` e `cache-control` em `options.headers`                                                                                             | RF-11     | 405, `allow: GET, HEAD`, sem `content-range`, sem `accept-ranges`                                     |
| 24  | 404 com `Range`                                                                                                                                         | RF-11     | 404, sem `accept-ranges`                                                                              |
| 25  | `options.headers: { "content-length": "999" }` com `Range: bytes=0-1`                                                                                   | P4 / D-04 | 206, `content-length: 2`                                                                              |
| 26  | `options.headers: { "content-length": "999" }` sem Range                                                                                                | RF-11     | 200, `content-length: 999` (já coberto por `test/static.test.ts:600-616`; repetir não é necessário)   |
| 27  | Asset de size 0 com `bytes=0-`                                                                                                                          | RF-04     | 416, `content-range: bytes */0`, `accept-ranges: bytes`                                               |
| 28  | `accept-ranges` presente em 200, 206, 304 e 416 (GET e HEAD)                                                                                            | RF-01     | verificação de cabeçalho em cada status                                                               |

### 5.2. Verificação de exportações (RF-12)

Não há teste novo. `test/unit/package.test.ts:133` já tem um snapshot inline das exportações. Ele deve passar sem alteração. Se mudar, a mudança está errada.

### 5.3. Testes existentes

Rodar `test/static.test.ts`, `test/security.test.ts`, `test/router.test.ts` e `test/unit/package.test.ts`. Pela leitura atual, nenhuma asserção deve quebrar: os cabeçalhos são checados com `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`). Se algum quebrar, ajustar só a asserção que depende de `accept-ranges`, sem remover o que ela verifica (PRD, RF-13).

### 5.4. Comandos de verificação

```bash
pnpm vitest run test/static-range.test.ts
pnpm vitest run test/static.test.ts test/security.test.ts test/router.test.ts test/unit/package.test.ts
pnpm lint          # oxlint + oxfmt --check
pnpm typecheck     # tsc --noEmit
pnpm test          # lint + typecheck + vitest com coverage (checagem final)
```

**Regra de bug fix (AGENTS.md).** Os testes de Range são novos, não correção de bug. Mesmo assim, rodar os casos 2, 5 e 9 contra o código atual antes da mudança e confirmar que falham. Isso prova que o teste mede o comportamento novo.

---

## 6. Riscos

- **R-01 — Custo de `ReadableStream` (PRD R1).** Sem um parâmetro de intervalo em `getContents`, um stream é lido desde o início. Para arquivos grandes com intervalo no fim, isso é lento. A mitigação é a documentação (`Blob` ou backend que sabe fatiar). Fora de escopo.
- **R-02 — Corpo nulo com Range (PRD R2).** Tratado em D-07: resposta 200 de hoje, sem inventar bytes. Coberto pelo caso 22.
- **R-03 — `size` que não bate com o corpo (PRD P2).** Se `getContents` devolve menos bytes que `size`, o `content-length` do 206 fica errado e o cliente pode travar. O framework confia em `size`, como o 200 já confia. Fora de escopo, mas vale mencionar no PR.
- **R-04 — `FormData` tem boundary aleatório.** Cada `new Response(formData)` gera um boundary novo. O 206 e o 200 de um mesmo `FormData` podem ter bytes diferentes. O caso 21 não inclui `FormData` pelo mesmo motivo. Se isso for importante, o `getContents` deve devolver um `Blob` ou `Uint8Array`.
- **R-05 — Tipo de conteúdo de `string` no 206.** Para `string` sem `content-type` definido, o 200 recebe `text/plain;charset=UTF-8` do runtime, mas o 206 com `Uint8Array` não recebe. Na prática `serveStatic` já define `content-type` em quase todos os casos (`src/utils/static.ts:250-262`). Se for necessário igualar, o 206 pode definir `text/plain;charset=UTF-8` quando a string não tiver `content-type`. Não foi implementado, por não estar no PRD.
- **R-06 — Cache compartilhado e `Vary` (PRD R4).** Um 206 guardado por um proxy pode ser servido a quem não pediu Range. A RFC permite, e `vary` não muda (fora de escopo).
- **R-07 — `rules/cache` ignora Range.** `src/rules/cache.ts:148` faz bypass de Range. Isso é coerente com o `serveStatic` (206 não é cacheado pela regra), mas significa que mídia servida por `serveStatic` atrás de `cache` rule não ganha cache de rota. Fora de escopo.
- **R-08 — Ordem de avaliação (PRD R5).** A regressão mais provável é mover a avaliação de Range para antes de `isCacheMatch`. O caso 16 cobre.
- **R-09 — Diferença de plataforma (PRD R6).** `Blob.slice`, `ReadableStream` e `Response` se comportam de forma um pouco diferente entre Node e web. A matriz `describeMatrix` roda os dois alvos. Se algo divergir, o teste mostra.
- **R-10 — Tamanho de `static.ts`.** O arquivo passa de 351 para cerca de 480 linhas (D-01). Aceito por causa do RF-12. Revisitar se o arquivo continuar crescendo.

---

## 7. Itens pendentes

Nenhum item bloqueante. Dependências externas: nenhuma nova. `pnpm install` não é necessário, porque o projeto só usa APIs web (`Blob`, `ReadableStream`, `TextEncoder`, `Response`) que já existem nos quatro runtimes.
