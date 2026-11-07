# PRD: Suporte a HTTP Range no `serveStatic`

Referência: h3js/h3#1267 e contrato em `sdd/pedido.md`.

## Problema e objetivo

### Problema

O utilitário `serveStatic` (`src/utils/static.ts`) ignora o cabeçalho `Range`. Quando um cliente pede um intervalo de bytes, recebe sempre o corpo completo com `200 OK`, sem nenhum cabeçalho de conteúdo parcial. Isso impede:

- retomar downloads interrompidos;
- avançar (seek) em vídeo e áudio em players de navegador, que enviam `Range` por padrão;
- comportamento correto de CDNs e proxies que dependem de respostas parciais.

### Objetivo

Fazer `serveStatic` responder a pedidos de intervalo de bytes para `GET` e `HEAD`, seguindo a RFC 9110 (seções 13.1.5 "If-Range" e 14 "Range Requests"), sem alterar a API pública, o cache, a seleção de encoding, o `fallthrough` nem as respostas de 404 e 405 já existentes.

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

`serveStatic` passa a incluir `Accept-Ranges: bytes` em toda resposta de sucesso (`200`, `206`) e em `HEAD` para um asset encontrado.

**Critério de aceite**

- **Dado** um asset existente com `getMeta` retornando `size`
- **Quando** o cliente faz `GET` ou `HEAD` sem cabeçalho `Range`
- **Então** a resposta tem status `200` e o cabeçalho `Accept-Ranges: bytes`

### RF-02 — Responder a um intervalo válido com 206

Quando o cabeçalho `Range` contém um único intervalo `bytes=` válido e satisfazível, a resposta é `206 Partial Content` com o trecho pedido, `Content-Range` e `Content-Length` corretos.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e o corpo contém exatamente os bytes 0 a 99

### RF-03 — Suportar intervalos abertos e sufixos

Além de `bytes=início-fim`, o servidor aceita `bytes=início-` (do início até o fim do asset) e `bytes=-N` (os últimos N bytes). Um `fim` maior que o tamanho do asset é limitado ao último byte.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=900-` e, em outro pedido, `Range: bytes=-50`
- **Então** as respostas são `206` com `Content-Range: bytes 900-999/1000` e `Content-Range: bytes 950-999/1000`, respectivamente
- **E** para `Range: bytes=900-5000` a resposta é `206` com `Content-Range: bytes 900-999/1000`

### RF-04 — Responder a HEAD com cabeçalhos de intervalo

Para `HEAD` com `Range` válido, a resposta usa o mesmo status, `Content-Range` e `Content-Length` que o `GET` equivalente, sem corpo.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`
- **Então** a resposta tem status `206`, `Content-Range: bytes 0-99/1000`, `Content-Length: 100` e corpo vazio

### RF-05 — Responder a intervalo não satisfazível com 416

Quando o intervalo começa em um byte fora do asset (por exemplo, `bytes=1000-` em um asset de 1000 bytes) ou o sufixo tem comprimento zero, a resposta é `416 Range Not Satisfiable`, com `Content-Range: bytes */<tamanho>` e `Content-Length: 0`.

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente faz `GET` com `Range: bytes=1000-`
- **Então** a resposta tem status `416`, `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio

### RF-06 — Ignorar cabeçalhos Range malformados ou com múltiplos intervalos

Se o `Range` não for uma sintaxe `bytes=` válida, usar unidade diferente de `bytes` ou pedir mais de um intervalo, o servidor ignora o cabeçalho e responde com o asset completo (`200`).

**Critério de aceite**

- **Dado** um asset de 1000 bytes
- **Quando** o cliente envia `Range: bytes=abc`, `Range: items=0-9` ou `Range: bytes=0-9,20-29`
- **Então** a resposta tem status `200`, o corpo completo e não contém `Content-Range`

### RF-07 — Validar If-Range

Quando o cliente envia `If-Range`, o `Range` só é aplicado se o validador enviado (ETag forte ou data de `Last-Modified`) corresponder ao estado atual do asset. Caso contrário, o `Range` é ignorado e a resposta é `200` com o asset completo.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente faz `GET` com `Range: bytes=0-99` e `If-Range: "abc"`
- **Então** a resposta é `206`
- **E** quando o cliente envia `If-Range: "outro"` no mesmo pedido, a resposta é `200` com o corpo completo

### RF-08 — Ordem de precedência com cache condicional

A avaliação de cache condicional continua tendo prioridade sobre `Range`. Se `If-None-Match` ou `If-Modified-Since` indicarem que o cliente já tem a versão atual, a resposta é `304`, mesmo que haja `Range`.

**Critério de aceite**

- **Dado** um asset com ETag `"abc"`
- **Quando** o cliente faz `GET` com `If-None-Match: "abc"` e `Range: bytes=0-99`
- **Então** a resposta é `304 Not Modified` sem corpo

### RF-09 — Ignorar Range quando o tamanho é desconhecido

Se `getMeta` não retornar `size` (ou retornar zero), o `Range` é ignorado e a resposta é `200` com o asset completo. `Accept-Ranges: bytes` continua presente.

**Critério de aceite**

- **Dado** um asset cujo `getMeta` não retorna `size`
- **Quando** o cliente faz `GET` com `Range: bytes=0-99`
- **Então** a resposta é `200` com o corpo completo e sem `Content-Range`

### RF-10 — Preservar comportamento existente

Cache, seleção de encoding (`encodings`, `Accept-Encoding`), `fallthrough`, `indexNames`, respostas 404 para asset inexistente e 405 para método não permitido funcionam como hoje quando não há `Range`. Com `fallthrough: true`, os casos de não encontrado e de método não permitido continuam passando para o próximo handler.

**Critério de aceite**

- **Dado** qualquer configuração válida de `serveStatic`
- **Quando** o cliente faz uma requisição sem `Range`
- **Então** status, cabeçalhos e corpo são idênticos aos produzidos pela versão anterior
- **E** os testes existentes de `test/static.test.ts` continuam passando, ajustando apenas as asserções que dependem do novo comportamento

### RF-11 — Sem novas exportações públicas

Nenhum nome novo (valor ou tipo) é exportado por `src/index.ts`. Funções auxiliares de parsing e cálculo de intervalo ficam privadas ao módulo `src/utils/static.ts`. As opções de `ServeStaticOptions` e a assinatura de `getMeta` e `getContents` não mudam.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** se compara a lista de exports de `src/index.ts` e as assinaturas públicas de `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta` com a versão anterior
- **Então** não há diferença

### RF-12 — Cobertura de testes em todos os runtimes

Os novos comportamentos são cobertos por testes com `describeMatrix` (modo `web` e `node`), cobrindo GET, HEAD, 206, 416, ignorados (malformado, multi-range, If-Range não confere, tamanho desconhecido) e precedência de 304.

**Critério de aceite**

- **Dado** a suíte após a mudança
- **Quando** se roda `pnpm vitest run test/static.test.ts`
- **Então** todos os testes passam nos modos `web` e `node`

## Fora de escopo

- Múltiplos intervalos na mesma requisição (`multipart/byteranges`). Esses pedidos são ignorados e recebem `200`, conforme RF-06.
- Unidades de intervalo diferentes de `bytes`.
- Suporte a `Range` em respostas de `h3/rules/proxy`, `proxyRequest` ou em handlers que não usam `serveStatic`.
- Mudanças em `getMeta` ou `getContents` que permitam ao backend ler um intervalo diretamente (a API atual não muda; ver premissa P2).
- Novas opções em `ServeStaticOptions` (por exemplo, para desligar `Accept-Ranges`).
- Cabeçalhos de cache novos, ETag fraco ou geração automática de ETag.
- Mudanças na lógica de segurança de caminho descrita em `serveStatic` (`isCanonicalPath`, decodificação de separadores).

## Premissas e riscos

### Premissas

- **P1.** `getMeta` retorna `size` para a maioria dos assets de produção. Assets sem `size` continuam funcionando, mas sem intervalos (RF-09).
- **P2.** `getContents` devolve o corpo completo (`BodyInit`) e não recebe o intervalo. Para atender RF-02, o `serveStatic` precisa fatiar esse corpo. Isso pode exigir ler o conteúdo inteiro em memória em alguns casos, o que deve ser avaliado no design.
- **P3.** O `size` informado por `getMeta` corresponde ao tamanho real de `getContents`. Se divergir, o `Content-Length` e o `Content-Range` ficam incorretos.
- **P4.** A norma aplicável é a RFC 9110, que substitui a RFC 7233 citada na issue original.

### Riscos

- **R1. Respostas com `Content-Encoding`.** Quando um arquivo pré-comprimido (`.gz`, `.br`) é servido, o intervalo se refere aos bytes codificados. Clientes podem não esperar isso. Recomendação a confirmar: ignorar `Range` quando `meta.encoding` estiver definido, e responder `200` completo.
- **R2. Custo de memória.** Fatiar um corpo que não é `Blob` ou `ArrayBuffer` pode forçar a leitura completa do conteúdo. Vale medir ou limitar esse caso.
- **R3. Regressão em `fallthrough`.** Cabeçalhos definidos antes de decidir o status (como `Accept-Ranges` e `Content-Range`) não devem vazar para o próximo handler quando o asset não é encontrado. Ver o comentário existente sobre `vary` em `src/utils/static.ts`.
- **R4. Testes existentes.** Alguns testes podem verificar a ausência de `Accept-Ranges` ou o status `200` com `Range` presente. Esses ajustes devem ser mínimos e justificados, sem remover o que eles verificam.
- **R5. Escopo do `If-Range` com data.** Comparar datas HTTP exige a mesma precisão de segundos já usada em `last-modified`. Uma comparação mal feita pode aceitar um `If-Range` que não confere.
