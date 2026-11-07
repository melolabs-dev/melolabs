# Tarefas — Problem details (RFC 9457) como formato padrão de erro no h3

Referências: `sdd/prd.md` (RF-01..RF-09) e `sdd/techspec.md` (D-01..D-08). Fluxo do `AGENTS.md`: testes primeiro (T-01), confirmar que falham, implementar (T-02..T-06), confirmar que passam.

### T-01 — Escrever os testes novos e ajustar os existentes (devem falhar antes da implementação)

Em `test/errors.test.ts`, trocar `application/json…` por `application/problem+json…` nas linhas 44 e 140 e adicionar um `describeMatrix` com um teste por requisito, conforme a seção 5 da techspec:

- RF-01: 404 com `message` próprio. Verifica `status`, `title` não vazio e `detail` igual à mensagem, sem as chaves `type` e `instance`.
- RF-02: `content-type` começa com `application/problem+json`. Respostas que não são erro seguem `application/json`.
- RF-03: `type` e `instance` via objeto, `HTTPError.status(...)`, `new HTTPError(msg, details)` e `cause`. Valem `undefined` quando omitidos.
- RF-04: corpo e `toJSON()` com `type` e `instance`. Ausentes ficam sem chave e sem `null`.
- RF-05: `data` sob `data`, `codigo` no topo e `body` com `status`, `title` e `type` sem efeito sobre os membros padrão.
- RF-06: `throw new Error("segredo interno")` fora de debug não vaza texto nem `stack`, e `detail` não contém a mensagem. Em debug o `stack` está presente.
- RF-07: 401 com `statusText` e `www-authenticate`. HEAD e 304 continuam sem corpo.
- RF-08: rota inexistente, `readValidatedBody`, `BodyTooLargeError` (via `bodyLimit`/`assertBodySize`), `requireBasicAuth` e `onError` que não sobrescreve. Todos com `status`, `title` e `detail`.
- Status incomuns (418, 499, 599) para o fallback de `title`.

Criar também um teste unitário em `test/unit/` de `toProblemDetails` com objeto "ErrorLike" externo (sem `title`, `data`, `body`, `unhandled`), como o do srvx (D-01), e de `type`/`instance` sem servidor.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/errors.test.ts test/unit/` roda e os testes novos e os dois ajustados **falham** pelo motivo esperado (formato antigo). Os testes antigos de `message`/`unhandled`/`statusText` continuam passando.
Arquivos: `test/errors.test.ts`, `test/unit/problem.test.ts` (novo)

### T-02 — Tabela interna de texto padrão por status

Criar `src/utils/internal/status-text.ts` com `Record<number, string>` dos códigos 1xx–5xx comuns da RFC 9110 e uma função interna de fallback por classe (`"Client Error"`, `"Server Error"`, `"Error"`). Não exportar em `src/index.ts` e não alterar `STATUS_TEXT` de `src/utils/response.ts`.

Cobre: RF-01, RF-06
Depende de: nenhuma
Aceite: `pnpm lint` passa. O arquivo tem menos de 200 linhas e nenhum export público novo (`test/unit/package.test.ts` e `test/unit/meta.test.ts` seguem verdes). 404 resolve para `"Not Found"` e 418, 499 e 599 caem no texto correto ou no fallback.
Arquivos: `src/utils/internal/status-text.ts` (novo)

### T-03 — Campos `type` e `instance` em `ErrorBody` e `HTTPError`

Em `src/error.ts`: adicionar `type?: string` e `instance?: string` (com JSDoc RFC 9457) a `ErrorBody`, o que `ErrorInput` herda via `Partial<ErrorBody>`. Adicionar `readonly type: string | undefined` e `readonly instance: string | undefined` a `HTTPError`. Atribuí-los no construtor a partir de `details` ou `details.cause`, aceitando só `typeof === "string"`, junto de `data`/`body`. Isso cobre `HTTPError.status(...)`, `new HTTPError(message, details)` e `cause`. Não criar export novo em `src/index.ts`.

Cobre: RF-03, RF-09
Depende de: nenhuma
Aceite: `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/contas/42" })` expõe exatamente esses valores e ambos são `undefined` quando omitidos. Valores não-string vindos de `cause` são ignorados. Os testes de RF-03 de T-01 passam e `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-04 — Serializador interno `toProblemDetails`

Criar `src/utils/internal/problem.ts` com `toProblemDetails(error)` (D-01, D-02, D-04, D-05), lendo apenas campos públicos de forma defensiva:

- `title` vem de `statusText`, senão do texto padrão (T-02), senão `"Error"`.
- `detail` vem de `message` quando o erro é tratado. Quando `unhandled`, `detail` usa o `title`, `message` vira `"HTTPError"` e `data`/`body` não são emitidos.
- `type` e `instance` só entram se forem strings definidas. Não emitir `"about:blank"`.
- Extensões de compatibilidade `message`, `statusText`, `unhandled` e `data` ficam como hoje. Ordem: `{...compat, ...body}` e, por último, `type`/`title`/`status`/`detail`/`instance`, de modo que `body` não sobrescreve membros padrão e a chave `body.type` é descartada se o erro não define `type`.
- Chaves ausentes são omitidas, não `undefined`.
- `stack` não entra aqui, fica em `errorResponse`.

Cobre: RF-01, RF-04, RF-05, RF-06, RF-08
Depende de: T-02, T-03
Aceite: o teste unitário de `toProblemDetails` (incluindo "ErrorLike" externo sem `title`/`data`/`body`), RF-01, RF-05 e RF-06 de T-01 passam. Com `new Error("segredo interno")` nenhum membro contém o texto.
Arquivos: `src/utils/internal/problem.ts` (novo)

### T-05 — `HTTPError#toJSON()` delega ao serializador

Em `src/error.ts`, fazer `toJSON()` delegar a `toProblemDetails(this)`. Atualizar o tipo de retorno com o tipo inline da techspec §4 (`Omit<ErrorBody, "body"> & { title: string; detail: string } & ErrorBody["body"]`), sem criar nome público e respeitando `isolatedDeclarations`.

Cobre: RF-04, RF-05, RF-09
Depende de: T-04
Aceite: `toJSON()` e o corpo da resposta produzem o mesmo objeto para instâncias de `HTTPError`. Contém `type` e `instance` quando definidos e não os contém (nem `null`) quando ausentes. `pnpm typecheck` passa.
Arquivos: `src/error.ts`

### T-06 — `errorResponse` com `application/problem+json`

Em `src/response.ts`: adicionar a constante congelada `problemHeaders` (`application/problem+json;charset=UTF-8`) ao lado de `jsonHeaders`, sem alterar `jsonHeaders`. Em `errorResponse`, usar `problemHeaders` e `toProblemDetails(error)` em vez de `error.toJSON()`. Manter `stack` e indentação só em debug, a mesclagem de `error.headers`/`errHeaders` por cima (um `content-type` próprio do erro vence), `status`/`statusText` e as respostas sem corpo (HEAD, 204, 304). Não alterar `h3/rules`, `proxy`, `json-rpc` nem respostas devolvidas por `onError` do usuário.

Cobre: RF-02, RF-06, RF-07, RF-08
Depende de: T-04
Aceite: todos os testes novos de T-01 passam, incluindo 404, validação, `BodyTooLargeError`, `requireBasicAuth` e `onError` sem sobrescrita. Respostas que não são erro mantêm `application/json` (`test/security.test.ts` e `test/proxy.test.ts` inalterados e verdes). HEAD/304 continuam sem corpo. Em debug o `stack` aparece e fora dele não.
Arquivos: `src/response.ts`

### T-07 — Testes de tipos públicos

Adicionar ao fim de `test/unit/types.test-d.ts` asserções de que `ErrorInput` aceita `type`/`instance` como `string`, de que `HTTPError` os expõe como `string | undefined` somente leitura e de que `src/index.ts` não ganhou export novo.

Cobre: RF-03, RF-09
Depende de: T-03
Aceite: `pnpm typecheck` e `pnpm vitest run test/unit/` passam, e atribuir a `error.type` é erro de tipo.
Arquivos: `test/unit/types.test-d.ts`

### T-08 — Documentação do formato de erro

Atualizar `docs/1.guide/1.basics/6.error.md`:

- novo JSON de exemplo (linhas 37-49);
- campos `type` e `instance` (53-60, 76, 90);
- nota sobre `application/problem+json`;
- nota de compatibilidade: `message`, `statusText` e `unhandled` mantidos como extensões, `detail`/`message` com o mesmo texto, e a mudança de `content-type` como alteração visível ao usuário, sem opção de desativar.

Cobre: RF-09
Depende de: T-05, T-06
Aceite: os exemplos do documento batem com a saída real dos testes. `pnpm fmt` não gera diferenças depois de aplicado e `pnpm lint` passa.
Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-09 — Validação final e regressões

Rodar `pnpm vitest run` (suíte completa), `pnpm lint` e `pnpm typecheck`. Revisar falhas por `content-type` ou formato de corpo em `test/status.test.ts`, `test/validate.test.ts`, `test/body-limit.test.ts`, `test/auth.test.ts`, `test/handler.test.ts`, `test/query.test.ts` e `test/proxy.test.ts`, ajustando só o que verifica o formato antigo sem perder o que verificam. Conferir `test/dist.test.ts`, `test/unit/package.test.ts` e `test/unit/meta.test.ts` (nenhum export público novo, bundle sem crescimento relevante). Confirmar que existe ao menos um teste para cada RF-01..RF-08.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-01, T-05, T-06, T-07, T-08
Aceite: `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` terminam sem falhas, e `git diff --stat` mostra só os arquivos listados nas tarefas.
Arquivos: `test/status.test.ts`, `test/validate.test.ts`, `test/body-limit.test.ts`, `test/auth.test.ts`, `test/handler.test.ts`, `test/query.test.ts`, `test/proxy.test.ts` (somente se alguma asserção do formato antigo falhar)

## Matriz de cobertura

| Requisito | Tarefas                            |
| --------- | ---------------------------------- |
| RF-01     | T-01, T-02, T-04, T-09             |
| RF-02     | T-01, T-06, T-09                   |
| RF-03     | T-01, T-03, T-07, T-09             |
| RF-04     | T-01, T-04, T-05, T-09             |
| RF-05     | T-01, T-04, T-05, T-09             |
| RF-06     | T-01, T-02, T-04, T-06, T-09       |
| RF-07     | T-01, T-06, T-09                   |
| RF-08     | T-01, T-04, T-06, T-09             |
| RF-09     | T-01, T-03, T-05, T-07, T-08, T-09 |
