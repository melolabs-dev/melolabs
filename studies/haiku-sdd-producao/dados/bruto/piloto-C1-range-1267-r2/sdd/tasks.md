# Tarefas de implementação: suporte a HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-10 e riscos R-01 a R-10).

Ordem sugerida: testes antes da mudança de código (fluxo de correção do `AGENTS.md`). Cada tarefa indica suas dependências.

---

### T-01 — Linha de base da suíte antes de editar

**Cobre:** RF-09, RF-10

Rodar `pnpm vitest run test/static.test.ts test/unit` e registrar o estado atual (quais testes passam, incluindo "Can serve asset (GET)", o teste de `content-length` e o de guarda de caminho). Confirmar que `test/unit/package.test.ts` (snapshot de exportações) passa sem alteração. Nenhum arquivo do projeto deve ser modificado nesta tarefa.

**Depende de:** nenhuma

**Aceite:** a execução termina com o resultado registrado (verde ou falhas pré-existentes listadas). Nenhum arquivo foi alterado (`git status` limpo ou apenas arquivos de `sdd/`).

**Arquivos:** `test/static.test.ts` (somente leitura), `test/unit/package.test.ts` (somente leitura)

---

### T-02 — Testes unitários de `resolveRange` (falhando)

**Cobre:** RF-02, RF-04, RF-05, RF-08

Criar `test/unit/range.test.ts` com tabela de entrada e saída para `resolveRange(headers, { size, etag, lastModified })`, conforme D-04 e D-05. Casos mínimos:
- `bytes=100-199`, `bytes=900-`, `bytes=-50` com size 1000 gerando `partial` 100-199, 900-999, 950-999;
- `bytes=-0` gerando `unsatisfiable`; `bytes=-5000` gerando `0-999`; `bytes=0-` gerando o arquivo inteiro;
- `bytes=1000-1100` gerando `unsatisfiable`;
- malformados e multi-intervalo gerando `full`: `bytes=0-1,5-9`, `items=0-1`, `bytes=9-3`, `bytes=abc`, `bytes=-`, espaço interno, sinais, decimais, número acima de `Number.MAX_SAFE_INTEGER`;
- `BYTES=0-1` (unidade sem diferenciar maiúsculas) gerando `partial`;
- sem cabeçalho `Range`, `size` undefined, `size` 0 ou negativo gerando `full`;
- `If-Range: "abc"` casando com `etag "abc"`; `"xyz"` gerando `full`; `W/"abc"` gerando `full`; sem validador no asset gerando `full`;
- `If-Range` com data igual a `lastModified` gerando `partial` e com data diferente gerando `full` (cobre a decisão proposta de R-01; se a decisão for mudada, ajustar esta tarefa antes de T-03).

Os testes devem falhar antes da T-03, pois o módulo ainda não existe.

**Depende de:** T-01

**Aceite:** `pnpm vitest run test/unit/range.test.ts` falha por causa da ausência de `src/utils/internal/range.ts` (ou das funções), não por erro de sintaxe do teste.

**Arquivos:** `test/unit/range.test.ts`

---

### T-03 — Implementar `resolveRange` e a avaliação de `If-Range`

**Cobre:** RF-02, RF-04, RF-05, RF-08, RF-10

Criar `src/utils/internal/range.ts` com o tipo `RangeResult` e a função exportada `resolveRange`, seguindo as regras de D-04 e D-05. Auxiliares `parseRangeHeader`, `ifRangeMatches` e `strongETagEquals` ficam privados (sem `export`). A comparação de entity-tag é forte. Não reexportar nada em `src/index.ts`.

Ponto a confirmar antes de fechar a tarefa: a techspec pede `export` em `resolveRange` e `sliceBody`, mas o PRD (RF-10) diz "sem `export`" para auxiliares. A intenção é não criar API pública, e `utils/internal/` não é reexportado. Registrar a decisão no código ou no PR.

**Depende de:** T-02

**Aceite:** `pnpm vitest run test/unit/range.test.ts` passa integralmente. `src/index.ts` não foi alterado.

**Arquivos:** `src/utils/internal/range.ts`, `test/unit/range.test.ts`

---

### T-04 — Fatiamento do corpo (`sliceBody`)

**Cobre:** RF-03, RF-06

Adicionar `sliceBody(body, start, end)` em `src/utils/internal/range.ts` (D-06): `null`/`undefined` retorna `null`; `string` é codificada com `TextEncoder` e fatiada em bytes; `ArrayBuffer` com `slice(start, end + 1)`; views (`ArrayBuffer.isView`) respeitando `byteOffset`; `Blob` com `slice`; `ReadableStream` com `TransformStream` que descarta até `start`, emite até `end` e cancela a origem ao terminar (`sliceStream` privado); demais tipos via `new Response(body).arrayBuffer()`.

Adicionar em `test/unit/range.test.ts` os testes: string com caractere multibyte (`"é"`), `Uint8Array` com `byteOffset` diferente de zero, `Blob`, `ReadableStream` com pedaços que cruzam a fronteira do intervalo, e `null`.

**Depende de:** T-03

**Aceite:** os testes de `sliceBody` em `test/unit/range.test.ts` passam em Node e no ambiente de testes; o número de bytes retornado é exatamente `end - start + 1` em todos os tipos.

**Arquivos:** `src/utils/internal/range.ts`, `test/unit/range.test.ts`

---

### T-05 — Testes de integração do `serveStatic` com Range: intervalos e erros (falhando)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

Acrescentar em `test/static.test.ts`, após a linha 678, um `describeMatrix("serve static range", ...)`. Fixture: `getContents` devolvendo `Uint8Array` de 1000 bytes com valor `i % 256`, `getMeta` com `size: 1000`, `etag: '"abc"'` (com aspas duplas) e `mtime` fixo. Casos:
- GET sem `Range` gerando 200 com `Accept-Ranges: bytes` (RF-01);
- `bytes=100-199`, `bytes=900-`, `bytes=-50` gerando 206 com os bytes exatos 100-199, 900-999, 950-999 (RF-02);
- `bytes=990-2000` gerando 206, `Content-Range: bytes 990-999/1000`, `Content-Length: 10`, corpo de 10 bytes (RF-03);
- `bytes=1000-1100` gerando 416, sem corpo, `Content-Range: bytes */1000`, `Content-Length: 0` (RF-04);
- `bytes=0-1,5-9`, `items=0-1`, `bytes=9-3`, `bytes=abc` gerando 200 com corpo inteiro e sem `Content-Range` (RF-05).

Os testes devem falhar antes da T-07.

**Depende de:** T-01

**Aceite:** `pnpm vitest run test/static.test.ts -t "serve static range"` falha nos casos novos e não há erro de sintaxe ou de fixture. Os casos existentes continuam executando.

**Arquivos:** `test/static.test.ts`

---

### T-06 — Testes de integração: HEAD, variantes, If-Range e preservação (falhando)

**Cobre:** RF-06, RF-07, RF-08, RF-09

Acrescentar em `describeMatrix("serve static range", ...)` de `test/static.test.ts`:
- HEAD com `bytes=0-99` gerando 206, `Content-Range: bytes 0-99/1000`, `Content-Length: 100`, sem corpo, com os mesmos cabeçalhos do GET equivalente, e sem chamar `getContents` (RF-06);
- `.gz` de 300 bytes com `accept-encoding: gzip` e `bytes=0-99` gerando 206, `Content-Range: bytes 0-99/300`, `Content-Encoding: gzip`, `Content-Length: 100` (RF-07);
- `If-Range: "abc"` gerando 206 e `If-Range: "xyz"` gerando 200 completo (RF-08);
- `If-None-Match: "abc"` com `Range` gerando 304 (D-02);
- `ETag`, `Cache-Control` e `Vary` do 206 iguais aos do 200 (RF-09);
- POST gerando 405; asset inexistente com `Range` gerando 404, e com `fallthrough` passando adiante (RF-09);
- `size: 0` e `size` ausente ignorando o Range e gerando 200 (D-08).

Os testes devem falhar antes da T-07 (exceto os de preservação, que devem passar já na linha de base).

**Depende de:** T-01

**Aceite:** casos de RF-09 (405, 404, fallthrough, 304 sem Range) passam já na linha de base; casos de HEAD, variante, If-Range e 304 com Range falham antes da T-07.

**Arquivos:** `test/static.test.ts`

---

### T-07 — Integrar Range ao `serveStatic`

**Cobre:** RF-01, RF-03, RF-04, RF-06, RF-07, RF-09

Editar `src/utils/static.ts` (D-02, D-03, D-07, D-09, D-10):
- após a definição de `etag` (perto da linha 241) e antes do 304, definir `accept-ranges: bytes` com `if (!has)`, para respeitar `options.headers`;
- manter o 304 por `If-None-Match`/`If-Modified-Since` antes de qualquer lógica de Range;
- substituir o retorno de HEAD e GET (linhas ~272-277) pelo bloco da techspec: `unsatisfiable` gera 416 sem corpo, com `content-range: bytes */<size>` e `content-length: 0`; `partial` define `content-range` e `content-length` com `set` e retorna 206 (sem chamar `getContents` em HEAD, e com `sliceBody` em GET); `full` mantém o comportamento atual;
- não alterar a seleção de variante, `ServeStaticOptions`, `StaticAssetMeta` nem a assinatura de `serveStatic`.

Documentar no código a sobrescrita de `content-length` em 206 e 416 (R-05).

**Depende de:** T-03, T-04, T-05, T-06

**Aceite:** `pnpm vitest run test/static.test.ts` passa integralmente, incluindo os casos novos de T-05 e T-06 e os casos existentes sem alteração. Os asserts de RF-07 mostram `Content-Range` com o tamanho da variante (300), não do original.

**Arquivos:** `src/utils/static.ts`, `src/utils/internal/range.ts`

---

### T-08 — Regressão, exportações e qualidade

**Cobre:** RF-09, RF-10

Executar `pnpm test` completo (lint, typecheck e cobertura). Confirmar que:
- `test/unit/package.test.ts` passa sem atualizar o snapshot de exportações (prova de RF-10);
- os testes de `fallthrough`, de `content-length` e de guarda de caminho continuam verdes sem alteração;
- `src/utils/internal/range.ts` tem menos de 200 linhas (convenção do `AGENTS.md`);
- `src/utils/static.ts` não aumentou além da adição prevista (cerca de 25 linhas). O desvio pré-existente de 352 linhas não é corrigido aqui (R-08);
- nenhum arquivo de `src/index.ts`, `src/rules/cache.ts`, `src/response.ts` ou `src/utils/internal/cache.ts` foi alterado.

**Depende de:** T-07

**Aceite:** `pnpm test` termina sem falhas. O diff de `src/index.ts` está vazio.

**Arquivos:** `src/utils/static.ts`, `src/utils/internal/range.ts`, `test/static.test.ts`, `test/unit/range.test.ts`, `test/unit/package.test.ts` (somente leitura)

---

## Pendências de decisão (antes ou durante a implementação)

- **R-01 (If-Range com data):** a techspec propõe comparar com `Last-Modified` (igualdade exata). Confirmar; a alternativa é ignorar If-Range com data (200 completo). Afeta T-02 e T-03.
- **R-02 (Accept-Ranges sem tamanho conhecido):** confirmar se deve anunciar `bytes` só quando `size > 0`. Afeta T-05 e T-07.
- **R-03 (arquivo vazio):** a norma daria 416, a techspec dá 200 (D-08). Confirmar. Afeta T-06.
- **D-01 (`export` em `range.ts`):** conflito de redação com RF-10. Ver T-03.

## Cobertura dos requisitos do PRD

| Requisito | Tarefas |
|---|---|
| RF-01 | T-05, T-07 |
| RF-02 | T-02, T-03, T-05 |
| RF-03 | T-04, T-05, T-07 |
| RF-04 | T-02, T-03, T-05, T-07 |
| RF-05 | T-02, T-03, T-05 |
| RF-06 | T-04, T-06, T-07 |
| RF-07 | T-06, T-07 |
| RF-08 | T-02, T-03, T-06 |
| RF-09 | T-01, T-06, T-07, T-08 |
| RF-10 | T-01, T-03, T-08 |
