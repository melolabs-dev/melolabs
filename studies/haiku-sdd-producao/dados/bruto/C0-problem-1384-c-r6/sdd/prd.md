# PRD — Problem details (RFC 9457) via utilitário `problem()`

Origem: issue h3js/h3#1384, contrato enxuto #1384-C (`sdd/pedido.md`).

## 1. Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio (`status`, `statusText`, `message`, `data`, ...`body`) e `content-type: application/json`. Esse formato não é o padrão da RFC 9457 (Problem Details for HTTP APIs), que clientes, gateways e ferramentas de API já entendem (`application/problem+json`, campos `type`, `title`, `status`, `detail`, `instance`). Quem precisa dessa conformidade não tem um caminho suportado para isso.

### Objetivo

Oferecer a função pública `problem(input)`, exportada por `h3`, que devolve um `HTTPError` cuja resposta segue a RFC 9457 em JSON. O formato é **opt-in**: só as respostas de erros criados por `problem()` mudam; todo o resto do comportamento de erros permanece idêntico.

### Métricas de sucesso

- Um handler que faz `throw problem({...})` produz uma resposta `application/problem+json` válida pela RFC 9457.
- Nenhuma resposta de erro que não use `problem()` muda (byte a byte).
- `pnpm test`, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Exportação de `problem` e do tipo de entrada

`problem(input)` é exportada do pacote `h3` (via `src/index.ts`) e retorna uma instância de `HTTPError`. O tipo da entrada também é exportado. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** que importo `problem` de `h3`
- **Quando** chamo `problem({ status: 404 })`
- **Então** recebo um objeto para o qual `HTTPError.isError(...)` é verdadeiro, com `status === 404`, e o conjunto de exports públicos de `h3` ganhou apenas `problem` e o tipo de entrada.

### RF-02 — Campos de entrada

`input` aceita todos os campos do objeto de entrada de `HTTPError` (`ErrorInput`: `status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, etc.) e, adicionalmente, os opcionais `type` (string, URI de referência) e `instance` (string, URI de referência).

**Critério de aceite**

- **Dado** uma chamada `problem({ status: 403, message: "x", data: {a: 1}, type: "https://ex.com/p", instance: "/contas/1", headers: { "x-id": "1" } })`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** a chamada é aceita sem erro de tipo, e um campo desconhecido fora de `ErrorInput`/`type`/`instance` continua sendo rejeitado pelo tipo.

### RF-03 — Content-Type da resposta

A resposta de um erro criado por `problem()` usa `content-type: application/problem+json` (com charset UTF-8, coerente com o restante do h3).

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 400 })`
- **Quando** o cliente faz a requisição
- **Então** o status é 400 e o cabeçalho `content-type` começa com `application/problem+json`.

### RF-04 — Corpo no formato da RFC 9457

O corpo JSON contém os membros padrão: `type` (padrão `"about:blank"` quando não informado), `title`, `status` (igual ao status HTTP), `detail` e `instance` (apenas se informado). `title` vem de `statusText` quando definido; senão, do texto padrão do status HTTP. `detail` vem de `message` quando este foi informado explicitamente. O corpo **não** contém os campos próprios do formato atual (`statusText`, `message`, `unhandled`, `data` como chave de topo, `stack` fora de debug).

**Critério de aceite**

- **Dado** `throw problem({ status: 404, statusText: "Not Found", message: "Usuário 7 não existe", type: "https://ex.com/erros/nao-encontrado", instance: "/usuarios/7" })`
- **Quando** o cliente lê o corpo JSON
- **Então** ele é igual a `{ "type": "https://ex.com/erros/nao-encontrado", "title": "Not Found", "status": 404, "detail": "Usuário 7 não existe", "instance": "/usuarios/7" }`.

### RF-05 — Valores padrão

Sem `type`, o corpo traz `type: "about:blank"`; sem `instance`, o membro é omitido; sem `message` explícito, `detail` é omitido; sem `statusText`, `title` usa a frase padrão do status.

**Critério de aceite**

- **Dado** `throw problem({ status: 404 })`
- **Quando** o cliente lê o corpo JSON
- **Então** ele é `{ "type": "about:blank", "title": "Not Found", "status": 404 }`, sem `detail` nem `instance`.

### RF-06 — Membros de extensão

Propriedades de `body` (extensões, conforme a RFC) aparecem no nível superior do corpo. Membros padrão (`type`, `title`, `status`, `detail`, `instance`) nunca são sobrescritos por `body`. `data`, se informado, aparece como membro de extensão `data`.

**Critério de aceite**

- **Dado** `throw problem({ status: 422, body: { saldo: 30, status: 200 }, data: { campo: "valor" } })`
- **Quando** o cliente lê o corpo JSON
- **Então** `saldo === 30`, `data` é `{ "campo": "valor" }` e `status === 422` (não 200).

### RF-07 — Cabeçalhos customizados

`headers` informados em `problem()` são enviados na resposta e mesclados com o content-type de problem details; o usuário não consegue, por acidente, voltar o content-type para `application/json` apenas por omissão — mas um `content-type` explícito em `headers` é respeitado.

**Critério de aceite**

- **Dado** `throw problem({ status: 429, headers: { "retry-after": "10" } })`
- **Quando** o cliente faz a requisição
- **Então** a resposta tem `retry-after: 10` e `content-type` começando com `application/problem+json`.

### RF-08 — Funciona ao lançar e ao retornar

O erro de `problem()` produz a mesma resposta tanto com `throw problem(...)` quanto com `return problem(...)` no handler, em middleware e no `onError`.

**Critério de aceite**

- **Dado** duas rotas, uma com `throw problem({ status: 409 })` e outra com `return problem({ status: 409 })`
- **Quando** o cliente chama ambas (em modo `web` e `node`)
- **Então** as duas respostas têm status 409, o mesmo `content-type` e o mesmo corpo.

### RF-09 — Erros comuns permanecem inalterados

Erros que não vêm de `problem()` (`new HTTPError(...)`, `HTTPError.status(...)`, `Error` genérico, 404 de rota, erros de validação) continuam usando o formato e o content-type atuais.

**Critério de aceite**

- **Dado** uma rota que faz `throw new HTTPError({ status: 400, message: "ruim" })`
- **Quando** o cliente faz a requisição
- **Então** o `content-type` é `application/json;charset=UTF-8` e o corpo é o mesmo de antes da mudança (`status`, `message`, etc.).

### RF-10 — Modo debug e erros não tratados

Em modo debug, o corpo de problem details pode incluir `stack` como membro de extensão; fora de debug, nunca inclui stack. Um `problem()` com `unhandled: true` não vaza `message`, `data`, `body` nem `cause`: `detail` e extensões são omitidos.

**Critério de aceite**

- **Dado** `throw problem({ status: 500, message: "segredo", data: { k: 1 }, unhandled: true })` com debug desligado
- **Quando** o cliente lê o corpo
- **Então** o corpo não contém "segredo", `data` nem `stack`, e mantém `status: 500`.

### RF-11 — `toJSON()` e compatibilidade de tipos

`HTTPError.toJSON()` de erros existentes não muda. Para erros de `problem()`, `toJSON()` reflete o corpo de problem details (consistente com o que é enviado). Os tipos existentes (`ErrorInput`, `ErrorBody`, `HTTPError`) permanecem compatíveis: código TypeScript atual continua compilando.

**Critério de aceite**

- **Dado** a suíte de testes e tipos existente (`test/unit/types.test-d.ts` incluído)
- **Quando** rodo `pnpm test`, `pnpm lint` e `pnpm typecheck`
- **Então** todos passam, e novos testes cobrem RF-01 a RF-10 usando `describeMatrix` (modos `web` e `node`).

## 3. Fora de escopo

- Ativar problem details globalmente ou por configuração (ex.: opção em `H3Config`, negociação via `Accept`, hook/plugin que converte todos os erros).
- Representação XML (`application/problem+xml`) da RFC 9457.
- Registro/catálogo de tipos de problema, geração de URIs de `type` ou páginas de documentação por tipo.
- Alteração de validação (`defineValidatedHandler`, `readValidatedBody`), sessão, CORS, proxy ou rotas de rules para usar problem details.
- Novos nomes públicos além de `problem` e do tipo de entrada (sem classe nova, sem helpers extras).
- Mudanças no código de nitro ou em outros pacotes; alterações de documentação além do necessário (decisão posterior).
- Mudança de comportamento de `HTTPError.isError`.

## 4. Premissas e riscos

### Premissas

- `problem()` é uma função fina sobre `HTTPError`: devolve uma instância de `HTTPError` marcada internamente (propriedade privada com prefixo `~`, conforme as convenções) para que a serialização escolha o formato; a marca não é pública nem enumerável.
- Mapeamento: `statusText` → `title`; `message` → `detail`; `body` e `data` → extensões; `type` padrão `"about:blank"` (RFC 9457 §4.2.1).
- Vale a convenção do projeto: ESM, imports com extensão `.ts`, arquivos curtos, `isolatedDeclarations` (tipos de retorno explícitos), testes com `describeMatrix`.
- O texto padrão de `title` usa a frase HTTP padrão do status; se o runtime/utilitário atual não tiver tabela disponível, usar `statusText` quando existir e, sem ele, omitir ou definir o fallback na fase de design (decisão a registrar).
- Fluxo de bug/feature: escrever testes primeiro, ver falhar, implementar, rodar a suíte completa.

### Riscos

- **Regressão no formato atual**: `errorResponse` (`src/response.ts`) e `toJSON()` são compartilhados; a mudança deve ser um ramo isolado para erros de `problem()`. Mitigação: RF-09 e a suíte existente.
- **Vazamento de dados em erros não tratados**: reaproveitar a lógica `unhandled` ao montar o corpo (RF-10).
- **Conflito de cabeçalhos**: `errorResponse` mescla `jsonHeaders` com `error.headers`; é preciso garantir a ordem para que `application/problem+json` prevaleça sobre o padrão sem ignorar um `content-type` explícito (RF-07).
- **Colisão entre extensões e membros padrão** vindas de `body` (RF-06) — precedência definida: membros padrão vencem.
- **Testes existentes dependentes**: nenhum deve mudar por padrão (opt-in); se algum mudar, ajustar sem perder a verificação original.
- **Pontos de saída diferentes** (`toResponse`, `onError`, adapters Node/web) podem tratar erros por caminhos distintos; cobrir com testes em `web` e `node` (RF-08).
- **Ambiguidade do pedido**: "só as respostas que usam o utilitário mudam" não define o que acontece com erros encadeados via `cause`; assume-se que `problem()` na `cause` não é propagado (apenas o erro retornado/lançado diretamente).
