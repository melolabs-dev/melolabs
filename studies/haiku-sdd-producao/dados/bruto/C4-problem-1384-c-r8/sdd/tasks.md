# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

- Origem: `sdd/prd.md` e `sdd/techspec.md`
- Data: 2026-11-07
- Escopo: pacote `h3` (v2)

Ordem sugerida: T-01 e T-02 primeiro (testes que falham), depois T-03 a T-06 (implementação), e por fim T-07 (verificação). T-08 é opcional.

---

### T-01 — Testes de comportamento de `problem()` (falhando antes da implementação)

Escrever `test/problem.test.ts` com `describeMatrix` (web e node), usando `ctx.app` e `ctx.fetch`, cobrindo os cenários da tabela da techspec (seção "Testes de comportamento"). Incluir: erro lançado e erro retornado pelo handler; `Content-Type` exato; `type: "about:blank"`, `title` de 422 e ausência de `instance` e `detail` sem `message`; `data` espalhado no topo com `detail` vencendo em conflito; `data` não-objeto (array) em `data`; `body` espalhado; `headers` aplicados e `Content-Type` do usuário sobrescrito; `unhandled` sem `detail`, `data`, `body` e stack fora de debug, com corpo comparado por `toEqual`; `unhandled` em debug com `stack` presente; `onError` chamado uma vez; `event.res.errHeaders` mesclado; `HEAD` sem corpo.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` executa e falha antes de qualquer mudança em `src/` (o import de `problem` deve falhar ou os asserts de formato devem falhar). Após T-05, todos os casos passam nas duas variantes da matriz (web e node). Nenhum teste existente é alterado.
Arquivos: `test/problem.test.ts`

---

### T-02 — Teste de tipos de `ProblemInput` e do retorno de `problem()`

Adicionar a `test/unit/types.test-d.ts` as verificações da techspec: `expectTypeOf(problem({ status: 400, type: "https://x", instance: "/a" })).toHaveProperty("type")`; `expectTypeOf<ProblemInput>().toExtend<ErrorInput>()`; e `// @ts-expect-error` para `problem({ status: 400, type: 1 })`.

Cobre: RF-02
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/types.test-d.ts` passa após T-04. Antes de T-04 falha (import inexistente). Não há `@ts-expect-error` sem erro real.
Arquivos: `test/unit/types.test-d.ts`

---

### T-03 — Módulo interno: marca `kProblem`, `toProblemJSON()` e tabela de títulos

Criar `src/utils/internal/problem.ts` com:
- `kProblem` (`Symbol.for("h3.problem")`, tipo `unique symbol`, com `/* @__PURE__ */`);
- `PROBLEM_TITLES`, tabela interna com textos de RFC 9110 para 4xx e 5xx, mais 2xx e 3xx em uso comum (D-06);
- `toProblemJSON(error: HTTPError): Record<string, unknown>` com anotação explícita de retorno (`isolatedDeclarations`), seguindo D-05 a D-08: caso normal `{ ...dataMembers, ...body, type ?? "about:blank", title, status, detail, instance }` com membros padrão por último; `title = error.statusText ?? PROBLEM_TITLES[error.status]`, ausente se não houver; `detail` vindo de `marca.detail` e ausente quando `undefined`; `data` espalhado só se for objeto simples, senão fica em `data`; caso `unhandled` retorna só `type`, `title` e `status`.

Não exportar nada disso por `src/index.ts`. Se for mais fácil cobrir por unitário, opcionalmente criar `test/unit/problem.test.ts` (precedência de membros, `title` ausente para status fora da tabela, `unhandled`).

Cobre: RF-04, RF-05, RF-07
Depende de: nenhuma
Aceite: `toProblemJSON` produz, para `problem({ status: 422 })`, `{ type: "about:blank", title: "<texto de 422>", status: 422 }` sem `instance` nem `detail`; `data: { detail: "x" }` não altera `detail`; `unhandled` não contém `detail`, `data`, `body` nem `stack`. Arquivo com menos de 200 LoC. `pnpm lint` passa para o arquivo.
Arquivos: `src/utils/internal/problem.ts`, `test/unit/problem.test.ts` (opcional)

---

### T-04 — Utilitário público `problem()`, tipo `ProblemInput` e exportação

Criar `src/utils/problem.ts` com a interface `ProblemInput extends ErrorInput` (campos opcionais `type` e `instance`, com comentários de RFC 9457 §3.1.1 e §3.1.5) e a função `problem(input: ProblemInput): HTTPError & Pick<ProblemInput, "type" | "instance">`, com anotação explícita de retorno. O corpo desestrutura `{ type, instance, ...errorInput }`, cria `new HTTPError(errorInput)` e aplica `Object.assign(error, { type, instance, [kProblem]: { detail: input.message } })`.

Em `src/index.ts`, exportar `problem` e `type ProblemInput` perto da linha que exporta `HTTPError` (`src/index.ts:72`), numa única linha. Não exportar `kProblem`, `toProblemJSON` nem a tabela.

Cobre: RF-01, RF-02
Depende de: T-03
Aceite: `import { problem } from "h3"` funciona nos entries (`src/_entries/generic.ts` re-exporta `index.ts`); `problem({ status: 404, message: "..." })` retorna `HTTPError` com `status` 404 (`HTTPError.isError` verdadeiro); `pnpm typecheck` passa; `pnpm vitest run test/unit/types.test-d.ts` passa.
Arquivos: `src/utils/problem.ts`, `src/index.ts`

---

### T-05 — Ramificação em `errorResponse` para erros marcados

Em `src/response.ts`, dentro de `errorResponse` (por volta de `src/response.ts:358`), calcular `isProblem = (error as any)[kProblem] !== undefined` e, quando verdadeiro, usar `toProblemJSON(error)` no lugar de `error.toJSON()` e fixar `headers.set("content-type", "application/problem+json")` depois de todas as mesclagens (`error.headers` e `errHeaders`). Manter o `stack` no modo debug como hoje. Quando `isProblem` for falso, o código deve executar exatamente as mesmas operações de antes. Não alterar `HTTPError.prototype.toJSON`, `onError` nem `prepareResponse`. A mudança em `src/response.ts` deve ser mínima (cerca de 10 linhas).

Cobre: RF-03, RF-04, RF-06, RF-07, RF-08
Depende de: T-03, T-04
Aceite: `pnpm vitest run test/problem.test.ts` passa nas duas variantes da matriz; `pnpm vitest run test/errors.test.ts` passa sem alteração no arquivo; a resposta de `problem({ status: 401, headers: { "WWW-Authenticate": "Bearer" } })` traz o header e `Content-Type: application/problem+json`; `content-type` do usuário é sobrescrito; `HEAD` não tem corpo.
Arquivos: `src/response.ts`

---

### T-06 — Atualizar o snapshot de exports

Atualizar `test/unit/package.test.ts` (linhas 4-6) para incluir `problem` na lista de exports. Nenhum outro item do snapshot deve mudar. Esse é o único ajuste permitido em teste existente.

Cobre: RF-01
Depende de: T-04
Aceite: `pnpm vitest run test/unit/package.test.ts` passa; o diff do snapshot contém apenas a inclusão de `problem`.
Arquivos: `test/unit/package.test.ts`

---

### T-07 — Verificação de regressão e de qualidade

Confirmar que `test/errors.test.ts` não foi alterado (`git diff --stat` não o lista) e que a suíte existente passa sem ajustes em testes de comportamento. Rodar os comandos de verificação da techspec: testes novos, `test/errors.test.ts`, snapshot, tipos, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` completo. Se algo falhar, registrar a saída e corrigir a causa na implementação, nunca enfraquecendo o teste de RF-08.

Cobre: RF-08
Depende de: T-02, T-05, T-06
Aceite: todos os comandos passam; `pnpm lint` e `pnpm typecheck` passam sem erros. Nenhum arquivo de `test/errors.test.ts` aparece no diff. A saída dos comandos é reportada ao final.
Arquivos: `test/errors.test.ts` (somente leitura, deve permanecer sem diff), `test/problem.test.ts`, `test/unit/types.test-d.ts`, `test/unit/package.test.ts`

---

### T-08 — Documentação curta de `problem()` (opcional)

Acrescentar em `docs/1.guide/1.basics/6.error.md` uma seção curta sobre `problem()`: quando usar, exemplo de `throw problem({ status: 403, message: "Acesso negado" })`, o formato da resposta, e as limitações documentadas (`Content-Type` do usuário é sobrescrito; `type` e `instance` não são validados como URI; erro reencapsulado em `new HTTPError({ cause })` perde o formato; adoção parcial é intencional).

Cobre: RF-01, RF-03
Depende de: T-05
Aceite: a seção aparece no arquivo, o exemplo corresponde ao comportamento verificado em `test/problem.test.ts`, e `pnpm lint` passa (formatação via `oxfmt`).
Arquivos: `docs/1.guide/1.basics/6.error.md`

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-04, T-06, T-08 |
| RF-02 | T-02, T-04 |
| RF-03 | T-01, T-05, T-08 |
| RF-04 | T-01, T-03, T-05 |
| RF-05 | T-01, T-03 |
| RF-06 | T-01, T-05 |
| RF-07 | T-01, T-03, T-05 |
| RF-08 | T-05, T-07 |

## Fora de escopo (não gera tarefas)

Conforme o PRD: sem mudança no formato padrão de `HTTPError`, sem opção global, sem catálogo de `type`, sem `problem+xml` nem negociação via `Accept`, sem i18n, sem mudanças em `h3/nitro` ou outros pacotes, e sem benchmarks.
