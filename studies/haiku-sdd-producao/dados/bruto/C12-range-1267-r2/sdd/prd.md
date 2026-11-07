# PRD: suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 · Módulo: `src/utils/static.ts` · Norma: RFC 9110, §13.1.5 (If-Range) e §14 (Range Requests)

## Problema e objetivo

Hoje o `serveStatic` ignora o cabeçalho `Range`. Um cliente que pede um trecho recebe o arquivo inteiro com `200 OK`, sem nenhum cabeçalho de conteúdo parcial. Com isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) sem baixar tudo antes;
- CDNs e proxies não conseguem tratar o asset de forma parcial.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110, sem mudar a API pública, sem quebrar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Escopo de referência para o engenheiro

Todas as respostas abaixo referem-se a um asset **encontrado** por `getMeta`, a não ser que o requisito diga o contrário. "Tamanho conhecido" significa que `getMeta` devolveu `size` como número. "Variante selecionada" é o arquivo escolhido por `encodings` e `accept-encoding`, cujo `size` vem de `getMeta` para aquele `id`.

## Requisitos funcionais

### RF-01 — Anunciar `Accept-Ranges: bytes`

Quando o asset é encontrado e tem tamanho conhecido, toda resposta do `serveStatic` (200, 206, 304 e 416, para GET e HEAD) deve incluir `accept-ranges: bytes`. Quando o tamanho é desconhecido, o cabeçalho não é enviado.

**Critério de aceite**

- **Dado** um asset com `getMeta` retornando `size: 10` e uma requisição `GET` sem `Range`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `200` com `accept-ranges: bytes`, e o corpo é o arquivo completo.

### RF-02 — Responder `206 Partial Content` para um intervalo válido

Quando a requisição `GET` contém um intervalo válido e satisfazível (RF-03), a resposta é `206` com:

- `content-range: bytes <início>-<fim>/<tamanho>`;
- `content-length` igual a `fim - início + 1`;
- corpo com exatamente os bytes do intervalo.

Para `HEAD`, a resposta tem os mesmos cabeçalhos e corpo vazio. `getContents` não é chamado em `HEAD`.

**Critério de aceite**

- **Dado** um asset de 10 bytes com conteúdo `0123456789` e uma requisição `GET` com `Range: bytes=2-4`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `206`, `content-range` é `bytes 2-4/10`, `content-length` é `3` e o corpo é `234`.

### RF-03 — Formas de intervalo e ajuste de limites

O único conjunto de intervalos aceito por uma requisição com um intervalo tem três formas:

- `bytes=a-b`: do byte `a` até o byte `b`, inclusive;
- `bytes=a-`: do byte `a` até o fim;
- `bytes=-n`: os últimos `n` bytes.

Regras:

- se `b` ≥ tamanho, o fim é ajustado para `tamanho - 1`;
- se `n` > tamanho, o intervalo é o arquivo inteiro (`bytes 0-(tamanho-1)/tamanho`), com `206`;
- se `a` ≥ tamanho, o intervalo não é satisfazível (RF-04).

**Critério de aceite**

- **Dado** um asset de 10 bytes e três requisições `GET`, com `Range: bytes=7-100`, `Range: bytes=-3` e `Range: bytes=-50`,
- **Quando** o `serveStatic` responde às três,
- **Então** as respostas são `206` com `content-range` `bytes 7-9/10`, `bytes 7-9/10` e `bytes 0-9/10`, nessa ordem.

### RF-04 — Responder `416 Range Not Satisfiable`

Quando o intervalo é sintaticamente válido, mas não é satisfazível (`a` ≥ tamanho, ou `bytes=-0`, ou qualquer intervalo para um asset de tamanho 0), a resposta é `416` com:

- `content-range: bytes */<tamanho>`;
- `content-length: 0`;
- corpo vazio.

`getContents` não é chamado nesse caso.

**Critério de aceite**

- **Dado** um asset de 10 bytes e uma requisição `GET` com `Range: bytes=10-20`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `416`, `content-range` é `bytes */10`, `content-length` é `0`, o corpo está vazio e `getContents` não foi chamado.

### RF-05 — Ignorar `Range` que não se entende

O `serveStatic` ignora o cabeçalho `Range` e responde `200` com o arquivo completo, como hoje, nos casos abaixo. Nenhum deles gera `416` ou erro.

- unidade diferente de `bytes` (por exemplo, `items=0-1`);
- mais de um intervalo na lista (por exemplo, `bytes=0-1,4-5`);
- sintaxe inválida (por exemplo, `bytes=abc`, `bytes=`, `bytes=1`, `bytes=-`);
- intervalo com início maior que o fim (`bytes=5-2`);
- espaços e tabulações ao redor do `=`, da vírgula e dos números são tolerados nos casos válidos, e um cabeçalho que não bate com a gramática acima é ignorado.

**Critério de aceite**

- **Dado** um asset de 10 bytes e uma requisição `GET` com `Range: bytes=0-1,4-5`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `200`, sem `content-range`, com o corpo completo de 10 bytes.

### RF-06 — Validar com `If-Range`

Quando a requisição tem `If-Range` e `Range`, o intervalo só é honrado se a condição de `If-Range` for verdadeira. Caso contrário, `Range` é ignorado e a resposta é `200` completa.

- Se `If-Range` é um ETag: a condição é verdadeira só se o ETag do asset for **forte** e idêntico (comparação forte, RFC 9110 §13.1.5). ETag fraco, no `If-Range` ou no asset, nunca é igual.
- Se `If-Range` é uma data HTTP: a condição é verdadeira só se for **exatamente** igual ao `last-modified` que o `serveStatic` envia. Sem `last-modified`, a condição é falsa.
- Se não há `Range`, `If-Range` é ignorado.

**Critério de aceite**

- **Dado** um asset com ETag forte `"v1"` e `Last-Modified` `Mon, 01 Jan 2024 00:00:00 GMT`, e uma requisição `GET` com `Range: bytes=0-3` e `If-Range: W/"v1"`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `200` completa, sem `content-range`.

### RF-07 — Precedência de `304` sobre `Range`

As validações de cache que já existem (`If-None-Match` e `If-Modified-Since`) são feitas antes de qualquer tratamento de `Range`. Se elas resultam em `304`, a resposta é `304` e `Range` não é avaliado.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"` e uma requisição `GET` com `Range: bytes=0-3` e `If-None-Match: "v1"`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `304`, sem corpo, sem `content-range` e sem `content-length` de intervalo.

### RF-08 — Tamanho desconhecido

Se `getMeta` não devolve `size` (ou devolve algo que não é número), o `serveStatic` ignora `Range`, responde `200` completo e não envia `accept-ranges`.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não devolve `size` e uma requisição `GET` com `Range: bytes=0-3`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `200` completa, sem `accept-ranges` e sem `content-range`.

### RF-09 — Intervalo sobre a variante codificada

O intervalo é aplicado aos bytes da variante selecionada (por exemplo, `app.js.gz` quando `gzip` é aceito). `content-encoding` da variante é preservado no `206` e no `416`, e `content-range` e `content-length` usam o tamanho dessa variante.

**Critério de aceite**

- **Dado** um asset `app.js` com uma variante `app.js.gz` de 6 bytes (`getMeta` devolve `size: 6` e `encoding: "gzip"` para esse `id`), `encodings: { gzip: ".gz" }`, e uma requisição `GET` com `accept-encoding: gzip` e `Range: bytes=0-1`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `206`, `content-range` é `bytes 0-1/6`, `content-encoding` é `gzip` e o corpo são os dois primeiros bytes de `app.js.gz`.

### RF-10 — Corpo idêntico ao da resposta `200`

Para qualquer tipo de corpo aceito por `getContents` (`string`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`, e os demais `BodyInit` que `Response` aceita), os bytes do `206` são exatamente os bytes do intervalo do corpo que o mesmo pedido teria na resposta `200`. Quando o corpo é um `ReadableStream`, os bytes antes do início são lidos e descartados, e a leitura para ao chegar no fim do intervalo.

**Critério de aceite**

- **Dado** um `getContents` que devolve um `ReadableStream` com os bytes `0123456789` em dois chunks, e uma requisição `GET` com `Range: bytes=3-6`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `206` com corpo `3456`.

### RF-11 — Preservar o comportamento existente

Sem `Range`, nada muda em relação ao comportamento atual. Em particular:

- `options.headers`, `etag`, `last-modified`, `content-type`, `content-encoding` e `vary` seguem a regra atual de não sobrescrever cabeçalhos já definidos. Exceção: `content-length` e `content-range` de `206` e `416` são sempre definidos pelo intervalo;
- `fallthrough` e a resposta de asset inexistente (404) seguem como hoje;
- método diferente de `GET` e `HEAD` continua com `405` e `allow: GET, HEAD`, mesmo com `Range`;
- o caminho não canônico continua sem ser servido (404, ou `fallthrough`);
- a seleção de `index.html`, o `vary: accept-encoding` e o cache (`304`) não mudam.

**Critério de aceite**

- **Dado** um `serveStatic` com `headers: { "cache-control": "public, max-age=60" }` e uma requisição `DELETE` com `Range: bytes=0-1`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é `405` com `allow: GET, HEAD`, e não há `content-range` nem `accept-ranges`.

### RF-12 — Sem novas exportações públicas

`src/index.ts` não ganha nenhum nome novo (valor ou tipo). `ServeStaticOptions` e `StaticAssetMeta` não ganham campos. A lógica de `Range` fica em funções privadas do próprio `src/utils/static.ts`.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara as exportações de `src/index.ts` e de `src/utils/static.ts` com as da versão anterior,
- **Então** a lista de exportações é a mesma, e as interfaces de `ServeStaticOptions` e `StaticAssetMeta` não mudaram.

### RF-13 — Testes e qualidade

Os testes novos ficam em `test/static.test.ts` (ou em arquivo irmão, se o engenheiro justificar) e usam `describeMatrix`, rodando em `web` e `node`. Cada regra das seções RF-02 a RF-10 tem pelo menos um teste. A suíte existente passa. Testes existentes só são ajustados quando dependem de cabeçalhos que a mudança altera (por exemplo, `accept-ranges` em `toEqual` de cabeçalhos), sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** se roda `pnpm vitest run test/static.test.ts` e `pnpm lint`,
- **Então** todos os testes passam nos alvos `web` e `node`, e o lint e a checagem de tipos terminam sem erro.

## Fora de escopo

- **Múltiplos intervalos** (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` completo (RF-05).
- **Outras unidades de intervalo** além de `bytes`.
- **`If-Match` e `If-Unmodified-Since`** e a resposta `412`. Continuam sem tratamento.
- **Opção para desligar o suporte a Range** (`ServeStaticOptions`). Não há nova opção (RF-12).
- **Mudança na assinatura de `getMeta` ou `getContents`**, por exemplo passar o intervalo como argumento para o backend. O recorte é feito em cima do corpo que `getContents` já devolve.
- **Otimização de leitura parcial no backend** (ler só o trecho do disco). O `serveStatic` pode ler e descartar bytes de um `ReadableStream`; a otimização fica para quem implementa `getContents`.
- **Validação de consistência** entre `size` de `getMeta` e o número real de bytes de `getContents`. O framework confia em `size`.
- **Cache de respostas parciais** em proxies e CDNs, incluindo `vary` extra. Não há mudança no `vary`.
- **Arquivos de `h3/rules/cache` e `h3/rules/proxy`**. Não são alterados.
- **Mudanças em `src/index.ts`, em outras utilidades ou em `_entries/`**.

## Premissas e riscos

### Premissas

- **P1.** A RFC 9110 vale no lugar da RFC 7233 citada na issue (o contrato enxuto em `sdd/pedido.md` já define isso).
- **P2.** `getMeta` devolve `size` do mesmo arquivo que `getContents` vai devolver para aquele `id`. O framework não verifica isso.
- **P3.** Decidimos que `accept-ranges` só aparece quando o tamanho é conhecido, porque anunciar suporte a Range sem poder atendê-lo seria mentira para o cliente. A issue pede "sempre"; esta é a interpretação escolhida, e está em RF-01 e RF-08.
- **P4.** Decidimos que `content-length` e `content-range` de `206` e `416` sobrescrevem qualquer valor já definido (inclusive por `options.headers`), porque um `content-length` do arquivo inteiro numa resposta parcial quebra o cliente. Isso muda a regra atual de "não sobrescrever" e está em RF-11.
- **P5.** O comportamento de `If-Range` com data segue a exatidão (igual ao `last-modified` enviado), não o "posterior a". É o que a RFC 9110 §13.1.5 pede para a forma de data.

### Riscos

- **R1. Custo em streams.** Sem um parâmetro de intervalo em `getContents`, um `ReadableStream` precisa ser lido desde o início. Para arquivos grandes e intervalos no fim, isso é lento. A mitigação é documentar que o desempenho ideal depende de `Blob` ou de um backend que sabe fatiar. Se isso bloquear o uso em mídia, abrir uma issue para uma assinatura nova de `getContents`, fora deste PRD.
- **R2. `getContents` que devolve `null` com `size > 0`.** Hoje esse caso vira corpo vazio com `200`. Com `Range`, o `206` anunciaria bytes que não existem. O engenheiro deve tratar esse caso como corpo vazio e não inventar bytes; o teste de RF-02 não cobre isso, e vale um teste de regressão.
- **R3. Ajuste de testes existentes.** Asserções de cabeçalhos exatos (`toEqual`) em `test/static.test.ts` podem quebrar com o novo `accept-ranges`. Ajustar só o necessário (RF-13).
- **R4. Caches e `Vary`.** Um `206` guardado num cache compartilhado pode ser servido para um pedido sem `Range`. A RFC permite isso, mas o `vary` atual não cobre `range`. Mantemos fora de escopo (ver Fora de escopo) e deixamos documentado.
- **R5. Ordem de avaliação.** Quem implementar pode ser tentado a tratar `Range` antes do cache. RF-07 proíbe isso; o teste de `304` é obrigatório.
- **R6. Diferença de plataforma.** `Blob`, `ReadableStream` e `Response` se comportam de forma um pouco diferente em Node e nos runtimes web. A matriz `describeMatrix` deve cobrir isso.
