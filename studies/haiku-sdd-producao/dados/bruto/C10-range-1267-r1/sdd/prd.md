# PRD: HTTP Range em `serveStatic`

Referências: issue h3js/h3#1267 e contrato enxuto em `sdd/pedido.md`. Norma: RFC 9110, §13.1.5 (If-Range) e §14 (Range Requests). A issue cita a RFC 7233, substituída pela RFC 9110; este PRD segue a 9110.

## Problema e objetivo

**Problema.** `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD recebe 200 com o corpo completo, e a resposta não anuncia `Accept-Ranges`. Por isso:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek);
- proxies e CDNs não conseguem servir nem cachear trechos do arquivo.

**Objetivo.** Responder a um intervalo único de bytes em GET e HEAD com `206 Partial Content` ou `416 Range Not Satisfiable`, conforme a RFC 9110. Cache, seleção de encoding, `fallthrough`, respostas 404 e 405 e a API pública continuam como hoje.

**Critérios de sucesso do projeto**

- Um `Range` válido em asset existente devolve 206 com exatamente os bytes pedidos.
- `pnpm lint`, `pnpm typecheck` e a suíte existente passam.
- Os testes novos rodam nos modos `web` e `node` da matriz de testes.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

Toda resposta de asset encontrado (200, 206, 304 e 416) inclui `Accept-Ranges: bytes`.

**Dado** um asset existente de 1000 bytes servido por `serveStatic`
**Quando** o cliente faz GET sem cabeçalho `Range`
**Então** a resposta 200 traz `Accept-Ranges: bytes` e o corpo completo, sem `Content-Range`.

### RF-02 — Ignorar Range que não se aplica

Quando o `Range` é inválido ou não pode ser atendido como intervalo único, `serveStatic` ignora o cabeçalho e responde 200 com o corpo completo. Isso vale para:

- unidade diferente de `bytes` (ex.: `items=0-9`);
- sintaxe inválida (ex.: `bytes=abc`, `bytes=5-2`);
- mais de um intervalo (ex.: `bytes=0-1,3-4`);
- tamanho do asset desconhecido (`getMeta` não devolve `size`).

**Dado** um asset existente de 1000 bytes
**Quando** o cliente envia `Range: bytes=5-2`
**Então** a resposta é 200 com o corpo completo, `Content-Length: 1000` e sem `Content-Range`.

### RF-03 — Intervalo válido responde 206

Para um intervalo único satisfazível, a resposta é 206 com o trecho pedido.

- `Content-Range: bytes <início>-<fim>/<tamanho>`
- `Content-Length` igual ao número de bytes do trecho. Sobrepõe qualquer `Content-Length` definido em `options.headers`.
- O corpo contém exatamente os bytes de `<início>` a `<fim>`, inclusive.

**Dado** um asset existente de 1000 bytes
**Quando** o cliente envia `Range: bytes=100-199`
**Então** a resposta é 206 com `Content-Range: bytes 100-199/1000`, `Content-Length: 100` e corpo igual aos bytes 100 a 199 do arquivo.

### RF-04 — Intervalos abertos e sufixos

`serveStatic` aceita três formas de intervalo único e normaliza o fim para `tamanho - 1` quando ele passa do tamanho do arquivo.

- `bytes=a-b`: do byte `a` ao `b`. Se `b` ≥ tamanho, o fim vira `tamanho - 1`.
- `bytes=a-`: do byte `a` até o fim.
- `bytes=-n`: os últimos `n` bytes. Se `n` ≥ tamanho, o trecho é o arquivo inteiro.

**Dado** um asset existente de 1000 bytes
**Quando** o cliente envia `Range: bytes=-50`, depois `bytes=900-` e depois `bytes=500-5000`
**Então** as três respostas são 206 com `Content-Range` igual a `bytes 950-999/1000`, `bytes 900-999/1000` e `bytes 500-999/1000`, nessa ordem.

### RF-05 — Intervalo não satisfazível responde 416

Quando o intervalo único é válido na sintaxe, mas não cabe no arquivo, a resposta é 416 sem corpo. Isso inclui: início ≥ tamanho, sufixo `bytes=-0`, e qualquer intervalo em asset de tamanho 0.

- `Content-Range: bytes */<tamanho>`
- `Content-Length: 0`
- sem corpo

**Dado** um asset existente de 1000 bytes
**Quando** o cliente envia `Range: bytes=1000-1100` ou `Range: bytes=-0`
**Então** a resposta é 416 com `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-06 — HEAD com Range

Em HEAD, `serveStatic` responde com os mesmos cabeçalhos de 206 (ou 416) do GET, sem corpo. `getContents` não é chamado.

**Dado** um asset existente de 1000 bytes
**Quando** o cliente envia HEAD com `Range: bytes=100-199`
**Então** a resposta é 206 com `Content-Range: bytes 100-199/1000` e `Content-Length: 100`, sem corpo, e `getContents` não é invocado.

### RF-07 — If-Range

Quando a requisição tem `If-Range` junto com `Range`, o intervalo só é honrado se o validador bater com a versão atual do asset.

- Validador ETag: honrado somente se for forte (sem `W/`) e igual ao ETag do asset. Qualquer outro caso ignora `Range`.
- Validador de data: honrado somente se for igual ao `Last-Modified` do asset. Sem `Last-Modified`, ignora `Range`.
- Quando `Range` é ignorado, a resposta é 200 completo, como no RF-02.

**Dado** um asset existente com ETag `"abc"` de 1000 bytes
**Quando** o cliente envia `Range: bytes=0-9` com `If-Range: "xyz"`, e depois com `If-Range: "abc"`
**Então** a primeira resposta é 200 completo sem `Content-Range`, e a segunda é 206 com `Content-Range: bytes 0-9/1000`.

### RF-08 — Precedência do cache sobre Range

Se a requisição já resulta em 304 pelas regras atuais (`If-None-Match` ou `If-Modified-Since`), a resposta é 304 mesmo com `Range`. O `Range` só é avaliado quando não há 304.

**Dado** um asset existente com ETag `"abc"`
**Quando** o cliente envia `If-None-Match: "abc"` e `Range: bytes=0-9`
**Então** a resposta é 304 sem corpo e sem `Content-Range`.

### RF-09 — Variante pré-comprimida

Quando `serveStatic` escolhe uma variante com `Content-Encoding` (ex.: `app.js.br`), o intervalo é aplicado aos bytes dessa variante. O tamanho usado é o que `getMeta` devolve para o id escolhido, e `Content-Range` reflete esses bytes.

**Dado** `encodings: { br: ".br" }`, um arquivo `app.js.br` de 500 bytes e um `app.js` de 1000 bytes
**Quando** o cliente envia `Accept-Encoding: br` e `Range: bytes=0-9`
**Então** a resposta é 206 com `Content-Encoding: br`, `Content-Range: bytes 0-9/500` e `Content-Length: 10`.

### RF-10 — Preservar comportamento existente

Cache, negociação de encoding, `fallthrough`, 404 para asset inexistente, 405 para método diferente de GET e HEAD, e a rejeição de caminho não canônico continuam iguais aos de hoje, inclusive quando a requisição traz `Range`.

**Dado** um POST para um asset existente, ou um GET para um asset inexistente, ambos com `Range: bytes=0-9`
**Quando** `serveStatic` processa a requisição
**Então** o POST recebe 405 com `Allow: GET, HEAD`, o GET recebe 404 (ou `undefined` com `fallthrough`), e nenhuma das respostas traz `Content-Range` ou `Accept-Ranges`.

### RF-11 — Sem exports públicos novos

A mudança não adiciona nome algum (valor ou tipo) ao entry point público. Helpers ficam privados ao módulo `src/utils/static.ts`. `ServeStaticOptions` não ganha opções.

**Dado** a lista de exports de `src/index.ts` e dos entry points do pacote antes e depois da mudança
**Quando** as duas listas são comparadas
**Então** são idênticas.

### RF-12 — Corpo correto para cada tipo de conteúdo

`getContents` pode devolver string, `Uint8Array`/`ArrayBuffer`, `Blob` ou `ReadableStream`. Para 206, o corpo tem exatamente os bytes do intervalo, qualquer que seja o tipo.

**Dado** um `getContents` que devolve um `ReadableStream` com 1000 bytes
**Quando** o cliente envia `Range: bytes=100-199`
**Então** o corpo da resposta tem 100 bytes, iguais aos bytes 100 a 199 do conteúdo original. O mesmo vale para os demais tipos.

### RF-13 — Cobertura de testes

Os casos dos RF-01 a RF-12 têm teste automatizado em `test/static.test.ts` (ou arquivo irmão), escrito com `describeMatrix` para rodar nos modos `web` e `node`.

**Dado** a branch com a mudança
**Quando** `pnpm vitest run test/static.test.ts` e `pnpm lint` e `pnpm typecheck` são executados
**Então** todos os casos novos e existentes passam nos dois modos, e lint e typecheck não reportam erro.

## Fora de escopo

- `If-Match` e `If-Unmodified-Since` (respostas 412). Hoje o `serveStatic` não os avalia, e tratá-los é outro trabalho.
- Múltiplos intervalos (`multipart/byteranges`). Ficam ignorados e respondem 200, como pede a issue.
- Mudança em `getMeta`/`getContents` ou nova opção para pedir o intervalo direto ao backend.
- Alterações em `h3/rules/cache`, `ocache` e `h3/rules/proxy`. Range passa por eles como hoje.
- Compressão sob demanda para respostas com Range.
- Atualização de documentação além do changelog. Revisão da documentação fica para depois.

## Premissas

- **P1.** O `size` devolvido por `getMeta` é o tamanho real do conteúdo servido, incluindo a variante pré-comprimida quando houver. Se o backend mentir sobre o tamanho, o resultado é erro do backend.
- **P2.** `getContents` devolve a representação completa. Como a API pública não muda, `serveStatic` fatia o conteúdo internamente.
- **P3.** A RFC 9110 vale no lugar da RFC 7233 citada na issue.
- **P4.** Em 206, o `Content-Length` do trecho sobrepõe o `Content-Length` de `options.headers`. Um tamanho errado seria pior que a sobreposição.
- **P5.** `Accept-Ranges` é anunciado mesmo quando o `Range` vai ser ignorado.

## Riscos

- **R1 — Custo em streams.** Fatiar um `ReadableStream` exige ler e descartar o prefixo. Em arquivos grandes, um seek para o fim custa o tamanho do arquivo em leitura. Aceito nesta entrega. Otimizar exige API nova, que está fora de escopo.
- **R2 — Mudança de comportamento.** Um cliente que enviava `Range` e recebia 200 passa a receber 206. Só acontece com `Range` válido, mas deve constar no changelog.
- **R3 — Validador de data simplificado.** O `If-Range` com data compara igualdade exata com `Last-Modified`. Não aplica a regra de validador forte da RFC 9110 §8.8.2.2 (o `Last-Modified` precisa ser pelo menos 1 segundo anterior ao `Date`). Caso raro: o arquivo muda no mesmo segundo, e o cliente recebe 206 de versão errada. Preferir ETag mitiga o risco.
- **R4 — Content-Length sobreposto.** Quem define `Content-Length` em `options.headers` verá o valor trocado em 206. Documentar no changelog.
- **R5 — Testes de rules.** `test/rules/cache.test.ts` cobre `Range` no handler de cache de rules, não no `serveStatic`. Deve seguir passando sem edição. Se precisar mudar, a mudança é sinal de que o escopo vazou.
