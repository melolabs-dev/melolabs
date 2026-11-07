# PRD — Problem details (RFC 9457) por utilitário explícito no h3

Referência: issue h3js/h3#1384 e contrato enxuto em `sdd/pedido.md` (#1384-C).

## Problema e objetivo

### Problema

O h3 responde erros sempre no seu formato próprio (`HTTPError` serializado como JSON com `message`, `data`, `body` etc.). Clientes de APIs que querem seguir a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (problem details for HTTP APIs) precisam de um formato padronizado, com `type`, `title`, `status`, `detail` e `instance`, e hoje não há um caminho oficial no h3 para produzi-lo.

Uma mudança global do formato de erro quebraria quem já depende da resposta atual. Por isso a solução precisa ser opt-in e local.

### Objetivo

Permitir que um handler responda um erro no formato problem details chamando um utilitário explícito, `problem(input)`, exportado pelo pacote `h3`. Só as respostas que usam esse utilitário mudam; todos os erros existentes continuam como estão.

## Requisitos funcionais

### RF-01 — Função `problem(input)` exportada pelo h3

A função `problem` é exportada pelo pacote `h3` e retorna uma instância de `HTTPError`, pronta para ser lançada ou retornada por um handler.

**Critério de aceite**

- **Dado** que o módulo `h3` é importado
- **Quando** o código chama `problem({ status: 404, message: "Usuário não encontrado" })`
- **Então** o resultado é uma instância de `HTTPError` com `status` 404 e `message` "Usuário não encontrado"

### RF-02 — Entrada aceita campos de `HTTPError` mais `type` e `instance`

O objeto `input` aceita todos os campos de entrada de `HTTPError` (`status`, `statusText`, `message`, `data`, `body`, `headers`, `cause`, `unhandled`) e, além deles, os campos opcionais `type` e `instance` da RFC 9457. O tipo da entrada é o único tipo público novo, junto com `problem`.

**Critério de aceite**

- **Dado** uma entrada com `type: "https://exemplo.com/erros/saldo"` e `instance: "/contas/42"`
- **Quando** o código chama `problem(entrada)`
- **Então** o erro resultante guarda esses dois valores, sem exigir campos que não foram informados

### RF-03 — Resposta em `application/problem+json`

Quando um erro criado por `problem` chega ao final do pipeline, a resposta usa o media type `application/problem+json` e um corpo JSON com os membros da RFC 9457.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 422, type: "https://exemplo.com/erros/validacao", message: "Campo inválido", instance: "/pedidos/7" })`
- **Quando** a requisição chega a esse handler
- **Então** a resposta tem status 422, `Content-Type` `application/problem+json` e corpo JSON com `type`, `title`, `status`, `detail` e `instance` com esses valores (ver premissa P2 para o mapeamento de `title` e `detail`)

### RF-04 — `type` padrão e membros de extensão

Quando `type` não é informado, o corpo usa `"about:blank"`, como manda a RFC 9457. Os campos `data` e `body` da entrada aparecem no corpo como membros de extensão de primeiro nível.

**Critério de aceite**

- **Dado** `problem({ status: 409, message: "Conflito", data: { campo: "email" } })` sem `type`
- **Quando** a resposta é gerada
- **Então** o corpo tem `"type": "about:blank"` e `"campo": "email"` no nível superior, sem um membro `data` aninhado

### RF-05 — Erros comuns não mudam

Erros criados com `new HTTPError(...)`, `createError` ou lançados pelo próprio h3 continuam respondendo no formato atual, com o mesmo `Content-Type` e o mesmo corpo de hoje.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 400, message: "Ruim" })`
- **Quando** a requisição é respondida
- **Então** o `Content-Type` e o corpo são idênticos ao comportamento anterior à mudança

### RF-06 — Erros não tratados continuam ocultos

Um erro produzido por `problem` mas marcado como `unhandled` não expõe `message`, `data` nem `body` na resposta, seguindo a regra já existente para erros não tratados.

**Critério de aceite**

- **Dado** `problem({ status: 500, unhandled: true, message: "segredo", data: { senha: "x" } })`
- **Quando** a resposta é gerada
- **Então** o corpo não contém "segredo" nem `senha`, e o status é 500

### RF-07 — Headers da entrada são aplicados à resposta

Os `headers` informados na entrada são enviados na resposta junto com o `Content-Type` de problem details.

**Critério de aceite**

- **Dado** `problem({ status: 429, message: "Devagar", headers: { "Retry-After": "30" } })`
- **Quando** a resposta é gerada
- **Então** a resposta tem o header `Retry-After: 30` e `Content-Type: application/problem+json`

### RF-08 — Compatibilidade e qualidade

A mudança não remove nem renomeia nada existente, não exige alteração de código dos usuários atuais e mantém a suíte de testes, `pnpm lint` e `pnpm typecheck` verdes. Os testes novos rodam nos modos `web` e `node` via `describeMatrix`.

**Critério de aceite**

- **Dado** a branch com a mudança aplicada
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` são executados
- **Então** os três passam, e os testes existentes só foram ajustados onde dependiam de um comportamento que a mudança altera de forma intencional

## Fora de escopo

- Mudar o formato padrão de erro do h3 ou fazer content negotiation pelo header `Accept`.
- Alterar a classe `HTTPError`, `createError` ou o contrato de `toResponse` além do necessário para reconhecer erros criados por `problem`.
- Criar um registro de `type` URIs, documentação de tipos de problema ou validação de que a URI aponta para algo real.
- Suporte a extensões de problem details além de `data` e `body` (por exemplo, validação de nomes de membros).
- Localização (i18n) das mensagens.
- Integração específica com Nitro (`h3/nitro`), citada na issue como trabalho futuro.
- Novos nomes públicos além de `problem` e do tipo da sua entrada.
- Atualização da documentação pública do site.

## Premissas

- **P1 — Erro como marcador.** Um `HTTPError` criado por `problem` precisa ser reconhecido por `toResponse` no momento de gerar a resposta. A premissa é que isso pode ser feito com uma marca interna no próprio erro (propriedade não enumerável ou símbolo `k`-prefixado), sem alterar a forma pública de `HTTPError`.
- **P2 — Mapeamento de campos.** A RFC pede `title` e `detail`; o h3 tem `statusText` e `message`. Assume-se `title` = `statusText` (ou o texto padrão do status, se ausente) e `detail` = `message`. Este mapeamento precisa de confirmação do dono do projeto.
- **P3 — Lançar ou retornar.** `problem` apenas constrói o erro. Quem decide lançar ou retornar é o handler, como já acontece com `HTTPError`.
- **P4 — Sanitização de status.** A validação do status (faixa 200–599) segue a mesma de `HTTPError`; não há validação extra específica da RFC.
- **P5 — Ambiente.** As dependências estão instaladas com `corepack enable && pnpm install`, e os comandos do `AGENTS.md` funcionam neste clone.

## Riscos

- **R1 — Vazamento de marcador.** Se a marca interna for copiada ao clonar ou serializar o erro, outro erro pode ganhar o formato problem por engano. Mitigação: teste explícito de que `new HTTPError` continua no formato antigo (RF-05).
- **R2 — Vazamento de dados em erros não tratados.** Um erro de problem details pode expor `data` ou `body` por engano. Mitigação: RF-06 com teste dedicado.
- **R3 — Mapeamento ambíguo.** Se P2 for rejeitado, o corpo muda e os testes de RF-03 precisam ser refeitos. Mitigação: confirmar P2 antes de implementar.
- **R4 — Crescimento de API.** Pedidos de novas opções (registro de types, `Accept`) podem surgir logo depois. Mitigação: manter a lista de fora de escopo como referência.
- **R5 — Conflito de nome.** O nome `problem` pode colidir com exports existentes ou com nomes usados por usuários. Mitigação: verificar exports atuais antes de implementar.
