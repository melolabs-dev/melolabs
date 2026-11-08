# PRD — Problem Details (RFC 9457) por opção de configuração (h3js/h3#1384, variante A)

## 1. Problema e objetivo

### Problema
Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, `unhandled` e propriedades de `body`), com `content-type: application/json`. Clientes e gateways que esperam o formato padronizado "problem details" da RFC 9457 (`application/problem+json`, com `type`, `title`, `status`, `detail`, `instance`) precisam converter o formato manualmente. A issue h3js/h3#1384 pede esse suporte.

### Objetivo
Permitir que uma aplicação h3 responda erros no formato RFC 9457 (representação JSON) ligando uma única opção, `problemDetails`, em `H3Config`. Sem a opção, o comportamento atual permanece idêntico. `HTTPError` passa a aceitar e expor os campos `type` e `instance`.

### Métricas de sucesso
- Com `problemDetails: true`, toda resposta de erro gerada pelo h3 usa `application/problem+json` e contém os membros obrigatórios da RFC.
- Com a opção desligada/ausente, nenhum teste existente precisa mudar por causa do formato do corpo ou do content-type.
- `pnpm lint`, `pnpm typecheck` e a suíte de testes passam.

## 2. Requisitos funcionais

### RF-01 — Opção `problemDetails` em `H3Config`
`H3Config` ganha a opção booleana opcional `problemDetails`, desligada por padrão, lida de `app.config` como as demais opções (por exemplo `debug`, `silent`). Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** uma aplicação criada sem `problemDetails` (ou com `problemDetails: false`)
- **Quando** um handler lança `new HTTPError({ status: 400, message: "ruim" })`
- **Então** a resposta mantém o formato atual: `content-type: application/json;charset=UTF-8` e o corpo com `status`, `message` etc., byte a byte igual ao de antes da mudança.

### RF-02 — Content-type `application/problem+json`
Com `problemDetails: true`, respostas de erro usam `content-type: application/problem+json` (com charset UTF-8, no mesmo estilo do cabeçalho JSON atual).

**Critério de aceite**
- **Dado** uma aplicação com `problemDetails: true`
- **Quando** um handler lança `HTTPError` com status 404
- **Então** a resposta tem status 404 e o cabeçalho `content-type` começa com `application/problem+json`.

### RF-03 — Corpo com membros padrão da RFC 9457
Com a opção ligada, o corpo JSON contém: `type` (URI; padrão `"about:blank"` quando o erro não informa), `title` (resumo curto: `statusText` do erro, ou a frase padrão do status HTTP quando ausente), `status` (igual ao status HTTP da resposta), `detail` (a `message` do erro) e `instance` (somente quando informado).

**Critério de aceite**
- **Dado** `problemDetails: true`
- **Quando** um handler lança `new HTTPError({ status: 422, statusText: "Entidade inválida", message: "campo x ausente" })`
- **Então** o corpo é `{ "type": "about:blank", "title": "Entidade inválida", "status": 422, "detail": "campo x ausente" }`, sem a chave `instance` e sem `statusText`/`message`/`unhandled` na raiz.

### RF-04 — Campos `type` e `instance` em `HTTPError`
O objeto de entrada do construtor de `HTTPError` (e, por consequência, `HTTPError.status(...)` via `details`) aceita os campos opcionais `type` e `instance`, expostos como propriedades somente leitura da instância. O valor também é lido de `cause`, como já ocorre com `status` e `headers`. O formato antigo (opção desligada) não inclui esses campos no corpo.

**Critério de aceite**
- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`
- **Quando** se lê `error.type` e `error.instance`
- **Então** retornam exatamente esses valores; e, com `problemDetails: true`, o corpo da resposta traz `type` e `instance` com esses valores.

### RF-05 — Membros de extensão (`data` e `body`)
Com a opção ligada, `body` do erro é espalhado como membros de extensão na raiz do objeto, e `data` (quando definido) vai sob a chave `data`. Membros de extensão não podem sobrescrever `type`, `title`, `status`, `detail` nem `instance`.

**Critério de aceite**
- **Dado** `problemDetails: true`
- **Quando** um handler lança `new HTTPError({ status: 400, message: "m", data: { campo: "x" }, body: { codigo: "E1", status: 999 } })`
- **Então** o corpo contém `codigo: "E1"` e `data: { campo: "x" }`, e `status` continua `400`.

### RF-06 — Erros não tratados não vazam detalhes
Para erros não tratados (`unhandled`), o formato problem details mantém a proteção atual: `detail`, `data` e `body` não expõem a mensagem original nem dados internos.

**Critério de aceite**
- **Dado** `problemDetails: true` e `debug` desligado
- **Quando** um handler lança `new Error("segredo interno")`
- **Então** a resposta é 500 com `content-type: application/problem+json`, e o corpo não contém o texto `segredo interno` nem `data`/`body` do erro.

### RF-07 — Interação com `debug`, cabeçalhos e `onError`
- `debug: true` continua adicionando `stack` (e a indentação do JSON) ao corpo, também no formato problem details.
- `error.headers` e cabeçalhos de erro de `event.res` continuam sendo mesclados; um `content-type` definido explicitamente no erro prevalece sobre o padrão, como hoje.
- `onError`, quando configurado, continua recebendo o `HTTPError`; o formato só se aplica à renderização padrão do erro (quando `onError` não devolve outra resposta).

**Critério de aceite**
- **Dado** `problemDetails: true` e `debug: true`
- **Quando** um handler lança um `HTTPError` com `headers: { "x-id": "1" }`
- **Então** a resposta tem `x-id: 1`, `content-type` `application/problem+json` e o corpo inclui `stack` como lista de linhas.

### RF-08 — Rota inexistente e demais erros gerados pelo framework
Com a opção ligada, o 404 gerado pelo próprio h3 (sem rota correspondente) e qualquer erro criado internamente como `HTTPError` seguem o mesmo formato.

**Critério de aceite**
- **Dado** `problemDetails: true` e nenhuma rota registrada para `/nada`
- **Quando** se faz `GET /nada`
- **Então** a resposta é 404 com `content-type: application/problem+json` e `detail` contendo `Cannot find any route matching`.

### RF-09 — Compatibilidade e qualidade
A mudança não quebra a API existente; testes novos cobrem RF-01 a RF-08 (usando `describeMatrix`, em modo `web` e `node`), seguindo o fluxo de correção do AGENTS.md (teste de regressão primeiro). Testes existentes só são ajustados se dependerem de algo que a mudança altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** se executam `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`
- **Então** os três terminam sem falhas.

## 3. Fora de escopo
- Representação XML (`application/problem+xml`) e negociação de conteúdo via `Accept`.
- Ligar o formato por rota, por handler ou por cabeçalho da requisição; só a opção global de `H3Config`.
- Novas funções, classes, utilitários ou exports públicos além da opção `problemDetails` e dos campos `type`/`instance`.
- Validação ou resolução do URI de `type`/`instance` (são repassados como informados).
- Mudar o formato padrão (opção desligada) ou torná-lo ligado por padrão.
- Formato de erro em JSON-RPC, WebSocket e SSE; integração com Nitro; documentação além de comentários JSDoc e do guia existente, se aplicável.
- Mapa de URIs de `type` por status ou internacionalização de `title`.

## 4. Premissas e riscos

### Premissas
- O ponto único de renderização de erros é `errorResponse` em `src/response.ts`, chamado por `prepareResponse` a partir de `config`; a opção chega por `app.config`.
- `title` usa `statusText` do erro; na ausência, a frase padrão do status. Para isso é aceitável usar uma tabela de frases interna, sem novo export público.
- `type` ausente vira `"about:blank"`, conforme a RFC 9457 (seção 4.2.1).
- `HTTPError.toJSON()` pode permanecer inalterado para o formato antigo; a adaptação ao novo formato ocorre na renderização.

### Riscos
- **Quebra de compatibilidade silenciosa:** alterar `toJSON()` ou os cabeçalhos padrão afetaria consumidores atuais (inclusive JSON-RPC, que usa `HTTPError.toJSON()`). Mitigação: manter `toJSON()` e isolar o novo formato atrás da opção; teste de regressão em RF-01.
- **Vazamento de informação:** `detail` pode expor mensagens internas de erros não tratados. Mitigação: RF-06 e teste dedicado.
- **Colisão de chaves de extensão** com membros padrão. Mitigação: RF-05, membros padrão têm precedência.
- **Conflito de cabeçalhos:** `content-type` definido pelo usuário vs. padrão. Mitigação: manter a regra de mesclagem atual (RF-07).
- **`type`/`instance` ambíguos em `HTTPError`:** nomes comuns podem colidir com propriedades de `body` de usuários. Mitigação: campos explícitos têm precedência sobre `body` apenas no formato novo; formato antigo não muda.
- **Divergência entre runtimes:** diferenças entre `web` e `node` no tratamento de cabeçalhos. Mitigação: testes em `describeMatrix`.
