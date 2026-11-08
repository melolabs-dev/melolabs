# PRD — Problem details (RFC 9457) por utilitário explícito

Referência: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros HTTP sempre no formato padrão do próprio framework (`HTTPError.toJSON()`, com `status`, `statusText`, `message`, `data`, `body`). Clientes que esperam o formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) não têm como receber erros nesse formato sem escrever o próprio serializador em cada rota.

### Objetivo

Permitir que um handler responda um erro no formato RFC 9457 (`application/problem+json`) chamando um utilitário explícito, `problem(input)`. Só as respostas que usam o utilitário mudam; todo o comportamento atual de `HTTPError` permanece igual.

## Requisitos funcionais

### RF-01 — Criar um erro de problema com `problem(input)`

A função `problem(input)` é exportada pelo pacote `h3` e devolve uma instância de `HTTPError`. Os campos de `input` seguem a mesma regra de `HTTPError`: `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`.

**Critério de aceite**

- **Dado** que `problem({ status: 404, message: "Usuário não encontrado" })` é chamado,
- **Quando** o retorno é inspecionado,
- **Então** ele é uma instância de `HTTPError` com `status` `404` e `message` `"Usuário não encontrado"`.

### RF-02 — Campos `type` e `instance` da RFC 9457

`input` aceita os campos opcionais `type` (URI que identifica o tipo do problema) e `instance` (URI que identifica a ocorrência). Se `type` não for informado, o valor usado é `"about:blank"`, conforme a RFC.

**Critério de aceite**

- **Dado** que `problem({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })` é respondido,
- **Quando** o corpo JSON é lido,
- **Então** ele contém `"type": "https://exemplo.com/erros/conflito"` e `"instance": "/pedidos/42"`.

- **Dado** que `problem({ status: 409, message: "Conflito" })` é respondido,
- **Quando** o corpo JSON é lido,
- **Então** ele contém `"type": "about:blank"`.

### RF-03 — Resposta no formato problem details

Quando um handler devolve ou lança um erro criado por `problem()`, a resposta usa o status do erro, o cabeçalho `Content-Type: application/problem+json` e um corpo JSON com `type`, `title`, `status`, `detail` e `instance`. O campo `title` recebe `statusText`; `detail` recebe `message`.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 422, statusText: "Dados inválidos", message: "E-mail é obrigatório" })`,
- **Quando** a requisição é processada,
- **Então** a resposta tem status `422`, `Content-Type` `application/problem+json`, e o corpo contém `"title": "Dados inválidos"` e `"detail": "E-mail é obrigatório"`.

### RF-04 — Membros de extensão

Os campos `data` e `body` de `input` aparecem no corpo da resposta problem details, com o mesmo significado que têm em `HTTPError`: `data` como a chave `data`; as chaves de `body` no nível superior do objeto.

**Critério de aceite**

- **Dado** um `problem({ status: 400, message: "Inválido", data: { campo: "email" }, body: { codigo: "E_CAMPO" } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo JSON contém `"data": { "campo": "email" }` e `"codigo": "E_CAMPO"` no nível superior.

### RF-05 — Cabeçalhos adicionais

Os `headers` informados em `input` são enviados na resposta problem details, junto com `Content-Type`.

**Critério de aceite**

- **Dado** um `problem({ status: 429, message: "Muitas requisições", headers: { "Retry-After": "30" } })`,
- **Quando** a resposta é gerada,
- **Então** a resposta contém o cabeçalho `Retry-After: 30` e `Content-Type: application/problem+json`.

### RF-06 — Erros marcados como não tratados

Quando `input` tem `unhandled: true`, a resposta problem details não expõe `detail` nem `data`, e não expõe a stack trace, da mesma forma que `HTTPError` faz hoje.

**Critério de aceite**

- **Dado** um `problem({ status: 500, message: "senha do banco vazou", data: { token: "x" }, unhandled: true })`,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém `"senha do banco vazou"` nem `"token"`, e contém `"status": 500`.

### RF-07 — Compatibilidade com o formato atual

Erros `HTTPError` criados sem `problem()` continuam sendo serializados exatamente como hoje, com o mesmo `Content-Type` e o mesmo corpo. A suíte de testes existente continua passando; apenas testes que dependam diretamente da mudança interna podem ser ajustados, sem perder o que verificam.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError.status(404, "Not Found")` sem usar `problem()`,
- **Quando** a requisição é processada,
- **Então** a resposta tem o mesmo `Content-Type` e o mesmo corpo JSON que tinha antes da mudança.

### RF-08 — Superfície pública e qualidade

O único nome público novo é `problem`, mais o tipo da entrada (`ProblemInput`). A entrada é tipada, de modo que campos desconhecidos em um literal de objeto são rejeitados pelo TypeScript. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** o código `problem({ status: 404, message: "x", campoInexistente: 1 })`,
- **Quando** o typecheck é executado,
- **Então** ele falha com erro de tipo, e `pnpm lint` e `pnpm typecheck` passam sem erros no restante do projeto.

## Fora de escopo

- Ativar o formato problem details globalmente (por exemplo, por opção de `H3` ou por `onError`). Só o uso explícito de `problem()` muda a resposta.
- Alterar a resposta padrão de `HTTPError` para todas as rotas.
- Suporte a `application/problem+xml` ou a outros formatos de problema.
- Validação do formato das URIs `type` e `instance`.
- Registro de tipos de problema ou catálogo de erros.
- Internacionalização das mensagens.
- Integração específica com Nitro ou outros frameworks.
- Novos nomes públicos além de `problem` e `ProblemInput`.

## Premissas e riscos

### Premissas

- O nome do tipo da entrada é `ProblemInput`. O pedido diz apenas "o tipo da sua entrada"; esse nome é uma escolha de implementação.
- A distinção entre erro de `problem()` e erro comum de `HTTPError` é feita por marcação interna, não exportada. Não há novo nome público para isso.
- `title` recebe `statusText`. Se `statusText` não for informado, o campo é omitido, e não é preenchido com o texto padrão do status.
- `data` e `body` seguem a semântica já definida em `HTTPError.toJSON()`.
- Os testes novos seguem o padrão `describeMatrix`, rodando nos modos `web` e `node`.
- O comportamento de `problem()` quando o erro é devolvido (e não lançado) pelo handler segue o mesmo caminho de `HTTPError` hoje. Isso precisa ser confirmado na implementação.

### Riscos

- **Vazamento de detalhes em erros não tratados.** Se a marcação de `unhandled` não for respeitada no novo formato, `message`, `data` ou a stack podem aparecer na resposta. Mitigação: RF-06 com teste de regressão.
- **Clientes que esperam `application/json`.** Como o formato é opt-in, o risco fica restrito às rotas que chamam `problem()`. Documentar a mudança de `Content-Type` nessas rotas.
- **Interação com o `cause`.** `HTTPError` usa a entrada como `cause`. Se `type` ou `instance` vazarem para a serialização padrão, a resposta de erros comuns pode mudar. Mitigação: RF-07.
- **Hooks de erro.** `onError` e o tratamento de erros globais podem reformatar a resposta e ignorar o formato problem details. Isso precisa ser verificado nos testes.
- **Nome público.** Qualquer nome extra exportado (um helper, uma constante) viola RF-08 e precisa ficar interno.
