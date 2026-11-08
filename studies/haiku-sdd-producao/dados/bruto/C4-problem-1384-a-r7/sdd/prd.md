# PRD — Problem details (RFC 9457) por opção de configuração

Origem: issue h3js/h3#1384 e contrato enxuto `sdd/pedido.md` (#1384-A).

## Problema e objetivo

Hoje o h3 responde erros como JSON próprio (`HTTPError.toJSON()` com `Content-Type: application/json`). A issue h3js/h3#1384 pede suporte ao formato "problem details" da RFC 9457, que é o formato padronizado para erros em APIs HTTP.

**Objetivo:** permitir que a aplicação escolha responder erros no formato RFC 9457, ligando uma opção de configuração. Sem a opção, o comportamento atual não muda.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação liga o formato com a opção booleana `problemDetails` em `H3Config`. O padrão é desligado. A opção é lida de `app.config`, como as demais opções (`debug`, `silent`, `onError`).

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails` em `H3Config`,
- **Quando** `app.config.problemDetails` é lido,
- **Então** o valor é `false` ou `undefined`, e nenhuma resposta de erro muda.

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`,
- **Quando** `app.config.problemDetails` é lido,
- **Então** o valor é `true`.

### RF-02 — Erros em formato problem details

Com `problemDetails` ligado, toda resposta de erro (`HTTPError` lançado pela aplicação, erro não tratado convertido em 500 e 404 de rota não encontrada) é serializada como problem details JSON, com `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 422, message: "Dados inválidos" })`,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 422, `Content-Type` igual a `application/problem+json` e corpo JSON com `status: 422` e `detail: "Dados inválidos"`.

- **Dado** uma aplicação com `problemDetails: true` e uma rota inexistente,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 404 e `Content-Type` igual a `application/problem+json`.

### RF-03 — Membros da problem details

O corpo de um erro em problem details contém:

- `type`: o valor de `HTTPError.type`; se ausente, `"about:blank"`;
- `title`: o `statusText` do erro, quando definido;
- `status`: o código HTTP;
- `detail`: a `message` do erro, quando não é erro oculto (ver RF-06);
- `instance`: o valor de `HTTPError.instance`, quando definido.

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 403`, `statusText: "Forbidden"`, `message: "Sem permissão"`, `type: "https://exemplo.com/erros/sem-permissao"` e `instance: "/pedidos/42"`,
- **Quando** a resposta é gerada com `problemDetails: true`,
- **Então** o corpo JSON contém `type: "https://exemplo.com/erros/sem-permissao"`, `title: "Forbidden"`, `status: 403`, `detail: "Sem permissão"` e `instance: "/pedidos/42"`.

- **Dado** um `HTTPError` sem `type`,
- **Quando** a resposta é gerada com `problemDetails: true`,
- **Então** o corpo contém `type: "about:blank"`.

### RF-04 — `HTTPError` aceita `type` e `instance`

`HTTPError` aceita, no objeto de entrada do construtor, os campos opcionais `type` e `instance`. Eles ficam expostos como propriedades somente leitura na instância. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, message: "x", type: "urn:erro:x", instance: "/a" })`,
- **Quando** o erro é inspecionado,
- **Então** `error.type` é `"urn:erro:x"` e `error.instance` é `"/a"`.

- **Dado** `new HTTPError({ status: 400, message: "x" })`,
- **Quando** o erro é inspecionado,
- **Então** `error.type` e `error.instance` são `undefined`.

### RF-05 — Sem a opção, nada muda

Com `problemDetails` desligado (padrão), a resposta de erro é idêntica à atual: mesmo corpo, mesmo `Content-Type: application/json`. Os campos `type` e `instance` de `HTTPError`, quando informados, não aparecem no corpo JSON atual.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e um `HTTPError` com `type` e `instance` definidos,
- **Quando** a resposta de erro é gerada,
- **Então** `Content-Type` é `application/json` e o corpo tem exatamente as chaves que tinha antes da mudança.

### RF-06 — Erros não tratados continuam ocultos

Em modo não debug, um erro não tratado (`unhandled: true`) não expõe `detail` (mensagem) nem o `data`. Os campos `type` e `status` continuam presentes.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug` desligado, e uma rota que lança `new Error("segredo do banco")`,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, e o corpo não contém `"segredo do banco"`.

### RF-07 — Stack trace só em debug

Com `debug: true` e `problemDetails: true`, o corpo inclui `stack`, como já acontece no formato atual. Com `debug` desligado, `stack` não aparece.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug: true`, e um erro lançado pela rota,
- **Quando** a resposta é gerada,
- **Então** o corpo contém a chave `stack`.

- **Dado** a mesma aplicação com `debug` desligado,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém a chave `stack`.

### RF-08 — Headers e `onError` seguem funcionando

Headers de erro (`HTTPError.headers` e `event.res.errHeaders`) continuam sendo aplicados. O hook `onError` continua recebendo o erro e pode substituir a resposta, como hoje.

**Critério de aceite**

- **Dado** um `HTTPError` com `headers: { "retry-after": "30" }` e `problemDetails: true`,
- **Quando** a resposta é gerada,
- **Então** a resposta contém o header `retry-after: 30` e `Content-Type` `application/problem+json`.

- **Dado** uma aplicação com `problemDetails: true` e `onError` configurado para retornar um `Response` próprio,
- **Quando** um erro ocorre,
- **Então** a resposta retornada por `onError` é a que o cliente recebe.

## Fora de escopo

- Novos nomes públicos além de `problemDetails` (opção), `type` e `instance` (campos de `HTTPError`).
- Extensões RFC 9457 além de `data` e `body` já existentes (ex.: registro de tipos de problema, catálogo de `type`).
- Validação de que `type` é uma URI válida.
- Internacionalização de `title` e `detail`.
- Mudar o padrão de `problemDetails` para `true`.
- Formatos de erro além de JSON (XML, `text/plain` em formato problem).
- Integração com Nitro (repositório separado).
- Alterar o formato de erro quando `problemDetails` está desligado.

## Premissas e riscos

**Premissas**

- `data` e `body` continuam aparecendo no corpo em problem details, como membros extras de topo. Essa escolha mantém compatibilidade com quem já usa esses campos.
- `title` vem de `statusText`. Quando `statusText` não está definido, `title` é omitido.
- O `Content-Type` `application/problem+json` é usado apenas quando a opção está ligada.
- A serialização de problem details fica no mesmo caminho de `errorResponse` em `src/response.ts`; não se cria um novo ponto de renderização.
- O contrato `sdd/pedido.md` é a fonte de verdade para nomes públicos e restrições.

**Riscos**

- **Clientes que leem `application/json`:** quem liga a opção e tem cliente estrito por `Content-Type` pode quebrar. Mitigação: a opção é desligada por padrão e documentada como mudança de formato.
- **Vazamento em erros não tratados:** a mensagem pode ir para `detail` por engano. Mitigação: RF-06 com teste explícito.
- **Testes existentes:** asserções sobre `content-type` ou sobre o corpo de erro podem depender do formato atual. Mitigação: só ajustar testes que dependem do que mudou, sem perder o que verificam (restrição do pedido).
- **Lint e tipos:** `pnpm lint` e `pnpm typecheck` precisam passar, incluindo `isolatedDeclarations` nos novos campos de `HTTPError`.
- **Regressão em `HEAD` e status sem corpo:** `nullBody` já trata 204/304 e HEAD; a nova serialização não deve alterar esse caminho.
