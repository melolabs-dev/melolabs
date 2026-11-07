# Especificação técnica: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (requisitos RF-01 a RF-11).
Código de referência: `src/utils/static.ts` (352 linhas no estado atual).

## Visão geral

A mudança fica inteira dentro de `serveStatic`. Não há opção nova, parâmetro novo em `getMeta`/`getContents` nem export novo. O fluxo ganha três passos depois do cálculo de `content-length` (`src/utils/static.ts:268-270`):

1. Anunciar `accept-ranges: bytes` quando `meta.size` é conhecido.
2. Avaliar o cabeçalho `Range` (com `If-Range`) contra a representação atual: `full`, `partial` ou `unsatisfiable`.
3. Responder 416 (`unsatisfiable`), 206 sem corpo (HEAD) ou 206 com o trecho fatiado (GET). Sem Range aplicável, segue o fluxo atual.

A avaliação de `Range` só acontece depois da checagem de 304 (`src/utils/static.ts:243-248`), para manter a precedência do RF-08.

## Decisões de arquitetura

### D-01 — Lógica de Range dentro de `static.ts`, com helpers privados no mesmo arquivo

**Alternativas**
- (a) Helpers no próprio `src/utils/static.ts`.
- (b) Parser e fatiamento em `src/utils/internal/range.ts`, importados por `static.ts`.

**Escolha: (a).** O pedido diz que a lógica auxiliar fica "privada no módulo `serveStatic`" (`sdd/pedido.md`, Restrições; issue, "Keep all helper logic private within the serveStatic module"). A opção (b) também não exporia nada, mas sairia do módulo e contraria o texto do pedido. O custo é que o arquivo cresce de 352 para cerca de 500 linhas, acima da meta de 200 linhas do `AGENTS.md`. O arquivo já passa dessa meta hoje, então registro isso como risco (ver Riscos) e não como bloqueio.

### D-02 — `Accept-Ranges` só quando `size` é conhecido

**Alternativas**
- (a) Anunciar `accept-ranges: bytes` sempre, como pede a issue.
- (b) Anunciar só quando `meta.size !== undefined`, como pede o PRD (RF-01).

**Escolha: (b).** Sem tamanho, o servidor não consegue montar `Content-Range` nem `Content-Length` do trecho. Anunciar `bytes` nesse caso faz o cliente pedir intervalos que o servidor responderia com 200 completo. `size: 0` conta como conhecido: o anúncio sai, e qualquer intervalo recebe 416 (D-08). Esta é a divergência registrada no PRD (Premissas) e precisa de confirmação.

### D-03 — Fatiar o conteúdo no `serveStatic`, sem novo parâmetro em `getContents`

**Alternativas**
- (a) Adicionar `range` como segundo argumento de `getContents` (ou uma opção nova).
- (b) Manter `getContents(id)` como está e fatiar o corpo devolvido.

**Escolha: (b).** O PRD exclui novos parâmetros em `getMeta`/`getContents` e novas opções. O fatiamento depende do tipo do corpo (D-04). Quem quiser leitura parcial eficiente pode fazer isso no futuro com uma opção nova, em outra mudança.

### D-04 — Como fatiar, por tipo de `BodyInit`

Regra única, sem ler o arquivo inteiro para os casos comuns:

| Corpo devolvido por `getContents` | Como atender `[start, end]` |
| --- | --- |
| `Blob` (inclui `File`) | `blob.slice(start, end + 1)`. É preguiçoso em `Blob` de arquivo. |
| `ReadableStream` | Ler e descartar até `start`, depois repassar `end - start + 1` bytes e cancelar o leitor ao terminar. |
| Demais (`string`, `ArrayBuffer`, `ArrayBufferView`, `FormData`, `URLSearchParams`) | `await new Response(contents).blob()` e depois `.slice(start, end + 1)`. |
| `null`/`undefined` | Corpo `null`, como hoje (`src/utils/static.ts:277`). |

**Alternativas**
- (a) Ler tudo com `new Response(contents).arrayBuffer()` e cortar. Simples, mas carrega o arquivo inteiro em memória para cada requisição de vídeo.
- (b) Tabela acima. Só o caso `ReadableStream` lê bytes além do trecho pedido, e isso é o custo que o PRD já aponta.

**Escolha: (b).**

### D-05 — 206 e 416 sobrescrevem `content-length` (e definem `content-range`) mesmo se já existir

`serveStatic` define `content-length` só quando ainda não existe (`src/utils/static.ts:268`), e o teste `does not overwrite a content-length already set on the response` (`test/static.test.ts:600-617`) confirma isso para o 200. Em 206 e 416 o valor precisa ser o do trecho, senão o cabeçalho mente sobre o corpo.

**Alternativas**
- (a) Respeitar o `content-length` definido pelo usuário também em 206/416.
- (b) Sobrescrever só em 206/416, com `event.res.headers.set`.

**Escolha: (b).** O 200 não muda, então o teste existente continua valendo. Usar `set` é obrigatório por outro motivo: `toResponse` mescla `event.res.headers` por cima dos cabeçalhos do `HTTPResponse` (`src/response.ts:202-204` e `src/response.ts:243-252`). Um `content-length` escrito só em `new HTTPResponse(..., { headers })` perderia para o valor já presente em `event.res.headers`. Por isso todos os cabeçalhos de 206 e 416 vão por `event.res.headers`.

### D-06 — Range não se aplica a representação codificada

Uma representação é codificada quando (a) `content-encoding` já está definido na resposta, seja por `meta.encoding` (`src/utils/static.ts:264-266`), seja por `headers` do usuário; ou (b) a variante escolhida é pré-comprimida, ou seja, `id !== assetId` (ver `idSearchPaths`, `src/utils/static.ts:340-351`). O caso (b) é necessário porque a variante `.gz`/`.br` pode existir sem `meta.encoding`.

**Escolha:** nos dois casos, o `Range` é ignorado e a resposta é 200 completa (RF-09). Suportar intervalo sobre gzip/br está fora de escopo (PRD).

### D-07 — Validação de `If-Range`

- **ETag:** o `If-Range` bate só se `meta.etag` existe, não começa com `W/` (comparação case-sensitive, como `opaqueTag` faz em `src/utils/internal/cache.ts:51-53`) e é igual, caractere a caractere, ao valor do `If-Range`.
- **Data:** o `If-Range` bate só se `new Date(valor).getTime()` for igual a `mtimeDate.getTime()`, o `Last-Modified` já truncado em segundos (`src/utils/static.ts:227-232`). Sem `mtime`, a data nunca bate.
- Sem `Range` aplicável, `If-Range` é ignorado.

**Alternativas**
- (a) Comparação forte completa da RFC 9110 §13.1.5, com a regra de "1 segundo antes da Date da resposta" para validador de data.
- (b) Igualdade exata, como o PRD pede (RF-07).

**Escolha: (b).** A regra de 1 segundo protege caches de respostas geradas no mesmo segundo da modificação. Para arquivos estáticos com `mtime` antigo ela quase nunca muda o resultado, e o PRD fecha o contrato em igualdade exata. Registro como simplificação aceita.

### D-08 — Parser de `Range` e casos 206/416/ignorar

Uma única expressão para a forma aceita: `/^bytes=(\d*)-(\d*)$/i` aplicada ao valor com `trim()`. A unidade é case-insensitive (RFC 9110 §14.1).

| Entrada (após o regex) | Resultado |
| --- | --- |
| Não casa o regex (malformado, outra unidade, lista com vírgula, `bytes=` vazio) | `full` (RF-05) |
| Ambos vazios (`bytes=-`) | `full` |
| `start > end` quando ambos existem | `full`: a RFC trata o intervalo como inválido |
| `size === 0` e qualquer intervalo válido | `unsatisfiable` |
| Sufixo `-0` | `unsatisfiable` (RF-04) |
| Sufixo `-n` com `n > 0` | `start = max(0, size - n)`, `end = size - 1` (RF-02/RF-03) |
| `start` sem `end` (`a-`) | `end = size - 1` |
| `start >= size` | `unsatisfiable` (RF-04) |
| `end >= size` | `end = size - 1` (RF-03) |
| Demais | `partial` com `[start, end]` |

Consequência: `Range` com mais de um intervalo (`bytes=0-1,3-4`) não casa o regex e vira 200 completo, sem `multipart/byteranges` (PRD, fora de escopo).

## Contratos e assinaturas

Nenhuma alteração em tipos ou exports públicos. `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic` e `src/index.ts:193` ficam iguais. O teste de snapshot de exports (`test/unit/package.test.ts:4-5`) deve passar sem alteração, o que comprova RF-11.

Helpers privados em `src/utils/static.ts`, todos sem `export`:

```ts
type ByteRange = { start: number; end: number };

type RangeEvaluation =
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  | { kind: "unsatisfiable" };

// Avalia Range e If-Range. Chamada só quando meta.size !== undefined.
function evaluateRange(
  headers: Headers,
  representation: {
    size: number;
    etag?: string;
    lastModified?: Date;
    encoded: boolean;
  },
): RangeEvaluation;

// Interpreta a forma bytes=a-b, bytes=a-, bytes=-n. Retorna undefined para "ignorar".
function parseByteRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

// Compara If-Range com o validador atual (strong comparison, D-07).
function matchesIfRange(
  ifRange: string,
  representation: { etag?: string; lastModified?: Date },
): boolean;

// Fatia o corpo devolvido por getContents (D-04). Retorna null se não há corpo.
function sliceContents(contents: BodyInit | null | undefined, range: ByteRange): Promise<BodyInit | null>;

// Fatia um ReadableStream sem carregar o arquivo inteiro.
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: ByteRange,
): ReadableStream<Uint8Array>;
```

Fluxo dentro de `serveStatic`, depois de `src/utils/static.ts:270`:

```ts
if (meta.size !== undefined) {
  event.res.headers.set("accept-ranges", "bytes");
}

const evaluation =
  meta.size === undefined
    ? { kind: "full" as const }
    : evaluateRange(event.req.headers, {
        size: meta.size,
        etag: meta.etag,
        lastModified: mtimeDate,
        encoded: id !== assetId || !!event.res.headers.get("content-encoding"),
      });

if (evaluation.kind === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (evaluation.kind === "partial") {
  const { start, end } = evaluation.range;
  event.res.headers.set("content-range", `bytes ${start}-${end}/${meta.size}`);
  event.res.headers.set("content-length", String(end - start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(await sliceContents(contents, evaluation.range), {
    status: 206,
    statusText: "Partial Content",
  });
}

// ... fluxo atual: HEAD -> 200 sem corpo; GET -> getContents -> 200
```

Notas do fluxo:

- `accept-ranges` fica depois do 304 (linha 243-248), então 304, 404 e 405 não mudam (RF-08, RF-10).
- Em 416 o corpo é `null` e `content-length` é `0`. `nullBody` já trata HEAD.
- `mtimeDate` é o valor de `src/utils/static.ts:227-232`, que é `undefined` sem `mtime`.
- O `Accept-Ranges` também aparece em 416 e 206, porque vem de `event.res.headers` (D-05).

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Inserir o bloco da seção "Fluxo" depois de `src/utils/static.ts:270`; adicionar os helpers privados no fim do arquivo, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`); atualizar o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com uma linha sobre Range. |
| `test/static.test.ts` | Novo bloco `describeMatrix("serve static range", ...)` (ver Estratégia de testes). Os blocos existentes (`test/static.test.ts:4`, `:57-72`, `:600-617`) não mudam. |
| `sdd/techspec.md` | Este documento. |

Arquivos que **não** mudam: `src/index.ts` (RF-11), `src/response.ts`, `src/utils/internal/cache.ts`, `src/rules/cache.ts` (o cache de regras já ignora `Range` em `src/rules/cache.ts:143-148`, fora de escopo).

## Estratégia de testes

Seguir o fluxo do `AGENTS.md` (Bug Fix Workflow): escrever os testes primeiro, confirmar que falham, depois implementar.

Todos os casos em `describeMatrix` (roda em `web` e `node`). Usar `ctx.app.all("/**", ...)` com `getMeta`/`getContents` controlados, como em `test/static.test.ts:4-30`.

Casos obrigatórios:

1. **RF-01:** GET e HEAD com `size` conhecido recebem `accept-ranges: bytes`. Sem `size` não recebem.
2. **RF-02:** `bytes=a-b`, `bytes=a-` e `bytes=-n` retornam 206, `content-range` e `content-length` corretos, e corpo com o trecho exato. Cobrir trecho que cruza fronteira de chunk em stream.
3. **RF-03:** `b >= size` e `n > size` são ajustados (o sufixo maior que o arquivo devolve o arquivo inteiro com 206).
4. **RF-04:** `a >= size`, `bytes=-0` e `size: 0` retornam 416, `content-range: bytes */size`, `content-length: 0`, corpo vazio.
5. **RF-05:** malformado, multi-range (`bytes=0-1,3-4`), unidade diferente (`items=0-1`) e `start > end` retornam 200 completo, sem `content-range`.
6. **RF-06:** HEAD com Range satisfazível retorna 206 com os mesmos `content-range` e `content-length` do GET, sem corpo.
7. **RF-07:** `If-Range` com ETag forte igual → 206; com `W/"..."` igual → 200; diferente → 200; data igual ao `Last-Modified` → 206; data diferente → 200; `If-Range` sem `Range` → 200.
8. **RF-08:** `If-None-Match` ou `If-Modified-Since` com Range → 304, sem `content-range`.
9. **RF-09:** `meta.encoding` definido → 200 sem `content-range`; pedido com `accept-encoding: gzip` que escolhe a variante `.gz` → 200 completo mesmo com Range.
10. **D-05:** `headers: { "content-length": "999" }` com Range → 206 com `content-length` do trecho. Com Range ignorado → 200 mantém `999` (o teste existente cobre esse lado).
11. **Corpos:** `Blob`, `string` (com caractere multibyte, verificando que o corte é em bytes), `ReadableStream` com chunks pequenos, e cancelamento do leitor ao final do stream.
12. **RF-10:** os testes existentes de cache, encoding, `fallthrough`, 404 e 405 passam sem alteração.
13. **RF-11:** `test/unit/package.test.ts` (snapshot de exports) passa sem alteração.

Comandos:

```bash
pnpm vitest run test/static.test.ts
pnpm vitest run test/unit/package.test.ts
pnpm vitest run test/security.test.ts
pnpm lint
pnpm typecheck
pnpm test        # lint + typecheck + cobertura completa
```

Observação para os testes novos: não usar `etag: "w/123"` (fixture atual de `test/static.test.ts:9-30`). Essa string não começa com `W/` e não é um ETag válido por ser sem aspas. Os casos de `If-Range` devem usar `"abc"` e `W/"abc"`.

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **Desempenho em stream grande.** Para `ReadableStream`, bytes antes de `start` são lidos e descartados (D-04). | Latência alta em vídeo grande com seek para o fim. | Medir com um stream de 100 MB e seek para o último trecho antes de fechar. Se for lento, abrir uma opção futura (fora deste escopo) para leitura por intervalo. |
| **`size` diferente do conteúdo.** Se `meta.size` não bater com o corpo, `content-range` e `content-length` ficam errados (PRD, Riscos). | Cliente recebe corpo truncado ou excedente. | Mesmo risco do 200 atual. Não há como detectar sem ler o arquivo. Documentar no JSDoc que `size` deve ser o tamanho real. |
| **Sobrescrita de `content-length` configurado pelo usuário** (D-05). | Usuário que fixa `content-length` vê o valor trocado em 206/416. | Comportamento necessário para correção. Registrado no JSDoc e coberto pelo caso 10. |
| **Tamanho do arquivo de `static.ts`.** O arquivo sai de 352 para cerca de 500 linhas (D-01). | Contraria a meta de 200 linhas do `AGENTS.md`. | Aceito por pedido explícito. Se o arquivo continuar crescendo, a extração de `range` para `utils/internal/` é a próxima mudança. |
| **Validador fraco em `If-Range`** (PRD). Tratar `W/` como forte geraria 206 para outra versão do arquivo. | Cliente mistura trechos de versões diferentes. | Regra explícita em D-07 e caso 7. |
| **`bytes=-n` em arquivo de tamanho zero.** A RFC permite tratar como satisfazível, mas não há byte para devolver. | Escolha de comportamento. | D-08 e D-09: qualquer intervalo em `size: 0` vira 416. |
| **Tamanhos maiores que `Number.MAX_SAFE_INTEGER`.** Os valores passam por `Number`. | Comparações imprecisas para arquivos acima de 2^53 bytes. | Fora de escala prática para arquivos estáticos. Não tratar nesta mudança. |
| **`h3/rules/cache` ignora Range** (`src/rules/cache.ts:143-148`). | Respostas parciais não entram no cache de regras. | Comportamento existente e alinhado com o PRD. Não muda nesta mudança. |
| **Fixture `etag: "w/123"`** em `test/static.test.ts`. | Validador malformado pode mascarar um erro de `If-Range`. | Usar ETags com aspas nos casos novos (ver Estratégia de testes). |
| **Corpo `null` com `size` conhecido.** `getContents` devolvendo `null` com `size > 0` gera 206 com `content-length` sem corpo. | Mesmo problema que o 200 já tem hoje (`src/utils/static.ts:277`). | Não corrigido nesta mudança, para manter o RF-10. Registrado para revisão separada. |
