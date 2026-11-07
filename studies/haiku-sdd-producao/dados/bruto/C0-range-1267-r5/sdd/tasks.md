# Tarefas — HTTP Range no `serveStatic` (h3js/h3#1267)

Derivado de `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md`. Seguem a política do AGENTS.md: testes primeiro (T-01 a T-04), confirmar que **falham**, e só então implementar (T-05 em diante). Toda a lógica fica em `src/utils/static.ts`, na seção `Internal Utils`, sem exportações novas.

Os testes ficam em um novo `describeMatrix("serve static range", ...)` em `test/static.test.ts`, depois do bloco existente que termina perto da linha 524 e antes do bloco de MIME. O asset padrão tem 18 bytes (`"0123456789abcdefgh"`, `size: 18`). Os testes de encoding usam `file.txt.gz` com `size: 30`.

### T-01 — Testes: `Accept-Ranges` e não regressão

Escrever os testes de RF-01 e RF-10:

- `GET` e `HEAD` sem `Range` devolvem `200` com `accept-ranges: bytes`, e corpo e demais cabeçalhos iguais aos de hoje.
- `accept-ranges` ausente em `304`, `404`, `405` e fallthrough (reusar o app com `fallthrough: true`).
- `404`, `405` com `Allow: GET, HEAD` e fallthrough não mudam com `Range` presente.
- Caminho não canônico continua recusado.

Cobre: RF-01, RF-10
Depende de: nenhuma
Aceite: `pnpm vitest run test/static.test.ts` roda e os testes de `accept-ranges` falham antes da implementação. Os testes de 404/405/fallthrough/caminho não canônico já passam.
Arquivos: `test/static.test.ts`

### T-02 — Testes: 206, HEAD e 416

Escrever os testes de RF-02, RF-03 e RF-04:

- **206:** `2-5`, `10-`, `-4`, `10-999`, `-999` (devolve tudo como 206), unidade `BYTES` e espaços opcionais. Conferir `Content-Range` e `Content-Length`.
- **206 e cabeçalhos:** `etag`, `last-modified`, `vary` e `options.headers` preservados. O `content-length` do intervalo sobrepõe um `content-length: 999` pré-definido.
- **HEAD:** `HEAD` com `2-5` devolve `206` com `Content-Range: bytes 2-5/18` e `Content-Length: 4`, sem corpo, e `getContents` (`vi.fn`) não é chamado. `HEAD` com intervalo insatisfatível recebe os cabeçalhos do 416.
- **416:** `18-`, `100-200`, `-0` e asset com `size: 0`. Conferir `content-range: bytes */size`, `content-length: 0`, corpo vazio, `accept-ranges` mantido e ausência de `content-type` e `content-encoding`, inclusive quando `options.headers` os define.

Cobre: RF-02, RF-03, RF-04
Depende de: T-01
Aceite: os testes novos falham antes da implementação (hoje a resposta é `200`) e rodam nos modos `web` e `node`.
Arquivos: `test/static.test.ts`

### T-03 — Testes: Range ignorado, If-Range, 304 e tamanho desconhecido

Escrever os testes de RF-05, RF-06, RF-07 e RF-09:

- **RF-05 (todos `200` completo, sem `content-range`):** `bytes=abc`, `bytes=`, `bytes=5`, `bytes=--1`, `bytes=+1-2`, `bytes=1.5-2`, `bytes=5-2`, `bytes=0-1,4-5`, `items=0-1`, `bytes=99999999999999999999-`.
- **RF-06 (asset com `etag: '"abc"'`):** `If-Range` forte que confere (206), `"outro"` (200), `W/"abc"` no cliente (200) e etag fraco no asset (200). Também data idêntica a `Last-Modified` (206), data diferente (200), asset sem o validador correspondente (200) e `If-Range` sem `Range` (200).
- **RF-07:** `If-None-Match: "abc"` + `Range: bytes=0-3` devolve `304`, sem corpo, sem `content-range` e sem `accept-ranges`.
- **RF-09:** `getMeta` sem `size` + `Range` devolve `200` completo, sem `content-range`.

Cobre: RF-05, RF-06, RF-07, RF-09
Depende de: T-01
Aceite: os testes de RF-06 que esperam `206` falham antes da implementação. Os demais descrevem o comportamento de hoje e passam. Todos rodam em `web` e `node`.
Arquivos: `test/static.test.ts`

### T-04 — Testes: encoding e fatiamento de corpo

Escrever os testes de RF-08 e RF-11:

- **RF-08:** com `encodings: { gzip: ".gz" }` e `file.txt.gz` de `size: 30`, `Range: bytes=0-9` devolve `206`, `Content-Range: bytes 0-9/30`, `Content-Encoding: gzip`, `Content-Type` de `file.txt` e `Vary: accept-encoding`. `getMeta` é chamado com os mesmos ids de antes. O undici descomprime `content-encoding: gzip` no modo `node`, então validar status e cabeçalhos com `HEAD`, ou usar corpo que não dependa da descompressão.
- **RF-11:** `getContents` devolvendo string (inclusive com caracteres multibyte), `Uint8Array` com `byteOffset` diferente de 0, `ArrayBuffer`, `Blob` e `ReadableStream` com vários chunks cruzando a fronteira do intervalo. Em todos, `Range: bytes=2-5` devolve exatamente os bytes 2 a 5 e `body.length === content-length`.
- **RF-11, casos de borda:** `getContents` devolvendo `null` mantém `200` com corpo vazio, sem `206`. `FormData` e `URLSearchParams` caem para `200` completo, sem `content-range`.

Cobre: RF-08, RF-11
Depende de: T-01
Aceite: os testes de `206` falham antes da implementação. Os de `null`, `FormData` e `URLSearchParams` descrevem o comportamento de hoje.
Arquivos: `test/static.test.ts`

### T-05 — Implementar `accept-ranges`, parser de `Range` e resposta 416

Em `src/utils/static.ts`:

- **`accept-ranges`:** depois do retorno do `304`, definir `accept-ranges: bytes` com `set`, para que `304`, `404`, `405` e fallthrough não o recebam.
- **`parseRange(header, size)`:** regex `/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i`. Ignorar ambos os grupos vazios, números fora de `Number.isSafeInteger` e `b < a`. Sufixo `-0` e `a >= size` são insatisfatíveis. `-n` com `n >= size` vira `0..size-1`. `a-b` limita o fim a `size - 1`.
- **`resolveRange(event, size)`:** `size` conhecido é `Number.isInteger(size) && size >= 0`; sem ele retorna `ignore`. Retorna `ignore`, `partial` ou `unsatisfiable`. A chamada a `isIfRangeValid` entra em T-07.
- **`unsatisfiable`:** `delete` de `content-type` e `content-encoding` em `event.res.headers`. Em seguida `set` de `content-range: bytes */size` e `content-length: 0`. Devolver `HTTPResponse` sem corpo, status 416 e `statusText` "Range Not Satisfiable". Vale para `GET` e `HEAD`.

Cobre: RF-01, RF-04, RF-05, RF-07, RF-09
Depende de: T-01, T-02, T-03
Aceite: os testes de T-01 e T-03 (exceto os `206` de If-Range) e os de `416` de T-02 passam em `web` e `node`. O `304` continua prevalecendo sobre `Range`.
Arquivos: `src/utils/static.ts`

### T-06 — Implementar 206 para GET e HEAD com fatiamento do corpo

Em `src/utils/static.ts`:

- **Cabeçalhos do `206`:** no ramo `partial`, depois do bloco de `content-type`/`content-encoding`, gravar `content-length` com o tamanho do intervalo (sobrepondo um existente) e `content-range: bytes <início>-<fim>/<size>`, tudo com `set`. Em `200` o `content-length` pré-definido continua prevalecendo (teste existente).
- **`HEAD`:** devolver `206` com `statusText` "Partial Content", sem corpo e sem chamar `getContents`.
- **`GET`:** chamar `getContents` e `sliceBody`; devolver `206` com o corpo fatiado. Se o conteúdo for `null`/`undefined` ou de tipo não fatiável, devolver o `200` de hoje sem `content-range`. Gravar `content-range` só depois do fatiamento.
- **`sliceBody(body, range)`:**
  - string: `TextEncoder`, com fatia em bytes;
  - `ArrayBufferView`: respeitar `byteOffset`;
  - `ArrayBuffer`;
  - `Blob`/`File`: `slice`;
  - `ReadableStream`: `sliceStream` com `pull` manual, descartando os bytes iniciais e chamando `reader.cancel()` ao fim.

  Buffers limitados com `Math.min` para não lançar `RangeError` se `size` divergir. `FormData`, `URLSearchParams` e outros retornam `undefined`. Usar apenas APIs web padrão.

Cobre: RF-02, RF-03, RF-11
Depende de: T-05
Aceite: os testes de T-02 (206/HEAD) e de T-04 (RF-11) passam em `web` e `node`. O corpo recebido tem exatamente os bytes pedidos e `body.length === content-length`.
Arquivos: `src/utils/static.ts`

### T-07 — Implementar `If-Range`

Em `src/utils/static.ts`:

- Criar `isIfRangeValid(ifRange, resHeaders)`. Só é chamada quando há `Range` válido; `If-Range` sem `Range` não é lido.
- Valor que começa com `"` ou `W/` é entity-tag. Confere só se nenhum lado começar com `W/` (sensível a caixa) e as strings forem idênticas ao `etag` de `event.res.headers`.
- Os demais valores são data. Conferem se, com `trim`, forem idênticos ao `last-modified` de `event.res.headers`.
- Sem validador correspondente, ou sem conferir, `resolveRange` retorna `ignore` (200 completo).

Cobre: RF-06
Depende de: T-06
Aceite: os testes de RF-06 de T-03 passam em `web` e `node`: forte confere (206), difere (200), fraco em qualquer lado (200), data idêntica (206), data diferente (200), sem validador (200), sem `Range` (200).
Arquivos: `src/utils/static.ts`

### T-08 — Validar `Range` com seleção de encoding

Verificar que o `Range` se aplica à variante escolhida, com o `size` dela, sem mudar a escolha da variante. O `Vary: accept-encoding` e o `Content-Encoding` da variante permanecem no `206`. Ajustar `src/utils/static.ts` só se os testes de T-04 mostrarem divergência, por exemplo `content-type` e `content-encoding` gravados antes do ramo `416`.

Cobre: RF-08
Depende de: T-06
Aceite: os testes de RF-08 de T-04 passam: `Range: bytes=0-9` sobre `file.txt.gz` (`size: 30`) devolve `206`, `bytes 0-9/30`, `Content-Encoding: gzip`, `Content-Type` de `file.txt` e `Vary: accept-encoding`.
Arquivos: `src/utils/static.ts`, `test/static.test.ts`

### T-09 — Documentação

Acrescentar um parágrafo curto em `docs/4.examples/serve-static-assets.md`. Ele deve dizer que o `serveStatic` atende `Range` de um único intervalo em `GET` e `HEAD` quando `getMeta` informa `size`, e que `Accept-Ranges: bytes` é anunciado. Sem código novo e sem novas opções.

Cobre: RF-01, RF-02
Depende de: T-07
Aceite: o parágrafo existe e `pnpm lint` (oxfmt) passa no arquivo.
Arquivos: `docs/4.examples/serve-static-assets.md`

### T-10 — Verificação final e garantia de não regressão

Rodar `pnpm vitest run test/static.test.ts test/security.test.ts test/unit/package.test.ts`, depois `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Conferir que `src/index.ts`, `ServeStaticOptions` e `StaticAssetMeta` não mudaram e que o teste de API pública passa sem nomes novos. Os testes existentes de cabeçalhos usam `toMatchObject` e não devem precisar de ajuste; se algum falhar por causa de `accept-ranges`, ajustar só o necessário.

Cobre: RF-10, RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-11
Depende de: T-08, T-09
Aceite: todos os comandos acima terminam sem falhas, `git diff --stat` mostra só `src/utils/static.ts`, `test/static.test.ts` e `docs/4.examples/serve-static-assets.md` (mais `sdd/`), e `src/index.ts` está intacto.
Arquivos: `src/utils/static.ts`, `test/static.test.ts`, `docs/4.examples/serve-static-assets.md`
