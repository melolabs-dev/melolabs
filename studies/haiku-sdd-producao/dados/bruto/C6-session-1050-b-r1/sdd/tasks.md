# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Seguir o fluxo de bug/feature do `AGENTS.md`: os testes novos são escritos antes da implementação e precisam falhar primeiro (T-02).

Ordem: T-01 → T-02 → (T-03, T-04) ; T-03 → T-05 ; (T-04, T-05) → T-06 ; T-06 → (T-07, T-08) ; (T-07, T-08) → T-09.

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

- Cobre: RF-01
- Depende de: nenhuma
- Aceite: adicionar `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig` (`src/utils/session.ts:48`), com o JSDoc da decisão D-01 (só abre sessões; ordem de tentativa; custo de PBKDF2 por senha extra; mínimo de 32 caracteres; remoção é manual; tratar a senha antiga como segredo até ser removida; lista curta por causa da latência). `password` continua `string`. Em `test/unit/types.test-d.ts`, incluir `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()`, `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string>()` e um literal de `SessionConfig` sem o campo que continua compilando. Verificado com `pnpm vitest run test/unit/types.test-d.ts` e `pnpm typecheck`.
- Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`

### T-02 — Testes novos que falham antes da implementação

- Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
- Depende de: T-01
- Aceite: antes de qualquer mudança de comportamento, rodar `pnpm vitest run test/session.test.ts` e confirmar que a suíte existente passa (baseline). Em seguida, adicionar em `test/session.test.ts` (depois de `:186`, usando `describeMatrix`, `sessionConfig` e os helpers `seal`/`unseal`/`sealDefaults` já importados) os oito casos da seção 5 do techspec, com senhas de pelo menos 32 caracteres (`OLD`, `NEW`, `OTHER`). Os casos com extras de RF-02, RF-03, RF-05, RF-07 e RF-08 devem falhar com o código atual. RF-04 (sem extras) e RF-06 podem já passar, o que é esperado: são guardas de regressão. A execução precisa registrar quais casos falharam. Nenhuma asserção da suíte existente é alterada.
- Arquivos: `test/session.test.ts`

### T-03 — Extrair `sealOptionsOf(config)` como helper interno

- Cobre: RF-04
- Depende de: T-02
- Aceite: criar `sealOptionsOf(config: SessionConfig): SealOptions` no fim de `src/utils/session.ts` (D-04), com o retorno anotado, e usá-lo em `sealSession` (`:300-304`). Mudança mecânica, sem alteração de resultado. `pnpm vitest run test/session.test.ts` continua verde nos casos sem extras.
- Arquivos: `src/utils/session.ts`

### T-04 — Helper `unsealPasswords` com validação e deduplicação

- Cobre: RF-02, RF-07
- Depende de: T-02
- Aceite: criar `unsealPasswords(config: SessionConfig, sealOptions: SealOptions): string[]` no fim de `src/utils/session.ts` (D-02). Retorna `[password, ...extras]` sem repetições (`new Set`, ordem de inserção preservada). Valida cada extra: string vazia gera `Empty password`; string curta gera `Password string too short (min N characters required)`, com N = `max(encryption.minPasswordlength, integrity.minPasswordlength)` de `sealOptions` (default 32). A `password` principal não ganha validação nova (RF-04). Não exportar nada. Verificado pelos casos de RF-07 de T-07 e por `pnpm lint` e `pnpm typecheck`.
- Arquivos: `src/utils/session.ts`

### T-05 — Extrair `unsealWith` para uma senha, sem mudar comportamento

- Cobre: RF-04, RF-08
- Depende de: T-03
- Aceite: mover o corpo atual de `unsealSession` (`src/utils/session.ts:323-348`) para o helper interno `unsealWith(sealed, password, config, sealOptions): Promise<Partial<Session>>`, que faz exatamente o que o código faz hoje para uma senha: tentativa atual, depois legada (`legacySealFallback !== false` e `iterations !== 1`, mesmas condições de `:332-337`), marcando `kLegacySeal`. Manter a checagem `if (unsealed)` e o caso de `unseal` retornar `null` para payload vazio. Lança o erro da última tentativa. `unsealSession` ainda usa uma única senha nesta tarefa. Verificado por `pnpm vitest run test/session.test.ts`: suíte existente verde (incluindo o legado em `:134-186`) e o caso de RF-08 com `extraUnsealPasswords: [B]` passando.
- Arquivos: `src/utils/session.ts`

### T-06 — Laço por senha em `unsealSession`, avançando só em `Bad hmac value`

- Cobre: RF-02, RF-06
- Depende de: T-04, T-05
- Aceite: `unsealSession` percorre `unsealPasswords(config, sealOptions)` e chama `unsealWith` para cada senha. Usa `break` no sucesso. Captura o erro apenas quando `error instanceof Error && error.message === "Bad hmac value"` (D-03); qualquer outro erro é relançado na hora. Se nenhuma senha serve, lança o último erro `Bad hmac value`. As verificações de `maxAge` e `idleTimeout` (`:350-365`) ficam depois do laço, sem mudança. Verificado pelos casos de RF-02 (sessão com `B` aberta com `password: A`, `id`/`createdAt`/`data` preservados; ordem `[B, C]`) e RF-06 (seal de `B` expirado por `ttl` retorna `Expired seal`, não `Bad hmac value`; payload mal formado propaga `Incorrect number of sealed components`). Suíte existente segue verde.
- Arquivos: `src/utils/session.ts`

### T-07 — Validação antecipada das extras em `getSession`

- Cobre: RF-05, RF-07
- Depende de: T-06
- Aceite: em `getSession`, chamar `unsealPasswords(config, sealOptionsOf(config))` depois do retorno antecipado de sessão já carregada (`:162-165`) e antes de `context.sessions![sessionName] = session` (`:173`), fora do `.catch(() => {})` (`:196-197`), para que a extra inválida não seja tratada como sessão nova (D-04). A validação ocorre mesmo sem cookie. Verificado pelo caso de RF-07 com `extraUnsealPasswords: ["curta"]`: `getSession` e `useSession` rejeitam com `/too short/`, também com cookie válido selado por `password`, e a extra igual a `password` é aceita sem tentativa repetida. Verificado pelo caso de RF-05: cookie selado com `C` (fora da lista) gera sessão com `id` novo, diferente do cookie, e `data` vazio.
- Arquivos: `src/utils/session.ts`

### T-08 — Selagem sempre com `password` (RF-03)

- Cobre: RF-03
- Depende de: T-06
- Aceite: confirmar que `sealSession` lê só `config.password` (D-05), sem código novo para isso. Verificar por testes em `test/session.test.ts`: sessão aberta com a extra `B` e `updateSession` gravando dados gera cookie que abre com `A` e lança `Bad hmac value` com `B`. Cobrir também `clearSession` e a regravação por deslizamento de `idleTimeout` (fake timers, como em `:188-195`). Se algum caso falhar, corrigir em `src/utils/session.ts` sem criar sinal novo para senha antiga (D-05). Não reselar no `getSession` (fora de escopo).
- Arquivos: `test/session.test.ts`, `src/utils/session.ts` (somente se um caso falhar)

### T-09 — Verificação final e revisão de escopo

- Cobre: RF-04
- Depende de: T-07, T-08
- Aceite: rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/types.test-d.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` (suíte completa com cobertura). Se `test/unit/package.test.ts` reagir ao tamanho do bundle, ajustar só o necessário. Conferir que nada foi alterado em `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts`, `package.json` e que nenhum nome público novo foi exportado. Os testes da suíte existente seguem com as mesmas asserções.
- Arquivos: nenhum arquivo novo; verificação sobre `src/utils/session.ts`, `test/session.test.ts`, `test/unit/types.test-d.ts`

---

## Cobertura do PRD

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01 |
| RF-02 | T-02, T-04, T-06 |
| RF-03 | T-02, T-08 |
| RF-04 | T-02, T-03, T-05, T-09 |
| RF-05 | T-02, T-07 |
| RF-06 | T-02, T-06 |
| RF-07 | T-02, T-04, T-07 |
| RF-08 | T-02, T-05 |
