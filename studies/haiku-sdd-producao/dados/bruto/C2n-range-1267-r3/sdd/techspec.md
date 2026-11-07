# Especificação técnica: HTTP Range no `serveStatic`

Referências: `sdd/pedido.md` (contrato enxuto, cuja existência ainda não foi confirmada; ver PRD, "Premissas"), `sdd/prd.md` (requisitos RF-01 a RF-12 e tabela de decisão) e h3js/h3#1267.
Esta especificação não altera código. Ela registra as decisões de arquitetura que o PRD deixou em aberto ou que precisam ser amarradas ao código atual.

Nota: os números de linha abaixo foram levantados no código atual quando a spec foi escrita e não foram reconferidos nesta revisão. Reconferir antes de implementar; se o código mudar, o que vale é o nome da função ou o trecho citado.

## Estado atual relevante

- `serveStatic` valida método, canonicidade do caminho, `getMeta`, `Vary`, `304`, `Content-Type`, `Content-Encoding` e `Content-Length`, nessa ordem, e só então chama `getContents` para GET. HEAD retorna antes disso (`src/utils/static.ts:101-277`).
- `Content-Length` vem de `meta.size` e só é definido quando o cabeçalho ainda não existe (`src/utils/static.ts:268-270`). O teste `test/static.test.ts:600-617` depende desse comportamento para o caso sem `Range`.
- O `304` é decidido por `isCacheMatch`, que já trata `If-None-Match` antes de `If-Modified-Since` (`src/utils/static.ts:243-248`; `src/utils/internal/cache.ts:29-49`).
- O `ETag` é gravado em `event.res` sem sobrescrever (`src/utils/static.ts:239-241`), e o `last-modified` é derivado de `mtime` truncado a segundos (`src/utils/static.ts:227-237`). A comparação de `If-Range` por data precisa usar exatamente esse valor.
- Hoje não há nenhum tratamento de `Range` no projeto. O único vestígio é `src/rules/cache.ts:148`, que desvia requisições com `Range` do cache de regras. Isso fica fora do escopo (PRD, "Fora de escopo").
- A mesclagem de headers faz `event.res.headers` sobrescrever os headers do `HTTPResponse` retornado: `src/response.ts:198-205` e `src/response.ts:224-228`, via `mergeHeaders` (`src/response.ts:243-252`). Por isso, `Content-Length` e `Content-Range` de 206 e 416 têm de ser definidos em `event.res.headers`, e não no `init` do `HTTPResponse`.
- `HTTPResponse` aceita `BodyInit | null` (`src/response.ts:96-106`). Um corpo `HTTPResponse` passa direto por `prepareResponseBody` (`src/response.ts:303-306`), antes do ramo de `Blob`, então um `Blob` fatiado chega ao runtime sem reprocessamento.
- Exportações: `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. Há um teste de snapshot da lista de exportações em `test/unit/package.test.ts:133`, que serve de guarda para RF-11.
- Documentação existente: `docs/2.utils/2.response.md:39-49` descreve `serveStatic`. Precisa de um parágrafo sobre Range (ver D-09 e "Arquivos a alterar").

## Decisões de arquitetura

### D-01 — Onde ficam os helpers de Range

**Escolha:** os helpers de parsing, de `If-Range` e de fatiamento ficam privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), como pede o PRD (RF-11).

**Alternativas consideradas:**
- Criar `src/utils/internal/range.ts`. Respeita melhor a meta de arquivos com menos de 200 linhas do `AGENTS.md`, mas contradiz o texto do RF-11, que exige os helpers em `static.ts`.

**Justificativa:** segue o PRD. O custo é que `static.ts` já tem cerca de 350 linhas (`src/utils/static.ts:351` é o último), e a mudança soma cerca de 90 linhas. Fica registrado como risco (R-07), e a escolha pode ser revista pelo autor.

### D-02 — Ponto de inserção e ordem de avaliação

**Escolha:** a lógica de Range entra depois de `isCacheMatch` (`src/utils/static.ts:243-248`) e depois do bloco de `Content-Length` (`src/utils/static.ts:268-270`), e antes do retorno de HEAD (`src/utils/static.ts:272-274`). A ordem efetiva é: `304` → `If-Range` → tamanho → satisfazibilidade → `206`/`416`/`200`.

**Alternativas consideradas:**
- Avaliar Range antes de `isCacheMatch`. Violaria RF-07, porque uma requisição que deve virar `304` poderia virar `416`.
- Avaliar Range dentro do bloco de `Content-Length`. Mistura responsabilidades e torna o `set` condicional mais difícil de ler.

**Justificativa:** RF-07 e a tabela de decisão exigem que `304` venha antes. Ao colocar Range depois do `Content-Length` original, o `set` em `event.res` sobrescreve o valor de `meta.size` quando a resposta é parcial (ver D-08), sem alterar o caminho sem Range.

### D-03 — Validação de `If-Range`

**Escolha:** o valor de `If-Range` é classificado pela forma antes de comparar:
- Valor com forma de entity-tag (começa com `"` ou com `W/"`) é comparado só com `meta.etag`. Confere somente se não começa com `W/` e é idêntico a `meta.etag`. Comparação literal, sem normalização. Se `meta.etag` estiver ausente, não confere.
- Qualquer outro valor é tratado como data: confere somente se é idêntico, como string, a `mtimeDate.toUTCString()` (`src/utils/static.ts:227-237`). Sem `mtime`, a data nunca confere.
- Ausência de `If-Range` confere sempre (o `Range` vale).

Assim, um valor de data nunca é comparado com o ETag, e um ETag nunca é comparado com a data.

**Alternativas consideradas:**
- `new Date(ifRange).getTime() === mtime`. Rejeitada: `Date` aceita formatos lenientes (RFC 850, ISO, números) e o PRD (RF-06, "Fora de escopo") diz que outros formatos não conferem.
- Comparar com `event.res.headers.get("last-modified")`. Rejeitada: o valor pode ter sido definido pelo usuário em `options.headers`. Usar `mtimeDate`, como `isCacheMatch` faz, mantém a mesma fonte de verdade para `304` e `206`.

**Justificativa:** a comparação de string é exata, sem parsing, e segue o texto do PRD. O caso `W/` é tratado antes da comparação, então um `meta.etag` fraco nunca confere (Decisão 3 do PRD).

### D-04 — Gramática do `Range` e tratamento de inválidos

**Escolha:** uma regex estrita para um único intervalo, sem espaços, aplicada ao valor inteiro do cabeçalho:

```ts
const RANGE_RE = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/;
```

- `bytes=a-b`, `bytes=a-` e `bytes=-n` são aceitos. Qualquer outra coisa (unidade diferente, múltiplos intervalos, espaços, `b < a`, dígitos vazios) resulta em `undefined`, ou seja, `200` completo.
- Números são convertidos com `Number`, e valores que não passam em `Number.isSafeInteger` tratam o cabeçalho como malformado (`200`).
- Um cabeçalho `Range` repetido chega como `bytes=...,...` e cai no ramo de múltiplos intervalos.

**Alternativas consideradas:**
- Gramática completa da RFC 9110 com OWS ao redor das vírgulas. Rejeitada: o RF-02 proíbe explicitamente espaços ao redor de `=`, `-` e `,`, e os casos com vírgula acabam em `200` de qualquer forma.
- Aceitar `b` maior que o tamanho e limitar. Essa parte já está no RF-02 e é implementada com `Math.min` em `end` (ver a ordem de `resolveRange` abaixo).

### D-05 — Fatiamento por tipo de corpo

**Escolha:** `sliceBody` retorna o trecho pedido somente para tipos materializados:

| Tipo de `contents`        | Trecho                                              |
| ------------------------- | --------------------------------------------------- |
| `Blob`                    | `blob.slice(start, end + 1)`                        |
| `Uint8Array`              | `bytes.subarray(start, end + 1)`                    |
| `ArrayBuffer`             | `buf.slice(start, end + 1)`                         |
| `string`                  | `new TextEncoder().encode(s).subarray(start, end + 1)` |
| `ReadableStream`, outros, `null`, `undefined` | `undefined`, o que faz a resposta ser `200` completa (decisão em aberto do PRD; ver "Pontos a confirmar", item 2) |

**Alternativas consideradas:**
- (a) Ler o stream inteiro e descartar bytes antes de `start`. Rejeitada: custo de memória e de tempo para arquivos grandes, como o PRD (Riscos) já aponta.
- (c) Só formatos materializados, que para streams é o mesmo que (b).

**Justificativa:** a opção (b) do PRD, recomendada por ele como primeira versão. Mantém o escopo pequeno e deixa a limitação documentada. A consequência para HEAD está em D-06.

**Status:** bloqueante para a implementação. O PRD exige confirmação do autor antes de codar esta parte.

### D-06 — HEAD com `Range` e consistência com GET

**Escolha:** para HEAD com `Range` válido, `serveStatic` chama `getContents` uma vez, só para decidir se o corpo é fatiável. Se for, responde `206` com `Content-Range` e `Content-Length`, sem corpo. Se não for, responde `200` completo. Quando o corpo recebido é um `ReadableStream` e não será usado, ele é cancelado com `cancel()` para liberar o recurso. O helper `cancelIfStream` não lança e trata a promise de `cancel()` (com `catch` vazio ou `void` seguido de tratamento), para não gerar rejeição não tratada.

Para HEAD sem `Range`, nada muda: a resposta sai antes de `getContents`, como hoje (`src/utils/static.ts:272-274`).

**Alternativas consideradas:**
- HEAD sempre `206` a partir do `size`, sem chamar `getContents`. Mais barato, mas viola RF-03 quando GET cairia em `200` para um stream: os cabeçalhos de HEAD e GET divergiriam.
- HEAD sempre `200` quando o tipo não é conhecido. Não atende RF-03 para formatos fatiáveis.

**Justificativa:** mantém HEAD e GET com a mesma decisão de fatiamento. O custo é abrir o recurso em HEAD com `Range`, o que é aceitável porque HEAD com `Range` é raro. **Ponto a confirmar pelo autor** (ver "Pontos a confirmar").

### D-07 — `Accept-Ranges` em todas as respostas de asset encontrado

**Escolha:** `accept-ranges: bytes` é definido em `event.res.headers` logo depois do bloco de `ETag` (`src/utils/static.ts:239-241`), com a mesma guarda `if (!has(...))` que esse bloco usa. Assim o cabeçalho aparece em `200`, `206`, `304` e `416` de asset encontrado.

**Alternativas consideradas:**
- Definir só em `200` e `206`. Exigiria repetir a atribuição em dois ou três retornos, e RF-01 pede o cabeçalho em respostas de sucesso, sem excluir os demais.

**Justificativa:** RF-01 pede `Accept-Ranges` em todo sucesso. Estender para `304` e `416` é inofensivo, porque a RFC trata o cabeçalho como indicação de capacidade, e o caminho 404/fallthrough não é afetado, já que o cabeçalho só é gravado depois de o asset ser encontrado (`src/utils/static.ts:210-215`).

### D-08 — `Content-Length` e `Content-Range` em `206` e `416`

**Escolha:**
- `206` e `416` definem `content-length` e `content-range` com `event.res.headers.set(...)`, sobrescrevendo valores anteriores. Isso inclui o `content-length` que `meta.size` (`src/utils/static.ts:268-270`) ou o `options.headers` do usuário já tenham definido.
- `416` define `content-range: bytes */<size>` e `content-length: 0` em `event.res`, e retorna `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`.
- `200` mantém o `content-length` original, porque só é sobrescrito quando a resposta parcial é de fato enviada (D-06).

**Alternativas consideradas:**
- Respeitar um `content-length` já definido pelo usuário também em `206`. Gera um `Content-Length` que não bate com o corpo enviado. Rejeitada.
- Colocar `content-length` no `init` do `HTTPResponse`. Não funciona: `src/response.ts:203` e `src/response.ts:227` mesclam `event.res` por cima dos headers do `HTTPResponse`, então o valor de `meta.size` venceria.

**Justificativa:** RF-02 e RF-04 exigem `Content-Length` correto nessas respostas. A exceção ao comportamento de `options.headers` vale só quando há `Range` aplicável, e o teste `test/static.test.ts:600-617` não envia `Range`, então continua passando sem alteração.

### D-09 — Documentação

**Escolha:** acrescentar em `docs/2.utils/2.response.md`, logo após o bloco de `serveStatic` (`docs/2.utils/2.response.md:39-49`), um parágrafo curto sobre suporte a `Range`: quais respostas são produzidas, a limitação para streams e o fato de múltiplos intervalos receberem `200`.

**Justificativa:** `AGENTS.md` pede para manter a documentação de arquitetura e comportamentos atualizada. A mudança é pública, porque altera respostas que os clientes veem.

## Contratos e assinaturas

Tudo abaixo é privado em `src/utils/static.ts`. Nenhum nome novo é exportado (RF-11), e `src/index.ts` não muda.

```ts
/** Intervalo inclusivo, já limitado ao tamanho do asset. */
type ByteRange = { start: number; end: number };

/**
 * `undefined`: servir `200` completo (sem `Range`, `Range` inválido, `If-Range` não confere,
 * tamanho desconhecido ou zero). `"unsatisfiable"`: responder `416`. Demais: `206` candidato.
 */
type RangeOutcome = ByteRange | "unsatisfiable" | undefined;

function resolveRange(
  headers: Headers,
  validators: { size?: number; etag?: string; lastModified?: string },
): RangeOutcome;

/** `true` quando não há `If-Range` ou quando ele confere (D-03). */
function isIfRangeMatch(
  ifRange: string | null,
  validators: { etag?: string; lastModified?: string },
): boolean;

/** Trecho do corpo para o intervalo, ou `undefined` se o tipo não é fatiável (D-05). */
function sliceBody(body: BodyInit | null | undefined, range: ByteRange): BodyInit | undefined;
```

`RANGE_RE` (D-04) fica no módulo, junto aos demais helpers. As assinaturas de `ServeStaticOptions`, `getMeta` e `getContents` não mudam (PRD, "Fora de escopo").

### Ordem de `resolveRange`

Os casos de borda dependem da ordem abaixo. Ela deve ser seguida à risca pela implementação e pelos testes:

1. Sem `Range`, ou valor que não casa com `RANGE_RE` → `undefined`.
2. `If-Range` presente e não confere (D-03) → `undefined`.
3. `size` ausente ou igual a `0` → `undefined` (RF-10). Por isso `bytes=-0` em asset vazio dá `200`, não `416`.
4. Converter os números e checar `Number.isSafeInteger`; falha → `undefined` (D-04, R-06).
5. Intervalo fechado (`a-b`): se `b < a` → `undefined`. Só depois disso: se `a >= size` → `"unsatisfiable"`; senão `end = Math.min(b, size - 1)`.
6. Intervalo aberto (`a-`): se `a >= size` → `"unsatisfiable"`; senão `end = size - 1`.
7. Sufixo (`-n`): se `n === 0` → `"unsatisfiable"`; senão `start = Math.max(0, size - n)` e `end = size - 1`.

O passo 5 vem antes da checagem de satisfazibilidade de propósito: `bytes=200-100` é sintaticamente inválido (RF-05) e deve dar `200`, não `416`.

### Fluxo de `serveStatic` após a mudança

Trechos novos, em pseudocódigo fiel ao código existente:

```ts
// src/utils/static.ts, depois do bloco de ETag (linha 241)
if (!event.res.headers.has("accept-ranges")) {
  event.res.headers.set("accept-ranges", "bytes");
}

// src/utils/static.ts, depois do Content-Length (linha 270)
const range = resolveRange(event.req.headers, {
  size: meta.size,
  etag: meta.etag,
  lastModified: mtimeDate?.toUTCString(),
});
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (event.req.method === "HEAD" && !range) {
  return new HTTPResponse(null, { status: 200 });
}

const contents = await options.getContents(id);
const partial = range && sliceBody(contents, range);
if (range && partial !== undefined) {
  const length = range.end - range.start + 1;
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(length));
  return new HTTPResponse(event.req.method === "HEAD" ? null : partial, { status: 206 });
}
if (event.req.method === "HEAD") {
  cancelIfStream(contents); // D-06
  return new HTTPResponse(null, { status: 200 });
}
return new HTTPResponse(contents || null, { status: 200 });
```

`cancelIfStream` é um helper privado de uma linha, ou fica inline. Não é exportado.

Observações:
- `meta.size` nunca é `undefined` nem `0` quando `range` é um intervalo, porque `resolveRange` devolve `undefined` nesses casos (RF-10).
- Para HEAD parcial, `partial` não é lido, e o corpo fica `null`. Como `sliceBody` ainda é chamado para decidir se é fatiável, é aceitável que ele crie um `subarray` ou `slice` descartado.
- Para GET sem `Range`, o caminho final é o mesmo de hoje (`src/utils/static.ts:276-277`).

## Estratégia de testes

Seguindo `AGENTS.md` (fluxo de correção de bug) e RF-12:

1. Escrever primeiro um bloco novo `describeMatrix("serve static range requests", ...)` em `test/static.test.ts`, entre o bloco de MIME types (termina em `test/static.test.ts:624`) e o bloco de "malformed url" (começa em `test/static.test.ts:626`). O bloco monta um app com `t.app.all("/**", ...)`, como o primeiro bloco (`test/static.test.ts:5-30`), com um asset de 100 bytes conhecido.
2. Rodar `pnpm vitest run test/static.test.ts` e confirmar que os casos de comportamento novo **falham** antes de qualquer mudança em `src/utils/static.ts`. Casos que já passam hoje (404 e 405 com `Range`, `304` com `Range`, `200` para `Range` malformado, `size` ausente ou zero, `content-length` do usuário sem `Range`) são de regressão: passam antes e depois. A lista dos que falharam deve ir na descrição do PR.
3. Implementar, rodar de novo e confirmar que passam nos modos `web` e `node`.
4. Rodar `pnpm lint` (segundo `AGENTS.md`, inclui o typecheck; a referência rápida não lista um script `typecheck` separado) e `pnpm test` (lint, typecheck e cobertura).

Casos, cada um em `describeMatrix` (ambos os modos):

- **RF-01:** GET sem `Range` tem `accept-ranges: bytes` e corpo completo. HEAD também.
- **RF-02:** `bytes=10-19` → `206`, `content-range: bytes 10-19/100`, `content-length: 10`, corpo com os bytes 10 a 19. `bytes=90-` → `90-99/100`. `bytes=-500` → `0-99/100`, `content-length: 100`. `bytes=0-999` → `0-99/100`.
- **RF-02 (espaços):** `bytes= 10-19` e `bytes=10 - 19` → `200` completo.
- **RF-03:** HEAD `bytes=0-9` → `206`, mesmos `content-range` e `content-length` do GET, corpo vazio. HEAD `bytes=-500` → `206` com `0-99/100`.
- **RF-04:** `bytes=100-200` em GET e HEAD → `416`, `content-range: bytes */100`, `content-length: 0`, corpo vazio. `bytes=-0` → `416` em HEAD.
- **RF-05:** `bytes=0-4,10-14`, `itens=0-4`, `bytes=abc`, `bytes=10-5`, `bytes=-`, `bytes=-abc` → `200` completo, sem `content-range`. Também `bytes=200-100` → `200` (passo 5 da ordem de `resolveRange`, não `416`). Também `bytes=0-9999999999999999999` → `200` (inteiro não seguro, D-04).
- **RF-06:** `If-Range: "v1"` (ETag `"v1"`) → `206`. `If-Range: "v0"` → `200`. `If-Range: W/"v1"` → `200`. `Range: bytes=500-600` com `If-Range: "v0"` → `200`, não `416`.
- **RF-06 (data):** o teste pega o valor de `last-modified` de uma resposta GET anterior e o usa como `If-Range` → `206`. Assim o teste não repete a formatação de data da implementação. Data em outro formato equivalente (por exemplo, ISO) → `200`. Data diferente → `200`.
- **RF-06 (sem validador):** `If-Range` com asset sem `etag` e sem `mtime` → `200`.
- **RF-07:** `Range: bytes=0-9` com `If-None-Match` correspondente → `304`, sem `content-range`.
- **RF-08:** com `encodings: { gzip: ".gz" }` e variante `app.js.gz` de 40 bytes, `Accept-Encoding: gzip` + `Range: bytes=0-9` → `206`, `content-encoding: gzip`, `content-length: 10`, `content-range` sobre 40. Sem variante, o intervalo recai sobre o arquivo original.
- **RF-09:** asset inexistente com `Range`: `404` sem `fallthrough`, e encadeamento com `fallthrough`. `POST` com `Range` → `405` com `allow: GET, HEAD`.
- **RF-10:** `getMeta` sem `size` → `200` completo, sem `content-range`. `size: 0` → `200` com corpo vazio, sem `content-range`.
- **Tipos de corpo (D-05):** `Blob`, `Uint8Array`, `ArrayBuffer`, e `string` com caracteres multibyte (`"é"` ou emoji), com `size` igual aos bytes UTF-8. Intervalo sobre os bytes, não sobre caracteres.
- **Stream (D-05, D-06):** `ReadableStream` com `Range` → GET responde `200` completo, sem `content-range`. HEAD com `Range` → `200`, e o stream é cancelado (verificar com um stream que registra `cancel`, chamado exatamente uma vez).
- **Headers do usuário (D-08):** `options.headers` com `content-length: 999` e GET com `Range: bytes=0-9` → `content-length: 10`. Caso sem `Range` continua em `999` (o teste existente de `test/static.test.ts:600-617`).
- **`Accept-Ranges` (D-07):** presente em `304` e `416` de asset encontrado; ausente em `404` e `405`.
- **Ordem de `416`:** `416` mantém `accept-ranges` e não recebe `content-length` de `meta.size`.

Também:
- `test/unit/package.test.ts:133` (snapshot de exportações) deve continuar verde sem alteração. Isso confirma RF-11.
- Nenhum teste existente usa `Range`, então nenhum teste atual precisa ser ajustado. Se algum precisar de ajuste durante a implementação, a justificativa vai na descrição do PR (RF-12).

## Riscos

- **R-01 — Inconsistência HEAD/GET para streams.** Mitigado pela D-06 (HEAD chama `getContents`). Sem essa escolha, HEAD diria `206` e GET diria `200`.
- **R-02 — Vazamento de `ReadableStream` em HEAD.** Se o stream não for cancelado, o recurso (por exemplo, um descritor de arquivo) fica aberto. Mitigado por `cancelIfStream` e coberto por teste.
- **R-03 — Corpo inconsistente com `size`.** Se `getContents` devolver menos bytes que `meta.size`, o `206` fica com `Content-Length` maior que o corpo. O PRD (Riscos) já assume o backend consistente. A implementação não verifica o comprimento real do corpo, para não ler o corpo inteiro.
- **R-04 — Ordem de avaliação.** Colocar Range antes de `isCacheMatch` faria `416` aparecer no lugar de `304`. Coberto por RF-07 e pelo caso de teste correspondente (D-02).
- **R-05 — Mesclagem de headers.** Um `content-length` ou `content-range` definido no `init` do `HTTPResponse` seria sobrescrito por `event.res` (`src/response.ts:203`, `src/response.ts:227`). Por isso o código usa `event.res.headers.set` (D-08). Um teste de `416` cobre esse caso.
- **R-06 — Inteiros grandes.** Valores acima de `Number.MAX_SAFE_INTEGER` poderiam produzir intervalos incorretos. Tratados como malformados (D-04).
- **R-07 — Tamanho de `static.ts`.** O arquivo passa de cerca de 350 para cerca de 440 linhas, acima da meta de 200 do `AGENTS.md`. Decisão D-01 segue o PRD. Se o autor preferir, os helpers podem ir para `src/utils/internal/range.ts` sem mudar a API pública.
- **R-08 — `If-Range` por data e `last-modified` customizado.** Se o usuário definir `last-modified` em `options.headers`, o cabeçalho servido não bate com `mtimeDate.toUTCString()`, e `If-Range` por data nunca confere. Aceitável, porque o `304` já usa `mtimeDate` (mesma fonte).
- **R-09 — Cache compartilhado.** Um CDN que guarda `200` por URL pode receber `206` de outra requisição. O PRD não pede `Vary: range`. Fica como observação, sem mudança nesta versão.

## Pontos a confirmar

1. **D-06 (HEAD com `Range` abre o recurso).** Recomendo a opção de chamar `getContents`, para manter HEAD e GET consistentes. Se preferir o custo menor de HEAD sempre `206`, a inconsistência para streams (R-01) passa a existir. Não bloqueia a implementação se o autor aceitar a recomendação.
2. **D-05 (streams como `200`). Bloqueante.** Mantém a opção (b) do PRD, que ainda está marcada como "precisa ser confirmada antes da implementação". Nenhum código de fatiamento deve ser escrito antes dessa confirmação.
3. **D-01 (helpers em `static.ts`).** Segue o PRD, com o custo de tamanho registrado em R-07.
4. **D-08 (override de `content-length` do usuário em `206`/`416`).** Muda o que o usuário espera de `options.headers`, mas só quando há `Range` aplicável. Se preferir não sobrescrever, o `206` fica com `Content-Length` errado.
5. **Existência de `sdd/pedido.md`.** As referências a ele (contrato e Decisão de aceite) não puderam ser confirmadas. Se não existir, o PRD é a única referência, como diz a sua seção "Premissas".
