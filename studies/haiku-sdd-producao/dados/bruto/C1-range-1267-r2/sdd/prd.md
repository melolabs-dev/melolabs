# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Um cliente que pede um intervalo de bytes recebe o corpo inteiro com `200 OK` e nenhum cabeçalho de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio servidos pelo h3, já que os players dos navegadores enviam `Range` por padrão;
- comportamento correto de CDNs e proxies, que dependem de `Accept-Ranges` e de respostas `206`.

**Objetivo:** fazer `serveStatic` atender pedidos `Range` para `GET` e `HEAD`, quando o tamanho do asset é conhecido, seguindo a RFC 9110 (seções 13.1.5 e 14), que substitui a RFC 7233 citada na issue. A mudança deve ser interna ao `serveStatic`, sem novas exportações públicas e sem alterar o comportamento existente de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos de bytes

Quando um asset é encontrado e seu tamanho é conhecido (`meta.size` informado por `getMeta`), as respostas de `GET` e `HEAD` devem incluir `Accept-Ranges: bytes`.

**Critério de aceite**
- **Dado** um asset existente com `size` informado por `getMeta`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta é `200` com `Accept-Ranges: bytes`

### RF-02 — Interpretar um intervalo único válido

O `serveStatic` deve reconhecer um único intervalo na forma `bytes=início-fim`, `bytes=início-` (do início até o fim do arquivo) ou `bytes=-N` (os últimos N bytes), conforme a RFC 9110 seção 14.1.2.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta é `206 Partial Content` com o corpo formado pelos bytes 100 a 199

### RF-03 — Ignorar Range malformado ou com múltiplos intervalos

Quando o cabeçalho `Range` tiver unidade diferente de `bytes`, sintaxe inválida, múltiplos intervalos ou intervalo com início maior que fim, o servidor deve ignorá-lo e responder com o asset completo.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=0-1,4-5`, `Range: bytes=abc` ou `Range: bytes=199-100`
- **Então** a resposta é `200 OK` com o corpo completo e sem `Content-Range`

### RF-04 — Cabeçalhos e corpo de uma resposta 206

Para um intervalo válido e satisfazível, a resposta deve trazer `Content-Range: bytes início-fim/tamanho`, `Content-Length` igual ao número de bytes do intervalo e corpo contendo somente esses bytes.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=100-199`
- **Então** a resposta tem `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo com exatamente 100 bytes

### RF-05 — HEAD com intervalo

Para `HEAD`, o pedido com intervalo válido deve responder `206` apenas com cabeçalhos, sem corpo, com os mesmos `Content-Range` e `Content-Length` que o `GET` correspondente.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=100-199`
- **Então** a resposta é `206`, tem `Content-Range: bytes 100-199/1000` e `Content-Length: 100`, e não tem corpo

### RF-06 — Intervalo não satisfazível

Quando o intervalo estiver bem formado mas fora do arquivo (início igual ou maior que o tamanho, ou sufixo de zero bytes), a resposta deve ser `416 Range Not Satisfiable` com `Content-Range: bytes */tamanho` e `Content-Length: 0`.

**Critério de aceite**
- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=1000-1100`
- **Então** a resposta é `416`, tem `Content-Range: bytes */1000` e `Content-Length: 0`

### RF-07 — If-Range

Quando o cliente enviar `If-Range`, o intervalo só deve ser aplicado se o validador coincidir com o `ETag` forte ou com o `Last-Modified` atuais do asset. Caso contrário, o `Range` é ignorado e a resposta é `200` completa.

**Critério de aceite**
- **Dado** um asset com `ETag: "abc"` e `Range: bytes=0-9`
- **Quando** o cliente envia também `If-Range: "xyz"`
- **Então** a resposta é `200 OK` com o asset completo
- **E** quando envia `If-Range: "abc"`, a resposta é `206` com os bytes 0 a 9

### RF-08 — Condicionais antes do intervalo

As pré-condições de cache (`If-None-Match`, `If-Modified-Since`) devem ser avaliadas antes do `Range`. Se derem `304 Not Modified`, o `Range` não é considerado.

**Critério de aceite**
- **Dado** um asset com `ETag: "abc"`
- **Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-9`
- **Então** a resposta é `304 Not Modified` sem corpo

### RF-09 — Comportamento existente preservado

Sem `Range`, e nos casos de asset inexistente, `fallthrough`, método não permitido, caminho não canônico, cache e seleção de encoding, a resposta deve ser idêntica à de hoje.

**Critério de aceite**
- **Dado** um `POST` para um asset existente
- **Quando** a requisição chega ao `serveStatic`
- **Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje
- **E** dado um asset inexistente com `Range`, a resposta é `404` (ou a requisição segue adiante com `fallthrough`), como hoje

### RF-10 — Sem novas exportações públicas

`src/index.ts` não deve ganhar nenhum nome, nem valor nem tipo. As funções auxiliares devem ser privadas ao módulo `src/utils/static.ts`.

**Critério de aceite**
- **Dado** o `src/index.ts` antes e depois da mudança
- **Quando** os dois forem comparados
- **Então** a lista de exportações públicas é a mesma

### RF-11 — Sem novas opções de configuração

A funcionalidade deve usar apenas `ServeStaticOptions` e o `size` retornado por `getMeta`. Nenhum campo novo é adicionado à interface.

**Critério de aceite**
- **Dado** a interface `ServeStaticOptions`
- **Quando** a mudança é concluída
- **Então** ela não tem campos novos e uma chamada existente de `serveStatic` continua compilando sem alteração

### RF-12 — Tamanho desconhecido

Quando `getMeta` não informar `size` (ou informar zero), o `Range` é ignorado e o asset é servido completo, como hoje.

**Critério de aceite**
- **Dado** um asset cujo `getMeta` não retorna `size`
- **Quando** o cliente envia `Range: bytes=0-9`
- **Então** a resposta é `200 OK` com o corpo completo e sem `Accept-Ranges`

### RF-13 — Testes e qualidade

Os novos comportamentos devem ter testes de regressão no padrão `describeMatrix` (modos `web` e `node`). A suíte existente deve continuar passando, e `pnpm lint` e `pnpm typecheck` devem passar. Testes existentes só podem ser ajustados quando dependerem do que a mudança altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** a branch com a mudança
- **Quando** `pnpm vitest run` e `pnpm lint` forem executados
- **Então** todos os testes passam nos dois modos e o lint e a checagem de tipos passam sem erros

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos desse tipo são ignorados (RF-03).
- Suporte a `Range` fora de `serveStatic` (proxy, outros handlers, `event.res` genérico).
- Mudar a assinatura de `getContents` para receber um intervalo do backend. Isso seria o caminho ideal para arquivos grandes, mas exige mudança de API pública e fica para uma proposta separada.
- Cache de intervalos ou pré-cálculo de partes.
- Alterar `ServeStaticOptions`, `StaticAssetMeta` ou qualquer export público.
- Aplicar `Range` a `POST`, `PUT` ou outros métodos (continuam com 405).
- Mudanças na lógica de canonicalização de caminho, `fallthrough` ou encoding.

## Premissas

- **Corpo do intervalo em memória:** `getContents` devolve o corpo completo (`BodyInit`) e não aceita intervalo. O recorte precisa ser feito no `serveStatic` (por exemplo, com `Blob.slice` ou sobre um `ArrayBuffer`). Presume-se que o uso típico (vídeos e downloads de tamanho moderado) tolera isso.
- **Sufixo (`bytes=-N`):** a issue não cita essa forma, mas a RFC 9110 a define. Assume-se que ela deve ser suportada. Se o time preferir excluí-la, basta ignorá-la como malformada.
- **Encoding pré-comprimido:** o `Range` se aplica aos bytes da representação escolhida, ou seja, ao arquivo `.gz`/`.br` quando ele é servido, com `Content-Encoding` já definido por `meta.encoding`.
- **`ETag` fraco:** em `If-Range`, um `ETag` fraco nunca coincide (RFC 9110 seção 13.1.5).
- **Scripts:** presume-se que `pnpm typecheck` exista no `package.json`. O `AGENTS.md` cita apenas `pnpm lint` e diz que ele inclui a checagem de tipos. Vale confirmar antes de fechar a tarefa.
- O tamanho em `meta.size` é o tamanho real do conteúdo que `getContents` devolve.

## Riscos

- **Memória:** para arquivos grandes, recortar o corpo em memória pode ser caro. O risco fica limitado enquanto `getContents` não aceitar intervalo (ver Fora de escopo).
- **Tamanho inconsistente:** se `meta.size` não bater com o conteúdo real, `Content-Range` e `Content-Length` ficam errados. Não há como o `serveStatic` verificar isso sem ler o corpo.
- **Cabeçalhos já definidos:** hoje `Content-Length` é definido antes do ramo de `HEAD` e só se ainda não existir (`static.ts`, linha 268). Para `206` e `416` é preciso sobrescrevê-lo, e a ordem de definição precisa ser revista para não deixar um `Content-Length` completo junto com o parcial.
- **Interação com `headers` do usuário:** cabeçalhos passados em `options.headers` são aplicados antes; um `Content-Range` ou `Content-Length` ali pode conflitar com o recorte.
- **Regressão em cache:** a avaliação de `304` precisa continuar antes do `Range` (RF-08), ou clientes com cache passam a receber `206` indevidamente.
- **Testes existentes:** alguns testes de `serveStatic` podem depender do `200` completo para pedidos com `Range`. Ajustar esses testes exige cuidado para não enfraquecer a verificação.
