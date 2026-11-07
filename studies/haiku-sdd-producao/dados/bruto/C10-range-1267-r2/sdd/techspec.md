# Especificação técnica: HTTP Range em `serveStatic`

- Issue: h3js/h3#1267
- PRD: `sdd/prd.md` (RF-01 a RF-12)
- Contrato: `sdd/pedido.md`
- Norma: RFC 9110 §14 (Range Requests) e §13.1.5 (If-Range)

Esta especificação não altera código. Ela descreve o que o engenheiro implementa em `src/utils/static.ts`, nos testes de `test/static.test.ts` e na documentação gerada a partir do JSDoc.

## Visão geral

`serveStatic` passa a avaliar o cabeçalho `Range` depois das condicionais existentes (304) e antes de chamar `getContents`. A decisão de Range depende apenas de `meta.size`, dos validadores do asset (`etag` e `mtime`) e dos cabeçalhos da requisição. Quando o Range é válido e satisfatível, a resposta é 206 e o corpo é recortado dentro de `serveStatic`. Quando o Range é não satisfatível, a resposta é 416. Em qualquer outro caso, a resposta segue como hoje (200 com corpo inteiro).

Fluxo resultante, a partir de `static.ts:243`:

1. 304 pelas condicionais (inalterado, `static.ts:243-248`).
2. Headers de tipo, encoding e `content-length` (inalterados, `static.ts:250-270`).
3. **Novo:** `Accept-Ranges: bytes` quando `meta.size` é numérico.
4. **Novo:** avaliação de Range (If-Range, sintaxe, satisfatibilidade).
5. **Novo:** 416, ou 206 para HEAD, ou 206 com corpo recortado.
6. HEAD 200 e GET 200 (inalterados, `static.ts:272-277`).

---

## Decisões de arquitetura

### D-01 — Lógica de Range dentro de `serveStatic`, sem camada nova

**Escolha:** a avaliação e o recorte ficam em `serveStatic`, no mesmo fluxo que já trata 304, encoding e HEAD.

**Alternativas consideradas:**

- _Envolver `getContents` com um wrapper que recorta._ Não funciona: o wrapper não sabe o status nem os headers, e o HEAD ainda chamaria `getContents`. Também exigiria que o wrapper conhecesse o Range antes da chamada.
- _Middleware separado (`defineMiddleware`) que lê `Range`._ Quebra a ordem do PRD: o 304 e a seleção de encoding precisam ser vistos antes, e o middleware não teria acesso ao `meta` de `getMeta`.
- _Passar o Range para `getMeta`/`getContents`._ Muda `ServeStaticOptions` e as assinaturas, o que está fora de escopo (PRD, "Fora de escopo").

**Escolha justificada:** é a única opção que mantém a ordem do PRD sem mudar nenhuma assinatura pública.

### D-02 — Helpers no próprio `src/utils/static.ts`, sem `export`

**Escolha:** todos os helpers novos ficam no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`static.ts:280`), sem `export`. Nenhum arquivo novo em `src/utils/internal/`.

**Alternativas consideradas:**

- _Criar `src/utils/internal/range.ts`._ É o padrão de `AGENTS.md` ("Internal helpers go at the end of files or in `utils/internal/`"). Não exporia nada publicamente, mas o `pedido.md` diz "as funções auxiliares ficam privadas no módulo" e o PRD (RF-12) diz "Os helpers novos ficam sem `export` dentro de `src/utils/static.ts`".

**Escolha justificada:** o contrato é explícito e tem prioridade sobre a convenção geral. O custo é o tamanho do arquivo: `static.ts` já tem 352 linhas (acima da meta de 200 do `AGENTS.md`) e vai a cerca de 450. Isso fica registrado como risco R7.

### D-03 — `Accept-Ranges` só para asset com `size` numérico, e não em 304

**Escolha:**

- `Accept-Ranges: bytes` é definido quando `typeof meta.size === "number"`, incluindo `size === 0` (necessário para o 416 de P6).
- Não é definido quando `meta.size` é `undefined`, porque nesse caso o Range é ignorado (D-04).
- Não é definido na resposta 304. A 304 já é tratada como resposta sem corpo pelo PRD (RF-08), e o `Accept-Ranges` é anúncio de intervalo para respostas com corpo.
- Usa o padrão de `static.ts:234` e `static.ts:239`: só define se o header ainda não existe (`!event.res.headers.has("accept-ranges")`), para respeitar o que o usuário definiu em `options.headers`.

**Alternativas consideradas:**

- _Sempre definir, como pede a issue literalmente._ Anunciaria bytes para assets cujo tamanho é desconhecido, que não podem ser atendidos (P4 do PRD). Ficou como alternativa de baixo custo caso os mantenedores prefiram, mas vai contra o PRD.
- _Definir também na 304._ Pouco útil e aumenta a superfície de teste. Pode ser revisto (R12).

### D-04 — Ordem de avaliação do Range

**Escolha:** a avaliação segue esta ordem, e o primeiro critério que decide encerra a avaliação:

1. Sem `Range`, ou `meta.size` não numérico: ignorar (200).
2. `If-Range` presente e não coincide (D-06): ignorar (200).
3. Sintaxe inválida, unidade diferente de `bytes`, múltiplas faixas, ou `first > last`: ignorar (200).
4. Nenhum byte satisfaz: 416.
5. Caso contrário: 206.

Essa ordem respeita a RFC 9110: `If-Range` é avaliado antes do Range, um Range sintaticamente inválido é ignorado e não vira 416, e `bytes=500-100` é inválido (não é 416), como pede RF-05.

**Alternativas consideradas:**

- _Validar satisfatibilidade antes da sintaxe._ Faria `bytes=500-100` em um asset de 50 bytes virar 416, contra RF-05.

### D-05 — Sintaxe estrita do Range

**Escolha:** o cabeçalho é aceito somente se bater com `/^bytes=(\d*)-(\d*)$/i`. Sem espaços ao redor de `=` ou `-`. Sem vírgulas (com vírgula, a regex não casa e o Range é ignorado).

- `bytes=` com `first` e `last` vazios é inválido (ignorado).
- A unidade `bytes` é comparada sem diferenciar maiúsculas. Não está fixado pelo PRD. Essa é uma escolha de tolerância: a unidade é um token e o código já trata nomes de codings sem caixa (`static.ts:335-338`).

**Alternativas consideradas:**

- _Aceitar espaços em volta de `=`._ A gramática de `ranges-specifier` da RFC 9110 não prevê; manter estrito.

### D-06 — Validação de If-Range

**Escolha:**

- Se `If-Range` começa com `"` ou com `W/`, é tratado como ETag. Coincide somente se `meta.etag` existe, não começa com `W/`, e é igual ao valor enviado (comparação byte a byte). ETag fraca de qualquer lado nunca coincide (RF-07).
- Caso contrário, é tratado como data: coincide se `Date.parse(valor)` é igual a `mtimeDate.getTime()`. `mtimeDate` já está truncado para segundos (`static.ts:232`). Sem `mtime`, nunca coincide.
- `W/` é verificado com caixa exata, como manda a gramática da RFC 9110 §8.8.3.

**Alternativas consideradas:**

- _Parse completo de entity-tag e de HTTP-date._ Mais código sem ganho para o escopo. A comparação de igualdade exata cobre o PRD.

### D-07 — Recorte do corpo conforme o tipo de `getContents`

**Escolha:** `sliceContents(contents, start, end)` escolhe a estratégia pelo tipo:

| Tipo de `contents`                   | Estratégia                                         | Custo de leitura                                        |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| `string`                             | `TextEncoder` e `subarray`                         | Codifica o string inteiro (já está em memória)          |
| `ArrayBuffer`                        | `slice(start, end + 1)`                            | Nenhum                                                  |
| `ArrayBufferView`                    | `Uint8Array` sobre o mesmo `buffer` com `subarray` | Nenhum                                                  |
| `Blob`                               | `slice(start, end + 1)`                            | Nenhum (o runtime fatia sem ler)                        |
| `ReadableStream` ou outro `BodyInit` | `sliceStream` sobre `new Response(contents).body`  | Lê até o pedaço do último byte; cancela o resto (RF-10) |

**Alternativas consideradas:**

- _Ler tudo para um `ArrayBuffer` e fatiar._ Viola RF-10 e carrega o arquivo inteiro em memória.
- _Passar `start`/`end` para `getContents`._ Fora de escopo (P2).

### D-08 — Headers de 206 e 416 em `event.res.headers`, com sobrescrita

**Escolha:**

- `content-range` e `content-length` são definidos com `event.res.headers.set`, não com `set` condicional. Assim o 206 sempre usa o tamanho do trecho, mesmo com `options.headers` definindo `content-length` (RF-02). O teste existente `static.test.ts:600-617` cobre só o caminho 200, então não muda.
- `statusText` é definido: `"Partial Content"` e `"Range Not Satisfiable"`, seguindo o padrão de `static.ts:246` (`"Not Modified"`).
- Headers ficam em `event.res.headers`, não em `HTTPResponse.headers`. Em `response.ts:202-204`, `preparedHeaders` sobrescreve `res.headers`, e o padrão do arquivo já usa `event.res.headers`.

### D-09 — HEAD e 416 não chamam `getContents`

**Escolha:** HEAD com Range válido retorna 206 sem corpo. 416 retorna antes de `getContents`. Em ambos, `getContents` não é chamado (RF-06, e também evita leitura desnecessária no 416).

### D-10 — Múltiplas faixas são ignoradas

**Escolha:** `bytes=0-1,5-9` cai na regex de D-05 e é ignorado (200). Não há `multipart/byteranges` (PRD, "Fora de escopo"; RFC 9110 §14.2 permite ignorar).

---

## Arquivos a alterar

### `src/utils/static.ts`

Pontos de citação, conferidos no código atual:

| Linha(s)            | Conteúdo                                               | Ação                                                                               |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `static.ts:9-15`    | `StaticAssetMeta` (`size?: number`, `etag?`, `mtime?`) | Sem mudança                                                                        |
| `static.ts:17-66`   | `ServeStaticOptions`                                   | Sem mudança de assinatura                                                          |
| `static.ts:68-100`  | JSDoc de `serveStatic`                                 | **Adicionar parágrafo** sobre Range, antes de `static.ts:101` (ver "Documentação") |
| `static.ts:101-104` | Assinatura de `serveStatic`                            | Sem mudança                                                                        |
| `static.ts:105-114` | Aplicação de `options.headers`                         | Sem mudança                                                                        |
| `static.ts:116-122` | 405 para método diferente de GET/HEAD                  | Sem mudança (RF-11)                                                                |
| `static.ts:142-147` | Caminho não canônico: 404 ou fallthrough               | Sem mudança                                                                        |
| `static.ts:210-215` | Asset não encontrado: 404 ou fallthrough               | Sem mudança                                                                        |
| `static.ts:227-237` | `mtimeDate` truncado para segundos                     | Sem mudança (usado por D-06)                                                       |
| `static.ts:239-241` | `etag` no response                                     | Sem mudança                                                                        |
| `static.ts:243-248` | 304                                                    | Sem mudança (RF-08)                                                                |
| `static.ts:268-270` | `content-length` do 200                                | Sem mudança                                                                        |
| `static.ts:272-274` | HEAD 200                                               | **Substituir o retorno** pelo bloco novo (ver abaixo)                              |
| `static.ts:276-277` | GET 200 com `getContents`                              | Sem mudança no caminho 200                                                         |
| `static.ts:280`     | `// --- Internal Utils ---`                            | **Acrescentar** helpers após `idSearchPaths` (`static.ts:340-351`)                 |

**Bloco novo em `serveStatic`**, inserido entre `static.ts:270` e `static.ts:272`:

```ts
if (typeof meta.size === "number" && !event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

const range =
  typeof meta.size === "number"
    ? readRange(event.req.headers, meta.size, { etag: meta.etag, mtime: mtimeDate })
    : undefined;

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
  return new HTTPResponse(contents ? sliceContents(contents, range.start, range.end) : null, {
    status: 206,
    statusText: "Partial Content",
  });
}

if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: 200 });
}
```

Nota de tipo: dentro dos ramos, `meta.size` precisa estar narrowed para `number` (`template literal` aceita `undefined`, mas o TypeScript pode reclamar no `${meta.size}`). Se o compilador reclamar, usar `const size = meta.size` após o `typeof` e trocar as referências. Não criar variável fora do `typeof`.

**Helpers novos** (sem `export`, no fim de `static.ts`):

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;

type ByteRange = { start: number; end: number };

function readRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; mtime?: Date },
): ByteRange | "unsatisfiable" | undefined;

function isIfRangeMatch(ifRange: string, validators: { etag?: string; mtime?: Date }): boolean;

function parseByteRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

function sliceContents(contents: BodyInit, start: number, end: number): BodyInit;

function sliceStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  end: number,
): ReadableStream<Uint8Array>;
```

Corpo de `readRange`: `headers.get("range")` nulo ou vazio → `undefined`. Se `headers.get("if-range")` não é `null` e `isIfRangeMatch` é falso → `undefined`. Senão → `parseByteRange(range, size)`.

Corpo de `parseByteRange` (contrato):

```ts
function parseByteRange(value: string, size: number) {
  const match = RANGE_RE.exec(value);
  if (!match) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    // suffix: `bytes=-n`
    const length = Number(last);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && start > Number(last)) return undefined;
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return { start, end };
}
```

Corpo de `isIfRangeMatch`:

```ts
function isIfRangeMatch(ifRange: string, { etag, mtime }: { etag?: string; mtime?: Date }) {
  if (ifRange.startsWith('"') || ifRange.startsWith("W/")) {
    return !!etag && !etag.startsWith("W/") && ifRange === etag;
  }
  return !!mtime && Date.parse(ifRange) === mtime.getTime();
}
```

Corpo de `sliceContents`:

```ts
function sliceContents(contents: BodyInit, start: number, end: number): BodyInit {
  if (typeof contents === "string") {
    return new TextEncoder().encode(contents).subarray(start, end + 1);
  }
  if (contents instanceof Blob) {
    return contents.slice(start, end + 1);
  }
  if (contents instanceof ArrayBuffer) {
    return contents.slice(start, end + 1);
  }
  if (ArrayBuffer.isView(contents)) {
    return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength).subarray(
      start,
      end + 1,
    );
  }
  const stream = contents instanceof ReadableStream ? contents : new Response(contents).body!;
  return sliceStream(stream, start, end);
}
```

Corpo de `sliceStream`: o leitor é demandado conforme o consumidor pede, e o stream é cancelado ao chegar ao último byte.

```ts
function sliceStream(stream, start, end) {
  const reader = stream.getReader();
  let position = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunkStart = position;
        const chunkEnd = position + value.byteLength;
        position = chunkEnd;
        const from = Math.max(start - chunkStart, 0);
        const to = Math.min(end + 1 - chunkStart, value.byteLength);
        if (from < to) controller.enqueue(value.subarray(from, to));
        if (chunkEnd > end) {
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

`{ highWaterMark: 0 }` no stream de saída faz `pull` só quando há demanda, o que torna o número de leituras da origem igual ao consumido (RF-10 exige não ler além do necessário). Se `chunkEnd > end` em um pedaço que começa antes de `start`, o `from < to` é falso e nada é emitido, o que está certo.

### `test/static.test.ts`

- Imports (`static.test.ts:1-3`): não mudam. `describeMatrix` já é importado de `./_setup.ts` (`static.test.ts:3`).
- Novos blocos `describeMatrix` após `static.test.ts:624` (fim de "serve static MIME types") e antes de `static.test.ts:626` ("serve static (malformed url)"). Ver "Estratégia de testes".
- Nenhum teste existente precisa mudar: as asserções existentes usam `toMatchObject` (`static.test.ts:53`, `:69`) ou checam headers específicos. Nenhum compara o conjunto completo de headers. Se a suíte mostrar o contrário ao rodar, ajustar só o teste afetado (PRD, R5).

### `src/index.ts`

- Sem mudança. `src/index.ts:193` continua exportando `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`.

### Documentação

- `docs/2.utils/2.response.md:37` tem o marcador `<!-- automd:jsdocs src="../../src/utils/static.ts" -->`. O conteúdo de `docs/2.utils/2.response.md:39-49` é gerado a partir do JSDoc de `static.ts`. Não editar a seção à mão: alterar o JSDoc em `static.ts:68-100` e rodar `pnpm fmt` (que chama `automd`).
- `docs/4.examples/serve-static-assets.md` não precisa mudar.

---

## Contratos e assinaturas públicas

Nenhuma assinatura pública muda:

```ts
// src/utils/static.ts:101 (inalterado)
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Comportamento observável por status (tudo com `size` numérico):

| Requisição                                                        | Asset    | Status                                                   | Headers específicos                                        | Corpo                            |
| ----------------------------------------------------------------- | -------- | -------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| GET sem Range                                                     | qualquer | 200                                                      | `accept-ranges: bytes`                                     | completo                         |
| GET `bytes=100-199`                                               | 1000     | 206                                                      | `content-range: bytes 100-199/1000`, `content-length: 100` | bytes 100 a 199                  |
| GET `bytes=900-5000`                                              | 1000     | 206                                                      | `content-range: bytes 900-999/1000`, `content-length: 100` | bytes 900 a 999                  |
| GET `bytes=-5000`                                                 | 1000     | 206                                                      | `content-range: bytes 0-999/1000`, `content-length: 1000`  | completo                         |
| GET `bytes=1000-`                                                 | 1000     | 416                                                      | `content-range: bytes */1000`, `content-length: 0`         | vazio                            |
| GET `bytes=-0`                                                    | 1000     | 416                                                      | `content-range: bytes */1000`, `content-length: 0`         | vazio                            |
| GET `bytes=0-0`                                                   | 0        | 416                                                      | `content-range: bytes */0`, `content-length: 0`            | vazio                            |
| GET `bytes=0-1,5-9` / `items=0-5` / `bytes=500-100` / `bytes=abc` | 1000     | 200                                                      | sem `content-range`                                        | completo                         |
| HEAD `bytes=0-99`                                                 | 1000     | 206                                                      | `content-range`, `content-length: 100`                     | vazio, `getContents` não chamado |
| GET com `If-Range` que não coincide                               | 1000     | 200                                                      | sem `content-range`                                        | completo                         |
| GET com `If-None-Match` que coincide e `Range`                    | qualquer | 304                                                      | como hoje                                                  | vazio                            |
| GET `Range` com `accept-encoding: gzip` (`.gz` de 300)            | 300      | 206                                                      | `content-range: bytes 0-99/300`, `content-encoding: gzip`  | 100 bytes do `.gz`               |
| GET ou HEAD com `Range`, asset inexistente                        | —        | 404 (ou `undefined` com fallthrough)                     | como hoje                                                  | —                                |
| POST com `Range`                                                  | qualquer | 405, `allow: GET, HEAD` (ou `undefined` com fallthrough) | como hoje                                                  | —                                |

Observação sobre o caso `size: 0`: o 200 não define `content-length` (`static.ts:268`, condição `meta.size > 0`). Isso não muda. Só o 416 define `content-length: 0`.

---

## Estratégia de testes

Todos os testes novos usam `describeMatrix` (roda em `web` e `node`), como pede `AGENTS.md`. Usar o padrão de `static.test.ts:5-31`: `t.app.all("/range/**", ...)` com `getMeta` que devolve `{ type, etag: '"abc"', mtime: 1_700_000_000_000, size: 1000 }` e `getContents` que devolve um `string` de 1000 caracteres ASCII, por exemplo `"abcdefghij".repeat(100)`. Assim o corpo esperado é `CONTENT.slice(start, end + 1)`.

**Ordem de execução (AGENTS, "Bug Fix Workflow"):** escrever os testes primeiro e rodá-los contra `master` para confirmar a falha. Ver a correção do critério do PRD abaixo.

| Teste                                                                    | RF          | Asserções principais                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept-Ranges em GET 200 e HEAD 200                                      | RF-01       | `accept-ranges: bytes`, `content-length: 1000`                                                                                                                               |
| Sem `accept-ranges` quando `size` é indefinido                           | RF-01, D-03 | `getMeta` sem `size`; header ausente                                                                                                                                         |
| Sem `accept-ranges` na 304                                               | D-03        | `if-none-match` que coincide; header ausente                                                                                                                                 |
| 206 para `bytes=100-199` com corpo exato                                 | RF-02       | status 206, `content-range`, `content-length: 100`, `text()` igual a `CONTENT.slice(100, 200)`; `etag` e `last-modified` iguais ao 200                                       |
| Mesmo 206 com `headers: { "content-length": "999" }`                     | RF-02, D-08 | `content-length` é `100`, não `999`                                                                                                                                          |
| Limites: `bytes=900-5000` e `bytes=-5000`                                | RF-03       | `content-range` e `content-length` do PRD                                                                                                                                    |
| 416 para `bytes=1000-`, `bytes=-0`, e para asset de `size: 0`            | RF-04       | status, `content-range: bytes */1000`, `content-length: 0`, corpo vazio                                                                                                      |
| Ignorado para `bytes=0-1,5-9`, `items=0-5`, `bytes=500-100`, `bytes=abc` | RF-05       | status 200, corpo completo, sem `content-range`, **com** `accept-ranges: bytes`                                                                                              |
| HEAD 206 e `getContents` não chamado                                     | RF-06       | `vi.fn` do `getContents` com `not.toHaveBeenCalled()`                                                                                                                        |
| If-Range ETag: `"xyz"` ignora, `"abc"` honra                             | RF-07       | 200 completo; depois 206 com `content-length: 10`                                                                                                                            |
| If-Range ETag fraca nunca coincide                                       | RF-07, D-06 | `getMeta` com `etag: 'W/"abc"'`, `If-Range: 'W/"abc"'` e `If-Range: '"abc"'` → 200                                                                                           |
| If-Range data: igual honra, diferente ignora, sem `mtime` ignora         | RF-07, D-06 | `If-Range: new Date(1_700_000_000_000).toUTCString()` → 206; data de 1 segundo a menos → 200; asset sem `mtime` → 200                                                        |
| 304 tem precedência sobre Range                                          | RF-08       | `if-none-match: "abc"` e `Range` → 304 sem corpo                                                                                                                             |
| Range sobre variante `.gz`                                               | RF-09       | `encodings: { gzip: ".gz" }`, arquivo de 300 bytes, `bytes=0-99` → 206, `content-range: bytes 0-99/300`, `content-encoding: gzip`                                            |
| Stream lido só até o último byte                                         | RF-10       | `ReadableStream` de 1000 pedaços de 1 byte, `highWaterMark: 0` na origem, contador de `pull`; `bytes=0-9` → corpo de 10 bytes, contador `=== 10`, `cancel` da origem chamado |
| Corpo igual para cada tipo                                               | D-07        | Matriz de `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` com `bytes=100-199` → mesmo corpo                                                                  |
| 404 e 405 com Range                                                      | RF-11       | 404 para asset inexistente com Range; 405 com `allow: GET, HEAD` para POST com Range                                                                                         |

**Fixtures:** não usar `etag: "w/123"` (usado em `static.test.ts:12`, `:211`) em testes de If-Range. Por ser minúsculo, `w/` não é reconhecido como fraco pela comparação case-sensitive (D-06), e o teste pode passar por motivo errado. Usar `'"abc"'` e `'W/"abc"'`.

**Asserções de integração de headers:** para `accept-ranges`, usar `res.headers.get(...)`, como o restante do arquivo, e não comparar o objeto inteiro.

### Correção do critério do PRD

O PRD diz que os testes de RF-02, RF-04 e RF-05 falham antes da correção. Isso vale para RF-02 e RF-04. RF-05 **passa** antes da correção, porque o código atual já ignora o Range e responde 200 completo. Para que RF-05 proteja a regressão e falhe antes quando o `Accept-Ranges` estiver ausente, as asserções de RF-05 devem incluir `accept-ranges: bytes` (RF-01 vale mesmo quando o Range é ignorado). Com essa asserção, o teste falha antes e passa depois.

### Comandos de verificação

```bash
pnpm vitest run test/static.test.ts          # novos e existentes
pnpm vitest run test/security.test.ts        # serveStatic com guardas de rota
pnpm vitest run test/unit/package.test.ts    # snapshot de exportações (RF-12)
pnpm typecheck                               # tsc --noEmit
pnpm lint                                    # oxlint + oxfmt --check
pnpm fmt                                     # regenera a documentação via automd
```

Ao final, `pnpm test` (lint, typecheck e cobertura) deve passar. O `pnpm fmt` deve ser rodado antes de `pnpm lint`, porque o `automd` regenera `docs/2.utils/2.response.md`.

---

## Riscos

Os riscos R1 a R6 do PRD valem como estão. Abaixo, o que a especificação acrescenta ou especifica.

- **R1 — Custo em streams (PRD).** Chegar a um intervalo perto do fim de um stream exige ler e descartar os bytes anteriores. D-07 limita a leitura ao pedaço do último byte, mas não elimina o custo. Blob, ArrayBuffer e string não têm esse custo.
- **R2 — Tamanho divergente (PRD).** Se `getContents` devolver menos bytes que `meta.size`, o `content-length` do 206 fica maior que o corpo, e o runtime pode falhar a conexão. `sliceStream` não tenta corrigir isso: ao chegar ao fim do stream, ele fecha. Isso é o comportamento de P1.
- **R3 — Data em If-Range (PRD).** D-06 compara com `Date.parse`. Formatos fora do HTTP-date podem ser aceitos pelo `Date.parse` do runtime, como `"1"` ou ISO. Como a comparação é com `mtime` exato em segundos, o efeito é restrito a um caso já coincidente. Não há risco de servir conteúdo errado.
- **R4 — Runtimes (PRD).** `describeMatrix` cobre `web` e `node`. A contagem exata de leituras de RF-10 pode variar com o adaptador de `node`, porque o pipe de `srvx` pode puxar pedaços a mais. Se isso ocorrer, a asserção do teste deve virar `toBeLessThanOrEqual(10)`, e não `toBe(10)`, mantendo a garantia de RF-10 (não ler até o fim).
- **R5 — Testes existentes (PRD).** Verificado por leitura: nenhum teste existente compara o conjunto completo de headers de `serveStatic`. Confirmar ao rodar.
- **R6 — Corpo nulo com `size > 0` (PRD).** Um 206 com `getContents` devolvendo `null` tem `content-length` do trecho e corpo vazio. É o mesmo problema que já existe no 200 (`static.ts:277`), e a especificação não o corrige.
- **R7 — Tamanho de `static.ts` (novo).** Com D-02, o arquivo vai a cerca de 450 linhas, acima da meta de 200 do `AGENTS.md`. É um desvio consciente, pedido pelo contrato. Se o time preferir, extrair os helpers para `src/utils/internal/range.ts` depois, sem mudar comportamento nem API.
- **R8 — Validadores fracos em fixtures (novo).** Fixtures com `etag` sem aspas ou com `w/` minúsculo podem passar por forte. Ver "Fixtures" acima.
- **R9 — ETag do `meta` vs. ETag do response (novo).** D-06 compara com `meta.etag`, o mesmo valor que `isCacheMatch` usa (`static.ts:243`). Se um handler sobrescrever `etag` via `event.res.headers` (`static.ts:239`), o `If-Range` continua comparando com `meta.etag`. Isso é consistente com a validação de 304, mas pode divergir do header que o cliente recebeu. Aceito, documentado aqui.
- **R10 — Range com `headers` que definem `content-range` (novo).** D-08 sobrescreve. Um usuário que defina `content-range` em `options.headers` não consegue impedir a sobrescrita no 206. Comportamento esperado.
- **R11 — Accept-Ranges em 304 (novo, D-03).** A issue pede "sempre" anunciar. A 304 fica sem o header. Se os mantenedores quiserem o header também na 304, é uma linha: mover o bloco para antes de `static.ts:243`.
- **R12 — Número muito grande no Range (novo).** `Number("9".repeat(400))` vira `Infinity`. Em `parseByteRange`, `start >= size` trata isso como 416, e `Math.min(..., size - 1)` trata o fim. Não há erro, mas o comportamento deve ser coberto por um teste pequeno (`bytes=0-99999999999999999999999`).
