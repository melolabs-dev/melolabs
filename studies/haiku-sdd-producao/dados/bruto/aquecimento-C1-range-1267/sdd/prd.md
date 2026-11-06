# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (issue #1267 e contrato de comportamento), `src/utils/static.ts`, RFC 9110 seção 14 (antiga RFC 7233).

## Problema e objetivo

### Problema

O utilitário `serveStatic` ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, o h3 responde sempre com `200` e o corpo inteiro, sem anunciar suporte a ranges. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeos e áudios servidos pelo h3, já que players de mídia dependem de `206 Partial Content`;
- comportamento correto de CDNs e proxies que dependem de `Accept-Ranges` e `Content-Range`.

### Objetivo

Fazer `serveStatic` (`src/utils/static.ts`) atender pedidos `GET` e `HEAD` com um único intervalo de bytes, conforme RFC 9110, sem quebrar o comportamento atual de cache, codificação, `fallthrough`, 404 e 405 e sem criar nova exportação pública.

## Requisitos funcionais

### RF-01 — Anúncio de suporte a Range

Toda resposta que serve um asset encontrado deve trazer `Accept-Ranges: bytes`, com ou sem cabeçalho `Range` no pedido.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`,
- **Quando** o cliente faz `GET` sem cabeçalho `Range`,
- **Então** a resposta é `200` com `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Formas de intervalo único aceitas

O módulo deve aceitar as três formas de intervalo único da norma: `bytes=a-b` (início e fim), `bytes=a-` (do início até o fim do arquivo) e `bytes=-n` (os últimos `n` bytes). O tamanho usado em todos os cálculos é o `size` retornado por `getMeta`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes com `size: 1000` em `getMeta`,
- **Quando** o cliente pede `Range: bytes=100-199`, `Range: bytes=900-` ou `Range: bytes=-100`,
- **Então** a resposta é `206` com o trecho correspondente a cada forma (bytes 100 a 199, bytes 900 a 999 e bytes 900 a 999, respectivamente).

### RF-03 — Resposta parcial 206

Para um intervalo válido e satisfazível, a resposta é `206 Partial Content`, com corpo contendo somente os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho enviado. Um fim maior que o tamanho do asset é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente pede `Range: bytes=500-2000`,
- **Então** a resposta é `206`, `Content-Range: bytes 500-999/1000`, `Content-Length: 500` e o corpo tem exatamente os bytes 500 a 999.

### RF-04 — Intervalo não satisfazível 416

Quando o início do intervalo está no tamanho do asset ou além dele, a resposta é `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente pede `Range: bytes=1000-1100`,
- **Então** a resposta é `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-05 — Ignorar Range multi-intervalo e malformado

Pedidos com vários intervalos (multi-range), `Range` com unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim não geram erro. O `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente pede `Range: bytes=0-9,20-29`, `Range: items=0-9`, `Range: bytes=abc` ou `Range: bytes=500-100`,
- **Então** a resposta é `200`, sem `Content-Range`, com o corpo inteiro.

### RF-06 — HEAD com Range

Um `HEAD` com `Range` devolve os mesmos status e cabeçalhos que o `GET` equivalente devolveria (`206` com `Content-Range` e `Content-Length` do trecho, `416` quando não satisfazível, ou `200` quando o Range é ignorado), sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-9`,
- **Então** a resposta é `206`, `Content-Range: bytes 0-9/1000`, `Content-Length: 10` e corpo vazio.

### RF-07 — Intervalo sobre a representação codificada

Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida (por exemplo `.gz` ou `.br`), o intervalo e o tamanho em `Content-Range` e `Content-Length` se referem a essa variante, que é a representação efetivamente enviada.

**Critério de aceite**

- **Dado** um asset `app.js` de 1000 bytes e uma variante `app.js.gz` de 300 bytes configurada em `encodings`,
- **Quando** o cliente pede `Accept-Encoding: gzip` com `Range: bytes=0-99`,
- **Então** a resposta é `206`, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/300` e `Content-Length: 100`.

### RF-08 — If-Range com comparação forte

Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com o corpo inteiro. Se corresponde, o `Range` é aplicado normalmente. A comparação de entity-tag usa comparação forte, conforme a norma. Um `If-Range` com data (`Last-Modified`) é comparado com o `Last-Modified` do asset, também de forma exata.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"`,
- **Quando** o cliente pede `Range: bytes=0-9` com `If-Range: "xyz"`,
- **Então** a resposta é `200` com o corpo inteiro;
- **E** quando o cliente pede o mesmo Range com `If-Range: "abc"`, a resposta é `206` com bytes 0 a 9.
- **E** um `If-Range` com etag fraco (`W/"abc"`) não corresponde, e o Range é ignorado.

### RF-09 — Preservação do comportamento existente

Os cabeçalhos de cache e de conteúdo (`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding`) devem ser os mesmos da resposta completa também nas respostas parciais. Continuam iguais ao comportamento atual: `304` por `If-None-Match` e `If-Modified-Since`, seleção de encoding, `fallthrough`, `404` para asset inexistente e `405` para métodos diferentes de `GET` e `HEAD`.

**Critério de aceite**

- **Dado** um asset com `etag` e um pedido com `If-None-Match` igual ao etag,
- **Quando** o cliente envia também `Range: bytes=0-9`,
- **Então** a resposta é `304` sem corpo, como hoje.
- **E** **Dado** um método `POST`, **quando** a requisição chega com `fallthrough: false`, **então** a resposta continua `405` com `Allow: GET, HEAD`.

### RF-10 — Nenhuma exportação pública nova

`src/index.ts` não ganha nenhum nome novo (nem valores nem tipos). Funções auxiliares de parsing de Range e de If-Range ficam privadas no módulo, sem `export`.

**Critério de aceite**

- **Dado** o módulo após a mudança,
- **Quando** se compara a lista de exports de `src/index.ts` antes e depois,
- **Então** a lista é idêntica.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos desse tipo são ignorados e servidos com `200`.
- Unidades diferentes de `bytes`.
- Range para assets sem `size` conhecido em `getMeta`.
- Alterar a assinatura ou o contrato de `getMeta` e `getContents`, incluindo passar o intervalo para `getContents`. Se necessário, isso vira outro PRD.
- Compressão ou codificação feita em tempo real a partir do corpo, fora das variantes pré-comprimidas.
- Suporte a Range em outros utilitários (`proxy`, `static` de `h3/rules`, etc.).
- Novas opções públicas em `ServeStaticOptions`.
- Cache de respostas parciais e lógica de CDN além dos cabeçalhos descritos.
- Mudanças em `pnpm lint`, `pnpm typecheck` ou na configuração de testes. Eles devem continuar passando sem alteração.

## Premissas

1. O `size` de `getMeta` é o tamanho real da representação servida (a variante, quando houver encoding pré-comprimido). Sem `size`, o Range não é aplicado e a resposta segue o fluxo atual.
2. `getContents(id)` continua devolvendo o corpo completo, sem receber o intervalo. O recorte dos bytes é feito pelo `serveStatic` sobre o corpo retornado. Esta premissa é a principal fonte de risco (ver abaixo).
3. A avaliação de `If-None-Match`/`If-Modified-Since` (304) acontece antes da avaliação de `Range`, como já ocorre no fluxo atual.
4. Um sufixo `bytes=-0` (zero bytes) é tratado como não satisfazível (`416`), conforme a RFC 9110. O contrato não o detalha, então este caso precisa de confirmação.
5. Quando o `size` é `0`, o asset não aplica Range. O código atual só define `Content-Length` para `size > 0`, e a regra de intervalo sobre arquivo vazio não está no contrato.
6. Testes existentes cobrem os fluxos atuais de 200, 304, 404, 405 e encodings, e devem continuar passando.

## Riscos

1. **Recorte do corpo sem API de intervalo (alto).** Como `getContents` não recebe o intervalo, um asset grande é lido inteiro antes de ser recortado. Isso pode aumentar uso de memória e latência em vídeos e downloads grandes. Mitigação: recortar via stream quando o corpo for `ReadableStream`, e documentar o custo para os demais tipos de `BodyInit`. A otimização completa fica fora do escopo.
2. **Inconsistência entre `size` e o corpo real (médio).** Se `getMeta` informar um `size` diferente do tamanho real de `getContents`, o `Content-Range` ficará errado. Mitigação: confiar no `size` do contrato e documentar a exigência.
3. **Ordem de avaliação (médio).** Combinar `If-Range`, `If-None-Match` e `Range` pode gerar respostas incorretas se a ordem não seguir a RFC. Mitigação: testes de matriz cobrindo essas combinações.
4. **Compatibilidade de runtime (baixo).** O código deve usar só APIs web padrão (`Request`, `Response`, `Headers`) para continuar funcionando nos seis entries de plataforma. Mitigação: testes com `describeMatrix` (web e node).
5. **Regressão em cache e encoding (médio).** Mudanças em `static.ts` podem afetar `304`, `Vary` e a seleção de encoding. Mitigação: manter o conjunto de testes existente verde e adicionar casos de regressão antes da implementação (fluxo de bug fix do AGENTS.md).
