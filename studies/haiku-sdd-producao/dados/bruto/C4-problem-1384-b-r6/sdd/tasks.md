# Tarefas de implementação — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-07, seções 3 a 5).

Ordem geral: testes primeiro (vermelho), depois implementação (verde), depois verificação. Todos os caminhos são relativos a `C:\dev\runs\r58e1e8eebf`.

### T-01 — Escrever os testes de problem details (vermelho antes da implementação)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10

**Depende de:** nenhuma

**Aceite:**
- `test/problem-details.test.ts` existe, usa `describeMatrix` e cobre os casos da techspec, seção 5, item 1 (incluindo os casos negativos de D-04 e a precedência de D-03).
- Antes de qualquer mudança em `src/`, `pnpm vitest run test/problem-details.test.ts` falha nos casos de RF-01, RF-02, RF-03, RF-04, RF-06 (parte RFC) e RF-09.
- Os casos de controle (RF-05 parcial, RF-07 parcial, RF-08, RF-10, HEAD com erro e caso de rota 404 sem `statusText`) passam já hoje.
- No caso RF-07, o teste verifica que a string `senha inválida` não aparece no texto da resposta.

**Arquivos:** `test/problem-details.test.ts` (novo)

### T-02 — Escrever o teste de tipos para `type` e `instance` (RF-11)

**Cobre:** RF-11, RF-04

**Depende de:** nenhuma

**Aceite:**
- Conferir antes se `test/unit/types.test-d.ts` existe (a techspec, seção 3, diz que não foi verificado). Se existir, adicionar asserções: `new HTTPError({ status: 409, type: "...", instance: "..." })` compila e `ErrorBody` aceita `type` e `instance` como opcionais.
- Se o arquivo não existir, registrar a ausência na entrega e cobrir RF-11 só pelo `pnpm typecheck` da T-07.
- Antes da T-03, o teste de tipos falha (ou `pnpm typecheck` falha) nos campos novos.

**Arquivos:** `test/unit/types.test-d.ts` (se existir)

### T-03 — Adicionar `type` e `instance` a `ErrorBody` e a `HTTPError`

**Cobre:** RF-04, RF-11

**Depende de:** T-01, T-02

**Aceite:**
- `ErrorBody` ganha `type?: string` e `instance?: string`, com JSDoc citando RFC 9457 (techspec, seção 4).
- `HTTPError` ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, com tipo explícito (exigido por `isolatedDeclarations`).
- O construtor lê `type` e `instance` só de `details`, nunca de `details.cause` (D-04). Teste negativo `new HTTPError({ cause: { type: "x", status: 400 } })` dá `err.type === undefined`.
- `ErrorInput` herda os campos sem edição (techspec, seção 1).
- Nenhum símbolo novo é exportado em `src/index.ts` (RF-11).

**Arquivos:** `src/error.ts`

### T-04 — Reescrever `HTTPError.toJSON()` com os membros RFC

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07

**Depende de:** T-03

**Aceite:**
- A ordem de montagem segue D-03: legados (`statusText`, `unhandled`, `message`, `data`), depois `...this.body` (só fora de `unhandled`), depois os membros RFC (`type`, `title`, `status`, `detail`, `instance`).
- `title` vem de `statusText` e só entra quando `statusText` existe. Nunca se usa `title: undefined`, porque isso apagaria um `body.title` legítimo (D-03, detalhe).
- `detail` vem de `message`, ou é `"HTTPError"` quando `unhandled`. `type` é o valor de entrada ou `"about:blank"`, e é sempre `"about:blank"` quando `unhandled`. `instance` só entra quando tem valor e não é `unhandled` (D-05, D-04).
- Com `body: { title: "outro" }` e `statusText: "Conflict"`, o corpo tem `title: "Conflict"`. Com `body: { message: "do body" }`, o corpo mantém `message: "do body"` (comportamento atual).
- O tipo de retorno de `toJSON()` é inline e não exporta nada novo (techspec, seção 4).
- Os testes de T-01 para RF-02, RF-03, RF-05, RF-06 e RF-07 passam.

**Arquivos:** `src/error.ts`

### T-05 — Trocar o `Content-Type` de erro para `application/problem+json`

**Cobre:** RF-01, RF-08, RF-09, RF-10

**Depende de:** T-04

**Aceite:**
- `src/response.ts` ganha `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`), ao lado de `jsonHeaders`, não exportada (D-06, techspec seção 4).
- `jsonHeaders` continua sendo usado pelo caminho de sucesso (`src/response.ts:312` na linha de referência da techspec). `problemHeaders` é usado só em `errorResponse()`, nos dois ramos (`src/response.ts:359-361`).
- `stack` continua sendo o último membro do corpo e só aparece com `debug` (RF-08).
- `headers` do erro continuam na resposta. `mergeHeaders` mantém a regra atual (R-08 da techspec).
- Os testes de T-01 para RF-01, RF-08, RF-09 e RF-10 passam. Um handler que retorna objeto continua com `application/json;charset=UTF-8`.
- O 404 de rota (`src/response.ts:139-144`) responde com `application/problem+json`.

**Arquivos:** `src/response.ts`

### T-06 — Ajustar os dois testes existentes que dependem do Content-Type antigo

**Cobre:** RF-01, RF-05, RF-10

**Depende de:** T-05

**Aceite:**
- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` vira `toBe("application/problem+json")`. Os demais `expect` do mesmo teste ficam como estão.
- `test/errors.test.ts:140`: `toMatch("application/json")` vira `toMatch("application/problem+json")`.
- Nenhuma assertion sobre `message`, `data`, `status` ou headers é removida.
- `pnpm vitest run test/errors.test.ts` passa.
- Os demais testes listados como "sem mudança" na techspec (seção 3) continuam passando sem edição.

**Arquivos:** `test/errors.test.ts`

### T-07 — Verificação completa: lint, typecheck, build e suíte

**Cobre:** RF-11

**Depende de:** T-06

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa.
- `pnpm vitest run` (suíte inteira) passa.
- `pnpm lint` passa (oxlint + oxfmt --check, com tsc).
- `pnpm typecheck` passa.
- `pnpm build` passa e, em seguida, `pnpm vitest run test/dist.test.ts` passa (R5 da PRD).
- `pnpm test` (lint + typecheck + coverage) passa antes de dar a entrega por pronta.
- Se algum comando falhar, a saída completa vai para o relatório de entrega. Não se declara a entrega pronta com falha.

**Arquivos:** nenhum arquivo de código. Esta tarefa só executa comandos.

### T-08 — Nota de changelog sobre a mudança de formato

**Cobre:** RF-01, RF-05

**Depende de:** T-07

**Aceite:**
- `CHANGELOG.md` recebe uma nota curta: erros passam a usar `application/problem+json` (RFC 9457); os campos existentes continuam no corpo; `body` com chaves `type`, `title`, `detail`, `instance` ou `status` é sobrescrito pelos membros RFC (R-02 da techspec).
- O formato das entradas do `CHANGELOG.md` é lido antes de escrever (a techspec não verificou o formato).
- Pendente de decisão do mantenedor: marcar a entrega como breaking change e a versão de release (pontos 1 e 2 do PRD, "Pontos a confirmar"; techspec, seção 7). A tarefa não altera `package.json`.

**Arquivos:** `CHANGELOG.md`
