# Especificação técnica: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (issue e contrato), `sdd/prd.md` (RF-01 a RF-10 e premissas 1 a 6), `AGENTS.md` (convenções e fluxo de bug fix), RFC 9110 seção 14 (Range), seção 13.1.5 (If-Range) e seção 13.2.2 (ordem de avaliação das pré-condições).

Premissas de trabalho, herdadas do PRD: `getMeta` informa o `size` da representação servida; `getContents(id)` devolve o corpo completo e não recebe o intervalo; 304 é avaliado antes de Range; `bytes=-0` vira 416; `size` 0 ou ausente desliga Range.

## Diagnóstico do código atual

- `serveStatic` nunca lê `Range`: o fluxo termina em `src/utils/static.ts:272-277`, que responde `200` (HEAD sem corpo, GET com `getContents`).
- O `Content-Length` só é definido com `size > 0` e somente se ainda não existir na resposta (`src/utils/static.ts:268-270`). Isso preserva um `content-length` vindo de `options.headers` (teste em `test/static.test.ts:600-617`). Para 206 essa regra precisa ser sobrescrita de propósito, porque o tamanho tem de ser o do trecho.
- O 304 já é calculado antes dos cabeçalhos de conteúdo (`src/utils/static.ts:243-248`), o que coincide com a premissa 3.
- A cache de rotas (`src/rules/cache.ts:146-149`) já ignora pedidos com `Range`, então respostas parciais não entram no cache de `h3/rules/cache`. Nenhuma mudança é necessária lá.
- Não existe nenhuma lógica de Range no restante de `src/` (busca por `range`, `206`, `416`, `accept-ranges` retornou só os casos acima).

## Decisões de arquitetura

### D-01 — Implementação dentro de `src/utils/static.ts`, sem módulo novo

**Contexto.** O contrato (`sdd/pedido.md`, "Não pode mudar") e o PRD (RF-10) exigem que os auxiliares fiquem privados ao módulo, sem `export`. `AGENTS.md` pede arquivos com menos de 200 linhas e helpers "no fim do arquivo ou em `utils/internal/`".

**Alternativas.**
1. Criar `src/utils/internal/range.ts` com as funções exportadas e importá-las em `static.ts`.
2. Manter tudo em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`.

**Escolha: 2.** A alternativa 1 exige `export` para o import funcionar, o que contraria o contrato literal. O custo é o arquivo passar de ~352 para ~450 linhas, acima da recomendação do `AGENTS.md`. Isso fica registrado em Riscos (R-06). `src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`.

### D-02 — Ordem de avaliação: 304, depois Accept-Ranges, depois If-Range, depois Range

**Contexto.** RFC 9110 §13.2.2 coloca If-None-Match antes de If-Range, e If-Range antes de Range. Pela §13.1.5, se o If-Range não bate, o servidor deve ignorar o Range inteiro, inclusive a checagem de satisfazibilidade. Portanto um Range inválido com If-Range divergente responde `200`, e não `416`.

**Alternativas.**
1. Checar satisfazibilidade (416) antes de If-Range.
2. Checar If-Range antes de satisfazibilidade (RFC).

**Escolha: 2.** Segue a norma e a regra do PRD (RF-08 com RF-04). A ordem final no `serveStatic` fica:
- 304 por If-None-Match ou If-Modified-Since (já existe, `src/utils/static.ts:243-248`);
- Range ignorado por sintaxe (unidade, multi-range, malformado, início maior que fim);
- If-Range divergente, que ignora o Range;
- 416 ou 206.

### D-03 — Avaliação do Range como função pura com resultado tri-estado

**Alternativas.**
1. Função que lança `HTTPError` para 416 e devolve `undefined` para ignorar.
2. Função que devolve um resultado discriminado: `ignore`, `unsatisfiable` ou `partial` com `start` e `end` inclusivos.

**Escolha: 2.** Mantém a parte sintática testável sem I/O e deixa o `serveStatic` decidir o status. Não usa `HTTPError` porque 416 precisa de `Content-Range` e de `Content-Length: 0` sem corpo, o que `errorResponse` (`src/response.ts:358-380`) não cobre bem.

### D-04 — Sintaxe de Range aceita e rejeitada

Regras, na ordem em que a função as aplica:
1. O valor é aparado (`trim`). O nome da unidade é comparado sem diferenciar maiúsculas (`bytes`, `Bytes`), conforme RFC 9110 §14.1. Unidade diferente de `bytes` gera `ignore`.
2. Com exatamente uma especificação: vírgula no valor gera `ignore` (multi-range, contrato item 5).
3. A especificação deve casar com `^(\d*)-(\d*)$`. Ambos os lados vazios, como em `bytes=-` ou `bytes=`, geram `ignore`.
4. Sufixo (`bytes=-n`, lado esquerdo vazio): se `n === 0` vira `unsatisfiable` (premissa 4). Se `n > 0`, `start = max(0, size - n)` e `end = size - 1`.
5. Início aberto ou fechado (`bytes=a-` ou `bytes=a-b`): se `b` existe e `b < a`, gera `ignore` (contrato item 5). Caso contrário `end = b` ou `size - 1`, e depois `end = min(end, size - 1)`.
6. Se `start >= size`, gera `unsatisfiable` (RF-04). Caso contrário, `partial`.

Números com mais de 15 dígitos perdem precisão, mas o resultado continua correto: início enorme cai no caso 6 e fim enorme é limitado pelo `min`.

**Alternativas para `bytes=-0`.** Tratar como `ignore` (200) ou como `unsatisfiable` (416). **Escolha: 416**, conforme premissa 4 e RFC 9110 §14.1.1.

### D-05 — If-Range com comparação forte

Regras de `matchesIfRange(ifRange, validators)`:
- Se o valor começa com `W/`, não casa (weak nunca casa com If-Range).
- Se o valor começa com `"`, casa somente quando `validators.etag` existe, não começa com `W/` e é idêntico ao valor (comparação byte a byte, forte).
- Caso contrário, o valor é tratado como HTTP-date: casa quando `validators.mtime` existe e `Date.parse(valor)` é igual ao `mtime` já truncado para segundos (`src/utils/static.ts:227-232`). Data inválida (`NaN`) não casa.

**Alternativas.** Aceitar etag sem aspas, ou comparar com `matchETag` de `src/utils/internal/cache.ts:11-17`. **Escolha: comparação forte própria.** `matchETag` é fraca (ignora `W/`), e o contrato exige comparação forte (RF-08). Ao casar a data por igualdade exata, a checagem de "Last-Modified com pelo menos 1 segundo de idade" da RFC 9110 §13.1.5 não é feita. Está em Riscos (R-04) e fora do contrato.

### D-06 — Cabeçalhos Accept-Ranges e Content-Range

- `accept-ranges: bytes` é definido junto com `etag` e `last-modified`, antes do 304 (`src/utils/static.ts:239-241`), com guarda `has` como os demais. Assim aparece em 200, 206, 304 e 416 para todo asset encontrado (RF-01). Não aparece em 404 nem 405, porque nesses casos o asset não foi encontrado ou o método não é aceito.
- `content-range` e `content-length` são definidos em `event.res.headers` com `set`, e não com `append`. Em 206, `content-length` sobrescreve o valor de `src/utils/static.ts:268-270`, porque precisa ser o tamanho do trecho (RF-03). Isso muda o comportamento de `options.headers["content-length"]` somente quando um Range é aplicado. O teste de `test/static.test.ts:600-617` continua válido, pois não há Range nele.

**Justificativa para usar `event.res.headers`.** Em `src/response.ts:201-204`, cabeçalhos preparados (`event.res.headers`) são mesclados com os de um `HTTPResponse` por `mergeHeaders` (`src/response.ts:243-252`), e os preparados sobrescrevem. O caminho de `HTTPResponse` não passa pelo filtro de erro `status >= 400` (`src/response.ts:211-213`), que só vale para `Response` já pronto. Logo, 416 recebe os cabeçalhos do `event.res.headers` como qualquer outra resposta.

### D-07 — Corte do corpo sem API de intervalo

**Contexto.** `getContents(id)` não recebe intervalo (PRD, premissa 2). O corte acontece sobre o corpo devolvido.

**Alternativas.**
1. Ler tudo em `ArrayBuffer` e fatiar.
2. Fatiar por tipo: `Blob.slice`, `subarray` para buffers e strings codificadas, `TransformStream` para `ReadableStream`, e `new Response(body).arrayBuffer()` como fallback para os demais tipos de `BodyInit`.
3. Mudar `getContents` para receber o intervalo (fora de escopo).

**Escolha: 2.** O custo de memória fica restrito aos tipos que não são stream (documentado em R-01). Para `ReadableStream`, o corte descarta bytes antes de `start` e encerra a leitura ao chegar em `end`, mas ainda lê a partir do início, pois a fonte não sabe pular. Isso confirma o alerta da premissa 2.

### D-08 — 416 sem corpo e com `Content-Length: 0`

Resposta `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `content-range: bytes */<size>` e `content-length: 0` em `event.res.headers`. Os demais cabeçalhos de conteúdo e cache seguem o fluxo normal. A RFC não exige removê-los, e manter `etag` e `cache-control` evita divergência entre 200 e 416 para o mesmo asset.

### D-09 — Range em HEAD

Mesmos status e cabeçalhos do GET, sem corpo e sem chamar `getContents`. Isso mantém a regra atual (`src/utils/static.ts:272-274`) e reduz o custo do HEAD.

### D-10 — `size` 0 ou ausente desliga Range

Range só é avaliado com `meta.size !== undefined && meta.size > 0` (premissa 5 e RF-02). Para `size` 0 a RFC 9110 sugeriria 416; essa divergência é deliberada e fica em "Pontos a confirmar" (P-02).

## Fluxo proposto em `serveStatic`

Ordem final dos blocos, com as linhas atuais como âncora:

1. Após `src/utils/static.ts:241` (etag): definir `accept-ranges: bytes` com guarda `has`.
2. `src/utils/static.ts:243-248`: 304, sem alteração.
3. `src/utils/static.ts:250-266`: content-type, content-encoding, sem alteração.
4. `src/utils/static.ts:268-270`: content-length do asset completo, sem alteração.
5. Novo bloco logo após a linha 270 e antes do HEAD (`src/utils/static.ts:272`):
   - se `meta.size > 0`, resolver Range com `resolveRange(event.req.headers, meta.size, { etag: meta.etag, mtime: mtimeDate })`;
   - `unsatisfiable`: definir `content-range` e `content-length: 0`, responder 416;
   - `partial`: definir `content-range` e `content-length` do trecho, responder 206; para GET, o corpo vem de `sliceBody(await options.getContents(id), start, end + 1)`; para HEAD, o corpo é `null`;
   - `ignore`: segue para o HEAD ou GET atuais.
6. `src/utils/static.ts:272-277`: HEAD e GET sem alteração no caminho `ignore`.

## Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Bloco de `accept-ranges` após `src/utils/static.ts:241`; bloco de Range após `src/utils/static.ts:270`; helpers privados na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), após `idSearchPaths` (`src/utils/static.ts:340-351`). |
| `test/static.test.ts` | Novo `describeMatrix("serve static range", ...)` ao final do arquivo, depois do último bloco existente (`describe("serve static (malformed url)")`, que começa em `test/static.test.ts:626`). Nenhum teste existente é alterado. |

Não alterar: `src/index.ts` (`src/index.ts:193` permanece), `src/response.ts`, `src/rules/cache.ts`, `src/utils/internal/cache.ts`, `test/unit/package.test.ts` (o snapshot de exportações em `test/unit/package.test.ts:4-6` e `:133` precisa continuar idêntico).

## Contratos e assinaturas

Tipos e funções são privados ao módulo, sem `export`:

```ts
// Resultado da avaliação do Range. `end` é inclusivo.
type RangeOutcome =
  | { kind: "ignore" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; start: number; end: number };

// Lê Range e If-Range; devolve "ignore" quando o Range não se aplica.
function resolveRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; mtime?: Date },
): RangeOutcome;

// Sintaxe de um único intervalo `bytes=...`; não lê If-Range.
function parseRangeValue(value: string, size: number): RangeOutcome;

// Comparação forte de If-Range (D-05).
function matchesIfRange(
  ifRange: string,
  validators: { etag?: string; mtime?: Date },
): boolean;

// Recorta o corpo em bytes [start, endExclusive). Devolve null quando `body` é null/undefined.
async function sliceBody(
  body: BodyInit | null | undefined,
  start: number,
  endExclusive: number,
): Promise<BodyInit | null>;
```

Contrato externo, sem mudança:
- `serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>` (`src/utils/static.ts:101-104`).
- `StaticAssetMeta` e `ServeStaticOptions` (`src/utils/static.ts:9-66`) não ganham campos.
- `getMeta` e `getContents` mantêm a assinatura (`src/utils/static.ts:25`, `:33`).

Valores de cabeçalho e status produzidos:

| Caso | Status | Cabeçalhos principais | Corpo |
| --- | --- | --- | --- |
| Sem Range, ou Range ignorado | 200 | `accept-ranges: bytes`, `content-length` do asset completo | completo (GET) ou vazio (HEAD) |
| Range parcial válido | 206 | `content-range: bytes a-b/size`, `content-length: b-a+1` | trecho (GET) ou vazio (HEAD) |
| Range não satisfazível | 416 | `content-range: bytes */size`, `content-length: 0` | vazio |
| 304 | 304 | igual ao atual | vazio |

## Estratégia de testes

Seguindo o fluxo de bug fix do `AGENTS.md`, os testes de regressão são escritos antes da implementação e precisam falhar sem o código novo. Todos usam `describeMatrix` (web e node) e um app `H3` com `serveStatic`, como em `test/static.test.ts:5-31`.

Testes novos em `test/static.test.ts`, bloco `describeMatrix("serve static range", ...)`:

1. **RF-01:** GET sem Range em asset encontrado tem `accept-ranges: bytes` e status 200; 404 não tem `accept-ranges`.
2. **RF-02:** `bytes=100-199`, `bytes=900-`, `bytes=-100` em asset de 1000 bytes dão 206 com os bytes esperados.
3. **RF-03:** `bytes=500-2000` dá `content-range: bytes 500-999/1000`, `content-length: 500`, corpo de 500 bytes.
4. **RF-04:** `bytes=1000-1100` dá 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. Inclui `bytes=-0` (P-01 a confirmar, mas o teste reflete D-04).
5. **RF-05:** `bytes=0-9,20-29`, `items=0-9`, `bytes=abc`, `bytes=500-100`, `bytes=` e `bytes=-` dão 200 sem `content-range` e com corpo completo.
6. **RF-06:** HEAD com `bytes=0-9` dá 206 com cabeçalhos corretos e corpo vazio; HEAD não invoca `getContents` (espião do `vi.fn`); HEAD com 416 segue a mesma regra.
7. **RF-07:** `app.js` de 1000 bytes e `app.js.gz` de 300 bytes, `accept-encoding: gzip`, `bytes=0-99` dá 206, `content-encoding: gzip`, `content-range: bytes 0-99/300`, `content-length: 100`.
8. **RF-08:** If-Range com etag divergente dá 200 completo; etag igual dá 206; `W/"abc"` dá 200 mesmo sendo igual ao etag forte; If-Range com data igual ao `last-modified` dá 206; com data diferente dá 200; If-Range com unidade inválida dá 200.
9. **RF-09:** If-None-Match igual ao etag com Range dá 304 sem corpo; POST com `fallthrough: false` continua 405 com `allow: GET, HEAD`; cabeçalhos `etag`, `last-modified`, `cache-control`, `vary`, `content-type`, `content-encoding` são iguais entre 200 e 206.
10. **Tamanho zero ou ausente:** `getMeta` com `size: 0` e sem `size` ignora Range e responde 200.
11. **Corte de stream:** `getContents` devolvendo `ReadableStream`, `Blob`, `Uint8Array`, `ArrayBuffer` e `string` com UTF-8 multibyte; o trecho deve ser idêntico ao esperado em todos os casos.
12. **RF-10:** `test/unit/package.test.ts` continua passando sem mudar o snapshot.

Verificação de regressão e qualidade:
- `pnpm vitest run test/static.test.ts` (novos e existentes).
- `pnpm vitest run test/unit/package.test.ts`.
- `pnpm vitest run test/rules` (o cache de rotas ignora Range; esses testes precisam continuar verdes).
- `pnpm lint` (`oxlint . && oxfmt --check .`).
- `pnpm typecheck` (`tsc --noEmit`). Atenção a `new Uint8Array(...)` como `BodyInit` com os genéricos de `ArrayBufferLike` (R-07).
- `pnpm test` completo antes de encerrar.

## Riscos

- **R-01 (alto): corte de corpo sem API de intervalo.** Para `string`, `ArrayBuffer`, `Uint8Array` e tipos de fallback, o corpo inteiro é lido em memória antes do corte. Para `ReadableStream`, a leitura começa do início do arquivo. Mitigação: `Blob.slice` e stream com `terminate` após `end`; documentar no JSDoc de `sliceBody` e na descrição do PR. A otimização completa fica fora do escopo (PRD).
- **R-02 (médio): `size` diferente do corpo real.** Se `getMeta.size` não bater com o tamanho real do corpo, o `content-length` do 206 fica incorreto. Mitigação: confiar no `size` do contrato (premissa 1). Sugestão de teste: corpo menor que o `size` não deve travar o cliente; decidir na revisão se vale checar o tamanho do trecho antes de responder.
- **R-03 (médio): ordem de avaliação.** Combinar If-None-Match, If-Range e Range pode gerar respostas erradas. Mitigação: D-02 e a matriz do teste 8 e do teste 9.
- **R-04 (baixo a médio): If-Range com data sem a regra de idade mínima.** A RFC 9110 §13.1.5 só aceita data como validador forte se o `Last-Modified` for pelo menos 1 segundo anterior ao `Date` da resposta. D-05 compara por igualdade exata, como pede o PRD, sem essa checagem. Fica como pendência de norma (P-03).
- **R-05 (médio): regressão em cache e encoding.** Mudanças em `static.ts` podem afetar 304, `vary` e a escolha de variante. Mitigação: testes existentes continuam verdes e os novos cobrem o mesmo caminho.
- **R-06 (baixo): tamanho do arquivo.** `src/utils/static.ts` vai a ~450 linhas, contra a recomendação de `AGENTS.md`. Aceito por D-01. Refatorar em módulo privado exigiria `export`, o que o contrato proíbe.
- **R-07 (baixo): tipos.** `Uint8Array` com `ArrayBufferLike` pode não casar com `BodyInit` no `tsc`. Mitigação: anotar `Uint8Array<ArrayBuffer>` ou copiar para um `ArrayBuffer` novo, se o typecheck reclamar.
- **R-08 (baixo): runtimes.** `ReadableStream`, `Blob`, `TextEncoder` e `Response` são APIs web padrão e estão disponíveis em Node 20.19+ (`package.json`, `engines`), Bun, Deno, Workers e navegadores. Testes em web e node via `describeMatrix` cobrem o caminho.
- **R-09 (baixo): override de `content-length` de `options.headers`.** Só ocorre em 206, e é deliberado (D-06). Documentar no JSDoc de `serveStatic`, se a revisão achar necessário.

## Pontos a confirmar

- **P-01:** `bytes=-0` como 416 (D-04). Premissa 4 do PRD, a confirmar pelo responsável.
- **P-02:** `size` 0 ignora Range, em vez de 416 como sugere a RFC 9110 (D-10). Premissa 5 do PRD, a confirmar.
- **P-03:** If-Range com data sem a regra de idade mínima (R-04). Aceitar como divergência documentada ou implementar a regra.
- **P-04:** 416 mantém os cabeçalhos de cache e conteúdo (D-08). Confirmar que não há exigência contrária no contrato.
