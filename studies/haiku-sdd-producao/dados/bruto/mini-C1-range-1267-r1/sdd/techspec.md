# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-10). Este documento decide o desenho e aponta os pontos exatos de alteração. Não altera código do projeto.

## 1. Visão geral

O fluxo de `serveStatic` (`src/utils/static.ts:101`) já resolve o asset, aplica cache (304) e define `content-length` a partir de `meta.size`. A mudança acrescenta, depois da montagem dos cabeçalhos e antes da leitura do corpo:

1. anunciar `Accept-Ranges: bytes` quando `meta.size` é numérico;
2. avaliar `If-Range` (somente se houver `Range`);
3. interpretar `Range` (um intervalo válido; qualquer outra coisa vira "ignorar");
4. responder `416`, `206` ou seguir como `200` atual;
5. para `206`, obter o corpo via `getContents` e fatiá-lo sem mudar a assinatura de `ServeStaticOptions`.

Nenhuma API pública muda. Todas as funções auxiliares ficam privadas no fim de `src/utils/static.ts`.

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica: `src/utils/static.ts`, helpers privados no fim do arquivo

- **Alternativas:** (a) módulo novo `src/utils/internal/range.ts` com parsing puro; (b) tudo em `src/utils/static.ts`.
- **Escolha: (b).** O PRD (RF-09) e o pedido exigem que os auxiliares fiquem privados em `src/utils/static.ts`. `AGENTS.md` permite helpers "at the end of files", e o arquivo já segue essa convenção (`src/utils/static.ts:280` "Internal Utils", `:282-351`).
- **Custo:** o arquivo passa de ~352 para ~450 linhas, acima da meta de "< 200 LoC" de `AGENTS.md`. Se a equipe preferir, a extração para `utils/internal/range.ts` é mecânica depois (sem mudança de API), mas o PRD pede o contrário. Registrado em Riscos.

### D-02 — Interpretação de `Range`: um intervalo, três formas, o resto ignorado

- **Alternativas:** (a) só `bytes=a-b`, como na issue; (b) `a-b`, `a-` e `-n` (PRD); (c) suporte a `multipart/byteranges`.
- **Escolha: (b).** `a-` e `-n` são o caso típico de players (seek até o fim, "últimos N bytes" para metadados MP4). (c) está fora de escopo (PRD). O resto é ignorado e vira `200` completo, conforme RFC 9110 §14.2 (o servidor pode ignorar `Range`):
  - unidade diferente de `bytes` (comparação case-insensitive, RFC 9110 §14.1);
  - vírgula no valor (mais de um intervalo);
  - sintaxe inválida, inclusive `a-b` com `b < a` (RFC 9110 §14.1.1: intervalo inválido é ignorado).
- Intervalo sintaticamente válido e sem bytes no asset (`a >= size`, `-0`, qualquer intervalo com `size === 0`) é **não satisfazível** → `416`, não ignorado (RFC 9110 §15.5.17).
- `b >= size` é recortado para `size - 1`; `-n` com `n > size` vira o arquivo inteiro (RFC 9110 §14.1.1).

### D-03 — `Accept-Ranges` só quando `size` é numérico

- **Alternativas:** (a) sempre, como pede a issue; (b) só com `size` numérico (PRD RF-01).
- **Escolha: (b).** Sem `size` não há como atender `Range` (o `content-length` e o `content-range` dependem dele), então o anúncio seria falso. `size: 0` **conta** como conhecido: o anúncio vai, e qualquer `Range` vira `416 bytes */0`.
- Não é anunciado em `304` (o `304` é devolvido antes, `src/utils/static.ts:243-248`).

### D-04 — Ordem de avaliação

Mantém a ordem da RFC 9110 §13.2.2 e a do PRD (RF-07):

1. método (`:116-122`), canonicidade (`:142-147`), lookup/404 (`:198-215`);
2. cabeçalhos de cache, `content-type`, `content-encoding`, `content-length` (`:227-270`);
3. **304** por `If-None-Match` / `If-Modified-Since` (`:243-248`) — prevalece;
4. **If-Range** (somente se houver `Range`);
5. **Range**: parse → `416` / `206` / `200` atual;
6. `HEAD` (`:272-274`) e `GET` (`:276-277`) como hoje.

- **Alternativa:** avaliar `Range` antes do 304. Rejeitada: a RFC manda o 304 vencer.

### D-05 — Cabeçalhos do `206`/`416` vão em `event.res.headers`, não só no `HTTPResponse`

- **Fato verificado:** `prepareResponse` monta `mergeHeaders(res.headers, preparedHeaders)` (`src/response.ts:201-204`), e `preparedHeaders` (os de `event.res`) sobrescrevem os do `HTTPResponse`. O `content-length` de `meta.size` já está em `event.res` (`src/utils/static.ts:268-270`), então, se o `206` levasse o `content-length` só no `HTTPResponse`, o valor errado venceria.
- **Escolha:** `content-length` e `content-range` são gravados com `event.res.headers.set(...)`. O status (`206`/`416`) vai no `HTTPResponse` (`init.status`), que tem prioridade sobre `event.res.status` (`src/response.ts:195`).
- **Consequência aceita:** em resposta de `Range`, o `content-length` de `options.headers` deixa de valer (um `206` precisa refletir o trecho). Sem `Range`, o comportamento atual (`src/utils/static.ts:268`, teste em `test/static.test.ts:600-617`) não muda.

### D-06 — `If-Range`: validador comparado com o cabeçalho servido

- **Alternativas:** (a) comparar com `meta.etag` / `meta.mtime`; (b) comparar com os cabeçalhos `etag` e `last-modified` que de fato estão em `event.res.headers`.
- **Escolha: (b).** É o que o cliente recebeu. Cobre `etag` e `last-modified` vindos de `options.headers`, e fica consistente com o `If-None-Match` atual, que usa `meta.etag` mas só quando o cabeçalho ainda não existe (`:239-241`).
- Regras (RFC 9110 §13.1.5):
  - valor que começa com `"` ou `W/"` é **entity-tag**: só casa com `etag` servido **forte** (não começa com `W/`), por comparação byte a byte. ETag fraca nunca casa.
  - demais valores são **HTTP-date**: casa só se `Date.parse(If-Range)` for igual ao `last-modified` servido (ambos em segundos, pois `last-modified` é truncado em `:232`). Data inválida ou ausente: não casa.
  - `If-Range` sem `Range` é ignorado.
  - Se não casar, o `Range` é descartado e segue o `200` completo.
- **Não** reaproveitar `matchETag` de `src/utils/internal/cache.ts:11`: ele faz comparação **fraca** (ignora `W/`), e `If-Range` exige forte.

### D-07 — Fatiamento do corpo: sem mudar `getContents`

- **Alternativas:** (a) novo parâmetro de intervalo em `getContents` (PRD: fora de escopo); (b) ler tudo como texto/`ArrayBuffer`; (c) fatiar `Blob` e `ReadableStream` sem materializar tudo quando possível.
- **Escolha: (c), em três ramos**, sempre dentro de `sliceContents` (helper privado):
  - `Blob` (`contents instanceof Blob`): `contents.slice(start, end + 1)`. Preguiçoso em Node, Bun e navegadores para blobs baseados em arquivo.
  - `ReadableStream`: wrapper de pull que descarta `start` bytes, emite `length` bytes e chama `cancel` na origem ao terminar. Ver D-08.
  - demais `BodyInit` (string, `ArrayBuffer`, views, `URLSearchParams`, `FormData`): `await new Response(contents).blob()` e então `slice`. Material já está em memória; `Response` normaliza todos os tipos de `BodyInit` com a mesma semântica que o caminho `200` usa (`src/response.ts:188-205`, o corpo vai para `FastResponse` como está).
- Bytes, não caracteres: string é codificada em UTF-8, igual ao corpo atual, então `size` e `content-length` continuam coerentes com o que `getContents` devolve.
- Só web standards (`Blob`, `Response`, `ReadableStream`, `Headers`), alinhado a `AGENTS.md` ("Prefer web standard APIs").
- `null`/`undefined` de `getContents` no caminho `206`: devolve o mesmo que o caminho `200` faz hoje (`:277`, corpo `null`), para não criar um tratamento novo. Registrado em Riscos.

### D-08 — `ReadableStream`: pular e cortar sem bufferizar

- **Alternativas:** (a) ler tudo e fatiar (custo de memória com vídeo grande); (b) limitar Range a `Blob`/`string` e responder `200` para stream; (c) wrapper de pull com skip/take.
- **Escolha: (c).** Stream é o caso de `getContents` que lê de disco ou de rede, e recusar Range nele quebraria o caso de uso (vídeo). O wrapper:
  - lê do `reader` só o necessário: descarta bytes até `start`, emite até `length` e para;
  - ao atingir `length`, chama `reader.cancel()` para liberar a origem em vez de drená-la;
  - o `cancel` do próprio stream repassa para o `reader`.
- Custo: bytes antes de `start` são lidos e descartados (não há seek em stream genérico). É a única forma sem mudar `getContents`.

### D-09 — `HEAD` e `416` com corpo nulo

- `HEAD` com `Range` válido: mesmo `206` e mesmos cabeçalhos do `GET`, corpo `null`. `prepareResponse` já zera corpo para `HEAD` (`src/response.ts:231-240`), mas o `HTTPResponse` deve ser criado com `null` mesmo assim, sem ler `getContents` (economia de I/O).
- `416`: `new HTTPResponse(null, { status: 416 })` + `content-range: bytes */<size>` e `content-length: 0` em `event.res.headers`. `getContents` não é chamado (RF-05).

### D-10 — `Range` e cache HTTP intermediário

- `src/rules/cache.ts:143-148` já trata `Range` como requisição que **não** é cacheada (`isBypassedRequest`). Não há mudança lá. `serveStatic` não é usado por `rules/` (busca em `src/` sem outras ocorrências), então nenhuma regra de cache por rota vê respostas `206` de `serveStatic`.
- Caches HTTP de terceiros podem armazenar `206` por `ETag`/`Last-Modified`. Não há `Vary` novo: o `Range` não altera a representação, só o trecho. Registrado em Riscos.

### D-11 — Escopo de exportação

- `src/index.ts:193` exporta `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta`. Nada novo é exportado. O teste de snapshot de exports `test/unit/package.test.ts:133` (lista que contém `"serveStatic"`) continua sendo a garantia de RF-09; não deve precisar de alteração.
- A JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) ganha um parágrafo curto sobre Range. Não é export nova nem documentação extensa.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Lógica de Range em `serveStatic` (após `src/utils/static.ts:270`, antes de `:272`) + helpers privados no fim (após `:351`). JSDoc em `:68-100`. |
| `test/static.test.ts` | Novo `describeMatrix("serve static range", ...)`. Inserir após o bloco de MIME (fim em `:624`), antes do bloco de malformed (`:626`), ou no fim do arquivo. |
| `sdd/techspec.md` | Este documento. |

Pontos de referência lidos e que **não** mudam:

- `src/utils/static.ts:9-15` (`StaticAssetMeta.size?: number`) e `:25`/`:33` (assinaturas de `getMeta`/`getContents`).
- `src/utils/internal/cache.ts:11` (`matchETag`, fraca) e `:29` (`isCacheMatch`, usada em `src/utils/static.ts:243`).
- `src/response.ts:96-106` (`HTTPResponse`), `:243-252` (`mergeHeaders`), `:322-337` (Blob), `:347` (corpo genérico).

Testes existentes: nenhum usa `Range` com `serveStatic` (busca em `test/` retornou só `test/rules/cache.test.ts:1214`, que é o cache de regras, e `test/unit/sanitize.test.ts`, que não é relevante). As asserções existentes usam `toMatchObject` (`test/static.test.ts:53`, `:69`), então `accept-ranges` extra não quebra. **Previsão: nenhum teste existente precisa de ajuste.** Se algum precisar, o ajuste será mínimo e registrado.

## 4. Contratos e assinaturas

### 4.1 Público (inalterado)

```ts
// src/utils/static.ts:101
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Nenhum novo campo em `ServeStaticOptions` (`src/utils/static.ts:17-66`). Nenhuma mudança em `StaticAssetMeta` (`:9-15`).

### 4.2 Privados (novos, em `src/utils/static.ts`, fim do arquivo)

```ts
/** Resultado de interpretar `Range` contra o tamanho do asset. Intervalos inclusivos. */
type RangeResult =
  | { type: "ignore" }                       // 200 completo (sintaxe inválida, outra unidade, multi-intervalo, If-Range não casou)
  | { type: "unsatisfiable" }                // 416
  | { type: "partial"; start: number; end: number }; // 206

/** Interpreta um `Range` de um único intervalo. `size` é o tamanho da representação servida. */
function parseRange(header: string, size: number): RangeResult;

/**
 * `If-Range` casa com os validadores servidos (RFC 9110 §13.1.5).
 * `headers` é `event.res.headers`, com `etag` e `last-modified` já definidos.
 */
function ifRangeMatches(ifRange: string, headers: Headers): boolean;

/** Devolve o trecho `[start, end]` (inclusivo) do corpo sem ler mais do que o necessário quando possível. */
function sliceContents(
  contents: Exclude<BodyInit, string> | string,
  start: number,
  end: number,
): Promise<Blob | ReadableStream<Uint8Array>>;

/** Pula `start` bytes e emite `length` bytes; cancela a origem ao terminar. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  length: number,
): ReadableStream<Uint8Array>;
```

Notas de contrato:
- `parseRange` não lê cabeçalhos; quem chama passa `event.req.headers.get("range")` já extraído.
- `sliceContents` é chamada só com `contents` não nulo. `null`/`undefined` não entram nesse caminho (ver D-07).
- Os tipos exatos (`BodyInit` aceito por `sliceContents`) são resolvidos pelo tipo de retorno de `getContents` (`src/utils/static.ts:33`), que já inclui `null | undefined`.

### 4.3 Comportamento observável (tabela)

Asset de 1000 bytes, `Accept-Ranges` presente em todas as respostas abaixo, exceto 304.

| Requisição | Status | `Content-Range` | `Content-Length` | Corpo | `getContents` |
| --- | --- | --- | --- | --- | --- |
| `GET` sem `Range` | 200 | — | 1000 | completo | chamado |
| `GET` `bytes=0-499` | 206 | `bytes 0-499/1000` | 500 | bytes 0–499 | chamado |
| `GET` `bytes=500-` | 206 | `bytes 500-999/1000` | 500 | bytes 500–999 | chamado |
| `GET` `bytes=-100` | 206 | `bytes 900-999/1000` | 100 | bytes 900–999 | chamado |
| `GET` `bytes=-5000` | 206 | `bytes 0-999/1000` | 1000 | completo | chamado |
| `GET` `bytes=0-5000` | 206 | `bytes 0-999/1000` | 1000 | completo | chamado |
| `GET` `bytes=1000-1500` | 416 | `bytes */1000` | 0 | — | **não** chamado |
| `GET` `bytes=-0` | 416 | `bytes */1000` | 0 | — | **não** chamado |
| `GET` `bytes=0-1,5-9` | 200 | — | 1000 | completo | chamado |
| `GET` `bytes=5-2` / `itens=0-9` / `bytes=abc` | 200 | — | 1000 | completo | chamado |
| `HEAD` `bytes=500-` | 206 | `bytes 500-999/1000` | 500 | — | não chamado |
| `GET` `Range` + `If-Range` que não casa | 200 | — | 1000 | completo | chamado |
| `GET` `Range` + `If-None-Match` que casa | 304 | — | — | — | não chamado |
| `GET` `Range` com asset sem `size` | 200 | — | (sem header, como hoje) | completo | chamado |
| `GET` `Range` com `size: 0` | 416 | `bytes */0` | 0 | — | não chamado |
| `POST` com `Range` | 405 | — | — | — | — (`Allow: GET, HEAD`) |
| `GET` `Range`, `fallthrough: true`, asset inexistente | `undefined` | — | — | — | — |

Regra de `-n` e `b`: `-n` com `n = 0` é não satisfazível; `b` maior que `size - 1` é recortado; `a > size - 1` é não satisfazível.

### 4.4 Pseudocódigo do bloco novo em `serveStatic`

Não é código final. Mostra só a ordem e onde cada cabeçalho é gravado.

```text
// após src/utils/static.ts:270, antes de :272
if meta.size é número:
  event.res.headers.set("accept-ranges", "bytes")

range = event.req.headers.get("range")
se range e meta.size é número:
  se if-range existe e não casa com event.res.headers → ignora Range
  senão:
    r = parseRange(range, meta.size)
    se r = unsatisfiable:
      event.res.headers.set("content-range", "bytes */" + size)
      event.res.headers.set("content-length", "0")
      retorna HTTPResponse(null, { status: 416 })
    se r = partial:
      event.res.headers.set("content-range", "bytes start-end/size")
      event.res.headers.set("content-length", length)
      se HEAD: retorna HTTPResponse(null, { status: 206 })
      contents = await getContents(id)
      se contents for null/undefined: retorna HTTPResponse(null, { status: 200 })  // D-07
      retorna HTTPResponse(await sliceContents(contents, start, end), { status: 206 })

// caminho atual (:272-277) sem alteração
```

Detalhe: `content-length` do `206` vem de `end - start + 1`. Não usar `meta.size`.

## 5. Estratégia de testes

Todos os novos testes ficam em `describeMatrix` (`test/static.test.ts:5`), rodando em `web` e `node`, com um asset de 1000 bytes cujo conteúdo é `"0123456789".repeat(100)`. Assim `body.slice(a, b + 1)` é a referência de cada asserção.

### 5.1 Casos (um `it` por linha, na ordem do PRD)

1. **RF-01**: `GET`/`HEAD` sem `Range` → 200, `accept-ranges: bytes`, corpo completo.
2. **RF-02**: `bytes=0-499` → 206, `content-range`, `content-length: 500`, corpo exato.
3. **RF-02**: `bytes=-100` → 206, `bytes 900-999/1000`, corpo exato.
4. **RF-02**: `bytes=500-` → 206.
5. **RF-02 (borda)**: `bytes=-5000` e `bytes=0-5000` → recorte para o arquivo inteiro.
6. **RF-02 com encoding**: `accept-encoding: gzip` com variante `.gz` de tamanho diferente → `content-range` e `content-length` usam o tamanho do `.gz`.
7. **RF-03**: `HEAD` com `bytes=500-` → 206, cabeçalhos, corpo vazio.
8. **RF-04**: `bytes=0-1,5-9` → 200 completo, sem `content-range`.
9. **RF-04**: `itens=0-9`, `bytes=abc`, `bytes=5-2` → 200 completo. Um caso por linha de `it.each` ou `for`, com mensagem.
10. **RF-05**: `bytes=1000-1500` → 416, `bytes */1000`, `content-length: 0`, `getContents` (`vi.fn`) não chamado.
11. **RF-05**: `bytes=-0` → 416.
12. **RF-05**: asset com `size: 0` e qualquer `Range` → 416 `bytes */0`.
13. **RF-06**: `If-Range` com ETag forte igual → 206.
14. **RF-06**: `If-Range` com ETag diferente → 200 completo.
15. **RF-06**: `If-Range` com ETag fraca (`W/"abc"`) → 200 completo, mesmo se o ETag servido for igual.
16. **RF-06**: `If-Range` com data igual ao `last-modified` servido → 206; data diferente ou inválida → 200.
17. **RF-07**: `If-None-Match` que casa + `Range` → 304 sem corpo.
18. **RF-08**: `fallthrough: true` + asset inexistente + `Range` → `next()` recebe a requisição (`undefined`).
19. **RF-08**: `POST` + `Range` → 405 com `allow: GET, HEAD`.
20. **Asset sem `size`**: sem `accept-ranges`, `Range` ignorado → 200 completo.
21. **Corpo por tipo** (um teste cada, para cobrir os três ramos de `sliceContents`):
    - `getContents` devolvendo `string`;
    - devolvendo `Blob`;
    - devolvendo `ReadableStream<Uint8Array>` (cria um stream novo a cada chamada). Verificar também que o `cancel` da origem foi chamado após atender `bytes=0-9` em um stream de 1000 bytes (prova de D-08 de que não se drena tudo).
22. **Stream com `start` no meio de um chunk**: stream com chunks de 300 bytes e `bytes=450-549` → corpo exato (cobre o corte dentro de chunk).

### 5.2 Testes existentes

- Rodar `pnpm vitest run test/static.test.ts test/security.test.ts test/rules/cache.test.ts` depois da mudança. Esperado: passam sem alteração.
- Teste `"does not overwrite a content-length already set on the response"` (`test/static.test.ts:600-617`) tem `HEAD` sem `Range`; deve continuar valendo.

### 5.3 Ordem de implementação (AGENTS.md "Bug Fix Workflow", adaptado)

1. Escrever os casos da seção 5.1 em `test/static.test.ts`.
2. Rodar e confirmar que falham (os de `Range` devem falhar; os de `Accept-Ranges` também).
3. Implementar em `src/utils/static.ts`.
4. Rodar `pnpm vitest run test/static.test.ts` até passar nos dois alvos.
5. Rodar `pnpm vitest run test/unit/package.test.ts` (snapshot de exports, RF-09).
6. Rodar `pnpm lint` e `pnpm typecheck`.
7. Rodar `pnpm test` (suíte completa com cobertura).

### 5.4 Comandos de verificação de RF-09

- `pnpm vitest run test/unit/package.test.ts` deve passar sem atualizar snapshot. Se a lista mudar, a mudança está errada.

## 6. Riscos

| Risco | Origem | Mitigação |
| --- | --- | --- |
| **Tamanho divergente** entre `meta.size` e o corpo real: `content-range`/`content-length` ficam errados. | PRD | Teste 21 com `string`/`Blob`/stream medindo bytes reais. Documentar que `size` é contrato. Não há como validar em tempo de execução sem ler o corpo inteiro. |
| **`Content-Length` sobrescrito**: `options.headers` com `content-length` deixa de valer em `206`. | D-05 | Aceito e documentado. Caminho sem `Range` intacto (teste `:600-617`). |
| **Ordem do `mergeHeaders`**: se `content-length`/`content-range` forem gravados só no `HTTPResponse`, `event.res` (com o `content-length` completo) vence. | D-05, `src/response.ts:201-204` | Gravar em `event.res.headers`. Teste 2 falha se a ordem regredir (`content-length` tem que ser 500, não 1000). |
| **Memória**: `Blob` de `string`/`ArrayBuffer` usa cópia. `getContents` já materializa o corpo, então o custo é uma cópia extra. | D-07 | Aceito para não-stream. Stream e `Blob` de arquivo são preguiçosos. Medir em benchmark (`test/bench/`) se a equipe pedir. |
| **Stream sem seek**: bytes antes de `start` são lidos e descartados. | D-08 | Aceito. `cancel` cedo evita ler o resto. Documentado. |
| **`null`/`undefined` de `getContents` com `206`**: resposta sem corpo com `content-length` de trecho. | D-07 | Mesmo comportamento do `200` atual para `null` (`src/utils/static.ts:277`). Caso raro. Registrar como débito. |
| **Respostas parciais com encoding**: cliente ou proxy pode combinar `206` com representação codificada errada. | PRD, D-02 | Teste 6 cobre `.gz`. `content-range` referencia o tamanho do `.gz`, como o `content-length` atual. |
| **Cache intermediário** de `206` por `ETag`/`Last-Modified`. | D-10, PRD | `rules/cache.ts:143-148` já não cacheia `Range`. Sem `Vary` novo. Revisar com a equipe antes de release. |
| **`If-Range` por data com precisão de segundos.** `mtime` com milissegundos é truncado (`src/utils/static.ts:232`); `Date.parse` do cliente também é em segundos. | PRD, D-06 | Comparar em `getTime()` após truncamento. Teste 16 cobre data igual ao `last-modified` servido. |
| **ETag `"w/123"` nos testes existentes** é minúscula, não `W/`. Pelo parser, é forte. | `test/static.test.ts:12-16` | Os testes novos usam `W/"..."` explícito para o caso fraco. Não mudar fixtures existentes. |
| **Arquivo acima de 200 LoC.** | D-01, `AGENTS.md` | Aceito por causa do PRD. Extração para `utils/internal/range.ts` é a saída se a equipe pedir. |
| **Reprodução do HTTP em Node** (`describeMatrix` roda os dois alvos): o adaptador de Node pode tratar `Blob`/stream de forma diferente de `web`. | Teste | A matriz cobre as duas. Se algum teste divergir só em Node, marcar com `it.skipIf` só para o caso específico, com justificativa, não para o conjunto. |
| **Ponto de decisão ainda aberto** no PRD: anúncio só com `size` (D-03) e formas `a-`/`-n` (D-02). | PRD (premissas) | Decisões assumidas aqui. Confirmar antes de implementar. |

## 7. Pendências e o que não foi feito

- Nenhum código do projeto foi alterado. Esta é só a especificação.
- Não rodei `pnpm install`, `pnpm test` nem os testes: a tarefa é a especificação. Os comandos da seção 5 são para a fase de implementação.
- As referências de linha foram conferidas com leitura direta dos arquivos nesta data (`src/utils/static.ts`, `src/response.ts`, `src/utils/internal/cache.ts`, `src/rules/cache.ts`, `src/index.ts`, `test/static.test.ts`, `test/unit/package.test.ts`). Se o código mudar antes da implementação, as linhas precisam ser rechecadas.
