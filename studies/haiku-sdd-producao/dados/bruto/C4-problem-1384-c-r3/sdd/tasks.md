# Tarefas de implementação — Problem details (RFC 9457) por utilitário explícito

Origem: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-09).

Ordem: primeiro os testes, que devem falhar antes da implementação (fluxo de correção do `AGENTS.md`); depois a implementação, a exportação e a verificação final.

Antes de T-06, confirmar as três pendências da techspec (Riscos 1 a 3): mapeamento de `title` e `detail`, `data` como membro próprio e omissão de `detail` em `unhandled`. As tarefas seguem o que a techspec descreve.

---

### T-01 — Testes unitários de `problem()` e da marca interna

**Cobre:** RF-01, RF-02
**Depende de:** nenhuma
**Aceite:** criar `test/unit/problem.test.ts` com os casos 13 a 15 da techspec: `problem({ status: 404, message: "Usuário não encontrado" })` é `instanceof HTTPError` com `status` e `message` corretos, e `HTTPError.isError` devolve `true`; `type` e `instance` não aparecem em `Object.keys` nem em `JSON.stringify`, mas a marca existe em `Object.getOwnPropertySymbols`; `new HTTPError({ cause: problem({ status: 404 }) })` não carrega a marca. Rodar `pnpm vitest run test/unit/problem.test.ts` e confirmar que falha, porque `src/problem.ts` ainda não existe.
**Arquivos:** `test/unit/problem.test.ts`

### T-02 — Testes de integração: forma da resposta e `Content-Type`

**Cobre:** RF-03, RF-04, RF-10
**Depende de:** nenhuma
**Aceite:** criar `test/problem.test.ts` com `describeMatrix` e os casos 1 a 4 da techspec: handler que lança `problem({ status: 403, statusText: "Forbidden", message: "Token expirado" })` responde 403, `content-type` igual a `application/problem+json` e corpo com `status`, `title` "Forbidden", `detail` "Token expirado" e `type` "about:blank"; o mesmo caso com `return` em vez de `throw`; `problem({ status: 500, message: "Falha" })` gera `type` "about:blank" e `title` "Internal Server Error"; `type` e `instance` informados aparecem no corpo. Rodar `pnpm vitest run test/problem.test.ts` e confirmar falha nos modos `web` e `node` antes da T-07.
**Arquivos:** `test/problem.test.ts`

### T-03 — Testes de integração: membros de extensão e detalhes ocultos

**Cobre:** RF-05, RF-07, RF-10
**Depende de:** T-02 (mesmo arquivo, `test/problem.test.ts`)
**Aceite:** acrescentar em `test/problem.test.ts` os casos 5 a 7 e 9 da techspec. Caso 5: `body: { campo: "email" }` aparece no topo do JSON. Caso 6: `body: { status: 999, type: "x", title: "y" }` não altera `status`, `type` nem `title`. Caso 7: `data: { a: 1 }` vai para a chave `data`, e `body: { data: "x" }` sem `data` mantém a chave `data` do corpo. Caso 9: com `debug: false`, `problem({ status: 500, message: "senha do banco: x", unhandled: true })` não envia "senha do banco: x"; o teste limpa `t.errors` e silencia `console.error` para não falhar no `afterEach` (`test/_setup.ts:153`). Os casos 5 a 7 e 9 falham antes da T-07.
**Arquivos:** `test/problem.test.ts`

### T-04 — Testes de compatibilidade: `HTTPError` atual, headers e `onError`

**Cobre:** RF-06, RF-09, RF-10
**Depende de:** T-02 (mesmo arquivo, `test/problem.test.ts`)
**Aceite:** acrescentar em `test/problem.test.ts` os casos 8, 10, 11 e 12 da techspec. Caso 8: `HTTPError.status(404, "Not Found")` mantém `application/json` e o corpo de `toJSON()`; este caso deve passar já antes da T-07, e continuar passando depois. Caso 10: `headers: { "x-erro": "1" }` é mantido, e `headers: { "content-type": "text/plain" }` sobrescreve, como hoje. Caso 11: HEAD com erro de problema não tem corpo e mantém o mesmo `content-type`. Caso 12: `onError` que retorna `undefined` ainda entrega o formato de problema. Os casos 10 a 12 falham antes da T-07 nos modos `web` e `node`.
**Arquivos:** `test/problem.test.ts`

### T-05 — Snapshot de exports: incluir apenas `problem`

**Cobre:** RF-08
**Depende de:** nenhuma
**Aceite:** em `test/unit/package.test.ts`, inserir `"problem",` entre `"parseCookies"` (linha 104) e `"proxy"` (linha 105). É a única alteração nesse arquivo. Rodar `pnpm vitest run test/unit/package.test.ts` e confirmar que falha antes da T-08, porque `problem` ainda não é exportado.
**Arquivos:** `test/unit/package.test.ts`

### T-06 — Implementar `src/problem.ts`

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-07
**Depende de:** T-01
**Aceite:** criar `src/problem.ts` com `ProblemInput` (estende `ErrorInput` com `type?` e `instance?`), `kProblem = Symbol.for("h3.problem")`, `ProblemMembers`, `problem()`, `toProblemJSON()` e `DEFAULT_TITLE`, conforme D-01 a D-07 e "Contratos e assinaturas" da techspec. `problem()` cria `new HTTPError(input)` sem mutar `input` e define `error[kProblem]` com `Object.defineProperty` (`enumerable`, `writable` e `configurable` como `false`). `DEFAULT_TITLE` cobre só as frases 4xx e 5xx do registro IANA (D-05). `toProblemJSON` omite `detail`, `data` e os membros de `body` quando `unhandled`, e coloca os membros padrão depois dos de extensão. O arquivo fica abaixo de 200 linhas. `kProblem`, `toProblemJSON`, `ProblemMembers` e `DEFAULT_TITLE` não são exportados por `src/index.ts`. Os testes da T-01 passam. Se a mitigação do Risco 4 for adotada, incluir em `test/unit/problem.test.ts` um teste que confere a tabela com os códigos de erro usados em `src/`.
**Arquivos:** `src/problem.ts`, `test/unit/problem.test.ts`

### T-07 — Ramo em `errorResponse` e base de headers de problema

**Cobre:** RF-03, RF-04, RF-05, RF-06, RF-07, RF-09
**Depende de:** T-02, T-03, T-04, T-06
**Aceite:** em `src/response.ts`, importar `kProblem` e `toProblemJSON` de `src/problem.ts`; criar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`) ao lado de `jsonHeaders` (`src/response.ts:270-272`); `errorResponse` (`src/response.ts:358-380`) escolhe o corpo e os headers pela marca, conforme o esboço da techspec. `HTTPError.toJSON()` e `src/error.ts` não mudam. Todos os casos de `test/problem.test.ts` passam nos modos `web` e `node`. `pnpm vitest run test/errors.test.ts` passa sem edição no arquivo.
**Arquivos:** `src/response.ts`

### T-08 — Exportar `problem` e `ProblemInput`

**Cobre:** RF-01, RF-02, RF-08
**Depende de:** T-05, T-06
**Aceite:** em `src/index.ts`, na seção `// Error` (linhas 70 a 72), exportar `problem` (valor) e `type ProblemInput`, e nada mais. `pnpm vitest run test/unit/package.test.ts` passa com o snapshot da T-05. Os demais símbolos da techspec continuam fora do pacote público.
**Arquivos:** `src/index.ts`

### T-09 — Tipos de `ProblemInput`

**Cobre:** RF-02
**Depende de:** T-08
**Aceite:** em `test/unit/types.test-d.ts`, acrescentar `expectTypeOf` que confirma que `ProblemInput` aceita `type` e `instance` como `string` opcionais, e que herda os campos de `ErrorInput`. `pnpm typecheck` passa. (Opcional na techspec; faz parte desta lista para cobrir RF-02 também na tipagem.)
**Arquivos:** `test/unit/types.test-d.ts`

### T-10 — Bundle de `dist` mantém `problem`

**Cobre:** RF-08, RF-10
**Depende de:** T-08
**Aceite:** rodar `pnpm build` e confirmar que `problem` está nos entries do bundle. Acrescentar um caso para `problem` em `test/dist.test.ts`, seguindo o padrão dos casos existentes (linhas 4 a 8). `pnpm vitest run test/dist.test.ts` passa depois de `pnpm build`.
**Arquivos:** `test/dist.test.ts`

### T-11 — Verificação final: suíte, lint e typecheck

**Cobre:** RF-09, RF-10, RF-11
**Depende de:** T-07, T-09, T-10
**Aceite:** `pnpm test` termina com código 0 (lint, typecheck e suíte com cobertura). `pnpm lint` e `pnpm typecheck` terminam com código 0. Conferir por `git diff` que os únicos testes alterados são `test/unit/package.test.ts` (uma linha), além dos arquivos novos. `test/errors.test.ts` não tem diff. Registrar qualquer falha com a saída do comando.
**Arquivos:** nenhum (apenas execução de comandos e conferência com `git diff`)
