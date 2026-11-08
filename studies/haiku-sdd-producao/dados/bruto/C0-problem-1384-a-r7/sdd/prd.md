# PRD — Problem Details (RFC 9457) por opção de configuração

Referência: issue h3js/h3#1384, contrato enxuto #1384-A (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `unhandled`, `message`, `data`, `stack` em debug), montado em `errorResponse` (`src/response.ts`) a partir de `HTTPError.toJSON()` (`src/error.ts`). Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs). Clientes e ferramentas que esperam `application/problem+json` não conseguem interpretar os erros do h3 de forma padronizada.

### Objetivo

Permitir que uma aplicação h3 responda erros no formato "problem details" da RFC 9457 (representação JSON), ligado por uma opção booleana `problemDetails` em `H3Config`, **desligada por padrão**. Sem a opção, o comportamento atual permanece idêntico. Além disso, `HTTPError` passa a aceitar os campos opcionais `type` e `instance` da RFC.

### Métricas de sucesso

- Com `problemDetails: true`, toda resposta de erro gerada pelo h3 é um problem details válido (`Content-Type: application/problem+json`).
- Sem a opção, as respostas de erro são byte a byte as mesmas de hoje.
- `pnpm lint`, `pnpm typecheck` e a suíte de testes passam.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Adicionar a opção booleana `problemDetails` em `H3Config` (`src/types/h3.ts`), lida de `app.config` como as demais opções (por exemplo `debug`, `onError`). O padrão é `false`/ausente.

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails`
- **Quando** um handler lança `HTTPError.status(404)`
- **Então** a resposta é idêntica à atual: `Content-Type: application/json` e corpo com `status`, `statusText`, `message` etc., sem os campos `title`/`type`.

### RF-02 — Corpo no formato RFC 9457 quando habilitado

Com `problemDetails: true`, o corpo de erro contém os membros padrão: `type` (padrão `"about:blank"`), `title`, `status`, `detail` e, se informado, `instance`. `title` vem de `statusText` quando houver; senão, da frase padrão do status HTTP; `detail` vem de `message`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `new HTTPError({ status: 403, statusText: "Forbidden", message: "Sem permissão" })`
- **Então** a resposta tem status 403 e corpo JSON com `type: "about:blank"`, `title: "Forbidden"`, `status: 403` e `detail: "Sem permissão"`.

### RF-03 — Content-Type `application/problem+json`

Com `problemDetails: true`, a resposta de erro usa `Content-Type: application/problem+json` (preservando o charset hoje usado em `jsonHeaders`). Cabeçalhos definidos pelo erro (`error.headers`) e por `event.res` continuam sendo mesclados como hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um erro com `headers: { "x-custom": "1" }`
- **Quando** o erro é lançado em uma rota
- **Então** a resposta tem `Content-Type` começando com `application/problem+json` e mantém o cabeçalho `x-custom: 1`.

### RF-04 — Campos `type` e `instance` em `HTTPError`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`/`ErrorBody`) aceita `type?: string` e `instance?: string`, expostos como propriedades `readonly` da instância (`undefined` quando ausentes). Não são criados outros nomes públicos. Os campos podem ser lidos também de `cause`, como `status` e `headers`, para manter consistência com o construtor atual.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, type: "https://example.com/probs/invalido", instance: "/pedidos/42" })`
- **Quando** se leem `error.type` e `error.instance`
- **Então** retornam, respectivamente, `"https://example.com/probs/invalido"` e `"/pedidos/42"`; e para um `HTTPError` criado sem esses campos ambos são `undefined`.

### RF-05 — `type` e `instance` no corpo problem details

Com `problemDetails: true`, `type` e `instance` informados no erro aparecem no corpo; `type` ausente resulta em `"about:blank"` e `instance` ausente é omitido.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `new HTTPError({ status: 422, type: "https://example.com/probs/validacao", instance: "/pedidos/42" })`
- **Então** o corpo contém `type: "https://example.com/probs/validacao"` e `instance: "/pedidos/42"`; e, para um erro sem esses campos, o corpo tem `type: "about:blank"` e não tem a chave `instance`.

### RF-06 — Extensões: `data` e `body` preservados

Membros de extensão são permitidos pela RFC 9457. Com `problemDetails: true`, as propriedades de `error.body` continuam no nível raiz e `error.data` continua sob a chave `data`, sem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**

- **Dado** `problemDetails: true` e um erro com `data: { campo: "email" }` e `body: { code: "E_VAL" }`
- **Quando** o erro é respondido
- **Então** o corpo contém `data: { campo: "email" }` e `code: "E_VAL"`, além dos membros padrão.

### RF-07 — Erros não tratados continuam protegidos

Com `problemDetails: true`, erros `unhandled` não vazam `message`, `data`, `body` nem stack fora do modo debug: `detail` não expõe a mensagem original (usa o mesmo mascaramento de `toJSON()`), e `title` é a frase padrão do status 500.

**Critério de aceite**

- **Dado** `problemDetails: true`, `debug` desligado e um handler que lança `new Error("segredo interno")`
- **Quando** a resposta é gerada
- **Então** o status é 500, o `Content-Type` é `application/problem+json` e o corpo não contém o texto `segredo interno` nem `stack`.

### RF-08 — Modo debug e 404 de rota inexistente

Com `problemDetails: true`, o campo `stack` continua sendo incluído apenas quando `debug` está ativo. Erros gerados pelo próprio framework (por exemplo rota não encontrada) também saem no formato problem details.

**Critério de aceite**

- **Dado** `problemDetails: true` e `debug: true`
- **Quando** é feita uma requisição a uma rota inexistente
- **Então** a resposta é 404 com `Content-Type: application/problem+json`, `title: "Not Found"` e um campo `stack`; e com `debug` desligado o campo `stack` não existe.

### RF-09 — Compatibilidade e `onError`

`onError` (config ou middleware) continua sendo chamado antes da renderização e seu valor de retorno continua tendo precedência, como hoje. Nenhum comportamento existente muda com a opção desligada; testes existentes só são ajustados se dependerem de algo que a mudança altera (por exemplo o formato do `toJSON()`), sem perder o que verificam.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `onError` que retorna uma `Response` própria
- **Quando** um handler lança um erro
- **Então** a resposta retornada por `onError` é a enviada ao cliente, e a suíte existente (`pnpm test`) continua passando.

### RF-10 — Testes e documentação

Cobrir RF-01 a RF-09 com testes via `describeMatrix` (modos `web` e `node`) e testes unitários para os novos campos de `HTTPError`. Documentar a opção e os campos novos na documentação do projeto onde `H3Config` e `HTTPError` já são descritos.

**Critério de aceite**

- **Dado** a mudança implementada
- **Quando** se executam `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam e há ao menos um teste por requisito acima.

## 3. Fora de escopo

- Qualquer nome público novo além de `problemDetails` (em `H3Config`) e dos campos `type`/`instance` em `HTTPError`; sem novos utilitários, helpers ou exports.
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Habilitar o formato por rota, por requisição ou por cabeçalho (esta variante usa só a config da aplicação).
- Registro/catálogo de URIs de `type` ou resolução de documentação desses URIs.
- Mudar o formato padrão (desligado) ou remover campos atuais do JSON legado.
- Mudanças em erros de WebSocket/JSON-RPC, que têm formato próprio.
- Integração específica com Nitro.

## 4. Premissas e riscos

### Premissas

- A config é lida de `app.config` na renderização do erro, como `debug` e `onError`, sem estado global.
- `title` usa `statusText` quando presente; senão, a frase padrão do status HTTP (tabela interna ou `Response`/runtime), e vazio é aceitável para status sem frase conhecida.
- `HTTPError.toJSON()` pode continuar no formato atual; a conversão para problem details ocorre na renderização (`errorResponse`), preservando consumidores existentes de `toJSON()`.
- Os campos `type`/`instance` não precisam de validação de URI além de serem strings.

### Riscos e mitigação

| Risco                                                                            | Impacto                             | Mitigação                                                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Mudar `toJSON()` quebraria testes e consumidores                                 | Regressão de compatibilidade        | Manter `toJSON()` legado e adaptar apenas em `errorResponse`; incluir `type`/`instance` só quando definidos |
| Vazamento de informação em erros `unhandled` no novo formato                     | Segurança                           | RF-07 com teste explícito; reutilizar o mascaramento de `toJSON()`                                          |
| Colisão entre `body` do usuário e membros padrão (`type`, `title`, `status`...)  | Corpo inconsistente                 | Membros padrão prevalecem sobre extensões (RF-06)                                                           |
| Conflito de nomes: `type` em `ErrorInput` com campos já usados por `body`/`data` | Ambiguidade                         | Documentar a precedência; testar `body: { type }` vs. `type` direto                                         |
| Frase padrão do status diferente entre runtimes                                  | Testes instáveis entre `web`/`node` | Usar tabela própria e determinística, não a do runtime                                                      |
| Limite de tamanho (<200 LoC/arquivo)                                             | Convenção do projeto                | Isolar a montagem do problem details em helper interno (não exportado)                                      |
