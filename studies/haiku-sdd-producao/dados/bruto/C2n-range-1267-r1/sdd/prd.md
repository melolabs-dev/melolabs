# PRD: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue h3js/h3#1267 e contrato enxuto). Norma: RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests), que substituem a RFC 7233 citada na issue.

## Problema e objetivo

**Problema.** `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Ele sempre responde 200 com o corpo completo e nunca envia cabeçalhos de conteúdo parcial. Por isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek);
- CDNs e proxies não recebem o comportamento que esperam de um servidor de arquivos estáticos.

**Objetivo.** Fazer `serveStatic` atender intervalos de bytes em GET e HEAD, com 206, 416 e `Accept-Ranges`, sem alterar a API pública e sem mudar o comportamento já existente de cache, seleção de encoding, `fallthrough`, 404 e 405.

**Única mudança observável fora de Range.** Requisições sem `Range` passam a receber `Accept-Ranges: bytes` em 200 e 304. Esse é o único efeito intencional em respostas que não usam Range.

## Ordem de avaliação

Para uma requisição a um asset encontrado, as etapas rodam nesta ordem. A ordem é parte do contrato, não detalhe de implementação.

1. Método: POST, PUT etc. recebem 405 com `allow: GET, HEAD` (RF-11). Range não é lido.
2. Pré-condições de cache: `If-None-Match` e `If-Modified-Since` (RF-08). Se casarem, responde 304.
3. `If-Range` (RF-07). Se não casar, o `Range` é descartado e segue para 200.
4. Análise sintática do `Range` (RF-05). Se inválido, o `Range` é descartado e segue para 200.
5. Satisfazibilidade (RF-06). Só aqui um intervalo pode virar 416.
6. Resposta 206 com o trecho (RF-02, RF-03, RF-04).

Consequência: um `If-Range` que não casa nunca produz 416, mesmo que o intervalo esteja além do fim do arquivo.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

`serveStatic` deve enviar `Accept-Ranges: bytes` em toda resposta de um asset encontrado (200, 206, 304 e 416), tanto em GET quanto em HEAD. Respostas 404 e 405 não recebem o cabeçalho.

**Critério de aceite**

- **Dado** um asset existente e uma requisição GET sem cabeçalho `Range`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 200 e contém `Accept-Ranges: bytes`.

### RF-02 — Responder a um intervalo válido com 206

Para um intervalo único válido, `serveStatic` responde 206 com `Content-Range: bytes <início>-<fim>/<tamanho>`, `Content-Length` igual ao número de bytes enviados e o corpo restrito a esse trecho.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e uma requisição GET com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 206, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo formado pelos bytes 0 a 99.

### RF-03 — Suportar as três formas de intervalo único

Além de `bytes=início-fim`, são válidas as formas `bytes=início-` (do início até o fim do arquivo) e `bytes=-n` (os últimos `n` bytes). Um `fim` maior que o tamanho é limitado ao último byte. Quando `n` é maior que o tamanho, o intervalo cobre o arquivo inteiro.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e uma requisição GET com `Range: bytes=-100`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 206, com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.

### RF-04 — HEAD com Range responde só com cabeçalhos

Em HEAD, um intervalo válido produz a mesma resposta 206 de RF-02 (status, `Content-Range` e `Content-Length`), mas sem corpo. O conteúdo do asset não deve ser lido.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e uma requisição HEAD com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 206, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100`, sem corpo, e `getContents` não é chamado.

### RF-05 — Ignorar Range malformado, de outra unidade ou com múltiplos intervalos

Um cabeçalho `Range` é ignorado, e a resposta é o asset completo como hoje, quando:

- a unidade não é `bytes` (por exemplo `items=0-1`);
- há mais de um intervalo (por exemplo `bytes=0-1,5-9`). A RFC 9110 permite ignorar Range nesse caso, e a escolha evita implementar `multipart/byteranges`;
- a sintaxe não segue a gramática estrita da RFC 9110: `bytes=` seguido de `1*DIGIT` para início e fim, sem sinal, sem espaços e sem valores vazios além da forma `bytes=-n`;
- o intervalo é invertido (por exemplo `bytes=500-100`).

Valores com dígitos demais, que não cabem em um inteiro seguro, são tratados como malformados.

**Critério de aceite**

- **Dado** um asset de 1000 bytes e uma requisição GET com `Range: bytes=0-1,5-9`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 200, com o corpo completo e sem `Content-Range`.

### RF-06 — Responder 416 para intervalo não satisfazível

Quando o intervalo começa além do último byte, ou quando um sufixo tem tamanho zero, `serveStatic` responde 416 com `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e sem corpo. Vale para GET e HEAD. Só se aplica depois que `If-Range` foi aceito (ver Ordem de avaliação).

**Critério de aceite**

- **Dado** um asset de 1000 bytes e uma requisição GET com `Range: bytes=1000-1100`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 416, com `Content-Range: bytes */1000`, `Content-Length: 0` e sem corpo.

### RF-07 — If-Range protege a retomada

Quando a requisição traz `If-Range`, o `Range` só é aplicado se o validador enviado casar com o atual do asset:

- com ETag, a comparação é forte: ETag fraco, no `If-Range` ou no asset, nunca casa;
- com data, o valor deve ser exatamente igual ao `Last-Modified`. Data que não pode ser analisada não casa;
- se o `If-Range` traz ETag e o asset não tem ETag, não casa;
- se o `If-Range` traz data e o asset não tem `Last-Modified`, não casa.

Se não casar, `serveStatic` ignora o `Range` e responde 200 com o asset completo.

**Critério de aceite**

- **Dado** um asset com ETag `"v2"` e uma requisição GET com `Range: bytes=0-99` e `If-Range: "v1"`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 200, com o corpo completo e sem `Content-Range`.

### RF-08 — Pré-condições têm precedência sobre Range

A verificação de cache (`If-None-Match` e `If-Modified-Since`) continua sendo feita antes de qualquer análise de `Range`. Se o cache casar, a resposta é 304, mesmo que haja um `Range` válido.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"` e uma requisição GET com `If-None-Match: "v1"` e `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 304, sem corpo, como hoje.

### RF-09 — Range aplica-se à variante escolhida

Quando há `encodings` configurados e a variante pré-comprimida é servida, os intervalos e o `Content-Range` referem-se ao tamanho e aos bytes dessa variante. `Content-Encoding` e `Vary` continuam como hoje. Um `If-Range` com ETag é comparado com o ETag da variante servida, não com o do arquivo original (ver premissas).

**Critério de aceite**

- **Dado** um asset `app.js` com variante `app.js.gz` de 300 bytes, `encodings: { gzip: ".gz" }`, uma requisição GET com `accept-encoding: gzip` e `Range: bytes=0-9`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 206, com `Content-Range: bytes 0-9/300`, `Content-Encoding: gzip` e `Vary` contendo `accept-encoding`.

### RF-10 — Sem tamanho conhecido, Range é ignorado

Se `getMeta` não devolve `size`, ou devolve zero (ver premissas), `serveStatic` não aplica `Range` e responde 200 com o corpo completo, como hoje.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size` e uma requisição GET com `Range: bytes=0-99`,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 200, com o corpo completo e sem `Content-Range`.

### RF-11 — Preservar comportamentos existentes

Asset inexistente, método não permitido, `fallthrough` e cache seguem como hoje, também quando a requisição traz `Range`.

**Critério de aceite**

- **Dado** uma requisição POST com `Range: bytes=0-99` para um asset existente,
- **Quando** `serveStatic` responde,
- **Então** a resposta é 405, com `allow: GET, HEAD`, como hoje.

### RF-12 — Sem novas exportações

A mudança não adiciona nenhum nome público: `src/index.ts` não ganha valores nem tipos, e as funções auxiliares ficam privadas ao módulo `static.ts`. Nenhuma opção nova é adicionada a `ServeStaticOptions`.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se comparam as exportações de `src/index.ts` e de `src/utils/static.ts` com as do estado atual,
- **Então** não há nomes novos exportados, nem valores nem tipos.

### RF-13 — Testes e qualidade

Os casos de RF-02 a RF-11 são cobertos por testes em `test/static.test.ts`, executados nos modos `web` e `node`. A suíte existente continua passando; testes existentes só são ajustados quando dependem de um comportamento que a mudança altera de forma intencional.

Cada caso de intervalo, `If-Range` e 416 é escrito e visto falhando antes da implementação, seguindo o fluxo de correção de bug do `AGENTS.md`.

**Critério de aceite**

- **Dado** a implementação concluída,
- **Quando** são executados `pnpm vitest run test/static.test.ts` e `pnpm lint`,
- **Então** todos passam, e os casos novos aparecem nos dois modos (web e node).

Nota: `AGENTS.md` descreve `pnpm lint` como lint mais typecheck e não lista um script `pnpm typecheck`. Por isso o comando de verificação de tipos não aparece aqui. Confirmar antes de adicionar.

## Fora de escopo

- Múltiplos intervalos na mesma requisição (`multipart/byteranges`).
- Leitura parcial no backend: `getMeta` e `getContents` continuam com a mesma assinatura, e o backend não recebe o intervalo. O recorte é feito sobre o conteúdo devolvido por `getContents`, mesmo em GET com 206.
- Pré-condições `If-Match` e `If-Unmodified-Since` (resposta 412).
- Range em `proxy`, `proxyRequest` e no handler `proxy` de `h3/rules`.
- Nova opção de configuração para ligar ou desligar Range.
- Mudanças em `h3/rules/cache` ou em qualquer rota fora de `serveStatic`.

## Premissas

- O tamanho do asset vem de `getMeta` (`size`). Não há outra fonte de tamanho.
- `size` igual a zero é tratado como desconhecido, como o código atual já faz para `Content-Length`. Assim, nenhum `Range` é aplicado (RF-10). Se o desejado for responder 416 para arquivos vazios, a regra muda; **a confirmar**.
- Além do intervalo fechado descrito na issue, as formas `bytes=início-` e `bytes=-n` são aceitas, porque a RFC 9110 as define como intervalos únicos. A issue fala só em "um intervalo"; **a confirmar** se a intenção era aceitá-las.
- Com `encodings`, o Range vale para a variante servida (RF-09), como manda a RFC para representações codificadas. Se as variantes não tiverem ETag próprio, o `If-Range` com ETag não tem como casar com a variante; **a confirmar** como o código atual gera ETag por variante.
- O `Last-Modified` é comparado com `If-Range` por igualdade exata de data, como a RFC exige.
- Cabeçalhos definidos pelo usuário em `options.headers` não são alterados pelo recorte de Range, exceto `Content-Length` e `Content-Range`, que são sempre substituídos pelos valores do trecho enviado.
- Quando o `Range` é aplicado em GET, `getContents` é chamado por inteiro e o recorte é feito depois. Isso mantém a assinatura do backend (ver Fora de escopo) e faz com que o custo de memória seja aceito nesta entrega.

## Riscos

- **Content-Length inconsistente.** Hoje `serveStatic` define `content-length` a partir de `size` apenas se o cabeçalho ainda não existe. Em 206 e 416 esse valor precisa ser substituído pelo do trecho; caso contrário, a resposta sai com `Content-Length` do arquivo inteiro.
- **Fatiar `BodyInit` de tipos diferentes.** `getContents` pode devolver string, `ArrayBuffer`, `Blob`, `ReadableStream` ou `null`. Cada tipo exige um caminho próprio para recortar o trecho, e um stream pode precisar ser lido inteiro para a fatia, o que pesa em memória com arquivos grandes.
- **`size` diferente do conteúdo real.** Se `getMeta` informa 1000 e `getContents` devolve outro tamanho, o `Content-Range` ficaria errado. Decidir se o recorte usa o tamanho real do conteúdo (recomendado) ou o de `size`, e se a divergência gera erro.
- **`getContents` devolve `null` com `size` conhecido.** O caminho de 206 não tem corpo para recortar. Definir se isso vira 200 sem Range ou erro.
- **Interação com 304.** A precedência de RF-08 depende de a checagem de cache continuar antes da análise de `Range`. Uma reordenação acidental quebra a semântica de cache.
- **Ordem de If-Range e 416.** Se 416 for calculado antes de `If-Range`, um cliente com validador antigo recebe 416 em vez de 200 completo. A Ordem de avaliação existe para evitar isso.
- **Valores numéricos.** Números enormes ou com formato estranho devem ser rejeitados por uma análise estrita, para não produzir intervalos inválidos nem `NaN` no `Content-Range`.
- **Testes existentes.** Testes que verificam `Content-Length`, HEAD ou status 200 em requisições com cabeçalhos variados podem mudar. Os ajustes devem preservar o que cada teste verifica, como o contrato pede.
- **Base documental.** O cabeçalho cita `sdd/pedido.md`. Na listagem inicial do git só aparecia `sdd/prd.md` como não rastreado; confirmar que `sdd/pedido.md` existe antes de tratá-lo como fonte.
