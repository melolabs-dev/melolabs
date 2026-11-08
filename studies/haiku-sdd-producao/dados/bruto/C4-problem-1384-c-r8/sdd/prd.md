# PRD — Problem details (RFC 9457) por utilitário explícito

- Origem: issue h3js/h3#1384 e contrato enxuto #1384-C (`sdd/pedido.md`)
- Data: 2026-11-07
- Escopo: pacote `h3` (v2)

## Problema e objetivo

### Problema

Hoje o h3 responde erros como `HTTPError` no formato JSON próprio do framework (`status`, `statusText`, `message`, `data`, `body`). Clientes que esperam o formato padrão de erros HTTP da [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) (problem details) não conseguem consumir essas respostas sem adaptação. A issue #1384 pede suporte a esse formato.

Mudar o formato de erro de todo o framework quebraria aplicações existentes. Por isso, a abordagem escolhida é mais restrita.

### Objetivo

Permitir que um handler responda um erro no formato problem details (`application/problem+json`) chamando um utilitário explícito. Somente as respostas que usam esse utilitário mudam. Todo o resto do comportamento permanece igual.

## Requisitos funcionais

### RF-01 — Utilitário `problem(input)` exportado pelo `h3`

A função `problem(input)` deve ser exportada pelo pacote `h3` e retornar uma instância de `HTTPError`. Ela pode ser lançada (`throw`) ou retornada pelo handler.

**Critério de aceite**

- **Dado** que a aplicação importa `problem` de `h3`,
- **Quando** o código chama `problem({ status: 404, message: "Usuário não encontrado" })`,
- **Então** o valor retornado é uma instância de `HTTPError` com `status` igual a `404`.

### RF-02 — Entrada com campos de RFC 9457

O argumento `input` deve aceitar todos os campos aceitos pela entrada de `HTTPError` (`ErrorInput`) e, além deles, os campos opcionais `type` e `instance`.

**Critério de aceite**

- **Dado** um input com `status`, `statusText`, `message`, `headers`, `data`, `type` e `instance`,
- **Quando** o código chama `problem(input)`,
- **Então** a chamada compila sem erros de tipo, e os campos `status`, `statusText`, `message`, `headers`, `data`, `type` e `instance` ficam disponíveis no erro retornado.

### RF-03 — Resposta em `application/problem+json`

Quando um erro criado por `problem()` chega ao final do pipeline, a resposta deve ter o header `Content-Type: application/problem+json` e um corpo JSON com os membros da RFC 9457.

**Critério de aceite**

- **Dado** um handler que lança `problem({ status: 403, message: "Acesso negado" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem status `403`, `Content-Type` igual a `application/problem+json` e o corpo JSON contém `status: 403` e `detail: "Acesso negado"`.

### RF-04 — Mapeamento dos membros padrão

Os membros do corpo devem seguir o mapeamento abaixo:

| Membro RFC 9457 | Origem                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| `type`          | `input.type`; se ausente, `"about:blank"` (valor padrão da RFC, §4.2.1) |
| `title`         | `input.statusText`; se ausente, o texto padrão do status              |
| `status`        | `input.status` (já sanitizado como em `HTTPError`)                    |
| `detail`        | `input.message`                                                        |
| `instance`      | `input.instance`; omitido se ausente                                   |

**Critério de aceite**

- **Dado** um `problem({ status: 422 })` sem `type`, `statusText` ou `message`,
- **Quando** a resposta é serializada,
- **Então** o corpo contém `type: "about:blank"`, `title` com o texto padrão de `422` e `status: 422`, e não contém `instance`.

### RF-05 — Membros de extensão

Os campos `data` e `body` do input devem aparecer no corpo como membros de extensão no nível superior do objeto, permitido pela RFC 9457 (§3.2). Se houver conflito com um membro padrão, o membro padrão tem prioridade.

**Critério de aceite**

- **Dado** um `problem({ status: 400, message: "Inválido", data: { campo: "email" } })`,
- **Quando** a resposta é serializada,
- **Então** o corpo contém `campo: "email"` no nível superior, e `detail: "Inválido"`.

### RF-06 — Headers adicionais

Os headers informados em `input.headers` devem ser aplicados à resposta de erro em formato problem details.

**Critério de aceite**

- **Dado** um `problem({ status: 401, headers: { "WWW-Authenticate": "Bearer" } })`,
- **Quando** a resposta é gerada,
- **Então** a resposta contém o header `WWW-Authenticate: Bearer` e `Content-Type: application/problem+json`.

### RF-07 — Erros não tratados não vazam detalhes

Se um erro criado por `problem()` for marcado como `unhandled`, a resposta não deve expor `detail`, `data`, `body` ou a stack trace, seguindo a regra de segurança que já existe para `HTTPError`.

**Critério de aceite**

- **Dado** um erro de problem details marcado como `unhandled`,
- **Quando** a resposta é gerada fora do modo de debug,
- **Então** o corpo não contém `detail`, `data`, `body` nem stack trace.

### RF-08 — Respostas existentes não mudam

Erros criados com `HTTPError` diretamente, `createError` ou outros caminhos que não usam `problem()` devem continuar produzindo exatamente a mesma resposta de hoje.

**Critério de aceite**

- **Dado** um handler que lança `new HTTPError({ status: 404, message: "Não encontrado" })`,
- **Quando** a rota é requisitada,
- **Então** a resposta tem o mesmo `Content-Type` e o mesmo corpo JSON de antes da mudança.

## Fora de escopo

- Mudar o formato padrão de erro do framework ou de `HTTPError` para problem details.
- Novo middleware ou opção global (ex.: `onError` configurável, flag no `H3Config`) para ativar o formato.
- Registro de tipos de problema (catálogo de `type` URIs) ou geração automática de URIs.
- Suporte a `application/problem+xml` ou a negociação de conteúdo via `Accept`.
- Tradução ou localização das mensagens.
- Alterações no pacote `h3/nitro` ou em outros pacotes do ecossistema.
- Novos nomes públicos além de `problem` e do tipo da sua entrada (ver premissas).
- Mudanças de performance ou novos benchmarks.

## Premissas e riscos

### Premissas

- **Nome do tipo de entrada.** O contrato proíbe novos nomes públicos além de `problem` e "do tipo da sua entrada", mas não define o nome. Premissa: o tipo será exportado como `ProblemInput`.
- **Marcação interna.** O erro retornado por `problem()` precisa ser reconhecido pelo responder de erros para usar o formato novo. Premissa: isso é feito com um símbolo interno (`k` prefix, conforme o guia do projeto), sem novo nome público.
- **Estrutura de arquivos.** A implementação deve ficar em arquivos curtos (< 200 LoC), usando `utils/` e `utils/internal/` conforme o guia do projeto. Se o responder de erros precisar mudar, a mudança deve ser mínima.
- **Testes.** Testes novos seguem `describeMatrix` (web e node). Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam.
- **Runtime.** A solução usa apenas APIs web padrão (`Response`, `Headers`), sem dependências novas.

### Riscos

- **Vazamento de detalhes.** Um erro `unhandled` pode expor informação interna se o caminho do formato novo não reutilizar a regra de segurança existente. Mitigação: RF-07 com teste específico.
- **Quebra silenciosa.** Mudanças no responder podem alterar respostas que não usam `problem()`. Mitigação: RF-08 e a suíte existente, que deve continuar passando sem ajustes em testes de comportamento.
- **Conflito de membros.** `data`/`body` com chaves iguais às de RFC 9457 podem gerar corpo ambíguo. Mitigação: regra de prioridade em RF-05.
- **Adoção parcial.** Como só o utilitário muda o formato, erros de bibliotecas e do próprio framework continuarão no formato antigo. Isso é intencional, mas pode confundir quem espera o formato em toda a API.
- **Critérios de qualidade.** `pnpm lint` e `pnpm typecheck` devem passar. Qualquer falha nesses comandos bloqueia a entrega.
