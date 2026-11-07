# PRD: HTTP Range no `serveStatic`

Referência: h3js/h3#1267. Contrato de origem: `sdd/pedido.md`.

## Problema e objetivo

### Problema

`serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD para um asset recebe `200` com o corpo completo, e a resposta não anuncia `Accept-Ranges`. Por isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek), pois dependem de respostas `206 Partial Content`;
- proxies e CDNs não recebem respostas parciais e não se comportam como esperado.

### Objetivo

Fazer `serveStatic` atender a um único intervalo de bytes em GET e HEAD, conforme RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública e sem mudar cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

O `serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta GET ou HEAD de asset encontrado (200, 206, 304 e 416).

**Dado** um asset encontrado e uma requisição GET sem cabeçalho `Range`,
**Quando** o `serveStatic` responde,
**Então** a resposta 200 contém `Accept-Ranges: bytes`.

### RF-02 — Responder 206 a um intervalo válido

Para um único intervalo `bytes=início-fim` válido, o `serveStatic` responde `206 Partial Content` com o trecho pedido.

**Dado** um asset de 1000 bytes,
**Quando** a requisição GET tem `Range: bytes=0-499`,
**Então** a resposta tem status 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e corpo com os bytes 0 a 499.

### RF-03 — Suportar intervalo aberto e intervalo de sufixo

Além de `início-fim`, o `serveStatic` aceita `início-` (até o fim do asset) e `-N` (os últimos N bytes). Quando o fim excede o tamanho, o fim é limitado ao último byte.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem `Range: bytes=500-`,
**Então** a resposta é 206 com `Content-Range: bytes 500-999/1000` e `Content-Length: 500`.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem `Range: bytes=-200`,
**Então** a resposta é 206 com `Content-Range: bytes 800-999/1000` e `Content-Length: 200`.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem `Range: bytes=900-5000`,
**Então** a resposta é 206 com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem `Range: bytes=-5000`,
**Então** a resposta é 206 com `Content-Range: bytes 0-999/1000` e o asset inteiro.

### RF-04 — HEAD com Range

Em HEAD, o `serveStatic` responde com os mesmos cabeçalhos que o GET responderia, sem corpo.

**Dado** um asset de 1000 bytes,
**Quando** a requisição é HEAD com `Range: bytes=0-499`,
**Então** a resposta é 206 com `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e corpo vazio.

### RF-05 — Ignorar Range malformado, múltiplo ou de outra unidade

Quando o `Range` não é um único intervalo `bytes` sintaticamente válido, o `serveStatic` ignora o cabeçalho e responde 200 com o asset completo.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem um dos cabeçalhos `bytes=500-200` (início maior que fim), `bytes=0-1,3-4` (múltiplos intervalos), `items=0-1` (unidade desconhecida) ou `bytes=abc`,
**Então** a resposta é 200, sem `Content-Range`, com `Content-Length: 1000` e corpo completo.

### RF-06 — Responder 416 a intervalo não satisfazível

Quando o intervalo é sintaticamente válido, mas não se sobrepõe ao asset, o `serveStatic` responde `416 Range Not Satisfiable`.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tem `Range: bytes=1000-1500` ou `Range: bytes=-0`,
**Então** a resposta é 416 com `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

**Dado** um asset de 0 bytes,
**Quando** a requisição tem `Range: bytes=0-`,
**Então** a resposta é 416 com `Content-Range: bytes */0`.

### RF-07 — Ignorar Range quando o tamanho não é conhecido

Sem `size` válido em `getMeta`, o `serveStatic` não consegue calcular `Content-Range` e ignora o cabeçalho `Range`.

**Dado** um asset cujo `getMeta` não devolve `size`,
**Quando** a requisição tem `Range: bytes=0-99`,
**Então** a resposta é 200 com o corpo completo e sem `Content-Range`.

### RF-08 — Validar If-Range

Quando a requisição traz `If-Range`, o `Range` só vale se o validador coincidir com a representação atual (RFC 9110, seção 13.1.5). Caso contrário, o `serveStatic` ignora o `Range` e responde 200 completo.

**Dado** um asset com ETag forte `"v1"`,
**Quando** a requisição tem `Range: bytes=0-99` e `If-Range: "v1"`,
**Então** a resposta é 206.

**Dado** um asset com ETag forte `"v1"`,
**Quando** a requisição tem `Range: bytes=0-99` e `If-Range: "v0"`,
**Então** a resposta é 200 completo.

**Dado** um asset com ETag fraco `W/"v1"`,
**Quando** a requisição tem `Range: bytes=0-99` e `If-Range: W/"v1"`,
**Então** a resposta é 200 completo, porque a comparação de `If-Range` exige validador forte.

**Dado** um asset com `Last-Modified` igual a `Wed, 21 Oct 2015 07:28:00 GMT`,
**Quando** a requisição tem `Range: bytes=0-99` e `If-Range` com essa mesma data,
**Então** a resposta é 206; com outra data, a resposta é 200 completo.

### RF-09 — Condicionais antes de Range

As pré-condições da requisição são avaliadas antes do `Range`. Se a resposta for 304, ela não tem corpo nem `Content-Range`.

**Dado** um asset com ETag `"v1"`,
**Quando** a requisição tem `If-None-Match: "v1"` e `Range: bytes=0-99`,
**Então** a resposta é 304, sem corpo e sem `Content-Range`.

### RF-10 — Range sobre a representação servida

O `Range` aplica-se aos bytes da representação escolhida pelo encoding. Quando um asset pré-comprimido é servido, `Content-Range` e `Content-Length` refletem os bytes codificados, e `Content-Encoding` e `Vary` permanecem como hoje.

**Dado** `encodings: { gzip: ".gz" }`, um asset `app.js.gz` de 1000 bytes e a requisição `Accept-Encoding: gzip` com `Range: bytes=0-99`,
**Quando** o `serveStatic` responde,
**Então** a resposta é 206 com `Content-Encoding: gzip`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e `Vary: accept-encoding`.

### RF-11 — Preservar fallthrough, 404 e 405

Um cabeçalho `Range` não altera o tratamento de asset inexistente, de método não permitido, de caminho não canônico ou de `fallthrough`.

**Dado** um caminho que não existe e a requisição com `Range: bytes=0-99`,
**Quando** `fallthrough` não está definido,
**Então** a resposta é 404; com `fallthrough: true`, a função retorna `undefined`.

**Dado** uma requisição POST com `Range: bytes=0-99`,
**Quando** o `serveStatic` responde,
**Então** a resposta é 405 com `Allow: GET, HEAD`, como hoje.

### RF-12 — Fatiar o corpo sem mudar a API de `getContents`

`getContents(id)` continua recebendo só o `id`. O `serveStatic` recorta o corpo devolvido, para qualquer tipo aceito por `BodyInit`, e não é necessário nenhum parâmetro novo.

**Dado** um `getContents` que devolve uma string ou um `Blob` de 1000 bytes,
**Quando** a requisição tem `Range: bytes=500-599`,
**Então** o corpo da resposta tem exatamente os bytes 500 a 599.

**Dado** um `getContents` que devolve um `ReadableStream` de 1000 bytes,
**Quando** a requisição tem `Range: bytes=500-599`,
**Então** o corpo da resposta tem exatamente os bytes 500 a 599, e o stream de origem é cancelado depois de entregar o último byte do intervalo.

**Dado** uma requisição HEAD com `Range` válido,
**Quando** o `serveStatic` responde,
**Então** `getContents` não é chamado.

### RF-13 — Sem exportações públicas novas

**Dado** o arquivo `src/index.ts` antes e depois da mudança,
**Quando** a implementação está concluída,
**Então** nenhum nome novo (valor ou tipo) é exportado, `ServeStaticOptions` não ganha campos, e as funções auxiliares ficam privadas em `src/utils/static.ts`.

### RF-14 — Suíte existente e qualidade

**Dado** o repositório com a implementação concluída,
**Quando** são executados `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck`,
**Então** todos passam, e os testes novos rodam nos modos `web` e `node` (`describeMatrix`). Testes existentes são alterados apenas quando dependem de um comportamento que a mudança altera, e o que eles verificam é preservado.

## Fora de escopo

- Múltiplos intervalos na mesma resposta (`multipart/byteranges`). Requisições com mais de um intervalo recebem o asset completo (RF-05).
- Unidades de Range diferentes de `bytes`.
- Mudanças em `getContents`, `getMeta` ou em `ServeStaticOptions` (por exemplo, um parâmetro de intervalo que deixe o backend ler só o trecho pedido).
- Alterar `ETag`, `Last-Modified` ou o cache de respostas parciais por intervalo.
- Pré-condições de escrita (`If-Match`, `If-Unmodified-Since` com 412).
- Mudanças em outros utilitários, adaptadores ou entradas de plataforma.
- Ajustes em proxies ou CDNs externos ao h3.

## Premissas e riscos

### Premissas

- **P1 — Norma.** A referência é RFC 9110 (seções 13.1.5 e 14), que substitui a RFC 7233 citada na issue. Onde a issue e o pedido divergirem, vale o pedido.
- **P2 — Anúncio sem tamanho.** A issue pede `Accept-Ranges: bytes` sempre. Adotamos isso para todo asset encontrado, mesmo sem `size`. Apenas o tratamento do `Range` depende de `size` (RF-07). Essa é uma decisão de implementação, e pode ser revista.
- **P3 — Fatiamento na biblioteca.** Como `getContents` não recebe intervalo, o recorte é feito pelo `serveStatic` sobre o corpo devolvido.
- **P4 — Ordem de avaliação.** O fluxo atual continua: cabeçalhos de cache e 304 antes do `Range`, e o `Range` só altera a resposta 200 que seria enviada.
- **P5 — Sobrescrita do `Content-Length`.** Em 206 e 416, o `Content-Length` calculado pelo `Range` substitui o valor anterior. Hoje o código só define `Content-Length` quando ele ainda não existe.
- **P6 — Tamanho confiável.** `size` vindo de `getMeta` é o tamanho real da representação servida.

### Riscos

- **R1 — Desempenho com streams.** Sem parâmetro de intervalo, o início do stream precisa ser lido e descartado até `início`. Para arquivos grandes, isso custa leitura proporcional ao deslocamento. Mitigação: cancelar o stream logo após o fim do intervalo (RF-12). Se o custo for inaceitável, a solução correta é uma mudança em `getContents`, o que está fora de escopo.
- **R2 — Inconsistência de tamanho.** Se `size` não bater com o corpo real (arquivo alterado entre `getMeta` e `getContents`), `Content-Range` e `Content-Length` ficam errados. Mitigação: documentar a premissa P6.
- **R3 — Cache intermediário.** Respostas 200 e 206 do mesmo recurso compartilham ETag. Caches intermediários que não tratam `Range` podem misturar respostas. É o comportamento previsto pela RFC, mas precisa ser considerado em CDNs.
- **R4 — `If-Range` com data.** A comparação de data exige interpretar `Last-Modified` com a mesma precisão de segundos já usada em `last-modified` (linhas 227–237 de `static.ts`). Divergências de precisão podem fazer `If-Range` falhar sem motivo.
- **R5 — Testes existentes.** Algum teste atual pode depender de `200` com `Range` presente. Não foi verificado ainda; deve ser checado ao rodar `test/static.test.ts`.
- **R6 — Asset de tamanho zero.** Hoje `Content-Length` não é definido quando `size` é 0. Com `Range`, o caso passa a ser 416 (RF-06), e isso precisa de teste explícito.
- **R7 — Fluxo de bug.** `AGENTS.md` pede teste de regressão antes da correção para bugs. Esta é uma funcionalidade nova, mas recomenda-se escrever primeiro os testes de RF-02, RF-06 e RF-08, vendo-os falhar antes da implementação.
