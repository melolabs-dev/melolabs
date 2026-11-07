# PRD — Respostas de erro no formato problem details (RFC 9457)

Referência: h3js/h3#1384 e contrato `sdd/pedido.md` (#1384-B).

## Problema e objetivo

Hoje, quando uma rota ou middleware falha, o h3 responde com um JSON próprio, produzido por `HTTPError.toJSON()` e `errorResponse()` em `src/response.ts`. O corpo usa `message` e `statusText`, o `Content-Type` é `application/json;charset=UTF-8` e não há campo de tipo do problema nem identificador da ocorrência. Clientes que querem tratar erros de forma uniforme precisam de código específico para o h3.

**Objetivo:** fazer com que toda resposta de erro do h3 siga a RFC 9457 (Problem Details for HTTP APIs, representação JSON), sem nenhuma opção de configuração, e permitir que quem lança `HTTPError` informe os campos `type` e `instance` da RFC.

## Requisitos funcionais

### RF-01 — Content-Type de problem details em todas as respostas de erro

Toda resposta de erro gerada pelo h3 (erros de `HTTPError`, erros não tratados, 404 do roteador e erros de validação) usa `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma rota que lança `new HTTPError({ status: 422, message: "Dados inválidos" })`
- **Quando** a requisição chega a essa rota
- **Então** a resposta tem status 422 e o header `Content-Type` é `application/problem+json`.

### RF-02 — Corpo com os membros padrão da RFC 9457

O corpo JSON de erro contém `status` (número igual ao status HTTP), `title` (texto curto do status), `detail` (descrição específica da ocorrência) e `type`. Quando `type` não é informado, o valor é `"about:blank"`, como manda a RFC.

Mapeamento a partir do modelo atual: `title` vem de `statusText` (ou, na falta dele, do texto padrão do status); `detail` vem de `message`.

**Critério de aceite**

- **Dado** um `HTTPError` criado com `status: 404`, `statusText: "Not Found"` e `message: "Usuário não encontrado"`
- **Quando** o erro é convertido em resposta
- **Então** o corpo JSON contém `"status": 404`, `"title": "Not Found"`, `"detail": "Usuário não encontrado"` e `"type": "about:blank"`.

### RF-03 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`/`ErrorDetails`) aceita os campos opcionais `type` (string, URI que identifica o tipo do problema) e `instance` (string, URI que identifica a ocorrência). Ambos ficam disponíveis como propriedades da instância e são incluídos no corpo da resposta quando informados.

Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`
- **Quando** lemos `error.type` e `error.instance` e convertemos o erro em resposta
- **Então** `error.type` é `"https://exemplo.com/erros/sem-permissao"`, `error.instance` é `"/pedidos/42"`, e o corpo JSON contém os dois valores com os mesmos nomes.

### RF-04 — `type` e `instance` herdados de `cause`

Assim como `status`, `statusText` e `headers` já são lidos de `details.cause`, `type` e `instance` também são lidos de `cause` quando não vêm no objeto de entrada, para manter o padrão do construtor.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 500, cause: { status: 409, type: "https://exemplo.com/erros/conflito" } })`
- **Quando** lemos `error.type`
- **Então** o valor é `"https://exemplo.com/erros/conflito"`.

### RF-05 — Membros de extensão existentes continuam no corpo

Os membros que o h3 já envia hoje e que não fazem parte da RFC (`message`, `data`, `body` e `unhandled`) continuam no corpo, com o mesmo significado, como membros de extensão permitidos pela RFC. Isso preserva clientes que já leem esses campos.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, message: "Campo inválido", data: { campo: "email" } })`
- **Quando** a resposta é gerada
- **Então** o corpo contém `"message": "Campo inválido"` e `"data": { "campo": "email" }`, além de `status`, `title`, `detail` e `type`.

### RF-06 — Erros não tratados não vazam detalhes

Quando o erro é marcado como `unhandled`, o corpo não expõe mensagem, `data` nem `body` (comportamento atual), e `detail` recebe o mesmo valor genérico que `message` recebe hoje. A stack trace continua visível só no modo debug.

**Critério de aceite**

- **Dado** um erro não tratado (`unhandled: true`) com `cause` contendo um segredo na mensagem
- **Quando** a resposta é gerada fora do modo debug
- **Então** o corpo não contém o texto do segredo nem o campo `stack`, e `status` é 500.

### RF-07 — Headers do erro são preservados

Headers informados em `HTTPError` (`headers`) continuam sendo enviados na resposta, junto com `Content-Type: application/problem+json`. Se o header informado tentar definir `Content-Type`, ele prevalece.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 429, headers: { "Retry-After": "30" } })`
- **Quando** a resposta é gerada
- **Então** a resposta contém `Retry-After: 30` e `Content-Type: application/problem+json`.

### RF-08 — Comportamento idêntico em todos os runtimes

O formato é o mesmo no modo `web` e no modo `node` dos testes, e nos entries de runtime (Node, Bun, Deno, Cloudflare, Service Worker, generic).

**Critério de aceite**

- **Dado** uma rota de teste que lança `HTTPError` com `type` definido
- **Quando** a mesma requisição roda nos modos `web` e `node` (`describeMatrix`)
- **Então** os dois retornam o mesmo status, o mesmo `Content-Type` e o mesmo corpo JSON.

### RF-09 — Sem opção de configuração

O formato de problem details é o único formato de erro. Não há opção nova em `H3Config` nem em outra API para desligá-lo ou escolher outro formato.

**Critério de aceite**

- **Dado** um `H3` criado sem nenhuma opção de configuração
- **Quando** uma rota lança qualquer `HTTPError`
- **Então** a resposta usa `application/problem+json`, e nenhuma opção nova é aceita pelo tipo `H3Config`.

## Fora de escopo

- Opção para voltar ao formato antigo ou para escolher formato de erro (o contrato proíbe novos nomes públicos).
- Dicionário de tipos de problema do h3 (URIs padrão para cada status). O `type` padrão é `about:blank`.
- Suporte a `application/problem+xml` ou a negociação de conteúdo via `Accept`.
- Extensões da RFC além de `message`, `data`, `body` e `unhandled` (ex.: listas de erros de validação em campo próprio).
- Mudanças em `H3Event`, `HTTPResponse`, middleware de validação ou em `toResponse` para casos de sucesso.
- Alteração do pacote `srvx` ou de qualquer dependência.
- Documentação em site externo ou changelog de migração.

## Premissas

- **P1:** O corpo continua incluindo `message`, `data`, `body` e `unhandled` para não quebrar clientes atuais. A RFC permite membros de extensão.
- **P2:** `title` vem de `statusText` e `detail` vem de `message`. Quando `statusText` não existe, usa-se o texto padrão do status HTTP.
- **P3:** `type` e `instance` são strings. O h3 não valida que sejam URIs válidas (a RFC recomenda, mas não obriga na leitura).
- **P4:** Os testes existentes que verificam `Content-Type: application/json` ou o formato exato do corpo de erro (principalmente `test/errors.test.ts` e os testes de JSON-RPC e SSE que checam erros) serão ajustados apenas nos pontos que dependem da mudança, mantendo o que eles verificam.
- **P5:** A mudança de `Content-Type` é aceita como mudança de comportamento padrão, pedida explicitamente pela issue.

## Riscos

- **R1 — Quebra para clientes que checam o Content-Type.** Clientes que exigem `application/json` deixam de reconhecer a resposta de erro. Mitigação: `application/problem+json` é JSON; a nota de release deve destacar a mudança. Como o contrato pede "sem configuração", não há alternativa de opt-out.
- **R2 — Tensão entre "formato padrão sem configuração" e "não quebrar o que já existe".** Por isso mantemos os membros de extensão (P1) e limitamos a mudança ao `Content-Type` e aos campos novos `title`, `detail` e `type`.
- **R3 — Vazamento em erros não tratados.** Adicionar `detail` pode expor texto que hoje fica oculto. Mitigação: RF-06 reaproveita a mesma regra do `message` atual.
- **R4 — Muitos testes dependem do formato.** Há cerca de 120 ocorrências de `application/json`, `unhandled` e `toJSON` em 18 arquivos de teste. O ajuste deve ser cirúrgico, conforme P4.
- **R5 — Conflito de `Content-Type` com `headers` do usuário.** Mitigação: RF-07 define a precedência.
- **R6 — Tipagem.** Adicionar `type` e `instance` a `ErrorBody` pode afetar tipos públicos. Os testes de tipo (`test/unit/types.test-d.ts`) devem continuar passando.

## Verificação

Antes de aceitar a entrega:

- `pnpm lint` e `pnpm typecheck` passam.
- A suíte existente passa, com os ajustes descritos em P4 listados no PR.
- Há testes de regressão para RF-01 a RF-08 em `describeMatrix`.
