# Tarefas de implementação: HTTP Range no `serveStatic`

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-10, P-1 a P-5).

Ordem: decisões em aberto primeiro (T-00), depois os testes que falham (T-01 a T-07), depois a implementação em `src/utils/static.ts` (T-08 a T-11), e por fim a verificação geral (T-12). Seguir o fluxo de bug fix do `AGENTS.md`: teste primeiro, confirmar que falha, implementar, confirmar que passa.

---

### T-00 — Fechar os pontos em aberto da techspec

Cobre: RF-02, RF-04, RF-06, RF-09

Confirmar ou registrar as decisões P-1 a P-5 antes de escrever código. P-1 exige checar em RFC 9110 §8.8.2.2 e §13.1.5 se `Last-Modified` vale como validador forte para `If-Range` quando está a menos de um segundo da resposta. P-2 (sobrescrever `content-length` do usuário em 206/416), P-3 (`bytes=-0` vira 416) e P-5 (corpo menor que `size`) são confirmados ou ajustados. P-4 (localização do código e tamanho de `static.ts`) é confirmado com a escolha D-01. O resultado vai para `sdd/techspec.md`, na seção 7.

Depende de: nenhuma

Aceite: `sdd/techspec.md` seção 7 não tem mais itens "em aberto"; cada P-n tem uma decisão escrita. Se P-1 mudar `matchesIfRange`, a mudança aparece na seção D-05.

Arquivos: `sdd/techspec.md`

---

### T-01 — Montar o bloco de testes de Range com metadados próprios

Cobre: RF-10

Criar `describeMatrix("serve static range requests", ...)` no fim de `test/static.test.ts`, sem alterar os blocos existentes. O bloco usa um asset de 1000 bytes (`"abcdefghij".repeat(100)`), sem `encoding`, com `etag: "abc"` e `mtime: 1_700_000_000_500` (para cobrir o truncamento de segundos). Incluir um helper local que monta a requisição com headers e método, para que os casos seguintes fiquem curtos.

Depende de: nenhuma

Aceite: `pnpm vitest run test/static.test.ts` roda o bloco novo nos modos `web` e `node`, sem erro de sintaxe. Os blocos existentes continuam verdes.

Arquivos: `test/static.test.ts`

---

### T-02 — Testes de anúncio e de intervalos válidos (GET e HEAD)

Cobre: RF-01, RF-02, RF-03

Escrever os casos: GET e HEAD sem `Range` retornam 200 com `accept-ranges: bytes`; `bytes=0-99` retorna 206 com `content-range: bytes 0-99/1000`, `content-length: 100` e corpo `"abcdefghij".repeat(10)`; `bytes=-200` retorna `bytes 800-999/1000`; `bytes=900-5000` retorna `bytes 900-999/1000` com 100 bytes; HEAD com `bytes=0-99` retorna 206 com os mesmos cabeçalhos e corpo vazio.

Depende de: T-01

Aceite: os casos existem e falham antes da implementação. A falha é de comportamento (200 sem `content-range` ou sem `accept-ranges`), não de erro de teste.

Arquivos: `test/static.test.ts`

---

### T-03 — Testes de 416 e de Range ignorado

Cobre: RF-04, RF-05

Escrever os casos: `bytes=1000-1100` em GET e em HEAD retorna 416 com `content-range: bytes */1000`, `content-length: 0` e corpo vazio; `bytes=-0` retorna 416 (D-04, conforme decisão de T-00). Em seguida, `bytes=0-10,20-30`, `items=0-10`, `bytes=abc`, `bytes=5-2` e `bytes=` retornam 200, sem `content-range`, com os 1000 bytes completos. Incluir também `BYTES=0-9` retornando 206 (unidade sem diferenciar maiúsculas).

Depende de: T-01

Aceite: os casos de 416 e de 200 falham antes da implementação. Os casos de `BYTES=0-9` e de `bytes=5-2` são verificados quando a implementação entrar (T-08).

Arquivos: `test/static.test.ts`

---

### T-04 — Testes de If-Range

Cobre: RF-06

Escrever os casos: `Range: bytes=0-99` com `If-Range: "abc"` retorna 206; com `If-Range: "xyz"` retorna 200 completo; com `If-Range: W/"abc"` retorna 200 completo. Com `Last-Modified` igual ao `toUTCString()` do `mtime` truncado retorna 206; com outra data retorna 200 completo. Incluir também `If-Range` sem `Range`, que deve ser ignorado (200 completo).

Depende de: T-01

Aceite: os casos que esperam 206 falham antes da implementação. Os casos que esperam 200 podem já passar, e isso é aceito.

Arquivos: `test/static.test.ts`

---

### T-05 — Testes de elegibilidade do Range

Cobre: RF-07

Escrever os casos: `getMeta` sem `size` e `Range: bytes=0-99` retorna 200 completo, sem `content-range`, mantendo `accept-ranges: bytes`; `meta.encoding = "gzip"` com `Range` retorna 200 com o corpo codificado; `content-encoding` vindo de `options.headers` com `Range` retorna 200 completo (D-03); `size: 0` com `Range` retorna 200 (premissa de tamanho zero).

Depende de: T-01

Aceite: os casos falham ou passam conforme o comportamento atual, e o teste de `size` ausente passa hoje (200 completo). Ao final de T-11, todos passam.

Arquivos: `test/static.test.ts`

---

### T-06 — Testes de ordem de avaliação, corpo e override de cabeçalhos

Cobre: RF-08, RF-02, RF-10

Escrever os casos: `If-None-Match: "abc"` com `Range` retorna 304 sem corpo; asset inexistente com `fallthrough: false` e `Range` continua 404; `POST` com `Range` e `fallthrough` desligado continua 405 com `allow: GET, HEAD`. Para o corpo: `getContents` devolvendo `ReadableStream` com `bytes=100-199` retorna os bytes certos (D-08); `Blob` ou string `"ééé"` (6 bytes em UTF-8) com `bytes=0-1` retorna `"é"` e `content-length: 2`; `getContents` devolvendo `null` com `Range` retorna 200 sem `content-range` (D-10); `options.headers` com `content-length: 999` e `Range: bytes=0-99` retorna 206 com `content-length: 100` (D-07).

Depende de: T-01

Aceite: os casos de 206 falham antes da implementação. Os casos de 304, 404 e 405 passam hoje, e continuam verdes depois (são regressão).

Arquivos: `test/static.test.ts`

---

### T-07 — Confirmar a falha dos testes antes da implementação

Cobre: RF-10

Rodar `pnpm vitest run test/static.test.ts` e registrar quais casos novos falham e quais passam. Os casos de 304, 404, 405 e de `size` ausente devem passar; os casos de 206, 416, `accept-ranges` e If-Range que esperam 206 devem falhar. Qualquer falha inesperada nos blocos existentes é investigada antes de seguir.

Depende de: T-02, T-03, T-04, T-05, T-06

Aceite: a saída do Vitest, em `web` e `node`, mostra as falhas esperadas. A lista dos casos que falham é registrada no próprio commit ou na descrição da tarefa.

Arquivos: `test/static.test.ts`

---

### T-08 — Parser de `Range` e avaliação de intervalo

Cobre: RF-02, RF-04, RF-05, RF-09

Implementar em `src/utils/static.ts`, no bloco `// --- Internal Utils ---`, os helpers privados `parseRangeHeader` e `evaluateRange`, com o tipo `RangeDecision`. Seguir a tabela de D-04: aceitar só `bytes`, sem diferenciar maiúsculas, com uma única spec `N-M`, `N-` ou `-N`, dígitos ASCII. Devolver `partial`, `unsatisfiable` ou `none`. Não exportar nada (RF-09).

Depende de: T-07

Aceite: os casos de T-02 (intervalos válidos), T-03 (416 e ignorados) passam nos modos `web` e `node`. Nenhum símbolo novo aparece em `src/index.ts`.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-09 — Validação de If-Range

Cobre: RF-06

Implementar o helper privado `matchesIfRange` em `src/utils/static.ts`, conforme D-05: ETag forte (começa com `"`, não começa com `W/`, e é idêntico ao `meta.etag`); data comparada por segundo com `mtimeDate`. Valor não reconhecido ou `If-Range` sem `Range` resulta em ignorar o Range. Não reaproveitar `isCacheMatch` (comparação fraca).

Depende de: T-08

Aceite: os casos de If-Range de T-04 passam nos modos `web` e `node`. Se T-00 mudar a regra de P-1, o caso de data no limite de um segundo também é coberto.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-10 — Recorte do corpo para `ReadableStream` e demais tipos

Cobre: RF-02

Implementar em `src/utils/static.ts` os helpers privados `sliceBody` e `sliceStream`, conforme D-08. Stream: descartar `start` bytes e emitir `length` bytes, cancelando a origem ao terminar, sem bufferizar o arquivo inteiro. Outros tipos: `new Response(contents).blob()` seguido de `blob.slice(start, end + 1)`. Não alterar `getContents`.

Depende de: T-08

Aceite: os casos de stream, de `Blob` e de texto multibyte de T-06 passam nos modos `web` e `node`. O corpo recortado tem `content-length` igual ao número de bytes emitidos.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-11 — Integração em `serveStatic`

Cobre: RF-01, RF-02, RF-03, RF-04, RF-07, RF-08

Ligar os helpers em `serveStatic`, conforme o fluxo da techspec seção 4 e D-02 a D-07 e D-09 a D-10. Após o bloco de `content-length` (`src/utils/static.ts:268-270`): definir `accept-ranges: bytes` se ausente; calcular o `RangeDecision` apenas com `size > 0` e sem `content-encoding` efetivo. 416: definir `content-range` e `content-length: 0` e devolver `HTTPResponse` com status 416, sem chamar `getContents`. 206 em HEAD: cabeçalhos de 206 e corpo `null`. 206 em GET: `getContents`, recorte com `sliceBody`, e se `getContents` devolver nada, cair em 200 (D-10). Manter 304, 404, 405, cache e `fallthrough` na ordem atual.

Depende de: T-08, T-09, T-10

Aceite: `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`, incluindo todos os casos novos de T-02 a T-06 e os blocos existentes. Os cabeçalhos de 304 e 200 existentes não mudam.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-12 — Verificação de regressão, API pública e qualidade

Cobre: RF-09, RF-10

Rodar, nesta ordem: `pnpm vitest run test/static.test.ts`; `pnpm vitest run test/unit/package.test.ts` (snapshot de exportações sem mudança); `pnpm vitest run test/security.test.ts` (traversal); `pnpm lint`; `pnpm typecheck`; e por fim `pnpm test` completo. Comparar o conjunto de exportações de `src/index.ts` com o de antes da mudança. Registrar o tamanho final de `src/utils/static.ts` (ver P-4).

Depende de: T-11

Aceite: todos os comandos passam, e a saída de cada um está registrada. Se algum falhar, o motivo vai para a descrição da entrega, sem marcar a tarefa como concluída. O snapshot de `test/unit/package.test.ts` continua idêntico.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`, `test/unit/package.test.ts`
