# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A.

## Problema e objetivo

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data`, `stack`) e `Content-Type: application/json`. Clientes e gateways que esperam o formato padronizado "problem details" da RFC 9457 não conseguem consumir essas respostas de forma uniforme.

**Objetivo:** permitir que a aplicação responda erros no formato `application/problem+json` da RFC 9457 (representação JSON), ligado por uma opção booleana `problemDetails` em `H3Config`. A opção é desligada por padrão; sem ela, o comportamento atual permanece idêntico. `HTTPError` passa a aceitar os campos opcionais `type` e `instance`.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Nova opção booleana `problemDetails` em `H3Config`, lida de `app.config` como as demais opções (por exemplo `debug`). Valor padrão: desligada. É o único gatilho do formato.

**Critério de aceite**

- **Dado** uma aplicação H3 criada sem `problemDetails` (ou com `problemDetails: false`),
- **Quando** um handler lança `HTTPError` (por exemplo, status 404),
- **Então** a resposta mantém exatamente o formato atual (`Content-Type: application/json`, corpo com `status`, `statusText`, `message`, `data`), sem mudança nenhuma.

### RF-02 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`/`ErrorBody`) aceita `type` e `instance` opcionais (strings, URIs/referências da RFC 9457). Ambos ficam expostos como propriedades somente leitura na instância (`undefined` quando não informados). Não é criado nenhum outro nome público.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, type: "https://exemplo.com/erros/validacao", instance: "/pedidos/42" })`,
- **Quando** se lêem `error.type` e `error.instance`,
- **Então** retornam, respectivamente, `"https://exemplo.com/erros/validacao"` e `"/pedidos/42"`; e, sem informá-los, ambos são `undefined`.

### RF-03 — Resposta em `application/problem+json` quando ligado

Com `problemDetails: true`, erros (lançados ou retornados) são serializados como problem details: `Content-Type: application/problem+json`, status HTTP igual ao do erro e corpo JSON com os membros padrão da RFC 9457: `type` (padrão `"about:blank"` quando ausente), `title`, `status`, `detail` e `instance` (apenas se informado).

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe", type: "https://exemplo.com/erros/nao-encontrado", instance: "/usuarios/7" })`,
- **Quando** o cliente requisita essa rota,
- **Então** a resposta tem status 404, `Content-Type` começando com `application/problem+json` e corpo contendo `type: "https://exemplo.com/erros/nao-encontrado"`, `title: "Not Found"`, `status: 404`, `detail: "Usuário não existe"` e `instance: "/usuarios/7"`.

### RF-04 — Valores padrão para `type` e `title`

Sem `type`, o corpo usa `"about:blank"`. Sem `statusText` definido, `title` usa a frase de razão padrão do status HTTP (ex.: 404 → "Not Found"); `detail` é omitido quando não há mensagem além do padrão.

**Critério de aceite**

- **Dado** `problemDetails: true` e uma rota que lança `HTTPError.status(404)` sem `type`,
- **Quando** o cliente requisita a rota,
- **Então** o corpo tem `type: "about:blank"`, `status: 404` e `title` não vazio, e não contém `instance`.

### RF-05 — Extensões: `data` e `body`

Os membros de extensão atuais continuam disponíveis: propriedades de `body` entram no nível superior (extension members da RFC) e `data` entra sob a chave `data`. Membros padrão da RFC (`type`, `title`, `status`, `detail`, `instance`) não podem ser sobrescritos por `body`.

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro com `body: { codigo: "E42", status: 999 }` e `data: { campo: "nome" }`,
- **Quando** o erro é respondido,
- **Então** o corpo contém `codigo: "E42"` e `data: { campo: "nome" }`, e `status` continua igual ao status HTTP real do erro (não 999).

### RF-06 — Erros não tratados continuam protegidos

Erros `unhandled` (inesperados) não vazam mensagem, `data`, `body` nem stack fora do modo `debug`; no formato problem details, `detail` fica omitido ou genérico e `type` permanece `"about:blank"`.

**Critério de aceite**

- **Dado** `problemDetails: true`, `debug` desligado e um handler que lança `new Error("segredo interno")`,
- **Quando** o cliente requisita a rota,
- **Então** a resposta é 500 com `Content-Type: application/problem+json` e o corpo não contém o texto `"segredo interno"` nem `stack`.

### RF-07 — Cabeçalhos do erro e modo `debug`

Cabeçalhos definidos no erro (`headers`) e os acumulados na resposta continuam sendo mesclados, com `Content-Type` do problem details prevalecendo sobre o JSON padrão. Com `debug` ligado, `stack` continua sendo incluído no corpo.

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro com `headers: { "x-id": "1" }`,
- **Quando** o erro é respondido,
- **Então** a resposta contém `x-id: 1` e `Content-Type: application/problem+json`.

### RF-08 — Compatibilidade, testes e qualidade

Nenhuma quebra de API existente. Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam. Novos testes cobrem RF-01 a RF-07 usando `describeMatrix` (modos web e node). `pnpm lint` e `pnpm typecheck` passam, e a suíte existente continua passando.

**Critério de aceite**

- **Dado** a implementação concluída,
- **Quando** se executam `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`,
- **Então** todos terminam sem falhas e `toJSON()` de `HTTPError` sem `problemDetails` segue com o mesmo formato anterior.

## Fora de escopo

- Gatilho por negociação de conteúdo (`Accept: application/problem+json`) ou por cabeçalho; só a opção de configuração.
- Representação XML (`application/problem+xml`).
- Novos nomes públicos além de `problemDetails`, `HTTPError.type` e `HTTPError.instance`.
- Registro de tipos de problema, documentação hospedada dos URIs de `type` ou geração automática de `instance`.
- Mudanças em Nitro ou em outros pacotes; alteração dos formatos de resposta não-erro.
- Opção por rota ou por requisição (habilitação é global da aplicação).

## Premissas e riscos

**Premissas**

- `problemDetails` é lida em tempo de resposta de `app.config`, como `debug`, e vale para toda a aplicação.
- `statusText` mapeia para `title` e `message` para `detail`; se `statusText` é vazio, usa-se a frase padrão do status.
- `type` e `instance` são strings repassadas sem validação de URI (a RFC permite referências relativas).
- A mudança fica concentrada em `src/error.ts`, `src/response.ts` e `src/types/h3.ts`.

**Riscos**

- **Colisão de nomes:** `ErrorBody` ganha `type`/`instance`; erros construídos via `cause` ou com `body` contendo essas chaves podem se comportar de forma inesperada. Mitigação: RF-05 define precedência dos membros padrão.
- **Vazamento de informação:** `detail` pode expor mensagens internas; mitigado por RF-06.
- **Testes existentes** que fixam o formato JSON atual do erro (incluindo `toJSON`) podem quebrar se `toJSON` for alterado; preferir manter `toJSON` intacto no modo desligado.
- **Cabeçalho `Content-Type`:** consumidores que checam `application/json` exato falham quando a opção é ligada (esperado, por ser opt-in).
- **Frase de razão padrão:** runtimes diferem no suporte a `statusText` padrão; pode ser necessária uma tabela interna mínima, sem exportá-la.
