# PRD — Problem details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `stack`, ...) e `content-type: application/json`. Clientes e gateways que esperam o formato padronizado "problem details" (RFC 9457, `application/problem+json`) precisam de adaptação manual em cada aplicação. A issue #1384 pede esse suporte nativo.

### Objetivo

Permitir que uma aplicação h3 responda erros no formato RFC 9457 (representação JSON) ao ligar uma única opção de configuração, `problemDetails`. Sem a opção, o comportamento atual permanece idêntico byte a byte. `HTTPError` passa a aceitar e expor os membros `type` e `instance` da RFC.

### Métricas de sucesso

- Com `problemDetails: true`, toda resposta de erro produzida pelo h3 é um problem details válido.
- Com a opção ausente ou `false`, nenhuma resposta de erro existente muda.
- `pnpm lint`, `pnpm typecheck` e a suíte de testes passam.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

`H3Config` ganha a opção booleana `problemDetails`, desligada por padrão e lida de `app.config` como `debug` e `silent`. Documentada com TSDoc.

**Critério de aceite**
- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** um handler lança `HTTPError.status(404)`,
- **Então** a resposta é idêntica à atual: `content-type: application/json;charset=UTF-8` e corpo com `status`, `statusText` e `message`.

### RF-02 — Content-Type de problem details

Com `problemDetails` ligada, respostas de erro usam `content-type: application/problem+json` (com `charset=UTF-8`, como o JSON atual).

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`,
- **Quando** um handler lança qualquer erro (`HTTPError`, `Error` comum ou rota inexistente),
- **Então** a resposta tem `content-type` começando com `application/problem+json` e o corpo é JSON válido.

### RF-03 — Membros padrão no corpo

O corpo contém os membros da RFC 9457:
- `type`: o `type` do erro, ou `"about:blank"` quando ausente;
- `title`: `statusText` do erro, ou a frase padrão do status HTTP quando ausente;
- `status`: o código HTTP, igual ao da resposta;
- `detail`: a `message` do erro;
- `instance`: incluído somente quando informado no erro.

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`,
- **Quando** um handler lança `new HTTPError("Sem saldo", { status: 403 })`,
- **Então** o corpo é `{ "type": "about:blank", "title": "Forbidden", "status": 403, "detail": "Sem saldo" }`, sem o membro `instance`.

### RF-04 — `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance` (strings, URI reference). Ambos ficam expostos na instância (`error.type`, `error.instance`), `undefined` quando não informados. Também são lidos de `cause`, como os demais campos. Nenhum outro nome público é adicionado.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 400, type: "https://example.com/probs/validacao", instance: "/pedidos/42" })`,
- **Quando** se lê `error.type` e `error.instance`,
- **Então** os valores são os informados; e, em uma aplicação com `problemDetails: true`, o corpo da resposta traz os mesmos valores em `type` e `instance`.

### RF-05 — Extensões preservam `data` e `body`

Com a opção ligada, `body` (propriedades de topo) e `data` continuam sendo emitidos como membros de extensão, sem sobrescrever os membros padrão de RF-03.

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`,
- **Quando** um handler lança `new HTTPError({ status: 422, body: { errors: ["x"] }, data: { campo: "a" } })`,
- **Então** o corpo contém `errors: ["x"]` e `data: { campo: "a" }` junto de `type`, `title`, `status` e `detail`; e se `body` contiver uma chave padrão (ex.: `status`), vale o valor do membro padrão.

### RF-06 — Erros não tratados continuam mascarados

Com a opção ligada, erros `unhandled` não vazam mensagem, `data` nem `body`: `detail` não expõe a mensagem original e as extensões são omitidas.

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true` e `silent: true`,
- **Quando** um handler lança `new Error("segredo interno")`,
- **Então** a resposta é 500 em `application/problem+json` e o corpo inteiro não contém "segredo interno".

### RF-07 — Interação com `debug`, headers e `onError`

Com a opção ligada: `debug: true` continua adicionando `stack` (como extensão); `headers` do erro e os de `event.res` continuam sendo mesclados; `onError` continua podendo substituir a resposta. O status e o `statusText` HTTP da resposta não mudam.

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true` e `debug: true`,
- **Quando** um handler lança `new HTTPError({ status: 401, headers: { "www-authenticate": "Bearer" } })`,
- **Então** a resposta tem status 401, o header `www-authenticate: Bearer`, `content-type` `application/problem+json` e o membro `stack` no corpo.

### RF-08 — Compatibilidade com o código existente

`HTTPError.toJSON()` e as demais APIs mantêm o contrato atual (os novos `type` e `instance` só aparecem quando definidos). A suíte existente passa; testes existentes só são ajustados quando dependerem de algo que a mudança altera, preservando o que verificam. Lint e typecheck passam.

**Critério de aceite**
- **Dado** o repositório com a mudança aplicada,
- **Quando** se executa `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`,
- **Então** todos terminam sem falhas, e testes novos cobrem RF-01 a RF-07 em `describeMatrix` (web e node).

## Fora de escopo

- Ativação por negociação de conteúdo (`Accept: application/problem+json`) ou por rota/middleware.
- Representação XML (`application/problem+xml`).
- Novas funções, utilitários ou exports públicos além de `problemDetails`, `type` e `instance`.
- Validação ou normalização do conteúdo de `type`/`instance` (URI) além de aceitar string.
- Registro de tipos de problema, documentação de URIs de `type` e helpers para múltiplos erros de validação.
- Alterar o formato de erro de WebSocket/JSON-RPC, SSE e `h3/rules`.
- Mudar o padrão da opção (continua desligada).

## Premissas e riscos

### Premissas

- A renderização de erros fica centralizada em `errorResponse` (`src/response.ts`), usada pelo fluxo de `prepareResponse`; é o ponto único de alteração.
- A frase padrão do status (para `title`) vem de um mapeamento interno sem novo export público; para status sem frase conhecida, `title` usa `statusText` ou é omitido.
- `detail` recebe a `message` do erro; quando a mensagem é só o texto padrão gerado ("HTTPError 404"), é aceitável usá-la mesmo assim.
- O membro `status` do corpo é sempre igual ao status HTTP, como a RFC recomenda.

### Riscos

- **Vazamento de informação**: extensões e `detail` de erros `unhandled` — mitigado por RF-06.
- **Colisão de nomes**: `body`/`data` do usuário podem usar `type`, `title`, `detail`; mitigado pela precedência dos membros padrão (RF-05), mas pode surpreender quem já usa esses nomes.
- **Quebra de compatibilidade**: adicionar `type`/`instance` ao `toJSON()` mudaria o JSON atual se emitidos como `undefined`; omitir quando indefinidos (RF-08).
- **Tipos**: `ErrorInput` estende `Partial<ErrorBody>`; com `isolatedDeclarations` as novas propriedades precisam de anotação explícita.
- **Cache/CDN e clientes**: clientes que só reconhecem `application/json` podem não interpretar o novo content-type; por isso a opção é opt-in.
