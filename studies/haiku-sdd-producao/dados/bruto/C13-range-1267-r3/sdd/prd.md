# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando o cliente pede um intervalo de bytes, o servidor devolve o arquivo inteiro com `200`, sem os cabeçalhos de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em navegadores e players;
- o comportamento correto de CDNs e proxies.

**Objetivo:** fazer o `serveStatic` atender a requisições de intervalo de byte único para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 e 14), sem mudar a API pública e sem quebrar o comportamento atual.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

O `serveStatic` envia `Accept-Ranges: bytes` nas respostas `200`, `206` e `416` de `GET` e `HEAD`.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`,
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`,
- **Então** a resposta `200` contém `Accept-Ranges: bytes`.

### RF-02 — Responder `206` a intervalo único válido

Para um intervalo único válido (`bytes=a-b`), o servidor responde `206 Partial Content` com o trecho pedido.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente faz `GET` com `Range: bytes=2-5`,
- **Então** a resposta tem status `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo com os bytes de 2 a 5.

### RF-03 — Suportar intervalos abertos e sufixos

Além de `bytes=a-b`, o servidor aceita `bytes=a-` (do byte `a` até o fim) e `bytes=-n` (os últimos `n` bytes). Se `b` passa do fim, usa o último byte. Se `n` é maior que o tamanho, serve o arquivo inteiro como intervalo.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente envia `Range: bytes=7-` ou `Range: bytes=-3`,
- **Então** a resposta é `206` com `Content-Range: bytes 7-9/10` e corpo com 3 bytes (os dois formatos dão o mesmo resultado).

- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=8-100`,
- **Então** a resposta é `206` com `Content-Range: bytes 8-9/10`.

### RF-04 — `HEAD` com intervalo

Em `HEAD`, a resposta de intervalo válido traz os mesmos cabeçalhos de `206` (`Content-Range`, `Content-Length` do trecho), mas sem corpo.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`,
- **Então** a resposta tem status `206`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio.

### RF-05 — Responder `416` a intervalo não satisfazível

Se o intervalo começa depois do fim do arquivo, ou é um sufixo de zero bytes, a resposta é `416 Range Not Satisfiable` com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`, sem corpo.

**Critério de aceite**

- **Dado** um asset de 10 bytes,
- **Quando** o cliente faz `GET` com `Range: bytes=10-20`,
- **Então** a resposta tem status `416`, `Content-Range: bytes */10` e `Content-Length: 0`.

### RF-06 — Ignorar `Range` que não se aplica

Quando o `Range` está malformado, usa outra unidade que não `bytes`, ou traz mais de um intervalo, o servidor ignora o cabeçalho e responde `200` com o arquivo inteiro.

**Critério de aceite**

- **Dado** um asset existente,
- **Quando** o cliente envia `Range: bytes=0-1,4-5`, `Range: items=0-1` ou `Range: bytes=abc`,
- **Então** a resposta é `200` com o arquivo inteiro e sem `Content-Range`.

### RF-07 — Respeitar `If-Range`

Se o cabeçalho `If-Range` está presente e não corresponde ao validador atual do asset (ETag forte ou `Last-Modified`), o servidor ignora `Range` e responde `200` com o arquivo inteiro. Se corresponde, aplica o intervalo normalmente.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "xyz"`,
- **Então** a resposta é `200` com o arquivo inteiro.
- **Dado** o mesmo asset,
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "abc"`,
- **Então** a resposta é `206` com `Content-Range: bytes 0-3/<tamanho>`.

### RF-08 — Condicionais têm precedência sobre `Range`

A avaliação de `If-None-Match` e `If-Modified-Since` continua acontecendo antes de `Range`. Se o resultado for `304`, o servidor responde `304` mesmo com `Range`.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`,
- **Quando** o cliente envia `If-None-Match: "abc"` junto com `Range: bytes=0-3`,
- **Então** a resposta é `304` sem corpo.

### RF-09 — Tamanho desconhecido

Se `getMeta` não devolve `size`, o servidor ignora `Range` e responde `200`, como pede a issue ("when the asset size is known").

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não devolve `size`,
- **Quando** o cliente envia `Range: bytes=0-3`,
- **Então** a resposta é `200` com o arquivo inteiro e sem `Content-Range`.

### RF-10 — Preservar o comportamento existente

Cache (`304`), seleção de encoding (`encodings`, `Vary`, `Content-Encoding`), `fallthrough`, resposta `404` para asset inexistente e `405` para método não permitido continuam iguais quando não há `Range`.

**Critério de aceite**

- **Dado** um asset inexistente,
- **Quando** o cliente faz `GET` com `Range: bytes=0-3` e `fallthrough` está desligado,
- **Então** a resposta é `404`, igual ao comportamento atual.
- **Dado** um `POST` em uma rota de `serveStatic`,
- **Quando** o cliente envia `Range`,
- **Então** a resposta é `405` com `Allow: GET, HEAD`, igual ao comportamento atual.

### RF-11 — Sem novas exportações públicas

`src/index.ts` não ganha nomes novos (valores nem tipos). As funções auxiliares ficam privadas no módulo `static.ts`. As opções `ServeStaticOptions` não mudam.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** se compara a lista de exportações de `src/index.ts` com a versão anterior,
- **Então** a lista é idêntica.

## Fora de escopo

- Múltiplos intervalos (`multipart/byteranges`). Esses pedidos recebem `200` com o arquivo inteiro (RF-06).
- Novas opções em `ServeStaticOptions` (por exemplo, um parâmetro de offset para `getContents`).
- Mudanças em `getContents` ou `getMeta` para suportar leitura parcial nativa.
- Suporte a `Range` em métodos que não sejam `GET` e `HEAD`.
- Validação de `If-Match` e `If-Unmodified-Since`.
- Otimização de desempenho para arquivos muito grandes (ver riscos).
- Mudanças em `proxy`, `h3/rules` ou em outros utilitários.

## Premissas

1. A issue e o contrato em `sdd/pedido.md` são a referência. Onde a issue cita a RFC 7233, vale a RFC 9110, que a substitui.
2. O `size` devolvido por `getMeta` é o tamanho da variante escolhida (com encoding, se houver), e é o tamanho que o `Content-Length` atual já usa.
3. `getContents` devolve o corpo completo, sem opção de offset. O recorte do intervalo é feito dentro de `serveStatic`.
4. Os intervalos se aplicam aos bytes da representação selecionada. Com `Content-Encoding`, o intervalo vale para os bytes comprimidos.
5. Em `bytes=-n`, `n = 0` é intervalo não satisfazível (RF-05).
6. Arquivo de tamanho `0` é tratado como tamanho conhecido: qualquer intervalo recebe `416` com `bytes */0`.
7. `Accept-Ranges` é anunciado em todas as respostas de sucesso ou de intervalo (RF-01).

## Riscos

1. **Leitura do arquivo inteiro.** Como `getContents` não recebe offset, cada `206` pode ler o arquivo inteiro antes de recortar. Em vídeos grandes isso gasta memória e CPU. O risco é aceito para esta entrega, mas precisa ser medido. Um ajuste futuro exigiria mudar a API, o que está fora de escopo.
2. **Tipos de `BodyInit` variados.** `getContents` pode devolver string, `Blob`, `ArrayBuffer`, `ReadableStream` ou outros. O recorte precisa tratar cada tipo, e o caso de `ReadableStream` exige descartar os bytes antes do início do intervalo.
3. **Conflito de `Content-Length`.** Se `options.headers` ou o próprio evento já definirem `Content-Length`, o código atual não sobrescreve. Em `206`, o valor precisa ser o do trecho. A regra de precedência deve ser definida na implementação.
4. **Testes existentes.** Testes atuais podem esperar `200` ou um `Content-Length` fixo em requisições com `Range`. Só esses testes devem ser ajustados, sem perder o que verificam.
5. **Tamanho errado em `getMeta`.** Se `size` não bate com o conteúdo real, o `Content-Range` e o corpo ficam inconsistentes. Não há como o `serveStatic` detectar isso sem ler o arquivo.
6. **`If-Range` com ETag fraca.** A RFC 9110 exige ETag forte em `If-Range`. Uma ETag fraca deve ser tratada como não correspondente (RF-07).
7. **Encoding com intervalo.** Um cliente que retoma um download de arquivo comprimido recebe bytes comprimidos. Isso segue a norma, mas precisa ser coberto em teste.

## Qualidade e verificação

- `pnpm lint` e `pnpm typecheck` passam.
- A suíte existente passa. Cada requisito tem teste em `test/` com `describeMatrix`, rodando em `web` e `node`.
- Antes da mudança de código, os testes novos de RF-02 a RF-07 falham. Esse é o passo de regressão do fluxo de correção do AGENTS.md.
