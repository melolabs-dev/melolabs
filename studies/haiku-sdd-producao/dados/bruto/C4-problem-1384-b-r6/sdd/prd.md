# PRD — Problem details (RFC 9457) como formato padrão de erro

Origem: `sdd/pedido.md` (issue h3js/h3#1384, contrato enxuto #1384-B).

## Problema e objetivo

Hoje o h3 responde erros como JSON com campos próprios (`status`, `statusText`, `unhandled`, `message`, `data`, `body` e, em modo debug, `stack`), com `Content-Type: application/json;charset=UTF-8` (`src/response.ts`, função `errorResponse`; `src/error.ts`, método `HTTPError.toJSON`). Esse formato não segue a RFC 9457, então clientes não têm um contrato padronizado para interpretar erros.

Objetivo: toda resposta de erro gerada pelo h3 passa a usar o formato "problem details" da RFC 9457 (`application/problem+json`), sem nenhuma opção de configuração. `HTTPError` passa a aceitar e expor os campos `type` e `instance` da RFC. Os campos que já existem continuam presentes no corpo, para não quebrar quem já os usa.

## Requisitos funcionais

### RF-01 — Content-Type de erro é `application/problem+json`

- **Dado** uma rota que lança `HTTPError` com status 404
- **Quando** a requisição é processada
- **Então** a resposta tem `Content-Type` começando com `application/problem+json`

### RF-02 — Membros padrão `status`, `title`, `detail` no corpo do erro

- **Dado** um `HTTPError` com `status: 422`, `statusText: "Unprocessable Content"` e `message: "Campo inválido"`
- **Quando** a resposta de erro é gerada
- **Então** o corpo JSON contém `status: 422`, `title: "Unprocessable Content"` e `detail: "Campo inválido"`

### RF-03 — `type` padrão `about:blank`

- **Dado** um `HTTPError` criado sem o campo `type`
- **Quando** a resposta de erro é gerada
- **Então** o corpo JSON contém `type: "about:blank"`

### RF-04 — `type` e `instance` aceitos no construtor e expostos na instância

- **Dado** `new HTTPError({ status: 409, type: "https://example.com/probs/conflito", instance: "/pedidos/42" })`
- **Quando** leio `err.type` e `err.instance`, e gero a resposta de erro
- **Então** `err.type` é `"https://example.com/probs/conflito"`, `err.instance` é `"/pedidos/42"`, e o corpo JSON contém os dois valores

### RF-05 — Campos existentes continuam presentes como extensões

- **Dado** um `HTTPError` com `data: { campo: "email" }` e `body: { codigo: "X1" }`
- **Quando** a resposta de erro é gerada
- **Então** o corpo JSON continua contendo `statusText`, `unhandled`, `message`, `data` e `codigo: "X1"`, além dos membros da RFC 9457

### RF-06 — Membros da RFC prevalecem sobre `body` em caso de colisão

- **Dado** um `HTTPError` com `body: { title: "outro" }` e `statusText: "Conflict"`
- **Quando** a resposta de erro é gerada
- **Então** o corpo JSON tem `title: "Conflict"`, e não `"outro"`

### RF-07 — Erro não tratado não vaza detalhes

- **Dado** uma exceção não tratada por um handler, com mensagem interna "senha inválida"
- **Quando** a resposta de erro é gerada fora do modo debug
- **Então** o corpo tem `status: 500`, `unhandled: true`, `detail: "HTTPError"`, não contém a mensagem interna, nem `data`, `body` ou `stack`

### RF-08 — `stack` apenas em modo debug

- **Dado** um erro gerado com `debug: true`
- **Quando** a resposta de erro é gerada
- **Então** o corpo contém `stack` como lista de linhas
- **E** dado o mesmo erro com `debug` desligado, o corpo não contém `stack`

### RF-09 — Headers do erro são preservados

- **Dado** um `HTTPError` com `headers: { "x-retry-after": "3" }`
- **Quando** a resposta de erro é gerada
- **Então** a resposta contém o header `x-retry-after: 3` e o `Content-Type` é `application/problem+json`

### RF-10 — Respostas de sucesso não mudam

- **Dado** um handler que retorna um objeto
- **Quando** a resposta é gerada
- **Então** o `Content-Type` continua `application/json;charset=UTF-8` e o corpo não muda

### RF-11 — Superfície pública sem nomes novos

- **Dado** o código que usa `ErrorInput`, `ErrorBody` e `HTTPError`
- **Quando** o projeto passa por `pnpm lint` e `pnpm typecheck`
- **Então** `type` e `instance` aparecem como campos opcionais nos tipos, nenhum outro símbolo público é exportado, e ambos os comandos passam

## Fora de escopo

- Alterar o formato de erros do JSON-RPC (`defineJsonRpcHandler`, `defineJsonRpcWebSocketHandler`) e de erros de WebSocket.
- Qualquer opção de configuração para ligar ou desligar o novo formato (o pedido proíbe gatilho).
- Negociação de conteúdo por `Accept` (ex.: devolver o formato antigo para quem pede `application/json`).
- Localização ou tradução de `title` e `detail`.
- Mudanças no pacote `h3/nitro` ou em clientes HTTP.
- Guia de migração extenso (apenas uma nota no changelog, se houver).
- Novos membros de extensão além dos já existentes (`statusText`, `unhandled`, `message`, `data`, `body`, `stack`).

## Premissas

- **P1 — "Não quebrar o que já existe"** é lido como: os campos atuais continuam no corpo (RF-05) e a API pública em TypeScript continua compatível (RF-11). A mudança de `Content-Type` e do formato padrão é a única quebra observável, e é a consequência direta do pedido de formato padrão sem opção.
- **P2 — Todo erro gerado pelo h3** passa por `HTTPError` (incluindo 404 de rota não encontrada e erros de corpo, limite de tamanho e validação), então um único ponto (`toJSON` e `errorResponse`) cobre todos os casos.
- **P3 — `title`** vem de `statusText`. Quando `statusText` não existe, `title` é omitido.
- **P4 — `detail`** vem de `message`.
- **P5 — `type` padrão** é `about:blank`, como a RFC define para quando não há tipo específico.

## Riscos

- **R1 — Quebra para clientes.** Quem verifica `Content-Type: application/json` ou faz parse condicional pode falhar. Mitigação: manter os campos antigos (RF-05) e registrar a mudança no changelog. Confirmar se a entrega deve ir em release major.
- **R2 — Impacto em testes.** Cerca de 105 ocorrências de `application/json`, `toJSON()` ou `.message` em 22 arquivos de `test/`. Ajustar só os testes que dependem do formato de erro (conforme `pedido.md`), sem remover o que eles verificam.
- **R3 — Colisão de chaves.** Um `body` com `type`, `title`, `detail` ou `instance` pode ser sobrescrito ou sobrescrever membros padrão. Mitigação: RF-06.
- **R4 — Vazamento em erros não tratados.** Se `detail` usar a mensagem interna, detalhes sensíveis aparecem na resposta. Mitigação: RF-07.
- **R5 — Superfície de build.** `test/dist.test.ts` verifica a saída do build; mudanças em tipos precisam passar por `pnpm build`.
- **R6 — Interpretação de P1.** Se a intenção de "não quebrar" for manter `application/json` para erros, RF-01 e RF-11 mudam. Ponto a confirmar antes da implementação.

## Pontos a confirmar

1. A quebra de `Content-Type` em erros (R1 / P1) é aceita, ou erros devem continuar `application/json`?
2. A entrega deve ser marcada como breaking change?
