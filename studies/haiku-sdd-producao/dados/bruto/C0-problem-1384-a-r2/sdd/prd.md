# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros como JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, `stack` em debug) com `content-type: application/json`. Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), que clientes, gateways e ferramentas de API esperam. Não há como obter respostas de erro padronizadas sem escrever um `onError` manual em cada aplicação.

### Objetivo

Permitir que uma aplicação h3 responda erros no formato `application/problem+json` (RFC 9457) ligando uma única opção de configuração, `problemDetails`. Com a opção desligada (padrão), o comportamento atual permanece idêntico byte a byte.

### Nomes públicos (únicos permitidos)

- `H3Config.problemDetails?: boolean` — padrão desligado, lido de `app.config`.
- Campos opcionais `type` e `instance` no objeto de entrada do `HTTPError`, expostos como propriedades da instância.

### Métricas de sucesso

- Suíte existente verde (com ajustes mínimos, se algum teste depender do que muda).
- `pnpm lint` e `pnpm typecheck` passam.
- Novos testes cobrem todos os critérios de aceite abaixo, em `web` e `node` (`describeMatrix`).

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

`H3Config` ganha a opção booleana `problemDetails`, documentada (JSDoc), desligada por padrão e lida de `app.config` como `debug` e `silent`.

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** um handler lança `HTTPError` com status 404
- **Então** a resposta é idêntica à atual: `content-type: application/json` e corpo no formato legado (`status`, `message`, ...), sem `title`, `type` ou `instance`.

### RF-02 — Content-Type `application/problem+json`

Com `problemDetails: true`, toda resposta de erro gerada pelo h3 usa `content-type: application/problem+json`, mantendo o charset já usado nas respostas JSON atuais.

**Critério de aceite**

- **Dado** `new H3({ problemDetails: true })` e uma rota que lança `new HTTPError({ status: 400, message: "inválido" })`
- **Quando** o cliente requisita a rota
- **Então** o status é 400 e o `content-type` começa com `application/problem+json`.

### RF-03 — Membros padrão do corpo (`type`, `title`, `status`, `detail`, `instance`)

O corpo JSON segue a RFC 9457:

- `status`: o status HTTP da resposta.
- `title`: `statusText` do erro, quando houver; caso contrário a frase padrão do status (ex.: "Not Found" para 404).
- `detail`: a `message` do erro (omitida quando for apenas a mensagem genérica derivada do status, se igual a `title`).
- `type`: o valor de `type` do erro; se ausente, é omitido (equivale a `"about:blank"` pela RFC, §4.2.1).
- `instance`: o valor de `instance` do erro; se ausente, é omitido.
- Membros `undefined` não são serializados.

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro `new HTTPError({ status: 403, statusText: "Forbidden", message: "Sem permissão", type: "https://exemplo.com/erros/permissao", instance: "/pedidos/42" })`
- **Quando** o cliente recebe a resposta
- **Então** o corpo JSON contém `status: 403`, `title: "Forbidden"`, `detail: "Sem permissão"`, `type: "https://exemplo.com/erros/permissao"` e `instance: "/pedidos/42"`.

### RF-04 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita `type?: string` e `instance?: string`, expostos como propriedades `readonly` da instância (`undefined` se não informados). Valem também para `HTTPError.status(...)` via `details`. Não se criam outros nomes públicos.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 409, type: "urn:erro:conflito", instance: "/x/1" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** retornam `"urn:erro:conflito"` e `"/x/1"`; e, sem informá-los, ambos retornam `undefined`.

### RF-05 — Extensões preservadas (`data` e `body`)

Os dados extras do erro continuam disponíveis como membros de extensão (RFC 9457 §3.2): `body` é espalhado no nível superior e `data` permanece sob a chave `data`. Membros de extensão não podem sobrescrever `type`, `title`, `status`, `detail` nem `instance`.

**Critério de aceite**

- **Dado** `problemDetails: true` e `new HTTPError({ status: 422, message: "x", data: { campo: "nome" }, body: { codigo: "E42", status: 200 } })`
- **Quando** o cliente recebe a resposta
- **Então** o corpo contém `data: { campo: "nome" }` e `codigo: "E42"`, e `status` continua `422`.

### RF-06 — Erros não tratados não vazam detalhes

Erros com `unhandled` continuam ocultando mensagem, `data` e `body`. Em problem details, `detail` é omitido (ou genérico), `title` vem da frase do status 500 e nenhuma informação interna é exposta. O `stack` só aparece com `debug: true`, como membro de extensão `stack`.

**Critério de aceite**

- **Dado** `problemDetails: true`, `debug` desligado e um handler que lança `new Error("segredo interno")`
- **Quando** o cliente recebe a resposta
- **Então** o status é 500, o `content-type` é `application/problem+json`, e o corpo não contém "segredo interno" nem `stack`.

### RF-07 — Erros gerados pelo framework (404, validação, etc.)

Respostas de erro geradas internamente (rota inexistente via `kNotFound`, corpo muito grande, caminho malformado, falhas de validação) também usam o formato problem details quando a opção está ligada, pois passam pelo mesmo caminho de renderização.

**Critério de aceite**

- **Dado** `problemDetails: true` e uma requisição a uma rota inexistente
- **Quando** o cliente recebe a resposta
- **Então** o status é 404, o `content-type` é `application/problem+json` e o corpo tem `status: 404`, `title: "Not Found"` e `detail` com a mensagem de rota não encontrada.

### RF-08 — Interação com headers, `onError` e `debug`

- Headers do erro (`error.headers`) e `event.res` de erro continuam mesclados na resposta; o `content-type` do problem details prevalece sobre o JSON padrão, mas um `content-type` explícito definido no erro continua respeitado como hoje.
- Um `onError` que devolva valor próprio mantém precedência (a resposta customizada não é reescrita).
- `debug: true` continua indentando o JSON com 2 espaços.

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro com `headers: { "x-id": "1" }`
- **Quando** o cliente recebe a resposta
- **Então** o header `x-id: 1` está presente e o `content-type` é `application/problem+json`.

### RF-09 — Compatibilidade retroativa e `toJSON`

`HTTPError.toJSON()` e o formato legado não mudam quando a opção está desligada. Os novos campos `type`/`instance` não aparecem no JSON legado, salvo decisão explícita registrada nos testes (premissa P3).

**Critério de aceite**

- **Dado** a suíte de testes existente
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam, e qualquer teste ajustado mantém as mesmas verificações originais.

## 3. Fora de escopo

- Qualquer outro nome público novo (funções utilitárias, helpers, novas opções, exports ou subpaths).
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Ligar problem details por rota, middleware, route rules ou por requisição; só há o gatilho global em `H3Config`.
- Registro de tipos de problema, URLs de documentação ou geração de `type` automático.
- Alteração do formato de erros em JSON-RPC, WebSocket e event-stream.
- Mudanças em `HTTPResponse`, `defineHandler` e outros fluxos de resposta que não sejam erro.
- Alterações no Nitro ou em outros pacotes.

## 4. Premissas e riscos

### Premissas

- **P1.** `type` ausente equivale a `"about:blank"` (RFC 9457 §4.2.1); omitir o membro é aceitável e mais enxuto.
- **P2.** O ponto único de renderização de erros é `errorResponse` em `src/response.ts`; basta recebê-lo com a opção `problemDetails`, sem mexer no restante do fluxo.
- **P3.** `toJSON()` do `HTTPError` serve a consumidores como JSON-RPC (`src/utils/json-rpc.ts`) e permanece inalterado em formato; a conversão para problem details acontece só na renderização HTTP.
- **P4.** A frase padrão do status (`title`) pode vir de um mapa interno pequeno ou de `statusText`; sem dependência nova.
- **P5.** `type` e `instance` são strings (URIs/referências, RFC 9457 §3.1.1 e §3.1.5).

### Riscos

- **R1 — Vazamento em erros não tratados:** o formato novo poderia expor `message`/`stack`. Mitigação: RF-06 e teste dedicado.
- **R2 — Regressão do formato legado:** mudar `toJSON` ou `errorResponse` pode quebrar testes e consumidores. Mitigação: RF-01 e RF-09, comparação com a suíte atual.
- **R3 — Colisão de membros:** `body` do usuário pode sobrescrever `status`/`title`/`type`. Mitigação: RF-05 define a precedência.
- **R4 — Header `content-type` conflitante:** mescla de headers do erro/`event.res` pode anular o tipo. Mitigação: RF-08 e teste.
- **R5 — Tamanho do bundle:** um mapa de frases de status aumenta o núcleo. Mitigação: preferir `statusText` e um mapa mínimo, avaliando o impacto no build.
- **R6 — Ambiguidade de `detail`:** a mensagem padrão derivada ("HTTPError 404") pode ser redundante com `title`. Mitigação: omitir `detail` quando for apenas a mensagem gerada.
