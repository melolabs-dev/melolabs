# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-10). Este documento decide **como** implementar. Não altera código do projeto.

Todas as citações `caminho:linha` foram conferidas nos arquivos desta pasta na data de hoje.

## 1. Estado atual

- `serveStatic` é um `async function` exportado em `src/utils/static.ts:101`. Ele não lê o header `range`: o único código de `src` que menciona `range` como header de requisição é `src/rules/cache.ts:148`, do cache handler, não do `serveStatic`.
- A ordem atual dentro de `serveStatic`:
  1. headers do usuário são copiados para `event.res.headers` (`src/utils/static.ts:105-114`);
  2. método diferente de GET/HEAD gera 405 ou fallthrough (`src/utils/static.ts:116-122`);
  3. caminho não canônico gera 404 ou fallthrough (`src/utils/static.ts:142-147`);
  4. busca de variantes com `getMeta` (`src/utils/static.ts:192-208`) e 404 se não achar (`src/utils/static.ts:210-215`);
  5. `vary`, `last-modified`, `etag` (`src/utils/static.ts:220-241`);
  6. 304 via `isCacheMatch` (`src/utils/static.ts:243-248`);
  7. `content-type`, `content-encoding`, `content-length` só se ainda não definidos (`src/utils/static.ts:250-270`);
  8. HEAD devolve 200 sem corpo (`src/utils/static.ts:272-274`);
  9. GET chama `getContents` e devolve 200 (`src/utils/static.ts:276-277`).
- `ServeStaticOptions` tem `getMeta` (`src/utils/static.ts:25`) e `getContents` (`src/utils/static.ts:33`), ambos com assinatura que devolve o corpo inteiro. `StaticAssetMeta` tem `etag` (`src/utils/static.ts:11`), `mtime` (`src/utils/static.ts:12`), `size` (`src/utils/static.ts:13`) e `encoding` (`src/utils/static.ts:14`).
- `src/index.ts:193` exporta apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Não há nenhum helper de range exportado e não deve haver.
- `isCacheMatch` e `matchETag` estão em `src/utils/internal/cache.ts:29` e `src/utils/internal/cache.ts:11`. Usam comparação **fraca** (`W/` ignorado), que serve para 304 mas **não** para `If-Range`, que exige forte (RFC 9110 §13.1.5).
- `HTTPResponse` está em `src/response.ts:96`; o construtor é `src/response.ts:100`. Ele aceita `status` e `statusText` no `init`. `nullBody` (`src/response.ts:350`) já zera o corpo para HEAD e para 204/304, então HEAD com 206/416 não precisa de tratamento especial de corpo.
- Nenhum teste existente envia `Range` contra `serveStatic`: a busca por `range` em `test/` só acha `test/rules/cache.test.ts:1214`, que é o cache handler (bypass de `Range`, `src/rules/cache.ts:143-148`). Portanto não há teste existente que precise mudar de comportamento por causa de `Range`.
- `test/unit/package.test.ts:133` tem um snapshot das exportações. É a rede de segurança para RF-09.
- `test/static.test.ts` tem 678 linhas e usa `describeMatrix` (`test/_setup.ts:11`), que roda cada caso em `web` e `node`. Quase todos os casos da primeira `describe` usam `encoding: "utf8"` nos metadados (`test/static.test.ts:7-26`), o que faz o `Range` ser ignorado nesses casos. Os novos testes devem usar seus próprios metadados.
- Referência externa, só para consulta: `node_modules/srvx/dist/static.mjs` já implementa Range para arquivos em disco (`parseRange` em `:289`, `matchesIfRange` em `:284`, 206 em `:238`, 416 em `:228`). Não é exportado como helper, então não é reaproveitável diretamente. Serve de conferência para os casos de borda.

## 2. Decisões de arquitetura

### D-01 — Lógica inteira dentro de `src/utils/static.ts`, sem mudança de API

**Alternativas consideradas**

- (a) Helpers privados no próprio `src/utils/static.ts`.
- (b) Novo módulo `src/utils/internal/range.ts`, importado por `static.ts`.
- (c) Nova opção em `ServeStaticOptions`, como `ranges: boolean`, ou mudança em `getMeta`/`getContents` para devolver trechos.

**Escolha: (a).** O `pedido.md` diz "Keep all helper logic private within the serveStatic module" e o `prd.md` (RF-09) diz "os helpers ... ficam privados ao módulo". Isso pede explicitamente o arquivo `static.ts`. A opção (b) também não exporta nada publicamente, mas ficaria fora do "módulo" que o contrato menciona. A opção (c) é proibida pelo PRD ("sem novas opções") e pelo próprio contrato. Para `getMeta`/`getContents`, o PRD mantém as assinaturas e o recorte fica no `serveStatic`.

**Custo conhecido:** `static.ts` já tem 351 linhas e `AGENTS.md` pede arquivos de até ~200 linhas. Com o código novo o arquivo passa de 500 linhas. Isso é um conflito consciente entre o contrato e a convenção do `AGENTS.md`. Ver seção 7, ponto P-4.

### D-02 — Ordem de avaliação: validação condicional antes de `Range`

**Alternativas consideradas**

- (a) Avaliar `Range` logo após `getMeta`, antes de `isCacheMatch`.
- (b) Avaliar `Range` depois de `isCacheMatch` e depois de `content-type`/`content-encoding`/`content-length`.

**Escolha: (b).** RFC 9110 §13.2.2 define a ordem: condicionais de cache (If-None-Match, If-Modified-Since), depois If-Range, depois Range. Assim um `If-None-Match` que casa continua gerando 304 mesmo com `Range` (RF-08). A decisão de `Range` fica depois de `content-length` para poder sobrescrevê-lo (D-07).

Como `Accept-Ranges` é um cabeçalho de anúncio, ele é definido **depois** do 304 (para o 304 continuar idêntico ao de hoje) e **antes** da decisão de Range. Usa o mesmo padrão "definir só se ausente" dos outros cabeçalhos do bloco (`src/utils/static.ts:250-270`).

### D-03 — Gate de elegibilidade: tamanho conhecido e sem `content-encoding` efetivo

Range só é avaliado quando `meta.size !== undefined && meta.size > 0` (mesmo critério de `src/utils/static.ts:268`) e quando `event.res.headers.get("content-encoding")` é vazio.

**Alternativas consideradas**

- (a) Checar só `meta.encoding`.
- (b) Checar o cabeçalho efetivo `event.res.headers` (que já inclui `meta.encoding` definido em `src/utils/static.ts:264-266` e um `content-encoding` vindo de `options.headers`).

**Escolha: (b).** Se `options.headers` define `content-encoding`, o corpo é codificado do mesmo jeito, e cortar bytes faria o cliente receber lixo. Checar só `meta.encoding` deixaria esse buraco. Isso cobre RF-07 nos dois casos (`meta.encoding = "gzip"` e cabeçalho do usuário).

Tamanho zero não recebe Range (premissa do PRD). Sem `size`, não há Range; a resposta é 200 completa como hoje.

### D-04 — Parser de `Range` estrito: uma única spec, unidade `bytes` sem diferenciar maiúsculas

**Gramática aceita** (RFC 9110 §14.1 e §14.1.1), após `trim()`:

- unidade `bytes`, comparada sem diferenciar maiúsculas (RFC 9110 §14.1: nomes de unidade são case-insensitive), seguida de `=`;
- exatamente uma spec: `N-M`, `N-` ou `-N`, com dígitos ASCII (`/^\d+$/`), sem espaço interno entre os números.

**Regras de decisão** (`size` é o `meta.size`):

| Entrada                                                                | Resultado                                                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bytes=N-M`, `N ≤ M`, `N < size`                                       | parcial `[N, min(M, size-1)]` (RF-02)                                                                                              |
| `bytes=N-`, `N < size`                                                 | parcial `[N, size-1]`                                                                                                              |
| `bytes=-N`, `N > 0`                                                    | parcial `[max(0, size-N), size-1]` (RF-02)                                                                                         |
| `bytes=-0`                                                             | **416** (RFC 9110 §14.1.1: sufixo zero não é satisfazível; mesmo comportamento de `srvx`, `node_modules/srvx/dist/static.mjs:297`) |
| `bytes=N-…` com `N ≥ size`                                             | **416** (RF-04)                                                                                                                    |
| `bytes=M-N` com `N < M`                                                | inválido: **ignorar** (200 completo)                                                                                               |
| vírgula (multi-range), outra unidade, sintaxe quebrada, `bytes=` vazio | **ignorar** (RF-05)                                                                                                                |

**Alternativas consideradas:** (a) aceitar multi-range com `multipart/byteranges` (fora de escopo pelo PRD); (b) tratar `bytes=-0` como inválido (200). A escolha de 416 segue a RFC e a referência do `srvx`. Ver P-3.

### D-05 — If-Range: forte para ETag, exata por segundo para data

Se a requisição não tem `Range`, `If-Range` é ignorado (RFC 9110 §13.1.5).

Quando há `Range` e `If-Range`:

- **Valor começa com `"` ou `W/`** → é um ETag. Só honra o Range se `meta.etag` existe, **não** começa com `W/` e é idêntico (caractere a caractere) ao valor enviado. Qualquer ETag fraco, de qualquer lado, faz o Range ser ignorado (RF-06).
- **Caso contrário** → é uma data. Só honra se `meta.mtime` existe, `Date.parse(valor)` é igual a `mtimeDate.getTime()` e `mtimeDate` é pelo menos um segundo anterior ao instante atual (truncado a segundos). `mtimeDate` já vem truncado a segundos em `src/utils/static.ts:227-232`, então a comparação é por segundo, como exige o `Last-Modified`. A regra de "um segundo" vem de P-1: sem ela, uma data é validador fraco.
- Valor não reconhecido (`NaN`, por exemplo) → ignorar o Range.

**Alternativas consideradas**

- (a) Reaproveitar `isCacheMatch`/`matchETag` (`src/utils/internal/cache.ts:11-29`). **Rejeitada:** comparação fraca, contra o que pede a RFC para `If-Range`.
- (b) Comparar a data com a string `toUTCString()`, como o `srvx` (`node_modules/srvx/dist/static.mjs:284-288`). **Rejeitada:** falha com formatos equivalentes que o cliente pode enviar.

Ver P-1 para a regra de "um segundo antes da Date" aplicada a validadores de data.

### D-06 — 416 é decidido sem ler o corpo

Quando o Range é insatisfazível, `getContents` não é chamado. A resposta sai com `status 416`, `statusText "Range Not Satisfiable"`, `content-range: bytes */<size>` e `content-length: 0`. Vale para GET e HEAD (RF-04).

Isso evita ler um corpo que não vai ser enviado e evita o risco de "206 com corpo vazio" do PRD: 416 não tem corpo.

### D-07 — `content-range` e `content-length` de 206/416 são controlados pelo servidor

Em 206 e 416, `content-length` e `content-range` são **sobrescritos** com `event.res.headers.set(...)`, mesmo que o usuário tenha definido `content-length` em `options.headers`.

**Alternativas consideradas**

- (a) Respeitar o valor do usuário, como o teste "does not overwrite a content-length already set on the response" faz para 200 (`test/static.test.ts:600-617`).
- (b) Sobrescrever sempre em 206/416.

**Escolha: (b).** Um `Content-Length` fixo do usuário em 206 deixaria a resposta inválida e quebraria o cliente que retoma o download. O teste existente continua valendo para 200, porque esse caminho não muda. Ver P-2.

### D-08 — Recorte do corpo por tipo, sem mudar `getContents`

`getContents` continua devolvendo o corpo inteiro (PRD, "Mudança nas assinaturas... fora de escopo"). O recorte é feito em um helper privado:

- `ReadableStream` → recorte por stream: descarta `start` bytes e emite `length` bytes, cancelando a origem quando termina. Não bufferiza o arquivo inteiro, o que atende o risco de vídeo grande do PRD.
- Qualquer outro `BodyInit` (`string`, `ArrayBuffer`, views, `Blob`, `FormData`, `URLSearchParams`) → `await new Response(contents).blob()` e depois `blob.slice(start, end + 1)`. `Blob.slice` opera em bytes, e `new Response(string)` codifica em UTF-8, então o tamanho bate com `meta.size` para texto UTF-8.

**Alternativas consideradas**

- (a) Ler tudo em `ArrayBuffer` e fatiar. **Rejeitada:** o risco do PRD ("uma solução simples que lê tudo em memória pode ser cara").
- (b) Tratar string por `.slice()`. **Rejeitada:** `.slice` conta caracteres UTF-16, não bytes, e o `Content-Length` vem de `meta.size` em bytes.
- (c) Converter tudo para stream. **Rejeitada:** força streaming em `Blob`, que já tem `slice` barato.

### D-09 — Montagem das respostas com `HTTPResponse` e status explícito

206 e 416 são devolvidos como `new HTTPResponse(body, { status, statusText })`, no mesmo padrão do 304 (`src/utils/static.ts:244-247`). Os cabeçalhos ficam em `event.res.headers`, como no resto do arquivo. HEAD recebe `null` como corpo, e `nullBody` (`src/response.ts:350`) garante isso mesmo que um corpo seja passado.

### D-10 — `getContents` vazio com Range cai em 200

Se `getContents` devolve `null` ou `undefined` para um asset com Range parcial, a resposta é 200 completa, sem `content-range`, exatamente como hoje (`src/utils/static.ts:277`). Não há 206 com corpo vazio (risco do PRD).

## 3. Arquivos a alterar

| Arquivo               | Alteração                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/utils/static.ts` | Helpers privados (`evaluateRange`, `parseRangeHeader`, `matchesIfRange`, `sliceBody`, `sliceStream`) no fim do arquivo, sob `// --- Internal Utils ---` (`src/utils/static.ts:280`). Bloco novo entre `src/utils/static.ts:270` e `src/utils/static.ts:277`. |
| `test/static.test.ts` | Novo `describeMatrix("serve static range requests", ...)` ao final do arquivo (depois de `test/static.test.ts:678`). Não alterar os blocos existentes, porque nenhum deles envia `Range`.                                                                    |
| `sdd/techspec.md`     | Este documento.                                                                                                                                                                                                                                              |

**Não alterar:** `src/index.ts` (RF-09), `src/utils/internal/cache.ts`, `src/response.ts`, `src/rules/cache.ts`, `test/unit/package.test.ts` (o snapshot deve passar sem mudança; se mudar, há exportação indevida).

Pontos exatos dentro de `src/utils/static.ts` (linhas atuais):

- `src/utils/static.ts:268-270` — bloco de `content-length` (ponto de inserção logo após; D-03 e D-07).
- `src/utils/static.ts:272-274` — HEAD, que passa a considerar Range.
- `src/utils/static.ts:276-277` — GET, que passa a recortar quando há Range parcial e corpo.
- `src/utils/static.ts:243-248` — 304, que continua antes de Range (D-02).

## 4. Contratos e assinaturas

Nenhuma assinatura pública muda. `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic` e as exportações de `src/index.ts:193` permanecem idênticos.

Helpers privados, em `src/utils/static.ts`:

```ts
/** Resultado da avaliação de Range para um asset de tamanho conhecido. */
type RangeDecision =
  | { type: "none" } // Range ignorado: resposta 200 completa
  | { type: "partial"; start: number; end: number } // 206, `end` inclusivo
  | { type: "unsatisfiable" }; // 416

/**
 * Decide o Range da requisição (RFC 9110 §13.1.5 e §14).
 * Chamado só com `size > 0` e sem content-encoding efetivo (D-03).
 */
function evaluateRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; mtime?: Date },
): RangeDecision;

/**
 * Interpreta um valor de `Range` para um `size` conhecido.
 * Devolve `undefined` quando o Range deve ser ignorado (D-04).
 */
function parseRangeHeader(
  value: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined;

/**
 * Compara `If-Range` com os validadores do asset, de forma forte (D-05).
 */
function matchesIfRange(value: string, validators: { etag?: string; mtime?: Date }): boolean;

/**
 * Recorta `[start, end]` (inclusivo, bytes) de um corpo qualquer (D-08).
 */
function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit>;

/**
 * Recorte preguiçoso de um ReadableStream: descarta `start` bytes e emite `length` bytes.
 */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  length: number,
): ReadableStream<Uint8Array>;
```

Fluxo novo dentro de `serveStatic`, a partir de `src/utils/static.ts:270` (pseudocódigo, não é o código final):

```ts
// Logo após o bloco de content-length (src/utils/static.ts:268-270)
if (!event.res.headers.get("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

const range: RangeDecision =
  meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-encoding")
    ? evaluateRange(event.req.headers, meta.size, { etag: meta.etag, mtime: mtimeDate })
    : { type: "none" };

if (range.type === "unsatisfiable") {
  // D-06, D-07, D-09: sem getContents
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range.type === "partial" && event.req.method === "HEAD") {
  // D-07, D-09: cabeçalhos de 206, sem corpo
  return partialResponse(event, range, meta.size!, null);
}

if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: 200 }); // como hoje
}

const contents = await options.getContents(id);
if (range.type === "partial" && contents) {
  return partialResponse(
    event,
    range,
    meta.size!,
    await sliceBody(contents, range.start, range.end),
  );
}
return new HTTPResponse(contents || null, { status: 200 }); // como hoje, D-10
```

`partialResponse` é um helper privado que define `content-range: bytes <start>-<end>/<size>`, define `content-length` como `end - start + 1` e devolve `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`.

## 5. Estratégia de testes

Seguir o fluxo do `AGENTS.md`: escrever os testes primeiro e confirmar que falham antes da implementação. São testes de funcionalidade nova, então o passo "reproduz o bug" vira "reproduz a ausência de 206".

Novo bloco `describeMatrix("serve static range requests", ...)` em `test/static.test.ts`. Metadados próprios, **sem** `encoding`, com um asset de 1000 bytes `"abcdefghij".repeat(100)`, `etag: "abc"` e `mtime: 1_700_000_000_500` (para cobrir o truncamento de segundos).

Casos, com o requisito que cobrem:

1. **Anúncio** — GET e HEAD sem `Range` retornam 200 com `accept-ranges: bytes` (RF-01).
2. **`bytes=0-99`** — 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo `"abcdefghij".repeat(10)` (RF-02).
3. **`bytes=-200`** — 206, `bytes 800-999/1000`, corpo igual a `slice(800)` (RF-02).
4. **`bytes=900-5000`** — 206, `bytes 900-999/1000`, 100 bytes (RF-02).
5. **`bytes=-0`** — 416 (D-04).
6. **`bytes=1000-1100`** em GET e em HEAD — 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio (RF-04).
7. **HEAD `bytes=0-99`** — 206 com os mesmos cabeçalhos e corpo vazio (RF-03).
8. **Malformados e não suportados** — `bytes=0-10,20-30`, `items=0-10`, `bytes=abc`, `bytes=5-2`, `bytes=` retornam 200, sem `content-range`, com os 1000 bytes (RF-05).
9. **Unidade em maiúsculas** — `BYTES=0-9` é aceito e retorna 206 (D-04).
10. **If-Range forte** — `"abc"` honra (206), `"xyz"` ignora (200), `W/"abc"` ignora (200) (RF-06).
11. **If-Range por data** — `toUTCString()` do `mtime` truncado honra (206); outra data ignora (200) (RF-06).
12. **Sem tamanho** — `getMeta` sem `size` e `Range` retorna 200 completo, sem `content-range` (RF-07).
13. **Encoding** — `meta.encoding = "gzip"` com `Range` retorna 200 com a variante codificada (RF-07).
14. **`content-encoding` vindo de `options.headers`** — retorna 200 completo (D-03).
15. **304 precede Range** — `if-none-match: "abc"` com `Range` retorna 304 sem corpo (RF-08).
16. **404 com fallthrough desligado** — asset inexistente com `Range` continua 404 (RF-08).
17. **405 com POST** — `POST` com `Range` continua 405 com `allow: GET, HEAD` (RF-08).
18. **Stream** — `getContents` devolve `ReadableStream` e `bytes=100-199` retorna 206 com os bytes certos (D-08).
19. **Blob e texto multibyte** — corpo `"ééé"` (6 bytes em UTF-8) com `bytes=0-1` retorna `"é"` e `content-length: 2` (D-08).
20. **`getContents` nulo** — `getContents` devolve `null` com `Range` e a resposta é 200 sem `content-range` (D-10).
21. **Override de `content-length`** — `options.headers` com `content-length: 999` e `Range: bytes=0-99` retorna 206 com `content-length: 100` (D-07).

Verificações de regressão:

- `pnpm vitest run test/static.test.ts` — todos os casos existentes e novos passam em `web` e `node`.
- `pnpm vitest run test/unit/package.test.ts` — snapshot de exportações inalterado (RF-09).
- `pnpm vitest run test/security.test.ts` — os casos de traversal que usam `serveStatic` continuam passando.
- `pnpm lint` e `pnpm typecheck` (`package.json` scripts) — exigência do contrato.
- `pnpm test` completo, antes de fechar.

Esta especificação não executa nada. Os comandos acima são o plano para a etapa de implementação; nenhum foi rodado nesta etapa.

## 6. Riscos

1. **Corpo menor que `meta.size`** (principal, da própria PRD): um `getContents` que devolve menos bytes do que `getMeta` informa gera resposta com `content-length` errado. O recorte confia em `meta.size` e não há checagem de consistência no código proposto. Ver P-5.
2. **Regressão silenciosa por `Accept-Ranges`**: clientes que dependem de 200 para `Range` passam a receber 206. É o efeito pedido pela issue, mas afeta todos os usuários de `serveStatic` ao mesmo tempo (PRD). Não há opção de desligar, por decisão do contrato.
3. **Interação com `h3/rules/cache`**: `src/rules/cache.ts:143-148` deixa passar requisições com `Range` sem cachear. Logo, um 206 de `serveStatic` atrás do cache handler sai sem cache. É o comportamento desejado (não se cacheia parcial), mas vale saber.
4. **Variante pré-comprimida com `Accept-Ranges`**: quando `accept-encoding` seleciona `.gz`, o `Range` é ignorado e o `Accept-Ranges: bytes` continua anunciado. RFC 9110 permite isso (o servidor pode ignorar `Range`), e o PRD pede para manter o anúncio. Documentar, não corrigir.
5. **Fixtures em minúsculo**: os testes existentes usam `etag: "w/123"` (minúsculo) e `if-none-match: w/456`. Pelo critério "começa com `W/`" (maiúsculo, case-sensitive), `w/123` é tratado como **forte**. Isso não quebra nenhum teste atual, porque nenhum deles envia `If-Range`, mas um teste novo com `If-Range: w/123` teria comportamento surpreendente. Os testes novos usam `"abc"`.
6. **Precisão de data em `If-Range`**: `Last-Modified` tem resolução de um segundo. A comparação por `getTime()` de `mtimeDate` (já truncado) evita erro de milissegundos. O risco do PRD ("conteúdo misturado para cliente que retoma download") é mitigado pela decisão D-05; a regra de "um segundo antes da Date" está decidida em P-1 e aplicada em D-05.
7. **Tamanho de arquivo**: `static.ts` passa de 500 linhas, contra a convenção de ~200 do `AGENTS.md` (P-4).
8. **Conversão para `Blob` de corpo não-stream**: `new Response(body).blob()` copia o corpo em memória para strings e `ArrayBuffer`. Para arquivos grandes servidos como `Blob` nativo (lazy), o custo é baixo; para `ArrayBuffer` já em memória, é uma cópia extra. Aceitável, mas a otimização real de disco fica fora de escopo (PRD).
9. **`FormData` como corpo**: cada `new Response(formData)` gera um boundary novo, então dois `Range` pedidos em sequência podem ter bytes diferentes. Caso não realista para asset estático; registrado.
10. **Validação do ambiente**: nada foi executado nesta etapa. `pnpm lint`, `pnpm typecheck` e os testes são requisitos do contrato e só podem ser confirmados na implementação.

## 7. Decisões sobre os pontos em aberto

- **P-1 — Validador de data forte (decidido).** RFC 9110 §8.8.2.2 trata `Last-Modified` como validador fraco, a não ser que ele seja pelo menos um segundo anterior à data da resposta (`Date`). Em §13.1.5, `If-Range` com data exige validador forte. Decisão: `matchesIfRange` só honra data quando `mtime` truncado a segundos está pelo menos 1 s antes do instante atual truncado a segundos. Refletido em D-05 e no caso de teste "data a menos de um segundo" (T-04).
- **P-2 — `content-length` do usuário é sobrescrito em 206/416 (mantido).** Um valor fixo do usuário deixaria a resposta parcial inválida. O comportamento de 200 não muda, e o teste existente continua valendo para ele.
- **P-3 — `bytes=-0` → 416 (mantido).** RFC 9110 §14.1.1: um byte-range-set só é satisfazível com um `first-byte-pos` menor que o tamanho ou um `suffix-length` diferente de zero. Confere com `srvx`.
- **P-4 — Código e tamanho de `static.ts` (mantido).** A lógica fica em `src/utils/static.ts` (D-01), como pede `pedido.md`. O arquivo passa de 200 linhas. O conflito com a convenção do `AGENTS.md` fica registrado como aceito.
- **P-5 — Corpo menor que `meta.size` (mantido).** Se `getContents` entregar menos bytes que `meta.size`, o stream termina antes do `content-length`. Não há checagem extra: a falha aparece na transmissão, como acontece hoje com um 200 de tamanho errado.
