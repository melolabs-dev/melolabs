# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-11, R-01 a R-12).
Seguindo o fluxo de correção do AGENTS.md: os testes são escritos primeiro e precisam falhar antes de qualquer mudança em `src/utils/static.ts`.

Ordem sugerida: T-01 → T-02 → (T-03, T-04) → T-05 → T-06 → T-07 → T-08.

---

### T-01 — Testes de anúncio e intervalo válido (falhando)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-11

**Depende de:** nenhuma

**Aceite:**
- Em `test/static.test.ts`, um bloco `describeMatrix("serve static range", ...)` com um app novo por teste e fixture de 1000 bytes (`"abcdefghij".repeat(100)`, `etag: '"abc"'`, `size: 1000`).
- Casos: GET sem `Range` com `accept-ranges: bytes` e 200; HEAD sem `Range` com `accept-ranges`; `bytes=0-99` → 206 com `content-range: bytes 0-99/1000`, `content-length: 100` e corpo exato; `bytes=900-` → `900-999/1000`; `bytes=-50` → `950-999/1000`; HEAD `bytes=0-99` → 206 com headers e corpo vazio.
- `pnpm vitest run test/static.test.ts` executado antes da implementação: os casos novos de 206 e de `accept-ranges` falham nos dois modos (`web` e `node`), e os demais casos do arquivo continuam passando.

**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes de Range inválido, 416, If-Range, pré-condições e regressão (falhando)

**Cobre:** RF-05, RF-06, RF-07, RF-08, RF-09

**Depende de:** T-01

**Aceite:**
- No mesmo bloco de T-01, casos:
  - `bytes=abc`, `bytes=0-9,20-29`, `bytes= 0-9`, `bytes=5-2`, `bytes=-`, `items=0-9` → 200 completo, `content-length: 1000`, sem `content-range`;
  - `Bytes=0-9` (caixa) → 206;
  - `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio;
  - `bytes=-0` → 416;
  - `If-Range: "xyz"` → 200 completo; `If-Range: "abc"` → 206 com bytes 0 a 99;
  - `If-Range: W/"abc"` → 200;
  - `If-Range` com data igual ao `last-modified` → 206; data diferente → 200;
  - `If-Range` sem `Range` → 200;
  - `If-Range` não casa com intervalo que daria 416 → 200 (não 416);
  - `If-None-Match: "abc"` + `Range` → 304 sem corpo; `If-Modified-Since` ≥ mtime + `Range` → 304;
  - POST com `Range: bytes=0-9` → 405 com `allow: GET, HEAD`;
  - asset inexistente com `Range` → 404, e com `fallthrough` → passa ao próximo handler.
- Casos falham antes da implementação (exceto os que já são 200 hoje, como os de RF-05 sem 206 esperado, que devem continuar passando).

**Arquivos:** `test/static.test.ts`

---

### T-03 — Anunciar `Accept-Ranges` em assets encontrados

**Cobre:** RF-01

**Depende de:** T-01

**Aceite:**
- `event.res.headers.set("accept-ranges", "bytes")` logo depois do `etag` em `src/utils/static.ts:239-241` (D-06), antes de `isCacheMatch`.
- Não aparece em 404 nem em 405.
- Casos de `accept-ranges` de T-01 passam nos dois modos; `304` com `Range` também traz o cabeçalho.
- Nenhuma alteração em `src/utils/internal/cache.ts`.

**Arquivos:** `src/utils/static.ts`

---

### T-04 — Parser privado `parseRange` e `RANGE_RE`

**Cobre:** RF-03, RF-05, RF-06

**Depende de:** T-01

**Aceite:**
- Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, sem `export`: `RANGE_RE = /^bytes=(\d*)-(\d*)$/i` aplicado a `value.trim()` (D-03), e `parseRange(value, size)` que retorna `ByteRange`, `"unsatisfiable"` ou `undefined` (contrato da techspec, seção 4).
- Regras: `bytes=N-` e `bytes=-N` válidos; `bytes=-` e `bytes=5-2` → `undefined`; `bytes=-N` com `N > size` → `0..size-1` (D-08); `bytes=-0` e `bytes=N-` com `N >= size` → `"unsatisfiable"`; `bytes=N-M` com `M >= size` → `M = size-1`.
- Verificação por leitura: `src/index.ts` e `test/unit/package.test.ts` sem alteração.
- Casos de RF-03, RF-05 e RF-06 de T-01/T-02 que dependem só do parser passam (quando T-05 estiver feita, os cabeçalhos completos também).

**Arquivos:** `src/utils/static.ts`

---

### T-05 — Bloco de `If-Range` e `Range` no fluxo do `serveStatic`

**Cobre:** RF-02, RF-04, RF-06, RF-07, RF-08

**Depende de:** T-02, T-03, T-04

**Aceite:**
- Helper privado `matchIfRange(value, { etag, mtime })` com comparação forte (D-02): ETag só casa se igual a `meta.etag` e não começar com `W/`; valor sem `"` é data e casa só com `mtimeDate` em segundos.
- Bloco novo depois de `src/utils/static.ts:270` e antes do HEAD (`:272`), conforme o pseudocódigo da techspec, seção 3:
  - só roda com `Range` presente e `meta.size > 0` (D-07);
  - `If-Range` é avaliado antes da satisfatibilidade (D-09);
  - `416` com `content-range: bytes */<size>` e `content-length: 0` (D-10);
  - `206` sobrescreve `content-length` e define `content-range` em `event.res.headers` (D-05), não no `HTTPResponse`;
  - HEAD com intervalo válido → 206 com corpo `null` (D-11).
- Pré-condições (`304`) continuam antes do bloco (RF-08, P4). Blocos de `Vary`, `Content-Type`/`Content-Encoding` e as linhas `220-266` não mudam (R-05).
- Casos de 416, 206 de HEAD e de If-Range/pré-condição de T-01/T-02 passam nos dois modos.

**Arquivos:** `src/utils/static.ts`

---

### T-06 — Fatiamento do corpo do GET com `sliceContents`

**Cobre:** RF-02, RF-09

**Depende de:** T-05

**Aceite:**
- Helper privado `sliceContents(contents, range)` (D-04): `(await new Response(contents).arrayBuffer()).slice(start, end + 1)`, usado no GET com intervalo válido em `src/utils/static.ts:276-277` (`getContents(id)` chamado só nesse caso).
- Caso `bytes=0-99` devolve exatamente os bytes 0 a 99; caso com conteúdo `"é"` repetido e `bytes=0-1` devolve 2 bytes válidos (não 1 caractere).
- Caso com `accept-encoding: gzip` e variante `.gz` com `Range` → 206 sobre os bytes da variante servida, com `size` dela (P3, `content-encoding` preservado).
- Caso com `options.headers: { "content-length": "999" }` e `Range` válido → `content-length` do trecho (D-05, R-06).
- Caso de `size` ausente ou 0 com `Range` → 200 completo (D-07).
- Sem `Range`, o caminho de GET continua idêntico (RF-09).

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

---

### T-07 — Regressão de cache, encoding, 404/405 e exports públicos

**Cobre:** RF-09, RF-10

**Depende de:** T-06

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa inteiro (casos antigos e novos, `web` e `node`).
- `pnpm vitest run test/security.test.ts test/rules test/unit` passa. `test/security.test.ts:243-395` (uso de `serveStatic`) e `test/rules` (cache) sem mudança de resultado.
- Os asserts antigos com `toMatchObject` (`test/static.test.ts:53`, `:69`) continuam válidos. Se algum teste antigo precisar de ajuste (P5/R5), a justificativa fica registrada na descrição do PR.
- Lista de exportações de `h3` idêntica antes e depois: `src/index.ts` sem diff e `test/unit/package.test.ts:133` passando sem alteração.
- Teste de `304` com `Range` e de `If-Range` sem `Range` continuam verdes.

**Arquivos:** `test/static.test.ts`, `test/security.test.ts`, `test/rules/cache.test.ts`, `test/unit/package.test.ts` (somente leitura), `src/index.ts` (somente leitura)

---

### T-08 — Verificação final: lint, tipos e suíte completa

**Cobre:** RF-11

**Depende de:** T-07

**Aceite:**
- `pnpm vitest run test/static.test.ts` com todos os casos de `serve static range` verdes nos modos `web` e `node` (RF-11).
- `pnpm typecheck` sem erros (R6 do PRD: nenhum tipo novo exportado).
- `pnpm lint` sem erros (`oxlint` e `oxfmt --check`).
- `pnpm test` completo, se o tempo permitir; caso contrário, registrar quais partes foram rodadas.
- Nota de R-08 registrada na descrição do PR: `src/utils/static.ts` passa de cerca de 352 para cerca de 430 linhas, acima da meta de 200 LoC.

**Arquivos:** nenhum arquivo novo; executa os comandos sobre `test/static.test.ts` e `src/utils/static.ts`
