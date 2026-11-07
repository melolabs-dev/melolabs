# PRD: HTTP Range em `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando um cliente pede um intervalo de bytes, o h3 responde sempre com o corpo completo, sem `206 Partial Content` e sem os cabeçalhos de intervalo. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio servidos pelo h3, já que players de navegador dependem de intervalos;
- comportamento correto de CDNs e proxies, que esperam `Accept-Ranges` e `206`.

**Objetivo:** fazer `serveStatic` atender requisições de intervalo de byte único para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, o cache, a seleção de encoding, o `fallthrough` nem as respostas 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` passa a enviar `Accept-Ranges: bytes` em todas as respostas de asset que ele produz (200, 206, 304 e 416).

**Critério de aceite**
- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` sem cabeçalho `Range`
- **Então** a resposta 200 contém `Accept-Ranges: bytes`.

### RF-02 — Responder 206 a um intervalo válido

Para um `GET` com um único intervalo válido e tamanho do asset conhecido, a resposta é `206 Partial Content` com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes do trecho. São aceitas as três formas de intervalo único: `bytes=a-b`, `bytes=a-` e `bytes=-n` (sufixo).

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000` e `Content-Length: 100`.

### RF-03 — Corpo do 206 contém somente o trecho pedido

No `GET` com intervalo válido, o corpo da resposta 206 contém exatamente os bytes do intervalo, nem mais nem menos.

**Critério de aceite**
- **Dado** um asset cujo conteúdo é `0123456789`
- **Quando** o cliente faz `GET` com `Range: bytes=2-4`
- **Então** o corpo da resposta é `234` e o status é 206.

### RF-04 — HEAD com intervalo válido devolve só cabeçalhos

Para `HEAD` com intervalo válido, a resposta é 206 com os mesmos cabeçalhos do RF-02 e sem corpo. `getContents` não é chamado.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-05 — Intervalo não satisfazível devolve 416

Se o intervalo é sintaticamente válido mas não cabe no asset, a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=5000-6000`
- **Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-06 — Ignorar Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` for malformado, usar outra unidade que não `bytes` ou pedir mais de um intervalo, `serveStatic` ignora o cabeçalho e responde 200 com o corpo completo.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-10,20-30`
- **Então** a resposta tem status 200, `Content-Length: 1000` e o corpo completo.

### RF-07 — Ignorar Range quando o tamanho é desconhecido

Se `getMeta` não devolver `size` (ou devolver `undefined`), `serveStatic` ignora `Range` e responde 200 com o corpo completo, sem `Content-Range`.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não informa `size`
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status 200, o corpo completo e nenhum cabeçalho `Content-Range`.

### RF-08 — Validar Range com If-Range

Quando a requisição traz `If-Range`, o intervalo só é aplicado se o validador coincidir com o estado atual do asset. Se coincidir, a resposta é 206 (RF-02). Se não coincidir, `serveStatic` ignora `Range` e responde 200 com o corpo completo. Um ETag fraco nunca coincide para `If-Range`. Um valor de data coincide só se for exatamente igual ao `Last-Modified` do asset.

**Critério de aceite**
- **Dado** um asset com `etag: "abc"` e `Range: bytes=0-99`
- **Quando** o cliente envia `If-Range: "xyz"`
- **Então** a resposta tem status 200 e o corpo completo.
- **E** quando o cliente envia `If-Range: "abc"`, a resposta tem status 206.

### RF-09 — Manter a precedência de 304

As validações de cache (`If-None-Match` e `If-Modified-Since`) continuam sendo avaliadas antes de `Range`. Se a resposta seria 304, ela continua sendo 304. `Range` só é avaliado quando a resposta seria 200.

**Critério de aceite**
- **Dado** um asset com `etag: "abc"`
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-99`
- **Então** a resposta tem status 304, como hoje.

### RF-10 — Aplicar Range à variante codificada servida

Quando `serveStatic` escolhe uma variante pré-comprimida (por exemplo `app.js.gz`), o intervalo é aplicado aos bytes dessa variante. `Content-Encoding`, `Content-Type` e `Vary` seguem como hoje, e o tamanho usado é o da variante.

**Critério de aceite**
- **Dado** um `app.js` de 1000 bytes e uma variante `app.js.gz` de 400 bytes, com `encodings: { gzip: ".gz" }`
- **Quando** o cliente faz `GET` com `Accept-Encoding: gzip` e `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/400` e `Content-Length: 100`.

### RF-11 — Preservar 404, 405 e fallthrough

Os comportamentos atuais não mudam para requisições com ou sem `Range`: asset inexistente gera 404 (ou `fallthrough`), método diferente de GET/HEAD gera 405 com `Allow: GET, HEAD` (ou `fallthrough`), e caminhos não canônicos continuam não sendo servidos.

**Critério de aceite**
- **Dado** um asset inexistente
- **Quando** o cliente faz `GET` com `Range: bytes=0-99` e `fallthrough` está ativo
- **Então** `serveStatic` não retorna resposta e a requisição segue para o próximo handler.

### RF-12 — Sem exportações públicas novas

A mudança não adiciona nomes públicos: `src/index.ts` não ganha valores nem tipos, e as funções auxiliares ficam privadas no módulo `static.ts`. `ServeStaticOptions` não ganha opções.

**Critério de aceite**
- **Dado** a versão atual de `src/index.ts`
- **Quando** a mudança é aplicada
- **Então** a lista de exportações públicas (valores e tipos) é idêntica à anterior.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem 200 completo (RF-06).
- Unidades de intervalo que não sejam `bytes`.
- Nova opção em `ServeStaticOptions` ou novo parâmetro em `getContents` para que o backend leia apenas o trecho. O recorte é aplicado ao corpo que `getContents` devolve.
- Alterações em `h3/rules/proxy`, `h3/rules/cache` ou em `proxyRequest`.
- Cache de respostas parciais (206) no `ocache` ou em outras camadas.
- Testes específicos por runtime além da matriz `describeMatrix` (web e node) já existente.
- Alterações no comportamento de `serveStatic` para requisições que não sejam GET ou HEAD (continuam 405).

## Premissas e riscos

**Premissas**

- O `size` devolvido por `getMeta` é o tamanho exato da variante que será servida. Este é o único dado de tamanho usado.
- `getContents` devolve um corpo cujo comprimento real coincide com `size`. Se não coincidir, o `Content-Length` do 206 ficará errado.
- A norma aplicada é a RFC 9110, como pede o contrato, e não a RFC 7233 citada na issue.
- Intervalos de sufixo (`bytes=-n`) e abertos (`bytes=a-`) contam como "intervalo único" e são suportados.
- Para `size` igual a 0, qualquer intervalo é não satisfazível e responde 416. Isso segue a RFC 9110, mas o contrato não diz explicitamente. Confirmar antes da implementação.

**Riscos**

- **Desempenho com streams:** como `getContents` não recebe offset, um `ReadableStream` precisa ser lido e descartado até o início do intervalo. Em arquivos grandes, isso lê o arquivo inteiro para cada requisição de Range. Blobs e buffers podem ser fatiados diretamente.
- **Conflito com a opção `headers`:** o cabeçalho `content-length` pode vir da opção `headers`. A resposta 206 precisa sobrescrever esse valor, mas a lógica atual só define `content-length` quando ele não existe. Isso exige tratamento explícito.
- **Variantes codificadas:** clientes que pedem intervalos de conteúdo comprimido precisam conhecer a variante escolhida. Caches intermediários podem tratar isso de forma inconsistente. Se for um problema, a alternativa é não aplicar Range a variantes com `Content-Encoding` (decisão para revisar).
- **Cabeçalhos de intervalo vindos de `headers`:** se o usuário configurar `Content-Range` ou `Accept-Ranges` pela opção `headers`, o comportamento precisa ser definido.
- **Regressão:** a mudança toca o caminho principal de todo asset servido. Os testes existentes em `test/` precisam continuar passando, e só devem ser ajustados onde a nova regra altera o resultado.
