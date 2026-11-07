# PRD — Problem details (RFC 9457) via utilitário `problem()`

Base: `sdd/pedido.md` (issue h3js/h3#1384 e contrato enxuto #1384-C).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre com `Content-Type: application/json` e com o corpo montado por `HTTPError.toJSON()` (`status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`). Quem consome a API e espera o formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) não tem como obtê-lo sem escrever essa resposta à mão em cada handler.

### Objetivo

Permitir que um handler responda um erro no formato RFC 9457 por meio de um utilitário explícito, `problem(input)`, exportado por `h3`. Só as respostas criadas com esse utilitário mudam; todos os demais erros continuam exatamente como são hoje.

## Requisitos funcionais

### RF-01 — Função `problem` cria um `HTTPError`

A função `problem(input)` é exportada pelo pacote `h3` e recebe os campos de entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`). Ela devolve uma instância de `HTTPError`, para que possa ser lançada ou retornada como os demais erros.

**Critério de aceite**

- **Dado** um handler que chama `problem({ status: 404, message: "Usuário não encontrado" })`
- **Quando** o handler lança ou retorna esse valor
- **Então** a resposta tem status `404` e o `instanceof`/`HTTPError.isError` do valor devolvido é verdadeiro.

### RF-02 — Campos `type` e `instance` no corpo

A entrada de `problem` aceita os campos opcionais `type` e `instance` da RFC 9457. Quando informados, eles aparecem no corpo JSON como propriedades de nível superior.

**Critério de aceite**

- **Dado** `problem({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })`
- **Quando** a resposta é serializada
- **Então** o corpo JSON contém `"type": "https://exemplo.com/erros/sem-saldo"` e `"instance": "/pagamentos/42"` no nível superior.

- **Dado** `problem({ status: 403 })`, sem `type` nem `instance`
- **Quando** a resposta é serializada
- **Então** o corpo JSON não contém as chaves `type` nem `instance`.

### RF-03 — Content-Type `application/problem+json`

A resposta gerada a partir de um erro criado por `problem` usa `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 400, message: "Campo inválido" })`
- **Quando** a requisição é atendida
- **Então** o header `content-type` da resposta é `application/problem+json`.

### RF-04 — Demais erros não mudam

Erros criados sem `problem` (com `new HTTPError`, `HTTPError.status`, erros não tratados ou erros lançados pelo próprio h3) continuam com `Content-Type: application/json` e com a mesma forma de corpo de hoje.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 400, message: "Ruim" })`
- **Quando** a requisição é atendida
- **Então** o `content-type` é `application/json` e o corpo tem exatamente as mesmas chaves de antes da mudança (`status`, `statusText`, `unhandled`, `message`, `data`).

### RF-05 — Erros não tratados continuam ocultos

Quando `problem` recebe `unhandled: true`, a resposta mantém a regra atual: `message` vira `"HTTPError"` e `data` não é enviado, para não vazar detalhes internos.

**Critério de aceite**

- **Dado** `problem({ status: 500, message: "senha do banco vazou", unhandled: true })`
- **Quando** a resposta é serializada
- **Então** o corpo tem `"message": "HTTPError"`, não contém `data` e não contém o texto "senha do banco vazou".

### RF-06 — Tipo da entrada exportado

O tipo TypeScript da entrada de `problem` é exportado pelo pacote `h3`, com o nome `ProblemInput`. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** um projeto TypeScript que importa `{ problem, type ProblemInput } from "h3"`
- **Quando** o projeto roda `tsc --noEmit`
- **Então** a compilação passa, e `problem({ status: 400, type: 123 })` gera erro de tipo.

### RF-07 — Compatibilidade do que já existe

A suíte de testes existente continua passando. Se algum teste existente depender de um detalhe que a mudança altera, ele é ajustado somente nesse ponto, sem remover o que ele verifica.

**Critério de aceite**

- **Dado** a suíte atual do projeto, antes da mudança
- **Quando** a mudança é aplicada e `pnpm test` é executado
- **Então** todos os testes passam, e qualquer alteração em teste existente está restrita ao detalhe afetado e é justificada no PR.

## Fora de escopo

- Converter todos os erros do h3 para RFC 9457 automaticamente, ou criar uma opção global para isso.
- Negociação de conteúdo por header `Accept` (devolver `application/json` ou `application/problem+json` conforme o cliente pede).
- Mapear `title` ou `detail` da RFC 9457 automaticamente a partir de `statusText` ou `message`.
- Extensões de problem details além de `type` e `instance`.
- Validar que `type` é uma URI absoluta ou que existe uma página de documentação no endereço informado.
- Alterações no pacote `nitro` ou em outros projetos que consomem o h3.
- Documentação extensa além do necessário para o uso do novo utilitário.

## Premissas

- O `HTTPError` já serializa os campos de `body` no nível superior do JSON (`toJSON()` faz spread de `body` quando o erro não é `unhandled`). Por isso `type` e `instance` podem ser levados por `body`, sem mudar a classe `HTTPError`.
- O `Content-Type` pode ser sobrescrito pelo `headers` do próprio erro: `errorResponse` aplica `mergeHeaders(jsonHeaders, error.headers)` e `mergeHeaders` usa `set`. Isso foi verificado lendo `src/response.ts`, mas ainda não foi testado.
- O script `pnpm lint` roda `oxlint` e `oxfmt --check`, e `pnpm typecheck` roda `tsc --noEmit`. Ambos existem em `package.json`.
- O nome `ProblemInput` é o único nome público novo além de `problem`, conforme a restrição do contrato.

## Riscos e pontos em aberto

- **Forma do corpo não é totalmente RFC 9457.** A RFC pede `title` e `detail`; o h3 envia `statusText` e `message`. Pelo contrato, o corpo continua com os campos atuais, então o resultado é um problem details parcial. Decidir se isso basta ou se `problem` deve também emitir `title`/`detail`.
- **`type` ausente.** A RFC define `about:blank` como valor padrão. Pelo contrato o campo é omitido quando não informado; isso é um desvio aceitável, mas precisa ser decidido.
- **Colisão de chaves.** Como `body` é espalhado no topo do JSON, uma chave `type` ou `instance` dentro de `body` pode sobrescrever o campo do utilitário. Definir a prioridade ou rejeitar a colisão.
- **Clientes existentes.** Consumidores que comparam `Content-Type` com `application/json` exato deixam de reconhecer a resposta do utilitário. O risco fica restrito às respostas que usam `problem`, mas deve aparecer na documentação.
- **`headers` do usuário.** Se o usuário passar `content-type` em `headers`, a regra de qual valor prevalece precisa ser fixada e testada.
- **Cobertura entre runtimes.** Os testes devem usar `describeMatrix` para cobrir `web` e `node`, como manda o AGENTS.md.
