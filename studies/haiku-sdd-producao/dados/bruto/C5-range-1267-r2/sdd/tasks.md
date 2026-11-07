# Tarefas: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-10, R-01 a R-10).

Ordem: os testes (T-01 a T-05) vêm antes da implementação (T-06 a T-10), seguindo o fluxo de correção de bug do `AGENTS.md`. Cada teste novo deve falhar na linha de base antes da mudança, exceto os casos de RF-07 que já passam hoje.

Decisões pendentes da `techspec.md` (§8): R-01 (leitura completa do corpo, T-09), R-02 (`Accept-Ranges` sem tamanho conhecido, T-06) e R-03 (416 para tamanho zero, T-10). As tarefas seguem o padrão da techspec. Se o revisor mudar uma decisão, ajustar a tarefa correspondente.

---

### T-01 — Criar o arquivo de testes com fixtures

Cria `test/static-range.test.ts` com `describeMatrix("serve static range", ...)`, rodando em `web` e `node`. Define os fixtures: asset de 1000 bytes com conteúdo `"0123456789".repeat(100)`, `etag: '"v2"'`, `mtime` fixo; asset `Blob` de 1000 bytes; asset de tamanho 0.

**Cobre:** RF-09

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/static-range.test.ts` executa sem erro de sintaxe ou de importação nos modos `web` e `node`, com os fixtures disponíveis para as tarefas seguintes.

**Arquivos:** `test/static-range.test.ts`

---

### T-02 — Testes de anúncio de intervalos e de preservação do fluxo

Escreve os casos de RF-01 (GET e HEAD sem `Range` com `accept-ranges: bytes` e corpo completo) e de RF-07 (304 com `If-None-Match` e `Range`; 405 para POST com `Range`; POST com `Range` e `fallthrough` cai no próximo handler; 404 e `fallthrough` para asset inexistente com `Range`).

**Cobre:** RF-01, RF-07

**Depende de:** T-01

**Aceite:** os casos de RF-07 passam na linha de base sem mudança de código. O caso de `accept-ranges` (RF-01) falha antes da implementação.

**Arquivos:** `test/static-range.test.ts`

---

### T-03 — Testes de 206 e de HEAD com intervalo válido

Escreve os casos de RF-02 e RF-03: `bytes=0-99` (206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo com os 100 primeiros bytes); `bytes=-50`; `bytes=990-`; `bytes=990-2000` (fim limitado a 999); asset `Blob` com o mesmo resultado de string; `options.headers` com `content-length: 999` resultando em `content-length: 100` no 206; HEAD com `bytes=500-` (206, `bytes 500-999/1000`, `content-length: 500`, corpo vazio, `getContents` não chamado).

**Cobre:** RF-02, RF-03

**Depende de:** T-01

**Aceite:** todos os casos falham antes da implementação e a asserção de `getContents` não chamado está presente no caso de HEAD.

**Arquivos:** `test/static-range.test.ts`

---

### T-04 — Testes de Range ignorado e de 416

Escreve os casos de RF-04 (`bytes=0-10,20-30`, `items=0-10`, `bytes=abc`, `bytes=5-2`, `bytes=-`: 200, sem `content-range`, corpo completo) e de RF-05 (`bytes=1000-1010` com 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio; `bytes=-0` com 416).

**Cobre:** RF-04, RF-05

**Depende de:** T-01

**Aceite:** os casos de RF-04 passam na linha de base, porque o código atual ignora `Range`. Os casos de RF-05 falham antes da implementação.

**Arquivos:** `test/static-range.test.ts`

---

### T-05 — Testes de If-Range

Escreve os casos de RF-06 com o asset de `etag: '"v2"'`: `If-Range: "v1"` (200 completo); `If-Range: "v2"` (206, bytes 0 a 99); `If-Range: W/"v2"` (200); `If-Range` com a data igual a `Last-Modified` (206); `If-Range` com data diferente (200).

**Cobre:** RF-06

**Depende de:** T-01

**Aceite:** os casos com `If-Range: "v2"` e com data igual falham antes da implementação. Os casos que esperam 200 passam na linha de base.

**Arquivos:** `test/static-range.test.ts`

---

### T-06 — Anunciar `Accept-Ranges` e manter a ordem de avaliação

Em `src/utils/static.ts`, logo após a checagem 304 (`static.ts:248`), define `accept-ranges: bytes` em `event.res.headers` para toda resposta de sucesso. Não adiciona lógica de Range ainda. Conforme D-04 e a pendência R-02, o cabeçalho é anunciado sem depender de `size`.

**Cobre:** RF-01, RF-07

**Depende de:** T-02

**Aceite:** os casos de RF-01 e RF-07 passam. `pnpm vitest run test/static.test.ts` continua com os testes que já passavam.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-07 — Parser de `Range` privado

Acrescenta no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---`, a função `parseRange(header, size)` (sem `export`), com o tipo `ByteRange`. A função usa a expressão `/^bytes=(\d*)-(\d*)$/i` e devolve `ByteRange`, `"unsatisfiable"` ou `undefined`, conforme D-06. Não conecta o parser ao fluxo de resposta ainda.

**Cobre:** RF-02, RF-04, RF-05

**Depende de:** T-03, T-04, T-06

**Aceite:** `pnpm typecheck` passa. A função não aparece em `src/index.ts`. Os casos de RF-04 continuam passando.

**Arquivos:** `src/utils/static.ts`

---

### T-08 — Validação de `If-Range` privada

Acrescenta a função `matchesIfRange(value, etag, mtime)` (sem `export`), conforme D-07. Ausência de `If-Range` resulta em verdadeiro. Tag fraca (`W/`), valor inválido ou vazio resultam em falso. ETag só bate por igualdade exata com `meta.etag`. Data só bate se `Date.parse(valor)` for igual ao `mtime` truncado em segundos. Conecta a função ao fluxo, com a condição descrita em §5 da techspec: o `Range` só vale se `If-Range` bater.

**Cobre:** RF-06

**Depende de:** T-05, T-07

**Aceite:** os casos de RF-06 passam. `If-Range` com tag fraca resulta em 200.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-09 — Resposta 206 e HEAD com intervalo

Acrescenta `sliceContents(contents, range)` (sem `export`), conforme D-03: usa `Blob.slice` quando o corpo é `Blob` e, nos demais tipos, lê o corpo e recorta. Ajusta o bloco de `content-length` e `content-range` para 206 com `event.res.headers.set` (D-08). Para HEAD, retorna 206 com corpo `null` sem chamar `getContents` (D-09). Pendência R-01: a implementação segue a decisão padrão da techspec (leitura completa para tipos que não são `Blob`) até o revisor confirmar.

**Cobre:** RF-02, RF-03

**Depende de:** T-07

**Aceite:** os casos de RF-02 e RF-03 passam, incluindo o caso de `options.headers` com `content-length: 999`. `pnpm typecheck` passa.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-10 — Resposta 416 para intervalo insatisfazível

Conecta o resultado `"unsatisfiable"` ao fluxo, antes de `content-type` e `content-encoding` (D-02). A resposta sai com `content-range: bytes */<size>`, `content-length: 0`, status 416 e sem corpo (D-08). Pendência R-03: para tamanho zero, o comportamento segue D-05 (416 com `bytes */0`) até a confirmação do revisor.

**Cobre:** RF-05

**Depende de:** T-07, T-09

**Aceite:** os casos de RF-05 passam, incluindo `bytes=-0` e o asset de tamanho 0. A 416 não contém `Content-Type` nem `Content-Encoding`.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-11 — Verificar que a API pública não mudou

Confere que `src/index.ts` e a lista de exportações públicas estão iguais aos da linha de base. Confirma que `test/unit/package.test.ts` passa sem alteração, e que as funções novas não têm `export`.

**Cobre:** RF-08

**Depende de:** T-08, T-09, T-10

**Aceite:** `git diff` de `src/index.ts` está vazio. `pnpm vitest run test/unit/package.test.ts` passa sem alteração no teste. `grep` por `export` nas funções novas não encontra nada.

**Arquivos:** `src/utils/static.ts`, `src/index.ts` (somente leitura), `test/unit/package.test.ts` (somente leitura)

---

### T-12 — Verificação final e regressão

Roda a suíte completa. Confere que `test/static.test.ts`, `test/security.test.ts` e `test/unit/package.test.ts` continuam com 272 testes passando, como na linha de base. Roda `pnpm lint`, `pnpm typecheck` e `pnpm test` (lint, typecheck e cobertura). Ajusta testes existentes só se a falha vier da mudança esperada, conforme RF-09.

**Cobre:** RF-09, RF-07

**Depende de:** T-11

**Aceite:** `pnpm vitest run test/static-range.test.ts` passa nos modos `web` e `node`. `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. Os 272 testes da linha de base continuam passando.

**Arquivos:** `test/static.test.ts`, `test/security.test.ts`, `test/unit/package.test.ts`, `test/static-range.test.ts` (somente execução)
