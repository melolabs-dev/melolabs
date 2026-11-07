# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md`, `sdd/prd.md` (RF-01..RF-12). Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `0c564a7`).

## 1. Estado atual (resumo do fluxo)

`serveStatic` (`src/utils/static.ts:101-278`) segue esta ordem:

1. aplica `options.headers` em `event.res.headers` (`static.ts:105-114`);
2. rejeita método ≠ GET/HEAD com 405 + `allow` (`static.ts:116-122`) ou `fallthrough`;
3. rejeita caminho não canônico (`static.ts:142-147`) e calcula o `id` (`static.ts:170-185`);
4. escolhe a variante por encoding e resolve `meta` via `getMeta` (`static.ts:187-208`); 404 ou `fallthrough` (`static.ts:210-215`);
5. `vary` (`static.ts:217-225`), `last-modified` a partir de `mtimeDate` (`static.ts:227-237`), `etag` (`static.ts:239-241`);
6. 304 via `isCacheMatch` (`static.ts:243-248`, definido em `src/utils/internal/cache.ts:29`);
7. `content-type`, `content-encoding` (`static.ts:250-266`);
8. `content-length` só se `size > 0` e ainda não definido (`static.ts:268-270`);
9. HEAD devolve `HTTPResponse(null, {status: 200})` (`static.ts:272-274`); GET chama `getContents(id)` e devolve `HTTPResponse(contents || null, {status: 200})` (`static.ts:276-277`).

Os cabeçalhos escritos em `event.res.headers` são mesclados na resposta final por `prepareResponse` (`src/response.ts:176-205`): `mergeHeaders` (`response.ts:243`) faz `set` dos cabeçalhos preparados **por cima** dos do `HTTPResponse` (`response.ts:201-204`). Para HEAD o corpo é zerado em `nullBody` (`response.ts:350-356`, usado em `response.ts:198`). O `status` do `HTTPResponse` prevalece sobre `event.res.status` (`response.ts:195`).

## 2. Decisões de arquitetura

### D-01 — Onde o código mora: helpers privados dentro de `src/utils/static.ts`

- **Alternativas:** (a) novo arquivo `src/utils/internal/range.ts`, seguindo o padrão de `internal/cache.ts`; (b) helpers não exportados no fim de `static.ts`, na seção `// --- Internal Utils ---` (`static.ts:280`).
- **Escolha: (b).** O pedido exige "manter toda a lógica auxiliar privada dentro do módulo serveStatic" e RF-11 exige que `src/utils/static.ts` não ganhe exportações. Um arquivo `internal/` exigiria `export` (nome novo em `static.ts`-adjacente, ainda que não chegue a `src/index.ts:193`) e contraria a letra do pedido. Custo aceito: `static.ts` passa das ~200 linhas sugeridas em AGENTS.md; mitigado mantendo os helpers pequenos e coesos.

### D-02 — Ordem de avaliação no fluxo

- **Alternativas:** (a) avaliar range antes do 304; (b) 304 → `If-Range` → range → corpo.
- **Escolha: (b).** RFC 9110 §13.2.2 coloca `If-None-Match`/`If-Modified-Since` antes de `If-Range`/`Range`; RF-08 exige 304 mesmo com `Range`. O bloco novo entra **depois** do 304 (`static.ts:243-248`) e dos cabeçalhos de tipo/encoding (`static.ts:250-266`), substituindo o trecho final `static.ts:268-277`. 404/405/`fallthrough` ficam intocados por estarem antes (`static.ts:116-122`, `210-215`), o que satisfaz RF-10 sem código adicional.

Pseudocódigo do trecho final:

```ts
const size = isKnownSize(meta.size) ? meta.size : undefined;   // inteiro seguro >= 0
if (size !== undefined) setIfAbsent("accept-ranges", "bytes");  // RF-01

const range = size === undefined ? undefined : resolveRange(event, size);
//   undefined          -> servir 200 como hoje
//   "unsatisfiable"    -> 416
//   { start, end }     -> 206

if (range === "unsatisfiable") -> 416
if (range) {
  if HEAD -> 206 sem corpo
  const contents = await options.getContents(id);
  const part = sliceBody(contents, range.start, range.end);
  if (part) -> 206 com part
  // não fatiável: cai para 200 completo reutilizando `contents` (sem 2ª chamada a getContents)
}
// caminho 200 atual, inalterado
```

### D-03 — Quando anunciar `Accept-Ranges: bytes`

- **Alternativas:** (a) sempre, inclusive 404/405 e assets sem `size` (letra da issue: "Always advertise"); (b) só em resposta de asset encontrado e com `size` conhecido; (c) só em asset encontrado, com ou sem `size`.
- **Escolha: (b).** PRD §4 já restringe a assets encontrados (preserva 404/405, RF-10). Entre (b) e (c): RF-06 diz que sem `size` o `Range` é ignorado; anunciar suporte e não honrá-lo induz clientes/CDNs a tentar ranges sem sucesso. O RF-01 só exige o cabeçalho "com `size` conhecido" (critério de aceite). O cabeçalho é gravado com "set se ausente" (padrão dos demais, `static.ts:234`, `239`, `250`), de modo que `options.headers` pode sobrescrevê-lo. O 304 não recebe `Accept-Ranges` (o `return` do 304 é anterior, `static.ts:243-248`; a RFC não o exige em 304).

### D-04 — Parsing do cabeçalho `Range`

- **Alternativas:** (a) parser tolerante com `split(",")` e múltiplos intervalos, usando só o primeiro; (b) regex estrita de intervalo único; (c) biblioteca externa (`range-parser`).
- **Escolha: (b).** Atende RF-05 (múltiplos intervalos ⇒ ignorar, não "usar o primeiro") sem nova dependência (AGENTS.md: core com 2 deps). Regra:

  ```ts
  const RANGE_RE = /^bytes=(\d*)-(\d*)$/i; // sobre header.trim()
  ```

  - sem match (inclui vírgula, `--1`, `5`, `abc`, vazio, `items=…`) ⇒ **ignorar**;
  - `first` e `last` vazios (`bytes=-`) ⇒ ignorar;
  - `first` e `last` presentes e `last < first` ⇒ ignorar (`bytes=5-2`), independentemente do `size`;
  - `first` vazio (sufixo `-n`): `n === 0` ⇒ `unsatisfiable`; senão `start = max(size - n, 0)`, `end = size - 1` (`n ≥ size` devolve tudo em 206);
  - `first` presente: `first ≥ size` ⇒ `unsatisfiable`; senão `start = first`, `end = min(last ?? size-1, size-1)`;
  - `size === 0` ⇒ qualquer intervalo válido é `unsatisfiable` (cobre `bytes=-0` e `0-`; a checagem `first ≥ size` e o sufixo precisam tratar `size = 0` explicitamente).
  - Números convertidos com `Number()`; valores gigantes viram `Infinity`/imprecisos mas as comparações com `size` continuam corretas (inteiro seguro só é exigido de `size`).
  - Cabeçalho ausente ⇒ ignorar. A unidade é comparada sem diferenciar maiúsculas (`i`), conforme a RFC (range units são case-insensitive).

  Retorno privado: `type ResolvedRange = { start: number; end: number } | "unsatisfiable" | undefined`.

### D-05 — Semântica de `If-Range`

- **Alternativas:** (a) comparar `If-Range` apenas com `meta.etag`/`mtime`; (b) comparar com os valores **efetivamente enviados** em `etag` e `last-modified` (que podem vir de `options.headers`, `static.ts:234`, `239`).
- **Escolha: (b).** O validador que o cliente viu é o do cabeçalho enviado; comparar com `meta` quando `options.headers` o sobrescreve causaria 206 sobre representação diferente da validada.
- Regras (RFC 9110 §13.1.5), só quando há `Range` válido e `If-Range` presente:
  - valor começa com `"` ou `W/` ⇒ é entity-tag: atende o range **somente** se o `etag` enviado existir, não for fraco (`/^w\//i`) e for **idêntico** (comparação forte, byte a byte); etag fraco em qualquer lado ⇒ ignora o range;
  - senão tenta como data HTTP: `Date.parse` válido e `=== ` ao `last-modified` enviado parseado (igualdade exata, **não** `>=`, ao contrário de `If-Modified-Since` em `cache.ts:46`); inválido ou sem `last-modified` ⇒ ignora o range;
  - `If-Range` sem `Range` não é lido.
- Ignorar o range = servir 200 completo (inclusive para um range que seria 416: `If-Range` falho precede a satisfatibilidade).
- Etag que não segue sintaxe de aspas (como `"w/123"` nos fixtures `static.test.ts:15`) é tratado como fraco se começar com `w/` (case-insensitive); caso contrário a comparação é literal. Decisão deliberadamente simples; ver R-05.

### D-06 — Como emitir 206/416 e sobrescrever `Content-Length`

- **Alternativas:** (a) montar um `Response` completo à parte; (b) continuar usando `HTTPResponse` e gravar os cabeçalhos em `event.res.headers`, como o código atual.
- **Escolha: (b).** Mantém `etag`, `last-modified`, `vary`, `content-type`, `content-encoding` e `options.headers` já gravados (RF-09) e a mesclagem de `prepareResponse` (`response.ts:201-204`). Diferença em relação ao 200: em 206/416 o `content-length` é gravado com `set` **incondicional** (hoje é "só se ausente", `static.ts:268`, e o teste `static.test.ts:600-617` protege esse comportamento para 200 — não mudar). O trecho `content-length` de `static.ts:268-270` passa a rodar só no caminho 200, depois da decisão de range.
- 206: `status: 206`, `content-range: bytes s-e/size`, `content-length: e-s+1`.
- 416: `status: 416`, `content-range: bytes */size`, `content-length: 0`, corpo `null`. Não se lança `HTTPError` (um erro perderia os cabeçalhos de sucesso, ver `response.ts:211-213`, e o 416 precisa de `Accept-Ranges`/validators). `statusText` explícito (`"Partial Content"`, `"Range Not Satisfiable"`), no estilo do 304 (`static.ts:245`).
- `content-length: 0` explícito no 416 é seguro: `sanitizeStatusCode` (`response.ts:196`) aceita 416 e `nullBody` (`response.ts:350`) só zera o corpo em HEAD/1xx/204/205/304.
- 200 sem range: nada muda além do `accept-ranges`; `content-length` só com `size > 0` (premissa do PRD §4 para `size` 0).

### D-07 — Fatiar o corpo de `getContents` (RF-12)

- **Alternativas:** (a) alterar a API de `getContents` para receber o intervalo (descartado pelo PRD §3); (b) materializar tudo em `Uint8Array` e fatiar (simples, mas lê arquivos grandes na memória); (c) fatiar por tipo, de forma preguiçosa quando possível, e cair para 200 completo nos tipos não confiáveis.
- **Escolha: (c).** Função privada `sliceBody(body, start, end): BodyInit | undefined` (`undefined` = não fatiável ⇒ 200 completo):

  | Tipo de `contents`                    | Estratégia                                                                                                         |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
  | `string`                              | `new TextEncoder().encode(s).subarray(start, end + 1)` (índices em **bytes UTF-8**, coerente com `size`)           |
  | `Uint8Array` / `ArrayBufferView`      | `new Uint8Array(buf, byteOffset + start, len)` (sem cópia)                                                         |
  | `ArrayBuffer`                         | `new Uint8Array(ab, start, len)`                                                                                   |
  | `Blob` / `File`                       | `blob.slice(start, end + 1)`; devolve o `Blob` (o `prepareResponse` já converte via `val.body`/stream)             |
  | `ReadableStream`                      | `ReadableStream` envolvente: descarta os primeiros `start` bytes, emite até `len` e então faz `cancel()` da origem |
  | `null`/`undefined`                    | `undefined` ⇒ 200 completo (corpo vazio), sem `Content-Range`                                                      |
  | `FormData`, `URLSearchParams`, outros | `undefined` ⇒ 200 completo                                                                                         |

- Valida-se o fatiamento **antes** de gravar `content-range`/status 206, para que o fallback ainda possa produzir o 200 com os cabeçalhos intactos. Para 416 e HEAD `getContents` não é chamado (RF-03/RF-04).
- Stream: se um chunk não for `Uint8Array` (ex.: string), o stream de saída é encerrado com erro; o `serveStatic` já tem esse contrato implícito (corpo binário). Um stream mais curto que `end + 1` simplesmente termina antes (divergência de `size` é responsabilidade do backend, PRD §4).
- Não se usa `Response.body`/`new Response(body).arrayBuffer()` para tipos arbitrários, para não bufferizar streams grandes.

### D-08 — Sem API pública nova

- `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`; esses tipos (`static.ts:9-15`, `17-66`) não mudam. Helpers (`resolveRange`, `ifRangeMatches`, `sliceBody`, tipos auxiliares) ficam sem `export`. O snapshot de exports em `test/unit/package.test.ts:4-5` serve de guarda e **não** deve ser alterado.
- `isolatedDeclarations` exige tipo de retorno explícito em funções exportadas; como nada é exportado, só se anota por clareza.

### D-09 — Documentação

- Acrescentar um parágrafo ao JSDoc de `serveStatic` (`static.ts:68-100`) sobre ranges: um único intervalo `bytes`, requer `meta.size` correto (em bytes da variante enviada), fatiamento feito sobre o que `getContents` devolve, `If-Range` forte. O trecho de `docs/2.utils/2.response.md:37-51` é gerado por `automd` a partir do JSDoc (`<!-- automd:jsdocs src="../../src/utils/static.ts" -->`, linha 37); atualizar o mesmo texto ali manualmente (ou via `pnpm fmt`, que roda `automd`) mantendo os dois em sincronia. Documentar que `size` incorreto gera `Content-Range` incorreto (PRD §4).

## 3. Arquivos a alterar

| Arquivo                      | Linhas atuais                     | Alteração                                                                                                                                             |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/static.ts`        | `static.ts:268-277`               | Substituir o fim de `serveStatic` (content-length + HEAD + GET) pela lógica de D-02/D-06; `accept-ranges` entra aqui.                                 |
| `src/utils/static.ts`        | `static.ts:280-351`               | Acrescentar helpers privados (`resolveRange`, `ifRangeMatches`, `sliceBody`, `rangeResponse`) após `idSearchPaths` ou antes de `parseAcceptEncoding`. |
| `src/utils/static.ts`        | `static.ts:68-100`                | JSDoc (D-09).                                                                                                                                         |
| `docs/2.utils/2.response.md` | `2.response.md:41-49`             | Espelhar o JSDoc (bloco `automd`).                                                                                                                    |
| `test/static-range.test.ts`  | novo                              | Testes de Range (seção 5).                                                                                                                            |
| `test/static.test.ts`        | `static.test.ts:33-40`, `431-437` | Opcional: incluir `"accept-ranges": "bytes"` em `expectedHeaders` (usam `toMatchObject`, `static.test.ts:53`, `450`, então já passam sem mudança).    |

Não alterar: `src/index.ts`, `src/response.ts`, `src/utils/internal/cache.ts` (`isCacheMatch` é reutilizado como está, `static.ts:243`), `test/unit/package.test.ts`.

## 4. Contratos e assinaturas (todos privados em `static.ts`)

```ts
type ByteRange = { start: number; end: number }; // inclusivo, 0 <= start <= end < size

/** `undefined` = ignorar o Range (200 completo); "unsatisfiable" = 416. */
function resolveRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined;

/** RFC 9110 §13.1.5: etag forte idêntico ou data exatamente igual ao last-modified. */
function ifRangeMatches(ifRange: string, etag: string | null, lastModified: string | null): boolean;

/** `undefined` quando o tipo não pode ser fatiado de forma confiável. */
function sliceBody(
  body: BodyInit | null | undefined,
  start: number,
  end: number,
): BodyInit | undefined;
```

Uso em `serveStatic`: `resolveRange(event.req.headers.get("range"), size)` só roda se `size` é inteiro seguro ≥ 0; `ifRangeMatches` roda só se `range` existe e o cabeçalho `if-range` está presente (`event.res.headers.get("etag")`/`get("last-modified")` como validadores).

Contrato de resposta:

| Caso                 | status | Cabeçalhos específicos                                                    | Corpo                  |
| -------------------- | ------ | ------------------------------------------------------------------------- | ---------------------- |
| sem range / ignorado | 200    | `accept-ranges: bytes` (se `size` conhecido); `content-length` como hoje  | `getContents` completo |
| intervalo válido     | 206    | `content-range: bytes s-e/size`, `content-length: e-s+1`, `accept-ranges` | trecho (vazio em HEAD) |
| não satisfatível     | 416    | `content-range: bytes */size`, `content-length: 0`, `accept-ranges`       | vazio                  |
| cache casou          | 304    | como hoje                                                                 | vazio                  |

`ServeStaticOptions` e `StaticAssetMeta` ficam idênticos.

## 5. Estratégia de testes

Seguir AGENTS.md: `describeMatrix` (web + node), `ctx.app`, sem mocks desnecessários; fluxo de bug/feature: escrever os testes, confirmar que falham (`pnpm vitest run test/static-range.test.ts`), implementar, confirmar que passam.

Novo `test/static-range.test.ts`, com asset `"0123456789"` (size 10), um caso por critério de aceite do PRD:

- **RF-01:** GET e HEAD sem Range ⇒ 200, `accept-ranges: bytes`, corpo e `content-length: 10` iguais aos de antes.
- **RF-02:** `2-5`→`2345` (`2-5/10`, len 4); `7-`→`789`; `-3`→`789`; `8-99`→`89`; `-99`→ arquivo todo com 206; `0-0`.
- **RF-03:** HEAD `2-5` ⇒ 206, headers do GET, corpo vazio, `getContents` não chamado (`vi.fn`).
- **RF-04:** `10-`, `50-60`, `-0` ⇒ 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, `getContents` não chamado; `size: 0` com `bytes=0-`.
- **RF-05:** `0-1,4-5`, `5-2`, `abc`, `5`, `--1`, vazio, `items=0-1` ⇒ 200 completo sem `content-range`.
- **RF-06:** `getMeta` sem `size` ⇒ 200 completo, sem `content-range` e sem `accept-ranges`.
- **RF-07:** `If-Range: "abc"` com `etag: "abc"` ⇒ 206; `"outro"` ⇒ 200; `W/"abc"` ⇒ 200; data igual a `last-modified` ⇒ 206; data diferente/inválida ⇒ 200; `If-Range` sem `Range` ⇒ 200; `If-Range` não casa + range que seria 416 ⇒ 200.
- **RF-08:** `If-None-Match` casando + `Range` ⇒ 304; `If-Modified-Since` idem.
- **RF-09:** variante `.gz` (20 bytes) com `Accept-Encoding: gzip` e `Range: bytes=0-4` ⇒ 206, `vary`, `content-range: bytes 0-4/20`, `content-length: 5`, 5 primeiros bytes da variante. **Cuidado:** o `fetch` do node (undici) descomprime respostas com `content-encoding: gzip`/`br`; para evitar falha de decodificação, retornar em `getMeta` um `encoding` não decodificado pelo cliente (como os fixtures usam `"utf8"`, `static.test.ts:14`) — a variante `.gz` é escolhida pela extensão, independentemente de `meta.encoding`. Incluir `options.headers` com `content-length: "999"` e verificar que em 206/416 prevalece o do trecho, enquanto o 200 continua `999` (`static.test.ts:600-617`).
- **RF-10:** caminho inexistente + Range ⇒ 404 (e `undefined`/fallthrough com `fallthrough: true`), POST + Range ⇒ 405 com `allow: GET, HEAD`; sem `accept-ranges`/`content-range`; caminho não canônico (`//x`) mantém 404.
- **RF-11:** garantido pelo snapshot existente (`test/unit/package.test.ts:4-5`) e por `pnpm lint`/`pnpm typecheck`.
- **RF-12:** mesmos 10 bytes entregues como `string`, `Uint8Array` (inclusive com `byteOffset` ≠ 0), `ArrayBuffer`, `Blob`, `File`, `ReadableStream` (um chunk e vários chunks pequenos, para exercitar o descarte inicial) ⇒ `2345`; `string` com caracteres multibyte (`size` em bytes); `FormData`/`URLSearchParams`/`null` ⇒ 200 completo.

Regressão: rodar `pnpm vitest run test/static.test.ts test/security.test.ts test/router.test.ts` (usam `serveStatic`), depois `pnpm test` (lint + typecheck + cobertura). Os testes existentes usam `toMatchObject` em cabeçalhos (`static.test.ts:53`, `69`, `450`, `466`), então `accept-ranges` extra não os quebra; nenhum ajuste é esperado. Se algum falhar por causa do novo cabeçalho, ajustar somente a expectativa de cabeçalho. O cenário `size` 0 sem `content-length` no 200 deve ganhar teste de regressão.

## 6. Riscos

| ID   | Risco                                                                                                                                                     | Mitigação                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | `size` ≠ bytes reais de `getContents` ⇒ `Content-Range`/`Content-Length` incorretos (e, em node, conexão inconsistente).                                  | Documentar no JSDoc (D-09); stream curto apenas termina antes; sem validação adicional (custaria ler o conteúdo).                                             |
| R-02 | Fatiar `ReadableStream` lê e descarta `start` bytes: custo O(start) em arquivos grandes.                                                                  | Preferir `Blob.slice`/`subarray` quando o tipo permite; `cancel()` da origem ao fim do trecho; documentar que backends podem entregar `Blob`/buffer fatiável. |
| R-03 | Fallback para 200 depois de `getContents` (tipo não fatiável) reutiliza `contents` já obtido; não chamar `getContents` duas vezes.                        | Implementação guarda o valor e segue pelo caminho 200 existente.                                                                                              |
| R-04 | Cliente node/undici descomprime `content-encoding` e não aceita trecho de gzip real; navegadores tratam range sobre variante codificada de modo variável. | Seguir a RFC 9110 (range sobre a representação codificada, PRD §4); testes usam `encoding` neutro; registrar no JSDoc.                                        |
| R-05 | Etags sem aspas ou com `w/` minúsculo (ex.: fixtures `"w/123"`) não seguem a sintaxe RFC; a classificação forte/fraca é heurística.                       | Tratar `/^w\//i` como fraco e exigir igualdade literal; coberto por teste.                                                                                    |
| R-06 | `etag` igual para variantes diferentes (`Vary: accept-encoding`) mistura bytes em caches/clientes com `If-Range`.                                         | Fora do controle do `serveStatic` (PRD §4); registrar na doc.                                                                                                 |
| R-07 | Ordem errada de pré-condições (range antes do 304, `If-Range` antes de `Range`).                                                                          | D-02 fixa a ordem; testes RF-07/RF-08 cobrem.                                                                                                                 |
| R-08 | `content-length` herdado de `options.headers` contradiz o trecho em 206/416.                                                                              | `set` incondicional somente nesses dois casos (D-06); teste dedicado; 200 preserva `static.test.ts:600-617`.                                                  |
| R-09 | `static.ts` cresce além de ~200 linhas (AGENTS.md "short files").                                                                                         | Aceito por D-01 (restrição do pedido); helpers curtos e documentados.                                                                                         |
| R-10 | Overflow/precisão em números enormes no `Range` (`bytes=99999999999999999999-`).                                                                          | Comparações com `size` seguem corretas (resultado 416 ou clamp); teste com valor gigante.                                                                     |
