# Especificação técnica — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-B) e `sdd/prd.md` (RF-01 a RF-11).

Este documento decide **como** implementar o PRD. Os requisitos funcionais não são repetidos aqui; cada decisão aponta para os RF que ela atende.

## 1. Estado atual (conferido no código)

- O corpo de erro é montado em dois pontos:
  - `HTTPError.toJSON()` em `src/error.ts:226-236`: emite `status`, `statusText`, `unhandled`, `message`, `data`, e depois espalha `this.body` (linha 234). Em erro não tratado (`unhandled`), `message` vira `"HTTPError"` e `data`/`body` somem.
  - `errorResponse()` em `src/response.ts:358-380`: junta `error.toJSON()` com `stack` (só em debug, linha 369) e define os headers a partir de `jsonHeaders` (`src/response.ts:270-272`, `application/json;charset=UTF-8`).
- Não há outro lugar que serialize erro. `grep` por `errorResponse|toJSON|application/json` em `src/` retorna só esses pontos, mais `src/utils/json-rpc.ts:484-491`, que trata erro de JSON-RPC e fica fora de escopo.
- Os erros do h3 passam todos por `HTTPError` (P2 do PRD). Os 404 de rota vêm de `src/response.ts:139-144` (`kNotFound`) e de `src/h3.ts:187` e `src/h3.ts:223`. Erros de corpo e validação também constroem `HTTPError` (`src/utils/body.ts:243-244`, `src/utils/internal/validate.ts:217-224`).
- `ErrorInput` herda de `Partial<ErrorBody>` (`src/error.ts:6`). Adicionar campo em `ErrorBody` já o expõe no construtor, sem tocar em `ErrorInput`.
- `src/index.ts:72` exporta `ErrorDetails`, `ErrorBody`, `ErrorInput` e `HTTPError`. Não é preciso exportar nada novo.
- `H3Config.debug` existe em `src/types/h3.ts:32`, e `errorResponse` recebe `config.debug` em `src/response.ts:173`.

## 2. Decisões de arquitetura

### D-01 — Formato de erro único, sem opção de configuração

- **Decisão:** toda resposta de erro gerada por `errorResponse()` passa a usar `application/problem+json`. Não há flag nova em `H3Config`.
- **Atende:** RF-01, RF-11 (sem gatilho, conforme `sdd/pedido.md:25`).
- **Alternativas consideradas:**
  - *Opção em `H3Config` (ex.: `problemDetails: true`)*: descartada. `sdd/pedido.md:25` proíbe gatilho e `sdd/prd.md:83` marca como fora de escopo.
  - *Negociação por `Accept`*: descartada. Está fora de escopo (`sdd/prd.md:84`) e adiciona ramificação ao caminho de erro, que já é sensível (ver `src/response.ts:167-172`).
- **Justificativa:** é a leitura direta do pedido. Um único caminho de código é mais fácil de testar e de manter.

### D-02 — `toJSON()` continua sendo a única fonte do corpo

- **Decisão:** a montagem dos membros RFC (`type`, `title`, `status`, `detail`, `instance`) fica em `HTTPError.toJSON()` (`src/error.ts:226`). `errorResponse()` só troca o `Content-Type` e continua espalhando `stack` por último.
- **Atende:** RF-02, RF-03, RF-05, RF-06, RF-07.
- **Alternativas consideradas:**
  - *Função nova `toProblemDetails(error)` em `src/response.ts`*: descartada. Duplicaria a lógica de mascaramento de `unhandled` que já vive em `toJSON()`, e `toJSON()` é o método que o próprio `JSON.stringify` chama.
  - *Montar o corpo em `errorResponse()`*: descartada. Deixaria `HTTPError` com um `toJSON()` que não corresponde ao corpo enviado.
- **Justificativa:** mantém um lugar só para a regra de mascaramento de erro não tratado (`src/error.ts:232-233`). `toJSON()` ganha só chaves novas, então a mudança de tipo do retorno é aditiva.

### D-03 — Ordem de precedência das chaves do corpo

- **Decisão:** o objeto é montado nesta ordem, da esquerda para a direita (o último vence):
  1. membros legados: `statusText`, `unhandled`, `message`, `data` (com o mascaramento atual);
  2. `...this.body` (só se não for `unhandled`);
  3. membros RFC: `type`, `title` (só se `statusText` existir), `status`, `detail`, `instance` (só se existir).
- **Atende:** RF-05, RF-06.
- **Alternativas consideradas:**
  - *Membros RFC primeiro, depois o `body`, depois os legados*: descartada. Mudaria o comportamento atual de quem usa `body.message`, `body.statusText` ou `body.data` para sobrescrever os legados. Hoje `body` vem por último (`src/error.ts:234`), então essa sobrescrita funciona. Mantê-la é o que "não quebrar o que já existe" pede (P1).
  - *Todos os membros emitidos pelo framework vencem o `body`*: descartada pelo mesmo motivo. Estende RF-06 para além do que o PRD pede.
- **Justificativa:** RF-06 só exige que os membros **RFC** prevaleçam. Os legados seguem exatamente a ordem de hoje. O custo é uma colisão: `body.type` e `body.title`/`body.detail`/`body.instance`/`body.status` passam a ser sobrescritos por membros RFC (ver Riscos R-02).
- **Detalhe:** `title` e `instance` só entram no objeto quando têm valor. Se a chave fosse `title: undefined`, o spread apagaria um `body.title` legítimo (com `statusText` ausente), porque `JSON.stringify` remove chaves `undefined` depois do spread.

### D-04 — `type` e `instance`: só da entrada direta, nunca de `cause`

- **Decisão:** `this.type` e `this.instance` leem apenas `details`, não `details.cause`. Diferente de `status` e `statusText`, que leem de `cause` (`src/error.ts:172-185`).
- **Atende:** RF-04, RF-07.
- **Alternativas consideradas:**
  - *Ler de `cause` como `status`*: descartada. `toError()` põe o valor lançado (não-Error) em `cause` (`src/response.ts:80-81`), e o teste em `test/errors.test.ts:247-260` exige que nada desse valor molde a resposta. Além disso, `cause` costuma ser erro de outra biblioteca, que pode ter um `type` próprio que não tem nada a ver com o problema HTTP.
- **Justificativa:** `type` e `instance` são campos novos. Começar com a origem mínima evita um vazamento novo. Se for preciso, a leitura de `cause` pode ser adicionada depois sem quebrar nada.
- **Caso `unhandled`:** `toJSON()` força `type: "about:blank"` e não emite `instance`, mesmo que a entrada tenha esses campos.

### D-05 — Mapeamento de `title`, `detail` e `type`

- **Decisão:**
  - `title` = `statusText`, omitido quando não há `statusText` (P3).
  - `detail` = `message`, ou `"HTTPError"` quando `unhandled` (RF-07, P4).
  - `type` = valor de entrada ou `"about:blank"` (RF-03, P5). Em `unhandled`, sempre `"about:blank"`.
  - `instance` = valor de entrada, omitido quando ausente.
- **Atende:** RF-02, RF-03, RF-04, RF-07.
- **Alternativas consideradas:**
  - *Derivar `title` do texto padrão do status (ex.: 404 → "Not Found") quando `statusText` falta*: descartada nesta entrega. Exigiria uma tabela de frases de status. O PRD (P3) manda omitir. Ver Riscos R-03.
- **Justificativa:** segue o PRD, sem adicionar tabela nova.

### D-06 — `Content-Type` sem parâmetro `charset`

- **Decisão:** `application/problem+json`, sem `;charset=UTF-8`. Constante nova `problemHeaders` ao lado de `jsonHeaders` (`src/response.ts:270-272`), mantendo `FrozenHeaders`.
- **Atende:** RF-01, RF-09.
- **Alternativas consideradas:**
  - *`application/problem+json;charset=UTF-8`*: aceitável, e o RF-01 usa "começando com". Descartada porque a RFC 9457 define o media type sem parâmetro, e JSON já é UTF-8 por padrão (RFC 8259).
- **Justificativa:** o media type exato é o que clientes comparam.
- **Consequência:** `mergeHeaders(problemHeaders, error.headers)` (`src/response.ts:360`) mantém a regra atual: header do próprio erro (`error.headers`) pode sobrescrever `content-type`. Isso não muda.

### D-07 — Mudança de semântica é quebra observável; marcar como breaking

- **Decisão:** implementar o PRD como está (formato padrão, `Content-Type` novo) e **não** manter `application/json` para erros. Recomendar marcar a entrega como breaking change (ver Pontos pendentes).
- **Atende:** P1, R1, R6 do PRD.
- **Alternativas consideradas:**
  - *Manter `application/json` para erros e só acrescentar campos*: é a única forma de não quebrar clientes que checam `Content-Type`. Contraria RF-01 e o pedido ("formato padrão de todas as respostas de erro"). Fica como alternativa se o usuário responder R6 com "manter JSON".
- **Justificativa:** o pedido é explícito sobre o formato padrão. A compatibilidade que o pedido exige é a dos **campos** (RF-05) e da API TypeScript (RF-11), e ambas são preservadas.

## 3. Arquivos a alterar

Todos os caminhos são relativos a `C:\dev\runs\r58e1e8eebf`. Linhas conferidas no código atual.

### Código do projeto

| Arquivo                  | Trecho atual                        | Mudança                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/error.ts:30`        | `interface ErrorBody<DataT>`        | Adicionar `type?: string` e `instance?: string`, com JSDoc citando RFC 9457 (D-04).                                                                                                                                                       |
| `src/error.ts:82-119`    | campos `readonly` da classe         | Adicionar `readonly type: string \| undefined` e `readonly instance: string \| undefined`, com JSDoc. Tipo explícito, por causa de `isolatedDeclarations`.                                                                                 |
| `src/error.ts:199-209`   | atribuições no construtor           | Após `this.body` (linha 209): `this.type = (details as ErrorBody)?.type \|\| undefined;` e `this.instance = (details as ErrorBody)?.instance \|\| undefined;`. Sem leitura de `cause` (D-04).                                                |
| `src/error.ts:226-236`   | `toJSON()`                          | Reescrever conforme o contrato da seção 4 (D-02, D-03, D-05).                                                                                                                                                                              |
| `src/response.ts:270-272`| `const jsonHeaders`                 | Adicionar, logo abaixo, `const problemHeaders = /* @__PURE__ */ new FrozenHeaders({ "content-type": "application/problem+json" });` (D-06). Manter `jsonHeaders`, que o caminho de sucesso ainda usa (`src/response.ts:312`).          |
| `src/response.ts:358-380`| `errorResponse()`                   | Linhas 359-361: trocar `jsonHeaders` por `problemHeaders` nos dois ramos. O restante (`stack` em debug, `status`, `statusText`) não muda.                                                                                                |

Não alterar:

- `src/index.ts:72`: os tipos já são exportados. Nenhum símbolo novo (RF-11).
- `src/utils/json-rpc.ts:479-491`: erro de JSON-RPC fica fora de escopo (`sdd/prd.md:82`).
- `src/h3.ts`, `src/utils/*`: todos continuam lançando `HTTPError` com a mesma assinatura.

### Testes existentes que precisam de ajuste

Só estes dois dependem do `Content-Type` antigo de erro. Os demais que checam `application/json` ou `.message` são de sucesso, ou verificam campos que continuam existindo (conferido, lista completa no PRD R2):

| Arquivo                 | Linha | Ajuste                                                                                                                                                                      |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/errors.test.ts`   | 44    | `toBe("application/json;charset=UTF-8")` vira `toBe("application/problem+json")`. Os demais `expect` do mesmo teste (status, `data`, headers) ficam como estão.              |
| `test/errors.test.ts`   | 140   | `toMatch("application/json")` vira `toMatch("application/problem+json")`. A string `application/json` não é substring de `application/problem+json`, então a assertion atual falharia. |

Verificados e **sem mudança**:

- `test/errors.test.ts:79-85`, `:99-104`: `message` continua no corpo (RF-05).
- `test/errors.test.ts:350`: `message: "HTTPError"` para erro não tratado continua valendo (RF-07).
- `test/security.test.ts:556`: resposta de **sucesso** com eco de `HTTPResponse` forjado. Continua `application/json;charset=UTF-8` (RF-10).
- `test/proxy.test.ts:1531`: resposta de sucesso.
- `test/router.test.ts:422`: HEAD com sucesso.
- `test/dist.test.ts:57`: `message` continua no corpo.

### Testes novos

- `test/problem-details.test.ts` (novo): cobre RF-01 a RF-10 com `describeMatrix` (ver seção 5).
- Tipos (RF-11): se `test/unit/types.test-d.ts` existir (AGENTS.md o lista em "Project Structure"), adicionar asserção de que `new HTTPError({ status: 409, type: "...", instance: "..." })` compila e de que `ErrorBody` aceita os campos. Não foi verificado que o arquivo existe; conferir antes.

### Documentação

- `CHANGELOG.md` existe na raiz (confirmado por `Glob`). Uma nota curta de breaking change, se a entrega for marcada como tal (ver pendências). Não foi lido para verificar o formato das entradas.

## 4. Contratos e assinaturas

### `ErrorBody` (`src/error.ts`)

```ts
export interface ErrorBody<DataT = unknown> {
  status: number;
  statusText?: string;
  message: string;
  unhandled?: boolean;
  data?: DataT;
  body?: Record<string, unknown>;

  /**
   * URI reference that identifies the problem type (RFC 9457, `type`).
   * Defaults to `about:blank` in the response body when not set.
   */
  type?: string;

  /**
   * URI reference that identifies this specific occurrence of the problem (RFC 9457, `instance`).
   */
  instance?: string;
}
```

`ErrorInput` herda os dois campos automaticamente (`src/error.ts:6`).

### `HTTPError` (`src/error.ts`)

```ts
export class HTTPError<DataT = unknown> extends Error implements ErrorBody<DataT> {
  readonly type: string | undefined;
  readonly instance: string | undefined;
  // ...demais membros inalterados
  toJSON(): {
    statusText?: string;
    unhandled?: boolean;
    message: string;
    data?: DataT;
    [key: string]: unknown;
    type: string;
    title?: string;
    status: number;
    detail: string;
    instance?: string;
  };
}
```

Forma pretendida do `toJSON()`, em pseudocódigo fiel ao D-03:

```ts
toJSON() {
  const unhandled = this.unhandled;
  return {
    // legados, com o mascaramento atual
    statusText: this.statusText,
    unhandled,
    message: unhandled ? "HTTPError" : this.message,
    data: unhandled ? undefined : this.data,
    // extensões do body (nunca em erro não tratado)
    ...(unhandled ? undefined : this.body),
    // membros RFC: vencem o body
    type: unhandled || !this.type ? "about:blank" : this.type,
    ...(this.statusText ? { title: this.statusText } : undefined),
    status: this.status,
    detail: unhandled ? "HTTPError" : this.message,
    ...(!unhandled && this.instance ? { instance: this.instance } : undefined),
  };
}
```

Pontos de atenção para a implementação:

- O tipo de retorno deve ser inline, sem exportar tipo novo (RF-11). Um alias local não exportado também serve, mas conferir com `pnpm typecheck` e `pnpm build`, já que o projeto usa `isolatedDeclarations`.
- `toJSON()` não é chamado por `json-rpc.ts`, então a mudança não atinge o JSON-RPC.

### `errorResponse()` (`src/response.ts`)

Assinatura inalterada:

```ts
function errorResponse(error: HTTPError, debug?: boolean, errHeaders?: Headers): Response
```

Mudanças internas: usar `problemHeaders` no lugar de `jsonHeaders` nas linhas 359-361. O corpo continua `JSON.stringify({ ...error.toJSON(), stack: ... })` (linha 368-369). `stack` vem por último, como hoje, então não pode ser sobrescrito pelo `body`.

### Constantes (`src/response.ts`)

```ts
const problemHeaders: Headers = /* @__PURE__ */ new FrozenHeaders({
  "content-type": "application/problem+json",
});
```

Não exportada.

### Superfície pública

Nenhum símbolo novo. Mudanças aditivas em `ErrorBody`, `ErrorInput` e `HTTPError` (campos `type` e `instance`). Nenhuma remoção.

## 5. Estratégia de testes

Seguir o fluxo de "Bug Fix Workflow" de `AGENTS.md`, adaptado a feature: escrever os testes antes da implementação e ver a falha.

1. **Escrever `test/problem-details.test.ts` primeiro**, com `describeMatrix` (AGENTS.md, "Writing Tests"). Casos:
   - RF-01: `throw new HTTPError({ status: 404 })` → `content-type` começa com `application/problem+json`.
   - RF-02: `HTTPError` com `status: 422`, `statusText: "Unprocessable Content"`, `message: "Campo inválido"` → corpo com `status`, `title`, `detail`.
   - RF-03: sem `type` → `type: "about:blank"`.
   - RF-04: `type` e `instance` na entrada → `err.type`, `err.instance` e corpo. Para o construtor direto, um teste de unidade em `new HTTPError(...)` sem app.
   - RF-04 (negativo, D-04): `new HTTPError({ cause: { type: "x", status: 400 } })` → `err.type` é `undefined` e o corpo não tem `type: "x"`.
   - RF-05: `data` e `body: { codigo: "X1" }` → corpo tem `statusText`, `unhandled`, `message`, `data`, `codigo`.
   - RF-06: `body: { title: "outro" }` com `statusText: "Conflict"` → `title: "Conflict"`. Também `body: { status: 999, type: "x" }` → `status` e `type` do framework.
   - RF-06 (D-03): `body: { message: "do body" }` → corpo mantém `message: "do body"`, comportamento atual preservado.
   - RF-06 (D-03, detalhe): `body: { title: "sem statusText" }` sem `statusText` → `title` do body aparece.
   - RF-07: handler lança `new Error("senha inválida")` (não tratado), fora de debug → `status: 500`, `unhandled: true`, `detail: "HTTPError"`, `type: "about:blank"`, sem `"senha inválida"` no texto, sem `data`, `body`, `stack`, `instance`.
   - RF-08: com `new H3({ debug: true })` (`src/types/h3.ts:32`), `stack` é array de strings. Sem debug, `stack` ausente.
   - RF-09: `headers: { "x-retry-after": "3" }` → header presente e `content-type` ainda `application/problem+json`.
   - RF-10: handler que retorna objeto → `content-type` `application/json;charset=UTF-8`, corpo igual.
   - Caso 404 de rota ausente (`src/response.ts:139-144`): `content-type` problem+json, `detail` com a mensagem de rota.
   - Caso `HEAD` com erro: corpo vazio, `content-length` ausente, como em `test/errors.test.ts:13-22`.
2. **Rodar e confirmar que falham**: `pnpm vitest run test/problem-details.test.ts`. Esperado: falha em RF-01, RF-02, RF-03, RF-04, RF-06 (parte RFC) e RF-09. Os que devem passar já hoje (RF-05 parcial, RF-07 parcial, RF-10) servem de controle.
3. **Ajustar os dois testes existentes** (`test/errors.test.ts:44` e `:140`) conforme a seção 3, no mesmo commit da implementação.
4. **Implementar** (`src/error.ts`, `src/response.ts`).
5. **Rodar de novo**:
   - `pnpm vitest run test/problem-details.test.ts test/errors.test.ts`
   - `pnpm vitest run` (suíte inteira)
   - `pnpm lint` (oxlint + oxfmt check, inclui `tsc`, conforme AGENTS.md)
   - `pnpm typecheck`
6. **Build** (R5): `pnpm build` e depois `pnpm vitest run test/dist.test.ts`. O teste de dist só cobre `message` e status, mas o build é a verificação de tipos e de tree-shaking que R5 pede.
7. **Suíte completa** com `pnpm test` (lint + typecheck + coverage) antes de dar a entrega por pronta.

Não foi executado nada disso. As instruções de comando vêm de `AGENTS.md` e de `package.json`, e nenhum teste foi rodado na preparação desta spec.

## 6. Riscos

- **R-01 — Quebra de clientes (PRD R1).** Clientes que checam `Content-Type: application/json` em erro, ou que fazem `JSON.parse` condicionado a esse tipo, deixam de reconhecer a resposta. Mitigação: campos legados preservados (D-03). Falta decisão de release (ver pendências).
- **R-02 — Colisão com `body` (PRD R3).** Quem usa `body.type`, `body.title`, `body.detail`, `body.instance` ou `body.status` vê o valor ser substituído pelo membro RFC. Antes, `body` sobrescrevia `status`, `statusText`, `message` e `data`; agora `status` e os membros RFC vencem. Isso é intencional (RF-06), mas é a mudança de comportamento de maior alcance para quem usa `body`. Mitigação: nota no changelog; quem precisa de um `type` próprio passa a usar a entrada direta `type`.
- **R-03 — `title` ausente em erros sem `statusText` (P3).** A maioria dos erros do framework tem `statusText` ausente. Por exemplo, o 404 de rota (`src/response.ts:140-143`) não define `statusText`, então não sai `title`. Isso segue o PRD, mas deixa a resposta menos informativa que o esperado para quem lê `title`. Alternativa para decidir depois: tabela de frases padrão por status. Não entra nesta entrega.
- **R-04 — Vazamento em erro não tratado (PRD R4).** Coberto por D-04 (sem `cause`) e pelo mascaramento de `toJSON()`. O teste de RF-07 deve checar explicitamente a ausência da mensagem interna no texto da resposta, não só o campo `detail`.
- **R-05 — `instance` e `type` vindos do cliente.** Não há fonte externa aqui: `type` e `instance` são definidos pelo código da aplicação, não por requisição. Não há injeção nova. Confirmar que nenhum caminho do framework copia dados de requisição para esses campos. Hoje nenhum copia.
- **R-06 — Ordem dos membros do JSON.** Clientes não devem depender da ordem, mas o teste de HEAD/`stack` depende de `stack` ser o último membro. Mantido.
- **R-07 — `isolatedDeclarations`.** O novo retorno de `toJSON()` precisa de tipo explícito e não pode depender de tipo não exportado sem cuidado. Verificado por `pnpm typecheck` e `pnpm build`.
- **R-08 — Headers do erro podem sobrescrever `content-type`.** `mergeHeaders(problemHeaders, error.headers)` (`src/response.ts:360`) permite que `error.headers` troque o tipo. Comportamento já existente com `jsonHeaders`. Não muda, mas vale saber que um `HTTPError` com `headers: { "content-type": ... }` pode não responder `application/problem+json`.
- **R-09 — Impacto em JSON-RPC.** Não há impacto: `src/utils/json-rpc.ts` não chama `toJSON()`. Confirmado por leitura de `src/utils/json-rpc.ts:479-491`.

## 7. Pontos pendentes de confirmação

Estes pontos vêm do PRD (R6 e "Pontos a confirmar"). A spec adota a leitura do PRD. Se o usuário responder diferente, as decisões indicadas mudam.

1. **Content-Type de erro (P1 / R6):** aceitar a quebra para `application/problem+json`, como assumido em D-07? Se não, a mudança vira só de campos, e D-01, D-06 e os testes RF-01 e RF-11 mudam.
2. **Breaking change:** a entrega deve ser marcada como breaking? Recomendação: sim, porque clientes que checam `Content-Type` quebram. O pacote está em `2.0.8` (`package.json`). Se for breaking, a decisão de versão (major) fica com o mantenedor. Esta spec não altera versão.
3. **`title` sem `statusText` (R-03):** aceitar a omissão do PRD (P3), ou incluir tabela de frases padrão nesta entrega? A spec segue o PRD.
4. **`body` com chaves RFC (R-02):** confirmar que o comportamento de precedência de D-03 (RFC vence, legados mantêm a ordem atual) é o desejado.
