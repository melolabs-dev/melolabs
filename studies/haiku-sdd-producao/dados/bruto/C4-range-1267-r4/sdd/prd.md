# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e contrato em `sdd/pedido.md`. Código afetado: `src/utils/static.ts`.

## Problema e objetivo

### Problema

O `serveStatic` ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, o servidor devolve o corpo inteiro com `200 OK`, sem `Accept-Ranges` e sem `Content-Range`. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em áudio e vídeo nos players do navegador, que enviam `Range` por padrão;
- comportamento correto de CDNs e proxies que dependem de respostas parciais.

### Objetivo

Fazer o `serveStatic` atender pedidos de intervalo de byte único para `GET` e `HEAD`, conforme RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, o comportamento de cache, a seleção de encoding, o `fallthrough` nem as respostas 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve incluir `Accept-Ranges: bytes` em toda resposta de asset encontrado para `GET` e `HEAD`.

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta é `200` com o cabeçalho `Accept-Ranges: bytes` e o corpo completo, como hoje

### RF-02 — Responder intervalo válido com 206

Para um cabeçalho `Range: bytes=<intervalo>` com um único intervalo válido sobre um asset de tamanho conhecido, o servidor deve responder `206 Partial Content` com o trecho pedido. Formas aceitas: `bytes=a-b`, `bytes=a-` (do byte `a` até o fim) e `bytes=-n` (últimos `n` bytes). Se `b` ultrapassar o fim, o limite é ajustado ao último byte; se `n` for maior que o tamanho, o trecho é o arquivo inteiro.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta é `206`, `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 100 a 199

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=900-` ou `Range: bytes=900-5000`
- **Então** a resposta é `206` com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=-200`
- **Então** a resposta é `206` com `Content-Range: bytes 800-999/1000` e `Content-Length: 200`

### RF-03 — Ignorar Range malformado, de outra unidade ou com múltiplos intervalos

Quando o cabeçalho `Range` não for um intervalo único válido em `bytes`, o servidor deve ignorá-lo e responder com o asset inteiro (`200`), sem erro.

- **Dado** um asset existente
- **Quando** o cliente envia `Range: bytes=0-1,5-9`, `Range: items=0-1` ou `Range: bytes=abc`
- **Então** a resposta é `200` com o corpo completo e sem `Content-Range`

### RF-04 — Responder intervalo não satisfazível com 416

Quando o intervalo for sintaticamente válido, mas não puder ser atendido (início além do fim do arquivo, ou sufixo de zero bytes), a resposta deve ser `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta é `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-05 — HEAD com Range

Para `HEAD`, os cabeçalhos de `206` e `416` devem ser os mesmos de `GET`, mas sem corpo.

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=100-199`
- **Então** a resposta é `206` com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e sem corpo

### RF-06 — Validar If-Range

Quando o cabeçalho `If-Range` estiver presente, o `Range` só é atendido se o validador enviado corresponder ao estado atual do asset. Caso contrário, o `Range` é ignorado e a resposta é `200` com o corpo completo.

- **Dado** um asset com ETag forte `"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` e `If-Range: "abc"`
- **Então** a resposta é `206`

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=0-9` e `If-Range: "outro"`, ou `If-Range: W/"abc"` (ETag fraca)
- **Então** a resposta é `200` com o corpo completo

### RF-07 — Precedência de cache sobre Range

Respostas de cache (`304 Not Modified`) continuam tendo precedência sobre `Range`.

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente envia `Range: bytes=0-9` e `If-None-Match: "abc"`
- **Então** a resposta é `304` sem corpo, como hoje

### RF-08 — Preservar comportamentos existentes

Os seguintes comportamentos não podem mudar:

- seleção de variante pré-comprimida (`encodings`, `Content-Encoding`, `Vary: accept-encoding`);
- `fallthrough`, que continua retornando `undefined` quando o asset não é encontrado ou quando o método não é permitido;
- `404` para asset inexistente ou caminho não canônico;
- `405` com `Allow: GET, HEAD` para métodos diferentes de `GET` e `HEAD`, mesmo que haja `Range`;
- cabeçalhos `headers` definidos pelo usuário.

- **Dado** um asset `app.js` com variante `app.js.gz` e `encodings: { gzip: ".gz" }`
- **Quando** o cliente envia `Accept-Encoding: gzip`, `Range: bytes=0-9`
- **Então** a resposta usa a variante `.gz` (`Content-Encoding: gzip`) e o intervalo é aplicado aos bytes dessa variante

- **Dado** uma requisição `POST` com `Range`
- **Quando** o `serveStatic` é chamado
- **Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje

### RF-09 — Sem novas exportações públicas

Nenhuma função, tipo ou constante nova pode ser exportada por `src/index.ts` ou por qualquer outro ponto de entrada. Os helpers de parse e de fatiamento ficam privados em `src/utils/static.ts`.

- **Dado** a branch com a mudança aplicada
- **Quando** se compara a lista de exportações públicas com a da branch `master`
- **Então** não há diferença

### RF-10 — Cobertura de testes e verificações

Os testes novos devem usar `describeMatrix` (web e node) em `test/static.test.ts` ou em arquivo vizinho. Os testes existentes continuam passando sem ser enfraquecidos.

- **Dado** a suíte de testes com a mudança aplicada
- **Quando** se executa `pnpm vitest run test/static.test.ts` e depois `pnpm test`
- **Então** todos os casos de RF-01 a RF-08 passam nos dois modos, e `pnpm lint` e `pnpm typecheck` passam

## Fora de escopo

- Resposta `multipart/byteranges` para múltiplos intervalos. Esses pedidos são ignorados (RF-03).
- Alterar a assinatura de `getContents` ou de `getMeta` para receber o intervalo. Isso mudaria a API pública, e o pedido proíbe.
- Suporte a `If-Match` e `If-Unmodified-Since`.
- Range em respostas dinâmicas, que não passam por `serveStatic`.
- Compressão sob demanda de trechos.
- Ajustes em adaptadores de plataforma (`src/_entries/*`) ou no `h3/rules/cache`.
- Documentação extensa além de comentário JSDoc e de atualização de `AGENTS.md` se a convenção mudar.

## Premissas

- `getMeta` retorna `size` para os assets que devem suportar intervalo. Sem `size`, a implementação serve `200` completo, como hoje.
- `getContents` retorna o corpo completo do asset. Como a assinatura não recebe intervalo, o trecho é obtido fatiando o `BodyInit` devolvido.
- O `size` de `getMeta` corresponde ao tamanho do corpo que `getContents` devolve, incluindo variantes pré-comprimidas.
- Anunciar `Accept-Ranges: bytes` sempre, como pede a issue, é aceitável mesmo quando o `size` é desconhecido e o intervalo é ignorado. Essa é uma decisão a confirmar com os mantenedores.
- Os testes existentes que dependem de `200` com `Range` (se houver) podem ser ajustados, conforme o contrato em `sdd/pedido.md`.

## Riscos

- **Fatiamento de `BodyInit`.** Para `string`, `ArrayBuffer` e `Blob`, o fatiamento é barato. Para `ReadableStream`, pode exigir leitura integral em memória, o que é ruim para vídeos grandes. Mitigação: usar `Blob.slice` quando disponível e avaliar fatiamento por stream antes de fechar o escopo.
- **Consumo de memória e I/O.** Se `getContents` sempre lê o arquivo inteiro, cada requisição de trecho lê o arquivo todo. Isso não é resolvido sem mudar a API, o que está fora de escopo. Documentar a limitação.
- **Variantes pré-comprimidas.** Um intervalo sobre `app.js.gz` gera bytes que o cliente não consegue descomprimir sozinho. Para downloads retomados de arquivos comprimidos, o resultado pode ser inútil. Mitigação: documentar e, se necessário, não aplicar `Range` quando há `Content-Encoding`. Decisão a confirmar.
- **Validador de `If-Range` com data.** A comparação exata de data é frágil com a precisão de segundos de `last-modified`. Mitigação: comparar com o mesmo valor truncado já usado em `mtimeDate`.
- **Mudança de comportamento observável.** Clientes que hoje recebem `200` com `Range` passarão a receber `206`. É o comportamento desejado, mas pode afetar consumidores que dependiam do `200`. Citar no changelog.
- **Ordem das verificações.** `Range` precisa ser avaliado depois de `304` e antes do corpo. Inverter essa ordem quebra RF-07.
