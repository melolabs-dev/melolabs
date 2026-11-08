# PRD — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato enxuto #1384-C).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre no mesmo formato JSON (`status`, `statusText`, `unhandled`, `message`, `data` e as propriedades de `body`). A issue h3js/h3#1384 pede suporte à RFC 9457 (Problem Details for HTTP APIs), que define um formato padronizado para erros HTTP com `Content-Type: application/problem+json`. Não existe hoje nenhuma forma de produzir esse formato.

### Objetivo

Permitir que o handler responda um erro no formato RFC 9457 por meio de um utilitário explícito, `problem(input)`, exportado por `h3`. Apenas as respostas que usam esse utilitário mudam de formato; todos os erros existentes continuam como hoje.

## Requisitos funcionais

### RF-01 — `problem(input)` retorna um `HTTPError`

A função `problem` é exportada pelo pacote `h3` e retorna uma instância de `HTTPError`, para que possa ser usada tanto com `throw problem(...)` quanto com `return problem(...)`.

**Critério de aceite**

- **Dado** que o módulo `h3` é importado,
- **Quando** `problem({ status: 404, message: "Não encontrado" })` é chamado,
- **Então** o retorno é uma instância de `HTTPError` com `status` 404, e `HTTPError.isError(resultado)` retorna `true`.

### RF-02 — Entrada aceita os campos de `ErrorInput` mais `type` e `instance`

`problem` aceita o mesmo objeto de entrada de `HTTPError` (`ErrorInput`) e, além dele, os campos opcionais `type` e `instance` da RFC 9457. O tipo dessa entrada é exportado com um nome próprio (ex.: `ProblemInput`).

**Critério de aceite**

- **Dado** uma entrada com `status`, `message`, `type: "https://exemplo.com/erros/saldo"` e `instance: "/contas/42"`,
- **Quando** `problem(entrada)` é chamado,
- **Então** a chamada compila sem erro de tipo, e os valores de `type` e `instance` ficam disponíveis na resposta gerada (ver RF-03).

### RF-03 — Resposta em `application/problem+json`

Quando um erro criado por `problem` chega ao cliente, a resposta tem `Content-Type: application/problem+json` e corpo JSON com os membros da RFC 9457: `type`, `title`, `status`, `detail` e `instance`.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 403, message: "Saldo insuficiente", type: "https://exemplo.com/erros/saldo", instance: "/contas/42" })`,
- **Quando** uma requisição chega a esse handler,
- **Então** a resposta tem status 403, `Content-Type` `application/problem+json`, e o corpo JSON contém `type` = `"https://exemplo.com/erros/saldo"`, `status` = 403, `detail` = `"Saldo insuficiente"`, `instance` = `"/contas/42"` e `title` preenchido.

### RF-04 — Mapeamento dos campos e valores padrão

- `detail` recebe `message`.
- `title` recebe `statusText` quando informado; caso contrário, a frase padrão do status HTTP.
- `type` recebe o valor informado; quando ausente, vale `"about:blank"`, conforme a RFC.
- `instance` aparece somente quando informado.

**Critério de aceite**

- **Dado** `problem({ status: 409 })` sem `type`, `instance`, `message` nem `statusText`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `type` = `"about:blank"`, `status` = 409, `title` = `"Conflict"` e não contém a chave `instance`.

### RF-05 — Extensões via `body` no nível superior

Campos passados em `body` são mesclados no nível superior do corpo `application/problem+json`, como a RFC 9457 permite para extensões. Campos reservados (`type`, `title`, `status`, `detail`, `instance`) não podem ser sobrescritos por `body`.

**Critério de aceite**

- **Dado** `problem({ status: 422, message: "Inválido", body: { campos: ["email"], status: 999 } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `campos` = `["email"]` no nível superior e `status` = 422.

### RF-06 — Erros que não usam `problem` mantêm o formato atual

Respostas de erros criados com `new HTTPError`, `HTTPError.status`, `createError` ou por qualquer outro caminho que não seja `problem` continuam com o formato JSON atual e `Content-Type` `application/json`, byte a byte.

**Critério de aceite**

- **Dado** um handler que faz `throw new HTTPError({ status: 404, message: "Nada aqui" })`,
- **Quando** a requisição chega a esse handler,
- **Então** a resposta tem `Content-Type` `application/json` e corpo igual ao gerado pela versão anterior do h3 (`status`, `statusText`, `unhandled`, `message`, `data`).

### RF-07 — Erros não tratados continuam sem vazamento

Quando o erro é não tratado (`unhandled`), a mensagem, `data`, `body` e o stack trace não aparecem na resposta, como hoje. Isso vale também para erros de `problem`: a resposta usa o formato de problema, mas com `detail` e extensões ocultos e `status` 500.

**Critério de aceite**

- **Dado** uma exceção genérica `new Error("segredo do banco")` lançada por um handler,
- **Quando** a requisição é processada,
- **Então** a resposta tem status 500, `Content-Type` `application/json`, e o corpo não contém `"segredo do banco"` nem stack trace fora do modo debug.

### RF-08 — Headers do erro são preservados

Headers passados em `headers` (e os headers já anexados via mecanismos existentes, como `errHeaders`) são enviados na resposta de `problem`, mesclados ao `Content-Type` do problema.

**Critério de aceite**

- **Dado** `problem({ status: 401, message: "Token expirado", headers: { "WWW-Authenticate": "Bearer" } })`,
- **Quando** a resposta é gerada,
- **Então** a resposta contém o header `WWW-Authenticate: Bearer` e `Content-Type` `application/problem+json`.

### RF-09 — Hooks de erro recebem o `HTTPError`

`onError` e `onResponse` continuam recebendo o `HTTPError` com os mesmos campos (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`). Nenhuma assinatura pública muda.

**Critério de aceite**

- **Dado** um `onError` registrado e um handler que faz `throw problem({ status: 400, message: "x" })`,
- **Quando** a requisição é processada,
- **Então** o hook é chamado com um `HTTPError` cujo `status` é 400 e cujo `message` é `"x"`.

### RF-10 — Superfície pública restrita

A única adição pública é `problem` e o tipo da sua entrada (`ProblemInput`). A marcação interna que indica que um erro deve sair no formato de problema não é exportada e não aparece como propriedade pública documentada de `HTTPError`.

**Critério de aceite**

- **Dado** a lista de exports de `src/index.ts` antes e depois da mudança,
- **Quando** a diferença é comparada,
- **Então** a única diferença são `problem` e `ProblemInput`.

### RF-11 — Status inválido é sanitizado

O `status` passado a `problem` passa pela mesma sanitização de `HTTPError` (`sanitizeStatusCode`), com 500 como padrão.

**Critério de aceite**

- **Dado** `problem({ status: 42, message: "x" })`,
- **Quando** a resposta é gerada,
- **Então** o status HTTP enviado é 500 e o corpo `status` é 500.

## Fora de escopo

- Negociação de conteúdo por `Accept` (ex.: `application/problem+json` decidido pelo cliente) ou troca automática do formato de todos os erros.
- Mudança do formato padrão de `HTTPError` ou de qualquer erro existente.
- Registro ou validação de URIs de `type`; o h3 apenas repassa o valor.
- Tradução/internacionalização de `title` e `detail`.
- Mapeamento automático de `ErrorBody.data` para membros de problema; `data` continua sendo tratado como hoje, e o uso de `body` é o caminho para extensões.
- Integração com Nitro, `h3/rules` ou outros pacotes; isso fica para uma mudança posterior.
- Documentação extensa fora do código e dos testes (um parágrafo no README é suficiente, se necessário).

## Premissas e riscos

### Premissas

- A RFC 9457 é a referência; o formato é JSON com `Content-Type: application/problem+json`.
- `problem` é o único caminho que muda o formato. A marcação de "é problema" é interna (ex.: símbolo não exportado ou propriedade privada), sem novo nome público, conforme a restrição do pedido.
- `title` padrão usa `statusText` ou a frase padrão do status; `detail` vem de `message`.
- `type` ausente vale `"about:blank"`, valor que a própria RFC define como padrão.
- Os testes existentes continuam passando; só testes que dependam do que a mudança altera podem ser ajustados, mantendo o que verificam.
- `pnpm lint` e `pnpm typecheck` precisam passar ao final.
- Para cada RF, o fluxo de bug/feature do `AGENTS.md` se aplica: teste escrito antes da implementação e rodado em `web` e `node` via `describeMatrix`.

### Riscos

- **Marcação interna que se perde.** Se o erro de `problem` for reembrulhado (ex.: `new HTTPError({ cause: erro })`) ou copiado, o formato de problema pode não ser aplicado. Mitigação: teste explícito de `throw` e `return`, e decisão de não reembrulhar em `toResponse`.
- **Vazamento em erros não tratados.** Um `problem` marcado como `unhandled` poderia expor `detail` ou `body`. Mitigação: RF-07 com teste específico.
- **Colisão de extensões com membros reservados.** `body` pode tentar sobrescrever `status` ou `type`. Mitigação: RF-05 com precedência fixa dos membros reservados.
- **Divergência entre `statusText` e `title`.** Os valores podem não casar com a expectativa do cliente. Risco aceito; documentar o mapeamento (RF-04).
- **Quebra silenciosa de consumidores.** Clientes que leem `message` do JSON de erro não são afetados, pois só respostas com `problem` mudam; ainda assim, a suíte existente precisa ser verificada para garantir que nenhum teste atual foi alterado sem motivo.
- **Crescimento do tipo `ErrorInput`.** Adicionar `type`/`instance` a `ErrorInput` aumentaria a superfície de `HTTPError`; por isso a decisão é um tipo próprio (`ProblemInput`), sem alterar `ErrorInput`.
