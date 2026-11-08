# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue), `sdd/prd.md` (requisitos RF-01 a RF-10). Este documento decide **como** implementar. Não repete os critérios de aceite do PRD; cada decisão aponta para o RF que atende.

## 1. Estado atual (conferido no código)

- `serveStatic` é uma função única em `src/utils/static.ts:101-278`. Ela:
  - aplica `options.headers` (`src/utils/static.ts:105-114`);
  - rejeita métodos que não sejam GET/HEAD com 405 (`src/utils/static.ts:116-122`);
  - valida o caminho canônico (`src/utils/static.ts:142-147`) e procura o asset (`src/utils/static.ts:192-215`);
  - define `vary`, `last-modified` e `etag` em `event.res.headers` (`src/utils/static.ts:217-241`);
  - responde 304 pela validação de cache (`src/utils/static.ts:243-248`);
  - define `content-type`, `content-encoding` e `content-length` (`src/utils/static.ts:250-270`). O `content-length` só é definido se `meta.size > 0` e se o cabeçalho ainda não existir (`src/utils/static.ts:268-270`);
  - responde HEAD com 200 sem corpo (`src/utils/static.ts:272-274`) e GET com `getContents(id)` em 200 (`src/utils/static.ts:276-277`).
- Não existe nenhum tratamento de `Range`, `Accept-Ranges`, `Content-Range` ou `If-Range` em `src/`. A única menção a `range` no código é a regra de cache que contorna pedidos com `Range` (`src/rules/cache.ts:143-148`), que não muda.
- `StaticAssetMeta.size` é `number` opcional (`src/utils/static.ts:13`). `getContents` devolve `BodyInit | null | undefined` (`src/utils/static.ts:33`).
- Exportação pública: `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. O snapshot de exportações em `test/unit/package.test.ts:133` trava a lista de nomes e deve continuar igual.
- Um `HTTPResponse` retornado pelo handler passa direto por `prepareResponseBody` (`src/response.ts:304`) e recebe os cabeçalhos de `event.res.headers` (`src/response.ts:188-206`). Um `HTTPError` usa só `errHeaders` quando o status é de erro (`src/response.ts:160`, `src/response.ts:211-212`). Por isso 416 precisa ser retornado como `HTTPResponse`, e não lançado (ver D-06).
- Testes atuais: `test/static.test.ts:5-31` (fixture `describeMatrix`, com `size` em `test/static.test.ts:18`), GET em `test/static.test.ts:42-56`, HEAD em `test/static.test.ts:58-70`, cache em `test/static.test.ts:200-217`. Os asserts usam `toMatchObject` nos cabeçalhos (`test/static.test.ts:53`, `test/static.test.ts:69`), então um cabeçalho novo não os quebra.

## 2. Decisões de arquitetura

### D-01 — Helpers privados no próprio `src/utils/static.ts`

- **Contexto:** o pedido diz "Keep all helper logic private within the serveStatic module". O AGENTS.md diz "Internal helpers go at the end of files or in `utils/internal/`" e "aim for < 200 LoC per file". O arquivo já tem ~350 linhas (`src/utils/static.ts:351`).
- **Alternativas:** (a) criar `src/utils/internal/range.ts` e importar; (b) helpers não exportados no fim de `src/utils/static.ts`, abaixo de `// --- Internal Utils ---` (`src/utils/static.ts:280`).
- **Escolha:** (b). O pedido e o PRD (RF-10) pedem explicitamente o módulo `serveStatic` como dono da lógica. A opção (a) também seria tecnicamente válida, mas quebra o pedido literal. O arquivo passa de 200 linhas; isso é um desvio aceito do guia de tamanho e fica registrado em Riscos.

### D-02 — Onde a lógica entra e em que ordem

- **Alternativas:** (a) checar `Range` antes da busca de asset; (b) checar `Range` depois de `304`, quando já existe `size`.
- **Escolha:** (b). A ordem final dentro de `serveStatic` passa a ser:
  1. busca do asset, `vary`, `last-modified`, `etag` e `accept-ranges` (D-03), como hoje;
  2. 304 por `isCacheMatch` (`src/utils/static.ts:243-248`), **antes** de qualquer análise de `Range` (RF-08);
  3. `content-type`, `content-encoding`, `content-length` como hoje (`src/utils/static.ts:250-270`);
  4. resolução do `Range` (`resolveRange`, D-04 e D-05);
  5. resposta:
     - `unsatisfiable` → 416, sem chamar `getContents` (D-09);
     - `partial` em HEAD → 206 sem corpo (D-09);
     - `partial` em GET → `getContents`, fatiar, 206 (D-08); se não der para fatiar, cai para 200;
     - `ignore`, ou fallback → o trecho atual (`src/utils/static.ts:272-277`).
- **Justificativa:** RF-08 exige que o 304 venha antes do `Range`; `size` só é conhecido depois de `getMeta`, então o `Range` não pode vir antes da busca.

### D-03 — `Accept-Ranges: bytes` em todo asset encontrado

- **Alternativas:** (a) anunciar só quando o `Range` é válido; (b) anunciar sempre que o asset existe (RF-01), e respeitar um valor vindo de `options.headers`.
- **Escolha:** (b). Segue o padrão do `etag`: `if (!event.res.headers.has("accept-ranges"))` ao lado de `src/utils/static.ts:239-241`. Como o 304 usa `event.res.headers`, o 304 também carrega o cabeçalho, o que é o comportamento do `etag` hoje.
- **Nota:** quando `size` é desconhecido o cabeçalho também é enviado, mesmo com o `Range` ignorado (RF-06). A RFC permite isso.

### D-04 — Gramática do `Range` e quando ignorar ou responder 416

- **Alternativas:** (a) um parser genérico de lista de intervalos com suporte a múltiplos; (b) aceitar exatamente um intervalo, ignorar qualquer outra forma.
- **Escolha:** (b), com a gramática abaixo. Tudo o que não bater com ela é "ignore" (200 completo).
  - Unidade: `bytes`, sem diferenciar maiúsculas (RF-06 e RFC 9110 seção 14).
  - Lista: um único `range-spec`. Espaços em volta de vírgulas são tolerados; uma vírgula com mais de um intervalo → ignore (RF-06).
  - Formas aceitas: `first-last`, `first-`, `-suffix`. Números são `/^\d+$/` e precisam ser inteiros seguros; qualquer outra coisa → ignore.
  - `last < first` → ignore (RFC 9110 seção 14: intervalo inválido).
  - `-` sem número → ignore.
  - Satisfatibilidade, só checada depois de passar pelo `If-Range` (D-05):
    - `size === 0` → 416, para qualquer intervalo válido;
    - `first >= size` → 416;
    - `last >= size` → `end = size - 1` (RF-02);
    - `-0` → 416;
    - `-n` com `n > size` → `start = 0` (RF-03).
- **Justificativa:** o RFC permite ignorar cabeçalhos não entendidos; ignorar tudo o que não for um intervalo simples cobre RF-06 sem código de multi-parte (fora de escopo).

### D-05 — `If-Range`: ETag forte ou data exata

- **Alternativas:** (a) comparar só ETag; (b) comparar ETag e data; (c) ignorar `If-Range`.
- **Escolha:** (b), conforme RF-07 e RFC 9110 seção 13.1.5 (comparação forte):
  - se o valor começa com `"` ou `W/`, é um ETag: combina só se o ETag do recurso não for fraco (não começa com `W/`) e for igual ao valor, sem normalização;
  - caso contrário, é tratado como data HTTP: combina só se `new Date(valor)` for válida e igual a `mtimeDate` (já truncado em segundos, `src/utils/static.ts:227-232`). Sem `mtime`, não combina;
  - `If-Range` ausente → sempre combina;
  - `If-Range` não combina → `ignore` (200 completo, RF-07).
- **Nota:** a diferença entre `W/` e `w/` importa. O RFC usa `W/` maiúsculo. O fixture atual usa `etag: "w/123"` (`test/static.test.ts:15`), que pela regra acima é forte. Ver Riscos.

### D-06 — 206 e 416 como `HTTPResponse`, nunca como `HTTPError`

- **Alternativas:** (a) `throw new HTTPError({ status: 416, headers })`; (b) retornar `new HTTPResponse(null, { status, statusText })` com os cabeçalhos em `event.res.headers`, como o 304 faz (`src/utils/static.ts:244-247`).
- **Escolha:** (b). Um `HTTPError` de status 4xx usa só `errHeaders` (`src/response.ts:160`, `src/response.ts:211-212`), o que descartaria `content-range`, `accept-ranges` e `last-modified` setados em `event.res.headers`.
- `statusText`: `"Partial Content"` e `"Range Not Satisfiable"`, no mesmo formato de `"Not Modified"` (`src/utils/static.ts:246`).

### D-07 — `Content-Length` de 206 e 416 é sempre o do trecho

- **Contexto:** hoje `content-length` só é definido se ainda não existir (`src/utils/static.ts:268`). `options.headers` roda antes (`src/utils/static.ts:105-114`), então um `content-length` vindo dele venceria o tamanho do asset.
- **Alternativas:** (a) manter a regra "só se não existir" também para 206; (b) sobrescrever em 206 e 416.
- **Escolha:** (b). Um 206 com `Content-Length` errado quebra o cliente e o servidor, e isso não é preferência do usuário. Para 200 nada muda (RF-09). Em 416, `content-length: 0` também sobrescreve.
- **Impacto:** é a única situação em que um cabeçalho de `options.headers` deixa de valer. Está documentado em Riscos e deve estar no JSDoc de `serveStatic`.

### D-08 — Fatiamento do corpo por tipo

- **Contexto:** `getContents` devolve `BodyInit` (`src/utils/static.ts:33`), sem intervalo (fora de escopo: mudar o contrato, PRD).
- **Contrato:** `sliceBody(body, start, end)`, retorna `BodyInit` com exatamente `end - start + 1` bytes, ou `undefined` quando não dá para fatiar.

| Tipo de `BodyInit` | Como fatiar | Custo |
|---|---|---|
| `string` | `TextEncoder` para `Uint8Array`, depois `subarray` | Codifica tudo; `size` é em **bytes**, não em caracteres |
| `ArrayBuffer` | `slice(start, end + 1)` | Cópia do trecho |
| `ArrayBufferView` | `Uint8Array` sobre `buffer`/`byteOffset`/`byteLength`, depois `subarray` | Sem cópia |
| `Blob` | `blob.slice(start, end + 1)` | Lazy |
| `ReadableStream` | lê e descarta até `start`, emite até `end`, cancela o restante | Lê do início até `end` |
| `FormData`, `URLSearchParams` | não fatiável | — → `undefined` → 200 |
| `null` / `undefined` | sem corpo → `undefined` → 200 (comportamento atual) | — |

- **Alternativas:** (a) sempre ler o corpo inteiro para um `Uint8Array` e fatiar; (b) tipo a tipo, como acima.
- **Escolha:** (b). Evita cópia de `Blob` e de `ArrayBufferView` e não bufferiza streams inteiras. Não há leitura parcial no backend (PRD, fora de escopo).

### D-09 — HEAD e 416 não tocam em `getContents`

- HEAD já retorna antes de `getContents` (`src/utils/static.ts:272-274`) e isso não muda.
- 416 é decidido antes de `getContents`, então um arquivo inexistente em bytes não é lido à toa.

### D-10 — `Range` sobre a representação codificada

- O `size` e o corpo usados são os da variante escolhida por `Accept-Encoding` (`meta` vem de `idSearchPaths`, `src/utils/static.ts:192-208`). Assim `Range` aponta para bytes comprimidos, como a RFC determina.
- Documentar isso no JSDoc de `serveStatic` (`src/utils/static.ts:68-100`), ao lado da nota de segurança existente.

## 3. Contratos e assinaturas

**Público (não muda):**

```ts
// src/index.ts:193 — sem novos nomes
export { type ServeStaticOptions, type StaticAssetMeta, serveStatic } from "./utils/static.ts";

export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

**Privado em `src/utils/static.ts` (não exportado):**

```ts
type RangeOutcome =
  | { kind: "ignore" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; start: number; end: number }; // inclusivo, já limitado a size - 1

function resolveRange(
  headers: Headers,
  size: number | undefined,
  validators: { etag?: string; lastModified?: Date },
): RangeOutcome;

function parseRangeHeader(value: string, size: number): RangeOutcome; // só a gramática e a satisfatibilidade (D-04)

function ifRangeMatches(value: string, validators: { etag?: string; lastModified?: Date }): boolean; // D-05

function sliceBody(body: BodyInit, start: number, end: number): Promise<BodyInit | undefined>; // D-08
```

`resolveRange` retorna `ignore` quando `size === undefined` (RF-06), quando não há `Range`, quando `If-Range` não combina (D-05) ou quando a gramática falha (D-04).

**Respostas:**

| Caso | Status | `event.res.headers` | Corpo |
|---|---|---|---|
| sem `Range`, ou `ignore` | 200 | como hoje + `accept-ranges` | `getContents` completo |
| `partial`, GET, fatiável | 206 | `content-range: bytes S-E/N`, `content-length: E-S+1` | trecho |
| `partial`, GET, não fatiável | 200 | como hoje | completo |
| `partial`, HEAD | 206 | igual ao GET | nenhum |
| `unsatisfiable` | 416 | `content-range: bytes */N`, `content-length: 0` | nenhum |
| 304 (cache) | 304 | como hoje | nenhum (RF-08, antes do `Range`) |

## 4. Arquivos a alterar

- `src/utils/static.ts`:
  - `src/utils/static.ts:239-241` — `accept-ranges` (D-03);
  - `src/utils/static.ts:268-270` — manter a regra atual para 200, sobrescrever em 206/416 (D-07);
  - `src/utils/static.ts:272-277` — inserir a resolução de `Range` e as respostas 206/416 antes do HEAD e do GET atuais (D-02, D-09);
  - `src/utils/static.ts:68-100` — JSDoc: `Range`, `Content-Length` sobrescrito, encoding (D-10);
  - `src/utils/static.ts:280-` — helpers privados (D-01).
- `test/static-range.test.ts` (novo) — casos da seção 5.
- `test/static.test.ts` — **nenhuma alteração prevista**. Os asserts atuais usam `toMatchObject` e não dependem de `Range`. Se algum teste quebrar, ajustar só o que depende de `Accept-Ranges` (RF-09).
- `src/index.ts` e `test/unit/package.test.ts` — **sem alteração** (RF-10).
- `src/rules/cache.ts:143-148` — sem alteração. Pedidos com `Range` já são pulados pelo cache de regras.

## 5. Estratégia de testes

Seguir o workflow do AGENTS.md: escrever os testes antes da implementação e confirmar que falham.

**Fixture:** `size: 1000` com conteúdo previsível (`Uint8Array` onde o byte `i` vale `i % 256`), `etag: '"abc"'` (forte, entre aspas), `mtime` fixo. Para o caso de texto, uma string com caracteres multibyte (ex.: `"é"`) cujo `size` é o número de bytes UTF-8, para cobrir D-08.

Usar `describeMatrix` (web e node), como em `test/static.test.ts`.

**Casos (mapeados ao PRD):**

- RF-01: GET sem `Range` → 200, corpo completo, `accept-ranges: bytes`; também no 304.
- RF-02: `bytes=100-199` → 206, `content-range: bytes 100-199/1000`, `content-length: 100`, bytes 100 a 199 exatos; `bytes=990-2000` → limitado a 999.
- RF-03: `bytes=900-` → 900-999 (100 bytes); `bytes=-50` → 950-999; `bytes=-5000` → 0-999 em 206.
- RF-04: HEAD `bytes=0-99` → 206, `content-length: 100`, corpo vazio; `getContents` não chamado.
- RF-05: `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio; `accept-ranges` e `content-range` presentes (confirma D-06); `bytes=-0` → 416; asset de `size: 0` com qualquer `Range` → 416.
- RF-06: `bytes=0-1,5-6`, `items=0-1`, `bytes=abc`, `bytes=5-1`, `bytes=-` → 200 completo sem `content-range`; `size` ausente → 200 e sem `Range` aplicado.
- RF-07: `If-Range: "xyz"` → 200 completo; `If-Range: "abc"` → 206; `If-Range: W/"abc"` → 200 (fraco nunca combina); `If-Range` com data igual ao `last-modified` → 206; com data diferente → 200; data inválida → 200.
- RF-08: `If-None-Match: "abc"` + `Range` → 304 sem corpo; `If-Modified-Since` ≥ mtime + `Range` → 304.
- RF-09: `options.headers` com `content-length` + `Range` → 206 com o `content-length` do trecho (D-07), e sem `Range` → o `content-length` do próprio `options.headers` continua valendo em 200; `Vary` e `Content-Encoding` com `accept-encoding: gzip` e `Range` → corpo do `.gz`.
- D-08: corpo string multibyte, `Blob`, `ArrayBuffer`, `ArrayBufferView`, `ReadableStream` → bytes corretos; `FormData` → 200; `getContents` devolve `null` com `Range` → 200 (comportamento atual).
- D-10: `Range` sobre variante `.gz`.
- RF-10: `test/unit/package.test.ts` (snapshot) continua passando sem alteração.

**Comandos:**

```bash
pnpm vitest run test/static-range.test.ts   # novos casos, antes e depois
pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts
pnpm lint
pnpm typecheck
pnpm vitest run                              # suíte completa
```

## 6. Riscos

- **Leitura completa para seek (alto, PRD).** `ReadableStream` lê desde o início até `end`. Cada seek em vídeo grande custa CPU, memória e banda. Mitigação: documentar no JSDoc; leitura parcial no backend fica para depois, por fora deste trabalho.
- **`size` em caracteres vs bytes em strings (médio).** Um backend que informa `size` como `string.length` faz o fatiamento de D-08 errar em texto não ASCII, ou gera 416 indevido. O fixture atual usa `.length` (`test/static.test.ts:18`), que só funciona porque é ASCII. Mitigação: o teste multibyte de D-08 expõe isso; documentar que `size` é em bytes.
- **ETag fraco em minúsculas (médio).** O fixture usa `"w/123"` sem aspas (`test/static.test.ts:15`). Pela regra de D-05 (`W/` maiúsculo), esse valor é forte. O risco é um ETag fraco de backend que use `w/` minúsculo passar como forte. Mitigação: o JSDoc diz que o backend deve entregar `W/` para ETag fraco; o teste novo usa ETag entre aspas.
- **Sobrescrita de `content-length` (médio, D-07).** Um `options.headers` com `content-length` deixa de valer em 206/416. Documentar.
- **`content-length` com `null` (médio, pré-existente).** Se `getContents` devolver `null` com `size` conhecido, o 200 atual já envia `content-length` sem corpo. Com `Range` cai no mesmo caminho (D-08). Não corrigir aqui; registrar.
- **Anunciar `Accept-Ranges` com `size` desconhecido (baixo).** Cabeçalho anunciado, `Range` ignorado (D-03, RF-01). A RFC permite; alinhado ao PRD.
- **Tamanho do arquivo (baixo, D-01).** `src/utils/static.ts` passa de ~350 linhas. Desvio consciente do guia de 200 linhas, pedido pelo PRD (RF-10). Candidato a extrair para `src/utils/internal/` numa mudança posterior.
- **Compressão e `Range` (baixo, D-10).** Clientes que pedem trecho de `.gz` recebem bytes comprimidos e podem não conseguir decodificar o trecho. É o comportamento da RFC; documentar.
- **Mudança de comportamento existente (baixo).** `Accept-Ranges` aparece em respostas que antes não tinham o cabeçalho. Só testes que comparam cabeçalhos por igualdade total seriam afetados; os de `test/static.test.ts` não são.
