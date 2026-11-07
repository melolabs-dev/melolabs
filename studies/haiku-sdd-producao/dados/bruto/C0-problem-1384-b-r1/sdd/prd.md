# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Referência: issue h3js/h3#1384, contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 serializa erros (`HTTPError`) como JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data` e propriedades de `body`), com `content-type: application/json`. Esse formato não segue um padrão conhecido: clientes, gateways e ferramentas de observabilidade que entendem a RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretá-lo de forma genérica. A issue #1384 pede esse suporte.

### Objetivo

Fazer o h3 responder **todos** os erros no formato "problem details" da RFC 9457 (representação JSON), como formato padrão, **sem configuração nem gatilho novo**. O novo formato substitui o formato de erro atual. Além disso, `HTTPError` passa a aceitar e expor os campos opcionais `type` e `instance` da RFC.

### Resultado esperado

- Toda resposta de erro gerada pelo h3 é um objeto de problem details válido, com media type `application/problem+json`.
- Desenvolvedores podem informar `type` e `instance` ao criar um `HTTPError`.
- Nenhuma API pública além de `type` e `instance` em `HTTPError` é adicionada.

## Requisitos funcionais

### RF-01 — Corpo de erro no formato problem details

O corpo JSON de toda resposta de erro contém os membros padrão da RFC 9457: `status` (código HTTP), `title` (resumo curto do tipo de problema, derivado do `statusText` quando houver, senão do texto padrão do status) e `detail` (explicação específica da ocorrência, derivada de `message`). Os membros `type` e `instance` só aparecem quando informados.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 404 e o corpo JSON contém `status: 404`, `title` não vazio e `detail: "Usuário não encontrado"`, sem os membros `type` e `instance`.

### RF-02 — Content-Type `application/problem+json`

As respostas de erro usam `content-type: application/problem+json` (mantendo o charset hoje usado), em vez de `application/json`.

**Critério de aceite**

- **Dado** qualquer handler que lança um `HTTPError`
- **Quando** o cliente recebe a resposta de erro
- **Então** o cabeçalho `content-type` começa com `application/problem+json`.

### RF-03 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` (string, URI de referência do tipo de problema) e `instance` (string, URI de referência da ocorrência). Ambos ficam expostos como propriedades somente leitura da instância (`error.type`, `error.instance`) e são `undefined` quando omitidos. Também valem nos caminhos que repassam detalhes ao construtor (`HTTPError.status(...)`, segundo argumento da forma `new HTTPError(message, details)` e `cause` com esses campos).

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/contas/42" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** os valores são exatamente os informados; e, sem esses campos, ambos são `undefined`.

### RF-04 — Serialização de `type` e `instance`

Quando definidos, `type` e `instance` são serializados no corpo da resposta e em `HTTPError#toJSON()`. Quando ausentes, não aparecem no JSON (sem `null`). Para `type` ausente não se emite valor padrão; a RFC trata a ausência como `"about:blank"`.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError` com `type` e `instance` definidos
- **Quando** o cliente lê o corpo JSON da resposta
- **Então** o corpo contém `type` e `instance` com os valores informados, junto de `status`, `title` e `detail`.

### RF-05 — Extensões: `data` e `body`

Os mecanismos atuais de extensão continuam funcionando como membros de extensão da RFC 9457: `data` permanece sob a chave `data` e as propriedades de `body` continuam espalhadas no nível superior. Membros padrão (`type`, `title`, `status`, `detail`, `instance`) não podem ser sobrescritos por `body`.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 422, data: { campo: "email" }, body: { codigo: "E42", status: 200 } })`
- **Quando** o cliente lê o corpo da resposta
- **Então** `data` é `{ campo: "email" }`, `codigo` é `"E42"` e `status` continua `422`.

### RF-06 — Erros não tratados continuam protegidos

Erros com `unhandled: true` (ou convertidos de erros genéricos) não vazam `message`, `data`, `body` nem stack fora do modo debug. O `detail` desses erros não expõe a mensagem original. Em modo debug, o `stack` continua sendo incluído como hoje.

**Critério de aceite**

- **Dado** um handler que lança `new Error("segredo interno")` fora do modo debug
- **Quando** o cliente recebe a resposta 500
- **Então** o corpo está no formato problem details, não contém "segredo interno" nem `stack`, e o `content-type` é `application/problem+json`.

### RF-07 — Cabeçalhos, status e statusText preservados

Cabeçalhos definidos no erro (`headers`), o status HTTP e o `statusText` da resposta continuam sendo aplicados como hoje. Respostas sem corpo (HEAD, 204, 304 etc.) continuam sem corpo.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 401, statusText: "Unauthorized", headers: { "www-authenticate": "Basic" } })`
- **Quando** o cliente recebe a resposta
- **Então** o status é 401, o `statusText` é "Unauthorized", o cabeçalho `www-authenticate` está presente e o corpo está no formato problem details.

### RF-08 — Cobertura de todos os caminhos de erro

O formato vale para todo caminho que hoje gera resposta de erro: erro lançado em handler ou middleware, rota não encontrada (404), erro de validação, erros de utilitários internos (corpo grande demais, autenticação, etc.) e `onError` quando não sobrescreve a resposta.

**Critério de aceite**

- **Dado** uma aplicação com uma rota inexistente e um handler que lança erro de validação
- **Quando** o cliente acessa ambas
- **Então** as duas respostas têm `content-type: application/problem+json` e corpo com `status`, `title` e `detail`.

### RF-09 — Testes e qualidade

Os testes existentes que verificam o formato antigo são ajustados para o novo formato sem perder o que verificam. Novos testes cobrem RF-01 a RF-08 (usando `describeMatrix`). `pnpm test`, `pnpm lint` e o typecheck passam. Os tipos públicos (`ErrorInput`, `ErrorBody`, `HTTPError`) são atualizados com `type` e `instance`, e a documentação do formato de erro é atualizada.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** se executa `pnpm vitest run`, `pnpm lint` e o typecheck
- **Então** todos terminam sem falhas, e existe ao menos um teste para cada RF acima.

## Fora de escopo

- Opção, flag ou gatilho para ativar/desativar o formato (ex.: `problemDetails: true`); o formato é sempre ativo.
- Novos nomes públicos além de `type` e `instance` em `HTTPError` (sem novo utilitário, classe, helper ou export).
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Registro de tipos de problema, páginas de documentação por `type` ou URIs padrão.
- Integração com Nitro ou outros pacotes consumidores.
- Mudanças em respostas que não são erro e no comportamento de `onError` fornecido pelo usuário.

## Premissas e riscos

### Premissas

- `title` é derivado de `statusText` (quando existir) ou do texto padrão do status; `detail` vem de `message`. Mapear dessa forma não exige nome público novo.
- `status` continua no corpo, como já ocorre, e é compatível com a RFC.
- Para `type` ausente não se emite `"about:blank"`; a RFC o assume implicitamente.
- `type` e `instance` são strings e não são validados como URI (a RFC permite referências relativas).
- O membro `unhandled` e `stack` (debug) são tratados como extensões, não como parte do padrão.

### Riscos

- **Contradição no contrato:** o pedido diz que o novo formato "substitui" o atual e, ao mesmo tempo, "não quebrar o que já existe". Substituir o corpo e o `content-type` é uma quebra de compatibilidade para clientes que leem `message` ou checam `application/json`. Mitigação: manter o máximo possível de campos antigos como extensões se isso não violar a RFC (decisão pendente, ver abaixo); documentar a mudança como visível ao usuário.
- **Campo `message`:** a RFC usa `detail`. Manter `message` ao lado de `detail` reduz a quebra, mas duplica informação; remover quebra consumidores. Requer decisão do responsável pelo produto.
- **Content-type:** clientes e testes que fazem `res.json()` seguem funcionando, mas verificações exatas de `application/json` quebram; é preciso ajustar testes existentes.
- **Vazamento:** `detail` e `title` não podem expor dados de erros não tratados (RF-06).
- **Colisão de chaves:** `body` espalhado no topo pode sobrescrever membros padrão (tratado em RF-05).
- **Outras camadas:** rules (`h3/rules`), utilitários de proxy e erros de runtimes (ex.: `BodyTooLargeError` do srvx) podem montar erros por conta própria; é preciso verificar se passam pelo mesmo serializador.

### Decisões pendentes

1. Manter `message` (e `statusText`) no corpo como extensões de compatibilidade, ou remover em favor de `title`/`detail`?
2. Manter `unhandled` no corpo?
