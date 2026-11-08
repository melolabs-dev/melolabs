# PRD — HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD para um asset encontrado recebe `200` com o corpo completo, sem `Accept-Ranges` e sem `Content-Range`. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio nos navegadores e players, que enviam `Range` por padrão;
- comportamento correto de CDNs e proxies que dependem de respostas parciais.

**Objetivo:** fazer o `serveStatic` atender pedidos de intervalo de bytes conforme a RFC 9110 (seções 13.1.5 e 14), mantendo a API pública e todo o comportamento atual que não envolve `Range`. A RFC 7233 citada na issue foi substituída pela RFC 9110.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos de bytes

O `serveStatic` passa a enviar `Accept-Ranges: bytes` em toda resposta de asset encontrado para GET e HEAD (200, 206 e 416).

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz GET ou HEAD sem cabeçalho `Range`
- **Então** a resposta contém `Accept-Ranges: bytes` e status 200

### RF-02 — Ignorar Range que não pode ser atendido como intervalo simples

O `serveStatic` ignora o cabeçalho `Range` e responde com 200 e o corpo completo quando ele for malformado, tiver mais de um intervalo, usar unidade diferente de `bytes`, ou quando o tamanho do asset (`size` de `getMeta`) não for conhecido.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-1,5-9` (multi-range), `Range: items=0-9`, ou `Range: bytes=abc`
- **Então** a resposta é 200 com o corpo completo e sem `Content-Range`

### RF-03 — Responder 206 para intervalo válido

Para um único intervalo satisfazível, o `serveStatic` responde 206 Partial Content com o trecho pedido, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho. Intervalos abertos (`bytes=500-`) e sufixos (`bytes=-500`) são aceitos; um `fim` maior que o tamanho do asset é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-499`
- **Então** a resposta é 206, `Content-Range: bytes 0-499/1000`, `Content-Length: 500` e o corpo contém exatamente os bytes 0 a 499

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=-200`
- **Então** a resposta é 206 com `Content-Range: bytes 800-999/1000` e `Content-Length: 200`

### RF-04 — Responder 416 para intervalo não satisfazível

Quando o intervalo único está bem formado mas não há nenhum byte para atender (início além do fim do asset, ou sufixo de tamanho zero), o `serveStatic` responde 416 Range Not Satisfiable com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1500`
- **Então** a resposta é 416, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-05 — HEAD com Range devolve somente cabeçalhos

Em HEAD, o `serveStatic` aplica a mesma decisão de RF-02, RF-03 e RF-04 (200, 206 ou 416), com os mesmos cabeçalhos, mas sem corpo. Não chama `getContents`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz HEAD com `Range: bytes=0-99`
- **Então** a resposta é 206 com `Content-Range: bytes 0-99/1000`, `Content-Length: 100`, sem corpo, e `getContents` não é chamado

### RF-06 — Respeitar If-Range

Quando a requisição traz `If-Range`, o `Range` só é atendido se o validador combinar com o estado atual do asset (RFC 9110 seção 13.1.5): ETag forte igual ao `etag` do asset, ou data igual ao `last-modified`. Caso contrário, o `Range` é ignorado e a resposta é 200 completa.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"`
- **Quando** o cliente envia `Range: bytes=0-99` e `If-Range: "abc"`
- **Então** a resposta é 206 com o trecho pedido

- **Dado** o mesmo asset
- **Quando** o cliente envia `Range: bytes=0-99` e `If-Range: "outro"`
- **Então** a resposta é 200 com o corpo completo

### RF-07 — Preservar cache, encoding, fallthrough e erros existentes

A avaliação condicional acontece antes do `Range`: se `If-None-Match` ou `If-Modified-Since` resultarem em 304, a resposta é 304 mesmo com `Range`. A seleção de variante comprimida continua igual, e o `Range` se aplica à variante escolhida (bytes codificados). Asset inexistente continua gerando 404 (ou `fallthrough`), e método diferente de GET/HEAD continua gerando 405 com `Allow: GET, HEAD`.

**Critério de aceite**

- **Dado** um asset com `etag: "abc"`
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-99`
- **Então** a resposta é 304 sem corpo

- **Dado** um asset `app.js` com variante `app.js.gz` disponível e `accept-encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta é 206 com `Content-Encoding: gzip` e `Content-Range` referente ao tamanho de `app.js.gz`

- **Dado** um asset inexistente, com `fallthrough` ativo
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** `serveStatic` retorna `undefined` como hoje

### RF-08 — Manter a API pública inalterada

Nenhuma exportação nova em `src/index.ts`, nenhum novo campo em `ServeStaticOptions` e nenhuma mudança em `getMeta` ou `getContents`. Funções auxiliares ficam privadas em `src/utils/static.ts`.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** comparo as exportações de `src/index.ts` e a interface `ServeStaticOptions` com a versão atual
- **Então** não há diferença de nomes, tipos ou assinaturas

### RF-09 — Cobrir o comportamento nos testes e manter a qualidade

Os novos cenários de Range são testados com `describeMatrix` (modos `web` e `node`). Testes existentes só são ajustados quando dependem de a resposta ser sempre 200 para `Range`, sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada
- **Quando** executo `pnpm vitest run test/static.test.ts` (ou o arquivo de testes de static correspondente), `pnpm lint` e `pnpm typecheck`
- **Então** todos passam nos dois modos de execução, e cada cenário das RFs 01 a 07 tem ao menos um teste

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`): a issue pede que sejam ignorados com resposta completa.
- Unidades de Range diferentes de `bytes`.
- Range em respostas geradas por `getContents` que não sejam recortáveis (ver riscos).
- Compressão sob demanda de respostas parciais.
- Novas opções em `ServeStaticOptions` ou mudanças em `getMeta` / `getContents`.
- Mudanças em `proxyRequest`, `h3/rules/cache` ou em outros utilitários de resposta.
- Alterações na normalização de caminhos e nas regras de segurança já documentadas em `serveStatic`.

## Premissas e riscos

**Premissas**

- `getMeta` devolve `size` para os assets que devem suportar Range. Sem `size`, o Range é ignorado (RF-02).
- O tamanho usado para `Content-Range` é o da variante escolhida (`app.js.gz`, por exemplo), não o do arquivo original.
- Asset de tamanho zero: qualquer intervalo é não satisfazível e resulta em 416 (RFC 9110 seção 14.1.1). Essa é a regra adotada, mas precisa ser confirmada na implementação.
- `getContents` devolve o corpo completo, e o recorte é feito pelo `serveStatic` sobre o `BodyInit` devolvido (`string`, `Blob`, `ArrayBuffer`, `Uint8Array`).

**Riscos**

- **Corpo em stream (`ReadableStream`):** não há recorte simples de bytes. Recomendação: nesse caso ignorar o Range e responder 200 completo, para não quebrar o contrato. Decisão a confirmar antes da implementação.
- **Desempenho:** recortar um `Blob` ou `ArrayBuffer` grande é barato, mas garantir que apenas o trecho seja lido (sem carregar tudo em memória) pode exigir mais trabalho para arquivos grandes. A otimização real fica fora do escopo deste PRD, mas a implementação não deve piorar o caso atual.
- **Regressão em testes existentes:** testes que esperam 200 para qualquer requisição com `Range` vão falhar. Isso é esperado, e a mudança deve ser mínima nesses testes.
- **Divergência de RFC:** a issue cita RFC 7233; o PRD segue a RFC 9110, como definido no contrato. Pequenas diferenças de redação não devem mudar o comportamento descrito.
