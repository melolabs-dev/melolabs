# Tarefas: HTTP Range em `serveStatic` (h3js/h3#1267)

Base: `sdd/prd.md` (RF-01 a RF-13, ordem de avaliação), `sdd/techspec.md` (decisões D-01 a D-14, casos de teste em §5.2, pontos a confirmar em §9) e `sdd/pedido.md` (issue e contrato, se existir; ver T-01).

## Regras gerais

- Ordem: T-01 primeiro. Depois T-09 (linha de base das exportações, antes de qualquer mudança em `src/`). Depois os testes T-02 a T-08, que escrevem casos que devem falhar. Só então entram as implementações T-10 a T-15. T-16 a T-18 fecham a entrega.
- Testes vermelhos: a tarefa só termina quando a saída do `vitest` mostra que o caso falha por asserção (cabeçalho ausente, status 200 em vez de 206/416, `getContents` chamado), e não por erro de sintaxe ou de import. Registrar essa saída na descrição do PR.
- Todos os casos rodam em `web` e `node` via `describeMatrix`. Como `it.each` não existe no wrapper, usar `for` e colocar o valor no nome do caso, para que o nome seja único por modo.
- Tarefas de teste tocam o mesmo arquivo (`test/static.test.ts`), então devem ser feitas em sequência.

## Decisões de §9 que bloqueiam tarefas

Antes de começar, use a recomendação da techspec para cada ponto abaixo e registre a escolha na descrição do PR. Se o responsável mudar a decisão, os testes listados na coluna "Afeta" mudam junto.

| §9 | Decisão | Afeta |
| --- | --- | --- |
| 9.1 | Tamanho zero: ignorar Range (recomendado) ou 416 | T-07 (RF-10 com `size: 0`), T-13 |
| 9.2 | Unidade `Bytes=` aceita (recomendado) ou não | T-04 (caso de caixa), T-10 |
| 9.3 | Divergência de tamanho: 200 sem Range (recomendado) | T-08 (D-08), T-14 |
| 9.4 | `accept-ranges` sobrescrevível por `options.headers` | T-02, T-12 |
| 9.5 | Helpers em `static.ts` (recomendado) ou `utils/internal/range.ts` | T-10, T-11 |
| 9.6 | Número fora da faixa segura: malformado (recomendado) ou 206 cobrindo o arquivo | T-04, T-10 |
| 9.7 | Data só pela string exata de `Last-Modified` (recomendado) | T-06, T-11 |
| 9.8 | ETag da variante `encodings`: confirmar no código como é montado | T-01, T-07 (D-14), T-15 |
| 9.9 | Existência de `sdd/pedido.md` | T-01 |

---

### T-01 — Confirmar linha de base e pré-requisitos

Cobre: RF-13
Depende de: nenhuma
Aceite:
- Verificar se `sdd/pedido.md` existe.
  - Se existir: as referências a ele (techspec D-01 e §9.9) ficam como estão.
  - Se não existir: registrar isso no PR, reescrever as referências de `sdd/techspec.md` (D-01, §9.9, e qualquer `pedido.md:N`) para o PRD ou para a própria issue, e não citar `pedido.md` no PR. A decisão D-01 não depende do arquivo; a justificativa só usa o texto da issue.
- `pnpm vitest run test/static.test.ts` passa com a contagem atual de testes. A techspec cita 76, de uma execução anterior, então anotar o número real.
- Confirmado que `pnpm lint` não roda `tsc` e que `pnpm typecheck` existe em `package.json`. Se `typecheck` não existir, T-17 usa `pnpm exec tsc --noEmit` e o registro vai para o PR.
- Confirmado no código como o `etag` é montado para cada variante de `encodings` (§9.8). Registrar o resultado: se a variante tem ETag próprio e se é igual ao do original. T-07 (caso D-14) e T-15 dependem disso.
- Registradas na descrição do PR as escolhas da tabela de §9 acima.

Arquivos: `sdd/pedido.md` (se existir), `package.json`, `test/static.test.ts`, `src/utils/static.ts` (somente leitura)

---

### T-02 — Testes vermelhos: `Accept-Ranges` e preservação de 404/405

Cobre: RF-01, RF-11
Depende de: T-01
Aceite:
- Casos novos em `describeMatrix("serve static range", ...)` no fim de `test/static.test.ts`, em `web` e `node`:
  - GET sem Range → 200 com `accept-ranges: bytes` (falha hoje por ausência do cabeçalho).
  - HEAD sem Range → 200 com `accept-ranges: bytes`.
  - 404 e 405 sem `accept-ranges`.
  - POST com `Range: bytes=0-99` → 405 com `allow: GET, HEAD`, e `getContents` não chamado.
  - `fallthrough: true` + POST com Range → cai no próximo handler.
- Os casos de 405, 404 e fallthrough passam já na linha de base (são comportamentos preservados). Os de `accept-ranges` falham pelo motivo esperado.
- `accept-ranges` em 206 e 416 não é testado aqui; fica em T-03 e T-05.

Arquivos: `test/static.test.ts`

---

### T-03 — Testes vermelhos: 206 em GET e HEAD, e formas de intervalo

Cobre: RF-02, RF-03, RF-04, RF-01
Depende de: T-01
Aceite:
- Casos de §5.2 para RF-02 e RF-03, em `web` e `node`:
  - GET `bytes=0-99` → 206, `content-range: bytes 0-99/1000`, `content-length: 100`, corpo = `body.slice(0, 100)`.
  - `bytes=500-` → `500-999/1000`; `bytes=0-` → `0-999/1000`; `bytes=999-999` → `content-length: 1`.
  - `bytes=-100` → `900-999/1000`; `bytes=-5000` → `0-999/1000`; `bytes=990-5000` → `990-999/1000`.
- GET 206 também tem `accept-ranges: bytes` (RF-01 cobre 206). E `getContents` é chamado exatamente uma vez (D-06).
- HEAD `bytes=0-99` → 206 com os mesmos cabeçalhos, corpo vazio e `getContents` não chamado (RF-04).
- Todos falham antes da implementação (status 200 ou cabeçalho ausente).

Arquivos: `test/static.test.ts`

---

### T-04 — Testes vermelhos: Range malformado ou não suportado é ignorado

Cobre: RF-05
Depende de: T-01 (§9.2 e §9.6)
Aceite:
- Laço sobre os valores: `items=0-1`, `bytes=0-1,5-9`, `bytes=+1-2`, `bytes= 1-2`, `bytes=500-100`, `bytes=-`, `bytes=abc`. Cada um gera um `it` com o valor no nome.
- Números fora da faixa segura (`bytes=99999999999999999999-`, `bytes=0-99999999999999999999`, `bytes=-99999999999999999999`) são casos de §9.6. Com a recomendação (malformado), esperam 200 completo, como os demais. Esses casos **não** falham antes nem depois da implementação: passam já na linha de base e devem continuar passando. Se §9.6 mudar para 206, eles passam a esperar 206 e a falhar antes de T-10.
- Resultado esperado de cada caso: 200, corpo completo, sem `content-range`.
- Caso de caixa (`Bytes=0-9`): deixar o teste pendente até a decisão de §9.2. A recomendação é aceitar (206).
- Os casos de análise sintática falham hoje? Não: já respondem 200. Eles são testes de regressão. Registrar isso no PR para não parecer que o teste está vermelho por engano.

Arquivos: `test/static.test.ts`

---

### T-05 — Testes vermelhos: 416 para intervalo não satisfazível

Cobre: RF-06, RF-01
Depende de: T-01
Aceite:
- GET `bytes=1000-1100` → 416, `content-range: bytes */1000`, `content-length: 0`, corpo vazio, `accept-ranges: bytes`.
- GET `bytes=1000-` → mesmos cabeçalhos.
- GET `bytes=-0` → 416.
- HEAD `bytes=1000-1100` → 416 com os mesmos cabeçalhos e `getContents` não chamado.
- Falham antes da implementação.

Arquivos: `test/static.test.ts`

---

### T-06 — Testes vermelhos: `If-Range` e ordem de avaliação

Cobre: RF-07
Depende de: T-01 (§9.7)
Aceite:
- Asset com ETag `"v2"` e `mtime` com milissegundos, `Range: bytes=0-99`:
  - `If-Range: "v1"` → 200 sem `content-range`.
  - `If-Range: "v2"` → 206.
  - `If-Range: W/"v2"` → 200.
  - `If-Range` com a string exata de `Last-Modified` → 206.
  - `If-Range` com data diferente → 200.
  - `If-Range` com data em outro formato (`2020`) → 200.
  - `If-Range` vazio → 200.
- Asset com ETag fraco `W/"v2"` + `If-Range: "v2"` → 200 (RF-07: ETag fraco no asset nunca casa). Esse caso não estava na lista anterior.
- Asset sem ETag + `If-Range: "v2"` → 200. Asset sem `mtime` + `If-Range` com data → 200.
- HEAD + `If-Range: "v1"` + `bytes=0-99` → 200 sem `content-range`.
- Sem `Range`, `If-Range` é ignorado: GET com `If-Range: "v1"` → 200 completo (RFC 9110 §13.1.5). Sem alteração de corpo ou cabeçalhos além de `accept-ranges`.
- Ordem: `If-Range: "v1"` + `bytes=5000-` → 200, não 416 (R-06 da techspec).
- Os casos que devem dar 200 podem já passar; os de 206 falham.

Arquivos: `test/static.test.ts`

---

### T-07 — Testes vermelhos: cache, variantes de encoding e tamanho ausente

Cobre: RF-08, RF-09, RF-10
Depende de: T-01 (§9.1 e §9.8)
Aceite:
- RF-08: `If-None-Match: "v2"` + `Range: bytes=0-99` → 304, sem corpo. A parte de `accept-ranges` falha na linha de base (ainda não existe), então o caso falha por esse cabeçalho até T-12. O status 304 já passa.
- RF-09: `app.js` com variante `app.js.gz` de 300 bytes, `accept-encoding: gzip`, `Range: bytes=0-9` → 206, `content-range: bytes 0-9/300`, `content-encoding: gzip`, `vary` com `accept-encoding`. Falha hoje.
- RF-09 / D-14: o resultado de T-01 (§9.8) define o caso.
  - Se a variante não tem ETag próprio e herda o do original: `If-Range: "v2"` → 200 sem `content-range`.
  - Se a variante tem ETag próprio diferente (ex.: `"v2-gzip"`): `If-Range` com o ETag da variante → 206; com o ETag do original → 200.
  - Se a variante tem o mesmo ETag do original: a decisão D-14 muda. Parar e registrar antes de fixar o caso.
- RF-10: `getMeta` sem `size` + Range → 200 com corpo completo (passa na linha de base). `size: 0` + Range → 200 com corpo completo, sujeito a §9.1. Se §9.1 mudar para 416, o caso passa a esperar 416 e falha antes de T-13.

Arquivos: `test/static.test.ts`

---

### T-08 — Testes vermelhos: corpo, divergência de tamanho e `Content-Length`

Cobre: RF-02, RF-13
Depende de: T-01 (§9.3)
Aceite:
- D-07: laço sobre tipos de `getContents`: `string`, `Uint8Array`, `ArrayBuffer`, `Blob`, `ReadableStream`, com `bytes=100-199` → mesmo 206 e mesmo corpo em todos.
- D-08: `getMeta.size = 1000`, corpo de 900 bytes, `Range: bytes=0-99` → 200, corpo de 900 bytes, sem `content-range`. Não fixar o `content-length` desse ramo como valor correto (R-04 da techspec).
- D-09: `getContents` devolve `null` + `Range: bytes=0-99` → 200, sem `content-range`, sem corpo.
- D-11: `options.headers: { "content-length": "999" }` + `Range: bytes=0-99`, GET → 206 com `content-length: 100`; HEAD → 206 com `content-length: 100`, sem corpo.
- Os casos de D-08 e D-09 podem passar na linha de base (200 é o comportamento atual). Os de D-07 e D-11 falham.

Arquivos: `test/static.test.ts`

---

### T-09 — Registrar a linha de base das exportações (RF-12)

Cobre: RF-12
Depende de: T-01
Aceite:
- Antes de qualquer alteração em `src/`, registrar as exportações atuais de `src/index.ts` (linha 193 segundo a techspec: `ServeStaticOptions`, `StaticAssetMeta`, `serveStatic`) e de `src/utils/static.ts`. Gravar a lista em um arquivo da scratchpad ou colar na descrição do PR, para comparação em T-17.
- Registrar o conteúdo atual de `ServeStaticOptions` (`src/utils/static.ts:17-66`), para provar depois que nenhuma opção foi acrescentada.
- Verificar se existe teste de tipos de exportação em `test/unit/` (AGENTS.md cita `types.test-d.ts`).
  - Se existir: usá-lo em T-17 como verificação.
  - Se não existir: usar o `grep` de techspec §5.4 e o `git diff` de T-17.

Arquivos: `src/index.ts`, `src/utils/static.ts`, `test/unit/` (somente leitura)

---

### T-10 — Implementar análise sintática estrita de `Range` (`parseRange`)

Cobre: RF-03, RF-05, RF-06
Depende de: T-04, T-05, T-09 (§9.2, §9.5, §9.6)
Aceite:
- Helper `parseRange(value, size)` privado em `src/utils/static.ts`, na seção `// --- Internal Utils ---`, sem `export` (D-01).
- Regex conforme D-04: `/^bytes=(\d+)-(\d*)$/` e `/^bytes=-(\d+)$/`. Números passam por `Number` e `Number.isSafeInteger`.
- Ordem de verificação dentro da função (importa para casos como `bytes=1000-100`):
  1. Sintaxe, unidade, vírgula e número fora da faixa segura → `undefined`.
  2. `fim < início` → `undefined` (malformado, não 416).
  3. Início além do fim (`início >= size`) ou sufixo zero → `"unsatisfiable"`.
  4. Demais casos → `ByteRange` com `end` limitado a `size - 1`.
- Caixa de `bytes` conforme §9.2 (recomendado: aceitar).
- Tipo `ByteRange` sem `export`.
- T-04 e T-05 (parte de análise) ficam verdes. Os casos de 206 de T-03 ainda podem falhar, porque o ramo de resposta ainda não existe.

Arquivos: `src/utils/static.ts`

---

### T-11 — Implementar `If-Range` e `resolveRange`

Cobre: RF-07, RF-06
Depende de: T-06, T-10 (§9.5, §9.7)
Aceite:
- Helper `ifRangeMatches(ifRange, validators)` com a regra de D-05: ETag forte com comparação exata e sem `W/`; data por igualdade exata com a string de `Last-Modified` (`mtimeDate` truncado), nunca `new Date(valor)`. `If-Range` vazio não casa.
- Helper `resolveRange(headers, validators, size)` com a ordem do PRD:
  1. Sem cabeçalho `Range` → `undefined` (o `If-Range` nem é lido).
  2. Com `If-Range` que não casa → `undefined`, mesmo com intervalo além do fim.
  3. Só depois: `parseRange` e o resultado dele.
- Interface `RangeValidators` com `etag` e `lastModified` (string), sem `export`.
- Todos os casos de T-06 ficam verdes.

Arquivos: `src/utils/static.ts`

---

### T-12 — Anunciar `Accept-Ranges` antes da checagem de cache

Cobre: RF-01, RF-08
Depende de: T-02, T-07 (§9.4)
Aceite:
- Bloco `if (!event.res.headers.get("accept-ranges")) event.res.headers.set("accept-ranges", "bytes")` logo depois do bloco de `etag` (`src/utils/static.ts:239-241`) e antes da checagem de cache (D-10).
- Caso de 304 de RF-08 (T-07) recebe `accept-ranges`.
- Usuário que definir `accept-ranges` em `options.headers` mantém o próprio valor (padrão de `etag`). Se §9.4 decidir o contrário, mudar só esta linha.
- Casos de T-02 de `accept-ranges` ficam verdes; 404 e 405 continuam sem o cabeçalho.
- Ramo de cache (`src/utils/static.ts:243-248`) sem mudança de lógica (R-07).

Arquivos: `src/utils/static.ts`

---

### T-13 — Implementar ramo de HEAD (206 e 416), GET 416 e tamanho ausente

Cobre: RF-04, RF-06, RF-10, RF-02
Depende de: T-03, T-05, T-07, T-10, T-11, T-12 (§9.1)
Aceite:
- Após `content-length` (`src/utils/static.ts:268-270`) e antes do bloco de HEAD (`:272-274`), inserir a decisão de Range (D-02).
- `range = meta.size ? resolveRange(...) : undefined` (D-12, RF-10). `size` ausente ou zero não aplica Range.
- 416: `content-range: bytes */size`, `content-length: 0`, `statusText: "Range Not Satisfiable"`, corpo nulo. Gravado em `event.res.headers` (D-03), não no `init`. Vale para GET e HEAD, antes de qualquer chamada a `getContents` (D-06).
- HEAD com `range` válido: 206 com `content-range` e `content-length` gravados em `event.res.headers` (D-03, D-11), sem chamar `getContents`.
- Ficam verdes aqui: os casos de HEAD de T-03, T-05, T-06, o de RF-10 de T-07, e os casos de 416 em GET de T-05 (o 416 é decidido antes do ramo de GET; T-14 não é necessário para eles).
- Testes de `content-length` existentes (`test/static.test.ts:600-617`) continuam verdes.

Arquivos: `src/utils/static.ts`

---

### T-14 — Implementar ramo de GET com 206 (recorte do corpo)

Cobre: RF-02, RF-03, RF-06, RF-09, RF-13
Depende de: T-08, T-13
Aceite:
- Para GET com `range` válido, `getContents` é chamado uma vez (D-06, D-07). Corpo lido com `new Uint8Array(await new Response(contents).arrayBuffer())`.
- Se `bytes.byteLength === meta.size`, responder 206 com `bytes.subarray(start, end + 1)`, `content-range` e `content-length` gravados em `event.res.headers` (D-03, D-11).
- Se a divergência de tamanho ocorrer, responder 200 com o corpo lido, sem `content-range` e sem novo `content-length` (D-08, §9.3). O `content-length` pré-existente (`size`) fica como está; é o comportamento atual.
- Se `getContents` devolver `null` ou `undefined`, responder 200 como hoje (D-09).
- Casos de D-07, D-08, D-09 e D-11 (T-08) ficam verdes. Os casos de GET 206 de T-03 ficam verdes. Os casos de GET 416 já estão verdes desde T-13.
- Nenhum teste é alterado nesta tarefa. Se algum caso de T-03 ou T-08 precisar de ajuste para passar, parar e avaliar, porque o contrato dos testes é o da techspec.
- Teste de regressão: a suíte completa de `test/static.test.ts` continua verde, sem alterar asserções existentes.

Arquivos: `src/utils/static.ts`

---

### T-15 — Validar `encodings` e `If-Range` com ETag de variante

Cobre: RF-09
Depende de: T-07, T-14 (§9.8)
Aceite:
- O caso de variante gzip de T-07 passa: 206, `bytes 0-9/300`, `content-encoding: gzip`, `vary` com `accept-encoding`.
- `resolveRange` recebe o ETag da variante servida, não o do original (D-14). Confirmar que o `meta` usado é o da variante (tamanho de 300 bytes).
- O caso de `If-Range` de T-07 segue o resultado de §9.8 registrado em T-01. Se a variante tem o mesmo ETag do original, não corrigir o código sem antes revisar D-14.
- `Content-Encoding` e `Vary` sem alteração (RF-09).
- Se a verificação não exigir mudança de código, a tarefa termina só com os testes verdes e a nota no PR.

Arquivos: `src/utils/static.ts` (se houver ajuste), `test/static.test.ts` (só se o caso de T-07 precisar de ajuste conforme §9.8)

---

### T-16 — Ajustar o JSDoc de `serveStatic` e regenerar a documentação

Cobre: RF-01, RF-02, RF-03, RF-06
Depende de: T-14, T-15
Aceite:
- Parágrafo no JSDoc de `serveStatic` (`src/utils/static.ts:68-100`) descrevendo: `Accept-Ranges`, 206 para intervalo único, 416 para intervalo não satisfazível, Range ignorado em casos malformados ou múltiplos, `If-Range`, e que o corpo de GET é lido por inteiro.
- Não editar `docs/2.utils/2.response.md` à mão. Regenerar com `pnpm exec automd` (R-12). Não usar `pnpm fmt` (altera arquivos não relacionados).
- Diff de `docs/` contém só a seção gerada de `serveStatic`.

Arquivos: `src/utils/static.ts`, `docs/2.utils/2.response.md`

---

### T-17 — Verificação final de qualidade e exportações

Cobre: RF-12, RF-13
Depende de: T-09, T-15, T-16
Aceite:
- `git diff -- src/index.ts` vazio.
- `git diff -- src/utils/static.ts` não contém nenhuma linha `+export` nova (RF-12). Comparar com a linha de base de T-09.
- Nenhuma opção nova em `ServeStaticOptions`, comparada com a linha de base de T-09.
- Sequência, nesta ordem: `pnpm vitest run test/static.test.ts` (verde nos modos `web` e `node`), `pnpm lint`, `pnpm typecheck` (ou `pnpm exec tsc --noEmit`, se T-01 apontou que o script não existe), `pnpm build`, `pnpm test`. Registrar a saída de cada um.
- Se algum falhar, reportar com a saída, sem marcar a entrega como concluída.
- Não há alteração em `src/response.ts`, `src/rules/*`, `src/utils/internal/cache.ts` ou `src/utils/proxy.ts` (techspec §3).
- Descrição do PR com: as escolhas de §9 registradas em T-01, o estado de `sdd/pedido.md`, e a saída de vermelho de T-02 a T-08.

Arquivos: `src/index.ts`, `src/utils/static.ts`, `test/static.test.ts`, `docs/2.utils/2.response.md`

---

### T-18 — Atualizar `AGENTS.md` sobre o que `pnpm lint` faz (opcional, em PR separado)

Cobre: RF-13
Depende de: T-17
Aceite:
- Decidir se a correção de `AGENTS.md:18` (que diz que `pnpm lint` inclui typecheck) entra nesta entrega. A techspec (R-13) pede que seja feita em separado, então o padrão é não incluir.
- Se for feita, a mudança diz que `pnpm lint` não roda `tsc` e que a verificação de tipos é `pnpm typecheck`.
- Sem essa mudança, a entrega registra o problema no PR.

Arquivos: `AGENTS.md`
