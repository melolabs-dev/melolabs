# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Referências: `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (D-01 a D-09, seção 5 de testes).

Ordem sugerida pelo fluxo de correção de bug do AGENTS.md: testes antes da implementação. T-01 e T-02 fixam o comportamento; T-03 a T-05 implementam; T-06 verifica.

### T-01 — Baseline de regressão com a opção desligada

**Cobre:** RF-01, RF-10

Antes de qualquer mudança, garantir que o formato atual (`application/json;charset=UTF-8` e corpo de `toJSON()` + `stack`) fica registrado em testes. Cobrir o caso sem `problemDetails` e com `problemDetails: false` (techspec §5, caso 1), usando `describeMatrix` em `test/errors.test.ts`. A suíte existente deve passar sem alteração.

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/errors.test.ts` passa antes de qualquer alteração em `src/`; os novos casos passam nos modos `web` e `node`; nenhum teste existente foi editado.

**Arquivos:** `test/errors.test.ts`

### T-02 — Testes de problem details escritos antes da implementação

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

Criar o bloco `describe("problem details")` em `test/errors.test.ts`, após o bloco `"non-Error throws"` (techspec §5, casos 2 a 17). Incluir:

- status 404 e `application/problem+json` (RF-02);
- corpo exato `{"type":"about:blank","title":"Not Found","status":404,"detail":"Usuário não existe"}`, sem `message` (RF-03);
- ausência de `title` sem `statusText` (RF-03);
- `type` e `instance` no corpo, `instance` ausente quando não definido, `type` padrão `about:blank` (RF-05);
- `data` e `body` na raiz, sem `stack` com `debug: false`; com `stack` com `debug: true` (RF-06);
- precedência dos membros RFC sobre `body` com `status`, `type`, `detail` (D-06, R-03);
- erro `new Error("senha do banco: 123")` → 500, `about:blank`, sem o texto do erro, sem `detail` e `title` (RF-07), inclusive com `type` no `Error` e com `throw` de objeto;
- headers: `www-authenticate` preservado e `application/problem+json` prevalecendo sobre `content-type` do erro e de `errHeaders` (RF-08, D-07);
- `onError` devolvendo `HTTPError` → 503 com `detail` (RF-09); devolvendo `{ ok: false }` → `application/json` (RF-09);
- `set-cookie` sem duplicação quando `onError` devolve erro (techspec caso 17).

Confirmar com `pnpm vitest run test/errors.test.ts` que os casos novos **falham** antes da implementação (T-03 a T-05 ainda não feitas). O falhar deve vir do comportamento ausente, não de erro de sintaxe no teste.

**Depende de:** T-01

**Aceite:** os casos de RF-02 a RF-09 existem nos dois modos (`web` e `node`); a execução mostra falhas pelos motivos esperados; nenhum caso existente foi alterado.

**Arquivos:** `test/errors.test.ts`

### T-03 — Opção `problemDetails` em `H3Config`

**Cobre:** RF-01

Adicionar `problemDetails?: boolean` em `H3Config` com JSDoc e `@default false`, logo após `silent` (techspec §4.1). `H3CoreConfig` herda a opção sem alteração. Não criar outro nome público.

**Depende de:** nenhuma

**Aceite:** `pnpm typecheck` passa; `H3Config["problemDetails"]` é `boolean | undefined` (opcionalmente um caso em `test/unit/types.test-d.ts`, techspec §5 caso 19); `src/index.ts` não muda.

**Arquivos:** `src/types/h3.ts`, `test/unit/types.test-d.ts`

### T-04 — `type` e `instance` em `ErrorInput` e `HTTPError`

**Cobre:** RF-04

Em `src/error.ts`:

- `type?: string` e `instance?: string` em `ErrorInput`, com comentário RFC 9457;
- `readonly type: string | undefined` e `readonly instance: string | undefined` em `HTTPError`, no mesmo estilo de `statusText`;
- atribuição no construtor via `optionalString(...)`, que aceita só string não vazia (D-04), lendo apenas `details`, nunca `details.cause` (D-05);
- helper `optionalString` no fim do arquivo;
- `toJSON()` sem nenhuma mudança (P4) e `ErrorBody` sem mudança (D-04).

Cobrir com casos de construtor (sem HTTP): valores informados, campos omitidos → `undefined`, `type: 42` e `""` → `undefined`, `cause` com `type` não herdado, `new HTTPError(existingHttpError)` preserva os campos (R-07).

**Depende de:** nenhuma

**Aceite:** `err.type` e `err.instance` retornam os valores do exemplo de RF-04; `JSON.stringify(err)`/`toJSON()` não ganha as chaves `type` e `instance` quando não estão no corpo de `toJSON()`; `pnpm vitest run test/errors.test.ts test/unit` passa nos casos de construtor.

**Arquivos:** `src/error.ts`, `test/errors.test.ts`

### T-05 — Renderização de problem details em `errorResponse`

**Cobre:** RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08, RF-09

Em `src/response.ts`:

- trocar a assinatura de `errorResponse(error, debug?, errHeaders?)` por `errorResponse(error, config, errHeaders?)` e atualizar o único chamador em `src/response.ts:173` (D-03, R-09; confirmar com `grep` que não há outro chamador);
- quando `config.problemDetails` estiver ligado, montar o corpo com a função interna não exportada `problemBody(error, debug)` na ordem da D-06: extensões (`data`, `...error.body`) só se não `unhandled`; depois `type`, `title`, `status`, `detail`, `instance`; por último `stack` com `debug`;
- definir `content-type` como `application/problem+json`, sem `charset`, por último, depois de mesclar `error.headers` e `errHeaders` (D-07, P5);
- com a opção desligada, a saída e os headers permanecem idênticos aos atuais (`{ ...error.toJSON(), stack }` e `jsonHeaders`), com diff mínimo;
- `status` do `Response` continua vindo de `error.status` (RF-02);
- `h3.ts` e `handler.ts` não mudam (D-09).

**Depende de:** T-02, T-03, T-04

**Aceite:** todos os casos de T-02 passam nos modos `web` e `node`; os casos de T-01 continuam passando; `pnpm vitest run test/errors.test.ts` passa por completo; erro `unhandled` com `type` no `Error` não expõe o `type` (D-06).

**Arquivos:** `src/response.ts`

### T-06 — Verificação de qualidade e de regressão

**Cobre:** RF-10

Rodar a verificação completa e revisar o impacto colateral:

- `pnpm vitest run test/errors.test.ts test/unit`;
- `pnpm test` (lint, typecheck e cobertura), incluindo `oxlint . && oxfmt --check .` e `tsc --noEmit`;
- `pnpm build`, para confirmar `test/dist.test.ts` (R-11);
- conferir snapshots que possam ter ganho as chaves novas de `HTTPError` (R-08);
- conferir cobertura dos ramos `problemBody` com e sem `unhandled` e de `optionalString` com valor não string;
- `grep` por `errorResponse` para confirmar o único chamador.

Qualquer falha de teste existente é tratada como quebra de RF-01 e corrigida no código, não ajustando o teste (techspec §5 caso 18). Se algum ajuste de teste existente for inevitável, registrar qual e por quê.

**Depende de:** T-05

**Aceite:** `pnpm test` passa por completo; `pnpm build` termina sem erro; o relatório final lista os comandos executados e seus resultados.

**Arquivos:** `test/errors.test.ts`, `test/unit/types.test-d.ts`, `src/response.ts`, `src/error.ts`, `src/types/h3.ts`

---

## Decisões em aberto (não são tarefas de código)

Estas escolhas da techspec (§7) devem ser confirmadas antes do merge. A implementação segue a recomendação indicada até haver confirmação:

1. D-05: `type` e `instance` não herdam de `cause`.
2. D-06: `title` omitido quando não há `statusText`, inclusive em 500 não tratados (R-02, contraria o "SHOULD" da RFC).
3. D-04: string vazia para `type`/`instance` é tratada como ausente.
4. D-06: `detail` omitido, e não `"HTTPError"`, em erros `unhandled`.
5. D-09: `defineHandler(...).fetch` continua sem `problemDetails`.
