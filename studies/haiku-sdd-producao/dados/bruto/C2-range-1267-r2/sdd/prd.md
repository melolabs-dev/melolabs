# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e contrato enxuto em `sdd/pedido.md`.
Arquivo afetado: `src/utils/static.ts`.

## Problema e objetivo

Hoje o `serveStatic` ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde com o corpo inteiro, sem `206 Partial Content` nem `Content-Range`. Com isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) de forma confiável;
- CDNs e proxies não recebem o comportamento HTTP esperado para respostas parciais.

**Objetivo:** fazer o `serveStatic` atender requisições GET e HEAD com intervalo de bytes, conforme a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, sem quebrar o comportamento existente e sem exportar nada novo.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado para GET ou HEAD (200, 206 e 416).

- **Dado** um asset existente servido com GET ou HEAD, sem cabeçalho `Range`,
- **Quando** a resposta é gerada,
- **Então** ela contém `Accept-Ranges: bytes`.

### RF-02 — Responder 206 para intervalo único válido

Para um cabeçalho `Range` com um único intervalo válido (`bytes=a-b`, `bytes=a-` ou `bytes=-n`) e um asset com tamanho conhecido (`size` de `getMeta`), o servidor deve responder `206 Partial Content` com `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Os limites devem ser ajustados ao tamanho do asset: um `fim` maior que o tamanho é reduzido ao último byte, e `bytes=-n` com `n` maior que o tamanho devolve o asset inteiro em 206.

- **Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=100-199`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `206`, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 100 a 199.

- **Dado** o mesmo asset e o cabeçalho `Range: bytes=-50`,
- **Quando** a requisição HEAD é atendida,
- **Então** a resposta é `206`, `Content-Range: bytes 950-999/1000`, `Content-Length: 50` e não tem corpo.

### RF-03 — Responder 416 para intervalo não satisfazível

Quando o intervalo válido não se sobrepõe ao asset (início maior ou igual ao tamanho, ou sufixo de comprimento zero), a resposta deve ser `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

- **Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=1000-1100`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e sem corpo.

### RF-04 — Ignorar Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` estiver malformado, usar outra unidade que não `bytes`, ou tiver mais de um intervalo, o servidor deve ignorá-lo e responder `200 OK` com o asset completo, como hoje.

- **Dado** um asset de 1000 bytes e o cabeçalho `Range: bytes=0-9,20-29`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `200`, sem `Content-Range`, com o corpo completo de 1000 bytes.

- **Dado** o cabeçalho `Range: itens=0-9`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `200` com o corpo completo.

### RF-05 — Validar If-Range

Quando `If-Range` estiver presente, o `Range` só deve ser aplicado se o validador enviado coincidir com o estado atual do asset: uma data igual ao `last-modified` ou um ETag forte igual ao `etag`. Caso contrário, o servidor deve ignorar o `Range` e responder `200` completo. ETags fracas não podem satisfazer `If-Range` (RFC 9110, seção 13.1.5).

- **Dado** um asset com `etag: "abc"` e o cabeçalho `Range: bytes=0-9` acompanhado de `If-Range: "xyz"`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `200` com o corpo completo.

- **Dado** o mesmo asset e `If-Range: "abc"`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `206` com os bytes 0 a 9.

### RF-06 — Preservar a ordem com as validações condicionais

As validações condicionais de cache (`If-None-Match`, `If-Modified-Since`) devem continuar sendo avaliadas antes de `Range`. Se o cache já validar o asset, a resposta continua sendo `304 Not Modified`, mesmo com `Range` presente.

- **Dado** um asset cujo ETag bate com `If-None-Match` e um cabeçalho `Range: bytes=0-9`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `304` sem corpo, como hoje.

### RF-07 — Preservar o comportamento existente

Cache, seleção de `encoding`, `fallthrough`, `headers`, `vary`, as respostas 404 (asset inexistente) e 405 (método não permitido) e a resolução de `indexNames` continuam funcionando como antes. Quando um asset é servido com `Content-Encoding` (variante pré-comprimida), o intervalo se refere aos bytes dessa variante, e o `Content-Range` usa o tamanho dela.

- **Dado** o método POST com `Range: bytes=0-9`,
- **Quando** a requisição é atendida pelo `serveStatic`,
- **Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje.

- **Dado** um asset com variante `.gz` aceita pelo cliente e o cabeçalho `Range: bytes=0-9`,
- **Quando** a requisição GET é atendida,
- **Então** a resposta é `206`, com `Content-Encoding: gzip` e `Content-Range` calculado sobre o tamanho do arquivo `.gz`.

### RF-08 — Manter a superfície pública

Nenhum nome novo deve ser exportado: `src/index.ts` não muda, e as funções auxiliares ficam privadas no módulo `src/utils/static.ts`. `ServeStaticOptions` e `StaticAssetMeta` não recebem campos novos.

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações públicas com a versão anterior,
- **Então** não há exportações, valores ou tipos novos.

### RF-09 — Cobrir o comportamento com testes

Os novos casos devem ser escritos com `describeMatrix` (web e node) e cobrir RF-01 a RF-07. Os testes existentes devem continuar passando. Se algum teste existente depender de a resposta ser sempre 200 para GET com `Range`, ele pode ser ajustado, mas sem perder o que verifica.

- **Dado** a suíte após a mudança,
- **Quando** `pnpm vitest run` é executado nos arquivos de static,
- **Então** todos os testes passam, nos dois runtimes.

- **Dado** o projeto após a mudança,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos passam.

## Fora de escopo

- Respostas `multipart/byteranges` (múltiplos intervalos): esses pedidos são ignorados e recebem 200 completo.
- Suporte a Range fora de `serveStatic`, como em `proxy`, `h3/rules/cache` ou `h3/rules/proxy`.
- Mudanças nas assinaturas de `getMeta` e `getContents`, ou novos campos em `ServeStaticOptions` (por exemplo, um parâmetro de intervalo).
- Cache de respostas parciais no `ocache` ou em outro cache.
- Mudanças na negociação de `Accept-Encoding` além do que já existe.
- Suporte a intervalos em outras unidades que não `bytes`.
- Otimizações de leitura parcial no disco ou em storage específico de cada runtime; o foco é a semântica HTTP correta.
- Alterações na documentação pública além de comentários de código necessários.

## Premissas

- **P-01:** o tamanho do asset vem de `getMeta().size`. Se ele não existir ou não for maior que zero, o servidor responde como hoje (200 completo, sem `Content-Range`).
- **P-02:** `getContents(id)` devolve o corpo completo e não recebe intervalo. Como não podemos mudar a API pública (RF-08), o recorte dos bytes precisa acontecer sobre o `BodyInit` devolvido.
- **P-03:** a RFC 9110 vale no lugar da RFC 7233 citada na issue. Ela substitui a 7233 e mantém as mesmas regras de intervalo.
- **P-04:** a issue pede `Accept-Ranges: bytes` sempre, e o contrato confirma. Por isso o RF-01 vale para todo asset encontrado, mesmo sem `size`.
- **P-05:** a ordem de avaliação segue a RFC 9110, seção 13.2.2: condicionais de cache primeiro, `If-Range` depois, `Range` por último.

## Riscos

- **R-01 — recorte do corpo (principal).** `BodyInit` pode ser string, `ArrayBuffer`, `Blob`, `ReadableStream` e outros tipos. Recortar `string`, `ArrayBuffer` e `Blob` é direto. Para `ReadableStream`, é preciso descartar bytes até o início e encerrar no fim, o que lê o arquivo inteiro e pode pesar em arquivos grandes de vídeo. Decisão pendente: para tipos que não dá para recortar de forma eficiente, responder 200 completo, ou aceitar o custo de ler e descartar. A recomendação é a primeira opção, com esse caso coberto por teste.
- **R-02 — tamanho divergente.** Se `getMeta().size` não bater com o tamanho real do conteúdo devolvido por `getContents`, o `Content-Length` e o `Content-Range` ficam errados. Não há como verificar isso sem ler o corpo; a responsabilidade fica com o backend, que deve documentar o contrato no próprio código.
- **R-03 — ETag fraca e If-Range.** Comparar a ETag como forte ou fraca de forma errada pode devolver partes de um arquivo que mudou. A comparação de `If-Range` precisa ser estrita.
- **R-04 — asset de tamanho zero.** Pela RFC, qualquer intervalo de um recurso vazio é não satisfazível, o que dá 416 com `bytes */0`. Hoje o código não define `Content-Length` quando `size` é 0. Decisão pendente: seguir a RFC (416) ou manter 200 para não mudar o comportamento de arquivos vazios.
- **R-05 — quebra de testes existentes.** Algum teste atual pode esperar 200 para GET com `Range`. Isso deve ser conferido antes de ajustar, para não remover uma verificação real.
- **R-06 — compatibilidade entre runtimes.** `Blob.slice`, `ReadableStream` e `Response` têm comportamento que pode variar entre Node, Bun, Deno, Workers e navegadores. A matriz de testes precisa cobrir isso.
