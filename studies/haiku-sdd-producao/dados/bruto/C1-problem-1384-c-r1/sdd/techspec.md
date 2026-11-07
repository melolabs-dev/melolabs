# Especificação técnica — Problem details (RFC 9457) via `problem()`

Base: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-08) e o código do h3 v2.0.8 em `C:\dev\runs\r6f32566141`.

Todas as referências `arquivo:linha` foram conferidas na leitura do código deste clone.

## Visão geral

Um novo utilitário público `problem(input)` cria um `HTTPError` comum e marca essa instância com um marcador interno. Na serialização (`errorResponse`), só erros marcados recebem o corpo RFC 9457 e o `Content-Type: application/problem+json`. Todo o resto segue o caminho atual, byte a byte.

Fluxo resultante:

1. Handler faz `throw problem({...})` ou `return problem({...})`.
2. `prepareResponse` (`src/response.ts:146`) já trata qualquer `HTTPError.isError` sem mudanças.
3. `errorResponse` (`src/response.ts:358`) verifica o marcador interno. Se presente, usa o corpo e os headers de problema; senão, usa o caminho atual.

---

## Decisões de arquitetura

### D-01 — Forma do utilitário: função que devolve `HTTPError`

**Alternativas consideradas**

- (a) Classe nova `ProblemError extends HTTPError`.
- (b) Opção de formato em `HTTPError` (ex.: `new HTTPError({ format: "problem" })`).
- (c) Função `problem(input)` que devolve um `HTTPError` comum.

**Escolha: (c).** O PRD (premissa 2) pede uma fábrica no estilo de `HTTPError.status()` (`src/error.ts:144`), sem classe nova. A classe nova (a) criaria um segundo nome público e quebraria `HTTPError.isError`, que depende de `name === "HTTPError"` (`src/error.ts:75-77`, `:129-133`). A opção (b) adicionaria um campo público a `ErrorInput` (`src/error.ts:6`), o que viola a restrição de "nenhum outro nome público novo" (`sdd/pedido.md`, Restrições). Com (c), o erro continua sendo reconhecido pelo pipeline sem mudanças.

### D-02 — Marcador interno: símbolo não enumerável no próprio erro

**Alternativas consideradas**

- (a) `WeakMap<HTTPError, ProblemMembers>` em módulo interno.
- (b) Propriedade pública `type` / `instance` em `HTTPError`.
- (c) Símbolo `Symbol.for("h3.problem")` definido com `Object.defineProperty` (não enumerável) no erro.

**Escolha: (c).**

- (b) é descartada: cria campos públicos novos (viola o contrato) e vazaria para `HTTPError` comum (viola RF-05).
- (a) funciona só dentro de uma cópia do módulo. `Symbol.for` atravessa cópias duplicadas do h3, o mesmo motivo do `kHTTPResponse` (`src/response.ts:94`, com justificativa no comentário das linhas 86-93).
- Não enumerável evita que o marcador apareça em `{...error}` e em qualquer serialização de `Object.keys`.
- O símbolo fica em `src/utils/internal/problem.ts` e não é exportado por `src/index.ts`.

**Consequência:** `type` e `instance` ficam "disponíveis no erro criado" (RF-02) apenas via o símbolo interno. Não há getter público. Os testes verificam isso pelo corpo da resposta (ver Estratégia de testes).

### D-03 — Onde escolher o formato: `errorResponse`, com helper interno

**Alternativas consideradas**

- (a) Alterar `HTTPError.prototype.toJSON` (`src/error.ts:226`) para devolver o formato RFC quando marcado.
- (b) Escolher o formato em `errorResponse` (`src/response.ts:358`) e delegar a montagem do corpo a um helper interno.
- (c) Criar um novo passo no pipeline de `prepareResponse`.

**Escolha: (b).** `toJSON` é chamado por `JSON.stringify(error)` em qualquer lugar, então mudá-lo mexeria em serializações que não são respostas HTTP (quebra RF-05 indiretamente). A escolha de formato é uma preocupação de renderização, então pertence a `errorResponse`. (c) adicionaria um caminho novo quando um ajuste local basta. O helper `toProblemJSON` fica em `src/utils/internal/problem.ts` para manter `src/response.ts` (380 linhas hoje) dentro da convenção de arquivos curtos (`AGENTS.md`, "Short files").

### D-04 — Mapeamento de membros e precedência

Regras fixas (RF-03 e RF-06 do PRD):

- `type`: valor informado, senão `"about:blank"`.
- `title`: `error.statusText`. Se ausente, o membro é **omitido** (não enviado como `undefined`).
- `status`: `error.status` (já sanitizado por `src/error.ts:172-178`).
- `detail`: `error.message`. Omitido quando `error.unhandled` (mesma regra de `toJSON`, `src/error.ts:232`).
- `instance`: valor informado; omitido se ausente.
- `unhandled`: incluído quando `true`, espelhando `toJSON` (`src/error.ts:231`). Não é detalhe interno.
- `body` (extensão): espalhado **antes** dos membros RFC, e omitido quando `unhandled` (mesma regra de `src/error.ts:234`).

**Precedência:** membros RFC vencem colisões com `body`. Ex.: `body: { status: 999 }` não altera o `status`.

**Por que a ordem é esta:** em `HTTPError.toJSON` o `body` vem por último e sobrescreve. Para problem details, o contrato RFC é mais importante que a extensão; é a precedência que o PRD (Riscos, "Colisão de membros") pede para definir e testar. Para evitar que um `title` ausente apague um `title` vindo de `body`, o membro é omitido em vez de virar `undefined`.

**Alternativa descartada:** `body` por último (igual a `toJSON`). Permitiria que um `body` sobrescrevesse `status` e `type`, quebrando o contrato do cliente.

### D-05 — `Content-Type` e headers

- Base dos headers de problema: `application/problem+json`, **sem** `charset`. RFC 9457 não exige charset (JSON é UTF-8 por padrão), e RF-04 usa igualdade exata.
- `error.headers` (`src/error.ts:97`) continua mesclado por cima da base, como hoje (`src/response.ts:360`). Assim `headers: { "content-type": ... }` pode sobrescrever, igual a `HTTPError`. Consistência com o comportamento atual vence a rigidez.
- `errHeaders` (`src/response.ts:362-364`) são mesclados como hoje.

**Alternativa descartada:** travar o `Content-Type` depois da mesclagem. Seria mais estrito, mas criaria uma regra de precedência diferente da de `HTTPError` sem necessidade informada no PRD.

### D-06 — Tipo público da entrada: `ProblemInput`

```ts
export interface ProblemInput extends ErrorInput {
  type?: string;
  instance?: string;
}
```

**Alternativas consideradas:** reutilizar `ErrorInput` diretamente (perderia `type` e `instance` na checagem de tipo) ou `Omit<ErrorInput, ...>` (sem ganho).

**Escolha:** interface que estende `ErrorInput`. É o único tipo público novo, conforme `sdd/pedido.md`. `ErrorInput` não tem `type` nem `instance` (`src/error.ts:6-26`), então não há colisão.

### D-07 — Interação com `onError` e outros caminhos

- `onError` recebe o próprio erro devolvido por `problem()` (mesmo objeto, marcador preservado). Ele pode inspecionar o erro normalmente.
- Se `onError` devolver outro valor, a resposta segue esse valor (`src/response.ts:161-165`). O formato de problema **não** é preservado, porque o marcador está no erro original. Isso é intencional e fica documentado. Não há alteração em `toResponse` (fora de escopo, PRD).
- `adapters.ts` (`src/adapters.ts:122-152`) cria `HTTPError` com `unhandled: true` sem marcador. Continua no formato atual.
- JSON-RPC (`src/utils/json-rpc.ts:484-491`) tem envelope próprio. Um `problem()` lançado dentro de método JSON-RPC **não** vira `problem+json`; é tratado como qualquer `HTTPError` pelo envelope JSON-RPC. Fora de escopo, registrado nos riscos.

### D-08 — Localização dos arquivos novos

- `src/utils/problem.ts`: API pública (`problem`, `ProblemInput`). Fica em `utils/`, como os demais módulos públicos (`AGENTS.md`, estrutura).
- `src/utils/internal/problem.ts`: símbolo, tipo `ProblemMembers` e `toProblemJSON`. Internos (`AGENTS.md`: helpers internos em `utils/internal/`).
- `src/error.ts` **não** cresce. Já tem 237 linhas, acima do limite de ~200 da convenção.

---

## Arquivos a alterar

| Arquivo | Alteração | Referência no código |
| --- | --- | --- |
| `src/utils/problem.ts` | **Novo.** `ProblemInput` e `problem()`. | Modelo: `HTTPError.status` em `src/error.ts:144-150` |
| `src/utils/internal/problem.ts` | **Novo.** `kProblem`, `ProblemMembers`, `toProblemJSON`. | Modelo de símbolo com `Symbol.for`: `src/response.ts:94` |
| `src/response.ts` | `errorResponse` escolhe headers base e corpo conforme o marcador. Novo `problemHeaders` (`FrozenHeaders`) ao lado de `jsonHeaders`. | `src/response.ts:270-272`, `:358-380` |
| `src/index.ts` | Exportar `problem` e o tipo `ProblemInput` na seção `// Error`. | `src/index.ts:70-72` |
| `test/unit/package.test.ts` | Atualizar o snapshot inline: incluir `"problem"` entre `"parseCookies"` e `"proxy"`. | `test/unit/package.test.ts:6-8`, `:104-105` |
| `test/problem.test.ts` | **Novo.** Testes de integração em `describeMatrix`. | `test/_setup.ts:11` |
| `test/unit/problem.test-d.ts` | **Novo.** Testes de tipo de `problem()` (RF-02). | `vitest.config.mjs:6-8` (typecheck habilitado, `*.test-d.ts`) |
| `docs/1.guide/1.basics/6.error.md` | (Opcional, recomendado) Seção curta sobre `problem()`. | `docs/1.guide/1.basics/6.error.md:11` (seção `HTTPError`) |

**Não alterar:** `src/error.ts` (D-08), `src/adapters.ts`, `src/h3.ts`, `src/utils/json-rpc.ts`, `CHANGELOG.md` (gerado pelo `changelogen`).

### Mudança em `src/response.ts` (descrição)

`errorResponse` (`src/response.ts:358-380`) hoje faz:

- `headers` = `mergeHeaders(jsonHeaders, error.headers)` ou `new Headers(jsonHeaders)`, depois `errHeaders`;
- corpo = `JSON.stringify({ ...error.toJSON(), stack })`.

Com a mudança:

- Se `error[kProblem]` existir: base = `problemHeaders`; corpo = `toProblemJSON(error, members)` no lugar de `error.toJSON()`.
- Caso contrário: exatamente o código atual.
- `stack` continua sendo acrescentado só em `debug`, nos dois formatos (extensão, como `stack` hoje).
- `status`, `statusText` e `FastResponse` não mudam (`src/response.ts:362-379`).

`prepareResponse` (`src/response.ts:146-174`) não muda. Em particular, `error.unhandled` continua sendo definido só para erros não-`HTTPError` (`src/response.ts:149-155`), então um `problem({ unhandled: true })` já chega com `unhandled` do próprio input (`src/error.ts:205-206`).

---

## Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";
import { kProblem, type ProblemMembers } from "./internal/problem.ts";

/**
 * Input for {@link problem}: the `HTTPError` input plus RFC 9457 members.
 */
export interface ProblemInput extends ErrorInput {
  /** URI identifying the problem type. Serialized as `type` (defaults to `about:blank`). */
  type?: string;
  /** URI reference identifying this occurrence. Serialized as `instance`. */
  instance?: string;
}

/**
 * Create an `HTTPError` whose response is rendered as RFC 9457 problem details.
 */
export function problem(input: ProblemInput): HTTPError {
  const error = new HTTPError(input);
  Object.defineProperty(error, kProblem, {
    value: { type: input.type, instance: input.instance } satisfies ProblemMembers,
  });
  return error;
}
```

```ts
// src/utils/internal/problem.ts
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemMembers {
  type?: string;
  instance?: string;
}

/**
 * Build the RFC 9457 JSON body for an `HTTPError` created by `problem()`.
 * Extension members (`body`) come first, so RFC members win on collision.
 */
export function toProblemJSON(error: HTTPError, members: ProblemMembers): Record<string, unknown>;
```

Assinatura de uso interno em `errorResponse` (`src/response.ts`):

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

Entrada/saída observável (contrato HTTP):

| Entrada | Status | Content-Type | Corpo (membros) |
| --- | --- | --- | --- |
| `problem({ status: 422, statusText: "Unprocessable Content", message: "Saldo insuficiente", type: "https://exemplo.com/erros/saldo", instance: "/transferencias/7" })` | 422 | `application/problem+json` | `type`, `title`, `status`, `detail`, `instance` |
| `problem({ status: 409, message: "Conflito" })` | 409 | `application/problem+json` | `type: "about:blank"`, `status`, `detail`; sem `title` nem `instance` |
| `problem({ status: 500, message: "Falha no banco", unhandled: true })` | 500 | `application/problem+json` | `type`, `status`, `unhandled: true`; sem `detail` |
| `problem({ status: 999, message: "x", headers: { "retry-after": "30" } })` | 500 | `application/problem+json` | `status: 500`; header `retry-after: 30` |
| `new HTTPError({ status: 409, message: "Conflito" })` | 409 | `application/json;charset=UTF-8` | formato atual, inalterado |

Mudanças de API pública: somente `problem` e `ProblemInput`. Nenhuma assinatura existente muda.

---

## Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md` ("Bug Fix Workflow") adaptado a funcionalidade nova:

1. **Caracterização antes da mudança (RF-05).** Antes de editar `src/response.ts`, escrever em `test/problem.test.ts` um teste que fixa o corpo e o `Content-Type` atuais de `new HTTPError({ status: 409, message: "Conflito" })`, `HTTPError.status(...)` e erro não tratado. Rodar e confirmar que passa no código atual. Ele deve continuar passando depois.
2. **Testes novos antes da implementação.** Escrever os testes de RF-01 a RF-07 e confirmar que falham (`problem` inexistente ou formato errado).
3. **Implementar** (D-01 a D-08).
4. **Confirmar** que todos passam.
5. **Suíte ampla:** `pnpm vitest run`, depois `pnpm lint`, `pnpm typecheck`.

Casos em `test/problem.test.ts`, usando `describeMatrix("problem", (t, { it, expect }) => ...)` (`test/_setup.ts:11`), que roda em `web` e `node`:

- Lançar e retornar `problem(...)`: ambos produzem a mesma resposta (RF-01, RF-03).
- Corpo completo: `type`, `title`, `status`, `detail`, `instance` com os valores do exemplo de RF-03.
- `type` ausente vira `"about:blank"`; `title` ausente é omitido, sem a chave; `instance` ausente é omitido.
- Extensão via `body`: `body: { code: "X" }` aparece no nível superior.
- Precedência: `body: { status: 999, type: "x", detail: "y" }` não altera `status`, `type` nem `detail`.
- `Content-Type` exatamente `application/problem+json` (RF-04).
- `HTTPError` comum mantém `application/json;charset=UTF-8` e o formato antigo (RF-04, RF-05). Coberto pelo caso de caracterização.
- `unhandled: true`: corpo sem `detail`, sem a mensagem, sem membros de `body` (RF-06). Também confirmar que `unhandled` aparece.
- `status: 999` vira 500 (RF-07); `headers: { "retry-after": "30" }` presente (RF-07).
- `HTTPError.isError(problem(...))` é `true` (RF-01). Testar na unidade ou via `t.errors`.
- `onError` recebe o erro de `problem()`; se devolver outro valor, a resposta segue esse valor (D-07).
- `debug: true`: `stack` continua presente nos dois formatos.
- Ausência de `kProblem` enumerável: `Object.keys(problem({ status: 400, message: "x" }))` não inclui o marcador e `JSON.stringify(error)` não muda em relação a `HTTPError`.

Teste de tipo em `test/unit/problem.test-d.ts` (RF-02):

- `problem({ status: 404, message: "x", type: "https://...", instance: "/a/1" })` compila.
- `// @ts-expect-error` em `problem({ status: 404, message: "x", foo: 1 })` (propriedade desconhecida, para garantir que a entrada não é aberta).
- Retorno é `HTTPError` (`expectTypeOf(problem({...})).toEqualTypeOf<HTTPError>()`).

Atualizar `test/unit/package.test.ts` (snapshot inline, linhas 6-158): adicionar `"problem"`. Esse é o único teste existente que muda, e a mudança é exatamente o novo export (pedido: "ajuste só os testes existentes que dependem do que a sua mudança altera").

Testes existentes que **não** devem mudar: `test/errors.test.ts:137-151` (content-type JSON e corpo de `HTTPError`), `test/errors.test.ts:257`, `:309`, `:350`, `:384`, `:420`, `:442` (formato de erros não tratados). Se algum desses falhar, a mudança quebrou RF-05 e deve ser corrigida no código, não no teste.

Cobertura: `vitest.config.mjs` inclui `src/**/*.ts` no coverage. Os caminhos novos (`problem`, `toProblemJSON`, ramo de `errorResponse`) devem ser exercitados pelos testes acima.

---

## Riscos

| # | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Mapeamento `title` ← `statusText` e `detail` ← `message` pode não bater com o que clientes RFC 9457 esperam. Mudar depois quebra integrações. | Premissa explícita no PRD. Confirmar com o dono do contrato **antes** de implementar (PRD, Premissas). Documentar no `6.error.md`. |
| R-02 | Marcador vazar para erros comuns e mudar o formato sem aviso (violação RF-05). | Símbolo não enumerável, definido só em `problem()`. Teste de caracterização (passo 1 da estratégia) e teste de `Object.keys`/`JSON.stringify`. |
| R-03 | Colisão `body` × membros RFC. | Precedência fixa em D-04 e testes de precedência. |
| R-04 | `detail` ou `message` vazarem em `unhandled` (RF-06). | `toProblemJSON` reutiliza a mesma condição de `toJSON` (`src/error.ts:232-234`). Teste dedicado. |
| R-05 | Clientes que validam `Content-Type` estritamente como `application/json` falham com a resposta nova. | Formato só para erros de `problem()`; é o comportamento pedido (RF-04). Registrar na documentação. |
| R-06 | `onError` que devolve outro valor perde o formato de problema. | Comportamento intencional (D-07); coberto por teste. Documentar. |
| R-07 | `problem()` lançado dentro de JSON-RPC não vira `problem+json` (`src/utils/json-rpc.ts:484-498`). | Fora de escopo (PRD). Registrar como limitação conhecida. |
| R-08 | `headers` de `problem()` podem sobrescrever `Content-Type` (D-05). | Consistente com `HTTPError`. Se o PRD quiser travar, trocar a ordem de mesclagem em `errorResponse` e ajustar um teste. |
| R-09 | `Symbol.for` cria acoplamento global entre cópias do h3. | Mesmo padrão de `kHTTPResponse` (`src/response.ts:94`). Aceito. |
| R-10 | Snapshot de exports (`test/unit/package.test.ts`) muda. | Mudança esperada e limitada a `"problem"`. Revisar o diff do snapshot no PR. |
| R-11 | `HTTPError.isError` depende de `name === "HTTPError"` (`src/error.ts:75-77`, `:129-133`). | `problem()` reutiliza a classe, então o nome é mantido. Teste de `isError`. |
| R-12 | `lint`/`typecheck`: `isolatedDeclarations` exige tipo de retorno explícito em exports (`AGENTS.md`, TypeScript). | `problem(): HTTPError` explícito; `toProblemJSON` com tipo de retorno explícito. |
