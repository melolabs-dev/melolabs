# PRD — Problem details (RFC 9457) por utilitário explícito

Base: issue h3js/h3#1384 e contrato #1384-C (`sdd/pedido.md`).

## Problema e objetivo

### Problema

O h3 responde erros sempre no mesmo formato JSON (`status`, `statusText`, `message`, `data`, `unhandled` e os campos de `body`), com `Content-Type: application/json`. Esse formato é próprio do h3. Clientes e APIs que seguem a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs) não conseguem usar essas respostas sem adaptação, e a issue #1384 pede suporte a esse formato.

### Objetivo

Permitir que um handler responda um erro no formato de problem details da RFC 9457, chamando um utilitário explícito. Somente as respostas que usam esse utilitário mudam. Os erros existentes continuam como estão.

## Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado pelo pacote

O pacote `h3` exporta a função `problem(input)`, que devolve uma instância de `HTTPError`. Ela aceita os mesmos campos da entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`), mais os campos opcionais `type` e `instance` da RFC 9457.

**Critério de aceite**

- **Dado** um handler que importa `problem` de `h3`
- **Quando** ele chama `problem({ status: 404, message: "Usuário não encontrado" })` e lança ou retorna o resultado
- **Então** o resultado é uma instância de `HTTPError` com `status` 404 e `message` "Usuário não encontrado".

### RF-02 — Campos `type` e `instance`

Os campos `type` e `instance` são opcionais e aparecem no corpo da resposta com esses nomes, conforme a RFC 9457. Quando `type` é omitido, o corpo usa `"about:blank"`, valor padrão da RFC.

**Critério de aceite**

- **Dado** um erro criado com `problem({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`
- **Quando** a resposta é gerada
- **Então** o corpo JSON contém `"type": "https://exemplo.com/erros/sem-permissao"` e `"instance": "/pedidos/42"`.

- **Dado** um erro criado com `problem({ status: 500 })`, sem `type`
- **Quando** a resposta é gerada
- **Então** o corpo JSON contém `"type": "about:blank"` e não contém `instance`.

### RF-03 — Content-Type `application/problem+json`

Uma resposta gerada a partir de um erro criado por `problem()` usa `Content-Type: application/problem+json`. Esse tipo de resposta é reconhecido pelo tratamento de erro padrão do h3, sem que o handler precise definir cabeçalhos manualmente.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 422, message: "Dados inválidos" })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem status 422 e cabeçalho `Content-Type` igual a `application/problem+json`.

### RF-04 — Mapeamento dos campos para a RFC 9457

No corpo gerado, os campos da entrada são mapeados assim:

| Campo do h3 | Campo RFC 9457 | Observação |
| --- | --- | --- |
| `status` | `status` | Já sanitizado pelo `HTTPError` (fora de 100–599 vira 500). |
| `statusText` | `title` | Se ausente, o `title` pode ser omitido. |
| `message` | `detail` | Texto específico desta ocorrência. |
| `type` | `type` | Ver RF-02. |
| `instance` | `instance` | Ver RF-02. |
| `data` | `data` | Mantido como membro de extensão, para não perder informação. |

**Critério de aceite**

- **Dado** um erro `problem({ status: 409, statusText: "Conflict", message: "E-mail já cadastrado" })`
- **Quando** a resposta é gerada
- **Então** o corpo JSON contém `"status": 409`, `"title": "Conflict"` e `"detail": "E-mail já cadastrado"`.

### RF-05 — Erros fora de `problem()` não mudam

Qualquer erro que não tenha sido criado por `problem()` continua sendo respondido no formato atual, com `Content-Type: application/json` e o mesmo corpo de hoje.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Não encontrado" })`
- **Quando** a resposta é gerada
- **Então** o `Content-Type` é `application/json` e o corpo tem as chaves `status`, `statusText`, `unhandled`, `message` e `data`, como antes da mudança.

### RF-06 — Erros não tratados não vazam detalhes

Quando um erro criado por `problem()` tem `unhandled: true`, a resposta segue a regra já existente de `HTTPError`: `detail` (`message`), `data` e o corpo extra não aparecem. O `status` continua presente.

**Critério de aceite**

- **Dado** um erro `problem({ status: 500, message: "senha do banco inválida", data: { tabela: "usuarios" }, unhandled: true })`
- **Quando** a resposta é gerada
- **Então** o corpo não contém "senha do banco inválida" nem `data`, e contém `"status": 500`.

### RF-07 — Tipo público da entrada

O tipo da entrada de `problem()` é exportado do pacote `h3`. Ele é o único nome público novo além de `problem`.

**Critério de aceite**

- **Dado** um arquivo de tipos que importa o tipo da entrada de `h3`
- **Quando** o projeto passa por `pnpm typecheck`
- **Então** o tipo aceita um objeto com `status`, `message`, `type` e `instance`, e a checagem passa.

### RF-08 — Compatibilidade e qualidade

Nenhuma API existente muda de comportamento. Os testes existentes continuam passando. Só são ajustados os testes que dependem de um comportamento que esta mudança altera, mantendo o que eles verificam. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` são executados
- **Então** os três terminam sem falhas, e nenhum teste existente foi removido sem substituição equivalente.

## Fora de escopo

- Tornar RFC 9457 o formato padrão de todos os erros do h3 (variante global).
- Adicionar um registro de tipos de problema ou validar URIs em `type`.
- Localização (i18n) das mensagens.
- Helpers de cliente para ler respostas `application/problem+json`.
- Mudanças em `h3/nitro` ou em outros pacotes além do `h3`.
- Documentação em site externo (a documentação inline do código entra no escopo).
- Suporte ao formato RFC 7807 legado, além do que a RFC 9457 já define.

## Premissas e riscos

### Premissas

- O formato de saída segue a RFC 9457 com a representação JSON. Os nomes dos campos RFC (`title`, `detail`) são usados no corpo, mesmo que os campos de entrada continuem sendo os do `HTTPError`.
- O mapeamento da tabela de RF-04 é uma decisão de projeto. Se `statusText` ou `message` ficarem vazios, o campo correspondente é omitido.
- O tipo da entrada precisa de um nome. Como o contrato proíbe outros nomes públicos, o nome sugerido é `ProblemInput`, a confirmar.
- O sinal de que um erro veio de `problem()` precisa ficar interno (sem virar nome público nem propriedade documentada). Como ele é implementado é decisão técnica do time.
- Os testes seguem as convenções do projeto (`describeMatrix`, cobertura em modos `web` e `node`).

### Riscos

- **Colisão de chaves:** campos de `body` (espalhados no nível raiz do JSON) podem sobrescrever `type`, `title`, `detail` ou `instance`. Precisa de regra de precedência definida e testada.
- **Renderização em runtimes diferentes:** o `Content-Type` precisa chegar corretamente nos adaptadores Node e web. Um adaptador que reescreva cabeçalhos pode perder `application/problem+json`.
- **Vazamento em erros não tratados:** a regra de RF-06 depende de a sinalização de `unhandled` ser preservada no caminho de `problem()`.
- **Testes existentes:** asserções que esperam `application/json` em todos os erros podem precisar de ajuste. O ajuste deve ser mínimo e explícito no PR.
- **Ambiguidade do mapeamento:** se o time preferir outro mapeamento (por exemplo, `message` como `title`), RF-04 e seus critérios mudam juntos.
