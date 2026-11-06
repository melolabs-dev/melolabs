# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema
O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor devolve o corpo inteiro e não anuncia suporte a intervalos. Isso impede retomar downloads, avançar em vídeos e áudios nos navegadores e players, e atrapalha o comportamento correto de CDNs e proxies.

### Objetivo
Fazer o `serveStatic` atender pedidos de intervalo de bytes de intervalo único em `GET` e `HEAD`, conforme a RFC 9110 seção 14 (antiga RFC 7233). A mudança é interna e retrocompatível: não altera a API pública. O tamanho do asset vem do `size` informado por `getMeta`.

### Métricas de sucesso
- Players e clientes HTTP conseguem seek e retomada de download contra um `serveStatic`.
- O conjunto de testes existente, `pnpm lint` e `pnpm typecheck` continuam passando.
- `src/index.ts` não ganha nenhum nome novo.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos
Toda resposta que serve um asset encontrado inclui `Accept-Ranges: bytes`, com ou sem `Range` no pedido.

**Critério de aceite**
- Dado um asset existente servido por `serveStatic`
- Quando o cliente faz `GET` (ou `HEAD`) com ou sem o cabeçalho `Range`
- Então a resposta contém `Accept-Ranges: bytes`.

### RF-02 — Aceitar as três formas de intervalo único
São aceitas `bytes=a-b` (início e fim), `bytes=a-` (início aberto até o fim) e `bytes=-n` (sufixo com os últimos N bytes).

**Critério de aceite**
- Dado um asset de 100 bytes
- Quando o cliente envia `Range: bytes=10-19`, `Range: bytes=90-` ou `Range: bytes=-10`
- Então cada pedido é tratado como intervalo válido e resulta em `206` com os bytes 10 a 19, 90 a 99 e 90 a 99, respectivamente.

### RF-03 — Resposta parcial 206
Para intervalo válido e satisfazível, responder `206 Partial Content` com só os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho. Fim além do tamanho é limitado ao último byte.

**Critério de aceite**
- Dado um asset de 100 bytes
- Quando o cliente envia `Range: bytes=50-999`
- Então a resposta é `206`, com `Content-Range: bytes 50-99/100`, `Content-Length: 50` e corpo com os bytes 50 a 99.

### RF-04 — Intervalo não satisfazível 416
Se o início do intervalo for igual ou maior que o tamanho do asset, responder `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**
- Dado um asset de 100 bytes
- Quando o cliente envia `Range: bytes=100-` (ou `bytes=150-200`)
- Então a resposta é `416`, com `Content-Range: bytes */100`, `Content-Length: 0` e corpo vazio.

### RF-05 — Ignorar Range multi-intervalo ou malformado
Pedidos com vários intervalos, unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim não geram erro. O `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro.

**Critério de aceite**
- Dado um asset existente
- Quando o cliente envia `Range: bytes=0-4,10-14`, `Range: items=0-4`, `Range: bytes=abc` ou `Range: bytes=20-10`
- Então a resposta é `200` com o corpo completo e sem `Content-Range`.

### RF-06 — HEAD com Range
Um `HEAD` com `Range` devolve os mesmos status e cabeçalhos que o `GET` equivalente, sem corpo.

**Critério de aceite**
- Dado um asset de 100 bytes
- Quando o cliente envia `HEAD` com `Range: bytes=0-9`
- Então a resposta é `206`, com `Content-Range: bytes 0-9/100` e `Content-Length: 10`, e sem corpo; um `HEAD` com intervalo não satisfazível devolve `416` com os mesmos cabeçalhos do `GET`, também sem corpo.

### RF-07 — Intervalo sobre a representação codificada
Quando `Accept-Encoding` seleciona uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, a representação efetivamente enviada.

**Critério de aceite**
- Dado um asset com variante pré-comprimida selecionada por `Accept-Encoding` e cujo `size` no `getMeta` é o da variante
- Quando o cliente envia `Range` junto com esse `Accept-Encoding`
- Então o corpo e o `Content-Range` usam o tamanho e os bytes da variante, e `Content-Encoding` permanece o da resposta completa.

### RF-08 — If-Range
Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, ignorar o `Range` e responder `200` com o corpo inteiro. Se corresponde, aplicar o `Range`. A comparação de entity-tag usa comparação forte.

**Critério de aceite**
- Dado um asset com `ETag` conhecido
- Quando o cliente envia `Range` com `If-Range` igual ao `ETag` forte atual
- Então a resposta é `206`; e, se o `If-Range` for diferente do `ETag` atual, ou for um `ETag` fraco (`W/`), a resposta é `200` com o corpo inteiro.

### RF-09 — Preservar cabeçalhos e comportamentos existentes
Respostas parciais mantêm `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` e `Content-Encoding` iguais aos da resposta completa. Continuam como hoje: `304` por `If-None-Match`/`If-Modified-Since`, seleção de encoding, `fallthrough`, `404` para asset inexistente e `405` para métodos diferentes de `GET`/`HEAD`.

**Critério de aceite**
- Dado um asset existente e um pedido com `Range` válido
- Quando a resposta `206` é comparada com a resposta completa do mesmo asset
- Então os cabeçalhos de cache e de conteúdo listados são idênticos; e, sem `Range`, os casos `304`, `404`, `405` e `fallthrough` se comportam como antes da mudança.

### RF-10 — Sem novas exportações públicas
Funções auxiliares ficam privadas no módulo `static.ts`, sem `export`. `src/index.ts` não ganha nomes novos, nem valores nem tipos.

**Critério de aceite**
- Dado o código após a mudança
- Quando se comparam as exportações públicas de `src/index.ts` com as anteriores
- Então são idênticas, e nenhum helper novo de `src/utils/static.ts` é exportado.

## 3. Fora de escopo
- Múltiplos intervalos (`multipart/byteranges`); são ignorados, não atendidos.
- Intervalos quando o tamanho do asset é desconhecido (sem `size` no `getMeta`).
- Unidades de intervalo diferentes de `bytes`.
- Mudanças de API pública, novas opções de configuração ou novos tipos exportados.
- Suporte a Range em outros utilitários (`proxy`, `serveStatic` de outros adaptadores etc.).
- Alterações em cache, seleção de encoding, `fallthrough`, `404` e `405` além do necessário para preservá-los.

## 4. Premissas e riscos

### Premissas
- `getMeta` informa `size` confiável e correspondente à representação enviada (inclusive a variante codificada).
- O `Range` só é avaliado em `GET` e `HEAD`; os demais métodos seguem retornando `405`.
- O `ETag` do asset vem de `getMeta` e a comparação de `If-Range` com entity-tag é forte; `If-Range` com data é comparado com `Last-Modified`.
- O `read` do asset devolve o conteúdo completo ou um stream que o módulo pode fatiar, sem mudar o contrato de `getContents`.

### Riscos
- **Tamanho divergente entre `size` e o conteúdo real**: pode gerar `Content-Length` errado. Mitigação: testes com variantes codificadas e validação do tamanho enviado.
- **Fatiar streams em múltiplos runtimes** (web e node): pode divergir entre adaptadores. Mitigação: testes com `describeMatrix` nos dois modos.
- **Interação com `304` e `If-Range`**: ordem de avaliação das condicionais pode alterar o status. Mitigação: manter a precedência da RFC 9110 (`If-None-Match`/`If-Modified-Since` antes de `Range`) e cobrir com testes.
- **Regressão em respostas completas**: adicionar `Accept-Ranges` e novos caminhos pode afetar cabeçalhos existentes. Mitigação: rodar a suíte atual, `pnpm lint` e `pnpm typecheck`.
- **Vazamento de API**: um helper exportado por engano. Mitigação: conferir `src/index.ts` e os `export` de `static.ts` na revisão.
