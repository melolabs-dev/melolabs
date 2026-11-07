# PRD: Suporte a HTTP Range em `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

Hoje `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um cliente que pede um trecho do arquivo recebe sempre o corpo inteiro com `200 OK`, sem `Accept-Ranges`, `Content-Range` ou `206 Partial Content`. Com isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) em arquivos servidos pelo h3;
- CDNs e proxies não conseguem cachear ou repassar trechos de forma correta.

**Objetivo:** fazer `serveStatic` atender pedidos `Range` para `GET` e `HEAD` de forma compatível com a RFC 9110 (seções 14 e 13.1.5, que substituem a RFC 7233 citada na issue), mantendo intactos o cache, a seleção de encoding, o `fallthrough` e as respostas 404 e 405. A mudança fica dentro de `serveStatic`, sem novas exportações públicas.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de asset servido (200, 206 e 416), para GET e HEAD. Respostas 404 e 405 não recebem o cabeçalho.

**Critério de aceite**
- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta tem status 200 e o cabeçalho `Accept-Ranges: bytes`

### RF-02 — Responder 206 para um intervalo válido

Para um cabeçalho `Range: bytes=<início>-<fim>` válido e satisfazível, a resposta deve ter status `206 Partial Content`, `Content-Range: bytes <início>-<fim>/<tamanho>`, `Content-Length` igual ao número de bytes enviados e corpo contendo exatamente esses bytes do asset. O tamanho vem de `size` retornado por `getMeta`.

**Critério de aceite**
- **Dado** um asset de 1000 bytes cujo `getMeta` retorna `size: 1000`
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta tem status 206, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo são os bytes 100 a 199 do asset

### RF-03 — Intervalos abertos, sufixos e limites ajustados

`serveStatic` deve aceitar as três formas de intervalo único da RFC 9110:

- `bytes=<início>-` (do início até o fim do arquivo);
- `bytes=-<n>` (os últimos `n` bytes; se `n` for maior que o tamanho, o arquivo inteiro);
- `bytes=<início>-<fim>` com `<fim>` maior ou igual ao tamanho, que é ajustado para `tamanho - 1`.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=900-` , `Range: bytes=-50` ou `Range: bytes=950-5000`
- **Então** as respostas são 206 com `Content-Range` `bytes 900-999/1000`, `bytes 950-999/1000` e `bytes 950-999/1000`, respectivamente, e os corpos correspondentes

### RF-04 — Responder 416 para intervalo não satisfazível

Quando o intervalo válido não tem nenhum byte dentro do asset (início maior ou igual ao tamanho, ou sufixo de zero bytes), a resposta deve ter status `416 Range Not Satisfiable`, `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e corpo vazio.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1010` ou `Range: bytes=-0`
- **Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-05 — Ignorar Range que não se aplica

`serveStatic` deve ignorar o cabeçalho `Range` e responder 200 com o corpo completo quando:

- o cabeçalho está malformado (sintaxe inválida);
- a unidade não é `bytes`;
- há mais de um intervalo (multi-range);
- o tamanho do asset é desconhecido ou zero.

Ignorar não é erro: nenhuma dessas situações produz 416 ou 400.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: items=0-5`, `Range: bytes=abc`, ou `Range: bytes=0-1,5-9`
- **Então** a resposta tem status 200, o corpo completo e `Content-Length: 1000`, sem `Content-Range`

### RF-06 — HEAD com Range

Para `HEAD`, a resposta com Range válido deve ter o mesmo status (206 ou 416) e os mesmos cabeçalhos que o `GET` teria, sem corpo.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=100-199`
- **Então** a resposta tem status 206, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo vazio

### RF-07 — If-Range

Se o cliente enviar `If-Range`, o `Range` só é aplicado quando o validador bater com o asset atual:

- com ETag: só ETag forte é aceito e deve ser igual ao ETag do asset (ETag fraco nunca bate);
- com data: deve ser exatamente igual ao `Last-Modified` do asset.

Quando não bater, o `Range` é ignorado e a resposta é 200 completa.

**Critério de aceite**
- **Dado** um asset com ETag `"abc"` e um `Range: bytes=0-9`
- **Quando** o cliente envia `If-Range: "abc"`
- **Então** a resposta é 206 com os bytes 0 a 9
- **Quando** o cliente envia `If-Range: "xyz"` ou `If-Range: W/"abc"`
- **Então** a resposta é 200 com o corpo completo

### RF-08 — Precedência sobre cache, 404, 405 e fallthrough

A lógica de Range entra depois das verificações existentes e não altera o seu resultado:

- a resposta 304 (`If-None-Match` / `If-Modified-Since`) continua tendo prioridade sobre Range;
- 404 para asset inexistente, 404 para caminho não canônico, 405 para método não permitido e `fallthrough` continuam como hoje;
- cabeçalhos já existentes (`ETag`, `Last-Modified`, `Vary`, `Content-Type`) não mudam.

**Critério de aceite**
- **Dado** um asset cujo ETag é `"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-None-Match: "abc"`
- **Então** a resposta é 304 sem corpo
- **Dado** um pedido `POST` com `Range` em uma rota de `serveStatic`
- **Quando** a requisição é processada
- **Então** a resposta é 405 com `Allow: GET, HEAD`, como hoje

### RF-09 — Compatibilidade com encoding pré-comprimido

Quando `serveStatic` serve uma variante pré-comprimida (com `Content-Encoding` definido), o `Range` é ignorado e a resposta é 200 completa com a variante. A seleção de encoding e o cabeçalho `Vary: accept-encoding` continuam como hoje.

**Critério de aceite**
- **Dado** um asset com variante `.gz` e um pedido com `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta é 200 com `Content-Encoding: gzip`, `Vary: accept-encoding` e o corpo completo da variante

### RF-10 — Sem novas exportações públicas

A mudança não adiciona nenhum nome (valor ou tipo) a `src/index.ts` nem a outro ponto público. As funções auxiliares ficam privadas em `src/utils/static.ts`.

**Critério de aceite**
- **Dado** o módulo público antes e depois da mudança
- **Quando** se compara a lista de exportações de `src/index.ts` e dos entries em `src/_entries/`
- **Então** as listas são idênticas

### RF-11 — Cobertura de testes

Os testes novos ficam em `test/static.test.ts` (ou arquivo vizinho) usando `describeMatrix`, para rodar em `web` e `node`. Cobrem os casos de RF-02 a RF-09. Os testes existentes só são ajustados se dependerem do comportamento alterado, sem perder o que verificam.

**Critério de aceite**
- **Dado** a suíte após a mudança
- **Quando** se executa `pnpm vitest run test/static.test.ts`
- **Então** todos os casos passam nos dois alvos (`web` e `node`), e `pnpm lint` e `pnpm typecheck` passam

## Fora de escopo

- Respostas `multipart/byteranges` (múltiplos intervalos). Esses pedidos recebem 200 completo (RF-05).
- Outras unidades de Range além de `bytes`.
- Suporte a Range em handlers dinâmicos, em `proxy` ou em `h3/rules/cache`.
- Mudar a assinatura de `getContents` ou `getMeta` para receber offset e tamanho. Isso seria mudança de API pública, e a issue pede explicitamente nenhuma.
- Nova opção em `ServeStaticOptions` para ligar ou desligar Range.
- Compressão sob demanda de respostas parciais.
- Otimização de leitura parcial de arquivos em disco. Fica a cargo de quem implementa `getContents`.
- Alterações em cache, seleção de encoding, `fallthrough` ou nas respostas 404 e 405, além do necessário para RF-08.

## Premissas e riscos

### Premissas

- `getContents(id)` devolve o conteúdo completo do asset. `serveStatic` é quem fatia o trecho pedido, pois a API atual não recebe offset.
- O `size` devolvido por `getMeta` é o tamanho real do conteúdo servido por `getContents`. Se `size` estiver errado, `Content-Range` e o corpo ficam errados.
- Tipos de `BodyInit` que `serveStatic` já aceita (string, `Blob`, `ArrayBuffer`, typed arrays, `ReadableStream`) precisam ser fatiados de forma uniforme. Ver risco abaixo.
- Ignorar Range em variantes pré-comprimidas (RF-09) é permitido pela RFC 9110, que deixa o servidor livre para ignorar o cabeçalho. É uma escolha deliberada para evitar trechos de conteúdo comprimido que o cliente não consegue descomprimir isoladamente.
- Quando o chamador já define `Content-Length` em `options.headers`, o comportamento atual (não sobrescrever) só se mantém para 200. Para 206 e 416 o `Content-Length` correto precisa prevalecer.

### Riscos

- **Fatiar `ReadableStream` custa caro:** sem offset na API, é preciso ler e descartar os bytes antes do início pedido. Para arquivos grandes e intervalos no fim, isso pode anular o ganho. Mitigação: documentar o custo e deixar a otimização a cargo de `getContents` (fora de escopo).
- **Strings são fatiadas por caractere, não por byte:** é preciso codificar em UTF-8 antes de fatiar, senão `Content-Range` e `Content-Length` ficam errados para conteúdo não ASCII.
- **Inconsistência entre `size` e conteúdo:** se `getMeta` e `getContents` retornarem tamanhos diferentes, o cliente recebe um trecho inválido. Mitigação: documentar a exigência nas opções.
- **Interação com cache e CDN:** respostas 206 têm `ETag` e `Last-Modified` iguais às de 200. Um cache que não entenda `Range` pode servir partes erradas. Isso precisa ser coberto pelo `Vary` ou por documentação, sem mudar o cache atual.
- **Escopo crescendo:** a tentação de implementar multi-range ou otimizações de disco. Mitigação: manter o "Fora de escopo".
- **Divergência entre runtimes:** `Blob.slice`, `ReadableStream` e o tratamento de `Content-Length` podem se comportar de forma diferente em Node, Bun, Deno e Workers. Mitigação: a matriz de testes (RF-11).
- **Testes existentes:** a suíte atual pode ter casos que assumem 200 para pedidos com `Range`. Se houver, eles são ajustados apenas no que depende da mudança.
