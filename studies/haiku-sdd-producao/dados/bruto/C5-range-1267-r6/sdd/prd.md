# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um cliente que pede um intervalo de bytes recebe sempre o arquivo inteiro com `200 OK`, sem nenhum cabeçalho de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players, que enviam `Range` por padrão;
- que CDNs e proxies façam cache e entrega parcial corretamente.

**Objetivo:** fazer o `serveStatic` atender requisições de intervalo de bytes para `GET` e `HEAD` segundo a RFC 9110 (seções 14 e 13.1.5), sem alterar a API pública, o comportamento de cache, a seleção de encoding, o `fallthrough`, nem as respostas 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de asset servido (200, 206, 416 e as respostas de HEAD).

**Critério de aceite**

- **Dado** um asset existente servido pelo `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta contém `Accept-Ranges: bytes` e status 200

### RF-02 — Responder com 206 a um intervalo válido

Para um intervalo único e válido (`bytes=a-b`, `bytes=a-`), o `serveStatic` deve responder `206 Partial Content` com o trecho pedido, `Content-Range: bytes a-b/tamanho` e `Content-Length` igual a `b - a + 1`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta tem status 206, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 100 a 199 do asset

### RF-03 — Intervalo de sufixo

Para `bytes=-n`, o `serveStatic` deve responder com os últimos `n` bytes do asset. Se `n` for maior que o tamanho, deve usar o asset inteiro.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=-100`
- **Então** a resposta tem status 206, `Content-Range: bytes 900-999/1000`, `Content-Length: 100` e o corpo contém os bytes 900 a 999
- **E** **Quando** o cliente envia `Range: bytes=-5000`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-999/1000` e `Content-Length: 1000`

### RF-04 — Intervalo final além do tamanho

Para `bytes=a-b` em que `b` ultrapassa o último byte, o `serveStatic` deve limitar `b` ao último byte do asset.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=900-5000`
- **Então** a resposta tem status 206, `Content-Range: bytes 900-999/1000` e `Content-Length: 100`

### RF-05 — Ignorar Range que não se pode interpretar

O `serveStatic` deve ignorar o cabeçalho `Range` e responder `200 OK` com o asset completo quando ele for malformado, usar outra unidade que não `bytes`, tiver `a > b`, ou tiver mais de um intervalo (múltiplos intervalos não são suportados nesta versão).

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=abc`, `Range: items=0-5`, `Range: bytes=500-100` ou `Range: bytes=0-10,20-30`
- **Então** a resposta tem status 200, não tem `Content-Range` e o corpo é o asset completo

### RF-06 — 416 para intervalo não satisfazível

Quando o intervalo é sintaticamente válido, mas não se aplica ao asset (início além do último byte, ou asset de tamanho zero), o `serveStatic` deve responder `416 Range Not Satisfiable` com `Content-Range: bytes */tamanho` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-07 — HEAD com intervalo

Em uma requisição `HEAD`, o `serveStatic` deve aplicar as mesmas regras de RF-02 a RF-06 (status, `Content-Range`, `Content-Length`), sem enviar corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=100-199`
- **Então** a resposta tem status 206, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo vazio

### RF-08 — Validação condicional com If-Range

Quando a requisição traz `If-Range`, o `Range` só deve ser honrado se o validador bater com o estado atual do asset: ETag forte igual ao ETag atual, ou data `Last-Modified` exatamente igual à do asset. Se não bater, ou se o validador for um ETag fraco, o `serveStatic` deve ignorar o `Range` e responder `200` com o asset completo (RFC 9110, seção 13.1.5).

**Critério de aceite**

- **Dado** um asset com ETag `"v1"` (forte)
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "v1"`
- **Então** a resposta tem status 206 com os 100 primeiros bytes
- **E** **Quando** o cliente envia o mesmo `Range` com `If-Range: "v0"`
- **Então** a resposta tem status 200 com o asset completo
- **E** **Quando** o cliente envia o mesmo `Range` com `If-Range: W/"v1"`
- **Então** a resposta tem status 200 com o asset completo

### RF-09 — Ordem com a validação de cache

A validação condicional de cache existente (`If-None-Match` e `If-Modified-Since`, que gera 304) deve continuar sendo avaliada antes do `Range`. Uma requisição que resulta em 304 nunca retorna 206 nem 416.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `Range: bytes=0-99` com `If-None-Match: "v1"`
- **Então** a resposta tem status 304, sem corpo

### RF-10 — Tamanho desconhecido

Quando `getMeta` não devolve `size` (ou devolve `undefined`), o `serveStatic` deve ignorar o `Range` e responder `200` com o asset completo, sem `Content-Range`.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta tem status 200 e o corpo é o asset completo

### RF-11 — Preservação do comportamento atual

Sem `Range` (ou com `Range` ignorado pelas regras de RF-05, RF-08 e RF-10), as respostas devem ser idênticas às de hoje. Isso inclui `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary: accept-encoding`, headers configurados em `options.headers`, o fallback de `fallthrough`, o 404 para asset inexistente e o 405 para método diferente de GET/HEAD.

**Critério de aceite**

- **Dado** a suíte de testes existente de `serveStatic`
- **Quando** ela é executada após a mudança
- **Então** todos os testes passam, e só são ajustados os que verificam comportamento que a mudança altera de forma intencional

### RF-12 — Intervalo com variante pré-comprimida

Quando `encodings` está configurado e o cliente recebe uma variante pré-comprimida, o `Range` deve se referir aos bytes dessa variante (`Content-Encoding` preservado). O `Content-Length` e o `Content-Range` devem usar o tamanho informado por `getMeta` para a variante escolhida.

**Critério de aceite**

- **Dado** `encodings: { gzip: ".gz" }`, um arquivo `app.js.gz` de 400 bytes e `accept-encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-99/400`, `Content-Length: 100`, e o `Vary` contém `accept-encoding`

### RF-13 — API pública e helpers privados

A mudança não pode adicionar nenhuma exportação em `src/index.ts`, nem nomes novos na API pública (valores ou tipos). Toda a lógica de intervalo fica em funções privadas dentro de `src/utils/static.ts`. Nenhum parâmetro novo é adicionado a `ServeStaticOptions`, `getMeta` ou `getContents`.

**Critério de aceite**

- **Dado** o `src/index.ts` antes e depois da mudança
- **Quando** os dois são comparados
- **Então** a lista de exportações é idêntica, e `ServeStaticOptions` tem exatamente os mesmos campos

### RF-14 — Testes e qualidade

Os cenários dos RF-01 a RF-12 devem ter testes que rodam nos modos `web` e `node` (`describeMatrix`). `pnpm lint` e `pnpm typecheck` devem passar.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** `pnpm vitest run test/static.test.ts` (ou o arquivo de teste de `serveStatic` existente) e `pnpm lint` são executados
- **Então** os testes de intervalo passam nos dois modos, e o lint e o typecheck não reportam erros

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Esses pedidos são tratados como em RF-05: o `Range` é ignorado e o asset completo é servido.
- Unidades de intervalo diferentes de `bytes`.
- `If-Match` e `If-Unmodified-Since` (pré-condições de escrita; hoje não são tratadas pelo `serveStatic`).
- Range para `h3/rules/cache` (cache de respostas parciais) e para `h3/rules/proxy` ou `proxyRequest`.
- Limitação de banda, `Content-Disposition` e qualquer mudança de `Content-Type` por causa de Range.
- Alterar as assinaturas de `getMeta` e `getContents`, ou criar uma nova opção pública para fatiar o conteúdo.
- Mudanças em `src/index.ts`, em tipos públicos ou em outras utilidades além de `serveStatic`.
- Benchmarks de desempenho (`pnpm bench:*`).

## Premissas

- A norma de referência é a RFC 9110 (seções 13.1.5, 13.2.2 e 14), que substitui a RFC 7233 citada na issue.
- `getMeta` devolve `size` correto para a variante que será servida. Sem isso, `Content-Range` e `Content-Length` ficam errados.
- `getContents` devolve um `BodyInit` completo para o `id` pedido, e o `serveStatic` é responsável por fatiá-lo. Como a assinatura não muda, o fatiamento acontece sobre o corpo devolvido.
- Os cabeçalhos `Accept-Ranges` e os de conteúdo parcial são enviados só para respostas de asset encontrado. Respostas 404 e 405 não mudam.
- Quando `size` é `0`, o asset é tratado como de tamanho zero (a RFC prevê 416 para qualquer intervalo). Hoje o código não envia `Content-Length` nesse caso, e a mudança precisa tratar isso de forma explícita.

## Riscos

- **Fatiamento do corpo sem mudar a API (alto).** `getContents` devolve um `BodyInit` genérico (string, `Blob`, `ArrayBuffer`, `ReadableStream`, etc.). Fatiar um `ReadableStream` sem reter o arquivo inteiro na memória exige consumir e descartar bytes até o início do intervalo, o que é lento para arquivos grandes em vídeo. Esse ponto precisa de decisão de design antes da implementação: se o fatiamento for feito só para tipos com `slice` (como `Blob`), é preciso definir o que acontece com os outros tipos.
- **Divergência entre `size` e o corpo real.** Se `getMeta` informar um tamanho diferente do conteúdo devolvido por `getContents`, o cliente recebe `Content-Length` inconsistente. Não há como o `serveStatic` verificar isso sem ler o corpo inteiro.
- **Regressão em cache e 304.** Mudar a ordem de avaliação entre a validação condicional e o `Range` pode quebrar o 304 existente. RF-09 e RF-11 existem para proteger isso.
- **Interpretação de `If-Range` com ETag fraco.** A comparação precisa ser forte, conforme a RFC. Uma implementação que compare como fraca pode servir 206 indevido.
- **Testes existentes que assumem 200 para qualquer requisição.** Eles podem precisar de ajuste. Isso deve ser feito só nos testes que dependem do comportamento alterado, como pede o contrato.
