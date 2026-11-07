# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-12) e `sdd/techspec.md` (D-01 a D-09). Cada tarefa é pequena o bastante para ser revisada sozinha.

Premissas adotadas nas tarefas (padrão da spec, §8, pendentes de confirmação): `Accept-Ranges` em todo asset encontrado (D-07); helpers em `src/utils/static.ts` (D-09); asset de `size: 0` responde `416` para qualquer `Range` válido (§8.3); `bytes=5-2` é ignorado (§8.4); `Range` vence o `content-length` explícito quando é válido (§8.5).

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow" aplicado ao feature): escrever o teste primeiro, confirmar que falha contra a implementação atual, depois implementar.

---

### T-01 — Base de testes, fixtures e baseline de exportações

**Cobre:** RF-12, RF-11

**Depende de:** nenhuma

**Aceite:** `test/static-range.test.ts` existe, usa `describeMatrix` e tem a fixture de 10 bytes `"0123456789"` com `size: 10` e `etag: '"v1"'`. A lista de exportações de `src/index.ts` é registrada como baseline no teste (ou anotada na descrição da tarefa), antes de qualquer mudança em `src/`. Rodar `pnpm vitest run test/static-range.test.ts` mostra o arquivo carregando nos modos `web` e `node`, sem testes de Range ainda passando por engano.

**Arquivos:** `test/static-range.test.ts`

---

### T-02 — Anunciar `Accept-Ranges: bytes` em todo asset encontrado

**Cobre:** RF-01

**Depende de:** T-01

**Aceite:** Com asset existente, `GET` e `HEAD` sem `Range` retornam `200` com `accept-ranges: bytes`. O header é gravado com `event.res.headers.set` depois do `304` e antes do bloco de Range (D-06, D-07). Respostas `304`, `404` e `405` não recebem o header. O teste de RF-01 falha antes da mudança e passa depois.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-03 — Parser de `Range` e resposta `206` para `GET` com intervalo válido

**Cobre:** RF-02, RF-03

**Depende de:** T-01

**Aceite:** Função privada `parseRange(header, size)` em `src/utils/static.ts` (D-03, sem `export`). Com a fixture de 10 bytes, `bytes=2-5` retorna `206`, `content-range: bytes 2-5/10`, `content-length: 4` e corpo `2345`. Também: `bytes=7-` → `7-9`; `bytes=-3` → `7-9`; `bytes=-99` → `0-9`; `bytes=5-99` → `5-9`. Os testes falham antes e passam depois, em `web` e `node`.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-04 — Fatiamento do corpo por tipo de `BodyInit`

**Cobre:** RF-02

**Depende de:** T-03

**Aceite:** Função privada `sliceBody(contents, start, length)` (D-05). Com `bytes=2-5`, `getContents` devolvendo `string`, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream` (em chunks `"01"`, `"234"`, `"56789"`) produz sempre `2345`. Quando o intervalo termina antes do fim do stream, a origem é cancelada (`cancel` chamado). `Blob` usa `slice`, sem ler o arquivo inteiro.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-05 — `416` para intervalo não satisfazível e ignorar `Range` que o servidor não atende

**Cobre:** RF-05, RF-06, RF-07

**Depende de:** T-03

**Aceite:**
- `bytes=10-`, `bytes=10-12` e `bytes=-0` → `416`, com `content-range: bytes */10`, `content-length: 0` e corpo vazio.
- Asset de `size: 0` com `bytes=0-0` → `416` com `content-range: bytes */0`.
- `bytes=abc`, `items=0-1`, `bytes=0-1,4-5`, `bytes=5-2` e `bytes=-` → `200` completo, `content-length: 10`, sem `content-range`.
- `getMeta` sem `size` com `bytes=0-9` → `200` completo, sem `content-range`.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-06 — `HEAD` com `Range` válido

**Cobre:** RF-04

**Depende de:** T-03

**Aceite:** `HEAD` com `bytes=2-5` retorna `206`, com `content-range: bytes 2-5/10` e `content-length: 4`, corpo vazio, e `getContents` (um `vi.fn`) não é chamado. `HEAD` com `Range` não atendível segue o `416` de T-05 sem chamar `getContents`.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-07 — `If-Range` com comparação forte

**Cobre:** RF-08

**Depende de:** T-03

**Aceite:** Função privada `matchesIfRange(ifRange, validators)` (D-04). Com `Range: bytes=0-9`:
- `If-Range: "v1"` → `206` com 10 bytes;
- `If-Range: "v0"`, `If-Range: W/"v1"`, data diferente de `Last-Modified`, e data em formato não-HTTP-date → `200` completo.

`If-Range` sem `Range` é ignorado e retorna `200` completo. Validador fraco nunca casa.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-08 — Preservar `304`, `404`, `fallthrough` e `405`

**Cobre:** RF-09

**Depende de:** T-02, T-03

**Aceite:** Os testes passam sem alterar o comportamento existente:
- `If-None-Match: "v1"` com `Range: bytes=0-9` → `304` sem corpo;
- `If-None-Match: "v1"` com `Range: bytes=99-` → `304`, não `416` (a ordem é `304` antes de Range);
- caminho sem asset com `Range` → `404`, ou próximo handler com `fallthrough`;
- `POST` com `Range` → `405` com `allow: GET, HEAD`, ou próximo handler com `fallthrough`.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-09 — Variantes pré-comprimidas e `content-length` explícito

**Cobre:** RF-10

**Depende de:** T-03

**Aceite:**
- Com `encodings: { gzip: ".gz" }`, `app.js.gz` de 20 bytes, `GET /app.js` com `accept-encoding: gzip` e `Range: bytes=0-9` → `206`, `content-encoding: gzip`, `content-length: 10`, `content-range: bytes 0-9/20` e `vary: accept-encoding`.
- Com `headers: { "content-length": "999" }` e `Range` válido → `206` com `content-length` do intervalo (D-06).
- Sem `Range`, o teste de `test/static.test.ts` (`does not overwrite a content-length already set on the response`) continua passando sem alteração.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-10 — Nenhuma exportação pública nova

**Cobre:** RF-11

**Depende de:** T-01, T-03

**Aceite:** `src/index.ts` não é alterado. A lista de exportações e as assinaturas de `ServeStaticOptions` e `StaticAssetMeta` são iguais ao baseline de T-01. `StaticAssetMeta` ganha só comentário sobre `size` em bytes (sem campo novo). Verificação por diff de `src/index.ts` e por revisão dos tipos.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-11 — Documentação no código

**Cobre:** RF-10, RF-11

**Depende de:** T-09, T-10

**Aceite:** O JSDoc de `serveStatic` menciona Range e `If-Range`, e diz que o Range se aplica à representação escolhida, incluindo variantes pré-comprimidas, com o aviso de que `Range` sobre gzip expõe bytes da variante. O JSDoc de `StaticAssetMeta` diz que `size` é em bytes da representação servida. Nenhuma outra documentação pública muda (PRD, Fora de escopo). Os comentários de D-04 (simplificação da data em `If-Range`) e de D-06 (`content-length` sobrescrito) estão no código.

**Arquivos:** `src/utils/static.ts`

---

### T-12 — Revisão da suíte e verificação final

**Cobre:** RF-12, RF-01 a RF-11

**Depende de:** T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11

**Aceite:**
- `pnpm vitest run test/static.test.ts test/security.test.ts test/static-range.test.ts` passa nos modos `web` e `node`.
- Testes existentes que afirmavam `200` com `Range` ou a ausência de `accept-ranges` são revistos caso a caso e ajustados só se dependem do comportamento alterado, sem perder o que verificam. Lista das mudanças anotada na descrição do PR.
- `pnpm lint` e `pnpm typecheck` passam.
- `pnpm test` completo (com cobertura) passa.

**Arquivos:** `test/static.test.ts`, `test/security.test.ts`, `test/static-range.test.ts`
