# PRD: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um cliente que pede um intervalo de bytes recebe sempre o corpo completo, com status 200 e sem os cabeçalhos de conteúdo parcial. Com isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek), porque o navegador depende de respostas 206;
- proxies e CDNs não recebem a sinalização de representação parcial que o HTTP prevê.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, quando o tamanho do asset é conhecido, seguindo a RFC 9110 (seções 13.1.5 If-Range e 14 Range Requests). A mudança é retrocompatível: não adiciona exportações públicas, não altera o comportamento de cache, seleção de encoding, `fallthrough`, 404 nem 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

O `serveStatic` informa que aceita intervalos de bytes em todas as respostas de um asset encontrado.

**Dado** um `GET` ou `HEAD` para um asset que existe (`getMeta` devolveu metadados),
**Quando** a resposta é gerada com status 200, 206, 304 ou 416,
**Então** a resposta contém o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Intervalo válido retorna 206

Um intervalo de byte único dentro do tamanho do asset produz uma resposta parcial.

**Dado** um asset com `size` conhecido de 1000 bytes e o cabeçalho `Range: bytes=0-499`,
**Quando** o cliente faz `GET` no asset,
**Então** a resposta tem status 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e o corpo contém exatamente os bytes 0 a 499 do asset.

### RF-03 — Intervalos abertos e sufixos

Os formatos `bytes=a-` e `bytes=-n` também são aceitos, com a limitação de tamanho prevista na RFC 9110.

**Dado** um asset de 1000 bytes,
**Quando** o cliente envia `Range: bytes=900-` ,
**Então** a resposta tem status 206, `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.

**Dado** o mesmo asset,
**Quando** o cliente envia `Range: bytes=-200`,
**Então** a resposta tem status 206, `Content-Range: bytes 800-999/1000` e `Content-Length: 200`.

**Dado** o mesmo asset,
**Quando** o cliente envia `Range: bytes=0-5000`,
**Então** o último byte é limitado ao fim do asset: `Content-Range: bytes 0-999/1000` e status 206.

### RF-04 — HEAD com Range

Para `HEAD`, a resposta parcial traz apenas cabeçalhos.

**Dado** um asset de 1000 bytes,
**Quando** o cliente envia `HEAD` com `Range: bytes=0-499`,
**Então** a resposta tem status 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500`, corpo vazio, e `getContents` não é chamado.

### RF-05 — Intervalo não satisfazível retorna 416

Um intervalo que não cobre nenhum byte do asset recebe 416.

**Dado** um asset de 1000 bytes,
**Quando** o cliente envia `Range: bytes=1000-1200`,
**Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

**Dado** um asset de tamanho 0 bytes,
**Quando** o cliente envia qualquer `Range` válido em forma,
**Então** a resposta tem status 416 com `Content-Range: bytes */0`.

### RF-06 — Entradas que o servidor ignora

Quando o `Range` não pode ou não deve ser atendido, o `serveStatic` ignora o cabeçalho e responde com 200 e o corpo completo, como hoje.

**Dado** um asset existente,
**Quando** o cliente envia um `Range` malformado (por exemplo `bytes=abc`), uma unidade que não é `bytes` (por exemplo `items=0-4`), ou mais de um intervalo (`bytes=0-1,5-9`),
**Então** a resposta tem status 200, sem `Content-Range`, com o corpo completo.

**Dado** um asset cujo `getMeta` não devolve `size`,
**Quando** o cliente envia um `Range` válido,
**Então** a resposta tem status 200 com o corpo completo.

### RF-07 — If-Range

O cabeçalho `If-Range` decide se o `Range` vale para o estado atual do asset (RFC 9110 seção 13.1.5).

**Dado** um asset com ETag forte `"abc"` e a requisição `Range: bytes=0-499` com `If-Range: "abc"`,
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 206.

**Dado** o mesmo asset e `If-Range: "xyz"` (ETag diferente),
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 200 com o corpo completo.

**Dado** um asset com ETag fraco `W/"abc"` e `If-Range: W/"abc"`,
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 200, porque a comparação de If-Range exige ETag forte.

**Dado** um asset com `last-modified` igual a uma data HTTP `D` e `If-Range: D`,
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 206; se a data for diferente, a resposta tem status 200.

### RF-08 — Pré-condições têm precedência sobre Range

Validação de cache acontece antes do tratamento de `Range`.

**Dado** um asset com ETag `"abc"` e a requisição com `If-None-Match: "abc"` e `Range: bytes=0-499`,
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 304 sem corpo, e não 206.

### RF-09 — Encoding e cabeçalhos existentes

O `Range` se aplica à representação selecionada pelo `serveStatic`, incluindo a variante pré-comprimida.

**Dado** um asset com a variante `.gz` configurada em `encodings`, o cliente com `Accept-Encoding: gzip` e `Range: bytes=0-99`,
**Quando** o cliente faz `GET`,
**Então** a resposta tem status 206, `Content-Encoding: gzip`, `Vary` contendo `accept-encoding`, e `Content-Range` e `Content-Length` referem-se aos bytes do arquivo `.gz`.

**Dado** um asset inexistente e a opção `fallthrough: true`,
**Quando** o cliente envia `GET` com `Range`,
**Então** `serveStatic` retorna `undefined` e nenhum cabeçalho de Range é definido na resposta.

**Dado** um asset inexistente sem `fallthrough`,
**Quando** o cliente envia `GET` com `Range`,
**Então** a resposta é 404, como hoje.

**Dado** um método diferente de GET e HEAD (por exemplo `POST`) com `Range`,
**Quando** a requisição chega ao `serveStatic`,
**Então** a resposta é 405 com `Allow: GET, HEAD`, como hoje.

### RF-10 — Sem exportações públicas novas

**Dado** o código após a mudança,
**Quando** se compara `src/index.ts` e os tipos exportados com a versão anterior,
**Então** nenhum nome (valor ou tipo) foi adicionado, e as funções auxiliares de Range estão apenas no módulo `src/utils/static.ts` ou em `src/utils/internal/`, sem reexportação.

### RF-11 — Testes nos dois alvos

**Dado** a suíte de testes do projeto,
**Quando** `pnpm vitest run test/static.test.ts` é executado,
**Então** os novos casos rodam nos alvos `web` e `node` via `describeMatrix`, cobrem RF-02 a RF-09, e os testes existentes passam sem perder o que verificavam.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): pedidos com mais de um intervalo recebem 200 completo.
- Range em `POST`, `PUT` ou outros métodos.
- Cache de partes ou pré-geração de fatias.
- Compressão ou recompressão sob demanda para atender Range.
- Alteração das assinaturas de `getMeta` e `getContents` ou novas opções em `ServeStaticOptions`, salvo decisão explícita (ver premissa P2).
- Range em outros pontos da API (`proxyRequest`, `sendStream`, `serveStatic` do Node fora do módulo).
- Seek eficiente em `ReadableStream` retornado por `getContents` (ver risco R1).
- Mudanças em `src/_deprecated.ts` ou em código de compatibilidade com v1.

## Premissas

- **P1.** `getMeta` devolve `size` para assets de tamanho conhecido. Assets sem `size` continuam servidos com 200 completo.
- **P2.** `getContents` devolve um `BodyInit` opaco. O `serveStatic` não tem como pedir uma fatia ao backend sem uma mudança de API. Proposta: quando o corpo for `Blob` ou `File`, fatiar com `slice()` sem ler o arquivo inteiro; para os demais tipos, consumir o corpo e fatiar em memória. Essa escolha deve ser confirmada antes da implementação, porque uma alternativa (passar o intervalo para `getContents`) muda a API pública.
- **P3.** O `Range` se aplica aos bytes da representação escolhida, incluindo variantes pré-comprimidas, como prevê a RFC 9110.
- **P4.** `Accept-Ranges: bytes` é anunciado somente em respostas de asset encontrado. Respostas 404, 405 e as de fallthrough não recebem o cabeçalho.
- **P5.** A RFC 9110 é a norma de referência. A issue cita a RFC 7233, que foi substituída por ela.
- **P6.** Nenhuma dependência nova é adicionada. A implementação usa apenas APIs web padrão (`Blob`, `Headers`, `Response`), para funcionar em Node, Bun, Deno, Cloudflare Workers e navegadores.
- **P7.** O tamanho conhecido é um número finito maior ou igual a zero. Um asset de tamanho 0 com `Range` recebe 416 (RF-05).

## Riscos

- **R1 — Memória com `ReadableStream`.** Se `getContents` devolve um stream, a fatia exige ler e descartar os bytes iniciais. Para vídeos grandes isso degrada o seek. Mitigação: documentar o custo e recomendar `Blob` ou `File` nos backends de disco.
- **R2 — Cabeçalhos já definidos.** `content-length` pode já estar em `event.res.headers` (por `options.headers` ou por um middleware) e conflitar com o tamanho da fatia. A implementação deve sobrescrever `content-length` e `content-range` nas respostas 206 e 416.
- **R3 — Mudança de comportamento em tamanho 0.** Um asset de 0 bytes com `Range` passa de 200 para 416. É coerente com a RFC, mas é uma mudança observável.
- **R4 — Testes existentes.** Algum teste atual pode enviar `Range` esperando 200. Só esses testes podem ser ajustados, e o que eles verificam deve ser preservado.
- **R5 — If-Range com datas.** A comparação de data exige precisão de segundos, já usada no `last-modified` do módulo. Diferenças de precisão podem causar 200 onde se esperaria 206.
- **R6 — Cabeçalhos de cache em 206.** Caches intermediários podem tratar respostas parciais de forma diferente. A implementação mantém `etag` e `last-modified` nas respostas 206.

## Perguntas em aberto

1. Confirmar a abordagem de P2 (fatiar `Blob` e bufferizar os demais, ou mudar a API de `getContents`).
2. Confirmar se o tratamento de `size: 0` como 416 (P7) é aceitável, dada a mudança observável em R3.
