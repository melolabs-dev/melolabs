# PRD — Problem details (RFC 9457) via utilitário `problem()`

Base: issue h3js/h3#1384 e contrato `sdd/pedido.md` (variante #1384-C).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre no formato definido por `HTTPError` (JSON com `status`, `statusText`, `message`, `data` e campos de `body`). Não existe forma padronizada de responder erros no formato "problem details" da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), que APIs HTTP usam para que clientes tratem erros de maneira previsível (`type`, `title`, `status`, `detail`, `instance`).

Quem quer adotar o formato hoje precisa montar a resposta à mão em cada handler, sem apoio do framework.

### Objetivo

Permitir que um handler responda erros no formato RFC 9457 chamando um utilitário explícito, `problem(input)`, exportado por `h3`. Apenas as respostas produzidas por esse utilitário mudam de formato. Todo o comportamento atual de `HTTPError` permanece igual.

## Requisitos funcionais

### RF-01 — Utilitário `problem()` exportado pelo pacote

A função `problem(input)` é exportada pelo pacote `h3` e devolve uma instância de `HTTPError`, de modo que possa ser lançada ou retornada por um handler como qualquer outro erro.

- **Dado** que um consumidor importa `problem` de `h3`,
- **Quando** chama `problem({ status: 404, message: "Pedido não encontrado" })`,
- **Então** recebe um `HTTPError` com `status` 404 e `message` "Pedido não encontrado", e `HTTPError.isError` retorna `true` para ele.

### RF-02 — Entrada aceita os campos de `HTTPError` mais `type` e `instance`

O parâmetro `input` aceita os campos de entrada de `HTTPError` (`ErrorInput`) e, além deles, os campos opcionais `type` (URI que identifica o tipo do problema) e `instance` (URI que identifica a ocorrência). O tipo de `input` é o único tipo público novo, e não há outro nome público novo além de `problem` e desse tipo.

- **Dado** uma entrada com `status`, `message`, `type: "https://exemplo.com/erros/saldo"` e `instance: "/contas/42/transferencias/7"`,
- **Quando** o utilitário é chamado com essa entrada,
- **Então** a chamada compila sem erro de tipo, e os valores de `type` e `instance` ficam disponíveis no erro criado.

### RF-03 — Corpo da resposta segue a RFC 9457

Quando um erro criado por `problem()` chega à resposta, o corpo JSON contém os membros da RFC: `type`, `title`, `status`, `detail` e, quando informado, `instance`.

- `type` ausente vira `"about:blank"`, conforme a RFC.
- `title` vem de `statusText`, quando informado.
- `detail` vem de `message`.
- Campos extras passados em `body` viram membros de extensão no mesmo objeto JSON.

- **Dado** um handler que lança `problem({ status: 422, statusText: "Unprocessable Content", message: "Saldo insuficiente", type: "https://exemplo.com/erros/saldo", instance: "/transferencias/7" })`,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem status 422 e o corpo JSON contém `type` = "https://exemplo.com/erros/saldo", `title` = "Unprocessable Content", `status` = 422, `detail` = "Saldo insuficiente" e `instance` = "/transferencias/7".

- **Dado** o mesmo handler, mas sem `type`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `type` = "about:blank".

### RF-04 — Content-Type `application/problem+json` apenas para respostas de `problem()`

A resposta de um erro criado por `problem()` usa `Content-Type: application/problem+json`. Erros de `HTTPError` comuns continuam com o `Content-Type` JSON atual.

- **Dado** um handler que lança `problem({ status: 409, message: "Conflito" })`,
- **Quando** a resposta é gerada,
- **Então** o cabeçalho `Content-Type` é `application/problem+json`.

- **Dado** um handler que lança `new HTTPError({ status: 409, message: "Conflito" })`,
- **Quando** a resposta é gerada,
- **Então** o cabeçalho `Content-Type` continua sendo o JSON atual, e o corpo tem o formato antigo (`status`, `statusText`, `message`, `data`).

### RF-05 — Nenhuma mudança para erros que não usam `problem()`

O formato, o status e os cabeçalhos de qualquer resposta que não passe por `problem()` permanecem idênticos aos atuais. Isso inclui `HTTPError.status(...)`, `new HTTPError(...)`, erros não tratados e erros convertidos por `toResponse`.

- **Dado** uma aplicação que não importa nem chama `problem()`,
- **Quando** qualquer rota falha com erro comum,
- **Então** a resposta é byte a byte igual à produzida pela versão anterior do h3.

### RF-06 — Campos sensíveis de erros não tratados continuam ocultos

Quando o erro criado por `problem()` está marcado como `unhandled`, `detail` e `message` não aparecem na resposta, seguindo a mesma regra de `HTTPError`. O corpo mostra apenas os membros que não expõem detalhes internos.

- **Dado** um erro criado com `problem({ status: 500, message: "Falha no banco", unhandled: true })`,
- **Quando** a resposta é gerada,
- **Então** o corpo não contém `detail` nem a mensagem "Falha no banco".

### RF-07 — Status e cabeçalhos seguem as regras de `HTTPError`

O `status` passa pela mesma sanitização de `HTTPError` (padrão 500 quando inválido), e `headers` informados são enviados na resposta, mesclados aos cabeçalhos de erro.

- **Dado** `problem({ status: 999, message: "x", headers: { "retry-after": "30" } })`,
- **Quando** a resposta é gerada,
- **Então** o status segue a sanitização de `HTTPError` (500, como `new HTTPError` faria) e o cabeçalho `retry-after: 30` está presente.

### RF-08 — Testes cobrem os dois runtimes e a suíte existente passa

Os testes novos usam `describeMatrix` (modos `web` e `node`). Testes existentes só são ajustados quando dependem diretamente do que muda, sem perder o que verificam.

- **Dado** a suíte de testes do projeto após a mudança,
- **Quando** `pnpm test` (ou `pnpm vitest run` nos arquivos afetados) é executado,
- **Então** todos os testes passam nos modos `web` e `node`, e `pnpm lint` e `pnpm typecheck` passam sem erros.

## Fora de escopo

- Alterar o formato global de `HTTPError` ou o `Content-Type` de respostas comuns.
- Negociação de conteúdo por `Accept` (responder JSON simples a clientes que pedem `application/json` quando o erro vem de `problem()`).
- Suporte a `application/problem+xml`.
- Membros de validação, como a lista `errors` de respostas 422 de validação; isso fica para uma iteração posterior.
- Registro, resolução ou documentação das URIs de `type`; o h3 não acessa essas URIs.
- Integração com `h3/nitro` ou qualquer outro pacote fora deste repositório.
- Alterar hooks `onError`, `onResponse` ou a conversão de erros em `toResponse`, exceto o necessário para escolher o formato na serialização.
- Novos nomes públicos além de `problem` e do tipo da entrada.

## Premissas

- O mapeamento `title` ← `statusText` e `detail` ← `message` é a leitura adotada. Se o consumidor esperar outro mapeamento, a decisão muda antes da implementação.
- `problem()` é uma fábrica no mesmo estilo de `HTTPError.status()`: devolve um erro comum, sem classe nova.
- O formato de `problem()` é escolhido na serialização por um marcador interno, que não é nome público. Como esse marcador é interno, ele não conta como novo nome público.
- O pacote `h3` continua com as mesmas dependências de produção (`rou3`, `srvx`).
- A suíte atual, executada sem `problem()`, produz as mesmas respostas de antes; os ajustes em testes existentes são exceções justificadas.

## Riscos

- **Mapeamento ambíguo**: `title` e `detail` podem não bater com o que clientes RFC 9457 esperam, e mudar isso depois quebra quem já integrou.
- **Vazamento de campos**: `type` e `instance` não existem em `HTTPError`. Se o marcador de formato vazar para erros comuns, o formato muda sem aviso (violação de RF-05).
- **Colisão de membros**: um `body` com chaves como `status` ou `type` pode sobrescrever membros da RFC. É preciso definir a precedência e testá-la.
- **Vazamento em erros não tratados**: se `detail` ou `message` escaparem para `unhandled`, detalhes internos aparecem para o cliente (violação de RF-06).
- **Clientes sem suporte a `problem+json`**: clientes que validam `Content-Type` estritamente como `application/json` podem falhar ao receber a resposta nova.
- **Testes existentes**: qualquer teste que compare o corpo ou o `Content-Type` de erros pode precisar de ajuste. Ajustes além do que muda caracterizam regressão, não evolução.
- **Nome do erro**: `HTTPError.isError` depende de `name === "HTTPError"`. O erro criado por `problem()` precisa manter esse nome para continuar sendo reconhecido pelo pipeline de erros.
