# Tarefas de implementação — HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-09). Seguem o Bug Fix Workflow de `AGENTS.md`: primeiro os testes de regressão, confirmados como falhando (T-01 e T-02), depois a implementação.

**Ordem:** pontos abertos → T-01 e T-02 (podem sair em paralelo) → T-03 → T-04 → T-05 e T-06 → T-07 → T-08.

Antes de começar, confirmar as referências `arquivo:linha` da techspec no código atual (a própria techspec pede isso). Essa conferência deve ser repetida antes de T-05, porque as linhas de `src/utils/static.ts` mudam em T-04.

## Pontos abertos

Cada ponto tem uma proposta. Ela vale até alguém decidir o contrário e não bloqueia o trabalho, exceto onde o campo "Bloqueia" indica.

- **D-02 — suporte a `ArrayBufferView` além da lista de P2.** Bloqueia T-01 (os casos de `sliceBody` dependem da lista final).
  Proposta: incluir `ArrayBufferView`. Os casos de `Uint8Array` com `byteOffset` já estão em T-01 e T-03; excluir o tipo exigiria remover esses casos.
- **D-06 — `content-length` de `options.headers` é sobrescrito em 206/416.**
  Proposta: sobrescrever. T-02 já assume esse comportamento (`999` vira `4`).
- **R-04 — o limite de 200 linhas não é cumprível para `src/utils/static.ts` (já tem 351 linhas).**
  Proposta: aceitar que `static.ts` cresce só pela orquestração e que o limite de 200 linhas vale para arquivos novos de `src/`. Decisão registrada em T-08.
- **Item 4 da techspec — adicionar `range.ts` a `AGENTS.md`.**
  Proposta: sim. T-07 já assume essa mudança.

---

### T-01 — Testes unitários de `range.ts` (falhando)

Escrever `test/unit/range.test.ts` com as tabelas da techspec, sem `describeMatrix`:
- `parseRange`: cada caso de RF-03, RF-05 e RF-06, mais `null`, `bytes=+1-2`, `bytes=1e3-`, `bytes=1-2-3`, `bytes= 2-5`, `bytes=0-9007199254740993`, `bytes=` (→ `full`), `BYTES=2-5` (→ `partial`), `bytes=-0` com `size` 10 (→ `unsatisfiable`) e `bytes=0-` com `size` 0 (→ `unsatisfiable`).
- `matchesIfRange`: `"abc"` com etag `"abc"` → true; `W/"abc"` → false; `"abc"` com etag `W/"abc"` → false; etag ausente → false; data igual e diferente; string vazia → false.
- `sliceBody`: cada tipo de D-02 (já decidido, ver Pontos abertos); `FormData` → `undefined`; `Uint8Array` com `byteOffset` diferente de zero; string com `"é"` (offsets em bytes UTF-8).

Rodar `pnpm vitest run test/unit/range.test.ts` e confirmar que falha por importação inexistente de `src/utils/internal/range.ts`.

**Depende de:** decisão de D-02.

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07.

**Aceite:** o arquivo existe, cobre todas as linhas acima e a execução falha pelo motivo esperado (módulo não encontrado). A saída vai para o Registro de execução no fim deste arquivo.

**Arquivos:** `test/unit/range.test.ts`

---

### T-02 — Testes de integração de Range com `describeMatrix` (falhando)

Escrever `test/static-range.test.ts` com `describeMatrix`, usando o asset `0123456789` (10 bytes) e os valores exatos do PRD. Cobrir:
- RF-01: GET sem Range → 200 com `accept-ranges: bytes`; `options.headers` com `accept-ranges` prevalece; 304 sem `accept-ranges`.
- RF-02: `bytes=2-5` → 206, `content-range: bytes 2-5/10`, `content-length: 4`, corpo `2345`.
- RF-03: `bytes=5-`, `bytes=-3`, `bytes=5-100`, `bytes=-100`.
- RF-04: HEAD com `bytes=2-5` → 206 com os mesmos headers, corpo vazio, `getContents` não chamado (spy).
- RF-05: `bytes=20-30`, `bytes=-0`, `bytes=10-` → 416 com `content-range: bytes */10`, `content-length: 0`, sem corpo; asset de tamanho zero com `bytes=0-` → 416 `bytes */0`.
- RF-06: `bytes=abc`, `bytes=0-1,4-5`, `items=0-1`, `bytes=5-2` → 200, `content-length: 10`, sem `content-range`.
- RF-07: `If-Range` forte igual → 206; `"xyz"` ou `W/"abc"` → 200; data igual ao `last-modified` → 206; data diferente → 200; `If-Range` sem `Range` → 200.
- RF-08: `Range` + `If-None-Match: "abc"` → 304 sem corpo e sem `content-range`.
- RF-09: POST com Range → 405 com `allow: GET, HEAD`; asset inexistente com Range → 404; com `fallthrough`, ambos devolvem `undefined`.
- RF-10: `getMeta` sem `size` com `bytes=0-1` → 200 completo.
- RF-11: variante `.gz` de 6 bytes, `accept-encoding: gzip`, `bytes=0-1` → 206 `bytes 0-1/6`, `content-length: 2`, `content-encoding: gzip`, `vary: accept-encoding`; `vary` presente também em 304 e 416.
- Tipos de corpo (D-02, D-08): `string`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` com `bytes=2-5` → `2345`; `FormData` → 200 completo; `getContents` devolvendo `null` → 200 completo, sem 206 vazio.
- D-06: `options.headers: { "content-length": "999" }` com `bytes=2-5` → 206 com `content-length: 4`.
- Stream com cancelamento: para `bytes=0-1`, o `ReadableStream` de teste usa um `pull` que conta chamadas e um `cancel` que marca uma flag. O teste espera a flag marcada e confirma que o `pull` parou antes do fim do asset.

Rodar `pnpm vitest run test/static-range.test.ts` e registrar a saída.

**Depende de:** nenhuma.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11, RF-13.

**Aceite:**
- Devem falhar agora (comportamento novo): RF-01 (`accept-ranges`), RF-02, RF-03, RF-04 (HEAD com 206), RF-05, RF-07 (If-Range forte igual), RF-08, RF-10, RF-11 e o cancelamento de stream.
- Devem passar agora (guardas de regressão, o comportamento atual já é o esperado): RF-06, a parte de RF-09 que já existe (405, 404, fallthrough), `FormData` → 200, `If-Range` sem `Range` → 200.
- Se um cenário da primeira lista passar, ou um da segunda falhar, registrar no Registro de execução e investigar antes de mudar o teste.
- Os cenários existem nos modos `web` e `node`.

**Arquivos:** `test/static-range.test.ts`

---

### T-03 — Módulo interno `range.ts`

Criar `src/utils/internal/range.ts` com `parseRange`, `matchesIfRange`, `sliceBody` e o tipo `ByteRangeResult`, conforme "Contratos e assinaturas" da techspec:
- `parseRange`: `full` para header ausente, unidade diferente de `bytes` (sem diferenciar maiúsculas), mais de uma spec, spec malformada, `first > last`, inteiro inseguro; `unsatisfiable` para `first >= size`, `-0` e `size === 0`; `partial` nos demais, com `end` limitado a `size - 1` e sufixo maior que o asset resultando em `start = 0`. Sintaxe inválida nunca vira 400.
- `matchesIfRange`: compara ETag forte caractere a caractere com o ETag de resposta; compara data byte a byte com `last-modified`; sem validador correspondente, retorna false.
- `sliceBody`: `Blob.slice` (O(1)); `ArrayBuffer` e `ArrayBufferView` com `byteOffset` e `byteLength` (O(1)); `string` com `TextEncoder` e `subarray`; `ReadableStream` como stream novo que lê e descarta até `start`, emite até `end` e cancela o leitor upstream ao fim, com comentário de custo (R1); demais tipos → `undefined`.
- Tipos de retorno explícitos em todas as funções exportadas (`isolatedDeclarations`). Sem `enum` nem `namespace`.

Rodar `pnpm vitest run test/unit/range.test.ts` e confirmar que passa.

**Depende de:** T-01.

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07, RF-12.

**Aceite:** `test/unit/range.test.ts` passa; a cobertura de `range.ts` inclui todos os ramos de `parseRange`, `matchesIfRange` e `sliceBody`. Que `src/index.ts` não mudou é verificado em T-07.

**Arquivos:** `src/utils/internal/range.ts`

---

### T-04 — Orquestração de Range em `serveStatic`

Alterar `src/utils/static.ts` seguindo a ordem da D-03 da techspec:
- Após o bloco 304, definir `accept-ranges: bytes` se ainda não existir (P4), sem tocar o 304.
- Helper privado `selectRange(event, size)`: se `size` é `undefined`, retorna `full` (RF-10); lê `range` e `if-range` de `event.req.headers`; se `If-Range` existe e `matchesIfRange` é falso, retorna `full` sem chamar `parseRange`; senão chama `parseRange`.
- Em `unsatisfiable`: `content-range: bytes */<size>`, `content-length: 0` via `event.res.headers.set` (D-06, D-07) e `HTTPResponse` 416 sem corpo.
- HEAD: 206 com `partialResponse` ou 200 só com headers, sem chamar `getContents` (RF-04).
- GET: chamar `getContents`; em `partial`, usar `sliceBody`; se o resultado for `undefined`, cair no 200 completo (D-08). Não usar `contents && sliceBody(...)`, porque `null` daria um 206 sem corpo.
- Helper privado `partialResponse(event, range, size, body)`: grava `content-range` e `content-length` em `event.res.headers`.
- Comentário em `serveStatic` sobre o suporte parcial de tipos (R-08) e sobre o custo do recorte (R-01).
- Não alterar a assinatura pública de `serveStatic`, `ServeStaticOptions` nem `StaticAssetMeta`.

Rodar `pnpm vitest run test/static-range.test.ts`, depois `pnpm vitest run test/static.test.ts`. Ajustar um teste existente só se ele quebrar pela mudança esperada, mantendo o que ele verifica (R3). Cada ajuste é registrado no Registro de execução com o motivo.

**Depende de:** T-02, T-03.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-10.

**Aceite:** os cenários desses requisitos em `test/static-range.test.ts` passam nos modos `web` e `node`; `test/static.test.ts` passa, e qualquer alteração nele está registrada com a justificativa; o 304 não recebe `accept-ranges`.

**Arquivos:** `src/utils/static.ts`

---

### T-05 — Variantes pré-comprimidas e `vary` em 206 e 416

Garantir que, quando há variante selecionada por `accept-encoding`, o 206 e o 416 mantenham `content-encoding`, `content-length` da variante e `vary: accept-encoding`, além de `etag` e `last-modified` da variante (P3). Verificar que o `vary` já anexado antes do 304 (`src/utils/static.ts:220-225`, conferir a linha antes de editar) chega às respostas de Range. Ajustar só se faltar algo.

Testar o caso `.gz` de 6 bytes com `bytes=0-1` e também o 416 com variante (`content-encoding` e `vary` presentes, R-07).

**Depende de:** T-04.

**Cobre:** RF-11.

**Aceite:** o cenário RF-11 de `test/static-range.test.ts` passa nos modos `web` e `node`; `vary: accept-encoding` aparece em 200, 206, 304 e 416 quando há variantes configuradas.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-06 — Métodos, 404 e fallthrough sem mudança

Confirmar que POST com Range continua com 405 e `allow: GET, HEAD`, que asset inexistente continua com 404 e que `fallthrough` devolve `undefined` nos dois casos. Confirmar também que a rejeição de caminho não canônico continua igual, com Range presente:
- Se `test/static.test.ts` já cobre esse caso, basta confirmar que ele passa.
- Se não cobre, adicionar um caso em `test/static-range.test.ts` com um caminho não canônico e o header `range`, e esperar a mesma resposta de hoje.

Se algum comportamento mudou, corrigir em `src/utils/static.ts`.

**Depende de:** T-04.

**Cobre:** RF-09.

**Aceite:** os cenários de RF-09 em `test/static-range.test.ts` passam, incluindo o caso de caminho não canônico; os testes existentes de 405, 404 e fallthrough em `test/static.test.ts` passam sem alteração.

**Arquivos:** `src/utils/static.ts`, `test/static-range.test.ts`

---

### T-07 — Exportações públicas e documentação do módulo interno

Confirmar que `src/index.ts` não tem diff de exportações (inclui não reexportar nada de `range.ts`) e que `test/unit/package.test.ts` passa sem alteração. Adicionar `range.ts` à lista de `utils/internal/` em `AGENTS.md`, mantendo o formato da lista (decisão proposta em Pontos abertos).

**Depende de:** T-03, T-04.

**Cobre:** RF-12.

**Aceite:** `git diff -- src/index.ts` vazio; `pnpm vitest run test/unit/package.test.ts` passa sem alteração no arquivo; `AGENTS.md` lista `range.ts`.

**Arquivos:** `src/index.ts` (somente verificação), `test/unit/package.test.ts` (somente verificação), `AGENTS.md`

---

### T-08 — Qualidade final e limite de linhas

Rodar `pnpm lint` e `pnpm test` completo. Segundo `AGENTS.md`, `pnpm lint` já inclui o typecheck e `pnpm test` inclui lint, typecheck e cobertura, então não há passo separado. Só procurar um script de typecheck próprio em `package.json` se `pnpm test` falhar por tipos e for preciso rodar isoladamente.

Verificar o tamanho dos arquivos de `src/` alterados (`static.ts` e `range.ts`). Decisão de limite (proposta em Pontos abertos, R-04): `static.ts` fica acima de 200 linhas por crescer só pela orquestração; `range.ts` deve ficar em até 200 linhas. Os arquivos de teste ficam fora do limite. Se a proposta for mantida, registrar a decisão no Registro de execução. Isso não bloqueia a entrega; se alguém discordar, mover lógica para outro módulo vira tarefa separada.

**Depende de:** T-04, T-05, T-06, T-07.

**Cobre:** RF-13.

**Aceite:** `pnpm test` e `pnpm lint` passam; o relatório de cobertura inclui `src/utils/internal/range.ts`; `range.ts` tem até 200 linhas; o limite de `static.ts` está decidido e registrado no Registro de execução.

**Arquivos:** `src/utils/static.ts`, `src/utils/internal/range.ts`, `test/static-range.test.ts`, `test/unit/range.test.ts`

---

## Registro de execução

Preencher conforme cada tarefa for executada: comando, resultado esperado, resultado obtido (saída resumida ou caminho do log) e decisões tomadas. Nenhum item abaixo está executado ainda.

| Tarefa | Comando | Esperado | Obtido |
| ------ | ------- | -------- | ------ |
| T-01 | `pnpm vitest run test/unit/range.test.ts` | Falha: módulo não encontrado | Falhou com `Cannot find module '../../src/utils/internal/range.ts'`, como esperado. Depois da implementação: 39 testes passam; com os casos extras de stream, 41 |
| T-02 | `pnpm vitest run test/static-range.test.ts` | Falhas listadas em T-02 | 30 de 58 falharam (15 cenários × web/node): RF-01, RF-02, RF-03, RF-04, RF-05 (2), RF-07 (If-Range forte e data), RF-09 (`allow`), RF-11 (2), tipos de corpo, D-06 e cancelamento de stream. **Divergências:** RF-08 e RF-10 já passavam antes da mudança (são guardas de regressão, não falhas). RF-09 falhou no `allow` por um problema pré-existente: `serveStatic` gravava `allow` em `event.res.headers`, que respostas de erro descartam; passou a usar `event.res.errHeaders`. |
| T-04 | `pnpm vitest run test/static-range.test.ts` e `test/static.test.ts` | Passam | Passam (nos dois modos). `test/static.test.ts` não foi alterado. Ajuste de teste novo: em RF-11 o corpo não é lido, porque o `fetch` do Node descompacta `content-encoding: gzip` e o corpo de teste não é gzip |
| T-05 | cenários RF-11 | Passam | Passam; `vary` presente em 200, 206, 304 e 416 |
| T-06 | cenários RF-09 | Passam | Passam; caminho não canônico com Range continua 404 (coberto em `test/static-range.test.ts`, pois `test/static.test.ts` não cobria esse caso com Range) |
| T-07 | `git diff -- src/index.ts` e `test/unit/package.test.ts` | Sem diff; passa | `src/index.ts` sem diff; `package.test.ts` passa sem alteração. `AGENTS.md` lista `range.ts` |
| T-08 | `pnpm test` e `pnpm lint` | Passam | `pnpm typecheck`: passa. Suíte completa: 73 arquivos passam, 3190 testes passam, 0 falhas. `pnpm lint`: código passa; falha só na formatação de `sdd/pedido.md`, `sdd/tasks.md` e `sdd/techspec.md`, que já estavam sem formatação antes da mudança (não alterados). Cobertura de `range.ts`: 100% de linhas, 98% de ramos. **Limite de linhas (R-04, aceito):** `range.ts` tem 151 linhas; `static.ts` passou de 351 para 415 por causa da orquestração. |
