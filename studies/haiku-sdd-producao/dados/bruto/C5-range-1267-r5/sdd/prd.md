# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Todo pedido recebe o arquivo inteiro com `200 OK`, sem nenhum cabeçalho de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio, que os navegadores e players pedem por faixas de bytes;
- o comportamento esperado de CDNs e proxies diante de respostas parciais.

**Objetivo:** fazer `serveStatic` atender pedidos GET e HEAD com um único intervalo de bytes válido, conforme RFC 9110 (seções 13.1.5 e 14), sem mudar a API pública, o cache, a seleção de encoding, o `fallthrough` nem as respostas 404 e 405 que já existem.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Todo asset encontrado responde com `Accept-Ranges: bytes`, em GET e em HEAD, inclusive quando o próprio pedido não traz `Range`.

**Critério de aceite**

- **Dado** um asset existente com metadados válidos,
- **Quando** o cliente faz `GET /arquivo.bin` sem cabeçalho `Range`,
- **Então** a resposta é `200`, com o corpo completo e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder 206 para um intervalo válido

Um `Range: bytes=<início>-<fim>`, `bytes=<início>-` ou `bytes=-<sufixo>` válido, com tamanho conhecido, gera `206 Partial Content` com o trecho pedido. A resposta traz `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Quando o fim passa do tamanho do arquivo, ele é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=100-199`,
- **Então** a resposta é `206`, com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo tem exatamente os bytes 100 a 199.

### RF-03 — Intervalo de sufixo e intervalo aberto

Os formatos `bytes=<início>-` (do início até o fim) e `bytes=-<n>` (os últimos `n` bytes) são atendidos como intervalos válidos, e `n` maior que o tamanho do arquivo devolve o arquivo inteiro em `206`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=900-` e, em outro pedido, `Range: bytes=-50`,
- **Então** o primeiro devolve `206` com `Content-Range: bytes 900-999/1000` e 100 bytes, e o segundo devolve `206` com `Content-Range: bytes 950-999/1000` e 50 bytes.

### RF-04 — HEAD com intervalo

Um HEAD com `Range` válido responde como o GET de RF-02, mas sem corpo: `206` com `Content-Range` e `Content-Length` corretos.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-99`,
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-05 — Intervalo não satisfazível

Quando o intervalo começa depois do último byte, ou quando o arquivo tem tamanho zero, a resposta é `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=1000-1100`,
- **Então** a resposta é `416`, com `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-06 — Ignorar Range que não se aplica

O `Range` é ignorado, e a resposta é o `200` completo de hoje, nestes casos: cabeçalho malformado; unidade diferente de `bytes`; mais de um intervalo na mesma requisição (`bytes=0-1,5-6`); tamanho do asset desconhecido (`size` ausente em `getMeta`).

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,5-6`, ou `Range: items=0-1`, ou `Range: bytes=abc`,
- **Então** a resposta é `200`, com o corpo completo, sem `Content-Range`.

### RF-07 — Validador em If-Range

Quando o pedido traz `If-Range`, o intervalo só é atendido se o validador combinar com o recurso atual: um ETag forte igual ao `etag` de `getMeta`, ou uma data igual ao `last-modified` enviado. Se não combinar, o `Range` é ignorado e a resposta é `200` completa. ETag fraco nunca combina em `If-Range`.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"` e `Range: bytes=0-99`,
- **Quando** o cliente envia `If-Range: "xyz"`,
- **Então** a resposta é `200` completa, sem `Content-Range`.
- **E quando** o cliente envia `If-Range: "abc"`, **então** a resposta é `206` com `bytes 0-99/<tamanho>`.

### RF-08 — Precedência das condicionais

Quando a validação de cache (`If-None-Match` ou `If-Modified-Since`) resulta em `304`, a resposta é `304` e o `Range` é ignorado. A verificação de cache continua acontecendo antes da análise do `Range`.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"`,
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-99`,
- **Então** a resposta é `304`, sem corpo, como hoje.

### RF-09 — Preservar o comportamento existente

Com `Range` ausente, a resposta é igual à de hoje, byte a byte nos cabeçalhos. Isso vale para cache (`etag`, `last-modified`, `304`), seleção de encoding (`Content-Encoding` e `Vary: accept-encoding`), `options.headers`, `fallthrough`, `404` para asset inexistente e `405` para método não permitido.

**Critério de aceite**

- **Dado** a suíte de testes existente,
- **Quando** ela roda após a mudança,
- **Então** todos os testes passam, e só os testes que dependem do comportamento alterado (com `Range` ou com a presença de `Accept-Ranges`) podem ser ajustados, sem perder o que verificam.

### RF-10 — Sem nova API pública

A mudança não cria exportação em `src/index.ts`, nem nome de valor ou de tipo, e não adiciona opção em `ServeStaticOptions`. As funções auxiliares ficam privadas em `src/utils/static.ts`.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara `src/index.ts` e os tipos exportados de `static.ts` com a versão anterior,
- **Então** não há nomes novos exportados, e `pnpm lint` e `pnpm typecheck` passam.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` completo (RF-06).
- Cabeçalhos `If-Match` e `If-Unmodified-Since` (RFC 9110, seção 13.1.1 e 13.1.4), inclusive respostas `412`.
- Nova opção em `ServeStaticOptions` ou mudança no contrato de `getContents` para leitura parcial no backend.
- Range em outros utilitários (`proxy`, `sendStream`, respostas de `rules`) ou em respostas sem tamanho conhecido.
- Configuração de cache, CDN ou compressão sob demanda.
- Validação de `If-Match` em ETags fracos além do que RF-07 descreve.

## Premissas e riscos

### Premissas

- `getMeta` devolve `size` correto, e ele corresponde à representação servida (a variante com `Content-Encoding`, quando houver). Se não corresponder, `Content-Range` fica errado.
- Os valores de `etag` e `mtime` vêm no formato que o backend já usa. A comparação do `If-Range` usa o valor como ele está, então o backend deve entregar ETag forte quando quiser que ele combine.
- `getContents` devolve um `BodyInit` que pode ser fatiado (string, `Blob`, `ArrayBuffer`, `ReadableStream` ou equivalente). A escolha de como fatiar cada tipo é decisão de implementação.
- O `size` ausente em `getMeta` é tratado como desconhecido. `size` igual a `0` é tamanho conhecido de zero bytes, então qualquer `Range` nele resulta em `416`.

### Riscos

- **Leitura completa do arquivo (alto).** Como `getContents` não recebe intervalo, um `206` pode exigir ler e descartar bytes antes do trecho pedido. Em vídeos grandes, isso gasta CPU, memória e largura de banda do backend a cada seek. A mitigação é documentar o custo e deixar a leitura parcial no backend para uma mudança futura (fora de escopo).
- **Conflito com `Content-Length` (médio).** O código atual só define `Content-Length` se o chamador ainda não tiver definido. Um `options.headers` com `content-length` faria o `206` enviar um tamanho errado. A implementação precisa decidir a precedência e testar esse caso.
- **Corpo nulo com `size` conhecido (médio).** Se `getContents` devolver `null` para um asset com `size` válido, o `206` terá `Content-Length` sem corpo. Essa combinação já existe no `200` atual, mas fica mais visível com ranges.
- **Ambiguidade de `size: 0` (baixo a médio).** Um backend que devolve `size: 0` como valor padrão faria todo `Range` virar `416`. A premissa acima assume que `0` é tamanho real; o backend precisa seguir essa convenção.
- **Regressão em testes existentes (médio).** Testes que verificam cabeçalhos exatos podem quebrar com `Accept-Ranges`. A regra de RF-09 limita o ajuste a esses casos.
- **Encoding e Range (baixo).** A faixa é aplicada à representação codificada (gzip ou br). Clientes que pedem trechos de arquivos comprimidos recebem bytes comprimidos, como determina a RFC 9110. Isso deve ficar documentado.
