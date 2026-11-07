# Tarefas: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (decisões D-01 a D-08, riscos R-01 a R-09).

Ordem recomendada: escrever primeiro os testes de cada tarefa e confirmar que falham antes de alterar `src/utils/static.ts` (techspec §6.1). Todas as tarefas de código tocam `src/utils/static.ts` e `test/static.test.ts`, por isso a cadeia de dependências é quase linear.

Comandos de verificação, usados em vários Aceites:
- `pnpm vitest run test/static.test.ts`
- `pnpm vitest run test/unit/package.test.ts`
- `pnpm typecheck` e `pnpm lint`

---

### T-01 — Confirmar pontos em aberto antes de implementar

**Cobre:** nenhum (pré-requisito de RF-05, RF-08 e da premissa de tamanho zero do PRD)
**Depende de:** nenhuma
**Aceite:** os quatro pontos da techspec §8 têm resposta registrada (em `sdd/` ou na issue #1267):
1. tamanho zero: `bytes=-n` com `size === 0` é 416 (PRD) ou pode ser satisfazível (RFC 9110 §14.1.1);
2. validador por data em `If-Range`: igualdade exata (PRD) ou regra de §13.1.5;
3. unidade `bytes` sem diferenciar maiúsculas (RFC 9110 §14.1);
4. `accept-ranges` definido pela opção `headers` é respeitado (D-02).
Até a resposta chegar, seguir as escolhas padrão da techspec (D-02, D-03, D-05, D-07).

**Arquivos:** `sdd/techspec.md`, `sdd/tasks.md`

---

### T-02 — Anunciar `Accept-Ranges: bytes` nas respostas de asset

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:**
- Teste escrito antes da mudança: `GET` de asset existente sem `Range` retorna 200 sem `accept-ranges`, e falha.
- Depois da mudança, o mesmo teste passa e o cabeçalho também aparece em 304 (que ainda não tem tratamento de Range).
- Com `headers: { "accept-ranges": "none" }`, o valor do usuário é preservado (D-02).
- Resposta 404 e `fallthrough` não recebem `accept-ranges`.
- Os testes existentes em `test/static.test.ts` continuam passando sem alteração.

**Arquivos:** `src/utils/static.ts` (após o bloco de `etag`, antes de `isCacheMatch`), `test/static.test.ts`

---

### T-03 — Interpretar o cabeçalho `Range` e decidir quando ignorá-lo

**Cobre:** RF-06, RF-07
**Depende de:** T-01, T-02
**Aceite:**
- Helper privado `parseRange` (D-03) e `resolveRange` (techspec §4.2), sem `export`.
- `bytes=0-10,20-30`, `bytes=abc`, `items=0-1`, `bytes=5-3`, `bytes=-` e `bytes=0-10, ` → 200 completo, `content-length: 1000`, sem `content-range`.
- `getMeta` sem `size` → 200 completo, sem `content-range`, mesmo com `Range: bytes=0-99` (RF-07).
- `src/index.ts` não muda.

**Arquivos:** `src/utils/static.ts` (helpers depois de `// --- Internal Utils ---`), `test/static.test.ts`

---

### T-04 — Responder 206 e 416 com cabeçalhos corretos

**Cobre:** RF-02, RF-05
**Depende de:** T-03
**Aceite:**
- `bytes=0-99` em asset de 1000 bytes → 206, `content-range: bytes 0-99/1000`, `content-length: 100`.
- `bytes=-100` → `900-999`; `bytes=990-` → `990-999`; `bytes=990-5000` → `990-999/1000`; `bytes=-5000` → 206 com corpo inteiro.
- `bytes=5000-6000` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio.
- `bytes=-0` e `bytes=1000-` → 416.
- Com `headers: { "content-length": "999" }` e `Range` válido, o `content-length` é o do trecho (D-04). Em 200, o comportamento de `content-length` do usuário continua igual (`test/static.test.ts:600-617`).
- Status 206 e 416 com `statusText` `Partial Content` e `Range Not Satisfiable` (D-08).

**Arquivos:** `src/utils/static.ts` (ramos 206 e 416 perto de `content-length`), `test/static.test.ts`

---

### T-05 — Recortar o corpo para tipos que já permitem fatiar

**Cobre:** RF-03 (parte: string, `Uint8Array`, `ArrayBuffer`, `Blob`)
**Depende de:** T-04
**Aceite:**
- Helper privado `sliceBody` (D-06) trata `null`/`undefined` (sem mudança), `string`, `ArrayBuffer`, views e `Blob`.
- Em asset de corpo `0123456789`, `bytes=2-4` → corpo `234` e status 206, para string, `Uint8Array`, `ArrayBuffer` e `Blob`. Teste em `for` dentro de um `it`, como em `test/static.test.ts:135-170`.
- Views fatiadas sem cópia (`new Uint8Array(body.buffer, body.byteOffset + start, …)`).

**Arquivos:** `src/utils/static.ts` (`sliceBody` na seção `// --- Internal Utils ---`), `test/static.test.ts`

---

### T-06 — Recortar corpos em stream com `sliceStream`

**Cobre:** RF-03 (parte: `ReadableStream`, `FormData`, `URLSearchParams`)
**Depende de:** T-05
**Aceite:**
- `sliceStream` (techspec §4.2) emite só a interseção com `[start, end]` e chama `controller.terminate()` ao passar de `end`.
- `bytes=2-4` sobre `0123456789` em `ReadableStream`, `FormData` e `URLSearchParams` → corpo `234`.
- Com corpo longo em stream, `bytes=998-999` devolve só os dois últimos bytes e termina.
- Risco R-01 (leitura até `start`) é documentado como comentário no código, em uma linha.

**Arquivos:** `src/utils/static.ts` (`sliceStream` e ramo de `sliceBody`), `test/static.test.ts`

---

### T-07 — Responder `HEAD` com 206 sem chamar `getContents`

**Cobre:** RF-04
**Depende de:** T-04
**Aceite:**
- `HEAD` com `bytes=0-99` em asset de 1000 bytes → 206 com `content-range: bytes 0-99/1000`, `content-length: 100` e corpo vazio.
- `getContents` é um `vi.fn()` e o teste verifica que não foi chamado.
- `HEAD` sem `Range` continua 200 com corpo nulo (`src/utils/static.ts:272-274`).

**Arquivos:** `src/utils/static.ts` (ramo HEAD dentro de 206), `test/static.test.ts`

---

### T-08 — Validar `Range` com `If-Range`

**Cobre:** RF-08
**Depende de:** T-04
**Aceite:**
- Helper privado `ifRangeMatches` (D-05) com comparação forte para ETag e igualdade exata para data.
- Asset com `etag: '"abc"'`: `If-Range: "xyz"` + `Range` → 200 completo; `If-Range: "abc"` + `Range` → 206.
- `If-Range: W/"abc"` + `Range` → 200 (ETag fraco nunca coincide).
- `If-Range` com data igual ao `last-modified` emitido → 206; data diferente → 200.
- `If-Range` sem `Range` não tem efeito (200 completo).
- Os validadores comparados são os de `event.res.headers`, inclusive quando vêm de `headers`.

**Arquivos:** `src/utils/static.ts` (`ifRangeMatches` e uso em `resolveRange`), `test/static.test.ts`

---

### T-09 — Preservar a precedência de 304 sobre `Range`

**Cobre:** RF-09
**Depende de:** T-04
**Aceite:**
- Asset com `etag: '"abc"'`: `If-None-Match: "abc"` + `Range: bytes=0-99` → 304, como hoje.
- `If-Modified-Since` que dá 304 com `Range` também continua 304.
- O `isCacheMatch` continua antes da decisão de Range (`src/utils/static.ts:243-248`), e o teste mostra que a ordem não mudou.

**Arquivos:** `src/utils/static.ts` (ordem das chamadas), `test/static.test.ts`

---

### T-10 — Aplicar `Range` à variante codificada servida

**Cobre:** RF-10
**Depende de:** T-04
**Aceite:**
- Com `app.js` de 1000 bytes, variante `app.js.gz` de 400 bytes e `encodings: { gzip: ".gz" }`: `accept-encoding: gzip` + `Range: bytes=0-99` → 206, `content-encoding: gzip`, `content-range: bytes 0-99/400`, `content-length: 100`.
- `vary: accept-encoding` continua presente.
- Decisão R-05 (não aplicar Range a variantes com `Content-Encoding`) fica registrada se for adotada. Por padrão, o PRD mantém o Range.

**Arquivos:** `src/utils/static.ts` (nenhuma mudança esperada além da ordem já existente), `test/static.test.ts`

---

### T-11 — Manter 404, 405 e `fallthrough` com ou sem `Range`

**Cobre:** RF-11
**Depende de:** T-04
**Aceite:**
- Asset inexistente + `Range: bytes=0-99` + `fallthrough` → não responde (próximo handler).
- Asset inexistente sem `fallthrough` → 404.
- `POST` com `Range` → 405 com `allow: GET, HEAD`.
- Caminho não canônico com `Range` não é servido.
- Todos os testes de `fallthrough` existentes (`test/static.test.ts:396-523`) passam sem alteração.

**Arquivos:** `test/static.test.ts` (novos casos e, se necessário, nenhuma mudança em `src/utils/static.ts`)

---

### T-12 — Garantir que a API pública não muda

**Cobre:** RF-12
**Depende de:** T-06, T-07
**Aceite:**
- `src/index.ts` e `src/response.ts` não têm diff.
- `ServeStaticOptions` e `StaticAssetMeta` não ganham campos.
- `pnpm vitest run test/unit/package.test.ts` passa sem alterar a lista de exportações (`test/unit/package.test.ts:133`).
- Os helpers novos (`parseRange`, `resolveRange`, `ifRangeMatches`, `sliceBody`, `sliceStream`) não aparecem em exports.

**Arquivos:** `src/utils/static.ts` (revisão), `test/unit/package.test.ts` (somente leitura)

---

### T-13 — Verificação final e regressão

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-12 (regressão geral)
**Depende de:** T-09, T-10, T-11, T-12
**Aceite:**
- `pnpm vitest run test/static.test.ts` passa nas duas matrizes (web e node).
- `pnpm test` (lint, typecheck e cobertura) passa.
- Testes existentes que checam `content-length` (`test/static.test.ts:42-71`, `600-617`) passam; se algum falhar por `accept-ranges`, só a asserção afetada é ajustada.
- Nenhum arquivo fora de `src/utils/static.ts` e `test/static.test.ts` foi alterado, salvo `sdd/`.
- Risco R-07 (tamanho de `static.ts`, de cerca de 351 para cerca de 480 linhas) é anotado como dívida para refactor posterior.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`
