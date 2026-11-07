# PRD — Problem details (RFC 9457) via utilitário `problem()`

Base: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um corpo JSON próprio (`{ status, statusText, message, data, ... }`, produzido por `errorResponse` em `src/response.ts`). APIs que querem seguir a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs) precisam montar esse formato à mão em cada handler, com `Content-Type: application/problem+json`, e não há um ponto único para isso no framework.

### Objetivo

Permitir que um handler responda um erro no formato "problem details" chamando um utilitário explícito, sem mudar o formato de erro de nenhuma rota que não o use.

Esta variante é opt-in: o formato RFC 9457 vem só de `problem(input)`. Erros lançados de outra forma continuam no formato atual.

## Requisitos funcionais

### RF-01 — Função `problem(input)` exportada pelo pacote `h3`

A função `problem` é exportada pelo entry principal do pacote `h3` e recebe um objeto de entrada (`input`), do tipo que o PRD chama de tipo da entrada de `problem`.

**Critério de aceite**

- **Dado** que o consumidor importa `problem` de `h3`,
- **Quando** ele chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** a chamada retorna sem erro uma instância de `HTTPError` com `status` 404.

### RF-02 — `problem()` devolve um `HTTPError` lançável

O valor retornado por `problem()` é um `HTTPError`. Por isso pode ser usado com `throw` e continua sendo reconhecido por `HTTPError.isError`, pelos middlewares `onError` e pelo fluxo de erro atual.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 422, message: "Dados inválidos" })`,
- **Quando** a requisição é processada,
- **Então** `HTTPError.isError(err)` é `true` para o erro capturado em um `onError`, e o `status` da resposta é 422.

### RF-03 — Campos `type` e `instance` da RFC 9457

A entrada de `problem()` aceita, além dos campos de `ErrorInput`, os campos opcionais `type` (string, URI) e `instance` (string, URI). Quando `type` não é informado, a resposta usa `"about:blank"`, valor padrão definido pela RFC. Quando `instance` não é informado, o campo é omitido.

**Critério de aceite**

- **Dado** `problem({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a resposta é serializada,
- **Então** o corpo contém `"type": "https://exemplo.com/erros/sem-permissao"` e `"instance": "/pedidos/42"`.
- **E** dado `problem({ status: 500 })` sem `type`, o corpo contém `"type": "about:blank"` e não contém a chave `instance`.

### RF-04 — Resposta em `application/problem+json`

Uma resposta gerada por um `HTTPError` criado com `problem()` tem `Content-Type: application/problem+json` e corpo JSON com os membros: `type`, `title` (vindo de `statusText`, omitido se ausente), `status`, `detail` (vindo de `message`) e `instance` (quando informado).

**Critério de aceite**

- **Dado** `problem({ status: 404, statusText: "Not Found", message: "Pedido 42 não existe" })` lançado em uma rota,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status 404, header `content-type` igual a `application/problem+json` (sem sufixo de charset diferente do padrão do h3, a ser fixado na implementação), e corpo `{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Pedido 42 não existe" }`.

### RF-05 — Campos `data` e `body` como extensão

O campo `data` do input é serializado sob a chave `data`, como hoje. Os pares de `body` são espalhados no nível superior do corpo, como hoje, mas não podem sobrescrever os membros reservados (`type`, `title`, `status`, `detail`, `instance`). Se houver colisão, o membro reservado vence.

**Critério de aceite**

- **Dado** `problem({ status: 409, message: "Conflito", data: { campo: "email" }, body: { status: 999, codigo: "DUP" } })`,
- **Quando** a resposta é serializada,
- **Então** o corpo contém `"data": { "campo": "email" }`, `"codigo": "DUP"` no nível superior, e `"status": 409` (o membro reservado prevalece sobre `body.status`).

### RF-06 — Erros `unhandled` não vazam detalhes

Quando o `HTTPError` criado por `problem()` tem `unhandled: true`, o `detail` e o `data` não são enviados, seguindo a regra que já existe para erros não tratados. O `status` e o `type` continuam presentes.

**Critério de aceite**

- **Dado** um `problem({ status: 500, unhandled: true, message: "senha do banco vazou", data: { x: 1 } })` com a aplicação em modo não-debug,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém `detail` nem `data`, e contém `status: 500` e `type: "about:blank"`.

### RF-07 — Headers adicionais preservados, `Content-Type` fixado

Headers passados em `input.headers` vão para a resposta. O `Content-Type` é sempre `application/problem+json`, mesmo que o input tente informar outro.

**Critério de aceite**

- **Dado** `problem({ status: 401, headers: { "www-authenticate": "Bearer", "content-type": "text/plain" } })`,
- **Quando** a resposta é gerada,
- **Então** a resposta tem o header `www-authenticate: Bearer` e o `content-type` é `application/problem+json`.

### RF-08 — Compatibilidade: erros existentes não mudam

Qualquer erro que não foi criado por `problem()` (incluindo `HTTPError.status(...)`, `new HTTPError(...)`, erros lançados pelo próprio h3 e `throw` de `Error` comum) continua sendo serializado exatamente como antes, com o mesmo `Content-Type` e o mesmo corpo.

**Critério de aceite**

- **Dado** um handler que faz `throw HTTPError.status(404, "Not Found", { message: "x" })`,
- **Quando** a requisição é processada,
- **Então** a resposta tem `content-type` `application/json` (como antes) e corpo com os mesmos campos de hoje.

### RF-09 — Um único novo nome público além de `problem`

Além de `problem`, a feature adiciona apenas um nome público: o tipo da entrada de `problem()`. Nenhum outro tipo, helper, constante ou subpath é exportado.

**Critério de aceite**

- **Dado** o conjunto de exports de `h3` antes e depois da mudança,
- **Quando** os dois são comparados,
- **Então** a diferença é exatamente `problem` (valor) e o nome do tipo da entrada (tipo).

### RF-10 — Qualidade e suíte existente

Testes de cobertura da feature usam `describeMatrix` (web e node). A suíte existente continua passando; testes existentes só podem ser ajustados se dependerem diretamente do que a mudança altera, preservando o que eles verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** rodamos `pnpm vitest run` e `pnpm lint`,
- **Então** os testes passam nos dois modos (web e node) e o lint/typecheck não reporta erros.

## Fora de escopo

- Alterar o formato de erro padrão do h3 para RFC 9457 em todas as rotas.
- Negociação de conteúdo por `Accept` (sempre `application/problem+json` para erros criados por `problem()`).
- Registrar, validar ou resolver URIs de `type`; o h3 apenas repassa o valor informado.
- Catálogo de tipos de erro ou tradução de mensagens.
- Integração com Nitro (o issue cita h3/nitro, mas o contrato é só do h3).
- Problem details em WebSocket, SSE ou JSON-RPC.
- Novos exports além de `problem` e do tipo da entrada (RF-09).
- Mudança no `HTTPError` existente ou nos seus campos.

## Premissas e riscos

### Premissas

- A marcação "este erro deve sair como problem details" é interna ao módulo (por exemplo, um símbolo `k`-prefixado ou propriedade `~`-prefixada conforme a convenção do projeto), não um export público.
- O ponto de serialização é `errorResponse` em `src/response.ts`; a mudança é um ramo nesse caminho, sem alterar a ordem de hooks `onError`/`onResponse`.
- `title` é omitido quando `statusText` não é informado. A RFC recomenda `title`, mas não o torna obrigatório; gerar um texto padrão por status é fora de escopo.
- `about:blank` é emitido explicitamente quando `type` não é informado, para o corpo ser autodescritivo.
- Erros `unhandled` seguem a mesma regra de ocultação de hoje (depende do modo debug).

### Riscos

- **Colisão de membros:** `body` pode trazer chaves como `type` ou `title`. A RF-05 define que o membro reservado vence; é preciso testar isso explicitamente.
- **Vazamento de detalhes:** se a regra de `unhandled` não for reaproveitada corretamente, `detail` pode expor mensagens internas. Coberto pela RF-06.
- **Mudança silenciosa:** um erro criado por `problem()` que passa por middleware que reescreve o corpo (por exemplo, `onResponse` que lê o JSON) pode ter comportamento diferente. Vale verificar na implementação.
- **Charset:** o h3 usa `application/json;charset=UTF-8` por padrão; a forma exata do `Content-Type` de `problem+json` precisa ser decidida na implementação e refletida no teste da RF-04.
- **Superfície pública:** a restrição de um único novo nome (RF-09) limita a API; se surgir necessidade de um tipo de saída ou de um helper, isso exige revisão do contrato.
