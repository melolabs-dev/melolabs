# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o corpo completo com status 200 e sem cabeçalhos de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players, que enviam `Range` automaticamente;
- um comportamento correto em CDNs e proxies, que dependem de `Accept-Ranges` e de respostas 206.

**Objetivo:** fazer `serveStatic` atender pedidos `Range` para `GET` e `HEAD` conforme a RFC 9110 (seções 13.1.5 e 14), sem mudar a API pública, sem novas exportações e sem alterar o comportamento de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Toda resposta de sucesso de `serveStatic` para `GET` ou `HEAD` deve incluir `Accept-Ranges: bytes`, mesmo quando o cliente não envia `Range`.

**Critério de aceite**

- **Dado** um asset existente com tamanho conhecido,
- **Quando** o cliente faz `GET` (ou `HEAD`) sem cabeçalho `Range`,
- **Então** a resposta é 200, contém `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder 206 a um intervalo válido

Quando o cliente envia um único intervalo de bytes válido e o tamanho do asset é conhecido, `serveStatic` responde 206 Partial Content com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Os intervalos aceitos são `bytes=<início>-<fim>`, `bytes=<início>-` (até o fim) e `bytes=-<n>` (últimos `n` bytes).

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `GET` com `Range: bytes=0-99`,
- **Então** a resposta é 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 0 a 99.

### RF-03 — HEAD com intervalo válido

Para `HEAD` com intervalo válido, a resposta tem os mesmos cabeçalhos de RF-02 (status 206, `Content-Range`, `Content-Length` do intervalo) e não tem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=500-`,
- **Então** a resposta é 206, `Content-Range: bytes 500-999/1000`, `Content-Length: 500` e o corpo está vazio.

### RF-04 — Ignorar Range malformado ou com múltiplos intervalos

Quando o cabeçalho `Range` é malformado, usa outra unidade que não `bytes`, ou traz mais de um intervalo, `serveStatic` ignora o cabeçalho e responde 200 com o corpo completo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-10,20-30`, ou `Range: items=0-10`, ou `Range: bytes=abc`,
- **Então** a resposta é 200, sem `Content-Range`, com o corpo completo.

### RF-05 — Responder 416 a intervalo não satisfazível

Quando o intervalo é sintaticamente válido, mas não cabe no asset (por exemplo, início maior ou igual ao tamanho), a resposta é 416 Range Not Satisfiable com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `GET` com `Range: bytes=1000-1010`,
- **Então** a resposta é 416, `Content-Range: bytes */1000`, `Content-Length: 0` e o corpo está vazio.

### RF-06 — Validar `If-Range`

Quando o cliente envia `If-Range` e o validador não corresponde ao estado atual do asset (ETag forte ou data `Last-Modified`), `serveStatic` ignora `Range` e responde 200 com o corpo completo. Quando o validador corresponde, o intervalo é aplicado normalmente.

**Critério de aceite**

- **Dado** um asset com ETag `"v2"`,
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "v1"`,
- **Então** a resposta é 200 com o corpo completo;
- **E** quando envia o mesmo `Range` com `If-Range: "v2"`, a resposta é 206 com os bytes 0 a 99.

### RF-07 — Preservar o fluxo existente

Os comportamentos atuais não mudam: a checagem condicional (`If-None-Match` e `If-Modified-Since`, que responde 304) continua acontecendo antes de qualquer tratamento de `Range`; a seleção de variante por `Accept-Encoding` continua igual; `fallthrough` continua valendo para asset inexistente e para método não permitido; 404 e 405 continuam como hoje.

**Critério de aceite**

- **Dado** um asset com ETag que o cliente já tem,
- **Quando** o cliente envia `Range: bytes=0-99` com `If-None-Match` igual ao ETag,
- **Então** a resposta é 304, como hoje.
- **E** **Dado** um método `POST` com `Range`, **quando** a requisição chega a `serveStatic`, **então** a resposta é 405 (ou `fallthrough`), como hoje.

### RF-08 — Sem novas exportações e helpers privados

A mudança fica no módulo `src/utils/static.ts`. `src/index.ts` e os demais pontos de exportação públicos não ganham nomes (nem valores nem tipos). Funções auxiliares ficam privadas no módulo.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações públicas com a anterior,
- **Então** a lista é idêntica.

### RF-09 — Cobertura de testes nos dois runtimes

Os testes novos usam `describeMatrix` e rodam em `web` e `node`. Cobrem RF-01 a RF-07. Testes existentes só são ajustados se dependerem do comportamento alterado, sem perder o que verificam.

**Critério de aceite**

- **Dado** a suíte após a mudança,
- **Quando** se roda `pnpm vitest run` nos arquivos de static,
- **Então** todos os testes passam nos modos `web` e `node`;
- **E** `pnpm lint` e `pnpm typecheck` passam.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem 200 completo (RF-04).
- Unidades diferentes de `bytes`.
- Mudança na assinatura ou no contrato de `getMeta` e `getContents`, inclusive a inclusão de um parâmetro de intervalo. A issue pede que não haja mudança de API.
- Compressão sob demanda ou geração de variantes pré-comprimidas.
- Ranges para assets de tamanho desconhecido. Sem `size` válido, `Range` é ignorado e o corpo completo é servido.
- Alterações em `h3`'s demais utilitários (`proxy`, `cache`, `event-stream`).
- Documentação de usuário além de comentários JSDoc internos, salvo se o revisor pedir.

## Premissas e riscos

### Premissas

- `getMeta` devolve `size` correto para o arquivo que será servido, incluindo a variante pré-comprimida escolhida. Os intervalos são calculados sobre esse tamanho.
- Os intervalos são aplicados sobre a representação selecionada (a variante pré-comprimida, se houver). O `Content-Range` descreve os bytes dessa representação, como a RFC permite.
- Os sufixos `bytes=-n` e os intervalos abertos `bytes=n-` entram no escopo, pois fazem parte da RFC 9110 e são usados por players de mídia. A issue fala em "um único intervalo"; essa leitura é mais ampla e fica registrada aqui.
- `Last-Modified` e `ETag` já são definidos pelo código atual antes da checagem de `Range`, então `If-Range` pode usá-los.

### Riscos

- **Leitura completa do arquivo.** `getContents` devolve o corpo inteiro e não recebe intervalo. Para atender RF-02 sem mudar a API, o intervalo precisa ser recortado depois, o que pode ler o arquivo todo. Para vídeo grande, isso custa memória e tempo, e o ganho de seek fica limitado. Esse é o principal risco e precisa de decisão antes da implementação: aceitar o recorte em memória como primeira versão, ou abrir uma issue separada para um `getContents` que aceite intervalo.
- **Tamanho zero.** Hoje `content-length` não é definido quando `size` é 0. Um asset vazio com `Range` tem resposta indefinida pela RFC. A proposta é responder 416 com `bytes */0`, mas isso precisa ser confirmado.
- **Validador fraco no `If-Range`.** A RFC 9110 exige validador forte para `If-Range` com ETag. ETags fracas (`W/"..."`) devem ser tratadas como não correspondentes, o que força 200.
- **Cabeçalhos definidos antes.** O código atual define `content-length` antes do retorno de `HEAD`, e `options.headers` pode já ter definido `content-length` ou `content-range`. A implementação precisa sobrescrever esses cabeçalhos quando a resposta for 206 ou 416.
- **Pedidos de intervalo em rotas de fallback.** Se algum handler posterior tratar `Range`, pode haver dupla aplicação. Não há evidência disso no código atual, mas vale checar em `fallthrough`.
- **Testes existentes.** Alguns testes podem assumir 200 com qualquer `Range`. Eles devem ser ajustados só se a falha vier da mudança esperada.
