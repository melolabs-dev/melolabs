# Tarefas de implementação — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (D-01 a D-08).

Ordem: testes antes da implementação (techspec 6.1, fluxo de correção do AGENTS.md). T-01 e T-02 escrevem os testes e precisam falhar antes de qualquer mudança em `src/`.

Decisões ainda pendentes (techspec seção 8). As tarefas seguem a recomendação da techspec, e cada uma indica onde a decisão aparece:

- D-03: manter `message` e `statusText` na raiz do corpo (usado em T-04 e T-05).
- D-07: erros 405, 415 e 403 do JSON-RPC saem como problem details (usado em T-05 e T-07).
- P1 e P2 do PRD: leitura de "não quebrar" versus "formato padrão" (confirmar antes de T-05).

---

### T-01 — Testes de integração de regressão (RF-01 a RF-09)

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
- Depende de: nenhuma
- Aceite: criar `test/problem-details.test.ts` com `describeMatrix`, um teste por linha da tabela da techspec 6.2. Cada teste roda em `web` e `node`. Executar `pnpm vitest run test/problem-details.test.ts` e confirmar que os testes de RF-01, RF-02, RF-03, RF-05, RF-06, RF-08 e RF-09 falham pelo formato atual (content-type `application/json` e corpo sem `detail`/`type`). O teste de RF-04 pode passar só no ponto `error.type === undefined`. Registrar a saída da falha. Verificar que o teste de RF-05 limpa `t.errors` ao fim, e que o de RF-08 usa `t.app.config.onError`.
- Arquivos: `test/problem-details.test.ts`

### T-02 — Testes unitários de `toProblemDetails` e da tabela de status (RF-02, RF-04, RF-05)

- Cobre: RF-02, RF-04, RF-05
- Depende de: nenhuma
- Aceite: criar `test/unit/problem-details.test.ts` com os casos da techspec 6.3: `unhandled: true` devolve `detail: "HTTPError"` sem `data` nem `body`; `body` com `type`, `title`, `status`, `detail` e `instance` não altera os membros da RFC; `defaultStatusText(422)` é `"Unprocessable Content"`, `defaultStatusText(500)` é `"Internal Server Error"` e `defaultStatusText(599)` é `undefined`; cada frase da tabela usa só caracteres aceitos por `sanitizeStatusMessage`; `HTTPError.toJSON()` não inclui `type`, `title` nem `detail`. Antes da implementação, o arquivo deve falhar por importação de `src/utils/internal/problem.ts`, que ainda não existe.
- Arquivos: `test/unit/problem-details.test.ts`

### T-03 — Campos `type` e `instance` em `ErrorBody` e `HTTPError` (RF-03, RF-04, RF-10)

- Cobre: RF-03, RF-04, RF-10
- Depende de: T-01, T-02
- Aceite: `ErrorBody` ganha `type?` e `instance?` com o doc da techspec 5.1. `HTTPError` ganha `readonly type` e `readonly instance`, atribuídos no construtor a partir de `details`, como `data` e `body`. `error.type` e `error.instance` são `undefined` quando não informados. `toJSON()` retorna `Omit<ErrorBody, "body" | "type" | "instance"> & ErrorBody["body"]` e seu comportamento não muda. O doc de `message` em `src/error.ts` passa a citar `detail` como membro da RFC. `src/index.ts` não muda. `pnpm typecheck` passa. Os testes de RF-03 e a verificação de `error.type` em RF-04 passam no nível de propriedade. Incluir o teste de tipo opcional da techspec 6.4 se a suíte de tipos existir.
- Arquivos: `src/error.ts`, `test/unit/types.test-d.ts` (opcional, techspec 6.4)

### T-04 — Helper `toProblemDetails` e tabela de frases de status (RF-02, RF-04, RF-05)

- Cobre: RF-02, RF-04, RF-05
- Depende de: T-02, T-03
- Aceite: criar `src/utils/internal/problem.ts` com `toProblemDetails(error)`, a interface `ProblemDetails` e a função privada `defaultStatusText` com a tabela `STATUS_TEXTS` (RFC 9110 e registro IANA, 1xx a 5xx), declarada no fim do arquivo. Campos: `...error.toJSON()`, `type` (padrão `"about:blank"`), `title` (`statusText ?? defaultStatusText(status)`), `status`, `detail` (`json.message`, já mascarado para erro não tratado) e `instance`. Membros da RFC vencem colisões com `body` (D-06). Código fora da tabela não recebe `title` por fallback. Não exportar a tabela em `src/index.ts`. Arquivo com menos de 200 linhas. Os testes de T-02 passam. `pnpm lint` passa.
- Arquivos: `src/utils/internal/problem.ts`

### T-05 — Renderizar erros como problem details em `errorResponse` (RF-01, RF-02, RF-05, RF-06, RF-07, RF-08, RF-09)

- Cobre: RF-01, RF-02, RF-05, RF-06, RF-07, RF-08, RF-09
- Depende de: T-03, T-04
- Aceite: em `src/response.ts`, criar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json;charset=UTF-8`) logo após `jsonHeaders`. `errorResponse` usa `problemHeaders` no lugar de `jsonHeaders` e `toProblemDetails(error)` no lugar de `error.toJSON()`. O `stack` só aparece com `debug`, como hoje. Headers continuam copiados para um `Headers` novo, para `problemHeaders` não ser mutado (comentário em `src/response.ts:167-171`). Com `onError`, `set-cookie` não duplica. Todos os testes de T-01 passam, nos modos `web` e `node`. O fluxo de `kNotFound` (404) sai em problem details com `detail` do texto atual.
- Arquivos: `src/response.ts`

### T-06 — Ajustar asserts de `content-type` em testes existentes (RF-11)

- Cobre: RF-11
- Depende de: T-05
- Aceite: em `test/errors.test.ts:44`, o `content-type` esperado passa a ser `application/problem+json;charset=UTF-8`, mantendo a verificação de merge de headers. Em `test/errors.test.ts:140`, `toMatch("application/json")` vira `toMatch("application/problem+json")`. Nenhum outro assert de corpo muda (techspec 6.5, D-03). `pnpm vitest run test/errors.test.ts` passa.
- Arquivos: `test/errors.test.ts`

### T-07 — Verificação da suíte completa, do build e dos erros JSON-RPC (RF-11)

- Cobre: RF-11
- Depende de: T-05, T-06
- Aceite: rodar `pnpm vitest run test/app.test.ts test/handler.test.ts test/body.test.ts test/proxy.test.ts test/json-rpc.test.ts` e confirmar que os asserts de `statusText`, `message` e status 405/415/403 continuam passando (techspec 2, D-07). Se algum falhar, ajustar só o que depende do formato, mantendo a verificação original. Rodar `pnpm build` e depois `pnpm test` (lint, typecheck e coverage). Todos terminam com sucesso. Registrar a saída de qualquer comando que falhar. Confirmar que `src/index.ts` e `src/_entries/*.ts` não ganharam exportações (RF-10).
- Arquivos: `test/app.test.ts`, `test/handler.test.ts`, `test/body.test.ts`, `test/proxy.test.ts`, `test/json-rpc.test.ts` (somente se algum falhar)

### T-08 — Documentação do formato de erro (apoio a RF-02 e RF-03)

- Cobre: RF-02, RF-03
- Depende de: T-05
- Aceite: `docs/1.guide/1.basics/6.error.md` mostra o corpo em problem details, descreve `type` e `instance` (com `about:blank` como padrão) e troca "`message`" por "`detail`" na nota de campos ocultos. Mantém a menção a `message` e `statusText` como membros de extensão, conforme D-03. Registra a mudança de `application/json` para `application/problem+json`, e de `body` que sobrescreve membros da RFC (D-06), para o changelog. `pnpm lint` passa (formatação de Markdown, se aplicável).
- Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-09 — Atualizar a listagem de `utils/internal/` no AGENTS.md (apoio a RF-10)

- Cobre: RF-10
- Depende de: T-04
- Aceite: `AGENTS.md`, nas linhas da listagem de `utils/internal/` (techspec 4, linhas 89-90), inclui `problem.ts`, conforme a nota de manutenção no topo do arquivo. Nenhum outro trecho muda. A verificação é apenas de texto, já que não há teste automatizado para o AGENTS.md.
- Arquivos: `AGENTS.md`

---

Cobertura dos requisitos do PRD:

- RF-01: T-01, T-05
- RF-02: T-01, T-02, T-04, T-05, T-08
- RF-03: T-01, T-03, T-08
- RF-04: T-01, T-02, T-03, T-04
- RF-05: T-01, T-02, T-04, T-05
- RF-06: T-01, T-05
- RF-07: T-01, T-05
- RF-08: T-01, T-05
- RF-09: T-01, T-05
- RF-10: T-03, T-07, T-09
- RF-11: T-06, T-07
