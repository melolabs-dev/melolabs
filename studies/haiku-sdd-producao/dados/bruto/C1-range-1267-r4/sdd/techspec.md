# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md`, `sdd/prd.md`, issue h3js/h3#1267, RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests).

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `f15bdb8`).

## Resumo

`serveStatic` (`src/utils/static.ts:101`) passa a:

1. anunciar `Accept-Ranges: bytes` em toda resposta de asset existente;
2. atender um único intervalo `bytes=` com 206, cortando o corpo dentro do próprio `serveStatic`;
3. responder 416 para intervalos não satisfazíveis;
4. ignorar Range (200 completo) quando o cabeçalho é inválido, tem vários intervalos, falha no `If-Range`, o asset não tem tamanho, ou a representação é codificada.

A API pública não muda: nenhuma exportação nova, nenhuma mudança em `ServeStaticOptions`, `StaticAssetMeta`, `getMeta` ou `getContents`.

## Fluxo de `serveStatic` com Range

A ordem abaixo é a ordem de avaliação. Ela garante RF-08 (304 antes de Range) e evita ler o arquivo quando a resposta é 416.

| Passo | Onde (`src/utils/static.ts`) | Ação |
| --- | --- | --- |
| 1 | `:116-122` | 405 e demais checagens existentes, sem mudança |
| 2 | `:198-215` | Busca de `getMeta`, 404 e fallthrough, sem mudança |
| 3 | `:239-241` | `etag` (já existente) |
| 4 | **novo, após `:241`** | `accept-ranges: bytes` em `event.res.headers` |
| 5 | `:243-248` | 304 por `If-None-Match`/`If-Modified-Since` (existente, anterior ao Range) |
| 6 | `:250-266` | `content-type` e `content-encoding` (existente) |
| 7 | `:268-270` | `content-length` padrão (existente) |
| 8 | **novo, após `:270`** | Decisão de Range: ignorar, 416 ou 206 |
| 9 | `:272-277` | HEAD, `getContents` e 200 (existente, com 206 e 416 antes) |

## Decisões de arquitetura

### D-01 — Helpers privados em `src/utils/static.ts`

- **Escolha:** toda a lógica de Range fica em `src/utils/static.ts`, como funções não exportadas no fim do arquivo, abaixo de `// --- Internal Utils ---` (`src/utils/static.ts:280`).
- **Alternativas:**
  - Criar `src/utils/internal/range.ts`. O `AGENTS.md` aceita isso ("Internal helpers go at the end of files or in `utils/internal/`"), mas o `pedido.md` (seção "Restrições") e o `prd.md` (seção "Premissas") pedem helpers privados ao módulo `serveStatic`.
  - Reaproveitar a lógica de `src/utils/internal/cache.ts`. Descartado: as funções lá não são para Range, e exportá-las mudaria um módulo interno sem necessidade.
- **Justificativa:** segue o contrato explícito do pedido. O arquivo já tem 351 linhas, acima da meta de 200 do `AGENTS.md`, então a divisão em arquivo próprio fica como ação futura, separada desta mudança.

### D-02 — Ordem de avaliação: `Accept-Ranges`, depois 304, depois Range, e só então `getContents`

- **Escolha:**
  - `accept-ranges` é definido antes do bloco de 304 (`src/utils/static.ts:243`), então também sai em 304 e em 416.
  - A decisão de Range fica depois do `content-length` padrão (`src/utils/static.ts:270`) e antes de `getContents` (`src/utils/static.ts:276`).
  - 416 não chama `getContents`, então o arquivo não é aberto.
- **Alternativas:**
  - Calcular o Range antes do 304. Descartado: viola RF-08 (uma requisição condicional que não mudou tem que devolver 304 mesmo com Range).
  - Chamar `getContents` sempre e recortar depois. Descartado: abre o arquivo e lê dados que nunca serão enviados em 416 e em HEAD.
- **Justificativa:** segue a precedência da RFC 9110 e o RF-08 do `prd.md`, e não desperdiça I/O.

### D-03 — Parser de `Range` estrito: um intervalo, unidade `bytes`

- **Escolha:** o cabeçalho é aceito somente se casar com `^bytes=(\d*)-(\d*)$` (flag `i` para a unidade, após `trim()`). Qualquer outra forma é ignorada, o que devolve 200 completo (RF-04):
  - vírgula (vários intervalos);
  - outra unidade (`items=0-1`);
  - ambos os lados vazios (`bytes=-`);
  - início maior que fim (`bytes=5-2`).
- Regras de satisfazibilidade, aplicadas depois da validação sintática:
  - `início >= tamanho` → 416 (RF-05);
  - sufixo `-0` → 416 (RF-05);
  - sufixo `-N` com `N > tamanho` → intervalo `0 .. tamanho-1` (RF-06);
  - `fim >= tamanho` → `fim = tamanho - 1` (RF-02);
  - `início-` → vai até o fim (RF-02).
- **Alternativas:**
  - Aceitar espaços em volta de `=` e `-`. Descartado: a gramática da RFC 9110 §14.1.1 não permite, e o `prd.md` pede rejeição de sintaxe inválida.
  - Aceitar vários intervalos e responder `multipart/byteranges`. Descartado: está fora de escopo (`prd.md`, "Fora de escopo").
- **Justificativa:** o caminho de rejeição é o mesmo que a issue pede ("ignore malformed or multi-range requests and serve the full response"), e a regex deixa claro quais formas são aceitas.

### D-04 — `If-Range` por ETag forte ou por data exata

- **Escolha:** `isIfRangeMatch` devolve `true` apenas quando:
  - o valor começa com `"` e é igual ao `etag` do asset, e o `etag` não é fraco. Fraco é identificado por `W/` no início, a mesma convenção de `opaqueTag` em `src/utils/internal/cache.ts:52`;
  - o valor não começa com `"` e `new Date(valor).getTime()` é igual ao `mtimeDate` já truncado a segundos (`src/utils/static.ts:232`).
  - Qualquer outro caso, inclusive valor inválido, é "não casa": a resposta é 200 completo (RF-07).
- **Alternativas:**
  - Ignorar `If-Range` e sempre aplicar Range. Descartado: a RFC 9110 §13.1.5 existe para evitar juntar partes de versões diferentes do mesmo recurso, e ignorá-la quebra essa garantia.
  - Comparar datas por `<=` (como em `src/utils/internal/cache.ts:46`). Descartado: `If-Range` pede igualdade exata, não "não modificado desde".
- **Justificativa:** segue a RFC 9110 e o RF-07. A precisão de segundos vem do próprio `mtimeDate`, o que resolve o risco de comparação de datas listado no `prd.md`.

### D-05 — Sem Range sobre representação codificada ou variante pré-comprimida

- **Escolha:** Range é ignorado (200 completo) quando qualquer uma destas condições vale:
  - `event.res.headers` tem `content-encoding` no momento da decisão (`src/utils/static.ts:264-266`), que cobre `meta.encoding` e `options.headers`;
  - a variante escolhida não é o asset original, ou seja, `id !== assetId` (`src/utils/static.ts:192-205`).
- **Por que a segunda condição:** hoje `serveStatic` serve `/arquivo.js.gz` sem `Content-Encoding` quando `meta.encoding` não é informado (o cabeçalho depende só de `meta.encoding`, `src/utils/static.ts:264`). Sem a segunda condição, um Range recortaria bytes comprimidos e entregaria 206 sobre um representação que o cliente não consegue decodificar.
- **Alternativas:**
  - Aplicar Range sobre os bytes comprimidos. Descartado: fora de escopo (RF-10 do `prd.md`) e frágil.
  - Só checar `content-encoding`. Descartado: deixa a variante sem cabeçalho passar.
- **Justificativa:** é o comportamento permitido pela RFC 9110 e o que o `prd.md` decidiu.

### D-06 — Corte do corpo por tipo de `BodyInit`, sem mudar `getContents`

- **Escolha:** `sliceContents` trata três casos:
  - `ReadableStream`: passa por um `TransformStream` privado que descarta o prefixo e, ao chegar no fim do intervalo, chama `controller.terminate()`. A especificação de Streams cancela a origem nesse caso, então a leitura para cedo. A memória fica limitada ao tamanho de um chunk.
  - Qualquer outro tipo (string, `ArrayBuffer`, views, `Blob`, `FormData`, `URLSearchParams`): `await new Response(contents).blob()` e depois `blob.slice(start, end + 1)`. `Blob.slice` não copia dados. `Response` cobre todos os tipos de `BodyInit` de forma uniforme, e strings viram bytes UTF-8, o que mantém os offsets corretos para conteúdo não ASCII.
- **Alternativas:**
  - Ler o corpo inteiro e fatiar em todos os casos. Descartado para streams: vídeos grandes seriam carregados inteiros, anulando o objetivo (risco do `prd.md`).
  - Passar o intervalo para `getContents`. Descartado: muda o contrato público, o que está fora de escopo.
- **Justificativa:** mantém o contrato de `getContents` e trata o caso de stream sem ler o arquivo inteiro. O custo do prefixo continua existindo (ver riscos).

### D-07 — `Content-Length` sobrescrito somente em 206 e 416

- **Escolha:** a resposta 206 define `content-length` com `event.res.headers.set(...)`, e 416 define `"0"`. Isso sobrescreve o valor de `options.headers` e o padrão de `src/utils/static.ts:268-270`, que só define quando o cabeçalho está ausente.
- **Alternativas:**
  - Mudar a regra geral para sempre sobrescrever. Descartado: quebraria o teste existente em `test/static.test.ts:600-616`, que garante que um `content-length` explícito vence em HEAD 200.
  - Deixar o `content-length` antigo em 206. Descartado: o valor ficaria igual ao tamanho do arquivo, e a resposta seria inválida.
- **Justificativa:** o valor explícito continua valendo em 200. Só respostas parciais (que descrevem outro tamanho) sobrescrevem, e isso é exigido pela RFC.

### D-08 — Resposta de 416, 206 e HEAD

- **Escolha:**
  - 206: `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`, com `content-range: bytes início-fim/tamanho` e `content-length` do recorte. HEAD recebe o mesmo cabeçalho e corpo `null`.
  - 416: `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `content-range: bytes */tamanho` e `content-length: 0`.
  - Os cabeçalhos ficam em `event.res.headers`, porque `prepareResponse` mescla esses valores por cima dos de `HTTPResponse` (`src/response.ts:203`, função `mergeHeaders` em `src/response.ts:243`). Por isso o `content-length` de D-07 funciona.
- **Alternativas:** definir `content-range` em `HTTPResponse.headers`. Descartado: `event.res.headers` é o mecanismo que `serveStatic` já usa para etag, last-modified e content-length.
- **Justificativa:** segue o padrão do arquivo, e o `HTTPResponse` do 304 (`src/utils/static.ts:244-247`) serve de modelo.

### D-09 — `getContents` devolve vazio em resposta parcial

- **Escolha:** se `getContents` devolver `null`/`undefined` depois de a decisão ter sido 206, a resposta é a mesma de asset inexistente: 404, ou `undefined` com `fallthrough` (`src/utils/static.ts:210-215`). Não se monta um 206 com corpo vazio.
- **Alternativas:**
  - 200 completo sem Range. Descartado: o `content-length` já teria sido sobrescrito para o recorte (D-07), e a resposta ficaria incoerente.
  - 206 com corpo vazio. Descartado: resposta inválida.
- **Justificativa:** `getContents` vazio com `getMeta` presente é uma inconsistência do backend. Tratá-la como ausência é o comportamento mais seguro.

## Arquivos a alterar

### `src/utils/static.ts` (principal)

- `src/utils/static.ts:241`: inserir `event.res.headers.set("accept-ranges", "bytes")` antes do bloco de 304 (D-02).
- `src/utils/static.ts:270`: inserir a decisão de Range (D-03, D-04, D-05, D-07, D-08).
- `src/utils/static.ts:272-277`: manter HEAD e 200 como estão. A decisão de Range já retornou 206, 416 ou seguiu para 200 antes deste bloco.
- `src/utils/static.ts:280` em diante: helpers privados `parseByteRange`, `isIfRangeMatch`, `sliceContents`, `sliceStream`.
- `src/utils/static.ts:1-7`: imports novos, se necessário. `HTTPError` já está importado (`src/utils/static.ts:2`).

### `src/index.ts`

- Nenhuma alteração. `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`.

### `test/static.test.ts`

- Nenhuma alteração obrigatória. Os testes existentes usam `toMatchObject` nos cabeçalhos (`test/static.test.ts:53`, `:69`) e não verificam o conjunto exato de cabeçalhos, então `accept-ranges` extra não os quebra.
- Se algum teste falhar por cabeçalho extra ou por status de HEAD, ajustar só esse teste, sem remover o que ele verifica.

### `test/static-range.test.ts` (novo)

- Arquivo novo, para não crescer `test/static.test.ts` (678 linhas). Segue o padrão `describeMatrix` de `test/_setup.ts:11`.

### `test/unit/package.test.ts`

- Nenhuma alteração. O snapshot de exports (`test/unit/package.test.ts:4`, `:133`) deve continuar igual, o que prova a restrição de "nenhuma exportação nova".

### Fora do escopo, sem mudança

- `src/rules/cache.ts:146-148` já desvia requisições com `Range` do cache de regras. Não há conflito.

## Contratos e assinaturas

Nenhum símbolo novo é exportado. Os helpers abaixo são privados a `src/utils/static.ts`.

```ts
/** Intervalo inclusivo, já limitado ao tamanho do asset. */
type ByteRange = { start: number; end: number };

/**
 * Interpreta o cabeçalho Range para um asset de `size` bytes (size > 0).
 * - `undefined`: ignorar Range (sintaxe inválida, vários intervalos, outra unidade, início > fim).
 * - `{ unsatisfiable: true }`: responder 416.
 * - `ByteRange`: responder 206.
 */
function parseByteRange(header: string, size: number): ByteRange | { unsatisfiable: true } | undefined;

/**
 * Avalia If-Range (RFC 9110 §13.1.5). `true` quando o intervalo pode ser aplicado.
 * ETag forte precisa ser igual ao `etag`; data precisa ser igual a `lastModified` (segundos).
 */
function isIfRangeMatch(ifRange: string, validators: { etag?: string; lastModified?: Date }): boolean;

/**
 * Recorta o corpo para o intervalo. Streams são cortados sem ler o prefixo inteiro
 * para a memória; demais tipos viram Blob e são fatiados.
 */
function sliceContents(
  contents: NonNullable<BodyInit>,
  range: ByteRange,
): Promise<BodyInit>;

/** Descarta o prefixo e encerra a leitura ao chegar em `range.end`. */
function sliceStream(body: ReadableStream<Uint8Array>, range: ByteRange): ReadableStream<Uint8Array>;
```

Esboço de `sliceStream`, para guiar a implementação:

```ts
let offset = 0;
return body.pipeThrough(
  new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const chunkEnd = offset + chunk.byteLength;
      if (chunkEnd > range.start) {
        controller.enqueue(
          chunk.subarray(Math.max(0, range.start - offset), range.end + 1 - offset),
        );
      }
      offset = chunkEnd;
      if (offset > range.end) {
        controller.terminate();
      }
    },
  }),
);
```

Esboço do trecho novo em `serveStatic`, entre `content-length` e HEAD (`src/utils/static.ts:270-272`):

```ts
const range = event.req.headers.get("range");
const ifRange = event.req.headers.get("if-range");
const isEncoded = id !== assetId || event.res.headers.has("content-encoding");
const parsed =
  range && meta.size && !isEncoded && (!ifRange || isIfRangeMatch(ifRange, { etag: meta.etag, lastModified: mtimeDate }))
    ? parseByteRange(range, meta.size)
    : undefined;

if (parsed && "unsatisfiable" in parsed) {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
```

Observação: o trecho acima é um esboço. A implementação final deve separar a leitura de `ifRange` (somente quando há `range`) e tratar `meta.size` ausente ou zero como "ignorar" (RF-09).

Resposta 206 e corpo (depois de HEAD):

```ts
if (parsed) {
  const { start, end } = parsed;
  event.res.headers.set("content-range", `bytes ${start}-${end}/${meta.size}`);
  event.res.headers.set("content-length", String(end - start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  if (!contents) {
    // D-09: asset sumiu entre getMeta e getContents.
    if (options.fallthrough) return;
    throw new HTTPError({ statusCode: 404 });
  }
  return new HTTPResponse(await sliceContents(contents, parsed), { status: 206, statusText: "Partial Content" });
}
```

Observação sobre o 404 de D-09: o caminho existente usa `throw new HTTPError({ statusCode: 404 })` (`src/utils/static.ts:214`). Usar a mesma forma para consistência, e não `status`.

## Estratégia de testes

Seguir o `AGENTS.md` ("Bug Fix Workflow" adaptado a feature): escrever os testes primeiro, confirmar que falham contra o código atual, depois implementar.

Todos os testes novos usam `describeMatrix` (`test/_setup.ts:11`), que roda cada caso em `web` e `node`. Usar `t.app.all("/range/**", ...)` com `getMeta` e `getContents` controlados, no padrão de `test/static.test.ts:5`.

Fixture base: asset de 10 bytes com conteúdo `0123456789`, `etag` forte `"v1"`, `mtime` fixo, `type: "text/plain"`.

| Caso | Requisito | Verificação |
| --- | --- | --- |
| GET sem Range | RF-01 | 200, `accept-ranges: bytes`, corpo completo |
| `bytes=2-5` | RF-02 | 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345` |
| `bytes=7-` e `bytes=0-99` | RF-02 | fim além do arquivo é reduzido |
| HEAD `bytes=0-3` | RF-03 | 206, mesmos cabeçalhos, corpo vazio |
| `bytes=0-1,4-5`, `items=0-1`, `bytes=5-2`, `bytes=abc`, `bytes=-` | RF-04 | 200 completo, sem `content-range` |
| `bytes=10-20`, `bytes=-0` | RF-05 | 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio; `getContents` não chamado |
| `bytes=-3` e `bytes=-50` | RF-06 | `7-9/10` com corpo `789`; `0-9/10` com corpo completo |
| `If-Range: "v2"` vs `"v1"` | RF-07 | 200 completo, depois 206 `0-3/10` |
| `If-Range` com data igual e diferente de `last-modified` | RF-07 | casa só com a data exata, em segundos |
| `If-Range: W/"v1"` (fraco) | RF-07 | nunca casa, 200 completo |
| `If-None-Match: "v1"` com Range | RF-08 | 304, sem corpo |
| `getMeta` sem `size` e com `size: 0` | RF-09 | 200 completo, sem `content-range` |
| Asset pré-comprimido com `gzip` e Range | RF-10 | 200, `content-encoding: gzip`, corpo completo |
| Variante sem `meta.encoding` escolhida por `accept-encoding` | D-05 | 200 completo, sem 206 |
| Caminho inexistente com Range | RF-11 | 404 como antes; com `fallthrough`, `undefined` |
| Método POST com Range | RF-11 | 405 com `allow: GET, HEAD` |

Testes de corpo por tipo (D-06), com `it.each` sobre o tipo do `getContents`:

- `string` com caracteres não ASCII (ex.: `"é"` seguido de ASCII), para provar que o offset é em bytes e não em caracteres;
- `ArrayBuffer` e `Uint8Array`;
- `Blob`;
- `ReadableStream` com chunks pequenos (ex.: um byte por chunk) e com um chunk que cruza o início e o fim do intervalo.

Teste de early termination de stream (o caso que o `prd.md` pede para medir):

- `ReadableStream` com `pull` que conta chunks lidos e um `cancel` que marca cancelamento. Com `bytes=0-1` sobre um stream de 1000 chunks de 1 byte, verificar que a origem foi cancelada e que menos de 1000 chunks foram lidos.

Teste de `Content-Length` (D-07):

- `options.headers` com `content-length: 999` e GET com `bytes=0-3`: a resposta 206 tem `content-length: 4`. O teste existente em `test/static.test.ts:600` (HEAD 200 sem Range) deve continuar retornando 999.

Testes de regressão que não podem mudar:

- `test/static.test.ts:42` a `:55` (GET 200, `content-length: 18`);
- `test/static.test.ts:57` a `:71` (HEAD 200);
- `test/static.test.ts:199` a `:207` (304 por ETag);
- `test/static.test.ts:219` a `:225` (404);
- `test/static.test.ts:251` a `:254` (405);
- `test/unit/package.test.ts:4` (snapshot de exports).

Comandos de verificação, nesta ordem:

```bash
pnpm vitest run test/static-range.test.ts    # novos testes: falham antes, passam depois
pnpm vitest run test/static.test.ts          # regressão
pnpm vitest run test/security.test.ts test/unit/package.test.ts
pnpm lint                                    # oxlint + oxfmt --check
pnpm typecheck                               # tsc --noEmit
pnpm test                                    # suíte completa com coverage
```

## Riscos

1. **Custo do prefixo em stream (D-06).** Para `ReadableStream`, o prefixo anterior a `start` ainda é lido do disco ou da rede. Um Range no fim de um vídeo grande lê quase tudo. Não é possível evitar sem passar o intervalo para `getContents`, o que está fora de escopo. Mitigação: o teste de early termination limita o custo ao fim do intervalo, e o caso de disco deve ser medido em um benchmark separado depois da entrega.
2. **`meta.size` divergente do conteúdo real.** `Content-Range` e o `content-length` são calculados a partir de `meta.size` (premissa do `prd.md`). Se o backend informar um tamanho errado, o corpo recortado não bate com o cabeçalho. Mitigação: documentar no contrato de `StaticAssetMeta.size`. Não se faz checagem cruzada com `blob.size`, porque o custo não compensa.
3. **Mudança de status em HEAD.** HEAD com Range passa de 200 para 206 e 416 (`prd.md`, "Mudança de comportamento observável"). Isso é o esperado, mas qualquer cliente que dependa de HEAD sempre 200 vai notar.
4. **ETag fraco em forma não canônica.** Os testes atuais usam `etag: "w/123"` em minúsculas (`test/static.test.ts:15` e fixtures semelhantes). `opaqueTag` só reconhece `W/` maiúsculo (`src/utils/internal/cache.ts:52`), então esse valor é tratado como forte pelo `If-Range`. Mitigação: os testes novos usam `W/"v1"` com a forma canônica. Os testes antigos não são alterados nesta entrega, e a inconsistência fica registrada.
5. **`getContents` vazio em resposta parcial (D-09).** A decisão de tratar como 404 é conservadora, mas diferente do caminho de 200, que hoje devolve corpo `null` silenciosamente. Não há teste existente para esse caso, então o teste novo deve cobrir a decisão.
6. **Tamanho do arquivo acima da meta de 200 linhas.** `src/utils/static.ts` passa de 351 para cerca de 450 linhas. Isso contraria a meta do `AGENTS.md`, mas é a consequência direta da restrição de helpers privados (D-01). Separar em `src/utils/internal/range.ts` fica como ação futura.
7. **Interação com `Vary` e caches intermediários.** Respostas 206 podem ser guardadas por caches compartilhados. A RFC 9110 trata isso como comportamento normal de Range, e o `Vary: accept-encoding` continua sendo definido como hoje (`src/utils/static.ts:220-225`). Nenhuma mudança é necessária, mas vale verificar com um proxy real depois da entrega.
8. **Cabeçalho `accept-ranges` vindo de `options.headers`.** `options.headers` é aplicado primeiro (`src/utils/static.ts:105-114`) e o `set` de `accept-ranges` em `src/utils/static.ts:241` sobrescreve o valor do usuário. Se o usuário quiser desligar o anúncio, não há como fazer. Isso é aceitável para a entrega, mas deve ser mencionado na documentação.
