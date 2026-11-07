# PRD — Problem details (RFC 9457) por opção de configuração

Base: issue h3js/h3#1384 e contrato enxuto `sdd/pedido.md` (#1384-A).

## Problema e objetivo

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data`, mais o `body` do erro), servido como `application/json`. A issue #1384 pede suporte ao formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), que é um padrão para erros de APIs HTTP e usa `application/problem+json`.

**Objetivo:** permitir que a aplicação escolha responder erros no formato RFC 9457, ligando uma opção em `H3Config`. Com a opção desligada (padrão), o comportamento atual não muda. Não é objetivo tornar o formato padrão nem adicionar negociação de conteúdo.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação pode ligar o formato com a opção booleana `problemDetails` em `H3Config`. Ela é lida de `app.config`, como as demais opções, e vale desligada por padrão.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`
- **Quando** `app.config` é consultado
- **Então** `problemDetails` é `false` (ou ausente, tratado como `false`)

- **Dado** uma aplicação criada com `problemDetails: true`
- **Quando** `app.config` é consultado
- **Então** `problemDetails` é `true`

### RF-02 — Sem a opção, nada muda

Com `problemDetails` desligado, a resposta de erro é idêntica à atual: mesmo corpo JSON, mesmo `Content-Type: application/json`, mesmos campos de `HTTPError.toJSON()`.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e uma rota que lança `new HTTPError({ status: 404, message: "Not found" })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status 404, `Content-Type` `application/json` e corpo igual ao gerado por `HTTPError.toJSON()` antes desta mudança

### RF-03 — Resposta de erro em `application/problem+json`

Com `problemDetails` ligado, todo erro renderizado pelo h3 é um objeto JSON com `Content-Type: application/problem+json`, contendo:

- `type` — valor do erro, ou `"about:blank"` quando ausente (padrão da RFC 9457);
- `title` — `statusText` do erro, quando definido;
- `status` — código HTTP da resposta;
- `detail` — `message` do erro;
- `instance` — valor do erro, quando definido.

Campos extras (`data` e os campos de `body`) continuam presentes como membros de extensão.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido" })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status 422, `Content-Type` `application/problem+json` e corpo JSON com `type: "about:blank"`, `title: "Unprocessable Content"`, `status: 422` e `detail: "Campo inválido"`

### RF-04 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`, expostos como propriedades somente leitura da instância. Sem a opção `problemDetails`, esses campos não alteram a resposta.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/forbidden", instance: "/req/1" })`
- **Quando** as propriedades da instância são lidas
- **Então** `error.type` é `"https://example.com/probs/forbidden"` e `error.instance` é `"/req/1"`

- **Dado** `new HTTPError({ status: 403 })`
- **Quando** as propriedades `type` e `instance` são lidas
- **Então** ambas são `undefined`

### RF-05 — Erros não tratados não vazam detalhes

Com `problemDetails` ligado, erros marcados como `unhandled` seguem a mesma regra de hoje: `detail` não expõe a mensagem original, `data` e `body` não aparecem, e o stack trace só aparece com `debug: true`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug` desligado, e uma rota que lança `new Error("segredo interno")`
- **Quando** a rota é requisitada
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, `detail` diferente de `"segredo interno"` e nenhum campo `stack`

### RF-06 — Tipos públicos

As opções e campos novos estão refletidos nos tipos públicos: `problemDetails` em `H3Config` e `type`/`instance` em `ErrorInput`/`ErrorBody` (ou equivalentes que a implementação escolher). Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** o código TypeScript que usa `new H3({ problemDetails: true })` e `new HTTPError({ status: 400, type: "x", instance: "y" })`
- **Quando** `pnpm typecheck` é executado
- **Então** não há erros de tipo

### RF-07 — Compatibilidade da suíte existente

Nenhum teste existente deixa de passar sem motivo. Testes que dependem do que muda devem ser ajustados apenas no que mudou, mantendo o que verificam.

**Critério de aceite**

- **Dado** o repositório depois da mudança
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam, e qualquer teste alterado tem justificativa no diff

### RF-08 — Qualidade estática

**Critério de aceite**

- **Dado** a branch com a mudança
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos passam sem erros

## Fora de escopo

- Ligar `problemDetails` por padrão.
- Negociação de conteúdo por `Accept` (responder JSON simples ou problem details conforme o cliente pede).
- Catálogo de tipos de problema, URIs de documentação ou tipos registrados no IANA.
- Preencher `instance` automaticamente com a URL da requisição.
- Mudar o formato da resposta de erros retornados pelo hook `onError` (esse valor continua sendo renderizado como hoje).
- Integração com Nitro, ou qualquer mudança fora do pacote h3.
- Traduções ou internacionalização de `title` e `detail`.
- Mudar `HTTPError.toJSON()`.

## Premissas

- O campo `title` vem de `statusText` e o campo `detail` vem de `message`. Não há campos novos para isso no `HTTPError`.
- `type` ausente vira `"about:blank"` na resposta, mas `error.type` continua `undefined` na instância.
- Erros de validação (`readValidatedBody` etc.) que já viram `HTTPError` também passam a usar o formato quando a opção está ligada.
- Quando `onError` retorna um valor, esse valor é renderizado como hoje; a opção `problemDetails` só afeta o caminho de renderização padrão do h3.
- `app.config` já é congelado em `_entries/_common.ts`, então a opção não pode ser alterada em tempo de execução.

## Riscos

- **Mudança de `Content-Type`:** clientes que checam `application/json` podem quebrar quando a opção é ligada. Mitigação: a opção é desligada por padrão e a mudança está documentada.
- **Colisão de nomes:** `body` é espalhado no topo do JSON; um `body` com chaves `type`, `title`, `status`, `detail` ou `instance` pode sobrescrever campos padrão. A implementação precisa definir a precedência (sugestão: campos padrão vencem).
- **Vazamento em erros não tratados:** o formato novo pode expor mais campos sem querer. Mitigação: RF-05 e um teste específico.
- **Ambiguidade de `type`:** a RFC prevê `about:blank` como padrão, mas o `type` de `HTTPError` pode ser usado por quem já o define de outra forma. Requer validação com o mantenedor.
- **Alcance de testes:** mudar o `Content-Type` ou a renderização pode afetar testes existentes em `test/` que comparam corpo e cabeçalho; esses ajustes precisam ser feitos com cuidado para não perder o que verificam.
