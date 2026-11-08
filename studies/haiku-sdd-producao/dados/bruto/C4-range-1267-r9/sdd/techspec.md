# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-09) e o código em `master` (commit `f6893ff`). Este documento não altera código; ele fixa as decisões, os pontos de mudança e a estratégia de testes para a implementação.

## Resumo

- Toda a mudança fica em `src/utils/static.ts`, com helpers privados ao módulo. Nenhuma exportação nova em `src/index.ts`.
- Ordem de avaliação: validadores e 304 primeiro (como hoje), depois `Range`.
- Recorte feito sobre o `BodyInit` devolvido por `getContents`, somente para `string`, `Blob`, `ArrayBuffer` e views de bytes. Qualquer outro tipo (stream etc.) cai em 200 completo.
- Nenhum teste existente usa `Range` (conferido em `test/static.test.ts`), então nenhum teste atual precisa ser ajustado.

---

## Decisões de arquitetura

### D-01 — Onde ficam os helpers

**Escolha:** helpers de Range em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), depois de `idSearchPaths` (`src/utils/static.ts:340-351`).

**Alternativas consideradas:**
- `src/utils/internal/range.ts`: é o lugar que o `AGENTS.md` sugere para helpers internos e mantém o arquivo abaixo de 200 linhas.
- Helpers em `static.ts`: segue o contrato (`pedido.md`, "Restrições"; `prd.md` RF-08: "funções auxiliares ficam privadas em `src/utils/static.ts`").

**Justificativa:** o contrato é explícito e tem precedência. Um arquivo `internal/` também não seria exportado, então a API pública não mudaria nas duas opções. O custo é `static.ts` passar de 351 para cerca de 450 linhas, acima do guia de "< 200 LoC". **Decisão a confirmar** com o autor: manter em `static.ts` (recomendado, pelo contrato) ou mover para `utils/internal/range.ts`.

### D-02 — Ordem dentro de `serveStatic`

**Escolha:** o bloco de Range entra depois do cálculo de `content-length` (`src/utils/static.ts:268-270`) e antes do `HEAD` e de `getContents` (`src/utils/static.ts:272-277`). Os validadores (`etag`, `last-modified`) e o 304 (`src/utils/static.ts:239-248`) continuam antes.

**Justificativa:** RF-07 exige que `If-None-Match` resulte em 304 mesmo com `Range`. Também é a ordem da RFC 9110 §13.2.2 (condicionais antes de `Range`). Colocar o bloco depois de `content-type`, `content-encoding` e `content-length` faz com que 206 e 416 carreguem os mesmos cabeçalhos de representação que o 200.

### D-03 — Interpretação do cabeçalho `Range`

**Escolha:** aceitar apenas uma faixa, `bytes=<ini>-<fim>`, `bytes=<ini>-` ou `bytes=-<sufixo>`.
- Unidade comparada sem diferenciar maiúsculas (conferir RFC 9110 §14.1 na implementação).
- Espaços em torno de `=`, `-` e vírgulas não são aceitos (a gramática não os prevê). Uma vírgula sobrando é tolerada, pela regra de lista da RFC 9110 §5.6.1.
- Faixa com `fim < início` (ex.: `bytes=5-2`) é sintaxe inválida, então é ignorada e vira 200 completo. Não é 416.
- Sufixo `-0` é bem formado e não satisfazível, então vira 416.
- `fim` maior que o último byte é limitado a `size - 1`.
- Sufixo maior que o tamanho vira o asset inteiro (`bytes=-5000` com `size=1000` → `0-999`).
- Duas ou mais faixas não vazias → ignorar (200). Outra unidade → ignorar. Malformado → ignorar.

**Alternativas:** usar uma regex só para tudo; ou um parser que aceite espaços. A regex única é mais difícil de ler. Espaços foram descartados porque a RFC não os prevê e o contrato é restritivo.

### D-04 — `If-Range`

**Escolha:** `If-Range` ausente → ignorado. Presente:
- Se começar com `"` ou for ETag forte (sem `W/`), compara com o `etag` do asset por igualdade exata. `etag` ausente ou fraco (`W/...`) em qualquer lado → não casa.
- Se for data (HTTP-date), casa só com igualdade exata do `mtime` truncado em segundos (o mesmo `mtimeDate` de `src/utils/static.ts:227-232`).
- Não casou → ignora `Range` e responde 200 completo, mesmo que o intervalo fosse inválido.

**Risco da regra de data** (RFC 9110 §13.1.5): a data só é validador forte se o `Last-Modified` estiver pelo menos um segundo antes do `Date` da resposta. A implementação adotada faz só a igualdade exata. Ver R-03.

### D-05 — Recorte do corpo por tipo

**Escolha:** `getContents` continua devolvendo o `BodyInit` completo. O recorte é feito por tipo:

| Tipo de `BodyInit` | Recorte | Observação |
| --- | --- | --- |
| `string` | `new TextEncoder().encode(s).subarray(ini, fim + 1)` | Bytes UTF-8. `size` é contado em bytes; com `.length` em string não-ASCII o recorte sairia errado. |
| `Blob` (inclui `File`) | `blob.slice(ini, fim + 1)` | Preguiçoso: não carrega o arquivo inteiro na memória. |
| `ArrayBuffer` | `buf.slice(ini, fim + 1)` | |
| `ArrayBufferView` | `new Uint8Array(v.buffer, v.byteOffset, v.byteLength).subarray(ini, fim + 1)` | Respeita `byteOffset`. |
| `null` / `undefined` | não recortável | Comportamento atual (`src/utils/static.ts:277`). |
| `ReadableStream`, `FormData`, `URLSearchParams` | não recortável → 200 completo | **Decisão a confirmar (D-06).** |

### D-06 — Corpo em stream

**Escolha (recomendada pelo PRD, `prd.md` Riscos):** `ReadableStream` e outros tipos não recortáveis respondem 200 completo, sem `Content-Range`.

**Problema encontrado:** HEAD não chama `getContents` (RF-05), então não sabe se o corpo é stream. Um HEAD com `Range` responde 206, mas o GET do mesmo asset, se o corpo for stream, responde 200. Os cabeçalhos das duas respostas divergem.

**Alternativa:** recortar streams com um `TransformStream` que descarta bytes até `ini` e encerra em `fim`. Resolve a divergência, mas aumenta o código e precisa de testes próprios. **Decisão a confirmar** com o autor. Se a alternativa for recusada, o PRD precisa registrar a divergência HEAD/GET como aceita.

### D-07 — Tamanho e `Content-Length`

- `size` vem de `meta.size` do variant escolhido (`prd.md` Premissas). `size` ausente (`undefined`) → Range ignorado (RF-02).
- `size === 0` → qualquer faixa bem formada é 416 (RFC 9110 §14.1.1, premissa do PRD). Hoje `content-length` não é definido com `size` 0 (`src/utils/static.ts:268`), o que não muda.
- Em 206 o `Content-Length` é sempre sobrescrito com o tamanho do trecho (`set`, não o `if (!has)` de `src/utils/static.ts:268`). Um `content-length` vindo de `options.headers` não pode sobreviver a um 206, porque ficaria errado.
- Em 416 `Content-Length: 0` é definido explicitamente.

### D-08 — `Accept-Ranges`

**Escolha:** definir `accept-ranges: bytes` com o padrão `if (!has)` junto de `etag` (`src/utils/static.ts:239-241`), antes do 304. Assim ele também aparece no 304.

**Divergência:** RF-01 lista 200, 206 e 416, e não 304. Um 304 com `Accept-Ranges` é permitido pela RFC e fica consistente com `etag` e `last-modified`, que também saem no 304. **Decisão a confirmar.** Se o autor quiser o texto literal, mover a definição para depois do 304.

### D-09 — Compressão

Range vale para os bytes codificados do variant escolhido. `meta` já é o do variant (`src/utils/static.ts:198-208`), então `Content-Range` usa o `size` do `.gz` automaticamente. `Vary` continua vindo de `src/utils/static.ts:220-225`. Nada muda na seleção de encoding (`src/utils/static.ts:187-190`, `292-332`).

### D-10 — Cache (`h3/rules/cache`)

`src/rules/cache.ts:148` já ignora requisições com `Range` no cache do ocache. Não é preciso mudar nada. Consequência: cada `Range` vai até `serveStatic` e nunca grava um 206 como entrada do cache. Fica fora do escopo (`prd.md` Fora de escopo).

### D-11 — API pública

`src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Nenhum desses muda. Nenhum campo novo em `ServeStaticOptions` (`src/utils/static.ts:17-66`).

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Adicionar `accept-ranges` (perto de `src/utils/static.ts:239-241`); bloco de Range depois de `src/utils/static.ts:270`; ramo 206/416/HEAD/GET em `src/utils/static.ts:272-277`; helpers privados no fim do arquivo. |
| `test/static.test.ts` | Novos `describeMatrix` para Range (ver Estratégia de testes). Nenhum teste existente precisa mudar. |
| `docs/4.examples/serve-static-assets.md` | Opcional: uma linha dizendo que Range é suportado. Decidir na revisão. |

Não alterar: `src/index.ts`, `src/rules/cache.ts`, `src/response.ts`, `src/utils/internal/cache.ts`.

## Contratos e assinaturas (privados a `src/utils/static.ts`)

Nada disso é exportado.

```ts
/** Faixa única em bytes, inclusiva nos dois extremos. */
interface ByteRange {
  start: number;
  end: number;
}

/** Resultado de interpretar o `Range` contra o tamanho do asset. */
type RangeResolution =
  | { type: "ignore" } // 200 completo
  | { type: "partial"; range: ByteRange } // 206
  | { type: "unsatisfiable" }; // 416

/** Interpreta `Range` (D-03). `size` já é conhecido. */
function resolveRange(header: string, size: number): RangeResolution;

/** Avalia `If-Range` (D-04). */
function matchesIfRange(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/**
 * Recorta o `BodyInit` (D-05). Devolve `undefined` quando o tipo não é recortável,
 * e o chamador responde 200 completo.
 */
function sliceBody(body: BodyInit, range: ByteRange): BodyInit | undefined;
```

Esboço do ponto de chamada em `serveStatic` (depois de `src/utils/static.ts:270`):

```ts
const rangeHeader = event.req.headers.get("range");
const ifRange = event.req.headers.get("if-range");
let resolution: RangeResolution = { type: "ignore" };
if (
  rangeHeader &&
  meta.size !== undefined &&
  (ifRange === null || matchesIfRange(ifRange, { etag: meta.etag, lastModified: mtimeDate }))
) {
  resolution = resolveRange(rangeHeader, meta.size);
}

if (resolution.type === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (event.req.method === "HEAD") {
  if (resolution.type === "partial") return partialResponse(event, resolution.range, meta.size!);
  return new HTTPResponse(null, { status: 200 });
}

const contents = await options.getContents(id);
if (resolution.type === "partial") {
  const sliced = contents && sliceBody(contents, resolution.range);
  if (sliced !== undefined) return partialResponse(event, resolution.range, meta.size!, sliced);
}
return new HTTPResponse(contents || null, { status: 200 });
```

`partialResponse` (também privado) define `content-range: bytes ${start}-${end}/${size}` e `content-length: ${end - start + 1}`, e devolve `new HTTPResponse(body, { status: 206, statusText: "Partial Content" })`. O corpo é `null` em HEAD.

**Pontos a conferir na implementação:**
- `HTTPResponse` sem `status` herda `event.res.status` (`src/response.ts:96-125`). Por isso 206 e 416 passam `status` explicitamente.
- Os cabeçalhos de `event.res.headers` são mesclados na resposta final (`src/response.ts:201-204`). Os novos cabeçalhos entram por `event.res.headers.set`, como os demais.
- Em HEAD, `nullBody` remove o corpo (`src/response.ts:201` chama `nullBody(event.req.method, status)`).
- O `if (contents && ...)` cobre `null`/`undefined`: mantém o comportamento atual quando não há corpo.

## Estratégia de testes

Seguir o "Bug Fix Workflow" do `AGENTS.md`: escrever os testes antes da implementação e confirmar que falham (hoje todo Range recebe 200).

Local: `test/static.test.ts`, com `describeMatrix` (modos `web` e `node`, `test/_setup.ts:11`). Usar o padrão de `test/static.test.ts:5-40` (`t.app.all`, `t.fetch`). Criar um `describeMatrix("serve static range", ...)` separado.

Casos, por requisito:

| RF | Caso | Esperado |
| --- | --- | --- |
| RF-01 | GET e HEAD sem `Range` | 200, `accept-ranges: bytes` |
| RF-02 | `bytes=0-1,5-9`; `items=0-9`; `bytes=abc`; `bytes=5-2` | 200 completo, sem `content-range` |
| RF-02 | `getMeta` sem `size` com `bytes=0-9` | 200 completo |
| RF-03 | `bytes=0-499` em asset de 1000 bytes | 206, `bytes 0-499/1000`, `content-length: 500`, corpo exato |
| RF-03 | `bytes=500-`, `bytes=-200`, `bytes=-5000`, `bytes=900-5000` | 206 com os intervalos `500-999`, `800-999`, `0-999`, `900-999` |
| RF-04 | `bytes=1000-1500`; `bytes=-0`; qualquer faixa com `size: 0` | 416, `bytes */1000` (ou `*/0`), `content-length: 0`, corpo vazio |
| RF-05 | HEAD com `bytes=0-99` | 206, sem corpo, `getContents` com `toHaveBeenCalledTimes(0)` |
| RF-05 | HEAD com `bytes=1000-1500` | 416 |
| RF-06 | `If-Range` igual ao etag forte (`"abc"`) | 206 |
| RF-06 | `If-Range` diferente | 200 completo |
| RF-06 | `If-Range` com etag fraco (`W/"abc"`) ou com etag do asset fraco | 200 completo |
| RF-06 | `If-Range` com data igual ao `last-modified` | 206 |
| RF-06 | `If-Range` com data diferente | 200 completo |
| RF-06 | `If-Range` sem `Range` | 200 completo |
| RF-07 | `If-None-Match` igual + `Range` | 304 sem corpo |
| RF-07 | `app.js` com `app.js.gz` e `accept-encoding: gzip`, `bytes=0-9` | 206, `content-encoding: gzip`, `content-range` com o tamanho do `.gz` |
| RF-07 | Asset inexistente, `fallthrough: true`, `Range` | `serveStatic` retorna `undefined` |
| RF-07 | Asset inexistente, sem `fallthrough`, `Range` | 404 |
| RF-07 | Método `POST` com `Range` | 405, `allow: GET, HEAD` |
| D-05 | String com caracteres multibyte (ex.: `"ação"`) e `size` em bytes | recorte pelos bytes UTF-8 corretos |
| D-05 | `Blob`, `ArrayBuffer` e `Uint8Array` com `byteOffset` diferente de zero | recorte correto |
| D-06 | `ReadableStream` com `Range` | 200 completo |
| D-07 | `options.headers` com `content-length: 999` + `Range` | 206 com o tamanho do trecho |
| RF-08 | Exportações de `src/index.ts` | verificação manual com `git diff` (ver abaixo), sem teste de runtime |

Testes existentes: `grep` por `range` em `test/static.test.ts` não encontra nada. Nenhum teste existente precisa ser ajustado. Confirmar isso ao rodar a suíte.

Comandos de verificação (de `package.json:46` e `:54`):

```bash
pnpm vitest run test/static.test.ts   # RF-01 a RF-07, nos dois modos
pnpm lint                              # oxlint + oxfmt --check
pnpm typecheck                         # tsc --noEmit
git diff --stat -- src/index.ts        # deve estar vazio (RF-08)
```

## Riscos

- **R-01 — Divergência HEAD/GET com stream** (D-06). HEAD responde 206 e GET responde 200 para o mesmo asset de corpo stream. Decisão pendente.
- **R-02 — `meta.size` diferente dos bytes reais.** `Content-Range` e 416 usam `meta.size`. Se o `getMeta` do usuário informar o tamanho errado, o recorte também sai errado. Os testes atuais usam `.length` (`test/static.test.ts:17`), que é correto só para ASCII. Documentar que `size` é em bytes.
- **R-03 — Data em `If-Range`.** A RFC 9110 §13.1.5 só aceita data como validador forte quando `Last-Modified` é pelo menos um segundo anterior ao `Date`. A implementação faz só igualdade exata, então um asset modificado no mesmo segundo pode ser servido com Range de versão antiga. Risco baixo; documentar.
- **R-04 — Desempenho.** Strings são codificadas inteiras em UTF-8 a cada `Range`. Blob usa `slice` preguiçoso. O caso sem Range não muda (`src/utils/static.ts:277`). PRD pede que não piore o caso atual, e não piora.
- **R-05 — `content-length` vindo de `options.headers`.** Sobrescrito em 206 e 416 (D-07). Diferente do comportamento de hoje, mas necessário.
- **R-06 — `Accept-Ranges` no 304** (D-08). Diverge do texto literal do RF-01.
- **R-07 — Tamanho de `static.ts`** (D-01). Cerca de 450 linhas, acima do guia de 200.
- **R-08 — Segurança.** Nenhuma mudança em normalização de caminho (`src/utils/static.ts:142-185`) nem em `isCanonicalPath`. O recorte só age depois da resolução do asset.

## Pendências para o autor

1. D-06: streams em Range ficam em 200 (recomendado) ou recortam via `TransformStream`?
2. D-01: helpers em `static.ts` (pelo contrato) ou em `utils/internal/range.ts`?
3. D-08: `Accept-Ranges` também no 304 ou só em 200/206/416?
