# Tarefas de implementação — Problem details (RFC 9457)

Base: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (D-01 a D-08, R-01 a R-09).

Convenção de todas as tarefas: pelo `AGENTS.md`, escrever o teste que reproduz o comportamento, confirmar que ele falha, depois implementar e confirmar que passa. Testes de comportamento HTTP usam `describeMatrix` (modos `web` e `node`).

Mapa de cobertura:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01 |
| RF-02 | T-03, T-04, T-05 |
| RF-03 | T-02 |
| RF-04 | T-03, T-05 |
| RF-05 | T-03, T-05 |
| RF-06 | T-01, T-04, T-05, T-06 |

---

### T-01 — Opção `problemDetails` em `H3Config` com padrão `false`

- Cobre: RF-01, RF-06 (a opção nasce desligada, então o comportamento atual não muda)
- Depende de: nenhuma
- Aceite: criar `test/problem-details.test.ts` com dois casos de RF-01 (`new H3({ problemDetails: true })` lê `app.config.problemDetails === true`; app sem a opção lê `false`). Os casos falham antes da mudança. Depois de adicionar `problemDetails?: boolean` em `H3Config` (com JSDoc que diga padrão `false`, que só afeta erros, e que `debug` não inclui `stack` no corpo, conforme R-03 e R-04) e o padrão `this.config = { ...config, problemDetails: config.problemDetails ?? false }` no construtor de `H3Core`, os casos passam. `pnpm vitest run test/problem-details.test.ts` e `pnpm typecheck` passam.
- Arquivos: `src/types/h3.ts`, `src/h3.ts`, `test/problem-details.test.ts` (novo)

### T-02 — Campos `type` e `instance` em `HTTPError`

- Cobre: RF-03
- Depende de: nenhuma
- Aceite: criar `test/unit/error.test.ts` com: (a) `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })` expõe `error.type` e `error.instance` com esses valores; (b) sem os campos, ambos valem `undefined`; (c) `error.toJSON()` não ganha as chaves `type` e `instance`, nem quando definidas (D-01, regressão de RF-06); (d) `new HTTPError(new Error("x"))` deixa `type` e `instance` como `undefined`, sem herdar do `cause` (D-01). Adicionar `type?` e `instance?` em `ErrorInput`, propriedades `readonly` na classe e atribuição no construtor logo após `this.body = ...`. `toJSON()` não muda. Os casos (a), (b) e (d) falham antes da mudança. `pnpm vitest run test/unit/error.test.ts` passa.
- Arquivos: `src/error.ts`, `test/unit/error.test.ts` (novo)

### T-03 — Módulo interno `toProblemDetails`

- Cobre: RF-02 (título e status do corpo), RF-04 (`type` e `instance` no corpo, `about:blank` sem `type`), RF-05 (mascaramento de erros não tratados)
- Depende de: T-02
- Aceite: criar `src/utils/internal/problem.ts` com a interface `ProblemDetails` e a função `toProblemDetails(error: HTTPError)`, seguindo D-03 e D-05. Regras: `status` = `error.status`; `title` = `statusTitles[status]` ou `error.statusText`, com campo omitido se nenhum existir; `type` = `error.type` quando não é `unhandled`, senão `"about:blank"`; `detail` = `error.message` quando não é `unhandled`, senão omitido; `instance` = `error.instance` quando não é `unhandled`, senão omitido; `stack` nunca entra. A tabela `statusTitles` fica no fim do arquivo, com os códigos comuns do registro IANA. Como o módulo é interno, não entra em `src/index.ts` (`test/unit/package.test.ts` deve continuar passando). Verificar por teste unitário em `test/unit/problem.test.ts` (novo): 404 → `title: "Not Found"`; `type` e `instance` definidos aparecem; sem `type` → `"about:blank"`; erro `unhandled` não expõe `detail`, `type` nem `instance`. Os casos falham antes da implementação. O arquivo fica abaixo de 200 linhas (AGENTS.md).
- Arquivos: `src/utils/internal/problem.ts` (novo), `test/unit/problem.test.ts` (novo)

### T-04 — `errorResponse` renderiza problem details quando a opção está ligada

- Cobre: RF-02 (status, `Content-Type` e corpo), RF-04, RF-05, RF-06 (com a opção desligada, a resposta continua igual)
- Depende de: T-01, T-03
- Aceite: trocar a assinatura de `errorResponse` para `(error, config, errHeaders?)` (D-04) e atualizar o único call site (`src/response.ts:173`) para `errorResponse(error, config, errHeaders)`. Criar `problemHeaders` com `content-type: application/problem+json` ao lado de `jsonHeaders` (D-06). Quando `config.problemDetails` é verdadeiro, usar `problemHeaders` como base e `toProblemDetails(error)` como corpo, sem `stack`, inclusive com `debug` (D-05). Quando é falso, manter `jsonHeaders`, `error.toJSON()` e o campo `stack` com `debug` exatamente como hoje. A precedência de `error.headers` e `errHeaders` continua valendo. Antes da mudança, os testes de T-05 para o caminho ligado devem falhar; depois, `pnpm vitest run test/errors.test.ts` passa sem alterar nenhuma asserção.
- Arquivos: `src/response.ts`

### T-05 — Testes de integração de problem details nos dois modos

- Cobre: RF-02, RF-04, RF-05, RF-06
- Depende de: T-04
- Aceite: completar `test/problem-details.test.ts` com `describeMatrix` (web e node), cobrindo:
  - RF-02: rota com `new HTTPError({ status: 404, message: "Usuário não encontrado" })` → status 404, `Content-Type: application/problem+json`, corpo com `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"`.
  - RF-04: `type` e `instance` definidos aparecem no corpo; sem `type`, `type: "about:blank"`; sem `instance`, a chave não aparece.
  - RF-05: `throw new Error("falha interna do banco")` com `debug: true` → status 500, `application/problem+json`, e o texto não aparece em `await res.text()`. Repetir com `throw "string"` (caminho de `toError`).
  - RF-06: com a opção desligada e `HTTPError` com `type`/`instance`, o `Content-Type` não é `application/problem+json` e o corpo não tem `type`/`instance`.
  - `onError` que devolve `undefined` → o problem details sai mesmo assim; `onError` que devolve `Response` → essa resposta substitui (R-09). Usar o padrão `withOnError` de `test/errors.test.ts`.
  - `HEAD` → sem corpo, `Content-Type` preservado.
  - `headers` do `HTTPError` mesclados, com `content-type` de `error.headers` ainda sobrescrevendo (D-06).
  - Alternar com `t.app.config.problemDetails = true` nos casos que precisam, como `test/errors.test.ts` faz com `onError`.
  Os casos ligados devem falhar antes de T-04. Todos passam depois. Comando: `pnpm vitest run test/problem-details.test.ts`.
- Arquivos: `test/problem-details.test.ts`

### T-06 — Verificação final e regressão

- Cobre: RF-06 (suíte existente sem alteração de asserções), e confirmação geral dos critérios de aceite
- Depende de: T-01, T-02, T-03, T-04, T-05
- Aceite: `test/errors.test.ts` e os demais arquivos existentes passam sem alteração (`git diff --stat test/` mostra só arquivos novos). `pnpm vitest run test/unit/package.test.ts` passa sem alteração (sem exports novos). `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` passam. `pnpm test` (suíte completa com cobertura) passa. Confirmar que nenhum arquivo novo tem mais de 200 linhas e que `src/response.ts` não aumentou além do necessário.
- Arquivos: nenhum arquivo de código novo; apenas verificação (`src/response.ts`, `src/error.ts`, `src/h3.ts`, `src/types/h3.ts`, `src/utils/internal/problem.ts`, `test/`)
