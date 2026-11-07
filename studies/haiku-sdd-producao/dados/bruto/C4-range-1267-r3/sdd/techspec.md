# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-11). Este documento decide como implementar; não repete os critérios de aceite do PRD.

## Estado atual (conferido no código)

- `serveStatic` ignora `Range`: a resposta de sucesso é sempre `200` com `getContents(id)` inteiro (`src/utils/static.ts:276-277`).
- `Content-Length` só é definido a partir de `meta.size`, e só quando ainda não existe no `event.res.headers` (`src/utils/static.ts:268-270`). Um `content-length` vindo de `options.headers` vence (teste em `test/static.test.ts:600-617`).
- `HEAD` retorna cedo, sem `getContents` (`src/utils/static.ts:272-274`).
- O 304 é decidido antes de qualquer outra coisa relacionada a conteúdo (`src/utils/static.ts:243-248`).
- O tipo `StaticAssetMeta.size` é `number` opcional (`src/utils/static.ts:13`). `getContents` aceita `BodyInit | null | undefined` (`src/utils/static.ts:33`).
- `src/index.ts:193` exporta só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Nada novo entra ali.
- Nenhum teste existente envia `Range` (busca por `range` em `test/static.test.ts`, `test/security.test.ts` e `test/unit/` sem ocorrências relevantes). Portanto nenhum teste existente precisa mudar de expectativa.

## Decisões de arquitetura

### D-01 — Implementar dentro de `serveStatic`, sem opção nova nem API nova

**Alternativas consideradas**
1. Nova opção em `ServeStaticOptions` (ex.: `ranges: true`).
2. Função exportada separada (ex.: `serveStaticRange`) ou middleware à parte.
3. Implementar dentro de `serveStatic`, sempre ativo.

**Escolha: 3.** O PRD (RF-10) e o pedido proíbem novas exportações e novas opções. A issue diz que não há mudança de API. Range é o comportamento que a RFC 9110 espera de qualquer servidor de estáticos, então não há motivo para torná-lo opcional. O único efeito externo é o que os RFs descrevem.

### D-02 — Parsing do `Range`: estrito, um único intervalo, ignora o que não entende

**Alternativas consideradas**
1. Rejeitar cabeçalho inválido com `400`.
2. Atender o primeiro intervalo de uma lista com múltiplos.
3. Ignorar o cabeçalho (serve `200` completo) quando for malformado, de outra unidade ou com mais de um intervalo; `416` só para intervalo sintaticamente válido e não satisfazível.

**Escolha: 3.** Segue RFC 9110 §14.2 (o servidor pode ignorar `Range`) e o RF-03. Regras concretas do parser:

- Unidade `bytes`, comparada sem diferenciar maiúsculas (RFC 9110 §14.1).
- Formas aceitas: `a-b`, `a-` e `-n`. Dígitos apenas (`/^\d+$/`).
- `b < a` é sintaticamente inválido e vira ignorado (RFC 9110 §14.1.1).
- Elementos vazios na lista (`bytes=0-10,`) são tolerados pela gramática da lista (RFC 9110 §5.6.1). Se sobrar exatamente um intervalo, ele é atendido. Se sobrarem dois ou mais, ignora (RF-03).
- `-0` é sintaticamente válido e não satisfazível: `416`.
- `a` maior ou igual ao tamanho: `416`. `b` maior ou igual ao tamanho: limitado a `size - 1`.
- `-n` com `n > size`: intervalo inteiro, `0-(size-1)`.

### D-03 — Fatiar o corpo por tipo, sem carregar o asset inteiro quando o tipo permite

**Alternativas consideradas**
1. Sempre `await new Response(contents).arrayBuffer()` e fatiar em memória.
2. Fatiar só `Blob`/`File` e, para os demais tipos, responder `200` (ignorar `Range`).
3. `Blob` com `slice` nativo (lazy, sem leitura). Os demais tipos viram stream com `new Response(contents).body` e passam por um pular/tomar: descarta `start` bytes e emite `length` bytes, depois cancela o upstream.

**Escolha: 3.** A opção 1 viola a preocupação de memória do PRD. A opção 2 deixa de atender RF-02 para `string` e `ArrayBuffer`, que são os tipos de conteúdo em memória mais comuns e são os usados pelos testes existentes (`getContents` devolve string em `test/static.test.ts:8`). A opção 3 cobre todos os `BodyInit` com um único caminho.

Consequências:
- Para `Blob`/`File`, o custo é o do `slice` nativo.
- Para stream, `start` bytes são lidos e descartados. **Não é seek real**, e o PRD já coloca seek real fora de escopo.
- `FormData` e `URLSearchParams` são serializados pelo `Response` com outros bytes. Trata-se como risco (ver Riscos).

**Contrato interno**

```ts
// src/utils/static.ts — privado, sem export
function sliceContents(contents: BodyInit, start: number, length: number): BodyInit;
// Blob  → contents.slice(start, start + length)
// outros → sliceStream(new Response(contents).body!, start, length)
```

`sliceStream` é um `ReadableStream<Uint8Array>` com `pull` que lê do `reader`, descarta até `start` e emite até `length`. Ao completar `length`, fecha o controlador e cancela o `reader`. `cancel` repassa o cancelamento ao `reader`.

### D-04 — `If-Range`: validadores fortes e comparação exata

**Alternativas consideradas**
1. Comparação fraca (aceitar `W/`).
2. Comparação por `Date` (parse) em vez de string para a data.
3. ETag forte por igualdade exata, data por igualdade exata com o `Last-Modified` efetivamente enviado; `W/` nunca casa.

**Escolha: 3.** Segue RFC 9110 §13.1.5 e RF-06. Os validadores comparados são os da resposta (`event.res.headers.get("etag")` e `event.res.headers.get("last-modified")`), não os de `meta`, para que o cliente seja comparado com o que ele de fato recebeu, inclusive quando `options.headers` sobrescreveu algum deles.

```ts
// src/utils/static.ts — privado
function matchesIfRange(ifRange: string, etag: string | null, lastModified: string | null): boolean;
// etag: forte (não começa com "W/") e ifRange === etag
// lastModified: ifRange === lastModified
```

`If-Range` ausente significa que o `Range` vale. `If-Range` presente e não casado significa ignorar o `Range` (200 completo).

### D-05 — Ordem de decisão dentro de `serveStatic`

Ordem nova, a partir do bloco atual de `content-length` (`src/utils/static.ts:268-270`):

1. Mantém o 304 em `src/utils/static.ts:243-248` como está (RF-07). Nada de Range antes dele.
2. Define `accept-ranges: bytes` em `event.res.headers`, só se não existir (RF-01). Este passo fica depois do 304, porque a RF-01 só exige o cabeçalho em 200, 206 e 416.
3. Se há `range` na requisição, `meta.size` é inteiro positivo e `If-Range` (se houver) casa, tenta `parseRange`. Se o parser devolver `undefined`, segue como 200.
4. Se o intervalo é `null` (não satisfazível): responde 416 (D-06). Não chama `getContents`.
5. Se é válido e o método é `GET`: chama `getContents(id)` **antes** de escrever `content-range` e `content-length`. Se o resultado for `null`/`undefined`, segue como 200 sem tocar nos cabeçalhos de Range. Caso contrário, escreve `content-range` e `content-length` em `event.res.headers` (sobrescrevendo, D-07) e retorna `new HTTPResponse(sliceContents(...), { status: 206, statusText: "Partial Content" })`.
6. Se é válido e o método é `HEAD`: escreve os mesmos dois cabeçalhos e retorna `new HTTPResponse(null, { status: 206, statusText: "Partial Content" })`. Não chama `getContents`.
7. Sem Range atendível: segue o caminho atual (`src/utils/static.ts:272-277`), inalterado.

A chamada a `getContents` só acontece depois da decisão, para que nunca sobre `content-range` escrito quando a resposta final for 200.

### D-06 — Resposta 416: cabeçalhos via `errHeaders`, sem cache-control

**Problema verificado:** `toResponse` trata `status >= 400` de forma diferente. Só mescla `event.res.errHeaders` e descarta `event.res.headers` (`src/response.ts:211`). Ou seja, se o 416 usasse `event.res.headers`, `accept-ranges`/`content-range` não sairiam.

**Alternativas consideradas**
1. Pôr todos os cabeçalhos em `new HTTPResponse(null, { status: 416, headers })`.
2. Usar `event.res.errHeaders` para `accept-ranges`, `content-range` e `content-length: 0`, e devolver `new HTTPResponse(null, { status: 416, statusText })`.
3. Copiar `event.res.headers` inteiro para o 416.

**Escolha: 2.** É o mecanismo que o próprio framework prevê para cabeçalhos de erro (`src/event.ts:205`). A opção 3 é descartada porque o `cache-control` vindo de `options.headers` tornaria o 416 cacheável por tempo; um cache compartilhado poderia então servir 416 a uma requisição **sem** `Range` para a mesma URL. Isso é um risco de correção, não só de estilo.

Cabeçalhos do 416: `accept-ranges: bytes`, `content-range: bytes */<size>`, `content-length: 0`. Corpo `null` (RF-04). `nullBody` não inclui 416 (`src/response.ts:350-356`), mas o corpo já é `null`.

### D-07 — `content-length` do 206 sobrescreve o do usuário; o do 200 não muda

**Alternativas consideradas**
1. Deixar `options.headers['content-length']` vencer também no 206 (a regra atual do `if (!has)`).
2. Sobrescrever com `set` só no 206 (e no HEAD com Range atendido).

**Escolha: 2.** Um 206 com `content-length` de outro tamanho quebra o corpo (Riscos do PRD). O teste `does not overwrite a content-length already set on the response` (`test/static.test.ts:600-617`) continua válido, porque cobre o 200 e o 200 não muda.

### D-08 — Tudo fica em `src/utils/static.ts`, no bloco `// --- Internal Utils ---`

**Alternativas consideradas**
1. Módulo interno novo `src/utils/internal/range.ts`.
2. Helpers no fim de `src/utils/static.ts`.

**Escolha: 2**, porque o RF-10 e o pedido dizem literalmente que as funções auxiliares ficam privadas em `src/utils/static.ts`. **Tensão com AGENTS.md:** o arquivo já tem 351 linhas (`src/utils/static.ts:351`), acima do alvo de < 200 linhas, e a mudança soma ~100. Se o time preferir `src/utils/internal/range.ts` (que o AGENTS.md recomenda para helpers internos), é um desvio do RF-10 que precisa de aprovação explícita. Esta spec segue o PRD.

Helpers propostos, no mesmo estilo dos existentes (`parseAcceptEncoding` em `src/utils/static.ts:292`, `WEIGHT_RE` em `src/utils/static.ts:283`):

```ts
interface RangeSpec {
  /** Início do intervalo. `undefined` no formato de sufixo `-n`. */
  start?: number;
  /** Último byte (inclusivo), ou tamanho do sufixo quando `start` é `undefined`. */
  end?: number;
}

/** Devolve `undefined` quando o cabeçalho deve ser ignorado (D-02). */
function parseRange(header: string): RangeSpec | undefined;

/** Devolve `null` quando o intervalo não é satisfazível (416). */
function resolveRange(spec: RangeSpec, size: number): { start: number; end: number } | null;

function matchesIfRange(ifRange: string, etag: string | null, lastModified: string | null): boolean;

function sliceContents(contents: BodyInit, start: number, length: number): BodyInit;

function sliceStream(source: ReadableStream<Uint8Array>, start: number, length: number): ReadableStream<Uint8Array>;
```

Nenhum desses nomes entra em `src/index.ts`. Nenhum tipo novo é exportado.

## Contratos e assinaturas

Públicos: **nenhuma mudança**. `serveStatic(event, options): Promise<HTTPResponse | undefined>` (`src/utils/static.ts:101-104`) e `ServeStaticOptions` ficam iguais. `StaticAssetMeta` fica igual.

Comportamento observável novo (só para requisições com `Range`):

| Situação                                     | Status | Cabeçalhos de Range                                   | Corpo                |
| -------------------------------------------- | ------ | ----------------------------------------------------- | -------------------- |
| `GET` e intervalo válido                     | 206    | `content-range: bytes a-b/size`, `content-length: n` | bytes `a..b`         |
| `HEAD` e intervalo válido                    | 206    | igual ao GET                                          | vazio                |
| Intervalo não satisfazível                   | 416    | `content-range: bytes */size`, `content-length: 0`    | vazio                |
| Malformado, outra unidade, multi, `size` inválido, `If-Range` não casa | 200 | nenhum | corpo completo |
| `If-None-Match`/`If-Modified-Since` casam    | 304    | nenhum                                                | vazio                |

`accept-ranges: bytes` aparece em 200, 206 e 416 (RF-01), tanto para GET quanto HEAD.

## Arquivos a alterar

1. `src/utils/static.ts`
   - `src/utils/static.ts:268-270`: manter o bloco do `content-length` como está. O bloco novo entra logo depois dele.
   - `src/utils/static.ts:272-274` (`HEAD`) e `src/utils/static.ts:276-277` (GET): o caminho 206 é inserido antes destes; o 200 fica intacto.
   - `src/utils/static.ts:243-248`: sem mudança (o 304 precede o Range).
   - `src/utils/static.ts:280` em diante: helpers privados.
   - Docblock de `serveStatic` (`src/utils/static.ts:68-100`): acrescentar um parágrafo curto sobre Range, no mesmo tom dos outros parágrafos do bloco.
2. `test/static.test.ts`: novo bloco `describeMatrix` após o existente (`test/static.test.ts:5`), usando o padrão de `describeMatrix` de `test/_setup.ts:11`. Ver Estratégia de testes.
3. Não alterar: `src/index.ts` (`src/index.ts:193` fica igual), `src/response.ts`, `src/event.ts`, `package.json`, configuração de lint e build.

## Estratégia de testes

Seguir o fluxo de correção do AGENTS.md: escrever os testes **antes** da implementação e confirmar que falham (hoje, qualquer `Range` devolve 200, então os cenários de 206/416 falham).

Novo `describeMatrix("serve static range", ...)` em `test/static.test.ts`, com um asset de 1000 bytes ASCII (ex.: `"0123456789".repeat(100)`), `etag` forte e `mtime` fixos. Como `describeMatrix` do `test/_setup.ts:11` já roda `web` e `node`, cada `it` cobre os dois modos. `describeMatrix` não expõe `it.each`, então usar `for` dentro de um `it`.

Casos, por RF:

- **RF-01:** `Accept-Ranges: bytes` em GET 200, HEAD 200, 206 e 416.
- **RF-02:** `0-499` (corpo, `content-range`, `content-length` 500); `500-` (500 bytes finais); `-100` (100 bytes finais); `900-5000` (limitado a `900-999`).
- **RF-03:** `bytes=abc`, `items=0-10`, `bytes=0-10, 20-30`, `bytes=5-3`, `bytes=` → 200, sem `content-range`, corpo completo.
- **RF-04:** `bytes=1000-1200` e `bytes=-0` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. Verificar também que **não há** `cache-control` no 416, mesmo com `options.headers` definindo `cache-control` (D-06).
- **RF-05:** HEAD com `0-499` → 206 com cabeçalhos, corpo vazio. HEAD com `1000-` → 416.
- **RF-06:** If-Range com ETag forte igual → 206; diferente → 200; ETag fraco igual (`W/"abc"`) → 200; data igual ao `last-modified` → 206; data diferente → 200.
- **RF-07:** `If-None-Match` casando + Range → 304, sem `content-range`.
- **RF-08:** `getMeta` sem `size` → 200 completo; `size: 0` → 200.
- **RF-09:** `fallthrough: true` + POST com Range → `undefined` (o handler não responde); sem fallthrough, POST continua 405 com `allow: GET, HEAD`.
- **D-07:** `headers: { "content-length": "999" }` + `bytes=0-499` → 206 com `content-length: 500`; sem Range → 200 com `999` (o teste atual já cobre o 200).
- **D-03 (tipos de conteúdo):** o mesmo intervalo (`0-499` e `990-999`) devolve os mesmos bytes quando `getContents` devolve string, `Uint8Array`, `Blob` e `ReadableStream`. Para o stream, verificar também que `cancel` foi chamado após a fatia completa (um `vi.fn` no `underlyingSource.cancel`, ou contagem de chunks lidos).
- **Pré-comprimido:** com `encodings: { gzip: ".gz" }` e `accept-encoding: gzip`, o `Range` aplica-se aos bytes da variante `.gz`, e `size` é o da variante (PRD, premissas).
- **Regressão:** a suíte existente inteira passa sem alteração (`pnpm vitest run test/static.test.ts`).
- **RF-10:** `git diff -- src/index.ts` vazio. Não há teste automatizado para isso.

Verificação final: `pnpm vitest run test/static.test.ts`, `pnpm typecheck` (`tsc --noEmit`, `package.json`), `pnpm lint` (`oxlint . && oxfmt --check .`). Depois, se o tempo permitir, `pnpm test`.

## Riscos

1. **`size` diferente do conteúdo real.** `Content-Range` e `Content-Length` ficam errados. Mitigação possível: para `Blob`, comparar `blob.size` com `meta.size` e servir 200 se divergir. Não está na spec por padrão; decidir na implementação. Para stream não há como checar antes de ler.
2. **Stream truncado.** Se a fonte tiver menos bytes que `size`, o `pull` termina antes de `length` e o corpo sai menor que o `content-length`. Mitigação: fechar o controlador sem completar e aceitar a inconsistência, ou abortar com erro. Decidir na implementação; não é coberto pela suíte atual.
3. **Memória e custo em stream.** `start` bytes são lidos e descartados, então um Range perto do fim de um arquivo grande lê o arquivo quase inteiro. É limitação aceita (seek real fora de escopo no PRD). Medir se o caso de vídeo for usado com fonte de stream.
4. **Divergência `size` × bytes de string.** `meta.size` é em bytes, mas strings com caracteres não ASCII têm `.length` diferente do número de bytes UTF-8. Os fixtures de teste usam `.length` (`test/static.test.ts:18`), que é igual a bytes só porque é ASCII. Não mudar isso agora; registrar que o contrato é "`size` = bytes".
5. **`FormData` e `URLSearchParams`.** `new Response(x)` serializa com outros bytes (boundary de multipart, por exemplo). O `size` de `getMeta` não bate, e o `Range` fica sem sentido. Caso raro para asset estático; aceitar e documentar, ou tratar como `200` (ignorar Range) para esses tipos.
6. **ETag malformado nos fixtures.** Os testes usam `etag: "w/123"` (`test/static.test.ts:15`), sem aspas e em minúsculas. Pela regra `W/` maiúsculo (`src/utils/internal/cache.ts:52`), isso é tratado como forte. Os testes de If-Range devem usar ETags bem formados (`"abc"`) para não depender disso.
7. **HEAD × GET quando `getContents` devolve `null` com `size > 0`.** HEAD responde 206 e GET responde 200. Caso só ocorre com dado inconsistente; documentar.
8. **Cache compartilhado e 206.** Um 206 herda `cache-control` de `options.headers`. Caches seguem RFC 9111 para respostas parciais, e o PRD deixa "cache separado para 206" fora de escopo. Registrar, não tratar agora.
9. **Tamanho do arquivo e guideline.** `src/utils/static.ts` passa a ter ~450 linhas, contra a meta de < 200 do AGENTS.md. Ver D-08; a alternativa `src/utils/internal/range.ts` depende de aprovação, porque contraria o RF-10.
10. **Overlap com `h3/rules` e `proxy`.** Fora de escopo (PRD). Nenhum código de `src/rules/` ou `src/utils/proxy.ts` é alterado.
