# Tarefas — Problem details (RFC 9457) por utilitário explícito

Fontes: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-12).

Ordem sugerida: T-01 primeiro (testes vermelhos), depois T-02, T-03, T-04. T-05 e T-06 podem seguir após T-02. T-07 fecha a verificação.

---

### T-01 — Testes que descrevem o comportamento (vermelhos antes da implementação)

Criar `test/problem.test.ts` com `describeMatrix` (`test/_setup.ts:11`), um bloco de casos por requisito, nos modos `web` e `node`. Os casos cobrem: criação com `problem` (RF-01); `type` e `instance` no JSON (RF-02); status, `Content-Type` exato e cabeçalho `x-motivo` (RF-03); corpo exato sem `title` (RF-04); `body` que colide com membros padrão e `data` (RF-05); `unhandled` (RF-06); `HTTPError.status(404, ...)` com o formato atual (RF-07); `onError` que passa e que devolve `problem` (techspec, teste 8); `HEAD` sem corpo (techspec, teste 9); `problem({ message: "x" })` virando 500 (techspec, teste 10); e `headers: { "content-type": "text/plain" }` sem alterar o tipo de mídia (D-07). Basear o caso de RF-07 em `test/errors.test.ts:44`.

Antes de implementar, rodar o arquivo e confirmar que falha pelo motivo esperado (import de `problem` inexistente ou corpo diferente), e não por erro de sintaxe do teste.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/problem.test.ts` executa os dois modos (`web` e `node`), todos os casos falham antes de T-02 a T-04, e o arquivo não tem erro de tipo ou de sintaxe.

**Arquivos:** `test/problem.test.ts` (novo)

---

### T-02 — Utilitário `problem`, tipo `ProblemInput` e marca interna

Criar `src/utils/internal/problem.ts` com `kProblem` (`Symbol.for("h3.problem")`) e `interface ProblemMeta { type?; instance? }`, seguindo o padrão de `kHTTPResponse` (`src/response.ts:88-94`). Criar `src/utils/problem.ts` com `ProblemInput` (`Omit<ErrorInput, "statusCode" | "statusMessage">` mais `type?` e `instance?`) e `problem(input): HTTPError`, que cria `new HTTPError(input)` e grava a marca com `Object.defineProperty` (não enumerável). Tipo de retorno explícito por causa de `isolatedDeclarations` (D-04, D-02, D-03).

Não alterar `HTTPError`, `toJSON` nem `isError` (`src/error.ts`).

**Cobre:** RF-01, RF-02
**Depende de:** T-01
**Aceite:** `problem({ status: 404, message: "Conta não encontrada" })` retorna `HTTPError.isError(e) === true`, com `status` 404 e a mensagem correta; a marca não aparece em `Object.keys(err)` nem em `JSON.stringify` de quem captura o erro; `src/error.ts` continua idêntico ao original (`git diff` vazio nesse arquivo).

**Arquivos:** `src/utils/problem.ts` (novo), `src/utils/internal/problem.ts` (novo)

---

### T-03 — Serializador RFC 9457 `toProblemJSON`

Em `src/utils/internal/problem.ts`, implementar `toProblemJSON(error, meta)`, que devolve:

- `type`: `meta.type ?? "about:blank"`;
- `title`: `error.statusText` (omitido quando `undefined`);
- `status`: `error.status`;
- `detail`: `error.message`, ou `"HTTPError"` quando `unhandled`;
- `instance`: `meta.instance`, quando existir;
- extensões de `error.body` (vazio quando `unhandled`), descartando as chaves `type`, `title`, `status`, `detail` e `instance` mesmo quando o membro padrão não existe (D-05);
- `data` com `error.data`, somente quando `error.data !== undefined` e o erro não é `unhandled`; sem `data` definido, `body.data` continua como extensão (D-06, D-08).

Tipo de retorno explícito.

**Cobre:** RF-04, RF-05, RF-06
**Depende de:** T-02
**Aceite:** `problem({ status: 422, message: "Campo 'nome' inválido" })` gera exatamente `{ "type": "about:blank", "status": 422, "detail": "Campo 'nome' inválido" }`; com `body: { saldo: 10, status: "x", instance: "z" }` e `data: { campo: "valor" }`, o JSON tem `saldo: 10`, `data`, `status: 422` e não tem `instance` do body; com `unhandled: true`, não aparecem `message`, `data` nem `body`, e `detail` é `"HTTPError"`. Testes de T-01 para RF-04, RF-05 e RF-06 passam.

**Arquivos:** `src/utils/internal/problem.ts`

---

### T-04 — Integração em `errorResponse` (formato, cabeçalhos e `Content-Type`)

Em `src/response.ts`, importar `kProblem`, `ProblemMeta` e `toProblemJSON` (`src/response.ts:8`). Adicionar `problemHeaders` com `content-type: application/problem+json` ao lado de `jsonHeaders` (`src/response.ts:270-272`). Em `errorResponse` (`src/response.ts:358-380`), ler a marca; se existir, usar `toProblemJSON` no lugar de `error.toJSON()`, mesclar `error.headers` e `errHeaders` sobre `problemHeaders`, e reatribuir `content-type` com `headers.set` ao final, para que nem `headers` nem `event.res.errHeaders` mudem o tipo de mídia (D-01, D-07). Manter `stack` em modo debug (D-10). Erros sem marca continuam pelo caminho atual, sem nenhuma mudança de comportamento.

**Cobre:** RF-03, RF-07, RF-08
**Depende de:** T-03
**Aceite:** `problem({ status: 403, message: "Acesso negado", headers: { "x-motivo": "escopo" } })` responde 403, `Content-Type: application/problem+json` e `x-motivo: escopo`; `headers: { "content-type": "text/plain" }` não altera o tipo; `HTTPError.status(404, "Not Found", ...)` mantém `application/json;charset=UTF-8` e o JSON atual; o `HEAD` não tem corpo e mantém o `Content-Type`; o erro de `problem` devolvido por `onError` sai no formato RFC; todos os casos de T-01 passam nos modos `web` e `node`.

**Arquivos:** `src/response.ts`

---

### T-05 — Exportação pública e snapshot de exports

Em `src/index.ts`, na seção `// Error` (perto da linha 72), adicionar `export { problem, type ProblemInput } from "./utils/problem.ts";`. Os entries de `src/_entries/*.ts` já fazem `export * from "../index.ts"`, então não precisam de mudança. Em `test/unit/package.test.ts`, adicionar `"problem",` antes de `"proxy",` (perto da linha 105), em ordem alfabética. Esse é o único ajuste em teste existente, e só acrescenta a linha (D-12, RF-09). Não alterar `src/_deprecated.ts`.

**Cobre:** RF-01, RF-02, RF-09
**Depende de:** T-02
**Aceite:** `import { problem } from "h3"` funciona nos entries `generic` e `node`; `pnpm vitest run test/unit/package.test.ts` passa com o snapshot atualizado, sem outra alteração no teste.

**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-06 — Testes de tipo de `ProblemInput`

Em `test/unit/types.test-d.ts`, adicionar `expectTypeOf<ProblemInput>().toHaveProperty("type")` e `expectTypeOf<ProblemInput>().toHaveProperty("instance")`, e um `// @ts-expect-error` para passar `statusCode` em `problem({...})` (D-04).

**Cobre:** RF-02
**Depende de:** T-05
**Aceite:** `pnpm typecheck` passa, e a linha com `@ts-expect-error` de fato gera erro de tipo (sem a diretiva, o tsc reclamaria).

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-07 — Verificação final do repositório

Rodar a suíte completa e as checagens de qualidade. Confirmar que nenhum teste existente foi removido e que `test/errors.test.ts` não foi alterado. Confirmar que `src/error.ts`, `src/utils/middleware.ts`, `src/utils/json-rpc.ts` e `src/_deprecated.ts` não foram alterados.

**Cobre:** RF-08, RF-09
**Depende de:** T-04, T-05, T-06
**Aceite:** `pnpm vitest run` passa sem falhas; `pnpm lint` passa (`oxlint . && oxfmt --check .`); `pnpm typecheck` passa (é um script separado, não incluído em `pnpm lint`, ver `package.json:54`); `git diff --stat` mostra só os arquivos listados nas tarefas.

**Arquivos:** nenhum arquivo novo; verificação sobre todos os arquivos das tarefas anteriores.

---

## Fora das tarefas

- Documentação em `docs/1.guide/1.basics/6.error.md` (opcional na techspec, recomendada em PR separado).
- `CHANGELOG.md`, gerado pelo `changelogen` no release (D-11).
- JSON-RPC, `h3/rules`, Nitro e negociação por `Accept` (PRD, fora de escopo).
