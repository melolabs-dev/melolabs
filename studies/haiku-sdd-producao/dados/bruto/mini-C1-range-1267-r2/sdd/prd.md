# PRD: Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo de bytes, a resposta traz o arquivo inteiro com status 200 e sem `Accept-Ranges`. Na prática:

- downloads não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) em arquivos servidos pelo h3;
- proxies e CDNs não recebem os sinais HTTP de que precisam para tratar partes do arquivo.

**Objetivo:** fazer o `serveStatic` atender requisições de intervalo de um único trecho de bytes, em `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem alterar a API pública, o cache, a seleção de encoding, o `fallthrough` nem as respostas 404 e 405.

## Estado atual (referência)

- Nenhum tratamento de `Range`; `Accept-Ranges` nunca é enviado.
- `Content-Length` vem de `meta.size`, quando maior que zero e ainda não definido.
- A resposta é sempre `200` com o conteúdo completo obtido por `getContents(id)`.
- A ordem atual é: cabeçalhos, método, caminho canônico, encoding, `getMeta`, `Vary`, `Last-Modified`, `ETag`, validação condicional (304), `Content-Type`, `Content-Encoding`, `Content-Length`, HEAD, `getContents`.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

O `serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de sucesso (200, 206 e HEAD) de um asset encontrado, e também na resposta 416.

**Critério de aceite**

- **Dado** um asset existente com `size` conhecido,
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`,
- **Então** a resposta tem status 200 e o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Responder a um intervalo válido com 206

Quando o `Range` é um único intervalo `bytes=inicio-fim` válido, o `serveStatic` deve responder 206 com `Content-Range: bytes inicio-fim/tamanho`, `Content-Length` igual ao tamanho do trecho e apenas os bytes pedidos no corpo. Se `fim` ultrapassar o último byte, ele é limitado a `tamanho - 1`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-99`,
- **Então** a resposta tem status 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 0 a 99.

### RF-03 — Intervalos abertos e sufixos

O `serveStatic` deve aceitar `bytes=inicio-` (do início até o fim do arquivo) e `bytes=-n` (os últimos `n` bytes), que são formas de um único intervalo previstas pela RFC 9110.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=900-`, depois `Range: bytes=-100`,
- **Então** ambas as respostas têm status 206; a primeira tem `Content-Range: bytes 900-999/1000` e a segunda tem `Content-Range: bytes 900-999/1000`, com 100 bytes no corpo cada uma.

### RF-04 — HEAD com Range

Para `HEAD`, um `Range` válido deve gerar apenas os cabeçalhos da resposta 206 (`Content-Range`, `Content-Length` do trecho, `Accept-Ranges`), sem corpo e sem chamar `getContents`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-9`,
- **Então** a resposta tem status 206, `Content-Range: bytes 0-9/1000`, `Content-Length: 10`, corpo vazio, e `getContents` não é chamado.

### RF-05 — Ignorar Range inválido, múltiplo ou de outra unidade

Quando o `Range` estiver malformado, tiver mais de um intervalo, usar outra unidade que não `bytes` ou tiver `fim` menor que `inicio`, o `serveStatic` deve ignorar o cabeçalho e responder 200 com o arquivo completo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=0-9,20-29`, depois `Range: items=0-9`, depois `Range: bytes=abc`, depois `Range: bytes=9-0`,
- **Então** cada resposta tem status 200, sem `Content-Range`, com o conteúdo completo.

### RF-06 — Intervalo não satisfazível com 416

Quando o intervalo começa em um byte igual ou maior que o tamanho do asset, o `serveStatic` deve responder 416 com `Content-Range: bytes */tamanho` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes,
- **Quando** o cliente envia `Range: bytes=1000-1100`,
- **Então** a resposta tem status 416, `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-07 — Validação com If-Range

Quando a requisição traz `If-Range`, o `Range` só é atendido se a condição bater com o asset atual: um `ETag` forte igual ao do asset, ou uma data igual ao `Last-Modified`. Se não bater, o `Range` é ignorado e a resposta é 200 completa. Um `ETag` fraco nunca satisfaz `If-Range`.

**Critério de aceite**

- **Dado** um asset com `ETag: "abc"` e `Last-Modified` conhecido,
- **Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "abc"`, e depois com `If-Range: "outro"`,
- **Então** a primeira resposta é 206 e a segunda é 200 completa.

### RF-08 — Ordem e precedência com as respostas existentes

O `Range` só é avaliado depois das checagens condicionais que já existem. Assim, se `If-None-Match` ou `If-Modified-Since` resultarem em 304, a resposta continua sendo 304. Os caminhos de 404 (asset inexistente), 405 (método não permitido) e `fallthrough` não mudam. Para assets com encodings configurados, o `Range` se aplica à variante escolhida (por exemplo `.gz`), com `Content-Length` e `Content-Range` dessa variante, e `Content-Encoding` e `Vary` seguem como hoje.

**Critério de aceite**

- **Dado** um asset com `ETag: "abc"` e uma requisição com `If-None-Match: "abc"` e `Range: bytes=0-9`,
- **Quando** o servidor processa a requisição,
- **Então** a resposta é 304 sem corpo; e **dado** um asset inexistente com `Range` válido, **quando** a requisição é feita, **então** a resposta é o mesmo 404 de hoje (ou `undefined` com `fallthrough`).

### RF-09 — Métodos e API pública

O suporte a Range não altera métodos além de `GET` e `HEAD`, não adiciona exportações em `src/index.ts` (nem valores nem tipos) e mantém as funções auxiliares privadas no módulo. Nenhuma opção nova é adicionada a `ServeStaticOptions`.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se comparam as exportações de `src/index.ts` e as opções de `ServeStaticOptions` com a versão anterior,
- **Então** não há diferença; e **quando** o cliente envia `POST` com `Range`, **então** a resposta é 405 como hoje.

### RF-10 — Testes e qualidade

Os testes de Range devem rodar nos dois modos da matriz (`web` e `node`). Os testes existentes continuam passando, e só podem ser ajustados quando dependerem do comportamento alterado, sem perder o que verificam. `pnpm lint` e `pnpm typecheck` devem passar.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** se executam `pnpm vitest run test/static.test.ts` (ou o arquivo de testes de static existente) e `pnpm lint`,
- **Então** todos os testes e as checagens passam nos dois modos da matriz.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem 200 completo.
- Nova opção em `getMeta`/`getContents` para leitura parcial no backend. Isso exigiria mudar a interface pública, o que a issue proíbe.
- Otimização de streaming para arquivos grandes (leitura parcial real do disco). Nesta entrega o trecho é extraído do corpo já obtido.
- Suporte a Range em handlers que não sejam `serveStatic` (`proxy`, `h3/rules/cache`, etc.).
- Range em respostas de `fallthrough` para outros handlers.
- Alterações em `ocache` ou em regras de cache além do que já existe.
- Documentação extensa em `docs/`; apenas JSDoc mínimo, se necessário.

## Premissas

- O `size` retornado por `getMeta` é o tamanho real do arquivo que `getContents` entrega, e é usado como base para `Content-Range`. Se `size` não for informado, o `Range` é ignorado e a resposta segue como hoje.
- O `Range` se aplica à variante de encoding escolhida, porque é ela que tem o `size` e o corpo entregues ao cliente.
- A extração do trecho acontece no `serveStatic`, com o corpo obtido de `getContents`. Como a interface não muda, o backend continua entregando o arquivo inteiro.
- Os testes existentes em `test/` cobrem respostas 200, 304, 404 e 405 que devem permanecer iguais.

## Riscos

- **Desempenho e memória (alto):** sem leitura parcial no backend, extrair um trecho de um `ReadableStream` ou `Blob` grande pode exigir ler o arquivo inteiro. Para vídeo grande, isso anula o ganho do seek. Mitigação possível em uma etapa futura, fora desta entrega.
- **Tamanho zero (médio):** pela RFC 9110, `Range` sobre um corpo vazio é não satisfazível (416). A issue não cobre o caso. Decisão proposta: tratar `size` 0 como ausente e ignorar o `Range` (200), para não mudar o comportamento atual de arquivos vazios. Precisa de confirmação.
- **Divergência entre `size` e o corpo real (médio):** se `getMeta` informar um tamanho diferente do conteúdo entregue, o `Content-Range` ficará errado. Não há como verificar isso no `serveStatic`.
- **`If-Range` com data (baixo):** a comparação com `Last-Modified` precisa usar a mesma precisão de segundos já aplicada ao `mtime`.
- **Compatibilidade de clientes (baixo):** alguns clientes podem depender de receber 200 em todo caso. Isso é improvável, porque a RFC permite ao servidor ignorar `Range`, e a issue pede o comportamento de 206.
- **Testes existentes (baixo):** se algum teste verificar a ausência de `Accept-Ranges` ou o `Content-Length` exato de um 200, ele deve ser ajustado com cuidado, sem perder a verificação original.
