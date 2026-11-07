# PRD: HTTP Range em `serveStatic`

- Issue: h3js/h3#1267
- Contrato: `sdd/pedido.md`
- Código afetado: `src/utils/static.ts`
- Norma: RFC 9110 §14 (Range Requests) e §13.1.5 (If-Range). Substitui a RFC 7233 citada na issue.

## Problema e objetivo

Hoje `serveStatic` ignora o cabeçalho `Range`. Ele sempre responde 200 com o corpo inteiro e não anuncia suporte a intervalos. Por isso:

- clientes não conseguem retomar downloads interrompidos;
- players de vídeo e áudio não conseguem avançar (seek) no arquivo;
- proxies e CDNs não conseguem armazenar nem servir partes do arquivo.

**Objetivo:** fazer `serveStatic` atender pedidos de intervalo de bytes em GET e HEAD, segundo a RFC 9110. A API pública não muda, e o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405 continua igual.

## Requisitos funcionais

Neste documento, "tamanho" é o `size` retornado por `getMeta` para o variante que será servido.

### RF-01 — Anunciar suporte a intervalos

Em respostas GET e HEAD de um asset cujo tamanho é conhecido (`size` numérico), `serveStatic` define `Accept-Ranges: bytes`, mesmo quando a requisição não tem `Range`.

- **Dado** um asset de 1000 bytes e uma requisição GET sem `Range`,
- **Quando** `serveStatic` gera a resposta,
- **Então** a resposta é 200, tem `Accept-Ranges: bytes` e tem `Content-Length: 1000`.

### RF-02 — Intervalo de faixa única responde 206

Aceitar as formas `bytes=a-b`, `bytes=a-` (do byte `a` até o fim) e `bytes=-n` (os últimos `n` bytes). Quando o intervalo é satisfatível, responder 206 com:

- `Content-Range: bytes a-b/tamanho`;
- `Content-Length` igual ao tamanho do trecho;
- corpo com exatamente os bytes do trecho;
- `ETag` e `Last-Modified` iguais aos do 200.

Essas regras valem mesmo que a opção `headers` defina `Content-Length`: o 206 sempre usa o tamanho do trecho.

- **Dado** um asset de 1000 bytes com conteúdo conhecido,
- **Quando** a requisição GET tem `Range: bytes=100-199`,
- **Então** a resposta é 206, tem `Content-Range: bytes 100-199/1000`, tem `Content-Length: 100` e o corpo é exatamente os bytes 100 a 199.

### RF-03 — Limites do intervalo são ajustados ao tamanho

- Quando o fim do intervalo passa do tamanho, o fim é limitado a `tamanho - 1`.
- Quando o sufixo é maior que o tamanho, o trecho é o arquivo inteiro.

Exemplos com tamanho 1000:

- **Dado** um asset de 1000 bytes, **Quando** `Range: bytes=900-5000`, **Então** a resposta é 206 com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.
- **Dado** um asset de 1000 bytes, **Quando** `Range: bytes=-5000`, **Então** a resposta é 206 com `Content-Range: bytes 0-999/1000` e `Content-Length: 1000`.

### RF-04 — Intervalo não satisfatível responde 416

Responder 416 quando nenhum byte do asset satisfaz o intervalo. Isso vale para:

- início maior ou igual ao tamanho (`bytes=1000-` com tamanho 1000);
- sufixo de zero bytes (`bytes=-0`);
- qualquer intervalo quando o asset tem tamanho 0.

A resposta 416 tem `Content-Range: bytes */tamanho`, `Content-Length: 0`, corpo vazio e `Accept-Ranges: bytes`.

- **Dado** um asset de 1000 bytes,
- **Quando** a requisição tem `Range: bytes=1000-`,
- **Então** a resposta é 416, com `Content-Range: bytes */1000`, `Content-Length: 0` e sem corpo.

### RF-05 — Range inválido ou múltiplo é ignorado

Quando o cabeçalho `Range` não pode ser interpretado como um intervalo de faixa única, `serveStatic` ignora o cabeçalho e responde 200 com o corpo inteiro. Não há `Content-Range` e não há 416. Isso vale para:

- sintaxe inválida ou número não decimal;
- unidade diferente de `bytes`;
- mais de uma faixa separada por vírgula;
- primeiro byte maior que o último (`bytes=500-100`).

- **Dado** um asset de 1000 bytes,
- **Quando** a requisição tem `Range: bytes=0-1,5-9`, ou `Range: items=0-5`, ou `Range: bytes=500-100`, ou `Range: bytes=abc`,
- **Então** a resposta é 200, tem `Content-Length: 1000`, tem o corpo completo e não tem `Content-Range`.

### RF-06 — HEAD com Range

Para HEAD valem as mesmas regras de RF-02 a RF-05 (status, `Content-Range`, `Content-Length`), mas a resposta não tem corpo. `getContents` não é chamado.

- **Dado** um asset de 1000 bytes,
- **Quando** a requisição HEAD tem `Range: bytes=0-99`,
- **Então** a resposta é 206, tem `Content-Length: 100` e `Content-Range: bytes 0-99/1000`, não tem corpo, e `getContents` não foi chamado.

### RF-07 — If-Range

Quando a requisição tem `If-Range`, o `Range` só é honrado se o validador enviado coincidir com o do asset:

- **ETag:** deve ser igual à ETag forte do asset. ETag fraca (`W/`), de um lado ou do outro, nunca coincide.
- **Data:** deve ser igual, com precisão de segundo, ao `Last-Modified` do asset. Um asset sem `mtime` nunca coincide.

Se o validador não coincidir, `serveStatic` ignora o `Range` e responde 200 com o corpo inteiro.

- **Dado** um asset com ETag `"abc"` e tamanho 1000,
- **Quando** a requisição tem `Range: bytes=0-9` e `If-Range: "xyz"`,
- **Então** a resposta é 200 com o corpo inteiro.
- **E** se a requisição tiver `If-Range: "abc"` no lugar, a resposta é 206 com `Content-Length: 10`.

### RF-08 — Condicionais têm prioridade sobre Range

Se a requisição é atendida com 304 pelas condicionais existentes (`If-None-Match` ou `If-Modified-Since`), a resposta continua sendo 304 sem corpo, e o `Range` é ignorado.

- **Dado** um asset com ETag `"abc"`,
- **Quando** a requisição tem `If-None-Match: "abc"` e `Range: bytes=0-9`,
- **Então** a resposta é 304 sem corpo, como hoje.

### RF-09 — Range sobre o variante pré-comprimido

Quando `accept-encoding` escolhe um variante pré-comprimido (por exemplo, `.gz`), o `Range` se aplica aos bytes desse variante. `Content-Length` e `Content-Range` usam o tamanho do variante. `Content-Encoding`, `Content-Type` e `Vary` continuam como hoje.

- **Dado** `encodings: { gzip: ".gz" }` e um arquivo `app.js.gz` de 300 bytes,
- **Quando** a requisição tem `Accept-Encoding: gzip` e `Range: bytes=0-99`,
- **Então** a resposta é 206, tem `Content-Range: bytes 0-99/300`, `Content-Length: 100` e `Content-Encoding: gzip`.

### RF-10 — Leitura de stream limitada ao intervalo

`getContents` não recebe o intervalo, então o recorte acontece dentro de `serveStatic`. Quando o conteúdo é um `ReadableStream`, `serveStatic` não consome o stream além do pedaço que contém o último byte do intervalo. O restante do stream é cancelado.

- **Dado** um `ReadableStream` de 1000 pedaços de 1 byte cada, cujas leituras são contadas,
- **Quando** a requisição tem `Range: bytes=0-9`,
- **Então** o corpo tem 10 bytes e o stream foi lido no máximo até o décimo pedaço, e não até o fim.

### RF-11 — Comportamento existente preservado

Sem `Range`, a resposta é igual à atual, exceto pelo `Accept-Ranges` de RF-01. Com `Range`, os casos de erro continuam iguais:

- asset inexistente ou caminho não canônico: 404, ou `undefined` com `fallthrough`;
- método diferente de GET e HEAD: 405 com `Allow: GET, HEAD`, ou `undefined` com `fallthrough`.

- **Dado** um asset inexistente,
- **Quando** a requisição GET tem `Range: bytes=0-9`,
- **Então** a resposta é 404, como hoje.
- **E** se `POST` tem `Range`, a resposta é 405 com `Allow: GET, HEAD`.

### RF-12 — Sem nova API pública

`src/index.ts` não ganha nenhum nome (valor ou tipo). `ServeStaticOptions`, `getMeta` e `getContents` mantêm a assinatura. Os helpers novos ficam sem `export` dentro de `src/utils/static.ts`.

- **Dado** a branch com a mudança,
- **Quando** comparamos as exportações de `src/index.ts` e as assinaturas de `ServeStaticOptions` com a branch `master`,
- **Então** não há diferença, e `pnpm lint` e `pnpm typecheck` passam.

### Critérios transversais

- Todo teste novo usa `describeMatrix`, então roda em `web` e `node`.
- Os testes existentes continuam passando. Só se ajustam os que verificam headers exatos afetados por `Accept-Ranges`, sem perder o que verificam.
- Antes da correção, os testes de RF-02, RF-04 e RF-05 falham. Depois, passam.

## Fora de escopo

- Respostas com várias faixas (`multipart/byteranges`). As requisições com várias faixas são ignoradas, como permite a RFC 9110 §14.2.
- Mudar `getMeta` ou `getContents` para receber o intervalo, e criar opções novas em `ServeStaticOptions`.
- Range em respostas que não vêm de `serveStatic` (`toResponse`, `proxy`, respostas feitas à mão).
- Compressão sob demanda ou mudança na seleção de encoding.
- Suporte a `If-Match` e `If-Unmodified-Since` (412). Eles não existem hoje.
- Range em respostas 304.
- Upload com `Content-Range` (PUT ou PATCH).
- Mudar o comportamento de cache, `Cache-Control` ou `Vary`, além do que já existe.

## Premissas

- **P1.** `meta.size` é o tamanho real do conteúdo que `getContents` devolve para o mesmo variante. Se não for, a resposta é inconsistente, e a causa é o backend.
- **P2.** A assinatura de `getContents` não muda. O recorte do intervalo acontece dentro de `serveStatic`, como descrito em RF-10.
- **P3.** O intervalo se aplica à representação codificada, depois do content-coding, como manda a RFC 9110 §14.1. Por isso o recorte do `.gz` é feito sobre os bytes gzip.
- **P4 (decisão tomada).** A issue pede "sempre anunciar `Accept-Ranges: bytes`". Eu restringi a RF-01 a assets com tamanho conhecido, porque anunciar bytes sem poder atender intervalos seria incorreto. Se os mantenedores preferirem anunciar sempre, a mudança é pequena. Vale confirmar antes de implementar.
- **P5 (decisão tomada).** Múltiplas faixas são ignoradas, não atendidas. A issue pede esse comportamento, e a RFC permite. Isso também evita que um único pedido gere várias leituras do arquivo.
- **P6.** Um asset de tamanho 0 responde 416 para qualquer `Range` válido, porque nenhum byte o satisfaz.

## Riscos

- **R1. Custo em streams.** Para um `ReadableStream`, chegar a um intervalo no fim do arquivo exige ler e descartar tudo antes dele. RF-10 limita a leitura ao necessário, mas não elimina o custo. `Blob` e `ArrayBuffer` podem ser fatiados sem esse custo. Mitigação: documentar, sem mudar a API (fora de escopo).
- **R2. Tamanho divergente.** Se `size` não bater com o corpo, o cliente recebe menos bytes que o `Content-Length`. Mitigação: cobertura de teste em RF-02 e RF-09. O erro de origem fica fora do controle de `serveStatic`.
- **R3. Comparação de datas em If-Range.** A comparação é exata, com precisão de segundo. Um cliente que envie a data em outro formato recebe 200 com o corpo inteiro, o que é seguro, mas pode ser mais lento para ele.
- **R4. Adaptadores de runtime.** O status 206 e o corpo recortado precisam funcionar em `web` e `node`. Mitigação: `describeMatrix`.
- **R5. Testes existentes.** A nova `Accept-Ranges` pode quebrar asserções de headers exatos. Mitigação: ajustar só esses testes, mantendo o que eles verificam.
- **R6. Corpo nulo com `size` maior que zero.** Se `getContents` devolve `null` e o `size` é maior que zero, a resposta já é inconsistente hoje. Esta mudança não corrige isso, e um 206 com corpo nulo teria o mesmo problema.
