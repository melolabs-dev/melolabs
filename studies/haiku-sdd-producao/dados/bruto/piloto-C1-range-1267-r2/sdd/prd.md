# PRD: Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range` das requisições. Mesmo quando o cliente pede um trecho, o servidor responde com o corpo inteiro e sem os cabeçalhos de conteúdo parcial. Com isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) de forma eficiente;
- CDNs e proxies não recebem o comportamento esperado de um servidor de arquivos estáticos.

**Objetivo:** fazer o `serveStatic` atender pedidos de intervalo de bytes conforme a RFC 9110, seção 14 (antiga RFC 7233), para `GET` e `HEAD`, sem alterar a API pública nem o comportamento atual nos demais casos.

## Requisitos funcionais

### RF-01 — Anúncio de suporte a intervalos

O `serveStatic` deve informar que aceita intervalos em toda resposta que serve um asset encontrado, com ou sem cabeçalho `Range` no pedido.

**Critério de aceite**

- **Dado** um asset existente servido pelo `serveStatic`
- **Quando** o cliente faz um `GET` sem cabeçalho `Range`
- **Então** a resposta `200` traz `Accept-Ranges: bytes`.

### RF-02 — Formas aceitas de intervalo único

O `serveStatic` deve aceitar um único intervalo nas três formas da norma: `bytes=a-b` (início e fim), `bytes=a-` (do início até o fim do arquivo) e `bytes=-n` (os últimos `n` bytes). O tamanho usado nos cálculos é o `size` informado por `getMeta`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`, depois `bytes=900-` e depois `bytes=-50`
- **Então** as respostas cobrem, respectivamente, os bytes 100 a 199, 900 a 999 e 950 a 999.

### RF-03 — Resposta parcial 206

Para um intervalo válido e satisfazível, o `serveStatic` deve responder `206 Partial Content`, com corpo contendo somente os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho enviado. Se o fim informado ultrapassar o tamanho do asset, ele é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=990-2000`
- **Então** a resposta é `206`, com `Content-Range: bytes 990-999/1000`, `Content-Length: 10` e corpo com exatamente 10 bytes.

### RF-04 — Intervalo não satisfazível (416)

Quando o início do intervalo está no tamanho do asset ou além dele, a resposta deve ser `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta é `416`, sem corpo, com `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-05 — Ignorar Range multi-intervalo ou malformado

Pedidos com vários intervalos, unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim não devem gerar erro. O cabeçalho `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `Range: bytes=0-1,5-9`, ou `Range: items=0-1`, ou `Range: bytes=9-3`, ou `Range: bytes=abc`
- **Então** a resposta é `200`, com o corpo inteiro e sem `Content-Range`.

### RF-06 — Comportamento de HEAD com Range

Um `HEAD` com `Range` deve devolver o mesmo status e os mesmos cabeçalhos que o `GET` equivalente devolveria, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-99`
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/1000` e `Content-Length: 100`, e não há corpo; os cabeçalhos são iguais aos de um `GET` com o mesmo `Range`.

### RF-07 — Intervalo sobre a representação codificada

Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` devem se referir a essa variante, que é a representação efetivamente enviada.

**Critério de aceite**

- **Dado** um asset com variante `.gz` pré-comprimida de 300 bytes, e o asset original de 1000 bytes
- **Quando** o cliente envia `Accept-Encoding: gzip` e `Range: bytes=0-99`
- **Então** a resposta é `206` com `Content-Encoding: gzip`, `Content-Range: bytes 0-99/300` e `Content-Length: 100`.

### RF-08 — Validação com If-Range

Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com o corpo inteiro. Se corresponde, o `Range` é aplicado normalmente. A comparação de entity-tag segue a norma, com comparação forte.

**Critério de aceite**

- **Dado** um asset com `ETag: "abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "xyz"`
- **Então** a resposta é `200` com o corpo inteiro.
- **E** **dado** o mesmo asset, **quando** o cliente envia `Range: bytes=0-9` com `If-Range: "abc"`, **então** a resposta é `206` com 10 bytes.

### RF-09 — Preservação do comportamento atual

Os cabeçalhos de cache e de conteúdo (`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding`) devem ser os mesmos da resposta completa também nas respostas parciais. Respostas `304` por `If-None-Match` ou `If-Modified-Since`, a seleção de encoding, o `fallthrough`, o `404` para asset inexistente e o `405` para métodos diferentes de `GET` e `HEAD` devem continuar iguais.

**Critério de aceite**

- **Dado** um asset existente com `ETag` e `Cache-Control` definidos
- **Quando** o cliente envia `Range: bytes=0-9` e, em outro pedido, `If-None-Match` com o mesmo `ETag`
- **Então** a resposta parcial traz os mesmos `ETag`, `Cache-Control` e `Vary` da resposta completa, e o pedido condicional recebe `304`.
- **E** um `POST` continua recebendo `405`, e um asset inexistente continua recebendo `404` ou o `fallthrough` configurado.

### RF-10 — Nenhuma exportação pública nova

`src/index.ts` não ganha nomes novos (nem valores, nem tipos). As funções auxiliares ficam privadas dentro do módulo, sem `export`.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** o conjunto de exportações de `src/index.ts` é comparado com a versão anterior
- **Então** nenhum nome novo aparece.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com vários intervalos são ignorados, conforme RF-05.
- Suporte a unidades que não sejam `bytes`.
- Intervalos em respostas sem tamanho conhecido (por exemplo, streams sem `size` em `getMeta`).
- Alterações em outros utilitários (`proxy`, `rules/proxy`, `rules/cache`, `cache.ts` e similares).
- Novas opções públicas de configuração do `serveStatic`.
- Compressão sob demanda: o `Range` se aplica apenas às variantes que já existem.
- Mudanças nas políticas de cache, nos cabeçalhos de segurança ou no roteamento.
- Alterações na configuração de lint, formatação ou build.

## Premissas e riscos

### Premissas

- `getMeta` retorna o `size` correto do asset servido. Para variantes pré-comprimidas, o tamanho usado em RF-07 é o da variante selecionada.
- O `serveStatic` já fornece `ETag` e `Last-Modified` para os assets quando disponíveis, e o `If-Range` usa esses validadores.
- O código de `Accept-Ranges` e de `Content-Range` pode ser adicionado sem conflito com cabeçalhos que o `serveStatic` já define.
- A suíte existente de testes (`describeMatrix`, cobrindo web e node) é suficiente para cobrir a regressão de RF-09.

### Riscos e pontos a confirmar

- **If-Range com data (HTTP-date).** O contrato trata apenas entity-tag. A RFC 9110 também aceita data no `If-Range`. Falta decidir o comportamento para data: ignorar o `Range` (serve 200 completo) ou comparar com `Last-Modified`. Recomenda-se decidir antes de implementar.
- **Sufixo com n igual a zero.** `bytes=-0` não é satisfazível pela norma e deve gerar `416`. Confirmar esse caso nos testes.
- **Sufixo maior que o arquivo.** `bytes=-n` com `n` maior que o tamanho deve cobrir o arquivo inteiro, não gerar erro. Confirmar.
- **Interação com `304` e `Range`.** Um pedido condicional que casa com o `ETag` deve retornar `304`, mesmo com `Range`. Confirmar a ordem de avaliação.
- **Regressão em `fallthrough` e em respostas pré-comprimidas.** Mudanças na seleção de variante podem afetar o comportamento atual. Cobrir com testes antes e depois.
- **Limite de 200 linhas por arquivo.** A lógica de Range pode fazer `src/utils/static.ts` ultrapassar a convenção do projeto. Se isso acontecer, mover os auxiliares para `utils/internal/` sem exportá-los publicamente.
