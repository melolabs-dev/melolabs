# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-08).

## 1. Resumo

Toda resposta de erro do h3 passa a sair como `application/problem+json`, com `type`, `title`, `status`, `detail` e `instance`. A serialização continua centralizada em `HTTPError.toJSON()`, e `errorResponse()` continua acrescentando `stack` apenas em modo debug. `HTTPError` ganha os campos `type` e `instance`. Os membros de extensão atuais (`message`, `statusText`, `unhandled`, `data`, `body`) são preservados. Nenhuma opção de configuração nova é criada.

## 2. Estado atual

- `HTTPError` define o corpo de erro em `toJSON()`, que devolve `status`, `statusText`, `unhandled`, `message`, `data` e os membros de `body`: `src/error.ts:226-236`. Para erros `unhandled`, `message` vira `"HTTPError"` e `data`/`body` somem: `src/error.ts:227-234`.
- `errorResponse()` monta a resposta: `src/response.ts:358-380`. Usa `jsonHeaders` (`application/json;charset=UTF-8`, `src/response.ts:270-272`), mescla `error.headers` (`src/response.ts:360-361`) e adiciona `stack` quando `debug` está ativo (`src/response.ts:368-369`).
- `errorResponse()` é chamado em `prepareResponse()`: `src/response.ts:173`. Erros não-`HTTPError` são marcados como `unhandled` em `src/response.ts:150-151`.
- O corpo de sucesso JSON usa `jsonHeaders` também: `src/response.ts:311`. Esse caminho **não** muda.
- `statusText` é sanitizado no construtor (`src/error.ts:180-185`), e `headers` e `unhandled` herdam de `cause` (`src/error.ts:202-206`). Esse é o padrão a seguir para os campos novos.
- `STATUS_TEXT` (`src/utils/response.ts:347-354`) é uma tabela de seis entradas, de propósito restrita a 204 e redirects (comentário em `src/utils/response.ts:346`). Não cobre 404 nem 500, e importá-la de `error.ts` criaria um ciclo `response.ts → error.ts → utils/response.ts → response.ts`.
- `json-rpc` não chama `toJSON()`. Ele só cita a máscara de `unhandled` em comentário: `src/utils/json-rpc.ts:480-486`. Esse comentário continua verdadeiro depois da mudança.
- `pnpm lint` (`package.json:46`) roda só oxlint e oxfmt. O typecheck é o script separado `pnpm typecheck` (`package.json:54`), e `pnpm test` roda os dois (`package.json:53`). O AGENTS.md diz que `pnpm lint` inclui typecheck, o que não bate com o `package.json`. A spec exige rodar os dois comandos.

## 3. Decisões de arquitetura

### D-01 — Serialização única em `HTTPError.toJSON()`

**Escolha:** `toJSON()` passa a devolver o corpo problem details. `errorResponse()` só acrescenta `stack` quando `debug` está ativo, como hoje.

**Alternativas consideradas:**
- (a) Criar um helper interno `toProblemDetails(error, debug)` e manter `toJSON()` no formato antigo. Rejeitada: deixa dois formatos de erro no código, e `JSON.stringify(err)` continuaria diferente do corpo HTTP.
- (b) Mudar `toJSON()` e manter `errorResponse()` como montador de headers e status. **Escolhida.**

**Justificativa:** `toJSON()` já é a única fonte do corpo de erro. Mudá-lo mantém uma fonte só. O efeito colateral é que `JSON.stringify(httpError)` muda de forma. Isso está listado em Riscos (R-02).

### D-02 — `Content-Type` exato `application/problem+json`, sem charset

**Escolha:** constante nova `problemHeaders` em `src/response.ts`, logo após `jsonHeaders`, com `content-type: application/problem+json`. Só `errorResponse()` a usa. `jsonHeaders` continua para o sucesso.

**Alternativas consideradas:**
- `application/problem+json;charset=UTF-8`, como `jsonHeaders`. Rejeitada: RF-01 pede o valor exato, e a RFC 9457 usa JSON, que é UTF-8 por padrão (RFC 8259). O sufixo `;charset` não é necessário.

### D-03 — Membros de extensão preservados

**Escolha:** o corpo mantém `message` (espelha `detail`), `statusText`, `unhandled`, `data` e os membros de `body`, além dos campos RFC.

**Alternativas consideradas:**
- Remover `statusText` por ser redundante com `title`. Rejeitada: quebra `test/app.test.ts:205`, `test/errors.test.ts:53-56`, `test/errors.test.ts:79-81`, `test/body.test.ts:457`, `test/proxy.test.ts:1027` e contraria "não quebrar o que já existe" (`sdd/pedido.md`, Restrições).
- Remover `unhandled`. Rejeitada: já é exposto hoje e aparece em `test/errors.test.ts:257`, `:309`, `:350`, `:384`, `:420` e `:442`.

### D-04 — Membros RFC não podem ser sobrescritos por `body`

**Escolha:** `...this.body` vai primeiro na montagem do objeto. Depois vêm os membros do h3, que vencem em caso de nome repetido.

**Alternativas consideradas:**
- Manter `...this.body` por último, como hoje (`src/error.ts:234`). Rejeitada: com `type`, `title`, `detail` e `instance` no corpo, um `body` mal montado poderia forjar o tipo do problema. Hoje `body` já consegue sobrescrever `status`.

**Efeito colateral:** `body.message`, `body.data` e `body.statusText` deixam de sobrescrever os valores do h3. É uma mudança de comportamento pequena e precisa ser citada no changelog (R-03).

### D-05 — `title` com tabela completa de frases em módulo interno novo

**Escolha:** `src/utils/internal/status-text.ts` (novo) exporta `getReasonPhrase(status)`. A tabela cobre as frases RFC 9110 de 4xx e 5xx. `title` vem de `statusText` quando existe; senão, de `getReasonPhrase(status)`. Se nenhum dos dois existir, `title` fica ausente, o que a RFC permite.

**Alternativas consideradas:**
- Reutilizar `STATUS_TEXT` de `src/utils/response.ts`. Rejeitada: a tabela é restrita por desenho, e o import cria ciclo (ver seção 2).
- Usar um título genérico como `"Error"`. Rejeitada: RF-02 pede o texto padrão do status.
- Mover `STATUS_TEXT` para o módulo novo e usar nos dois lugares. Rejeitada: mudaria o comportamento de `utils/response.ts`, que hoje não dá frase para códigos fora da tabela de propósito.

### D-06 — `type` e `instance` como strings, sem validação

**Escolha:** `type?: string` e `instance?: string` em `ErrorBody`. Na instância, são lidos de `details` com fallback para `details.cause`, como `statusText` e `headers`. Sem validação de URI. No corpo, `type` ausente vira `"about:blank"`, e `instance` ausente é omitido.

**Alternativas consideradas:**
- Validar com `URL.canParse` e cair para `about:blank` quando inválido. Rejeitada: a RFC 9457 (§3.1.1) define `type` como *URI reference*, então valores relativos são válidos. A validação não adiciona segurança e custa uma chamada por erro. O PRD (Riscos) marcou o tema como pendente: fica registrado aqui como "sem validação, documentado no JSDoc".

### D-07 — Erros `unhandled` não vazam detalhes

**Escolha:** para `unhandled`, `detail` e `message` valem `"HTTPError"`. `data` e `body` somem. `title` cai na frase padrão do status (500 → `"Internal Server Error"`). `type` e `instance` só aparecem se o app os informou, o que para `toError()` nunca acontece (`src/response.ts:80`).

**Alternativas consideradas:**
- Omitir `detail` para erros `unhandled`. Rejeitada: a regra de RF-07 diz que `message` espelha `detail`, e o valor fixo `"HTTPError"` já é o que o h3 expõe hoje (`test/errors.test.ts:350`).

### D-08 — Mantidos sem mudança

- `stack` continua em `errorResponse()` (`src/response.ts:368-369`), somente com `debug` (RF-05). `debug` vem de `src/types/h3.ts:32`.
- Status HTTP e `error.headers` continuam como estão (RF-06).
- O caminho de `onError` não muda (`src/response.ts:161-166`).

## 4. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `src/error.ts` | Adicionar `type?` e `instance?` em `ErrorBody` (`:30-69`) com JSDoc. Atualizar o JSDoc que diz que `message` vai "under `message` key" (`:47-49`) e o TIP de `statusText` (`:42`). Adicionar campos `readonly type` e `readonly instance` na classe (perto de `:107-112`). Preencher os campos no construtor (perto de `:208-209`). Reescrever `toJSON()` (`:226-236`). Importar `getReasonPhrase`. |
| `src/response.ts` | Criar `problemHeaders` após `jsonHeaders` (`:270-272`). Trocar `jsonHeaders` por `problemHeaders` em `errorResponse()` (`:359-361`). Não mexer no caminho de sucesso (`:311`). |
| `src/utils/internal/status-text.ts` | **Novo.** Tabela de frases RFC 9110 para 4xx e 5xx e a função `getReasonPhrase`. Sem imports, para não criar ciclo. |
| `test/errors.test.ts` | Ajustar `:44` (`application/json;charset=UTF-8` → `application/problem+json`) e `:140` (`toMatch("application/json")` → `toMatch("application/problem+json")`). Nenhum outro teste existente precisa mudar, ver seção 7. |
| `test/problem-details.test.ts` | **Novo.** Testes de RF-01 a RF-07 e de D-04, com `describeMatrix`. |

Não é preciso mudar `src/index.ts` (`:72` já exporta `ErrorBody`, `ErrorInput` e `HTTPError`) nem `src/utils/json-rpc.ts`. `AGENTS.md` não descreve o formato de erro, então não precisa de atualização por causa desta mudança.

## 5. Contratos e assinaturas

```ts
// src/error.ts

export interface ErrorBody<DataT = unknown> {
  // ... campos existentes (status, statusText, message, unhandled, data, body)

  /**
   * RFC 9457 `type`: URI reference que identifica o tipo do problema.
   * No corpo da resposta, ausente vira `about:blank`.
   */
  type?: string;

  /**
   * RFC 9457 `instance`: URI reference que identifica esta ocorrência do problema.
   */
  instance?: string;
}

// ErrorInput extends Partial<ErrorBody>, então já aceita type e instance. Nada muda nele.

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** RFC 9457 `type`, herdado de `cause` quando ausente. */
  readonly type: string | undefined;

  /** RFC 9457 `instance`, herdado de `cause` quando ausente. */
  readonly instance: string | undefined;

  /**
   * Corpo problem details (RFC 9457) sem `stack`. `stack` é acrescentado por `errorResponse()` só em debug.
   * Membros: type, title, status, detail, instance, message, statusText, unhandled, data, e os de `body`.
   */
  toJSON(): Record<string, unknown>;
}
```

Construtor, depois de `this.body = ...` (`src/error.ts:209`):

```ts
this.type = (details as ErrorBody)?.type ?? (details?.cause as ErrorBody)?.type ?? undefined;
this.instance =
  (details as ErrorBody)?.instance ?? (details?.cause as ErrorBody)?.instance ?? undefined;
```

`toJSON()`:

```ts
toJSON(): Record<string, unknown> {
  const unhandled = this.unhandled;
  const message = unhandled ? "HTTPError" : this.message;
  return {
    ...(unhandled ? undefined : this.body), // D-04: corpo primeiro, membros do h3 vencem
    type: this.type ?? "about:blank",
    title: this.statusText ?? getReasonPhrase(this.status),
    status: this.status,
    detail: message,
    instance: this.instance,
    message,
    statusText: this.statusText,
    unhandled,
    data: unhandled ? undefined : this.data,
  };
}
```

`Record<string, unknown>` evita um tipo exportado novo e não exige nome público adicional, o que é compatível com `isolatedDeclarations`.

```ts
// src/utils/internal/status-text.ts

/** Frases de razão RFC 9110 para 4xx e 5xx. */
const REASON_PHRASES: Record<number, string> = { /* 400: "Bad Request", ... 511: "Network Authentication Required" */ };

export function getReasonPhrase(status: number): string | undefined;
```

```ts
// src/response.ts

const problemHeaders: FrozenHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  // Mesma forma de hoje, trocando jsonHeaders por problemHeaders.
  // Corpo: { ...error.toJSON(), stack: debug && error.stack ? [...] : undefined }
}
```

Nenhum nome público novo. `getReasonPhrase` e `problemHeaders` são internos.

## 6. Mapeamento de campos

| Campo do corpo | Origem | Presença |
|---|---|---|
| `type` | `error.type` | sempre (padrão `about:blank`) |
| `title` | `statusText` → `getReasonPhrase(status)` | se houver texto |
| `status` | `status` | sempre |
| `detail` | `message` (`"HTTPError"` se `unhandled`) | sempre |
| `instance` | `error.instance` | só se informado |
| `message` | igual a `detail` | sempre (extensão) |
| `statusText` | `statusText` | se houver (extensão) |
| `unhandled` | `unhandled` | se `true` (extensão) |
| `data` | `data` | se não `unhandled` (extensão) |
| membros de `body` | `body` | se não `unhandled` (extensão, sem sobrescrever RFC) |
| `stack` | `error.stack` | só com `debug` |

## 7. Estratégia de testes

Seguir o fluxo de bug fix do AGENTS.md: escrever os testes novos primeiro e confirmar que falham antes de mudar `src/`.

**Testes novos** (`test/problem-details.test.ts`, `describeMatrix`, web e node):

- RF-01: `throw HTTPError.status(404)` responde `content-type` igual a `application/problem+json` e corpo JSON válido.
- RF-02: `new HTTPError({ status: 403, statusText: "Forbidden", message: "Não autenticado" })` gera `status: 403`, `title: "Forbidden"`, `detail: "Não autenticado"`, `type: "about:blank"`.
- RF-02 (título padrão): `HTTPError.status(404)` sem `statusText` gera `title: "Not Found"`.
- RF-02 (`instance` ausente): a chave `instance` não existe no corpo quando não informada.
- RF-03: `new HTTPError({ status: 422, message: "Inválido", type: ..., instance: "/pedidos/42" })` expõe `error.type` e `error.instance`. Herança de `cause` também.
- RF-04: erro `unhandled` com mensagem "senha do banco inválida": corpo sem essa string, sem `stack`, sem `data`, com `detail: "HTTPError"`, status 500.
- RF-05: com `t.app.config.debug = true` (padrão de `test/_setup.ts:136`), `stack` é array de strings; com `debug` desligado, não existe a chave `stack`.
- RF-06: `HTTPError.status(429, "Too Many Requests", { headers: { "retry-after": "30" } })` responde 429, `retry-after: 30` e `content-type: application/problem+json`.
- RF-07: `new HTTPError({ status: 400, message: "Campo obrigatório", data: {campo: "nome"}, body: {codigo: "E01"} })` gera `data`, `codigo` no topo e `message` igual a `detail`.
- D-04: `body` com `{ type: "forjado", title: "x" }` não altera `type` nem `title` do corpo.
- Guarda de regressão: `return { a: 1 }` continua com `content-type: application/json;charset=UTF-8`, sem tocar no sucesso.
- Unitário opcional (`test/unit/`): `getReasonPhrase(404)` vale `"Not Found"`, e `getReasonPhrase(499)` vale `undefined`.

**Testes existentes a ajustar** (somente os que checam o formato antigo):

- `test/errors.test.ts:44` e `:140`, como descrito na seção 4.

**Testes existentes que devem passar sem mudança** (verificado por leitura):

- `test/errors.test.ts:53-57`, `:79-85`, `:99-104`, `:119-121`, `:144-150`, `:257`, `:309`, `:350`, `:384`, `:420`, `:442`: `status`, `statusText`, `message`, `data`, `topLevel`, `unhandled` continuam presentes.
- `test/app.test.ts:198-205`: `statusText` no corpo continua `"test"`.
- `test/body.test.ts:457-458`: `statusText` e `stack[0]` continuam. O teste roda com `debug: true`.
- `test/proxy.test.ts:1024-1028`: `statusText` e `message` continuam.
- `test/dist.test.ts:57`, `test/iterable.test.ts:145`, `test/rules/cache.test.ts:251`: leem `message`, que continua presente. `test/dist.test.ts` roda sobre o build; confirmar se precisa de `pnpm build` antes.
- `test/router.test.ts:422` é de sucesso, então não muda.

**Comandos de verificação:**

```bash
pnpm vitest run test/errors.test.ts test/problem-details.test.ts   # foco
pnpm vitest run                                                    # suíte completa
pnpm lint                                                          # oxlint + oxfmt --check
pnpm typecheck                                                     # tsc --noEmit
pnpm build && pnpm bench:node                                      # opcional: impacto de payload em erros
```

## 8. Riscos

- **R-01 — Quebra de consumidores (médio).** Clientes que checam `application/json` ou o conjunto exato de chaves podem quebrar. A spec mitiga mantendo os membros de extensão (D-03). O PRD exige confirmar com o responsável antes do merge. **Pendente.**
- **R-02 — `toJSON()` público muda (médio).** `JSON.stringify(httpError)` deixa de produzir o formato antigo. Está coberto por D-01 e precisa constar no changelog.
- **R-03 — Precedência de `body` (baixo).** Apps que usavam `body` para sobrescrever `message`, `data` ou `statusText` deixam de conseguir (D-04). Caso raro; citar no changelog.
- **R-04 — Vazamento em erros `unhandled` (alto se errado).** Coberto por D-07 e pelo teste de RF-04.
- **R-05 — Payload maior (baixo).** Cada erro ganha `type`, `title`, `detail` e `instance`. Medir com `pnpm bench:node`, como pede o PRD.
- **R-06 — Tabela de frases desatualizada (baixo).** A tabela é estática. Só entram frases RFC 9110, e o custo de manutenção é pequeno.
- **R-07 — `title` ausente para códigos fora da tabela (baixo).** Ex.: 499 sem `statusText` não gera `title`. A RFC permite.
- **R-08 — Ciclo de import (baixo).** Evitado com `status-text.ts` sem imports (D-05).
- **R-09 — Lint sem typecheck (baixo).** `pnpm lint` não roda `tsc`, apesar do AGENTS.md. Rodar `pnpm typecheck` explicitamente.

## 9. Pontos a confirmar com o responsável

1. Aceitar a quebra de `content-type` (R-01) ou manter `application/json` para clientes antigos. A spec segue o PRD, que pede `application/problem+json` para todos os erros.
2. Aprovar D-04 (precedência de `body`) e a mudança de `toJSON()` (D-01).
