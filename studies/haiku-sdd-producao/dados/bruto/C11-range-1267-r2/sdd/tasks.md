# Tarefas: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-15) e `sdd/techspec.md` (D-01 a D-11). A ordem segue o fluxo de teste primeiro de `AGENTS.md`: as tarefas T-01 a T-05 escrevem os testes, que devem falhar antes de qualquer implementação. Depois vêm a implementação do módulo privado e a integração em `serveStatic`.

## Pendências de decisão

As tarefas implementam o padrão escolhido na techspec. Se a decisão mudar, a tarefa correspondente muda junto.

- **D-05 (`size: 0`).** RF-05 cita arquivo de 0 byte com `bytes=0-` respondendo `416`, mas RF-12 trata `size: 0` como desconhecido. Segue-se RF-12: `Range` é ignorado e a resposta é `200`. Ver T-03 e T-09.
- **D-03 (`content-length` em `206`).** Um `content-length` explícito do usuário é sobrescrito pelo tamanho do intervalo. Sem `Range`, nada muda. Ver T-11.
- **D-07 (`FormData` e tipos não fatiáveis).** Respondem `200` completo, sem erro. Ver T-05 e T-11.
- **D-08 e D-09 (divergência de `size` e corpo nulo).** Respondem `500` explícito. O PRD deixou em aberto. Ver T-05 e T-11.
- **D-10 (`accept-ranges: none`).** Opção de desligar o recurso por `ServeStaticOptions.headers`, sem API nova. Não está no PRD. Ver T-09 e T-11.

---

### T-01 — Testes unitários do parser, de If-Range e do recorte de corpo

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07, RF-11

Depende de: nenhuma

Aceite: `test/unit/static-range.test.ts` existe, com tabelas para:
- `parseRange`: `bytes=2-5`, `bytes=7-`, `bytes=-100`, `bytes=-0` (não satisfazível), `bytes=10-20` (não satisfazível), `BYTES=0-1` (aceito), e `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2`, `bytes=`, `bytes=99999999999999999999-` (ignorados, `undefined`).
- `matchIfRange`: ETag forte igual (verdadeiro), ETag diferente, ETag fraco `W/"abc"` (falso, nos dois lados), data igual ao `lastModified` (verdadeiro), data diferente, data inválida e ausência de `lastModified` (falsos).
- `sliceBody`: `"héllo"` com intervalo 1-2 (bytes UTF-8 exatos), `ArrayBuffer`, `ArrayBufferView` com `byteOffset`, `Blob`, `URLSearchParams`, `ReadableStream` com chunks de 3, 3 e 4 bytes (corte no meio de chunk), e `FormData` (`undefined`).

Rodar `pnpm vitest run test/unit/static-range.test.ts` deve falhar, porque `src/utils/internal/range.ts` ainda não existe.

Arquivos:
- `test/unit/static-range.test.ts` (novo)

---

### T-02 — Testes de integração: comportamento sem Range e anúncio de `Accept-Ranges`

Cobre: RF-01, RF-09, RF-12, RF-13

Depende de: nenhuma

Aceite: `test/static-range.test.ts` existe, com `describeMatrix` (alvos `web` e `node`), e cobre:
- GET sem `Range` com `getMeta` de `size: 10`: `200`, `accept-ranges: bytes`, corpo completo.
- HEAD sem `Range`: `200`, `accept-ranges: bytes`, sem corpo.
- `getMeta` sem `size` com `Range: bytes=0-3`: `200`, sem `accept-ranges`, sem `content-range`, corpo completo.
- `size: 0` com `Range: bytes=0-`: `200`, sem `accept-ranges` (D-05).
- Em `node`, o `content-length` declarado coincide com os bytes lidos no GET sem `Range`.

Os casos que dependem de `accept-ranges` falham antes da implementação. Os casos sem `Range` que já passam hoje devem continuar passando.

Arquivos:
- `test/static-range.test.ts` (novo)

---

### T-03 — Testes de integração: `206` em GET e HEAD e `416`

Cobre: RF-02, RF-03, RF-04, RF-05

Depende de: T-02

Aceite: em `test/static-range.test.ts`, com asset de 10 bytes `0123456789`:
- `bytes=2-5` em GET: `206`, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345`.
- `bytes=7-`: `206`, `bytes 7-9/10`, `content-length: 3`.
- `bytes=-100`: `206`, `bytes 0-9/10`, `content-length: 10`.
- `bytes=2-5` em HEAD: `206`, mesmos cabeçalhos, corpo vazio.
- `bytes=10-20` em GET e em HEAD: `416`, `content-range: bytes */10`, `content-length: 0`.

Casos esperados antes da implementação: falham.

Arquivos:
- `test/static-range.test.ts`

---

### T-04 — Testes de integração: `Range` ignorado, `If-Range` e precedência de `304`

Cobre: RF-06, RF-07, RF-08

Depende de: T-02

Aceite: em `test/static-range.test.ts`:
- `bytes=0-1,4-5`, `items=0-1`, `bytes=abc`, `bytes=5-2` e `bytes=`: `200`, sem `content-range`, corpo completo.
- `If-Range: "abc"` com ETag `"abc"` e `Range: bytes=0-3`: `206` com 4 bytes.
- `If-Range: "outro"`: `200` completo.
- `If-Range` igual ao `Last-Modified` do asset: `206`.
- `If-Range: W/"abc"`: `200` completo.
- `If-Range` sem `Range`: ignorado, resposta `200` completa.
- `If-None-Match: "abc"` com `Range`: `304`, sem corpo, sem `content-range`.

Casos esperados antes da implementação: falham.

Arquivos:
- `test/static-range.test.ts`

---

### T-05 — Testes de integração: codificação, tipos de corpo e divergências

Cobre: RF-09, RF-10, RF-11

Depende de: T-02

Aceite: em `test/static-range.test.ts`:
- `encodings: { gzip: ".gz" }`, `app.js.gz` de 20 bytes, `Accept-Encoding: gzip` e `bytes=0-4`: `206`, `content-range: bytes 0-4/20`, `content-encoding: gzip`, 5 bytes.
- `getContents` com `"héllo"` e `bytes=1-2`: corpo com os bytes UTF-8 1 e 2, `content-length: 2`.
- `ReadableStream` de 10 bytes e `bytes=2-5`: corpo `2345`, e a fonte é cancelada.
- `Blob`, `ArrayBuffer` e `ArrayBufferView` com intervalo: bytes exatos.
- `FormData` com `Range`: `200` completo, sem `content-range` (D-07).
- `getContents` devolvendo `"abc"` com `size: 10` e `Range`: `500` (D-08).
- `getContents` devolvendo `null` com `Range` válido: `500` (D-09).
- POST com `fallthrough: true` e `Range`: retorna `undefined`, sem `accept-ranges` (RF-09).

Casos esperados antes da implementação: falham.

Arquivos:
- `test/static-range.test.ts`

---

### T-06 — Implementar `parseRange` e `matchIfRange`

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07

Depende de: T-01

Aceite: `src/utils/internal/range.ts` existe, exporta `parseRange` e `matchIfRange` com tipo de retorno explícito (`isolatedDeclarations`), e segue D-04 (itens 1 a 9) e D-06. `pnpm vitest run test/unit/static-range.test.ts` passa nas tabelas de `parseRange` e `matchIfRange`. O arquivo não é reexportado por `src/index.ts`.

Arquivos:
- `src/utils/internal/range.ts` (novo)

---

### T-07 — Implementar `sliceBody` para tipos síncronos

Cobre: RF-11

Depende de: T-06

Aceite: `sliceBody` em `src/utils/internal/range.ts` trata `string` (UTF-8 via `textEncoder`), `ArrayBuffer`, `ArrayBufferView` (com `byteOffset`), `Blob` (com `slice`, sem ler o conteúdo inteiro), `URLSearchParams` e `FormData` (retorna `undefined`). Se o tamanho síncrono diverge de `size`, lança `HTTPError` com status `500` antes de qualquer cabeçalho (D-08). Os casos síncronos da tabela de T-01 passam.

Arquivos:
- `src/utils/internal/range.ts`

---

### T-08 — Implementar `sliceBody` para `ReadableStream`

Cobre: RF-11

Depende de: T-07

Aceite: para `ReadableStream`, `sliceBody` lê e descarta os bytes antes de `start`, emite até `end` e cancela a fonte ao terminar (`reader.cancel()`). Chunk que não seja `Uint8Array` gera `controller.error(...)`. Término antes de `end + 1` bytes gera `controller.error(...)` (D-08). Os casos de stream da tabela de T-01 passam, incluindo o corte no meio de chunk.

Arquivos:
- `src/utils/internal/range.ts`

---

### T-09 — Integrar `206`, `416` e cabeçalhos de intervalo em `serveStatic`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-12

Depende de: T-03, T-06, T-07, T-08

Aceite: `src/utils/static.ts` segue o fluxo da techspec, seção 4.3:
- o bloco fica depois de `isCacheMatch` (`src/utils/static.ts:243-248`) e antes do ramo de `HEAD` (`:272`);
- `accept-ranges: bytes` é gravado só se `meta.size > 0` e `event.res` ainda não tiver `accept-ranges` (D-10). Se já houver valor diferente de `bytes`, o `Range` é ignorado;
- `content-range` e `content-length` do `206` e do `416` são gravados em `event.res.headers` (D-03), e só depois de `sliceBody` ter sucesso;
- `416` usa `content-range: bytes */<size>` e `content-length: 0`;
- `HEAD` com `206` responde sem corpo.

Os testes de T-02 e T-03 passam nos alvos `web` e `node`.

Arquivos:
- `src/utils/static.ts`

---

### T-10 — Integrar `If-Range`, `Range` ignorado e precedência de `304`

Cobre: RF-06, RF-07, RF-08

Depende de: T-04, T-09

Aceite: em `src/utils/static.ts`, `If-Range` é avaliado com `matchIfRange`, usando `meta.etag` e `mtimeDate` (já truncado em segundos). Se não bater, a resposta é `200` completa. `If-Range` sem `Range` é ignorado. Multi-range e unidade diferente de `bytes` respondem `200`. Um `304` vence o `Range`. Os testes de T-04 passam nos alvos `web` e `node`.

Arquivos:
- `src/utils/static.ts`
- `src/utils/internal/range.ts` (só se `matchIfRange` precisar de ajuste)

---

### T-11 — Integrar codificação, tipos de corpo, divergências e opt-out

Cobre: RF-09, RF-10, RF-11

Depende de: T-05, T-10

Aceite: em `src/utils/static.ts` e `test/static-range.test.ts`:
- a variante pré-comprimida usa `size` e `content-encoding` dela (`src/utils/static.ts:192-208`), e o `206` mantém `content-encoding` (RF-10);
- `FormData` com `Range` cai no `200` completo (D-07);
- `getContents` com divergência de `size` ou corpo `null` com `Range` válido responde `500` (D-08, D-09);
- `headers: { "accept-ranges": "none" }` faz o `Range` ser ignorado (D-10). Caso novo em `test/static-range.test.ts`;
- `headers: { "content-length": "999" }` com `Range` responde `206` com o `content-length` do intervalo (D-03). Caso novo em `test/static-range.test.ts`;
- sem `Range`, o `content-length: 999` explícito continua valendo (`src/utils/static.ts:268` inalterado).

Os testes de T-05 e os casos novos passam nos alvos `web` e `node`.

Arquivos:
- `src/utils/static.ts`
- `test/static-range.test.ts`

---

### T-12 — Garantir que o comportamento sem `Range` não mudou

Cobre: RF-09, RF-15

Depende de: T-11

Aceite: `pnpm vitest run test/static.test.ts` passa com os 76 testes atuais. `pnpm vitest run test/security.test.ts` passa. O `405` com `Allow: GET, HEAD` e o `fallthrough` continuam iguais. Se algum teste existente quebrar por causa de `accept-ranges`, ajusta-se só a asserção afetada, mantendo o que o teste verifica, e isso é descrito na mensagem de commit.

Arquivos:
- `test/static.test.ts` (só se necessário)
- `test/security.test.ts` (só se necessário)

---

### T-13 — Preservar a API pública e documentar o `Range`

Cobre: RF-14

Depende de: T-11

Aceite:
- `src/index.ts` (linha 193) e `package.json` não mudam (verificação por diff).
- `ServeStaticOptions` tem os mesmos campos, e `src/utils/static.ts` não ganha exportações novas.
- `range.ts` não é reexportado por nenhum arquivo público.
- O JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) ganha um parágrafo sobre `Range`. O parágrafo cita que `206` sobrescreve `content-length` explícito e que `ReadableStream` lê e descarta bytes antes do intervalo.
- `AGENTS.md` (árvore de `src/utils/internal/`, `:89-93`) inclui `range.ts`.

Arquivos:
- `src/utils/static.ts`
- `src/utils/internal/range.ts`
- `AGENTS.md`
- `src/index.ts` (somente leitura, verificação)
- `package.json` (somente leitura, verificação)

---

### T-14 — Verificar os alvos `web` e `node` e o `Content-Length` declarado

Cobre: RF-13

Depende de: T-10, T-11

Aceite: `pnpm vitest run test/static-range.test.ts` passa nos alvos `web` e `node`. Em todos os casos de `206`, o teste em `node` compara `content-length` declarado com o `byteLength` lido do corpo. Os casos que dependem de `Range` falham se o alvo `node` divergir.

Arquivos:
- `test/static-range.test.ts`

---

### T-15 — Qualidade do projeto

Cobre: RF-15

Depende de: T-12, T-13, T-14

Aceite:
- `pnpm vitest run` termina sem falhas.
- `pnpm lint` (oxlint e oxfmt `--check`) termina sem falhas. Se falhar só por formatação, roda-se `pnpm fmt` e revisa-se o diff.
- `pnpm typecheck` termina sem falhas.
- `pnpm test` (com cobertura) é executado antes de fechar a entrega.
- O resultado de cada comando é relatado com a saída, sem resumo genérico.

Arquivos:
- nenhum arquivo novo; verifica os arquivos tocados pelas tarefas anteriores

---

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-09 |
| RF-02 | T-01, T-03, T-06, T-09 |
| RF-03 | T-01, T-03, T-06, T-09 |
| RF-04 | T-03, T-09 |
| RF-05 | T-01, T-03, T-06, T-09 |
| RF-06 | T-01, T-04, T-06, T-10 |
| RF-07 | T-01, T-04, T-06, T-10 |
| RF-08 | T-04, T-10 |
| RF-09 | T-02, T-05, T-11, T-12 |
| RF-10 | T-05, T-11 |
| RF-11 | T-01, T-05, T-07, T-08, T-11 |
| RF-12 | T-02, T-09 |
| RF-13 | T-02, T-14 |
| RF-14 | T-13 |
| RF-15 | T-12, T-15 |
