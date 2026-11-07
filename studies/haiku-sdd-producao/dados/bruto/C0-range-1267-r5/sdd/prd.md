# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

O `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads grandes não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia (eles enviam `Range` automaticamente);
- CDNs e proxies não conseguem tratar o asset de forma eficiente.

### Objetivo

Fazer o `serveStatic` atender pedidos de **um único intervalo de bytes** em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`), conforme a RFC 9110 (seções 13.1.5 — `If-Range` — e 14 — Range Requests), que substitui a RFC 7233 citada na issue.

A mudança é interna e retrocompatível: sem novas opções, sem novas exportações públicas. Cache, seleção de encoding, `fallthrough` e as respostas 404/405 continuam como hoje.

### Definições

- **Tamanho (`size`)**: `meta.size` do asset escolhido por `getMeta`. Considera-se "conhecido" quando é um número inteiro maior ou igual a zero. Para uma variante pré-comprimida, é o tamanho dos bytes dessa variante.
- **Representação selecionada**: os bytes que seriam enviados num `200` (já com o encoding escolhido). O intervalo se aplica a esses bytes.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` envia `Accept-Ranges: bytes` nas respostas de asset encontrado para `GET` e `HEAD` (`200`, `206` e `416`). Não é enviado em `304`, `404`, `405` nem em fallthrough.

**Critério de aceite**
- **Dado** um asset existente com `size` conhecido, sem `Range` na requisição,
- **Quando** o cliente faz `GET` ou `HEAD` nesse asset,
- **Então** a resposta é `200` com `Accept-Ranges: bytes`, e o corpo e os demais cabeçalhos continuam iguais aos de hoje.

### RF-02 — Intervalo único válido responde 206

Para um `Range: bytes=...` com um único intervalo satisfatível (`a-b`, `a-` ou `-n`), responde `206 Partial Content` apenas com os bytes pedidos, com `Content-Range: bytes <início>-<fim>/<size>` e `Content-Length` igual ao número de bytes enviados. Regras de interpretação (RFC 9110 §14.1.2 e §14.4):

- `a-b`: se `b >= size`, o fim é limitado a `size - 1`;
- `a-`: do byte `a` até o fim;
- `-n`: os últimos `n` bytes; se `n >= size`, devolve a representação inteira como `206` (`0-(size-1)`);
- o nome da unidade (`bytes`) não diferencia maiúsculas de minúsculas e aceita espaços opcionais ao redor.

`Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary` e os cabeçalhos de `options.headers` continuam presentes. O `Content-Length` calculado para o intervalo prevalece sobre um `content-length` que já esteja em `event.res.headers`.

**Critério de aceite**
- **Dado** um asset de 18 bytes com `size: 18`,
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, o corpo tem exatamente os bytes 2 a 5, `Content-Range` é `bytes 2-5/18` e `Content-Length` é `4`. As variações `bytes=10-`, `bytes=-4` e `bytes=10-999` devolvem `bytes 10-17/18`, `bytes 14-17/18` e `bytes 10-17/18`.

### RF-03 — HEAD com intervalo envia só os cabeçalhos

Um `HEAD` com `Range` válido recebe os mesmos status e cabeçalhos que o `GET` equivalente (`206`, `Content-Range`, `Content-Length` do intervalo), sem corpo. O `HEAD` com intervalo insatisfatível recebe os mesmos cabeçalhos do `416` (RF-04).

**Critério de aceite**
- **Dado** um asset de 18 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta é `206` com `Content-Range: bytes 2-5/18` e `Content-Length: 4`, e o corpo é vazio. `getContents` não é chamado.

### RF-04 — Intervalo insatisfatível responde 416

Quando o único intervalo, sintaticamente válido, não pode ser satisfeito (primeiro byte `>= size`, `-0`, ou qualquer intervalo sobre asset de tamanho 0), responde `416 Range Not Satisfiable` com `Content-Range: bytes */<size>`, `Content-Length: 0` e corpo vazio. Mantém `Accept-Ranges: bytes`. Não envia `Content-Type` do asset nem `Content-Encoding`, porque não há representação no corpo.

**Critério de aceite**
- **Dado** um asset de 18 bytes,
- **Quando** o cliente faz `GET` com `Range: bytes=18-` (ou `bytes=100-200`, ou `bytes=-0`),
- **Então** a resposta é `416`, com `Content-Range: bytes */18`, `Content-Length: 0` e corpo vazio.

### RF-05 — Range malformado, multi-intervalo ou de outra unidade é ignorado

Nesses casos o `Range` é ignorado e a resposta é o `200` completo de hoje (com `Accept-Ranges: bytes`):

- sintaxe inválida (`bytes=abc`, `bytes=`, `bytes=5`, `bytes=--1`, números com sinal ou decimais);
- `a-b` com `b < a` (RFC 9110 §14.1.2: sintaxe inválida);
- mais de um intervalo (`bytes=0-1,4-5`);
- unidade diferente de `bytes`;
- números grandes demais para representar com segurança (não gerar 416 nem 206 com valores incorretos).

**Critério de aceite**
- **Dado** um asset de 18 bytes,
- **Quando** o cliente faz `GET` com `Range: bytes=0-1,4-5` (ou `bytes=5-2`, `items=0-1`, `bytes=abc`),
- **Então** a resposta é `200`, com o corpo completo e `Content-Length: 18`, sem `Content-Range`.

### RF-06 — Respeitar If-Range

Se a requisição trouxer `If-Range` junto com `Range`, o intervalo só é atendido quando a condição valer (RFC 9110 §13.1.5):

- validador `ETag`: comparação **forte**; um `ETag` fraco (`W/...`), seja o do cliente ou o do asset, não confere;
- validador data: confere somente se for idêntica ao `Last-Modified` enviado na resposta (precisão de segundos);
- se a condição falhar, ou o asset não tiver o validador correspondente, a resposta é o `200` completo.

`If-Range` sem `Range` é ignorado.

**Critério de aceite**
- **Dado** um asset com `etag: '"abc"'` e `size: 18`,
- **Quando** o cliente faz `GET` com `Range: bytes=0-3` e `If-Range: "abc"`, e depois com `If-Range: "outro"` (e outra vez com `If-Range: W/"abc"`),
- **Então** o primeiro pedido recebe `206` com `Content-Range: bytes 0-3/18`; o segundo e o terceiro recebem `200` com o corpo completo.

### RF-07 — Convivência com cache condicional (304)

A avaliação de `If-None-Match` / `If-Modified-Since` continua antes do processamento de `Range`: se hoje a resposta seria `304`, continua `304` (sem `Content-Range`, sem corpo), mesmo com `Range` presente.

**Critério de aceite**
- **Dado** um asset com `etag: '"abc"'`,
- **Quando** o cliente faz `GET` com `If-None-Match: "abc"` e `Range: bytes=0-3`,
- **Então** a resposta é `304`, sem corpo e sem `Content-Range`.

### RF-08 — Convivência com seleção de encoding

Com `encodings` configurado, o `Range` se aplica à variante escolhida (por exemplo `.gz` ou `.br`), usando o `size` dessa variante. A resposta `206` mantém `Content-Encoding` e `Vary: accept-encoding` já existentes. A escolha da variante não muda por causa do `Range`.

**Critério de aceite**
- **Dado** `encodings: { gzip: ".gz" }` e um `file.txt.gz` com `size: 30`,
- **Quando** o cliente faz `GET /file.txt` com `Accept-Encoding: gzip` e `Range: bytes=0-9`,
- **Então** a resposta é `206` com os 10 primeiros bytes do `.gz`, `Content-Range: bytes 0-9/30`, `Content-Encoding: gzip`, `Content-Type` de `file.txt` e `Vary: accept-encoding`.

### RF-09 — Tamanho desconhecido: sem suporte a intervalo

Se `getMeta` não devolver `size` numérico (inteiro ≥ 0), o `Range` é ignorado e a resposta é a de hoje (`200` completo). O comportamento do `Content-Length` para `size` indefinido ou `0` permanece como hoje.

**Critério de aceite**
- **Dado** um asset sem `size` em `getMeta`,
- **Quando** o cliente faz `GET` com `Range: bytes=0-3`,
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`.

### RF-10 — Não alterar o que já existe

- Asset inexistente: `404`, ou retorno `undefined` com `fallthrough`; `Range` não muda isso.
- Método diferente de `GET`/`HEAD`: `405` com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`); `Range` não muda isso.
- Caminho não canônico continua recusado.
- Pedidos sem `Range` continuam recebendo `200` com os mesmos cabeçalhos de hoje, mais `Accept-Ranges: bytes`.
- Nenhuma exportação nova em `src/index.ts` (valores ou tipos). Os auxiliares (parser de `Range`, avaliação de `If-Range`, fatiamento do corpo) ficam privados em `src/utils/static.ts`, na seção `Internal Utils`.
- `ServeStaticOptions` e `StaticAssetMeta` não ganham campos.

**Critério de aceite**
- **Dado** a suíte existente (`test/static.test.ts`, `test/security.test.ts`, `test/unit/package.test.ts`),
- **Quando** `pnpm vitest run` e `pnpm lint` (incluindo typecheck) rodam depois da mudança,
- **Então** tudo passa. Só os testes que verificam o conjunto exato de cabeçalhos podem mudar, e apenas para acomodar `Accept-Ranges`. O teste de API pública continua verde sem nomes novos.

### RF-11 — Fatiamento do corpo sem carregar tudo

O corpo de um `206` contém somente os bytes do intervalo, para os tipos de `BodyInit` que `getContents` pode devolver (string, `Uint8Array`/`ArrayBuffer`, `Blob`/`File`, `ReadableStream`). Se `getContents` devolver `null`/`undefined` para um asset que existe, o comportamento de hoje (corpo vazio) é mantido, sem `206` com `Content-Length` inconsistente.

**Critério de aceite**
- **Dado** `getContents` devolvendo, em testes separados, uma string, um `Uint8Array`, um `Blob` e um `ReadableStream` com o mesmo conteúdo,
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`,
- **Então** em todos os casos o corpo recebido tem exatamente os bytes 2 a 5, e o tamanho do corpo é igual ao `Content-Length`.

## 3. Fora de escopo

- Múltiplos intervalos e `multipart/byteranges` (são ignorados, RF-05).
- Unidades de intervalo diferentes de `bytes`.
- Novas opções em `ServeStaticOptions`, novos campos em `StaticAssetMeta` ou qualquer exportação pública nova.
- Intervalos em outros utilitários (`proxy`, `serveStatic` de terceiros, `event-stream`, route rules).
- Compressão sob demanda ou alteração da lógica de seleção de encoding.
- Suporte a `Range` quando o tamanho é desconhecido (por exemplo, calcular o tamanho lendo o corpo).
- Mudança nas regras de cache (`ETag`, `Last-Modified`, `304`) além da ordem descrita em RF-07.
- Mudanças em backends concretos de `getMeta`/`getContents` (sistema de arquivos, S3 etc.); eles continuam entregando o corpo inteiro, e o fatiamento ocorre no `serveStatic`.

## 4. Premissas e riscos

### Premissas

- `meta.size` reflete o número real de bytes que `getContents(id)` entrega para o mesmo `id` (inclusive para a variante pré-comprimida). É a premissa já usada hoje para `Content-Length`.
- Seguir a RFC 9110 prevalece sobre a RFC 7233 citada na issue quando houver diferença; a `7233` está obsoleta.
- `Accept-Ranges: bytes` é anunciado para qualquer asset encontrado em `GET`/`HEAD`, como pede a issue ("Always advertise"), e não só quando o tamanho é conhecido.
- Os testes seguem o padrão de `describeMatrix` (modos `web` e `node`) e a política do projeto para correção: teste que reproduz primeiro, depois a implementação mínima.

### Riscos

- **Anúncio sem suporte (tamanho desconhecido):** anunciar `Accept-Ranges: bytes` e depois ignorar o `Range` por falta de `size` é permitido pela RFC (o servidor pode responder `200`), mas pode levar o cliente a tentar retomadas que sempre recebem o corpo inteiro. Mitigação possível: anunciar só com `size` conhecido, se a issue permitir. Decisão pendente do solicitante.
- **Fatiamento de streams:** para `ReadableStream`, o servidor descarta os bytes anteriores ao início do intervalo, o que custa leitura mesmo sem enviá-los. Backends que sabem ler por posição (arquivos) teriam ganho com uma opção futura, hoje fora de escopo.
- **`size` incorreto:** um `size` maior ou menor que o corpo real produziria `206` ou `416` inconsistentes. É a mesma fragilidade do `Content-Length` atual.
- **`content-length` pré-definido pelo usuário:** hoje ele prevalece (teste existente). Em `206`/`416` o valor correto do intervalo deve prevalecer, o que é uma mudança deliberada de comportamento nesse caso. Em `200` o comportamento de hoje continua.
- **Testes de cabeçalhos exatos:** testes que comparam todos os cabeçalhos podem falhar por causa do novo `Accept-Ranges`; devem ser ajustados sem perder o que verificam.
- **Cabeçalhos duplicados em respostas anteriores:** como `event.res.headers` já pode ter valores de `options.headers` ou de middleware, `Accept-Ranges` e `Content-Range` devem ser definidos com `set`, não `append`, para evitar valores duplicados.
- **Compatibilidade entre runtimes:** o fatiamento deve usar apenas APIs web padrão (`Blob.slice`, `TextEncoder`, streams), para funcionar em Node, Bun, Deno e Workers.
