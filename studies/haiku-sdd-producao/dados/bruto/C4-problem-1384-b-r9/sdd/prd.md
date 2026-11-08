# PRD — Erros em formato problem details (RFC 9457)

Referência: issue h3js/h3#1384 e contrato enxuto #1384-B (`sdd/pedido.md`).

## Problema e objetivo

### Problema

Hoje o h3 responde erros com um JSON próprio, montado por `HTTPError.toJSON()` em `src/error.ts`, com os campos `status`, `statusText`, `unhandled`, `message`, `data` e os campos de `body`. Esse formato não segue um padrão, e o `Content-Type` é o de JSON comum. Clientes que querem tratar erros de forma uniforme entre APIs precisam de um código específico para o h3.

### Objetivo

Fazer com que todas as respostas de erro do h3 usem o formato "problem details" da RFC 9457 (`application/problem+json`), sem configuração nova. A forma de criar erros continua a mesma: `HTTPError` passa a aceitar e expor os campos opcionais `type` e `instance` da RFC.

Restrição de compatibilidade: o formato atual não pode desaparecer de uma vez. Os campos que já existem continuam no corpo como extensões da RFC, para que quem lê `message` ou `data` não quebre.

## Requisitos funcionais

### RF-01 — Content-Type de erro como problem+json

Toda resposta de erro gerada pelo h3 (um `HTTPError`, um erro não tratado ou um valor de erro convertido por `toResponse`) tem o cabeçalho `Content-Type: application/problem+json`.

**Critério de aceite**

- **Dado** uma rota que lança `new HTTPError({ status: 404 })`,
- **Quando** a requisição chega a essa rota,
- **Então** a resposta tem status 404 e `Content-Type` igual a `application/problem+json`.

### RF-02 — Membros padrão da RFC 9457 no corpo

O corpo do erro contém `type` (padrão `"about:blank"`), `title` (o `statusText` do erro ou, se ausente, a frase padrão do status), `status` (o código HTTP) e `detail` (a mensagem do erro).

**Critério de aceite**

- **Dado** uma rota que lança `new HTTPError("Usuário não encontrado", { status: 404, statusText: "Not Found" })`,
- **Quando** a requisição chega a essa rota,
- **Então** o JSON da resposta tem `type` igual a `"about:blank"`, `title` igual a `"Not Found"`, `status` igual a `404` e `detail` igual a `"Usuário não encontrado"`.

### RF-03 — Campos `type` e `instance` em HTTPError

`HTTPError` aceita, no objeto de entrada do construtor (`ErrorInput`), os campos opcionais `type` e `instance`, e os expõe como propriedades da instância. Quando `type` é informado, ele substitui `"about:blank"` no corpo. Quando `instance` é informado, ele aparece no corpo; quando não é informado, o campo não aparece.

**Critério de aceite**

- **Dado** `const err = new HTTPError({ status: 403, type: "https://exemplo.com/erros/sem-permissao", instance: "/pedidos/42" })`,
- **Quando** a instância é inspecionada e serializada,
- **Então** `err.type` é `"https://exemplo.com/erros/sem-permissao"`, `err.instance` é `"/pedidos/42"` e o JSON contém ambos os valores com os mesmos nomes.

### RF-04 — Campos legados preservados como extensões

O corpo continua incluindo `message`, `data`, `unhandled` e os campos de `body` (espalhados no nível superior), como já ocorre hoje. A RFC 9457 permite membros de extensão. Nenhum desses nomes é removido nem renomeado.

**Critério de aceite**

- **Dado** um erro criado com `{ status: 400, message: "inválido", data: { campo: "email" }, body: { codigo: "E01" } }`,
- **Quando** o erro é serializado,
- **Então** o JSON contém `message` igual a `"inválido"`, `data` com `{ campo: "email" }` e `codigo` igual a `"E01"`, além dos membros da RFC 9457.

### RF-05 — Erros não tratados continuam ocultos

Quando o erro tem `unhandled: true`, o corpo não expõe o texto original nem `data`. O `detail` e o `message` aparecem como `"HTTPError"`, e `data` é omitido, como acontece hoje. A pilha de execução nunca entra no corpo.

**Critério de aceite**

- **Dado** um erro não tratado criado a partir de `new Error("segredo do banco")`,
- **Quando** a resposta de erro é gerada,
- **Então** o corpo não contém a string `"segredo do banco"`, `detail` e `message` valem `"HTTPError"`, e `data` não aparece.

### RF-06 — Erros que não são HTTPError

Um erro comum lançado por um handler (sem ser `HTTPError`) gera uma resposta 500 no mesmo formato problem+json, sem vazar a mensagem original, como acontece hoje com erros não tratados.

**Critério de aceite**

- **Dado** uma rota que lança `new TypeError("x is undefined")`,
- **Quando** a requisição chega a essa rota,
- **Então** a resposta tem status 500, `Content-Type` igual a `application/problem+json` e o corpo não contém `"x is undefined"`.

### RF-07 — Headers do erro são preservados

Os headers passados em `HTTPError` (campo `headers`) continuam sendo enviados na resposta, junto com o `Content-Type` da RFC. O header `Content-Type` passado pelo usuário, se existir, não é sobrescrito de forma silenciosa; a regra adotada fica documentada no design.

**Critério de aceite**

- **Dado** um erro criado com `headers: { "Retry-After": "120" }`,
- **Quando** a resposta de erro é gerada,
- **Então** a resposta tem o header `Retry-After` igual a `"120"` e `Content-Type` igual a `application/problem+json`.

### RF-08 — Nenhuma opção ou nome público novo

A mudança não adiciona opção de configuração, gatilho, nem nome exportado além dos campos `type` e `instance` de `HTTPError`.

**Critério de aceite**

- **Dado** a API pública exportada por `src/index.ts` antes e depois da mudança,
- **Quando** as duas listas são comparadas,
- **Então** a única diferença é a ausência de novos símbolos exportados, e os campos novos de `HTTPError` são os únicos acréscimos.

### RF-09 — Suíte existente e qualidade

A suíte de testes existente passa. Testes que verificam o formato antigo do `Content-Type` ou do corpo são ajustados somente nos pontos que a mudança altera, sem perder o que verificam. Os testes novos cobrem RF-01 a RF-07 nos dois modos (web e node) com `describeMatrix`.

**Critério de aceite**

- **Dado** o código com a mudança aplicada,
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/errors.test.ts` são executados,
- **Então** os três terminam sem falhas.

## Fora de escopo

- Negociação de conteúdo por `Accept` (responder JSON simples a clientes que não aceitam problem+json). O formato é fixo para todas as respostas de erro.
- Tipos de problema registrados pelo projeto (URIs de `type` com documentação própria).
- Remoção dos campos legados (`message`, `data`, `unhandled`, campos de `body`). Isso fica para uma versão futura, com aviso de depreciação.
- Suporte à extensão de validação da RFC 9457 para listas de erros de campo (`errors` em JSON Schema). Nada muda nesse aspecto.
- Mudanças no pacote `h3/rules`, no `ocache` e no `proxy`, exceto o que o formato de erro afetar sem alteração de código nesses módulos.
- Alterações na documentação de usuário em `docs/` além de uma nota sobre o novo formato, se necessária.
- Publicação de pacote ou release.

## Premissas

- O código de erro é gerado hoje em `HTTPError.toJSON()` (`src/error.ts`) e na conversão de respostas (`toResponse`). Essa é a fonte única para mudar o formato.
- `statusText` é o melhor candidato para `title`. Quando ausente, a frase padrão do status é usada.
- `detail` recebe o mesmo texto de `message`. Os dois coexistem por compatibilidade.
- A RFC 9457 permite membros de extensão, então manter `message`, `data` e `body` não viola o formato.
- Os testes de `test/errors.test.ts` e os que checam corpo de erro são o conjunto a ajustar.

## Riscos

1. **Conflito entre pedido e restrição.** O contrato pede que o problem+json seja o formato padrão sem configuração, e também pede "não quebrar o que já existe". Trocar o `Content-Type` e adicionar campos é uma mudança de comportamento observável. Clientes que comparam `Content-Type` com `application/json` podem quebrar. **Decisão a confirmar:** esta PRD assume que a mudança de formato é aceita e que a compatibilidade está nos campos legados (RF-04), não no `Content-Type`. Se a intenção for não mudar o `Content-Type` para clientes existentes, o requisito RF-01 precisa de nova definição.
2. **Versão.** Mudar o `Content-Type` padrão é uma mudança que pode justificar versão maior. Precisa ser decidido antes da implementação.
3. **Duplicação de `message` e `detail`.** O corpo fica com dois campos de mensagem. Pode confundir quem lê a documentação. Mitigação: documentar que `detail` é o campo padrão e `message` é legado.
4. **Vazamento em erros não tratados.** Se o novo formato incluir `title` ou `detail` derivados de erros não tratados, pode haver vazamento. RF-05 e RF-06 existem para evitar isso e precisam de teste de regressão.
5. **Quebra em `h3/rules` e nos exemplos.** Consumidores que dependem do corpo exato podem falhar. A suíte e `examples/errors.mjs` precisam ser verificados.
