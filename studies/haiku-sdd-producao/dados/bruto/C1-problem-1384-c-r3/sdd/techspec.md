# Especificação técnica — Problem details (RFC 9457) via `problem()`

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-07).

Todas as citações de linha foram conferidas no código deste clone (branch `master`, commit `6f3b801`).

## 1. Resumo

Adicionar `problem(input)`, exportada por `h3`, que devolve um `HTTPError` cujo corpo recebe `type` e `instance` no nível superior e cuja resposta sai com `Content-Type: application/problem+json`. Nenhuma alteração em `HTTPError` nem em `errorResponse`: o utilitário monta um `HTTPError` comum, usando os mecanismos que já existem (`body` e `headers`). Só as respostas criadas por `problem` mudam.

## 2. Estado atual relevante

- `src/error.ts:74` — classe `HTTPError`. `headers` é `readonly` (`src/error.ts:97`) e é preenchido no construtor a partir de `details.headers` ou `details.cause.headers` (`src/error.ts:203`).
- `src/error.ts:209` — `this.body = (details as ErrorBody)?.body;`. O campo `body` já existe no contrato de entrada (`src/error.ts:6`, `ErrorInput`, e `src/error.ts:30`, `ErrorBody`).
- `src/error.ts:226-235` — `toJSON()`. Quando `unhandled` é verdadeiro, `message` vira `"HTTPError"` e `data` vai como `undefined`; o spread de `body` (`src/error.ts:234`) só acontece quando o erro não é `unhandled`. Esse spread vem por último, então chaves de `body` podem sobrescrever `status`, `message` etc. (comportamento atual, não será mudado).
- `src/response.ts:270-272` — `jsonHeaders` é `FrozenHeaders` com `content-type: application/json;charset=UTF-8`.
- `src/response.ts:358-380` — `errorResponse`. Monta `headers` com `mergeHeaders(jsonHeaders, error.headers)` (`src/response.ts:359-361`), aplica `errHeaders` (`src/response.ts:362-364`) e serializa `error.toJSON()` (`src/response.ts:368`).
- `src/response.ts:243-252` — `mergeHeaders` usa `target.set(...)` para tudo, exceto `set-cookie` (que usa `append`). Logo, um `content-type` em `error.headers` substitui o padrão. A premissa 2 do PRD está confirmada por leitura; o teste da seção 6 a confirma em execução.
- `src/response.ts:146-174` — tratamento de `Error` em `prepareResponse`. Vale para erros lançados e para erros retornados (`return`), então RF-01 vale para ambos.
- `src/index.ts:72` — exportações de erro: `export { type ErrorDetails, type ErrorBody, type ErrorInput, HTTPError } from "./error.ts";`.
- `src/utils/query.ts:1` — exemplo de utilitário de `src/utils/` importando `HTTPError` de `../error.ts`; serve de modelo de estilo.
- `test/unit/package.test.ts:4-105` — snapshot inline de todas as exportações de `src/_entries/generic.ts`. Adicionar `problem` altera esse snapshot (linha 105 é `"proxy"`; `problem` entra logo antes).
- `test/errors.test.ts:44` e `:140` — afirmam `application/json` para `HTTPError` comum. Continuam válidos sem alteração (RF-04).
- `package.json` — `pnpm typecheck` = `tsc --noEmit` sobre `src` e `test` (`tsconfig.json`, `include`), então um `@ts-expect-error` em teste é verificado pelo typecheck.

## 3. Decisões de arquitetura

### D-01 — `problem` é uma função que devolve `HTTPError`, sem subclasse

- **Alternativas:** (a) subclasse `ProblemError extends HTTPError`; (b) função que devolve `HTTPError` (escolhida); (c) novo parâmetro em `new HTTPError(...)`.
- **Escolha:** (b). Pedido e PRD exigem que o retorno seja `HTTPError` (RF-01) e que não haja nomes públicos novos além de `problem` e `ProblemInput`. Subclasse criaria uma classe pública nova e exigiria tocar `HTTPError.isError`. A opção (c) mudaria o construtor da classe central, contrariando "não quebrar o que já existe" e "keep the core minimal".
- **Local:** `src/utils/problem.ts` (utilitário público, uma função por arquivo, como em `src/utils/query.ts`).

### D-02 — Content-Type vem de `headers` do próprio erro

- **Alternativas:** (a) `problem` põe `content-type` em `headers` do `HTTPError` (escolhida); (b) símbolo-marca interno no erro + ramo em `errorResponse` que escolhe o `content-type`; (c) campo público novo em `HTTPError`.
- **Escolha:** (a). Usa a regra de merge já existente (`src/response.ts:249`, `set`) e não altera `src/response.ts`. Custo: `error.headers` (público) passa a conter `content-type` nesses erros; é aceitável e fica documentado.
- **Regra de precedência (fixada aqui):** o `content-type` do utilitário sempre vence qualquer `content-type` passado em `input.headers`. Assim RF-03 vale sem exceção. `errHeaders` (`event.res.errHeaders`, aplicado depois em `src/response.ts:362-364`) continua podendo sobrescrever, como já acontece hoje, e isso é escolha explícita do handler.
- O valor é exatamente `application/problem+json`, sem `;charset=UTF-8`, como pede RF-03. Não se aplica `jsonHeaders` ao erro de `problem`; `errorResponse` já cria um `Headers` novo a partir de `jsonHeaders` (`src/response.ts:359-361`), sem mutar o objeto congelado.

### D-03 — `type` e `instance` vão para `body`, e o utilitário tem precedência sobre `input.body`

- **Alternativas:** (a) guardar em `body` (escolhida); (b) campos novos em `HTTPError` e em `toJSON`; (c) lançar erro se `input.body` tiver `type`/`instance`.
- **Escolha:** (a). `toJSON` já espalha `body` no topo (`src/error.ts:234`), então nenhuma mudança é necessária. Na colisão, `type`/`instance` do utilitário vencem as chaves homônimas de `input.body`. Não lançar exceção evita quebrar chamadas válidas. Os campos só entram em `body` quando estão definidos (RF-02, segundo critério: sem chaves ausentes).

### D-04 — Erro `unhandled` oculta `type` e `instance`

- **Alternativas:** (a) ocultar, pelo mesmo caminho que oculta `body` (escolhida); (b) sempre enviar `type` e `instance`.
- **Escolha:** (a). `toJSON` já não espalha `body` quando `unhandled` (`src/error.ts:234`), então a regra de RF-05 (sem vazamento) vale sem código extra. `type` e `instance` deixam de aparecer nesse caso. **Ponto a confirmar** (seção 8).

### D-05 — `type` ausente é omitido (sem `about:blank`)

- **Escolha:** seguir o PRD (RF-02). Não se emite `"type": "about:blank"`. Desvio da RFC aceito pelo contrato; registrado nos riscos.

### D-06 — `title` e `detail` não são emitidos

- **Escolha:** seguir o PRD (fora de escopo: mapeamento automático). O corpo continua com `status`, `statusText`, `unhandled`, `message`, `data`, mais `type` e `instance`. É um problem details parcial; registrado nos riscos e nos pontos a confirmar.

### D-07 — `ProblemInput` estende `ErrorInput`

- **Escolha:** `export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> { type?: string; instance?: string }`. Reaproveita o tipo de entrada de `HTTPError` (requisito do contrato) e acrescenta só os dois campos da RFC. `type: 123` gera erro de tipo (RF-06).

## 4. Arquivos a alterar

| Arquivo | Alteração |
| --- | --- |
| `src/utils/problem.ts` | **Novo.** Define `ProblemInput` e `problem()` (seção 5). Aprox. 35 linhas, abaixo do limite de 200 do AGENTS.md. |
| `src/index.ts:72` | Logo abaixo da linha 72, adicionar `export { problem, type ProblemInput } from "./utils/problem.ts";`. Mantém a seção `// Error`. |
| `test/unit/package.test.ts:105` | Inserir `"problem",` no snapshot, entre `"parseCookies",` (linha 104) e `"proxy",` (linha 105). Único ajuste em teste existente, justificado no PR (RF-07). |
| `test/problem.test.ts` | **Novo.** Testes com `describeMatrix` (seção 6). |

Não alterar: `src/error.ts`, `src/response.ts`, `src/_entries/*`, `test/errors.test.ts`.

## 5. Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

/**
 * Entrada de `problem()`: os campos de `ErrorInput` mais os dois campos de
 * problem details (RFC 9457) que o h3 suporta.
 */
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI que identifica o tipo do problema. Omitido do corpo quando ausente. */
  type?: string;
  /** URI que identifica a ocorrência do problema. Omitido do corpo quando ausente. */
  instance?: string;
}

/**
 * Cria um `HTTPError` cuja resposta segue RFC 9457: `Content-Type: application/problem+json`
 * e `type`/`instance` no topo do JSON (quando informados).
 */
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

Corpo (referência de implementação):

```ts
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, headers, body, ...rest } = input;
  const members: Record<string, unknown> = { ...body };
  if (type !== undefined) members.type = type;
  if (instance !== undefined) members.instance = instance;
  const merged = new Headers(headers);
  merged.set("content-type", "application/problem+json");
  return new HTTPError<DataT>({ ...rest, headers: merged, body: members });
}
```

Exportação em `src/index.ts`:

```ts
export { problem, type ProblemInput } from "./utils/problem.ts";
```

Requisitos de TypeScript: `isolatedDeclarations` exige o tipo de retorno explícito (presente). `verbatimModuleSyntax` exige `type` na importação de `ErrorInput`.

Comportamento resultante, por caso:

| Entrada | Resposta |
| --- | --- |
| `problem({ status: 404, message: "X" })` | `404`, `content-type: application/problem+json`, corpo `{status, statusText, unhandled, message, data}` |
| `problem({ status: 403, type: T, instance: I })` | corpo com `"type": T` e `"instance": I` no topo |
| `problem({ status: 403 })` | corpo sem chaves `type` nem `instance` (JSON não serializa `undefined`; e a chave só é criada quando definida) |
| `problem({ status: 500, message: "...", unhandled: true, type: T })` | `message: "HTTPError"`, sem `data`, sem `type`, sem `instance` (D-04) |
| `problem({ status: 400, headers: { "content-type": "text/plain" } })` | `content-type` permanece `application/problem+json` (D-02) |
| `new HTTPError({ status: 400, message: "Ruim" })` | inalterado: `application/json;charset=UTF-8` |

## 6. Estratégia de testes

Seguir o fluxo de "Bug Fix Workflow" do AGENTS.md: escrever os testes antes da implementação e confirmar que falham (o import de `problem` falhará, o que já cumpre o papel de "falha antes").

**`test/problem.test.ts`** (com `describeMatrix`, cobre `web` e `node`):

1. Lança `problem({ status: 404, message })` → status 404; `content-type` = `application/problem+json`. (RF-01, RF-03)
2. Retorna (não lança) `problem(...)` → mesma resposta. Também `HTTPError.isError(problem(...))` é `true`. (RF-01)
3. `type` e `instance` aparecem no topo do JSON. (RF-02)
4. Sem `type`/`instance`, `JSON.parse(body)` não tem essas chaves (`"type" in body === false`). (RF-02)
5. `unhandled: true` → `message === "HTTPError"`, sem `data`, sem o texto sensível, sem `type`. (RF-05, D-04)
6. `headers: { "content-type": "text/plain" }` → `content-type` continua `application/problem+json`. (D-02)
7. `headers: { "x-extra": "1" }` → header presente junto com o `content-type` do utilitário. (D-02)
8. `body: { type: "x", foo: 1 }` com `type` do utilitário → utilitário vence e `foo` continua. (D-03)
9. `new HTTPError({ status: 400, message: "Ruim" })` → `application/json;charset=UTF-8` e chaves exatamente `status, statusText, unhandled, message, data`. (RF-04)
10. Tipo: `// @ts-expect-error` em `problem({ status: 400, type: 123 })`. Verificado por `pnpm typecheck`. (RF-06)

**`test/unit/package.test.ts`**: atualização do snapshot (seção 4). Confirma que `problem` é a única exportação de runtime nova (`ProblemInput` é só tipo).

**Regressão:** `pnpm vitest run test/errors.test.ts test/unit/package.test.ts test/problem.test.ts`, depois `pnpm test` completo (lint + typecheck + coverage). `pnpm lint` precisa passar com `oxfmt --check`, então formatar com `pnpm fmt` antes de fechar.

## 7. Riscos

1. **Problem details parcial.** RFC 9457 pede `title` e `detail`; o h3 envia `statusText` e `message`. Clientes estritos podem reclamar. Mitigação: documentar; decidir na seção 8.
2. **`type` ausente.** Sem `about:blank`. Desvio aceito pelo contrato.
3. **Colisão de chaves em `body`.** `toJSON` espalha `body` por último (`src/error.ts:234`), então `body.status`, `body.message` etc. continuam podendo sobrescrever campos do erro (comportamento atual). O utilitário só protege `type` e `instance`.
4. **Clientes que comparam `Content-Type` exato.** Consumidores que checam `application/json` deixam de reconhecer essas respostas. Restrito às respostas de `problem`; documentar.
5. **`content-type` em `headers` é sobrescrito sem aviso.** Coerente com D-02, mas quem passar `content-type` em `headers` pode se surpreender. Testado no caso 6.
6. **`errHeaders` pode trocar o `content-type`.** Se o handler usar `event.res.errHeaders.set("content-type", …)`, o valor final muda. É escolha explícita; não bloqueado.
7. **`HTTPError.headers` público passa a conter `content-type`.** Hooks `onError` e outros leitores veem o valor. Sem efeito funcional conhecido.
8. **Cobertura entre runtimes.** Os testes precisam de `describeMatrix` (AGENTS.md). Node e web são exercitados pelo mesmo caso.
9. **Snapshot de exportações.** Esquecer o ajuste em `test/unit/package.test.ts` quebra a suíte. Está listado na seção 4.

## 8. Pontos a confirmar

Estas decisões seguem a escolha mais simples, mas não estão fixadas pelo PRD ou pelo contrato:

- **P-1 (D-04):** `type` e `instance` somem quando `unhandled: true`? Recomendação: sim, pela mesma regra que oculta `body`.
- **P-2 (D-06):** emitir `title` e `detail` (a partir de `statusText` e `message`) para aproximar a RFC 9457? Recomendação: não nesta entrega, por estar fora de escopo do PRD; registrar como melhoria.
- **P-3 (D-02):** o `content-type` do utilitário deve vencer `headers` passado pelo usuário? Recomendação: sim (RF-03 sem exceção).
- **P-4 (D-05):** aceitar a ausência de `type` (sem `about:blank`)? Recomendação: sim, conforme o contrato.
