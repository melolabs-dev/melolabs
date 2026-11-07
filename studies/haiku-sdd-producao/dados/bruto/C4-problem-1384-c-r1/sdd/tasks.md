# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-08, §4 lista de arquivos, §5 estratégia de testes).

## Ordem e pontos a confirmar

Ordem sugerida: T-01 (testes, em vermelho) → T-02 → T-03 → T-04 → T-05 → T-06 → T-07 (opcional).

Três decisões da techspec ainda dependem de confirmação do usuário. As tarefas já assumem a recomendação da techspec, e ela pode mudar antes de T-04:

1. **D-03 (RF-05):** mascarar `detail`, `data` e `body` em erros `unhandled` sempre, e não só fora do modo debug.
2. **D-04:** membros RFC (`type`, `title`, `status`, `detail`, `instance`) sobrescrevem `body`, diferente de `HTTPError`.
3. **D-05:** `content-type: application/problem+json` vence também sobre `errHeaders`, não só sobre `headers`.

Observação: `sdd/pedido.md` (contrato #1384-C) é citado pelo PRD e pela techspec, mas não está no repositório. Os requisitos usados aqui são os do PRD.

---

### T-01 — Escrever os testes de `problem()` antes da implementação

Escrever `test/problem.test.ts` com `describeMatrix` (`test/_setup.ts:11`), rodando em `web` e `node`. Cobrir os casos das seções 5.1 a 5.10 da techspec: retorno `HTTPError` e `isError`, `type`/`instance` (com e sem valor), mapeamento `title`/`detail`/`status`/`data`, `content-type` e `retry-after`, `unhandled` com e sem `debug`, precedência de `body` (D-04), `content-type` em `headers` e em `errHeaders` (D-05), fluxo com handler `async` e síncrono, `onError` sem retorno, `HEAD` sem corpo. Incluir também o caso de tipo `problem({ status: 400, type: 1 })` deve falhar: usar `test/unit/types.test-d.ts` se existir, senão um `@ts-expect-error` no próprio arquivo de teste.

Os testes importam `problem` de `../src/index.ts` (ou do entry equivalente usado por `describeMatrix`). Como `problem` ainda não existe, o arquivo deve falhar na importação ou nos asserts.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/problem.test.ts` roda e falha nos casos novos, nos alvos `web` e `node`. Os casos de compatibilidade (RF-06) passam ou são indicados como já cobertos por `test/errors.test.ts`. Registrar a saída do comando antes de seguir para T-02.
**Arquivos:** `test/problem.test.ts`, `test/unit/types.test-d.ts` (se existir)

---

### T-02 — Criar o módulo interno de serialização RFC 9457

Criar `src/utils/internal/problem.ts` com:
- `kProblem`, um `unique symbol` por `Symbol.for("h3.problem")`, seguindo o padrão de `src/event.ts:14-23`;
- `ProblemSlot` (`type?`, `instance?`);
- `toProblemJSON(error, slot)`, que monta o corpo na ordem da D-04: membros de extensão (`data` e `body`) primeiro, depois `type` (default `about:blank`), `title` (de `statusText`, ausente quando vazio), `status`, `detail` (de `message`) e `instance`. Se `error.unhandled`, omitir `detail`, `data` e `body`.

Comentário curto no código explicando a precedência e a máscara de `unhandled`. Não exportar nada deste arquivo pelo `src/index.ts`.

**Cobre:** RF-03, RF-05
**Depende de:** T-01
**Aceite:** os tipos compilam (`pnpm typecheck`). Um teste unitário local ou o próprio `test/problem.test.ts` cobre o formato do corpo (RF-03) e a máscara de `unhandled` (RF-05) depois de T-04.
**Arquivos:** `src/utils/internal/problem.ts`

---

### T-03 — Criar o utilitário público `problem()` e o tipo `ProblemInput`

Criar `src/utils/problem.ts` com:
- `export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT>` com `type?` e `instance?`, com JSDoc mínimo;
- `export function problem<DataT>(input): HTTPError<DataT>`, que separa `type` e `instance`, cria `new HTTPError(details)` e grava `{ type, instance }` no slot `kProblem`.

Não alterar `src/error.ts`. Se o arquivo ficar acima de 200 linhas, dividir (a techspec estima que fique abaixo).

**Cobre:** RF-01, RF-02
**Depende de:** T-02
**Aceite:** `problem({ status: 404, message: "Não encontrado" })` retorna `HTTPError` com `HTTPError.isError(...) === true`. `problem({ status: 400, type: 1 })` falha em `pnpm typecheck`. Os casos de RF-01 e RF-02 em `test/problem.test.ts` passam.
**Arquivos:** `src/utils/problem.ts`

---

### T-04 — Alterar `errorResponse` para renderizar o corpo e o `content-type` do problema

Em `src/response.ts:358-380`, alterar `errorResponse`:
- ler o slot com `(error as any)[kProblem]`;
- montar o corpo com `toProblemJSON` quando houver slot, senão `error.toJSON()`, mantendo `stack` apenas com `debug` (como hoje, `src/response.ts:369`);
- depois de mesclar `jsonHeaders`, `error.headers` e `errHeaders`, definir `content-type` como `application/problem+json` quando houver slot (D-05).

Não alterar `HTTPError`, `toJSON`, `prepareResponse`, `toResponse` nem `src/h3.ts`. Erros sem `problem()` devem continuar byte a byte iguais.

**Cobre:** RF-03, RF-04, RF-05, RF-06
**Depende de:** T-02, T-03
**Aceite:** `pnpm vitest run test/problem.test.ts test/errors.test.ts` passa nos alvos `web` e `node`. `test/errors.test.ts:44` continua verificando `application/json;charset=UTF-8` para erros comuns. O caso `unhandled` com `debug` ligado não expõe a mensagem nem `data`.
**Arquivos:** `src/response.ts`

---

### T-05 — Exportar `problem` e `ProblemInput` pelo entry principal

Em `src/index.ts`, no bloco `// Error` (linhas 70-72), acrescentar `export { problem, type ProblemInput } from "./utils/problem.ts";`. Atualizar o snapshot inline de exports em `test/unit/package.test.ts:104`, incluindo `"problem"` entre `"parseCookies"` e `"proxy"`. Esse é o único ajuste em teste existente, previsto na restrição do contrato.

**Cobre:** RF-01, RF-07
**Depende de:** T-03
**Aceite:** `pnpm vitest run test/unit/package.test.ts` passa com o snapshot atualizado. O diff mostra apenas a linha nova no snapshot. `import { problem } from "h3"` resolve nos alvos `web` e `node`.
**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-06 — Verificar o fluxo completo: `onError`, `HEAD`, handlers e compatibilidade

Confirmar com os testes do item 8 da techspec que `problem()` funciona em handler `async`, em handler síncrono, com `onError` que não retorna nada (o erro original continua sendo renderizado como problem), e em requisição `HEAD` (sem corpo). Se algum caso falhar, corrigir em `src/response.ts` ou `src/utils/internal/problem.ts`, sem tocar em `HTTPError`. Se `onError` que relança ou devolve outro valor for usado, documentar que a resposta volta ao formato padrão (risco 6 da techspec).

**Cobre:** RF-04, RF-05, RF-06
**Depende de:** T-04, T-05
**Aceite:** os casos de fluxo de `test/problem.test.ts` passam nos alvos `web` e `node`. `pnpm vitest run test/errors.test.ts` continua verde sem alteração de asserts.
**Arquivos:** `test/problem.test.ts`, `src/response.ts`, `src/utils/internal/problem.ts`

---

### T-07 — Verificação final: suíte, lint, tipos e build (e atualização opcional do AGENTS.md)

Executar, nesta ordem: `pnpm vitest run test/problem.test.ts test/errors.test.ts test/unit/package.test.ts`, `pnpm vitest run` (suíte completa), `pnpm lint`, `pnpm typecheck`, `pnpm build && pnpm vitest run test/dist.test.ts`. Verificar `test/dist.test.ts` antes de rodar, porque ele pode depender de lista de exports (risco 9). Se o projeto quiser, incluir `utils/problem.ts` e `utils/internal/problem.ts` na árvore de `AGENTS.md`.

Reportar a saída de cada comando. Se algum falhar, dizer qual e por quê; não marcar como concluído.

**Cobre:** RF-07 (e RF-01, pela árvore de arquivos do AGENTS.md, se atualizada)
**Depende de:** T-01, T-04, T-05, T-06
**Aceite:** todos os comandos terminam sem erro. Os testes de `problem()` passam em `web` e `node`. `pnpm lint` e `pnpm typecheck` passam.
**Arquivos:** `AGENTS.md` (opcional), `test/dist.test.ts` (somente leitura, salvo ajuste necessário)
