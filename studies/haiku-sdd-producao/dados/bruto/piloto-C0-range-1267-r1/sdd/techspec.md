# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-10). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (antes da mudança).

## 1. Contexto do código atual

`serveStatic` está em `src/utils/static.ts:101-278`. Fluxo relevante:

- `src/utils/static.ts:105-114`: copia `options.headers` para `event.res.headers`.
- `src/utils/static.ts:116-122`: método diferente de `GET`/`HEAD` retorna (fallthrough) ou lança 405.
- `src/utils/static.ts:198-215`: procura o meta (variantes codificadas antes da não codificada); sem meta, fallthrough ou 404. Em `src/utils/static.ts:200-208` o `id` escolhido pode ser o da variante pré-comprimida, então `meta.size` é o da variante (premissa do PRD).
- `src/utils/static.ts:220-225`: `Vary: accept-encoding`.
- `src/utils/static.ts:227-241`: `Last-Modified` (`mtimeDate`, truncado a segundos em `:232`) e `ETag`.
- `src/utils/static.ts:243-248`: resposta 304 via `isCacheMatch`.
- `src/utils/static.ts:250-266`: `Content-Type` e `Content-Encoding`.
- `src/utils/static.ts:268-270`: `Content-Length` a partir de `meta.size`, só se `size > 0` e se a resposta ainda não tem `content-length`.
- `src/utils/static.ts:272-277`: `HEAD` devolve `HTTPResponse(null, {status: 200})`; `GET` chama `getContents(id)` e devolve `HTTPResponse(contents || null, {status: 200})`.
- Seção `// --- Internal Utils ---` em `src/utils/static.ts:280`: helpers privados (`parseAcceptEncoding` `:292`, `normalizeCoding` `:335`, `idSearchPaths` `:340`). Os novos helpers entram aqui, sem `export`.

Mesclagem de cabeçalhos: `src/response.ts:201-204` e `src/response.ts:243-252` mostram que os cabeçalhos de `event.res.headers` sobrescrevem (`set`) os do `HTTPResponse`. Logo, `Content-Range` e `Content-Length` do 206/416 devem ser gravados em `event.res.headers`, onde já está o `content-length` atual (`static.ts:269`).

`src/response.ts:350-356` (`nullBody`) descarta o corpo em `HEAD`, 204, 205 e 304; portanto um `HEAD` 206 sai sem corpo e com os cabeçalhos preservados. Um 416 e um 206 de `GET` mantêm o corpo que passarmos.

Exportações públicas: `src/index.ts:193` exporta somente `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. O snapshot de `test/unit/package.test.ts:133` (`"serveStatic"`) trava a lista de nomes.

Utilitário de cache existente: `src/utils/internal/cache.ts` (`matchETag` e `isCacheMatch`). `matchETag` usa comparação fraca (ignora `W/`), então NÃO serve para `If-Range`.

## 2. Decisões de arquitetura

### D-01 — Onde implementar: dentro de `src/utils/static.ts`, helpers privados

Alternativas:
1. Novo módulo `src/utils/internal/range.ts` com helpers exportados para uso interno.
2. Estender `src/utils/internal/cache.ts` com a lógica de `If-Range`.
3. Helpers não exportados no próprio `static.ts`.

Escolha: alternativa 3. O pedido exige "helpers privados dentro do módulo `serveStatic`" e nenhum nome novo exportado (RF-10). Um módulo interno separado (1) exige `export` de helpers, o que contraria a letra do pedido, embora não vaze para `src/index.ts`. A alternativa 2 acopla `If-Range` (comparação forte) a um arquivo que implementa comparação fraca. O custo é `static.ts` crescer (hoje 351 linhas, já acima da meta de 200 LoC do `AGENTS.md`); aceito, pois o requisito explícito tem precedência.

### D-02 — Ponto de inserção no fluxo e precedência

Alternativas:
1. Avaliar `Range` antes do 304.
2. Avaliar `Range` depois do 304 e depois de definidos `Content-Type`/`Content-Encoding`/`Content-Length`, substituindo apenas o bloco final `static.ts:272-277`.

Escolha: 2. A RFC 9110 §13.2.2 coloca `If-None-Match`/`If-Modified-Since` antes de `Range`/`If-Range`; manter o `isCacheMatch` em `static.ts:243-248` intacto preserva o 304. `Accept-Ranges: bytes` é gravado logo após o meta ser encontrado (perto de `static.ts:225`), antes do 304, de modo que vale para toda resposta de asset encontrado (RF-01); incluí-lo em 304 é permitido pela RFC. Não é gravado em fallthrough/404/405, pois esses retornam antes.

### D-03 — Quando o `Range` é considerado

Alternativas:
1. Avaliar sempre que houver cabeçalho `Range`.
2. Avaliar somente se `meta.size` for inteiro seguro `> 0`.

Escolha: 2. O pedido e o PRD (fora de escopo) excluem tamanho desconhecido. `static.ts:268` já usa `size > 0` para `Content-Length`; seguimos o mesmo critério (arquivo de 0 bytes: `Range` ignorado, 200). `Accept-Ranges: bytes` continua sendo enviado (RF-01 diz "toda resposta"). Para `size` não inteiro ou negativo, tratar como desconhecido.

### D-04 — Gramática e política de `Range` (parser privado)

Função privada `parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined`.

Alternativas:
1. Uma regex única `^bytes=(\d*)-(\d*)$` sobre o valor com `trim`.
2. Parser manual que divide em `=` e `,`.

Escolha: 1 com pré-checagens. Regra, na ordem:
- Unidade: aceita só `bytes` (case-insensitive, conforme `range-unit` da RFC); outra unidade, ausência de `=` ou espaços inválidos retornam `undefined` (ignorar).
- Qualquer `,` no conjunto retorna `undefined` (multi-range ignorado; RF-05). Isso cobre também `bytes=0-4,` .
- Formas: `a-b`, `a-`, `-n`. `-` sozinho, `abc`, letras, sinais e vazio retornam `undefined`.
- `a > b` retorna `undefined` (ignorar, não 416; RF-05).
- Números grandes: se `Number.isSafeInteger` falhar para início ou fim, tratar o número como "além do arquivo": início enorme vira 416; fim enorme é limitado a `size - 1`. Evita imprecisão de ponto flutuante.
- `-n` com `n = 0` (`bytes=-0`): RFC 9110 §14.1.2 diz que o sufixo de comprimento zero é não satisfazível, portanto 416. `n > size` é limitado ao arquivo todo (`0-(size-1)`).
- `a-b` com `a >= size` e `a-` com `a >= size`: `"unsatisfiable"` (RF-04). `b >= size` é limitado a `size - 1` (RF-03).

Resultado satisfazível: `{ start, end }` com `end` inclusivo.

### D-05 — Semântica de `If-Range`

Alternativas:
1. Reutilizar `matchETag` (comparação fraca).
2. Implementar comparação forte privada e comparação de data exata.

Escolha: 2 (`isRangeConditionMet(ifRange, etag, mtimeDate)`), pois o pedido pede comparação forte (RF-08):
- `If-Range` ausente: condição atendida, aplica o `Range`.
- Valor começando com `"` ou `W/` é entity-tag: atende só se o ETag atual existe, nenhum dos dois é fraco (`W/` literal, sensível a maiúsculas, como na norma) e as cadeias são idênticas. ETag fraco no pedido ou no meta nunca atende. Observação: o `etag: "w/123"` dos testes atuais (`test/static.test.ts:12`) não é um entity-tag válido (sem aspas); como não casa por igualdade com um valor entre aspas, não atende, comportamento seguro.
- Qualquer outro valor é tratado como data HTTP: atende só se `Date.parse` for válido, `mtimeDate` existir e `new Date(value).getTime() === mtimeDate.getTime()` (igualdade exata; `mtimeDate` já truncado a segundos em `static.ts:232`). A norma exige igualdade exata do `Last-Modified`; não usar `>=`.
- Quando não atende: ignora `Range`, responde 200 completo (sem `Content-Range`).
- `If-Range` sem `Range` no pedido é ignorado.

### D-06 — Fatiamento do corpo (GET) e contrato de `getContents`

`getContents` devolve `BodyInit | null | undefined` (`static.ts:33`) e não pode mudar.

Alternativas:
1. Converter qualquer corpo em `Uint8Array` via `new Response(contents).arrayBuffer()` e `subarray`.
2. Tratar cada tipo: `string` (via `TextEncoder`), `ArrayBuffer`/`ArrayBufferView`, `Blob` (`.slice`), `ReadableStream` (fatiar em fluxo); demais tipos (`FormData`, `URLSearchParams`) por `new Response(c).blob()`.
3. Pedir ao usuário um `getContents` que aceite intervalo (nova opção).

Escolha: 2. A alternativa 1 materializa arquivos grandes em memória, o que derrota o caso de vídeo. A 3 muda API (proibido). Em 2, `Blob` usa `slice(start, end + 1)` sem copiar tudo; `ArrayBuffer`/views usam `subarray`; `string` é codificada em UTF-8 e fatiada por bytes (coerente com `size` em bytes); `ReadableStream<Uint8Array>` é fatiada por uma função privada `sliceStream(stream, start, endExclusive)` que lê com `getReader()`, descarta bytes até `start`, emite até `end + 1` e cancela o leitor ao terminar (liberando o recurso de origem). `Content-Length` do 206 é `end - start + 1`.

Divergência de tamanho (risco do PRD): o corpo fatiado nunca promete mais do que `size`; se o conteúdo real for menor que o intervalo pedido, o fluxo termina antes. Não validamos `size` contra o conteúdo (impossível sem consumir), conforme premissa "`size` confiável".

Se `getContents` devolver `null`/`undefined` com Range válido: manter o comportamento atual (corpo nulo, `HTTPResponse(null)`) e não montar 206; ou seja, responder como hoje com 200. Sem conteúdo não há o que fatiar.

### D-07 — Cabeçalhos das respostas 206 e 416

- 206: `status: 206`, `statusText` "Partial Content"; gravar em `event.res.headers`: `content-range: bytes <start>-<end>/<size>` e `content-length: <end-start+1>` com `set` incondicional. Isso difere do bloco `static.ts:268-270`, que respeita um `content-length` já presente (teste em `test/static.test.ts:600-613` cobre o 200). Para 206/416 o comprimento incorreto quebraria o protocolo, então o valor calculado vence; o teste existente continua verdadeiro porque cobre apenas o caso sem `Range`.
- 416: `status: 416`, `statusText` "Range Not Satisfiable"; `content-range: bytes */<size>`, `content-length: 0`, corpo `null`, sem chamar `getContents` (evita I/O inútil). `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding` ficam como na resposta completa (RF-09); a escolha de devolver `HTTPResponse` e não lançar `HTTPError` é deliberada: `HTTPError` descartaria os cabeçalhos de sucesso (ver `src/response.ts:208-213` e o comentário sobre `errHeaders`).
- Retorno como `HTTPResponse` com `status` explícito (`static.ts:7` já importa a classe), consistente com o 304 em `static.ts:244-247`.
- `HEAD`: mesmos status e cabeçalhos, sem corpo (D-08).

Alternativa rejeitada: lançar `HTTPError({status: 416})`. Não carrega `Content-Range` com facilidade e filtra cabeçalhos de sucesso.

### D-08 — HEAD

Alternativas:
1. Ramo separado para HEAD com cálculo próprio.
2. Mesmo cálculo de intervalo para `GET` e `HEAD`; só o corpo muda.

Escolha: 2. O intervalo, o status e os cabeçalhos são calculados antes do ramo `HEAD` (hoje `static.ts:272`); `HEAD` retorna `HTTPResponse(null, { status })` sem chamar `getContents`; `GET` fatia. Garante RF-06 por construção. Para `HEAD` 200 sem `Range`, o comportamento atual (`static.ts:272-274`) é preservado.

### D-09 — Representação codificada (RF-07)

Nenhuma lógica nova: o `meta` já é o da variante escolhida (`static.ts:200-208`), e `Content-Encoding` vem de `meta.encoding` (`static.ts:264-266`). O intervalo é calculado sobre `meta.size` e o `getContents(id)` do `id` da variante (`static.ts:276`), então os bytes servidos são os da variante. `Vary: accept-encoding` (`static.ts:220-225`) permanece. Requer apenas que o fatiamento use o mesmo `id` já usado hoje. Coberto por teste (variante `.gz` com `size` da variante).

### D-10 — Header `Range` em métodos e rotas fora de escopo

O `Range` só é lido depois do bloco de método (`static.ts:116-122`); `405` e fallthrough não mudam. Sem asset: 404/fallthrough como hoje (`static.ts:210-215`), sem `Accept-Ranges`.

### D-11 — Nenhuma API pública nova

Helpers (`parseRange`, `isRangeConditionMet`, `sliceBody`, `sliceStream`) ficam sem `export` em `static.ts`. `StaticAssetMeta`/`ServeStaticOptions` (`static.ts:9-66`) não ganham campos. `src/index.ts:193` não é alterado. O snapshot em `test/unit/package.test.ts` serve de guarda. O tipo auxiliar do resultado do parser é um tipo local não exportado (`isolatedDeclarations` exige anotações explícitas de retorno apenas em exports; mesmo assim anotar).

## 3. Arquivos a alterar

| Arquivo | Linhas de referência | Mudança |
| --- | --- | --- |
| `src/utils/static.ts` | `:225` (após `Vary`) | gravar `accept-ranges: bytes` ao encontrar o asset |
| `src/utils/static.ts` | `:243-248` | manter o 304 inalterado (precedência) |
| `src/utils/static.ts` | `:268-277` | avaliar `Range`/`If-Range`, definir 206/416, ajustar `content-length`/`content-range`, ramo HEAD/GET com fatiamento |
| `src/utils/static.ts` | `:280` em diante | adicionar helpers privados |
| `test/static.test.ts` | fim do arquivo (678 linhas) | novo `describeMatrix("serve static range", ...)` |
| `docs/4.examples/serve-static-assets.md` | (opcional) | nota curta sobre suporte a `Range`; não obrigatório |

Não alterar: `src/index.ts:193`, `src/response.ts`, `src/utils/internal/cache.ts`, `test/unit/package.test.ts`.

## 4. Contratos e assinaturas (todos privados, sem `export`)

```ts
type ByteRange = { start: number; end: number }; // end inclusivo, 0 <= start <= end < size

// undefined => ignorar o Range (malformado/multi/unidade); "unsatisfiable" => 416
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

// true => Range pode ser aplicado (If-Range ausente ou validador casa)
function isRangeConditionMet(
  ifRange: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean;

// fatia o corpo de getContents; valida só tipos suportados
function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit>;
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  endExclusive: number,
): ReadableStream<Uint8Array>;
```

Pseudocódigo do trecho que substitui `static.ts:268-277`:

```ts
const size = meta.size !== undefined && Number.isSafeInteger(meta.size) && meta.size > 0 ? meta.size : undefined;
let status = 200;
let range: ByteRange | undefined;
const rangeHeader = size ? event.req.headers.get("range") : null;
if (size && rangeHeader && isRangeConditionMet(event.req.headers.get("if-range"), { etag: meta.etag, lastModified: mtimeDate })) {
  const parsed = parseRange(rangeHeader, size);
  if (parsed === "unsatisfiable") { /* 416: content-range "bytes */size", content-length "0" */ }
  else if (parsed) { /* 206: content-range, content-length forçado */ range = parsed; }
}
// 200 sem range: content-length como hoje (respeita o já existente)
// HEAD => HTTPResponse(null, { status })
// GET  => range ? sliceBody(contents, ...) : contents
```

Entradas/saídas observáveis:

| Pedido (asset de 100 bytes) | Status | Content-Range | Content-Length |
| --- | --- | --- | --- |
| `bytes=10-19` | 206 | `bytes 10-19/100` | 10 |
| `bytes=90-` / `bytes=-10` | 206 | `bytes 90-99/100` | 10 |
| `bytes=50-999` | 206 | `bytes 50-99/100` | 50 |
| `bytes=-500` | 206 | `bytes 0-99/100` | 100 |
| `bytes=100-` / `bytes=150-200` / `bytes=-0` | 416 | `bytes */100` | 0 |
| `bytes=0-4,10-14` / `items=0-4` / `bytes=abc` / `bytes=20-10` | 200 | ausente | 100 |

## 5. Estratégia de testes

Seguir o `AGENTS.md`: `describeMatrix` (modos `web` e `node`), `t.app.all(...)`, `t.fetch`. Arquivo: `test/static.test.ts`, novo bloco depois da linha 678. Assets de conteúdo conhecido (por exemplo `"0123456789"` repetido até 100 bytes, `size` correto).

Fluxo (bug-fix workflow do `AGENTS.md`): escrever os testes primeiro, confirmar que falham, implementar, confirmar que passam, rodar a suíte (`pnpm vitest run test/static.test.ts`, depois `pnpm test`).

Casos:
1. `Accept-Ranges: bytes` em GET, HEAD, com e sem `Range`, e também no 304; ausente em 404/405/fallthrough.
2. As três formas (`a-b`, `a-`, `-n`) com status, `Content-Range`, `Content-Length` e corpo exatos (RF-02/03).
3. Fim além do tamanho limitado; sufixo maior que o arquivo.
4. 416: `bytes=100-`, `150-200`, `-0`; corpo vazio, `Content-Range: bytes */100`, `Content-Length: 0`.
5. Ignorados (200 completo, sem `Content-Range`): multi-range, `items=0-4`, `bytes=abc`, `bytes=20-10`, `bytes=`, `bytes=-`.
6. `HEAD` com `Range` válido e inválido: mesmos status/cabeçalhos do `GET`, sem corpo.
7. Variante `.gz` selecionada por `Accept-Encoding`, `size` da variante: corpo e `Content-Range` da variante, `Content-Encoding` e `Vary` preservados.
8. `If-Range`: ETag forte igual (206); diferente (200); fraco `W/"x"` (200); data igual a `Last-Modified` (206); data diferente (200); `If-Range` sem `Range` (200).
9. Cabeçalhos preservados num 206: `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding` iguais aos do 200.
10. Precedência: `If-None-Match` casando + `Range` resulta em 304.
11. Tipos de corpo de `getContents`: string, `Uint8Array`, `Blob`, `ReadableStream`, em cada modo da matriz; corpo multibyte (UTF-8) com `size` em bytes.
12. `size` ausente ou 0: `Range` ignorado, 200.
13. Regressão: os testes existentes (incluindo `test/static.test.ts:600` de `content-length` já definido) passam sem mudança.
14. Guarda de API: `test/unit/package.test.ts` (snapshot inalterado) e conferência de `grep "export" src/utils/static.ts` listando apenas os 3 nomes originais.

Verificação final: `pnpm lint` (oxlint e oxfmt), `pnpm typecheck`, `pnpm vitest run`.

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `size` divergente do conteúdo real | `Content-Length` incorreto, conexão truncada | teste com variante codificada; fatiamento nunca excede `size`; documentar a premissa |
| `content-length` pré-definido pelo usuário (`options.headers`) em 206/416 | valor errado no 206 | `set` incondicional só para 206/416 (D-07); 200 mantém o comportamento atual |
| Fatiar `ReadableStream` em web vs node | diferença de comportamento entre adaptadores | `describeMatrix`; cancelar o leitor ao fim; testes de stream |
| Corpos não suportados (`FormData`, `URLSearchParams`) | memória/ordem | converter por `Response.blob()` (caminho raro, documentado em comentário) |
| `string` com caracteres multibyte | índice em caracteres em vez de bytes | codificar com `TextEncoder` antes de fatiar; teste UTF-8 |
| Comparação de `If-Range` por data | falso positivo com `>=` | igualdade exata com `mtimeDate` truncado (`static.ts:232`) |
| Números enormes no `Range` | perda de precisão | `Number.isSafeInteger`; excedente tratado como além do arquivo |
| Helper exportado por engano / vazamento de API | quebra do snapshot e do requisito | nenhum `export`; snapshot `test/unit/package.test.ts`; revisão por `grep` |
| Arquivo `static.ts` maior que a meta de 200 LoC do `AGENTS.md` | convenção de estilo | já excedida hoje (351 linhas); o pedido exige helpers privados no módulo |
| 304 e `Range` | status errado | `isCacheMatch` fica antes do `Range` (D-02); teste de precedência |
| `Accept-Ranges` em respostas completas | regressão em testes que comparam cabeçalhos | rodar a suíte atual; nenhum teste existente compara o conjunto total de cabeçalhos (conferir na implementação) |
