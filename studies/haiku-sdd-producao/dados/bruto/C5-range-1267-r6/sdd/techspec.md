# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-14). Este documento não altera código; ele fixa as decisões para a implementação.

## Estado atual (verificado no código)

- `serveStatic` fica em `src/utils/static.ts:101`. Ele ignora `Range` por completo: o único caminho de sucesso termina em `new HTTPResponse(contents || null, { status: 200 })` (`src/utils/static.ts:276-277`).
- `content-length` só é definido quando `meta.size > 0` e o cabeçalho ainda não existe (`src/utils/static.ts:268-270`). Isso impede sobrescrever um `content-length` vindo de `options.headers`, o que a mudança precisa fazer em 206 e 416 (ver D-06).
- A resposta HEAD é montada em `src/utils/static.ts:272-274`, antes de `getContents` ser chamado.
- A validação condicional existente fica em `src/utils/static.ts:243-248` (304), antes de content-type, encoding e content-length. RF-09 depende dessa ordem.
- `matchETag` e `isCacheMatch` estão em `src/utils/internal/cache.ts:11` e `src/utils/internal/cache.ts:29`. O prefixo de ETag fraco é detectado por `opaqueTag` com `startsWith("W/")` (`src/utils/internal/cache.ts:51-53`).
- `HTTPResponse` é a classe de resposta usada pelo módulo (`src/response.ts:96-124`). Para valores que não são `Response`, `toResponse` usa o status de `HTTPResponse` (`src/response.ts:195-196`) e mescla `event.res.headers` por cima dos headers da resposta (`src/response.ts:201-204` e `src/response.ts:243-250`). Portanto, cabeçalhos definidos em `event.res.headers` vencem os de `HTTPResponse` nos caminhos 200, 206 e 416.
- `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. `test/unit/package.test.ts:133` mantém a lista de exports públicos, que serve de guarda para RF-13.
- Os testes estão em `test/static.test.ts`. O bloco `describeMatrix("serve static", ...)` começa em `test/static.test.ts:5`. `describeMatrix` é definido em `test/_setup.ts:11`.
- `package.json:46` define `lint` (`oxlint . && oxfmt --check .`). `package.json:54` define `typecheck` (`tsc --noEmit`). `package.json:53` define `test`, que roda lint + typecheck + coverage. Observação: o AGENTS.md diz que `pnpm lint` inclui typecheck, mas o `package.json` não faz isso. Use `pnpm typecheck` separadamente.
- `node_modules` não está instalado no clone (a busca por `node_modules/vitest/package.json` não encontrou nada). Antes de testar, é preciso `corepack enable && pnpm install`.

## Decisões de arquitetura

### D-01 — Lógica de Range no próprio `src/utils/static.ts`

**Alternativas**
- (a) Colocar os helpers em `src/utils/internal/range.ts`, seguindo a convenção do AGENTS.md para helpers internos.
- (b) Colocar tudo em `src/utils/static.ts`, como exige o contrato.

**Escolha: (b).** O `pedido.md` e o RF-13 do PRD dizem explicitamente que a lógica fica "dentro de `src/utils/static.ts`" e que nenhum helper vira módulo novo. A escolha não cria exportação pública, porque os helpers são funções não exportadas.

**Consequência.** O arquivo passa de 352 para cerca de 450 linhas, acima da meta de "< 200 LoC" do AGENTS.md (que já é ultrapassada hoje). Se o time preferir (a), a troca é mecânica e não afeta a API. Esse ponto fica registrado como decisão a confirmar.

### D-02 — Parser de Range restrito a um único intervalo `bytes`

**Alternativas**
- (a) Parser completo da RFC 9110 §14.1 com lista de intervalos e resposta `multipart/byteranges`.
- (b) Parser de um único intervalo. Qualquer outra forma é ignorada, e o asset completo é servido.

**Escolha: (b).** Multi-range e `multipart/byteranges` estão fora de escopo (PRD, "Fora de escopo"). A RFC permite ignorar um `Range` que o servidor não suporta (RFC 9110 §14.2). RF-05 pede exatamente isso.

**Regras do parser** (aplicadas a `Range` depois de `trim`):
- A unidade deve ser `bytes`, sem diferenciar maiúsculas (`/^bytes\s*=/i`).
- Forma aceita: `a-b`, `a-` ou `-n`, com dígitos decimais. `a-` e `-n` são formas válidas. `-` sozinho e `a-b` com `a > b` são malformados.
- Vírgula (multi-range), unidade diferente e qualquer malformação devolvem `undefined`, que significa "ignorar Range" (200).
- `b` maior que `size - 1` é limitado a `size - 1` (RF-04).
- `-n` com `n > size` vira `0-(size-1)` (RF-03). `-0` é insatisfazível (RFC 9110 §14.1.1).
- Início `a >= size` é insatisfazível, e isso inclui todo intervalo quando `size === 0` (RF-06).

### D-03 — Ordem de avaliação: 304 → If-Range → Range → cabeçalhos

**Escolha.** O Range é avaliado depois de todas as validações atuais, em um bloco novo logo antes do `if (event.req.method === "HEAD")` (`src/utils/static.ts:272`). A ordem fica:

1. Método, canonicalidade, lookup e 404/fallthrough (inalterados).
2. ETag, Last-Modified, `isCacheMatch` → 304 (`src/utils/static.ts:243-248`, inalterado). Isso garante RF-09.
3. Content-type, content-encoding e content-length, como hoje (`src/utils/static.ts:250-270`).
4. Range: primeiro `If-Range` (RFC 9110 §13.1.5), depois a interpretação do `Range`. Se `If-Range` não bater, o `Range` é ignorado inteiro, inclusive para intervalos insatisfazíveis.
5. HEAD e GET com a resposta correspondente.

**Motivo.** Colocar o Range antes do 304 quebraria RF-09. Colocar o `If-Range` depois do parse faria um `If-Range` não batendo produzir 416, o que a RFC proíbe.

### D-04 — `Accept-Ranges` só em 200, 206, 416 e HEAD (não em 304)

**Escolha.** `accept-ranges: bytes` é definido com `if (!event.res.headers.has("accept-ranges"))`, no mesmo padrão de `etag` (`src/utils/static.ts:239`). Ele é definido depois do 304, então respostas 304 não recebem o cabeçalho.

**Motivo.** O PRD (RF-01) lista 200, 206, 416 e HEAD. RF-09 e RF-11 pedem que a resposta 304 continue igual à de hoje. A RFC 9110 §15.4.5 não exige `Accept-Ranges` em 304.

### D-05 — Fatiamento do corpo sem mudar a assinatura de `getContents`

É o ponto de maior risco (PRD, "Riscos"). `getContents` devolve `BodyInit`, então o fatiamento depende do tipo.

**Alternativas**
- (a) Materializar tudo: `await new Response(contents).arrayBuffer()` e cortar com `subarray`. Simples, mas carrega o arquivo inteiro na memória. Inaceitável para vídeo.
- (b) Exigir nova opção (`slice`) em `ServeStaticOptions`. Proibido pelo PRD (RF-13, "Fora de escopo").
- (c) Fatiar por tipo, sem materializar, com `sliceBody` síncrono:
  - `string`: codificar em UTF-8 (`TextEncoder`) e cortar os bytes, porque `size` é em bytes e não em caracteres.
  - `Blob` (inclui `File`): `blob.slice(start, end + 1)`, que é lazy.
  - `ArrayBuffer` e `ArrayBufferView`: `Uint8Array` sobre a janela e `subarray`.
  - `ReadableStream`: `sliceStream`, que descarta `start` bytes e emite `length` bytes, sem reter o arquivo inteiro.
  - `FormData`, `URLSearchParams` e demais: `new Response(body).body` e depois o caminho de stream. Esses tipos não têm um tamanho confiável em bytes, então isso é um melhor esforço.

**Escolha: (c).** Mantém a API e evita carregar o arquivo inteiro para os casos que importam (Blob de arquivo e stream).

**Custo conhecido.** Para `ReadableStream`, o início do intervalo é lido e descartado. Para um vídeo grande, pedir o final do arquivo custa uma leitura quase completa. Otimizar isso exige um `getContents` que aceite offset, o que está fora de escopo.

### D-06 — Em 206 e 416, `content-length` e `content-range` sobrescrevem os valores existentes

**Escolha.** Para 206 e 416, `content-length` e `content-range` são definidos com `set`, não com a regra "só se ausente" de `src/utils/static.ts:268`. Isso vale também quando `options.headers` ou `event.res.headers` já trouxeram um `content-length`.

**Motivo.** O tamanho da representação enviada muda em 206 e 416. Sem a sobrescrita, o cliente recebe um `Content-Length` que não bate com o corpo. O teste existente em `test/static.test.ts:600-617` cobre só o caminho sem Range e continua válido.

**Consequência.** Como `event.res.headers` vence os headers de `HTTPResponse` (`src/response.ts:201-204`), `set` em `event.res.headers` é suficiente. Não é preciso passar `headers` no `HTTPResponse`.

### D-07 — `getContents` nulo ou indefinido: Range ignorado

**Escolha.** Para GET com intervalo satisfazível, `getContents` é chamado antes de os cabeçalhos de intervalo serem definidos. Se ele devolver `null` ou `undefined`, o `Range` é ignorado e a resposta segue o caminho 200 de hoje.

**Motivo.** Um 206 sem corpo teria `Content-Length` maior que zero e corpo vazio, o que é inconsistente. Para 416, `getContents` não é chamado, porque a resposta não tem corpo.

**Ordem interna**: calcular o intervalo (com `If-Range`) → se insatisfazível, 416 sem `getContents` → se GET e satisfazível, chamar `getContents` uma única vez e, se nulo, cair no 200 → senão, 206.

### D-08 — `If-Range` estritamente forte e por data exata

**Escolha.**
- Se o cabeçalho `If-Range` não existir, o `Range` é avaliado normalmente.
- Se começar com `"` ou `W/`, é um entity-tag. Só bate se `meta.etag` existir, não começar com `W/` e for igual ao valor (comparação forte). Isso segue `src/utils/internal/cache.ts:51-53` para detectar o prefixo fraco, mas aqui a comparação é forte, sem ignorar `W/`.
- Caso contrário, é uma data. Só bate se `mtimeDate` existir e `new Date(valor).getTime() === mtimeDate.getTime()`. `mtimeDate` já está truncado em segundos (`src/utils/static.ts:230-232`), e o cliente ecoa essa data truncada.
- Se o asset não tem validador (sem etag e sem mtime), `If-Range` não bate e o `Range` é ignorado.

**Atenção a um fixture.** Os testes usam `etag: "w/123"` em minúsculas (`test/static.test.ts:15`). Pela regra de `W/` em maiúsculas, esse valor é tratado como forte, o mesmo que `isCacheMatch` faz. Não é uma etag válida pela gramática, então os testes novos devem usar `"v1"` (forte) e `W/"v1"` (fraca), como o PRD pede.

### D-09 — Tamanho inválido é tratado como desconhecido

**Escolha.** `meta.size` que não seja inteiro seguro e não negativo (`Number.isSafeInteger(size) && size >= 0`) faz o `Range` ser ignorado (RF-10). Zero é tamanho válido e conhecido.

**Motivo.** Um `NaN` ou negativo nunca produz um `Content-Range` coerente.

## Contratos e assinaturas (privados em `src/utils/static.ts`)

Nenhum destes nomes é exportado. `src/index.ts` e `ServeStaticOptions` não mudam (RF-13).

```ts
/** Intervalo inclusivo em bytes, já limitado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/** `undefined` ignora o Range; "unsatisfiable" devolve 416; um intervalo devolve 206. */
type RangeDecision = ByteRange | "unsatisfiable" | undefined;

/** Interpreta o cabeçalho Range (D-02). `size` já validado (D-09). */
function parseByteRange(value: string, size: number): RangeDecision;

/** Avalia If-Range contra o estado atual do asset (D-08). Sem If-Range, retorna true. */
function matchesIfRange(
  ifRange: string | null,
  validators: { etag?: string; mtime?: Date },
): boolean;

/** Fatia um BodyInit em bytes sem materializá-lo quando o tipo permite (D-05). */
function sliceBody(body: BodyInit, range: ByteRange): BodyInit;

/** Descarta `start` bytes e emite `end - start + 1` bytes de um stream. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: ByteRange,
): ReadableStream<Uint8Array>;
```

Formato dos cabeçalhos emitidos:

| Caso | Status | `content-range` | `content-length` | Corpo |
| --- | --- | --- | --- | --- |
| Sem Range, ou ignorado | 200 | (ausente) | como hoje | completo |
| Válido `a-b` | 206 | `bytes a-b/size` | `b - a + 1` | `sliceBody` (GET) ou nenhum (HEAD) |
| Insatisfazível | 416 | `bytes */size` | `0` | nenhum |

`statusText` fica como `"Partial Content"` e `"Range Not Satisfiable"`. Todas as respostas 206 e 416 passam por `new HTTPResponse(...)` (`src/utils/static.ts:7`), como já acontece com 304 e 200.

Mudança esperada em `serveStatic`, em forma de esboço (não é o código final):

```ts
// src/utils/static.ts, depois de content-length (linha 270) e antes de HEAD (linha 272)
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}
const range = resolveRange(event.req.headers, meta, mtimeDate); // D-03 passo 4
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
// ... caminho 206 segundo D-07, com event.res.headers.set de content-range e content-length
```

`resolveRange` é um nome provisório para a função que junta `If-Range` (`matchesIfRange`) e `parseByteRange`, retornando a `RangeDecision`.

## Estratégia de testes

Os testes ficam em `test/static.test.ts`, num novo bloco `describeMatrix("serve static range", ...)`, adicionado depois da linha 678. Todos rodam em `web` e `node` (`test/_setup.ts:11`). Não é preciso mudar testes existentes: nenhum deles envia `Range`, e as asserções existentes usam `toMatchObject` ou checam campos específicos, então o novo `accept-ranges` não quebra nada. Se a execução mostrar o contrário, ajustar só o teste afetado.

Fixture: asset de 1000 bytes, com conteúdo determinístico (ex.: `Uint8Array` com `i % 256`), para verificar o intervalo byte a byte e não só o tamanho.

| Teste | RF |
| --- | --- |
| `accept-ranges: bytes` em 200 e HEAD sem Range; ausente em 304 | RF-01, D-04 |
| `bytes=100-199` → 206, `content-range`, `content-length`, bytes 100 a 199 | RF-02 |
| `bytes=-100` → bytes 900 a 999; `bytes=-5000` → 0 a 999 | RF-03 |
| `bytes=900-5000` → limitado a 900-999 | RF-04 |
| `abc`, `items=0-5`, `500-100`, `0-10,20-30` → 200 sem `content-range` | RF-05 |
| `bytes=1000-1100` → 416, `bytes */1000`, `content-length: 0`, corpo vazio | RF-06 |
| `bytes=-0` → 416 | D-02 |
| Asset de tamanho 0 com `bytes=0-` → 416 `bytes */0` | RF-06 |
| HEAD com `bytes=100-199` → 206 sem corpo | RF-07 |
| `If-Range: "v1"` → 206; `"v0"` → 200; `W/"v1"` → 200; data exata → 206; data diferente → 200 | RF-08 |
| `If-Range` sem validador no asset → 200 | D-08 |
| `Range` + `If-None-Match: "v1"` → 304 sem 206 | RF-09 |
| `getMeta` sem `size` → 200 sem `content-range` | RF-10 |
| `size` `NaN` ou negativo → 200 | D-09 |
| Mesma matriz de fatiamento com `string`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` e `FormData` (este último só checa status e cabeçalhos) | D-05 |
| `ReadableStream` cancelado no meio não vaza (o `reader` é cancelado) | D-05, risco |
| `encodings: { gzip: ".gz" }`, `app.js.gz` de 400 bytes, `accept-encoding: gzip`, `Range: bytes=0-99` → 206, `content-encoding: gzip`, `content-range: bytes 0-99/400`, `vary` com `accept-encoding` | RF-12 |
| `options.headers` com `content-length: 999` e Range → 206 com `content-length` correto | D-06 |
| `Range` em asset inexistente → 404 (inalterado); em POST → 405 (inalterado) | RF-11 |
| `fallthrough` com Range em asset inexistente → próximo handler | RF-11 |

RF-13: `test/unit/package.test.ts:133` continua passando sem alteração, porque nenhum export novo é criado. Esse é o teste de guarda.

Comandos de verificação:
```bash
corepack enable && pnpm install
pnpm vitest run test/static.test.ts
pnpm vitest run test/security.test.ts test/unit/package.test.ts
pnpm lint
pnpm typecheck
pnpm vitest run          # suíte completa
```

Ordem de trabalho, conforme o fluxo de bug/feature do AGENTS.md: escrever os testes novos primeiro e confirmar que falham antes da implementação.

## Documentação

`docs/2.utils/2.response.md:39` tem a seção de `serveStatic`. Recomenda-se uma linha dizendo que o `serveStatic` atende `Range` (206/416) e `If-Range`, sem mudança de API. Isso é opcional e pode ficar fora do PR.

## Riscos

1. **Fatiamento de `ReadableStream` (alto).** Pedir o final de um arquivo grande lê e descarta quase tudo antes. Mitigação: documentar o custo (D-05). A correção de verdade exige um `getContents` com offset, o que está fora de escopo.
2. **Divergência entre `size` e o corpo (médio).** Se `getMeta.size` não bater com o que `getContents` devolve, `Content-Range` e `Content-Length` ficam incorretos sem que o `serveStatic` perceba. Mitigação: é uma premissa documentada no PRD; não há como verificar sem ler o corpo inteiro.
3. **Regressão em 304 (médio).** A ordem de D-03 protege o 304. Os testes de RF-09 e o de `accept-ranges` ausente em 304 cobrem isso.
4. **`If-Range` com ETag fraco (médio).** Uma comparação fraca devolveria 206 indevido. D-08 usa comparação forte, com teste para `W/"v1"`.
5. **Stream não cancelado (médio).** Se o stream não for cancelado depois de emitir o último byte, o arquivo pode ficar aberto. `sliceStream` deve cancelar o `reader` ao fechar.
6. **Números muito grandes (baixo).** Dígitos acima de `Number.MAX_SAFE_INTEGER` perdem precisão. Como o limite é `size - 1`, o resultado continua sendo a última posição válida, então o efeito é aceitável. Ainda assim, o teste deve incluir um `bytes=0-99999999999999999999`.
7. **Tamanho do arquivo (baixo, mas real).** `src/utils/static.ts` passa de 200 LoC, contra a meta do AGENTS.md. Isso é consequência de D-01 e fica registrado para decisão do usuário.
8. **Lint e formatação (baixo).** `oxlint` com o plugin `unicorn` pode reclamar de padrões como `Number.isNaN` e regex. Não há como confirmar sem instalar dependências. A verificação precisa rodar `pnpm lint` depois da implementação.
9. **Ambiguidade de `lint`/`typecheck` (baixo).** O AGENTS.md diz que `pnpm lint` faz typecheck, mas `package.json:46` não faz. Os critérios de aceite do PRD pedem os dois, então ambos devem ser executados separadamente.
10. **Verificação não executada.** Esta especificação foi escrita só lendo o código. `node_modules` não está instalado, então nenhum teste foi rodado.
