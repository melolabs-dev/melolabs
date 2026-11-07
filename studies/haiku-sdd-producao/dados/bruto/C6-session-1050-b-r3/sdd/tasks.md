# Tarefas — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-07), `sdd/techspec.md` (D-01 a D-08, seções 3 a 5).

Ordem: T-01 primeiro (testes que falham antes da implementação, conforme `AGENTS.md`). Depois T-02 a T-06 e, por último, T-07.

### T-01 — Escrever os testes de regressão antes da implementação

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06

**Depende de:** nenhuma

**Aceite:** em `test/session.test.ts`, após a linha 186, existem os casos da techspec seção 5: leitura com `B` em `[B]` e em `[C, B]`; `Set-Cookie` com `A` e não com `B`; reselo com exatamente um `Set-Cookie` (inclusive sessão em chunks); expiração de `maxAge` e `idleTimeout` com selo de `B`; caso com `extraUnsealPasswords: []`; fallback legado com `B` e com `legacySealFallback: false`. Todos rodam em `web` e `node` via `describeMatrix`. Rodando `pnpm vitest run test/session.test.ts`, os novos casos que dependem da funcionalidade falham, e os testes existentes em `:134-186` continuam passando sem edição. A saída do comando é registrada antes de seguir para T-02.

**Arquivos:** `test/session.test.ts`

### T-02 — Renomear o símbolo interno `kLegacySeal` para `kStaleSeal`

**Cobre:** RF-07 (nenhum nome público novo)

**Depende de:** T-01

**Aceite:** `src/utils/internal/session.ts` exporta `kStaleSeal` com `Symbol.for("h3.internal.session.stale-seal")`. Nenhuma ocorrência de `kLegacySeal` permanece em `src/` ou `test/`. `src/index.ts` e `test/unit/package.test.ts` não mudam. Os testes existentes de `test/session.test.ts` continuam passando com a mesma saída de antes.

**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

### T-03 — Adicionar `extraUnsealPasswords` em `SessionConfig` com TSDoc

**Cobre:** RF-07, RF-01

**Depende de:** nenhuma

**Aceite:** `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password` (`src/utils/session.ts:48`), com o TSDoc da techspec seção 4: só abre sessões, é testada na ordem após `password`, sessão aberta com ela é resselada com `password` (só cookie), lista curta, remover após `maxAge`/`idleTimeout`, e a senha antiga continua válida enquanto listada. `pnpm typecheck` passa. Nenhuma exportação nova em `src/index.ts`. A tarefa não muda a lógica de selagem.

**Arquivos:** `src/utils/session.ts`

### T-04 — Tentar abrir o cookie com cada senha dentro de `unsealSession`

**Cobre:** RF-01, RF-02, RF-04, RF-06

**Depende de:** T-02, T-03

**Aceite:** a lógica "iterações atuais + fallback legado" (`src/utils/session.ts:312-348`) passa a ser um helper interno `unsealWithPassword`. `unsealSession` monta `[config.password, ...extras]` normalizada (descarta vazias, não-string e iguais a `password`, D-05), tenta cada uma na ordem (D-02), guarda o erro da primeira e lança esse erro se nenhuma abrir (D-03). Quando abre com extra ou com legado, marca `kStaleSeal` (com a guarda `if (unsealed)`). `legacySealFallback: false` vale para todas as senhas (D-08). As checagens de `maxAge`/`idleTimeout` (`:349-366`) ficam depois do loop e não mudam. Os casos de RF-01, RF-04 e RF-06 de T-01 passam. Sealing (`sealSession`, `:300`) não muda.

**Arquivos:** `src/utils/session.ts`

### T-05 — Resselar sessões de cookie abertas com senha extra

**Cobre:** RF-03, RF-02

**Depende de:** T-04

**Aceite:** a condição de reselo em `getSession` (`src/utils/session.ts:199-216`) usa `staleSeal` em vez de `legacySeal`, com o `delete` do símbolo mantido (D-04, D-07). Sessão lida de cookie com `B` gera exatamente um `Set-Cookie` que abre com `A` e retorna o mesmo `id` e `data`. Sessão lida de header com `B` não emite `Set-Cookie`. Os casos de RF-02 e RF-03 de T-01 passam.

**Arquivos:** `src/utils/session.ts`

### T-06 — Cobrir casos de borda: lista inválida e chamada direta de `unsealSession`

**Cobre:** RF-01, RF-04, RF-05

**Depende de:** T-05

**Aceite:** em `test/session.test.ts` existem e passam os casos: cookie inválido com extras resulta em sessão nova sem exceção; senha extra curta demais ou igual a `password` não derruba as demais; `unsealSession` pública com extras abre o selo de `B` e retorna o símbolo `kStaleSeal`; sessão grande em chunks continua resselada. Nenhum caso existente foi alterado.

**Arquivos:** `test/session.test.ts`

### T-07 — Verificação final e compatibilidade

**Cobre:** RF-05, RF-07

**Depende de:** T-06

**Aceite:** `pnpm vitest run test/session.test.ts` passa por completo. `pnpm vitest run test/unit/package.test.ts` passa sem alteração. `pnpm lint` e `pnpm typecheck` passam. `pnpm test` (suíte completa) passa. `git diff --stat` mostra alterações só em `src/utils/session.ts`, `src/utils/internal/session.ts` e `test/session.test.ts`. Nenhum arquivo de `docs/` é alterado.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`
