# PRD — Respostas de erro no formato problem details (RFC 9457)

Referência: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros como JSON próprio, produzido em `errorResponse` (`src/response.ts`) a partir de `HTTPError.toJSON()` (`src/error.ts`). Esse formato não segue um padrão. Clientes que querem tratar erros de forma uniforme precisam de lógica específica para o h3.

A issue #1384 pede suporte à RFC 9457 (Problem Details for HTTP APIs), que define um corpo JSON padronizado para erros HTTP.

### Objetivo

Fazer com que toda resposta de erro gerada pelo h3 use o formato problem details da RFC 9457, sem nenhuma configuração nova. `HTTPError` passa a aceitar e expor os campos `type` e `instance` da RFC. Nenhum outro nome público novo é criado, e o que já existe não deve quebrar.

## Requisitos funcionais

### RF-01 — Corpo de erro no formato RFC 9457

Toda resposta de erro produzida pelo h3 (inclusive as geradas por `HTTPError` lançado em handlers, middlewares e hooks, e as de erro não tratado) tem corpo JSON com os membros `type`, `title`, `status`, `detail` e `instance`, quando aplicáveis.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`,
- **Quando** a requisição é processada,
- **Então** o corpo JSON contém `status: 404`, `title` preenchido, `detail: "Usuário não encontrado"` e `type: "about:blank"`.

### RF-02 — Content-Type de problem details

Respostas de erro usam `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** qualquer resposta de erro gerada pelo h3,
- **Quando** o cabeçalho `content-type` é lido,
- **Então** o valor é `application/problem+json` (charset, se presente, conforme o padrão atual do h3).

### RF-03 — `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`. Os valores são expostos como propriedades da instância.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` é `"https://exemplo.com/erros/sem-permissao"` e `error.instance` é `"/pedidos/42"`.

### RF-04 — `type` padrão

Quando `type` não é informado, o corpo usa `"about:blank"`, valor previsto pela RFC 9457 para erros sem tipo específico.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 500 })` sem `type`,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo contém `type: "about:blank"`.

### RF-05 — Mapeamento de `title` e `detail`

`title` é o texto do status (`statusText`, com fallback para o texto padrão do status). `detail` é a mensagem do erro (`message`). Quando não há mensagem, `detail` é omitido.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 422, statusText: "Unprocessable Content" })` sem `message`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `title: "Unprocessable Content"` e não contém `detail`.

### RF-06 — Preservação de informações existentes

Dados que o formato atual já expõe (por exemplo `data` do erro) continuam presentes no corpo como membros de extensão da RFC 9457. Nada que o cliente recebe hoje deixa de ser enviado sem substituto.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, data: { campo: "email" } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `data: { campo: "email" }` como membro adicional, além dos membros padrão.

### RF-07 — Stack apenas em modo debug

O campo `stack` continua aparecendo somente quando o modo debug está ativo, como hoje.

**Critério de aceite**

- **Dado** um erro com stack e o modo debug desativado,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém `stack`.
- **Dado** o mesmo erro com o modo debug ativado,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `stack` como array de linhas.

### RF-08 — Cabeçalhos do erro preservados

Cabeçalhos definidos no erro (`error.headers`) e os cabeçalhos extras passados ao gerar a resposta continuam sendo aplicados, como hoje.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 429, headers: { "retry-after": "30" } })`,
- **Quando** a resposta é gerada,
- **Então** o cabeçalho `retry-after` é `"30"` e o `content-type` é `application/problem+json`.

### RF-09 — Respostas de sucesso inalteradas

Respostas que não são erro (strings, objetos, `Response`, streams etc.) não mudam.

**Critério de aceite**

- **Dado** um handler que retorna `{ ok: true }`,
- **Quando** a requisição é processada,
- **Então** a resposta é JSON com `content-type: application/json;charset=UTF-8` e corpo `{"ok":true}`, como antes.

### RF-10 — Suíte e verificações

A suíte existente continua passando. Testes existentes são ajustados apenas quando dependem do formato antigo, mantendo o que verificam. Os testes novos cobrem RF-01 a RF-08 nos dois modos (`web` e `node`) via `describeMatrix`.

**Critério de aceite**

- **Dado** a branch com a mudança,
- **Quando** `pnpm test` (ou `pnpm lint` e `pnpm typecheck`) é executado,
- **Então** lint, typecheck e testes passam, e cada ajuste em teste existente é listado na descrição da mudança com o motivo.

## Fora de escopo

- Registro de tipos de problema ou páginas de documentação dos URIs de `type`.
- Negociação de conteúdo por `Accept` (ex.: oferecer o formato antigo a clientes que o pedirem).
- Opção de configuração para desligar o novo formato (o pedido exige formato padrão sem configuração).
- Extensões de problem details além de `data` já existente.
- Mudanças em `h3/rules/cache`, `h3/rules/proxy` e no `_deprecated.ts` além do que for necessário para compilar.
- Formato XML ou `application/problem+xml`.
- Alterações no `HTTPError.isError`, no `status`/`statusText` ou na API de `HTTPResponse`.

## Premissas e riscos

### Premissas

- Os nomes dos membros seguem a RFC 9457 (`type`, `title`, `status`, `detail`, `instance`) e o mapeamento de RF-05 é a leitura adotada para `message` e `statusText`.
- `about:blank` é o `type` padrão (RF-04). Não há registro de tipos de problema neste escopo.
- O formato vale também para erros não tratados que hoje passam por `errorResponse` (ex.: `HTTPError` com `unhandled: true` em `src/adapters.ts`).
- `data` é mantido como membro de extensão (RF-06) em vez de ser removido.

### Riscos

- **Conflito entre pedido e restrição.** O pedido torna o novo formato padrão "sem configuração" e, ao mesmo tempo, exige "não quebrar o que já existe". Como o corpo de erro muda para todos os usuários, clientes que hoje leem o JSON atual (ex.: `message` como campo de topo, `statusMessage`) podem quebrar. Esta é a principal decisão a confirmar antes da implementação: aceitar a quebra de corpo de erro (e registrá-la como mudança incompatível) ou manter compatibilidade por outro caminho, o que o pedido proíbe ao exigir ausência de configuração.
- **Mudança de `Content-Type`.** Clientes que verificam `application/json` em erros deixam de reconhecer a resposta como JSON pelo cabeçalho.
- **Vazamento de informação.** Campos como `stack` e `data` podem expor detalhes internos se o mapeamento não for revisado. RF-07 limita a stack ao modo debug.
- **Testes existentes.** Vários testes que comparam o corpo de erro devem ser ajustados (RF-10). Ajustes excessivos podem esconder regressões reais.
- **Versão.** Por ser mudança incompatível de comportamento, pode exigir release major, a ser decidido pelos mantenedores.
