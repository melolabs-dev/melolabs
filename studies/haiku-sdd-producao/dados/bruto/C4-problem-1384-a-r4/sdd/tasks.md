# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-09).

Ordem: os testes são escritos antes das mudanças em `src/` (fluxo de correção do `AGENTS.md`). Cada tarefa indica em `Depende de:` o que precisa estar pronto antes.

### T-01 — Testes de integração que definem o comportamento

**Cobre:** RF-01, RF-02, RF-03, RF-05
**Depende de:** nenhuma
**Aceite:** `test/problem-details.test.ts` criado com `describeMatrix`, cobrindo os casos 0 a 11 da techspec (estratégia de testes):
- caso 0: `app.config.problemDetails` é `false` ou ausente sem a opção, e `true` com `problemDetails: true`;
- caso 1: com a opção desligada, o corpo é igual a `HTTPError.toJSON()` e o `Content-Type` continua `application/json;charset=UTF-8`;
- casos 2 a 11: formato problem details, precedência, erros não tratados, `debug`, 404, HEAD, `onError`, validação e cabeçalhos.

Antes de qualquer mudança em `src/`, os casos 0 e 2 a 11 falham pelo motivo esperado, e o caso 1 passa (é a linha de base de regressão). Casos com `serve` criam app próprio. O caso 5 limpa `t.errors`.
**Arquivos:** `test/problem-details.test.ts`

### T-02 — Testes unitários de `HTTPError` e `toProblemDetails`

**Cobre:** RF-04, RF-05
**Depende de:** nenhuma
**Aceite:** `test/unit/problem-details.test.ts` criado, com:
- `type` e `instance` lidos da instância quando informados;
- ambos `undefined` quando ausentes;
- `type` não herdado de `cause` (`new HTTPError({ status: 500, cause: { type: "click" } })`);
- `type` não-string ignorado (`type: 42`);
- `toProblemDetails` com erro `unhandled`: sem `detail` original, sem `data`, sem `body`.

Antes da mudança, o arquivo falha ao importar `src/utils/internal/problem.ts` e os testes de `type`/`instance` falham, o que é esperado.
**Arquivos:** `test/unit/problem-details.test.ts`

### T-03 — Asserções de tipo para os campos novos

**Cobre:** RF-06
**Depende de:** nenhuma
**Aceite:** `test/unit/types.test-d.ts` ganha as asserções da techspec: `H3Config["problemDetails"]` é `boolean | undefined`; `ErrorInput["type"]` e `ErrorInput["instance"]` são `string | undefined`; `HTTPError` tem as propriedades `type` e `instance`. Inclui `// @ts-expect-error` para `problemDetails: "sim"`. Antes da mudança, `pnpm typecheck` acusa erro nessas linhas.
**Arquivos:** `test/unit/types.test-d.ts`

### T-04 — Opção `problemDetails` em `H3Config`

**Cobre:** RF-01, RF-06
**Depende de:** T-01, T-03
**Aceite:** `problemDetails?: boolean` adicionado em `H3Config` logo depois de `silent`, com o JSDoc da techspec (incluindo a menção à mudança de `Content-Type`). `new H3({ problemDetails: true })` passa no `pnpm typecheck`. O caso 0 de T-01 passa.
**Arquivos:** `src/types/h3.ts`

### T-05 — `type` e `instance` em `ErrorBody` e `HTTPError`

**Cobre:** RF-04, RF-06
**Depende de:** T-02, T-03
**Aceite:**
- `ErrorBody` ganha `type?: string` e `instance?: string` com JSDoc;
- `HTTPError` expõe `readonly type` e `readonly instance`, lidos só de `details`, e só se forem `string` (D-06);
- `toJSON()` mantém a mesma assinatura e a mesma saída (não inclui `type` nem `instance`);
- os testes unitários de `type`/`instance` passam em T-02 e `new HTTPError({ status: 400, type: "x", instance: "y" })` passa no typecheck.
**Arquivos:** `src/error.ts`

### T-06 — Helper interno `toProblemDetails`

**Cobre:** RF-03, RF-05
**Depende de:** T-05
**Aceite:** `src/utils/internal/problem.ts` criado, com a função `toProblemDetails(error)` da techspec (D-03 e D-04):
- membros padrão (`type` com `about:blank` como padrão, `title`, `status`, `detail`, `instance`) são escritos por último, então vencem `body` e `data`;
- `body` com chaves `type`, `title`, `status`, `detail` ou `instance` não altera esses campos;
- erro `unhandled` mostra `detail: "HTTPError"` e não mostra `data` nem `body`;
- o helper não é exportado por `src/index.ts`;
- o arquivo fica abaixo de 200 linhas.

Os testes unitários de T-02 passam por completo.
**Arquivos:** `src/utils/internal/problem.ts`

### T-07 — Ramo de formato em `errorResponse`

**Cobre:** RF-01, RF-02, RF-03, RF-05
**Depende de:** T-04, T-06
**Aceite:**
- `errorResponse` recebe `config: H3Config` no lugar de `debug?: boolean` e escolhe `problemJSONHeaders` ou `jsonHeaders` conforme `config.problemDetails` (D-02 e D-05);
- a única chamada, em `prepareResponse` (`src/response.ts:173` na referência), passa a ser `errorResponse(error, config, errHeaders)`;
- com a opção desligada, `test/errors.test.ts` e o caso 1 de T-01 passam sem alteração;
- com a opção ligada, os casos 2 a 11 de T-01 passam;
- `errHeaders` e `error.headers` continuam mesclados como hoje; `stack` aparece só com `debug`.

Confirmar com `grep` que `errorResponse` tem uma única chamada.
**Arquivos:** `src/response.ts`

### T-08 — Verificação de regressão e qualidade estática

**Cobre:** RF-07, RF-08
**Depende de:** T-07
**Aceite:**
- `pnpm vitest run` passa por completo;
- `pnpm typecheck` passa sem erros;
- `pnpm lint` passa. Rodar `pnpm typecheck` separadamente, porque o script `lint` em `package.json` não inclui o typecheck, apesar do que diz o `AGENTS.md`;
- se algum teste existente quebrar, o ajuste é o mínimo possível e a justificativa aparece no diff. A expectativa é não alterar nenhum teste existente;
- `pnpm test` (lint, typecheck e cobertura) é opcional e pode ser rodado no fim.

**Arquivos:** nenhum arquivo de código; apenas execução de comandos de verificação

---

## Pontos abertos (não bloqueiam a implementação)

As decisões abaixo seguem o padrão da techspec. O mantenedor pode mudar antes do merge.

1. **D-09:** manter `unhandled: true` no corpo problem (padrão desta lista). Se for removido, ajustar T-06 e o caso 5 de T-01.
2. **D-06:** `type` não é herdado de `cause` (padrão desta lista).
3. **Risco de `type`:** confirmar o uso do nome `type` em `ErrorInput`, como pede o PRD.
