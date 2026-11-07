# PRD — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

### Problema
Hoje `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor devolve o corpo inteiro com status 200 e não informa `Accept-Ranges`. Consequências:

- downloads não podem ser retomados;
- navegadores e players de vídeo/áudio não conseguem avançar ou voltar na mídia;
- CDNs e proxies não conseguem cachear nem repassar trechos corretamente.

### Objetivo
Fazer `serveStatic` atender pedidos de intervalo de bytes (um único intervalo, em GET e HEAD) quando o tamanho do asset é conhecido (`size` devolvido por `getMeta`), conforme a RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue. A mudança é compatível com o que existe: sem alteração de API e sem novas exportações.

### Métricas de sucesso
- Um cliente consegue retomar download e fazer seek em mídia servida por `serveStatic`.
- A suíte existente continua passando e `pnpm lint` e `pnpm typecheck` passam.
- `src/index.ts` não ganha nenhum nome.

## 2. Requisitos funcionais

Convenções: "asset" é o recurso resolvido por `getMeta`; "tamanho" é `meta.size`; "intervalo válido" é um `bytes=início-fim`, `bytes=início-` ou `bytes=-sufixo` bem formado.

### RF-01 — Anunciar suporte a ranges
`serveStatic` envia `Accept-Ranges: bytes` nas respostas de assets com tamanho conhecido.

- **Dado** um asset com `size` definido e maior que zero
- **Quando** o cliente faz GET ou HEAD sem cabeçalho `Range`
- **Então** a resposta é 200 com corpo completo (HEAD sem corpo) e inclui `Accept-Ranges: bytes`.

### RF-02 — Responder 206 para intervalo válido e satisfazível
Um único intervalo válido gera 206 Partial Content com apenas os bytes pedidos.

- **Dado** um asset de 10 bytes (`0123456789`) com `size: 10`
- **Quando** o cliente faz GET com `Range: bytes=2-5`
- **Então** a resposta é 206, o corpo é `2345`, `Content-Range: bytes 2-5/10` e `Content-Length: 4`.

### RF-03 — Formas de intervalo: aberto, sufixo e fim além do tamanho
Aceitar `início-`, `-sufixo` e `início-fim` com fim além do tamanho (RFC 9110, seção 14.1.2).

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `bytes=4-` (ou `bytes=-3`, ou `bytes=8-999`)
- **Então** a resposta é 206 com, respectivamente, `Content-Range: bytes 4-9/10` (6 bytes), `bytes 7-9/10` (3 bytes) e `bytes 8-9/10` (2 bytes), cada uma com o `Content-Length` correspondente. Um sufixo maior que o tamanho (`bytes=-50`) devolve o asset inteiro como 206 (`bytes 0-9/10`).

### RF-04 — HEAD com Range devolve só cabeçalhos
HEAD recebe os mesmos cabeçalhos que o GET equivalente, sem corpo.

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz HEAD com `Range: bytes=2-5`
- **Então** a resposta é 206 sem corpo, com `Content-Range: bytes 2-5/10` e `Content-Length: 4`, e `getContents` não é chamado.

### RF-05 — 416 para intervalo insatisfazível
Intervalo válido cujo início está além do fim do asset gera 416.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=10-20` (ou `bytes=-0`)
- **Então** a resposta é 416 Range Not Satisfiable, com `Content-Range: bytes */10`, `Content-Length: 0` e corpo vazio. Vale para GET e HEAD.

### RF-06 — Ignorar Range malformado, multi-range ou de unidade desconhecida
Nesses casos o servidor serve o recurso inteiro, como se não houvesse `Range`.

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=abc`, `bytes=5-2`, `bytes=0-1,4-5`, `items=0-1` ou `bytes=`
- **Então** a resposta é 200 com o corpo completo, sem `Content-Range`, e com `Accept-Ranges: bytes`.

### RF-07 — Respeitar `If-Range`
O Range só vale se o validador de `If-Range` corresponder ao asset atual (RFC 9110, seção 13.1.5).

- **Dado** um asset com `etag: "abc"` e `mtime` conhecidos
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"` (ou a data exata de `Last-Modified`)
- **Então** a resposta é 206.
- **Quando** o `If-Range` não corresponde (outro ETag, ETag fraco `W/"abc"`, data diferente ou formato inválido)
- **Então** o Range é ignorado e a resposta é 200 com o corpo completo.

### RF-08 — Não aplicar Range sem tamanho conhecido
Sem `size` válido o servidor não consegue calcular o intervalo.

- **Dado** um asset cujo `getMeta` não devolve `size` (ou devolve 0)
- **Quando** o cliente envia qualquer `Range`
- **Então** a resposta é a de hoje (200 com corpo completo), sem `Content-Range` e sem 416.

### RF-09 — Preservar cache condicional
Os pedidos condicionais continuam avaliados antes do Range.

- **Dado** um asset com `etag` e o cliente enviando `If-None-Match` correspondente
- **Quando** o pedido também traz `Range`
- **Então** a resposta é 304 como hoje, sem `Content-Range`. Em 206 e 416 permanecem `ETag` e `Last-Modified`.

### RF-10 — Preservar seleção de encoding
Com variante pré-comprimida (`encodings`), o Range se refere à variante servida.

- **Dado** `encodings: { gzip: ".gz" }`, o cliente aceitando gzip e `getMeta` devolvendo o `size` da variante `.gz`
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é 206 com os 4 primeiros bytes da variante comprimida, `Content-Encoding: gzip`, `Content-Range: bytes 0-3/<size da variante>` e `Vary: accept-encoding` mantido.

### RF-11 — Preservar `fallthrough`, 404 e 405
Os caminhos de erro não mudam.

- **Dado** asset inexistente, caminho não canônico ou método diferente de GET/HEAD
- **Quando** o pedido traz `Range`
- **Então** o resultado é o mesmo de hoje: 404 (ou `undefined` com `fallthrough`) para asset inexistente ou caminho não canônico, e 405 com `Allow: GET, HEAD` (ou `undefined` com `fallthrough`) para método não permitido. `Range` não altera esses resultados.

### RF-12 — Corpo parcial correto para vários tipos de `BodyInit`
O corte dos bytes funciona com o que `getContents` já pode devolver.

- **Dado** `getContents` devolvendo `string`, `Uint8Array`/`ArrayBuffer`, `Blob` ou `ReadableStream`
- **Quando** o cliente pede um intervalo válido
- **Então** o corpo do 206 tem exatamente os bytes do intervalo e `Content-Length` bate com o número de bytes enviados. Para strings, o tamanho considerado é o em bytes UTF-8, e é o `size` de `getMeta` que define o intervalo.

### RF-13 — Cabeçalhos do usuário e de erro
- **Dado** `options.headers` com cabeçalhos personalizados
- **Quando** a resposta é 200, 206 ou 416
- **Então** os cabeçalhos personalizados continuam presentes, exceto `Content-Length` e `Content-Range`, que refletem o corpo realmente enviado.

## 3. Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): são ignorados e geram resposta completa.
- Unidades de range diferentes de `bytes`.
- Range sem `size` conhecido, ou ler o tamanho por outro meio que não `getMeta`.
- Mudar `ServeStaticOptions`, `StaticAssetMeta` ou qualquer API pública. Nenhum nome novo em `src/index.ts`, nem valor nem tipo.
- Alterar `getContents` para receber o intervalo e ler só o trecho do disco (otimização futura possível).
- Range em outros utilitários (`proxy`, `serveStatic` de adaptadores externos, etc.).
- Mudanças em cache, seleção de encoding, `fallthrough` ou nas respostas 404/405 além do necessário aos requisitos acima.
- Alteração de documentação além da necessária para descrever o comportamento (opcional).

## 4. Premissas e riscos

### Premissas
- `meta.size` é o tamanho em bytes do corpo que será efetivamente enviado, ou seja, da variante já escolhida (inclusive a comprimida).
- As funções auxiliares (parser de `Range`, avaliação de `If-Range`, corte do corpo) ficam privadas em `src/utils/static.ts` ou em `src/utils/internal/`, sem reexportação.
- A RFC 9110 prevalece sobre a RFC 7233 em divergências.
- A ordem de avaliação segue a RFC 9110, seção 13.2.2: pré-condições (`If-None-Match`/`If-Modified-Since`) antes de `Range`/`If-Range`.
- Testes novos usam `describeMatrix` (web e node) e seguem o fluxo de correção do AGENTS.md. Testes existentes só mudam onde a nova resposta (por exemplo, `Accept-Ranges`) os afetar, sem perder o que verificam.

### Riscos e mitigações
- **Tamanho de `meta.size` incorreto** (ex.: asset alterado entre `getMeta` e `getContents`) pode gerar `Content-Length` diferente do corpo. Mitigação: cortar o corpo pelo intervalo calculado e documentar que `size` deve ser exato.
- **Corte de corpo em streams** pode consumir ou bufferizar demais. Mitigação: para `ReadableStream`, descartar bytes iniciais e limitar ao tamanho pedido sem bufferizar o stream inteiro. Para `Blob`, usar `slice`.
- **Interação com `Content-Encoding`**: um Range sobre variante comprimida entrega bytes comprimidos parciais. Isso é válido pela norma, desde que `size` seja o da variante. Risco de `size` do original ser usado por engano; coberto por RF-10.
- **Testes existentes que comparam cabeçalhos exatos** podem quebrar com o novo `Accept-Ranges`. Mitigação: ajustar só essas asserções.
- **`Content-Length` já definido por `options.headers`** pode conflitar com o do 206/416. Mitigação: a resposta parcial sobrescreve esse valor (RF-13).
- **Divergência de runtimes** (Node vs. web) no tratamento de HEAD/206 sem corpo. Mitigação: testes em `describeMatrix`.
- **Segurança**: valores numéricos enormes ou inválidos no `Range` (`bytes=0-99999999999999999999`) não podem causar exceção ou perda de precisão. Mitigação: tratar números acima de `Number.MAX_SAFE_INTEGER` como inválidos ou limitá-los ao tamanho.
