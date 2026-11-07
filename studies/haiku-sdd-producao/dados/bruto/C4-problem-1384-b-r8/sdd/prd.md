# PRD — Respostas de erro no formato problem details (RFC 9457)

Referência: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio, montado por `HTTPError.toJSON()` (`src/error.ts`) e serializado em `errorResponse()` (`src/response.ts`). O corpo tem a forma `{ status, statusText, unhandled, message, data, ...body }` e o `Content-Type` é `application/json`. Esse formato não segue nenhum padrão, então clientes precisam de código específico para cada API que usa h3 para interpretar erros.

### Objetivo

Fazer com que o h3 responda erros no formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), representação JSON, como padrão de todas as respostas de erro, sem nenhuma configuração nova. `HTTPError` passa a aceitar e expor os campos `type` e `instance` da RFC.

## Requisitos funcionais

### RF-01 — Toda resposta de erro usa problem details

Toda resposta gerada a partir de um `HTTPError` (tratado ou não tratado) tem corpo JSON no formato da RFC 9457, com `Content-Type: application/problem+json`. Os membros são:

- `type`: valor informado no `HTTPError`; quando ausente, `"about:blank"`.
- `title`: `statusText` do erro; quando ausente, a frase padrão do status HTTP.
- `status`: código HTTP da resposta.
- `detail`: a `message` do erro (ver RF-04 para erros não tratados).
- `instance`: valor informado no `HTTPError`, quando existir.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`,
- **Quando** a requisição é feita,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json`, e o corpo JSON contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não encontrado"`.

### RF-02 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`. Os dois ficam expostos como propriedades da instância. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` é `"https://example.com/probs/sem-permissao"` e `error.instance` é `"/pedidos/42"`.

### RF-03 — `type` e `instance` aparecem na resposta

Os valores de `type` e `instance` passam do `HTTPError` para o corpo da resposta, conforme RF-01.

**Critério de aceite**

- **Dado** um handler que lança o erro do critério de RF-02,
- **Quando** a requisição é feita,
- **Então** o corpo JSON contém `type: "https://example.com/probs/sem-permissao"` e `instance: "/pedidos/42"`.

### RF-04 — Erros não tratados não vazam detalhes

Quando o erro é marcado como `unhandled`, o `detail` é o texto genérico `"HTTPError"` (como hoje). Mensagem original, `data`, `body` e stack não são enviados. O `status` continua sendo 500 ou o status do erro original.

**Critério de aceite**

- **Dado** uma exceção `new Error("senha do banco: 123")` não capturada por nenhum handler,
- **Quando** a requisição é feita em modo não debug,
- **Então** o corpo JSON não contém a string `"senha do banco"`, `detail` é `"HTTPError"` e o status é 500.

### RF-05 — Stack só em modo debug

Em modo debug, o corpo mantém o campo `stack` com as linhas do erro, como hoje. Fora do modo debug, `stack` não aparece.

**Critério de aceite**

- **Dado** o servidor em modo debug e um `HTTPError` com status 400,
- **Quando** a requisição é feita,
- **Então** o corpo JSON contém `stack` como array de strings.
- **Dado** o mesmo erro com modo debug desligado,
- **Quando** a requisição é feita,
- **Então** o corpo JSON não contém `stack`.

### RF-06 — Campos extras existentes continuam no corpo

O campo `data` e os campos de `body` do `HTTPError` continuam aparecendo no corpo da resposta, como membros de extensão da RFC 9457. Não são removidos nem renomeados. Os campos `unhandled` e `statusText` atuais também podem permanecer como extensão, se isso facilitar a compatibilidade (ver premissa P3).

**Critério de aceite**

- **Dado** um `HTTPError` com `data: { campo: "x" }` e `body: { codigo: "E42" }`,
- **Quando** a requisição é feita,
- **Então** o corpo JSON contém `data: { campo: "x" }` e `codigo: "E42"` no nível superior.

### RF-07 — Headers do erro são preservados

Os headers passados em `headers` do `HTTPError` continuam sendo enviados na resposta. O `Content-Type` definido pelo h3 (`application/problem+json`) prevalece sobre qualquer `content-type` vindo de `headers` do erro.

**Critério de aceite**

- **Dado** um `HTTPError` com `headers: { "x-request-id": "abc" }`,
- **Quando** a requisição é feita,
- **Então** a resposta contém o header `x-request-id: abc` e `Content-Type: application/problem+json`.

### RF-08 — Compatibilidade da suíte de testes

A suíte existente continua passando. Quando um teste existente verifica o formato antigo, ele é ajustado ao novo formato, mantendo o que ele verifica (status, headers, conteúdo de `data`, comportamento em modo debug e em erros não tratados).

**Critério de aceite**

- **Dado** a suíte de testes na branch após a mudança,
- **Quando** `pnpm vitest run` é executado,
- **Então** todos os testes passam, e nenhum teste foi removido sem substituto equivalente.

### RF-09 — Comportamento igual em todos os runtimes

O novo formato é o mesmo nos modos `web` e `node` dos testes (`describeMatrix`).

**Critério de aceite**

- **Dado** um teste escrito com `describeMatrix` que lança `HTTPError` com `type` e `instance`,
- **Quando** o teste roda nos modos `web` e `node`,
- **Então** ambos recebem o mesmo corpo JSON e o mesmo `Content-Type`.

### RF-10 — Qualidade do código

`pnpm lint` e `pnpm typecheck` passam sem erros após a mudança.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos terminam com código de saída 0.

## Fora de escopo

- Opção de configuração para voltar ao formato antigo ou escolher o formato (a especificação pede formato padrão sem configuração).
- Negociação de conteúdo por `Accept` (sempre `application/problem+json` para erros).
- Mapeamento específico para erros de validação (campos `errors` ou similares), além do que já vai em `data`.
- Traduzir ou alterar as mensagens existentes de `HTTPError`.
- Alterações em `h3/rules`, `h3/tracing`, WebSocket ou JSON-RPC, exceto se os testes desses módulos dependerem do formato de erro.
- Mudanças em exports de v1 (`src/_deprecated.ts`).
- Documentação do site e guia de migração para clientes (pode ser tratado em outro pedido).

## Premissas e riscos

### Premissas

- **P1 — Conflito a resolver:** o pedido pede que o novo formato seja o padrão "sem configuração" e, ao mesmo tempo, "não quebrar o que já existe". Trocar o `Content-Type` e a forma do corpo quebra clientes que leem `message` ou `application/json`. Este PRD segue o pedido literalmente (formato padrão, sem opção), mas a decisão precisa ser confirmada antes da implementação. Se a quebra não for aceitável, a alternativa é uma opção de configuração, o que contraria a restrição de não criar nomes públicos novos.
- **P2 — Mapeamento de `message` para `detail`:** assume-se que `message` vira `detail`. Se o `title` não existir, usa-se a frase padrão do status.
- **P3 — Extensões:** `data` e `body` continuam no nível superior. Assume-se que `unhandled` e `statusText` podem ser removidos do corpo, já que `title` e `detail` os substituem. Caso precisem ficar, entram como extensão.
- **P4 — Modo debug:** o modo debug é o mesmo usado hoje para mostrar `stack`. Nenhum mecanismo novo é criado.

### Riscos

- **R1 — Quebra de clientes:** consumidores que leem o corpo atual (`message`, `statusText`, `unhandled`) ou que checam `application/json` vão falhar. Mitigação: a mudança precisa aparecer em changelog como breaking, e a decisão de P1 deve ser tomada antes.
- **R2 — Vazamento em erros não tratados:** o novo formato precisa manter a regra de RF-04. Mitigação: teste de regressão específico (critério de RF-04).
- **R3 — Testes existentes:** muitos testes comparam o corpo JSON atual. Mitigação: ajuste mantendo a intenção de cada teste (RF-08), sem apagar verificações.
- **R4 — Títulos padrão:** a frase padrão do status pode não existir para códigos fora da lista IANA. Mitigação: usar `statusText` quando houver, e fallback vazio ou genérico nos demais casos.
