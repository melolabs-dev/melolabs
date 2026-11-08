# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o header `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o corpo completo, sem `206 Partial Content` nem `Content-Range`. Na prática:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) em arquivos servidos pelo h3;
- proxies e CDNs não recebem o comportamento de intervalo que esperam de uma origem estática.

**Objetivo:** fazer `serveStatic` atender requisições `Range` de `GET` e `HEAD` conforme a RFC 9110 (seções 13.1.5 e 14), sem mudar a API pública, sem novas opções e sem alterar o comportamento já existente de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range em respostas de asset

Todo asset encontrado pelo `serveStatic` deve anunciar `Accept-Ranges: bytes`, em GET e HEAD, independentemente de a requisição trazer `Range`.

**Critério de aceite**

- **Dado** um asset existente com `getMeta` retornando metadados válidos
- **Quando** o cliente faz `GET` ou `HEAD` sem header `Range`
- **Então** a resposta tem status 200 e o header `Accept-Ranges: bytes`

### RF-02 — Responder a um intervalo válido com 206

Um `Range` com um único intervalo válido, sobre um asset de tamanho conhecido, deve receber `206 Partial Content` com o trecho correspondente, `Content-Range` e `Content-Length` corretos. Os três formatos da RFC são aceitos: `bytes=N-M`, `bytes=N-` (até o fim) e `bytes=-N` (últimos N bytes, com N maior que zero e limitado ao tamanho do asset).

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo com exatamente os bytes 0 a 99

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=-200`
- **Então** a resposta tem status 206, `Content-Range: bytes 800-999/1000` e `Content-Length: 200`

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=900-5000`
- **Então** a resposta tem status 206, `Content-Range: bytes 900-999/1000` e `Content-Length: 100`

### RF-03 — HEAD com Range válido retorna só cabeçalhos

Para `HEAD`, um `Range` válido deve gerar a mesma resposta 206 do RF-02, com cabeçalhos corretos e corpo vazio.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio

### RF-04 — Intervalo não satisfatível retorna 416

Quando o primeiro byte pedido está além do fim do asset (por exemplo, `bytes=1000-` em um asset de 1000 bytes), a resposta deve ser `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100` (em GET ou HEAD)
- **Então** a resposta tem status 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-05 — Range malformado ou com múltiplos intervalos é ignorado

Se o header `Range` for sintaticamente inválido, usar outra unidade que não `bytes`, ou trazer mais de um intervalo, o `serveStatic` deve ignorá-lo e responder 200 com o asset completo. Não há resposta de erro nesses casos.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-10,20-30`, ou `Range: items=0-10`, ou `Range: bytes=abc`
- **Então** a resposta tem status 200, sem `Content-Range`, e corpo com os 1000 bytes completos

### RF-06 — If-Range decide se o Range é honrado

Quando a requisição traz `If-Range`, o `Range` só é honrado se o validador enviado coincidir com o do asset, usando comparação forte (RFC 9110, seção 13.1.5). Caso contrário, o `Range` é ignorado e a resposta é 200 completa.

- Um ETag forte igual ao do asset honra o `Range`.
- Uma data igual ao `Last-Modified` do asset honra o `Range`.
- ETag fraco (`W/...`), ETag diferente ou data diferente fazem o `Range` ser ignorado.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"` e tamanho de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "abc"`
- **Então** a resposta tem status 206 com os bytes 0 a 99

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "xyz"`
- **Então** a resposta tem status 200 com os 1000 bytes completos

### RF-07 — Range só se aplica quando o tamanho é conhecido e o corpo não tem content-encoding

O `Range` só é honrado quando `meta.size` é um número maior que zero e o asset não é servido com `content-encoding` (variante pré-comprimida). Nos demais casos, o `Range` é ignorado e a resposta é 200 completa, com `Accept-Ranges: bytes` mantido.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta tem status 200 com o corpo completo e sem `Content-Range`

- **Dado** um asset servido com `meta.encoding = "gzip"`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta tem status 200 com o corpo completo da variante codificada

### RF-08 — Ordem de avaliação preserva 304 e os demais fluxos

A avaliação de `Range` acontece depois da validação condicional. Assim, um `If-None-Match` ou `If-Modified-Since` que casa continua gerando 304, e o cache, a seleção de encoding, o `fallthrough`, o 404 para asset inexistente e o 405 para método não permitido continuam iguais aos de hoje.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente envia `If-None-Match: "abc"` junto com `Range: bytes=0-99`
- **Então** a resposta tem status 304, sem corpo

- **Dado** um asset inexistente e a opção `fallthrough: false`
- **Quando** o cliente envia `GET` com um `Range` válido
- **Então** a resposta continua sendo 404

- **Dado** uma requisição `POST` para um asset com `Range`
- **Quando** `serveStatic` é chamado com `fallthrough` desligado
- **Então** a resposta continua sendo 405 com `Allow: GET, HEAD`

### RF-09 — Nenhuma API pública nova

A mudança fica restrita a `src/utils/static.ts` e aos testes. `src/index.ts` não ganha nomes (valores ou tipos), `ServeStaticOptions` não ganha opções, e os helpers de parsing de `Range` e de `If-Range` ficam privados ao módulo.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** o conjunto de exportações de `src/index.ts` é comparado com o de antes
- **Então** os dois conjuntos são idênticos

### RF-10 — Cobertura de testes nos dois modos

Os novos comportamentos devem ser cobertos em `test/static.test.ts` usando `describeMatrix`, para rodar nos modos `web` e `node`. Os testes existentes continuam passando; só os que dependem do que a mudança altera podem ser ajustados, sem perder o que verificam.

**Critério de aceite**

- **Dado** a suíte após a mudança
- **Quando** `pnpm vitest run test/static.test.ts` é executado
- **Então** todos os casos passam nos modos `web` e `node`, incluindo os casos novos de RF-01 a RF-08

## Fora de escopo

- **Múltiplos intervalos** (`multipart/byteranges`): pedidos com mais de um intervalo são ignorados (RF-05), não respondidos com multipart.
- **Range sobre variantes pré-comprimidas**: quando há `content-encoding`, o `Range` é ignorado (RF-07). Pedir partes de um corpo gzip não é útil ao cliente.
- **Opção para desligar ou configurar Range**: o suporte fica sempre ativo, sem nova opção em `ServeStaticOptions`.
- **Mudança nas assinaturas de `getMeta` e `getContents`**: os backends continuam retornando o corpo inteiro. O recorte do trecho é feito dentro de `serveStatic`.
- **Range em outros handlers** (`proxy`, `h3/rules/cache`, respostas de `toResponse`).
- **Otimização de leitura parcial no backend**: a leitura eficiente de trechos de arquivo em disco fica para o backend, fora deste PRD.
- **Retomada de upload** e qualquer outro uso de `Content-Range` em requisições.

## Premissas e riscos

### Premissas

- **Norma:** o comportamento segue a RFC 9110 (seções 13.1.5 e 14), que substitui a RFC 7233 citada na issue, conforme `sdd/pedido.md`.
- **Tamanho conhecido:** o `size` vindo de `getMeta` é o tamanho real do corpo que `getContents` devolve, em bytes.
- **Tamanho zero:** um asset com `size` igual a 0 não recebe `Range` (RF-07), porque a RFC é ambígua para representações vazias. Este é um ponto a confirmar.
- **Validadores:** `meta.etag` e `meta.mtime` são os validadores usados em `If-Range`. O ETag é tratado como forte, a não ser que comece com `W/`.
- **Ignorar `Range` é permitido:** a RFC permite que o servidor ignore `Range` e responda 200. Por isso, os casos não suportados (multi-range, sintaxe inválida, `If-Range` não casado) caem em 200 sem violar a norma.

### Riscos

- **Fatiar `getContents` (principal):** `getContents` pode retornar qualquer `BodyInit` (string, `Blob`, `ArrayBuffer`, `ReadableStream`). Para 206 é preciso fatiar o corpo. `Blob` tem `slice`, mas streams não. Uma solução simples que lê tudo em memória pode ser cara para arquivos grandes em vídeo. A forma de fatiar cada tipo precisa ser decidida na implementação, e isso pode ser um desvio do escopo de "só `serveStatic`".
- **Asset com `getContents` vazio:** se `getMeta` achar o asset mas `getContents` devolver `null`, um 206 com corpo vazio estaria errado. Esse caso precisa de tratamento explícito.
- **`If-Range` com data:** a comparação de datas exige cuidado com a precisão de um segundo, porque `Last-Modified` só tem essa precisão. Um erro aqui pode devolver conteúdo misturado a um cliente que está retomando um download.
- **Regressão em testes existentes:** requisições com `Range` já existentes nos testes podem passar a receber 206 ou 416. Esses testes precisam ser revistos com cuidado, sem perder o que verificam.
- **Clientes que dependem do 200:** alguns clientes podem depender de a resposta sempre ser 200. Como o suporte a Range fica sempre ativo (sem opção de desligar), essa mudança afeta todos os usuários de `serveStatic` ao mesmo tempo.
- **Interação com `headers`:** cabeçalhos definidos pelo usuário em `options.headers` são aplicados antes da lógica nova. Se o usuário definir `content-length` ou `content-range` ali, o comportamento precisa ficar definido.
- **Validação do ambiente:** `pnpm lint` e `pnpm typecheck` precisam passar. Não há como garantir isso sem rodar o projeto, o que depende do ambiente da implementação.
