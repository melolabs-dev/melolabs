# Tarefas: HTTP Range no `serveStatic` (h3js/h3#1267)

Referências: `sdd/prd.md` (RF-01 a RF-13) e `sdd/techspec.md` (decisões D-01 a D-10, casos de teste 1 a 28 da seção 5.1).

## Notas de execução

- **Ordem geral.** T-01 vem primeiro. T-02 a T-11 escrevem os testes antes de qualquer código do projeto. Depois, T-12 a T-15 implementam em `src/utils/static.ts`, na ordem da lista. Isso segue a regra de bug fix do `AGENTS.md`, adaptada para feature.
- **Teste vermelho antes da implementação.** Depois de T-11, rodar `pnpm vitest run test/static-range.test.ts`. Falham os casos que esperam `206`, `416` ou `accept-ranges`. Passam os casos que esperam `200` completo, `304`, `404` ou `405`, porque são regressão e devem continuar passando.
- **Conflito de arquivo.** T-02 a T-11 editam o mesmo arquivo de teste, e T-12 a T-15 editam o mesmo arquivo de código. Executar cada grupo em sequência, mesmo que a dependência lógica entre tarefas do grupo seja nula.
- **Matriz.** Todo teste usa `describeMatrix` e roda em `web` e `node`.
- **Asset padrão.** `getMeta` devolve `{ size: 10, type: "text/plain", etag: '"v1"', mtime: <data fixa> }` e `getContents` devolve `"0123456789"`, salvo quando a tarefa disser outra coisa.
- **Comandos de verificação.** `pnpm vitest run test/static-range.test.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

---

### T-01 — Criar a suíte de Range com o setup e os casos de `accept-ranges`

**Cobre:** RF-01, RF-13

**Depende de:** nenhuma

**Aceite:** existe `test/static-range.test.ts` com o helper do asset padrão e o `describeMatrix`. Os casos 1 (GET sem Range, `accept-ranges: bytes`, corpo completo) e 28 (`accept-ranges` em 200, 206, 304 e 416, para GET e HEAD) estão escritos. Ao rodar, o caso 1 e o 28 falham no código atual, o que é esperado. Confirmar que a execução segue a regra de teste vermelho das notas acima.

**Arquivos:** `test/static-range.test.ts` (criar)

---

### T-02 — Testes do 206 para GET e HEAD

**Cobre:** RF-02

**Depende de:** T-01

**Aceite:** existem os casos:
- caso 2: GET com `Range: bytes=2-4` responde `206`, `content-range: bytes 2-4/10`, `content-length: 3`, corpo `234`;
- caso 3: HEAD com `Range: bytes=2-4` responde `206` com os mesmos cabeçalhos, corpo vazio, e `getContents` não é chamado;
- caso 22: `getContents` devolve `null` e depois `undefined`, com Range válido, e a resposta é `200` sem `content-range`, com corpo vazio (decisão D-07 e risco R2 do PRD).

O caso 22 deve passar já no código atual.

**Arquivos:** `test/static-range.test.ts`

---

### T-03 — Testes das formas de intervalo e do ajuste de limites

**Cobre:** RF-03

**Depende de:** T-01

**Aceite:** existe o caso 4, com três GETs no mesmo asset de 10 bytes: `bytes=7-100` → `206` `bytes 7-9/10`; `bytes=-3` → `206` `bytes 7-9/10`; `bytes=-50` → `206` `bytes 0-9/10`. Verificar nessa ordem. Existe também um caso extra para a forma aberta `bytes=2-`: `206`, `bytes 2-9/10`, `content-length: 8`, corpo `23456789`. O PRD lista essa forma, e a techspec não a cobre explicitamente.

**Arquivos:** `test/static-range.test.ts`

---

### T-04 — Testes do `416 Range Not Satisfiable`

**Cobre:** RF-04

**Depende de:** T-01

**Aceite:** existem os casos:
- caso 5: `bytes=10-20` responde `416`, `content-range: bytes */10`, `content-length: 0`, corpo vazio, e `getContents` não é chamado;
- caso 6: `bytes=-0` responde `416`;
- caso 27: asset de tamanho 0 com `bytes=0-` responde `416`, `content-range: bytes */0`, e `accept-ranges: bytes` está presente.

**Arquivos:** `test/static-range.test.ts`

---

### T-05 — Testes do `Range` que é ignorado

**Cobre:** RF-05

**Depende de:** T-01

**Aceite:** existe o caso 7, uma tabela com `items=0-1`, `bytes=0-1,4-5`, `bytes=abc`, `bytes=`, `bytes=1`, `bytes=-` e `bytes=5-2`. Para cada valor, a resposta é `200`, sem `content-range`, com corpo completo de 10 bytes, e nunca `416`. Existe o caso 8, com `bytes = 2 - 4` e `  bytes=2-4  `, que responde `206` com `bytes 2-4/10`.

Os casos da tabela devem passar já no código atual. O caso 8 falha até T-15.

**Arquivos:** `test/static-range.test.ts`

---

### T-06 — Testes de `If-Range`

**Cobre:** RF-06

**Depende de:** T-01

**Aceite:** existem os casos:
- caso 9: `If-Range` com o ETag forte igual ao do asset, responde `206`;
- caso 10: `If-Range: W/"v1"` com ETag forte `"v1"` no asset, responde `200` completo;
- caso 11: `If-Range: "v1"` com ETag fraco `W/"v1"` no asset, responde `200` completo;
- caso 12: `If-Range` com data exatamente igual ao `last-modified`, responde `206`;
- caso 13: data diferente, e também sem `last-modified`, respondem `200` completo;
- caso 14: `If-Range` sem `Range` responde `200` completo, sem `content-range`;
- caso 15: `If-Range` falso com `bytes=10-20` responde `200`, e não `416`.

Os casos 9 e 12 falham até T-15. Os demais devem passar já no código atual.

**Arquivos:** `test/static-range.test.ts`

---

### T-07 — Testes da precedência do `304` sobre `Range`

**Cobre:** RF-07

**Depende de:** T-01

**Aceite:** existe o caso 16: `Range: bytes=0-3` com `If-None-Match: "v1"` responde `304`, sem `content-range`, sem corpo, e `getContents` não é chamado. Existe um caso extra com `If-Modified-Since` que casa, e `Range` presente, para o mesmo resultado. Ambos devem passar já no código atual e continuar passando depois da mudança.

**Arquivos:** `test/static-range.test.ts`

---

### T-08 — Testes de tamanho desconhecido

**Cobre:** RF-08

**Depende de:** T-01

**Aceite:** existe o caso 17: `getMeta` sem `size` com `Range: bytes=0-3` responde `200` completo, sem `accept-ranges` e sem `content-range`. Incluir também `size` como string `"10"` e como `NaN`, que o PRD trata como não numérico. Os casos devem passar já no código atual.

**Arquivos:** `test/static-range.test.ts`

---

### T-09 — Testes da variante codificada

**Cobre:** RF-09

**Depende de:** T-01

**Aceite:** o `getMeta` e o `getContents` devolvem conteúdo diferente para cada `id`. `app.js` tem 10 bytes e `app.js.gz` tem 6 bytes, com `encoding: "gzip"`, e `encodings: { gzip: ".gz" }`. Existem os casos:
- caso 18: `accept-encoding: gzip` com `Range: bytes=0-1` responde `206`, `content-range: bytes 0-1/6`, `content-encoding: gzip`, e corpo igual aos dois primeiros bytes de `app.js.gz`;
- caso 19: a mesma configuração com `bytes=10-20` responde `416`, com `content-encoding: gzip` e `content-range: bytes */6`.

**Arquivos:** `test/static-range.test.ts`

---

### T-10 — Testes de corpo idêntico ao do `200`

**Cobre:** RF-10

**Depende de:** T-01

**Aceite:** existem os casos:
- caso 20: `getContents` devolve um `ReadableStream` em dois chunks, `01234` e `56789`, com `Range: bytes=3-6`, responde `206` com corpo `3456`. O `getContents` precisa criar um stream novo a cada chamada;
- caso 21: para os corpos `string`, `Blob`, `ArrayBuffer`, `Uint8Array` e `ReadableStream`, com o mesmo `Range`, os bytes do `206` são iguais aos bytes do intervalo correspondente na resposta `200`.

`FormData` fica de fora, pelo risco R-04 da techspec.

**Arquivos:** `test/static-range.test.ts`

---

### T-11 — Testes de preservação do comportamento atual

**Cobre:** RF-11

**Depende de:** T-01

**Aceite:** existem os casos:
- caso 23: `DELETE` com `Range: bytes=0-1` e `options.headers` com `cache-control`, responde `405` com `allow: GET, HEAD`, sem `content-range` e sem `accept-ranges`;
- caso 24: asset não encontrado com `Range` responde `404`, sem `accept-ranges`;
- caso 25: `options.headers: { "content-length": "999" }` com `Range: bytes=0-1` responde `206` com `content-length: 2`, mostrando que `content-length` de `206` sobrescreve (decisão P4 e D-04);
- extra: `options.headers: { "accept-ranges": "none" }` é mantido na resposta, sem ser sobrescrito (decisão D-03);
- extra: asset não encontrado com `fallthrough: true` e `Range` cai no mesmo caminho que sem `Range`;
- extra: caminho não canônico com `Range` tem a mesma resposta que sem `Range`.

O caso 26 (`content-length: 999` sem Range) já está coberto por `test/static.test.ts:600-616`, e não é repetido aqui.

Os casos 23, 24, o `accept-ranges: none` e os dois extras devem passar já no código atual. O caso 25 falha até T-15.

**Arquivos:** `test/static-range.test.ts`

---

### T-12 — Implementar `accept-ranges` na resposta

**Cobre:** RF-01, RF-08

**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11

**Aceite:** a regra fica depois de `src/utils/static.ts:241` e antes de `src/utils/static.ts:243` (D-02). O cabeçalho é gravado só se ausente (D-03), e só quando `size` é inteiro não negativo (D-09). Os casos 1 e 17 passam. O caso 28 passa para `200` e `304`. Os demais status dele dependem de T-13 e T-15. O caso extra de `accept-ranges: none` continua passando. `pnpm lint` e `pnpm typecheck` passam.

**Arquivos:** `src/utils/static.ts`

---

### T-13 — Implementar o parse de `Range`, o `416` e o `206` de HEAD

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-11

**Depende de:** T-12

**Aceite:** existem `RANGE_RE`, o tipo `RangeResolution` e `parseRange`, seguindo D-05 e a seção 4.1 da techspec. A avaliação de Range fica depois de `src/utils/static.ts:270` e antes do ramo de HEAD (D-02). Ao chegar em `416` ou `206`, `content-range` e `content-length` são gravados com `set`, sobrescrevendo valores anteriores (D-04). Os casos 3, 5, 6, 7 e 27 passam. Os casos de GET que esperam `206` (2, 4, 8, 25 e 28 nos status 206) só passam depois de T-15, e isso é esperado. `pnpm lint` e `pnpm typecheck` passam.

**Arquivos:** `src/utils/static.ts`

---

### T-14 — Implementar `If-Range` e a ordem em relação ao `304`

**Cobre:** RF-06, RF-07

**Depende de:** T-13

**Aceite:** existe `isIfRangeMatch`, seguindo D-06. Para ETag, a comparação é forte e um ETag com `W/` nunca é igual. Para data, a comparação é exata com `last-modified`. Sem `Range`, `If-Range` é ignorado. Um `If-Range` falso faz o `Range` ser ignorado, mesmo quando o intervalo seria `416`. A avaliação de Range continua depois de `isCacheMatch` (RF-07 e R5 do PRD). Os casos 10, 11, 13, 14, 15 e 16 passam. Os casos 9 e 12 passam depois de T-15. `pnpm lint` e `pnpm typecheck` passam.

**Arquivos:** `src/utils/static.ts`

---

### T-15 — Implementar o `206` de GET com `sliceBody` e o corpo nulo

**Cobre:** RF-02, RF-09, RF-10

**Depende de:** T-14

**Aceite:** existe `sliceBody`, seguindo D-08 e a tabela de tipos da techspec. Para `ReadableStream`, lê e descarta os bytes antes do início, emite o intervalo e cancela a origem ao terminar. Para os demais tipos, usa `slice`, `subarray` ou `Uint8Array` com offset, conforme a tabela. `getContents` é chamado antes de gravar `content-range` (D-07). Se o corpo é falsy, a resposta é o `200` atual. Todos os casos de `test/static-range.test.ts` passam em `web` e `node`, incluindo 2, 4, 8, 9, 12, 18, 19, 20, 21, 22, 25 e 28. `pnpm lint` e `pnpm typecheck` passam.

**Arquivos:** `src/utils/static.ts`

---

### T-16 — Verificar regressões e a suíte completa

**Cobre:** RF-11, RF-13

**Depende de:** T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-15

**Aceite:** `pnpm vitest run test/static.test.ts test/security.test.ts test/router.test.ts test/unit/package.test.ts` passa. `pnpm test` (lint, typecheck e coverage) passa. Se alguma asserção existente quebrar por causa de `accept-ranges`, ajustar só essa asserção, sem remover o que ela verifica (RF-13 e R3). Registrar na descrição do PR quais asserções foram ajustadas, se houver alguma.

**Arquivos:** `test/static.test.ts` (somente se houver ajuste necessário), `test/static-range.test.ts`

---

### T-17 — Verificar que a API pública não mudou

**Cobre:** RF-12

**Depende de:** T-15

**Aceite:** `git diff -- src/index.ts` não mostra mudanças. O snapshot de exportações em `test/unit/package.test.ts:133` passa sem alteração. As interfaces `ServeStaticOptions` e `StaticAssetMeta` (`src/utils/static.ts:9-66`) não têm diff. Não há nenhuma linha nova com `export` em `src/utils/static.ts`, o que se confere com `git diff`.

**Arquivos:** `src/index.ts` (somente leitura), `src/utils/static.ts` (somente leitura)

---

### T-18 — Documentar o suporte a `Range` no `serveStatic` (opcional)

**Cobre:** nenhum requisito do PRD. Recomendado pela techspec (seção 3.4).

**Depende de:** T-16

**Aceite:** existe um parágrafo na seção de `serveStatic` de `docs/2.utils/2.response.md`. Ele diz que o `serveStatic` atende `Range` com `bytes`, responde `206` e `416`, e aplica o intervalo sobre a variante escolhida. `CHANGELOG.md` não é editado. `pnpm lint` passa.

**Arquivos:** `docs/2.utils/2.response.md`
