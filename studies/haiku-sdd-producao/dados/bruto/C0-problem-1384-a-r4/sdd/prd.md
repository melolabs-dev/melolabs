# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, `stack`) e `Content-Type: application/json`. Clientes e gateways que esperam o padrão RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretar essas respostas de forma uniforme, e `HTTPError` não tem como carregar os membros `type` e `instance` definidos pela norma.

### Objetivo

Permitir que uma aplicação h3 responda erros no formato `application/problem+json` (RFC 9457) ligando uma única opção, `problemDetails`, em `H3Config`. Sem a opção, o comportamento atual permanece idêntico. `HTTPError` passa a aceitar e expor `type` e `instance`.

### Métricas de sucesso

- Com `problemDetails: true`, toda resposta de erro gerada pelo h3 é um problem details válido.
- Com a opção desligada ou ausente, nenhuma resposta existente muda (corpo, status, cabeçalhos).
- A suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Adicionar a opção booleana `problemDetails` a `H3Config`, desligada por padrão e lida de `app.config` como as demais opções (por exemplo `debug`).

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** um handler lança `HTTPError` com status 404
- **Então** a resposta continua com `Content-Type: application/json` e o corpo no formato atual (`status`, `statusText`, `message`, ...), sem nenhuma alteração.

### RF-02 — Content-Type `application/problem+json`

Com a opção ligada, a resposta de erro usa o tipo de mídia `application/problem+json`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `HTTPError` com status 400
- **Então** a resposta tem status 400 e o cabeçalho `Content-Type` começa com `application/problem+json`, e o corpo é JSON válido.

### RF-03 — Membros padrão `type`, `title`, `status` e `detail`

O corpo problem details contém: `type` (URI; `"about:blank"` quando o erro não define um), `title` (resumo curto: o `statusText` do erro, ou a frase padrão do status HTTP quando ausente), `status` (igual ao status HTTP da resposta) e `detail` (a mensagem do erro). O membro `message` do formato legado não é emitido neste modo.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `new HTTPError("Usuário não encontrado", { status: 404 })`
- **Então** o corpo contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não encontrado"`, e não contém `message`.

### RF-04 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance`; ambos ficam expostos como propriedades somente leitura da instância (`undefined` quando não informados). Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 409, type: "https://example.com/probs/conflito", instance: "/pedidos/42" })`
- **Quando** se lêem `error.type` e `error.instance`
- **Então** os valores são `"https://example.com/probs/conflito"` e `"/pedidos/42"`; e um `HTTPError` criado sem esses campos retorna `undefined` para ambos.

### RF-05 — `type` e `instance` no corpo problem details

Quando definidos no erro, `type` e `instance` são emitidos no corpo problem details; `instance` é omitido se não definido.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `HTTPError` com `status: 409`, `type: "https://example.com/probs/conflito"` e `instance: "/pedidos/42"`
- **Então** o corpo contém exatamente esses valores em `type` e `instance`; e, sem `instance` no erro, a chave `instance` não aparece no corpo.

### RF-06 — Membros de extensão (`data` e `body`)

Os dados adicionais do erro continuam sendo enviados como membros de extensão: `data` sob a chave `data` e as propriedades de `body` no nível raiz. Propriedades de `body` não podem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `HTTPError` com `status: 422`, `data: { campo: "email" }` e `body: { code: "E_VALID", status: 200 }`
- **Então** o corpo contém `data: { campo: "email" }` e `code: "E_VALID"`, e `status` permanece `422`.

### RF-07 — Erros não tratados continuam protegidos

Erros marcados como `unhandled` não vazam detalhes no modo problem details: `detail` não expõe a mensagem original e `data`/`body` não são enviados, como já ocorre no formato atual.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug` desligado
- **Quando** um handler lança um `Error` comum com a mensagem "segredo interno"
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, e o corpo não contém o texto "segredo interno" nem `stack`.

### RF-08 — Compatibilidade com `debug`, cabeçalhos e hooks

O modo problem details preserva: o `stack` no corpo quando `debug` está ligado (como membro de extensão); os cabeçalhos do erro (`error.headers`) e os definidos em `event.res.headers`, exceto `Content-Type`, que é `application/problem+json`; e a execução de `onError`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug: true`, e um `HTTPError` com `headers: { "x-id": "1" }`
- **Quando** o erro é lançado em um handler
- **Então** a resposta inclui o cabeçalho `x-id: 1`, o corpo contém `stack` e o `Content-Type` é `application/problem+json`.

### RF-09 — Sem regressão e sem novos nomes públicos

A única superfície pública adicional é a opção `problemDetails` e os campos `type`/`instance` de `HTTPError`/`ErrorInput`. Os testes existentes são mantidos; só se ajusta o estritamente necessário, sem perder o que verificam.

**Critério de aceite**

- **Dado** o conjunto de testes existente e os novos testes de problem details
- **Quando** se executa `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam e nenhuma exportação nova aparece em `src/index.ts`.

## 3. Fora de escopo

- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Ligar o formato por requisição, por rota ou por cabeçalho (apenas a opção global da aplicação).
- Novas funções utilitárias, classes ou exportações públicas (por exemplo helpers para criar problems).
- Registro de tipos de problema, URIs de documentação ou catálogo de erros.
- Mudar o formato de erro de `defineJsonRpcHandler`, WebSocket e SSE.
- Alterar o formato padrão (a opção continua desligada por padrão).
- Documentação do site além da descrição JSDoc da opção.

## 4. Premissas e riscos

### Premissas

- A conversão ocorre onde a resposta de erro é montada (`errorResponse` em `src/response.ts`), que já tem acesso a `config`; `HTTPError.toJSON()` não depende da configuração e permanece como está.
- O valor padrão de `type` é `"about:blank"` e o de `title`, a frase padrão do status, conforme a RFC 9457 §4.2.1 e §3.1.3.
- `statusText` do erro, quando presente, serve como `title`.
- A opção é lida uma vez de `app.config`, no mesmo ponto em que `debug` já é consumido.

### Riscos

- **Testes existentes:** algum teste pode depender da forma do `HTTPError` (por exemplo, comparar `toJSON()` ou propriedades enumeráveis); adicionar `type`/`instance` pode exigir ajuste mínimo. _Mitigação:_ rodar a suíte completa e ajustar sem enfraquecer asserções.
- **Quebra de contrato do corpo:** clientes que leem `message` quebram se ligarem a opção. _Mitigação:_ opção desligada por padrão e documentada no JSDoc.
- **Colisão de chaves:** `body` do usuário pode conflitar com membros padrão. _Mitigação:_ RF-06 define que os membros padrão prevalecem.
- **Vazamento em erros não tratados:** novo formato pode expor `detail` por engano. _Mitigação:_ RF-07 com teste dedicado.
- **Efeito de `type`/`instance` em `cause`:** `HTTPError` herda campos de `cause` para status e headers; decidir se `type`/`instance` também são herdados deve seguir o mesmo padrão, para evitar comportamento surpreendente.
- **Tipos:** `isolatedDeclarations` exige anotações explícitas nos novos membros públicos.
