# Especificação técnica: HTTP Range no `serveStatic`

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-12), h3js/h3#1267.
Norma: RFC 9110 §13.1.5 (If-Range), §14 (Range Requests). Todas as referências `arquivo:linha` foram conferidas no código atual (commit `0e2ff6c`).

## Visão geral

O `serveStatic` ganha três comportamentos, sempre dentro de `src/utils/static.ts`:

1. Anuncia `Accept-Ranges: bytes` em toda resposta de asset encontrado.
2. Avalia o cabeçalho `Range` (depois de `If-Range`) e responde `206` com o recorte, ou `416`, ou ignora o `Range` e responde `200` completo.
3. Em `HEAD`, aplica a mesma decisão de status e cabeçalhos, sem ler o conteúdo.

Nada muda na API pública: `ServeStaticOptions` (`src/utils/static.ts:17-66`) não ganha campos, e `src/index.ts:193` continua exportando os mesmos nomes.

Fluxo atual, para referência:

| Etapa | Linhas |
|---|---|
| Assinatura de `serveStatic` | `src/utils/static.ts:101-104` |
| Rejeita métodos diferentes de GET/HEAD (405) | `src/utils/static.ts:116-122` |
| Rejeita caminho não canônico (404 / fallthrough) | `src/utils/static.ts:142-147` |
| Busca de `getMeta` nas variantes | `src/utils/static.ts:198-215` |
| Cabeçalho `Vary` | `src/utils/static.ts:220-225` |
| `last-modified` (truncado a segundos) | `src/utils/static.ts:227-237` |
| `etag` | `src/utils/static.ts:239-241` |
| Cache: 304 | `src/utils/static.ts:243-248` |
| `content-type` / `content-encoding` | `src/utils/static.ts:250-266` |
| `content-length` (só se ausente) | `src/utils/static.ts:268-270` |
| Ramo HEAD (200 sem corpo) | `src/utils/static.ts:272-274` |
| GET (200 com `getContents`) | `src/utils/static.ts:276-277` |

## Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Escolha:** todas as funções auxiliares ficam em `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), sem `export`.

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts`. É o padrão do repositório para helpers (`src/utils/internal/cache.ts` já tem `isCacheMatch`, `src/utils/internal/cache.ts:29`), e ajuda a manter arquivos abaixo de ~200 linhas, conforme `AGENTS.md`.

**Justificativa:** o contrato (`sdd/pedido.md`, "Restrições") e o PRD (RF-11, "Fora de escopo") pedem que os auxiliares fiquem privados no módulo `static.ts`. Um arquivo `internal/` não é exportado publicamente, mas contraria o texto literal do pedido. Mantemos em `static.ts`.

**Consequência:** `static.ts` passa de 351 para ~480 linhas, acima da orientação de `AGENTS.md`. Ver Riscos (R-06).

### D-02 — Interpretação do cabeçalho `Range`

**Escolha:** uma função pura `parseRange(value, size)`, com uma única expressão regular:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;
```

- Após `trim()`, o valor tem de casar com a regex. Isso rejeita unidade diferente de `bytes` (`items=`), lista com vírgula (múltiplas faixas), valores não numéricos e formas vazias (`bytes=-`). Todos esses casos devolvem `undefined` (ignorar, 200 completo). Cobre RF-03.
- `bytes` é case-insensitive, como a unidade de Range na RFC 9110 §14.1.
- `first > last` com ambos presentes é sintaticamente inválido (RFC 9110 §14.1.1). Devolve `undefined`.
- `first >= size` devolve `"unsatisfiable"` (RF-04).
- `-n` com `n > 0` devolve os últimos `min(n, size)` bytes; sufixo maior que o arquivo devolve o arquivo inteiro como 206 (PRD, RF-02).
- `-0` devolve `"unsatisfiable"` (RF-04).
- Fim maior que `size - 1` é ajustado para `size - 1` (RF-02).

**Alternativas consideradas:**
- Separar por vírgula e contar elementos. Mais código e o mesmo resultado, já que a regex não aceita vírgula.
- Biblioteca de parsing de Range. Nova dependência para ~10 linhas; o `AGENTS.md` pede núcleo mínimo.

### D-03 — Avaliação de `If-Range`

**Escolha:** `ifRangeMatches(ifRange, { etag, mtime })`:
- Se `If-Range` começa com `"`, é um ETag: compara com igualdade exata e só casa se o `etag` do asset for forte (não começa com `W/`). Isso segue a comparação forte da RFC 9110 §13.1.5.
- Caso contrário, é uma data: casa se `new Date(ifRange).getTime() === mtimeDate.getTime()`. `mtimeDate` já está truncado a segundos (`src/utils/static.ts:232`), então a comparação é na precisão do HTTP-date.
- Se o validador do asset não existe, o `If-Range` não casa e o resultado é 200 completo.

**Alternativas consideradas:**
- Usar `isCacheMatch` (`src/utils/internal/cache.ts:29`). Não serve: ele faz comparação fraca e só para `If-None-Match`/`If-Modified-Since`.
- Comparação fraca no ETag. A RFC proíbe para `If-Range`; errar aqui entregaria um recorte de uma versão diferente do arquivo, que é o pior caso.

### D-04 — Ordem de avaliação

**Escolha:** a ordem fica assim dentro de `serveStatic`:
1. Cache (304) como hoje, em `src/utils/static.ts:243-248`. Cumpre RF-08.
2. `Range` é avaliado depois de `content-type`, `content-encoding` e `vary`, mas antes do ramo HEAD.
3. Só é avaliado se `meta.size > 0` (RF-06). Tamanho 0 é tratado como desconhecido, como hoje (`src/utils/static.ts:268`).

**Alternativas consideradas:** avaliar `Range` antes do cache. Violaria RF-08 (um 304 deve prevalecer).

### D-05 — `Accept-Ranges` também em 304

**Escolha:** `Accept-Ranges: bytes` é definido em `event.res.headers` logo antes do bloco de cache (`src/utils/static.ts:243`), somente se o cabeçalho ainda não existir. Assim ele também aparece no 304, junto com `etag` e `last-modified`, que já são definidos nesse ponto (`src/utils/static.ts:234-241`).

**Divergência do PRD:** RF-01 cita 200, 206 e 416. A RFC 9110 §14.3 permite o cabeçalho em qualquer resposta. Escolhemos a forma que mantém os cabeçalhos de validação consistentes entre 200 e 304. **Confirmar com o time** se preferem estritamente 200/206/416.

**Alternativas consideradas:** definir só nos ramos 200/206/416. Mais código e um 304 sem o cabeçalho que os outros cabeçalhos de validação têm.

### D-06 — `Content-Length` em 206 e 416 sobrescreve o valor do usuário

**Escolha:** em 206 e 416, `content-length` é definido com `set` (sobrescreve). Em 200 o comportamento atual não muda: `content-length` só é definido se ausente (`src/utils/static.ts:268`), e o teste "does not overwrite a content-length already set on the response" (`test/static.test.ts:600-617`) continua válido.

**Justificativa:** um `Content-Length` fixo vindo de `options.headers` está errado para um recorte. Manter o valor do usuário quebraria RF-02 e a RFC 9110 §15.3.7.

**Alternativas consideradas:** respeitar o cabeçalho do usuário também em 206. Gera resposta inválida.

### D-07 — Recorte do corpo

**Escolha:** uma função `sliceBody(contents, start, end)` que devolve `BodyInit | Promise<BodyInit>`, com estratégia por tipo:

| Tipo de `contents` | Estratégia | Memória |
|---|---|---|
| `string` | `TextEncoder` → `Uint8Array` → `subarray(start, end + 1)` | O texto inteiro |
| `ArrayBuffer` / `ArrayBufferView` | `slice` / `subarray` | Nenhuma cópia extra |
| `Blob` (inclui `File`) | `blob.slice(start, end + 1)` | Preguiçoso, sem leitura |
| `ReadableStream` | `pipeThrough(TransformStream)` que descarta `start` bytes e termina após `end - start + 1` | Por chunk. Upstream é cancelado ao terminar |
| Outros (`FormData`, `URLSearchParams`) | `new Response(contents).arrayBuffer()` e depois `slice` | O corpo inteiro |

**Justificativa:** `getContents` não recebe o intervalo (`src/utils/static.ts:33`, premissa do PRD). O recorte precisa acontecer aqui. Para `ReadableStream` (o caso de arquivos grandes), o `TransformStream` evita carregar o arquivo; para `Blob` o `slice` é preguiçoso. Ver R-01 sobre I/O.

**Alternativas consideradas:**
- Sempre ler tudo em `ArrayBuffer` e cortar. Simples, mas pior que o estado atual para `ReadableStream`, que hoje é repassado sem buffer (`src/utils/static.ts:277`).
- Pedir ao `getContents` um intervalo. Muda a assinatura, que está fora de escopo (PRD, "Fora de escopo").

### D-08 — `HEAD` e `416` não chamam `getContents`

**Escolha:** em `HEAD`, o ramo atual retorna antes de `getContents` (`src/utils/static.ts:272-274`). A decisão de Range roda antes desse ramo, então HEAD recebe o mesmo status e os mesmos cabeçalhos do GET, sem corpo e sem leitura. O 416 também não lê o conteúdo.

### D-09 — Ponto de inserção do Range no código

Não mexemos em `parseAcceptEncoding`, `idSearchPaths` nem na lógica de variantes. A mudança é localizada em três pontos:

1. Antes do bloco de cache (`src/utils/static.ts:243`): definir `accept-ranges`.
2. Substituir o bloco de `content-length` e o retorno final (`src/utils/static.ts:268-277`) pela nova sequência.
3. Acrescentar as funções auxiliares ao final do arquivo (`src/utils/static.ts:351`).

Além disso, atualizar o comentário JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com um parágrafo curto sobre Range. O PRD permite comentários de módulo (sem mudança de documentação pública).

## Contratos e assinaturas

Todas privadas em `src/utils/static.ts`:

```ts
type ByteRange = { start: number; end: number };

/** `undefined` ignora o Range; `"unsatisfiable"` gera 416; senão, 206 com o recorte. */
type RangeOutcome = ByteRange | "unsatisfiable" | undefined;

const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;

/** Sintaxe e satisfação de um `Range` de uma única faixa (RFC 9110 §14.1, §14.1.1, §14.2). */
function parseRange(value: string, size: number): RangeOutcome;

/** `If-Range` (RFC 9110 §13.1.5): ETag forte por igualdade exata, ou data igual a `last-modified`. */
function ifRangeMatches(
  ifRange: string,
  validators: { etag?: string; mtime?: Date },
): boolean;

/** Recorte de `contents` entre `start` e `end` (inclusivos), em bytes. */
function sliceBody(contents: BodyInit, start: number, end: number): BodyInit | Promise<BodyInit>;
```

Sequência nova em `serveStatic`, substituindo `src/utils/static.ts:268-277`:

```ts
// Antes do bloco de cache (src/utils/static.ts:243):
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

// No lugar de src/utils/static.ts:268-277:
const size = meta.size ?? 0;
const ifRange = event.req.headers.get("if-range");
const range =
  size > 0 && event.req.headers.has("range") && !(ifRange && !ifRangeMatches(ifRange, { etag: meta.etag, mtime: mtimeDate }))
    ? parseRange(event.req.headers.get("range")!, size)
    : undefined;

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

if (range) {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(contents ? await sliceBody(contents, range.start, range.end) : null, { status: 206, statusText: "Partial Content" });
}

if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
  event.res.headers.set("content-length", meta.size + "");
}
// ... ramo HEAD e GET de 200 como hoje
```

Observações sobre a sequência:
- `If-Range` sem `Range` é ignorado. Só se avalia quando há `Range`, como manda a RFC.
- `contents` vazio ou `null` com 206 é tratado como corpo nulo. Isso é coerente com o 200 atual (`src/utils/static.ts:277`), mas um asset com `size > 0` e `getContents` vazio é uma inconsistência do backend (R-02).
- O `status` 206/416 vai no `HTTPResponse`; os cabeçalhos ficam em `event.res.headers`, que `toResponse` mescla (conferir em teste, ver Estratégia).

Alterações de tipo: nenhuma em `ServeStaticOptions`, `StaticAssetMeta`, `getMeta` ou `getContents`.

## Arquivos a alterar

| Arquivo | Mudança | Referências |
|---|---|---|
| `src/utils/static.ts` | Accept-Ranges, sequência de Range, JSDoc, auxiliares | `:68-100`, `:243`, `:268-277`, `:351` |
| `test/static.test.ts` | Novo bloco `describeMatrix("serve static range", …)` | inserir antes de `:396` |
| `test/unit/package.test.ts` | Nenhuma mudança esperada: snapshot de exports (`:133`) deve continuar igual | verificação de RF-11 |
| `src/index.ts` | Nenhuma mudança (`:193` fica igual) | RF-11 |

Testes existentes: nenhum teste de `test/static.test.ts` envia `Range` (conferido por busca; o único `range` na suíte está em `test/rules/cache.test.ts:1220`, que cobre o bypass do cache rule em `src/rules/cache.ts:143-148`). Por isso nenhum teste existente precisa ser ajustado.

## Estratégia de testes

Seguir o padrão de `test/static.test.ts` (`describeMatrix`, `t.app`, `t.fetch`), rodando em `web` e `node`. Usar um asset de 10 bytes com `getContents` que devolve `"0123456789"` (ou `Uint8Array`), e `size: 10`.

Casos, mapeados para os RF do PRD:

- **RF-01:** GET sem Range → 200, `accept-ranges: bytes`, corpo completo. Também 304 com `accept-ranges`.
- **RF-02:** `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345`. `bytes=-3` → `7-9/10`. `bytes=6-99` → `6-9/10`. `bytes=-99` → 206 com o arquivo inteiro.
- **RF-03:** `bytes=0-1,4-5` → 200 completo, sem `content-range`. `items=0-1` → 200. `bytes=abc` → 200. `bytes=5-2` → 200. `bytes=-` → 200.
- **RF-04:** `bytes=10-20` → 416, `content-range: bytes */10`, `content-length: 0`, corpo vazio. `bytes=-0` → 416.
- **RF-05:** HEAD com `bytes=2-5` → 206 sem corpo, com `content-length: 4`. HEAD com `bytes=10-20` → 416. Confirmar que `getContents` não é chamado em HEAD (`vi.fn`).
- **RF-06:** `getMeta` sem `size` com `bytes=0-3` → 200 completo, `accept-ranges` presente. `size: 0` idem.
- **RF-07:** `etag: '"v1"'` com `If-Range: "v1"` → 206. `If-Range: "v2"` → 200. `If-Range` com data igual a `last-modified` → 206; com data diferente → 200. `etag` fraco (`W/"v1"`) com `If-Range: W/"v1"` → 200. `If-Range` sem `Range` → 200 completo.
- **RF-08:** `If-None-Match` que casa + `Range` → 304 sem corpo.
- **RF-09:** variante `.gz` de 50 bytes com `accept-encoding: gzip` e `bytes=0-9` → 206, `content-encoding: gzip`, `content-range: bytes 0-9/50`, 10 bytes no corpo.
- **RF-10:** asset inexistente com `fallthrough: true` e Range → cai no próximo handler. `POST` com Range → 405 e `allow: GET, HEAD`.
- **Tipos de corpo (novo, D-07):** o mesmo intervalo para `string`, `ArrayBuffer`, `Uint8Array` (com `byteOffset` diferente de zero), `Blob` e `ReadableStream` com chunks que cruzam a fronteira do intervalo. Para `ReadableStream`, verificar que o upstream é cancelado depois do último byte (flag `cancel` do `start`/`cancel` do source).
- **Cabeçalho do usuário:** `headers: { "content-length": "999" }` com Range → 206 com `content-length` correto (D-06). Sem Range → continua 999 (teste existente).
- **Verificação de cabeçalhos mesclados:** confirmar que `content-range` definido em `event.res.headers` aparece na resposta final em `web` e `node` (depende de como `toResponse` mescla o status e os cabeçalhos; checar `src/response.ts` antes de implementar).
- **Regressão:** a suíte completa (`pnpm vitest run test/static.test.ts test/security.test.ts test/rules/cache.test.ts test/unit/package.test.ts`), depois `pnpm lint` e `pnpm typecheck`.

Ciclo de bug fix do `AGENTS.md`: escrever primeiro os testes de 206/416/If-Range e confirmar que falham no código atual (200 completo, sem `content-range`), depois implementar.

## Riscos

- **R-01 — Memória e I/O em streams.** Para `ReadableStream`, o recorte evita carregar o arquivo, mas o backend ainda lê do início até o `start`. Um vídeo com seek para o fim lê o arquivo quase inteiro a cada requisição. Isso pode ser pior do que servir o arquivo inteiro sem Range em termos de I/O. **Mitigação:** o PRD exclui otimização de I/O (Fora de escopo). Documentar no JSDoc. Se o backend for um filesystem, a otimização real é `getContents` aceitar intervalo, o que está fora de escopo.
- **R-02 — `meta.size` divergente.** Se `size` não bater com o conteúdo real, `Content-Range` e `Content-Length` ficam errados e clientes que retomam downloads recebem dados corrompidos. Mitigação: nenhuma verificação possível sem ler o conteúdo; documentar a premissa no JSDoc. Caso de `getContents` vazio com `size > 0`: hoje gera 200 sem corpo; com Range gera 206 sem corpo. Aceitar e documentar.
- **R-03 — Arquivo vazio.** `size: 0` é tratado como desconhecido (D-04, `src/utils/static.ts:268`). Um arquivo vazio responde 200 a qualquer Range. É compatibilidade, não RFC. Registrar no teste.
- **R-04 — `If-Range` com data.** Comparação exata na precisão de segundos. Se o cliente enviar uma data com fração de segundo, não casa e recebe 200. Seguro, mas ineficiente. Coberto por teste.
- **R-05 — ETag sem aspas no `getMeta`.** Usuários podem devolver `etag: "w/123"` sem aspas (como no fixture de `test/static.test.ts:9-16`). Esses ETags não são fortes na forma `"..."` e nunca casam com `If-Range`, resultando em 200. Seguro. Documentar que o ETag deve ser uma string com aspas.
- **R-06 — Tamanho do arquivo.** `src/utils/static.ts` passa de ~350 para ~480 linhas, acima da orientação de ~200 linhas do `AGENTS.md`. Decisão D-01 segue o contrato. Se o time preferir, a alternativa é mover `parseRange`, `ifRangeMatches` e `sliceBody` para `src/utils/internal/range.ts` sem alterar a API pública.
- **R-07 — `Accept-Ranges` em 304.** Divergência pequena do PRD (D-05). Confirmar com o time.
- **R-08 — Interação com o cache rule.** `src/rules/cache.ts:143-148` já ignora requisições com `Range`, então um 206 não é armazenado como entrada do recurso inteiro. Nenhuma mudança necessária, mas o teste `test/rules/cache.test.ts:1220` deve continuar passando.
- **R-09 — Mesclagem de cabeçalhos com status customizado.** Se `toResponse` não aplicar `event.res.headers` quando `HTTPResponse` tem `status`, o `content-range` se perde. Verificar antes de implementar (ver Estratégia).
- **R-10 — Tipos de `BodyInit` raros.** `FormData` e `URLSearchParams` passam pelo caminho de buffer (D-07). É uma exceção e não é usado em `serveStatic` na prática; o `Content-Length` vindo de `size` já era inconsistente para esses tipos antes da mudança.
