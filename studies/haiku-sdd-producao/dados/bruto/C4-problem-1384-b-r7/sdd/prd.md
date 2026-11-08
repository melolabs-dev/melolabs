# PRD — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato enxuto #1384-B, derivado da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio, gerado por `HTTPError.toJSON()` e montado em `errorResponse()` (`src/response.ts`). O corpo traz `status`, `statusText`, `message`, `data`, `body` e, em modo debug, `stack`. O `Content-Type` é `application/json`. Esse formato não segue nenhuma norma, então clientes precisam conhecer a forma específica do h3 para tratar erros, e não há um campo padronizado para identificar o tipo do problema nem a ocorrência específica.

### Objetivo

Fazer com que toda resposta de erro do h3 use o formato "problem details" da RFC 9457 (representação JSON), sem nenhuma opção de configuração. Além disso, `HTTPError` passa a aceitar e expor os campos `type` e `instance` da RFC.

Esse objetivo precisa ser cumprido sem quebrar o que já existe: status codes, cabeçalhos customizados de erro, a suíte de testes atual e as APIs públicas continuam funcionando.

## Requisitos funcionais

### RF-01 — Content-Type de problem details nas respostas de erro

As respostas de erro geradas pelo h3 passam a usar `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma rota que lança `HTTPError.status(404)`
- **Quando** a requisição é processada
- **Então** a resposta tem `content-type` igual a `application/problem+json` e o corpo é JSON válido.

### RF-02 — Campos padrão da RFC 9457 no corpo do erro

O corpo JSON de erro contém `type`, `title`, `status`, `detail` e `instance`, mapeados assim:

- `status` ← `status` do erro;
- `title` ← `statusText` (quando ausente, usa o texto padrão do status);
- `detail` ← `message`;
- `type` ← valor informado ou `"about:blank"`, conforme a RFC;
- `instance` ← valor informado, quando existir.

**Critério de aceite**

- **Dado** um erro `new HTTPError({ status: 403, statusText: "Forbidden", message: "Não autenticado" })`
- **Quando** a resposta de erro é serializada
- **Então** o corpo contém `status: 403`, `title: "Forbidden"`, `detail: "Não autenticado"` e `type: "about:blank"`.

### RF-03 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`, e a instância os expõe como propriedades. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 422, message: "Inválido", type: "https://exemplo.com/erros/validacao", instance: "/pedidos/42" })`
- **Quando** a instância é inspecionada
- **Então** `error.type` vale `"https://exemplo.com/erros/validacao"` e `error.instance` vale `"/pedidos/42"`.

### RF-04 — Erros não tratados não vazam detalhes

Para erros marcados como `unhandled`, o corpo não expõe `detail` com a mensagem original, nem `data`, `body` ou `stack`, mantendo a regra de segurança atual.

**Critério de aceite**

- **Dado** um erro não tratado (`unhandled: true`) com mensagem interna "senha do banco inválida"
- **Quando** a resposta é gerada fora do modo debug
- **Então** o corpo não contém a string "senha do banco inválida" nem a propriedade `stack`, e o status é 500.

### RF-05 — Stack apenas em modo debug

O campo `stack` só aparece no corpo quando `debug` está ativo, como hoje.

**Critério de aceite**

- **Dado** um app com `debug: true` e um erro qualquer
- **Quando** a resposta de erro é gerada
- **Então** o corpo contém `stack` como lista de linhas.
- **Dado** o mesmo erro com `debug` desligado
- **Quando** a resposta é gerada
- **Então** o corpo não contém `stack`.

### RF-06 — Cabeçalhos e status preservados

Os cabeçalhos informados em `HTTPError.headers` e os cabeçalhos de erro já mesclados pelo h3 continuam sendo enviados, e o status HTTP não muda.

**Critério de aceite**

- **Dado** um erro `HTTPError.status(429, "Too Many Requests", { headers: { "retry-after": "30" } })`
- **Quando** a resposta é gerada
- **Então** o status é 429, o cabeçalho `retry-after` é `30` e o `content-type` é `application/problem+json`.

### RF-07 — Campos de extensão existentes são mantidos

Os campos `data` e `body` do erro continuam aparecendo no corpo, como extensões da RFC 9457 (membros adicionais no nível superior). O campo `message` também continua presente como extensão, espelhando `detail`, para não quebrar clientes que já o leem.

**Critério de aceite**

- **Dado** um erro `new HTTPError({ status: 400, message: "Campo obrigatório", data: { campo: "nome" }, body: { codigo: "E01" } })`
- **Quando** a resposta é gerada
- **Então** o corpo contém `data: { campo: "nome" }`, `codigo: "E01"` no nível superior e `message: "Campo obrigatório"`.

### RF-08 — Suíte existente e qualidade

A suíte de testes existente continua passando. Testes que verificam o formato antigo (por exemplo, `application/json` ou o corpo sem `title`) são ajustados somente nos pontos afetados, sem remover o que eles verificam. Os testes novos seguem `describeMatrix` e rodam nos modos `web` e `node`.

**Critério de aceite**

- **Dado** o branch com a mudança aplicada
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` são executados
- **Então** todos passam, e os testes ajustados mantêm as mesmas verificações de status, mensagem e cabeçalhos.

## Fora de escopo

- Opção de configuração para escolher entre formato antigo e RFC 9457 (o pedido proíbe novo gatilho).
- Novos nomes públicos além de `type` e `instance` em `HTTPError`.
- Mudança de formato de respostas que não são erro (strings, objetos, streams).
- Tradução ou localização dos textos de `title` e `detail`.
- Suporte a extensões de problem details além de `data` e `body` já existentes, e o registro de tipos de problema (`type` URIs próprias).
- Alterações no pacote Nitro ou em outros projetos que consomem o h3.
- Atualização da documentação de usuário fora do `AGENTS.md`, se ela não existir no repositório.

## Premissas e riscos

### Premissas

- A mudança para `application/problem+json` é aceita como padrão para todos os erros, conforme o pedido.
- `statusText` continua sendo o texto curto do status e é usado como `title`.
- `message` é a mensagem longa e vira `detail`; como o campo `message` é mantido por RF-07, consumidores atuais não perdem a informação.
- O tratamento de erros não tratados (`unhandled`) e a flag `debug` já existentes são a base de segurança e não mudam.

### Riscos

- **Quebra de consumidores (médio).** Mesmo com `message` mantido, clientes que checam `content-type: application/json` ou que dependem exatamente do conjunto de chaves do corpo podem quebrar. A tensão entre "não quebrar o que já existe" e "substituir o formato de erro" precisa ser confirmada com o responsável antes do merge.
- **Vazamento de informação (alto se mal implementado).** O mapeamento de `message` para `detail` pode expor texto interno em erros não tratados. RF-04 cobre isso com teste explícito.
- **Testes existentes (baixo a médio).** Vários testes de erro verificam o corpo e o `content-type` antigos. O ajuste deve ser cirúrgico, conforme RF-08.
- **Campo `type` com valor inválido (baixo).** A RFC pede URI; o h3 aceita o valor informado sem validar, o que pode gerar `type` relativo. Decidir se haverá validação ou apenas documentação.
- **Ordem de chaves e tamanho do corpo (baixo).** Acrescentar campos aumenta o payload de cada erro; impacto em benchmarks de erro deve ser observado com `pnpm bench:node`.
