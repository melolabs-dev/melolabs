# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-11). Este documento define como implementar; o comportamento esperado é o do PRD.

## 1. Estado atual

- `serveStatic` ignora `Range` e não anuncia `Accept-Ranges`. A ordem atual é: cabeçalhos de `options.headers`, método, canonicidade do path, decodificação do id, busca de variantes, `vary`, `last-modified`, `etag`, 304, `content-type`, `content-encoding`, `content-length`, HEAD e, por fim, `getContents` com status 200 (`src/utils/static.ts:105-277`).
- `content-length` só é definido quando `meta.size > 0` e o cabeçalho ainda não existe (`src/utils/static.ts:268-270`). Um teste fixa que um `content-length` preexistente vence no HEAD 200 (`test/static.test.ts:600-617`).
- O 304 é montado com `new HTTPResponse(null, { status: 304 })` (`src/utils/static.ts:243-248`). Os cabeçalhos de `event.res.headers` são mesclados em toda resposta não-`Response` (`src/response.ts:201-204`), então qualquer cabeçalho setado antes do 304 vaza para ele.
- `HTTPResponse` aceita `BodyInit | null` e status arbitrário (`src/response.ts:96-102`); `headers` é lazy (`src/response.ts:121-123`).
- `getContents` retorna `BodyInit | null | undefined` e não recebe intervalo (`src/utils/static.ts:33`). A assinatura não muda (PRD, fora de escopo).
- Exportação: `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. `test/unit/package.test.ts:133` lista `serveStatic` na lista de exports, o que serve de guarda para RF-10.
- Não há nenhum uso de `accept-ranges` ou `content-range` no código ou nos testes atuais.
- Os testes de `serveStatic` usam `etag: "w/123"` (`test/static.test.ts:14`). Esse valor não é um entity-tag válido pela RFC 9110 (o prefixo fraco é `W/`, case-sensitive). Os testes novos de If-Range devem usar `"v1"` e `W/"v1"`.

## 2. Decisões de arquitetura

### D-01 — Lógica de Range no próprio `static.ts`, como helpers privados

- **Alternativas:** (a) helpers em `src/utils/static.ts`; (b) módulo novo `src/utils/internal/range.ts`; (c) middleware separado que envolve `serveStatic`.
- **Escolha:** (a). RF-10 e a restrição do pedido dizem literalmente que as funções auxiliares ficam privadas ao módulo `static.ts`. A opção (b) não exporta nada novo do `index.ts`, mas quebra essa frase. A opção (c) exigiria mudar a API ou a ordem de `serveStatic` com o 304 e o `content-length`.
- **Custo:** `static.ts` já tem 352 linhas, acima da meta de 200 do AGENTS.md. Ponto em aberto: se o mantenedor preferir o arquivo menor, (b) é a alternativa com menor impacto na API pública (ver §7).

### D-02 — `Accept-Ranges` é setado depois do 304

- **Alternativas:** (a) setar no início de `serveStatic`; (b) setar logo após o bloco do 304 (`src/utils/static.ts:243-248`).
- **Escolha:** (b). Com (a), o cabeçalho vaza para o 304 via `src/response.ts:201-204`, e o PRD pede que 304, 404 e 405 fiquem como hoje. Para 200, 206 e 416 o cabeçalho é setado antes de qualquer resposta de sucesso.
- O cabeçalho é anunciado mesmo quando `meta.size` é desconhecido (PRD, RF-01: "toda resposta de asset encontrado").

### D-03 — Parser estrito de um único intervalo

- **Alternativas:** (a) parser completo de `range-set` com OWS e lista; (b) regex estrita para `bytes=<a>-<b>`, `bytes=<a>-`, `bytes=-<n>`, com unidade sem diferenciar maiúsculas.
- **Escolha:** (b). O PRD exige ignorar múltiplos intervalos (RF-06), e o parser de lista não traz nada que o caso de um intervalo precise. Qualquer forma fora da regex (vírgula, espaço interno, unidade diferente, `-` sozinho, `início > fim`) é ignorada e vira 200 completo.
- `bytes=-0` e qualquer intervalo de asset com `size === 0` viram "não satisfazível" (RFC 9110 §14.1.1; PRD, RF-05).
- Sufixo maior que o asset devolve o asset inteiro (`start = max(0, size - n)`).
- `last` acima do fim é limitado a `size - 1`.

### D-04 — `If-Range` compara com os validadores que serão enviados

- **Alternativas:** (a) comparar com `meta.etag` e `mtimeDate`; (b) comparar com `event.res.headers.get("etag")` e `event.res.headers.get("last-modified")`.
- **Escolha:** (b). Assim a comparação segue o cabeçalho que de fato sai, inclusive quando o usuário já definiu `etag` ou `last-modified` em `options.headers` (ver `src/utils/static.ts:234-241`).
- Regra (RFC 9110 §13.1.5): se o validador começa com `W/`, não casa. Se começa com `"`, casa só por igualdade exata com um ETag atual forte. Caso contrário, é tratado como data HTTP e casa só por igualdade exata com o `Last-Modified` atual, com `NaN` nunca casando.
- Se o validador não casa, o `Range` é ignorado (200 completo).

### D-05 — Recorte do corpo por tipo, sem `getContents` novo

- **Alternativas:** (a) ler tudo em `ArrayBuffer` e recortar sempre; (b) recortar por tipo, com `string` em bytes UTF-8, `Blob` com `slice` (lazy) e os demais tipos normalizados por `new Response(body).blob()`; (c) responder 200 completo para tipos que não sabemos recortar.
- **Escolha:** (b). O `Response` do runtime já normaliza todos os `BodyInit`, então a opção (c) não é necessária. Para `Blob` de arquivo (o caso comum em runtimes com arquivos), o recorte é lazy. Para `ReadableStream`, `FormData` e `URLSearchParams`, o corpo é lido por completo antes do recorte. Esse custo é o risco registrado no PRD.
- `string` é codificada em UTF-8 com `TextEncoder`. O `size` de `getMeta` tem que ser o tamanho em bytes dessa codificação (premissa do PRD).

```ts
async function sliceBody(body: BodyInit, { start, end }: ByteRange): Promise<BodyInit> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body).subarray(start, end + 1);
  }
  const blob = body instanceof Blob ? body : await new Response(body).blob();
  return blob.slice(start, end + 1);
}
```

### D-06 — `getContents` que devolve vazio não gera 206

- **Alternativas:** (a) 206 com corpo vazio e `Content-Length` do trecho (resposta inconsistente); (b) ignorar o `Range` e seguir o caminho atual de 200.
- **Escolha:** (b). O 200 atual já devolve `contents || null` sem checagem. Se `getContents` devolve `null`, `undefined` ou `""`, o `Range` é ignorado e os cabeçalhos de 206 não são setados. Isso é permitido por RFC (o servidor pode ignorar `Range`).

### D-07 — 206 e 416 sobrescrevem `content-length`

- **Alternativas:** (a) respeitar um `content-length` já presente, como no 200 (`test/static.test.ts:600-617`); (b) sobrescrever.
- **Escolha:** (b). Em 206 e 416, o `Content-Length` precisa descrever o corpo enviado, e um valor preexistente deixaria a resposta inválida. O teste de `content-length` continua valendo para o 200 e para o HEAD sem `Range`, então não muda.

### D-08 — Ordem de avaliação

- **Escolha:** `Vary` → `last-modified`/`etag` → 304 (`If-None-Match` e `If-Modified-Since`) → `Accept-Ranges` → tipo/encoding/`content-length` → seleção de `Range` (com `If-Range`) → 416 → HEAD → `getContents` → 206 ou 200.
- Sem `size`, não há seleção de `Range` (RF-08). Com `If-None-Match` casando, a resposta é 304 mesmo com `Range` (RF-08).
- A seleção de `Range` acontece antes de `getContents`, então 416 nunca lê o corpo.

### D-09 — Testes em arquivo novo

- **Alternativas:** (a) acrescentar em `test/static.test.ts`; (b) criar `test/static-range.test.ts`.
- **Escolha:** (b). O arquivo atual já tem 678 linhas, e os blocos de Range são um tema à parte. Os testes existentes ficam intactos, a não ser que a suíte mostre asserção de cabeçalho quebrada (ver §5). O PRD fala em "o arquivo de testes de static", e um arquivo `static-range.test.ts` atende a isso.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Lógica de Range (D-01 a D-08). Inserções em `src/utils/static.ts:248` (accept-ranges), após `src/utils/static.ts:270` (seleção de range) e substituição de `src/utils/static.ts:272-277` (HEAD e GET). |
| `test/static-range.test.ts` | Novo. Casos de RF-01 a RF-09 em `describeMatrix` (D-09). |
| `test/static.test.ts` | Sem alteração prevista. Os asserts usam `toMatchObject` e não listam todos os cabeçalhos. Só alterar se a suíte falhar, mantendo o que o teste verifica. |
| `test/bench/…` | Benchmark exigido pelo PRD antes da entrega (ver §5). Arquivo a criar seguindo o formato dos benches existentes. |

Não alterar: `src/index.ts` (RF-10), `src/response.ts`, `src/utils/internal/cache.ts`, `test/unit/package.test.ts` (é a guarda de exports).

Trecho de referência do fluxo final (`serveStatic`, após o bloco 304):

```ts
event.res.headers.set("accept-ranges", "bytes");

// ... content-type, content-encoding, content-length (existentes) ...

const range = selectRange(event, meta.size);
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (event.req.method === "HEAD") {
  if (!range) {
    return new HTTPResponse(null, { status: 200 });
  }
  setPartialHeaders(event, range, meta.size!);
  return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
}

const contents = await options.getContents(id);
if (range && contents) {
  setPartialHeaders(event, range, meta.size!);
  return new HTTPResponse(await sliceBody(contents, range), {
    status: 206,
    statusText: "Partial Content",
  });
}
return new HTTPResponse(contents || null, { status: 200 });
```

## 4. Contratos e assinaturas

Tudo abaixo é **privado** a `src/utils/static.ts`. Nada novo entra em `src/index.ts`, e `ServeStaticOptions` e `StaticAssetMeta` ficam iguais.

```ts
/** Intervalo em bytes, inclusivo nas duas pontas, já limitado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Escolhe o Range a aplicar. `undefined` = ignorar Range (200 completo);
 * `"unsatisfiable"` = 416. Só é chamada com `size` conhecido (RF-08).
 */
function selectRange(
  event: H3Event,
  size: number | undefined,
): ByteRange | "unsatisfiable" | undefined;

/** Interpreta `bytes=<a>-<b>`, `bytes=<a>-`, `bytes=-<n>`. Qualquer forma fora disso é `undefined`. */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** RFC 9110 §13.1.5: comparação forte para ETag; igualdade exata para data. */
function ifRangeMatches(validator: string, headers: Headers): boolean;

/** Recorta o corpo. `string` vira bytes UTF-8; `Blob` usa `slice`; o resto passa por `Response.blob()`. */
function sliceBody(body: BodyInit, range: ByteRange): Promise<BodyInit>;

/** Define `content-range` (`bytes start-end/size`) e `content-length` (`end - start + 1`). */
function setPartialHeaders(event: H3Event, range: ByteRange, size: number): void;
```

Regras de `parseRange` (ordem de checagem):

1. Não casa `/^bytes=(\d*)-(\d*)$/i` (após `trim`), ou ambos os lados vazios → `undefined`.
2. Sufixo (`first` vazio): se `last === 0` ou `size === 0` → `"unsatisfiable"`; senão `{ start: max(0, size - last), end: size - 1 }`.
3. `last` preenchido e `last < first` → `undefined` (início > fim, RF-06).
4. `first >= size` → `"unsatisfiable"` (inclui `size === 0`).
5. Senão `{ start: first, end: last === "" ? size - 1 : min(last, size - 1) }`.

Regras de `selectRange`:

- Sem `Range` ou sem `size` → `undefined`.
- Com `If-Range` que não casa (`ifRangeMatches`) → `undefined`.
- Senão → `parseRange(header, size)`.

## 5. Estratégia de testes

Seguir AGENTS.md ("Bug Fix Workflow"): escrever os testes primeiro, confirmar que falham, depois implementar.

Em `test/static-range.test.ts`, com `describeMatrix` (roda em `web` e `node`). Fixture: asset de 1000 bytes com conteúdo `"0123456789".repeat(100)`, para que o byte na posição `i` seja `i % 10`, e os asserts de corpo possam conferir o recorte exato.

Casos (cada item é um `it`):

- **RF-01:** GET sem `Range` → 200 com `accept-ranges: bytes`. HEAD também.
- **RF-02:** `bytes=0-99` → 206, corpo com 100 bytes iniciais, `content-range: bytes 0-99/1000`. Também `bytes=500-` e `bytes=-100`.
- **RF-03:** `bytes=-100` → `bytes 900-999/1000`, `content-length: 100`, `content-type`, `etag`, `last-modified` e `vary` presentes.
- **RF-04:** HEAD com `bytes=0-99` → 206, cabeçalhos iguais, corpo vazio.
- **RF-05:** `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. Também `bytes=-0`, e qualquer `Range` em asset de tamanho 0.
- **RF-06:** `bytes=0-10,20-30`, `items=0-9`, `bytes=5-2`, `bytes=-`, `bytes= 0-9` → 200 completo, sem `content-range`.
- **RF-07:** `If-Range: "v1"` (igual) → 206. `If-Range: "v0"` → 200. `If-Range: W/"v1"` → 200. Data igual ao `last-modified` → 206. Data diferente → 200. `If-Range` sem validador compatível → 200.
- **RF-08:** `getMeta` sem `size` + `Range` → 200 completo. `If-None-Match` casando + `Range` → 304 sem `content-range` e sem `accept-ranges` (D-02).
- **RF-09:** `app.js` com `app.js.gz` de `size` diferente, `accept-encoding: gzip` e `Range: bytes=0-9` → 206 com `content-encoding: gzip` e `content-range` do `.gz`. POST com `Range` → 405 com `allow: GET, HEAD` (como hoje).
- **D-05 (tipos de corpo):** o mesmo recorte para `string`, `Blob`, `Uint8Array`, `ArrayBuffer` e `ReadableStream`. Asserts de bytes exatos.
- **D-06:** `getContents` devolve `undefined` com `Range` → 200 sem `content-range`.
- **D-07:** `options.headers` com `content-length: 999` + `Range` → 206 com `content-length` do trecho.
- **RF-10:** `test/unit/package.test.ts` já compara a lista de exports. Rodar esse arquivo.

Regressão e verificação:

- `pnpm vitest run test/static-range.test.ts test/static.test.ts test/security.test.ts test/unit/package.test.ts`.
- `pnpm lint` (`package.json:46`) e `pnpm typecheck` (`package.json:54`).
- `pnpm test` completo (`package.json:53`), para pegar testes de outros arquivos que possam checar cabeçalhos de asset.
- Benchmark (PRD: "deve ser medido em um benchmark antes de considerar a entrega concluída"): medir 200 sem `Range` antes e depois da mudança (não pode regredir), e 206 com asset de 1 MB, 50 MB e um `ReadableStream` do mesmo tamanho, com `pnpm bench:node`. Registrar os números no PR.

## 6. Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| Leitura completa do corpo a cada 206 (`getContents` não recebe intervalo). | Alta | Medir com benchmark (§5). A correção real exige mudar `getContents`, fora de escopo. Documentar no PR. |
| `ReadableStream`, `FormData` e `URLSearchParams` são lidos inteiros antes do recorte. | Média | D-05. Testes de tipo. Pode virar 200 completo se o custo for inaceitável (decisão do mantenedor). |
| `size` de `getMeta` diferente dos bytes reais do corpo (string com UTF-8 multibyte, variante errada). | Média | Premissa do PRD. Documentar no contrato de `getMeta`. Testes com `.gz` (RF-09). |
| `If-Range` com ETag fraco ou formato de data mal interpretado. | Baixa | D-04 e testes de RF-07 com `W/"v1"` e data. |
| Fixture atual usa `etag: "w/123"`, que não é entity-tag válido. | Baixa | Os testes novos usam `"v1"`. Não corrigir os fixtures existentes sem necessidade. |
| Asserts existentes quebrarem por cabeçalho novo `accept-ranges`. | Baixa | `toMatchObject` tolera. Se houver quebra, ajustar só a asserção afetada. |
| `static.ts` passar de 352 linhas (AGENTS.md pede < 200). | Baixa | Ponto em aberto (D-01). Alternativa: `src/utils/internal/range.ts`, sem exportação pública. |
| Conflito entre `content-length` preexistente e 206 (D-07). | Baixa | Decisão registrada; o teste do 200 continua verde. |
| Números em `Range` acima de `Number.MAX_SAFE_INTEGER` perdem precisão. | Baixa | `last` acima do fim é limitado por `min(last, size - 1)`, e `first` grande cai em 416 (passo 4 de `parseRange`). Testar com valor grande. |

## 7. Pontos em aberto para o mantenedor

1. **D-01:** manter os helpers em `static.ts` (cumpre RF-10 à letra, arquivo fica maior) ou mover para `src/utils/internal/range.ts` (arquivo menor, mesma API pública).
2. **D-05:** aceitar a leitura integral de `ReadableStream` e de tipos sem `Blob` nativo, ou responder 200 completo para eles.
3. **Benchmark:** o limite aceitável de custo do 206 precisa ser definido antes de considerar a entrega concluída.
