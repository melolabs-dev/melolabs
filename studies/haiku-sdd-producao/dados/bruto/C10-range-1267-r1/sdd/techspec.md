# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-13, premissas P1 a P5, riscos R1 a R5). Este documento não repete os requisitos; ele fixa **como** implementar. Quando houver conflito, vale o PRD.

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `98deeb6`).

---

## 1. Visão geral

`serveStatic` (`src/utils/static.ts:101`) passa a:

1. anunciar `Accept-Ranges: bytes` em todo asset encontrado;
2. interpretar um `Range` de intervalo único em GET e HEAD, respondendo 206 ou 416;
3. respeitar `If-Range` e a precedência de 304 sobre `Range`;
4. fatiar o corpo devolvido por `getContents` sem mudar a API pública.

Nenhum arquivo novo é exportado. Nenhuma opção nova é adicionada a `ServeStaticOptions`. Nenhum arquivo do `src/` fora de `src/utils/static.ts` muda, exceto o `CHANGELOG.md` (ver §5).

---

## 2. Decisões de arquitetura

### D-01 — Helpers ficam no próprio `src/utils/static.ts`

**Contexto.** `AGENTS.md` pede helpers em `utils/internal/` quando passam de algumas linhas. Mas o `pedido.md` (seção "Restrições") e o PRD (RF-11) exigem que "todos os helpers fiquem privados ao módulo `src/utils/static.ts`".

**Alternativas.**
- (a) Criar `src/utils/internal/range.ts` com o parser e o `If-Range`, importado por `static.ts`.
- (b) Colocar tudo como funções não exportadas em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Escolha: (b).** O requisito de escopo é explícito e prevalece sobre a convenção geral. A consequência é que `static.ts` passa das ~350 linhas para algo perto de 450. Isso é aceito como risco (§6, R-06), com a divisão em arquivo interno como tarefa de acompanhamento, não desta entrega.

### D-02 — Parser de `Range` estrito: um intervalo, sintaxe `bytes=a-b`, `a-`, `-n`

**Alternativas.**
- (a) Parser completo da gramática `1#(byte-range-spec / suffix-byte-range-spec)`, com suporte a `multipart/byteranges`.
- (b) Regex de intervalo único; qualquer outra forma (lista com vírgula, unidade diferente, sintaxe ruim) é tratada como `Range` ignorado.

**Escolha: (b).** É o que pede a issue e o PRD (RF-02, "Fora de escopo": múltiplos intervalos). A regex é ancorada, sem espaço interno:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;
```

Passos sobre o valor já passado por `.trim()`:

1. Não casa com `RANGE_RE`, ou os dois lados estão vazios (`bytes=-`) → **inválido** → `Range` ignorado.
2. Lado esquerdo vazio (sufixo, `bytes=-n`):
   - `n === 0` ou `size === 0` → **não satisfazível**.
   - senão → `start = max(size - n, 0)`, `end = size - 1`.
3. Lado direito preenchido e `Number(direita) < Number(esquerda)` → **inválido** (`bytes=5-2`, RF-02).
4. `start >= size` → **não satisfazível** (cobre `size === 0`, RF-05).
5. `end = direita vazia ? size - 1 : min(direita, size - 1)`. Resultado: intervalo válido `[start, end]`.

A comparação da unidade é sem diferenciar maiúsculas, pela flag `i`. Isso é decisão de implementação: a RFC trata a unidade como token. Números maiores que `Number.MAX_SAFE_INTEGER` não exigem tratamento especial: ficam acima de `size`, então caem no passo 4 (416), que é o resultado correto.

### D-03 — Ordem de avaliação dentro de `serveStatic`

Ordem obrigatória, de cima para baixo:

1. Headers de `options.headers` (já existente, `src/utils/static.ts:105-114`).
2. Método, caminho canônico, lookup de meta, 404 (já existentes).
3. `Vary`, `last-modified`, `etag`, `content-type`, `content-encoding`, `content-length` do meta (já existentes, `src/utils/static.ts:220-270`).
4. **Novo:** `Accept-Ranges` (§3.1).
5. Validação de cache: 304 (já existente, `src/utils/static.ts:243-248`). Sempre antes de `Range` (RF-08).
6. **Novo:** resolução de `Range` com `If-Range` e satisfazibilidade (§3.2): `undefined` (ignorar), 206 ou 416.
7. HEAD (já existente, `src/utils/static.ts:272-274`): 200 vazio, ou 206/416 vazio, sem chamar `getContents`.
8. GET: `getContents` e resposta (já existente, `src/utils/static.ts:276-277`), ou 206 com corpo fatiado.

A razão para `If-Range` vir antes da satisfazibilidade: se o validador falha, a RFC manda ignorar o `Range` inteiro. Assim, um `Range` não satisfazível com `If-Range` falso responde 200, não 416.

### D-04 — Headers de 206 e 416 vão para `event.res.headers` com `set`, não para o `HTTPResponse`

**Motivo.** Em `src/response.ts:198-203`, quando o handler devolve `HTTPResponse`, os headers de `event.res.headers` (`preparedHeaders`) são mesclados **por cima** dos headers do `HTTPResponse` (`mergeHeaders(res.headers, preparedHeaders)`, `src/response.ts:243-252`, onde o `overrides` vence). Se `Content-Length` estiver em `options.headers` (`src/utils/static.ts:112`), ele já está em `event.res.headers` e venceria o valor do 206.

**Alternativas.**
- (a) Passar `Content-Length`/`Content-Range` só no `new HTTPResponse(..., { headers })`. **Rejeitada**: o `Content-Length` de `options.headers` venceria (bug que o PRD P4 proíbe).
- (b) Gravar em `event.res.headers` com `set`, e só então devolver o `HTTPResponse` com status e corpo. **Escolhida.**

Regra: `Content-Length`, `Content-Range` e `Accept-Ranges` são sempre gravados com `event.res.headers.set(...)`. Nunca com `has`/`get` antes de gravar. Isso sobrepõe o valor de `options.headers` e o `Content-Length` do meta (P4).

### D-05 — Fatiamento do corpo por tipo

Contrato em §3.3. Escolha por tipo de `getContents`:

- `string`, `ArrayBuffer`, `ArrayBuffer.isView(...)`, `Blob` → `new Blob([body]).slice(start, start + length)`. Não copia o conteúdo; a string é codificada em UTF-8, igual ao que `Response` faria. Isso só é correto se `meta.size` for o número de **bytes** (P1, ver R-05).
- `ReadableStream` → `sliceStream` (§3.3): descarta `start` bytes, emite `length` bytes e cancela a origem ao terminar (R1 do PRD).
- Qualquer outro `BodyInit` (`URLSearchParams`, `FormData`) → `new Response(body).body` e depois `sliceStream`.

**Alternativas.**
- (a) Sempre `await new Response(body).arrayBuffer()` e fatiar em memória. **Rejeitada**: carrega o arquivo inteiro na memória a cada Range, inclusive para `Blob`, onde `slice` é gratuito.
- (b) Sempre stream. **Rejeitada**: `Blob`/string ficariam mais lentos sem ganho.

### D-06 — Semântica de `If-Range`

Contrato em §3.2. Regras:

- Valor começa com `W/` → **não bate** (validador fraco nunca honra `Range`, RFC 9110 §13.1.5).
- Valor começa com `"` → validador forte. Bate somente se `meta.etag` existir, não começar com `W/` e for **igual** (comparação exata de string) ao valor. Não reutilizar `matchETag` de `src/utils/internal/cache.ts:11`: ele faz comparação **fraca** (ignora `W/`), e `If-Range` exige forte.
- Caso contrário, trata como data. Bate somente se `meta.mtime` existir e `new Date(valor).getTime()` for igual a `mtimeDate.getTime()` (já truncado em segundos em `src/utils/static.ts:232`). Data inválida (`NaN`) não bate.

**Alternativas.** Validador de data com a regra da RFC 9110 §8.8.2.2 (Last-Modified pelo menos 1 s antes do Date). **Rejeitada** nesta entrega: o PRD R3 registra a simplificação e a mitiga com ETag.

### D-07 — `Accept-Ranges` só em asset encontrado, e só se ausente

Gravado após `etag` (`src/utils/static.ts:239-241`) e antes do 304 (`src/utils/static.ts:243`), com o mesmo padrão de `etag` e `last-modified` (só grava se ainda não existir), para que um `options.headers` com `accept-ranges` seja respeitado. Fica de fora de 404 e 405, cumprindo RF-10.

### D-08 — `getContents` devolve `null`/`undefined` em 206

Se o `Range` for válido em GET mas `getContents` devolver `null` ou `undefined`, a resposta é a de hoje: 200 com corpo `null` (`src/utils/static.ts:277`, `contents || null`). Nenhum `Content-Range` é gravado, porque os headers de range só são gravados depois que o corpo existe. Isso preserva o comportamento atual, que já é inconsistente quando `size > 0` (ver R-04). Não é fonte de nova inconsistência.

### D-09 — Testes em arquivo irmão

Os testes novos vão em `test/static-range.test.ts`, com `describeMatrix` (`test/_setup.ts:11`), nos modos `web` e `node`. **Não** entram em `test/static.test.ts` (678 linhas), e nenhum teste existente é editado (PRD R5). O snapshot de exports (`test/unit/package.test.ts:4`) continua sendo a guarda de RF-11 e não muda.

---

## 3. Contratos e assinaturas

Tudo abaixo é **não exportado**, no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---`. Os tipos auxiliares também não são exportados.

### 3.1 Alteração em `serveStatic`

Inserção 1, depois de `src/utils/static.ts:241` (bloco do `etag`), antes de `isCacheMatch` (`src/utils/static.ts:243`):

```ts
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
```

Inserção 2, substituindo `src/utils/static.ts:272-277` (HEAD e GET finais) pelo bloco abaixo. O bloco de `content-length` em `src/utils/static.ts:268-270` **não muda**: ele roda antes, e a inserção 2 é que sobrepõe quando há 206/416.

```ts
const range = resolveRange(event.req.headers, {
  size: meta.size,
  etag: meta.etag,
  lastModified: mtimeDate,
});

if (range?.status === 416) {
  setRangeHeaders(event, range);
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range) {
  if (event.req.method === "HEAD") {
    setRangeHeaders(event, range);
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  if (contents != null) {
    setRangeHeaders(event, range);
    return new HTTPResponse(sliceBody(contents, range.start, range.end - range.start + 1), {
      status: 206,
      statusText: "Partial Content",
    });
  }
  // D-08: sem corpo, responde como hoje, sem headers de range.
  return new HTTPResponse(null, { status: 200 });
}

if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: 200 });
}

const contents = await options.getContents(id);
return new HTTPResponse(contents || null, { status: 200 });
```

Observação sobre o `return` de 206 com corpo: `sliceBody` nunca devolve `null`, então `contents` não-nulo gera corpo não-nulo.

### 3.2 Resolução de `Range`

```ts
interface ByteRangeMeta {
  size?: number;
  etag?: string;
  lastModified?: Date;
}

/** Resultado de `resolveRange`. `undefined` significa: `Range` ignorado, responder 200. */
type RangeResolution =
  | { status: 206; start: number; end: number; size: number }
  | { status: 416; size: number };

function resolveRange(headers: Headers, meta: ByteRangeMeta): RangeResolution | undefined;
```

Comportamento, na ordem:

1. `headers.get("range")` é `null` → `undefined`.
2. `meta.size` não é número finito ≥ 0 → `undefined`.
3. `parseByteRange(range, size)` retorna inválido → `undefined`. Retorna `"unsatisfiable"` ou `[start, end]` (D-02).
4. Há `if-range` e `!ifRangeMatches(ifRange, meta)` → `undefined` (D-03).
5. `"unsatisfiable"` → `{ status: 416, size }`.
6. `[start, end]` → `{ status: 206, start, end, size }`.

```ts
/** Retorna `[start, end]` (inclusivos), `"unsatisfiable"`, ou `undefined` para `Range` inválido. */
function parseByteRange(value: string, size: number): [number, number] | "unsatisfiable" | undefined;

function ifRangeMatches(value: string, meta: ByteRangeMeta): boolean;
```

`ifRangeMatches`:

```ts
if (value.startsWith("W/")) return false;
if (value.startsWith('"')) {
  return !!meta.etag && !meta.etag.startsWith("W/") && value === meta.etag;
}
if (!meta.lastModified) return false;
const date = new Date(value).getTime();
return !Number.isNaN(date) && date === meta.lastModified.getTime();
```

### 3.3 Escrita de headers e corpo

```ts
/** Grava os headers de um 206 ou de um 416 em `event.res.headers` (D-04). */
function setRangeHeaders(event: H3Event, range: RangeResolution): void;
```

- 206: `content-range: bytes {start}-{end}/{size}` e `content-length: {end - start + 1}`.
- 416: `content-range: bytes */{size}` e `content-length: 0`.

Ambos com `event.res.headers.set`, nunca `has`/`get` antes.

```ts
/** Fatia o corpo a partir do byte `start`, com `length` bytes. Nunca devolve `null`. */
function sliceBody(body: NonNullable<BodyInit>, start: number, length: number): Blob | ReadableStream<Uint8Array>;

/** Stream com os bytes [skip, skip + take) de `stream`. Cancela a origem ao terminar ou ao ser cancelado. */
function sliceStream(stream: ReadableStream<Uint8Array>, skip: number, take: number): ReadableStream<Uint8Array>;
```

Regras de `sliceBody`:

- `body instanceof ReadableStream` → `sliceStream(body, start, length)`.
- `typeof body === "string"` ou `body instanceof Blob` ou `body instanceof ArrayBuffer` ou `ArrayBuffer.isView(body)` → `new Blob([body]).slice(start, start + length)`.
- Qualquer outro → `sliceStream(new Response(body).body!, start, length)`.

Regras de `sliceStream`: `reader = stream.getReader()`, `pull` lê chunks, descarta até `skip` bytes (fatiando o chunk que cruza a fronteira), emite até `take` bytes e, ao chegar a `take`, faz `controller.close()` e `reader.cancel()`. `cancel(reason)` repassa para `reader.cancel(reason)`.

---

## 4. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Inserção 1 (`Accept-Ranges`) em `src/utils/static.ts:241`. Substituição de `src/utils/static.ts:272-277` pelo bloco de §3.1. Novas funções internas no fim do arquivo, após `idSearchPaths` (`src/utils/static.ts:340-351`). Nenhuma mudança em `ServeStaticOptions` (`src/utils/static.ts:17-66`) nem em `StaticAssetMeta` (`src/utils/static.ts:9-15`). |
| `test/static-range.test.ts` | **Novo.** Testes de §5. |
| `CHANGELOG.md` | Entrada nova: suporte a `Range` em `serveStatic`; nota de R2 (cliente que enviava `Range` recebe 206) e de R4 (`Content-Length` de `options.headers` é sobreposto em 206). |

**Não alterar:** `src/index.ts:191-193` (exports, RF-11); `src/rules/cache.ts:143-148` (bypass de `Range` no ocache, PRD "Fora de escopo"); `src/utils/internal/cache.ts` (não reutilizar `matchETag`, D-06); `src/response.ts` (a precedência de merge em `:198-203` é usada como está, D-04); `test/static.test.ts` e `test/rules/cache.test.ts` (PRD R5).

**Ponto de atenção de imports:** `static.ts` já importa `HTTPResponse` (`src/utils/static.ts:7`) e `H3Event` como tipo (`src/utils/static.ts:1`). Não há import novo. `Blob`, `Response`, `ReadableStream` são globais em Node 18+ e nos runtimes web (ver `tsconfig.json`, lib `ESNext`, `WebWorker`, `DOM`).

---

## 5. Estratégia de testes

Arquivo: `test/static-range.test.ts`, com `describeMatrix` (`test/_setup.ts:11`) e `describe`/`it`/`expect`/`vi` do vitest, como em `test/static.test.ts:1-5`.

**Fixture comum.** Um asset `/file.bin` de 1000 bytes com conteúdo previsível, por exemplo `Uint8Array` com `byte[i] = i % 256`. `getMeta` devolve `{ size: 1000, etag: '"abc"', mtime: 1_700_000_000_000, type: "application/octet-stream" }`. `getContents` é `vi.fn` e devolve o `Uint8Array` completo. Asserções de corpo comparam com `new Uint8Array(await res.arrayBuffer())` contra `bytes.subarray(start, end + 1)`, para validar o conteúdo, não só o tamanho.

**Casos, mapeados aos requisitos:**

| Caso | Requisito | Verificação |
| --- | --- | --- |
| GET sem `Range` | RF-01 | 200, `accept-ranges: bytes`, sem `content-range`, corpo de 1000 bytes |
| `Range: bytes=5-2` | RF-02 | 200, `content-length: 1000`, sem `content-range` |
| `Range: items=0-9` | RF-02 | 200 |
| `Range: bytes=0-1,3-4` | RF-02 | 200 |
| `Range: bytes=abc` | RF-02 | 200 |
| `getMeta` sem `size` com `Range` | RF-02 | 200 |
| `Range: bytes=100-199` | RF-03 | 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo igual |
| `bytes=-50`, `bytes=900-`, `bytes=500-5000` | RF-04 | 206 com `bytes 950-999/1000`, `900-999/1000`, `500-999/1000`, nessa ordem |
| `bytes=-5000` (sufixo maior que o arquivo) | RF-04 | 206 com `bytes 0-999/1000` |
| `bytes=1000-1100` | RF-05 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| `bytes=-0` | RF-05 | 416 |
| Asset de `size: 0` com `Range: bytes=0-0` | RF-05 | 416 com `bytes */0` |
| HEAD com `bytes=100-199` | RF-06 | 206, headers corretos, corpo vazio, `getContents` não chamado (`expect(getContents).not.toHaveBeenCalled()`) |
| HEAD com `bytes=1000-1100` | RF-06 | 416 |
| `If-Range: "xyz"` | RF-07 | 200 completo |
| `If-Range: "abc"` | RF-07 | 206 `bytes 0-9/1000` |
| `If-Range: W/"abc"` | RF-07 | 200 |
| `If-Range` com data igual a `Last-Modified` | RF-07 | 206 |
| `If-Range` com data diferente | RF-07 | 200 |
| `If-None-Match: "abc"` com `Range` | RF-08 | 304, sem `content-range`, corpo vazio |
| `encodings: { br: ".br" }`, `app.js.br` de 500 bytes, `Accept-Encoding: br`, `Range: bytes=0-9` | RF-09 | 206, `content-encoding: br`, `content-range: bytes 0-9/500`, `content-length: 10` |
| POST com `Range` em asset existente | RF-10 | 405, `allow: GET, HEAD`, sem `content-range` nem `accept-ranges` |
| GET em asset inexistente com `Range` | RF-10 | 404, sem `content-range` nem `accept-ranges` |
| Mesmo caso com `fallthrough: true` | RF-10 | `undefined` (próximo handler), sem headers de range |
| `options.headers: { "content-length": "999" }` com `Range: bytes=0-9` | D-04, P4 | 206 com `content-length: 10` (não 999) |
| `getContents` devolvendo `ReadableStream` de 1000 bytes, `Range: bytes=100-199` | RF-12 | corpo de 100 bytes iguais a 100..199 |
| `getContents` devolvendo `Blob`, `ArrayBuffer`, string ASCII | RF-12 | mesmo resultado |
| Stream com `Range` que termina no meio de um chunk | RF-12 | fatiamento correto nas duas fronteiras |
| `getContents` devolvendo `null` com `Range` válido | D-08 | 200, corpo vazio, sem `content-range` |
| `getContents` chamado uma vez em GET com 206 | §3.1 | `toHaveBeenCalledTimes(1)` |
| `accept-ranges` já definido em `options.headers` | D-07 | valor do usuário preservado |

**Regressão.** Rodar `pnpm vitest run test/static.test.ts test/static-range.test.ts test/rules/cache.test.ts test/unit/package.test.ts test/security.test.ts`. Nenhum teste existente deve ser editado. `test/static.test.ts` e `test/security.test.ts` usam `serveStatic` sem `Range`, então devem passar sem mudança. O snapshot de exports (`test/unit/package.test.ts:4`) é a prova de RF-11.

**Quality gates.** `pnpm lint` (oxlint + oxfmt) e `pnpm typecheck` (`tsc --noEmit`). A suíte completa (`pnpm test`) inclui cobertura; rodar uma vez antes de abrir o PR.

**Ordem de trabalho (bug-fix workflow de `AGENTS.md`, adaptado a feature).** Escrever primeiro os testes de §5 e confirmar que falham nos casos de 206/416 e passam nos de regressão. Depois implementar. Por fim rodar a suíte inteira.

---

## 6. Riscos

- **R-01 — Custo de streams (PRD R1).** Fatiar `ReadableStream` lê e descarta o prefixo. Um Range no fim de arquivo grande lê o arquivo inteiro. Aceito; otimizar exige API nova, fora de escopo.
- **R-02 — Mudança de comportamento (PRD R2).** Cliente que enviava `Range` válido e recebia 200 passa a receber 206. Entra no changelog.
- **R-03 — `If-Range` por data (PRD R3).** Sem a regra de §8.8.2.2 da RFC 9110, um arquivo modificado no mesmo segundo pode retornar 206 de versão errada. Mitigado por ETag. Além disso, `new Date(valor)` aceita formatos além do IMF-fixdate; aceito por simplicidade.
- **R-04 — `content-length` com `getContents` nulo (D-08).** Se `getContents` devolver `null` com `size > 0`, o 200 já sai com `Content-Length` maior que o corpo. Esse comportamento é anterior e fica igual. Não corrigir aqui.
- **R-05 — `size` precisa ser bytes.** A fatia de string usa UTF-8 (`Blob`). Se um backend informar `size` como número de caracteres, o intervalo sai errado. P1 do PRD já atribui essa falha ao backend; a documentação de `getMeta` deve dizer "bytes" no changelog.
- **R-06 — Crescimento de `static.ts` (D-01).** O arquivo passa de ~350 para ~450 linhas, acima da meta de ~200 em `AGENTS.md`. Aceito pelo requisito de escopo. Tarefa de acompanhamento: mover os helpers para `src/utils/internal/range.ts` quando o requisito de escopo puder ser revisto.
- **R-07 — Cache com regras (`h3/rules/cache`).** Requisições com `Range` passam direto pelo ocache (`src/rules/cache.ts:143-148`). Isso é o comportamento atual e segue fora de escopo; respostas 206 não entram no cache de regras.
- **R-08 — Headers de 416.** A resposta 416 carrega também `content-type`, `etag` e `last-modified` do asset, gravados antes. Não quebra a RFC nem o PRD, e não tem corpo. Documentar se alguém reclamar.
- **R-09 — Regressão silenciosa de precedência.** Se alguém, no futuro, passar `Content-Length` só em `HTTPResponse.headers` (contra D-04), o teste "`options.headers` com `content-length: 999`" de §5 deve falhar. Ele existe para isso.
