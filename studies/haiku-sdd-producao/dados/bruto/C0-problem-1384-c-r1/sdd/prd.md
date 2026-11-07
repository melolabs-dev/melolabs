# PRD — Problem details (RFC 9457) via utilitário `problem()`

Referência: issue h3js/h3#1384 · contrato enxuto #1384-C · `sdd/pedido.md`.

## 1. Problema e objetivo

### Problema
O h3 serializa erros (`HTTPError`) como JSON próprio (`status`, `statusText`, `message`, `data`, ...), com `content-type: application/json`. Clientes de APIs que seguem a RFC 9457 (Problem Details for HTTP APIs) esperam o media type `application/problem+json` e os membros padronizados `type`, `title`, `status`, `detail` e `instance`. Hoje não há forma suportada de produzir essa resposta.

### Objetivo
Oferecer o utilitário `problem(input)`, exportado por `h3`, que devolve um `HTTPError` cuja resposta segue a RFC 9457 (representação JSON). O formato é **opt-in**: só respostas de handlers que chamam `problem()` mudam. Erros comuns (`new HTTPError`, `HTTPError.status`, erros não tratados) continuam idênticos.

### Métricas de sucesso
- Uma resposta gerada por `problem()` tem `content-type: application/problem+json` e corpo válido segundo a RFC 9457.
- Nenhum teste existente perde cobertura; `pnpm lint`, `pnpm typecheck` e `pnpm test` passam.

## 2. Requisitos funcionais

### RF-01 — Função `problem(input)` exportada e devolvendo `HTTPError`
`problem` é exportada pelo pacote `h3` (via `src/index.ts`) e devolve uma instância de `HTTPError`, que pode ser lançada (`throw problem(...)`) ou retornada pelo handler.

**Critério de aceite**
- **Dado** um handler que faz `throw problem({ status: 404 })`
- **Quando** `problem` é importada de `h3` e a rota é requisitada
- **Então** `problem(...)` é `instanceof HTTPError` (`HTTPError.isError` verdadeiro) e a resposta tem status 404.

### RF-02 — Entrada aceita campos de `HTTPError` mais `type` e `instance`
O tipo de entrada de `problem` estende `ErrorInput` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, ...) com `type?: string` e `instance?: string`. Esse tipo de entrada é o único nome público novo além de `problem`.

**Critério de aceite**
- **Dado** a chamada `problem({ status: 403, message: "Sem permissão", headers: { "x-id": "1" }, type: "https://exemplo.com/erros/sem-permissao", instance: "/contas/42" })`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** compila sem erro, e a entrada com um campo desconhecido ou `type` não string é rejeitada pelo compilador.

### RF-03 — Corpo da resposta no formato RFC 9457
O corpo JSON contém os membros padrão: `type` (padrão `"about:blank"` quando omitido), `title` (derivado de `statusText` quando informado; senão do texto de razão HTTP padrão do status), `status` (número), `detail` (derivado de `message` quando fornecido explicitamente) e `instance` (somente quando informado). Membros extras de `body` são incluídos como extensões no nível superior; `data`, quando informado, aparece sob a chave `data`. Membros com valor `undefined` não são serializados.

**Critério de aceite**
- **Dado** `throw problem({ status: 404, statusText: "Não encontrado", message: "Usuário 42 não existe", type: "https://exemplo.com/erros/nao-encontrado", instance: "/usuarios/42", body: { traceId: "abc" } })`
- **Quando** o cliente requisita a rota
- **Então** o JSON da resposta é `{ "type": "https://exemplo.com/erros/nao-encontrado", "title": "Não encontrado", "status": 404, "detail": "Usuário 42 não existe", "instance": "/usuarios/42", "traceId": "abc" }`.

### RF-04 — Media type e status HTTP
A resposta de um `problem()` usa `content-type: application/problem+json`, e o status HTTP da resposta é igual ao membro `status` do corpo. Headers informados em `headers` são preservados; `content-type` definido pelo chamador não é sobrescrito pelo padrão.

**Critério de aceite**
- **Dado** `throw problem({ status: 422, headers: { "x-request-id": "r1" } })`
- **Quando** o cliente requisita a rota
- **Então** a resposta tem status 422, `content-type` iniciando com `application/problem+json`, `x-request-id: r1`, e o corpo tem `"status": 422`.

### RF-05 — Valores padrão e não vazamento de detalhes
Com entrada mínima (`problem({})` ou só `status`), o status padrão é 500 e o `type` é `about:blank`. Quando `unhandled: true`, os mesmos ocultamentos já aplicados por `HTTPError` valem: `detail`, `data` e extensões de `body` não são expostos (apenas `type`, `title`, `status`).

**Critério de aceite**
- **Dado** `throw problem({ unhandled: true, message: "segredo", data: { s: 1 }, body: { x: 1 } })`
- **Quando** o cliente requisita a rota
- **Então** o status é 500, o corpo contém `type: "about:blank"`, `title` e `status: 500`, e não contém `segredo`, `data` nem `x`.

### RF-06 — Erros comuns permanecem inalterados
Respostas de `HTTPError` criados sem `problem()` mantêm exatamente o formato e o `content-type: application/json` atuais, assim como `toJSON()` de `HTTPError`.

**Critério de aceite**
- **Dado** um handler que faz `throw new HTTPError({ status: 400, message: "ruim", data: { a: 1 } })`
- **Quando** o cliente requisita a rota depois da mudança
- **Então** a resposta é idêntica à anterior (`content-type: application/json`, corpo com `status`, `message`, `data`), e a suíte existente passa sem perder asserções.

### RF-07 — Integração com a conversão de erro em resposta
O mecanismo de conversão (`toResponse`/tratamento de erro do `H3`, incluindo `onError` e `onResponse`) trata o erro de `problem()` como qualquer `HTTPError`: hooks de erro recebem a instância, e erros lançados em middleware ou em handlers assíncronos produzem o mesmo resultado.

**Critério de aceite**
- **Dado** um middleware global `onError` registrado e um handler assíncrono que faz `throw problem({ status: 409 })`
- **Quando** o cliente requisita a rota nos modos `web` e `node` do `describeMatrix`
- **Então** o `onError` é chamado com o `HTTPError` do problema, e a resposta final é `application/problem+json` com status 409 em ambos os modos.

### RF-08 — Testes e documentação
Testes novos (usando `describeMatrix`, em `test/`) cobrem RF-01 a RF-07, com teste de tipos para RF-02 em `test/unit/types.test-d.ts`. Os testes existentes só são ajustados quando dependem do que a mudança altera, sem perder o que verificam. A documentação do utilitário é adicionada em `docs/` junto ao tratamento de erros, caso exista.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm test` são executados
- **Então** todos passam, e os testes novos falham se `problem` for removida (regressão comprovada antes da implementação).

## 3. Fora de escopo
- Ativar problem details globalmente ou por configuração (`H3Config`), nem negociação via `Accept`.
- Conversão automática de `HTTPError` comum, erros de validação ou erros não tratados para `application/problem+json`.
- Representação XML da RFC 9457 (`application/problem+xml`).
- Registro de tipos de problema, resolução de URIs de `type`, ou geração automática de `instance`.
- Novas classes, outros nomes públicos além de `problem` e do tipo da sua entrada, e mudanças em `toJSON()` do `HTTPError`.
- Mudanças em `h3/rules`, no pacote Nitro ou em adaptadores de runtime.

## 4. Premissas e riscos

### Premissas
- `problem()` pode devolver um `HTTPError` comum porque a conversão em resposta consulta apenas propriedades dele; o formato é carregado por dados do próprio erro (por exemplo, `body` e `headers`), sem nova classe pública.
- `title` e `detail` são mapeados a partir de `statusText` e `message`, a fim de reaproveitar os campos existentes; nada se inventa sem entrada do chamador.
- A RFC 9457 permite membros de extensão; por isso `body` vira extensões no nível superior.
- Texto de razão padrão do status é obtido de forma portátil (sem API específica de runtime).

### Riscos
- **Colisão de nomes**: `body` ou `data` com chaves `type`, `title`, `status`, `detail` ou `instance` poderia sobrescrever membros padrão. Mitigação: membros padrão prevalecem; documentar.
- **`toJSON()` vs. corpo da resposta**: `toJSON()` mantém o formato atual (RF-06); a serialização problem precisa ocorrer no ponto de conversão da resposta, sem alterar `toJSON()` usado por outros consumidores (logs, hooks).
- **Quebra de testes existentes** que comparam `content-type` ou o corpo do erro: ajustes devem se limitar ao estritamente necessário.
- **Divergência entre `statusText` e `title`** quando `statusText` for sanitizado/vazio: o fallback precisa ser determinístico.
- **Paridade entre runtimes** (web vs. node, Bun, Deno, Workers): validar via `describeMatrix`.
- **Informação sensível** em `detail`/`extensões` em erros não tratados: coberto por RF-05, mas depende de `unhandled` ser respeitado.
