# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-10).

Ordem: T-01 primeiro (testes antes do código, conforme o fluxo de bug fix do `AGENTS.md`). Depois T-02, T-03 e T-04. T-05 e T-06 vêm depois de T-03. T-07 fecha a sequência.

### T-01 — Escrever testes de regressão de Range

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-12

**Depende de:** nenhuma

**Aceite:** Criar `test/static-range.test.ts` com `describeMatrix("serve static range", ...)`, asset de 1000 bytes e `getMeta` com `etag: '"abc"'`, `mtime` e `size: 1000`. Cobrir todos os casos da tabela "Casos, por requisito" da techspec (seção "Estratégia de testes"). Rodar `pnpm vitest run test/static-range.test.ts` antes de qualquer mudança em `src/`: os casos de `Range` devem falhar, e os casos sem `Range` (`GET`/`HEAD` sem cabeçalho, `POST` → 405, asset inexistente com `fallthrough`) devem passar. Registrar a saída dessa execução.

**Arquivos:** `test/static-range.test.ts`

### T-02 — Implementar parser de Range, If-Range e decisão de intervalo

**Cobre:** RF-02, RF-03, RF-07, RF-12

**Depende de:** T-01

**Aceite:** Em `src/utils/static.ts`, no bloco "// --- Internal Utils ---", adicionar `parseRange`, `matchesIfRange` e `resolveRange` como funções privadas, com a interface `ByteRange` (D-04, D-05). Regras: unidade `bytes` sem distinção de caixa; um único intervalo; formas `a-b`, `a-`, `-N`; `a > b` ignorado; `-0` → `"unsatisfiable"`; `b >= size` limitado a `size - 1`; `-N` maior que `size` vale o arquivo inteiro. `If-Range` com ETag forte ou data exata; ETag fraco nunca casa. Os casos de sintaxe, `If-Range` e tamanho zero estão em T-01 e passam. Nenhuma exportação nova.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

### T-03 — Integrar Range ao fluxo de `serveStatic`

**Cobre:** RF-01, RF-04, RF-05, RF-06, RF-08, RF-09, RF-12

**Depende de:** T-02

**Aceite:** Inserir o bloco da techspec após o `304` e substituir o `content-length` e o retorno final de `static.ts` (linhas 268-277 no código atual) pelo bloco novo (D-02, D-07, D-08, D-09). `accept-ranges: bytes` só com `meta.size > 0`. `416` com `content-range: bytes */<size>` e `content-length: 0`, sem chamar `getContents`, também para `HEAD`. `HEAD` com intervalo válido responde 206 sem corpo. A resposta `304` não recebe `Accept-Ranges`. Todos os casos de T-01 ligados a esses RFs passam, e o `GET` sem `Range` continua idêntico ao anterior.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

### T-04 — Recortar o corpo do 206 com verificação de tamanho

**Cobre:** RF-04

**Depende de:** T-02

**Aceite:** Implementar `sliceBody` (D-06, D-10): usar o `Blob` diretamente quando o corpo já é `Blob`; caso contrário, `await new Response(contents).blob()`. Verificar `blob.size === size` e lançar `HTTPError` com `status: 500` se não bater. Confirmar que `GET` com `bytes=100-199` retorna exatamente 100 bytes, e que o corpo recortado é igual para `ReadableStream`, `Blob` e `string` ASCII. Confirmar que um `getContents` com tamanho diferente de `meta.size` resulta em 500 para pedidos `206`. Confirmar que, no adaptador Node, o `Blob` como corpo de `206` funciona (techspec, Riscos, item 8); se não funcionar, parar e reportar, sem converter por conta própria no adaptador.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

### T-05 — Preservar cabeçalhos do usuário e o comportamento sem Range

**Cobre:** RF-09

**Depende de:** T-03

**Aceite:** Em `options.headers` com `content-length: "999"`, um `HEAD` sem `Range` continua com 999 (teste existente `test/static.test.ts:600-617`). Com `Range` válido, o `content-length` do `206` é o do intervalo, e `content-range` de `options.headers` é substituído (D-03). Rodar `pnpm vitest run test/static.test.ts` e confirmar que todos os testes existentes passam sem alteração. Se algum falhar, a causa deve ser uma regra deliberada desta mudança; caso contrário, corrigir o código, não o teste.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`, `test/static.test.ts` (somente leitura, sem alteração prevista)

### T-06 — Garantir ausência de exportações e campos novos na API

**Cobre:** RF-10, RF-11

**Depende de:** T-03

**Aceite:** `src/index.ts` sem alteração. `ServeStaticOptions` e `StaticAssetMeta` sem campos novos (diff vazio nessas interfaces). `pnpm vitest run test/unit/package.test.ts` passa, confirmando que a lista de exportações de `src/_entries/generic.ts` não mudou. Uma chamada existente de `serveStatic` continua compilando sem alteração, o que `pnpm typecheck` verifica.

**Arquivos:** `src/utils/static.ts`, `src/index.ts` (somente leitura, sem alteração prevista), `test/unit/package.test.ts` (somente leitura)

### T-07 — Verificação final da suíte, lint e tipos

**Cobre:** RF-13

**Depende de:** T-04, T-05, T-06

**Aceite:** Rodar `pnpm vitest run` (suíte completa, nos modos `web` e `node`) sem falhas. Rodar `pnpm lint` e `pnpm typecheck` sem erros; confirmar antes que `pnpm typecheck` existe em `package.json`. Opcional: `pnpm build && pnpm vitest run test/dist.test.ts`. Revisar que os testes existentes não foram enfraquecidos (diff de `test/` limitado a `test/static-range.test.ts`). Reportar a saída de cada comando, inclusive falhas.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`
