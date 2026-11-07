# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue e contrato enxuto) e `sdd/prd.md` (requisitos RF-01 a RF-11). Este documento define como implementar, sem repetir os requisitos.

## 1. Resumo

`serveStatic` passa a responder `Accept-Ranges`, `206 Partial Content` e `416 Range Not Satisfiable` para `GET` e `HEAD`. A lógica nova fica em um módulo interno. Nenhuma exportação pública é criada e nenhum teste existente precisa mudar.

## 2. Estado atual (conferido no código)

- Ordem atual dentro de `serveStatic`: cabeçalhos customizados (`src/utils/static.ts:105-114`), 405 (`:116-122`), canonicidade do caminho (`:142-147`), `getMeta` (`:200-208`), 404 (`:210-215`), `Vary` (`:220-225`), `Last-Modified` e `ETag` (`:227-241`), 304 (`:243-248`), `Content-Type`, `Content-Encoding` e `Content-Length` (`:250-270`), HEAD (`:272-274`), `getContents` (`:276-277`).
- Não há tratamento de `Range`, `If-Range`, `Accept-Ranges` ou `Content-Range` em `src/`. A única menção a Range é `src/rules/cache.ts:143-148`, que já ignora cache para requisições com `Range`.
- Na montagem da resposta, `event.res.headers` vence os cabeçalhos do `HTTPResponse` (`src/response.ts:201-204` e `:243-252`).
- `Content-Length` só é definido quando `meta.size > 0` (`src/utils/static.ts:268`) e não sobrescreve valor já presente. `test/static.test.ts:600` cobre esse caso para 200.
- Já existe precedente de helpers de cache em `src/utils/internal/cache.ts`, importados por `static.ts:6`.

## 3. Decisões de arquitetura

### D-01 — Onde ficam os helpers de Range

**Decisão:** o parsing do `Range`, a validação de `If-Range` e o fatiamento do corpo ficam em `src/utils/internal/range.ts`. `static.ts` só chama esses helpers e monta a resposta.

**Alternativas:**
- (a) Helpers no fim de `src/utils/static.ts`. É o que a issue descreve ("helpers privados dentro do módulo"), mas o arquivo já tem 351 linhas.
- (b) Novo arquivo exportado por `src/index.ts`. Descartada, porque viola a restrição de API pública.

**Justificativa:** `AGENTS.md` manda pôr helpers internos em `utils/internal/` e manter arquivos abaixo de 200 linhas. A opção (a) aumentaria um arquivo que já passa desse limite. Nada novo é exportado, e o snapshot de exports em `test/unit/package.test.ts:4` impede exportações acidentais.

*Ponto a confirmar: a leitura de "privado dentro do módulo" da issue.*

### D-02 — Ordem de avaliação

**Decisão:** condicionais de cache (304) → `If-Range` → `Range` → corpo. O 304 já existe em `src/utils/static.ts:243-248`. Se o `If-Range` não casar, o servidor ignora o `Range` e responde 200 completo.

**Alternativa:** avaliar `Range` antes do 304. Descartada: a RFC 9110 §13.2.2 define que as pré-condições de cache têm precedência sobre `Range`.

### D-03 — Interpretação do cabeçalho `Range`

**Decisão:**
- Regex estrita: `^bytes=(\d*)-(\d*)$`, com a unidade sem diferença entre maiúsculas e minúsculas e espaços externos aparados.
- Ignorado (200 completo): formato inválido, unidade diferente de `bytes`, mais de um intervalo separado por vírgula e intervalo invertido (`last < first`).
- 416: o único intervalo é insatisfazível. Isso acontece quando `first >= size`, quando o sufixo é `-0` ou quando `size === 0`.
- `last` acima do tamanho é limitado a `size - 1`. Sufixo maior que o arquivo começa em `0`.

**Alternativas:** multipart/byteranges (fora de escopo, PRD) e aceitar espaços em volta do `-` (não faz parte da gramática da RFC).

**Justificativa:** a RFC 9110 §14.2 permite ignorar `Range`. A issue pede que formatos malformados e múltiplos sejam ignorados.

### D-04 — Validação de `If-Range`

**Decisão:**
- Se o valor começa com `"` ou `W/`, é tratado como entity-tag. Casa somente se o `etag` do asset não for fraco (sem `W/`) e for idêntico, caractere por caractere.
- Caso contrário, é tratado como data HTTP. Casa se for uma data válida e igual ao `lastModified` do asset. A comparação usa segundos, porque o `mtimeDate` já é truncado em `src/utils/static.ts:232`.

**Alternativas:** ignorar `If-Range` sempre (viola RFC 9110 §13.1.5) e comparar a data com precisão de milissegundos (nunca casaria com o `Last-Modified` truncado).

**Risco aceito:** a RFC exige que o validador de data seja forte (`Last-Modified` pelo menos 1 s antes de `Date`). Esta implementação não faz essa checagem. Ver §7.

### D-05 — `Range` sobre a representação codificada

**Decisão:** o intervalo é aplicado à variante escolhida (`.gz`, `.br` etc.). `Content-Encoding` é mantido no 206. Isso segue a RFC 9110 §14, em que o intervalo se aplica aos dados da representação, e o RF-10 do PRD.

**Alternativa:** ignorar `Range` em respostas com `Content-Encoding`, opção que o PRD deixou em aberto. É mais simples, mas impede seek em arquivos `.gz`/`.br` pré-comprimidos, justamente o caso de vídeo e download retomável que a issue quer resolver.

*Pendente de confirmação.*

### D-06 — Fatiamento do corpo

**Decisão:** `sliceBody` trata cada tipo de forma diferente:
- `string`: codifica em UTF-8 com `TextEncoder` e fatia em bytes. Índice de caractere não é índice de byte.
- `Blob`: `blob.slice(start, end + 1)`, sem ler o conteúdo.
- `ArrayBuffer` e `ArrayBufferView`: fatia sobre os bytes.
- `ReadableStream` e demais `BodyInit` (`FormData`, `URLSearchParams`, iteráveis): `new Response(body).body` seguido de um `TransformStream` que descarta os bytes antes de `start` e encerra ao chegar em `end`.

**Alternativas:**
- (a) Ler tudo em `ArrayBuffer` e depois fatiar. É simples, mas copia o arquivo inteiro na memória a cada seek.
- (b) Ignorar `Range` para streams, o que a RFC permite. Descartada, porque stream é o caso típico de arquivo grande em disco.

**Custo:** streams leem e descartam `start` bytes. Um seek perto do fim de um arquivo grande custa I/O proporcional a `start`. Isso deve ser documentado no JSDoc.

### D-07 — `Accept-Ranges`

**Decisão:** `accept-ranges: bytes` vai em toda resposta de asset encontrado que não seja 304: 200, 206 e 416. Isso vale também quando `size` é desconhecido, seguindo o RF-01 e a issue ("Always advertise"). Não aparece em 304, 404, 405 nem em fallthrough.

**Alternativa:** anunciar só quando `size` é conhecido. Evitaria anunciar algo que não será cumprido no caso do RF-09, mas contraria o texto "sempre" da issue.

*Pendente de confirmação.*

### D-08 — Cabeçalhos do intervalo usam `event.res.headers.set`

**Decisão:** `Content-Length`, `Content-Range` e `Accept-Ranges` são definidos com `event.res.headers.set(...)`, e não com `new HTTPResponse(_, { headers })`.

**Motivo:** `toResponse` mescla `event.res` por último (`src/response.ts:201-204`, `:243-252`). Um `Content-Length` já presente, vindo de `ServeStaticOptions.headers` ou de middleware, venceria o do `HTTPResponse`. O `set` também sobrescreve o `Content-Length` definido em `src/utils/static.ts:268-270`, o que é intencional em 206 e 416. No 200 sem Range, o comportamento de `test/static.test.ts:600` permanece.

### D-09 — Não ler o corpo quando ele não será enviado

**Decisão:** em HEAD com Range, e em 416, `getContents` não é chamado. Só o GET com 206 lê o corpo.

**Justificativa:** o PRD marca isso como risco (leitura desnecessária). Responder antes evita I/O.

### D-10 — Asset de tamanho zero

**Decisão:** com `size: 0` e um Range válido, a resposta é 416 com `Content-Range: bytes */0`. Sem Range, o comportamento é o de hoje: 200, sem `Content-Length`, porque `meta.size > 0` (`src/utils/static.ts:268`) continua valendo.

**Justificativa:** RFC 9110 §14.1.1, citada no PRD.

*Pendente de confirmação, conforme o PRD.*

## 4. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts:1-7` | Importar `resolveByteRange` e `sliceBody` de `./internal/range.ts`. |
| `src/utils/static.ts:270-277` | Inserir `accept-ranges`, a avaliação de Range, a resposta 416 e a resposta 206 (HEAD e GET) entre o bloco de `Content-Length` (`:268-270`) e o HEAD (`:272-274`). |
| `src/utils/static.ts:68-100` | Documentar `Range` e `Accept-Ranges` no JSDoc de `serveStatic`. |
| `src/utils/internal/range.ts` | **Novo.** Helpers descritos em §5. |
| `test/unit/range.test.ts` | **Novo.** Testes unitários dos helpers. |
| `test/static-range.test.ts` | **Novo.** Testes de integração com `describeMatrix`. |
| `docs/2.utils/2.response.md:39` | Gerado pelo automd a partir do JSDoc. Rodar `pnpm fmt`, não editar à mão. |

Sem alteração:
- `src/index.ts:193`: nenhuma exportação nova.
- `src/rules/cache.ts:143-148`: já ignora Range.
- `test/static.test.ts`: nenhum teste existente depende do que muda. O teste de `Content-Length` em `:600` continua válido para 200.
- `ServeStaticOptions` (`src/utils/static.ts:17-66`) e `StaticAssetMeta` (`:9-15`).

Proposta de fluxo em `src/utils/static.ts`, depois do bloco de `Content-Length` (`:270`):

```ts
event.res.headers.set("accept-ranges", "bytes");

const range =
  meta.size === undefined
    ? undefined
    : resolveByteRange(event.req.headers, {
        size: meta.size,
        etag: meta.etag,
        lastModified: mtimeDate,
      });

if (range?.type === "unsatisfiable") {
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
  return new HTTPResponse(sliceBody(contents, range), { status: 206, statusText: "Partial Content" });
}
```

## 5. Contratos e assinaturas

Contratos públicos sem mudança:

```ts
// src/utils/static.ts:101-104
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Módulo interno novo, não exportado por `src/index.ts`:

```ts
// src/utils/internal/range.ts

/** Intervalo em bytes, com início e fim inclusivos. */
export type ByteRange = { type: "partial"; start: number; end: number };

export type ByteRangeResult = ByteRange | { type: "unsatisfiable" };

/**
 * Retorna `undefined` quando a resposta deve ser completa: sem `Range`, `Range`
 * inválido, múltiplo ou de outra unidade, ou `If-Range` que não casa.
 */
export function resolveByteRange(
  headers: Headers,
  validators: { size: number; etag?: string; lastModified?: Date },
): ByteRangeResult | undefined;

/** Fatia o corpo pelos bytes `[start, end]`. Retorna `null` quando não há corpo. */
export function sliceBody(
  body: BodyInit | null | undefined,
  range: Pick<ByteRange, "start" | "end">,
): BodyInit | null;
```

Helpers privados do módulo (não exportados): `parseRangeHeader(value, size)`, `matchesIfRange(value, validators)` e `sliceStream(stream, start, endExclusive)`.

Respostas do `serveStatic` depois da mudança:

| Situação | Status | Cabeçalhos | Corpo |
| --- | --- | --- | --- |
| Cache casa | 304 | como hoje, sem `Accept-Ranges` | vazio |
| Sem `Range` ou `Range` ignorado | 200 | `Accept-Ranges`, `Content-Length` = `size` | completo |
| `Range` válido | 206 | `Accept-Ranges`, `Content-Range: bytes s-e/size`, `Content-Length` | trecho (vazio em HEAD) |
| `Range` insatisfazível | 416 | `Accept-Ranges`, `Content-Range: bytes */size`, `Content-Length: 0` | vazio |
| Asset inexistente, método não permitido, fallthrough | inalterado | inalterado | inalterado |

## 6. Estratégia de testes

Seguir o fluxo de correção de bug do `AGENTS.md`, adaptado para funcionalidade: escrever os testes, confirmar que falham, implementar, confirmar que passam.

1. **`test/unit/range.test.ts`** (unitário, sem matriz, como em `test/unit/`), com tabelas:
   - Parsing válido: `bytes=0-499`, `bytes=900-`, `bytes=-100`, `BYTES=0-1`.
   - Ignorados (resultado `undefined`): `bytes=abc`, `bytes=0-1,5-9`, `items=0-4`, `bytes=5-3`, `bytes=-`, `bytes=+1-2`.
   - Limites: `bytes=0-5000` com `size` 1000 vira `0-999`. `bytes=-5000` vira `0-999`.
   - Insatisfazíveis: `bytes=1000-`, `bytes=-0`, `bytes=0-` com `size` 0.
   - `If-Range`: `"abc"` casa com `etag: "abc"`. `W/"abc"` nunca casa. Data igual ao `lastModified` casa. Data diferente não casa. Sem `If-Range`, o `Range` é aplicado.
   - `sliceBody`: `Uint8Array`, `ArrayBuffer`, `Blob`, `string` com caractere multibyte (`"é"` ocupa 2 bytes), `ReadableStream` com chunks que cruzam o início e o fim do intervalo.

2. **`test/static-range.test.ts`** (`describeMatrix`, web e node), cobrindo RF-01 a RF-11 com um asset de 1000 bytes. O conteúdo é `Uint8Array` com `i % 256`, para conferir os bytes exatos. Casos adicionais:
   - `getContents` não é chamado em HEAD nem em 416 (`vi.fn`).
   - `Content-Length` vindo de `ServeStaticOptions.headers` é sobrescrito em 206.
   - Corpo como `string`, `Blob` e `ReadableStream` em 206.
   - `size: 0`: 416 com Range e 200 sem Range.
   - Fixtures de `If-Range` usam ETag entre aspas (`"abc"`). Os fixtures existentes usam `"w/123"`, que não é um entity-tag válido, e não devem ser alterados.

3. **Regressão:** `test/static.test.ts` inteiro sem alterações, `test/rules/cache.test.ts` e `test/unit/package.test.ts` devem continuar verdes.

4. **Verificação final:**
   - `pnpm vitest run test/static.test.ts test/static-range.test.ts test/unit/range.test.ts test/unit/package.test.ts`
   - `pnpm lint` e `pnpm typecheck`
   - `pnpm test` (suíte completa com cobertura)
   - `git diff -- src/index.ts` vazio

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Stream grande com seek | I/O proporcional a `start`, mesmo com o descarte em `TransformStream`. | Documentar no JSDoc. Assets que retornam `Blob` ou `Uint8Array` não têm esse custo. |
| `If-Range` por data com precisão de segundo | Um arquivo alterado dentro do mesmo segundo pode casar com o `If-Range` e gerar 206 de conteúdo novo. | Aceitar e documentar. Alternativa futura: exigir `mtime` anterior a `now - 1s`. |
| Cache intermediário guardando 206 | Uma CDN ou cache de rules poderia guardar resposta parcial. | `src/rules/cache.ts:143-148` já ignora Range. Cache de terceiros está fora de escopo. |
| `Content-Encoding` com Range | Clientes que esperam bytes decodificados recebem trechos de dados comprimidos. | Decisão D-05. Confirmar antes de implementar. |
| `Content-Length` de `options.headers` | Valor errado em 206 se não for sobrescrito. | D-08: `set` em 206 e 416, com teste dedicado. |
| Fixtures com ETag inválido (`"w/123"`) | Testes de `If-Range` com resultado enganoso. | Usar ETag entre aspas nos testes novos. |
| Diferenças entre runtimes (`Blob`, `ReadableStream`) | Comportamento diferente em Bun, Deno e Workers. | Usar só APIs web. A matriz cobre web e node, mas não Bun, Deno nem Workers. |
| Export acidental de helper | Quebra da restrição de API pública. | `test/unit/package.test.ts:4` (snapshot) e revisão de `src/index.ts` no diff. |
| Observação fora de escopo | `src/utils/static.ts:214` usa `statusCode` (deprecado), enquanto `:146` usa `status`. | Não alterar nesta mudança. Registrar para depois. |

## 8. Pendências para confirmar antes de implementar

1. **D-05:** `Content-Encoding` com Range. Recomendação: manter a semântica da RFC (intervalo sobre a variante escolhida).
2. **D-10:** `size: 0` com Range retorna 416. Recomendação: sim, conforme RFC 9110 §14.1.1.
3. **D-01:** local dos helpers (`src/utils/internal/range.ts` ou dentro de `static.ts`). Recomendação: `utils/internal/`.
4. **D-07:** `Accept-Ranges` quando `size` é desconhecido. Recomendação: sempre, conforme a issue.
