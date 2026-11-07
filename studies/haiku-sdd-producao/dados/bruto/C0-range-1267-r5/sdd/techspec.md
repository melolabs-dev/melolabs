# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Documento derivado de `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-11). Norma: RFC 9110 §13.1.5 e §14. As citações `arquivo:linha` foram conferidas no código atual (commit `e54b07e`).

## 1. Visão geral

Toda a mudança fica em `src/utils/static.ts`. Nada novo em `src/index.ts`, `ServeStaticOptions` nem `StaticAssetMeta`. Os auxiliares entram na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

Fluxo novo dentro de `serveStatic`, a partir do ponto onde hoje já existe `meta`:

1. Cabeçalhos de validação (`last-modified`, `etag`) e avaliação de `304`, sem alteração (`src/utils/static.ts:227-248`).
2. **Novo:** `accept-ranges: bytes` com `set`.
3. **Novo:** `resolveRange()` decide entre `ignore` (200 completo), `satisfiable` (206) e `unsatisfiable` (416).
4. `416`: remove `content-type`/`content-encoding`, define `content-range: bytes */size` e `content-length: 0`, devolve resposta sem corpo.
5. `content-type`, `content-encoding` e `content-length` como hoje (`src/utils/static.ts:250-270`).
6. `HEAD` (`src/utils/static.ts:272-274`): devolve `206` só com cabeçalhos quando houver intervalo; senão `200` como hoje.
7. `GET` (`src/utils/static.ts:276-277`): chama `getContents`; com intervalo e conteúdo fatiável devolve `206` com o corpo fatiado; caso contrário o `200` de hoje.

## 2. Decisões de arquitetura

### D-01 — Onde avaliar o `Range` na sequência de `serveStatic`

**Contexto.** O `304` precisa vencer o `Range` (RF-07), e o `If-Range` precisa dos validadores já gravados em `event.res.headers`.

**Alternativas.**
- (a) Avaliar `Range` antes do bloco de cache. Rejeitada: viola RF-07 e exigiria duplicar o cálculo de `last-modified`/`etag`.
- (b) Avaliar depois do `304` (`src/utils/static.ts:243-248`) e antes do bloco de `content-type` (`src/utils/static.ts:250`).
- (c) Avaliar no fim, imediatamente antes de `getContents`. Rejeitada: o `416` já teria gravado `content-type`/`content-encoding`, que RF-04 manda não enviar.

**Escolha: (b).** O `304` continua intacto, os validadores já existem e o `416` sai antes de qualquer cabeçalho de representação ser gravado. `accept-ranges` é definido logo após o `304`, de modo que `304`, `404`, `405` e fallthrough (que retornam antes) nunca o recebem (RF-01).

### D-02 — Helpers privados, sem novo arquivo e sem exportação

**Alternativas.**
- (a) Criar `src/utils/internal/range.ts`. Atende a regra de "arquivos curtos", mas o pedido diz "manter a lógica auxiliar privada dentro do módulo serveStatic" e RF-10 manda os auxiliares em `src/utils/static.ts`, seção `Internal Utils`.
- (b) Funções não exportadas em `src/utils/static.ts`.

**Escolha: (b)**, conforme o pedido e RF-10. O arquivo passa de ~350 para ~520 linhas, acima da meta de 200 LoC do AGENTS.md; isso é aceito explicitamente porque o pedido prevalece (ver risco R-08). Nenhum símbolo novo em `src/index.ts:193` (linha que reexporta `serveStatic`, `ServeStaticOptions`, `StaticAssetMeta`); `test/unit/package.test.ts` segue verde.

### D-03 — Parser de `Range` estrito por regex, ignorando o que não for um intervalo simples

**Alternativas.**
- (a) Parser tolerante que extrai o primeiro intervalo de uma lista. Rejeitada: o pedido manda ignorar multi-intervalo e servir o corpo inteiro.
- (b) Regex única: `/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i` (apenas dígitos; a flag `i` torna a unidade insensível a caixa).

**Escolha: (b).** Rejeita por construção sinais, decimais, listas (vírgula), `bytes=5`, `bytes=--1` e outras unidades. Regras adicionais após o casamento:

- ambos os grupos vazios (`bytes=-`): ignorar;
- número com `Number.isSafeInteger` falso: ignorar (nem 206 nem 416 com valor incorreto);
- `a-b` com `b < a`: ignorar (RFC 9110 §14.1.2);
- sufixo `-n`: `n = 0` → insatisfatível; `n >= size` → `0..size-1`; senão `size-n..size-1`;
- `a-` / `a-b`: `a >= size` → insatisfatível; fim = `min(b, size-1)`;
- `size === 0` com qualquer intervalo válido: insatisfatível (RF-04).

### D-04 — "Tamanho conhecido" e `Accept-Ranges`

`size` conhecido = `Number.isInteger(meta.size) && meta.size >= 0` (RF-09). Sem isso, `resolveRange` retorna `ignore`. `Accept-Ranges: bytes` é enviado sempre que o asset é encontrado em `GET`/`HEAD`, mesmo com tamanho desconhecido (premissa do PRD, "Always advertise" da issue). O risco de anunciar sem poder atender fica registrado em R-02; a decisão de restringir o anúncio é do solicitante e não é tomada aqui.

Observação: o `content-length` de hoje só é definido com `size > 0` (`src/utils/static.ts:268`). Isso fica igual para `200`; `size: 0` sem `Range` continua sem `content-length`.

### D-05 — `If-Range` comparado contra os validadores realmente enviados

**Alternativas.**
- (a) Comparar com `meta.etag`/`mtimeDate`. Rejeitada: o `etag`/`last-modified` efetivos podem vir de `options.headers` ou de um middleware (`src/utils/static.ts:234` e `:239` só gravam se ausentes); o cliente viu o valor da resposta.
- (b) Comparar com `event.res.headers.get("etag")` e `get("last-modified")`.

**Escolha: (b).** Regras (RFC 9110 §13.1.5):

- valor de `If-Range` que começa com `"` ou `W/` é entity-tag: só confere se **nenhum dos dois lados** começa com `W/` (a verificação de `W/` é sensível a caixa, conforme a RFC) e se as strings são idênticas;
- demais valores são tratados como data: confere se a string (com `trim`) é idêntica à de `last-modified` da resposta;
- sem validador correspondente na resposta, ou sem conferir: `ignore` (200 completo);
- `If-Range` sem `Range`: nem é lido.

Consequência para os testes existentes: eles usam `etag: "w/123"` (minúsculo, `test/static.test.ts:15`). Para o `If-Range` forte usar um asset com `etag: '"abc"'`, como no critério de RF-06.

### D-06 — Fatiamento do corpo por tipo, usando só APIs web

`sliceBody(contents, start, end)` devolve `BodyInit | undefined` (`undefined` = tipo não fatiável).

| Tipo de `getContents` | Estratégia |
| --- | --- |
| `string` | `new TextEncoder().encode(s).subarray(start, end + 1)` (o `size` é em bytes, não em caracteres) |
| `Uint8Array` / `ArrayBufferView` | `new Uint8Array(v.buffer, v.byteOffset + start, len)`, respeitando `byteOffset` |
| `ArrayBuffer` | `new Uint8Array(buf, start, len)` |
| `Blob` / `File` | `blob.slice(start, end + 1)` (não carrega tudo) |
| `ReadableStream` | `ReadableStream` novo que lê e descarta `start` bytes, repassa até `len` bytes e chama `reader.cancel()` ao terminar |
| `FormData`, `URLSearchParams`, demais | `undefined`: serve o `200` completo (tamanho dos bytes serializados desconhecido) |

`len = end - start + 1`; em buffers o comprimento é limitado ao que existe (`Math.min`) para não lançar `RangeError` se `size` divergir (R-04).

**Alternativas para o stream.** (a) `TransformStream` — mais código para o descarte e cancelamento; (b) `ReadableStream` com `pull` manual — escolhida, pois permite cancelar a origem ao fim do intervalo. Não se usa `Buffer` nem `fs` (compatibilidade com Workers, Deno e Bun).

**`null`/`undefined`.** Mantém o comportamento de hoje (`new HTTPResponse(null, { status: 200 })`, `src/utils/static.ts:277`), sem `206` (RF-11).

### D-07 — Cabeçalhos do `206`/`416`: `set` e precedência do `content-length`

- `accept-ranges`, `content-range` e (em 206/416) `content-length` usam `event.res.headers.set`, nunca `append`, para não duplicar valores vindos de `options.headers` ou de middleware.
- Em `206`/`416` o `content-length` calculado **sobrepõe** um `content-length` pré-existente (mudança deliberada, PRD R-"content-length pré-definido"). Em `200` o teste `test/static.test.ts:600-617` continua valendo, porque o ramo `ignore` não toca no `content-length`.
- O `206`/`416` é devolvido via `new HTTPResponse(body, { status })`. `prepareResponse` mescla `event.res.headers` por cima (`src/response.ts:176-205`, com `mergeHeaders` em `src/response.ts:243`), logo os cabeçalhos definidos em `event.res.headers` chegam à resposta. `HTTPResponse` aceita `status` 206/416 sem tratamento especial; `sanitizeStatusCode` os aceita.
- `statusText` explícito (`"Partial Content"`, `"Range Not Satisfiable"`), no mesmo estilo do `304` (`src/utils/static.ts:244-247`).

### D-08 — `416` remove cabeçalhos de representação

RF-04 exige que o `416` não leve `Content-Type` do asset nem `Content-Encoding`. Como `options.headers` ou middleware podem ter gravado esses cabeçalhos em `event.res.headers` antes do `serveStatic`, o ramo `416` executa `event.res.headers.delete("content-type")` e `delete("content-encoding")` antes de responder. `etag`, `last-modified`, `vary`, `cache-control` e demais permanecem. Alternativa de não remover foi rejeitada: um `416` rotulado com tipo/encoding do asset sem corpo confunde caches.

### D-09 — Sem mudança em `getMeta`/`getContents` nem novas opções

O fatiamento ocorre no `serveStatic`, depois de `getContents` (premissa do PRD, fora de escopo "backends concretos"). Alternativa de uma opção `getContents(id, { range })` foi rejeitada: criaria API pública, vetada pelo pedido.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts:240-248` | Após o retorno do `304` (`src/utils/static.ts:243-248`), definir `accept-ranges` e chamar `resolveRange`; tratar `unsatisfiable` com o `416` (D-08). |
| `src/utils/static.ts:268-278` | Ramo `HEAD` (`:272-274`) devolve `206` sem corpo quando houver intervalo; ramo `GET` (`:276-277`) chama `sliceBody` e devolve `206`. `content-length` do intervalo sobrepõe o existente. |
| `src/utils/static.ts:280` | Novos helpers privados após o marcador `// --- Internal Utils ---`: `resolveRange`, `parseRange`, `isIfRangeValid`, `sliceBody`, `sliceStream`. |
| `test/static.test.ts` (novo `describeMatrix("serve static range", ...)` após `:524`, antes do bloco MIME) | Testes de RF-01 a RF-11. |
| `docs/4.examples/serve-static-assets.md` | Parágrafo curto: o `serveStatic` atende `Range` único (opcional, sem código). |

Arquivos **não** alterados (verificados): `src/index.ts:193` (reexport, sem nomes novos); `src/utils/internal/cache.ts:29` (`isCacheMatch`, reutilizado como está para o `304`); `test/unit/package.test.ts` (lista de exportações, `serveStatic` já presente em `:133`). Os testes existentes de cabeçalhos (`test/static.test.ts:53`, `:69`, `:450`, `:466`) usam `toMatchObject`, então o novo `accept-ranges` não os quebra; nenhum precisa ser ajustado.

## 4. Contratos e assinaturas (todos privados, não exportados)

```ts
type ByteRange = { start: number; end: number }; // inclusivo nas duas pontas

type RangeDecision =
  | { type: "ignore" }
  | { type: "partial"; range: ByteRange }
  | { type: "unsatisfiable" };

/** Decide o tratamento de `Range` para um asset de `size` conhecido (D-03/D-04/D-05). */
function resolveRange(event: H3Event, size: number | undefined): RangeDecision;

/** Parser do cabeçalho; `undefined` = sintaxe inválida/multi/unidade/overflow → ignorar. */
function parseRange(
  header: string,
  size: number,
): ByteRange | "unsatisfiable" | undefined;

/** `If-Range` (RFC 9110 §13.1.5), contra `etag`/`last-modified` da resposta. */
function isIfRangeValid(ifRange: string, resHeaders: Headers): boolean;

/** Fatia o corpo; `undefined` quando o tipo não é fatiável (cai no 200). */
function sliceBody(body: BodyInit, range: ByteRange): BodyInit | undefined;
```

Contrato HTTP resultante (asset de 18 bytes):

| Requisição | Status | Cabeçalhos principais | Corpo |
| --- | --- | --- | --- |
| sem `Range` | 200 | `accept-ranges: bytes`, `content-length: 18` | completo |
| `bytes=2-5` | 206 | `content-range: bytes 2-5/18`, `content-length: 4` | 4 bytes |
| `bytes=-4` / `10-` / `10-999` | 206 | `bytes 14-17/18` / `10-17/18` / `10-17/18` | idem |
| `HEAD` + `bytes=2-5` | 206 | idem `GET` | vazio; `getContents` não chamado |
| `bytes=18-`, `100-200`, `-0` | 416 | `content-range: bytes */18`, `content-length: 0`, sem `content-type`/`content-encoding` | vazio |
| `0-1,4-5`, `5-2`, `items=0-1`, `abc` | 200 | `accept-ranges: bytes`, sem `content-range` | completo |
| `If-Range` forte confere / não confere / fraco | 206 / 200 / 200 | — | — |
| `If-None-Match` igual + `Range` | 304 | sem `content-range`, sem `accept-ranges` | vazio |

## 5. Estratégia de testes

Política do projeto (AGENTS.md): escrever os testes primeiro, confirmar que **falham** antes do código e só então implementar a mudança mínima. Os testes usam `describeMatrix` (modos `web` e `node`) em `test/static.test.ts`, com um asset de 18 bytes (`size: 18`, conteúdo `"0123456789abcdefgh"`) e, nos de encoding, `file.txt.gz` com `size: 30`.

Cobertura mínima por requisito:

- **RF-01:** `accept-ranges: bytes` em `GET`/`HEAD`, corpo e demais cabeçalhos iguais; ausente em `304`, `404`, `405` e fallthrough (usar o app com `fallthrough: true` já existente em `test/static.test.ts:396`).
- **RF-02:** `2-5`, `10-`, `-4`, `10-999`, `-999` (devolve tudo como 206), unidade `BYTES` e espaços opcionais; `content-length` do intervalo sobrepondo `content-length: 999` pré-definido; `etag`, `last-modified`, `vary` e `options.headers` preservados.
- **RF-03:** `HEAD` com `206` e `416`, corpo vazio, `getContents` com `vi.fn` sem chamadas.
- **RF-04:** `18-`, `100-200`, `-0`, asset `size: 0`; `content-range: bytes */size`, `content-length: 0`, sem `content-type`/`content-encoding`, `accept-ranges` mantido.
- **RF-05:** tabela de entradas ignoradas (`bytes=abc`, `bytes=`, `bytes=5`, `bytes=--1`, `bytes=+1-2`, `bytes=1.5-2`, `bytes=5-2`, `bytes=0-1,4-5`, `items=0-1`, `bytes=99999999999999999999-`), todas `200` completo.
- **RF-06:** `If-Range` forte confere (206), difere (200), fraco no cliente e no asset (200), data idêntica (206), data diferente (200), asset sem validador (200), `If-Range` sem `Range` (200).
- **RF-07:** `If-None-Match` igual + `Range` → 304, sem `content-range`.
- **RF-08:** `encodings: { gzip: ".gz" }`, `Range` aplicado ao `.gz` com `size` 30, mantendo `content-encoding`, `content-type` de `file.txt` e `vary: accept-encoding`; `getMeta` chamado com o mesmo id de antes. Cuidado: em modo `node`, o `fetch` do undici descomprime respostas com `content-encoding: gzip`; para comparar bytes do `.gz` usar `accept-encoding: gzip` e um corpo que não precise ser descomprimido, ou validar só status e cabeçalhos nesse caso, usando `HEAD`.
- **RF-09:** `getMeta` sem `size` → `200` sem `content-range`.
- **RF-10:** `404`/`405`/fallthrough inalterados com `Range`; caminho não canônico recusado; `test/security.test.ts` e `test/unit/package.test.ts` verdes sem edição.
- **RF-11:** `getContents` devolvendo string (inclusive com caracteres multibyte, para provar fatiamento em bytes), `Uint8Array` com `byteOffset` ≠ 0, `ArrayBuffer`, `Blob`, `ReadableStream` (várias chunks cruzando a fronteira do intervalo); `getContents` devolvendo `null` → `200` vazio; corpo de `FormData`/`URLSearchParams` → `200` completo. Em todos: `body.length === content-length`.

Verificação final: `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts`, depois `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`.

## 6. Riscos

- **R-01 — `content-length` sobreposto em 206/416.** Muda o comportamento quando o usuário fixou `content-length` e o cliente manda `Range`. Deliberado (PRD); documentado em D-07.
- **R-02 — `Accept-Ranges` sem tamanho.** Anunciar e depois responder `200` é permitido pela RFC, mas pode induzir retomadas inúteis. Decisão pendente do solicitante (restringir o anúncio a `size` conhecido). A implementação isola isso em uma condição.
- **R-03 — Custo do fatiamento de stream.** Os bytes anteriores ao início são lidos e descartados. Aceito; otimizar exigiria API pública (fora de escopo).
- **R-04 — `size` divergente do corpo real.** Pode gerar `206`/`416` inconsistentes ou `Content-Length` errado, como já ocorre hoje no `200`. Mitigação: fatiamento de buffer limitado ao tamanho existente, sem lançar exceção.
- **R-05 — Tipos de `BodyInit` não fatiáveis.** `FormData`/`URLSearchParams` caem para `200` completo, e o `content-range` não pode ser enviado. Por isso os cabeçalhos do `206` são gravados só depois do fatiamento (D-01, passo 7).
- **R-06 — Compressão automática em runtimes.** Respostas `206` com `content-encoding` de variante pré-comprimida são válidas, mas servidores/clientes que descomprimem de forma transparente (undici) complicam os testes (ver RF-08).
- **R-07 — `etag` fraco em minúsculas.** Os fixtures usam `"w/123"`; pela RFC só `W/` (maiúsculo) é fraco. A comparação forte do `If-Range` tratará `w/123` como valor não-etag. Não afeta o `If-None-Match`, que segue usando `isCacheMatch` sem alteração.
- **R-08 — Tamanho do arquivo.** `src/utils/static.ts` passa da meta de 200 LoC do AGENTS.md. Se a revisão preferir, os helpers podem migrar para `src/utils/internal/range.ts` sem alterar o contrato (aviso: contraria a letra de RF-10).
- **R-09 — Regressão em `HEAD`.** `FastResponse`/`nullBody` já removem o corpo em `HEAD` (`src/response.ts:350-356`), mas o `content-length` do intervalo precisa sobreviver; os testes de RF-03 cobrem isso nos dois runtimes.
