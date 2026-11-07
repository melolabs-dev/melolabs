# Techspec — `problem()` (RFC 9457) por utilitário explícito

Referências: `sdd/pedido.md` (contrato #1384-C), `sdd/prd.md` (RF-01..RF-09). Convenções: `AGENTS.md` (ESM, `.ts` explícito, `isolatedDeclarations`, arquivos < 200 LoC, sem barrel files, internos em `utils/internal/`).

## 1. Estado atual (conferido no código)

- `src/error.ts:6` `ErrorInput` (campos de `ErrorBody` parciais + `cause`, `headers`, `statusCode`, `statusMessage`); `src/error.ts:74` classe `HTTPError`; construtor em `src/error.ts:162-210` (guarda `status`, `statusText`, `headers`, `unhandled`, `data`, `body`; `cause = details`); `toJSON()` em `src/error.ts:226-236` (quando `unhandled`: `message: "HTTPError"`, sem `data`/`body`).
- `src/response.ts:146-174` (`prepareResponse`): se o valor é `Error`, usa o próprio `HTTPError` quando `HTTPError.isError` (linha 147-148); `onError` recebe essa mesma instância (linhas 159-165) e, se não devolver nada, renderiza `val` original (`newVal ?? val`, linha 165); sem `onError`, chama `errorResponse` (linha 173).
- `src/response.ts:358-380` `errorResponse`: monta headers a partir de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`), mescla `error.headers` e `errHeaders` (`mergeHeaders`, `src/response.ts:243`), serializa `{...error.toJSON(), stack}` (indentado se `debug`).
- Exportações públicas: `src/index.ts:72` (erros) e `src/index.ts:111-125` (utils de resposta); `src/_entries/generic.ts:6` reexporta `../index.ts`, então o snapshot `test/unit/package.test.ts:5-158` enxerga qualquer novo export.
- Não existe tabela de frases de status no repositório (`src/utils/sanitize.ts:10-21` só sanitiza).

## 2. Decisões de arquitetura

### D-01 — `problem()` como fábrica que marca um `HTTPError`
**Alternativas:** (a) subclasse `ProblemError extends HTTPError`; (b) fábrica que devolve `HTTPError` com marca interna; (c) flag pública em `ErrorInput`.
**Escolha: (b).** (a) cria um novo nome público e `HTTPError.isError` depende de `name === "HTTPError"` (`src/error.ts:129-133`), então a subclasse precisaria sobrescrever `name`, frágil. (c) adiciona campo público, proibido pelo contrato (“nenhum outro nome público”). A fábrica cria `new HTTPError(input)` e define, com `Object.defineProperty`, a propriedade não enumerável `"~problem"` com `{ type, instance }`. Satisfaz RF-01 e RF-08: é a mesma instância que atravessa `onError` (`src/response.ts:159-165`).

### D-02 — Onde a marca é lida: `errorResponse`
**Alternativas:** (a) alterar `HTTPError.toJSON()`; (b) ramificar em `errorResponse`; (c) converter em `prepareResponse` antes de `errorResponse`.
**Escolha: (b).** (a) violaria o fora de escopo (formato de `toJSON` não muda; `toJSON` também é usado por `JSON.stringify(error)` de usuários). (c) duplicaria a lógica de headers/stack. Em `errorResponse` (`src/response.ts:358`) basta: `const problem = (error as any)["~problem"]`; se presente, usa `problemHeaders` e `problemBody(error, problem, debug)` em vez de `jsonHeaders` e `error.toJSON()`. Erros sem marca seguem o caminho idêntico (RF-06). Como `error.headers` e `errHeaders` continuam sendo mesclados por cima (`src/response.ts:359-364`), RF-05 e o respeito a `content-type` explícito vêm de graça.

### D-03 — Corpo montado em módulo interno
**Alternativas:** colocar tudo em `src/error.ts` (já tem 237 linhas, acima da meta de 200 LoC) ou em `response.ts` (380 linhas) vs. novo `src/utils/internal/problem.ts`.
**Escolha:** `src/utils/internal/problem.ts` com `problemBody()` e a tabela de frases; `src/utils/problem.ts` com `problem()` e o tipo `ProblemInput` (API pública, no padrão de `src/utils/*.ts`). Sem barrel: `index.ts` e `response.ts` importam direto dos módulos.

Regras de `problemBody(error, marca, debug)`, nesta ordem de precedência (membros padrão vencem as extensões):
1. extensões: `...error.body` (somente se `!error.unhandled`) e `data` (somente se `!unhandled` e definido, sob a chave `data`, como no `toJSON`);
2. `type`: `marca.type ?? "about:blank"`;
3. `title`: `error.statusText`; se ausente e `type === "about:blank"`, frase padrão do status (tabela); senão omitido;
4. `status`: `error.status`;
5. `detail`: `error.toJSON().message` (portanto `"HTTPError"` quando `unhandled`, sem vazar a mensagem real — RF-07);
6. `instance`: `marca.instance` se definido;
7. `stack`: só com `debug`, como hoje (lista de linhas), adicionado por último e depois dos padrões.
`undefined` é descartado pelo `JSON.stringify`. Implementação: `{ ...ext, type, title, status, detail, instance, stack }` — o spread das extensões vem primeiro para que os membros padrão o sobrescrevam. A ordem das chaves não é semântica; os testes comparam com `toEqual`.

### D-04 — Tabela de frases de status interna e enxuta
**Alternativas:** `node:http` `STATUS_CODES` (quebra portabilidade Workers/browser, contra “web standards first”); dependência nova (contra “2 deps”); tabela própria.
**Escolha:** objeto `Record<number, string>` com os status comuns (400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 418, 422, 429, 500, 501, 502, 503, 504 e outros 4xx/5xx usuais). Status fora da tabela → `title` omitido (a RFC permite). Como `response.ts` importa o módulo estaticamente, o custo é uma constante pequena; aceitável.

### D-05 — `type`/`instance` ficam na marca, não no corpo/`body`
**Alternativas:** guardar dentro de `error.body` (a premissa do PRD permite); marca interna.
**Escolha:** marca interna `"~problem"`. Dentro de `body` seriam sobrescritos pela precedência e também apareceriam em `HTTPError.toJSON()` de erros `problem()` usados fora do fluxo de resposta. Marca não enumerável não vaza em `JSON.stringify(error)`/`toJSON` nem em `Object.keys`. `problem()` remove `type`/`instance` do objeto passado ao `HTTPError` (`const { type, instance, ...rest } = input`) para que `error.cause` (que guarda `details`, `src/error.ts:196-197`) não os carregue duplicados.

### D-06 — Tipo de entrada `ProblemInput`
**Alternativas:** `ErrorInput & { type?; instance? }` vs. `interface ProblemInput<DataT = unknown> extends ErrorInput<DataT>`.
**Escolha:** `interface` (mensagens de erro melhores, e `isolatedDeclarations` exige anotação exportada explícita de qualquer forma). `ErrorInput` já contém `status`, `statusText`, `message`, `data`, `body`, `unhandled`, `headers`, `cause` e os aliases depreciados (via `Partial<ErrorBody>`, `src/error.ts:6-26`) — RF-02 cumprido sem repetir campos. Genérico `DataT` preservado para não quebrar inferência de `data`.

### D-07 — `content-type` do problema
**Escolha:** `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` ao lado de `jsonHeaders` (`src/response.ts:270`), mesmo charset do atual (RF-04). `FrozenHeaders` é copiado via `new Headers(...)`/`mergeHeaders` como `jsonHeaders`, nunca mutado.

### D-08 — Sem mudanças em `onError`/`toError`
`toError` (`src/response.ts:73-83`) passa `Error`s adiante; a instância marcada permanece. Se o hook devolver outro erro/valor, vale o novo (conforme RF-08, “a não ser que o hook a substitua”). Nenhuma alteração necessária em `h3.ts`/`middleware.ts`.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/problem.ts` (novo) | `problem()` e `ProblemInput` |
| `src/utils/internal/problem.ts` (novo) | `problemBody()`, tabela de frases, constante/ helper de leitura da marca |
| `src/response.ts:270` | adicionar `problemHeaders` após `jsonHeaders` |
| `src/response.ts:358-380` | `errorResponse` escolhe headers/corpo pela marca; import no topo (`src/response.ts:2` área de imports) |
| `src/index.ts:111-125` | `export { problem, type ProblemInput } from "./utils/problem.ts"` (bloco “Response”, ou próximo ao `src/index.ts:72` de erros — preferido: logo após a linha 72, por afinidade com `HTTPError`) |
| `test/unit/package.test.ts:104-105` | inserir `"problem",` entre `"parseCookies"` e `"proxy"` (ordem alfabética do snapshot) |
| `test/problem.test.ts` (novo) | testes de integração (`describeMatrix`) |
| `test/unit/types.test-d.ts:35` | novo `describe`/`it` de tipos para `ProblemInput` (arquivo já cobre `routeRules` em `:471`) |

`src/error.ts` **não** muda. Tipos exportados novos: apenas `ProblemInput` (o `type` exportado fica fora do snapshot de runtime, que lista só valores).

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import { HTTPError, type ErrorInput } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI reference identifying the problem type. Defaults to `"about:blank"`. */
  type?: string;
  /** URI reference identifying this specific occurrence of the problem. */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

Retorna `HTTPError` com a marca `"~problem"`: `{ type?: string; instance?: string }` (não enumerável, não gravável). `HTTPError.isError(result) === true`.

```ts
// src/utils/internal/problem.ts
export type ProblemMark = { type?: string; instance?: string };
export function getProblemMark(error: HTTPError): ProblemMark | undefined;
export function problemBody(
  error: HTTPError,
  mark: ProblemMark,
  debug?: boolean,
): Record<string, unknown>;
```

Corpo (exemplo RF-03): `{"type":"https://exemplo.com/erros/nao-encontrado","title":"Not Found","status":404,"detail":"Usuário 42 não existe","instance":"/usuarios/42","saldo":0}`. Resposta: status `error.status`, `statusText` do erro, `content-type: application/problem+json;charset=UTF-8`.

Assinatura de `errorResponse` não muda (`src/response.ts:358`).

## 5. Estratégia de testes

Todos em `test/problem.test.ts` com `describeMatrix` (modos `web` e `node`), `ctx.app` fresco e `ctx.errors` auto-verificado. Pontos:

- RF-01: `problem({status:400})` é `instanceof HTTPError`, `HTTPError.isError` true, `status` 400; funciona com `throw` e com `return`.
- RF-03: caso completo do PRD com `toEqual` (inclui `body: { saldo: 0 }`); default `type: "about:blank"` + `title` = frase do status; `type` custom sem `statusText` → sem `title`; `instance` ausente → chave ausente; `body` com `type/title/status/detail/instance` não sobrescreve os padrões; `data` aparece sob `data`.
- RF-04: `content-type` começa com `application/problem+json`, status 422.
- RF-05: 429 + `statusText` + `retry-after`; `headers: {"content-type": "application/x-custom"}` é respeitado.
- RF-06: `new HTTPError`, `HTTPError.status`, `throw new Error`, 404 de rota inexistente e erro de validação mantêm `application/json` e corpo (comparação com formato atual).
- RF-07: `unhandled: true` com `message: "segredo interno"` e `data`/`body`: corpo sem o texto, sem extensões, `detail: "HTTPError"`, `content-type` de problema; com `debug: true` aparece `stack` (e continua no formato problem).
- RF-08: app com `onError` (spy) recebe `HTTPError` 409 marcado; resposta final segue `application/problem+json`; variante em que o hook devolve outra resposta substitui o formato; variante com `async` hook.
- Ordem: `HEAD`/sem `onError` e com `onError` (padrão do `errors.test.ts:6-60`) para cobrir o ramo síncrono e o `Promise` (`src/response.ts:161` vs `173`).
- Tipos (`test/unit/types.test-d.ts`): `problem({status, message, type, instance})` compila; omitir `type`/`instance` compila; `type: 1` é erro (`// @ts-expect-error`); retorno é `HTTPError<…>`; `ProblemInput` estende `ErrorInput` (`expectTypeOf<ProblemInput>().toMatchTypeOf<ErrorInput>()`).
- Regressão: único teste existente a ajustar é o snapshot de exports (`test/unit/package.test.ts`), adicionando só `"problem"`. Rodar `pnpm vitest run`, `pnpm lint`, `pnpm typecheck` (RF-09). Executar antes um teste novo e confirmar que falha sem a implementação (fluxo de bug do `AGENTS.md`).

## 6. Riscos

- **Colisão de chaves em `body`:** mitigado pela precedência de D-03; teste dedicado.
- **Vazamento em `unhandled`:** `detail` vem de `toJSON().message`; extensões e `data` omitidos. `type`/`instance` são mantidos por serem escolhidos pelo desenvolvedor — risco residual se alguém interpolar dados internos em `instance`; documentar no JSDoc.
- **Marca perdida:** erros reembrulhados por `new HTTPError(val)` (`src/response.ts:148`) só ocorrem para não-`HTTPError`; para `HTTPError` a instância é preservada. Se um hook lançar `new HTTPError(problemErr)`, a marca se perde (por design, “substitui”); coberto pelo teste de `onError`.
- **Regressão do formato comum:** a ramificação em `errorResponse` é aditiva (`marca ? … : caminho atual`); suíte `test/errors.test.ts` e demais cobrem.
- **`isolatedDeclarations`:** `problem` e `ProblemInput` precisam de anotações explícitas (já previstas na assinatura); `getProblemMark` deve ter retorno anotado.
- **API pública / tabela de frases:** nova exportação altera o snapshot (ajuste previsto); tabela de status incompleta gera `title` ausente, o que é válido pela RFC. Confirmar que `pnpm lint` (oxfmt) aceita a formatação da tabela.
- **Colisão de chave `"~problem"` entre cópias do h3 (duplicadas):** por ser string (não símbolo local), funciona entre instâncias, igual ao padrão de `HTTPError.isError`.
- **Docs:** se existir pasta de documentação de erros (não verificada nesta etapa), considerar uma nota curta; fora do escopo da spec.
