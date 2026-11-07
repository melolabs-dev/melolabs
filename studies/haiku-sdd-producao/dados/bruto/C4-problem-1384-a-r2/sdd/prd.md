# PRD — Problem details (RFC 9457) como opção de configuração no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

### Problema

O h3 responde erros HTTP com um corpo JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`), gerado por `HTTPError.toJSON()` e `errorResponse()` em `src/response.ts`. Esse formato não segue a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs), que muitos clientes e APIs passaram a esperar. Hoje, quem quer esse formato precisa montar a resposta de erro à mão em `onError` ou em cada handler.

### Objetivo

Permitir que a aplicação escolha responder erros no formato *problem details* (`application/problem+json`), ligando uma opção booleana `problemDetails` em `H3Config`. A opção vem desligada por padrão. Com ela desligada, o comportamento atual não muda em nada. Com ela ligada, os erros gerados pelo h3 saem no formato da RFC 9457.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A opção booleana `problemDetails` existe em `H3Config`, vale `false` quando não informada e é lida de `app.config` como as demais opções (`debug`, `silent`, `onError`...).

**Critério de aceite:**
- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** `app.config.problemDetails` é consultado,
- **Então** o valor é `false` (ou ausente, tratado como desligado).

### RF-02 — Sem a opção, nada muda

Com `problemDetails` desligada, toda resposta de erro gerada pelo h3 mantém o corpo, o `Content-Type` e os headers que tem hoje.

**Critério de aceite:**
- **Dado** uma aplicação sem `problemDetails` (ou com `false`) e um handler que lança `HTTPError.status(404, "Not Found", { message: "x" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem `Content-Type: application/json` e o mesmo corpo JSON que a versão atual do h3 produz para esse erro.

### RF-03 — Content-Type da RFC 9457 com a opção ligada

Com `problemDetails: true`, respostas de erro (status 4xx e 5xx) geradas pelo h3 usam `Content-Type: application/problem+json`.

**Critério de aceite:**
- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `HTTPError.status(400, "Bad Request")`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 400 e `Content-Type` igual a `application/problem+json`.

### RF-04 — Membros do corpo RFC 9457

Com a opção ligada, o corpo do erro é um objeto JSON com `type`, `title`, `status`, `detail` e, quando definido, `instance`. Os campos mapeiam assim:

- `status` ← `HTTPError.status`;
- `title` ← `statusText` do erro (se ausente, a frase padrão do status, se o projeto já tiver essa tabela; caso contrário, o membro é omitido);
- `detail` ← `message` do erro;
- `type` ← `HTTPError.type` quando informado; senão `"about:blank"`;
- `instance` ← `HTTPError.instance` quando informado; senão omitido.

**Critério de aceite:**
- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `new HTTPError({ status: 403, statusText: "Forbidden", message: "Sem permissão", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a rota é requisitada,
- **Então** o corpo JSON é `{ "type": "https://exemplo.com/erros/sem-permissao", "title": "Forbidden", "status": 403, "detail": "Sem permissão", "instance": "/pedidos/42" }`.

### RF-05 — `type` e `instance` em `HTTPError`

`HTTPError` aceita `type` e `instance` (strings opcionais) no objeto de entrada do construtor e os expõe como propriedades somente leitura na instância. Não há nenhum outro nome público novo.

**Critério de aceite:**
- **Dado** `const err = new HTTPError({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/recurso/1" })`,
- **Quando** `err.type` e `err.instance` são lidos,
- **Então** retornam `"https://exemplo.com/erros/conflito"` e `"/recurso/1"`, e um `HTTPError` criado sem esses campos tem ambos `undefined`.

### RF-06 — Campos de extensão e regra de erros não tratados

Com a opção ligada, `data` e os campos de `body` são emitidos como membros de extensão do objeto (a RFC 9457 §3.2 permite). Erros marcados como `unhandled` seguem a regra atual: `detail` vira `"HTTPError"` e `data`/`body` são omitidos, para não vazar detalhes internos.

**Critério de aceite:**
- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `new Error("segredo do banco")` (não tratado, status 500),
- **Quando** a rota é requisitada,
- **Então** o corpo tem `status: 500` e `detail: "HTTPError"`, sem a string `"segredo do banco"`, e `Content-Type` é `application/problem+json`.

### RF-07 — Modo debug

Com `debug: true`, o corpo em formato problem details inclui a mesma informação extra de depuração que o formato atual já inclui (stack trace), em membro de extensão, e a serialização continua indentada como hoje.

**Critério de aceite:**
- **Dado** uma aplicação com `problemDetails: true` e `debug: true` e um handler que lança um erro não tratado,
- **Quando** a rota é requisitada,
- **Então** o corpo contém a informação de depuração que o formato atual também contém, e `Content-Type` continua `application/problem+json`.

### RF-08 — Hooks e headers de erro preservados

`onError` continua recebendo o `HTTPError` e pode devolver um valor que é renderizado pelo mesmo caminho. Os headers de erro (`event.res.errHeaders`, incluindo `set-cookie`) continuam sendo aplicados à resposta problem details, sem duplicação.

**Critério de aceite:**
- **Dado** uma aplicação com `problemDetails: true`, um `onError` e um handler que define um cookie em `errHeaders` e lança um erro 401,
- **Quando** a rota é requisitada,
- **Então** a resposta é `application/problem+json`, contém o cookie uma única vez e o `onError` foi chamado com o erro.

### RF-09 — Compatibilidade de tipos e testes

`pnpm lint` e `pnpm typecheck` passam. Os testes existentes continuam passando; só podem ser ajustados os que dependem diretamente do que esta mudança altera, sem perder o que verificam.

**Critério de aceite:**
- **Dado** o repositório após a mudança,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados e a suíte de testes é rodada,
- **Então** ambos passam, e nenhum teste existente foi removido ou enfraquecido sem substituto equivalente.

## Fora de escopo

- Escolha do formato por negociação de conteúdo (`Accept: application/problem+json`). Com a opção ligada, o formato é fixo, independente de `Accept`.
- Respostas de sucesso no formato problem details.
- Erros de validação com lista de campos (`errors` ou equivalente). Só o formato base da RFC e membros de extensão genéricos.
- Registro ou publicação de URIs de `type` e documentação de catálogos de erro.
- Localização (i18n) de `title` e `detail`.
- Integração específica com Nitro.
- Mudar o default da opção para `true` ou alterar o formato atual de `HTTPError.toJSON()` com a opção desligada.
- Suporte a XML (`application/problem+xml`).
- Novos utilitários públicos além de `type` e `instance` em `HTTPError`.

## Premissas

- A opção vale para toda a aplicação (`H3Config`), não por rota.
- `title` usa `statusText`. A tabela de frases padrão só entra se já existir no projeto; caso contrário, o membro é omitido. Confirmar na implementação.
- `type` ausente vira `"about:blank"`, como manda a RFC 9457 §4.2.1.
- O formato problem details é aplicado a erros gerados pelo h3 (erros lançados, `kNotFound`, erros de `onError`). Respostas que o próprio handler monta como `Response` não são reescritas.
- Não há mudança de runtime fora de `src/` (Node, Bun, Deno, Workers) além do que `toResponse` já cobre.

## Riscos

- **Quebra para clientes ao ligar a opção.** Clientes que leem `message` ou `statusText` do formato atual deixam de encontrá-los com o mesmo nome. Mitigação: a opção é explícita e desligada por padrão; documentar a diferença de mapeamento.
- **Duplicação de `set-cookie`.** O caminho de `onError` já tem um cuidado específico com `errHeaders`; a nova renderização não pode reintroduzir a duplicação (coberto por RF-08).
- **Vazamento de detalhes internos.** Erros não tratados e o modo debug são o ponto mais sensível; RF-06 e RF-07 existem para isso.
- **Testes existentes acoplados ao formato atual.** Podem precisar de ajuste pontual. O contrato permite, mas exige que a verificação original seja mantida.
- **Erros de outras bibliotecas com `name === "HTTPError"`.** `HTTPError.isError` continua exigindo `status`; a nova renderização deve usar a mesma detecção, sem ampliar o critério.
- **Caminhos de cache e rules.** Respostas de erro gravadas por `h3/rules/cache` ou `utils/cache.ts` podem guardar o formato antigo se a opção mudar entre instâncias. Confirmar na implementação e cobrir com teste se afetar.
