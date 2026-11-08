# PRD — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato enxuto #1384-B, derivado da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um corpo JSON próprio, montado por `HTTPError.toJSON()` (`src/error.ts`) e renderizado por `errorResponse` (`src/response.ts`). Esse corpo traz `status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body` espalhados no nível raiz. Não há `Content-Type` padronizado para erros, nem campos que sigam a RFC 9457. Clientes HTTP genéricos não conseguem tratar erros do h3 de forma previsível.

### Objetivo

Fazer com que toda resposta de erro gerada pelo h3 use o formato "problem details" da RFC 9457 (representação JSON), sem configuração adicional. Além disso, `HTTPError` passa a aceitar e expor os campos `type` e `instance` da RFC.

Não-objetivos: criar opção de configuração para escolher o formato, alterar a semântica de status ou headers de `HTTPError`, ou mudar o formato de erro do JSON-RPC.

## Requisitos funcionais

### RF-01 — Content-Type de problem details em respostas de erro

As respostas de erro geradas pelo h3 (`HTTPError`, erros não tratados e 404 de rota não encontrada) devem usar `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma aplicação h3 com uma rota que lança `HTTPError.status(400, "Bad Request")`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 400 e `Content-Type` igual a `application/problem+json` (com charset, se o h3 já o enviar hoje).

### RF-02 — Membros padrão da RFC 9457 no corpo

O corpo de erro deve conter os membros da RFC 9457: `type` (padrão `"about:blank"`), `title` (o `statusText`, ou o texto padrão do status quando ausente), `status` (código HTTP) e `detail` (a `message` do erro).

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 422`, `statusText: "Unprocessable Content"` e `message: "Campo email inválido"`,
- **Quando** a resposta de erro é serializada,
- **Então** o JSON contém `type: "about:blank"`, `title: "Unprocessable Content"`, `status: 422` e `detail: "Campo email inválido"`.

### RF-03 — Campos `type` e `instance` no construtor e na instância de `HTTPError`

`HTTPError` aceita, no objeto de entrada do construtor (e em `HTTPError.status(...)`, via `details`), os campos opcionais `type` e `instance`. Eles são expostos como propriedades readonly da instância e usados no corpo de problem details.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/12" })`,
- **Quando** lemos `error.type` e `error.instance`,
- **Então** os valores são `"https://exemplo.com/erros/sem-permissao"` e `"/pedidos/12"`, e a resposta renderizada contém esses mesmos valores nos membros `type` e `instance`.

### RF-04 — `type` padrão quando ausente

Se `type` não for informado, o corpo deve usar `"about:blank"`, conforme a RFC 9457 §4.2.1. A propriedade `type` da instância fica `undefined` nesse caso, para não alterar o que já existe.

**Critério de aceite**

- **Dado** `HTTPError.status(404, "Not Found")` sem `type`,
- **Quando** a resposta é renderizada,
- **Então** o corpo contém `type: "about:blank"` e `error.type` é `undefined`.

### RF-05 — Erros não tratados continuam sem vazar detalhes

Erros não tratados (não `HTTPError`) continuam sendo respondidos com status 500 e sem mensagem, dados ou stack no corpo. O `detail` deve ser o texto genérico já usado hoje (`"HTTPError"`), e o `title` deve ser o texto padrão do status 500.

**Critério de aceite**

- **Dado** uma rota que lança `new Error("senha do banco: 123")`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, `detail` diferente de `"senha do banco: 123"` e nenhuma stack no corpo.

### RF-06 — Preservar `data`, `body` e `unhandled` como membros de extensão

Os valores de `data` e de `body` continuam aparecendo no corpo de erro, como membros de extensão da RFC 9457 (membros de nível raiz). O campo `unhandled` continua sendo serializado como hoje. Essa preservação reduz quebra para clientes que já leem esses campos.

**Critério de aceite**

- **Dado** `HTTPError.status(409, "Conflict", { message: "Conflito", data: { id: 7 }, body: { motivo: "duplicado" } })`,
- **Quando** a resposta é renderizada,
- **Então** o corpo contém `detail: "Conflito"`, `data: { id: 7 }` e `motivo: "duplicado"` no nível raiz.

### RF-07 — Status e headers de `HTTPError` continuam valendo

O status HTTP e os `headers` informados em `HTTPError` continuam sendo aplicados à resposta, sem mudança de comportamento.

**Critério de aceite**

- **Dado** `HTTPError.status(429, "Too Many Requests", { headers: { "retry-after": "30" } })`,
- **Quando** a resposta é renderizada,
- **Então** a resposta tem status 429 e header `retry-after: 30`, e o corpo segue o formato de problem details.

### RF-08 — Hook `onError` recebe o mesmo `HTTPError`

Com `onError` configurado, o hook continua recebendo o `HTTPError` original. O valor que ele retorna passa pelo mesmo caminho de renderização, então a resposta final também sai em problem details.

**Critério de aceite**

- **Dado** um app com `onError` que retorna `HTTPError.status(418, "I'm a teapot")`,
- **Quando** uma rota lança um erro qualquer,
- **Então** a resposta tem status 418, `Content-Type` `application/problem+json` e `title: "I'm a teapot"`.

### RF-09 — Rota não encontrada responde em problem details

Quando nenhuma rota casa com a requisição, a resposta 404 usa problem details, com `detail` igual à mensagem atual ("Cannot find any route matching ...").

**Critério de aceite**

- **Dado** um app sem rota para `GET /inexistente`,
- **Quando** a requisição é feita,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json` e `detail` contendo `Cannot find any route matching [GET]`.

### RF-10 — Sem novos nomes públicos além de `type` e `instance`

A mudança não adiciona nenhuma exportação, opção de configuração ou função pública nova. A única adição à API pública são os campos `type` e `instance` de `HTTPError`.

**Critério de aceite**

- **Dado** o diff da API pública (exports de `src/index.ts` e entradas de `src/_entries/*.ts`),
- **Quando** comparado com a versão atual,
- **Então** os únicos itens novos são as propriedades `type` e `instance` de `HTTPError`.

### RF-11 — Suíte, lint e typecheck

A suíte de testes existente continua passando. Testes que dependem do formato antigo podem ser ajustados, mantendo o que eles verificam. Testes de regressão novos cobrem RF-01 a RF-09. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** `pnpm test` é executado (lint, typecheck e testes),
- **Então** todos os comandos terminam com sucesso, e cada teste alterado mantém a verificação original do comportamento.

## Fora de escopo

- Erros do JSON-RPC (`src/utils/json-rpc.ts`) continuam no formato próprio do protocolo.
- Registro ou catálogo de URIs de `type` e documentação de tipos de problema específicos da aplicação.
- Opção de configuração para escolher entre formato antigo e RFC 9457.
- Helpers de cliente para ler problem details.
- Erros de WebSocket e de eventos (SSE) que não passam por `errorResponse`.
- Localização (i18n) das mensagens de erro.
- Alteração na semântica de `statusText`, `statusCode` e `statusMessage` (continuam como estão, inclusive os getters deprecados).
- Pacotes `h3/rules` e `h3/tracing`, exceto se algum teste existente depender do formato de erro.

## Premissas e riscos

### Premissas

- **P1.** "Formato padrão sem configuração" significa que o h3 muda o formato de todas as respostas de erro, e essa mudança é intencional. Ela é a parte que quebra clientes; o resto da API pública é preservado.
- **P2.** A regra "não quebrar o que já existe" vale para a API de código (construtor, métodos, getters, exports), não para o corpo HTTP de erro. Interpretamos assim porque o pedido exige que o formato padrão mude.
- **P3.** Manter `data`, `body` e `unhandled` no nível raiz é aceitável, pois a RFC 9457 §3.2 permite membros de extensão. Se o responsável preferir o corpo limpo, esses campos saem e o RF-06 muda.
- **P4.** O `title` usa o `statusText` quando existe; o texto padrão do status é usado só como fallback.
- **P5.** `instance` não recebe valor automático. Só é emitido quando informado.

### Riscos

- **R1 — Quebra para clientes.** Clientes que leem `message` ou `statusText` do corpo continuam funcionando só se os nomes forem mantidos. `message` deixa de existir na raiz (vira `detail`), o que pode quebrar consumidores. Mitigação a decidir: manter `message` como membro de extensão além de `detail`. Essa decisão precisa de confirmação.
- **R2 — Contradição no pedido.** "Não quebrar o que já existe" e "o novo formato substitui o formato de erro atual" puxam em sentidos opostos. Assumimos a leitura de P1 e P2; se o pedido for literal, a mudança de corpo não pode acontecer e o escopo fica diferente.
- **R3 — Vazamento em erros não tratados.** Trocar `message` por `detail` pode reintroduzir texto sensível se o caminho de erro não tratado não for coberto pelos testes (RF-05).
- **R4 — Testes existentes.** Vários testes comparam o corpo JSON inteiro. Ajustá-los sem perder a verificação original exige revisão caso a caso.
- **R5 — `Content-Type` e middlewares.** Clientes ou proxies que filtram por `application/json` podem tratar `application/problem+json` de forma diferente. RF-01 precisa de teste em modo web e node (`describeMatrix`).
- **R6 — Ordem de renderização com `onError`.** O caminho com `onError` renderiza duas vezes (`prepareResponse` recursivo). Headers como `set-cookie` podem duplicar se o `Content-Type` ou os headers forem tratados de forma errada (comentário em `src/response.ts`).
