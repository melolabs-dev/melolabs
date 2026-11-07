# PRD — Problem details (RFC 9457) por utilitário explícito

Referência: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## Problema e objetivo

### Problema

O h3 serializa erros (`HTTPError`) apenas no formato próprio em JSON (`status`, `statusText`, `message`, `data`, `body`). Não há como um handler responder um erro no formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), que a issue #1384 pede para o ecossistema.

### Objetivo

Exportar a função `problem(input)` do pacote `h3`. Ela devolve um `HTTPError` que, quando respondido, usa o formato RFC 9457 (`application/problem+json`). Só as respostas criadas com `problem()` mudam. Nenhum erro existente muda de formato.

## Requisitos funcionais

### RF-01 — Utilitário `problem` exportado

A função `problem(input)` é exportada pelo entry principal de `h3` e devolve uma instância de `HTTPError`. Os únicos nomes públicos novos são `problem` e o tipo do seu objeto de entrada.

**Critério de aceite**

- **Dado** um handler que importa `problem` de `h3`
- **Quando** ele chama `problem({ status: 404, message: "Não encontrado" })`
- **Então** o retorno é uma instância de `HTTPError`, e `HTTPError.isError(erro)` é `true`.

### RF-02 — Campos de entrada

O objeto de entrada aceita os campos de `ErrorInput` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`) e mais os campos opcionais `type` e `instance` da RFC 9457. Se `type` não for informado, o valor usado é `about:blank`, conforme a RFC.

**Critério de aceite**

- **Dado** `problem({ status: 403, message: "Sem acesso", type: "https://exemplo.com/erros/sem-acesso", instance: "/pedidos/42" })`
- **Quando** o erro é respondido
- **Então** o corpo contém `type: "https://exemplo.com/erros/sem-acesso"` e `instance: "/pedidos/42"`.

**Critério de aceite (padrão)**

- **Dado** `problem({ status: 403, message: "Sem acesso" })`
- **Quando** o erro é respondido
- **Então** o corpo contém `type: "about:blank"` e não contém `instance`.

### RF-03 — Mapeamento para o corpo RFC 9457

O corpo JSON segue a RFC 9457:

- `type` — de `type` ou `about:blank`.
- `title` — de `statusText`. Se `statusText` não for informado, o campo é omitido.
- `status` — de `status`, já sanitizado como em `HTTPError`.
- `detail` — de `message`.
- `instance` — de `instance`, quando informado.
- Membros de extensão: `data` e as propriedades de `body`, no topo do objeto, como hoje em `HTTPError`.

**Critério de aceite**

- **Dado** `problem({ status: 404, statusText: "Not Found", message: "Pedido inexistente", data: { id: 42 } })`
- **Quando** o erro é respondido
- **Então** o corpo JSON tem `status: 404`, `title: "Not Found"`, `detail: "Pedido inexistente"`, `type: "about:blank"` e `data: { id: 42 }`.

### RF-04 — Content-Type e headers

A resposta de um erro criado com `problem()` tem `Content-Type: application/problem+json`. Os headers informados em `headers` são mantidos. O `Content-Type` do `problem()` prevalece sobre um `Content-Type` informado em `headers`.

**Critério de aceite**

- **Dado** `problem({ status: 429, message: "Muitas requisições", headers: { "retry-after": "30" } })`
- **Quando** o erro é respondido
- **Então** a resposta tem `content-type: application/problem+json` e `retry-after: 30`.

### RF-05 — Erros não tratados

Um erro criado com `problem()` e marcado como `unhandled` segue a mesma regra de `HTTPError`: a mensagem original não aparece no corpo fora do modo debug, e `data` não é exposto.

**Critério de aceite**

- **Dado** `problem({ status: 500, message: "senha do banco vazou", data: { x: 1 }, unhandled: true })`
- **Quando** o erro é respondido fora do modo debug
- **Então** o corpo não contém `"senha do banco vazou"` nem `data`, e o status continua `500`.

### RF-06 — Compatibilidade com erros existentes

Erros que não passam por `problem()` mantêm o mesmo status, corpo e `Content-Type` de hoje. Nenhum tipo, método ou comportamento existente é removido ou alterado.

**Critério de aceite**

- **Dado** um handler que faz `throw new HTTPError("Inválido", { status: 400 })`
- **Quando** o erro é respondido
- **Então** o `Content-Type` não é `application/problem+json` e o corpo tem o formato atual (`status`, `statusText`, `message`, `data`).

### RF-07 — Testes nos dois modos e qualidade

Os testes novos usam `describeMatrix`, rodando em `web` e `node`. A suíte existente continua passando. Só testes existentes que dependem de algo alterado podem ser ajustados, sem perder a verificação original. `pnpm lint` e a checagem de tipos passam.

**Critério de aceite**

- **Dado** os testes de `problem()` escritos com `describeMatrix`
- **Quando** `pnpm vitest run` é executado para esses arquivos e depois `pnpm lint`
- **Então** todos os testes passam nos alvos `web` e `node`, e o lint e a checagem de tipos terminam sem erro.

## Fora de escopo

- Opção global no `H3` para trocar o formato de todos os erros. A issue #1384 pede isso, mas esta variante (#1384-C) é explicitamente por utilitário.
- Negociação de conteúdo pelo header `Accept`.
- Registro de tipos de problema ou de membros de extensão, e resolução ou validação da URI `type`.
- Qualquer mudança em `HTTPError`, em `toJSON` ou no formato padrão de erro.
- Nomes públicos novos além de `problem` e do tipo da sua entrada.
- Documentação extensa no site; basta o JSDoc mínimo que o projeto já usa.

## Premissas e riscos

### Premissas

- `message` é mapeado para `detail` e `statusText` para `title`, como a RFC sugere. Esse mapeamento é uma decisão de projeto a confirmar.
- `type` padrão é `about:blank` e `title` é omitido quando não há `statusText`. Também a confirmar.
- Membros de extensão (`data` e `body`) ficam no topo, como já acontece com `HTTPError`, em vez de aninhados.
- O `Content-Type` é exatamente `application/problem+json`, sem parâmetros.
- O caminho de serialização do erro (`toResponse` e o tratamento de erros em `src/h3.ts`) é único para web e node. Isso ainda não foi verificado no código; a implementação deve confirmar.

### Riscos

- **Expectativa diferente da issue:** quem espera o formato RFC 9457 global vai achar a variante limitada. Fica registrado como fora de escopo.
- **Colisão de nome:** `problem` é um nome curto e pode colidir com código de aplicações que importam de `h3`. Não há alias neste escopo.
- **Vazamento em erros não tratados:** se a regra de `unhandled` for aplicada na camada errada, dados internos podem aparecer no `detail` ou em `data`. O RF-05 existe para cobrir isso.
- **Leitura de `message` no cliente:** clientes que leem `message` em respostas de erro vão ver o conteúdo em `detail` nas respostas de `problem()`. Isso só afeta respostas novas.
- **Ajuste de testes existentes:** se algum teste existente depender de detalhes que mudam, o ajuste precisa preservar o que ele verifica (está explícito na restrição do contrato).
