# PRD: Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

## 1. Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range` das requisições. Mesmo quando o cliente pede um trecho, o servidor devolve o corpo inteiro com `200 OK` e sem cabeçalhos de conteúdo parcial. Com isso:

- não é possível retomar downloads interrompidos;
- players de áudio e vídeo não conseguem avançar (seek) de forma eficiente;
- CDNs e proxies não recebem o comportamento esperado para conteúdo parcial.

**Objetivo:** fazer o `serveStatic` atender pedidos de intervalo de bytes conforme a RFC 9110, seção 14 (antiga RFC 7233), para requisições `GET` e `HEAD`, sem alterar a API pública, a semântica de cache, a seleção de encoding nem o tratamento de 404/405/fallthrough já existentes.

## 2. Requisitos funcionais

### RF-01 — Anúncio de suporte a Range

O `serveStatic` deve incluir `Accept-Ranges: bytes` em toda resposta que serve um asset encontrado, com ou sem cabeçalho `Range` na requisição.

**Critério de aceite**

- **Dado** um asset existente servido pelo `serveStatic`
- **Quando** o cliente faz `GET` sem cabeçalho `Range`
- **Então** a resposta é `200` e contém `Accept-Ranges: bytes`.

### RF-02 — Intervalo único nas três formas da norma

O `serveStatic` deve aceitar um único intervalo nas formas `bytes=a-b` (início e fim), `bytes=a-` (do início até o fim do arquivo) e `bytes=-n` (os últimos `n` bytes). O tamanho do asset é o `size` informado por `getMeta`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`, depois `Range: bytes=900-` e depois `Range: bytes=-50`
- **Então** cada requisição recebe `206` com o trecho correspondente (bytes 100 a 199, 900 a 999 e 950 a 999, respectivamente).

### RF-03 — Resposta parcial 206

Para um intervalo válido e satisfazível, a resposta deve ser `206 Partial Content`, com corpo contendo apenas os bytes pedidos, `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao tamanho do trecho enviado. Um fim maior que o tamanho do asset deve ser limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=500-9999`
- **Então** a resposta é `206`, com `Content-Range: bytes 500-999/1000`, `Content-Length: 500` e corpo com os 500 últimos bytes do asset.

### RF-04 — Intervalo não satisfazível 416

Quando o início do intervalo está no tamanho do asset ou além dele, a resposta deve ser `416 Range Not Satisfiable`, sem corpo, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta é `416`, sem corpo, com `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-05 — Ignorar Range malformado ou multi-range

Pedidos com vários intervalos, ou com `Range` malformado (unidade diferente de `bytes`, sintaxe inválida ou início maior que o fim), não devem gerar erro. O `Range` é ignorado e a resposta é a normal: `200` com o corpo inteiro.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `Range: bytes=0-1,5-9`, ou `Range: items=0-5`, ou `Range: bytes=9-3`, ou `Range: bytes=abc`
- **Então** a resposta é `200` com o corpo inteiro e sem `Content-Range`.

### RF-06 — HEAD com Range

Uma requisição `HEAD` com `Range` deve devolver os mesmos status e cabeçalhos que o `GET` equivalente devolveria, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-99`
- **Então** a resposta é `206`, sem corpo, com `Content-Range: bytes 0-99/1000` e `Content-Length: 100`, igual ao `GET` com o mesmo `Range`.

### RF-07 — Range sobre representação pré-comprimida

Quando a seleção por `Accept-Encoding` escolhe uma variante pré-comprimida, o intervalo e o tamanho em `Content-Range` se referem a essa variante, que é a representação efetivamente enviada.

**Critério de aceite**

- **Dado** um asset de 1000 bytes com variante `.gz` de 300 bytes, e um cliente que envia `Accept-Encoding: gzip`
- **Quando** o cliente envia `Range: bytes=0-99`
- **Então** a resposta é `206`, com `Content-Range: bytes 0-99/300`, `Content-Length: 100` e `Content-Encoding: gzip`.

### RF-08 — If-Range

Se o pedido traz `If-Range` e o validador não corresponde ao asset atual, o `Range` é ignorado e a resposta é `200` com o corpo inteiro. Se corresponde, o `Range` é aplicado normalmente. A comparação de entity-tag segue a comparação forte da norma.

**Critério de aceite**

- **Dado** um asset com `ETag: "abc"`
- **Quando** o cliente envia `Range: bytes=0-99` com `If-Range: "xyz"`
- **Então** a resposta é `200` com o corpo inteiro.
- **E** **quando** o cliente envia o mesmo `Range` com `If-Range: "abc"`
- **Então** a resposta é `206` com `Content-Range: bytes 0-99/<tamanho>`.

## 3. Restrições (não funcionais e de compatibilidade)

Estas restrições valem para todas as respostas, parciais ou não.

### RNF-01 — Cabeçalhos de cache e conteúdo preservados

**Critério de aceite**

- **Dado** um asset com `ETag`, `Last-Modified`, `Cache-Control`, `Vary`, `Content-Type` e `Content-Encoding`
- **Quando** o cliente recebe uma resposta `206`
- **Então** esses cabeçalhos têm os mesmos valores que teriam na resposta `200` completa.

### RNF-02 — Comportamentos existentes preservados

**Critério de aceite**

- **Dado** a suíte de testes atual do projeto
- **Quando** ela é executada após a mudança
- **Então** todos os testes existentes passam, incluindo os casos de `304` (`If-None-Match`/`If-Modified-Since`), seleção de encoding, `fallthrough`, `404` para asset inexistente e `405` para métodos diferentes de `GET`/`HEAD`.

### RNF-03 — Sem novas exportações públicas

**Critério de aceite**

- **Dado** o arquivo `src/index.ts`
- **Quando** a mudança é concluída
- **Então** nenhum nome novo (valor ou tipo) foi adicionado, e as funções auxiliares em `src/utils/static.ts` não têm `export`.

### RNF-04 — Qualidade do código

**Critério de aceite**

- **Dado** o projeto com a mudança aplicada
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos terminam sem erros.

## 4. Fora de escopo

- Suporte a múltiplos intervalos (`multipart/byteranges`). Pedidos desse tipo são ignorados e servidos com `200`.
- Unidades de intervalo diferentes de `bytes`.
- Suporte a `Range` em métodos diferentes de `GET` e `HEAD`.
- Ranges para assets cujo tamanho não é conhecido (sem `size` em `getMeta`).
- Novas opções de configuração ou novas exportações públicas.
- Alterações em outros utilitários (`proxy`, `cache`, `event-stream`, `h3/rules`).
- Mudanças na lógica de `Cache-Control` ou em respostas `304` além do que já existe.
- Testes de integração com CDNs, proxies ou players reais.

## 5. Premissas e riscos

### Premissas

- O `getMeta` do `serveStatic` retorna `size` sempre que o asset é servido, e esse valor é o tamanho da representação selecionada. Se o `size` for ausente, o `Range` é ignorado (ver fora de escopo).
- Para a variante pré-comprimida, o `size` informado corresponde ao arquivo comprimido em disco.
- O `If-Range` é comparado com o `ETag` do asset. O contrato cobre apenas entity-tag.
- Os cabeçalhos de cache e conteúdo já são montados antes do envio, de modo que a resposta parcial pode reutilizá-los.

### Riscos e pontos em aberto

- **`If-Range` com data (`Last-Modified`).** O contrato trata apenas entity-tag. A RFC 9110 também admite data no `If-Range`. Decisão necessária: ignorar o `Range` (comportamento seguro, mas diferente da norma) ou implementar a comparação por data. Recomenda-se confirmar antes da implementação.
- **`bytes=-0` (sufixo de zero bytes).** A norma considera esse intervalo não satisfazível. O contrato não cobre o caso explicitamente. Assumido como `416`, a confirmar.
- **`bytes=-n` com `n` maior que o tamanho.** Assumido que o intervalo é limitado ao arquivo inteiro, com `206`. Não há restrição explícita no contrato.
- **Stream e fechamento de corpo.** Respostas parciais exigem fatiar o stream do arquivo. Há risco de vazamento de recurso se o stream não for fechado em `HEAD` ou em `416`. Os testes devem cobrir esses casos.
- **Compatibilidade com runtimes.** A implementação precisa funcionar em Node, Bun, Deno, Cloudflare Workers e navegadores, usando apenas APIs de web standards. Os testes com `describeMatrix` devem cobrir ao menos `web` e `node`.
- **Regressão de cache.** Mudar a ordem entre checagem de `304` e de `Range` pode quebrar revalidação. A checagem de `304` deve continuar com a mesma precedência.
