# Techspec — Problem details (RFC 9457) via `problem()`

Origem: `sdd/pedido.md` (contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-11). Todas as citações `arquivo:linha` foram conferidas no código atual (commit `f1c35e9`).

## 1. Estado atual (resumo do que foi lido)

- `HTTPError` guarda `status`, `statusText`, `headers`, `data`, `body`, `unhandled` e `cause` (`src/error.ts:74-119`). O construtor define `cause = details` (o objeto de entrada inteiro) em `src/error.ts:196-197`, e calcula um `message` com fallbacks (`src/error.ts:187-193`): sem `message` explícito ele vira `"HTTPError 404 ..."`. Logo, `error.message` **não** diz se o `message` foi informado.
- `HTTPError.toJSON()` (`src/error.ts:226-236`) monta o corpo atual e mascara `message`/`data`/`body` quando `unhandled`.
- Todo erro vira `Response` em `errorResponse` (`src/response.ts:358-380`). Ele parte de `jsonHeaders` (`src/response.ts:270-272`), mescla `error.headers` por cima (`src/response.ts:359-361`) e depois `errHeaders` (`src/response.ts:362-364`). Adiciona `stack` só se `debug` (`src/response.ts:369`).
- `errorResponse` é chamado em um único lugar, `prepareResponse` (`src/response.ts:173`). Esse ramo atende `throw`, `return` e `onError` de config: o `onError` de config roda em `src/response.ts:161-165` e re-entra em `prepareResponse` com `nested = true`. O middleware `onError()` (`src/utils/middleware.ts:37-63`) só repassa/relança o erro, então também cai nesse mesmo ramo.
- `mergeHeaders(base, overrides)` faz `set` (e `append` só para `set-cookie`) (`src/response.ts:243-252`): o que vem em `overrides` vence.
- Não existe tabela de frases de status no repositório (busca por `STATUS_CODES`/frases não achou nada em `src/`). O `title` padrão precisa de uma tabela nova (ver D-04).
- Exports: `src/index.ts:72` exporta o grupo "Error". `test/unit/package.test.ts:4-158` tem snapshot inline da lista de exports; ele vai ganhar `"problem"`.
- Fixture de testes: `describeMatrix` (`test/_setup.ts:11`) cria `ctx.app` com `debug: true` (`test/_setup.ts:135-136`) e `onError` com `vi.fn` (`test/_setup.ts:128-133`) que empilha em `ctx.errors`.

## 2. Decisões de arquitetura

### D-01 — Marca interna `~problem` não enumerável, guardando o serializador

**Problema:** `errorResponse` e `toJSON()` precisam saber que o erro veio de `problem()`, sem novo nome público e sem alterar `HTTPError` para os outros erros.

**Alternativas:**

1. Subclasse `ProblemError extends HTTPError`. Cria um nome (mesmo sem exportar, aparece em stack/`constructor.name`), e `isError` já funciona por `name === "HTTPError"`; mas é uma classe nova, o que o PRD veda (§3).
2. Campo público/opcional em `ErrorInput` (ex.: `format: "problem"`). Altera tipos públicos existentes.
3. Símbolo `Symbol.for(...)` como marca. Funciona entre cópias do h3, mas o PRD (§4, premissas) e as convenções (`~` para propriedades privadas) pedem prefixo `~`.
4. Propriedade `~problem` definida com `Object.defineProperty` (não enumerável), cujo **valor é uma função** `(error) => body` que serializa o corpo.

**Escolha: 4.** Segue a convenção `~` do projeto, não é enumerável (não aparece em `JSON.stringify`, `Object.keys`, nem em spreads) e não muda a classe nem os tipos públicos. Guardar o serializador como valor evita que `src/error.ts` importe a tabela de status e o montador do corpo: `toJSON()` só faz `this["~problem"]?.(this)`. Isso preserva o tamanho do bundle de quem não usa `problem()` (mesma preocupação registrada em `src/rules/handlers/headers.ts:38`, que inlina `isError` para não puxar `error.ts`). A propriedade é `configurable: false`, `writable: false`, definida na instância recém-criada.

### D-02 — `problem()` é função fina em arquivo novo `src/utils/problem.ts`

**Alternativas:** (a) colocar em `src/error.ts` — o arquivo já tem 237 linhas, acima da meta de 200; (b) método estático `HTTPError.problem` — nome público novo fora do pedido; (c) arquivo próprio em `src/utils/` (padrão dos utilitários públicos, ex.: `src/utils/response.ts`).

**Escolha: (c).** `src/utils/problem.ts` contém `problem()`, o tipo `ProblemInput` e o montador interno do corpo (curto). A tabela de status fica em `src/utils/internal/status-text.ts`. `src/index.ts` ganha a exportação (D-07).

### D-03 — Ramo isolado em `errorResponse` e `toJSON()`, com `content-type` por mesclagem

**Problema:** RF-03/RF-07 exigem `application/problem+json;charset=UTF-8` por padrão, mas um `content-type` explícito em `headers` deve ser respeitado; RF-09 exige que os outros erros fiquem byte a byte iguais.

**Alternativas:**

1. Montar a `Response` dentro de `problem()` e devolver `HTTPResponse`. Perde o requisito de devolver `HTTPError` (RF-01) e `HTTPError.isError`.
2. Alterar `jsonHeaders` globalmente. Quebra RF-09.
3. Em `errorResponse`, escolher a base de cabeçalhos por erro: `problemHeaders` (frozen, `application/problem+json;charset=UTF-8`) quando há `~problem`, senão `jsonHeaders`; o restante do fluxo (`mergeHeaders` com `error.headers`, depois `errHeaders`) fica igual.

**Escolha: 3.** Como `mergeHeaders` aplica `error.headers` por cima da base (`src/response.ts:360`), um `content-type` explícito vence naturalmente (RF-07) e a omissão cai em `problem+json`. A ordem `base < error.headers < errHeaders` é a atual, então `event.res.errHeaders` continua podendo sobrescrever o content-type (comportamento já existente para o JSON). O corpo continua sendo `JSON.stringify({ ...error.toJSON(), stack })` (`src/response.ts:366-373`), com `debug` indentando, o que deixa `stack` como membro de extensão (RF-10). O ramo é um `error["~problem"]` lido uma vez no topo de `errorResponse`; sem marca, o caminho executado é o de hoje.

### D-04 — `title`: `statusText` e, na falta, tabela interna de frases HTTP

**Problema:** RF-05 exige `title: "Not Found"` para `problem({ status: 404 })`, mas não há tabela no repositório e `new Response(null, {status}).statusText` é vazio em runtimes web.

**Alternativas:**

1. `http.STATUS_CODES` do Node: quebra a portabilidade (Workers/Deno/browser) — contra a premissa "web standards first".
2. Omitir `title` sem `statusText`: contradiz RF-05.
3. Tabela interna pequena (códigos 1xx–5xx registrados pela IANA que o h3 já trata), só importada por `src/utils/problem.ts`.

**Escolha: 3.** `src/utils/internal/status-text.ts` exporta `getStatusText(status: number): string | undefined`. Para status fora da tabela e sem `statusText`, `title` é omitido (a RFC 9457 §3.1.3 diz que `title` é opcional-recomendado) — decisão registrada, conforme a premissa do PRD §4. Ordem: `error.statusText` (já sanitizado pelo construtor, `src/error.ts:180-185`) → tabela → omitido. Usar o `statusText` sanitizado remove caracteres não ASCII; é aceitável e consistente com o que já vai na linha de status.

### D-05 — Mapeamento do corpo e precedência

Corpo (função `toProblemBody(error, input)` interna a `problem.ts`):

1. Membros padrão primeiro, nesta ordem: `type` (padrão `"about:blank"`), `title`, `status`, `detail`, `instance`. Valores `undefined` somem na serialização.
2. `detail` = `input.message` capturado em `problem()` quando é string não vazia — **não** `error.message`, que tem fallbacks (`src/error.ts:187-193`). Sem `message` explícito, omitido (RF-05).
3. Extensões: `data` (se `!== undefined`) como chave `data`, depois as chaves de `body`. Precedência: padrão > `data` > `body`. Chaves padrão vindas de `body` são descartadas (RF-06).
4. A cópia usa `Object.fromEntries` (cria propriedades de dados; um `__proto__` próprio vindo de um `JSON.parse` não altera o protótipo), nunca atribuição `out[key] = ...`.
5. `type` e `instance` só entram se forem `string` em runtime; qualquer outro valor é ignorado (o tipo já os restringe, mas o campo pode vir de `any`).
6. `unhandled` (`error.unhandled === true`): `detail`, `data` e `body` são omitidos; `type`, `title`, `status` e `instance` permanecem. Reaproveita a regra de `toJSON()` (`src/error.ts:227-235`) e atende RF-10. O `cause` nunca é serializado (já é assim hoje).

Alternativa descartada: derivar `detail` de `error.message` descartando o padrão `"HTTPError ..."`. Frágil: um usuário pode passar literalmente esse texto.

### D-06 — Entrada: `ProblemInput` estende `ErrorInput`

```ts
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI de referência que identifica o tipo do problema. Padrão: `"about:blank"`. */
  type?: string;
  /** URI de referência que identifica esta ocorrência do problema. */
  instance?: string;
}
```

**Alternativas:** `ErrorInput<DataT> & { type?; instance? }` (interseção: mensagens de erro piores e excess-property check menos previsível) ou tipo novo independente (duplica campos). **Escolha:** `interface ... extends`, que mantém a rejeição de campos desconhecidos (RF-02). `type` e `instance` são removidos antes de chamar o construtor (`const { type, instance, ...rest } = input`), para não poluírem `cause` (que guarda o objeto de entrada, `src/error.ts:196-197`). O nome do tipo é `ProblemInput` (o único nome de tipo novo, conforme o pedido).

### D-07 — Exportação mínima

Em `src/index.ts:72` (grupo "Error") acrescentar uma linha: `export { problem, type ProblemInput } from "./utils/problem.ts";`. Sem barrel, import direto do módulo. O snapshot de `test/unit/package.test.ts` ganha `"problem"` entre `"parseCookies"` (linha 104) e `"proxy"` (linha 105) — ordem alfabética (`b` < `x`). Nenhum outro export muda (RF-01).

### D-08 — `toJSON()` reflete o corpo problem details sem mudar a assinatura

**Problema:** `toJSON(): Omit<ErrorBody, "body"> & ErrorBody["body"]` (`src/error.ts:226`) exige `message: string` e `status`; o corpo RFC não tem `message`.

**Alternativas:** (1) ampliar o tipo de retorno para uma união — quebra código que lê `err.toJSON().message` (viola RF-11); (2) sobrecarga — complexa e não distingue em tipo; (3) manter a assinatura e converter o retorno do serializador com `as` no ramo `~problem`.

**Escolha: 3.** A compatibilidade de tipos (RF-11) pesa mais; o `as` fica restrito a uma linha com comentário explicando que o formato de `problem()` é uma variante em runtime. O ramo é a primeira instrução de `toJSON()`; os erros comuns executam o código atual sem alteração.

### D-09 — Não propagar a marca por `cause`

`new HTTPError({ cause: problemError })` copia `status`/`statusText`/`headers`/`unhandled` da cause (`src/error.ts:172-206`), mas não a marca (propriedade própria, não lida do `cause`). Alinha com a premissa do PRD §4 ("`problem()` na `cause` não é propagado"). Consequência prática: o erro é um `HTTPError` comum e usa o formato atual. Documentado como comportamento, coberto por teste.

## 3. Arquivos a alterar

| Arquivo                                                                     | Alteração                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/utils/problem.ts` (novo)                                               | `problem()`, `ProblemInput`, montador do corpo (D-02, D-05, D-06)  |
| `src/utils/internal/status-text.ts` (novo)                                  | `getStatusText()` (D-04)                                           |
| `src/error.ts:226`                                                          | `toJSON()`: primeiro ramo `this["~problem"]` (D-08)                |
| `src/response.ts:270-272`                                                   | ao lado de `jsonHeaders`, nova constante `problemHeaders` (frozen) |
| `src/response.ts:358-361`                                                   | `errorResponse`: escolher base de cabeçalhos pela marca (D-03)     |
| `src/index.ts:72`                                                           | exportar `problem` e `ProblemInput` (D-07)                         |
| `test/unit/package.test.ts:104-105`                                         | snapshot de exports (+`"problem"`)                                 |
| `test/problem.test.ts` (novo)                                               | testes `describeMatrix` RF-01…RF-10                                |
| `test/unit/types.test-d.ts` (fim do `describe("types")`, que começa em :35) | testes de tipo de `ProblemInput` (RF-02)                           |

Não mudam: `src/h3.ts`, `src/adapters.ts`, `src/utils/middleware.ts:37-63` (o fluxo `onError` já converge em `errorResponse`), `src/types/*`, validação, sessão, CORS, proxy, rules, `docs/` (decisão posterior, PRD §3).

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  type?: string;
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;

// src/utils/internal/status-text.ts
export function getStatusText(status: number): string | undefined;
```

Esboço de `problem()` (`isolatedDeclarations`: tipo de retorno explícito):

```ts
export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT> {
  const { type, instance, ...rest } = input;
  const error = new HTTPError<DataT>(rest);
  Object.defineProperty(error, "~problem", {
    value: (e: HTTPError) => toProblemBody(e, { type, instance, message: input.message }),
  });
  return error;
}
```

`Object.defineProperty` sem flags deixa a propriedade não enumerável, não gravável e não configurável. Leitura em `error.ts`/`response.ts` por `(error as any)["~problem"]`, evitando declarar a propriedade na classe (não aparece em `.d.ts`).

**Contrato de resposta** (para `throw problem(i)` e `return problem(i)`, idênticos):

- status HTTP = `error.status` (sanitizado pelo construtor; status ausente → 500, `src/error.ts:172-178`). O membro `status` do corpo usa o mesmo valor.
- `content-type: application/problem+json;charset=UTF-8`, salvo `content-type` explícito em `headers`.
- Corpo conforme D-05. Em `debug`, JSON indentado e `stack` (array de linhas, como hoje) como extensão; fora de `debug` nunca há `stack` (`src/response.ts:369`).

## 5. Estratégia de testes

Fluxo do projeto (bug/feature): escrever os testes primeiro, ver falhar, implementar, rodar tudo.

**`test/problem.test.ts`** com `describeMatrix` (web + node), um `it` por critério de aceite:

- RF-01: `HTTPError.isError(problem({ status: 404 }))`, `status === 404`.
- RF-03/RF-07: content-type `problem+json`; `retry-after` preservado; `content-type` explícito em `headers` vence; ausência não volta para `application/json`.
- RF-04/RF-05: corpo exato (`toEqual`) dos dois exemplos do PRD; `title` por tabela (404) e por `statusText` customizado; status fora da tabela sem `statusText` → sem `title`; `detail` omitido sem `message`, **inclusive** quando o `message` padrão do construtor existe.
- RF-06: `body: { saldo, status: 200 }` + `data` → `status` continua 422, `saldo` e `data` presentes; `body` com chaves `type`/`title`/`detail`/`instance` não sobrescrevem; `body` com `__proto__` próprio (criado via `JSON.parse`) não altera protótipo.
- RF-08: rotas `throw` e `return` com mesmo status/content-type/corpo; o mesmo dentro de middleware (`app.use`) e retornado de `onError` de config e do middleware `onError()` (`src/utils/middleware.ts:37`).
- RF-09: `new HTTPError`, `HTTPError.status`, `Error` genérico, 404 de rota e erro de validação mantêm `application/json;charset=UTF-8` e o formato atual. As asserções existentes de `test/errors.test.ts` (ex.: `:44`, `:140`) são a rede de regressão e **não** devem ser alteradas.
- RF-10: o `ctx.app` padrão usa `debug: true` (`test/_setup.ts:135-136`); os casos "debug desligado" criam um `new H3({ debug: false })` próprio com `toWebHandler`/`app.fetch` (ou usam um `describe` com `ctx.app.config.debug = false`, se existir; conferir na implementação). Casos: `unhandled: true` sem vazar `message`/`data`/`body`/`cause` nem `stack`; em debug, `stack` presente como extensão.
- RF-11: `problem(...).toJSON()` igual ao corpo enviado; `new HTTPError(...).toJSON()` inalterado (deep equal contra o objeto literal atual); `Object.keys(error)` e `JSON.stringify(error)` não contêm `~problem`.
- D-09: `new HTTPError({ cause: problem({ status: 409 }) })` responde no formato atual.

**Tipos:** em `test/unit/types.test-d.ts` (usa `expectTypeOf`, importado em `:12`): chamada completa do RF-02 aceita; campo desconhecido com `// @ts-expect-error`; `problem()` retorna `HTTPError<DataT>`.

**Regressão e gates:** `test/unit/package.test.ts` (snapshot, D-07); `pnpm vitest run test/problem.test.ts` durante o desenvolvimento; ao final `pnpm lint`, `pnpm typecheck` (inclui `src` e `test`, `tsconfig.json:25`) e `pnpm test`. Nenhum teste existente deve mudar além do snapshot de exports (mudança forçada e sem perda de verificação).

## 6. Riscos

| Risco                                                                  | Mitigação                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Regressão no formato atual (`errorResponse` e `toJSON` compartilhados) | Ramo único por `~problem` ausente = código atual; RF-09 + suíte existente                                                                    |
| Vazamento em erro não tratado                                          | `unhandled` omite `detail`/`data`/`body`; teste dedicado com debug desligado (D-05.6)                                                        |
| `detail` indevido a partir do `message` de fallback                    | `detail` vem de `input.message` capturado, não de `error.message` (D-05.2)                                                                   |
| Conflito de `content-type`                                             | Ordem `problemHeaders < error.headers < errHeaders` testada (D-03); `errHeaders` pode sobrescrever o content-type, como já ocorre com o JSON |
| Colisão/injeção em extensões (`type`, `status`, `__proto__`)           | Padrão > `data` > `body`; cópia por `Object.fromEntries` (D-05.3-4)                                                                          |
| Cast em `toJSON()` mascara a diferença de forma                        | Restrito a uma linha comentada; alternativa (união) quebraria RF-11 (D-08)                                                                   |
| Tabela de status aumenta bundle                                        | Importada só por `problem.ts`; marca guarda a função, então `error.ts` não puxa a tabela (D-01, D-04)                                        |
| `stack` em debug aparece no corpo mesmo em `unhandled`                 | Já é o comportamento atual em debug (`src/response.ts:369`); RF-10 só garante ausência fora de debug                                         |
| Cópias duplicadas do h3 / `Error` cruzando realms                      | A marca é uma propriedade de string na instância; funciona entre cópias, e `isError` segue por `name` (`src/error.ts:129-133`)               |
| `statusText` sanitizado remove não ASCII do `title`                    | Documentado (D-04); `detail` aceita Unicode (RF-04 usa "Usuário")                                                                            |
| `problem()` na `cause` não propaga                                     | Decisão D-09, coberta por teste                                                                                                              |
