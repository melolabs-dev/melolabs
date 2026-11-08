# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (issue e contrato enxuto) e `sdd/prd.md` (RF-01 a RF-10). Norma: RFC 9110, §13.1.5 (If-Range) e §14 (Range Requests).

Este documento não altera código. Ele fixa as decisões de implementação e aponta onde cada mudança entra.

## 1. Estado atual

- `serveStatic` ignora `Range`. A resposta de asset encontrado sempre sai com `200`, vinda de `getContents` (`src/utils/static.ts:276-277`), e `HEAD` sai com `200` e sem corpo (`src/utils/static.ts:272-274`).
- `Accept-Ranges` não é definido em lugar nenhum do módulo.
- `content-length` só é definido quando ainda não existe no response e `size > 0` (`src/utils/static.ts:268-270`). Esse comportamento precisa ser preservado no `200`, e o teste que o fixa está em `test/static.test.ts:600-617`.
- A ordem atual é: método (`:116-122`), canonicidade do caminho (`:142-147`), busca de meta (`:198-215`), `vary` (`:220-225`), `last-modified` e `etag` (`:227-241`), 304 via `isCacheMatch` (`:243-248`), `content-type`, `content-encoding`, `content-length` (`:250-270`), HEAD e GET (`:272-277`).
- `isCacheMatch` (`src/utils/internal/cache.ts:29-49`) cuida só de condicionais de cache (If-None-Match e If-Modified-Since). Não há nada para If-Range.
- `matchETag` (`src/utils/internal/cache.ts:11-17`) usa comparação fraca. Para If-Range a comparação precisa ser forte, então não serve diretamente.
- `ServeStaticOptions.getMeta` devolve `size?: number` (`src/utils/static.ts:13`, `:25`). O contrato do `size` em bytes não está documentado.
- O único uso de `Range` no repositório é `src/rules/cache.ts:143-148`: a regra de cache ignora requisições com `Range` e as deixa passar para a cadeia. Isso não muda com esta entrega.

## 2. Decisões de arquitetura

### D-01 — Onde ficam os helpers de Range

**Escolha:** helpers privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`. `src/index.ts` não muda (`src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`).

**Alternativas:**
- Criar `src/utils/internal/range.ts`. Segue a convenção do AGENTS.md (helpers internos em `utils/internal/`) e mantém `static.ts` menor.
- Helpers em `static.ts` (escolhida).

**Justificativa:** a issue pede explicitamente que "toda a lógica de auxílio fique privada dentro do módulo serveStatic", e o PRD (RF-09) repete isso. O requisito explícito vence a convenção de tamanho. O custo é que `static.ts` passa de 351 para cerca de 450 linhas, acima da meta de 200 linhas do AGENTS.md. Isso fica registrado em Riscos (R-07).

### D-02 — Interpretação de `Range` (parser)

**Escolha:** função privada `parseRange` que aceita apenas um intervalo `bytes`:

- A unidade `bytes` é comparada sem diferença de maiúsculas e minúsculas. Espaços ao redor de `=`, vírgulas e do intervalo são tolerados.
- Formas aceitas: `a-b`, `a-` e `-n`, com dígitos em ASCII.
- Lista com mais de um intervalo: ignorar (200 completo). Elementos vazios da lista são descartados, como a regra de lista da RFC.
- `a > b`, unidade diferente, sintaxe inválida ou número com sinal: ignorar (200 completo).
- Após o parse, aplicam-se as regras de satisfazibilidade:
  - `a-b` com `a >= size` ou `size === 0`: não satisfazível. Se `b >= size`, o fim vira `size - 1`.
  - `a-` com `a >= size`: não satisfazível; caso contrário, vai de `a` até `size - 1`.
  - `-n` com `n === 0` ou `size === 0`: não satisfazível. Se `n > size`, o intervalo é o arquivo inteiro.

**Alternativas:** usar uma biblioteca de parse de Range. Foi descartada para não adicionar dependência ao núcleo, que tem só `rou3` e `srvx` (AGENTS.md, "Dependencies").

**Justificativa:** a sintaxe de Range cabe em uma expressão regular e uma checagem de ordem. O parser devolve um valor tipado, sem exceções, e a decisão "ignorar" fica separada da decisão "416".

### D-03 — Ordem das avaliações

**Escolha:** a ordem é esta, dentro de `serveStatic`:

1. Após `etag` (`:239-241`), definir `accept-ranges: bytes` em `event.res.headers`. Assim a 304 também recebe o cabeçalho, como o `etag` e o `last-modified`. A PRD lista 200, 206, 416 e HEAD em RF-01, mas usa "toda resposta de asset encontrado", então incluir a 304 segue a PRD.
2. 304 via `isCacheMatch` (`:243-248`), sem mudança. Vence sobre `Range`, como RF-07 exige.
3. Decidir o intervalo. Só há avaliação se o `Range` existir, `meta.size !== undefined` e a condicional `If-Range` (D-04) bater.
4. `content-type`, `content-encoding` e `content-length` do `200` (`:250-270`), sem mudança.
5. Se houver intervalo: `416`, `206` ou o `200` completo, conforme D-05 e D-06.

**Justificativa:** a 304 precisa continuar sendo a resposta de quem tem o conteúdo atual, mesmo quando o cliente manda `Range` (RF-07).

### D-04 — If-Range

**Escolha:** função privada `ifRangeMatches(value, validators)`:

- Sem cabeçalho `If-Range`: verdadeiro.
- Valor começando por `W/`: falso. Validador fraco nunca casa com If-Range.
- Valor entre aspas (ETag): verdadeiro só se for igual, byte a byte, ao `meta.etag` atual e este não for fraco.
- Outro valor: tenta `new Date(value)` e compara com `mtimeDate` (já truncado em segundos em `:227-232`) por `getTime()`. Data inválida ou `mtime` ausente: falso.

**Alternativas:** reaproveitar `matchETag` de `src/utils/internal/cache.ts:11`. Foi descartado porque é comparação fraca, e a RFC 9110 §13.1.5 exige forte para If-Range.

**Justificativa:** a retomada de download fica incorreta se o arquivo mudou entre as requisições (PRD, premissa 7). Em caso de dúvida o `Range` é ignorado, o que resulta em 200 completo, sempre seguro.

**Limitação conhecida:** a RFC só permite a comparação por data quando a data é forte (última modificação pelo menos um segundo antes do `Date` da resposta). Esta entrega não implementa essa checagem. Ver R-05.

### D-05 — Fatiamento do corpo

**Escolha:** função privada `sliceContents(contents, start, end)`, chamada só no GET, depois de `getContents`:

| Tipo de `BodyInit` | Fatiamento |
| --- | --- |
| `string` | `new TextEncoder().encode(s).subarray(start, end + 1)`. `size` tem que ser o tamanho em bytes UTF-8. |
| `ArrayBuffer` | `slice(start, end + 1)` |
| `ArrayBufferView` (TypedArray, DataView) | `new Uint8Array(view.buffer, view.byteOffset + start, end - start + 1)` |
| `Blob` | `blob.slice(start, end + 1)` |
| `ReadableStream` | descarta os primeiros `start` bytes, emite os bytes até `end` e cancela o restante da origem. Nunca lê o corpo inteiro na memória. |
| `FormData`, `URLSearchParams`, `null`, `undefined` | `undefined`: não fatiável. |

Quando o resultado é `undefined`, o GET responde o `200` completo, como hoje, sem alterar os cabeçalhos já definidos.

**Alternativas:**
- Ignorar `Range` para `ReadableStream` (como sugere a PRD, premissa 1). É mais simples, mas um arquivo servido como stream nunca responderia 206, e o caso de vídeo fica sem efeito para quem usa stream.
- Fatiamento por stream com descarte de prefixo (escolhida). Custo: para um seek até o fim de um arquivo grande, a origem é lida até `start`. Isso é lido e descartado, nunca guardado.
- Pedir ao `getContents` um intervalo. Mudaria a API pública (`ServeStaticOptions`), o que o PRD proíbe.

**Justificativa:** a escolha atende o objetivo da issue (vídeo e retomada) para os tipos de corpo que um asset real usa, sem mudar a API. `FormData` e `URLSearchParams` são serializados com fronteira aleatória, então os bytes mudam a cada chamada e não há intervalo estável. Por isso não fatiam.

**Decisão a confirmar:** a escolha de fatiar `ReadableStream` contraria a premissa 1 do PRD. Se o time preferir a regra mais simples, basta retornar `undefined` nesse ramo.

### D-06 — Cabeçalhos e status das respostas parciais

**Escolha:**

- `206`: `content-range: bytes <start>-<end>/<size>` e `content-length: <end - start + 1>`. O `content-length` é definido com `set`, substituindo qualquer valor já presente, como descreve PRD premissa 4. Só o `206` substitui: o `200` mantém a regra atual de `:268`.
- `416`: `content-range: bytes */<size>`, `content-length: 0`, corpo `null`, `statusText: "Range Not Satisfiable"`.
- `Content-Encoding`, `Content-Type`, `ETag` e `Last-Modified` seguem o que já foi definido em `:227-266`. Não há mudança nesses cabeçalhos.
- HEAD com intervalo válido: mesmos cabeçalhos do GET, `getContents` não é chamado e o corpo é `null`.

**Alternativas:** definir os cabeçalhos em `new HTTPResponse(..., { headers })`. Foi descartado. O código atual define tudo em `event.res.headers` (`:223`, `:235`, `:240`, `:252`, `:259`, `:265`, `:269`) e retorna só o status no `HTTPResponse`. Manter o mesmo padrão evita depender da precedência entre `event.res.headers` e `init.headers`.

**Justificativa:** consistência com o restante do arquivo. Os cabeçalhos ficam todos no mesmo lugar.

### D-07 — Interação com variantes pré-comprimidas

**Escolha:** o intervalo usa o `size` e o corpo da variante escolhida (`id`, não `originalId`). O `content-encoding` da resposta parcial é o mesmo da completa, pois ele vem de `meta.encoding` (`:264-266`), que já é o da variante.

**Justificativa:** é o que RF-08 define. A RFC permite, e a alternativa de ignorar `Range` em respostas comprimidas penalizaria clientes que combinam `Range` e `Accept-Encoding` sem necessidade.

### D-08 — Quando `getContents` devolve `null` com intervalo válido

**Escolha:** o GET cai no `200` completo com corpo `null`, exatamente como hoje (`:277`). O HEAD não chama `getContents`, então responde o `206` com base em `size`.

**Justificativa:** responder `206` com corpo vazio daria um `content-length` que não bate com o corpo. Essa inconsistência já existe no `200` atual, e corrigi-la fica fora deste escopo (R-03).

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Ajustar `getMeta` (JSDoc em `:25`) para documentar que `size` é o tamanho em bytes da variante. Inserir `accept-ranges` após `:241`. Inserir a avaliação de Range entre `:270` e `:272`, com HEAD e GET. Acrescentar os helpers privados no fim, após `:351`. |
| `test/static.test.ts` | Acrescentar `describeMatrix("serve static range requests", ...)`. Não alterar os testes existentes, salvo se algum falhar pela presença de `accept-ranges` (ver Estratégia de testes). |
| `sdd/techspec.md` | Este documento. |

Nenhum outro arquivo muda. `src/index.ts` e `src/_entries/*.ts` ficam intactos.

## 4. Contratos e assinaturas

Todos privados em `src/utils/static.ts`, sem `export`:

```ts
/** Resultado da avaliação de `Range`. `kind: "none"` significa resposta completa. */
type ByteRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; start: number; end: number }; // inclusivo

/** Interpreta o cabeçalho `Range` contra um asset de `size` bytes (D-02). */
function parseRange(header: string, size: number): ByteRange;

/** Avalia `If-Range` contra os validadores atuais (D-04). Sem cabeçalho, devolve `true`. */
function ifRangeMatches(
  value: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/** Fatia o corpo para [start, end] inclusivo (D-05). `undefined` quando não é fatiável. */
function sliceContents(
  contents: BodyInit | null | undefined,
  start: number,
  end: number,
): BodyInit | undefined;
```

Mudança em `serveStatic` (público, assinatura inalterada):

```ts
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Lógica do bloco novo (esboço, não código final):

```ts
// after the etag block, before isCacheMatch
event.res.headers.set("accept-ranges", "bytes");

// after content-length, before HEAD / GET
const range =
  event.req.headers.has("range") && meta.size !== undefined && ifRangeMatches(...)
    ? parseRange(event.req.headers.get("range")!, meta.size)
    : { kind: "none" };

if (range.kind === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
// partial: set content-range and content-length; HEAD returns 206 with no body;
// GET slices contents and falls back to the full 200 when sliceContents returns undefined.
```

Pontos de cuidado na implementação:

- No GET, `getContents` precisa ser chamado antes de definir `content-range` e `content-length` do `206`. Se o fatiamento devolver `undefined`, os cabeçalhos da parcial não podem ter ficado definidos, ou o `200` sai com `content-range`. Ou se calcula o corpo antes de tocar nos cabeçalhos, ou se remove os dois cabeçalhos no ramo de volta.
- `meta.size` é `number`, mas `parseRange` recebe `size` já checado contra `undefined`. Tipar com narrowing em vez de `!`.

## 5. Estratégia de testes

Seguindo o AGENTS.md (correção de bug: teste primeiro, falha confirmada, depois implementação), mas aqui é funcionalidade nova: os testes dos RF-02 a RF-06 são escritos e vistos falhando antes do código.

**Arquivo:** `test/static.test.ts`, bloco novo `describeMatrix("serve static range requests", ...)` (padrão de `test/static.test.ts:5` e `test/_setup.ts:11`). Roda em `web` e `node`.

**Fixture:** asset `"abcdefghij".repeat(100)` (1000 bytes), `getMeta` devolve `size: 1000`, `etag: "v1"`, `mtime` fixo, `type: "text/plain"`. `getContents` é `vi.fn`, para verificar que HEAD não o chama.

| Caso | RF | Verificação |
| --- | --- | --- |
| GET sem Range | RF-01 | 200, corpo completo, `accept-ranges: bytes` |
| `bytes=0-99` | RF-02 | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo com 100 bytes exatos |
| `bytes=-50` | RF-02 | 206, `bytes 950-999/1000`, 50 bytes |
| `bytes=990-5000` | RF-02 | 206, `bytes 990-999/1000`, `content-length: 10` |
| `bytes=-5000` | RF-02 | 206, `bytes 0-999/1000` (arquivo inteiro) |
| HEAD `bytes=0-99` | RF-03 | 206, cabeçalhos iguais, corpo vazio, `getContents` não chamado |
| `bytes=0-10,20-30`, `bytes=50-10`, `items=0-10`, `bytes=abc` | RF-04 | 200 completo, sem `content-range` |
| `getMeta` sem `size` com `bytes=0-99` | RF-04 | 200 completo |
| `bytes=1000-1100` | RF-05 | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| HEAD `bytes=1000-` | RF-05 | 416, `bytes */1000`, sem corpo |
| `bytes=-0` e asset de 0 bytes com `bytes=0-` | RF-05 | 416 |
| `If-Range: "v1"` | RF-06 | 206 |
| `If-Range: "v0"` e `If-Range: W/"v1"` | RF-06 | 200 completo |
| `If-Range` com data igual ao `last-modified` | RF-06 | 206 |
| `If-Range` com data diferente | RF-06 | 200 |
| `If-None-Match: "v1"` com Range | RF-07 | 304, sem `content-range` |
| POST com `fallthrough: false` | RF-07 | 405 com `allow: GET, HEAD` (já coberto em `:251`; reforçar com Range) |
| Asset inexistente com `fallthrough: true` e Range | RF-07 | `undefined`, o próximo handler responde |
| `encodings: { gzip: ".gz" }`, `app.js` 1000 bytes, `app.js.gz` 300 bytes, `Accept-Encoding: gzip` e `bytes=0-99` | RF-08 | 206, `bytes 0-99/300`, `content-encoding: gzip`, `content-type` de `app.js` |
| `Blob` e `ArrayBuffer` como corpo | D-05 | corpo com os bytes certos |
| `ReadableStream` como corpo, `bytes=500-599` | D-05 | 206, corpo com exatamente os bytes 500 a 599 |
| `FormData` como corpo com Range | D-05 | 200 completo |
| String com caractere multibyte e `size` em bytes UTF-8 | D-05 | 206 com os bytes corretos |
| `getContents` devolve `null` com Range (GET) | D-08 | 200, corpo `null` |

**Testes existentes:** `test/static.test.ts:42-54`, `:57-71`, `:199-217` e `:600-617` usam `toMatchObject` ou checam cabeçalhos específicos, então a presença de `accept-ranges` não quebra nenhum deles. Se algum quebrar, a mudança deve ser só no ponto que a mudança alterou (PRD RF-10), sem perder a verificação original.

**Exports (RF-09):** `test/unit/package.test.ts:4` faz snapshot de `src/_entries/generic.ts`, que reexporta `src/index.ts`. Ele captura um export novo. A verificação complementar é comparar a lista de exports de `src/index.ts` antes e depois, com um script simples no diff.

**Qualidade:** `pnpm vitest run test/static.test.ts`, `pnpm typecheck` e `pnpm lint`. Depois, `pnpm vitest run` na suíte inteira (`test/rules/` inclui o cache, que tem o bypass de `Range` em `src/rules/cache.ts:143-148`).

## 6. Riscos

- **R-01 — `size` divergente do corpo.** Se `getMeta.size` não for o tamanho real que `getContents` devolve, o `206` sai com `content-range` errado e o cliente reconstrói o arquivo com bytes trocados. Mitigação: JSDoc de `getMeta` (passo em `static.ts:25`) com o contrato "bytes da variante servida"; os testes de string multibyte cobrem o caso mais comum de erro.
- **R-02 — Custo de `ReadableStream` com `start` alto.** Para seek até o fim de um arquivo grande via stream, a origem é lida até `start` e os bytes são descartados. Não há como evitar sem mudar a API (`getContents` não recebe intervalo). Mitigação: documentar no JSDoc de `serveStatic`. Para `Blob`, `ArrayBuffer` e strings o custo é só o da cópia em memória.
- **R-03 — Corpo `null` com `size` conhecido.** Já existe no `200` atual (D-08). Esta entrega não corrige esse comportamento e apenas o preserva.
- **R-04 — Variantes comprimidas com Range.** Clientes que combinam `Range` e `Accept-Encoding` recebem bytes comprimidos parciais, que não descomprimem sozinhos. É permitido pela RFC e definido em RF-08 (PRD premissa 3). Recomendação: documentar no JSDoc; não bloqueia.
- **R-05 — If-Range por data sem checagem de força.** A RFC 9110 §13.1.5 exige que a data seja forte. Esta entrega compara por igualdade exata, sem essa checagem. Risco baixo: o pior caso é aceitar uma data que a RFC rejeitaria, o que pode devolver partes de versões diferentes só se o arquivo mudar no mesmo segundo do `last-modified`. Mitigação: se o time quiser rigor total, acrescentar a checagem de "pelo menos um segundo antes do `Date`".
- **R-06 — Caches intermediários e 206.** Não verificado como CDNs tratam `206` nesse caminho (PRD premissa 9). Não bloqueia a entrega.
- **R-07 — Tamanho de `static.ts`.** Com os helpers em `static.ts` (D-01), o arquivo passa a cerca de 450 linhas, acima da meta de 200 do AGENTS.md. Alternativa se o time preferir: `src/utils/internal/range.ts`, sem exportar nada novo.
- **R-08 — Diferença entre HEAD e GET para corpos não fatiáveis.** O HEAD não chama `getContents`, então para `FormData` ou `URLSearchParams` ele responde `206` enquanto o GET responde `200`. Esses tipos não são corpos realistas de asset. Mitigação: documentar; sem custo de código.
- **R-09 — Acesso ao `size` como bytes em `string`.** Os testes existentes usam `size: string.length`, que é contagem de caracteres. Para ASCII é igual. A fixture nova cobre multibyte para deixar explícito o contrato.
- **R-10 — Cabeçalhos da parcial no GET.** Se o fatiamento devolver `undefined` depois que `content-range` foi definido, o `200` sai com cabeçalhos errados. Mitigação: calcular o corpo antes de tocar nos cabeçalhos (seção 4).

## 7. Pontos para confirmar

1. `ReadableStream` com fatiamento por descarte de prefixo (D-05), em vez de ignorar `Range` como sugere PRD premissa 1.
2. Helpers em `static.ts` (D-01), mesmo acima da meta de tamanho (R-07).
3. `accept-ranges` também na 304 (D-03), que a PRD não lista explicitamente.
4. Checagem de força de data em If-Range (R-05), que hoje fica de fora.
