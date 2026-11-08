# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, ...) e `Content-Type: application/json`. Esse formato não segue um padrão, então clientes, gateways e ferramentas de observabilidade precisam de código específico para interpretá-lo. A RFC 9457 (Problem Details for HTTP APIs) define um formato padrão (`application/problem+json`), e a issue #1384 pede esse suporte.

### Objetivo
Permitir que uma aplicação h3 responda erros no formato problem details (representação JSON da RFC 9457), ligado por uma opção de configuração. Sem a opção, o comportamento atual não muda.

### Nomes públicos (únicos permitidos)
- Opção booleana `problemDetails` em `H3Config`, desligada por padrão, lida de `app.config` como as demais opções.
- Campos opcionais `type` e `instance` no objeto de entrada do construtor de `HTTPError`, expostos na instância.

Nenhum outro nome público novo é criado.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`
`H3Config` ganha a opção booleana opcional `problemDetails`, com padrão `false`, lida de `app.config` como `debug` e `silent`, documentada com TSDoc.

**Critério de aceite**
- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** um handler lança `HTTPError` e a resposta é gerada
- **Então** o corpo e os cabeçalhos são idênticos aos de antes da mudança (`Content-Type: application/json`, mesmas chaves).

### RF-02 — Content-Type `application/problem+json`
Com a opção ligada, toda resposta de erro gerada pelo h3 usa `Content-Type: application/problem+json` (a RFC não exige `charset`; manter o mesmo padrão de charset dos cabeçalhos JSON atuais).

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`
- **Quando** uma rota lança `new HTTPError({ status: 404 })`
- **Então** a resposta tem status 404 e `Content-Type` com tipo `application/problem+json`.

### RF-03 — Membros padrão `type`, `title`, `status`, `detail`, `instance`
Com a opção ligada, o corpo do erro é um objeto JSON com os membros da RFC 9457:
- `type`: o valor de `HTTPError.type`; quando ausente, `"about:blank"`.
- `title`: `statusText` do erro; quando ausente, o texto padrão do status HTTP (ex.: "Not Found").
- `status`: o código HTTP, igual ao status da resposta.
- `detail`: a `message` do erro, omitida quando for apenas o texto genérico derivado do status.
- `instance`: o valor de `HTTPError.instance`, omitido quando ausente.

**Critério de aceite**
- **Dado** `problemDetails: true` e `new HTTPError({ status: 403, statusText: "Forbidden", message: "Sem permissão", type: "https://example.com/probs/forbidden", instance: "/contas/42" })`
- **Quando** o erro é lançado em uma rota
- **Então** o corpo JSON contém `type: "https://example.com/probs/forbidden"`, `title: "Forbidden"`, `status: 403`, `detail: "Sem permissão"` e `instance: "/contas/42"`.

### RF-04 — `HTTPError` aceita `type` e `instance`
O objeto de entrada do construtor aceita `type` e `instance` (strings opcionais), que ficam expostos como propriedades somente leitura da instância (`error.type`, `error.instance`), `undefined` quando não informados. Os campos também são lidos de `cause`, como já ocorre com `status` e `headers`. Vale também para `HTTPError.status(...)` via `details`.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 400, type: "https://example.com/probs/x", instance: "/req/1" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** retornam respectivamente `"https://example.com/probs/x"` e `"/req/1"`; e para `new HTTPError({ status: 400 })` ambos são `undefined`.

### RF-05 — Membros de extensão
Com a opção ligada, as chaves de `body` viram membros de extensão no nível raiz (como hoje) e `data`, quando presente, é mantido sob a chave `data`. Chaves de `body` não sobrescrevem os membros padrão `type`, `title`, `status`, `detail`, `instance`.

**Critério de aceite**
- **Dado** `problemDetails: true` e `new HTTPError({ status: 422, body: { errors: ["x"], status: 200 }, data: { campo: "y" } })`
- **Quando** o erro é lançado
- **Então** o corpo tem `errors: ["x"]`, `data: { campo: "y" }` e `status: 422` (não 200).

### RF-06 — Erros não tratados não vazam detalhes
Para erros `unhandled`, a resposta em problem details não expõe `message`, `data` nem `body` do erro original: `detail` é omitido, `title` é o texto padrão do status 500 e `type` é `"about:blank"` (ou o `type` do erro, se houver).

**Critério de aceite**
- **Dado** `problemDetails: true`, sem `debug`, e um handler que lança `new Error("segredo interno")`
- **Quando** a resposta é gerada
- **Então** o status é 500, o `Content-Type` é `application/problem+json` e o corpo não contém a string "segredo interno".

### RF-07 — Compatibilidade com `debug`, cabeçalhos e `statusText`
Com a opção ligada: `debug: true` continua adicionando `stack` ao corpo; cabeçalhos do erro e de `errHeaders` continuam sendo mesclados, e o `Content-Type` problem+json prevalece sobre o `application/json` padrão (salvo um `Content-Type` definido explicitamente pelo erro); `statusText` da resposta HTTP continua sendo aplicado.

**Critério de aceite**
- **Dado** `problemDetails: true`, `debug: true` e um erro com `headers: { "x-id": "1" }`
- **Quando** a resposta é gerada
- **Então** o corpo contém `stack`, o cabeçalho `x-id: 1` está presente e o `Content-Type` é `application/problem+json`.

### RF-08 — Atualização dos testes e documentação
Testes existentes que dependam de algo que a mudança altere são ajustados sem perder o que verificam. Novos testes (via `describeMatrix`, em `web` e `node`) cobrem RF-01 a RF-07 e um teste de tipos cobre `problemDetails` e os novos campos. A documentação da opção é adicionada onde `debug`/`silent` estão documentados.

**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** se executam `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam e há testes novos para cada RF acima.

## 3. Fora de escopo

- Gatilho por negociação de conteúdo (`Accept: application/problem+json`) ou por cabeçalho: esta variante usa só a opção de configuração.
- Representação XML (`application/problem+xml`).
- Opção por rota, por handler ou por evento; só configuração global da aplicação.
- Registro de tipos de problema, geração automática de URIs `type` ou páginas de documentação por tipo.
- Mudanças em `toJSON()` do `HTTPError` quando a opção está desligada, ou em qualquer outro nome público.
- Novos utilitários, helpers de erro ou alterações em Nitro.
- Remoção de campos legados (`statusCode`, `statusMessage`).

## 4. Premissas e riscos

### Premissas
- A formatação do erro acontece em um único ponto (`errorResponse` em `src/response.ts`), que recebe `config` com `debug`; a opção pode ser repassada pelo mesmo caminho.
- O texto padrão de status (para `title`) pode ser obtido sem nova dependência pública (ex.: tabela interna ou `statusText` já existente); a escolha é de implementação.
- `type` e `instance` são strings; a validação de URI não é exigida (a RFC admite URI-reference relativa).
- A opção é lida em tempo de resposta de `app.config`, de modo que `app.config.problemDetails = true` após a criação também funcione.

### Riscos
- **Mudança de contrato para clientes**: ligar a opção troca as chaves do corpo (`message` → `detail`, `statusText` → `title`). Mitigação: desligada por padrão e documentada.
- **Vazamento de informação**: `detail`, `data` e `body` podem expor dados internos. Mitigação: RF-06 e teste explícito.
- **Colisão de chaves**: `body` com chaves como `status` ou `type` pode corromper o formato. Mitigação: RF-05 (membros padrão têm precedência).
- **Testes existentes acoplados ao formato**: alguns testes de erro podem comparar o corpo exato; só devem mudar se a mudança de fato os afetar (a expectativa é que, com a opção desligada, nenhum mude, exceto os que inspecionem a forma de `HTTPError`, por exemplo `toJSON`/propriedades enumeráveis).
- **Divergência entre runtimes**: cabeçalhos e `statusText` se comportam diferente em `web` e `node`; mitigação: testes com `describeMatrix`.
- **Convenções do projeto**: `isolatedDeclarations` exige tipos explícitos nas novas propriedades; arquivos devem continuar curtos (< 200 LoC).
