# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

Hoje `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um pedido com `Range` recebe o arquivo inteiro com `200 OK`, sem `Accept-Ranges`, sem `Content-Range` e sem `206`. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players, que enviam `Range` por padrão;
- que CDNs e proxies façam cache e entrega parcial corretamente.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes (`GET` e `HEAD`) conforme a RFC 9110, seções 13.1.5 (`If-Range`) e 14 (Range Requests), sem alterar a API pública, sem quebrar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` deve incluir `Accept-Ranges: bytes` em toda resposta de um asset encontrado (`200`, `206`, `416` e `HEAD`).

**Dado** um asset existente servido por `serveStatic`
**Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
**Então** a resposta contém `Accept-Ranges: bytes` e o corpo completo com `200`.

### RF-02 — Resposta parcial com `206`

Para um cabeçalho `Range` com uma única faixa válida (`bytes=a-b`, `bytes=a-` ou `bytes=-n`), `serveStatic` deve responder `206 Partial Content` com o corpo restrito à faixa, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho da faixa. Quando `b` excede o último byte, o fim é limitado ao último byte. Para `bytes=-n`, a faixa são os últimos `n` bytes (ou o arquivo inteiro, se `n` for maior que o tamanho).

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=2-5`
**Então** a resposta é `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e o corpo contém os bytes 2 a 5.

**Dado** o mesmo asset
**Quando** o cliente envia `Range: bytes=-3`
**Então** a resposta é `206`, `Content-Range: bytes 7-9/10` e `Content-Length: 3`.

### RF-03 — Respostas `HEAD` com faixa

Em `HEAD`, uma requisição com `Range` válido deve responder `206` apenas com cabeçalhos (`Content-Range` e `Content-Length` da faixa), sem corpo.

**Dado** um asset de 10 bytes
**Quando** o cliente faz `HEAD` com `Range: bytes=0-4`
**Então** a resposta é `206`, `Content-Range: bytes 0-4/10`, `Content-Length: 5` e o corpo está vazio.

### RF-04 — Faixa não satisfazível com `416`

Quando a faixa é sintaticamente válida mas não existe no asset (início maior ou igual ao tamanho, ou sufixo de tamanho zero), `serveStatic` deve responder `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=10-20`
**Então** a resposta é `416`, `Content-Range: bytes */10` e `Content-Length: 0`.

### RF-05 — Ignorar `Range` inválido, múltiplo ou de outra unidade

`serveStatic` deve ignorar o `Range` e responder `200` com o corpo completo quando o cabeçalho:

- usa unidade diferente de `bytes`;
- tem sintaxe inválida, inclusive quando `last-byte-pos` é menor que `first-byte-pos`;
- contém mais de uma faixa (`bytes=0-1,4-5`).

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=0-1,4-5`
**Então** a resposta é `200` com os 10 bytes e sem `Content-Range`.

**Dado** o mesmo asset
**Quando** o cliente envia `Range: bytes=5-2`
**Então** a resposta é `200` com os 10 bytes.

### RF-06 — `If-Range`

Quando o cliente envia `If-Range`, a faixa só é aplicada se o validador combinar com o estado atual do asset: uma ETag forte igual à ETag do asset, ou uma data igual ao `Last-Modified`. Caso contrário, `serveStatic` ignora o `Range` e responde `200` com o corpo completo. ETag fraca (`W/...`) nunca combina com `If-Range`.

**Dado** um asset com ETag `"abc"`
**Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "xyz"`
**Então** a resposta é `200` com o corpo completo.

**Dado** o mesmo asset
**Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`
**Então** a resposta é `206` com os bytes 0 a 3.

### RF-07 — Precedência de pré-condições

A avaliação de `If-None-Match` e `If-Modified-Since` deve continuar acontecendo antes da avaliação de `Range`. Se o asset não foi modificado, a resposta continua sendo `304`, mesmo que haja `Range`.

**Dado** um asset cuja ETag é `"abc"`
**Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-3`
**Então** a resposta é `304` sem corpo.

### RF-08 — Preservar comportamento existente

As seguintes regras não podem mudar:

- a ordem de busca de `id`s (variantes comprimidas, `indexNames`) e a seleção de encoding;
- os cabeçalhos `Vary`, `Content-Type`, `Content-Encoding`, `ETag` e `Last-Modified`;
- a resposta `404` para asset inexistente e `405` para método diferente de `GET`/`HEAD`, incluindo o comportamento com `fallthrough`;
- a validação de caminho canônico, que vem antes de qualquer lógica de `Range`.

**Dado** um `POST` em um asset existente
**Quando** a requisição chega a `serveStatic`
**Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje, independentemente de `Range`.

### RF-09 — Faixa só quando o tamanho é conhecido

Se `getMeta` não devolver `size` válido (ausente ou zero), `serveStatic` ignora `Range` e responde `200` com o corpo completo, sem `Accept-Ranges`.

**Dado** um asset cujo `getMeta` não informa `size`
**Quando** o cliente envia `Range: bytes=0-3`
**Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

### RF-10 — Faixa sobre a representação servida

A faixa é calculada sobre a representação efetivamente servida: se a variante comprimida (`.gz`, `.br`) for escolhida, a faixa refere-se aos bytes dela, e `Content-Length` e `Content-Range` usam o `size` dessa variante.

**Dado** um pedido com `accept-encoding: gzip` para um asset com variante `.gz` de 40 bytes
**Quando** o cliente envia `Range: bytes=0-9`
**Então** a resposta é `206`, `Content-Range: bytes 0-9/40`, `Content-Encoding: gzip` e os 10 primeiros bytes do arquivo `.gz`.

### RF-11 — Corpo parcial para qualquer tipo de `getContents`

O corpo devolvido por `getContents` pode ser `string`, `Blob`, `ArrayBuffer`, `ReadableStream` ou outro `BodyInit`. Para qualquer um deles, a faixa deve entregar exatamente os bytes pedidos.

**Dado** que `getContents` devolve um `ReadableStream` com 10 bytes
**Quando** o cliente envia `Range: bytes=2-5`
**Então** a resposta é `206` e o corpo contém exatamente os bytes 2 a 5.

### RF-12 — Helpers privados e API pública intacta

Toda a lógica de `Range` (parse, `If-Range`, cálculo de faixa e cabeçalhos) deve ficar em funções não exportadas dentro de `src/utils/static.ts`. `src/index.ts` não ganha nomes, nem valores nem tipos. `ServeStaticOptions` e `StaticAssetMeta` não mudam.

**Dado** o repositório após a mudança
**Quando** se compara `src/index.ts` e as interfaces exportadas com a versão anterior
**Então** não há exportação nova, e as interfaces mantêm os mesmos campos.

### RF-13 — Testes em todos os alvos

Os cenários de RF-01 a RF-11 devem ser cobertos em `test/static.test.ts` usando `describeMatrix`, valendo para `web` e `node`. Os testes existentes só podem ser ajustados onde a mudança altera o comportamento de forma intencional, sem remover o que eles verificam.

**Dado** a suíte após a mudança
**Quando** se executa `pnpm vitest run test/static.test.ts`
**Então** todos os testes passam nos alvos `web` e `node`.

### RF-14 — Qualidade do projeto

`pnpm lint` e o typecheck devem passar sem erros após a mudança.

**Dado** a branch com a implementação
**Quando** se executa `pnpm lint`
**Então** o comando termina com código de saída 0.

## Fora de escopo

- Múltiplas faixas (`multipart/byteranges`). Pedidos com mais de uma faixa recebem `200` completo (RF-05).
- Suporte a `Range` em respostas dinâmicas (handlers comuns, `proxy`, `h3/rules/cache`).
- Compressão sob demanda: a faixa não é aplicada a respostas comprimidas geradas na hora.
- Novas opções em `ServeStaticOptions` (por exemplo, para passar a faixa a `getContents`).
- Mudanças em `getMeta`/`getContents` além do que já existe, e em `src/_entries/*`.
- Unidades diferentes de `bytes`.
- Mudanças na lógica de cache (`isCacheMatch`), de `Vary` ou de canonicalização de caminho.
- Documentação em site externo.

## Premissas e riscos

### Premissas

- **Norma:** a issue cita a RFC 7233, mas o contrato (`sdd/pedido.md`) usa a RFC 9110. Este PRD segue a RFC 9110, que substitui a 7233 sem mudar o essencial de `Range`.
- **Tamanho:** `getMeta` informa `size` do arquivo servido (a variante, quando houver). Um `size` ausente ou zero significa tamanho desconhecido (RF-09).
- **Validadores:** ETags são strings opacas. A comparação de `If-Range` precisa distinguir ETag forte de fraca pelo prefixo `W/`, o que os testes atuais (`"w/123"`, sem o prefixo) não exercitam.
- **Ordem de avaliação:** pré-condições (`304`) vêm antes de `Range`, como já acontece hoje.
- **Cabeçalhos do usuário:** quando a opção `headers` define `content-length`, o valor do usuário é mantido só se coincidir com o tamanho do corpo servido. Este PRD assume que `Content-Length` da faixa tem prioridade em respostas `206`.

### Riscos

- **Custo de memória e I/O (alto):** `getContents(id)` não recebe a faixa, então a implementação precisa fatiar o corpo devolvido. Para `ReadableStream`, isso pode significar ler e descartar bytes até o início da faixa. Para arquivos grandes, esse custo pode anular o ganho. Mitigação possível: adicionar um parâmetro opcional a `getContents`, mas isso conflita com a restrição de não criar nomes públicos novos. **Decisão pendente** (ver abaixo).
- **Contrato de `getContents`:** quem implementa `getContents` pode devolver um corpo que não suporta fatiamento barato. O PRD exige corretude (RF-11), não desempenho.
- **Conflito com `If-Range` e ETags fracas:** interpretar `If-Range` de forma errada pode entregar bytes de uma versão antiga do arquivo. RF-06 existe para evitar isso.
- **Respostas comprimidas:** a faixa sobre bytes comprimidos é válida pela RFC, mas alguns clientes e proxies lidam mal com isso. Risco baixo, já que a faixa só se aplica a variantes pré-comprimidas.
- **Regressão:** a ordem de `304`, `404`, `405` e `fallthrough` é o ponto mais sensível; RF-07 e RF-08 cobrem isso.

### Decisão pendente

- **Como fatiar sem alterar a API pública:** (a) fatiar o corpo devolvido por `getContents` em memória, sem mudar a assinatura (aceita o custo do risco acima); ou (b) acrescentar um segundo argumento opcional a `getContents` com a faixa, o que quebra a restrição de "nenhum nome público novo" se for considerado API nova. Recomendação deste PRD: **(a)** para esta entrega, registrando (b) como melhoria futura.
