# PRD — Problem details (RFC 9457) por opção de configuração

Base: issue h3js/h3#1384 e contrato #1384-A (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros pelo corpo JSON próprio (`message`, `data`, `body`, `statusText`, ...). Quem consome a API e quer seguir a RFC 9457 (Problem Details for HTTP APIs) precisa montar essa resposta manualmente em `onError` ou em cada rota, e o `HTTPError` não tem como carregar os campos `type` e `instance` que a RFC define.

### Objetivo

Permitir que a aplicação h3 responda erros no formato "problem details" (`application/problem+json`), ativando uma opção de configuração. A opção fica desligada por padrão, e sem ela nenhum comportamento muda.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação pode ativar o formato problem details com a opção booleana `problemDetails` em `H3Config`. O valor padrão é `false`, e a opção é lida de `app.config` como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** `app.config.problemDetails` é consultado,
- **Então** o valor é `false` (ou `undefined`, tratado como desligado).

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`,
- **Quando** `app.config.problemDetails` é consultado,
- **Então** o valor é `true`.

### RF-02 — `HTTPError` aceita `type` e `instance`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance` da RFC 9457, ambos strings, e a instância os expõe como propriedades somente leitura.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 404, message: "Not found", type: "https://example.com/probs/missing", instance: "/orders/42" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` é `"https://example.com/probs/missing"` e `error.instance` é `"/orders/42"`.

- **Dado** `new HTTPError({ status: 400, message: "Bad" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` e `error.instance` são `undefined`.

### RF-03 — Corpo de erro em problem details quando a opção está ligada

Com `problemDetails: true`, a resposta de erro gerada pelo h3 usa `Content-Type: application/problem+json` e um corpo JSON com os membros da RFC 9457 mapeados a partir do `HTTPError`:

| Membro RFC | Origem |
| --- | --- |
| `type` | `error.type`, ou `"about:blank"` quando ausente |
| `title` | `error.statusText`, omitido quando ausente |
| `status` | `error.status` |
| `detail` | `error.message`, omitido quando vazio |
| `instance` | `error.instance`, omitido quando ausente |

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e a rota `app.get("/orders/:id", () => { throw new HTTPError({ status: 404, statusText: "Not Found", message: "Pedido não existe", type: "https://example.com/probs/missing", instance: "/orders/42" }) })`,
- **Quando** o cliente faz `GET /orders/42`,
- **Então** a resposta tem status `404`, `Content-Type` começando com `application/problem+json`, e o corpo JSON é `{ "type": "https://example.com/probs/missing", "title": "Not Found", "status": 404, "detail": "Pedido não existe", "instance": "/orders/42" }`.

- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `new HTTPError({ status: 500 })` sem `type` nem `instance`,
- **Quando** o cliente faz a requisição,
- **Então** o corpo contém `"type": "about:blank"` e `"status": 500`, e não contém `instance`.

### RF-04 — Sem a opção, a resposta de erro não muda

Quando `problemDetails` está desligado (padrão), a resposta de erro continua igual à atual: mesmo `Content-Type`, mesmo corpo JSON e mesmos headers. Os campos `type` e `instance` de `HTTPError`, quando informados, não alteram a resposta.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e a mesma rota do RF-03 que lança `HTTPError` com `type` e `instance`,
- **Quando** o cliente faz `GET /orders/42`,
- **Então** o `Content-Type` não é `application/problem+json` e o corpo é idêntico ao que a versão atual do h3 produz para o mesmo `HTTPError` sem `type` e `instance`.

- **Dado** a suíte de testes existente,
- **Quando** `pnpm vitest run` roda sem alterações de configuração,
- **Então** todos os testes que já passavam continuam passando.

### RF-05 — Headers e sanitização continuam valendo

Os `headers` do `HTTPError` continuam sendo enviados na resposta em problem details, e `statusText` e `status` passam pelas mesmas sanitizações já aplicadas hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um `HTTPError` com `headers: { "retry-after": "120" }` e `statusText` contendo um caractere de controle inválido,
- **Quando** a resposta é gerada,
- **Então** o header `retry-after: 120` está presente e o `title` no corpo é o mesmo valor que a sanitização atual produziria para o `statusText`.

### RF-06 — Erros não tratados não vazam detalhes

Erros não tratados (`unhandled: true`) seguem a regra atual: em problem details, `detail` e os demais campos que hoje são ocultados continuam ocultos, e a resposta usa apenas o status 500 e os membros não sensíveis.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `new Error("senha do banco: x")` (erro não tratado) e `debug` desligado,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, e o corpo não contém a string `"senha do banco"` nem stack trace.

### RF-07 — Hooks `onError` e `onResponse` continuam funcionando

O `onError` configurado pela aplicação continua recebendo o `HTTPError` (incluindo `type` e `instance`) e pode alterar a resposta como hoje. O `onResponse` continua sendo chamado com a resposta final, em problem details ou não.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `onError` que registra o erro recebido,
- **Quando** um handler lança `HTTPError` com `type` definido,
- **Então** `onError` recebe um objeto cujo `type` é o valor informado, e `onResponse` é chamado uma vez com a resposta final de status de erro.

## Fora de escopo

- Integração com `h3/nitro` (a issue cita nitro, mas este contrato é só do h3).
- Negociação de conteúdo por `Accept` (ex.: problem details só quando o cliente pede `application/problem+json`).
- Membros de extensão além dos definidos no RF-03 (ex.: campos próprios por tipo de erro), inclusive o mapeamento automático de `data` e `body` para membros de extensão.
- Validação ou resolução das URIs de `type` (sem registro de problem types, sem links de documentação).
- Mudar o formato padrão do h3 ou criar uma nova função utilitária pública (o contrato proíbe novos nomes públicos além de `problemDetails`, `type` e `instance`).
- Reescrever `HTTPError` ou o pipeline de respostas além do necessário para o formato novo.
- Suporte a RFC 7807 com formatos antigos (sem `about:blank` ou sem `application/problem+json`).

## Premissas e riscos

### Premissas

- A opção vai para `H3Config` e é lida de `app.config`, como `debug`, `silent` e `allowMalformedURL` já são (ver `src/types/h3.ts`).
- `HTTPError` já tem `status`, `statusText`, `message`, `headers`, `data`, `body` e `unhandled` (ver `src/error.ts`). `type` e `instance` são os únicos campos novos na classe.
- O mapeamento do RF-03 (`title` ← `statusText`, `detail` ← `message`) é a escolha deste PRD. Se o time preferir outra origem para `title`, o RF-03 muda antes da implementação.
- Os campos `data` e `body` não entram no corpo em problem details neste contrato (ficam fora de escopo). Esta é uma decisão a confirmar.
- O comportamento de `debug` (stack trace) em problem details segue o que já existe hoje; este PRD não o altera.
- A verificação segue o `AGENTS.md`: teste de regressão antes da mudança, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` passando.

### Riscos

- **Quebra silenciosa de consumidores:** se a mudança em `HTTPError` alterar `toJSON`, propriedades enumeráveis ou o corpo padrão, aplicações existentes podem quebrar mesmo sem a opção. Mitigação: RF-04 com teste de regressão comparando o corpo antes e depois.
- **Vazamento em erros não tratados:** o formato novo cria um caminho de serialização paralelo, que pode expor `message` ou stack de erros não tratados. Mitigação: RF-06 com teste explícito.
- **Testes existentes que dependem da forma do corpo:** a suíte roda em `web` e `node` (`describeMatrix`). Ajustes nos testes existentes são permitidos só quando a mudança altera o que eles verificam, sem perder a verificação original (conforme `sdd/pedido.md`).
- **Tipos públicos:** `ErrorInput`, `HTTPError` e `H3Config` são exportados. Adicionar campos opcionais é compatível, mas `isolatedDeclarations` exige tipos explícitos nas novas propriedades.
- **Ambiguidade de `title`:** se `statusText` for ausente, o membro `title` é omitido, o que diverge de algumas implementações que usam o texto padrão do status. Impacto baixo, mas deve ficar documentado.
