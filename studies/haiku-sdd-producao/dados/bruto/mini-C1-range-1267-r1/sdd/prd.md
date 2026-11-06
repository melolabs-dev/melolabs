# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora cabeçalhos `Range`. Um cliente que pede um trecho do arquivo recebe sempre o corpo completo com `200 OK`, sem nenhum cabeçalho de conteúdo parcial. Com isso:

- downloads não podem ser retomados;
- players de áudio e vídeo não conseguem avançar (seek), porque o navegador depende de respostas parciais;
- proxies e CDNs não recebem o comportamento esperado para representações parciais.

**Objetivo:** fazer `serveStatic` atender requisições `GET` e `HEAD` com um único intervalo de bytes, conforme RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, sem novas exportações e sem quebrar cache, seleção de encoding, `fallthrough`, 404 e 405 já existentes.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Quando um asset é encontrado e seu tamanho é conhecido, a resposta de `GET` e de `HEAD` inclui `Accept-Ranges: bytes`.

**Dado** um asset existente cujo `getMeta` devolve `size` numérico
**Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
**Então** a resposta é `200` com o corpo completo e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder com 206 a um intervalo válido

Para um único intervalo válido, a resposta é `206 Partial Content` com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Os três formatos de intervalo de byte único são aceitos: `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-n` (últimos `n` bytes). Quando há `content-encoding` (variante pré-comprimida), o intervalo e o tamanho referem-se à representação efetivamente servida, isto é, ao `size` devolvido por `getMeta` para a variante escolhida.

**Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=0-499`
**Quando** o cliente faz `GET`
**Então** a resposta é `206`, `Content-Range: bytes 0-499/1000`, `Content-Length: 500`, e o corpo são exatamente os bytes 0 a 499 do arquivo.

**Dado** o mesmo asset e o cabeçalho `Range: bytes=-100`
**Quando** o cliente faz `GET`
**Então** a resposta é `206`, `Content-Range: bytes 900-999/1000`, `Content-Length: 100`.

### RF-03 — HEAD com intervalo

Para `HEAD`, um intervalo válido produz a mesma resposta de RF-02 (status, `Content-Range`, `Content-Length`), sem corpo.

**Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=500-`
**Quando** o cliente faz `HEAD`
**Então** a resposta é `206`, `Content-Range: bytes 500-999/1000`, `Content-Length: 500` e corpo vazio.

### RF-04 — Ignorar Range que não será atendido

Quando o cabeçalho `Range` é sintaticamente inválido, usa outra unidade que não `bytes`, ou pede mais de um intervalo, a resposta é o `200` completo, como se o cabeçalho não existisse. Não há resposta de erro por causa do cabeçalho.

**Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=0-1,5-9` (múltiplos intervalos)
**Quando** o cliente faz `GET`
**Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

**Dado** o cabeçalho `Range: itens=0-9` ou `Range: bytes=abc`
**Quando** o cliente faz `GET`
**Então** a resposta é `200` com o corpo completo.

### RF-05 — Responder 416 para intervalo não satisfazível

Quando o intervalo é sintaticamente válido, mas não cobre nenhum byte do asset (início além do fim, ou sufixo de zero bytes, ou qualquer intervalo sobre asset de tamanho zero), a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`, sem corpo.

**Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=1000-1500`
**Quando** o cliente faz `GET`
**Então** a resposta é `416`, `Content-Range: bytes */1000`, `Content-Length: 0`, e `getContents` não é chamado.

### RF-06 — If-Range

Quando `If-Range` está presente junto com `Range`, o intervalo só é aplicado se o validador corresponder ao estado atual do asset. Validador com ETag exige comparação forte (ETag fraca nunca corresponde). Validador com data corresponde se for igual ao `Last-Modified` servido. Se não corresponder, a resposta é o `200` completo.

**Dado** um asset com ETag forte `"abc"` e o cabeçalho `Range: bytes=0-9` com `If-Range: "abc"`
**Quando** o cliente faz `GET`
**Então** a resposta é `206` com os bytes 0 a 9.

**Dado** o mesmo asset e `If-Range: "xyz"`
**Quando** o cliente faz `GET`
**Então** a resposta é `200` com o corpo completo.

### RF-07 — Precedência da validação condicional

A validação condicional (`If-None-Match`, `If-Modified-Since`) é avaliada antes de `Range`. Se ela resultar em `304`, o `304` prevalece e nenhum `Range` é atendido.

**Dado** um asset com ETag `"abc"` e os cabeçalhos `If-None-Match: "abc"` e `Range: bytes=0-9`
**Quando** o cliente faz `GET`
**Então** a resposta é `304` sem corpo.

### RF-08 — Sem regressão nas requisições sem Range

Requisições sem `Range` (e os caminhos de cache, encoding, `fallthrough`, 404 e 405) mantêm o comportamento atual. A única mudança observável fora dos casos de RF-01 a RF-07 é a presença de `Accept-Ranges` nas respostas de assets encontrados.

**Dado** `serveStatic` com `fallthrough: true` e um asset inexistente
**Quando** o cliente faz `GET` com `Range: bytes=0-9`
**Então** `serveStatic` devolve `undefined` e a requisição segue para o próximo handler.

**Dado** uma requisição `POST` com `Range` a um asset existente
**Quando** `serveStatic` processa a requisição
**Então** a resposta continua sendo `405` com `Allow: GET, HEAD`.

### RF-09 — Sem novas exportações públicas

Nenhum nome novo (valor ou tipo) é exportado por `src/index.ts`. Funções auxiliares de parsing e de cálculo de intervalo ficam privadas em `src/utils/static.ts`. A assinatura de `ServeStaticOptions`, `getMeta` e `getContents` não muda.

**Dado** o código-fonte após a mudança
**Quando** se compara a lista de exports de `src/index.ts` e dos subcaminhos afetados com a versão anterior
**Então** a lista é idêntica.

### RF-10 — Cobertura de testes

Os novos comportamentos são cobertos por testes que rodam na matriz `web` e `node` (`describeMatrix`). Testes existentes são ajustados apenas se dependerem do comportamento alterado, sem perder o que verificam.

**Dado** a suíte após a mudança
**Quando** se executa `pnpm vitest run` nos testes de static
**Então** os testes de RF-01 a RF-07 passam nos dois alvos, e os testes existentes continuam passando.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` completo (RF-04).
- Range em respostas geradas dinamicamente, em `rules/cache`, `rules/proxy` ou em outras rotas que não usem `serveStatic`.
- Compressão ou recodificação sob demanda para atender Range.
- Alteração na assinatura de `getMeta` ou `getContents` (por exemplo, para receber um intervalo como parâmetro).
- Otimizações de leitura parcial por arquivo do sistema (ex.: `fs.read` com offset). A leitura continua passando pelo `getContents` existente.
- Suporte a `If-Range` com data em formatos não canônicos além do que a RFC exige.
- Documentação extensa fora do próprio código e da descrição da issue.

## Premissas e riscos

### Premissas

- **Norma:** RFC 9110 substitui a RFC 7233 citada na issue. Onde os dois diferem, vale a RFC 9110.
- **Anúncio de `Accept-Ranges`:** a issue pede anúncio sempre. Este PRD restringe o anúncio a assets com `size` conhecido (RF-01), porque sem tamanho não há como atender Range e o anúncio seria falso. Decisão a confirmar.
- **Intervalos suportados:** a issue cita só "um intervalo". Este PRD aceita também os formatos aberto (`a-`) e sufixo (`-n`), que são o caso de uso típico de players de mídia. Decisão a confirmar.
- **Tamanho confiável:** o `size` de `getMeta` é o número exato de bytes que `getContents` devolve para a mesma variante.
- **Encoding:** o intervalo se aplica à representação servida (variante pré-comprimida, quando escolhida), como já ocorre com `content-length`.
- **Corpo:** `getContents` devolve o arquivo completo; o intervalo é obtido fatiando esse corpo, já que a assinatura não muda.
- **Plataforma:** o código novo usa apenas APIs web padrão (`Request`, `Response`, `Headers`, `Blob`/`ArrayBuffer`) e funciona nas plataformas da matriz de testes.

### Riscos

- **Memória:** como `getContents` não recebe intervalo, atender Range pode carregar o arquivo inteiro antes de fatiar. Em vídeos grandes isso pode ser custoso. Mitigação possível no design: fatiar `Blob` e `ReadableStream` sem materializar tudo. Precisa de decisão de design antes da implementação.
- **Streams:** para `ReadableStream`, pular bytes até `início` e parar em `fim` exige consumir e descartar dados. O design deve definir o tratamento, ou limitar o suporte aos tipos que permitem fatiar sem custo.
- **Tamanho divergente:** se `size` não bater com o corpo real, o `Content-Length` e o `Content-Range` ficam errados. Risco de baixa probabilidade, mas com efeito grave para o cliente.
- **Respostas parciais com encoding:** clientes e caches podem tratar mal intervalos sobre representações codificadas. Os testes devem cobrir a combinação de `encodings` com Range.
- **Testes existentes:** suítes que verificam `200` sem `Accept-Ranges` ou que esperam corpo completo para `HEAD` podem precisar de ajuste. O ajuste deve ser mínimo e preservar o que o teste verifica.
- **Cache intermediário:** respostas `206` cacheadas em proxies podem interagir com `ETag` e `Last-Modified` de formas que a equipe ainda não avaliou.
- **Validação do If-Range por data:** a comparação de data depende de `mtime` truncado para segundos, como já é feito para `last-modified`. Diferença de precisão pode levar a `200` onde o cliente esperava `206`.
