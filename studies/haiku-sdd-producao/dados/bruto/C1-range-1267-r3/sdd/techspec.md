# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-12). Este documento define como implementar; o comportamento esperado está no PRD e não é repetido aqui.

Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range Requests). A RFC 7233 citada na issue está superada.

---

## 1. Estado atual do código

- `src/utils/static.ts:101-104` — assinatura de `serveStatic(event, options)`, que retorna `HTTPResponse | undefined`.
- `src/utils/static.ts:105-114` — a opção `headers` é gravada em `event.res.headers` antes de qualquer decisão.
- `src/utils/static.ts:116-122` — métodos fora de GET/HEAD: `fallthrough` ou 405 com `allow: GET, HEAD`.
- `src/utils/static.ts:198-215` — busca de `getMeta` nas variantes (encoding + index). Sem `meta`: 404 ou `fallthrough`.
- `src/utils/static.ts:220-225` — `vary: accept-encoding` é definido só depois de achar o asset (evita vazar `vary` para o próximo handler).
- `src/utils/static.ts:239-241` — `etag` é definido a partir de `meta.etag` quando ainda não existe.
- `src/utils/static.ts:243-248` — `isCacheMatch` devolve 304. É o ponto em que RF-09 precisa ser preservado.
- `src/utils/static.ts:268-270` — `content-length` vem de `meta.size` somente se `size > 0` e o cabeçalho ainda não existe. Isso é o que faz `headers: { "content-length": "999" }` prevalecer (teste em `test/static.test.ts:600-617`).
- `src/utils/static.ts:272-274` — HEAD devolve 200 com corpo nulo.
- `src/utils/static.ts:276-277` — GET chama `options.getContents(id)` e devolve 200 com o corpo.
- `src/utils/static.ts:280` — início da seção `// --- Internal Utils ---`, onde ficam os helpers privados.
- `src/utils/static.ts:283-351` — helpers privados existentes (`parseAcceptEncoding`, `normalizeCoding`, `idSearchPaths`). O módulo tem 351 linhas.
- `src/utils/internal/cache.ts:11-17` — `matchETag` (comparação fraca, usada em If-None-Match). Não serve para If-Range, que exige comparação forte.
- `src/utils/internal/cache.ts:51-53` — `opaqueTag` remove o prefixo `W/`. Para If-Range a checagem de fraqueza é própria.
- `src/response.ts:96-106` — `HTTPResponse(body, init)`. `status` e `statusText` do init são opcionais e, quando definidos, vencem `event.res.status`.
- `src/response.ts:203` — para `HTTPResponse`, `event.res.headers` (preparados) sobrescrevem os `headers` do init via `mergeHeaders`. Logo, `content-range` e `content-length` definidos em `event.res.headers` vencem.
- `src/response.ts:243-252` — `mergeHeaders` usa `set`, exceto `set-cookie`.
- `src/index.ts:193` — `export { type ServeStaticOptions, type StaticAssetMeta, serveStatic } from "./utils/static.ts";`. Nenhuma linha nova é necessária.
- `src/rules/cache.ts:143-148` — `isBypassedRequest` pula o cache quando há `range`. Já existe e é compatível com "cache de respostas parciais fora de escopo".
- `test/unit/package.test.ts:133` — lista de exports públicos. Serve como guarda contra exportações novas.
- `test/static.test.ts:5-31` — bloco `describeMatrix("serve static", …)` com `getMeta` que devolve `size` (linha 18), `etag: "w/123"` (linha 15) e encodings gzip/br.
- `test/static.test.ts:396-523` — bloco com `fallthrough`.
- `test/_setup.ts:11-38` — `describeMatrix` roda cada teste em `web` e `node`.

---

## 2. Decisões de arquitetura

### D-01 — Helpers privados ficam em `src/utils/static.ts`

**Contexto.** O pedido ("Keep all helper logic private within the serveStatic module") e o PRD (RF-12) pedem que os auxiliares fiquem no módulo `static.ts`. O `AGENTS.md` prefere arquivos com menos de 200 linhas e helpers internos em `utils/internal/`.

**Alternativas.**
- (a) Criar `src/utils/internal/range.ts`, sem exportação pública.
- (b) Manter tudo em `src/utils/static.ts`, na seção `// --- Internal Utils ---`.

**Escolha: (b).** O contrato do pedido é explícito e (a) não o cumpre literalmente. O arquivo passa de 351 para cerca de 480 linhas, acima da meta do `AGENTS.md`. Isso fica registrado como dívida (ver §7, R-07), para ser tratado depois, em um refactor separado.

### D-02 — `Accept-Ranges` é definido se ausente, antes do 304

**Contexto.** RF-01 exige `Accept-Ranges: bytes` em 200, 206, 304 e 416. Os 304 e 416 são produzidos depois do `isCacheMatch`.

**Alternativas.**
- (a) Sobrescrever sempre com `set`.
- (b) Definir só se o cabeçalho ainda não existir, como `etag` e `last-modified` já fazem.
- (c) Definir só nas respostas 200 e 206.

**Escolha: (b)**, colocado logo depois do bloco de `etag` (`src/utils/static.ts:239-241`) e antes de `isCacheMatch` (`src/utils/static.ts:243`). Assim o 304 também recebe o cabeçalho. Como o bloco roda só depois de achar `meta`, o 404 e o `fallthrough` continuam sem ele. Quem configura `accept-ranges` pela opção `headers` (por exemplo `none`) mantém o valor dele.

### D-03 — Interpretação do cabeçalho `Range`

**Contexto.** RF-02, RF-05 e RF-06 definem quais entradas viram 206, 416 ou são ignoradas. A sintaxe é a da RFC 9110 §14.1 e §14.1.1.

**Regras adotadas**, na função `parseRange`:
1. O valor é dividido em unidade e lista: `^\s*bytes\s*=\s*(.+)$`, sem diferenciar maiúsculas na unidade (confirmar no §14.1, ver §8).
2. Se a lista tiver vírgula, o `Range` é ignorado (`undefined`). Vale para multi-intervalo e para `bytes=0-10, ` com espaço sobrando.
3. Cada especificação casa com `^(\d*)-(\d*)$` depois de `trim()`. Se os dois lados estiverem vazios, ou se `last < first`, a especificação é sintaticamente inválida e o `Range` é ignorado (`undefined`).
4. Sufixo `-n`:
   - `n = 0` → não satisfazível (`"unsatisfiable"`).
   - `n >= size` → intervalo inteiro, `start = 0`.
   - caso contrário, `start = size - n`, `end = size - 1`.
5. Intervalo aberto `a-`: se `a >= size` → não satisfazível. Senão, `end = size - 1`.
6. Intervalo fechado `a-b`: se `a >= size` → não satisfazível. Senão, `end = min(b, size - 1)`.
7. `size === 0` → qualquer intervalo é não satisfazível (ver D-07).

**Alternativas.** Aceitar multi-intervalo com `multipart/byteranges` (fora de escopo pelo PRD). Ou responder 416 para sintaxe inválida: a RFC manda ignorar, e o PRD também.

### D-04 — Precedência de `content-length` e `content-range` sobre a opção `headers`

**Contexto.** Hoje o `content-length` da opção `headers` vence (`src/utils/static.ts:268`, com teste em `test/static.test.ts:600-617`). Se a resposta for 206 ou 416, o `content-length` precisa refletir o trecho ou ser `0`.

**Escolha.** Para 206 e 416, `content-length` e `content-range` são gravados com `set` e sobrescrevem qualquer valor vindo de `headers`. Para 200, nada muda: o teste de `content-length` continua valendo. Esses dois cabeçalhos são de protocolo, e um valor fixo do usuário os tornaria errados.

**Alternativa rejeitada.** Respeitar o `content-length` do usuário também em 206. Isso geraria respostas inválidas.

### D-05 — Validação de `If-Range`

**Escolha.**
- Os validadores comparados são os que a resposta vai emitir: `event.res.headers.get("etag")` e `event.res.headers.get("last-modified")`. Isso vale também quando vêm da opção `headers`.
- Se `If-Range` começar com `"` ou com `W/`, é um ETag. Compara-se com comparação **forte** (RFC 9110 §8.8.3.2): nenhum dos dois pode começar com `W/`, e os textos têm de ser iguais. ETag fraco nunca coincide.
- Caso contrário, é uma data. Coincide só se o texto for exatamente igual ao `last-modified` emitido (PRD RF-08). Não se converte com `Date`.
- Se `If-Range` não coincidir, o `Range` é ignorado e a resposta é 200 completa. Se `If-Range` estiver presente sem `Range`, não tem efeito.

**Alternativa rejeitada.** Comparar datas pelo valor de `Date.parse`. Mais tolerante, mas o PRD pede igualdade exata.

**Nota.** `meta.etag` é usado sem normalização, como em `isCacheMatch`. Os testes existentes usam `"w/123"` (minúsculo, sem aspas), que não é `W/` e, portanto, conta como forte. Isso não muda o comportamento para etags reais, que chegam entre aspas.

### D-06 — Como recortar o corpo devolvido por `getContents`

**Contexto.** `getContents` não recebe offset (PRD, fora de escopo). O recorte precisa ser feito no corpo devolvido. `BodyInit` pode ser string, buffer, view, `Blob`, `ReadableStream`, `FormData` ou `URLSearchParams`.

**Alternativas.**
- (a) Acrescentar um parâmetro de intervalo a `getContents`. Fora de escopo.
- (b) Converter tudo em `ArrayBuffer` e fatiar. Simples, mas carrega o arquivo inteiro na memória.
- (c) Converter tudo em stream e fatiar com `TransformStream`. Uniforme, mas mais lento para casos que já são fatiáveis.
- (d) Escolha por tipo: fatia diretamente o que já permite fatiar e usa stream para o resto.

**Escolha: (d).** A função `sliceBody` trata:
- `null` ou `undefined` → `null` (sem mudança de comportamento).
- `string` → `new TextEncoder().encode(body).subarray(start, end + 1)`.
- `ArrayBuffer` → `body.slice(start, end + 1)`.
- `ArrayBuffer.isView(body)` → `new Uint8Array(body.buffer, body.byteOffset + start, end - start + 1)`, sem cópia.
- `Blob` → `body.slice(start, end + 1)`.
- Qualquer outro tipo (`ReadableStream`, `FormData`, `URLSearchParams`) → `new Response(body).body` e depois `sliceStream`.

`sliceStream` usa `pipeThrough(new TransformStream(...))`. Em cada chunk, emite só a interseção com `[start, end]`, e chama `controller.terminate()` ao passar de `end`. Isso devolve um stream de forma síncrona, e o `terminate` cancela a origem. A origem ainda é lida desde o começo (ver R-01).

### D-07 — Tamanho desconhecido e tamanho zero

- `meta.size === undefined` → o `Range` é ignorado, e a resposta é 200 completa sem `content-range` (RF-07).
- `meta.size === 0` → qualquer `Range` válido é 416 com `content-range: bytes */0`. Segue a RFC 9110 para o caso comum, mas o PRD diz para confirmar antes da implementação (§8).

### D-08 — Status e texto dos novos status

206 e 416 são devolvidos como `HTTPResponse` com `status` e `statusText` no init (`Partial Content`, `Range Not Satisfiable`). Pelo `src/response.ts:195`, o status do `HTTPResponse` vence `event.res.status`. Não é preciso mexer em `event.res.status`.

---

## 3. Arquivos a alterar

| Arquivo | Alteração |
|---|---|
| `src/utils/static.ts` | Lógica de Range: `Accept-Ranges` (após `src/utils/static.ts:241`), decisão de Range (após `src/utils/static.ts:248`), `content-length`/`content-range` (perto de `src/utils/static.ts:268-270`), ramos 206/416 e HEAD/GET (`src/utils/static.ts:272-277`), helpers privados depois de `src/utils/static.ts:280`. |
| `test/static.test.ts` | Novos blocos de teste (§6). Nenhum teste existente deve mudar (ver §6.3). |

Não alterar: `src/index.ts`, `src/response.ts`, `src/utils/internal/cache.ts`, `src/rules/cache.ts`, `docs/`. O PRD exige que a API pública fique igual.

---

## 4. Contratos e assinaturas

### 4.1 Público (inalterado)

```ts
// src/utils/static.ts — sem mudança
export interface StaticAssetMeta { type?; etag?; mtime?; size?; encoding? }
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType? }
export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>
```

`ServeStaticOptions` não ganha campos (RF-12). `getContents` mantém `(id: string) => BodyInit | null | undefined | Promise<...>`.

### 4.2 Privado (só dentro de `src/utils/static.ts`, sem `export`)

```ts
/** Intervalo em bytes, 0-based e inclusivo nos dois lados. */
interface ByteRange {
  start: number;
  end: number;
}

/** Decisão sobre o cabeçalho Range para uma resposta de asset que seria 200. */
type RangeDecision =
  | { type: "full" } // ignora Range: responde 200 completo
  | { type: "partial"; range: ByteRange } // 206
  | { type: "unsatisfiable" }; // 416

/** Validadores que a resposta vai emitir (valores de event.res.headers). */
interface RangeValidators {
  etag?: string | null;
  lastModified?: string | null;
}

/**
 * Decide o que fazer com Range. Ordem: sem Range → "full"; size indefinido → "full";
 * If-Range presente e não coincidente → "full"; senão, parseRange.
 */
function resolveRange(
  headers: Headers,
  size: number | undefined,
  validators: RangeValidators,
): RangeDecision;

/**
 * Interpreta um cabeçalho Range para um corpo de `size` bytes.
 * Devolve undefined quando o cabeçalho deve ser ignorado (malformado, unidade
 * diferente de bytes, múltiplos intervalos), "unsatisfiable" quando é válido
 * mas não cabe, e o intervalo recortado quando é satisfazível.
 */
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Compara If-Range com os validadores atuais (RFC 9110 §13.1.5). */
function ifRangeMatches(ifRange: string, validators: RangeValidators): boolean;

/** Recorta o corpo para o intervalo. Síncrona; streams são recortados via TransformStream. */
function sliceBody(contents: BodyInit | null | undefined, range: ByteRange): BodyInit | null;

/** Recorta um ReadableStream por bytes, emitindo só o intervalo e terminando ao passar de `end`. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: ByteRange,
): ReadableStream<Uint8Array>;
```

### 4.3 Fluxo em `serveStatic` (pseudocódigo)

```ts
// após src/utils/static.ts:241 (etag)
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

// src/utils/static.ts:243-248 — inalterado (RF-09: 304 antes de Range)

const validators = {
  etag: event.res.headers.get("etag"),
  lastModified: event.res.headers.get("last-modified"),
};
const range = resolveRange(event.req.headers, meta.size, validators);

// src/utils/static.ts:268-270 — content-length de meta, como hoje
if (range.type === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (range.type === "partial") {
  const { start, end } = range.range;
  event.res.headers.set("content-range", `bytes ${start}-${end}/${meta.size}`);
  event.res.headers.set("content-length", `${end - start + 1}`);
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(sliceBody(contents, range.range), {
    status: 206,
    statusText: "Partial Content",
  });
}

// caminho atual (200), sem mudança em HEAD e GET
```

Notas:
- O 416 vem depois do 304 (RF-09), e o `isCacheMatch` continua antes de `Range`.
- O 416 com `size === 0` cai em `unsatisfiable`, porque `resolveRange` só chega ao `parseRange` com `size` definido, e `parseRange` trata `size === 0` como não satisfazível.
- O 416 não passa por `getContents`.
- Para `HEAD` com `Range` válido, `getContents` não é chamado (RF-04).

---

## 5. Compatibilidade

- Respostas 200 sem `Range` mudam em um só ponto: ganham `accept-ranges: bytes`. Todos os testes existentes usam `toMatchObject` ou checam cabeçalhos específicos, então isso não quebra nenhum deles.
- `fallthrough`, 404, 405, `isCanonicalPath`, a decodificação do `id` e a seleção de encoding não mudam, porque o código novo roda só depois que `meta` foi encontrado e antes do `return` de 200.
- `event.res.headers` com `vary` e `etag` (cache) não são alterados.
- O `h3/rules/cache` já ignora `Range` (`src/rules/cache.ts:143-148`), então o cache de regras não guarda 206.

---

## 6. Estratégia de testes

### 6.1 Ordem

Como é uma funcionalidade e não um bug, a ordem recomendada é escrever os testes de cada RF antes da implementação e confirmar que falham. Assim fica claro o que muda. A matriz `describeMatrix` roda web e node.

### 6.2 Novos blocos em `test/static.test.ts`

Um bloco `describeMatrix("serve static range requests", …)` com `getMeta` que devolve `size: 1000` e `etag: '"abc"'`, e `getContents` com um corpo de 1000 caracteres ASCII (ver R-03). Rotas em `t.app.all("/range/**", …)`, no mesmo estilo dos blocos existentes.

| Teste | RF |
|---|---|
| GET sem Range → 200 com `accept-ranges: bytes` | RF-01 |
| `bytes=0-99` → 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo com 100 bytes | RF-02 |
| `bytes=2-4` sobre `0123456789` → corpo `234` | RF-03 |
| `bytes=-100` → `900-999`; `bytes=990-` → `990-999`; `bytes=990-5000` → `990-999/1000`; `bytes=-5000` → corpo inteiro em 206 | RF-02 |
| HEAD `bytes=0-99` → 206 com cabeçalhos, corpo vazio, `getContents` não chamado (`vi.fn`) | RF-04 |
| `bytes=5000-6000` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio | RF-05 |
| `bytes=-0` e `bytes=1000-` → 416 | RF-05, D-03 |
| `bytes=0-10,20-30`, `bytes=abc`, `items=0-1`, `bytes=5-3`, `bytes=-` → 200 completo, sem `content-range` | RF-06 |
| `getMeta` sem `size` → 200 completo, sem `content-range` | RF-07 |
| `If-Range: "xyz"` → 200 completo; `If-Range: "abc"` → 206 | RF-08 |
| `If-Range: W/"abc"` → 200 (ETag fraco nunca coincide) | RF-08, D-05 |
| `If-Range` com data igual ao `last-modified` emitido → 206; diferente → 200 | RF-08, D-05 |
| `If-None-Match: "abc"` + `Range` → 304 | RF-09 |
| `encodings: { gzip: ".gz" }`, `accept-encoding: gzip`, `Range: bytes=0-99` → 206 com `content-range … /400` (variante de 400 bytes) e `content-encoding: gzip` | RF-10 |
| Asset inexistente + `Range` com `fallthrough` → não responde (próximo handler); sem `fallthrough` → 404 | RF-11 |
| POST com `Range` → 405 com `allow: GET, HEAD`, como hoje | RF-11 |
| `headers: { "content-length": "999" }` + `Range` válido → `content-length` do trecho, não 999 | D-04 |
| `headers: { "accept-ranges": "none" }` → valor do usuário preservado | D-02 |
| Corpo por tipo (string, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream`, `FormData`): mesmo `bytes=2-4` devolve o mesmo trecho | D-06 |
| Stream com `bytes=998-999` em corpo longo: devolve só os dois últimos bytes e termina | D-06 |

Os blocos repetidos por tipo de corpo devem usar `for` dentro de um `it`, como os testes existentes já fazem (`test/static.test.ts:135-170`). `it.each` não é usado no helper.

### 6.3 Testes existentes

Nenhum teste existente precisa mudar: os que checam `content-length` (`test/static.test.ts:42-71`, `600-617`) continuam válidos. Se algum falhar, a causa deve ser a mudança em 200 (`accept-ranges`), e a correção é ajustar só a asserção afetada, sem perder o que ela verifica.

`test/unit/package.test.ts:133` deve continuar passando sem alteração, o que comprova que não há exportação nova.

### 6.4 Verificação

- `pnpm vitest run test/static.test.ts`
- `pnpm vitest run test/unit/package.test.ts`
- `pnpm typecheck` e `pnpm lint`
- `pnpm test` ao final (lint + typecheck + cobertura)

---

## 7. Riscos

- **R-01 — Desempenho com streams.** `getContents` não recebe offset, então `sliceStream` lê e descarta bytes até `start`. Em arquivos grandes, cada `Range` lê o arquivo até o fim do trecho. Blobs, buffers e strings são fatiados sem leitura extra. Mitigação futura: acrescentar offset a `getContents`, em outra issue.
- **R-02 — Corpo menor que `size`.** Se o backend devolver menos bytes do que `meta.size`, o `content-length` do 206 fica errado e o cliente pode travar. O PRD assume que `size` é exato. Isso é o mesmo problema que já existe para o 200.
- **R-03 — Strings não ASCII.** O `size` dos testes atuais é `string.length` (caracteres), mas o corpo é codificado em UTF-8. Para texto com acentos, o `content-range` fica com unidades erradas. Os testes de Range usam ASCII, e a documentação de `getMeta` deve deixar claro que `size` são bytes.
- **R-04 — Validador por data.** A RFC 9110 §13.1.5 trata validadores de data com cuidado (ver §8). A implementação segue o PRD (igualdade exata).
- **R-05 — Variantes codificadas e caches intermediários.** Um 206 de variante comprimida depende de `accept-encoding`, e caches podem tratar isso mal. O PRD deixa como decisão a revisar. Se for um problema, a alternativa é não aplicar Range quando `content-encoding` estiver definido.
- **R-06 — Conflito com `headers`.** Coberto por D-02 e D-04. Um `content-range` definido pelo usuário é sobrescrito em 206/416 e não tem efeito em 200 (não é tratado, porque a resposta 200 não tem `content-range`).
- **R-07 — Tamanho do módulo.** `static.ts` passa de 351 para cerca de 480 linhas, acima da meta de 200 do `AGENTS.md`. É consequência de D-01. Refactor posterior: mover os helpers de Range para `src/utils/internal/range.ts`.
- **R-08 — Regressão no caminho principal.** O código novo roda em todo asset servido. Por isso, o 200 sem `Range` precisa ficar igual, exceto por `accept-ranges`, e os testes existentes são a rede de segurança.
- **R-09 — Fixtures com etags não padronizadas.** `"w/123"` nos testes não tem aspas. A detecção de fraqueza por `startsWith("W/")` não percebe isso. Os novos testes usam etags entre aspas.

---

## 8. Pontos a confirmar antes de implementar

1. **Tamanho zero (D-07).** O PRD manda 416 para qualquer intervalo quando `size === 0`. A RFC 9110 §14.1.1 diz que um sufixo não-zero pode ser satisfazível mesmo em representação vazia. Confirmar com quem escreveu o PRD.
2. **Validador por data (R-04).** Confirmar a regra de §13.1.5 sobre validadores de data forte e, se necessário, ajustar `ifRangeMatches`.
3. **Unidade `bytes` sem diferenciar maiúsculas (D-03).** Confirmar no §14.1 da RFC 9110.
4. **`accept-ranges` na opção `headers` (D-02).** A escolha é respeitar o valor do usuário. Confirmar.
