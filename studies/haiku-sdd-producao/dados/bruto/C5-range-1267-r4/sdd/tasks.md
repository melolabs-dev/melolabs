# Tarefas de implementação: HTTP Range no `serveStatic`

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-08, R-01 a R-10).

Ordem: testes antes da implementação. A regra de correção de bug do `AGENTS.md` (teste vermelho antes do código) vale aqui, conforme `sdd/techspec.md` §5.

Observação: o `Range` é ignorado hoje, então os casos de RF-04 e os casos de 200, 304 e 405 que já funcionam passam antes da implementação. São guardas de regressão. A falha antes da implementação vale para os casos que esperam `206`, `416` ou `accept-ranges`.

Escolhas da techspec adotadas nas tarefas (confirmar antes de T-09): fatiar `ReadableStream` descartando o prefixo (D-05, contra PRD premissa 1); helpers privados em `src/utils/static.ts` (D-01); `accept-ranges` também na 304 (D-03); If-Range por data sem checagem de força (D-04, R-05); `sdd/pedido.md`, citado pela techspec, não estava na pasta no início da sessão e nenhuma tarefa depende dele.

---

### T-01 — Linha de base do projeto

Rodar os checks antes de qualquer mudança e registrar o estado. Salvar a lista de exports de `src/index.ts` em um arquivo do scratchpad, fora do repositório, para comparar em T-13.

**Cobre:** RF-09, RF-10
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static.test.ts`, `pnpm lint` e `pnpm typecheck` terminam sem erro. A lista de exports está salva fora do repositório.
**Arquivos:** nenhum arquivo do projeto é alterado.

---

### T-02 — Fixture e testes de Accept-Ranges e preservação de comportamento

Criar o bloco `describeMatrix("serve static range requests", ...)` em `test/static.test.ts`, com a fixture de `sdd/techspec.md` §5: `"abcdefghij".repeat(100)`, `size: 1000`, `etag: "v1"`, `mtime` fixo, `type: "text/plain"`, e `getContents` como `vi.fn`. Casos:

- `GET` sem `Range`: `200`, corpo completo, `accept-ranges: bytes`.
- `GET` com `If-None-Match: "v1"` e `Range`: `304`, sem `content-range`.
- `POST` com `fallthrough: false`: `405` com `allow: GET, HEAD`.
- Asset inexistente com `fallthrough: true` e `Range`: retorna `undefined`.

**Cobre:** RF-01, RF-07
**Depende de:** T-01
**Aceite:** o caso de `accept-ranges` falha antes da implementação. Os casos de `304`, `405` e `fallthrough` passam antes e depois (guardas).
**Arquivos:** `test/static.test.ts`

---

### T-03 — Testes de resposta `206` no GET

Casos com asset de 1000 bytes, verificando status, `content-range`, `content-length` e o corpo exato:

- `bytes=0-99`: `206`, `bytes 0-99/1000`, `content-length: 100`, corpo com os bytes 0 a 99.
- `bytes=-50`: `206`, `bytes 950-999/1000`, 50 bytes.
- `bytes=990-5000`: `206`, `bytes 990-999/1000`, `content-length: 10`.
- `bytes=-5000`: `206`, `bytes 0-999/1000`, arquivo inteiro.
- `bytes=0-`: `206`, `bytes 0-999/1000`.

**Cobre:** RF-02
**Depende de:** T-02
**Aceite:** os cinco casos falham antes da implementação, com status `200`.
**Arquivos:** `test/static.test.ts`

---

### T-04 — Testes de HEAD com intervalo válido

Caso `HEAD` com `Range: bytes=0-99`: `206`, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo vazio, e `getContents` sem chamada (`expect(getContents).not.toHaveBeenCalled()`).

**Cobre:** RF-03
**Depende de:** T-02
**Aceite:** o caso falha antes da implementação.
**Arquivos:** `test/static.test.ts`

---

### T-05 — Testes de `Range` ignorado

Casos que devem responder `200` completo, sem `content-range`:

- `bytes=0-10,20-30` (múltiplos intervalos).
- `bytes=50-10` (início maior que fim).
- `items=0-10` (unidade diferente).
- `bytes=abc` (sintaxe inválida).
- `getMeta` sem `size`, com `bytes=0-99`.

**Cobre:** RF-04
**Depende de:** T-02
**Aceite:** os casos passam antes e depois (guardas). Eles são o comportamento atual.
**Arquivos:** `test/static.test.ts`

---

### T-06 — Testes de `416` para intervalo não satisfazível

Casos:

- `GET` com `bytes=1000-1100`: `416`, `content-range: bytes */1000`, `content-length: 0`, sem corpo.
- `HEAD` com `bytes=1000-`: `416`, `bytes */1000`, sem corpo.
- `bytes=-0`: `416`.
- Asset de 0 bytes (`size: 0`) com `bytes=0-`: `416`, `bytes */0`.

**Cobre:** RF-05
**Depende de:** T-02
**Aceite:** os casos falham antes da implementação, com status `200`.
**Arquivos:** `test/static.test.ts`

---

### T-07 — Testes de `If-Range`

Casos com `Range: bytes=0-99`:

- `If-Range: "v1"`: `206`.
- `If-Range: "v0"`: `200` completo.
- `If-Range: W/"v1"`: `200` completo.
- `If-Range` com a data igual ao `last-modified`: `206`.
- `If-Range` com data diferente: `200` completo.

**Cobre:** RF-06
**Depende de:** T-02
**Aceite:** os casos que esperam `206` falham antes da implementação. Os que esperam `200` passam antes (guardas).
**Arquivos:** `test/static.test.ts`

---

### T-08 — Testes de variante comprimida e de tipos de corpo

Casos:

- `encodings: { gzip: ".gz" }`, `app.js` com 1000 bytes, `app.js.gz` com 300 bytes, `Accept-Encoding: gzip` e `bytes=0-99`: `206`, `bytes 0-99/300`, `content-encoding: gzip`, `content-type` de `app.js`.
- Corpo `Blob` e corpo `ArrayBuffer` com `Range`: bytes corretos.
- Corpo `ReadableStream` com `bytes=500-599`: `206` com exatamente os bytes 500 a 599.
- String com caractere multibyte e `size` em bytes UTF-8: `206` com os bytes corretos.
- Corpo `FormData` com `Range`: `200` completo.
- `getContents` retorna `null` com `Range` no GET: `200` com corpo `null`.

**Cobre:** RF-08
**Depende de:** T-02
**Aceite:** os casos que esperam `206` falham antes da implementação. Os casos de `FormData` e `null` passam antes (guardas).
**Arquivos:** `test/static.test.ts`

---

### T-09 — Helpers privados de Range

Adicionar, sem `export`, no fim de `src/utils/static.ts` (seção `// --- Internal Utils ---`):

- `type ByteRange` (techspec §4).
- `parseRange(header, size)`, conforme D-02: unidade `bytes` sem diferença de maiúsculas, uma só faixa, formas `a-b`, `a-` e `-n`, e as regras de satisfazibilidade.
- `ifRangeMatches(value, validators)`, conforme D-04: ETag forte, data por `getTime()` contra `mtimeDate`.
- `sliceContents(contents, start, end)`, conforme D-05: tabela de tipos de corpo, com `ReadableStream` descartando o prefixo.

Não alterar o fluxo de `serveStatic` nesta tarefa. Os testes continuam vermelhos até T-10.

**Cobre:** RF-02, RF-04, RF-05, RF-06, RF-09
**Depende de:** T-03, T-04, T-05, T-06, T-07, T-08
**Aceite:** `pnpm typecheck` e `pnpm lint` passam. Nenhum símbolo novo em `src/index.ts`. Os testes de RF-02 a RF-08 seguem vermelhos.
**Arquivos:** `src/utils/static.ts`

---

### T-10 — Integração do Range no fluxo de `serveStatic`

Alterar `serveStatic` seguindo a ordem de D-03:

1. Após o bloco de `etag`, definir `accept-ranges: bytes` (inclusive na `304`).
2. Manter `isCacheMatch` como está, para que a `304` vença sobre `Range`.
3. Decidir o intervalo somente se houver `Range`, `meta.size !== undefined` e `ifRangeMatches` for verdadeiro.
4. Manter `content-type`, `content-encoding` e `content-length` do `200`.
5. Responder `416` (`content-range: bytes */size`, `content-length: 0`, corpo `null`, `statusText` "Range Not Satisfiable") ou `206`.
6. `HEAD` com intervalo válido responde `206` sem chamar `getContents`.
7. `GET` com intervalo válido chama `getContents` e calcula `sliceContents` antes de tocar em `content-range` e `content-length`. Se o resultado for `undefined`, responde o `200` completo sem alterar cabeçalhos (R-10, D-08).
8. No `206`, `content-length` é definido com `set`, substituindo o valor anterior (PRD premissa 4).

**Cobre:** RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
**Depende de:** T-09
**Aceite:** `pnpm vitest run test/static.test.ts` passa em `web` e `node`. Os `200` e as `304` não têm `content-range`.
**Arquivos:** `src/utils/static.ts`

---

### T-11 — Documentar o contrato de `size` e as limitações

Atualizar o JSDoc de `getMeta.size` (`src/utils/static.ts`, perto da linha 25) para dizer que é o tamanho em bytes da variante servida, e que para `string` é o tamanho UTF-8 (R-01, R-09). No JSDoc de `serveStatic`, documentar:

- `Range` só vale quando `size` é conhecido.
- `ReadableStream` é lido e descartado até `start` (R-02).
- Variantes comprimidas recebem intervalos sobre os bytes comprimidos (R-04).
- `HEAD` e `GET` podem diferir para corpos não fatiáveis (R-08).

**Cobre:** RF-08
**Depende de:** T-10
**Aceite:** o JSDoc está presente e `pnpm lint` passa. `pnpm vitest run test/static.test.ts` continua verde.
**Arquivos:** `src/utils/static.ts`

---

### T-12 — Ajustar testes existentes apenas se quebrarem

Rodar `test/static.test.ts`. Se um teste existente falhar só porque agora há `accept-ranges`, ajustar apenas a asserção de cabeçalho, sem remover o que o teste verifica (PRD RF-10, premissa 5). Os trechos mais prováveis de quebrar, segundo a techspec, são `test/static.test.ts:600-617` e os blocos de comparação de cabeçalhos. Confirmar no próprio arquivo.

**Cobre:** RF-01, RF-10
**Depende de:** T-10
**Aceite:** `pnpm vitest run test/static.test.ts` passa. Nenhuma asserção original foi removida, só ajustada.
**Arquivos:** `test/static.test.ts`

---

### T-13 — Verificação final

Rodar:

- `pnpm vitest run test/static.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm vitest run` (suíte completa, incluindo `test/rules/` e `test/unit/package.test.ts`)

Comparar a lista de exports de `src/index.ts` com a salva em T-01. Registrar quais casos de T-03 a T-08 falharam antes da implementação.

**Cobre:** RF-09, RF-10
**Depende de:** T-11, T-12
**Aceite:** todos os comandos passam. Não há diferença nos exports públicos. O registro de falhas prévias está disponível para o relatório.
**Arquivos:** nenhum arquivo do projeto além dos listados nas tarefas anteriores.

---

## Cobertura dos requisitos

| RF | Tarefas |
| --- | --- |
| RF-01 | T-02, T-10, T-12 |
| RF-02 | T-03, T-09, T-10 |
| RF-03 | T-04, T-10 |
| RF-04 | T-05, T-09 |
| RF-05 | T-06, T-09, T-10 |
| RF-06 | T-07, T-09, T-10 |
| RF-07 | T-02, T-10 |
| RF-08 | T-08, T-10, T-11 |
| RF-09 | T-01, T-09, T-13 |
| RF-10 | T-01, T-12, T-13 |
