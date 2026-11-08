# Tarefas — Problem details (RFC 9457) via `problem()`

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09, seção 5 de testes).

Ordem sugerida: T-01 → (T-02, T-03, T-06 em paralelo) → T-04 → T-05 → T-07.

Convenções a seguir (`AGENTS.md`): ESM, imports com extensão `.ts`, arquivos com menos de 200 LoC, testes com `describeMatrix`, símbolos com prefixo `k`, helpers internos no fim do arquivo.

---

### T-01 — Núcleo: `ProblemInput`, `problem()` e marca interna

**Cobre:** RF-01, RF-02

Criar `src/utils/problem.ts` com:

- `ProblemInput<DataT>`, que estende `ErrorInput<DataT>` e acrescenta `type?` e `instance?` (D-07).
- `problem(input)`, que separa `type` e `instance` do restante, cria `new HTTPError(details)` e marca o erro com `kProblem` (`Symbol.for("h3.problem")`) numa propriedade não enumerável, via `Object.defineProperty` (D-01).
- `getProblemMeta(error)`, helper interno que lê a marca.
- Tipo de retorno explícito em `problem` (exigido por `isolatedDeclarations`, R-03).

Não criar nenhum outro nome público (`sdd/prd.md`, "Fora de escopo").

**Depende de:** nenhuma

**Aceite:**

- `problem({ status: 404, message: "Usuário não encontrado" })` devolve `instanceof HTTPError`, com `status` 404 e `message` preservados.
- `problem({ status: 403, type: "...", instance: "/pagamentos/42" })` guarda `type` e `instance` na marca, e não os copia para o `HTTPError`.
- `{ ...error }` não copia a marca (`Object.keys` e spread não a incluem, R-05).
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/problem.ts`

---

### T-02 — Exportação pública e snapshot de exports

**Cobre:** RF-01, RF-02, RF-09

Em `src/index.ts`, na seção `// Error` (perto da linha 72), adicionar `export { problem, type ProblemInput } from "./utils/problem.ts";` (D-09). Atualizar o snapshot inline de `test/unit/package.test.ts` para incluir `"problem"` entre `"parseCookies"` e `"proxyRequest"` (R-01). `ProblemInput` é só tipo e não entra no snapshot.

**Depende de:** T-01

**Aceite:**

- `import { problem } from "h3"` funciona nos testes.
- `pnpm vitest run test/unit/package.test.ts` passa com o snapshot atualizado.
- O snapshot só ganha `"problem"`. Nenhuma outra chave muda.

**Arquivos:** `src/index.ts`, `test/unit/package.test.ts`

---

### T-03 — Serialização RFC 9457 em `errorResponse`

**Cobre:** RF-03, RF-04, RF-06, RF-07

Em `src/response.ts`, ramificar dentro de `errorResponse` (D-02):

- Se `getProblemMeta(error)` existir, usar a base de headers `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, perto de `jsonHeaders`, D-04) e o corpo `problemBody(error, meta)`.
- Caso contrário, manter exatamente o caminho atual.
- `problemBody` vai no fim do arquivo como helper interno. Reaproveita `error.toJSON()` para a máscara de `unhandled` (D-03) e aplica a precedência: membros de `body` são sobrescritos pelos membros da RFC (`type`, `title`, `status`, `detail`, `instance`), e `data` vai por último.
- `type` padrão `"about:blank"`. `title` vem de `statusText` e some se não houver. `detail` vem de `message`.
- `instance` é omitido quando `unhandled` (D-03, pendência 1).
- `stack` continua em modo `debug` (D-08).
- `errHeaders` continua sendo mesclado depois, como hoje.

Importar `getProblemMeta` de `./utils/problem.ts`. Se o `oxlint` reclamar da variável `unhandled` não usada, aplicar a alternativa de D-03 (R-02).

**Depende de:** T-01

**Aceite:**

- Erro criado por `problem` responde com `Content-Type: application/problem+json` e corpo com `type`, `title`, `status`, `detail`, `instance` (RF-03).
- Sem `type`, o corpo traz `"about:blank"`. `body` aparece no topo e `data` fica sob `data` (RF-04).
- Com `unhandled: true`, `detail` é `"HTTPError"` e `data`, `body` e `instance` não aparecem (RF-06).
- `headers: { "Retry-After": "30" }` chega à resposta, e `Content-Type` continua `application/problem+json` (RF-07).
- Um `headers` com `Content-Type` explícito prevalece (RF-07).
- `pnpm vitest run test/errors.test.ts` passa sem alteração nos testes existentes.
- `pnpm lint` passa.

**Arquivos:** `src/response.ts`

---

### T-04 — Testes de comportamento de `problem` (matriz web/node)

**Cobre:** RF-01, RF-03, RF-04, RF-06, RF-07, RF-08

Criar `test/problem.test.ts` com `describeMatrix`, para rodar em `web` e `node`. Cobrir:

- `problem` devolve `HTTPError` com `status` e `message` (RF-01).
- Corpo RFC 9457 completo com o exemplo de `sdd/techspec.md` seção 4 (`422`, `Campo 'email' inválido`), usando `toEqual` no JSON e checando `application/problem+json` (RF-03).
- `type` padrão `about:blank`, `body` no topo e `data` sob `data` (RF-04).
- Precedência: `body: { title: "x", status: 1 }` não altera `title` nem `status`, e `body: { data: {...} }` sem `data` é descartado (risco de colisão).
- `unhandled` mascarado: `detail: "HTTPError"`, sem `data`, sem `instance`, sem a mensagem interna. Limpar `ctx.errors` como em `test/errors.test.ts`, senão o `afterEach` reclama (RF-06).
- `headers` aplicados e `Content-Type` informado prevalece (RF-07).
- `HEAD` responde com status e `Content-Type`, sem corpo (regressão de `nullBody`).

Seguir o fluxo do `AGENTS.md`: escrever o teste, ver falhar antes da implementação quando possível, depois ver passar.

**Depende de:** T-02, T-03

**Aceite:**

- `pnpm vitest run test/problem.test.ts` passa nos dois modos (`web` e `node`), com os casos listados.
- Cada caso listado aparece nos dois modos.

**Arquivos:** `test/problem.test.ts`

---

### T-05 — Casos de borda e formato legado

**Cobre:** RF-05, RF-06, RF-08

Acrescentar a `test/problem.test.ts` (matriz web/node):

- Erro legado com `HTTPError.status(404, "Not Found", { message: "Não encontrado" })` mantém o `Content-Type` `application/json;charset=UTF-8` e o corpo sem `type`, no padrão de `test/errors.test.ts:44` (RF-05).
- `problem` relançado sem alteração continua no formato problem (D-01).
- `problem` passado como `cause` de um `HTTPError` novo: o status é herdado, mas o corpo fica no formato legado, sem `type` (D-05, R-07).
- `onError` que relança um `problem`: formato problem preservado e `onError` chamado uma vez (D-02).
- `onError` que devolve `Response`: resposta do hook intacta (não regressão).
- `errHeaders` com `append("set-cookie", ...)`: o cookie aparece uma vez, no padrão de `test/errors.test.ts:202` (R-08).
- `debug` inclui `stack` no corpo problem (D-08).

**Depende de:** T-04

**Aceite:**

- `pnpm vitest run test/problem.test.ts` passa nos dois modos com os novos casos.
- Os casos de formato legado não mudam o comportamento de `test/errors.test.ts`.

**Arquivos:** `test/problem.test.ts`

---

### T-06 — Teste de tipos de `ProblemInput` e `problem`

**Cobre:** RF-02

Em `test/unit/types.test-d.ts` (que já importa `expectTypeOf`), adicionar:

- `expectTypeOf(problem).returns.toEqualTypeOf<HTTPError<...>>()` ou equivalente, verificando o retorno de `problem`.
- `ProblemInput` aceita `type` e `instance` como `string`.
- `// @ts-expect-error` para uma chave desconhecida em `ProblemInput`.

**Depende de:** T-01

**Aceite:**

- `pnpm typecheck` passa e o teste de tipos falha se `type` ou `instance` deixarem de ser aceitos.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-07 — Verificação final de qualidade

**Cobre:** RF-09

Rodar a verificação completa e corrigir apenas o que a mudança causou. Nenhum teste existente pode ser removido. Se um teste existente quebrar, tratar como regressão e não como ajuste, salvo a atualização do snapshot já prevista em T-02 (`sdd/techspec.md` seção 5).

**Depende de:** T-02, T-04, T-05, T-06

**Aceite:**

- `pnpm vitest run test/problem.test.ts` passa.
- `pnpm vitest run test/errors.test.ts test/unit/package.test.ts` passa.
- `pnpm lint` passa.
- `pnpm typecheck` passa.
- `pnpm vitest run` (suíte completa) passa.
- `git diff --stat` mostra apenas os arquivos listados nas tarefas acima.

**Arquivos:** nenhum (apenas execução de comandos de verificação)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-04 |
| RF-02 | T-01, T-02, T-06 |
| RF-03 | T-03, T-04 |
| RF-04 | T-03, T-04 |
| RF-05 | T-05 |
| RF-06 | T-03, T-04 |
| RF-07 | T-03, T-04 |
| RF-08 | T-04, T-05 |
| RF-09 | T-02, T-07 |

## Pendências do techspec (seção 7)

As três decisões abaixo seguem o padrão adotado em `sdd/techspec.md`. Confirmar com o time antes de T-03:

1. `instance` omitido em erros `unhandled` (D-03). Se o time preferir expor, remover o ternário em `problemBody` e ajustar o aceite de T-03.
2. `stack` em modo debug no formato problem (D-08). Mantido.
3. Arquivo em `src/utils/problem.ts` em vez de `src/problem.ts` (D-06). Mantido.
