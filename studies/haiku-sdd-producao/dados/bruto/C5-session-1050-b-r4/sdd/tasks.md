# Tarefas — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (decisões D-01 a D-07, riscos R-A a R-G).

Ordem sugerida: T-01 → T-02 e T-03 → T-04 → T-05 → T-06 e T-07 → T-08. Os testes de T-02 devem falhar antes de T-05 e T-06 (fluxo de bug fix do `AGENTS.md`).

### T-01 — Adicionar o campo `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01

Depende de: nenhuma

Aceite: `pnpm typecheck` passa com `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig`, com o JSDoc da seção 5 do techspec (usada só para abrir, nunca para selar; remover a entrada é a única forma de revogar). `password` continua `string`. `test/unit/package.test.ts` passa sem alteração, o que prova que nenhum nome público novo entrou na API. Confirmar onde fica o teste de tipo (pendência 2 do techspec): `test/unit/` ou direto no `pnpm typecheck`.

Arquivos: `src/utils/session.ts`

### T-02 — Escrever os testes de abertura, regravação e cabeçalho (devem falhar antes da implementação)

Cobre: RF-02, RF-03, RF-05, RF-07, RF-08, RF-09

Depende de: T-01

Aceite: em `test/session.test.ts`, após a linha 186, existem testes com `describeMatrix` (web e node) para:
- token com `A`, config `B` + `[A]`: `id`, `createdAt` e `data` iguais aos originais (RF-02);
- `update()` com config `B` + `[A]`: o cookie abre com `B` e não abre com `A` (RF-03);
- token com `C` fora da config: `getSession` retorna `id` novo e não lança (RF-05);
- token legado (1 iteração) com `A`: regravado com `B` e iterações atuais; a leitura seguinte não gera `Set-Cookie` (RF-07);
- `legacySealFallback: false` com token legado de `A`: sessão nova (RF-07);
- leitura de token `A` gera `Set-Cookie` que abre com `B` e não com `A`, com `id` e `createdAt` mantidos; segunda leitura sem `Set-Cookie` (RF-08);
- token com `A` no header `x-{name}-session`: dados carregados e nenhum `Set-Cookie` nessa leitura, travando D-05 (RF-09).
Ao rodar `pnpm vitest run test/session.test.ts`, os testes de RF-02, RF-07 (abertura), RF-08 falham, e os de RF-03 e RF-05 podem passar. Registrar quais falharam.

Arquivos: `test/session.test.ts`

### T-03 — Escrever os testes de comportamento preservado, ordem e custo

Cobre: RF-04, RF-03, RF-01

Depende de: T-01

Aceite: em `test/session.test.ts`, com `describeMatrix`, existem testes para:
- `extraUnsealPasswords: []` produz o mesmo resultado que o campo ausente (RF-04);
- token com `B` e config `B` + `[A]` gera o mesmo número de `deriveBits` que a config sem extras, via `vi.spyOn(crypto.subtle, "deriveBits")` (P2 e RF-02);
- token que nenhuma senha abre, com 3 extras e fallback ligado: `deriveBits` igual a 2 × 4 (R1, custo documentado);
- config com `password` válida e extra de 5 caracteres: sessões com a senha atual continuam abrindo (D-06, R-B);
- `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` no lugar definido em T-01 (RF-01).
Os testes existentes de `test/session.test.ts` não mudam de expectativa. Se algum falhar, é regressão de RF-04, não ajuste de teste.

Arquivos: `test/session.test.ts`

### T-04 — Renomear o marcador `kLegacySeal` para `kReseal`

Cobre: RF-08

Depende de: T-01

Aceite: `src/utils/internal/session.ts` exporta `kReseal` com `Symbol.for("h3.internal.session.reseal")` no lugar de `kLegacySeal`. Todas as referências em `src/utils/session.ts` (linhas 5, 199-201 e 346) usam o novo nome, sem mudança de comportamento ainda. `pnpm typecheck` e `pnpm vitest run test/session.test.ts` passam como antes. `src/index.ts` não é alterado.

Arquivos: `src/utils/internal/session.ts`, `src/utils/session.ts`

### T-05 — Loop de senhas em `unsealSession` com helper de fallback legado por senha

Cobre: RF-02, RF-04, RF-05, RF-07

Depende de: T-02, T-03, T-04

Aceite: `unsealSession` (`src/utils/session.ts`, linhas 312-347) monta `[config.password, ...(config.extraUnsealPasswords || [])]` e tenta uma senha por vez, na ordem. Para cada senha, o helper interno `unsealWithPassword` tenta com as iterações atuais e, se `legacySealFallback !== false` e a sessão não for de 1 iteração, tenta com 1 iteração. Se nenhuma senha abrir, relança o primeiro erro (da senha atual). Quando a senha aberta é extra ou o token é legado, `kReseal` é marcado (D-02, D-03). Usa `opened` como flag, não `if (!unsealed)`, por causa do `null` de `src/utils/internal/iron-crypto.ts:149`. Os testes de T-02 de RF-02, RF-05 e RF-07 passam; os de T-03 passam; todos os testes existentes de `test/session.test.ts` passam sem mudança de expectativa.

Arquivos: `src/utils/session.ts`

### T-06 — Regravar a sessão aberta por senha extra e manter o cabeçalho sem `Set-Cookie`

Cobre: RF-08, RF-09

Depende de: T-04, T-05

Aceite: em `getSession` (`src/utils/session.ts`, linhas 196-216), o marcador `kReseal` é lido e apagado antes de `Object.assign(session, unsealed)` (linha 208), para não vazar para a sessão (R-D; teste verifica que `session[kReseal]` não existe depois da leitura). A condição de regravação na linha 214 passa a ser `(reseal || shouldSlide(session, config))` e só vale para `sessionFromCookie`, conforme D-05. Os testes de T-02 de RF-08 e RF-09 passam. Caso sem `res` continua coberto pelo comportamento atual de `updateSession` (R3).

Arquivos: `src/utils/session.ts`

### T-07 — Confirmar que expiração vale para qualquer senha

Cobre: RF-06

Depende de: T-05

Aceite: `maxAge` e `idleTimeout` (`src/utils/session.ts`, linhas 350-365) continuam depois do loop e sem alteração (D-07). Existe um teste em `test/session.test.ts` com `describeMatrix`: token com `A` vencido por `maxAge`, config `B` + `[A]`, resulta em sessão nova, do mesmo jeito que com a senha `B`. Passa.

Arquivos: `test/session.test.ts`, `src/utils/session.ts`

### T-08 — Verificação final e revisão de regressão

Cobre: RF-04, RF-09

Depende de: T-03, T-06, T-07

Aceite: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. Confirmar por `git diff` que nenhuma expectativa de teste existente foi alterada (R5). Se houve algum ajuste, justificar no PR. Confirmar que `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/unit/package.test.ts` não mudaram.

Arquivos: `test/session.test.ts`, `test/unit/`, `src/utils/session.ts`

---

## Pendências fora das tarefas

- **Decisão de produto sobre header (R-A, techspec seção 8, item 1).** RF-08 e RF-09 pedem regravação também para sessões de header, mas D-05 implementa só para cookie. T-06 segue D-05 até o time decidir. Se o time escolher outra coisa, T-06 e os testes de T-02 de RF-09 mudam.
- **Documentação em `docs/2.utils/4.security.md` e `CHANGELOG.md`.** Fora do escopo do PRD; não há tarefa para isso aqui. O JSDoc do campo (T-01) é obrigatório.
