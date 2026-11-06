# Issue h3js/h3#1267: Feature request: HTTP Range support for serveStatic

### Describe the feature

Describe the feature

serveStatic currently ignores HTTP Range requests. When a client sends a Range header, the server still responds with the full response body and does not include partial-content headers. This prevents:

Download resumption

Media seeking in browsers and video/audio players

Proper CDN and proxy behavior


This feature request proposes adding byte range support to serveStatic for GET and HEAD requests when the asset size is known.

Proposed behavior

Always advertise Accept-Ranges: bytes

Support only a single byte range

Ignore malformed or multi-range requests and serve the full response

For valid ranges:

Respond with 206 Partial Content

Include Content-Range and correct Content-Length

For HEAD, send headers only


For unsatisfiable ranges:

Respond with 416 Range Not Satisfiable

Include Content-Range: bytes */<size>

Content-Length: 0



Important constraints

Preserve existing caching, encoding selection, fallthrough behavior, and 404/405 handling

Do not introduce new public exports

Keep all helper logic private within the serveStatic module


Use cases

Video/audio streaming

Resumable file downloads

Browser compatibility

Better support for media players and HTTP clients



Additional information

This behavior aligns with RFC 7233 and matches what users expect from static file servers. Most modern browsers automatically send range requests for media, and lack of support breaks playback and seeking.

No API changes are required—this is a backward-compatible internal enhancement to serveStatic.


### Additional information

- [x] Would you be willing to help implement this feature?


---

# Contrato: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)


## Objetivo
Fazer o utilitário `serveStatic` (em `src/utils/static.ts`) atender pedidos de intervalo de bytes (cabeçalho `Range`), seguindo a RFC 9110, seção 14 (antiga RFC 7233). Isso permite, por exemplo, retomar downloads e avançar em vídeos e áudios servidos pelo h3.

## Comportamento esperado
1. **Anúncio de suporte.** Toda resposta que serve um asset encontrado traz `Accept-Ranges: bytes`, haja ou não `Range` no pedido.
2. **Um intervalo só.** São aceitas as três formas de um intervalo único da norma: início e fim (`bytes=a-b`), início aberto até o fim do arquivo (`bytes=a-`) e sufixo com os últimos N bytes (`bytes=-n`). O tamanho do asset é o `size` informado por `getMeta`.
3. **Resposta parcial.** Para um intervalo válido e satisfazível, a resposta é `206 Partial Content`, com o corpo contendo só os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho enviado. Um fim que passa do tamanho do asset é limitado ao último byte.
4. **Intervalo não satisfazível.** Quando o início do intervalo está no tamanho do asset ou além dele, a resposta é `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.
5. **Pedidos que devem ser ignorados.** Pedido com vários intervalos (multi-range) ou com `Range` malformado (unidade diferente de `bytes`, sintaxe inválida, início maior que o fim) não gera erro: o `Range` é ignorado e a resposta é a normal, `200` com o corpo inteiro.
6. **HEAD.** Um `HEAD` com `Range` devolve os mesmos status e cabeçalhos que o `GET` equivalente devolveria, sem corpo.
7. **Representação codificada.** Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, a representação efetivamente enviada.
8. **If-Range.** Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com o corpo inteiro. Se corresponde, o `Range` é aplicado normalmente. A comparação de entity-tag segue a norma (comparação forte).

## O que não pode mudar
- Cabeçalhos de cache e de conteúdo (`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding`) continuam iguais aos da resposta completa também nas respostas parciais.
- Respostas `304` por `If-None-Match`/`If-Modified-Since`, a seleção de encoding, o `fallthrough`, o `404` para asset inexistente e o `405` para métodos diferentes de `GET`/`HEAD` continuam funcionando como hoje.
- Nenhuma exportação pública nova: `src/index.ts` não ganha nomes novos (nem valores nem tipos), e as funções auxiliares ficam privadas dentro do módulo, sem `export`.
- O conjunto de testes existente e o `pnpm lint` / `pnpm typecheck` continuam passando.