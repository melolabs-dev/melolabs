# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data` e as propriedades extras de `body`), com `Content-Type` JSON genérico (`src/response.ts`, `errorResponse`; `src/error.ts`, `HTTPError.toJSON`). Esse formato não segue nenhum padrão, então clientes, gateways e ferramentas que entendem a RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretá-lo de forma genérica. Além disso, `HTTPError` não tem como carregar os membros `type` e `instance` da RFC.

### Objetivo
Passar a responder **todos** os erros no formato problem details (representação JSON da RFC 9457), **sem configuração e sem opção nova**, e permitir que `HTTPError` receba e exponha `type` e `instance`. A mudança deve preservar o que já funciona: os membros atuais continuam presentes no corpo como membros de extensão (a RFC permite extensões), de modo que clientes existentes não quebrem.

### Métricas de sucesso
- 100% das respostas de erro geradas pelo h3 têm `Content-Type: application/problem+json` e os membros `type`, `title`, `status`, `detail` (quando aplicável).
- A suíte existente passa, com ajustes só nos testes que dependem do `Content-Type` ou do corpo exato do erro, sem perder o que verificam.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`
Toda resposta de erro gerada pelo h3 usa o media type `application/problem+json` (com `charset=utf-8`, se o formato atual já o inclui).

- **Dado** uma rota que lança `new HTTPError({ status: 400, message: "inválido" })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 400 e o header `content-type` começa com `application/problem+json`.

### RF-02 — Membros padrão da RFC no corpo
O corpo JSON do erro contém `type`, `title`, `status` e `detail`, mapeados assim:

- `type`: o valor informado no `HTTPError`; se ausente, `"about:blank"` (valor padrão da RFC).
- `title`: `statusText` do erro; se ausente, a frase padrão do status HTTP (ex.: "Not Found" para 404), de modo que `title` nunca contradiga o status.
- `status`: o status HTTP da resposta (mesmo número do status line).
- `detail`: o `message` do erro.

- **Dado** uma rota que lança `new HTTPError({ status: 404, message: "Usuário não existe" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não existe"`.

### RF-03 — `HTTPError` aceita e expõe `type` e `instance`
O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance` (strings, URI/URI-reference conforme a RFC). A instância expõe `type` e `instance` como propriedades somente leitura (`undefined` quando não informados). Nenhum outro nome público novo é criado. `HTTPError.status(...)` e a forma `new HTTPError(message, details)` também repassam esses campos via `details`.

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/contas/42" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** retornam exatamente `"https://exemplo.com/erros/sem-permissao"` e `"/contas/42"`; em um erro criado sem esses campos, ambos são `undefined`.

### RF-04 — `type` e `instance` na resposta
Quando informados, `type` e `instance` aparecem no corpo da resposta; `instance` só aparece se informado (não é inventado).

- **Dado** uma rota que lança `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/contas/42" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `type: "https://exemplo.com/erros/sem-permissao"` e `instance: "/contas/42"`; em uma rota que lança erro sem `instance`, a chave `instance` está ausente do corpo.

### RF-05 — Formato é o padrão, sem gatilho
Não há flag, opção de `H3Config`, header de negociação (`Accept`) nem nome público novo para ativar o formato. Toda rota, middleware, hook `onError` e erro não tratado produzem o novo formato.

- **Dado** um `H3` criado sem nenhuma configuração extra
- **Quando** um handler lança erro, um middleware lança erro ou a rota não existe (404)
- **Então** todas as respostas de erro vêm no formato problem details, independentemente do header `Accept` da requisição.

### RF-06 — Compatibilidade: membros atuais preservados como extensões
Os membros do formato atual (`status`, `statusText`, `message`, `data`, `unhandled` e as propriedades de `body`) continuam no corpo, com os mesmos valores e as mesmas regras de omissão de hoje. `message` continua igual a `detail`. `HTTPError.toJSON()` continua retornando esses membros (acrescidos dos novos). Se uma chave de `body` colidir com um membro padrão da RFC (`type`, `title`, `detail`, `instance`, `status`), vale o membro explícito do erro/RFC; a chave de `body` não sobrescreve o status real da resposta.

- **Dado** uma rota que lança `new HTTPError({ status: 422, message: "falhou", data: { campo: "x" }, body: { codigo: "E1" } })`
- **Quando** o cliente faz a requisição
- **Então** o corpo mantém `message: "falhou"`, `data: { campo: "x" }` e `codigo: "E1"` e também traz `detail: "falhou"`, `status: 422` e `title`.

### RF-07 — Erros não tratados continuam sem vazar informação
Para erros `unhandled`, `detail`, `data` e `body` não são expostos (como hoje `message` vira `"HTTPError"` e `data`/`body` são omitidos). `type`, `title` e `status` permanecem; `title` usa a frase padrão do status (500). `instance` e `type` fornecidos pelo código da aplicação em erros `unhandled` não são expostos, pois podem conter detalhes internos. Em modo debug, `stack` continua sendo incluído como hoje.

- **Dado** uma rota que lança `new Error("segredo do banco")` (erro não tratado)
- **Quando** o cliente faz a requisição
- **Então** a resposta é 500 com `application/problem+json`, `status: 500`, `title: "Internal Server Error"`, e nenhuma ocorrência de "segredo do banco" no corpo; sem debug, não há `stack`.

### RF-08 — Headers e status do erro preservados
`status`, `statusText` e `headers` customizados do `HTTPError` continuam sendo aplicados à resposta; o `Content-Type` do problem details prevalece sobre o JSON padrão, mas headers explícitos do erro continuam mesclados como hoje.

- **Dado** uma rota que lança `new HTTPError({ status: 401, statusText: "Não autorizado", headers: { "www-authenticate": "Basic" } })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 401, `statusText` "Não autorizado", header `www-authenticate: Basic` e `title: "Não autorizado"` no corpo.

### RF-09 — Cobertura de testes e atualização da suíte
Há testes (via `describeMatrix`, em `web` e `node`) cobrindo RF-01 a RF-08, incluindo a regressão do item 2 do fluxo de bug fix (falha antes da mudança). Testes existentes que afirmam o `Content-Type` JSON ou o corpo exato de erros são ajustados apenas no necessário, mantendo suas demais verificações.

- **Dado** a suíte completa após a mudança
- **Quando** se executa `pnpm test` (ou `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`)
- **Então** tudo passa, e os testes novos falham se a implementação for revertida.

## 3. Fora de escopo

- Opção, flag ou negociação de conteúdo (`Accept`) para ligar/desligar o formato; formato alternativo (ex.: manter o JSON antigo como escolha).
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro de tipos de problema, URIs de documentação de `type` ou catálogo de erros.
- Novos helpers, funções ou classes públicas além dos campos `type` e `instance` em `HTTPError`/`ErrorInput`.
- Mudanças em `h3/rules`, no pacote Nitro ou em documentação externa; remoção de campos legados ou depreciações novas.
- Validação semântica de `type` (precisa ser URI) e de `instance`.
- Erros que não passam por `HTTPError`/`toResponse` (ex.: respostas de erro feitas manualmente pelo usuário ou vindas de proxy).

## 4. Premissas e riscos

### Premissas
- A representação de extensão da RFC 9457 (§3.2) permite manter `statusText`, `message`, `data` e `unhandled` no mesmo objeto; clientes devem ignorar membros desconhecidos.
- "Não quebrar o que já existe" é interpretado como compatibilidade de **corpo e API** (membros antigos mantidos); a única mudança observável intencional é o `Content-Type` e os membros novos. Se a intenção for substituir também o corpo (remover os legados), isso é uma decisão a confirmar antes da implementação.
- `title` com a frase padrão do status exige uma tabela/função interna de reason phrases (sem nome público novo); a RFC recomenda que `title` seja estável por `type`.
- Os testes `describeMatrix` (web e node) são suficientes para validar a mudança entre runtimes.

### Riscos
- **Quebra de consumidores**: clientes e testes que checam `content-type: application/json` ou usam `res.json()` com checagem estrita de MIME podem falhar. Mitigação: manter o corpo JSON válido com os campos antigos; documentar a mudança de `Content-Type`.
- **Contradição do contrato** ("substitui o formato atual" vs. "não quebrar"): resolvida conforme a premissa acima; revisar com quem pediu.
- **Vazamento em erros não tratados** pelos novos campos (`type`, `instance`, `detail`): coberto por RF-07, com teste obrigatório.
- **Colisão de chaves** entre `body` e membros da RFC: regra de precedência em RF-06.
- **Peso/portabilidade**: tabela de frases de status aumenta o bundle; manter mínima e sem dependências novas (o core deve continuar enxuto).
- **Efeito em Nitro e adaptadores** que dependem do formato de erro: não verificado neste repositório; validar em integração futura.
