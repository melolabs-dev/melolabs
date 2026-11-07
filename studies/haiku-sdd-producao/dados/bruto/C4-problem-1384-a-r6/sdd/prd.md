# PRD — Problem details (RFC 9457) como opção de configuração

Base: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros HTTP em um formato próprio. APIs que seguem a RFC 9457 (Problem Details for HTTP APIs) precisam de um corpo de erro padronizado, com `type`, `title`, `status`, `detail` e `instance`, e o h3 não oferece isso. A issue #1384 pede esse suporte, principalmente para uso com h3/nitro.

### Objetivo

Permitir que a aplicação responda erros no formato "problem details" (`application/problem+json`), ativado por uma opção booleana `problemDetails` em `H3Config`. A opção fica desligada por padrão. Com ela desligada, o comportamento atual não muda.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A opção booleana `problemDetails` existe em `H3Config`, tem valor padrão `false` e é lida de `app.config` como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada com `new H3({ problemDetails: true })`,
- **Quando** o valor de `app.config.problemDetails` é lido,
- **Então** o valor é `true`.

- **Dado** uma aplicação criada sem a opção `problemDetails`,
- **Quando** o valor de `app.config.problemDetails` é lido,
- **Então** o valor é `false`.

### RF-02 — Erro `HTTPError` respondido como problem details

Com `problemDetails` ligada, um `HTTPError` lançado por um handler é respondido com o status do erro, `Content-Type: application/problem+json` e um corpo JSON com os campos `type`, `title`, `status` e `detail`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`,
- **Quando** a rota recebe um `GET`,
- **Então** a resposta tem status `404`, `Content-Type` `application/problem+json`, e o corpo JSON tem `status: 404`, `title: "Not Found"` e `detail: "Usuário não encontrado"`.

### RF-03 — Campos `type` e `instance` em `HTTPError`

`HTTPError` aceita os campos opcionais `type` e `instance` no objeto de entrada do construtor e os expõe na instância. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" })`,
- **Quando** `error.type` e `error.instance` são lidos,
- **Então** retornam `"https://exemplo.com/erros/sem-saldo"` e `"/pagamentos/42"`.

- **Dado** um `HTTPError` criado sem `type` nem `instance`,
- **Quando** `error.type` e `error.instance` são lidos,
- **Então** ambos valem `undefined`.

### RF-04 — `type` e `instance` no corpo do problem details

Com `problemDetails` ligada, os valores de `type` e `instance` do `HTTPError` aparecem no corpo da resposta. Sem `type`, o corpo usa `"about:blank"`, conforme a RFC 9457 (seção 4.2.1).

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `HTTPError` com `type` e `instance` definidos,
- **Quando** a rota recebe um `GET`,
- **Então** o corpo JSON tem `type` e `instance` com esses mesmos valores.

- **Dado** uma aplicação com `problemDetails: true` e um `HTTPError` sem `type`,
- **Quando** a rota recebe um `GET`,
- **Então** o corpo JSON tem `type: "about:blank"`.

### RF-05 — Erro não `HTTPError` com problem details ligado

Com `problemDetails` ligada, um erro comum (não `HTTPError`) lançado por um handler é respondido como status `500` em `application/problem+json`. A mensagem original do erro não aparece no corpo.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new Error("falha interna do banco")`,
- **Quando** a rota recebe um `GET`,
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, e o corpo não contém o texto `"falha interna do banco"`.

### RF-06 — Comportamento inalterado com a opção desligada

Sem `problemDetails` (ou com `problemDetails: false`), a resposta de erro mantém o formato atual, sem `Content-Type: application/problem+json`. Os testes existentes continuam passando.

**Critério de aceite**

- **Dado** uma aplicação sem a opção `problemDetails`, com uma rota que lança `HTTPError` com `type` e `instance` definidos,
- **Quando** a rota recebe um `GET`,
- **Então** a resposta não tem `Content-Type` `application/problem+json`, o corpo não segue o formato de problem details, e a suíte existente passa sem alteração de asserções que verificam o comportamento atual.

## Fora de escopo

- Formato XML ou qualquer outra representação além de `application/problem+json`.
- Negociação de conteúdo pelo cabeçalho `Accept` para escolher o formato de erro. A escolha depende só da opção de configuração.
- Mapear `HTTPError.data` para campos de extensão do problem details.
- Opção por rota ou por handler. O gatilho é só a opção global em `H3Config`.
- Suporte a `problemDetails` no h3/nitro. A integração fica para outro trabalho.
- Parsing ou validação de problem details no lado cliente.
- Novos utilitários públicos além dos campos `type` e `instance` de `HTTPError` e da opção `problemDetails`.
- Mudança do formato de erro padrão quando a opção está desligada.

## Premissas e riscos

### Premissas

- `title` vem do texto padrão do status HTTP (por exemplo, `"Not Found"` para 404).
- `detail` vem da mensagem do `HTTPError`.
- `status` vem do status do `HTTPError`.
- Sem `type`, o valor padrão é `"about:blank"` (RFC 9457, seção 4.2.1).
- A opção `problemDetails` é lida de `app.config`, como as demais opções de `H3Config`.
- A verificação dos critérios segue a convenção do projeto: testes com `describeMatrix`, para os modos `web` e `node`.

### Restrições

- Nenhum outro nome público novo.
- Não quebrar o que já existe.
- Ajustar testes existentes só quando o que eles verificam mudar de forma intencional, sem remover a verificação.
- `pnpm lint` e `pnpm typecheck` passam.

### Riscos

- **Vazamento de informação em erros 500.** Com a opção ligada, a mensagem de erros comuns não pode chegar ao cliente (RF-05). Isso precisa de teste explícito.
- **Conflito de nomes.** Antes de adicionar `type` e `instance` a `HTTPError`, é preciso verificar se já existe propriedade com esses nomes na classe ou em seus usos internos.
- **Clientes que esperam o formato atual.** Ligar a opção muda o corpo e o `Content-Type` dos erros. Isso só afeta quem liga a opção, mas deve ficar documentado.
- **Enfraquecimento de testes existentes.** Ajustar testes antigos pode esconder regressões. Cada ajuste deve manter a verificação original.
- **Tratamento de erros sem `onError`.** Hooks de erro existentes podem interagir com a nova resposta. Precisa de checagem durante a implementação.
