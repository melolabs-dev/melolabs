# Tarefas de implementação — Problem details (RFC 9457) como opção de configuração

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (decisões D-01 a D-08, testes T1 a T14, riscos R-01 a R-11).

## Antes de começar

Pontos da seção 8 da techspec que precisam de resposta. As tarefas abaixo assumem o padrão indicado em cada item.

1. **D-04 (tabela de frases, ~1,5 KB):** assume-se que a tabela entra. Se o time recusar, `title` fica sem a frase padrão quando `statusText` está ausente, o que contraria RF-02. Isso muda a T-03 e os testes T4 e T11.
2. **RF-06 (onError):** assume-se D-08. Um erro devolvido por `onError` sai em `application/problem+json`. Um objeto comum devolvido por `onError` continua sendo corpo de sucesso. O PRD deve dizer isso explicitamente. A alteração no PRD não faz parte destas tarefas.
3. **D-05 / R-04:** assume-se que `error.headers` pode sobrescrever `content-type` no modo problem, como hoje. Isso fica documentado.
4. **Documentação:** assume-se que a T-07 é feita depois da entrega principal.

Ordem sugerida: T-01 e T-02 em paralelo, depois T-05 (vermelha), T-03, T-04, T-06. A T-07 pode rodar a qualquer momento depois da T-01.

---

### T-01 — Adicionar a opção `problemDetails` em `H3Config`

Cobre: RF-01
Depende de: nenhuma
Aceite: `src/types/h3.ts` declara `problemDetails?: boolean` em `H3Config`, com JSDoc e `@default false`, sem alterar as demais opções. `new H3({ problemDetails: true })` compila, e `problemDetails: "sim"` falha em `pnpm typecheck` (teste de tipo em `test/unit/types.test-d.ts`). Em uma aplicação criada sem a opção, `app.config.problemDetails` é `undefined`, ou seja, desligada.
Arquivos: `src/types/h3.ts`, `test/unit/types.test-d.ts`

### T-02 — Fazer `HTTPError` aceitar e expor `type` e `instance`

Cobre: RF-04, RF-03 (guarda: `toJSON()` continua sem os campos novos)
Depende de: nenhuma
Aceite: `ErrorInput` ganha `type?: string` e `instance?: string` (somente nele, não em `ErrorBody`, conforme D-07). A classe `HTTPError` expõe `readonly type` e `readonly instance` com tipo `string | undefined`, lidos do objeto de entrada e nunca de `cause`. O novo `test/unit/error.test.ts` cobre: valores lidos do input; ambos `undefined` quando ausentes; `cause: { type: "x" }` não preenche `type`; `toJSON()` não contém `type` nem `instance`. Os testes passam.
Arquivos: `src/error.ts`, `test/unit/error.test.ts` (novo), `test/unit/types.test-d.ts`

### T-03 — Criar o módulo interno `toProblemDetails` e a tabela de frases

Cobre: RF-02, RF-05
Depende de: T-02
Aceite: `src/utils/internal/problem.ts` (novo) exporta `toProblemDetails(error, debug)` e a tabela `STATUS_PHRASES` (frases do IANA, D-04). Nada disso aparece em `src/index.ts`, e `test/unit/package.test.ts` continua passando sem alteração. A função segue a techspec, seção 5.3: `type` vem de `error.type` ou `"about:blank"`; `title` vem de `statusText` ou da frase padrão; `status` e `detail` (`message`) seguem RF-02; `data` e os campos de `body` viram extensões, com `body` vencendo `data`; os membros da RFC vencem em caso de colisão (D-03); erro `unhandled` não tem `detail`, `data` nem `body` (RF-05); `stack` aparece só com `debug` (D-06). O arquivo fica abaixo de 200 linhas. O comportamento é verificado pela T-05 e por `pnpm typecheck`.
Arquivos: `src/utils/internal/problem.ts` (novo)

### T-04 — Renderizar erros como `application/problem+json` em `errorResponse`

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Depende de: T-01, T-03, T-05
Aceite: `errorResponse(error, config, errHeaders)` (D-01) usa `problemHeaders` (`content-type` exato `application/problem+json`, sem `charset`, D-05) e o corpo de `toProblemDetails` quando `config.problemDetails` é verdadeiro. Com a opção desligada, o ramo legado produz o mesmo `Content-Type`, o mesmo corpo e os mesmos status de hoje (R-01). `error.headers` e `errHeaders` continuam sendo mesclados, e `kEventRes` continua sendo limpo antes da renderização (R-02). A chamada em `src/response.ts:173` passa `config` inteiro, em vez de `config.debug`. Os testes T2 a T7, T9, T11, T13 e T14 da T-05 passam, e `pnpm vitest run test/errors.test.ts test/hooks.test.ts test/mount.test.ts test/json-rpc.test.ts` passa sem alterar asserções existentes.
Arquivos: `src/response.ts`

### T-05 — Escrever a matriz de testes de problem details (vermelha antes da T-04)

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06, RF-07
Depende de: T-01, T-02
Aceite: `test/problem-details.test.ts` (novo) usa `describeMatrix`, então cada caso roda em `web` e `node`. Ele cobre T1 a T14 da techspec, seção 6.2, ligando a opção com `t.app.config.problemDetails = true` como em `test/errors.test.ts:14`. Nos casos com erro não tratado, `t.errors = []` vem depois da asserção, como em `test/errors.test.ts:107-122`. Antes da T-04, T1 e T8 passam, e os demais falham; a saída do teste é registrada. Depois da T-04, todos passam nos dois modos.
Arquivos: `test/problem-details.test.ts` (novo)

### T-06 — Verificar regressão, lint e tipos

Cobre: RF-03
Depende de: T-04, T-05
Aceite: `pnpm vitest run` completo passa, sem alterar testes que não dependem da nova opção (RF-03). `pnpm lint` (oxlint e `oxfmt --check`) e `pnpm typecheck` passam. Se o `oxfmt` reclamar de formatação nos arquivos tocados, a formatação é corrigida nesses arquivos. Se algo falhar, a saída completa é reportada.
Arquivos: nenhum arquivo novo; ajustes de formatação, se necessários, nos arquivos das tarefas anteriores

### T-07 — Documentar a opção `problemDetails` (opcional)

Cobre: RF-01
Depende de: T-01
Aceite: `docs/1.guide/900.api/1.h3.md` tem uma linha para `problemDetails`, ao lado de `debug` (por volta da linha 111), com o padrão `false` e a referência à RFC 9457. `pnpm lint` passa. Fazer só se o time aceitar a decisão 4 da seção "Antes de começar".
Arquivos: `docs/1.guide/900.api/1.h3.md`
