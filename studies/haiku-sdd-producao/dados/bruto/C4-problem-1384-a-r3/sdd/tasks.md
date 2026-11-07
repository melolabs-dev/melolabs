# Tarefas de implementação — Problem Details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (D-01 a D-10, R-01 a R-09).

Ordem de execução: testes antes da implementação, conforme o "Bug Fix Workflow" de `AGENTS.md` (T-04 precisa falhar antes de T-05).

## Pendências da spec a confirmar antes de T-03 e T-05

A spec (seção 7) adotou uma escolha para cada item abaixo. Se alguma mudar, ajustar a tarefa indicada:

1. `title` para erros `unhandled` (D-05): adotado omitir. Afeta T-03.
2. `Content-Type` vs. `headers` do usuário (D-06): adotado media type fixo. Afeta T-05.
3. `stack` no modo `debug` (D-07): adotado omitir. Afeta T-05 e T-07.
4. `body` (propriedades de topo, R-03): adotado não emitir. Afeta T-03.
5. Passar `config` em `onResponse` (D-08): adotado. Afeta T-06; pode virar correção separada.

---

### T-01 — Campos `type` e `instance` em `HTTPError`

**Cobre:** RF-02

**Depende de:** nenhuma

**Aceite:**
- `new HTTPError({ status: 404, type: "https://example.com/probs/not-found", instance: "/users/42" })` expõe `error.type` e `error.instance` com esses valores.
- `new HTTPError({ status: 404 })` não lança e deixa `error.type` e `error.instance` como `undefined`.
- Valores não-string de `type` e `instance` são ignorados (`typeof`).
- `error.toJSON()` e o corpo padrão de erro não mudam (`pnpm vitest run test/errors.test.ts` continua passando sem alteração).

**Arquivos:** `src/error.ts`

---

### T-02 — Opção `problemDetails` em `H3Config`

**Cobre:** RF-01, RF-06

**Depende de:** nenhuma

**Aceite:**
- `problemDetails?: boolean` existe em `H3Config`, logo após `allowMalformedURL`, com TSDoc que descreve o formato e registra que `mount(app)` usa a config do app pai (R-02).
- Com uma aplicação criada sem a opção, `app.config.problemDetails` é `undefined` (tratado como desligado).
- Em `test/unit/types.test-d.ts`, `// @ts-expect-error` em `new H3({ problemDetails: "sim" })` é aceito pelo `pnpm typecheck`.
- Nenhum símbolo novo é exportado por `src/index.ts`.

**Arquivos:** `src/types/h3.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Serializador `toProblemDetails`

**Cobre:** RF-03, RF-05

**Depende de:** T-01

**Aceite:**
- `test/unit/problem-details.test.ts` cobre as regras 1 a 7 de D-03 e passa:
  - erro completo gera `type`, `title`, `status`, `detail`, `instance` nessa ordem;
  - `type` ausente vira `"about:blank"`;
  - `data` objeto tem as chaves espalhadas, e as chaves `type`, `title`, `status`, `detail` e `instance` de `data` são descartadas, inclusive quando o membro padrão está ausente;
  - `data` que não é objeto simples (string, array, `null`) não é espalhado;
  - erro `unhandled` gera apenas `type: "about:blank"` e `status`, mesmo com `statusText`, `message`, `data` e `instance` definidos;
  - `stack`, `body` e `unhandled` nunca aparecem na saída.
- O arquivo `src/utils/internal/problem-details.ts` fica coberto pelos testes unitários (cobertura de `src/**/*.ts`).
- O arquivo não é exportado em `src/index.ts` e fica abaixo de 200 linhas.

**Arquivos:** `src/utils/internal/problem-details.ts`, `test/unit/problem-details.test.ts`

---

### T-04 — Testes de integração escritos antes da implementação

**Cobre:** RF-03, RF-04, RF-05

**Depende de:** T-01, T-02

**Aceite:**
- `test/problem-details.test.ts` usa `describeMatrix` e cobre:
  - padrão sem a opção: corpo e `Content-Type: application/json;charset=UTF-8` iguais aos de hoje, sem `type` nem `instance` (RF-04);
  - opção ligada com o exemplo de RF-03: status `404`, `Content-Type: application/problem+json` e corpo exato `{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Usuário não existe", "instance": "/users/42" }`;
  - erro sem `type` gera `type: "about:blank"`;
  - `new Error("segredo do banco")` com a opção ligada: status `500`, `application/problem+json`, `status: 500`, sem `detail` e sem a string secreta no corpo (RF-05);
  - `throw { status: 404, type: "x" }` renderiza 500 sem o `type` do objeto;
  - `new Error` com propriedade `type: "entity.too.large"` gera `type: "about:blank"`.
- Antes de T-05, `pnpm vitest run test/problem-details.test.ts` falha nos casos com a opção ligada, e os casos sem a opção passam. Registrar a saída dessa execução.

**Arquivos:** `test/problem-details.test.ts`

---

### T-05 — Ramo `problemDetails` em `errorResponse`

**Cobre:** RF-03, RF-04, RF-05

**Depende de:** T-03, T-04

**Aceite:**
- `errorResponse` recebe `config: H3Config` no lugar de `debug`, e a chamada em `src/response.ts` passa `config`.
- Com `config.problemDetails` ligado, a resposta tem `Content-Type: application/problem+json` (sem `charset`) e corpo produzido por `toProblemDetails`. Com `debug: true`, o JSON sai identado com 2 espaços.
- Com a opção desligada, o ramo padrão não muda de texto nem de ordem de merge de headers, e `set-cookie` de `errHeaders` continua acumulando.
- Os testes de T-04 passam: `pnpm vitest run test/problem-details.test.ts`.
- `pnpm vitest run test/errors.test.ts` passa sem alteração de testes.

**Arquivos:** `src/response.ts`

---

### T-06 — Passar `config` nos pontos que renderizam sem ele

**Cobre:** RF-03

**Depende de:** T-05

**Aceite:**
- `src/utils/middleware.ts` chama `toResponse(rawBody, event, event.app?.config)`.
- `src/rules/cache.ts` recebe a mesma mudança, depois de confirmar se um valor de erro pode chegar a `toResponse` nesse caminho (R-04). Se não puder, a mudança não é feita e a decisão fica registrada na tarefa.
- Teste: `HTTPError` retornado (não lançado) dentro de `use(onResponse(...))` com a opção ligada sai no formato problem (D-08).
- `src/handler.ts` não muda (D-08).

**Arquivos:** `src/utils/middleware.ts`, `src/rules/cache.ts`, `test/problem-details.test.ts`

---

### T-07 — Cenários de borda e não reformatação

**Cobre:** RF-03, RF-04, RF-05

**Depende de:** T-06

**Aceite:**
- `test/problem-details.test.ts` cobre e passa:
  - handler retorna `HTTPError` (não lança): formato problem;
  - handler retorna `new Response(..., { status: 404 })` ou `HTTPResponse`: não é reformatado (R-08);
  - `onError` retorna `Response` customizada: não é reformatada;
  - `onError` sem retorno: o erro segue para o render com o formato problem;
  - JSON circular em `data` com a opção ligada: 500 no formato problem;
  - `debug: true` com a opção ligada: corpo sem `stack`;
  - requisição `HEAD`: status e `Content-Type` problem, sem corpo;
  - `mount(subApp)` via `fetchable` usa a config do sub-app; `mount(app)` usa a config do pai (D-10, R-02), com teste que documenta esse comportamento.

**Arquivos:** `test/problem-details.test.ts`

---

### T-08 — Regressão, lint, tipos e build

**Cobre:** RF-04, RF-06

**Depende de:** T-06, T-07

**Aceite:**
- `pnpm vitest run` (suíte completa) passa. Se algum teste existente precisar de ajuste, o ajuste mantém o que ele verifica e a mudança fica descrita na mensagem da entrega.
- `pnpm lint` termina sem erros (oxlint + oxfmt --check).
- `pnpm typecheck` termina sem erros, incluindo o `@ts-expect-error` de T-02.
- `pnpm build` termina sem erros, e `isolatedDeclarations` não reclama do novo arquivo interno.
- Cobertura de `src/utils/internal/problem-details.ts` e de `src/response.ts` no ramo novo aparece no relatório de `pnpm test`.

**Arquivos:** `test/errors.test.ts`, `test/mount.test.ts`, `test/app.test.ts` (somente se um ajuste for necessário)
