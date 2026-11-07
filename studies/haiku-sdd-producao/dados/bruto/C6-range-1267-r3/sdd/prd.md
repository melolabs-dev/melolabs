# PRD: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o corpo inteiro com status 200 e sem os cabeçalhos de conteúdo parcial. Com isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) de forma eficiente;
- CDNs e proxies não recebem a sinalização que esperam para cache parcial.

**Objetivo:** fazer o `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública nem o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` passa a enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta tem status 200 e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder intervalo válido com 206

Para um `Range` de byte único e sintaticamente válido (`bytes=a-b`, `bytes=a-` e `bytes=-n`), a resposta é 206 com o trecho pedido.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 0 a 99.

Quando `b` ultrapassa o tamanho do asset, o fim é limitado a `tamanho - 1`. Para `bytes=-n`, o trecho são os últimos `n` bytes (ou o asset inteiro, se `n` for maior que o tamanho).

### RF-03 — HEAD com intervalo válido

Em `HEAD`, um intervalo válido retorna 206 apenas com cabeçalhos, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-04 — Intervalo não satisfazível retorna 416

Se o intervalo começa além do fim do asset, ou se é `bytes=-0`, a resposta é 416.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=1000-`
- **Então** a resposta tem status 416, `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-05 — Ignorar Range malformado ou com múltiplos intervalos

Um `Range` malformado, com unidade diferente de `bytes` ou com mais de um intervalo é ignorado. A resposta é o asset completo com status 200.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-10,20-30`, `Range: itens=0-10` ou `Range: bytes=abc`
- **Então** a resposta tem status 200, o corpo completo e não tem `Content-Range`.

### RF-06 — Respeitar If-Range

Se o cabeçalho `If-Range` não corresponder ao validador atual do asset (ETag ou `Last-Modified`), o `Range` é ignorado e a resposta é 200 completa (RFC 9110, 13.1.5).

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente faz `GET` com `Range: bytes=0-99` e `If-Range: "v0"`
- **Então** a resposta tem status 200 com o corpo completo.
- **E** com `If-Range: "v1"` a resposta tem status 206.

### RF-07 — Preservar o comportamento existente

O suporte a Range não altera nenhum fluxo que já existe:

- a resposta 304 de cache (`If-None-Match` / `If-Modified-Since`) continua tendo precedência sobre `Range`;
- a seleção de variante comprimida continua sendo feita antes do recorte, e o `Content-Length` do 206 corresponde à variante escolhida;
- `fallthrough`, a resposta 404 para asset inexistente e a resposta 405 para método não permitido continuam iguais;
- o cabeçalho `Vary` continua sendo definido como hoje.

**Critério de aceite**

- **Dado** um asset com variante `.gz` e um cliente que envia `Accept-Encoding: gzip` e `Range: bytes=0-9`
- **Quando** o `serveStatic` resolve a variante
- **Então** o recorte é feito sobre os bytes da variante `.gz`, com `Content-Encoding: gzip` e `Content-Length` igual ao tamanho do trecho.
- **E** um `If-None-Match` que casa com o ETag responde 304, mesmo com `Range` presente.

### RF-08 — Nenhuma exportação pública nova

A mudança não adiciona nomes em `src/index.ts`, nem valores nem tipos. Os helpers de parsing e de recorte ficam privados em `src/utils/static.ts`.

**Critério de aceite**

- **Dado** o código antes e depois da mudança
- **Quando** se compara a lista de exports de `src/index.ts`
- **Então** a lista é idêntica.

### RF-09 — Cobertura e qualidade

Os novos comportamentos são cobertos por testes usando `describeMatrix` (web e node), e a suíte existente continua passando. Testes existentes só são ajustados quando a nova saída (por exemplo, `Accept-Ranges` em respostas que já eram verificadas) os quebra, sem perder o que eles verificam.

**Critério de aceite**

- **Dado** a branch com a mudança
- **Quando** se roda `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam, e há testes para RF-01 a RF-07 nos dois runtimes.

## Fora de escopo

- Múltiplos intervalos em um mesmo pedido (`multipart/byteranges`). Esses pedidos são ignorados e retornam 200 (RF-05).
- Unidades de Range diferentes de `bytes`.
- Novos parâmetros em `getMeta` ou `getContents` para receber o intervalo do backend. Isso seria mudança de API pública e fica para uma discussão separada.
- Compressão ou transcodificação sob demanda para satisfazer Range.
- Range em respostas 304 e em respostas de `fallthrough` para outros handlers.
- Otimizações de cache de recorte (por exemplo, pré-fatiar arquivos em disco).
- Alterações em `src/utils/internal/cache.ts` ou em outros utilitários além de `static.ts` e seus testes.

## Premissas

- **P1.** O tamanho do asset vem de `meta.size` retornado por `getMeta`. Quando `size` não é informado, o `Range` é ignorado e a resposta segue como hoje (200). Esta é a leitura do pedido: "quando o tamanho do asset é conhecido".
- **P2.** O recorte é feito sobre o corpo devolvido por `getContents`, já que a API atual não aceita intervalo. Para `Blob`, `ArrayBuffer`, `Uint8Array` e string, o recorte é direto. Para `ReadableStream`, é preciso fatiar em nível de bytes, o que exige ler e descartar o início do stream.
- **P3.** `Accept-Ranges` é anunciado apenas em respostas de assets encontrados (200, 206 e 416), não em 404, 405 ou 304.
- **P4.** Para um asset de tamanho 0, um `Range` com sintaxe válida retorna 416, conforme a RFC. Isso precisa ser confirmado, porque o código atual trata `size` 0 como "tamanho desconhecido" ao definir `Content-Length`.
- **P5.** Quando o usuário passa `headers` no `ServeStaticOptions` com `content-length` ou `content-range`, prevalece o cabeçalho do usuário para `content-length`, como hoje. Em caso de conflito com 206, a regra precisa ser definida no código (ver riscos).
- **P6.** O código segue as convenções do `AGENTS.md`: helpers no fim do arquivo, `k` para símbolos, sem enums, e imports com extensão `.ts`.

## Riscos

- **R1 — Custo de memória e de I/O em mídia grande.** Como `getContents` não recebe intervalo, um 206 de um vídeo grande pode forçar a leitura do arquivo inteiro antes do recorte. Isso anula parte do benefício para seek em mídia. Mitigação: documentar o custo; avaliar a mudança de API separadamente (ver Fora de escopo).
- **R2 — Conflito com `headers` do usuário.** Um `content-length` definido pelo usuário pode ser diferente do trecho recortado, e isso geraria resposta 206 inválida. Mitigação: definir a precedência no código e cobrir com teste.
- **R3 — Quebra de testes existentes.** Respostas que hoje são comparadas em detalhe podem mudar com `Accept-Ranges`. Mitigação: ajustar só as asserções afetadas e manter o que elas verificam.
- **R4 — Interação com encoding.** Recortar uma variante comprimida (`gzip`, `br`) é válido pela RFC, mas clientes podem esperar intervalos sobre a representação descomprimida. Mitigação: a regra da RF-07 fixa o comportamento e o teste documenta.
- **R5 — Regressão de segurança.** O código atual tem uma série de regras de canonização de caminho. O recorte não pode mudar o `id` usado para `getMeta` e `getContents`. Mitigação: manter o fluxo de `id` intacto e cobrir com os testes de traversal existentes.
- **R6 — Leitura da RFC.** A issue cita a RFC 7233, que foi substituída pela RFC 9110. O PRD segue a RFC 9110, mas o autor da issue pode ter outra expectativa para `If-Range` (que a issue não menciona).
