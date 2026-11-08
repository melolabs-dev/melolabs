# PRD — Problem Details (RFC 9457) via utilitário explícito `problem()`

Referência: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros (`HTTPError`) com um JSON próprio: `status`, `statusText`, `message`, `data` e as propriedades extras de `body`, com `content-type: application/json`. Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs). Clientes e gateways que esperam `application/problem+json` e os membros `type`, `title`, `status`, `detail` e `instance` precisam de adaptação manual em cada handler.

### Objetivo

Permitir que um handler responda um erro no formato problem details, chamando um utilitário explícito. A função `problem(input)` é exportada por `h3` e devolve um `HTTPError`. Só as respostas que usam o utilitário mudam. Os erros existentes (lançados com `HTTPError`, `HTTPError.status` ou erros não tratados) continuam com o formato atual.

### Métricas de sucesso

- Um handler que faz `throw problem({...})` produz uma resposta válida segundo a RFC 9457, em JSON.
- Nenhum teste existente perde cobertura. Os testes ajustados continuam verificando o mesmo comportamento.
- `pnpm lint`, `pnpm typecheck` e `pnpm test` passam.

## 2. Requisitos funcionais

### RF-01 — Função `problem(input)` exportada por `h3`

`problem` é exportada pelo ponto de entrada público `h3` (`src/index.ts`) e devolve uma instância de `HTTPError`. Isso permite usá-la com `throw` ou `return`, como qualquer outro erro do h3.

**Critério de aceite**

- **Dado** que importo `problem` de `h3`,
- **Quando** chamo `problem({ status: 404 })`,
- **Então** recebo uma instância de `HTTPError` (`HTTPError.isError(...)` é verdadeiro) com `status` igual a 404.

### RF-02 — Tipo de entrada com campos de `HTTPError` mais `type` e `instance`

O `input` aceita todos os campos do objeto de entrada de `HTTPError` (`ErrorInput`: `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause` e os campos legados) e, adicionalmente, `type` e `instance` opcionais, ambos strings (URI reference, conforme a RFC 9457). O tipo da entrada é exportado. É o único nome público novo além de `problem`.

**Critério de aceite**

- **Dado** um `input` com `status`, `message`, `headers`, `data` e os campos opcionais `type` e `instance`,
- **Quando** o chamo em `problem(input)` sob `pnpm typecheck`,
- **Então** compila sem erros, e um `type` ou `instance` que não seja string falha na checagem de tipos.

### RF-03 — Corpo da resposta no formato problem details

Quando o erro criado por `problem()` é convertido em resposta, o corpo JSON contém os membros da RFC 9457:

- `type`: o valor informado. Se omitido, o membro é omitido (a RFC assume `about:blank`).
- `title`: `statusText` se informado, senão omitido.
- `status`: o código HTTP.
- `detail`: a `message` informada, quando houver.
- `instance`: o valor informado. Se omitido, o membro é omitido.

Os campos de `data` e `body` são tratados como membros de extensão (RF-05).

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 403, statusText: "Forbidden", message: "Saldo insuficiente", type: "https://example.com/probs/saldo", instance: "/contas/123" })`,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status 403 e o corpo JSON contém `type`, `title: "Forbidden"`, `status: 403`, `detail: "Saldo insuficiente"` e `instance`, com os valores informados.

### RF-04 — Content-Type `application/problem+json`

A resposta de um erro criado por `problem()` usa `content-type: application/problem+json` (com charset UTF-8, como o restante das respostas JSON do h3). Se o handler informar um `content-type` próprio em `headers`, esse valor prevalece, como já ocorre com os headers de erro hoje.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 400 })` sem `headers`,
- **Quando** o cliente faz a requisição,
- **Então** o header `content-type` da resposta começa com `application/problem+json`.

### RF-05 — Membros de extensão

Os campos de `body` são mesclados no nível raiz do JSON, como membros de extensão da RFC 9457. O conteúdo de `data` continua disponível sob a chave `data`. Membros de extensão não podem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`) definidos pelo utilitário.

**Critério de aceite**

- **Dado** `problem({ status: 422, body: { errors: [{ campo: "nome" }], status: 200 } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `errors` na raiz e `status` igual a 422, não 200.

### RF-06 — Erros comuns do h3 permanecem inalterados

Erros que não vêm de `problem()` mantêm o formato e o `content-type` atuais: `HTTPError` lançado diretamente, `HTTPError.status(...)`, 404 de rota não encontrada, erros de validação e erros não tratados. O utilitário não altera configuração global nem o comportamento padrão.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 400, message: "ruim" })`,
- **Quando** o cliente faz a requisição,
- **Então** o corpo tem o formato atual (`status`, `statusText`, `message`, ...) e o `content-type` continua `application/json`.

### RF-07 — Erros problem details não vazam informação em modo não tratado

Se o erro de `problem()` for marcado como `unhandled`, ou vier de uma causa não tratada, valem as proteções atuais. `detail`, `data`, `body`, `type` e `instance` não são expostos, e a resposta não revela a mensagem original. O modo `debug` continua acrescentando `stack`, como hoje.

**Critério de aceite**

- **Dado** `problem({ status: 500, message: "segredo interno", unhandled: true })`,
- **Quando** a resposta é gerada sem `debug`,
- **Então** o corpo não contém o texto "segredo interno".

### RF-08 — Funciona em todos os runtimes da matriz de testes

O comportamento é idêntico nos modos `web` e `node` de `describeMatrix`, com cobertura de testes novos para RF-01 a RF-07 e ajuste mínimo apenas dos testes existentes afetados.

**Critério de aceite**

- **Dado** os novos testes escritos com `describeMatrix`,
- **Quando** executo `pnpm vitest run` nos arquivos de teste de erro,
- **Então** todos passam nos modos `web` e `node`, e a suíte completa (`pnpm test`) continua verde.

## 3. Fora de escopo

- Ativar problem details globalmente, por configuração de `H3` ou por negociação de `Accept`.
- Converter automaticamente os erros existentes (404, validação, erros não tratados) para o novo formato.
- Representação XML da RFC 9457 (`application/problem+xml`).
- Registro, validação ou resolução dos URIs de `type` e `instance`, e catálogo de tipos de problema.
- Novos utilitários públicos além de `problem` e do tipo da sua entrada (por exemplo helpers por status).
- Mudanças no `HTTPError`, na assinatura de `HTTPError.status` ou em integrações como `nitro`.
- Mudança de comportamento dos erros já existentes. Os testes só são ajustados se dependerem de algo que esta mudança altere.

## 4. Premissas e riscos

### Premissas

- Uma implementação mínima depende de `HTTPError` carregar `type`, `instance` e o modo de serialização, sem criar nome público novo. Isso é decisão de design, não de produto.
- `title` é preenchido com `statusText`. A RFC pede um resumo estável por tipo de problema. Na ausência de `statusText`, o membro é omitido em vez de inventado.
- O `message` do `HTTPError` vira `detail`. O formato atual continua usando `message`.
- A resposta mantém o status HTTP do erro e o mesmo mecanismo de mesclagem de headers de `errorResponse` (`src/response.ts`).
- O ponto de entrada público é `src/index.ts`, sem barrel files. O código novo segue as convenções do `AGENTS.md` (ESM, imports com `.ts`, arquivos curtos, tipos estritos com `isolatedDeclarations`).

### Riscos

- **Vazamento da marca no `HTTPError`:** `toJSON()` é usado em `errorResponse` e possivelmente em outros pontos (hooks, tracing, testes). Alterá-lo pode mudar saídas existentes. Mitigação: manter o `toJSON()` atual e decidir a serialização problem details apenas em `errorResponse`, com teste de regressão (RF-06).
- **Nome público a mais:** exportar o tipo de entrada é necessário, mas qualquer outro símbolo exportado viola o contrato. Mitigação: conferir os exports finais de `src/index.ts`.
- **Conflito de chaves:** `body` e `data` podem colidir com membros padrão (RF-05). Mitigação: os membros padrão têm precedência, com teste.
- **Erros de outros módulos:** `HTTPError.isError` aceita erros "com forma de HTTPError" de outros pacotes. Esses não passam por `problem()` e seguem o formato atual.
- **Testes existentes:** se algum teste comparar o conjunto exato de exports de `h3` ou a forma de `HTTPError`, será afetado. O ajuste deve preservar o que ele verifica.
- **Ambiguidade de `detail` e `message` em `unhandled`:** a proteção atual esconde a mensagem. O comportamento deve ser mantido (RF-07) e verificado nos dois runtimes.
