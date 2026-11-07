# Especificação técnica — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-13, premissas P1 a P4, riscos R1 a R4). Este documento não repete os cenários do PRD; ele decide como implementá-los e onde o código muda. As citações `arquivo:linha` foram conferidas no commit `468de6e`; esta revisão não as reconferiu, então devem ser checadas de novo antes da implementação.

## Visão geral

O `serveStatic` ganha suporte a `Range` para GET e HEAD, sem mudar nenhuma assinatura pública. A lógica pura (parsing de `Range`, avaliação de `If-Range`, recorte do corpo) vai para um módulo interno novo, `src/utils/internal/range.ts`. `src/utils/static.ts` apenas orquestra: decide a ordem entre cache, Range e corpo, e monta as respostas 206 e 416.

## Estado atual relevante

- `src/utils/static.ts:101` — `serveStatic(event, options)` é a única função pública afetada. Hoje, em sucesso, ela responde 200 (`src/utils/static.ts:277`) ou 200 sem corpo em HEAD (`src/utils/static.ts:273`); não há nenhum caminho 206 ou 416.
- `src/utils/static.ts:239-241` — ETag é definido só se o response ainda não o tem; `src/utils/static.ts:234-236` faz o mesmo com `last-modified`. Ou seja, os validadores que o cliente vê são os de `event.res.headers`, que podem vir de `options.headers`.
- `src/utils/static.ts:243-248` — 304 é avaliado com `isCacheMatch` antes de qualquer outra decisão. RF-08 pede exatamente essa precedência.
- `src/utils/static.ts:268-270` — `content-length` vem de `meta.size`, mas só quando `size > 0` e o header ainda não existe. Asset de tamanho zero não recebe `content-length` hoje.
- `src/utils/internal/cache.ts:29-49` — `isCacheMatch` já cuida de `If-None-Match`/`If-Modified-Since`. Não será alterado.
- `src/response.ts:198-205` — ao montar a `Response`, os headers de `event.res.headers` são mesclados sobre os headers do `HTTPResponse` (`mergeHeaders` em `src/response.ts:243`). Consequência: um `content-length` escrito em `event.res.headers` vence um `content-length` escrito no `HTTPResponse`. Isso fundamenta a D-06.
- `src/response.ts:304-306` — `HTTPResponse` é devolvido como está, com o status que ele carrega.
- `src/response.ts:350-356` — `nullBody` zera o corpo para HEAD, 204, 205 e 304. Para 206 e 416 o corpo passa normalmente.
- `src/index.ts:193` — única reexportação de `serveStatic`, `ServeStaticOptions` e `StaticAssetMeta`. Não muda.
- `test/unit/package.test.ts:4-5` — snapshot das exportações de `src/_entries/generic.ts`. É a guarda de RF-12: se ela mudar, algo público vazou.
- `src/utils/static.ts` já tem 351 linhas antes da mudança (ver R-04).

## Decisões de arquitetura

### D-01 — Lógica de Range em módulo interno, orquestração em `static.ts`

**Escolha:** criar `src/utils/internal/range.ts` com três funções puras e não exportadas pelo `index.ts`. `static.ts` importa delas e cuida só do fluxo HTTP.

**Alternativas consideradas:**
- *Tudo inline em `static.ts`.* Descartada: o arquivo já passa de 200 linhas (`src/utils/static.ts:351`), e parsing de `bytes=`, If-Range e recorte de `ReadableStream` somam bem mais que o orquestrador.
- *Novo utilitário público (`src/utils/range.ts` reexportado).* Descartada: RF-12 e `test/unit/package.test.ts:4-5` proíbem exportações novas.
- *Módulo em `src/utils/range.ts` sem reexportação.* Descartada: `src/utils/` é a área de API pública (AGENTS.md, "utils/ (public API)"); `internal/` é o lugar das helpers privadas.

**Justificativa:** segue a convenção `utils/internal/` de AGENTS.md (`internal/cache.ts` já abriga `isCacheMatch`, mesmo padrão). Mantém `static.ts` com o fluxo visível e as funções testáveis sem `H3Event`.

### D-02 — Recorte do corpo feito pelo `serveStatic`, sem mudar `getContents`

**Escolha:** `getContents(id)` continua devolvendo o asset inteiro (P2). O `BodyInit` recebido é recortado em `sliceBody`, com o tratamento por tipo abaixo. Todos os offsets e tamanhos são em bytes: para views com `byteOffset` ou elementos de mais de um byte, o cálculo usa `byteOffset` e `byteLength`, nunca `length`.

| Tipo recebido | Recorte | Custo |
| --- | --- | --- |
| `Blob` (inclui `File`) | `blob.slice(start, end + 1)` | O(1), sem leitura |
| `ArrayBuffer` | `new Uint8Array(buf, start, len)` | O(1), sem cópia |
| `ArrayBufferView` (inclui `Uint8Array`) | `new Uint8Array(view.buffer, view.byteOffset + start, len)` | O(1), sem cópia |
| `string` | `new TextEncoder().encode(s).subarray(start, end + 1)` | Codifica o texto inteiro uma vez |
| `ReadableStream` | Devolve um `ReadableStream` novo, puxado sob demanda: lê e descarta até `start`, emite até `end`, depois fecha e cancela o leitor upstream | Lê até `end` (R-01); nada é lido antes de o consumidor puxar |
| Outros (`FormData`, `URLSearchParams`, `null`, `undefined`) | Não recortado: `sliceBody` devolve `undefined` | Nenhum |

**Alternativas consideradas:**
- *Adicionar `offset`/`range` a `getContents`.* Descartada: muda a assinatura pública, o que o PRD proíbe em "Fora de escopo".
- *Recortar sempre com `arrayBuffer()` e `slice`.* Descartada: lê o asset inteiro mesmo para `Blob`, e é o pior caso para o R-01.
- *Suportar só `Blob` e `ReadableStream`.* Descartada: `string` e `Uint8Array` são o que os backends de teste e de memória devolvem; sem eles, a maioria dos usuários cairia no 200 completo.

**Justificativa:** os tipos da tabela cobrem a lista mínima de P2 e incluem `ArrayBufferView`, que é o formato natural de buffers (decisão pendente, ver "Pontos abertos"). Os demais tipos seguem P2: `Range` ignorado, 200 completo, sem erro.

### D-03 — Ordem das avaliações dentro de `serveStatic`

**Escolha:** a ordem é:

1. Headers de `options.headers` (como hoje, `src/utils/static.ts:105-114`).
2. Método, canonicidade, lookup de meta, `vary` (como hoje).
3. ETag, `last-modified`, 304 (como hoje, `src/utils/static.ts:228-248`).
4. `accept-ranges: bytes` (se ainda não existir). Vem depois do 304, porque RF-01 manda o 304 manter os cabeçalhos atuais.
5. `content-type`, `content-encoding`, `content-length` (como hoje, `src/utils/static.ts:250-270`).
6. Avaliação de Range: If-Range, parsing, 416. **O 416 é decidido sem chamar `getContents`.**
7. HEAD: 206 ou 200 só com headers (sem `getContents`).
8. `getContents`, recorte com `sliceBody`; se o recorte não for possível, 200 completo.

**Alternativas consideradas:**
- *Avaliar Range antes do 304.* Descartada: RF-08 exige que o cache tenha precedência, e o `isCacheMatch` já roda antes de tudo que depende de meta.
- *Calcular Range antes do `content-length` e deixar o 206 reescrever tudo.* Descartada: duplica a lógica de headers de representação (`content-type`, `content-encoding`) que já está pronta.

**Justificativa:** a sequência preserva o que já existe byte a byte no caminho 200, mexe só depois do `content-length` e garante que o 416 e o HEAD nunca leem o corpo.

### D-04 — Quando `Range` é ignorado e quando vira 416

**Escolha:** `parseRange` devolve um de três resultados.

- `full` (ignorar, 200 completo): cabeçalho ausente; unidade diferente de `bytes` (a unidade é comparada sem diferenciar maiúsculas, RFC 9110 §14.1); mais de um intervalo (qualquer vírgula); spec sintaticamente inválida (letras, sinal, espaço interno, spec vazia como `bytes=`, dígitos que não formam inteiro seguro); `first > last`; tamanho desconhecido (`meta.size` ausente, RF-10). Espaços nas bordas do valor são removidos pelo parser de headers e não entram na decisão.
- `unsatisfiable` (416): `first >= size`; sufixo `-0`; `size === 0` com qualquer intervalo válido.
- `partial` (206): demais casos, com `end` limitado a `size - 1` e sufixo maior que o asset resultando em `start = 0`.

Ignorar é sempre permitido pela RFC 9110 para Range inválido ou multi-intervalo, e o PRD (RF-06) fixa esse comportamento. Sintaxe inválida nunca vira 400.

**Alternativas consideradas:**
- *Responder 400 para Range malformado.* Descartada: a RFC pede que o servidor ignore o header, e o PRD pede 200.
- *Aceitar espaço dentro da spec (`bytes= 2 - 5`).* Descartada: a gramática de `byte-range-spec` não tem OWS interno; aceitar seria mais permissivo que a norma sem ganho.
- *Aceitar inteiros maiores que `Number.MAX_SAFE_INTEGER`.* Descartada: precisão perdida. Tratar como malformado devolve 200 completo, que é seguro.

**Justificativa:** cada caso do PRD tem um resultado único e testável em `test/unit/range.test.ts`.

### D-05 — If-Range compara com os validadores que o cliente recebe

**Escolha:** `matchesIfRange` recebe `etag` e `lastModified` lidos de `event.res.headers` (`etag` e `last-modified`), não de `meta`. A regra é:

- Se o `If-Range` começa com `"`, é ETag forte: bate só se for igual, caractere a caractere, ao ETag de resposta. Um ETag de resposta `W/"..."` ou malformado nunca é igual a um valor que começa com `"`, então não bate. `W/"..."` em `If-Range` cai no ramo seguinte e não bate.
- Caso contrário, é data: bate só se for igual, byte a byte, ao `last-modified` de resposta.
- Sem validador correspondente, não bate.

**Alternativas consideradas:**
- *Comparar com `meta.etag` e `meta.mtime`.* Descartada: se `options.headers` define `etag` ou `last-modified` (que o servidor envia), o cliente veria um validador diferente do que foi comparado.
- *Normalizar datas com `Date.parse`.* Descartada: RF-07 exige igualdade byte a byte; a comparação de string já cumpre isso e rejeita data inválida automaticamente.
- *Permitir `W/` em `If-Range` e comparar fracamente.* Descartada: RFC 9110 §13.1.5 exige comparação forte para If-Range; o PRD (RF-07) fixa isso.

**Justificativa:** P3 manda usar os valores já definidos em `static.ts`; ler de `event.res.headers` faz isso e cobre `options.headers`.

### D-06 — `content-length` e `content-range` de 206/416 sobrescrevem `options.headers`

**Escolha:** em 206 e 416, `content-length` e `content-range` são gravados com `event.res.headers.set(...)`. Assim eles vencem o `content-length` de `options.headers` (exceção a P4, que vale para os demais headers e para o 200).

**Alternativas consideradas:**
- *Respeitar P4 também aqui (só definir se ausente).* Descartada: com `options.headers: { "content-length": "999" }`, um 206 de 4 bytes sairia com `content-length: 999`, o que quebra a resposta. A regra de P4 é para escolhas do usuário, não para a aritmética do próprio intervalo.
- *Escrever o `content-length` no `HTTPResponse` em vez de `event.res.headers`.* Descartada: `src/response.ts:198-205` faz `event.res.headers` vencer o `HTTPResponse`, então a escrita seria ignorada quando o usuário definir `content-length`.

**Justificativa:** o teste existente `test/static.test.ts:600-617` continua valendo para 200 e HEAD sem Range. A exceção é só para 206 e 416 e precisa de teste próprio (ver estratégia).

### D-07 — Asset de tamanho zero

**Escolha:** `meta.size === 0` com qualquer Range válido vira 416 com `content-range: bytes */0` e `content-length: 0`. Asset de tamanho zero sem Range continua como hoje (sem `content-length`, por causa de `src/utils/static.ts:268`).

**Alternativas consideradas:**
- *Ignorar Range quando `size === 0`.* Descartada: RF-05 manda 416 explicitamente.
- *Mudar a condição `size > 0` em `static.ts:268`.* Descartada: alteraria o 200 existente sem necessidade.

**Justificativa:** o 416 seta `content-length` explicitamente, então o caminho 200 não precisa mudar.

### D-08 — Tipo de corpo não recortável com Range válido

**Escolha:** se `sliceBody` devolve `undefined` (ou `getContents` devolve `null`/`undefined`), o servidor responde 200 completo com o mesmo corpo que responderia sem Range, sem `content-range`. Isso vale para GET. Para HEAD, o 206 não depende do tipo, porque HEAD não lê o corpo.

**Alternativas consideradas:**
- *Responder 500 ou 501.* Descartada: P2 manda 200 completo, sem erro.
- *Ler o corpo inteiro como `arrayBuffer()` para qualquer tipo.* Descartada: fere o custo de R-01 e não é necessário para os tipos suportados.

**Justificativa:** o recorte é uma otimização de compatibilidade; falhar fechado (200 completo) não quebra cliente nenhum.

### D-09 — Testes em dois arquivos novos; nenhum teste existente muda por previsão

**Escolha:**
- `test/static-range.test.ts` (novo): cenários de RF-01 a RF-11 com `describeMatrix`, nos modos `web` e `node`.
- `test/unit/range.test.ts` (novo): funções puras de `range.ts`, em Vitest simples, sem matriz (não há dependência de runtime).
- `test/static.test.ts`: sem alteração prevista. Os testes que comparam headers usam `toMatchObject` (`test/static.test.ts:53`, `:69`), então `accept-ranges` extra não quebra. Se algum teste quebrar, o ajuste será mínimo e documentado (PRD, R3).

**Alternativas consideradas:**
- *Colocar tudo em `test/static.test.ts`.* Descartada: o arquivo já tem 678 linhas e mistura cenários de encoding, MIME, traversal e fallthrough; um arquivo separado deixa a revisão de Range isolada.
- *Usar `describeMatrix` também para os testes puros.* Descartada: `describeMatrix` cria dois servidores (web e node) por bloco; para funções puras isso é desperdício e não testa nada a mais.

**Justificativa:** segue o padrão de `test/*.test.ts` com `describeMatrix` (`test/_setup.ts:11`) e o de `test/unit/` para lógica pura.

## Arquivos a alterar

| Arquivo | Tipo | O que muda |
| --- | --- | --- |
| `src/utils/internal/range.ts` | Novo | `parseRange`, `matchesIfRange`, `sliceBody`, `ByteRangeResult`, helpers privados. |
| `src/utils/static.ts` | Alteração | Import de `range.ts` (após `src/utils/static.ts:6`); `accept-ranges` após o 304 (após `src/utils/static.ts:248`); seleção de Range, 416, HEAD parcial e recorte no fim (`src/utils/static.ts:268-277`); helper privado `selectRange` e `partialResponse` ao final do arquivo, em "Internal Utils" (`src/utils/static.ts:280`). |
| `test/static-range.test.ts` | Novo | Cenários de RF-01 a RF-11 em `describeMatrix`. |
| `test/unit/range.test.ts` | Novo | Tabelas de parsing, If-Range e recorte por tipo. |
| `AGENTS.md` | Opcional | Adicionar `range.ts` à lista de `utils/internal/` (`AGENTS.md:90`), já que o arquivo pede manter a estrutura atualizada. |

Não mudam: `src/index.ts` (`:193`), `src/utils/internal/cache.ts`, `src/response.ts`, `src/event.ts`, `test/static.test.ts`, `test/unit/package.test.ts`.

## Contratos e assinaturas

### `src/utils/internal/range.ts` (interno, não reexportado)

```ts
/** Inclusive byte bounds, as in the `Content-Range` header. */
export type ByteRangeResult =
  | { type: "full" }
  | { type: "partial"; start: number; end: number }
  | { type: "unsatisfiable" };

/**
 * Evaluate a `Range` field-value against a representation of `options.size` bytes.
 * `null` means the header is absent and yields `full`.
 */
export function parseRange(header: string | null, options: { size: number }): ByteRangeResult;

/**
 * Evaluate an `If-Range` field-value (RFC 9110 §13.1.5). `etag` and `lastModified` are the
 * validators of the response about to be sent. Returns `true` when the Range applies.
 */
export function matchesIfRange(
  ifRange: string,
  options: { etag?: string; lastModified?: string },
): boolean;

/**
 * Cut the bytes of `range` out of a body. Returns `undefined` when the body type is not
 * supported, so the caller can fall back to the full representation.
 */
export function sliceBody(
  body: BodyInit,
  range: { start: number; end: number },
): BodyInit | undefined;
```

Por `isolatedDeclarations` (AGENTS.md, "TypeScript"), todas as funções exportadas precisam de tipo de retorno explícito, mesmo que não sejam públicas.

### `src/utils/static.ts` (assinatura pública inalterada)

```ts
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Helpers privados novos, no fim do arquivo (fora de `index.ts`):

```ts
/** Range that applies to this request, after If-Range. `full` when Range is absent or size unknown. */
function selectRange(event: H3Event, size: number | undefined): ByteRangeResult;

/** 206 response with `content-range` and `content-length` written on `event.res.headers` (D-06). */
function partialResponse(
  event: H3Event,
  range: { start: number; end: number },
  size: number,
  body: BodyInit | null,
): HTTPResponse;
```

### Fluxo de `serveStatic` após a mudança (trecho)

```ts
  if (!event.res.headers.get("accept-ranges")) {
    event.res.headers.set("accept-ranges", "bytes");
  }

  // ... content-type, content-encoding, content-length (inalterados) ...

  const range = selectRange(event, meta.size);
  if (range.type === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416 });
  }

  if (event.req.method === "HEAD") {
    return range.type === "partial"
      ? partialResponse(event, range, meta.size!, null)
      : new HTTPResponse(null, { status: 200 });
  }

  const contents = await options.getContents(id);
  if (range.type === "partial") {
    const body = contents ? sliceBody(contents, range) : undefined;
    if (body !== undefined) {
      return partialResponse(event, range, meta.size!, body);
    }
  }
  return new HTTPResponse(contents || null, { status: 200 });
```

`meta.size!` é seguro porque `selectRange` só devolve `partial` ou `unsatisfiable` quando `size` está definido. Decisão: mantém-se o `!` nesses dois pontos, sem mudar o tipo de `selectRange`.

Atenção: não usar `contents && sliceBody(...)`. Com `contents === null`, a expressão vale `null`, que é diferente de `undefined`, e o código geraria um 206 sem corpo. D-08 precisa de teste com `getContents` devolvendo `null`.

`selectRange` lê `event.req.headers.get("range")` e `event.req.headers.get("if-range")`. Se `If-Range` estiver presente e `matchesIfRange` for falso, devolve `full` sem chamar `parseRange`.

## Estratégia de testes

**Ordem (AGENTS.md, "Bug Fix Workflow"):**
1. Escrever `test/static-range.test.ts` com os cenários de RF-01 a RF-11 usando os valores exatos do PRD (asset de `0123456789`, 10 bytes).
2. Rodar `pnpm vitest run test/static-range.test.ts` e confirmar que os testes falham. Esperado: 200 onde se espera 206/416, ausência de `accept-ranges`.
3. Escrever `test/unit/range.test.ts` com as tabelas abaixo. Confirmar que falham por importação inexistente.
4. Implementar `range.ts` e a orquestração em `static.ts`.
5. Rodar os dois arquivos novos, depois `pnpm vitest run test/static.test.ts`, depois `pnpm test`.

**Matriz de `test/static-range.test.ts`** (`describeMatrix`, modos `web` e `node`):
- RF-01: GET sem Range → 200 com `accept-ranges: bytes`; `options.headers` com `accept-ranges` prevalece; 304 sem `accept-ranges` (ver nota abaixo).
- RF-02: `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345`.
- RF-03: `bytes=5-` → `5-9/10`, corpo `56789`; `bytes=-3` → `7-9/10`, `789`; `bytes=5-100` → `5-9/10`; `bytes=-100` → `0-9/10`, corpo completo.
- RF-04: HEAD com `bytes=2-5` → 206 com os mesmos headers, corpo vazio, e `getContents` não é chamado (spy).
- RF-05: `bytes=20-30`, `bytes=-0`, `bytes=10-` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio; asset de tamanho zero com `bytes=0-` → 416 `bytes */0`.
- RF-06: `bytes=abc`, `bytes=0-1,4-5`, `items=0-1`, `bytes=5-2` → 200, `content-length: 10`, sem `content-range`.
- RF-07: `If-Range: "abc"` com ETag `"abc"` → 206; `"xyz"` ou `W/"abc"` → 200; `If-Range` data igual ao `last-modified` → 206; data diferente → 200; `If-Range` sem `Range` → 200.
- RF-08: `Range` + `If-None-Match: "abc"` → 304 sem corpo, sem `content-range`.
- RF-09: POST com Range → 405 com `allow: GET, HEAD`; asset inexistente com Range → 404; com `fallthrough`, ambos devolvem `undefined`.
- RF-10: `getMeta` sem `size` com `bytes=0-1` → 200 completo.
- RF-11: `.gz` de 6 bytes, `accept-encoding: gzip`, `bytes=0-1` → 206 `bytes 0-1/6`, `content-length: 2`, `content-encoding: gzip`, `vary: accept-encoding` presente em 206, 304 e 416.
- Tipos de corpo (D-02, D-08): para cada um de `string`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`, o mesmo `bytes=2-5` devolve `2345`. `FormData` com Range → 200 completo. Usar laços dentro do `it`: o wrapper de `describeMatrix` (`test/_setup.ts:20`) não expõe `it.each`.
- Regressão de D-06: `options.headers: { "content-length": "999" }` → HEAD sem Range continua 999 (`test/static.test.ts:600-617` já cobre); com `bytes=2-5`, o 206 tem `content-length: 4`.
- Recorte de stream com cancelamento: o `ReadableStream` de teste registra `cancel`; para `bytes=0-1` o upstream é cancelado sem ler até o fim.

**`test/unit/range.test.ts`:**
- `parseRange`: tabela com cada entrada das seções RF-03, RF-05 e RF-06, mais `null`, `bytes=+1-2`, `bytes=1e3-`, `bytes=1-2-3`, `bytes= 2-5`, `bytes=0-9007199254740993` e `bytes=` (malformados → `full`), e `BYTES=2-5` (unidade sem diferenciar maiúsculas → `partial`).
- `matchesIfRange`: `"abc"` com etag `"abc"` → true; `W/"abc"` → false; `"abc"` com etag `W/"abc"` → false; etag ausente → false; data igual e diferente; string vazia → false.
- `sliceBody`: cada tipo da tabela de D-02; `FormData` → `undefined`; `Uint8Array` com `byteOffset` diferente de zero recorta do lugar certo; string com caractere multibyte (`"é"`), offsets em bytes UTF-8.

**Regressão e exportações:**
- `test/unit/package.test.ts` deve passar sem alteração (RF-12).
- `pnpm lint` e `pnpm typecheck` passam (PRD, DoD).
- Cobertura: `vitest.config.ts` inclui `src/**/*.ts` no coverage e não define limiar; `range.ts` deve ter cobertura de todos os ramos de `parseRange`, `matchesIfRange` e `sliceBody`.

Nota sobre 304: o PRD (RF-01) diz que 304 mantém os cabeçalhos atuais. `accept-ranges` é colocado depois do retorno 304 (D-03), então o 304 não o recebe. Isso é aceitável porque RFC 9110 §15.4.5 lista os headers que um 304 deve carregar (`Cache-Control`, `ETag`, `Vary` etc.) e não inclui `accept-ranges`. O teste de RF-01 verifica a ausência no 304 para travar essa decisão; é um teste novo, não um ajuste de teste existente.

## Riscos

- **R-01 — Custo do recorte de `ReadableStream` (alto, herdado do PRD R1).** Para `bytes=N-` em arquivo grande, o stream é lido e descartado até `N`. Mitigação: `Blob.slice` e views não leem nada; para streams, cancelar o leitor logo após o último byte do intervalo (D-02). Comentário no código, como pede o PRD.
- **R-02 — `meta.size` diferente dos bytes entregues (médio).** Se o backend informar um `size` que não bate com o corpo (por exemplo, `size` em caracteres para string com UTF-8 multibyte, ou um stream que termina antes), o 206 fica inconsistente. O teste existente usa `.length` (`test/static.test.ts:18`), que só é correto para ASCII. Mitigação: P1; os testes novos usam UTF-8 multibyte para pegar o caso. Não há validação extra no `serveStatic`, para não ler o corpo. Se um stream terminar antes de `end`, o 206 já saiu com um `content-length` que o corpo não cumpre; isso é aceito e o runtime é quem sinaliza o erro.
- **R-03 — `content-length` de `options.headers` sobrescrito em 206/416 (baixo).** É a exceção deliberada de D-06. Quem define `content-length` fixo globalmente não recebe esse valor em respostas de Range; isso é o comportamento correto, mas precisa estar documentado no teste.
- **R-04 — Limite de 200 linhas por arquivo (PRD, DoD) (alto em clareza).** `src/utils/static.ts` já tem 351 linhas (`src/utils/static.ts:351`), e a mudança adiciona cerca de 35 linhas de orquestração. A DoD diz "nenhum arquivo passa de 200 linhas *por causa desta mudança*". Com o arquivo já acima do limite, a leitura literal é impossível de cumprir. Esta spec assume que a DoD significa "a lógica nova fica em `range.ts`, e `static.ts` cresce só com a orquestração". **Precisa de confirmação** (ver Pontos abertos).
- **R-05 — Cache intermediário e variantes (médio, PRD R2).** Um 206 de uma variante servido a outro `accept-encoding` seria um erro de cache. Mitigação: `vary: accept-encoding` já é anexado em `src/utils/static.ts:220-225` antes do 304 e do 416, então aparece em todas as respostas com encodings configurados. Sem encodings configurados, não há variante e não há vary, como hoje.
- **R-06 — `rules/cache.ts` ignora Range (baixo).** `src/rules/cache.ts:143-148` faz bypass de cache para qualquer request com `Range`. Isso não é regressão: a resposta parcial simplesmente não é armazenada. Mas um `serveStatic` atrás da regra de cache entrega 206 sem cache, o que é esperado. Não há ação nesta mudança.
- **R-07 — Headers de representação em 416 (baixo).** A 416 leva `content-type`, `content-encoding` e `etag` quando o asset existe. A RFC 9110 permite isso. Testes não devem exigir que eles estejam ausentes.
- **R-08 — Suporte parcial declarado por `accept-ranges` (baixo).** Para `FormData` e outros tipos não recortáveis, o servidor anuncia `bytes` mas responde 200 completo a Range. Isso segue RF-01 e P2. Documentar no comentário de `serveStatic`, sem mexer na documentação pública (PRD, "Fora de escopo").
- **R-09 — Custo de `TextEncoder` em strings grandes (baixo).** Strings são codificadas inteiras a cada request com Range. Aceitável para o caso de uso (assets em memória pequenos); se virar problema, a saída é aceitar `Uint8Array` pré-codificado no backend, o que é mudança de documentação do usuário, fora desta entrega.

## Pontos abertos (decisões que dependem de você)

1. **Limite de 200 linhas (R-04).** Confirme a leitura: "a lógica nova fica em `range.ts`; `static.ts` cresce só pela orquestração". Se a intenção for `static.ts` abaixo de 200 linhas, a única saída é mover o fluxo de Range para um helper em `range.ts` que receba callbacks, o que piora a legibilidade.
2. **`ArrayBufferView` além da lista de P2 (D-02).** Proponho suportar, pelo custo zero. Se preferir a lista exata do PRD, `Uint8Array` deixa de ser coberto como tipo geral.
3. **Sobrescrever `content-length` de `options.headers` em 206/416 (D-06).** Proponho sim. Se não, um 206 com `content-length` fixo do usuário fica incorreto, e não há como evitar isso sem violar RFC.
4. **Adicionar `range.ts` a `AGENTS.md` (opcional).** Proponho incluir, junto da implementação.
