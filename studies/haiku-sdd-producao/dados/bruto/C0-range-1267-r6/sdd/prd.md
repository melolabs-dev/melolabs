# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando o cliente pede um trecho do arquivo, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia (seek);
- CDNs e proxies não conseguem usar requisições parciais contra a origem.

### Objetivo

Fazer o `serveStatic` atender pedidos de intervalo de bytes conforme a RFC 9110 (seções 13.1.5 — `If-Range` — e 14 — Range Requests), que substitui a RFC 7233 citada na issue. O comportamento é:

- suportar **um único** intervalo de bytes, em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`);
- responder `206` para intervalos válidos e `416` para intervalos não satisfatíveis;
- ignorar (servir `200` completo) pedidos malformados, com unidade desconhecida ou com múltiplos intervalos.

A mudança é interna e retrocompatível: usa só as opções que `ServeStaticOptions` já oferece e não cria API pública.

### Restrições herdadas do pedido

- Nenhuma exportação nova em `src/index.ts` (nem valores, nem tipos); auxiliares ficam privados em `src/utils/static.ts`.
- Cache (`etag`, `last-modified`, 304), seleção de encoding, `fallthrough` e as respostas 404/405 continuam como hoje.
- A suíte existente continua passando; só se ajustam testes que dependam do que a mudança altera, sem perder o que verificam.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a ranges

O `serveStatic` informa `Accept-Ranges: bytes` nas respostas de um asset encontrado (`200`, `206` e `416`, para `GET` e `HEAD`).

**Critério de aceite**

- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`,
- **Então** a resposta é `200` com `Accept-Ranges: bytes` e o mesmo corpo e demais cabeçalhos de antes.

### RF-02 — Intervalo único válido responde 206

Para um `Range: bytes=...` com um único intervalo satisfatível, a resposta é `206 Partial Content` com `Content-Range: bytes <início>-<fim>/<size>` e `Content-Length` igual ao número de bytes do trecho. O corpo contém exatamente esses bytes.

Formas aceitas:

- `bytes=a-b`;
- `bytes=a-` (até o fim);
- `bytes=-n` (últimos `n` bytes; se `n` ≥ `size`, devolve o arquivo todo com `206`).

Se `b` ≥ `size`, o fim é ajustado para `size - 1`.

**Critério de aceite**

- **Dado** um asset de 10 bytes (`0123456789`),
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** a resposta é `206`, com corpo `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`; e `bytes=7-` → `789` (`7-9/10`), `bytes=-3` → `789` (`7-9/10`), `bytes=8-99` → `89` (`8-9/10`).

### RF-03 — HEAD com range envia só cabeçalhos

Para `HEAD` com intervalo válido, a resposta traz o mesmo status e cabeçalhos que o `GET` equivalente (`206`, `Content-Range`, `Content-Length` do trecho) e **corpo vazio**. `getContents` não é chamado.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta é `206` com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio.

### RF-04 — Intervalo não satisfatível responde 416

Quando o intervalo é sintaticamente válido mas não satisfatível (início ≥ `size`, `bytes=-0`, ou qualquer intervalo sobre asset de `size` 0), a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<size>`, `Content-Length: 0` e corpo vazio. `getContents` não é chamado.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=10-` (ou `bytes=50-60`, ou `bytes=-0`),
- **Então** a resposta é `416`, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio.

### RF-05 — Range inválido, desconhecido ou múltiplo é ignorado

O cabeçalho `Range` é ignorado, e o servidor responde `200` completo, nos casos:

- sintaxe malformada (`bytes=abc`, `bytes=5`, `bytes=--1`, valor vazio);
- intervalo invertido (`bytes=5-2`);
- unidade diferente de `bytes` (`items=0-1`);
- múltiplos intervalos (`bytes=0-1,4-5`).

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,4-5` (ou `bytes=5-2`, `bytes=abc`, `items=0-1`),
- **Então** a resposta é `200` com o corpo completo, `Content-Length: 10` e sem `Content-Range`.

### RF-06 — Range só se aplica com tamanho conhecido

Se `getMeta` não devolve `size`, o `Range` é ignorado e a resposta é `200` completa, como hoje. O servidor não inventa `Content-Range` nem `416` sem saber o tamanho.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

### RF-07 — `If-Range` condiciona o range

Quando há `Range` e `If-Range`:

- se `If-Range` é um entity-tag **forte** igual ao `etag` do asset, ou uma data HTTP exatamente igual ao `last-modified`, o range é atendido (RF-02/RF-04);
- caso contrário (etag diferente, etag fraco `W/`, data diferente, valor inválido, ou asset sem validador correspondente), o `Range` é ignorado e a resposta é `200` completa.

`If-Range` sem `Range` não tem efeito.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"` e 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`, e depois com `If-Range: "outro"`,
- **Então** a primeira resposta é `206` com `Content-Range: bytes 0-3/10` e a segunda é `200` com o corpo completo.

### RF-08 — Preservar cache condicional (304)

A avaliação de `If-None-Match` / `If-Modified-Since` continua antes do range. Se o cache casar, a resposta é `304` como hoje, mesmo com `Range` presente.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"`,
- **Quando** o cliente envia `If-None-Match: "abc"` junto com `Range: bytes=0-3`,
- **Então** a resposta é `304` sem corpo, igual ao comportamento atual.

### RF-09 — Preservar encoding e demais cabeçalhos

O range se aplica à representação efetivamente escolhida (por exemplo, a variante pré-comprimida `.gz`/`.br`); `size` é o tamanho dessa variante. `Content-Encoding`, `Content-Type`, `Vary`, `ETag`, `Last-Modified` e os `headers` das opções continuam presentes na resposta `206`/`416` como estariam no `200`. Em `206` e `416`, o `Content-Length` herdado de `options.headers` ou do tamanho total não prevalece sobre o do trecho.

**Critério de aceite**

- **Dado** `encodings: { gzip: ".gz" }`, um `app.js.gz` de 20 bytes e `Accept-Encoding: gzip`,
- **Quando** o cliente envia `Range: bytes=0-4`,
- **Então** a resposta é `206` com `Content-Encoding: gzip`, `Vary: accept-encoding`, `Content-Range: bytes 0-4/20`, `Content-Length: 5` e os 5 primeiros bytes da variante comprimida.

### RF-10 — Preservar 404, 405 e `fallthrough`

Ranges não alteram as respostas para asset inexistente, caminho não canônico ou método não permitido: continuam `404`/`405` (ou retorno `undefined` com `fallthrough`), sem `Accept-Ranges` indevido nem `Content-Range`. Métodos diferentes de `GET`/`HEAD` seguem retornando `405` com `Allow: GET, HEAD` mesmo com `Range`.

**Critério de aceite**

- **Dado** um caminho sem asset (ou um `POST`),
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é a mesma de hoje (`404`, ou `405` com `Allow: GET, HEAD`; `undefined` se `fallthrough` estiver ativo).

### RF-11 — Sem API pública nova

As funções de parsing e de fatiamento do range ficam privadas em `src/utils/static.ts`. `src/index.ts` e os tipos públicos (`StaticAssetMeta`, `ServeStaticOptions`) não ganham nomes.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se comparam as exportações de `src/index.ts` e de `src/utils/static.ts` com as de antes,
- **Então** não há nenhum nome novo, e `pnpm lint` e `pnpm typecheck` passam.

### RF-12 — Fatiar o corpo devolvido por `getContents`

O trecho enviado deve corresponder aos bytes `[início, fim]` do conteúdo devolvido por `getContents`, para os tipos de `BodyInit` que o `serveStatic` já aceita e cujos bytes seja possível fatiar (`string`, `Blob`/`File`, `ArrayBuffer`/views, `ReadableStream`). Se o conteúdo for `null`/`undefined` ou não puder ser fatiado de forma confiável, o servidor responde `200` completo, sem `Content-Range`.

**Critério de aceite**

- **Dado** um `getContents` que devolve respectivamente um `string`, um `Uint8Array`, um `Blob` e um `ReadableStream` com os mesmos 10 bytes,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** cada resposta é `206` com exatamente os bytes `2345`.

## 3. Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): são ignorados e servidos como `200` completo.
- Unidades de range diferentes de `bytes`.
- Ranges em respostas que não sejam de asset (erros, redirects) e em outros utilitários (`proxy`, `sendStream` etc.).
- Novas opções em `ServeStaticOptions`, novos campos em `StaticAssetMeta` ou novas exportações públicas.
- Mudar a API do `getContents` para aceitar o intervalo (leitura parcial na origem, por exemplo `fs.createReadStream` com `start/end`); o corte é feito pelo `serveStatic` sobre o que `getContents` já entrega.
- Mudanças em `Last-Modified`/`ETag`, em cache ou em compressão dinâmica.
- Documentação além de atualizar, se existir, a descrição de `serveStatic` na doc do projeto.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação que será de fato enviada (já a variante codificada, quando houver encoding).
- Ranges se aplicam à representação já codificada, de acordo com a RFC 9110: o cliente endereça os bytes de `Content-Encoding`.
- A RFC 9110 prevalece sobre a RFC 7233 citada na issue; onde divergirem, vale a 9110.
- A decisão de anunciar `Accept-Ranges: bytes` apenas em respostas de asset encontrado (e não em 404/405) é compatível com "preservar 404/405". A issue diz "sempre", mas só faz sentido onde há representação.
- Asset de `size` 0 é um tamanho conhecido: qualquer range sobre ele é não satisfatível (`416`, `Content-Range: bytes */0`). Hoje o `content-length` não é emitido para `size` 0, e isso continua assim nas respostas `200`.

### Riscos

- **Fatiar `ReadableStream`/`BodyInit` arbitrário:** pode exigir ler e descartar bytes (custo de CPU e memória em arquivos grandes) ou ser impossível para alguns tipos (`FormData`, `URLSearchParams`). Mitigação: fatiar de forma preguiçosa quando possível (`Blob.slice`, `subarray`) e cair para `200` completo quando não for confiável (RF-12).
- **Divergência entre `size` e o conteúdo real:** se `getMeta.size` não bater com os bytes de `getContents`, o `Content-Range` ficará incorreto. É responsabilidade do backend, mas deve ser documentada.
- **`Content-Length` já definido em `options.headers`:** o valor total pode contradizer o do trecho. O código deve sobrescrevê-lo em `206`/`416` (RF-09).
- **Regressões em testes existentes:** testes que verificam o conjunto exato de cabeçalhos da resposta `200` podem falhar por causa do novo `Accept-Ranges`. Devem ser ajustados só nisso, sem enfraquecer o que verificam.
- **Ordem de avaliação de pré-condições:** errar a ordem (304 antes do range, `If-Range` antes do range) quebra o cache ou serve conteúdo inconsistente após mudança do arquivo. Coberto por RF-07 e RF-08.
- **Interação com proxies/CDNs:** `Accept-Ranges` + `Vary: accept-encoding` com ranges em variantes comprimidas exige que o `ETag` distinga as variantes; backends que reusam o mesmo etag para variantes diferentes podem causar mistura de bytes entre variantes no cliente. Fora do controle do `serveStatic`, mas vale registrar.
