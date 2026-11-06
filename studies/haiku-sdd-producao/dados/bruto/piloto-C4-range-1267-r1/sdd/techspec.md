# Especificação técnica: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (requisitos RF-01 a RF-11). Este documento decide como implementar e não repete os requisitos. Toda citação `arquivo:linha` foi conferida no código deste clone.

## 1. Visão geral da solução

Toda a mudança fica em `src/utils/static.ts`, com helpers privados ao módulo. O intervalo é avaliado depois da seleção de encoding (que define `meta` e `size`) e depois das condicionais (304). A partir daí, o cabeçalho `Range` gera `206`, `416` ou é ignorado. O corpo parcial é obtido a partir do `BodyInit` que `getContents` já devolve, sem mudar a assinatura pública.

Fluxo resultante dentro de `serveStatic`:

1. Métodos e canonicidade: inalterados (`static.ts:116-122`, `static.ts:142-147`).
2. Seleção da variante por `Accept-Encoding` e `getMeta`: inalterada (`static.ts:187-215`). Define `id`, `meta` e `meta.size`.
3. `Vary`, `Last-Modified`, `ETag`: inalterados, e `Accept-Ranges` passa a ser definido aqui (D-02).
4. 304 por `If-None-Match`/`If-Modified-Since`: inalterado (`static.ts:243-248`).
5. `Content-Type`, `Content-Encoding`, `Content-Length` de 200: inalterados (`static.ts:250-270`).
6. **Novo**: avaliação de `Range` (`If-Range`, parse, satisfazibilidade). Retorna 416, 206 ou segue para 200.
7. HEAD e GET: inalterados no caminho 200 (`static.ts:272-277`).

## 2. Decisões de arquitetura

### D-01 — Onde e em que ordem avaliar o `Range`

**Alternativas**
- (a) Avaliar `Range` antes das condicionais de cache.
- (b) Avaliar `Range` depois do 304 e dos headers de conteúdo, e antes do ramo de HEAD.

**Escolha: (b).** A RFC 9110 §13.2.2 manda avaliar pré-condições (`If-None-Match`, `If-Modified-Since`) antes de `Range`. Assim, um `If-None-Match` que casa com o `ETag` atual responde `304` mesmo com um `Range` válido (RF-09). O bloco novo entra entre `static.ts:270` (`content-length`) e `static.ts:272` (HEAD), de modo que HEAD e GET compartilhem a mesma decisão de status e cabeçalhos (RF-06).

### D-02 — `Accept-Ranges` em todo asset encontrado

**Alternativas**
- (a) Definir `accept-ranges` somente nas respostas 200, 206 e 416.
- (b) Definir junto de `ETag` e `Last-Modified`, antes do 304.

**Escolha: (b).** O contrato (`pedido.md`, item 1) exige o cabeçalho em toda resposta que serve asset encontrado. O 304 já recebe `etag` e `last-modified` por `event.res.headers` (ver o teste `test/static.test.ts:199-207`, que confirma `etag` no 304), então `accept-ranges` segue o mesmo caminho. Inserir após `static.ts:241` e antes de `static.ts:243`.

### D-03 — O intervalo é aplicado à variante escolhida

**Alternativas**
- (a) Usar o tamanho do asset base, mesmo quando um `.gz` foi escolhido.
- (b) Usar o `size` retornado por `getMeta` para o id escolhido.

**Escolha: (b).** `serveStatic` já reatribui `id` e `meta` para a variante em `static.ts:198-206`. O `size` usado no `Content-Range` e na 416 é `meta.size` dessa variante, e o corpo vem de `getContents(id)` com o mesmo `id` (`static.ts:276`). Isso atende RF-07 sem lógica extra. Usar (a) geraria `Content-Range` com o tamanho errado.

### D-04 — Fatiamento do corpo sem alterar `getContents`

**Alternativas**
- (a) Acrescentar um parâmetro de intervalo a `getContents`. Quebra o contrato público e vai contra o pedido (sem novas opções, sem novos exports).
- (b) Bufferizar o corpo inteiro (`arrayBuffer()`) e fatiar. Custo de memória proporcional ao arquivo, ruim para vídeo.
- (c) Usar apenas `Blob.slice`. Exclui strings e streams, que são formas normais de `BodyInit` e são as usadas nos testes atuais.

**Escolha: fatiamento híbrido em um helper privado `sliceBody`.**
- Se o corpo for `Blob` (inclui `File`), usa `body.slice(start, end + 1)`. Não há leitura do prefixo.
- Para os demais `BodyInit` (string, `ArrayBuffer`, views, `ReadableStream`), converte com `new Response(body).body` e aplica um `TransformStream` que descarta `start` bytes e emite `length` bytes, encerrando ao atingir o limite.
- Node `>=20.19` (`package.json:127-128`) já tem `Response`, `Blob` e `TransformStream` globais, então não há dependência nova.

### D-05 — `Content-Length` e `Content-Range` sobrescrevem headers em 206 e 416

`static.ts:268-270` só define `content-length` quando ainda não existe, e o teste `test/static.test.ts:600-617` protege esse comportamento para o `headers` da opção. Nas respostas 206 e 416, o valor precisa refletir o trecho real, então o helper usa `set` e sobrescreve. O teste de `test/static.test.ts:600-617` cobre somente HEAD sem `Range`, portanto continua válido.

### D-06 — Retornar `HTTPResponse` (não `Response` bruto) em 206 e 416

`toResponse` mescla `event.res.headers` em qualquer `HTTPResponse` (`src/response.ts:188-206`). Porém, um `Response` bruto com status `>= 400` recebe apenas os headers marcados como de erro (`src/response.ts:211-213`). Se a 416 fosse um `new Response(...)`, `Content-Range` e `Accept-Ranges` se perderiam. Por isso, todos os retornos novos usam `HTTPResponse`, como já fazem o 304 e o 200 atuais (`static.ts:244`, `static.ts:277`).

### D-07 — Casos de borda do intervalo

Regra adotada, com base na RFC 9110 §14.1 e no contrato:

| Pedido (size = 1000) | Resultado |
| --- | --- |
| `bytes=100-199` | 206, `bytes 100-199/1000` |
| `bytes=900-` | 206, `bytes 900-999/1000` |
| `bytes=-100` | 206, `bytes 900-999/1000` |
| `bytes=500-1500` | 206, `bytes 500-999/1000` (fim limitado) |
| `bytes=-5000` (sufixo maior que o arquivo) | 206 com o arquivo inteiro, `bytes 0-999/1000` (RFC 9110 §14.1.3) |
| `bytes=-0` | 416 (sufixo de zero bytes não é satisfazível) |
| `bytes=1000-` ou `bytes=1000-1200` | 416, `bytes */1000` |
| `bytes=9-3` (fim menor que início) | ignorado, 200 |
| `bytes=0-1,5-9` (multi-range) | ignorado, 200 |
| `items=0-9`, `bytes=abc`, `bytes=-` | ignorado, 200 |
| qualquer `Range` com size 0 | 416, `bytes */0` |

Implementação: a regex do parser (`/^bytes=[ \t]*(?:(\d+)-(\d*)|-(\d+))[ \t]*$/` aplicada ao valor com `trim()`) já rejeita vírgulas, unidades diferentes e sintaxe inválida. Multi-range e malformado caem em "ignorado" sem código extra.

### D-08 — `If-Range`: somente entity-tag forte, data é ignorada

**Alternativas**
- (a) Aceitar data em `If-Range` e comparar exatamente com o `Last-Modified` truncado em segundos (RFC 9110 §13.1.5).
- (b) Ignorar qualquer `If-Range` que não seja entity-tag forte. O `Range` é descartado e a resposta é 200.

**Escolha: (b).** O contrato (`pedido.md`, item 8) fala só em entity-tag, e o PRD deixa a data em aberto (`prd.md`, riscos). Ignorar é o lado seguro: nunca mistura duas versões do arquivo. O custo é que um cliente que retoma com data recebe 200 completo e refaz o download. Fica como ponto a confirmar (seção 7).

Regra: o validador do cliente vale só se começar com `"` (não `W/`), o `ETag` do asset não pode começar com `W/`, e as duas strings devem ser idênticas. Se `If-Range` falhar, o `Range` é ignorado inteiro, inclusive a 416 (RFC 9110 §13.1.5).

### D-09 — Asset sem `size` em `getMeta`

**Alternativas**
- (a) Responder 416 por não saber o tamanho.
- (b) Ignorar o `Range` e responder 200 completo.

**Escolha: (b).** Não há como montar `Content-Range`, e o PRD (premissa e risco) pede que o `Range` seja ignorado nesse caso. `Accept-Ranges` continua sendo emitido porque o contrato o exige para todo asset encontrado (D-02). Ver risco R-03.

### D-10 — `Vary` não recebe `range`

`static.ts:220-225` mantém `Vary: accept-encoding`. **Escolha: não acrescentar `range`.** O cabeçalho `Range` não seleciona a representação, porque 200 e 206 são a mesma variante, apenas em trechos diferentes. Caches compartilhados guardam respostas parciais pela chave de Range, conforme a RFC 9111. Além disso, `src/rules/cache.ts:146-149` já desvia pedidos com `Range` do ocache, então nenhum 206 entra no cache de rules. Ver risco R-05.

### D-11 — Helpers privados em `static.ts`, sem arquivo novo

**Alternativas**
- (a) Colocar os helpers em `static.ts`, junto de `parseAcceptEncoding` (`static.ts:292`) e `idSearchPaths` (`static.ts:340`).
- (b) Criar `src/utils/internal/range.ts`. Há precedente em `src/utils/internal/cache.ts`, que exporta `matchETag` e `isCacheMatch` para `static.ts` (`static.ts:6`).

**Escolha: (a).** O issue exige que a lógica auxiliar fique privada ao módulo `serveStatic` (`pedido.md`, RF-10 e `prd.md`). A convenção de `AGENTS.md` ("aim < 200 LoC per file") já é excedida: o arquivo tem 352 linhas. O arquivo passará a cerca de 430 linhas. Se o time preferir a convenção, mover para `utils/internal/range.ts` sem exportar nada por `src/index.ts` é uma refatoração simples e reversível.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | (1) Inserir `event.res.headers.set("accept-ranges", "bytes")` após `static.ts:241`. (2) Inserir o bloco de `Range` entre `static.ts:270` e `static.ts:272`. (3) Adicionar os helpers privados ao final do arquivo, depois de `static.ts:351`. |
| `test/static.test.ts` | Novo `describeMatrix("serve static range", ...)` ao final do arquivo. Não alterar os blocos existentes. |
| `src/index.ts` | Nenhuma alteração. `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. |

Não há alteração em `AGENTS.md` nem em documentação, porque nenhum padrão novo foi introduzido.

## 4. Contratos e assinaturas

Tudo abaixo é **privado** a `src/utils/static.ts`, sem `export`. Nenhum tipo é exportado.

```ts
// Intervalo satisfazível, já limitado ao tamanho do asset (inclusivo nos dois extremos).
type ByteSpan = { start: number; end: number };

// Resultado de avaliar Range:
//   undefined          -> ignorar Range (responder 200 completo)
//   "unsatisfiable"    -> responder 416
//   ByteSpan           -> responder 206 com o trecho
function evaluateRange(
  headers: Headers,
  size: number,
  etag: string | undefined,
): ByteSpan | "unsatisfiable" | undefined;

// Interpreta somente o valor de Range (já sem o cabeçalho). Multi-range, unidade
// diferente e sintaxe inválida retornam undefined. Início maior que fim também.
function parseByteRange(value: string, size: number): ByteSpan | "unsatisfiable" | undefined;

// If-Range só casa com entity-tag forte idêntica ao ETag do asset. Data retorna false.
function matchesIfRange(ifRange: string, etag: string | undefined): boolean;

// Fatia o corpo. Blob usa slice; os demais passam por Response + TransformStream.
function sliceBody(body: BodyInit | null | undefined, span: ByteSpan): BodyInit | null;
```

Bloco novo em `serveStatic` (pseudocódigo fiel ao fluxo da seção 1):

```ts
// após static.ts:241, antes do 304
event.res.headers.set("accept-ranges", "bytes");

// ... 304, content-type, content-encoding, content-length (inalterados) ...

const range =
  meta.size === undefined ? undefined : evaluateRange(event.req.headers, meta.size, meta.etag);

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range) {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(sliceBody(contents, range), { status: 206, statusText: "Partial Content" });
}

// ... ramo HEAD e GET de 200 (inalterados) ...
```

Comportamento final por caso:

| Situação | Status | Cabeçalhos relevantes | Corpo |
| --- | --- | --- | --- |
| Asset encontrado, sem Range | 200 | `accept-ranges: bytes` | completo |
| Range válido, satisfazível | 206 | `content-range`, `content-length` = trecho | trecho |
| Range não satisfazível | 416 | `content-range: bytes */size`, `content-length: 0` | vazio |
| Range ignorado (multi, malformado, If-Range falhou, size ausente) | 200 | `accept-ranges: bytes` | completo |
| HEAD com Range válido | 206 | igual ao GET | vazio |
| If-None-Match casa com Range válido | 304 | sem `content-range` | vazio |

## 5. Estratégia de testes

Seguindo `AGENTS.md`, os testes são escritos antes da implementação e precisam falhar antes da mudança (red), depois passar (green).

**Onde.** Novo `describeMatrix("serve static range", ...)` ao final de `test/static.test.ts`. `describeMatrix` roda cada caso nos modos `web` e `node` (`test/_setup.ts:11`), o que cobre a exigência de testar os dois modos (`prd.md`, riscos).

**Fixture.** Asset de 1000 bytes com conteúdo determinístico (por exemplo, `"0123456789"` repetido 100 vezes), para que o teste verifique os bytes exatos do trecho.

**Três formas de `getContents`.** Parametrizar o mesmo conjunto de testes com `string`, `Blob` e `ReadableStream`. Isso cobre os dois ramos de `sliceBody` (D-04). Para o `ReadableStream`, criar um stream novo a cada requisição.

**Casos (um `it` por linha):**
1. Sem `Range`: 200, `accept-ranges: bytes`, corpo completo (RF-01).
2. `bytes=100-199`, `bytes=900-`, `bytes=-100`: 206 com os bytes e `content-range` corretos (RF-02).
3. `bytes=500-1500`: 206, `bytes 500-999/1000`, `content-length: 500` (RF-03).
4. `bytes=1000-`: 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio (RF-04).
5. `bytes=-0` e `bytes=-5000`: 416 e 206 com arquivo inteiro, respectivamente (D-07).
6. Multi-range, unidade `items=`, `bytes=abc`, `bytes=9-3`: 200 sem `content-range` (RF-05).
7. HEAD com `bytes=0-99`: 206, `bytes 0-99/1000`, `content-length: 100`, corpo vazio (RF-06).
8. Variante `app.js.gz` de 300 bytes com `accept-encoding: gzip` e `bytes=0-99`: 206, `content-encoding: gzip`, `bytes 0-99/300` (RF-07). Usar um `getMeta` que devolva `size` diferente para `.gz`.
9. `If-Range`: `"xyz"` gera 200; `"abc"` gera 206; `W/"abc"` gera 200; data (`If-Range: <data HTTP>`) gera 200 (RF-08, D-08).
10. `If-None-Match` igual ao `ETag` com `Range` válido: 304 sem corpo (RF-09).
11. POST com `Range`: 405 inalterado. Caminho 404 com `Range`: 404 inalterado (RF-09).
12. Asset sem `size`: 200 sem `content-range`, com `accept-ranges` presente (D-09).
13. `options.headers` com `content-length` e `Range` válido: 206 com o `content-length` do trecho, não o valor da opção (D-05).
14. `fallthrough: true` com `Range` em asset inexistente: segue para o próximo handler (preservação).

**Regressão.** `pnpm vitest run test/static.test.ts` deve passar sem alterar nenhuma expectativa dos blocos existentes. Em especial: `test/static.test.ts:199-207` (304), `:251-254` (405), `:600-617` (content-length).

**Qualidade.** `pnpm lint` (oxlint e oxfmt --check) e `pnpm typecheck` (`tsc --noEmit`), conforme `package.json:46` e `:54`. Opcional: `pnpm vitest --run --coverage` para ver se os ramos novos de `static.ts` estão cobertos.

**Exports.** Conferir que `src/index.ts` não mudou (diff vazio nesse arquivo) e que o `pnpm typecheck` não reclama de tipos públicos novos.

## 6. Riscos

- **R-01 — `getContents` devolve `null` ou `undefined` em 206.** O corpo ficaria vazio com `content-length` maior que zero, o mesmo problema que já existe hoje no 200 (`static.ts:276-277`). Mitigação: documentar; manter o comportamento atual. Não é agravado pelo Range.
- **R-02 — Custo de seek em streams.** Para `ReadableStream`, o trecho inicial é lido e descartado. Um seek perto do fim de um arquivo grande custa O(início). Mitigação: quem serve arquivos grandes deve devolver `Blob`/`File` (fatiamento sem leitura, D-04). Registrar isso na documentação do `getContents`, se o time quiser.
- **R-03 — Anúncio de `accept-ranges` sem suporte real.** Quando `size` é ausente, o cabeçalho é emitido mas o `Range` é ignorado (D-09). Tecnicamente é uma inconsistência pequena. Alternativa: emitir `accept-ranges` só quando `meta.size !== undefined`. Contrato atual pede o contrário; decidir na revisão.
- **R-04 — `If-Range` com data.** Clientes que retomam downloads com data recebem 200 e refazem o download (D-08). Não há corrupção, só custo.
- **R-05 — `Vary` e caches intermediários.** Se um proxy ignorar a regra de chave de Range, pode misturar respostas. A RFC 9111 trata isso, mas depende do intermediário. Mitigação: confirmar com o time se `Vary` deve incluir `range` (`prd.md`, riscos). Recomendação atual: não incluir (D-10).
- **R-06 — Regressão em HEAD e 405.** O HEAD compartilha o caminho com GET. O bloco novo tem um `return` específico para HEAD antes do `getContents`, e os testes 7 e 11 cobrem isso.
- **R-07 — Ordem 304 versus 416.** Se a ordem em D-01 for trocada, um `If-None-Match` válido com `Range` inválido retornaria 416 em vez de 304. O teste 10 protege essa ordem.
- **R-08 — Tamanho do arquivo e `Number`.** Números maiores que `2^53` perdem precisão no parse. Isso não afeta a decisão, porque qualquer início acima do tamanho gera 416 e qualquer fim acima é limitado ao último byte.
- **R-09 — Limite de linhas.** `static.ts` cresce para cerca de 430 linhas, acima da convenção de `AGENTS.md`. Decisão D-11 registra o trade-off.
- **R-10 — Verificação não executada.** Esta especificação foi escrita sem rodar a suíte nem o lint. As afirmações de comportamento vêm da leitura do código e dos testes existentes, e precisam ser confirmadas pela execução dos testes da seção 5.

## 7. Pontos a confirmar com o time

1. **If-Range com data** (D-08): aceitar a regra de ignorar (200) ou implementar comparação exata com `Last-Modified`?
2. **Sufixo maior que o arquivo e `bytes=-0`** (D-07): seguir a RFC 9110 como descrito na tabela. O contrato não cita esses casos.
3. **`Vary` com `range`** (D-10 e R-05).
4. **`accept-ranges` sem `size`** (R-03): manter o anúncio como pede o contrato ou condicionar a `size`.
5. **Localização dos helpers** (D-11): manter em `static.ts` ou mover para `utils/internal/range.ts`.
