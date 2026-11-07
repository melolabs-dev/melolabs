# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01…RF-09, P1…P5, R1…R6).
Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `e1406d2`).

## 1. Estado atual (resumo)

- Todo erro passa por `prepareResponse` (`src/response.ts:129`). Para `Error`, o ramo `src/response.ts:146-174` normaliza para `HTTPError`, marca `unhandled`, chama `onError` (`:159-165`) e, sem `onError` (ou na segunda passada `nested`), renderiza com `errorResponse(error, config.debug, errHeaders)` (`src/response.ts:173`).
- `errorResponse` (`src/response.ts:358-380`) monta headers a partir de `jsonHeaders` (`:270-272`, `application/json;charset=UTF-8`), mescla `error.headers` e `errHeaders` com `mergeHeaders` (`:243`) e serializa `{...error.toJSON(), stack}` com indentação 2 se `debug`.
- 404 de rota (`kNotFound`, `src/response.ts:139-144`), URL malformada (`src/h3.ts:80-84`), body limit, validação etc. viram `HTTPError` e caem no mesmo caminho (premissa P2 confirmada).
- `config` chega a `toResponse` por `src/h3.ts:99` (`this.config`, `H3CoreConfig = Omit<H3Config,"plugins">` em `src/types/h3.ts:55`). Chamadas sem config: `src/handler.ts:122` e `:124` (`.fetch` de handler avulso), `src/utils/middleware.ts:26`, `src/rules/cache.ts:314`.
- `HTTPError` (`src/error.ts:74`) lê campos do `details` no construtor (`:162-210`); `toJSON` (`:226-236`) é usado em `errorResponse` e, por menção, em `src/utils/json-rpc.ts:483` (comentário; o código de `:484-491` não chama `toJSON`).
- `ErrorInput` (`src/error.ts:6`) estende `Partial<ErrorBody>`; `ErrorBody` (`src/error.ts:30-69`) descreve o corpo legado.

## 2. Decisões de arquitetura

### D-01 — Onde ramificar: dentro de `errorResponse`, recebendo `config`

**Alternativas**

- (a) Ramificar em `prepareResponse` antes de chamar `errorResponse`.
- (b) Criar um segundo renderizador (`problemResponse`) e escolher no ponto da chamada.
- (c) Manter um único `errorResponse` e passar a ele a opção.

**Escolha: (c).** Mudar a assinatura interna para `errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers)` (`src/response.ts:358`) e a única chamada em `src/response.ts:173` para `errorResponse(error, config, errHeaders)`. Justificativa: a lógica de merge de headers (`error.headers` → `errHeaders`), `statusText` e indentação por `debug` é idêntica; duplicá-la (a/b) arriscaria divergência (R4). `errorResponse` não é exportada, logo não cria nome público. Passar `config` evita encadear parâmetros booleanos (`debug`, `problemDetails`, …).

### D-02 — `toJSON()` permanece intacto; o corpo problem details é montado na renderização

**Alternativas**

- (a) Fazer `toJSON()` emitir problem details quando a opção estiver ligada.
- (b) Adicionar parâmetro/método novo em `HTTPError`.
- (c) Montar o corpo em função interna usada só por `errorResponse`.

**Escolha: (c).** `toJSON` (`src/error.ts:226`) não conhece `config` e é contrato de consumidores (P3, RF-09); (a) quebraria o formato legado e (b) criaria nome público proibido pelo contrato. Nova função interna `toProblemBody(error, debug)` em arquivo novo `src/utils/internal/problem.ts` (diretório de helpers internos conforme AGENTS.md; sem barrel, import direto com `.ts`). Ela lê os campos públicos de `HTTPError` (`status`, `statusText`, `message`, `unhandled`, `data`, `body`, `type`, `instance`) — nenhum campo novo além de `type`/`instance`.

### D-03 — `type` e `instance`: campos no `ErrorInput` e na classe, só strings, só do `details` (não do `cause`)

**Alternativas**

- (a) Adicionar `type`/`instance` a `ErrorBody` (herdado por `ErrorInput` e implementado por `HTTPError`).
- (b) Adicionar apenas a `ErrorInput` e a `HTTPError`.
- (c) Herdar de `cause` como já é feito com `status`/`statusText`/`headers`/`unhandled` (`src/error.ts:172-206`).

**Escolha: (b), lidos somente de `details`.** `ErrorBody` documenta o corpo JSON legado (`data`/`body` “under key”); incluir os campos ali sugeriria que aparecem no `toJSON` (contradiz RF-09). Herdar de `cause` (c) é perigoso: `new HTTPError(err)` é usado para embrulhar qualquer `Error` (`src/response.ts:148`) e muitos erros de bibliotecas têm uma propriedade `type` própria (ex.: `"entity.too.large"`), que viraria `type` do problema, vazando detalhe interno e violando P5 (URI). Como `details` de um erro embrulhado é o próprio erro, a leitura direta de `details.type` tem o mesmo problema; por isso a validação `typeof === "string"` (P5) e a regra D-06 (ignorar `type`/`instance` quando `unhandled`).

Mudanças:

- `ErrorInput` (`src/error.ts:6`): `type?: string; instance?: string;` com JSDoc (RFC 9457 §3.1.1 / §3.1.5).
- Campos da classe junto a `src/error.ts:107-112`: `readonly type: string | undefined; readonly instance: string | undefined;`.
- Construtor, junto a `src/error.ts:208-209`: `this.type = typeof d.type === "string" ? d.type : undefined` (idem `instance`), onde `d = details as ErrorInput`.
- `HTTPError.status(...)` (`src/error.ts:144-150`) já repassa `details` por spread: nenhuma mudança de código; o tipo do parâmetro `details` (`ErrorDetails`, que inclui `ErrorInput`) já aceita os campos novos (RF-04).
- Não alterar `toJSON` (`:226`) nem `ErrorBody` (`:30`).

### D-04 — `title`: `statusText` ou mapa mínimo interno; sem dependência nova

**Alternativas**

- (a) `http.STATUS_CODES` do Node.
- (b) Mapa completo IANA.
- (c) Mapa mínimo (códigos 4xx/5xx comuns + 2xx/3xx usados) em `problem.ts`.
- (d) Apenas `statusText`.

**Escolha: (c).** (a) viola o requisito multi-runtime (Workers/browsers); (b) pesa no núcleo (R5); (d) deixaria `title` ausente na maioria dos erros (o `statusText` raramente é informado; o RF-07 exige `title: "Not Found"` para o 404 de rota, que não define `statusText`, `src/response.ts:140-143`). Mapa `Record<number,string>` não exportado, ~25 entradas (400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 507, 508, 511). Status sem entrada e sem `statusText`: `title` é omitido (opcional na RFC, §3.1.3), sem frase inventada. Precedência: `statusText` (se `!unhandled`) → mapa → omitido. O custo de bundle será medido com `pnpm build` (ver §6, R5).

### D-05 — `detail`: omitir quando redundante com `title` ou com a mensagem gerada

**Alternativas**

- (a) Sempre emitir `detail = message`.
- (b) Omitir se `message === title` ou `message === "HTTPError " + status` (mensagem derivada).
- (c) Comparar com o texto exato gerado em `src/error.ts:187-193`.

**Escolha: (b).** O construtor gera `message` a partir de `statusText` ou de `["HTTPError", status, statusText].join(" ")` (`src/error.ts:187-193`); com `statusText` presente a mensagem é o próprio `statusText` (cai em `message === title`), e sem ele é `"HTTPError <status>"`. Comparar contra esses dois valores cobre os casos derivados sem reimplementar a concatenação inteira (c). Resolve R6. Um `message` customizado (ex.: `"Cannot find any route matching [GET] /x"`, RF-07) permanece em `detail`. Nota: o trecho `(details?.cause as ErrorDetails)?.message` (`:190`) significa que mensagem herdada de `cause` também vira `detail` — comportamento aceito para erros tratados; para `unhandled` ver D-06.

### D-06 — Erros `unhandled`: corpo mínimo, sem `detail`, `type`, `instance`, `data`, `body`

**Alternativas**

- (a) Reaproveitar o mascaramento de `toJSON` (`message: "HTTPError"`) e gerar `detail: "HTTPError"`.
- (b) Omitir `detail`, `type`, `instance`, `data`, `body` e usar a frase do status, ignorando `statusText`.

**Escolha: (b).** (a) emitiria um `detail` sem valor. Para `unhandled` (RF-06, R1): `{ title: <mapa[status]>, status }` e, só com `debug`, `stack`. `statusText` é ignorado porque `new HTTPError(val)` herda `statusText`/`statusMessage` de `cause` (`src/error.ts:180-185`) — texto potencialmente interno. `type`/`instance` ignorados porque, em erros embrulhados, vêm do objeto de erro original (D-03). Isso é mais estrito que o `toJSON` legado, que expõe `statusText` (aceitável: é o formato novo e opt-in).

### D-07 — Montagem do corpo e precedência de extensões

Função (interna):

```ts
export function toProblemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Regras, nesta ordem de chaves (legibilidade do JSON):

1. `type` (se string e `!unhandled`), `title`, `status` (= `error.status`), `detail`, `instance` (se `!unhandled`).
2. Extensões, apenas se `!unhandled`: `data` (se definido) e as chaves de `body` **exceto** as reservadas `type`, `title`, `status`, `detail`, `instance` (filtradas, não sobrescrevem — RF-05, R3). A chave `data` do próprio `body` também não pode sobrescrever `error.data`: `data` é atribuída depois do espalhamento de `body`.
3. `stack` por último, só com `debug` e `error.stack`, como array de linhas (mesmo formato de `src/response.ts:369`); sem `debug`, a chave não é emitida.

**Alternativas**: (a) `{...body, ...padrão}` — sobrescrita correta, mas ordem de chaves ruim e `undefined` residual; (b) construir com filtro (escolhida). `JSON.stringify` descarta `undefined`, atendendo “membros `undefined` não são serializados”. Caveat consciente: a chave `stack` vinda de `body` é sobrescrita pela lógica de `stack` (igual ao legado em `src/response.ts:369`, que também a sobrescreve com `undefined`).

### D-08 — Content-Type e headers

**Alternativas**

- (a) Gravar `content-type` depois do merge (sempre vence).
- (b) Trocar a base do merge: `problemHeaders` no lugar de `jsonHeaders`, mantendo a ordem `base → error.headers → errHeaders`.

**Escolha: (b).** Nova constante `problemHeaders` (`FrozenHeaders`, ao lado de `jsonHeaders`, `src/response.ts:270`) com `content-type: application/problem+json;charset=UTF-8` (mesmo charset do JSON atual, RF-02). A base é só a de partida: `content-type` explícito em `error.headers` ou `event.res.errHeaders` continua vencendo, como hoje (RF-08, R4); (a) quebraria esse comportamento. `errorResponse` escolhe `base = config.problemDetails ? problemHeaders : jsonHeaders`. `new Headers(frozen)` já é usado em `:361`, portanto a cópia não herda o congelamento.

### D-09 — Precedência do `onError` e `debug`

Sem mudança de fluxo. `onError` roda antes (`src/response.ts:159-165`); se devolve valor, este é re-preparado com `nested=true` e não passa por `errorResponse` do erro original; se devolve `undefined`, `newVal ?? val` reenvia o erro e `errorResponse` renderiza com `nested` (o ramo `:161` é pulado), já com `config`. `debug` continua controlando a indentação (`JSON.stringify(..., debug ? 2 : undefined)`) e o `stack`, em ambos os formatos.

### D-10 — Opção em `H3Config`

Adicionar a `H3Config` (`src/types/h3.ts:28-37`, após `silent`) com JSDoc:

```ts
/**
 * When enabled, error responses use RFC 9457 problem details (`application/problem+json`).
 * Disabled by default.
 */
problemDetails?: boolean;
```

`H3CoreConfig` (`:55`) herda por `Omit`. Leitura via `config.problemDetails` dentro de `errorResponse`, como `debug`/`silent` (`src/response.ts:156,173`). Sem normalização nem default: `undefined`/`false` ⇒ caminho legado inalterado (RF-01).

### D-11 — Fora do caminho de `config`: chamadas a `toResponse` sem config

`src/handler.ts:122,124` (`.fetch` de handler avulso), `src/utils/middleware.ts:26` (`onResponse`) e `src/rules/cache.ts:314` chamam `toResponse(val, event)` sem config (default `{}`), portanto continuam no formato legado — nesses fluxos já hoje `debug`/`silent`/`onError` não são aplicados. **Alternativas**: (a) propagar `event.app?.config` nesses pontos; (b) aceitar e documentar. **Escolha: (b)**, pois o PRD fixa P2 (“basta receber a opção em `errorResponse`”) e “fora de escopo” exclui outros fluxos de resposta; (a) mudaria comportamento de `debug`/`onError` nesses fluxos (risco de regressão). Registrado como risco R-T4.

### D-12 — Documentação

Atualizar `docs/1.guide/900.api/1.h3.md:111-112` (lista de opções, acrescentar `problemDetails`) e adicionar uma subseção curta em `docs/1.guide/1.basics/6.error.md` (campos de `HTTPError` em `:51-59`, incluir `type` e `instance`; nova seção sobre o formato). Documentação não cria nome público.

## 3. Arquivos a alterar

| Arquivo                            | Local                 | Mudança                                                    |
| ---------------------------------- | --------------------- | ---------------------------------------------------------- |
| `src/types/h3.ts`                  | `:28-37`              | `problemDetails?: boolean` + JSDoc (D-10)                  |
| `src/error.ts`                     | `:6-26`               | `type?`/`instance?` em `ErrorInput` (D-03)                 |
| `src/error.ts`                     | `:107-112`            | campos `readonly type`, `readonly instance`                |
| `src/error.ts`                     | `:208-209`            | atribuição validada (`typeof === "string"`)                |
| `src/response.ts`                  | `:173`                | `errorResponse(error, config, errHeaders)`                 |
| `src/response.ts`                  | `:270-272`            | nova constante `problemHeaders`                            |
| `src/response.ts`                  | `:358-380`            | nova assinatura; escolha de base/corpo (D-01, D-07, D-08)  |
| `src/response.ts`                  | `:1-8`                | import de `toProblemBody` de `./utils/internal/problem.ts` |
| `src/utils/internal/problem.ts`    | novo                  | mapa de frases + `toProblemBody` (D-04…D-07)               |
| `test/problem-details.test.ts`     | novo                  | testes (§5)                                                |
| `test/unit/types.test-d.ts`        | existente             | asserts de tipo (§5)                                       |
| `docs/1.guide/900.api/1.h3.md`     | `:111-112`            | documentar opção                                           |
| `docs/1.guide/1.basics/6.error.md` | `:51-59` + nova seção | documentar campos/formato                                  |

Não alterar: `src/index.ts` (nenhum export novo; `HTTPError`, `ErrorInput` já exportados em `:72`), `src/error.ts:226-236` (`toJSON`), `src/utils/json-rpc.ts`, `package.json` (exports), `src/_entries/*`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts — H3Config
problemDetails?: boolean;

// src/error.ts — ErrorInput
type?: string;       // RFC 9457 §3.1.1
instance?: string;   // RFC 9457 §3.1.5

// src/error.ts — HTTPError
readonly type: string | undefined;
readonly instance: string | undefined;

// src/response.ts (interna, não exportada)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;

// src/utils/internal/problem.ts (interna, não reexportada)
export function toProblemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;
```

Formato de saída com `problemDetails: true` (JSON, `content-type: application/problem+json;charset=UTF-8`):

| Situação                                                                               | Corpo                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `HTTPError({status:403,statusText:"Forbidden",message:"Sem permissão",type,instance})` | `{type,title:"Forbidden",status:403,detail:"Sem permissão",instance}`             |
| `HTTPError({status:404})` sem mensagem                                                 | `{title:"Not Found",status:404}` (detail omitido, D-05)                           |
| 404 de rota                                                                            | `{title:"Not Found",status:404,detail:"Cannot find any route matching [GET] /x"}` |
| `422` com `data`/`body:{codigo,status:200}`                                            | `{title:"Unprocessable Entity",status:422,detail:"x",data:{...},codigo:"E42"}`    |
| `throw new Error("segredo")`                                                           | `{title:"Internal Server Error",status:500}` (+`stack` só em `debug`)             |

Compatibilidade: com a opção desligada, `errorResponse` executa exatamente o código atual (mesmo `jsonHeaders`, mesmo `{...error.toJSON(), stack}`); `toJSON` e `ErrorBody` não mudam; `type`/`instance` não aparecem no JSON legado (RF-09/P3).

## 5. Estratégia de testes

Novo `test/problem-details.test.ts`, com `describeMatrix` (web + node, convenção do AGENTS.md). `ctx.app` é criado em `test/_setup.ts:135` com `debug: true`; cada teste liga a opção com `ctx.app.config.problemDetails = true` (o objeto `config` é mutável; `readonly` é só da referência) e, quando exigido, `ctx.app.config.debug = false`. Atenção: `ctx.hooks.onError` (mock em `:128-133`) devolve `undefined`, então não interfere na renderização, mas registra em `ctx.errors` — os testes de `unhandled` devem esvaziar/consumir `ctx.errors` como em `test/errors.test.ts` (verificado o padrão de `afterEach` em `_setup.ts:144`).

Casos (um por critério de aceite):

1. **RF-01** opção ausente e `false`: 404 com `content-type: application/json;charset=UTF-8`, corpo legado sem `title`/`type`/`instance`.
2. **RF-02** 400 com `message`: status 400, `content-type` começa com `application/problem+json`, charset `UTF-8`.
3. **RF-03** 403 completo: `status`, `title`, `detail`, `type`, `instance`; `title` do mapa quando não há `statusText`; `detail` omitido quando `message` é derivada; membros `undefined` ausentes.
4. **RF-04** unitário (fora da matriz, `test/unit` ou dentro do mesmo arquivo): `error.type`/`error.instance` retornam o informado; `undefined` sem informar; `HTTPError.status(409, undefined, {type, instance})`; valor não-string é descartado; `toJSON()` não contém `type`/`instance`.
5. **RF-05** `data` + `body:{codigo:"E42",status:200}` ⇒ `status: 422`, `data`, `codigo`; `body` com `type`/`title`/`detail`/`instance` não sobrescreve.
6. **RF-06** `throw new Error("segredo interno")` com `debug:false`: 500, `application/problem+json`, corpo sem a string nem `stack`; erro `unhandled` com `cause` contendo `statusMessage`/`type` próprios não vaza; com `debug:true` aparece `stack` e o JSON é indentado.
7. **RF-07** rota inexistente (`kNotFound`), body limit, caminho malformado (`/foo%`, status 400), falha de validação (`readValidatedBody`): todos `application/problem+json`.
8. **RF-08** `headers: {"x-id":"1"}` preservado; `content-type` explícito no erro prevalece; `event.res.errHeaders` mesclado; `onError` que devolve valor próprio não é reescrito; `set-cookie` não duplicado.
9. **RF-09** `pnpm vitest run` completo verde; sem ajuste esperado nos testes existentes (todos rodam com a opção desligada). Ajustar um teste existente só se algum falhar e preservando suas asserções originais.
10. **Tipos** (`test/unit/types.test-d.ts`): `H3Config["problemDetails"]` é `boolean | undefined`; `ErrorInput` aceita `type`/`instance` string e rejeita número; `HTTPError#type` é `string | undefined`.

Verificações finais: `pnpm vitest run test/problem-details.test.ts`, `pnpm vitest run`, `pnpm lint` (inclui typecheck), `pnpm build` (medir o tamanho do chunk antes/depois, R5). Seguir o fluxo de bug fix do AGENTS.md: escrever os testes primeiro e confirmá-los falhando.

## 6. Riscos

| ID   | Risco                                                                                                                                                                                                                                                                               | Mitigação                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-T1 | Vazamento via `type`/`statusText`/`message` herdados de `cause` em erros embrulhados (R1/PRD)                                                                                                                                                                                       | D-03 (só strings, só `details`), D-06 (ignora `type`, `instance`, `statusText`, `detail`, `data`, `body` se `unhandled`); teste dedicado (caso 6).                                                                                                  |
| R-T2 | Regressão do formato legado (R2/PRD)                                                                                                                                                                                                                                                | Caminho legado preservado byte a byte quando `problemDetails` é falsy; `toJSON` intocado; suíte completa no CI local.                                                                                                                               |
| R-T3 | Colisão de membros de extensão (R3/PRD)                                                                                                                                                                                                                                             | D-07: filtro de chaves reservadas; testes do caso 5.                                                                                                                                                                                                |
| R-T4 | Fluxos que chamam `toResponse` sem config (`src/handler.ts:122`, `src/utils/middleware.ts:26`, `src/rules/cache.ts:314`) continuam no formato legado                                                                                                                                | Limitação documentada (D-11); coerente com o escopo do PRD; cobrir com um teste que registre o comportamento atual ou mencionar em docs.                                                                                                            |
| R-T5 | `title` ausente para status fora do mapa                                                                                                                                                                                                                                            | Aceito (RFC permite); mapa cobre os códigos usuais; tabela fácil de ampliar.                                                                                                                                                                        |
| R-T6 | Tamanho do bundle (R5/PRD)                                                                                                                                                                                                                                                          | Mapa mínimo, sem dependência; medir com `pnpm build`; se relevante, reduzir entradas.                                                                                                                                                               |
| R-T7 | `ErrorInput` agora aceita `type`: objetos de erro de terceiros com `type` string passam a ser lidos por `new HTTPError(err)` em erros **tratados** (`HTTPError` lançado por terceiros não passa por esse construtor, mas `new HTTPError(thirdPartyError)` feito pela aplicação sim) | Comportamento esperado de “objeto de entrada”; documentar que `type` deve ser URI (P5); `unhandled` é imune (D-06).                                                                                                                                 |
| R-T8 | Serialização de `data` circular lança em `errorResponse`                                                                                                                                                                                                                            | Igual ao legado: a exceção é capturada em `toResponse` (`src/response.ts:26-30`) e vira 500 não tratado, que no formato novo sai sem `data`; coberto pelo teste existente `test/errors.test.ts:388` (legado) e por um caso espelho no formato novo. |
