# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-09, R-01 a R-09).

Ordem do fluxo (AGENTS, "Bug Fix Workflow"): primeiro os testes de guarda e de regressão, depois confirmar que os testes novos falham, depois a implementação, depois a verificação ampla.

Decisões do techspec que o time ainda precisa confirmar antes de T-05 e T-06:
- D-05: erro não tratado sai com `type` "about:blank" e sem `instance`, mesmo quando o `HTTPError` informa esses campos.
- D-07: `stack` em modo debug continua no corpo problem, como membro de extensão.
- R-05: `data` e `body` não entram no corpo problem.
- R-03: `problemDetails` não se aplica nos caminhos sem `config` (`defineHandler(...).fetch`, `onResponse` de middleware, cache de ocache).

---

### T-01 — Testes de guarda do formato padrão

**Cobre:** RF-01, RF-04

**Depende de:** nenhuma

**Aceite:** criar `test/problem-details.test.ts` com `describeMatrix` (web e node) e os casos:
- `app.config.problemDetails` é `undefined` (ou `false`) numa aplicação criada sem a opção;
- uma rota que lança `HTTPError` com `type` e `instance` responde com o mesmo `Content-Type` e o mesmo corpo de um `HTTPError` sem esses campos, com a opção desligada;
- a resposta não contém `application/problem+json`.
Os testes passam antes de qualquer mudança em `src/`. Comparar o corpo com a saída atual, não com um valor escrito à mão, para travar D-03.

**Arquivos:** `test/problem-details.test.ts` (novo)

---

### T-02 — Testes de regressão do comportamento novo

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07

**Depende de:** T-01

**Aceite:** acrescentar em `test/problem-details.test.ts` os casos:
- RF-02: `new HTTPError({ status: 404, message, type, instance })` expõe `error.type` e `error.instance`; sem esses campos, ambos são `undefined`.
- RF-03: com `new H3({ problemDetails: true })`, `GET /orders/42` que lança o erro do PRD responde 404, `Content-Type` começando com `application/problem+json`, e corpo igual a `{ "type", "title": "Not Found", "status": 404, "detail", "instance" }`. Também o caso sem `type` nem `instance`: `"type": "about:blank"`, sem `instance`.
- RF-05: `headers: { "retry-after": "120" }` aparece na resposta, e `title` recebe o `statusText` sanitizado.
- RF-06: `new Error("senha do banco: x")` com `debug` desligado gera status 500, `application/problem+json`, e corpo sem "senha do banco" nem stack.
- RF-07: `onError` recebe um erro cujo `type` é o informado; `onResponse` é chamado uma vez com a resposta de erro.
- Rodar `pnpm vitest run test/problem-details.test.ts` e registrar que os casos de RF-02, RF-03, RF-05 e RF-07 falham. Não corrigir nada nesta tarefa.

**Arquivos:** `test/problem-details.test.ts`

---

### T-03 — Opção `problemDetails` em `H3Config`

**Cobre:** RF-01

**Depende de:** T-02

**Aceite:** `problemDetails?: boolean` aparece em `H3Config` logo depois de `allowMalformedURL`, com JSDoc no mesmo estilo de `debug`. `app.config.problemDetails` vale `true` com `new H3({ problemDetails: true })`. Com a opção ausente, o valor é `undefined`. `pnpm typecheck` passa.

**Arquivos:** `src/types/h3.ts`

---

### T-04 — `type` e `instance` em `HTTPError`

**Cobre:** RF-02

**Depende de:** T-02

**Aceite:**
- `ErrorInput` aceita `type?: string` e `instance?: string`, com JSDoc.
- `HTTPError` declara `readonly type: string | undefined` e `readonly instance: string | undefined`, com JSDoc.
- Os valores vêm só de `details as ErrorInput`, sem fallback para `cause` (D-02).
- `toJSON()` não muda (D-03). A suíte de `test/errors.test.ts` continua passando.
- O caso de RF-02 em `test/problem-details.test.ts` passa.

**Arquivos:** `src/error.ts`

---

### T-05 — Corpo e `Content-Type` problem details em `errorResponse`

**Cobre:** RF-03, RF-05

**Depende de:** T-03, T-04

**Aceite:**
- `errorResponse(error, config, errHeaders?)` substitui `errorResponse(error, debug, errHeaders?)`, e o único chamador (`src/response.ts:173`) passa `config` (D-04).
- Constante `problemHeaders` com `"content-type": "application/problem+json;charset=UTF-8"`, ao lado de `jsonHeaders` (D-06).
- Função interna `toProblemDetails` no fim de `src/response.ts`, sem `export` (D-09), com os membros `type`, `title`, `status`, `detail`, `instance` e `stack` (somente com debug). Valores omitidos são `undefined`, nunca `null` (techspec, "Pontos de contrato").
- A ordem de merge é mantida: base, `error.headers`, `errHeaders`. `errHeaders` aparece uma vez na resposta (sem repetir o merge de `src/response.ts:167-173`).
- Os casos de RF-03, RF-05 e o teste de `errHeaders` em problem details passam.

**Arquivos:** `src/response.ts`

---

### T-06 — Erros não tratados e hooks

**Cobre:** RF-06, RF-07

**Depende de:** T-05

**Aceite:**
- Em `toProblemDetails`, com `error.unhandled` verdadeiro: `type` vira `"about:blank"`, e `detail` e `instance` ficam omitidos (D-05). Caso: `new HTTPError({ status: 500, unhandled: true, type: "https://x/y", instance: "/a" })` sai com `about:blank` e sem `instance`.
- Erro não tratado com `debug` desligado não expõe "senha do banco" nem stack (RF-06).
- `onError` recebe `type` e `instance` do `HTTPError`, e `onResponse` é chamado uma vez com a resposta final (RF-07).
- Os casos de RF-06 e RF-07 passam, e a decisão D-05 fica registrada como confirmada ou ajustada no texto desta tarefa.

**Arquivos:** `src/response.ts`, `test/problem-details.test.ts`

---

### T-07 — Asserções de tipo

**Cobre:** RF-01, RF-02

**Depende de:** T-03, T-04

**Aceite:** em `test/unit/types.test-d.ts`, `expectTypeOf<H3Config["problemDetails"]>().toEqualTypeOf<boolean | undefined>()`, `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()` e o mesmo para `instance`. `pnpm typecheck` passa com `isolatedDeclarations`.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-08 — Verificação final e não regressão

**Cobre:** RF-04, RF-07

**Depende de:** T-05, T-06, T-07

**Aceite:**
- `pnpm vitest run test/problem-details.test.ts` e `pnpm vitest run test/errors.test.ts` passam, nos dois runtimes (web e node).
- `pnpm typecheck` e `pnpm lint` passam.
- `pnpm vitest run` (suíte completa) passa. Se `test/dist.test.ts` falhar por falta de `dist/`, rodar `pnpm build` e registrar isso no relatório.
- `src/index.ts` não muda e `test/unit/package.test.ts` continua passando (nenhum export novo além de `problemDetails`, `type` e `instance`).
- `toJSON()` e o corpo padrão continuam iguais, com a opção desligada (RF-04).

**Arquivos:** nenhum arquivo novo; só execução de comandos e relatório.
