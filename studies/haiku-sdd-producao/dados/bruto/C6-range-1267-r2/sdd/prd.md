# PRD: HTTP Range no `serveStatic` (h3js/h3#1267)

## Problema e objetivo

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Toda requisição GET ou HEAD para um asset recebe o corpo inteiro com status 200, e a resposta não anuncia `Accept-Ranges`. Por isso:

- clientes não conseguem retomar downloads interrompidos;
- players de vídeo e áudio não conseguem avançar (seek) no navegador;
- CDNs e proxies não conseguem fazer cache ou repasse parcial de forma correta.

**Objetivo:** fazer `serveStatic` atender a requisições de intervalo de bytes conforme a RFC 9110 (seções 13.1.5 e 14), que substitui a RFC 7233 citada na issue. A mudança fica restrita ao `serveStatic`, sem novas APIs públicas e sem quebrar o comportamento atual de cache, seleção de encoding, `fallthrough`, 404 e 405.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Toda resposta de sucesso de um asset (GET ou HEAD) deve incluir `Accept-Ranges: bytes`, mesmo quando a requisição não traz `Range`.

**Critério de aceite**

- **Dado** um asset existente servido por `serveStatic`
- **Quando** o cliente faz `GET` sem cabeçalho `Range`
- **Então** a resposta é `200` e contém `Accept-Ranges: bytes`.

### RF-02 — Responder intervalo válido com 206

Para um cabeçalho `Range: bytes=<início>-<fim>` com um único intervalo satisfazível, a resposta deve ser `206 Partial Content`, com `Content-Range: bytes <início>-<fim>/<tamanho>`, `Content-Length` igual ao número de bytes enviados e corpo contendo apenas esses bytes. Se `<fim>` ultrapassar o tamanho do asset, ele é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=2-5`
- **Então** a resposta é `206`, com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo com os bytes 2 a 5.

### RF-03 — Intervalos com início omitido ou fim aberto

A forma `bytes=<início>-` (do início até o fim do asset) e a forma sufixo `bytes=-<n>` (os últimos `n` bytes) devem ser tratadas como intervalos válidos, conforme a RFC 9110. Em `bytes=-<n>`, se `n` for maior que o tamanho, o intervalo cobre o asset inteiro.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=-3`
- **Então** a resposta é `206`, com `Content-Range: bytes 7-9/10` e `Content-Length: 3`.

### RF-04 — Ignorar Range malformado ou com múltiplos intervalos

Se o cabeçalho `Range` for malformado, tiver unidade diferente de `bytes` ou listar mais de um intervalo, o `serveStatic` deve ignorá-lo e responder como uma requisição normal, com `200` e o corpo completo.

**Critério de aceite**

- **Dado** um asset existente
- **Quando** o cliente envia `Range: bytes=0-1,4-5` ou `Range: itens=0-1`
- **Então** a resposta é `200` com o corpo completo e sem `Content-Range`.

### RF-05 — Responder 416 para intervalo não satisfazível

Se o intervalo for sintaticamente válido, mas não puder ser atendido (início depois do fim do asset, ou sufixo de tamanho zero), a resposta deve ser `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente envia `Range: bytes=20-30`
- **Então** a resposta é `416`, com `Content-Range: bytes */10` e `Content-Length: 0`.

### RF-06 — HEAD com Range

Para HEAD, as respostas de RF-02 e RF-05 valem apenas para os cabeçalhos: o status e `Content-Range`/`Content-Length` são os mesmos de um GET, e o corpo é vazio. O conteúdo não deve ser lido.

**Critério de aceite**

- **Dado** um asset de 10 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=2-5`
- **Então** a resposta é `206`, com `Content-Range: bytes 2-5/10`, `Content-Length: 4` e corpo vazio, sem chamar `getContents`.

### RF-07 — Validar `If-Range`

Se a requisição trouxer `If-Range`, o `Range` só é atendido quando o validador coincidir com a representação atual: para ETag, comparação forte com o `etag` do asset; para data, igualdade exata com o `last-modified`. Se não coincidir, o `Range` é ignorado e a resposta é `200` com o corpo completo.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `Range: bytes=0-3` com `If-Range: "v0"`
- **Então** a resposta é `200` com o corpo completo.
- **E** **Dado** o mesmo asset, **quando** o cliente envia `If-Range: "v1"`, **então** a resposta é `206`.

### RF-08 — Ignorar Range sem tamanho conhecido

Se `getMeta` não devolver `size`, ou devolver `size` igual a zero, o `Range` é ignorado e a resposta segue como hoje (200, sem `Content-Length` quando o tamanho é desconhecido).

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não informa `size`
- **Quando** o cliente envia `Range: bytes=0-3`
- **Então** a resposta é `200` com o corpo completo, sem `Content-Range`.

### RF-09 — Preservar o comportamento existente

Respostas 304 (cache condicional), seleção de variante por `accept-encoding`, `Vary`, `Content-Encoding`, `fallthrough`, 404 para asset inexistente e 405 para método não permitido devem continuar iguais. A avaliação condicional (`If-None-Match`, `If-Modified-Since`) acontece antes de `Range`, como exige a RFC 9110.

**Critério de aceite**

- **Dado** um asset com ETag `"v1"`
- **Quando** o cliente envia `If-None-Match: "v1"` junto com `Range: bytes=0-3`
- **Então** a resposta é `304`, sem corpo.
- **E** **Dado** um asset inexistente com `Range`, **quando** o cliente faz `GET`, **então** a resposta continua sendo `404` (ou retorna `undefined` quando `fallthrough` está ativo).

### RF-10 — Sem novas exportações públicas

`src/index.ts` não ganha nomes novos (valores ou tipos). Funções auxiliares ficam privadas em `src/utils/static.ts`. As opções de `ServeStaticOptions` não mudam.

**Critério de aceite**

- **Dado** o módulo público após a mudança
- **Quando** comparo as exportações de `src/index.ts` com a versão anterior
- **Então** o conjunto de exportações é idêntico.

### RF-11 — Cobertura de testes nos dois runtimes

Os casos de RF-01 a RF-09 devem ter testes com `describeMatrix` (modos `web` e `node`), em um arquivo de teste dedicado a Range ou no arquivo de teste existente do `serveStatic`. Os testes existentes devem continuar passando; só podem ser ajustados se dependerem explicitamente do comportamento alterado.

**Critério de aceite**

- **Dado** a suíte após a mudança
- **Quando** executo `pnpm vitest run` nos arquivos de static
- **Então** todos os testes passam nos modos `web` e `node`, incluindo os novos casos de Range.

## Fora de escopo

- Múltiplos intervalos na mesma requisição (`multipart/byteranges`). Nesses casos, o `Range` é ignorado (RF-04).
- Mudança na assinatura de `getContents` ou em `ServeStaticOptions` para passar o intervalo ao backend. O recorte é feito no próprio módulo.
- Suporte a `Range` em unidades diferentes de `bytes`.
- Cache de respostas parciais, compressão sob demanda de intervalos e lógica de CDN.
- Mudanças em `serveStatic` em outros pontos além da resposta de Range (cache, encoding, roteamento).
- Novos exports ou documentação pública fora do que `AGENTS.md` já exige.

## Premissas e riscos

**Premissas**

- A RFC 9110 é a norma de referência. A issue cita a RFC 7233, que foi substituída por ela.
- O `size` devolvido por `getMeta` é o tamanho exato da representação que `getContents` entrega. Se não for, o `Content-Range` fica errado.
- O validador de `If-Range` usa o `etag` e o `last-modified` que o próprio módulo já calcula.

**Riscos**

- **Recorte do corpo sem alterar a API.** `getContents` devolve um `BodyInit` completo e não recebe o intervalo. Para `Blob`, `Uint8Array` e `string`, o recorte é direto. Para `ReadableStream`, será preciso descartar bytes até o início e cortar o fim, o que pode custar desempenho em arquivos grandes. Esse é o principal ponto a validar na implementação.
- **Tamanho zero.** Hoje `content-length` não é definido quando `size` é 0. Pelo RF-05, qualquer intervalo em asset vazio deve virar 416, então é preciso decidir como tratar `size: 0` sem mudar o que já funciona.
- **Encoding pré-comprimido.** O intervalo se aplica à representação servida (já comprimida, por exemplo `.gz`). O cliente deve receber o `Content-Encoding` correspondente junto com o recorte. Testes devem cobrir essa combinação.
- **Ordem de avaliação.** Se a ordem de `304`, `Range` e `If-Range` estiver errada, clientes de cache podem receber respostas inconsistentes. Por isso RF-09 fixa essa ordem.
- **Mudança de comportamento para clientes existentes.** Respostas passam a incluir `Accept-Ranges`. Isso é aditivo, mas testes que comparam cabeçalhos exatos podem precisar de ajuste (RF-11).
