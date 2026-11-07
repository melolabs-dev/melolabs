# Techspec: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md`, `sdd/prd.md`, `AGENTS.md`. Norma: RFC 9110 §13.1.5 (If-Range) e §14 (Range). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `b6452a3`).

## 1. Resumo

A mudança fica toda em `src/utils/static.ts`. Depois que o asset é resolvido, o 304 é avaliado e os cabeçalhos são montados, o `serveStatic` avalia o `Range` e escolhe entre 200 (completo), 206 (trecho) e 416. Os helpers são funções privadas no fim do arquivo, na seção `// --- Internal Utils ---`. Nenhuma assinatura pública muda e `src/index.ts` não é tocado.

## 2. Decisões de arquitetura

### D-01 — Onde avaliar o Range no fluxo

**Contexto.** O fluxo de `serveStatic` é: método → canonização → busca de meta/variante → `Vary` → `last-modified`/`etag` → 304 → `content-type`/`content-encoding`/`content-length` → HEAD → `getContents`.

**Alternativas.**
1. Avaliar o Range antes do 304. Viola o RF-07 (304 tem precedência) e a RFC 9110 §13.2.2 (o `Range` é avaliado depois das pré-condições).
2. Avaliar o Range logo no início, antes da busca da variante. O tamanho certo é o da variante escolhida, que só se conhece depois do laço de `getMeta`.
3. Avaliar depois do 304 e depois de `content-length` (escolhida).

**Escolha.** A opção 3. O ponto de inserção é entre o bloco de `content-length` (`src/utils/static.ts:268-270`) e o ramo HEAD (`src/utils/static.ts:272-274`). Assim a variante já foi escolhida (laço `:200-208`), o 304 já teve a chance de responder (`:243-248`) e o `id` usado em `getMeta`/`getContents` não muda (R5). O `id` e o `assetId` ficam intocados.

### D-02 — Estrutura dos helpers e privacidade

**Alternativas.** (a) novo arquivo `src/utils/internal/range.ts`; (b) helpers privados em `static.ts` (escolhida).

**Escolha.** A opção (b). O pedido manda manter a lógica privada no módulo `serveStatic`, e o PRD (RF-08, fora de escopo) limita as alterações a `static.ts` e aos testes. Um arquivo em `internal/` não apareceria em `src/index.ts`, mas violaria a letra do pedido. O arquivo atual tem 351 linhas e já passa da meta de 200 do `AGENTS.md`; o desvio é aceito e registrado como risco (R-07). Os helpers vão depois de `idSearchPaths` (`src/utils/static.ts:340-351`), sem `export`. Os tipos auxiliares (`ByteRange`) também ficam sem `export`; com `isolatedDeclarations`, funções não exportadas não exigem anotação, mas serão anotadas para seguir o estilo do arquivo (`parseAcceptEncoding`, `:292`).

### D-03 — Parsing do cabeçalho Range

**Alternativas.**
1. Parser tolerante, que aceita lista e usa o primeiro intervalo. Contraria a issue ("ignore multi-range").
2. Regex estrita de byte único (escolhida).

**Escolha.** A regex `^bytes=(\d*)-(\d*)$` aplicada ao valor com `trim()`, com a unidade comparada sem diferenciar maiúsculas (RFC 9110 §14.1: a unidade é case-insensitive). Regras:

- ambos os lados vazios (`bytes=-`), vírgula (multi-range, inclusive vários cabeçalhos `Range` que o `Headers.get` junta com `, `), unidade diferente ou texto qualquer (`bytes=abc`): retorna `undefined`, o Range é ignorado e a resposta é 200 (RF-05);
- `bytes=a-b` com `b < a` é sintaxe inválida (RFC 9110 §14.1.2): ignorado, 200;
- `bytes=a-`: do `a` até o fim;
- `bytes=-n`: os últimos `n` bytes. `n = 0` é satisfazível sintaticamente, mas não tem bytes: 416 (RF-04);
- números convertidos com `Number()`. Valores acima de `Number.MAX_SAFE_INTEGER` perdem precisão, mas sempre ficam `>= size`, então o resultado (416 para `a`, limite em `size - 1` para `b`) continua correto.

O resultado final tem três estados: `undefined` (ignorar), `"unsatisfiable"` (416) e `{ start, end }` (206). A função de resolução devolve `ByteRange | "unsatisfiable" | undefined`, sem símbolos extras.

### D-04 — Tamanho vem de `meta.size`; `size` 0 ou ausente ignora o Range

**Contexto.** O código trata `size` ausente e `size === 0` do mesmo modo ao definir `content-length` (`src/utils/static.ts:268`: `meta.size !== undefined && meta.size > 0`). O PRD (P1) manda ignorar o Range sem `size`, e (P4) deixa em aberto o `size` 0.

**Alternativas.**
1. `size === 0` com Range válido retorna 416 (literal da RFC).
2. `size === 0` é tratado como tamanho desconhecido: Range ignorado, 200 (escolhida).

**Escolha.** A opção 2. A RFC 9110 §14.2 permite ignorar o `Range` ("MAY ignore"), e o código atual já usa `0` como "desconhecido" em `content-length`; backends que não sabem o tamanho costumam devolver 0. Devolver 416 para eles mudaria um 200 que hoje funciona. A condição de ativação é `Number.isFinite(meta.size) && meta.size > 0`, a mesma ideia da linha 268. Também fica documentado que um arquivo vazio real recebe 200 com corpo vazio, o que é válido.

### D-05 — Validação de If-Range

**Alternativas.**
1. Ignorar `If-Range` (a issue não o cita). Viola o RF-06.
2. Comparar contra `meta.etag`/`mtimeDate`.
3. Comparar contra os cabeçalhos `etag` e `last-modified` efetivamente presentes em `event.res.headers` (escolhida).

**Escolha.** A opção 3. Os dois cabeçalhos são preenchidos em `src/utils/static.ts:234-241`, mas só quando o usuário não os definiu via `options.headers` (`:105-114`). O validador que vale é o que o cliente recebe, então a leitura vem do cabeçalho de resposta. Regras (RFC 9110 §13.1.5):

- sem `If-Range`, o Range segue normalmente;
- `If-Range` com aspas ou prefixo `W/` é um entity-tag. Usa comparação forte: só casa se o `etag` da resposta é igual byte a byte e nenhum dos dois é fraco. A verificação de fraco é `/^w\//i`, porque o fixture dos testes usa `w/123` em minúsculas (`test/static.test.ts:15`) e a regex do projeto só trata `W/` maiúsculo (`src/utils/internal/cache.ts:52`). Um ETag fraco nunca valida `If-Range`, e o resultado é 200;
- caso contrário é uma data HTTP. Casa só se `Date.parse(valor)` for finito e igual a `Date.parse(last-modified da resposta)`. A RFC pede igualdade exata, nunca "menor ou igual", diferente do `If-Modified-Since` de `isCacheMatch` (`src/utils/internal/cache.ts:46`);
- sem validador correspondente na resposta, ou valor que não casa: Range ignorado, 200 completo.

Não reutiliza `matchETag` (`cache.ts:11`): ele usa comparação fraca e aceita listas, o que é o oposto do que `If-Range` pede. `src/utils/internal/cache.ts` não é alterado (fora de escopo do PRD).

### D-06 — Como produzir o corpo recortado

**Contexto.** `getContents` devolve `BodyInit | null | undefined` (`src/utils/static.ts:33`) e não recebe intervalo. O custo de I/O da leitura inteira é o risco R1 do PRD e fica documentado, não resolvido.

**Alternativas.**
1. Converter tudo para `ArrayBuffer` e fatiar. Simples, mas carrega mídia grande na memória.
2. Fatiar por tipo, preservando o streaming quando o corpo já é stream (escolhida).

**Escolha.** Função privada `sliceBody(body, start, end)` que devolve `BodyInit`:

- `Blob`/`File`: `blob.slice(start, end + 1)` (sem cópia);
- `ArrayBuffer`/`ArrayBufferView`: `subarray`/`slice` sobre os bytes, respeitando `byteOffset`;
- `ReadableStream`: um `ReadableStream` novo que lê o original, descarta os primeiros `start` bytes, emite até `end - start + 1` bytes e então cancela o leitor original (`reader.cancel()`) para liberar o arquivo. Cancela também no `cancel` do stream resultante;
- `string`, `URLSearchParams`, `FormData` e demais: `await new Response(body).blob()` e depois `blob.slice(...)`. Isso vale para a string, que precisa ser fatiada em bytes UTF-8, não em caracteres, porque `size` é em bytes.

**Sobre divergência entre `size` e o corpo real.** Os testes atuais usam metas com `size` diferente do corpo (por exemplo `size: 10` com `"content for ..."`, `test/static.test.ts:529-532`, e `size: 18` com `"content"`, `:606`). Para corpos com tamanho conhecido (Blob, buffers e os convertidos em Blob) a função compara o `byteLength` real com `meta.size`. Se forem diferentes, o Range é ignorado e a resposta é 200 completa, como hoje. Isso evita um `Content-Length` que o corpo não cumpre. Em `ReadableStream` o tamanho real não é verificável; confia-se em `meta.size` e registra-se o risco (R-03).

Como a verificação precisa do corpo, ela ocorre depois de `getContents`, só no GET. No HEAD não há corpo e o `meta.size` basta (RF-03); `getContents` não é chamado, como hoje (`:272-274`). O 416 também é decidido só com `meta.size` e não chama `getContents`.

### D-07 — Precedência de cabeçalhos em 206 e 416

**Contexto.** O `HTTPResponse` devolvido passa por `prepareResponse`, que mescla os cabeçalhos de `event.res` por cima dos do `HTTPResponse` (`src/response.ts:201-204` e `mergeHeaders`, `:243-252`, que usa `set`). Por isso o `content-length` e o `content-range` têm de ser escritos em `event.res.headers`, como o código já faz com `content-length` (`src/utils/static.ts:269`). Cabeçalhos no `HTTPResponse` seriam sobrescritos.

**Alternativas.**
1. Manter a regra atual ("o do usuário vence"), inclusive em 206. Produz 206 com `Content-Length` inválido (R2).
2. Em 206 e 416, `content-length` e `content-range` são sempre escritos pelo `serveStatic`, sobrescrevendo o usuário (escolhida).

**Escolha.** A opção 2, via `headers.set`. Em 200 a regra de `src/utils/static.ts:268` permanece: `content-length` só é escrito se ainda não existe. Um `content-range` do usuário é removido em 200 (`delete`) para não vazar numa resposta completa, e fica coberto por teste. Os cabeçalhos `Accept-Ranges` só são escritos se ausentes, como `content-type`, para que o usuário possa publicar `accept-ranges: none`.

### D-08 — Cabeçalhos por tipo de resposta

| Resposta | Status | Cabeçalhos adicionados | Corpo |
| --- | --- | --- | --- |
| Asset encontrado sem Range efetivo | 200 | `Accept-Ranges: bytes` | completo |
| Range válido | 206 | `Accept-Ranges`, `Content-Range: bytes a-b/size`, `Content-Length: b-a+1` | trecho (vazio em HEAD) |
| Range insatisfazível | 416 | `Accept-Ranges`, `Content-Range: bytes */size`, `Content-Length: 0` | vazio |
| 304 | 304 | nenhum (P3) | vazio |
| 404 / 405 / fallthrough | como hoje | nenhum | como hoje |

`Accept-Ranges` é escrito logo depois do bloco do 304, então não aparece no 304 nem em respostas de erro. O 404 é lançado antes (`:210-215`) e o 405 antes de tudo (`:116-122`). Em 404/405 o `errHeaders` filtra os cabeçalhos de sucesso de qualquer forma (`src/response.ts:211-213`).

O 416 é devolvido como `HTTPResponse` (não `HTTPError`), pois o `HTTPResponse` mantém os cabeçalhos de `event.res`, e o `HTTPError` os descartaria. O `HTTPResponse` com `status: 416` passa por `prepareResponseBody` (`src/response.ts:304-306`), não pela rota `val instanceof Response`, que é a que filtra cabeçalhos em `status >= 400` (`:211`). Isso precisa ser confirmado por teste (R-04). No 416 remove-se só `content-encoding`, porque o corpo é vazio e anunciar uma codificação sem corpo confunde clientes; `content-type`, `etag` e `last-modified` ficam.

### D-09 — Interação com encoding e `Vary`

O recorte é feito sobre a variante já escolhida; `meta.size` é o da variante porque `getMeta` é chamado com o id da variante (`:201`). O `Vary` continua escrito antes (`:220-225`) e vale também para 206/416. O `content-encoding` vem de `meta.encoding` (`:264-266`) e não muda. Isso cumpre o RF-07 e o R4 (intervalo sobre a representação codificada, conforme RFC 9110 §14.2).

## 3. Arquivos a alterar

| Arquivo | Local atual | Alteração |
| --- | --- | --- |
| `src/utils/static.ts` | `:268-278` | Inserir o avaliador de Range entre o bloco de `content-length` e o `return` de HEAD; reescrever o fim da função para devolver 200/206/416 |
| `src/utils/static.ts` | `:340-351` | Adicionar, depois de `idSearchPaths`, os helpers `parseRange`, `resolveRange`, `ifRangeMatches` e `sliceBody` |
| `test/static.test.ts` | `:525-624` (último `describeMatrix`) e fim do arquivo | Novo `describeMatrix("serve static range", ...)`; ver §5 |

Não alterar: `src/index.ts:193` (exporta apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`; a lista permanece idêntica), `src/utils/internal/cache.ts`, `src/response.ts`.

Testes existentes: todos os que comparam cabeçalhos usam `toMatchObject` (`test/static.test.ts:53`, `:69`, `:450`, `:466`) ou `get(...)` de um cabeçalho (`:54`, `:70`, `:616`), então o `Accept-Ranges` extra não os quebra. A expectativa é nenhum ajuste; se algum for necessário, será mínimo e mantendo o que verifica (R-05). O teste de `:600-617` (`content-length: 999` do usuário em HEAD) continua verdadeiro porque não há `Range`.

## 4. Contratos e assinaturas

API pública inalterada:

```ts
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

Helpers privados, sem `export`, no fim de `src/utils/static.ts`:

```ts
interface ByteRange {
  start: number; // inclusivo
  end: number; // inclusivo, já limitado a size - 1
}

/** Interpreta o cabeçalho; `undefined` = malformado/multi-range/unidade desconhecida (ignorar). */
function parseRange(header: string): { first?: number; last?: number } | undefined;

/** Aplica o tamanho: `ByteRange` (206), `"unsatisfiable"` (416) ou `undefined` (ignorar). */
function resolveRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | undefined;

/** RFC 9110 §13.1.5: comparação forte de ETag ou igualdade exata de data. */
function ifRangeMatches(
  ifRange: string | null,
  validators: { etag: string | null; lastModified: string | null },
): boolean;

/** Fatia o corpo em bytes; `undefined` quando o tamanho real não bate com `size` (ignorar Range). */
function sliceBody(
  body: BodyInit,
  range: ByteRange,
  size: number,
): Promise<BodyInit | undefined>;
```

Semântica de `resolveRange` com `size > 0`:

| Entrada | Resultado |
| --- | --- |
| `bytes=0-99`, size 1000 | `{ start: 0, end: 99 }` |
| `bytes=900-5000`, size 1000 | `{ start: 900, end: 999 }` |
| `bytes=500-` | `{ start: 500, end: 999 }` |
| `bytes=-100` | `{ start: 900, end: 999 }` |
| `bytes=-5000` | `{ start: 0, end: 999 }` |
| `bytes=-0` | `"unsatisfiable"` |
| `bytes=1000-` e `bytes=1000-1010` | `"unsatisfiable"` |
| `bytes=5-2`, `bytes=0-1,5-6`, `itens=0-10`, `bytes=abc`, `bytes=-` | `undefined` |

Esboço do fluxo no ponto D-01 (pseudocódigo, não é código final):

```ts
if (!event.res.headers.has("accept-ranges")) event.res.headers.set("accept-ranges", "bytes");

const range =
  meta.size && meta.size > 0 && ifRangeMatchesOrAbsent(...)
    ? resolveRange(event.req.headers.get("range"), meta.size)
    : undefined;

if (range === "unsatisfiable") {
  // content-range: bytes */size, content-length: 0, delete content-encoding
  return new HTTPResponse(null, { status: 416 });
}
if (range && event.req.method === "HEAD") {
  // content-range: bytes a-b/size, content-length: b-a+1
  return new HTTPResponse(null, { status: 206 });
}
if (event.req.method === "HEAD") return new HTTPResponse(null, { status: 200 });

const contents = await options.getContents(id);
if (range && contents) {
  const body = await sliceBody(contents, range, meta.size);
  if (body) { /* mesmos cabeçalhos do 206 */ return new HTTPResponse(body, { status: 206 }); }
}
return new HTTPResponse(contents || null, { status: 200 });
```

No ramo 200 com `Range` ignorado, o `content-range` do usuário é removido (D-07).

Se `getContents` devolver `null`/`undefined` (asset sumiu entre `getMeta` e `getContents`) com Range pedido, a resposta segue como hoje: 200 com corpo vazio.

## 5. Estratégia de testes

Arquivo: `test/static.test.ts`, novo `describeMatrix("serve static range", (t, { it, expect }) => {...})`, que roda em `web` e `node`. O fixture usa um asset de 1000 bytes (`"0123456789"` repetido 100 vezes, ASCII, para que byte e caractere coincidam), `etag: '"v1"'`, `mtime` fixo e `getContents` como `vi.fn`.

| Requisito | Casos |
| --- | --- |
| RF-01 | GET e HEAD sem `Range`: 200 e `accept-ranges: bytes`. 404 e 405 sem `accept-ranges`. 304 sem `accept-ranges` |
| RF-02 | `bytes=0-99` (206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo exato); `bytes=900-` ; `bytes=-100`; `bytes=900-5000` (limitado); `bytes=-5000` (asset inteiro, 206 `0-999/1000`) |
| RF-03 | HEAD `bytes=0-99`: 206, cabeçalhos corretos, corpo vazio, `getContents` não chamado |
| RF-04 | `bytes=1000-`, `bytes=-0`: 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio, `getContents` não chamado; também em HEAD |
| RF-05 | `bytes=0-10,20-30`, `itens=0-10`, `bytes=abc`, `bytes=-`, `bytes=5-2`: 200, corpo completo, sem `content-range` |
| RF-06 | `If-Range: "v1"` → 206; `If-Range: "v0"` → 200; `If-Range` com ETag fraco (`W/"v1"`) → 200; data igual ao `last-modified` → 206; data diferente → 200; data inválida → 200 |
| RF-07 | `if-none-match` que casa + `Range` → 304; variante `.gz` com `accept-encoding: gzip` e `bytes=0-9` → corpo é o trecho de `.gz`, `content-encoding: gzip`, `content-length: 10`, `vary` presente; `fallthrough: true` com asset ausente e `Range` → `undefined` (cai no próximo handler); 405 com `Range` continua 405 |
| RF-08 | Teste de unidade que compara `Object.keys(await import("../src/index.ts"))` com a lista esperada (snapshot dos nomes de valor de `serveStatic`), para garantir que o recorte não adiciona exportação. Os tipos são conferidos por `pnpm typecheck` e por revisão do diff de `src/index.ts` |
| D-04 | `size` ausente e `size: 0` com `Range`: 200 completo e sem `content-range` |
| D-06 | Corpos `Blob`, `Uint8Array`, `ReadableStream` (com chunks que cruzam `start` e `end`) e string com caracteres multibyte (a string de UTF-8 é fatiada em bytes); `size` divergente do corpo real em buffer: 200 completo; cancelamento do stream de origem verificado com um `cancel` espiado |
| D-07 | `headers: { "content-length": "999", "content-range": "x" }` do usuário com `Range` válido: 206 usa o `content-length` calculado; sem `Range`, o `content-length` do usuário continua valendo (como em `:600-617`) e o `content-range` do usuário não aparece |
| R5 | Os testes de traversal já existentes (`:256-393`) seguem passando. Um teste novo confirma que `getMeta`/`getContents` recebem o mesmo `id` com e sem `Range` |

Comandos de verificação (RF-09): `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck`, e por fim `pnpm vitest run` para a suíte completa (em web e node). Os testes novos seguem a regra do `AGENTS.md` de reproduzir o comportamento antes: os casos de 206/416/If-Range devem falhar antes da implementação.

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Mídia grande: `getContents` não recebe intervalo, então o arquivo é aberto desde o início e o `start` é descartado lendo o stream. Seek perto do fim continua custando I/O | Documentado no JSDoc de `serveStatic`; stream é cancelado ao atingir `end`; mudança de API fica para discussão separada (fora de escopo) |
| R-02 | Backends com `size: 0` para "desconhecido" ganhariam 416 com o literal da RFC | D-04: `size` 0 ignora o Range. Fica registrado que arquivo vazio real recebe 200 |
| R-03 | `meta.size` divergente do corpo em `ReadableStream`: o 206 sairia com `Content-Length` maior que os bytes, e o servidor derruba a conexão | Verificação de `byteLength` nos tipos conhecidos (D-06); para stream, o contrato de `StaticAssetMeta.size` já exige tamanho correto (o `content-length` do 200 já depende disso, `:268-270`) |
| R-04 | Um `HTTPResponse` 416 poder perder ou manter cabeçalhos de forma diferente do esperado, por causa do filtro de `status >= 400` em `src/response.ts:211` | Esse filtro só atua na rota `val instanceof Response`; o `HTTPResponse` passa por `prepareResponseBody`. Teste explícito de cabeçalhos do 416 nos dois runtimes; se o runtime Node recusar `content-length: 0` com corpo nulo, fixar o corpo como `""` |
| R-05 | Quebra de testes existentes por `Accept-Ranges` | Análise do §3: asserções existentes usam `toMatchObject` ou cabeçalhos individuais. Ajustar só o que quebrar |
| R-06 | `If-Range` com ETag fraco `w/` minúsculo (fixture) e `W/`, e o `etag` do usuário em `options.headers` | D-05: comparação forte, case-insensitive para o prefixo; validador lido do cabeçalho de resposta |
| R-07 | `static.ts` passa de ~350 para ~500 linhas, acima da meta de 200 do `AGENTS.md` | Desvio consciente, imposto pelo pedido ("helpers privados no módulo"). Se a equipe preferir, mover os helpers para `src/utils/internal/` não muda a API pública |
| R-08 | A issue cita a RFC 7233, e o `If-Range` não é citado nela | Segue-se a RFC 9110 como pede o contrato; a decisão D-05 está isolada em `ifRangeMatches` e é fácil de ajustar |
| R-09 | Ranges em respostas já comprimidas por proxies/CDN a jusante | Fora de escopo; o `Vary: accept-encoding` continua sendo enviado |
| R-10 | Ordem de avaliação: `If-Match`/`If-Unmodified-Since` (412) não existem hoje em `serveStatic` | Fora de escopo; nenhuma mudança de comportamento |

## 7. Plano de implementação (ordem)

1. Escrever os testes de RF-01 a RF-07, D-04, D-06 e D-07 e confirmar que falham.
2. Implementar `parseRange`, `resolveRange`, `ifRangeMatches` e `sliceBody` em `src/utils/static.ts`.
3. Integrar no fluxo conforme D-01 e D-07/D-08.
4. Rodar `pnpm vitest run test/static.test.ts`, `pnpm lint`, `pnpm typecheck` e a suíte completa.
5. Conferir que `git diff src/index.ts` está vazio.
