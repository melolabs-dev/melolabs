# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD para um asset conhecido recebe `200 OK` com o corpo completo, e a resposta não anuncia `Accept-Ranges`. Por isso:

- clientes não conseguem retomar downloads interrompidos;
- players de vídeo e áudio não conseguem avançar (seek) no arquivo;
- CDNs e proxies não conseguem fazer cache ou revalidação parcial de forma correta.

**Objetivo:** fazer `serveStatic` atender pedidos de intervalo de bytes conforme a RFC 9110 (seções 13.1.5 e 14), mantendo sem alteração o comportamento de cache, seleção de encoding, `fallthrough`, 404 e 405. A mudança fica restrita ao módulo e não altera a API pública.

## Requisitos funcionais

### RF-01 — Anunciar suporte a ranges em bytes

`serveStatic` passa a enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado para GET e HEAD, nos status 200, 206 e 416.

**Critério de aceite**

- **Dado** um asset existente e uma requisição GET sem cabeçalho `Range`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `200` com o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder 206 para um intervalo único válido

Quando a requisição traz `Range: bytes=<início>-<fim>`, `bytes=<início>-` ou `bytes=-<sufixo>` com um único intervalo válido e satisfazível, `serveStatic` responde `206 Partial Content` com a parte pedida do asset.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição GET com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `206`, o corpo tem exatamente os bytes 0 a 99 do asset e o cabeçalho `Content-Range` é `bytes 0-99/1000`.

### RF-03 — Cabeçalhos e corpo corretos no 206

A resposta 206 traz `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes do corpo. Os demais cabeçalhos que hoje acompanham o 200 (`Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary`) continuam presentes.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição GET com `Range: bytes=-100`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `206`, `Content-Range` é `bytes 900-999/1000`, `Content-Length` é `100` e o corpo contém os últimos 100 bytes do asset.

### RF-04 — HEAD com intervalo envia apenas cabeçalhos

Para HEAD com `Range` válido, a resposta usa o mesmo status e os mesmos cabeçalhos que o GET (206 com `Content-Range` e `Content-Length` do trecho) e não envia corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição HEAD com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `206`, `Content-Range` é `bytes 0-99/1000`, `Content-Length` é `100` e o corpo está vazio.

### RF-05 — 416 para intervalo não satisfazível

Quando o intervalo é sintaticamente válido, mas não se aplica ao tamanho do asset (início além do fim do arquivo, sufixo de zero bytes, ou qualquer intervalo de um asset de tamanho zero), `serveStatic` responde `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição GET com `Range: bytes=1000-1100`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `416`, `Content-Range` é `bytes */1000`, `Content-Length` é `0` e não há corpo.

### RF-06 — Ignorar Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` não for uma lista de um único intervalo `bytes` bem formado (unidade diferente de `bytes`, sintaxe inválida, `início > fim`, ou mais de um intervalo separado por vírgula), `serveStatic` ignora o `Range` e responde `200` com o asset completo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição GET com `Range: bytes=0-10,20-30`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `200`, sem `Content-Range`, com o corpo completo do asset.

### RF-07 — Respeitar If-Range

Quando a requisição traz `If-Range`, o `Range` só é aplicado se o validador enviado corresponde ao estado atual do asset: um ETag forte igual ao `ETag` atual, ou uma data igual ao `Last-Modified` atual. Caso contrário, `serveStatic` ignora o `Range` e responde `200` com o asset completo. ETag fraco nunca corresponde em `If-Range` (RFC 9110, 13.1.5).

**Critério de aceite**

- **Dado** um asset com `ETag: "v1"` e a requisição GET com `Range: bytes=0-99` e `If-Range: "v0"`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `200` com o asset completo, sem `Content-Range`.

### RF-08 — Ordem de avaliação e tamanho desconhecido

As verificações condicionais existentes (`If-None-Match` e `If-Modified-Since`, que geram 304) são avaliadas antes de `Range`. Quando o `getMeta` não informa `size`, `serveStatic` ignora `Range` e responde `200` completo, pois não há como calcular o intervalo.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size`, e a requisição GET com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `200` com o asset completo e sem `Content-Range`.

- **Dado** um asset com `ETag: "v1"` e a requisição GET com `If-None-Match: "v1"` e `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `304`, sem corpo e sem `Content-Range`.

### RF-09 — Preservar o comportamento existente

Cache (`304`), seleção de variante comprimida por `Accept-Encoding`, `fallthrough`, `404` para asset inexistente e `405` para método não permitido continuam iguais. Quando há variante comprimida, o `Range` se refere aos bytes dessa variante (a representação codificada), e `Content-Encoding` é mantido.

**Critério de aceite**

- **Dado** um asset `app.js` com variante `app.js.gz` e a requisição GET com `Accept-Encoding: gzip`, `Range: bytes=0-9`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `206`, tem `Content-Encoding: gzip`, e `Content-Range` e `Content-Length` referem-se aos bytes do arquivo `.gz`.

- **Dado** uma requisição POST para um asset existente com `Range: bytes=0-9`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje.

### RF-10 — Sem novas exportações públicas

`src/index.ts` não ganha nenhum nome novo, nem valor nem tipo. As funções auxiliares ficam privadas ao módulo `src/utils/static.ts`, e `ServeStaticOptions` e `StaticAssetMeta` não mudam de formato.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações de `src/index.ts` com a versão anterior,
- **Então** as listas são idênticas.

### RF-11 — Cobertura nos dois ambientes de teste

Os testes novos usam `describeMatrix`, então rodam em `web` e `node`. Cobrem os casos de RF-02 a RF-09.

**Critério de aceite**

- **Dado** a suíte de testes após a mudança,
- **Quando** se roda `pnpm vitest run` no arquivo de testes de static,
- **Então** todos os casos passam nos modos `web` e `node`.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem o asset completo (RF-06).
- Pré-condições `If-Match` e `If-Unmodified-Since` (RFC 9110, 13.1.1 e 13.1.4), que geram 412.
- Streaming parcial de `getContents`: a assinatura de `getMeta` e `getContents` não muda, então o intervalo é calculado sobre o corpo já retornado (ver riscos).
- Suporte a `Range` em outros handlers (`proxy`, `h3/rules/cache`, `h3/rules/proxy`) ou em respostas que não vêm de `serveStatic`.
- Novas opções em `ServeStaticOptions`, como flag para desligar `Range`.
- Mudanças em `Accept-Ranges` para respostas 304, 404 e 405, que permanecem como hoje.
- Atualização de documentação pública além dos comentários do próprio módulo.

## Premissas

- **Norma:** a issue cita a RFC 7233, que foi substituída pela RFC 9110. Vale a RFC 9110, como indica o pedido.
- **Tamanho:** o `size` retornado por `getMeta` é o tamanho em bytes da variante escolhida (a variante comprimida, se houver). A implementação depende disso para calcular `Content-Range`.
- **Corpo:** o `BodyInit` retornado por `getContents` pode ser `string`, `Blob`, `ArrayBuffer`, `ReadableStream` ou outro tipo. Presume-se que o recorte em bytes consegue ser feito para os tipos usados em `serveStatic`, com `string` tratada como UTF-8.
- **Cabeçalhos:** cabeçalhos já definidos em `event.res.headers` (como `Vary`, `ETag`, `Last-Modified`) são carregados para a resposta 206 e 416 do mesmo jeito que para a 200.
- **Validador de data em If-Range:** a comparação com `Last-Modified` é feita por igualdade exata da data em segundos, como o cabeçalho já é truncado hoje.
- **Asset vazio:** um asset de tamanho zero não recebe `Content-Length` no 200 (como hoje). Em RF-05, qualquer `Range` resulta em 416 com `Content-Length: 0`.
- **Testes existentes:** ajustes só nos testes que checam cabeçalhos ou status alterados pela nova resposta `Accept-Ranges`, sem reduzir o que eles verificam.

## Riscos

- **Leitura completa do arquivo (alto):** como `getContents` não recebe intervalo, cada 206 lê o asset inteiro antes de recortar. Em vídeo grande, isso aumenta o uso de memória e o tempo de resposta a cada seek. O custo deve ser medido em um benchmark antes de considerar a entrega concluída. A correção de verdade exigiria mudar a API de `getContents`, o que está fora de escopo.
- **Recorte por tipo de corpo (médio):** recortar `ReadableStream` e `Blob` de forma correta sem carregar tudo em memória exige código específico por tipo. Tipos sem recorte seguro podem cair no 200 completo, o que precisa ser decidido e testado.
- **Encoding e tamanho (médio):** se `getMeta` informar o tamanho da variante errada ou não informar o tamanho de variantes comprimidas, o `Content-Range` sai errado. RF-09 cobre o caso com `.gz`.
- **If-Range com ETag fraco (baixo):** a regra de comparação forte é fácil de errar. Os testes de RF-07 precisam cobrir ETag fraco.
- **Quebra de testes existentes (baixo):** a nova `Accept-Ranges` pode alterar asserções de cabeçalhos já existentes. Esses testes devem ser ajustados sem perder o que verificam.
- **Ordem de avaliação (baixo):** se `Range` for avaliado antes de `If-None-Match`, uma requisição com cache válido poderia receber 206 em vez de 304. RF-08 cobre o caso.
- **Verificação (requisito de entrega):** `pnpm lint` e `pnpm typecheck` precisam passar. Os testes de `serveStatic` precisam passar nos modos `web` e `node`.
