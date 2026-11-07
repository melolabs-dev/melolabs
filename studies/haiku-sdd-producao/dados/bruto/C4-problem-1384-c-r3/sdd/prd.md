# PRD — Problem details (RFC 9457) por utilitário explícito

Origem: `sdd/pedido.md` (contrato enxuto #1384-C, a partir da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre no mesmo formato JSON próprio, produzido a partir de `HTTPError` (campos `status`, `statusText`, `message`, `data`, `body`). A issue h3js/h3#1384 pede suporte à RFC 9457 (Problem Details for HTTP APIs), que define um formato padronizado para erros HTTP, com media type `application/problem+json`.

Quem constrói APIs que seguem a RFC 9457 não tem como usá-la no h3 sem escrever à mão a resposta de erro em cada handler.

### Objetivo

Permitir que o h3 responda erros no formato "problem details" por meio de um utilitário explícito, `problem(input)`, chamado pelo handler. Somente as respostas que usam o utilitário mudam. Todo o comportamento existente permanece igual.

## Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado pelo `h3`

A função `problem(input)` é exportada pelo pacote `h3` e devolve uma instância de `HTTPError`, para que possa ser lançada ou retornada pelo handler como qualquer outro erro.

**Critério de aceite**

- **Dado** que o usuário importa `problem` de `h3`,
- **Quando** chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** o valor devolvido é uma instância de `HTTPError` com `status` 404 e `message` "Usuário não encontrado".

### RF-02 — Campos `type` e `instance` na entrada

A entrada de `problem` aceita os campos de entrada de `HTTPError` (`ErrorInput`) e, além deles, os campos opcionais `type` e `instance` definidos pela RFC 9457.

**Critério de aceite**

- **Dado** uma entrada com `type: "https://exemplo.com/erros/saldo-insuficiente"` e `instance: "/contas/42/transacoes/7"`,
- **Quando** o utilitário `problem` processa essa entrada,
- **Então** o erro resultante guarda esses dois valores para serem usados na resposta.

### RF-03 — Resposta no formato problem details

Quando um erro criado por `problem` chega ao cliente, a resposta usa o media type `application/problem+json` e um corpo JSON com os membros da RFC 9457: `type`, `title`, `status`, `detail` e `instance`.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 403, statusText: "Forbidden", message: "Token expirado" })`,
- **Quando** o cliente faz a requisição a essa rota,
- **Então** a resposta tem status 403, `Content-Type` igual a `application/problem+json` e corpo JSON com `status` 403, `title` "Forbidden", `detail` "Token expirado" e `type` "about:blank".

### RF-04 — Valor padrão de `type`

Se `type` não for informado, a resposta usa `about:blank`, conforme a RFC 9457 (seção 4.2.1).

**Critério de aceite**

- **Dado** um erro criado com `problem({ status: 500, message: "Falha" })` sem `type`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `"type": "about:blank"`.

### RF-05 — Membros de extensão

Os campos `data` e `body` da entrada são incluídos na resposta problem details como membros de extensão no nível superior do JSON, conforme a RFC 9457 (seção 3.2). Um campo com o mesmo nome de um membro padrão não sobrescreve o membro padrão.

**Critério de aceite**

- **Dado** um erro `problem({ status: 422, message: "Dados inválidos", body: { campo: "email" } })`,
- **Quando** a resposta é gerada,
- **Então** o corpo JSON contém `"campo": "email"` no nível superior, além de `status`, `title`, `detail`, `type`.

### RF-06 — Erros sem `problem` mantêm o formato atual

Erros lançados com `HTTPError`, `createError` ou qualquer outro erro que não passe por `problem` continuam sendo respondidos com o formato JSON atual, sem `application/problem+json`.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError.status(404, "Not Found")`,
- **Quando** o cliente faz a requisição,
- **Então** a resposta tem o mesmo corpo e o mesmo `Content-Type` que tinha antes da mudança.

### RF-07 — Erros não tratados continuam ocultando detalhes

Quando um erro criado por `problem` é marcado como `unhandled`, a resposta segue a mesma regra de segurança de `HTTPError`: stack trace, `data`, `body` e `message` internos não são enviados ao cliente.

**Critério de aceite**

- **Dado** um erro não tratado com `problem({ status: 500, message: "senha do banco: x", unhandled: true })`,
- **Quando** a resposta é gerada fora do modo debug,
- **Então** o corpo não contém a mensagem interna "senha do banco: x".

### RF-08 — Nenhum outro nome público novo

A mudança adiciona ao pacote público somente `problem` e um único tipo para a sua entrada. Nenhum outro símbolo, função ou tipo é exportado.

**Critério de aceite**

- **Dado** o conjunto de exports do pacote `h3` antes e depois da mudança,
- **Quando** os dois são comparados,
- **Então** a única diferença é a inclusão de `problem` e do tipo da entrada.

### RF-09 — Compatibilidade com o que já existe

A mudança não quebra nenhuma API pública existente. A suíte de testes existente continua passando. Se um teste existente depender do comportamento alterado, ele pode ser ajustado somente no ponto afetado, sem remover o que ele verifica.

**Critério de aceite**

- **Dado** a suíte de testes e o código antes da mudança,
- **Quando** a mudança é aplicada e `pnpm test` é executado,
- **Então** todos os testes passam, e qualquer teste alterado mantém a verificação original.

### RF-10 — Funciona nos runtimes suportados

O comportamento de `problem` é o mesmo em Node.js e nos runtimes baseados em Web Standards, validado com `describeMatrix`.

**Critério de aceite**

- **Dado** um teste escrito com `describeMatrix` que lança `problem` em um handler,
- **Quando** a suíte roda nos modos `web` e `node`,
- **Então** a resposta é idêntica nos dois modos (status, `Content-Type` e corpo).

### RF-11 — Qualidade de código

`pnpm lint` e `pnpm typecheck` passam sem erros após a mudança.

**Critério de aceite**

- **Dado** o projeto com a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos terminam com código de saída 0.

## Fora de escopo

- Conversão automática de todos os erros para problem details. Só respostas que passam por `problem` mudam.
- Alteração do formato JSON padrão de `HTTPError`.
- Integração com Nitro ou outros frameworks que consomem o h3.
- Registro ou catálogo de tipos de problema (URIs de `type`) e geração de documentação para eles.
- Validação de que `type` é uma URI absoluta ou de que resolve para uma página.
- Suporte a `application/problem+xml`.
- Localização (i18n) das mensagens de erro.
- Novos exports além de `problem` e do tipo da entrada, conforme RF-08.

## Premissas e riscos

### Premissas

- O mapeamento usado é: `title` vem de `statusText` (ou, na falta dele, do texto padrão do status), e `detail` vem de `message`. O pedido não define isso explicitamente; deve ser confirmado antes da implementação.
- O erro criado por `problem` precisa carregar uma marca interna para que o tratamento de erros saiba usar o formato problem details. O mecanismo exato (símbolo, propriedade não enumerável, etc.) fica para a fase de design, desde que não vire export público (RF-08).
- `data` e `body` viram membros de extensão no nível superior, como a RFC 9457 recomenda. Se o time preferir mantê-los dentro de `data`, o RF-05 muda.
- O nome do tipo da entrada é único e será escolhido na implementação (por exemplo, `ProblemInput`).
- O tratamento de `unhandled` segue o que já existe em `HTTPError`; não há regra nova de segurança.

### Riscos

- **Ambiguidade no mapeamento de campos.** Se `title` e `detail` forem mapeados de forma diferente da esperada, clientes que dependem da RFC recebem dados inconsistentes. Mitigação: confirmar o mapeamento (premissa 1) e cobrir com testes (RF-03).
- **Vazamento de detalhes internos.** Como `problem` aceita `body` e `data`, uma entrada mal construída pode expor informação sensível. Mitigação: manter a regra de `unhandled` (RF-07) e testá-la.
- **Colisão de membros de extensão.** Um `body` com chave `status` ou `type` pode alterar a resposta. Mitigação: RF-05 define que os membros padrão prevalecem.
- **Quebra silenciosa em testes existentes.** Ajustar testes existentes pode esconder regressões. Mitigação: ajustar só o ponto afetado e manter a verificação original (RF-09).
- **Crescimento do escopo.** Pedidos como "converter todos os erros" ou "catálogo de tipos" podem surgir. Mitigação: manter a seção "Fora de escopo" como referência na revisão.
