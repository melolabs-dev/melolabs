# PRD: HTTP Range no `serveStatic`

- Issue de origem: h3js/h3#1267
- Código afetado: `src/utils/static.ts` (`serveStatic`)
- Norma de referência: RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests). A issue cita a RFC 7233, que foi substituída pela RFC 9110; este PRD segue a RFC 9110.
- Data: 2026-11-06

## 1. Problema e objetivo

### Problema

`serveStatic` ignora o cabeçalho `Range`. Quando o cliente pede um intervalo de bytes, o servidor responde sempre com o corpo completo, com status `200` e sem cabeçalhos de conteúdo parcial. Isso causa três problemas:

- Downloads grandes não podem ser retomados: o cliente precisa baixar o arquivo inteiro de novo.
- Players de áudio e vídeo não conseguem avançar (seek) em arquivos servidos pelo h3, porque navegadores enviam `Range` para mídia.
- CDNs e proxies não conseguem armazenar nem servir fatias do arquivo corretamente, porque o servidor não anuncia nem respeita ranges.

### Objetivo

Fazer `serveStatic` atender pedidos de intervalo de bytes para `GET` e `HEAD`, de acordo com a RFC 9110, sem mudar a API pública e sem quebrar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

### Métrica de sucesso

- Um cliente que envia `Range: bytes=0-1023` para um arquivo com mais de 1024 bytes recebe `206` com exatamente 1024 bytes, iguais aos primeiros 1024 bytes do `200` do mesmo arquivo.
- A suíte existente, mais os novos testes, passa em `web` e `node`, e `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a ranges

Toda resposta de asset servida por `serveStatic` (`200`, `206`, `416` e `HEAD`) inclui `Accept-Ranges: bytes`. Se o aplicativo já definiu `accept-ranges` pelo option `headers`, o valor do aplicativo é mantido, no mesmo padrão de `content-type`.

**Critério de aceite**
- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` sem cabeçalho `Range`,
- **Então** a resposta tem status `200` e o cabeçalho `accept-ranges` com valor `bytes`.

### RF-02 — Interpretar o cabeçalho `Range`

`serveStatic` aceita somente a unidade `bytes` com um único intervalo, em uma das três formas da RFC 9110:

- `bytes=<início>-<fim>`: intervalo fechado.
- `bytes=<início>-`: do início até o fim do arquivo.
- `bytes=-<n>`: os últimos `n` bytes (sufixo).

Espaços em branco (OWS) ao redor dos valores são tolerados.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia `Range: bytes=10-19`, `Range: bytes=90-` ou `Range: bytes=-10`,
- **Então** a resposta tem status `206` em todos os três casos, e o corpo corresponde aos bytes 10 a 19, 90 a 99 e 90 a 99, respectivamente.

### RF-03 — Ignorar `Range` inválido, de outra unidade ou com múltiplos intervalos

Quando o cabeçalho `Range` é malformado, usa outra unidade que não `bytes`, pede mais de um intervalo ou tem `início` maior que `fim`, `serveStatic` ignora o cabeçalho e responde com o asset completo, com status `200`. Isso segue a instrução da issue e a RFC 9110, que permite ignorar `Range`.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia cada um destes cabeçalhos: `Range: bytes=abc`, `Range: bytes=`, `Range: bytes=-`, `Range: bytes=5-3`, `Range: bytes=0-1,3-4` ou `Range: items=0-1`,
- **Então** cada resposta tem status `200` e corpo completo de 100 bytes, sem `content-range`.

### RF-04 — Responder `206` para um intervalo válido

Quando o intervalo é válido e satisfazível, a resposta tem status `206 Partial Content`, o cabeçalho `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual a `fim - início + 1`. O corpo contém somente os bytes do intervalo.

**Critério de aceite**
- **Dado** um asset de 100 bytes com conteúdo conhecido,
- **Quando** o cliente envia `Range: bytes=10-19`,
- **Então** a resposta tem status `206`, `content-range` igual a `bytes 10-19/100`, `content-length` igual a `10` e o corpo é exatamente os bytes 10 a 19 do asset.

### RF-05 — Limitar intervalos que passam do fim do arquivo

Quando o `fim` do intervalo é maior ou igual ao tamanho do arquivo, o `fim` efetivo é `tamanho - 1`. Quando o sufixo `n` é maior que o tamanho do arquivo, o intervalo efetivo é o arquivo inteiro. Nos dois casos a resposta é `206`.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia `Range: bytes=90-999`,
- **Então** a resposta tem status `206`, `content-range` igual a `bytes 90-99/100`, `content-length` igual a `10` e o corpo tem os bytes 90 a 99.

- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia `Range: bytes=-500`,
- **Então** a resposta tem status `206`, `content-range` igual a `bytes 0-99/100` e o corpo é o arquivo inteiro.

### RF-06 — Responder `416` para intervalo não satisfazível

Quando o intervalo não pode ser atendido, a resposta tem status `416 Range Not Satisfiable`, o cabeçalho `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e corpo vazio. Isso vale quando o `início` é maior ou igual ao tamanho, quando o sufixo é `0` e quando o arquivo tem tamanho `0`.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia `Range: bytes=100-` ou `Range: bytes=-0`,
- **Então** a resposta tem status `416`, `content-range` igual a `bytes */100`, `content-length` igual a `0` e corpo vazio.

- **Dado** um asset de 0 bytes,
- **Quando** o cliente envia `Range: bytes=0-`,
- **Então** a resposta tem status `416`, `content-range` igual a `bytes */0` e `content-length` igual a `0`.

### RF-07 — Validar `If-Range`

Quando o cliente envia `If-Range`, o `Range` só é aplicado se o validador enviado corresponde ao estado atual do asset:

- Um ETag forte (sem `W/`) igual ao `etag` de `getMeta`, na comparação forte da RFC 9110.
- Uma data HTTP igual, ao segundo, ao `last-modified` que o servidor enviaria.

Se o ETag enviado é fraco (`W/`), se não corresponde, ou se a data não corresponde, `Range` é ignorado e a resposta é `200` com o asset completo. `If-Range` sem `Range` não altera a resposta.

**Critério de aceite**
- **Dado** um asset de 100 bytes com `etag` `"v1"`,
- **Quando** o cliente envia `Range: bytes=0-9` e `If-Range: "v1"`,
- **Então** a resposta tem status `206` com 10 bytes.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-9` e `If-Range: "v0"`,
- **Então** a resposta tem status `200` com o corpo completo.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-9` e `If-Range: W/"v1"`,
- **Então** a resposta tem status `200` com o corpo completo.

### RF-08 — Manter a precedência do `304`

A avaliação de cache existente vem antes de `Range`. Se `If-None-Match` ou `If-Modified-Since` indicar que o cliente já tem a versão atual, a resposta é `304`, mesmo com `Range`.

**Critério de aceite**
- **Dado** um asset com `etag` `"v1"`,
- **Quando** o cliente envia `If-None-Match: "v1"` e `Range: bytes=0-9`,
- **Então** a resposta tem status `304` sem corpo.

### RF-09 — `HEAD` com `Range`

Para `HEAD`, `serveStatic` devolve o mesmo status e os mesmos cabeçalhos que `GET` devolveria (`206` com `Content-Range` e `Content-Length` da faixa, ou `416`, ou `200`), sem corpo.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=10-19`,
- **Então** a resposta tem status `206`, `content-range` igual a `bytes 10-19/100`, `content-length` igual a `10` e corpo vazio.

### RF-10 — Ranges sobre a variante servida

Quando há uma variante pré-comprimida (por exemplo `app.js.gz`) ou `meta.encoding` definido, o intervalo é aplicado aos bytes da variante que será servida, e o `size` usado em `Content-Range` e `Content-Length` é o `size` da variante escolhida. O cabeçalho `Content-Encoding` continua igual ao de hoje.

**Critério de aceite**
- **Dado** que `app.js` tem 100 bytes e `app.js.gz` tem 40 bytes, com `encodings: { gzip: ".gz" }`,
- **Quando** o cliente envia `Accept-Encoding: gzip` e `Range: bytes=0-9`,
- **Então** a resposta tem status `206`, `content-encoding` igual a `gzip`, `content-range` igual a `bytes 0-9/40` e o corpo são os 10 primeiros bytes de `app.js.gz`.

### RF-11 — Ignorar `Range` quando o tamanho é desconhecido

Quando `getMeta` não devolve `size`, ou devolve um valor que não é número, `serveStatic` ignora `Range` e responde `200` com o asset completo.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não devolve `size`,
- **Quando** o cliente envia `Range: bytes=0-9`,
- **Então** a resposta tem status `200`, sem `content-range`, com o corpo completo.

### RF-12 — Fatiar o corpo de qualquer `BodyInit` aceito por `getContents`

`getContents` não recebe o intervalo. `serveStatic` deve extrair a faixa do conteúdo que `getContents` devolve, para cada tipo de `BodyInit` que já é aceito hoje: `string`, `ArrayBuffer`, views de bytes (`Uint8Array` e similares), `Blob` e `ReadableStream`. O corpo parcial deve ser idêntico à fatia correspondente do corpo completo.

**Critério de aceite**
- **Dado** o mesmo conteúdo de 100 bytes devolvido por `getContents` como `string`, `Uint8Array`, `ArrayBuffer`, `Blob` e `ReadableStream`,
- **Quando** o cliente envia `Range: bytes=20-29` em cada caso,
- **Então** cada resposta tem status `206` e corpo igual aos bytes 20 a 29 do conteúdo.

### RF-13 — Preservar o comportamento existente

Sem `Range`, ou quando `Range` é ignorado, a resposta é a mesma de hoje. Cache, seleção de encoding, `vary`, `fallthrough`, `404` para asset inexistente e `405` para método não permitido continuam iguais. `fallthrough` continua valendo para ausência de asset e para caminho não canônico.

**Critério de aceite**
- **Dado** a suíte de testes existente de `serveStatic`,
- **Quando** ela roda sem alterações nos testes que não dependem de `Range`,
- **Então** todos os testes passam, e nenhum teste deixa de verificar o que verificava antes.

- **Dado** um `POST` com `Range: bytes=0-9` a um asset,
- **Quando** a requisição chega a `serveStatic`,
- **Então** a resposta é `405` com `allow: GET, HEAD`, como hoje.

### RF-14 — Sem exportações públicas novas e helpers privados

`src/index.ts` não ganha nomes novos, nem valores nem tipos. As funções auxiliares de `Range` e `If-Range` são privadas ao módulo `static.ts`. `ServeStaticOptions`, `StaticAssetMeta` e as assinaturas de `getMeta` e `getContents` não mudam.

**Critério de aceite**
- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações de `src/index.ts` e os tipos públicos com a versão atual,
- **Então** não há diferença.

### RF-15 — Verificação em todos os runtimes

Os novos testes usam `describeMatrix` para rodar em `web` e `node`, e cobrem os cenários dos RF-01 a RF-12. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** a branch com a mudança,
- **Quando** se roda `pnpm vitest run test/static.test.ts` (ou o arquivo de teste de static que existir) e depois `pnpm lint`,
- **Então** todos os testes passam nos dois targets (`web` e `node`), e o lint e o typecheck não reportam erros.

## 3. Fora de escopo

- **Múltiplos intervalos** (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` com o arquivo completo.
- **Outras unidades** além de `bytes`.
- **Pré-condições `If-Match` e `If-Unmodified-Since`** (respostas `412`). Continuam sem tratamento.
- **Alterar `getMeta` ou `getContents`** para receber o intervalo. Isso mudaria a API pública e fica para uma issue separada.
- **Range em respostas que não são de asset estático**, como `sendStream`, `proxy` ou respostas de handlers comuns.
- **Otimizações de I/O por backend** (por exemplo, `fs.createReadStream` com `start` e `end`). A mudança fica no `serveStatic` e no fatiamento do `BodyInit`.
- **Compressão dinâmica de respostas parciais.**
- **Cache de respostas parciais** além do que já existe para o asset completo.
- **Documentação de site e exemplos de cliente.**

## 4. Premissas e riscos

### Premissas

- `size` devolvido por `getMeta` é o tamanho exato dos bytes que `getContents` devolve para a variante escolhida. Se não for, `Content-Length` e `Content-Range` ficam errados.
- Ranges são aplicados à representação com `Content-Encoding`, como manda a RFC 9110. Um cliente que retoma um download de `.gz` recebe bytes de `.gz`, e isso é o comportamento correto.
- Os runtimes suportados (Node, Bun, Deno, Workers e navegadores) oferecem `Blob.slice`, `ReadableStream` e `TextEncoder` da mesma forma, para que o mesmo código funcione em todos.
- O `ETag` vem de `getMeta` e é tratado como forte, a menos que comece com `W/`.

### Riscos

- **Custo do fatiamento.** `getContents` devolve um `BodyInit` sem intervalo. Para `ReadableStream`, pular bytes pode exigir ler o arquivo do início até o fim da faixa. Para arquivos grandes, isso custa CPU e I/O. Como a API pública não pode mudar, a v1 aceita esse custo e o documenta. A melhoria (passar o intervalo para o backend) fica para a issue separada da seção "Fora de escopo".
- **`Accept-Ranges` com tamanho desconhecido.** A issue pede `Accept-Ranges: bytes` sempre, mas, sem `size`, o servidor ignora `Range`. Este PRD segue a issue e anuncia sempre. Se o time preferir anunciar só quando o tamanho é conhecido, a mudança é pequena e deve ser decidida antes da implementação.
- **Conflito com `headers` do usuário.** Se o aplicativo define `content-length` ou `content-range` pelo option `headers`, a resposta `206` e `416` precisam dos valores corretos. Este PRD exige que `serveStatic` substitua esses dois cabeçalhos nas respostas `206` e `416`.
- **Tamanho do arquivo.** `src/utils/static.ts` já tem 352 linhas, acima da meta de 200 linhas do `AGENTS.md`. A restrição de manter os helpers no módulo impede separar em outro arquivo público, mas um arquivo interno em `utils/internal/`, não exportado pelo index, atenderia à restrição e manteria o módulo menor. A escolha fica para o engenheiro, que deve citar a decisão no PR.
- **Testes existentes.** Alguns testes podem depender de `200` para requisições com `Range` ou da ausência de `accept-ranges`. Só esses testes devem ser ajustados, sem remover o que verificam.
- **Consistência entre `Content-Length` e corpo.** Se `getContents` devolver menos bytes do que `size`, a resposta fica inconsistente. Este PRD não trata esse caso além do que já acontece hoje; é um problema do backend.
