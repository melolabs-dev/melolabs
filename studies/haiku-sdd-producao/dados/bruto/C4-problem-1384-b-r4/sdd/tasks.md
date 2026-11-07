# Tarefas — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-08, pendências 1 a 3).

Ordem segue o fluxo de correção de bug do `AGENTS.md`: primeiro os testes de guarda, depois os testes novos que falham, depois a implementação.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-05, T-06, T-07 |
| RF-02 | T-02, T-03, T-08 |
| RF-03 | T-02, T-04, T-05 |
| RF-04 | T-02, T-05 |
| RF-05 | T-01, T-02, T-05 |
| RF-06 | T-01, T-02, T-05 |
| RF-07 | T-02, T-05, T-06 |

---

### T-01 — Testes de guarda para erro não tratado e Set-Cookie

Criar `test/problem-details.test.ts` com os dois testes que já devem passar hoje, antes de qualquer alteração de código:

- Handler que lança `new Error("senha do banco vazada")` com `debug` desligado: a string não aparece no corpo nem nos headers, o status é `500`, e `t.errors = []` é definido depois do teste para evitar a falha de `test/_setup.ts:127-155`.
- `onError` que retorna `HTTPError` com `instance`, e `HTTPError` lançado com header `Set-Cookie`: a resposta tem exatamente um `Set-Cookie`.

Os testes usam `describeMatrix` (web e node).

**Cobre:** RF-05, RF-06
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/problem-details.test.ts` passa nos dois modos (web e node) sem nenhuma mudança em `src/`.
**Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Testes novos dos requisitos RF-01 a RF-07 (devem falhar antes da implementação)

Acrescentar em `test/problem-details.test.ts` (`describeMatrix`) e criar `test/unit/error.test.ts`:

- RF-01: `HTTPError({ status: 403, statusText: "Forbidden" })` gera status `403`, `Content-Type: application/problem+json`, e corpo com `status: 403`, `title: "Forbidden"`, `type: "about:blank"`.
- RF-02 (unitário): `new HTTPError({ status: 404, type, instance })` expõe `error.type` e `error.instance`; o corpo traz os dois valores.
- RF-02 (negativo): `type` e `instance` herdados de `cause` não aparecem no corpo.
- RF-03: `HTTPError({ status: 500 })` gera `type: "about:blank"` e `title: "Internal Server Error"`. Um código fora da tabela (599 ou 499) cai no fallback `"Error"`.
- RF-04: `HTTPError({ status: 400, message: "Campo inválido", data: { campo: "email" } })` gera `detail`, `message` e `data` com os valores do PRD.
- RF-05 (negativo): erro não tratado não expõe `type`, `instance`, `data` nem `stack` (sem debug); `detail` e `message` valem `"HTTPError"`.
- RF-06: `onError` que retorna `HTTPError({ status: 422, instance: "/pedidos/7" })` gera 422, `application/problem+json`, `instance` presente e exatamente um `Set-Cookie`.
- RF-07: rota inexistente gera 404, `application/problem+json`, e `detail` que contém `[GET]` e `/inexistente`. Por D-05 e pendência 1 da techspec, o teste não exige a sequência literal `[GET] /inexistente`, porque a mensagem atual usa a URL completa.
- D-07: `body: { foo: 1 }` do desenvolvedor aparece no corpo; `toJSON()` não produz `type` nem `title` sem pedido do desenvolvedor.
- D-06: `onError` que retorna objeto simples continua com `application/json;charset=UTF-8`.

Confirmar que os testes de RF-01 a RF-04 e RF-07 falham antes da implementação e que os de guarda (T-01) continuam passando.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** T-01
**Aceite:** `pnpm vitest run test/problem-details.test.ts test/unit/error.test.ts` falha apenas nos casos novos (RF-01 a RF-04, RF-07 e D-07), e os casos de guarda passam.
**Arquivos:** `test/problem-details.test.ts`, `test/unit/error.test.ts`

---

### T-03 — Campos `type` e `instance` em `HTTPError`

Em `src/error.ts`:

- Adicionar `type?` e `instance?` a `ErrorBody`, com JSDoc dizendo que são usados só quando informados diretamente e ignorados para erros não tratados.
- Declarar `readonly type` e `readonly instance` em `HTTPError` e ler os dois campos de `details` (não de `details.cause`) no construtor.
- Trocar o tipo de retorno de `toJSON()` para `Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"]`. O corpo de `toJSON()` não muda, para não afetar `src/utils/json-rpc.ts:479-490`.

**Cobre:** RF-02
**Depende de:** T-02
**Aceite:** os testes unitários de RF-02 em `test/unit/error.test.ts` passam; `pnpm typecheck` passa; `test/errors.test.ts` continua verde nesta etapa.
**Arquivos:** `src/error.ts`

---

### T-04 — Tabela de títulos padrão por status

Criar `src/utils/internal/status-text.ts` com `HTTP_STATUS_TEXT: Readonly<Record<number, string>>`, contendo as frases de razão da RFC 9110 para os códigos 4xx e 5xx e os demais códigos que o h3 usa. Não exportar pelo `src/index.ts`. Não reutilizar nem alterar `STATUS_TEXT` em `src/utils/response.ts` (D-03), para não mudar as frases de `redirect` e `noContent`.

**Cobre:** RF-03
**Depende de:** T-02
**Aceite:** `HTTP_STATUS_TEXT[500] === "Internal Server Error"`; `HTTP_STATUS_TEXT[599]` é `undefined`; `src/utils/response.ts` fica sem diff.
**Arquivos:** `src/utils/internal/status-text.ts`

---

### T-05 — Renderização de erro em problem details

Em `src/response.ts`:

- Criar `problemHeaders` (`new FrozenHeaders({ "content-type": "application/problem+json" })`) logo após `jsonHeaders`.
- Criar `toProblemBody(error)` no fim do arquivo, como helper interno, com a ordem de chaves de D-07: `type`, `title`, `status`, `detail`, `instance`, depois o conteúdo de `error.toJSON()`. `type` vem de `error.type` só se o erro não for não tratado, senão `"about:blank"`. `title` é `error.statusText || HTTP_STATUS_TEXT[status] || "Error"`. `detail` é `json.message`.
- Trocar o corpo de `errorResponse()` para `JSON.stringify({ ...toProblemBody(error), stack })`, com `stack` só quando `debug` estiver ativo, e usar `problemHeaders` mesclado com `error.headers` e `errHeaders`, como hoje.
- Garantir que `onError` que retorna `HTTPError` passa pelo mesmo ramo, e que valor não-erro segue em `application/json` (D-06).

Não alterar `HTTPError.toJSON()` em runtime, e não exportar nenhum nome novo.

**Cobre:** RF-01, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** T-03, T-04
**Aceite:** toda a suíte de `test/problem-details.test.ts` e `test/unit/error.test.ts` passa nos modos web e node; o caso de `Set-Cookie` continua com um único cookie; `src/index.ts` sem diff.
**Arquivos:** `src/response.ts`

---

### T-06 — Ajustar testes existentes ao novo Content-Type

Em `test/errors.test.ts`:

- Linha 44: trocar `"application/json;charset=UTF-8"` por `"application/problem+json"`.
- Linha 140: trocar `toMatch("application/json")` por `toMatch("application/problem+json")`.

Demais asserts desse arquivo (`status`, `statusText`, `data`, `message`, `unhandled`) não mudam. Rodar `test/router.test.ts` sem alterações e confirmar que a mensagem 404 continua igual (D-05).

**Cobre:** RF-01, RF-07
**Depende de:** T-05
**Aceite:** `pnpm vitest run test/errors.test.ts test/router.test.ts` passa; nenhum valor esperado de `message`, `statusText`, `data` ou `unhandled` foi alterado.
**Arquivos:** `test/errors.test.ts`, `test/router.test.ts` (somente leitura, sem mudança)

---

### T-07 — Verificação completa: lint, tipos, suíte e build

Rodar `pnpm lint`, `pnpm typecheck`, `pnpm test` (lint, typecheck e cobertura) e `pnpm build` antes de `test/dist.test.ts`. Confirmar que nenhum teste fora da lista checa `application/json` em erro (a busca da techspec encontrou só os dois casos de `test/errors.test.ts`). Checar também que `test/security.test.ts:556` continua verde, por ser resposta de sucesso.

Se algo falhar, reportar a saída do comando e corrigir a causa antes de fechar a tarefa.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** T-06
**Aceite:** `pnpm test` e `pnpm build` terminam sem erro; a cobertura não cai em relação a `master`.
**Arquivos:** nenhum arquivo do projeto alterado nesta tarefa (apenas execução de comandos)

---

### T-08 — Documentação e notas de release

- Registrar nas notas de release a mudança de `Content-Type` de erros de `application/json` para `application/problem+json`, com o aviso de que clientes que filtram por `application/json` deixam de reconhecer a resposta (P6, R1; pendência 2).
- Documentar em `AGENTS.md` os campos `type` e `instance` de `HTTPError` e a precedência de `body` sobre `type` e `title` (D-07, R5, R9; pendência 3). Só atualizar a seção de convenções de erro, sem reescrever o restante.
- Antes de fechar, confirmar com o autor do pedido a leitura do critério RF-07 (pendência 1 da techspec).

**Cobre:** RF-01, RF-02
**Depende de:** T-07
**Aceite:** notas de release contêm a mudança de `Content-Type` e o aviso de quebra; `AGENTS.md` descreve `type`, `instance` e a precedência de `body`; `pnpm lint` passa após a edição.
**Arquivos:** `AGENTS.md`, arquivo de notas de release do time (local a confirmar)
