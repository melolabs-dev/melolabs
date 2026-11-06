# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads grandes não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou recuar na mídia (eles enviam `Range` automaticamente);
- CDNs e proxies não conseguem tratar o asset como parcialmente cacheável.

### Objetivo

Fazer o `serveStatic` atender pedidos de intervalo de bytes de forma compatível com a RFC 9110, seções 13.1.5 (`If-Range`) e 14 (Range Requests), que substitui a RFC 7233 citada na issue. A mudança é interna e retrocompatível: sem novas opções, sem novas exportações e sem alterar o comportamento de requisições que não usam `Range`.

### Métricas de sucesso

- Um cliente que envia `Range: bytes=a-b` válido recebe `206` com exatamente os bytes pedidos.
- Nenhum teste existente perde cobertura; `pnpm lint`, `pnpm typecheck` e a suíte completa passam.
- `src/index.ts` não ganha nenhum nome novo.

## 2. Requisitos funcionais

Convenções: "tamanho" é o `size` devolvido por `getMeta` para o asset efetivamente escolhido (já considerando a variante pré-comprimida). Intervalos são sempre sobre os bytes da representação servida, isto é, depois da seleção de encoding. "Range elegível" é um `Range` que passou pelos RF-01 a RF-03 e pelo RF-07.

### RF-01 — Anunciar suporte a intervalos

Quando o asset é encontrado, o método é GET ou HEAD e o tamanho é conhecido (`size` definido e maior que 0), a resposta inclui `Accept-Ranges: bytes`.

**Critério de aceite**

- **Dado** um asset com `size: 100`
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`
- **Então** a resposta é `200` com `Accept-Ranges: bytes`, corpo e demais cabeçalhos idênticos aos de hoje.

### RF-02 — Intervalo único válido responde 206

Um `Range` com unidade `bytes` e uma única especificação de intervalo, satisfazível, é atendido com `206 Partial Content`. São aceitas as três formas: `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-n` (últimos `n` bytes). Se `b` for maior ou igual ao tamanho, o fim é limitado a `tamanho - 1`. Se `n` for maior que o tamanho, o intervalo cobre o asset inteiro. A resposta traz `Content-Range: bytes início-fim/tamanho` e `Content-Length` igual ao número de bytes do trecho (substituindo qualquer `content-length` definido antes, inclusive o de `options.headers`). O corpo contém somente os bytes do trecho.

**Critério de aceite**

- **Dado** um asset de 10 bytes com conteúdo `0123456789`
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`
- **Então** a resposta é `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo `2345`; e `bytes=7-` retorna `789` com `Content-Range: bytes 7-9/10`, `bytes=-3` retorna `789` com o mesmo `Content-Range` e `bytes=8-99` retorna `89` com `Content-Range: bytes 8-9/10`.

### RF-03 — Range malformado, multi-intervalo ou de outra unidade é ignorado

Se o `Range` for sintaticamente inválido, tiver unidade diferente de `bytes`, contiver mais de um intervalo (vírgula) ou tiver início maior que fim (`bytes=5-2`), ele é ignorado e a resposta é a completa (`200`), como se o cabeçalho não existisse. Nenhum erro é lançado.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-1,4-5`, `Range: bytes=abc`, `Range: items=0-1` ou `Range: bytes=5-2`
- **Então** cada resposta é `200` com o corpo inteiro, sem `Content-Range`, e `Content-Length: 10`.

### RF-04 — Intervalo insatisfazível responde 416

Um `Range` bem formado de um único intervalo cujo início é maior ou igual ao tamanho (ou um sufixo `bytes=-0`) é insatisfazível. A resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */tamanho`, `Content-Length: 0` e corpo vazio. Os cabeçalhos de validação e de cache já definidos (`ETag`, `Last-Modified`, `Vary`) são preservados; `Content-Type` e `Content-Encoding` do asset não são aplicados a uma resposta sem corpo.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=10-` (ou `bytes=50-60`, ou `bytes=-0`)
- **Então** a resposta é `416`, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio.

### RF-05 — HEAD com Range devolve apenas cabeçalhos

Para `HEAD`, o `Range` é avaliado com as mesmas regras de GET (RF-02 a RF-04), com os mesmos status e cabeçalhos que o GET teria, mas sem corpo e sem chamar `getContents`.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`
- **Então** a resposta é `206` com `Content-Range: bytes 2-5/10`, `Content-Length: 4`, corpo vazio, e `getContents` não é invocado.

### RF-06 — `If-Range` condiciona o Range (RFC 9110 §13.1.5)

Se a requisição trouxer `If-Range` junto de um `Range` elegível, o intervalo só é atendido quando o validador casar com a representação atual:

- ETag: casa apenas por comparação forte, isto é, o valor é igual ao `etag` do asset e nenhum dos dois é fraco (`W/`);
- data HTTP: casa apenas se for exatamente igual ao `Last-Modified` da resposta (igualdade, não "mais antigo que").

Se não casar, se o asset não tiver validador correspondente ao tipo enviado, ou se o valor for inválido, o `Range` é ignorado e a resposta é `200` completa. `If-Range` sem `Range` é ignorado.

**Critério de aceite**

- **Dado** um asset de 10 bytes com `etag: "abc"` e `mtime` conhecido
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`
- **Então** recebe `206`; com `If-Range: "outro"`, ou `If-Range: W/"abc"`, ou uma data diferente do `Last-Modified`, recebe `200` completo; e `If-Range` sem `Range` produz o `200` normal.

### RF-07 — Precedência com requisições condicionais e cache

A verificação de cache existente (`isCacheMatch`, que gera `304`) continua sendo avaliada antes do Range: se o resultado for `304`, ele prevalece e `Range` não é considerado. O Range só é avaliado para o que seria uma resposta `200`. A seleção de encoding, o `Vary: accept-encoding` e os cabeçalhos `ETag`/`Last-Modified` seguem como hoje e aparecem também em `206` e `416`.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"` e `encodings: { gzip: ".gz" }`
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-3`
- **Então** a resposta é `304` sem `Content-Range`; e, sem `If-None-Match`, `Range: bytes=0-3` com `Accept-Encoding: gzip` retorna `206` da variante `.gz` (com `Content-Encoding: gzip`, `Vary: accept-encoding` e `Content-Range` baseado no `size` da variante).

### RF-08 — Corpo parcial para os tipos de `BodyInit` suportados

O trecho é extraído do valor devolvido por `getContents` sem carregar o asset inteiro quando o tipo permitir: `string` (em bytes UTF-8), `Blob`/`File`, `ArrayBuffer`, `TypedArray`/`DataView`, `ReadableStream` (descartando os bytes iniciais e encerrando no fim do intervalo). Para tipos de `BodyInit` que não permitem fatiar com segurança (por exemplo `FormData` ou `URLSearchParams`), ou quando `getContents` devolve vazio, o servidor responde `200` completo, sem `Content-Range`.

**Critério de aceite**

- **Dado** um `getContents` que devolve, em casos separados, `string`, `Uint8Array`, `Blob` e `ReadableStream` com os mesmos 10 bytes
- **Quando** o cliente envia `Range: bytes=2-5`
- **Então** todos respondem `206` com corpo `2345`; e se `getContents` devolver `null`, a resposta continua sendo a de hoje (`200`, corpo vazio).

### RF-09 — Preservar comportamentos existentes

Sem `Range` (ou com `Range` ignorado), a resposta é byte a byte a de hoje. Continuam como estão: `405` com `Allow: GET, HEAD` para outros métodos (ou retorno `undefined` com `fallthrough`), `404`/`fallthrough` para asset inexistente ou caminho não canônico, `304`, seleção de encoding, `options.headers`, `Content-Type` e `Content-Length`. Nenhum desses caminhos avalia `Range`. Asset sem `size` conhecido (ou `size` 0) não suporta intervalos: `Range` é ignorado e `Accept-Ranges` não é enviado.

**Critério de aceite**

- **Dado** a suíte existente de `test/static.test.ts` e um asset sem `size`
- **Quando** ela é executada e um `Range: bytes=0-1` é enviado ao asset sem `size`
- **Então** todos os testes existentes passam (alterando apenas asserções que dependam de `Accept-Ranges`, sem perder o que verificam) e o asset sem `size` responde `200` completo, sem `Accept-Ranges` nem `Content-Range`.

### RF-10 — Nenhuma exportação pública nova

As funções auxiliares (parse de `Range`, avaliação de `If-Range`, fatiamento do corpo) ficam privadas ao módulo, sem `export` e sem nomes novos em `src/index.ts` (valores ou tipos). `ServeStaticOptions` e `StaticAssetMeta` não mudam.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** se compara a lista de exports de `src/index.ts` e de `src/utils/static.ts` com a original
- **Então** não há nomes novos, e `pnpm lint` e `pnpm typecheck` passam.

### RF-11 — Cobertura de testes

`test/static.test.ts` ganha testes (via `describeMatrix`, em modos `web` e `node`) para cada RF acima, incluindo os casos de borda de RF-02 (início, fim, sufixo, fim além do tamanho), RF-03, RF-04 e RF-06.

**Critério de aceite**

- **Dado** a suíte atualizada
- **Quando** se executa `pnpm vitest run test/static.test.ts`
- **Então** os novos testes passam nos dois modos, e eles falham se a implementação de Range for removida.

## 3. Fora de escopo

- Respostas multi-intervalo (`multipart/byteranges`): `Range` com vários intervalos é ignorado (RF-03).
- Unidades de intervalo diferentes de `bytes`.
- Range em outros utilitários (`proxy`, `sendStream`, `toResponse`, rotas comuns) ou em métodos além de GET/HEAD.
- Novas opções em `ServeStaticOptions`, novos campos em `StaticAssetMeta` ou novas exportações públicas.
- Mudanças em `getMeta`/`getContents` (assinaturas, leitura parcial pelo backend); o `getContents` continua devolvendo o conteúdo inteiro e o módulo recorta.
- Geração de `ETag` ou `Last-Modified` quando o backend não os fornece.
- Compressão sob demanda e `Content-Range` sobre conteúdo não comprimido de um asset servido comprimido.
- Mudanças em documentação além do necessário (opcionalmente, uma nota em `docs/`).

## 4. Premissas e riscos

### Premissas

- `size` de `getMeta` é o tamanho exato, em bytes, da representação que será servida (incluindo a variante `.gz`/`.br` escolhida). Se o backend mentir, o `Content-Range` ficará incorreto.
- A issue diz "sempre anunciar `Accept-Ranges: bytes`", mas também limita a funcionalidade a assets com tamanho conhecido. Premissa adotada: anunciar quando o tamanho é conhecido (RF-01/RF-09), para não prometer o que não se cumpre. Se o dono do projeto quiser anunciar sempre, é uma mudança de uma linha.
- Seguindo a issue, `HEAD` também avalia `Range` (a RFC 9110 só obriga o GET e permite ignorar em outros métodos).
- Ignorar `Range` malformado ou multi-intervalo, e comparar `If-Range` com ETag forte e data exata, são comportamentos permitidos pela RFC 9110.
- Para `string`, o tamanho do `size` do backend corresponde à codificação UTF-8.

### Riscos

- **`size` incorreto ou desatualizado** (arquivo alterado entre `getMeta` e `getContents`) pode gerar corpo parcial inconsistente com `Content-Length`. Mitigação: validar o comprimento do trecho produzido e, se divergir, não é possível corrigir depois de iniciado o stream; documentar que `size` deve ser exato.
- **`ReadableStream` sem fatiamento nativo**: o descarte dos bytes iniciais lê o arquivo desde o começo, custando I/O em intervalos distantes. Backends que quiserem eficiência devem devolver `Blob`/`File`.
- **Conflito de `Content-Length`**: `content-length` vindo de `options.headers` ou do meta pode contradizer o trecho. O `206`/`416` precisa sobrescrever o valor (RF-02, RF-04).
- **Interação com `onResponse` e adaptadores Node/Web**: respostas `206`/`416` com corpo vazio ou stream precisam funcionar nos dois modos de teste; cobrir via `describeMatrix`.
- **Caches intermediários**: a resposta varia com `Range`; `206` precisa carregar `ETag`/`Last-Modified` consistentes para que `If-Range` funcione. Garantido por RF-07.
- **Regressão em testes existentes** que comparem cabeçalhos exatos: o novo `Accept-Ranges` pode exigir ajuste mínimo de asserções (RF-09).
