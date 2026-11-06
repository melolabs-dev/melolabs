# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema
O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia (seeking);
- CDNs e proxies não conseguem se comportar corretamente com os assets.

### Objetivo
Fazer o `serveStatic` atender pedidos de intervalo de bytes únicos, conforme a RFC 9110, seção 14 (antiga RFC 7233), para `GET` e `HEAD`. A mudança é interna e retrocompatível: sem alteração de API pública e sem regressão de cache, encoding, `fallthrough`, `404` e `405`.

### Métricas de sucesso
- Todos os critérios de aceite abaixo cobertos por testes automatizados (matriz `web` e `node`, via `describeMatrix`).
- Suíte existente, `pnpm lint` e `pnpm typecheck` continuam passando.
- `src/index.ts` sem nomes novos.

## 2. Requisitos funcionais

Em todos os requisitos, o "tamanho do asset" é o `size` informado por `getMeta` para a variante efetivamente servida.

### RF-01 — Anúncio de suporte a ranges
Toda resposta que serve um asset encontrado traz `Accept-Ranges: bytes`, com ou sem `Range` no pedido.

- **Dado** um asset existente com `size` conhecido
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta `200` contém `Accept-Ranges: bytes` e o corpo completo (no `GET`).

### RF-02 — Formas de intervalo único aceitas
São aceitas as três formas de intervalo único da norma: `bytes=a-b`, `bytes=a-` (início aberto até o fim) e `bytes=-n` (sufixo, últimos N bytes).

- **Dado** um asset de 10 bytes (`0123456789`)
- **Quando** o cliente envia `Range: bytes=2-5`, `Range: bytes=7-` ou `Range: bytes=-3`
- **Então** o corpo contém, respectivamente, `2345`, `789` e `789`, todos com status `206`.

### RF-03 — Resposta parcial 206
Para um intervalo válido e satisfazível, a resposta é `206 Partial Content`, com só os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho. Um fim além do tamanho é limitado ao último byte; um sufixo maior que o asset devolve o asset inteiro como `206`.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=5-100`
- **Então** a resposta é `206` com `Content-Range: bytes 5-9/10`, `Content-Length: 5` e corpo com os bytes 5 a 9.

### RF-04 — Intervalo não satisfazível (416)
Quando o início do intervalo é maior ou igual ao tamanho do asset, a resposta é `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`. Para o sufixo, `bytes=-0` também é não satisfazível.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=10-20`
- **Então** a resposta é `416` com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio.

### RF-05 — Ranges ignorados (multi-range e malformados)
Pedido com vários intervalos, unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim não gera erro: o `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro (mantendo `Accept-Ranges: bytes`).

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=0-1,4-5`, `Range: items=0-1`, `Range: bytes=abc` ou `Range: bytes=5-2`
- **Então** a resposta é `200` com o corpo inteiro e sem `Content-Range`.

### RF-06 — HEAD equivalente ao GET
Um `HEAD` com `Range` devolve os mesmos status e cabeçalhos que o `GET` equivalente, sem corpo.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=2-5` (e, separadamente, com `bytes=10-20`)
- **Então** as respostas são `206` com `Content-Range: bytes 2-5/10` e `Content-Length: 4`, e `416` com `Content-Range: bytes */10`, ambas sem corpo e com os mesmos cabeçalhos do `GET` correspondente.

### RF-07 — Variante pré-comprimida
Quando o `Accept-Encoding` seleciona uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, a representação efetivamente enviada.

- **Dado** um asset com variante `.gz` de 6 bytes, configurada em `encodings`, e `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-2`
- **Então** a resposta é `206` com `Content-Range: bytes 0-2/6`, `Content-Encoding: gzip` e os 3 primeiros bytes da variante comprimida.

### RF-08 — If-Range
Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com o corpo inteiro. Se corresponde, o `Range` é aplicado. A comparação de entity-tag é forte (RFC 9110, 13.1.5): etags fracas (`W/`) nunca correspondem. Validador em formato de data corresponde apenas se for exatamente igual ao `Last-Modified` atual.

- **Dado** um asset com `ETag: "v1"` e um pedido com `Range: bytes=0-3`
- **Quando** o cliente envia `If-Range: "v2"` (e, separadamente, `If-Range: "v1"`)
- **Então** com `"v2"` a resposta é `200` com o corpo inteiro; com `"v1"` a resposta é `206` com os 4 primeiros bytes.

### RF-09 — Cabeçalhos preservados nas respostas parciais
`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` e `Content-Encoding` são idênticos aos da resposta completa também em `206` (e em `416`, quando aplicável ao asset).

- **Dado** um asset com `etag`, `mtime`, `type` e `headers` de cache configurados
- **Quando** o cliente envia um `Range` válido
- **Então** a resposta `206` traz os mesmos valores desses cabeçalhos que a resposta `200` completa.

### RF-10 — Comportamentos existentes inalterados
`304` por `If-None-Match`/`If-Modified-Since`, seleção de encoding, `fallthrough`, `404` para asset inexistente e `405` para métodos fora de `GET`/`HEAD` continuam como hoje.

- **Dado** um pedido com `Range` combinado com `If-None-Match` que corresponde, ou para um asset inexistente, ou com método `POST`
- **Quando** o `serveStatic` processa o pedido
- **Então** devolve respectivamente `304`, `404` (ou `undefined` com `fallthrough`) e `405` (com `Allow: GET, HEAD`), como antes da mudança.

### RF-11 — Sem novas exportações públicas
- **Dado** o código após a implementação
- **Quando** se inspeciona `src/index.ts` e o módulo `src/utils/static.ts`
- **Então** `src/index.ts` não ganha nenhum nome novo (valores ou tipos) e as funções auxiliares de Range não têm `export`.

## 3. Fora de escopo

- Respostas multi-range (`multipart/byteranges`): pedidos multi-range são tratados como `200` completo.
- Range para métodos além de `GET` e `HEAD`.
- Assets sem `size` informado por `getMeta` (tamanho desconhecido): sem range, resposta normal.
- Compressão/descompressão dinâmica; só variantes pré-comprimidas existentes.
- Novas opções em `ServeStaticOptions` ou mudanças em `StaticAssetMeta`.
- Mudanças em outros utilitários (`proxy`, `cache`, etc.) ou nos adaptadores de plataforma.
- Suporte a `Range` com unidades personalizadas.

## 4. Premissas e riscos

### Premissas
- O `size` de `getMeta` é confiável e igual ao número de bytes que `getContents` entrega para a mesma `id` (variante). O código atual só define `Content-Length` quando `size > 0`.
- `getContents` devolve `BodyInit` (string, `Blob`, `ReadableStream`, `Uint8Array` etc.); o recorte do trecho precisa funcionar para os tipos suportados, sem carregar tudo em memória quando houver stream.
- `If-Range` com data compara por igualdade exata com o `Last-Modified` emitido (RFC 9110, 13.1.5).
- A ordem de avaliação segue a RFC 9110, seção 13.2.2: pré-condições `If-None-Match`/`If-Modified-Since` (304) antes de `Range`/`If-Range`.
- Os testes seguem o padrão `describeMatrix` do projeto, e o código deve respeitar as convenções do `AGENTS.md` (ESM, imports com `.ts`, arquivos curtos, helpers privados no fim do arquivo ou em `utils/internal/`).

### Riscos
- **Helpers fora do módulo:** o contrato exige helpers privados sem `export`; extraí-los para `utils/internal/` exigiria export interno e pode conflitar com "privados dentro do módulo". Mitigação: manter dentro de `static.ts` e vigiar o limite de ~200 linhas.
- **`Content-Length` já definido:** o código atual define `content-length` com o tamanho total antes do ramo `HEAD`; o fluxo precisa sobrescrever esse valor para `206`/`416`, sem quebrar `Content-Length` informado via `options.headers`.
- **`size` ausente ou 0:** assets sem tamanho confiável devem cair no `200` normal; `416` com `size: 0` precisa de decisão explícita (assume-se `Content-Range: bytes */0`).
- **Recorte de corpo por tipo:** recortar `ReadableStream`, `Blob` e `Uint8Array` de forma consistente nas matrizes `web` e `node`; risco de divergência de comportamento entre runtimes.
- **Interação com encoding:** a variante servida define o tamanho; erro ao usar o tamanho do asset descomprimido geraria `Content-Range` incorreto (RF-07).
- **Regressão em cache:** `Vary` e `ETag` precisam permanecer idênticos; cobrir com testes de comparação entre `200` e `206`.
- **Cabeçalho de range muito grande ou números além de `Number.MAX_SAFE_INTEGER`:** tratar como malformado e ignorar.
