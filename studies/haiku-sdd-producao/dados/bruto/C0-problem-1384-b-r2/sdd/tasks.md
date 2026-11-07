# Tarefas — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` e `sdd/techspec.md`. Nenhuma tarefa cria export público novo nem altera `src/index.ts`, `src/rules/*`, `src/tracing.ts` ou adaptadores.

Ordem sugerida (fluxo do AGENTS.md: testes novos primeiro, confirmar falha, depois implementar): T-01 → T-02 → T-03 → T-04 → T-05 → T-06 → T-07.

### T-01 — Escrever os testes novos de Problem Details (e confirmar que falham)

Criar `test/problem-details.test.ts` com `describeMatrix` (modos `web` e `node`), ao menos um teste por requisito:
- RF-01: `new HTTPError({ status: 404 })`, `kNotFound` (rota inexistente) e erro em handler assíncrono → `content-type` começa com `application/problem+json`.
- RF-02: `new HTTPError("Sem permissão", { status: 403 })` → `type: "about:blank"`, `title: "Forbidden"`, `status: 403`, `detail`; `statusText` customizado vira `title`; status sem frase → sem `title`.
- RF-03: `error.type`/`error.instance` (inclusive `undefined` e via `HTTPError.status(409, undefined, { type, instance })`) e presença no corpo; `instance` ausente não aparece no JSON.
- RF-04: `throw new Error("segredo interno")` sem `debug` → sem "segredo interno", `data` ou `stack`; `HTTPError` com `unhandled: true`, `type` e `instance` → `type: "about:blank"` e sem `instance`; `unhandled` atribuído depois da construção também não vaza.
- RF-05: `data` + `body: { codigo: "E42", status: 200, title: "x" }` → `data` aninhado, `codigo` na raiz, `message === detail`, `status` 422, `title` não sobrescrito.
- RF-06: `www-authenticate` preservado, status 401, `debug: true` → corpo indentado com `stack`; `content-type` explícito no erro prevalece; merge com `errHeaders`/`onError`; HEAD com corpo vazio e `content-type` problem+json.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Arquivos:** `test/problem-details.test.ts`
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/problem-details.test.ts` executa e os testes novos **falham** antes das mudanças em `src/` (registrar a falha observada).

### T-02 — Criar o mapa interno de frases de status

Criar `src/utils/internal/status-text.ts` exportando `statusPhrase(status: number): string | undefined`, com as frases RFC 9110 dos códigos 400–599 (sem frase para códigos fora do padrão, como 499). Não exportar em `src/index.ts` e não alterar o `STATUS_TEXT` de `src/utils/response.ts`.

**Cobre:** RF-02
**Arquivos:** `src/utils/internal/status-text.ts`
**Depende de:** nenhuma
**Aceite:** `pnpm typecheck` passa (anotação explícita por `isolatedDeclarations`); `statusPhrase(403) === "Forbidden"`, `statusPhrase(404) === "Not Found"`, `statusPhrase(500) === "Internal Server Error"` e `statusPhrase(499) === undefined`, confirmado por teste unitário rápido ou pelos testes de T-01.

### T-03 — Adicionar `type` e `instance` a `HTTPError`

Em `src/error.ts`: declarar `type?: string` e `instance?: string` (com JSDoc) em `ErrorBody`; adicionar `readonly type: string | undefined` e `readonly instance: string | undefined` à classe; no construtor, atribuir apenas a partir do próprio `details` (sem herdar de `cause`). `toJSON()` permanece inalterado.

**Cobre:** RF-03
**Arquivos:** `src/error.ts`
**Depende de:** nenhuma
**Aceite:** `pnpm typecheck` passa; `new HTTPError({ status: 409, type, instance })` e `HTTPError.status(409, undefined, { type, instance })` expõem os valores, e `undefined` quando omitidos; `JSON.stringify(error)` segue idêntico ao anterior; os testes RF-03 de T-01 passam na parte de leitura de propriedades.

### T-04 — Content-Type `application/problem+json` em `errorResponse`

Em `src/response.ts`: definir `problemHeaders` (`FrozenHeaders` com `application/problem+json;charset=UTF-8`) logo abaixo de `jsonHeaders`, sem alterar `jsonHeaders` (usado em respostas de sucesso). Em `errorResponse`, usar `problemHeaders` no lugar de `jsonHeaders`, mantendo o merge via `mergeHeaders` (`content-type` explícito em `error.headers`/`errHeaders` continua prevalecendo).

**Cobre:** RF-01, RF-06
**Arquivos:** `src/response.ts`
**Depende de:** nenhuma
**Aceite:** testes RF-01 de T-01 passam; respostas de sucesso JSON continuam com `application/json;charset=UTF-8`; `content-type` explícito no erro prevalece; HEAD preserva o `content-type` com corpo vazio.

### T-05 — Montar o corpo Problem Details em `problemBody`

Em `src/response.ts`, criar a função interna (não exportada) `problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>` e usá-la em `errorResponse` no lugar de `error.toJSON()`. Importar `statusPhrase` com extensão `.ts`. Seguir D-04/D-06 do techspec:
- extensões de `body` primeiro; depois `type` (`"about:blank"` por padrão e sempre para `unhandled`), `title` (`error.statusText ?? statusPhrase(status)`, omitido se não houver), `status`, `detail`, `instance` (omitido se ausente ou `unhandled`), `message` (igual a `detail`), `data` (oculto se `unhandled`) e `stack` (apenas em `debug`), de modo que nada disso seja sobrescrito por `body`;
- `detail`/`message` = `unhandled ? "HTTPError" : error.message`;
- `unhandled` decidido em tempo de renderização (cobre atribuição tardia em `src/response.ts` e `src/utils/middleware.ts`);
- `statusText` e `unhandled` deixam de ser membros do corpo; a status line continua vinda de `error.statusText`; em `debug` o corpo mantém indentação 2 e `stack`.

**Cobre:** RF-02, RF-04, RF-05, RF-06
**Arquivos:** `src/response.ts`
**Depende de:** T-02, T-03, T-04
**Aceite:** todos os testes de `test/problem-details.test.ts` passam nos modos `web` e `node`; o corpo de `new HTTPError("Sem permissão", { status: 403 })` é exatamente `{"type":"about:blank","title":"Forbidden","status":403,"detail":"Sem permissão","message":"Sem permissão"}`; `throw new Error("segredo interno")` não vaza mensagem, `data`, `body` nem `stack` sem `debug`.

### T-06 — Ajustar os testes existentes ao novo formato

Em `test/errors.test.ts` (linhas de referência do techspec: 44, 53-57, 79-85, 99-104, 140, 144-150, 257, 309, 350, 384, 420, 442): trocar `application/json` por `application/problem+json` (mantendo o sufixo de charset onde existe); trocar `statusText` do corpo por `title` (a checagem de `res.statusText` permanece); remover `unhandled: true` do corpo e verificar `status: 500` + ausência de vazamento; manter `message: "HTTPError"` na linha 350. Rodar a suíte completa e corrigir quaisquer outros asserts de corpo/`content-type` de erro, começando por `test/status.test.ts`, `test/middleware.test.ts`, `test/mount.test.ts`, `test/handler.test.ts`, `test/route.test.ts`, `test/validate.test.ts` e `test/proxy.test.ts`. Não alterar asserts de `application/json` de respostas de sucesso (`security.test.ts`, `proxy.test.ts`, `body.test.ts`).

**Cobre:** RF-07
**Arquivos:** `test/errors.test.ts`, `test/status.test.ts`, `test/middleware.test.ts`, `test/mount.test.ts`, `test/handler.test.ts`, `test/route.test.ts`, `test/validate.test.ts`, `test/proxy.test.ts`
**Depende de:** T-05
**Aceite:** `pnpm vitest run` termina sem falhas; nenhum teste foi removido nem enfraquecido (cada assert alterado continua verificando o mesmo comportamento).

### T-07 — Verificação final de qualidade

Rodar `pnpm vitest run`, `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck`; corrigir formatação com `pnpm fmt` se necessário. Conferir que `src/index.ts` não mudou, que não há novo export público além de `type`/`instance` em `HTTPError` e que não há opção nova em `H3Config`. Registrar a mudança como breaking (formato do corpo e `content-type` de erro) nas notas de versão/PR e sinalizar o ponto aberto `detail: "HTTPError"` em 500 para decisão do responsável.

**Cobre:** RF-07
**Arquivos:** `src/index.ts` (somente conferência, sem alteração)
**Depende de:** T-06
**Aceite:** os três comandos terminam com sucesso; `git diff --stat` mostra alterações apenas em `src/error.ts`, `src/response.ts`, `src/utils/internal/status-text.ts` e `test/*`; há ao menos um teste novo por RF-01 a RF-06 nos modos `web` e `node`.
