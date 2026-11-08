# Especificação técnica — Problem details (RFC 9457) por utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-08), issue h3js/h3#1384.

## 1. Contexto no código atual

- `HTTPError` guarda `status`, `statusText`, `message`, `data`, `body`, `headers`, `unhandled` e `cause` (`src/error.ts:74`, campos em `src/error.ts:82-119`). O construtor copia esses campos a partir de `details` e usa `details` como `cause` (`src/error.ts:162-210`, em especial `src/error.ts:196-197`).
- A serialização padrão é `HTTPError.toJSON()` (`src/error.ts:226-236`): mascara `message` e `data` e espalha `body` apenas quando o erro não é `unhandled`.
- O pipeline de resposta converte qualquer `Error` em `HTTPError` e chama `errorResponse` (`src/response.ts:146-148`, `src/response.ts:173`). Isso vale tanto para erro lançado quanto para erro devolvido, porque a checagem é `val instanceof Error` (`src/response.ts:146`) e não depende de `throw`.
- `errorResponse` monta o corpo com `error.toJSON()` mais `stack` em modo debug, e usa `jsonHeaders` (`src/response.ts:270-272`, `src/response.ts:358-380`, em especial `src/response.ts:368`).
- `onError` recebe o `HTTPError` já normalizado (`src/utils/middleware.ts:37-63`, `src/utils/middleware.ts:47-48`). Se o hook devolver um valor, esse valor segue por `prepareResponse`; se não devolver, o erro é relançado (`src/utils/middleware.ts:56-60`).
- JSON-RPC lê `unhandled` para mascarar mensagens (`src/utils/json-rpc.ts:484`). Não é afetado por esta mudança.
- Não existe nenhum símbolo ou nome `problem` no `src/`. O padrão de marca interna já existe: `kHTTPResponse` usa `Symbol.for` (`src/response.ts:94`).
- Superfície pública: `src/index.ts` exporta `HTTPError` na linha 72 e os utilitários por seção (`// Utils` em `src/index.ts:86`, `// Middleware` em `src/index.ts:131-133`).

## 2. Decisões de arquitetura

### D-01 — Onde fica a lógica de problem details

**Alternativas consideradas**

1. Adicionar um método público `toProblemJSON()` em `HTTPError`.
2. Criar uma subclasse `ProblemError extends HTTPError`.
3. Colocar a serialização em `src/utils/problem.ts`, com a marca e a renderização fora de `error.ts`, e chamar essa lógica a partir de `errorResponse`.

**Escolha: 3.** A alternativa 1 cria um nome público novo, o que `pedido.md` proíbe. A alternativa 2 também cria uma classe pública, e `HTTPError.isError` (`src/error.ts:129-133`) já aceita o erro pelo nome e pelo `status`, então a subclasse não é necessária. A opção 3 mantém `src/error.ts` intacto, o que protege RF-07.

### D-02 — Como marcar um erro criado por `problem()`

**Alternativas consideradas**

1. Campo novo em `HTTPError` (por exemplo `problem?: ...`). Mudaria a forma de `HTTPError` e apareceria em `{...error}`.
2. `WeakSet` interno com as instâncias de `problem()`. Não funciona entre cópias duplicadas do módulo.
3. Propriedade simbólica não enumerável com `Symbol.for("h3.problem")`, guardando `{ type, instance }`.

**Escolha: 3.** Segue o padrão de `kHTTPResponse` (`src/response.ts:94`): `Symbol.for` funciona entre cópias do módulo, e a propriedade não enumerável não aparece em `JSON.stringify` nem em `{...error}`. Como guarda `type` e `instance`, a informação RFC 9457 viaja junto com o erro sem tocar na classe. O símbolo não é exportado.

### D-03 — Quando a resposta muda de formato

**Alternativas consideradas**

1. Opção global em `H3Config` ou `onError` padrão. Fora de escopo no PRD.
2. Mudar `HTTPError.toJSON()` para todos os erros. Quebra RF-07.
3. Trocar o formato apenas em `errorResponse`, e só quando a marca de D-02 estiver presente.

**Escolha: 3.** Só as respostas de erros criados por `problem()` mudam, como exige o PRD. Erros `HTTPError` comuns passam pelo mesmo caminho de hoje, com o `toJSON()` existente.

### D-04 — Precedência de `Content-Type` e cabeçalhos

**Alternativas consideradas**

1. Usar a mesma mesclagem de `HTTPError`, em que `error.headers` sobrescreve o padrão e `errHeaders` vem por último (`src/response.ts:358-364`).
2. Forçar `application/problem+json` por último, depois de `error.headers` e de `errHeaders`.

**Escolha: 2.** RF-03 exige que o `Content-Type` seja `application/problem+json`. Se um `headers: { "Content-Type": ... }` ou um `event.res.errHeaders` pudesse trocar esse valor, o cliente receberia um formato que não corresponde ao corpo. Os demais cabeçalhos seguem a mesma regra de `HTTPError` (RF-05).

### D-05 — Forma do corpo problem details

**Alternativas consideradas**

1. Espalhar `body` por último, como em `toJSON()`. Permite que `body: { type: ... }` quebre os membros RFC.
2. Espalhar `body` primeiro, e depois os membros RFC (`type`, `title`, `status`, `detail`, `instance`). Os membros RFC sempre vencem.

**Escolha: 2.** Os membros reservados pela RFC não podem ser sobrescritos pelo `body` do usuário. Para `unhandled`, o corpo omite `detail`, `data` e `body`, como `toJSON()` faz, e não inclui a chave `unhandled`, para não expor a sinalização interna. `title` recebe `statusText` e é omitido quando ausente (premissa do PRD). `type` usa `"about:blank"` quando não informado (RF-02). A stack só aparece em modo `debug`, como hoje (`src/response.ts:369`).

### D-06 — Forma da entrada `ProblemInput`

**Alternativas consideradas**

1. Tipo novo independente, repetindo os campos de `ErrorInput`.
2. `interface ProblemInput extends ErrorInput` com `type` e `instance`.

**Escolha: 2.** Herda exatamente os campos de `HTTPError` (RF-01) e acrescenta só o que a RFC pede. Literais com campo desconhecido são rejeitados pelo TypeScript, porque é um tipo de interface, como exige RF-08. Os campos legados `statusCode` e `statusMessage` vêm junto por herança, com o mesmo comportamento de `HTTPError`.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/problem.ts` (novo) | `ProblemInput`, `problem()` e helpers internos (`kProblem`, `getProblemFields`, `problemBody`). |
| `src/response.ts` | `errorResponse` (`src/response.ts:358-380`) ramifica quando há marca de problema, troca o corpo e força `Content-Type`. |
| `src/index.ts` | Exporta `problem` e `type ProblemInput` em uma seção nova após `src/index.ts:72`. |
| `test/problem.test.ts` (novo) | Testes de integração com `describeMatrix`. |
| `test/unit/problem.test-d.ts` (novo) | Testes de tipo: `ProblemInput` e rejeição de campo desconhecido. |
| `docs/1.guide/1.basics/6.error.md` | Seção curta sobre `problem()` após `## HTTPError` (`docs/1.guide/1.basics/6.error.md:11`). Opcional para o PRD, recomendado para o usuário. |

Não alterar: `src/error.ts`, `src/utils/middleware.ts`, `src/utils/json-rpc.ts`, `src/adapters.ts`. Os testes existentes em `test/errors.test.ts` não precisam de ajuste, porque o caminho de `HTTPError` comum não muda.

### Detalhe por arquivo

- `src/response.ts:146-173`: nenhuma mudança no fluxo. A marca é lida dentro de `errorResponse`, então `throw`, `return`, `onError` e erros não tratados já estão cobertos.
- `src/response.ts:358-380`: é o único ponto de bifurcação. O `Content-Type` é ajustado com `headers.set` depois de `errHeaders` (`src/response.ts:362-364`).
- `src/index.ts:72`: a nova linha de exportação entra depois da exportação de erro, para manter a ordem das seções.

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts

import { HTTPError, type ErrorInput } from "../error.ts";

/**
 * Entrada de `problem()`. Mesmos campos de `ErrorInput`, mais os campos RFC 9457.
 */
export interface ProblemInput extends ErrorInput {
  /**
   * URI que identifica o tipo do problema. Na resposta, o padrão é `"about:blank"`.
   */
  type?: string;

  /**
   * URI que identifica a ocorrência do problema. Vai para o membro `instance`.
   */
  instance?: string;
}

/**
 * Cria um `HTTPError` que é serializado como problem details (RFC 9457) quando
 * devolvido ou lançado por um handler.
 */
export function problem(input: ProblemInput): HTTPError;

// ---- internos (não exportados em src/index.ts) ----

/** Marca interna, no mesmo padrão de `kHTTPResponse`. */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

export interface ProblemFields {
  type?: string;
  instance?: string;
}

/** Devolve os campos RFC 9457 se o erro veio de `problem()`, senão `undefined`. */
export function getProblemFields(error: HTTPError): ProblemFields | undefined;

/** Monta o corpo problem details. Membros RFC vencem os de `body`. */
export function problemBody(error: HTTPError, fields: ProblemFields): Record<string, unknown>;
```

```ts
// src/response.ts — assinatura inalterada, comportamento novo quando há marca

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
```

```ts
// src/index.ts — exportação nova
export { problem, type ProblemInput } from "./utils/problem.ts";
```

### Comportamento de `problem(input)`

1. Separa `type` e `instance` do restante de `input`.
2. Cria `new HTTPError(rest)`. Com isso, `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause` e `unhandled` seguem exatamente as regras de `HTTPError`.
3. Define `kProblem` na instância com `{ type, instance }`, como propriedade não enumerável.

### Comportamento de `problemBody(error, fields)`

```ts
// unhandled: apenas status e title, sem detail, data nem body
{ type: fields.type ?? "about:blank", title: error.statusText, status: error.status, instance: fields.instance }

// handled: body espalhado primeiro, membros RFC por último
{ ...error.body, type, title: error.statusText, status, detail: error.message, instance, data: error.data }
```

- `title` fica `undefined` quando `statusText` não foi informado, e `JSON.stringify` o omite (PRD, premissas).
- `instance` fica `undefined` quando não foi informado, e é omitido.
- `data` é omitido quando `undefined` (RF-04).

### Comportamento de `errorResponse` com marca

1. `headers` é montado como hoje a partir de `jsonHeaders`, `error.headers` e `errHeaders`.
2. Depois da mesclagem, `headers.set("content-type", "application/problem+json")` (D-04).
3. O corpo é `problemBody(error, fields)` no lugar de `error.toJSON()`. A chave `stack` continua sendo acrescentada em modo `debug`.
4. `status` e `statusText` vêm do erro, como hoje (`src/response.ts:373-376`).

## 5. Estratégia de testes

Seguindo `AGENTS.md` (fluxo de bug fix adaptado a feature): escrever os testes primeiro, confirmar que falham por `problem` não existir, e só então implementar.

### 5.1 Testes de integração — `test/problem.test.ts`

Usar `describeMatrix` (`test/_setup.ts:11-38`), que roda em `web` e `node`. Como em `test/errors.test.ts:6`, cada teste registra handlers em `t.app` e usa `t.fetch`.

| Teste | Cobre |
| --- | --- |
| Lança `problem({ status: 422, statusText: "Dados inválidos", message: "E-mail é obrigatório" })` | RF-03: status, `Content-Type`, `title`, `detail` |
| Devolve (não lança) um `problem()` | Premissa do PRD sobre `return` (`src/response.ts:146`) |
| `type` e `instance` informados | RF-02 |
| `type` ausente gera `"about:blank"` | RF-02 |
| `data` e `body` no nível esperado | RF-04 |
| `body` com chave `type` ou `status` não sobrescreve os membros RFC | D-05 |
| `headers: { "Retry-After": "30" }` | RF-05 |
| `Content-Type` continua `application/problem+json` mesmo com `headers: { "Content-Type": "text/plain" }` | D-04 |
| `event.res.errHeaders.set("content-type", ...)` não troca o `Content-Type` | D-04 |
| `unhandled: true` esconde `message`, `data` e `body`, e mantém `status` | RF-06 |
| `unhandled: true` não tem a chave `unhandled` no corpo | D-05 |
| `debug: true` acrescenta `stack` | Paridade com `errorResponse` |
| `onError` recebe o `HTTPError` com marca e pode devolver outra resposta | Premissa de hooks (PRD, riscos) |
| `HTTPError.status(404, "Not Found")` sem `problem()` continua `application/json;charset=UTF-8` com o corpo de `toJSON()` | RF-07 (regressão) |

Para RF-07, comparar a saída com `error.toJSON()` por chave, em vez de copiar um snapshot solto. Reutilizar `test/errors.test.ts:44` como referência do `Content-Type` padrão.

### 5.2 Testes de tipo — `test/unit/problem.test-d.ts`

Seguir o padrão de `test/unit/types.test-d.ts:12` (`expectTypeOf`).

- `problem({ status: 404, message: "x", campoInexistente: 1 })` falha com `@ts-expect-error` (RF-08).
- `ProblemInput` aceita `type` e `instance` como `string`.
- `problem(...)` retorna `HTTPError`.

Como `tsconfig.json:25` inclui `test`, o `@ts-expect-error` também é verificado por `pnpm typecheck`.

### 5.3 Regressão existente

- `pnpm vitest run test/errors.test.ts` deve passar sem alteração.
- `pnpm vitest run test/json-rpc.test.ts` deve passar, porque `HTTPError` não muda.
- Rodar `pnpm vitest run` completo antes de encerrar.

### 5.4 Verificação final

```bash
pnpm vitest run test/problem.test.ts test/errors.test.ts
pnpm typecheck
pnpm lint
pnpm test    # suíte completa com cobertura
```

## 6. Riscos

| Risco | Efeito | Mitigação |
| --- | --- | --- |
| Erro de `problem()` reencapsulado em `new HTTPError({ cause: err })` (por exemplo em `src/adapters.ts:122-152`) perde a marca | A resposta volta ao formato padrão sem aviso | Documentar. A marca vale para o erro devolvido ou lançado diretamente. Não tratar agora. |
| Vazamento de `message`, `data` ou `body` em erro `unhandled` | Exposição de informação interna | `problemBody` usa a mesma regra de `toJSON()`; teste de RF-06 e teste de `body` no caso `unhandled`. |
| `body` do usuário sobrescrever membros RFC | Corpo fora da RFC | D-05: membros RFC vêm por último; teste dedicado. |
| Cliente que espera `application/json` em rota que passou a usar `problem()` | Quebra de consumo | Formato é opt-in por rota. Documentar em `docs/1.guide/1.basics/6.error.md`. |
| `errHeaders` ou `headers` trocarem `Content-Type` | Cliente recebe o tipo errado | D-04: `set` por último; testes dedicados. |
| Campo `unhandled` ou `stack` vazar via `debug` | Exposição de detalhes | Stack só em `debug`, como hoje. Não há campo novo para `unhandled`. |
| Nome extra exportado | Viola RF-08 | `kProblem`, `getProblemFields` e `problemBody` ficam fora de `src/index.ts`. Revisar a exportação no PR. |
| Símbolo com `Symbol.for` conflitar com outra lib | Improvável | Nome `h3.problem`, no mesmo padrão já usado em `src/response.ts:94`. |
| `ErrorInput` herdar `statusCode`/`statusMessage` deprecated | Superfície antiga em `problem()` | Aceito por consistência com `HTTPError`; sem novo nome público. |

## 7. Pendências e escolhas registradas

- `problem()` não valida o formato de `type` nem de `instance` (fora de escopo, PRD).
- Corpo `unhandled` não inclui `unhandled: true`. É uma escolha de D-05, para não expor a sinalização interna. O PRD não exige esse campo.
- A atualização da documentação em `docs/` não está no PRD. Fica como item opcional da lista de arquivos.
