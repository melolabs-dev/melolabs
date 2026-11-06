# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-11).

Ordem de execução: T-01 primeiro, para escrever os testes de regressão e vê-los falhar (fluxo de `AGENTS.md`). Depois T-02 e T-03 podem seguir em paralelo; T-04 depende de T-03; T-05 fecha a entrega.

### T-01 — Testes de Range: fixture e casos de 200, 206, 416 e HEAD

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-10

**Depende de:** nenhuma

**Aceite:**
- Novo bloco `describeMatrix("serve static range", ...)` em `test/static.test.ts`, após o bloco atual de `serveStatic` (por volta da linha 394), com fixture `"0123456789".repeat(100)` (1000 bytes), `getMeta` com `etag: '"abc"'`, `mtime` e `size: 1000`, sem `encodings`.
- Cobre os casos da tabela da seção 6 da techspec: `accept-ranges` em 200 e HEAD; `bytes=0-99`; `bytes=0-5000`; `bytes=900-` e `bytes=-100`; `bytes=-5000`; HEAD `bytes=0-9` sem chamar `getContents`; ranges ignorados (`0-9,20-29`, `items=0-9`, `abc`, `9-0`, `bytes=`); 416 (`1000-1100`, `1000-`, `-0`, e HEAD); `If-Range` com ETag forte, fraco, diferente e com data de `last-modified`.
- Com `size` ausente ou `0`, o teste verifica que não há `accept-ranges` e que `Range` é ignorado (D-07, D-08).
- Rodando `pnpm vitest run test/static.test.ts`, os casos de 206, 416 e `accept-ranges` falham antes da implementação, e os casos de 200 e 404 passam.
- Os testes rodam nos modos `web` e `node`.

**Arquivos:** `test/static.test.ts`

### T-02 — Testes de precedência, métodos, encoding, fallthrough e corpo vazio

**Cobre:** RF-08, RF-09

**Depende de:** T-01

**Aceite:**
- Dentro do mesmo bloco de T-01 (ou em bloco irmão no mesmo arquivo), há testes para:
  - `If-None-Match: "abc"` com `Range` retorna 304 sem corpo;
  - `If-Modified-Since` com `Range` retorna 304;
  - asset inexistente com `Range` válido retorna o 404 atual;
  - asset inexistente com `fallthrough: true` e `Range` chama o próximo handler;
  - `POST` com `Range` retorna 405;
  - variante `.gz` com `accept-encoding: gzip` e `Range` retorna 206 com `content-length` e `content-range` da variante, `content-encoding: gzip` e `vary` presente;
  - `getContents` devolvendo `""` com `Range` retorna 200 completo, sem `content-range` (D-10);
  - `options.headers` com `content-length: 999` e `Range` retorna 206 com o `content-length` do trecho (D-06).
- Os testes de 304, 404, 405 e fallthrough passam antes e depois da implementação (são guardas de regressão).
- Os testes rodam nos modos `web` e `node`.

**Arquivos:** `test/static.test.ts`

### T-03 — Helpers privados: `parseByteRange`, `isIfRangeMatch` e `sliceContents`

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07

**Depende de:** T-01

**Aceite:**
- Em `src/utils/static.ts`, no fim do arquivo (após `idSearchPaths`), existem as funções privadas da seção 5 da techspec. Nenhuma é exportada.
- `parseByteRange` implementa a tabela D-09: `a-b`, `a-`, `-n` com `n > 0` limitado ao tamanho; `-0` e `start ≥ size` resultam em `"unsatisfiable"`; múltiplos intervalos, outra unidade, texto malformado, `bytes=` e `end < start` resultam em `undefined`.
- `isIfRangeMatch` aceita somente ETag forte idêntico (nenhum dos dois começa com `W/`) ou data igual a `mtime` em segundos; data inválida (`NaN`) nunca atende.
- `sliceContents` usa `Blob.slice` quando o corpo é `Blob` (inclui `File`); nos demais casos, usa `new Response(contents).arrayBuffer()` e devolve `Uint8Array` do trecho (D-04).
- Os helpers são verificados pelos testes de T-01 que dependem deles (ou por testes unitários no mesmo arquivo de teste, se útil), e `pnpm typecheck` passa.
- Nenhuma mudança em `src/index.ts`, `ServeStaticOptions`, `getMeta` ou `getContents`.

**Arquivos:** `src/utils/static.ts`

### T-04 — Integrar Range em `serveStatic`: 206, 416, HEAD, `accept-ranges` e If-Range

**Cobre:** RF-01, RF-02, RF-04, RF-06, RF-07, RF-08

**Depende de:** T-03

**Aceite:**
- Após o bloco 304 (`src/utils/static.ts:243-248`), `accept-ranges: bytes` é definido quando `meta.size > 0` (D-07).
- `resolveRange` (ou equivalente) segue a ordem D-02 e D-03: sem `If-Range` ou com `If-Range` que atende → `parseByteRange`; `If-Range` que não atende → `undefined`; `size` ausente ou `0` → `undefined` (D-08).
- Após o bloco de `content-length` (`src/utils/static.ts:268-270`) e antes do bloco HEAD:
  - 416 usa `content-range: bytes */N`, `content-length: 0`, `accept-ranges`, `statusText` `Range Not Satisfiable`, sem corpo, via `event.res.headers` e `HTTPResponse` (D-05);
  - HEAD com intervalo válido retorna 206 sem corpo e sem chamar `getContents` (RF-04);
  - GET com intervalo válido chama `getContents`; se houver corpo, retorna 206 com `sliceContents`; se não houver corpo, segue para o 200 atual (D-10);
  - o `content-length` do 206 é sobrescrito com `set` (D-06).
- Os testes de T-01 e T-02 passam.
- Nenhuma alteração em `src/rules/cache.ts`, `src/utils/internal/cache.ts` ou `src/response.ts` (D-11).
- JSDoc de `serveStatic` com um parágrafo curto sobre Range em GET e HEAD, e a nota de que o corpo inteiro é lido (opcional, mas recomendado).

**Arquivos:** `src/utils/static.ts`

### T-05 — Verificação final: regressão, snapshot de exportações, lint e typecheck

**Cobre:** RF-09, RF-10

**Depende de:** T-02, T-04

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`, incluindo os testes antigos sem ajustes (ou com ajustes justificados e sem perda de verificação, conforme RF-10).
- `pnpm vitest run test/unit/package.test.ts` passa sem mudar o snapshot de exportações (RF-09).
- `pnpm vitest run test/security.test.ts test/rules/cache.test.ts` passa (caminho seguro e bypass de Range do cache).
- `pnpm vitest run` (suíte completa) passa.
- `pnpm typecheck` e `pnpm lint` passam. Como `pnpm lint` roda só `oxlint` e `oxfmt --check`, os dois comandos são executados separadamente.
- `git diff --stat` mostra alterações apenas em `src/utils/static.ts`, `test/static.test.ts` e `sdd/tasks.md` (além dos docs já existentes em `sdd/`).

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

## Pendências de decisão (não bloqueiam as tarefas)

A techspec (seção 8) pede confirmação para três pontos. As tarefas seguem as escolhas propostas até haver resposta:

1. D-08: `size: 0` ignora `Range` e responde 200 (afeta T-01 e T-04).
2. D-06: num 206, o `Range` sobrescreve `content-length` de `options.headers` (afeta T-02 e T-04).
3. D-07: `accept-ranges` não aparece em 304 (afeta T-01 e T-04).

Observação: a techspec cita `sdd/pedido.md`, que não existe em `sdd/` nesta cópia. As tarefas usam só `prd.md` e `techspec.md`.
