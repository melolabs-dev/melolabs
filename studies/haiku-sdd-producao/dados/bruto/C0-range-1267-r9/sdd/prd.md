# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

**Problema.** Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`: responde sempre `200` com o corpo inteiro e não anuncia `Accept-Ranges`. Isso impede retomar downloads, avançar/voltar em vídeo e áudio nos navegadores e players, e faz CDNs e proxies tratarem o asset como não fragmentável.

**Objetivo.** Fazer o `serveStatic` atender pedidos de intervalo de bytes (um único intervalo) em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`), seguindo a RFC 9110 (seções 13.1.5 — `If-Range` — e 14 — Range Requests), que substitui a RFC 7233 citada na issue. A mudança é interna e retrocompatível: sem novas opções e sem novas exportações públicas.

**Métricas de sucesso:** players seekam e downloads retomam contra um `serveStatic`; a suíte existente (ajustada apenas onde a mudança altera o resultado) e `pnpm lint` / `pnpm typecheck` passam.

## 2. Requisitos funcionais

Convenção: "tamanho conhecido" = `meta.size` é um número maior que 0. "Representação" = o conteúdo efetivamente servido (variante pré-comprimida, se selecionada); `size` e os offsets referem-se a ela.

### RF-01 — Anunciar `Accept-Ranges: bytes`

Respostas `200` de `GET`/`HEAD` de um asset com tamanho conhecido incluem `Accept-Ranges: bytes`. O mesmo vale para `206` e `416`.

**Aceite:**
- **Dado** um asset com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`,
- **Então** a resposta é `200`, com corpo e `Content-Length` inalterados e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Intervalo único válido retorna 206

Suportar as formas `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-n` (últimos n bytes). Se `b` ≥ tamanho, ele é limitado a `tamanho-1`; se `n` ≥ tamanho, devolve a representação inteira como `206`.

**Aceite:**
- **Dado** um asset de 10 bytes ("0123456789") com tamanho conhecido,
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, corpo `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`; `bytes=7-` e `bytes=-3` devolvem `789` com `Content-Range: bytes 7-9/10`, e `bytes=8-99` devolve `89` com `Content-Range: bytes 8-9/10`.

### RF-03 — HEAD com Range envia só cabeçalhos

**Aceite:**
- **Dado** o mesmo asset de 10 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, sem corpo, com `Content-Range: bytes 2-5/10` e `Content-Length: 4`, e `getContents` não é chamado.

### RF-04 — Intervalo não satisfatível retorna 416

Um intervalo sintaticamente válido, mas fora da representação (primeiro byte ≥ tamanho; `bytes=-0`), gera `416 Range Not Satisfiable`, sem corpo.

**Aceite:**
- **Dado** um asset de 10 bytes,
- **Quando** o cliente faz `GET` (ou `HEAD`) com `Range: bytes=10-20` ou `bytes=-0`,
- **Então** a resposta é `416` com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio, e `getContents` não é chamado.

### RF-05 — Range malformado, multi-range ou de outra unidade é ignorado

Valores inválidos (`bytes=abc`, `bytes=5-2`, `bytes=`), com mais de um intervalo (`bytes=0-1,4-5`) ou com unidade diferente de `bytes` (nome da unidade case-insensitive) são ignorados, e a resposta completa `200` é servida como se não houvesse `Range`.

**Aceite:**
- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,4-5` (ou `bytes=5-2`, ou `items=0-1`),
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`.

### RF-06 — `If-Range` condiciona o Range (RFC 9110 §13.1.5)

Com `If-Range`, o `Range` só vale se o validador casar: ETag com comparação **forte** (ETag fraco `W/` nunca casa) ou data idêntica ao `Last-Modified` enviado. Se não casar, ou se o asset não tiver o validador correspondente, o `Range` é ignorado e serve-se `200` completo. `If-Range` sem `Range` é ignorado.

**Aceite:**
- **Dado** um asset com `etag: "abc"` (forte) e `size` conhecido,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`, com `If-Range: "outro"` e com `If-Range: W/"abc"`,
- **Então** a primeira resposta é `206`; a segunda e a terceira são `200` com o corpo completo.

### RF-07 — Condicionais de cache têm precedência

`If-None-Match` e `If-Modified-Since` continuam avaliados antes do `Range`: se resultarem em `304`, o `Range` é ignorado.

**Aceite:**
- **Dado** um asset com `etag` e tamanho conhecido,
- **Quando** o cliente envia `If-None-Match` com o ETag atual e `Range: bytes=0-3`,
- **Então** a resposta é `304` sem corpo, exatamente como hoje.

### RF-08 — Cabeçalhos e encoding preservados em 206/416

`206` e `416` mantêm `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary` e os `headers` configurados em `ServeStaticOptions`. Com `encodings`, o intervalo se aplica à variante pré-comprimida selecionada, e o `size` é o dessa variante.

**Aceite:**
- **Dado** `encodings: { gzip: ".gz" }`, `Accept-Encoding: gzip` e a variante `.gz` com `size` 20,
- **Quando** o cliente envia `Range: bytes=0-9`,
- **Então** a resposta é `206` com os 10 primeiros bytes da variante `.gz`, `Content-Range: bytes 0-9/20`, `Content-Encoding: gzip` e `Vary: accept-encoding`.

### RF-09 — Fatiamento independente do tipo de `BodyInit`

O corte funciona para os tipos que `getContents` pode devolver (string, `Uint8Array`/`ArrayBuffer`, `Blob`/`File`, `ReadableStream`), entregando exatamente os bytes do intervalo.

**Aceite:**
- **Dado** um asset de 10 bytes devolvido como string, `Uint8Array`, `Blob` ou `ReadableStream`,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** em todos os casos o corpo tem exatamente 4 bytes (`2345`) e `Content-Length: 4`.

### RF-10 — Sem tamanho conhecido, comportamento atual

Quando `meta.size` é indefinido ou 0, o `Range` é ignorado (`200` completo, como hoje) e `Accept-Ranges` não é enviado.

**Aceite:**
- **Dado** um asset sem `size` em `getMeta`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `200` com o corpo completo, sem `Accept-Ranges` nem `Content-Range`.

### RF-11 — Compatibilidade com fluxos existentes

`fallthrough`, 404 (asset inexistente ou caminho não canônico), 405 com `Allow` (métodos diferentes de GET/HEAD) e a seleção de encoding permanecem iguais; `Range` não altera esses desfechos.

**Aceite:**
- **Dado** um asset inexistente (ou método `POST`),
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é a mesma de antes: 404, ou `undefined` com `fallthrough`, ou 405 com `Allow: GET, HEAD`.

### RF-12 — Sem nova API pública

**Aceite:**
- **Dado** o código após a mudança,
- **Quando** se compara `src/index.ts` e as exportações de `src/utils/static.ts` com a versão anterior,
- **Então** não há nomes novos (valores ou tipos) e os auxiliares são privados ao módulo (seção "Internal Utils").

## 3. Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): são ignorados (RF-05).
- Unidades de range diferentes de `bytes`.
- Range em outros métodos além de `GET`/`HEAD` e em outros utilitários (`proxy` etc.).
- Novas opções em `ServeStaticOptions`, mudanças em `StaticAssetMeta` ou qualquer exportação pública nova.
- Descobrir o tamanho de assets sem `size` (por exemplo, lendo o corpo para medi-lo).
- Otimizar o backend para ler só o trecho pedido (o corte ocorre após `getContents`).
- Compressão sob demanda e geração de ETag/`Last-Modified`.

## 4. Premissas e riscos

**Premissas**
- `meta.size` é o tamanho em bytes da representação realmente servida (variante comprimida incluída); se o backend informar um tamanho errado, o `Content-Range` ficará incorreto.
- A issue pede "sempre anunciar `Accept-Ranges`" mas limita o recurso a "tamanho conhecido"; adota-se a leitura conservadora: anunciar só com tamanho conhecido (RF-01, RF-10). Ponto a confirmar com o mantenedor.
- `HEAD` e `GET` usam a mesma lógica de decisão; `HEAD` apenas omite o corpo.
- O intervalo é aplicado sobre os bytes da variante com `Content-Encoding` selecionado, como manda a RFC 9110.

**Riscos**
- **Testes existentes** que comparam cabeçalhos exatos podem passar a ver `Accept-Ranges`; ajustar só esses, preservando o que verificam.
- **Fatiar `ReadableStream`/`Blob`** pode custar memória ou exigir consumir bytes descartados; validar em Node e web (`describeMatrix`).
- **`Content-Length` pré-definido** (via `headers` ou `meta.size`) precisa ser sobrescrito corretamente em `206`/`416`, sem vazar o valor completo.
- **Divergência entre `size` e o corpo real** pode gerar respostas truncadas ou inconsistentes; mitigar com testes e documentar a premissa.
- **Cache/CDN:** `206` e `416` devem manter validadores e `Vary` para não corromper caches intermediários.
- **Parsing de Range** (inteiros enormes, espaços, caixa da unidade) é fonte clássica de bugs; cobrir com testes de borda.
