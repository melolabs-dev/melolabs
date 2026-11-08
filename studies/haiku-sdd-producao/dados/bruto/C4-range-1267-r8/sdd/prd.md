# PRD: HTTP Range em `serveStatic` (h3js/h3#1267)

Referências: issue h3js/h3#1267, contrato `sdd/pedido.md`, RFC 9110 (seções 13.1.5 If-Range e 14 Range Requests), implementação atual em `src/utils/static.ts`.

## Problema e objetivo

Hoje o `serveStatic` ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, a resposta traz o arquivo inteiro com status 200 e sem os cabeçalhos de conteúdo parcial. Com isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) no conteúdo servido pelo h3;
- proxies e CDNs não recebem a semântica HTTP esperada para conteúdo parcial.

**Objetivo:** fazer `serveStatic` atender requisições de intervalo de bytes para `GET` e `HEAD`, quando o tamanho do asset é conhecido, seguindo a RFC 9110. A mudança fica restrita ao módulo `src/utils/static.ts`, sem alterar a API pública e sem mudar o comportamento de requisições que não usam `Range`.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado (200, 206, 416 e HEAD).

- **Dado** um asset existente servido com `GET` sem cabeçalho `Range`
- **Quando** a requisição é processada
- **Então** a resposta 200 contém `Accept-Ranges: bytes`

### RF-02 — Responder 206 a um intervalo válido

Para `GET` com `Range: bytes=<início>-<fim>`, `bytes=<início>-` ou `bytes=-<sufixo>` válido, a resposta deve ter status 206 com o trecho pedido.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status 206 e corpo com exatamente os bytes 0 a 99

### RF-03 — Cabeçalhos de conteúdo parcial corretos

Respostas 206 devem trazer `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes do trecho.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta tem `Content-Range: bytes 100-199/1000` e `Content-Length: 100`

### RF-04 — HEAD com intervalo

Para `HEAD` com `Range` válido, a resposta deve ter status 206 e os mesmos cabeçalhos do RF-03, sem corpo.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-9`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-9/1000`, `Content-Length: 10` e corpo vazio

### RF-05 — Intervalo não satisfazível retorna 416

Quando o intervalo começa além do fim do asset, ou quando o sufixo tem comprimento zero, a resposta deve ser 416 com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-06 — Cabeçalho Range ignorado quando não utilizável

Se o `Range` for malformado (por exemplo `bytes=5-2` ou texto sem o formato `bytes=`), tiver unidade diferente de `bytes` ou pedir mais de um intervalo, o `serveStatic` deve ignorar o cabeçalho e responder 200 com o arquivo completo.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-1,5-9`
- **Então** a resposta tem status 200, corpo completo e sem `Content-Range`

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: items=0-9`
- **Então** a resposta tem status 200 e corpo completo

### RF-07 — Validação com If-Range

Se a requisição trouxer `If-Range`, o `Range` só é honrado quando o validador bate com o estado atual do asset (ETag forte igual ao atual, ou data igual ao `Last-Modified` enviado). Caso contrário, a resposta é 200 completa.

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "abc"`
- **Então** a resposta tem status 206

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "outra"`
- **Então** a resposta tem status 200 com o arquivo completo

- **Dado** um asset com ETag fraca `W/"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: W/"abc"`
- **Então** a resposta tem status 200, pois ETag fraca nunca satisfaz If-Range

### RF-08 — Precedência das condições de cache

A verificação de cache existente (304 para `If-None-Match` e `If-Modified-Since`) continua valendo antes de qualquer `Range`. Quando a resposta for 304, o `Range` é ignorado.

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente envia `If-None-Match: "abc"` junto com `Range: bytes=0-9`
- **Então** a resposta tem status 304 e sem corpo

### RF-09 — Normalização de limites

- `bytes=<início>-<fim>` com `<fim>` maior ou igual ao tamanho deve ser ajustado para `tamanho - 1`.
- `bytes=-<sufixo>` com sufixo maior que o tamanho deve retornar o asset inteiro em 206.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=900-5000`
- **Então** a resposta tem status 206, `Content-Range: bytes 900-999/1000` e `Content-Length: 100`

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=-5000`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-999/1000` e `Content-Length: 1000`

### RF-10 — Asset de tamanho desconhecido ou zero

Quando `getMeta` não devolver `size` (ou devolver 0), o `Range` é ignorado e a resposta é 200 completa, sem `Content-Range`. Não há como calcular o intervalo sem o tamanho.

- **Dado** um asset cujo `getMeta` não informa `size`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta tem status 200 com o arquivo completo

### RF-11 — Intervalo aplica-se à variante servida

Quando houver variante pré-comprimida selecionada por `accept-encoding` (por exemplo `.gz`), o intervalo é calculado sobre os bytes dessa variante, usando o `size` retornado por `getMeta` para ela.

- **Dado** um asset `app.js` com variante `app.js.gz` de 300 bytes e `encodings: { gzip: ".gz" }`
- **Quando** o cliente envia `accept-encoding: gzip` e `Range: bytes=0-9`
- **Então** a resposta tem status 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-9/300` e `Content-Length: 10`

### RF-12 — Sem regressão para requisições sem Range

Para requisições sem `Range`, as respostas de cache (304), seleção de encoding, `Vary`, `fallthrough`, 404 para asset inexistente e 405 para método não permitido devem permanecer idênticas às atuais, exceto pela presença de `Accept-Ranges` (RF-01).

- **Dado** um asset inexistente com `fallthrough: false`
- **Quando** o cliente faz `GET` sem `Range`
- **Então** a resposta continua sendo 404, como hoje

- **Dado** uma requisição `POST` a um asset com `fallthrough: true`
- **Quando** o `serveStatic` é chamado
- **Então** a função retorna `undefined` e a cadeia continua, como hoje

### RF-13 — Sem exportações públicas novas

A mudança não pode adicionar nomes (valores ou tipos) em `src/index.ts`. Helpers de parsing de `Range` e de `If-Range` ficam privados em `src/utils/static.ts`.

- **Dado** o código após a mudança
- **Quando** se compara `src/index.ts` com a versão anterior
- **Então** não há novas exportações

### RF-14 — Qualidade e testes

Os testes devem cobrir os cenários dos RFs 01 a 12 nos dois modos (`web` e `node`) via `describeMatrix`. Testes existentes só são ajustados quando dependem de um comportamento que a mudança altera (por exemplo, a lista de cabeçalhos de uma resposta 200). `pnpm lint` e `pnpm typecheck` devem passar, e a suíte existente deve continuar verde.

- **Dado** a branch com a mudança
- **Quando** se executa `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`
- **Então** os três terminam sem erro

## Fora de escopo

- `multipart/byteranges` (resposta com vários intervalos). Pedidos com vários intervalos recebem 200 completo, como pede a issue.
- Unidades de intervalo diferentes de `bytes`.
- Suporte a `Range` em `PUT`, `POST` ou outros métodos além de `GET` e `HEAD`.
- Leitura parcial no backend: `getContents` continua recebendo só o `id`, sem novo parâmetro de intervalo. Não se cria nova opção em `ServeStaticOptions`.
- Recodificar ou descomprimir a variante para atender um intervalo. O intervalo sempre recai sobre os bytes armazenados.
- Mudanças em `If-Match`, `If-Unmodified-Since` ou em outras pré-condições além das já tratadas.
- Integração com `h3/rules/cache` e com `h3/rules/proxy`.
- Mudanças nos demais utilitários (`proxy`, `event-stream`, respostas de `HTTPResponse`).
- Documentação de usuário além de comentários de código necessários.

## Premissas e riscos

### Premissas

- O `size` retornado por `getMeta` corresponde exatamente aos bytes que `getContents` entrega. Se não corresponder, `Content-Range` e `Content-Length` ficam errados.
- Quando a issue cita RFC 7233, a implementação segue a RFC 9110, que a substitui (conforme o contrato em `sdd/pedido.md`).
- Ignorar `Range` (RF-06, RF-10) é uma resposta válida da RFC 9110: o servidor pode ignorar o cabeçalho.
- `Accept-Ranges` é enviado apenas em respostas de asset encontrado (200, 206, 416 e HEAD), não em 304, 404 ou 405.
- A validação de data em `If-Range` compara com o `Last-Modified` já enviado, em segundos inteiros, como hoje.
- Os cabeçalhos configurados em `options.headers` continuam tendo precedência sobre os valores padrão. A exceção é `Content-Length` e `Content-Range` de respostas 206 e 416, que precisam refletir o trecho.

### Riscos

- **Memória com arquivos grandes (alto).** Sem leitura parcial no backend, fatiar o corpo de um vídeo grande pode exigir carregar o arquivo inteiro. O tipo de `BodyInit` varia (string, `Blob`, `ReadableStream`, `ArrayBuffer`, typed array), e cada um exige uma forma diferente de fatiar. A abordagem por tipo deve ser decidida na implementação e medida com um arquivo grande.
- **Erros de contagem (médio).** Os limites são inclusivos e há casos de borda (sufixo maior que o arquivo, `bytes=0-0`, arquivo de 1 byte). Erros de um byte passam despercebidos sem testes de borda.
- **Quebra de testes existentes (médio).** Incluir `Accept-Ranges` em todas as respostas 200 pode quebrar asserts de cabeçalhos já existentes. O ajuste deve preservar o que cada teste verifica.
- **Conflito com `content-length` já definido (médio).** A lógica atual só define `content-length` se ele ainda não existir. Respostas 206 e 416 precisam sobrescrever esse valor, o que muda a regra para esses casos.
- **Cache intermediário (baixo).** Proxies e CDNs precisam tratar 206 corretamente. Não há como garantir isso do lado do h3, e a mudança não altera `Cache-Control`.
- **Compressão e seek (baixo).** Com variante `gzip`, o cliente recebe trechos do arquivo comprimido, que não podem ser decodificados parcialmente. Isso segue a RFC, mas limita o uso de seek em conteúdo pré-comprimido.
- **Contrato do `getMeta` (baixo).** Um `getMeta` que devolva `size` inconsistente com o conteúdo gera respostas incorretas sem erro explícito.
