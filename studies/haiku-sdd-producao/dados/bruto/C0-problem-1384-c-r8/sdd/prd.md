# PRD — Problem Details (RFC 9457) via utilitário `problem()`

Referência: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
O h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, mais `body` achatado), com `content-type: application/json;charset=UTF-8` (`errorResponse` em `src/response.ts`). Clientes e gateways que esperam o padrão RFC 9457 (Problem Details for HTTP APIs) não conseguem consumir esses erros de forma uniforme: faltam os membros `type`, `title`, `detail` e `instance` e o media type `application/problem+json`.

### Objetivo
Permitir que um handler responda um erro no formato RFC 9457 (representação JSON) chamando explicitamente o utilitário `problem(input)`, exportado por `h3`, que devolve um `HTTPError`. Só as respostas que usam o utilitário mudam; todo o restante do comportamento de erros permanece idêntico.

### Métricas de sucesso
- Um handler que faz `throw problem({...})` ou `return problem({...})` produz uma resposta `application/problem+json` válida segundo a RFC 9457.
- Nenhum teste existente perde cobertura e `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Exportar `problem(input)` e o tipo de entrada
`problem` é exportada do pacote `h3` (`src/index.ts`), recebe um `input` e devolve uma instância de `HTTPError`. O tipo da entrada (ex.: `ProblemInput`) também é exportado. Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** o pacote `h3` importado,
- **Quando** o consumidor executa `import { problem } from "h3"` e chama `problem({ status: 404 })`,
- **Então** o retorno é um `HTTPError` (`HTTPError.isError(...)` verdadeiro) com `status` 404, e a lista de exports públicos difere da atual apenas por `problem` e pelo tipo da entrada.

### RF-02 — Entrada aceita os campos de `HTTPError` mais `type` e `instance`
`input` aceita todos os campos do objeto de entrada de `HTTPError` (`ErrorInput`: `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`, e os campos depreciados) e os campos opcionais `type` e `instance` (strings, URI-reference conforme a RFC 9457).

**Critério de aceite**
- **Dado** um `input` com `status`, `message`, `headers`, `data`, `type` e `instance`,
- **Quando** `problem(input)` é chamado,
- **Então** o `HTTPError` resultante preserva `status`, `message`, `headers` e `data`, e o código compila em TypeScript estrito; um `input` com `type: 123` falha em `typecheck`.

### RF-03 — Corpo da resposta no formato Problem Details
Quando um `HTTPError` criado por `problem()` é convertido em resposta, o corpo JSON segue a RFC 9457:
- `type`: o valor informado, ou `"about:blank"` quando omitido;
- `status`: o código HTTP da resposta;
- `title`: `statusText` informado ou, na ausência, a frase padrão do status HTTP (ex.: "Not Found"); para `about:blank` a RFC recomenda a frase do status;
- `detail`: `message` quando informada explicitamente;
- `instance`: o valor informado, quando houver;
- membros de extensão: `data` e as chaves de `body` aparecem no nível raiz do objeto, sem sobrescrever os membros padrão acima.

**Critério de aceite**
- **Dado** `problem({ status: 404, type: "https://ex.com/nao-encontrado", message: "Usuário 7 não existe", instance: "/users/7", body: { traceId: "abc" } })` lançado por um handler,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status 404 e corpo `{ "type": "https://ex.com/nao-encontrado", "status": 404, "title": "Not Found", "detail": "Usuário 7 não existe", "instance": "/users/7", "traceId": "abc" }`.

### RF-04 — Media type `application/problem+json`
A resposta de um erro criado por `problem()` usa `content-type: application/problem+json` (com charset UTF-8, coerente com o restante do framework).

**Critério de aceite**
- **Dado** um handler que lança `problem({ status: 400 })`,
- **Quando** o cliente recebe a resposta,
- **Então** o header `content-type` começa com `application/problem+json`.

### RF-05 — Valores padrão quando o input é mínimo
`problem()` funciona com entrada mínima, sem lançar exceção e sem exigir `type`, `instance` ou `message`.

**Critério de aceite**
- **Dado** `problem({ status: 403 })` (ou `problem({})`, que segue o padrão 500 do `HTTPError`),
- **Quando** a resposta é gerada,
- **Então** o corpo é `{ "type": "about:blank", "status": 403, "title": "Forbidden" }` sem `detail` e sem `instance`, e não contém chaves com valor `undefined` serializadas.

### RF-06 — Funciona como `throw` e como `return`
O `HTTPError` devolvido por `problem()` é tratado igualmente pelo framework quando lançado em handler/middleware ou retornado do handler (`toResponse`).

**Critério de aceite**
- **Dado** duas rotas, uma com `throw problem({ status: 409 })` e outra com `return problem({ status: 409 })`,
- **Quando** ambas são requisitadas,
- **Então** as duas respondem 409, `application/problem+json` e corpos idênticos.

### RF-07 — Headers e statusText do input são respeitados
`headers` informados em `input` são enviados na resposta (podendo sobrescrever o content-type padrão apenas se o usuário o definir explicitamente, como hoje); `statusText` informado vira o `title` e o status text HTTP.

**Critério de aceite**
- **Dado** `problem({ status: 429, statusText: "Too Many Requests", headers: { "retry-after": "30" } })`,
- **Quando** a resposta é gerada,
- **Então** o header `retry-after: 30` está presente e `title` é `"Too Many Requests"`.

### RF-08 — Comportamento atual preservado para erros sem `problem()`
Erros que não usam `problem()` (`new HTTPError`, `HTTPError.status`, `throw` de `Error` comum, 404 de rota inexistente, validação, etc.) continuam com o formato e content-type atuais.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 400, message: "ruim", data: { a: 1 } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo e o content-type são exatamente os de antes da mudança (`application/json;charset=UTF-8`, com `status`, `message`, `data`, sem `type`/`title`/`detail`).

### RF-09 — Erros não tratados e modo debug seguem as regras de segurança existentes
Se o erro de `problem()` estiver marcado `unhandled: true`, `message`/`data`/`body` continuam ocultos (`detail` não vaza a mensagem). Em modo debug, o `stack` continua sendo incluído como hoje.

**Critério de aceite**
- **Dado** `problem({ status: 500, unhandled: true, message: "segredo", data: { k: 1 } })`,
- **Quando** a resposta é gerada fora do modo debug,
- **Então** o corpo não contém `"segredo"` nem `k`, e continua sendo `application/problem+json` com `type`, `status` e `title`.

### RF-10 — Testes, lint e typecheck
Há testes novos (via `describeMatrix`, em `test/`) cobrindo RF-01 a RF-09 nos modos web e node, e testes de tipos para a entrada. Testes existentes só são ajustados se dependerem do que a mudança altera (ex.: snapshot de exports públicos), sem perder o que verificam.

**Critério de aceite**
- **Dado** a branch com a implementação,
- **Quando** se executa `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`,
- **Então** todos passam, e o teste de regressão do RF-08 já passava antes da mudança.

## 3. Fora de escopo
- Mudar globalmente o formato de erros do h3 (variante "opt-in global" ou negociação por header `Accept`): nesta variante só `problem()` aciona o formato.
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro de tipos de problema (IANA), catálogo de URIs de `type` ou páginas de documentação por tipo.
- Novos utilitários públicos além de `problem` e do tipo de entrada (sem helpers como `isProblem`, sem opções de configuração em `H3Config`).
- Alterações em `nitro`, adaptadores de plataforma ou no tratamento de `onError`.
- Mudar `HTTPError`, `ErrorBody` ou `toJSON()` de forma observável para quem não usa `problem()`.
- Erros múltiplos (`errors` array) e validação específica de URI em `type`/`instance`.

## 4. Premissas e riscos

### Premissas
- `problem()` devolve um `HTTPError` (exigência do contrato), portanto o formato precisa ser carregado pelo próprio erro (por exemplo, uma marca interna não enumerável com prefixo `~`, ou uma subclasse não exportada), e `errorResponse` em `src/response.ts` decide corpo e content-type com base nessa marca.
- `type` e `instance` são tratados como strings opacas; a validação de URI é responsabilidade do chamador.
- `message` explícito mapeia para `detail`; sem `message`, `detail` é omitido em vez de reaproveitar a mensagem sintética `"HTTPError 404"`.
- `body` e `data` do `HTTPError` viram membros de extensão no nível raiz; membros padrão (`type`, `status`, `title`, `detail`, `instance`) têm precedência em caso de colisão.
- A frase padrão do status vem de uma tabela mínima interna ou de `statusText`; se não houver frase conhecida, `title` pode ser omitido.

### Riscos
- **Vazamento da marca em cópias do erro**: erros reconstruídos (`new HTTPError(cause)`) podem perder a marca e voltar ao formato antigo; mitigar propagando a marca quando `cause` é um erro de `problem()`.
- **Quebra de compatibilidade acidental**: mexer em `toJSON()` ou `errorResponse` pode alterar respostas atuais; mitigar com o teste do RF-08 escrito antes da implementação.
- **Testes existentes dependentes de exports**: snapshots de API pública podem precisar de ajuste; deve-se ajustar sem enfraquecer a verificação.
- **Colisão de chaves de extensão** com membros padrão da RFC pode confundir clientes; a precedência dos membros padrão deve ser documentada.
- **Vazamento de informação** em `detail`/extensões de erros não tratados; coberto pelo RF-09.
- **Divergência entre runtimes** (web vs node) no content-type ou charset; mitigar testando na matriz.
