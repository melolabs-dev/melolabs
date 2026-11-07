# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e o contrato enxuto em `sdd/pedido.md`.
Arquivos afetados: `src/utils/static.ts` (função `serveStatic`) e `test/static.test.ts`.

## Problema e objetivo

### Problema

`serveStatic` ignora o cabeçalho `Range`. Toda requisição GET ou HEAD para um asset encontrado recebe o corpo completo com status `200`, sem `Accept-Ranges` e sem `Content-Range`. Na prática isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio tocados por players e navegadores, que enviam requisições de intervalo por padrão;
- um comportamento correto de CDNs e proxies, que dependem de respostas `206` e `416`.

### Objetivo

Fazer `serveStatic` atender requisições de intervalo de bytes conforme a RFC 9110 (seções 13.1.5 e 14), para GET e HEAD, mantendo intactos os cabeçalhos de cache (`ETag`, `Last-Modified` e `Cache-Control`, quando definido), a seleção de encoding, o `fallthrough` e as respostas `404` e `405`. A mudança é interna: nenhuma API pública nova.

A RFC 9110 substitui a RFC 7233 citada na issue, e este PRD segue a RFC 9110. Quando a RFC permite ignorar `Range` (RFC 9110 §14.2, "MAY ignore"), o PRD escolhe ignorar e registra a escolha em [Decisões](#decisões).

## Tabela de decisão

Quando mais de uma regra se aplica, vale a primeira linha que bate. A ordem segue a avaliação real do `serveStatic`.

| # | Situação                                                                                             | Resposta                                    | Ref.         |
| - | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------ |
| 1 | Asset inexistente                                                                                    | `404`, ou segue para o próximo handler      | RF-09        |
| 2 | Método diferente de GET e HEAD                                                                       | `405` com `Allow: GET, HEAD`                | RF-09        |
| 3 | `If-None-Match` ou `If-Modified-Since` resolvem para não modificado                                  | `304`                                       | RF-07        |
| 4 | Sem `Range`, `Range` malformado, unidade diferente de `bytes`, mais de um intervalo, ou `b < a`      | `200` completo, sem `Content-Range`        | RF-05        |
| 5 | `If-Range` presente e não confere com o validador atual                                              | `200` completo, mesmo que o intervalo seria inválido | RF-06 |
| 6 | Tamanho desconhecido ou igual a zero                                                                 | `200` completo                              | RF-10        |
| 7 | Intervalo válido e satisfazível                                                                      | `206` com `Content-Range` e `Content-Length` | RF-02, RF-03 |
| 8 | Intervalo válido, mas não satisfazível (início maior ou igual ao tamanho, ou sufixo `-0`)           | `416` com `Content-Range: bytes */tamanho`  | RF-04        |

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Toda resposta de sucesso de um asset encontrado em GET ou HEAD deve incluir `Accept-Ranges: bytes`, inclusive quando a requisição não traz `Range`.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` sem cabeçalho `Range`
- **Então** a resposta `200` contém `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder a um intervalo válido com 206

Quando a requisição traz um único intervalo válido (`bytes=a-b`, `bytes=a-` ou o sufixo `bytes=-n`) e o tamanho do asset é conhecido, a resposta deve ter status `206 Partial Content`, o cabeçalho `Content-Range: bytes início-fim/tamanho` e um `Content-Length` igual ao número de bytes enviados. O corpo deve conter apenas esses bytes.

- Se `b` ultrapassar o último byte, o fim é limitado ao último byte do asset.
- Um sufixo maior que o asset resulta no asset inteiro, com `Content-Range` de `0` até o último byte.
- Espaços ao redor de `=`, `-` e `,` não são aceitos; são tratados como malformados (RF-05).

**Critério de aceite**

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `GET` com `Range: bytes=10-19`
- **Então** a resposta tem status `206`, `Content-Range: bytes 10-19/100`, `Content-Length: 10` e o corpo contém exatamente os bytes 10 a 19.

- **Dado** o mesmo asset
- **Quando** o cliente envia `GET` com `Range: bytes=90-`
- **Então** a resposta tem status `206`, `Content-Range: bytes 90-99/100` e `Content-Length: 10`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `GET` com `Range: bytes=-500`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-99/100` e `Content-Length: 100`.

### RF-03 — Responder a HEAD com intervalo válido

Para HEAD com intervalo válido, a resposta deve ter status `206` e os mesmos `Content-Range` e `Content-Length` que o GET correspondente, sem corpo.

**Critério de aceite**

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `HEAD` com `Range: bytes=0-9`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-9/100`, `Content-Length: 10` e corpo vazio.

### RF-04 — Responder a intervalo não satisfazível com 416

Quando o intervalo é sintaticamente válido, mas não se sobrepõe ao asset, a resposta deve ter status `416 Range Not Satisfiable`, `Content-Range: bytes */tamanho` e `Content-Length: 0`. Vale para GET e HEAD.

Não se sobrepõe ao asset quando:

- o início é maior ou igual ao tamanho;
- o sufixo é `bytes=-0`.

A regra vale somente para assets com tamanho maior que zero. Para tamanho zero, ver RF-10.

**Critério de aceite**

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `GET` com `Range: bytes=100-200`
- **Então** a resposta tem status `416`, `Content-Range: bytes */100` e `Content-Length: 0`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `HEAD` com `Range: bytes=-0`
- **Então** a resposta tem status `416` e `Content-Range: bytes */100`.

### RF-05 — Ignorar cabeçalho Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` for malformado, usar outra unidade que não `bytes`, pedir mais de um intervalo, ou trazer um intervalo com último byte menor que o primeiro (`bytes=10-5`), `serveStatic` deve ignorá-lo e responder como hoje: `200` com o corpo completo.

Pela RFC 9110 §14.1.1, um intervalo com último byte menor que o primeiro é sintaticamente inválido, e o cabeçalho deve ser ignorado.

**Critério de aceite**

- **Dado** um asset de 100 bytes
- **Quando** o cliente envia `GET` com `Range: bytes=0-4,10-14`
- **Então** a resposta tem status `200`, o corpo completo e nenhum `Content-Range`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `GET` com `Range: itens=0-4`, `Range: bytes=abc` ou `Range: bytes=10-5`
- **Então** a resposta tem status `200` e o corpo completo.

### RF-06 — Respeitar If-Range

Quando a requisição traz `If-Range`, o intervalo só é aplicado se o validador enviado corresponder ao asset atual:

- **ETag:** o valor deve ser forte e idêntico ao `etag` do asset. Um valor com prefixo `W/` nunca confere.
- **Data:** a HTTP-date deve ser idêntica ao `last-modified` do asset. A comparação é de igualdade, não de "mais recente". Data em outro formato não confere (ver [Fora de escopo](#fora-de-escopo)).

Se não conferir, o `Range` é ignorado, mesmo que o intervalo fosse inválido. A resposta é `200` com o corpo completo, nunca `416`.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"` e `Range: bytes=0-9`
- **Quando** o cliente envia `If-Range: "v1"`
- **Então** a resposta tem status `206`.

- **Dado** o mesmo asset
- **Quando** o cliente envia `If-Range: "v0"` ou `If-Range: W/"v1"`
- **Então** a resposta tem status `200` com o corpo completo.

- **Dado** o mesmo asset com `Range: bytes=500-600`
- **Quando** o cliente envia `If-Range: "v0"`
- **Então** a resposta tem status `200` com o corpo completo, e não `416`.

### RF-07 — Manter a precedência de validação condicional

A validação condicional existente (`If-None-Match` e `If-Modified-Since`, que gera `304`) continua acontecendo antes da avaliação de `Range`. Uma requisição que resulte em `304` não recebe `206` nem `416`.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `Range: bytes=0-9` e `If-None-Match: "v1"`
- **Então** a resposta tem status `304`.

### RF-08 — Preservar seleção de encoding e cache

O intervalo é aplicado à representação escolhida, ou seja, à variante pré-comprimida quando houver (`content-encoding` e `Content-Length` referem-se à variante). Se não houver variante para o encoding pedido, o intervalo recai sobre o arquivo original.

Os cabeçalhos `Vary: accept-encoding`, `ETag`, `Last-Modified`, `Content-Type` e `Content-Encoding` continuam sendo definidos como hoje.

**Critério de aceite**

- **Dado** `serveStatic` configurado com `encodings: { gzip: ".gz" }` e um asset `app.js` com variante `app.js.gz` de 40 bytes
- **Quando** o cliente envia `Accept-Encoding: gzip` e `Range: bytes=0-9`
- **Então** a resposta tem status `206`, `Content-Encoding: gzip`, `Content-Length: 10` e `Content-Range` calculado sobre os 40 bytes da variante.

### RF-09 — Preservar 404, 405 e fallthrough

Os caminhos de asset inexistente, método não permitido e `fallthrough` não mudam. Um `Range` em asset inexistente continua gerando `404`, ou deixando a requisição seguir quando `fallthrough` está ativo, e nunca `416`.

**Critério de aceite**

- **Dado** que o asset não existe
- **Quando** o cliente envia `GET` com `Range: bytes=0-9`
- **Então** a resposta é `404` (ou a requisição segue para o próximo handler se `fallthrough` estiver ativo).

- **Dado** `POST` em um caminho de asset com `Range`
- **Quando** a requisição é processada
- **Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje.

### RF-10 — Ignorar Range quando o tamanho não é conhecido ou é zero

Se `getMeta` não devolver `size`, ou devolver `0`, `serveStatic` não calcula intervalo. Nesse caso ignora o `Range` e responde `200` com o corpo completo, como hoje.

Para um asset vazio, a RFC permitiria `416`. O PRD opta por `200` para tratar tamanho desconhecido e tamanho zero do mesmo jeito, com um único caminho de código. Essa escolha está registrada em [Decisões](#decisões).

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size`
- **Quando** o cliente envia `GET` com `Range: bytes=0-9`
- **Então** a resposta tem status `200`, o corpo completo e nenhum `Content-Range`.

- **Dado** um asset vazio (`size: 0`)
- **Quando** o cliente envia `GET` com `Range: bytes=0-9`
- **Então** a resposta tem status `200`, corpo vazio e nenhum `Content-Range`.

### RF-11 — Sem novas exportações públicas

`src/index.ts` não ganha nomes novos, nem valores nem tipos. Funções auxiliares de parsing de `Range` e de `If-Range` ficam privadas em `src/utils/static.ts`, no fim do arquivo, na seção de utilitários internos.

**Critério de aceite**

- **Dado** o módulo público após a mudança
- **Quando** comparo a lista de exportações de `src/index.ts` com a da versão anterior, incluindo tipos
- **Então** não há nomes adicionados nem removidos.

### RF-12 — Cobertura nos dois modos de teste

Os novos comportamentos são testados com `describeMatrix` em `test/static.test.ts`, rodando nos modos `web` e `node`. Testes existentes só são ajustados quando dependem diretamente do comportamento alterado, sem perder o que verificam. Cada ajuste deve ser justificado na descrição do PR.

Os testes devem ser escritos antes da implementação e confirmados como falhando, como no fluxo de correção de bug do `AGENTS.md`. Os casos mínimos são:

- GET sem `Range` com `Accept-Ranges` (RF-01);
- intervalo fechado, aberto e sufixo, com limite no fim do asset (RF-02);
- HEAD com `206` e corpo vazio (RF-03);
- `416` em GET e HEAD, incluindo `bytes=-0` (RF-04);
- `Range` ignorado para malformado, unidade diferente, múltiplos intervalos e `b < a` (RF-05);
- `If-Range` forte igual, diferente, `W/` e data (RF-06);
- `304` com `Range` na mesma requisição (RF-07);
- variante `gzip` (RF-08);
- `404` com `Range` com e sem `fallthrough`, e `405` (RF-09);
- `size` ausente e `size: 0` (RF-10).

**Critério de aceite**

- **Dado** a suíte após a mudança
- **Quando** rodo `pnpm vitest run test/static.test.ts`
- **Então** todos os testes passam nos modos `web` e `node`, incluindo os casos acima.

## Definição de pronto

- `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`.
- `pnpm lint` passa. Segundo o `AGENTS.md`, ele inclui o typecheck.
- `pnpm test` passa (lint, typecheck e cobertura).
- Nenhum teste existente foi removido. Ajustes estão justificados.
- A comparação de exportações de `src/index.ts` não mostra mudanças (RF-11).

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Pedidos com mais de um intervalo recebem `200` completo (RF-05).
- Alterar as assinaturas de `getMeta` e `getContents`, ou incluir intervalos nelas. A leitura do intervalo é feita dentro de `serveStatic`, a partir do conteúdo já retornado por `getContents`.
- Novas opções em `ServeStaticOptions`.
- Suporte a `Range` em outros handlers (proxy, `h3/rules`, respostas de arquivo fora de `serveStatic`).
- Cache de respostas parciais e otimizações de I/O por faixa (por exemplo, ler apenas os bytes necessários do disco ou do backend).
- Tratar `If-Range` com data em formato diferente da forma HTTP-date válida.
- `If-Match` e `If-Unmodified-Since` (que geram `412`). A RFC 9110 manda avaliá-los antes de `Range`. Se o `serveStatic` atual não os trata, continuam fora desta versão. Se já os tratar, a ordem deve ser mantida.

## Premissas

- O `size` retornado por `getMeta` corresponde ao tamanho do conteúdo que `getContents` entrega, inclusive para a variante pré-comprimida.
- Formatos de `BodyInit` que `serveStatic` consegue fatiar: `Blob`, `Uint8Array` e `ArrayBuffer`, diretamente. Para `string`, o fatiamento é feito sobre os bytes UTF-8 codificados, e não sobre caracteres, para que `size` e `Content-Range` batam com o corpo. Os demais tipos seguem a decisão de [Decisões](#decisões) para `ReadableStream`.
- `ETag` do asset é tratado como forte para o `If-Range`, já que o h3 não distingue ETag fraca de forte no `meta.etag`. Assume-se que o `etag` informado é forte.
- A ordem de avaliação já existente (cabeçalhos customizados, método, canonicidade do caminho, `getMeta`, `Vary`, validação condicional, `Content-Type`, `Content-Encoding`, `Content-Length`) é mantida. A lógica de `Range` entra depois da validação condicional e da avaliação de `If-Range`.
- O contrato em `sdd/pedido.md` (RFC 9110, sem API nova, lint e typecheck passando) é o critério final de aceite técnico. Ainda não foi confirmado que o arquivo existe no repositório. Se não existir, este PRD é a única referência.

## Riscos

- **Fatiamento de `ReadableStream`.** Se `getContents` devolver um stream, fatiar exige consumir o stream desde o início e descartar bytes antes do intervalo. Isso pode ser caro em memória e em tempo para arquivos grandes. Mitigação: tratar streams como "não fatiáveis" e responder `200` (ver decisão em aberto).
- **Mudança de comportamento para clientes existentes.** Respostas passam a incluir `Accept-Ranges` e podem mudar de `200` para `206` ou `416` para requisições com `Range`. Testes que dependem de `200` com `Range` precisam ser revisados. Essa mudança é o objetivo do PRD, não um efeito colateral.
- **Interação com encoding.** `Content-Length` e `Content-Range` referem-se à variante comprimida. Um cliente que pede intervalo sobre `gzip` precisa receber os bytes comprimidos, o que é correto pela RFC, mas é fácil confundir com os bytes descomprimidos.
- **Precedência de `304`, `416` e `Range`.** Uma ordem errada pode devolver `416` para um asset que deveria responder `304`, ou `416` quando `If-Range` não confere. Coberto por RF-06 e RF-07.
- **Validador fraco em `If-Range`.** Se o ETag for fraco e a comparação não for ajustada, o `If-Range` pode aceitar um intervalo indevido. Mitigação: comparar apenas ETag forte, conforme RF-06.
- **Consistência de `size`.** Se `getMeta` e `getContents` retornarem tamanhos diferentes (por exemplo, arquivo alterado entre as duas chamadas), o `Content-Range` pode ficar errado. Esse risco já existe para `Content-Length` e não é resolvido aqui.
- **Limite de conteúdo truncado.** Se `getContents` devolver menos bytes que o `size`, a resposta `206` ficaria com `Content-Length` maior que o corpo. Assume-se que o backend é consistente com `getMeta`.

## Decisões

Decisões já tomadas neste PRD:

1. **Múltiplos intervalos:** respondem `200` completo, permitido pela RFC 9110 §14.2. Isso fica como está mesmo que todos os intervalos fossem `416`.
2. **Asset de tamanho zero:** responde `200` completo, e não `416`, para tratar tamanho zero igual a tamanho desconhecido (RF-10).
3. **`If-Range` com ETag fraca:** nunca confere (RF-06).

Decisão em aberto:

- **`ReadableStream` e outros tipos não fatiáveis.** Opções: (a) fatiar lendo o stream inteiro; (b) ignorar `Range` e responder `200`; (c) fatiar só formatos materializados, que é a mesma coisa que (b) para streams. Recomendação: (b) como primeira versão, documentando a limitação. Esta decisão precisa ser confirmada antes da implementação.
