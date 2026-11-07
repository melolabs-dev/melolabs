# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-13). Este documento não repete os requisitos; define como implementá-los no código atual.

Referências de código conferidas na leitura desta versão do repositório (`master`, commit `8682f1d`).

## Visão geral

Toda a mudança fica em `src/utils/static.ts`, dentro de `serveStatic`, depois da seleção do asset e da avaliação de `304`. Os auxiliares são funções privadas no fim do mesmo arquivo. Não há mudança em `src/index.ts`, em `ServeStaticOptions`, em `StaticAssetMeta` nem em `getContents`.

Fluxo resultante para `GET`/`HEAD` com um asset encontrado:

1. Cabeçalhos de `options.headers`, check de método (405), check de caminho canônico, busca do asset (inalterados).
2. `Vary`, `last-modified`, `etag` (inalterados).
3. Avaliação de `304` (inalterada, anterior ao `Range`, RF-08).
4. `content-type` e `content-encoding` (inalterados).
5. **Novo:** `accept-ranges`, decisão de `Range` (ignorado, 416 ou 206).
6. Caminho atual: `content-length` do tamanho completo, `HEAD` → 200, `getContents` → 200 (inalterado).

## Decisões de arquitetura

### D-01 — Auxiliares ficam em `static.ts`, não em `utils/internal/`

**Alternativas**
- (a) Colocar o parser de `Range`, a comparação de `If-Range` e o recorte em `src/utils/internal/range.ts`.
- (b) Colocar tudo no fim de `src/utils/static.ts`.

**Escolha: (b).** O pedido (`sdd/pedido.md`, "Restrições") e o PRD (RF-10) exigem que os auxiliares sejam privados ao módulo `static.ts`. O `AGENTS.md` permite "helpers no fim do arquivo ou em `utils/internal/`", então (b) está dentro da convenção. Custo aceito: o arquivo passa de 352 para cerca de 440 linhas, acima da meta de "< 200 LoC" do `AGENTS.md`. Se o time preferir a divisão, a alternativa (a) não expõe nada publicamente e pode ser feita depois sem mudar a API.

### D-02 — `Range` é avaliado depois do `304` e antes de `content-length`

**Alternativas**
- (a) Avaliar `Range` antes da checagem de cache.
- (b) Avaliar `Range` depois do `304`, no ponto onde hoje se define `content-length` (`static.ts:268-270`).

**Escolha: (b).** Com (a), um cliente com cache que envia `If-None-Match` e `Range` receberia `206` em vez de `304`, o que é a regressão descrita em `prd.md` ("Riscos"). Com (b), o `304` continua idêntico ao atual e o `Range` só é considerado para respostas `200` candidatas. O bloco atual de `content-length` (`static.ts:268-270`) passa a ser executado só quando não há `Range` aplicável, porque a decisão de `Range` precisa acontecer antes dele.

### D-03 — `Content-Length` e `Content-Range` de `206`/`416` sobrescrevem valores existentes

**Alternativas**
- (a) Respeitar `content-length` já definido (como hoje, `static.ts:268`), o que mantém um valor de `options.headers` para um corpo parcial.
- (b) Sobrescrever com `set` apenas quando a resposta é `206` ou `416`.

**Escolha: (b).** Um `Content-Length` de 999 com um corpo de 100 bytes quebra o enquadramento HTTP. Para `200`, o comportamento atual é mantido, incluindo o teste de `test/static.test.ts:600-617`. Isso também vale para `content-range`: se `options.headers` trouxer esse cabeçalho, ele é substituído nas respostas `206`/`416`.

Observação sobre a ordem de merge: em `src/response.ts:201-204` (e `:224-228`), os cabeçalhos preparados em `event.res` sobrescrevem os da `HTTPResponse` retornada. Por isso `content-length`, `content-range` e `accept-ranges` são gravados em `event.res.headers` e não só na `HTTPResponse`.

### D-04 — Interpretação do `Range`: parser próprio, uma única regra por intervalo

**Alternativas**
- (a) Adicionar uma dependência (`range-parser`).
- (b) Parser próprio privado, com regex.

**Escolha: (b).** O projeto declara "2 dependências de produção" (`AGENTS.md`, "Core Design"). A sintaxe necessária é pequena. Regras:

- Unidade `bytes`, sem diferenciar maiúsculas (RFC 9110 §14.1).
- Um único intervalo. Qualquer vírgula faz o cabeçalho ser ignorado (RF-03).
- Formas aceitas: `a-b`, `a-`, `-N`. `-` sem números é inválido e é ignorado.
- `a > b` é inválido e é ignorado (RF-03).
- `a >= size` é `416` (RF-06).
- `-0` é `416` (RFC 9110 §14.1.1, sufixo de zero bytes não satisfazível).
- `b >= size` é limitado a `size - 1` (RFC 9110 §14.1.2).
- `-N` com `N > size` vale o arquivo inteiro (`start = 0`).
- Sem `end` (`a-`) vale `size - 1`.
- Espaços em volta do valor são removidos antes da análise; espaços dentro da especificação não são aceitos (ignorado).

### D-05 — `If-Range`: ETag forte ou data exata

**Alternativas**
- (a) Ignorar `If-Range` e sempre aplicar o `Range`.
- (b) Comparar com o validador atual (RFC 9110 §13.1.5).

**Escolha: (b).**
- Ausente: o `Range` é aplicado.
- Valor que começa com `"` ou `W/`: é um entity-tag. Só casa se for forte (sem `W/`, no validador e no cabeçalho) e igual a `meta.etag`. Um `ETag` fraco nunca casa (premissa do PRD).
- Qualquer outro valor: é tratado como HTTP-date. Casa se `new Date(valor).getTime()` for igual ao `mtimeDate` (já truncado para segundos em `static.ts:232`). Sem `mtime`, não casa.
- Não casou: o `Range` é ignorado e a resposta é `200` completa (RF-07).

### D-06 — Recorte do corpo feito no `serveStatic`, com `Blob`

**Alternativas**
- (a) Mudar `getContents` para receber o intervalo. Fora de escopo (PRD, "Fora de escopo"): muda API pública.
- (b) Converter o corpo para `Blob` e fatiar com `Blob.slice`.
- (c) Trabalhar só com `ArrayBuffer` ou `Uint8Array`.

**Escolha: (b).** `BodyInit` inclui `string`, `Blob`, `FormData`, `URLSearchParams`, `ReadableStream`, e (c) não cobre todos. A conversão usa `Response` do runtime, que já aceita todos esses tipos:

- Se o corpo já é `Blob`, `slice` é preguiçoso e não copia dados.
- Caso contrário, `await new Response(contents).blob()` materializa o corpo uma vez, e depois `slice`.

Isso só acontece para pedidos `206` do método `GET`. Pedidos `HEAD` não leem o corpo (D-07).

### D-07 — `HEAD` com intervalo válido responde só com cabeçalhos

`getContents` não é chamado em `HEAD`, como hoje (`static.ts:272-274`). `Content-Range` e `Content-Length` vêm do `size` de `getMeta`, e o corpo é `null`.

### D-08 — `416` sem chamar `getContents`

A resposta é `new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" })`, com `content-range: bytes */<size>` e `content-length: 0`, gravados em `event.res.headers` (D-03). Vale para `GET` e `HEAD`.

### D-09 — `Accept-Ranges` e tamanho desconhecido

- `accept-ranges: bytes` é gravado quando `meta.size > 0`, junto com a decisão de `Range` (RF-01, RF-12).
- Como a gravação fica depois do `304` (D-02), a resposta `304` não recebe `Accept-Ranges`. Isso mantém a resposta `304` idêntica à de hoje (RF-09). A RFC permite os dois, então é só uma escolha de preservação.
- `meta.size` ausente ou `0`: o `Range` é ignorado e não há `Accept-Ranges` (RF-12).

### D-10 — Tamanho do corpo diferente de `meta.size`: falhar com 500

**Alternativas**
- (a) Confiar em `meta.size` e não verificar. Resultado: `206` com `Content-Length` diferente dos bytes enviados.
- (b) Verificar `blob.size === meta.size` antes de fatiar e lançar `HTTPError` com `status: 500` se não bater.
- (c) Cair para `200` completo. Não é viável para corpos em stream, que já foram consumidos.

**Escolha: (b).** O `serveStatic` não consegue saber o tamanho sem ler o corpo, mas quando o corpo foi lido para o `Range` a verificação é barata. Falhar alto é preferível a enviar enquadramento inválido. Isso também pega o caso de string com caracteres não ASCII: `meta.size` costuma ser contado em bytes, mas `new Response(string)` codifica em UTF-8, então o tamanho real depende do conteúdo. Ver "Riscos".

Ponto em aberto para o time: se preferir a alternativa (a), a mudança é remover a verificação em `sliceBody`.

## Contratos e assinaturas

Nenhuma assinatura pública muda. Os tipos abaixo são privados ao módulo.

```ts
// static.ts, no bloco "// --- Internal Utils ---" (static.ts:280), depois de parseAcceptEncoding e normalizeCoding.

/** Intervalo inclusivo, já limitado ao tamanho do asset. */
interface ByteRange {
  start: number;
  end: number;
}

/**
 * `undefined` quando o Range deve ser ignorado (sem cabeçalho, If-Range não casa, sintaxe inválida).
 * `"unsatisfiable"` quando deve responder 416.
 */
function resolveRange(
  headers: Headers,
  size: number,
  validators: { etag?: string; lastModified?: Date },
): ByteRange | "unsatisfiable" | undefined;

/** Análise de um único intervalo `bytes=...`. Mesmo retorno que `resolveRange`, sem If-Range. */
function parseRange(value: string, size: number): ByteRange | "unsatisfiable" | undefined;

/** Avalia `If-Range` contra o validador atual (D-05). */
function matchesIfRange(
  ifRange: string,
  validators: { etag?: string; lastModified?: Date },
): boolean;

/**
 * Lê o corpo, confere o tamanho com `size` (D-10) e devolve só o intervalo.
 * Lança HTTPError 500 quando o tamanho não bate.
 */
async function sliceBody(
  contents: BodyInit | null | undefined,
  range: ByteRange,
  size: number,
): Promise<Blob>;
```

Bloco novo em `serveStatic`, substituindo `static.ts:268-277` (a versão completa com o `content-length` do caminho normal):

```ts
  const size = meta.size ?? 0;
  if (size > 0) {
    event.res.headers.set("accept-ranges", "bytes");
  }

  const range =
    size > 0
      ? resolveRange(event.req.headers, size, { etag: meta.etag, lastModified: mtimeDate })
      : undefined;

  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416, statusText: "Range Not Satisfiable" });
  }

  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    event.res.headers.set("content-length", `${range.end - range.start + 1}`);
    const body =
      event.req.method === "HEAD"
        ? null
        : await sliceBody(await options.getContents(id), range, size);
    return new HTTPResponse(body, { status: 206, statusText: "Partial Content" });
  }

  if (meta.size !== undefined && meta.size > 0 && !event.res.headers.get("content-length")) {
    event.res.headers.set("content-length", meta.size + "");
  }

  if (event.req.method === "HEAD") {
    return new HTTPResponse(null, { status: 200 });
  }

  const contents = await options.getContents(id);
  return new HTTPResponse(contents || null, { status: 200 });
```

Pontos de atenção na implementação:

- `mtimeDate` existe apenas quando `meta.mtime` está definido (`static.ts:227-237`). Já é `undefined` nesse caso, e `resolveRange` aceita isso.
- `meta.etag` é usado sem normalização. O validador deve ser exatamente o que o `serveStatic` já expõe em `etag` (`static.ts:239-241`).
- `statusText` é passado explicitamente, como na resposta `304` atual (`static.ts:246`).

## Arquivos a alterar

| Arquivo | Mudança | Referência |
| --- | --- | --- |
| `src/utils/static.ts` | Bloco novo de `Range` após o `304`; substituir o `content-length` e o retorno final pelo bloco da seção acima; auxiliares no fim do arquivo | Inserção depois de `static.ts:248` (fim do `304`); substituição de `static.ts:268-277`; auxiliares após `static.ts:351` (fim de `idSearchPaths`) |
| `test/static-range.test.ts` | Arquivo novo com os testes de regressão (ver "Estratégia de testes") | Novo |

Arquivos verificados e **sem mudança**:

| Arquivo | Motivo |
| --- | --- |
| `src/index.ts` | Só reexporta `serveStatic`, `ServeStaticOptions`, `StaticAssetMeta` (`src/index.ts:193`). RF-10. |
| `src/utils/static.ts:9-15` (`StaticAssetMeta`) e `:17-66` (`ServeStaticOptions`) | RF-11: nenhum campo novo. |
| `src/utils/static.ts:101-104` (assinatura de `serveStatic`) | Mantida. |
| `src/utils/internal/cache.ts:11-49` (`matchETag`, `isCacheMatch`) | Não usado para `If-Range`, porque `If-Range` tem regra própria (D-05). |
| `src/response.ts:96-106` (`HTTPResponse`) | Usado como está. |
| `src/rules/cache.ts:143-148` (`isBypassedRequest`) | Já ignora requisições com `Range` no cache de `h3/rules/cache`. Sem mudança; um `206` não é armazenado. |
| `test/static.test.ts` | Sem mudança prevista: nenhum teste existente envia `Range` a `serveStatic`. Ver "Estratégia de testes". |
| `test/unit/package.test.ts:5` e `:133` | Já verifica a lista de exportações de `src/_entries/generic.ts`. Serve como guarda de RF-10 sem alteração. |
| `package.json:46` (`lint`) e `:54` (`typecheck`) | Os scripts existem. Confirma a premissa do PRD. |

## Estratégia de testes

Seguir o fluxo do `AGENTS.md` ("Bug Fix Workflow"): escrever os testes antes da mudança e confirmar que falham.

### Arquivo novo: `test/static-range.test.ts`

Por que um arquivo novo: `test/static.test.ts` tem cerca de 650 linhas e os testes existentes não cobrem `Range`. Um arquivo separado evita mexer em testes que já passam. Estrutura:

- `describeMatrix("serve static range", ...)` (modos `web` e `node`, `test/_setup.ts:11-38`).
- Asset de 1000 bytes com conteúdo previsível, por exemplo `"abcdefghijklmnopqrstuvwxyz".repeat(...)` cortado em 1000. Tudo ASCII, para o tamanho em caracteres bater com bytes.
- `getMeta` retorna `{ type: "text/plain", etag: '"abc"', mtime: 1_700_000_000_000, size: 1000 }`.
- Um `t.app.all("/range/**", ...)` com `serveStatic`, no mesmo padrão de `test/static.test.ts:28-30`.

Casos, por requisito:

| Caso | Requisito |
| --- | --- |
| `GET` sem `Range` → 200 com `accept-ranges: bytes` | RF-01 |
| `HEAD` sem `Range` → 200 com `accept-ranges: bytes`, sem corpo | RF-01 |
| `bytes=100-199` → 206, corpo com 100 bytes do 100 ao 199 | RF-02, RF-04 |
| `bytes=900-` → 206, últimos 100 bytes | RF-02 |
| `bytes=-100` → 206, últimos 100 bytes | RF-02 |
| `bytes=0-1,4-5`, `bytes=abc`, `bytes=199-100`, `items=0-1` → 200 completo, sem `content-range` | RF-03 |
| 206: `content-range: bytes 100-199/1000` e `content-length: 100` | RF-04 |
| `HEAD` com `bytes=100-199` → 206, sem corpo, mesmos cabeçalhos do `GET` | RF-05 |
| `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0` | RF-06 |
| `HEAD` com `bytes=1000-1100` → 416 | RF-06 |
| `bytes=-0` → 416 | RF-06 (D-04) |
| `bytes=0-99999` → 206, `bytes 0-999/1000` (limitado) | D-04 |
| `bytes=-5000` → 206, arquivo inteiro | D-04 |
| `If-Range: "xyz"` → 200 completo | RF-07 |
| `If-Range: "abc"` → 206, bytes 0 a 9 | RF-07 |
| `If-Range: W/"abc"` → 200 (ETag fraco nunca casa) | RF-07, D-05 |
| `If-Range` com data igual a `last-modified` → 206; data diferente → 200 | D-05 |
| `If-None-Match: "abc"` + `Range` → 304 sem corpo | RF-08 |
| Asset sem `size` em `getMeta` + `Range` → 200 completo, sem `accept-ranges` | RF-12 |
| `options.headers: { "content-length": "999" }` + `Range` → 206 com `content-length` correto | D-03 |
| `getContents` devolve `ReadableStream`, `Blob` e `string` → o recorte é igual nos três | D-06 |
| Precomprimido: `accept-encoding: gzip` com `.gz` de tamanho diferente → `Range` sobre o arquivo `.gz`, `content-encoding` presente | Premissa do PRD |
| `getContents` devolve corpo com tamanho diferente de `meta.size` → 500 | D-10 |
| Asset inexistente + `Range` com `fallthrough: true` → passa para o próximo handler | RF-09 |
| `POST` com `Range` → 405 com `allow: GET, HEAD` | RF-09 |

### Testes existentes

- `test/static.test.ts` (todos os `describeMatrix` e o bloco de URL malformada, `:5`, `:396`, `:525`, `:626`): nenhum envia `Range`. Devem passar sem alteração.
- `test/static.test.ts:600-617` (`content-length` definido pelo usuário em `HEAD` sem `Range`): deve continuar valendo 999. D-03 só muda o caminho com `Range`.
- `test/unit/package.test.ts`: confirma RF-10 (lista de exportações igual).

Ajustar um teste existente só se ele falhar por causa de uma regra deliberada desta mudança. Até agora, nenhum precisa de ajuste.

### Comandos de verificação

```bash
pnpm vitest run test/static-range.test.ts     # antes da mudança: falhas esperadas nos casos de Range
pnpm vitest run test/static.test.ts test/unit/package.test.ts
pnpm typecheck
pnpm lint
pnpm vitest run                               # suíte completa
pnpm build && pnpm vitest run test/dist.test.ts   # opcional: confirma o bundle
```

## Riscos

1. **Memória com corpos não `Blob`.** Strings, streams e `FormData` são materializados inteiros para o recorte. Para arquivos grandes, isso é caro. Mitigação: `getContents` aceitar intervalo, proposta separada (PRD, "Fora de escopo"). Para `Blob`, o recorte é preguiçoso.
2. **`meta.size` diferente do conteúdo real.** Coberto por D-10: falha com 500 em vez de enviar enquadramento inválido. Só vale para os pedidos `206`. Pedidos `200` continuam confiando em `meta.size`, como hoje.
3. **Codificação de strings não ASCII.** `meta.size` costuma ser contado em bytes, mas `new Response(string)` codifica em UTF-8. Uma string com acentos pode gerar `500` em pedidos `Range` mesmo com o arquivo correto. Mitigação: `getMeta` deve informar o tamanho em bytes. Documentar no teste de strings (usar ASCII nos testes principais).
4. **`options.headers` com `content-range` ou `content-length`.** D-03 sobrescreve só nos `206`/`416`. Um `content-range` global em `options.headers` continua aparecendo nos `200` (comportamento atual de `options.headers`). Não há mudança prevista, mas vale a menção na documentação do módulo se o time quiser.
5. **Formato do `etag` em `getMeta`.** `If-Range` compara o texto exato de `meta.etag`. Se `getMeta` devolver ETag sem aspas, como o fixture atual `etag: "w/123"` em `test/static.test.ts:15`, o `If-Range` só casa com o mesmo texto. Isso é o comportamento correto para valores já expostos em `etag`, mas deve ser documentado.
6. **Número de bytes muito grande.** `Number` perde precisão acima de 2^53. Na prática, tamanhos de arquivo não chegam lá. Não tratado.
7. **Tamanho do arquivo.** `static.ts` passa de 350 para cerca de 440 linhas, acima da meta de 200 LoC. Aceito por D-01.
8. **Node e `Blob` em `206`.** O adaptador Node precisa aceitar `Blob` como corpo de `206`. A matriz `node` de `test/static-range.test.ts` valida isso. Se falhar, a correção é converter o `Blob` em `ArrayBuffer` no adaptador, fora do escopo deste arquivo.
9. **Premissas do PRD confirmadas.** `pnpm typecheck` existe (`package.json:54`). O `RFC 9110` substitui o `RFC 7233` da issue, como pede o pedido. O `Range` sobre o `.gz` está de acordo com o PRD.

## Itens não verificados

- Não rodei a suíte nem o lint/typecheck: esta tarefa não altera código. Os comandos acima devem ser executados na implementação.
