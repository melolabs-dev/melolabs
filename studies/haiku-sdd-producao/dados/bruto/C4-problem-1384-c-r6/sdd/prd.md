# PRD — Problem details (RFC 9457) por utilitário explícito no h3

Fonte: `sdd/pedido.md` (contrato enxuto #1384-C, derivado da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o `HTTPError` do h3 serializa o erro em um formato próprio (`status`, `statusText`, `unhandled`, `message`, `data`, e propriedades de `body`). Não existe forma de responder erros no formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), que APIs HTTP usam para erros com um contrato previsível (`type`, `title`, `status`, `detail`, `instance`). Quem precisa desse formato hoje precisa montar a resposta à mão em cada handler.

### Objetivo

Permitir que um handler responda erros no formato RFC 9457 chamando um utilitário explícito, `problem(input)`, exportado pelo pacote `h3`. Somente as respostas geradas por esse utilitário mudam; todos os demais erros continuam com o formato atual.

## Requisitos funcionais

### RF-01 — Utilitário `problem` exportado pelo h3

O pacote `h3` exporta a função `problem(input)`, que devolve uma instância de `HTTPError`, de modo que o erro possa ser lançado (`throw problem(...)`) como qualquer outro `HTTPError`.

**Critério de aceite**

- **Dado** a entrada `{ status: 404, message: "Conta não encontrada" }`
- **Quando** o handler executa `problem(entrada)`
- **Então** o valor devolvido é uma instância de `HTTPError`, com `status` igual a `404` e `message` igual a `"Conta não encontrada"`.

### RF-02 — Entrada aceita os campos de `HTTPError` mais `type` e `instance`

O argumento de `problem` aceita os mesmos campos da entrada de `HTTPError` (`ErrorInput`) e, além deles, os campos opcionais `type` e `instance` da RFC 9457. Nenhum outro nome público novo é introduzido, além de `problem` e do tipo dessa entrada.

**Critério de aceite**

- **Dado** a entrada `{ status: 402, message: "Saldo insuficiente", type: "https://exemplo.com/erros/saldo", instance: "/contas/1/saques/9" }`
- **Quando** o handler lança `problem(entrada)` e a resposta é gerada
- **Então** o corpo JSON contém `type` igual a `"https://exemplo.com/erros/saldo"` e `instance` igual a `"/contas/1/saques/9"`.

### RF-03 — Resposta com `Content-Type: application/problem+json`

Quando o erro lançado foi criado por `problem`, a resposta usa o status do erro e o tipo de mídia `application/problem+json`. Os cabeçalhos informados em `headers` continuam sendo aplicados.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 403, message: "Acesso negado", headers: { "x-motivo": "escopo" } })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status `403`, `Content-Type` `application/problem+json` e o cabeçalho `x-motivo` com valor `escopo`.

### RF-04 — Mapeamento dos membros padrão da RFC 9457

O corpo JSON segue o mapeamento:

- `type`: valor informado, ou `"about:blank"` quando não informado;
- `title`: `statusText`, quando informado; sem `statusText`, o membro `title` é omitido;
- `status`: o status do erro;
- `detail`: a `message` do erro;
- `instance`: valor informado, quando existir.

**Critério de aceite**

- **Dado** a entrada `{ status: 422, message: "Campo 'nome' inválido" }`
- **Quando** a resposta é gerada
- **Então** o corpo JSON é exatamente `{ "type": "about:blank", "status": 422, "detail": "Campo 'nome' inválido" }`.

### RF-05 — Membros de extensão a partir de `data` e `body`

O conteúdo de `body` é espalhado no nível superior do JSON, como já ocorre com `HTTPError`. O conteúdo de `data` é colocado na chave `data`. Propriedades de `body` que colidam com os membros padrão (`type`, `title`, `status`, `detail`, `instance`) não os sobrescrevem.

**Critério de aceite**

- **Dado** a entrada `{ status: 400, message: "Pedido inválido", body: { saldo: 10, status: "x" }, data: { campo: "valor" } }`
- **Quando** a resposta é gerada
- **Então** o corpo JSON contém `saldo` igual a `10`, `data` igual a `{ "campo": "valor" }`, e `status` igual a `400`.

### RF-06 — Erros marcados como não tratados ocultam detalhes

Quando a entrada de `problem` traz `unhandled: true`, o corpo não expõe a mensagem original, `data` nem `body`, seguindo a regra já aplicada ao `HTTPError`.

**Critério de aceite**

- **Dado** a entrada `{ status: 500, message: "senha do banco vazada", unhandled: true, data: { segredo: "x" } }`
- **Quando** a resposta é gerada
- **Então** o corpo JSON não contém `"senha do banco vazada"` nem a chave `data`, e `detail` vale `"HTTPError"`.

### RF-07 — Erros que não usam `problem` não mudam

`HTTPError` lançado diretamente, ou qualquer outro erro tratado hoje, continua produzindo a mesma resposta e o mesmo `Content-Type` de antes.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError.status(404, "Not Found", { message: "Sem rota" })`
- **Quando** a rota é requisitada
- **Então** o `Content-Type` não é `application/problem+json` e o corpo é o JSON atual do `HTTPError` (`status`, `statusText`, `unhandled`, `message`, `data`).

### RF-08 — Funciona nos runtimes suportados

O comportamento de RF-03 a RF-06 vale nos modos `web` e `node` da suíte com `describeMatrix`.

**Critério de aceite**

- **Dado** um teste escrito com `describeMatrix` que lança `problem({ status: 409, message: "Conflito" })`
- **Quando** a suíte roda nos modos `web` e `node`
- **Então** ambos os modos recebem status `409`, `Content-Type` `application/problem+json` e `detail` igual a `"Conflito"`.

### RF-09 — Compatibilidade e qualidade do código

A suíte existente continua passando sem alteração de comportamento. Se algum teste existente precisar de ajuste, o ajuste deve ser apenas o necessário e preservar o que o teste verifica. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** o repositório com a mudança aplicada
- **Quando** `pnpm test` e `pnpm lint` são executados
- **Então** ambos terminam sem falhas, e nenhum teste existente foi removido.

## Fora de escopo

- Conversão automática de todo `HTTPError` para `application/problem+json`. Só erros criados por `problem` mudam.
- Negociação de conteúdo por cabeçalho `Accept`.
- Registro ou documentação de URIs de `type`, e valor padrão diferente de `"about:blank"`.
- Tradução ou localização de `title` e `detail`.
- Extensões além de `data` e `body`, e validação do conteúdo de `type` como URI.
- Tratamento de `problem` retornado (não lançado) como valor de handler, salvo se o código atual já tratar `HTTPError` retornado.
- Integração específica com Nitro ou com o pacote `h3/rules`.
- Alterações nas exportações `_deprecated.ts` (v1).
- Mudança no `toJSON` de `HTTPError` para os casos que não usam `problem`.

## Premissas

- A serialização de erros do h3 passa por um ponto central que pode ser estendido para reconhecer erros criados por `problem`. Este ponto ainda não foi mapeado neste PRD e deve ser confirmado na leitura do código (tratamento de erro e `toResponse`).
- `problem` pode marcar o erro com um sinal interno (não exportado) que o serializador lê. Assim, nenhum nome público além dos permitidos é criado.
- Quando `statusText` não é informado, `title` é omitido. Não se adiciona uma tabela de frases padrão de status.
- Os valores padrão e o comportamento de `unhandled` seguem a implementação atual de `HTTPError`, em `src/error.ts`.
- Os comandos de verificação são os de `AGENTS.md`: `pnpm vitest run <caminho>`, `pnpm test` e `pnpm lint`.

## Riscos

- **Colisão de nomes**: `body` ou `data` podem conter chaves iguais aos membros padrão. RF-05 define a precedência, mas a regra precisa ser coberta por teste.
- **Efeito colateral em `onError` e logs**: se o ponto de serialização for compartilhado com hooks ou logs, a marca interna pode afetar quem lê `toJSON`. Deve ser verificado antes de mudar.
- **Ambiguidade de `message` e `detail`**: sem `detail` explícito, a mensagem do erro vira `detail`. Isso pode vazar informação sensível se `unhandled` não for usado. RF-06 mitiga o caso.
- **Entradas deprecated (`statusCode`, `statusMessage`)**: `problem` herda essas entradas do `ErrorInput`. Precisa ser coberto ou excluído explicitamente.
- **Clientes que esperam JSON genérico**: o `Content-Type` muda só para os erros de `problem`, mas clientes que comparam o `Content-Type` exato podem falhar. Risco baixo, já que a mudança é opt-in.
