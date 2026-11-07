# PRD — `problem()`: respostas de erro no formato Problem Details (RFC 9457)

Origem: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## Problema e objetivo

Hoje o h3 serializa erros como `application/json` com um formato próprio (`status`, `statusText`, `message`, `data`, ...). APIs que precisam seguir a RFC 9457 (`application/problem+json`, com `type`, `title`, `status`, `detail`, `instance`) não têm um caminho direto: precisam montar o corpo e o cabeçalho manualmente via `HTTPError.body`/`headers`.

**Objetivo:** oferecer a função `problem(input)`, exportada por `h3`, que devolve um `HTTPError` já configurado para ser respondido em formato problem details. O formato é opt-in: só as respostas cujo handler usa `problem()` mudam; o comportamento padrão de erros permanece idêntico.

## Requisitos funcionais

### RF-01 — Exportar `problem` e o tipo de entrada

`problem(input)` é exportada pelo pacote `h3` (`src/index.ts`) e retorna uma instância de `HTTPError`. O tipo de `input` estende `ErrorInput` com `type?: string` e `instance?: string`. Nenhum outro nome público novo é criado além de `problem` e do tipo da entrada.

**Critério de aceite**

- **Dado** o pacote `h3` compilado/importado
- **Quando** se importa `problem` e se chama `problem({ status: 404 })`
- **Então** o resultado é um `HTTPError` (`HTTPError.isError(r) === true`) com `status` 404, e o único novo export público de valor é `problem` (mais o tipo de entrada).

### RF-02 — Content-Type `application/problem+json`

A resposta gerada a partir de um erro criado por `problem()` usa o cabeçalho `content-type: application/problem+json` (mantendo o charset UTF-8 usado nas demais respostas JSON).

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 400 })`
- **Quando** o cliente requisita a rota
- **Então** a resposta tem status 400 e `content-type` começando com `application/problem+json`.

### RF-03 — Corpo com os membros padrão da RFC 9457

O corpo JSON contém os membros: `type` (padrão `"about:blank"` quando omitido), `title` (derivado de `statusText`; se ausente, o texto-padrão do status HTTP), `status` (número), `detail` (derivado de `message`, quando informado) e `instance` (somente quando informado). Membros de extensão (`data`, `body`) continuam sendo emitidos como nível superior conforme o `HTTPError` já faz.

**Critério de aceite**

- **Dado** `throw problem({ status: 422, statusText: "Unprocessable", message: "Campo email inválido", type: "https://example.com/probs/validation", instance: "/users/42" })`
- **Quando** o cliente requisita a rota
- **Então** o JSON da resposta contém `type: "https://example.com/probs/validation"`, `title: "Unprocessable"`, `status: 422`, `detail: "Campo email inválido"` e `instance: "/users/42"`.

### RF-04 — Valores padrão quando só o status é informado

**Critério de aceite**

- **Dado** `throw problem({ status: 404 })`
- **Quando** o cliente requisita a rota
- **Então** o JSON tem `type: "about:blank"`, `status: 404` e `title` igual ao texto-padrão do status (`"Not Found"`), sem o membro `instance`.

### RF-05 — Extensões e cabeçalhos do `HTTPError` preservados

Os campos aceitos hoje por `ErrorInput` (`data`, `body`, `headers`, `cause`, `statusCode`/`statusMessage` deprecados) continuam funcionando em `problem()`. `headers` informados pelo usuário são mantidos na resposta; um `content-type` explícito do usuário prevalece sobre o padrão.

**Critério de aceite**

- **Dado** `throw problem({ status: 429, headers: { "retry-after": "30" }, body: { balance: 0 } })`
- **Quando** o cliente requisita a rota
- **Então** a resposta tem o cabeçalho `retry-after: 30`, `content-type` `application/problem+json` e o JSON contém `balance: 0` no nível superior.

### RF-06 — Erros não tratados não vazam detalhes

Se o erro for marcado `unhandled: true`, valem as mesmas regras de ocultação do h3 atual (mensagem, `data` e `body` omitidos; stack apenas em modo debug); o formato problem details não pode expor o que hoje é escondido.

**Critério de aceite**

- **Dado** `problem({ status: 500, unhandled: true, message: "segredo", data: { x: 1 } })` lançado por um handler
- **Quando** o cliente requisita a rota sem `debug`
- **Então** o corpo não contém `"segredo"`, nem `data`, nem `stack`.

### RF-07 — Nenhuma mudança no comportamento existente

Erros que não passam por `problem()` (`new HTTPError`, `HTTPError.status`, erros genéricos, 404 automático) continuam respondendo `application/json` com o formato atual.

**Critério de aceite**

- **Dado** um handler que faz `throw new HTTPError({ status: 400, message: "ruim" })`
- **Quando** o cliente requisita a rota
- **Então** o `content-type` é `application/json;charset=UTF-8` e o corpo mantém `status`, `statusText`, `message` no formato atual, sem `type`/`title`/`detail`.

### RF-08 — Qualidade e testes

Testes novos (via `describeMatrix`, modos web e node) cobrem RF-01 a RF-07. A suíte existente passa; apenas testes que dependam do que a mudança altera são ajustados, sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** se executam `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** todos terminam sem falhas.

## Fora de escopo

- Converter automaticamente **todos** os erros do h3 para problem details (opção global/config, negociação por `Accept`).
- Representação XML da RFC 9457.
- Registro de tipos de problema (problem type registry), URLs de documentação ou geração de `type` a partir de códigos.
- Integração com validação (`defineValidatedHandler`) ou com route rules para produzir problem details.
- Novos nomes públicos além de `problem` e do tipo de entrada (sem constantes, classes ou helpers adicionais).
- Alterações no Nitro ou em outros pacotes.

## Premissas e riscos

**Premissas**

- `title` ← `statusText` (ou texto-padrão do status) e `detail` ← `message`; a RFC permite `title` genérico e `detail` específico da ocorrência.
- Membros de extensão são permitidos pela RFC 9457 (§3.2), então manter `data`/`body` no nível superior é compatível.
- `instance` e `type` são passados como strings pelo chamador; o h3 não os valida nem resolve URIs relativas.

**Riscos**

- **Campos legados no corpo:** `HTTPError.toJSON()` emite `statusText`, `message` e `unhandled`; mantê-los junto de `title`/`detail` polui o payload, mas removê-los exige tratar o corpo de forma diferente do erro padrão. Decisão de projeto a validar na implementação (preferência: emitir só membros da RFC + extensões).
- **Armazenamento de `type`/`instance` no `HTTPError`:** como a classe não tem esses campos, a opção é usá-los via `body`; risco de colisão se o usuário também passar `body.type`. Definir precedência (o campo explícito de `problem()` vence).
- **Precedência de `content-type`:** o merge de cabeçalhos em `errorResponse` precisa permitir que o `application/problem+json` substitua o JSON padrão e, ao mesmo tempo, respeitar um valor explícito do usuário.
- **Testes existentes** que comparam o corpo exato de erros podem ser sensíveis a qualquer mudança no serializador; mitigar mantendo o caminho padrão intocado (RF-07).
- **Segurança:** `detail` vem de `message`; autores devem evitar colocar dados sensíveis nele (RF-06 cobre apenas o caso `unhandled`).
