# PRD: HTTP Range em `serveStatic` (h3js/h3#1267)

## Problema e objetivo

`serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um cliente que pede parte de um arquivo recebe sempre o corpo completo com `200 OK`, sem `Accept-Ranges`, sem `Content-Range` e sem `206 Partial Content`. Na prática:

- downloads interrompidos não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) em arquivos servidos pelo h3;
- proxies e CDNs não recebem os sinais HTTP que esperam de um servidor de arquivos estáticos.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, conforme a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, sem mudar o comportamento atual quando não há `Range` e sem quebrar cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range nas respostas de assets

Quando `serveStatic` serve um asset cujo tamanho é conhecido (`size` de `getMeta`), a resposta de `GET` ou `HEAD` inclui `Accept-Ranges: bytes`.

- **Dado** um asset existente com `getMeta` retornando `size: 10`,
- **Quando** o cliente faz `GET /file.txt` sem cabeçalho `Range`,
- **Então** a resposta é `200`, traz `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder 206 a um intervalo válido em GET

Para um único intervalo satisfazível em `GET`, a resposta é `206 Partial Content` com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes do intervalo. O corpo contém exatamente esses bytes.

- **Dado** um asset de 10 bytes com conteúdo `0123456789`,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** a resposta é `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo `2345`.

### RF-03 — Suportar intervalos abertos e sufixos

Os formatos `bytes=N-` (do byte N até o fim) e `bytes=-N` (os últimos N bytes) são tratados como intervalos válidos. Um fim maior que o tamanho é limitado ao último byte. Um sufixo maior que o tamanho cobre o asset inteiro.

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=7-`,
- **Então** a resposta é `206`, `Content-Range: bytes 7-9/10`, `Content-Length: 3`.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=-100`,
- **Então** a resposta é `206`, `Content-Range: bytes 0-9/10`, `Content-Length: 10`.

### RF-04 — Responder 206 a HEAD com Range válido

Em `HEAD`, um intervalo válido gera a mesma resposta de RF-02 (status, `Content-Range`, `Content-Length` do trecho), sem corpo.

- **Dado** um asset de 10 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio.

### RF-05 — Responder 416 a intervalo não satisfazível

Quando o cabeçalho `Range` é sintaticamente válido, mas nenhum intervalo pode ser atendido, a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`. Vale para `GET` e `HEAD`.

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=10-20`,
- **Então** a resposta é `416`, `Content-Range: bytes */10`, `Content-Length: 0`.

- **Dado** um asset de 0 bytes,
- **Quando** o cliente envia `Range: bytes=0-`,
- **Então** a resposta é `416`, `Content-Range: bytes */0`.

### RF-06 — Ignorar Range que não se aplica

O servidor responde `200` com o corpo completo, como hoje, quando o cabeçalho `Range`:

- usa unidade diferente de `bytes`;
- é malformado (por exemplo, `bytes=abc`, `bytes=5-2`, `bytes=`);
- pede mais de um intervalo (`bytes=0-1,4-5`). Multi-range não é suportado.

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,4-5`,
- **Então** a resposta é `200`, sem `Content-Range`, com o corpo completo.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: items=0-1`,
- **Então** a resposta é `200` com o corpo completo.

### RF-07 — Avaliar If-Range

Quando o cliente envia `If-Range`, o intervalo só é atendido se o validador bater (RFC 9110 13.1.5), usando comparação forte: um ETag fraco nunca bate, e uma data `If-Range` bate só se for exatamente igual ao `Last-Modified` do asset. Se não bater, a resposta é `200` com o corpo completo.

- **Dado** um asset com ETag `"abc"`,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`,
- **Então** a resposta é `206` com os 4 primeiros bytes.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "outro"`,
- **Então** a resposta é `200` com o corpo completo.

### RF-08 — Manter a precedência de pré-condições

As pré-condições de cache continuam avaliadas antes do `Range`. Se `If-None-Match` ou `If-Modified-Since` resultam em `304`, a resposta é `304` e o `Range` é ignorado.

- **Dado** um asset com ETag `"abc"`,
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-3`,
- **Então** a resposta é `304 Not Modified`, sem corpo.

### RF-09 — Preservar o comportamento sem Range

Quando não há cabeçalho `Range`, as respostas de `serveStatic` são idênticas às de hoje, exceto pelo cabeçalho `Accept-Ranges` de RF-01. Isso inclui `Content-Length`, `Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary`, o uso de `fallthrough`, o `404` para asset inexistente e o `405` (com `Allow: GET, HEAD`) para outros métodos.

- **Dado** um asset existente e `fallthrough: true`,
- **Quando** o cliente faz `POST`,
- **Então** a função retorna `undefined`, como hoje, e não define `Accept-Ranges`.

### RF-10 — Range sobre a representação codificada

Quando `serveStatic` escolhe uma variante pré-comprimida (por exemplo `.gz` via `encodings`), o intervalo se aplica aos bytes dessa variante, com `Content-Length` e `Content-Range` baseados no tamanho dela. `Content-Encoding` é mantido.

- **Dado** `encodings: { gzip: ".gz" }`, um asset `app.js.gz` de 20 bytes e `Accept-Encoding: gzip`,
- **Quando** o cliente envia `Range: bytes=0-4`,
- **Então** a resposta é `206`, `Content-Range: bytes 0-4/20`, `Content-Encoding: gzip` e os 5 primeiros bytes de `app.js.gz`.

### RF-11 — Recortar o corpo para qualquer tipo de BodyInit

O corpo parcial é obtido do conteúdo retornado por `getContents`, sem alterar sua assinatura. Para cada tipo suportado (`string`, `ArrayBuffer`, `ArrayBufferView`, `Blob` e `ReadableStream`), o trecho entregue tem exatamente os bytes do intervalo. Strings são contadas em bytes UTF-8, não em caracteres.

- **Dado** `getContents` retornando `"héllo"` (6 bytes em UTF-8),
- **Quando** o cliente envia `Range: bytes=1-2`,
- **Então** o corpo tem exatamente os bytes 1 e 2 da codificação UTF-8 e `Content-Length: 2`.

- **Dado** `getContents` retornando um `ReadableStream` de 10 bytes,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** o corpo tem 4 bytes (`2345`), e os bytes anteriores ao intervalo não são entregues ao cliente.

### RF-12 — Não usar Range sem tamanho conhecido

Quando `getMeta` não informa `size` (ou informa `0` ou valor inválido), `serveStatic` ignora o cabeçalho `Range` e responde `200` com o corpo completo. Nesse caso, `Accept-Ranges` não é anunciado.

- **Dado** um asset cujo `getMeta` não retorna `size`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `200`, sem `Accept-Ranges` e sem `Content-Range`, com o corpo completo.

### RF-13 — Funcionar em todos os runtimes

O comportamento de RF-01 a RF-12 é coberto por testes em `test/static.test.ts` (ou arquivo equivalente) usando `describeMatrix`, rodando em `web` e `node`. Em `node`, o `Content-Length` declarado coincide com os bytes enviados.

- **Dado** a suíte `describeMatrix` de `serveStatic`,
- **Quando** `pnpm vitest run test/static.test.ts` é executado,
- **Então** os casos de Range passam nos alvos `web` e `node`.

### RF-14 — Preservar a API pública

A mudança não adiciona opções em `ServeStaticOptions`, não adiciona exportações em `src/index.ts` (nomes, valores ou tipos) e mantém os helpers privados ao módulo `static.ts` (ou a `src/utils/internal/`, sem exportação pública).

- **Dado** o código após a mudança,
- **Quando** se compara `src/index.ts` e as exportações de `src/utils/static.ts` com a versão atual,
- **Então** não há nomes novos exportados e `ServeStaticOptions` tem os mesmos campos.

### RF-15 — Manter a qualidade do projeto

Os testes existentes continuam passando. Só são ajustados os testes que dependem de um comportamento que a mudança altera, mantendo o que eles verificam. `pnpm lint` e `pnpm typecheck` passam.

- **Dado** a branch com a mudança,
- **Quando** se executam `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`,
- **Então** os três terminam sem falhas.

## Fora de escopo

- Respostas `multipart/byteranges` (vários intervalos em uma resposta). Pedidos com multi-range recebem `200` completo (RF-06).
- Novas opções em `ServeStaticOptions` ou mudança na assinatura de `getMeta`/`getContents` (por exemplo, para passar o intervalo ao backend). Isso fica para um PRD futuro, se o recorte no h3 se mostrar caro demais.
- Range em `serveStatic` com `fallthrough` para outros métodos além de `GET`/`HEAD`.
- Ranges em respostas de rotas que não usam `serveStatic` (`serveStatic` é o único ponto desta mudança).
- Cache específico de respostas parciais, validadores por intervalo e `Cache-Control` novos.
- Compressão dinâmica de respostas parciais.
- Documentação do site (fora deste repositório, se houver).
- Alterações em `src/index.ts`, `package.json` ou dependências.

## Premissas e riscos

**Premissas**

- `getContents` retorna o conteúdo completo do asset, pois sua assinatura não recebe intervalo. O recorte é feito no lado do h3 (RF-11).
- O `size` de `getMeta` corresponde exatamente aos bytes que `getContents` entrega. Se não corresponder, o `Content-Length` declarado não bate com o corpo.
- A RFC 9110 substitui a RFC 7233 citada na issue, como indica o contrato em `sdd/pedido.md`.
- `Accept-Ranges` só é anunciado quando o tamanho é conhecido (RF-12). Isso se desvia do "sempre" da issue, porque anunciar suporte que não pode ser atendido seria enganoso. Esta é uma decisão a confirmar.
- Ranges se aplicam ao `GET` e ao `HEAD`. Para os demais métodos, o comportamento de `405` não muda.

**Riscos**

- **Desempenho com streams grandes:** para `ReadableStream`, o recorte precisa ler e descartar os bytes antes do início do intervalo. Em arquivos grandes, isso custa I/O e memória. Para `Blob`, usar `slice` evita a leitura completa. Mitigação: testar os dois casos e documentar o custo.
- **Divergência entre `size` e o conteúdo:** pode causar `Content-Length` errado, o que em Node faz a conexão ser encerrada com erro. Mitigação: validar que o trecho entregue tem o tamanho declarado; se não tiver, decidir entre erro e fallback (a decidir na implementação).
- **`getContents` retornando `null` para um intervalo:** o contrato atual permite corpo vazio. Com `206` isso seria inconsistente. Decisão a tomar: tratar como o caso atual (corpo `null`) ou como erro interno.
- **Strings e codificação:** contar bytes UTF-8 em vez de caracteres é necessário para não cortar caracteres multibyte no meio (RF-11). Quem fornecer strings de outro encoding fica fora da garantia.
- **Testes existentes:** `test/static.test.ts` não foi lido nesta fase. Pode haver asserções sobre cabeçalhos exatos que mudam com `Accept-Ranges`. Isso precisa ser verificado na implementação, e a mudança nos testes deve ser mínima (RF-15).
- **Precedência de cabeçalhos:** `If-Range` sem `Range` deve ser ignorado. Qualquer erro aqui gera `206` indevido.
