# Techspec — Problem Details (RFC 9457) por opção de configuração

Referências: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A) e `sdd/prd.md` (RF-01 a RF-08). Todas as citações `arquivo:linha` abaixo foram conferidas no código atual (commit `10b4904`).

## 1. Estado atual (resumo verificado)

- Erros são renderizados em um único ponto: `prepareResponse` chama `errorResponse(error, config.debug, errHeaders)` em `src/response.ts:173`; a função está em `src/response.ts:358-380`. Ela mescla `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`) com `error.headers` e `errHeaders`, e serializa `{...error.toJSON(), stack}` com indentação 2 se `debug`.
- `kNotFound` vira `HTTPError` 404 em `src/response.ts:139-144` e passa pelo mesmo caminho. Erros não-HTTPError viram `HTTPError` com `unhandled = true` em `src/response.ts:146-155`.
- `onError` roda em `src/response.ts:159-166`: a chamada recursiva (`nested = true`) devolve a `Response` do hook sem reformatar (`src/response.ts:188`, `val instanceof Response`), e um erro lançado pelo hook cai de novo em `errorResponse` (via `.catch(toError)` + `newVal ?? val`, linha 164-165). Logo RF-07 (b) e (c) já são satisfeitos desde que `errorResponse` receba a config.
- `H3Config` está em `src/types/h3.ts:28-53` (`debug` na l.32, `silent` na l.37); `H3CoreConfig` é `Omit<H3Config, "plugins">` (`src/types/h3.ts:55`), então herda a opção nova sem alteração. A config chega ao `toResponse` em `src/h3.ts:99` (`this.config`). Apps montados com `mount()` têm as rotas copiadas para o pai (`src/h3.ts:213-218`), portanto erros delas usam a config do app pai.
- `HTTPError`: campos em `src/error.ts:82-119`, construtor em `src/error.ts:162-210` (herança de `details.cause` nas l.172-209), `toJSON` em `src/error.ts:226-236`. `ErrorBody` em `src/error.ts:30-69`; `ErrorInput` (`Partial<ErrorBody>`) em `src/error.ts:6`. Exportados por `src/index.ts:72`.
- `statusText` é sanitizado para ASCII visível (`src/utils/sanitize.ts:3,10-12`), usado em `src/error.ts:180-185`.
- Não há outros renderizadores de erro JSON: `src/utils/json-rpc.ts:476-498` usa o formato JSON-RPC e `src/utils/ws.ts:157` devolve texto puro (426); ambos fora de escopo.

## 2. Decisões de arquitetura

### D-01 — Ponto de ativação: `errorResponse` recebe a config

**Alternativas:** (a) ramificar dentro de `HTTPError.toJSON()`; (b) criar um segundo renderizador chamado em `prepareResponse`; (c) passar `config` a `errorResponse` e ramificar ali.
**Escolha: (c).** `toJSON()` não conhece a config e o PRD proíbe mudar o formato sem a opção (inclusive `toJSON()`); (b) duplicaria a mesclagem de cabeçalhos. A mudança é trocar a assinatura para `errorResponse(error, config, errHeaders)` (de `debug?: boolean` para `config: H3Config`) e atualizar a única chamada em `src/response.ts:173`. A opção é lida em tempo de resposta (`config.problemDetails`), igual a `debug` e `silent`, sem custo no caminho feliz.

### D-02 — Código novo em helper interno

**Alternativas:** (a) inline em `src/response.ts`; (b) novo arquivo `src/utils/internal/problem.ts`.
**Escolha: (b).** `src/response.ts` já tem ~380 linhas, acima da meta de 200 do AGENTS.md; o helper contém a tabela de frases HTTP e a montagem do corpo. Arquivo interno (não exportado por `src/index.ts`), sem criar API pública (restrição do contrato). Import com extensão `.ts`, sem barrel.

### D-03 — `type` e `instance`: campos de `ErrorBody`, fora do `toJSON()`

**Alternativas:** (a) incluí-los no `toJSON()`; (b) mantê-los só na instância e no renderizador problem.
**Escolha: (b).** (a) mudaria o JSON legado para quem usa `type`/`instance` (risco já listado no PRD). Em `ErrorBody` entram `type?: string` e `instance?: string` (`src/error.ts:30-69`; `ErrorInput` herda por `Partial`). Em `HTTPError` entram `readonly type: string | undefined` e `readonly instance: string | undefined` (junto de `src/error.ts:107-119`), atribuídos no construtor (após `src/error.ts:209`) com a mesma herança dos demais campos: `details.type ?? details.cause.type`. Só valores `typeof === "string"` são aceitos, caso contrário `undefined`: isso evita que um `Error` de terceiros com `type` não-string (ou outro significado) contamine o problem. `toJSON()` fica intocado; o tipo de retorno `Omit<ErrorBody,"body"> & ErrorBody["body"]` ganha opcionais `type`/`instance` por tabela, mas os valores nunca são emitidos.
Atenção: `implements ErrorBody` na classe exige que os campos novos sejam opcionais compatíveis; `string | undefined` readonly satisfaz.

### D-04 — `title` e a sanitização de `statusText` (conflito com o PRD)

O RF-03 exige `title: "Entidade inválida"`, mas `error.statusText` já passa por `sanitizeStatusMessage`, que remove todo caractere fora de ASCII visível (`src/utils/sanitize.ts:3`), resultando em `"Entidade invlida"`. O requisito, como escrito, não é atendível lendo `error.statusText`.
**Alternativas:** (a) aceitar o texto sanitizado e ajustar o exemplo do PRD; (b) ler o texto cru de `error.cause` no renderizador; (c) guardar o texto cru numa propriedade privada `~title` não enumerável, definida no construtor, com herança de `cause` como `statusText`.
**Escolha: (c).** O header HTTP `statusText` continua sanitizado (proteção contra response splitting preservada, `src/response.ts:190-200`), mas o corpo JSON é seguro por `JSON.stringify`, então pode carregar Unicode. (b) acopla o renderizador à forma de `cause` (pode ser `Error`, `HTTPError` ou `ErrorInput`). A propriedade usa o prefixo `~` das convenções do AGENTS.md, não é enumerável (não aparece em `toJSON`, `Object.keys` nem snapshots) e não é nome público. Regras de `title`: `~title` (se `typeof string` e não vazio) → senão `error.statusText` → senão frase padrão do status → senão omitido. Para erros `unhandled`, usa-se só `error.statusText`/frase padrão (nunca o texto cru vindo de uma `cause` arbitrária), mantendo a exposição igual à de hoje. Se o time preferir (a), basta remover `~title`; registrar a divergência no PRD.

### D-05 — Frases HTTP padrão: tabela mínima interna

**Alternativas:** (a) dependência (ex.: `statuses`); (b) `http.STATUS_CODES` do Node; (c) tabela própria.
**Escolha: (c).** (a) viola "2 deps de produção"; (b) quebra Bun/Deno/Workers (AGENTS.md: web standards first). Tabela `Record<number, string>` em `problem.ts` com os status registrados 4xx/5xx e os 2xx/3xx comuns; códigos fora da tabela omitem `title` (RF-03). Custo: cerca de 60 linhas, mantido num objeto literal para tree-shaking (só importado por `response.ts`).

### D-06 — Forma do corpo e precedência (RF-03, RF-05, RF-06, RF-07)

**Alternativas:** (a) manter as chaves legadas (`statusText`, `message`, `unhandled`) junto das padrão; (b) emitir só membros padrão + extensões.
**Escolha: (b).** Convivência de `message` e `detail` no mesmo corpo confundiria consumidores e o ponto da RFC é um formato padrão. Construção em `problemBody(error, debug)`:

1. Base de extensões, na ordem legada: `data` (omitido se `unhandled`), depois `...body` (omitido se `unhandled`), depois `stack` (só com `debug` e quando houver stack, como `src/response.ts:369`).
2. Membros padrão por último, sobrescrevendo qualquer colisão do `body`: `type` (`error.type` senão `"about:blank"`; para `unhandled`, sempre `"about:blank"`), `title` (D-04), `status` (`error.status`), `detail` (`unhandled ? "HTTPError" : error.message`), `instance` (`error.instance`, omitido se ausente; ignorado se `unhandled`).
   Chaves `undefined` somem no `JSON.stringify`. Indentação 2 quando `debug`. `statusText`, `message` e `unhandled` não são emitidos; a RF-05 deixa claro que `body` pode trazer qualquer extensão, inclusive `message`, que então é preservada como extensão.
   Observação: com `debug: true` um `unhandled` continua com `stack` (comportamento atual de `src/response.ts:369`); `data` e `body` continuam ocultos (RF-06/RF-07).

### D-07 — Content-Type e cabeçalhos

**Escolha:** novo `problemHeaders` (`FrozenHeaders`) ao lado de `jsonHeaders` (`src/response.ts:270`), com `content-type: application/problem+json;charset=UTF-8`, mesmo sufixo de charset do JSON atual. `errorResponse` seleciona `jsonHeaders` ou `problemHeaders` conforme a opção e mantém a mesclagem existente (`error.headers`, depois `errHeaders`, `src/response.ts:359-364`). Como hoje, `error.headers` pode sobrescrever o content-type explicitamente (comportamento preservado, não regressão). `statusText` e `status` da `Response` continuam vindo de `error.statusText`/`error.status` (`src/response.ts:375-376`).

### D-08 — Sem negociação, sem opção por rota

Seguindo o PRD (seção 3), a opção é global e booleana; não há leitura de `Accept` nem integração com route rules. `src/types/h3.ts` ganha apenas `problemDetails?: boolean` com JSDoc, e nenhum nome exportado novo (confere com a lista de exports em `test/unit/package.test.ts`, que não muda).

## 3. Arquivos a alterar

| Arquivo                                                                           | Linha(s)   | Mudança                                                                                                                             |
| --------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/h3.ts`                                                                 | `:28-37`   | Adicionar `problemDetails?: boolean` (com JSDoc) após `silent`.                                                                     |
| `src/error.ts`                                                                    | `:30-69`   | `type?: string` e `instance?: string` em `ErrorBody`, com JSDoc (RFC 9457).                                                         |
| `src/error.ts`                                                                    | `:107-119` | Campos `readonly type`/`instance` em `HTTPError`.                                                                                   |
| `src/error.ts`                                                                    | `:195-209` | Atribuição no construtor com herança de `cause`; definição de `~title` (D-04) via `Object.defineProperty` não enumerável.           |
| `src/error.ts`                                                                    | `:226-236` | `toJSON()` não muda (garantido por teste).                                                                                          |
| `src/response.ts`                                                                 | `:173`     | `errorResponse(error, config, errHeaders)`.                                                                                         |
| `src/response.ts`                                                                 | `:270-272` | Novo `problemHeaders` junto de `jsonHeaders`.                                                                                       |
| `src/response.ts`                                                                 | `:358-380` | Nova assinatura; ramo `config.problemDetails` delegando a `problemBody`.                                                            |
| `src/utils/internal/problem.ts`                                                   | novo       | `problemBody`, tabela de frases (D-02, D-05, D-06).                                                                                 |
| `docs/1.guide/900.api/1.h3.md`                                                    | `:111-112` | Listar `problemDetails` entre as opções suportadas.                                                                                 |
| `docs/1.guide/1.basics/6.error.md`                                                | `:51-60`   | Documentar `type` e `instance` em "HTTPError Fields"; nova seção "Problem Details (RFC 9457)" após a l.76, com exemplo de resposta. |
| `test/problem-details.test.ts`                                                    | novo       | Testes RF-01 a RF-07.                                                                                                               |
| `test/unit/http-error.test.ts` (ou arquivo unitário existente de erro, se houver) | novo       | `type`/`instance` e ausência no `toJSON()`.                                                                                         |

Ajustes em testes existentes: nenhum esperado, pois com a opção desligada nada muda. `test/errors.test.ts:44` e `:140` continuam verificando `application/json`. Se `pnpm test` revelar dependência de forma de `ErrorBody` (testes de tipos em `test/unit/types.test-d.ts`), ajustar preservando a verificação.

## 4. Contratos e assinaturas

```ts
// src/types/h3.ts
export interface H3Config {
  /**
   * When enabled, H3 renders error responses as RFC 9457 problem details
   * (`application/problem+json`). Disabled by default.
   */
  problemDetails?: boolean;
  // ...
}

// src/error.ts
export interface ErrorBody<DataT = unknown> {
  /** RFC 9457 `type`: URI reference identifying the problem type. */
  type?: string;
  /** RFC 9457 `instance`: URI reference identifying this occurrence. */
  instance?: string;
  // ...
}
export class HTTPError<DataT = unknown> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
}

// src/utils/internal/problem.ts (interno)
export function problemBody(error: HTTPError, debug?: boolean): Record<string, unknown>;

// src/response.ts (interno)
function errorResponse(error: HTTPError, config: H3Config, errHeaders?: Headers): Response;
```

Exemplo de saída com `problemDetails: true` (RF-03):

```json
{
  "data": { "campo": "email" },
  "codigo": "E42",
  "type": "https://exemplo.com/erros/validacao",
  "title": "Entidade inválida",
  "status": 422,
  "detail": "campo 'email' ausente",
  "instance": "/pedidos/42"
}
```

Para `new Error("segredo interno")`: `{"type":"about:blank","title":"Internal Server Error","status":500,"detail":"HTTPError"}`.

## 5. Estratégia de testes

Novo `test/problem-details.test.ts` com `describeMatrix` (web e node), ligando a opção por teste com `t.app.config.problemDetails = true` (mesmo padrão de `t.app.config.onError = undefined` em `test/errors.test.ts:14`). Um teste por requisito, no mínimo:

- **RF-01:** sem opção e com `false`: `content-type` é `application/json`, corpo tem `statusText`/`message` e não tem `type`/`title`/`detail`/`instance`.
- **RF-02:** `HTTPError.status(404)` e também rota inexistente (`kNotFound`): status 404 e content-type `application/problem+json`; cabeçalhos de `error.headers` e `event.res.errHeaders` presentes; `HEAD` sem corpo.
- **RF-03:** caso 422 completo do PRD (inclui o `title` com acento, validando D-04); `title` por frase padrão (404 sem `statusText` → "Not Found"); status fora da tabela omite `title`; `type` default `about:blank`.
- **RF-04 (unitário, sem servidor):** `type`/`instance` via construtor, via `HTTPError.status(...)`, herdados de `cause`, `undefined` por padrão, valor não-string ignorado; `toJSON()` sem a opção não contém `type`/`instance` (guarda do risco de compatibilidade).
- **RF-05:** `data` e `body` presentes; `body: { title: "malicioso", status: 1, type: "x" }` não sobrescreve os padrão.
- **RF-06:** `throw new Error("segredo interno")`: 500, content-type problem, sem a string "segredo interno", sem `stack`, sem `data`/`body`; `detail: "HTTPError"`. Capturar `t.errors` como em `test/errors.test.ts:114-116`.
- **RF-07:** (a) `debug: true` → `stack` array de strings e corpo indentado; (b) `onError` retornando `Response` prevalece sem reformatação; (c) `onError` que lança `HTTPError` sai em problem details; `onError` que apenas observa não altera.
- **Regressão:** rodar a suíte completa (`pnpm test`) e `pnpm lint` + typecheck. Verificar ainda que `test/unit/package.test.ts` (lista de exports) permanece verde.

Fluxo de bug/feature do AGENTS.md: escrever os testes primeiro, confirmar que falham, implementar, confirmar que passam.

## 6. Riscos

| Risco                                                                                                                                                                                                                                                                                | Mitigação                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conflito PRD × sanitização** (D-04): sem `~title` o exemplo RF-03 retorna `"Entidade invlida"`.                                                                                                                                                                                    | Decisão D-04(c); teste com acento; avisar o autor do PRD se optar por (a).                                                                                            |
| **Compatibilidade de `toJSON()`** e snapshots existentes.                                                                                                                                                                                                                            | `toJSON()` não é alterado; teste dedicado; `~title` não enumerável.                                                                                                   |
| **Colisão de chaves** de `body`.                                                                                                                                                                                                                                                     | Membros padrão são aplicados por último (D-06) e testados.                                                                                                            |
| **Vazamento em `unhandled`**: `detail`, `type`, `instance` e `title` poderiam vir de uma `cause` arbitrária (ex.: `Error` com `type`/`statusText`).                                                                                                                                  | `unhandled` força `about:blank`, `detail: "HTTPError"`, ignora `instance` e `~title`; teste RF-06 cobre. Com `debug`, `stack` continua exposto (comportamento atual). |
| **Herança de `type` de `Error` de terceiros** (`new HTTPError(err)` em código do usuário adota `err.type`).                                                                                                                                                                          | Só strings; como `status` e `statusText` já herdam da mesma forma, o comportamento é consistente. Documentar.                                                         |
| **Charset no content-type:** o PRD pede "começando com `application/problem+json`".                                                                                                                                                                                                  | Usar `application/problem+json;charset=UTF-8`; testes usam `toMatch`/`startsWith`, como `test/errors.test.ts:140`.                                                    |
| **Tamanho de arquivo** (< 200 LoC).                                                                                                                                                                                                                                                  | Código novo em `problem.ts` (D-02); `response.ts` e `error.ts` crescem poucas linhas.                                                                                 |
| **Apps montados:** apps `H3` montados via `mount()` têm rotas copiadas para o pai (`src/h3.ts:213-218`), então a opção do pai vale; a opção de um sub-app é ignorada nesse caso, e um handler `fetch` montado (`src/h3.ts:220-226`) devolve sua própria `Response` sem reformatação. | Documentar em `6.error.md`; sem código extra (consistente com `debug`).                                                                                               |
| **Respostas de erro fora do fluxo** (`src/utils/ws.ts:157`, JSON-RPC, estáticos de terceiros).                                                                                                                                                                                       | Fora de escopo (PRD seção 3); não alteradas.                                                                                                                          |
| **`pnpm lint`/typecheck:** `isolatedDeclarations` exige tipos explícitos nos exports.                                                                                                                                                                                                | Helper interno com retorno declarado; `Object.defineProperty` sem `@ts-ignore` desnecessário (usar cast local).                                                       |
