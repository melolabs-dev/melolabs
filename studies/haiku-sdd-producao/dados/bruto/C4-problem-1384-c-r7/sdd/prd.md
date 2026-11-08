# PRD — Problem details (RFC 9457) via utilitário explícito

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato enxuto #1384-C).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre no formato JSON próprio, produzido por `HTTPError.toJSON()` (`src/error.ts`) e serializado em `src/response.ts`. Quem precisa de respostas de erro no formato [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (problem details) não tem como obtê-lo sem escrever a serialização à mão em cada handler.

### Objetivo

Permitir que um handler responda erros no formato RFC 9457 chamando um utilitário explícito, `problem(input)`, exportado por `h3`. Apenas as respostas produzidas por esse utilitário mudam de formato. Todo o restante do comportamento atual permanece idêntico.

### Fora do objetivo principal

Não há mudança de padrão global: o h3 não passa a responder em `application/problem+json` por padrão nem por negociação de `Accept`.

## Requisitos funcionais

### RF-01 — Utilitário `problem` exportado pelo `h3`

A função `problem(input)` é exportada pelo pacote `h3` e devolve uma instância de `HTTPError`. Os campos de `input` que já existem no objeto de entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`) continuam com o mesmo significado.

**Critério de aceite:**

- **Dado** que o módulo `h3` é importado,
- **Quando** o código chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** o valor devolvido é `instanceof HTTPError`, com `status` 404 e `message` "Usuário não encontrado".

### RF-02 — Campos `type` e `instance` na entrada

A entrada de `problem` aceita os campos opcionais `type` e `instance` da RFC 9457. O tipo da entrada se chama `ProblemInput` e é o único nome público novo além de `problem`.

**Critério de aceite:**

- **Dado** que `problem({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })` é chamado,
- **Quando** o erro é lido,
- **Então** `type` e `instance` têm exatamente esses valores e a chamada não gera erro de tipo no TypeScript.

### RF-03 — Resposta em `application/problem+json`

Quando um handler lança um erro criado por `problem`, a resposta usa o `Content-Type` `application/problem+json` e um corpo JSON com os membros `type`, `title`, `status`, `detail` e `instance`.

**Critério de aceite:**

- **Dado** uma rota que lança `problem({ status: 422, statusText: "Unprocessable Content", message: "Campo 'email' inválido", type: "https://exemplo.com/erros/validacao", instance: "/cadastro/7" })`,
- **Quando** a rota recebe uma requisição,
- **Então** a resposta tem status 422, `Content-Type` `application/problem+json` e corpo JSON com `type` "https://exemplo.com/erros/validacao", `title` "Unprocessable Content", `status` 422, `detail` "Campo 'email' inválido" e `instance` "/cadastro/7".

### RF-04 — `type` padrão e membros de extensão

Se `type` não for informado, o corpo traz `type` igual a `"about:blank"`, como a RFC 9457 prevê. Os campos `data` e `body` da entrada aparecem como membros de extensão do corpo: `body` é espalhado no nível superior e `data` fica sob a chave `data`.

**Critério de aceite:**

- **Dado** `problem({ status: 400, message: "Requisição inválida", data: { campo: "nome" }, body: { codigo: "E_CAMPO" } })` lançado por uma rota,
- **Quando** a rota recebe uma requisição,
- **Então** o corpo JSON contém `type` "about:blank", `status` 400, `detail` "Requisição inválida", `data` `{ "campo": "nome" }` e `codigo` "E_CAMPO" no nível superior.

### RF-05 — Erros fora de `problem` mantêm o formato atual

Erros criados com `new HTTPError(...)`, `HTTPError.status(...)` ou por qualquer outro caminho que não seja `problem` continuam sendo serializados exatamente como hoje.

**Critério de aceite:**

- **Dado** uma rota que lança `HTTPError.status(404, "Not Found", { message: "Não encontrado" })`,
- **Quando** a rota recebe uma requisição,
- **Então** a resposta mantém o corpo atual (`status`, `statusText`, `unhandled`, `message`, `data`) e o `Content-Type` que já era enviado antes da mudança.

### RF-06 — Erros não tratados não vazam detalhes

Um erro `problem` marcado como `unhandled` (erro interno encapsulado pelo framework) segue a mesma regra de mascaramento do `HTTPError` atual: o `detail` vira "HTTPError", e `data` e `body` não aparecem no corpo.

**Critério de aceite:**

- **Dado** um erro `problem({ status: 500, message: "senha do banco vazou", data: { segredo: "x" }, unhandled: true })` lançado por uma rota,
- **Quando** a rota recebe uma requisição,
- **Então** o corpo JSON tem `status` 500 e `detail` "HTTPError", e não contém "senha do banco vazou" nem `data`.

### RF-07 — Headers da entrada

Os `headers` informados em `problem` são aplicados à resposta. O `Content-Type` `application/problem+json` é definido pelo utilitário, a menos que `headers` informe um `Content-Type` explicitamente, caso em que o valor informado prevalece.

**Critério de aceite:**

- **Dado** `problem({ status: 429, message: "Muitas requisições", headers: { "Retry-After": "30" } })` lançado por uma rota,
- **Quando** a rota recebe uma requisição,
- **Então** a resposta tem o header `Retry-After: 30` e `Content-Type` `application/problem+json`.

### RF-08 — Compatibilidade em todos os runtimes

O comportamento de RF-03 a RF-07 vale nos modos `web` e `node` dos testes com `describeMatrix`.

**Critério de aceite:**

- **Dado** a suíte de testes com `describeMatrix` para `problem`,
- **Quando** `pnpm vitest run` executa os testes,
- **Então** os casos passam nos dois modos (`web` e `node`).

### RF-09 — Suíte existente e qualidade

Nenhum teste existente deve quebrar por causa desta mudança. Se algum teste depender do que a mudança altera, ele pode ser ajustado, sem remover o que verifica. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite:**

- **Dado** o repositório após a mudança,
- **Quando** `pnpm lint`, `pnpm typecheck` e a suíte completa rodam,
- **Então** todos passam, e nenhum teste existente foi removido.

## Fora de escopo

- Mudar o formato padrão de erros do h3 ou negociar o formato por `Accept`.
- Converter automaticamente erros de validação (`validate`, `readValidatedBody`) em problem details.
- Aplicar problem details a respostas de JSON-RPC, WebSocket ou às regras de rota (`h3/rules`).
- Criar registro de tipos de problema ou URLs de documentação para `type`.
- Traduzir `title` ou `detail` por idioma.
- Integração com Nitro ou outros frameworks.
- Novos nomes públicos além de `problem` e `ProblemInput`.

## Premissas e riscos

### Premissas

- A serialização de erros acontece em `src/response.ts` (ponto em que `error.toJSON()` é espalhado no corpo), e é nesse ponto que a diferença de formato deve ser aplicada. Verificado por leitura do código; a implementação deve confirmar o caminho completo.
- `title` é o `statusText` do erro. Quando não houver `statusText`, o campo pode ser omitido, pois a RFC 9457 o trata como opcional.
- `status` segue a sanitização já existente (`sanitizeStatusCode`).

### Riscos

- **Marcar o erro como problem sem novo nome público.** O erro precisa carregar `type` e `instance` e saber que deve usar o formato RFC 9457. Isso deve ser feito sem exportar nomes novos e sem alterar o formato de quem não usa `problem`. Pode exigir uma marca interna no objeto.
- **Propagação por `cause`.** `HTTPError` herda `status` e `headers` de `cause`. Se um `problem` for passado como `cause` de outro erro, o formato resultante pode surpreender. Precisa de teste.
- **Conflito de `Content-Type`.** A regra de RF-07 precisa ser verificada para não sobrescrever o header informado pelo usuário.
- **Colisão de nomes de membros de extensão.** `body` pode trazer chaves que colidam com `type`, `title`, `status`, `detail` ou `instance`. A regra de precedência precisa ser definida (sugestão: os membros da RFC prevalecem) e testada.
- **Interação com `unhandled`.** A máscara de RF-06 deve ser idêntica à atual para evitar vazamento de detalhes.
