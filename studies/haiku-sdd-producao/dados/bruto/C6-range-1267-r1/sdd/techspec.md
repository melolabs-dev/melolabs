# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md`, `sdd/prd.md` (RF-01 a RF-12, P-01 a P-05, R-01 a R-06). Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests).

## 1. Visão geral

`serveStatic` (`src/utils/static.ts:101`) hoje responde sempre 200 com o corpo inteiro. A mudança acrescenta, depois da checagem de cache (304) e antes da montagem da resposta, uma etapa que:

1. anuncia `Accept-Ranges: bytes`;
2. interpreta `Range` e `If-Range` (somente com `meta.size` conhecido);
3. responde 206 (com fatia do corpo), 416, ou ignora o `Range` e segue o fluxo 200 atual.

Tudo fica em `src/utils/static.ts`. `src/index.ts:193` não muda.

## 2. Decisões de arquitetura

### D-01 — Onde o Range entra no fluxo

**Contexto.** O fluxo atual em `serveStatic` é: método (`static.ts:116`), caminho canônico (`:142`), busca de meta (`:198-215`), `Vary` (`:220-225`), `Last-Modified`/`ETag` (`:227-241`), 304 (`:243-248`), `Content-Type` (`:250-262`), `Content-Encoding` (`:264-266`), `Content-Length` (`:268-270`), HEAD (`:272-274`), conteúdo (`:276-277`).

**Alternativas.**
- (a) Tratar Range antes do 304. Rejeitada: viola RF-07 (304 prevalece) e RFC 9110 §13.2.2 (If-None-Match/If-Modified-Since são avaliados antes de Range/If-Range).
- (b) Tratar Range como middleware ou função separada fora de `serveStatic`. Rejeitada: exigiria exportar algo e o PRD proíbe novas exportações (RF-11).
- (c) Inserir a etapa no próprio `serveStatic`, entre o 304 e o ramo HEAD/`getContents`.

**Escolha: (c).** `Accept-Ranges` é definido logo após o bloco do 304 (`static.ts:248`), para que o 304 continue idêntico ao de hoje. O ramo `Content-Length` (`:268-270`) permanece para o caso 200. O 405 (`:116-122`), o 404/`fallthrough` (`:142-147`, `:210-215`) acontecem antes e portanto ignoram o Range (RF-10), sem código extra.

### D-02 — Respostas 206 e 416 via `HTTPResponse`, não `HTTPError`

**Alternativas.**
- (a) `throw new HTTPError({ status: 416, headers })`. Rejeitada: para status >= 400 o `toResponse` só mescla `errHeaders`, não `event.res.headers` (`src/response.ts:211-213`), e o erro é renderizado como JSON (`errorResponse`, `response.ts:358`), com corpo e `Content-Type` indevidos; o requisito é `Content-Length: 0` sem corpo.
- (b) Retornar `new HTTPResponse(null, { status: 416 })`, como já é feito para 304 (`static.ts:244-247`). Os cabeçalhos de `event.res.headers` são mesclados em `prepareResponse` (`response.ts:195-205`) e o status passa por `sanitizeStatusCode` (`sanitize.ts:17`, aceita 100-599).

**Escolha: (b)** para 206 e 416. Os cabeçalhos `Content-Range` e `Content-Length` são gravados em `event.res.headers`, de onde o `prepareResponse` os mescla com `set`.

### D-03 — Sobrescrever `Content-Length` em 206 e 416

O ramo atual só define `Content-Length` se ausente (`static.ts:268`) e há teste que protege isso (`test/static.test.ts:600-617`, valor 999 definido pelo usuário vence no 200). Para 206 o valor do trecho é obrigatório (R-05), e para 416 é `0`.

**Alternativas.** (a) Respeitar o valor do usuário também em 206: produziria `Content-Length` incoerente com o corpo, quebrando o framing. (b) Sobrescrever apenas em 206/416.

**Escolha: (b).** Em 206/416 usa-se `headers.set("content-length", ...)` incondicional; o 200 mantém a regra atual e o teste de `:600` continua válido sem ajuste.

### D-04 — Ordem de decisão: calcular o intervalo cedo, gravar cabeçalhos tarde

O tipo do corpo só é conhecido após `getContents` (P-01, R-02), e um corpo não fatiável deve cair em 200 completo (RF-05/R-02). Logo, `Content-Range` e `Content-Length` do trecho só podem ser gravados depois que o fatiamento deu certo; antes disso só se calcula `{ start, end }`.

Sequência:
1. `resolveRange(...)` devolve `undefined` (ignorar), `"unsatisfiable"` ou `{ start, end }`.
2. `"unsatisfiable"`: grava `Content-Range: bytes */size`, `Content-Length: 0`, retorna 416 sem chamar `getContents`.
3. `{ start, end }` com HEAD: grava `Content-Range`/`Content-Length` do trecho e retorna `HTTPResponse(null, { status: 206 })`; não chama `getContents` (igual ao HEAD de hoje, `:272-274`).
4. `{ start, end }` com GET: chama `getContents(id)`, tenta `sliceBody`; se devolver corpo, grava cabeçalhos e retorna 206; se não, cai no 200 completo atual.

Observação: no HEAD não há como detectar um corpo não fatiável, então a resposta é 206; é coerente porque o GET equivalente só cai em 200 em casos de backend fora do contrato (ver R-02 abaixo).

### D-05 — Parsing do `Range` (função privada `parseRange`)

**Alternativas.** (a) Dependência externa (ex.: `range-parser`). Rejeitada: o projeto tem 2 dependências de produção e quer núcleo mínimo (`AGENTS.md`). (b) Regex única e validação numérica.

**Escolha: (b).** Contrato:

```ts
type ByteRange = { start: number; end: number }; // inclusivos, já limitados a size - 1

function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;
```

Regras (RFC 9110 §14.1.2, §14.2):
- unidade comparada sem diferenciar maiúsculas; espaços nas pontas ignorados; padrão `^bytes=(\d*)-(\d*)$` após `trim()`. Qualquer outra coisa (outra unidade, lista com vírgula, `bytes=-`, letras) devolve `undefined` (RF-05).
- `inicio-fim` com `fim < inicio` é inválido: `undefined` (a RFC manda ignorar range-spec inválido).
- `inicio >= size` devolve `"unsatisfiable"`; `fim` é limitado a `size - 1`.
- `inicio-`: `end = size - 1`.
- `-sufixo`: `sufixo === 0` devolve `"unsatisfiable"` (RF-04); `sufixo >= size` devolve `{ 0, size - 1 }` (R-06); caso contrário `start = size - sufixo`.
- Números convertidos com `Number`; valores acima de `Number.MAX_SAFE_INTEGER` não precisam de tratamento especial porque só participam de comparações (`>= size`, `Math.min`).

### D-06 — `If-Range` (função privada `ifRangeMatches`)

Contrato:

```ts
function ifRangeMatches(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;
```

- Valor que começa com `"` ou `W/`: é entity-tag. Só coincide se for **forte** (sem `W/`, RFC 9110 §13.1.5) e idêntica, byte a byte, ao `etag` do asset (comparação forte, §8.8.3.2). ETag fraca do asset ou do cliente devolve `false`.
- Caso contrário é data HTTP: coincide só se `new Date(ifRange).getTime()` for **igual** (não `>=`, ao contrário de `isCacheMatch`, `src/utils/internal/cache.ts:45-46`) ao `lastModified` já truncado em segundos (`static.ts:232`). Sem `lastModified` ou com data inválida devolve `false` (fora de escopo no PRD: Range ignorado).
- Os validadores usados são os do **cabeçalho efetivo da resposta** (`event.res.headers.get("etag")` e `"last-modified"`), que são os que o cliente vê, e que são definidos em `static.ts:234-241` com respeito ao que o usuário já pôs em `options.headers` (P-03). `lastModified` é obtido com `new Date(valorDoCabeçalho)`.

**Alternativa rejeitada:** reaproveitar `isCacheMatch`/`matchETag` (`cache.ts:11`, `:29`): usam comparação fraca e `>=`, semântica oposta à de If-Range.

`If-Range` sem `Range` é ignorado. Havendo `If-Range` e falha de validação, o `Range` é ignorado e a resposta é 200 completa (RF-06).

### D-07 — Fatiamento do corpo (função privada `sliceBody`)

Contrato:

```ts
function sliceBody(
  body: BodyInit,
  range: ByteRange,
  size: number,
): BodyInit | undefined; // undefined = formato não suportado, ou tamanho divergente
```

| Tipo do corpo | Estratégia |
| --- | --- |
| `string` | `new TextEncoder().encode(body)`, depois como `Uint8Array` |
| `Uint8Array` / `ArrayBufferView` | `new Uint8Array(buf, byteOffset + start, len)` (visão, sem cópia) |
| `ArrayBuffer` | `new Uint8Array(body, start, len)` |
| `Blob` (inclui `File`) | `body.slice(start, end + 1)` |
| `ReadableStream` | stream novo com contagem de bytes (D-08) |
| outros (`FormData`, `URLSearchParams`, ...) | `undefined` |

Para os tipos de tamanho conhecido (string, buffers, Blob) verifica-se `byteLength === size`; se divergir de `meta.size` devolve-se `undefined` e a resposta é 200 completa. Isso evita 206 com `Content-Range` inconsistente quando o backend informa `size` errado (P-02), sem custo relevante.

**Alternativa rejeitada:** exigir um novo parâmetro de `getContents` com o intervalo, que seria o ideal para arquivos grandes mas cria API pública (fora de escopo no PRD).

### D-08 — Fatiar `ReadableStream` sem carregar tudo em memória (R-01)

`sliceStream(stream, start, end)` devolve `new ReadableStream<Uint8Array>({ pull, cancel })`, com um `reader` do stream original:
- mantém `position`; cada chunk é descartado se termina antes de `start`, cortado com `subarray` se cruza `start` ou `end + 1`, e repassado se está dentro;
- ao passar de `end` chama `reader.cancel()` e `controller.close()`; se o original terminar antes, fecha;
- `cancel()` do novo stream repassa o cancelamento ao original (libera arquivo/socket quando o cliente desconecta).

Memória: no máximo um chunk por vez. Chunks `string` são convertidos com `TextEncoder`; qualquer outro tipo que não seja `Uint8Array` faz o `pull` falhar (backends de arquivo, como `Readable.toWeb` e `Bun.file().stream()`, entregam bytes). Ver R-03.

Para streams o tamanho real não é conhecido, então a verificação de D-07 não se aplica; vale `meta.size` (P-02).

**Alternativa rejeitada:** ler tudo com `new Response(stream).arrayBuffer()` e depois fatiar. Simples, mas pico de memória do tamanho do arquivo; é exatamente o risco R-01.

### D-09 — Variante pré-comprimida (RF-09)

O `size` é o da variante servida (P-02) e o `Content-Encoding` já é gravado em `static.ts:264-266` antes da etapa de Range, portanto continua na 206. Nenhum código extra, só teste. `Vary: accept-encoding` (`:220-225`) também permanece.

### D-10 — `Accept-Ranges` sempre (RF-01, P-04)

`event.res.headers.set("accept-ranges", "bytes")` logo após o 304 (`static.ts:248`), incondicional ao `size`; vale para 200, 206 e 416. Não é gravado no 304, 404, 405 nem `fallthrough`.

Alternativa rejeitada: anunciar só com `size` conhecido. Contraria P-04 e o texto da issue ("Always advertise").

### D-11 — Condição para aplicar o Range

Aplica-se somente se **todas** forem verdadeiras: método GET/HEAD (já garantido em `:116`), `meta.size` é inteiro `> 0` (mesma condição de `:268`, RF-08), há cabeçalho `Range` e, se houver `If-Range`, `ifRangeMatches` retorna `true`. Caso contrário, fluxo 200 atual intacto.

### D-12 — Helpers dentro de `static.ts`, sem arquivo novo

**Alternativas.** (a) Novo `src/utils/internal/range.ts` (convenção de `AGENTS.md`: arquivos curtos, helpers em `utils/internal/`, como `internal/cache.ts`). (b) Seção `// --- Internal Utils ---` já existente em `static.ts:280`.

**Escolha: (b)**, porque RF-11 e o contrato pedem que a mudança e os helpers fiquem no módulo `serveStatic`. Os helpers não levam `export`. Consequência: `static.ts` passa de ~350 para ~500 linhas, acima da meta de 200 do `AGENTS.md` (o arquivo já a excede); registrado como risco R-05.

### D-13 — Sem novas exportações nem opções

`src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`. As interfaces `StaticAssetMeta` (`static.ts:9-15`) e `ServeStaticOptions` (`:17-66`) não mudam. `ByteRange` e demais tipos auxiliares ficam sem `export`. Atenção a `isolatedDeclarations`: funções não exportadas não exigem anotação, mas serão anotadas por clareza.

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Alteração |
| --- | --- | --- |
| `src/utils/static.ts` | `:243-248` (bloco do 304) | inserir `Accept-Ranges` depois do `return` do 304 |
| `src/utils/static.ts` | `:268-277` (Content-Length, HEAD, `getContents`) | inserir resolução do Range (D-04, D-11) antes do HEAD e do `getContents`; 200 mantido como fallback |
| `src/utils/static.ts` | `:280` (`// --- Internal Utils ---`) e depois de `:351` | adicionar `parseRange`, `ifRangeMatches`, `sliceBody`, `sliceStream` |
| `test/static.test.ts` | novo `describeMatrix` após `:524` | casos de RF-01 a RF-10 |
| `test/static.test.ts` | `:42-71`, `:439-467` | ajuste só se necessário (ver seção 5) |

Arquivos consultados e **não** alterados: `src/index.ts:193` (exportações), `src/utils/internal/cache.ts:11,29` (`matchETag`/`isCacheMatch`, mantidos para o 304), `src/response.ts:195-205,211-213,224,234,350` (mescla de cabeçalhos, status e corpo nulo em HEAD, sem mudanças), `src/rules/cache.ts:148` (já ignora requisições com `Range`, sem alteração; fora de escopo), `test/_setup.ts:11` (`describeMatrix`).

## 4. Contratos e assinaturas

API pública (inalterada):

```ts
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Helpers privados (não exportados):

```ts
type ByteRange = { start: number; end: number };

function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;
function ifRangeMatches(ifRange: string, validators: { etag?: string; lastModified?: Date }): boolean;
function sliceBody(body: BodyInit, range: ByteRange, size: number): BodyInit | undefined;
function sliceStream(stream: ReadableStream, start: number, end: number): ReadableStream<Uint8Array>;
```

Tabela de respostas (`size` conhecido):

| Pedido | Status | Cabeçalhos relevantes | Corpo |
| --- | --- | --- | --- |
| sem `Range` | 200 | `Accept-Ranges: bytes`, `Content-Length: size` | completo |
| `bytes=2-5`, size 10 | 206 | `Content-Range: bytes 2-5/10`, `Content-Length: 4` | bytes 2-5 |
| `bytes=2-` / `bytes=-3` | 206 | `bytes 2-9/10` / `bytes 7-9/10` | respectivo |
| `bytes=0-99`, size 10 | 206 | `bytes 0-9/10`, `Content-Length: 10` | tudo |
| `bytes=20-30`, `bytes=-0` | 416 | `Content-Range: bytes */10`, `Content-Length: 0` | vazio |
| malformado, multi, outra unidade | 200 | sem `Content-Range` | completo |
| HEAD com Range válido | 206 | idem 206 | vazio |
| `If-Range` divergente | 200 | sem `Content-Range` | completo |
| `If-None-Match` coincide | 304 | como hoje | vazio |
| `size` ausente ou 0 | 200 | `Accept-Ranges: bytes`, sem `Content-Range` | completo |

## 5. Estratégia de testes

Padrão `describeMatrix` (modos `web` e `node`), em um novo bloco `describeMatrix("serve static range", ...)` em `test/static.test.ts`, com asset de 10 bytes (`"0123456789"`) e `ETag` forte `"v1"`. Os fixtures existentes usam ETag fraca (`w/123`) e `encoding: "utf8"`, portanto o bloco novo define seus próprios `getMeta`/`getContents`.

Casos (um por critério de aceite do PRD):
- RF-01: GET e HEAD sem Range: 200 e `accept-ranges: bytes`.
- RF-02: `2-5`, `2-`, `-3`, `0-99` (clamp), `-100` (sufixo maior que o asset): status, `Content-Range`, `Content-Length` e corpo exatos.
- RF-03: HEAD `0-3`: 206, cabeçalhos, corpo vazio.
- RF-04: `20-30`, `10-`, `-0`: 416, `bytes */10`, `Content-Length: 0`.
- RF-05: `0-1,4-5`, `lines=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=-`: 200 completo, sem `Content-Range`.
- RF-06: `If-Range` com ETag diferente (200), igual (206), ETag fraca (200), data igual a `Last-Modified` (206), data diferente (200), data sem `mtime` (200).
- RF-07: `Range` + `If-None-Match: "v1"`: 304.
- RF-08: `getMeta` sem `size` e com `size: 0`: 200, `accept-ranges` presente, sem `Content-Range`.
- RF-09: `app.js` com `app.js.gz`, `accept-encoding: gzip`, `0-9`: 206, `content-encoding: gzip`, `bytes 0-9/40`, 10 primeiros bytes (corpo como `Uint8Array`/string ASCII).
- RF-10: `POST` + Range: 405 com `Allow: GET, HEAD`; inexistente + `fallthrough`: `undefined` (`next` é chamado), caminho não canônico ignora Range.
- R-05: `options.headers` com `content-length: 999` e Range válido: `Content-Length` do trecho vence na 206; teste existente `:600` (200) segue passando.
- Tipos de corpo (D-07): string com multibyte (`size` em bytes), `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` (várias chunks, intervalo cruzando fronteira de chunks), corpo não suportado (`URLSearchParams`) cai em 200, `size` divergente cai em 200.
- R-01: stream com muitos chunks pequenos; verificar que o `pull` do original para de ser chamado depois do fim do intervalo (contador) e que o cancelamento é propagado.
- R-06: `bytes=0-` com asset de 1 byte; suffix igual ao tamanho.

Testes existentes: o conjunto `serve static` compara cabeçalhos com `toMatchObject` (`test/static.test.ts:53`, `:69`), então o novo `accept-ranges` não os quebra; nenhum ajuste é previsto. Se `pnpm vitest run test/static.test.ts` mostrar falha por `accept-ranges` (ex.: asserção de igualdade total de cabeçalhos), ajustar só a asserção, mantendo o que ela verifica.

Verificação final: `pnpm vitest run test/static.test.ts`, `pnpm vitest run` completo, `pnpm lint`, `pnpm typecheck`. Seguir o fluxo de `AGENTS.md`: escrever testes de regressão primeiro e confirmar que falham antes da implementação.

## 6. Riscos

- **R-01 (memória em streams).** Mitigado por D-08 (um chunk por vez, cancelamento propagado). Resíduo: o backend ainda lê/descarta os bytes iniciais; para ranges no fim de arquivos enormes é O(início). Otimizar exigiria API nova (fora de escopo).
- **R-02 (corpo não fatiável / `size` divergente).** Em GET cai em 200 completo (D-07); em HEAD não há como saber e responde 206. Documentar no JSDoc que `getMeta.size` deve ser o tamanho em bytes da representação servida.
- **R-03 (chunks não binários em stream).** Streams de strings não são suportados no fatiamento; `pull` falharia no meio da resposta (já com cabeçalhos 206 enviados). Mitigação: normalizar chunks de string com `TextEncoder` em `sliceStream`, e rejeitar (erro) qualquer outro tipo.
- **R-04 (`If-Range` e ETag fraca).** O ETag padrão de muitos backends é fraco (`W/`), caso em que nenhuma retomada condicional funciona e o cliente recebe 200 completo. É o comportamento correto da RFC (comparação forte); documentar. A data de `Last-Modified` com precisão de segundo e a igualdade exata são deliberadas.
- **R-05 (tamanho do arquivo).** `static.ts` cresce além da meta de 200 linhas do `AGENTS.md` por exigência do PRD (D-12). Se for aceitável relaxar RF-11, extrair para `src/utils/internal/range.ts` (privado, sem exportar no índice) é uma alternativa de baixo custo.
- **R-06 (regressão em cache/304 e cabeçalhos).** Mitigado por manter a ordem atual (D-01) e `Accept-Ranges` depois do 304 (D-10); testes RF-07 e os existentes cobrem.
- **R-07 (cache intermediário).** Uma 206 carrega `ETag`/`Cache-Control` do asset; caches compartilhados tratam 206 conforme RFC 9111. Não há mudança de política de cache. `src/rules/cache.ts:148` já deixa passar `Range` sem cachear.
- **R-08 (variante pré-comprimida, PRD R-04).** Cliente que muda `Accept-Encoding` entre retomadas pode receber bytes de outra variante; `Vary` e `If-Range` (ETag por variante, se o backend a diferenciar) mitigam. Documentar.
- **R-09 (`Content-Type` e outros cabeçalhos na 416).** A 416 herda `Content-Type`, `ETag` e `Last-Modified` do asset, pois são gravados em `event.res.headers` antes da etapa. É inofensivo; remover `Content-Type` na 416 seria opcional.
