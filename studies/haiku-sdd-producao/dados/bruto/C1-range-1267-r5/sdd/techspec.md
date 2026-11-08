# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-13). Esta especificação decide como implementar; não altera código.

## Resumo

`serveStatic` (`src/utils/static.ts`) passa a atender uma única faixa de bytes (`início-fim`, `início-` e `-N`) com `206`, responde `416` para faixas não satisfazíveis e ignora `Range` nos demais casos (múltiplas faixas, unidade diferente, malformado, `If-Range` não correspondente, tamanho desconhecido, variante com `Content-Encoding`). Toda a lógica nova fica privada em `src/utils/static.ts`. Não há exportação nova.

## Decisões de arquitetura

### D-01 — Helpers ficam em `src/utils/static.ts`

- **Alternativa A:** criar `src/utils/internal/range.ts`, como já foi feito com `isCacheMatch` em `src/utils/internal/cache.ts:29`. Segue a convenção de `AGENTS.md` ("helpers internos em `utils/internal/`") e mantém `static.ts` curto.
- **Alternativa B:** colocar os helpers no fim de `src/utils/static.ts`, na seção "Internal Utils" (`src/utils/static.ts:280`).
- **Escolha: B.** O PRD (RF-12) e o pedido ("as funções auxiliares ficam privadas em `src/utils/static.ts`"; "manter toda a lógica auxiliar privada no módulo `serveStatic`") pedem explicitamente o módulo. O arquivo passa de 351 para cerca de 470 linhas, acima da meta de 200 de `AGENTS.md`. Isso fica registrado em R-06 como débito a revisitar.

### D-02 — Ordem de avaliação: `304` antes de `Range`

- **Alternativas:** avaliar `Range` antes da validação de cache, ou depois.
- **Escolha:** `Range` é avaliado depois da checagem `isCacheMatch` (`src/utils/static.ts:243-248`) e antes do retorno de HEAD (`src/utils/static.ts:272`). A RFC 9110 §13.2.2 põe as pré-condições (`If-None-Match`, `If-Modified-Since`) antes de `If-Range` e `Range`. Com isso, `If-None-Match: "abc"` + `Range` continua respondendo `304` (RF-10).

### D-03 — Interpretação de `Range`: uma única faixa, por expressão regular

- **Alternativas:** parser completo de `byte-range-set` (com múltiplas faixas e `multipart/byteranges`); ou parser estrito de uma faixa.
- **Escolha:** parser estrito, sem espaços internos, com a expressão `^bytes=(\d*)-(\d*)$` aplicada ao valor com `trim()`. Ambos os campos vazios (`bytes=-`) são malformados e ignorados. Múltiplas faixas não casam com a expressão e são ignoradas (RF-07). `multipart/byteranges` está fora de escopo.
- **Regras de resolução** (`size` é o `meta.size`):
  - `N-M`: `start = N`, `end = min(M, size - 1)`. Se `N >= size` ou `M < N`, é não satisfazível.
  - `N-`: `start = N`, `end = size - 1`. Se `N >= size`, é não satisfazível.
  - `-N`: se `N = 0`, é não satisfazível. Caso contrário, `start = max(size - N, 0)`, `end = size - 1`.
- **Divergência consciente:** pela RFC 9110 §14.1.1, uma faixa com `last < first` é inválida, e a regra geral é ignorar o `Range` inválido. O PRD (RF-06) exige `416` para `bytes=5-2`. Esta especificação segue o PRD. Ver R-01.

### D-04 — `If-Range`: ETag forte ou data exata

- **Alternativas:** ignorar `If-Range` (não conforme RFC); comparar qualquer ETag com `===`; comparação fraca.
- **Escolha:** `If-Range` é avaliado só quando existe `Range` (RFC 9110 §13.1.5).
  - Se o valor começa com `"` ou `W/`, é ETag. Só casa com um ETag forte do asset: o valor não pode começar com `W/`, o `etag` de `getMeta` também não pode, e os dois precisam ser idênticos.
  - Caso contrário, é data. Casa só se `new Date(valor).getTime()` for igual ao `mtimeDate` (já truncado em segundos em `src/utils/static.ts:232`).
  - Não casar significa ignorar `Range` e responder `200` completo (RF-08).

### D-05 — Fatiamento do corpo por tipo de `BodyInit`

`getContents` não recebe faixa (PRD, premissas), então o corpo devolvido é fatiado depois. Para cada tipo:

| Tipo de `BodyInit` | Estratégia | Memória |
| --- | --- | --- |
| `Blob` (inclui `File`) | `body.slice(start, start + length)` | Nenhuma cópia |
| `ReadableStream` | `sliceStream`: pula `start` bytes e emite `length` bytes, cancelando a origem ao fim | Streaming |
| `string` | `TextEncoder` e `subarray` | Já está na memória |
| `ArrayBuffer` e `ArrayBufferView` | `subarray` sobre a mesma memória | Sem cópia |
| Outros (`FormData`, `URLSearchParams`) | `new Response(body).arrayBuffer()` e `subarray` | Materializa o corpo |

- **Alternativas:** materializar tudo com `new Response(body).arrayBuffer()` (simples, mas carrega arquivos grandes na memória, risco do PRD); converter tudo para `Blob` (não aceita `ReadableStream`); recusar `Range` para streams (viola RF-02 para o caso comum de arquivo servido como stream).
- **Escolha:** a tabela acima. Só `FormData` e `URLSearchParams` são materializados, e são raros como corpo de asset.

### D-06 — `Accept-Ranges` e variantes com `Content-Encoding`

- **Alternativa:** anunciar `Accept-Ranges: bytes` em todo `200`/`206` de asset com `size > 0`, mesmo quando a variante tem `Content-Encoding` (leitura literal de RF-01).
- **Escolha:** anunciar só quando a faixa pode ser atendida, ou seja, `size > 0` e sem `content-encoding` na resposta. Para variantes comprimidas, o `Range` é ignorado (RF-11) e anunciar `bytes` seria dizer ao cliente algo que o servidor não cumpre. RF-09 já exige que a ausência de `size` não gere `Accept-Ranges`, o que mostra que RF-01 é uma regra condicionada. Ver R-02.
- O cabeçalho só é definido quando ainda não existe (`!event.res.headers.has("accept-ranges")`), como os outros cabeçalhos do módulo.

### D-07 — `Content-Length` de `206` e `416`: sobrescrito pelo `serveStatic`

- **Problema:** o `content-length` de `200` só é definido se ainda não existe (`src/utils/static.ts:268-270`), e o teste `test/static.test.ts:600-617` garante que um valor do usuário vence. Em `206`, um `Content-Length` do usuário com o tamanho do arquivo inteiro deixaria a resposta inconsistente.
- **Escolha:** em `206` e `416`, `content-length` é sempre definido com `set`. Em `416` ele vira `0`. O comportamento de `200` não muda. O caso fica documentado e testado (PRD, "Interação com `headers` customizados").

### D-08 — `Range` ignorado quando a resposta tem `Content-Encoding`

- **Escolha:** a condição é `!event.res.headers.has("content-encoding")` avaliada depois de `src/utils/static.ts:264-266`. Assim a regra cobre variante `.gz`/`.br` escolhida pelo `Accept-Encoding`, `meta.encoding` e `content-encoding` vindo de `options.headers`. Nesses casos não há `416` nem `206`, só `200` completo (RF-11).

### D-09 — `getContents` vazio com `Range`

- **Escolha:** se `getContents` devolver `null` ou `undefined` numa requisição GET com faixa, a resposta segue o caminho atual de `200` (`new HTTPResponse(contents || null, { status: 200 })`, `src/utils/static.ts:277`). Não há `206` sem corpo.

### D-10 — Status text e shape do `HTTPResponse`

- `206` usa `statusText: "Partial Content"` e `416` usa `statusText: "Range Not Satisfiable"`, como o `304` já faz em `src/utils/static.ts:244-247`.
- O `HTTPResponse` é construído com o corpo e o status. Os cabeçalhos ficam em `event.res.headers`, que `prepareResponse` mescla ao final (`src/response.ts:202`, `src/response.ts:243`). Não se usa `headers` no init, para não duplicar a origem dos cabeçalhos.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Bloco novo entre o `content-length` (`src/utils/static.ts:268-270`) e o retorno de HEAD (`src/utils/static.ts:272-274`), com `Accept-Ranges`, resolução de `Range`, `416`, `206` para HEAD e GET. Helpers privados no fim do arquivo (`src/utils/static.ts:280` em diante). Doc de `size` em `StaticAssetMeta` (`src/utils/static.ts:13`), só comentário. |
| `test/static-range.test.ts` | Arquivo novo com `describeMatrix` (ver seção de testes). |
| `test/static.test.ts` | Nenhuma alteração prevista. Nenhum teste atual envia `Range` a `serveStatic` (verificado: as ocorrências de `range` em `test/` estão em `test/rules/cache.test.ts:1214` e `test/unit/sanitize.test.ts:12`, sem `serveStatic`). |
| `src/index.ts` | Nenhuma alteração. `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. |
| `docs/4.examples/serve-static-assets.md` | Opcional, fora do escopo do PRD. Não incluído. |
| `CHANGELOG.md` | Não editar (gerado pelo processo de release). |

## Contratos e assinaturas

Todas as assinaturas abaixo são privadas em `src/utils/static.ts` e não entram em `export`. `ServeStaticOptions` e `serveStatic` não mudam.

```ts
// Faixa resolvida, com início e fim inclusivos (bytes).
type ByteRange = { start: number; end: number };

// Expressão de uma única faixa (D-03). Ambos os campos vazios são inválidos.
const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

// Interpreta o cabeçalho Range. `undefined` = ignorar (malformado, outra unidade,
// múltiplas faixas). "unsatisfiable" = responder 416.
function parseRangeHeader(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

// Decide se o Range vale para esta resposta, considerando If-Range (D-04).
// Só é chamada com size > 0 e sem content-encoding (D-08).
function resolveRange(
  headers: Headers,
  validators: { size: number; etag?: string; lastModified?: Date },
): ByteRange | "unsatisfiable" | undefined;

// Avalia If-Range contra os validadores atuais (D-04).
function isIfRangeMatch(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

// Recorta o corpo para a faixa (D-05). `length` é end - start + 1.
function sliceBody(body: BodyInit, start: number, length: number): Promise<BodyInit>;

// Recorte por stream: pula `start` bytes, emite `length` bytes e cancela a origem.
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  length: number,
): ReadableStream<Uint8Array>;

// Monta o 206: define content-range e content-length (D-07) e retorna HTTPResponse 206.
function toPartialResponse(
  event: H3Event,
  range: ByteRange,
  size: number,
  body: BodyInit | null,
): HTTPResponse;
```

### Fluxo dentro de `serveStatic` (depois de `src/utils/static.ts:270`)

```ts
const size = meta.size ?? 0;
const rangeable = size > 0 && !event.res.headers.has("content-encoding");
if (rangeable && !event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
const range = rangeable
  ? resolveRange(event.req.headers, { size, etag: meta.etag, lastModified: mtimeDate })
  : undefined;

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (event.req.method === "HEAD") {
  return range
    ? toPartialResponse(event, range, size, null)
    : new HTTPResponse(null, { status: 200 });
}

const contents = await options.getContents(id);
if (range && contents) {
  return toPartialResponse(
    event,
    range,
    size,
    await sliceBody(contents, range.start, range.end - range.start + 1),
  );
}
return new HTTPResponse(contents || null, { status: 200 });
```

Pontos do fluxo:

- O `416` vem antes do HEAD, porque ambos respondem sem corpo (RF-06 e RF-05).
- Um HEAD com faixa não chama `getContents` (teste específico, abaixo).
- Um `Range` sem `contents` cai no `200` atual (D-09).
- Os cabeçalhos `etag`, `last-modified`, `content-type` e `vary` já são definidos antes deste bloco. O `206` herda todos eles, como a RFC exige para validadores.

## Estratégia de testes

Seguindo `AGENTS.md` ("Bug Fix Workflow"), os testes novos são escritos primeiro e precisam falhar antes da implementação.

**Arquivo novo:** `test/static-range.test.ts`, com `describeMatrix("serve static range", ...)` (padrão de `test/static.test.ts:5`). Cada caso roda em `web` e `node`.

**Fixture:** asset de 1000 bytes com conteúdo determinístico (`Uint8Array` com `i % 256`), `size: 1000`, `etag: '"abc"'` e `mtime` fixo. `getContents` é `vi.fn` para verificar chamadas.

**Casos (mapeamento para o PRD):**

1. Accept-Ranges em 200 e em 206; ausente sem `size` (RF-01, RF-09).
2. `bytes=0-99` → `206`, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo com exatamente os bytes 0 a 99 (RF-02).
3. `bytes=900-` → `bytes 900-999/1000`; `bytes=-200` → `bytes 800-999/1000` (RF-03).
4. `bytes=500-9999` → `bytes 500-999/1000`, `content-length: 500` (RF-04).
5. HEAD com `bytes=0-99` → `206`, corpo vazio, `getContents` não chamado (RF-05).
6. `bytes=1000-1100`, `bytes=-0`, `bytes=5-2` → `416`, `content-range: bytes */1000`, `content-length: 0`, corpo vazio (RF-06).
7. `bytes=0-10,20-30`, `items=0-10`, `bytes=abc` → `200` completo, `content-length: 1000`, sem `content-range` (RF-07).
8. `If-Range` com ETag diferente → `200`; com `"abc"` → `206`; com `W/"abc"` → `200`; com data igual ao `Last-Modified` → `206`; com data diferente → `200` (RF-08, D-04).
9. `getMeta` sem `size` e com `size: 0` → `200` completo, sem `Accept-Ranges` (RF-09).
10. `If-None-Match: "abc"` + `Range` → `304`; POST → `405` com `allow: GET, HEAD`; `fallthrough: true` sem asset → `undefined` (RF-10).
11. Variante `.gz` escolhida por `Accept-Encoding: gzip` + `Range` → `200` completo com `content-encoding: gzip`, sem `content-range`; `meta.encoding` definido também ignora `Range` (RF-11, D-08).
12. Tipos de corpo: o mesmo `bytes=10-19` com `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` e `FormData` devolve os mesmos 10 bytes (D-05). Para `ReadableStream`, o teste também confirma que o recorte para cedo e não lê o corpo inteiro (via `pull` contado).
13. `206` preserva `etag`, `last-modified` e `content-type` do `200` (D-10).
14. `content-length` definido pelo usuário em `options.headers` é sobrescrito em `206` e `416` (D-07). O teste existente `test/static.test.ts:600-617` continua verificando o caso `200`.
15. Limites de `Range` para a regra de `416` em `size` pequeno: asset de 1 byte com `bytes=0-0` → `206`, `bytes=1-` → `416`.

**Regressão e guardas:**

- `pnpm vitest run test/static.test.ts test/static-range.test.ts`: a suíte atual de `static` deve passar sem alterações.
- `pnpm vitest run test/unit/package.test.ts`: snapshot de exports inalterado (RF-12).
- `pnpm vitest run test/rules/cache.test.ts`: confirma que o bypass de `Range` no cache não mudou.
- `pnpm typecheck` e `pnpm lint` (`oxlint` e `oxfmt --check`).
- `pnpm test` completo com cobertura.

## Riscos

- **R-01 — `bytes=5-2` (416 vs. ignorar).** O PRD exige `416`. A RFC 9110 §14.1.1 trata `last < first` como faixa inválida, que deveria ser ignorada. Esta especificação segue o PRD. Para mudar para a RFC, basta trocar o ramo `M < N` de `"unsatisfiable"` para `undefined` em `parseRangeHeader` e ajustar o caso 6. **Precisa de confirmação do time.**
- **R-02 — `Accept-Ranges` em variantes comprimidas.** D-06 deixa de anunciar `bytes` nessas respostas, o que diverge da leitura literal de RF-01. Efeito: clientes não tentam `Range` em `.gz`, o que é o comportamento desejado. **Precisa de confirmação.**
- **R-03 — Memória.** `Blob` e `ReadableStream` são fatiados sem carregar o arquivo inteiro. `string`, `ArrayBuffer` e views já estão na memória. `FormData` e `URLSearchParams` são materializados. Não há limite de tamanho no código; o uso esperado é o de arquivo estático.
- **R-04 — `size` deve ser igual ao número de bytes do corpo.** `Content-Range` e `Content-Length` vêm de `meta.size`, não de `contents`. Um `string` com caracteres multibyte (`size` calculado com `.length`, como nos fixtures de `test/static.test.ts:18`) produz `Content-Range` errado, e o mesmo vale para `FormData`, cujo corpo inclui boundary. Isso já é verdade para `Content-Length` no `200`. A documentação de `StaticAssetMeta.size` deve dizer que o valor é o tamanho em bytes do corpo devolvido por `getContents`.
- **R-05 — ETags sem aspas.** Os fixtures usam `etag: "w/123"` sem aspas, que não é um ETag válido pela RFC 9110 §8.8.3. Um `If-Range` com esse valor cai no ramo de data, não casa e responde `200`. É o lado seguro da falha: o cliente recebe o arquivo inteiro. Não é coberto por nenhum caso do PRD; fica registrado.
- **R-06 — Tamanho do arquivo.** `src/utils/static.ts` cresce de 351 para cerca de 470 linhas, acima da meta de 200 em `AGENTS.md`. Mover os helpers para `src/utils/internal/range.ts` seria a solução natural, mas conflita com RF-12. Recomendo revisitar depois que a feature estiver fechada.
- **R-07 — Precisão da data em `If-Range`.** `mtimeDate` é truncado em segundos (`src/utils/static.ts:232`), e `Last-Modified` é gerado a partir dele. Um cliente que ecoa `Last-Modified` casa. A RFC 9110 §13.1.5 também exige que a data seja forte (pelo menos 1 segundo antes do `Date` da resposta), o que não é verificado aqui. Efeito: no pior caso, um cliente recebe `206` quando deveria receber `200` com um arquivo alterado no mesmo segundo.
- **R-08 — Interação com `h3/rules/cache`.** `src/rules/cache.ts:148` já desvia de cache qualquer requisição com `Range`, então a mudança não altera o cache de regras. Se um cache externo à frente do `serveStatic` ignorar `Range`, o comportamento é o mesmo de hoje.
- **R-09 — Diferenças entre runtimes.** `Blob.slice`, `ReadableStream` e `Response` se comportam de forma diferente em Node e na web. Por isso os casos 12 e 2 rodam nos dois runtimes, e a estratégia de fatiamento só é aceita se passar nos dois.
- **R-10 — Regressão em `200`.** A lógica nova mexe em `content-length` e no ramo de HEAD, que são usados pelos `200` atuais. Os testes existentes em `test/static.test.ts` (incluindo `content-length`, `vary` e `fallthrough`) são a primeira barreira, e não precisam ser alterados.
