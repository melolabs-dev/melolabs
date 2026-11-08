# PRD — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato enxuto #1384-A, issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um corpo JSON próprio (`status`, `statusText`, `message`, `unhandled`, `data`, `stack` em debug), gerado por `errorResponse` em `src/response.ts`, com `Content-Type: application/json`. Quem consome a API e quer seguir o padrão RFC 9457 ("problem details for HTTP APIs") não tem como obter esse formato sem escrever um `onError` manual para cada aplicação.

### Objetivo

Permitir que a aplicação escolha responder erros no formato RFC 9457 (`application/problem+json`) por meio de uma opção de configuração. Com a opção desligada, que é o padrão, nada muda para quem já usa o h3.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A opção booleana `problemDetails` existe em `H3Config`, vem desligada por padrão e é lida de `app.config` como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`
- **Quando** `app.config.problemDetails` é consultado
- **Então** o valor é `false` ou ausente, e o comportamento de erro é o atual.

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`
- **Quando** um handler lança um erro
- **Então** a resposta usa o formato do RF-02.

### RF-02 — Erros em `application/problem+json`

Com `problemDetails` ligado, toda resposta de erro (4xx/5xx gerada a partir de `HTTPError`, incluindo erros não tratados convertidos por `toError`) tem `Content-Type: application/problem+json` e corpo JSON no formato RFC 9457.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`
- **Quando** a rota é chamada
- **Então** a resposta tem status `404`, header `content-type` igual a `application/problem+json` e o corpo JSON contém `status: 404`.

- **Dado** a mesma aplicação
- **Quando** um handler lança um `Error` comum
- **Então** a resposta tem status `500` e `content-type: application/problem+json`.

### RF-03 — Members RFC 9457 no corpo

O corpo de erro, com a opção ligada, contém:

- `type`: valor informado no `HTTPError`; quando ausente, `"about:blank"`.
- `title`: o `statusText` do erro, quando definido.
- `status`: o status HTTP do erro.
- `detail`: a `message` do erro.
- `instance`: valor informado no `HTTPError`, quando definido.

Os members `data`, `body` (espalhado no nível superior) e `stack` (somente em `debug`) continuam sendo emitidos como members de extensão, como hoje.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido", type: "https://exemplo.com/erros/validacao", instance: "/pedidos/42" })` lançado em uma aplicação com `problemDetails: true`
- **Quando** a rota é chamada
- **Então** o corpo JSON é `{ type: "https://exemplo.com/erros/validacao", title: "Unprocessable Content", status: 422, detail: "Campo inválido", instance: "/pedidos/42" }`, acrescido de `data` e `body` se o erro os tiver.

- **Dado** um `HTTPError` sem `type` e sem `statusText`
- **Quando** a resposta é renderizada com `problemDetails: true`
- **Então** `type` vale `"about:blank"` e `title` não aparece no corpo.

### RF-04 — `HTTPError` aceita e expõe `type` e `instance`

O construtor de `HTTPError` aceita, no objeto de entrada, os campos opcionais `type` e `instance`. Eles são expostos como propriedades `readonly` da instância, do mesmo modo que `statusText` e `data`. Nenhum outro nome público é adicionado.

**Critério de aceite**

- **Dado** `const err = new HTTPError({ status: 409, type: "https://exemplo.com/conflito", instance: "/recurso/1" })`
- **Quando** `err.type` e `err.instance` são lidos
- **Então** valem `"https://exemplo.com/conflito"` e `"/recurso/1"`.

- **Dado** `new HTTPError("Erro", { status: 400 })`
- **Quando** `err.type` e `err.instance` são lidos
- **Então** ambos valem `undefined`.

### RF-05 — Erros não tratados continuam ocultos

Quando `unhandled` é verdadeiro, o formato RFC 9457 não expõe `detail` (a mensagem real), `data` nem `body`, como já acontece hoje com `message` e `data`. `detail` recebe o mesmo valor genérico que `message` recebe hoje (`"HTTPError"`).

**Critério de aceite**

- **Dado** um erro não tratado (`unhandled: true`) com `message: "senha do banco incorreta"` em uma aplicação com `problemDetails: true`
- **Quando** a resposta é renderizada
- **Então** o corpo tem `detail: "HTTPError"`, não contém a string `"senha do banco incorreta"` e não contém `data`.

### RF-06 — Sem a opção, nada muda

Com `problemDetails` desligado (padrão), a resposta de erro é idêntica à atual: mesmo `Content-Type`, mesmos members e mesmos valores. Ter `type` ou `instance` no `HTTPError` não altera a resposta nesse caso.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e um `HTTPError` com `type` e `instance` definidos
- **Quando** a rota lança esse erro
- **Então** o corpo continua sendo o JSON atual (`status`, `statusText`, `unhandled`, `message`, `data`, extensões de `body`), sem `type`, `instance` nem `title`, e o `Content-Type` continua `application/json;charset=UTF-8`.

- **Dado** a suíte existente de testes
- **Quando** `pnpm vitest run` é executado sem alterações nos testes
- **Então** todos os testes passam.

### RF-07 — Compatibilidade com `onError`, headers de erro e modo debug

Com `problemDetails` ligado, `onError` continua sendo chamado antes da renderização, os headers do `HTTPError` e os headers staged em `event.res` como erro continuam sendo aplicados, e `stack` aparece somente com `debug: true`, como hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`, `debug: true` e um erro com `headers: { "x-erro": "1" }`
- **Quando** a rota lança o erro
- **Então** a resposta tem `content-type: application/problem+json`, o header `x-erro: 1` e o corpo contém `stack` como array de linhas.

- **Dado** a mesma aplicação com `debug` desligado
- **Quando** a rota lança o erro
- **Então** o corpo não contém `stack`.

## Fora de escopo

- Negociação de conteúdo por `Accept` (ex.: escolher `application/problem+json` só quando o cliente pede). A escolha é só pela opção.
- Opção por rota ou por handler; a opção é global da aplicação.
- Formato de problem details para erros de validação com lista de campos (`errors` ou similar) e qualquer member de extensão novo além dos já existentes.
- Registro ou documentação de URIs de `type`; o h3 só repassa o valor informado.
- Integração específica com Nitro, `h3/rules` ou JSON-RPC (`defineJsonRpcHandler` mantém o próprio formato de erro).
- Novos nomes públicos além de `problemDetails` (em `H3Config`), `type` e `instance` (em `HTTPError`).
- Alterações em `pnpm build`, exports do `package.json` ou entradas de runtime.

## Premissas

- A opção fica em `H3Config`, é lida de `app.config` e é a única forma de ativar o formato. Premissa confirmada pelo contrato.
- O corpo RFC 9457 substitui os members padrão (`status`, `statusText`, `message`, `unhandled`) pelos da RFC (`title`, `detail`, `type`, `instance`). O flag `unhandled` deixa de aparecer nesse formato. Se for preferível mantê-lo como extensão, isso muda o RF-03 antes da implementação.
- `data`, `body` e `stack` são preservados como extensões, para não perder informação que a aplicação já envia.
- `type` ausente vira `"about:blank"`, valor padrão da RFC 9457.
- O valor de `type` e `instance` não é validado como URI, porque a RFC aceita referências relativas e o h3 não deve impor política.
- A mudança fica em `src/error.ts` (campos e `toJSON`) e `src/response.ts` (`errorResponse`), com a opção em `src/types/h3.ts`. Não se espera mexer em `src/_entries/*`.
- Os testes novos seguem o padrão `describeMatrix` (web e node).

## Riscos

- **Vazamento em erros não tratados.** Se `detail` ou `title` forem preenchidos a partir da mensagem real de um erro `unhandled`, dados internos podem sair na resposta. Mitigação: RF-05 com teste dedicado.
- **Mudança silenciosa de `toJSON`.** Incluir `type` e `instance` em `HTTPError.toJSON()` sem checar a opção mudaria a resposta padrão. Mitigação: RF-06 e a regra de que a renderização RFC 9457 fica restrita a `errorResponse` com a opção ligada.
- **Clientes que dependem de `message` ou `statusText`.** Quem liga a opção e lê o JSON atual deixa de encontrar esses campos. Mitigação: a opção é desligada por padrão e a mudança de formato fica documentada.
- **Colisão de nomes com `body`.** Se `body` da aplicação trouxer `type`, `title` ou `detail`, a extensão pode sobrescrever um member RFC. Definir a precedência (members RFC prevalecem) e testar.
- **Cache de respostas.** `src/utils/cache.ts` trata respostas de erro sem repassar headers de sucesso; o `content-type` novo pode alterar o que um cache intermediário guarda. Conferir antes de fechar.
- **Teste existente com `content-type` fixo.** Algum teste pode comparar o header de erro com `application/json`. Só esses testes podem ser ajustados, preservando o que verificam (RF-06).
