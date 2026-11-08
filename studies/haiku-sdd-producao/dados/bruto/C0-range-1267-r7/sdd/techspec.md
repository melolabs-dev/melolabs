# Techspec — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` e `sdd/prd.md` (RF-01 a RF-11). Norma: RFC 9110 §13.1.5 e §14. Nenhum código do projeto é alterado por este documento.

## 1. Contexto no código atual

Fluxo de `serveStatic` em `src/utils/static.ts` (função em `:101`):

| Etapa | Linha |
| --- | --- |
| `options.headers` copiados para `event.res.headers` | `src/utils/static.ts:105-114` |
| Método diferente de GET/HEAD: `405` + `Allow` (ou fallthrough) | `src/utils/static.ts:116-122` |
| Caminho não canônico: `404` (ou fallthrough) | `src/utils/static.ts:142-147` |
| `Accept-Encoding` e busca de `getMeta` pelas variantes | `src/utils/static.ts:187-208` |
| Asset inexistente: `404` (ou fallthrough) | `src/utils/static.ts:210-215` |
| `Vary: accept-encoding` | `src/utils/static.ts:220-225` |
| `mtimeDate` (truncado em segundos) e `Last-Modified` | `src/utils/static.ts:227-237` |
| `ETag` | `src/utils/static.ts:239-241` |
| `304` via `isCacheMatch` | `src/utils/static.ts:243-248` |
| `Content-Type` | `src/utils/static.ts:250-262` |
| `Content-Encoding` | `src/utils/static.ts:264-266` |
| `Content-Length` (só se ausente) | `src/utils/static.ts:268-270` |
| `HEAD`: `200` sem corpo | `src/utils/static.ts:272-274` |
| `getContents(id)` e `200` | `src/utils/static.ts:276-277` |
| Seção de utilitários internos | `src/utils/static.ts:280` |

Pontos do restante do código que condicionam o desenho:

- `isCacheMatch` (`src/utils/internal/cache.ts:29`) já decide o `304`. A comparação fraca de ETag usa o prefixo `W/` (`src/utils/internal/cache.ts:51-53`), então `If-Range` não pode reaproveitá-la: exige comparação forte.
- `prepareResponse` mescla `event.res.headers` por cima dos cabeçalhos do `HTTPResponse` (`src/response.ts:195-205`, `mergeHeaders` em `src/response.ts:243-252`). Quem escreve em `event.res.headers` vence, e é assim que o `serveStatic` deixa os cabeçalhos hoje.
- O status vem do `HTTPResponse` (`res.status || preparedRes?.status`, `src/response.ts:195`) e passa por `sanitizeStatusCode` (`src/utils/sanitize.ts:17-28`), que aceita 206 e 416.
- `nullBody` (`src/response.ts:350-356`) anula o corpo em `HEAD` e em `304`, mas não em `416`. O corpo vazio do `416` tem de ser `null` no próprio `serveStatic`.
- Um erro (`HTTPError`) só recebe `errHeaders` (`src/response.ts:211-213`). O `416` portanto **não** pode ser lançado como `HTTPError`, porque perderia `Content-Range` e `Accept-Ranges`. Deve ser retornado como `HTTPResponse`.
- `src/index.ts:193` exporta `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`. O teste `test/unit/package.test.ts:133` lista as exportações públicas e protege o RF-11.

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica: helpers privados em `static.ts`

- **Alternativas:** (a) helpers não exportados no fim de `src/utils/static.ts`; (b) novo `src/utils/internal/range.ts`; (c) estender `src/utils/internal/cache.ts`.
- **Escolha: (a).** O pedido e o PRD (RF-11) exigem helpers privados no módulo `serveStatic`. (b) e (c) não vazariam para `src/index.ts`, mas contrariam o texto literal do contrato e dispersam um recurso de um único consumidor. O custo é o arquivo passar de 200 linhas (hoje 352), que o AGENTS.md pede evitar. Aceitamos o desvio porque o contrato é explícito, e os helpers vão na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`), onde o AGENTS.md manda pôr helpers internos.

### D-02 — Posição no fluxo: depois do `304`, antes do `HEAD`/`getContents`

- **Alternativas:** (a) resolver o intervalo antes de `isCacheMatch`; (b) resolver depois do `304` e do `Content-Encoding`; (c) reestruturar tudo em um pipeline novo.
- **Escolha: (b).** RF-08 manda `If-None-Match`/`If-Modified-Since` vencerem `Range`. O bloco novo entra entre `src/utils/static.ts:266` (fim do `Content-Encoding`) e `src/utils/static.ts:272` (`HEAD`), substituindo o `Content-Length` condicional de `:268-270`. Tudo que vem antes (meta, variante, `Vary`, `ETag`, `Last-Modified`, `304`) fica intacto, preservando cache, encoding e fallthrough (RF-09, RF-11). (c) aumentaria o risco de regressão sem ganho.
- **Exceção ao "intacto": `Accept-Ranges` no `304`.** RF-01 pede o cabeçalho também em `304`. A definição de "tamanho conhecido" (D-03) é calculada antes de `isCacheMatch` (inserção entre `src/utils/static.ts:241` e `:243`) para que o `304` o carregue. Isso só adiciona um cabeçalho e não muda a decisão do `304`.

### D-03 — "Tamanho conhecido" e `Accept-Ranges`

- **Alternativas:** (a) anunciar sempre (literal da issue); (b) anunciar só com `meta.size` definido e `> 0`.
- **Escolha: (b)**, a do PRD (RF-01, RF-10) e a mesma condição já usada em `src/utils/static.ts:268`. Anunciar sem poder atender seria falso. A ambiguidade da issue está registrada no PRD §4.
- Regra de escrita: em `200` e `304` o `Accept-Ranges` só é definido se ausente (mesmo estilo de `content-type`/`etag`, que respeitam `options.headers`). Em `206` e `416` é sobrescrito, conforme a premissa do PRD §2.

### D-04 — Parser de `Range`: regex única e estrita

- **Alternativas:** (a) regex única para um intervalo; (b) parser por `split(",")` que aceita a primeira faixa de um multi-range; (c) parser completo de `range-set` com junção de faixas.
- **Escolha: (a).** `/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i`. Só casa um intervalo, o que torna multi-range, `bytes=`, valores negativos ou não numéricos e unidade diferente "não casam", e "não casar" significa ignorar o `Range` e servir `200` (RF-06). (b) viola RF-06 (multi-range deve ser ignorado). (c) é escopo de `multipart/byteranges`, fora de escopo.
- Semântica após o casamento (`a` = grupo 1, `b` = grupo 2):
  - `a` e `b` vazios: ignorar (`bytes=-`).
  - Só `b`: sufixo. `b === 0` é insatisfazível (`416`). Senão `start = max(0, size - b)`, `end = size - 1`.
  - `a` com `b` vazio: `start = a`, `end = size - 1`.
  - `a` e `b`: `b < a` é sintaxe inválida, ignorar. Senão `end = min(b, size - 1)`.
  - `start >= size`: `416`.
- `Headers.get("range")` junta várias ocorrências do cabeçalho com `, `, o que cai no caso multi-range e é ignorado. Números além de `Number.MAX_SAFE_INTEGER` são tratados com `Number()` sem erro: continuam comparáveis (início enorme gera `416`, fim enorme é truncado).

### D-05 — `If-Range`: validador forte, data exata

- **Alternativas:** (a) reaproveitar `matchETag` de `src/utils/internal/cache.ts:11`; (b) comparação própria e estrita dentro de `static.ts`; (c) ignorar `If-Range`.
- **Escolha: (b).** `matchETag` usa comparação fraca (remove `W/`), mas RFC 9110 §13.1.5 exige forte. Regras:
  - valor (após `trim`) começa com `W/` ou o `meta.etag` começa com `W/`: não confere;
  - se o valor parece entity-tag (começa com `"`): confere só se `=== meta.etag`;
  - senão é tratado como data: confere só se `Date.parse(valor)` é finito, `mtimeDate` existe e `Date.parse(valor) === mtimeDate.getTime()` (já truncado em segundos, `src/utils/static.ts:232`);
  - qualquer outra coisa: não confere.
  - Não confere: ignora o `Range` e serve `200` completo. `If-Range` sem `Range` é ignorado (a função só é chamada quando o `Range` casou).
- (c) ignoraria o risco de entregar fatia de uma versão diferente da que o cliente tem. Nota: os testes existentes usam ETag `"w/123"` em minúsculas (`test/static.test.ts:15`). `W/` é sensível a maiúsculas na RFC e em `opaqueTag`, então `"w/123"` é tratado como forte. Isso é inofensivo e igual ao comportamento atual de cache; o teste de `If-Range` usa `etag: "abc"` (forte, com aspas no valor) como no PRD.

### D-06 — `416` e `206` retornados como `HTTPResponse`, com cabeçalhos em `event.res.headers`

- **Alternativas:** (a) `throw new HTTPError({ status: 416, headers })`; (b) retornar `HTTPResponse` com status e escrever os cabeçalhos em `event.res.headers`; (c) retornar `Response` nativa.
- **Escolha: (b).** (a) é descartada: o caminho de erro descarta os cabeçalhos de sucesso (`src/response.ts:211-213`) e serializa um corpo JSON, violando `Content-Length: 0` e corpo vazio (RF-05). (c) quebra o padrão do módulo (todas as saídas são `HTTPResponse`, `src/utils/static.ts:244,273,277`) e perderia o merge de `options.headers`. Com (b), `event.res.headers` vence no merge (`src/response.ts:243-252`), o que dá a precedência exigida no PRD §4 (`Content-Length` calculado sobrescreve o de `options.headers` em `206`/`416`).
- `416`: `Content-Range: bytes */<size>`, `Content-Length: 0`, `Accept-Ranges: bytes`, corpo `null`. `getContents` não é chamado. Vale para `GET` e `HEAD`. Os demais cabeçalhos (`ETag`, `Last-Modified`, `Vary`, `Content-Type`, `Content-Encoding`) permanecem, pois já foram escritos antes.
- `206`: `Content-Range: bytes <start>-<end>/<size>`, `Content-Length: <end - start + 1>`, `Accept-Ranges: bytes`.
- `Content-Type` continua o do asset original e `Content-Encoding`/`Vary` seguem como hoje, porque o bloco novo roda depois deles (RF-09). `size` é o `meta.size` da variante escolhida (`src/utils/static.ts:205`, a `meta` do laço de `:200-208`).

### D-07 — Recorte do corpo feito pelo `serveStatic`, com decisão tardia

- **Alternativas:** (a) passar `{ start, end }` a `getContents`; (b) recortar o `BodyInit` devolvido; (c) recusar o `Range` se o corpo não for recortável, sem fallback.
- **Escolha: (b)**, com fallback para `200` completo quando o tipo não é recortável. (a) muda `ServeStaticOptions` e está fora de escopo (PRD §3). O recorte é por tipo, em um helper privado `sliceBody(body, start, end)` que retorna `BodyInit | undefined` (`undefined` = não recortável):

  | Tipo | Estratégia |
  | --- | --- |
  | `string` | `new TextEncoder().encode(body).subarray(start, end + 1)`. Conta bytes UTF-8, não caracteres. |
  | `Blob` / `File` | `body.slice(start, end + 1)`. |
  | `ArrayBuffer` / `SharedArrayBuffer` | `new Uint8Array(body, start, len)`. |
  | `ArrayBufferView` | `new Uint8Array(body.buffer, body.byteOffset + start, len)`. |
  | `ReadableStream` | novo `ReadableStream` com `pull` que descarta os `start` primeiros bytes, emite até `len` e então cancela o leitor de origem. Não carrega o conteúdo na memória. |
  | `FormData`, `URLSearchParams` e outros | `undefined`: responde `200` completo. |

- Decisão tardia: para `GET` com intervalo válido, `getContents` é chamado antes de fixar os cabeçalhos. Se `contents` é `null`/`undefined` ou `sliceBody` devolve `undefined`, a resposta é a de hoje (`200`, cabeçalhos de intervalo não escritos, `Content-Length` como em D-08). Só quando há fatia é que `206` e seus cabeçalhos são escritos. Isso evita o estado inconsistente de cabeçalho `206` com corpo inteiro. `HEAD` não chama `getContents` (RF-04) e responde `206` só com cabeçalhos.
- Chunk de stream que não seja `Uint8Array` (por exemplo `string`) é codificado com `TextEncoder` antes de contar bytes.

### D-08 — `Content-Length` em respostas `200` fica como hoje

- **Alternativas:** (a) manter `src/utils/static.ts:268-270` como está para o caminho `200`; (b) sempre sobrescrever.
- **Escolha: (a).** O teste `test/static.test.ts:600-617` ("does not overwrite a content-length already set") exige que um `content-length` do usuário vença em `200`. A sobrescrita só vale nos caminhos `206` e `416` (D-06). Por isso o bloco de `Content-Length` existente passa a ser executado depois da decisão de intervalo e só no caminho `200`.

### D-09 — Compatibilidade de `HEAD` e `Content-Length` entre `web` e `node`

- **Alternativas:** (a) confiar em `nullBody` (`src/response.ts:350`) para `HEAD`; (b) tratar o `416` explicitamente.
- **Escolha: ambas.** `HEAD` já tem o corpo anulado por `nullBody`. O `416` precisa de `null` explícito e `content-length: 0`, para ser idêntico em `web` e `node` (risco do PRD §4). Os testes rodam em `describeMatrix` e comparam nos dois modos.

## 3. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/static.ts` | (1) Antes do `304`, definir `size` conhecido e `Accept-Ranges` (inserção em `src/utils/static.ts:241-243`). (2) Substituir `src/utils/static.ts:268-277` pelo bloco de decisão de intervalo + `HEAD` + `getContents` (D-02, D-06, D-07, D-08). (3) Adicionar os helpers privados na seção `src/utils/static.ts:280` em diante. (4) Atualizar o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com um parágrafo sobre `Range`. |
| `test/static.test.ts` | Novo `describeMatrix("serve static range", ...)` após o bloco que termina em `test/static.test.ts:624`. Os testes existentes não precisam mudar: `toMatchObject` (`test/static.test.ts:53,69,450,466`) tolera o `accept-ranges` extra. Rever só se algum falhar. |
| `test/unit/package.test.ts` | Sem edição. Já fixa as exportações (`test/unit/package.test.ts:133`) e serve de prova do RF-11. |
| `docs/2.utils/2.response.md` | Acrescentar uma nota curta sob `### serveStatic(event, options)` (`docs/2.utils/2.response.md:39`) sobre `Range`, `If-Range` e o requisito de `meta.size` correto. Opcional, não afeta o contrato. |

**Não alterar:** `src/index.ts` (`src/index.ts:193`), `src/utils/internal/cache.ts`, `src/response.ts` e os tipos `ServeStaticOptions`/`StaticAssetMeta` (`src/utils/static.ts:9-66`).

## 4. Contratos e assinaturas

Nada novo é exportado. Tudo abaixo é privado em `src/utils/static.ts`.

```ts
// Resultado da avaliação do cabeçalho Range para um asset de `size` bytes.
type ByteRange =
  | { start: number; end: number }   // satisfazível, `end` inclusivo e já truncado
  | "unsatisfiable"                  // 416
  | undefined;                       // ignorar Range → 200

function parseRange(header: string | null, size: number): ByteRange;

function ifRangeMatches(
  ifRange: string | null,
  validators: { etag?: string; lastModified?: Date },
): boolean; // true quando não há If-Range ou o validador confere

function sliceBody(body: BodyInit, start: number, end: number): BodyInit | undefined;
```

Pseudocódigo do trecho que substitui `src/utils/static.ts:268-277`:

```ts
const size = meta.size !== undefined && meta.size > 0 ? meta.size : undefined;

let range: ByteRange;
if (size !== undefined && event.req.headers.has("range")) {
  range = ifRangeMatches(event.req.headers.get("if-range"), { etag: meta.etag, lastModified: mtimeDate })
    ? parseRange(event.req.headers.get("range"), size)
    : undefined;
}

if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${size}`);
  event.res.headers.set("content-length", "0");
  event.res.headers.set("accept-ranges", "bytes");
  return new HTTPResponse(null, { status: 416 });
}

if (range && event.req.method === "HEAD") {
  // 206 só com cabeçalhos
}

// GET: obter contents, tentar sliceBody; se undefined → cair no 200 abaixo

// 200: content-length condicional (D-08), depois HEAD → null, GET → contents
```

Tabela de saídas:

| Situação | Status | Cabeçalhos relevantes |
| --- | --- | --- |
| Sem `Range`, tamanho conhecido | 200 | `Accept-Ranges: bytes`, corpo de hoje |
| `Range` válido, `GET` | 206 | `Content-Range`, `Content-Length` do intervalo, `Accept-Ranges` |
| `Range` válido, `HEAD` | 206 | idem, sem corpo, sem chamar `getContents` |
| Insatisfazível | 416 | `Content-Range: bytes */size`, `Content-Length: 0` |
| Malformado, multi-range, unidade ≠ `bytes`, `If-Range` não confere, corpo não recortável | 200 | resposta completa, sem `Content-Range` |
| `size` ausente ou 0 | 200 | sem `Accept-Ranges`, `Range` ignorado |
| `If-None-Match`/`If-Modified-Since` casam | 304 | `Accept-Ranges: bytes`, sem `Content-Range` |

## 5. Estratégia de testes

Seguem o Bug Fix Workflow do AGENTS.md: escrever os testes antes da implementação e confirmar que falham; implementar; confirmar que passam; rodar a suíte. Usam `describeMatrix`, então cada caso roda em `web` e `node`.

Fixture: asset de 10 bytes `0123456789` (`getMeta` → `{ size: 10, etag: '"abc"', mtime: 1_700_000_000_000 }`; `getContents` → string). `getContents` e `getMeta` são `vi.fn` para verificar chamadas.

| Caso | RF |
| --- | --- |
| `GET`/`HEAD` sem `Range`: `200`, corpo igual ao de hoje, `Accept-Ranges: bytes` | 01 |
| `bytes=2-5` → `206`, corpo `2345`, `Content-Range: bytes 2-5/10`, `Content-Length: 4` | 02 |
| fim além do tamanho (`bytes=7-99`) truncado em `7-9/10` | 02 |
| `bytes=7-` e `bytes=-3` → `789`, `7-9/10`; `bytes=-99` → asset inteiro; `Bytes=0-1` e espaços | 03 |
| `HEAD` + `bytes=2-5` → `206`, cabeçalhos, corpo vazio, `getContents` não chamado | 04 |
| `bytes=10-20` e `bytes=-0` → `416`, `Content-Range: bytes */10`, `Content-Length: 0`, corpo vazio (`GET` e `HEAD`) | 05 |
| `bytes=abc`, `5-2`, `bytes=`, `bytes=-`, `0-1,4-5`, `items=0-1` → `200` completo, sem `Content-Range` | 06 |
| `If-Range` com ETag igual → `206`; diferente → `200`; ETag fraco no `If-Range` ou no asset → `200` | 07 |
| `If-Range` com data igual a `Last-Modified` → `206`; data diferente ou inválida → `200`; `If-Range` sem `Range` → ignorado | 07 |
| `If-None-Match` igual + `Range` → `304`, sem `Content-Range`, com `Accept-Ranges` | 08 |
| `encodings: { gzip: ".gz" }`, variante de 20 bytes, `Accept-Encoding: gzip` + `bytes=0-4` → `206`, `Content-Encoding: gzip`, `bytes 0-4/20`, `Content-Length: 5`, `Vary`, `Content-Type` do original | 09 |
| `getMeta` sem `size` (e `size: 0`) + `Range` → `200`, sem `Accept-Ranges` nem `Content-Range` | 10 |
| asset inexistente + `Range` → `404`, ou segue com `fallthrough`; `POST` + `Range` → `405` com `Allow: GET, HEAD` | 11 |
| `options.headers` com `content-length: 999`: `200` mantém `999` (teste existente), `206` e `416` sobrescrevem | PRD §4 |
| Tipos de corpo: `string` multibyte (`"é"` = 2 bytes), `Blob`, `Uint8Array` com `byteOffset`, `ArrayBuffer`, `ReadableStream` em vários chunks, `URLSearchParams` (cai em `200` completo) | D-07 |
| Estabilidade da API: `package.test.ts` (já existente) continua passando | 11 |

Nos testes de tipo de corpo, `meta.size` deve ser o tamanho em bytes do conteúdo (a premissa do PRD §4).

Verificação final: `pnpm vitest run test/static.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm test` (lint + typecheck + cobertura) e `pnpm lint`.

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| `meta.size` incorreto gera `Content-Range` inconsistente com o corpo | É premissa do PRD. Documentar em `docs/2.utils/2.response.md`. Para `string`, o recorte conta bytes reais, então o corpo nunca excede o conteúdo, mas `Content-Length` segue o `size` informado. |
| Recorte de `BodyInit` heterogêneo | Tabela de D-07 com teste por tipo. Tipos não recortáveis caem em `200` completo, nunca em `206` falso. |
| `ReadableStream` sem cancelar a origem mantém um arquivo aberto | `pull` cancela o leitor de origem ao atingir o fim do intervalo, e `cancel` do stream novo propaga o cancelamento. Testar cancelamento com stream mock. |
| `string` grande codificada por inteiro na memória para cada `Range` | Aceito: o PRD deixa a leitura parcial no backend fora de escopo. Retorno do recorte é `subarray` sem segunda cópia. |
| `206` quando caberia `304` | D-02 mantém o `304` antes do intervalo. Coberto pelo teste de RF-08. |
| `If-Range` com ETag fraco tratado como forte | Comparação própria (D-05). O ETag `"w/123"` minúsculo dos testes atuais é tratado como forte, sem efeito prático sem `If-Range`. |
| Cabeçalho do usuário (`options.headers`) contradiz o intervalo | `206` e `416` sobrescrevem `Content-Length`, `Content-Range` e `Accept-Ranges` (D-06). |
| `Accept-Ranges` extra quebra testes que comparam cabeçalhos exatos | Os testes atuais usam `toMatchObject` (`test/static.test.ts:53,69,450,466`) e não devem quebrar. Se algum quebrar, ajustar só a asserção afetada. |
| Divergência `web`/`node` no corpo vazio do `416`/`HEAD` | `null` explícito mais `content-length: 0` (D-09), validado pelo `describeMatrix`. |
| Arquivo `static.ts` passa de 200 linhas | Desvio consciente (D-01). Se a revisão preferir, os helpers migram para `src/utils/internal/` sem mudar contratos nem exportações públicas. |
| Exportação pública acidental | Helpers sem `export`. `test/unit/package.test.ts:133` e `isolatedDeclarations` flagam vazamento. Conferir `src/index.ts` sem diff. |
