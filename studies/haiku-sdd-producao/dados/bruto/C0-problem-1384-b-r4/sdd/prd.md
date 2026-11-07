# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384, contrato enxuto #1384-B (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros com JSON próprio, gerado por `errorResponse()` em `src/response.ts` a partir de `HTTPError.toJSON()`. O formato é `{ status, statusText, unhandled, message, data, ...body, stack }` com `content-type: application/json`. Esse formato não segue nenhum padrão. Clientes e gateways que entendem a RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretá-lo, e quem precisa do padrão tem de montá-lo à mão em cada handler.

### Objetivo

Fazer todas as respostas de erro do h3 usarem a representação JSON de problem details da RFC 9457. O formato vale por padrão, sem opção de configuração, e substitui o formato atual. `HTTPError` passa a aceitar e expor os campos opcionais `type` e `instance`.

### Métricas de sucesso

- Toda resposta de erro gerada pelo h3 (erro lançado, 404 de rota inexistente, erro inesperado, erro de validação) tem `content-type: application/problem+json` e um corpo com `status` coerente com o status HTTP.
- A suíte existente passa, com ajustes apenas nos testes que dependem do formato alterado.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`

Toda resposta de erro renderizada pelo h3 usa o media type `application/problem+json`, conforme a RFC 9457 §3. Hoje o tipo é `application/json`. O charset segue o padrão atual das respostas JSON do h3.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 400, message: "ruim" })`,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status 400 e o header `content-type` começa com `application/problem+json`, e o corpo é JSON válido.

### RF-02 — Membros padrão do corpo (`type`, `title`, `status`, `detail`)

O corpo de erro segue a estrutura da RFC 9457 §3.1:

- `status`: o status HTTP da resposta.
- `title`: resumo curto e legível do tipo do problema. Usa `statusText` do erro quando existir. Se não existir, usa a frase padrão do status HTTP (por exemplo, `Not Found` para 404).
- `detail`: explicação específica desta ocorrência. Recebe o `message` do erro. Não é emitido quando `message` coincide com `title`, para evitar redundância.
- `type`: referência URI do tipo do problema. Quando o `HTTPError` não define `type`, o membro é omitido, o que equivale a `about:blank` pela RFC.

Os nomes `message`, `statusText` e `unhandled` deixam de ser emitidos no corpo.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" })`,
- **Quando** o cliente faz a requisição,
- **Então** o corpo JSON contém `status: 404`, `title: "Not Found"` e `detail: "Usuário 42 não existe"`, e não contém `type` nem as chaves `message`, `statusText` e `unhandled`.

### RF-03 — Campos opcionais `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance` (strings, referências URI). A instância os expõe como propriedades `readonly type` e `readonly instance`, `undefined` quando não informados. Os nomes `type` e `instance` são os únicos nomes públicos novos. Quando presentes e o erro não é "unhandled", eles saem no corpo (RF-02 e RF-06). Os campos também são lidos de `cause`, como já acontece com `status`, `statusText` e `headers`.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/contas/12/saques/7" })`,
- **Quando** esse erro é lançado por um handler e o cliente recebe a resposta,
- **Então** a instância expõe `error.type` e `error.instance` com esses valores e o corpo JSON traz `type` e `instance` idênticos.

### RF-04 — Extensões: `data` e `body`

Os mecanismos atuais de extensão continuam funcionando, porque a RFC 9457 §3.2 permite membros extras. `body` é espalhado no nível superior do JSON e `data` fica sob a chave `data`, como hoje. Nenhum membro de extensão pode sobrescrever `type`, `title`, `status`, `detail` ou `instance` quando a instância define esses valores. A definição na instância tem precedência.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 422, data: { campo: "email" }, body: { code: "E_VALID" } })`,
- **Quando** o cliente recebe a resposta,
- **Então** o corpo contém `data: { campo: "email" }` e `code: "E_VALID"` no nível superior, junto de `status: 422`.

### RF-05 — Erros não tratados continuam sem vazar informação

Para erros "unhandled" (exceções inesperadas), o corpo continua omitindo mensagem original, `data` e `body`. O corpo emite apenas `status` e `title` genérico (`Internal Server Error` para 500), sem `detail`, `type` nem `instance`. Isso mantém o comportamento de segurança atual, em que `message` vira o texto genérico `"HTTPError"`. O stack só aparece no modo `debug`, como hoje.

**Critério de aceite**
- **Dado** um handler que lança `new Error("senha do banco: x")`,
- **Quando** o cliente faz a requisição com `debug` desligado,
- **Então** a resposta é 500 com `content-type: application/problem+json`, o corpo tem `status: 500` e `title: "Internal Server Error"`, e a string `senha do banco` não aparece em nenhum ponto do corpo.

### RF-06 — Modo `debug` e headers de erro preservados

Com `debug` ligado, o corpo continua trazendo `stack` (lista de linhas) e a indentação JSON atual. Headers vindos de `error.headers` e dos headers de erro do evento continuam mesclados na resposta. O `content-type` do problem details prevalece sobre qualquer `content-type` vindo desses headers apenas se eles não o definirem. Se os headers do erro definirem `content-type`, vale o valor do erro, como hoje.

**Critério de aceite**
- **Dado** um app com `debug: true` e um handler que lança `new HTTPError({ status: 500, headers: { "x-trace": "abc" } })`,
- **Quando** o cliente faz a requisição,
- **Então** a resposta traz o header `x-trace: abc`, o corpo contém `stack` como array de strings e o `content-type` é `application/problem+json`.

### RF-07 — Todos os caminhos de erro usam o novo formato

O formato vale para todos os pontos que hoje passam por `errorResponse()`:

- erro lançado por handler ou middleware;
- 404 de rota inexistente;
- `throw 404` (número);
- erros de validação e de limite de corpo;
- erro devolvido ou transformado por `onError`.

Respostas que o usuário monta explicitamente (um `Response` próprio ou `HTTPResponse`) não são alteradas.

**Critério de aceite**
- **Dado** um app sem a rota `/nada`,
- **Quando** o cliente faz `GET /nada`,
- **Então** a resposta é 404 com `content-type` `application/problem+json` e corpo com `status: 404`, `title: "Not Found"` e `detail` contendo `Cannot find any route matching`.

### RF-08 — Ajuste dos testes existentes

Os testes existentes que afirmam o formato antigo (chaves `message`, `statusText`, `unhandled`, ou `content-type: application/json` em respostas de erro) são ajustados para o novo formato, mantendo o que cada um verifica (status, vazamento de dados, headers, `data`/`body`). Não se removem testes nem se afrouxam asserções. Testes novos cobrem RF-01 a RF-07 usando `describeMatrix`, para rodar nos modos `web` e `node`.

**Critério de aceite**
- **Dado** a suíte completa após a mudança,
- **Quando** `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` são executados,
- **Então** todos passam, e cada teste alterado continua verificando o mesmo comportamento de antes (status, ausência de vazamento, headers e extensões) no novo formato.

## 3. Fora de escopo

- Qualquer opção, flag ou configuração para ligar ou desligar o formato. Não há gatilho nem negociação por header `Accept`.
- Nomes públicos novos além de `type` e `instance` em `HTTPError`. Isso inclui helpers, utilitários e tipos exportados novos.
- Representação XML de problem details (`application/problem+xml`).
- Registro, geração ou hospedagem de páginas de documentação para URIs de `type`.
- Geração automática de `type` ou `instance`.
- Erros de erros em outros contextos: WebSocket, SSE, JSON-RPC (que tem seu próprio formato de erro) e respostas montadas manualmente pelo usuário.
- Mudanças de documentação além do necessário, sem guia de migração. Os arquivos em `docs/` ficam fora desta entrega.
- Alterações no código do projeto durante a fase de PRD. Este documento é só especificação.

## 4. Premissas e riscos

### Premissas

- `title` vem de `statusText` ou da frase padrão do status HTTP. O mapeamento de frases fica em módulo interno, sem exportação pública.
- `detail` recebe o `message` do erro, porque é o que o usuário já escreve para descrever a ocorrência.
- Omitir `type` equivale a `about:blank` (RFC 9457 §4.2.1), então não é preciso emitir `"about:blank"` explicitamente.
- A API de `body` e `data` permanece como mecanismo de extensão (RFC 9457 §3.2).
- O chunk de testes `describeMatrix` (web e node) é suficiente para validar o comportamento nos runtimes suportados.

### Riscos

- **Tensão no contrato: "substitui o formato atual" × "não quebrar o que já existe".** Trocar o formato padrão é, por definição, uma mudança incompatível para clientes que leem `message`, `statusText` ou `unhandled`, e para o `content-type: application/json`. A restrição "não quebrar" é interpretada aqui como: API TypeScript, comportamento de roteamento, status HTTP, headers de erro, segurança de erros não tratados e a suíte (ajustada). A quebra de formato na fiação é consequência pedida pelo contrato e deve ser tratada como breaking change na comunicação de versão. Recomenda-se confirmação do dono do pedido antes da implementação.
- **Consumidores do formato antigo** (clientes front-end, testes de terceiros, Nitro, `onError` que lê `error.toJSON()`) podem quebrar. `toJSON()` de `HTTPError` precisa decidir se muda de forma. A premissa é que ele passa a produzir o formato novo, porque é a fonte da resposta, o que também afeta quem o serializa por conta própria.
- **Perda de informação ao mapear `message` para `detail`** quando `message == title`. A omissão de `detail` nesse caso pode surpreender quem espera sempre o campo. Mitigação: documentar a regra e testá-la.
- **Colisão de extensões com membros padrão** (`body: { title: "x" }`). A regra de precedência do RF-04 evita sobrescrita, mas pode ocultar dados do usuário. Mitigação: testar o caso.
- **Vazamento em erros não tratados.** Qualquer mapeamento novo (`detail`, `type`, `instance`) pode reintroduzir vazamento se esquecer a guarda de `unhandled`. Mitigação: teste explícito de RF-05 com mensagem sensível.
- **Superfície pública:** `isolatedDeclarations` exige tipos explícitos em `type` e `instance`. Adicioná-los a `ErrorBody` ou `ErrorInput` pode ampliar tipos exportados, e o contrato proíbe novos nomes além desses dois.
- **Tamanho de arquivo e convenções:** `error.ts` e `response.ts` já são extensos. Código novo deve ficar em helper interno (`utils/internal/`) para respeitar a meta de arquivos curtos e de não criar exportações novas.
