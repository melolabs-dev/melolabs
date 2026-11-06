# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando um cliente pede um trecho de um arquivo, o h3 responde sempre com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- players de áudio e vídeo não conseguem avançar (seek) no conteúdo;
- CDNs e proxies não conseguem tratar o arquivo corretamente em trechos.

Objetivo: fazer `serveStatic` atender pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110, seção 14 (antiga RFC 7233), sem alterar a API pública nem o comportamento atual nos demais casos.

## Requisitos funcionais

### RF-01 — Anúncio de suporte a Range

Toda resposta que serve um asset encontrado traz `Accept-Ranges: bytes`, com ou sem cabeçalho `Range` no pedido.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`
- **Então** a resposta contém `Accept-Ranges: bytes`

### RF-02 — Intervalo único nas três formas

São aceitas as formas de intervalo único: `bytes=a-b`, `bytes=a-` (do byte `a` até o fim) e `bytes=-n` (os últimos `n` bytes). O tamanho usado é o `size` informado por `getMeta`.

**Critério de aceite**

- **Dado** um asset de tamanho N com `getMeta` informando `size` N
- **Quando** o cliente envia `Range: bytes=a-b` com `a <= b < N`
- **Então** a resposta é `206 Partial Content`, com `Content-Range: bytes a-b/N` e `Content-Length` igual a `b - a + 1`, e o corpo contém somente esses bytes

### RF-03 — Limite do fim do intervalo

Um fim maior que o tamanho do asset é limitado ao último byte. Para o sufixo, um `n` maior que N devolve o asset inteiro.

**Critério de aceite**

- **Dado** um asset de tamanho N
- **Quando** o cliente envia `Range: bytes=a-b` com `b >= N` (ou `Range: bytes=-n` com `n > N`)
- **Então** a resposta é `206 Partial Content` com o fim limitado a `N - 1` (ou, no sufixo, com `Content-Range: bytes 0-(N-1)/N`), e `Content-Length` correspondente ao trecho enviado

### RF-04 — Intervalo não satisfazível

Quando o início do intervalo está em N ou além, a resposta é `416`, sem corpo.

**Critério de aceite**

- **Dado** um asset de tamanho N
- **Quando** o cliente envia `Range: bytes=a-` ou `bytes=a-b` com `a >= N`
- **Então** a resposta é `416 Range Not Satisfiable`, com `Content-Range: bytes */N`, `Content-Length: 0` e sem corpo

### RF-05 — Ignorar Range malformado ou com múltiplos intervalos

Pedidos com vários intervalos, unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim não geram erro. O `Range` é ignorado e a resposta é a normal.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `Range` com multi-range (`bytes=0-1,3-4`), unidade diferente (`items=0-1`), sintaxe inválida (`bytes=abc`) ou intervalo invertido (`bytes=5-2`)
- **Então** a resposta é `200 OK` com o corpo inteiro e sem `Content-Range`, sem erro

### RF-06 — HEAD com Range

Um `HEAD` com `Range` devolve os mesmos status e cabeçalhos que o `GET` equivalente devolveria, sem corpo.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `HEAD` com `Range: bytes=a-b` válido, ou com `Range` não satisfazível
- **Então** a resposta tem o mesmo status (`206` ou `416`) e os mesmos `Content-Range` e `Content-Length` do `GET` equivalente, com corpo vazio

### RF-07 — Representação pré-comprimida

Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, que é a representação efetivamente enviada.

**Critério de aceite**

- **Dado** um asset com variante `.gz` configurada em `encodings` e `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** o `Content-Range` usa o tamanho da variante `.gz` (vindo de `getMeta` para o id da variante), e `Content-Encoding: gzip` é mantido

### RF-08 — Validação de If-Range

Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado. Se corresponde, o `Range` é aplicado. A comparação de entity-tag é forte.

**Critério de aceite**

- **Dado** um asset com `ETag` `"v1"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "v0"`
- **Então** a resposta é `200 OK` com o corpo inteiro
- **E Quando** o cliente envia o mesmo `Range` com `If-Range: "v1"`
- **Então** a resposta é `206 Partial Content` com o trecho pedido
- **E** um `If-Range` com `W/"v1"` (entity-tag fraca) não corresponde e resulta em `200`

### RF-09 — Preservação do comportamento existente

Nada do que já funciona pode mudar. Isso vale para cabeçalhos de cache e conteúdo, que continuam iguais aos da resposta completa também nas parciais (`ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type`, `Content-Encoding`), e para o restante do fluxo.

**Critério de aceite**

- **Dado** o conjunto de testes atual e os pedidos sem `Range`
- **Quando** a implementação está aplicada
- **Então** as respostas `200`, `304` (`If-None-Match`/`If-Modified-Since`), `404`, `405`, `fallthrough` e a seleção de encoding são idênticas às atuais, `src/index.ts` não ganha exports novos (nem valores nem tipos), as funções auxiliares não são exportadas, e `pnpm test`, `pnpm lint` e `pnpm typecheck` passam

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): pedidos com multi-range são ignorados (RF-05).
- Alteração das assinaturas de `getMeta` e `getContents` ou criação de nova opção pública para range.
- Suporte a Range em outros utilitários (`proxy`, `serveStatic` de outros handlers, rules de cache do `h3/rules`).
- Cache de trechos ou otimização de I/O por seek além do necessário para entregar o trecho.
- Tratamento de `If-Range` com data (ver premissas).
- Range em assets cujo `size` não é informado por `getMeta` (o `Range` é ignorado nesse caso).
- Documentação extensa fora do próprio código e dos testes.

## Premissas

- **P1 — Tamanho conhecido.** `getMeta` informa `size` para os assets em que o Range deve ser atendido. Sem `size`, o `Range` é ignorado e a resposta segue como hoje (conforme a issue: "when the asset size is known").
- **P2 — Mecanismo de fatiamento.** O contrato não define como enviar só o trecho usando `getContents`, que retorna o `BodyInit` completo. Assume-se que o trecho pode ser obtido dentro do módulo, sem API nova. Isto precisa ser confirmado no desenho técnico (ver riscos).
- **P3 — Sufixo zero.** `bytes=-0` é tratado como não satisfazível (416), conforme a RFC 9110. O contrato não cita este caso.
- **P4 — Respostas sem Accept-Ranges.** Assume-se que `304`, `404` e `405` não recebem `Accept-Ranges`, porque não servem um asset. O contrato diz "toda resposta que serve um asset encontrado", o que deixa `304` em aberto. Confirmar.
- **P5 — Size da variante.** Quando há variante pré-comprimida, o `size` usado é o que `getMeta` devolve para o id dessa variante, como já acontece hoje com `content-length`.
- **P6 — If-Range com data.** O contrato só fala de entity-tag. Assume-se que um `If-Range` com data não corresponde (resposta `200` completa) até decisão contrária. Confirmar.
- **P7 — Sufixo maior que o arquivo.** `bytes=-n` com `n > N` devolve o asset inteiro com `206`, como manda a RFC 9110. O contrato não cita este caso explicitamente.

## Riscos

- **R1 — Fatiamento em memória.** Se `getContents` devolver um corpo que precisa ser lido por completo para fatiar, arquivos grandes podem consumir muita memória. Mitigação: definir no desenho técnico como o trecho é obtido (por exemplo, fatiando `Blob`/stream sem carregar tudo) antes de implementar.
- **R2 — Divergência entre `size` e o tamanho real.** Se `getMeta` informar um `size` diferente do conteúdo servido, `Content-Range` e `Content-Length` ficam errados. Mitigação: documentar a exigência de `size` correto e cobrir o caso em teste.
- **R3 — Regressão em respostas existentes.** Mudanças em `content-length` e no fluxo de encoding podem alterar `200`, `304`, `404` ou `405`. Mitigação: RF-09 com a suíte atual e testes de regressão antes da mudança, seguindo o fluxo de bug fix do `AGENTS.md`.
- **R4 — Cache e Vary.** Respostas parciais de variantes diferentes podem ser cacheadas de forma errada se `Vary` não estiver correto. Mitigação: manter `Vary: accept-encoding` nas parciais (RF-07, RF-09) e testar.
- **R5 — Compatibilidade com proxies e CDNs.** Comportamento divergente da RFC em `416`, `HEAD` ou `If-Range` pode quebrar clientes de mídia. Mitigação: seguir a RFC 9110 nos casos cobertos e registrar as premissas P3, P4, P6 e P7 para revisão.
- **R6 — Vazamento de API pública.** Helpers novos exportados por engano mudariam `src/index.ts`. Mitigação: helpers sem `export` e verificação do `index.ts` no critério RF-09.
