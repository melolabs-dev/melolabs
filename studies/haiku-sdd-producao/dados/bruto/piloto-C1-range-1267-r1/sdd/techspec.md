# Especificação técnica — Suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-09 e premissas P1 a P7). Este documento não altera código; as citações `arquivo:linha` foram conferidas no código atual do clone.

Estado do repositório antes da tarefa (não causado por este trabalho): `test/unit/cli.test.ts` aparece como removido no `git status`. Não foi tocado.

## Resumo do desenho

- Toda a lógica nova fica em `src/utils/static.ts`, em funções privadas (sem `export`). Nenhum arquivo público muda; `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`.
- O `Range` é aplicado depois da seleção de variante, da checagem de cache (304) e da definição de `content-type`/`content-encoding`, e antes do `content-length` padrão.
- O corpo é fatiado sem ser carregado inteiro: `Blob.slice` quando o corpo é `Blob`; para os demais tipos, `Response` + `TransformStream` que descarta bytes e encerra cedo.
- Premissas P1 a P7 do PRD ficam confirmadas, exceto P4 e P6, que recebem decisão explícita em D-05 e D-08 (ver "Pontos a confirmar").

## Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Escolha:** funções privadas em `src/utils/static.ts`: `parseRangeHeader`, `ifRangeMatches`, `strongETagMatch` e `sliceBody` (assinaturas na seção de contratos).

**Alternativas consideradas:**
- Novo arquivo `src/utils/internal/range.ts`. O `AGENTS.md` ("Internal helpers go ... in `utils/internal/`") e o limite de ~200 LoC por arquivo apontam para isso. Foi descartado porque o contrato (`sdd/pedido.md`, "O que não pode mudar", e o PRD RF-09 e R6) exige que as auxiliares fiquem "privadas dentro do módulo, sem `export`", e o issue pede "Keep all helper logic private within the serveStatic module".
- Reusar `matchETag` de `src/utils/internal/cache.ts:11`. Descartado: a comparação ali é fraca (ignora `W/`), e If-Range exige comparação forte.

**Justificativa:** segue o contrato literalmente. Custo aceito: `static.ts` tem 351 linhas hoje (`src/utils/static.ts:351`) e passará de 450. Isso desrespeita a convenção de ~200 LoC do `AGENTS.md`; fica registrado em R7.

### D-02 — Como fatiar o corpo sem carregar o arquivo inteiro

**Contexto:** `getContents(id)` devolve o `BodyInit` completo e não recebe intervalo (`src/utils/static.ts:33`). O PRD (P2, R1) pede que o fatiamento não carregue tudo na memória.

**Escolha:**
- Se `contents instanceof Blob`: `contents.slice(start, end + 1)`. É preguiçoso em todos os runtimes que o h3 suporta.
- Caso contrário: `new Response(contents).body` encadeado com um `TransformStream` que conta bytes, emite só o trecho e chama `controller.terminate()` ao passar do `end`. O `terminate` fecha o lado legível e faz o `pipeThrough` cancelar a origem, então o restante do arquivo não é lido.
- O `new Response(contents)` usa a mesma codificação que um `Response` normal usaria para strings, então o corpo é idêntico ao da resposta 200.

**Alternativas consideradas:**
- `new Response(contents).arrayBuffer()` e `slice`. Descartado: carrega o arquivo inteiro (R1).
- Mudar `getContents` para receber intervalo. Descartado: o contrato proíbe mudar assinaturas de `getMeta`/`getContents` (`sdd/pedido.md`, "Fora de escopo" do PRD, linha 111).
- Usar só o `TransformStream` para todos os tipos. Descartado: `Blob.slice` é mais barato e evita stream para o caso mais comum de arquivos em disco.

### D-03 — Ordem de avaliação e pontos de inserção em `serveStatic`

Ordem da RFC 9110 §13.2.2 preservada: condicionais de cache primeiro (304), depois `If-Range`, depois `Range`.

Pontos no arquivo atual:

| Passo | Local atual | Ação |
|---|---|---|
| `Accept-Ranges: bytes` | depois de `src/utils/static.ts:248` (fim do bloco 304) | `event.res.headers.set("accept-ranges", "bytes")` |
| Cálculo do Range | depois de `src/utils/static.ts:266` (`content-encoding`), antes de `src/utils/static.ts:268` (`content-length`) | ver esboço abaixo |
| `content-length` padrão | `src/utils/static.ts:268-270` | sem mudança; para 206 e 416 o ramo do Range já definiu o valor e o `!get("content-length")` pula |
| HEAD | `src/utils/static.ts:272-274` | sem mudança; o ramo do Range trata HEAD parcial antes |
| GET | `src/utils/static.ts:276-277` | sem mudança no caminho sem Range |

Esboço do ramo do Range (pseudocódigo para ilustrar a ordem, não código final):

```ts
const rangeHeader = event.req.headers.get("range");
if (rangeHeader && meta.size !== undefined) {
  const ifRange = event.req.headers.get("if-range");
  if (!ifRange || ifRangeMatches(ifRange, meta.etag)) {
    const parsed = parseRangeHeader(rangeHeader, meta.size);
    if (parsed === "unsatisfiable") {
      event.res.headers.set("content-range", `bytes */${meta.size}`);
      event.res.headers.set("content-length", "0");
      return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
    }
    if (parsed) {
      // GET: buscar contents aqui; se null, cair no 200 atual (D-07)
      // HEAD: sem getContents
      // set content-range, content-length = end - start + 1 (sobrescreve, D-06)
      // retornar 206 (GET com sliceBody, HEAD sem corpo)
    }
  }
}
```

### D-04 — Interpretação do cabeçalho `Range`

**Regra:** só um intervalo, sintaxe `^bytes=(\d*)-(\d*)$` aplicada ao valor com `trim()`. A unidade é case-insensitive (RFC 9110 §14.1).

| Entrada (N = tamanho) | Resultado |
|---|---|
| unidade diferente de `bytes`, sintaxe inválida, vírgula (multi-range), `bytes=-` | ignorar (200 normal) |
| `a-b` com `a > b` | ignorar (200 normal) — RF-05 |
| `a-b` com `a >= N` | 416 |
| `a-b` com `a < N`, `b >= N` | 206 com fim = N - 1 (RF-03) |
| `a-` com `a >= N` | 416 |
| `a-` com `a < N` | 206, fim = N - 1 |
| `-n` com `n = 0` | 416 (P3) |
| `-n` com `n > 0`, `N > 0` | 206, início = max(0, N - n), fim = N - 1 (P7) |
| qualquer intervalo com `N = 0` | 416 (sem intervalo satisfazível) |

Dígitos com mais de 15 caracteres são tratados como sintaxe inválida (ignorar), para não perder precisão em `Number`.

**Alternativas consideradas:** parser completo de `#range-spec` (aceitaria multi-range e exigiria `multipart/byteranges`, fora de escopo, RF-05). Descartado.

**Justificativa:** o contrato separa "ignorar" (malformado, multi-range) de "416" (início fora do arquivo). A tabela mantém essa separação.

### D-05 — `If-Range`

- Sem `If-Range`: o Range é aplicado.
- Com `If-Range` começando por `"` ou `W/"`: corresponde só se for entity-tag **forte** (sem `W/`) e igual, caractere a caractere, ao `meta.etag`. A comparação é feita com `strongETagMatch`, privada em `static.ts`.
- Com `If-Range` sem `"` inicial (data HTTP): não corresponde, então o Range é ignorado e a resposta é 200 (P6, mantida).
- `meta.etag` ausente: não corresponde.

**Observação:** `test/static.test.ts:15` usa `etag: "w/123"`, sem aspas e com `w/` minúsculo. A regra "só `W/` maiúsculo é fraco" deve ser preservada tal como o `opaqueTag` atual (`src/utils/internal/cache.ts:52`) faz, e o teste de If-Range não deve depender desse fixture.

**Alternativa considerada:** aceitar data igual a `last-modified` (RFC 9110 §13.1.5). Descartada por ora, conforme P6 do PRD; é uma pendência para confirmar.

### D-06 — `content-length` do 206 sobrescreve valor prévio

Hoje `src/utils/static.ts:268` só define `content-length` se ele não existir, e o teste `test/static.test.ts:600-617` garante que um `content-length` explícito (`options.headers`) vence. Para respostas 206 essa precedência é **incorreta**: um `content-length` diferente do trecho quebra o protocolo.

**Escolha:** em 206 e 416, o ramo do Range usa `event.res.headers.set("content-length", ...)`, sobrescrevendo qualquer valor. O comportamento sem `Range` não muda, então o teste de `test/static.test.ts:600-617` continua válido.

**Alternativa:** respeitar o `content-length` existente também em 206. Descartada: quebra o contrato de `Content-Length` igual ao trecho (contrato, item 3).

### D-07 — Casos de borda

- **`getContents` devolve `null`/`undefined` em GET com Range válido:** ignorar o Range e seguir o fluxo atual (200 com corpo vazio, como hoje em `src/utils/static.ts:277`). O `Content-Range` ainda não foi gravado nesse caso, porque `getContents` é chamado antes de definir os cabeçalhos do 206.
- **`meta.size === 0`:** `src/utils/static.ts:268` não define `content-length` para tamanho 0 (guarda `meta.size > 0`). Com Range, a resposta é 416 (D-04), com `Content-Length: 0` definido explicitamente pelo ramo do Range.
- **`size` maior ou menor que o conteúdo real:** o `Blob.slice` e o stream param no `end` calculado a partir de `size`. Se o conteúdo for menor, o corpo sai truncado; é o risco R2, coberto por documentação e teste de regressão, sem validação extra.

### D-08 — Em quais respostas vai `Accept-Ranges`

**Escolha:** `Accept-Ranges: bytes` em 200, 206 e 416 (todas as que servem um asset encontrado). Não vai em 304, 404 e 405 (P4 confirmada).

**Alternativa:** pôr também no 304 (a RFC permite). Descartada: o contrato diz "toda resposta que serve um asset", e o 304 não serve. A definição é feita depois de `src/utils/static.ts:248`, para o 304 não herdar o cabeçalho (o `event.res.headers` é mesclado ao `HTTPResponse` em `src/response.ts:201-204`).

### D-09 — Superfície pública e cache

- Nenhuma mudança em `ServeStaticOptions` (`src/utils/static.ts:17-66`), em `StaticAssetMeta` (`src/utils/static.ts:9-15`) nem em `src/index.ts`.
- `Vary` já é definido antes do ponto de inserção (`src/utils/static.ts:220-225`), então as parciais mantêm `vary: accept-encoding` (R4).
- `src/rules/cache.ts:148` já ignora requisições com `Range` no cache de regras; isso continua valendo e não é alterado (fora de escopo, PRD linha 112).

## Contratos e assinaturas

Públicos (sem alteração):

```ts
export function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

Privados em `src/utils/static.ts` (nenhum com `export`):

```ts
type ByteRange = { start: number; end: number };

/** undefined = ignorar o Range; "unsatisfiable" = 416; ByteRange = 206. */
function parseRangeHeader(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Avalia If-Range; true quando o Range deve ser aplicado. */
function ifRangeMatches(ifRange: string, etag: string | undefined): boolean;

/** Comparação forte (RFC 9110 §8.8.3.2): falso se algum lado for `W/`. */
function strongETagMatch(a: string, b: string): boolean;

/** Devolve só o trecho [start, end] do corpo. Blob usa slice; demais tipos usam stream. */
function sliceBody(body: BodyInit, start: number, end: number): BodyInit;
```

Respostas por caso:

| Caso | Status | Cabeçalhos relevantes | Corpo |
|---|---|---|---|
| Sem `Range`, ou Range ignorado | 200 | `accept-ranges: bytes` + cabeçalhos atuais | completo (GET) / vazio (HEAD) |
| Range válido | 206 | `accept-ranges`, `content-range: bytes a-b/N`, `content-length: b-a+1` | trecho (GET) / vazio (HEAD) |
| Range não satisfazível | 416 | `accept-ranges`, `content-range: bytes */N`, `content-length: 0` | vazio |
| Condicional 304 | 304 | sem `accept-ranges` (D-08); `etag`, `last-modified`, `vary` como hoje | vazio |
| 404, 405, fallthrough | inalterados | inalterados | inalterados |

Cabeçalhos de conteúdo e cache (`etag`, `last-modified`, `cache-control`, `vary`, `content-type`, `content-encoding`) são os mesmos em 200 e 206 (RF-09).

## Estratégia de testes

Arquivo: `test/static.test.ts`, em um novo `describeMatrix("serve static (range)", ...)` com `beforeEach` próprio. Matriz `web` e `node` (`AGENTS.md`, "Testing"). O fixture `beforeEach` existente (linhas 6-31) gera conteúdo `asset:${id}` com `size` igual ao comprimento; os testes calculam o esperado a partir desse conteúdo.

Fluxo (AGENTS, "Bug Fix Workflow", adaptado para feature): primeiro os testes de regressão de comportamento atual (sem Range), que devem passar antes e depois; depois os testes de Range, que devem falhar antes da implementação.

Casos obrigatórios, por requisito:

1. **RF-01:** `GET` e `HEAD` sem `Range` em asset encontrado trazem `accept-ranges: bytes`; 304 não traz; 404 e 405 não trazem.
2. **RF-02:** `bytes=a-b`, `bytes=a-` e `bytes=-n` retornam 206 com `content-range` e `content-length` corretos e corpo exato (`text()` comparado com `slice`).
3. **RF-03:** `b >= N` limita a `N-1`; `-n` com `n > N` retorna o arquivo inteiro com 206 (P7).
4. **RF-04:** `a >= N` retorna 416, `content-range: bytes */N`, `content-length: 0`, corpo vazio. Inclui `N = 0` (D-07).
5. **RF-05:** multi-range (`bytes=0-1,3-4`), unidade `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=-0` (este último é 416, P3), `bytes=-` e dígitos com 16 ou mais caracteres: 200 completo, sem `content-range`.
6. **RF-06:** `HEAD` com Range válido e não satisfazível tem o mesmo status e os mesmos `content-range`/`content-length` que o `GET`, com corpo vazio. Verificar que `getContents` não é chamado no `HEAD`.
7. **RF-07:** com `encodings: { gzip: ".gz" }` e `accept-encoding: gzip`, `Range: bytes=0-9` usa o tamanho de `getMeta` do id `.gz` e mantém `content-encoding: gzip`.
8. **RF-08:** `If-Range` com `"v0"` → 200; com `"v1"` → 206; com `W/"v1"` → 200; sem `If-Range` → 206; `If-Range` com data → 200 (P6).
9. **RF-09:** cabeçalhos `etag`, `last-modified`, `cache-control`, `vary` iguais em 200 e 206; `If-None-Match` com Range → 304 (ordem da RFC); `fallthrough` com Range em asset inexistente passa adiante; `src/index.ts` sem linhas novas (`git diff -- src/index.ts` vazio).
10. **Regressão:** o teste existente `test/static.test.ts:600-617` (content-length explícito em HEAD sem Range) continua passando.
11. **Fatiamento:** um `getContents` que devolve `ReadableStream` (com chunks de tamanhos irregulares) e outro que devolve `Blob` retornam o mesmo trecho. Um teste verifica que o stream é cancelado após `end` (contador de chunks lidos menor que o total).
12. **Pré-comprimido sem `getContents` válido:** `getContents` devolve `null` com Range válido → 200 como hoje (D-07).

Comandos: `pnpm vitest run test/static.test.ts`, depois `pnpm test` (lint, typecheck e cobertura), depois `pnpm build` para conferir que o `dist` gera sem erro de tipos.

## Riscos

- **R1 — memória com arquivos grandes.** Mitigado pelo D-02 (`Blob.slice` e stream com `terminate`). Risco residual: `getContents` que já bufferiza internamente (fora do controle do h3). Documentar na JSDoc de `getContents`.
- **R2 — `size` divergente do conteúdo.** Se `getMeta.size` estiver errado, `content-range` e `content-length` ficam errados (o trecho sai truncado ou o `content-length` diverge). Mitigação: documentar a exigência de `size` correto; teste 11.
- **R3 — regressão em 200, 304, 404, 405, fallthrough, encoding.** Mitigação: testes de regressão antes da mudança (fluxo acima) e a suíte existente.
- **R4 — cache de variantes.** Parciais de `.gz` e de identidade compartilhariam chave se `Vary` faltasse. Mitigação: `vary: accept-encoding` já é definido em `src/utils/static.ts:220-225` e o teste 7 verifica.
- **R5 — proxies e CDNs.** Comportamento divergente em 416, HEAD ou If-Range pode quebrar clientes de mídia. Mitigação: seguir a RFC nos casos cobertos; P3, P4, P6 e P7 registrados para revisão.
- **R6 — vazamento de API pública.** Mitigação: funções sem `export` e verificação de `src/index.ts` (teste 9).
- **R7 — tamanho do arquivo.** `src/utils/static.ts` passa de 450 linhas, contra a convenção de ~200 do `AGENTS.md`. Aceito por causa do contrato (D-01). Sugestão de follow-up: mover o parser para um módulo interno quando o contrato permitir.
- **R8 — precedência de `content-length` mudada só em 206 e 416 (D-06).** Mudança deliberada; o teste 10 cobre o caso sem Range.
- **R9 — comparação de etag.** Fixture com `etag: "w/123"` (`test/static.test.ts:15`) não segue a RFC; a comparação forte só trata `W/` maiúsculo, como o código atual. Risco de confusão em testes, não de produção.
- **R10 — interação com `h3/rules` cache.** `src/rules/cache.ts:148` ignora Range; as parciais não são cacheadas pelo cache de regras. Comportamento correto e fora de escopo.
- **R11 — comportamento do `TransformStream.terminate` por runtime.** Node, Bun, Deno e Workers podem diferir no cancelamento da origem. Mitigação: teste 11 roda na matriz `web` e `node`; se houver divergência, a fallback é ler e descartar (sem early-stop), com o custo de I/O documentado.
- **R12 — 416 com cabeçalhos de conteúdo.** Em 416, `content-type` e `content-encoding` já definidos ficam na resposta. Aceito: a RFC não proíbe e o contrato não os lista como proibidos.

## Pontos a confirmar

1. **P4 (D-08):** confirmar que 304 não recebe `accept-ranges`.
2. **P6 (D-05):** confirmar que `If-Range` com data não corresponde (200 completo). A alternativa da RFC (comparar com `last-modified`) fica para depois.
3. **D-01 / R7:** confirmar que o arquivo ultrapassar a convenção de tamanho é aceitável nesta entrega.
