# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Base: `sdd/pedido.md` (issue h3js/h3#1384 e contrato enxuto #1384-B).

## Problema e objetivo

Hoje o h3 responde erros com um JSON próprio, produzido por `HTTPError.toJSON()` e montado em `errorResponse()` (`src/response.ts`). Esse formato não segue um padrão, então clientes precisam conhecer a forma específica do h3 para tratar erros.

A issue #1384 pede suporte à [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs). O contrato #1384-B define que esse formato passa a ser o padrão de todas as respostas de erro, sem nenhuma opção de configuração nova.

**Objetivo:** toda resposta de erro gerada pelo h3 sai no formato problem details (`application/problem+json`), e `HTTPError` aceita e expõe os campos `type` e `instance` da RFC.

## Requisitos funcionais

### RF-01 — Resposta de erro em application/problem+json

Toda resposta de erro gerada pelo h3 usa o media type `application/problem+json` e um corpo JSON com os membros da RFC 9457: `type`, `title`, `status`, `detail` e `instance`.

**Critério de aceite**

- **Dado** uma rota que lança `HTTPError.status(404, "Not Found", { message: "Usuário não existe" })`,
- **Quando** a requisição é respondida,
- **Então** o status é `404`, o `Content-Type` é `application/problem+json`, e o corpo JSON contém `status: 404`, `title: "Not Found"` e `detail: "Usuário não existe"`.

### RF-02 — Valores padrão e mapeamento dos campos atuais

Quando o erro não define `type`, o corpo usa `type: "about:blank"`, como a RFC prevê. `statusText` vira `title`, e `message` vira `detail`. Quando `title` não existir, o h3 usa o texto padrão do status. `data` e `body` continuam sendo incluídos no corpo como membros de extensão, sem sobrescrever os membros da RFC.

**Critério de aceite**

- **Dado** um `HTTPError` criado sem `type`, com `data: { campo: "email" }`,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo contém `type: "about:blank"` e `campo` dentro de `data` (ou no nível de extensão definido por `body`), e nenhum membro da RFC é sobrescrito por `data` ou `body`.

### RF-03 — HTTPError aceita e expõe type e instance

`HTTPError` aceita, no objeto de entrada do construtor (`ErrorInput`), os campos opcionais `type` e `instance`. Os dois ficam expostos como propriedades `readonly` na instância e aparecem no corpo da resposta.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://example.com/probs/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a propriedade é lida na instância e a resposta é gerada,
- **Então** `error.type` e `error.instance` retornam os valores informados, e o corpo da resposta contém ambos.

### RF-04 — Erros não tratados continuam ocultando detalhes

Erros marcados como `unhandled` continuam sem expor a mensagem, `data`, `body` e a stack trace fora do modo de depuração. O formato muda, mas a regra de ocultação não.

**Critério de aceite**

- **Dado** um erro não tratado (lançado como `new Error("segredo do banco")`) com o modo de depuração desligado,
- **Quando** a resposta de erro é gerada,
- **Então** o status é `500`, o corpo está em `application/problem+json`, e nem `detail` nem `stack` contêm "segredo do banco".

### RF-05 — Compatibilidade e testes existentes

O comportamento que já existe não é quebrado além do que o formato novo exige. A suíte existente continua passando. Quando um teste existente depende do formato antigo, ele é ajustado para o formato novo sem deixar de verificar o que verificava antes. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** a suíte existente no estado anterior à mudança,
- **Quando** `pnpm vitest run` é executado após a implementação,
- **Então** todos os testes passam, os únicos testes alterados são os que assertam o formato antigo, e `pnpm lint` e `pnpm typecheck` terminam sem erros.

## Fora de escopo

- Opção de configuração para escolher entre formato antigo e novo (o contrato define o novo formato como padrão, sem opção nova).
- Novos nomes públicos além de `type` e `instance` em `HTTPError`.
- Extensões da RFC 9457 para validação (por exemplo, listas de erros de campo como um membro padronizado).
- Suporte a `application/problem+xml`.
- Tradução ou localização dos textos de `title` e `detail`.
- Mudanças no pacote `srvx` ou em integrações externas (Nitro e outros consumidores).
- Alterações em `src/_entries/*` ou em middlewares de erro que não passem por `errorResponse()`.

## Premissas e riscos

### Premissas

- Todas as respostas de erro geradas pelo h3 passam por `errorResponse()` em `src/response.ts`, e é nesse ponto que a mudança acontece.
- `HTTPError.toJSON()` pode continuar existindo como base para montar o corpo, desde que a resposta final siga a RFC 9457.
- O modo de depuração (`debug`) continua controlando a exposição de `stack`.

### Riscos

- **Quebra para consumidores existentes.** O formato padrão muda para todos os usuários sem opção de volta. Quem lê campos do JSON antigo (como `statusCode` ou `message`) pode quebrar. Esse é o principal conflito com a restrição "não quebrar o que já existe", e precisa ser aceito explicitamente pelo time antes da implementação. Se não for aceito, a alternativa é uma opção de configuração, o que contraria o contrato #1384-B.
- **Conflito de restrições.** O contrato pede "não quebrar o que já existe" e, ao mesmo tempo, troca o formato padrão. Na prática, a restrição só se cumpre se "quebrar" for entendido como "mudar o formato padrão, mantendo a API de `HTTPError` compatível". Isso precisa ser confirmado.
- **Campos de extensão.** `data` e `body` podem colidir com nomes da RFC (`type`, `title`, `status`, `detail`, `instance`). A regra do RF-02 define a precedência, mas usuários que já enviam esses nomes em `body` terão a saída alterada.
- **Content-Type.** Clientes que checam `application/json` de forma estrita deixarão de reconhecer a resposta de erro como JSON. Isso precisa ser verificado em clientes conhecidos.
- **Testes existentes.** Vários testes devem assertar o formato antigo. O risco é ajustar asserts demais e perder a verificação original.
