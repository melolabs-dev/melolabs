# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09). A ordem segue o fluxo de correção de `AGENTS.md`: primeiro os testes, depois a implementação. Nenhuma tarefa altera a API pública (RF-10).

Pendências de confirmação (PRD, perguntas 1 e 2) estão no fim do arquivo. Elas não bloqueiam T-01 a T-05.

---

### T-01 — Testes de integração de Range em `serveStatic` (vermelhos)

Escrever os casos de integração dentro do `describeMatrix("serve static", ...)` existente, com `t.app.all("/range/**", ...)`, `getMeta` com `size: 1000`, `etag: "abc"` e `mtime` fixo, e `getContents` devolvendo um `Blob` de 1000 bytes com padrão conhecido (`i & 0xff`). Cobrir RF-01 a RF-09 conforme a seção "Testes de integração" da techspec, incluindo: `accept-ranges` presente em 200/206/304/416 e ausente em 404/405/fallthrough; `bytes=0-499`; `bytes=900-`; `bytes=-200`; `bytes=0-5000`; HEAD com `vi.fn` sem chamada a `getContents`; `bytes=1000-1200` e size 0 com 416; entradas ignoradas (`bytes=abc`, `items=0-4`, `bytes=0-1,5-9`, asset sem `size`); If-Range forte, diferente, fraco e por data; `If-None-Match` com Range gerando 304 (R7); variante `.gz`; `content-length` pré-definido em `options.headers` (R2). Os testes existentes não mudam (a techspec confirma que nenhum envia `Range`).

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-11
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/static.test.ts` roda nos alvos `web` e `node`. Os novos casos falham antes de qualquer mudança em `src/utils/static.ts` (confirmar a falha com a saída do vitest). Os testes que já existiam continuam passando.
**Arquivos:** `test/static.test.ts`

---

### T-02 — Testes unitários de `getByteRange` e `matchIfRange` (vermelhos)

Criar `test/unit/range.test.ts` com tabela direta sobre `getByteRange`, cobrindo cada linha da tabela de D-05 (`a-b`, `a-`, `-n`, `-0`, `size === 0`, `b-a` com `b > a`, `-` sem número, vírgula, unidade diferente de `bytes`, texto malformado, `size` indefinido, negativo ou não finito, `BYTES=` maiúsculo, espaços). Cobrir também as regras de If-Range de D-04: entity-tag forte igual (confere), tag fraca de qualquer lado (não confere), tag diferente, data igual (confere), data diferente, data inválida ou `NaN` (não confere). Os testes importam de `src/utils/internal/range.ts`, que ainda não existe, então devem falhar por isso.

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/unit/range.test.ts` falha por módulo inexistente. Depois de T-03, todos os casos passam.
**Arquivos:** `test/unit/range.test.ts`

---

### T-03 — Módulo interno `src/utils/internal/range.ts`

Implementar `getByteRange(headers, size, validators)` com a assinatura de techspec (contratos), mais os helpers privados `parseRangeSpec` e `matchIfRange`, sem `export` além de `getByteRange` e da interface `ByteRange`. Seguir D-04 e D-05 à risca. O arquivo fica abaixo de 200 linhas, usa só APIs web padrão e não é reexportado por `src/index.ts`. Os helpers ficam no fim do arquivo.

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07, RF-10
**Depende de:** T-02
**Aceite:** `pnpm vitest run test/unit/range.test.ts` passa. `src/index.ts` não tem diff. `getByteRange` devolve `undefined` quando `size` é desconhecido, e `"unsatisfiable"` quando `size === 0`.
**Arquivos:** `src/utils/internal/range.ts`

---

### T-04 — Anunciar `Accept-Ranges` e preservar a precedência do 304

Em `src/utils/static.ts`, logo após o bloco de `etag` (por volta das linhas 239-241) e antes de `isCacheMatch`, adicionar `event.res.headers.set("accept-ranges", "bytes")`. Assim a resposta 304 também carrega o cabeçalho (D-02, passo 2). Não mexer na verificação de 304 nem em `vary`, `last-modified` e `etag`. Não adicionar o cabeçalho em 404, 405 ou fallthrough (P4), o que é natural porque o código só chega aí com `meta` encontrado.

**Cobre:** RF-01, RF-08
**Depende de:** T-01
**Aceite:** os casos de `accept-ranges` de T-01 passam em 200 e 304 e continuam ausentes em 404, 405 e fallthrough. O caso `If-None-Match` com Range de T-01 retorna 304 sem corpo.
**Arquivos:** `src/utils/static.ts`

---

### T-05 — Avaliação de Range em `serveStatic`: 206 de HEAD, 416 e cabeçalhos

Em `src/utils/static.ts`, depois do bloco de `content-length` e antes de `if (event.req.method === "HEAD")`, inserir a avaliação de Range (esboço em techspec, "Arquivos a alterar"). Importar `getByteRange` de `./internal/range.ts`. Em 416, definir `content-range: bytes */{size}` e `content-length: 0`, sem corpo. Em 206, definir `content-range` e `content-length` com `set`, sobrescrevendo qualquer valor anterior (R2). Para HEAD com 206, retornar sem chamar `getContents`. Para GET com 206, delegar o corpo a `sliceContents`, que pode ser um stub nesta tarefa e ser completado em T-06. Manter `content-type`, `content-encoding`, `etag` e `last-modified` como estão (D-07, R6). O 200 completo permanece quando `getByteRange` devolve `undefined`.

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-08
**Depende de:** T-03, T-04
**Aceite:** os casos de T-01 de HEAD (206, corpo vazio, `getContents` não chamado), 416 (incluindo `bytes */0` para size 0), 200 para entradas ignoradas, If-Range e `content-length` de `options.headers` passam. Os casos de corpo de 206 podem continuar vermelhos até T-06.
**Arquivos:** `src/utils/static.ts`

---

### T-06 — Fatiar o corpo do GET 206 (`sliceContents`)

Implementar `sliceContents(contents, range)`, privada, no bloco "Internal Utils" no fim de `src/utils/static.ts` (D-06). Se o valor for `Blob` ou `File`, usar `slice(start, end + 1)` sem ler o arquivo inteiro. Para os demais tipos de `BodyInit`, e para `null` ou `undefined`, usar `await new Response(contents).blob()` e depois `slice`. Não alterar a assinatura de `getContents`. Acrescentar ao JSDoc de `getContents` uma nota de que `Blob` ou `File` são recomendados quando há Range, por causa do risco R1. Essa tarefa depende de confirmação de P2 (pendência 1), mas a implementação segue a proposta da techspec enquanto ela não é respondida.

**Cobre:** RF-02, RF-03, RF-09
**Depende de:** T-05
**Aceite:** os casos de corpo de 206 de T-01 passam em `web` e `node`: `bytes=0-499` devolve exatamente os bytes 0 a 499; `bytes=900-` e `bytes=-200` devolvem as fatias certas; `bytes=0-5000` é limitado a 999. A suíte de `Blob` roda nos dois alvos. `pnpm lint` passa.
**Arquivos:** `src/utils/static.ts`

---

### T-07 — Encoding pré-comprimido e caminhos de erro preservados

Verificar que o Range se aplica à variante `.gz` escolhida: `Content-Encoding: gzip`, `Vary` com `accept-encoding`, `Content-Range` e `Content-Length` referindo-se aos bytes do `.gz` (P3). Verificar que fallthrough sem asset com Range devolve `undefined` e não define `content-range`, que 404 continua valendo sem fallthrough, e que `POST` com Range continua recebendo 405 com `Allow: GET, HEAD`. Se algum desses casos quebrar, corrigir em `src/utils/static.ts` com a menor mudança possível. Não alterar a seleção de encoding nem a ordem existente.

**Cobre:** RF-09
**Depende de:** T-06
**Aceite:** os casos de `.gz`, fallthrough, 404 e 405 de T-01 passam nos dois alvos. `git diff` mostra que a lógica de `encodings` não mudou.
**Arquivos:** `src/utils/static.ts`, `test/static.test.ts`

---

### T-08 — Verificação de regressão, API pública e build

Rodar `pnpm vitest run test/static.test.ts test/unit/range.test.ts`, depois `pnpm vitest run test/security.test.ts test/cache.test.ts test/rules/cache.test.ts` (consumidores de `serveStatic` e cache), depois `pnpm test` completo (lint, typecheck e cobertura) e `pnpm build`. Conferir com `git diff -- src/index.ts` que não há mudança. Conferir que nenhum nome novo foi exportado, e que `src/utils/internal/range.ts` e `sliceContents` não aparecem em `dist` como exportação pública. Atualizar `AGENTS.md`, na seção Project Structure, com `range.ts` em `utils/internal/`, se o projeto mantém essa lista.

**Cobre:** RF-10, RF-11
**Depende de:** T-07
**Aceite:** todos os comandos passam, e a saída é reportada como foi obtida. `git diff -- src/index.ts` vazio. Nenhum teste existente foi removido ou enfraquecido.
**Arquivos:** `src/index.ts` (conferência, sem alteração), `AGENTS.md`

---

## Pendências antes de mesclar

1. **PRD pergunta 1 / P2 / D-06:** aprovar fatiar `Blob` e bufferizar os demais tipos, ou trocar por mudança na API de `getContents`. A segunda opção muda a API pública e exige revisar T-05 e T-06. Afeta T-06.
2. **PRD pergunta 2 / P7 / R3:** aprovar que tamanho 0 com Range responde 416 (mudança observável em relação ao 200 atual). Afeta T-02, T-05 e o caso de size 0 em T-01.
3. **Riscos sem tarefa própria, aceitos pela techspec:** R1 (stream sem seek, documentado em T-06), R5 (precisão de data em If-Range, sem a regra de 1 s da norma, registrado para revisão), R6 (caches com 206, sem mudança de `vary`).
