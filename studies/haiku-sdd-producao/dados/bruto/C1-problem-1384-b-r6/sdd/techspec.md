# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Fontes: `sdd/pedido.md` (contrato #1384-B), `sdd/prd.md` (RF-01 a RF-10).
Status: rascunho para revisão. Nenhum arquivo do projeto foi alterado nesta etapa.

---

## 1. Resumo

Toda resposta de erro do h3 passa a ter corpo `application/problem+json` (RFC 9457). A serialização
continua centralizada em `HTTPError.toJSON()` e em `errorResponse()`: a mudança troca o formato
produzido ali, sem novo caminho de renderização. A única superfície pública nova é a aceitação de
`type` e `instance` no construtor de `HTTPError`.

## 2. Estado atual (verificado no código)

- O corpo de erro é montado em `errorResponse()` (`src/response.ts:358-380`), a partir de
  `error.toJSON()` (`src/response.ts:368`) com `stack` opcional em modo debug (`src/response.ts:369`).
- `toJSON()` produz `{ status, statusText, unhandled, message, data, ...body }` e mascara `message`
  como `"HTTPError"` e `data`/`body` quando `unhandled` (`src/error.ts:226-236`).
- O `Content-Type` vem de `jsonHeaders`, fixo em `application/json;charset=UTF-8`
  (`src/response.ts:270-272`), e é mesclado com `error.headers` (`src/response.ts:359-361`).
- `message` nunca fica vazio: sem mensagem explícita, o construtor cai no fallback
  `"HTTPError <status> <statusText>"` (`src/error.ts:187-193`). Isso conflita com RF-03 (`detail`
  omitido quando vazio) e exige rastrear se a mensagem foi explícita.
- A tabela `STATUS_TEXT` de `src/utils/response.ts:347-354` tem só 6 códigos, de propósito
  (“any other status gets no phrase”). Não serve como `title` padrão para 404/500.
- Erros não-`Error` viram `HTTPError` `unhandled` 500 em `toError()` (`src/response.ts:73-83`).
  Erros sem `HTTPError` passam por `prepareResponse()` (`src/response.ts:146-174`).
- Os asserts atuais de corpo de erro estão em `test/errors.test.ts` (ex.: `:44` content-type,
  `:55` `statusText`, `:350` `message`), `test/dist.test.ts:57` e `test/iterable.test.ts:145`
  (`.message`). Os demais asserts de `unhandled: true` (`test/errors.test.ts:257, 309, 384, 420, 442`)
  continuam válidos se `unhandled` for mantido (ver D-02).

## 3. Decisões de arquitetura

### D-01 — Um único serializador: `toJSON()` passa a emitir problem details

- **Alternativas:** (a) criar um método novo `toProblem()` e manter `toJSON()` antigo;
  (b) criar um módulo `src/problem.ts` que monte o corpo a partir de `HTTPError`;
  (c) trocar o conteúdo de `toJSON()`.
- **Escolha: (c).** `errorResponse()` já chama `error.toJSON()`; manter dois serializadores divergiria
  e (a) introduziria um nome público novo, proibido por RF-09. (b) adiciona um arquivo para algo que
  cabe em `error.ts` (que hoje tem 237 linhas). Efeito colateral aceito: quem chama `toJSON()`
  diretamente recebe o novo formato (ver R-01).

### D-02 — Mapeamento de membros do corpo

- `type`: `this.type ?? "about:blank"`.
- `title`: `statusText` (se houver e o erro não for `unhandled`), senão a frase RFC 9110 do status
  (D-04), senão `"Unknown Error"`.
- `status`: `this.status`.
- `detail`: a mensagem explícita (D-05); omitido quando não há mensagem explícita ou quando `unhandled`.
- `instance`: `this.instance`, omitido quando `undefined`.
- `data`: mantido como membro de extensão `data` (não espalhado no nível raiz), como hoje.
  Ver pendência P-01 sobre o critério de RF-06.
- `body` (opção existente): espalhado no nível raiz **antes** dos membros padrão, para que
  colisões com `type`, `title`, `status`, `detail` e `instance` percam (RF-06).
- `unhandled: true`: mantido **somente** quando verdadeiro. É um membro de extensão já existente;
  remover obrigaria a reescrever ~8 asserts de `test/errors.test.ts` sem ganho de segurança (o valor
  não expõe conteúdo interno).
- `stack`: continua sendo adicionado por `errorResponse()` só em modo debug.
- `statusText` deixa de ir ao corpo: o seu papel passa para `title`.

- **Alternativas:** espalhar `data` no nível raiz (fiel ao critério literal de RF-06); manter
  `statusText` e `message` no corpo além dos membros RFC.
- **Escolha:** `data` como membro (não quebra quem já lê `body.data`, e o próprio teste
  `test/errors.test.ts:55` espera `data: { test: 123 }`); `message` e `statusText` saem do corpo,
  porque o PRD pede explicitamente `detail` e `title`, e manter os dois duplicaria conteúdo.

### D-03 — `Content-Type` exato `application/problem+json`

- **Alternativas:** `application/problem+json;charset=UTF-8` (mantém o parâmetro atual).
- **Escolha:** `application/problem+json`, exatamente como RF-02 descreve, e testável com `toBe`.
  O JSON já é UTF-8 pela RFC 8259, então o parâmetro não é necessário. Ver pendência P-02 (P4 do PRD
  menciona charset).

### D-04 — Tabela de frases RFC 9110 para `title`

- **Alternativas:** (a) reutilizar `STATUS_TEXT` de `src/utils/response.ts:347`; (b) ampliar essa
  tabela; (c) nova tabela interna.
- **Escolha: (c)**, em `src/utils/internal/status-text.ts`. A tabela de `utils/response.ts` é
  restrita de propósito, para não emprestar a frase de um código a outro; mantê-la intacta preserva
  esse comportamento. A tabela nova cobre os códigos registrados do IANA para 1xx–5xx (~60 entradas,
  cerca de 1,5 KB minificado; ver R-03).

### D-05 — `detail` só com mensagem explícita

- **Alternativas:** emitir `this.message` sempre (inclui o fallback `"HTTPError 500"`).
- **Escolha:** guardar a mensagem explícita num campo privado `#detail`, preenchido quando a mensagem
  vem de `messageInput`, `details.message` ou `details.cause.message`. Quando o `message` cai no
  fallback sintético ou em `statusText`/`statusMessage`, `#detail` fica `undefined`. Isso atende
  RF-03 sem mudar `Error.message`, que continua sendo usado em logs e no `onError`.

### D-06 — `type` e `instance` lidos só de `details`

- **Alternativas:** ler também de `details.cause`, como `headers`, `unhandled` e `statusText` fazem.
- **Escolha:** só de `details`, como `data` e `body` já fazem. Um `cause` é um erro arbitrário e pode
  trazer `type` de outra origem. Ver P-03.

### D-07 — Erros `unhandled` não usam `statusText` nem mensagem no corpo

- **Alternativas:** usar `statusText` de `cause` como `title` também para erros não tratados.
- **Escolha:** para `unhandled`, `title` é só a frase padrão do status (D-04). Um `statusText`
  derivado de `cause` (ex.: `src/adapters.ts:122, 143-152`) pode conter texto interno. Isso segue
  RF-07.

### D-08 — Nenhuma mudança fora de `HTTPError` e `errorResponse()`

- `onError`, `prepareResponse()`, adapters Node (`src/adapters.ts`) e o fluxo de stream não mudam.
  Quando a resposta já começou (R4), o caminho atual já rejeita com `kHandled` e não chega em
  `errorResponse()`. Isso é verificado por testes existentes (SSE, stream), não por código novo.
- `src/utils/json-rpc.ts:479-498` tem seu próprio formato de erro e fica **fora de escopo** (PRD).

### D-09 — Cache de erros

- `src/utils/cache.ts` e `src/rules/cache.ts` não inspecionam o `Content-Type` de erros, e o
  armazenamento de respostas 4xx/5xx é decidido pelo `ocache` (dependência externa). Não há mudança
  prevista; a verificação está na estratégia de testes (T-06).

---

## 4. Arquivos a alterar

| Arquivo | Linhas de referência | Mudança |
| --- | --- | --- |
| `src/error.ts` | `:30-69` (`ErrorBody`), `:51` (`message`), `:82-119` (campos), `:162-210` (construtor), `:172-193` (status/statusText/message), `:199-209` (campos), `:226-236` (`toJSON`) | Adicionar `type?`/`instance?` em `ErrorBody`; campos `readonly type`/`instance` e `#detail` em `HTTPError`; ajustar o cálculo de `message` (D-05); reescrever `toJSON()` (D-02, D-07); exportar `ProblemDetails` **sem** reexportar em `src/index.ts` |
| `src/response.ts` | `:73-83` (`toError`), `:270-272` (`jsonHeaders`), `:358-380` (`errorResponse`), `:368-369`, `:376` | Criar `problemHeaders` com `application/problem+json` (D-03) e usá-lo em `errorResponse()`; manter `stack` de debug; `statusText` do `FastResponse` continua vindo de `error.statusText` (`:376`) |
| `src/utils/internal/status-text.ts` | novo | Tabela de frases RFC 9110 e `getStatusPhrase(status: number): string \| undefined` (D-04) |
| `src/utils/response.ts` | `:347-354` | **Não alterar** (D-04) |
| `src/index.ts` | `:72` | Sem mudança de exports (RF-09). `ErrorBody` já é exportado e ganha `type`/`instance` sem nome novo |
| `test/errors.test.ts` | `:44`, `:55`, `:350` | Ajustar asserts do formato antigo (T-05) |
| `test/dist.test.ts` | `:57` | `.message` → `.detail` (T-05) |
| `test/iterable.test.ts` | `:145` | `.message` → `.detail` (T-05) |
| `test/errors.test.ts` (novo `describe`) | após o bloco de `error response bodies` | Testes de regressão RF-01 a RF-08 (T-01) |
| `test/unit/problem-details.test.ts` | novo | Testes unitários de `toJSON()` e da tabela (T-02) |
| `test/unit/types.test-d.ts` | — | Tipos de `type`/`instance` em `HTTPError` (T-03) |

Pontos de consumo que não mudam, mas precisam de atenção: `src/adapters.ts:122, 143-152` (erros
`unhandled` com `cause`), `src/utils/middleware.ts:37-60` (`onError`, `unhandled` em `:47-52`),
`src/utils/internal/validate.ts:217-225` (`statusText: VALIDATION_FAILED` vira `title`),
`src/h3.ts:83, 187, 223` (400/404 padrão), `src/rules/cache.ts:247` (500 com `message`).

---

## 5. Contratos e assinaturas

```ts
// src/error.ts

/**
 * Corpo serializado por `HTTPError.toJSON()` (RFC 9457).
 * Não é reexportado em `src/index.ts`: não é um nome público novo.
 */
export interface ProblemDetails extends Record<string, unknown> {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  unhandled?: true;
  data?: unknown;
}

export interface ErrorBody<DataT = unknown> {
  status: number;
  statusText?: string;
  message: string;
  /** RFC 9457 `type` (URI reference). Default in the body: `"about:blank"`. */
  type?: string;
  /** RFC 9457 `instance` (URI reference). Omitted from the body when unset. */
  instance?: string;
  unhandled?: boolean;
  data?: DataT;
  body?: Record<string, unknown>;
}

// `ErrorInput extends Partial<ErrorBody>` — passa a aceitar `type` e `instance` automaticamente.

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly status: number;
  readonly statusText: string | undefined;
  readonly type: string | undefined;        // novo
  readonly instance: string | undefined;    // novo
  readonly headers: Headers | undefined;
  readonly cause: unknown | undefined;
  readonly data: DataT | undefined;
  readonly body: Record<string, unknown> | undefined;
  readonly unhandled: boolean | undefined;
  #detail: string | undefined;              // novo: mensagem explícita (D-05)

  constructor(message: string, details?: ErrorDetails);
  constructor(details: ErrorDetails);

  /** Corpo RFC 9457. Sem `detail` quando não há mensagem explícita ou o erro é `unhandled`. */
  toJSON(): ProblemDetails;                 // antes: Omit<ErrorBody, "body"> & ErrorBody["body"]
}
```

```ts
// src/utils/internal/status-text.ts  (interno, não exportado por src/index.ts)

/** Frase padrão RFC 9110 de um status, ou `undefined` para códigos sem frase registrada. */
export function getStatusPhrase(status: number): string | undefined;
```

Comportamento de `toJSON()` (pseudocódigo):

```ts
toJSON(): ProblemDetails {
  const unhandled = this.unhandled;
  const extensions = unhandled ? {} : { ...this.body };   // body perde para os membros padrão
  return {
    ...extensions,
    type: this.type ?? "about:blank",
    title: (!unhandled && this.statusText) || getStatusPhrase(this.status) || "Unknown Error",
    status: this.status,
    ...(!unhandled && this.#detail !== undefined ? { detail: this.#detail } : undefined),
    ...(this.instance !== undefined ? { instance: this.instance } : undefined),
    ...(unhandled ? { unhandled: true as const } : undefined),
    ...(unhandled ? undefined : { data: this.data }),
  };
}
```

Observações do contrato:
- `ProblemDetails` e `status-text.ts` são internos; `src/index.ts` não muda (RF-09).
- `ErrorBody` ganha dois campos opcionais; isso não cria export novo.
- O formato de `toJSON()` muda de forma incompatível (R-01). Isso é intencional (P1 do PRD).

```ts
// src/response.ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});

function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  // Assinatura inalterada. Troca `jsonHeaders` por `problemHeaders` e mantém o resto.
}
```

---

## 6. Estratégia de testes

Seguindo o fluxo de bug fix de `AGENTS.md`: escrever a regressão, confirmar que falha, implementar,
confirmar que passa, rodar a suíte.

- **T-01 — Regressão de comportamento (describeMatrix, web e node).** Novo `describe("problem details")`
  em `test/errors.test.ts`, usando `ctx.app`/`ctx.fetch`:
  - RF-01/RF-03: `new HTTPError({ status: 404, message: "Usuário não encontrado" })` → `detail`, `status`,
    `title: "Not Found"`, `type: "about:blank"`.
  - RF-02: `res.headers.get("content-type") === "application/problem+json"` para `HTTPError` e erro comum.
  - RF-03: `new HTTPError({ status: 500 })` → sem `detail`.
  - RF-04: `type` e `instance` informados aparecem em `error.type`/`error.instance` e no corpo.
  - RF-05: `status: 429` + `headers: { "retry-after": "30" }` → header presente.
  - RF-06: `data: { campo: "email" }` → `data` é preservado e não sobrescreve `status`/`title`/`type`.
  - RF-07: `throw new Error("senha do banco incorreta")` → 500, `title: "Internal Server Error"`, corpo sem a string.
  - RF-08: `{ ok: true }` continua `application/json`.
- **T-02 — Unitários de `toJSON()` (`test/unit/problem-details.test.ts`):**
  - colisão `body: { status: 1, title: "x" }` não sobrescreve os membros padrão;
  - `unhandled` não expõe `detail`, `data` nem `body`;
  - `statusText` informado vence a frase padrão em `title`, exceto `unhandled`;
  - `getStatusPhrase` cobre todos os códigos registrados e devolve `undefined` para códigos não registrados;
  - `new HTTPError(new Error("x"))` tem `detail: "x"`, e `new HTTPError({ cause: new Error("x") })` também.
- **T-03 — Tipos (`test/unit/types.test-d.ts`):** `new HTTPError({ status, type, instance })` aceita
  strings; `error.type` e `error.instance` são `string | undefined`; `ErrorBody` aceita os dois.
- **T-04 — Export (RF-09):** comparar a lista de exports de `src/index.ts` antes e depois (diferença
  esperada: nenhuma). Se já houver teste de pacote/exports em `test/unit/package.test.ts`, usá-lo.
- **T-05 — Ajuste de testes existentes:**
  - `test/errors.test.ts:44`: `application/json;charset=UTF-8` → `application/problem+json`;
  - `test/errors.test.ts:55`: `statusText: "Unprocessable"` → `title: "Unprocessable"`;
  - `test/errors.test.ts:350`: `message: "HTTPError"` → sem `detail` e com `unhandled: true`;
  - `test/dist.test.ts:57` e `test/iterable.test.ts:145`: `.message` → `.detail`.
  Esses ajustes mantêm o que o teste verifica (status, headers e comportamento), conforme RF-10.
- **T-06 — Regressões de integração:** rodar a suíte completa, em especial `test/rules/cache.test.ts`
  (cache de erros, D-09), os testes de SSE/stream (R4, D-08), `test/json-rpc.test.ts` (fora de escopo,
  deve continuar igual), `test/proxy.test.ts` (502/504) e `test/validate.test.ts` (`statusText`
  customizado vira `title`; confirmar nos asserts).
- **T-07 — Build e dist:** `pnpm build` e depois `pnpm vitest run test/dist.test.ts`, porque o teste
  de dist só passa com `dist/` atualizado.
- **T-08 — Qualidade:** `pnpm lint` (oxlint + oxfmt + typecheck) e `pnpm test` completo.

---

## 7. Riscos

- **R-01 — Quebra para clientes e para `toJSON()`.** Quem lê `message`, `statusText`, `unhandled` ou
  `Content-Type: application/json` em erros deixa de funcionar; quem chama `error.toJSON()` recebe o
  novo formato. Mitigação: anunciar como breaking na release; documentar o novo formato; manter o
  nome `toJSON` (D-01).
- **R-02 — Vazamento de detalhes internos (RF-07).** `unhandled` continua mascarando `detail`, `data`
  e `body` (D-02, D-07), e `title` ignora `statusText` nesses casos. T-02 e T-01 (RF-07) cobrem isso.
  O `stack` só aparece com `debug`, como hoje.
- **R-03 — Tamanho do bundle.** A tabela de frases entra em `error.ts`, que é importado por quase todo
  o pacote. Estimativa de ~1,5 KB minificado. Mitigação: a tabela fica em módulo próprio (D-04) e pode
  ser reduzida aos códigos de uso comum se o orçamento de bundle for apertado.
- **R-04 — Colisão entre `body` e membros padrão.** O comportamento escolhido (membros padrão vencem)
  muda o resultado de quem usava `body: { title: ... }` para sobrescrever. Documentar.
- **R-05 — `#detail` e subclasses.** Uma subclasse de `HTTPError` que sobrescreva `message` no
  construtor não terá `detail` atualizado. Aceito; cobrir com um teste se houver uso conhecido.
- **R-06 — `Content-Type` exato (D-03).** Clientes que comparam o header com charset vão ver a
  mudança. Consistente com RF-02.
- **R-07 — Erros após início de stream (R4 do PRD).** Coberto por D-08; a verificação depende dos
  testes de SSE/stream existentes.
- **R-08 — Cache (R5 do PRD).** A decisão de armazenar 4xx/5xx depende do `ocache`, que não está no
  repositório. Verificar em T-06 que erros não são servidos com `application/json` depois da mudança.

---

## 8. Pendências e inconsistências do PRD

Resolver antes de implementar:

- **P-01 — RF-06, critério de aceite.** O texto de RF-06 diz que `data` é preservado como membro de
  extensão, mas o critério diz "contém `campo: "email"` no nível raiz". As duas leituras não são
  compatíveis. Esta spec adota `data: { campo: "email" }` (D-02). Se a intenção for o nível raiz, a
  mudança é pequena (espalhar `data` antes dos membros padrão), mas quebra a forma atual de
  `data` (`test/errors.test.ts:55`) e exige atualizar o critério.
- **P-02 — RF-02 × P4.** RF-02 pede `application/problem+json` exato; P4 fala em "charset adicional
  além do que o h3 já aplica". Esta spec adota o valor exato (D-03).
- **P-03 — `type`/`instance` via `cause`.** O PRD não diz se `cause` é fonte. Esta spec não lê
  (D-06).
- **P-04 — `unhandled` no corpo.** O PRD não menciona o membro. Esta spec mantém `unhandled: true`
  como extensão (D-02). Se a intenção for removê-lo, são ~8 asserts a mais em T-05.
- **P-05 — `message` removido do corpo.** O PRD usa `detail` como nome do membro e não fala em
  manter `message`. Esta spec remove `message` (D-02). Confirmar.
