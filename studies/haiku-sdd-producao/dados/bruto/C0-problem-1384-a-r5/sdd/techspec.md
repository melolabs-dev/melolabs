# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01…RF-11).
Escopo: só a opção `H3Config.problemDetails` e os campos `type`/`instance` de `HTTPError`. Nenhum outro nome público.

## 1. Estado atual (conferido no código)

- A resposta de erro é montada por `errorResponse(error, debug, errHeaders)` em `src/response.ts:358`. Ela usa `jsonHeaders` (`src/response.ts:270`, `application/json;charset=UTF-8`), `error.toJSON()` (`src/response.ts:368`) e acrescenta `stack` em debug (`src/response.ts:369`), com indentação 2 em debug (`src/response.ts:372`).
- O único chamador é `prepareResponse`, em `src/response.ts:173` (`val = errorResponse(error, config.debug, errHeaders)`). Esse ponto é alcançado por todo erro: lançado, rejeitado, `kNotFound` (convertido em `HTTPError` 404 em `src/response.ts:139-144`) e erro devolvido por `onError` (chamada recursiva com `nested`, `src/response.ts:161-166`).
- `HTTPError.toJSON()` (`src/error.ts:226-236`) emite `status`, `statusText`, `unhandled`, `message`, `data` e o espalhamento de `body`. Para `unhandled`, mascara `message` como `"HTTPError"` e descarta `data` e `body`.
- `ErrorInput` (`src/error.ts:6`) estende `Partial<ErrorBody>`. `HTTPError implements ErrorBody` (`src/error.ts:74`). Os campos são atribuídos no construtor em `src/error.ts:199-209`.
- `H3Config` está em `src/types/h3.ts:28-53`; `debug` fica na linha 32 e `silent` na 37. A config é lida de `this.config` (`src/h3.ts:99`) e repassada a `toResponse` (`src/response.ts:13`).
- Dois chamadores de `toResponse` não passam config: `src/handler.ts:122,124` (`handler.fetch` avulso, sem app) e `src/utils/middleware.ts:26` (middleware `onResponse`).
- `STATUS_TEXT` em `src/utils/response.ts:347` é privado e só cobre 204 e 30x. Não serve para `title` e não deve ser exportado.
- Docs das opções: `docs/1.guide/900.api/1.h3.md:111-114`.
- Os testes usam `new H3({ debug: true, ... })` (`test/_setup.ts:135-141`), então `stack` aparece nos testes por padrão. Testes mudam config em runtime (ex.: `t.app.config.onError = undefined`, `test/errors.test.ts:14`).

## 2. Decisões de arquitetura

### D-01 — Onde a opção é lida e como o caminho novo se encaixa

**Alternativas**
1. Ramificar dentro de `errorResponse`, que passa a receber a config.
2. Aplicar a transformação como pós-processamento do `Response` já montado.
3. Trocar o formato em `HTTPError.toJSON()`, lendo a config via o evento.

**Escolha: 1.** `errorResponse` troca a assinatura `(error, debug, errHeaders)` por `(error, config, errHeaders)` e lê `config.problemDetails` e `config.debug`. Esse é o único ponto de geração de erro, e é onde o PRD (§4, premissas) manda ler a opção.

- A opção 2 faria parse e re-serialização do corpo, e perderia o controle sobre a indentação.
- A opção 3 é inviável: `toJSON()` não conhece a config, e alterá-lo mudaria saídas públicas (fora de escopo, PRD §3).

Com a opção desligada o ramo antigo é executado sem alteração: mesmos `jsonHeaders`, mesmo `toJSON()`, mesma indentação.

### D-02 — Construção do corpo em função interna única

**Alternativas**
1. Montar o objeto inline em `errorResponse`.
2. Criar `toProblemDetails(error, debug)` em arquivo interno novo, sem export público.
3. Adicionar um método público (`error.toProblem()`).

**Escolha: 2.** O novo `src/utils/internal/problem.ts` (internal, não exportado por `src/index.ts`, em conformidade com "internal helpers" do AGENTS.md) exporta `toProblemDetails(error, debug)` e a tabela interna de textos de status. A opção 3 cria nome público novo, o que é proibido (pedido, "Nenhum outro nome público novo"). A opção 1 deixaria `response.ts` maior e misturaria a precedência com a renderização. Uma função única é a "fonte de verdade para ordem de campos e precedência" que o PRD §4 pede.

Cuidados com o tamanho do arquivo: a tabela de ~60 status mais a função cabem em menos de 200 linhas.

### D-03 — Forma e precedência do corpo

**Alternativas**
1. Espalhar `error.toJSON()` e sobrescrever os campos padrão por cima.
2. Construir os membros padrão primeiro e copiar as extensões por cima, ignorando as chaves reservadas.
3. Espalhar as extensões por último, deixando-as vencer.

**Escolha: 2.** Algoritmo de `toProblemDetails`:

1. `title = error.statusText || STATUS_TEXT[error.status]`. Se o status não estiver na tabela, `title` é omitido (a RFC permite).
2. `detail = error.unhandled || error.message === title ? undefined : error.message`.
3. Objeto base, nesta ordem: `type`, `title`, `status`, `detail`, `instance`. As chaves com valor `undefined` somem em `JSON.stringify`.
4. Se não for `unhandled`: copiar `error.body` e depois `data` (quando definido), ignorando as chaves reservadas `type`, `title`, `status`, `detail`, `instance`.
5. Se `debug && error.stack`: `stack = linhas aparadas`, também fora das reservadas. Esta etapa vem por último para vencer `body.stack`, como no legado (`src/response.ts:369`).

Por que não a opção 1: `toJSON()` inclui `statusText`, `unhandled` e `message`, que não são membros da RFC; o corpo ficaria poluído e a regra `detail` ≠ `title` não seria aplicável.

Por que não a opção 3: RF-06 exige que `status: 200` em `body` não substitua o real.

Regras derivadas:
- `type`/`instance` explícitos do erro vencem os de `body` (PRD §4, risco 6), pois ficam entre os reservados e `body` é filtrado.
- `body.message`, `body.statusText` e `body.unhandled` passam como extensões comuns, sem tratamento especial.
- Não há `message`, `statusText` nem `unhandled` no corpo padrão: `title` e `detail` os substituem.

### D-04 — Mascaramento de `unhandled` (RF-07)

**Alternativas**
1. Reaproveitar `toJSON()` e remover as chaves indesejadas.
2. Tratar `unhandled` dentro de `toProblemDetails`, omitindo `detail`, `body` e `data`.

**Escolha: 2.** `unhandled` produz `{ title, status }` mais `stack` somente em debug. `type` e `instance` também são omitidos para `unhandled`: `new HTTPError(val)` (`src/response.ts:148`) recebe um `Error` arbitrário como `details`, e bibliotecas costumam pôr uma propriedade `type` nos seus erros (ex.: `entity.too.large`). Ver R-02. O `title` de um erro `unhandled` é o texto padrão ou o `statusText` herdado, o mesmo que o legado já expõe em `statusText`. `message` nunca vira `detail` nesse caso.

Alternativa 1 descartada: depende de lembrar de apagar cada chave, e uma chave nova vazaria por omissão. Aqui a lista é de inclusão.

### D-05 — `type` e `instance` em `ErrorBody`/`HTTPError`

**Alternativas**
1. Declarar em `ErrorBody` (herdam `ErrorInput` e a classe, via `implements`).
2. Declarar só em `ErrorInput` e na classe.

**Escolha: 1.** `ErrorInput extends Partial<ErrorBody>` (`src/error.ts:6`), então `ErrorInput` ganha os campos sem repetição, e `implements ErrorBody` exige a propriedade na classe, o que mantém tipo e implementação em sincronia. Como os dois são opcionais, nada quebra para quem implementa a interface.

- `ErrorBody` (`src/error.ts:30`): `type?: string` e `instance?: string`, com JSDoc citando a RFC 9457.
- Classe (perto de `src/error.ts:112`): `readonly type: string | undefined` e `readonly instance: string | undefined`.
- Construtor (depois de `src/error.ts:209`): ler só de `details` (não de `details.cause`) e só se `typeof === "string"`. Caso contrário `undefined`. Ver R-02.
- `toJSON()` (`src/error.ts:226`) **não muda**: o formato legado fica idêntico, com ou sem os campos novos (RF-01: sem `type`/`instance` adicionados). Os campos novos só chegam ao corpo pelo caminho de problem details. O PRD §3 limita mudanças em `toJSON()` ao "necessário", e aqui não é necessário.
- `HTTPError.status()` (`src/error.ts:144`) repassa `details`, então já aceita os campos sem mudança.

### D-06 — Content-Type

**Alternativas**
1. Montar `new Headers` a cada erro.
2. Constante congelada ao lado de `jsonHeaders`, no mesmo padrão.

**Escolha: 2.** Adicionar `problemHeaders = new FrozenHeaders({ "content-type": "application/problem+json;charset=UTF-8" })` junto a `src/response.ts:270`, com `/* @__PURE__ */`. A codificação UTF-8 segue a do `jsonHeaders` (RF-02). `errorResponse` continua copiando e mesclando como hoje (`src/response.ts:359-364`), o que satisfaz RF-09: `error.headers` e `errHeaders` continuam aplicados e podem sobrescrever o `content-type`, como no legado. Status, `statusText` e a indentação em debug ficam como estão (`src/response.ts:372-377`).

### D-07 — Cobertura do caminho do middleware `onResponse` (RF-10)

O middleware `onResponse` chama `toResponse(rawBody, event)` sem config (`src/utils/middleware.ts:26`). `rawBody` pode ser `kNotFound` (`src/h3.ts:39` devolve `kNotFound` como valor e `src/middleware.ts:27` o propaga). Sem ajuste, um app com `problemDetails` e um middleware `onResponse` responderia o 404 no formato legado.

**Alternativas**
1. Passar `event.app?.config` completo.
2. Passar só `{ problemDetails: event.app?.config.problemDetails }`.
3. Não tratar.

**Escolha: 2.** A opção 1 faria `toResponse` executar de novo os hooks `onError` e `onResponse` do app (`src/response.ts:35`, `src/response.ts:159`), duplicando efeitos colaterais. Também mudaria o comportamento de `debug` nesse caminho. A opção 3 viola RF-10.

Efeito colateral aceito: com `problemDetails` desligado o objeto passado é `{ problemDetails: undefined }`, comportamento idêntico ao `{}` de hoje.

`src/handler.ts:122,124` (`handler.fetch` sem app) não muda: não há `app.config` para ler, então o formato legado permanece. Documentar como limitação (R-05).

### D-08 — Documentação e JSDoc da opção

`H3Config.problemDetails?: boolean` em `src/types/h3.ts`, logo após `silent` (linha 37), com JSDoc que cita a RFC 9457 e explica `Content-Type`, `type`/`instance` e o efeito em erros `unhandled`. Mesma linha adicionada à lista de opções em `docs/1.guide/900.api/1.h3.md` (depois da linha 112). Não há `H3Config` duplicado a atualizar: `H3CoreConfig` é derivado por `Omit` (`src/types/h3.ts:55`).

## 3. Arquivos a alterar

| Arquivo | Linha(s) | Mudança |
| --- | --- | --- |
| `src/types/h3.ts` | `src/types/h3.ts:37` | Inserir `problemDetails?: boolean` com JSDoc depois de `silent`. |
| `src/error.ts` | `src/error.ts:30-69` | `type?` e `instance?` em `ErrorBody`. |
| `src/error.ts` | `src/error.ts:112` | Propriedades `readonly type` e `readonly instance` na classe. |
| `src/error.ts` | `src/error.ts:208-209` | Atribuir `type`/`instance` no construtor (só de `details`, só string). |
| `src/response.ts` | `src/response.ts:173` | Chamar `errorResponse(error, config, errHeaders)`. |
| `src/response.ts` | `src/response.ts:270` | Declarar `problemHeaders` ao lado de `jsonHeaders`. |
| `src/response.ts` | `src/response.ts:358-380` | Nova assinatura e ramo `config.problemDetails`; importar `toProblemDetails`. |
| `src/utils/internal/problem.ts` | (novo) | `toProblemDetails` e a tabela de textos de status. |
| `src/utils/middleware.ts` | `src/utils/middleware.ts:26` | Passar `{ problemDetails: event.app?.config.problemDetails }` (D-07). |
| `docs/1.guide/900.api/1.h3.md` | `docs/1.guide/900.api/1.h3.md:112` | Documentar a opção. |
| `test/problem-details.test.ts` | (novo) | Testes de integração (seção 5). |
| `test/unit/types.test-d.ts` | fim do `describe("types", ...)` | Testes de tipo de `ErrorInput` e `H3Config`. |

Não alterar: `src/index.ts` (nada novo a exportar), `src/handler.ts`, `src/utils/json-rpc.ts`, `src/utils/ws.ts`, `src/utils/internal/dispose.ts`.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
interface H3Config {
  /**
   * When enabled, error responses use RFC 9457 problem details
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
}

// src/error.ts
interface ErrorBody<DataT = unknown> {
  /** RFC 9457 `type`: URI reference identifying the problem type. Omitted when unset (`about:blank`). */
  type?: string;
  /** RFC 9457 `instance`: URI reference identifying this occurrence of the problem. */
  instance?: string;
  // ...campos existentes
}
class HTTPError<DataT = unknown> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
}

// src/utils/internal/problem.ts (não exportado por src/index.ts)
export function toProblemDetails(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/response.ts (interna ao módulo)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Corpo gerado, exemplo (`new HTTPError("Usuário não encontrado", { status: 404, statusText: "Not Found" })`):

```json
{ "title": "Not Found", "status": 404, "detail": "Usuário não encontrado" }
```

Resposta: `content-type: application/problem+json;charset=UTF-8`. Estrutura sem `type`/`instance` quando ausentes.

Compatibilidade: `type`/`instance` são opcionais em tipo e em tempo de execução; com `problemDetails` ausente ou `false` nenhuma saída existente muda.

## 5. Estratégia de testes

**Regra geral:** nenhum teste existente deve precisar de ajuste, já que o caminho legado fica intacto e `toJSON()` não muda. Se algum quebrar, será só pelo `errorResponse` ter mudado de assinatura (interna). Conferir com `pnpm vitest run test/errors.test.ts` antes e depois.

Novo `test/problem-details.test.ts`, em `describeMatrix` (cobre `web` e `node`). Cada teste liga `t.app.config.problemDetails = true` (mutação de config já usada em `test/errors.test.ts:14`). Como o app de teste nasce com `debug: true` (`test/_setup.ts:136`), os testes de RF-07 definem `t.app.config.debug = false`. Rotas são registradas com `t.app.get(...)`/`t.app.use(...)`.

| Teste | Requisito | Verifica |
| --- | --- | --- |
| opção ausente ou `false` mantém corpo e content-type legados | RF-01 | `application/json;charset=UTF-8`, corpo com `statusText`/`message`, sem `title`/`detail`/`instance`. |
| 404 de `HTTPError.status(404)` | RF-02 | status 404, `content-type` começa com `application/problem+json`. |
| `title`/`detail`/`status`; sem `type`/`instance` | RF-03 | exemplo do PRD; também `detail` omitido quando `message === title`; `title` padrão sem `statusText`. |
| `error.type`/`error.instance` | RF-04 | valores expostos e `undefined` por padrão. |
| `type`/`instance` no corpo | RF-05 | valores idênticos; campo do erro vence `body.type`. |
| extensões | RF-06 | `body` no nível superior, `data` sob `data`, `body.status: 200` não vence. |
| `unhandled` | RF-07 | `debug=false`, `throw new Error("segredo interno")`: 500, problem+json, sem "segredo interno", sem `stack`, sem `detail`; `type` de erro de terceiro (`Object.assign(new Error(), { type: "x" })`) não vaza. |
| debug | RF-08 | `stack` como array e corpo indentado. |
| cabeçalhos | RF-09 | 401 + `x-trace`; `statusText`; `event.res.errHeaders`. |
| cobertura de caminhos | RF-10 | rota inexistente; erro em middleware; validação (`readValidatedBody`); `onError` que devolve valor próprio (precedência); `onError` que devolve `HTTPError`; app com middleware `onResponse` (D-07); `HEAD` sem corpo. |

Regressão obrigatória: remover `problemDetails: true` faz os testes falharem (RF-11). Verificar manualmente uma vez, comentando a opção.

Testes de tipo, em `test/unit/types.test-d.ts`: `ErrorInput` aceita `type?: string` e `instance?: string` e rejeita `type: 1`; `H3Config["problemDetails"]` é `boolean | undefined`; `HTTPError#type` e `#instance` são `string | undefined`.

Verificação final: `pnpm lint`, `pnpm typecheck` e `pnpm test`. Rodar também `pnpm vitest run test/unit/package.test.ts test/dist.test.ts`, caso o build já exista, para confirmar que nenhum export mudou.

## 6. Riscos

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Mudança em `HTTPError`/`ErrorBody` quebrar tipos de quem implementa `ErrorBody`. | Campos opcionais; teste de tipo. |
| R-02 | `new HTTPError(foreignError)` herdar um `type` ou `instance` de erro de terceiro (ex.: `body-parser`) e expô-lo. | Construtor lê só de `details` e só se `typeof === "string"`; `toProblemDetails` omite ambos em `unhandled` (D-04); teste dedicado. Um `HTTPError` construído a partir de um erro *handled* pode expor o `type` que veio nele; aceito, pois o chamador o passou explicitamente. |
| R-03 | `detail` redundante: um `HTTPError` sem mensagem tem `message` `"HTTPError 404"` (`src/error.ts:193`), que difere do `title` e aparece como `detail`. | Segue o RF-03 literal. Se o resultado for indesejável, a correção seria omitir `detail` quando `message` for o padrão gerado; isso é decisão de produto e fica fora desta spec. Teste documenta o comportamento atual. |
| R-04 | `statusText` do erro com texto personalizado vira `title`, divergindo do texto padrão do status. | Intencional (RF-03). |
| R-05 | `handler.fetch` avulso (`src/handler.ts:122`) e erros fora de app não têm config e ficam no formato legado. | Documentado; sem `app.config` não há de onde ler a opção. |
| R-06 | A tabela de textos de status interna divergir de runtimes ou ficar desatualizada. | Tabela estática RFC 9110 (e 418, 422, 425, 429, 451). Status ausente ⇒ `title` omitido, não inventado. |
| R-07 | `JSON.stringify` com `data`/`body` circular ou `BigInt` lançar dentro de `errorResponse`. | Mesmo risco do legado (`src/response.ts:366`); sem agravamento. |
| R-08 | `config` congelada (`src/_entries/_common.ts:5`) impedir ligar a opção depois da criação. | A opção é lida a cada erro; é preciso defini-la no construtor em produção, como `debug` e `silent`. Testes mutam a config antes de congelar (só entradas de runtime congelam). |
| R-09 | Duplicar `set-cookie` ao mexer em `errorResponse`. | A mesclagem de `errHeaders` e a limpeza de `kEventRes` em `src/response.ts:172` ficam intocadas; teste de `set-cookie` do `test/errors.test.ts` cobre. |

## 7. Fora do escopo (reafirmado)

Negociação por `Accept`, ligação por rota/requisição, `application/problem+xml`, registro IANA, mudança do formato padrão, JSON-RPC, WebSocket, Nitro, e qualquer export, função ou subpath novo.
