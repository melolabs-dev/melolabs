# PRD — Problem details (RFC 9457) por opção de configuração

Referências: issue h3js/h3#1384 e contrato enxuto #1384-A (`sdd/pedido.md`).

## Problema e objetivo

Toda resposta de erro do H3 hoje sai no formato próprio: um JSON com `status`, `statusText`, `message`, `data`, os campos de `body` no nível raiz e, em modo debug, `stack`, com `Content-Type: application/json;charset=UTF-8`. Quem quer seguir a RFC 9457 (Problem Details for HTTP APIs) não tem como pedir esse formato, e `HTTPError` não aceita nem expõe os campos `type` e `instance` da RFC.

Objetivo: permitir que a aplicação ligue, por uma opção booleana, o formato problem details nas respostas de erro (`application/problem+json`), e que `HTTPError` aceite e exponha `type` e `instance`. Com a opção desligada, nada muda.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em H3Config

`H3Config` ganha `problemDetails?: boolean`, com padrão `false`. A opção é lida de `app.config` no momento de renderizar o erro, da mesma forma que `debug` e `silent`.

**Critério de aceite**

- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** uma rota lança um `HTTPError` com `status`, `statusText`, `message` e `data`
- **Então** a resposta usa `Content-Type: application/json;charset=UTF-8` e um corpo idêntico ao que é gerado hoje.

### RF-02 — Content-Type de problem details

Com a opção ligada, as respostas de erro usam `Content-Type: application/problem+json`. O código de status HTTP é o mesmo de `error.status`.

**Critério de aceite**

- **Dado** uma aplicação criada com `problemDetails: true`
- **Quando** uma rota lança `new HTTPError({ status: 404, message: "não encontrado" })`
- **Então** a resposta tem status `404`, `Content-Type` igual a `application/problem+json` e o corpo é JSON.

### RF-03 — Membros obrigatórios e mapeamento dos campos atuais

No modo problem details, o corpo contém `type`, `title`, `status` e `detail`:

- `type`: valor informado no erro (RF-04) ou `"about:blank"`.
- `title`: `statusText` do erro, quando definido; caso contrário, o membro é omitido.
- `status`: número do status do erro.
- `detail`: `message` do erro. A chave `message` não aparece neste modo.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** uma rota lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })`
- **Então** o corpo é `{"type":"about:blank","title":"Not Found","status":404,"detail":"Usuário não existe"}`.

### RF-04 — `type` e `instance` no construtor e na instância de HTTPError

`HTTPError` aceita, no objeto de entrada do construtor, os campos opcionais `type` e `instance`. Eles ficam expostos como propriedades `readonly` da instância, no mesmo estilo de `statusText`. Valores que não são string são tratados como ausentes.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/contas/42" })`
- **Quando** o código lê `err.type` e `err.instance`
- **Então** os valores retornados são `"https://exemplo.com/erros/sem-saldo"` e `"/contas/42"`.
- **E** quando os campos são omitidos, `err.type` e `err.instance` valem `undefined`.

### RF-05 — `type` e `instance` no corpo do problema

Com a opção ligada, `type` do erro aparece no corpo (ou `"about:blank"` quando ausente). `instance` aparece no corpo somente quando foi definido.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true`
- **Quando** uma rota lança `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/contas/42" })`
- **Então** o corpo contém `"type":"https://exemplo.com/erros/sem-saldo"` e `"instance":"/contas/42"`.
- **E** quando o erro não define `instance`, o corpo não contém a chave `instance`.

### RF-06 — Membros de extensão preservados

Com a opção ligada, `data` continua em `data` e os campos de `body` continuam no nível raiz. Em modo debug, `stack` continua no corpo, como hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug: false`
- **Quando** uma rota lança `new HTTPError({ status: 422, message: "inválido", data: { campo: "email" }, body: { codigo: 7 } })`
- **Então** o corpo contém `"data":{"campo":"email"}` e `"codigo":7` no nível raiz, e não contém `stack`.

### RF-07 — Erros não tratados não vazam detalhes

Um erro que não é `HTTPError` vira `status` 500 e é marcado como `unhandled`. Com a opção ligada, o corpo não expõe a mensagem original nem `data` e `body`, na mesma regra de `toJSON()` hoje.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `debug: false`
- **Quando** uma rota lança `new Error("senha do banco: 123")`
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, `type` `"about:blank"` e o corpo não contém `"senha do banco"`.

### RF-08 — Headers do erro continuam sendo aplicados

Os headers definidos em `HTTPError.headers` e os headers de erro staged em `event.res` continuam na resposta. O `Content-Type` de problem details tem precedência sobre um `content-type` vindo do erro.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `new HTTPError({ status: 401, headers: { "www-authenticate": "Bearer" } })`
- **Quando** a rota lança esse erro
- **Então** a resposta contém `www-authenticate: Bearer` e `Content-Type: application/problem+json`.

### RF-09 — Interação com `onError`

O hook `onError` continua sendo executado antes da renderização. Se ele devolver um `HTTPError`, a resposta final usa o formato problem details. Se devolver outro tipo de valor, esse valor segue as regras atuais de serialização, sem conversão.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um `onError` que retorna `new HTTPError({ status: 503, message: "indisponível" })`
- **Quando** ocorre um erro em uma rota
- **Então** a resposta tem status `503`, `Content-Type` `application/problem+json` e `detail` `"indisponível"`.
- **E** quando `onError` retorna um objeto simples como `{ ok: false }`, a resposta é `application/json` com esse objeto serializado.

### RF-10 — Compatibilidade e qualidade

A suíte existente continua passando. Testes existentes só são ajustados quando dependem diretamente do que muda, e sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** o repositório após a mudança
- **Quando** `pnpm test` (ou `pnpm lint` e a checagem de tipos) é executado
- **Então** todos os testes e verificações passam, e os novos testes cobrem RF-01 a RF-09 nos dois modos (web e node) via `describeMatrix`.

## Fora de escopo

- Integração com `h3/nitro` (citada na issue, mas não faz parte deste contrato).
- Preenchimento automático de `instance` com a URL da requisição.
- Catálogo ou registro de valores de `type`, e documentação de URIs de tipo.
- Formato `application/problem+xml`.
- Conversão de retornos arbitrários de `onError` (objetos simples) em problem details.
- Validação de formato de URI em `type` e `instance`.
- Helpers de cliente para ler problem details.
- Novos nomes públicos além de `problemDetails`, `type` e `instance`.

## Premissas e riscos

### Premissas

- **P1.** `message` é mapeado para `detail` e `statusText` para `title`, como a RFC pede. Os nomes da chave `message` e `statusText` continuam como estão no modo padrão.
- **P2.** `type` tem padrão `"about:blank"`, conforme a RFC 9457.
- **P3.** `type` e `instance` **não** herdam valores de `cause`, diferente de `status` e `statusText`. A recomendação é manter o escopo mínimo; a decisão deve ser confirmada.
- **P4.** `toJSON()` de `HTTPError` não muda. O formato problem details é montado na renderização da resposta de erro.
- **P5.** `application/problem+json` é enviado sem `charset`.
- **P6.** Os membros da RFC (`type`, `title`, `status`, `detail`, `instance`) têm precedência sobre chaves homônimas vindas de `body`.

### Riscos

- **R1.** Clientes que leem `message` deixam de funcionar quando a opção é ligada. Por isso a opção é desligada por padrão.
- **R2.** `title` fica ausente quando o erro não tem `statusText`, como nas exceções não tratadas com status 500. Isso contraria o "SHOULD" da RFC. Mitigação: decidir se o título usa o texto padrão do status.
- **R3.** Colisão entre chaves de `body` e membros da RFC (P6). Sem a precedência definida, um `body` com `status` ou `type` pode gerar um documento inválido.
- **R4.** Em modo debug, `stack` vai no corpo, como hoje. Ligar `debug` em produção continua expondo detalhes internos.
- **R5.** Os testes que verificam o corpo JSON atual podem precisar de ajuste pontual. O ajuste deve preservar o que cada teste verifica.
