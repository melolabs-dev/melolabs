# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, a resposta traz o arquivo inteiro com status 200 e não anuncia `Accept-Ranges`. Na prática:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek);
- proxies e CDNs não recebem o comportamento HTTP esperado.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, conforme a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública nem o comportamento já existente de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range nas respostas de assets

Todo asset servido com sucesso por `serveStatic` deve informar que aceita intervalos de bytes.

**Dado** um asset existente e um pedido `GET` ou `HEAD` sem cabeçalho `Range`,
**Quando** `serveStatic` responde com 200,
**Então** a resposta contém `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder a um intervalo válido com 206

Quando o pedido traz um único intervalo satisfazível, a resposta é o trecho pedido.

**Dado** um asset de 1000 bytes e um pedido com `Range: bytes=0-499`,
**Quando** `serveStatic` processa o pedido `GET`,
**Então** a resposta tem status 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e o corpo contém exatamente os bytes 0 a 499.

### RF-03 — Aceitar intervalos abertos e de sufixo

O intervalo pode ser aberto (`bytes=N-`) ou de sufixo (`bytes=-N`), como define a RFC 9110.

**Dado** um asset de 1000 bytes,
**Quando** o pedido traz `Range: bytes=900-` ou `Range: bytes=-100`,
**Então** a resposta é 206 com `Content-Range: bytes 900-999/1000` e `Content-Length: 100` nos dois casos.

### RF-04 — Responder 416 para intervalo não satisfazível

**Dado** um asset de 1000 bytes e um pedido com `Range: bytes=2000-3000`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e `Accept-Ranges: bytes`.

### RF-05 — Ignorar Range malformado, múltiplo ou de outra unidade

Nesses casos o servidor não erra: devolve a resposta completa, como se o cabeçalho não existisse.

**Dado** um asset de 1000 bytes e um pedido com `Range` em um destes formatos: `bytes=abc`, `bytes=0-1,5-9` ou `items=0-4`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta tem status 200, o corpo completo e `Content-Length: 1000`, sem `Content-Range`.

### RF-06 — Respeitar If-Range

Se o validador enviado em `If-Range` não corresponder ao estado atual do asset, o `Range` é ignorado.

**Dado** um asset com `ETag: "abc"` e um pedido com `Range: bytes=0-99` e `If-Range: "xyz"`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta tem status 200 com o corpo completo.

**Dado** o mesmo asset e `If-Range: "abc"`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta tem status 206 com os bytes 0 a 99.

### RF-07 — Avaliar condicionais antes de Range

Os cabeçalhos condicionais de cache vêm antes do `Range` na ordem de avaliação da RFC 9110.

**Dado** um asset cujo `ETag` coincide com `If-None-Match` e um pedido que também traz `Range`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta é 304 `Not Modified`, sem corpo, como hoje.

### RF-08 — Responder HEAD com Range apenas com cabeçalhos

**Dado** um asset de 1000 bytes e um pedido `HEAD` com `Range: bytes=0-499`,
**Quando** `serveStatic` processa o pedido,
**Então** a resposta tem status 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e corpo vazio.

### RF-09 — Ignorar Range quando o tamanho do asset é desconhecido

O intervalo só pode ser calculado com o tamanho informado por `getMeta`.

**Dado** um asset cujo `getMeta` não devolve `size`,
**Quando** o pedido traz `Range: bytes=0-99`,
**Então** a resposta é 200 com o corpo completo e sem `Content-Range`.

### RF-10 — Aplicar Range à variante escolhida

O intervalo é calculado sobre o arquivo que `serveStatic` escolheu (original ou variante pré-comprimida, conforme `accept-encoding`). O tamanho usado é o da variante.

**Dado** `encodings: { gzip: ".gz" }`, um pedido com `Accept-Encoding: gzip` e `Range: bytes=0-9`,
**Quando** existe `app.js.gz` com 300 bytes,
**Então** a resposta tem status 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-9/300` e os 10 primeiros bytes de `app.js.gz`.

### RF-11 — Preservar o comportamento existente

Nada do que já funciona pode mudar quando não há `Range`, nem quando o `Range` é ignorado.

**Dado** um pedido com `Range` para um caminho que não existe, ou com `fallthrough: true` e método `POST`,
**Quando** `serveStatic` processa o pedido,
**Então** o resultado é o mesmo de hoje: 404 (ou `undefined` com `fallthrough`), e 405 com `Allow: GET, HEAD` para métodos não permitidos.

**Dado** um pedido sem `Range` a um asset existente,
**Quando** `serveStatic` responde,
**Então** os cabeçalhos `Content-Length`, `ETag`, `Last-Modified`, `Content-Type`, `Vary` e o corpo são os mesmos de antes (exceto o novo `Accept-Ranges`).

## Fora de escopo

- Suporte a múltiplos intervalos (`multipart/byteranges`). Pedidos desse tipo recebem a resposta completa (RF-05).
- Suporte a unidades diferentes de `bytes`.
- Novas opções em `ServeStaticOptions` ou novos parâmetros em `getMeta` e `getContents`.
- Novas exportações em `src/index.ts`, tanto valores quanto tipos.
- Alterações em outros utilitários (`proxy`, `h3/rules/cache`, `serveStatic` de outros runtimes).
- Cache de respostas parciais.
- Compressão de respostas parciais.

## Premissas e riscos

### Premissas

- `getMeta` devolve `size` para os assets em que o Range deve funcionar. Assets sem `size` seguem o RF-09.
- `getContents` devolve o corpo completo do asset. O recorte em bytes é feito dentro de `serveStatic`, pois a assinatura de `getContents` não recebe intervalo.
- Não há `size` igual a zero na prática. Se houver, o pedido recebe 416, conforme a RFC 9110 (seção 14.1.1). Essa escolha precisa ser confirmada.
- O validador de `If-Range` usa `ETag` forte (sem `W/`) ou `Last-Modified` com igualdade exata, como indica a RFC 9110 (seção 13.1.5).
- Testes seguem o padrão `describeMatrix` (web e node), conforme `AGENTS.md`.
- Critério de pronto: `pnpm lint` e `pnpm typecheck` passam (ambos existem em `package.json`), e a suíte existente continua verde. Testes existentes só mudam se dependerem do que a mudança altera, e sem perder o que verificam.

### Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Recortar o corpo de um `ReadableStream` exige consumir o stream desde o início. | Custo de CPU e memória em arquivos grandes; seek em vídeo fica lento. | Tratar `Blob`, `ArrayBuffer`, `Uint8Array` e `string` com fatia direta. Para streams, descartar e limitar bytes com `TransformStream`, e documentar o custo. |
| `headers` vindos de `ServeStaticOptions` ou de um middleware anterior já trazem `Content-Length`. | `Content-Length` errado no 206. | Sobrescrever `Content-Length` quando o intervalo for aplicado. |
| `Content-Encoding` com Range: o intervalo recai sobre bytes comprimidos. | Clientes que esperam bytes decodificados recebem trechos inúteis. | Manter a semântica da RFC (intervalo sobre a variante escolhida) e documentar. Alternativa: ignorar Range em respostas com `Content-Encoding`. Decisão pendente. |
| Alterar a ordem de cabeçalhos pode quebrar testes existentes de cache e 304. | Regressão silenciosa. | Manter a ordem: condicionais, depois Range, depois corpo. Cobrir RF-07 com teste. |
| Chamar `getContents` quando o pedido é HEAD ou 416. | Leitura desnecessária do asset. | Responder antes de chamar `getContents` nesses casos. |
| Helpers expostos por engano em `index.ts`. | Quebra da restrição de API. | Manter helpers não exportados no módulo e revisar `src/index.ts` no diff. |
| Plataformas com `Blob.slice` ou `ReadableStream` diferentes (Node, Bun, Deno, Workers). | Comportamento diferente entre runtimes. | Rodar a matriz de testes em web e node, e usar só APIs web padrão. |

## Referências

- Issue h3js/h3#1267
- RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests)
- `sdd/pedido.md`
