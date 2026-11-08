# PRD — Problem details (RFC 9457) como formato padrão de erro no h3

Origem: `sdd/pedido.md` (contrato enxuto #1384-B, derivado da issue h3js/h3#1384).

## Problema e objetivo

### Problema

Hoje o h3 responde erros HTTP em um formato próprio, sem um padrão reconhecido por clientes genéricos. Quem consome a API precisa conhecer a forma específica do h3 para interpretar falhas, e a issue h3js/h3#1384 pede suporte à RFC 9457 (Problem Details for HTTP APIs).

### Objetivo

Fazer com que todas as respostas de erro do h3 sejam representadas como "problem details" (RFC 9457, representação JSON), sem nenhuma configuração adicional. O único novo nome público é a aceitação dos campos `type` e `instance` no construtor de `HTTPError`, expostos na instância.

## Requisitos funcionais

### RF-01 — Erros respondem em problem details por padrão

Toda resposta de erro gerada pelo h3 (`HTTPError`, erros lançados nos handlers e erros não tratados) passa a ter corpo JSON no formato problem details, com os membros `type`, `title`, `status`, `detail` e, quando houver, `instance`.

**Critério de aceite**

- **Dado** um app h3 com uma rota que lança `new HTTPError({ status: 404, message: "Usuário não encontrado" })`, sem nenhuma opção de configuração,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 404 e o corpo JSON contém `status: 404` e `detail: "Usuário não encontrado"`.

### RF-02 — Content-Type de problem details

Respostas de erro com corpo problem details são enviadas com `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma rota que lança qualquer `HTTPError`,
- **Quando** a resposta de erro é gerada,
- **Então** o header `Content-Type` é `application/problem+json`.

### RF-03 — Valores padrão dos membros

Quando o erro não informa os membros, o h3 preenche:

- `type` com `"about:blank"` (valor padrão da RFC 9457);
- `title` com a frase padrão do status HTTP (por exemplo, `"Not Found"` para 404), ou com o `statusText` informado no erro, se houver;
- `status` com o código HTTP da resposta;
- `detail` com a mensagem do erro, omitido quando vazio.

**Critério de aceite**

- **Dado** um `HTTPError` com status 500 e sem `type`, `title` ou `detail` explícitos,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo contém `type: "about:blank"`, `title: "Internal Server Error"` e `status: 500`, e não contém o membro `detail` quando a mensagem é vazia.

### RF-04 — `HTTPError` aceita `type` e `instance`

O objeto de entrada do construtor de `HTTPError` aceita os campos opcionais `type` e `instance` da RFC 9457. Ambos ficam disponíveis como propriedades da instância e são serializados no corpo.

**Critério de aceite**

- **Dado** `new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada e a resposta é gerada,
- **Então** `error.type` e `error.instance` retornam os valores informados, e o corpo da resposta contém ambos.

### RF-05 — Status HTTP e headers do erro são preservados

O código de status e os headers definidos no erro continuam sendo aplicados à resposta, como hoje. A mudança afeta apenas o corpo e o `Content-Type`.

**Critério de aceite**

- **Dado** um `HTTPError` com status 429 e o header `Retry-After: 30`,
- **Quando** a resposta é gerada,
- **Então** a resposta tem status 429 e o header `Retry-After: 30`, além do corpo problem details.

### RF-06 — Dados extras do erro

O campo `data` do erro, quando informado, é preservado no corpo como membro de extensão do problem details. Ele não sobrescreve `type`, `title`, `status`, `detail` nem `instance`; em caso de colisão de nomes, prevalecem os membros padrão.

**Critério de aceite**

- **Dado** um `HTTPError` com `status: 422` e `data: { campo: "email" }`,
- **Quando** a resposta é gerada,
- **Então** o corpo contém `campo: "email"` no nível raiz, junto com `status: 422`, `title` e `type`.

### RF-07 — Erros não tratados não expõem detalhes internos

Erros 5xx não tratados (lançados sem `HTTPError`) retornam problem details com `status: 500` e `title` padrão, sem expor a mensagem ou o stack do erro original no corpo.

**Critério de aceite**

- **Dado** um handler que lança `new Error("senha do banco incorreta")`,
- **Quando** a rota é chamada,
- **Então** a resposta tem status 500, o corpo não contém a string `"senha do banco incorreta"` e contém `title: "Internal Server Error"`.

### RF-08 — Respostas que não são erro permanecem inalteradas

Respostas de sucesso, redirecionamentos e demais respostas que não são erro continuam com o mesmo corpo e `Content-Type` de hoje.

**Critério de aceite**

- **Dado** uma rota que retorna `{ ok: true }`,
- **Quando** é chamada,
- **Então** a resposta tem `Content-Type: application/json` e corpo `{"ok":true}`, como antes.

### RF-09 — Nenhuma opção nova de configuração

Não há opção para desligar o formato, escolher outro formato ou alterar o padrão. Os únicos nomes públicos novos são os campos `type` e `instance` do construtor de `HTTPError`.

**Critério de aceite**

- **Dado** a lista de exports públicos de `h3` antes e depois da mudança,
- **Quando** as duas listas são comparadas,
- **Então** a única diferença é a aceitação dos campos `type` e `instance` em `HTTPError`; nenhum export novo aparece.

### RF-10 — Suíte existente e qualidade

A suíte de testes existente continua passando. Testes que verificam o formato antigo do corpo de erro são ajustados para o novo formato, mantendo o que verificam (status, headers e comportamento). `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** `pnpm vitest run`, `pnpm lint` e `pnpm typecheck` são executados,
- **Então** todos terminam sem falhas, e nenhum teste foi removido ou enfraquecido sem substituto equivalente.

## Fora de escopo

- Integração com `h3/nitro` (mencionada na issue, mas não no contrato).
- Opção de configuração para desligar ou trocar o formato de erro.
- Suporte a membros de extensão além de `data` (por exemplo, tipos de problema registrados ou catálogos de `type`).
- Localização (i18n) das mensagens de erro.
- Formato de erro do JSON-RPC (`utils/json-rpc.ts`) e de WebSocket.
- Alterações na API v1 (`_deprecated.ts`).
- Páginas HTML de erro.
- Implementação. Este documento é apenas o PRD; o código não é alterado nesta etapa.

## Premissas

- **P1 — "Padrão sem configuração" prevalece sobre "não quebrar"**: a mudança do corpo de erro é intencional e altera o contrato observável para clientes que lêem o formato atual. Entendo que "não quebrar o que já existe" se refere à API de código (nomes, assinaturas e comportamento de status), e não ao corpo de erro. Se a leitura for outra, o escopo muda e precisa de nova decisão.
- **P2 — Formato atual**: não verifiquei nesta etapa a forma exata do corpo de erro atual; os critérios de aceite descrevem o formato desejado, não a diferença campo a campo. A equivalência de campos deve ser confirmada na implementação.
- **P3 — `data` é preservado** como extensão (RF-06). O pedido não diz o que fazer com ele; essa é a escolha que menos quebra.
- **P4 — Content-Type**: o padrão `application/problem+json` é usado para respostas de erro, sem parâmetro de charset adicional além do que o h3 já aplica.
- **P5 — Escopo do `title`**: usa-se a frase padrão do status, sem catálogo próprio.

## Riscos

- **R1 — Quebra para clientes**: quem faz parse do corpo atual ou verifica `Content-Type: application/json` em erros deixa de funcionar. Mitigação: anunciar a mudança como breaking em release e documentar o novo formato.
- **R2 — Vazamento de detalhes internos**: a troca do formato pode expor mensagens que antes não iam ao corpo. Mitigação: RF-07 e teste dedicado.
- **R3 — Testes com snapshot do formato antigo**: muitos testes existentes podem falhar por mudança de forma, não de comportamento. Mitigação: ajustar com cuidado (RF-10), sem remover verificações.
- **R4 — Erros após início de stream**: quando a resposta já começou (SSE, streams), o corpo de erro não pode ser trocado. O comportamento atual nesse caso deve ser preservado; precisa ser validado na implementação.
- **R5 — Cache de respostas de erro**: `utils/cache.ts` e `rules/cache.ts` podem armazenar erros; o novo `Content-Type` deve ser respeitado pelo cache. Verificar na implementação.
- **R6 — Ambiguidade de `type`**: sem `type` explícito, o valor `"about:blank"` pode não ser útil para o cliente. Aceito como padrão da RFC.
