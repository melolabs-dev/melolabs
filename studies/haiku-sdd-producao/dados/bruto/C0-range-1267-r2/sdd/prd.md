# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo, o servidor responde `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou recuar na mídia;
- CDNs e proxies não conseguem tratar o asset de forma eficiente.

### Objetivo

Fazer o `serveStatic` atender pedidos de **um único intervalo de bytes** em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`). Isso permite retomar downloads e navegar em mídia, como pede a issue.

A norma de referência é a **RFC 9110** (seção 13.1.5, If-Range, e seção 14, Range Requests), que substitui a RFC 7233 citada na issue. Onde a issue e a norma divergirem, vale a norma.

A mudança é interna e retrocompatível. Não há mudança de API.

## 2. Requisitos funcionais

Em todos os requisitos abaixo, "asset" é o recurso resolvido por `getMeta`/`getContents`, e "tamanho" é o `meta.size`. Os intervalos são tratados sobre os bytes da representação que seria enviada: a variante pré-comprimida escolhida por `accept-encoding`, quando houver.

### RF-01 — Anunciar `Accept-Ranges: bytes`

O `serveStatic` anuncia suporte a intervalos de bytes nas respostas em que o asset é servido (200, 206 e 304) e em que o tamanho é conhecido.

- **Dado** um asset com `size` conhecido e um pedido `GET` ou `HEAD` sem cabeçalho `Range`
- **Quando** o `serveStatic` responde
- **Então** a resposta é `200` com o corpo completo e traz `Accept-Ranges: bytes`.

### RF-02 — Intervalo válido retorna `206 Partial Content`

Um `Range` com uma única especificação válida (`bytes=a-b`, `bytes=a-` ou `bytes=-n`) e satisfatível retorna somente os bytes pedidos.

- **Dado** um asset de 100 bytes e um `GET` com `Range: bytes=10-19`
- **Quando** o `serveStatic` responde
- **Então** o status é `206`, o corpo tem exatamente os bytes 10 a 19, `Content-Range` é `bytes 10-19/100` e `Content-Length` é `10`.

### RF-03 — Formas de intervalo (aberto, sufixo e limite)

As formas `a-`, `-n` e `a-b` com `b` além do fim são normalizadas conforme a RFC 9110, seção 14.1.2.

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `bytes=90-`, `bytes=-10` ou `bytes=90-999`
- **Então** cada pedido recebe `206` com `Content-Range: bytes 90-99/100` e `Content-Length: 10`; e `bytes=-500` (sufixo maior que o asset) devolve o asset inteiro como `206` com `Content-Range: bytes 0-99/100`.

### RF-04 — `HEAD` com intervalo envia só cabeçalhos

- **Dado** um asset de 100 bytes e um `HEAD` com `Range: bytes=10-19`
- **Quando** o `serveStatic` responde
- **Então** o status é `206`, os cabeçalhos `Content-Range` e `Content-Length` são os mesmos do `GET` equivalente, e o corpo é vazio; `getContents` não é chamado.

### RF-05 — Intervalo insatisfatível retorna `416`

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `Range: bytes=100-` (início no tamanho ou além) ou `bytes=-0`
- **Então** o status é `416 Range Not Satisfiable`, com `Content-Range: bytes */100` e `Content-Length: 0`, sem corpo; vale também para `HEAD`.

### RF-06 — `Range` malformado, de unidade desconhecida ou múltiplo é ignorado

- **Dado** um asset com `size` conhecido
- **Quando** o `Range` é malformado (`bytes=abc`, `bytes=5-2`, `bytes=`), usa outra unidade (`items=0-1`) ou pede vários intervalos (`bytes=0-1,5-6`)
- **Então** o cabeçalho é ignorado e a resposta é `200` com o corpo completo, igual a um pedido sem `Range`.

### RF-07 — Tamanho desconhecido desativa o suporte a intervalos

- **Dado** um asset cujo `getMeta` não devolve `size` (ou devolve `0`)
- **Quando** o cliente envia qualquer `Range`
- **Então** o `Range` é ignorado, a resposta é `200` com o corpo completo e `Accept-Ranges: bytes` não é enviado.

### RF-08 — `If-Range` condiciona o intervalo à validade do asset

Seguindo a RFC 9110, seção 13.1.5: o `If-Range` só é avaliado se houver `Range`; com ETag usa-se comparação forte, e com data compara-se com `Last-Modified` por igualdade exata. ETag fraco (`W/`) nunca satisfaz o `If-Range`.

- **Dado** um asset com `etag` forte `"v1"` e um `GET` com `Range: bytes=0-9` e `If-Range: "v1"`
- **Quando** o `serveStatic` responde
- **Então** o status é `206`; e se o `If-Range` for `"outro"`, uma data diferente do `Last-Modified` ou um ETag fraco, o `Range` é ignorado e a resposta é `200` com o corpo completo.

### RF-09 — Preservar cache e respostas condicionais

Os cabeçalhos condicionais existentes continuam a decidir primeiro, como hoje.

- **Dado** um asset com `etag` e um `GET` com `If-None-Match` que casa com ele, junto com `Range`
- **Quando** o `serveStatic` responde
- **Então** a resposta é `304` (sem corpo, sem `Content-Range`), exatamente como antes da mudança; sem casamento de cache, os cabeçalhos `etag`, `last-modified` e `vary` continuam presentes também nas respostas `206`.

### RF-10 — Preservar seleção de encoding

- **Dado** `encodings` configurado (ex.: `{ gzip: ".gz" }`), um asset com variante `.gz` e um pedido com `Accept-Encoding: gzip` e `Range`
- **Quando** o `serveStatic` responde
- **Então** o intervalo é calculado sobre a variante `.gz` escolhida (usando o `size` dela), `Content-Encoding: gzip` e `Vary: accept-encoding` são mantidos, e o `Content-Type` continua sendo o do asset original.

### RF-11 — Preservar `fallthrough`, 404 e 405

- **Dado** um asset inexistente, um método diferente de `GET`/`HEAD`, ou um caminho não canônico, com ou sem `Range`
- **Quando** o `serveStatic` responde
- **Então** o comportamento é o de hoje: `404` (ou retorno `undefined` com `fallthrough`), `405` com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`), e nenhum cabeçalho de `Range` é emitido.

### RF-12 — `Content-Length` explícito do usuário não é sobrescrito de forma incoerente

- **Dado** um `Content-Length` já definido pelo usuário via `options.headers` (comportamento atual: ele vence o `size`)
- **Quando** o pedido tem um `Range` válido e satisfatível
- **Então** a resposta `206` traz o `Content-Length` correto do intervalo (RFC 9110: deve corresponder ao corpo enviado), e sem `Range` o valor do usuário continua valendo como hoje.

### RF-13 — Nenhuma exportação pública nova

- **Dado** a mudança concluída
- **Quando** se compara `src/index.ts` e os tipos publicados antes e depois
- **Então** não há nomes novos (valores ou tipos) exportados, `ServeStaticOptions` e `StaticAssetMeta` não ganham campos obrigatórios, e todos os auxiliares ficam privados em `src/utils/static.ts` (ou em `src/utils/internal/`, sem reexportação).

## 3. Fora de escopo

- Múltiplos intervalos e respostas `multipart/byteranges` (ficam ignorados, RF-06).
- Unidades de intervalo diferentes de `bytes`.
- Suporte a intervalos sem `size` conhecido (RF-07).
- Pedir ao `getContents` somente a fatia necessária: não existe tal parâmetro e criá-lo mudaria a API pública. O corte do corpo é feito dentro do `serveStatic`.
- Intervalos em outras utilidades (`proxy`, `serveStatic` de outros pacotes, etc.) e `Range` em métodos diferentes de `GET`/`HEAD`.
- Mudanças em cache, encoding, `fallthrough`, 404/405 além do que os requisitos acima descrevem.
- Documentação em site ou changelog (só se o projeto exigir ao integrar).

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação que `getContents` entrega para o mesmo `id` (inclusive para a variante pré-comprimida).
- `getContents` devolve um `BodyInit` (string, `Blob`, `ReadableStream`, `ArrayBuffer`, etc.); o corte precisa funcionar para os tipos usados nos testes e de forma razoável para os demais.
- Os testes seguem `describeMatrix` (modos `web` e `node`), e `pnpm lint` e `pnpm typecheck` precisam passar.
- A ordem de avaliação segue a RFC 9110, seção 13.2.2: condicionais (`If-None-Match`/`If-Modified-Since`) primeiro, depois `Range` com `If-Range`.

### Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `size` incorreto ou incompatível com o conteúdo real | Corpo parcial truncado ou `Content-Length` errado | Documentar a premissa; tratar `size` ausente ou `0` como "sem suporte" (RF-07). |
| Cortar o corpo de um `ReadableStream` ou `Blob` sem carregá-lo todo na memória | Consumo de memória em arquivos grandes | Preferir `Blob.slice` e um stream com corte por contagem de bytes; evitar `arrayBuffer()` quando possível. |
| Testes existentes que fixam `content-length` ou ausência de `Accept-Ranges` | Quebra da suíte | Ajustar apenas as asserções afetadas (ex.: acrescentar `accept-ranges`), sem enfraquecer o que verificam. |
| Divergência entre issue (RFC 7233) e norma (RFC 9110), por exemplo no `If-Range` e na ordem das condicionais | Comportamento inesperado | Seguir a RFC 9110 e registrar a decisão nos testes (RF-08, RF-09). |
| Interação com `Content-Length` definido pelo usuário (RF-12) | Resposta `206` incoerente | Cobrir com teste de regressão específico. |
| `HEAD` e `GET` divergirem nos cabeçalhos | Clientes e caches confusos | Compartilhar a mesma lógica de cálculo e testar os dois métodos. |
| Variação por `Range` em caches intermediários | Respostas parciais servidas fora de contexto | Respeitar os validadores (`ETag`/`Last-Modified`) e emitir `206` só com `Range` explícito. |
