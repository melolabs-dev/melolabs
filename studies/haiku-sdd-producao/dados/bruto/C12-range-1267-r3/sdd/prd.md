# PRD — HTTP Range em `serveStatic`

**Referências:** issue [h3js/h3#1267](https://github.com/h3js/h3/issues/1267), `sdd/pedido.md`, código atual em `src/utils/static.ts`.
**Norma:** RFC 9110, seções 13.1.5 (If-Range), 14 (Range Requests) e 15.5.17 (416). A issue cita a RFC 7233, que foi substituída pela RFC 9110; este PRD segue a RFC 9110.

---

## Problema e objetivo

### Problema

Hoje `serveStatic` ignora o cabeçalho `Range`. Qualquer pedido recebe `200` com o corpo completo e sem `Accept-Ranges`. Isso causa três problemas:

- Clientes não conseguem retomar downloads interrompidos.
- Players de vídeo e áudio não conseguem avançar (seek): o navegador pede um intervalo e recebe o arquivo inteiro.
- CDNs e proxies não conseguem fazer transferência parcial de assets servidos pelo h3.

### Objetivo

Fazer `serveStatic` atender pedidos de um único intervalo de bytes em `GET` e `HEAD`, conforme a RFC 9110. A mudança fica restrita ao módulo `serveStatic`, sem nova API pública, e sem regredir cache, seleção de encoding, `fallthrough`, 404 e 405.

### Critérios de sucesso

1. Todos os cenários dos RF-01 a RF-15 têm teste que passa nos alvos `web` e `node`.
2. Um cliente que pede `Range: bytes=0-99` de um asset de 1000 bytes recebe exatamente 100 bytes, com status 206.
3. `src/index.ts` e `ServeStaticOptions` não mudam.
4. A suíte existente continua passando.

---

## Requisitos funcionais

### RF-01 — Anunciar suporte a intervalos

Toda resposta que `serveStatic` produz para um asset encontrado, em `GET` ou `HEAD`, inclui `Accept-Ranges: bytes`. Isso vale para 200, 206, 304 e 416. Respostas 404 e 405 não mudam.

**Critério de aceite:**
- **Dado** um asset existente de 1000 bytes servido por `serveStatic`, **Quando** o cliente faz `GET` sem cabeçalho `Range`, **Então** a resposta é `200`, com `Accept-Ranges: bytes` e `Content-Length: 1000`, e a mesma regra vale para `HEAD`.

### RF-02 — Ignorar `Range` que não se aplica

Quando o cabeçalho `Range` não pode ser aplicado, `serveStatic` ignora-o e responde `200` com o corpo completo, sem `Content-Range`. São casos de ignorar:

- (a) unidade diferente de `bytes` (ex.: `items=0-1`);
- (b) sintaxe inválida (ex.: `bytes=`, `bytes=-`, `bytes=abc`);
- (c) mais de um intervalo (ex.: `bytes=0-1,5-6`), que este PRD não atende;
- (d) último byte menor que o primeiro (ex.: `bytes=5-2`), que a RFC trata como inválido;
- (e) tamanho do asset desconhecido (`meta.size` indefinido).

O nome da unidade não diferencia maiúsculas de minúsculas: `Bytes=0-9` é válido.

**Critério de aceite:**
- **Dado** um asset existente de 1000 bytes, **Quando** o cliente faz `GET` com `Range: bytes=0-1,5-6` ou com `Range: items=0-9` ou com `Range: bytes=5-2`, **Então** a resposta é `200`, o corpo tem 1000 bytes e não há cabeçalho `Content-Range`.

### RF-03 — Responder `206` a intervalo válido

Um intervalo válido produz `206 Partial Content`. Formas aceitas:

- `a-b`: do byte `a` até o byte `b`;
- `a-`: do byte `a` até o fim;
- `-n`: os últimos `n` bytes.

Regras de ajuste:

- Se `b` passar do último byte, ele é reduzido para `tamanho - 1`.
- Se o sufixo `-n` for maior que o asset, o intervalo cobre o asset inteiro.

A resposta traz `Content-Range: bytes <início>-<fim>/<tamanho>` e `Content-Length` igual ao número de bytes enviados. Esse `Content-Length` vale mesmo que o chamador tenha definido outro valor (ver RF-15). `Content-Type`, `Content-Encoding` (quando houver), `ETag` e `Last-Modified` continuam presentes.

**Critério de aceite:**
- **Dado** um asset existente de 1000 bytes, **Quando** o cliente faz `GET` com `Range: bytes=100-199`, **Então** a resposta é `206`, com `Content-Range: bytes 100-199/1000`, `Content-Length: 100`, e o corpo contém exatamente os bytes de 100 a 199 do asset.

### RF-04 — Responder `416` a intervalo insatisfazível

Um intervalo sintaticamente válido, mas sem nenhum byte dentro do asset, produz `416 Range Not Satisfiable`. Isso acontece quando:

- o início é maior ou igual ao tamanho do asset;
- o sufixo é `-0`;
- o asset tem tamanho 0 (qualquer intervalo é insatisfazível).

A resposta traz `Content-Range: bytes */<tamanho>`, `Content-Length: 0` e corpo vazio.

**Critério de aceite:**
- **Dado** um asset existente de 1000 bytes, **Quando** o cliente faz `GET` com `Range: bytes=1000-1100`, **Então** a resposta é `416`, com `Content-Range: bytes */1000`, `Content-Length: 0` e corpo vazio.

### RF-05 — `HEAD` com `Range`

Para `HEAD`, as respostas de RF-03 (206) e RF-04 (416) têm os mesmos cabeçalhos, mas sem corpo. Nesses casos `getContents` não é chamado.

**Critério de aceite:**
- **Dado** um asset existente de 1000 bytes, **Quando** o cliente faz `HEAD` com `Range: bytes=0-99`, **Então** a resposta é `206`, com `Content-Range: bytes 0-99/1000`, `Content-Length: 100`, corpo vazio, e `getContents` não é chamado.

### RF-06 — `If-Range`

Quando o pedido traz `If-Range`, o intervalo só é atendido se o validador combinar com o do asset, conforme a RFC 9110, seção 13.1.5:

- **Com ETag:** só combina se for um ETag forte e igual ao ETag atual do asset. Um ETag fraco (prefixo `W/`), dos dois lados, nunca combina.
- **Com data:** só combina se for exatamente igual ao `Last-Modified` atual do asset, no formato de data HTTP. Data diferente ou inválida não combina.
- Quando não combina, `Range` é ignorado e a resposta é `200` com o corpo completo.
- Sem `If-Range`, o `Range` é atendido normalmente.

**Critério de aceite:**
- **Dado** um asset com `ETag: "abc"`, **Quando** o cliente faz `GET` com `Range: bytes=0-99` e `If-Range: "xyz"`, **Então** a resposta é `200` com o corpo completo e sem `Content-Range`; **e** com `If-Range: "abc"` a resposta é `206` com `Content-Range: bytes 0-99/<tamanho>`.

### RF-07 — Ordem com cabeçalhos condicionais

A verificação condicional já existente (`If-None-Match` e `If-Modified-Since`, que produzem `304`) vem antes de `Range`. Se o pedido resulta em `304`, não há `206` nem `416`. `Range` só é avaliado quando a resposta não é `304`.

**Critério de aceite:**
- **Dado** um asset com `ETag: "abc"`, **Quando** o cliente faz `GET` com `If-None-Match: "abc"` e `Range: bytes=0-99`, **Então** a resposta é `304`, sem corpo e sem `Content-Range`.

### RF-08 — Intervalo sobre a representação servida

Os bytes do intervalo são contados sobre a representação que `serveStatic` de fato serve, ou seja, depois da seleção de variante pré-comprimida (ex.: `.gz`). Quando a variante tem `Content-Encoding`, o intervalo se refere aos bytes codificados e o `Content-Encoding` é mantido. A seleção de encoding e o `Vary: accept-encoding` continuam como hoje.

**Critério de aceite:**
- **Dado** `encodings: { gzip: ".gz" }`, um arquivo `app.js` de 1000 bytes e `app.js.gz` de 400 bytes, **Quando** o cliente faz `GET` com `Accept-Encoding: gzip` e `Range: bytes=0-99`, **Então** a resposta é `206`, com `Content-Range: bytes 0-99/400`, `Content-Length: 100`, `Content-Encoding: gzip` e `Content-Type: text/javascript`.

### RF-09 — Bytes exatos para os tipos de corpo aceitos

O corte é feito sobre a sequência de bytes do corpo, conforme o tipo retornado por `getContents`:

- **string:** codificada em UTF-8 antes do corte. Índices e tamanhos são em bytes, não em caracteres.
- **ArrayBuffer, TypedArray, DataView, Blob e ReadableStream:** cortados em bytes.
- **Outros tipos de `BodyInit`** (`FormData`, `URLSearchParams`): `Range` é ignorado e a resposta é `200` completa.

**Critério de aceite:**
- **Dado** que `getContents` devolve a string `"ação"`, cuja codificação UTF-8 tem 6 bytes (`61 C3 A7 C3 A3 6F`), e `getMeta` informa `size: 6`, **Quando** o cliente faz `GET` com `Range: bytes=1-2`, **Então** a resposta é `206`, com `Content-Range: bytes 1-2/6`, `Content-Length: 2`, e o corpo são exatamente os bytes `C3 A7`.

### RF-10 — Não carregar o asset inteiro para Blob e stream

Para corpos `Blob` e `ReadableStream`, `serveStatic` não lê o asset inteiro para atender um intervalo. O corte de `Blob` usa `slice`. Para `ReadableStream`, a leitura da origem para quando o trecho termina.

**Critério de aceite:**
- **Dado** que `getContents` devolve um `ReadableStream` de 10 MB que contabiliza os bytes puxados da origem, **Quando** o cliente faz `GET` com `Range: bytes=0-99`, **Então** o corpo tem 100 bytes e o total puxado da origem não passa do primeiro chunk que contém o byte 99.

### RF-11 — Preservar o comportamento existente

Pedidos sem `Range`, e pedidos cujo `Range` é ignorado (RF-02 e RF-06 sem combinação), produzem a mesma resposta de hoje: status, cabeçalhos e corpo. Também não mudam:

- os ids passados a `getMeta` e `getContents`, que continuam percent-encoded;
- a rejeição de caminho não canônico;
- o 404 para asset ausente e o `fallthrough`;
- o 405 com `Allow: GET, HEAD`, inclusive para métodos com `Range`;
- o 304 de cache;
- `Content-Type` e `Content-Length` nas respostas 200;
- o `Vary` com `accept-encoding`.

**Critério de aceite:**
- **Dado** um asset existente, **Quando** o cliente faz `GET` sem `Range`, ou com um `Range` ignorado pelo RF-02, **Então** status, cabeçalhos e corpo são idênticos aos da versão anterior; **e** a suíte existente passa, com ajustes apenas em testes que dependam de cabeçalho `Range`.

### RF-12 — Sem novas exportações nem novas opções

`src/index.ts` não ganha nomes, valores ou tipos. `ServeStaticOptions` não ganha campos. As funções auxiliares de parsing de `Range` ficam privadas ao módulo (no fim de `src/utils/static.ts` ou em `src/utils/internal/`) e não são exportadas por nenhum subcaminho do pacote.

**Critério de aceite:**
- **Dado** a base atual, **Quando** comparo os nomes exportados por `src/index.ts` e os campos de `ServeStaticOptions` antes e depois da mudança, **Então** os dois conjuntos são idênticos.

### RF-13 — Cobertura de testes nos dois alvos

Os cenários de RF-01 a RF-10 têm testes com `describeMatrix`, rodando em `web` e `node`. Os testes cobrem, no mínimo: sufixo maior que o asset, asset de tamanho 0, `HEAD`, `If-Range` com ETag fraco, multi-range, intervalo com início após o fim, `Range` com unidade diferente de `bytes`, e `Range` combinado com `POST`.

**Critério de aceite:**
- **Dado** o repositório com a mudança, **Quando** executo os testes de `serveStatic`, **Então** todos passam em `web` e `node`, e cada cenário listado acima tem pelo menos um teste.

### RF-14 — Qualidade e dependências

`pnpm lint` (que inclui a checagem de tipos) e `pnpm typecheck` passam. Nenhuma dependência é adicionada ou removida.

**Critério de aceite:**
- **Dado** a branch com a mudança, **Quando** executo `pnpm lint` e `pnpm typecheck`, **Então** ambos terminam sem erro, **e** o `package.json` tem as mesmas dependências de antes.

### RF-15 — Cabeçalhos definidos pelo chamador em respostas 206 e 416

Quando o chamador já definiu `Content-Length`, seja por `options.headers` ou por `event.res.headers`, as respostas 206 e 416 usam o `Content-Length` do trecho (ou `0`), sobrescrevendo o valor anterior. Respostas 200 mantêm a regra atual, que não sobrescreve `Content-Length` já definido.

**Critério de aceite:**
- **Dado** um asset de 1000 bytes servido com `options.headers: { "content-length": "5" }`, **Quando** o cliente faz `GET` com `Range: bytes=0-99`, **Então** a resposta é `206` com `Content-Length: 100`.

---

## Fora de escopo

- Respostas `multipart/byteranges` para vários intervalos. Vários intervalos são ignorados (RF-02).
- Opção para desligar `Range` (por exemplo, uma nova chave em `ServeStaticOptions`). Não será adicionada nesta versão.
- Suporte a `If-Match` e `If-Unmodified-Since`.
- Range para outros utilitários (`proxy`, `fetchWithEvent`, `h3/rules/cache`, respostas de handlers comuns).
- Mudança em `Cache-Control`, `Vary` além do que já existe, ou em regras de cache de CDN. Respostas parciais não ganham regra de cache própria.
- Compressão sob demanda para respostas parciais.
- Mudanças nos adaptadores de cada runtime, nem em `getMeta` e `getContents` (assinatura e comportamento continuam os mesmos).
- Correções de outros bugs de `serveStatic` que não estejam ligados a `Range`.

---

## Premissas

1. `meta.size` é o número exato de bytes da variante servida. O `Content-Length` de 206 e o `Content-Range` são calculados a partir dele.
2. `getContents` devolve a representação completa do asset, a partir do byte 0. Ele não recebe o intervalo como parâmetro.
3. Os tipos `Blob`, `ReadableStream`, `ArrayBuffer` e `TypedArray` estão disponíveis em Node.js, Bun, Deno, Cloudflare Workers e navegadores, com `slice` e leitura por stream.
4. A mudança de comportamento para clientes que já enviam `Range` (passam a receber `206`) é intencional. A issue pede isso e o padrão HTTP prevê.
5. Não há necessidade de opção de desligamento, porque a RFC permite servir `200` quando o `Range` não se aplica, e os casos inválidos já caem nesse caminho.

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `meta.size` diferente do tamanho real do corpo (ex.: cache do backend desatualizado). | Resposta `206` com `Content-Length` que não bate com o corpo; cliente trava ou corrompe o download. | Documentar a premissa 1 no código e nos testes. Testar o caso em que o corpo é menor que `size`, e avaliar se vale truncar ou abortar. |
| Corte de `string` exige codificação UTF-8 completa do corpo, com custo de memória em arquivos grandes. | Alocação maior em textos grandes. | Aceitar o custo para `string` (é pequeno em geral). Medir com um arquivo grande antes de liberar. |
| Comportamento de cancelamento de `ReadableStream` varia entre runtimes (Node, Bun, Deno, Workers). | RF-10 pode passar em um runtime e falhar em outro. | Testar a contagem de bytes puxados em `web` e `node` (matriz). Se algum runtime divergir, documentar a diferença, sem mudar o critério. |
| Comparação de data em `If-Range` com precisão de segundo. | Um `Last-Modified` com milissegundos pode não combinar com o cabeçalho enviado pelo cliente. | Truncar `mtime` para segundos, como o código já faz para `Last-Modified` (linha 232 de `static.ts`), e usar essa mesma data na comparação. |
| Sobrescrever `Content-Length` definido pelo chamador (RF-15) pode surpreender quem usa `headers` com `Content-Length`. | Mudança sutil em respostas 206 e 416. | Restringir a mudança a 206 e 416, e cobrir com teste (RF-15). |
| Clientes que enviam `Range` hoje recebem `206` depois da mudança. | Quem depende do `200` completo pode quebrar. | É a mudança pedida na issue. Registrar no changelog e no PR. |
| Testes existentes que enviam `Range` por acidente podem falhar. | Ajuste de testes além do necessário. | Ajustar só os testes que dependem de `Range`, e descrever cada ajuste no PR. |
