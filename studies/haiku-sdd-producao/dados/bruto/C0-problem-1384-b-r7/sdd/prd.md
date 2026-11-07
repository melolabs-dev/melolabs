# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384, contrato enxuto #1384-B (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros como JSON com `Content-Type: application/json`, no formato próprio
`{ status, statusText, unhandled, message, data, ...body, stack? }` (ver `HTTPError.toJSON()` em
`src/error.ts` e `errorResponse()` em `src/response.ts`). Esse formato não é padronizado: clientes,
gateways e ferramentas que entendem a RFC 9457 (`application/problem+json`) não conseguem
interpretá-lo, e `HTTPError` não tem como carregar os campos `type` e `instance` da norma.

### Objetivo
Fazer todas as respostas de erro do h3 saírem no formato "problem details" da RFC 9457
(representação JSON), por padrão, sem opção de configuração nem gatilho novo. Adicionar a
`HTTPError` os campos opcionais `type` e `instance`. Não criar nenhum outro nome público e não
quebrar o que já existe.

### Métricas de sucesso
- 100% das respostas de erro geradas pelo h3 usam `application/problem+json` e contêm `status`.
- A suíte existente passa, com ajustes apenas nos testes que dependem do que muda (sem perder o que verificam).
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`
Toda resposta de erro produzida pelo h3 (erro lançado, `HTTPError`, erro não tratado, 404 de rota inexistente) usa o tipo de mídia da RFC 9457.

- **Dado** uma rota que lança `new HTTPError({ status: 400 })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 400 e `Content-Type` iniciando em `application/problem+json` (charset UTF-8 mantido), em ambos os modos de teste (`web` e `node`).

### RF-02 — Membros padrão do corpo (`type`, `title`, `status`, `detail`)
O corpo JSON do erro contém os membros definidos pela RFC 9457:
- `type`: URI de referência; `"about:blank"` quando o erro não define `type`.
- `title`: resumo curto do tipo do problema; usa `statusText` quando houver, senão a frase-padrão do status HTTP.
- `status`: o código HTTP (mesmo da resposta).
- `detail`: explicação específica desta ocorrência (a mensagem do erro), omitida quando não aplicável.

- **Dado** uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário 42 não existe"`.

### RF-03 — Campos opcionais `type` e `instance` em `HTTPError`
O objeto de entrada do construtor de `HTTPError` aceita `type?: string` e `instance?: string`, expostos como propriedades `readonly` da instância (`undefined` quando ausentes). Quando definidos, aparecem no corpo da resposta. Também são lidos de `cause` quando esta for um objeto com esses campos, seguindo o padrão já usado para `status`/`statusText`. A assinatura deve funcionar também via `HTTPError.status(...)` e com tipos genéricos (`isolatedDeclarations`).

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-saldo", instance: "/contas/12/saques/7" })`
- **Quando** a instância é inspecionada e o erro é lançado em uma rota
- **Então** `error.type` e `error.instance` têm os valores informados e o corpo da resposta traz `type` e `instance` idênticos.

### RF-04 — Erros sem `type`/`instance` continuam válidos
Erros que não informam `type` ou `instance` produzem corpo válido: `type` = `"about:blank"` e `instance` omitido (nunca `null`).

- **Dado** uma rota que lança `new HTTPError("falhou")` ou `throw 404`
- **Quando** o cliente faz a requisição
- **Então** o corpo tem `type: "about:blank"`, `status` correto e não possui a chave `instance`.

### RF-05 — Erros não tratados não vazam informação
O mascaramento atual de erros `unhandled` é preservado: sem `stack`, `data`, `body` ou mensagem original fora do modo debug. O `detail` de erro não tratado não expõe a mensagem original, e `type`/`instance` vindos de erro não tratado não são emitidos.

- **Dado** uma rota que lança `new Error("segredo interno")` com `debug` desligado
- **Quando** o cliente faz a requisição
- **Então** a resposta é 500 `application/problem+json`, o corpo não contém "segredo interno" nem `stack`.

### RF-06 — Membros de extensão e compatibilidade dos campos atuais
Propriedades de `body` continuam sendo anexadas no nível superior (são os "extension members" da RFC) e `data` continua em `data`. Os campos atuais (`message`, `statusText`, `unhandled`) permanecem no corpo de forma aditiva, para não quebrar consumidores existentes. Membros de extensão não podem sobrescrever `type`, `title`, `status`, `detail` nem `instance` de forma inconsistente com a resposta (`status` do corpo = status HTTP).

- **Dado** `new HTTPError({ status: 422, data: { campo: "email" }, body: { traceId: "abc" } })`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `data.campo === "email"`, `traceId === "abc"`, `status: 422` e os membros RFC 9457 do RF-02.

### RF-07 — Modo debug e cabeçalhos preservados
Em modo `debug`, `stack` continua presente e a saída continua indentada. Cabeçalhos definidos em `HTTPError.headers` e em `event.res.headers` continuam sendo mesclados à resposta de erro; `statusText` HTTP segue sanitizado.

- **Dado** `debug: true` e um erro com `headers: { "x-id": "1" }`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `stack` (array), o cabeçalho `x-id: 1` está presente e o `Content-Type` é `application/problem+json`.

### RF-08 — Todos os caminhos de erro usam o mesmo formato
Os caminhos que hoje serializam erros (`onError`/hooks, adaptadores Node/web, handlers de middleware, `h3/rules`, JSON-RPC quando reutilizam `HTTPError.toJSON()`) permanecem coerentes: o formato novo vale para respostas HTTP de erro; respostas JSON-RPC mantêm seu envelope próprio e não são alteradas além do que `toJSON()` exigir.

- **Dado** um erro gerado por middleware, por rota inexistente ou por falha de validação
- **Quando** o cliente faz a requisição
- **Então** todas as respostas têm `application/problem+json` e os membros do RF-02.

## 3. Fora de escopo
- Qualquer opção de configuração, flag ou gatilho para ligar/desligar o formato (ex.: `problemDetails: true`, negociação via `Accept`).
- Representação XML da RFC 9457 e negociação de conteúdo.
- Novos nomes públicos além de `type` e `instance` em `HTTPError`/`ErrorInput` (sem novas funções, classes ou exports).
- Registro de tipos de problema, URIs de documentação ou catálogo de erros.
- Mudanças no Nitro ou em outros projetos; alteração de `h3/rules` além do necessário para manter coerência.
- Mudar o formato do envelope JSON-RPC.

## 4. Premissas e riscos

### Premissas
- "Não quebrar o que já existe" é lido como compatibilidade **aditiva**: o `Content-Type` e os novos membros mudam, mas `status`, `statusText`, `message`, `data`, `unhandled`, `stack` e extensões de `body` continuam no corpo.
- `title` pode usar `statusText` ou a frase-padrão do status; `detail` recebe a `message` do erro.
- Os testes existentes que afirmam `application/json` ou comparam o corpo exato de erros serão ajustados mantendo a intenção original.
- Mudança de comportamento padrão sem opt-out é decisão do contrato (#1384-B), não deste PRD.

### Riscos
- **Quebra de consumidores**: clientes que checam `Content-Type: application/json` ou comparam o corpo exato de erros deixam de funcionar. Mitigação: manter campos antigos; registrar a mudança nas notas de versão.
- **Conflito de nomes** entre extensões de `body` e membros padrão (`type`, `status`...). Mitigação: RF-06 define a precedência.
- **Redundância/ambiguidade** entre `message`/`detail` e `statusText`/`title`; duplicação aumenta o corpo, mas evita quebra.
- **Vazamento em erros não tratados** ao reaproveitar `toJSON()`. Mitigação: RF-05 com teste dedicado.
- **Efeito em JSON-RPC e `h3/rules`**, que podem reutilizar `toJSON()`. Mitigação: RF-08 e rodar a suíte completa em `web` e `node`.
- **Tipos**: `isolatedDeclarations` e `erasableSyntaxOnly` exigem anotações explícitas nos novos campos; verificar com `pnpm typecheck`.
