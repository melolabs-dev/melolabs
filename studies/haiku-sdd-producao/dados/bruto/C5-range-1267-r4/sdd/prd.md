# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: issue h3js/h3#1267 e contrato enxuto em `sdd/pedido.md`. Norma: RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue.

## Problema e objetivo

### Problema

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Hoje ele:

- nunca responde `206 Partial Content`, mesmo quando o cliente pede um intervalo;
- não anuncia `Accept-Ranges`;
- envia sempre o corpo completo, com `200`, vindo de `getContents`.

Consequências: downloads não podem ser retomados, players de vídeo e áudio não conseguem avançar (seek) e CDNs e proxies não recebem o comportamento esperado para arquivos estáticos.

### Objetivo

Fazer `serveStatic` atender requisições de intervalo de bytes (`Range`) em `GET` e `HEAD`, quando o tamanho do asset for conhecido, com a semântica da RFC 9110. A mudança é retrocompatível e não altera a API pública.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` passa a enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado (200, 206, 416 e HEAD).

**Critério de aceite:**
- **Dado** um asset existente com `getMeta` retornando `size`,
- **Quando** o cliente faz `GET /arquivo.bin` sem cabeçalho `Range`,
- **Então** a resposta é `200`, com corpo completo e `Accept-Ranges: bytes`.

### RF-02 — Responder intervalo válido único com 206

Para um `GET` com um único intervalo sintaticamente válido e satisfazível, a resposta é `206`, com `Content-Range: bytes <início>-<fim>/<tamanho>`, `Content-Length` igual ao número de bytes do intervalo e corpo apenas com esses bytes. São aceitas as formas `bytes=a-b`, `bytes=a-` (até o fim) e `bytes=-n` (últimos `n` bytes). Um `fim` maior que `tamanho - 1` é limitado a `tamanho - 1`; um sufixo maior que o tamanho resulta no arquivo inteiro.

**Critério de aceite:**
- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo com exatamente os bytes 0 a 99.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=-50`,
- **Então** a resposta é `206`, com `Content-Range: bytes 950-999/1000` e corpo com 50 bytes.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=990-5000`,
- **Então** a resposta é `206`, com `Content-Range: bytes 990-999/1000` e `Content-Length: 10`.

### RF-03 — HEAD com intervalo válido

Para `HEAD` com intervalo válido e satisfazível, a resposta tem os mesmos status e cabeçalhos do RF-02, sem corpo.

**Critério de aceite:**
- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD /arquivo.bin` com `Range: bytes=0-99`,
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100`, sem corpo, e `getContents` não é chamado.

### RF-04 — Ignorar Range malformado ou múltiplo

Quando o `Range` é malformado (fora da sintaxe da RFC 9110, inclusive `a > b`), usa unidade diferente de `bytes` ou pede mais de um intervalo, o cabeçalho é ignorado e a resposta é o `200` completo. Quando o asset não tem `size` conhecido (`undefined`), o `Range` também é ignorado.

**Critério de aceite:**
- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-10,20-30` ou `Range: bytes=50-10` ou `Range: items=0-10`,
- **Então** a resposta é `200` com corpo completo, sem `Content-Range`.

- **Dado** um asset cujo `getMeta` não retorna `size`,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta é `200` com corpo completo.

### RF-05 — Responder 416 para intervalo não satisfazível

Quando o `Range` é sintaticamente válido, mas nenhum byte do asset está no intervalo (início maior ou igual ao tamanho, sufixo de tamanho zero ou asset de tamanho zero), a resposta é `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e sem corpo.

**Critério de aceite:**
- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=1000-1100`,
- **Então** a resposta é `416`, com `Content-Range: bytes */1000` e `Content-Length: 0`.

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `HEAD` com `Range: bytes=1000-`,
- **Então** a resposta é `416`, com `Content-Range: bytes */1000` e sem corpo.

### RF-06 — If-Range

Quando a requisição traz `If-Range`, o `Range` só é aplicado se o validador bater com o estado atual do asset. Se não bater, o `Range` é ignorado e a resposta é o `200` completo.

- Validador `ETag`: aplica-se apenas se for igual ao `etag` atual e forte. ETag fraca nunca casa com `If-Range`.
- Validador de data: aplica-se apenas se for igual ao `last-modified` atual (precisão de segundos).

**Critério de aceite:**
- **Dado** um asset com `etag: "v1"`,
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "v1"`,
- **Então** a resposta é `206`.

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "v0"` ou `If-Range: W/"v1"`,
- **Então** a resposta é `200` com corpo completo.

### RF-07 — Ordem das avaliações e comportamento preservado

O `Range` é avaliado depois das condicionais de cache: `If-None-Match` e `If-Modified-Since` que resultem em `304` continuam vencendo. Também continuam iguais ao comportamento atual: `404` para asset inexistente, `405` com `Allow: GET, HEAD` para outros métodos, `fallthrough` (inclusive para métodos não permitidos e URLs não canônicas), seleção de variante por `accept-encoding`, `Vary` e `content-type`/`content-encoding`.

**Critério de aceite:**
- **Dado** um asset cujo `etag` é `"v1"`,
- **Quando** o cliente envia `If-None-Match: "v1"` e `Range: bytes=0-99`,
- **Então** a resposta é `304`, sem corpo e sem `Content-Range`.

- **Dado** um `POST` em um caminho de asset,
- **Quando** `serveStatic` é chamado com `fallthrough: false`,
- **Então** a resposta continua sendo `405` com `Allow: GET, HEAD`, como hoje.

- **Dado** um asset inexistente com `fallthrough: true`,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a função retorna `undefined` e o próximo handler responde.

### RF-08 — Intervalos sobre a variante servida

Os intervalos e o `Content-Length` usam os bytes da variante escolhida (por exemplo `app.js.gz` quando `gzip` for aceito) e o `size` dessa variante vindo de `getMeta`. O `Content-Encoding` da resposta parcial é o mesmo da resposta completa.

**Critério de aceite:**
- **Dado** `encodings: { gzip: ".gz" }`, um asset `app.js` com 1000 bytes e `app.js.gz` com 300 bytes,
- **Quando** o cliente envia `Accept-Encoding: gzip` e `Range: bytes=0-99`,
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/300`, `Content-Encoding: gzip` e `Content-Type` do `app.js`.

### RF-09 — Sem novas exportações

`src/index.ts` não ganha nomes (valores ou tipos). Os helpers de Range ficam privados em `src/utils/static.ts`. Não há novas opções em `ServeStaticOptions`.

**Critério de aceite:**
- **Dado** o código após a mudança,
- **Quando** se compara a lista de exports de `src/index.ts` e de `src/utils/static.ts` com a versão anterior,
- **Então** não há diferença de exports públicos.

### RF-10 — Cobertura de testes

Os casos dos RF-01 a RF-08 têm testes em `test/static.test.ts`, usando `describeMatrix` para rodar em `web` e `node`. Testes existentes só são alterados quando dependem do que a mudança altera (por exemplo, a presença de `Accept-Ranges`), mantendo o que eles verificam. A regra de correção de bug do `AGENTS.md` vale aqui: teste primeiro e confirmar a falha antes da implementação.

**Critério de aceite:**
- **Dado** a branch com a mudança,
- **Quando** `pnpm vitest run test/static.test.ts` e `pnpm lint` são executados,
- **Então** ambos passam, e os testes dos RF-02 a RF-06 falharam antes da implementação.

## Fora de escopo

- `multipart/byteranges` (resposta com mais de um intervalo). Múltiplos intervalos são ignorados, o que a RFC permite.
- Range em `PUT`, `POST` ou outros métodos. Continuam com `405`.
- Range para assets sem `size` conhecido em `getMeta`.
- Mudanças na API de `getMeta`/`getContents` ou novas opções em `ServeStaticOptions`.
- Range em outros pontos do framework (`routeRules`, `h3/rules/proxy`, `proxyRequest`).
- Cache próprio de respostas parciais no servidor.
- Retomada de download do lado do cliente.
- Mudanças na lógica de segurança de caminhos (`isCanonicalPath`, decodificação de `id`).

## Premissas e riscos

1. **Fatiamento do corpo.** `getContents` retorna `BodyInit`. Blob, ArrayBuffer, TypedArray e string podem ser fatiados diretamente. `ReadableStream` não pode ser fatiado sem ler o corpo inteiro. *Recomendação:* para stream, ignorar o `Range` e responder `200` completo, documentando a limitação. Precisa de confirmação, porque contraria o objetivo de atender Range com asset conhecido.
2. **Consistência de `size`.** O `size` de `getMeta` precisa ser o tamanho real do conteúdo que `getContents` devolve. Se divergir, o `206` fica incorreto. Esse contrato deve ser documentado nas opções.
3. **Variantes pré-comprimidas.** Ranges são aplicados aos bytes comprimidos da variante servida. A RFC permite, e é o que o RF-08 define. Clientes que combinam `Range` com `Accept-Encoding` recebem bytes comprimidos parciais. *Recomendação:* aceitar e documentar.
4. **Cabeçalhos definidos pelo usuário.** Hoje `content-length` só é definido se ainda não existir. Para `206` e `416`, o `Content-Length` calculado pelo intervalo substitui o valor já definido, para não enviar um tamanho errado.
5. **Impacto em respostas existentes.** `Accept-Ranges` passa a aparecer em todo asset servido. Testes que comparam o conjunto exato de cabeçalhos podem quebrar e devem ser ajustados só nesse ponto.
6. **Norma.** A issue cita RFC 7233. O contrato segue a RFC 9110, que a substitui. As diferenças relevantes para este PRD são nulas.
7. **If-Range não está na issue.** Foi incluído (RF-06) porque a retomada de download fica incorreta se o arquivo mudou entre as requisições, e a norma o cita. *Confirmar se entra nesta entrega.*
8. **Sufixos e intervalos abertos.** `bytes=-n` e `bytes=a-` não estão explícitos na issue, mas fazem parte de "intervalo único" na RFC 9110. Estão incluídos no RF-02.
9. **Caches intermediários.** Não foi verificado como CDNs tratam respostas `206` para este caminho de asset. Deve ser validado em uso real, não bloqueia a entrega.
