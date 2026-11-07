# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-14).
Norma: RFC 9110, §13.1.5 (`If-Range`) e §14 (Range Requests). A RFC 7233 citada na issue está substituída pela 9110.

## Resumo

`serveStatic` passa a responder `206`, `416` e `Accept-Ranges: bytes` para um único intervalo de bytes em `GET` e `HEAD`. A mudança fica em `src/utils/static.ts`, com helpers privados e sem alterar a API pública. O corpo é fatiado depois de devolvido por `getContents`, sem mudar a assinatura do callback.

## Decisões de arquitetura

### D-01 — Escopo e local do código

**Escolha:** toda a lógica nova fica em `src/utils/static.ts`, em funções não exportadas no fim do arquivo, sob o cabeçalho `// --- Internal Utils ---` que já existe em `src/utils/static.ts:280`. `src/index.ts` não muda (`src/index.ts:193` continua exportando só `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`).

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts` com o parse de `Range` e `If-Range`. É o caminho que o `AGENTS.md` sugere para helpers internos e mantém o arquivo menor.
- Manter tudo em `static.ts`, como pede o RF-12 e a restrição "Keep all helper logic private within the serveStatic module" do `sdd/pedido.md`.

**Justificativa:** o requisito é explícito, então fica em `static.ts`. Isso deixa o arquivo com cerca de 450 linhas, acima da meta de "< 200 LoC" do `AGENTS.md`. O arquivo já tem 352 linhas. A divisão em módulo interno fica registrada como ação de acompanhamento (ver Riscos).

### D-02 — Ponto de inserção no fluxo

**Escolha:** a lógica de `Range` entra depois da checagem de pré-condições (`304`) e depois da montagem de `content-length`, antes do retorno de `HEAD`. Em termos das linhas atuais:

- `src/utils/static.ts:243-248`: checagem `304`. Permanece antes de `Range`, o que atende RF-07.
- `src/utils/static.ts:268-270`: `content-length` do asset completo. Permanece para o caminho `200`.
- `src/utils/static.ts:272-274`: retorno de `HEAD`. A lógica de `Range` entra antes dele, para que `HEAD` com faixa também passe por ela.
- `src/utils/static.ts:276-277`: `getContents` e retorno `200`. Ganha um desvio para `206` e `416` antes desta linha.

**Alternativas consideradas:**
- Avaliar `Range` antes de `304`: viola RF-07.
- Avaliar `Range` antes de `content-type`, `etag` e `last-modified`: exigiria duplicar esses cabeçalhos nos ramos `206` e `416`.

**Justificativa:** com a inserção nesse ponto, `Content-Type`, `ETag`, `Last-Modified`, `Vary` e `Content-Encoding` continuam sendo calculados uma única vez (RF-08). `404`, `405` e a validação canônica (`src/utils/static.ts:116-147`) não são tocados.

### D-03 — Gramática de `Range` e precedência das regras

**Escolha:** `parseRange` aceita apenas uma faixa, na unidade `bytes` (sem diferenciar maiúsculas na unidade), com a forma `first-last`, `first-` ou `-suffix`. A ordem de decisão é:

1. Qualquer vírgula no valor, ou sintaxe que não case com `^bytes=(\d*)-(\d*)$`: **ignora** (200 completo).
2. `first` e `last` vazios: **ignora**.
3. `last < first`: **ignora**, mesmo que `first >= size`. RF-05 exige 200 nesse caso, e não 416.
4. Sufixo `-0`: **416**.
5. `first >= size`: **416**.
6. `last` ausente ou maior que `size - 1`: limita a `size - 1`.
7. Sufixo `-n` com `n > size`: faixa é o arquivo inteiro.

**Alternativas consideradas:**
- Aceitar espaços em torno de `-` (`bytes=0 - 5`): a RFC 9110 não permite. Rejeitado.
- Responder 416 para `last < first`: contraria RF-05 e a RFC, que trata a faixa como sintaticamente inválida.

**Justificativa:** a regex estrita reproduz exatamente os casos de RF-02, RF-04 e RF-05.

### D-04 — Validação de `If-Range`

**Escolha:** `If-Range` só é aplicado quando:

- o valor for uma ETag forte idêntica a `meta.etag`, que também não pode ser fraca (`W/`); **ou**
- o valor, interpretado como data, for igual ao `mtimeDate` (já truncado em segundos, `src/utils/static.ts:227-232`).

Qualquer outro caso ignora `Range` e responde 200 completo.

**Alternativas consideradas:**
- Comparação fraca de ETag: a RFC 9110 §13.1.5 exige comparação forte. Rejeitado.
- Separar a classificação etag/data pelo primeiro caractere (`"` ou `W/`): frágil diante de fixtures sem aspas, como `"w/123"` em `test/static.test.ts:15`. Uma comparação por igualdade é mais tolerante e não abre brecha, porque uma data nunca é igual a uma ETag quotada.

**Justificativa:** RF-06 pede exatamente isso. A única coisa que muda em relação ao PRD é que a comparação é feita por igualdade, sem classificação prévia.

### D-05 — Cabeçalhos por status

**Escolha:** a regra vem de `src/response.ts:211-213`, que descarta `event.res.headers` em respostas 4xx e 5xx, e de `src/response.ts:218-229`, que faz os cabeçalhos de `event.res` sobrescreverem os do `HTTPResponse` em respostas 2xx. Por isso:

- **`206`**: `Content-Range` e `Content-Length` vão em `event.res.headers`, com `set`. Assim sobrescrevem o `content-length` definido pelo usuário em `options.headers` (`src/utils/static.ts:105-114`). Isso cumpre a premissa do PRD e não afeta o teste de `test/static.test.ts:600-617`, que cobre o `200`.
- **`416`**: os cabeçalhos vão direto no `HTTPResponse` devolvido, porque `event.res` é descartado. São eles `Accept-Ranges`, `Content-Range: bytes */<size>`, `Content-Length: 0` e `Vary`, este último copiado de `event.res.headers.get("vary")`. O `Vary` é necessário porque o tamanho da variante depende de `accept-encoding`, então um `416` sem `Vary` poderia ser reaproveitado por cache para um cliente com outro encoding.

**Alternativas consideradas:**
- Staging do `416` via `errHeaders`: depende de um símbolo interno de `response.ts` e não tem vantagem para este caso.
- Não enviar `Vary` no `416`: rejeitado pelo risco de cache descrito acima.

**Justificativa:** o `416` fica com o conjunto mínimo de cabeçalhos. Isso significa que `cache-control` e outros cabeçalhos do usuário não aparecem no `416`, comportamento que já é o de qualquer erro 4xx neste módulo.

### D-06 — Fatiamento do corpo sem alterar `getContents`

**Escolha:** o corpo devolvido por `getContents` é fatiado em `sliceBody`, sem mudar `ServeStaticOptions.getContents`:

- Se o corpo for `Blob` (inclui `File`), usa `blob.slice(start, end + 1)`, que é preguiçoso e não lê o arquivo inteiro.
- Para os demais `BodyInit` (`string`, `ArrayBuffer`, `ArrayBufferView`, `ReadableStream`), usa `new Response(contents).body` e encadeia um `TransformStream` que descarta bytes antes de `start` e encerra após `end`. Isso reproduz o fluxo como stream, sem buffer do arquivo inteiro.

Quando o `TransformStream` chama `controller.terminate()`, o `pipeThrough` cancela a fonte. Esse comportamento precisa ser confirmado por teste (ver Estratégia de testes).

**Alternativas consideradas:**
- Ler tudo com `arrayBuffer()` e cortar: custo de memória proporcional ao arquivo. Rejeitado.
- Segundo argumento opcional em `getContents` com a faixa: o PRD registra como melhoria futura, porque mexe na assinatura do callback. Rejeitado para esta entrega.

**Justificativa:** atende RF-11 com o mesmo contrato público. Cobre o caso `Blob` com custo baixo, que é o mais comum em backends de arquivo.

### D-07 — `Accept-Ranges` só quando o tamanho é conhecido

**Escolha:** `Accept-Ranges: bytes` é definido em `event.res.headers` dentro do bloco que já trata `size` (`src/utils/static.ts:268-270`), somente se `meta.size > 0`. Sem tamanho, nem o cabeçalho nem `Range` são aplicados (RF-09).

**Justificativa:** RF-01 pede `Accept-Ranges` em toda resposta de asset encontrado, mas RF-09 pede que ele não apareça quando o tamanho é desconhecido. As duas regras só são compatíveis se o cabeçalho depender do tamanho. Esta escolha segue RF-09, que é a regra mais específica.

### D-08 — Não alterar `h3/rules/cache`

**Escolha:** nenhuma mudança em `src/rules/cache.ts`. A função `isBypassedRequest` (`src/rules/cache.ts:146-149`) já ignora requisições com `range`, então o cache de regras nunca armazena um `206` como se fosse o recurso inteiro.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/static.ts` | Lógica de `Range` (D-02 a D-07). Helpers privados em `src/utils/static.ts:280` em diante. `ServeStaticOptions` e `StaticAssetMeta` (`src/utils/static.ts:9-66`) não mudam. |
| `test/static.test.ts` | Novo bloco `describeMatrix` para os cenários de RF-01 a RF-11. Os blocos existentes não mudam (ver Estratégia de testes). |

Não alterar: `src/index.ts:193`, `src/response.ts`, `src/rules/cache.ts`, `src/utils/internal/cache.ts`, `src/_entries/*`.

## Contratos e assinaturas

Contratos públicos, sem mudança:

```ts
// src/utils/static.ts
export interface StaticAssetMeta { type?; etag?; mtime?; size?; encoding? }  // src/utils/static.ts:9-15
export interface ServeStaticOptions { getMeta; getContents; headers?; encodings?; indexNames?; fallthrough?; getType? } // src/utils/static.ts:17-66
export async function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>; // src/utils/static.ts:101-104
```

Helpers privados (não exportados), em `src/utils/static.ts`:

```ts
interface ByteRange { start: number; end: number } // inclusivo

type RangeResult =
  | { kind: "ignore" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; start: number; end: number };

// Lê `Range` e `If-Range` de `headers`. Não é chamada quando `size` é 0 ou ausente.
function resolveRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; lastModified?: Date },
): RangeResult;

// Só o valor de `Range`. Retorna `ignore` para multi-faixa, unidade diferente e sintaxe inválida.
function parseRange(value: string, size: number): RangeResult;

// Igualdade forte de ETag ou igualdade de data com Last-Modified (D-04).
function ifRangeMatches(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

// Fatia `contents` para a faixa, sem buffer do arquivo inteiro para `Blob` (D-06).
function sliceBody(contents: BodyInit, range: ByteRange): BodyInit;
```

Esboço do fluxo, a ser inserido depois de `src/utils/static.ts:270`. É um esboço para orientar a implementação, não o código final:

```ts
if (size > 0) {
  event.res.headers.set("accept-ranges", "bytes");
}

const range = size > 0 ? resolveRange(event.req.headers, size, { etag: meta.etag, lastModified: mtimeDate }) : undefined;

if (range?.kind === "unsatisfiable") {
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-range": `bytes */${size}`,
    "content-length": "0",
  });
  const vary = event.res.headers.get("vary");
  if (vary) headers.set("vary", vary);
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable", headers });
}

if (range?.kind === "partial") {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 206, statusText: "Partial Content" });
  }
  const contents = await options.getContents(id);
  return new HTTPResponse(contents ? sliceBody(contents, range) : null, {
    status: 206,
    statusText: "Partial Content",
  });
}
```

Regra de `parseRange` para `last < first` (D-03, item 3), em ordem:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/i;
// "ignore" para vírgula, regex sem casamento, first e last vazios, last < first.
// Sufixo: -0 é "unsatisfiable"; -n com n > size vira 0..size-1.
// first >= size é "unsatisfiable"; last ausente ou > size-1 é limitado a size-1.
```

## Estratégia de testes

**Fluxo:** seguir o "Bug Fix Workflow" do `AGENTS.md`, aplicado a cada cenário: escrever primeiro o teste, confirmar que ele falha no estado atual e só então implementar.

**Onde:** `test/static.test.ts`, em um novo `describeMatrix("serve static range", ...)`. O bloco novo registra suas próprias rotas (`t.app.all(...)`) em vez de reutilizar o `beforeEach` de `test/static.test.ts:6-31`, porque os fixtures de tamanho e ETag ali não atendem todos os cenários.

**Fixtures:** usar ETags quotadas e válidas (`"abc"`, `W/"abc"`) em todos os testes novos. O fixture `"w/123"` de `test/static.test.ts:15` é minúsculo e não é uma ETag fraca pela RFC 9110. Ele fica nos testes existentes sem mudança.

**Cobertura por requisito:**

- RF-01: `GET` e `HEAD` sem `Range` respondem 200 com `accept-ranges: bytes`. Sem `size` (ou com `size: 0`), o cabeçalho não aparece (RF-09).
- RF-02: `bytes=2-5` → 206, `bytes 2-5/10`, `content-length: 4`, corpo com os bytes 2 a 5. `bytes=-3` → `7-9`. `bytes=8-100` → `8-9`. `bytes=-100` → `0-9`.
- RF-03: `HEAD` com `bytes=0-4` → 206, cabeçalhos corretos, corpo vazio.
- RF-04: `bytes=10-20` → 416, `bytes */10`, `content-length: 0`. `bytes=-0` → 416. O mesmo em `HEAD`. O 416 carrega `vary` quando há `encodings` configurados.
- RF-05: `bytes=0-1,4-5` → 200 sem `content-range`. `bytes=5-2` → 200 (não 416). `items=0-1` → 200. `bytes=-` → 200.
- RF-06: `If-Range: "abc"` com ETag `"abc"` → 206. `If-Range: "xyz"` → 200. `If-Range: W/"abc"` → 200. Data igual a `Last-Modified` → 206. Data diferente → 200. Asset sem `etag` com `If-Range` de ETag → 200.
- RF-07: `If-None-Match: "abc"` + `Range` → 304 sem corpo.
- RF-08: `POST` com `Range` → 405 com `allow: GET, HEAD`. Asset inexistente com `Range` → 404. Com `fallthrough: true`, a requisição passa adiante. Caminho não canônico com `Range` → 404, como hoje. Cabeçalhos `vary`, `content-type` e `content-encoding` presentes no 206 quando configurados.
- RF-09: `getMeta` sem `size` ou com `size: 0` → 200 completo, sem `accept-ranges`, `Range` ignorado.
- RF-10: `accept-encoding: gzip` com variante `.gz` de 40 bytes e `bytes=0-9` → 206, `bytes 0-9/40`, `content-encoding: gzip`, corpo com os 10 primeiros bytes do `.gz`.
- RF-11: o mesmo cenário com `getContents` devolvendo `string`, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream`. No `ReadableStream`, usar chunks que cruzam a fronteira da faixa (por exemplo `["ab", "cdef", "gh"]` com `bytes=2-5`). Teste adicional: um `ReadableStream` com callback de `cancel` deve ser cancelado depois que a faixa termina. Esse teste confirma a suposição de D-06.
- RF-13: o `describeMatrix` roda em `web` e `node`. No alvo `node`, o servidor HTTP real confirma que `content-length` e o corpo batem.

**Testes existentes:** nenhum precisa mudar, porque a mudança só altera respostas que enviam `Range` ou que têm `size > 0` no `200` (cabeçalho novo, sem remoção). Os testes que comparam cabeçalhos usam `toMatchObject` (`test/static.test.ts:53`, `:69`), que aceita campos extras. Confirmar isso na execução. O teste de `content-length` do usuário (`test/static.test.ts:600-617`) continua válido, porque cobre o `200`.

**Exportações (RF-12):** `test/unit/package.test.ts` contém `serveStatic` na lista de nomes (`test/unit/package.test.ts:133`). Rodar esse teste e conferir que a lista de exports não mudou.

**Comandos:**

```bash
pnpm vitest run test/static.test.ts   # cenários novos e existentes, web e node
pnpm vitest run test/unit/            # superfície pública
pnpm typecheck                        # tsc --noEmit (package.json:54)
pnpm lint                             # oxlint + oxfmt --check (package.json:46)
pnpm test                             # suíte completa com cobertura, antes de concluir
```

## Riscos

1. **Memória e I/O (alto).** `getContents(id)` não recebe a faixa. Para `ReadableStream` e `string`, o corpo inteiro é produzido e descartado até a faixa. Para arquivos grandes, isso reduz o ganho de `Range`. Mitigação nesta entrega: o `Blob` é fatiado sem leitura (D-06). Mitigação futura: segundo argumento opcional em `getContents` (PRD, decisão pendente, opção b).
2. **`content-length` inconsistente.** Se `getContents` devolver menos bytes que `meta.size`, ou `null` para um asset com tamanho conhecido, o `206` fica com `Content-Length` diferente do corpo. Para o `200` isso já acontece hoje (`src/utils/static.ts:276-277`), mas o `206` torna a falha mais visível. Mitigação: testes de `node` cobrem o caso normal. O caso de corpo ausente não é tratado de forma especial, e fica como limitação documentada.
3. **Cancelamento da fonte.** D-06 depende de `pipeThrough` cancelar a fonte quando o `TransformStream` encerra. Se o teste de cancelamento falhar, é preciso cancelar a fonte explicitamente.
4. **Cabeçalhos do usuário no `416`.** `options.headers` não aparece em respostas 4xx (`src/response.ts:211-213`). Isso é consistente com o módulo, mas é uma diferença visível para quem define `cache-control` globalmente. Documentar na descrição do PR.
5. **Regressão de ordem (médio).** A ordem de `304`, `404`, `405` e `fallthrough` é o ponto mais sensível (PRD, RF-07 e RF-08). Os testes existentes em `test/static.test.ts:199-225` e `:251-254`, mais os novos cenários de RF-07 e RF-08, cobrem a ordem.
6. **Tamanho do arquivo e convenção (baixo, mas real).** `src/utils/static.ts` passa de 350 linhas para cerca de 450, acima da meta de `AGENTS.md`. Acompanhamento: mover o parse de `Range` e `If-Range` para `src/utils/internal/range.ts` numa mudança posterior, sem alterar a API.
7. **Cache compartilhado (baixo).** Um `206` não é armazenado como resposta completa por caches que respeitam a RFC. A mudança não adiciona nenhum mecanismo de cache para `206`. Isso é responsabilidade da infraestrutura do cliente.
8. **Igualdade de data em `If-Range` (baixo).** RFC 9110 §13.1.5 só permite comparar datas quando o `Last-Modified` é considerado forte. O PRD e esta especificação adotam igualdade simples. Registrado como divergência consciente.

## Divergências e decisões tomadas

- **Norma:** a issue cita a RFC 7233. Seguimos a RFC 9110, como pede `sdd/pedido.md`.
- **RF-01 x RF-09:** resolvido por D-07. `Accept-Ranges` aparece quando o tamanho é conhecido.
- **Decisão pendente do PRD (`sdd/prd.md:179-181`):** adotamos a opção (a), fatiar o corpo devolvido, sem mudar `getContents`. A opção (b) fica como melhoria futura.
- **Premissa do PRD sobre `Content-Length` em `206`** (`sdd/prd.md:169`): confirmada por D-05. A premissa vale só para `206`. Para `200`, o cabeçalho do usuário continua prevalecendo, como indica o teste de `test/static.test.ts:600-617`.
- **Fixture `"w/123"`:** a ETag minúscula dos testes existentes não é uma ETag fraca pela RFC. Os testes novos usam aspas. Não é necessário corrigir os existentes.
