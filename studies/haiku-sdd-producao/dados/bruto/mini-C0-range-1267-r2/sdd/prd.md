# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

O `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde `200` com o corpo inteiro e sem `Accept-Ranges`. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou recuar na mídia;
- CDNs e proxies não conseguem tratar o asset como parcialmente cacheável.

### Objetivo

Fazer o `serveStatic` atender pedidos de **um único intervalo de bytes** em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`). O comportamento segue a issue e a RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue.

A mudança é interna e retrocompatível:

- não há API pública nova;
- `ServeStaticOptions` e `StaticAssetMeta` não mudam;
- `src/index.ts` não ganha nenhum nome, nem valor nem tipo;
- as funções auxiliares ficam privadas no módulo.

### Métricas de sucesso

- Um cliente com `Range: bytes=0-99` recebe `206` com exatamente esses bytes.
- A suíte existente passa, com ajustes apenas nos testes que dependem do que mudou (por exemplo, a presença de `Accept-Ranges`), sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

Terminologia: "asset conhecido" é um asset encontrado por `getMeta` com `size` inteiro maior que zero. "Representação" é a variante efetivamente servida, já com o encoding escolhido, e `size` é o tamanho dela.

### RF-01 — Anunciar `Accept-Ranges: bytes`

O `serveStatic` anuncia suporte a ranges nas respostas de assets encontrados com tamanho conhecido.

**Critério de aceite**

- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`,
- **Então** a resposta é `200`, traz `Accept-Ranges: bytes`, e o corpo e os demais cabeçalhos são os de hoje.

### RF-02 — Responder `206` para um intervalo válido

Um único `byte-range-spec` satisfazível produz `206 Partial Content` com o trecho pedido.

Formas aceitas:

- `bytes=a-b`;
- `bytes=a-` (até o fim);
- `bytes=-n` (últimos `n` bytes).

O fim é limitado a `size - 1` quando excede o tamanho. O nome da unidade `bytes` é comparado sem diferenciar maiúsculas e minúsculas.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=100-199`,
- **Então** a resposta é `206`, com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo igual aos bytes 100 a 199.

Casos adicionais verificados por teste:

- `bytes=900-` devolve `bytes 900-999/1000`.
- `bytes=-100` devolve `bytes 900-999/1000`.
- `bytes=0-5000` devolve `bytes 0-999/1000`.
- `bytes=-5000` devolve o asset inteiro como `206` (`bytes 0-999/1000`).

### RF-03 — Cabeçalhos da resposta `206`

A resposta parcial mantém os metadados do asset e corrige os cabeçalhos de tamanho.

**Critério de aceite**

- **Dado** um asset com `etag`, `mtime`, tipo e encoding definidos, servido com `Range` válido,
- **Quando** a resposta `206` é montada,
- **Então** ela contém `Content-Range` e `Content-Length` com o tamanho do trecho (substituindo qualquer `Content-Length` de `options.headers`).
- **E** mantém `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary` e `Accept-Ranges: bytes`.

### RF-04 — `HEAD` com Range envia só cabeçalhos

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`,
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000` e `Content-Length: 100`, e o corpo vazio.
- **E** `getContents` não é chamado.

### RF-05 — Responder `416` para intervalo não satisfazível

Um único `byte-range-spec` sintaticamente válido, mas fora da representação, produz `416 Range Not Satisfiable`. Isso vale para:

- `a >= size` em `bytes=a-` ou `bytes=a-b`;
- `bytes=-0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=1000-` (ou `bytes=2000-3000`, ou `bytes=-0`),
- **Então** a resposta é `416`, com `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.
- **E** `getContents` não é chamado.
- **E** a resposta `416` mantém `Accept-Ranges: bytes`.

### RF-06 — Ignorar `Range` malformado, multi-range ou de unidade desconhecida

Nesses casos o servidor responde como se não houvesse `Range`: `200` com o corpo inteiro.

Casos ignorados:

- sintaxe inválida (`bytes=abc`, `bytes=5-2`, `bytes=`, `bytes 0-5`);
- mais de um intervalo (`bytes=0-1,5-9`);
- unidade diferente de `bytes`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,5-9` (ou `bytes=5-2`, ou `items=0-5`),
- **Então** a resposta é `200`, com o corpo inteiro e `Content-Length: 1000`, sem `Content-Range`.
- **E** `Accept-Ranges: bytes` continua presente.

### RF-07 — Tamanho desconhecido: sem suporte a Range

Se `size` é `undefined` ou não é positivo, o `Range` é ignorado, conforme a issue ("quando o tamanho é conhecido"). Isso preserva o comportamento atual, em que `size` zero ou ausente não gera `Content-Length`.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não devolve `size`,
- **Quando** o cliente envia `Range: bytes=0-9`,
- **Então** a resposta é `200` com o corpo inteiro, sem `Content-Range` e sem `Accept-Ranges`.

### RF-08 — Respeitar `If-Range`

O `If-Range` condiciona o `Range` à validade da representação (RFC 9110, 13.1.5).

- Com `ETag` forte igual ao `etag` do asset, o range é atendido.
- Com `ETag` diferente, ou fraco (`W/`), o range é ignorado e a resposta é `200` completa.
- Com data HTTP, o range é atendido somente se for igual ao `Last-Modified`, na precisão de segundos.
- Sem `etag` ou `mtime` para comparar, o range é ignorado.
- Um `If-Range` malformado faz o range ser ignorado.
- Um `If-Range` sem `Range` não tem efeito.

**Critério de aceite**

- **Dado** um asset com `etag: '"v1"'`,
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "v1"`,
- **Então** a resposta é `206`.
- **E** com `If-Range: "v2"`, a resposta é `200` com o corpo inteiro.

### RF-09 — Precedência das condicionais e `304`

Os validadores de cache continuam sendo avaliados antes do `Range` (RFC 9110, 13.2.2).

**Critério de aceite**

- **Dado** um asset com `etag`,
- **Quando** o cliente envia `If-None-Match` com o `etag` e também `Range: bytes=0-9`,
- **Então** a resposta é `304`, sem `Content-Range` e sem corpo, como hoje.

### RF-10 — Interação com encoding (precompressed)

O range se aplica à representação escolhida. Os bytes e o `size` são os da variante com encoding (por exemplo, `.gz`), e o `Content-Encoding` é preservado na resposta parcial. A seleção de encoding e o `Vary: accept-encoding` não mudam.

**Critério de aceite**

- **Dado** `encodings: { gzip: ".gz" }`, um cliente com `Accept-Encoding: gzip` e uma variante `.gz` de 500 bytes,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/500`, `Content-Encoding: gzip`, `Vary: accept-encoding` e os 100 primeiros bytes da variante `.gz`.

### RF-11 — Fatiar o corpo devolvido por `getContents`

O corpo fatiado corresponde exatamente ao intervalo, qualquer que seja o tipo de `BodyInit` que `getContents` devolva.

Tipos suportados:

- `string` (fatiada por bytes UTF-8);
- `Uint8Array` e `ArrayBuffer`;
- `Blob`;
- `ReadableStream` (descartando os bytes anteriores e encerrando após o fim do trecho).

**Critério de aceite**

- **Dado** um `getContents` que devolve, respectivamente, `string`, `Uint8Array`, `Blob` e `ReadableStream` com o mesmo conteúdo,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** o corpo da `206` tem os mesmos 4 bytes nos quatro casos.

Para tipos que não dão para fatiar com segurança (por exemplo `FormData` ou `URLSearchParams`), o `Range` é ignorado e a resposta é `200` completa.

### RF-12 — Preservar o comportamento existente

Nada do que existe hoje muda.

**Critério de aceite**

- **Dado** os testes atuais de `serveStatic`,
- **Quando** a suíte é executada,
- **Então** continuam valendo, mesmo que o teste seja ajustado apenas para aceitar o novo `Accept-Ranges`:
  - `404` para asset inexistente e para path não canônico;
  - `405` com `Allow: GET, HEAD` para métodos não permitidos;
  - `fallthrough` (retorna `undefined`, sem vazar `Vary` nem `Accept-Ranges`);
  - cache (`304`, `ETag`, `Last-Modified`);
  - `Content-Type`;
  - seleção de encoding e `indexNames`.
- **E** um pedido com `Range` para asset inexistente ou método não permitido responde `404`/`405` normalmente.

### RF-13 — Nenhuma exportação pública nova

**Critério de aceite**

- **Dado** o código alterado,
- **Quando** se compara `src/index.ts` e os tipos exportados antes e depois,
- **Então** não há nomes novos (nem valores nem tipos), e as funções auxiliares de Range ficam não exportadas, ou em `src/utils/internal/` sem reexportação.

## 3. Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): são ignorados, conforme RF-06.
- Unidades de range diferentes de `bytes`.
- `Range` em outros métodos além de `GET` e `HEAD`.
- Assets sem `size` conhecido (nenhuma tentativa de inferir o tamanho lendo o corpo).
- Cache de respostas parciais, ou mudanças em `handleCacheHeaders`, nas route rules ou em outros utilitários.
- Novas opções em `ServeStaticOptions` (por exemplo, um flag para desligar ranges) e alterações de `getMeta`/`getContents`. Quem implementa `getContents` continua devolvendo o corpo inteiro, e o fatiamento é feito pelo `serveStatic`.
- Otimização para ler só o trecho no backend (por exemplo, `fs.createReadStream` com `start`/`end`). Pode ser uma evolução futura, mas exigiria API nova.
- Compressão dinâmica, ou recompressão do trecho.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação efetivamente servida (a variante com encoding, quando for o caso). Se o backend informar um valor errado, o `Content-Range` ficará incorreto.
- `getContents` devolve o corpo completo da mesma representação descrita por `getMeta`.
- A RFC 9110 só define `Range` para `GET`. A issue pede `HEAD` também, e o resultado é coerente, porque `HEAD` deve devolver os mesmos cabeçalhos que o `GET` equivalente.
- `size: 0` é tratado como "desconhecido", como o código já faz para `Content-Length` (RF-07). Isso se afasta da RFC, que consideraria qualquer range de um corpo vazio como não satisfazível, mas preserva o comportamento atual.
- O `Accept-Ranges: bytes` só é enviado com `size` conhecido, para não anunciar um suporte que não se cumpre.

### Riscos

- **Fatiar streams e `string`:** para `ReadableStream`, é preciso descartar bytes sem acumular tudo na memória. Para `string`, o corte é em bytes UTF-8 e não em caracteres. Mitigação: testes com texto multibyte e com stream em vários chunks (RF-11).
- **Backends que ignoram o range:** o fatiamento acontece após `getContents`, então o ganho de I/O é nulo e só a banda é economizada. Aceito nesta entrega (ver "Fora de escopo").
- **`Content-Length` de `options.headers`:** o valor fixo do usuário precisa ser substituído nas respostas `206` e `416`. Hoje o código só define `content-length` quando ele não existe, e esse ponto precisa de atenção especial.
- **Adapter Node e `HEAD`/`416`:** o corpo vazio com `Content-Length` explícito deve funcionar nos modos `web` e `node` de `describeMatrix`. Mitigação: cobrir os dois modos nos testes.
- **Ordem das condicionais:** servir `206` antes de avaliar `304`, ou ignorar `If-Range` mal formado de forma errada, pode devolver conteúdo incorreto a caches. Mitigação: RF-08 e RF-09 com testes dedicados.
- **Testes existentes que comparam todos os cabeçalhos:** a presença de `Accept-Ranges` pode quebrá-los. Mitigação: ajustar só esses testes, mantendo o que verificam (RF-12).
- **Tamanho dos arquivos:** `static.ts` já tem cerca de 350 linhas, e a convenção do projeto é manter arquivos curtos. Mitigação: colocar a lógica de Range em um módulo interno (`src/utils/internal/`) sem reexportá-lo.
