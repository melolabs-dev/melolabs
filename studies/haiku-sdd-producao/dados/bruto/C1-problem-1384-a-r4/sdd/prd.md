# PRD — Problem details (RFC 9457) por opção de configuração no h3

Origem: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

### Problema

O h3 responde erros HTTP sempre no formato próprio do `HTTPError` (JSON com `status`, `statusText`, `message`, `data` etc.). Não existe um formato padronizado de erro, e APIs que seguem a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs) precisam montar essa resposta à mão em cada projeto.

### Objetivo

Permitir que a aplicação escolha responder erros no formato "problem details" (RFC 9457, representação JSON), ligando uma opção de configuração. Com a opção desligada (padrão), nada muda para quem já usa o h3.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A opção booleana `problemDetails` existe em `H3Config`, vem desligada por padrão e é lida de `app.config`, como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem nenhuma configuração de `problemDetails`,
- **Quando** `app.config` é inspecionado,
- **Então** a opção `problemDetails` está ausente ou com valor falso, e o comportamento de erro é o atual.

### RF-02 — Sem a opção, respostas de erro não mudam

Com `problemDetails` desligado, as respostas de erro continuam exatamente como hoje: mesmo status, mesmo `Content-Type` e mesmo corpo JSON.

**Critério de aceite**

- **Dado** uma aplicação com a opção `problemDetails` desligada e uma rota que lança `HTTPError` com status 404,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 404, `Content-Type` `application/json` e o mesmo corpo JSON que a versão anterior do h3 produzia.

### RF-03 — Resposta de erro em `application/problem+json`

Com `problemDetails` ligado, um erro `HTTPError` é respondido com `Content-Type: application/problem+json` e um corpo JSON contendo os campos da RFC 9457: `type`, `title`, `status`, `detail` e `instance` (quando houver).

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails` ligado e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não encontrado" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json`, e o corpo JSON tem `status: 404`, `title: "Not Found"` e `detail: "Usuário não encontrado"`.

### RF-04 — `HTTPError` aceita e expõe `type` e `instance`

O construtor de `HTTPError` aceita os campos opcionais `type` e `instance` no objeto de entrada (`ErrorInput`) e os expõe como propriedades da instância.

**Critério de aceite**

- **Dado** um `HTTPError` criado com `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** as propriedades `type` e `instance` da instância são lidas,
- **Então** elas retornam `"https://exemplo.com/erros/sem-permissao"` e `"/pedidos/42"`, respectivamente.

### RF-05 — Valor padrão de `type`

Quando `type` não é informado, a resposta em formato problem details usa `"about:blank"`, valor definido pela RFC 9457 para erros sem tipo específico.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails` ligado e uma rota que lança `HTTPError` com status 500 e sem `type`,
- **Quando** a rota é requisitada,
- **Então** o corpo JSON tem `type: "about:blank"`.

### RF-06 — Erros que não são `HTTPError` também seguem o formato

Quando `problemDetails` está ligado, qualquer erro lançado por um handler e convertido pelo h3 (inclusive `Error` comum, convertido em 500) é respondido no formato problem details.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails` ligado e uma rota que lança `new Error("falha inesperada")`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 500 e `Content-Type` `application/problem+json`.

### RF-07 — Erros não tratados não vazam detalhes

A regra atual de ocultação de erros não tratados (`unhandled`) continua valendo no formato problem details: fora do modo `debug`, `detail` e stack trace não aparecem na resposta.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails` ligado, `debug` desligado e uma rota que lança um erro não tratado com a mensagem `"segredo interno"`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status 500 e o corpo JSON não contém `"segredo interno"` nem stack trace.

### RF-08 — Campos de extensão preservados

Os campos `data` e `body` do `HTTPError` continuam presentes no corpo problem details como membros de extensão, conforme permite a RFC 9457, para não perder informação que a aplicação já envia hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails` ligado e uma rota que lança `new HTTPError({ status: 422, message: "Inválido", data: { campo: "email" } })`,
- **Quando** a rota é requisitada,
- **Então** o corpo JSON contém `type`, `title`, `status`, `detail` e também `data: { campo: "email" }`.

### RF-09 — Testes e qualidade

A suíte existente continua passando. Testes existentes só são ajustados quando dependem do que esta mudança altera, sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a implementação concluída,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados e `pnpm vitest run` roda a suíte completa,
- **Então** os três terminam sem erro, e nenhum teste existente foi removido ou enfraquecido.

## Fora de escopo

- Negociação de conteúdo pelo cabeçalho `Accept` (escolher formato por requisição). A escolha é global, pela opção de configuração.
- Registro ou catálogo de tipos de problema (URIs de `type` controladas pelo h3).
- Integração específica com o Nitro ou com outros frameworks.
- Mudar o formato padrão do h3 ou ligar `problemDetails` por padrão.
- Novas opções públicas além de `problemDetails`, `type` e `instance`.
- Tradução ou localização de `title` e `detail`.
- Suporte a outros formatos de erro (ex.: XML, RFC 7807 com extensões próprias além de `data` e `body`).

## Premissas e riscos

### Premissas

- A opção fica em `H3Config` e é lida de `app.config`, como as demais, e não é alterada em tempo de execução.
- `title` vem de `statusText`. Quando `statusText` está ausente, o h3 usa o texto padrão do status HTTP, se já houver essa lógica; caso contrário, `title` é omitido ou derivado do status.
- `detail` vem de `message`.
- `data` e `body` são mantidos como membros de extensão (decisão tomada aqui para não quebrar informação existente; a confirmar).
- Não há nenhum outro nome público novo além dos já citados no contrato.

### Riscos

- **Quebra de clientes:** mudar `Content-Type` para `application/problem+json` pode afetar clientes que checam `application/json`. Mitigação: a opção é desligada por padrão e só muda o comportamento para quem a liga.
- **Interação com `onError` e com cabeçalhos de erro:** o hook `onError` pode alterar o erro antes da resposta; é preciso garantir que o formato problem details seja aplicado depois dele e que os cabeçalhos de erro (`headers` do `HTTPError`) continuem sendo enviados.
- **Interação com cache e event stream:** respostas de erro passadas por `withCacheIsolation`/`handleCacheHeaders` ou por SSE precisam manter o comportamento atual; deve-se testar esses casos.
- **Testes existentes:** testes que verificam o corpo JSON de erro com a opção desligada devem continuar passando sem alteração; se algum precisar de ajuste, o motivo deve ficar claro no diff.
- **Matriz de runtimes:** os testes precisam rodar em `web` e `node` (via `describeMatrix`), o que aumenta o custo de validação.
