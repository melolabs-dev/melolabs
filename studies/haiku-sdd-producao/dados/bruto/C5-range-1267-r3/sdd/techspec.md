# Spec técnica: HTTP Range no `serveStatic`

**Referência:** h3js/h3#1267 · `sdd/pedido.md` · `sdd/prd.md` (RF-01 a RF-12)
**Área afetada:** `src/utils/static.ts`, `test/static.test.ts`
**Linha de base:** `pnpm vitest run test/static.test.ts` passa com 76 testes antes da mudança.

## Visão geral

`serveStatic` passa a interpretar `Range` para GET e HEAD, em um único intervalo, com validação de `If-Range`. A mudança é toda interna ao módulo: nenhuma exportação nova, nenhuma mudança em `ServeStaticOptions` ou `StaticAssetMeta`. O fluxo atual de cache, encoding, `fallthrough`, 404 e 405 não é alterado. O intervalo é aplicado sobre o `size` que `getMeta` devolve para a variante servida.

Ordem das avaliações depois da mudança (RFC 9110 §13.2.2, adaptada ao escopo):

1. Método, canonicidade do caminho, busca de variante (inalterado).
2. Cabeçalhos do asset: `vary`, `last-modified`, `etag`, `accept-ranges` (novo, D-02).
3. Condicional `If-None-Match` / `If-Modified-Since` → 304 (inalterado, RF-07).
4. `content-type`, `content-encoding`, `content-length` (inalterado, exceto D-06).
5. Avaliação de `Range` (novo): `If-Range` → parse → resolução → 206, 416 ou 200.
6. HEAD → resposta sem corpo. GET → `getContents` e, se houver intervalo, recorte do corpo (D-05).

---

## Decisões de arquitetura

### D-01 — Lógica inteira dentro de `serveStatic`, em uma passagem

**Escolha:** a avaliação de Range fica dentro de `serveStatic`, depois do bloco 304 e antes do ramo HEAD (`src/utils/static.ts:243-274`). Não há novo parâmetro nem novo passo de pipeline.

**Alternativas:**
- Middleware separado de Range que envolve `serveStatic`. Descartado: exigiria reabrir o resultado de `serveStatic` e conhecer `meta`, que é interno a ele.
- Passar o intervalo para `getContents` (novo argumento). Descartado: é explicitamente fora de escopo (PRD, "Fora de escopo") e mudaria a API pública.

**Justificativa:** a ordem garante RF-07 (condicionais antes de Range) sem código extra, porque o 304 já retorna antes do ponto de Range.

### D-02 — `Accept-Ranges: bytes` só quando o `size` é conhecido

**Conflito a confirmar:** RF-01 pede `Accept-Ranges: bytes` para todo asset encontrado, e RF-09 diz que sem `size` o Range é ignorado. Anunciar `bytes` num asset sem `size` seria falso, porque o servidor não atenderia intervalos para ele.

**Escolha:** definir `accept-ranges: bytes` somente quando `meta.size > 0`, no mesmo bloco do `etag` (`src/utils/static.ts:239-241`). Quando o `size` é desconhecido, o cabeçalho é omitido.

**Alternativa:** sempre anunciar `bytes`, como RF-01 escreve literalmente. Fica registrado como pendência (ver "Pendências").

**Posição:** antes do 304, para o cabeçalho também sair em 304, como `etag` e `last-modified` já saem (ver `src/utils/static.ts:239-241`).

### D-03 — Parser de Range em duas etapas: sintaxe e resolução

**Escolha:**
- `parseRange` valida só a sintaxe de um intervalo. Aceita `bytes=a-b`, `bytes=a-` e `bytes=-n`. Qualquer outra forma (vários intervalos, unidade diferente, `b < a`, campos vazios) devolve `undefined`, e o Range é ignorado (RF-05).
- `resolveRange` aplica o tamanho. Devolve `{ start, end }` com `end` limitado a `size - 1`, ou `undefined` quando o intervalo não é satisfazível (RF-02, RF-04).
- A unidade `bytes` é tratada sem diferenciar maiúsculas. Confirmar essa regra na RFC 9110 §14.1 antes de fechar o código.

**Alternativa:** uma única função que devolve o resultado final. Descartada porque mistura o caso "ignorar" (200) com o caso "não satisfazível" (416), que são respostas diferentes.

**Regras de resolução**, para `size = N`:
- `a-b`: se `a >= N`, 416. Senão `end = min(b, N-1)`.
- `a-`: se `a >= N`, 416. Senão `end = N-1`.
- `-n`: se `n == 0`, 416. Senão `start = max(0, N-n)`, `end = N-1`.

### D-04 — `If-Range` com comparação própria, sem reusar `isCacheMatch`

**Escolha:** nova função privada `matchesIfRange`. Para ETag, exige igualdade byte a byte com `meta.etag` e rejeita validador fraco (`W/`). Para data, exige igualdade exata com o `mtimeDate` já truncado a segundos (`src/utils/static.ts:228-232`). Quando `If-Range` não existe, o Range vale.

**Por que não reusar `isCacheMatch`:** ele faz comparação fraca de ETag (`src/utils/internal/cache.ts:42` e `:17` via `matchETag`) e compara data com `>=` (`src/utils/internal/cache.ts:46`). Ambos são corretos para cache e errados para `If-Range`, que pede validador forte e igualdade (RFC 9110 §13.1.5).

**Caso especial:** se `meta.etag` está ausente e `If-Range` é uma data, a data é comparada com `mtimeDate`. Se `mtimeDate` também está ausente, `If-Range` não casa e o Range é ignorado.

### D-05 — Recorte do corpo por tipo, sem bufferizar o arquivo inteiro

**Escolha:** nova função privada `sliceBody(contents, start, end)`, síncrona, com um ramo por tipo:

| Tipo de `contents` | Recorte |
|---|---|
| `string` | `new TextEncoder().encode(contents).subarray(start, end + 1)`. O tamanho em bytes é UTF-8, não `.length`. |
| `Blob` | `contents.slice(start, end + 1)` |
| `ArrayBuffer` | `new Uint8Array(contents, start, end - start + 1)` |
| `ArrayBufferView` | `new Uint8Array(view.buffer, view.byteOffset + start, end - start + 1)`, respeitando `byteOffset` |
| `ReadableStream` e demais (`FormData`, `URLSearchParams`) | `new Response(contents).body` lido com `ReadableStream` próprio: descarta bytes até `start`, emite até `end`, cancela o leitor ao fim |

**Alternativas:**
- Bufferizar tudo (`arrayBuffer()`) e recortar. Descartada: para vídeo grande, carrega o arquivo inteiro na memória a cada seek.
- Tratar `ReadableStream` como erro e cair em 200. Descartada: quebra RF-02 para um tipo que o próprio `BodyInit` aceita.

**Custo conhecido:** no caso de stream, um seek para o fim lê e descarta todo o prefixo. Isso é o Risco 1 do PRD e fica registrado no PR.

### D-06 — `Content-Length` e `Content-Range` sobrescrevem os valores existentes em 206 e 416

**Escolha:** em respostas parciais e em 416, `content-length` é definido mesmo que `options.headers` já tenha definido um valor. Em 206 e 416, o valor de `options.headers` descreveria o asset inteiro, e isso seria incorreto.

**Alternativa:** respeitar o cabeçalho já definido, como o ramo 200 faz hoje (`src/utils/static.ts:268`, teste em `test/static.test.ts:600-617`). Descartada: enviaria um `Content-Length` que não bate com o corpo.

**Impacto:** o ramo 200 e o teste de `content-length` existente (`test/static.test.ts:600-617`) continuam iguais, porque a sobrescrita só vale para 206 e 416.

### D-07 — 416 como `HTTPResponse` com os próprios cabeçalhos, não como `HTTPError`

**Achado no código:** em `src/response.ts:211-212`, para status `>= 400` só são mesclados os cabeçalhos de `event.res.errHeaders`. Os `event.res.headers` (incluindo `vary`, `etag`, `content-range` definido via `event.res`) são descartados.

**Escolha:** retornar `new HTTPResponse(null, { status: 416, headers })`, onde `headers` é uma cópia de `event.res.headers` mais `content-range: bytes */N`, `content-length: 0` e `accept-ranges: bytes`. Isso segue o padrão de 304 (`src/utils/static.ts:244-247`), com os cabeçalhos carregados no próprio objeto de resposta.

**Alternativas:**
- Lançar `HTTPError({ status: 416 })`. Descartada: o erro passa pelo caminho de erro, que só mantém `errHeaders`, então `vary` e `etag` se perdem.
- Gravar em `event.res.errHeaders`. Descartada: é a API de erro e espalharia o caso especial para fora do módulo.

**Consequência:** `vary` continua presente em 416, o que mantém a correção de cache quando há encodings configurados.

### D-08 — Asset de tamanho zero: Range ignorado, regra atual mantida

**Escolha:** `meta.size > 0` continua sendo a condição para haver Range (P3 do PRD, mesma regra de `src/utils/static.ts:268`). Para arquivo vazio, a resposta é 200 como hoje.

**Alternativa:** seguir a RFC 9110, que daria 416 para `bytes=0-0` em arquivo vazio. Não é feito agora porque P3 pede confirmação antes da implementação. Ver "Pendências".

### D-09 — Precondições de escrita fora do escopo

**Escolha:** `If-Match` e `If-Unmodified-Since` continuam sem tratamento. A RFC 9110 os avalia antes de Range, e isso fica registrado como risco.

**Justificativa:** o pedido restringe o escopo a Range, `If-Range` e as condicionais de cache já existentes. Implementar as de escrita é outra mudança de comportamento.

### D-10 — Helpers privados em `src/utils/static.ts`, não em `utils/internal/`

**Conflito:** `AGENTS.md` pede que helpers internos fiquem em `utils/internal/` e que arquivos tenham menos de 200 linhas. O pedido (`sdd/pedido.md`, "Restrições") e o PRD (RF-11) exigem que a lógica auxiliar fique privada em `serveStatic`.

**Escolha:** seguir o pedido. Os helpers ficam no fim de `src/utils/static.ts`, na seção "Internal Utils" (`src/utils/static.ts:280`). O arquivo cresce de 352 para algo perto de 470 linhas.

**Alternativa:** `src/utils/internal/range.ts`, não exportado por `src/index.ts`. Atende à convenção do `AGENTS.md`, mas viola o texto literal do pedido. Se o time preferir essa opção, a migração é mecânica e não muda contratos.

---

## Arquivos a alterar

### `src/utils/static.ts`

| Trecho | Mudança |
|---|---|
| `src/utils/static.ts:68-100` | JSDoc de `serveStatic`: uma frase sobre Range e `Accept-Ranges`, sem novos blocos de segurança |
| `src/utils/static.ts:239-241` | Definir `accept-ranges: bytes` quando `meta.size > 0` (D-02) |
| `src/utils/static.ts:243-248` | 304 inalterado. A avaliação de Range fica depois dele (D-01) |
| `src/utils/static.ts:268-270` | `content-length` inalterado para 200. O caminho parcial sobrescreve (D-06) |
| `src/utils/static.ts:272-277` | Antes do ramo HEAD, avaliar Range e retornar 206 ou 416. No ramo GET, passar o corpo por `sliceBody` quando houver intervalo |
| `src/utils/static.ts:280+` | Helpers privados: `parseRange`, `resolveRange`, `matchesIfRange`, `sliceBody` |

**Não alterar:**
- `src/utils/static.ts:9-15` (`StaticAssetMeta`) e `src/utils/static.ts:17-66` (`ServeStaticOptions`): RF-11.
- `src/utils/internal/cache.ts:11-49`: `isCacheMatch` e `matchETag` continuam iguais, porque `src/utils/cache.ts:75` também os usa.
- `src/index.ts:193`: nenhum nome novo é exportado (RF-11).
- `src/rules/cache.ts:143-148`: já ignora Range no cache de rules. Fora de escopo.

### `test/static.test.ts`

- Novo bloco `describeMatrix("serve static range", ...)` depois do bloco de MIME types (`test/static.test.ts:525-624`) e antes de `describe("serve static (malformed url)")` (`test/static.test.ts:626`). Usa `describeMatrix` de `test/_setup.ts:11`.
- Nenhum teste existente depende de 200 para Range: a busca por `range` em `test/static.test.ts` não retornou nada. Os testes existentes não precisam de ajuste.

### `sdd/techspec.md`

Este arquivo.

---

## Contratos e assinaturas

Todas as funções novas são privadas ao módulo: sem `export`, sem entrada em `src/index.ts`. Como não são exportadas, `isolatedDeclarations` não exige anotação de retorno extra além da que for necessária para o TypeScript.

```ts
// src/utils/static.ts — internos, no fim do arquivo

/** Intervalo pedido, antes de aplicar o tamanho do asset. */
type RangeRequest = { start: number; end?: number } | { suffix: number };

/** Intervalo resolvido, `end` inclusivo, já limitado a `size - 1`. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * Valida a sintaxe de `Range`. Devolve `undefined` para malformado ou múltiplo,
 * caso em que o Range é ignorado (RF-05).
 */
function parseRange(header: string): RangeRequest | undefined;

/**
 * Aplica o tamanho do asset. Devolve `undefined` quando o intervalo não é
 * satisfazível, caso em que a resposta é 416 (RF-04).
 */
function resolveRange(request: RangeRequest, size: number): ByteRange | undefined;

/**
 * Avalia `If-Range` (RFC 9110 §13.1.5). ETag precisa ser forte e igual ao
 * validador atual; data precisa ser igual a `mtime` truncado a segundos.
 * Sem `If-Range`, devolve `true`.
 */
function matchesIfRange(ifRange: string | null, meta: StaticAssetMeta, mtime?: Date): boolean;

/** Recorta o corpo para os bytes `start..end` inclusivos (D-05). */
function sliceBody(contents: BodyInit, range: ByteRange): BodyInit;
```

**Fluxo no `serveStatic`** (trecho de referência, não é a implementação final):

```ts
// depois de content-length, antes do ramo HEAD (src/utils/static.ts:272)
const rangeHeader = event.req.headers.get("range");
if (rangeHeader && meta.size > 0 && matchesIfRange(event.req.headers.get("if-range"), meta, mtimeDate)) {
  const request = parseRange(rangeHeader);
  if (request) {
    const range = resolveRange(request, meta.size);
    if (!range) {
      // 416 com os cabeçalhos próprios (D-07)
    }
    // 206: Content-Range, Content-Length, e corpo via sliceBody no GET
  }
}
```

**Contrato observável:**

| Entrada | Saída |
|---|---|
| GET ou HEAD sem `Range`, ou `Range` ignorado | Igual a hoje, mais `accept-ranges: bytes` quando `size > 0` |
| `Range` válido e satisfazível, `If-Range` ausente ou casando | 206, `content-range: bytes a-b/N`, `content-length: b-a+1` |
| HEAD com Range válido | 206 sem corpo, `getContents` não é chamado |
| `Range` não satisfazível | 416, `content-range: bytes */N`, `content-length: 0`, `getContents` não é chamado |
| `If-Range` não casa | 200 com arquivo completo |
| Asset inexistente, método errado, caminho não canônico | Igual a hoje (404, 405, `undefined` com `fallthrough`) |

---

## Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: escrever os testes primeiro e confirmar que falham antes de implementar.

**Ferramenta:** `describeMatrix` (`test/_setup.ts:11`), para rodar em `web` e `node`.

**Fixture:** asset de 10 bytes, `getContents` devolvendo `"0123456789"`, `getMeta` com `size: 10`, `etag: '"abc"'` (forte, com aspas), `mtime` fixo. Para validadores fracos, usar `W/"abc"`, não `w/123` (o fixture atual `test/static.test.ts:16` usa `w/123`, que não começa com `W/` e seria tratado como forte).

**Casos por requisito:**

| Requisito | Casos |
|---|---|
| RF-01 | `accept-ranges: bytes` em GET e HEAD, com e sem Range. Ausente quando `size` é desconhecido (D-02) |
| RF-02 | `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345`. `bytes=a-`, `bytes=-3`, `bytes=-99` (suffix maior que o arquivo), `bytes=5-99` (fim limitado a 9) |
| RF-03 | HEAD com `bytes=2-5`: 206, headers, corpo vazio, `getContents` com `vi.fn` não chamado |
| RF-04 | `bytes=10-20`, `bytes=-0`, `bytes=10-`: 416 com `content-range: bytes */10`, `content-length: 0`, `getContents` não chamado, `vary` preservado (D-07) |
| RF-05 | `bytes=abc`, `items=0-1`, `bytes=5-2`, `bytes=0-1,4-5`, `bytes=-`: 200 completo, sem `content-range` |
| RF-06 | `If-Range` com ETag forte casando → 206. Com ETag diferente → 200. Com `W/"abc"` → 200. Com data exata do `last-modified` → 206. Com data diferente → 200 |
| RF-07 | `If-None-Match` casando com Range válido → 304, sem 206 nem 416. Mesmo com `If-Modified-Since` |
| RF-08 | `/app.js` com `accept-encoding: gzip` e `Range`: `content-range` e `content-length` com o `size` do `.gz` (meta da variante), `content-encoding: gzip`, `vary` presente |
| RF-09 | `getMeta` sem `size`, ou `size: 0`: Range ignorado, 200 |
| RF-10 | Sem Range, respostas idênticas às atuais (os testes existentes já cobrem). Asset inexistente com Range → 404. Método POST com Range → 405. Com `fallthrough`, `undefined` |
| RF-11 | Teste de tipos ou verificação manual de que `src/index.ts` não mudou |
| RF-12 | `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/static.test.ts` |

**Casos de corpo (D-05):** o mesmo intervalo com cada tipo de `getContents`:
- `string` com caracteres não ASCII (`"é"` ocupa 2 bytes): `size` é o número de bytes e o recorte bate com UTF-8.
- `Blob`.
- `ArrayBuffer`.
- `Uint8Array` com `byteOffset` diferente de zero (`subarray`): o recorte precisa respeitar o offset.
- `ReadableStream` que emite em vários chunks, com `start` caindo no meio de um chunk.

**Regressão:** os 76 testes atuais continuam passando. O único ajuste previsto é nenhum, porque nenhum teste existente usa Range.

**Cobertura:** `pnpm test` roda lint, typecheck e cobertura. A cobertura do novo código deve ficar acima do limiar do projeto.

---

## Riscos

| ID | Nível | Risco | Mitigação |
|---|---|---|---|
| R-01 | Alto | `getContents` não recebe o intervalo (P2). Para `ReadableStream`, um seek grande lê e descarta o prefixo. | D-05: tipos diretos primeiro. Medir stream com arquivo grande. Registrar no PR (PRD, Risco 1). |
| R-02 | Médio | `If-Range` por data: `new Date` é mais permissivo que o parser de HTTP-date, e `mtime` precisa ser truncado da mesma forma. | Comparar com `mtimeDate` já truncado (`src/utils/static.ts:228-232`). Teste com `mtime` de milissegundos. |
| R-03 | Médio | Diferença entre runtimes: `Blob`, `ReadableStream` e `new Response(...).body` se comportam de forma diferente em Node, Bun e Web. | `describeMatrix` em `web` e `node` (`test/_setup.ts:11`). Bun só é coberto pelo `pnpm bench:bun` ou por teste manual, a confirmar. |
| R-04 | Médio | `size` de `getMeta` diferente do corpo real do backend. Um 206 com `content-length` errado quebra o cliente. | Documentar no JSDoc que `size` deve ser o tamanho exato, como já é a expectativa para 200 (P1). |
| R-05 | Baixo | Cache intermediário misturar variantes codificadas em 206. | `vary: accept-encoding` já é definido com encodings configurados (`src/utils/static.ts:220-225`). Testar que `vary` aparece em 206 e 416 (RF-08). |
| R-06 | Baixo | 416 perder cabeçalhos por causa de `errHeaders` (`src/response.ts:211-212`). | D-07: cabeçalhos próprios no `HTTPResponse`. Teste de `vary` e `etag` em 416. |
| R-07 | Baixo | Fixture `w/123` (`test/static.test.ts:16`) não é um ETag fraco válido. | Novos testes usam `W/"..."` e `"..."`. O fixture antigo não é alterado. |
| R-08 | Baixo | `content-length` definido em `options.headers` conflitar com 206 (D-06). | Sobrescrita só em 206 e 416. Teste do caso 200 existente (`test/static.test.ts:600-617`). |
| R-09 | Baixo | Arquivo passa de 200 linhas (D-10), contra a convenção do `AGENTS.md`. | Registrado. Migrar para `utils/internal/range.ts` se o time preferir. |
| R-10 | Baixo, fora de escopo | `If-Match` e `If-Unmodified-Since` não são avaliados, e a RFC 9110 os coloca antes de Range. Um cliente pode receber 206 onde a RFC pediria 412. | D-09. Abrir issue separada. |

---

## Pendências

Confirmar antes de implementar:

1. **`Accept-Ranges` sem `size` (D-02).** RF-01 e RF-09 se contradizem. A spec omite o cabeçalho quando `size` é desconhecido. Se o time quiser o texto literal de RF-01, o cabeçalho passa a sair sempre, e isso precisa ser aceito como anúncio falso para assets sem tamanho.
2. **Arquivo de tamanho zero (D-08 e P3).** A spec mantém a regra atual (Range ignorado). A RFC 9110 daria 416. Decidir se essa diferença é aceita nesta issue.
3. **Escopo de `If-Match` e `If-Unmodified-Since` (D-09).** A spec deixa para outra issue.
4. **Localização dos helpers (D-10).** A spec segue o pedido (dentro de `static.ts`), que conflita com a convenção do `AGENTS.md`.
