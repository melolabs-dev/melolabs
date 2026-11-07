# PRD — Problem details (RFC 9457) via utilitário explícito `problem()`

Referências: issue h3js/h3#1384 e contrato `sdd/pedido.md` (#1384-C).

## Problema e objetivo

### Problema

Hoje o h3 responde erros sempre no mesmo formato JSON, produzido por `HTTPError.toJSON()` e `errorResponse()` em `src/response.ts`. Esse formato usa chaves próprias (`status`, `statusText`, `message`, `data`, `body`) e `Content-Type: application/json`. APIs que seguem a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) esperam `application/problem+json` com os membros `type`, `title`, `status`, `detail` e `instance`. Hoje não há como um handler responder nesse formato sem montar a resposta à mão.

### Objetivo

Permitir que um handler responda erros no formato *problem details* chamando um utilitário explícito, `problem(input)`, exportado por `h3`. O utilitário devolve um `HTTPError`, então o fluxo de erro atual (`throw`, `onError`, `toResponse`) continua valendo. Só as respostas criadas com `problem()` mudam de formato. Erros existentes seguem idênticos.

## Requisitos funcionais

### RF-01 — Utilitário `problem()` exportado por `h3`

`problem(input)` é uma nova função exportada pelo pacote `h3` (`src/index.ts`) e devolve uma instância de `HTTPError`.

**Critério de aceite**

- **Dado** que o módulo `h3` é importado a partir do entry principal,
- **Quando** o código chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** o retorno é `instanceof HTTPError`, com `status` 404 e `message` "Usuário não encontrado".

### RF-02 — Entrada de `problem()` com `type` e `instance`

O objeto de entrada de `problem()` aceita os campos de entrada de `HTTPError` (`status`, `statusText`, `message`, `cause`, `data`, `body`, `headers`, `unhandled`) e, além deles, os campos opcionais `type` e `instance` da RFC 9457. O tipo dessa entrada é o único tipo público novo, junto com a função `problem`.

**Critério de aceite**

- **Dado** a entrada `{ status: 403, type: "https://exemplo.com/erros/sem-saldo", instance: "/pagamentos/42" }`,
- **Quando** `problem(entrada)` é chamado,
- **Então** o erro retornado mantém `type` e `instance` acessíveis e o `status` é 403.

### RF-03 — Resposta em `application/problem+json`

Quando um erro criado por `problem()` chega à resposta (lançado no handler ou repassado pelo `onError`), o corpo é JSON com os membros da RFC 9457 e o `Content-Type` é `application/problem+json`.

**Critério de aceite**

- **Dado** um handler que faz `throw problem({ status: 404, type: "https://exemplo.com/erros/nao-encontrado", message: "Recurso ausente", instance: "/itens/7" })`,
- **Quando** uma requisição `GET` chega a esse handler,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json` e corpo JSON com `type` "https://exemplo.com/erros/nao-encontrado", `status` 404, `detail` "Recurso ausente" e `instance` "/itens/7".

### RF-04 — Valores padrão de `type` e `title`

Quando `type` não é informado, a resposta usa `"about:blank"`, conforme a RFC 9457. O membro `title` vem do `statusText` do erro; se ele não existir, usa o texto padrão do status.

**Critério de aceite**

- **Dado** a entrada `problem({ status: 422, message: "Campo inválido" })` sem `type` nem `statusText`,
- **Quando** o erro é serializado como resposta,
- **Então** o corpo tem `type` igual a "about:blank", `title` igual ao texto padrão de 422 e `detail` igual a "Campo inválido".

### RF-05 — Membros de extensão

Os campos `data` e os membros de `body` do erro são incluídos no corpo do problem details como membros de extensão, no mesmo nível dos membros da RFC. Se um membro de extensão tiver o mesmo nome de um membro da RFC, o membro da RFC prevalece.

**Critério de aceite**

- **Dado** a entrada `problem({ status: 409, message: "Conflito", data: { campo: "email" }, body: { tentativas: 2 } })`,
- **Quando** o erro é serializado como resposta,
- **Então** o corpo contém `campo` dentro de `data` e o membro `tentativas` no nível raiz, além de `type`, `title`, `status` e `detail`.

### RF-06 — Cabeçalhos do erro são preservados

Cabeçalhos passados em `headers` da entrada (por exemplo `WWW-Authenticate` ou `Retry-After`) continuam na resposta, junto com `Content-Type` `application/problem+json`.

**Critério de aceite**

- **Dado** a entrada `problem({ status: 401, message: "Token expirado", headers: { "WWW-Authenticate": "Bearer" } })`,
- **Quando** o erro é serializado como resposta,
- **Então** a resposta tem o cabeçalho `WWW-Authenticate` com valor "Bearer" e `Content-Type` `application/problem+json`.

### RF-07 — Erros não tratados continuam ocultos

Quando `unhandled` é verdadeiro, o comportamento de ocultação de `HTTPError` se mantém: `message` vira "HTTPError" e `data`, `body` e `stack` não aparecem no corpo. O corpo continua em `application/problem+json` apenas com `type`, `title` e `status`, sem `detail` nem extensões.

**Critério de aceite**

- **Dado** a entrada `problem({ status: 500, message: "segredo do banco", data: { senha: "x" }, unhandled: true })`,
- **Quando** o erro é serializado como resposta,
- **Então** o corpo não contém "segredo do banco", `senha` nem `stack`, e contém `status` 500 e `title`.

### RF-08 — Erros existentes não mudam

Erros criados por `new HTTPError(...)`, `HTTPError.status(...)`, `createError` ou lançados internamente pelo h3 continuam com o formato atual (`application/json`, mesmas chaves). `HTTPError.prototype.toJSON()` não muda para esses erros.

**Critério de aceite**

- **Dado** o erro `new HTTPError({ status: 404, message: "não achei" })`,
- **Quando** ele é serializado como resposta,
- **Então** o `Content-Type` é `application/json` e o corpo tem as mesmas chaves de antes (`status`, `statusText`, `message`, `data`, `body` quando existirem).

### RF-09 — Modo debug mantém o stack

Com o modo debug ativo, o corpo em `application/problem+json` inclui `stack` da mesma forma que o formato atual, exceto quando `unhandled` é verdadeiro (RF-07).

**Critério de aceite**

- **Dado** que o modo debug está ativo e um erro `problem({ status: 400, message: "ruim" })` é lançado,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `stack` como lista de linhas e o `Content-Type` continua `application/problem+json`.

### RF-10 — Compatibilidade com a suíte existente

A suíte de testes existente continua passando. Testes existentes só são ajustados se dependerem do que esta mudança altera, e o que eles verificam é preservado.

**Critério de aceite**

- **Dado** a suíte de testes da branch antes da mudança,
- **Quando** `pnpm vitest run` é executado após a mudança,
- **Então** todos os testes passam e cada ajuste feito em um teste existente é justificado por RF-03 ou RF-05 e mantém a mesma verificação.

### RF-11 — Testes nos dois modos de runtime

Os testes novos de `problem()` usam `describeMatrix`, então rodam nos modos `web` e `node`.

**Critério de aceite**

- **Dado** um arquivo de teste novo para `problem()` que usa `describeMatrix`,
- **Quando** `pnpm vitest run` roda esse arquivo,
- **Então** cada caso passa nos dois alvos (`web` e `node`).

### RF-12 — Qualidade estática

A mudança não introduz erro de lint nem de tipagem.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos terminam sem erro.

## Fora de escopo

- Negociação de conteúdo por cabeçalho `Accept` (escolher entre JSON comum e problem+json conforme a requisição).
- Mudar o formato padrão de todos os erros do h3.
- Alterar `HTTPError.toJSON()` ou a forma pública de `HTTPError` para erros existentes.
- Validar que `type` é uma URI válida ou resolvível.
- Helpers adicionais além de `problem()` (por exemplo, parser de problem details no cliente ou tipos de problema pré-definidos).
- Integração com Nitro ou outros frameworks.
- Internacionalização dos textos de `title` e `detail`.
- Suporte a respostas em streaming ou eventos (SSE, WebSocket, JSON-RPC) com formato problem+json.
- Mudanças na documentação pública além do que for necessário para `problem()` (fica como tarefa separada).

## Premissas e riscos

### Premissas

- **Marcação interna do erro:** `problem()` marca o `HTTPError` com um marcador interno (símbolo `k`-prefixado, não exportado) para que a serialização saiba usar o formato problem+json. Isso não cria nome público novo.
- **Mapeamento de campos:** `message` vira `detail` e `statusText` vira `title`. Esse mapeamento é uma escolha desta especificação, pois a RFC não exige um campo específico para a mensagem.
- **`type` opcional com padrão:** quando omitido, `type` é "about:blank", como a RFC 9457 define.
- **Fluxo de erro intacto:** `onError`, `throw` e a conversão `toResponse` continuam os mesmos. Só a função que monta o corpo de `HTTPError` muda para erros marcados.
- **Sem nome novo além do previsto:** a única exportação pública nova é `problem`, mais o tipo da entrada, conforme `sdd/pedido.md`.

### Riscos

- **Colisão de nomes:** um membro de extensão (`data` ou `body`) com o mesmo nome de um membro da RFC (`type`, `title`, `status`, `detail`, `instance`) pode confundir o cliente. Mitigação: RF-05 define que o membro da RFC prevalece.
- **Vazamento de informação:** `detail` e os membros de extensão são públicos quando `unhandled` é falso. Mitigação: RF-07 e a documentação do uso.
- **Regressão em testes existentes:** mudanças em `src/response.ts` podem afetar snapshots ou asserções de cabeçalho. Mitigação: RF-08 e RF-10 exigem que o formato atual não mude.
- **Fluxos fora de `toResponse`:** caminhos como SSE, WebSocket ou JSON-RPC serializam erros por conta própria e não passam por `errorResponse`. Mitigação: estão fora de escopo; o comportamento deles não muda.
- **`type` inválido:** a entrada aceita qualquer string em `type`, o que pode gerar um problem details com `type` que não é URI. Mitigação: validação fica fora de escopo; a documentação deve recomendar URIs.
- **Tipagem:** a união `ErrorDetails` e a tipagem de `HTTPError` precisam aceitar `type` e `instance` sem quebrar chamadas existentes. Mitigação: RF-12 e os testes de tipo em `test/unit/`.
