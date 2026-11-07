# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (requisitos RF-01 a RF-09 e premissas P-01 a P-05).
Escopo de código: `src/utils/static.ts`, com testes em `test/static.test.ts`.
Norma: RFC 9110, §13.1.5 (If-Range), §13.2.2 (ordem de avaliação), §14 (Range).

## Estado atual conferido no código

- `src/utils/static.ts:9` define `StaticAssetMeta` (`size`, `etag`, `mtime`, `type`, `encoding`). Não muda.
- `src/utils/static.ts:17` define `ServeStaticOptions`. Não muda.
- `src/utils/static.ts:101` é a assinatura de `serveStatic(event, options)`.
- `src/utils/static.ts:201` chama `options.getMeta(_id.id)` por variante. Portanto `meta.size` já é o tamanho da variante pré-comprimida, e RF-07 sai de graça.
- `src/utils/static.ts:243-248` avalia o cache (`isCacheMatch`) e devolve 304. Esta é a primeira validação condicional, antes de `Range` (P-05).
- `src/utils/static.ts:268-270` define `content-length` a partir de `meta.size`, e só quando ainda não existe no `event.res`.
- `src/utils/static.ts:272-274` responde HEAD com `200` e corpo nulo, antes de chamar `getContents`.
- `src/utils/static.ts:276-277` chama `getContents(id)` e responde `200` com o corpo inteiro. Este é o ponto de inserção do recorte.
- `src/utils/static.ts:116-122` trata método diferente de GET/HEAD com `405` e `allow: GET, HEAD`. Não muda.
- `src/index.ts:193` é a única exportação de `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta`. Não muda (RF-08).
- `src/response.ts:96-124` é a classe `HTTPResponse`. Respostas `HTTPResponse` são mescladas com `event.res` (ver `src/response.ts:129` e o ramo de `HTTPResponse` em `src/response.ts:304`). Por isso `event.res.headers.set(...)` seguido de `return new HTTPResponse(null, { status })` é o padrão já usado no 304.
- `src/utils/internal/cache.ts:29-49` é `isCacheMatch`. Não muda.
- `src/rules/cache.ts:143-148` já ignora requisições com `Range` no cache de regras (`isBypassedRequest`). Nada muda ali, e a ocorrência fica fora de escopo (ver PRD).
- `test/static.test.ts` tem **nenhuma** ocorrência de `range` (confirmado por grep). Nenhum teste existente envia `Range`, então nenhum deve mudar de resultado (fecha R-05 do PRD).
- `test/static.test.ts:600-617` cobre "não sobrescrever content-length já definido na resposta" (HEAD, sem Range). Esse comportamento deve continuar.
- `test/unit/package.test.ts:133` lista `serveStatic` na lista de exportações. É o teste que valida RF-08.
- `package.json` (scripts): `lint` = `oxlint . && oxfmt --check .`; `typecheck` = `tsc --noEmit`; `test` = lint + typecheck + vitest com cobertura.

---

## Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Escolha:** toda a lógica nova (parse, If-Range, recorte do corpo) fica em `src/utils/static.ts`, como funções não exportadas no fim do arquivo, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts`. É o padrão de `AGENTS.md` para helpers internos e mantém `static.ts` curto.
- Criar um módulo público (`src/utils/range.ts`) e reexportar. Viola RF-08 e o contrato do pedido.

**Justificativa:** o pedido diz "manter toda a lógica auxiliar privada no módulo `serveStatic`", e o PRD (RF-08) repete isso. Um arquivo `internal/` não é exportado, mas também não é "o módulo". Como o contrato é explícito, a escolha segue o contrato. O custo é o arquivo passar de ~350 para ~450 linhas, acima da meta de "< 200 LoC" de `AGENTS.md`. Isso fica registrado em R-07. Se o revisor preferir o padrão `internal/`, a extração é mecânica e não muda contrato.

### D-02 — Ordem de avaliação

**Escolha:** dentro de `serveStatic`, depois de `src/utils/static.ts:243` (304) e antes de `src/utils/static.ts:272` (HEAD), nesta ordem:

1. `Accept-Ranges: bytes` (definido antes do bloco de cache, ver D-08).
2. Validação de `If-Range` e parse de `Range` contra `meta.size` (`resolveByteRange`).
3. Se o resultado for "não satisfazível": `416`.
4. Se o resultado for um intervalo válido: `206` (HEAD sem corpo; GET com corpo recortado).
5. Caso contrário: comportamento atual (`200`).

**Justificativa:** segue P-05 e a RFC 9110 §13.2.2. Condicionais de cache (304) vêm primeiro, depois If-Range e Range.

### D-03 — Parse estrito de `Range`, com ignorado para o que não é válido

**Escolha:** aceitar apenas `bytes=<a>-<b>`, `bytes=<a>-` ou `bytes=-<n>`, com um único intervalo, sem espaços dentro da especificação. A expressão é:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;
```

- Unidade é case-insensitive (`i`).
- Valor sem match (outra unidade, múltiplos intervalos separados por vírgula, lixo) é **ignorado**: responde `200` completo (RF-04). RFC 9110 §14.2 permite que o servidor ignore `Range`.
- Dois campos vazios (`bytes=-`) são inválidos e ignorados.
- `bytes=b-a` com `b > a` é sintaticamente inválido (RFC 9110 §14.1.1), então é ignorado também.
- Sufixo `bytes=-0` é sintaticamente válido e **não satisfazível** (RFC 9110 §14.1.1): responde `416`.

**Alternativa considerada:** fazer parse com `split(",")` e aceitar o primeiro intervalo. Rejeitada: viola RF-04 (multi-range deve ser ignorado por inteiro).

### D-04 — Validação de `If-Range`

**Escolha:** `If-Range` só é avaliado quando há `Range` válido (ou seja, depois do parse). A regra é:

- Se o valor for igual a `meta.etag` **e** `meta.etag` não começar com `W/`, casa. Comparação de ETag forte, por igualdade exata (RFC 9110 §13.1.5).
- Senão, se `meta.mtime` existir e `new Date(valor).getTime()` for igual ao tempo de `mtimeDate` (já truncado em segundos, `src/utils/static.ts:227-233`), casa.
- Em qualquer outro caso, não casa. Então o `Range` é ignorado e a resposta é `200` completa (RF-05).
- Se não houver validadores em `meta`, `If-Range` nunca casa.

**Por que comparar com `meta.etag` e não com o header `etag` da resposta:** o validador é do representation que `getMeta` descreve. O header `etag` pode ter sido sobrescrito por `options.headers`, o que não deve afetar a decisão.

**Por que a checagem de ETag vem antes da de data:** um ETag nunca tem formato de data, então a ordem não altera o resultado. Checar ETag primeiro evita `new Date("w/123")` com o formato usado nos próprios testes (`test/static.test.ts:15`, `etag: "w/123"`).

**Alternativa considerada:** classificar `If-Range` por prefixo (`"`/`W/` = ETag, senão data). Rejeitada: quebra com o ETag `w/123` dos testes existentes, que não tem aspas.

### D-05 — Recorte do corpo por tipo de `BodyInit`

`getContents` devolve o corpo inteiro e não recebe intervalo (P-02; a API pública não muda, RF-08). O recorte acontece em um helper privado `sliceBody(body, range)` que devolve o corpo recortado ou `undefined` quando não há como recortar com segurança:

| Tipo do corpo | Estratégia | Custo |
| --- | --- | --- |
| `string` | `new TextEncoder().encode(body).subarray(start, end + 1)` | O(tamanho) para codificar |
| `ArrayBuffer` ou `ArrayBufferView` (inclui `Uint8Array`) | `new Uint8Array(buffer, offset, length).subarray(...)` (sem cópia) | O(1) |
| `Blob` (inclui `File` e `Bun.file`) | `body.slice(start, end + 1)` (lazy, sem leitura) | O(1) |
| `ReadableStream` | lê e descarta até `start`, enfileira `[start, end]`, e cancela a origem ao passar de `end` | O(end) de I/O |
| `null` / `undefined` | sem corpo, devolve `undefined` (200 como hoje) | — |
| Outros (`FormData`, `URLSearchParams`, etc.) | `undefined`, responde `200` completo | — |

**Divergência do PRD (R-01):** o PRD recomendava responder `200` completo para `ReadableStream`. Esta especificação escolhe recortar por leitura e cancelamento, pelo seguinte motivo: o stream é o tipo comum para arquivos de disco em runtimes Node/Bun/Deno, e responder `200` nesse caso desabilita retomada e seek justamente nos casos da issue. O custo é ler até `end` (não o arquivo inteiro, porque a leitura para em `end` e a origem é cancelada). Para seek perto do fim do arquivo, o custo se aproxima de ler o arquivo todo. Se o time preferir o comportamento do PRD, a troca é uma linha em `sliceBody`: retornar `undefined` no ramo de `ReadableStream`. Registrado em R-01.

**Alternativa considerada:** converter tudo para `Uint8Array` antes de recortar. Rejeitada: obriga a carregar o arquivo inteiro na memória para qualquer tipo, incluindo `Blob`, que hoje é lazy.

### D-06 — Tamanho zero ou ausente: Range ignorado

**Escolha:** se `meta.size` não existir ou não for `> 0`, o `Range` é ignorado e a resposta segue como hoje (`200` completo, sem `Content-Range`), conforme P-01.

**Alternativa considerada:** responder `416` com `Content-Range: bytes */0` para arquivos vazios, como manda a RFC para recurso de tamanho zero (R-04 do PRD). Rejeitada: a RFC permite ignorar `Range` (§14.2), arquivos vazios não mudam de comportamento, e o caso de `size` ausente não tem tamanho para calcular 416 nenhum. Decisão fecha R-04 do PRD.

### D-07 — `Content-Length` e `Content-Range` em 206 e 416 sobrescrevem headers anteriores

**Escolha:** em 206 e 416, `content-length` e `content-range` são definidos com `event.res.headers.set(...)`, sobrescrevendo o `content-length` derivado de `meta.size` (`src/utils/static.ts:268-270`) e qualquer valor vindo de `options.headers`.

**Justificativa:** o `Content-Length` precisa bater com os bytes enviados. Em 206 isso é diferente de `meta.size`. Isso difere do padrão de `src/utils/static.ts:268` ("não sobrescrever"), e o padrão continua valendo para 200 e para HEAD sem Range. O teste `test/static.test.ts:600-617` continua verde porque não envolve `Range`.

### D-08 — `Accept-Ranges: bytes` em toda resposta de asset encontrado

**Escolha:** definir `accept-ranges: bytes` logo depois de definir `etag` (`src/utils/static.ts:239-241`), **antes** do bloco de cache. Assim vai em 200, 206, 416 e também em 304.

**Justificativa:** RF-01 lista 200, 206 e 416, mas diz "toda resposta de asset encontrado". Colocar antes do cache cobre o texto literal e não custa nada (`Accept-Ranges` é permitido em 304, RFC 9110 §14.3). Essa é a única decisão que vai além da lista do PRD, e a divergência é intencional.

**Alternativa considerada:** definir só depois do cache, como os demais headers de representação. Rejeitada por não cobrir o texto literal do RF-01.

### D-09 — Respostas 206 e 416 montadas pelo mesmo caminho do 304

**Escolha:** `416` e `206` são devolvidos como `new HTTPResponse(body, { status, statusText })`, com headers definidos em `event.res.headers` antes, igual ao 304 (`src/utils/static.ts:243-248`). Textos de status: `"Partial Content"` e `"Range Not Satisfiable"`.

**Justificativa:** segue o padrão existente. Não há nova forma de montar resposta.

---

## Contratos e assinaturas (privados, não exportados)

Nada novo é exportado. `src/index.ts` não muda, e `ServeStaticOptions`/`StaticAssetMeta` não ganham campos.

```ts
// src/utils/static.ts (privado, no fim do arquivo)

/** Intervalo inclusivo de bytes, já ajustado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Decide o Range a aplicar. Devolve:
 * - `undefined`: ignorar o Range (sem header, malformado, multi-range, If-Range não casou,
 *   ou tamanho desconhecido/zero).
 * - `"unsatisfiable"`: responder 416.
 * - `ByteRange`: responder 206.
 */
function resolveByteRange(
  headers: Headers,
  validators: { size: number; etag?: string; lastModified?: Date },
): ByteRange | "unsatisfiable" | undefined;

/** Parse de `bytes=a-b`, `bytes=a-`, `bytes=-n` contra `size` (> 0). */
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Avalia `If-Range` (D-04). */
function ifRangeMatches(
  value: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/** Recorta o corpo (D-05). `undefined` = não há recorte seguro, responder 200 completo. */
function sliceBody(body: BodyInit | null | undefined, range: ByteRange): BodyInit | undefined;

/** Recorte preguiçoso de um ReadableStream de bytes (D-05). */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: ByteRange,
): ReadableStream<Uint8Array>;
```

### Esboço da ordem em `serveStatic` (`src/utils/static.ts`)

Trecho de referência, não código final. A ordem de inserção está em D-02.

```ts
// logo após definir etag (src/utils/static.ts:239-241), antes do cache (243)
event.res.headers.set("accept-ranges", "bytes");

// ... bloco de cache (243-248) e content-type/encoding/content-length (250-270) como hoje ...

const range =
  meta.size && meta.size > 0
    ? resolveByteRange(event.req.headers, {
        size: meta.size,
        etag: meta.etag,
        lastModified: mtimeDate,
      })
    : undefined;

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (event.req.method === "HEAD") {
  return range ? partialResponse(null, range, meta.size!) : new HTTPResponse(null, { status: 200 });
}

const contents = await options.getContents(id);
const partial = range && sliceBody(contents, range);
if (range && partial !== undefined) {
  return partialResponse(partial, range, meta.size!);
}
return new HTTPResponse(contents || null, { status: 200 });
```

`partialResponse(body, range, size)` (privado, a definir no mesmo arquivo) faz:

- `event.res.headers.set("content-range", \`bytes ${start}-${end}/${size}\`)`;
- `event.res.headers.set("content-length", String(end - start + 1))`;
- devolve `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`.

Observação sobre HEAD: com `range` válido, o HEAD responde 206 **sem** chamar `getContents`, o que mantém o comportamento atual de HEAD (`src/utils/static.ts:272-274`).

### Regra de cálculo de `resolveByteRange` (resumo)

Com `n = size`:

- `bytes=a-b`: se `a >= n` → `"unsatisfiable"`; senão `{ start: a, end: min(b, n - 1) }`.
- `bytes=a-`: se `a >= n` → `"unsatisfiable"`; senão `{ start: a, end: n - 1 }`.
- `bytes=-s`: se `s == 0` → `"unsatisfiable"`; se `s >= n` → `{ start: 0, end: n - 1 }`; senão `{ start: n - s, end: n - 1 }`.

Antes disso: sem header `Range`, `If-Range` mismatch, ou parse inválido → `undefined`.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Inserir `accept-ranges` em `:239-241`; inserir resolução de Range e 416 depois de `:270`; ajustar HEAD em `:272-274` e GET em `:276-277`; adicionar helpers privados no fim do arquivo (após `:351`, dentro de `// --- Internal Utils ---`, `:280`). |
| `test/static.test.ts` | Adicionar um novo `describeMatrix` ao final do arquivo (após `:678`). Não alterar testes existentes. |

Arquivos que **não** mudam: `src/index.ts` (RF-08), `src/response.ts`, `src/utils/internal/cache.ts`, `src/rules/cache.ts`, `test/unit/package.test.ts` (só é verificado, não alterado), `docs/`.

Documentação: `docs/4.examples/serve-static-assets.md` não muda (PRD: sem alteração de docs além de comentários de código). Um comentário de bloco acima de `resolveByteRange` explica a regra de If-Range e o motivo de ignorar multi-range, no mesmo estilo dos comentários de `src/utils/static.ts:124-169`.

---

## Estratégia de testes

Seguindo `AGENTS.md`: escrever os testes de regressão **antes** da implementação e confirmar que falham.

### Novo `describeMatrix` em `test/static.test.ts`

Nome: `"serve static range requests"`. Rodam nos dois alvos (web e node). Usar um asset determinístico de 1000 bytes, por exemplo `const body = "abcdefghij".repeat(100)`, com `getMeta` retornando `{ size: 1000, etag: "abc", mtime: 1_700_000_000_000, type: "text/plain" }` e `getContents` retornando `body`.

Casos (cada um mapeia para um RF do PRD):

| Caso | RF | Verificação |
| --- | --- | --- |
| GET sem Range | RF-01 | 200, `accept-ranges: bytes`, corpo completo |
| HEAD sem Range | RF-01 | 200, `accept-ranges: bytes`, sem corpo |
| 304 com If-None-Match batendo e Range | RF-06 | 304, sem corpo, `accept-ranges` presente |
| `bytes=100-199` | RF-02 | 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo = `body.slice(100, 200)` |
| HEAD `bytes=-50` | RF-02 | 206, `content-range: bytes 950-999/1000`, `content-length: 50`, sem corpo, `getContents` não chamado |
| `bytes=990-` | RF-02 | 206, `bytes 990-999/1000` |
| `bytes=900-5000` (fim maior) | RF-02 | 206, `bytes 900-999/1000` |
| `bytes=-5000` (sufixo maior) | RF-02 | 206, `bytes 0-999/1000`, corpo inteiro |
| `bytes=1000-1100` | RF-03 | 416, `content-range: bytes */1000`, `content-length: 0`, sem corpo |
| `bytes=-0` | RF-03 | 416 |
| `bytes=0-9,20-29` | RF-04 | 200 completo, sem `content-range` |
| `itens=0-9` | RF-04 | 200 completo |
| `bytes=5-2` (reversed) | RF-04 | 200 completo |
| `bytes=-` e `bytes=abc` | RF-04 | 200 completo |
| If-Range com etag diferente | RF-05 | 200 completo |
| If-Range com `"abc"` (ETag forte) | RF-05 | 206 bytes 0-9 |
| If-Range com ETag fraca (`W/"abc"` no meta) | RF-05 | 200 completo |
| If-Range com data igual a `last-modified` | RF-05 | 206 |
| If-Range com data diferente | RF-05 | 200 completo |
| POST com Range | RF-07 | 405, `allow: GET, HEAD` |
| Variante `.gz` com `accept-encoding: gzip` e Range | RF-07 | 206, `content-encoding: gzip`, `content-range` sobre o tamanho do `.gz` |
| Corpo `Blob` / `ArrayBuffer` / `Uint8Array` / `string` | D-05 | recorte exato em cada tipo |
| Corpo `ReadableStream` em pedaços de 7 bytes, range cruzando pedaços | D-05 | recorte exato, inclusive no início e no fim de um pedaço |
| `ReadableStream` com `cancel` espionado | D-05 | origem é cancelada após `end` (não lida até o fim) |
| Corpo não suportado (`URLSearchParams`) | D-05 | 200 completo |
| `size` ausente ou `0` com Range | D-06 | 200 completo, sem `content-range` |
| `options.headers` com `content-length: 999` em 206 | D-07 | `content-length` do 206 é o do intervalo |

Os testes de corpo devem usar `res.arrayBuffer()` ou `res.text()` e comparar com `body.slice(...)`, para evitar falso positivo.

### Testes existentes

- Nenhum teste existente envia `Range` (confirmado por grep em `test/static.test.ts`). Espera-se que continuem passando sem alteração.
- `test/static.test.ts:600-617` (content-length explícito em HEAD) deve continuar passando sem alteração.
- `test/static.test.ts:5-394`, `:396-523` (fallthrough) e `:525-` (MIME) devem continuar passando sem alteração.

### Verificação de superfície pública (RF-08)

- `test/unit/package.test.ts:133` já compara a lista de exportações. Rodar esse teste deve passar **sem alterar a lista**. Se a lista mudar, a implementação violou RF-08.

### Comandos

```bash
pnpm vitest run test/static.test.ts     # novos e existentes de static
pnpm vitest run test/security.test.ts   # usa serveStatic em guards de path
pnpm vitest run test/unit/package.test.ts
pnpm lint                               # oxlint + oxfmt --check
pnpm typecheck                          # tsc --noEmit
pnpm vitest run                         # suíte completa, antes de fechar
```

Ordem de execução: escrever os testes novos, rodar `pnpm vitest run test/static.test.ts` e confirmar que os novos falham pelo motivo esperado (200 em vez de 206/416, por exemplo). Só então implementar.

---

## Riscos

- **R-01 — recorte de `ReadableStream`.** Divergência deliberada do PRD (ver D-05). Leitura até `end` pode ser cara para seeks perto do fim de arquivos grandes. Mitigação: cancelar a origem em `end`, teste de cancelamento, e troca de uma linha para `200` se o time decidir pelo PRD.
- **R-02 — `meta.size` divergente do corpo.** Se `size` não bater com o que `getContents` devolve, `Content-Length` e `Content-Range` ficam errados, e a resposta é truncada ou excede o tamanho. Não há verificação sem ler o corpo. Mitigação: documentar no comentário de `ServeStaticOptions.getMeta` (`src/utils/static.ts:18-25`) que `size` é o número de bytes do corpo devolvido por `getContents`. Para `string`, o tamanho é o de `TextEncoder`, não `.length`; isso precisa estar no comentário também.
- **R-03 — comparação de ETag em If-Range.** Usar comparação fraca aqui devolveria partes de um arquivo que mudou. Mitigação: D-04 (ETag forte apenas, igualdade exata, `W/` nunca casa). Teste de ETag fraca na tabela acima.
- **R-04 — validade de data em If-Range.** RFC 9110 §13.1.5 exige que a data seja forte (ao menos 1 segundo anterior à data da resposta). Esta especificação aceita igualdade exata com `mtime` truncado. Risco baixo: um arquivo alterado no mesmo segundo de sua última modificação pode ser servido com Range errado num cliente que mandou a data. Aceito como simplificação; registrado para revisão.
- **R-05 — quebra de testes existentes.** Verificado: nenhum teste atual envia `Range`. Risco residual é zero para o conjunto atual, mas os testes de `test/security.test.ts` que usam `serveStatic` devem rodar.
- **R-06 — compatibilidade entre runtimes.** `Blob.slice`, `ReadableStream.cancel` e `TextEncoder` variam entre Node, Bun, Deno, Workers e navegadores. Mitigação: a matriz `describeMatrix` cobre web e node. Bun, Deno e Workers não entram nesta matriz; isso deve ser dito no PR.
- **R-07 — tamanho do arquivo.** `src/utils/static.ts` passa de ~350 para ~450 linhas, acima da meta de `AGENTS.md` (< 200 LoC). Decisão D-01 justifica. Se o revisor pedir, extrair para `src/utils/internal/range.ts` sem mudança de contrato.
- **R-08 — headers do usuário em 206.** `options.headers` com `content-length` ou `content-range` é sobrescrito em 206 e 416 (D-07). Documentar no PR. Não é um caso esperado de uso.
- **R-09 — cache de regras.** `src/rules/cache.ts:143-148` já ignora Range, então respostas parciais não entram no cache do `h3/rules/cache`. Nada muda, mas é um comportamento a manter em mente. Fora de escopo (PRD).
- **R-10 — `Accept-Ranges` em 304.** D-08 coloca o header também em 304, indo além da lista do PRD. Não afeta o contrato HTTP. Se a revisão preferir a lista exata, mover a linha para depois do bloco de cache.

---

## Pendências de decisão

Nenhuma pendência bloqueante. Três escolhas divergem do PRD e precisam de confirmação do revisor antes do merge:

1. D-05 / R-01: recorte de `ReadableStream` por leitura e cancelamento, em vez de `200` completo.
2. D-06 / R-04: tamanho zero mantém `200` completo, em vez de `416`.
3. D-08 / R-10: `Accept-Ranges` também em 304.
