# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 · Módulo: `src/utils/static.ts` · Norma: RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests)

## Problema e objetivo

Hoje o `serveStatic` ignora o cabeçalho `Range`. Um cliente que pede um trecho recebe o arquivo inteiro com `200 OK`, sem nenhum header de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em players e navegadores, que dependem de `206 Partial Content`;
- comportamento correto de CDNs e proxies que fazem cache por intervalo.

**Objetivo:** fazer o `serveStatic` atender requisições GET e HEAD com um único intervalo de bytes válido, respondendo `206` ou `416` conforme a RFC 9110, sem alterar o comportamento atual nos demais casos e sem introduzir API pública nova.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

As respostas de sucesso do `serveStatic` (GET e HEAD) passam a incluir `Accept-Ranges: bytes`, inclusive quando o cliente não enviou `Range`.

**Critério de aceite**

- **Dado** um asset existente servido pelo `serveStatic`
- **Quando** um cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta `200` contém `Accept-Ranges: bytes` e o corpo completo, como hoje.

### RF-02 — Responder intervalo válido com 206

Quando o cliente envia um `Range: bytes=…` com um único intervalo satisfazível, a resposta é `206 Partial Content` com `Content-Range` e `Content-Length` corretos. Os três formatos são suportados: `a-b`, `a-` (até o fim) e `-n` (últimos `n` bytes, limitado ao tamanho do asset). Quando `b` ultrapassa o tamanho, o intervalo é truncado no último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes com `size` informado por `getMeta`
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta é `206`, com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 100 a 199.

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=-200`
- **Então** a resposta é `206`, com `Content-Range: bytes 800-999/1000` e `Content-Length: 200`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=900-5000`
- **Então** a resposta é `206`, com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.

### RF-03 — HEAD com intervalo válido

Para `HEAD`, um `Range` válido retorna os mesmos headers do `206` do RF-02 (`Content-Range`, `Content-Length` do trecho), sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=100-199`
- **Então** a resposta é `206`, com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo vazio.

### RF-04 — Responder intervalo não satisfazível com 416

Quando o intervalo começa no tamanho do asset ou além, ou quando é um sufixo de comprimento zero, a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<size>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta é `416`, com `Content-Range: bytes */1000` e `Content-Length: 0`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `HEAD` com `Range: bytes=1000-`
- **Então** a resposta é `416`, com `Content-Range: bytes */1000` e sem corpo.

### RF-05 — Ignorar Range malformado ou com múltiplos intervalos

Se o `Range` estiver sintaticamente inválido, usar outra unidade que não `bytes`, ou tiver mais de um intervalo, o `Range` é ignorado e a resposta é `200` com o asset completo. Isso inclui intervalos com início maior que o fim (ex.: `bytes=5-2`). A resposta não é `416` nesses casos.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-1,5-9`
- **Então** a resposta é `200`, sem `Content-Range`, com o corpo completo.

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: items=0-9` ou `Range: bytes=abc`
- **Então** a resposta é `200`, com o corpo completo.

### RF-06 — Validar If-Range

Quando a requisição traz `If-Range`, o `Range` só é atendido se o validador corresponder ao estado atual do asset: ETag forte igual ao `etag` de `getMeta`, ou data HTTP exatamente igual ao `mtime` truncado para segundos. Em caso de divergência, ou se o `If-Range` for um ETag fraco, o `Range` é ignorado e a resposta é `200` completa.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"` e um `Range` válido
- **Quando** o cliente envia `If-Range: "abc"`
- **Então** a resposta é `206` com o trecho pedido.

- **Dado** o mesmo asset
- **Quando** o cliente envia `If-Range: "outro"` ou `If-Range: W/"abc"`
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`.

### RF-07 — Precedência com cache condicional e demais respostas

A checagem condicional existente (`If-None-Match` / `If-Modified-Since` → `304`) continua tendo precedência sobre `Range`. As respostas `404` (asset inexistente), `405` (método não permitido), o comportamento de `fallthrough` e a validação de caminho canônico não mudam. `Range` em método diferente de GET/HEAD não altera a resposta `405`.

**Critério de aceite**

- **Dado** um asset cujo ETag bate com `If-None-Match`
- **Quando** o cliente envia também `Range: bytes=0-9`
- **Então** a resposta é `304`, como hoje.

- **Dado** um asset inexistente e `Range` válido
- **Quando** o cliente faz `GET`
- **Então** a resposta é `404`, ou o fluxo segue para o próximo handler quando `fallthrough` está ativo.

### RF-08 — Asset de tamanho desconhecido

Se `getMeta` não retornar `size` (ou retornar valor não positivo), o `Range` é ignorado e a resposta é o `200` atual, com corpo completo e sem `Content-Range`.

**Critério de aceite**

- **Dado** um `getMeta` que retorna o asset sem `size`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`.

### RF-09 — Variantes com content-encoding

Quando a variante servida tem `content-encoding` (pré-comprimida, ex.: `.gz` ou `.br`), o `Range` é ignorado e a resposta é `200` completa. O intervalo não é aplicado aos bytes comprimidos.

**Critério de aceite**

- **Dado** um asset com variante `.gz` disponível, `encodings: { gzip: ".gz" }` e `accept-encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta é `200` com `content-encoding: gzip` e corpo completo.

### RF-10 — Preservar headers existentes em 206

Em respostas `206`, os headers já produzidos pelo `serveStatic` continuam presentes: `Content-Type`, `ETag`, `Last-Modified`, `Vary` (quando há `encodings`) e os headers vindos de `options.headers`.

**Critério de aceite**

- **Dado** um asset com `etag`, `mtime`, `type` e `options.headers` com `Cache-Control`
- **Quando** o cliente envia um `Range` válido
- **Então** a resposta `206` contém `Content-Type`, `ETag`, `Last-Modified` e `Cache-Control` com os mesmos valores da resposta `200`.

### RF-11 — Sem exportação pública nova

A funcionalidade não adiciona nenhum nome (valor ou tipo) a `src/index.ts`. Funções auxiliares de parsing e de cálculo de intervalo ficam privadas no módulo `static.ts`, ou em `utils/internal/` se forem reutilizadas por outro módulo interno.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** se compara a lista de exports de `src/index.ts` com a versão atual
- **Então** a lista é idêntica.

### RF-12 — Testes em ambos os modos

Os casos dos RF-01 a RF-09 são cobertos por testes com `describeMatrix` (modos `web` e `node`). A suíte existente continua passando; testes existentes só são ajustados se assertam o comportamento antigo que a mudança altera, sem remover o que eles verificam.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** se executa `pnpm vitest run test/static.test.ts` (ou o arquivo de testes de static existente) e depois `pnpm lint` e `pnpm typecheck`
- **Então** todos passam nos dois modos, e cada RF listado tem ao menos um teste que falharia sem a implementação.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` completo (RF-05).
- Range em respostas geradas dinamicamente (handlers próprios, `proxy`, `h3/rules/cache`). Só o `serveStatic` é afetado.
- Range sobre variantes com `content-encoding` (RF-09 define o comportamento de ignorar).
- Novas opções públicas em `ServeStaticOptions` ou mudança na assinatura de `getMeta`/`getContents`.
- Suporte a streaming adaptativo (HLS, DASH) ou a qualquer lógica de mídia.
- Ajustes de headers de CDN ou proxy externo (ex.: `Cache-Control` específico para `206`).
- Mudanças em outros utilitários (`proxyRequest`, `readBody`, etc.).

## Premissas e riscos

### Premissas

- **P1.** `getMeta` retorna `size` para assets servidos em disco ou via backend. Sem `size`, o RF-08 aplica.
- **P2.** `etag` e `mtime` são opcionais em `getMeta`. A validação de If-Range (RF-06) só atende a validadores que existem. Se não existir validador, `If-Range` com qualquer valor faz o `Range` ser ignorado (`200`).
- **P3.** A norma de referência é a RFC 9110, que substitui a RFC 7233 citada na issue. Os comportamentos "ignorar Range" (RF-05) e "ignorar Range para variantes codificadas" (RF-09) são permitidos pela RFC 9110 como opções do servidor.
- **P4.** `getContents` devolve o conteúdo completo como `BodyInit` e não recebe intervalo. Para servir um trecho, o `serveStatic` precisa fatiar esse corpo. Assume-se que a fatia pode ser feita sem contrato novo com o usuário (ver risco R1).
- **P5.** O comportamento atual (ignorar `Range`, responder `200`) é aceito por consumidores existentes. Mudar isso é o objetivo da feature, não uma regressão.

### Riscos

- **R1 — Memória e performance em arquivos grandes.** Se `getContents` devolver o arquivo inteiro e a fatia for feita em memória, um vídeo grande pode ser carregado por inteiro a cada `Range`. Isso anula o ganho de seek. A solução precisa usar fatiamento por stream ou por `Blob.slice` sem ler o arquivo todo. Se isso não for possível com a API atual, o risco vira uma decisão de produto (nova opção pública, que está fora de escopo).
- **R2 — Semântica de If-Range.** Comparar ETag fraco como forte, ou comparar datas com precisão de milissegundos, faz clientes receberem trechos de versões diferentes do asset. Os testes do RF-06 devem cobrir esses casos.
- **R3 — Precedência 304 vs 206.** Se a ordem das checagens mudar, uma requisição condicional pode receber `206` no lugar de `304`, ou o contrário. O RF-07 fixa essa ordem.
- **R4 — Interação com cache intermediário.** Um `206` cacheado por proxy pode ser servido a um cliente que pediu outro intervalo, se `Vary` ou `Content-Range` forem tratados de forma errada. A feature deve manter o `Vary` atual e não criar cache de `206` no módulo.
- **R5 — Caso `size` igual a zero.** Hoje o `serveStatic` não define `Content-Length` quando `size` é zero. Pela RFC, qualquer `Range` em recurso vazio é não satisfazível (`416`, `bytes */0`). A decisão sobre esse caso precisa ser tomada e testada; o PRD assume que `size: 0` cai no RF-08 (ignorar Range) para não mudar o comportamento atual de tamanho zero.
- **R6 — Testes existentes que assertam o comportamento antigo.** Algum teste atual pode verificar `200` para um `Range`, ou a ausência de `Accept-Ranges`. Esses testes devem ser ajustados conforme o RF-12, sem perder a verificação original.
- **R7 — Dependência de decisão sobre RF-09.** Se o time preferir atender `Range` sobre a variante comprimida, o RF-09 muda e a complexidade sobe (o `Content-Length` precisa ser o da variante). Esta decisão deve ser confirmada antes da implementação.
