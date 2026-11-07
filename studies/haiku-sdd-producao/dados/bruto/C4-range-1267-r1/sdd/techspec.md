# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-11).
Escopo de código: `src/utils/static.ts`, com helpers privados no mesmo módulo. Nenhum arquivo de `src/index.ts` muda.

Todas as citações `arquivo:linha` foram conferidas no código atual (commit `345d1cc`).

---

## 1. Visão geral

`serveStatic` (`src/utils/static.ts:101`) hoje ignora `Range`: depois de resolver o asset, devolve sempre `200` com o corpo inteiro (`src/utils/static.ts:276-277`). A mudança acrescenta, dentro do mesmo fluxo:

1. `Accept-Ranges: bytes` em todo asset encontrado para GET/HEAD;
2. avaliação de `If-Range` e `Range` depois das pré-condições de cache;
3. respostas `206` (um intervalo válido), `416` (intervalo não satisfazível) ou `200` completo (qualquer outro caso).

Nada muda em `getMeta`/`getContents`, em `ServeStaticOptions`, em `StaticAssetMeta` nem nas exportações.

### Ordem de avaliação no fluxo final

Segue RFC 9110 §13.2.2 (P4 do PRD):

```
... 404 (sem meta)           src/utils/static.ts:210-215   (inalterado)
... Vary                     src/utils/static.ts:220-225   (inalterado)
... ETag / Last-Modified     src/utils/static.ts:227-241   (+ Accept-Ranges)
... isCacheMatch -> 304      src/utils/static.ts:243-248   (inalterado, antes de Range)
... Content-Type/Encoding    src/utils/static.ts:250-266   (inalterado)
... Content-Length (meta)    src/utils/static.ts:268-270   (range sobrescreve, ver D-05)
... [NOVO] If-Range + Range  depois de 270, antes de HEAD (272)
... HEAD -> 200 vazio        src/utils/static.ts:272-274   (inalterado)
... GET -> 200 completo      src/utils/static.ts:276-277   (inalterado)
```

---

## 2. Decisões de arquitetura

### D-01 — Helpers privados no próprio `static.ts`

**Decisão.** Os helpers novos (`parseRange`, `matchIfRange`, `sliceContents`) ficam em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`.

**Alternativas.**
- *Novo arquivo `src/utils/internal/range.ts`.* O AGENTS.md prevê `utils/internal/` para helpers, e o arquivo ficaria menor. Descartada: o PRD (RF-10) e o pedido dizem para manter a lógica "privada dentro do módulo `serveStatic`", e um arquivo novo amplia essa fronteira sem necessidade.
- *Exportar os helpers para testes unitários.* Descartada: quebra RF-10.

**Trade-off.** `static.ts` já tem 352 linhas, acima da meta de 200 LoC do AGENTS.md. Registrado em R-08.

### D-02 — Validação de `If-Range` com comparação forte

**Decisão.** `matchIfRange` (RFC 9110 §13.1.5) usa comparação forte:
- valor começando com `"` é ETag: casa só com `meta.etag` idêntico e que não começa com `W/`;
- caso contrário, é data: casa só se `new Date(valor).getTime()` for igual ao `mtimeDate` já truncado em segundos (`src/utils/static.ts:227-237`);
- ETag fraca no pedido (`W/"..."`) nunca casa, porque cai no ramo de data e não converte para data válida.

**Alternativas.**
- *Comparação fraca, como `matchETag` (`src/utils/internal/cache.ts:11-17`).* Descartada: `If-Range` exige comparação forte; com comparação fraca, um cliente receberia um trecho de representação diferente da que ele guardou.
- *Ignorar `If-Range`.* Descartada: RF-07 pede validação.

### D-03 — Parser estrito de `Range`, apenas `bytes` e um intervalo

**Decisão.** `parseRange` aceita somente:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;
```

aplicado ao valor depois de `trim()` (OWS nas bordas do cabeçalho). Consequências:
- `bytes=N-`, `bytes=N-M`, `bytes=-N` são válidos;
- `bytes=-` (ambos vazios) é inválido → `200` completo;
- `bytes=5-2` (último menor que o primeiro) é sintaticamente inválido → `200` completo (RFC 9110 §14.1.1);
- espaço em torno de `-` ou depois de `=`, unidade diferente de `bytes` (exceto caixa), vírgula (múltiplos intervalos) → `200` completo (RF-05).
- unidade é case-insensitive (`Bytes=` aceito), pois o RFC trata `range-unit` assim.

**Alternativa.** Aceitar espaços internos, como alguns servidores fazem. Descartada: o ABNF da RFC não permite, e fixar a regra torna o comportamento testável (R-03 do PRD).

### D-04 — Fatiamento por bytes da representação, materializando o conteúdo

**Decisão.** `sliceContents` obtém o corpo com `getContents` e o converte em `ArrayBuffer` usando `new Response(contents).arrayBuffer()`, depois fatia com `slice(start, end + 1)`.

Motivos:
- strings são serializadas como UTF-8 pelo `Response`, o mesmo que `HTTPResponse` faz no envio. Assim, os bytes fatiados batem com o `Content-Length` calculado sobre bytes (um `"é"` tem 2 bytes, não 1 caractere);
- aceita todos os tipos de `BodyInit` (string, `Blob`, `ArrayBuffer`, `ReadableStream`) sem ramificar por tipo;
- o PRD (fora de escopo) aceita fatiar depois de obter o conteúdo.

**Alternativas.**
- *`content.slice(start, end + 1)` em string.* Descartada: fatia por caractere, errado para texto não ASCII.
- *`Blob.slice` quando for `Blob`, e materializar no resto.* Descartada por complexidade sem ganho de memória: o `getContents` ainda devolve o arquivo inteiro (R-01).
- *Streaming com `Range` no `getContents`.* Descartada: exige nova opção ou nova assinatura, o que o PRD proíbe.

### D-05 — Headers de conteúdo parcial vão para `event.res.headers`, não para o `HTTPResponse`

**Decisão.** `content-range` e o `content-length` do trecho são escritos com `event.res.headers.set(...)`. O `HTTPResponse` devolvido carrega só `status` e corpo.

Motivo verificado no código: em `prepareResponse`, os headers preparados em `event.res` sobrescrevem os do `HTTPResponse`:
- `src/response.ts:203` — `mergeHeaders(res.headers, preparedHeaders)`;
- `src/response.ts:218` — `if (preparedHeaders && !nested ...)`, que faz o mesmo para `Response` ao final;
- `src/response.ts:243-252` — `mergeHeaders` faz `target.set(name, value)` para cada override.

Se o 206 colocasse `content-length` só no `HTTPResponse`, o `content-length: 1000` de `src/utils/static.ts:268-270` venceria e o cliente receberia `Content-Length` errado. Por isso o `set` em `event.res` precisa acontecer depois de `src/utils/static.ts:268-270` (o novo `set` sobrescreve).

Consequência aceita: no caminho de `Range` válido, um `content-length` vindo de `options.headers` também é sobrescrito. Um valor fixo do tamanho completo seria mentira para um trecho (ver R-06).

### D-06 — `Accept-Ranges` em todo asset encontrado

**Decisão.** `event.res.headers.set("accept-ranges", "bytes")` logo depois de `etag` (`src/utils/static.ts:239-241`), antes de `isCacheMatch`. Assim vai também com `304` (RF-01 lista GET e HEAD para assets encontrados). Não é enviado em `404` nem em `405`, porque esses caminhos retornam antes (`src/utils/static.ts:116-122`, `:210-215`).

**Alternativa.** Anunciar só quando `size` é conhecido. Descartada: é a leitura literal da issue ("always advertise") e o P1 do PRD; ver R-04.

### D-07 — Ignorar `Range` com `size` ausente ou zero

**Decisão.** Sem `meta.size > 0`, o bloco de `Range` não roda e a resposta é `200` (P2, RF "Fora de escopo"). A condição reaproveita a mesma regra de `src/utils/static.ts:268`.

### D-08 — Sufixo e intervalo além do fim

**Decisão.**
- `bytes=-N` com `N > size` → intervalo `0..size-1` (RFC 9110 §14.1.1, sufixo maior que a representação vira a representação inteira);
- `bytes=-0` → `416` (RF-06: sufixo de tamanho zero);
- `bytes=N-M` com `M >= size` → `M` vira `size-1`;
- `bytes=N-` com `N >= size` → `416`.

### D-09 — Ordem entre `If-Range` e a validade do intervalo

**Decisão.** Primeiro se decide se `If-Range` permite aplicar `Range`. Só depois se avalia satisfatibilidade. Se `If-Range` não casa, a resposta é `200` completo, mesmo que o intervalo fosse `416` (RFC 9110 §13.1.5: o `Range` é ignorado inteiro).

### D-10 — `416` mantém os headers de representação já definidos

**Decisão.** `416` carrega `content-range: bytes */<size>` e `content-length: 0`. Os demais headers já setados em `event.res` (`content-type`, `etag`, `last-modified`, `content-encoding`, `vary`) permanecem. A RFC não proíbe, e é mais simples do que apagá-los.

**Alternativa.** Limpar os headers de representação em `416`. Descartada: mais código para um caso que não muda o comportamento do cliente.

### D-11 — `HEAD` com intervalo válido

**Decisão.** Mesmos headers de um GET com intervalo válido (`206`, `content-range`, `content-length` do trecho), e corpo `null`. `nullBody` (`src/response.ts:350-356`) já zera o corpo para HEAD, mas o código passa `null` explicitamente, como `src/utils/static.ts:273` já faz.

---

## 3. Arquivos a alterar

### `src/utils/static.ts`

| Local | Mudança |
| --- | --- |
| `src/utils/static.ts:239-241` | acrescentar `event.res.headers.set("accept-ranges", "bytes")` (D-06) |
| `src/utils/static.ts:268-270` | sem mudança. O bloco de `Range` ocorre depois e sobrescreve `content-length` (D-05) |
| `src/utils/static.ts:271` (após `:270`, antes de `:272`) | bloco novo de `If-Range`/`Range`, com retornos `416` e `206` (HEAD) |
| `src/utils/static.ts:276-277` | GET com intervalo válido: `206` com `sliceContents`; sem intervalo, sem mudança |
| `src/utils/static.ts:280-351` | helpers privados novos: `RANGE_RE`, `parseRange`, `matchIfRange`, `sliceContents` (no fim do arquivo, após `idSearchPaths` em `:340-351`) |

Bloco de `Range` em pseudocódigo (não é o código final, só a forma):

```ts
const rangeHeader = event.req.headers.get("range");
const size = meta.size ?? 0;
if (rangeHeader && size > 0) {
  const range = parseRange(rangeHeader, size);
  const ifRange = event.req.headers.get("if-range");
  if (range && (!ifRange || matchIfRange(ifRange, { etag: meta.etag, mtime: mtimeDate }))) {
    if (range === "unsatisfiable") {
      event.res.headers.set("content-range", `bytes */${size}`);
      event.res.headers.set("content-length", "0");
      return new HTTPResponse(null, { status: 416 });
    }
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    event.res.headers.set("content-length", String(range.end - range.start + 1));
    if (event.req.method === "HEAD") {
      return new HTTPResponse(null, { status: 206 });
    }
    const contents = await options.getContents(id);
    return new HTTPResponse(await sliceContents(contents, range), { status: 206 });
  }
}
```

Observação sobre `Accept-Ranges` e `If-Range` sem `Range`: `If-Range` só é lido dentro do `if (rangeHeader ...)`, então sem `Range` ele é ignorado (RFC 9110 §13.1.5).

### `src/index.ts`

Sem alteração. `src/index.ts:193` continua exportando `type ServeStaticOptions, type StaticAssetMeta, serveStatic`, e a lista de `test/unit/package.test.ts:133` continua igual (RF-10).

### Nenhum outro arquivo de produção

`src/utils/internal/cache.ts` não muda: `isCacheMatch` e `matchETag` seguem como estão, e a comparação de `If-Range` é nova e local (D-02).

`src/rules/cache.ts:143-148` (`isBypassedRequest`) não muda. Ele já desvia `Range` do cache (fora de escopo, PRD).

---

## 4. Contratos e assinaturas

Todos privados ao módulo, sem `export`, sem tipos novos exportados. Os tipos abaixo são locais a `static.ts`.

```ts
/** Intervalo resolvido, em bytes, inclusivo nas duas pontas. */
type ByteRange = { start: number; end: number };

/** `RANGE_RE` aceita só `bytes=N-`, `bytes=N-M` e `bytes=-N`, sem espaço interno. */
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;

/**
 * Interpreta um `Range` de um único intervalo contra um tamanho conhecido.
 * - `undefined`: sintaxe inválida, múltiplos intervalos ou outra unidade. O `Range` é ignorado.
 * - `"unsatisfiable"`: intervalo que não cabe no asset (`416`).
 * - `ByteRange`: intervalo a servir (`206`).
 */
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

/**
 * Avalia `If-Range` (RFC 9110 §13.1.5) com comparação forte.
 * ETag começa com `"`; caso contrário é tratado como data HTTP.
 */
function matchIfRange(value: string, validators: { etag?: string; mtime?: Date }): boolean;

/**
 * Obtém os bytes do conteúdo e devolve só o trecho pedido.
 * Usa `Response` para serializar strings e streams da mesma forma que o envio.
 */
async function sliceContents(
  contents: BodyInit | null | undefined,
  range: ByteRange,
): Promise<ArrayBuffer>;
```

Esboço das duas funções que só precisam de contrato (o corpo é trivial):

```ts
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined {
  const match = RANGE_RE.exec(value.trim());
  if (!match) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && Number(last) < start) return undefined;
  if (start >= size) return "unsatisfiable";
  return { start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

function matchIfRange(value: string, validators: { etag?: string; mtime?: Date }): boolean {
  if (value.startsWith('"')) {
    return !!validators.etag && !validators.etag.startsWith("W/") && validators.etag === value;
  }
  return !!validators.mtime && new Date(value).getTime() === validators.mtime.getTime();
}

async function sliceContents(
  contents: BodyInit | null | undefined,
  { start, end }: ByteRange,
): Promise<ArrayBuffer> {
  return (await new Response(contents).arrayBuffer()).slice(start, end + 1);
}
```

Estilo: os helpers ficam no fim do arquivo, como os existentes (`parseAcceptEncoding`, `normalizeCoding`, `idSearchPaths`). Sem `k`-prefixo, porque não são constantes de símbolo. `RANGE_RE` segue o padrão de `WEIGHT_RE` (`src/utils/static.ts:283`).

### Resposta observável

| Caso | Status | Headers de conteúdo | Corpo |
| --- | --- | --- | --- |
| Sem `Range` | 200 | `accept-ranges: bytes`, `content-length: <size>` | completo |
| `Range` inválido, múltiplo ou outra unidade | 200 | `accept-ranges`, `content-length: <size>` | completo |
| `If-Range` não casa | 200 | igual ao anterior | completo |
| Intervalo válido | 206 | `content-range: bytes a-b/<size>`, `content-length: b-a+1` | trecho |
| HEAD com intervalo válido | 206 | igual ao 206 | vazio |
| Intervalo não satisfazível | 416 | `content-range: bytes */<size>`, `content-length: 0` | vazio |
| `304` (cache) | 304 | `accept-ranges`, `etag`, `last-modified` | vazio (sem mudança) |

---

## 5. Estratégia de testes

Seguindo AGENTS.md: `describeMatrix` (roda em `web` e `node`), `t.fetch`, um app novo por teste.

### Arquivo

`test/static.test.ts`. Um novo bloco `describeMatrix("serve static range", ...)` no fim, antes de `describe("serve static (malformed url)")` (`test/static.test.ts:626`), ou depois dele. Não criar arquivo novo, para manter os testes de static juntos (PRD RF-11 cita o arquivo de static).

### Fixture

Asset de 1000 bytes, conteúdo previsível, para checar bytes exatos:

```ts
const content = "abcdefghij".repeat(100); // 1000 bytes ASCII
getMeta: () => ({ type: "text/plain", size: 1000, etag: '"abc"', mtime: 1_700_000_000_000 })
```

Um segundo caso com conteúdo não ASCII (`"é"` repetido), para provar que o trecho é por byte.

### Casos (mapeados aos RFs)

| Teste | RF | Verifica |
| --- | --- | --- |
| GET sem `Range` tem `accept-ranges: bytes` e 200 | RF-01 | cabeçalho e status |
| HEAD sem `Range` tem `accept-ranges` | RF-01 | |
| `bytes=0-99` → 206, `content-range` `bytes 0-99/1000`, `content-length` 100, corpo exato | RF-02 | |
| `bytes=900-` → 206, `bytes 900-999/1000`, 100 | RF-03 | |
| `bytes=-50` → 206, `bytes 950-999/1000`, 50 | RF-03 | |
| `bytes=-5000` → 206 com `0-999` | D-08 | sufixo maior que o asset |
| HEAD `bytes=0-99` → 206, headers, corpo vazio | RF-04 | |
| `bytes=abc`, `bytes=0-9,20-29`, `bytes= 0-9`, `bytes=5-2`, `bytes=-`, `items=0-9` → 200 completo sem `content-range` | RF-05, D-03 | cada caso, um por vez |
| `Bytes=0-9` (caixa) → 206 | D-03 | unidade case-insensitive |
| `bytes=1000-1100` → 416, `bytes */1000`, `content-length: 0`, corpo vazio | RF-06 | |
| `bytes=-0` → 416 | RF-06, D-08 | sufixo zero |
| `If-Range: "xyz"` → 200 completo; `If-Range: "abc"` → 206 | RF-07 | ETag forte |
| `If-Range: W/"abc"` → 200 | RF-07, D-02 | ETag fraca nunca casa |
| `If-Range` com data igual ao `last-modified` → 206; data diferente → 200 | RF-07, D-02 | comparação de data |
| `If-Range` sem `Range` → 200 | D-09 | ignorado sem `Range` |
| `If-Range` não casa com intervalo `416` → 200, não 416 | D-09 | ordem |
| `If-None-Match: "abc"` + `Range` → 304 | RF-08 | pré-condição antes de Range |
| `If-Modified-Since` ≥ mtime + `Range` → 304 | RF-08 | |
| POST com `Range` → 405 com `allow: GET, HEAD` | RF-09 | |
| Asset inexistente com `Range` → 404 | RF-09 | |
| Asset inexistente com `Range` e `fallthrough` → passa ao próximo handler | RF-09 | bloco "with fallthrough" |
| `Range` com `accept-encoding: gzip` → 206 sobre o `.gz` (bytes da variante) | P3 | variante codificada |
| Conteúdo `"é"` repetido, `bytes=0-1` → 206 com 2 bytes válidos | D-04 | byte, não caractere |
| `size` ausente ou 0 com `Range` → 200 completo | D-07 | |
| `Range` com `options.headers: { "content-length": "999" }` → 206 com `content-length` do trecho | D-05 | sobrescrita documentada |

### Testes existentes

Nenhum teste existente envia `Range` para `serveStatic`: o único `Range` nos testes está em `test/rules/cache.test.ts:1214-1226`, que não passa por `serveStatic`. Portanto nenhum teste existente precisa de ajuste (P5 do PRD fica em aberto só como precaução). Os asserts com `toMatchObject` (`test/static.test.ts:53`, `:69`) continuam válidos com o novo `accept-ranges`.

Se algum teste precisar mudar durante a implementação, registrar a justificativa no PR (R5 do PRD).

### Regressão e tipos

- `pnpm vitest run test/static.test.ts` (matriz web/node);
- `pnpm vitest run test/security.test.ts test/rules test/unit` (serveStatic é usado em `test/security.test.ts:243-395`, e `test/unit/package.test.ts:133` valida exports);
- `pnpm typecheck` (`tsc --noEmit`);
- `pnpm lint` (`oxlint . && oxfmt --check .`);
- por fim `pnpm test` completo, se o tempo permitir.

Seguindo o fluxo de correção de bug do AGENTS.md, escrever primeiro os testes de RF-02 e RF-05 e confirmar que falham antes da implementação. A feature é nova, então a falha esperada é 200 em vez de 206.

---

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | `getContents` devolve o arquivo inteiro. Cada `Range` carrega tudo na memória (R1 do PRD). Em vídeo grande, isso pesa. | Documentar. Leitura parcial via `getContents` ou streaming fica fora de escopo. |
| R-02 | Tamanho de `meta.size` diferente do número real de bytes do conteúdo. O corpo do trecho e o `content-length` deixam de bater. | O contrato já exige `size` = bytes. Os fixtures do arquivo usam `.length` em ASCII. Documentar para quem implementa `getMeta`. |
| R-03 | Números muito grandes em `Range` (`bytes=0-99999999999999999999999`) passam de `Number.MAX_SAFE_INTEGER`. | Como qualquer valor acima de `size` vira `size - 1` ou `416`, o resultado é correto para tamanhos reais. Teste de fixação do comportamento. |
| R-04 | `Accept-Ranges` em todo asset (P1) faz clientes pedirem `Range` a assets sem `size` conhecido. Eles recebem `200` completo. | É aceito pela RFC e pelo PRD (R4). Sem `size`, o `Range` é ignorado, não erra. |
| R-05 | Regressão em cache, encoding e `vary`, que compartilham o caminho de `isCacheMatch` e `content-encoding` (R2 do PRD). | Testes de 304 com `Range` e de variante `.gz` com `Range`. O bloco novo fica depois de `src/utils/static.ts:270`, sem mexer em 220-266. |
| R-06 | `content-length` vindo de `options.headers` é sobrescrito em `206`. | Intencional (D-05): um valor de tamanho completo estaria errado para trecho. Teste fixa a escolha. |
| R-07 | `416` mantém `content-encoding` e `etag` de representação. | Aceito (D-10). Corpo vazio, sem efeito prático. |
| R-08 | `src/utils/static.ts` passa de 352 para cerca de 430 linhas, acima da meta de 200 LoC. | Aceito por D-01 (contrato de privacidade do módulo). Se o PR crescer, mover os helpers para `utils/internal/range.ts` em PR separado. |
| R-09 | Fixtures de teste usam ETag `w/123` sem aspas (`test/static.test.ts:13`, `:405`). Não é ETag válida pela RFC. | `matchIfRange` trata qualquer valor que não começa com `"` como data, então `If-Range: w/123` não casa. Os testes novos usam `'"abc"'`. Os antigos não mudam. |
| R-10 | Interação com `h3/rules/cache`: `isBypassedRequest` (`src/rules/cache.ts:143-148`) desvia `Range` do cache, então `serveStatic` atrás de `cache` responde sempre ao vivo para `Range`. | Comportamento correto (não cachear trecho como entrada inteira). Fora de escopo do PRD. |
| R-11 | Comparação de `If-Range` por data depende de `mtimeDate` truncado em segundos (`src/utils/static.ts:232`). Um cliente que mande a data com milissegundos recebe `200` completo. | Correto pela RFC (data é só HTTP-date, precisão de segundo). Teste de data igual ao `last-modified` garante o caso normal. |
| R-12 | `If-Range` usa `meta.etag` e não o `etag` efetivamente enviado, que pode vir de `options.headers` (`src/utils/static.ts:239`). | Mesma escolha que `isCacheMatch` já faz em `:243`. Consistente; documentar. |

---

## 7. Perguntas abertas

Nenhuma bloqueia a implementação. As escolhas acima já estão fixadas nos testes. Se o time quiser outra política, ela muda só `parseRange` (D-03, D-08) ou `matchIfRange` (D-02).
