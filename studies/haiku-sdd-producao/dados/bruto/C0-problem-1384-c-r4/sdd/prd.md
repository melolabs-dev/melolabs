# PRD — Problem details (RFC 9457) por utilitário explícito

Origem: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros como JSON próprio (`{ status, statusText, message, data, ...body }`, `content-type: application/json`). Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), então clientes, gateways e ferramentas que esperam `application/problem+json` não conseguem tratá-lo de forma padronizada.

### Objetivo

Permitir que um handler responda erros no formato "problem details" (RFC 9457, representação JSON) chamando explicitamente um novo utilitário `problem(input)`, exportado por `h3`, que devolve um `HTTPError`. Somente as respostas que usam o utilitário mudam; todo o restante do comportamento de erros permanece idêntico.

### Métricas de sucesso

- Um handler que faz `throw problem({...})` produz resposta `application/problem+json` válida segundo a RFC 9457.
- Nenhuma resposta de erro existente (sem `problem`) muda de corpo, status ou cabeçalhos.
- `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado

`problem` é exportada pelo pacote `h3` (`src/index.ts`) e retorna uma instância de `HTTPError` (`HTTPError.isError` verdadeiro), podendo ser lançada (`throw`) ou retornada de um handler.

**Critério de aceite**

- **Dado** um app h3 com um handler que executa `throw problem({ status: 404 })`
- **Quando** o cliente requisita a rota
- **Então** `problem` é importável de `h3`, o valor lançado é um `HTTPError` e a resposta tem status 404.

### RF-02 — Tipo de entrada

A entrada aceita todos os campos do objeto de entrada de `HTTPError` (`ErrorInput`: `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled` e os descontinuados `statusCode`/`statusMessage`) e, adicionalmente, os campos opcionais `type` e `instance` (strings, referências de URI). O tipo da entrada é exportado e é o único nome público novo além de `problem`.

**Critério de aceite**

- **Dado** um código TypeScript que chama `problem({ status: 403, message: "x", type: "https://example.com/probs/forbidden", instance: "/contas/123", data: { a: 1 }, headers: { "x-a": "1" } })`
- **Quando** o projeto é verificado com `pnpm typecheck`
- **Então** a chamada compila sem erro, e `type`/`instance` com valor não string são rejeitados em tempo de compilação.

### RF-03 — Content-Type da resposta

A resposta de um erro criado por `problem` usa `content-type: application/problem+json` (com `charset=UTF-8`, coerente com o `application/json;charset=UTF-8` atual) e corpo JSON serializado.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 400, message: "Dados inválidos" })`
- **Quando** o cliente recebe a resposta
- **Então** o cabeçalho `content-type` começa com `application/problem+json` e `await res.json()` é um objeto JSON válido.

### RF-04 — Membros padrão do corpo

O corpo contém os membros da RFC 9457:

- `type`: o valor informado; quando ausente, `"about:blank"`.
- `status`: o status HTTP da resposta (inteiro).
- `title`: `statusText` informado ou, na ausência, a frase padrão do status HTTP (ex.: 404 → `"Not Found"`); sem frase conhecida, o membro é omitido.
- `detail`: a mensagem (`message`) do erro, quando informada explicitamente.
- `instance`: o valor informado, omitido se ausente.

Membros `undefined` não aparecem no JSON.

**Critério de aceite**

- **Dado** `problem({ status: 404 })` sem outros campos
- **Quando** a resposta é lida
- **Então** o corpo contém `type: "about:blank"`, `status: 404` e `title: "Not Found"`, e não contém `instance` nem `detail`.

- **Dado** `problem({ status: 422, statusText: "Entidade inválida", message: "O campo email é obrigatório", type: "https://example.com/probs/validacao", instance: "/cadastro" })`
- **Quando** a resposta é lida
- **Então** o corpo tem exatamente `type`, `status: 422`, `title: "Entidade inválida"`, `detail: "O campo email é obrigatório"` e `instance: "/cadastro"`, sem outros membros.

### RF-05 — Coerência entre status do corpo e da resposta

O membro `status` do corpo é sempre igual ao status HTTP da resposta, inclusive quando o status informado é normalizado pelo `HTTPError` (ex.: ausente → 500).

**Critério de aceite**

- **Dado** `problem({ message: "falha" })` sem `status`
- **Quando** a resposta é lida
- **Então** o status HTTP é 500 e `body.status === 500`.

### RF-06 — Membros de extensão

Os campos de `body` do input são emitidos como membros de extensão na raiz do corpo, e `data` é emitido sob o membro `data` (mesma semântica de hoje). Extensões não podem sobrescrever os membros padrão (`type`, `status`, `title`, `detail`, `instance`).

**Critério de aceite**

- **Dado** `problem({ status: 400, body: { errors: ["a"], status: 999 }, data: { campo: "email" } })`
- **Quando** a resposta é lida
- **Então** o corpo contém `errors: ["a"]` na raiz e `data: { campo: "email" }`, e `status` continua `400`.

### RF-07 — Erros não tratados (`unhandled`) não vazam detalhes

Quando `unhandled` é verdadeiro, o corpo problem não expõe `detail`, `data` nem extensões (mesma proteção do `toJSON` atual); `title` é a frase padrão do status.

**Critério de aceite**

- **Dado** `problem({ status: 500, unhandled: true, message: "segredo", data: { s: 1 }, body: { x: 1 } })`
- **Quando** a resposta é lida
- **Então** o corpo não contém `"segredo"`, `data` nem `x`, mas mantém `type`, `status` e `title`.

### RF-08 — Cabeçalhos

Cabeçalhos informados em `headers` continuam sendo enviados na resposta (e os de `errHeaders`, como hoje), com a exceção de `content-type`, que nesse caminho é sempre `application/problem+json`.

**Critério de aceite**

- **Dado** `problem({ status: 401, headers: { "www-authenticate": "Bearer", "content-type": "text/plain" } })`
- **Quando** a resposta é lida
- **Então** `www-authenticate` é `Bearer` e `content-type` começa com `application/problem+json`.

### RF-09 — Modo debug

No modo `debug`, o `stack` continua sendo incluído como membro de extensão `stack` (mesma regra atual); fora de debug, não aparece.

**Critério de aceite**

- **Dado** um app com `debug: true` e `problem({ status: 500, message: "x" })`
- **Quando** a resposta é lida
- **Então** o corpo contém `stack` (array de linhas); com `debug` desligado, o corpo não contém `stack`.

### RF-10 — Compatibilidade: nada muda sem `problem`

`HTTPError`, `HTTPError.status`, erros lançados por handlers, erros de validação, 404/405 etc. continuam respondendo exatamente como hoje (`application/json`, mesmos membros). `HTTPError.toJSON()` e os campos públicos de `HTTPError` não mudam de forma observável para erros comuns. Nenhum export existente é removido ou alterado.

**Critério de aceite**

- **Dado** a suíte de testes existente (matriz `web` e `node`)
- **Quando** `pnpm test` é executado após a mudança
- **Então** todos os testes passam; qualquer ajuste em teste existente é restrito ao que a mudança afeta e não enfraquece as asserções.

### RF-11 — Funciona em toda a cadeia e nos dois modos de execução

`problem` funciona igualmente em `web` e `node` (`describeMatrix`), lançado em handler, em middleware e em hooks `onError`, e retornado como valor do handler.

**Critério de aceite**

- **Dado** `problem({ status: 409 })` lançado em um handler, lançado em um middleware e retornado por outro handler
- **Quando** cada rota é requisitada em modo `web` e `node`
- **Então** as três respostas têm status 409 e `application/problem+json` com o mesmo corpo.

### RF-12 — Qualidade e testes

A implementação inclui testes (regressão e casos de RF-01 a RF-11, incluindo teste de tipos para a entrada) e passa em `pnpm lint` e `pnpm typecheck`, respeitando as convenções do repositório (imports com `.ts`, sem barrel files, helpers internos ao final do arquivo ou em `utils/internal/`, arquivos curtos).

**Critério de aceite**

- **Dado** a mudança implementada
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` são executados
- **Então** todos terminam sem erros, e os novos testes falhavam antes da implementação (fluxo do AGENTS.md).

## 3. Fora de escopo

- Converter automaticamente **todas** as respostas de erro do h3 para problem details (opção global na config do `H3`, negociação por `Accept`); nesta variante só o utilitário explícito muda a resposta.
- Representação XML (`application/problem+xml`) da RFC 9457.
- Novos nomes públicos além de `problem` e do tipo da sua entrada (sem classe `ProblemError`, sem helpers de registro de tipos, sem novos hooks).
- Hospedagem de documentação para as URIs `type` e validação de que `type`/`instance` sejam URIs absolutas ou resolvíveis.
- Alterações em Nitro, `srvx` ou outros pacotes; documentação além do necessário.
- Mudar a semântica atual de `HTTPError`, `onError` ou `toResponse` para erros comuns.

## 4. Premissas e riscos

### Premissas

- Marcar um `HTTPError` como problem, sem expor API nova, é feito por propriedade interna não enumerável (prefixo `~`, convenção do projeto), lida pela montagem da resposta de erro em `src/response.ts`.
- `type` e `instance` são aceitos como strings sem validação de formato; `type` ausente equivale a `"about:blank"` (RFC 9457, seção 4.2.1).
- `title` ausente recebe a frase padrão do status, como a RFC recomenda para `about:blank`; a tabela de frases é pequena e interna.
- `message` explícito mapeia para `detail`; quando o `message` é gerado automaticamente pelo `HTTPError` (ex.: `"HTTPError 404"`), `detail` é omitido.
- `statusText` e `unhandled` do formato legado não aparecem no corpo problem (não são membros da RFC).
- Quem precisa de `application/json` continua usando `HTTPError` comum.

### Riscos

- **Colisão de membros:** extensões (`body`, `data`) tentando sobrescrever membros padrão; mitigado por RF-06.
- **Vazamento de informação** em erros `unhandled`; mitigado por RF-07.
- **Perda da marca "problem"** quando o `HTTPError` é recriado a partir de `cause` ou reembrulhado em `toResponse`/`onError` (`new HTTPError(val)`); exige o teste de RF-11 e cuidado na implementação.
- **Testes existentes sensíveis** a `toJSON` ou a cabeçalhos de erro; manter mudanças mínimas e preservar asserções (RF-10).
- **Restrição de nomes públicos:** tipar a entrada exige exportar o tipo; qualquer helper adicional precisa permanecer interno, e `isolatedDeclarations` exige anotações explícitas de tipo nos exports.
- **Tabela de frases HTTP** aumenta o bundle; mantê-la enxuta.
