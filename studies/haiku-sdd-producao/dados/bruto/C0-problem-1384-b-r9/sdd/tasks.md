# Tarefas de implementação — Problem Details (RFC 9457) como formato padrão de erro

Origem: `sdd/prd.md` e `sdd/techspec.md`. Seguir o fluxo de correção do AGENTS.md: os testes (T-01 a T-03) vêm primeiro e devem falhar antes de qualquer mudança em `src/`.

## Testes primeiro

### T-01 — Escrever os testes de runtime de problem details
Criar `test/problem-details.test.ts` com `describeMatrix` (web e node), um grupo por requisito, conforme techspec §6:
- RF-01: `HTTPError({ status: 400 })`, erro não tratado (`throw new Error`) e `kNotFound` respondem com `content-type` `application/problem+json`.
- RF-02: exemplo do PRD (404 com `statusText` e `message`); 409 sem `statusText` ⇒ `title: "Conflict"`; status sem frase ⇒ sem `title`.
- RF-03: `error.type`/`error.instance` via `new HTTPError(details)`, `new HTTPError(msg, details)` e `HTTPError.status(...)`; ausentes ⇒ `undefined`; valor não string ignorado.
- RF-04: `type`/`instance` aparecem no corpo; sem `instance` a chave não existe.
- RF-05: `body: { code, status: 999, type: "x", title: "y" }` + `data` ⇒ `code` e `data` presentes, `status` real, `type`/`title` padrão.
- RF-06: corpo traz `statusText`, `message`, `status` além de `type`/`title`/`detail`; teste unitário de `toJSON()` com `toEqual` das chaves.
- RF-07: `throw new Error("segredo interno")` com `debug` desligado ⇒ 500, problem+json, sem o texto nem `stack`; erro de lib com `type: "entity.too.large"` e `instance` ⇒ `type` `about:blank` e sem `instance`; `HTTPError` com `unhandled: true`, `data` e `body` ⇒ nada exposto; `debug` ligado ⇒ `stack` presente.
- RF-08: `headers: { "x-custom": "1" }` preservado, `statusText` na linha de status, HEAD com corpo vazio, `content-type` do usuário ainda vence, `errHeaders` aplicados, 204/304 sem corpo.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/problem-details.test.ts` roda nos modos web e node e os testes novos **falham** (exceto os que já valem hoje, como `headers` preservados), confirmando que reproduzem a lacuna. Há ao menos um teste por RF-01 a RF-08.
Arquivos: `test/problem-details.test.ts`

### T-02 — Escrever os testes de tipos para `type` e `instance`
Em `test/unit/types.test-d.ts`: `expectTypeOf<HTTPError["type"]>().toEqualTypeOf<string | undefined>()`, idem `instance`; `ErrorInput` e `ErrorBody` aceitam os campos como `string` opcional e rejeitam `number` (`@ts-expect-error`).

Cobre: RF-03, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run --typecheck test/unit/types.test-d.ts` (ou `pnpm typecheck`) falha antes de T-04 por falta dos campos e passa depois.
Arquivos: `test/unit/types.test-d.ts`

### T-03 — Ajustar os testes existentes que fixam o formato antigo
- `test/errors.test.ts:44`: `toBe("application/json;charset=UTF-8")` ⇒ `toBe("application/problem+json")`, mantendo a verificação de que o content-type de erro é o do erro e não o de sucesso.
- `test/errors.test.ts:140`: `toMatch("application/json")` ⇒ `toMatch("application/problem+json")`.
- Conferir que os demais testes de erro (`toMatchObject`) seguem válidos e que nenhum `toEqual` de corpo de erro escapou.

Cobre: RF-01, RF-08, RF-09
Depende de: nenhuma
Aceite: os dois testes ajustados falham antes de T-06 e passam depois; nenhuma asserção foi removida, só o content-type esperado mudou.
Arquivos: `test/errors.test.ts`

## Implementação

### T-04 — Adicionar `type` e `instance` a `ErrorBody` e `HTTPError`
Em `src/error.ts`:
- `ErrorBody`: `type?: string` e `instance?: string`, com JSDoc (`ErrorInput` herda via `Partial<ErrorBody>`).
- `HTTPError`: `readonly type: string | undefined` e `readonly instance: string | undefined`.
- Construtor: atribuir a partir de `details` apenas quando `typeof === "string"`, nunca de `details.cause` (D-05), junto a `data`/`body`. Cobre `new HTTPError(details)` e `new HTTPError(message, details)`; `HTTPError.status(...)` já repassa por spread, sem mudança de código.

Cobre: RF-03
Depende de: T-01, T-02
Aceite: os testes de RF-03 de T-01 e os testes de tipos de T-02 passam; `pnpm typecheck` sem erros; nenhum export novo em `src/index.ts` (snapshot de `test/unit/package.test.ts` inalterado).
Arquivos: `src/error.ts`

### T-05 — Criar a tabela interna de frases de status
Criar `src/utils/internal/status-text.ts` com a tabela das frases padrão (RFC 9110) dos status 4xx e 5xx e `export function getStatusPhrase(status: number): string | undefined`. Sem export público, fora de `src/index.ts`; status fora da tabela retorna `undefined`. Não alterar `STATUS_TEXT` de `src/utils/response.ts`.

Cobre: RF-02
Depende de: nenhuma
Aceite: `getStatusPhrase(409) === "Conflict"`, `getStatusPhrase(500) === "Internal Server Error"` e `getStatusPhrase(200) === undefined`; arquivo com menos de 200 linhas; `pnpm lint` passa.
Arquivos: `src/utils/internal/status-text.ts`

### T-06 — Estender `HTTPError#toJSON()` e trocar o content-type de erro
- `src/error.ts`, `toJSON()` (D-02, D-03, D-05): ordem de composição legados → extensões de `body` → membros padrão (`type` com `"about:blank"` por padrão, `title` com `statusText` ou `getStatusPhrase`, `status`, `detail`, `instance`). Para `unhandled`: `type` sempre `"about:blank"`, `detail` `"HTTPError"`, sem `instance`, `data` nem `body`. Tipo de retorno explícito, sem nome público novo (`isolatedDeclarations`).
- `src/response.ts`: definir `problemHeaders` (`FrozenHeaders`, `application/problem+json` sem `charset`) ao lado de `jsonHeaders` e usá-lo em `errorResponse`. `error.headers` e `errHeaders` continuam aplicados depois por `mergeHeaders`; `stack` só em debug.

Cobre: RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-04, T-05
Aceite: `pnpm vitest run test/problem-details.test.ts test/errors.test.ts` passa nos modos web e node, incluindo os testes de T-01 e T-03; a saída do exemplo do techspec §4 (404) bate exatamente; `HEAD`, 204 e 304 seguem sem corpo.
Arquivos: `src/error.ts`, `src/response.ts`

## Documentação e verificação final

### T-07 — Documentar o novo formato de erro
Em `docs/1.guide/1.basics/6.error.md`: novo exemplo de resposta, campos `type` e `instance`, nota sobre a mudança de content-type para `application/problem+json`, sobre a precedência dos membros padrão sobre as chaves de `body` e sobre os campos ocultos em erros `unhandled`.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-07
Depende de: T-06
Aceite: o exemplo da doc coincide com a saída real de `toJSON()`; `pnpm fmt` não gera diff pendente nem erro de lint no arquivo.
Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-08 — Validação completa da suíte
Rodar `pnpm test` (lint + typecheck + cobertura) e `pnpm build`; corrigir regressões em testes que dependam do formato de erro, ajustando só o que depende da mudança. Conferir o tamanho do bundle no build e que `test/unit/package.test.ts` não mudou.

Cobre: RF-09
Depende de: T-03, T-06, T-07
Aceite: `pnpm test` e `pnpm build` terminam sem falhas; existe ao menos um teste novo por RF-01 a RF-08 nos modos web e node.
Arquivos: nenhum (apenas verificação; eventuais ajustes em `test/` pontuais)
