# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

Hoje `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- navegadores e players não conseguem avançar em vídeo e áudio;
- CDNs e proxies não conseguem reaproveitar ou fatiar respostas.

### Objetivo

Fazer `serveStatic` atender pedidos de intervalo de bytes (um único intervalo, em `GET` e `HEAD`) conforme a RFC 9110, seções 13.1.5 (`If-Range`) e 14 (Range Requests). Essa RFC substitui a RFC 7233 citada na issue. A mudança é interna e retrocompatível:

- sem nova API pública;
- `ServeStaticOptions` não muda;
- o tamanho do asset é o `size` devolvido por `getMeta`.

### Métricas de sucesso

- Um cliente com `Range: bytes=a-b` válido recebe `206` com os bytes pedidos.
- Pedidos sem `Range` continuam recebendo exatamente a resposta de hoje, exceto pelo novo `Accept-Ranges`.
- Toda a suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` informa `Accept-Ranges: bytes` nas respostas `200` de `GET` e `HEAD` de assets com tamanho conhecido (`meta.size` definido e maior que 0). Também informa nas respostas `206`, `416` e `304`, que representam o mesmo asset.

**Critério de aceite**
- **Dado** um asset com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`,
- **Então** a resposta é `200`, com o corpo de hoje e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Intervalo válido retorna 206

Para `Range: bytes=<início>-<fim>` satisfazível em `GET`, a resposta é `206 Partial Content`:

- o corpo contém somente os bytes do intervalo;
- `Content-Range: bytes <início>-<fim>/<size>`;
- `Content-Length` é o número de bytes do intervalo;
- um `<fim>` além do último byte é truncado em `size - 1`.

**Critério de aceite**
- **Dado** um asset de 10 bytes (`0123456789`),
- **Quando** o cliente envia `GET` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, com corpo `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`.

### RF-03 — Formas de intervalo: aberto e sufixo

São aceitas as três formas de um único intervalo:

- `bytes=a-b`;
- `bytes=a-`, do byte `a` até o fim;
- `bytes=-n`, os últimos `n` bytes. Se `n` for maior que `size`, o intervalo é o asset inteiro.

O nome da unidade é comparado sem diferenciar maiúsculas de minúsculas (`Bytes=0-1` vale). Espaços opcionais ao redor são tolerados.

**Critério de aceite**
- **Dado** um asset de 10 bytes (`0123456789`),
- **Quando** o cliente envia `Range: bytes=7-`, e em outro pedido `Range: bytes=-3`,
- **Então** ambas as respostas são `206`, com corpo `789`, `Content-Range: bytes 7-9/10` e `Content-Length: 3`.

### RF-04 — HEAD com intervalo envia só cabeçalhos

Em `HEAD` com `Range` válido, a resposta é `206` com os mesmos cabeçalhos do `GET` equivalente (`Content-Range`, `Content-Length` do intervalo) e sem corpo. `getContents` não é chamado.

**Critério de aceite**
- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta é `206`, com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio.

### RF-05 — Intervalo insatisfazível retorna 416

Quando o intervalo é sintaticamente válido mas não pode ser atendido, a resposta é `416 Range Not Satisfiable`. Isso vale para início `>= size` e para sufixo `-0`. A resposta traz `Content-Range: bytes */<size>`, `Content-Length: 0` e corpo vazio. Vale para `GET` e `HEAD`.

**Critério de aceite**
- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=10-20` (ou `bytes=-0`),
- **Então** a resposta é `416`, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio.

### RF-06 — Range malformado, multi-range ou unidade desconhecida é ignorado

O servidor serve a resposta completa (`200`) nos casos abaixo:

- sintaxe inválida: `bytes=abc`, `bytes=5-2` (fim menor que início), `bytes=`, números negativos ou não numéricos;
- vários intervalos: `bytes=0-1,4-5`;
- unidade diferente de `bytes`.

**Critério de aceite**
- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,4-5` (ou `bytes=5-2`, ou `items=0-1`),
- **Então** a resposta é `200`, com o corpo inteiro e sem `Content-Range`.

### RF-07 — If-Range condiciona o intervalo

Se o pedido traz `If-Range` junto com `Range`, o intervalo só é aplicado quando o validador confere (RFC 9110 13.1.5):

- **ETag:** só vale um validador forte, comparado byte a byte com o `etag` do asset. Um ETag fraco (`W/"..."`) no `If-Range` ou no asset não confere.
- **Data:** confere só se for igual a `Last-Modified` do asset, com precisão de segundos.
- **Não confere ou não é interpretável:** o intervalo é ignorado e a resposta é `200` com o corpo inteiro.
- **Sem `Range`:** `If-Range` é ignorado.

**Critério de aceite**
- **Dado** um asset com `etag: "abc"` e 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`, e em outro pedido com `If-Range: "outro"`,
- **Então** o primeiro recebe `206` com 4 bytes e o segundo recebe `200` com os 10 bytes.

### RF-08 — Precedência das condicionais existentes

A avaliação de `If-None-Match` e `If-Modified-Since` continua antes do tratamento de `Range`. Se o pedido já resultaria em `304`, a resposta é `304`, sem processar o intervalo. Esse comportamento é o de hoje e permanece.

**Critério de aceite**
- **Dado** um asset com `etag` e um pedido com `If-None-Match` igual a esse `etag`,
- **Quando** o cliente envia também `Range: bytes=0-3`,
- **Então** a resposta é `304`, sem corpo e sem `Content-Range`.

### RF-09 — Compatibilidade com encoding e variantes pré-comprimidas

O intervalo é aplicado à representação efetivamente servida, isto é, à variante escolhida por `Accept-Encoding`.

- `size` é o da variante escolhida, e `Content-Range` e `Content-Length` usam esse tamanho.
- `Content-Encoding` e `Vary` seguem como hoje.
- O `Content-Type` continua sendo o do asset original.

**Critério de aceite**
- **Dado** `encodings: { gzip: ".gz" }` e uma variante `.gz` de 20 bytes,
- **Quando** o cliente envia `Accept-Encoding: gzip` e `Range: bytes=0-4`,
- **Então** a resposta é `206`, com `Content-Encoding: gzip`, `Content-Range: bytes 0-4/20`, `Content-Length: 5`, `Vary: accept-encoding` e o `Content-Type` do asset original.

### RF-10 — Só se aplica com tamanho conhecido

Se `meta.size` é indefinido ou `0`, `Range` é ignorado, o `Accept-Ranges` não é enviado e a resposta é a de hoje.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não devolve `size`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `200`, com o corpo inteiro e sem `Accept-Ranges` nem `Content-Range`.

### RF-11 — Sem regressão e sem API pública nova

- `fallthrough`, `404` para asset inexistente ou caminho não canônico, e `405` com `Allow: GET, HEAD` para outros métodos têm o mesmo comportamento de hoje. Um `Range` presente não os altera.
- `src/index.ts` não ganha nomes, nem valores nem tipos.
- As funções auxiliares ficam privadas no módulo `src/utils/static.ts`.
- `ServeStaticOptions` e `StaticAssetMeta` não mudam.

**Critério de aceite**
- **Dado** um asset inexistente, e separadamente um método `POST`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `404` (ou segue adiante, com `fallthrough`) e `405` com `Allow: GET, HEAD`, como sem o `Range`. Além disso, `Object.keys` das exportações de `src/index.ts` e o tipo exportado ficam idênticos aos de antes.

## 3. Fora de escopo

- Respostas multi-range (`multipart/byteranges`). O pedido é ignorado e a resposta é completa.
- Unidades de range diferentes de `bytes`.
- Range em métodos diferentes de `GET` e `HEAD`.
- Range para assets sem tamanho conhecido, e cálculo de `size` por conta do `serveStatic`.
- Nova opção de configuração, nova exportação pública ou mudança de assinatura.
- Mudanças em `proxy`, `cache`, `serveStatic` de outros módulos ou nos adaptadores.
- Compressão sob demanda, ou recompressão da faixa pedida.
- Otimização de leitura parcial no backend (por exemplo `fs.createReadStream` com `start` e `end`). `getContents` continua sem receber o intervalo.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação que `getContents(id)` devolve, já levando em conta a variante pré-comprimida. Um `size` incorreto gera `Content-Range` incorreto.
- `getContents` devolve `BodyInit`. O recorte do intervalo é feito pelo `serveStatic`, sobre o conteúdo devolvido.
- A comparação de `If-Range` por data usa o `Last-Modified` já calculado, truncado em segundos.
- Os cabeçalhos definidos pelo usuário em `options.headers` continuam valendo. `Content-Length`, `Content-Range` e `Accept-Ranges` calculados para a resposta têm precedência quando o intervalo é aplicado.

### Riscos

- **Recorte de `BodyInit` heterogêneo.** `string`, `Blob`, `ArrayBuffer`, views, `ReadableStream` e `FormData` ou `URLSearchParams` se recortam de formas diferentes. Strings contam bytes UTF-8, não caracteres. Streams precisam de descarte e truncamento sem carregar tudo na memória. Mitigação: cobrir cada tipo com teste e definir comportamento para os não recortáveis. A decisão sugerida é responder o corpo completo com `200`.
- **Ambiguidade da issue.** Ela diz "sempre anunciar `Accept-Ranges`" e também "quando o tamanho é conhecido". Este PRD anuncia só com tamanho conhecido (RF-01 e RF-10). Se for pedido anunciar sempre, o RF-10 muda.
- **`Content-Length` pré-existente.** Hoje o `content-length` só é definido se ainda não existir. Um valor vindo de `options.headers` pode contradizer o intervalo. Mitigação: sobrescrever no caminho `206` e `416`.
- **Regressão em testes atuais.** Testes que comparam o conjunto exato de cabeçalhos podem falhar por causa do novo `Accept-Ranges`. Ajustar só esses, sem perder o que verificam.
- **Interação com cache e CDN.** Respostas `206` e `416` herdam `ETag`, `Last-Modified` e `Vary`. A ordem das condicionais (RF-08) precisa ser preservada para não retornar `206` quando caberia `304`.
- **Divergência entre runtimes.** O comportamento deve ser idêntico nos modos `web` e `node` do `describeMatrix`, em especial o corpo vazio do `HEAD` e do `416`.
