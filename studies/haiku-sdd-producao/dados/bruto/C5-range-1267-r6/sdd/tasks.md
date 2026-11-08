# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-14) e `sdd/techspec.md` (D-01 a D-09).

Ordem segue o fluxo de bug/feature do AGENTS.md: primeiro os testes, com falha confirmada, depois a implementação.

- T-02 a T-09 alteram só `test/static.test.ts` e devem ser feitas em sequência.
- T-11 a T-14 alteram `src/utils/static.ts` e também devem ser feitas em sequência.

---

### T-01 — Preparar ambiente e registrar linha de base

Cobre: RF-14
Depende de: nenhuma
Aceite: `corepack enable && pnpm install` conclui. `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck` são executados separadamente (o `pnpm lint` do `package.json` não faz typecheck). O resultado de base é anotado, com as falhas que já existem antes da mudança. Nenhum arquivo do projeto é alterado.
Arquivos: nenhum arquivo do projeto (apenas `node_modules/`, instalado pelo pnpm)

---

### T-02 — Testes de Accept-Ranges e precedência do 304

Cobre: RF-01, RF-09, RF-11
Depende de: T-01
Aceite: criar o bloco `describeMatrix("serve static range", ...)` em `test/static.test.ts`, depois da linha 678, com fixture de 1000 bytes determinístico (`i % 256`). Casos:
- `accept-ranges: bytes` em GET 200 sem Range e em HEAD sem Range;
- `accept-ranges` ausente em 304;
- `Range: bytes=0-99` com `If-None-Match: "v1"` resulta em 304 sem corpo.

O teste de `accept-ranges` em 200/HEAD deve falhar agora. Os casos de 304 devem passar, porque é comportamento já existente. Os testes rodam nos modos `web` e `node`.
Arquivos: `test/static.test.ts`

---

### T-03 — Testes de intervalos válidos em GET

Cobre: RF-02, RF-03, RF-04
Depende de: T-02
Aceite: com o fixture de 1000 bytes, comparar o corpo byte a byte:
- `bytes=100-199` → 206, `content-range: bytes 100-199/1000`, `content-length: 100`, bytes 100 a 199;
- `bytes=990-` → 206, bytes 990 a 999;
- `bytes=-100` → 206, bytes 900 a 999;
- `bytes=-5000` → 206, `content-range: bytes 0-999/1000`, `content-length: 1000`;
- `bytes=900-5000` → 206, `content-range: bytes 900-999/1000`, `content-length: 100`;
- `bytes=0-99999999999999999999` → limitado a `bytes 0-999/1000` (Risco 6 do techspec).

Esses testes devem falhar antes da implementação.
Arquivos: `test/static.test.ts`

---

### T-04 — Testes de Range ignorado e de 416

Cobre: RF-05, RF-06
Depende de: T-03
Aceite: com o fixture de 1000 bytes:
- `bytes=abc`, `items=0-5`, `bytes=500-100`, `bytes=0-10,20-30` e `bytes=-` → 200, sem `content-range`, corpo completo;
- `BYTES=0-9` → 206 (a unidade não diferencia maiúsculas, D-02);
- `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio;
- `bytes=-0` → 416 (D-02);
- asset de tamanho 0 (`getMeta` com `size: 0`) com `bytes=0-` → 416, `content-range: bytes */0`.

Os casos de 416 e de 206 devem falhar antes da implementação. Os casos de 200 para Range malformado já passam hoje.
Arquivos: `test/static.test.ts`

---

### T-05 — Testes de HEAD com Range

Cobre: RF-07
Depende de: T-04
Aceite:
- HEAD com `bytes=100-199` → 206, `content-range: bytes 100-199/1000`, `content-length: 100`, corpo vazio;
- HEAD com `bytes=1000-1100` → 416, `content-range: bytes */1000`, corpo vazio;
- HEAD com `bytes=abc` → 200, sem `content-range`.

Os dois primeiros devem falhar antes da implementação.
Arquivos: `test/static.test.ts`

---

### T-06 — Testes de If-Range

Cobre: RF-08
Depende de: T-05
Aceite: asset com ETag forte `"v1"` e `Last-Modified` fixo, todos com `Range: bytes=0-99`:
- `If-Range: "v1"` → 206 com os 100 primeiros bytes;
- `If-Range: "v0"` → 200 com o asset completo;
- `If-Range: W/"v1"` → 200 com o asset completo (ETag fraco nunca bate);
- `If-Range` com a data `Last-Modified` exata (truncada em segundos) → 206;
- `If-Range` com outra data → 200;
- asset sem etag e sem mtime com `If-Range` qualquer → 200.

Os casos de 206 devem falhar antes da implementação. Os casos de 200 já passam hoje.
Arquivos: `test/static.test.ts`

---

### T-07 — Testes de tamanho desconhecido ou inválido

Cobre: RF-10
Depende de: T-06
Aceite:
- `getMeta` sem `size` com `Range: bytes=0-99` → 200 com o corpo completo, sem `content-range`;
- `size: NaN` e `size: -1` com o mesmo Range → 200, sem `content-range`.

Os testes rodam nos modos `web` e `node`.
Arquivos: `test/static.test.ts`

---

### T-08 — Testes de fatiamento por tipo de corpo

Cobre: RF-02
Depende de: T-07
Aceite: para cada tipo que `getContents` pode devolver (`string` com caracteres multibyte, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream`), com 1000 bytes determinísticos e `Range: bytes=100-199`, o corpo de resposta é exatamente os bytes 100 a 199, comparados byte a byte. Para `FormData`, basta checar status 206 e cabeçalhos. Teste adicional: ao consumir o intervalo até o fim, o `cancel` do `underlyingSource` do `ReadableStream` é chamado (spy).
Arquivos: `test/static.test.ts`

---

### T-09 — Testes de encoding pré-comprimido, options.headers e preservação

Cobre: RF-11, RF-12
Depende de: T-08
Aceite:
- com `encodings: { gzip: ".gz" }`, `app.js.gz` de 400 bytes, `accept-encoding: gzip` e `Range: bytes=0-99` → 206, `content-encoding: gzip`, `content-range: bytes 0-99/400`, `content-length: 100`, `vary` contendo `accept-encoding`;
- `options.headers` com `content-length: 999` mais Range → 206 com `content-length: 100` (D-06);
- asset inexistente com Range → 404 inalterado;
- POST com Range → 405 inalterado;
- `fallthrough` com Range em asset inexistente → cai no próximo handler.

Os casos de 404, 405 e fallthrough já passam hoje e servem de guarda.
Arquivos: `test/static.test.ts`

---

### T-10 — Confirmar que os testes novos falham antes da implementação

Cobre: RF-14
Depende de: T-09
Aceite: `pnpm vitest run test/static.test.ts` é executado e a saída é anotada. Os testes de 206, 416, `accept-ranges` em 200/HEAD, HEAD com Range e `If-Range` com 206 devem falhar. Os casos de 200, 304, 404, 405 e fallthrough devem passar. Se um teste novo de intervalo passar sem implementação, o teste está errado e deve ser revisto antes de seguir. Nenhum código de `src/` é alterado nesta tarefa.
Arquivos: nenhum arquivo alterado (apenas execução de testes)

---

### T-11 — Implementar o parser de Range e a avaliação de If-Range

Cobre: RF-03, RF-04, RF-05, RF-06, RF-08
Depende de: T-10
Aceite: em `src/utils/static.ts` existem as funções privadas `parseByteRange(value, size)` e `matchesIfRange(ifRange, validators)`, conforme D-02, D-08, D-09 e a seção de contratos do techspec:
- unidade `bytes` sem diferenciar maiúsculas (`/^bytes\s*=/i`);
- formas `a-b`, `a-` e `-n`; vírgula, malformação ou `a > b` devolvem `undefined`;
- `b` é limitado a `size - 1`; `-n` com `n > size` vira o arquivo inteiro;
- início `a >= size`, tamanho 0 e `-0` devolvem `"unsatisfiable"`;
- If-Range só bate com ETag forte igual ao atual (nunca `W/`) ou data exata; sem validador, não bate.

Nenhuma das funções é exportada. `pnpm typecheck` e `pnpm lint` passam. Os testes de integração continuam falhando até T-14, o que é esperado.
Arquivos: `src/utils/static.ts`

---

### T-12 — Implementar o fatiamento do corpo sem materializá-lo

Cobre: RF-02
Depende de: T-11
Aceite: `sliceBody(body, range)` e `sliceStream(stream, range)` existem como funções privadas, conforme D-05:
- `string`: codificação UTF-8 e corte por bytes;
- `Blob`: `blob.slice(start, end + 1)`;
- `ArrayBuffer` e `ArrayBufferView`: `Uint8Array` sobre a janela, com `subarray`;
- `ReadableStream`: descarta `start` bytes, emite `length` bytes e cancela o reader ao terminar;
- demais tipos: `new Response(body).body` e o caminho de stream.

`pnpm typecheck` e `pnpm lint` passam. Os testes de T-08 só passam após T-14.
Arquivos: `src/utils/static.ts`

---

### T-13 — Integrar Accept-Ranges, a ordem com o 304 e a resposta 416

Cobre: RF-01, RF-06, RF-09, RF-11
Depende de: T-11
Aceite: em `serveStatic`, após o bloco de `content-length` e antes do `if (event.req.method === "HEAD")`:
- `accept-ranges: bytes` é definido só quando ausente (D-04), o que mantém 304 sem o cabeçalho;
- a validação de 304 continua antes do Range (D-03, RF-09);
- o `If-Range` é avaliado antes do parse; se não bater, o Range é ignorado inteiro;
- o caso insatisfazível devolve 416 com `content-range: bytes */size` e `content-length: 0` via `event.res.headers.set`, sem chamar `getContents`.

Passam os testes de T-02 (accept-ranges e 304), T-04 (416 e casos de 200), T-05 (HEAD com 416) e T-06 (If-Range que dá 200). Os testes de 206 continuam falhando até T-14.
Arquivos: `src/utils/static.ts`

---

### T-14 — Integrar as respostas 206 em GET e HEAD

Cobre: RF-02, RF-07, RF-10, RF-12
Depende de: T-12, T-13
Aceite: em `serveStatic`:
- para intervalo satisfazível, `content-range` e `content-length` são definidos com `set` (D-06), mesmo quando já existem em `options.headers`;
- em GET, `getContents` é chamado uma única vez e, se devolver `null` ou `undefined`, a resposta cai no 200 (D-07);
- em GET, o corpo é `sliceBody`; em HEAD, não há corpo;
- `size` inválido ou ausente faz o Range ser ignorado (D-09, RF-10);
- com `encodings`, o Range se refere à variante escolhida e usa o `size` dela (RF-12).

Passam todos os testes de T-03, T-05, T-07, T-08 e T-09 (caso de 206 com encoding e `options.headers`).
Arquivos: `src/utils/static.ts`

---

### T-15 — Regressão da suíte existente de serveStatic

Cobre: RF-11
Depende de: T-14
Aceite: `pnpm vitest run test/static.test.ts` passa inteiro. Se um teste existente quebrar, ele só é ajustado quando verifica um comportamento que a mudança altera de forma intencional. Cada ajuste é listado para a descrição do PR. Confirmar que o caso sem Range de `test/static.test.ts:600-617` continua válido. Respostas sem Range devem ser idênticas às de antes nos headers `etag`, `last-modified`, `content-type`, `content-encoding`, `vary` e nos headers de `options.headers`.
Arquivos: `src/utils/static.ts` (somente se houver correção), `test/static.test.ts` (somente os testes que mudam de forma intencional)

---

### T-16 — Garantir que a API pública não muda

Cobre: RF-13
Depende de: T-14
Aceite:
- `git diff -- src/index.ts` está vazio;
- `ServeStaticOptions`, `getMeta` e `getContents` não ganham campos nem parâmetros;
- `pnpm vitest run test/unit/package.test.ts test/security.test.ts` passa sem alteração no `test/unit/package.test.ts`;
- as funções novas não têm `export`.
Arquivos: `src/index.ts` (somente leitura), `test/unit/package.test.ts` (somente leitura), `src/utils/static.ts` (verificação)

---

### T-17 — Verificação final: lint, typecheck e suíte completa

Cobre: RF-14
Depende de: T-15, T-16
Aceite:
- `pnpm lint` sem erros;
- `pnpm typecheck` sem erros;
- `pnpm vitest run` (suíte completa) passa;
- os testes de Range passam nos modos `web` e `node`.

Se o `oxfmt --check` reclamar, formatar só os arquivos tocados e revisar o diff, sem rodar `pnpm fmt` (ele também roda `automd`, que altera outros arquivos). Os resultados são reportados com a saída dos comandos.
Arquivos: `src/utils/static.ts`, `test/static.test.ts` (formatação, se necessário)

---

## Cobertura dos requisitos

| RF | Tarefas |
| --- | --- |
| RF-01 | T-02, T-13 |
| RF-02 | T-03, T-08, T-12, T-14 |
| RF-03 | T-03, T-11 |
| RF-04 | T-03, T-11 |
| RF-05 | T-04, T-11 |
| RF-06 | T-04, T-11, T-13 |
| RF-07 | T-05, T-14 |
| RF-08 | T-06, T-11 |
| RF-09 | T-02, T-13 |
| RF-10 | T-07, T-14 |
| RF-11 | T-02, T-09, T-13, T-15 |
| RF-12 | T-09, T-14 |
| RF-13 | T-16 |
| RF-14 | T-01, T-10, T-17 (e os testes de todas as tarefas de teste rodam nos modos `web` e `node`) |

## Fora das tarefas

- Documentação opcional em `docs/2.utils/2.response.md` (techspec, seção Documentação). Não é requisito do PRD; pode ficar fora do PR.
- Decisão D-01 (lógica no próprio `src/utils/static.ts`, que passa de 200 LoC) continua a ser confirmada pelo time, conforme o techspec.
