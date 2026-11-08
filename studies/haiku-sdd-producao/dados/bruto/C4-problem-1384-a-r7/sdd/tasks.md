# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Fontes: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, seção 4 para arquivos e seção 6 para testes).

Ordem: testes antes do código, conforme o "Bug Fix Workflow" de `AGENTS.md`. As tarefas T-02 e T-03 escrevem os testes que falham; T-04 a T-07 implementam; T-08 e T-09 fecham a entrega.

### T-01 — Aceitar `config` extra nos testes de integração

Permitir que um teste declare opções de `H3Config` (por exemplo `debug: false` ou `problemDetails: true`). Hoje o harness cria `new H3({ debug: true, ... })` fixo. Adicionar `config?: Partial<H3Config>` em `TestOptions` e espalhar esse valor no `new H3({...})`, depois dos padrões, para que o teste consiga sobrescrever `debug`.

Cobre: RF-01 (apoio aos testes de RF-06 e RF-07)
Depende de: nenhuma
Aceite: `pnpm vitest run test/errors.test.ts` continua passando sem alterar nenhuma asserção. Um `describeMatrix` com `{ config: { problemDetails: true, debug: false } }` recebe essas opções em `ctx.app.config`.

Arquivos: `test/_setup.ts`

### T-02 — Testes unitários de `type` e `instance` em `HTTPError`

Escrever, antes da implementação, os testes sem HTTP de `type` e `instance`. Cobrir: input com os dois campos (ambos expostos); input sem os campos (ambos `undefined`); `cause` com `type` não é lido (D-04); `toJSON()` não contém `type` nem `instance`, mesmo quando definidos (D-03, RF-05).

Cobre: RF-04, RF-05 (guarda de `toJSON()`)
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/error.test.ts` roda, e os casos de RF-04 falham porque `error.type` e `error.instance` ainda não existem. Os casos de D-04 e de `toJSON()` passam já nesta etapa e continuam passando depois, pois fixam comportamento que não pode mudar.

Arquivos: `test/unit/error.test.ts`

### T-03 — Testes de integração de problem details

Escrever, antes da implementação, `test/problem-details.test.ts` com `describeMatrix` (web e node). Cobrir os cenários da tabela da techspec, seção 6: RF-01 (`app.config.problemDetails` é `undefined` sem a opção e `true` com ela); RF-02 (`HTTPError` 422 e rota inexistente com `application/problem+json`); RF-03 (corpo com `type`, `title`, `status`, `detail`, `instance`; `about:blank` quando falta `type`; sem `title` quando falta `statusText`); RF-05 (sem a opção, `application/json;charset=UTF-8` e chaves idênticas às de antes); RF-06 (`debug: false` com `new Error("segredo do banco")`: status 500 e o texto secreto ausente do corpo bruto); RF-07 (`stack` presente só com `debug: true`); RF-08 (`retry-after` e `onError` que retorna `Response` próprio); D-04 (erro não tratado com `type` de origem vira `about:blank`); D-05 (`body` não sobrescreve `status` nem `title` já definidos); R-8 (HEAD com a opção ligada).

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
Depende de: T-01
Aceite: `pnpm vitest run test/problem-details.test.ts` roda. Os cenários de RF-02, RF-03, RF-06 e D-04 falham pelo motivo esperado (opção ignorada, `Content-Type` ainda `application/json`, campos ausentes). Os cenários de RF-05 e RF-07 já passam hoje e viram guarda de regressão.

Arquivos: `test/problem-details.test.ts`

### T-04 — Opção `problemDetails` em `H3Config`

Adicionar `problemDetails?: boolean;` em `H3Config`, logo após `silent`, com o JSDoc da techspec, seção 5. O padrão é desligado e a opção não cria nenhum export novo.

Cobre: RF-01
Depende de: T-01, T-03
Aceite: os cenários de RF-01 de `test/problem-details.test.ts` passam. `pnpm vitest run test/unit/package.test.ts` continua sem mudança no snapshot de exports.

Arquivos: `src/types/h3.ts`

### T-05 — `type` e `instance` em `HTTPError`

Em `ErrorBody`, adicionar `type?: string;` e `instance?: string;` com JSDoc. Em `HTTPError`, declarar `readonly type: string | undefined;` e `readonly instance: string | undefined;` com tipo explícito, por causa de `isolatedDeclarations`. No construtor, atribuir os dois campos a partir de `details`, sem fallback em `cause` (D-04). Não alterar `toJSON()` (D-03).

Cobre: RF-04, RF-05
Depende de: T-02
Aceite: `pnpm vitest run test/unit/error.test.ts` passa. `pnpm vitest run test/errors.test.ts` passa sem alterar asserções, o que confirma que o corpo de erro padrão não mudou.

Arquivos: `src/error.ts`

### T-06 — Serialização problem details em `errorResponse`

Em `src/response.ts`: trocar a assinatura para `errorResponse(error, config, errHeaders)` e ajustar o único chamador (linha 173) para passar `config` (D-07). Adicionar `problemHeaders` (`FrozenHeaders` com `content-type: application/problem+json`, sem `charset`, D-06) ao lado de `jsonHeaders`. Escolher entre os dois headers conforme `config.problemDetails`. Criar `toProblemDetails(error, debug)` sem `export`, seguindo o pseudocódigo da techspec, seção 5: reutilizar `error.toJSON()` para a máscara de erros não tratados, aplicar a precedência de D-05 e incluir `stack` só com `debug`. Manter `errHeaders` e `error.headers` como hoje. Não criar novo ponto de renderização.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Depende de: T-03, T-04, T-05
Aceite: `pnpm vitest run test/problem-details.test.ts` passa por completo. `pnpm vitest run test/app.test.ts test/errors.test.ts` passa.

Arquivos: `src/response.ts`

### T-07 — Headers de erro, `onError` e status sem corpo

Verificar com a opção ligada que os headers de erro (`HTTPError.headers` e `event.res.errHeaders`) continuam aplicados, que `onError` ainda substitui a resposta e que HEAD, 204 e 304 seguem pelo caminho `nullBody` sem mudança (R-8). Corrigir `src/response.ts` apenas se algum cenário de T-03 falhar.

Cobre: RF-08, RF-05 (caminho de status sem corpo)
Depende de: T-06
Aceite: `pnpm vitest run test/problem-details.test.ts test/hooks.test.ts` passa. Os cenários de RF-08 e o de HEAD aparecem verdes no relatório.

Arquivos: `src/response.ts`, `test/problem-details.test.ts`

### T-08 — Documentação da opção e dos campos

Na seção "`HTTPError` Fields" do guia de erros, documentar `type` e `instance`. Documentar a opção `problemDetails`, o `Content-Type` `application/problem+json` e a nota de mudança de formato para clientes que checam `application/json` (R-1 da techspec). Esta tarefa é recomendada, não obrigatória, pelo pedido.

Cobre: RF-01, RF-04
Depende de: T-04, T-05
Aceite: a seção descreve os dois campos, a opção e o `Content-Type`. `pnpm fmt` não altera o arquivo, ou seja, o `pnpm lint` de formatação passa.

Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-09 — Validação final da suíte

Rodar os comandos de validação e revisar o diff. Conferir que nenhuma asserção existente foi alterada, exceto a infraestrutura de T-01. Se `test/unit/types.test-d.ts` for escrito (opcional, techspec seção 6), conferir que `H3Config["problemDetails"]` é `boolean | undefined` e que `HTTPError["type"]` é somente leitura.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-07, T-08
Aceite: após `pnpm install`, `pnpm lint` e `pnpm test` passam sem erros. `git diff --stat` mostra alterações apenas nos arquivos listados nas tarefas T-01 a T-08.

Arquivos: nenhum arquivo novo. Eventuais ajustes ficam nos arquivos já listados nas tarefas anteriores.

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-01, T-03, T-04, T-08, T-09 |
| RF-02 | T-03, T-06, T-09 |
| RF-03 | T-03, T-06, T-09 |
| RF-04 | T-02, T-05, T-08, T-09 |
| RF-05 | T-02, T-03, T-05, T-06, T-07, T-09 |
| RF-06 | T-03, T-06, T-09 |
| RF-07 | T-03, T-06, T-09 |
| RF-08 | T-03, T-07, T-09 |

## Fora desta lista

Não viraram tarefas as pendências da techspec, seção 8. P-2 (fechar a lacuna D-08 nos caminhos sem `config`) altera também `debug` e `onError`, por isso depende de confirmação. P-1 (manter `unhandled` no corpo) e P-3 (`type` `about:blank` em erro não tratado) estão assumidos como na techspec e precisam de confirmação.
