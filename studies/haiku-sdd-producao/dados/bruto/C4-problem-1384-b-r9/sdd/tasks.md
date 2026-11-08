# Tarefas de implementação — Erros em formato problem details (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09).

Ordem segue o Bug Fix Workflow do AGENTS.md: primeiro os testes, vendo-os falhar, depois a implementação. Os caminhos são relativos a `C:\dev\runs\r9d57487ea4`.

---

### T-01 — Tabela de frases padrão de status

**Cobre:** RF-02

**Depende de:** nenhuma

Criar `src/utils/internal/status.ts` com a tabela de frases registradas no RFC 9110 para os códigos de erro e a função `getStatusPhrase(status)`, que devolve `undefined` quando o código não tem frase. O módulo não é exportado por `src/index.ts`. `STATUS_TEXT` em `src/utils/response.ts` não muda (D-05).

**Aceite:**
- `getStatusPhrase(404)` devolve `"Not Found"` e `getStatusPhrase(500)` devolve `"Internal Server Error"`.
- `getStatusPhrase(599)` devolve `undefined`.
- `pnpm typecheck` passa.
- `src/index.ts` não mudou.

**Arquivos:** `src/utils/internal/status.ts` (novo)

---

### T-02 — Testes novos de RF-01 a RF-07 e ajuste dos content-types existentes

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09

**Depende de:** nenhuma

Em `test/errors.test.ts`, dentro de `describeMatrix` (web e node), escrever um caso por requisito, usando `t.app`, `t.fetch` e `t.errors`, e limpar `t.errors = []` quando o teste gera erro não tratado:

1. RF-01: `new HTTPError({ status: 404 })` → status 404 e `content-type` `application/problem+json`. Incluir HEAD (cabeçalho presente, corpo vazio).
2. RF-02: `new HTTPError("Usuário não encontrado", { status: 404, statusText: "Not Found" })` → `type` `"about:blank"`, `title` `"Not Found"`, `status` 404, `detail` `"Usuário não encontrado"`.
3. RF-02, frase padrão: `new HTTPError({ status: 404 })` → `title` `"Not Found"`. Status 599 → chave `title` ausente.
4. RF-03: `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })` → propriedades da instância e JSON com os mesmos valores. Sem `instance`, a chave não aparece. `type` e `instance` não são herdados de `cause`.
5. RF-04: `{ status: 400, message: "inválido", data: { campo: "email" }, body: { codigo: "E01" } }` → `message`, `data` e `codigo` presentes, além dos membros RFC.
6. D-03: `body: { status: 999, type: "x", detail: "y" }` → `status` continua 400 e `type` `"about:blank"`.
7. RF-05 (regressão): `throw new Error("segredo do banco")` na rota → corpo sem essa string, `detail` e `message` valendo `"HTTPError"`, `data` ausente. Este teste deve passar já no código atual, antes de qualquer mudança, para servir de comparação.
8. RF-06: `throw new TypeError("x is undefined")` → status 500, `content-type` problem+json, corpo sem `"x is undefined"`.
9. RF-07: `headers: { "Retry-After": "120" }` → header presente e `content-type` problem+json. Também `headers: { "content-type": "text/plain" }` → o valor do usuário vence (D-04).

Ajustes nos testes existentes, só nos pontos que a mudança altera:
- `test/errors.test.ts:44`: `application/json;charset=UTF-8` → `application/problem+json`.
- `test/errors.test.ts:140`: `toMatch("application/json")` → `toMatch("application/problem+json")`.

**Aceite:**
- Antes de T-03 a T-05, os casos 1 a 6, 8 e 9 falham pelo motivo esperado (formato antigo), e o caso 7 passa.
- Depois de T-05, `pnpm vitest run test/errors.test.ts` passa nos dois modos.

**Arquivos:** `test/errors.test.ts`

---

### T-03 — Campos `type` e `instance` em `HTTPError`

**Cobre:** RF-03, RF-08

**Depende de:** T-02

Em `src/error.ts`:
- Adicionar `type?: string` e `instance?: string` em `ErrorInput`, com comentário de RFC 9457 e o padrão `"about:blank"` no corpo (ver techspec, seção Contratos).
- Declarar `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`, com anotação explícita (exigência de `isolatedDeclarations`).
- Ler os dois campos só de `details` no construtor, sem herança de `cause` (D-06).

Não alterar `src/index.ts`. Os únicos acréscimos públicos são as duas propriedades e os campos de entrada (RF-08).

**Aceite:**
- `new HTTPError({ status: 403, type: "...", instance: "/pedidos/42" })` expõe `err.type` e `err.instance` com esses valores.
- Sem `cause` com `type` ou `instance`, a propriedade herdada não aparece na instância.
- `pnpm vitest run test/unit/package.test.ts` passa, com o snapshot de exports igual ao anterior.
- `pnpm typecheck` passa.

**Arquivos:** `src/error.ts`

---

### T-04 — `toJSON()` com os membros RFC 9457

**Cobre:** RF-02, RF-04, RF-05, RF-06

**Depende de:** T-01, T-03

Em `HTTPError.toJSON()` (`src/error.ts`), montar o corpo na ordem de D-03:
- Primeiro os campos legados: `statusText`, `unhandled`, `message`, `data` e, quando não é `unhandled`, o espalhamento de `this.body`.
- Por último os membros RFC: `type` (padrão `"about:blank"`), `title` (`statusText`, ou `getStatusPhrase(status)` quando ausente), `status`, `detail` (igual a `message`, ou `"HTTPError"` quando `unhandled`) e `instance` (ausente quando `undefined`).
- Para `unhandled: true`, `title` usa a frase padrão, porque `statusText` é indefinido (D-07).
- Anotar o tipo de retorno de `toJSON()` explicitamente.

**Aceite:**
- Os casos 2 a 7 de T-02 passam.
- `body` com `status`, `type`, `title`, `detail` ou `instance` não sobrescreve os membros RFC (D-03).
- Nenhum caso do corpo contém `cause.message` nem a pilha (RF-05).
- `pnpm typecheck` passa.

**Arquivos:** `src/error.ts`, `src/utils/internal/status.ts` (consumido)

---

### T-05 — `errorResponse()` com `application/problem+json`

**Cobre:** RF-01, RF-06, RF-07

**Depende de:** T-04

Em `src/response.ts`:
- Criar `problemHeaders` com `content-type: application/problem+json` logo depois de `class FrozenHeaders`.
- Usar `problemHeaders` no lugar de `jsonHeaders` dentro de `errorResponse()` (`src/response.ts:358`), mantendo `mergeHeaders` para que `HTTPError.headers` e `errHeaders` do usuário vençam (D-04).
- `jsonHeaders` continua para respostas JSON comuns. `toError`, `prepareResponse` e `mergeHeaders` não mudam.

**Aceite:**
- Os casos 1, 6, 8 e 9 de T-02 passam, incluindo o caso de `content-type` do usuário.
- Erros não `HTTPError` (500) e `throw` de número também saem com `application/problem+json`.
- `pnpm vitest run test/errors.test.ts` passa nos dois modos.

**Arquivos:** `src/response.ts`

---

### T-06 — Verificação de regressão na suíte completa

**Cobre:** RF-08, RF-09

**Depende de:** T-05

Rodar a suíte e conferir os pontos de risco da techspec:
- `pnpm vitest run test/unit/package.test.ts` (snapshot de exports, RF-08).
- `pnpm vitest run` (suíte completa). Conferir `test/json-rpc.test.ts`, porque os `HTTPError` 403, 405 e 415 de `src/utils/json-rpc.ts` agora passam por `errorResponse` (techspec, Riscos 7). Conferir também `test/app.test.ts:198-205` e `test/body.test.ts:450-457`.
- Rodar `examples/errors.mjs` e conferir que o corpo continua coerente com `statusMessage`.
- Se algum teste fora de `errors.test.ts` quebrar por causa do novo `content-type`, ajustar só a asserção afetada, sem mudar o que o teste verifica.

**Aceite:**
- A suíte completa passa, ou cada falha restante está listada com a causa e a decisão tomada.
- Nenhum export novo em `src/index.ts`.

**Arquivos:** `test/json-rpc.test.ts`, `test/app.test.ts`, `test/body.test.ts`, `examples/errors.mjs` (somente leitura, salvo ajuste de asserção nos testes)

---

### T-07 — Documentação do novo formato

**Cobre:** RF-04, RF-07

**Depende de:** T-05

Em `docs/1.guide/1.basics/6.error.md`:
- Trocar o exemplo JSON de resposta (em torno das linhas 37-50) pelo corpo problem+json, com `type`, `title`, `status`, `detail` e os campos legados.
- Documentar `type` e `instance` como campos de `HTTPError`.
- Registrar a regra de `Content-Type` do usuário (D-04) e a exceção de `onError` que retorna objeto (D-08), perto da nota de `:90`.
- Marcar `message` como legado e `detail` como campo padrão (PRD, risco 3).

Não mexer em outras partes de `docs/` (PRD, fora de escopo).

**Aceite:**
- O exemplo do documento bate com o que `pnpm vitest run test/errors.test.ts` verifica.
- As notas de D-04 e D-08 aparecem no documento.

**Arquivos:** `docs/1.guide/1.basics/6.error.md`

---

### T-08 — Lint, typecheck e checagem final

**Cobre:** RF-09

**Depende de:** T-06, T-07

Rodar, nesta ordem:
- `pnpm vitest run test/errors.test.ts`
- `pnpm lint`
- `pnpm typecheck`

Conferir `git diff --stat`: as mudanças devem ficar só nos arquivos listados nas tarefas acima.

**Aceite:** os três comandos terminam sem falhas, e o diff não toca em nenhum arquivo fora das tarefas.

**Arquivos:** nenhum (somente verificação)

---

## Pendências fora do código

- **D-09 / PRD risco 2:** a mudança de `Content-Type` padrão pode exigir versão maior. A decisão é de quem aprova a release e precisa ser tomada antes de publicar. Não bloqueia T-01 a T-08.
- **Mapa de cobertura:** RF-01 (T-02, T-05), RF-02 (T-01, T-02, T-04), RF-03 (T-02, T-03), RF-04 (T-02, T-04, T-07), RF-05 (T-02, T-04), RF-06 (T-02, T-04, T-05), RF-07 (T-02, T-05, T-07), RF-08 (T-03, T-06), RF-09 (T-02, T-06, T-08).
