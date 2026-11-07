# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o corpo inteiro com status 200 e sem cabeçalhos de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em players de navegador;
- o comportamento esperado por CDNs e proxies.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, sem novas opções e sem mudar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

Todo asset servido por `GET` ou `HEAD` (respostas 200, 206 e 416) deve trazer `Accept-Ranges: bytes`.

**Critério de aceite**

- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`,
- **Então** a resposta é 200 com `Accept-Ranges: bytes`.

### RF-02 — Responder intervalo válido com 206

Quando o cabeçalho `Range` tem um único intervalo válido (`bytes=inicio-fim`, `bytes=inicio-` ou `bytes=-sufixo`) e está dentro do tamanho do asset, a resposta é 206 com o trecho pedido, `Content-Range: bytes inicio-fim/tamanho` e `Content-Length` igual ao tamanho do trecho. Um `fim` maior que o tamanho é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 10 bytes com conteúdo conhecido,
- **Quando** o cliente envia `Range: bytes=2-5`,
- **Então** a resposta é 206, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e o corpo contém exatamente os bytes 2 a 5.

### RF-03 — HEAD com Range

Para `HEAD`, um intervalo válido responde 206 apenas com cabeçalhos (`Content-Range`, `Content-Length` do trecho, `Accept-Ranges`) e corpo vazio.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-3`,
- **Então** a resposta é 206, `Content-Range: bytes 0-3/10`, `Content-Length: 4` e o corpo está vazio.

### RF-04 — Intervalo não satisfazível retorna 416

Quando o intervalo começa além do fim do asset, ou quando o sufixo é zero, a resposta é 416 com `Content-Range: bytes */tamanho` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=20-30`,
- **Então** a resposta é 416, `Content-Range: bytes */10`, `Content-Length: 0`.

### RF-05 — Ignorar Range malformado ou com múltiplos intervalos

Um cabeçalho `Range` malformado, com unidade diferente de `bytes` ou com mais de um intervalo é ignorado. A resposta é o asset completo com status 200.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=0-1,4-5` ou `Range: lines=0-1`,
- **Então** a resposta é 200 com o corpo completo e sem `Content-Range`.

### RF-06 — Validar Range com If-Range

Quando o cabeçalho `If-Range` está presente, o `Range` só é aplicado se o validador (ETag forte ou data de `Last-Modified`) coincidir com o do asset atual. Caso contrário, o `Range` é ignorado e a resposta é 200 completa. Esta regra vem da RFC 9110 (seção 13.1.5) e não está no texto da issue; ela é necessária para que retomadas não misturem versões diferentes do mesmo arquivo.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "v0"`,
- **Então** a resposta é 200 completa.
- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "v1"`,
- **Então** a resposta é 206 com os bytes 0 a 3.

### RF-07 — Preservar a avaliação condicional

A verificação de cache (`If-None-Match` e `If-Modified-Since`) continua acontecendo antes do `Range`. Se o asset não mudou, a resposta é 304, mesmo que o pedido traga `Range`.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-None-Match: "v1"`,
- **Então** a resposta é 304 sem corpo, como hoje.

### RF-08 — Ignorar Range quando o tamanho é desconhecido

Se `getMeta` não devolver `size` (ou devolver zero), o `Range` é ignorado e a resposta é 200 completa, como pede a issue ("when the asset size is known").

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é 200 completa, com `Accept-Ranges: bytes` e sem `Content-Range`.

### RF-09 — Range com variante pré-comprimida

Quando o asset servido é uma variante pré-comprimida (`meta.encoding` definido), o intervalo se refere aos bytes da variante, e o cabeçalho `Content-Encoding` é mantido na resposta 206.

**Critério de aceite**

- **Dado** um asset `app.js` com variante `app.js.gz` (encoding `gzip`) de 40 bytes, e um cliente que aceita `gzip`,
- **Quando** o cliente envia `Range: bytes=0-9`,
- **Então** a resposta é 206 com `Content-Encoding: gzip`, `Content-Range: bytes 0-9/40` e os 10 primeiros bytes da variante.

### RF-10 — Preservar comportamentos existentes

Range não altera: `Vary: accept-encoding`, `Content-Type`, `Last-Modified`, `ETag`, `fallthrough`, a resposta 404 para asset inexistente, a resposta 405 para método não permitido (com `Allow: GET, HEAD`), nem a rejeição de caminhos não canônicos. Requisições que caem nessas situações ignoram `Range`.

**Critério de aceite**

- **Dado** uma requisição `POST` com `Range: bytes=0-3`,
- **Quando** `serveStatic` é chamado,
- **Então** a resposta é 405 com `Allow: GET, HEAD`, como hoje.
- **Dado** um asset inexistente com `Range: bytes=0-3` e `fallthrough: true`,
- **Quando** `serveStatic` é chamado,
- **Então** a função retorna `undefined`, como hoje.

### RF-11 — Sem novas exportações nem novas opções

A mudança fica dentro de `src/utils/static.ts`. `src/index.ts` não ganha nomes (valores ou tipos), `ServeStaticOptions` e `StaticAssetMeta` não mudam, e as funções auxiliares ficam privadas no módulo.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações públicas com a versão anterior,
- **Então** a lista é idêntica e a assinatura de `serveStatic` não muda.

### RF-12 — Cobertura de testes

Os testes novos seguem o padrão `describeMatrix` (modos `web` e `node`) e cobrem RF-01 a RF-10. Os testes existentes continuam passando; se algum depender do comportamento alterado, ele é ajustado sem perder o que verifica.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** rodo `pnpm vitest run` nos testes de static e `pnpm lint` e `pnpm typecheck`,
- **Então** todos passam nos dois modos.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem 200 completo (RF-05).
- Alterar a assinatura de `getContents` ou `getMeta` para receber um intervalo do backend. Isso exigiria nova API pública.
- Validação de `If-Range` com data quando o asset não informa `mtime` (sem `Last-Modified`): o `Range` é ignorado nesse caso.
- Range para assets com tamanho desconhecido (streaming sem `size`).
- Ajustes em `h3/rules`, `h3/rules/proxy` ou `h3/rules/cache`.
- Benchmarks de desempenho para trechos grandes.
- Mudança na política de cache (`Cache-Control`) ou em `ocache`.

## Premissas

- **P-01:** `getContents` devolve um `BodyInit` (string, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` ou `null`). O fatiamento será feito dentro de `serveStatic`, sem novas opções.
- **P-02:** O `size` informado por `getMeta` é o tamanho real da representação servida (variante pré-comprimida inclusa). Se o backend informar um valor errado, o `Content-Range` também ficará errado.
- **P-03:** `Last-Modified` e ETag já são definidos antes da verificação de `Range`, então `If-Range` pode reutilizar os mesmos valores (RF-06).
- **P-04:** `Accept-Ranges: bytes` é anunciado mesmo quando o `Range` é ignorado por falta de `size` (RF-08), para manter o cabeçalho presente em todos os assets servidos.
- **P-05:** O projeto segue as convenções de `AGENTS.md` (ESM, `.ts` nas importações, `describeMatrix` nos testes, helpers no fim do arquivo).

## Riscos

- **R-01 — Fatiar `ReadableStream` sem carregar tudo na memória.** Para streams, é preciso descartar bytes até o início e limitar o fim. Se o fatiamento consumir o stream inteiro, arquivos grandes podem causar pico de memória. Mitigação: implementar `pull` com contagem de bytes e testar com um stream grande.
- **R-02 — Tipos de corpo não fatiáveis.** `BodyInit` cobre formatos que nem sempre têm `slice` (por exemplo, `FormData` ou `URLSearchParams`). Mitigação: tratar os formatos suportados e, para os demais, ignorar `Range` e responder 200 completo.
- **R-03 — Regressão em cache e 304.** Mudar a ordem de verificação pode quebrar `If-None-Match`. Mitigação: manter a ordem atual e cobrir com teste (RF-07).
- **R-04 — Conflito com variantes pré-comprimidas.** Um cliente pode retomar um download de variante `gzip` com um `Range` da variante errada se trocar de `Accept-Encoding` entre as requisições. Mitigação: `Vary: accept-encoding` já existe; documentar o caso.
- **R-05 — Tamanho divergente de `Content-Length`.** `serveStatic` só define `Content-Length` quando ainda não existe no cabeçalho de resposta. Na resposta 206 é preciso sobrescrever esse valor. Mitigação: definir explicitamente o `Content-Length` do trecho e testar com um cabeçalho pré-definido pelo usuário em `options.headers`.
- **R-06 — Regras de `Range` e `If-Range` mais complexas que a issue.** A RFC 9110 tem casos de borda (sufixo maior que o asset, `bytes=0-` em asset vazio). Mitigação: cobrir esses casos nos testes unitários e manter a lógica privada.
