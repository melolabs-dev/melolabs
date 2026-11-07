# PRD — Respostas de erro no formato problem details (RFC 9457)

Origem: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros como JSON próprio, montado em `errorResponse` (`src/response.ts`) a partir de `HTTPError.toJSON()` (`src/error.ts`). O corpo traz `status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`, sem seguir nenhum padrão. Clientes que querem tratar erros de forma genérica precisam conhecer esse formato específico do h3, e não existe um campo padronizado para identificar o tipo do erro nem a ocorrência específica.

### Objetivo

Fazer com que todas as respostas de erro do h3 usem o formato "problem details" da RFC 9457 (`application/problem+json`) por padrão, sem nenhuma opção de configuração. `HTTPError` passa a aceitar e expor os campos opcionais `type` e `instance` da RFC. A mudança não pode quebrar o que já existe na API pública.

## Requisitos funcionais

### RF-01 — Content-Type de erro como problem+json

Toda resposta gerada a partir de um erro (`HTTPError`, erro não tratado convertido em 500, ou status retornado por um handler) envia o cabeçalho `Content-Type: application/problem+json`.

**Critério de aceite**
- **Dado** um handler que lança `new HTTPError({ status: 404 })`
- **Quando** a requisição é feita ao app
- **Então** a resposta tem status 404 e `Content-Type` igual a `application/problem+json` (com charset, se o h3 já enviar charset hoje)

### RF-02 — Membros padrão da RFC 9457 no corpo

O corpo do erro é um objeto JSON com `type`, `title`, `status`, `detail` e, quando informado, `instance`. Regras de mapeamento:
- `status` = status HTTP da resposta;
- `title` = `statusText` do erro, ou a frase padrão do status quando ausente;
- `detail` = `message` do erro, exceto em erro não tratado (ver RF-04);
- `type` = valor informado, ou `about:blank` quando ausente (padrão da RFC);
- `instance` = valor informado; omitido quando ausente.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 422, statusText: "Unprocessable Content", message: "Campo inválido" })`
- **Quando** a resposta é serializada
- **Então** o corpo JSON contém `type: "about:blank"`, `title: "Unprocessable Content"`, `status: 422` e `detail: "Campo inválido"`

### RF-03 — HTTPError aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`, expostos como propriedades da instância e incluídos no corpo da resposta (RF-02). Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 404, type: "https://exemplo.com/erros/usuario-inexistente", instance: "/usuarios/42" })`
- **Quando** lemos `error.type` e `error.instance`
- **Então** os valores são os informados, e a resposta gerada contém esses mesmos valores nos membros `type` e `instance`

### RF-04 — Erros não tratados não expõem detalhes

Para erros marcados como `unhandled`, o comportamento de privacidade atual é mantido: `detail` não contém a mensagem original (o texto genérico continua sendo `HTTPError`), e `stack` só aparece em modo debug, como hoje.

**Critério de aceite**
- **Dado** um handler que lança `new Error("segredo do banco")`
- **Quando** a requisição é feita sem modo debug
- **Então** a resposta tem status 500, `Content-Type` `application/problem+json`, e o corpo não contém a string `segredo do banco`

### RF-05 — Preservação de `data` e `body` como membros de extensão

Os valores de `data` e os campos de `body` continuam aparecendo no corpo do erro, no nível superior, como membros de extensão permitidos pela RFC 9457. Membros de extensão não podem sobrescrever os membros padrão (`type`, `title`, `status`, `detail`, `instance`).

**Critério de aceite**
- **Dado** `new HTTPError({ status: 400, data: { campo: "email" } })`
- **Quando** a resposta é serializada
- **Então** o corpo contém `campo: "email"` no nível superior e `status: 400`, mesmo que `body` ou `data` tentem definir `status`

### RF-06 — Compatibilidade do corpo com a versão atual

Os campos que consumidores já leem hoje (`status`, `statusText`, `message`, `data`, `unhandled`) continuam presentes no corpo como membros de extensão, para que a troca do formato não remova informação dos clientes que a usam. Nenhum desses campos é removido do objeto `HTTPError` nem de `toJSON()`.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 409, message: "Conflito" })`
- **Quando** a resposta é serializada
- **Então** o corpo contém `status: 409`, `statusText` (quando definido) e `message: "Conflito"`, além de `type`, `title` e `detail`

### RF-07 — Headers e status do erro continuam sendo aplicados

Headers definidos em `HTTPError` (e os headers de erro passados ao renderizar) são mesclados à resposta problem+json, sem perder o `Content-Type` definido pelo h3. O status HTTP não muda.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 401, headers: { "www-authenticate": "Basic" } })`
- **Quando** a resposta é gerada
- **Então** a resposta tem status 401, o header `www-authenticate: Basic` e `Content-Type` `application/problem+json`

### RF-08 — Suíte existente e qualidade

A suíte de testes existente continua passando. Testes que verificam `application/json` ou a forma antiga do corpo de erro são ajustados somente nos pontos afetados pela mudança, mantendo o que eles verificam. Os novos comportamentos são cobertos com `describeMatrix`, cobrindo os modos `web` e `node`. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** o repositório após a mudança
- **Quando** `pnpm test` (ou `pnpm vitest run` nos arquivos afetados) é executado
- **Então** lint, typecheck e testes passam, e nenhum teste existente foi removido sem substituto equivalente

## Fora de escopo

- Opção de configuração para voltar ao JSON antigo ou escolher o formato (o pedido proíbe gatilho de configuração).
- Negociação de conteúdo pelo header `Accept` (ex.: responder `application/json` quando o cliente pedir).
- Novos nomes públicos além de `type` e `instance` em `HTTPError`.
- Schema específico para erros de validação (ex.: lista de problemas por campo) e registro de URIs de `type`.
- Integração com Nitro, logs de erro, tracing e documentação de usuário final, exceto a atualização de docs que o próprio repositório exige.
- Mudanças em `kNotFound`, `kHandled` e nos demais caminhos de resposta que não são erro.

## Premissas e riscos

### Premissas

- `about:blank` é aceitável como `type` padrão, conforme a RFC 9457 §4.2.1.
- Membros de extensão (`data`, `body` e os campos atuais) podem permanecer no nível superior do corpo sem violar a RFC.
- `instance` é omitido quando não informado, sem gerar valor automático.
- A mudança vai para uma versão que aceita quebra de contrato de erro (o pedido pede formato padrão sem configuração). Isso precisa ser confirmado com quem mantém o projeto.

### Riscos

- **Quebra de Content-Type:** clientes que checam `application/json` na resposta de erro vão deixar de reconhecê-la. Mitigação: documentar no changelog; avaliar se o release é major.
- **Tensão com "não quebrar o que já existe":** o pedido exige o formato novo por padrão e também exige não quebrar a API. RF-06 resolve isso mantendo os campos atuais como extensão, mas a troca do Content-Type continua sendo uma quebra para quem verifica o cabeçalho. Esta decisão precisa de aval explícito.
- **Testes existentes:** alguns testes de erro verificam o formato antigo; ajustá-los sem perder a verificação exige cuidado para não enfraquecer a cobertura.
- **Vazamento de informação:** a inclusão de `detail` e de membros de extensão pode expor dados sensíveis passados em `data` ou `body`. Mitigação: manter o comportamento atual de `unhandled` (RF-04) e não adicionar campos novos automaticamente.
- **Cache e proxies:** respostas de erro com novo Content-Type podem ser tratadas de forma diferente por intermediários que dependem do tipo MIME.
