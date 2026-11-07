# Especificação técnica: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/pedido.md` (contrato enxuto e issue), `sdd/prd.md` (requisitos RF-01 a RF-11, premissas P1 a P7, riscos R1 a R6).
Código consultado no commit `1eb56b9` (branch `master`). Nenhum arquivo do projeto foi alterado por esta especificação.

## Visão geral

`serveStatic` (`src/utils/static.ts:101`) hoje ignora `Range`: sempre responde 200 com o corpo completo (`src/utils/static.ts:276-277`). A mudança acrescenta, dentro dessa função, o tratamento de um único intervalo de bytes para `GET` e `HEAD`:

1. anuncia `Accept-Ranges: bytes` em toda resposta de asset encontrado;
2. avalia `If-Range` e `Range` somente depois das pré-condições de cache (304);
3. responde 206 com a fatia, 416 quando o intervalo não cobre nenhum byte, ou ignora o `Range` (200 completo) nos demais casos.

Não há exportação nova, nem mudança em `ServeStaticOptions`, `getMeta` ou `getContents`.

---

## Decisões de arquitetura

### D-01 — Onde fica a lógica de Range

**Escolha:** a orquestração (ordem, cabeçalhos, 206/416, HEAD) fica em `serveStatic`, em `src/utils/static.ts`. A lógica pura de interpretação (parse do `Range`, avaliação de `If-Range`, cálculo de `start`/`end`) fica em um novo módulo interno `src/utils/internal/range.ts`, que não é reexportado.

**Justificativa:** `src/utils/static.ts` já tem 351 linhas, acima da meta de "< 200 LoC por arquivo" de `AGENTS.md`. Helpers internos "vão no fim do arquivo ou em `utils/internal/`" (`AGENTS.md`, seção Code Conventions). Colocar o parser em `utils/internal/` também permite testá-lo com unit tests sem montar um app. O PRD (RF-10) aceita os dois locais.

**Alternativas:**
- Tudo no fim de `static.ts`: mais simples de navegar, mas aumenta um arquivo já acima da meta.
- Novo arquivo público `src/utils/range.ts`: viola RF-10 e a regra "sem exportações novas".

### D-02 — Ordem de avaliação dentro de `serveStatic`

**Escolha:** a sequência passa a ser:

1. `vary`, `last-modified`, `etag` (inalterados, `src/utils/static.ts:218-241`);
2. `accept-ranges: bytes` (novo, logo após o bloco de `etag`, antes de `isCacheMatch`), para que a resposta 304 também o carregue (RF-01);
3. verificação de 304 (`src/utils/static.ts:243-248`, inalterada): RF-08 exige que a pré-condição vença o Range;
4. `content-type`, `content-encoding`, `content-length` (inalterados, `src/utils/static.ts:250-270`);
5. **novo:** avaliação de Range (If-Range → Range), que pode gerar 416 ou 206;
6. HEAD (`src/utils/static.ts:272-274`) e GET (`src/utils/static.ts:276-277`).

**Justificativa:** RFC 9110 §13.2.2 define que as pré-condições de cache são avaliadas antes do Range. Colocar o Range depois do `content-length` permite sobrescrever `content-length` com o tamanho da fatia (R2), sem reescrever o bloco original.

**Alternativa:** avaliar Range antes de `content-type`. Descartada: obrigaria a duplicar o cálculo de `content-length` ou a reordenar cabeçalhos sem ganho.

### D-03 — Validadores usados por `If-Range`

**Escolha:** `If-Range` é comparado com os validadores **efetivos da resposta**, ou seja `event.res.headers.get("etag")` e `event.res.headers.get("last-modified")`, e não com `meta.etag` / `mtimeDate` diretamente.

**Justificativa:** RFC 9110 §13.1.5 compara com o estado atual da representação que será enviada. `etag` e `last-modified` podem vir de `options.headers` ou de um middleware (a checagem `!event.res.headers.has("etag")` em `src/utils/static.ts:239` mostra que isso é previsto). Usar o cabeçalho efetivo garante que o cliente receba exatamente o validador que comparou.

**Alternativa:** usar `meta.etag` como `isCacheMatch` faz em `src/utils/static.ts:243`. Descartada por divergir do que o cliente recebe quando há override; o custo é um `get` extra por requisição com Range, desprezível.

### D-04 — Regras de `If-Range`

**Escolha:**
- Se o valor começar com `W/` ou `"`, é um entity-tag: confere só se o validador efetivo **não** for fraco e for igual, com comparação forte (ambos sem `W/`, mesmo opaque-tag). Caso contrário, `If-Range` não confere.
- Caso contrário, é tratado como data HTTP: confere se `Date.parse(ifRange)` for igual ao `Date.parse` do `last-modified` efetivo (precisão de segundos, como o módulo já trunca em `src/utils/static.ts:232`). Se qualquer um for `NaN`, não confere.
- Se `If-Range` não conferir, o `Range` é **ignorado** e a resposta é 200 completo (RFC 9110 §13.1.5).

**Justificativa:** atende RF-07 e a issue. A comparação forte para entity-tag é a regra da norma. O reaproveitamento de `opaqueTag`/`splitETags` de `src/utils/internal/cache.ts:51-77` não serve diretamente para comparação forte; por isso a função de `range.ts` faz a checagem de `W/` por conta própria, com uma linha.

**Alternativa:** comparar a data como string com `last-modified`. Descartada: um cliente pode enviar a mesma data em outro formato válido (RFC 9110 §5.6.7), e a comparação via `Date` evita falso negativo.

### D-05 — Gramática aceita para `Range`

**Escolha:** apenas um intervalo, unidade `bytes` case-insensitive, sem espaço interno além do que o grammar permite:

```
Range       := "bytes" "=" ( first "-" last? | "-" suffix )
```

Regras (`getByteRange` em `src/utils/internal/range.ts`):

| Entrada | Resultado |
| --- | --- |
| `bytes=a-b` com `a <= b` | `{ start: a, end: min(b, size-1) }`, ou `"unsatisfiable"` se `a >= size` |
| `bytes=a-` | `{ start: a, end: size-1 }`, ou `"unsatisfiable"` se `a >= size` |
| `bytes=-n` com `n > 0` e `size > 0` | `{ start: max(0, size-n), end: size-1 }` |
| `bytes=-0` ou `size === 0` (com qualquer sufixo ou intervalo válido) | `"unsatisfiable"` |
| `bytes=b-a` com `b > a` (last < first) | ignorado (sintaxe inválida, RFC 9110 §14.1.1) |
| `bytes=-` (sem nenhum número) | ignorado |
| vírgula (`bytes=0-1,5-9`) | ignorado (multi-range fora de escopo) |
| unidade diferente de `bytes` (`items=0-4`) | ignorado |
| texto malformado (`bytes=abc`) | ignorado |
| `size` não definido (`meta.size === undefined`) ou não finito / negativo | ignorado |

Os casos "ignorado" devolvem `undefined` e o `serveStatic` segue como hoje (200 completo).

**Justificativa:** RF-02 a RF-06 e P7. Tratar `bytes=-0` e `size === 0` como não satisfazíveis segue RFC 9110 §14.1.1 e P7.

**Alternativa:** aceitar listas de intervalos e responder `multipart/byteranges`. Fora de escopo (PRD).

### D-06 — Fatiamento do corpo

**Escolha:** no GET com 206, o corpo retornado por `getContents` é convertido em `Blob` e fatiado:
- se o valor for `Blob` (inclui `File`), `contents.slice(start, end + 1)` diretamente, sem ler o arquivo inteiro;
- nos demais tipos de `BodyInit` (string, `ArrayBuffer`, typed arrays, `ReadableStream`, `URLSearchParams`, `FormData`) e para `null`/`undefined`, `await new Response(contents).blob()` e depois `slice`.

Essa é a proposta de P2. **Ainda não confirmada** (PRD, Pergunta em aberto 1). Se o usuário escolher a alternativa de mudar a API de `getContents`, esta decisão é substituída.

**Justificativa:** mantém a assinatura pública (P2, PRD "Fora de escopo"), usa só APIs web padrão (P6) e funciona em Node, Bun, Deno, Workers e navegadores.

**Alternativas:**
- Passar o intervalo a `getContents` (novo parâmetro): muda a API pública e o contrato de todos os backends. Descartada por ora, por ser mudança de API.
- Ler sempre o corpo inteiro como `ArrayBuffer`: mais simples, mas ruim para `Blob`/`File` de disco, onde `slice` é lazy. Descartada para `Blob`.

Helper privado em `src/utils/static.ts`, por exemplo `sliceContents(contents, range)`, após a linha 277 (no bloco "Internal Utils").

### D-07 — Cabeçalhos de 206 e 416

**Escolha:** em 206, `content-range: bytes {start}-{end}/{size}` e `content-length: {end - start + 1}`. Em 416, `content-range: bytes */{size}` e `content-length: 0`, sem corpo. Os dois são escritos com `set`, sobrescrevendo o `content-length` definido em `src/utils/static.ts:268-270` e qualquer valor vindo de `options.headers` (R2).

`content-type`, `content-encoding` e `etag`/`last-modified` continuam como estão para 206 e 416 (R6: validadores permanecem em 206).

**Justificativa:** RF-02, RF-05, RF-09 e R2.

**Alternativa:** remover `content-type`/`content-encoding` em 416. Não adotada: a norma não exige, e manter o fluxo existente evita um caminho especial.

### D-08 — Retorno e status

**Escolha:** o retorno continua sendo `HTTPResponse` (`src/response.ts:96`) com `status` explícito (206 ou 416). A resposta é construída com `new HTTPResponse(body, { status })`, sem `statusText`, como o 200 atual, pois `statusText` só é usado no 304 (`src/utils/static.ts:244-247`) e não é exigido pela norma.

**Justificativa:** `prepareResponse` usa `res.status || preparedRes?.status` (`src/response.ts:195`), então o status do `HTTPResponse` vence o de `event.res`.

### D-09 — Sem mudança de API pública

**Escolha:** nenhuma linha de `src/index.ts` muda; `ServeStaticOptions` (`src/utils/static.ts:17-66`) e as assinaturas de `getMeta`/`getContents` permanecem iguais.

**Justificativa:** RF-10, "Fora de escopo" do PRD, e a restrição de retrocompatibilidade do `pedido.md`. `src/index.ts:193` continua exportando apenas `ServeStaticOptions`, `StaticAssetMeta` e `serveStatic`.

---

## Arquivos a alterar

### `src/utils/static.ts`

- `src/utils/static.ts:4` — importar a função interna de `./internal/range.ts`.
- `src/utils/static.ts:239-241` — após o bloco de `etag`, incluir `event.res.headers.set("accept-ranges", "bytes")` (D-02, RF-01). Não é adicionado em 404, 405 ou fallthrough, porque o código só chega aqui com `meta` encontrado (P4, `src/utils/static.ts:210-215`).
- `src/utils/static.ts:268-270` — manter o bloco de `content-length`. A correção para 206/416 vem depois (D-07).
- `src/utils/static.ts:272-277` — inserir, entre o bloco de `content-length` e o `if (event.req.method === "HEAD")`, a avaliação de Range (D-02). Esboço:

  ```ts
  const range = getByteRange(event.req.headers, meta.size, {
    etag: event.res.headers.get("etag") ?? undefined,
    lastModified: event.res.headers.get("last-modified") ?? undefined,
  });

  if (range === "unsatisfiable") {
    event.res.headers.set("content-range", `bytes */${meta.size}`);
    event.res.headers.set("content-length", "0");
    return new HTTPResponse(null, { status: 416 });
  }

  if (range) {
    event.res.headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    event.res.headers.set("content-length", `${range.end - range.start + 1}`);
    if (event.req.method === "HEAD") {
      return new HTTPResponse(null, { status: 206 });
    }
    const contents = await options.getContents(id);
    return new HTTPResponse(await sliceContents(contents, range), { status: 206 });
  }
  ```

  Observação para a implementação: `meta.size` precisa estar estreitado para `number` no template; o `getByteRange` aceita `size?: number` e devolve `undefined` quando não há tamanho, então o `if (range)` já cobre o caso.

- `src/utils/static.ts:277` — o GET de 200 permanece como está, depois do bloco de Range.
- `src/utils/static.ts:351` (fim do arquivo, bloco "Internal Utils") — incluir `sliceContents` (D-06), privada, sem `export`.

### `src/utils/internal/range.ts` (novo)

Módulo interno, sem reexportação em `src/index.ts`. Conteúdo: `getByteRange`, `parseRangeSpec` (privada), `matchIfRange` (privada). Ver contratos abaixo. Deve ficar abaixo de 200 linhas.

### `src/index.ts`

Nenhuma alteração (D-09). `src/index.ts:193` permanece.

### `src/utils/internal/cache.ts`

Nenhuma alteração. Reutilizar `matchETag` não atende comparação forte (D-04).

### `test/static.test.ts`

- Adicionar novos `it` dentro do `describeMatrix("serve static", ...)` que já existe (`test/static.test.ts:5`), ou um novo bloco `describeMatrix` no mesmo arquivo, usando `t.app.all("/range/**", ...)`. Os testes existentes (`test/static.test.ts:42-71`, `test/static.test.ts:73-133`) não mudam.
- Não há nenhum teste atual que envie `Range` (verificado com busca no arquivo e em `test/`), então R4 não exige ajuste de teste existente.

### `test/unit/range.test.ts` (novo)

Testes da tabela de D-05 e D-04 diretamente sobre `getByteRange`, `matchIfRange` não precisa ser testada isoladamente se a cobertura via `serveStatic` for completa.

### Documentação

- `AGENTS.md` não precisa mudar; se a implementação criar `src/utils/internal/range.ts`, vale adicioná-lo à lista de `utils/internal/` na seção "Project Structure" (o próprio `AGENTS.md` pede para manter atualizado).

---

## Contratos e assinaturas

### `src/utils/internal/range.ts`

```ts
/** Intervalo resolvido, em bytes, inclusivo nas duas pontas. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Avalia `Range` e `If-Range` para uma representação de `size` bytes.
 *
 * - `undefined`: o `Range` não se aplica (ausente, malformado, multi-range, unidade
 *   diferente de `bytes`, `If-Range` que não confere, ou `size` desconhecido). O chamador responde 200 completo.
 * - `"unsatisfiable"`: intervalo válido que não cobre nenhum byte (inclui `size === 0`).
 * - `ByteRange`: intervalo satisfazível, já limitado a `size - 1`.
 */
export function getByteRange(
  headers: Headers,
  size: number | undefined,
  validators: { etag?: string; lastModified?: string },
): ByteRange | "unsatisfiable" | undefined;
```

Helpers privados no mesmo arquivo (não exportados):

```ts
function parseRangeSpec(value: string, size: number): ByteRange | "unsatisfiable" | undefined;
function matchIfRange(ifRange: string, validators: { etag?: string; lastModified?: string }): boolean;
```

### `src/utils/static.ts` (privada)

```ts
async function sliceContents(
  contents: BodyInit | null | undefined,
  range: ByteRange,
): Promise<Blob>;
```

Chamada: `contents instanceof Blob ? contents.slice(start, end + 1) : (await new Response(contents).blob()).slice(...)`. Nome e forma podem ser ajustados pela implementação, desde que continue privada.

### Contrato público (inalterado)

```ts
export function serveStatic(event: H3Event, options: ServeStaticOptions): Promise<HTTPResponse | undefined>;
```

Comportamento observável novo, em `serveStatic`:

| Requisição | Asset | Resposta |
| --- | --- | --- |
| GET/HEAD sem `Range` | encontrado | 200 (ou 304), com `accept-ranges: bytes` |
| GET com `Range` válido | size conhecido | 206, `content-range`, `content-length` da fatia |
| HEAD com `Range` válido | size conhecido | 206, só cabeçalhos, `getContents` não chamado |
| GET/HEAD com `Range` não satisfazível | size conhecido (incl. 0) | 416, `content-range: bytes */size`, `content-length: 0` |
| `Range` ignorado (D-05/D-04) | qualquer | 200 completo |
| `If-None-Match` confere | qualquer | 304, sem avaliar Range |
| asset ausente | — | 404 ou fallthrough, sem `accept-ranges` |
| POST etc. | — | 405 ou fallthrough, como hoje |

---

## Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: escrever os testes primeiro e confirmar que falham antes de alterar `static.ts`.

### Testes de integração (`test/static.test.ts`, matrix web/node)

Montar `t.app.all("/range/**", ...)` com `getMeta` retornando `size: 1000`, `etag: "abc"`, `mtime` fixo, e `getContents` retornando um `Blob` de 1000 bytes com valores conhecidos (por exemplo `i & 0xff`), para que a conferência de bytes seja exata. Cobrir:

- RF-01: `accept-ranges: bytes` em 200, 206, 304 e 416; ausente em 404, 405 e fallthrough.
- RF-02: `bytes=0-499` → 206, `content-range: bytes 0-499/1000`, `content-length: 500`, corpo com os bytes 0..499.
- RF-03: `bytes=900-`, `bytes=-200`, `bytes=0-5000` (limitado a 999).
- RF-04: HEAD com range → 206, corpo vazio, `getContents` (`vi.fn`) não chamado.
- RF-05: `bytes=1000-1200` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio. Asset de size 0 com qualquer range → 416 `bytes */0`.
- RF-06: `bytes=abc`, `items=0-4`, `bytes=0-1,5-9` → 200 sem `content-range`. Asset sem `size` com range válido → 200.
- RF-07: `If-Range` forte confere (206); `If-Range` diferente (200); `W/"abc"` com `If-Range: W/"abc"` (200); data igual (206) e data diferente (200).
- RF-08: `If-None-Match` com range → 304 sem corpo.
- RF-09: variante `.gz` com `encodings`, `accept-encoding: gzip` e `bytes=0-99` → 206, `content-encoding: gzip`, `vary` contendo `accept-encoding`, `content-length: 100`. Fallthrough sem asset com range → `undefined`, sem `content-range`. Sem fallthrough → 404.

Os testes da matrix rodam nos dois alvos, por isso o `Blob` precisa existir nos dois ambientes (Node 18+ tem `Blob` global).

### Unit tests (`test/unit/range.test.ts`)

Tabela direta de `getByteRange` cobrindo a tabela de D-05 (todas as linhas, incluindo `bytes=-0`, `bytes=b-a`, `bytes=-`, espaços e `BYTES=` maiúsculo) e de `matchIfRange` (entity-tag forte, fraco, data igual, data inválida, `NaN`).

### Regressão

- `pnpm vitest run test/static.test.ts test/unit/range.test.ts`.
- `pnpm vitest run test/security.test.ts test/cache.test.ts test/rules/cache.test.ts` (outros consumidores de `serveStatic`/cache).
- `pnpm test` completo (lint, typecheck e cobertura) antes de encerrar.
- `pnpm build` e conferência de que `src/index.ts` não mudou (`git diff -- src/index.ts` vazio), atendendo RF-10.

### Verificação manual opcional

Subir um app de exemplo com `serveStatic` sobre arquivos de disco e usar `curl -r 0-499` contra ele, para validar o comportamento end-to-end fora do vitest.

---

## Riscos

- **R1 — Stream sem seek (aceito).** Se `getContents` devolve `ReadableStream`, o `Response(...).blob()` lê o corpo inteiro antes de fatiar. Para vídeos grandes isso desperdiça memória e tempo. Mitigação: documentar no JSDoc de `getContents` que `Blob`/`File` são recomendados quando há Range; nenhum código de mitigação extra nesta entrega. Essa é a consequência prevista em P2.
- **R2 — `content-length` já definido (tratado).** D-07 sobrescreve com `set` em 206 e 416. Teste dedicado: `options.headers` com `content-length` e Range válido.
- **R3 — Size 0 com Range (aceito, observável).** Antes: 200 sem `content-length`. Depois: 416 com `bytes */0` quando há Range. Sem Range, o comportamento não muda. Confirmar com o usuário (PRD Pergunta 2) antes de mergear, porque é mudança observável.
- **R4 — Testes existentes (sem impacto esperado).** Nenhum teste atual envia `Range`. Ainda assim, rodar a suíte inteira para confirmar.
- **R5 — Precisão de data em If-Range (parcialmente tratado).** A comparação usa `Date.parse` com precisão de segundos, igual ao `last-modified` truncado em `src/utils/static.ts:232`. A regra da norma de que a data só é forte se for pelo menos 1 s anterior ao `Date` da resposta **não** é implementada; uma modificação ocorrida no mesmo segundo pode gerar 206 indevido. Risco baixo, registrado para revisão.
- **R6 — Caches intermediários com 206 (aceito).** Caches podem armazenar fatias. `etag` e `last-modified` permanecem nas 206 (D-07), e `vary` não é alterado para Range. Não há mudança de `vary` nesta entrega.
- **R7 — Pré-condições e status 416 (ponto de atenção).** Um 416 gerado para um `GET` sem `If-None-Match` ainda passa pela checagem de 304 antes, então `If-None-Match` com etag igual gera 304 em vez de 416, conforme RF-08. Testar explicitamente.
- **R8 — Mudança de API implícita (rejeitada por ora).** Se o usuário decidir pela alternativa de D-06 (passar range a `getContents`), esta especificação precisa ser revisada, porque mudaria a assinatura pública.

---

## Pontos pendentes de confirmação

1. **P2 / D-06:** aprovar a estratégia de fatiar `Blob` e bufferizar os demais tipos, ou trocar por mudança de `getContents`.
2. **P7 / D-05 / R3:** aprovar que tamanho 0 com Range responde 416.

Enquanto essas duas não forem confirmadas, a implementação segue a proposta acima. Nenhuma delas bloqueia a escrita dos testes de RF-01 a RF-08, que não dependem da escolha.
