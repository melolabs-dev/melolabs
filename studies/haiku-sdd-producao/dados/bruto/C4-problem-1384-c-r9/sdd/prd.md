# PRD — Problem details (RFC 9457) por utilitário explícito

Referência: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros via `HTTPError` com corpo JSON próprio (`statusCode`, `statusMessage`, `message`, `data`, `body`). Não existe formato padronizado para erros de API. Quem quer seguir a [RFC 9457 (Problem Details for HTTP APIs)](https://www.rfc-editor.org/rfc/rfc9457.html) precisa montar essa resposta à mão em cada handler, com risco de inconsistência entre rotas.

### Objetivo

Permitir que o handler responda erros no formato *problem details* (`application/problem+json`) chamando um utilitário explícito, `problem(input)`, exportado por `h3`. O formato muda apenas nas respostas que usam esse utilitário. Todo `HTTPError` já existente continua igual, e a API atual não quebra.

## Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado por `h3`

O pacote `h3` exporta a função `problem(input)`, que devolve uma instância de `HTTPError`. Nenhum outro nome público novo é criado além de `problem` e do tipo da sua entrada (`ProblemInput`).

**Critério de aceite**

- **Dado** que o módulo `h3` é importado,
- **Quando** o consumidor usa `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** o retorno é uma instância de `HTTPError` com `status` 404 e `message` igual ao informado.

### RF-02 — Entrada aceita os campos de `HTTPError` mais `type` e `instance`

`ProblemInput` aceita todos os campos da entrada de `HTTPError` (`ErrorInput`) e, como opcionais, `type` e `instance` da RFC 9457.

**Critério de aceite**

- **Dado** uma entrada com `type: "https://exemplo.com/erros/saldo"` e `instance: "/contas/42"`,
- **Quando** o utilitário `problem` é chamado com essa entrada,
- **Então** o `HTTPError` resultante guarda `type` e `instance`, e a entrada sem esses campos continua válida.

### RF-03 — Resposta em `application/problem+json`

Quando o `HTTPError` criado por `problem` chega ao cliente, a resposta tem `Content-Type: application/problem+json` e corpo JSON com os membros da RFC 9457: `type`, `title`, `status`, `detail` e `instance`.

Mapeamento adotado: `title` vem de `statusText` (ou, se ausente, do texto padrão do status); `detail` vem de `message`.

**Critério de aceite**

- **Dado** um handler que retorna ou lança `problem({ status: 422, statusText: "Entidade inválida", message: "Campo 'email' ausente", type: "https://exemplo.com/erros/validacao", instance: "/cadastros/7" })`,
- **Quando** a requisição é feita à rota,
- **Então** a resposta tem status 422, `Content-Type` `application/problem+json`, e o corpo JSON contém `type` = `https://exemplo.com/erros/validacao`, `title` = `Entidade inválida`, `status` = 422, `detail` = `Campo 'email' ausente` e `instance` = `/cadastros/7`.

### RF-04 — Valor padrão de `type`

Quando `type` não é informado, o corpo usa `about:blank`, conforme a RFC 9457. Quando `statusText` não é informado, `title` usa o texto padrão do status HTTP.

**Critério de aceite**

- **Dado** `problem({ status: 500, message: "Falha interna" })` sem `type` nem `statusText`,
- **Quando** a resposta é gerada,
- **Então** o corpo tem `type` = `about:blank` e `title` = o texto padrão de 500 (`Internal Server Error`).

### RF-05 — Respostas comuns não mudam

Erros criados com `new HTTPError(...)` ou com `createError(...)` mantêm o corpo e o `Content-Type` atuais. Somente erros criados por `problem` usam o formato da RFC 9457.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 400, message: "Requisição inválida" })`,
- **Quando** a requisição é feita,
- **Então** a resposta mantém o corpo JSON atual (com `statusCode`, `statusMessage`, `message`) e o `Content-Type` não é `application/problem+json`.

### RF-06 — Erros não tratados continuam ocultos

Quando um erro criado por `problem` é marcado como `unhandled`, a resposta não expõe `detail`, `data` nem stack trace, do mesmo modo que hoje ocorre com `HTTPError`.

**Critério de aceite**

- **Dado** um erro `problem({ status: 500, message: "segredo do banco", unhandled: true })`,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém a string `segredo do banco` nem stack trace.

### RF-07 — Campos `data` e `body` continuam disponíveis

Os campos `data` e `body` de `ProblemInput` são incluídos no corpo da resposta como membros de extensão da RFC 9457, sem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**

- **Dado** `problem({ status: 409, message: "Conflito", data: { campo: "email" } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo tem `data` = `{ "campo": "email" }` e os membros padrão continuam presentes com os valores corretos.

### RF-08 — Tipos públicos

`ProblemInput` é exportado com tipos completos e compatíveis com `ErrorInput`. Não há quebra de tipo nos chamadores de `HTTPError` e `createError`.

**Critério de aceite**

- **Dado** o projeto com `pnpm typecheck` e `pnpm lint`,
- **Quando** os comandos são executados após a mudança,
- **Então** ambos passam sem erros.

### RF-09 — Compatibilidade da suíte existente

A suíte de testes existente continua passando. Se algum teste depender do formato que a mudança altera, ele é ajustado apenas no ponto afetado, sem remover o que ele verifica. Há testes novos cobrindo RF-01 a RF-07, em modo `web` e `node` (`describeMatrix`).

**Critério de aceite**

- **Dado** a suíte completa (`pnpm vitest run`),
- **Quando** é executada após a mudança,
- **Então** todos os testes passam, e os testes novos cobrindo RF-01 a RF-07 estão presentes e passam nos dois modos.

## Fora de escopo

- Formato RFC 9457 aplicado automaticamente a todo `HTTPError`. Só `problem(...)` muda o formato.
- Negociação de conteúdo por cabeçalho `Accept` (por exemplo, devolver `problem+json` só quando o cliente pede).
- Registro ou catálogo de URIs de `type`, e páginas de documentação para cada tipo.
- Membros de extensão tipados além de `data` e `body`.
- Mudança do formato de erros de validação (`readValidatedBody` e similares) por padrão.
- Integração com `h3/nitro` ou outros pacotes que consomem o h3.
- Novos nomes públicos além de `problem` e `ProblemInput`.
- Localização das mensagens de erro.
- Alterações em `_deprecated.ts` (compatibilidade v1).
- Benchmarks de desempenho.

## Premissas e riscos

### Premissas

- A API atual de `HTTPError` e `createError` é mantida como está; `problem` é uma camada aditiva.
- O caminho de serialização de erros (`toResponse` e o tratamento de erro do `H3`) consegue distinguir um erro criado por `problem` de um `HTTPError` comum, por exemplo por uma marca interna não enumerável seguindo a convenção `~` do projeto. A escolha exata fica para o design técnico.
- `statusText` e `message` existentes mapeiam para `title` e `detail` sem ambiguidade.
- `application/problem+json` é o media type de referência, sem parâmetros adicionais.

### Riscos

- **Cabeçalho sobrescrito:** algum middleware ou o tratamento de erro pode reescrever o `Content-Type` depois da serialização, anulando RF-03. Mitigação: teste de integração que verifica o cabeçalho final nos dois modos.
- **Vazamento de detalhes:** erros `unhandled` podem expor `detail` ou `data` se o caminho do problem não reutilizar as regras de ocultação. Mitigação: RF-06 coberto por teste.
- **Dois formatos no mesmo app:** clientes podem receber corpos diferentes para erros parecidos, o que é esperado por escopo, mas precisa estar documentado. Mitigação: documentação curta do utilitário.
- **Colisão de nomes:** `problem` é um nome genérico e pode conflitar com variáveis de usuário em código que faz `import *`. Mitigação: revisar exports existentes antes de publicar.
- **Quebra de tipos:** mudar `ErrorInput` ou `ErrorBody` pode afetar consumidores. Mitigação: `ProblemInput` estende `ErrorInput` sem alterar o tipo original (RF-08).
