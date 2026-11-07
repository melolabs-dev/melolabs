# PRD: HTTP Range no `serveStatic`

**Referência:** h3js/h3#1267 · contrato `sdd/pedido.md` · norma RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests)
**Área afetada:** `src/utils/static.ts` (e seus testes em `test/static.test.ts`)

## Problema e objetivo

### Problema

`serveStatic` ignora o cabeçalho `Range`. Toda requisição GET recebe 200 com o arquivo inteiro, e a resposta não traz `Accept-Ranges`, `Content-Range` nem status 206. Por causa disso:

- clientes não conseguem retomar downloads interrompidos;
- players de vídeo e áudio não conseguem avançar (seek), porque os navegadores dependem de 206 para isso;
- proxies e CDNs não recebem a sinalização de que o recurso aceita intervalos.

### Objetivo

Fazer `serveStatic` atender requisições de intervalo de bytes para GET e HEAD, conforme a RFC 9110, sem alterar a API pública. Cache, seleção de encoding, `fallthrough`, 404 e 405 devem continuar exatamente como hoje.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

**Dado** uma requisição GET ou HEAD para um asset encontrado,
**Quando** a resposta é montada, com ou sem cabeçalho `Range` na requisição,
**Então** a resposta inclui `Accept-Ranges: bytes`.

### RF-02 — Responder 206 a intervalo válido

**Dado** um asset de 10 bytes com `size` informado por `getMeta`,
**Quando** a requisição GET traz `Range: bytes=2-5`,
**Então** a resposta tem status 206, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, e o corpo contém somente os bytes 2 a 5.

Regras complementares desta história:

- `bytes=a-` vai do byte `a` até o fim do arquivo.
- `bytes=-n` é um sufixo com os últimos `n` bytes. Se `n` for maior que o tamanho, a resposta cobre o arquivo inteiro.
- Se o último byte pedido passar do fim, ele é limitado a `N-1`.

### RF-03 — HEAD com intervalo

**Dado** um asset de 10 bytes,
**Quando** a requisição HEAD traz `Range: bytes=2-5`,
**Então** a resposta tem status 206, `Content-Range: bytes 2-5/10` e `Content-Length: 4`, não tem corpo, e `getContents` não é chamado.

### RF-04 — 416 para intervalo não satisfazível

**Dado** um asset de 10 bytes,
**Quando** a requisição traz `Range: bytes=10-20` (início igual ou maior que o tamanho) ou `Range: bytes=-0`,
**Então** a resposta tem status 416, `Content-Range: bytes */10`, `Content-Length: 0`, não tem corpo, e `getContents` não é chamado.

### RF-05 — Ignorar Range malformado ou com múltiplos intervalos

**Dado** um asset de 10 bytes,
**Quando** o `Range` é sintaticamente inválido (`bytes=abc`, `items=0-1`, `bytes=5-2`) ou traz mais de um intervalo (`bytes=0-1,4-5`),
**Então** a resposta é 200 com o arquivo completo, sem `Content-Range`.

### RF-06 — Validar If-Range

**Dado** uma requisição com `Range: bytes=2-5` e `If-Range` igual ao validador atual do asset (ETag forte ou `Last-Modified` exato),
**Quando** a resposta é montada,
**Então** o intervalo é aplicado e a resposta é 206 (ou 416, se o intervalo não for satisfazível).

**Dado** a mesma requisição, mas com `If-Range` diferente do validador atual, ou com ETag fraca (`W/"..."`),
**Quando** a resposta é montada,
**Então** o `Range` é ignorado e a resposta é 200 com o arquivo completo.

### RF-07 — Condicionais antes de Range

**Dado** uma requisição com `Range: bytes=2-5` e `If-None-Match` que casa com o ETag atual,
**Quando** a resposta é montada,
**Então** a resposta é 304, como hoje, e não há 206 nem 416.

A mesma regra vale para `If-Modified-Since`. A avaliação condicional acontece antes da avaliação de Range (RFC 9110 §13.2.1).

### RF-08 — Range sobre a variante servida

**Dado** um asset com variante pré-comprimida escolhida por `accept-encoding` (por exemplo `/app.js.gz`, com `Content-Encoding: gzip`),
**Quando** a requisição traz `Range` válido,
**Então** `Content-Range` e `Content-Length` referem-se aos bytes da variante servida, obtidos do `size` de `getMeta` dessa variante, e `Content-Encoding`, `Content-Type` e `Vary` continuam como hoje.

### RF-09 — Sem tamanho conhecido, sem Range

**Dado** um `getMeta` que não devolve `size` (ou devolve um valor que a regra atual trata como ausente, como `0`),
**Quando** a requisição traz `Range` válido,
**Então** o `Range` é ignorado e a resposta é 200 com o arquivo completo, como hoje.

### RF-10 — Preservar comportamento existente

**Dado** uma requisição sem `Range`,
**Quando** a mudança está aplicada,
**Então** status, cabeçalhos e corpo são idênticos aos atuais, inclusive nos casos de cache (304), `Vary`, `fallthrough` e encoding.

**Dado** um asset inexistente, um método diferente de GET/HEAD ou um caminho não canônico, mesmo com cabeçalho `Range`,
**Quando** `serveStatic` é chamado,
**Então** a saída é a atual: 404, 405 com `allow: GET, HEAD`, ou `undefined` quando `fallthrough` está ativo.

### RF-11 — Sem novas exportações públicas

**Dado** o arquivo `src/index.ts` e o build,
**Quando** a mudança é aplicada,
**Então** nenhum nome novo (valor ou tipo) é exportado, as funções auxiliares ficam privadas em `src/utils/static.ts`, e as formas de `ServeStaticOptions` e `StaticAssetMeta` não mudam.

### RF-12 — Qualidade e testes

**Dado** a mudança concluída,
**Quando** rodam `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/static.test.ts`,
**Então** os três passam em modo `web` e `node`, com novos testes cobrindo RF-02 a RF-10. Se algum teste existente falhar por depender do comportamento antigo (200 para `Range`), ele é ajustado sem perder o que verifica.

## Fora de escopo

- Respostas `multipart/byteranges` (vários intervalos em uma resposta). Esses pedidos são ignorados e servidos com 200 (RF-05).
- Nova opção em `ServeStaticOptions` ou mudança na assinatura de `getMeta`/`getContents` para receber o intervalo do backend. Isso fica para uma evolução futura, se o custo do RF-08 e do Risco 1 justificar.
- Suporte a `Range` em outros utilitários, como `proxy`, `sendStream` ou `h3/rules`.
- Recompressão sob demanda ou cache de respostas parciais.
- Mudanças em `Accept-Ranges` para respostas de erro além das listadas em RF-01.
- Documentação fora do JSDoc de `serveStatic`.

## Premissas e riscos

### Premissas

- **P1.** `getMeta` devolve `size` correto para o arquivo ou variante servida. Sem `size`, não há Range (RF-09).
- **P2.** `getContents` devolve o conteúdo completo do asset, e o recorte é feito sobre o `BodyInit` recebido. Não há parâmetro novo para o backend (ver "Fora de escopo").
- **P3.** Um `size` igual a `0` é tratado como desconhecido, seguindo a regra atual (`meta.size > 0`). Para arquivo vazio, o Range é ignorado. A RFC 9110 daria 416. Isso precisa ser confirmado antes da implementação.
- **P4.** A RFC 9110 prevalece sobre a RFC 7233 citada na issue, como diz o contrato.
- **P5.** Range é aplicado aos bytes codificados da variante servida, porque a RFC 9110 define o intervalo sobre o representation que o cliente recebe.

### Riscos

- **R1 (alto): `getContents` não recebe o intervalo.** Para `Blob`, `ArrayBuffer` e typed arrays, o recorte é direto. Para `ReadableStream` e `string`, pode ser preciso consumir o corpo inteiro ou descartar bytes até o início do intervalo, o que custa memória e tempo em vídeos grandes. Mitigação: tratar os tipos diretos primeiro, medir o caso de stream com um arquivo grande e registrar a decisão no PR.
- **R2 (médio): If-Range por data.** `Last-Modified` tem precisão de segundo, e `mtime` é truncado pelo código atual. A comparação deve usar a mesma forma truncada (RF-06).
- **R3 (médio): comportamento diferente entre runtimes.** Streams e `Blob` se comportam de forma diferente em Node, Bun e Web. Mitigação: testes com `describeMatrix` em `web` e `node`.
- **R4 (baixo): testes existentes.** Algum teste pode depender de 200 para `Range`. Mitigação: ajustar só o que depende da mudança, sem remover verificações (RF-12).
- **R5 (baixo): cache intermediário.** Respostas 206 de variantes codificadas podem ser misturadas por proxies. O `Vary: accept-encoding` já existente cobre o caso, mas vale conferir nos testes.
