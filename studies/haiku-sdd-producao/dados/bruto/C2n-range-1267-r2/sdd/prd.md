# PRD — Suporte a HTTP Range no `serveStatic`

Referências: issue h3js/h3#1267. Norma: RFC 9110, seções 13.1.5 (If-Range) e 14 (Range Requests). A issue cita a RFC 7233, que foi substituída pela RFC 9110. Este documento é autocontido: as regras de comportamento estão aqui, não em outro arquivo.

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um intervalo, o servidor responde 200 com o arquivo inteiro, sem `Accept-Ranges`, sem `Content-Range` e sem 206. Isso causa três problemas:

- Downloads não podem ser retomados.
- Players de vídeo e áudio não conseguem avançar (seek), porque o navegador depende de Range para isso.
- Proxies e CDNs não recebem o comportamento HTTP esperado para arquivos estáticos.

**Objetivo:** fazer o `serveStatic` atender a requisições de intervalo de bytes para GET e HEAD, seguindo a RFC 9110, sem alterar a API pública, sem quebrar cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

O `serveStatic` deve informar que aceita intervalos de bytes (`accept-ranges: bytes`) nas respostas de asset encontrado com corpo ou metadados de representação: 200, 206, 416 e HEAD. A resposta 304 mantém os cabeçalhos atuais. A regra segue P4: se `options.headers` já define `accept-ranges`, o valor do usuário prevalece.

- **Dado** um asset existente e uma requisição GET sem cabeçalho `Range`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta tem `accept-ranges: bytes` e status 200 com o corpo completo.

### RF-02 — Responder 206 a um intervalo válido

Para um intervalo válido e um asset de tamanho conhecido, o servidor responde 206 com apenas os bytes pedidos, `Content-Range` e `Content-Length` corretos.

- **Dado** um asset de 10 bytes com conteúdo `0123456789`,
- **Quando** a requisição GET envia `Range: bytes=2-5`,
- **Então** a resposta tem status 206, `content-range: bytes 2-5/10`, `content-length: 4` e corpo `2345`.

### RF-03 — Formas de intervalo: aberto, sufixo e limite além do tamanho

O servidor aceita as três formas de byte-range-spec da RFC 9110: `first-last`, `first-` (até o fim) e `-suffix` (últimos N bytes). Quando o último byte passa do tamanho do asset, ele é limitado ao último byte existente. Quando o sufixo é maior que o asset, o intervalo cobre o asset inteiro.

- **Dado** um asset de 10 bytes,
- **Quando** a requisição envia `Range: bytes=5-`,
- **Então** a resposta é 206 com `content-range: bytes 5-9/10` e corpo `56789`.
- **E** quando a requisição envia `Range: bytes=-3`, a resposta é 206 com `content-range: bytes 7-9/10` e corpo `789`.
- **E** quando a requisição envia `Range: bytes=5-100`, a resposta é 206 com `content-range: bytes 5-9/10`.
- **E** quando a requisição envia `Range: bytes=-100`, a resposta é 206 com `content-range: bytes 0-9/10` e corpo completo.

### RF-04 — HEAD com Range

Para HEAD, o servidor envia os mesmos cabeçalhos de RF-02, RF-03 e RF-05 (status, `Content-Range`, `Content-Length` do intervalo), sem corpo. HEAD usa somente `getMeta`: o corpo do asset não é lido.

- **Dado** um asset de 10 bytes,
- **Quando** a requisição HEAD envia `Range: bytes=2-5`,
- **Então** a resposta tem status 206, `content-range: bytes 2-5/10`, `content-length: 4` e corpo vazio.

### RF-05 — 416 para intervalo não satisfatível

Quando nenhum byte do intervalo existe no asset, o servidor responde 416 com `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e sem corpo. Isso acontece quando:

- `first` é maior ou igual ao tamanho do asset (`bytes=10-` em asset de 10 bytes);
- o sufixo é zero (`-0`);
- o asset tem tamanho zero, com qualquer intervalo válido.

- **Dado** um asset de 10 bytes,
- **Quando** a requisição GET envia `Range: bytes=20-30`,
- **Então** a resposta tem status 416, `content-range: bytes */10`, `content-length: 0` e corpo vazio.
- **E** quando a requisição envia `Range: bytes=-0`, a resposta também é 416.
- **E** quando a requisição envia `Range: bytes=10-` no mesmo asset, a resposta também é 416.

### RF-06 — Ignorar Range malformado, múltiplo ou de outra unidade

Quando o cabeçalho `Range` é inválido, pede mais de um intervalo, usa outra unidade que não `bytes` ou tem `first > last`, o servidor ignora o cabeçalho e responde 200 com o arquivo inteiro, sem `Content-Range`. "Inválido" inclui `first` ou sufixo não numéricos e a ausência de `-` na spec.

- **Dado** um asset de 10 bytes,
- **Quando** a requisição envia `Range: bytes=abc`, `Range: bytes=0-1,4-5`, `Range: items=0-1` ou `Range: bytes=5-2`,
- **Então** a resposta é 200 com `content-length: 10`, corpo completo e sem cabeçalho `content-range`.

### RF-07 — If-Range

Quando a requisição traz `If-Range`, o `Range` só é aplicado se o validador bater com o estado atual da representação selecionada (ver RF-11). Caso contrário, o servidor ignora o `Range` e responde 200 completo.

- Validador ETag: vale apenas comparação forte. Um ETag fraco (`W/`) em `If-Range` nunca bate, e um ETag fraco no asset também nunca bate.
- Validador de data: vale apenas se for uma HTTP-date igual, byte a byte, ao `Last-Modified` atual. Data inválida não bate.
- Se o asset não tem ETag (ou o validador citado), `If-Range` não bate e o resultado é 200 completo.
- `If-Range` sem `Range` não tem efeito: a resposta é 200 normal.

- **Dado** um asset com ETag `"abc"`,
- **Quando** a requisição envia `Range: bytes=2-5` e `If-Range: "abc"`,
- **Então** a resposta é 206.
- **E** quando a requisição envia `Range: bytes=2-5` e `If-Range: "xyz"` ou `If-Range: W/"abc"`, a resposta é 200 completo.

### RF-08 — Precedência de cache sobre Range

As regras de cache existentes continuam valendo e têm precedência sobre Range. Se `If-None-Match` ou `If-Modified-Since` indicam que o cliente já tem a versão atual, a resposta é 304, mesmo com `Range`. A avaliação de cache acontece antes de qualquer cálculo de intervalo.

- **Dado** um asset com ETag `"abc"`,
- **Quando** a requisição envia `Range: bytes=2-5` e `If-None-Match: "abc"`,
- **Então** a resposta é 304 sem corpo, como hoje.

### RF-09 — Métodos, 404 e fallthrough inalterados

Range só tem efeito em GET e HEAD. Os demais comportamentos não mudam: 405 para outros métodos (ou `fallthrough`), 404 para asset inexistente (ou `fallthrough`) e a rejeição de caminho não canônico.

- **Dado** uma requisição POST com `Range: bytes=0-1`,
- **Quando** o `serveStatic` processa a requisição,
- **Então** a resposta é 405 com `allow: GET, HEAD`, como hoje.
- **E** dado um asset inexistente com `Range: bytes=0-1`, a resposta é 404, como hoje.

### RF-10 — Asset sem tamanho conhecido

Quando `getMeta` não devolve `size`, o servidor não consegue calcular intervalos. Nesse caso, ignora `Range` e responde 200 completo, sem erro.

- **Dado** um asset cujo `getMeta` não retorna `size`,
- **Quando** a requisição envia `Range: bytes=0-1`,
- **Então** a resposta é 200 com o corpo completo.

### RF-11 — Range sobre a representação selecionada

Quando há variante pré-comprimida selecionada por `accept-encoding`, o intervalo se aplica aos bytes dessa variante. O `content-encoding` e o `content-length` da resposta referem-se a essa variante, e o `vary: accept-encoding` continua presente em 200, 206, 304 e 416. O ETag e o `Last-Modified` usados em RF-07 e RF-08 são os da variante selecionada, como já são hoje (P3).

- **Dado** um asset com variante `.gz` de 6 bytes em `meta.size`, `accept-encoding: gzip` e `Range: bytes=0-1`,
- **Quando** o `serveStatic` responde,
- **Então** a resposta é 206 com `content-range: bytes 0-1/6`, `content-length: 2`, `content-encoding: gzip` e `vary: accept-encoding`.

### RF-12 — Sem novas exportações públicas

`src/index.ts` não ganha nomes novos (valores nem tipos). As funções auxiliares (parsing de `Range`, de `If-Range` e recorte do corpo) ficam em módulo interno: `src/utils/internal/range.ts`, sem reexportação. `src/utils/static.ts` importa dele. `ServeStaticOptions` e `StaticAssetMeta` mantêm a forma atual.

- **Dado** o código após a mudança,
- **Quando** se comparam as exportações públicas com a versão anterior,
- **Então** não há diferença.

### RF-13 — Testes e qualidade

Os testes de Range são escritos com `describeMatrix`, rodando nos modos `web` e `node`. Seguindo o Bug Fix Workflow de `AGENTS.md`, os testes de regressão são escritos antes da implementação e confirmados como falhando. A suíte existente passa, e só os testes que dependem do comportamento alterado podem ser ajustados, sem perder o que verificam.

- **Dado** a implementação concluída,
- **Quando** se executa `pnpm test`,
- **Então** lint, typecheck e a suíte com cobertura passam.
- **E** `pnpm lint` passa.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Nesse caso o servidor responde 200 completo, como pede a issue.
- Unidades de Range diferentes de `bytes`.
- Mudar a assinatura de `ServeStaticOptions`, `getMeta` ou `getContents` (por exemplo, para passar offset ou intervalo ao backend).
- Aplicar Range a outros handlers (`proxy`, `h3/rules/cache`, `createEventStream`, respostas de `sendStream`).
- Geração de ETag ou `Last-Modified` quando o backend não os fornece.
- Compressão sob demanda.
- Otimização de I/O para leitura parcial de arquivos grandes, além do recorte feito no próprio `serveStatic`.
- Precondições `If-Match` e `If-Unmodified-Since`: não são alteradas. Se já são tratadas hoje, continuam sendo avaliadas antes de Range.
- Alterações em documentação pública além do que o próprio código exigir. Notas sobre custo ficam como comentário no código.

## Premissas

- **P1:** `getMeta` devolve o `size` da mesma representação que `getContents` entrega (incluindo a variante pré-comprimida, quando for o caso).
- **P2:** `getContents` devolve o asset inteiro. Sem mudar a API, o recorte para 206 é feito dentro do `serveStatic`, a partir do `BodyInit` recebido. Os tipos suportados precisam incluir pelo menos `Blob`, `ArrayBuffer`, `Uint8Array`, `string` e `ReadableStream`. Para `string`, os offsets são em bytes UTF-8, não em caracteres. Tipos fora dessa lista (por exemplo `FormData` ou `URLSearchParams`) não são recortados: o servidor ignora `Range` e responde 200 completo, sem erro.
- **P3:** O `Last-Modified` e o ETag já são definidos como hoje. A comparação de If-Range usa esses valores.
- **P4:** O cabeçalho `accept-ranges` e os demais cabeçalhos de resposta seguem o padrão atual: só são definidos quando ainda não existem, para respeitar `options.headers`.

## Riscos

- **R1 — Custo do recorte sem offset (alto).** `getContents` não recebe intervalo, então um `ReadableStream` precisa ser lido e descartado até o início do intervalo. Para arquivos grandes, isso gasta CPU e I/O. Mitigações: usar `Blob.slice` quando o corpo for `Blob`; para streams, cancelar o leitor assim que o último byte do intervalo for emitido, sem ler até o fim; registrar o custo em comentário no código. Uma API com offset seria mudança pública e fica fora de escopo.
- **R2 — Cache intermediário e variantes comprimidas.** A representação depende de `accept-encoding`, e o intervalo é aplicado sobre ela. Um cache intermediário pode guardar 206 de uma variante e servi-lo a um cliente que pediu outra. Mitigação: `vary: accept-encoding` deve estar presente em 206 e 416, como já está em 200 (ver RF-11).
- **R3 — Regressão em testes existentes.** Testes que verificam HEAD, `content-length` ou ausência de `accept-ranges` podem falhar. Mitigação: ajustar somente os testes afetados, mantendo o que eles verificam.
- **R4 — Ambiguidade de RFC.** Algumas combinações (por exemplo, `first > last`, `-0` e sufixo maior que o asset) têm regras sutis na RFC 9110. Os critérios de RF-03, RF-05 e RF-06 fixam o comportamento escolhido. Qualquer mudança nessas regras deve atualizar o PRD.

## Definição de pronto

- Todos os cenários de RF-01 a RF-11 têm teste com `describeMatrix`, nos modos `web` e `node`.
- `pnpm test` e `pnpm lint` passam.
- `src/index.ts` não tem diff de exportações.
- Nenhum arquivo de `src/` passa de 200 linhas por causa desta mudança; se passar, a lógica já está em `src/utils/internal/range.ts`.
