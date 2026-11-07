# PRD — Suporte a HTTP Range no `serveStatic`

**Referências:** h3js/h3#1267 · RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests) · `src/utils/static.ts` · `test/static.test.ts`
**Status:** pronto para implementação

## Problema e objetivo

Hoje `serveStatic` ignora o cabeçalho `Range`: responde sempre `200` com o corpo completo e sem nenhuma informação de intervalo. Isso causa três problemas:

- clientes não conseguem retomar downloads interrompidos;
- players de vídeo e áudio não conseguem avançar (seek), pois dependem de `206 Partial Content`;
- CDNs e proxies não conseguem tratar respostas parciais corretamente.

**Objetivo:** fazer `serveStatic` atender requisições `GET` e `HEAD` com um único intervalo de bytes, conforme a RFC 9110, sem nova API pública, sem alterar o comportamento de requisições que não usam Range e funcionando nos dois alvos de teste (`web` e `node`).

## Usuários e casos de uso

- Quem serve vídeo ou áudio com h3 e precisa de seek no player.
- Quem serve arquivos grandes que o cliente precisa retomar.
- Clientes HTTP, CDNs e proxies que dependem de `206` e `416`.

## Convenções deste documento

- **Asset encontrado:** `serveStatic` resolveu `getMeta` para algum id (não houve 404 nem fallthrough).
- **Tamanho:** o `size` devolvido por `getMeta` para a variante que será servida, em bytes.
- **Intervalo válido:** um cabeçalho `Range` que passa pelas regras de RF-02.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

Toda resposta de asset encontrado, para `GET` ou `HEAD`, traz `Accept-Ranges: bytes` (status 200, 206, 304 e 416). Respostas 404, fallthrough e 405 não trazem esse cabeçalho. Se `Accept-Ranges` já estiver definido (em `options.headers` ou na resposta), o valor existente é mantido.

**Critério de aceite**
- **Dado** um asset existente com `size` conhecido,
- **Quando** recebo `GET` sem cabeçalho `Range`,
- **Então** a resposta é `200`, traz `Accept-Ranges: bytes` e tem o corpo completo.

- **Dado** um caminho inexistente,
- **Quando** recebo `GET`,
- **Então** a resposta é `404` e não traz `Accept-Ranges`.

### RF-02 — Quais cabeçalhos Range são interpretados

Só é interpretado um `Range` com unidade `bytes` e exatamente um intervalo, nas formas `inicio-fim`, `inicio-` e `-sufixo`. Qualquer outro caso faz o `Range` ser ignorado e a resposta ser o `200` completo, como hoje:

- unidade diferente de `bytes`;
- mais de um intervalo (ex.: `bytes=0-4,10-14`);
- sintaxe inválida (ex.: `bytes=abc`, `bytes=`, `bytes=5-2` com início maior que fim);
- tamanho desconhecido (`size` ausente) ou igual a zero.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** recebo `Range: bytes=0-4,10-14`,
- **Então** a resposta é `200`, não tem `Content-Range` e o corpo tem 100 bytes.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: items=0-4` ou `Range: bytes=5-2`,
- **Então** a resposta é `200` com o corpo completo.

- **Dado** um asset cujo `getMeta` não devolve `size`,
- **Quando** recebo `Range: bytes=0-4`,
- **Então** a resposta é `200` com o corpo completo.

### RF-03 — Resposta 206 para intervalo satisfazível

Um intervalo é satisfazível quando o início é menor que o tamanho. A resolução segue estas regras, com `n` = tamanho:

- `inicio-fim`: fim é limitado a `n - 1`;
- `inicio-`: fim é `n - 1`;
- `-sufixo`: início é `max(n - sufixo, 0)` e fim é `n - 1`.

A resposta tem status `206`, `Content-Range: bytes inicio-fim/n`, `Content-Length: fim - inicio + 1` e corpo formado exatamente pelos bytes do intervalo.

**Critério de aceite**
- **Dado** um asset de 100 bytes com conteúdo conhecido,
- **Quando** recebo `Range: bytes=10-19`,
- **Então** a resposta é `206`, `Content-Range: bytes 10-19/100`, `Content-Length: 10` e o corpo são os bytes 10 a 19.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=95-200`,
- **Então** a resposta é `206`, `Content-Range: bytes 95-99/100` e `Content-Length: 5`.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=-10`,
- **Então** a resposta é `206` com `Content-Range: bytes 90-99/100`.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=-200`,
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/100`.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=50-`,
- **Então** a resposta é `206` com `Content-Range: bytes 50-99/100`.

### RF-04 — Resposta 416 para intervalo não satisfazível

Um intervalo válido por RF-02 é não satisfazível quando o início é maior ou igual ao tamanho, ou quando o sufixo é `0` (`bytes=-0`). A resposta tem status `416`, `Content-Range: bytes */n`, `Content-Length: 0` e corpo vazio.

**Critério de aceite**
- **Dado** um asset de 100 bytes,
- **Quando** recebo `Range: bytes=100-`,
- **Então** a resposta é `416`, `Content-Range: bytes */100`, `Content-Length: 0`, sem corpo e com `Accept-Ranges: bytes`.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=-0`,
- **Então** a resposta é `416` com `Content-Range: bytes */100`.

### RF-05 — Comportamento de HEAD

Para `HEAD`, as respostas `206` e `416` têm o mesmo status e os mesmos cabeçalhos do `GET` (incluindo `Content-Range` e `Content-Length` do intervalo), sem corpo. Nesse caso `getContents` não é chamado.

**Critério de aceite**
- **Dado** um asset de 100 bytes e um spy em `getContents`,
- **Quando** recebo `HEAD` com `Range: bytes=10-19`,
- **Então** a resposta é `206`, `Content-Length: 10`, `Content-Range: bytes 10-19/100`, o corpo está vazio e o spy não foi chamado.

### RF-06 — If-Range

Quando há um `Range` válido por RF-02 e um cabeçalho `If-Range`, o intervalo só é atendido se a condição for verdadeira:

- valor é um ETag forte (sem prefixo `W/`) e é idêntico ao ETag do asset (comparação forte);
- ou valor é uma data HTTP idêntica ao `Last-Modified` servido.

Caso contrário, o `Range` é ignorado e a resposta é o `200` completo. Isso vale também quando o asset não tem ETag, quando o ETag do asset é fraco, quando a data não bate ou não é válida. Sem `Range`, `If-Range` é ignorado.

**Critério de aceite**
- **Dado** um asset com ETag `"v1"`,
- **Quando** recebo `Range: bytes=0-9` e `If-Range: "v1"`,
- **Então** a resposta é `206`.

- **Dado** o mesmo asset,
- **Quando** recebo `Range: bytes=0-9` e `If-Range: "v2"`,
- **Então** a resposta é `200` com o corpo completo.

- **Dado** um asset com ETag fraco `W/"v1"`,
- **Quando** recebo `Range: bytes=0-9` e `If-Range: W/"v1"`,
- **Então** a resposta é `200` com o corpo completo.

- **Dado** um asset com `Last-Modified: Wed, 21 Oct 2015 07:28:00 GMT`,
- **Quando** recebo `Range: bytes=0-9` e `If-Range` com essa mesma data,
- **Então** a resposta é `206`; com a data um segundo diferente, a resposta é `200`.

### RF-07 — Precedência de condicionais (304)

A avaliação de `If-None-Match` e `If-Modified-Since` acontece antes de `Range`. Se o cache casar, a resposta é `304` sem corpo, mesmo com `Range` presente. Esse comportamento não muda.

**Critério de aceite**
- **Dado** um asset com ETag `"v1"`,
- **Quando** recebo `Range: bytes=0-9` e `If-None-Match: "v1"`,
- **Então** a resposta é `304` sem corpo.

### RF-08 — Preservação de cabeçalhos em 206 e 416

Respostas `206` e `416` mantêm `ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding` (quando houver) e `Vary` com os mesmos valores da resposta `200` do mesmo asset. Cabeçalhos definidos em `options.headers` continuam aplicados, exceto `Content-Length`, que em `206` e `416` é sempre o do intervalo servido (ver Premissas).

**Critério de aceite**
- **Dado** um asset com ETag, `Last-Modified` e tipo `text/plain`,
- **Quando** recebo um `Range` válido,
- **Então** a resposta `206` tem o mesmo `ETag`, `Last-Modified` e `Content-Type` que a resposta `200` do mesmo asset.

### RF-09 — Variantes pré-comprimidas

Quando a variante escolhida tem `encoding` (ex.: `.gz`), o `Range` se refere aos bytes dessa variante codificada. O tamanho usado é o `size` da variante, e `Content-Encoding` é mantido em `206` e `416`. A seleção de encoding não muda.

**Critério de aceite**
- **Dado** `/app.js`, uma variante `app.js.gz` de 50 bytes e `encodings: { gzip: ".gz" }`,
- **Quando** recebo `Accept-Encoding: gzip` e `Range: bytes=0-9`,
- **Então** a resposta é `206`, `Content-Encoding: gzip`, `Content-Range: bytes 0-9/50` e o corpo são os 10 primeiros bytes de `app.js.gz`.

### RF-10 — Recorte para cada tipo de corpo

O recorte funciona para os tipos de corpo que `getContents` pode devolver: `string`, `ArrayBuffer`, `ArrayBufferView` (TypedArray e DataView), `Blob` e `ReadableStream`. Outros tipos de `BodyInit` são convertidos para bytes antes do recorte. Strings são contadas e recortadas em bytes UTF-8.

Para `ReadableStream`, depois de entregar o último byte pedido, o stream de origem é cancelado e não é lido até o fim.

**Critério de aceite**
- **Dado** o conteúdo `abcdefgh` como `string`, `ArrayBuffer`, `Blob` ou `ReadableStream`,
- **Quando** recebo `Range: bytes=2-4`,
- **Então** a resposta é `206` e o corpo é `cde`.

- **Dado** o conteúdo `aé` como `string` (3 bytes em UTF-8) e `size: 3`,
- **Quando** recebo `Range: bytes=1-2`,
- **Então** a resposta é `206` e o corpo é `é`.

- **Dado** um `ReadableStream` de origem com `cancel` monitorado,
- **Quando** recebo `Range: bytes=0-1` em um conteúdo de 8 bytes,
- **Então** o corpo são os bytes 0 e 1 e o `cancel` da origem foi chamado.

### RF-11 — Sem mudança para requisições sem Range

Para requisições sem `Range` ou com `Range` ignorado por RF-02 e RF-06, as respostas `200`, `304`, `404`, `405`, fallthrough, cache, seleção de encoding, `indexNames` e rejeição de caminho não canônico são iguais às de hoje. A única diferença permitida é o cabeçalho `Accept-Ranges` (RF-01). Asserções existentes em `test/static.test.ts` continuam válidas e passam sem alteração.

**Critério de aceite**
- **Dado** a suíte atual de `test/static.test.ts`,
- **Quando** executo `pnpm vitest run test/static.test.ts`,
- **Então** todos os testes passam nos alvos `web` e `node`, sem asserções alteradas.

### RF-12 — Superfície pública inalterada

Nenhum nome novo é exportado por `src/index.ts` (nem valor, nem tipo). `ServeStaticOptions` e `StaticAssetMeta` não ganham campos. Os helpers de Range ficam não exportados dentro de `src/utils/static.ts`.

**Critério de aceite**
- **Dado** `src/index.ts` antes e depois da mudança,
- **Quando** comparo as exportações,
- **Então** a lista é idêntica, e `pnpm lint` e `pnpm typecheck` passam.

### RF-13 — Cobertura de testes nos dois alvos

Os novos testes usam `describeMatrix` e cobrem RF-01 a RF-10, para que cada cenário rode em `web` e `node`.

**Critério de aceite**
- **Dado** os novos testes,
- **Quando** executo `pnpm vitest run test/static`,
- **Então** cada cenário de RF-01 a RF-10 aparece para os alvos `web` e `node` e passa.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Esses pedidos recebem `200` completo.
- Pré-condições `If-Match` e `If-Unmodified-Since` (resposta `412`).
- Novas opções em `ServeStaticOptions`, como uma API de leitura parcial em `getContents`.
- Range em outros utilitários: `proxy`, `h3/rules/cache` (ocache), `event-stream` ou respostas dinâmicas.
- Compressão on-the-fly ou mudança na seleção de encoding.
- Otimização de I/O para backends que leem intervalos nativamente.
- Mudanças em `Cache-Control` ou na política de CDN.
- Alterações em `README` ou documentação pública.

## Premissas

1. `getMeta.size` é o número de bytes da variante servida e coincide com o comprimento do corpo devolvido por `getContents`. Isso já é premissa do `Content-Length` atual.
2. `getContents` devolve o corpo completo. O h3 não pede intervalos ao backend.
3. O `Last-Modified` tem precisão de segundos, como já é tratado hoje com `setMilliseconds(0)`.
4. Em `206` e `416`, `Content-Length` é sempre o do intervalo, mesmo quando `options.headers` ou a resposta já definem outro valor. Em `200`, vale a regra atual, coberta por `test/static.test.ts:600`. A divergência é intencional, porque uma resposta parcial precisa ter o comprimento correto.
5. Asset com `size` ausente ou zero: `Range` é ignorado (a issue fala em "when the asset size is known").
6. A norma é a RFC 9110. A issue cita a RFC 7233, que a RFC 9110 substitui.
7. Ordem de avaliação: 405 → caminho canônico e 404 → 304 → If-Range → Range.
8. Se `getContents` devolver `null` ou `undefined` em uma requisição com `Range` válido, a resposta segue como hoje (`200`, sem corpo). Não há `206` nesse caso.

## Riscos

1. **Desempenho (médio):** sem API de leitura parcial, um `Range` em backend remoto ainda pode transferir o arquivo inteiro do backend. Mitigação: cancelar o stream após o último byte (RF-10). Melhoria futura fica fora de escopo.
2. **Inconsistência entre `size` e corpo (alto):** se `getMeta.size` não bater com o corpo, o `206` sai com `Content-Length` errado ou o stream termina antes do previsto. Mitigação: testes com todos os tipos de corpo de RF-10.
3. **`Accept-Ranges` sem suporte real (baixo):** para assets com tamanho desconhecido, o cabeçalho é anunciado, mas o `Range` é ignorado. Isso segue a issue ("Always advertise"), mas não é exato. Pode ser reavaliado depois.
4. **Confusão de unidade em strings (médio):** se o `size` informado for em caracteres e não em bytes, o recorte sai errado. Mitigação: RF-10 testa `string` com caractere multibyte.
5. **Mudança de comportamento para clientes (baixo):** players e clientes que hoje recebem `200` passam a receber `206`. É o objetivo da mudança, mas vale uma verificação manual com um player real antes de publicar.
6. **Tamanho do módulo (baixo):** `src/utils/static.ts` já tem mais de 200 linhas e os helpers entram nele, porque a issue pede que fiquem privados no módulo. O `AGENTS.md` prefere arquivos menores e helpers em `utils/internal/`. Se o arquivo ficar grande demais, a mudança para `utils/internal/` é possível, desde que nada seja exportado por `src/index.ts`.
