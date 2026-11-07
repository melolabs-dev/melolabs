# Tarefas de implementação: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (requisitos RF-01 a RF-11) e `sdd/techspec.md` (decisões D-01 a D-10).

## Premissas adotadas

As tarefas seguem as recomendações da techspec §8, que ainda não foram confirmadas:

- D-01: helpers em `src/utils/internal/range.ts`.
- D-05: o intervalo vale para a variante escolhida (`.gz`, `.br`), e `Content-Encoding` é mantido no 206.
- D-07: `Accept-Ranges: bytes` em toda resposta de asset (200, 206 e 416), inclusive quando `size` é desconhecido.
- D-10: `size: 0` com Range válido responde 416.

Se alguma dessas premissas for rejeitada, mudam T-03, T-05 e T-06.

## Ordem

T-01 e T-02 (testes, antes do código) → T-03 → T-04 → T-05 → T-06 e T-07 → T-08.

---

### T-01 — Testes unitários dos helpers de Range

- Cobre: RF-02, RF-03, RF-04, RF-05, RF-06
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/unit/range.test.ts` falha, porque `src/utils/internal/range.ts` ainda não existe. As tabelas cobrem:
  - Parsing válido: `bytes=0-499`, `bytes=900-`, `bytes=-100`, `BYTES=0-1`.
  - Ignorados (resultado `undefined`): `bytes=abc`, `bytes=0-1,5-9`, `items=0-4`, `bytes=5-3`, `bytes=-`, `bytes=+1-2`.
  - Limites com `size` 1000: `bytes=0-5000` vira `0-999`; `bytes=-5000` vira `0-999`.
  - Insatisfazíveis: `bytes=1000-` (size 1000), `bytes=-0`, `bytes=0-` (size 0).
  - `If-Range`: `"abc"` casa com `etag: "abc"`; `W/"abc"` nunca casa; data igual ao `lastModified` casa; data diferente não casa; sem `If-Range`, o Range é aplicado.
- Arquivos: `test/unit/range.test.ts`

---

### T-02 — Testes de integração do `serveStatic` com Range

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/static-range.test.ts` falha nos casos novos de `Accept-Ranges`, 206, 416 e `Content-Range`. Os casos de guarda devem passar já, sem código novo: 304 com Range (RF-07), 404 e fallthrough com Range (RF-11), 405 com `Allow: GET, HEAD` (RF-11) e 200 sem Range com os cabeçalhos atuais (RF-11). O asset de teste tem 1000 bytes, com conteúdo `Uint8Array` de `i % 256`, para conferir os bytes exatos. Os fixtures de `If-Range` usam ETag entre aspas (`"abc"`). Os fixtures existentes (`"w/123"`) não são alterados. Além disso:
  - `getContents` (via `vi.fn`) não é chamado em HEAD nem em 416.
  - `Content-Length` vindo de `ServeStaticOptions.headers` é sobrescrito no 206.
  - Corpo como `string`, `Blob` e `ReadableStream` no 206.
  - `size: 0`: 416 com Range e 200 sem Range.
  - Tudo roda em `describeMatrix` (web e node).
- Arquivos: `test/static-range.test.ts`

---

### T-03 — Parsing de Range e validação de If-Range

- Cobre: RF-02, RF-03, RF-04, RF-05, RF-06
- Depende de: T-01
- Aceite: os casos de `resolveByteRange` em `test/unit/range.test.ts` passam. A função tem a assinatura `resolveByteRange(headers, { size, etag, lastModified })` e retorna `ByteRangeResult | undefined`. A implementação segue a techspec D-03 e D-04:
  - Regex `^bytes=(\d*)-(\d*)$`, com unidade sem diferença de caixa e espaços externos aparados.
  - `undefined` (resposta completa) para formato inválido, outra unidade, mais de um intervalo e intervalo invertido.
  - `unsatisfiable` quando `first >= size`, quando o sufixo é `-0` ou quando `size === 0`.
  - `last` limitado a `size - 1`; sufixo maior que o arquivo começa em 0.
  - `If-Range` começando com `"` ou `W/` casa só com ETag forte e idêntico. Caso contrário, é tratado como data HTTP e compara em segundos com `lastModified`.
  - `parseRangeHeader` e `matchesIfRange` ficam privados. Nada é exportado por `src/index.ts`.
  - O arquivo fica abaixo de 200 linhas.
- Arquivos: `src/utils/internal/range.ts`

---

### T-04 — Fatiamento do corpo

- Cobre: RF-02, RF-10
- Depende de: T-01, T-03
- Aceite: os casos de `sliceBody` em `test/unit/range.test.ts` passam para `Uint8Array`, `ArrayBuffer`, `Blob`, `string` com caractere multibyte (`"é"` ocupa 2 bytes) e `ReadableStream` com chunks que cruzam o início e o fim do intervalo. `sliceBody(body, { start, end })` retorna `BodyInit | null`:
  - `Blob` é fatiado com `slice`, sem leitura.
  - `string` é codificada em UTF-8 antes do corte.
  - Streams usam `sliceStream` privado, com `TransformStream` que descarta bytes antes de `start` e encerra após `end`.
  - O JSDoc documenta que streams têm I/O proporcional a `start`.
- Arquivos: `src/utils/internal/range.ts`

---

### T-05 — Integrar Range ao `serveStatic`

- Cobre: RF-01, RF-02, RF-04, RF-07, RF-08, RF-11
- Depende de: T-02, T-03, T-04
- Aceite: em `test/static-range.test.ts`, os casos de RF-01, RF-02, RF-04, RF-07 e RF-08 passam. `test/static.test.ts` passa sem alterações (`git diff -- test/static.test.ts` vazio). Em `src/utils/static.ts`, logo após o bloco de `Content-Length` (por volta das linhas 268 a 270) e antes do bloco de HEAD (por volta das linhas 272 a 274):
  - `accept-ranges: bytes` é definido para todo asset servido.
  - `resolveByteRange` só é chamado se `meta.size` existir.
  - 416 define `Content-Range: bytes */size` e `Content-Length: 0`, e retorna sem chamar `getContents`.
  - 206 define `content-range` e `content-length` com `event.res.headers.set` (D-08).
  - HEAD retorna 206 com corpo vazio, sem chamar `getContents`.
  - GET chama `getContents` e passa o resultado por `sliceBody`.
  - O 304 continua antes desse bloco e não recebe `Accept-Ranges`.
- Arquivos: `src/utils/static.ts`

---

### T-06 — Casos de borda: tamanho desconhecido, tamanho zero e variante pré-comprimida

- Cobre: RF-01, RF-09, RF-10
- Depende de: T-05
- Aceite: os casos passam em `test/static-range.test.ts`:
  - `getMeta` sem `size` com Range responde 200 completo, sem `Content-Range`, com `Accept-Ranges` (D-07).
  - `size: 0` com Range responde 416 com `Content-Range: bytes */0`. Sem Range, responde 200 sem `Content-Length` (D-10).
  - Com `encodings: { gzip: ".gz" }`, `Accept-Encoding: gzip` e `Range: bytes=0-9` sobre `app.js.gz` de 300 bytes responde 206, com `Content-Encoding: gzip`, `Content-Range: bytes 0-9/300` e os 10 primeiros bytes da variante.

  Altere `src/utils/static.ts` só se algum caso falhar.
- Arquivos: `test/static-range.test.ts`, `src/utils/static.ts` (somente se necessário)

---

### T-07 — Documentação do `serveStatic`

- Cobre: RF-01
- Depende de: T-05
- Aceite: o JSDoc de `serveStatic` (`src/utils/static.ts`, por volta das linhas 68 a 100) descreve o suporte a Range (`bytes`, 206, 416), o `Accept-Ranges` e o custo de streams. `pnpm fmt` regenera a documentação via automd. A mudança em `docs/` vem só do gerador, sem edição manual.
- Arquivos: `src/utils/static.ts`, `docs/2.utils/2.response.md` (gerado pelo `pnpm fmt`)

---

### T-08 — Verificação final e regressão

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10, RF-11
- Depende de: T-06, T-07
- Aceite:
  - `pnpm vitest run test/static.test.ts test/static-range.test.ts test/unit/range.test.ts test/unit/package.test.ts test/rules/cache.test.ts` passa.
  - `pnpm lint` e `pnpm typecheck` passam.
  - `pnpm test` passa, com cobertura.
  - `git diff -- src/index.ts` está vazio e o snapshot de exports em `test/unit/package.test.ts` não muda.
  - `git diff -- test/static.test.ts` está vazio.
  - `src/utils/internal/range.ts` tem menos de 200 linhas.
- Arquivos: nenhum (apenas execução de comandos de verificação)
