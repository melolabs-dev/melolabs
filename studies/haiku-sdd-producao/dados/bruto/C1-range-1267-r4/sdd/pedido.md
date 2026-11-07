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

# Contrato enxuto: HTTP Range no `serveStatic` (h3js/h3#1267)

## Objetivo
Fazer o utilitário `serveStatic` (`src/utils/static.ts`) atender pedidos de intervalo de bytes, para permitir retomar downloads e avançar em vídeo e áudio servidos pelo h3, como pede a issue h3js/h3#1267.

## Norma
RFC 9110 (HTTP Semantics), seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue. Siga a issue e a norma.

## Nomes públicos
- A mudança fica dentro de `serveStatic`, usando as opções que ele já recebe (`ServeStaticOptions`); o tamanho do asset é o `size` devolvido por `getMeta`.

## Restrições
- Nenhuma exportação pública nova: `src/index.ts` não ganha nomes (nem valores nem tipos) e as funções auxiliares ficam privadas no módulo.
- Não quebrar o que já existe: cache, seleção de encoding, `fallthrough` e as respostas para asset inexistente e para método não permitido continuam como hoje.
- A suíte existente continua passando; ajuste só os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
