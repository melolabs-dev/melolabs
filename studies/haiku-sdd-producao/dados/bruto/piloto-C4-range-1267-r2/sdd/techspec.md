# Especificação técnica: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato), `sdd/prd.md` (requisitos RF/RNF) e o código de `src/` e `test/` do projeto. As citações `arquivo:linha` foram conferidas no código atual (commit `f0e1780`).

## 1. Resumo

O `serveStatic` (`src/utils/static.ts:101`) passa a tratar o cabeçalho `Range` para `GET` e `HEAD`, com um único intervalo nas três formas da norma. A mudança fica restrita ao módulo `src/utils/static.ts`, sem novas exportações, sem nova opção e sem alterar a assinatura de `getMeta`/`getContents`. Os cabeçalhos de cache e de conteúdo já são montados antes do envio e são reutilizados pela resposta 206.

## 2. Ponto de partida no código

- `src/utils/static.ts:116-122`: só `GET` e `HEAD` passam; outros métodos recebem `405` (ou `fallthrough`).
- `src/utils/static.ts:201-208`: a busca percorre as variantes pré-comprimidas; ao achar uma, `id` passa a ser a variante (`:204`) e `meta.size` é o tamanho dela. Por isso o RF-07 é atendido sem lógica extra.
- `src/utils/static.ts:239-241`: `etag` é definido no `event.res.headers`.
- `src/utils/static.ts:243-248`: checagem de `304` com `isCacheMatch`. Essa checagem precisa continuar antes de qualquer lógica de Range.
- `src/utils/static.ts:250-266`: `content-type`, `content-encoding`.
- `src/utils/static.ts:268-270`: `content-length = meta.size`, só se ainda não houver `content-length` (esse `if` não serve para 206).
- `src/utils/static.ts:272-274`: `HEAD` retorna sem corpo.
- `src/utils/static.ts:276-277`: `GET` chama `options.getContents(id)` e devolve `new HTTPResponse(contents || null, { status: 200 })`.
- `src/utils/internal/cache.ts:29-49`: `isCacheMatch`, que trata `If-None-Match` antes de `If-Modified-Since`.
- `src/response.ts:96-124`: classe `HTTPResponse` (`status` opcional, `headers` vindos do init).
- `src/response.ts:201-204`: para respostas não-`Response`, os cabeçalhos staged em `event.res.headers` são mesclados sobre os do `HTTPResponse`.
- `src/response.ts:211-213`: para status `>= 400`, os cabeçalhos de sucesso de `event.res` são descartados; só `errHeaders` entram. Logo, o `416` precisa levar seus cabeçalhos no init do `HTTPResponse`.
- `src/response.ts:231-240` e `src/response.ts:350-356`: em `HEAD` (e em 304/204/205) o corpo é removido pelo framework.
- `src/event.ts:201-202`: `event.res.headers` é criado sob demanda.
- `src/index.ts:193`: exporta `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`. Não muda.
- `test/unit/package.test.ts:4`: snapshot das exportações do pacote; protege o RNF-03.
- `test/static.test.ts:1-40`: fixture com `getContents` retornando string e `size = string.length`; `etag: "w/123"` sem aspas (ver riscos).
- `test/static.test.ts:600-617`: teste que exige que um `content-length` explícito vença o `size` (em HEAD, 200). Ver D-08.
- `AGENTS.md:135`: arquivos curtos, < 200 LoC. `src/utils/static.ts` já tem 352 linhas. Ver D-01.

## 3. Decisões de arquitetura

### D-01 — Local da implementação: tudo em `src/utils/static.ts`, helpers privados

**Escolha.** Os helpers de Range ficam no próprio `src/utils/static.ts`, sem `export`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Alternativas.**
- Criar `src/utils/internal/range.ts` e importar os helpers no `static.ts`. Segue o guia de `AGENTS.md:134` (helpers internos em `utils/internal/`), mas o pedido diz "Keep all helper logic private within the serveStatic module" e o contrato diz que as auxiliares ficam "privadas dentro do módulo".

**Justificativa.** O texto do contrato é explícito e o custo é pequeno. Consequência aceita: o arquivo passa de 352 para cerca de 480 linhas, acima do guia de `AGENTS.md:135`. Se o time preferir o guia, a divisão em `utils/internal/range.ts` é mecânica e não muda o contrato público.

### D-02 — Ordem de avaliação: 304 primeiro, Range depois dos cabeçalhos de conteúdo

**Escolha.** Dentro de `serveStatic`, a lógica de Range entra depois de `src/utils/static.ts:270` (cabeçalhos de conteúdo prontos) e antes de `src/utils/static.ts:272` (`HEAD`). A checagem de `304` (`src/utils/static.ts:243-248`) continua antes, sem mudança.

**Alternativas.** Avaliar Range antes da checagem de `304`. Rejeitada: o PRD (`sdd/prd.md`, riscos, "Regressão de cache") exige que a precedência de `304` seja mantida, e a ordem da RFC 9110 §13.2.2 avalia as pré-condições antes de Range.

**Justificativa.** Com `If-None-Match` que casa, a resposta continua sendo `304` mesmo com `Range`. Os cabeçalhos de conteúdo já estão no `event.res.headers`, então a 206 os herda sem duplicar lógica (RNF-01).

### D-03 — `Accept-Ranges: bytes` em toda resposta de asset encontrado

**Escolha.** `event.res.headers.set("accept-ranges", "bytes")` (se ainda não existir) junto do bloco de `etag`, em `src/utils/static.ts:239-241`, antes de `isCacheMatch`. Assim o cabeçalho sai em 200, 206, 304 e `HEAD`. Em 404, 405 e `fallthrough` não é definido, porque o asset não foi encontrado. No `416`, que é um status de erro, o cabeçalho vai no init do `HTTPResponse` (ver D-09).

**Alternativas.** Anunciar só quando `meta.size` é conhecido. Rejeitada: o contrato (`sdd/pedido.md`, item 1) diz "haja ou não `Range` no pedido" e o RF-01 não condiciona ao `size`. Ver risco R-03 sobre a inconsistência que isso cria quando o `size` falta.

**Justificativa.** Leitura literal do contrato e do RF-01. Também cobre o `304`, que é uma resposta de asset encontrado.

### D-04 — Interpretação do cabeçalho `Range`

**Escolha.** Um parser privado aceita somente:
- `bytes=<a>-<b>` com `a` e `b` dígitos (`a <= b`),
- `bytes=<a>-` com `a` dígitos,
- `bytes=-<n>` com `n` dígitos.

A unidade é um token (RFC 9110 §5.6.2), então `bytes` é comparado sem diferenciar maiúsculas. Não há espaços depois de `=`. Qualquer outra coisa é ignorada e a resposta segue como 200 completo (RF-05):
- vírgula no valor (multi-range),
- unidade diferente de `bytes`,
- sintaxe inválida (sinal, decimal, texto, vazio),
- `a > b`.

**Alternativas.** Aceitar OWS após `=`. Rejeitada: a gramática da norma não exige, e o contrato pede rejeição de malformado.

**Justificativa.** Regex simples e previsível. Ignorar em vez de responder `400` segue o contrato (item 5).

### D-05 — Cálculo dos limites e casos de borda

Seja `size = meta.size` e a faixa inclusiva `[start, end]`:

| Pedido | Resultado |
| --- | --- |
| `size` ausente (`undefined`) | Range ignorado (200). Contrato, premissa do PRD. |
| `a-b` com `a >= size` | 416. |
| `a-b` com `a < size` | `start = a`, `end = min(b, size - 1)` (206). |
| `a-` com `a >= size` | 416. |
| `a-` com `a < size` | `start = a`, `end = size - 1` (206). |
| `-n` com `n = 0` | 416 (premissa de `pedido.md`/PRD: `bytes=-0` não satisfazível). |
| `-n` com `n > 0` e `size = 0` | 416. |
| `-n` com `n > 0` e `size > 0` | `start = max(size - n, 0)`, `end = size - 1` (206). |
| `size = 0` e qualquer faixa válida | 416. Tamanho zero é conhecido, então não entra na regra de "size desconhecido". |

Números grandes demais para `Number.MAX_SAFE_INTEGER` não exigem tratamento especial: se `a >= size` ou `b` for maior, o resultado já é 416 ou clamp correto, mesmo com perda de precisão.

**Justificativa.** Todas as linhas correspondem aos critérios de aceite de RF-02, RF-03 e RF-04, e às premissas de `sdd/prd.md` (seção 5). `bytes=-0` e `bytes=-n` com `n > size` são as duas premissas em aberto do PRD; ver R-02.

### D-06 — `If-Range`: comparação forte apenas com ETag

**Escolha.** Se o pedido traz `If-Range`, o `Range` só é aplicado quando o valor é um entity-tag forte (começa com `"`, não começa com `W/`) e é idêntico a `meta.etag`, que também não pode começar com `W/`. Em qualquer outro caso, inclusive `If-Range` com data, o `Range` é ignorado e a resposta é 200 completa.

**Alternativas.**
- Comparar data com `Last-Modified`, como a RFC 9110 §13.1.5 permite. Fica fora do contrato (`pedido.md` item 8 e PRD RF-08 tratam só entity-tag) e exige igualdade exata de data forte. Não implementada agora; ver R-01.

**Justificativa.** "Ignorar" é o comportamento seguro que o próprio PRD aponta (`prd.md`, seção 5, riscos). Quebra a norma só para o caso de data, que o contrato excluiu.

### D-07 — Fatiamento do corpo sem mudar `getContents`

**Escolha.** `options.getContents(id)` continua com a mesma assinatura e é chamado uma vez, como hoje (`src/utils/static.ts:276`). O fatiamento é feito por um helper privado `sliceContents`, por tipo de `BodyInit`:
- `string`: codifica em UTF-8 e fatia os bytes.
- `ArrayBuffer` ou `ArrayBufferView`: `subarray`/`slice` sobre os bytes.
- `Blob`: `blob.slice(start, end + 1)` (sem carregar o conteúdo inteiro).
- `ReadableStream`: um novo `ReadableStream` que descarta os bytes antes de `start`, emite até `end` e cancela a fonte assim que o trecho termina ou o consumidor cancela. Esse wrapper é o caminho de vídeo/áudio, em que o arquivo pode ser grande.
- Outros tipos (`URLSearchParams`, `FormData`): `new Response(contents).arrayBuffer()` seguido de fatiamento. É um fallback com buffer completo.
- `null` ou `undefined`: devolve `null`, espelhando o `contents || null` atual.

**Alternativas.**
- Estender `getContents` com um parâmetro de intervalo. Rejeitada: muda a assinatura pública de `ServeStaticOptions` e o PRD (fora de escopo) veta novas opções e exportações.
- Sempre bufferizar e fatiar com `arrayBuffer()`. Rejeitada: carrega o arquivo inteiro na memória a cada seek de mídia, o que anula o motivo da feature.

**Justificativa.** Mantém a API pública e o contrato de `getContents`, e o caminho de stream é o que importa para os casos de uso do pedido.

### D-08 — Cabeçalhos da 206 e precedência do `Content-Length`

**Escolha.** Na 206, `event.res.headers` recebe `content-range: bytes <start>-<end>/<size>` e `content-length: <end - start + 1>`, com `set` (não `set` condicional). Assim, o `content-length` derivado do intervalo vence qualquer valor anterior. Cache e conteúdo (`etag`, `last-modified`, `cache-control`, `vary`, `content-type`, `content-encoding`) não são tocados e chegam pela mesclagem de `src/response.ts:201-204`.

**Exceção deliberada.** O teste `test/static.test.ts:600-617` exige que um `content-length` explícito (em `options.headers`) vença o `size`, mas só para `HEAD` 200. A 206 precisa ter o `Content-Length` do trecho (RF-03), então a exceção é restrita ao caminho de Range. Ver R-04.

### D-09 — Resposta 416 com cabeçalhos no init

**Escolha.** A 416 é `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable", headers: { "accept-ranges": "bytes", "content-range": "bytes */<size>", "content-length": "0" } })`, sem chamar `getContents`.

**Justificativa.** Pelo `src/response.ts:211-213`, status `>= 400` descarta os cabeçalhos de sucesso de `event.res`. Colocar `content-range` em `event.res.headers` não funcionaria; o init é o caminho certo. Também não aparecem `etag` e `cache-control` na 416 (ver R-05).

**Alternativa.** Staged em `event.res.errHeaders`. Rejeitada: `errHeaders` é mesclado em qualquer erro subsequente da mesma requisição, o que é efeito colateral indesejado.

### D-10 — `HEAD` com Range e a 416 não chamam `getContents`

**Escolha.** Para `HEAD`, a 206 é `new HTTPResponse(null, { status: 206, statusText: "Partial Content" })` com os cabeçalhos de D-08, e nada é lido. A 416 segue o mesmo caminho de D-09. Assim não há stream aberto que possa vazar (PRD, riscos, "Stream e fechamento de corpo").

**Justificativa.** Cumpre RF-06 (`HEAD` igual ao `GET`, sem corpo). O framework também remove o corpo em `HEAD` (`src/response.ts:231-240`), mas não ler o stream evita abri-lo.

## 4. Contratos e assinaturas

### 4.1 API pública (inalterada)

```ts
// src/utils/static.ts (sem mudança de assinatura)
export interface StaticAssetMeta { type?: string; etag?: string; mtime?: number | string | Date; size?: number; encoding?: string; }
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType?; }
export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

`src/index.ts:193` continua exportando exatamente os mesmos três nomes. `test/unit/package.test.ts:4` (snapshot) não deve mudar.

### 4.2 Helpers privados (sem `export`, em `src/utils/static.ts`)

```ts
type ByteRangeResult =
  | { kind: "none" }                                 // ignorar Range: segue 200 normal
  | { kind: "unsatisfiable" }                        // 416
  | { kind: "partial"; start: number; end: number }; // 206, faixa inclusiva

// Lê event.req.headers ("range", "if-range"), meta.size e meta.etag.
// Retorna "none" se size for undefined, se Range for malformado/multi-range/unidade diferente,
// ou se If-Range não casar (D-06).
function resolveRange(
  headers: Headers,
  meta: { size?: number; etag?: string },
): ByteRangeResult;

// Parser de um único intervalo (D-04, D-05). Retorna undefined para "ignorar",
// "unsatisfiable" para 416, ou {start, end} para 206.
function parseSingleByteRange(
  value: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined;

// Comparação forte de entity-tag (D-06).
function matchesIfRange(ifRange: string, etag: string | undefined): boolean;

// Fatiamento por tipo (D-07). Retorna o corpo do trecho.
function sliceContents(
  contents: BodyInit | null | undefined,
  start: number,
  end: number,
): Promise<BodyInit | null>;
```

### 4.3 Ponto de inserção (esboço, não código final)

```ts
// depois de src/utils/static.ts:270 (content-length padrão) e antes de :272 (HEAD)
const range = resolveRange(event.req.headers, meta);

if (range.kind === "unsatisfiable") {
  return new HTTPResponse(null, {
    status: 416,
    statusText: "Range Not Satisfiable",
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes */${meta.size}`,
      "content-length": "0",
    },
  });
}

if (range.kind === "partial") {
  const length = range.end - range.start + 1;
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(length));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(await sliceContents(contents, range.start, range.end), {
    status: 206,
    statusText: "Partial Content",
  });
}
// ... fluxo atual de HEAD (272-274) e GET 200 (276-277)
```

`accept-ranges` em `event.res.headers` vai junto do bloco de `etag` (D-03), não neste ponto.

## 5. Arquivos a alterar

- `src/utils/static.ts`:
  - `:239-241`: incluir `accept-ranges: bytes` (D-03).
  - `:268-270` a `:274`: bloco de Range, 416, 206 e `HEAD` (D-02, D-08, D-09, D-10).
  - `:277` e a região de `// --- Internal Utils ---` (`:280`): helpers privados (D-04 a D-07).
  - Não alterar `:243-248` (`304`), `:116-122` (`405`), `:142-147` (canonicidade), nem a lógica de `:170-208` (decodificação, variantes e precedência de `id`).
- `test/static.test.ts`: novos `it(...)` cobrindo a especificação (seção 6).
- `src/index.ts`: sem alteração (RNF-03).
- Nenhum outro arquivo do projeto. `src/response.ts` e `src/utils/internal/cache.ts` são lidos, não alterados.

## 6. Estratégia de testes

Usar `describeMatrix` (`test/_setup.ts`, convenção de `AGENTS.md:189-195`), para rodar em `web` e `node`. O fixture de `test/static.test.ts:1-40` serve de base, com `getContents` retornando `string` (tamanho em bytes = `.length`, por ser ASCII) e alguns casos com `Blob` e `ReadableStream`.

Casos mínimos, agrupados pelos requisitos:

1. **RF-01 / D-03**: `GET` sem `Range` retorna `200` com `accept-ranges: bytes`; `304` e `HEAD` também têm o cabeçalho; `404` e `405` não.
2. **RF-02 / D-05**: `bytes=100-199`, `bytes=900-`, `bytes=-50` em um asset de 1000 bytes produzem 206 e os trechos corretos (100-199, 900-999, 950-999).
3. **RF-03**: `bytes=500-9999` gera `206`, `content-range: bytes 500-999/1000`, `content-length: 500` e 500 bytes no corpo.
4. **RF-04 / D-09**: `bytes=1000-1100` gera `416`, corpo vazio, `content-range: bytes */1000`, `content-length: 0`; `getContents` não é chamado (`vi.fn`).
5. **RF-05 / D-04**: `bytes=0-1,5-9`, `items=0-5`, `bytes=9-3`, `bytes=abc` e `bytes=` geram `200` completo sem `content-range`.
6. **RF-06 / D-10**: `HEAD` com `Range: bytes=0-99` gera `206`, sem corpo, mesmos cabeçalhos do `GET`; `getContents` não é chamado.
7. **RF-07**: asset de 1000 bytes com variante `.gz` de 300 bytes e `accept-encoding: gzip` com `Range: bytes=0-99` gera `content-range: bytes 0-99/300`, `content-length: 100`, `content-encoding: gzip`.
8. **RF-08 / D-06**: `If-Range` com ETag diferente gera `200`; com o ETag correto gera `206`; `If-Range` com data gera `200`; ETag fraco (`W/`) gera `200`.
9. **RNF-01**: em `206`, `etag`, `last-modified`, `cache-control`, `vary`, `content-type` e `content-encoding` são iguais aos da resposta `200`.
10. **D-05 (bordas)**: `bytes=-0` gera `416`; `bytes=-5000` em asset de 1000 bytes gera `206` com `bytes 0-999/1000`; `size` ausente ignora o Range (`200`); `size = 0` com qualquer Range gera `416`.
11. **D-07 (stream)**: `ReadableStream` de vários chunks, com faixa que começa e termina no meio de chunks, entrega exatamente os bytes; um `cancel` do consumidor cancela a fonte (espião no `cancel` do stream de origem); o stream de origem também é cancelado ao terminar o trecho.
12. **D-07 (Blob)**: `Blob` fatiado produz os bytes corretos.
13. **RNF-02**: suíte existente de `test/static.test.ts` passa sem alteração (inclusive `:199`, `:219`, `:251`, `:600`).
14. **RNF-03**: `test/unit/package.test.ts` (snapshot de exports) passa sem atualização do snapshot.

Ordem de trabalho: escrever primeiro os testes de 2 a 8 e confirmar que falham antes de mudar `static.ts` (seguir o espírito de `AGENTS.md:206-212`). Comandos:

```bash
pnpm vitest run test/static.test.ts
pnpm vitest run test/unit/package.test.ts
pnpm lint
pnpm typecheck
pnpm test
```

Antes de dar o trabalho por encerrado, rodar `pnpm test` completo (lint, typecheck e cobertura).

## 7. Riscos e pontos em aberto

- **R-01 — `If-Range` com data.** A RFC 9110 §13.1.5 admite data no `If-Range`; D-06 ignora esse caso (200), que é seguro mas não é a norma. Decisão a confirmar antes da implementação: manter ignorar, ou implementar comparação forte com `Last-Modified`.
- **R-02 — `bytes=-0` e `bytes=-n` com `n > size`.** D-05 assume 416 para `-0` e 206 com o arquivo inteiro para `n > size`. São as duas premissas em aberto em `sdd/prd.md` (seção 5). Confirmar.
- **R-03 — `Accept-Ranges` sem `size` conhecido.** O contrato exige o cabeçalho sempre (D-03), mas, sem `size`, o Range é ignorado. Isso anuncia `bytes` sem suportar Range naquele caso. Alternativa: anunciar só quando `size` é conhecido. Decisão a confirmar.
- **R-04 — Precedência do `Content-Length` explícito.** A 206 sobrescreve um `content-length` de `options.headers`. Isso contraria o teste de `test/static.test.ts:600-617` apenas no caminho de Range. Documentar no código e no teste novo.
- **R-05 — Cabeçalhos da 416.** Pelo `src/response.ts:211-213`, a 416 não leva `etag`, `cache-control`, `vary` nem `options.headers`, só `accept-ranges`, `content-range` e `content-length`. Isso atende o contrato, mas é diferente das outras respostas.
- **R-06 — Vazamento de stream.** O wrapper de D-07 precisa cancelar a fonte em três casos: trecho concluído, cancelamento pelo consumidor e erro de leitura. Os testes do item 11 cobrem os dois primeiros; o erro de leitura precisa de teste próprio.
- **R-07 — Inconsistência de tamanho.** Se `meta.size` não bater com o tamanho real do conteúdo (por exemplo, `getContents` devolve `null` ou um conteúdo diferente), o `Content-Length` da 206 fica errado. O comportamento de 200 atual tem o mesmo problema (`src/utils/static.ts:268-277`). Documentar como premissa, já listada em `sdd/prd.md` (seção 5).
- **R-08 — Strings e tamanho em bytes.** `meta.size` precisa ser o número de bytes UTF-8. A fixture de `test/static.test.ts:18` usa `.length`, que é correto só para ASCII. Os testes novos com conteúdo não ASCII devem usar `TextEncoder` para calcular o tamanho.
- **R-09 — Fixture com ETag sem aspas.** `test/static.test.ts:15` usa `etag: "w/123"`, que não é entity-tag válido. O `If-Range` novo compara por igualdade exata, então os testes de RF-08 devem usar ETags com aspas duplas, como `"abc"`, e não reutilizar essa fixture.
- **R-10 — Tamanho do arquivo e AGENTS.md.** D-01 deixa `src/utils/static.ts` acima de 200 linhas (`AGENTS.md:135`). Consequência aceita, com alternativa mecânica registrada.
- **R-11 — Estado do repositório (observação, não relacionada).** `git status` mostra `D test/unit/cli.test.ts` (arquivo rastreado removido do working tree) e `sdd/` como não rastreado. Não foi tocado. Pode afetar `pnpm test` completo; vale checar antes do PR.
- **R-12 — Runtimes.** Só APIs de web standards são usadas (`Blob.slice`, `ReadableStream`, `TextEncoder`, `Response`). Cobertura do `describeMatrix` em `web` e `node` cobre o requisito de `sdd/prd.md` (seção 5). Cloudflare e Deno não entram na matriz.
