# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-06, §3 a §5).

Ordem geral: primeiro os testes (vermelho), depois a implementação (verde), depois a regressão e a verificação final, seguindo o fluxo de `AGENTS.md`.

Cobertura de requisitos:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-03 |
| RF-02 | T-01, T-02, T-03, T-05 |
| RF-03 | T-02, T-05, T-06, T-08 |
| RF-04 | T-02, T-05 |
| RF-05 | T-02, T-06 |
| RF-06 | T-02, T-05 |
| RF-07 | T-02, T-07 |
| RF-08 | T-01, T-04, T-10 |

---

### T-01 — Testes de tipo de `problem()` e `ProblemInput`

Escrever os testes de tipo antes da implementação. Seguir o padrão de `test/unit/types.test-d.ts` (`expectTypeOf`).

Casos:
- `problem({ status: 404, message: "x", campoInexistente: 1 })` falha com `@ts-expect-error`.
- `ProblemInput` aceita `type` e `instance` como `string`.
- `problem(...)` retorna `HTTPError`.
- `problem({ status: 409, message: "Conflito" })` compila sem `type` nem `instance`.

Cobre: RF-01, RF-02, RF-08
Depende de: nenhuma
Aceite: `pnpm typecheck` falha somente porque `problem` ainda não existe (erro de módulo ou de exportação ausente), não por erro de sintaxe no arquivo de teste.
Arquivos: `test/unit/problem.test-d.ts`

---

### T-02 — Testes de integração de problem details (vermelho)

Criar `test/problem.test.ts` com `describeMatrix`, rodando em `web` e `node`, seguindo `test/errors.test.ts`. Cada caso registra handlers em `t.app` e usa `t.fetch`.

Casos:
- Lança `problem({ status: 422, statusText: "Dados inválidos", message: "E-mail é obrigatório" })`: status 422, `Content-Type` `application/problem+json`, `title` e `detail` corretos.
- Devolve (não lança) um `problem()`: mesma resposta do caso anterior.
- `type` e `instance` informados aparecem no corpo.
- `type` ausente gera `"about:blank"`.
- `data` e `body` aparecem no nível esperado; as chaves de `body` ficam no topo.
- `body` com chaves `type` ou `status` não sobrescreve os membros RFC.
- `headers: { "Retry-After": "30" }` chega na resposta junto com `Content-Type`.
- `headers: { "Content-Type": "text/plain" }` não troca o `Content-Type` do problema.
- `event.res.errHeaders.set("content-type", ...)` não troca o `Content-Type` do problema.
- `unhandled: true` esconde `message`, `data` e `body` e mantém `status`; o corpo não tem a chave `unhandled` nem contém `"senha do banco vazou"` ou `"token"`.
- `debug: true` acrescenta `stack`.
- `onError` recebe o `HTTPError` com marca e pode devolver outra resposta.
- `HTTPError.status(404, "Not Found")` sem `problem()` mantém `application/json;charset=UTF-8` e o corpo de `toJSON()`, comparado chave a chave.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem.test.ts` roda e falha nos casos de `problem()` por ausência do módulo ou da exportação. O caso de `HTTPError` comum já passa, porque ainda não depende de `problem()`.
Arquivos: `test/problem.test.ts`

---

### T-03 — Implementar `problem()`, `ProblemInput` e a marca interna

Criar `src/utils/problem.ts` com:
- `interface ProblemInput extends ErrorInput`, com `type?` e `instance?` (D-06).
- `problem(input)`: separa `type` e `instance`, cria `new HTTPError(rest)` e define `kProblem` como propriedade não enumerável com `{ type, instance }` (D-02).
- `kProblem = Symbol.for("h3.problem")`, não exportado.
- `getProblemFields(error)`, que devolve os campos ou `undefined`. Não exportado.

Não alterar `src/error.ts` (D-01, RF-07).

Cobre: RF-01, RF-02, RF-08
Depende de: T-01, T-02
Aceite: `problem({ status: 404, message: "Usuário não encontrado" })` devolve `HTTPError` com `status` 404 e a mensagem. `pnpm typecheck` passa para o arquivo novo. `{ ...error }` e `JSON.stringify` não mostram `kProblem`.
Arquivos: `src/utils/problem.ts`

---

### T-04 — Exportar `problem` e `ProblemInput` pela API pública

Adicionar `export { problem, type ProblemInput } from "./utils/problem.ts";` em `src/index.ts`, em uma seção nova logo após a exportação de `HTTPError` (linha 72). Não exportar `kProblem`, `getProblemFields` nem `problemBody` (RF-08).

Cobre: RF-08
Depende de: T-03
Aceite: `import { problem, type ProblemInput } from "h3"` funciona nos testes. Uma verificação de exports mostra apenas esses dois nomes novos. `pnpm typecheck` passa.
Arquivos: `src/index.ts`

---

### T-05 — Corpo problem details em `errorResponse`

Implementar `problemBody(error, fields)` em `src/utils/problem.ts` e ramificar `errorResponse` em `src/response.ts` (`src/response.ts:358-380`) quando `getProblemFields` devolver valor.

Regras:
- `unhandled`: somente `type`, `title`, `status` e `instance` (sem `detail`, `data` nem `body`). Não incluir `unhandled` (D-05).
- Tratado: `...body` primeiro, depois `type` (padrão `"about:blank"`), `title` (`statusText`), `status`, `detail` (`message`), `instance` e `data`. Os membros RFC vencem (D-05).
- `title` e `instance` são omitidos quando `undefined`.
- Em modo `debug`, `stack` continua sendo acrescentada, como hoje.
- Erros sem marca seguem o caminho atual com `error.toJSON()`.

Cobre: RF-02, RF-03, RF-04, RF-06
Depende de: T-03, T-04
Aceite: os casos de `type`, `instance`, `data`, `body`, `unhandled` e `debug` em `test/problem.test.ts` passam nos modos `web` e `node`. O caso de `unhandled` não contém `"senha do banco vazou"` nem `"token"`.
Arquivos: `src/utils/problem.ts`, `src/response.ts`

---

### T-06 — Status, `Content-Type` fixo e cabeçalhos em `errorResponse`

Em `src/response.ts`, depois de montar `headers` a partir de `jsonHeaders`, `error.headers` e `errHeaders` (`src/response.ts:358-364`), chamar `headers.set("content-type", "application/problem+json")` (D-04). Assim `headers` e `errHeaders` não trocam o tipo. `status` e `statusText` continuam vindo do erro (`src/response.ts:373-376`).

Cobre: RF-03, RF-05
Depende de: T-05
Aceite: a resposta do caso de `422` tem `Content-Type` `application/problem+json`. O caso de `Retry-After: 30` passa. Os casos com `headers` e `errHeaders` trocando `Content-Type` continuam com `application/problem+json`.
Arquivos: `src/response.ts`

---

### T-07 — Regressão de `HTTPError` comum e de JSON-RPC

Confirmar que o caminho de `HTTPError` sem marca não mudou. Não alterar `test/errors.test.ts`, salvo se algum teste depender diretamente de detalhe interno. Se isso acontecer, ajustar só o que for necessário, sem perder a verificação (RF-07).

Rodar também `test/json-rpc.test.ts`, que usa `unhandled` (`src/utils/json-rpc.ts:484`).

Cobre: RF-07
Depende de: T-06
Aceite: `pnpm vitest run test/errors.test.ts test/json-rpc.test.ts` passa sem alteração de asserções. O caso de regressão de `HTTPError.status(404, "Not Found")` em `test/problem.test.ts` passa.
Arquivos: `test/problem.test.ts`, `test/errors.test.ts` (somente se necessário), `test/json-rpc.test.ts` (somente se necessário)

---

### T-08 — Caminhos de erro: devolvido, lançado e `onError`

Confirmar que a marca vale para erro devolvido e lançado, e que `onError` recebe o erro com marca. O fluxo de `src/response.ts:146-173` e `src/utils/middleware.ts:37-63` não deve mudar (techspec §3, "Detalhe por arquivo"). Se algum caso falhar por reencapsulamento, documentar no próprio teste e não corrigir nesta entrega (techspec §6).

Cobre: RF-03
Depende de: T-06
Aceite: os casos de "devolve (não lança)" e de `onError` em `test/problem.test.ts` passam nos modos `web` e `node`.
Arquivos: `test/problem.test.ts`

---

### T-09 — Documentar `problem()` no guia de erros (opcional)

Adicionar uma seção curta sobre `problem()` depois de `## HTTPError` em `docs/1.guide/1.basics/6.error.md`. Deve explicar que só as rotas que usam `problem()` mudam para `application/problem+json`, o que é a mudança de `Content-Type` para clientes (techspec §6).

Este item não é exigido pelo PRD. Está na lista de arquivos da techspec como "opcional para o PRD, recomendado para o usuário".

Cobre: nenhum requisito do PRD (item opcional)
Depende de: T-04
Aceite: `pnpm lint` passa. A seção descreve o `Content-Type` e cita `problem()` com um exemplo.
Arquivos: `docs/1.guide/1.basics/6.error.md`

---

### T-10 — Verificação final

Rodar a verificação completa, nesta ordem:
1. `pnpm vitest run test/problem.test.ts test/errors.test.ts`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm vitest run` (suíte completa)
5. `pnpm test` (lint, typecheck e cobertura)

Se algum comando falhar, registrar a saída e não encerrar a tarefa como concluída.

Cobre: RF-07, RF-08
Depende de: T-07, T-08, T-09
Aceite: os cinco comandos passam. `pnpm lint` e `pnpm typecheck` não têm erros fora dos arquivos novos ou alterados.
Arquivos: nenhum arquivo novo; apenas execução de comandos (inclui `sdd/tasks.md` como referência)
