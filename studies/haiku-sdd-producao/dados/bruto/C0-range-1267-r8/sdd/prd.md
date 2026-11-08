# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

Hoje `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo, o servidor devolve `200` com o corpo inteiro e sem cabeçalhos de conteúdo parcial. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia (eles enviam `Range` automaticamente);
- CDNs e proxies não conseguem tratar o asset como parcialmente cacheável.

### Objetivo

Fazer `serveStatic` atender pedidos de intervalo de bytes em `GET` e `HEAD`, conforme a RFC 9110 (seções 13.1.5 e 14, que substituem a RFC 7233 citada na issue), sem mudar a API pública e sem alterar o comportamento já existente de cache, encoding, `fallthrough`, 404 e 405.

### Métricas de sucesso

- Um cliente com `Range: bytes=a-b` válido recebe `206` com exatamente os bytes pedidos.
- Toda a suíte existente continua passando, e `pnpm lint` e `pnpm typecheck` passam.
- `src/index.ts` não ganha nenhum nome novo (valor ou tipo).

## 2. Requisitos funcionais

Convenções: "tamanho" é o `size` devolvido por `getMeta` para a variante efetivamente escolhida (já considerando encoding pré-comprimido). Os intervalos valem sobre os bytes dessa representação, como na RFC 9110 §14.

### RF-01 — Anunciar `Accept-Ranges: bytes`

`serveStatic` anuncia suporte a ranges em respostas de assets encontrados.

**Critério de aceite**
- **Dado** um asset existente com `size` conhecido (> 0)
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`
- **Então** a resposta é `200` com o corpo/cabeçalhos de hoje e inclui `Accept-Ranges: bytes`.

### RF-02 — Responder `206` a um intervalo único válido

**Critério de aceite**
- **Dado** um asset de 10 bytes (`0123456789`) com `size: 10`
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`
- **Então** a resposta é `206 Partial Content`, o corpo é `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`, e `Accept-Ranges: bytes` está presente.

### RF-03 — Suportar as três formas de `byte-range-spec`

Intervalo fechado (`a-b`), aberto (`a-`) e sufixo (`-n`). Um `b` além do fim é limitado ao último byte; um sufixo maior que o tamanho devolve o asset inteiro como `206`.

**Critério de aceite**
- **Dado** o asset de 10 bytes do RF-02
- **Quando** o cliente envia, em pedidos separados, `bytes=7-`, `bytes=-3`, `bytes=8-99` e `bytes=-99`
- **Então** as respostas são `206` com `Content-Range` `bytes 7-9/10`, `bytes 7-9/10`, `bytes 8-9/10` e `bytes 0-9/10`, e `Content-Length` 3, 3, 2 e 10, respectivamente.

### RF-04 — `HEAD` com range envia só cabeçalhos

**Critério de aceite**
- **Dado** o asset de 10 bytes e `Range: bytes=2-5` válido
- **Quando** o cliente faz `HEAD`
- **Então** a resposta é `206` com os mesmos `Content-Range` (`bytes 2-5/10`) e `Content-Length` (`4`) do `GET`, sem corpo, e `getContents` não é chamado.

### RF-05 — Responder `416` a intervalo não satisfazível

**Critério de aceite**
- **Dado** o asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=10-` (início ≥ tamanho) ou `Range: bytes=-0` (sufixo de comprimento zero)
- **Então** a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */10` e `Content-Length: 0`, sem corpo, e `getContents` não é chamado.

### RF-06 — Ignorar `Range` malformado, multi-range ou de unidade desconhecida

O servidor ignora o cabeçalho e serve a resposta completa (`200`) quando ele: tem unidade diferente de `bytes` (comparação sem diferenciar maiúsculas), é sintaticamente inválido (ex.: `bytes=abc`, `bytes=5-2`, `bytes=`, valores negativos ou não numéricos), ou contém mais de um intervalo (`bytes=0-1,4-5`).

**Critério de aceite**
- **Dado** o asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=0-1,4-5`, `Range: bytes=5-2`, `Range: items=0-1` ou `Range: bytes=abc`
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`, e com `Content-Length: 10` e `Accept-Ranges: bytes`.

### RF-07 — Respeitar `If-Range` (RFC 9110 §13.1.5)

`If-Range` só é avaliado quando há `Range` válido. Aceita um validador de entidade (ETag) ou uma data HTTP.

- ETag: usa comparação **forte**. Uma ETag fraca (`W/"…"`), no cabeçalho ou no asset, nunca casa.
- Data: casa só se for idêntica à data de `Last-Modified` da resposta (igualdade exata, após truncar para segundos).
- Se não casar (ou o valor for inválido ou o asset não tiver validador), o `Range` é ignorado e a resposta é `200` completa.

**Critério de aceite**
- **Dado** um asset de 10 bytes com `etag: '"v1"'`
- **Quando** o cliente envia `Range: bytes=2-5` com `If-Range: "v1"`
- **Então** a resposta é `206`; e com `If-Range: "v2"`, `If-Range: W/"v1"` ou uma data diferente da de `Last-Modified`, a resposta é `200` com o corpo inteiro.

### RF-08 — Preservar a precedência dos condicionais (304)

A avaliação de `If-None-Match`/`If-Modified-Since` (via `isCacheMatch`) continua antes de qualquer lógica de range.

**Critério de aceite**
- **Dado** um asset com `etag: '"v1"'`
- **Quando** o cliente envia `Range: bytes=2-5` e `If-None-Match: "v1"`
- **Então** a resposta é `304` sem corpo, como hoje, e sem `Content-Range`.

### RF-09 — Ranges sobre a variante com encoding escolhida

O range se aplica à representação efetivamente servida. Com encodings pré-comprimidos, o tamanho usado é o `size` da variante escolhida e `Content-Encoding` e `Vary` seguem como hoje.

**Critério de aceite**
- **Dado** `encodings: { gzip: ".gz" }`, `/app.js.gz` com `size: 20` e o cliente enviando `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-4`
- **Então** a resposta é `206` com `Content-Encoding: gzip`, `Content-Range: bytes 0-4/20`, `Content-Length: 5`, o `Vary: accept-encoding` de hoje, e o corpo são os 5 primeiros bytes da variante `.gz`.

### RF-10 — Sem tamanho conhecido, sem range

Quando `meta.size` é `undefined` ou `0` (caso em que hoje nenhum `Content-Length` é emitido), o `Range` é ignorado e o comportamento atual é mantido.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não devolve `size`
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é `200` com o corpo inteiro, sem `Content-Range`, exatamente como antes da mudança.

### RF-11 — Cabeçalhos coerentes na resposta parcial

Em `206` e `416`, `Content-Length` e `Content-Range` devem refletir o intervalo, mesmo que `options.headers` ou o chamador tenham definido `content-length` do asset inteiro. Os demais cabeçalhos (`ETag`, `Last-Modified`, `Content-Type`, `Content-Encoding`, `Vary`, os de `options.headers`) são mantidos.

**Critério de aceite**
- **Dado** `options.headers` com `content-length: 10` e o asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=2-5`
- **Então** a resposta é `206` com `Content-Length: 4` (não `10`), e `ETag`, `Last-Modified` e `Content-Type` iguais aos de uma resposta `200`.

### RF-12 — Não alterar fallthrough, 404 e 405

**Critério de aceite**
- **Dado** um pedido com `Range` para um asset inexistente, ou com método `POST`
- **Quando** `serveStatic` é chamado, com e sem `fallthrough`
- **Então** o resultado é idêntico ao de hoje: 404 (ou `undefined` com `fallthrough`) para asset inexistente ou caminho não canônico, e 405 com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`) para método não permitido; nenhum cabeçalho de range é adicionado a essas respostas.

### RF-13 — Nenhuma exportação pública nova

**Critério de aceite**
- **Dado** o código após a mudança
- **Quando** se compara `src/index.ts` e as exportações públicas de `src/utils/static.ts` com as de antes
- **Então** não há nomes novos (valores ou tipos); `StaticAssetMeta` e `ServeStaticOptions` mantêm a mesma forma, e as funções auxiliares ficam privadas no módulo (seção `Internal Utils`).

## 3. Fora de escopo

- Respostas `multipart/byteranges` (múltiplos intervalos); esses pedidos são ignorados (RF-06).
- Unidades de range diferentes de `bytes`.
- Novas opções em `ServeStaticOptions` ou campos em `StaticAssetMeta`; nenhuma mudança de API.
- Que `getContents` receba o intervalo (leitura parcial otimizada do disco/origem); o recorte é feito sobre o corpo que `getContents` devolve.
- Ranges em outros utilitários (`proxy`, `serveStatic` de terceiros, rotas comuns).
- Mudanças de cache, seleção de encoding, `fallthrough`, 404 ou 405.
- Fazer `Range` valer para métodos além de `GET` e `HEAD`.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da representação que `getContents(id)` devolve, já na variante escolhida (comprimida, se for o caso).
- Só `size > 0` conta como "tamanho conhecido", coerente com a emissão de `Content-Length` atual.
- A issue pede `GET` e `HEAD`; a RFC 9110 define `Range` só para `GET`, mas o servidor pode ignorar o cabeçalho em outros métodos, e a issue vale para `HEAD`.
- Os cabeçalhos `ETag` e `Last-Modified` da resposta (incluindo os vindos de `options.headers`) são os validadores usados no `If-Range`.
- A implementação segue o fluxo já existente: cabeçalhos de asset, depois `isCacheMatch`, depois a lógica de range.

### Riscos

| Risco | Mitigação |
| --- | --- |
| `getContents` devolve `BodyInit` de vários tipos (string, `Uint8Array`, `Blob`, `ReadableStream`, etc.), e o recorte por bytes difere por tipo. Strings têm tamanho em UTF-8 diferente do número de caracteres. | Recortar por bytes com tratamento explícito por tipo (`Blob.slice`, `subarray`, string codificada em UTF-8, stream com descarte/limite). Para tipo não suportado, servir `200` completo (degradação segura) e documentar nos testes. |
| `meta.size` incorreto em relação ao corpo real gera `Content-Range`/`Content-Length` inconsistentes. | Tratar `meta.size` como contrato do `getMeta`; testar o recorte com tamanhos coerentes e documentar a premissa. |
| `If-Range` com data: igualdade exata e truncamento para segundos (a mesma regra do `last-modified` atual). | Reaproveitar o `mtimeDate` já truncado e testar com datas iguais, diferentes e inválidas. |
| Testes existentes que afirmam ausência de cabeçalhos ou igualdade exata de cabeçalhos podem quebrar com o novo `Accept-Ranges`. | Ajustar só as afirmações afetadas, sem perder o que elas verificam, e rodar a suíte completa. |
| Pré-definição de `content-length` por `options.headers` conflita com `206`/`416`. | RF-11: sobrescrever `Content-Length` nas respostas parciais e cobrir com teste. |
| Pedidos com `Range` enorme ou muitos pedidos pequenos (uso abusivo). | Só um intervalo é aceito, sem `multipart`, então não há amplificação; o custo é o do recorte de um único trecho. |
| Dobrar `Content-Encoding` com ranges: o cliente recebe pedaço de um fluxo comprimido. | Comportamento correto pela RFC 9110 (range sobre a representação codificada); `Vary: accept-encoding` mantido (RF-09). |
