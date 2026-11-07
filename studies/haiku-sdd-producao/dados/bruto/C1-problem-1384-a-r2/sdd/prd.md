# PRD: Problem details (RFC 9457) por opção de configuração

Base: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

Hoje o h3 responde erros sempre no mesmo formato JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data`, `body` e, em debug, `stack`). Clientes que esperam o formato "problem details" da RFC 9457 não têm como receber erros nesse formato sem escrever tratamento manual.

**Objetivo:** permitir que a aplicação escolha, por uma opção de configuração, que os erros sejam respondidos no formato RFC 9457 (JSON, `application/problem+json`). Sem a opção ligada, nada muda: a resposta de erro atual permanece idêntica.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Adicionar a opção booleana `problemDetails` a `H3Config`, desligada por padrão. Ela é lida de `app.config` como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails` na configuração,
- **Quando** ela responde a um erro,
- **Então** o `Content-Type` e o corpo são os mesmos de hoje (JSON próprio do h3, sem `application/problem+json`).

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`,
- **Quando** ela responde a um erro,
- **Então** a resposta usa o formato do RF-02.

### RF-02 — Corpo de erro em formato problem details

Com `problemDetails` ligado, toda resposta de erro gerada pelo h3 (`HTTPError`, erro não tratado convertido em 500, 404 de rota não encontrada) tem:

- `Content-Type: application/problem+json`;
- `type`: o valor de `HTTPError.type`, ou `about:blank` quando não informado (default da RFC 9457);
- `title`: o `statusText` do erro, quando existir;
- `status`: o código HTTP da resposta;
- `detail`: a mensagem do erro (`message`), quando existir;
- `instance`: o valor de `HTTPError.instance`, quando informado.

Os campos `data` e `body` do erro continuam sendo incluídos no nível superior do JSON, como hoje, como membros de extensão permitidos pela RFC.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json`, e o corpo JSON contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não encontrado"`.

- **Dado** uma aplicação com `problemDetails: true`,
- **Quando** é requisitada uma rota inexistente,
- **Então** a resposta é 404 com `Content-Type` `application/problem+json` e `detail` descrevendo a rota não encontrada.

### RF-03 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorDetails` / `ErrorInput`) aceita os campos opcionais `type` e `instance`, expostos como propriedades somente leitura da instância. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` é `"https://exemplo.com/erros/conflito"` e `error.instance` é `"/pedidos/42"`.

- **Dado** um `HTTPError` criado sem `type` e `instance`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` e `error.instance` são `undefined`, e o comportamento de `status`, `statusText`, `message`, `data` e `body` não muda.

### RF-04 — Erros não tratados não vazam detalhes

Com `problemDetails` ligado, um erro marcado como `unhandled` mantém a regra atual: `detail` é substituído por `"HTTPError"` (ou omitido), `data` e `body` não são enviados, e `stack` só aparece com `debug: true`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new Error("segredo do banco")`,
- **Quando** a rota é requisitada sem `debug`,
- **Então** a resposta é 500 com `Content-Type` `application/problem+json`, e o corpo não contém `"segredo do banco"` nem `stack`.

- **Dado** a mesma aplicação com `debug: true`,
- **Quando** a rota é requisitada,
- **Então** o corpo contém `stack` como lista de linhas, como já ocorre no formato atual.

### RF-05 — Headers de erro preservados

Os headers definidos em `HTTPError.headers` e em `event.res` para erros (`errHeaders`) continuam sendo aplicados à resposta, nos dois modos.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um `HTTPError` criado com `headers: { "WWW-Authenticate": "Bearer" }`,
- **Quando** a rota é requisitada,
- **Então** a resposta contém o header `WWW-Authenticate: Bearer` e `Content-Type` `application/problem+json`.

### RF-06 — Compatibilidade com a suíte e a API existente

Nenhuma API pública existente é removida ou renomeada. Testes existentes só são ajustados quando dependem diretamente do que esta mudança altera (por exemplo, asserções de `Content-Type` em erros de aplicações com a opção ligada). A suíte continua verificando o que verificava.

**Critério de aceite**

- **Dado** o repositório após a mudança,
- **Quando** `pnpm vitest run` e `pnpm lint` (incluindo typecheck) são executados,
- **Então** ambos passam, e nenhum teste existente foi removido sem substituto equivalente.

## Fora de escopo

- Negociação de conteúdo por `Accept` (escolher o formato por requisição). A escolha é global, pela opção de configuração.
- Opção por rota ou por handler. Só existe a opção global de `H3Config`.
- Mapeamento de erros de validação (listas de problemas por campo, extensões tipo `errors`). Esses erros seguem o formato de `data` como hoje.
- Registro ou documentação de URIs de `type` específicas da aplicação.
- Formato `application/problem+xml` ou outras variantes da RFC 9457.
- Integração com Nitro ou com outros frameworks; mudanças em `h3/rules`, `h3/tracing` ou nas integrações de runtime além do que for necessário para ler a opção.
- Mudar o padrão do formato atual de erro para problem details.

## Premissas

- A RFC 9457 é a referência normativa: `type` default `about:blank`, `title` derivado de `statusText`, `detail` derivado de `message`.
- O formato atual de erro (`status`, `statusText`, `unhandled`, `message`, `data`, `body`, `stack`) é o ponto de partida; a mudança com a opção ligada reaproveita `HTTPError.toJSON()` e a lógica de `unhandled`, sem duplicar regras.
- `app.config` é congelado na inicialização (`src/_entries/_common.ts`), então a leitura de `problemDetails` em tempo de resposta é segura.
- Decisão a confirmar: `statusText` vazio gera `title` ausente (a RFC permite omitir, mas o padrão de `title` é recomendado).
- Decisão a confirmar: `unhandled` não aparece no formato problem details, pois não faz parte da RFC; o efeito dele fica em `detail` e nos campos ocultos.

## Riscos

- **Chamadas de `toResponse` sem `config`.** Alguns pontos internos chamam `toResponse(value, event)` sem passar a configuração (ex.: `src/handler.ts`, `src/utils/middleware.ts`, `src/utils/cache.ts` na documentação). Se o erro for renderizado nesses caminhos, a opção pode ser ignorada silenciosamente. Mitigação: auditar todos os chamadores e cobrir com teste de matriz (`describeMatrix`) nos caminhos de erro.
- **Clientes que checam `application/json`.** Aplicações com a opção ligada podem quebrar clientes que comparam o `Content-Type` exato. Mitigação: documentar a mudança; a opção é desligada por padrão.
- **Conflito de nomes de campos.** `data` e `body` podem colidir com membros da RFC (`type`, `title`, `status`, `detail`, `instance`) se a aplicação os usar em `body`. Mitigação: definir a precedência (campos da RFC vencem) e cobrir em teste.
- **Vazamento em erros não tratados.** Qualquer caminho novo de serialização pode expor `message` ou `stack`. Mitigação: testes de RF-04 em ambos os modos (com e sem `debug`).
- **Tipos públicos.** Adicionar `type` e `instance` a `ErrorBody` altera a forma pública de `ErrorBody`/`ErrorInput`. Mudança aditiva, mas deve ser checada em `test/unit/types.test-d.ts`.
- **Código de erro preso em `event.res`.** O fluxo atual limpa `kEventRes` antes de renderizar o erro; a nova renderização não pode reintroduzir headers duplicados (ver comentário em `src/response.ts`, em torno da linha 167).
