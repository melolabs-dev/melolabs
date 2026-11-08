# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384, contrato enxuto #1384-B (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data`, mais as chaves de `body`), com `content-type: application/json`. Esse formato não é padronizado: clientes, gateways e ferramentas de observabilidade que entendem a RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretá-lo, e cada API precisa inventar a própria convenção.

### Objetivo
Fazer com que **toda** resposta de erro gerada pelo h3 seja um documento *problem details* JSON conforme a RFC 9457, sem nenhuma configuração ou opção nova (o novo formato substitui o atual como padrão), e permitir que `HTTPError` carregue os membros `type` e `instance` da RFC.

### Métricas de sucesso
- 100% das respostas de erro produzidas por `toResponse` (erros lançados, `kNotFound`, erros não tratados, `throw 404`) saem com `content-type: application/problem+json` e os membros obrigatórios da RFC.
- Nenhuma API pública nova além dos campos `type` e `instance` em `HTTPError`/`ErrorInput`.
- Suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

Mapeamento dos membros da RFC 9457: `type` → `type`; `title` → texto de status; `status` → `status`; `detail` → mensagem do erro; `instance` → `instance`.

### RF-01 — Content-Type `application/problem+json`
Toda resposta de erro serializada pelo h3 usa o media type `application/problem+json` (a RFC 9457 §3 não exige charset; manter `charset=utf-8` caso o h3 já o emita hoje).

- **Dado** uma rota que lança `new HTTPError({ status: 400 })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 400 e o header `content-type` começa com `application/problem+json`.

### RF-02 — Membros `type` e `instance` no `HTTPError`
O objeto de entrada do construtor de `HTTPError` (e o tipo `ErrorInput`) aceita os campos opcionais `type` (string, URI de referência) e `instance` (string, URI de referência), expostos como propriedades `readonly` na instância (`undefined` quando não informados). Valem as mesmas regras de herança via `cause` já aplicadas a `status`/`statusText`, se isso couber sem complexidade. `HTTPError.status(...)` e o construtor com mensagem (`new HTTPError("msg", { type })`) também os aceitam por usarem o mesmo tipo de entrada.

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/forbidden", instance: "/contas/12" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** os valores são, respectivamente, `"https://example.com/probs/forbidden"` e `"/contas/12"`; e, sem informá-los, ambos são `undefined`.

### RF-03 — Membro `type` com padrão `about:blank`
O corpo sempre contém `type`. Se o erro não define `type`, o valor é `"about:blank"` (RFC 9457 §4.2.1); se define, usa o valor informado.

- **Dado** um erro sem `type` e outro com `type: "https://example.com/probs/out-of-credit"`
- **Quando** ambos são respondidos
- **Então** o corpo do primeiro tem `"type": "about:blank"` e o do segundo tem o URI informado.

### RF-04 — Membros `status` e `title`
O corpo contém `status` (igual ao status HTTP da resposta) e `title`. O `title` é o `statusText` do erro quando existir; caso contrário, a frase-padrão do status HTTP (ex.: 404 → "Not Found"); para status sem frase-padrão conhecida, o membro é omitido.

- **Dado** uma rota que lança `new HTTPError({ status: 404 })` e outra com `statusText: "Conta inexistente"`
- **Quando** as respostas são lidas
- **Então** o corpo da primeira tem `status: 404` e `title: "Not Found"`, e o da segunda tem `status: 404` e `title: "Conta inexistente"`.

### RF-05 — Membro `detail`
Para erros tratados (não `unhandled`), o corpo contém `detail` com a mensagem do erro (`error.message`). Para erros `unhandled`, `detail` é omitido, preservando a regra de segurança atual de não vazar mensagem de erros internos.

- **Dado** uma rota que lança `new HTTPError({ status: 400, message: "E-mail inválido" })` e outra que lança `new Error("segredo interno")`
- **Quando** as respostas são lidas
- **Então** a primeira tem `detail: "E-mail inválido"` e a segunda não contém `detail` nem o texto "segredo interno" (e responde 500).

### RF-06 — Membro `instance`
Quando o erro define `instance`, o corpo contém `instance` com esse valor; caso contrário o membro é omitido.

- **Dado** um erro com `instance: "/pedidos/99"`
- **Quando** a resposta é lida
- **Então** o corpo contém `"instance": "/pedidos/99"`; para um erro sem `instance`, a chave não aparece.

### RF-07 — Compatibilidade com os membros existentes (aditiva)
Para "não quebrar o que já existe", os membros atuais continuam no corpo junto com os da RFC: `statusText`, `message` (igual a `detail`; `"HTTPError"` para `unhandled`), `unhandled`, `data` e as chaves extras de `body` (extension members, RFC 9457 §3.2). Chaves de `body` **não** podem sobrescrever os membros `type`, `title`, `status`, `detail` e `instance`; o `stack` em modo `debug` permanece.

- **Dado** `new HTTPError({ status: 422, message: "Inválido", data: { campo: "nome" }, body: { codigo: "E42" } })`
- **Quando** a resposta é lida
- **Então** o corpo contém `status`, `title`, `type`, `detail`, e também `message: "Inválido"`, `data: { campo: "nome" }` e `codigo: "E42"`; e um `body: { status: 200, title: "x" }` não altera `status`/`title` do corpo.

### RF-08 — Cobertura de todos os caminhos de erro
O formato vale para: erro lançado em handler/middleware, `kNotFound` (404 de rota inexistente), erro não-HTTP (500 `unhandled`), `throw <número>`, erros vindos de validação e de utilitários internos, e respostas de `onError` que retornem um erro. Headers do erro (`error.headers`, `errHeaders`) continuam sendo mesclados; um `content-type` definido explicitamente pelo erro não é sobrescrito.

- **Dado** um app sem a rota `/x`
- **Quando** o cliente faz `GET /x`
- **Então** a resposta é 404 com `content-type: application/problem+json` e corpo com `type: "about:blank"`, `status: 404`, `title: "Not Found"` e `detail` com a mensagem de rota não encontrada.

### RF-09 — Serialização via `toJSON`
`HTTPError.toJSON()` retorna o objeto problem details (RF-03 a RF-07) para que `JSON.stringify(error)` e a resposta produzam o mesmo documento (exceto `stack` em debug).

- **Dado** um `HTTPError` com `status`, `message` e `instance`
- **Quando** se chama `JSON.stringify(error)`
- **Então** o resultado contém `type`, `title`, `status`, `detail` e `instance` conforme as regras acima.

### RF-10 — Ajuste da suíte existente
Os testes existentes que assertam o `content-type` ou o formato exato do corpo de erro são atualizados para o novo formato **sem perder o que verificam** (mesmo cenário, mesma intenção da asserção). Novos testes cobrem RF-01 a RF-09 usando `describeMatrix` (web e node). `pnpm lint` e `pnpm typecheck` passam.

- **Dado** a suíte após a mudança
- **Quando** se executa `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** todos terminam sem falhas.

## 3. Fora de escopo

- Qualquer opção de configuração, flag ou gatilho para ligar/desligar o formato (o pedido proíbe; o formato é sempre ativo).
- Novos nomes públicos além de `type` e `instance` em `HTTPError`/`ErrorInput` (sem helpers como `problem()`, sem novos exports, sem novas entradas de pacote).
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Registro de tipos de problema, documentação hospedada em URIs `type` ou geração automática de `type` a partir do status.
- Alterar o comportamento de `onError`, de logging de erros `unhandled`, de `statusText` sanitizado ou da lógica de status.
- Mudanças em outros formatos de erro: JSON-RPC (`json-rpc.ts`) e WebSocket mantêm o próprio protocolo.
- Alterações em `h3/rules` além do que decorre do formato de erro padrão.
- Remover ou depreciar campos atuais (`message`, `statusText`, `data`, `body`).

## 4. Premissas e riscos

### Premissas
- A RFC 9457 §3.1 define `type`, `status`, `title`, `detail` e `instance` como membros opcionais; o h3 emite `type`, `status` e `title` sempre que possível por serem úteis ao cliente.
- Consumidores aceitam membros extras no documento (RFC §3.2: extensões devem ser ignoradas se desconhecidas).
- A frase-padrão do status pode ser obtida sem nova dependência (tabela interna pequena em `src/utils/internal/`, sem export público).

### Riscos
- **Tensão no contrato.** O pedido diz que o novo formato "substitui" o atual e, ao mesmo tempo, "não quebrar o que já existe". Resolução adotada: substituição do `content-type` e do conjunto base de membros, mantendo os campos legados como membros de extensão (RF-07). Se a intenção for remover os legados, é uma quebra e deve ser confirmada antes.
- **Mudança de `content-type` é incompatível por natureza**: clientes que verificam `application/json` exato (e testes existentes) quebram. Mitigação: ajuste dos testes (RF-10); registrar a mudança como *breaking* em notas de release; clientes que usam `res.json()` continuam funcionando.
- **Vazamento de informação**: `detail` expõe a mensagem. Mitigação: omitido para `unhandled` (RF-05); `instance` e `type` vêm só do código da aplicação, nunca de entrada do cliente.
- **Colisão de chaves**: `body`/`data` podem tentar sobrescrever membros da RFC; RF-07 define precedência dos membros da RFC.
- **`isolatedDeclarations`/tipos**: o tipo de retorno de `toJSON` precisa ser explícito; `ErrorBody` é compartilhado, então `type`/`instance` não devem tornar-se obrigatórios nem vazar para outros usos do tipo.
- **Propagação via `cause`**: herdar `type`/`instance` de `cause` pode surpreender; limitar à regra já usada para `status`/`statusText`.
- **Integrações a jusante (ex.: Nitro)** que leem `toJSON()` ou o corpo de erro podem depender do formato antigo; a compatibilidade aditiva (RF-07) reduz o risco.
