# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384 · Contrato enxuto #1384-A (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `stack` em debug, mais as chaves de `body`), com `content-type: application/json`. Clientes e gateways que esperam o formato padrão "problem details" da RFC 9457 (`application/problem+json`, com `type`, `title`, `status`, `detail`, `instance`) precisam traduzir esse formato manualmente. A issue #1384 pede esse suporte nativo.

### Objetivo

Permitir que uma aplicação h3 responda erros no formato RFC 9457 (representação JSON) ao ligar uma única opção de configuração, `problemDetails`. Sem a opção, o comportamento atual fica idêntico, byte a byte. `HTTPError` passa a aceitar e expor os membros `type` e `instance` da RFC.

### Métricas de sucesso

- Com `problemDetails: true`, 100% das respostas de erro geradas pelo h3 usam `application/problem+json` e contêm os membros `type`, `title`, `status` e `detail`.
- Com a opção ausente ou `false`, a suíte existente passa sem mudança de comportamento.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean` a `H3Config` (`src/types/h3.ts`), desligada por padrão e lida de `app.config` como `debug` e `silent`. Nenhum outro nome público novo.

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails`, ou com `problemDetails: false`
- **Quando** um handler lança `new HTTPError({ status: 400, message: "ruim" })`
- **Então** a resposta é idêntica à atual: `content-type: application/json` e corpo com `status`, `statusText`, `message` etc., sem `type`, `title`, `detail` ou `instance`.

### RF-02 — Content-Type `application/problem+json`

Com a opção ligada, toda resposta de erro renderizada pelo h3 usa `content-type: application/problem+json` no lugar de `application/json`. Os demais cabeçalhos (`error.headers`, `event.res` de erro) continuam sendo mesclados.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `HTTPError.status(404)` e o cliente faz a requisição
- **Então** a resposta tem status 404 e `content-type` começando com `application/problem+json`.

### RF-03 — Mapeamento dos membros padrão

Com a opção ligada, o corpo do erro segue a RFC 9457:

- `type`: `error.type` se informado; senão `"about:blank"`.
- `title`: `statusText` do erro; se ausente, a frase padrão do status HTTP (ex.: "Not Found" para 404); se não houver, omitido.
- `status`: o status HTTP da resposta.
- `detail`: `error.message`.
- `instance`: `error.instance`, quando informado; senão omitido.

**Critério de aceite**

- **Dado** `problemDetails: true` e um handler que lança `new HTTPError({ status: 422, statusText: "Entidade inválida", message: "campo 'email' ausente", type: "https://exemplo.com/erros/validacao", instance: "/pedidos/42" })`
- **Quando** o cliente recebe a resposta
- **Então** o corpo JSON contém exatamente `type: "https://exemplo.com/erros/validacao"`, `title: "Entidade inválida"`, `status: 422`, `detail: "campo 'email' ausente"` e `instance: "/pedidos/42"`.

### RF-04 — `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`/`ErrorBody`) aceita os campos opcionais `type` e `instance` (strings); a instância os expõe como propriedades `readonly`, `undefined` quando não informados. Também funcionam via `HTTPError.status(...)`, e são herdados de `details.cause` como os demais campos.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 409, type: "urn:erro:conflito", instance: "/r/1" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** valem `"urn:erro:conflito"` e `"/r/1"`; e, para `new HTTPError({ status: 409 })`, ambos valem `undefined`.

### RF-05 — Extensões (`data` e `body`)

Com a opção ligada, `data` (sob a chave `data`) e as chaves de `body` (no nível raiz) continuam no corpo como membros de extensão. Chaves de `body` não podem sobrescrever os membros padrão `type`, `title`, `status`, `detail`, `instance`.

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro com `data: { campo: "email" }` e `body: { codigo: "E42", title: "malicioso" }`
- **Quando** a resposta é gerada
- **Então** o corpo traz `data: { campo: "email" }` e `codigo: "E42"`, e `title` mantém o valor calculado conforme RF-03.

### RF-06 — Erros não tratados continuam mascarados

Com a opção ligada, erros `unhandled` não vazam informação: `detail` é `"HTTPError"`, sem `data` nem `body`, como em `toJSON()` hoje. Status 500, `type: "about:blank"`.

**Critério de aceite**

- **Dado** `problemDetails: true` e um handler que lança `new Error("segredo interno")`
- **Quando** o cliente recebe a resposta
- **Então** o status é 500, o `content-type` é `application/problem+json`, e o corpo não contém a string "segredo interno" nem `stack` (sem `debug`).

### RF-07 — Interação com `debug`, `onError` e hooks

Com a opção ligada: (a) `debug: true` mantém `stack` no corpo e a indentação de 2 espaços, como extensão; (b) `onError` continua sendo chamado antes e, se retornar uma `Response`, ela prevalece sem reformatação; (c) o erro lançado por `onError` também sai em problem details.

**Critério de aceite**

- **Dado** `problemDetails: true`, `debug: true` e um handler que lança `new HTTPError({ status: 400, message: "x" })`
- **Quando** a resposta é gerada
- **Então** o corpo contém `detail: "x"` e `stack` (array de strings), com `content-type: application/problem+json`.

### RF-08 — Documentação e testes

Cobrir RF-01 a RF-07 com testes em `test/` usando `describeMatrix` (web e node), documentar a opção e os campos novos em `docs/` onde `debug`/`HTTPError` já estiverem documentados, e ajustar apenas os testes existentes que dependam do que a mudança altera (por exemplo, o formato do `toJSON` ou testes de tipos), sem perder o que eles verificam.

**Critério de aceite**

- **Dado** a suíte completa após a mudança
- **Quando** se executa `pnpm test`
- **Então** lint, typecheck e todos os testes passam, e existe ao menos um teste novo por requisito RF-01 a RF-07.

## 3. Fora de escopo

- Negociação de conteúdo via `Accept` (a opção é global, não por requisição).
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro de tipos de problema, catálogo de URIs `type` ou página de documentação por tipo.
- Gerar `instance` automaticamente (ex.: a partir da URL da requisição).
- Nova API pública além de `problemDetails`, `HTTPError#type` e `HTTPError#instance` (sem helpers, utilitários ou plugins).
- Opção por rota ou por `route rules`; integração com Nitro.
- Mudar o formato padrão de erro quando a opção está desligada, inclusive `toJSON()` sem a opção.
- Erros 404 de rota inexistente fora do fluxo normal do h3 (ex.: respostas de servidor estático de terceiros).

## 4. Premissas e riscos

### Premissas

- A opção é lida em tempo de resposta de `app.config`, como `debug` e `silent` (ponto de renderização: `errorResponse` em `src/response.ts`).
- `title` usa `statusText` quando existe; a RFC recomenda que `title` não mude entre ocorrências do mesmo problema, e `statusText` é curto por contrato.
- Uma tabela mínima de frases HTTP padrão pode ser mantida internamente sem dependência nova (o core tem só `rou3` e `srvx`).
- `type` e `instance` entram em `ErrorBody`/`ErrorInput` sem criar tipos exportados novos.

### Riscos

- **Quebra de compatibilidade em `toJSON()`:** se `type`/`instance` passarem a aparecer no JSON legado, clientes existentes mudam. Mitigação: com a opção desligada, `toJSON()` não os emite, e um teste cobre isso (RF-01).
- **Colisão de chaves:** `body` pode conter `title`, `type` etc. Mitigação: RF-05 define precedência dos membros padrão.
- **Vazamento em erros não tratados:** `detail` pode expor mensagens internas. Mitigação: RF-06 reaproveita o mascaramento de `unhandled`.
- **Testes de tipos e snapshots existentes** podem depender da forma de `ErrorBody`/`toJSON`; o ajuste deve preservar o que verificam (RF-08).
- **Tamanho do arquivo:** `src/response.ts` e `src/error.ts` crescem; manter o código novo em helper interno para respeitar a meta de < 200 LoC por arquivo.
- **Ambiguidade da RFC sobre `status` no corpo:** o valor deve coincidir com o status HTTP; o `status` sanitizado do `HTTPError` é a fonte única.
