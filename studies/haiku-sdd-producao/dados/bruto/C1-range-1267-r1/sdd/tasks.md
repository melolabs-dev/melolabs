# Tarefas de implementação: HTTP Range em `serveStatic`

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09, R-01 a R-10).

Premissas adotadas, seguindo as recomendações da techspec (pontos em aberto):
- R-04: os testes de Range usam fixture separado, sem `encodings` e sem `encoding` em meta.
- R-07: os helpers ficam em `src/utils/static.ts` (D-01).

Ordem de trabalho: a T-01 escreve os casos novos e eles devem falhar antes de qualquer implementação (fluxo de correção de `AGENTS.md`).

## Mapa de cobertura

| Requisito | Tarefas |
| --------- | ------- |
| RF-01 | T-01, T-06 |
| RF-02 | T-01, T-02, T-05, T-06 |
| RF-03 | T-01, T-03, T-06 |
| RF-04 | T-01, T-03, T-06 |
| RF-05 | T-01, T-03, T-06 |
| RF-06 | T-01, T-06 |
| RF-07 | T-01, T-04 |
| RF-08 | T-01, T-07 |
| RF-09 | T-01, T-04, T-07 |
| RF-10 | T-08 |
| RF-11 | T-01, T-09 |

---

### T-01 — Escrever os testes de Range (vermelhos)

Cria o bloco `describeMatrix` no fim de `test/static.test.ts`, com fixture separada (sem `encodings`, sem `encoding` em meta), e cobre os casos da tabela de testes da techspec. Inclui: GET e HEAD sem Range, intervalo fechado, aberto, sufixo, limite ajustado, 416, Range ignorado (unidade, sintaxe, multi-range, `size` zero ou ausente), `If-Range` (ETag forte, fraco, data), precedência com 304 e 405, pré-comprimido, string multibyte, `Blob`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` com chunks cruzando `start` e `end`, e `content-length` de `options.headers` sobrescrito em 206. Para HEAD com Range válido, usa `vi.fn` em `getContents` e verifica que não foi chamado. Os casos com `encodings` enviam `accept-encoding: identity` (R-06).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-11

Depende de: nenhuma

Aceite:
- `pnpm vitest run test/static.test.ts` executa os casos novos nos dois alvos (`web` e `node`).
- Os casos de comportamento novo falham antes de qualquer alteração em `src/utils/static.ts`. Os casos existentes continuam passando.
- Cada caso da tabela da techspec aparece como um `it` com nome que indica o RF correspondente.

Arquivos: `test/static.test.ts`

---

### T-02 — Atualizar a JSDoc de `getMeta` e `getContents`

Documenta o contrato novo: `size` é o número de bytes do conteúdo que `getContents` devolve (para string, bytes UTF-8 e não caracteres); `getContents` devolve o conteúdo completo, mesmo para pedidos com Range; o custo de ler e descartar bytes antes do início, para `ReadableStream`, fica a cargo de quem implementa `getContents` (R-01). Não muda assinatura nem tipo.

Cobre: RF-02

Depende de: nenhuma

Aceite:
- A JSDoc em `src/utils/static.ts` (faixa `:19-33`) descreve os três pontos acima.
- `git diff` mostra só comentários alterados nesse trecho.
- `pnpm lint` passa.

Arquivos: `src/utils/static.ts`

---

### T-03 — Implementar `parseByteRange`

Função privada, pura, no fim de `src/utils/static.ts` (seção `// --- Internal Utils ---`). Recebe o valor do cabeçalho `Range` e `size`, e devolve `ByteRange`, `"unsatisfiable"` ou `undefined`. Aceita apenas `bytes=<a>-<b>`, `bytes=<a>-` e `bytes=-<n>`, com unidade case-insensitive, sem espaços e sem vírgula. `<b>` menor que `<a>` e ambos vazios são inválidos (ignorar). `<b>` maior ou igual ao tamanho é ajustado para `size - 1`. Sufixo maior que `size` vira o arquivo inteiro. Início maior ou igual ao tamanho e sufixo `0` são `"unsatisfiable"`.

Cobre: RF-03, RF-04, RF-05

Depende de: T-01

Aceite:
- Os casos de RF-03 (`900-`, `-50`, `950-5000` em 1000 bytes) e de RF-04 (`1000-1010`, `-0`) passam na parte de parse.
- `items=0-5`, `bytes=abc`, `bytes=0-1,5-9` e `bytes=5-2` devolvem `undefined`.
- Nenhuma exportação nova em `src/index.ts`.

Arquivos: `src/utils/static.ts`

---

### T-04 — Implementar `matchesIfRange` e `resolveRange`

`matchesIfRange(event, ifRange, etag)`: se o valor começa com `"` ou `W/"`, só vale para ETag forte (sem `W/`) igual a `meta.etag`, comparação exata. Caso contrário, compara como string com `event.res.headers.get("last-modified")`. `resolveRange(event, size, etag)` lê `range` e `if-range`, devolve `undefined` quando não há `Range`, quando `event.res.headers.has("content-encoding")` (D-05) ou quando `If-Range` não bate; caso contrário chama `parseByteRange`.

Cobre: RF-07, RF-09

Depende de: T-03

Aceite:
- `If-Range: "abc"` com ETag `"abc"` resulta em range de 0 a 9.
- `If-Range: "xyz"` e `If-Range: W/"abc"` resultam em `undefined`.
- `If-Range` com data igual ao `last-modified` vale; data diferente não vale.
- Com `content-encoding` já definido em `event.res.headers`, o Range é ignorado.

Arquivos: `src/utils/static.ts`

---

### T-05 — Implementar `sliceBody` e `sliceStream`

`sliceBody(body, range)` trata os tipos da tabela D-02: `null`/`undefined` viram `null`; `string` é codificada com `textEncoder` (UTF-8, de `src/utils/internal/encoding.ts`) e fatiada em bytes; `ArrayBuffer` e views (`ArrayBuffer.isView`) viram `Uint8Array` e são fatiados com `subarray`; `Blob` usa `slice(start, end + 1)`; `ReadableStream` usa `sliceStream`; os demais (`FormData`, `URLSearchParams`) passam por `new Response(body).blob()` e depois `slice`. `sliceStream(stream, range)` lê e descarta até `start`, emite até `end` e cancela o restante, sem bufferizar o conteúdo inteiro.

Cobre: RF-02

Depende de: T-01

Aceite:
- O mesmo trecho sai idêntico para string, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream`.
- String com caracteres multibyte (ex.: `"ação"`) fatia por bytes UTF-8.
- Chunks do stream que cruzam `start` e `end` produzem o trecho exato, e o restante do stream é cancelado.

Arquivos: `src/utils/static.ts`

---

### T-06 — Integrar Range em `serveStatic`

Altera o fluxo de `serveStatic` conforme o esboço da techspec, depois do bloco de 304 e de `content-encoding` (D-04): `event.res.headers.set("accept-ranges", "bytes")` em toda resposta de asset que não é 304 (D-06); chama `resolveRange` apenas se `meta.size` for truthy; para `"unsatisfiable"` grava `content-range: bytes */<size>` e `content-length: 0` e retorna 416 com corpo `null`; para range válido grava `content-range` e `content-length` com `event.res.headers.set`, sobrescrevendo o valor de `meta.size` (D-03); HEAD retorna o status resolvido sem chamar `getContents` (D-09); GET chama `getContents` e usa `sliceBody` para 206. Não altera `isCacheMatch`, `Vary`, 404, 405 nem `fallthrough` (D-07).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06

Depende de: T-03, T-04, T-05

Aceite:
- Os casos de T-01 de 200 com `accept-ranges`, 206 (GET e HEAD), 416 e Range ignorado passam nos dois alvos.
- Em HEAD com Range válido ou 416, o `getContents` mock não é chamado.
- `options.headers` com `content-length: 999` e Range válido resulta em `content-length` correto no 206.
- A 416 e a 404 não passam pelo caminho de `getContents`.

Arquivos: `src/utils/static.ts`

---

### T-07 — Verificar precedência e compatibilidade com pré-comprimido

Sem alterar o comportamento esperado: confirma que o 304 vence Range, que POST com Range continua 405 com `allow: GET, HEAD`, que o 404 para asset inexistente e o 404 de caminho não canônico não mudam, e que `fallthrough` segue igual. Confirma que variante `.gz` (ou `meta.encoding`) com Range resulta em 200 completo, com `content-encoding`, `vary: accept-encoding` e corpo da variante. Se algum caso falhar, corrige apenas em `serveStatic`, no mínimo necessário para RF-08.

Cobre: RF-08, RF-09

Depende de: T-06

Aceite:
- Os casos de precedência e de pré-comprimido de T-01 passam nos dois alvos.
- O diff de `serveStatic` nas linhas anteriores ao bloco novo está vazio, ou restrito ao necessário para RF-08 (ver `git diff`).
- Os testes existentes de `test/static.test.ts` continuam passando sem ajuste (techspec, "Testes existentes").

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-08 — Garantir que nenhuma exportação pública mudou

Roda o snapshot de exports e compara a lista de nomes de `src/index.ts` e dos entries em `src/_entries/` antes e depois da mudança. Não adiciona nenhum nome; se o snapshot de `test/unit/package.test.ts` precisar mudar, a mudança é um bug e não deve ser aceita.

Cobre: RF-10

Depende de: T-02, T-06

Aceite:
- `pnpm vitest run test/unit/package.test.ts` passa sem alteração no snapshot.
- Os exports listados em `src/index.ts` e `src/_entries/` são idênticos aos do commit base (`4dc9dda`).
- `git diff` não toca `src/index.ts` nem `src/_entries/`.

Arquivos: `test/unit/package.test.ts`, `src/index.ts`, `src/_entries/`

---

### T-09 — Verificação final

Roda a suíte de Static, o lint com typecheck e a suíte completa. Confere os critérios de aceite de RF-11 e registra eventuais falhas com a saída.

Cobre: RF-11

Depende de: T-07, T-08

Aceite:
- `pnpm vitest run test/static.test.ts` passa nos alvos `web` e `node`.
- `pnpm lint` passa (oxlint, oxfmt --check e typecheck).
- `pnpm test` passa (lint, typecheck e coverage). Se algo falhar, o relatório diz o que falhou e com qual saída.
- Os itens pendentes dos riscos R-09 (Bun, Deno, Workers fora da matriz) ficam registrados como pendência, não como verificados.

Arquivos: `test/static.test.ts`, `src/utils/static.ts`
