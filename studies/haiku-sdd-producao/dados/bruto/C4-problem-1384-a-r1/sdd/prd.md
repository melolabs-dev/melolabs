# PRD — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-A).

## Problema e objetivo

Hoje o h3 responde erros HTTP com um corpo JSON próprio (`message`, `statusText`, `data`, `body` e, em modo debug, `stack`). Esse formato não segue a RFC 9457 (Problem Details for HTTP APIs), então clientes que esperam `application/problem+json` não conseguem tratar os erros de forma padronizada.

**Objetivo:** permitir que a aplicação escolha responder erros no formato RFC 9457 por meio de uma opção de configuração. A opção fica desligada por padrão, e sem ela o comportamento atual não muda.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

Adicionar a opção booleana `problemDetails` em `H3Config`, com valor padrão `false`. Ela é lida de `app.config`, como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`
- **Quando** `app.config` é inspecionado
- **Então** `problemDetails` é `false` ou ausente, e o tipo `H3Config` aceita `problemDetails: true`.

### RF-02 — Erros em formato problem details quando a opção está ligada

Com `problemDetails: true`, todo erro HTTP renderizado pelo h3 (incluindo `HTTPError` lançado por handlers e o 404 de rota não encontrada) responde com:

- `Content-Type: application/problem+json`;
- corpo JSON com os membros da RFC 9457: `status`, `title`, `detail`, `type` (padrão `about:blank`) e `instance`, quando houver;
- `title` vindo de `statusText`; na ausência dele, o texto padrão do status;
- `detail` vindo de `message`.

Exemplo de corpo para `HTTPError.status(404, "Not Found", { message: "User 42 not found" })`:

```json
{
  "type": "about:blank",
  "status": 404,
  "title": "Not Found",
  "detail": "User 42 not found"
}
```

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `HTTPError.status(404, "Not Found", { message: "User 42 not found" })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status `404`, `Content-Type` `application/problem+json` e corpo com `status: 404`, `title: "Not Found"`, `detail: "User 42 not found"` e `type: "about:blank"`.

### RF-03 — `type` e `instance` em `HTTPError`

`ErrorInput` aceita os campos opcionais `type` e `instance` da RFC 9457. `HTTPError` os expõe como propriedades somente leitura da instância. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, message: "Forbidden", type: "https://example.com/probs/no-access", instance: "/orders/7" })`
- **Quando** as propriedades da instância são lidas
- **Então** `error.type` é `"https://example.com/probs/no-access"` e `error.instance` é `"/orders/7"`.

### RF-04 — Sem a opção, a resposta de erro não muda

Com `problemDetails` desligado (padrão), a resposta de erro continua exatamente como hoje: mesmo `Content-Type`, mesmo corpo JSON e mesmos campos. Os campos `type` e `instance` não aparecem nesse corpo.

**Critério de aceite**

- **Dado** uma aplicação sem `problemDetails` e uma rota que lança `HTTPError.status(404, "Not Found", { message: "User 42 not found", type: "https://example.com/x" })`
- **Quando** a rota é requisitada
- **Então** o `Content-Type` continua sendo `application/json;charset=UTF-8` e o corpo não contém `type` nem `instance`.

### RF-05 — Preservação de headers de erro

Headers definidos em `HTTPError.headers` e os headers staged em `event.res` para erros (`errHeaders`) continuam sendo enviados na resposta problem details. O `Content-Type` de problem details prevalece sobre qualquer `Content-Type` vindo desses headers.

**Critério de aceite**

- **Dado** `problemDetails: true` e um `HTTPError` com `headers: { "retry-after": "120" }`
- **Quando** a resposta de erro é gerada
- **Então** a resposta contém `retry-after: 120` e `Content-Type: application/problem+json`.

### RF-06 — Erros não tratados não vazam detalhes

Erros que não são `HTTPError` (marcados como `unhandled`) respondem `500` em formato problem details, sem `detail` com a mensagem original e sem `stack`, a menos que `debug` esteja ligado. Isso segue a regra já existente de ocultar mensagem e dados de erros não tratados.

**Critério de aceite**

- **Dado** `problemDetails: true` (sem `debug`) e um handler que lança `new Error("senha do banco: x")`
- **Quando** a rota é requisitada
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, e o corpo não contém `"senha do banco"` nem `stack`.

### RF-07 — Modo debug e hooks continuam funcionando

Com `debug: true` e `problemDetails: true`, o corpo inclui `stack` como membro de extensão, como hoje. O hook `onError` continua sendo chamado antes da renderização. Se ele retornar um valor próprio, esse valor é renderizado normalmente e não é convertido para problem details.

**Critério de aceite**

- **Dado** `problemDetails: true`, `debug: true` e um `onError` que retorna `new Response("custom", { status: 418 })`
- **Quando** um erro é lançado
- **Então** a resposta é `"custom"` com status `418`, sem `Content-Type: application/problem+json`.

### RF-08 — Cobertura de testes

Os testes novos cobrem os cenários de RF-01 a RF-07 com `describeMatrix`, rodando em modo `web` e `node`. A suíte existente continua passando. Testes existentes só são ajustados quando dependem diretamente do que muda, e sem perder o que eles verificam.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam nos modos `web` e `node`, incluindo os novos casos de problem details.

## Fora de escopo

- Registro ou validação de URIs de `type`; o valor é repassado como foi informado.
- Extensões de problem details além de `stack` (em debug) e dos campos já existentes de `HTTPError`.
- Configuração por rota ou por handler; a opção é global da aplicação.
- Localização (i18n) de `title` e `detail`.
- Suporte a outros formatos de erro, como XML (`application/problem+xml`).
- Mudança no formato JSON padrão de erro (RF-04 garante que ele permanece igual).
- Implementação em `h3/nitro`, citada na issue; este PRD cobre apenas o h3.
- Mudança no tipo público `ErrorBody`.

## Premissas e riscos

### Premissas

- A RFC 9457 é a referência normativa; a representação é JSON, com media type `application/problem+json`.
- O texto padrão de status usado quando `statusText` está ausente sai de uma fonte já disponível no projeto ou de uma tabela pequena a ser definida na implementação.
- `type` e `instance` ficam fora do JSON padrão de `HTTPError` (`toJSON`), para que a resposta sem a opção não mude.
- Restrições do pedido: nenhum outro nome público novo, nenhuma quebra do que já existe, `pnpm lint` e `pnpm typecheck` passando.
- Por convenção do projeto, o código novo usa `.ts` nos imports, fica em arquivos curtos e segue `describeMatrix` nos testes.

### Riscos

- **Vazamento de informação em erros não tratados.** Se a renderização nova ignorar a regra de ocultar dados de erros `unhandled`, mensagens internas podem ir ao cliente. Mitigação: RF-06 com teste explícito.
- **Quebra de clientes existentes.** Clientes que leem `message` no formato atual podem deixar de funcionar quando a opção é ligada. Mitigação: a opção é desligada por padrão e o `detail` mantém o texto de `message`.
- **Duplicação de headers `set-cookie`.** O fluxo de `errHeaders` e `onError` já tem cuidado especial com esse header; a nova renderização não pode reintroduzir a duplicação.
- **Divergência de tipos.** Adicionar `type`/`instance` a `ErrorInput` sem refletir em `HTTPError` quebraria o `isolatedDeclarations`. Mitigação: `pnpm typecheck` como critério de aceite.
- **Ambiguidade de `title` ausente.** Se o texto padrão do status não estiver disponível em todos os runtimes, o `title` pode ficar vazio. Mitigação: definir a fonte na implementação e cobrir com teste.
