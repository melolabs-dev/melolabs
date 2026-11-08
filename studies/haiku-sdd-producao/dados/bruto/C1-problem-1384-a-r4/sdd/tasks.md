# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09, §5 de testes).

Ordem de execução: T-01 e T-03 podem rodar em paralelo. Os testes de T-01 são escritos antes de qualquer mudança em `src/`, conforme o Bug Fix Workflow do `AGENTS.md`.

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 — opção `problemDetails` em `H3Config` | T-02, T-08 |
| RF-02 — sem a opção, resposta não muda | T-01, T-09 |
| RF-03 — `application/problem+json` com campos RFC 9457 | T-04, T-06, T-07, T-08 |
| RF-04 — `HTTPError` aceita e expõe `type` e `instance` | T-03, T-08 |
| RF-05 — `type` padrão `"about:blank"` | T-04 |
| RF-06 — erros não-`HTTPError` também seguem o formato | T-04, T-07 |
| RF-07 — erros não tratados não vazam detalhes | T-05 |
| RF-08 — `data` e `body` preservados como extensão | T-05 |
| RF-09 — testes e qualidade | T-09 |

---

### T-01 — Testes do formato padrão antes de qualquer mudança em `src/`

Cobre: RF-02
Depende de: nenhuma

Criar `test/problem-details.test.ts` com `describeMatrix`. Cobrir: com a opção desligada, uma rota que lança `HTTPError` 404 responde status 404, `Content-Type` `application/json;charset=UTF-8` e corpo igual ao que o código atual produz (`HTTPError.toJSON()` mais `stack` só com debug, conforme `src/response.ts`).

Aceite: `pnpm vitest run test/problem-details.test.ts` passa no código atual, antes de T-02. `test/errors.test.ts` continua sem edição.

Arquivos: `test/problem-details.test.ts` (novo)

---

### T-02 — Opção `problemDetails` em `H3Config`

Cobre: RF-01
Depende de: T-01

Adicionar `problemDetails?: boolean` a `H3Config` em `src/types/h3.ts`, com JSDoc no mesmo estilo de `debug` e `silent`. A opção entra em `app.config` sem mudança adicional, porque `H3CoreConfig` é `Omit<H3Config, "plugins">`.

Aceite: em `test/problem-details.test.ts`, um app novo tem `app.config.problemDetails` ausente ou falso. `pnpm typecheck` passa.

Arquivos: `src/types/h3.ts`, `test/problem-details.test.ts`

---

### T-03 — `HTTPError` aceita e expõe `type` e `instance`

Cobre: RF-04
Depende de: nenhuma

Adicionar `type?: string` e `instance?: string` a `ErrorBody` em `src/error.ts`, com JSDoc (RFC 9457 §3.1.1 e §3.1.5). Declarar `readonly type` e `readonly instance` em `HTTPError`. No construtor, ler os dois campos somente quando `details` é um objeto de entrada que não é `Error`, e aceitar somente valores `string` (D-03). `toJSON()` não muda.

Aceite: em `test/unit/error.test.ts` (novo, sem `describeMatrix`):
- `new HTTPError({ status: 403, type, instance })` expõe os dois valores na instância;
- campos ausentes resultam em `undefined`;
- `type: 42` é ignorado;
- `new HTTPError(new Error("x"))` com `error.type = "entity.parse.failed"` resulta em `type` `undefined`;
- `toJSON()` não contém `type` nem `instance`.

O caso de `throw { type: "x" }` numa rota fica em `test/problem-details.test.ts` (T-04), caso `toError` não seja exportado. Tipo opcional em `test/unit/types.test-d.ts`, confirmando que `ErrorBody` aceita `type` e `instance`.

Arquivos: `src/error.ts`, `test/unit/error.test.ts` (novo), `test/unit/types.test-d.ts` (opcional)

---

### T-04 — Renderização em `application/problem+json`

Cobre: RF-03, RF-05, RF-06
Depende de: T-02, T-03

Em `src/response.ts`:
- adicionar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`, D-06), ao lado de `jsonHeaders`;
- adicionar a função interna `toProblemDetails(error, debug)` (contrato em techspec §4.3), sem `export`;
- `errorResponse` passa a receber `config: H3Config` em vez de `debug`, e `prepareResponse` (linhas ~172-173) passa `config`;
- o ramo padrão mantém a forma atual de `errorResponse`.

`title` vem de `statusText` e é omitido quando ausente (D-04). `detail` vem de `message`. `type` ausente vira `"about:blank"`.

Aceite: em `test/problem-details.test.ts`, com a opção ligada:
- `HTTPError` 404 com `statusText` e `message` responde 404, `application/problem+json`, `title: "Not Found"` e `detail` igual à mensagem;
- `HTTPError` 500 sem `type` tem `type: "about:blank"`;
- `new Error("falha inesperada")` responde 500 com `application/problem+json`;
- `HTTPError` sem `statusText` não tem a chave `title`.

Os testes de T-01 continuam passando.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-05 — Campos de extensão, precedência e ocultação de erros não tratados

Cobre: RF-07, RF-08
Depende de: T-04

Ajustar `toProblemDetails` para a ordem de D-05: membros de `error.body` e `data` (quando não `unhandled`), depois os reservados (`type`, `title`, `status`, `detail`, `instance`), que prevalecem, e `stack` só com `debug`. Para `unhandled`, não há `detail`, `data` nem `body`.

Aceite: em `test/problem-details.test.ts`:
- com `t.app.config.debug = false` e um erro não tratado com a mensagem `"segredo interno"`, a resposta é 500 e o corpo não contém essa mensagem nem `stack`;
- `HTTPError` 422 com `data: { campo: "email" }` e `body` tem `data` no corpo, além de `type`, `title`, `status`, `detail`;
- `body` com as chaves `status` e `type` não sobrescreve os reservados;
- com `debug` ligado, `stack` está presente.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

---

### T-06 — Headers, `onError`, HEAD, cache, SSE e `kNotFound` com problem details

Cobre: RF-03
Depende de: T-04

Cobrir os riscos de interação do PRD e da techspec §5.1 com a opção ligada.

Aceite: em `test/problem-details.test.ts`:
- `error.headers` (ex.: `x-error-own`) e `errHeaders` continuam na resposta;
- `set-cookie` de `errHeaders` aparece uma vez (regressão de `src/response.ts`);
- resposta HEAD não tem corpo nem `content-length`;
- `onError` roda antes da renderização e, se retornar `Response`, essa resposta substitui o formato;
- rota inexistente (`kNotFound`) responde em problem details;
- erros passados por `handleCacheHeaders`/`withCacheIsolation` e por event stream (SSE) mantêm o comportamento atual.

Se algum teste revelar falha, corrigir em `src/response.ts` com a menor mudança possível.

Arquivos: `test/problem-details.test.ts`, `src/response.ts` (somente se necessário)

---

### T-07 — Propagar a opção para `toResponse` aninhados

Cobre: RF-03, RF-06
Depende de: T-04

Em `src/utils/middleware.ts:26` e `src/rules/cache.ts:314`, passar somente a opção: `toResponse(rawBody, event, { problemDetails: event.app?.config.problemDetails })` (D-07). Não passar o config inteiro, para o `onResponse` do app não rodar duas vezes. `src/handler.ts:122,124` não muda; o caminho sem app fica documentado (R-04).

Aceite: em `test/problem-details.test.ts`, um handler que retorna (não lança) um `HTTPError` com um `onResponse` middleware responde em `application/problem+json`. Um caso de `h3/rules/cache` que retorna `HTTPError` também responde em problem details, em `test/rules/` se houver fixture de cache, ou em teste unitário do módulo.

Arquivos: `src/utils/middleware.ts`, `src/rules/cache.ts`, `test/problem-details.test.ts`, `test/rules/` (se aplicável)

---

### T-08 — Documentação

Cobre: RF-01, RF-03, RF-04
Depende de: T-03, T-04

- `docs/1.guide/900.api/1.h3.md` (~linha 111): incluir `problemDetails` na lista de opções do app.
- `docs/1.guide/1.basics/6.error.md` (~linha 51): documentar `type` e `instance` nos campos do `HTTPError`, o formato problem details, a mudança de `Content-Type` (risco R-05), a precedência de `data`/`body` e a limitação do `handler.ts` sem app (R-04).

Aceite: `pnpm lint` passa com as docs alteradas. As descrições batem com o comportamento testado em T-04 a T-07.

Arquivos: `docs/1.guide/900.api/1.h3.md`, `docs/1.guide/1.basics/6.error.md`

---

### T-09 — Verificação final

Cobre: RF-09
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08

Rodar `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` (suíte completa). Revisar o diff de `test/`.

Aceite: os três comandos terminam sem erro. `git diff test/errors.test.ts` vazio. Nenhum teste existente removido ou enfraquecido; qualquer ajuste em teste existente tem motivo claro no diff (PRD, Riscos). Reportar a saída dos comandos, sem resumir falhas.

Arquivos: nenhum arquivo de código; apenas execução de comandos e revisão do diff. `test/errors.test.ts` não deve ser editado.
