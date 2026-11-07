# Tarefas — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (D-01 a D-08, R1 a R11).
Ordem sugerida: T-01 e T-02 em paralelo; depois T-03 (testes que falham); depois a implementação (T-04 a T-08); por fim validação e documentação.

Regra do AGENTS.md para correção e novos comportamentos: escrever o teste antes, confirmar que ele falha e só então implementar.

---

### T-01 — Adicionar a opção `problemDetails` ao `H3Config`

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:**
- `H3Config` tem `problemDetails?: boolean` com o doc da techspec, logo após `allowMalformedURL`.
- Teste de tipo em `test/unit/types.test-d.ts`: `H3Config["problemDetails"]` é `boolean | undefined`.
- `new H3()` sem a opção resulta em `app.config.problemDetails` igual a `undefined`.
- `pnpm typecheck` passa.

**Arquivos:**
- `src/types/h3.ts`
- `test/unit/types.test-d.ts`

---

### T-02 — `HTTPError` aceita e expõe `type` e `instance`

**Cobre:** RF-03

**Depende de:** nenhuma

**Aceite:**
- `ErrorBody` ganha `type?: string` e `instance?: string`, herdados por `ErrorInput`.
- A classe declara `readonly type: string | undefined` e `readonly instance: string | undefined`, lidos de `details` no construtor (sem fallback em `cause`, D-04).
- `new HTTPError({ status: 403, type: "https://exemplo.test/erros/sem-permissao", instance: "/pedidos/42" })` expõe os dois valores em `err.type` e `err.instance`.
- `HTTPError.toJSON()` não muda: os campos novos não aparecem na saída padrão.
- Tipos: `type: 123` falha na compilação (`@ts-expect-error`); `err.type` é `string | undefined`.
- `pnpm typecheck` passa.

**Arquivos:**
- `src/error.ts`
- `test/unit/types.test-d.ts`

---

### T-03 — Escrever os testes de problem details antes da implementação

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06

**Depende de:** T-01, T-02

**Aceite:**
- Existe `test/problem-details.test.ts` com `describeMatrix` (web e node), usando `t.app`, com `problemDetails` configurada explicitamente nos testes.
- Casos cobertos, um por requisito (lista completa na techspec, seção "Estratégia de testes"):
  - RF-01: opção ausente resulta em `undefined`.
  - RF-02: `HTTPError` 404 com `statusText` e `message` resulta em `application/problem+json` e os membros `type`, `title`, `status`, `detail`; `GET /missing` resulta em `detail` começando com `Cannot find any route`.
  - RF-03: opção desligada não mostra `type` nem `instance` e o `Content-Type` não é problem.
  - RF-04: caso com `x-error`, `x-success` ausente e `getSetCookie()` sem duplicação, com a opção ligada.
  - RF-05: `new Error("senha do banco: 123")` resulta em 500, `detail: "HTTPError"` e corpo sem o segredo.
  - RF-06: `onError` retornando `HTTPError` 422 resulta em `detail: "Dados inválidos"`; `onError` retornando `new Error` resulta em 500 não tratado.
- Rodando `pnpm vitest run test/problem-details.test.ts` antes da implementação, os casos de RF-02, RF-03 (ligada), RF-05 e RF-06 falham pelo motivo esperado (formato antigo), e os de RF-01 e RF-04 (desligada) passam.
- O resultado da execução inicial (quais casos falharam e por quê) é anotado no PR ou no próprio arquivo de tarefas.

**Arquivos:**
- `test/problem-details.test.ts`

---

### T-04 — Renderizar erros em problem details pela função `errorResponse`

**Cobre:** RF-02, RF-03, RF-04

**Depende de:** T-03

**Aceite:**
- `errorResponse(error, config, errHeaders?)` recebe `config: H3Config` no lugar de `debug`. A chamada em `prepareResponse` (por volta de `src/response.ts:173`) passa `config`.
- Com `config.problemDetails` verdadeiro: `Content-Type` é `application/problem+json` (via novo `problemHeaders`, ao lado de `jsonHeaders`, D-05) e o corpo vem de `toProblemJSON(error, debug)` com `type` (padrão `about:blank`), `title`, `status`, `detail` e `instance` (quando string).
- `toProblemJSON` checa `typeof === "string"` em `type` e `instance` (risco R2).
- Com a opção desligada, o ramo antigo fica idêntico ao atual, byte a byte (RF-04). Pode-se preferir duas funções em vez de um ternário, se ficar mais legível.
- Os testes de RF-02, RF-03 e RF-04 do arquivo de T-03 passam.
- `error.headers` continua sobrescrevendo a base, e `errHeaders` é mesclado depois, como hoje.
- Helper `toProblemJSON` fica no fim de `src/response.ts`, como helper interno.

**Arquivos:**
- `src/response.ts`

---

### T-05 — Ocultar detalhes de erros não tratados e definir a precedência com `body`

**Cobre:** RF-05, RF-04

**Depende de:** T-04

**Aceite:**
- Com `unhandled`, o corpo problem não tem `type` (vira `about:blank`), não tem `instance`, tem `detail: "HTTPError"`, e não tem `data`, `body` nem `stack` fora do modo `debug` (D-03).
- Teste de RF-05 passa: status 500, `Content-Type` problem, `detail` igual a `"HTTPError"`, corpo sem `"senha do banco"`.
- Precedência: `HTTPError({ status: 400, body: { type: "x", status: 1, extra: true } })` resulta em `type: "about:blank"`, `status: 400` e `extra: true` (membros RFC vencem, R1).
- Caso de `toError` com valor não-Error `{ type: "x" }` resulta em `type: "about:blank"`.
- Caso de erro "HTTPError-shaped" de outro pacote (`name: "HTTPError"`, `status: 400`, `type: 42`) não quebra e não envia `type` não-string.
- Decisão de R6 (stack em debug): confirmada com o solicitante antes de fechar esta tarefa. Ver "Pontos em aberto".

**Arquivos:**
- `src/response.ts`
- `test/problem-details.test.ts`

---

### T-06 — Usar a config da app em `toResponse` quando nenhuma for passada

**Cobre:** RF-02

**Depende de:** T-04

**Aceite:**
- Default de `toResponse` passa a ser `event.app?.config ?? {}` (D-07). Assinatura pública não muda.
- Teste de D-07 (caso 13 da techspec): com `t.app.use(onResponse(() => {}))` e handler que retorna `new HTTPError({ status: 409, message: "conflito" })`, a resposta sai em problem details.
- Caminho de `src/rules/cache.ts:314` também passa a usar a config da app; sem regressão nos testes de cache.
- `handler.fetch()` sem app continua sem `problemDetails` (D-08, R8), e isso está registrado na documentação.
- Efeito colateral de `debug` nesses caminhos (R4) está anotado para o changelog.
- `pnpm typecheck` passa (R10).

**Arquivos:**
- `src/response.ts`
- `test/problem-details.test.ts`

---

### T-07 — Garantir que `onError` renderiza no formato selecionado

**Cobre:** RF-06

**Depende de:** T-04

**Aceite:**
- O fluxo de `onError` não é alterado (D-06). O `Response` gerado pelo hook não passa por nova mesclagem de `errHeaders` (`nested = true`).
- `onError` retornando `HTTPError` 422 com `message: "Dados inválidos"` resulta em status 422, `application/problem+json` e `detail: "Dados inválidos"`.
- `onError` retornando `new Error("x")` resulta em 500 não tratado, `detail: "HTTPError"`.
- `onError` retornando um valor que não é erro segue a renderização normal de sucesso (D-06, R7), salvo decisão diferente do solicitante (ver "Pontos em aberto").
- `test/hooks.test.ts` e `test/errors.test.ts` continuam passando.

**Arquivos:**
- `src/response.ts`
- `test/problem-details.test.ts`

---

### T-08 — Preservar cabeçalhos de erro e `set-cookie` com a opção ligada

**Cobre:** RF-02, RF-04

**Depende de:** T-04

**Aceite:**
- `HTTPError({ headers: { "x-own": "1" } })` com a opção ligada mantém `x-own` (D-05).
- Teste do `set-cookie` (caso 7 da techspec) passa: `x-error` presente, `x-success` ausente, `getSetCookie()` igual a `["error=1", "prepared=1"]`, sem duplicação (R9).
- Um app que define `content-type` em `HTTPError.headers` continua recebendo esse valor (R3), coberto por teste ou anotado para documentação.

**Arquivos:**
- `src/response.ts`
- `test/problem-details.test.ts`

---

### T-09 — Validar a compatibilidade com o formato atual e a suíte completa

**Cobre:** RF-04

**Depende de:** T-05, T-06, T-07, T-08

**Aceite:**
- `pnpm vitest run` roda sem nenhuma alteração de configuração e passa sem mudar testes existentes. Se algum teste existente precisar de ajuste, a mudança fica restrita ao que ele verifica, sem perder a verificação original (RF-04).
- Testes específicos passam: `pnpm vitest run test/problem-details.test.ts`, `pnpm vitest run test/errors.test.ts test/hooks.test.ts test/app.test.ts`.
- `pnpm typecheck` e `pnpm lint` passam ao final.
- Caminho desligado sem `debug` gera o mesmo corpo e os mesmos cabeçalhos de antes (comparação com a saída do commit `9dfd537` em pelo menos um caso de erro, HTTPError e 404).

**Arquivos:**
- `test/problem-details.test.ts`
- `test/errors.test.ts` (somente se algum teste existente precisar de ajuste)

---

### T-10 — Documentar a opção, `type`, `instance` e as ressalvas

**Cobre:** RF-01, RF-03

**Depende de:** T-09

**Aceite:**
- `docs/1.guide/900.api/1.h3.md` documenta `problemDetails` ao lado de `allowMalformedURL`.
- `docs/1.guide/1.basics/6.error.md` tem seção curta sobre `type`, `instance` e o modo problem details.
- A documentação registra: `Content-Type` muda para `application/problem+json` quando a opção está ligada (R5); `error.headers` pode sobrescrever `Content-Type` (R3); `handler.fetch()` sem app não usa a opção (R8).
- Nota de changelog: `debug` passa a valer em `onResponse` e no cache (R4).

**Arquivos:**
- `docs/1.guide/900.api/1.h3.md`
- `docs/1.guide/1.basics/6.error.md`

---

## Pontos em aberto

Estes pontos da techspec precisam de resposta de quem pediu. Até lá, a tarefa indicada segue com a leitura adotada.

1. **D-06 / R7 (T-07):** o formato de erro vale só para erros retornados por `onError`, e valores de sucesso seguem a renderização normal? Leitura adotada: sim.
2. **R6 (T-05):** `stack` em modo debug para erro não tratado pode continuar? Leitura adotada: sim, porque o PRD diz que não é exposto *fora* do debug.
3. **D-02 (T-04):** `statusText` e `unhandled` saem do formato problem details. Se algum consumidor depender deles, ficam como extensões. Leitura adotada: saem.
4. **D-07 (T-06):** aceitar a mudança de `debug` nos caminhos de `onResponse` e cache. Leitura adotada: aceita, com nota no changelog.
