# Especificação técnica — HTTP Range em `serveStatic`

**Referências:** `sdd/pedido.md` (issue h3js/h3#1267), `sdd/prd.md` (RF-01 a RF-15), código em `src/utils/static.ts`.
**Norma:** RFC 9110, §13.1.5 (If-Range), §14 (Range Requests), §15.5.17 (416).

Esta especificação diz como implementar o PRD. Ela não repete os critérios de aceite do PRD; quando há conflito, vale o PRD.

---

## Visão geral

`serveStatic` passa a atender um único intervalo de bytes em `GET` e `HEAD`:

- O cabeçalho `Range` é avaliado depois da verificação condicional (304) e depois de montar os cabeçalhos do asset (`content-type`, `content-encoding`, `content-length`).
- A lógica pura (interpretar `Range`, avaliar `If-Range`, cortar o corpo) vai para um módulo interno novo, `src/utils/internal/range.ts`.
- `serveStatic` ganha só a orquestração: decidir entre 200, 206 e 416, e gravar os cabeçalhos certos.
- Nada muda em `src/index.ts`, em `ServeStaticOptions`, em `getMeta`, em `getContents` nem nos adaptadores.

Mudança de comportamento intencional: clientes que enviam `Range` válido passam a receber `206` (PRD, premissa 4).

---

## Decisões de arquitetura

### D-01 — Módulo interno separado para a lógica de Range

**Escolha:** criar `src/utils/internal/range.ts` com `parseRange`, `matchIfRange` e `sliceBody`. `src/utils/static.ts` importa essas funções e mantém só a orquestração.

**Alternativas consideradas:**
- *Colocar tudo no fim de `src/utils/static.ts`* (PRD, RF-12, permite). Rejeitada: o arquivo já tem 352 linhas (`src/utils/static.ts:352`), acima da meta de 200 linhas do AGENTS.md, e a lógica nova somaria mais de 120 linhas.
- *Criar um arquivo público em `src/utils/range.ts`*. Rejeitada: viola RF-12 e a regra de não criar exportações novas.

**Justificativa:** `src/utils/internal/` já abriga helpers de `serveStatic` (`src/utils/internal/cache.ts` com `isCacheMatch`, importado em `src/utils/static.ts:6`). Os arquivos internos não são re-exportados por `src/index.ts`, e o pacote não expõe `utils/internal` em nenhum subcaminho (ver `test/unit/package.test.ts:4-158`).

### D-02 — Interpretação de `Range` como função pura com resultado tripartido

**Escolha:** `parseRange(header, size)` devolve um de três resultados:

- `undefined` → ignorar o `Range` e responder 200 (RF-02);
- `{ status: "unsatisfiable" }` → responder 416 (RF-04);
- `{ status: "satisfiable", start, end }` → responder 206, com `start` e `end` inclusivos e já ajustados ao tamanho.

A ordem das verificações é fixa:

1. Regex sobre o cabeçalho inteiro (depois de `trim()`): `/^bytes\s*=\s*(\d*)-(\d*)$/i`. Cobre unidade diferente de `bytes` (a), sintaxe inválida (b) e múltiplos intervalos separados por vírgula (c), que não casam. Retorna `undefined`.
2. Se os dois grupos estão vazios (`bytes=-`), retorna `undefined` (b).
3. Se os dois grupos estão preenchidos e `end < start`, retorna `undefined` (d). Essa verificação vem **antes** da de satisfazibilidade, então `bytes=1000-100` com `size = 500` também é ignorado, não 416.
4. Se `size` não é um número, retorna `undefined` (e). A verificação de `size` pode ficar no chamador; ver D-05.
5. Satisfazibilidade:
   - `a-b`: se `a >= size` → `unsatisfiable`; senão `start = a`, `end = min(b, size - 1)`.
   - `a-`: se `a >= size` → `unsatisfiable`; senão `start = a`, `end = size - 1`.
   - `-n`: se `n === 0` ou `size === 0` → `unsatisfiable`; senão `start = max(size - n, 0)`, `end = size - 1`.

**Alternativas consideradas:**
- *Lançar `HTTPError` 416 de dentro do parser.* Rejeitada: acopla o parser a `serveStatic` e a `HTTPError`, e impede o teste unitário puro.
- *Devolver `null` para ignorar e `false` para 416.* Rejeitada: pouco legível e fácil de confundir com erro.

**Justificativa:** A união discriminada por `status` deixa `serveStatic` com um `switch` simples e cobre cada RF com um caminho de código.

### D-03 — `If-Range` compara com os validadores que a resposta anuncia

**Escolha:** `matchIfRange(ifRange, { etag, lastModified })`, chamado em `serveStatic` com os valores **já gravados** em `event.res.headers`:

- `etag = event.res.headers.get("etag") ?? undefined`
- `lastModified = event.res.headers.get("last-modified") ?? undefined`

Regras:

- Sem `If-Range` (`null`) → `true`.
- Se o valor começa com `"` ou `W/` → é um ETag. Combina somente se o valor **não** começa com `W/`, o `etag` existe, não começa com `W/`, e `ifRange === etag`. Comparação exata de string, sem normalizar aspas.
- Caso contrário → é uma data. Combina somente se `lastModified !== undefined` e `ifRange === lastModified` (comparação exata de string com o valor já no formato `toUTCString()`).
- Qualquer outro caso → `false`.

**Alternativas consideradas:**
- *Fazer `new Date(ifRange).getTime() === mtime.getTime()`.* Rejeitada: `Date` aceita formatos que não são data HTTP (ex.: ISO, texto livre) e um valor inválido vira `NaN`, o que exige um caso à parte. A string exata cumpre "exatamente igual" do RF-06 e é mais simples de testar.
- *Comparar com `meta.etag` e `mtime` em vez dos cabeçalhos.* Rejeitada: se o chamador definiu `etag` ou `last-modified` em `options.headers` ou em `event.res.headers`, a resposta anuncia esse valor, e o `If-Range` precisa bater com o que o cliente recebeu.

**Justificativa:** O validador de `If-Range` deve ser o mesmo que a resposta publica (RFC 9110 §13.1.5). Um cliente que usa outro formato de data (RFC 850, asctime) recebe 200 completo, o que é seguro: o cliente só perde o ganho de performance.

### D-04 — Cabeçalhos 206 e 416 vão em `event.res.headers`, não no `HTTPResponse`

**Escolha:** `content-range` e `content-length` das respostas 206 e 416 são gravados com `event.res.headers.set(...)`. O `HTTPResponse` recebe só `status` e `statusText`.

**Justificativa:** Em `src/response.ts:201-205`, `prepareResponse` mescla os cabeçalhos do `HTTPResponse` com `event.res.headers`, e os de `event.res` vencem (`mergeHeaders(res.headers, preparedHeaders)`, `src/response.ts:243-252`). Se o `content-length` fosse passado no init do `HTTPResponse`, o valor de `meta.size` gravado em `src/utils/static.ts:268-270` venceria e a resposta sairia com o tamanho do arquivo inteiro. Gravar em `event.res.headers` também garante que `set` sobrescreva o `content-length` do chamador (RF-15).

**Alternativas consideradas:**
- *Passar tudo no init do `HTTPResponse`.* Rejeitada pelo motivo acima.
- *Remover `content-length` antes de gravar.* Rejeitada: `set` já substitui o valor, e `delete` seria um passo a mais sem ganho.

### D-05 — Accept-Ranges e tamanho desconhecido

**Escolha:**

- `accept-ranges: bytes` é gravado com `if (!event.res.headers.has("accept-ranges"))`, no mesmo padrão de `etag` e `last-modified` (`src/utils/static.ts:234-241`). Vale para todo asset encontrado, inclusive 304 e 416 (RF-01). A gravação fica **antes** de `isCacheMatch` (`src/utils/static.ts:243`).
- Se `meta.size === undefined`, `Range` é ignorado (RF-02e). Isso é decidido no chamador, antes de `parseRange`.
- `meta.size === 0` **não** ignora `Range`: é tratado como asset de tamanho zero, e qualquer intervalo válido vira 416 (RF-04).

**Justificativa:** O padrão existente já é "caller vence" para cabeçalhos de validador e de tipo, e o PRD não pede sobrescrever `accept-ranges`. `size === 0` precisa ir para 416 porque `src/utils/static.ts:268` já trata `size > 0` como caso especial para `content-length`, e o PRD (RF-04) quer 416 nesse caso.

### D-06 — Ordem de chamadas a `getContents` e fallback para 200

**Escolha:** o fluxo em `serveStatic` (depois de `src/utils/static.ts:270`, substituindo as linhas 272-277) é:

```ts
const range = resolveRange(event, meta.size); // undefined | ParsedRange

if (range?.status === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

let contents: BodyInit | null | undefined;
let fetched = false;

if (range?.status === "satisfiable") {
  if (event.req.method === "HEAD") {
    return partial(null, range); // não chama getContents
  }
  contents = await options.getContents(id);
  fetched = true;
  const part = sliceBody(contents, range);
  if (part !== undefined) {
    return partial(part, range);
  }
  // Tipo de corpo não suportado (ex.: FormData): 200 completo, reaproveitando `contents`.
}

if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: 200 });
}
if (!fetched) {
  contents = await options.getContents(id);
}
return new HTTPResponse(contents || null, { status: 200 });
```

Onde `partial` é uma função local de `serveStatic` (não exportada) que grava `content-range` e `content-length` e devolve `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`.

**Regras:**

- `getContents` é chamado no máximo uma vez por requisição.
- `HEAD` nunca chama `getContents` (RF-05 e comportamento atual).
- Os cabeçalhos 206 só são gravados depois de `sliceBody` confirmar o tipo. Assim, o fallback para 200 não precisa desfazer `content-range` nem `content-length`.

**Alternativa considerada:** gravar os cabeçalhos de 206 antes de chamar `getContents` e desfazer no fallback. Rejeitada: é frágil, e `delete` em `content-length` poderia apagar o valor que o chamador definiu (RF-15).

### D-07 — Corte por tipo de corpo

**Escolha:** `sliceBody(body, { start, end })` (em `src/utils/internal/range.ts`), com `end` inclusivo:

| Tipo de `getContents` | Tratamento | Resultado |
| --- | --- | --- |
| `null`, `undefined` | Não cortável | `undefined` → 200 como hoje |
| `string` | `new TextEncoder().encode(body).subarray(start, end + 1)` | `Uint8Array` |
| `ArrayBuffer` | `new Uint8Array(body).subarray(start, end + 1)` | `Uint8Array` |
| `ArrayBuffer.isView(body)` (TypedArray, DataView) | `new Uint8Array(body.buffer, body.byteOffset, body.byteLength).subarray(start, end + 1)` | `Uint8Array` sem cópia |
| `Blob` | `body.slice(start, end + 1)` | `Blob` |
| `ReadableStream` | `sliceStream(body, start, end)` (ver D-08) | `ReadableStream<Uint8Array>` |
| Outros (`FormData`, `URLSearchParams`, ...) | Não cortável | `undefined` → 200 completo (RF-09) |

`string` é codificada em UTF-8 inteira antes do corte (RF-09). O custo de memória está em "Riscos".

**Alternativa considerada:** para `string`, cortar por `charCodeAt` quando o texto é ASCII. Rejeitada: é uma otimização que exige checar ASCII e não muda o resultado; não compensa a complexidade.

### D-08 — Stream com leitura preguiçosa e parada antecipada

**Escolha:** `sliceStream` cria um `ReadableStream` com `highWaterMark: 0` no próprio stream de saída, para que nada seja lido da origem antes de o cliente pedir. O `pull` lê um chunk por vez da origem e:

1. calcula o intervalo do chunk que cai dentro de `[start, end]` e enfileira só esse trecho (`subarray`);
2. se `offset > end` (já passou do byte final), fecha o stream de saída e cancela o leitor da origem (`reader.cancel()`), sem ler mais nada;
3. se o chunk termina antes de `start`, não enfileira nada e a próxima `pull` continua.

```ts
function sliceStream(body: ReadableStream, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const bytes = toUint8Array(value); // BufferSource ou string codificada
        const chunkStart = offset;
        offset += bytes.byteLength;
        const from = Math.max(start - chunkStart, 0);
        const to = Math.min(end + 1 - chunkStart, bytes.byteLength);
        if (to > from) {
          controller.enqueue(bytes.subarray(from, to));
        }
        if (offset > end) {
          controller.close();
          await reader.cancel();
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
```

**Justificativa:** RF-10 exige que a origem pare no chunk que contém o byte final. O `highWaterMark: 0` evita o read-ahead de um chunk que o `ReadableStream` padrão faria ao ser construído, o que quebraria o critério "não passa do primeiro chunk que contém o byte 99".

**Alternativa considerada:** `TransformStream` com `pipeThrough`. Rejeitada: não tem parada antecipada explícita da origem, e depende de backpressure do pipe para não ler de mais.

`toUint8Array` aceita `Uint8Array`/`ArrayBuffer` views e converte `string` com `TextEncoder`. Outros tipos de chunk lançam `TypeError`, o que o `pull` propaga como erro do stream.

### D-09 — Sem novas opções nem exports

**Escolha:** `ServeStaticOptions` (`src/utils/static.ts:17-66`) e `src/index.ts:193` não mudam. `parseRange`, `matchIfRange` e `sliceBody` são exportadas **somente** de `src/utils/internal/range.ts`, para uso de `static.ts` e dos testes unitários. Não são re-exportadas em lugar nenhum.

**Justificativa:** RF-12. O snapshot de exports em `test/unit/package.test.ts:4-158` precisa continuar idêntico, e serve como verificação automática.

---

## Arquivos a alterar

### `src/utils/static.ts`

| Local | Mudança |
| --- | --- |
| `src/utils/static.ts:6` | Manter `import { isCacheMatch } from "./internal/cache.ts";` e acrescentar logo abaixo `import { parseRange, matchIfRange, sliceBody, type ParsedRange } from "./internal/range.ts";`. |
| `src/utils/static.ts:68-100` | Opcional: acrescentar um parágrafo ao JSDoc de `serveStatic` dizendo que `GET`/`HEAD` atendem um intervalo de bytes e que `getContents` deve devolver a representação completa (premissa 2 do PRD). Depois, rodar `pnpm fmt` para regenerar `docs/2.utils/2.response.md` pelo automd. |
| `src/utils/static.ts:239-241` | Depois do bloco de `etag`, gravar `accept-ranges: bytes` com `if (!event.res.headers.has("accept-ranges"))` (D-05). |
| `src/utils/static.ts:243-248` | Sem mudança de código. Fica depois do `accept-ranges`, para que o 304 também o inclua (RF-01, RF-07). |
| `src/utils/static.ts:268-270` | Sem mudança de código. O `content-length` de `meta.size` continua sendo gravado aqui para a resposta 200; 206 e 416 sobrescrevem (D-04). |
| `src/utils/static.ts:272-277` | Substituir por o fluxo de D-06: `resolveRange`, 416, 206 com `partial`, HEAD e 200. |
| Fim do arquivo (após `src/utils/static.ts:351`) | Acrescentar a função privada `resolveRange(event, size)`, que lê `range` e `if-range` do request, chama `matchIfRange` com os validadores de `event.res.headers` e `parseRange`. Retorna `undefined` quando `size === undefined` ou quando `If-Range` não combina. |

Assinatura de `resolveRange` (privada, não exportada):

```ts
function resolveRange(event: H3Event, size: number | undefined): ParsedRange | undefined {
  const header = event.req.headers.get("range");
  if (!header || size === undefined) {
    return undefined;
  }
  const validators = {
    etag: event.res.headers.get("etag") ?? undefined,
    lastModified: event.res.headers.get("last-modified") ?? undefined,
  };
  if (!matchIfRange(event.req.headers.get("if-range"), validators)) {
    return undefined;
  }
  return parseRange(header, size);
}
```

A função `partial` fica dentro de `serveStatic`, porque usa `range` e `meta.size` do escopo.

### `src/utils/internal/range.ts` (novo)

Conteúdo esperado: `ParsedRange`, `parseRange`, `matchIfRange`, `sliceBody`, `sliceStream`, `toUint8Array`. Estimativa: 120 a 160 linhas, abaixo do limite de 200 do AGENTS.md.

Convenções do AGENTS.md que valem aqui:

- Import com extensão `.ts`.
- Tipos de retorno explícitos em toda função exportada (`isolatedDeclarations`).
- Sem `enum`, sem `namespace`.
- Helpers internos do arquivo ficam no fim.
- Comentários curtos e só onde a regra da RFC não é óbvia (ex.: a ordem de `end < start` antes de 416).

### `test/static-range.test.ts` (novo)

Testes de integração com `describeMatrix` (ver seção "Estratégia de testes").

### `test/unit/range.test.ts` (novo)

Testes unitários puros de `parseRange`, `matchIfRange` e `sliceBody`, sem `describeMatrix`, porque não dependem de runtime.

### Arquivos que **não** mudam

- `src/index.ts` (RF-12).
- `src/response.ts`, `src/utils/internal/cache.ts`, adaptadores e `src/_entries/*`.
- `test/static.test.ts`: nenhum teste existente envia `Range` nem `If-Range` (busca feita por `range` em `test/`; só `test/rules/cache.test.ts` e `test/unit/sanitize.test.ts` mencionam o termo, sem relação com `serveStatic`). Se a suíte falhar, ajustar só o teste que falhou.
- `test/unit/package.test.ts`: o snapshot precisa continuar idêntico.
- `package.json`: nenhuma dependência nova (RF-14).

---

## Contratos e assinaturas

### `src/utils/internal/range.ts`

```ts
export type ParsedRange =
  | { status: "satisfiable"; start: number; end: number }
  | { status: "unsatisfiable" };

/**
 * Interpreta o cabeçalho `Range` (RFC 9110 §14.1.1 e §14.2) para um corpo de `size` bytes.
 * Retorna `undefined` quando o cabeçalho deve ser ignorado. `start` e `end` são inclusivos.
 */
export function parseRange(header: string, size: number): ParsedRange | undefined;

/**
 * Avalia `If-Range` (RFC 9110 §13.1.5) contra os validadores da resposta.
 * Retorna `true` quando o intervalo pode ser atendido.
 */
export function matchIfRange(
  ifRange: string | null,
  validators: { etag?: string; lastModified?: string },
): boolean;

/**
 * Corta o corpo para os bytes `[start, end]` inclusivos.
 * Retorna `undefined` quando o tipo não é cortável (`null`, `undefined`, `FormData`, ...).
 */
export function sliceBody(
  body: BodyInit | null | undefined,
  range: { start: number; end: number },
): BodyInit | undefined;

// Privadas ao módulo
function sliceStream(body: ReadableStream, start: number, end: number): ReadableStream<Uint8Array>;
function toUint8Array(chunk: unknown): Uint8Array;
```

Casos de `parseRange` que o teste unitário precisa cobrir (todos com `size = 1000`):

| Cabeçalho | Resultado |
| --- | --- |
| `bytes=0-99` | `{ satisfiable, 0, 99 }` |
| `bytes=100-` | `{ satisfiable, 100, 999 }` |
| `bytes=-100` | `{ satisfiable, 900, 999 }` |
| `bytes=-5000` | `{ satisfiable, 0, 999 }` |
| `bytes=0-5000` | `{ satisfiable, 0, 999 }` |
| `Bytes=0-9` | `{ satisfiable, 0, 9 }` |
| `bytes=1000-1100` | `unsatisfiable` |
| `bytes=1000-` | `unsatisfiable` |
| `bytes=-0` | `unsatisfiable` |
| `bytes=0-99` com `size = 0` | `unsatisfiable` |
| `bytes=-5` com `size = 0` | `unsatisfiable` |
| `bytes=5-2` | `undefined` |
| `bytes=1000-100` | `undefined` |
| `bytes=0-1,5-6` | `undefined` |
| `items=0-9` | `undefined` |
| `bytes=` | `undefined` |
| `bytes=-` | `undefined` |
| `bytes=abc` | `undefined` |

### `src/utils/static.ts` (sem mudança de assinatura)

```ts
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

### Respostas esperadas

| Situação | Status | Cabeçalhos relevantes | Corpo |
| --- | --- | --- | --- |
| Asset encontrado, sem `Range` | 200 | `accept-ranges: bytes`, `content-length` (regra atual) | completo |
| `Range` válido, `GET` | 206 | `accept-ranges`, `content-range: bytes a-b/size`, `content-length: b-a+1` | trecho |
| `Range` válido, `HEAD` | 206 | igual ao acima | vazio |
| `Range` insatisfazível | 416 | `accept-ranges`, `content-range: bytes */size`, `content-length: 0` | vazio |
| `Range` ignorado (RF-02, RF-06) | 200 | `accept-ranges`, sem `content-range` | completo |
| Validador do `If-Range` não bate | 200 | igual ao acima | completo |
| `If-None-Match` / `If-Modified-Since` batem | 304 | `accept-ranges`, sem `content-range` | vazio |
| Asset ausente | 404 (ou fallthrough) | sem mudança | — |
| Método diferente de GET/HEAD | 405 com `allow: GET, HEAD` | sem mudança, inclusive com `Range` | — |

---

## Estratégia de testes

Seguir o Bug Fix Workflow do AGENTS.md: escrever os testes antes da implementação e confirmar que falham.

### Testes de integração — `test/static-range.test.ts`

Usar `describeMatrix("serve static range", (t, { it, expect }) => { ... })`, com `t.app.all("/range/**", ...)` e um `getMeta`/`getContents` fixos. Cada cenário roda em `web` e `node`.

| Cenário | RF | Asserções |
| --- | --- | --- |
| GET sem `Range` | RF-01 | 200, `accept-ranges: bytes`, `content-length: 1000` |
| HEAD sem `Range` | RF-01 | 200, `accept-ranges: bytes`, `content-length: 1000` |
| `bytes=100-199` | RF-03 | 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo = bytes 100 a 199 |
| `bytes=900-` | RF-03 | 206, `content-range: bytes 900-999/1000`, `content-length: 100` |
| `bytes=-100` | RF-03 | 206, `content-range: bytes 900-999/1000` |
| `bytes=-5000` (sufixo maior que o asset) | RF-03 | 206, `content-range: bytes 0-999/1000`, `content-length: 1000` |
| `bytes=0-5000` | RF-03 | 206, `content-range: bytes 0-999/1000` |
| `bytes=1000-1100` | RF-04 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| Asset de tamanho 0 com `bytes=0-` | RF-04 | 416, `content-range: bytes */0` |
| `HEAD` com `bytes=0-99` | RF-05 | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo vazio, `getContents` não chamado |
| `HEAD` com `bytes=1000-` | RF-05 | 416 sem corpo, `getContents` não chamado |
| `bytes=0-1,5-6` | RF-02c | 200, corpo completo, sem `content-range` |
| `items=0-9` | RF-02a | 200, corpo completo |
| `bytes=5-2` | RF-02d | 200, corpo completo |
| `bytes=abc` e `bytes=-` | RF-02b | 200, corpo completo |
| `size` indefinido com `Range` | RF-02e | 200, sem `content-length`, sem `content-range` |
| `If-Range` com ETag fraco (`W/"abc"`) no pedido e ETag `"abc"` no asset | RF-06 | 200 completo |
| `If-Range: "xyz"` com ETag `"abc"` | RF-06 | 200 completo |
| `If-Range: "abc"` com ETag `"abc"` | RF-06 | 206 |
| `If-Range` com ETag fraco no asset (`W/"abc"`) | RF-06 | 200 completo |
| `If-Range` com data igual ao `Last-Modified` | RF-06 | 206 |
| `If-Range` com data diferente | RF-06 | 200 completo |
| `If-Range` com data inválida | RF-06 | 200 completo |
| `If-None-Match: "abc"` + `Range` | RF-07 | 304, sem `content-range`, sem corpo, com `accept-ranges` |
| Variante `.gz` (400 bytes) com `Accept-Encoding: gzip` e `bytes=0-99` | RF-08 | 206, `content-range: bytes 0-99/400`, `content-length: 100`, `content-encoding: gzip`, `content-type: text/javascript` |
| `getContents` devolve `"ação"` (6 bytes UTF-8) com `bytes=1-2` | RF-09 | 206, `content-range: bytes 1-2/6`, corpo = `C3 A7` |
| `getContents` devolve `FormData` com `Range` | RF-09 | 200 completo |
| `getContents` devolve `ReadableStream` de 10 MB com `bytes=0-99` | RF-10 | corpo = 100 bytes, origem puxada até no máximo o primeiro chunk que contém o byte 99 |
| `Blob` com `bytes=10-19` | RF-10 | 206, corpo = 10 bytes, `slice` usado (verificar pelo corpo) |
| `POST` com `Range` | RF-11 | 405, `allow: GET, HEAD` |
| Sem `Range`, com `Range` ignorado: mesmos cabeçalhos e corpo de antes | RF-11 | comparar com o asset servido sem a mudança |
| `options.headers: { "content-length": "5" }` + `bytes=0-99` | RF-15 | 206, `content-length: 100` |
| `options.headers: { "content-length": "5" }` sem `Range` | RF-15 | 200, `content-length: 5` (regra atual, não sobrescreve) |
| `encodings: { gzip: ".gz" }`, asset sem variante, `Range` | RF-08 | 206 sobre o arquivo original |

Para o teste do `ReadableStream` (RF-10), criar a origem com `pull` que enfileira chunks de 64 KB e incrementa um contador por chunk entregue. O teste afirma que o contador não passa de `ceil(100 / 65536)` = 1 chunk, com `highWaterMark` padrão do lado da origem.

**Atenção no teste de RF-08 em `node`:** o `fetch` do Node (undici) descomprime `Content-Encoding: gzip` automaticamente. O trecho de 100 bytes de um `.gz` não é um gzip válido, então o corpo lido no `node` falharia. Nesse cenário, verificar cabeçalhos nos dois alvos e verificar o corpo só quando `ctx.target === "web"` (`it.skipIf` no corpo, ou um `if` explícito). Não trocar o encoding do teste para contornar isso.

### Testes unitários — `test/unit/range.test.ts`

- Tabela de `parseRange` (acima).
- `matchIfRange`: `null` → `true`; ETag forte igual → `true`; ETag forte diferente → `false`; `W/` em qualquer lado → `false`; data igual → `true`; data diferente → `false`; data inválida → `false`; `lastModified` ausente com data → `false`; ETag ausente com ETag no pedido → `false`.
- `sliceBody`: string com UTF-8 multibyte; `ArrayBuffer`; `Uint8Array` com `byteOffset` diferente de zero (ex.: `new Uint8Array(buf, 4, 10)`); `DataView`; `Blob`; `null` e `undefined` → `undefined`; `FormData` → `undefined`.

### Verificação final

1. `pnpm vitest run test/static-range.test.ts test/unit/range.test.ts` — tudo verde em `web` e `node`.
2. `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` — suíte existente verde, snapshot de exports inalterado.
3. `pnpm test` — lint, typecheck e coverage completos.
4. `pnpm fmt` seguido de `git diff --stat`: confirmar que `docs/2.utils/2.response.md` mudou só se o JSDoc de `serveStatic` mudou, e que `package.json` está igual.

---

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `meta.size` diferente do corpo real (PRD, premissa 1). Ex.: `Blob.slice` e `ReadableStream` terminam antes de `end`. | `content-length` declara bytes que não chegam; o cliente trava ou aborta. | Documentar a premissa no JSDoc (passo opcional de `src/utils/static.ts:68-100`). Teste com corpo menor que `size` para registrar o comportamento. Decidir depois se vale abortar; esta entrega não trunca nem aborta. |
| Corte de `string` exige codificar o texto inteiro em UTF-8 (`src/utils/internal/range.ts`, `sliceBody`). | Alocação proporcional ao tamanho do texto a cada `Range`. | Aceito para `string` (PRD, risco 2). Medir com um arquivo de vários MB antes de liberar. |
| Comportamento de cancelamento de `ReadableStream` difere entre runtimes (Node, Bun, Deno, Workers). | RF-10 passa em um e falha em outro. | Teste na matriz `web`/`node`. Se um runtime divergir, documentar a diferença sem mudar o critério. |
| `If-Range` com data em outro formato (RFC 850, asctime) ou com precisão de milissegundo. | Cliente recebe 200 completo em vez de 206. | Comparação de string exata com `last-modified` já truncado para segundos (`src/utils/static.ts:232`). Documentar: o caso é seguro, só perde o ganho. |
| Clientes que já enviam `Range` passam a receber 206. | Quem dependia do 200 completo muda de comportamento. | É o pedido da issue e a premissa 4 do PRD. Registrar no PR. |
| `content-length` do chamador sobrescrito em 206 e 416 (RF-15). | Mudança sutil para quem define `content-length` manualmente. | Restringir à branch de 206 e 416 (D-04) e cobrir com teste. |
| Pelo mesmo motivo de D-04, esquecer de gravar em `event.res.headers` faria o `meta.size` vencer. | 206 com `content-length` do arquivo inteiro. | Teste de RF-03 com `content-length` verificado; comentário no código apontando `src/response.ts:201-205`. |
| Node (undici) descomprime `Content-Encoding` no `fetch`. | Teste de RF-08 falha só em `node`. | Ver nota na seção de testes: verificar corpo só em `web`. |
| `highWaterMark: 0` no stream de saída reduz paralelismo de leitura. | Pequena perda de throughput em streams de rede. | Aceito: RF-10 exige leitura preguiçosa. Medir se o impacto for relevante. |
| Testes existentes que enviam `Range` por acidente. | Falha inesperada. | Busca feita: nenhum. Se algum aparecer, ajustar só esse teste e descrever no PR. |
| Não existe checagem automática de que `ServeStaticOptions` ficou igual. | Campo novo entrar sem perceber. | Revisão do diff contra o PRD (RF-12) e snapshot de exports já existente. |
