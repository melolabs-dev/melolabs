# PRD: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde com o corpo inteiro, sem `206 Partial Content` nem `Content-Range`. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players, que enviam `Range` por padrão;
- comportamento correto de CDNs e proxies, que dependem de respostas parciais.

**Objetivo:** fazer o `serveStatic` atender requisições `GET` e `HEAD` com um intervalo de bytes único, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública nem o comportamento já existente para as demais requisições.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve enviar `Accept-Ranges: bytes` em todas as respostas de asset encontrado (200, 206 e 416), tanto para `GET` quanto para `HEAD`.

**Critério de aceite**

- **Dado** um asset existente e uma requisição `GET` sem cabeçalho `Range`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta 200 contém `Accept-Ranges: bytes`.

### RF-02 — Responder 206 a intervalo único válido

Para um cabeçalho `Range: bytes=<início>-<fim>` válido, e também para as formas `bytes=<início>-` (até o fim) e `bytes=-<n>` (últimos `n` bytes), o `serveStatic` deve responder `206 Partial Content` com o trecho correspondente. A resposta deve conter `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Se `<fim>` ultrapassar o tamanho, ele é limitado ao último byte do asset.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição `GET` com `Range: bytes=0-499`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 206, `Content-Range` é `bytes 0-499/1000`, `Content-Length` é `500` e o corpo tem exatamente os bytes 0 a 499 do asset.

### RF-03 — Ignorar Range malformado ou com múltiplos intervalos

Quando o cabeçalho `Range` for sintaticamente inválido, usar unidade diferente de `bytes` ou pedir mais de um intervalo, o `serveStatic` deve ignorar o cabeçalho e responder `200` com o corpo completo, como em uma requisição sem `Range`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição `GET` com `Range: bytes=0-10, 20-30`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 200, não há `Content-Range` e o corpo é o asset completo.

### RF-04 — Responder 416 a intervalo não satisfazível

Quando o intervalo for sintaticamente válido, mas não puder ser atendido (início maior ou igual ao tamanho do asset, ou sufixo de tamanho zero), o `serveStatic` deve responder `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição `GET` com `Range: bytes=1000-1200`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 416, `Content-Range` é `bytes */1000`, `Content-Length` é `0` e o corpo é vazio.

### RF-05 — HEAD com intervalo

Para `HEAD`, o `serveStatic` deve devolver os mesmos status e cabeçalhos que o `GET` (206 com `Content-Range` e `Content-Length` do trecho, ou 416), sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e a requisição `HEAD` com `Range: bytes=0-499`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 206, `Content-Range` é `bytes 0-499/1000`, `Content-Length` é `500` e o corpo é vazio.

### RF-06 — Validar o intervalo com If-Range

Quando a requisição tiver `If-Range`, o `Range` só deve ser atendido se o validador informado corresponder ao estado atual do asset: um ETag forte idêntico ao do asset, ou uma data idêntica ao `Last-Modified`. Caso contrário, o `serveStatic` deve ignorar o `Range` e responder 200 com o corpo completo. ETag fraco nunca corresponde.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"` e a requisição `GET` com `Range: bytes=0-499` e `If-Range: "xyz"`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 200 e o corpo é o asset completo.

### RF-07 — Respeitar a precedência das condicionais

A verificação de cache (`If-None-Match` e `If-Modified-Since`, que gera 304) deve continuar sendo feita antes do processamento de `Range`. Uma requisição que resulte em 304 não recebe 206 nem 416.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"` e a requisição `GET` com `Range: bytes=0-499` e `If-None-Match: "abc"`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 304 e não há `Content-Range`.

### RF-08 — Ignorar Range quando o tamanho é desconhecido

Se `getMeta` não informar `size` (ou informar valor não positivo), o `serveStatic` não consegue calcular o trecho. Nesse caso deve ignorar o `Range` e responder 200 com o corpo completo.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size` e a requisição `GET` com `Range: bytes=0-499`,
- **Quando** o `serveStatic` responde,
- **Então** o status é 200 e o corpo é o asset completo.

### RF-09 — Preservar o comportamento existente

Cache, seleção de `Content-Encoding` por `Accept-Encoding`, cabeçalho `Vary`, `fallthrough`, a resposta 404 para asset inexistente e a resposta 405 (com `Allow: GET, HEAD`) para métodos não permitidos devem continuar iguais para requisições sem `Range`. Para requisições com `Range`, a única diferença permitida é a descrita nos RFs anteriores.

**Critério de aceite**

- **Dado** um `serveStatic` com `fallthrough: true` e uma requisição `POST` com `Range: bytes=0-10`,
- **Quando** o handler é executado,
- **Então** ele retorna sem resposta (`undefined`), como antes da mudança.

### RF-10 — Sem exportações públicas novas

`src/index.ts` não deve ganhar nenhum nome (valor ou tipo). Funções auxiliares de parsing e cálculo de intervalo ficam privadas no módulo `src/utils/static.ts`, e nenhuma opção nova é adicionada a `ServeStaticOptions`.

**Critério de aceite**

- **Dado** o arquivo `src/index.ts` antes e depois da mudança,
- **Quando** os exports são comparados,
- **Então** a lista de nomes exportados é idêntica.

### RF-11 — Cobertura em web e node

Os novos comportamentos devem ser cobertos por testes com `describeMatrix` (modo `web` e `node`), cobrindo pelo menos os cenários dos RF-02 a RF-08.

**Critério de aceite**

- **Dado** a suíte de testes do projeto,
- **Quando** `pnpm vitest run` é executado para os testes de static,
- **Então** todos os cenários de RF-02 a RF-08 passam nos modos `web` e `node`.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): pedidos com mais de um intervalo são ignorados (RF-03).
- Range aplicado a outros utilitários (`proxy`, `serveStatic` de rotas de cache do `h3/rules`, respostas de `sendStream`).
- Alterar a assinatura de `getContents` ou criar uma opção para receber o intervalo do backend.
- Suporte a `If-Range` com data em formato diferente do `Last-Modified` exato ou com ETag fraco.
- Cache separado para respostas 206.
- Streaming com seek real para fontes que não são `Blob`/`File`/buffer (ver premissas).
- Alterações em `pnpm build`, dependências ou configuração de lint.

## Premissas e riscos

**Premissas**

- A norma de referência é a RFC 9110 (a issue cita a RFC 7233, que foi substituída). Quando a issue e a norma divergirem, vale a norma.
- Um cabeçalho `Range` malformado é ignorado, não rejeitado com 400, conforme a RFC 9110 permite.
- O `size` de `getMeta` é o tamanho real do conteúdo que `getContents` devolve para o mesmo `id`.
- Para assets pré-comprimidos (`.gz`, `.br`), o intervalo é aplicado aos bytes da variante escolhida, e `size` é o tamanho dessa variante.
- O `Content-Length` atual é definido só quando `size > 0` e não há cabeçalho já definido. Para 206 e 416 o valor precisa ser sobrescrito pelo intervalo.

**Riscos**

- **Recorte do corpo (principal):** `getContents(id)` não recebe o intervalo. Para atender 206 é preciso fatiar o conteúdo. Se o conteúdo for `Blob`/`File`, dá para usar `slice`, sem carregar tudo em memória. Para outros tipos (string, `ArrayBuffer`, `ReadableStream`), o fatiamento exige ler o conteúdo inteiro ou aceitar ignorar o `Range`. Decisão a confirmar: fatiar `Blob`/`File` e, para os demais, ler o conteúdo inteiro, ou responder 200 quando não for possível fatiar sem custo alto.
- **Consumo de memória:** se o fallback de leitura inteira for usado com arquivos grandes, o impacto em memória é direto. Vale medir antes de liberar o recurso.
- **Divergência de `size`:** se `getMeta` informar tamanho diferente do conteúdo real, `Content-Range` e `Content-Length` ficarão errados.
- **Cabeçalhos definidos pelo usuário:** se `options.headers` já tiver `content-length`, a lógica atual não o substitui. Um 206 com esse cabeçalho ficaria incorreto. Precisa de tratamento explícito.
- **Regressão em cache e 304:** a mudança mexe no fluxo de respostas. Os testes existentes de cache e de `Vary` devem continuar passando sem alteração de expectativa.
- **Testes existentes:** se algum teste atual depender de `Range` ser ignorado, ele deve ser ajustado, mantendo o que verifica, conforme `sdd/pedido.md`.
