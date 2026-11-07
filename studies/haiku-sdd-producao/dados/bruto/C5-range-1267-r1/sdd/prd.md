# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e contrato em `sdd/pedido.md`.
Status: rascunho.

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Mesmo quando o cliente pede um trecho, o servidor responde com o arquivo inteiro, sem `206 Partial Content` e sem `Content-Range`. Na prática:

- downloads grandes não podem ser retomados;
- players de vídeo e áudio não conseguem avançar (seek) porque o navegador depende de respostas parciais;
- CDNs e proxies não recebem a sinalização de intervalo que esperam.

**Objetivo:** fazer o `serveStatic` atender pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5, 13.2.2 e 14), sem alterar a API pública, sem quebrar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

O pedido original cita a RFC 7233. Ela foi substituída pela RFC 9110, que é a norma adotada aqui.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` deve informar `Accept-Ranges: bytes` em toda resposta de asset encontrado (200, 206 e 416).

**Dado** um asset existente servido pelo `serveStatic`
**Quando** o cliente faz `GET` sem cabeçalho `Range`
**Então** a resposta 200 contém `Accept-Ranges: bytes` e o corpo completo.

### RF-02 — Responder 206 para um intervalo válido

Quando o `Range` tiver uma única faixa válida na unidade `bytes` (`bytes=a-b`, `bytes=a-` ou sufixo `bytes=-n`), o servidor deve responder `206 Partial Content` apenas com os bytes pedidos, com `Content-Range: bytes a-b/tamanho` e `Content-Length` igual ao número de bytes enviados. Se `b` ultrapassar o fim do arquivo, o fim é ajustado para `tamanho - 1`. Sufixo maior que o arquivo devolve o arquivo inteiro como 206.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=2-5`
**Então** a resposta é `206`, com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo com os bytes 2 a 5.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=-3`
**Então** a resposta é `206`, com `Content-Range: bytes 7-9/10` e `Content-Length: 3`.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=6-99`
**Então** a resposta é `206`, com `Content-Range: bytes 6-9/10` e `Content-Length: 4`.

### RF-03 — Ignorar Range malformado ou com várias faixas

Cabeçalho `Range` malformado, unidade diferente de `bytes` ou com mais de uma faixa deve ser ignorado. O servidor responde 200 com o arquivo completo, como hoje.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=0-1,4-5`
**Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: items=0-1` ou `Range: bytes=abc`
**Então** a resposta é `200` com o corpo completo.

### RF-04 — Responder 416 para intervalo não satisfazível

Quando o intervalo for sintaticamente válido, mas não houver nenhum byte a servir (início além do fim do arquivo, ou sufixo `bytes=-0`), o servidor responde `416 Range Not Satisfiable` com `Content-Range: bytes */tamanho` e `Content-Length: 0`.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `Range: bytes=10-20`
**Então** a resposta é `416`, com `Content-Range: bytes */10`, `Content-Length: 0` e sem corpo.

### RF-05 — HEAD com Range

Para `HEAD`, a resposta deve ter os mesmos status e cabeçalhos que o `GET` faria com o mesmo `Range` (206, 416 ou 200), mas sem corpo.

**Dado** um asset de 10 bytes
**Quando** o cliente envia `HEAD` com `Range: bytes=2-5`
**Então** a resposta é `206`, com `Content-Range: bytes 2-5/10` e `Content-Length: 4`, sem corpo.

### RF-06 — Ignorar Range quando o tamanho não é conhecido

Se `getMeta` não devolver `size` positivo, o `Range` é ignorado e o servidor responde 200 completo. `Accept-Ranges: bytes` continua presente, conforme o RF-01.

**Dado** um asset cujo `getMeta` não informa `size`
**Quando** o cliente envia `Range: bytes=0-3`
**Então** a resposta é `200` com o corpo completo.

### RF-07 — Respeitar If-Range

Quando o cabeçalho `If-Range` estiver presente, o `Range` só é atendido se o validador casar com o recurso atual: ETag forte igual ao `etag` do asset, ou data igual ao `last-modified`. Se não casar, o `Range` é ignorado e o servidor responde 200 completo.

**Dado** um asset com `etag` `"v1"`
**Quando** o cliente envia `Range: bytes=0-3` e `If-Range: "v1"`
**Então** a resposta é `206` com os 4 primeiros bytes.

**Dado** um asset com `etag` `"v2"`
**Quando** o cliente envia `Range: bytes=0-3` e `If-Range: "v1"`
**Então** a resposta é `200` com o corpo completo.

### RF-08 — Precedência de condicionais sobre Range

Cabeçalhos condicionais (`If-None-Match`, `If-Modified-Since`) são avaliados antes de `Range`. Se derem 304, o 304 prevalece e nenhum intervalo é atendido.

**Dado** um asset com `etag` `"v1"`
**Quando** o cliente envia `If-None-Match: "v1"` e `Range: bytes=0-3`
**Então** a resposta é `304` sem corpo, como hoje.

### RF-09 — Range com encoding pré-comprimido

Quando o `serveStatic` servir uma variante pré-comprimida (por exemplo `app.js.gz`), o intervalo se aplica aos bytes dessa variante, que é a representação escolhida. O `Content-Length` e o `Content-Range` usam o tamanho da variante.

**Dado** um asset com variante `.gz` de 50 bytes e um cliente que aceita `gzip`
**Quando** o cliente envia `Range: bytes=0-9`
**Então** a resposta é `206`, com `Content-Encoding: gzip`, `Content-Range: bytes 0-9/50` e 10 bytes no corpo.

### RF-10 — Preservar comportamentos existentes

Cache (304), seleção de encoding, `fallthrough`, 404 para asset inexistente e 405 para método não permitido continuam iguais quando não há `Range`. Com `fallthrough: true` e asset inexistente, o `Range` não altera o retorno.

**Dado** um asset inexistente e `fallthrough: true`
**Quando** o cliente envia `GET` com `Range: bytes=0-3`
**Então** o `serveStatic` não responde e a requisição segue para o próximo handler.

**Dado** um `POST` em uma rota de estáticos com `Range` presente
**Quando** a requisição chega ao `serveStatic`
**Então** a resposta é `405` com `Allow: GET, HEAD`, como hoje.

### RF-11 — Sem novas exportações públicas

A mudança não adiciona nomes públicos. `src/index.ts` não ganha valores nem tipos, e as funções auxiliares ficam privadas no módulo `static.ts`. Não há novas opções em `ServeStaticOptions`.

**Dado** o código após a mudança
**Quando** se compara a lista de exports de `src/index.ts` com a versão anterior
**Então** a lista é idêntica.

### RF-12 — Cobertura de testes

Os casos dos RF-01 a RF-10 têm testes em `test/static.test.ts`, executados nos modos `web` e `node` quando possível. Os testes existentes continuam passando. Se algum teste existente depender do comportamento antigo de `Range`, ele é ajustado sem perder o que verifica.

**Dado** a suíte após a mudança
**Quando** se executa `pnpm vitest run test/static.test.ts` e `pnpm lint` e `pnpm typecheck`
**Então** todos os testes e verificações passam.

## Fora de escopo

- Múltiplas faixas em um único `Range` (`multipart/byteranges`). Pedidos assim são ignorados (RF-03).
- Outras unidades de Range além de `bytes`.
- Novas opções em `ServeStaticOptions` ou novas funções exportadas.
- Mudança nas assinaturas de `getMeta` e `getContents`.
- Range em outros utilitários (`proxy`, `h3/rules/cache`, `sendStream` ou similares).
- Cache de intervalos ou ajustes de `Cache-Control` específicos para respostas parciais.
- Otimização de I/O para leitura parcial de arquivos grandes em disco. Esta entrega só garante a resposta correta.
- Mudanças na documentação pública além dos comentários do próprio módulo.

## Premissas e riscos

### Premissas

- `getContents` devolve o conteúdo completo (`BodyInit`) e não recebe o intervalo. O recorte precisa ser feito pelo `serveStatic`, então a implementação deve tratar os tipos de `BodyInit` que aparecem em uso (string, `ArrayBuffer`/`TypedArray`, `Blob`, `ReadableStream`).
- `meta.size`, quando informado, é o tamanho real do conteúdo devolvido por `getContents` para a mesma variante.
- Tamanho `0` é tratado como desconhecido, como no código atual (`meta.size > 0`). Um arquivo vazio, portanto, responde 200 para qualquer `Range`. Esta é uma escolha de compatibilidade, não de RFC.
- O `etag` e o `last-modified` do asset são os validadores usados por `If-Range`.

### Riscos

- **Memória e desempenho:** se `getContents` devolver um `ReadableStream`, pular bytes sem carregar o arquivo inteiro exige cuidado. Um recorte ingênuo pode ler o arquivo todo a cada requisição de vídeo. Isso pode ser pior que o comportamento atual em arquivos grandes.
- **Tamanho divergente:** se `meta.size` não bater com o conteúdo real, o `Content-Length` e o `Content-Range` ficam errados. Resultado: clientes que retomam downloads recebem dados corrompidos.
- **Conflito com testes existentes:** testes que esperam 200 para qualquer requisição com `Range` podem falhar. A regra é ajustar só o que depende do comportamento antigo.
- **Interação com `Content-Length` já definido:** o código atual define `content-length` antes do ramo de `HEAD`. A implementação precisa substituir esse valor quando houver 206 ou 416, sem deixar cabeçalho duplicado.
- **Ambiguidade de RFC:** a issue cita a RFC 7233 e o contrato cita a RFC 9110. Se houver divergência de comportamento entre as duas, vale a 9110.
- **Escopo do `If-Range` com data:** comparar `If-Range` com data exige interpretar a data HTTP com precisão de segundos, igual ao que já é feito para `last-modified`. Erro aqui faz o cliente receber 200 em vez de 206, o que é seguro mas ineficiente.
