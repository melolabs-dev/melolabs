# Especificação técnica: HTTP Range no `serveStatic`

Referências: h3js/h3#1267, `sdd/pedido.md` (contrato), `sdd/prd.md` (requisitos RF-01 a RF-09).

Status: rascunho para revisão. Nenhum arquivo do projeto foi alterado.

Linha de base conferida: `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` passa com 272 testes e 0 erros de tipo.

---

## 1. Visão geral

`serveStatic` (`src/utils/static.ts:101`) passa a tratar `Range` para `GET` e `HEAD`:

1. Anuncia `Accept-Ranges: bytes` em toda resposta de sucesso.
2. Interpreta um único intervalo `bytes=` válido e responde 206 com `Content-Range` e `Content-Length` corretos.
3. Responde 416 quando o intervalo é insatisfazível.
4. Ignora `Range` quando o cabeçalho é malformado, usa outra unidade, tem vários intervalos, ou quando `If-Range` não bate.
5. Mantém intactos a checagem condicional (304), a seleção de encoding, `fallthrough`, 404 e 405.

Toda a mudança cabe em `src/utils/static.ts`. A assinatura de `serveStatic`, de `ServeStaticOptions`, de `StaticAssetMeta` e de `getMeta`/`getContents` não muda. `src/index.ts:193` não ganha nomes.

---

## 2. Decisões de arquitetura

### D-01 — Lógica de Range no próprio `static.ts`, sem módulo novo

**Alternativas**
- (a) Criar `src/utils/internal/range.ts` com o parser e as funções de If-Range.
- (b) Colocar os helpers privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---` (`src/utils/static.ts:280`).

**Escolha:** (b).

**Justificativa:** `sdd/pedido.md:51` pede que "toda a lógica auxiliar fique privada dentro do módulo serveStatic", e `sdd/prd.md` RF-08 repete a exigência. A opção (a) não exportaria nada publicamente, mas contraria a instrução literal. O custo é que `static.ts` (352 linhas hoje) passa de 400 linhas. O `AGENTS.md` pede menos de 200 linhas por arquivo, mas o arquivo já estava acima desse limite. Ver o risco R-08.

### D-02 — Ordem de avaliação: condicional, depois Range, depois cabeçalhos de representação

**Alternativas**
- (a) Avaliar `Range` antes da checagem condicional (`static.ts:243`). Isso contraria a RFC 9110 §13.2.2, que põe as pré-condições antes de `Range`, e quebra RF-07.
- (b) Avaliar `Range` depois de `content-type`, `content-encoding` e `content-length` (`static.ts:250-270`). A resposta 416 sairia com `Content-Type` e `Content-Encoding` de um corpo que não existe.
- (c) Avaliar `Range` logo após o 304 e antes de `content-type` (`static.ts:250`).

**Escolha:** (c).

**Justificativa:** a 304 continua tendo precedência, a 416 sai sem cabeçalhos de representação, e o 206 recebe `Content-Type` e `Content-Encoding` pelas linhas que já existem, porque o bloco de representação roda depois da decisão de 416.

### D-03 — Recorte do corpo: `Blob.slice` quando possível, senão buffer

**Alternativas**
- (a) Mudar `getContents` para receber o intervalo. Está fora de escopo (PRD, "Fora de escopo") e quebra a API.
- (b) Ler o `ReadableStream` e descartar bytes antes de `start`, parando após `end`. Não guarda o arquivo inteiro na memória, mas exige um transform próprio, e o backend ainda entrega o arquivo inteiro.
- (c) Se `contents instanceof Blob`, usar `contents.slice(start, end + 1)`. Para os demais tipos de `BodyInit`, usar `new Response(contents).arrayBuffer()` e depois `slice`.

**Escolha:** (c).

**Justificativa:** `Blob` é a forma comum de arquivos em Node, Bun, Deno e Workers. `Blob.slice` é preguiçoso e não lê o arquivo inteiro. Os outros tipos (string, `ArrayBuffer`, `ReadableStream`) são lidos inteiros nesta primeira versão. Isso é o risco principal (R-01) e fica registrado para decisão.

### D-04 — `Accept-Ranges: bytes` em toda resposta de sucesso GET/HEAD

**Alternativas**
- (a) Anunciar só quando `meta.size` é um número conhecido.
- (b) Anunciar sempre que a resposta é 200 ou 206 (PRD RF-01, texto literal).

**Escolha:** (b), seguindo o PRD.

**Pendência:** quando o tamanho é desconhecido, o servidor anuncia `bytes` e ignora `Range`. Isso é inconsistente com o sentido de `Accept-Ranges`. Ver R-02. Confirmar com o revisor antes da implementação.

**Local:** logo após a checagem 304 (`static.ts:248`), antes de D-02.

### D-05 — Asset de tamanho zero: 416 para qualquer `Range` válido

**Alternativas**
- (a) Ignorar `Range` quando `size` é 0 e responder 200 com corpo vazio.
- (b) Responder 416 com `Content-Range: bytes */0`.

**Escolha:** (b). Pela RFC 9110 §14.1.1, um conjunto de intervalos é insatisfazível quando nenhum byte do representation satisfaz o intervalo, e o representation de tamanho zero não tem byte algum. A resposta 200 sem `Range` continua como hoje, sem `Content-Length` quando `size` é 0 (`static.ts:268`). Ver R-03.

### D-06 — Sintaxe aceita e casos ignorados

**Sintaxe aceita:** um único intervalo, sem espaços, com a forma `bytes=<início>-<fim>`, `bytes=<início>-` ou `bytes=-<n>`. A unidade `bytes` não diferencia maiúsculas de minúsculas.

**Sempre ignorado (200 completo):**
- cabeçalho que não bate com a sintaxe (inclusive `bytes=-`, vírgula e espaços);
- unidade diferente de `bytes`;
- múltiplos intervalos (`bytes=0-10,20-30`);
- `início > fim` (`bytes=5-2`), que é intervalo inválido.

**Satisfazível:**
- `início-fim`: se `início >= size`, 416. Caso contrário, `fim` é limitado a `size - 1`.
- `início-`: se `início >= size`, 416. Caso contrário, `fim = size - 1`.
- `-n`: se `n == 0`, 416. Se `n >= size`, `início = 0`. Caso contrário, `início = size - n`. `fim = size - 1`.

**Alternativa considerada:** parser manual caractere a caractere. **Escolha:** expressão regular única, `/^bytes=(\d*)-(\d*)$/i`, com rejeição explícita de `bytes=-`, porque é mais curta e fácil de conferir contra a gramática.

### D-07 — `If-Range`: comparação forte

**Regra**
- Sem `If-Range`: a condição é verdadeira.
- Valor que começa com `W/`: nunca bate (RFC 9110 §13.1.5 exige comparação forte).
- Valor que parece ETag: bate só se for igual, caractere a caractere, ao `meta.etag` (que precisa ser forte, ou seja, não começar com `W/`).
- Valor que parece data (HTTP-date): bate só se `Date.parse(valor)` for igual ao `mtimeDate` já truncado em segundos (`static.ts:229-232`). Sem `mtimeDate`, não bate.
- Valor inválido ou vazio: não bate, então 200.

**Alternativas:** comparação fraca, como em `matchETag` (`src/utils/internal/cache.ts:11-17`). Rejeitada, porque a RFC proíbe comparação fraca para `If-Range`.

**Nota:** a checagem de tag fraca em `src/utils/internal/cache.ts:52` usa `startsWith("W/")` com maiúscula. Vamos reaproveitar a mesma convenção.

### D-08 — Cabeçalhos que o `Range` precisa sobrescrever

`prepareResponse` mescla `event.res.headers` (preparados) por cima dos cabeçalhos do `HTTPResponse` (`src/response.ts:203`, `mergeHeaders` em `src/response.ts:243`). Por isso:

- `Content-Length` e `Content-Range` de 206 e 416 são gravados com `event.res.headers.set(...)`, nunca só com `new HTTPResponse(..., { headers })`. Senão o valor de `event.res.headers` vence.
- Para 206 e 416, `Content-Length` sobrescreve qualquer valor vindo de `options.headers`. O teste que protege o `content-length` do usuário (`test/static.test.ts:600-617`) cobre só o 200 e continua valendo.

### D-09 — `HEAD` com 206 não lê o corpo

Para `HEAD`, o 206 volta com os cabeçalhos e corpo `null`, sem chamar `getContents`. Isso mantém o comportamento atual de `HEAD` (`static.ts:272-274`), em que `getContents` não é chamado.

### D-10 — Fluxo de 404, 405 e fallthrough não muda

`Range` só é avaliado depois que `meta` foi encontrado (`static.ts:210-215`). Métodos não permitidos continuam saindo em `static.ts:116-122`, antes de qualquer lógica de Range. O 404 e o `fallthrough` vêm antes, então um `Range` nunca altera esses casos.

---

## 3. Arquivos a alterar

| Arquivo | O que muda | Referência atual |
|---|---|---|
| `src/utils/static.ts` | Inserir a negociação de Range e o recorte do corpo. Acrescentar helpers privados no fim do arquivo. | Inserção após `static.ts:248` (304) e antes de `static.ts:250` (content-type). Ajuste em `static.ts:268-277`. Helpers depois de `static.ts:351`. |
| `test/static-range.test.ts` | Arquivo novo com os testes de RF-01 a RF-07, em `describeMatrix` (web e node). | Modelo: `test/static.test.ts:5` e `test/_setup.ts:11`. |

Sem alteração esperada em:
- `src/index.ts:193` (nenhuma exportação nova);
- `src/response.ts` (a mesclagem já existe; ver D-08);
- `src/utils/internal/cache.ts` (reutilizado sem mudança);
- `test/static.test.ts` (nenhum teste atual envia `Range`; ver §6);
- `test/security.test.ts` e `test/unit/package.test.ts:133` (nenhum envia `Range`; a lista de exportações segue igual).

---

## 4. Contratos e assinaturas

### 4.1 Público (sem mudança)

```ts
// src/utils/static.ts:101
export async function serveStatic(
  event: H3Event,
  options: ServeStaticOptions,
): Promise<HTTPResponse | undefined>;
```

`ServeStaticOptions`, `StaticAssetMeta` e a exportação em `src/index.ts:193` ficam iguais.

### 4.2 Privado (novo, no fim de `src/utils/static.ts`, sem `export`)

```ts
/** Intervalo de bytes inclusivo, já limitado a [0, size - 1]. */
type ByteRange = { start: number; end: number };

/**
 * Interpreta o cabeçalho `Range` contra o tamanho do asset.
 * - `ByteRange`: intervalo a servir (206).
 * - `"unsatisfiable"`: intervalo válido e fora do asset (416).
 * - `undefined`: cabeçalho ignorado (200 completo).
 */
function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | undefined;

/**
 * `true` quando `If-Range` está ausente ou corresponde ao estado atual do asset
 * (D-07). `etag` e `mtime` são os validadores de `meta`.
 */
function matchesIfRange(value: string | null, etag: string | undefined, mtime: Date | undefined): boolean;

/**
 * Recorta o corpo para o intervalo (D-03). Blob usa `slice`; os demais tipos
 * são lidos por completo e recortados.
 */
async function sliceContents(
  contents: BodyInit | null | undefined,
  range: ByteRange,
): Promise<Blob | ArrayBuffer>;
```

Nenhuma dessas funções é exportada. Elas não entram em `src/index.ts`, e `test/unit/package.test.ts` continua valendo como guarda de RF-08.

### 4.3 Cabeçalhos e status produzidos

| Caso | Status | Cabeçalhos | Corpo |
|---|---|---|---|
| GET/HEAD sem `Range` (ou ignorado) | 200 | `accept-ranges: bytes`, `content-length` como hoje | completo (HEAD: vazio) |
| Intervalo válido | 206 | `accept-ranges: bytes`, `content-range: bytes <início>-<fim>/<size>`, `content-length: <fim-início+1>` | intervalo (HEAD: vazio) |
| Insatisfazível | 416 | `accept-ranges: bytes`, `content-range: bytes */<size>`, `content-length: 0` | vazio |
| 304 | 304 | como hoje | vazio |

---

## 5. Fluxo de implementação

Trecho de referência. Os nomes e a ordem estão conferidos com `src/utils/static.ts`:

```ts
// static.ts:243-248, depois do 304 atual:
event.res.headers.set("accept-ranges", "bytes");

// D-07 e D-06: o Range só vale se If-Range bater.
const rangeHeader = event.req.headers.get("range");
const range =
  rangeHeader &&
  meta.size !== undefined &&
  matchesIfRange(event.req.headers.get("if-range"), meta.etag, mtimeDate)
    ? parseRange(rangeHeader, meta.size)
    : undefined;

// D-02, D-05, D-08: 416 sai antes de content-type e content-encoding.
if (range === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${meta.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}

// static.ts:250-266: content-type e content-encoding como hoje.

// static.ts:268-270, substituído por:
if (range) {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
} else if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
  event.res.headers.set("content-length", meta.size + "");
}

// static.ts:272-277, substituído por:
if (event.req.method === "HEAD") {
  return new HTTPResponse(null, { status: range ? 206 : 200 });
}
const contents = await options.getContents(id);
if (range) {
  return new HTTPResponse(await sliceContents(contents, range), { status: 206 });
}
return new HTTPResponse(contents || null, { status: 200 });
```

**Observação de tipos:** `range` tem três estados (`undefined`, `"unsatisfiable"` ou `ByteRange`). Depois do `if (range === "unsatisfiable")`, o TypeScript estreita para `ByteRange | undefined`. O código acima depende disso, e o typecheck (`pnpm typecheck`) confirma.

---

## 6. Estratégia de testes

Seguindo `AGENTS.md` ("Bug Fix Workflow"): primeiro os testes novos, confirmados como falhando na linha de base; depois a implementação; depois a suíte ampla.

### 6.1 Arquivo novo: `test/static-range.test.ts`

Usa `describeMatrix("serve static range", ...)`, então cada caso roda em `web` e `node` (`test/_setup.ts:11`). O fixture é um asset de 1000 bytes com conteúdo previsível, `"0123456789".repeat(100)`, com `etag: '"v2"'`, `mtime` fixo e `size: 1000`. Um segundo fixture usa `Blob` para cobrir o caminho `Blob.slice`, e um terceiro usa tamanho 0.

### 6.2 Casos por requisito

| Requisito | Caso | Verificação |
|---|---|---|
| RF-01 | GET sem `Range` | 200, `accept-ranges: bytes`, corpo completo |
| RF-01 | HEAD sem `Range` | 200, `accept-ranges: bytes`, corpo vazio |
| RF-02 | `bytes=0-99` | 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo = primeiros 100 bytes |
| RF-02 | `bytes=-50` | 206, `bytes 950-999/1000`, `content-length: 50` |
| RF-02 | `bytes=990-` | 206, `bytes 990-999/1000`, `content-length: 10` |
| RF-02 | `bytes=990-2000` | 206, fim limitado a 999 |
| RF-02 | `Blob` como corpo | mesmo resultado que string |
| RF-02 | `options.headers` com `content-length: 999` | 206 com `content-length: 100` (D-08) |
| RF-03 | HEAD `bytes=500-` | 206, `bytes 500-999/1000`, `content-length: 500`, corpo vazio, `getContents` não chamado |
| RF-04 | `bytes=0-10,20-30`, `items=0-10`, `bytes=abc`, `bytes=5-2`, `bytes=-` | 200, sem `content-range`, corpo completo |
| RF-05 | `bytes=1000-1010` | 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio |
| RF-05 | `bytes=-0` | 416 |
| RF-05 | asset de tamanho 0 com `bytes=0-` | 416, `content-range: bytes */0` (D-05) |
| RF-06 | `If-Range: "v1"` | 200 completo |
| RF-06 | `If-Range: "v2"` | 206, bytes 0 a 99 |
| RF-06 | `If-Range: W/"v2"` | 200 |
| RF-06 | `If-Range` com data igual a `Last-Modified` | 206 |
| RF-06 | `If-Range` com data diferente | 200 |
| RF-07 | `If-None-Match` igual + `Range` | 304 (condicional antes de Range) |
| RF-07 | POST com `Range` | 405, sem alteração |
| RF-07 | POST com `Range` e `fallthrough: true` | cai para o próximo handler |
| RF-07 | asset inexistente com `Range` | 404 |
| RF-07 | asset inexistente com `Range` e `fallthrough` | cai para o próximo handler |
| RF-08 | lista de exportações | `test/unit/package.test.ts` continua passando sem mudança |

### 6.3 Regressão

- `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` deve continuar com 272 testes passando (linha de base).
- `pnpm vitest run test/static-range.test.ts` deve falhar antes da mudança (RF-02, RF-03, RF-05, RF-06) e passar depois.
- `pnpm test` (lint, typecheck e cobertura) é o critério final de RF-09. Os comandos isolados `pnpm lint` e `pnpm typecheck` também devem passar.

### 6.4 Ajustes em testes existentes

Nenhum teste atual envia `Range` (conferido: não há ocorrência de `range` em `test/static.test.ts`). O único teste que muda de comportamento por construção é o que confere `content-length` sem `Range`, e ele não muda. Se algo quebrar na suíte, a regra de RF-09 vale: ajustar só se a falha vier da mudança esperada.

---

## 7. Riscos

| ID | Risco | Impacto | Tratamento |
|---|---|---|---|
| R-01 | **Leitura completa para corpos que não são `Blob`.** `getContents` devolve o corpo inteiro e não recebe intervalo. Strings, `ArrayBuffer` e `ReadableStream` são lidos por completo antes do recorte (D-03). | Memória e latência em vídeo grande, com ganho de seek limitado. | Principal decisão aberta. A proposta é aceitar esse custo na primeira versão, registrar a limitação na documentação de `getContents` e abrir uma issue separada para um `getContents` que aceite intervalo. Precisa de decisão do revisor. |
| R-02 | **`Accept-Ranges` com tamanho desconhecido.** D-04 segue o PRD e anuncia `bytes` mesmo sem `size`, mas o `Range` é ignorado nesse caso. | Inconsistência semântica. Clientes podem tentar `Range` e receber 200 completo, o que é tolerado pela RFC. | Confirmar com o revisor. Se a resposta for "só com tamanho conhecido", a mudança é uma condição a mais em D-04. |
| R-03 | **Tamanho zero.** Hoje `content-length` não é definido quando `size` é 0 (`static.ts:268`). D-05 responde 416 para qualquer `Range` válido. | Comportamento novo para assets vazios com `Range`. | Confirmar. A RFC 9110 §14.1.1 sustenta a decisão. |
| R-04 | **Validador fraco e fixtures.** Os testes existentes usam `etag: "w/123"` (sem aspas, `test/static.test.ts:15` e `:35`), e `opaqueTag` só reconhece `W/` maiúsculo (`src/utils/internal/cache.ts:52`). | Um `If-Range` com `"w/123"` pode ser interpretado de forma inesperada. | Os testes novos usam ETags com aspas, como `"v2"`. Não alterar o fixture antigo. |
| R-05 | **Ordem de mesclagem de cabeçalhos.** `event.res.headers` sobrepõe o `HTTPResponse` (`src/response.ts:203`). `options.headers` pode ter `content-length` (`test/static.test.ts:600-617`). | Um `Content-Length` antigo pode vencer o do 206. | D-08: 206 e 416 usam `event.res.headers.set`. Coberto pelo caso de `options.headers` em §6.2. |
| R-06 | **Corpo `null` com 206.** Se `getContents` devolver `null` para um asset de `size > 0`, o 206 sai com corpo vazio e `content-length` maior que zero. | Resposta inconsistente. Hoje o 200 tem o mesmo problema. | Mesmo comportamento do 200. Documentar. Não é regressão. |
| R-07 | **Rules de cache.** `src/rules/cache.ts:143-148` ignora o cache para qualquer `Range`, então esses pedidos vão direto ao `serveStatic`. | Nenhum para o `serveStatic`. Pode haver pedidos sem cache para vídeo. | Fora de escopo. Não alterar `rules/cache.ts`. |
| R-08 | **Tamanho de arquivo.** `static.ts` passa de 400 linhas. `AGENTS.md` pede menos de 200 por arquivo. | Desvio de convenção. | Aceito por D-01. Se o revisor pedir, o parser pode ir para `src/utils/internal/range.ts`, que não é exportado e não fere o contrato. |
| R-09 | **Múltiplos intervalos.** Clientes que pedem vários intervalos recebem 200 completo. | Algum player pode reagir mal. | Fora de escopo (PRD). Registrado. |
| R-10 | **Sintaxe estrita.** Espaços (`bytes= 0-1`) fazem o `Range` ser ignorado. | Pedido com espaço extra recebe 200. | Aceito. A RFC permite ignorar cabeçalhos mal formados. |

---

## 8. Pendências para decisão

1. Confirmar R-01: aceitar leitura completa do corpo na primeira versão.
2. Confirmar R-02: `Accept-Ranges` mesmo sem tamanho conhecido (D-04).
3. Confirmar R-03: 416 para asset de tamanho zero (D-05).

Enquanto essas três não forem confirmadas, a implementação pode começar pelos testes de §6 e pelo caminho comum (RF-01, RF-02, RF-03, RF-04, RF-07), que não dependem delas.
