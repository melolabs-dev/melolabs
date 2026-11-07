# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-12, tabela de decisão, Definição de pronto) e `sdd/techspec.md` (D-01 a D-09, ordem de `resolveRange`, fluxo de `serveStatic`).

Ordem de execução: T-01 → (T-02, T-03, T-04) → T-05 → T-06 → T-07 → T-08 (com T-09) → (T-10, T-11) → T-12.

Regra: o fluxo de correção de bug do `AGENTS.md` vale aqui. Nenhum arquivo em `src/` muda antes de T-05 confirmar as falhas.

Bloqueio: nenhum código de fatiamento (T-07 em diante) antes da confirmação de T-01 (techspec D-05, "Pontos a confirmar", item 2).

Nota: os números de linha citados abaixo vêm da techspec, que avisa que não foram reconferidos. Se o código tiver mudado, valem o nome da função ou o trecho citado.

### T-01 — Confirmar decisões em aberto

Cobre: — (pré-condição de RF-02, RF-03 e RF-10 para `ReadableStream`)
Depende de: nenhuma
Aceite: o autor confirma por escrito:
- (a) a opção (b) do PRD para `ReadableStream` (techspec D-05): `Range` ignorado e `200` completo;
- (b) HEAD com `Range` chama `getContents` (D-06);
- (c) a sobrescrita de `content-length` do usuário em `206` e `416` (D-08).

As três respostas, com a data, são registradas na decisão em aberto do PRD e em "Pontos a confirmar" da techspec.
Também se verifica se `sdd/pedido.md` existe (PRD, "Premissas"). Se não existir, o PRD é a única referência e isso vai para a descrição do PR.
Arquivos: `sdd/prd.md`, `sdd/techspec.md`

### T-02 — Testes de intervalo: 206 e 416

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05
Depende de: T-01
Aceite: existe o bloco `describeMatrix("serve static range requests", ...)` em `test/static.test.ts`, entre o bloco de MIME types e o de "malformed url", com um asset de 100 bytes. Os casos cobrem:
- GET sem `Range` com `accept-ranges: bytes` e corpo completo; HEAD também (RF-01);
- `bytes=10-19`, `bytes=90-`, `bytes=-500` e `bytes=0-999` com `206`, `content-range` e `content-length` corretos, e o corpo com exatamente os bytes do intervalo (RF-02);
- `bytes= 10-19` e `bytes=10 - 19` com `200` completo (RF-02);
- `bytes=100-200` em GET e HEAD, e `bytes=-0` em HEAD, com `416`, `content-range: bytes */100` e `content-length: 0` (RF-04);
- HEAD `bytes=0-9` com `206`, os mesmos `content-range` e `content-length` do GET e corpo vazio (RF-03); HEAD `bytes=-500` com `206` e `0-99/100`;
- `bytes=0-4,10-14`, `itens=0-4`, `bytes=abc`, `bytes=10-5`, `bytes=-`, `bytes=-abc`, `bytes=200-100` e `bytes=0-9999999999999999999` com `200` completo e sem `content-range` (RF-05). `bytes=200-100` deve dar `200`, não `416`, pelo passo 5 da ordem de `resolveRange`.

Arquivos: `test/static.test.ts`

### T-03 — Testes de If-Range e precedência de 304

Cobre: RF-06, RF-07
Depende de: T-01
Aceite: no mesmo bloco, os casos cobrem:
- `If-Range: "v1"` com ETag `"v1"` resulta em `206`; `If-Range: "v0"` e `If-Range: W/"v1"` resultam em `200` com corpo completo;
- `bytes=500-600` com `If-Range: "v0"` resulta em `200`, e não em `416`;
- `If-Range` com a data do `last-modified` de um GET anterior resulta em `206`; data em ISO ou data diferente resultam em `200`;
- asset sem `etag` e sem `mtime` com `If-Range` resulta em `200`;
- `Range: bytes=0-9` com `If-None-Match` correspondente resulta em `304`, sem `content-range`;
- `Range: bytes=0-9` com `If-Modified-Since` igual ao `last-modified` resulta em `304`, sem `content-range`;
- `Range: bytes=500-600` com `If-None-Match` correspondente resulta em `304`, e não em `416` (RF-07; tabela de decisão, linhas 3 e 8).

Arquivos: `test/static.test.ts`

### T-04 — Testes de encoding, 404/405, Accept-Ranges, tamanho e tipos de corpo

Cobre: RF-08, RF-09, RF-10, D-05, D-06, D-07, D-08
Depende de: T-01
Aceite: os casos cobrem:
- `encodings: { gzip: ".gz" }` com `app.js.gz` de 40 bytes, `Accept-Encoding: gzip` e `Range: bytes=0-9` resulta em `206`, `content-encoding: gzip`, `content-length: 10` e `content-range` sobre 40 bytes. Sem variante, o intervalo recai sobre o arquivo original. `vary`, `etag`, `last-modified` e `content-type` continuam iguais aos de hoje (RF-08);
- asset inexistente com `Range` resulta em `404`, com e sem `fallthrough`, e nunca em `416` (RF-09);
- `POST` com `Range` resulta em `405` com `allow: GET, HEAD` (RF-09);
- `accept-ranges: bytes` presente em `200`, `206`, `304` e `416` de asset encontrado, e ausente em `404` e `405` (D-07);
- `getMeta` sem `size` e com `size: 0` resultam em `200` com corpo completo ou vazio, sem `content-range` (RF-10);
- `options.headers` com `content-length: 999` e GET com `Range: bytes=0-9` resultam em `content-length: 10` (D-08). Sem `Range`, o valor continua `999` (teste existente em `test/static.test.ts:600-617`);
- `Blob`, `Uint8Array`, `ArrayBuffer` e `string` com caractere multibyte (`"é"` ou emoji), com intervalo sobre os bytes UTF-8 (D-05);
- `ReadableStream` com `Range` resulta em `200` completo, sem `content-range`; HEAD com `Range` em stream resulta em `200` e o stream registra exatamente uma chamada a `cancel` (D-05, D-06).

Arquivos: `test/static.test.ts`

### T-05 — Confirmar falhas dos testes novos antes da implementação

Cobre: RF-12
Depende de: T-02, T-03, T-04
Aceite:
- `pnpm vitest run test/static.test.ts` é executado nos modos `web` e `node`;
- cada caso de comportamento novo falha. Se um caso novo passa sem mudança em `src/`, ele não testa comportamento novo: revisar o caso antes de seguir;
- os casos de regressão passam antes e depois da mudança, e ficam no bloco mesmo assim: 404 e 405 com `Range`, 304 com `Range`, `Range` malformado (RF-05), `size` ausente ou zero, `content-length` do usuário sem `Range`, e `vary`/`etag`/`last-modified` inalterados;
- a lista dos casos que falharam vai para a descrição do PR.

Arquivos: `test/static.test.ts` (sem alteração em `src/`)

### T-06 — Parser de Range e If-Range

Cobre: RF-02, RF-04, RF-05, RF-06, RF-10
Depende de: T-05
Aceite:
- `RANGE_RE`, `ByteRange`, `RangeOutcome`, `resolveRange` e `isIfRangeMatch` ficam privados no fim de `src/utils/static.ts`, na seção `// --- Internal Utils ---`. Nenhum nome novo é exportado;
- `resolveRange` segue os passos 1 a 7 de "Ordem de `resolveRange`" na techspec, sem reordenar;
- `isIfRangeMatch` classifica o valor pela forma: começa com `"` ou `W/"` é ETag, comparado literalmente com `meta.etag`, e nunca confere se começa com `W/`; o restante é data, comparado por igualdade com `mtimeDate.toUTCString()` (D-03);
- o typecheck passa. `pnpm lint` não é exigido aqui: até T-08 os helpers não são usados, e o oxlint pode reportá-los. O lint é exigido em T-08.

Arquivos: `src/utils/static.ts`

### T-07 — Fatiamento do corpo (sliceBody e cancelIfStream)

Cobre: RF-02, RF-03, RF-08
Depende de: T-01, T-06
Aceite:
- `sliceBody(body, range)` é privado e retorna:
  - `Blob`: `slice(start, end + 1)`;
  - `Uint8Array`: `subarray(start, end + 1)`;
  - `ArrayBuffer`: `slice(start, end + 1)`;
  - `string`: bytes UTF-8 via `TextEncoder`, depois `subarray(start, end + 1)`;
- para `ReadableStream`, `null`, `undefined` e demais tipos, retorna `undefined`, o que faz a resposta ser `200` completo (D-05, opção (b) confirmada em T-01);
- `cancelIfStream(body)` é privado. Se o corpo for `ReadableStream`, chama `cancel()` e trata a promise com `catch` vazio, sem lançar (D-06, R-02);
- os casos de tipos de corpo de T-04 só passam depois de T-08, porque a integração ainda não existe.

Arquivos: `src/utils/static.ts`

### T-08 — Integração de Range em serveStatic

Cobre: RF-01, RF-03, RF-04, RF-07, RF-08, RF-09
Depende de: T-06, T-07
Aceite: `serveStatic` segue a ordem de D-02 e o trecho "Fluxo de `serveStatic` após a mudança" da techspec:
- `accept-ranges: bytes` é definido com a guarda `has` logo após o bloco de ETag (D-07), em respostas de asset encontrado, e não em `404` nem `405`;
- `304` continua decidido antes de `Range`;
- HEAD sem `Range` continua saindo antes de `getContents`;
- HEAD com `Range` chama `getContents` uma vez, responde `206` sem corpo ou `200`, e chama `cancelIfStream` no caso `200` (D-06);
- o caminho de GET sem `Range` não muda;
- os headers de `206` e `416` são definidos como em T-09. T-08 e T-09 são feitos juntos, e T-09 é o critério de aceite desses headers;
- os casos de T-02, T-03 e T-04 passam nos modos `web` e `node`, e `pnpm lint` passa (no `AGENTS.md`, o lint inclui o typecheck).

Arquivos: `src/utils/static.ts`

### T-09 — Headers de 206 e 416 (D-08)

Cobre: RF-02, RF-04
Depende de: T-08 (implementados juntos)
Aceite:
- `206` define `content-length` com o número de bytes enviados e `content-range`, com `event.res.headers.set`, sobrescrevendo o `content-length` de `meta.size` e o de `options.headers`;
- `416` define `content-range: bytes */<size>` e `content-length: 0` em `event.res.headers`, sem o `content-length` de `meta.size`;
- os headers de `206` e `416` não vão no `init` do `HTTPResponse`, porque `event.res` é mesclado por cima (R-05, `src/response.ts`);
- sem `Range`, `options.headers` com `content-length: 999` continua valendo `999` (`test/static.test.ts:600-617`);
- o caso "headers do usuário" de T-04 passa.

Arquivos: `src/utils/static.ts`

### T-10 — Documentação de Range em serveStatic

Cobre: RF-02, RF-04, RF-05
Depende de: T-01, T-08
Aceite: há um parágrafo em `docs/2.utils/2.response.md`, logo após o bloco de `serveStatic` (linhas 39 a 49, reconferir), que descreve:
- `206` para intervalo válido;
- `416` para intervalo não satisfazível;
- `200` completo para múltiplos intervalos ou `Range` inválido;
- a limitação para `ReadableStream` (techspec D-09).

O texto segue o que T-01 confirmar. O parágrafo também menciona que clientes existentes podem passar a receber `206` e `416` (PRD, Riscos).
Arquivos: `docs/2.utils/2.response.md`

### T-11 — Verificar que não há exportações novas

Cobre: RF-11
Depende de: T-08
Aceite:
- `test/unit/package.test.ts` (snapshot de exportações, linha 133, reconferir) passa sem alteração;
- `git diff -- src/index.ts` fica vazio;
- nenhum nome ou tipo novo é exportado.

Arquivos: `src/index.ts` (sem alteração), `test/unit/package.test.ts` (sem alteração)

### T-12 — Verificação final e notas de PR

Cobre: RF-12, Definição de pronto (PRD)
Depende de: T-09, T-10, T-11
Aceite:
- `pnpm vitest run test/static.test.ts` passa nos modos `web` e `node`;
- `pnpm lint` passa, e `pnpm test` passa (lint, typecheck e cobertura);
- nenhum teste existente foi removido, e qualquer ajuste em teste existente está justificado;
- a descrição do PR lista: os casos que falharam em T-05; o risco R-07 (tamanho de `static.ts`, D-01); as decisões confirmadas em T-01; e a mudança de comportamento para clientes existentes (PRD, Riscos).

Arquivos: `test/static.test.ts` (ajustes, se houver), descrição do PR
