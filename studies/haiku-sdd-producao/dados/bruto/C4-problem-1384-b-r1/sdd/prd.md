# PRD — Problem details (RFC 9457) como formato padrão de erro

Base: `sdd/pedido.md` (contrato #1384-B, derivado da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio: `{ status, statusText, unhandled, message, data, ...body }`, com `Content-Type: application/json;charset=UTF-8` (`src/error.ts`, método `HTTPError.toJSON`). Esse formato não segue nenhum padrão e não é reconhecido por clientes e ferramentas que esperam RFC 9457 (Problem Details for HTTP APIs). A issue #1384 pede suporte a esse padrão no h3/nitro.

### Objetivo

Fazer com que todas as respostas de erro do h3 usem o formato "problem details" (RFC 9457, representação JSON) por padrão, sem nenhuma opção de configuração nova, e permitir que `HTTPError` carregue os campos `type` e `instance` da RFC.

### Fora do objetivo imediato

Não há gatilho novo nem opção para escolher o formato. O formato antigo deixa de ser o padrão. Ver "Premissas e riscos".

## Requisitos funcionais

### RF-01 — Respostas de erro no formato problem details

Toda resposta de erro gerada pelo h3 (`HTTPError`, erro lançado por handler, erro de sistema tratado como 500) é um documento JSON com os membros `type`, `title`, `status`, `detail` (quando houver) e `instance` (quando houver), com `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`
- **Quando** a requisição é feita
- **Então** a resposta tem status 404, `Content-Type` começando com `application/problem+json`, e o corpo JSON contém `status: 404`, `detail: "Usuário não encontrado"` e `title` com o texto de status HTTP (`"Not Found"`).

### RF-02 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput` / `ErrorDetails`) aceita os campos opcionais `type` e `instance`, e a instância os expõe como propriedades readonly. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`
- **Quando** a instância é lida
- **Então** `error.type` é `"https://exemplo.com/erros/sem-permissao"` e `error.instance` é `"/pedidos/42"`.

### RF-03 — Valores padrão de `type` e ausência de `instance`

Quando `type` não é informado, o corpo usa `"about:blank"`, valor definido pela RFC 9457 para "sem tipo de problema específico". Quando `instance` não é informado, o membro não aparece no corpo.

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 400` e sem `type` nem `instance`
- **Quando** a resposta de erro é serializada
- **Então** o corpo contém `type: "about:blank"` e não contém a chave `instance`.

### RF-04 — Erros não tratados não vazam detalhes

Quando o erro é marcado como `unhandled`, o corpo não expõe `detail` nem campos de `data`/`body`, como já acontece hoje com `message` e `data`. `title` continua sendo o texto de status HTTP.

**Critério de aceite**

- **Dado** um erro não tratado (`unhandled: true`) com mensagem interna "segredo do banco" e `data: { senha: "x" }`
- **Quando** a resposta é gerada
- **Então** o corpo não contém "segredo do banco" nem "senha", e `title` é o texto de status correspondente (ex.: `"Internal Server Error"`).

### RF-05 — Campos de extensão preservados

Os campos já existentes `data` e `body` continuam aparecendo no corpo como membros de extensão da RFC 9457 (`data` como chave `data`; as chaves de `body` no nível superior), de modo que quem os usa hoje continua recebendo os mesmos valores.

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 422`, `data: { campo: "email" }` e `body: { codigo: "INVALIDO" }`
- **Quando** a resposta é gerada
- **Então** o corpo contém `data: { campo: "email" }` e `codigo: "INVALIDO"` no nível superior.

### RF-06 — Headers do erro continuam sendo enviados

Os headers informados em `HTTPError.headers` (ex.: `WWW-Authenticate`, `Retry-After`) continuam presentes na resposta de erro, ao lado do `Content-Type` novo.

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 401` e `headers: { "WWW-Authenticate": "Bearer" }`
- **Quando** a resposta é gerada
- **Então** a resposta tem o header `WWW-Authenticate: Bearer` e `Content-Type` `application/problem+json`.

### RF-07 — Erros não-`HTTPError` viram problem details 500

Um erro JavaScript comum lançado por um handler (sem `status`) gera uma resposta 500 no mesmo formato, sem expor a mensagem original quando o erro é tratado como interno.

**Critério de aceite**

- **Dado** um handler que lança `new Error("falha inesperada")`
- **Quando** a requisição é feita
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, `type: "about:blank"`, e o corpo segue o mesmo tratamento de erro não tratado definido em RF-04.

### RF-08 — Compatibilidade da suíte existente

A suíte existente continua passando. Testes que afirmam o formato antigo (`message`, `statusText`, `application/json`) são ajustados somente nos pontos que a mudança altera, mantendo o que cada um verifica.

**Critério de aceite**

- **Dado** a suíte de testes após a mudança
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam, e nenhum teste foi removido nem teve a asserção enfraquecida sem substituto equivalente.

### RF-09 — Qualidade estática

O projeto continua passando na checagem de lint e tipos.

**Critério de aceite**

- **Dado** a branch com a mudança
- **Quando** `pnpm lint` é executado
- **Então** termina com sucesso (inclui oxlint, oxfmt --check e a checagem de tipos, conforme `AGENTS.md`).

## Fora de escopo

- Negociação de conteúdo por `Accept` (ex.: devolver JSON simples quando o cliente pede `application/json`). O formato problem details é sempre usado.
- Opção de configuração para manter o formato antigo ou escolher o formato (o pedido diz "sem configuração").
- Registro ou documentação publicada de URIs de `type` (cada `type` é só o valor informado pelo usuário).
- Tradução de `title`/`detail` ou mensagens localizadas.
- Formato de erro do JSON-RPC (`src/utils/json-rpc.ts`) e de erros de WebSocket.
- Mudanças no pacote `h3/tracing` ou em `h3/rules/cache`, exceto a adaptação que a suíte exigir.
- Mudanças no pacote `nitro` (a issue menciona h3/nitro, mas o escopo é o h3).

## Premissas e riscos

### Premissas

- **Mudança de comportamento intencional.** O pedido diz ao mesmo tempo "não quebrar o que já existe" e "o formato passa a ser o padrão de todas as respostas de erro". Interpretação adotada: a assinatura pública de API não quebra (sem nomes removidos ou assinaturas alteradas), mas o corpo e o `Content-Type` das respostas de erro mudam por padrão. Essa mudança é o objetivo declarado.
- **Sem negociação de conteúdo.** Toda resposta de erro usa `application/problem+json`, mesmo que o cliente peça outro tipo.
- **`type` padrão é `about:blank`**, conforme a RFC.
- **`title` vem do texto de status HTTP** (`statusText` ou o texto padrão do código), e `detail` vem de `message`.
- **Campos `data` e `body` são mantidos** como membros de extensão, para não perder informação de quem já os usa.
- **Verificação de tipos** é feita por `pnpm lint`, como indica `AGENTS.md`; o pedido cita `pnpm typecheck`, comando que não aparece na referência rápida de `AGENTS.md`. Se ele existir no `package.json`, roda-se também.

### Riscos

- **Quebra para clientes.** Clientes que leem `message`, `statusText` ou checam `application/json` vão deixar de funcionar sem migração. Não há opção para voltar ao formato antigo; o risco é aceito pelo pedido, mas precisa constar em changelog/notas de release.
- **Vazamento em erros não tratados.** Se a regra de RF-04 não for aplicada também nos caminhos de erro de sistema (RF-07), detalhes internos podem aparecer no corpo. Isso exige testes explícitos para os dois caminhos.
- **Quantidade de testes afetados.** Testes que comparam o corpo completo podem ser numerosos. O risco é ajustar asserções demais e perder o que verificavam (RF-08 pede cuidado com isso).
- **Interação com cache.** Respostas de erro cacheadas (ex.: `h3/rules/cache`, `withCacheIsolation`) podem guardar o formato antigo ou o novo; a mudança precisa ser conferida nesses caminhos.
- **Ambiguidade de `title`.** Quando `statusText` é curto e `message` é longo, o uso de `statusText` como `title` pode divergir do que o usuário espera. Decisão a confirmar com o autor do pedido.
