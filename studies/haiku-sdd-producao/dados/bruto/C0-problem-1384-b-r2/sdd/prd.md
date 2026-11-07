# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros como JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data` e as chaves de `body`), com `content-type: application/json`. Clientes e ferramentas que entendem a RFC 9457 (Problem Details for HTTP APIs) não reconhecem esse formato, e `HTTPError` não consegue expressar os membros `type` e `instance` da norma.

### Objetivo
Fazer toda resposta de erro gerada pelo h3 seguir a representação JSON da RFC 9457 (`application/problem+json`), por padrão e sem configuração. `HTTPError` passa a aceitar e expor `type` e `instance`. Nenhum outro nome público novo é criado e o comportamento existente que não depende do formato do corpo é preservado.

### Métricas de sucesso
- 100% das respostas de erro produzidas por `toResponse`/`errorResponse` usam `application/problem+json` e contêm `status`.
- Suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`
Toda resposta de erro do h3 usa o media type `application/problem+json`, mantendo o charset UTF-8 já usado hoje.

**Critério de aceite**
- **Dado** uma rota que lança `new HTTPError({ status: 404 })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 404 e o cabeçalho `content-type` começa com `application/problem+json`.

### RF-02 — Membros padrão do corpo
O corpo JSON do erro contém os membros da RFC 9457: `type`, `title`, `status`, `detail`.
- `type`: o valor informado no erro ou, na ausência, `"about:blank"`.
- `title`: `statusText` do erro, ou, na ausência, a frase padrão do status HTTP.
- `status`: o código HTTP da resposta.
- `detail`: a mensagem do erro.

**Critério de aceite**
- **Dado** uma rota que lança `new HTTPError("Sem permissão", { status: 403 })`
- **Quando** o cliente faz a requisição
- **Então** o corpo JSON tem `type: "about:blank"`, `title: "Forbidden"`, `status: 403` e `detail: "Sem permissão"`.

### RF-03 — Campos `type` e `instance` em `HTTPError`
O objeto de entrada do construtor de `HTTPError` (e, por consequência, `HTTPError.status(...)` via `details`) aceita os campos opcionais `type` e `instance` (strings, URI-reference). Ambos ficam expostos como propriedades somente leitura da instância (`undefined` quando não informados) e são serializados no corpo quando presentes. `instance` é omitido do corpo se ausente.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 409, type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })`
- **Quando** o erro é lido e depois retornado numa resposta
- **Então** `error.type` e `error.instance` têm os valores informados e o corpo JSON traz `type` e `instance` com esses mesmos valores.

### RF-04 — Erros não tratados não vazam detalhes
Para erros `unhandled`, o corpo continua sem expor mensagem original, `data`, `body` e stack (fora do modo debug). `detail` não deve conter a mensagem interna; `type` e `instance` informados pela aplicação também não são expostos nesse caso.

**Critério de aceite**
- **Dado** um handler que lança `new Error("segredo interno")` (convertido em erro `unhandled` 500)
- **Quando** o cliente faz a requisição sem `debug`
- **Então** o corpo tem `status: 500`, `title` correspondente e nenhum trecho "segredo interno", `data` ou stack.

### RF-05 — Dados adicionais como membros de extensão
Os dados extras já suportados continuam disponíveis no corpo como membros de extensão (RFC 9457 §3.2): as chaves de `body` no nível raiz e `data` sob a chave `data`. A chave `message` é mantida com o mesmo valor de `detail` por compatibilidade. Membros de extensão não podem sobrescrever `type`, `title`, `status`, `detail` nem `instance`.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 422, data: { campo: "email" }, body: { codigo: "E42", status: 200 } })`
- **Quando** o cliente faz a requisição
- **Então** o corpo traz `data: { campo: "email" }`, `codigo: "E42"`, `message` igual a `detail`, e `status` permanece 422.

### RF-06 — Preservação de cabeçalhos, status HTTP e modo debug
O status HTTP, a status line (`statusText`), os cabeçalhos customizados do erro e o merge com cabeçalhos de `onError`/resposta continuam como hoje; só o `content-type` muda (RF-01) e um `content-type` explícito definido no erro continua prevalecendo. Em `debug`, o corpo continua indentado e inclui `stack`.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 401, headers: { "www-authenticate": "Basic" } })` com app em `debug: true`
- **Quando** o cliente faz a requisição
- **Então** a resposta mantém `www-authenticate: Basic`, o status 401, o corpo indentado com `stack`, e `content-type` `application/problem+json`.

### RF-07 — Testes e qualidade
Os testes existentes que assertam o formato anterior do corpo/`content-type` de erro são ajustados sem perder o que verificam; novos testes (via `describeMatrix`) cobrem RF-01 a RF-06. `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos terminam com sucesso, e há ao menos um teste novo por requisito RF-01 a RF-06 nos modos `web` e `node`.

## 3. Fora de escopo
- Qualquer opção, flag ou configuração para ligar/desligar o formato (não há gatilho; o formato é o padrão).
- Novos nomes públicos além de `type` e `instance` em `HTTPError` (sem novas funções, helpers ou exports).
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Registro de tipos de problema, documentação hospedada em URIs de `type` ou geração automática de `type` por status.
- Mudanças em `h3/rules`, no plugin de tracing ou em adaptadores, além do que decorre da mudança do corpo de erro.
- Alteração de erros de validação (formato de `data`/issues) além de seu transporte como extensão.

## 4. Premissas e riscos

### Premissas
- O formato substitui o anterior: não há caminho de saída para o JSON antigo.
- `message` é mantido como membro de extensão para reduzir quebra de consumidores; `statusText` e `unhandled` deixam de ser membros do corpo (o primeiro vira `title`).
- A frase padrão de `title` vem de um mapa interno (não exportado), pois o runtime não garante `statusText` em `Response`.
- `type` e `instance` são repassados como informados, sem validação de URI.

### Riscos
- **Tensão do contrato:** o pedido exige ao mesmo tempo substituir o formato padrão e "não quebrar o que existe". Consumidores que leem `statusText`/`unhandled` do corpo ou checam `content-type: application/json` quebrarão; mitigação parcial pela manutenção de `message`/`data` e pelos testes ajustados. Recomenda-se registrar a mudança como breaking nas notas de versão e validar a decisão com o responsável.
- Clientes que fazem `res.json()` continuam funcionando, mas código que verifica igualdade exata do `content-type` não.
- Colisão de nomes: chaves de `body` iguais aos membros padrão (mitigado por RF-05).
- Vazamento de informação em erros `unhandled` ao reaproveitar `type`/`instance` (mitigado por RF-04).
- Pacotes dependentes (ex.: Nitro) podem ter formato de erro próprio e precisar de adaptação futura.
