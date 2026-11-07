# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-11). Este documento define como implementar. Não altera código do projeto.

## Visão geral

Toda a mudança fica em `src/utils/static.ts`, dentro de `serveStatic`, com helpers privados ao módulo. Nenhuma assinatura pública muda (`serveStatic`, `ServeStaticOptions`, `StaticAssetMeta`). O corpo do asset continua vindo de `getContents(id)` completo; o fatiamento é feito em `serveStatic`.

Fluxo resultante (as etapas novas estão marcadas com `[novo]`):

1. Cabeçalhos de `options.headers` e checagem de método (`src/utils/static.ts:105-122`), inalterado.
2. Checagem de caminho canônico (`src/utils/static.ts:142-147`), inalterado.
3. Busca de meta e variantes (`src/utils/static.ts:192-215`), inalterado.
4. `Vary`, `last-modified`, `etag` (`src/utils/static.ts:220-241`), inalterado.
5. 304 via `isCacheMatch` (`src/utils/static.ts:243-248`), inalterado e com precedência sobre Range.
6. `content-type` e `content-encoding` (`src/utils/static.ts:250-266`), inalterado.
7. `content-length` a partir de `meta.size` (`src/utils/static.ts:268-270`), inalterado.
8. `[novo]` `accept-ranges: bytes` nas respostas de asset que não são 304.
9. `[novo]` Resolução do Range: 206, 416 ou ignorado.
10. HEAD (`src/utils/static.ts:272-274`) passa a usar o status resolvido, sem chamar `getContents`.
11. `getContents` (`src/utils/static.ts:276-277`) e, se houver Range, fatiamento do corpo.

## Decisões de arquitetura

### D-01 — Helpers privados no próprio `static.ts`

**Escolha:** a lógica de Range (parse, If-Range, fatiamento) fica em `src/utils/static.ts`, no fim do arquivo, depois de `idSearchPaths` (`src/utils/static.ts:340-351`), na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts`. É o que `AGENTS.md` sugere para arquivos acima de 200 LoC.
- Manter no arquivo.

**Justificativa:** `pedido.md` (linha de restrições) e `prd.md` RF-10 pedem explicitamente que os auxiliares fiquem privados em `static.ts`. Um módulo interno separado não quebraria a API pública, mas contraria o pedido literal. O arquivo já tem 352 linhas e vai crescer em torno de 120. Isso fica registrado como risco (R-07).

### D-02 — Fatiamento do corpo por tipo, sem alterar `getContents`

**Escolha:** `getContents` continua devolvendo o conteúdo completo. Um helper `sliceBody` converte o `BodyInit` pelo tipo:

| Tipo de `contents`                  | Como fatiar                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `null` / `undefined`                | devolve `null`                                                           |
| `string`                            | `textEncoder.encode(s)` (UTF-8) e `subarray` pelos bytes do intervalo     |
| `ArrayBuffer`                       | `new Uint8Array(buf).subarray(...)`                                       |
| `ArrayBuffer.isView(x)` (typed array / `DataView`) | `new Uint8Array(x.buffer, x.byteOffset, x.byteLength).subarray(...)` |
| `Blob`                              | `blob.slice(start, end + 1)`                                              |
| `ReadableStream`                    | `sliceStream`: lê e descarta até `start`, emite até `end`, cancela o restante |
| outros (`FormData`, `URLSearchParams`) | `new Response(body).blob()` e depois `slice`, com buffer completo           |

**Alternativas consideradas:**
- Bufferizar tudo com `new Response(contents).arrayBuffer()` e fatiar. É simples, mas carrega o arquivo inteiro em memória também para `ReadableStream`.
- Mudar `getContents` para receber `{ start, end }`. Rejeitado: `prd.md` está fora de escopo e a issue pede nenhuma mudança de API.

**Justificativa:** a tabela cobre os tipos que `serveStatic` já aceita (`prd.md` premissas). Stream continua streaming. O custo de ler e descartar bytes antes de `start` está documentado em R-01.

### D-03 — `content-range` e `content-length` vão em `event.res.headers`, não no `HTTPResponse`

**Escolha:** os cabeçalhos de 206 e 416 são gravados com `event.res.headers.set(...)`, sobrescrevendo o `content-length` que `serveStatic` já gravou em `src/utils/static.ts:268-270`.

**Motivo técnico verificado:** em `src/response.ts:201-204` e `src/response.ts:243-252`, `mergeHeaders(res.headers, preparedHeaders)` faz `target.set(...)` com `preparedHeaders` (o `event.res.headers`) por último. Ou seja, o que está em `event.res.headers` prevalece sobre o `HTTPResponse.headers`. Se o `content-length` fosse passado no `init` do `HTTPResponse`, o valor de `meta.size` venceria.

**Alternativa rejeitada:** passar `headers` no `init` do `HTTPResponse`. Não funciona pelo motivo acima.

**Caso de borda:** o `content-length` do chamador em `options.headers` (`test/static.test.ts:600-617`) continua valendo para 200. Para 206 e 416, `set` sobrescreve, como manda `prd.md` premissas.

### D-04 — Ordem de precedência

**Escolha:** a resolução de Range acontece depois de `isCacheMatch` (`src/utils/static.ts:243-248`) e depois de `content-encoding`. Ordem final:

1. Método (405) e caminho canônico (404).
2. Asset inexistente (404) e `fallthrough`.
3. 304 (`If-None-Match` / `If-Modified-Since`).
4. Range: 206, 416 ou ignorado.

**Justificativa:** `prd.md` RF-08 exige que 304 tenha prioridade sobre Range e que 404, 405 e `fallthrough` não mudem.

### D-05 — Pré-comprimido é detectado por `content-encoding` na resposta

**Escolha:** o Range é ignorado quando `event.res.headers.has("content-encoding")` é verdadeiro depois de `src/utils/static.ts:264-266`. Isso cobre `meta.encoding` e também `content-encoding` vindo de `options.headers`.

**Alternativas consideradas:**
- Checar `id !== assetId` (variante `.gz`/`.br` escolhida em `src/utils/static.ts:192-205`). Cobre só o caso da variante em disco. Não cobre um backend que devolve conteúdo já comprimido com `meta.encoding`.

**Justificativa:** RF-09 fala em "variante pré-comprimida (com `Content-Encoding` definido)". Ranges sobre bytes comprimidos não são descomprimíveis isoladamente, então o critério precisa ser o cabeçalho que o cliente recebe. Consequência para testes: ver R-04.

### D-06 — `Accept-Ranges` em todas as respostas de asset que não são 304

**Escolha:** `event.res.headers.set("accept-ranges", "bytes")` depois do bloco de 304 e antes da resolução de Range. Isso cobre 200, 206, 416 e HEAD.

**Alternativas consideradas:**
- Colocar também na 304. Não exigido por `prd.md` RF-01, que lista 200, 206 e 416.
- Colocar só quando `meta.size > 0`. Rejeitado: `issue` pede "sempre anunciar". Clientes podem usar o cabeçalho para decidir se tentam Range.

### D-07 — Sem `Vary` novo e sem mudança de cache

**Escolha:** não acrescentar `Vary: range` nem alterar `isCacheMatch` (`src/utils/internal/cache.ts:29-49`) nem a lógica de `vary` (`src/utils/static.ts:220-225`).

**Alternativa considerada:** `Vary: range` em todas as respostas de asset. Rejeitada: altera a chave de cache de todas as respostas, inclusive as 200 que não mudam, o que contraria "preservar caching". O RFC 9110 já trata 206 como resposta cacheável sob a mesma URL, e a questão fica documentada em R-05.

### D-08 — Parse estrito de `Range` e de `If-Range`

**Escolha para `Range`:**
- Unidade case-insensitive, e só `bytes`.
- Um único intervalo, sem vírgula. Multi-range cai em "ignorar" pela própria gramática.
- Grammar aceita: `bytes=<a>-<b>`, `bytes=<a>-`, `bytes=-<n>`. Ambos vazios é inválido e cai em "ignorar".
- Espaços em volta não são aceitos. A gramática não os permite.
- `<b>` menor que `<a>` é sintaticamente inválido e cai em "ignorar".

**Escolha para `If-Range`:**
- Se começa com `"` ou com `W/"`, é entity-tag: só vale se for forte (não começa com `W/`) e for igual a `meta.etag`. Comparação exata.
- Caso contrário, é data: vale se for igual, como string, ao valor de `last-modified` que o cliente receberá (`event.res.headers.get("last-modified")`).
- Valor não reconhecido ou não correspondente: ignora o Range e responde 200 completo.

**Justificativa:** `prd.md` RF-05 e RF-07. Usar o `last-modified` que de fato sai na resposta evita divergência quando o chamador define o cabeçalho manualmente.

### D-09 — 416 sem chamar `getContents`

**Escolha:** para 416 não se chama `getContents`. Para HEAD também não. Só se chama em GET com 200 ou 206.

**Justificativa:** evita I/O desnecessário e segue `prd.md` RF-04 e RF-06.

## Contratos e assinaturas

### Públicos (inalterados)

```ts
// src/utils/static.ts (sem alteração de assinatura)
export interface StaticAssetMeta { type?; etag?; mtime?; size?: number; encoding?: string; }
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType?; }
export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

`src/index.ts:193` continua exportando os mesmos três nomes. Nada novo.

**Única mudança documental pública:** a JSDoc de `getMeta` e `getContents` (`src/utils/static.ts:19-33`) passa a dizer que:
- `size` é o número de bytes do conteúdo que `getContents` devolve, e para string conta bytes UTF-8, não caracteres;
- `getContents` devolve o conteúdo completo, mesmo para pedidos com Range.

### Privados (novos, em `src/utils/static.ts`, fim do arquivo)

```ts
/** Intervalo inclusivo, já limitado a [0, size - 1]. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Resolve o `Range` da requisição.
 * - `ByteRange`: responder 206.
 * - `"unsatisfiable"`: responder 416.
 * - `undefined`: ignorar Range e responder 200 completo.
 */
function resolveRange(
  event: H3Event,
  size: number,
  etag: string | undefined,
): ByteRange | "unsatisfiable" | undefined;

/** Interpreta um `Range` (RFC 9110 §14.1.1, §14.2) para um arquivo de `size` bytes. */
function parseByteRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Avalia `If-Range` contra o ETag forte e o `last-modified` da resposta. */
function matchesIfRange(event: H3Event, ifRange: string, etag: string | undefined): boolean;

/** Fatia o `BodyInit` para o intervalo, em bytes. */
function sliceBody(body: BodyInit | null | undefined, range: ByteRange): Promise<BodyInit | null>;

/** Fatia um `ReadableStream` sem bufferizar o conteúdo inteiro. */
function sliceStream(stream: ReadableStream<any>, range: ByteRange): ReadableStream<Uint8Array>;
```

`resolveRange` recebe `meta.etag` para avaliar `If-Range` (D-08). O contrato de retorno acima é o que precisa ser mantido.

### Trecho de `serveStatic` (esboço, não código final)

```ts
  event.res.headers.set("accept-ranges", "bytes");

  const range = meta.size ? resolveRange(event, meta.size, meta.etag) : undefined;
  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }
  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    event.res.headers.set("content-length", String(range.end - range.start + 1));
  }

  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, range ? { status: 206, statusText: "Partial Content" } : { status: 200 });
  }

  const contents = await options.getContents(id);
  if (range) {
    return new HTTPResponse(await sliceBody(contents, range), { status: 206, statusText: "Partial Content" });
  }
  return new HTTPResponse(contents || null, { status: 200 });
```

Condições de `resolveRange` que devolvem `undefined` (ignorar):
- sem cabeçalho `Range`;
- `event.res.headers.has("content-encoding")` (D-05);
- `If-Range` presente e não correspondente (D-08).

A checagem `meta.size > 0` (RF-05) já está em `src/utils/static.ts:268`. Aqui basta testar `meta.size` truthy, pois `0` e `undefined` não passam.

## Arquivos a alterar

| Arquivo | O que muda | Referência |
| ------- | ---------- | ---------- |
| `src/utils/static.ts` | Inserir `accept-ranges`, resolução de Range, HEAD e corpo 206/416; JSDoc de `getMeta`/`getContents`; helpers no fim | `src/utils/static.ts:19-33` (JSDoc), `:243-248` (304, precede Range), `:264-266` (content-encoding, D-05), `:268-270` (content-length, sobrescrito em 206/416), `:272-274` (HEAD), `:276-277` (corpo), `:340-351` (fim, onde entram os helpers) |
| `test/static.test.ts` | Novo `describeMatrix` com fixture sem `encodings` e sem `encoding` em meta; anexar no fim | `test/static.test.ts:5-31` (fixture atual, usa `encoding: "utf8"` em `:14` e `encodings` em `:22`), `:678` (fim do arquivo) |

Arquivos **não** alterados e por quê:
- `src/index.ts:193`: exports iguais (RF-10).
- `src/utils/internal/encoding.ts:7`: reutiliza `textEncoder` exportado, sem mudança.
- `src/utils/internal/cache.ts:29-49`: `isCacheMatch` inalterado (D-07).
- `src/response.ts:201-204, 243-252`: comportamento de merge é só lido, não alterado (D-03).
- `test/unit/package.test.ts:4`: snapshot de exports roda sem mudança e serve de verificação para RF-10.
- `test/rules/cache.test.ts:1214`: teste de `Range` existente, mas em `rules/cache`, fora de escopo.

**Testes existentes:** nenhum teste atual envia `Range` para `serveStatic`. Os `toMatchObject` de `test/static.test.ts:53, 69, 450, 466` continuam válidos com o novo `accept-ranges`. Assim, não é necessário ajustar testes existentes.

## Estratégia de testes

Seguir o fluxo de correção de `AGENTS.md`: escrever os casos novos primeiro e confirmar que falham antes de implementar.

Usar `describeMatrix` (`test/_setup.ts:11-38`) em um novo bloco no fim de `test/static.test.ts`. A fixture deve **não** ter `encodings` e **não** ter `encoding` em meta (D-05), para que os casos de Range não sejam ignorados por `content-encoding`.

Motivo do cuidado com `encodings`: no target `node`, o `fetch` nativo envia `accept-encoding: gzip, deflate` por padrão (comentário em `test/static.test.ts:97`). Com `encodings` configurados, a variante `.gz` seria escolhida e o Range ignorado. Os testes com `encodings` precisam enviar `accept-encoding: identity`.

Casos (mapeados aos RFs):

| Teste | RF | Esperado |
| ----- | -- | -------- |
| GET sem Range | RF-01 | 200, `accept-ranges: bytes`, corpo completo |
| HEAD sem Range | RF-01 | 200, `accept-ranges: bytes`, sem corpo |
| `bytes=100-199` em 1000 bytes | RF-02 | 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo 100..199 |
| `bytes=900-`, `bytes=-50`, `bytes=950-5000` | RF-03 | 206 com `900-999`, `950-999`, `950-999` |
| `bytes=1000-1010`, `bytes=-0` | RF-04 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| `items=0-5`, `bytes=abc`, `bytes=0-1,5-9`, `bytes=5-2` | RF-05 | 200 completo, `content-length: 1000`, sem `content-range` |
| Asset com `size: 0` ou sem `size` e com Range | RF-05 | 200 completo, sem `content-range` |
| HEAD com `bytes=100-199` | RF-06 | 206, cabeçalhos iguais ao GET, corpo vazio, sem chamar `getContents` (com `vi.fn`) |
| HEAD com `bytes=1000-1010` | RF-06 | 416, cabeçalhos iguais ao GET |
| `If-Range: "abc"` com ETag `"abc"` | RF-07 | 206, bytes 0..9 |
| `If-Range: "xyz"` e `If-Range: W/"abc"` | RF-07 | 200 completo |
| `If-Range` com data igual a `last-modified` | RF-07 | 206 |
| `If-Range` com data diferente | RF-07 | 200 completo |
| `Range` com `If-None-Match: "abc"` igual ao ETag | RF-08 | 304 sem corpo |
| `POST` com `Range` | RF-08 | 405 com `allow: GET, HEAD` |
| Asset com `encoding` (ou variante `.gz`) e `Range` | RF-09 | 200 com `content-encoding`, `vary: accept-encoding`, corpo completo |
| Corpo como string com caracteres multibyte (ex.: `"ação"`) | Risco R-02 | `content-length` e `content-range` em bytes UTF-8; corpo do trecho decodifica certo |
| Corpo como `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` | D-02 | mesmo trecho nos quatro tipos |
| `ReadableStream` com chunks que cruzam `start` e `end` | D-02 | trecho exato, cancelamento do restante |
| `options.headers` com `content-length: 999` e Range válido | D-03 | 206 com `content-length` correto (sobrescrito) |
| Chamador define `content-encoding` via `options.headers` | D-05 | Range ignorado |

Além da matriz, para RF-10 rodar `pnpm vitest run test/unit/package.test.ts` (snapshot de exports). Para RF-11 e a verificação final, rodar `pnpm vitest run test/static.test.ts`, `pnpm lint` (oxlint, oxfmt e typecheck, segundo `AGENTS.md`) e a suíte completa `pnpm test` antes de concluir.

## Riscos

- **R-01 — Custo de `ReadableStream`.** Sem offset na API, o `start` é alcançado lendo e descartando bytes. Para arquivos grandes com intervalo no fim, o ganho some. **Mitigação:** documentar no JSDoc de `getContents`; otimização fica com quem implementa `getContents` (fora de escopo, `prd.md`).
- **R-02 — Strings são bytes UTF-8, não caracteres.** Os fixtures atuais usam `.length` (`test/static.test.ts:18, 237, 411`), o que só é correto para ASCII. Se `size` for calculado assim para conteúdo não ASCII, o `content-range` fica errado. **Mitigação:** `sliceBody` usa `textEncoder` (D-02), teste de multibyte, e JSDoc de `size` (contrato).
- **R-03 — `size` inconsistente com o conteúdo.** Se `size` não bater com `getContents`, o cliente recebe trecho inválido, ou um corpo menor que o `content-length` anunciado. **Mitigação:** documentação em `getMeta`/`getContents`. Não há validação em runtime, pois custaria ler o conteúdo inteiro.
- **R-04 — Conflito entre D-05 e a fixture atual.** O `describeMatrix` de `test/static.test.ts:7-27` usa `encoding: "utf8"` em meta. Por D-05, Range nesse fixture será ignorado. Um teste de Range que reutilize esse fixture falharia. **Decisão a confirmar:** novos testes usam fixture separado (plano acima). Se o usuário preferir Range ativo nesse fixture, D-05 precisa mudar para `id !== assetId`, o que deixa `meta.encoding` sem efeito sobre Range.
- **R-05 — Cache intermediário e 206.** 206 tem o mesmo `etag` e `last-modified` que o 200. Um cache que ignore Range pode servir um trecho no lugar do arquivo. **Mitigação:** D-07 não altera `Vary`. Documentar no JSDoc de `serveStatic` (fora desta mudança de código) é recomendável.
- **R-06 — Node e `accept-encoding` automático.** O `fetch` do Node envia `accept-encoding: gzip, deflate` por padrão (`test/static.test.ts:97`). Testes com `encodings` configurados e sem `identity` mudam de variante e de comportamento de Range. **Mitigação:** fixture sem `encodings` no bloco novo, e `identity` nos casos que tiverem `encodings`.
- **R-07 — Tamanho de arquivo.** `src/utils/static.ts` já tem 352 linhas, acima da meta de 200 LoC de `AGENTS.md`, e vai crescer em cerca de 120. **Decisão tomada:** manter no arquivo, conforme `pedido.md` e RF-10 (D-01). Se o usuário preferir `src/utils/internal/range.ts`, a API pública continua a mesma, pois o módulo não seria reexportado.
- **R-08 — Escopo crescendo.** Multi-range, outras unidades e otimizações de disco são tentadores. **Mitigação:** manter a seção "Fora de escopo" de `prd.md`.
- **R-09 — Divergência entre runtimes.** `Blob.slice`, `ReadableStream` e `Content-Length` podem variar entre Node, Bun, Deno e Workers. **Mitigação:** matriz `web`/`node` (RF-11). Bun, Deno e Workers não estão na matriz de testes; a verificação nesses runtimes fica pendente.
- **R-10 — `If-Range` com data.** A comparação exata de string pode dar 200 quando o cliente manda a mesma data em outro formato. É um erro seguro (200 completo), não um erro de dados.

## Pontos em aberto para o usuário

1. **R-04:** fixture separado para os testes de Range (recomendado) ou Range ativo no fixture atual com `encoding` removido.
2. **R-07:** manter os helpers em `static.ts` (recomendado, segue o pedido) ou extrair para `src/utils/internal/range.ts` (segue a convenção de tamanho de `AGENTS.md`).
