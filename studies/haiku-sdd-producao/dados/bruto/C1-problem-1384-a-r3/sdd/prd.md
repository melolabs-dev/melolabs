# PRD — Problem details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

Hoje o h3 responde erros HTTP com um corpo JSON próprio (`message`, `data`, `body`, `statusText`). A RFC 9457 (Problem Details for HTTP APIs) define um formato padronizado para esses erros, com o media type `application/problem+json`, que clientes e ferramentas genéricas conseguem interpretar sem conhecer o formato de cada API.

O objetivo é permitir que a aplicação h3 responda erros no formato problem details. A troca é ligada por uma opção de configuração da aplicação. Sem a opção, o comportamento atual não muda.

Fora do objetivo: mudar o formato padrão, definir um registro de tipos de problema ou integrar com o Nitro neste ciclo.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação pode ativar o formato problem details pela opção booleana `problemDetails` em `H3Config`. O valor padrão é `false`. A opção é lida de `app.config`, como as demais opções.

- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** consulto `app.config.problemDetails`,
- **Então** o valor é `false`.

- **Dado** uma aplicação criada com `problemDetails: true`,
- **Quando** consulto `app.config.problemDetails`,
- **Então** o valor é `true`.

### RF-02 — Sem a opção, nada muda

Com `problemDetails` desligada, toda resposta de erro é idêntica à que o h3 produz hoje: mesmo corpo, mesmos headers e mesmo `Content-Type`.

- **Dado** uma aplicação sem `problemDetails` com uma rota que lança `HTTPError` com status 404,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status 404, `Content-Type` `application/json` e o corpo de erro atual, sem os membros `type` e `instance` da RFC 9457.

### RF-03 — Media type e status na resposta de erro

Com `problemDetails` ligada, a resposta de erro usa `Content-Type: application/problem+json` e mantém o status HTTP do erro.

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 422, message: "Dados inválidos" })`,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status 422 e `Content-Type` `application/problem+json`.

### RF-04 — Membros da RFC 9457 no corpo

Com a opção ligada, o corpo JSON contém os membros da RFC 9457:

- `type`: o valor de `HTTPError.type`; quando ausente, `"about:blank"`.
- `title`: o `statusText` do erro, quando definido.
- `status`: o status HTTP do erro.
- `detail`: a `message` do erro, quando não vazia.
- `instance`: o valor de `HTTPError.instance`, quando definido.

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })`,
- **Quando** faço uma requisição para essa rota,
- **Então** o corpo JSON é `{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Usuário não existe" }`.

### RF-05 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`. Os dois são expostos como propriedades da instância. Não há outros nomes públicos novos.

- **Dado** `const err = new HTTPError({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })`,
- **Quando** leio `err.type` e `err.instance`,
- **Então** os valores são `"https://exemplo.com/erros/conflito"` e `"/pedidos/42"`.

- **Dado** `new HTTPError({ status: 500 })` sem `type` nem `instance`,
- **Quando** leio `err.type` e `err.instance`,
- **Então** ambos são `undefined`.

### RF-06 — Erros não tratados não vazam detalhes

Erros marcados como `unhandled` seguem a mesma regra de hoje: a resposta não expõe stack trace, `data`, `body` nem a mensagem original, a menos que o modo `debug` esteja ativo. Com a opção ligada, o `detail` desses erros também segue essa regra.

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança um `Error` comum (não `HTTPError`) com a mensagem "segredo do banco",
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, e o corpo não contém "segredo do banco" nem stack trace.

### RF-07 — Extensões e `data`

Os campos de `body` do erro são incluídos no nível superior do corpo, como extensões permitidas pela RFC 9457. O campo `data` continua sob a chave `data`, como hoje.

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 400, message: "Campo inválido", body: { campo: "email" }, data: { tentativas: 2 } })`,
- **Quando** faço uma requisição para essa rota,
- **Então** o corpo contém `"campo": "email"` no nível superior e `"data": { "tentativas": 2 }`.

### RF-08 — Valer em todos os caminhos de renderização de erro

A opção vale para todo erro renderizado pelo h3, inclusive os que passam por `toResponse` sem a configuração da aplicação (por exemplo, erros de handlers e middlewares chamados diretamente). Nenhum caminho pode voltar ao formato antigo quando a opção está ligada.

- **Dado** uma aplicação com `problemDetails: true` e um middleware que lança `HTTPError` com status 403,
- **Quando** faço uma requisição que passa por esse middleware,
- **Então** a resposta é `application/problem+json` com status 403.

### RF-09 — Headers do erro são preservados

Os `headers` definidos no `HTTPError` continuam sendo enviados na resposta, nos dois modos.

- **Dado** uma aplicação com `problemDetails: true` e um `HTTPError` criado com `headers: { "retry-after": "30" }` e status 503,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem o header `retry-after: 30` e `Content-Type` `application/problem+json`.

### RF-10 — Não-regressão

A suíte de testes existente continua passando. Testes existentes só podem ser ajustados quando dependem diretamente do que esta mudança altera, e sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

- **Dado** o código após a mudança,
- **Quando** executo `pnpm test` (ou `pnpm vitest run` e `pnpm lint`),
- **Então** todos os testes passam e não há erros de lint ou tipo.

## Fora de escopo

- Integração com o Nitro ou com `h3/nitro`.
- Registro ou catálogo de URIs de `type`; o h3 apenas repassa o valor informado.
- Validação semântica de `type` como URI de referência (além do que já for necessário para não quebrar a resposta).
- Localização (i18n) de `title` e `detail`.
- Alterar o formato padrão ou o valor padrão da opção (continua `false`).
- Opção por rota ou por grupo de rotas; a configuração é global da aplicação.
- Formato de erro do JSON-RPC (`src/utils/json-rpc.ts`) e de eventos SSE/WebSocket.
- Compatibilidade com RFC 7807 como formato separado; a RFC 9457 é a norma.
- Documentação extensa fora dos comentários de código e do `AGENTS.md`, se necessário.

## Premissas e riscos

### Premissas

- A opção é lida de `app.config`, como `debug` e `silent`, e chega ao renderizador de erros pela mesma configuração que hoje alimenta `toResponse`.
- `HTTPError.statusText` é o campo usado como `title`.
- `HTTPError.message` é o campo usado como `detail`.
- O media type é exatamente `application/problem+json`, sem parâmetro `charset`, conforme a RFC 9457.
- Os membros `body` viram extensões no nível superior. Se o time preferir aninhá-los, é preciso mudar RF-07 antes de implementar.

### Riscos

- **Caminhos sem configuração.** Hoje `src/handler.ts` e `src/utils/middleware.ts` chamam `toResponse` sem o `config` da aplicação. Se a opção não for propagada, erros desses caminhos saem no formato antigo. Esse é o principal risco de RF-08 e precisa de teste específico.
- **Vazamento em erros não tratados.** Mapear `message` para `detail` pode expor a mensagem de um erro interno. RF-06 cobre isso, mas o teste precisa verificar tanto o modo normal quanto o `debug`.
- **Colisão de extensões.** Se um `body` trouxer `type`, `title`, `status` ou `detail`, o valor pode sobrescrever um membro padrão da RFC. A ordem de precedência precisa ser definida e testada.
- **Quebra de testes existentes.** Testes que checam o corpo ou o `Content-Type` de erros podem falhar quando a opção está ligada em fixtures compartilhadas. Isso deve ser resolvido com o mínimo de ajuste, sem remover asserções.
- **Matriz web/node.** Os testes rodam em dois modos (`describeMatrix`). O formato precisa ser igual nos dois, incluindo headers.
- **Crescimento de API pública.** Adicionar `type` e `instance` a `ErrorInput` e `HTTPError` aumenta a superfície pública. A restrição de "nenhum outro nome público novo" deve ser mantida na revisão.
