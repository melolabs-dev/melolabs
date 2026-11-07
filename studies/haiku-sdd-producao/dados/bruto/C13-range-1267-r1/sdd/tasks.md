# Tarefas: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08).

Ordem: testes primeiro (vermelho), depois implementação (verde), como pede o Bug Fix Workflow do `AGENTS.md`. As tarefas de teste T-01 a T-04 editam o mesmo arquivo, então rodam em sequência.

Pontos a confirmar antes de fechar:

- `sdd/pedido.md` citado pela techspec não existe no repositório. A techspec usa esse arquivo como contrato enxuto.
- A techspec cita "D-09" nos riscos, mas a seção de decisões só define D-01 a D-08. A regra de `size: 0` está na tabela de D-08.
- `Accept-Ranges` só com `size` conhecido diverge da issue (PRD, Premissas). Precisa de aprovação.

---

### T-01 — Testes de anúncio, 206 e 416 no GET

Cobre: RF-01, RF-02, RF-03, RF-04

Depende de: nenhuma

Aceite: os casos novos em `describeMatrix("serve static range", ...)` falham no código atual, em `web` e `node`. Os casos cobertos são:
- GET com `size` conhecido recebe `accept-ranges: bytes`; sem `size` não recebe.
- `bytes=a-b`, `bytes=a-` e `bytes=-n` retornam 206 com `content-range` e `content-length` corretos.
- `b >= size` e `n > size` são ajustados; sufixo maior que o arquivo devolve o arquivo inteiro com 206.
- `a >= size`, `bytes=-0` e `size: 0` retornam 416, `content-range: bytes */size`, `content-length: 0`, corpo vazio.

Arquivos: `test/static.test.ts`

### T-02 — Testes de HEAD, Range ignorado e precedência de condicionais

Cobre: RF-05, RF-06, RF-08

Depende de: T-01

Aceite: os casos novos falham no código atual, em `web` e `node`. Os casos cobertos são:
- HEAD com Range satisfazível retorna 206 com o mesmo `content-range` e `content-length` do GET, sem corpo.
- Range malformado, multi-range (`bytes=0-1,3-4`), unidade diferente (`items=0-1`), `bytes=-` e `start > end` retornam 200 completo, sem `content-range`.
- `If-None-Match` ou `If-Modified-Since` com Range retornam 304, sem `content-range`.

Arquivos: `test/static.test.ts`

### T-03 — Testes de `If-Range`

Cobre: RF-07

Depende de: T-02

Aceite: os casos novos falham no código atual, em `web` e `node`. Usar `"abc"` e `W/"abc"` como ETag (não usar a fixture `etag: "w/123"`). Os casos cobertos são:
- ETag forte igual → 206.
- `W/"abc"` igual → 200.
- ETag diferente → 200.
- Data igual ao `Last-Modified` → 206.
- Data diferente → 200.
- `If-Range` sem `Range` → 200.

Arquivos: `test/static.test.ts`

### T-04 — Testes de encoding, `content-length` do usuário e tipos de corpo

Cobre: RF-02, RF-09, RF-10

Depende de: T-03

Aceite: os casos novos falham no código atual, em `web` e `node`, exceto os que descrevem o comportamento atual (marcados como tal no teste). Os casos cobertos são:
- `meta.encoding` definido com Range → 200 sem `content-range`.
- `accept-encoding: gzip` que escolhe a variante `.gz` com Range → 200 completo.
- `headers: { "content-length": "999" }` com Range satisfazível → 206 com `content-length` do trecho. Com Range ignorado → 200 mantém `999`.
- Corpos: `Blob`, `string` com caractere multibyte (o corte é em bytes), `ReadableStream` com chunks pequenos cruzando a fronteira do trecho, e cancelamento do leitor ao final.

Arquivos: `test/static.test.ts`

### T-05 — Helpers de parser e avaliação de Range

Cobre: RF-02, RF-03, RF-04, RF-05, RF-07

Depende de: T-04

Aceite: `pnpm vitest run test/static.test.ts` deixa de falhar nos casos de T-01 a T-03 que dependem só de cabeçalhos e status (não de corpo). Os helpers ficam sem `export` no fim de `src/utils/static.ts`, com `parseByteRange`, `evaluateRange` e `matchesIfRange` conforme a techspec (D-07 e D-08). `pnpm typecheck` passa. `src/index.ts` não muda.

Arquivos: `src/utils/static.ts`

### T-06 — Fatiamento do corpo por tipo (`sliceContents` e `sliceStream`)

Cobre: RF-02

Depende de: T-04

Aceite: os casos de corpo de T-04 passam. Os casos cobertos são:
- `Blob` usa `slice`.
- `string` e `ArrayBuffer` são convertidos e cortados em bytes.
- `ReadableStream` descarta bytes antes de `start`, repassa o trecho e cancela o leitor ao final.
- `null` ou `undefined` continuam sem corpo.

Arquivos: `src/utils/static.ts`

### T-07 — Integrar Range ao fluxo de `serveStatic`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10

Depende de: T-05, T-06

Aceite: todos os casos de `test/static.test.ts` passam em `web` e `node`. O bloco vai depois do cálculo de `content-length` (`src/utils/static.ts:268-270`) e antes do fluxo atual, conforme a techspec. Detalhes:
- `accept-ranges` é definido só quando `meta.size !== undefined`.
- 416 e 206 usam `event.res.headers.set` para `content-range` e `content-length` (D-05).
- Encoding por `content-encoding` ou por `id !== assetId` ignora o Range (D-06).
- 304, 404 e 405 não mudam de ordem nem de resultado.
- O JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) ganha uma linha sobre Range e uma nota de que `size` precisa ser o tamanho real.

Arquivos: `src/utils/static.ts`

### T-08 — Regressão e verificação de API pública

Cobre: RF-10, RF-11

Depende de: T-07

Aceite: estes comandos passam, sem alterar testes existentes:
- `pnpm vitest run test/static.test.ts`
- `pnpm vitest run test/unit/package.test.ts` (snapshot de exports sem mudança, comprova RF-11)
- `pnpm vitest run test/security.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Revisar o diff: nenhum nome novo exportado de `src/index.ts`, nem em `ServeStaticOptions`, `StaticAssetMeta` ou tipos públicos.

Arquivos: nenhum (apenas execução e revisão do diff)

### T-09 — Medição de desempenho com `ReadableStream` grande

Cobre: RF-02 (risco de desempenho do PRD)

Depende de: T-07

Aceite: medir um stream de cerca de 100 MB com pedido de Range no último trecho, em Node. Registrar o tempo e a memória no texto da revisão. Se o tempo for inaceitável, abrir tarefa separada para leitura por intervalo, fora deste escopo. O script de medição fica fora do repositório (pasta de scratchpad) e não entra no commit.

Arquivos: nenhum (medição fora do repositório)
