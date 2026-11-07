# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-11). Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range). Toda a mudança fica em `src/utils/static.ts`, mais testes novos. Nenhuma API pública muda.

## 1. Contexto no código atual

Fluxo de `serveStatic` (`src/utils/static.ts:101`), na ordem em que importa para Range:

1. Método diferente de GET/HEAD → 405 ou `fallthrough` (`src/utils/static.ts:116`).
2. Resolução do asset por `getMeta` (`src/utils/static.ts:200-215`); asset ausente → 404 ou `undefined` com `fallthrough` (`src/utils/static.ts:210`).
3. `last-modified` e `etag` são escritos em `event.res.headers` (`src/utils/static.ts:227-241`).
4. Avaliação condicional 304 via `isCacheMatch` (`src/utils/static.ts:243`, definida em `src/utils/internal/cache.ts:29`).
5. `content-type` (`src/utils/static.ts:250`) e `content-encoding` (`src/utils/static.ts:264`).
6. `content-length` só quando `size > 0` e ainda não definido (`src/utils/static.ts:268`).
7. HEAD retorna `HTTPResponse(null, 200)` (`src/utils/static.ts:272`); GET lê `getContents(id)` e devolve 200 (`src/utils/static.ts:276-277`).

Fatos que condicionam o desenho:

- `event.res.headers` é mesclado por cima dos cabeçalhos do `HTTPResponse` retornado com `mergeHeaders`, que usa `set` (`src/response.ts:201-204` e `src/response.ts:243-251`). Logo, um `content-length` pré-definido em `event.res.headers` (opção `headers`, ou o `size` do passo 6) **sobrescreve** qualquer `content-length` posto no `HTTPResponse`. Para 206/416, `content-length` e `content-range` devem ser escritos em `event.res.headers`.
- O corte de cabeçalhos de erro (`src/response.ts:211-213`) só vale para `Response` nativo. Um `HTTPResponse` com status 416 segue o caminho de `prepareResponseBody` (`src/response.ts:188-205`) e recebe os cabeçalhos preparados normalmente.
- `nullBody` (`src/response.ts:350-356`) zera o corpo em HEAD e em 204/205/304; 206 e 416 não estão na lista, então o corpo que entregarmos é enviado.
- `getContents` devolve `BodyInit` completo (`src/utils/static.ts:33`); não há como pedir o intervalo ao backend (fora de escopo no PRD).
- O validador de exports é um snapshot em `test/unit/package.test.ts:6`; `src/index.ts:193` exporta apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic` e não muda.

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica e como evitar exports novos

**Alternativas**
- (a) Novo arquivo `src/utils/internal/range.ts` com `export` para uso interno.
- (b) Funções privadas (não exportadas) no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).
- (c) Estender `src/utils/internal/cache.ts`.

**Escolha: (b).** A issue e o PRD (RF-10) exigem helpers privados no módulo; `AGENTS.md` manda helpers internos ao fim do arquivo. (a) e (c) criariam exports (mesmo que internos) e espalhariam a regra; `cache.ts` trata de `If-None-Match`, não de Range. O arquivo passa de 350 para ~550 linhas, acima do alvo de 200 LoC do `AGENTS.md`; ele já excede esse alvo e o PRD prevalece sobre a meta de tamanho (ver R-06).

### D-02 — Posição da avaliação de Range no fluxo

**Alternativas**
- (a) Antes do 304.
- (b) Depois do 304 e dos cabeçalhos de representação (`content-type`, `content-encoding`), no lugar do bloco do `content-length` (`src/utils/static.ts:268-278`).
- (c) Depois de `getContents`.

**Escolha: (b).** RFC 9110 §13.2.2 coloca `If-None-Match`/`If-Modified-Since` antes de `Range`, e o RF-09 fixa isso. O 304 permanece intacto (`src/utils/static.ts:243-248`). O Range precisa vir depois de `content-encoding` porque o intervalo se aplica à variante servida (ex.: `.gz`), que mantém seu `Content-Encoding`. (c) obrigaria a ler o conteúdo mesmo para 416 e HEAD, violando o RF-06.

Sequência resultante após o 304:

1. `content-type`, `content-encoding` (inalterados).
2. `accept-ranges: bytes` (D-03).
3. `parseRange` + `If-Range` decidem entre: ignorar (200 como hoje), 416 ou 206.
4. Ramo 200: `content-length` como hoje (`src/utils/static.ts:268`) e HEAD/GET como hoje.

### D-03 — `Accept-Ranges` em toda resposta de sucesso

**Alternativas**
- (a) Anunciar somente quando `size > 0`.
- (b) Anunciar sempre nas respostas 200/206 (e 416).
- (c) Anunciar também no 304.

**Escolha: (b), sem 304.** Segue RF-01 e a issue ("Always advertise"). Anunciar sem `size` é permitido pela RFC 9110 §14.3 (o servidor pode ignorar `Range` e responder 200), então não é uma promessa falsa a ponto de quebrar clientes. O 304 não leva `Accept-Ranges` porque §15.4.5 só lista validadores e cabeçalhos de cache/negociação como obrigatórios. O valor é escrito só se `accept-ranges` ainda não estiver em `event.res.headers`, mesmo padrão de `content-type` e `content-encoding` (`src/utils/static.ts:250`, `src/utils/static.ts:264`). Se o cabeçalho já existir com valor `none`, o `Range` é ignorado (RFC 9110 §14.3), o que respeita quem desligou o recurso via `options.headers`.

### D-04 — Gramática de `Range` e classificação do resultado

**Alternativas**
- (a) Parser completo da gramática de range-set, aceitando várias faixas e escolhendo uma.
- (b) Regex estrita de faixa única: `/^bytes=(\d*)-(\d*)$/i` sobre o valor aparado.
- (c) Cortar no primeiro `,` e usar a primeira faixa.

**Escolha: (b).** O PRD (RF-04) manda ignorar múltiplas faixas, e a regex rejeita qualquer vírgula, unidade diferente de `bytes` (o nome da unidade é case-insensitive na RFC, daí `i`), espaços internos e `bytes=-`. (c) mudaria a semântica pedida; (a) é código sem uso.

Classificação, com `size > 0`:

| Entrada | Resultado |
| --- | --- |
| não casa com a regex, ou `fim < início` (`bytes=5-2`) | ignorar (200 completo) |
| `bytes=a-b`, `a < size` | 206 com `[a, min(b, size-1)]` |
| `bytes=a-`, `a < size` | 206 com `[a, size-1]` |
| `bytes=-n`, `n > 0` | 206 com `[max(size-n, 0), size-1]` |
| `bytes=a-` ou `a-b` com `a >= size` | 416 |
| `bytes=-0` | 416 |

Números fora do inteiro seguro viram `Infinity` (`Number(...)` + `Number.isSafeInteger`): como início, resultam em 416; como fim ou sufixo, são limitados ao tamanho.

### D-05 — Validação de `If-Range`

**Alternativas**
- (a) Reusar `isCacheMatch`/`matchETag` (comparação fraca) de `src/utils/internal/cache.ts`.
- (b) Comparador novo, privado, com comparação forte para ETag e igualdade exata para data.
- (c) Ignorar `If-Range`.

**Escolha: (b).** `matchETag` usa comparação fraca (`src/utils/internal/cache.ts:15-16`), proibida em `If-Range` (RFC 9110 §13.1.5). Regras:

- Valor começa com `"` → ETag: casa só se for idêntico ao `etag` efetivo da resposta **e** nenhum dos dois começar com `W/`. ETag fraco nunca valida.
- Valor começa com `W/` → não casa.
- Caso contrário → data HTTP: `Date.parse` válido e igual (`getTime`) ao `last-modified` efetivo da resposta, também parseado. Data inválida, ou ausência de `last-modified`, não casa.
- Não casando, o `Range` é ignorado e o 200 completo sai com `Accept-Ranges`.
- `If-Range` sem `Range` é ignorado (§13.1.5).

Os validadores efetivos são lidos de `event.res.headers` (`etag` e `last-modified`), que já refletem o que `serveStatic` escreveu em `src/utils/static.ts:234-241` ou o que o usuário pré-definiu. É o que o cliente viu e repete, e coincide com `meta.etag`/`mtime` no caso normal (premissa do PRD). Nota: o fixture existente usa `etag: "w/123"` (`test/static.test.ts:15`), que não é um ETag forte válido; com ele `If-Range` nunca valida, o que é o comportamento correto.

### D-06 — Corte do corpo sem alterar `getContents`

**Alternativas**
- (a) Mudar `getContents` para receber o intervalo (descartado pelo PRD).
- (b) Converter tudo para `Uint8Array` e fatiar.
- (c) Fatiar por tipo de `BodyInit`, mantendo o tipo quando possível.

**Escolha: (c).** Helper privado `sliceBody(body, range, size): BodyInit | undefined`:

- `string`: `new TextEncoder().encode(body)` e `subarray(start, end + 1)` (o `size` é em bytes UTF-8).
- `ArrayBuffer`/`ArrayBufferView`: nova `Uint8Array` sobre `buffer` com `byteOffset + start` e tamanho do intervalo (sem cópia).
- `Blob` (inclui `File`): `body.slice(start, end + 1)`, preguiçoso, sem ler o arquivo.
- `ReadableStream`: novo `ReadableStream` com `pull` que lê do leitor original, descarta bytes até `start`, repassa até `end` e então chama `reader.cancel()` e fecha. Custa leitura sequencial até o início (risco R-02), aceito pelo PRD.
- `URLSearchParams`, `FormData` e demais: devolve `undefined` e o ramo cai no 200 completo (tamanho em bytes não é determinável).
- Verificação de consistência para tipos com tamanho conhecido (string, buffers, Blob): se o comprimento real diferir de `size`, devolve `undefined` e serve 200 completo, em vez de emitir `Content-Range` errado (premissa do PRD, R-03). Para stream não há verificação possível.

Quando `getContents` devolve `null`/`undefined`, mantém-se o comportamento atual (200 com corpo nulo, `src/utils/static.ts:277`).

### D-07 — Tamanho zero ou desconhecido

**Alternativas**
- (a) `size: 0` com `Range` vira 416 (leitura do RF-05 no item de risco do PRD).
- (b) `size` ausente ou `<= 0` ignora `Range` (RF-08).

**Escolha: (b).** O RF-08 é explícito e tem critério de aceite; o RF-05 fala em "início depois do fim do asset", que pressupõe tamanho conhecido. Com (b) o `content-length` atual (`src/utils/static.ts:268`, só para `size > 0`) não muda. A divergência do item de risco do PRD fica registrada em R-04. Além disso, `size` não inteiro ou negativo é tratado como desconhecido (`Number.isSafeInteger(size) && size > 0`).

### D-08 — Montagem das respostas 206 e 416

**Alternativas**
- (a) Lançar `HTTPError` 416.
- (b) Retornar `HTTPResponse` com status e cabeçalhos em `event.res.headers`.

**Escolha: (b).** (a) passaria pelo caminho de erro, com corpo JSON e filtragem de cabeçalhos (`src/response.ts:359-377`), em desacordo com `Content-Length: 0` e `Content-Range: bytes */<size>` da issue.

- **206:** `event.res.headers.set("content-range", \`bytes ${start}-${end}/${size}\`)` e `set("content-length", String(end - start + 1))` — `set` incondicional, para vencer um `content-length` pré-definido (nota em §1). Retorno: `new HTTPResponse(null, { status: 206 })` em HEAD (sem chamar `getContents`, RF-06) e `new HTTPResponse(slice, { status: 206 })` em GET. `statusText` vem do padrão do runtime.
- **416:** `set("content-range", \`bytes */${size}\`)`, `set("content-length", "0")`, `delete("content-encoding")` (um corpo vazio rotulado como gzip quebra decodificadores) e retorno `new HTTPResponse(null, { status: 416 })`, tanto em GET quanto em HEAD, sem ler o conteúdo.
- **200 por queda** (Range ignorado, `If-Range` não casa, `sliceBody` indefinido): fluxo atual, sem `content-range`. Se a queda ocorrer depois de decidir 206 em GET (corpo não fatiável), nenhum cabeçalho de 206 pode ter sido escrito antes: escrever `content-range`/`content-length` somente após `sliceBody` ter sucesso.

Para HEAD a decisão 206/416 é tomada só com `size`, então HEAD e GET concordam em status e cabeçalhos exceto quando o corpo não é fatiável (GET cai para 200; HEAD diria 206). Aceito e registrado em R-05: o tipo do corpo só é conhecido lendo `getContents`.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts:264-278` | Substitui o trecho entre `content-encoding` e o retorno final pela sequência da D-02: `accept-ranges`, decisão de Range, ramos 206/416, depois o ramo 200 atual (`content-length` em `:268`, HEAD em `:272`, `getContents` em `:276`). |
| `src/utils/static.ts:280` | Seção `// --- Internal Utils ---`: acrescentar, ao fim do arquivo, `parseRange`, `isIfRangeValid`, `sliceBody` e `sliceStream` (todas não exportadas). |
| `test/static-range.test.ts` (novo) | Testes do RF-11 (§5). |
| `test/static.test.ts:5-31`, `:396`, `:525` | Sem mudança prevista: as asserções são `toMatchObject` e `get(...)` pontuais (`:53`, `:69`, `:600-617`), que não colidem com o `Accept-Ranges` aditivo. Ajustar apenas se `pnpm vitest run test/static.test.ts` falhar. |
| `src/index.ts:193` | **Não alterar.** |
| `test/unit/package.test.ts:6` | **Não alterar**; serve de prova do RF-10. |

Nenhuma outra documentação pública é tocada (fora de escopo no PRD).

## 4. Contratos e assinaturas

Públicos: inalterados (`serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>` em `src/utils/static.ts:101-104`; `ServeStaticOptions` e `StaticAssetMeta` em `src/utils/static.ts:9-66`).

Privados, em `src/utils/static.ts` (não exportados; os retornos são anotados, como em `parseAcceptEncoding` em `src/utils/static.ts:292`):

```ts
/** Intervalo de bytes inclusivo, já limitado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Resolve o cabeçalho `Range` contra `size` (> 0).
 * `undefined` = ignorar (ausente, malformado, multi-faixa, unidade != bytes);
 * `"unsatisfiable"` = 416; senão a faixa a servir (RFC 9110 §14.1.2, §14.2).
 */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined;

/** `If-Range` (RFC 9110 §13.1.5): ETag por comparação forte, data por igualdade exata. */
function isIfRangeValid(ifRange: string, etag: string | null, lastModified: string | null): boolean;

/** Recorta o corpo; `undefined` quando o tipo não é fatiável ou o tamanho real difere de `size`. */
function sliceBody(body: BodyInit, range: ByteRange, size: number): BodyInit | undefined;

function sliceStream(stream: ReadableStream<Uint8Array>, range: ByteRange): ReadableStream<Uint8Array>;
```

Contrato HTTP resultante, para um asset de `size = 10`:

| Requisição | Status | `Content-Range` | `Content-Length` | Corpo |
| --- | --- | --- | --- | --- |
| GET sem Range | 200 | — | `10` | completo; `Accept-Ranges: bytes` |
| `bytes=2-5` | 206 | `bytes 2-5/10` | `4` | bytes 2..5 |
| `bytes=8-99` | 206 | `bytes 8-9/10` | `2` | bytes 8..9 |
| `bytes=7-` | 206 | `bytes 7-9/10` | `3` | bytes 7..9 |
| `bytes=-3` | 206 | `bytes 7-9/10` | `3` | bytes 7..9 |
| `bytes=-99` | 206 | `bytes 0-9/10` | `10` | completo |
| `bytes=20-30`, `bytes=-0`, `bytes=10-` | 416 | `bytes */10` | `0` | vazio |
| `bytes=0-1,4-5`, `itens=0-1`, `bytes=5-2`, `bytes=` | 200 | — | `10` | completo |
| HEAD `bytes=2-5` | 206 | `bytes 2-5/10` | `4` | vazio, sem `getContents` |
| `If-Range` com ETag forte igual | 206 | conforme Range | conforme | recorte |
| `If-Range` diferente | 200 | — | `10` | completo |
| `If-None-Match` casando + Range | 304 | — | — | vazio |

## 5. Estratégia de testes

Arquivo novo `test/static-range.test.ts`, em `describeMatrix` (modos `web` e `node`, `test/_setup.ts:11`), no padrão de `test/static.test.ts:5`. Fixture: asset `"0123456789"` (10 bytes) com `etag: '"v1"'`, `mtime` fixo e `getContents` como `vi.fn`; rotas `app.all("/**", e => serveStatic(e, opts))`. Casos, mapeados ao PRD:

- **RF-01:** GET e HEAD sem Range → 200 com `accept-ranges: bytes`.
- **RF-02:** `2-5` → 206, `content-range`, `content-length: 4`, corpo `"2345"`; fim além do tamanho limitado (`8-99`).
- **RF-03:** `7-` e `-3` → 206 `bytes 7-9/10`; `-99` → 206 `bytes 0-9/10`.
- **RF-04:** `0-1,4-5`, `itens=0-1`, `bytes=5-2`, `bytes=`, `bytes=a-b`, `bytes=1-2 ` com lixo → 200 completo, sem `content-range`.
- **RF-05:** `20-30`, `10-`, `-0` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio, `getContents` não chamado; sem `content-encoding` no 416 de uma variante `.gz`.
- **RF-06:** HEAD com `2-5` → 206, mesmos cabeçalhos, corpo vazio, `getContents` não chamado; HEAD com `20-30` → 416.
- **RF-07:** `If-Range: "v0"` → 200 completo; `"v1"` → 206; ETag fraco (`W/"v1"`) → 200; data igual ao `last-modified` → 206; data diferente → 200; `If-Range` sem `Range` → 200.
- **RF-08:** `getMeta` sem `size` e com `size: 0` + Range → 200, sem `content-range`.
- **RF-09:** `If-None-Match` casando + Range → 304 sem corpo; `If-Modified-Since` casando + Range → 304; asset inexistente + Range → 404 e, em suíte com `fallthrough: true`, o handler seguinte responde; método POST → 405; variante `.gz` aceita via `accept-encoding` + Range → 206 com `content-encoding: gzip`, `vary: accept-encoding`, recorte dos bytes da variante.
- **Tipos de corpo (D-06):** a mesma matriz de recorte para `string` (incluindo caracteres multibyte), `Uint8Array` com `byteOffset` ≠ 0, `ArrayBuffer`, `Blob` e `ReadableStream` (verificando que o stream original é cancelado após o fim do intervalo); corpo cujo tamanho real difere de `size` → 200 completo.
- **`content-length` pré-definido:** `headers: { "content-length": "999" }` com Range válido → 206 com o comprimento do intervalo (contraponto ao teste existente `test/static.test.ts:600`, que continua valendo para 200).
- **`accept-ranges: none`** em `options.headers` → Range ignorado.
- **RF-10:** `test/unit/package.test.ts` (snapshot de exports) continua verde, sem edição.

Execução e critérios de saída: `pnpm vitest run test/static-range.test.ts test/static.test.ts` (todos verdes nos dois modos), depois `pnpm vitest run` completo, `pnpm lint` e `pnpm typecheck`. Seguindo o fluxo de bug/feature do `AGENTS.md`, os testes novos são escritos primeiro e confirmados falhando antes da implementação.

## 6. Riscos

- **R-01 — Ordem 304 → Range → If-Range.** Mitigada pela posição fixa da D-02 e por testes de 304 com Range.
- **R-02 — Stream grande.** Cortar o início exige ler e descartar bytes, e um stream muito grande com `Range` perto do fim custa leitura quase integral. Aceito pelo PRD; mitiga-se usando `Blob`/`Uint8Array` quando o backend puder (o recorte então é O(1)).
- **R-03 — `size` diferente do conteúdo real.** Em tipos medidos, o descompasso é detectado e o servidor cai para 200. Em `ReadableStream` não há como detectar, e o `Content-Range` pode ficar errado: responsabilidade do backend, já registrada como premissa no PRD.
- **R-04 — Contradição no PRD sobre `size: 0`.** O item de risco diz que RF-05 faria 416 para qualquer intervalo em asset vazio; RF-08 manda ignorar o Range com `size` zero. Adotado RF-08 (D-07). Se a decisão do produto for outra, só o teste de `size: 0` e a condição `size > 0` mudam.
- **R-05 — HEAD e GET divergentes para corpo não fatiável.** HEAD responde 206 pelo `size`; GET pode cair em 200 (FormData/URLSearchParams ou tamanho real diferente). Raro, e sem como saber sem ler o corpo, o que o RF-06 proíbe.
- **R-06 — Tamanho do arquivo.** `src/utils/static.ts` passa a ~550 linhas, contra a meta de <200 do `AGENTS.md`. A restrição de helpers privados no módulo (issue e RF-10) tem precedência.
- **R-07 — Cabeçalhos pré-definidos pelo usuário.** `content-length` é sobrescrito em 206/416 (necessário para correção); `etag`/`last-modified` pré-definidos passam a governar o `If-Range` (D-05). Ambos cobertos por testes.
- **R-08 — Aditivo `Accept-Ranges`.** Clientes ou testes que comparem o conjunto exato de cabeçalhos veem um cabeçalho novo; os testes existentes usam `toMatchObject` e não são afetados (§3).
