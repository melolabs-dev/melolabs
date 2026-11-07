# Tarefas de implementação — Problem details (RFC 9457) por opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-11). Cada tarefa indica os requisitos que cobre, as dependências, o critério de aceite e os arquivos que toca. Ordem sugerida: T-01 e T-03 em paralelo; depois T-02; depois T-04; depois T-05, T-06, T-07 e T-08; por fim T-09.

Antes de qualquer mudança de comportamento, seguir o fluxo de correção de `AGENTS.md`: os testes de T-02 devem falhar na branch atual.

### T-01 — Adicionar a opção `problemDetails` em `H3Config`

- Cobre: RF-01
- Depende de: nenhuma
- Aceite: `problemDetails?: boolean` existe em `H3Config` com JSDoc indicando padrão `false` (D-01, `techspec.md` seção 4). `new H3({ problemDetails: true })` compila; sem a opção, `app.config.problemDetails` é `undefined` ou `false`. `pnpm typecheck` passa.
- Arquivos: `src/types/h3.ts`

### T-02 — Escrever os testes de problem details (devem falhar antes da implementação)

- Cobre: RF-02, RF-03, RF-04, RF-06, RF-07, RF-08
- Depende de: T-01 (apenas para o tipo da opção; o comportamento ainda não existe)
- Aceite: `test/problem-details.test.ts` criado com `describeMatrix` (web e node), cobrindo os casos 1 a 12 da seção 5 do `techspec.md`. Em particular: o corpo de RF-04 é verificado com `toEqual`; `unhandled` não vaza `"segredo do banco"`; `debug` inclui `stack` como array; o cookie de `errHeaders` aparece uma única vez e `onError` é chamado. Ao rodar `pnpm vitest run test/problem-details.test.ts`, os casos de formato ligado falham e os casos de opção desligada passam. A saída do comando é registrada na descrição da PR ou no relatório da tarefa.
- Arquivos: `test/problem-details.test.ts`

### T-03 — Adicionar `type` e `instance` em `HTTPError`

- Cobre: RF-05
- Depende de: nenhuma
- Aceite: `ErrorInput` aceita `type?: string` e `instance?: string` (sem entrar em `ErrorBody`, D-03). A classe expõe `readonly type` e `readonly instance`, lidos somente de `details` com `(details as ErrorInput)?.type`, sem fallback para `cause` (D-04). `new HTTPError({ status: 409, message: "Conflito", type: "https://exemplo.com/erros/conflito", instance: "/recurso/1" })` retorna esses valores; sem os campos, ambos são `undefined`. `toJSON()` não muda (o teste de `toJSON()` existente continua passando sem ajuste). Se `test/unit/types.test-d.ts` cobrir `HTTPError`, incluir `expectTypeOf(err.type).toEqualTypeOf<string | undefined>()`. Teste unitário novo em `test/unit/error.test.ts`.
- Arquivos: `src/error.ts`, `test/unit/error.test.ts`, `test/unit/types.test-d.ts` (somente se já cobrir `HTTPError`)

### T-04 — Renderizar problem details em `errorResponse`

- Cobre: RF-02, RF-03, RF-04, RF-06, RF-07
- Depende de: T-02, T-03
- Aceite: `errorResponse(error, config, errHeaders)` escolhe o formato pela flag `config.problemDetails` (D-01). Com a flag ligada, o `Content-Type` é exatamente `application/problem+json` (D-05, constante `problemHeaders` ao lado de `jsonHeaders`), e o corpo segue `problemDetailsBody` (D-02, D-06): `type` (padrão `"about:blank"`), `title` = `statusText` (omitido se ausente, sem tabela de frases), `status`, `detail` = `message` (ou `"HTTPError"` se `unhandled`, D-07), `instance` (omitido se ausente). Extensões (`body`, `data`, `stack` com `debug`) são espalhadas antes dos membros padrão, para que `body` não sobrescreva `status` nem `type`. Com a flag desligada, a saída de `toJSON()` e os headers são idênticos aos atuais. Os testes 1 a 7 e 10 de T-02 passam.
- Arquivos: `src/response.ts`

### T-05 — Cobrir erros gerados pelo h3 fora do `throw` direto

- Cobre: RF-03, RF-08
- Depende de: T-04
- Aceite: com `problemDetails: true`, passam os casos de `kNotFound` (rota inexistente → 404 em problem details), erro lançado por `onError` (→ 500 em problem details, D-08), requisição `HEAD` (sem corpo, `Content-Type` problem+json), e erro 401 com cookie em `event.res.errHeaders` (cookie uma única vez, `onError` chamado, D-10). Os testes 8, 9, 11 e 12 de T-02 passam. Nenhuma mudança de lógica de `errHeaders` em `prepareResponse` (D-10); se a verificação de cookie falhar, investigar antes de mexer.
- Arquivos: `src/response.ts` (somente se algum caso exigir ajuste), `test/problem-details.test.ts`

### T-06 — Propagar a flag para `toResponse` no cache e no middleware

- Cobre: RF-03
- Depende de: T-04
- Aceite: `src/rules/cache.ts` (linha 314) e `src/utils/middleware.ts` (linha 26) passam `{ problemDetails: event.app?.config.problemDetails }` como config (D-09). Não passar o `config` inteiro, para não executar `onResponse`/`onError` duas vezes. `src/handler.ts:122` fica como está. Em `test/rules/cache.test.ts`, um handler cacheado que retorna `kNotFound` (sem lançar) com `problemDetails: true` responde em problem details, e a entrada gravada no cache também está nesse formato. Confirmar se `h3/rules/cache` e `utils/cache.ts` têm o mesmo problema (PRD, Riscos) e cobrir com teste se afetar.
- Arquivos: `src/rules/cache.ts`, `src/utils/middleware.ts`, `test/rules/cache.test.ts`, e `src/utils/cache.ts` (somente se o problema for confirmado)

### T-07 — Garantir que a opção desligada não muda nada

- Cobre: RF-02
- Depende de: T-04, T-06
- Aceite: `pnpm vitest run test/errors.test.ts test/problem-details.test.ts` passa. O assert de `content-type` em `test/errors.test.ts:44` continua igual, sem nenhuma alteração no arquivo. O caso 2 de T-02 (404 com `message: "x"`, corpo comparado com `toEqual` ao de `toJSON()`) passa com a opção ausente e com `false`. Nenhum teste existente foi removido ou enfraquecido (RF-09).
- Arquivos: `test/errors.test.ts` (somente leitura), `test/problem-details.test.ts`

### T-08 — Documentar a opção e a diferença de mapeamento

- Cobre: RF-01 (documentação da opção; pedido em Riscos do PRD: documentar a mudança de `message` → `detail` e `statusText` → `title`)
- Depende de: T-04
- Aceite: seção em `docs/1.guide/1.basics/6.error.md` explica `problemDetails`, padrão `false`, `Content-Type`, mapeamento dos membros, comportamento de `unhandled` e debug, e que `type`/`instance` não são validados como URI. O texto fica em português, seguindo o estilo dos demais arquivos de `docs/` (se o restante estiver em inglês, seguir o idioma do arquivo).
- Arquivos: `docs/1.guide/1.basics/6.error.md`

### T-09 — Verificação final: lint, tipos e suíte completa

- Cobre: RF-09
- Depende de: T-05, T-06, T-07, T-08
- Aceite: `pnpm lint` e `pnpm typecheck` passam. `pnpm test` (lint, typecheck e cobertura) passa. Nenhum teste existente foi removido ou alterado para passar. Se `pnpm install` ainda não tiver sido feito no clone, rodar `corepack enable && pnpm install` antes (`techspec.md`, Riscos). O relatório final lista os comandos executados e suas saídas resumidas, inclusive falhas.
- Arquivos: nenhum (apenas verificação)

## Pontos em aberto para confirmação

Estes itens estão em `techspec.md` seção 7. As tarefas acima seguem a recomendação do documento até que sejam confirmados:

1. D-04: `type`/`instance` sem fallback para `cause` (afeta T-03).
2. D-06: `unhandled` não aparece no formato problem details (afeta T-04).
3. D-09: nos pontos de cache e middleware, sem `debug` (afeta T-06).

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-08 |
| RF-02 | T-02, T-04, T-07 |
| RF-03 | T-02, T-04, T-05, T-06 |
| RF-04 | T-02, T-04 |
| RF-05 | T-03 |
| RF-06 | T-02, T-04 |
| RF-07 | T-02, T-04 |
| RF-08 | T-02, T-05 |
| RF-09 | T-07, T-09 |
