# Tarefas de implementação — `problem()` (RFC 9457)

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, R-01 a R-09).
Fluxo do `AGENTS.md` em cada tarefa: escrever o teste, vê-lo falhar, implementar o mínimo, vê-lo passar. Imports com extensão `.ts`, sem barrel files, tipos exportados com anotação explícita (`isolatedDeclarations`).

### T-01 — Tabela interna de reason phrases

Criar `getStatusText(status)` com o mapa `status → texto` dos códigos IANA comuns (~60 entradas), devolvendo `undefined` para códigos desconhecidos. Sem dependência nova e sem `node:http` (D-05).

Cobre: RF-03
Arquivos: `src/utils/internal/status-text.ts` (novo), `test/unit/problem.test.ts` (novo, parte da tabela)
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/problem.test.ts` passa. O teste verifica `getStatusText(404) === "Not Found"`, `getStatusText(500) === "Internal Server Error"` e `getStatusText(599) === undefined`.

### T-02 — Módulo interno do formato problem details

Criar `kProblem = "~problem"`, o tipo `ProblemMark` (`type?`, `instance?`, `detail?`), `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json;charset=UTF-8`) e `problemBody(error, mark, debug?)`. O corpo segue a ordem de D-04: `type` (padrão `"about:blank"`), `title` (`statusText`, depois `getStatusText`, senão omitido), `status`, `detail` (só com mensagem explícita), `instance`, `data`, extensões de `body` e `stack` (só em `debug`). Chaves reservadas vindas de `body` são ignoradas; `body.data` só passa como extensão quando `data === undefined`. Com `error.unhandled`, emite só `type`, `title`, `status` e `instance` (D-06). Leitura tolerante a campos ausentes na marca (R-08).

Cobre: RF-03, RF-04, RF-05, RF-06
Arquivos: `src/utils/internal/problem.ts` (novo), `test/unit/problem.test.ts` (parte de `problemBody`)
Depende de: T-01
Aceite: o teste unitário, sem servidor, confirma: o corpo exato do exemplo do RF-03; `type` ausente vira `about:blank`; `statusText` customizado vira `title`; status fora da tabela omite `title`; sem mensagem explícita omite `detail`; sem `instance` omite `instance`; `body: { status: 1, type: "x" }` não sobrescreve os membros padrão; extensões e `data` aparecem no nível esperado; `unhandled` não contém `detail`, `data`, extensões nem `stack` fora do `debug`.

### T-03 — Função pública `problem()` e exportação

Criar `problem(input)` e `ProblemInput` (estende `ErrorInput<DataT>` com `type?: string` e `instance?: string`). A função captura a `message` explícita (string não vazia) antes do construtor, cria `new HTTPError({ ...input })` e define a propriedade não enumerável `~problem` com `{ type, instance, detail }` via `Object.defineProperty` (D-01, D-07). Adicionar JSDoc com as limitações (erro embrulhado em `cause` ou substituído por `onError` vira JSON comum; `type`/`instance` são responsabilidade do autor). Exportar `problem` e `type ProblemInput` em `src/index.ts` junto de `HTTPError`. Inserir `"problem",` entre `"parseCookies"` e `"proxy"` no snapshot de exportações. Confirmar que `src/_entries/*` reexportam `index.ts` por completo.

Cobre: RF-01, RF-02
Arquivos: `src/utils/problem.ts` (novo), `src/index.ts`, `test/unit/package.test.ts`, `test/problem.test.ts` (novo, casos de RF-01 e RF-02)
Depende de: T-02
Aceite: `pnpm vitest run test/problem.test.ts test/unit/package.test.ts` passa. `problem({ status: 404 })` é `HTTPError` com `status === 404` e `HTTPError.isError` verdadeiro. A entrada completa do RF-02 preserva `status`, `message`, `data` e `headers`. O snapshot de exportações inclui `problem`.

### T-04 — Bifurcação em `errorResponse`

Em `errorResponse`, ler `error["~problem"]`. Com a marca, usar `problemHeaders` como base e `problemBody(error, mark, debug)`; sem a marca, manter o caminho atual idêntico. A ordem de mescla dos cabeçalhos continua: base, depois `error.headers`, depois `errHeaders`. A chamada em `prepareResponse` e o arquivo `src/error.ts` (incluindo `toJSON`) não mudam (D-02, D-03, D-08).

Cobre: RF-03, RF-04, RF-06, RF-07
Arquivos: `src/response.ts`
Depende de: T-02, T-03
Aceite: os testes de RF-03, RF-04 e RF-06 de T-05 passam (status 404 com corpo RFC 9457, `content-type` começando com `application/problem+json`, `x-id` presente, header `content-type` customizado sobrescrevendo o padrão, `unhandled` sem vazamento). `test/errors.test.ts` e `test/status.test.ts` passam sem edição. `git diff` em `src/error.ts` está vazio.

### T-05 — Testes de integração de `problem()`

Completar `test/problem.test.ts` com `describeMatrix` (web e node), no padrão de `test/errors.test.ts`. Escrever esses testes antes de T-04 e vê-los falhar. Casos:

1. RF-03: corpo exato do exemplo e as variações (sem `type`, `statusText` como `title`, status fora da tabela, sem `message`, sem `instance`).
2. RF-04: `content-type` problem+json, `x-id` e sobrescrita do `content-type`.
3. RF-05: extensões na raiz, `data` sob `data`, `body` sem sobrescrever `status`/`type`.
4. RF-06: `unhandled` sem `"segredo"`, `data` nem `stack`, `content-type` problem+json; com `debug: true` aparece `stack`.
5. RF-07: `new HTTPError(...)`, `HTTPError.status(...)`, 404 padrão e erro desconhecido continuam `application/json`, com comparação estrita das chaves e sem `type`/`title`/`detail`.
6. Propagação: `throw` direto, em middleware e assíncrono; `onError` que devolve `undefined` (formato preservado); `onError` que devolve outro `HTTPError` comum (JSON antigo); `errHeaders` mesclados; `HEAD` sem corpo.
7. Outra cópia do módulo: `runInNewContext` como em `test/errors.test.ts`, confirmando que a marca sobrevive ao `isError`.

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/problem.test.ts`
Depende de: T-03
Aceite: `pnpm vitest run test/problem.test.ts` falha antes de T-04 (nos casos de formato) e passa depois dela, nos modos `web` e `node`. Os testes de RF-07 passam nos dois momentos.

### T-06 — Testes de tipos

Adicionar um `describe` para `problem`/`ProblemInput` em `test/unit/types.test-d.ts`: `ProblemInput` aceita `type` e `instance` como string e rejeita número (`@ts-expect-error`); `problem(...)` retorna `HTTPError<DataT>` com `data` inferido; a entrada do RF-02 compila.

Cobre: RF-02, RF-08
Arquivos: `test/unit/types.test-d.ts`
Depende de: T-03
Aceite: `pnpm typecheck` e `pnpm vitest run test/unit/` passam, sem erro de `isolatedDeclarations`.

### T-07 — Validação final e regressão

Rodar a suíte completa e corrigir pendências sem alterar o comportamento dos erros comuns. Confirmar que não houve mudança em `src/error.ts`, `src/utils/json-rpc.ts`, `h3/rules`, `H3Config` nem dependências. Executar `pnpm build` e `test/dist.test.ts` para verificar o novo export e o tamanho do bundle (R-07, R-09).

Cobre: RF-07, RF-08
Arquivos: nenhum arquivo novo (correções pontuais nos arquivos das tarefas anteriores, se necessárias)
Depende de: T-04, T-05, T-06
Aceite: `pnpm test`, `pnpm lint` e `pnpm typecheck` passam, incluindo os novos testes. `git status` lista só os arquivos previstos nas tarefas T-01 a T-06.

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03 |
| RF-02 | T-03, T-06 |
| RF-03 | T-01, T-02, T-04, T-05 |
| RF-04 | T-02, T-04, T-05 |
| RF-05 | T-02, T-05 |
| RF-06 | T-02, T-04, T-05 |
| RF-07 | T-04, T-05, T-07 |
| RF-08 | T-05, T-06, T-07 |
