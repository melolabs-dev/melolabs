# PRD — Problem details (RFC 9457) como opção de configuração

Base: `sdd/pedido.md` (contrato #1384-A, issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros HTTP sempre no mesmo formato próprio, gerado por `HTTPError.toJSON()` (`src/error.ts`): um objeto com `status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`. Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), que clientes e gateways conhecem e que a issue h3js/h3#1384 pede. Não há como um aplicativo optar por esse formato, nem o `HTTPError` aceita os campos `type` e `instance` que a RFC define.

### Objetivo

Permitir que a aplicação responda erros no formato `application/problem+json` da RFC 9457, ligando isso por uma opção de configuração. Com a opção desligada (padrão), nada muda para quem já usa o h3.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A `H3Config` ganha a opção booleana `problemDetails`, com padrão `false`. Ela é lida de `app.config` como as demais opções de configuração.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`
- **Quando** `app.config` é inspecionado
- **Então** `problemDetails` não está ligada, e o comportamento de erro é o atual.

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`
- **Quando** um handler lança um `HTTPError`
- **Então** a resposta usa o formato definido em RF-02 (a opção é lida de `app.config`).

### RF-02 — Resposta de erro em `application/problem+json`

Com `problemDetails` ligada, um erro HTTP é respondido com:

- Header `Content-Type: application/problem+json`.
- Corpo JSON com os membros da RFC 9457 mapeados a partir do `HTTPError`:
  - `type`: valor de `HTTPError.type`; se ausente, `"about:blank"`.
  - `title`: `statusText` do erro; se ausente, a frase padrão do status.
  - `status`: `status` do erro.
  - `detail`: `message` do erro (sujeito à regra de erros não tratados em RF-05).
  - `instance`: valor de `HTTPError.instance`, quando definido.
- Os campos `data` e `body` do erro, quando existirem, são incluídos como membros de extensão da RFC.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })`
- **Quando** a rota é chamada
- **Então** a resposta tem status `404`, `Content-Type` `application/problem+json`, e o corpo contém `status: 404`, `title: "Not Found"`, `detail: "Usuário não existe"` e `type: "about:blank"`.

- **Dado** a mesma aplicação e um `HTTPError` com `type: "https://exemplo.com/erros/sem-saldo"` e `instance: "/contas/42"`
- **Quando** o erro é respondido
- **Então** o corpo contém `type` e `instance` com esses valores.

### RF-03 — Comportamento inalterado com a opção desligada

Com `problemDetails` desligada (padrão), a resposta de erro é idêntica à atual: mesmo `Content-Type`, mesmo corpo JSON e mesmos status.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e uma rota que lança `HTTPError` com `status: 422`, `data` e `body`
- **Quando** a rota é chamada
- **Então** a resposta tem o `Content-Type` de JSON atual e o corpo igual ao que o h3 produz hoje, sem os membros `type` e `instance` da RFC.

- **Dado** a suíte de testes existente, sem alterações nos testes que não dependem de `type`/`instance`
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam.

### RF-04 — `HTTPError` aceita `type` e `instance`

O construtor de `HTTPError` aceita, no objeto de entrada, os campos opcionais `type` e `instance`, expostos como propriedades somente leitura da instância. Quando ausentes, valem `undefined`. Eles são lidos do objeto de entrada, não da `cause`, da mesma forma que `data` e `body`.

**Critério de aceite**

- **Dado** `const err = new HTTPError({ status: 409, type: "https://exemplo.com/conflito", instance: "/pedidos/7" })`
- **Quando** `err.type` e `err.instance` são lidos
- **Então** os valores são `"https://exemplo.com/conflito"` e `"/pedidos/7"`.

- **Dado** `const err = new HTTPError({ status: 500 })`
- **Quando** `err.type` e `err.instance` são lidos
- **Então** ambos são `undefined`.

- **Dado** `new HTTPError({ status: 500, cause: { type: "x" } })`
- **Quando** `err.type` é lido
- **Então** o valor é `undefined`.

### RF-05 — Erros não tratados não vazam detalhes

Quando o erro é não tratado (`unhandled`, por exemplo uma exceção comum), o formato de RFC 9457 usa `status` 500 (ou o status do erro), `title` padrão e `type: "about:blank"`, e não inclui `detail`, `data` nem `body`. Isso preserva a regra atual de `toJSON()`. Não há novo nível de exposição de stack trace.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new Error("senha do banco: 123")`
- **Quando** a rota é chamada
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, e o corpo não contém `detail`, `data` nem a string `"senha do banco"`.

### RF-06 — Cabeçalhos e hook `onError` continuam valendo

Os cabeçalhos definidos no erro (`HTTPError.headers`, incluindo `set-cookie`) continuam sendo aplicados à resposta. O hook `onError` continua sendo chamado antes da renderização, e o valor que ele devolver passa pelo mesmo caminho de renderização, então também sai em `application/problem+json` quando a opção estiver ligada.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`, um `onError` configurado e uma rota que lança `HTTPError` com `headers: { "x-erro": "1" }`
- **Quando** a rota é chamada
- **Então** `onError` é chamado uma vez, a resposta tem `x-erro: 1` e `Content-Type` `application/problem+json`.

### RF-07 — Cobre `404` de rota não encontrada

Quando nenhuma rota casa com a requisição, o 404 gerado pelo h3 também segue o formato da opção ligada.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` sem rota para `/nada`
- **Quando** `GET /nada` é feito
- **Então** a resposta tem status `404`, `Content-Type` `application/problem+json` e `status: 404` no corpo.

## Fora de escopo

- Negociação de conteúdo pelo header `Accept` (a opção é o único gatilho).
- Registro ou catálogo de tipos de problema e URLs de documentação.
- Validação do documento contra o schema da RFC 9457.
- Membros de extensão novos além de `data` e `body` que já existem.
- Formato de erro para WebSocket, JSON-RPC ou eventos SSE.
- Integração específica com Nitro, além de não quebrar o que já existe.
- Mudar o padrão da opção para `true`.
- Alterações em `_deprecated.ts` (API v1).
- Novos nomes públicos além de `problemDetails`, `HTTPError.type` e `HTTPError.instance`.
- Documentação extensa no site; apenas a documentação mínima no código, se o padrão do projeto pedir.

## Premissas e riscos

### Premissas

- A opção é lida de `app.config` no momento de renderizar a resposta, como `debug` e `silent` já são. Vale para erros de rotas e middlewares que passam pelo `H3`.
- `type` e `instance` são lidos apenas do objeto de entrada do construtor, como `data` e `body`. O membro `type` da RFC não cria um novo nome público além de `HTTPError.type`.
- Os nomes `type`, `title`, `detail` e `instance` do corpo são nomes do protocolo definidos pela RFC, não nomes públicos do h3.
- `application/problem+json` é usado sempre que a opção estiver ligada, sem depender do `Accept` da requisição.

### Riscos

- **Caminhos sem `app`:** `defineHandler`/`toResponse` podem ser usados fora de uma instância `H3`, e nesse caso não há `app.config` para ler. Pode ser necessário passar a opção pelo mesmo caminho que já recebe `debug` e `onError`. Confirmar antes da implementação.
- **Regressão silenciosa:** mudanças em `prepareResponse`/`errorResponse` podem alterar o corpo ou o `Content-Type` com a opção desligada. RF-03 e os testes existentes são a proteção; a suíte deve passar sem alterar asserções que não dependem da nova opção.
- **Duplicação de `set-cookie`:** o código atual já trata isso ao limpar `kEventRes` antes de renderizar. A nova renderização não pode reintroduzir a duplicação ao passar pelo `onError`.
- **Vazamento de detalhes:** o membro `detail` e os campos de extensão podem expor mensagens internas se o `HTTPError` for criado com dados sensíveis. RF-05 fixa a regra para erros não tratados; para erros tratados, a responsabilidade é de quem lança.
- **Tipos:** o `ErrorDetails` aceita `Error & { cause?: unknown }`. Incluir `type` e `instance` não pode quebrar a inferência de tipos existente; a verificação é `pnpm typecheck`.
- **Lint e formatação:** `pnpm lint` precisa passar, incluindo o `oxfmt --check`.
- **Regras do projeto:** testes devem usar `describeMatrix` para rodar em `web` e `node`, e a opção nova deve ser coberta nos dois modos.
