# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (requisitos RF-01 a RF-14). Esta especificação decide **como** implementar. Não repete os requisitos; quando citados, usa o código `RF-NN`.

## Visão geral

Toda a mudança cabe em `src/utils/static.ts`, dentro da função `serveStatic` e de helpers privados no fim do arquivo. Não há exportação nova, não há mudança em `ServeStaticOptions`, `getMeta` ou `getContents`, e nenhum arquivo fora de `src/utils/static.ts` e `test/static.test.ts` é alterado.

Fluxo resultante para um asset encontrado:

1. `Accept-Ranges: bytes` é definido logo após a seleção do asset (`src/utils/static.ts:228`, antes da checagem de cache), para cobrir 200, 206, 304 e 416.
2. Pré-condições (`If-None-Match`, `If-Modified-Since`) avaliadas como hoje (`src/utils/static.ts:243-248`). Um 304 sai aqui, sem `Range`.
3. Se há `Range`, `size` conhecido e método GET ou HEAD, a decisão de intervalo é tomada (`parseRange` + `If-Range`).
4. Intervalo insatisfazível: 416. Intervalo válido: 206 com `Content-Range` e `Content-Length` do trecho. Qualquer outro caso: segue o fluxo atual (200 completo).

## Decisões de arquitetura

### D-01 — Helpers privados no próprio `static.ts`

**Contexto.** O `AGENTS.md` pede arquivos com menos de 200 linhas e helpers em `utils/internal/` quando maiores. O `pedido.md` e o RF-13 pedem que a lógica auxiliar fique privada no módulo de `serveStatic`.

**Alternativas.**
- (a) Criar `src/utils/internal/range.ts` com as funções e importá-las em `static.ts`.
- (b) Colocar as funções no fim de `src/utils/static.ts`, como já é feito com `parseAcceptEncoding` e `idSearchPaths` (`src/utils/static.ts:292`, `src/utils/static.ts:340`).

**Escolha: (b).** O pedido é explícito e a convenção já é seguida no mesmo arquivo para lógica análoga de cabeçalhos. O custo é o arquivo passar de 351 para cerca de 430 linhas, acima da meta de 200. Registrado em R-11.

### D-02 — Interpretação do `Range`: apenas um intervalo `bytes`

**Escolha.** Função `parseRange(header, size)` que devolve um de três valores:
- `ByteRange` (`{ start, end }`, ambos inclusivos e já limitados ao tamanho), para intervalo válido;
- `kUnsatisfiable`, para intervalo sintaticamente válido sem sobreposição (RF-06);
- `undefined`, para qualquer caso que deve ser ignorado (RF-05, RF-07).

A sintaxe é validada por uma única expressão regular sobre o valor inteiro:

```ts
const RANGE_RE = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i;
```

Regras, na ordem:
1. Sem `Range`, ou `size === undefined`: `undefined`.
2. Não casa com `RANGE_RE`, ou ambos os lados vazios (`bytes=-`), ou `bytes=500-200`: `undefined`. Unidade diferente de `bytes` e lista com vírgula (`0-1,3-4`) também não casam e, portanto, caem aqui.
3. Lado inicial vazio (`-N`): se `N === 0` ou `size === 0`, `kUnsatisfiable`; senão `start = max(size - N, 0)`, `end = size - 1`.
4. Lado inicial presente: se `start >= size`, `kUnsatisfiable` (cobre `bytes=1000-1500` com size 1000 e `bytes=0-` com size 0). Senão `end = min(endOuSizeMenos1, size - 1)`.

Justificativa: a expressão regular cobre a sintaxe inteira com uma linha e evita um parser. `\d*` aceita string vazia, por isso a verificação de ambos os lados vazios é explícita. Valores grandes demais para `Number` (mais de 15 dígitos) não aparecem nos testes e ficam registrados em R-12.

**Alternativas.** Parser manual com `split("-")`: mais código, mesmo resultado. Rejeitada.

### D-03 — `If-Range`: validador forte e igualdade exata de data

**Contrato.**

```ts
function matchesIfRange(ifRange: string, meta: { etag?: string; mtimeDate?: Date }): boolean;
```

- Se `ifRange` começa com `"` ou `W/"`, é um entity-tag: vale somente se `meta.etag` existe, não começa com `W/`, e é igual a `ifRange` (comparação forte, RFC 9110 §13.1.5). Caso contrário `false`.
- Caso contrário, é uma data: vale somente se `meta.mtimeDate` existe e `new Date(ifRange).getTime() === meta.mtimeDate.getTime()`. `mtimeDate` já é truncado em segundos (`src/utils/static.ts:232`), o que resolve R-04 do PRD.
- Sem `If-Range`: o `Range` vale.

Se `false`, o `Range` é ignorado e segue o 200 completo (RF-08).

**Alternativa.** Comparar com `weak` também. Rejeitada: a RFC proíbe para `If-Range`.

**Observação sobre a fixture de teste.** `test/static.test.ts:15` usa `etag: "w/123"` sem aspas e minúsculo. Essa string não começa com `W/`, então é tratada como forte. Os testes novos usam ETag com aspas (`"v1"`).

### D-04 — Onde o `Range` entra no fluxo de `serveStatic`

**Escolha.** A decisão de intervalo é tomada depois do cálculo de `Content-Encoding` (`src/utils/static.ts:264-266`) e antes do bloco de `Content-Length` a partir do `meta` (`src/utils/static.ts:268-270`). Isso garante que a sobrescrita do `Content-Length` em D-05 vença o valor do `meta`.

Pseudocódigo do trecho:

```ts
const range = event.req.headers.get("range") ? parseRange(...) : undefined
if (range === kUnsatisfiable) → 416 (D-08)
if (range && (GET || HEAD) && (!ifRange || matchesIfRange(...))) → 206 (D-06, D-07)
// caso contrário: fluxo atual, sem alteração
```

Como o 304 já retornou em `src/utils/static.ts:243-248`, RF-09 vale sem código extra.

Para método diferente de GET e HEAD, o retorno 405 (`src/utils/static.ts:116-122`) acontece antes, então `Range` não interfere (RF-11).

### D-05 — `Content-Length` do 206 e do 416 vai para `event.res.headers`

**Problema verificado.** `prepareResponse` mescla os cabeçalhos preparados de `event.res` por cima dos cabeçalhos do `HTTPResponse`: `mergeHeaders(res.headers, preparedHeaders)` (`src/response.ts:203`), e `mergeHeaders` faz `target.set` para todos os nomes que não são `set-cookie` (`src/response.ts:243-252`). Se o 206 definisse `content-length` só em `new HTTPResponse(body, { headers })`, o valor de `event.res` (tamanho total, definido em `src/utils/static.ts:269`) o sobrescreveria, e o cliente receberia `Content-Length: 1000` com 500 bytes.

**Escolha.** Em 206 e 416, `Content-Length` é definido com `event.res.headers.set("content-length", ...)`, o que substitui o valor de `meta.size`. `Content-Range` pode ir em `event.res.headers` ou nas `init.headers` do `HTTPResponse`; para manter um único lugar, usar `event.res.headers` também.

Isso altera a premissa P5 do PRD só para respostas parciais. O teste existente `test/static.test.ts:600-617` cobre o caso sem `Range` e continua válido.

### D-06 — Recorte do corpo para 206

**Contrato.**

```ts
function sliceBody(body: BodyInit, start: number, end: number): BodyInit;
function sliceStream(source: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array>;
```

- `body instanceof Blob`: `body.slice(start, end + 1)`. Sem leitura antecipada.
- Demais tipos de `BodyInit` (string, `ArrayBuffer`, views, `FormData`, `URLSearchParams`, `ReadableStream`): `new Response(body).body` produz um `ReadableStream<Uint8Array>` com a mesma representação que o runtime enviaria, e esse stream passa por `sliceStream`. Isso reaproveita a codificação UTF-8 de strings que o h3 já usa.
- `sliceStream` lê chunks, descarta o que está antes de `start`, envia o que está em `[start, end]`, e ao atingir `end` fecha o stream de saída e chama `reader.cancel()` na origem (RF-12). `cancel` do stream de saída repassa para a origem.

Esboço de `sliceStream` (sem código de produção ainda):

```ts
return new ReadableStream({
  async pull(controller) {
    const { done, value } = await reader.read();
    if (done) return controller.close();
    const chunkStart = offset;
    offset += value.byteLength;
    const from = Math.max(start - chunkStart, 0);
    const to = Math.min(end + 1 - chunkStart, value.byteLength);
    if (from < to) controller.enqueue(value.subarray(from, to));
    if (offset > end) {
      controller.close();
      await reader.cancel();
    }
  },
  cancel: (reason) => reader.cancel(reason),
});
```

**Alternativas.**
- Ler o corpo inteiro em `ArrayBuffer` e fatiar. Simples, mas carrega o arquivo todo na memória, o que R1 do PRD quer evitar.
- Incluir `start` e `end` em `getContents`. Fora de escopo (PRD, "Fora de escopo").

### D-07 — HEAD não chama `getContents`

Em HEAD com intervalo válido, o `serveStatic` define `Content-Range`, `Content-Length` e status 206, e devolve `new HTTPResponse(null, { status: 206 })` antes de qualquer chamada a `getContents` (RF-12, último caso). Isso segue o HEAD atual em `src/utils/static.ts:272-274`.

### D-08 — 416 e cabeçalhos que o acompanham

Em 416:
- `event.res.headers.set("content-range", \`bytes */${size}\`)`;
- `event.res.headers.set("content-length", "0")`;
- retorno `new HTTPResponse(null, { status: 416 })`, com `statusText` ausente, igual ao 206.

`Accept-Ranges`, `ETag`, `Last-Modified`, `Cache-Control` e `Vary` continuam, porque já estão em `event.res` e são mesclados em `src/response.ts:203`. `Content-Encoding` também continua; em corpo vazio é inócuo.

### D-09 — `getContents` devolve vazio com intervalo válido em GET

Para GET com intervalo válido, `getContents` é chamado antes de confirmar o 206. Se o retorno for `null` ou `undefined` (`src/utils/static.ts:277` já trata assim com `contents || null`), o `Range` é ignorado e o caminho atual de 200 é seguido. Isso evita um 206 sem corpo e com `Content-Length` diferente do corpo. Registrado em R-02.

### D-10 — Cache de rota e Range

Nenhuma mudança. `src/rules/cache.ts:143-148` já trata `Range` como bypass (`isBypassedRequest`). Isso impede que um 206 vire a entrada armazenada do recurso inteiro. Esse comportamento vale para a rota de cache de `h3/rules`, não para `serveStatic` direto.

## Arquivos a alterar

| Arquivo | Alteração | Referência no código |
| --- | --- | --- |
| `src/utils/static.ts` | `Accept-Ranges` após seleção do asset; bloco de intervalo entre encoding e content-length; helpers privados no fim | `src/utils/static.ts:228` (mtime), `src/utils/static.ts:243-248` (304), `src/utils/static.ts:264-270` (encoding e content-length), `src/utils/static.ts:272-277` (HEAD e corpo) |
| `test/static.test.ts` | Novo bloco `describeMatrix("serve static range", …)`; nenhum teste existente alterado | `test/static.test.ts:5` (bloco atual), `test/static.test.ts:600-617` (content-length), `test/static.test.ts:626` (bloco malformed) |

Não alterar: `src/index.ts:193` (exports), `src/response.ts`, `src/utils/internal/cache.ts:29`, `src/rules/cache.ts`, `src/utils/sanitize.ts`.

Verificado no código: `src/utils/sanitize.ts:28-29` aceita qualquer inteiro de 100 a 599, então 206 e 416 passam sem mudança.

Nenhum teste existente envia `Range` (busca por `range` em `test/static.test.ts` sem resultados), e a única checagem de cabeçalhos do arquivo é `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`), então o novo `Accept-Ranges` não quebra testes atuais. Isso fecha R5 do PRD.

## Contratos

Nenhum contrato público muda:

```ts
// src/utils/static.ts (inalterado)
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType?; }
export function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

Símbolo e helpers, todos privados (não exportados):

```ts
const kUnsatisfiable: unique symbol = Symbol("unsatisfiable");  // prefixo k, convenção do AGENTS.md
type ByteRange = { start: number; end: number };

function parseRange(header: string, size: number | undefined): ByteRange | typeof kUnsatisfiable | undefined;
function matchesIfRange(ifRange: string, validators: { etag?: string; mtimeDate?: Date }): boolean;
function sliceBody(body: BodyInit, start: number, end: number): BodyInit;
function sliceStream(source: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array>;
```

Resposta por caso:

| Situação | Status | Cabeçalhos extras | Corpo |
| --- | --- | --- | --- |
| Asset encontrado, sem `Range` | 200 | `Accept-Ranges: bytes` | completo (inalterado) |
| 304 | 304 | `Accept-Ranges: bytes` | nenhum |
| `Range` válido, GET | 206 | `Accept-Ranges`, `Content-Range: bytes s-e/N`, `Content-Length: e-s+1` | trecho |
| `Range` válido, HEAD | 206 | idem | nenhum; `getContents` não chamado |
| `Range` insatisfazível | 416 | `Accept-Ranges`, `Content-Range: bytes */N`, `Content-Length: 0` | nenhum |
| `Range` inválido, sem `size`, ou `If-Range` falhou | 200 | `Accept-Ranges` | completo |

## Estratégia de testes

Seguindo `AGENTS.md` e R7 do PRD: escrever primeiro os testes de RF-02, RF-06 e RF-08, vê-los falhar, depois implementar.

Fixture: um asset de 1000 bytes com conteúdo previsível, por exemplo `Array.from({ length: 1000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")`, `size: 1000`, `etag: '"v1"'`, `mtime` fixo, servido em `t.app.all("/range/**", …)`. Usar `describeMatrix` para rodar em `web` e `node`.

Casos, com origem no PRD:

1. **RF-01**: GET sem `Range` contém `accept-ranges: bytes`; 304 também.
2. **RF-02**: `bytes=0-499` → 206, `content-range: bytes 0-499/1000`, `content-length: 500`, corpo igual a `slice(0, 500)`.
3. **RF-03**: `bytes=500-` → 500-999; `bytes=-200` → 800-999; `bytes=900-5000` → 900-999; `bytes=-5000` → 0-999 completo.
4. **RF-04**: HEAD `bytes=0-499` → 206 com cabeçalhos e corpo vazio.
5. **RF-05**: `bytes=500-200`, `bytes=0-1,3-4`, `items=0-1`, `bytes=abc` → 200 sem `content-range`, `content-length: 1000`, corpo completo.
6. **RF-06**: `bytes=1000-1500`, `bytes=-0` → 416 com `content-range: bytes */1000`, `content-length: 0`. Asset de 0 bytes com `bytes=0-` → 416 com `bytes */0`.
7. **RF-07**: `getMeta` sem `size`, `bytes=0-99` → 200 completo, sem `content-range`.
8. **RF-08**: ETag forte `"v1"` com `If-Range: "v1"` → 206; com `"v0"` → 200; ETag fraco `W/"v1"` com `If-Range: W/"v1"` → 200; `Last-Modified` com a mesma data em `If-Range` → 206; data diferente → 200.
9. **RF-09**: `If-None-Match: "v1"` com `Range` → 304 sem `content-range`.
10. **RF-10**: `encodings: { gzip: ".gz" }`, `app.js.gz` de 1000 bytes, `accept-encoding: gzip`, `bytes=0-99` → 206 com `content-encoding: gzip`, `content-range: bytes 0-99/1000`, `vary: accept-encoding`.
11. **RF-11**: caminho inexistente com `Range` → 404; com `fallthrough: true` → `undefined` (testar via handler que lê `undefined` e segue); POST com `Range` → 405 com `allow: GET, HEAD`.
12. **RF-12**: `getContents` com string, `Blob` e `ReadableStream` de 1000 bytes e `bytes=500-599` → corpo com exatamente 500 a 599 nos três casos. Para o stream, criar `cancel` com `vi.fn()` e assertar que foi chamado. HEAD com `Range` → `getContents` não chamado (`vi.fn` com `not.toHaveBeenCalled()`).
13. **RF-13**: teste manual ou de revisão: `git diff -- src/index.ts` vazio após a mudança. Não há teste automatizado neste ponto; registrar na revisão.
14. **RF-14**: `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck`. Nos testes existentes, nenhuma alteração é prevista.

Testes unitários de `parseRange` e `matchesIfRange` não são exportados, então são cobertos só pelos testes de integração acima. Se a cobertura de ramos ficar baixa em `parseRange`, avaliar um teste em `test/unit/` que importe via `src/utils/static.ts`; isso exigiria exportar, o que o RF-13 proíbe. Portanto, não criar.

## Riscos

- **R-01 — Custo de leitura em streams.** Sem parâmetro de intervalo, o início do stream é lido e descartado até `start` (PRD R1). Mitigação: cancelar a origem após `end` (D-06). Assets em disco grandes com `Range` no fim do arquivo vão ler o arquivo inteiro. Se isso for inaceitável, a correção é mudar `getContents`, o que está fora de escopo.
- **R-02 — `getContents` vazio com `size` conhecido.** D-09 trata por fallback para 200. Caso `size` não bata com o corpo, `Content-Length` continua divergente, como já acontece hoje.
- **R-03 — Tamanho inconsistente entre `getMeta` e `getContents`.** PRD R2 e premissa P6. Arquivo alterado no meio de uma requisição produz `Content-Range` errado. Não há mitigação no código; documentar.
- **R-04 — `If-Range` com data.** Coberto por D-03: igualdade exata após truncamento em segundos. Divergência de precisão em clientes que enviam milissegundos não é esperada, porque a data é a que o servidor emitiu.
- **R-05 — Testes existentes.** Verificado: nenhum envia `Range`, e as asserções de cabeçalhos são `toMatchObject`. Risco baixo.
- **R-06 — Asset de tamanho zero.** Com `Range`, passa a ser 416 (RF-06). Sem `Range`, nada muda (`src/utils/static.ts:268`, `meta.size > 0`). Teste explícito na lista acima.
- **R-07 — Mistura de representações em cache intermediário.** PRD R3. Comportamento previsto pela RFC.
- **R-08 — Sobrescrita de `Content-Length` pelo `event.res`.** Tratado em D-05. Se alguém futuramente definir `content-length` só em `HTTPResponse.headers`, o teste da lista 2 falha, o que cobre o regresso.
- **R-09 — `statusText` ausente em 206 e 416.** Clientes HTTP leem o código, não o texto. Mesma escolha do 200 atual.
- **R-10 — Ordem de chamadas de `getMeta` e `Accept-Ranges` em respostas 404 e 405.** `Accept-Ranges` é definido só depois de encontrar o asset, então 404 e 405 não o recebem (RF-11).
- **R-11 — Tamanho de arquivo e convenção.** `src/utils/static.ts` passa de 351 para cerca de 430 linhas, acima da meta de 200 do `AGENTS.md`. Aceito em D-01. Se a equipe preferir, a extração para `utils/internal/range.ts` é uma mudança mecânica posterior.
- **R-12 — Números grandes.** `Number` perde precisão acima de 2^53. Um `Range` com dígitos além disso é tratado como intervalo inválido ou insatisfazível; sem impacto prático com arquivos reais.
- **R-13 — Divergência entre AGENTS.md e `package.json`.** `AGENTS.md` diz que `pnpm lint` inclui typecheck. Em `package.json:46`, `lint` roda só `oxlint` e `oxfmt --check`, e `typecheck` é separado (`package.json:54`). A verificação deste trabalho roda os dois explicitamente.
- **R-14 — Rota de cache.** D-10: `h3/rules` já ignora `Range`. Qualquer mudança futura nessa regra precisa manter o bypass.

## Ordem de execução sugerida

1. Escrever os testes de RF-02, RF-06 e RF-08 em `test/static.test.ts`; rodar e confirmar que falham.
2. Implementar `parseRange`, `matchesIfRange`, `sliceBody` e `sliceStream` no fim de `src/utils/static.ts`.
3. Inserir `Accept-Ranges` e o bloco de intervalo em `serveStatic`.
4. Completar os testes restantes da lista.
5. Rodar `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck` e, por fim, `pnpm vitest run` completo.
