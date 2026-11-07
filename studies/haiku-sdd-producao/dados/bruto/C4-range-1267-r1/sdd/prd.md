# PRD: suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato em `sdd/pedido.md`.

## Problema e objetivo

Hoje o utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor devolve o arquivo inteiro com `200 OK` e não envia nenhum cabeçalho de conteúdo parcial. Isso causa três problemas:

- **Retomada de downloads** não funciona: um cliente que caiu no meio não consegue continuar de onde parou.
- **Vídeo e áudio** não conseguem avançar (seek) no navegador, porque os players dependem de respostas `206 Partial Content`.
- **CDNs e proxies** não conseguem armazenar e servir trechos de forma correta.

**Objetivo:** fazer `serveStatic` responder a pedidos de intervalo de bytes (RFC 9110, seções 13.1.5 e 14) para GET e HEAD, sem alterar a API pública, o comportamento de cache, a seleção de encoding, o `fallthrough` e as respostas de asset inexistente (404) e método não permitido (405).

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve enviar `Accept-Ranges: bytes` nas respostas de GET e HEAD para assets encontrados, independentemente de o pedido conter `Range`.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta tem status `200` e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder a um intervalo válido com 206

Quando o pedido contém um único intervalo válido, dentro do tamanho do asset, o `serveStatic` deve responder `206 Partial Content` com o trecho pedido.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes de 0 a 99.

### RF-03 — Suportar intervalos abertos e sufixos

Um único intervalo nas formas `bytes=N-` (do byte N até o fim) e `bytes=-N` (os últimos N bytes) deve ser tratado como intervalo válido, conforme a RFC 9110.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=900-`
- **Então** a resposta tem status `206`, `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.
- **E** **quando** o cliente faz `GET` com `Range: bytes=-50`
- **Então** a resposta tem status `206`, `Content-Range: bytes 950-999/1000` e `Content-Length: 50`.

### RF-04 — HEAD com intervalo válido

Para HEAD, o `serveStatic` deve responder com os mesmos cabeçalhos de um GET com intervalo válido, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-05 — Ignorar cabeçalho Range malformado ou com múltiplos intervalos

Se o `Range` for malformado, usar unidade diferente de `bytes` ou contiver mais de um intervalo, o `serveStatic` deve ignorá-lo e responder `200` com o arquivo completo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=abc` ou `Range: bytes=0-9,20-29`
- **Então** a resposta tem status `200`, o corpo completo, `Content-Length: 1000` e não tem `Content-Range`.

### RF-06 — Intervalo não satisfazível retorna 416

Se o intervalo começar depois do fim do asset, ou se for um sufixo de tamanho zero, a resposta deve ser `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=1000-1100`
- **Então** a resposta tem status `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-07 — Validação de If-Range

Quando o pedido contém `If-Range`, o intervalo só deve ser aplicado se o validador enviado (ETag forte ou data de `Last-Modified`) coincidir com o estado atual do asset. Caso contrário, o `Range` deve ser ignorado e a resposta deve ser `200` com o arquivo completo.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente faz `GET` com `Range: bytes=0-99` e `If-Range: "xyz"`
- **Então** a resposta tem status `200` com o corpo completo.
- **E** **quando** o cliente envia `If-Range: "abc"`
- **Então** a resposta tem status `206` com os bytes de 0 a 99.

### RF-08 — Ordem das pré-condições preservada

As pré-condições de cache (`If-None-Match`, `If-Modified-Since`) devem continuar sendo avaliadas antes do `Range`. Um pedido que resultaria em `304` deve continuar retornando `304`, mesmo com `Range`.

**Critério de aceite**

- **Dado** um asset cujo ETag atual é `"abc"`
- **Quando** o cliente faz `GET` com `If-None-Match: "abc"` e `Range: bytes=0-99`
- **Então** a resposta tem status `304`, sem corpo.

### RF-09 — Comportamento existente preservado

Cache, seleção de variante por `accept-encoding`, `fallthrough`, resposta 404 para asset inexistente e resposta 405 para método não permitido devem continuar iguais quando não há `Range`. Com `Range`, o comportamento de 404 e 405 também não muda.

**Critério de aceite**

- **Dado** um pedido `POST` para um asset existente
- **Quando** o pedido também contém `Range: bytes=0-9`
- **Então** a resposta continua sendo o 405 atual, com `allow: GET, HEAD`.
- **E** **dado** um asset inexistente, **quando** o cliente pede com `Range: bytes=0-9`, **então** a resposta continua sendo a mesma de hoje (404 ou passagem ao próximo handler, conforme `fallthrough`).

### RF-10 — Sem novas exportações públicas

A implementação deve ficar restrita a `src/utils/static.ts` e a funções auxiliares privadas do módulo. `src/index.ts` não pode ganhar nomes, nem valores nem tipos.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** se compara a lista de exportações de `h3` antes e depois
- **Então** a lista é idêntica.

### RF-11 — Cobertura em todos os runtimes

Os testes novos devem usar `describeMatrix`, rodando nos modos `web` e `node`, e cobrir RF-01 a RF-09.

**Critério de aceite**

- **Dado** a suíte de testes de `serveStatic`
- **Quando** `pnpm vitest run` é executado sobre o arquivo de testes de static
- **Então** todos os casos novos passam nos dois modos.

## Fora de escopo

- **Múltiplos intervalos** (`multipart/byteranges`): pedidos com mais de um intervalo são ignorados (RF-05), não atendidos em partes.
- **Alterar a interface de `getContents`** para receber o intervalo. Não se criam novas opções públicas em `ServeStaticOptions`.
- **Leitura parcial de arquivos em disco ou streaming otimizado**: o trecho pode ser fatiado depois que o conteúdo é obtido.
- **Ranges para ativos sem `size` conhecido**: sem tamanho não há `Content-Range` confiável; o pedido é atendido com `200`.
- **Ranges em outros métodos** além de GET e HEAD.
- **Mudanças em `h3/rules/cache`, `proxy` ou em outros utilitários** (`proxyRequest`, `fetchWithEvent`).
- **Otimização de desempenho** além de não piorar o caminho sem `Range`.

## Premissas

- **P1.** A issue diz "Always advertise `Accept-Ranges: bytes`". Assume-se que o cabeçalho é enviado sempre que o asset é servido, inclusive quando `size` não é conhecido. Se preferir anunciar só com tamanho conhecido, RF-01 muda.
- **P2.** O `size` vem de `getMeta`. Quando é `undefined` ou `0`, o `Range` é ignorado (RF-05 se aplica por consequência).
- **P3.** Quando há `content-encoding` (variante pré-comprimida), `Range` e `Content-Range` referem-se aos bytes da representação codificada, que é o que o servidor envia. O `size` usado deve ser o da variante servida.
- **P4.** A ordem de avaliação segue a RFC 9110 §13.2.2: pré-condições de cache antes de `If-Range` e depois `Range`.
- **P5.** Os testes existentes que verificam a ausência de cabeçalhos ou o corpo completo com `Range` podem precisar de ajuste. Qualquer ajuste deve manter o que o teste verifica.

## Riscos

- **R1 — Memória.** Como `getContents(id)` devolve o arquivo inteiro, cada pedido com `Range` ainda carrega o arquivo na memória. Para vídeos grandes isso pode ser caro. Mitigação: documentar; a evolução para leitura parcial fica fora de escopo.
- **R2 — Regressão em cache e encoding.** A mudança fica no mesmo caminho de `isCacheMatch`, `content-encoding` e `vary`. Testes de regressão devem cobrir essas combinações.
- **R3 — Interpretação de RFC.** Casos de borda (como `bytes=-0`, espaços em torno de `-`, valores muito grandes) podem ser lidos de formas diferentes. Os testes devem fixar o comportamento escolhido.
- **R4 — Cache intermediário.** Com `Accept-Ranges` sempre presente (P1), clientes podem enviar `Range` para assets que não o suportam de fato, sem tamanho. Isso gera 200 completo, o que é aceitável pela RFC, mas pode confundir quem espera 206.
- **R5 — Testes existentes.** Ajustes em testes antigos podem esconder regressões se forem feitos sem cuidado. Cada ajuste deve ser justificado no PR.
- **R6 — Restrição de lint e tipos.** `pnpm lint` e `pnpm typecheck` devem passar sem novas exportações, o que limita o uso de tipos novos fora do módulo.
