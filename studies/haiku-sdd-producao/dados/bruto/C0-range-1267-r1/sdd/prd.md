# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema

O `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor devolve o corpo inteiro com `200`, sem `Accept-Ranges`, `Content-Range` nem `206`. Consequências:

- downloads grandes não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou recuar na mídia;
- CDNs e proxies não conseguem tratar o asset como parcialmente cacheável.

### Objetivo

Fazer o `serveStatic` atender pedidos de intervalo de bytes para `GET` e `HEAD`, conforme a RFC 9110 (seções 13.1.5 `If-Range` e 14 `Range Requests`, que substituem a RFC 7233 citada na issue). A mudança é interna e retrocompatível:

- usa o `size` devolvido por `getMeta` como tamanho do asset;
- não altera `ServeStaticOptions` nem `StaticAssetMeta`;
- não cria exportações públicas.

### Métricas de sucesso

- Um cliente consegue baixar um asset em partes e remontar o conteúdo idêntico ao original.
- Todos os testes existentes continuam passando; `pnpm lint` e `pnpm typecheck` passam.
- `src/index.ts` não ganha nenhum nome novo (valor ou tipo).

## 2. Requisitos funcionais

Convenções: "tamanho" é o `size` de `getMeta`; "suportado" significa `size` inteiro maior que 0. Os intervalos referem-se à representação efetivamente servida, ou seja, à variante escolhida por `encodings` (já comprimida, se for o caso), e não ao arquivo descomprimido.

### RF-01 — Anunciar `Accept-Ranges: bytes`

`serveStatic` anuncia suporte a ranges nas respostas de assets com tamanho suportado.

**Critério de aceite**
- **Dado** um asset existente com `size` > 0
- **Quando** o cliente faz `GET` ou `HEAD` sem `Range`
- **Então** a resposta é `200` com o corpo atual (vazio no `HEAD`) e inclui `Accept-Ranges: bytes`. As mesmas respostas também incluem esse cabeçalho nos casos `206` (RF-02) e `416` (RF-05).

### RF-02 — Responder `206` para um único intervalo válido

**Critério de aceite**
- **Dado** um asset de 10 bytes (`0123456789`) e um `Range: bytes=2-5`
- **Quando** o cliente faz `GET`
- **Então** a resposta é `206 Partial Content` com corpo `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`. O `Content-Type` e os demais cabeçalhos do asset são preservados.

### RF-03 — Formas de intervalo aceitas

São aceitas as três formas de `byte-range-spec` da RFC 9110 §14.1.2, com o nome da unidade `bytes` sem distinção de maiúsculas:

- `first-last`;
- `first-` (até o fim);
- `-N` (os últimos N bytes).

Regras de normalização:

- `last` maior ou igual ao tamanho é truncado para `tamanho-1`.
- `-N` com N maior que o tamanho devolve o asset inteiro, como `206` com `bytes 0-(tamanho-1)/tamanho`.

**Critério de aceite**
- **Dado** o asset de 10 bytes
- **Quando** o cliente envia `bytes=7-`, `bytes=-3`, `bytes=7-999` ou `BYTES=0-0`
- **Então** as respostas são `206` com corpo `789`, `789`, `789` e `0`, e `Content-Range` `bytes 7-9/10`, `bytes 7-9/10`, `bytes 7-9/10` e `bytes 0-0/10`, respectivamente. Já `bytes=-999` devolve `206` com `bytes 0-9/10` e o corpo completo.

### RF-04 — Ignorar `Range` malformado ou multi-intervalo

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range` com unidade desconhecida (`items=0-1`), sintaxe inválida (`bytes=abc`, `bytes=5-2`, `bytes=`, `bytes=-`, valores negativos ou não numéricos) ou vários intervalos (`bytes=0-1,4-5`)
- **Então** o servidor ignora o cabeçalho e responde como hoje: `200`, corpo completo, `Content-Length` do asset, sem `Content-Range`. `Accept-Ranges: bytes` continua presente.

### RF-05 — Responder `416` para intervalo não satisfazível

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `bytes=10-` ou `bytes=20-30`, ou `bytes=-0`, que é um intervalo sintaticamente válido mas sem nenhum byte
- **Então** a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio. `getContents` não é chamado.

### RF-06 — `HEAD` com ranges devolve só cabeçalhos

**Critério de aceite**
- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`
- **Então** a resposta é `206` com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio. Para um intervalo não satisfazível, a resposta é `416` com os cabeçalhos do RF-05. `getContents` não é chamado em nenhum dos dois casos.

### RF-07 — Respeitar `If-Range`

Segundo a RFC 9110 §13.1.5:

- o `Range` só é aplicado se o validador de `If-Range` ainda corresponder à representação atual;
- um `ETag` só vale na comparação forte (o `ETag` de `getMeta` deve ser forte, sem prefixo `W/`);
- uma data só vale se for exatamente igual ao `Last-Modified` atual.

Se o validador não corresponder, ou se for um `ETag` fraco ou uma data inválida, o `Range` é ignorado e a resposta é `200` com o corpo completo. `If-Range` sem `Range` é ignorado.

**Critério de aceite**
- **Dado** um asset com `etag: "abc"` e `Range: bytes=0-1`
- **Quando** o cliente envia `If-Range: "abc"`
- **Então** a resposta é `206`.
- **Quando** o cliente envia `If-Range: "outro"` (ou `W/"abc"`)
- **Então** a resposta é `200` com o corpo completo.
- O mesmo vale para `If-Range` com data igual ao `Last-Modified` (`206`) e com data diferente (`200`).

### RF-08 — Precedência sobre as condicionais existentes

A avaliação de `If-None-Match` e `If-Modified-Since` (o `304` atual) acontece antes do tratamento de `Range`, como na RFC 9110 §13.2.2.

**Critério de aceite**
- **Dado** um asset com `etag` e um cliente que envia `Range: bytes=0-1` junto com `If-None-Match` igual ao `etag`
- **Quando** a requisição é processada
- **Então** a resposta é `304` sem corpo e sem `Content-Range`, igual ao comportamento atual.

### RF-09 — Preservar encoding, cache e cabeçalhos configurados

**Critério de aceite**
- **Dado** `encodings: { gzip: ".gz" }` e um cliente com `Accept-Encoding: gzip` que pede `Range: bytes=0-3`
- **Quando** a variante `.gz` é escolhida
- **Então** a resposta `206` traz `Content-Encoding: gzip`, `Vary: accept-encoding`, o `Content-Type` do asset original, e `Content-Range`/`Content-Length` calculados sobre o tamanho da variante `.gz`. `ETag`, `Last-Modified` e os cabeçalhos de `options.headers` são preservados.

### RF-10 — Sem `size` utilizável, nenhum comportamento novo

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não informa `size`, ou informa `size` 0 (ou negativo, ou não inteiro)
- **Quando** o cliente envia qualquer `Range`
- **Então** a resposta é idêntica à atual (`200`, corpo inteiro, sem `Content-Range`) e `Accept-Ranges` não é enviado.

### RF-11 — Manter fallthrough, 404 e 405

**Critério de aceite**
- **Dado** um asset inexistente, um método não permitido (ex.: `POST`) ou um caminho não canônico, com ou sem `Range`
- **Quando** `serveStatic` é chamado
- **Então** o resultado é o de hoje: `404` ou `405` com `Allow: GET, HEAD`, ou retorno `undefined` quando `fallthrough` está ativo, sem `Accept-Ranges` nem `Content-Range`.

### RF-12 — Corpo parcial coerente com `getContents`

O corpo do `206` contém exatamente os bytes do intervalo, qualquer que seja o tipo de `BodyInit` devolvido por `getContents` (string, `Uint8Array`/`ArrayBuffer`, `Blob`/`File`, `ReadableStream`). `getContents` é chamado uma única vez.

**Critério de aceite**
- **Dado** um `getContents` que devolve cada um desses tipos para o mesmo conteúdo de 10 bytes
- **Quando** o cliente envia `Range: bytes=2-5`
- **Então** o corpo recebido é `2345` em todos os casos, e o número de bytes confere com o `Content-Length`.

### RF-13 — Nenhuma exportação pública nova

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** se compara `src/index.ts` e as assinaturas públicas de `src/utils/static.ts` com o estado anterior
- **Então** não há nenhum nome novo (valor ou tipo) exportado, e todos os auxiliares (parser de `Range`, avaliação de `If-Range`, fatiamento do corpo) são funções privadas do módulo.

### RF-14 — Cobertura de testes

**Critério de aceite**
- **Dado** a suíte em `test/` (matriz `web` e `node`)
- **Quando** `pnpm vitest run` é executado
- **Então** existem testes novos para RF-01 a RF-12 e todos passam, junto com os existentes. Os testes existentes só são alterados onde dependem do que a mudança altera (por exemplo, a presença de `Accept-Ranges` em respostas `200`), sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

## 3. Fora de escopo

- Múltiplos intervalos e respostas `multipart/byteranges` (a issue pede ignorar `Range` multi-intervalo e servir o conteúdo completo).
- Novas opções em `ServeStaticOptions` ou novos campos em `StaticAssetMeta`. Nenhuma API pública muda.
- Um `getContents` com leitura parcial (por exemplo, um `getContents(id, range)` que evite carregar o arquivo inteiro). O fatiamento é feito sobre o que o `getContents` já devolve.
- Ranges para assets sem tamanho conhecido ou com tamanho 0.
- Unidades de range diferentes de `bytes`.
- Mudanças no tratamento de `Range` em `proxy`, `readBody` ou em outros utilitários.
- Qualquer mudança em cache, seleção de encoding, `fallthrough` e nas respostas 404/405 além do descrito aqui.
- Documentação além de eventuais comentários no código.

## 4. Premissas e riscos

### Premissas

- `meta.size` é o tamanho em bytes da variante realmente servida (a `.gz`, quando for o caso), e não o do arquivo original. Esse é o contrato implícito de hoje, já que ele alimenta o `Content-Length`.
- O valor de `meta.etag` fornecido pelo usuário segue a sintaxe de entity-tag (`"abc"` ou `W/"abc"`); a comparação forte do `If-Range` exige a forma sem `W/`.
- A issue pede `GET` e `HEAD`. A RFC 9110 define `Range` apenas para `GET`, mas permite que servidores respondam o `HEAD` de forma equivalente. Seguimos a issue.
- Os testes usam o `describeMatrix` existente, que cobre os alvos `web` e `node`.

### Riscos e decisões a confirmar

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **"Sempre anunciar `Accept-Ranges`"** (issue) conflita com "quando o tamanho é conhecido" (mesma issue). Anunciar sem tamanho seria uma promessa falsa. | Clientes tentariam ranges que não funcionam. | Adotamos a leitura restritiva (RF-01/RF-10): só anunciar com `size` suportado. Confirmar com quem pediu. |
| **Content-Length vindo de `options.headers`** (o código atual só define `content-length` se ainda não existir) pode contradizer o tamanho do `206`. | Resposta inconsistente ou truncada por proxies. | Em respostas `206`/`416`, o `Content-Length` calculado prevalece. Cobrir com teste. |
| **Fatiar `ReadableStream`/`Blob` sem ler tudo**: streams não suportam seek. | Consumo de memória ou latência em arquivos grandes. | Preferir `Blob.slice` e `Uint8Array.subarray`. Para streams, descartar os bytes iniciais e truncar no fim, sem acumular tudo. Registrar como limitação. |
| **`meta.size` incorreto** (diferente do tamanho real do conteúdo). | `Content-Range` ou `Content-Length` errados; corpo truncado. | Fora do controle do `serveStatic`. Documentar a premissa. |
| **Compatibilidade de testes existentes** que comparam cabeçalhos exatos de `200`. | Falhas por causa do novo `Accept-Ranges`. | Ajustar só o necessário e manter as verificações originais (RF-14). |
| **Interação entre `Range` e `Content-Encoding` dinâmico** (compressão aplicada por middleware depois do `serveStatic`). | O intervalo seria calculado sobre bytes que o cliente nunca vê. | Fora de escopo. Documentar que o `Range` vale para o conteúdo e o `size` informados por `getMeta`. |
| **Precisão de datas no `If-Range`** (truncamento a segundos). | Falso negativo ou positivo na comparação. | Comparar com `mtimeDate` já truncado a segundos, como no `Last-Modified` emitido. |
