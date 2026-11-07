# Tarefas de implementação: HTTP Range no `serveStatic`

Referências: `sdd/prd.md` (RF-01 a RF-12), `sdd/techspec.md` (D-01 a D-13, R-01 a R-09).

Ordem de trabalho: primeiro os testes (T-01 a T-05), confirmando que os que cobrem comportamento novo falham antes de qualquer mudança em `src/utils/static.ts` (fluxo de `AGENTS.md`, "Bug Fix Workflow"). Depois as implementações (T-06 a T-09), a integração (T-10) e a verificação final (T-11 a T-12).

---

### T-01 — Testes de Accept-Ranges e de comportamentos preservados

Criar o bloco `describeMatrix("serve static range", ...)` em `test/static.test.ts`, após o bloco existente, com asset de 10 bytes (`"0123456789"`), ETag forte `"v1"` e `getMeta`/`getContents` próprios (os fixtures atuais usam ETag fraca `w/123`). Cobrir:
- GET e HEAD sem `Range` respondem 200 com `accept-ranges: bytes`;
- `Range` + `If-None-Match: "v1"` responde 304 sem corpo;
- `POST` com `Range` responde 405 com `Allow: GET, HEAD`;
- asset inexistente com `Range` e `fallthrough: true` retorna `undefined`;
- caminho não canônico com `Range` continua sendo rejeitado como hoje.

Cobre: RF-01, RF-07, RF-10

Depende de: nenhuma

Aceite: `pnpm vitest run test/static.test.ts -t "serve static range"` roda nos modos `web` e `node`. Os casos de `accept-ranges` falham antes da implementação. Os casos de 304, 405, `fallthrough` e caminho não canônico passam já agora, porque descrevem o comportamento que deve ser preservado.

Arquivos: `test/static.test.ts`

---

### T-02 — Testes de parsing de Range (206, 416, HEAD e ignorados)

No mesmo bloco `serve static range`, cobrir os formatos do cabeçalho e as respostas com asset de 10 bytes:
- RF-02: `bytes=2-5` (206, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, corpo `2345`), `bytes=2-` , `bytes=-3`, `bytes=0-99` (limitado a `0-9`) e `bytes=-100` (sufixo maior que o asset, retorna tudo);
- RF-03: `HEAD` com `bytes=0-3` responde 206 com cabeçalhos e corpo vazio;
- RF-04: `bytes=20-30`, `bytes=10-` e `bytes=-0` respondem 416 com `Content-Range: bytes */10` e `Content-Length: 0`;
- RF-05: `bytes=0-1,4-5`, `lines=0-1`, `bytes=abc`, `bytes=5-2` e `bytes=-` respondem 200 completo, sem `Content-Range`;
- RF-08: `getMeta` sem `size` e com `size: 0` responde 200 completo, com `accept-ranges` e sem `Content-Range`;
- R-06 (techspec): asset de 1 byte com `bytes=0-` e sufixo igual ao tamanho.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-08

Depende de: nenhuma

Aceite: os casos listados falham antes da implementação (hoje todos respondem 200 completo sem `Content-Range`). Os casos dos dois modos (`web` e `node`) têm asserção de status, de `Content-Range`, de `Content-Length` e do corpo exato.

Arquivos: `test/static.test.ts`

---

### T-03 — Testes de If-Range

No bloco `serve static range`, cobrir a validação de `If-Range` (RFC 9110 §13.1.5), com `Range: bytes=0-3`:
- `If-Range` com ETag diferente (`"v0"`) responde 200 completo;
- `If-Range` com a mesma ETag forte (`"v1"`) responde 206 com os bytes 0 a 3;
- ETag fraca (`W/"v1"`) no `If-Range` responde 200 completo;
- `If-Range` com data igual ao `Last-Modified` responde 206;
- `If-Range` com data diferente responde 200 completo;
- `If-Range` com data quando o asset não tem `mtime` (sem `Last-Modified`) responde 200 completo.

Cobre: RF-06

Depende de: nenhuma

Aceite: os casos com resposta 206 falham antes da implementação e os de 200 passam (hoje o `Range` é sempre ignorado). Cada caso verifica status e corpo nos dois modos.

Arquivos: `test/static.test.ts`

---

### T-04 — Testes de variante pré-comprimida

No bloco `serve static range`, criar um asset `app.js` com variante `app.js.gz` (`encoding: "gzip"`, 40 bytes) e um cliente com `accept-encoding: gzip`. Com `Range: bytes=0-9`, verificar: 206, `Content-Encoding: gzip`, `Content-Range: bytes 0-9/40`, `Vary: accept-encoding` presente e exatamente os 10 primeiros bytes da variante.

Cobre: RF-09

Depende de: nenhuma

Aceite: o caso falha antes da implementação (hoje responde 200 completo). Após T-10 passa nos dois modos, com `Content-Encoding` ainda presente na 206.

Arquivos: `test/static.test.ts`

---

### T-05 — Testes de tipos de corpo e de stream

No bloco `serve static range`, cobrir o fatiamento por formato de corpo (techspec D-07 e D-08) com `Range: bytes=2-5` sobre o mesmo conteúdo `"0123456789"`:
- `string`, `Uint8Array`, `ArrayBuffer`, `Blob`;
- string com caracteres multibyte (o `size` é em bytes, não em caracteres);
- `ReadableStream` com muitos chunks pequenos e intervalo que cruza fronteiras de chunk;
- `ReadableStream` de `Uint8Array` com contador de `pull`: após o fim do intervalo o `pull` do original não é mais chamado, e `cancel()` da resposta chega ao stream original;
- corpo não suportado (`URLSearchParams`) cai em 200 completo;
- `size` divergente do tamanho real do corpo (string/buffer/Blob) cai em 200 completo.

Cobre: RF-02, RF-12 (cobertura de RF-01 a RF-10 em formatos de corpo), R-01, R-02 (techspec R-02 e R-03)

Depende de: nenhuma

Aceite: os casos de 206 falham antes da implementação. Os casos de 200 para corpo não suportado e `size` divergente passam já hoje, e devem continuar passando depois. O teste de contador do `pull` mostra que o original para de ser lido após `end`.

Arquivos: `test/static.test.ts`

---

### T-06 — Anunciar `Accept-Ranges: bytes`

Em `src/utils/static.ts`, logo após o `return` do bloco 304 (aprox. linha 248), gravar `event.res.headers.set("accept-ranges", "bytes")`, incondicionalmente ao `size` (techspec D-10). Não gravar em 304, 404, 405 nem em `fallthrough`.

Cobre: RF-01

Depende de: T-01

Aceite: os casos de `accept-ranges` de T-01 passam nos dois modos. Os casos de 304, 405, `fallthrough` e caminho não canônico continuam passando. Os testes existentes em `test/static.test.ts` continuam passando.

Arquivos: `src/utils/static.ts`

---

### T-07 — Implementar `parseRange`

Adicionar em `src/utils/static.ts`, na seção `// --- Internal Utils ---` e sem `export`, a função `parseRange(header, size)` com o tipo `ByteRange = { start, end }` (techspec D-05). Regras: unidade `bytes` sem diferenciar maiúsculas; `trim()`; padrão `^bytes=(\d*)-(\d*)$`; `fim < inicio` é inválido; `inicio >= size` e `sufixo === 0` retornam `"unsatisfiable"`; `fim` limitado a `size - 1`; `inicio-` vai até o fim; `-sufixo` com `sufixo >= size` retorna tudo. Qualquer outro formato retorna `undefined`.

Cobre: RF-02, RF-04, RF-05, RF-08

Depende de: T-02

Aceite: os casos de parsing de T-02 passam nos dois modos quando a função é ligada em T-10. Para verificação isolada, adicionar, se útil, um teste unitário em `test/unit/` (sem exportar nada novo do índice). Confirmar que `src/index.ts` não mudou.

Arquivos: `src/utils/static.ts`

---

### T-08 — Implementar `ifRangeMatches`

Adicionar em `src/utils/static.ts`, sem `export`, a função `ifRangeMatches(ifRange, validators)` (techspec D-06). Se o valor começa com `"` ou `W/`, é entity-tag e só coincide se for forte e idêntica ao `etag` do cabeçalho efetivo da resposta. Caso contrário é data HTTP e coincide só se for igual, não `>=`, ao `Last-Modified` truncado em segundos. Sem validador correspondente ou data inválida retorna `false`. Não reutilizar `isCacheMatch` nem `matchETag`.

Cobre: RF-06

Depende de: T-03

Aceite: os casos de `If-Range` de T-03 passam nos dois modos quando a função é integrada em T-10. Confirmar que o caminho de 304 continua usando `isCacheMatch`/`matchETag` sem mudança.

Arquivos: `src/utils/static.ts`

---

### T-09 — Implementar `sliceBody` e `sliceStream`

Adicionar em `src/utils/static.ts`, sem `export`:
- `sliceBody(body, range, size)` (techspec D-07): `string` vira `Uint8Array` via `TextEncoder`; `Uint8Array`/`ArrayBufferView` usa `subarray`/visão sem cópia; `ArrayBuffer` usa `Uint8Array`; `Blob` usa `slice`; `ReadableStream` chama `sliceStream`; outros formatos retornam `undefined`. Para tipos de tamanho conhecido, se `byteLength` diverge de `size` retorna `undefined`.
- `sliceStream(stream, start, end)` (techspec D-08): `ReadableStream` com `pull` e `cancel`, um chunk por vez, chunks `string` convertidos com `TextEncoder`, `reader.cancel()` ao passar de `end`, `cancel()` repassado ao original.

Cobre: RF-02, RF-12 (cobertura dos formatos de corpo), R-01, R-02

Depende de: T-05

Aceite: os casos de tipos de corpo e de stream de T-05 passam nos dois modos quando a função é integrada em T-10. O teste de memória (um chunk por vez) e o de cancelamento são verificados.

Arquivos: `src/utils/static.ts`

---

### T-10 — Integrar o fluxo de Range em `serveStatic`

Em `src/utils/static.ts`, inserir a etapa entre o bloco 304 e o ramo HEAD/`getContents` (techspec D-01, D-04, D-11):
1. se houver `Range`, `meta.size` inteiro maior que zero e (se houver) `If-Range` válido, chamar `parseRange`;
2. `"unsatisfiable"`: gravar `Content-Range: bytes */size` e `Content-Length: 0` em `event.res.headers` e retornar `new HTTPResponse(null, { status: 416 })`, sem chamar `getContents`;
3. `{ start, end }` com HEAD: gravar `Content-Range` e `Content-Length` do trecho (sobrescrevendo com `set`, techspec D-03) e retornar `HTTPResponse(null, { status: 206 })`, sem chamar `getContents`;
4. `{ start, end }` com GET: chamar `getContents`, tentar `sliceBody`; se der certo, gravar os cabeçalhos com `set` e retornar 206; se devolver `undefined`, seguir para o 200 completo atual;
5. qualquer outro caso segue o fluxo 200 atual sem alteração, incluindo o teste que mantém `Content-Length` definido pelo usuário em 200 (`test/static.test.ts:600-617`).

Cobre: RF-02, RF-03, RF-04, RF-07, RF-08, RF-09, RF-10

Depende de: T-06, T-07, T-08, T-09

Aceite: todos os casos de T-01 a T-05 passam nos modos `web` e `node`. Adicionar um caso com `options.headers` contendo `content-length: 999` e `Range` válido, em que a 206 mostra o tamanho do trecho (R-05). Teste existente em `:600` continua passando sem ajuste.

Arquivos: `src/utils/static.ts`, `test/static.test.ts`

---

### T-11 — Garantir a API pública e documentar o contrato de `size`

Confirmar que `src/index.ts` (linha 193) exporta exatamente o mesmo conjunto (`ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`), que `StaticAssetMeta` e `ServeStaticOptions` não mudaram e que a assinatura de `serveStatic` é a mesma. Atualizar o JSDoc de `getMeta.size` em `ServeStaticOptions` para dizer que o valor deve ser o tamanho em bytes da representação servida, incluindo a variante pré-comprimida (R-02, P-02). Não é necessário documentar nesta tarefa os riscos R-04, R-07 e R-08 além do que já há no JSDoc de `getMeta`.

Cobre: RF-11

Depende de: T-10

Aceite: comparação da lista de exportações públicas antes e depois (ex.: `git diff` em `src/index.ts` vazio e `git diff` de `src/utils/static.ts` sem alteração nas interfaces `StaticAssetMeta` e `ServeStaticOptions`, exceto JSDoc). `pnpm typecheck` passa.

Arquivos: `src/utils/static.ts`, `src/index.ts`

---

### T-12 — Verificação final e regressões

Rodar `pnpm vitest run test/static.test.ts` e depois `pnpm vitest run` completo. Se algum teste existente falhar por causa de `accept-ranges` (ex.: asserção de igualdade total de cabeçalhos), ajustar só a asserção, mantendo o que ela verifica (techspec seção 5). Rodar `pnpm lint` e `pnpm typecheck`. Os testes novos devem rodar nos dois modos (`web` e `node`).

Cobre: RF-12

Depende de: T-10, T-11

Aceite: `pnpm vitest run` passa sem falhas; `pnpm lint` e `pnpm typecheck` passam. Nenhum teste existente foi removido, apenas ajustado quando necessário. Os resultados reais (incluindo qualquer falha) são reportados ao final.

Arquivos: `test/static.test.ts`, `src/utils/static.ts`
