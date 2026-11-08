# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-10), issue h3js/h3#1267.
Norma: RFC 9110, §13.1.5 (If-Range), §13.2.2 (ordem de avaliação), §14 (Range).

Este documento não altera código. Todas as referências `arquivo:linha` foram conferidas na árvore atual do projeto.

## Visão geral

A mudança fica inteira dentro de `serveStatic` em `src/utils/static.ts`. Não há nova opção pública, nova exportação nem mudança em `getMeta`/`getContents`. A lógica de Range entra depois da avaliação de cache (304) e antes do corpo, e os helpers ficam privados no fim do módulo.

Fluxo resultante, dentro de `serveStatic`:

1. Tudo o que existe hoje até o 304 continua igual (`src/utils/static.ts:116-248`).
2. Seleção de content-type, content-encoding e content-length continua igual (`src/utils/static.ts:250-270`).
3. Se `meta.size` for conhecido e maior que zero, o `serveStatic` anuncia `Accept-Ranges: bytes` e avalia o cabeçalho `Range`.
4. Resultado: 200 completo (sem Range ou Range ignorado), 206 com fatia, ou 416.
5. Para `HEAD`, os mesmos cabeçalhos são enviados sem corpo.

---

## Decisões de arquitetura

### D-01 — Helpers privados no próprio `static.ts`

**Decisão:** toda a lógica de Range (parse, If-Range, fatiamento) fica em `src/utils/static.ts`, em funções não exportadas, abaixo do marcador `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts`, seguindo a convenção de `AGENTS.md` (helpers internos em `utils/internal/`). Ficaria mais limpo e dentro do limite de ~200 linhas por arquivo.
- Helpers em `src/utils/internal/` com import pelo `static.ts`.

**Escolha:** manter no `static.ts`. A issue pede explicitamente "Keep all helper logic private within the serveStatic module" e `pedido.md` repete "as funções auxiliares ficam privadas no módulo". Isso prevalece sobre a convenção geral. O custo é que `static.ts` passa de 352 para aproximadamente 450 linhas, acima da meta de 200 linhas. Registrado em Riscos.

### D-02 — Ordem de avaliação: 304 antes de Range

**Decisão:** o 304 (`src/utils/static.ts:243-248`) continua sendo avaliado antes de qualquer Range. Quando o cache casa, a resposta é 304 mesmo que haja um `Range` válido (RF-08).

**Alternativas consideradas:** avaliar Range antes do cache, o que devolveria 206 para uma requisição que o cliente já tem em cache.

**Escolha:** a ordem da RFC 9110 §13.2.2 coloca If-None-Match e If-Modified-Since antes de If-Range e Range. A ordem atual do código já respeita isso, então basta inserir o bloco de Range depois da definição de `content-length`.

### D-03 — If-Range: validador forte ou data exata; sem match, Range é ignorado

**Decisão:** quando `If-Range` está presente:
- se o valor começa com `"` ou `W/"`, é um entity-tag: casa somente com `meta.etag` quando ambos são fortes (nenhum começa com `W/`) e são idênticos caractere a caractere;
- caso contrário, é tratado como data HTTP: casa somente quando `Date.parse(valor)` é igual ao `mtimeDate` já truncado em segundos (`src/utils/static.ts:227-232`);
- se não casar, o Range é ignorado e a resposta é 200 completa. Não é 416, porque a RFC manda ignorar o Range inteiro antes de avaliar a faixa.

**Alternativas consideradas:**
- Reusar `matchETag` de `src/utils/internal/cache.ts:11-17`. Descartado: ele usa comparação fraca (ignora `W/`), e a RFC exige comparação forte para If-Range.
- Comparar a string de `If-Range` com o header `last-modified` já emitido. Descartado: o header pode vir de `options.headers` e não representa o validador real.

**Escolha:** comparação própria, forte para ETag e por instante para data. Um ETag fraco (ex.: `W/"abc"`) nunca satisfaz If-Range (PRD, riscos).

### D-04 — Parse: um único intervalo, unidade sem diferença de caixa

**Decisão:** o parse aceita somente `bytes=<a>-<b>`, `bytes=<a>-` e `bytes=-<n>`, com dígitos decimais e espaços opcionais (OWS) ao redor. A unidade é comparada sem diferença de maiúsculas, como permite a RFC 9110 §14.1. Regras:
- vírgula (múltiplos intervalos) não casa com o padrão e o Range é ignorado (200), como pede a issue;
- `a > b` é sintaticamente inválido e o Range é ignorado;
- `bytes=-0` e `a >= size` são não satisfazíveis e geram 416;
- `bytes=a-` com `a < size` vai até o último byte;
- `bytes=-n` com `n > size` começa em `0` (PRD, premissas).

**Alternativas consideradas:** parser que tokeniza a lista e aceita `multipart/byteranges`. Fora de escopo (PRD).

**Escolha:** regex de um único `range-spec`, mais uma função pura que devolve `ByteRange`, `"unsatisfiable"` ou `undefined` (ignorar). Os casos de borda ficam testáveis sem HTTP.

### D-05 — Range é ignorado quando a variante servida é codificada (divergência da premissa do PRD)

**Decisão:** quando a resposta tem codificação de conteúdo (`content-encoding` presente após `src/utils/static.ts:264-266`, ou a variante escolhida é uma pré-comprimida, isto é, `id !== assetId`, `src/utils/static.ts:204-205`), o Range é ignorado e a resposta é 200 completa.

**Premissa do PRD (`sdd/prd.md:134`):** a faixa vale para os bytes codificados.

**Alternativas consideradas:**
- Seguir a premissa: fatiar o arquivo `.gz`/`.br` em disco e devolver 206 com `Content-Encoding`. Retomar download de `.gz` produz um fluxo que o cliente só decodifica se recebeu o início; navegadores e CDNs tratam isso de forma inconsistente.
- Ignorar Range sempre que houver `content-encoding`. Escolhida.

**Motivo:** a decodificação de conteúdo codificado com faixa não é garantida por clientes e intermediários, e o caso de uso da issue (vídeo, áudio, downloads) é servido sem codificação. Esta decisão **precisa de confirmação** antes da implementação. Se for rejeitada, o teste de D-05 em `test/static.test.ts` (ver Estratégia de testes) vira o teste de seguir a premissa.

**Observação sobre o teste existente:** o `meta` de `test/static.test.ts:9-20` define `encoding: "utf8"`, que é usado como `content-encoding`. Por isso o teste existente de Range (se os novos testes reusarem essa fixture) cairia na regra de D-05. Os novos testes usam fixture própria sem `encoding` (ver Estratégia de testes).

### D-06 — Fatiamento do corpo sem leitura inteira quando possível

**Decisão:** `getContents(id)` não recebe intervalo (PRD, restrições). O corpo é fatiado por tipo de `BodyInit`:
- `Blob`: `blob.slice(start, end + 1)`, preguiçoso, sem leitura da fonte inteira;
- `ReadableStream`: função auxiliar que descarta `start` bytes e emite `end - start + 1` bytes, lendo somente até `end`. Memória limitada ao tamanho de um chunk;
- demais (`string`, `ArrayBuffer`, `TypedArray`, `DataView`, `URLSearchParams`, `FormData`): já estão em memória. Obtém-se `new Response(contents).arrayBuffer()` e fatia-se com `subarray`. Strings são codificadas em UTF-8 pelo próprio `Response`.

**Alternativas consideradas:**
- Ler tudo com `new Response(contents).arrayBuffer()` para qualquer tipo. Mais simples, mas um vídeo de 1 GB sob `ReadableStream` ocupa 1 GB de memória por requisição de seek. Descartado.
- Aceitar a limitação e documentar, como o PRD sugere em "Riscos". Descartado porque a alternativa de streaming cabe em poucas linhas privadas e fecha a questão aberta do PRD sem nova opção pública.

**Escolha:** a abordagem por tipo. A função auxiliar de `ReadableStream` tem uma responsabilidade só e não depende de nada externo.

### D-07 — Cabeçalhos da resposta parcial

**Decisão:**
- `Accept-Ranges: bytes` é definido com `set` somente se ainda não existir (mesma convenção de `content-type` em `src/utils/static.ts:250`), quando `meta.size > 0`. Vale para 200, 206 e 416 e para `HEAD`; não vale para 304 nem para erros (PRD, premissas).
- 206: `Content-Range: bytes <start>-<end>/<size>` e `Content-Length: <end - start + 1>` são definidos com `event.res.headers.set`, sobrescrevendo inclusive o valor de `options.headers` (`src/utils/static.ts:105-114`). Isso é necessário: um 206 com `Content-Length` do arquivo inteiro está incorreto.
- 416: `Content-Range: bytes */<size>`, `Content-Length: 0`, corpo `null` (PRD RF-04).
- O teste existente `test/static.test.ts:600-617` ("does not overwrite a content-length") usa HEAD sem Range e continua válido, porque o caminho 200 não muda.

**Alternativas consideradas:** passar esses cabeçalhos em `new HTTPResponse(..., { headers })`. Não funciona de forma confiável: `src/response.ts:218-228` mescla `event.res.headers` por cima dos cabeçalhos do `HTTPResponse`, então um `Content-Length` já definido em `event.res` venceria. Usar `event.res.headers` é o caminho que o código já usa.

### D-08 — `HEAD` com Range

**Decisão:** `HEAD` passa pela mesma avaliação. 206 e 416 são devolvidos com os mesmos cabeçalhos e corpo `null` (RF-05). O atual retorno antecipado de HEAD (`src/utils/static.ts:272-274`) passa a ser o último ponto de decisão, depois da avaliação de Range.

### D-09 — Erros e fallthrough

**Decisão:** o Range nunca lança erro. Malformado, outra unidade ou múltiplos intervalos resultam em 200. Não satisfazível resulta em 416, que é uma resposta de asset encontrado e, portanto, não usa `fallthrough` (o `fallthrough` só governa 404 e 405, `src/utils/static.ts:116-122` e `:210-215`).

---

## Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Lógica de Range em `serveStatic` (após `src/utils/static.ts:270`, antes de `src/utils/static.ts:272`) e helpers privados no fim do módulo (após `src/utils/static.ts:280`). |
| `test/static.test.ts` | Novo `describeMatrix` "serve static range requests" entre `test/static.test.ts:624` e `test/static.test.ts:626`. Testes existentes não mudam. |

Arquivos que **não** mudam (confirmados):
- `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Nada novo entra aqui (RF-09).
- `test/unit/package.test.ts:133` tem um snapshot da lista de exports, que já protege RF-09. Deve passar sem alteração.
- `src/response.ts` não muda. Os cabeçalhos da resposta parcial são definidos via `event.res.headers` (D-07).
- `src/rules/cache.ts:146-149` já ignora requisições com `Range` no cache de regras. Isso é desejado: uma resposta parcial não pode virar a entrada de cache do recurso inteiro. Nenhuma mudança necessária.

---

## Contratos e assinaturas

Nenhuma assinatura pública muda: `serveStatic(event, options)` (`src/utils/static.ts:101-104`), `ServeStaticOptions` (`src/utils/static.ts:17-66`) e `StaticAssetMeta` (`src/utils/static.ts:9-15`) ficam como estão.

Internos novos, **não exportados**, em `src/utils/static.ts`:

```ts
/** Intervalo de bytes inclusivo, já validado contra o tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * `ByteRange` quando o Range é atendível; `"unsatisfiable"` quando é válido mas
 * fora do asset (416); `undefined` quando deve ser ignorado (200 completo).
 */
type RangeOutcome = ByteRange | "unsatisfiable" | undefined;

/** Interpreta `Range` para um asset de `size` bytes (RFC 9110 §14.1.1, §14.2). */
function parseRange(header: string, size: number): RangeOutcome;

/** Avalia `If-Range` contra os validadores atuais (RFC 9110 §13.1.5). */
function ifRangeMatches(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/**
 * Devolve somente o trecho pedido. `ReadableStream` é lido apenas até `end`.
 * Demais tipos são fatiados em memória.
 */
function sliceBody(
  contents: BodyInit | null | undefined,
  range: ByteRange,
): Promise<BodyInit | null>;

/** Descarta `start` bytes de `stream` e emite `length` bytes, sem ler além do necessário. */
function takeBytes(
  stream: ReadableStream<Uint8Array>,
  start: number,
  length: number,
): ReadableStream<Uint8Array>;
```

Fluxo sugerido dentro de `serveStatic`, depois de `src/utils/static.ts:270`:

```ts
// Sketch: não é o código final.
const size = meta.size;
const encoded = id !== assetId || !!event.res.headers.get("content-encoding");
if (size && size > 0 && !encoded) {
  // Accept-Ranges só com tamanho conhecido (D-07)
  // Range só avaliado sem codificação (D-05)
  // If-Range -> parseRange -> 206 / 416 / 200 (D-03, D-04)
}
```

Notas de implementação:
- `event.req.headers.get("range")` e `event.req.headers.get("if-range")` são as fontes dos valores.
- Para `HEAD` (`src/utils/static.ts:272-274`), o 206/416 sai sem corpo.
- `mtimeDate` só existe se `meta.mtime` foi informado; `If-Range` com data sem `mtime` não casa.

---

## Estratégia de testes

Alvo: `test/static.test.ts`, novo `describeMatrix` (modos `web` e `node`, `test/_setup.ts:11`). Fixture própria:
- `getMeta` retorna `{ type: "text/plain", etag: "\"abc\"", mtime: 1_700_000_000_000, size: 1000 }`. ETag **forte** e sem `encoding`, para não cair em D-05 e para exercitar If-Range forte.
- `getContents` retorna `"0123456789".repeat(100)`. Como os caracteres são ASCII, byte e caractere coincidem.
- Sem `encodings` configurado.

**Escrever os testes antes da implementação** e confirmar que falham (fluxo de bug fix de `AGENTS.md`, aplicado a feature).

Casos (cada um mapeado a um RF):

| Teste | RF | Esperado |
| --- | --- | --- |
| GET sem Range | RF-01 | 200, corpo completo, `accept-ranges: bytes` |
| HEAD sem Range | RF-01 | 200, `accept-ranges: bytes`, sem corpo |
| `bytes=0-99` | RF-02 | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo = bytes 0–99 |
| `bytes=900-` | RF-02 | 206, `bytes 900-999/1000`, `content-length: 100` |
| `bytes=-100` | RF-02 | 206, `bytes 900-999/1000` |
| `bytes=-5000` | RF-02 | 206, `bytes 0-999/1000`, corpo completo |
| `bytes=0-10,20-30` | RF-03 | 200 completo, sem `content-range` |
| `items=0-10` | RF-03 | 200 completo |
| `bytes=abc`, `bytes=5-3`, `bytes=-` | RF-03 | 200 completo |
| `Bytes=0-99` (caixa) | RF-02 | 206 |
| `bytes=2000-3000` | RF-04 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| `bytes=-0` | RF-04 | 416 |
| `HEAD` com `bytes=0-99` | RF-05 | 206, cabeçalhos iguais ao GET, corpo vazio |
| `HEAD` com `bytes=2000-` | RF-05 | 416, corpo vazio |
| If-Range com ETag diferente | RF-06 | 200 completo |
| If-Range com o ETag atual | RF-06 | 206 |
| If-Range com ETag fraco `W/"abc"` | RF-06 | 200 completo (fraco nunca casa) |
| If-Range com data exata do `last-modified` | RF-06 | 206 |
| If-Range com data diferente | RF-06 | 200 completo |
| If-Range com `bytes=2000-` e ETag errado | RF-06 | 200 (If-Range falha antes do 416) |
| `size` ausente no meta, e `size: 0` | RF-07 | 200 completo, sem `accept-ranges` |
| `If-None-Match` igual + Range válido | RF-08 | 304 |
| Range com `fallthrough: true` e asset inexistente | RF-08 | `undefined` (cai no próximo handler) |
| Range com `options.headers` `content-length: 999` | D-07 | 206 com `content-length` do trecho |
| `ReadableStream` como `getContents` | D-06 | 206 com bytes corretos; `start` no meio do stream |
| `Blob` como `getContents` | D-06 | 206 com bytes corretos |
| Variante `.gz` com `accept-encoding: gzip` | D-05 | 200 completo, sem `content-range` |
| Teste de regressão: GET sem Range com variante `.gz` | RF-08 | igual a hoje |

Os testes existentes em `test/static.test.ts` devem continuar passando sem mudança. Eles não enviam `Range`, e o caminho 200 não muda.

**Comandos:**
- antes da mudança: `pnpm vitest run test/static.test.ts test/unit/package.test.ts test/security.test.ts` (baseline verde);
- durante: `pnpm vitest run test/static.test.ts` (novos testes vermelhos, depois verdes);
- depois: `pnpm vitest run test/static.test.ts test/unit/package.test.ts test/security.test.ts`, depois `pnpm test` (lint, typecheck e cobertura, `package.json:53`).

---

## Riscos

1. **Memória com `ReadableStream`.** Mitigado por D-06 (streaming). O custo residual é ler do disco até `end`: um seek para o fim de um arquivo grande ainda percorre o arquivo. Aceitável e documentado.
2. **`meta.size` divergente do corpo.** Se `size` não corresponder aos bytes reais (PRD, premissas), a fatia sai errada e o `Content-Length` não bate com o corpo. Mitigação parcial: a fatia é calculada pelo `size` (como a RFC pede para o representation length). Não há verificação de consistência no caminho de `ReadableStream`, porque isso exigiria ler o corpo inteiro. Registrar no JSDoc de `StaticAssetMeta.size`.
3. **Codificação (D-05).** Decisão que diverge da premissa do PRD. Precisa de confirmação do responsável antes de implementar.
4. **Cabeçalhos de `options.headers`.** Um `content-range` configurado pelo usuário é sobrescrito quando há 206/416. Comportamento intencional; coberto por teste de `content-length` (D-07).
5. **If-Range com ETag fraco.** Coberto por teste específico (tabela acima). Atenção: as fixtures existentes usam `etag: "w/123"` (`test/static.test.ts:15`), que é fraco. Os testes novos usam ETag forte.
6. **Tamanho do `static.ts`.** Passa de ~350 para ~450 linhas, acima da convenção de `AGENTS.md`. Aceito por D-01. Se o projeto quiser dividir depois, `parseRange` e `ifRangeMatches` são candidatos naturais a `src/utils/internal/range.ts`, sem mudança de API.
7. **Node e HEAD.** A resposta 206 com `HEAD` em Node (`src/response.ts:234-240` remove o corpo, mas o `content-length` precisa estar correto). Coberto pelos testes do modo `node`.
8. **Intermediários e cache.** Respostas 206 dependem de `Vary` para cache compartilhado. O `vary: accept-encoding` já é definido quando há encodings configurados (`src/utils/static.ts:220-225`). Sem encodings, não há variação de representação, então nada novo é necessário.
9. **Regressão silenciosa em 304 e 404.** Coberta pelos testes de RF-08 e pelos testes existentes, que não mudam.

## Pendências para confirmação

- **D-05:** confirmar se o Range deve ser ignorado para variantes codificadas (recomendado) ou se deve seguir a premissa do PRD.
</content>
