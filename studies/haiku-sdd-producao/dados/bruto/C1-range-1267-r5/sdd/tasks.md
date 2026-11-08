# Tarefas: HTTP Range no `serveStatic`

Base: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (D-01 a D-10, casos de teste 1 a 15, R-01 a R-10).

Ordem de trabalho: os testes são escritos primeiro e precisam falhar antes da implementação (fluxo de correção de bug em `AGENTS.md`). Por isso as tarefas de implementação dependem das tarefas de teste.

## Mapa de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-13 |
| RF-02 | T-03, T-09, T-12, T-13 |
| RF-03 | T-03, T-11 |
| RF-04 | T-03, T-11 |
| RF-05 | T-04, T-12, T-13 |
| RF-06 | T-05, T-09, T-11, T-13 |
| RF-07 | T-05, T-11 |
| RF-08 | T-06, T-11, T-13 |
| RF-09 | T-02, T-13 |
| RF-10 | T-07, T-13 |
| RF-11 | T-08, T-13 |
| RF-12 | T-10, T-14 |
| RF-13 | T-01, T-14 |

---

### T-01 — Criar arquivo de teste com fixture comum

Cria `test/static-range.test.ts` com `describeMatrix("serve static range", ...)`, seguindo o padrão de `test/static.test.ts:5`. A fixture é um asset de 1000 bytes com conteúdo determinístico (`Uint8Array` com `i % 256`), `size: 1000`, `etag: '"abc"'` e `mtime` fixo. `getContents` é um `vi.fn` para verificar chamadas. Nenhum caso de comportamento nesta tarefa; só a base e um helper para enviar requisições com cabeçalhos.

Cobre: RF-13
Depende de: nenhuma
Aceite: `pnpm vitest run test/static-range.test.ts` executa sem erro de importação ou sintaxe nos dois runtimes (web e node), mesmo com zero casos de comportamento.
Arquivos: `test/static-range.test.ts`

---

### T-02 — Testes de `Accept-Ranges` e de asset sem tamanho

Casos 1 e 9 da especificação. Verifica `accept-ranges: bytes` em `200` e em `206`. Verifica que `accept-ranges` está ausente quando `getMeta` não traz `size` ou traz `size: 0`, e nesse caso a resposta é `200` com o arquivo inteiro. Esses testes devem falhar antes da implementação.

Cobre: RF-01, RF-09
Depende de: T-01
Aceite: os casos rodam em web e node e falham antes de T-13 (confirmar a falha antes de implementar).
Arquivos: `test/static-range.test.ts`

---

### T-03 — Testes de faixa válida com 206

Casos 2, 3 e 4 da especificação. `bytes=0-99` devolve `206`, `content-range: bytes 0-99/1000`, `content-length: 100` e exatamente os bytes 0 a 99. `bytes=900-` devolve `bytes 900-999/1000`. `bytes=-200` devolve `bytes 800-999/1000`. `bytes=500-9999` devolve `bytes 500-999/1000` com `content-length: 500`. Esses testes devem falhar antes da implementação.

Cobre: RF-02, RF-03, RF-04
Depende de: T-01
Aceite: os quatro cenários passam a ser verdadeiros depois de T-13 e falham antes; o corpo é comparado byte a byte com a fixture.
Arquivos: `test/static-range.test.ts`

---

### T-04 — Testes de HEAD com Range

Caso 5 da especificação. HEAD com `bytes=0-99` devolve `206`, `content-range: bytes 0-99/1000`, `content-length: 100` e corpo vazio. Verifica também que `getContents` não é chamado nessa requisição (o HEAD não lê o corpo).

Cobre: RF-05
Depende de: T-01
Aceite: `expect(getContents).not.toHaveBeenCalled()` passa depois de T-13; o teste falha antes da implementação.
Arquivos: `test/static-range.test.ts`

---

### T-05 — Testes de `416` e de `Range` ignorado

Casos 6 e 7 da especificação, e o limite do caso 15. `bytes=1000-1100`, `bytes=-0` e `bytes=5-2` devolvem `416`, `content-range: bytes */1000`, `content-length: 0` e corpo vazio. `bytes=0-10,20-30`, `items=0-10` e `bytes=abc` devolvem `200` completo, `content-length: 1000` e sem `content-range`. Inclui o limite de um byte: com `size: 1`, `bytes=0-0` devolve `206` e `bytes=1-` devolve `416`.

Cobre: RF-06, RF-07
Depende de: T-01
Aceite: todos os cenários são executados nos dois runtimes; falham antes da implementação.
Arquivos: `test/static-range.test.ts`

---

### T-06 — Testes de `If-Range`

Caso 8 da especificação. Com ETag `"abc"` e `Range: bytes=0-99`: `If-Range: "xyz"` devolve `200`; `If-Range: "abc"` devolve `206`; `If-Range: W/"abc"` devolve `200` (ETag fraco nunca casa). Para data, `If-Range` igual ao `Last-Modified` devolve `206` e data diferente devolve `200`.

Cobre: RF-08
Depende de: T-01
Aceite: os cinco cenários passam depois de T-13 e falham antes; a data de `If-Range` é gerada a partir do mesmo `mtime` fixo da fixture.
Arquivos: `test/static-range.test.ts`

---

### T-07 — Testes de precedência com 304, 405 e fallthrough

Caso 10 da especificação. `If-None-Match: "abc"` com `Range` devolve `304`, como hoje. POST para o asset devolve `405` com `allow: GET, HEAD`, independentemente de `Range`. Asset inexistente com `fallthrough: true` e `Range` devolve `undefined`.

Cobre: RF-10
Depende de: T-01
Aceite: os três cenários passam depois de T-13. Os de `304` e `405` devem passar até antes da implementação, porque o comportamento atual já é esse; o teste serve de guarda.
Arquivos: `test/static-range.test.ts`

---

### T-08 — Testes de encoding e de tipos de corpo

Casos 11 e 12 da especificação. Variante `.gz` escolhida por `Accept-Encoding: gzip` com `Range` devolve `200` completo, `content-encoding: gzip` e sem `content-range`. `meta.encoding` definido também ignora `Range`. Para `bytes=10-19`, os tipos `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream` e `FormData` devolvem os mesmos 10 bytes. Para `ReadableStream`, um `pull` contado confirma que o recorte não lê o corpo inteiro.

Cobre: RF-11, RF-02
Depende de: T-01
Aceite: os tipos de corpo passam nos dois runtimes, ou a diferença entre runtimes fica documentada no teste com `it.skipIf` (ver R-09). O teste de `pull` contado é o que prova o recorte por stream.
Arquivos: `test/static-range.test.ts`

---

### T-09 — Testes de cabeçalhos em `206` e `416`

Casos 13 e 14 da especificação. `etag`, `last-modified` e `content-type` do `200` são preservados no `206`. `content-length` definido pelo usuário em `options.headers` é sobrescrito em `206` e em `416`. O teste existente `test/static.test.ts:600-617` continua cobrindo o caso `200`, sem alteração.

Cobre: RF-02, RF-06
Depende de: T-01
Aceite: o `content-length` do usuário (com o valor do arquivo inteiro) não aparece na resposta `206` nem na `416`; o `200` continua respeitando o valor do usuário, como em `test/static.test.ts:600-617`.
Arquivos: `test/static-range.test.ts`

---

### T-10 — Linha de base de exports públicos

Confirma o snapshot atual dos exports antes de qualquer mudança. Roda `pnpm vitest run test/unit/package.test.ts` e registra o resultado como linha de base. Não altera `src/index.ts` (RF-12). Esta tarefa não depende das outras e serve de comparação na conclusão.

Cobre: RF-12
Depende de: nenhuma
Aceite: o teste de exports passa antes de qualquer alteração em `src/`.
Arquivos: `test/unit/package.test.ts` (somente leitura)

---

### T-11 — Helpers de interpretação de `Range` e `If-Range`

Implementa, como funções privadas no fim de `src/utils/static.ts` (D-01, RF-12), as funções `parseRangeHeader`, `isIfRangeMatch` e `resolveRange`, com os tipos `ByteRange` e a expressão `RANGE_RE = /^bytes=(\d*)-(\d*)$/` (D-03). `bytes=5-2` devolve `"unsatisfiable"` (R-01: segue o PRD, não a RFC). `If-Range` começando com `"` ou `W/` é tratado como ETag forte; caso contrário, como data (D-04). Não exporta nada novo.

Cobre: RF-03, RF-04, RF-06, RF-07, RF-08
Depende de: T-03, T-05, T-06
Aceite: os testes de T-03, T-05 e T-06 que dependem de parsing passam; `src/index.ts` não muda (T-14 confirma).
Arquivos: `src/utils/static.ts`

---

### T-12 — Fatiamento do corpo e montagem do `206`

Implementa, também privados em `src/utils/static.ts`, `sliceBody`, `sliceStream` e `toPartialResponse` (techspec, contratos). Tratamento por tipo de `BodyInit` conforme D-05: `Blob` com `slice`; `ReadableStream` com `sliceStream`, que pula `start` bytes, emite `length` bytes e cancela a origem ao fim; `string` e views com `subarray`; `FormData` e `URLSearchParams` materializados. `toPartialResponse` define `content-range` e `content-length` com `set` (D-07) e usa `statusText: "Partial Content"` (D-10).

Cobre: RF-02, RF-05
Depende de: T-04, T-08, T-09
Aceite: os casos de T-04 (HEAD sem corpo), T-08 (tipos de corpo e recorte por stream) e T-09 (cabeçalhos) passam nos dois runtimes.
Arquivos: `src/utils/static.ts`

---

### T-13 — Integrar Range ao fluxo de `serveStatic`

Liga T-11 e T-12 ao fluxo de `serveStatic`, entre o `content-length` atual (`src/utils/static.ts:268-270`) e o retorno de HEAD (`src/utils/static.ts:272-274`), seguindo o bloco de "Fluxo" da techspec. A ordem é: `304` (já existente) antes de `Range` (D-02); `accept-ranges` só quando `size > 0` e sem `content-encoding` (D-06, R-02); `416` antes do HEAD; HEAD com faixa sem `getContents` (D-09 para `null`); `Range` sem `contents` cai no `200` atual. Também documenta em `StaticAssetMeta.size` que o valor é o tamanho em bytes do corpo devolvido por `getContents` (R-04). Só comentário.

Cobre: RF-01, RF-02, RF-05, RF-06, RF-08, RF-09, RF-10, RF-11
Depende de: T-11, T-12
Aceite: todos os testes de `test/static-range.test.ts` passam nos dois runtimes; `pnpm vitest run test/static.test.ts` continua passando sem alterações no arquivo de teste.
Arquivos: `src/utils/static.ts`

---

### T-14 — Regressão, exports e verificação final

Roda a verificação completa: `pnpm vitest run test/static.test.ts test/static-range.test.ts`, `pnpm vitest run test/unit/package.test.ts` (compara com a linha de base de T-10), `pnpm vitest run test/rules/cache.test.ts` (confirma que o bypass de `Range` no cache não mudou), `pnpm typecheck`, `pnpm lint` (oxlint e oxfmt --check) e, por fim, `pnpm test` com cobertura. Confirma que `src/index.ts` não mudou (`git diff --stat src/index.ts` vazio) e que nenhum nome novo foi exportado.

Cobre: RF-12, RF-13
Depende de: T-10, T-13
Aceite: todos os comandos passam; a saída de cada um é reportada, incluindo qualquer falha.
Arquivos: nenhum arquivo editado; verificação apenas (`src/index.ts` e `test/unit/package.test.ts` para leitura)

---

## Pendências antes de implementar

- **R-01 (`bytes=5-2`):** o PRD (RF-06) exige `416`, mas a RFC 9110 §14.1.1 pede para ignorar. T-11 segue o PRD. Precisa de confirmação do time; se mudar, ajustar o caso de T-05.
- **R-02 (`Accept-Ranges` em variantes comprimidas):** D-06 não anuncia `bytes` quando há `Content-Encoding`, o que diverge da leitura literal de RF-01. Precisa de confirmação; T-02 e T-13 dependem dessa decisão.
- **`sdd/pedido.md` ausente:** o PRD e a techspec citam o contrato `sdd/pedido.md`, mas o arquivo não está na pasta. Não bloqueia as tarefas, porque o PRD é a fonte dos requisitos.
- **R-06 (tamanho de `static.ts`):** o arquivo cresce para cerca de 470 linhas, acima da meta de 200 de `AGENTS.md`. Fica como débito para depois de T-14; não é tarefa desta lista.
