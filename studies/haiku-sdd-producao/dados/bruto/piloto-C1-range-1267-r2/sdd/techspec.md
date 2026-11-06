# Especificação técnica: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-10). Este documento decide como implementar, sem alterar código do projeto.

## Mapa do código atual

| Ponto | Arquivo | Situação hoje |
|---|---|---|
| Entrada e validação de método | `src/utils/static.ts:116-122` | GET/HEAD seguem; demais recebem 405 |
| Seleção de variante codificada | `src/utils/static.ts:198-208` | `getMeta(_id.id)` da variante escolhida; `meta.size` é o tamanho da variante |
| `Vary: accept-encoding` | `src/utils/static.ts:220-225` | Já definido quando há encodings |
| `Last-Modified` e `ETag` | `src/utils/static.ts:228-241` | Definidos antes do 304 |
| 304 condicional | `src/utils/static.ts:243-248` | `isCacheMatch` (weak comparison) antes de qualquer lógica de Range |
| `Content-Type` / `Content-Encoding` | `src/utils/static.ts:250-266` | Definidos só se ausentes |
| `Content-Length` | `src/utils/static.ts:268-270` | `meta.size` se `> 0` e ainda não definido |
| HEAD | `src/utils/static.ts:272-274` | Retorna 200 sem corpo |
| GET | `src/utils/static.ts:276-277` | `getContents(id)` e 200 com o corpo inteiro |
| Assinatura de `getContents` | `src/utils/static.ts:33` | `(id) => BodyInit \| null \| undefined`, sem parâmetro de intervalo |
| Tamanho em `StaticAssetMeta` | `src/utils/static.ts:13` | `size?: number` |
| Exportações públicas | `src/index.ts:193` | Só `serveStatic` e tipos; não muda |
| Snapshot de exportações | `test/unit/package.test.ts:4-6` | Guarda o RF-10 |
| Bypass de Range no cache de rota | `src/rules/cache.ts:146-149` | Requisição com `range` já é ignorada pelo cache ocache; nada a mudar |
| Helper de ETag existente | `src/utils/internal/cache.ts:11-17` | `matchETag` usa comparação fraca; não serve para If-Range |
| Resposta com cabeçalhos mesclados | `src/response.ts:96-106`, `src/response.ts:195-205` | `HTTPResponse` sem `status` herda `event.res.status`; cabeçalhos de `event.res` são mesclados na resposta |

Observação: `src/utils/static.ts` tem 352 linhas, acima do limite de 200 linhas do `AGENTS.md`. Isso já é um desvio atual.

---

## Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Escolha:** criar `src/utils/internal/range.ts` (novo arquivo interno, sem reexportação em `src/index.ts`) com o parser de `Range`, a avaliação de `If-Range`, a comparação forte de ETag e o fatiamento do corpo. `src/utils/static.ts` chama essas funções em um bloco novo entre os cabeçalhos de representação e o `getContents`.

**Alternativas consideradas:**
- Colocar tudo dentro de `src/utils/static.ts`. Respeita a letra de "helpers sem `export`", mas adiciona cerca de 120 linhas a um arquivo que já passa do limite de 200 linhas.
- Criar `range.ts` com `export` das funções auxiliares. Conflita com a frase "sem `export`" do contrato, mas não com RF-10 (que trata de `src/index.ts`). Como o arquivo está em `utils/internal/`, que não é reexportado, não há superfície pública nova.

**Justificativa:** o PRD (`sdd/prd.md`, seção Riscos, último item) manda mover os auxiliares para `utils/internal/` quando o limite for ultrapassado. A alternativa escolhida mantém `static.ts` menor e preserva RF-10. O conflito com "sem `export`" é de redação: a intenção é não criar API pública, e isso é atendido. Ponto a confirmar com o autor do contrato.

**Contrato do módulo:** ver seção "Contratos e assinaturas".

### D-02 — Ordem de avaliação: 304, depois Range, depois corpo

**Escolha:**
1. Cabeçalhos de validação (`ETag`, `Last-Modified`) e `Accept-Ranges` são definidos como hoje.
2. O 304 por `If-None-Match`/`If-Modified-Since` (`src/utils/static.ts:243-248`) continua antes de qualquer lógica de Range. Um pedido condicional que casa com o ETag recebe 304 mesmo com `Range`.
3. Depois dos cabeçalhos de representação e do `Content-Length` (`src/utils/static.ts:268-270`), avalia-se o Range com `resolveRange`.
4. Para `416`, o `getContents` não é chamado. Para `206` ou `200` em HEAD, o `getContents` também não é chamado. Só o GET com 206 ou 200 lê o corpo.

**Alternativas consideradas:** avaliar Range antes do 304. Rejeitada: a RFC 9110 seção 13.2.2 põe as pré-condições condicionais antes do Range, e o PRD (RF-09) exige 304 com ETag igual.

**Justificativa:** mantém o comportamento atual dos 304 intacto e evita leitura de conteúdo quando a resposta não tem corpo.

### D-03 — `Accept-Ranges` em todo asset encontrado

**Escolha:** `event.res.headers.set("accept-ranges", "bytes")` logo após `etag` (depois de `src/utils/static.ts:241`) e antes do 304. Usa `if (!has)` para respeitar um valor vindo de `options.headers`, como os outros cabeçalhos.

**Alternativas consideradas:** anunciar só em 200/206. Rejeitada porque o contrato (`sdd/pedido.md`, item 1) diz "toda resposta que serve um asset encontrado", e a RFC permite o cabeçalho em 304.

**Justificativa:** segue o contrato. Ver risco R-02 para o caso de tamanho desconhecido.

### D-04 — Interpretação do cabeçalho `Range`

**Escolha:** `resolveRange(headers, { size, etag, lastModified })` devolve `full`, `partial` ou `unsatisfiable`.

Regras:
- Sem cabeçalho `Range`: `full`.
- Unidade: prefixo `bytes=` sem diferenciar maiúsculas (a RFC 9110 seção 14.1 diz que a unidade é case-insensitive). Qualquer outra unidade: `full`.
- Sintaxe aceita: uma única especificação, por regex do tipo `^\s*(\d*)\s*-\s*(\d*)\s*$` após `bytes=`. Vírgula (multi-range), espaço interno, sinais, decimais e os dois campos vazios: `full`.
- `bytes=a-b` com `a > b`: `full`.
- `bytes=-n`: se `n = 0`, `unsatisfiable`. Se `n > 0`, `start = max(0, size - n)`, `end = size - 1`.
- `bytes=a-` ou `bytes=a-b`: se `a >= size`, `unsatisfiable`. Senão `end = min(b ?? size - 1, size - 1)`.
- Números além de `Number.MAX_SAFE_INTEGER`: tratados como malformados (`full`).
- Tamanho desconhecido, não inteiro positivo (`size` undefined, 0 ou negativo): `full`, Range ignorado. Ver D-08 e R-03.
- `If-Range` avaliado antes de tudo, só quando há `Range` (ver D-05).

**Alternativas consideradas:** usar `Number()` ou `parseInt` sem regex. Rejeitada: aceitaria `1e3`, `0x10` e espaços em lugares errados.

**Justificativa:** cobre RF-02 a RF-05 e os casos de borda que o PRD pede para confirmar (sufixo 0, sufixo maior que o arquivo, 304 com Range).

### D-05 — `If-Range`

**Escolha:**
- Se o `If-Range` começa com `"` ou `W/"`, é entity-tag. Comparação forte: `W/` em qualquer lado nunca casa, e o ETag do asset precisa ser igual, caractere a caractere, ao valor do cabeçalho. Se não casar, `full`.
- Se não é entity-tag, tenta interpretar como HTTP-date. Proposta: casa só se a data for igual a `lastModified` (o `Date` já truncado em segundos, `src/utils/static.ts:228-233`). Se o asset não tem `lastModified`, ou a data não é parseável, `full`. **Decisão pendente:** o PRD (`sdd/prd.md` item de riscos sobre If-Range com data) pede que se escolha entre ignorar o Range e comparar com `Last-Modified`. Esta especificação propõe comparar com igualdade exata, que é o que a RFC 9110 seção 13.1.5 permite para validador de data forte.
- Se o asset não tem validador algum (`etag` e `lastModified` ausentes): `full`.

**Alternativas consideradas:**
- Reusar `matchETag` de `src/utils/internal/cache.ts:11-17`. Rejeitada: é comparação fraca (ignora `W/`), e o contrato exige comparação forte.
- Ignorar sempre `If-Range` com data. Simples, porém mais conservador do que a RFC.

**Justificativa:** segue RF-08 e a regra de comparação forte. A opção de data fica registrada como risco R-01.

### D-06 — Fatiamento do corpo sem mudar a assinatura de `getContents`

**Escolha:** `sliceBody(body, start, end)` no módulo interno, com retorno `Promise<BodyInit | null>`:
- `null` ou `undefined`: `null`.
- `string`: codifica com `TextEncoder` e fatia o `Uint8Array` (o tamanho do contrato é em bytes, não em caracteres).
- `ArrayBuffer`: `slice(start, end + 1)`.
- `ArrayBuffer.isView(body)`: `new Uint8Array(body.buffer, body.byteOffset + start, end - start + 1)`, respeitando `byteOffset`.
- `Blob`: `body.slice(start, end + 1)`, que é preguiçoso e não carrega o arquivo inteiro.
- `ReadableStream`: `pipeThrough` com um `TransformStream` que descarta bytes até `start` e emite até `end`, cancelando a origem ao terminar.
- Demais tipos (`FormData`, `URLSearchParams`): `new Response(body).arrayBuffer()` e fatia o resultado. Caso raro, aceito como custo.

**Alternativas consideradas:**
- Passar o intervalo para `getContents(id, range)`. Rejeitada: muda a assinatura pública de `ServeStaticOptions.getContents` (`src/utils/static.ts:33`), o que vai contra "nenhuma opção ou API nova" do PRD e quebraria implementações existentes em ambientes que não conhecem o parâmetro.
- Ler o corpo inteiro sempre e fatiar. Rejeitada: custo de memória alto para vídeo e áudio, que é o caso de uso principal.

**Justificativa:** mantém a API, evita buffer para os tipos mais comuns (Blob, stream) e trata a codificação UTF-8 corretamente.

### D-07 — Cabeçalhos de `206` e `416`

**Escolha:**
- `206`: `content-range: bytes <start>-<end>/<size>`, `content-length: <end - start + 1>`. Usa `set`, não `if (!has)`, porque o valor precisa ser o do trecho. Isso sobrescreve um `content-length` vindo de `options.headers`, apenas nas respostas com Range (a regra atual de `src/utils/static.ts:268-270` continua valendo para 200).
- `416`: `content-range: bytes */<size>`, `content-length: 0`, corpo `null`, `statusText` "Range Not Satisfiable".
- Demais cabeçalhos de cache e conteúdo: os mesmos da resposta completa, pois já estão definidos antes do bloco de Range.

**Alternativas consideradas:** respeitar um `content-length` externo também em 206. Rejeitada: deixaria a resposta com tamanho inconsistente com o corpo.

### D-08 — Tamanho zero e tamanho desconhecido

**Escolha:** só se aplica Range quando `meta.size > 0` e inteiro. Com `size` ausente ou `0`, o Range é ignorado e a resposta é 200 completa.

**Alternativas consideradas:** para `size = 0`, responder 416 com `bytes */0`, como manda a norma para representação vazia. Rejeitada por enquanto: a condição existente `meta.size > 0` (`src/utils/static.ts:268`) já trata `0` como "desconhecido", e manter a mesma regra evita divergência. Ver R-03.

### D-09 — Variantes codificadas (RF-07)

**Escolha:** nenhuma mudança na seleção. `meta` já é o de `_id.id`, que é a variante escolhida (`src/utils/static.ts:198-208`), então `meta.size` é o tamanho da variante e o Range se aplica a ela. `Content-Encoding` continua vindo de `meta.encoding` (`src/utils/static.ts:264-266`).

**Alternativas consideradas:** calcular o tamanho a partir do asset original. Rejeitada: o tamanho enviado é o da variante.

### D-10 — HEAD

**Escolha:** HEAD usa exatamente o mesmo cálculo de `resolveRange` e devolve status e cabeçalhos iguais ao GET, com corpo `null`. A diferença de GET é só a chamada a `getContents`. Isso substitui o retorno atual de `src/utils/static.ts:272-274` por um retorno que usa o status calculado.

---

## Contratos e assinaturas

Arquivo novo `src/utils/internal/range.ts` (não exportado por `src/index.ts`). Retornos explícitos, por causa de `isolatedDeclarations`.

```ts
export type RangeResult =
  | { type: "full" }
  | { type: "partial"; start: number; end: number; size: number }
  | { type: "unsatisfiable"; size: number };

export function resolveRange(
  headers: Headers,
  validators: { size: number | undefined; etag?: string; lastModified?: Date },
): RangeResult;

export function sliceBody(
  body: BodyInit | null | undefined,
  start: number,
  end: number,
): Promise<BodyInit | null>;
```

Auxiliares privados dentro de `range.ts` (sem `export`): `parseRangeHeader`, `ifRangeMatches`, `strongETagEquals`, `sliceStream`.

Mudança em `src/utils/static.ts` (sem mudança na assinatura de `serveStatic` nem de `ServeStaticOptions`):
- após `src/utils/static.ts:241`: definir `accept-ranges` se ausente;
- substituir `src/utils/static.ts:272-277` pela sequência: calcular `range`; se `unsatisfiable`, retornar 416; se `partial`, definir `content-range` e `content-length` e retornar 206 (com corpo se GET); se `full`, manter o retorno atual.

Esboço do bloco (para orientar a implementação, não é código final):

```ts
const range = resolveRange(event.req.headers, {
  size: meta.size,
  etag: meta.etag,
  lastModified: mtimeDate,
});
if (range.type === "unsatisfiable") {
  event.res.headers.set("content-range", `bytes */${range.size}`);
  event.res.headers.set("content-length", "0");
  return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
}
if (range.type === "partial") {
  event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${range.size}`);
  event.res.headers.set("content-length", String(range.end - range.start + 1));
  if (event.req.method === "HEAD") return new HTTPResponse(null, { status: 206 });
  const contents = await options.getContents(id);
  return new HTTPResponse(await sliceBody(contents, range.start, range.end), { status: 206 });
}
// full: comportamento atual
```

Nota: `HTTPResponse` sem `status` herda `event.res.status`; por isso `status` é passado explicitamente nos retornos parciais.

---

## Estratégia de testes

Seguindo o fluxo de correção do `AGENTS.md` (teste que falha antes da mudança), e a suíte `describeMatrix` (web e node).

1. **Linha de base.** Rodar `pnpm vitest run test/static.test.ts test/unit` antes de editar, para registrar o estado atual.
2. **Testes novos em `test/static.test.ts`**, num `describeMatrix("serve static range", ...)` acrescentado após a linha 678. Fixture com `getContents` que devolve `Uint8Array` de 1000 bytes (valor `i % 256`), para verificar bytes exatos, e `getMeta` com `size: 1000`, `etag` entre aspas (`"abc"`) e `mtime` fixo.
   - RF-01: `Accept-Ranges: bytes` em GET sem Range, em 304 e em HEAD.
   - RF-02: `bytes=100-199`, `bytes=900-`, `bytes=-50` produzem 100-199, 900-999, 950-999.
   - RF-03: `bytes=990-2000` gera 206, `Content-Range: bytes 990-999/1000`, corpo de 10 bytes.
   - RF-04: `bytes=1000-1100` gera 416, `Content-Range: bytes */1000`, `Content-Length: 0`, corpo vazio.
   - Bordas: `bytes=-0` gera 416; `bytes=-5000` gera `0-999`; `bytes=0-` gera 206 com o arquivo inteiro.
   - RF-05: `bytes=0-1,5-9`, `items=0-1`, `bytes=9-3`, `bytes=abc`, `bytes=-` e `BYTES=0-1` (caso-insensível, deve virar 206) — os malformados geram 200 sem `Content-Range`.
   - RF-06: HEAD com Range devolve 206 com os mesmos cabeçalhos do GET com o mesmo Range, sem corpo; o `getContents` não é chamado.
   - RF-07: `.gz` de 300 bytes com `accept-encoding: gzip` e `bytes=0-99` gera 206, `Content-Range: bytes 0-99/300`, `Content-Encoding: gzip`, `Content-Length: 100`.
   - RF-08: `If-Range: "abc"` casa e gera 206; `If-Range: "xyz"` gera 200; `If-Range: W/"abc"` gera 200; `If-Range` com data igual a `Last-Modified` gera 206 e com data diferente gera 200; asset sem validador gera 200.
   - RF-09: `If-None-Match` casando com Range gera 304; `ETag`, `Cache-Control`, `Vary` do 206 iguais aos do 200; POST gera 405; asset inexistente com Range gera 404; com `fallthrough` passa adiante.
   - Corpo: string com caracteres multibyte (`"é"`), Blob, ReadableStream que chega em pedaços que cruzam o intervalo, `Uint8Array` com `byteOffset` diferente de zero.
   - D-08: `size: 0` e `size` ausente ignoram o Range (200).
3. **Unitários em `test/unit/range.test.ts`** (novo), tabela de entrada e saída de `resolveRange` cobrindo as regras de D-04 e D-05, sem depender do servidor.
4. **Regressão.** Os testes existentes em `test/static.test.ts` continuam passando sem alteração. Em especial: "Can serve asset (GET)" (`test/static.test.ts:42-55`), o teste de `content-length` (`test/static.test.ts:600-617`) e o de guarda de caminho (`test/static.test.ts:328-352`).
5. **Exportações.** `test/unit/package.test.ts:4-6` deve passar sem atualizar o snapshot (prova do RF-10).
6. **Qualidade.** `pnpm lint` (oxlint, oxfmt e typecheck), depois `pnpm test` completo.

Cuidado nos testes: a fixture atual de `test/static.test.ts:5-31` usa ETag sem aspas (`w/123`). Para testar If-Range, usar ETags com aspas duplas, como a RFC exige.

---

## Riscos

- **R-01 — If-Range com data.** O contrato trata só entity-tag. Esta especificação propõe comparação de igualdade com o `Last-Modified` emitido (D-05). Precisa de confirmação antes de implementar. Alternativa conservadora: ignorar If-Range com data (200 completo).
- **R-02 — `Accept-Ranges` sem tamanho conhecido.** O contrato (item 1) manda anunciar em toda resposta, mas o Range é ignorado quando o tamanho é desconhecido (fora de escopo, PRD). Anunciar `bytes` nesses casos pode induzir o cliente a pedir Range que não será atendido. Confirmar se deve anunciar só quando `size > 0`.
- **R-03 — Tamanho zero.** A norma daria 416 para arquivo vazio; esta especificação dá 200 (D-08), por consistência com `meta.size > 0`. Confirmar.
- **R-04 — Corpo `null` em resposta parcial.** Se `getContents` devolver `null` ou `undefined` para um asset com `meta.size > 0`, a resposta 206 terá `Content-Length` sem corpo. O 200 atual já tem essa inconsistência. Decisão sugerida: manter o mesmo comportamento, sem tratamento especial, e registrar.
- **R-05 — `content-length` vindo de `options.headers`.** Em 206 e 416 ele é sobrescrito (D-07). Isso muda o comportamento de quem configura esse cabeçalho e pede Range. Caso raro, mas deve estar documentado no código.
- **R-06 — Memória para `FormData`, `URLSearchParams` e similares.** Caem no fallback com `Response.arrayBuffer()` (D-06). Não são tipos esperados de `getContents` para arquivos, então o impacto é pequeno.
- **R-07 — Tamanho acima de `Number.MAX_SAFE_INTEGER`.** Tratado como malformado (D-04). Sem risco prático, mas precisa de teste.
- **R-08 — Limite de linhas.** `src/utils/static.ts` já tem 352 linhas. A mudança adiciona cerca de 25 linhas nele e o restante em `range.ts`, que deve ficar abaixo de 200 linhas. O desvio pré-existente não é corrigido aqui.
- **R-09 — Cache de rota.** `src/rules/cache.ts:146-149` já ignora Range no cache ocache. Nenhuma mudança é necessária, mas vale um teste de integração se houver regra de cache sobre `serveStatic`.
- **R-10 — Regressão de 304 e fallthrough.** Mudanças na ordem dos blocos podem afetar o 304 e o `fallthrough`. Mitigado por D-02 e pelos testes de regressão do item 4 acima.

---

## Arquivos a alterar

- `src/utils/static.ts`: inserir `accept-ranges` após `src/utils/static.ts:241`; substituir `src/utils/static.ts:272-277` pelo bloco de Range (ver "Contratos e assinaturas"); importar as funções de `./internal/range.ts`. Sem mudança em `ServeStaticOptions`, `StaticAssetMeta` ou `serveStatic`.
- `src/utils/internal/range.ts`: arquivo novo com `resolveRange`, `sliceBody` e auxiliares privados.
- `test/static.test.ts`: novo `describeMatrix` após a linha 678.
- `test/unit/range.test.ts`: arquivo novo com testes unitários de `resolveRange`.
- Sem alteração: `src/index.ts` (confirmar que `test/unit/package.test.ts` continua passando), `src/utils/internal/cache.ts`, `src/rules/cache.ts`, `src/response.ts`.
