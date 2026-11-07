# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Referência: issue h3js/h3#1384 e contrato enxuto em `sdd/pedido.md` (variante 1384-B).

## Problema e objetivo

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `unhandled`, `data`, além de campos extras de `body`) e `Content-Type: application/json`. Esse formato não segue um padrão, e clientes precisam conhecer o shape específico do h3 para tratar erros.

**Objetivo:** fazer com que toda resposta de erro produzida pelo h3 use o formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), representação JSON, sem nenhuma opção de configuração. A mudança é do formato padrão; não há um modo alternativo.

## Requisitos funcionais

### RF-01 — Corpo de erro no formato problem details

Toda resposta de erro gerada pelo h3 (erros lançados por handlers, erros internos do roteamento e erros de validação) traz um corpo JSON com os membros da RFC 9457: `type`, `title`, `status`, `detail` e `instance`. O `status` é o código HTTP; `title` vem de `statusText`; `detail` vem da mensagem do erro.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status 404 e o corpo JSON contém `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"` e `type: "about:blank"`.

### RF-02 — Media type `application/problem+json`

As respostas de erro são enviadas com `Content-Type: application/problem+json`. Respostas de sucesso não mudam.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError` com status 400
- **Quando** a rota é requisitada
- **Então** o header `Content-Type` da resposta é `application/problem+json`.
- **E** uma rota que retorna um objeto com status 200 continua respondendo `application/json`.

### RF-03 — `type` e `instance` no construtor e na instância de `HTTPError`

`HTTPError` aceita, no objeto de entrada, os campos opcionais `type` e `instance`, e os expõe como propriedades somente leitura da instância. Quando `type` não é informado, a instância usa `"about:blank"`, valor padrão da RFC. Quando `instance` não é informado, a propriedade fica `undefined` e não é serializada.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })`
- **Quando** leio `error.type` e `error.instance`
- **Então** `error.type` é `"https://exemplo.com/erros/sem-saldo"` e `error.instance` é `"/pagamentos/42"`.
- **E** `new HTTPError({ status: 403 })` tem `type` igual a `"about:blank"` e `instance` igual a `undefined`.

### RF-04 — Membros de extensão preservados

Os campos `data` e `body` continuam sendo enviados no corpo de erro, como membros de nível superior (`data` como membro próprio; os pares de `body` espalhados no topo), conforme a RFC permite extensões.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 422, message: "Inválido", data: { campo: "email" }, body: { codigo: "E_EMAIL" } })`
- **Quando** a resposta é serializada
- **Então** o corpo contém `data: { campo: "email" }` e `codigo: "E_EMAIL"` no nível superior.

### RF-05 — Erros não tratados continuam mascarados

Um erro não tratado pela aplicação (`unhandled`) não expõe a mensagem original, `data` nem `body` no corpo. O `detail` é genérico e o status continua sendo 500 (ou o status atribuído ao erro).

**Critério de aceite**

- **Dado** um handler que lança `new Error("senha do banco: 123")`
- **Quando** a rota é requisitada
- **Então** o status é 500, o corpo tem `status: 500` e `title` e não contém a string `"senha do banco"` em nenhum campo.

### RF-06 — Stack trace somente em modo debug

O campo de stack trace continua aparecendo no corpo apenas quando o modo debug está ativo, como hoje.

**Critério de aceite**

- **Dado** o modo debug desligado e um handler que lança `HTTPError` 400
- **Quando** a rota é requisitada
- **Então** o corpo não contém o campo `stack`.
- **E** com o modo debug ligado, o corpo contém `stack` como lista de linhas.

### RF-07 — Erros gerados pelo próprio h3 usam o mesmo formato

Erros produzidos internamente (rota não encontrada, método não permitido, falha de validação de corpo ou de parâmetros) passam pelo mesmo formato de RF-01 e RF-02.

**Critério de aceite**

- **Dado** uma aplicação sem rota para `/inexistente`
- **Quando** faço `GET /inexistente`
- **Então** a resposta tem status 404, `Content-Type: application/problem+json` e corpo com `status: 404`.

### RF-08 — Compatibilidade da API de programação

A API pública de `HTTPError` mantém as assinaturas existentes: `new HTTPError(message, details)`, `new HTTPError(details)`, `HTTPError.status(...)`, `HTTPError.isError(...)`, `statusCode`, `statusMessage`, `message`, `status`, `statusText`, `headers`, `cause`, `data` e `body`. Código que lança ou captura `HTTPError` continua funcionando sem alteração.

**Critério de aceite**

- **Dado** `new HTTPError("Falhou", { status: 400, data: { x: 1 } })`
- **Quando** leio `error.message`, `error.status` e `error.data`
- **Então** os valores são `"Falhou"`, `400` e `{ x: 1 }`.
- **E** `HTTPError.isError(error)` continua retornando `true`.

### RF-09 — Headers do erro continuam sendo aplicados

Headers passados em `headers` do `HTTPError` continuam na resposta de erro, junto com o `Content-Type` de RF-02.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 401, headers: { "WWW-Authenticate": "Basic" } })`
- **Quando** a rota é requisitada
- **Então** a resposta tem o header `WWW-Authenticate: Basic` e `Content-Type: application/problem+json`.

### RF-10 — Testes e qualidade

A suíte existente passa. Testes existentes que verificam o formato antigo do corpo de erro são ajustados para o novo formato, mantendo o que verificam (status, mensagem, mascaramento de erros não tratados, modo debug). Cobertura nova para RF-01 a RF-07 e RF-09, escrita com `describeMatrix` para valer em modo `web` e `node`. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada
- **Quando** rodo `pnpm test` (lint, typecheck e cobertura)
- **Então** todos os comandos terminam sem erro.

## Fora de escopo

- Opção de configuração para alternar entre o formato antigo e o novo (o pedido proíbe novos nomes públicos de configuração).
- Catálogo de tipos de problema próprios do h3; o `type` padrão é apenas `"about:blank"`.
- Preenchimento automático de `instance` com a URL da requisição.
- Mudança no formato de erros JSON-RPC (`defineJsonRpcHandler`), que segue o próprio protocolo.
- Localização (i18n) das mensagens de erro.
- Integração com Nitro e outros frameworks que consomem o h3.
- Mudança de códigos de status produzidos pelo h3.
- Documentação de site fora do repositório.

## Premissas e riscos

**Premissas**

- "Não quebrar o que já existe" (pedido) é lido como: a API de programação de `HTTPError` não muda (RF-08). A quebra aceita é apenas no corpo e no `Content-Type` das respostas de erro, porque o pedido exige trocar o formato padrão.
- Mapeamento adotado: `statusText` → `title`; `message` → `detail`; `status` → `status`. Quando não há `statusText`, `title` fica ausente; não há tabela de frases de status no h3 para preencher isso.
- Os campos legados `message`, `statusText` e `unhandled` deixam de aparecer no topo do corpo. Presume-se que o pedido prefere o formato limpo da RFC a manter campos antigos.
- `HTTPError.toJSON()` passa a devolver o formato problem details, pois é usado para montar a resposta de erro.
- A mudança é apenas em respostas geradas pelo h3 (via `toResponse`/`errorResponse`), não em erros de `fetch` de clientes.

**Riscos**

- **Quebra para clientes.** Quem lê `message`, `statusText`, `unhandled` ou compara `Content-Type` com `application/json` vai quebrar. Sugestão: registrar como mudança incompatível na release e no changelog.
- **Conflito de termos no pedido.** "Não quebrar o que já existe" e "o novo formato substitui o atual" puxam em direções opostas no corpo da resposta. A leitura adotada está em Premissas; confirmar antes de implementar.
- **Mascaramento.** Ao mudar a montagem do corpo, é fácil vazar `data`, `body` ou a mensagem de erros não tratados. RF-05 cobre isso com teste explícito.
- **Testes existentes.** Vários testes comparam o corpo de erro antigo; a adaptação precisa ser mínima para não perder o que eles verificam (RF-10).
- **Dependências.** O h3 não depende de biblioteca externa para isso; a mudança fica em `src/error.ts` e `src/response.ts`.
