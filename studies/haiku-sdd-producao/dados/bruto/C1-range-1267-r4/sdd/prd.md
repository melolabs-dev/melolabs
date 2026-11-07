# PRD — HTTP Range no `serveStatic`

Referências: issue h3js/h3#1267, `sdd/pedido.md`, `src/utils/static.ts`.

## Problema e objetivo

**Problema.** `serveStatic` ignora o cabeçalho `Range`. Toda requisição recebe 200 com o arquivo inteiro, e a resposta não anuncia `Accept-Ranges`. Por isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek), porque os navegadores dependem de respostas 206;
- proxies e CDNs não recebem o comportamento HTTP esperado.

**Objetivo.** Fazer `serveStatic` atender pedidos de intervalo de bytes (GET e HEAD) para assets de tamanho conhecido, seguindo a RFC 9110 (seções 13.1.5 e 14). A API pública não muda, e o cache, a seleção de encoding, o `fallthrough` e as respostas 404 e 405 continuam como hoje, salvo onde o próprio Range exige mudança.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

`serveStatic` passa a enviar `Accept-Ranges: bytes` em toda resposta de um asset existente, mesmo quando o cliente não enviou `Range`.

- **Dado** um asset existente
- **Quando** o cliente faz GET sem cabeçalho `Range`
- **Então** a resposta é 200, traz `Accept-Ranges: bytes` e tem o corpo completo

### RF-02 — Responder 206 a um intervalo válido

Para GET com um único intervalo `bytes=início-fim` válido, o servidor responde 206 com `Content-Range: bytes início-fim/tamanho`, `Content-Length` igual ao número de bytes enviados e corpo com apenas esses bytes. Um `fim` além do último byte é reduzido ao último byte. Um intervalo `bytes=início-` vai até o fim do arquivo.

- **Dado** um asset de 10 bytes com conteúdo `0123456789`
- **Quando** o cliente envia `Range: bytes=2-5`
- **Então** a resposta é 206, com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo `2345`

### RF-03 — HEAD com intervalo válido

Para HEAD com intervalo válido, a resposta é 206 com os mesmos cabeçalhos do GET (`Content-Range`, `Content-Length`, `Content-Type`, `Accept-Ranges`) e sem corpo.

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz HEAD com `Range: bytes=0-3`
- **Então** a resposta é 206, com `Content-Range: bytes 0-3/10`, `Content-Length: 4` e corpo vazio

### RF-04 — Ignorar Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` não for um único intervalo bem formado na unidade `bytes` (vários intervalos, outra unidade, sintaxe inválida ou início maior que fim), o servidor ignora o Range e responde 200 com o arquivo completo.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=0-1,4-5`, `Range: items=0-1`, `Range: bytes=5-2` ou `Range: bytes=abc`
- **Então** a resposta é 200, sem `Content-Range`, com o corpo completo e com `Accept-Ranges: bytes`

### RF-05 — 416 para intervalo não satisfazível

Se o intervalo for sintaticamente válido, mas começar em ou depois do tamanho do asset, ou for um sufixo de 0 bytes, a resposta é 416 com `Content-Range: bytes */tamanho` e `Content-Length: 0`, sem corpo.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=10-20`
- **Então** a resposta é 416, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio

### RF-06 — Intervalo de sufixo

Um intervalo `bytes=-N` devolve os últimos N bytes. Se N for maior que o tamanho do arquivo, devolve o arquivo inteiro em 206.

- **Dado** um asset de 10 bytes com conteúdo `0123456789`
- **Quando** o cliente envia `Range: bytes=-3`
- **Então** a resposta é 206, com `Content-Range: bytes 7-9/10` e corpo `789`
- **E** quando o cliente envia `Range: bytes=-50`, a resposta é 206, com `Content-Range: bytes 0-9/10` e corpo completo

### RF-07 — If-Range

Quando a requisição traz `If-Range` junto com `Range`, o intervalo só é aplicado se o valor casar com a versão atual do asset: um ETag forte igual ao `etag` do asset, ou uma data HTTP igual ao `last-modified`. Caso contrário, o Range é ignorado e a resposta é 200 completa. Um ETag fraco nunca casa com `If-Range`.

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `Range: bytes=0-3` e `If-Range: "v2"`
- **Então** a resposta é 200 com o corpo completo
- **E** quando o cliente envia o mesmo Range com `If-Range: "v1"`, a resposta é 206 com `bytes 0-3/10`

### RF-08 — Cache condicional tem precedência sobre Range

Se a requisição for condicional e o asset não tiver mudado (`If-None-Match` ou `If-Modified-Since` casam), a resposta é 304 como hoje, mesmo com `Range`. O Range só é avaliado quando não há 304.

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `If-None-Match: "v1"` e `Range: bytes=0-3`
- **Então** a resposta é 304, sem corpo

### RF-09 — Asset sem tamanho conhecido

Se `getMeta` não devolver `size`, ou devolver 0, o Range é ignorado e a resposta é 200 completa, como hoje.

- **Dado** um asset cujo `getMeta` não informa `size`
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é 200 com o corpo completo e sem `Content-Range`

### RF-10 — Representação com Content-Encoding

Quando a resposta tem `Content-Encoding` (asset pré-comprimido ou `meta.encoding`), o Range é ignorado e a resposta é 200 completa. Byte ranges sobre a representação codificada ficam fora do escopo.

- **Dado** um asset pré-comprimido com `gzip` selecionado pelo `accept-encoding`
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é 200 com `Content-Encoding: gzip` e o corpo completo

### RF-11 — Erros, método e fallthrough preservados

Asset inexistente continua gerando 404 (ou `undefined` com `fallthrough`). Método diferente de GET e HEAD continua gerando 405 com `Allow: GET, HEAD`. Um cabeçalho `Range` não altera nenhum desses caminhos.

- **Dado** um caminho sem asset correspondente
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é 404, como antes

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem 200 completo (RF-04).
- Byte ranges sobre representações com `Content-Encoding` (RF-10).
- Mudança no contrato de `getMeta` e `getContents`, como passar o intervalo ao backend, ou novas opções em `ServeStaticOptions`.
- Novas exportações públicas: `src/index.ts` não ganha nomes, nem valores nem tipos.
- Range em outros utilitários, como `proxy`, `h3/rules/cache` ou `sendStream`.
- Pré-condições `If-Match` e `If-Unmodified-Since`.
- Leitura parcial real no backend. O recorte é feito no `serveStatic`.

## Premissas e riscos

### Premissas

- A norma de referência é a RFC 9110, que substitui a RFC 7233 citada na issue.
- `meta.size` é o tamanho da representação que será servida. Hoje ele já alimenta `Content-Length`.
- `getContents(id)` não recebe intervalo. O recorte dos bytes é feito dentro de `serveStatic`, a partir do `BodyInit` devolvido.
- Decisão tomada: Range é ignorado quando há `Content-Encoding` (RF-10). Isso é permitido pela RFC 9110 e evita ranges sobre bytes comprimidos.
- Restrições do projeto: helpers privados ao módulo; nenhuma exportação pública nova; cache, encoding, `fallthrough`, 404 e 405 inalterados; `pnpm lint` e `pnpm typecheck` passam; a suíte existente continua passando, com ajustes apenas nos testes que dependem do que a mudança altera.
- Os testes novos seguem o padrão `describeMatrix`, rodando em `web` e `node`.

### Riscos

- **Recorte de `ReadableStream`.** Se `getContents` devolver um stream, descartar o prefixo pode exigir ler o arquivo inteiro. Em vídeos grandes isso anula o ganho. Blob e string podem ser recortados sem custo, então a implementação deve tratar esses casos diretamente e medir o caso de stream.
- **`Content-Length` já definido.** `serveStatic` só define `Content-Length` quando ele está ausente, e `options.headers` pode trazer o valor. Em 206 e 416 o valor precisa ser sobrescrito de forma explícita.
- **Mudança de comportamento observável.** Toda resposta ganha `Accept-Ranges`, e HEAD com Range passa de 200 para 206. Testes que checam o conjunto exato de cabeçalhos ou o status de HEAD vão falhar e precisam ser ajustados com cuidado.
- **Comparação de datas em `If-Range`.** `last-modified` é truncado para segundos. A comparação deve usar a mesma precisão.
- **Assets de tamanho 0.** Com `size` igual a 0, o Range é ignorado (RF-09). Isso evita um 416 sem sentido em arquivo vazio.
