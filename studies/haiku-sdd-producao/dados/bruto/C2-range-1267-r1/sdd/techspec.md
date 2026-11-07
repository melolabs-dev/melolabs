# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-12).
Norma: RFC 9110 §13.1.5 (If-Range), §14 (Range Requests) e §14.1.1 (range-spec inválido).

## 1. Estado atual

- `serveStatic` nunca lê o cabeçalho `Range`. Não há nenhuma ocorrência de `range`, `accept-ranges` ou `content-range` em `src/utils/static.ts`. A única ocorrência de `range` em `src/` é o bypass de cache em `src/rules/cache.ts:146-149`, que já ignora pedidos com `Range`.
- O fluxo atual de `serveStatic` (`src/utils/static.ts:101`):
  - Validação de método: `src/utils/static.ts:116-122`.
  - Canonicalização do caminho: `src/utils/static.ts:142-147`.
  - Busca de meta por variante e índice: `src/utils/static.ts:198-215`.
  - Cabeçalho `vary`: `src/utils/static.ts:220-225`.
  - `last-modified` (truncado a segundos): `src/utils/static.ts:227-237`.
  - `etag`: `src/utils/static.ts:239-241`.
  - Cache condicional (304): `src/utils/static.ts:243-248`.
  - `content-type`, `content-encoding`: `src/utils/static.ts:250-266`.
  - `content-length`: `src/utils/static.ts:268-270`.
  - Resposta de HEAD: `src/utils/static.ts:272-274`.
  - Corpo de GET: `src/utils/static.ts:276-277`.
- O cache condicional já respeita a precedência de RF-08: `isCacheMatch` em `src/utils/internal/cache.ts:29-49` usa `If-None-Match` antes de `If-Modified-Since`, e `serveStatic` chama essa função antes de qualquer decisão de Range.
- `new HTTPResponse(body, { status })` aceita `status` e `statusText` e herda `event.res.headers` (`src/response.ts:96-124`). `prepareResponse` mescla os cabeçalhos preparados e usa `status` do `HTTPResponse` (`src/response.ts:188-206`).
- `sanitizeStatusCode` aceita de 100 a 599 (`src/utils/sanitize.ts:28`), então o status 416 passa sem alteração.

## 2. Decisões de arquitetura

### D-01 — Implementação dentro de `serveStatic`, helpers privados no mesmo arquivo

**Escolha.** Toda a lógica fica em `src/utils/static.ts`. As funções auxiliares ficam no fim do arquivo, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`. `src/index.ts` não muda (`src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`).

**Alternativas.**
- `src/utils/internal/range.ts`. A convenção de `AGENTS.md` ("Internal helpers go at the end of files or in `utils/internal/`") permitiria isso. Rejeitada por enquanto porque RF-11 do PRD e o contrato do pedido dizem que as funções auxiliares ficam privadas ao módulo `src/utils/static.ts`.
- Exportar as helpers para testá-las isoladamente. Rejeitada: violaria RF-11 e o teste de snapshot de exports (`test/unit/package.test.ts:4`).

**Custo aceito.** `static.ts` já tem 352 linhas, acima da meta de 200 de `AGENTS.md`, e vai crescer. Ponto a confirmar (seção 8).

### D-02 — Gramática aceita: uma única range-spec `bytes=`

**Escolha.** Aceitar só `bytes=` seguido de uma range-spec, com um destes formatos: `first-last`, `first-` ou `-suffix`. Qualquer outro valor é ignorado, e a resposta é 200 completa:
- unidade diferente de `bytes` (RF-06);
- sintaxe inválida, como `bytes=abc` ou `bytes=-`;
- mais de uma range-spec, como `bytes=0-9,20-29`;
- `first > last`, que a RFC 9110 §14.1.1 trata como range-spec sintaticamente inválido, e cujo cabeçalho deve ser ignorado.

Aceitar `bytes` sem diferença de caixa, porque a RFC trata nomes de unidade de forma case-insensitive.

**Alternativas.**
- Parser completo com `multipart/byteranges`. Fora de escopo (PRD, "Fora de escopo").
- Tratar `first > last` como 416. Rejeitada: contraria §14.1.1.

### D-03 — Validação de If-Range: comparação forte e data exata

**Escolha.** Se houver `If-Range`, o Range só vale quando o validador bate com o estado atual do asset:
- **Valor que começa com `"`**: é um ETag. Confere somente se o ETag do asset for forte (não começa com `W/`) e o valor for idêntico. Um ETag fraco nunca confere (RFC 9110 §13.1.5).
- **Demais valores**: são uma data HTTP. Confere somente se `new Date(valor).getTime()` for igual ao `mtime` truncado para segundos (`src/utils/static.ts:232`). Sem `mtime`, nunca confere.
- Quando não confere, o Range é ignorado e a resposta é 200 (RF-07).

**Alternativas.**
- Ignorar `If-Range`. Rejeitada: poderia entregar um trecho de uma versão antiga do arquivo.
- Comparação fraca de ETag. Rejeitada pela §13.1.5.

### D-04 — Fatiamento do corpo: `Blob.slice` nativo ou bytes em memória

**Escolha.** Mantém a assinatura de `getContents` (RF-11) e fatia o corpo que ele devolve:
- `Blob`: `contents.slice(start, end + 1)`, sem ler o conteúdo inteiro.
- Qualquer outro `BodyInit` (string, `ArrayBuffer`, view, `ReadableStream`): `new Response(contents).arrayBuffer()` e depois `subarray` sobre o `Uint8Array` resultante. Isso lê o corpo inteiro em memória (risco R-b).

**Alternativas.**
- Passar o intervalo para `getContents`. Rejeitada: muda a API pública, o que o PRD proíbe (premissa P2 e RF-11).
- Fatiar por streaming descartando os bytes iniciais. Mais complexa, ainda lê desde o início e só economiza memória. Adiada.
- Suportar Range só para `Blob`. Rejeitada: deixaria de fora strings e streams, que são o retorno típico dos backends de teste e de muitos backends reais, e não cumpre RF-02.

### D-05 — Ordem no fluxo de `serveStatic`

**Escolha.** As decisões ficam nesta ordem:
1. O cache condicional (304, `src/utils/static.ts:243-248`) continua antes de qualquer Range (RF-08).
2. `accept-ranges: bytes` é definido logo depois do 304, para que 200, 206, HEAD e 416 recebam o cabeçalho, mas o 304 não (RF-01).
3. A decisão de Range é tomada depois de `content-encoding` (`src/utils/static.ts:264-266`) e antes de `content-length` (`src/utils/static.ts:268-270`), porque `content-length` precisa refletir o trecho.

**Alternativa.** Definir `accept-ranges` antes do 304. Rejeitada: RF-01 lista 200, 206 e HEAD, e o 304 não precisa do cabeçalho.

### D-06 — `content-length` e `content-range` de 206 e 416 sobrescrevem o valor preexistente

**Escolha.** Em 206 e 416, `event.res.headers.set` substitui qualquer `content-length` já presente, inclusive o passado em `options.headers`. Um `Content-Length` diferente do trecho entregue deixaria a resposta inválida.

**Alternativa.** Ignorar Range quando `content-length` já existe. Rejeitada: esconderia o Range sem aviso. O teste de `test/static.test.ts:600-617` continua valendo, porque ele não envia Range.

### D-07 — Ignorar Range quando há `Content-Encoding`

**Escolha.** Se `event.res.headers.get("content-encoding")` existir depois da linha 266, o Range é ignorado e a resposta é 200 completa (R1 do PRD, recomendação confirmada aqui).

**Alternativa.** Aplicar Range sobre os bytes codificados, o que a RFC permite. Rejeitada: clientes e caches não esperam isso, e o pré-comprimido (`.gz`, `.br`) muda o tamanho. Ponto a confirmar (seção 8).

### D-08 — 416 como `HTTPResponse` vazio, não como `HTTPError`

**Escolha.** `return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `content-range: bytes */<size>` e `content-length: 0` definidos em `event.res.headers`.

**Alternativa.** `throw new HTTPError({ status: 416, headers })`. Rejeitada: erros passam por `onError` e viram corpo JSON, e recebem `errHeaders` (`src/response.ts:146-174` e `src/response.ts:358-380`). Um 416 de Range é uma resposta normal de arquivo encontrado.

### D-09 — Meta presente, conteúdo ausente, pedido com Range

**Escolha.** Quando `getContents` devolve `null` ou `undefined` e há Range aplicável, a resposta é 404. Sem Range, o comportamento continua como hoje (`src/utils/static.ts:276-277`). Não se pode responder 200 vazio com `Content-Length` e `Content-Range` do tamanho do asset, porque a resposta ficaria inconsistente.

**Alternativa.** Manter 200 vazio também no caminho de Range. Rejeitada pela inconsistência. Ponto a confirmar (seção 8).

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | Lógica principal de Range e helpers privados (seção 4). |
| `test/static.test.ts` | Novos blocos `describeMatrix` (seção 6). Nenhum teste existente precisa mudar (ver R-e). |

Não alterar: `src/index.ts`, `src/utils/internal/cache.ts`, `src/rules/cache.ts`, `src/response.ts`, `test/unit/package.test.ts`.

### Pontos de inserção em `src/utils/static.ts`

- Logo após `src/utils/static.ts:248` (fim do bloco de 304):

  ```ts
  if (!event.res.headers.has("accept-ranges")) {
    event.res.headers.set("accept-ranges", "bytes");
  }
  ```

- Substituir o bloco de `content-length` em `src/utils/static.ts:268-270` pela decisão de Range (pseudocódigo, não é o diff final):

  ```ts
  const range = meta.size
    ? resolveRange(event.req.headers, { size: meta.size, etag: meta.etag, mtime: mtimeDate })
    : undefined;
  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }
  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    event.res.headers.set("content-length", String(range.end - range.start + 1));
  } else if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
    event.res.headers.set("content-length", meta.size + "");
  }
  ```

  Como `resolveRange` devolve `undefined` quando o tamanho é zero (RF-09), `meta.size` é sempre maior que zero dentro do ramo de Range.

- Substituir `src/utils/static.ts:272-277` pela resposta de HEAD e de GET:

  ```ts
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, range ? PARTIAL : { status: 200 });
  }

  const contents = await options.getContents(id);
  if (range) {
    if (contents == null) {
      throw new HTTPError({ status: 404 }); // D-09
    }
    return new HTTPResponse(await sliceContents(contents, range), PARTIAL);
  }
  return new HTTPResponse(contents || null, { status: 200 });
  ```

  Onde `PARTIAL` é `{ status: 206, statusText: "Partial Content" }`. A constante pode ser local ao módulo ou inline, a critério de quem implementar.

## 4. Contratos e assinaturas

Todas as assinaturas abaixo são privadas ao módulo. Nenhuma é exportada.

```ts
/** Intervalo de bytes inclusivo `[start, end]` do corpo a ser entregue. */
interface ByteRange {
  start: number;
  end: number;
}

/** Range aplicável: intervalo, `"unsatisfiable"` para 416, ou `undefined` para servir o asset completo. */
type RangeOutcome = ByteRange | "unsatisfiable" | undefined;

/**
 * Lê `Range` e `If-Range` e decide o trecho a entregar.
 * Devolve `undefined` quando o Range é ignorado (D-02, D-03, RF-09).
 */
function resolveRange(
  headers: Headers,
  validators: { size: number; etag?: string; mtime?: Date },
): RangeOutcome;

/**
 * Interpreta o valor de `Range`. Devolve `undefined` quando o cabeçalho deve ser ignorado.
 * `first` ou `last` ausentes correspondem a `bytes=first-` e `bytes=-last`.
 */
function parseRangeSpec(value: string): { first?: number; last?: number } | undefined;

/** Avalia `If-Range` contra o validador atual (D-03). */
function ifRangeMatches(value: string, validators: { etag?: string; mtime?: Date }): boolean;

/** Fatia o corpo para o intervalo pedido (D-04). */
function sliceContents(contents: BodyInit, range: ByteRange): Promise<BodyInit>;
```

Regras de `resolveRange`, na ordem:
1. Sem `Range`: `undefined`.
2. `parseRangeSpec` devolve `undefined`: `undefined`.
3. `If-Range` presente e `ifRangeMatches` falso: `undefined`.
4. Sufixo (`first` ausente): se `last === 0`, `"unsatisfiable"`. Senão `start = max(0, size - last)` e `end = size - 1`.
5. `first` presente: se `first >= size`, `"unsatisfiable"`. Senão `start = first` e `end = min(last ?? size - 1, size - 1)`.

Resposta resultante:

| Situação | Status | Cabeçalhos de intervalo | Corpo |
| --- | --- | --- | --- |
| Sem Range aplicável | 200 | `accept-ranges: bytes`, `content-length` do asset | completo |
| Range válido, GET | 206 | `accept-ranges`, `content-range: bytes s-e/size`, `content-length: e-s+1` | trecho |
| Range válido, HEAD | 206 | igual ao GET | vazio |
| Não satisfazível | 416 | `accept-ranges`, `content-range: bytes */size`, `content-length: 0` | vazio |
| `304` | 304 | sem `accept-ranges` | vazio |

## 5. Sequência de decisões

1. Método (`src/utils/static.ts:116`) e canonicalização (`src/utils/static.ts:142`): inalterados.
2. Busca de meta: inalterada, então `fallthrough` continua igual e nenhum cabeçalho de Range é definido antes de achar o asset (R-d).
3. 304 (`src/utils/static.ts:243`): inalterado, precede qualquer Range.
4. `accept-ranges` (D-05).
5. `content-encoding` (`src/utils/static.ts:264-266`): inalterado. Depois dele, D-07 ignora Range quando o cabeçalho existe.
6. Decisão de Range e `content-length` (seção 3).
7. Resposta de HEAD e de GET (seção 3).

## 6. Estratégia de testes

Seguir o fluxo de correção de `AGENTS.md`: escrever os testes de Range, confirmar que falham com a implementação atual, e só depois implementar.

Novo bloco em `test/static.test.ts`, com `describeMatrix` (`test/_setup.ts:11`), para rodar em `web` e `node`:

```ts
describeMatrix("serve static range requests", (t, { it, expect }) => {
  const content = "0123456789".repeat(100); // 1000 bytes; o byte no índice i é o dígito i % 10
  ...
});
```

Casos (cada um em web e node):
1. **Accept-Ranges**: GET e HEAD sem Range devolvem 200 com `accept-ranges: bytes` (RF-01).
2. **206 com intervalo fechado**: `bytes=0-99` devolve 206, `content-range: bytes 0-99/1000`, `content-length: 100` e o corpo `content.slice(0, 100)` (RF-02).
3. **Intervalos abertos e sufixos**: `bytes=900-` devolve `900-999`; `bytes=-50` devolve `950-999`; `bytes=900-5000` devolve `900-999` (RF-03).
4. **HEAD com Range**: 206, mesmos cabeçalhos do GET, corpo vazio (RF-04).
5. **416**: `bytes=1000-` e `bytes=-0` devolvem 416, `content-range: bytes */1000`, `content-length: 0` e corpo vazio (RF-05).
6. **Ignorados**: `bytes=abc`, `items=0-9`, `bytes=0-9,20-29` e `bytes=50-10` devolvem 200 completo, sem `content-range` (RF-06).
7. **If-Range**:
   - ETag forte igual (`"abc"`) com `bytes=0-99` devolve 206;
   - `If-Range: "outro"` devolve 200;
   - ETag fraco no asset (`W/"abc"`) nunca confere, nem com o mesmo valor, e devolve 200;
   - data igual ao `last-modified` devolve 206;
   - data diferente devolve 200 (RF-07, R-f).
8. **Precedência do 304**: `If-None-Match: "abc"` com `bytes=0-99` devolve 304 sem corpo (RF-08).
9. **Tamanho desconhecido**: `getMeta` sem `size` devolve 200 completo, com `accept-ranges` e sem `content-range` (RF-09).
10. **Content-Encoding**: `getMeta` com `encoding` devolve 200 completo (D-07).
11. **Fallthrough**: `fallthrough: true` com Range para asset inexistente passa ao próximo handler, e a resposta não tem `accept-ranges` nem `content-range` (R-d).
12. **Tipos de corpo**: os casos 2 e 3 repetidos com `getContents` devolvendo `Blob`, `ReadableStream` e `Uint8Array`, para cobrir os dois ramos de `sliceContents` (D-04).
13. **Conteúdo ausente com Range**: `getContents` devolve `undefined` e a resposta é 404 (D-09).

Testes existentes que devem continuar iguais:
- `test/static.test.ts:42` e `:57`: GET e HEAD sem Range. As asserções usam `toMatchObject` e `content-length`, então o `accept-ranges` extra não quebra.
- `test/static.test.ts:199`, `:470` e `:219`: cache e 404.
- `test/static.test.ts:516`: fallthrough não vaza `vary`. O novo teste de fallthrough cobre `accept-ranges`.
- `test/static.test.ts:600-617`: `content-length` preexistente em HEAD 200.
- `test/static.test.ts:626-678`: caminhos malformados e 404 com `allowMalformedURL`.

Comandos de verificação:
- `pnpm vitest run test/static.test.ts`
- `pnpm vitest run test/unit/package.test.ts` (snapshot de exports, RF-11)
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` (suíte completa com cobertura, antes de fechar)

## 7. Riscos

- **R-a. `size` divergente do corpo (P3).** Se `getMeta` informar um tamanho diferente do real, `Content-Range` e `Content-Length` ficam errados. O caminho `Blob` usa `size` do `meta`. O caminho bufferizado conhece o tamanho real, mas mantém `size` como fonte, para não mudar o contrato. Mitigação: documentar na API que `size` deve ser o número de bytes do corpo.
- **R-b. Memória (R2 do PRD).** Para corpos que não são `Blob`, o pedido de Range lê o corpo inteiro. Mitigação: documentar; medir se virar gargalo. Streaming é a evolução possível (D-04).
- **R-c. Unidade do `size`.** Os testes existentes usam `.length` como `size` (`test/static.test.ts:18`, `:237`). Isso só é correto para ASCII. Com texto em UTF-8 multibyte, o intervalo ficaria errado. O novo código deve tratar `size` como bytes, e a documentação deve dizer isso.
- **R-d. Vazamento para o fallthrough (R3).** Os cabeçalhos de Range são definidos só depois que o asset é encontrado (`src/utils/static.ts:210-215` retorna antes). Coberto pelo caso 11.
- **R-e. Testes existentes (R4).** Nenhum teste atual envia `Range` nem verifica ausência de `accept-ranges`. Por isso, a previsão é que nenhum teste existente precise mudar. Se algum mudar, a alteração deve ser mínima e justificada, como pede o pedido.
- **R-f. Data em If-Range (R5).** Comparar datas exige a mesma precisão de segundos de `last-modified`. Se `mtime` não for truncado (`src/utils/static.ts:232`), If-Range nunca confere. O caso 7 cobre isso.
- **R-g. Cache de regras.** `src/rules/cache.ts:146-149` já desvia pedidos com `Range` do cache. Não há conflito com o novo código. Um 200 cacheado para um pedido sem Range continua correto.
- **R-h. Cabeçalho `accept-ranges` do usuário.** Se o usuário definir `accept-ranges: none` em `options.headers`, o `has` impede a sobrescrita, mas os Ranges continuam sendo atendidos. Não é coberto pelo PRD. Ponto a confirmar, ou pode ser tratado com a mesma regra de `content-length`.
- **R-i. Tamanho do arquivo.** `static.ts` passa de 350 linhas (D-01).

## 8. Pontos a confirmar antes de implementar

1. **Localização das helpers (D-01).** Manter em `src/utils/static.ts`, como pede o PRD, ou mover para `src/utils/internal/range.ts`, como pede a convenção de `AGENTS.md`?
2. **Range com Content-Encoding (D-07).** Confirmar a recomendação do PRD de ignorar Range nesses casos.
3. **Conteúdo ausente com Range (D-09).** Confirmar 404 neste caminho, ou outra resposta.
4. **`accept-ranges` do usuário (R-h).** Tratar como `content-length` ou deixar como está.
