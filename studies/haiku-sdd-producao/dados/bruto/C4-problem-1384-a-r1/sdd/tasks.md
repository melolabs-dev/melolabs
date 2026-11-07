# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-09).

Ordem sugerida: T-01 e T-03 podem começar em paralelo. T-02 segue o fluxo de bug fix do AGENTS.md (teste primeiro, falhando). T-04 e T-05 vêm depois. T-07 fecha a entrega.

Ponto em aberto (techspec, D-03 / R-09): `data` e `body` ficam fora do corpo problem details. Se o time decidir o contrário, a mudança fica restrita a `toProblemDetails` (T-04) e aos testes de T-02.

---

### T-01 — Opção `problemDetails` em `H3Config`

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:**
- `H3Config` aceita `problemDetails?: boolean`, com JSDoc em inglês no mesmo estilo de `debug`.
- Em um app criado sem a opção, `app.config.problemDetails` é `undefined` ou `false`.
- `pnpm typecheck` passa, e `test/unit/types.test-d.ts` checa `H3Config["problemDetails"]`.

**Arquivos:** `src/types/h3.ts`, `test/unit/types.test-d.ts`

---

### T-02 — Testes de problem details (escritos antes da implementação)

**Cobre:** RF-01, RF-02, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** T-01

**Aceite:**
- `test/problem-details.test.ts` usa `describeMatrix` e roda nos modos `web` e `node`.
- Cobre os cenários da techspec (seção "Integração"): 404 com `title`/`detail`, `instance` presente e ausente, `title` pela tabela, `title` omitido para código desconhecido, sem a opção o corpo não muda, headers preservados (`retry-after` e `content-type` do handler), `errHeaders`, `set-cookie` sem duplicação com `onError`, erro não tratado sem vazamento (com `t.app.config.debug = false`), `stack` em debug, `onError` retornando `Response` (418), `onError` sem retorno, e `HEAD`.
- Antes de T-04 e T-05, `pnpm vitest run test/problem-details.test.ts` falha nos casos novos. Esse resultado é registrado na entrega.
- Os testes existentes não são alterados.

**Arquivos:** `test/problem-details.test.ts`

---

### T-03 — `type` e `instance` em `HTTPError`

**Cobre:** RF-03

**Depende de:** nenhuma

**Aceite:**
- `ErrorInput` aceita `type?: string` e `instance?: string`.
- `HTTPError` expõe `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor a partir de `details`, no mesmo padrão de `data` e `body`.
- `new HTTPError({ status: 403, message: "Forbidden", type: "https://example.com/probs/no-access", instance: "/orders/7" })` expõe esses valores em `error.type` e `error.instance`.
- `toJSON()` não muda: `type` e `instance` não aparecem nele. `ErrorBody` também não muda.
- Teste adicionado em `test/errors.test.ts`, sem alterar os testes existentes.
- `pnpm typecheck` passa, com `isolatedDeclarations` válido nas novas propriedades. Checagem de tipos em `test/unit/types.test-d.ts` para `ErrorInput["type"]`, `ErrorInput["instance"]` e `HTTPError["type"]`.

**Arquivos:** `src/error.ts`, `test/errors.test.ts`, `test/unit/types.test-d.ts`

---

### T-04 — Helper interno de problem details

**Cobre:** RF-02, RF-06, RF-07

**Depende de:** T-03

**Aceite:**
- Novo arquivo `src/utils/internal/problem-details.ts`, não exportado em `src/index.ts`.
- Exporta `PROBLEM_CONTENT_TYPE = "application/problem+json"`, a interface `ProblemDetails` e `toProblemDetails(error, debug?)`.
- `STATUS_TITLE: Record<number, string>` cobre os códigos de status IANA. Não reutiliza `STATUS_TEXT` de `src/utils/response.ts`. Não importa tabela de `node:http`.
- `type` vem de `error.type` com padrão `"about:blank"`. `title` vem de `error.statusText`, senão de `STATUS_TITLE`, e fica omitido se nenhum existir. `detail` vem de `error.message`, exceto quando `error.unhandled` (então fica indefinido). `instance` vem de `error.instance`. `stack` só existe com `debug`, em linhas aparadas.
- Não usa `error.toJSON()` como base.
- Arquivo com menos de ~200 linhas.
- Teste unitário opcional de `toProblemDetails` com erro não tratado e com `stack`.

**Arquivos:** `src/utils/internal/problem-details.ts`

---

### T-05 — Renderização problem details em `errorResponse`

**Cobre:** RF-02, RF-04, RF-05, RF-06, RF-07

**Depende de:** T-01, T-03, T-04

**Aceite:**
- `errorResponse(error, config, errHeaders?)` recebe o `config` inteiro. A chamada em `src/response.ts:173` passa `config` em vez de `config.debug`.
- Com `config.problemDetails` ligado: o corpo vem de `toProblemDetails(error, config.debug)` e o `Content-Type` é `application/problem+json`. O `headers.set` acontece depois de `mergeHeaders`, então `error.headers` com `content-type` não sobrescreve.
- Com a opção desligada, o caminho atual não muda: mesmo `Content-Type`, mesmo corpo via `error.toJSON()`, sem `type` nem `instance`.
- A limpeza de `kEventRes` antes de `errorResponse` (`src/response.ts:172-173`) continua no mesmo lugar e vale para os dois formatos.
- Um único `JSON.stringify` no fim, com `body` montado em `if`/`else`.
- Com `onError` retornando `Response`, esse valor é usado como está, sem conversão.
- Os testes de T-02 passam nos modos `web` e `node`.

**Arquivos:** `src/response.ts`

---

### T-06 — Regressão de testes existentes

**Cobre:** RF-04, RF-08

**Depende de:** T-05

**Aceite:**
- `pnpm vitest run test/errors.test.ts` passa sem alterações nos testes existentes.
- Se algum teste existente falhar por depender diretamente do que muda, ele só é ajustado mantendo o que verifica. Cada ajuste é listado na entrega.
- Nenhum teste existente é removido.

**Arquivos:** `test/errors.test.ts`

---

### T-07 — Validação final

**Cobre:** RF-08

**Depende de:** T-02, T-05, T-06

**Aceite:**
- `pnpm vitest run` passa nos modos `web` e `node`, incluindo os casos novos de problem details.
- `pnpm lint` passa (oxlint + oxfmt --check).
- `pnpm typecheck` passa.
- `pnpm build` gera o pacote sem erros.
- Resultado registrado na entrega, com a saída dos comandos em caso de falha.

**Arquivos:** nenhum arquivo de código. Esta tarefa só executa comandos de verificação.
