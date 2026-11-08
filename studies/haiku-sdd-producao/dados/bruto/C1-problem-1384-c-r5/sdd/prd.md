# PRD — Problem details (RFC 9457) por utilitário explícito

Base: `sdd/pedido.md` (issue h3js/h3#1384, contrato #1384-C).

## Problema e objetivo

**Problema.** Hoje o `HTTPError` só é serializado no formato próprio do h3, definido em `toJSON()` (`src/error.ts`): `status`, `statusText`, `unhandled`, `message`, `data` e `body`, sempre com `Content-Type` JSON comum. Clientes que esperam a norma RFC 9457 (`application/problem+json`) não recebem erros nesse formato, a menos que cada handler monte a resposta à mão. A issue #1384 pede suporte a essa norma.

**Objetivo.** Permitir que um handler responda erro no formato RFC 9457 chamando um utilitário explícito, `problem(input)`, exportado por `h3`, que devolve um `HTTPError`. Só as respostas criadas com esse utilitário mudam de formato. O comportamento atual de `HTTPError` permanece igual.

## Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado

`h3` exporta a função `problem(input)`, que devolve uma instância de `HTTPError`. Além de `problem` e do tipo da sua entrada (RF-02), nenhum outro nome público novo é adicionado.

**Critério de aceite**

- **Dado** que um consumidor importa `problem` de `h3`,
- **Quando** chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** recebe uma instância de `HTTPError` com `status` 404 e `message` "Usuário não encontrado".

### RF-02 — Entrada com campos de RFC 9457

A entrada de `problem` aceita os campos de `ErrorInput` e, além deles, os campos opcionais `type` e `instance` da RFC 9457. O tipo dessa entrada é exportado.

**Critério de aceite**

- **Dado** a chamada `problem({ status: 422, message: "Dados inválidos", type: "https://exemplo.com/erros/validacao", instance: "/pedidos/12" })`,
- **Quando** o erro é criado,
- **Então** `type` e `instance` ficam preservados no erro, e a tipagem da entrada aceita esses dois campos como opcionais.

### RF-03 — Resposta em `application/problem+json`

Um erro criado por `problem` é respondido com o status HTTP informado, `Content-Type: application/problem+json` e um corpo JSON com `type`, `title`, `status`, `detail` e `instance`. O `detail` vem de `message`. O `title` vem de `statusText`, ou da frase padrão do status quando `statusText` não foi informado. O `type` vem da entrada, ou é `"about:blank"` quando ausente. O `instance` aparece só quando informado.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 404, statusText: "Not Found", message: "Usuário não encontrado", instance: "/usuarios/7" })`,
- **Quando** a requisição é respondida,
- **Então** a resposta tem status 404, `Content-Type` `application/problem+json`, e o corpo contém `type: "about:blank"`, `title: "Not Found"`, `status: 404`, `detail: "Usuário não encontrado"` e `instance: "/usuarios/7"`.

### RF-04 — Extensões no corpo problem+json

Os campos de `data` e de `body` do erro entram no corpo como membros de extensão (RFC 9457, seção 3.2). `body` é espalhado no nível superior. `data` continua como membro `data`. Nenhum membro de extensão pode sobrescrever `type`, `title`, `status`, `detail` ou `instance`.

**Critério de aceite**

- **Dado** `problem({ status: 409, message: "Conflito", data: { campo: "email" }, body: { codigo: "X1" } })`,
- **Quando** a resposta é serializada,
- **Então** o corpo contém `codigo: "X1"` e `data: { campo: "email" }` no nível superior, e `status` continua 409.

### RF-05 — Erro não tratado oculta detalhes

Quando `problem` recebe `unhandled: true`, o corpo segue a mesma regra de segurança de `HTTPError.toJSON()`. O `detail` vira o valor genérico `"HTTPError"`, e `data` e `body` são omitidos. O `status` é mantido.

**Critério de aceite**

- **Dado** `problem({ status: 500, message: "senha do banco vazou", data: { sql: "..." }, unhandled: true })`,
- **Quando** a resposta é serializada,
- **Então** o corpo não contém `data`, não contém a mensagem original, tem `detail: "HTTPError"` e `status: 500`.

### RF-06 — Headers do erro

Os `headers` informados em `problem` são aplicados à resposta. O `Content-Type` é sempre `application/problem+json`, mesmo que `headers` traga outro valor.

**Critério de aceite**

- **Dado** `problem({ status: 401, message: "Não autenticado", headers: { "WWW-Authenticate": "Bearer", "Content-Type": "text/plain" } })`,
- **Quando** a resposta é criada,
- **Então** a resposta tem o header `WWW-Authenticate: Bearer` e `Content-Type: application/problem+json`.

### RF-07 — Erros comuns mantêm o formato atual

Um `HTTPError` criado sem `problem`, por `new HTTPError(...)` ou `HTTPError.status(...)`, continua com o formato JSON atual e sem `Content-Type` `application/problem+json`.

**Critério de aceite**

- **Dado** um handler que lança `HTTPError.status(404, "Not Found", { message: "Não encontrado" })`,
- **Quando** a requisição é respondida,
- **Então** o `Content-Type` não é `application/problem+json` e o corpo tem o formato atual (`status`, `statusText`, `message`, `data`).

### RF-08 — Compatibilidade da suíte existente

Nenhuma API existente muda de comportamento. A suíte atual continua passando. Um teste existente só é ajustado quando depende diretamente de uma mudança feita aqui, e a verificação original é preservada no ajuste.

**Critério de aceite**

- **Dado** a suíte de testes do projeto antes da mudança,
- **Quando** `pnpm vitest run` roda após a implementação,
- **Então** todos os testes passam, e nenhum teste existente foi removido ou enfraquecido.

### RF-09 — Cobertura nos dois modos de execução

Os testes novos usam `describeMatrix`, para rodar nos modos `web` e `node`.

**Critério de aceite**

- **Dado** os testes de RF-03 a RF-06,
- **Quando** rodam com `pnpm vitest run`,
- **Então** cada caso passa nos dois modos (`web` e `node`).

### RF-10 — Qualidade estática

**Critério de aceite**

- **Dado** a implementação concluída,
- **Quando** `pnpm lint` roda,
- **Então** lint e typecheck passam sem erros.

## Fora de escopo

- Trocar o formato padrão de `HTTPError` ou de `toJSON()`.
- Conversão automática de todos os erros para problem+json, por middleware global ou pelo handler de erro padrão.
- Negociação de conteúdo por `Accept` (escolher o formato conforme o cliente pede).
- Registro ou documentação de URIs de `type`, e tipos de problema padronizados por aplicação.
- Tradução ou internacionalização de `title` e `detail`.
- Mudanças no pacote `nitro` ou em qualquer outro projeto que consome o h3.
- Novos nomes públicos além de `problem` e do tipo da entrada.

## Premissas

- O erro devolvido por `problem` continua sendo um `HTTPError`, para que `isError`, `status`, `headers` e os demais campos já usados pelo projeto funcionem sem mudança.
- A marca que identifica um erro criado por `problem` é interna (propriedade ou símbolo com prefixo `~` ou `k`, conforme a convenção do projeto), não uma nova API pública.
- O `status` segue a sanitização já existente em `HTTPError` (faixa 200–599).
- A ordem de precedência e o formato das respostas de erro são definidos pelo caminho de resposta de erro do h3, que deve ser lido antes da implementação para confirmar onde a marca é consultada.
- A RFC 9457 é a referência. A RFC 7807, que ela substitui, não é alvo separado.

## Riscos

- **Marca em `cause`.** Se um `problem` for passado como `cause` de um `HTTPError` comum, o formato pode mudar sem intenção. É preciso definir se a marca é herdada ou só vale no erro lançado diretamente. Isso afeta RF-07.
- **Mapeamento ambíguo.** `title`, `detail` e `type` têm regras próprias nesta PRD. Se o time preferir outra regra, RF-03 muda antes da implementação.
- **Testes existentes sobre o corpo de erro.** Algum teste pode comparar o JSON de erro em detalhes que a mudança toca. O ajuste deve ser mínimo e preservar a verificação (RF-08).
- **Conflito de `Content-Type`.** Um handler pode definir outro tipo em `headers`. RF-06 fixa a prioridade, mas é uma decisão que deve ser revisada.
- **Vazamento em erro não tratado.** Se a regra de RF-05 não for aplicada igual a `toJSON()`, detalhes internos podem sair na resposta. Esse é o risco de segurança mais importante.
- **Tamanho de arquivo.** `src/error.ts` já tem cerca de 240 linhas, acima da meta de 200 do projeto. A lógica nova deve ficar em um módulo próprio, por exemplo `src/utils/problem.ts`, ou em `utils/internal/`.
