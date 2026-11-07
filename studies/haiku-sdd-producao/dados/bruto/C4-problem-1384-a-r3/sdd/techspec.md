# Especificação técnica — Problem Details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-06).
Todas as referências são `arquivo:linha` conferidas no código atual (branch `master`, commit `5eec953`).

## 1. Visão geral

Com `problemDetails: true` em `H3Config`, o ponto único que renderiza erros (`errorResponse` em `src/response.ts`) passa a montar o corpo no formato RFC 9457 com `Content-Type: application/problem+json`. Com a opção desligada (padrão), o caminho atual é executado sem nenhuma mudança de comportamento. `HTTPError` ganha os campos `type` e `instance`.

Não há novo nome exportado publicamente além da opção de configuração e dos campos de `HTTPError`. O serializador fica em arquivo interno.

Estado atual relevante:

- `errorResponse` recebe só `config.debug` (não o `config` inteiro) em `src/response.ts:173` e monta o corpo com `error.toJSON()` em `src/response.ts:368`.
- `toResponse` recebe o `config` do app em `src/h3.ts:99` e o repassa a `prepareResponse` (`src/response.ts:27`, `src/response.ts:129`).
- `app.config` é lido a cada requisição (`this.config` em `src/h3.ts:44` e `src/h3.ts:99`); em produção ele é congelado após o init (`src/_entries/_common.ts:5`).

## 2. Decisões de arquitetura

### D-01 — Gatilho é uma opção booleana em `H3Config`

- **Escolha:** `problemDetails?: boolean` em `H3Config`, logo após `allowMalformedURL` (`src/types/h3.ts:46`). Não há valor padrão explícito: `undefined` é tratado como desligado.
- **Por quê:** é o mesmo padrão das demais opções do app (`debug`, `silent`, `allowMalformedURL`), é lida de `app.config` e o tipo booleano já dá o erro de tipo pedido em RF-06 para `"sim"`.
- **Alternativas consideradas:**
  - Objeto de opções (`problemDetails: { ... }`): mais flexível, mas abre superfície pública que o contrato proíbe.
  - Ativação por rota, por `Accept` ou por requisição: fora do escopo do PRD.
- **Consequência:** nenhuma mudança em `H3Core` ou `H3`; a leitura acontece no próprio `toResponse`.

### D-02 — Renderização em um único ponto: `errorResponse`

- **Escolha:** trocar o parâmetro `debug` de `errorResponse` por `config` (`src/response.ts:358`) e ramificar ali por `config.problemDetails`. A chamada em `src/response.ts:173` passa `config`.
- **Por quê:** todo erro que chega ao cliente pelo app (throw, return, rejeição, `kNotFound`, número, erro de `onError` que volta para `prepareResponse`) passa por esse ponto, então o formato fica consistente sem duplicar lógica. Já há `config` disponível em `prepareResponse` (`src/response.ts:129`).
- **Alternativas consideradas:**
  - Envolver `onError` em um plugin: não cobre erros sem `onError` configurado nem o caminho `kNotFound`.
  - Método público `HTTPError#toProblemJSON()`: criaria um novo nome público, o que o contrato proíbe.
- **Consequência:** o caminho padrão (`error.toJSON()` + `stack`) fica no mesmo `if`/`else`, sem alterar a ordem de merge de headers (`src/response.ts:359-364`).

### D-03 — Serializador em arquivo interno

- **Escolha:** nova função `toProblemDetails(error: HTTPError)` em `src/utils/internal/problem-details.ts` (pasta já existente, ver AGENTS.md, "Internal helpers"). Não exportada em `src/index.ts`.
- **Por quê:** mantém arquivos curtos (AGENTS.md, < 200 linhas) e não cria nome público.
- **Alternativas consideradas:** colocar a função em `src/error.ts` (arquivo com 237 linhas, ao lado de `toJSON`): aceitável, mas misturaria a regra da RFC com a classe; rejeitado pelo mesmo motivo de tamanho e coesão.
- **Regras do serializador** (cumprem RF-03 e RF-05):
  1. `type`: `error.type` quando definido, senão `"about:blank"`. Para `unhandled`, sempre `"about:blank"`.
  2. `status`: `error.status`, sempre.
  3. `title`: `error.statusText`, só se definido e não `unhandled`.
  4. `detail`: `error.message`, só se não vazio e não `unhandled`.
  5. `instance`: `error.instance`, só se definido e não `unhandled`.
  6. `data`: se for objeto simples (não array, não `null`) e o erro não for `unhandled`, suas chaves são espalhadas no corpo. Chaves com nome `type`, `title`, `status`, `detail` ou `instance` são descartadas, para que os membros padrão tenham precedência sempre (mesmo quando o membro padrão está ausente).
  7. `stack`, `body` (propriedades de topo de `HTTPError.body`) e `unhandled` não são emitidos.
- **Alternativa de `data` rejeitada:** aninhar `data` em um membro próprio. O PRD pede membros de topo.

### D-04 — `type` e `instance` em `ErrorInput` e `HTTPError`, sem tocar em `ErrorBody`

- **Escolha:**
  - `ErrorInput` (`src/error.ts:6`) ganha `type?: string` e `instance?: string`.
  - `HTTPError` (`src/error.ts:74`) ganha `readonly type: string | undefined` e `readonly instance: string | undefined`, atribuídos no construtor com checagem `typeof === "string"`.
  - `ErrorBody` (`src/error.ts:30`) não muda. Assim `toJSON` (`src/error.ts:226`) e o corpo padrão (RF-04) continuam idênticos.
- **Por quê:** `ErrorInput` herda de `Partial<ErrorBody>`, então adicionar os campos só ali já tipa `new HTTPError({ ... type, instance })`. Mexer em `ErrorBody` mudaria o tipo retornado por `toJSON` sem mudar o runtime.
- **Leitura só de `details` direto, não de `cause`:** `headers` é lido de `cause` (`src/error.ts:202`), mas `type` vindo de um `cause` arbitrário pode ser um código de erro de outra biblioteca (ex.: `type: "entity.too.large"`). Por isso só lemos do próprio objeto de entrada.
- **Alternativa rejeitada:** ler `type` de `cause` como `headers`. Risco de vazar identificadores internos.

### D-05 — Erros `unhandled` no formato problem: só status

- **Escolha:** para `error.unhandled`, o corpo tem apenas `type: "about:blank"` e `status`. `title`, `detail`, `instance` e `data` são omitidos (RF-05).
- **Por quê:** `unhandled` é um erro de código de aplicação (ou de `new HTTPError({ cause, unhandled: true })` em `src/adapters.ts:122`, `src/adapters.ts:143-152`). Nesses casos `statusText` e `message` podem vir de um `cause` arbitrário. O `toJSON` atual já mascara `message` e `data` (`src/error.ts:232-233`); a versão problem também mascara `title`.
- **Alternativa:** `title: "Internal Server Error"` fixo. É mais informativo e válido pela RFC, mas diverge da regra "title = statusText" do PRD (RF-03). Fica como item em aberto (seção 7).

### D-06 — `Content-Type` fixo em `application/problem+json`

- **Escolha:** montar os headers como hoje (`error.headers` e `errHeaders`), depois forçar `content-type: application/problem+json` (sem `charset`, conforme a RFC 9457 e o media type registrado).
- **Por quê:** RF-03 exige o valor exato. A chamada a `headers.set` depois dos merges garante que nem `error.headers` do usuário o sobrescreva. `errHeaders` continua sendo mesclado antes, então `set-cookie` acumula como hoje.
- **Alternativa:** deixar `error.headers` do usuário vencer. Mais flexível, mas quebra o contrato de RF-03 em silêncio. Fica em aberto (seção 7).

### D-07 — Sem `stack` no formato problem

- **Escolha:** no modo problem, o corpo não inclui `stack`, mesmo com `debug: true`.
- **Por quê:** o PRD exclui "extensões de membros além de `type`, `instance` e os campos de `data`" (seção "Fora de escopo"). `stack` é uma extensão.
- **Trade-off:** quem usa `debug` perde o stack no corpo. Continua disponível no `console.error` de erros não tratados (`src/response.ts:156-158`). Fica em aberto (seção 7).

### D-08 — Passar `config` nos dois pontos que renderizam sem ele

- **Escolha:**
  - `src/utils/middleware.ts:26`: `toResponse(rawBody, event)` vira `toResponse(rawBody, event, event.app?.config)`.
  - `src/rules/cache.ts:312`: idem, se o valor puder ser um erro retornado (ver risco R-04).
- **Por quê:** sem isso, um `HTTPError` retornado (não lançado) dentro de um `onResponse` renderiza no formato padrão, mesmo com a opção ligada. `event.app?.config` já é usado assim em `src/adapters.ts:116`. O tipo `H3CoreConfig` é atribuível a `H3Config`, pois `plugins` é opcional.
- **Não mudar:** `src/handler.ts:122,124` (`handler.fetch` de handler avulso, sem app). Não há `config` a usar, e o comportamento continua o de hoje.

### D-09 — Config lida em tempo de requisição, sem cache

- **Escolha:** nenhuma mudança. `toResponse` recebe `this.config` (`src/h3.ts:99`) a cada chamada.
- **Por quê:** o PRD diz "lida na criação". Na prática, o valor é lido na requisição e o `app.config` é congelado depois do init (`src/_entries/_common.ts:5`), então o efeito é o mesmo. Não há custo extra para checar a opção.

### D-10 — Sub-app montado com `mount(app)` usa a config do pai

- **Escolha:** nenhuma mudança, documentar.
- **Por quê:** `mount` com um `H3` copia as rotas (`src/h3.ts:213-218`) e o erro é renderizado pelo `toResponse` do app pai (`src/h3.ts:99`). Com `mount(fetchable)` (`src/h3.ts:220-225`) o sub-app é chamado via `fetch` e usa a própria config. Para o caso de `mount(app)`, a opção vale a partir do app que recebe a requisição. Ver R-02.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/types/h3.ts` | Adicionar `problemDetails?: boolean` em `H3Config`, após `allowMalformedURL?: boolean` (`src/types/h3.ts:46`), com TSDoc. |
| `src/error.ts` | Em `ErrorInput` (`src/error.ts:6-26`): `type?: string`, `instance?: string`. Em `HTTPError`: campos `readonly type` e `readonly instance` (perto de `src/error.ts:107-112`), atribuídos no construtor após `src/error.ts:209`. `toJSON` (`src/error.ts:226-236`) não muda. |
| `src/utils/internal/problem-details.ts` | **Novo.** `toProblemDetails(error)` e tipo interno `ProblemDetails`. |
| `src/response.ts` | `errorResponse` (`src/response.ts:358-380`): assinatura passa a receber `config: H3Config`; ramo `config.problemDetails`; `stack` só no caminho padrão. Chamada em `src/response.ts:173` passa `config`. |
| `src/utils/middleware.ts` | `src/utils/middleware.ts:26`: passar `event.app?.config`. |
| `src/rules/cache.ts` | `src/rules/cache.ts:312`: passar `event.app?.config`, se confirmado que o valor pode ser erro (R-04). |
| `test/problem-details.test.ts` | **Novo.** Testes de integração em `describeMatrix` (seção 5). |
| `test/unit/problem-details.test.ts` | **Novo.** Testes unitários de `toProblemDetails` e de `HTTPError.type`/`instance`. |
| `test/unit/types.test-d.ts` | Adicionar `// @ts-expect-error` para `new H3({ problemDetails: "sim" })` (RF-06). |

Não alterar `src/index.ts`: nenhum símbolo novo é exportado. Não alterar `AGENTS.md` (fora do escopo, conforme o PRD).

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — dentro de H3Config
/**
 * When enabled, error responses use the RFC 9457 "problem details" format
 * (`application/problem+json`) instead of H3's default JSON body.
 */
problemDetails?: boolean;
```

```ts
// src/error.ts
export interface ErrorInput<DataT = unknown> extends Partial<ErrorBody<DataT>> {
  // ...campos existentes...

  /** RFC 9457 `type` URI. Defaults to `about:blank` in problem responses. */
  type?: string;

  /** RFC 9457 `instance` URI reference, identifying this occurrence of the problem. */
  instance?: string;
}

export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  /** RFC 9457 `type`. Only emitted when `problemDetails` is enabled. */
  readonly type: string | undefined;

  /** RFC 9457 `instance`. Only emitted when `problemDetails` is enabled. */
  readonly instance: string | undefined;

  // construtor (src/error.ts:162): após this.body = ... (src/error.ts:209)
  //   this.type = typeof (details as ErrorInput)?.type === "string" ? (details as ErrorInput).type : undefined;
  //   this.instance = typeof (details as ErrorInput)?.instance === "string" ? (details as ErrorInput).instance : undefined;
}
```

```ts
// src/utils/internal/problem-details.ts
import type { HTTPError } from "../../error.ts";

/** Members of an RFC 9457 problem details object emitted by H3. */
export interface ProblemDetails {
  type: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  [member: string]: unknown;
}

/**
 * Build the RFC 9457 body for an error. The standard members take precedence over `data`.
 * Unhandled errors expose only `type` and `status`.
 */
export function toProblemDetails(error: HTTPError): ProblemDetails;
```

```ts
// src/response.ts
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
// chamada (src/response.ts:173):
//   val = errorResponse(error, config, errHeaders);
```

Corpo do ramo problem, dentro de `errorResponse`:

```ts
if (config.problemDetails) {
  headers.set("content-type", "application/problem+json");
  return new FastResponse(
    JSON.stringify(toProblemDetails(error), undefined, config.debug ? 2 : undefined),
    { status: error.status, statusText: error.statusText, headers },
  );
}
```

O ramo padrão (`src/response.ts:365-379`) permanece como está, sem alteração de texto.

Ordem em `toProblemDetails` (para a saída bater com o exemplo de RF-03): as chaves dos membros padrão são criadas na ordem `type`, `title`, `status`, `detail`, `instance`. As chaves de `data` vêm antes, então a saída é `{ ...dataSemMembrosPadrao, ...membros }`.

Exemplo de saída esperada (RF-03):

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Usuário não existe", "instance": "/users/42" }
```

## 5. Estratégia de testes

Ordem conforme o "Bug Fix Workflow" de AGENTS.md: escrever os testes de RF-03 e RF-05 antes da implementação e confirmar que falham.

**Unitários (`test/unit/problem-details.test.ts`)**

- `new HTTPError({ status: 404, type, instance })` expõe `error.type` e `error.instance` (RF-02).
- `new HTTPError({ status: 404 })` deixa ambos `undefined` e não lança (RF-02).
- `type` não-string é ignorado (`typeof`).
- `toProblemDetails` com erro completo: membros e ordem (RF-03).
- `type` ausente vira `"about:blank"`.
- `data` objeto: chaves espalhadas; chaves `type`/`title`/`status`/`detail`/`instance` de `data` descartadas, inclusive quando o membro padrão está ausente.
- `data` não-objeto (string, array, `null`) não é espalhado.
- Erro `unhandled`: só `type` e `status`, mesmo com `statusText`, `message`, `data` e `instance` definidos.

**Integração (`test/problem-details.test.ts`, `describeMatrix`)**

- Padrão sem a opção: `app.config.problemDetails` é `undefined` (RF-01) e a resposta de `HTTPError({ status: 400, message: "inválido" })` tem o mesmo corpo e `Content-Type: application/json;charset=UTF-8` de antes, sem `type` nem `instance` (RF-04).
- Opção ligada (`t.app.config.problemDetails = true`, mesmo padrão de `test/errors.test.ts:14`): exemplo de RF-03 com status `404`, `Content-Type: application/problem+json` e corpo exato.
- Sem `type` no erro: `type === "about:blank"` (RF-03).
- `data` espalhado no corpo e membro padrão vence em colisão.
- Erro `new Error("segredo do banco")` com a opção ligada: status `500`, `application/problem+json`, `status: 500`, string secreta ausente do corpo (RF-05). Verificar também que o corpo não tem `detail`.
- Erro não-`Error` lançado (`throw { status: 404, type: "x" }`): renderiza 500 sem `type` vindo do objeto (cobre o caso do `status` não ser honrado, já coberto em `test/errors.test.ts:266`, agora no formato problem).
- `new Error` com propriedade `type` (ex.: `type: "entity.too.large"`): `type` do corpo é `about:blank`.
- HEAD: status e `Content-Type` problem, sem corpo.
- Handler retorna `HTTPError` (não lança): formato problem.
- Handler retorna `new Response(..., { status: 404 })` ou `HTTPResponse`: não é reformatado (risco do PRD).
- `onError` retorna `Response` customizada: não é reformatada.
- `onError` sem retorno: o erro segue para o render com o formato problem.
- Ligada no app, rota dentro de `use(onResponse(...))` retornando `HTTPError`: formato problem (D-08).
- Ligada, JSON circular em `data`: 500 no formato problem (equivalente ao teste existente em `test/errors.test.ts:388`).
- `debug: true` com a opção ligada: corpo não tem `stack`.
- `mount(subApp)` via `fetchable`: usa a config do sub-app (D-10). Um teste de documentação do comportamento de `mount(app)` com a config do pai.

**Tipos (`test/unit/types.test-d.ts`)**

- `// @ts-expect-error` em `new H3({ problemDetails: "sim" })` (RF-06). Sem o `@ts-expect-error` válido, `pnpm typecheck` falha.

**Regressão**

- `pnpm vitest run test/errors.test.ts test/mount.test.ts test/app.test.ts` sem alterar os testes existentes. Só ajustar se algum teste depender de forma que a mudança altera, mantendo o que ele verifica (PRD, RF-04).
- `pnpm vitest run` completo.
- `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck` (`tsc --noEmit`, inclui `src` e `test`).
- `pnpm build` para confirmar que o novo arquivo interno entra no bundle sem erro. Não é exigido pelo PRD, mas cobre `isolatedDeclarations`.

Cobertura: `vitest.config.mjs` mede cobertura só de `src/**/*.ts`; o novo arquivo interno tem que ficar coberto pelos testes unitários.

## 6. Riscos

- **R-01 — Vazamento de detalhes internos.** Mitigado por D-05 (unhandled sem `title`, `detail`, `data`, `instance`) e pelo teste de `new Error("segredo do banco")`. Também por D-04 (`type` só do próprio objeto de entrada, e mascarado para `unhandled`).
- **R-02 — Sub-app via `mount(app)` herda a config do pai** (D-10). Documentar no TSDoc de `problemDetails`.
- **R-03 — Perda de `stack` e `body` no modo problem** (D-07). Quem depende deles no corpo não os terá nesse modo. Quem quer o `body` customizado precisa usar `data`.
- **R-04 — Cache (`src/rules/cache.ts:312`).** Não confirmei se um valor de erro pode chegar a `toResponse` nesse caminho. Antes de mudar, verificar; se não puder, deixar como está e registrar.
- **R-05 — Mudança de contrato para quem liga a opção.** `Content-Type` e forma do corpo mudam. Por isso o padrão é desligado (PRD).
- **R-06 — Colisão de `data` com membros padrão.** Mitigado por D-03 (regra 6).
- **R-07 — `statusText` no status line.** `error.statusText` continua indo para a linha de status (`src/response.ts:375-377`), inclusive para `unhandled`. Isso já acontece hoje e não está no corpo. Fora do escopo, mas vale conhecer.
- **R-08 — Respostas construídas pelo usuário** (`Response`, `HTTPResponse`) não passam pelo formato de erro. Coberto por teste (seção 5).
- **R-09 — Circular/erro no `JSON.stringify`.** Continua caindo no `try` de `toResponse` (`src/response.ts:27-29`) e vira 500, agora no formato problem.

## 7. Itens em aberto (para confirmação, com a escolha adotada nesta spec)

1. **`title` para erros `unhandled`** (D-05): adotado omitir. Alternativa: `"Internal Server Error"`.
2. **`Content-Type` vs. `error.headers` do usuário** (D-06): adotado o media type fixo, sempre. Alternativa: deixar `headers` do usuário vencer.
3. **`stack` no modo debug** (D-07): adotado omitir, por seguir o PRD. Alternativa: incluir `stack` só com `debug: true`, como hoje.
4. **`body` (propriedades de topo)** (R-03): adotado não emitir, por seguir o PRD. Alternativa: espalhar também, sem sobrescrever membros padrão.
5. **Passar `config` em `onResponse`** (D-08): adotado, por ser necessário para o caso de `HTTPError` retornado. Pode ser tratado como correção separada.
