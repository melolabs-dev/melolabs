# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Base: issue h3js/h3#1384 e contrato `sdd/pedido.md` (#1384-B).

## Problema e objetivo

### Problema

Hoje, quando uma resposta de erro é gerada, o h3 serializa `HTTPError` em um JSON próprio: `{ status, statusText, unhandled, message, data, ...body }`, com `Content-Type: application/json`. Não há um formato padronizado, e clientes que querem tratar erros de forma uniforme precisam conhecer o formato específico do h3. A issue #1384 pede suporte à [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (Problem Details for HTTP APIs).

### Objetivo

Fazer com que toda resposta de erro do h3 use o formato *problem details* (representação JSON), sem nenhuma opção de configuração, e permitir que `HTTPError` informe os campos `type` e `instance` definidos pela RFC. A mudança não pode quebrar o que já existe além do estritamente necessário para cumprir a RFC.

## Requisitos funcionais

### RF-01 — Resposta de erro no formato problem details

Toda resposta de erro gerada pelo h3 (erro lançado por handler, middleware ou hook, e 404 de rota não encontrada) passa a ter corpo JSON de problem details com `Content-Type: application/problem+json`, contendo ao menos `status`, `title` e `type`.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 403, statusText: "Forbidden" })`,
- **Quando** a requisição é processada,
- **Então** a resposta tem status `403`, `Content-Type` `application/problem+json`, e o corpo JSON contém `status: 403`, `title: "Forbidden"` e `type: "about:blank"`.

### RF-02 — Campos `type` e `instance` em `HTTPError`

O construtor de `HTTPError` aceita, no objeto de entrada, os campos opcionais `type` e `instance`. Ambos ficam expostos na instância e são serializados no corpo da resposta de erro quando informados.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 404, type: "https://exemplo.com/erros/usuario-inexistente", instance: "/usuarios/42" })`,
- **Quando** a instância é lida e a resposta de erro é gerada,
- **Então** `error.type` e `error.instance` retornam os valores informados, e o corpo da resposta contém `type: "https://exemplo.com/erros/usuario-inexistente"` e `instance: "/usuarios/42"`.

### RF-03 — Valor padrão de `type` e `title`

Quando `type` não é informado, o corpo usa `"about:blank"`, como a RFC define. Quando `statusText` não é informado, `title` usa o texto padrão do status HTTP.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 500 })`, sem `type` nem `statusText`,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo contém `type: "about:blank"` e `title` igual ao texto padrão de 500 (`"Internal Server Error"`).

### RF-04 — Mensagem como `detail` e campos existentes preservados

A mensagem do erro é exposta em `detail`. Os campos já existentes (`message`, `statusText`, `unhandled`, `data` e os campos de `body`) continuam no corpo, com o mesmo valor de hoje, como membros de extensão permitidos pela RFC.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 400, message: "Campo inválido", data: { campo: "email" } })`,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo contém `detail: "Campo inválido"`, `message: "Campo inválido"` e `data: { campo: "email" }`.

### RF-05 — Erros não tratados continuam ocultos

Erros não tratados (`unhandled`) não expõem a mensagem original, `data` nem stack trace fora do modo `debug`, como acontece hoje.

**Critério de aceite**

- **Dado** um handler que lança `new Error("senha do banco vazada")` com o modo `debug` desativado,
- **Quando** a resposta de erro é gerada,
- **Então** o status é `500`, o corpo contém `detail: "HTTPError"` e `message: "HTTPError"`, e a string `"senha do banco vazada"` não aparece no corpo nem nos headers.

### RF-06 — `onError` e headers de erro continuam funcionando

O hook `onError` continua recebendo o erro original e, se retornar um novo valor, esse valor é renderizado no novo formato. Headers de erro (`HTTPError.headers` e headers staged em `event.res`) continuam presentes na resposta, e `Set-Cookie` não é duplicado.

**Critério de aceite**

- **Dado** um `onError` que retorna `new HTTPError({ status: 422, instance: "/pedidos/7" })` e um `HTTPError` lançado com header `Set-Cookie`,
- **Quando** a requisição falha,
- **Então** a resposta tem status `422`, corpo de problem details com `instance: "/pedidos/7"`, `Content-Type: application/problem+json`, e exatamente um `Set-Cookie`.

### RF-07 — Rota não encontrada em problem details

Uma requisição para rota inexistente recebe `404` no formato problem details, com a mensagem de rota não encontrada em `detail`.

**Critério de aceite**

- **Dado** uma aplicação sem rota para `GET /inexistente`,
- **Quando** a requisição é feita,
- **Então** a resposta tem status `404`, `Content-Type: application/problem+json`, e `detail` que cita `[GET] /inexistente`.

## Fora de escopo

- Opção de configuração (flag, opção do `H3`, variável de ambiente) para voltar ao formato antigo ou escolher o formato. O pedido diz explicitamente "sem configuração".
- Novos nomes públicos além de `type` e `instance` em `HTTPError` (sem helper como `toProblemDetails`, sem tipo novo exportado para o corpo).
- Registro ou catálogo de tipos de problema (URIs de `type` com documentação, tradução ou localização de `title`/`detail`).
- Alterar o formato de respostas JSON-RPC (`defineJsonRpcHandler`), que tem envelope próprio.
- Alterar `h3/nitro` ou qualquer pacote fora deste repositório.
- Remover os campos existentes do corpo (`message`, `statusText`, `unhandled`, `data`, `body`). Eles ficam como extensões.
- Mudanças em `HTTPResponse`, em respostas de sucesso ou em middleware que não gera erro.

## Premissas

- **P1 — Padrão sem opção.** O formato novo substitui o atual para todos os erros, sem flag. É a leitura literal de `pedido.md`.
- **P2 — Campos existentes preservados.** `message`, `statusText`, `unhandled`, `data` e `body` continuam no corpo com o mesmo valor. A RFC permite membros de extensão. Assim "não quebrar o que já existe" vale para o conteúdo do corpo.
- **P3 — `detail` é a mensagem.** `detail` recebe o mesmo valor de `message`, sem tirar nada de `message`.
- **P4 — `title` vem de `statusText`.** Se `statusText` não existir, usa o texto padrão do status HTTP.
- **P5 — `type` padrão `about:blank`.** É o valor que a RFC define quando não há tipo específico.
- **P6 — Única quebra esperada é o `Content-Type`.** Clientes que filtram por `application/json` deixam de reconhecer a resposta, mesmo com o corpo compatível. Isso precisa aparecer nas notas de release.
- **P7 — Testes existentes.** Testes que checam o formato antigo (por exemplo, `Content-Type` ou corpo exato) são ajustados para o formato novo, mantendo o que verificam. É o que `pedido.md` autoriza.

## Riscos

- **R1 — Quebra para clientes (alto).** Consumidores que fazem `content-type === "application/json"`, ou que comparam o corpo inteiro, quebram. Mitigação: manter os campos existentes (P2) e registrar a mudança nas notas de release. Se o time preferir uma versão major, a decisão deve ser tomada antes da implementação.
- **R2 — Tensão entre "padrão sem configuração" e "não quebrar o que já existe" (médio).** Os dois pedidos só são compatíveis se a mudança ficar limitada ao `Content-Type` e aos campos novos. Qualquer outra mudança no corpo precisa ser revisada.
- **R3 — Vazamento de detalhes (alto).** Ao montar `detail`, `title` ou `instance`, um erro não tratado pode vazar mensagem ou dados. Mitigação: RF-05 com teste de regressão antes da mudança.
- **R4 — `Set-Cookie` duplicado (médio).** O caminho de `onError` já reprocessa a resposta. Mitigação: RF-06 cobre o caso.
- **R5 — `instance` e `type` vindos de entrada do usuário (baixo).** Se um handler copiar dados da requisição para `type` ou `instance`, a resposta reflete esses valores. O h3 só repassa o que o desenvolvedor informar; a documentação deve dizer isso.
- **R6 — Cobertura da matriz de testes (baixo).** Os testes rodam em modo `web` e `node`. Os critérios RF-01 a RF-07 devem ser verificados nos dois.
