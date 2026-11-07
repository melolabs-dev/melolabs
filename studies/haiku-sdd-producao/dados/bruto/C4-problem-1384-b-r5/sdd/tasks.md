# Tarefas de implementação — Respostas de erro em problem details (RFC 9457)

Origem: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-10).

Ordem sugerida: T-01 e T-02 e T-03 podem começar em paralelo. T-01 vem primeiro no fluxo de bug fix do `AGENTS.md`: os testes precisam falhar antes de qualquer mudança em `src/`.

---

### T-01 — Escrever os testes de problem details antes da implementação

Cria `test/problem-details.test.ts` com `describeMatrix` (web e node), cobrindo os casos da tabela "Estratégia de testes" da techspec. Antes de tocar em `src/`, roda o arquivo e confirma que os casos novos falham pelo motivo esperado (content-type antigo, corpo sem `type`/`title`/`detail`, `type`/`instance` inexistentes).

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** nenhuma

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts` executa e os casos de RF-01 a RF-07 falham, com a saída registrada no PR ou na tarefa.
- Cada caso de RF-01 a RF-07 tem pelo menos um `it` nos modos `web` e `node`.
- Os casos de D-04 (`content-type` de `HTTPError.headers` sobrescrito), D-05 (`cause: { type }` ignorado) e D-06 (`unhandled` com `type` e `instance` mascarados) estão presentes.
- Os casos de HEAD e de `stack` só em modo debug estão presentes.

**Arquivos:** `test/problem-details.test.ts`

---

### T-02 — Criar a tabela de frases padrão de status

Cria `src/utils/internal/status.ts` com `getReasonPhrase(status: number): string`, usando um `Map<number, string>` com as frases registradas na IANA. Status fora da tabela retorna `"Unknown Error"`. O arquivo não é exportado em `src/index.ts`, e não importa `node:http` (D-07).

**Cobre:** RF-02

**Depende de:** nenhuma

**Aceite:**
- `getReasonPhrase(404)` retorna `"Not Found"`, `getReasonPhrase(418)` retorna `"I'm a teapot"` e `getReasonPhrase(599)` retorna `"Unknown Error"`.
- Um teste unitário em `test/unit/` cobre os códigos citados acima.
- `grep` em `src/index.ts` não encontra `getReasonPhrase` nem `status.ts`.
- O arquivo não contém imports de `node:*`.

**Arquivos:** `src/utils/internal/status.ts`, `test/unit/` (teste unitário da tabela)

---

### T-03 — `HTTPError` aceita e expõe `type` e `instance`

Em `src/error.ts`: adiciona `type?: string` e `instance?: string` a `ErrorBody`, com JSDoc citando RFC 9457 §3.1.1 e §3.1.5. Adiciona as propriedades `readonly type` e `readonly instance` à classe. No construtor, lê os valores somente de `details` (`(details as ErrorBody)?.type`), sem fallback para `cause` (D-05). Não cria nenhum outro nome público.

**Cobre:** RF-03

**Depende de:** T-01

**Aceite:**
- `new HTTPError({ status: 404, type: "https://exemplo.com/erros/usuario-inexistente", instance: "/usuarios/42" })` expõe `error.type` e `error.instance` com esses valores.
- `new HTTPError({ status: 400, cause: { type: "x" } })` tem `error.type === undefined`.
- `ErrorInput` aceita `type` e `instance` (herdado de `Partial<ErrorBody>`).
- `test/unit/package.test.ts` continua passando sem alteração de snapshot.

**Arquivos:** `src/error.ts`

---

### T-04 — `HTTPError.toJSON()` no formato RFC 9457

Reescreve `toJSON()` em `src/error.ts` seguindo a ordem de montagem da techspec (D-03): `body` e extensões entram primeiro; os membros padrão (`type`, `title`, `status`, `detail`, `instance`) entram por último e prevalecem. Mantém `statusText`, `unhandled`, `message` e `data` no retorno (RF-06). Quando `unhandled` é verdadeiro: `type` vira `"about:blank"`, `instance` vira `undefined` e `detail`/`message` viram `"HTTPError"` (D-06, RF-04). `title` usa `statusText` ou `getReasonPhrase(status)`.

**Cobre:** RF-02, RF-04, RF-05, RF-06

**Depende de:** T-02, T-03

**Aceite:**
- `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido" })` gera JSON com `type: "about:blank"`, `title: "Unprocessable Content"`, `status: 422`, `detail: "Campo inválido"`.
- `new HTTPError({ status: 400, body: { status: 1, title: "y", detail: "z" }, data: { campo: "email" } })` gera `status: 400`, `title` e `detail` padrão, e `campo` no nível superior.
- `new HTTPError({ status: 409, message: "Conflito" })` mantém `message` e, quando definido, `statusText`, `data` e `unhandled` no JSON.
- `new Error("segredo do banco")` não tem a string no JSON gerado.
- `pnpm vitest run test/problem-details.test.ts -t "toJSON"` passa nos casos de corpo.

**Arquivos:** `src/error.ts`

---

### T-05 — `errorResponse` envia `application/problem+json` com precedência do h3

Em `src/response.ts`: adiciona `const problemContentType = "application/problem+json;charset=UTF-8";` ao lado de `jsonHeaders`, sem mexer em `jsonHeaders` (usado em sucesso). Reescreve `errorResponse` (`src/response.ts:358-380`) para montar `new Headers(error.headers)`, mesclar `errHeaders` e depois fazer `headers.set("content-type", problemContentType)` (D-04). Mantém o `stack` só em modo debug.

**Cobre:** RF-01, RF-04, RF-07

**Depende de:** T-04

**Aceite:**
- `throw new HTTPError({ status: 404 })` responde 404 com `content-type: application/problem+json;charset=UTF-8`.
- `new HTTPError({ status: 401, headers: { "www-authenticate": "Basic" } })` responde 401 com o header `www-authenticate: Basic` e `content-type` do h3.
- `new HTTPError({ status: 400, headers: { "content-type": "text/plain" } })` responde com `content-type` problem+json.
- `event.res.errHeaders.set("x-err", "1")` aparece na resposta de erro.
- Erro não tratado sem debug responde 500 com problem+json; com debug, `stack` aparece no corpo.
- HEAD com erro não envia corpo e mantém o `content-type`.
- `pnpm vitest run test/problem-details.test.ts` passa integralmente.

**Arquivos:** `src/response.ts`

---

### T-06 — Ajustar os testes existentes afetados

Em `test/errors.test.ts`, troca somente os dois pontos afetados: a linha 44 passa a esperar `"application/problem+json;charset=UTF-8"` e a linha 140 passa a `toMatch("application/problem+json")`. Não remove asserções de corpo nem de headers. Qualquer outra falha é tratada como regressão, não como ajuste.

**Cobre:** RF-08

**Depende de:** T-05

**Aceite:**
- `pnpm vitest run test/errors.test.ts` passa.
- O diff de `test/errors.test.ts` altera apenas as duas linhas listadas; nenhum `it` ou `expect` de corpo, headers, `set-cookie` ou `x-error-own` é removido.
- `pnpm vitest run` na suíte inteira não mostra falhas fora dos dois pontos ajustados.

**Arquivos:** `test/errors.test.ts`

---

### T-07 — Testes de tipo para `type` e `instance`

Em `test/unit/types.test-d.ts`, adiciona as asserções de tipo: `new HTTPError({ status: 400, type: "x" }).type` é `string | undefined`, `instance` tem o mesmo tipo, e `ErrorInput` aceita os dois campos sem erro de compilação.

**Cobre:** RF-03, RF-08

**Depende de:** T-03

**Aceite:**
- `pnpm typecheck` passa com as novas asserções.
- Trocar o tipo de `type` para `number` no `src/error.ts` faz o typecheck falhar (verificação manual, desfeita depois).

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-08 — Atualizar a documentação de erros

Em `docs/1.guide/1.basics/6.error.md`: o exemplo de JSON (linhas 39-48) passa a mostrar o corpo problem details com `type`, `title`, `status`, `detail`, `instance` quando houver, e os membros de extensão. A lista de campos de `HTTPError` (linhas 51-60) inclui `type` e `instance`. A dica da linha 90 passa a citar `type` e `instance` em erros `unhandled` e o `Content-Type` `application/problem+json`. Documenta a precedência de `content-type` (risco 2 da techspec). Não edita `CHANGELOG.md`, que é gerado no release.

**Cobre:** RF-01, RF-02, RF-03

**Depende de:** T-05

**Aceite:**
- O exemplo de JSON da página corresponde à saída real de `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido" })`.
- A página cita `type` e `instance` na lista de campos e na dica de `unhandled`.
- `pnpm lint` (inclui `oxfmt --check`) passa para o arquivo Markdown.

**Arquivos:** `docs/1.guide/1.basics/6.error.md`

---

### T-09 — Verificação final e regressões de bundle e exports

Roda o conjunto completo de verificação e confirma que o contrato público não mudou: snapshot de exports sem nomes novos, orçamento de bundle de `h3/rules` e benchmark de erro sem regressão relevante.

**Cobre:** RF-08

**Depende de:** T-06, T-07, T-08

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa.
- `pnpm vitest run test/unit/package.test.ts` passa sem alterar o snapshot.
- `pnpm vitest run test/rules/treeshake.test.ts` passa (se falhar, aplicar o plano de contingência do risco 7 da techspec).
- `pnpm typecheck` e `pnpm lint` passam.
- `pnpm test` (lint, typecheck e cobertura) passa.
- Se houver suspeita de regressão de desempenho, `pnpm bench:node` comparado com a linha de base (risco 8).

**Arquivos:** nenhum arquivo novo; verificação sobre os arquivos de T-01 a T-08.

---

## Pendências fora das tarefas

Estas decisões não bloqueiam a implementação, mas bloqueiam o release. Não são tarefas de código.

- **Aval de versão:** confirmar com quem mantém o projeto que a mudança vai para uma versão que aceita quebra de contrato de erro (PRD, premissas e riscos; techspec, pendências).
- **Confirmação de D-04:** a precedência do `content-type` do h3 sobre `HTTPError.headers` segue a leitura literal de RF-07. Se o mantenedor preferir a precedência do usuário, muda uma linha em `errorResponse` (T-05) e o teste de D-04 junto.
- **Nota de release:** redigir o texto da quebra (Content-Type, colisão de chaves de `body`, precedência de headers) para o release.
