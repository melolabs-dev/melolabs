# PRD — Respostas de erro no formato problem details (RFC 9457)

Base: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje, quando uma rota ou middleware lança um erro, o h3 responde com um JSON próprio, gerado por `HTTPError.toJSON()` e `errorResponse()` em `src/response.ts`. O corpo tem `status`, `statusText`, `message`, `data`, os campos de `body` e `unhandled`, e, em modo debug, `stack`. O `Content-Type` é `application/json`, e não há um formato padronizado que clientes possam interpretar de forma genérica.

A RFC 9457 (Problem Details for HTTP APIs) define um formato padrão para erros HTTP: um documento JSON com `type`, `title`, `status`, `detail` e `instance`, servido como `application/problem+json`. A issue h3js/h3#1384 pede suporte a esse formato.

### Objetivo

Fazer com que todas as respostas de erro do h3 sejam problem details conforme a RFC 9457, sem configuração adicional, e permitir que `HTTPError` informe `type` e `instance`.

## Requisitos funcionais

### RF-01 — Resposta de erro como `application/problem+json`

Toda resposta de erro gerada pelo h3 usa `Content-Type: application/problem+json` e um corpo com os membros da RFC 9457:

- `status` ← `status` do erro (número, igual ao status da resposta);
- `title` ← `statusText` do erro; se ausente, o texto padrão do status;
- `detail` ← `message` do erro (ou o valor mascarado, nos casos de RF-04);
- `type` ← `type` do erro; se ausente, `"about:blank"`;
- `instance` ← `instance` do erro; omitido se ausente.

Os campos `data` e `body` do erro são incluídos como membros de extensão no topo do documento, para não perder informação já exposta hoje.

**Critério de aceite**

- **Dado** uma rota que lança `HTTPError.status(404, "Not Found", { message: "Usuário não encontrado" })`,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json`, e o corpo JSON contém `status: 404`, `title: "Not Found"`, `detail: "Usuário não encontrado"` e `type: "about:blank"`.

### RF-02 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` (`ErrorInput`) aceita os campos opcionais `type` e `instance`. Eles são expostos como propriedades `readonly` na instância. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, message: "Negado", type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` é `"https://exemplo.com/erros/sem-permissao"` e `error.instance` é `"/pedidos/42"`.

**Critério de aceite (ausência)**

- **Dado** `new HTTPError({ status: 500, message: "Falhou" })`,
- **Quando** a instância é inspecionada,
- **Então** `error.type` e `error.instance` são `undefined`.

### RF-03 — `type` e `instance` aparecem na resposta

Quando o erro tem `type` ou `instance`, eles aparecem no corpo da resposta conforme RF-01. Quando não têm, a resposta usa `"about:blank"` para `type` e omite `instance`.

**Critério de aceite**

- **Dado** um erro com `instance: "/pedidos/42"` lançado por um handler,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `instance: "/pedidos/42"` e `type: "about:blank"`.

### RF-04 — Erros não tratados continuam mascarados

Erros marcados como `unhandled` (exceções internas embrulhadas pelo h3) não expõem detalhes. O `detail` recebe o valor fixo que existe hoje (`"HTTPError"`), e `data` e `body` não são incluídos. Stack trace só aparece em modo debug, como hoje.

**Critério de aceite**

- **Dado** um handler que lança `new Error("senha do banco: 123")`,
- **Quando** a resposta é gerada com debug desligado,
- **Então** o corpo tem `status: 500`, `detail: "HTTPError"`, `type: "about:blank"`, não contém a string `"senha do banco"` e não contém `stack`.

### RF-05 — `HTTPError.toJSON()` mantém o formato atual

O método `HTTPError.toJSON()` continua retornando a forma que retorna hoje. A mudança de formato acontece apenas na construção da resposta HTTP (`errorResponse()`), para que chamadas diretas a `toJSON()` e outros consumidores internos não mudem.

**Critério de aceite**

- **Dado** `HTTPError.status(400, "Bad Request", { message: "Inválido" }).toJSON()`,
- **Quando** o resultado é comparado ao formato atual,
- **Então** o objeto retornado é idêntico ao que é retornado antes da mudança.

## Fora de escopo

- Negociação de conteúdo por `Accept` (ex.: devolver JSON simples para clientes que não aceitam `application/problem+json`). Não será implementada nesta entrega.
- Opção de configuração para ligar ou desligar o novo formato. O pedido diz explicitamente "sem configuração".
- Registro ou catálogo de tipos de problema (URLs de `type`) e documentação desses tipos.
- Novos membros de extensão além de `data` e `body`.
- Mudanças em erros de JSON-RPC (`src/utils/json-rpc.ts`), que têm formato próprio do protocolo.
- Integração com Nitro ou com outros frameworks que consomem o h3.
- Localização (i18n) das mensagens de erro.
- Mudança no mecanismo de log de erros não tratados.

## Premissas e riscos

### Premissas

- **P1 — Conflito a resolver antes da implementação.** O pedido diz "o novo formato substitui o formato de erro atual, sem opção nova" e, ao mesmo tempo, "não quebrar o que já existe". Trocar o `Content-Type` e a forma do corpo de todas as respostas de erro é uma mudança observável para clientes que hoje consomem o JSON atual. Este PRD segue a instrução de substituição padrão (RF-01), mas essa escolha precisa ser confirmada. As alternativas são: (a) aceitar a quebra de contrato e publicar como mudança major; (b) manter o formato atual como padrão e oferecer o novo por `Accept`, o que contraria a instrução "sem opção nova" e fica registrado como fora de escopo.
- **P2 — Escopo dos testes.** A suíte atual verifica o formato antigo em vários testes de erro. Esses testes serão ajustados somente onde a mudança de formato os altera, mantendo o que eles verificam (status, cabeçalhos extras, mascaramento de erros não tratados, etc.).
- **P3 — Ponto único de geração.** Todas as respostas de erro passam por `errorResponse()` em `src/response.ts`. Se isso não for verdade para algum caminho (ex.: erros de `onError` em `src/adapters.ts`), o caminho divergente precisa entrar no escopo.
- **P4 — Cabeçalhos do erro.** Os cabeçalhos definidos em `HTTPError.headers` continuam sendo aplicados; apenas `Content-Type` passa a ser `application/problem+json`.
- **P5 — `title` vem de `statusText`.** A RFC diz que `title` deve ser igual para todas as ocorrências do mesmo tipo de problema. Como o h3 usa `statusText` (texto curto, sem garantia de ser estável), o `title` herda essa característica. Não há tradução de `statusText` para um título canônico.

### Riscos

- **R1 — Quebra de clientes existentes.** Consumidores que leem `body.message`, `body.data` ou `body.statusText` podem falhar. Mitigação: decidir P1 antes de implementar; documentar a mudança no changelog com exemplo do antes e depois.
- **R2 — `Content-Type` e proxies/CDNs.** Alguns clientes e proxies tratam `application/problem+json` de forma diferente de `application/json`. Mitigação: testes de integração nos runtimes do `describeMatrix` (web e node).
- **R3 — Vazamento em erros não tratados.** Ao reorganizar o corpo, um campo pode vazar detalhe interno. Mitigação: teste de RF-04 em web e node, com debug ligado e desligado.
- **R4 — Conflito de nomes de campos.** Se `data` ou `body` tiverem chaves iguais a `type`, `title`, `status`, `detail` ou `instance`, a extensão pode sobrescrever membros da RFC. Mitigação: membros da RFC têm precedência; o comportamento fica coberto por teste.
- **R5 — Tamanho do diff e limite de 200 LoC por arquivo.** A mudança toca `src/error.ts` e `src/response.ts`, que já são grandes. Mitigação: a lógica de montagem do problem document fica em um helper, em `src/utils/internal/` ou no fim do arquivo, seguindo a convenção do projeto.
