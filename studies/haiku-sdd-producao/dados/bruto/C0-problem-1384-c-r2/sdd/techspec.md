# Especificação técnica — `problem()` (RFC 9457)

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C) e `sdd/prd.md` (RF-01 a RF-08).
Escopo: um utilitário explícito `problem(input)` que devolve um `HTTPError` marcado; só a serialização desse erro muda. Nenhum código do projeto foi alterado por este documento.

## 1. Contexto no código atual

- A serialização de erros é centralizada em `errorResponse` (`src/response.ts:358-380`): mescla `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`) com `error.headers`, depois com `errHeaders`, e serializa `{ ...error.toJSON(), stack }`.
- `errorResponse` é chamada num único ponto, `src/response.ts:173`, dentro de `prepareResponse` (`src/response.ts:146-174`). Esse ramo recebe um `HTTPError` real ou cria um novo com `new HTTPError(val)` e `unhandled = true` (`src/response.ts:147-155`).
- `onError` roda antes da serialização e pode devolver outro valor (`src/response.ts:159-166`); o erro original segue como `val` se ele devolver `undefined`.
- `HTTPError` (`src/error.ts:74`) guarda `status`, `statusText` (sanitizado), `headers`, `data`, `body`, `unhandled` (`src/error.ts:199-209`). Calcula uma `message` padrão quando não há mensagem explícita (`src/error.ts:187-193`: cai em `statusText` ou em `"HTTPError <status> <statusText>"`). O construtor guarda a entrada em `cause` (`src/error.ts:196-197`).
- `HTTPError.isError` testa `name === "HTTPError"` e `status > 99` (`src/error.ts:129-133`), então erros de outras cópias do módulo contam como `HTTPError`.
- `toJSON()` (`src/error.ts:226-236`) mascara `message`, `data` e `body` quando `unhandled`. O JSON-RPC depende dessa máscara (`src/utils/json-rpc.ts:483`).
- O tipo de entrada é `ErrorInput<DataT>` (`src/error.ts:6-26`), sobre `ErrorBody` (`src/error.ts:30-69`).
- Exportações públicas de erro: `src/index.ts:72`. Não existe tabela de reason phrases no `src`; `sanitizeStatusMessage` está em `src/utils/sanitize.ts:9`.
- O snapshot de exportações está em `test/unit/package.test.ts:4-113`. `proxy` fica na linha 105, logo após `parseCookies` (linha 104).

## 2. Decisões de arquitetura

### D-01 — Marca interna `~problem` no `HTTPError` retornado

`problem()` cria o erro com `new HTTPError(...)` e define, com `Object.defineProperty`, a propriedade não enumerável `~problem` com `{ type, instance, detail }`. `detail` é a `message` explícita recebida, capturada antes do construtor.

- **Alternativas:**
  - (a) subclasse `ProblemError extends HTTPError`;
  - (b) `WeakSet`/`WeakMap` de módulo;
  - (c) campo público novo em `HTTPError`;
  - (d) símbolo `Symbol.for`.
- **Escolha:** propriedade `~problem`, como o PRD §4 e a convenção `~` do `AGENTS.md` indicam.
  - Uma subclasse exigiria sobrescrever `name` para manter `isError`, e `instanceof` falharia entre cópias do módulo.
  - `WeakMap` não sobrevive a duas cópias do h3 no mesmo processo.
  - O campo público criaria um nome público novo, proibido pelo pedido.
  - O símbolo não traz ganho: a propriedade só existe em instâncias de `Error` criadas por código, e `JSON.parse` não produz `Error`.
- A marca também resolve a ausência de mensagem explícita: o construtor sempre preenche `message` (`src/error.ts:187-193`), então só a marca sabe se havia `detail` (RF-03).
- `src/error.ts` e o `toJSON()` não mudam (RF-07).

### D-02 — Ponto de decisão em `errorResponse`, com o formato isolado em módulo interno

`errorResponse` (`src/response.ts:358`) passa a ler `error["~problem"]`. Se presente, usa `problemBody(error, debug)` e `problemHeaders`; senão, o caminho atual, byte a byte igual. A montagem do corpo fica em `src/utils/internal/problem.ts`, que também exporta o tipo da marca. `src/response.ts` só ganha a bifurcação.

- **Alternativas:**
  - (a) alterar `HTTPError.toJSON()`;
  - (b) escolher o formato em `prepareResponse`;
  - (c) devolver um `Response` pronto pelo próprio `problem()`.
- **Escolha:** bifurcar em `errorResponse`.
  - (a) mudaria o contrato de `toJSON`, que RF-07 e o JSON-RPC (`src/utils/json-rpc.ts:483`) exigem estável.
  - (c) devolveria `Response` em vez de `HTTPError`, contra RF-01, e pularia `onError` e `errHeaders`.
  - `errorResponse` já é o ponto único de saída (`src/response.ts:173`) e mantém `onError`, `errHeaders` e `debug` funcionando sem duplicação.

### D-03 — `content-type: application/problem+json;charset=UTF-8` via headers congelados

Uma constante `problemHeaders` (`FrozenHeaders`, como `jsonHeaders` em `src/response.ts:270`) com `content-type: application/problem+json;charset=UTF-8`. A mescla segue a ordem atual: `error.headers` sobrescreve o padrão, depois `errHeaders` (`src/response.ts:359-364`).

- **Alternativa:** reaproveitar `jsonHeaders` e trocar o tipo depois. Rejeitada: obriga a copiar e mutar sempre.
- **Escolha:** constante irmã de `jsonHeaders`. `FrozenHeaders` e `mergeHeaders` já existem no arquivo (`src/response.ts:243-264`) e são reaproveitados.

### D-04 — Forma do corpo e precedência dos membros padrão

O corpo é montado nesta ordem:

1. `type` (valor informado ou `"about:blank"`);
2. `title`;
3. `status`;
4. `detail` (só se houver mensagem explícita);
5. `instance` (só se informado);
6. `data` (se definido);
7. extensões de `body`;
8. `stack` (só em `debug`, como hoje).

As chaves `type`, `title`, `status`, `detail`, `instance` e `data` vindas de `body` são ignoradas: o membro padrão sempre vence (RF-05). O caso `data` com `body.data` é resolvido a favor de `data` quando `data !== undefined`; se `data` é `undefined`, `body.data` passa como extensão comum.

- **Alternativa:** `{...body, ...padrão}` por spread. Rejeitada: a ordem das chaves no JSON ficaria com as extensões na frente, pior para leitura e para asserções estáveis.
- **Escolha:** montar o objeto explicitamente e copiar as extensões ignorando as chaves reservadas. O custo é um laço pequeno, só no caminho de erro.

### D-05 — `title` por tabela interna de reason phrases

Ordem de resolução do `title`: `error.statusText` (já sanitizado em `src/error.ts:180-185`), depois a tabela interna `src/utils/internal/status-text.ts` (mapa `status → texto` com os códigos IANA comuns), depois omitido se o código não estiver na tabela.

- **Alternativas:**
  - (a) `node:http` `STATUS_CODES`, descartada: o h3 é multi-runtime (Workers, browsers) e prioriza web standards;
  - (b) dependência nova, proibida pelo PRD §3;
  - (c) `Response.statusText` do runtime, que vem vazio em `new Response`.
- **Escolha:** tabela própria e pequena, sem dependência, com retorno `undefined` para códigos desconhecidos em vez de inventar um texto.

### D-06 — Erros `unhandled`: ocultar `detail`, `data` e extensões

Com `error.unhandled`, o corpo traz só `type`, `title`, `status` e `instance`; omite `detail`, `data` e extensões. `stack` só em `debug`. O `content-type` continua `application/problem+json`.

- **Alternativa:** reaproveitar `toJSON()` e mapear os campos. Rejeitada: acopla o formato novo ao mascaramento antigo (que expõe a string `"HTTPError"` como `message`).
- **Escolha:** a regra fica explícita em `problemBody`, espelhando `toJSON()` (`src/error.ts:227-235`) mas sem emitir `detail`.
- `type` e `instance` são escolhas do autor do handler (não vêm da entrada do cliente); manter `instance` não vaza dado interno do h3. Ver risco R-04.

### D-07 — Assinatura pública e arquivo novo `src/utils/problem.ts`

`problem()` e `ProblemInput` ficam em `src/utils/problem.ts` (curto, < 200 LoC, import direto, sem barrel) e são exportados em `src/index.ts` ao lado de `HTTPError` (`src/index.ts:72`). A construção usa `new HTTPError({ ...input })`; `type` e `instance` ficam no objeto guardado em `cause`, o que é inofensivo, pois `cause` nunca é serializado.

- **Alternativa:** pôr `problem()` em `src/error.ts`. Rejeitada: engorda o arquivo da classe e acopla `error.ts` ao formato.
- **Escolha:** módulo próprio. A marca fica definida apenas por `problem()`, e o módulo interno `src/utils/internal/problem.ts` define o tipo `ProblemMark` e a chave `"~problem"`, usados por `response.ts` e `problem.ts`.

### D-08 — Sem negociação, sem flag global

Nenhuma mudança em `H3Config` (`src/types/h3.ts`), em `Accept` ou em erros gerados pelo h3 (404 padrão em `src/response.ts:139-144`, validação, erros internos). É decisão do PRD §3, registrada aqui para evitar escopo extra.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/problem.ts` (novo) | `problem()` e `ProblemInput`. |
| `src/utils/internal/problem.ts` (novo) | `ProblemMark`, `kProblem = "~problem"`, `problemBody()`, `problemHeaders`. |
| `src/utils/internal/status-text.ts` (novo) | Tabela de reason phrases e `getStatusText(status)`. |
| `src/response.ts:358-380` | `errorResponse` bifurca pela marca; `src/response.ts:173` (chamada) não muda. |
| `src/index.ts:72` | Nova linha de export: `export { problem, type ProblemInput } from "./utils/problem.ts";` (bloco de utilitários, perto dos demais). |
| `test/unit/package.test.ts:104-105` | Inserir `"problem",` entre `"parseCookies"` e `"proxy"` no snapshot (única alteração em teste existente; não perde nada do que ele verifica, só reflete o novo nome público). |
| `test/problem.test.ts` (novo) | Testes de integração (seção 5). |
| `test/unit/types.test-d.ts:35` | Novo `describe` para `problem`/`ProblemInput`. |

Não mudam: `src/error.ts` (classe, `toJSON`, `isError`), `src/_deprecated.ts`, `src/utils/json-rpc.ts`, `h3/rules`, entradas `src/_entries/*` (verificar na implementação que reexportam `index.ts` por completo; o snapshot lê `src/_entries/generic.ts`).

## 4. Contratos e assinaturas

```ts
// src/utils/problem.ts
import type { ErrorInput } from "../error.ts";
import { HTTPError } from "../error.ts";

export interface ProblemInput<DataT = unknown> extends ErrorInput<DataT> {
  /** URI de referência que identifica o tipo do problema (RFC 9457 §3.1.1). Padrão: `"about:blank"`. */
  type?: string;
  /** URI de referência que identifica esta ocorrência (RFC 9457 §3.1.5). */
  instance?: string;
}

export function problem<DataT = unknown>(input: ProblemInput<DataT>): HTTPError<DataT>;
```

```ts
// src/utils/internal/problem.ts
export const kProblem = "~problem";

export interface ProblemMark {
  type?: string;
  instance?: string;
  /** `message` explícita; `undefined` quando o erro só tem a mensagem padrão do `HTTPError`. */
  detail?: string;
}

export const problemHeaders: Headers; // FrozenHeaders, application/problem+json;charset=UTF-8
export function problemBody(error: HTTPError, mark: ProblemMark, debug?: boolean): Record<string, unknown>;
```

Corpo para o exemplo do RF-03:
`{ "type": "https://ex.com/erros/nao-encontrado", "title": "Not Found", "status": 404, "detail": "Pedido não encontrado", "instance": "/pedidos/42" }`.

Regras:
- `status` vem de `error.status` (já sanitizado, `src/error.ts:172-178`); sem status, o padrão do `HTTPError` é 500.
- `detail` = `input.message` quando for string não vazia; mensagens vindas de `statusText`/`cause` (`src/error.ts:187-193`) não contam como explícitas.
- `type`/`instance` são strings opacas, sem validação (PRD §4).
- Todos os tipos exportados levam anotação explícita de retorno (`isolatedDeclarations`).

## 5. Estratégia de testes

Novo `test/problem.test.ts` com `describeMatrix` (web e node), no padrão de `test/errors.test.ts:1-9`:

1. **RF-01:** `problem({ status: 404 })` é `HTTPError`, `status === 404`, `HTTPError.isError` verdadeiro.
2. **RF-02:** entrada completa compila e o erro preserva `status`, `message`, `data`, `headers`.
3. **RF-03:** corpo exato do exemplo; sem `type` vira `about:blank`; `statusText` customizado vira `title`; código fora da tabela omite `title`; sem `message` omite `detail`; sem `instance` omite `instance`.
4. **RF-04:** `content-type` começa com `application/problem+json`; `x-id` presente; header customizado `content-type` sobrescreve o padrão.
5. **RF-05:** extensões no nível raiz, `data` sob `data`, `body: { status: 1, type: "x" }` não sobrescreve `status`/`type`.
6. **RF-06:** `unhandled: true` sem `debug`: sem `"segredo"`, `data`, `stack`; `content-type` problem+json; com `debug: true` aparece `stack`.
7. **RF-07:** `new HTTPError(...)`, `HTTPError.status(...)`, 404 padrão e erro desconhecido continuam `application/json` com o corpo antigo (comparação estrita das chaves; sem `type`/`title`/`detail`).
8. **Caminhos de propagação:** `throw` direto; throw em middleware; com `onError` que devolve `undefined` (formato preservado); `onError` que devolve outro `HTTPError` comum (formato JSON antigo, documentado); `throw` assíncrono; `errHeaders` mesclados; requisição `HEAD` (sem corpo).
9. **Erro de outra cópia do módulo:** `runInNewContext` como em `test/errors.test.ts:2`, para confirmar que a marca `~problem` sobrevive ao `isError`.

Testes de tipos em `test/unit/types.test-d.ts`: `ProblemInput` aceita `type`/`instance` strings e rejeita número; `problem(...)` retorna `HTTPError<DataT>` com `data` inferido.

Teste unitário de `getStatusText`/`problemBody` em `test/unit/problem.test.ts`, sem servidor, para a tabela e a precedência.

Ajuste do snapshot em `test/unit/package.test.ts` (seção 3). Validação final: `pnpm vitest run test/problem.test.ts test/unit/`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test`. Seguir o fluxo do `AGENTS.md`: escrever os testes, vê-los falhar, implementar, vê-los passar.

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Regressão no formato atual de erros. | A bifurcação só ativa com `~problem`; testes do item 7 e a suíte existente (`test/errors.test.ts`, `test/status.test.ts`) devem passar sem edição. |
| R-02 | A marca se perde quando o erro é reconstruído (`new HTTPError(val)` para erros que não são `HTTPError`, `src/response.ts:148`) ou quando `onError` devolve outro erro. | `problem()` devolve um `HTTPError`, que atravessa `prepareResponse` intacto. Limitação documentada no JSDoc: erros embrulhados em `cause` por terceiros viram JSON comum. |
| R-03 | Colisão entre `body`/`data` e membros padrão. | D-04: membros padrão vencem; teste do item 5. |
| R-04 | Vazamento em `unhandled`. | D-06 e teste do item 6. `instance` e `type` continuam visíveis por serem definidos pelo autor; se o autor colocar dado sensível neles, a responsabilidade é dele (documentar no JSDoc). |
| R-05 | `statusText` com caracteres restritos virando `title`. | `error.statusText` já passa por `sanitizeStatusMessage` (`src/error.ts:180`); texto longo ou não ASCII vai em `message`/`detail`. |
| R-06 | `isolatedDeclarations` quebrando o typecheck nos novos exports. | Anotações explícitas (seção 4) e teste em `types.test-d.ts`. |
| R-07 | Snapshot de exportações (`test/unit/package.test.ts`) e `test/dist.test.ts` falharem por novo nome público. | Atualizar o snapshot; `problem` e `ProblemInput` são os únicos nomes novos (tipo não aparece no snapshot de valores). |
| R-08 | Dois `HTTPError` de cópias diferentes do h3 com versões distintas da marca. | A marca é um objeto simples com campos opcionais; leitura tolerante a campos ausentes. |
| R-09 | Tamanho do bundle por causa da tabela de status. | Tabela pequena (~60 entradas) em módulo próprio, só carregado pelo caminho de `errorResponse`; reavaliar com `pnpm build` se o tamanho incomodar. |
