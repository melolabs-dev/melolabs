# Especificação técnica — Problem details (RFC 9457) via `problem()`

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-09).

Este documento não altera código. Todas as citações `arquivo:linha` foram conferidas na árvore atual (commit `258bc20`).

---

## 1. Visão geral

Um handler passa a poder responder erros no formato RFC 9457 chamando `problem(input)`, exportado por `h3`. O utilitário devolve um `HTTPError` comum, marcado internamente como "problem". Na hora de serializar (`errorResponse`), o erro marcado usa o corpo e o `Content-Type` do RFC 9457; os demais erros seguem o caminho atual, sem mudança.

Fluxo resultante:

1. Handler lança `problem({...})`.
2. `prepareResponse` (`src/response.ts:146`) recebe o `HTTPError` (já passa por `HTTPError.isError`, `src/response.ts:147`), aplica `onError` se houver, e chama `errorResponse` (`src/response.ts:173`).
3. `errorResponse` (`src/response.ts:358`) verifica a marca interna. Se houver, monta o corpo de problem details e o header `application/problem+json`. Se não, mantém o código atual.

Os únicos nomes públicos novos são `problem` e `ProblemInput`, conforme `sdd/pedido.md` (seção "Restrições").

---

## 2. Decisões de arquitetura

### D-01 — Como marcar o erro como problem

**Escolha:** símbolo registrado `Symbol.for("h3.problem")`, guardado numa propriedade **não enumerável** do próprio `HTTPError`, com o valor `{ type?, instance? }`.

**Alternativas consideradas:**

- *Propriedade string `"~problem"`.* O prefixo `~` é a convenção do projeto para membros não enumeráveis (`src/h3.ts:42`, `src/h3.ts:46-51`). Rejeitada: uma string pode ser criada por `JSON.parse` em dados de requisição, e não tem a garantia de identidade entre cópias do módulo que o símbolo registrado tem.
- *`WeakMap` em `src/utils/problem.ts`.* Funciona, mas quebra se houver mais de uma cópia do h3 no mesmo processo (o próprio projeto justifica o símbolo registrado por esse motivo, `src/response.ts:88-93`).
- *Subclasse `ProblemError extends HTTPError`.* Rejeitada: adiciona um nome público e `HTTPError.isError` depende de `name === "HTTPError"`, o que exigiria sobrescrever `name`.
- *Campos públicos `type` e `instance` em `HTTPError`.* Rejeitada: muda a classe pública e o `toJSON()` existente, e viola RF-05.

**Justificativa:** segue o padrão já usado para `kHTTPResponse` (`src/response.ts:94`, com o mesmo raciocínio de não ser forjável por `JSON.parse`). Não aparece no `JSON.stringify`, não exige nome público e não altera nenhum erro que não usa `problem`.

**Detalhe:** usar `Object.defineProperty` com `enumerable: false`, para que `{ ...error }` não copie a marca.

### D-02 — Onde aplicar o formato

**Escolha:** ramificar dentro de `errorResponse` (`src/response.ts:358-380`).

**Alternativas consideradas:**

- *Método público `toProblemJSON()` em `HTTPError`.* Rejeitada: é um nome público novo, proibido por `sdd/pedido.md`.
- *Ramificar em `prepareResponse`.* Rejeitada: o caminho da função é mais longo e tem dois pontos em que o erro é preparado (com e sem `onError`).
- *Aplicar em `onError`.* Rejeitada: só funcionaria quando o usuário configura `onError`.

**Justificativa:** `errorResponse` é o único ponto em que um `HTTPError` vira corpo (`src/response.ts:368`). Com `onError`, quando o hook devolve `undefined`, o erro é relançado e passa de novo por `prepareResponse` (`src/utils/middleware.ts:56-60` e `src/response.ts:161-165`), então a ramificação cobre os dois casos.

### D-03 — Construção do corpo de problem details

**Escolha:** reaproveitar `error.toJSON()` (`src/error.ts:226-236`) para a máscara de `unhandled`, e montar o corpo a partir do resultado.

```ts
const { status, statusText, unhandled, message, data, ...extensions } = error.toJSON();
return {
  ...extensions,
  type: meta.type ?? "about:blank",
  title: statusText,
  status,
  detail: message,
  instance: unhandled ? undefined : meta.instance,
  data,
};
```

**Precedência (resolve o risco de colisão do PRD):** membros de `body` (`extensions`) são sobrescritos pelos membros da RFC (`type`, `title`, `status`, `detail`, `instance`). `data` é colocado por último, então um `body.data` é descartado quando `data` não é informado. Essa precedência é testada (seção 4).

**Alternativas consideradas:**

- *Reescrever a máscara de `unhandled` dentro de `problemBody`.* Rejeitada: duplicaria a regra de RF-06 e abriria espaço para divergência com `toJSON()`.
- *Não mascarar `instance` quando `unhandled`.* Escolha minha, para confirmar: `instance` é um identificador que o próprio app define, mas em erro interno (`unhandled`) o objetivo é não expor detalhes. Por isso `instance` é omitido nesse caso. Se o time preferir expor, basta remover o ternário.

**Detalhe de lint:** `unhandled` aparece desestruturado e sem uso. Se o `oxlint` reclamar de variável não usada, usar `const json = error.toJSON()` e apagar as chaves, ou aceitar a desestruturação com um comentário.

### D-04 — Headers da resposta

**Escolha:** base `application/problem+json`, criada como `FrozenHeaders` igual a `jsonHeaders` (`src/response.ts:270-272`), e mesclada com `error.headers` com `mergeHeaders` (`src/response.ts:243-252`).

```ts
const problemHeaders = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

Como `mergeHeaders` usa `set` (exceto `set-cookie`), um `Content-Type` informado pelo usuário em `headers` prevalece (RF-07). `errHeaders` continua sendo mesclado depois, como hoje (`src/response.ts:362-364`).

### D-05 — Propagação por `cause`

**Escolha:** a marca **não** é herdada de `cause`. Um `HTTPError` novo que tem um `problem` como `cause` continua no formato atual.

**Alternativa considerada:** herdar a marca, como `HTTPError` já herda `status` e `headers` de `cause` (`src/error.ts:172-178` e `src/error.ts:202-203`).

**Justificativa:** o formato é escolhido por quem lança o erro que chega ao servidor. Herdar a marca faria `throw new HTTPError({ cause: problem(...) })` mudar o formato sem que o handler tenha chamado o utilitário para essa resposta, o que contraria "só as respostas que usam o utilitário mudam". Efeito colateral aceito e documentado: o `status` continua vindo do `cause`, mas o formato não.

### D-06 — Local do código novo

**Escolha:** `src/utils/problem.ts`, com `problem`, `ProblemInput`, a chave `kProblem` e o helper de leitura da marca.

**Alternativas consideradas:**

- *`src/problem.ts`.* Aceitável, mas `src/` no topo reúne os módulos centrais, e o formato é uma utilidade pública.
- *Adicionar em `src/error.ts`.* Rejeitada: `src/error.ts` já tem 238 linhas, acima da meta de "< 200 LoC" do `AGENTS.md`.

**Justificativa:** `src/utils/` é o lugar da API pública de utilitários (`AGENTS.md`, estrutura do projeto). `src/response.ts` já importa de `./utils/...` (`src/response.ts:3-5`), então a nova dependência segue um padrão existente.

### D-07 — Tipagem de `ProblemInput` e `problem`

**Escolha:**

```ts
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  type?: string;
  instance?: string;
}
```

`ErrorInput` (`src/error.ts:6`) já traz `status`, `statusText`, `message`, `unhandled`, `data`, `body`, `cause`, `headers` e os campos deprecados `statusCode`/`statusMessage`. Todos continuam válidos.

**Alternativas consideradas:**

- *`type?: string | URL`.* Rejeitada: a RFC pede uma URI-reference como string; o uso de `URL` seria uma conveniência fora do escopo.
- *Validar o formato de `type`.* Fora de escopo (PRD: "Criar registro de tipos ou URLs de documentação").

**Detalhe:** o projeto usa `isolatedDeclarations` (`tsconfig.json:21`), então `problem` precisa de tipo de retorno explícito. Pode ser necessário um cast ao passar `details` ao construtor de `HTTPError`, porque o tipo `ErrorDetails` não inclui os campos extras.

### D-08 — `stack` em modo debug

**Escolha:** manter o `stack` em modo `debug`, como `errorResponse` já faz (`src/response.ts:369`). É um membro de extensão, que a RFC permite.

**Alternativa:** omitir `stack` no formato problem. Não escolhida para não divergir do comportamento de debug atual.

### D-09 — Exportação pública

**Escolha:** em `src/index.ts`, na seção `// Error` (`src/index.ts:70-72`), adicionar:

```ts
export { problem, type ProblemInput } from "./utils/problem.ts";
```

`ProblemInput` é só tipo, então não entra no snapshot de exports (ver seção 3).

---

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/problem.ts` | **Novo.** `ProblemInput`, `problem()`, `kProblem` (`Symbol.for("h3.problem")`), helper interno `getProblemMeta(error)`. |
| `src/response.ts` | Em `errorResponse` (`src/response.ts:358-380`): ler a marca, escolher base de headers e corpo. Adicionar `problemHeaders` perto de `jsonHeaders` (`src/response.ts:270-272`) e a função interna `problemBody`, no fim do arquivo. Importar de `./utils/problem.ts`. |
| `src/index.ts` | Uma linha de export (ver D-09), em `src/index.ts:72`. |
| `test/problem.test.ts` | **Novo.** Testes com `describeMatrix` (ver seção 4). |
| `test/unit/package.test.ts` | Atualizar o snapshot inline (`test/unit/package.test.ts:6`) para incluir `"problem"`, em ordem alfabética (entre `"parseCookies"` e `"proxyRequest"`, `test/unit/package.test.ts:104-106`). |
| `test/unit/types.test-d.ts` | Opcional: teste de tipo com `expectTypeOf` para `ProblemInput` e o retorno de `problem` (o arquivo já importa `expectTypeOf`, `test/unit/types.test-d.ts:12`). |

Arquivos que **não** mudam: `src/error.ts` (toda a lógica nova fica fora dele), `src/utils/middleware.ts`, `src/utils/json-rpc.ts`, `src/utils/internal/validate.ts`, `src/rules/*`. Esses caminhos continuam funcionando porque usam `HTTPError` e a marca não existe neles.

### Esboço de implementação (`src/utils/problem.ts`)

```ts
import { HTTPError, type ErrorInput } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  type?: string;
  instance?: string;
}

/** @internal */
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

/** @internal */
export interface ProblemMeta {
  type?: string;
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...details } = input;
  const error = new HTTPError<DataT>(details as ErrorInput<DataT>);
  Object.defineProperty(error, kProblem, { value: { type, instance } satisfies ProblemMeta });
  return error;
}

/** @internal */
export function getProblemMeta(error: HTTPError): ProblemMeta | undefined {
  return (error as any)[kProblem];
}
```

### Esboço de `errorResponse` (`src/response.ts`)

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response {
  const problemMeta = getProblemMeta(error);
  const base = problemMeta ? problemHeaders : jsonHeaders;
  let headers: Headers = error.headers ? mergeHeaders(base, error.headers) : new Headers(base);
  if (errHeaders) {
    headers = mergeHeaders(headers, errHeaders);
  }
  return new FastResponse(
    JSON.stringify(
      {
        ...(problemMeta ? problemBody(error, problemMeta) : error.toJSON()),
        stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : undefined,
      },
      undefined,
      debug ? 2 : undefined,
    ),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

`problemBody` fica no fim de `src/response.ts`, como helper interno (convenção do `AGENTS.md`).

---

## 4. Contratos

### Assinaturas públicas

```ts
// exportado por "h3"
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI que identifica o tipo do problema. Padrão no corpo: "about:blank". */
  type?: string;
  /** URI que identifica a ocorrência específica. Omitido em erros `unhandled`. */
  instance?: string;
}

export declare function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

### Corpo e headers da resposta

Para `problem({ status: 422, statusText: "Unprocessable Content", message: "Campo 'email' inválido", type: "https://exemplo.com/erros/validacao", instance: "/cadastro/7" })`:

```
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://exemplo.com/erros/validacao",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Campo 'email' inválido",
  "instance": "/cadastro/7"
}
```

Membros que aparecem só em certos casos: `data` (se informado), membros de `body` (se não for `unhandled`), `stack` (em `debug`). `title` some se não houver `statusText`. `instance` some se não for informado.

### Regras de precedência

| Caso | Resultado |
| --- | --- |
| `body: { type: "x" }` e `type` ausente | `type` vira `"about:blank"`; `body.type` é sobrescrito. |
| `body: { status: 999 }` | `status` real do erro prevalece. |
| `body: { data: {...} }` sem `data` informado | `body.data` é descartado. |
| `unhandled: true` | `detail` = `"HTTPError"`, sem `data`, sem membros de `body`, sem `instance`. |
| `headers: { "Content-Type": "text/plain" }` | Esse valor prevalece. |

---

## 5. Estratégia de testes

Seguir o fluxo de correção do `AGENTS.md`: escrever os testes, ver que falham, implementar, ver que passam.

### `test/problem.test.ts` (novo, `describeMatrix`, roda em `web` e `node`)

| Teste | Requisito | Verificação |
| --- | --- | --- |
| `problem` devolve `HTTPError` | RF-01 | `instanceof HTTPError`, `status`, `message`. |
| `type` e `instance` são aceitos | RF-02 | Valores preservados. Teste de tipo: `// @ts-expect-error` para chave desconhecida. |
| Corpo RFC 9457 completo e `Content-Type` | RF-03 | Exemplo da seção 4, com `toEqual` no JSON e `application/problem+json`. |
| `type` padrão e membros de extensão | RF-04 | `about:blank`; `body` no topo; `data` sob `data`. |
| Precedência `body` x membros RFC | Risco de colisão | `body: { title: "x", status: 1 }` não altera `title`/`status`. |
| Erro legado com `HTTPError.status(...)` | RF-05 | Content-Type `application/json;charset=UTF-8` e corpo sem `type`. Usar o mesmo padrão de `test/errors.test.ts:44`. |
| `unhandled` mascarado | RF-06 | `detail: "HTTPError"`, sem `data`, sem `instance`, sem a mensagem interna. Limpar `t.errors` como em `test/errors.test.ts`. |
| `headers` aplicados | RF-07 | `Retry-After: 30` presente. |
| `Content-Type` informado prevalece | RF-07 | `headers: { "content-type": "text/plain" }`. |
| `HEAD` sem corpo | Regressão de `nullBody` | Status e `Content-Type` presentes, corpo vazio. |
| `errHeaders` não duplica `set-cookie` | Regressão de `src/response.ts:218-227` | Com `event.res.errHeaders.append("set-cookie", ...)`, o cookie aparece uma vez. Padrão de `test/errors.test.ts:202`. |
| `onError` que relança | D-02 | Formato problem preservado, `onError` chamado uma vez. |
| `onError` que devolve `Response` | Não regressão | Resposta do hook intacta. |
| `problem` como `cause` | D-05 | Erro externo com `status` herdado e corpo legado (sem `type`). |
| `problem` relançado sem alteração | D-01 | Continua no formato problem. |
| `debug` inclui `stack` | D-08 | Presente em problem details. |

### Atualizações em testes existentes

- `test/unit/package.test.ts:6`: snapshot com `"problem"`. É a única mudança esperada em teste existente. Nenhum teste existente deve ser removido (RF-09).
- Nenhum teste de `test/errors.test.ts` deveria mudar: o formato legado é preservado. Se algum quebrar, é sinal de regressão, não de ajuste.

### Verificação final

```bash
pnpm vitest run test/problem.test.ts       # novo
pnpm vitest run test/errors.test.ts test/unit/package.test.ts
pnpm lint                                   # oxlint + oxfmt --check
pnpm typecheck                              # tsc --noEmit
pnpm vitest run                             # suíte completa
```

---

## 6. Riscos

| # | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Snapshot de exports quebra. | Atualizar `test/unit/package.test.ts:6` com `"problem"`. `ProblemInput` é só tipo e não aparece no snapshot. |
| R-02 | `oxlint` acusa variável não usada (`unhandled` em D-03). | Ver nota em D-03. |
| R-03 | `isolatedDeclarations` exige tipo de retorno explícito e pode pedir cast no construtor de `HTTPError`. | Tipos explícitos no esboço da seção 3. |
| R-04 | `instance` vaza em erro `unhandled`. | Omitido por D-03; confirmar a escolha. |
| R-05 | Marca copiada por `{ ...error }`. | `enumerable: false` em `Object.defineProperty`. |
| R-06 | Marca forjada via `JSON.parse`. | Símbolo registrado; `JSON.parse` não cria símbolos (D-01). |
| R-07 | `cause` com `problem` surpreende quem espera o formato problem. | D-05 com teste. Documentar no JSDoc de `problem`. |
| R-08 | `errHeaders` duplicados em `set-cookie` ao passar por `onError`. | Já tratado por `src/response.ts:167-173`; coberto por teste. |
| R-09 | Usuário passa `type` em `body` esperando sobrescrever. | Precedência de D-03 documentada na seção 4 e testada. |
| R-10 | Escopo cresce para JSON-RPC, validação ou `h3/rules`. | Fora de escopo por `sdd/prd.md`. Não tocar `src/utils/json-rpc.ts` nem `src/utils/internal/validate.ts`. |

---

## 7. Pendências para confirmar com o time

1. `instance` omitido em erros `unhandled` (D-03, R-04).
2. `stack` em modo debug no formato problem (D-08).
3. Localização `src/utils/problem.ts` versus `src/problem.ts` (D-06).
