# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e contrato em `sdd/pedido.md`.

## Problema e objetivo

Hoje o `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD recebe o arquivo inteiro com `200`, sem `Accept-Ranges`, sem `Content-Range` e sem resposta parcial. Na prática isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players, que enviam `Range` automaticamente;
- que CDNs e proxies façam cache e encaminhamento corretos de partes do arquivo.

**Objetivo:** fazer o `serveStatic` atender requisições de intervalo de bytes de acordo com a RFC 9110 (seções 13.1.5 e 14), com uma única faixa de bytes, sem alterar a API pública e sem regredir o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a Range

O `serveStatic` deve informar que aceita intervalos de bytes em toda resposta de asset que ele serve.

**Dado** uma requisição GET ou HEAD para um asset existente,
**Quando** o `serveStatic` responder com `200` ou `206`,
**Então** a resposta deve conter o cabeçalho `Accept-Ranges: bytes`.

### RF-02 — Resposta parcial para um intervalo válido

Para uma única faixa válida, o `serveStatic` deve responder com `206 Partial Content`, enviar apenas os bytes pedidos e informar o intervalo e o tamanho corretos.

**Dado** um asset de 1000 bytes com `size` informado por `getMeta`,
**Quando** a requisição GET tiver `Range: bytes=0-99`,
**Então** a resposta deve ter status `206`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo com exatamente os bytes 0 a 99 do arquivo.

### RF-03 — Formas de faixa de início aberto e sufixo

Além de `início-fim`, o `serveStatic` deve aceitar as duas outras formas de uma faixa única: `início-` (até o fim do arquivo) e `-N` (os últimos N bytes).

**Dado** um asset de 1000 bytes,
**Quando** a requisição tiver `Range: bytes=900-`,
**Então** a resposta deve ser `206` com `Content-Range: bytes 900-999/1000` e `Content-Length: 100`.

**Dado** o mesmo asset,
**Quando** a requisição tiver `Range: bytes=-200`,
**Então** a resposta deve ser `206` com `Content-Range: bytes 800-999/1000` e `Content-Length: 200`.

### RF-04 — Fim do intervalo acima do tamanho

Quando o fim pedido ultrapassar o tamanho do arquivo, o fim deve ser limitado ao último byte.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tiver `Range: bytes=500-9999`,
**Então** a resposta deve ser `206` com `Content-Range: bytes 500-999/1000` e `Content-Length: 500`.

### RF-05 — Requisição HEAD com Range

Para HEAD, o `serveStatic` deve responder com os mesmos cabeçalhos do GET com Range, sem corpo.

**Dado** um asset de 1000 bytes,
**Quando** a requisição HEAD tiver `Range: bytes=0-99`,
**Então** a resposta deve ser `206` com `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio.

### RF-06 — Intervalo não satisfazível

Quando o intervalo não puder ser atendido, o `serveStatic` deve responder com `416 Range Not Satisfiable`.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tiver `Range: bytes=1000-1100` (início fora do arquivo), ou `Range: bytes=-0`, ou `Range: bytes=5-2` (início maior que o fim),
**Então** a resposta deve ser `416`, com `Content-Range: bytes */1000` e `Content-Length: 0`.

### RF-07 — Cabeçalho Range malformado ou com múltiplas faixas

Quando o cabeçalho `Range` for malformado, usar outra unidade que não `bytes`, ou tiver mais de uma faixa, o `serveStatic` deve ignorá-lo e servir o arquivo inteiro.

**Dado** um asset de 1000 bytes,
**Quando** a requisição tiver `Range: bytes=0-10,20-30`, ou `Range: items=0-10`, ou `Range: bytes=abc`,
**Então** a resposta deve ser `200` com o arquivo inteiro, `Content-Length: 1000` e sem `Content-Range`.

### RF-08 — If-Range

Quando a requisição trouxer `If-Range` e ele não corresponder ao estado atual do asset, o `serveStatic` deve ignorar o `Range` e servir o arquivo inteiro. A comparação segue a RFC 9110, seção 13.1.5: `If-Range` com ETag exige ETag forte e igual; `If-Range` com data exige igualdade exata com o `Last-Modified`.

**Dado** um asset cujo ETag atual é `"abc"`,
**Quando** a requisição tiver `Range: bytes=0-99` e `If-Range: "xyz"`,
**Então** a resposta deve ser `200` com o arquivo inteiro.

**Dado** o mesmo asset,
**Quando** a requisição tiver `Range: bytes=0-99` e `If-Range: "abc"`,
**Então** a resposta deve ser `206` com os bytes 0 a 99.

### RF-09 — Asset sem tamanho conhecido

Quando `getMeta` não informar `size` (ausente ou zero), o `serveStatic` não consegue calcular intervalos. Nesse caso deve ignorar o `Range` e servir o arquivo inteiro com `200`, sem `Accept-Ranges`.

**Dado** um asset cujo `getMeta` não retorna `size`,
**Quando** a requisição tiver `Range: bytes=0-99`,
**Então** a resposta deve ser `200` com o arquivo inteiro.

### RF-10 — Precedência de 304 e de 405, 404 e fallthrough

A validação de cache (`If-None-Match`, `If-Modified-Since`) continua tendo precedência sobre `Range`, como manda a RFC 9110. Os caminhos de 404, 405 e `fallthrough` não podem mudar.

**Dado** um asset cujo ETag atual é `"abc"`,
**Quando** a requisição tiver `If-None-Match: "abc"` e `Range: bytes=0-99`,
**Então** a resposta deve ser `304`, como hoje.

**Dado** uma requisição POST para um asset,
**Quando** o `serveStatic` processar a requisição,
**Então** a resposta deve ser `405` com `Allow: GET, HEAD`, como hoje, independentemente de `Range`.

**Dado** um asset inexistente com `fallthrough: true`,
**Quando** a requisição tiver `Range: bytes=0-99`,
**Então** o `serveStatic` deve retornar `undefined`, como hoje.

### RF-11 — Compatibilidade com encoding pré-comprimido

A seleção de variante (`encodings`, `Accept-Encoding`) e o `Vary` continuam iguais. Para variantes com `Content-Encoding`, o `Range` é ignorado e o arquivo inteiro é servido com `200`. Isso evita entregar bytes parciais de um corpo comprimido, que o cliente não consegue descomprimir.

**Dado** um asset com variante `.gz` escolhida pelo `Accept-Encoding: gzip`,
**Quando** a requisição tiver `Range: bytes=0-99`,
**Então** a resposta deve ser `200` com a variante `gzip` completa, `Content-Encoding: gzip` e sem `Content-Range`.

### RF-12 — Nenhuma exportação pública nova

As funções auxiliares ficam privadas em `src/utils/static.ts`. Nenhum nome novo (valor ou tipo) é exportado por `src/index.ts`, e nenhuma opção nova é adicionada a `ServeStaticOptions`.

**Dado** a versão atual de `src/index.ts`,
**Quando** a mudança for concluída,
**Então** o conjunto de exports públicos deve ser idêntico ao anterior.

### RF-13 — Testes em ambos os runtimes

O comportamento novo deve ser coberto por testes com `describeMatrix`, que rodam em `web` e em `node`. Os testes existentes devem continuar passando. Só podem ser ajustados se dependerem diretamente do ignorar `Range`, e sem perder o que verificam.

**Dado** a suíte de testes do projeto,
**Quando** `pnpm vitest run` for executado,
**Então** todos os testes devem passar nos dois runtimes.

## Fora de escopo

- Múltiplas faixas e resposta `multipart/byteranges`.
- Range para respostas com `Content-Encoding` (tratado em RF-11 como ignorado, não como suportado).
- Range para outros handlers além do `serveStatic` (por exemplo `proxy`, `h3/rules/cache` ou `ocache`).
- Cache de respostas parciais e lógica de `Vary` além do que já existe.
- Novas opções em `ServeStaticOptions` ou mudanças na assinatura de `getMeta` e `getContents`.
- Unidades de Range diferentes de `bytes`.
- Documentação de migração do RFC 7233 para o RFC 9110 além da menção no contrato.

## Premissas e riscos

**Premissas**

- `getMeta` é a única fonte do tamanho do asset (`size`). O `serveStatic` não consulta o disco nem o backend para descobrir o tamanho.
- `getContents` não recebe intervalo. Por isso o `serveStatic` precisa fatiar o conteúdo que recebe. Assume-se que o `BodyInit` retornado pode ser fatiado sem carregar tudo na memória, ou que o custo é aceitável para o uso pretendido.
- Faixas de início aberto e de sufixo (RF-03) fazem parte de "uma única faixa", já que são formas de faixa única na RFC 9110. Se o time preferir apenas `início-fim`, o RF-03 deve ser removido.
- O ETag de `getMeta` é tratado como forte quando não tiver prefixo `W/`. ETags fracos nunca correspondem a `If-Range`.

**Riscos**

- **Memória e desempenho:** fatiar um `BodyInit` grande pode carregar o arquivo inteiro na memória. Para arquivos grandes, a implementação deve preferir fatiamento por stream ou `Blob.slice`, a depender do tipo que `getContents` devolve. A escolha fica para a implementação, mas precisa ser verificada nos dois runtimes.
- **Diferença entre runtimes:** `Blob.slice`, streams e `Buffer` se comportam de forma diferente em Node e na web. Os testes em `describeMatrix` devem cobrir isso.
- **Regressão de cabeçalhos:** a lógica nova mexe em `content-length`, que hoje é definido antes de HEAD e GET. Um erro aqui pode quebrar respostas 200 existentes. Os testes atuais devem ser a primeira barreira.
- **Interação com `headers` customizados:** se o usuário passar `content-length` em `options.headers`, a resposta parcial pode ficar inconsistente. Como o código atual já não sobrescreve `content-length`, o comportamento deve ser documentado e testado.
- **Itens fora da RFC que os clientes podem esperar:** alguns clientes enviam `Range` em respostas que não são 200 nem 206. O risco é baixo, mas as respostas de erro devem seguir RF-06 e RF-10.
