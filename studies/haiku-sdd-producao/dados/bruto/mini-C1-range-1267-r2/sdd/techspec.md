# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-10). Este documento fixa as decisões de implementação. Todas as referências de linha foram conferidas no código do repositório na branch `master`.

## 1. Escopo resumido

- Alterar somente `src/utils/static.ts` (implementação) e `test/static.test.ts` (novos testes).
- Nenhuma exportação nova em `src/index.ts`, nenhuma opção nova em `ServeStaticOptions`, nenhuma mudança em `getMeta`/`getContents`.
- Métodos além de `GET` e `HEAD` continuam recebendo 405.
- O corpo é obtido inteiro de `getContents` e o trecho é extraído em memória (leitura parcial no backend fica fora de escopo, conforme o PRD).

## 2. Estado atual relevante

| Ponto | Local |
| --- | --- |
| Assinatura de `serveStatic` | `src/utils/static.ts:101-104` |
| Tipo `StaticAssetMeta` (`size?: number`) | `src/utils/static.ts:9-15` |
| `getContents` retorna `BodyInit \| null \| undefined` | `src/utils/static.ts:33` |
| Resposta 405 para métodos que não são GET/HEAD | `src/utils/static.ts:116-122` |
| Checagem de caminho canônico (404 ou fallthrough) | `src/utils/static.ts:142-147` |
| Busca de `meta` por variante (encoding, index) | `src/utils/static.ts:192-215` |
| `Vary: accept-encoding` quando há encodings | `src/utils/static.ts:220-225` |
| `mtimeDate` truncado em segundos | `src/utils/static.ts:227-237` |
| `etag` definido se ausente | `src/utils/static.ts:239-241` |
| Resposta 304 (`isCacheMatch`) | `src/utils/static.ts:243-248` |
| `content-type` / `content-encoding` | `src/utils/static.ts:250-266` |
| `content-length` a partir de `meta.size` (só se `> 0` e ausente) | `src/utils/static.ts:268-270` |
| Resposta HEAD (sem `getContents`) | `src/utils/static.ts:272-274` |
| Resposta 200 com `getContents` | `src/utils/static.ts:276-277` |
| Seção de helpers privados (padrão a seguir) | `src/utils/static.ts:280` a `:351` |
| Exportação pública do módulo | `src/index.ts:193` |
| `HTTPResponse` (init de status e headers) | `src/response.ts:96-124` |
| Mescla de cabeçalhos preparados em respostas não-`Response` | `src/response.ts:188-205` |
| Para `Response` nativo com status ≥ 400, só `errHeaders` são mesclados | `src/response.ts:211-213` |
| `mergeHeaders`: os cabeçalhos preparados sobrescrevem | `src/response.ts:243-252` |
| `nullBody`: HEAD, 204, 304 etc. sem corpo | `src/response.ts:350-356` |
| `sanitizeStatusCode` (aceita 206 e 416) | `src/utils/sanitize.ts:17` |
| Bypass de `Range` no cache de regras | `src/rules/cache.ts:146-149` |
| Avaliação de `If-None-Match` / `If-Modified-Since` | `src/utils/internal/cache.ts:29-49` |
| Tratamento de tag fraca (`W/`) | `src/utils/internal/cache.ts:51-53` |
| Teste de snapshot das exportações do pacote | `test/unit/package.test.ts:133` |
| Matriz `web` / `node` | `test/_setup.ts:11` (`describeMatrix`) |

Testes existentes que tocam o caminho: `test/static.test.ts:42-55` (GET 200), `:57-71` (HEAD 200), `:199-207` (304 por ETag), `:209-217` (304 por data), `:219-225` (404), `:251-254` (405), `:600-617` (`content-length` explícito preservado em HEAD sem Range), `:396-523` (fallthrough), `:328-352` (guarda de `use()`).

Não há nenhum `Range`, `Accept-Ranges`, `Content-Range` ou `If-Range` em `src/` ou `test/static.test.ts`. O único `range` em `test/` é `test/rules/cache.test.ts:1220`, que testa o bypass do cache de regras.

## 3. Decisões de arquitetura

### D-01 — Implementar dentro de `serveStatic`, sem opção nova nem helper exportado

**Decisão:** toda a lógica entra em `serveStatic` e em funções privadas no fim de `src/utils/static.ts`, seguindo o padrão de `parseAcceptEncoding` e `idSearchPaths` (`src/utils/static.ts:292`, `:340`).

**Alternativas consideradas:**
- Nova opção `ranges: boolean` em `ServeStaticOptions`. Rejeitada: o pedido proíbe nova opção pública (PRD RF-09).
- Middleware ou handler separado de Range. Rejeitado: duplicaria a seleção de `meta`/variante e a ordem de checagens, e ficaria fora do fluxo de `serveStatic`.
- Helpers em `src/utils/internal/range.ts`. Considerada: não é exportada e evita que `static.ts` ultrapasse o limite de ~200 linhas de AGENTS.md. Rejeitada porque o pedido diz que as funções auxiliares "ficam privadas no módulo" e o padrão atual já mantém helpers no próprio arquivo.

**Trade-off aceito:** `static.ts` passa de 351 para cerca de 430 linhas, acima da meta de 200 linhas. Está registrado em Riscos.

### D-02 — Ordem de avaliação: Range por último entre as checagens de cabeçalho

**Decisão:** o `Range` é avaliado depois do 304 (`src/utils/static.ts:243-248`) e depois dos cabeçalhos de representação (`:250-270`), mas antes de `getContents`. Dentro de `Range`, `If-Range` é avaliado antes da validade do intervalo.

Essa é a ordem da RFC 9110 §13.2.2: `If-Match`, `If-Unmodified-Since`, `If-None-Match`, `If-Modified-Since`, `If-Range`, `Range`. Ela mantém o RF-08: um 304 continua 304 mesmo com `Range` válido.

**Alternativa:** avaliar `Range` logo após `meta` (antes do 304). Rejeitada: violaria a ordem da RFC e o RF-08.

### D-03 — Validação de `If-Range`

**Decisão:**
- Sem cabeçalho `If-Range`: `Range` é avaliado normalmente.
- `If-Range` com ETag: atende somente se a string for idêntica a `meta.etag`, e nenhum dos dois começar com `W/` (comparação forte, RFC 9110 §13.1.5).
- `If-Range` com data: atende somente se `new Date(valor).getTime()` for igual a `mtimeDate.getTime()`. `mtimeDate` já está truncado em segundos (`src/utils/static.ts:232`). Data inválida (`NaN`) nunca atende.
- Se `meta.etag` ou `mtimeDate` não existirem, o validador correspondente nunca atende. Nesse caso o `Range` é ignorado e a resposta é 200.
- `If-Range` com validador que não atende faz o `Range` ser ignorado, e a resposta é 200 completa.

**Alternativa:** reaproveitar `opaqueTag` de `src/utils/internal/cache.ts:51`. Não é exportada, e a comparação forte exige não só ignorar `W/` mas rejeitá-lo. Uma função própria é mais simples.

**Observação:** o `W/` é case-sensitive pela RFC. O fixture atual de `test/static.test.ts` usa `etag: "w/123"` (minúsculo), que não é tag fraca para esta regra. Os testes novos usam ETag com aspas.

### D-04 — Extração do trecho: `Blob.slice` quando possível, senão materializar

**Decisão:** o trecho é extraído do corpo devolvido por `getContents`:
- Se `contents instanceof Blob` (inclui `File`), usar `contents.slice(start, end + 1)`. Não materializa o arquivo.
- Caso contrário, `new Response(contents).arrayBuffer()` e depois `new Uint8Array(buffer, start, end - start + 1)`. Isso converte strings para bytes UTF-8 e lida com `ReadableStream`, `ArrayBuffer` e `TypedArray`.

**Alternativas consideradas:**
- Ler e descartar bytes de um `ReadableStream` até `start`. Rejeitada para esta entrega: mais código, e o PRD deixa a otimização de streaming fora de escopo.
- Mudar `getContents` para receber o intervalo. Proibido pelo pedido (PRD RF-09 e "Fora de escopo").

### D-05 — Cabeçalhos de 206 e 416 via `event.res.headers`, retorno como `HTTPResponse`

**Decisão:** `content-range`, `content-length` e `accept-ranges` são definidos com `event.res.headers.set(...)`. A resposta é `new HTTPResponse(body, { status, statusText })`.

**Por quê:** em `src/response.ts:243-252` (`mergeHeaders`), os cabeçalhos preparados em `event.res.headers` sobrescrevem os `headers` do init. Se o `Content-Length` do 206 fosse passado no init, seria sobrescrito pelo `meta.size` que já está em `event.res.headers`.

**Alternativas rejeitadas:**
- Retornar `new Response(..., { status: 416 })` nativo. Em `src/response.ts:211-213`, status ≥ 400 em `Response` nativo só recebe `errHeaders`, então `accept-ranges`, `content-type` e `cache-control` do 416 seriam perdidos.
- Lançar `HTTPError({ status: 416 })`. Mesma perda de cabeçalhos (`src/response.ts:211-213`) e fluxo de erro desnecessário.

### D-06 — `Content-Length` do 206 sobrescreve valores anteriores

**Decisão:** na resposta 206 (GET e HEAD), `content-length` é definido com `set`, e não com a checagem "somente se ausente" de `src/utils/static.ts:268`. Vale para o `meta.size` e para um `content-length` vindo de `options.headers` (ver `test/static.test.ts:600-617`).

**Por quê:** o corpo de um 206 tem o tamanho do trecho. Preservar `999` do exemplo do teste faria o cliente esperar mais bytes que o corpo entregue.

**Alternativa:** preservar o valor já definido. Rejeitada pelo motivo acima. O teste `:600-617` não é afetado, porque só cobre HEAD sem `Range`.

### D-07 — `Accept-Ranges` só quando o asset tem `size > 0`, e não em 304

**Decisão:** `accept-ranges: bytes` é definido somente quando `meta.size !== undefined && meta.size > 0`, e depois da checagem 304 (`src/utils/static.ts:243-248`). Assim:
- Em 200, HEAD, 206 e 416 de asset com tamanho conhecido, o cabeçalho aparece (RF-01).
- Em 304 ele não aparece, como o PRD descreve.
- Sem `size`, o servidor não anuncia um suporte que não usaria. Isso mantém "segue como hoje" (PRD, premissas).

**Alternativa:** definir sempre que o asset for encontrado. Rejeitada porque anunciaria Range para assets sem tamanho, onde o `Range` é ignorado.

### D-08 — `size` ausente ou `0`: `Range` ignorado (200)

**Decisão:** se `meta.size` for `undefined` ou `0`, o `Range` é ignorado e a resposta é 200 como hoje. Isso fecha o risco de tamanho zero do PRD (`prd.md:142`).

**Alternativa:** seguir a RFC e responder 416 para qualquer `Range` em corpo vazio. Não adotada: mudaria o comportamento atual de arquivos vazios, que o PRD quer preservar. **Precisa de confirmação** (seção 8).

### D-09 — Sintaxe e satisfatibilidade do `Range`

**Decisão:** o cabeçalho é validado com a expressão `^bytes=(\d*)-(\d*)$` sobre o valor sem espaços nas extremidades (`trim`). Depois:

| Entrada | Resultado |
| --- | --- |
| `bytes=a-b` com `a ≤ b` | `start = a`, `end = min(b, size - 1)` |
| `bytes=a-` | `start = a`, `end = size - 1` |
| `bytes=-n` com `n > 0` | `start = max(0, size - n)`, `end = size - 1` |
| `bytes=-0` | 416 (sufixo zero não é satisfazível, RFC 9110 §14) |
| `bytes=-` (as duas partes vazias) ou `bytes=` sem hífen | ignorar |
| `start ≥ size` (incluindo `a-` com `a ≥ size`) | 416 |
| `end < start` (ex.: `9-0`) | ignorar |
| Vários intervalos (vírgula), outra unidade, texto malformado | ignorar |

Quando há 416, `content-range` é `bytes */size` e `content-length` é `0`.

### D-10 — Corpo ausente em GET com `Range`: resposta 200 de hoje

**Decisão:** se `getContents` devolver `null`, `undefined` ou corpo vazio (`""`), mesmo com `Range` válido, a resposta é a 200 atual (`src/utils/static.ts:277`). Os cabeçalhos de intervalo só são definidos depois que o corpo é conhecido. Isso evita um 206 com `Content-Range` e corpo vazio.

Para HEAD, o corpo não é lido, então o 206 é emitido com base em `size`.

### D-11 — Manter o bypass de `Range` no cache de regras

**Decisão:** nenhuma alteração em `src/rules/cache.ts`. O bypass de `Range` em `src/rules/cache.ts:146-149` já impede que um 206 seja gravado como entrada completa. O pedido exige não mudar cache nem `ocache`.

## 4. Arquivos a alterar

### `src/utils/static.ts`

1. **Em `serveStatic`, após o 304** (`src/utils/static.ts:243-248`): definir `accept-ranges` quando `meta.size > 0` (D-07).
2. **Após o bloco de `content-length`** (`src/utils/static.ts:268-270`) e **antes do bloco HEAD** (`:272-274`): resolver o intervalo com `resolveRange` (D-02, D-03, D-09) e tratar:
   - `"unsatisfiable"`: retornar 416 (D-05, D-09).
   - intervalo e HEAD: definir `content-range` e `content-length` e retornar 206 sem corpo.
   - intervalo e GET: chamar `getContents`, e se houver corpo, definir os cabeçalhos e retornar 206 com `sliceContents` (D-04, D-06, D-10).
   - sem corpo em GET: seguir para o 200 atual.
3. **Helpers privados no fim do arquivo** (após `idSearchPaths`, `src/utils/static.ts:340-351`): `resolveRange`, `parseByteRange`, `isIfRangeMatch`, `sliceContents` (seção 5).
4. **JSDoc de `serveStatic`** (`src/utils/static.ts:68-100`): um parágrafo curto dizendo que `Range` de byte único é atendido em GET e HEAD. Opcional. O PRD pede apenas JSDoc mínimo.

Nenhuma outra linha de `src/utils/static.ts` muda: a ordem de `Vary`, `Last-Modified`, `ETag`, `content-type`, `content-encoding` e as respostas 404, 405 e fallthrough ficam como estão.

### `test/static.test.ts`

- Novo bloco `describeMatrix("serve static range", ...)` (`test/static.test.ts` após a linha 394), com fixture de 1000 bytes e sem `encodings` nem `encoding`, para não depender de decodificação de `content-encoding` pelo `fetch` da Node. Detalhes na seção 6.
- Não é preciso ajustar nenhum teste existente. Verifiquei que nenhum deles afirma ausência de `accept-ranges`, nem usa `Range`, nem depende de `content-length` de um 200 que mude (o `toMatchObject` aceita cabeçalhos extras).

### Não alterar

- `src/index.ts:193` (exportações).
- `test/unit/package.test.ts:133` (snapshot de exportações). Ele já é a guarda automática do RF-09. Se o snapshot mudar, a mudança é um erro.
- `src/rules/cache.ts`, `src/utils/internal/cache.ts`, `src/response.ts`.

## 5. Contratos e assinaturas

Todas as novas funções são **privadas** em `src/utils/static.ts`. Não são exportadas e não entram em `src/index.ts`.

```ts
/** Intervalo resolvido, inclusivo nas duas pontas, em bytes. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Decide o que fazer com o `Range` da requisição.
 * - `undefined`: ignorar o `Range` (responder 200 como hoje).
 * - `"unsatisfiable"`: responder 416.
 * - `ByteRange`: responder 206 com este trecho.
 */
type RangeDecision = ByteRange | "unsatisfiable" | undefined;

/** Avalia `Range` e `If-Range`. `size` deve ser `> 0`. */
function resolveRange(event: H3Event, meta: StaticAssetMeta, mtime?: Date): RangeDecision;

/** Interpreta o valor de `Range` (`bytes=...`) para um asset de `size` bytes. Não avalia `If-Range`. */
function parseByteRange(header: string, size: number): RangeDecision;

/** Verdadeiro se `If-Range` atende ao validador atual (ETag forte exato ou data igual a `mtime`). */
function isIfRangeMatch(
  ifRange: string,
  validators: { etag?: string; mtime?: Date },
): boolean;

/** Devolve apenas os bytes do intervalo, a partir do corpo de `getContents`. */
async function sliceContents(contents: BodyInit, range: ByteRange): Promise<BodyInit>;
```

Comportamento de `resolveRange`:
- Retorna `undefined` se não houver `range` na requisição, se `meta.size` for `undefined` ou `0`, ou se `If-Range` estiver presente e não atender (`isIfRangeMatch` falso).
- Caso contrário, retorna `parseByteRange(header, meta.size)`.

Efeitos de `serveStatic` por resposta:

| Caso | Status | `statusText` | `content-range` | `content-length` | `accept-ranges` | Corpo |
| --- | --- | --- | --- | --- | --- | --- |
| Asset com `size > 0`, sem `Range` válido, GET | 200 | (padrão) | — | `meta.size` | `bytes` | `getContents` |
| `Range` válido, GET, corpo obtido | 206 | `Partial Content` | `bytes s-e/N` | `e - s + 1` | `bytes` | trecho |
| `Range` válido, HEAD | 206 | `Partial Content` | `bytes s-e/N` | `e - s + 1` | `bytes` | nenhum |
| `Range` não satisfazível (GET ou HEAD) | 416 | `Range Not Satisfiable` | `bytes */N` | `0` | `bytes` | nenhum |
| 304 (antes de `Range`) | 304 | `Not Modified` | — | — | — | nenhum |

Notas de contrato:
- `N` é `meta.size`, que é o tamanho da variante escolhida (RF-08).
- `Content-Type`, `Content-Encoding`, `Vary`, `ETag`, `Last-Modified` e os cabeçalhos de `options.headers` continuam sendo os de hoje, por `event.res.headers`.
- Métodos diferentes de GET e HEAD continuam recebendo 405 antes de qualquer lógica de `Range` (`src/utils/static.ts:116-122`).

Esboço do fluxo dentro de `serveStatic` (para orientar a implementação, não é código final):

```ts
// após o bloco de content-length (src/utils/static.ts:268-270)
const range = resolveRange(event, meta, mtimeDate);
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (event.req.method === "HEAD") {
  if (range) return partialResponse(event, range, meta.size!, null);   // sem corpo
  return new HTTPResponse(null, { status: 200 });
}
const contents = await options.getContents(id);
if (range && contents) {
  return partialResponse(event, range, meta.size!, await sliceContents(contents, range));
}
return new HTTPResponse(contents || null, { status: 200 });
```

## 6. Estratégia de testes

Fluxo, conforme `AGENTS.md`: escrever os testes de regressão primeiro, ver que falham e só então implementar. Os testes novos vão em `test/static.test.ts`, com `describeMatrix` para rodar em `web` e `node`.

**Fixture:** `const body = "0123456789".repeat(100)` (1000 bytes ASCII, para que `size` em caracteres seja igual ao tamanho em bytes). `getMeta` devolve `{ type: "text/plain", etag: '"abc"', mtime: 1_700_000_000_000, size: 1000 }`. `getContents` devolve `body` via `vi.fn`, para verificar chamadas.

| Teste | Cobre | Asserção principal |
| --- | --- | --- |
| 200 e `accept-ranges` sem `Range` (GET e HEAD) | RF-01 | `status 200`, `accept-ranges: bytes` |
| Sem `accept-ranges` quando `size` é `undefined` ou `0` | D-07, D-08 | Cabeçalho ausente, `Range` ignorado |
| `bytes=0-99` | RF-02 | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo `body.slice(0, 100)` |
| `bytes=0-5000` (fim além do arquivo) | RF-02 | 206, `bytes 0-999/1000`, 1000 bytes |
| `bytes=900-` e `bytes=-100` | RF-03 | 206 e `bytes 900-999/1000`, 100 bytes cada |
| `bytes=-5000` (sufixo maior que o arquivo) | D-09 | 206, `bytes 0-999/1000` |
| HEAD `bytes=0-9` | RF-04 | 206, `content-length: 10`, corpo vazio, `getContents` não chamado |
| `bytes=0-9,20-29`, `items=0-9`, `bytes=abc`, `bytes=9-0`, `bytes=` | RF-05 | 200, sem `content-range`, corpo completo |
| `bytes=1000-1100`, `bytes=1000-`, `bytes=-0` | RF-06, D-09 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| HEAD `bytes=1000-1100` | RF-06 | 416 sem corpo |
| `If-Range: "abc"` com `Range` | RF-07 | 206 |
| `If-Range: "outro"` com `Range` | RF-07 | 200 completo |
| `If-Range: W/"abc"` com `Range` | RF-07 | 200 completo |
| `If-Range` com a data de `last-modified` | D-03 | 206 |
| `If-Range` com data diferente, ou texto inválido | D-03 | 200 completo |
| `If-None-Match: "abc"` com `Range` | RF-08 | 304 sem corpo |
| Asset inexistente com `Range` válido | RF-08 | 404, igual ao atual |
| Asset inexistente com `fallthrough` e `Range` | RF-08 | Próximo handler, como hoje |
| POST com `Range` | RF-09 | 405 |
| Variante `.gz` com `accept-encoding: gzip` e `Range` | RF-08 | 206 com `content-length` e `content-range` da variante, `content-encoding: gzip`, `vary` presente |
| `getContents` devolvendo `Blob` | D-04 | Trecho correto |
| `getContents` devolvendo `ReadableStream` | D-04 | Trecho correto |
| `options.headers` com `content-length: 999` e `Range` | D-06 | 206 com `content-length` do trecho |
| `getContents` devolvendo `""` com `Range` | D-10 | 200 completo, sem `content-range` |

**Regressão:**
- `pnpm vitest run test/static.test.ts`: todos os testes antigos e os novos.
- `pnpm vitest run test/unit/package.test.ts`: o snapshot de exportações deve continuar igual (RF-09).
- `pnpm vitest run test/security.test.ts test/rules/cache.test.ts`: as garantias de caminho e o bypass de `Range` do cache não mudam.
- `pnpm vitest run` (suíte completa).
- `pnpm typecheck` (`tsc --noEmit`).
- `pnpm lint` (`oxlint . && oxfmt --check .`).

**Observação:** `AGENTS.md` diz que `pnpm lint` inclui o typecheck, mas no `package.json` `lint` roda só `oxlint` e `oxfmt --check`. O typecheck é o script `typecheck`. Os dois precisam ser rodados separadamente.

## 7. Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| Memória e tempo: `getContents` entrega o arquivo inteiro, então todo `Range` em arquivo grande lê o arquivo inteiro (`Blob.slice` evita isso só para `Blob`). | Alta | Aceito pelo PRD. Otimização de streaming ou leitura parcial no backend fica para etapa futura. Documentar no JSDoc. |
| `size` diferente do corpo real: o `Content-Range` e o trecho ficam errados, e o corpo pode ser menor que o declarado. | Média | O `serveStatic` não consegue verificar. Registrar como premissa do backend (PRD). Considerar `Math.min` com o tamanho real do corpo quando ele for conhecido, em etapa futura. |
| Tamanho 0 tratado como ausente (D-08) pode divergir da RFC para corpos vazios. | Média | Decisão pendente de confirmação (seção 8). |
| `W/` case-sensitive: o fixture existente usa `w/123` em minúsculo. Se algum consumidor usar `w/` minúsculo, a tag será tratada como forte. | Baixa | Seguir a RFC (case-sensitive). Não mudar os fixtures existentes. |
| `If-Range` com data: a RFC só admite validador de data forte, ou seja, `Last-Modified` pelo menos 1 segundo antes de `Date`. A implementação aceita a data sem essa checagem, como o PRD descreve. | Baixa | Documentar a simplificação. Os testes cobrem igualdade exata e data diferente. |
| Cabeçalhos de representação em 416: `content-encoding` e `content-type` continuam no 416 (vêm de `event.res.headers`). | Baixa | Aceitável: o corpo é vazio. Confirmar se algum cliente reclama. |
| Tamanho de `static.ts`: passa de 351 para cerca de 430 linhas, acima da meta de 200 linhas de `AGENTS.md`. | Baixa | Trade-off da D-01. Se a equipe preferir, mover helpers para `src/utils/internal/range.ts` (não exportado), sem mudar a API. |
| Compatibilidade de clientes que esperam 200 para qualquer requisição. | Baixa | A RFC permite ignorar `Range`, e o pedido pede o 206. |
| Interação com `Content-Length` explícito de `options.headers` (D-06). | Baixa | Coberto por teste. Documentar que o `Range` tem precedência sobre o `content-length` declarado. |
| Regressão em `h3/rules/cache`: um 206 não deve ser armazenado. | Baixa | O bypass de `Range` já existe (`src/rules/cache.ts:146-149`). Coberto pelos testes de `test/rules/cache.test.ts`. |

## 8. Pendências para confirmação

1. **D-08 (tamanho 0):** confirmar que `size: 0` ignora `Range` (200), como o PRD propõe, e não responde 416 pela RFC.
2. **D-06 (`content-length` explícito):** confirmar que, num 206, o `Range` sobrescreve `content-length` definido em `options.headers`.
3. **D-07 (304):** confirmar que `accept-ranges` não aparece em 304. O PRD não pede no 304, mas a RFC não proíbe.

Enquanto não houver resposta, a implementação segue as escolhas acima e os testes de D-06, D-07 e D-08 devem ser ajustados junto com a decisão.
