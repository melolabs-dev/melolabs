# Tarefas de implementação: HTTP Range no `serveStatic`

**Entradas:** `sdd/prd.md` (RF-01 a RF-13, premissas 1 a 8) · `sdd/techspec.md` (D-01 a D-09, seções 3 a 5)

**Regras gerais**
- Cada tarefa escreve os testes primeiro, vê-os falhar, implementa e vê-os passar (AGENTS.md, "Bug Fix Workflow" adaptado a feature).
- Testes de integração usam `describeMatrix`, então rodam em `web` e `node`.
- Nenhuma tarefa altera `src/index.ts`, `test/static.test.ts` ou a lista de exports públicos.
- Ordem de início: T-14, T-04 podem começar já. Depois, siga o campo `Depende de:`.
- T-01, T-02 e T-03 editam o mesmo arquivo (`src/utils/internal/range.ts`). Faça-as em sequência.
- T-04 a T-11 editam `src/utils/static.ts` e `test/static-range.test.ts`. Faça-as em sequência também.

---

### T-14 — Confirmar a norma (RFC 9110 §13.1.5 e §14.1)

**Cobre:** RF-02, RF-06
**Depende de:** nenhuma
**Aceite:**
- Ler o texto de RFC 9110 §14.1 e responder se o nome da unidade (`bytes`) diferencia maiúsculas de minúsculas. Registrar a resposta na descrição do PR.
- Ler o texto de RFC 9110 §13.1.5 e responder se a regra de `If-Range` por data (valor idêntico ao `Last-Modified`) é compatível com a norma. Registrar a resposta na descrição do PR.
- Se a norma for mais restritiva, ajustar só a regex de T-01 (unidade) ou só `matchesIfRange` de T-02 (data). Não mudar o resto. Isso fecha D-02, D-05 e o risco 3 da techspec.
- **Arquivos:** nenhum (o resultado vai para a descrição do PR).

---

### T-01 — `parseRange`: interpretação do cabeçalho `Range`

**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-14
**Aceite:**
- `test/unit/range.test.ts` cobre a tabela de `parseRange` da techspec, seção 5.1:
  - intervalos válidos: `bytes=0-4`, `bytes=4-`, `bytes=-10`, `bytes=-200` (size 100 → início 0), `bytes=95-200` (fim limitado a 99);
  - `"unsatisfiable"`: `bytes=100-` (size 100), `bytes=-0`;
  - `undefined` (ignorado): `bytes=5-2`, `bytes=0-4,10-14`, `items=0-4`, `bytes=abc`, `bytes=`, `bytes=-`, `size` ausente ou `0`, `null`;
  - unidade `BYTES=0-4`: o resultado segue o que T-14 decidir;
  - início acima de `Number.MAX_SAFE_INTEGER` → `"unsatisfiable"`.
- Os testes são escritos antes; sem o módulo, falham.
- Assinatura conforme techspec, seção 4.1 (tipo de retorno explícito, por causa de `isolatedDeclarations`). `ByteRange` e `parseRange` são os únicos nomes definidos aqui.
- `pnpm vitest run test/unit/range.test.ts` passa. `pnpm lint` passa.
- **Arquivos:** `src/utils/internal/range.ts` (novo), `test/unit/range.test.ts` (novo)

---

### T-02 — `matchesIfRange`: avaliação de `If-Range`

**Cobre:** RF-06
**Depende de:** T-01, T-14
**Aceite:**
- Testes unitários em `test/unit/range.test.ts` cobrem:
  - ETag forte igual (`"v1"` contra `"v1"`) → `true`;
  - ETag forte diferente (`"v2"`) → `false`;
  - `W/` em qualquer lado (`W/"v1"` contra `"v1"`, ou o contrário) → `false`;
  - ETag do asset ausente → `false`;
  - data igual ao `lastModified` → `true`;
  - data um segundo diferente → `false`;
  - data inválida → `false`;
  - `lastModified` ausente → `false`;
  - valor sem aspas que não é data → `false`.
- Comparação de string, sem `Date.parse` (D-05).
- `pnpm vitest run test/unit/range.test.ts` passa. `pnpm lint` passa.
- **Arquivos:** `src/utils/internal/range.ts`, `test/unit/range.test.ts`

---

### T-03 — `sliceBody` e `sliceStream`: recorte do corpo por tipo

**Cobre:** RF-10
**Depende de:** T-01
**Aceite:**
- Testes unitários em `test/unit/range.test.ts` cobrem `sliceBody` para:
  - `string` multibyte: `aé` com intervalo `[1, 2]` → bytes de `é` (UTF-8);
  - `ArrayBuffer`;
  - `Uint8Array` com `byteOffset` diferente de zero;
  - `DataView`;
  - `Blob`;
  - `ReadableStream` de um chunk e de vários chunks, com intervalo cruzando a fronteira entre chunks;
  - `ReadableStream` com `cancel` monitorado: depois do último byte pedido, a origem é cancelada (spy);
  - outro `BodyInit` (ex.: `URLSearchParams`), convertido para bytes antes do recorte.
- `sliceBody` não altera o `body` de entrada, além de consumir o stream (techspec, seção 4.1).
- `pnpm vitest run test/unit/range.test.ts` passa. `pnpm lint` passa.
- **Arquivos:** `src/utils/internal/range.ts`, `test/unit/range.test.ts`

---

### T-04 — `Accept-Ranges` em respostas de asset

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:**
- `test/static-range.test.ts` (novo, `describeMatrix`, montagem como em `test/static.test.ts:5-40`) cobre:
  - `GET` sem `Range` → `200`, `accept-ranges: bytes`, corpo completo;
  - `HEAD` sem `Range` → `200` com `accept-ranges: bytes`;
  - `GET` com `If-None-Match` casando → `304` com `accept-ranges: bytes` e sem corpo;
  - `404` (caminho inexistente) → sem `accept-ranges`;
  - `POST` (405) → sem `accept-ranges`;
  - fallthrough → sem `accept-ranges`;
  - `options.headers` com `accept-ranges: none` → valor mantido.
- Passo 5 de techspec, D-03: `accept-ranges` só é definido se ainda não existir, depois de 404/405 e antes do 304.
- Os testes novos falham antes da mudança. `pnpm vitest run test/static.test.ts` passa sem alteração em `web` e `node`.
- **Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts` (novo)

---

### T-05 — Respostas `206` e `416` para `GET`

**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-01, T-03, T-04
**Aceite:**
- `test/static-range.test.ts` cobre, com asset de 100 bytes:
  - ignorados, com `200` completo e sem `content-range`: `bytes=0-4,10-14`, `items=0-4`, `bytes=5-2`, `bytes=abc`, e asset cujo `getMeta` não devolve `size` com `bytes=0-4`;
  - `bytes=10-19` → `206`, `content-range: bytes 10-19/100`, `content-length: 10`, corpo = bytes 10 a 19 (conferido byte a byte);
  - `bytes=95-200` → `206`, `bytes 95-99/100`, `content-length: 5`;
  - `bytes=-10` → `206`, `bytes 90-99/100`;
  - `bytes=-200` → `206`, `bytes 0-99/100`;
  - `bytes=50-` → `206`, `bytes 50-99/100`;
  - `bytes=100-` → `416`, `content-range: bytes */100`, `content-length: 0`, corpo vazio, `accept-ranges: bytes`;
  - `bytes=-0` → `416`, `content-range: bytes */100`;
  - `getContents` não é chamado no `416`.
- Passo 8 de techspec, seção 4.2, com `setPartialHeaders` privado em `static.ts`. `416` é respondido antes de `getContents`. Em `GET`, `contents` é buscado uma vez e reaproveitado.
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`. `pnpm vitest run test/static.test.ts` passa sem alteração.
- **Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-06 — `HEAD` e precedência do `304`

**Cobre:** RF-05, RF-07
**Depende de:** T-05
**Aceite:**
- `HEAD` com `Range: bytes=10-19` → `206`, `content-length: 10`, `content-range: bytes 10-19/100`, corpo vazio, spy de `getContents` não chamado.
- `HEAD` com `Range: bytes=100-` → `416` com os mesmos cabeçalhos do `GET`, corpo vazio, sem chamada a `getContents`.
- `HEAD` com `Range` ignorado (ex.: `items=0-4`) → `200` sem corpo, sem `content-range`.
- `GET` com `If-None-Match: "v1"` e `Range: bytes=0-9` → `304` sem corpo, sem `content-range`.
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `src/utils/static.ts` (só se algum caso falhar), `test/static-range.test.ts`

---

### T-07 — `If-Range` no `serveStatic`

**Cobre:** RF-06
**Depende de:** T-02, T-05
**Aceite:**
- Asset com ETag forte `"v1"`:
  - `Range: bytes=0-9` + `If-Range: "v1"` → `206`;
  - `Range: bytes=0-9` + `If-Range: "v2"` → `200` completo;
  - `Range: bytes=0-9` + `If-Range: W/"v1"` → `200` completo.
- Asset com ETag fraco `W/"v1"` + `If-Range: W/"v1"` → `200` completo.
- Asset com `Last-Modified: Wed, 21 Oct 2015 07:28:00 GMT`:
  - `If-Range` com essa mesma data → `206`;
  - `If-Range` com a data um segundo diferente → `200`.
- Asset sem ETag + qualquer `If-Range` → `200` completo.
- `If-Range` com data inválida → `200` completo.
- Sem `Range`, `If-Range` é ignorado → `200` completo, sem `content-range`.
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `src/utils/static.ts` (só se algum caso falhar), `test/static-range.test.ts`

---

### T-08 — Cabeçalhos preservados em `206` e `416`

**Cobre:** RF-08
**Depende de:** T-05
**Aceite:**
- Asset com ETag, `Last-Modified` e `text/plain`: `206` e `416` têm os mesmos `etag`, `last-modified` e `content-type` do `200` do mesmo asset.
- `options.headers` com `x-custom` → presente em `206` e `416`.
- `options.headers` com `content-length: 999`:
  - `206` usa o comprimento do intervalo (premissa 4);
  - `200` continua com `999` (coberto por `test/static.test.ts:600`, que não muda).
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `src/utils/static.ts` (só se algum caso falhar), `test/static-range.test.ts`

---

### T-09 — Variantes pré-comprimidas

**Cobre:** RF-09
**Depende de:** T-05
**Aceite:**
- `/app.js` com variante `app.js.gz` de 50 bytes e `encodings: { gzip: ".gz" }`:
  - `Accept-Encoding: gzip` + `Range: bytes=0-9` → `206`, `content-encoding: gzip`, `content-range: bytes 0-9/50`, corpo = os 10 primeiros bytes de `app.js.gz`;
  - mesmo caso com `416` (`bytes=50-`) → `content-encoding: gzip`, `content-range: bytes */50`.
- Sem `Accept-Encoding` que case com `gzip`: o `Range` se refere ao arquivo original, com o tamanho original.
- A seleção de variante não muda (D-09).
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `src/utils/static.ts` (só se algum caso falhar), `test/static-range.test.ts`

---

### T-10 — Recorte por tipo de corpo na integração

**Cobre:** RF-10
**Depende de:** T-03, T-05
**Aceite:**
- Em `test/static-range.test.ts`, um `it` por cenário, com loop sobre os tipos `string`, `ArrayBuffer`, `Blob` e `ReadableStream` (techspec, seção 5.2; `describeMatrix` não tem `it.each`):
  - conteúdo `abcdefgh` com `Range: bytes=2-4` → `206` e corpo `cde`;
  - conteúdo `aé` com `size: 3` e `Range: bytes=1-2` → `206` e corpo `é`;
  - `ReadableStream` com `cancel` monitorado, `Range: bytes=0-1` em 8 bytes → corpo `ab` e `cancel` da origem chamado.
- Verificar que `Content-Length` e `content-range` batem com o corpo efetivo (risco 2 da techspec).
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `test/static-range.test.ts`, `src/utils/static.ts` (só se algum caso falhar)

---

### T-11 — Casos de borda: `getContents` vazio e contagem de chamadas

**Cobre:** RF-05, RF-11
**Depende de:** T-05
**Aceite:**
- `getContents` devolve `undefined` com `Range` válido → `200`, sem `content-range`, sem corpo, `getContents` chamado uma vez (premissa 8, D-08).
- `GET` com `206` → `getContents` chamado exatamente uma vez.
- `GET` com `416` → `getContents` não chamado.
- `GET` com `Range` ignorado → `getContents` chamado uma vez, resposta `200` como hoje.
- `getMeta` sem `size` com `Range` → `200` completo, `getContents` chamado uma vez.
- `pnpm vitest run test/static-range.test.ts` passa em `web` e `node`.
- **Arquivos:** `src/utils/static.ts` (só se algum caso falhar), `test/static-range.test.ts`

---

### T-12 — Regressão e superfície pública

**Cobre:** RF-11, RF-12, RF-13
**Depende de:** T-06, T-07, T-08, T-09, T-10, T-11
**Aceite:**
- `pnpm vitest run test/static` passa em `web` e `node`. Cada cenário de RF-01 a RF-10 aparece para os dois alvos no relatório do vitest.
- `git diff -- test/static.test.ts` vazio: asserções existentes não mudaram (RF-11).
- `pnpm vitest run test/security.test.ts test/unit/` passa (outros usos de `serveStatic`).
- `test/unit/package.test.ts` passa sem alteração (lista de exports, RF-12).
- `git diff -- src/index.ts` vazio. Nenhum tipo ou valor novo exportado. `ServeStaticOptions` e `StaticAssetMeta` sem campos novos.
- `pnpm lint` e typecheck passam. `pnpm test` completo passa antes do PR.
- **Arquivos:** nenhum por padrão. Se o lint apontar problemas, corrigir nos arquivos das tarefas anteriores.

---

### T-13 — Verificação manual com cliente real

**Cobre:** RF-03
**Depende de:** T-12
**Aceite:**
- Com um servidor local que usa `serveStatic`, `curl -r 10-19 <url>` retorna `206` com `content-range` esperado e 10 bytes.
- Um player real de vídeo ou áudio (ex.: `<video>` em um navegador) consegue fazer seek e retomar o download. Registrar na descrição do PR o cliente usado e o resultado (risco 5 do PRD).
- Esta tarefa é manual e fica fora do CI. Se não for possível executá-la, deixar a pendência explícita no PR.
- **Arquivos:** nenhum.

---

## Cobertura dos requisitos

| RF | Tarefas |
|---|---|
| RF-01 | T-04 |
| RF-02 | T-01, T-05, T-14 |
| RF-03 | T-05, T-13 |
| RF-04 | T-01, T-05 |
| RF-05 | T-06, T-11 |
| RF-06 | T-02, T-07, T-14 |
| RF-07 | T-06 |
| RF-08 | T-08 |
| RF-09 | T-09 |
| RF-10 | T-03, T-10 |
| RF-11 | T-11, T-12 |
| RF-12 | T-12 |
| RF-13 | T-12 (e `describeMatrix` em T-04 a T-11) |

## Fora desta lista

- Pendência 2 da techspec (parágrafo sobre Range no JSDoc de `serveStatic`): decisão do autor do PR, sem requisito.
- Pendência 3 da techspec (issue separada sobre cache de `206` em `h3/rules/cache`): fora de escopo do PRD.
