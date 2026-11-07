# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-12). Esta spec decide **como** implementar. Não altera código do projeto; as citações `arquivo:linha` foram conferidas na branch `master` (commit `a34bd1d`).

## 1. Visão geral

`serveStatic` (`src/utils/static.ts:101`) passa a ler `Range` e `If-Range` depois da validação de cache (304) e dos cabeçalhos de representação, e antes de chamar `getContents`. A mudança é interna: nenhuma assinatura pública muda, nenhuma opção nova, nenhuma exportação nova em `src/index.ts`.

Fluxo resultante, dentro de `serveStatic` (após o `304` em `src/utils/static.ts:243-248`):

| Situação | Resposta |
| --- | --- |
| Sem `Range`, `Range` malformado, unidade ≠ `bytes`, múltiplos intervalos, `size` desconhecido, `If-Range` não bate | `200` completo, como hoje |
| `Range` válido e `If-Range` ausente ou batendo | `206` com `Content-Range` e `Content-Length` do intervalo |
| `Range` válido, mas nenhum byte cai no asset (`a ≥ N`, `-0`, `N = 0`) | `416` com `Content-Range: bytes */N` e `Content-Length: 0` |
| `HEAD` com `Range` válido | Igual ao `206`, sem corpo, sem `getContents` |

## 2. Decisões de arquitetura

### D-01 — Onde e como aplicar o Range

**Escolha:** tudo dentro de `serveStatic`. Helpers privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`). O fatiamento acontece depois de `getContents(id)`, sem mudar a assinatura dele (`src/utils/static.ts:33`).

**Alternativas consideradas:**
- *Novo parâmetro em `getContents(id, range)`*: quebra a API pública e o PRD proíbe (Fora de escopo, "Leitura parcial no backend").
- *Handler/middleware separado que embrulha `serveStatic`*: exigiria nova exportação ou um segundo ponto de entrada, e duplicaria a lógica de `304`/`encoding`. Viola RF-11.
- *Helpers em `src/utils/internal/range.ts`*: ver D-09.

### D-02 — Ordem de avaliação

**Escolha:** `304` antes de `Range` (RFC 9110 §13.2.2). Hoje o `304` é decidido em `src/utils/static.ts:243-248`; o bloco de Range entra logo depois dele. `If-Range` só é lido quando há `Range` (RFC 9110 §13.1.5). `Range` só vale para `GET` e `HEAD`, que já são os únicos métodos que chegam até aqui (`src/utils/static.ts:116-122`).

**Por quê:** RF-09 exige que `If-None-Match: "v1"` com `Range` continue dando `304`. Colocar Range antes do cache quebraria isso e a regra da RFC.

### D-03 — Análise de `Range` (função pura, privada)

**Escolha:** uma função pura que recebe o cabeçalho e o tamanho e devolve o intervalo, `"unsatisfiable"` ou `undefined` (ignorar). Regras:

1. Só `bytes=` (unidade sem distinção de caixa). Outra unidade → ignorar.
2. Um único intervalo. Vírgula → ignorar (RF-06, multipart fora de escopo).
3. Formas aceitas, por regex estrita sobre dígitos: `a-b`, `a-` e `-k`. `-` vazio, sinais, espaços internos, `a-b` com `b < a` (RFC 9110 §14.1.1: intervalo sintaticamente inválido → ignorar o cabeçalho inteiro) → ignorar.
4. Números que não são inteiros seguros → ignorar.
5. Com `N = size`:
   - `N = 0` → `"unsatisfiable"` para qualquer intervalo válido (decisão alinhada à premissa do PRD; ver §7).
   - `a-b`: `a ≥ N` → `"unsatisfiable"`; senão `end = min(b, N - 1)`.
   - `a-`: `a ≥ N` → `"unsatisfiable"`; senão `end = N - 1`.
   - `-k`: `k = 0` → `"unsatisfiable"`; senão `start = max(N - k, 0)`, `end = N - 1`.

**Alternativas:** usar uma lib de parsing de Range (ex.: `range-parser`). Descartada: o projeto tem duas dependências de produção e o núcleo deve ficar mínimo (AGENTS.md, "Minimal core").

### D-04 — `If-Range`: comparação forte

**Escolha:** função privada `matchesIfRange(value, validators)`:

- valor começa com `W/` → não bate (RFC 9110 §13.1.5: validador fraco nunca casa);
- valor começa com `"` → bate só se `meta.etag` existir, **não** começar com `W/` e for igual, caractere a caractere, ao valor (`"v1"` contra `"v1"`);
- caso contrário, tenta data: só bate se o valor for exatamente o `toUTCString()` de uma data e essa data for igual ao `mtimeDate` (já truncado em segundos, `src/utils/static.ts:227-232`). Formato não exato (ex.: ISO) → não bate.
- sem `meta.etag` nem `mtimeDate` → não bate.

**Por quê o formato estrito de data:** `Date.parse` aceita formatos soltos e poderia casar uma data que o cliente não pretendia.

**Alternativa:** usar `isCacheMatch` de `src/utils/internal/cache.ts:29` (que hoje só faz `If-None-Match`/`If-Modified-Since` fraco). Descartada: `If-Range` exige comparação forte e o `isCacheMatch` faz a fraca para `ETag`; reaproveitar geraria a comparação errada (risco do PRD, linha "Comparação de If-Range errada").

### D-05 — Como o fatiamento do corpo é feito

**Escolha:** função privada `sliceBody(contents, start, length)`, despachada por tipo do `BodyInit`:

| Tipo | Estratégia | Custo |
| --- | --- | --- |
| `Blob` (inclui `File`) | `contents.slice(start, start + length)` | Sem leitura do arquivo inteiro |
| `string` | `new TextEncoder().encode(contents).subarray(start, start + length)` | Um encode |
| `ArrayBuffer` | `new Uint8Array(contents, start, length)` | Sem cópia |
| `ArrayBufferView` | `new Uint8Array(contents.buffer, contents.byteOffset + start, length)` | Sem cópia |
| `ReadableStream` | `pipeThrough(new TransformStream(...))` que descarta `start` bytes e emite `length`, e encerra quando completa (cancelando a origem) | Lê e descarta até `start` |
| Outros (`FormData`, `URLSearchParams`) | `(await new Response(contents).blob()).slice(...)` | Lê tudo; caso raro para asset |

Chunks de `ReadableStream` são tratados como `Uint8Array`, como o Fetch define para corpos binários.

**Alternativas:** sempre `new Response(contents).arrayBuffer()` e `subarray`. Descartada: carrega o arquivo inteiro na memória em todo `206`, inclusive para vídeo, exatamente o pior caso do PRD.

### D-06 — Cabeçalhos são gravados em `event.res.headers`, não no `HTTPResponse`

**Escolha:** todo cabeçalho de Range (`accept-ranges`, `content-range`, `content-length`) é gravado com `event.res.headers.set(...)`. O `HTTPResponse` recebe só `status`.

**Por quê:** ao montar a resposta, `event.res.headers` é mesclado por cima dos cabeçalhos do `HTTPResponse` (`src/response.ts:202-204` e `mergeHeaders` em `src/response.ts:243-251`). O `content-length` já gravado em `src/utils/static.ts:268-270` com o tamanho do asset sobrescreveria um `content-length: 0` passado no `HTTPResponse` do `416`. O `HTTPResponse` vindo de `serveStatic` é devolvido como está (`src/response.ts:304-306`), então a mescla acontece.

**Consequência:** no `206` e no `416`, `content-length` é sobrescrito com `set`, sem a guarda `!get("content-length")` de `src/utils/static.ts:268`. Isso muda a regra do teste `does not overwrite a content-length already set on the response` (`test/static.test.ts:600-617`) **só quando há Range válido**. Sem Range, a regra fica igual, e o teste continua valendo. Ver §7.

### D-07 — `Accept-Ranges` sempre que o asset existe

**Escolha:** `event.res.headers.set("accept-ranges", "bytes")` em todo asset encontrado, depois do `304` e antes do bloco de Range. Segue RF-01 e a issue ("Always advertise"). Não entra em 304 nem em 404/405.

**Alternativa:** anunciar só com `size` conhecido, que é mais honesto (com `size` desconhecido o Range é ignorado, RF-07). Não escolhida porque o PRD e a issue pedem "sempre"; fica como ponto a confirmar (§8).

### D-08 — Compressão pré-comprimida (RF-10)

**Escolha:** nenhuma lógica nova. `meta` já é o da variante escolhida (`src/utils/static.ts:198-208`), então `meta.size` é o tamanho de `app.js.gz`. `content-encoding` (`src/utils/static.ts:264-266`) e `vary` (`src/utils/static.ts:220-225`) continuam como estão, e o Range se aplica à mesma representação.

### D-09 — Helpers ficam em `static.ts`, mesmo passando de 200 linhas

**Escolha:** seguir RF-11 e a issue ("Keep all helper logic private within the serveStatic module"): os helpers ficam em `src/utils/static.ts`, sem exportação.

**Conflito:** AGENTS.md pede "< 200 LoC por arquivo" e helpers internos em `utils/internal/`. `static.ts` já tem 351 linhas (`src/utils/static.ts:351`) e vai ganhar cerca de 120 a 150. **Decisão para o usuário** (§8): manter em `static.ts` (recomendado, obedece ao PRD) ou mover para `src/utils/internal/range.ts`, que também não é exportado por `src/index.ts`.

## 3. Arquivos a alterar

| Arquivo | Mudança | Referência atual |
| --- | --- | --- |
| `src/utils/static.ts` | Bloco de Range depois do `304`; `accept-ranges` em todo asset; helpers privados no fim; nota no JSDoc sobre Range e variantes | Assinatura `:101-104`; `405` `:116-122`; `404` `:210-215`; `vary` `:220-225`; `304` `:243-248`; `content-length` `:268-270`; `HEAD` `:272-274`; `getContents` e `200` `:276-277`; seção de helpers `:280` |
| `src/utils/static.ts` (`StaticAssetMeta`) | Só documentação: `size` é o tamanho em bytes da representação servida (a variante, quando houver). Nenhum campo novo | `:9-15` (`size` em `:13`) |
| `test/static-range.test.ts` | **Novo.** Testes de regressão, `describeMatrix` (web e node) | Padrão em `test/static.test.ts:5-40` e `test/_setup.ts:11-38` |

Arquivos **não** alterados:

- `src/index.ts:193` exporta `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta`. Nada novo entra (RF-11).
- `src/response.ts`: `HTTPResponse` e `toResponse` ficam como estão.
- `src/utils/internal/cache.ts`: `isCacheMatch` e `matchETag` ficam como estão (D-04).
- `test/static.test.ts`: nenhum teste existente usa `Range`, então nenhum precisa mudar. Ajuste só se a suíte mostrar o contrário.

## 4. Contratos e assinaturas

Nenhuma assinatura pública muda. Assinaturas privadas (em `src/utils/static.ts`, sem `export`):

```ts
/** Resultado de `parseRange`: intervalo inclusivo em bytes, `"unsatisfiable"` ou `undefined` (ignorar). */
type ByteRange = { start: number; end: number };

/**
 * RFC 9110 §14.1 / §14.1.1. Devolve o intervalo, "unsatisfiable" (416) ou undefined (ignorar e servir 200).
 * `size` é `meta.size`, já validado como inteiro não negativo.
 */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/**
 * RFC 9110 §13.1.5. Comparação forte. `etag` é `meta.etag` e `lastModified` é o `mtimeDate`.
 */
function matchesIfRange(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/** Devolve o corpo do intervalo, em `BodyInit` (D-05). */
function sliceBody(contents: BodyInit, start: number, length: number): Promise<BodyInit>;
```

Ponto de integração em `serveStatic`, depois de `src/utils/static.ts:248` e de `accept-ranges`:

```ts
// size validado: inteiro não negativo, senão o Range é ignorado (RF-07)
const size = meta.size;
const ifRange = event.req.headers.get("if-range");
const range =
  event.req.headers.has("range") &&
  size !== undefined &&
  Number.isSafeInteger(size) &&
  size >= 0 &&
  (ifRange === null || matchesIfRange(ifRange, { etag: meta.etag, lastModified: mtimeDate }))
    ? parseRange(event.req.headers.get("range")!, size)
    : undefined;

// If-Range que não bate faz o Range ser ignorado por inteiro: nem 206, nem 416 (RFC 9110 §13.1.5)
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range) {
  const length = range.end - range.start + 1;
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  event.res.headers.set("content-length", String(length));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(contents ? await sliceBody(contents, range.start, length) : null, {
    status: 206,
    statusText: "Partial Content",
  });
}
```

Observações sobre o trecho:

- `size` é `number | undefined` e `size !== undefined` é checado antes de `Number.isSafeInteger`. Como `size` é o `meta.size` do asset, `size > 0` não é exigido para o `416`, porque `N = 0` também cai em `"unsatisfiable"`.
- `accept-ranges: bytes` é gravado antes desse bloco, junto com `last-modified`/`etag`, para aparecer também no `416` e no `206`. O `304` sai antes e não o recebe (D-07).
- `statusText` é passado explicitamente porque `sanitizeStatusMessage` cuida do texto, mas o padrão do `304` (`src/utils/static.ts:244-247`) é passar. O helper `sanitizeStatusCode` aceita 206 e 416 (`src/utils/sanitize.ts:17-31`).
- Se `getContents` devolver `null`/`undefined` para um `206`, o corpo é `null`. Isso espelha o `200` atual (`src/utils/static.ts:277`) e fica como risco (§7).
- O fluxo original de `HEAD` e de `200` (`src/utils/static.ts:272-277`) não muda para requisições sem Range válido.

## 5. Estratégia de testes

Todos os testes novos em `test/static-range.test.ts`, com `describeMatrix` (roda em `web` e `node`, `test/_setup.ts:11-38`). Fixture: asset de 10 bytes `"0123456789"`, com `size` consistente com o conteúdo (`size: 10`) e `etag: '"v1"'` em forma de header, para o `If-Range`. Não reutilizar fixtures com `size` inconsistente (`test/static.test.ts:528-543` usa `size: 10` com `"content for ..."`).

Mapeamento RF → testes:

| RF | Testes |
| --- | --- |
| RF-01 | `accept-ranges: bytes` em `GET` e `HEAD` sem `Range` (200) |
| RF-02 | `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345` |
| RF-03 | `bytes=7-` → `7-9`; `bytes=-3` → `7-9`; `bytes=-99` → `0-9` (206); `bytes=5-99` → `5-9` |
| RF-04 | `HEAD` com `bytes=2-5` → 206, corpo vazio, headers do intervalo, `getContents` com `vi.fn` **não** chamado |
| RF-05 | `bytes=10-` e `bytes=10-12` → 416; `bytes=-0` → 416; `content-range: bytes */10`, `content-length: 0`, corpo vazio; asset de `size: 0` com `bytes=0-0` → 416 `bytes */0` |
| RF-06 | `bytes=abc`, `items=0-1`, `bytes=0-1,4-5`, `bytes=5-2`, `bytes=-` → 200 completo, sem `content-range`, `content-length: 10` |
| RF-07 | `getMeta` sem `size` com `bytes=0-9` → 200 completo, sem `content-range` |
| RF-08 | `If-Range: "v1"` → 206; `If-Range: "v0"`, `W/"v1"`, data diferente, data em formato não-HTTP-date → 200 completo |
| RF-09 | `If-None-Match: "v1"` + `Range` → 304 sem corpo; sem asset → 404; com `fallthrough` → próximo handler; `POST` com `Range` → 405 com `allow: GET, HEAD`; com `fallthrough` → próximo handler |
| RF-10 | `encodings: { gzip: ".gz" }`, `app.js.gz` com 20 bytes, `GET /app.js` com `accept-encoding: gzip` e `Range: bytes=0-9` → 206, `content-encoding: gzip`, `content-length: 10`, `content-range: bytes 0-9/20`, `vary: accept-encoding` |
| RF-11 | Teste de contrato: `Object.keys(await import("../src/index.ts"))` e tipos conferidos por revisão (ou `test/unit/` com `expectTypeOf`), comparado com a lista atual |
| RF-12 | Os testes acima, em `web` e `node` |

Testes adicionais (cobrem as decisões):

- **Corpo por tipo (D-05):** o mesmo `bytes=2-5` com `getContents` devolvendo `string`, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream` (em chunks, ex.: `"01"`, `"234"`, `"56789"`). Todos devem dar `2345`. O `ReadableStream` precisa checar `cancel` na origem quando o intervalo termina antes do fim.
- **Ranges e `content-length` explícito (D-06):** `headers: { "content-length": "999" }` com `Range` válido → 206 com `content-length` do intervalo (o override é intencional). Sem `Range`, o teste `test/static.test.ts:600-617` continua passando.
- **`If-Range` sem `Range`:** ignorado, 200 completo.
- **Ordem `304` antes de `416`:** `If-None-Match` casando com `Range: bytes=99-` → 304, não 416.
- **Sem `Range` nenhum:** os testes de `test/static.test.ts` (matriz e `fallthrough`) continuam verdes sem alteração.

Regressão existente:

- Rodar `pnpm vitest run test/static.test.ts test/security.test.ts` antes e depois. `security.test.ts` também usa `serveStatic` (`test/security.test.ts:3`, `:243`, `:274`, `:287`, `:307`, `:338`, `:352`, `:395`).
- Rodar `pnpm lint` e `pnpm typecheck` (`package.json:46` e `:54`).
- No fim, `pnpm test` completo (inclui cobertura).

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow", aplicado ao feature): escrever os testes de RF-02 em diante, confirmar que falham com a implementação atual, depois implementar.

## 6. Entrega de código (resumo)

1. `src/utils/static.ts`: helpers privados (D-03, D-04, D-05), bloco de integração (§4), nota no JSDoc.
2. `test/static-range.test.ts`: testes da §5.
3. Nenhum outro arquivo do código muda.

Sem commit: a tarefa atual é só a spec. Quando a implementação for pedida, o commit deve seguir a regra de atribuição do ambiente.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **Memória e I/O em vídeo grande** (PRD, principal) | `ReadableStream` precisa ler e descartar até `start`; `string`/`ArrayBuffer` podem precisar de encode | D-05 usa `Blob.slice` e `subarray` sempre que possível. Limitação aceita pelo PRD; ranges no backend ficam fora de escopo |
| **`size` inconsistente com o corpo** | `Blob.slice` corta em silêncio; `content-length` pode não bater com o corpo | Confiar em `size` (premissa do PRD). Os testes novos usam fixtures consistentes. Fixtures existentes com `size` falso (`test/static.test.ts:528-543`) não usam Range |
| **`size` em caracteres vs. bytes** | Fixture atual usa `asset:${id}`.length (`test/static.test.ts:18`), que só coincide para ASCII | Documentar que `size` é em bytes (StaticAssetMeta) e usar conteúdo ASCII nos testes |
| **`content-length` explícito sobrescrito no `206`** (D-06) | Quebra a expectativa de "não sobrescrever" quando há Range válido | Escolha deliberada; documentada no código. Sem Range nada muda |
| **`If-Range` com data** | Sem a regra da RFC 9110 §8.8.2.2 (o `Last-Modified` precisa estar ao menos 1 s antes da `Date`), um cliente pode casar uma data fraca | Aceitar só igualdade exata com `mtimeDate`. Registrar a simplificação no código |
| **Validadores preenchidos pelo usuário** | Se `headers` ou um `etag` já definido em `event.res` for diferente de `meta.etag`, o `If-Range` usa `meta.etag` (como o `isCacheMatch`) | Mesmo critério de `isCacheMatch`. Coberto por nota no código |
| **`ReadableStream` cancelado** | Se o cliente desconecta no meio, a origem precisa ser cancelada, senão vaza | Teste de `cancel` na matriz; `TransformStream` com `terminate` |
| **Range sobre gzip** | Um cliente que espera bytes do original pode ver bytes do `.gz` | RFC permite; `vary: accept-encoding` já está presente. Documentar no JSDoc (PRD, risco "Ranges sobre gzip") |
| **`getContents` devolve `null` para `206`** | Corpo vazio com `content-length` do intervalo | Espelha o `200` atual (`src/utils/static.ts:277`). Pode virar `404` numa mudança futura, fora deste escopo |
| **Divergência web/node** | `Blob`, `ReadableStream` e `Headers` podem se comportar diferente | `describeMatrix` roda os dois modos; os testes de corpo por tipo pegam isso |
| **`fixture` com etag `w/123`** (`test/static.test.ts:15`) | Minúsculo, não é um ETag válido (o `W/` da RFC é maiúsculo). Pode confundir a leitura do `If-Range` | Os testes novos usam `"v1"`; o fixture antigo não é alterado |
| **Arquivo maior que 200 LoC** (D-09) | Conflito com a convenção do AGENTS.md | Decisão do usuário (§8) |

## 8. Pendências e premissas a confirmar

1. **D-07 — `Accept-Ranges` com `size` desconhecido.** Recomendo manter "sempre" (RF-01, issue). Confirmar.
2. **D-09 — localização dos helpers.** Recomendo `static.ts` (RF-11 e issue). Alternativa: `src/utils/internal/range.ts`, também sem exportação. Confirmar.
3. **Asset de `size: 0`** (premissa "A confirmar", PRD). A spec adota `416` para qualquer `Range` válido, com `content-length: 0` gravado explicitamente. Confirmar.
4. **`bytes=5-2`** (b < a). A spec ignora o cabeçalho (200), seguindo RFC 9110 §14.1.1. O PRD não cobre esse caso; confirmar.
5. **Content-Length explícito com Range válido** (D-06). A spec deixa o Range vencer. Confirmar.

Nenhuma delas bloqueia a implementação: a spec traz a escolha padrão de cada uma.
