# PRD — Problem details (RFC 9457) via utilitário `problem()`

Referência: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 serializa erros (`HTTPError`) como JSON próprio (`status`, `statusText`, `message`, `data`, ...) com `content-type: application/json`. Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), então clientes e gateways que esperam `application/problem+json` (campos `type`, `title`, `status`, `detail`, `instance`) não conseguem interpretar as respostas de erro de forma padronizada.

### Objetivo

Permitir que um handler responda erros no formato problem details da RFC 9457 (representação JSON), chamando explicitamente um novo utilitário `problem(input)`, exportado por `h3`, que devolve um `HTTPError`. Apenas as respostas que usam o utilitário mudam; todo o comportamento atual de erros permanece idêntico.

### Métricas de sucesso

- Um handler que faz `throw problem({...})` produz resposta `application/problem+json` válida segundo a RFC 9457.
- Nenhum teste existente perde cobertura e `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Função `problem(input)` exportada

`problem` é exportada pelo pacote `h3` (via `src/index.ts`) e devolve uma instância de `HTTPError`. É o único nome público novo, além do tipo da sua entrada (ex.: `ProblemInput`).

**Critério de aceite**
- **Dado** que importo `problem` de `h3`
- **Quando** chamo `problem({ status: 404 })`
- **Então** recebo uma instância de `HTTPError` com `status === 404`, e `HTTPError.isError(...)` retorna `true` para ela.

### RF-02 — Entrada aceita campos de `HTTPError` mais `type` e `instance`

O `input` aceita todos os campos de `ErrorInput` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`, ...) e, adicionalmente, os opcionais `type` (string, URI de referência) e `instance` (string, URI de referência).

**Critério de aceite**
- **Dado** o tipo de entrada de `problem`
- **Quando** passo `{ status: 400, message: "x", type: "https://ex.com/erros/invalido", instance: "/pedidos/42", data: { a: 1 }, headers: { "x-a": "1" } }`
- **Então** o código compila (typecheck) e o `HTTPError` resultante preserva `status`, `message`, `data` e `headers`.

### RF-03 — Corpo da resposta no formato RFC 9457

Ao ser lançado/retornado por um handler, o erro criado por `problem()` é serializado com os membros padrão da RFC 9457:

- `type`: o valor informado, ou `"about:blank"` quando ausente;
- `title`: `statusText` quando informado; caso contrário, o texto padrão do status HTTP (ex.: "Not Found" para 404);
- `status`: o código HTTP;
- `detail`: a `message` informada (omitido quando não houver mensagem explícita);
- `instance`: o valor informado (omitido quando ausente).

**Critério de aceite**
- **Dado** um handler `() => { throw problem({ status: 404, message: "Pedido não encontrado", type: "https://ex.com/erros/nao-encontrado", instance: "/pedidos/42" }) }`
- **Quando** faço a requisição
- **Então** a resposta tem status 404 e corpo JSON `{ "type": "https://ex.com/erros/nao-encontrado", "title": "Not Found", "status": 404, "detail": "Pedido não encontrado", "instance": "/pedidos/42" }`; sem `type`, o corpo traz `"type": "about:blank"`.

### RF-04 — Content-Type `application/problem+json`

Respostas geradas a partir de `problem()` usam `content-type: application/problem+json` (com charset UTF-8, coerente com o `application/json;charset=UTF-8` atual). Cabeçalhos customizados em `headers` continuam sendo aplicados e podem sobrescrever o padrão, como já ocorre hoje.

**Critério de aceite**
- **Dado** um handler que lança `problem({ status: 400, headers: { "x-id": "1" } })`
- **Quando** faço a requisição
- **Então** o cabeçalho `content-type` começa com `application/problem+json` e `x-id` é `1`.

### RF-05 — Membros de extensão

Campos adicionais de `body` são emitidos como membros de extensão no nível raiz do corpo, e `data` (quando informado) sob a chave `data`, sem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**
- **Dado** `problem({ status: 422, body: { balance: 30, accounts: ["/a/1"] }, data: { campo: "x" } })`
- **Quando** o handler o lança
- **Então** o corpo contém `balance: 30`, `accounts: ["/a/1"]` e `data: { campo: "x" }` ao lado dos membros padrão, e `status` continua `422`.

### RF-06 — Erros não tratados não vazam detalhes

Se o erro de `problem()` for marcado como `unhandled`, o corpo problem details não expõe `detail`, `data` nem extensões; mantém o comportamento atual de ocultação (mensagem genérica) e, fora do modo debug, não inclui `stack`. Em `debug`, o `stack` segue como hoje.

**Critério de aceite**
- **Dado** `problem({ status: 500, message: "segredo", data: { s: 1 }, unhandled: true })` e app sem `debug`
- **Quando** o handler o lança
- **Então** o corpo não contém "segredo", `data` nem `stack`, e o `content-type` continua `application/problem+json`.

### RF-07 — Sem regressão nos erros existentes

Erros que não passam por `problem()` (`new HTTPError(...)`, `HTTPError.status(...)`, erros desconhecidos, 404 padrão, erros de validação) mantêm exatamente o corpo e o `content-type: application/json` atuais. O `toJSON()` de `HTTPError` não muda para erros comuns.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 400, message: "ruim" })`
- **Quando** faço a requisição
- **Então** a resposta continua `application/json` com o mesmo corpo de antes (`status`, `statusText`, `message`, ...), sem `type`/`title`/`detail`.

### RF-08 — Testes e qualidade

Há testes cobrindo RF-01 a RF-07 (usando `describeMatrix`, nos modos `web` e `node`) e um teste de tipos para a entrada. Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** executo `pnpm test`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam, inclusive os novos testes de `problem()`.

## 3. Fora de escopo

- Ativação global/automática de problem details (config do `H3`, negociação por `Accept`, flag de app): só o utilitário explícito.
- Representação XML (`application/problem+xml`) da RFC 9457.
- Alterar o formato de erros gerados pelo próprio h3 (404 padrão, validação, erros internos) ou pelo Nitro.
- Registro/geração de URIs de `type` ou documentação de tipos de problema; helpers para múltiplos erros de validação.
- Novos nomes públicos além de `problem` e o tipo da sua entrada; mudanças em dependências.
- Alterações em `h3/rules`, sessões, proxy e demais utilitários.

## 4. Premissas e riscos

### Premissas

- A serialização continua centralizada em `errorResponse` (`src/response.ts`); `problem()` marca o `HTTPError` retornado (ex.: propriedade interna com prefixo `~`, não enumerável) para que a serialização escolha o formato, sem criar API pública extra.
- `title` padrão vem de uma tabela/função interna de reason phrases; não há dependência nova.
- `type` e `instance` são tratados como strings opacas (URI de referência); a validação de URI fica a cargo do chamador.
- `about:blank` como `type` padrão segue a RFC 9457 §4.2.1.

### Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| Regressão no formato atual de erros | RF-07 e suíte existente; o caminho novo só é ativado pela marca interna de `problem()`. |
| Perder a marca ao embrulhar/reconstruir o erro (ex.: `cause`, `HTTPError.isError` entre módulos) | Testar `throw` direto, erro em middleware e `onError`; documentar a limitação, se houver. |
| Vazamento de dados em erros `unhandled` | RF-06 com teste dedicado. |
| Colisão entre `body`/`data` e membros padrão | RF-05: membros padrão têm precedência. |
| Conflito de `statusText` com `title` (caracteres restritos em `statusText`) | `title` usa `statusText` sanitizado; texto longo vai em `detail`. |
| Tipos (`isolatedDeclarations`) quebrando o typecheck | Anotar tipos explicitamente e cobrir em `types.test-d.ts`. |
