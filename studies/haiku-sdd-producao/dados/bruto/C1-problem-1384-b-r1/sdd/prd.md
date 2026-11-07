# PRD — Respostas de erro no formato problem details (RFC 9457)

Referência: issue h3js/h3#1384 e contrato `sdd/pedido.md` (#1384-B).

## Problema e objetivo

Hoje o h3 serializa erros (`HTTPError`) em um JSON próprio, com os campos `status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`. Esse formato não segue padrão. Quem consome a API precisa conhecer o formato específico do h3 para tratar erros.

A RFC 9457 (*Problem Details for HTTP APIs*) define um formato JSON padronizado para erros HTTP, com media type próprio (`application/problem+json`). O objetivo é que **todas** as respostas de erro do h3 usem esse formato por padrão, sem configuração nova, e que `HTTPError` aceite os campos `type` e `instance` da RFC.

Os requisitos abaixo também fixam a compatibilidade: o que já existe no formato atual continua presente na resposta, para não quebrar clientes que dependem dele.

## Requisitos funcionais

### RF-01 — Content-Type de erro é `application/problem+json`

Toda resposta de erro gerada pelo h3 (erros de `HTTPError`, erros não tratados convertidos em 500 e erros de validação) passa a enviar o cabeçalho `Content-Type: application/problem+json`.

**Critério de aceite**
- **Dado** uma rota que lança `new HTTPError({ status: 404 })`
- **Quando** a rota é requisitada
- **Então** a resposta tem status 404 e o cabeçalho `Content-Type` é `application/problem+json`.

### RF-02 — Corpo segue os membros da RFC 9457

O corpo da resposta de erro contém os membros padrão da RFC 9457, mapeados a partir dos dados existentes do `HTTPError`:
- `type`: valor informado no construtor ou `"about:blank"` quando ausente;
- `title`: `statusText` do erro (ou o texto padrão do status, quando ausente);
- `status`: código HTTP do erro;
- `detail`: `message` do erro, exceto quando o erro é não tratado (ver RF-05);
- `instance`: valor informado no construtor, incluído somente quando presente.

**Critério de aceite**
- **Dado** um `HTTPError` com `status: 422`, `statusText: "Unprocessable Content"`, `message: "Campo e-mail inválido"`, `type: "https://exemplo.com/erros/email"` e `instance: "/cadastros/42"`
- **Quando** a rota que lança esse erro é requisitada
- **Então** o corpo JSON contém `type` igual a `"https://exemplo.com/erros/email"`, `title` igual a `"Unprocessable Content"`, `status` igual a `422`, `detail` igual a `"Campo e-mail inválido"` e `instance` igual a `"/cadastros/42"`.

### RF-03 — `HTTPError` aceita e expõe `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance`. Os dois valores ficam disponíveis como propriedades somente leitura na instância. Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** `const err = new HTTPError({ status: 400, type: "https://exemplo.com/erros/x", instance: "/itens/1" })`
- **Quando** o código lê `err.type` e `err.instance`
- **Então** `err.type` é `"https://exemplo.com/erros/x"` e `err.instance` é `"/itens/1"`.

**Critério de aceite (ausência)**
- **Dado** `const err = new HTTPError({ status: 400 })`
- **Quando** a resposta de erro é serializada
- **Então** o corpo contém `type` igual a `"about:blank"` e não contém a chave `instance`.

### RF-04 — Compatibilidade com os campos atuais

Os campos do formato atual (`status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`) continuam presentes no corpo, como membros de extensão permitidos pela RFC 9457. Clientes que já leem esses campos continuam funcionando.

**Critério de aceite**
- **Dado** um `HTTPError` com `status: 409`, `data: { campo: "slug" }`
- **Quando** a resposta de erro é serializada
- **Então** o corpo contém `data` igual a `{ campo: "slug" }` e os membros `status`, `statusText`, `unhandled` e `message` com os mesmos valores de hoje.

### RF-05 — Erros não tratados continuam ocultos

Para erros não tratados (`unhandled`), o corpo não expõe a mensagem original, `data` nem `stack` fora do modo debug. O `detail` nesses casos segue o valor que o h3 usa hoje para mascarar a mensagem. O campo `stack` só aparece em modo debug, como hoje.

**Critério de aceite**
- **Dado** uma rota que lança `new Error("senha do banco: 123")` com o modo debug desligado
- **Quando** a rota é requisitada
- **Então** a resposta tem status 500, `Content-Type: application/problem+json`, e nenhum trecho do corpo contém `"senha do banco"` nem `stack`.

### RF-06 — Cabeçalhos do erro são preservados

Cabeçalhos informados em `HTTPError` (`headers`) continuam sendo enviados na resposta, junto com o `Content-Type` da RFC.

**Critério de aceite**
- **Dado** um `HTTPError` com `status: 429` e `headers: { "Retry-After": "30" }`
- **Quando** a rota é requisitada
- **Então** a resposta contém o cabeçalho `Retry-After` com valor `"30"` e `Content-Type: application/problem+json`.

### RF-07 — Testes existentes continuam válidos

A suíte de testes existente continua passando. Testes que verificam o formato antigo (por exemplo, o `Content-Type` ou o corpo exato) são ajustados somente nos pontos afetados pela mudança, mantendo o que cada teste verifica.

**Critério de aceite**
- **Dado** o repositório após a mudança
- **Quando** `pnpm vitest run` é executado
- **Então** todos os testes passam, e as alterações em testes existentes se limitam a asserções de `Content-Type` e de formato do corpo de erro.

### RF-08 — Lint e typecheck passam

**Critério de aceite**
- **Dado** o código após a mudança
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos terminam sem erros.

## Fora de escopo

- Opção de configuração para desligar o formato RFC 9457 ou escolher entre formatos.
- Novos nomes públicos além de `type` e `instance` em `HTTPError` (por exemplo, `title` ou `detail` como propriedades da classe).
- Registro ou documentação de URIs de `type` específicas do h3 ou da aplicação.
- Mudanças em erros de protocolos próprios, como JSON-RPC (`defineJsonRpcHandler`) e WebSocket, que têm formatos definidos por seus protocolos.
- Mudanças na política de conteúdo de `stack`, `data` ou nas mensagens de erro não tratado, além do que a RF-05 mantém.
- Tradução ou localização dos valores de `title` e `detail`.
- Atualização da documentação externa (site/README); apenas `AGENTS.md` se houver mudança arquitetural relevante.

## Premissas

- O valor de `title` vem de `statusText` (já existente em `HTTPError`). Quando ausente, usa o texto padrão do status HTTP. Assim não há novo nome público.
- O valor de `detail` vem de `message`, que já existe.
- `type` ausente vira `"about:blank"`, conforme a RFC 9457.
- O cabeçalho é `application/problem+json`. Não há necessidade de charset adicional além do padrão do JSON.
- Os campos atuais permanecem como membros de extensão, o que atende ao "não quebrar o que já existe" do contrato.
- A mudança vale para os runtimes atendidos pelo `describeMatrix` (web e node), sem comportamento específico de runtime.

## Riscos

- **Tensão no contrato:** o pedido diz que o novo formato "substitui" o atual e, ao mesmo tempo, pede para "não quebrar o que já existe". A RF-04 resolve isso mantendo os campos antigos. Ainda assim, a troca do `Content-Type` e a presença de novos membros são mudanças visíveis para clientes que validam o formato de forma estrita. Vale confirmar com o responsável se essa mudança é aceitável como padrão, ou se deveria ser uma release major.
- **Clientes com verificação estrita:** consumidores que checam `application/json` no `Content-Type` deixam de reconhecer o erro. Mitigação: documentar a mudança no changelog.
- **Erros repassados de upstream:** `proxy` e os handlers de `rules` podem repassar corpos de erro de outros serviços. Eles não entram na conversão automática, e isso precisa ser verificado durante a implementação.
- **Ocultação de erros não tratados:** qualquer mudança no `toJSON` pode vazar mensagens internas se a máscara não for preservada. A RF-05 e o teste correspondente existem para cobrir esse caso.
- **Testes com asserções de formato exato:** a alteração pode quebrar muitos testes do matrix. A RF-07 limita o ajuste ao mínimo, mas o volume de ajustes ainda é incerto.
