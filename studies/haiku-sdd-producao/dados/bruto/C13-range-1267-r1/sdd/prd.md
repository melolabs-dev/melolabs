# PRD: HTTP Range em `serveStatic` (h3js/h3#1267)

## Problema e objetivo

`serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando o cliente pede um trecho, o servidor devolve o arquivo inteiro com status 200 e não anuncia suporte a intervalos. Por isso:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek);
- CDNs e proxies não conseguem fazer cache por trecho.

**Objetivo:** fazer `serveStatic` atender pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

- **Dado** um `GET` ou `HEAD` para um asset cujo `getMeta` devolve `size` conhecido,
- **Quando** a resposta é montada,
- **Então** ela inclui `Accept-Ranges: bytes`.

Sem `size` conhecido, o asset é servido como hoje e não recebe `Accept-Ranges`, porque o servidor não consegue atender intervalos sem saber o tamanho.

### RF-02 — Responder 206 para um intervalo válido

- **Dado** um asset com `size` conhecido e um cabeçalho `Range: bytes=a-b` (ou `bytes=a-`, ou `bytes=-n`) cujo intervalo é satisfazível,
- **Quando** o cliente faz `GET`,
- **Então** a resposta tem status 206, `Content-Range: bytes a-b/size`, `Content-Length` igual ao tamanho do trecho e o corpo contém apenas esse trecho.

### RF-03 — Limitar intervalos que passam do fim do arquivo

- **Dado** um asset de `size` bytes,
- **Quando** o cliente pede `bytes=a-b` com `b >= size`, ou `bytes=-n` com `n > size`,
- **Então** o fim do intervalo é ajustado para `size - 1`, ou, no caso do sufixo, o intervalo passa a ser o arquivo inteiro. A resposta é 206 com os valores ajustados.

### RF-04 — Responder 416 para intervalo não satisfazível

- **Dado** um asset de `size` bytes,
- **Quando** o cliente pede um intervalo que começa em `a >= size`, ou um sufixo de tamanho zero,
- **Então** a resposta tem status 416, `Content-Range: bytes */size` e `Content-Length: 0`.

### RF-05 — Ignorar `Range` que não se aplica

- **Dado** um pedido com `Range` que é malformado, que tem mais de um intervalo, ou que usa outra unidade que não `bytes`,
- **Quando** o `serveStatic` processa o pedido,
- **Então** a resposta é 200 com o arquivo completo, como hoje.

### RF-06 — `HEAD` com intervalo

- **Dado** um `HEAD` com `Range` satisfazível,
- **Quando** a resposta é montada,
- **Então** ela tem status 206 e os mesmos cabeçalhos de `Content-Range` e `Content-Length` do `GET` equivalente, sem corpo.

### RF-07 — Validar `If-Range`

- **Dado** um pedido com `Range` e `If-Range`,
- **Quando** o validador de `If-Range` bate com o asset atual,
- **Então** o `Range` é atendido (RF-02 a RF-04 se aplicam).

- **Dado** um pedido com `Range` e `If-Range` cujo validador não bate,
- **Quando** o `serveStatic` processa o pedido,
- **Então** a resposta é 200 com o arquivo completo.

Regras de comparação: `If-Range` com ETag só bate com ETag forte (sem `W/`). `If-Range` com data só bate se for exatamente igual ao `Last-Modified` do asset.

### RF-08 — Manter a precedência de condicionais

- **Dado** um pedido com `Range` e uma condição de cache que dá match (`If-None-Match` ou `If-Modified-Since`),
- **Quando** o `serveStatic` processa o pedido,
- **Então** a resposta é 304, como hoje. A avaliação de `Range` não acontece antes.

### RF-09 — Não aplicar intervalo a representação codificada

- **Dado** um asset servido com `content-encoding` (variante pré-comprimida ou `meta.encoding`),
- **Quando** o pedido traz `Range`,
- **Então** a resposta é 200 com a representação completa, sem `Content-Range`.

### RF-10 — Preservar o comportamento atual

- **Dado** os casos de cache, seleção de encoding, `fallthrough`, asset inexistente (404) e método não permitido (405),
- **Quando** o pedido não envolve `Range`, ou o `Range` é ignorado pela regra do RF-05 ou do RF-09,
- **Então** a resposta é idêntica à atual.

### RF-11 — Nenhuma API pública nova

- **Dado** a mudança concluída,
- **Quando** se compara `src/index.ts` e as opções de `ServeStaticOptions` com a versão anterior,
- **Então** não há nomes novos exportados (valores ou tipos) e as funções auxiliares ficam privadas no módulo.

## Fora de escopo

- Respostas `multipart/byteranges` (mais de um intervalo por pedido).
- Range sobre representações codificadas (gzip, br etc.). O RF-09 apenas ignora o `Range` nesses casos.
- Novas opções em `ServeStaticOptions` ou novo parâmetro em `getMeta`/`getContents`.
- Range em outros handlers (`proxy`, `h3/rules/cache`, respostas geradas em memória).
- Cache de trechos ou alteração na lógica de `ocache`.
- Documentação de usuário além do comentário JSDoc já existente, se necessária.

## Premissas e riscos

**Premissas**

- A RFC 9110 vale sobre a RFC 7233 citada na issue, como o contrato do projeto pede.
- `Accept-Ranges` é anunciado só quando `size` é conhecido. A issue pede anunciar "sempre", mas sem tamanho o servidor não atende intervalos. Isso é uma decisão de implementação que diverge da issue e precisa de confirmação.
- Multi-range é ignorado (RF-05), como a issue pede. A RFC permite essa escolha.
- `getMeta.size` é o tamanho real do conteúdo que `getContents` devolve.

**Riscos**

- **Desempenho:** `getContents(id)` não recebe o intervalo. Para `Blob` ou `ArrayBuffer`, o recorte com `slice` é barato. Para `ReadableStream`, pode ser preciso ler e descartar bytes até o início do intervalo, o que é lento para vídeo grande. Medir antes de fechar.
- **Tamanho divergente:** se `size` não bater com o conteúdo, `Content-Length` e `Content-Range` ficam errados. Não há como detectar isso sem ler o arquivo.
- **Cabeçalhos já definidos:** o código atual define `content-length` com `size` apenas se ainda não existir. Em 206 e 416 o valor precisa ser sobrescrito. Um `headers` configurado pelo usuário com `content-length` pode conflitar.
- **Validador fraco em `If-Range`:** tratar `W/` como forte causaria respostas 206 para versões diferentes do arquivo. Por isso a regra do RF-07 é explícita.
- **Testes existentes:** testes de `HEAD` ou de `content-length` podem mudar de comportamento. Ajustar só o que depende da mudança, sem perder o que eles verificam.
- **Critérios de qualidade:** `pnpm lint` e `pnpm typecheck` precisam passar. Os testes devem rodar nos modos `web` e `node` (`describeMatrix`).
