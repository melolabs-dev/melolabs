# PRD: Problem Details (RFC 9457) em erros do h3, ativado por opção

Base: `sdd/pedido.md` (issue h3js/h3#1384 e contrato enxuto #1384-A).

## Problema e objetivo

### Problema

Hoje o h3 responde erros HTTP com um corpo JSON próprio (campos como `status`, `statusText`, `message`, `data`, `body`, `unhandled`, e `stack` em modo debug), gerado por `errorResponse` em `src/response.ts`. Esse formato não segue um padrão. Quem constrói APIs que devem devolver erros padronizados, como pede a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), precisa escrever essa conversão à mão em cada aplicação. A issue h3js/h3#1384 pede suporte nativo a esse formato.

### Objetivo

Permitir que a aplicação escolha responder erros no formato "problem details" (RFC 9457, representação JSON) por meio de uma opção de configuração. Com a opção desligada, que é o padrão, nada muda: o comportamento, o formato e os tipos públicos existentes continuam iguais.

### Fora do problema

Este PRD não muda o padrão do h3, não cria um novo formato de validação e não altera o tratamento de respostas que não são erros.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação ativa o formato por uma opção booleana `problemDetails` em `H3Config`. O valor padrão é desligado. A opção é lida de `app.config`, como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** consulto `app.config.problemDetails`,
- **Então** o valor é `false` ou indefinido, e o comportamento de erro é o atual.

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`,
- **Quando** consulto `app.config.problemDetails`,
- **Então** o valor é `true`.

### RF-02 — Sem a opção, nenhuma resposta de erro muda

Com `problemDetails` desligado ou ausente, toda resposta de erro mantém status, cabeçalhos, `Content-Type` e corpo JSON atuais.

**Critério de aceite**

- **Dado** uma aplicação sem a opção `problemDetails`, com uma rota que lança `HTTPError.status(404, "Not Found")`,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status `404`, `Content-Type: application/json` e o mesmo corpo JSON de antes da mudança.

### RF-03 — Com a opção, o erro sai como problem details

Com `problemDetails` ligado, a resposta de erro é um documento JSON de problem details com o status HTTP correspondente, `Content-Type: application/problem+json` e os campos da RFC 9457: `type`, `title`, `status`, `detail` e `instance`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status `404`, `Content-Type: application/problem+json`, e o corpo JSON contém `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"`, `type: "about:blank"`.

### RF-04 — `HTTPError` aceita `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance` da RFC 9457. Ambos ficam expostos como propriedades da instância.

**Critério de aceite**

- **Dado** um `HTTPError` criado com `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** leio `error.type` e `error.instance`,
- **Então** os valores são `"https://exemplo.com/erros/sem-permissao"` e `"/pedidos/42"`.

- **Dado** um `HTTPError` criado sem `type` nem `instance`,
- **Quando** leio `error.type` e `error.instance`,
- **Então** os valores são indefinidos.

### RF-05 — Erros não tratados continuam sem vazar detalhes

Com a opção ligada, um erro não tratado (`unhandled: true`) não expõe `message`, `data`, `body` nem `stack`, da mesma forma que hoje. O `detail` nesse caso recebe um texto genérico.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new Error("segredo do banco")`,
- **Quando** faço uma requisição para essa rota,
- **Então** a resposta tem status `500`, `Content-Type: application/problem+json`, e nenhum campo do corpo contém o texto `"segredo do banco"`.

### RF-06 — Modo debug continua expondo `stack`

Com `debug: true` e `problemDetails: true` ao mesmo tempo, o corpo de problem details inclui a `stack` como hoje, em forma de array de linhas.

**Critério de aceite**

- **Dado** uma aplicação com `debug: true` e `problemDetails: true`, e uma rota que lança um erro,
- **Quando** faço uma requisição para essa rota,
- **Então** o corpo JSON contém um campo `stack` com as linhas do erro.

### RF-07 — Hooks e cabeçalhos do `HTTPError` seguem válidos

Os hooks `onError` e `onResponse` continuam sendo chamados nos mesmos pontos, e os `headers` informados no `HTTPError` continuam aparecendo na resposta.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`, `onError` registrado, e um `HTTPError` com `headers: { "Retry-After": "120" }`,
- **Quando** faço uma requisição que lança esse erro,
- **Então** `onError` é chamado uma vez, e a resposta contém o cabeçalho `Retry-After: 120`.

### RF-08 — Testes cobrem os dois modos nos dois runtimes

Os testes novos usam `describeMatrix` para rodar em `web` e `node`. Os testes existentes continuam passando sem perda do que verificam.

**Critério de aceite**

- **Dado** a suíte com os testes novos,
- **Quando** executo `pnpm vitest run`,
- **Então** todos os testes passam, e os casos de RF-01 a RF-07 aparecem nos dois alvos (`web` e `node`).

- **Dado** a mudança concluída,
- **Quando** executo `pnpm lint` e `pnpm typecheck`,
- **Então** ambos passam sem erros.

## Fora de escopo

- Integração com Nitro ou com outros frameworks.
- Configuração por rota, por grupo de rotas ou por `routeRules`. A opção é global da aplicação.
- Um novo `Content-Type` configurável ou outros formatos de erro (por exemplo, XML ou `application/xml`).
- Mudança no formato de erros de validação (`readValidatedBody`, `getValidatedQuery` etc.) além do que o RF-03 já cobre por herança de `HTTPError`.
- Tipos de problema padronizados ou um registro de URIs de `type`.
- Localização (i18n) das mensagens.
- Mudança do padrão da opção para `true`.
- Qualquer nome público novo além de `problemDetails`, `type` e `instance`, conforme o contrato.

## Premissas

1. **Mapeamento dos campos.** `status` vem de `status`; `title` vem de `statusText`; `detail` vem de `message`; `instance` vem de `instance` do `HTTPError`; `type` vem de `type` e, se ausente, assume `"about:blank"`, como a RFC prevê. O contrato não define esse mapeamento, então ele é uma escolha desta PRD.
2. **`Content-Type`.** A RFC 9457 define `application/problem+json` como a mídia do formato. A PRD adota esse valor. O contrato não fala de cabeçalho, então isso precisa ser confirmado.
3. **Extensões.** Os campos `data` e `body` do `HTTPError`, quando presentes, são mantidos no corpo de problem details como membros de extensão, porque a RFC permite campos extras. Isso é uma escolha desta PRD.
4. **`title` ausente.** Se `statusText` não for informado, `title` fica de fora do corpo ou recebe o texto padrão do status. A escolha final fica para a implementação, mas precisa ser um dos dois.
5. **`type` e `instance` sem a opção ligada.** Se `type` ou `instance` forem passados a `HTTPError` com `problemDetails` desligado, eles são expostos na instância, mas não entram no corpo JSON atual. Assim o formato antigo não muda (RF-02).
6. **Escopo do `unhandled`.** A regra de não vazar detalhes de erros não tratados vale nos dois modos, e o texto genérico de `detail` segue a mesma lógica do formato atual.

## Riscos

1. **Vazamento de informação.** Se o `detail` de erros não tratados copiar `message` ou `data` por engano, dados internos chegam ao cliente. Mitigação: RF-05 com teste explícito.
2. **Mudança silenciosa no formato antigo.** Adicionar `type` e `instance` ao `toJSON` do `HTTPError` pode mudar a resposta de quem já usa o formato atual. Mitigação: RF-02 e premissa 5, com teste de regressão.
3. **Quebra de tipos.** Incluir `type` e `instance` em `ErrorInput` e `ErrorBody` muda tipos públicos. Mitigação: campos opcionais, verificados com testes de tipo.
4. **Conflito com `data` e `body`.** Se `body` trouxer chaves como `type` ou `status`, elas podem sobrescrever os campos da RFC. Mitigação: definir a precedência na implementação e cobrir com teste.
5. **Confirmação do `Content-Type`.** Se o time preferir manter `application/json`, o RF-03 muda. Esse ponto precisa de decisão antes da implementação.
6. **Complexidade de `errorResponse`.** A função é usada em caminho quente. A ramificação para problem details deve ficar isolada para não penalizar o caminho padrão.
