# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato e issue) e `sdd/prd.md` (RF-01 a RF-11). Este documento define como implementar. Não altera código; a implementação vem depois.

## Resumo

- Tudo acontece dentro de `serveStatic` em `src/utils/static.ts`, com helpers privados no mesmo arquivo.
- Suporte a um único intervalo `bytes=` (`a-b`, `a-`, `-n`). Qualquer outro caso recebe `200` com o arquivo inteiro.
- O corte é feito depois de `getContents`, em bytes. Nenhuma opção nova, nenhuma exportação nova.
- Baseline medido: `pnpm vitest run test/static.test.ts` → 76 testes passando.

## Decisões de arquitetura

### D-01 — Local da implementação

**Decisão:** helpers de Range ficam em `src/utils/static.ts`, sem `export`, depois do marcador `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Alternativas consideradas:**
- `src/utils/internal/range.ts`, que é a convenção do `AGENTS.md` para helpers internos.

**Justificativa:** o `pedido.md` (linha 91) e o `prd.md` (RF-11) pedem helpers privados no módulo `static.ts`. Uma pasta `internal/` também não exporta nada, mas contraria o texto literal do contrato. O custo é o arquivo passar de ~350 para ~480 linhas, acima da meta de 200 LoC do `AGENTS.md`. Veja a pendência P-1.

### D-02 — Interpretação de `Range`

**Decisão:** parser manual com uma única expressão regular para `bytes=` com um intervalo. A unidade é comparada sem distinção de maiúsculas (RFC 9110, seção 14.1). Regras:

| Entrada | Resultado |
| --- | --- |
| Unidade diferente de `bytes`, formato inválido, `bytes=abc`, mais de um intervalo (`0-1,4-5`) | ignora `Range`, responde `200` |
| `a-b` com `b < a` (intervalo inválido na sintaxe) | ignora `Range`, responde `200` |
| `a-b`, `a-`, com `a >= size` | `416` |
| `-n` com `n = 0` ou `size = 0` | `416` |
| `-n` com `n > size` | `206` com o arquivo inteiro |
| `b >= size` | `206`, com `b` limitado a `size - 1` |

**Alternativas consideradas:**
- Biblioteca de parse de `Range`. Descartada: o núcleo tem só duas dependências de produção (`AGENTS.md`, "Minimal core").

**Justificativa:** a gramática para um único intervalo cabe em uma linha. Não há dependência nova.

### D-03 — Ordem na função `serveStatic`

**Decisão:** o bloco de Range entra depois de `content-length` (`src/utils/static.ts:268-270`) e antes do retorno de `HEAD` (`src/utils/static.ts:272`). A ordem final:

1. Método, canonicidade, busca do asset, `Vary`, `last-modified`, `etag` (sem mudança).
2. `isCacheMatch` → `304` (`src/utils/static.ts:243-248`, sem mudança). Por isso RF-08 vale sem código novo.
3. `content-type`, `content-encoding`, `content-length` (sem mudança).
4. `accept-ranges: bytes` só nas respostas `200`, `206` e `416` (RF-01). Não vai para a `304`.
5. Avaliação de `If-Range` e de `Range` (novo, D-05 e D-06).
6. `HEAD` e `200` como hoje.

**Justificativa:** RF-08 exige que `304` vença `Range`. Colocar o bloco depois de `content-length` deixa os cabeçalhos de conteúdo prontos para serem sobrescritos (D-05).

### D-04 — Corte do corpo em bytes

**Decisão:** `sliceBody(body, range)` trata cada tipo de `BodyInit` (`src/utils/static.ts`, função nova):

| Tipo | Tratamento |
| --- | --- |
| `string` | `new TextEncoder().encode(body)` e corte do `Uint8Array` |
| `ArrayBuffer`, `ArrayBufferView` | `subarray` (sem cópia) |
| `Blob` | `body.slice(start, end + 1)` (o `Blob` já é por bytes) |
| `ReadableStream` | novo `ReadableStream` que lê o original, descarta os bytes antes de `start`, repassa os bytes de `start` a `end`, cancela o original ao final |
| Demais (`FormData`, `URLSearchParams`) | `new Response(body).arrayBuffer()` e corte do resultado |

**Alternativas consideradas:**
- Materializar tudo com `new Response(body).arrayBuffer()`. Mais simples, mas um `ReadableStream` grande vira um buffer inteiro a cada `206`. O `prd.md` (Riscos, item 2) pede o descarte de bytes para o stream.
- Pular o tipo `FormData`/`URLSearchParams` e responder `416`. Não é honesto: o arquivo existe.

**Justificativa:** o caminho de `string`/bytes é síncrono e barato. O stream é o caso que o PRD exige tratar sem bufferizar tudo. A leitura inteira continua aceita para os demais tipos (PRD, Riscos, item 1).

### D-05 — Cabeçalhos de `206` e `416` vão por `event.res.headers`

**Decisão:** `Content-Range` e `Content-Length` de `206`/`416` são escritos com `event.res.headers.set(...)`, não no init do `HTTPResponse`. Isso sobrescreve um `Content-Length` vindo de `options.headers` (ou do evento), mas só nessas respostas.

**Por que:** na mesclagem final, os cabeçalhos do evento vencem os do `HTTPResponse`. `mergeHeaders(res.headers, preparedHeaders)` em `src/response.ts:203` e `mergeHeaders(val.headers, preparedHeaders)` em `src/response.ts:227` usam `preparedHeaders` (o `event.res.headers`) como `overrides`. Se o `Content-Length` de `206` ficasse no init, o `999` de `options.headers` venceria e o `206` sairia com tamanho errado. O teste em `test/static.test.ts:600-617` cobre o caso sem `Range` e continua valendo.

**Alternativas consideradas:**
- Passar os cabeçalhos no init do `HTTPResponse` e manter o `Content-Length` do usuário. Descartada: gera `206` inconsistente (PRD, Riscos, item 3).

**Mudança de comportamento:** só em respostas de intervalo, o `Content-Length` de `options.headers` deixa de valer. Registrado em R-4.

### D-06 — `If-Range`

**Decisão:** `If-Range` só é avaliado quando há `Range`. Ele corresponde quando:
- o valor começa com `"` (ETag forte) e é igual a `meta.etag`, byte a byte. ETag que começa com `W/` nunca corresponde; ou
- o valor é uma data igual a `mtimeDate` (`src/utils/static.ts:228-232`, já truncado em segundos).

Se não corresponde, o `Range` é ignorado e a resposta é `200` (RF-07). Se não existe `If-Range`, o intervalo se aplica.

**Alternativas consideradas:**
- Ignorar `If-Range`. Descartada: viola RF-07 e a RFC 9110, seção 13.1.5.
- Tratar ETag fraca como forte. Descartada: a RFC pede ETag forte (PRD, Riscos, item 6).

**Justificativa:** a checagem roda antes da validação do intervalo. Se `If-Range` não corresponde, nem um `416` acontece.

### D-07 — `getContents` vazio e leitura única

**Decisão:** para `GET` com intervalo válido, `getContents(id)` é chamado uma vez. Se o resultado for `null` ou `undefined`, a resposta segue como `200` de hoje, sem cabeçalhos de intervalo. Para `HEAD`, `getContents` não é chamado (como hoje, `src/utils/static.ts:272-274`). Para `416`, também não é chamado.

**Justificativa:** evita dois `getContents` para o mesmo `id`. Mantém o comportamento atual para assets sem corpo.

### D-08 — Tamanho zero

**Decisão:** arquivo com `meta.size === 0` é tamanho conhecido (PRD, premissa 6). Qualquer intervalo válido responde `416` com `bytes */0` e `Content-Length: 0`. O teste de `meta.size > 0` em `src/utils/static.ts:268` não muda, porque ele só controla o `Content-Length` do `200`.

## Arquivos a alterar

| Arquivo | Alteração | Referência no código |
| --- | --- | --- |
| `src/utils/static.ts` | Bloco de `Range`/`If-Range`/`accept-ranges` e três helpers privados | Inserção após `src/utils/static.ts:270`; antes de `src/utils/static.ts:272`; helpers após `src/utils/static.ts:280` |
| `test/static.test.ts` | Novo `describeMatrix` de Range | Após o último bloco (`test/static.test.ts:679`), ou antes de `describe("serve static (malformed url)")` (`test/static.test.ts:626`) |

Não alterar: `src/index.ts` (RF-11), `src/response.ts`, `src/utils/internal/cache.ts`, `ServeStaticOptions` (`src/utils/static.ts:17-66`), `test/unit/package.test.ts`.

Referências usadas e conferidas:

- `src/utils/static.ts:9-15` (`StaticAssetMeta`, `size`), `:17` (`ServeStaticOptions`), `:25` (`getMeta`), `:33` (`getContents`).
- `src/utils/static.ts:101` (`serveStatic`), `:116-122` (405), `:142-147` (canonicidade), `:210-215` (404).
- `src/utils/static.ts:239-248` (`etag` e `304`), `:250-266` (`content-type`, `content-encoding`), `:268-270` (`content-length`), `:272-277` (`HEAD`/`GET`).
- `src/utils/static.ts:283` (`WEIGHT_RE`, estilo de helper privado), `:292` (`parseAcceptEncoding`, referência de estilo), `:340-351` (`idSearchPaths`).
- `src/response.ts:96` (`HTTPResponse`), `:195` (status: o do `HTTPResponse` vence o de `event.res`), `:203` e `:227` (cabeçalhos do evento vencem), `:243` (`mergeHeaders`), `:350` (`nullBody`: `304`/`HEAD` sem corpo).
- `src/utils/internal/cache.ts:11` (`matchETag`), `:29` (`isCacheMatch`).
- `src/index.ts:193` (`export { ..., serveStatic } from "./utils/static.ts"`).
- `test/unit/package.test.ts:133` (`serveStatic` na lista de exportações).

## Contratos e assinaturas

Tudo abaixo é privado em `src/utils/static.ts`. Nenhum tipo novo é exportado.

```ts
type ByteRange = { start: number; end: number }; // inclusivo, em bytes

/**
 * `undefined`: ignora `Range` (200). `"unsatisfiable"`: responde 416.
 */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/**
 * `If-Range`: ETag forte igual a `etag`, ou data igual a `mtime` (já truncado em segundos).
 */
function isIfRangeMatch(value: string, validators: { etag?: string; mtime?: Date }): boolean;

/**
 * Recorta o corpo para o intervalo, em bytes (D-04).
 */
function sliceBody(body: BodyInit, range: ByteRange): Promise<BodyInit>;
```

Fluxo do bloco novo dentro de `serveStatic` (pseudocódigo, nomes de variáveis já existentes):

```ts
event.res.headers.set("accept-ranges", "bytes");

const rangeHeader = event.req.headers.get("range");
const ifRange = event.req.headers.get("if-range");
const rangeApplies =
  !!rangeHeader &&
  meta.size !== undefined &&
  (!ifRange || isIfRangeMatch(ifRange, { etag: meta.etag, mtime: mtimeDate }));

if (rangeApplies) {
  const range = parseRange(rangeHeader, meta.size);

  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }

  if (range && event.req.method === "HEAD") {
    // cabeçalhos de 206 + sem corpo
  }

  if (range) {
    const contents = await options.getContents(id); // D-07: uma leitura
    if (contents != null) {
      // cabeçalhos de 206 (content-range, content-length do trecho)
      return new HTTPResponse(await sliceBody(contents, range), { status: 206, statusText: "Partial Content" });
    }
  }
}

// HEAD e 200 como hoje; o 200 reutiliza `contents` quando já lido
```

Cabeçalhos de `206`: `content-range: bytes {start}-{end}/{size}` e `content-length: {end - start + 1}`. Cabeçalhos de `416`: `content-range: bytes */{size}` e `content-length: 0`. Os dois são escritos em `event.res.headers` (D-05).

Assinatura pública: nenhuma alteração em `serveStatic(event, options)` nem em `ServeStaticOptions`.

## Estratégia de testes

Os testes ficam em `test/static.test.ts`, em um novo `describeMatrix("serve static range", ...)`, para rodar em `web` e `node` (`test/_setup.ts`). Fixture: `getContents` devolve `"0123456789"`, `getMeta` devolve `size: 10`, `etag: '"abc"'`, `mtime` fixo.

Passo de regressão antes do código (PRD, Qualidade): rodar a suíte nova sem a mudança. Espera-se que falhem: RF-01, RF-02, RF-03, RF-04, RF-05 e RF-07 (caso que deve dar `206`). Espera-se que já passem, e servem de guarda: RF-06 (`200` hoje), RF-08 (`304` hoje), RF-09 (`200` hoje) e RF-10 (`404`/`405`).

Casos por requisito:

| Requisito | Casos |
| --- | --- |
| RF-01 | `GET` e `HEAD` sem `Range` → `accept-ranges: bytes` na `200`; `304` sem o cabeçalho |
| RF-02 | `bytes=2-5` → `206`, `bytes 2-5/10`, `content-length: 4`, corpo `2345` |
| RF-03 | `bytes=7-` e `bytes=-3` → `bytes 7-9/10`, corpo `789`; `bytes=8-100` → `bytes 8-9/10`; `bytes=-100` → `bytes 0-9/10` |
| RF-04 | `HEAD` com `bytes=2-5` → `206`, cabeçalhos certos, corpo vazio |
| RF-05 | `bytes=10-20` → `416`, `bytes */10`, `content-length: 0`; `bytes=-0` → `416`; `HEAD` com `416` |
| RF-06 | `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2` → `200` completo, sem `content-range`; `BYTES=0-1` → `206` |
| RF-07 | `If-Range: "xyz"` → `200`; `If-Range: "abc"` → `206`; `If-Range: W/"abc"` → `200`; `If-Range` com a data igual a `last-modified` → `206`; data diferente → `200` |
| RF-08 | `If-None-Match: "abc"` + `Range` → `304` sem corpo |
| RF-09 | `getMeta` sem `size` + `Range` → `200` completo |
| RF-10 | asset inexistente + `Range` com `fallthrough` desligado → `404`; `POST` + `Range` → `405` com `allow: GET, HEAD` |
| RF-11 | `test/unit/package.test.ts` (lista de exportações) continua igual. Conferir antes de depender: o teste precisa comparar a lista inteira |

Casos adicionais, sem RF próprio, mas exigidos pela PRD (Riscos):

- Encoding (PRD, Riscos, item 7): `GET /app.js` com `accept-encoding: gzip` e `Range` → `206` com bytes do variante `.gz` e `content-encoding: gzip`.
- Corte em bytes (D-04): string `"açaí"` (bytes UTF-8 diferentes de caracteres) com intervalo que cai no meio de um caractere multibyte.
- `ReadableStream` com chunks que cruzam o início e o fim do intervalo (`"01"`, `"2345"`, `"6789"`).
- `Blob` com intervalo.
- `Content-Length` do usuário (`options.headers: { "content-length": "999" }`) + `Range` → `206` com o tamanho do trecho (D-05).
- Arquivo de tamanho `0` + qualquer intervalo → `416` com `bytes */0`.
- `getContents` devolvendo `undefined` + `Range` → `200` sem cabeçalhos de intervalo (D-07).

A API de helpers não é testada direto: eles não são exportados (RF-11). Tudo é testado pela resposta HTTP.

Verificação final: `pnpm vitest run test/static.test.ts`, `pnpm vitest run` (suíte completa), `pnpm lint` e `pnpm typecheck` (exigidos em `sdd/prd.md`).

## Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-1 | Cada `206` lê o arquivo inteiro (`getContents` não aceita offset). Memória e CPU crescem com vídeos grandes. | Aceito pelo PRD. Medir antes de fechar: arquivo de 50 MB com 100 `206` seguidos. Registrar o número na descrição do PR. |
| R-2 | `ReadableStream` não cancelado quando o intervalo termina, deixando a fonte aberta. | `cancel` no stream de origem ao chegar em `end`. Teste de corte de stream (acima). |
| R-3 | `meta.size` diferente do conteúdo real. `Content-Range` e corpo ficam inconsistentes. | Sem detecção possível sem leitura (PRD, Riscos, item 5). Documentar na descrição de `getMeta`. |
| R-4 | Em respostas de intervalo, o `Content-Length` de `options.headers` deixa de valer. | Mudança intencional (D-05). Cobrir com teste. Confirmar com o mantenedor antes de mesclar. |
| R-5 | `FormData` e `URLSearchParams` geram bytes com tamanho diferente de `meta.size`. | Caso raro. Mesmo risco de R-3. |
| R-6 | `If-Range` com data: comparação exata com `mtimeDate` truncado. Clientes que enviam data com outra precisão não batem. | Igual à regra de `If-Modified-Since` já existente (`src/utils/static.ts:230-232`). Aceito. |
| R-7 | `statusText` `"Partial Content"` e `"Range Not Satisfiable"` passam por `sanitizeStatusMessage` (`src/response.ts:200`). | Textos fixos e sem caracteres de controle. Sem ação. |
| R-8 | Arquivo passa de 200 LoC (`AGENTS.md`). | Ver P-1. |

## Pendências

- **P-1:** o `AGENTS.md` pede arquivos de até 200 LoC, e `src/utils/static.ts` ficará perto de 480 linhas. O `pedido.md` e o `prd.md` pedem os helpers em `static.ts`. Decidir: manter em `static.ts` (recomendado, segue o contrato) ou mover os helpers para `src/utils/internal/range.ts` sem exportação pública.
- **P-2:** confirmar com o mantenedor a mudança de precedência de `Content-Length` em respostas de intervalo (R-4).
- **P-3:** a suíte ainda não foi rodada com os testes novos. O baseline de `test/static.test.ts` está verde (76 testes). `pnpm lint` e `pnpm typecheck` não foram executados nesta etapa.
