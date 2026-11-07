# Especificação técnica — Problem details (RFC 9457) via `problem()`

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01 a RF-12), issue h3js/h3#1384.

Todas as citações `arquivo:linha` foram conferidas no código atual (branch `master`, commit `87a4c0c`).

## 1. Visão geral

O h3 monta erros em `errorResponse()` (`src/response.ts:358-380`), sempre no formato `HTTPError.toJSON()` com `application/json`. A mudança adiciona um caminho paralelo, ativado só por erros criados com `problem()`:

1. `problem(input)` cria um `HTTPError` normal e o marca com um símbolo interno (`kProblem`) e com os membros `type` e `instance`.
2. `errorResponse()` verifica a marca. Se houver marca, monta o corpo RFC 9457 e o `Content-Type: application/problem+json`. Se não houver, segue o caminho atual sem alteração.
3. Todo o fluxo existente (`throw`, `return`, `onError`, `toResponse`) é reaproveitado, porque o objeto continua sendo um `HTTPError`.

Nenhuma função existente muda de assinatura, e `HTTPError.toJSON()` não muda.

---

## 2. Decisões de arquitetura

### D-01 — Marca interna do erro: símbolo registrado em `Symbol.for`

**Escolha:** o erro recebe a propriedade `[kProblem]`, com `kProblem = Symbol.for("h3.problem")`, cujo valor é o objeto `ProblemMeta` (`type`, `instance`, `detail`).

**Alternativas consideradas:**
- *Subclasse `ProblemError extends HTTPError`.* Rejeitada: adiciona um nome de classe que, mesmo não exportado, aparece em stack traces e em `instanceof`, e a checagem `HTTPError.isError` (`src/error.ts:129-133`) já cobre a identidade por nome e `status`. Também exigiria verificar `instanceof` entre cópias do módulo.
- *`WeakMap` interno no módulo.* Rejeitada: uma cópia duplicada do h3 (dois bundles, dois realms) teria outro `WeakMap` e não reconheceria o erro.
- *Novo campo público em `HTTPError`.* Rejeitada: altera a forma pública de `HTTPError` (PRD, "Fora de escopo").

**Justificativa:** `Symbol.for` é o padrão já usado no projeto para marcas que precisam atravessar cópias do módulo: `kHTTPResponse` (`src/response.ts:94`) e `kEventResErrHeaders` (`src/event.ts:19`). Um símbolo não aparece em `JSON.stringify`, então não vaza para o corpo.

### D-02 — Módulo novo `src/problem.ts` para a API e a montagem de membros

**Escolha:** criar `src/problem.ts` com `problem()`, o tipo `ProblemInput`, `kProblem`, `ProblemMeta` e `problemMembers()`. Em `src/response.ts` fica só o ramo que escolhe o formato e monta a `Response`, pois ali já existem `mergeHeaders` e `FastResponse`.

**Alternativas consideradas:**
- *Colocar tudo em `src/error.ts`.* Rejeitada: o arquivo já tem 237 linhas (`src/error.ts:237`) e o AGENTS.md pede arquivos curtos (< 200 LoC), além de misturar a API de `problem()` com a classe base.
- *Colocar tudo em `src/response.ts`.* Rejeitada: aumenta um arquivo que já concentra o pipeline de resposta, e a API pública ficaria longe do ponto de exportação.

**Dependências:** `src/problem.ts` importa `src/error.ts` e `src/utils/internal/status-text.ts`. `src/response.ts` importa `src/problem.ts`. Não há ciclo.

### D-03 — Entrada `ProblemInput` estende `ErrorInput`; `ErrorInput` não muda

**Escolha:**

```ts
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  type?: string;
  instance?: string;
}
```

**Alternativas consideradas:**
- *Adicionar `type` e `instance` em `ErrorInput`/`ErrorBody`.* Rejeitada: `ErrorDetails` (`src/error.ts:28`) é usado por `HTTPError.status()` (`src/error.ts:144-150`) e pelo construtor. Os dois campos apareceriam em todo erro existente, o que contraria RF-08.

**Justificativa:** é o único tipo público novo, como pede `sdd/pedido.md`. O nome segue `ErrorInput`. `ProblemInput` é atribuível a `ErrorDetails`, então `new HTTPError(input)` continua compilando.

### D-04 — `type` e `instance` acessíveis como propriedades `readonly`, sem novo nome de tipo

**Escolha:** o erro recebe as propriedades `type` (sempre string, padrão `"about:blank"`) e `instance` (opcional). O tipo de retorno de `problem()` é escrito inline:

```ts
HTTPError<DataT> & { readonly type: string; readonly instance: string | undefined }
```

**Alternativas consideradas:**
- *Nomear o retorno (`ProblemError`).* Rejeitada: viola "nenhum outro nome público novo além de `problem` e do tipo da sua entrada" (`sdd/pedido.md`).
- *Retornar só `HTTPError`.* Rejeitada: RF-02 exige que `type` e `instance` sejam acessíveis no erro.

**Justificativa:** `Object.assign` no retorno de `problem()` escreve as propriedades sem violar o `readonly` da tipagem. `toJSON()` não lê essas propriedades, então elas não entram em erros fora do caminho problem.

### D-05 — Mapeamento de `message`, `statusText` e padrões

**Escolha:**
- `detail` = `input.message`, somente quando é uma string não vazia. Sem `message` explícito, `detail` fica ausente. Não se usa `error.message`, porque o construtor gera `"HTTPError 404"` quando não há mensagem (`src/error.ts:187-193`) e esse texto não é útil para o cliente.
- `title` = `error.statusText` (já sanitizado em `src/error.ts:180-200`); se não houver, `statusTexts[status]`; se o status não estiver na tabela, `"Unknown Error"`.
- `type` = `input.type ?? "about:blank"` (RF-04).
- `instance` = `input.instance`, ausente quando não informado.

**Alternativas consideradas:**
- *`detail` sempre igual a `error.message`.* Rejeitada: transforma o texto gerado pelo construtor em `detail`, como em `"HTTPError 404"`.
- *Usar `cause.message` como `detail` quando não há `message`.* Rejeitada por complexidade; o chamador pode passar `message`.

**Consequência documentada:** `problem({ status: 404 })` produz um corpo sem `detail`. Isso é intencional e deve constar na documentação de uso (fora do escopo desta entrega, conforme PRD).

### D-06 — Tabela de textos padrão de status em `src/utils/internal/status-text.ts`

**Escolha:** arquivo novo com `export const statusTexts: Readonly<Record<number, string>>`, contendo os códigos registrados na RFC 9110 e nas extensões comuns (400–418, 421–426, 428, 429, 431, 451, 500–505, 507, 508, 511). Os nomes seguem a RFC 9110, então `422` é `"Unprocessable Content"`, o mesmo texto usado em `src/utils/query.ts:77`.

**Alternativas consideradas:**
- *`STATUS_CODES` de `node:http`.* Rejeitada: não é API web padrão e não existe em Workers, Deno ou browsers (`AGENTS.md`, "Prefer web standard APIs").
- *`new Response(null, { status }).statusText`.* Rejeitada: o valor depende do runtime e pode ser vazio (Node/undici).

**Custo:** a tabela adiciona poucos centenas de bytes ao bundle. O arquivo fica abaixo de 200 linhas.

### D-07 — Ramo em `errorResponse()` e `Content-Type` aplicado por último

**Escolha:** em `errorResponse()` (`src/response.ts:358`), a primeira instrução verifica `kProblem`. Com marca, delega a `problemErrorResponse(error, debug, errHeaders)`, uma função interna de `src/response.ts`:

1. `headers = new Headers(error.headers)`; mescla `errHeaders` do mesmo jeito que `errorResponse` faz hoje (`src/response.ts:362-364`).
2. `headers.set("content-type", "application/problem+json")`, por último, para que `Content-Type` passado em `headers` da entrada não substitua o tipo (RF-03, RF-06).
3. Corpo: `JSON.stringify(problemMembers(error, debug), undefined, debug ? 2 : undefined)`, o mesmo formato de indentação de `src/response.ts:371-372`.
4. Status e `statusText` vêm de `error.status` e `error.statusText`, como em `src/response.ts:374-377`.

**Alternativas consideradas:**
- *Mesclar `application/problem+json` antes de `error.headers`, como `jsonHeaders` (`src/response.ts:270-272`).* Rejeitada: um `Content-Type` passado pelo usuário venceria, o que quebra RF-03.
- *Duplicar `errorResponse` inteiro.* Rejeitada: duplica a lógica de `errHeaders`. A extração de `mergeHeaders` (`src/response.ts:243`) já cobre o caso.

**Fluxo de `onError`:** `prepareResponse` (`src/response.ts:146-174`) passa o próprio erro marcado para `onError`. Se `onError` devolver o erro, ou se não houver `onError`, a marca é lida em `errorResponse`. Se `onError` devolver outro valor, a resposta segue o formato desse valor (RF-03 vale para o erro que chega à resposta).

### D-08 — Membros de extensão e ordem do corpo

**Escolha:** `problemMembers()` devolve, na ordem:

```
{ data, ...body, type, title, status, detail, instance, stack }
```

- `data` fica como membro `data` (RF-05 e o critério de aceite: `campo` dentro de `data`).
- `body` é espalhado no nível raiz, igual a `toJSON()` (`src/error.ts:234`), então um `body.data` substitui `data` como hoje.
- Os membros da RFC vêm depois, então prevalecem sobre `body` (RF-05).
- `stack` vem por último e é `undefined` quando não é exibido. Assim um `body.stack` nunca aparece, e o comportamento fica igual ao de `src/response.ts:369`.

**Alternativas consideradas:**
- *Membros da RFC primeiro e `...body` depois.* Rejeitada: `body.type` sobrescreveria `type`, contrariando RF-05.

### D-09 — Erro `unhandled` no caminho problem e a discrepância com o código atual

**Escolha:** em erros `problem()` com `unhandled: true`, o corpo tem só `type`, `title` e `status` (RF-07), e `stack` nunca aparece, mesmo em debug (RF-09). `instance` também fica de fora, porque RF-07 lista só esses três membros. Isso é uma escolha minha, documentada aqui; é fácil inverter se o time preferir expor `instance`.

**Discrepância com o PRD:** RF-07 diz que a ocultação de `HTTPError` "se mantém" e que `stack` não aparece. No código atual isso não é verdade para erros legados: `errorResponse` inclui `stack` quando `debug` está ativo, sem checar `unhandled` (`src/response.ts:369`). O teste de `test/errors.test.ts:107-122` com erro não tratado não verifica `stack`, então o comportamento atual não é coberto.

**Decisão:** o caminho problem oculta `stack` em unhandled. O caminho legado não muda (RF-08). Registrar em um issue separado a questão de ocultar `stack` de erros legados não tratados em debug. Não corrigir agora, para não mudar RF-08.

**Referência de padrão:** `src/utils/json-rpc.ts:483` já mascara erros `unhandled` com a mesma lógica.

### D-10 — Exportação pública e snapshot de exports

**Escolha:** em `src/index.ts`, na seção `// Error` (`src/index.ts:70-72`), adicionar:

```ts
export { problem, type ProblemInput } from "./problem.ts";
```

`src/_entries/generic.ts:7` faz `export * from "../index.ts"`, então todos os entries herdam a exportação. O `_deprecated.ts` não tem nenhum `problem`, então não há colisão (`src/_deprecated.ts:28-34` só tem `createError`).

**Consequência em teste existente:** o snapshot de `test/unit/package.test.ts` lista todos os exports e vai falhar com `problem`. Essa é a única alteração em teste existente, e é justificada por RF-01. Inserir `"problem",` entre `"parseCookies"` (`test/unit/package.test.ts:104`) e `"proxy"` (`test/unit/package.test.ts:105`), mantendo a ordenação.

---

## 3. Arquivos a alterar

| Arquivo | Tipo | Alteração |
|---|---|---|
| `src/problem.ts` | novo | `kProblem`, `ProblemInput`, `ProblemMeta`, `problem()`, `problemMembers()` (D-01, D-02, D-03, D-04, D-05, D-08, D-09) |
| `src/utils/internal/status-text.ts` | novo | `statusTexts` (D-06) |
| `src/response.ts:2` | alterar | adicionar `import { kProblem, problemMembers } from "./problem.ts";` ao lado de `import { HTTPError } from "./error.ts";` |
| `src/response.ts:358-380` | alterar | `errorResponse()` delega ao ramo problem quando `(error as any)[kProblem]` existe; nova função interna `problemErrorResponse()` (D-07) |
| `src/response.ts:243-252` | não muda | `mergeHeaders` é reaproveitado |
| `src/response.ts:146-174` | não muda | fluxo de `onError` e `errHeaders` continua igual (D-07) |
| `src/error.ts` | não muda | `ErrorInput` (`:6`), `ErrorDetails` (`:28`), `ErrorBody` (`:30`), `toJSON()` (`:226-236`) ficam intactos (D-03, RF-08) |
| `src/index.ts:70-72` | alterar | exportar `problem` e `ProblemInput` (D-10) |
| `test/problem.test.ts` | novo | testes de comportamento, `describeMatrix` (ver seção 5) |
| `test/unit/types.test-d.ts:1-29` | alterar | adicionar testes de tipo para `problem()` e `ProblemInput` (ver seção 5) |
| `test/unit/package.test.ts:104-105` | alterar | incluir `"problem"` no snapshot (D-10) |

Arquivos que **não** mudam, apesar de tocarem no mesmo fluxo:
- `test/errors.test.ts`: os testes legados (`:44` espera `application/json;charset=UTF-8`, `:53-57` espera o corpo legado) continuam válidos, porque o caminho legado não muda (RF-08).
- `src/utils/json-rpc.ts`, `src/utils/event-stream.ts`, `src/utils/ws.ts`: serializam erros por conta própria (PRD, "Riscos").

---

## 4. Contratos e assinaturas

### 4.1 API pública

```ts
// src/problem.ts

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI que identifica o tipo do problema. Padrão: "about:blank". */
  type?: string;
  /** URI reference que identifica a ocorrência específica do problema. */
  instance?: string;
}

export function problem<DataT = unknown>(
  input: ProblemInput<DataT>,
): HTTPError<DataT> & { readonly type: string; readonly instance: string | undefined };
```

Implementação de referência (não é código final):

```ts
export function problem<DataT = unknown>(input: ProblemInput<DataT>) {
  const { type = "about:blank", instance, ...errorInput } = input;
  const error = new HTTPError<DataT>(errorInput);
  const meta: ProblemMeta = { type, instance, detail: input.message || undefined };
  return Object.assign(error, { type, instance, [kProblem]: meta });
}
```

### 4.2 Interno (não exportado do pacote)

```ts
// src/problem.ts
export const kProblem: unique symbol = /* @__PURE__ */ Symbol.for("h3.problem");

interface ProblemMeta {
  readonly type: string;
  readonly instance: string | undefined;
  readonly detail: string | undefined;
}

/** Membros do corpo RFC 9457 para um erro marcado. Ordem e regras: D-08 e D-09. */
export function problemMembers(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

```ts
// src/utils/internal/status-text.ts
export const statusTexts: Readonly<Record<number, string>>;
```

```ts
// src/response.ts (interno)
function problemErrorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response;
```

### 4.3 Formato da resposta

Exemplo para `throw problem({ status: 404, type: "https://exemplo.com/erros/nao-encontrado", message: "Recurso ausente", instance: "/itens/7" })` com `debug` desligado:

```
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type":"https://exemplo.com/erros/nao-encontrado","title":"Not Found","status":404,"detail":"Recurso ausente","instance":"/itens/7"}
```

Com `unhandled: true`: corpo `{"type":"about:blank","title":"Internal Server Error","status":500}`.

Com `debug` ligado, `stack` é uma lista de linhas, como no formato atual (`src/response.ts:369`), e o corpo é indentado com 2 espaços.

### 4.4 Regras de tipo

- `problem()` aceita qualquer `DataT`, como `HTTPError` (`src/error.ts:74`).
- `ProblemInput` é atribuível a `ErrorDetails` (`src/error.ts:28`).
- `ErrorInput` e `ErrorDetails` não ganham campos.

---

## 5. Estratégia de testes

O AGENTS.md pede TDD para bugs; para funcionalidade nova, o mesmo fluxo vale: escrever os testes de `test/problem.test.ts` antes de `src/problem.ts`, rodar e confirmar que falham, depois implementar.

### 5.1 `test/problem.test.ts` (novo, `describeMatrix`, roda em `web` e `node`)

`describeMatrix` em `test/_setup.ts:11`. O setup usa `debug: true` (`test/_setup.ts:136`), então para os casos sem debug o teste deve fazer `t.app.config.debug = false`, como `test/errors.test.ts:14` faz com `onError`.

| Caso | RF | Verificação |
|---|---|---|
| `problem()` retorna `instanceof HTTPError` com `status` e `message` | RF-01 | `expect(err).toBeInstanceOf(HTTPError)` |
| `type` e `instance` acessíveis no erro, `status` 403 | RF-02 | propriedades do objeto |
| handler faz `throw problem(...)`: status 404, `Content-Type` exato, corpo com `type`, `title`, `status`, `detail`, `instance` | RF-03 | `res.headers.get("content-type")` igual a `application/problem+json` |
| mesmo caso com `onError` configurado que devolve o erro | RF-03 | repetir com `t.app.config.onError` |
| `type` ausente vira `"about:blank"`; `title` vem da tabela para 422; `detail` é a mensagem | RF-04 | corpo |
| `title` usa `statusText` quando informado | RF-04 | corpo |
| `data` como `data`; `body.tentativas` na raiz; `body.type` não substitui `type` | RF-05 | corpo |
| `headers` da entrada (`WWW-Authenticate`, `Retry-After`) presentes; `Content-Type` continua problem+json mesmo com `Content-Type` em `headers` | RF-06 | cabeçalhos |
| `unhandled: true`: corpo sem `detail`, `data`, `stack` e sem a mensagem secreta; tem `status` e `title` | RF-07 | `JSON.stringify(body)` não contém o segredo |
| erro legado `new HTTPError({ status: 404, message: "não achei" })` continua `application/json`, mesmas chaves | RF-08 | `res.headers.get("content-type")` e `toMatchObject` |
| com debug ligado, `stack` é array de strings; `Content-Type` continua problem+json | RF-09 | corpo |
| `HEAD` em rota com `problem()` não envia corpo | D-07 | `res.text()` vazio |
| `detail` ausente sem `message` explícito | D-05 | corpo sem chave `detail` |
| status fora da tabela: `title` é `"Unknown Error"` | D-05 | corpo |

### 5.2 Testes de tipo (`test/unit/types.test-d.ts`)

Usar `expectTypeOf` (já importado em `test/unit/types.test-d.ts:12-29`):
- `problem({ status: 404 })` retorna algo atribuível a `HTTPError` e com `type: string`.
- `ProblemInput` aceita `type` e `instance`; `new HTTPError({ status: 404, type: "x" })` falha (`// @ts-expect-error`), provando que `ErrorInput` não mudou (D-03).
- `problem({ status: 404, foo: 1 })` falha (`@ts-expect-error`).

### 5.3 Regressão e suíte existente

- `test/errors.test.ts` e demais testes existentes passam sem alteração (RF-08, RF-10).
- Única alteração em teste existente: snapshot em `test/unit/package.test.ts` (D-10).
- `pnpm vitest run test/problem.test.ts` para o arquivo novo.
- `pnpm vitest run` para a suíte completa.
- `pnpm typecheck` e `pnpm lint` (RF-12).
- `test/dist.test.ts` usa o build em `dist/`; rodar `pnpm build` antes para validar que `problem` aparece nos entries compilados.

### 5.4 Cobertura

`pnpm test` roda `vitest --run --coverage`. `src/problem.ts` e `status-text.ts` devem ficar cobertos pelos casos de 5.1. Os ramos de `errorResponse` com marca e sem marca precisam ter pelo menos um caso cada.

---

## 6. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Colisão entre `body` e membros da RFC (`type`, `title`, `status`, `detail`, `instance`) | cliente lê valor errado | ordem de D-08; teste de 5.1 |
| Vazamento de `detail` e de extensões quando `unhandled` é falso | exposição de dados internos | responsabilidade do chamador; documentar; RF-07 cobre o caso unhandled |
| Discrepância: `stack` aparece em erros legados `unhandled` com debug | exposição de stack em debug | D-09; caminho problem oculta; caminho legado não muda (RF-08); issue separado |
| `type` aceita qualquer string, não só URI | corpo não conforme a RFC | fora de escopo (PRD); documentar que se recomenda URI |
| `instance` não validado | idem | idem |
| `Content-Type` de `headers` da entrada | corpo com tipo errado | D-07: `set` por último |
| `Object.assign` escreve propriedades `readonly` | contorno de tipagem | só dentro de `problem()`; o tipo de retorno expõe `readonly` |
| Símbolo `Symbol.for` visível globalmente | outra lib poderia marcar erro | nome `h3.problem`, sem efeito fora de `errorResponse` |
| Erro propagado por `new HTTPError({ cause: problemErr })` perde a marca | cai no formato legado | comportamento aceito; cause não é copiado (`src/error.ts:197`); documentar |
| Fluxos fora de `toResponse` (SSE, WebSocket, JSON-RPC) | formato não muda nesses fluxos | fora de escopo (PRD); `json-rpc.ts:483` mascara do jeito atual |
| Tamanho da tabela de status | aumento pequeno do bundle | tabela restrita aos códigos RFC 9110 mais comuns, sem dependências |
| `detail` ausente quando não há `message` | cliente recebe corpo sem `detail` | D-05; documentado |
| Snapshot de exports quebra | teste falha | D-10; atualização explícita no mesmo commit |
