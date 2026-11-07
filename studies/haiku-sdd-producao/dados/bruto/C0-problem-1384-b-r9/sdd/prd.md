# PRD — Problem Details (RFC 9457) como formato padrão de erro no h3

Origem: issue h3js/h3#1384, variante "Contrato enxuto #1384-B" (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros como JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled`, mais as chaves de `body`), com `content-type: application/json`. Esse formato não segue nenhum padrão. Clientes, gateways e ferramentas de observabilidade que entendem a RFC 9457 (Problem Details for HTTP APIs) não conseguem interpretá-lo de forma genérica.

### Objetivo
Passar a responder **todos** os erros no formato de problem details da RFC 9457 (representação JSON, `application/problem+json`). O formato é o padrão, sem opção de configuração nem gatilho. `HTTPError` passa a aceitar os campos opcionais `type` e `instance`, expostos na instância.

### Métricas de sucesso
- Toda resposta de erro gerada pelo h3 tem `content-type: application/problem+json` e um corpo válido segundo a RFC 9457.
- A suíte existente, `pnpm lint` e `pnpm typecheck` passam. Só mudam os testes que dependem do formato de erro, e eles continuam verificando o mesmo comportamento.
- Nenhum nome público novo além de `type` e `instance` em `HTTPError`.

## 2. Requisitos funcionais

### RF-01 — Content-Type `application/problem+json`
Toda resposta de erro gerada a partir de um `HTTPError`, lançado ou convertido, usa o content-type de problem details. Isso inclui erros não tratados (`unhandled`).

**Critério de aceite**
- **Dado** uma rota que lança `new HTTPError({ status: 400 })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 400 e o header `content-type` é `application/problem+json` (com ou sem `;charset=UTF-8`).

### RF-02 — Membros padrão no corpo
O corpo de erro contém os membros da RFC 9457:
- `type`: URI de referência. Vale `"about:blank"` quando o erro não define `type`.
- `title`: resumo curto. Usa `statusText` quando existe; senão, a frase padrão do status HTTP.
- `status`: código HTTP, igual ao da resposta.
- `detail`: explicação específica da ocorrência. Vem de `message`.

**Critério de aceite**
- **Dado** uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário 42 não existe" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo JSON contém `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário 42 não existe"`.

### RF-03 — Campos `type` e `instance` em `HTTPError`
O objeto de entrada do construtor aceita `type` e `instance` (strings, opcionais). Ambos ficam expostos como propriedades `readonly` da instância (`error.type`, `error.instance`), tanto na forma `new HTTPError(details)` quanto em `new HTTPError(message, details)` e em `HTTPError.status(...)`. Os tipos de `ErrorInput` e `ErrorBody` são atualizados para refletir isso.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 409, type: "https://example.com/probs/conflito", instance: "/pedidos/7" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** os valores são `"https://example.com/probs/conflito"` e `"/pedidos/7"`; sem esses campos na entrada, ambos são `undefined`.

### RF-04 — `type` e `instance` na resposta
Quando definidos, `type` e `instance` aparecem no corpo no lugar do padrão. `type` ausente vira `"about:blank"` (RF-02). `instance` ausente é omitido do corpo.

**Critério de aceite**
- **Dado** uma rota que lança `HTTPError` com `type: "https://example.com/probs/conflito"` e `instance: "/pedidos/7"`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém exatamente esses valores em `type` e `instance`; **e dado** um erro sem `instance`, o corpo não tem a chave `instance`.

### RF-05 — Membros de extensão
As propriedades de `body` continuam sendo anexadas no nível superior do corpo, como extensões da RFC 9457. `data` continua sendo exposto sob a chave `data`. Extensões não podem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**
- **Dado** um erro com `body: { code: "E_PAGAMENTO", status: 999 }` e `data: { campo: "x" }`
- **Quando** o cliente faz a requisição
- **Então** o corpo tem `code: "E_PAGAMENTO"` e `data: { campo: "x" }`, e `status` é o status HTTP real do erro, não 999.

### RF-06 — Compatibilidade dos campos atuais
Os campos do formato anterior (`statusText`, `message`, `unhandled`) continuam presentes no corpo, junto com os de problem details, para não quebrar consumidores existentes. `HTTPError#toJSON()` continua retornando as chaves que retornava e ganha as novas.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 400, statusText: "Bad Request", message: "inválido" })`
- **Quando** o cliente faz a requisição
- **Então** o corpo contém `status: 400`, `statusText: "Bad Request"` e `message: "inválido"`, além de `type`, `title` e `detail`.

### RF-07 — Erros não tratados não vazam detalhes
Para erros `unhandled`, `detail`, `data` e `body` não são expostos, como já ocorre com `message`, `data` e `body` hoje. `detail` é omitido ou fica genérico (`"HTTPError"`), de forma consistente com `message`. O `stack` só aparece em modo debug, como hoje.

**Critério de aceite**
- **Dado** uma rota que lança `new Error("segredo interno")`, com `debug` desligado
- **Quando** o cliente faz a requisição
- **Então** o status é 500, o content-type é `application/problem+json` e o corpo não contém o texto "segredo interno", nem `stack`.

### RF-08 — Headers e demais comportamentos preservados
`error.headers`, `statusText` na linha de status, o tratamento de `HEAD` e de respostas sem corpo (204, 304 etc.) e o status das respostas não mudam. O `content-type` de erro substitui o `application/json` antigo, mas headers de erro definidos pelo usuário continuam tendo precedência, como hoje.

**Critério de aceite**
- **Dado** um erro com `headers: { "x-custom": "1" }`
- **Quando** o cliente faz a requisição
- **Então** a resposta traz `x-custom: 1`, o status e o `statusText` do erro, e o content-type de problem details.

### RF-09 — Cobertura de testes
Os testes novos usam `describeMatrix` (web e node) e cobrem RF-01 a RF-08. Os testes existentes que fixam o formato antigo (content-type `application/json`, corpo exato de erro) são ajustados sem perder o que verificam. Há teste de tipos para `type` e `instance`.

**Critério de aceite**
- **Dado** a suíte completa
- **Quando** se executa `pnpm test`
- **Então** tudo passa, incluindo lint e typecheck, e há ao menos um teste novo por requisito, nos modos web e node.

## 3. Fora de escopo
- Qualquer opção de configuração, flag ou gatilho para ligar/desligar o formato (a variante exige formato padrão).
- Qualquer outro nome público novo além de `type` e `instance` em `HTTPError`.
- Representação XML da RFC 9457 e negociação de conteúdo (`Accept`).
- Registro, geração ou publicação de URIs de `type` e de documentação de problemas.
- Mudanças em `nitro` ou em outros projetos consumidores.
- Mudanças em handlers de erro customizados do usuário (`onError`), além do que decorre do novo formato padrão.

## 4. Premissas e riscos

### Premissas
- O ponto único de serialização de erro é `errorResponse` em `src/response.ts`, apoiado em `HTTPError#toJSON()` (`src/error.ts`).
- `message` corresponde a `detail` e `statusText` corresponde a `title`.
- `type` e `instance` são strings; a validação de que são URIs válidas não é exigida.

### Riscos
- **Tensão no próprio pedido.** O contrato diz que o formato "substitui o formato de erro atual" e também "não quebrar o que já existe". Interpretação adotada: trocar o content-type e adicionar os membros da RFC, mantendo `statusText`, `message`, `unhandled`, `data` e as chaves de `body` (RF-06). Consequência: o corpo é um superconjunto da RFC, com campos redundantes (`message` e `detail`, `statusText` e `title`). Se a decisão for remover os campos antigos, é uma quebra de compatibilidade e precisa de confirmação do solicitante.
- **Quebra por content-type.** Clientes que checam `content-type === "application/json"` exato deixam de reconhecer erros, e esse risco é inerente ao requisito. Mitigação: documentar a mudança.
- **Testes existentes.** Testes que comparam o corpo exato (`toEqual`/snapshots) ou o content-type vão falhar e precisam de ajuste. Deve-se ajustar só o que depende da mudança.
- **Colisão de extensões.** `body` com chaves como `type`, `title` ou `detail` pode conflitar com os membros padrão. O RF-05 define que os padrão prevalecem; é uma mudança sutil para quem já usava essas chaves em `body`.
- **`title` sem `statusText`.** A frase padrão do status exige uma tabela interna pequena (sem API pública). Se não for desejada, `title` pode ficar omitido quando não há `statusText`, o que a RFC permite.
- **Vazamento em erros não tratados.** Os novos campos (`detail`, `instance`) não podem expor informação que hoje fica oculta (RF-07).
- **Tamanho e portabilidade.** O h3 é minimalista e multi-runtime. A implementação deve usar só APIs web padrão e adicionar pouco código.
