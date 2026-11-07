# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384 · Contrato enxuto #1384-A (`sdd/pedido.md`)

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, mais `stack` em modo debug), com `content-type` JSON genérico. Clientes e ferramentas que seguem a RFC 9457 (Problem Details for HTTP APIs) não reconhecem esse formato, pois ele não usa `application/problem+json` nem os membros padronizados (`type`, `title`, `status`, `detail`, `instance`). Também não há como um `HTTPError` carregar `type` e `instance`.

### Objetivo
Permitir que o h3 responda erros no formato problem details (representação JSON da RFC 9457), ligado por uma opção de configuração da aplicação. Sem a opção, o comportamento atual permanece idêntico.

### Nomes públicos (únicos permitidos)
- Opção booleana `problemDetails` em `H3Config`, desligada por padrão, lida de `app.config` como as demais opções.
- Campos opcionais `type` e `instance` no objeto de entrada do construtor de `HTTPError`, expostos na instância.

### Métricas de sucesso
- Com `problemDetails: true`, toda resposta de erro gerada pelo h3 é um problem details válido com `content-type: application/problem+json`.
- Com a opção desligada ou ausente, nenhuma resposta existente muda (corpo, status, cabeçalhos).
- `pnpm lint`, `pnpm typecheck` e a suíte de testes passam.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`
`H3Config` ganha a opção booleana opcional `problemDetails`, documentada, desligada por padrão e lida de `app.config` como `debug` e `silent`.

**Critério de aceite**
- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** um handler lança `HTTPError` e a resposta é gerada
- **Então** o corpo e o `content-type` são exatamente os de hoje (JSON atual do h3), sem `type`, `title`, `detail` ou `instance` adicionados.

### RF-02 — Content-Type `application/problem+json`
Com a opção ligada, respostas de erro usam `content-type: application/problem+json` (RFC 9457 §3), mantendo a codificação UTF-8 já usada pelo h3 para JSON.

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`
- **Quando** uma rota lança `HTTPError.status(404)`
- **Então** a resposta tem status 404 e o cabeçalho `content-type` começa com `application/problem+json`.

### RF-03 — Membros padrão do corpo
Com a opção ligada, o corpo de erro contém os membros da RFC 9457:
- `status`: o código HTTP da resposta;
- `title`: o `statusText` do erro, quando houver; caso contrário o texto padrão do status (ex.: "Not Found");
- `detail`: a `message` do erro, quando for diferente do `title`;
- `type`: valor informado no erro; se ausente, omitido (equivale a `about:blank`, conforme a RFC §4.2.1);
- `instance`: valor informado no erro; se ausente, omitido.

**Critério de aceite**
- **Dado** `problemDetails: true` e uma rota que lança `new HTTPError("Usuário não encontrado", { status: 404, statusText: "Not Found" })`
- **Quando** o cliente faz a requisição
- **Então** o JSON contém `status: 404`, `title: "Not Found"` e `detail: "Usuário não encontrado"`, e não contém `type` nem `instance`.

### RF-04 — `HTTPError` aceita `type` e `instance`
O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance` (strings, URIs de referência), que ficam expostos como propriedades `type` e `instance` na instância. Não há novo nome público além desses dois campos.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/contas/12/saques/9" })`
- **Quando** se lêem `error.type` e `error.instance`
- **Então** retornam, respectivamente, `"https://exemplo.com/erros/sem-saldo"` e `"/contas/12/saques/9"`; sem informar os campos, ambos são `undefined`.

### RF-05 — `type` e `instance` no corpo da resposta
Com a opção ligada, `type` e `instance` presentes no erro aparecem no corpo da resposta com os mesmos valores.

**Critério de aceite**
- **Dado** `problemDetails: true` e uma rota que lança `HTTPError` com `type` e `instance` definidos
- **Quando** o cliente faz a requisição
- **Então** o JSON da resposta contém `type` e `instance` com exatamente os valores informados.

### RF-06 — Extensões via `data` e `body`
Com a opção ligada, os mecanismos existentes de extensão continuam funcionando: propriedades de `body` entram no nível superior do corpo (membros de extensão da RFC §3.2) e `data` permanece sob a chave `data`. Membros de extensão não sobrescrevem os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**
- **Dado** `problemDetails: true` e `new HTTPError({ status: 422, body: { campo: "email", status: 200 }, data: { x: 1 } })`
- **Quando** o cliente faz a requisição
- **Então** o JSON contém `campo: "email"`, `data: { x: 1 }` e `status: 422` (o `status` da extensão não substitui o real).

### RF-07 — Erros não tratados continuam mascarados
Com a opção ligada, erros `unhandled` não vazam mensagem, `data`, `body` nem stack fora do modo debug. O corpo é um problem details genérico com status 500.

**Critério de aceite**
- **Dado** `problemDetails: true`, `debug` desligado e uma rota que faz `throw new Error("segredo interno")`
- **Quando** o cliente faz a requisição
- **Então** a resposta é 500 com `content-type: application/problem+json`, o corpo não contém "segredo interno" nem `stack`, e `detail` (se presente) não revela a mensagem original.

### RF-08 — Modo debug preservado
Com `problemDetails` e `debug` ligados, o `stack` continua sendo incluído (como membro de extensão) e a formatação indentada é mantida.

**Critério de aceite**
- **Dado** `problemDetails: true` e `debug: true`
- **Quando** uma rota lança um erro
- **Então** o corpo é um problem details válido que também contém `stack` como lista de linhas.

### RF-09 — Cabeçalhos, status e `statusText` preservados
Com a opção ligada, o status HTTP, o `statusText` da resposta e os cabeçalhos do erro (`error.headers` e cabeçalhos definidos em `event.res`) continuam sendo aplicados; apenas o `content-type` muda (RF-02).

**Critério de aceite**
- **Dado** `problemDetails: true` e um erro com `headers: { "x-trace": "abc" }` e `status: 401`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 401, o cabeçalho `x-trace: abc` e `content-type` `application/problem+json`.

### RF-10 — Cobertura dos caminhos de erro do h3
Com a opção ligada, o formato vale para todo erro convertido em resposta pelo h3: rota inexistente (404), erros lançados em handlers e middlewares, erros de validação e o retorno de `onError`. Quando `onError` devolve um valor próprio, esse valor tem precedência, como hoje.

**Critério de aceite**
- **Dado** `problemDetails: true` e nenhuma rota registrada para `/nada`
- **Quando** o cliente requisita `/nada`
- **Então** a resposta é 404 com `content-type: application/problem+json` e corpo com `status: 404` e `title`.

### RF-11 — Testes e qualidade
Há testes de regressão em `test/` (via `describeMatrix`, em `web` e `node`) cobrindo RF-01 a RF-10, e testes de tipo para `ErrorInput`/`H3Config`. Testes existentes só são ajustados quando dependem do que a mudança altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** se executam `pnpm lint`, `pnpm typecheck` e `pnpm test`
- **Então** todos passam, e os testes novos falham se a opção for removida.

## 3. Fora de escopo
- Qualquer outro nome público novo (funções utilitárias, classes, exports, subpaths).
- Ligar o formato por negociação de conteúdo (`Accept`), por rota ou por requisição; só a opção global de `H3Config`.
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro de tipos de problema (IANA) ou páginas de documentação de URIs de `type`.
- Alterar o formato padrão atual de erro ou torná-lo problem details por padrão.
- Mudanças no `toJSON()` público de `HTTPError` além do necessário para os campos novos, nas respostas de erro JSON-RPC e em adaptadores de WebSocket.
- Integração com Nitro.

## 4. Premissas e riscos

### Premissas
- `problemDetails` é lida de `app.config` no ponto de geração da resposta de erro (hoje `errorResponse` em `src/response.ts`), como `debug` e `silent`.
- `title` deriva do `statusText` do erro; na ausência, de um texto padrão do status HTTP, sem criar nova API pública.
- `type` ausente é omitido, o que a RFC trata como `about:blank`.
- Uma única fonte de verdade para a ordem de campos e precedência (padrão sobre extensão) evita divergência entre caminhos.

### Riscos e mitigação
| Risco | Mitigação |
| --- | --- |
| Testes existentes que checam o corpo/`content-type` atuais quebrarem | Opção desligada por padrão: o caminho atual fica intacto; ajustar só testes que dependam de mudança real. |
| Vazamento de dados em `unhandled` ao reaproveitar `toJSON()` | RF-07 com teste dedicado; reutilizar a máscara já existente. |
| `body` de extensão sobrescrever `status`/`type`/`title` | RF-06 define precedência dos membros padrão, com teste. |
| `toJSON()` mudar o formato atual para quem o usa fora da resposta | Não alterar a saída existente quando a opção estiver desligada; novos campos só se definidos. |
| Duplicidade `title`/`detail` (mensagem igual ao `statusText`) | `detail` só aparece quando difere de `title` (RF-03). |
| Chaves `type`/`instance` em `body` colidirem com os novos campos | Campo explícito do erro vence o de `body`; documentar no teste. |
| Diferenças entre runtimes (`web`/`node`) | Testes em `describeMatrix`. |
