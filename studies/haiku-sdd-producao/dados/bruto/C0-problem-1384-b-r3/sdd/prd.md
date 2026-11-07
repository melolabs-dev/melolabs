# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, campos de `body` e `stack` em debug), com `content-type: application/json`. Esse formato não segue um padrão: clientes e ferramentas genéricas não o reconhecem. A RFC 9457 (Problem Details for HTTP APIs) define um formato comum, `application/problem+json`, com os membros `type`, `title`, `status`, `detail` e `instance`.

### Objetivo

Fazer toda resposta de erro do h3 seguir a RFC 9457 (representação JSON), **por padrão e sem configuração** (nenhuma opção ou gatilho novo). `HTTPError` passa a aceitar e expor `type` e `instance`. O formato antigo é substituído, mas os membros que ele já expunha continuam presentes no corpo como extensões, para não quebrar clientes existentes.

### Métricas de sucesso

- 100% das respostas de erro geradas por `HTTPError` usam `application/problem+json` e contêm `type`, `title` e `status`.
- A suíte existente continua passando, com ajustes apenas onde o teste dependia do `content-type` ou do formato alterado.
- `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`

Toda resposta de erro serializada a partir de um `HTTPError` usa o tipo de mídia `application/problem+json`, mantendo `charset=UTF-8`.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 400 })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 400 e o cabeçalho `content-type` começa com `application/problem+json`.

### RF-02 — Membros padrão da RFC 9457 no corpo

O corpo de erro contém `type`, `title`, `status` e `detail`. `status` é o código HTTP da resposta. `title` vem do `statusText` do erro e, na falta dele, da frase padrão do status (ex.: "Not Found" para 404). `detail` vem da `message` do erro. `type` é `"about:blank"` quando não informado (RFC 9457, seção 4.2.1).

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não encontrado" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo JSON contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não encontrado"`.

### RF-03 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` aceita `type` e `instance` (strings opcionais, tipadas em `ErrorInput`/`ErrorBody`). Ambos ficam expostos como propriedades somente leitura da instância e, quando definidos, aparecem no corpo com o mesmo nome. `instance` só é emitido quando informado. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/contas/12" })`
- **Quando** a instância é inspecionada e o erro é lançado em um handler
- **Então** `error.type` e `error.instance` retornam os valores informados e o corpo da resposta traz `type` e `instance` com esses valores.

### RF-04 — Compatibilidade com o formato anterior

Os membros do formato antigo continuam no corpo como extensões permitidas pela RFC: `message` (igual a `detail`), `statusText`, `data`, `unhandled` e as chaves extras de `body`. Membros `undefined` continuam omitidos. Chaves de `body` não sobrescrevem os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**

- **Dado** um erro com `message: "Falhou"`, `data: { campo: "x" }` e `body: { codigo: "E42" }`
- **Quando** o cliente recebe a resposta
- **Então** o corpo contém `message: "Falhou"`, `data: { campo: "x" }` e `codigo: "E42"`, além dos membros do RF-02.

### RF-05 — Erros não tratados não vazam informação

Para erros com `unhandled: true`, o corpo não expõe a mensagem original, `data` nem `body`: `detail` fica ausente ou genérico (`"HTTPError"`, como `message` hoje). `title` e `status` são mantidos. `stack` continua só em modo debug.

**Critério de aceite**

- **Dado** um handler que lança `new Error("segredo interno")` sem tratamento
- **Quando** o cliente faz a requisição fora do modo debug
- **Então** a resposta é 500 com `content-type` `application/problem+json`, e o corpo não contém "segredo interno" nem `stack`.

### RF-06 — Cabeçalhos e statusText preservados

Cabeçalhos definidos em `error.headers` ou nos cabeçalhos do evento, além do `statusText` da linha de status HTTP, continuam sendo aplicados. O `content-type` do problem details só é substituído se o erro definir explicitamente o seu.

**Critério de aceite**

- **Dado** um erro com `headers: { "x-trace": "1" }` e `statusText: "Teapot"` com status 418
- **Quando** o cliente faz a requisição
- **Então** a resposta tem o cabeçalho `x-trace: 1`, `statusText` "Teapot" e corpo em `application/problem+json`.

### RF-07 — Sem configuração

O formato é o padrão universal: não existe opção em `H3Config`, cabeçalho de negociação nem flag para voltar ao formato antigo.

**Critério de aceite**

- **Dado** uma instância `new H3()` sem nenhuma opção
- **Quando** qualquer rota lança um `HTTPError` (incluindo 404 de rota inexistente e erros de validação de corpo)
- **Então** a resposta é `application/problem+json` e `H3Config` não ganhou nenhuma propriedade nova.

## Fora de escopo

- Representação XML (`application/problem+xml`).
- Opção de configuração, negociação via `Accept` ou retorno ao formato antigo.
- Novas funções, classes ou utilitários públicos além de `type` e `instance` em `HTTPError`.
- Registro de tipos de problema ou páginas de documentação para URIs de `type`.
- Alterações em `h3/rules`, em adaptadores de runtime e em handlers que montam respostas de erro fora de `HTTPError` (ex.: JSON-RPC, que tem formato próprio).
- Erros de validação com a lista estruturada `errors` da RFC (mantém-se `data`).

## Premissas e riscos

### Premissas

- O ponto central da mudança é `HTTPError.toJSON()` (`src/error.ts`) e `errorResponse` (`src/response.ts`), onde hoje se fixa `jsonHeaders`.
- "Não quebrar o que já existe" é atendido mantendo os membros antigos como extensões; a única quebra intencional é o `content-type`.
- `message` e `detail` coexistem com o mesmo valor; `statusText` e `title` também.
- A frase padrão do status pode ser obtida sem nova API pública (helper interno).

### Riscos

- **Contradição no pedido:** "substitui o formato atual" versus "não quebrar". Resolvida acima (extensões); confirmar com o solicitante.
- **Clientes que exigem `application/json` exato** podem falhar com `application/problem+json`. Mitigação: nota de migração.
- **Testes existentes** que comparam `content-type` ou o corpo completo do erro precisarão de ajuste sem perder o que verificam.
- **Vazamento em erros não tratados** se `detail`/`title` usarem a mensagem original. Coberto pelo RF-05.
- **Colisão de nomes:** `type`, `instance` e `title` em `body` ou `data` de usuários podem colidir; a regra de precedência está no RF-04.
- **Tipagem:** `type` e `instance` entram em `ErrorBody` e afetam `isolatedDeclarations`; verificar com `pnpm typecheck`.
