# PRD — Problem Details (RFC 9457) via utilitário `problem()`

Referência: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros (`HTTPError`) com um JSON próprio (`{ status, statusText, message, data, ...body }`, com `content-type: application/json;charset=UTF-8`). Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), o que impede clientes e gateways que esperam `application/problem+json` e os membros `type`, `title`, `detail`, `instance` de interpretar os erros de forma padronizada.

### Objetivo

Permitir que um handler responda erro no formato problem details de forma **explícita**, chamando a nova função `problem(input)`, exportada por `h3`, que devolve um `HTTPError`. Somente as respostas que usam o utilitário mudam; erros criados de outras formas mantêm o comportamento atual.

### Métricas de sucesso

- Um handler que faz `throw problem({...})` produz resposta `application/problem+json` válida segundo a RFC 9457.
- Nenhuma resposta de erro existente muda de forma observável.
- `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Função pública `problem(input)`

`problem` é exportada por `h3` (`src/index.ts`) e retorna uma instância de `HTTPError`. Aceita todos os campos do objeto de entrada de `HTTPError` (`ErrorInput`) e, adicionalmente, `type` e `instance` opcionais. O tipo dessa entrada é o único outro nome público novo.

**Critério de aceite**

- **Dado** que importo `problem` de `h3`
- **Quando** chamo `problem({ status: 404 })`
- **Então** recebo uma instância de `HTTPError` com `status` 404, e `HTTPError.isError(...)` retorna `true`.

### RF-02 — Corpo no formato RFC 9457

A resposta de um erro criado por `problem()` tem corpo JSON com os membros padrão: `type` (padrão `"about:blank"`), `status`, `title`, `detail` e `instance` (omitido quando ausente). `title` vem de `statusText` quando informado; caso contrário, do texto padrão do status HTTP. `detail` vem de `message` quando informado. Membros de extensão vêm de `body` e `data`, sem sobrescrever os membros padrão.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 422, type: "https://exemplo.com/erros/validacao", statusText: "Entidade inválida", message: "Campo email ausente", instance: "/cadastro/42" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo JSON é `{ "type": "https://exemplo.com/erros/validacao", "status": 422, "title": "Entidade inválida", "detail": "Campo email ausente", "instance": "/cadastro/42" }`, sem os campos `statusText` nem `message`.

### RF-03 — Content-Type `application/problem+json`

A resposta tem `content-type: application/problem+json` (com charset UTF-8, coerente com o padrão atual do h3). Se o chamador definir `content-type` em `headers`, o valor dele prevalece, como já ocorre com os demais headers de erro.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 400 })`
- **Quando** o cliente recebe a resposta
- **Então** o header `content-type` começa com `application/problem+json` e o status HTTP é 400.

### RF-04 — Valores padrão

Sem `type`, o corpo usa `"about:blank"` e `title` é o texto padrão do status (ex.: "Not Found"), conforme a RFC 9457 §4.2.1. O `status` do corpo é sempre igual ao status HTTP da resposta.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 404 })`
- **Quando** o cliente lê o corpo JSON
- **Então** ele contém `type: "about:blank"`, `status: 404` e `title: "Not Found"`.

### RF-05 — Extensões e headers

`headers`, `cause`, `data` e `body` continuam aceitos e funcionam como em `HTTPError`. Campos de `body` e `data` aparecem como membros de extensão no objeto de problema.

**Critério de aceite**

- **Dado** `problem({ status: 429, headers: { "retry-after": "30" }, body: { saldo: 0 } })`
- **Quando** o cliente recebe a resposta
- **Então** o header `retry-after` é `30` e o corpo JSON contém `saldo: 0` junto aos membros padrão.

### RF-06 — Erros não tratados continuam protegidos

Se o erro for marcado `unhandled`, o comportamento atual de ocultar `message`, `data` e `body` é mantido; nenhum detalhe interno vaza no formato problem.

**Critério de aceite**

- **Dado** `problem({ status: 500, unhandled: true, message: "segredo", body: { x: 1 } })`
- **Quando** o cliente recebe a resposta
- **Então** o corpo não contém `segredo` nem o membro `x`.

### RF-07 — Sem regressão nos erros existentes

Respostas para erros criados por `new HTTPError`, `HTTPError.status`, erros genéricos lançados, 404 e demais caminhos existentes não mudam (corpo e content-type continuam como hoje).

**Critério de aceite**

- **Dado** um handler que faz `throw new HTTPError({ status: 400, message: "ruim" })`
- **Quando** o cliente recebe a resposta
- **Então** o `content-type` é `application/json;charset=UTF-8` e o corpo mantém o formato atual (`status`, `message`, etc.).

### RF-08 — Testes e qualidade

Há testes de integração via `describeMatrix` (web e node) cobrindo RF-01 a RF-07, mais teste de tipos para a entrada de `problem`. Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** executo `pnpm test`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam.

## 3. Fora de escopo

- Negociação de conteúdo (`Accept`) e emissão automática de problem details para todos os erros.
- Opção global em `H3Config` para ligar o formato.
- Representação XML (`application/problem+xml`).
- Registro de tipos de problema, páginas de documentação por `type` ou helpers para tipos comuns.
- Qualquer nome público novo além de `problem` e o tipo da sua entrada.
- Integração com nitro e mudanças em validação (`defineValidatedHandler`).
- `Content-Language` e localização de `title`/`detail`.

## 4. Premissas e riscos

### Premissas

- `problem()` pode reaproveitar `HTTPError`, guardando o formato problem em um campo interno (prefixo `~`, não enumerável), lido por `errorResponse` em `src/response.ts`.
- `HTTPError.toJSON()` continua sendo o formato padrão do h3 para todo erro não criado por `problem()`.
- O texto padrão de status HTTP pode ser obtido sem nova dependência (mapa mínimo interno).
- O modo `debug` continua adicionando `stack` ao corpo.

### Riscos

- **Marca interna do erro:** distinguir erros de `problem()` sem exportar API nova; a marca pode se perder quando o erro é reembrulhado (`cause`, `new HTTPError(val)`). Mitigação: teste de repasse via `cause`.
- **Conflito de membros:** `body`/`data` com chaves `type`, `status`, `title`, `detail`, `instance` podem sobrescrever membros padrão. Mitigação: membros padrão têm precedência (RF-02).
- **Content-Type e headers do chamador:** a ordem de merge pode sobrescrever indevidamente. Mitigação: RF-03.
- **Vazamento em erros `unhandled`:** o novo formato é um segundo caminho de serialização. Mitigação: RF-06.
- **Regressão em testes existentes:** mudanças em `errorResponse` podem afetar asserções atuais; ajustar só o necessário.
- **`isolatedDeclarations`:** a função e o tipo exportados precisam de anotações de tipo explícitas.
