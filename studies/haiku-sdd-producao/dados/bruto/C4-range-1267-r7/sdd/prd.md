# PRD: suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

O `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o corpo inteiro, sem `Content-Range` e sem status `206`. Por isso:

- downloads não podem ser retomados;
- players de áudio e vídeo não conseguem avançar (seek) em arquivos servidos pelo h3;
- CDNs e proxies não recebem o comportamento esperado para conteúdo parcial.

**Objetivo:** fazer o `serveStatic` atender a um único intervalo de bytes válido para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar as respostas que já funcionam hoje (cache, seleção de encoding, `fallthrough`, 404 e 405).

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range nas respostas de asset

O `serveStatic` deve enviar `Accept-Ranges: bytes` nas respostas de asset encontrado (200, 206 e 416), também em `HEAD`.

**Critério de aceite**

- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`,
- **Então** a resposta é `200` com `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder 206 para um intervalo válido

Para um único intervalo válido, o `serveStatic` deve responder `206 Partial Content`, com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho. Devem ser aceitas as formas `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-n` (últimos `n` bytes).

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 0 a 99.

### RF-03 — Ignorar Range malformado, de outra unidade ou com múltiplos intervalos

Se o cabeçalho `Range` for malformado, usar outra unidade que não `bytes`, ou tiver mais de um intervalo, o `serveStatic` deve ignorá-lo e responder `200` com o corpo completo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-10,20-30`, `Range: items=0-10` ou `Range: bytes=abc`,
- **Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

### RF-04 — Responder 416 para intervalo não satisfazível

Quando o intervalo for sintaticamente válido, mas não puder ser atendido pelo tamanho do asset, o `serveStatic` deve responder `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=2000-3000`,
- **Então** a resposta é `416` com `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-05 — HEAD com Range envia só cabeçalhos

Para `HEAD`, a resposta com Range (206 ou 416) deve trazer os mesmos cabeçalhos que a resposta `GET` correspondente, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-99`,
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-06 — Respeitar If-Range

Se o cabeçalho `If-Range` estiver presente, o `Range` só deve ser atendido quando o validador enviado corresponder ao atual do asset (ETag forte ou data `Last-Modified` exata). Caso contrário, o `serveStatic` deve ignorar o `Range` e responder `200` com o corpo completo.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`,
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "xyz"`,
- **Então** a resposta é `200` com o corpo completo.
- **E** quando o cliente envia o mesmo `Range` com `If-Range: "abc"`, a resposta é `206`.

### RF-07 — Asset sem tamanho conhecido não recebe Range

Se `getMeta` não devolver `size`, ou devolver `0`, o `serveStatic` deve ignorar o `Range` e responder como hoje.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size`,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta é `200` com o corpo completo.

### RF-08 — Preservar o comportamento existente

A mudança não pode alterar: a resposta `304` (que continua sendo avaliada antes de qualquer Range), a escolha da variante comprimida conforme `accept-encoding`, o cabeçalho `Vary`, o `fallthrough`, a resposta `404` para asset inexistente e a resposta `405` para método não permitido.

**Critério de aceite**

- **Dado** uma requisição com `If-None-Match` igual ao ETag atual e um `Range` válido,
- **Quando** o `serveStatic` processa a requisição,
- **Então** a resposta é `304`, como hoje.
- **E** com `fallthrough: true` e asset inexistente, a função continua retornando `undefined`.

### RF-09 — Sem exportações públicas novas

Os helpers de Range devem ficar privados em `src/utils/static.ts`. `src/index.ts` não deve ganhar nenhum nome, valor ou tipo novo.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exports de `src/index.ts` (e dos entries de plataforma) com a versão anterior,
- **Então** a lista é idêntica.

### RF-10 — Cobertura de testes nos dois modos de execução

Deve haver testes cobrindo RF-01 a RF-07 com `describeMatrix` (modos `web` e `node`). Testes existentes só podem ser ajustados quando dependerem do comportamento alterado, sem perder o que verificam.

**Critério de aceite**

- **Dado** a suíte após a mudança,
- **Quando** executo `pnpm vitest run` nos arquivos de static e `pnpm test`,
- **Então** os novos testes passam nos modos `web` e `node`, e `pnpm lint` e `pnpm typecheck` passam.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). A issue pede que sejam ignorados.
- Unidades diferentes de `bytes`.
- Range em respostas que não sejam de asset do `serveStatic` (proxy, cache de rules, JSON, etc.).
- Mudança na assinatura de `getMeta` ou `getContents` (por exemplo, passar o intervalo ao backend). O contrato proíbe novas opções públicas.
- Otimização de leitura parcial no backend (ler do disco só o trecho pedido).
- Compressão dinâmica de respostas parciais.
- Mudanças em `ServeStaticOptions` ou em qualquer outro utilitário público.

## Premissas e riscos

### Premissas

- `meta.size` corresponde ao tamanho da variante que será servida (incluindo variante comprimida como `.gz` ou `.br`). Se o `size` não corresponder, a faixa será calculada errada.
- O `Range` se aplica à representação servida. Quando a resposta vem comprimida, a faixa vale para os bytes codificados, como a RFC permite.
- Os validadores para `If-Range` são o ETag (somente forte) e o `Last-Modified` já calculado pelo `serveStatic`.
- A decisão de anunciar `Accept-Ranges` em 304 e em respostas de erro fica de fora. Vale apenas para 200, 206, 416 e `HEAD`.
- Para `bytes=-n` com `n` maior que o tamanho, a faixa começa em `0`, como manda a RFC.

### Riscos

- **Fatiamento do corpo.** `getContents(id)` não recebe intervalo, então o `serveStatic` precisa fatiar o corpo devolvido. Isso é direto para `string`, `ArrayBuffer`, `Blob` e `TypedArray`. Para `ReadableStream`, o corpo precisa ser consumido e fatiado em memória, o que pode ser caro em vídeos grandes. Esta é a principal decisão em aberto: aceitar a limitação e documentá-la, ou propor uma opção futura (fora deste escopo).
- **Content-Length já definido.** A lógica atual só define `Content-Length` se o cabeçalho ainda não existir. Em uma resposta 206 o valor precisa ser sobrescrito, e um `Content-Length` vindo de `options.headers` não pode prevalecer.
- **Cabeçalhos vindos de `options.headers`.** Cabeçalhos configurados pelo usuário (como `Content-Range` ou `Content-Length`) podem conflitar com a resposta parcial. Precisa haver teste ou decisão explícita.
- **Interação com `If-Range` fraco.** ETag fraco (`W/"..."`) não deve satisfazer `If-Range`. Um teste específico é necessário.
- **Testes existentes.** A busca nos testes não encontrou verificações de Range já existentes para `serveStatic`. Ainda assim, os testes de `serveStatic` devem ser executados antes e depois da mudança para confirmar que nada regrediu.
