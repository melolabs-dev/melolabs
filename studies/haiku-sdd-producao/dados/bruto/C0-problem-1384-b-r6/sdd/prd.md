# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`src/response.ts`, `errorResponse` + `HTTPError.toJSON()`), com `content-type: application/json`. O corpo tem `status`, `statusText`, `unhandled`, `message`, `data` e as propriedades extras de `body`. Esse formato não segue a RFC 9457, então clientes e ferramentas que entendem "problem details" não o reconhecem. A RFC define os membros `type`, `title`, `status`, `detail` e `instance` e o tipo de mídia `application/problem+json`.

### Objetivo

Fazer todas as respostas de erro geradas pelo h3 seguirem a RFC 9457 (representação JSON), por padrão e sem configuração. Não haverá flag, opção nem gatilho novo. `HTTPError` passa a aceitar os campos opcionais `type` e `instance`.

### Métricas de sucesso

- Toda resposta de erro do h3 sai com `content-type: application/problem+json` e contém `type`, `title` e `status`.
- A suíte existente passa, com ajustes apenas onde um teste depende do formato ou do content-type alterados.
- `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Resposta de erro em `application/problem+json`

O h3 envia toda resposta de erro (`HTTPError` lançado, erro desconhecido, 404, status numérico retornado pelo handler) com o tipo de mídia da RFC 9457. Isso inclui as respostas de erro de middleware e hooks que passam por `errorResponse`.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 400 })`
- **Quando** o cliente recebe a resposta
- **Então** o status HTTP é 400 e o header `content-type` começa com `application/problem+json`.

### RF-02 — Membros padrão da RFC 9457 no corpo

O corpo JSON passa a conter:

- `type`: URI de referência. O valor padrão é `"about:blank"`, conforme a RFC 9457 §4.2.1.
- `title`: resumo curto do tipo do problema. Usa `statusText` quando houver. Sem `statusText`, usa o texto de razão padrão do status HTTP (ex.: "Not Found" para 404), ou `"HTTPError"` se o status não tiver texto padrão.
- `status`: o mesmo código do status HTTP da resposta.
- `detail`: a mensagem do erro (hoje `message`). Não é emitido quando a mensagem for ocultada por erro não tratado (ver RF-05).
- `instance`: emitido somente quando informado (ver RF-03).

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Usuário não existe" })`
- **Quando** o cliente lê o corpo JSON
- **Então** o corpo tem `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não existe"`, e não tem `instance`.

### RF-03 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita `type?: string` e `instance?: string`. Ambos ficam expostos na instância como propriedades `readonly`. Os valores informados são usados no corpo da resposta. Não se cria nenhum outro nome público. `HTTPError.status(...)` e `new HTTPError(mensagem, detalhes)` também aceitam os dois campos, porque usam o mesmo tipo de entrada.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 409, type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })`
- **Quando** o erro é lançado em um handler e a resposta é lida
- **Então** `error.type` e `error.instance` têm os valores informados e o corpo JSON traz os mesmos valores em `type` e `instance`.

### RF-04 — Compatibilidade dos campos atuais

A RFC 9457 permite membros de extensão. Para não quebrar quem já consome o formato atual, os membros existentes continuam presentes: `message` (igual a `detail`), `statusText`, `data` e as propriedades de `body`. Os membros de extensão não podem sobrescrever os membros padrão da RFC (`type`, `title`, `status`, `detail`, `instance`) vindos do `HTTPError`. `toJSON()` retorna o novo formato, com os campos legados mantidos.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 422, message: "inválido", data: { campo: "nome" }, body: { codigo: "E42" } })`
- **Quando** o cliente lê o corpo JSON
- **Então** o corpo tem `message: "inválido"`, `data: { campo: "nome" }` e `codigo: "E42"`, além de `detail: "inválido"` e `status: 422`.

### RF-05 — Erros não tratados continuam sem vazamento

Para erros com `unhandled: true`, a mensagem, o `data` e o `body` continuam ocultos, como hoje. O corpo mantém `type`, `title` e `status`. Não há `detail` com a mensagem original, e `message` segue como `"HTTPError"`. O `stack` só aparece em modo debug, como hoje.

**Critério de aceite**
- **Dado** um handler que lança `new Error("segredo interno")`, com debug desligado
- **Quando** o cliente lê a resposta
- **Então** o status é 500, o corpo tem `type: "about:blank"`, `title: "Internal Server Error"` e `status: 500`, e o texto "segredo interno" não aparece em nenhum campo nem há `stack`.

### RF-06 — Headers e status HTTP preservados

`error.headers` e os headers do hook continuam sendo mesclados na resposta. Se alguém definir um `content-type` próprio por esses headers, esse valor prevalece, como na mesclagem atual. `status` e `statusText` HTTP da resposta não mudam.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 401, headers: { "www-authenticate": "Basic" } })`
- **Quando** o cliente recebe a resposta
- **Então** o header `www-authenticate: Basic` está presente, o status é 401 e o `content-type` é `application/problem+json`.

### RF-07 — Testes e qualidade

Os testes existentes que dependem do formato ou do content-type antigos são ajustados sem perder o que verificam. Entram novos testes para os RF-01 a RF-06 em `test/errors.test.ts`, com `describeMatrix`. Fica escrito um teste de regressão que falha antes da mudança. A documentação de erros (`docs/`) é atualizada, se existir.

**Critério de aceite**
- **Dado** o código com a mudança aplicada
- **Quando** se executa `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** os três comandos terminam com sucesso.

## Fora de escopo

- Qualquer opção, flag ou configuração para ligar, desligar ou escolher o formato (inclusive negociação por `Accept`).
- Representação XML (`application/problem+xml`) da RFC 9457.
- Nomes públicos novos além de `type` e `instance` em `HTTPError`.
- Registro ou hospedagem de URIs de `type` e documentação de tipos de problema por aplicação.
- Mudanças em respostas que não são de erro e no tratamento de JSON-RPC (`json-rpc.ts`), que tem formato de erro próprio.
- Mudanças de código fora do necessário para este PRD; este documento não altera código.

## Premissas e riscos

### Premissas

- "Substitui o formato atual" é lido como: o novo formato vira o único formato emitido, mas mantém os campos legados como extensões (RF-04), para respeitar "não quebrar o que já existe".
- `type` é uma string. O h3 não valida se é uma URI.
- O texto de razão padrão do status vem de uma tabela interna pequena ou de uma função já existente. Não se adiciona dependência.
- O ponto único de emissão é `errorResponse` em `src/response.ts`.

### Riscos

- **Mudança de content-type** de `application/json` para `application/problem+json` pode quebrar clientes que comparam o header com igualdade exata. É uma ruptura inevitável do pedido; fica registrada nas notas de versão. Clientes que usam `response.json()` seguem funcionando.
- **Testes existentes** que comparam o corpo com `toEqual` ou o content-type exato vão falhar e precisam de ajuste (RF-07). Existe risco de enfraquecer a asserção ao ajustar; o ajuste deve manter a verificação equivalente.
- **Colisão de nomes**: `type` ou `instance` em `body` ou em `data` podem colidir com os membros novos. A precedência definida é a dos campos do `HTTPError` (RF-04).
- **Possível conflito entre requisitos do pedido** (formato padrão obrigatório x não quebrar o existente) não tem resolução perfeita, e a decisão tomada aqui é a do primeiro item das premissas.
- **Vazamento de informação** pelo `detail` em erros não tratados; mitigado por RF-05.
