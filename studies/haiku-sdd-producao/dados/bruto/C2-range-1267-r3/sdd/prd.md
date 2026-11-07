# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o header `Range`. Quando o cliente pede um intervalo de bytes, o servidor devolve o asset inteiro com `200` e não anuncia suporte a ranges. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio servidos pelo h3, já que players e navegadores enviam `Range` automaticamente;
- que CDNs e proxies façam cache e encaminhamento parcial corretamente.

**Objetivo:** fazer `serveStatic` atender requisições `Range` para GET e HEAD, com respostas `206` e `416` conforme RFC 9110, mantendo cache, seleção de encoding, `fallthrough` e as respostas de 404 e 405 como estão hoje, e sem novas exportações públicas.

## Requisitos funcionais

### RF-01 — Anunciar suporte a ranges

Toda resposta de asset encontrado em `serveStatic` deve anunciar `Accept-Ranges: bytes`, mesmo quando a requisição não traz `Range`.

**Critério de aceite**

- **Dado** um asset existente, com `getMeta` retornando `size`
- **Quando** o cliente faz `GET` ou `HEAD` sem header `Range`
- **Então** a resposta é `200` e contém `Accept-Ranges: bytes`

### RF-02 — Responder intervalo válido com 206

Quando o `Range` é um único intervalo `bytes=a-b` válido, a resposta deve ser `206 Partial Content`, com `Content-Range: bytes a-b/N`, `Content-Length` igual ao tamanho do intervalo (`b - a + 1`) e corpo com exatamente esses bytes.

**Critério de aceite**

- **Dado** um asset de `N` bytes com conteúdo conhecido
- **Quando** o cliente faz `GET` com `Range: bytes=a-b`, sendo `0 ≤ a ≤ b < N`
- **Então** a resposta é `206`, com `Content-Range: bytes a-b/N`, `Content-Length: b - a + 1` e o corpo contém os bytes de `a` a `b` do asset

### RF-03 — Intervalos abertos, sufixos e limites além do tamanho

O servidor deve aceitar as três formas de intervalo único da RFC 9110 §14.1.1: `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-k` (últimos `k` bytes). Um limite final maior que o tamanho é cortado no último byte; um sufixo maior que o tamanho resulta no asset inteiro.

**Critério de aceite**

- **Dado** um asset de `N` bytes
- **Quando** o cliente envia `bytes=a-` com `a < N`, `bytes=-k` com `k > 0`, ou `bytes=a-b` com `b ≥ N`
- **Então** a resposta é `206` com o intervalo correspondente (`a-(N-1)`, os últimos `min(k, N)` bytes, ou `a-(N-1)` respectivamente) e `Content-Range` coerente

### RF-04 — HEAD com Range

Para `HEAD`, um `Range` válido deve gerar `206` com os mesmos headers de RF-02, sem corpo, e sem chamar `getContents`.

**Critério de aceite**

- **Dado** um asset de `N` bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=a-b` válido
- **Então** a resposta é `206`, com `Content-Range` e `Content-Length` do intervalo, corpo vazio, e `getContents` não é chamado

### RF-05 — Range não satisfazível responde 416

Quando nenhum byte do asset cai no intervalo pedido, a resposta deve ser `416 Range Not Satisfiable`, com `Content-Range: bytes */N`, `Content-Length: 0` e sem corpo. Isso vale para `a ≥ N`, para o sufixo `bytes=-0` e para qualquer intervalo sobre um asset de tamanho `0`.

**Critério de aceite**

- **Dado** um asset de `N` bytes
- **Quando** o cliente envia `Range: bytes=a-b` com `a ≥ N`, ou `Range: bytes=-0`
- **Então** a resposta é `416`, com `Content-Range: bytes */N`, `Content-Length: 0` e corpo vazio

### RF-06 — Ignorar Range que o servidor não atende

Um `Range` malformado, com unidade diferente de `bytes`, ou com mais de um intervalo (ex.: `bytes=0-1,4-5`) deve ser ignorado. O servidor responde `200` com o asset completo, sem `Content-Range`.

**Critério de aceite**

- **Dado** um asset de `N` bytes
- **Quando** o cliente envia um `Range` malformado (ex.: `bytes=abc`), com unidade `items=0-1`, ou com múltiplos intervalos (`bytes=0-1,4-5`)
- **Então** a resposta é `200`, com `Content-Length: N`, sem `Content-Range` e com o asset completo

### RF-07 — Tamanho desconhecido ignora Range

Quando `getMeta` não informa `size` válido, nenhum `Range` é aplicado. A resposta é `200` completa, como hoje.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size`
- **Quando** o cliente faz `GET` com `Range: bytes=0-9`
- **Então** a resposta é `200` com o asset completo e sem `Content-Range`

### RF-08 — If-Range

Se a requisição trouxer `If-Range`, o `Range` só é aplicado quando o validador enviado corresponde ao estado atual do asset, usando comparação forte (RFC 9110 §13.1.5). Validador ETag fraco (`W/`) não corresponde. Se não houver correspondência, o `Range` é ignorado e a resposta é `200` completa.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"` e `Last-Modified` conhecido
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "v1"`
- **Então** a resposta é `206` com os 10 primeiros bytes
- **E quando** o cliente envia o mesmo `Range` com `If-Range: "v0"`, ou com `If-Range: W/"v1"`, ou com uma data diferente de `Last-Modified`
- **Então** a resposta é `200` com o asset completo

### RF-09 — Preservar 304, 404, fallthrough e 405

A introdução de ranges não pode alterar as respostas existentes. `304` por validadores de cache tem precedência sobre `Range`. Asset inexistente continua gerando `404` ou, com `fallthrough`, passando para o próximo handler. Métodos fora de `GET` e `HEAD` continuam gerando `405` com `Allow: GET, HEAD`.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-None-Match: "v1"`
- **Então** a resposta é `304` sem corpo
- **E dado** um caminho sem asset, **quando** o cliente faz `GET` com `Range`, **então** a resposta é `404`, ou o request segue adiante se `fallthrough` estiver ativo
- **E dado** um `POST` com `Range`, **quando** a requisição chega a `serveStatic`, **então** a resposta é `405` com `Allow: GET, HEAD`, ou o request segue adiante se `fallthrough` estiver ativo

### RF-10 — Ranges sobre a representação selecionada e cache

Quando há `encodings` configurados e uma variante pré-comprimida é escolhida, o `Range` se aplica à representação escolhida (bytes da variante, com `Content-Encoding` e `Content-Length` dela). O header `Vary: accept-encoding` continua presente.

**Critério de aceite**

- **Dado** `encodings: { gzip: ".gz" }` e um arquivo `app.js.gz` disponível
- **Quando** o cliente faz `GET /app.js` com `Accept-Encoding: gzip` e `Range: bytes=0-9`
- **Então** a resposta é `206`, com `Content-Encoding: gzip`, `Content-Length: 10`, `Content-Range` referente ao tamanho de `app.js.gz`, e `Vary: accept-encoding`

### RF-11 — Sem novas exportações públicas

A mudança não adiciona nenhum nome, valor ou tipo a `src/index.ts`. Os helpers de Range ficam privados no módulo `static.ts`. `ServeStaticOptions` e `StaticAssetMeta` não ganham opções novas.

**Critério de aceite**

- **Dado** o `src/index.ts` antes e depois da mudança
- **Quando** os dois são comparados
- **Então** não há exportação nova e as assinaturas de `ServeStaticOptions` e `StaticAssetMeta` são iguais

### RF-12 — Testes e qualidade

Os comportamentos novos devem ter testes de regressão escritos com `describeMatrix`, rodando em modo `web` e `node`. A suíte existente deve continuar passando, e testes existentes só podem ser ajustados quando dependem do comportamento alterado, sem perder o que verificam.

**Critério de aceite**

- **Dado** a branch com a mudança
- **Quando** rodam `pnpm vitest run test/static.test.ts` (ou o arquivo de testes de `serveStatic` existente), `pnpm lint` e `pnpm typecheck`
- **Então** todos passam nos modos `web` e `node`, e os testes novos cobrem RF-01 a RF-10

## Fora de escopo

- **Múltiplos intervalos** (`multipart/byteranges`): pedidos com mais de um intervalo são ignorados (RF-06), não atendidos.
- **Leitura parcial no backend**: não muda a assinatura de `getContents` para receber o intervalo. O fatiamento acontece dentro de `serveStatic`.
- **Ranges em outros handlers**: `proxy`, `h3/rules/cache` e `ocache` não são alterados.
- **Novas opções** em `ServeStaticOptions` ou `StaticAssetMeta`.
- **Cache de respostas parciais** e ETags por intervalo.
- **Compressão de respostas `206`**.
- **Mudanças de documentação pública** além dos comentários do próprio `serveStatic`.

## Premissas

- A norma de referência é a RFC 9110 (§13.1.5 e §14), que substitui a RFC 7233 citada na issue.
- `getMeta` informa `size` em bytes para o arquivo que será servido. Quando não informa, a regra de RF-07 se aplica.
- `getContents` devolve o corpo completo da representação escolhida (`BodyInit`), sem parâmetro de intervalo. A API atual não muda.
- O `Range` se aplica à representação escolhida, incluindo variantes pré-comprimidas (RF-10).
- Asset de tamanho `0` é tratado como tamanho conhecido: qualquer intervalo dá `416`. Hoje `serveStatic` não envia `Content-Length` quando `size` é `0`, e esse comportamento de `Content-Length` continua igual. **A confirmar.**
- O comportamento de `304` e de `If-Range` segue a ordem da RFC: validadores de cache são avaliados antes de `Range`.

## Riscos

- **Desempenho e memória em vídeo e arquivos grandes.** `getContents` devolve o corpo inteiro, então cada requisição `Range` pode ler o arquivo desde o início para chegar ao intervalo. Um `Blob` pode ser fatiado sem custo grande. Um `ReadableStream` precisa ser consumido e descartado até `a`, e um `string` ou `ArrayBuffer` pode precisar de cópia. Esse é o principal risco. A mitigação de longo prazo (ranges no backend) está fora de escopo.
- **Testes existentes com expectativa de `200`.** Testes que hoje afirmam `200` para requisições com `Range`, ou a ausência de `Accept-Ranges`, vão falhar. Eles devem ser revisados caso a caso (RF-12), não reescritos para passar.
- **Ranges sobre gzip.** Um cliente que espera bytes do original pode se confundir com `Range` sobre a variante comprimida. A RFC permite esse comportamento, e `Vary` ajuda caches intermediários. Vale documentar no código.
- **Comparação de `If-Range` errada.** Aceitar um validador fraco ou com comparação frouxa pode fazer um download retomado combinar partes de versões diferentes do arquivo. A comparação precisa ser forte.
- **Divergência entre runtimes.** Diferenças entre `web` e `node` no tratamento de `Blob`, `ReadableStream` e `Headers` podem aparecer só em um dos modos da matriz de testes.
