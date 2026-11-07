# PRD — Problem Details (RFC 9457) por utilitário explícito

Referência: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros como JSON próprio (`status`, `statusText`, `message`, `data`, ...), com `content-type: application/json`. APIs que precisam seguir a RFC 9457 (Problem Details for HTTP APIs) não têm uma forma padronizada de emitir `application/problem+json` com os membros `type`, `title`, `status`, `detail` e `instance`; cada projeto monta isso à mão.

### Objetivo
Oferecer o utilitário `problem(input)`, exportado por `h3`, que devolve um `HTTPError` cuja resposta segue a RFC 9457 em JSON. O formato é opt-in: só respostas de erros criados por `problem()` mudam. Erros comuns (`HTTPError`, `throw`, erros não tratados) continuam idênticos ao comportamento atual.

### Resultado esperado
Um handler faz `throw problem({ status: 404, type: "https://exemplo.com/erros/nao-encontrado", message: "Usuário 42 não existe", instance: "/usuarios/42" })` e o cliente recebe `application/problem+json` com o corpo conforme a RFC.

## 2. Requisitos funcionais

### RF-01 — Função `problem` exportada
`problem(input)` é exportada pelo pacote `h3` (entrada `src/index.ts`) e devolve uma instância de `HTTPError`, podendo ser lançada (`throw`) ou retornada pelo handler.

- **Dado** um app h3 que importa `problem` de `h3`
- **Quando** `problem({ status: 400 })` é chamada
- **Então** o retorno é uma instância de `HTTPError` com `status` 400, e `HTTPError.isError(...)` retorna `true`.

### RF-02 — Entrada: campos de `HTTPError` mais `type` e `instance`
O `input` aceita todos os campos do objeto de entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled` e os aliases depreciados) e, adicionalmente, `type` e `instance` opcionais (strings, URI reference). O tipo da entrada é o único outro nome público novo.

- **Dado** um `input` com `status`, `message`, `type` e `instance`
- **Quando** `problem(input)` é chamada
- **Então** o código compila em modo estrito, os campos `type` e `instance` são aceitos pelo tipo e omiti-los também compila.

### RF-03 — Corpo JSON conforme a RFC 9457
A resposta de um erro criado por `problem()` tem corpo JSON com: `type` (padrão `"about:blank"` quando ausente), `title` (derivado de `statusText`; se ausente, a frase padrão do status HTTP quando `type` é `about:blank`), `status` (número), `detail` (a `message` do erro) e `instance` (somente se informado). Membros de extensão vêm de `body`, sem poder sobrescrever os membros padrão acima.

- **Dado** um handler que lança `problem({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe", type: "https://exemplo.com/erros/nao-encontrado", instance: "/usuarios/42", body: { saldo: 0 } })`
- **Quando** o cliente faz a requisição
- **Então** o corpo é `{ "type": "https://exemplo.com/erros/nao-encontrado", "title": "Not Found", "status": 404, "detail": "Usuário 42 não existe", "instance": "/usuarios/42", "saldo": 0 }` e o status HTTP é 404.

### RF-04 — Content-Type `application/problem+json`
A resposta usa `content-type: application/problem+json` (com charset consistente com o atual do h3), em vez de `application/json`.

- **Dado** um handler que lança `problem({ status: 422 })`
- **Quando** o cliente faz a requisição
- **Então** o cabeçalho `content-type` da resposta começa com `application/problem+json` e o status é 422.

### RF-05 — Cabeçalhos e `statusText` preservados
Os `headers` do input e o `statusText` HTTP continuam sendo aplicados à resposta como em um `HTTPError` normal; se `headers` trouxer `content-type` explícito, ele é respeitado conforme o comportamento atual de `HTTPError`.

- **Dado** `problem({ status: 429, statusText: "Too Many Requests", headers: { "retry-after": "30" } })`
- **Quando** o erro é lançado e respondido
- **Então** a resposta tem status 429, `statusText` "Too Many Requests" e o cabeçalho `retry-after: 30`.

### RF-06 — Erros comuns não mudam
Erros que não vêm de `problem()` (`new HTTPError(...)`, `HTTPError.status(...)`, `throw new Error(...)`, 404 de rota inexistente, erros de validação) mantêm corpo e `content-type` atuais.

- **Dado** um handler que lança `new HTTPError({ status: 400, message: "ruim" })`
- **Quando** o cliente faz a requisição
- **Então** o `content-type` continua `application/json` e o corpo continua `{ status, statusText, message, ... }` como antes desta mudança.

### RF-07 — Erro não tratado e modo debug
Se `problem()` for usado com `unhandled: true`, o corpo não vaza `detail` nem extensões (mesmo critério de `HTTPError.toJSON()`: mensagem genérica). Em modo `debug`, o `stack` continua sendo incluído como hoje.

- **Dado** `problem({ status: 500, message: "segredo interno", unhandled: true })`
- **Quando** o erro é respondido sem `debug`
- **Então** o corpo não contém o texto "segredo interno" nem `data`/extensões, e o `content-type` é `application/problem+json`.

### RF-08 — Compatibilidade com hooks e tratamento de erro
O erro devolvido por `problem()` passa por `onError`, `onResponse` e demais hooks como qualquer `HTTPError`, e `HTTPError.isError()` o reconhece.

- **Dado** um app com hook `onError` registrado
- **Quando** um handler lança `problem({ status: 409 })`
- **Então** o hook recebe um `HTTPError` com `status` 409 e a resposta final mantém o formato `application/problem+json`, a não ser que o hook a substitua explicitamente.

### RF-09 — Qualidade e regressão
Testes novos cobrem RF-01 a RF-08 (com `describeMatrix`, modos `web` e `node`) e testes de tipo para a entrada; a suíte existente passa, ajustando apenas testes que dependam do que mudou, sem perder o que verificam.

- **Dado** a implementação concluída
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` são executados
- **Então** todos terminam sem erros.

## 3. Fora de escopo

- Conversão automática de todos os erros do h3 para problem details (nenhum modo global, opção de config ou negociação por `Accept`).
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro/hospedagem de tipos de problema (URIs de `type`) ou documentação de catálogo de erros.
- Novos nomes públicos além de `problem` e do tipo de sua entrada (sem `ProblemDetails`, `isProblem`, etc.).
- Alterar o formato de `HTTPError.toJSON()` ou de erros que não usam `problem()`.
- Integração com Nitro ou outros pacotes; mudanças em adaptadores de plataforma.
- Validação semântica de `type`/`instance` (são aceitos como strings).

## 4. Premissas e riscos

### Premissas
- `problem()` pode ser implementada como fábrica que cria um `HTTPError` marcado por propriedade interna (prefixo `~`, não enumerável), que `errorResponse` em `src/response.ts` lê para escolher corpo e `content-type`.
- `message` do erro mapeia para `detail`, e `statusText` para `title`; o `type` padrão é `about:blank`, como prevê a RFC.
- Os campos `type` e `instance` são guardados no erro sem expor novos nomes públicos (ex.: dentro de `body` ou propriedade interna).
- O projeto segue as convenções do `AGENTS.md`: ESM, extensões `.ts`, `isolatedDeclarations`, arquivos curtos, sem barrel files.

### Riscos
- **Colisão de nomes:** `body` com chaves `type`/`title`/`detail`/`status`/`instance` pode sobrescrever membros padrão; mitigado pela regra de precedência do RF-03.
- **Vazamento de informação:** `detail` e extensões em erros `unhandled` expõem dados internos; mitigado por RF-07 e testes.
- **Regressão de formato:** alterar `errorResponse` pode mudar erros comuns; mitigado por RF-06 e pela suíte existente.
- **Tipos/declarações:** `isolatedDeclarations` exige anotações explícitas de retorno e do tipo de entrada exportado; o tipo do `input` deve estender `ErrorInput` sem quebrar inferência de `HTTPError`.
- **Marcação perdida:** se o erro for clonado ou reembrulhado por `toError`/hooks, a marca de problem details pode se perder; precisa de teste com `onError`.
- **Tamanho do bundle/API:** exportar de `src/index.ts` altera a API pública; verificar que nenhum snapshot de exports existente quebre e ajustá-lo.
