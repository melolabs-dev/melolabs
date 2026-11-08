# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (decisões D-01 a D-10).

Ordem geral: seguir o fluxo de teste primeiro do AGENTS.md. As tarefas T-01 a T-05 escrevem os testes, e cada um deve falhar antes da mudança (exceto os casos de regressão de RF-09, que já passam hoje e devem continuar passando). Só então começam as tarefas de implementação T-07 a T-11. T-06 registra a linha de base antes de qualquer edição em `src/`.

### T-01 — Criar fixture e teste de Accept-Ranges sem Range

Cria o arquivo de teste com a fixture comum (`size: 1000`, byte `i` vale `i % 256`, `etag: '"abc"'`, `mtime` fixo), usando `describeMatrix` (web e node).

Cobre: RF-01
Depende de: nenhuma
Aceite: GET sem `Range` retorna `200`, corpo completo e `accept-ranges: bytes`; HEAD sem `Range` também traz `accept-ranges: bytes`. O caso falha antes da implementação (`pnpm vitest run test/static-range.test.ts`).
Arquivos: `test/static-range.test.ts` (novo)

### T-02 — Testes de 206, intervalo de sufixo, intervalo aberto e HEAD

Casos da techspec seção 5: `bytes=100-199`; `bytes=990-2000` limitado a 999; `bytes=900-`; `bytes=-50`; `bytes=-5000` com 206 do arquivo inteiro; HEAD `bytes=0-99` com corpo vazio e `getContents` não chamado.

Cobre: RF-02, RF-03, RF-04
Depende de: T-01
Aceite: todos os casos existem e falham antes da implementação, com os valores exatos de `content-range`, `content-length` e corpo.
Arquivos: `test/static-range.test.ts`

### T-03 — Testes de 416 e de Range ignorado

416 para `bytes=1000-1100`, `bytes=-0` e asset com `size: 0` (com `content-range: bytes */N`, `content-length: 0`, corpo vazio, `accept-ranges` presente). Ignorado (200 completo, sem `content-range`) para `bytes=0-1,5-6`, `items=0-1`, `bytes=abc`, `bytes=5-1`, `bytes=-` e para asset sem `size` em `getMeta`.

Cobre: RF-05, RF-06
Depende de: T-01
Aceite: os casos falham antes da implementação. Os valores de cabeçalho e de status batem com o PRD.
Arquivos: `test/static-range.test.ts`

### T-04 — Testes de If-Range e precedência do cache

If-Range: `"xyz"` → 200; `"abc"` → 206; `W/"abc"` → 200; data igual ao `last-modified` → 206; data diferente ou inválida → 200. Precedência: `If-None-Match: "abc"` com `Range` → 304 sem corpo; `If-Modified-Since` maior ou igual ao mtime com `Range` → 304.

Cobre: RF-07, RF-08
Depende de: T-01
Aceite: os casos de 206 e de 200 falham antes da implementação. Os casos de 304 podem já passar, mas precisam continuar passando depois da mudança.
Arquivos: `test/static-range.test.ts`

### T-05 — Testes de preservação, Content-Length e fatiamento por tipo

Preservação: sem `Range`, `Content-Encoding`, `Vary` e `options.headers` iguais aos de hoje. `options.headers` com `content-length` mais `Range` → 206 usando o `content-length` do trecho (D-07). Variante `.gz` com `accept-encoding: gzip` e `Range` → bytes do `.gz` (D-10). Fatiamento (D-08): string multibyte (`"é"`, `size` em bytes UTF-8), `Blob`, `ArrayBuffer`, `ArrayBufferView`, `ReadableStream` com bytes corretos; `FormData` → 200; `getContents` devolvendo `null` com `Range` → 200.

Cobre: RF-09
Depende de: T-01
Aceite: os casos de fatiamento e de `content-length` falham antes da implementação. Os casos de preservação passam hoje e continuam passando depois.
Arquivos: `test/static-range.test.ts`

### T-06 — Registrar linha de base da suíte existente

Antes de editar `src/`, roda `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts` e `pnpm lint`/`pnpm typecheck`, e guarda o resultado. Confirma que o snapshot de exportações (`test/unit/package.test.ts:133`) está verde.

Cobre: RF-09, RF-10
Depende de: nenhuma
Aceite: a saída da linha de base fica registrada na descrição da PR ou em nota de execução. Se algo já falha antes da mudança, isso fica registrado como pré-existente.
Arquivos: nenhum (só leitura)

### T-07 — Anunciar `Accept-Ranges` e manter a ordem do 304

Adiciona `accept-ranges: bytes` a `event.res.headers` quando o asset é encontrado e o cabeçalho ainda não existe (D-03, ao lado de `src/utils/static.ts:239-241`). Confirma que a checagem de cache (`isCacheMatch`, `src/utils/static.ts:243-248`) continua antes de qualquer análise de `Range` (D-02, passo 2).

Cobre: RF-01, RF-08
Depende de: T-01, T-04
Aceite: T-01 passa por completo. O caso de 304 com `Range` de T-04 continua passando. `pnpm typecheck` passa.
Arquivos: `src/utils/static.ts`

### T-08 — Helpers privados de parsing, satisfatibilidade e If-Range

Cria, no fim de `src/utils/static.ts` (abaixo de `// --- Internal Utils ---`, D-01), as funções não exportadas `parseRangeHeader`, `ifRangeMatches` e `resolveRange`, com o tipo `RangeOutcome` (seção 3 da techspec). Cobre a gramática de D-04: unidade `bytes` sem diferenciar maiúsculas, um único intervalo, formas `first-last`, `first-` e `-suffix`, inteiros seguros, `last < first` → ignore, `-0` → 416, `size === 0` → 416. Cobre a regra de D-05: ETag forte ou data HTTP exata, `W/` nunca combina.

Cobre: RF-03, RF-06, RF-07
Depende de: T-03, T-04
Aceite: `pnpm typecheck` e `pnpm lint` passam. Nenhum nome novo é exportado (`src/index.ts` sem alteração). A validação de comportamento vem com T-10.
Arquivos: `src/utils/static.ts`

### T-09 — Fatiar o corpo por tipo (`sliceBody`)

Cria `sliceBody(body, start, end)` privada, retornando `BodyInit` com exatamente `end - start + 1` bytes, ou `undefined` quando não é possível fatiar (D-08). Tipos: `string` (via `TextEncoder`), `ArrayBuffer`, `ArrayBufferView`, `Blob` (`slice`), `ReadableStream` (descarta até `start`, emite até `end`, cancela o restante). `FormData`, `URLSearchParams`, `null` e `undefined` → `undefined`.

Cobre: RF-02, RF-09
Depende de: T-05
Aceite: os casos de fatiamento por tipo de T-05 passam quando combinados com T-10. `pnpm typecheck` passa.
Arquivos: `src/utils/static.ts`

### T-10 — Respostas 206 e 416 e ligação no fluxo do `serveStatic`

Liga `resolveRange` depois de `content-type`, `content-encoding` e `content-length` (D-02, passo 4). Respostas: `unsatisfiable` → 416 como `HTTPResponse` com `content-range: bytes */N` e `content-length: 0`, sem chamar `getContents` (D-06, D-09); `partial` em HEAD → 206 sem corpo; `partial` em GET → 206 com `content-range`, `content-length` do trecho (sobrescrevendo `options.headers`, D-07) e corpo de `sliceBody`; se `sliceBody` devolver `undefined`, cai para 200 completo; `ignore` mantém o caminho atual. `statusText` como `"Partial Content"` e `"Range Not Satisfiable"`.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-09
Depende de: T-02, T-03, T-05, T-07, T-08, T-09
Aceite: T-02, T-03 e T-05 passam por completo. `pnpm vitest run test/static.test.ts test/security.test.ts` passa, sem alterar asserts além do que depende de `Accept-Ranges` (RF-09).
Arquivos: `src/utils/static.ts`, `test/static-range.test.ts` (somente se um caso de teste estiver errado, e registrar o motivo)

### T-11 — Documentar o comportamento de Range no JSDoc

Atualiza o JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) com: suporte a um único intervalo; `size` em bytes; `Range` aplicado à representação codificada (D-10); `Content-Length` de 206 e 416 sobrescrito por `options.headers` (D-07); custo de leitura completa do corpo para cada seek (PRD, risco alto); `If-Range` exige ETag forte (`W/` para fraco).

Cobre: RF-09
Depende de: T-10
Aceite: o JSDoc cobre os seis pontos listados, e `pnpm lint` passa.
Arquivos: `src/utils/static.ts`

### T-12 — Verificação final de API pública e suíte completa

Confirma que `src/index.ts` e `test/unit/package.test.ts` não mudaram (RF-10) e que o snapshot de exportações continua verde. Roda a suíte completa e compara com a linha de base de T-06.

Cobre: RF-09, RF-10
Depende de: T-06, T-10, T-11
Aceite: `git diff -- src/index.ts test/unit/package.test.ts` vazio; `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` passam. Qualquer falha é reportada com a saída.
Arquivos: nenhum (verificação; corrige apenas o que a suíte apontar)
