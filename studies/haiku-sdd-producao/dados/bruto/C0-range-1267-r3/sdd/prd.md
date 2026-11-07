# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

`serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, o servidor devolve `200` com o corpo inteiro e não informa que aceita intervalos. Consequências:

- downloads interrompidos não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia (eles enviam `Range` automaticamente);
- CDNs e proxies não conseguem fazer cache e revalidação parcial.

### Objetivo

Fazer `serveStatic` atender pedidos de **um único intervalo de bytes** em `GET` e `HEAD`, quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`). O comportamento segue a issue e a RFC 9110 (seção 13.1.5 — `If-Range`; seção 14 — Range Requests), que substitui a RFC 7233 citada na issue.

### Restrições do pedido

- Mudança interna e retrocompatível, usando só as opções atuais (`ServeStaticOptions`); sem mudança de API.
- Nenhuma exportação pública nova: `src/index.ts` não ganha nomes (valores ou tipos) e os auxiliares ficam privados no módulo.
- Cache, seleção de encoding, `fallthrough` e as respostas 404/405 permanecem como hoje.
- A suíte existente continua passando (ajustando só testes que dependam do que muda, sem perder o que verificam). `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` envia `Accept-Ranges: bytes` nas respostas de um asset encontrado cujo tamanho é conhecido (`size` numérico, inteiro, não negativo).

**Critério de aceite**
- **Dado** um asset com `size` definido em `getMeta`
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`
- **Então** a resposta é `200` com corpo/cabeçalhos habituais e inclui `Accept-Ranges: bytes`.

### RF-02 — Intervalo válido retorna 206

Para um `Range: bytes=...` com um único intervalo válido e satisfazível, em `GET`, a resposta é `206 Partial Content` apenas com os bytes pedidos. São aceitas as três formas: `início-fim`, `início-` (até o fim) e `-n` (últimos *n* bytes). Um `fim` além do último byte é ajustado para `size - 1`; um `-n` com *n* maior que `size` devolve o asset inteiro como intervalo `0-(size-1)`. O nome da unidade (`bytes`) não diferencia maiúsculas de minúsculas.

**Critério de aceite**
- **Dado** um asset de 10 bytes (`0123456789`)
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`
- **Então** a resposta é `206`, o corpo é `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`; e com `bytes=7-` o corpo é `789` (`bytes 7-9/10`), com `bytes=-3` é `789`, com `bytes=8-99` é `89` (`bytes 8-9/10`).

### RF-03 — Cabeçalhos da resposta 206

A resposta `206` mantém os cabeçalhos do asset (`Content-Type`, `Content-Encoding`, `ETag`, `Last-Modified`, `Vary`, `Accept-Ranges` e os de `options.headers`). `Content-Length` é o tamanho do intervalo, nunca o `size` completo (inclusive se `options.headers` definiu `content-length`).

**Critério de aceite**
- **Dado** um asset com `etag`, `mtime` e `type` e um `Range` válido
- **Quando** o cliente faz `GET`
- **Então** a resposta `206` contém os mesmos `ETag`, `Last-Modified` e `Content-Type` da resposta `200` do mesmo asset, e `Content-Length` igual ao número de bytes do corpo.

### RF-04 — HEAD com Range envia só cabeçalhos

Em `HEAD`, um `Range` válido produz `206` com os cabeçalhos que o `GET` equivalente enviaria (`Content-Range`, `Content-Length` do intervalo), sem corpo e sem chamar `getContents`.

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`
- **Então** a resposta é `206`, com `Content-Range: bytes 2-5/10`, `Content-Length: 4`, corpo vazio, e `getContents` não é chamado.

### RF-05 — Intervalo não satisfazível retorna 416

Se o intervalo é sintaticamente válido mas não satisfazível (`início` ≥ `size`, ou `-0`, ou qualquer intervalo quando `size` é 0), a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<size>` e `Content-Length: 0`, sem corpo, tanto em `GET` quanto em `HEAD`.

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `GET` (ou `HEAD`) com `Range: bytes=10-20`
- **Então** a resposta é `416`, `Content-Range: bytes */10`, `Content-Length: 0`, corpo vazio; o mesmo vale para `bytes=-0`.

### RF-06 — Range inválido, multi-range ou de outra unidade é ignorado

Se o `Range` for malformado (sintaxe inválida, `fim < início`, números não inteiros ou grandes demais para inteiro seguro), tiver mais de um intervalo (`bytes=0-1,4-5`) ou usar unidade diferente de `bytes`, o cabeçalho é ignorado e a resposta é a `200` completa de sempre (com `Accept-Ranges: bytes`).

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-1,4-5`, `Range: bytes=abc`, `Range: bytes=5-2` ou `Range: items=0-1`
- **Então** cada resposta é `200` com o corpo inteiro e `Content-Length: 10`, sem `Content-Range`.

### RF-07 — Sem tamanho conhecido, Range é ignorado

Quando `meta.size` é indefinido, o `Range` é ignorado e a resposta é a atual (`200` com corpo completo); não se envia `Accept-Ranges` nem `Content-Range`.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não devolve `size`
- **Quando** o cliente faz `GET` com `Range: bytes=0-3`
- **Então** a resposta é `200` com o conteúdo completo e sem `Accept-Ranges` nem `Content-Range`.

### RF-08 — Respeitar If-Range

Se o pedido tem `Range` e `If-Range`, o intervalo só é aplicado se o validador casar com a representação atual: ETag com **comparação forte** (ETag fraca, `W/"..."`, nunca casa) ou data HTTP **idêntica** ao `Last-Modified` enviado. Se não casar (ou o `If-Range` for inválido ou não houver validador correspondente no asset), a resposta é `200` completa. `If-Range` sem `Range` é ignorado.

**Critério de aceite**
- **Dado** um asset de 10 bytes com `etag: "abc"` e `mtime`
- **Quando** o cliente envia `Range: bytes=2-5` com `If-Range: "abc"` (ou com a data exata de `Last-Modified`)
- **Então** a resposta é `206`; e com `If-Range: "outro"`, uma data diferente ou `W/"abc"`, a resposta é `200` com o corpo inteiro.

### RF-09 — Preservar a avaliação de cache (304)

Os cabeçalhos condicionais (`If-None-Match`, `If-Modified-Since`) continuam avaliados antes do `Range`: um pedido que hoje resulta em `304` continua resultando em `304`, mesmo com `Range`. A `304` mantém o comportamento atual.

**Critério de aceite**
- **Dado** um asset com `etag` e um pedido com `If-None-Match` igual ao ETag e `Range: bytes=0-3`
- **Quando** o cliente faz `GET`
- **Então** a resposta é `304`, sem corpo.

### RF-10 — Compatibilidade com encoding e conteúdo

O intervalo se aplica à representação efetivamente servida (por exemplo, o arquivo pré-comprimido `.gz` escolhido por `accept-encoding`), e `size` é o tamanho dessa representação. O corpo devolvido por `getContents` pode ser de qualquer tipo de `BodyInit` suportado hoje (`string`, `Uint8Array`/`ArrayBuffer`, `Blob`/`File`, `ReadableStream`); o intervalo é extraído por bytes, e os dados fora do intervalo não são enviados ao cliente. Com `getContents` devolvendo vazio (`null`/`undefined`), o comportamento atual é mantido.

**Critério de aceite**
- **Dado** `encodings: { gzip: ".gz" }`, o arquivo `/a.txt.gz` com `size` 20 e `Accept-Encoding: gzip`
- **Quando** o cliente faz `GET` com `Range: bytes=0-4`
- **Então** a resposta é `206` com `Content-Encoding: gzip`, `Vary: accept-encoding`, `Content-Range: bytes 0-4/20` e os 5 primeiros bytes do arquivo `.gz`; e o mesmo intervalo vale quando `getContents` devolve `string`, `Uint8Array`, `Blob` ou `ReadableStream` com o mesmo conteúdo.

### RF-11 — Sem regressão fora do caminho Range

Pedidos sem `Range` válido, e respostas de erro e de fallthrough, mantêm exatamente o comportamento atual, exceto pelo acréscimo de `Accept-Ranges: bytes` (RF-01). Isso inclui `404` para asset inexistente ou caminho não canônico, `405` com `Allow: GET, HEAD` para métodos não permitidos, `fallthrough` (retorna `undefined`, sem vazar `Accept-Ranges` nem `Vary` para o próximo handler) e o `Content-Length` atual.

**Critério de aceite**
- **Dado** a suíte de testes existente de `serveStatic`
- **Quando** é executada com a mudança aplicada
- **Então** todos os testes passam (com ajustes apenas nos que comparam o conjunto exato de cabeçalhos, para aceitar `Accept-Ranges`), e `Range` em asset inexistente continua `404` (ou `fallthrough`), e `Range` em `POST` continua `405`.

### RF-12 — Nenhuma API pública nova

Os auxiliares (parser de `Range`, avaliação de `If-Range`, fatiamento do corpo) são privados ao módulo `src/utils/static.ts`; nenhum nome novo é exportado por esse módulo nem por `src/index.ts`.

**Critério de aceite**
- **Dado** o código após a mudança
- **Quando** se comparam as exportações de `src/index.ts` e de `src/utils/static.ts` com as da base
- **Então** são idênticas, e `pnpm lint` e `pnpm typecheck` passam.

## 3. Fora de escopo

- Respostas `multipart/byteranges` (multi-range): são ignoradas e servidas inteiras.
- Unidades de intervalo diferentes de `bytes`.
- Resposta `412` para `If-Match`/`If-Unmodified-Since` (não fazem parte do pedido).
- Suporte a intervalos quando o tamanho é desconhecido, ou cálculo de tamanho lendo o corpo.
- Novas opções em `ServeStaticOptions`, novos exports ou mudança de API de `getMeta`/`getContents`.
- Mudanças em outras partes do h3 (`proxy`, `serveStatic` de adaptadores, etc.), no cache ou na seleção de encoding.
- Otimizar `getContents` para ler só o intervalo do backend (o contrato atual devolve o corpo inteiro).
- Documentação do site além do que for necessário para refletir o novo comportamento.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação que `getContents(id)` devolve (já com o encoding aplicado). A mudança confia nesse valor, como já faz para `Content-Length`.
- A norma aplicável é a RFC 9110; a issue cita a 7233 (obsoleta), e onde divergirem vale a RFC 9110.
- `Accept-Ranges: bytes` é enviado só quando o tamanho é conhecido, pois a issue limita o suporte a esse caso (a frase "sempre anunciar" é lida dentro dessa condição).
- Os métodos `GET` e `HEAD` aceitam `Range`, conforme a issue (a RFC 9110 só define `Range` para `GET`; `HEAD` devolve os cabeçalhos que o `GET` enviaria).
- O ETag informado em `getMeta` pode ser fraco ou forte; só a forma forte valida `If-Range`.

### Riscos

- **Tamanho incorreto em `getMeta`:** se `size` divergir do corpo real, o `Content-Range` e o `Content-Length` ficam inconsistentes. Mitigação: fatiar por bytes do corpo real e documentar a premissa.
- **Corpos em stream:** fatiar um `ReadableStream` exige descartar e truncar bytes sem materializar o corpo inteiro. Risco de consumo de memória e de cancelamento do stream de origem. Mitigação: transformar o stream, cancelar a origem ao terminar, e testar com stream.
- **Strings:** `string` precisa ser codificada em UTF-8 antes de fatiar por bytes; `size` deve ser o tamanho em bytes, não em caracteres.
- **Regressões em testes existentes:** testes que comparam o conjunto exato de cabeçalhos podem falhar por causa de `Accept-Ranges`. Mitigação: ajustar só a expectativa, preservando o que verificam.
- **Interação com cache de CDN/proxy:** `206` e `If-Range` mal tratados podem corromper respostas em cache. Mitigação: manter `ETag`/`Last-Modified`/`Vary` na `206` e usar comparação forte no `If-Range`.
- **Conflito com `content-length` definido em `options.headers`:** na `206` e na `416` esse valor precisa ser sobrescrito; omitir isso gera resposta inválida.
- **Inteiros muito grandes no `Range`:** valores acima de `Number.MAX_SAFE_INTEGER` devem ser tratados como inválidos (ignorados), não como satisfazíveis.
