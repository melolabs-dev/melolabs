# PRD — Problem details (RFC 9457) por opção de configuração

Base: `sdd/pedido.md` (contrato enxuto #1384-A, derivado da issue h3js/h3#1384).

## Problema e objetivo

Hoje o h3 responde erros sempre no mesmo formato JSON próprio, definido em `HTTPError.toJSON()` (`src/error.ts`) e renderizado por `errorResponse()` (`src/response.ts`). Quem consome a API e espera o formato "problem details" da RFC 9457 precisa adaptar ou transformar essas respostas manualmente.

Objetivo: permitir que a aplicação escolha, por uma opção de configuração, que os erros sejam respondidos no formato RFC 9457 (`application/problem+json`). Com a opção desligada — o padrão — nada muda para quem já usa o h3.

## Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`

A opção booleana `problemDetails` é adicionada a `H3Config`, desligada por padrão, e é lida de `app.config` como as demais opções.

**Critério de aceite**

- **Dado** uma aplicação criada sem a opção `problemDetails`
- **Quando** ela responde a um erro
- **Então** `app.config.problemDetails` é `false` ou `undefined` e a resposta mantém o formato atual do h3.

### RF-02 — Erros em formato problem details quando a opção está ligada

Com `problemDetails: true`, toda resposta de erro renderizada pelo h3 (erro lançado por handler, `HTTPError`, 404 de rota não encontrada, erro não tratado) sai como JSON RFC 9457 com `Content-Type: application/problem+json`. Os membros são:

- `type`: o valor informado no `HTTPError`; quando ausente, `"about:blank"` (valor padrão da RFC).
- `title`: o `statusText` do erro, quando existir.
- `status`: o código HTTP da resposta.
- `detail`: a `message` do erro.
- `instance`: o valor informado no `HTTPError`, quando existir.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e uma rota que lança `new HTTPError({ status: 404, statusText: "Not Found", message: "Usuário não existe" })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status `404`, `Content-Type` `application/problem+json` e corpo JSON com `type: "about:blank"`, `title: "Not Found"`, `status: 404` e `detail: "Usuário não existe"`.

### RF-03 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`, expostos como propriedades somente leitura na instância. Esses campos são usados apenas quando `problemDetails` está ligada; com a opção desligada, não aparecem na resposta.

**Critério de aceite**

- **Dado** `const err = new HTTPError({ status: 403, type: "https://exemplo.test/erros/sem-permissao", instance: "/pedidos/42" })`
- **Quando** o código lê `err.type` e `err.instance`
- **Então** os valores são `"https://exemplo.test/erros/sem-permissao"` e `"/pedidos/42"`.

**Critério de aceite (opção desligada)**

- **Dado** uma aplicação com `problemDetails` desligada e um handler que lança o `HTTPError` acima
- **Quando** a rota é requisitada
- **Então** o corpo não contém `type` nem `instance` e o `Content-Type` não é `application/problem+json`.

### RF-04 — Compatibilidade com o formato atual quando a opção está desligada

Com `problemDetails` desligada ou ausente, a saída de erro é byte a byte igual à atual: mesmo `Content-Type`, mesmos membros (`status`, `statusText`, `unhandled`, `message`, `data`, e os de `body`) e mesma ordem de precedência.

**Critério de aceite**

- **Dado** a suíte existente de testes, executada sem nenhuma alteração de configuração
- **Quando** `pnpm vitest run` roda
- **Então** os testes que não dependem do formato de erro continuam passando; os que dependem só são ajustados se a mudança alterar o que verificam, sem perder a verificação original.

### RF-05 — Erros não tratados não vazam detalhes

Com a opção ligada, erros não tratados (`unhandled`) seguem a regra atual de segurança: `detail` recebe o mesmo valor genérico que hoje ocupa `message` (`"HTTPError"`), e `data`, `body` e stack não são expostos fora do modo `debug`.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e um handler que lança `new Error("senha do banco: 123")`
- **Quando** a rota é requisitada
- **Então** a resposta tem status `500`, `Content-Type` `application/problem+json`, `detail` igual a `"HTTPError"` e o corpo não contém `"senha do banco"`.

### RF-06 — Hook `onError` continua funcionando

O hook `onError` de `H3Config` é executado antes da renderização, como hoje. Se ele retornar um valor, esse valor é renderizado no formato selecionado pela opção.

**Critério de aceite**

- **Dado** uma aplicação com `problemDetails: true` e `onError` que retorna `new HTTPError({ status: 422, message: "Dados inválidos" })`
- **Quando** um handler lança um erro qualquer
- **Então** a resposta tem status `422`, `Content-Type` `application/problem+json` e `detail: "Dados inválidos"`.

## Fora de escopo

- Negociação de conteúdo por cabeçalho `Accept`: quando a opção está ligada, a resposta de erro é sempre `application/problem+json`.
- Opção por rota, por handler ou por erro individual.
- Formatos XML ou HTML de problem details.
- Registro ou documentação dos URIs de `type`; o h3 apenas repassa o valor informado, sem validar nem resolver.
- Localização (i18n) de `title` e `detail`.
- Integração com nitro ou outros pacotes além do h3 (a issue original menciona h3/nitro).
- Mudança do formato padrão do h3 ou remoção de campos existentes (`statusText`, `unhandled`, `data`).
- Novos nomes públicos além de `problemDetails`, `type` e `instance`.

## Premissas

- A renderização de erros passa por um ponto único: `prepareResponse()` chama `errorResponse()` em `src/response.ts`, e o corpo vem de `HTTPError.toJSON()` em `src/error.ts`. A mudança fica concentrada aí.
- O `Content-Type` atual vem de `jsonHeaders` (`src/response.ts`, linha ~270). Para o modo ligado, o cabeçalho passa a ser `application/problem+json`.
- `app.config` já expõe o `H3Config` completo, então `problemDetails` é lido como as demais opções, sem mecanismo novo.
- `data` e `body` continuam sendo repassados: `data` sob a chave `data` e `body` como membros de primeiro nível, como hoje. Essa é uma decisão de compatibilidade assumida aqui.
- Os valores de `type` e `instance` não são validados pelo h3; o usuário é responsável por informar URIs válidos.
- `pnpm lint` e `pnpm typecheck` precisam passar ao final.

## Riscos

- **Colisão de chaves:** um `body` com `type`, `title`, `detail` ou `status` pode sobrescrever membros da RFC. Precisa de regra explícita de precedência (proposta: membros RFC vencem) e de teste.
- **Quebra de clientes:** clientes que comparam `Content-Type` com `application/json` deixam de reconhecer a resposta quando a opção é ligada. Isso só afeta quem ligar a opção, mas precisa estar documentado.
- **Testes existentes:** testes que verificam o JSON de erro atual podem precisar de ajuste. O contrato permite isso só quando a mudança altera o que eles verificam.
- **Vazamento em `unhandled`:** se `detail` for preenchido a partir de `message` antes da regra de ocultação, o erro interno pode vazar. A regra do RF-05 precisa valer no caminho novo.
- **Ordem de `set-cookie` e cabeçalhos de erro:** o caminho de `onError` já trata `kEventResErrHeaders` com cuidado (ver comentário em `src/response.ts`); a versão nova não pode reintroduzir duplicação.
- **Limite de tamanho:** `title` e `statusText` têm o limite de caracteres já definido em `ErrorBody`; manter a sanitização existente.
