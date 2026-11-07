# PRD — Problem Details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato enxuto #1384-A).

## Problema e objetivo

Hoje o h3 responde erros HTTP em JSON com um formato próprio, derivado de `HTTPError`. Quem consome a API e espera o padrão [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs) não tem como obtê-lo sem escrever um tratador de erros próprio.

**Objetivo:** permitir que a aplicação escolha responder erros no formato "problem details" (`application/problem+json`), ligando uma opção de configuração. Com a opção desligada, que é o padrão, nada muda.

Fora do objetivo deste PRD: qualquer outra forma de ativar o formato (por rota, por requisição, por header de `Accept`) e novos nomes públicos além dos listados abaixo.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A aplicação pode ativar o formato com a opção booleana `problemDetails` em `H3Config`. A opção é desligada por padrão e é lida de `app.config`, como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** consultamos `app.config.problemDetails`,
- **Então** o valor é `false` (ou ausente, tratado como desligado).

- **Dado** uma aplicação criada com `problemDetails: true`,
- **Quando** uma rota lança um `HTTPError`,
- **Então** a resposta segue o RF-03.

### RF-02 — Campos `type` e `instance` em `HTTPError`

O construtor de `HTTPError` aceita, no objeto de entrada, os campos opcionais `type` e `instance` da RFC 9457. Os valores ficam expostos como propriedades da instância.

**Critério de aceite**

- **Dado** um `new HTTPError({ status: 404, type: "https://example.com/probs/not-found", instance: "/users/42" })`,
- **Quando** lemos `error.type` e `error.instance`,
- **Então** os valores são `"https://example.com/probs/not-found"` e `"/users/42"`.

- **Dado** um `new HTTPError({ status: 404 })` sem `type` nem `instance`,
- **Quando** lemos `error.type` e `error.instance`,
- **Então** ambos são `undefined`, e a construção não falha.

### RF-03 — Resposta em `application/problem+json` quando ativado

Com `problemDetails: true`, um erro tratado pelo h3 responde com `Content-Type: application/problem+json` e corpo JSON com os membros da RFC 9457:

- `type`: valor de `error.type`; se ausente, `"about:blank"`.
- `title`: `error.statusText`, quando definido.
- `status`: `error.status`.
- `detail`: a mensagem do erro (`error.message`), quando não vazia.
- `instance`: valor de `error.instance`, quando definido.

Membros extras do erro (`data`) são incluídos no corpo, sem sobrescrever os membros acima.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe", instance: "/users/42" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status `404`, `Content-Type: application/problem+json` e corpo `{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Usuário não existe", "instance": "/users/42" }`.

- **Dado** a mesma aplicação e um `HTTPError` sem `type`,
- **Quando** a resposta é gerada,
- **Então** o membro `type` do corpo é `"about:blank"`.

### RF-04 — Comportamento inalterado com a opção desligada

Sem `problemDetails` (ou com `false`), as respostas de erro são exatamente as de hoje: mesmo status, mesmo corpo e mesmo `Content-Type`.

**Critério de aceite**

- **Dado** uma aplicação sem a opção `problemDetails`,
- **Quando** uma rota lança `new HTTPError({ status: 400, message: "inválido" })`,
- **Então** a resposta tem o mesmo corpo e `Content-Type` que a versão anterior do h3 produzia, e nenhum membro `type` ou `instance` é adicionado.

- **Dado** a suíte de testes existente,
- **Quando** executamos `pnpm vitest run` sem alterações nos testes,
- **Então** todos os testes que não dependem de `problemDetails` passam.

### RF-05 — Erros que não são `HTTPError` com a opção ligada

Quando `problemDetails` está ligado e a exceção não é `HTTPError`, o h3 responde como erro `500` no mesmo formato, sem expor a mensagem interna da exceção no `detail`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new Error("segredo do banco")`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status `500`, `Content-Type: application/problem+json`, `status: 500` no corpo, e a string `"segredo do banco"` não aparece no corpo.

### RF-06 — Tipagem e qualidade

A opção e os campos novos têm tipos públicos corretos, sem novos nomes exportados além dos descritos aqui, e `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** o código alterado,
- **Quando** executamos `pnpm lint` e `pnpm typecheck`,
- **Então** ambos terminam sem erros.

- **Dado** um usuário que escreve `problemDetails: "sim"` em `H3Config`,
- **Quando** o TypeScript verifica o tipo,
- **Então** há erro de tipo, porque a opção é booleana.

## Fora de escopo

- Ativar o formato por rota, por requisição ou por negociação de conteúdo (`Accept`).
- Extensões de membros além de `type`, `instance` e os campos de `data` (sem tipos próprios por extensão).
- Mudar a forma de `HTTPError` além dos campos `type` e `instance`.
- Mudar o formato padrão (com a opção desligada).
- Integração com Nitro ou outros frameworks que consomem o h3.
- Documentação extensa no site; a alteração do `AGENTS.md` não faz parte deste PRD.

## Premissas e riscos

**Premissas**

- A opção `problemDetails` chega a `app.config` pelo mesmo caminho das demais opções de `H3Config` (ver `src/types/h3.ts`).
- O ponto de geração das respostas de erro é único o suficiente para que o formato seja aplicado em um lugar só (a conversão de erro em resposta, ligada a `toResponse` e aos hooks `onError`).
- `title` vem de `statusText` e `detail` vem de `message`, como mapeamento direto; a RFC não exige essa correspondência, e o PRD a adota por simplicidade.
- `about:blank` é o valor de `type` quando o erro não define um, conforme a RFC 9457.
- "Lida de `app.config` como as demais opções" significa que a opção é lida na criação da aplicação; não há mudança em tempo de execução.

**Riscos**

- **Vazamento de detalhes internos:** com `problemDetails` ligado, erros que não são `HTTPError` podem expor mensagens sensíveis. Mitigado por RF-05.
- **Mudança de contrato para quem liga a opção:** o `Content-Type` e a forma do corpo mudam para essas aplicações. Por isso a opção é desligada por padrão.
- **Conflito com `data`:** um `data` com chaves `type`, `title`, `status`, `detail` ou `instance` pode colidir com os membros da RFC. Mitigado pela regra de RF-03 (membros padrão têm precedência).
- **Respostas já construídas pelo usuário:** um `HTTPResponse` ou `Response` retornado pelo handler não passa pelo formato de erro. Isso deve ser mantido e coberto por teste, para não quebrar quem monta a própria resposta.
- **Testes existentes:** testes que verificam o corpo de erro devem continuar passando sem alteração, já que a opção começa desligada. Se precisarem de ajuste, o ajuste deve manter o que eles verificam, conforme o contrato.
