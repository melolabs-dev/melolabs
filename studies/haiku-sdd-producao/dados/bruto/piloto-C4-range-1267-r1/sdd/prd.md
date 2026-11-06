# PRD: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range` das requisições. Mesmo quando o cliente pede um trecho, o servidor responde com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Na prática:

- downloads não podem ser retomados;
- players de mídia do navegador não conseguem avançar (seek) em vídeos e áudios servidos pelo h3;
- CDNs e proxies não se comportam como esperado diante de respostas parciais.

**Objetivo:** fazer `serveStatic` atender pedidos de intervalo de um único trecho, conforme a RFC 9110, seção 14 (antiga RFC 7233), sem alterar a API pública do h3 nem o comportamento atual de cache, codificação, fallthrough, 404 e 405.

## 2. Requisitos funcionais

### RF-01 — Anúncio de suporte a Range

Toda resposta que serve um asset encontrado traz `Accept-Ranges: bytes`, com ou sem cabeçalho `Range` na requisição.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` sem `Range`
- **Então** a resposta é `200`, traz `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Intervalo único nas três formas da norma

O servidor aceita um único intervalo nas formas `bytes=a-b` (início e fim), `bytes=a-` (do início até o fim do arquivo) e `bytes=-n` (últimos N bytes). O tamanho usado é o `size` retornado por `getMeta`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`, `Range: bytes=900-` ou `Range: bytes=-100`
- **Então** o servidor calcula o trecho correspondente (100 a 199, 900 a 999 e 900 a 999, respectivamente) para a resposta parcial.

### RF-03 — Resposta parcial 206

Para um intervalo válido e satisfazível, a resposta é `206 Partial Content`, com corpo contendo somente os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho enviado. Um fim maior que o tamanho do asset é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=500-1500`
- **Então** a resposta é `206`, `Content-Range: bytes 500-999/1000`, `Content-Length: 500` e o corpo tem exatamente os bytes 500 a 999.

### RF-04 — Intervalo não satisfazível 416

Quando o início do intervalo está no tamanho do asset ou além dele, a resposta é `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-`
- **Então** a resposta é `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-05 — Ignorar Range multi-intervalo ou malformado

Pedidos com vários intervalos, com unidade diferente de `bytes`, com sintaxe inválida ou com início maior que o fim não geram erro. O cabeçalho `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `Range: bytes=0-1,5-9`, `Range: items=0-9`, `Range: bytes=abc` ou `Range: bytes=9-3`
- **Então** a resposta é `200`, com corpo completo e sem `Content-Range`.

### RF-06 — HEAD com Range

Uma requisição `HEAD` com `Range` devolve o mesmo status e os mesmos cabeçalhos que o `GET` equivalente devolveria, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-99`
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-07 — Range sobre a representação codificada

Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, que é a representação efetivamente enviada.

**Critério de aceite**

- **Dado** um asset `app.js` de 1000 bytes e uma variante `app.js.gz` de 300 bytes, e o cliente envia `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta é `206`, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/300` e o corpo são os bytes 0 a 99 da variante `.gz`.

### RF-08 — If-Range

Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com corpo inteiro. Se corresponde, o `Range` é aplicado normalmente. A comparação de entity-tag segue a comparação forte da norma.

**Critério de aceite**

- **Dado** um asset com `ETag: "abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "xyz"`
- **Então** a resposta é `200` com corpo completo.
- **E** **quando** o cliente envia `Range: bytes=0-9` com `If-Range: "abc"`
- **Então** a resposta é `206` com os bytes 0 a 9.
- **E** **quando** o cliente envia `If-Range: W/"abc"` (validador fraco)
- **Então** o `Range` é ignorado e a resposta é `200`.

### RF-09 — Preservação do comportamento existente

Cabeçalhos de cache e de conteúdo (`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding`) são os mesmos da resposta completa, também nas respostas `206` e `416` quando aplicável. Respostas `304` por `If-None-Match` ou `If-Modified-Since`, seleção de encoding, `fallthrough`, `404` para asset inexistente e `405` para métodos diferentes de `GET` e `HEAD` continuam funcionando como hoje.

**Critério de aceite**

- **Dado** a suíte de testes existente de `serveStatic`
- **Quando** ela é executada após a mudança
- **Então** todos os testes existentes passam sem alteração de expectativa.
- **E** **dado** um pedido com `If-None-Match` igual ao `ETag` atual e um `Range` válido
- **Quando** o servidor responde
- **Então** a resposta é `304`, sem corpo.

### RF-10 — Sem exportações públicas novas

`src/index.ts` não ganha nomes novos (nem valores, nem tipos). As funções auxiliares ficam privadas ao módulo, sem `export`.

**Critério de aceite**

- **Dado** o estado do repositório antes e depois da mudança
- **Quando** se compara `src/index.ts` e as exportações do pacote
- **Então** não há nomes adicionados e as exportações públicas são idênticas.

### RF-11 — Qualidade do código

O código novo segue as convenções do projeto (`AGENTS.md`), e `pnpm lint` e `pnpm typecheck` passam sem erros.

**Critério de aceite**

- **Dado** a branch com a mudança
- **Quando** o time executa `pnpm lint` e `pnpm typecheck`
- **Então** ambos terminam sem erros.

## 3. Fora de escopo

- Suporte a múltiplos intervalos (`multipart/byteranges`). Pedidos desse tipo são ignorados (RF-05).
- Range em respostas que não são assets servidos por `serveStatic` (por exemplo, respostas geradas por handlers, proxies ou `h3/rules/proxy`).
- Compressão sob demanda ou transformação do corpo para atender ao intervalo. O intervalo é aplicado somente sobre o arquivo ou variante pré-comprimida existente.
- Novas opções de configuração de `serveStatic`. O comportamento é fixo.
- Validação de `If-Range` com data (`Last-Modified`). Ver premissas e riscos.
- Alterações em outros utilitários do h3 (`proxy`, `cache`, `body`) e no pacote de rules.
- Mudanças de API pública, de documentação extensa ou de benchmarks.

## 4. Premissas e riscos

### Premissas

- `getMeta` sempre informa `size` para os assets servidos. O issue assume tamanho conhecido; o contrato não define o que acontece sem tamanho (ver riscos).
- O cálculo de `Range` ocorre depois da seleção de encoding e usa o tamanho da variante escolhida.
- O `ETag` atual do asset (ou da variante) é o validador usado no `If-Range`.
- Não há cabeçalhos de cache ou de conteúdo que precisem mudar entre respostas `200` e `206`, exceto `Content-Length` e `Content-Range`.

### Riscos e pontos em aberto

- **Sufixo maior que o arquivo** (`bytes=-n` com `n > tamanho`): a norma pede o arquivo inteiro como `206`. O contrato não cita o caso, então precisa ser confirmado antes da implementação.
- **Sufixo de zero bytes** (`bytes=-0`): a norma trata como não satisfazível (`416`). Também não consta no contrato.
- **`If-Range` com data**: o contrato fala só em entity-tag. A norma aceita data, com comparação exata a `Last-Modified`. Decidir se a data é ignorada (Range não aplicado, `200`) ou tratada.
- **Asset sem `size`** em `getMeta`: não há como montar `Content-Range`. Definir se o `Range` é ignorado nesse caso.
- **Interação com `304`**: a ordem de avaliação (condicionais antes de Range) precisa ser fixada para não regredir RF-09.
- **Variantes pré-comprimidas com `Vary`**: cache intermediário pode misturar representações se `Vary` não cobrir `Range` e `Accept-Encoding`. Revisar se `Vary` deve incluir `Range` ou se basta o existente.
- **Regressão em HEAD e 405**: o caminho de HEAD é compartilhado com GET; há risco de corpo indevido ou de status diferente. Coberto por RF-06 e RF-09.
- **Testes**: a suíte roda em modo `web` e `node`. Os testes de Range precisam cobrir os dois modos para evitar diferenças de implementação.
