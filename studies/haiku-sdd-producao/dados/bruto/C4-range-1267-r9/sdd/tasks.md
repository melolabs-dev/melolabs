# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-11).

Ordem: T-01 (testes que falham) → T-02 (helpers) → T-03 (integração em `serveStatic`) → T-04 (verificação final). Segue o "Bug Fix Workflow" do `AGENTS.md`: os testes são escritos e confirmados como falhando antes de qualquer mudança em `src/`.

Decisões pendentes do autor (`sdd/techspec.md`, "Pendências para o autor"). Enquanto não forem respondidas, as tarefas seguem a recomendação da techspec:

- D-06: streams (`ReadableStream`) respondem 200 completo.
- D-01: helpers ficam em `src/utils/static.ts`.
- D-08: `accept-ranges: bytes` também aparece no 304.

---

### T-01 — Escrever os testes de Range que falham

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09

**Depende de:** nenhuma

**Aceite:**
- Existe um `describeMatrix("serve static range", ...)` separado em `test/static.test.ts`, usando o padrão de `t.app.all` e `t.fetch`, e rodando nos modos `web` e `node`.
- Há um caso para cada linha da tabela de testes da techspec referente a RF-01 a RF-07 (incluindo GET e HEAD, `bytes=-0`, `bytes=900-5000`, `If-Range` com etag fraco, `POST` com 405 e `fallthrough`).
- O caso de multibyte (D-05) usa `size` em bytes UTF-8, por exemplo `"ação"` com 6 bytes, e não `.length`.
- O caso de `ReadableStream` com `Range` espera 200 completo, conforme a recomendação de D-06.
- O caso de `options.headers` com `content-length: 999` mais `Range` espera 206 com o tamanho do trecho (D-07).
- Rodando `pnpm vitest run test/static.test.ts`, os novos casos de Range falham, e a falha mostra o comportamento atual (200 para qualquer `Range`). Os testes existentes continuam passando.
- Nenhum teste existente foi alterado.

**Arquivos:** `test/static.test.ts`

---

### T-02 — Implementar os helpers privados de Range

**Cobre:** RF-02, RF-03, RF-04, RF-06, RF-08

**Depende de:** T-01

**Aceite:**
- Em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, depois de `idSearchPaths`, existem as funções não exportadas `resolveRange(header, size)`, `matchesIfRange(ifRange, validators)` e `sliceBody(body, range)`, com os tipos `ByteRange` e `RangeResolution` da techspec.
- `resolveRange` aceita só `bytes=<ini>-<fim>`, `bytes=<ini>-` e `bytes=-<sufixo>`. Unidade sem diferenciar maiúsculas. Uma vírgula sobrando é tolerada. Multi-range, outra unidade, malformado e `fim < início` retornam `ignore`. `-0` e início além do fim retornam `unsatisfiable`. `fim` maior que o tamanho é limitado a `size - 1`. Sufixo maior que o tamanho vira o asset inteiro.
- `size === 0` resulta em `unsatisfiable` para qualquer faixa bem formada.
- `matchesIfRange` compara ETag forte por igualdade exata. Não casa com `W/` de nenhum lado nem com etag ausente. Para data, compara com o `mtimeDate` truncado em segundos.
- `sliceBody` recorta `string` (bytes UTF-8 via `TextEncoder`), `Blob` (via `slice`), `ArrayBuffer` e `ArrayBufferView` (respeitando `byteOffset`). Para outros tipos devolve `undefined`.
- Um teste unitário ou os casos de T-01 que dependem só dessas funções passam.
- `src/index.ts` não é alterado.

**Arquivos:** `src/utils/static.ts`

---

### T-03 — Integrar Range em `serveStatic`

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** T-02

**Aceite:**
- `accept-ranges: bytes` é definido com o padrão `if (!has)` junto de `etag`, antes do 304 (D-08). Aparece em 200, 206, 416 e 304.
- O bloco de Range fica depois do cálculo de `content-length` e antes de `HEAD` e de `getContents` (D-02). `If-None-Match` e `If-Modified-Since` continuam produzindo 304 com `Range`.
- `Range` é ignorado quando `meta.size` é `undefined` ou quando `If-Range` não casa.
- 206 define `content-range: bytes <ini>-<fim>/<size>` e `content-length` com `set`, sobrescrevendo qualquer valor vindo de `options.headers` (D-07).
- 416 define `content-range: bytes */<size>`, `content-length: 0`, corpo vazio, `statusText` "Range Not Satisfiable".
- HEAD aplica a mesma decisão, retorna sem corpo e não chama `getContents`.
- Quando `sliceBody` devolve `undefined` (stream etc.), o GET responde 200 completo sem `Content-Range`.
- A seleção de variante comprimida (`.gz`) não muda. O `Range` usa o `size` da variante escolhida.
- Asset inexistente continua retornando `undefined` com `fallthrough` e 404 sem ele. `POST` continua com 405 e `Allow: GET, HEAD`.
- Todos os casos de T-01 de RF-01 a RF-07 passam nos modos `web` e `node`. Os testes existentes continuam passando.

**Arquivos:** `src/utils/static.ts`

---

### T-04 — Verificação final de qualidade e API pública

**Cobre:** RF-08, RF-09

**Depende de:** T-03

**Aceite:**
- `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`.
- `pnpm lint` (oxlint e oxfmt --check) passa.
- `pnpm typecheck` passa.
- `git diff --stat -- src/index.ts` está vazio, e `ServeStaticOptions`, `StaticAssetMeta`, `getMeta` e `getContents` não mudaram (RF-08).
- `src/utils/static.ts` foi revisado: sem exportações novas. Se o arquivo ultrapassar 200 linhas, isso fica registrado como risco R-07, conforme a decisão D-01 do autor.
- Cada cenário das RFs 01 a 07 tem ao menos um teste (RF-09). A lista de cobertura é conferida contra a tabela da techspec.
- Opcional, a critério da revisão: uma linha em `docs/4.examples/serve-static-assets.md` dizendo que Range é suportado. Se não for feita, registrar como pendência.
- Relatório final com a saída dos três comandos, ou com a falha exata, se algum falhar.

**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`, `docs/4.examples/serve-static-assets.md` (opcional)
