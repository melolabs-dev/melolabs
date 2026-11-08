# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Seguir o fluxo do AGENTS.md: testes antes (T-02), confirmar que os de RF-02 e RF-04 falham, e só então implementar (T-03 a T-05).

### T-01 — Declarar `extraUnsealPasswords` e o símbolo interno `kExtraSeal`

Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`, logo após `password`, com o JSDoc da techspec (seção 4): só abre, ordem da mais recente para a mais antiga, lista curta, mínimo de 32 caracteres, reseal na mesma requisição. Criar `kExtraSeal` em `src/utils/internal/session.ts` (`Symbol.for("h3.internal.session.extra-seal")`, mesmo padrão de `kLegacySeal`) e importá-lo em `src/utils/session.ts`. Não exportar nada novo em `src/index.ts`.

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` passa e `SessionConfig` aceita `extraUnsealPasswords: ["..."]`. `src/index.ts` não muda e `test/unit/package.test.ts` continua passando (nenhum export novo). Sem o campo, `pnpm vitest run test/session.test.ts` mantém o resultado atual.
Arquivos:

- `src/utils/session.ts`
- `src/utils/internal/session.ts`

### T-02 — Escrever os testes de `extraUnsealPasswords`

Adicionar em `test/session.test.ts`, após a seção de testes legados e dentro de `describeMatrix`, os casos da seção 5 da techspec:

- RF-01: sem o campo (ausente e `[]`), cookie com `password` abre e não emite `Set-Cookie`.
- RF-02: cookie selado com A, config `password: B, extra: [A]`, devolve `id` e `data` originais. A 2ª e a 3ª extra funcionam (ordem); lista com A e C e cookie selado com C.
- RF-03 e RF-04: após ler com A há um único `Set-Cookie`; o cookie abre com B sozinho e `unseal` com A falha (`Bad hmac value`). O reseal preserva `id`, `createdAt` e `data`. `useSession` + `update` também sela só com B.
- RF-05: cookie com senha C fora da config gera sessão nova, com `data` vazio.
- RF-06: cookie expirado por `maxAge` (`vi.useFakeTimers({ toFake: ["Date"] })`), `idleTimeout` vencido e `seal` customizado, todos com senha extra. Cookie legado (1 iteração) com senha extra abre e é reselado moderno com B; `legacySealFallback: false` o rejeita.
- D-05: sessão vinda do header com extra é lida, sem `Set-Cookie`.
- D-06: extra igual a `password` não quebra.
- D-02 e R-04: extra com menos de 32 caracteres, alcançada por cookie de outra senha, descarta a sessão sem exceção ao handler.
- D-04: `kExtraSeal` não vaza para `session` (checar o JSON da resposta).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` roda os casos novos, e antes de T-03 a T-05 os de RF-02 e RF-04 falham. Os testes legados existentes continuam sem edição. Depois de T-05 todos passam.
Arquivos:

- `test/session.test.ts`

### T-03 — Unseal com várias senhas em `unsealSession`

Reescrever o trecho de unseal de `unsealSession` (D-01 a D-03, D-06): lista de senhas `[password, ...extras]` sem as extras iguais a `password`, `undefined` e `[]` tratados como sem extras. Fase 1 tenta todas as senhas com o seal atual. Fase 2 (legado, 1 iteração) tenta todas as senhas, só se `legacySealFallback !== false` e `iterations !== 1`. Só `"Bad hmac value"` avança para a próxima senha. Qualquer outro erro é relançado. Se nada abrir, relançar o erro original. Marcar `kExtraSeal` quando abrir com índice > 0 e `kLegacySeal` na fase legada. A checagem de expiração (`maxAge`/`idleTimeout`) fica depois do laço, inalterada. `sealSession` continua selando só com `config.password`.

Cobre: RF-02, RF-03, RF-05, RF-06
Depende de: T-01
Aceite: com T-02 pronta, passam os casos de RF-02, RF-05 e RF-06 (inclusive a ordem legado × extras e `legacySealFallback: false`). Sem extras o comportamento é idêntico: uma tentativa atual, uma legada, e o erro original relançado. Os testes legados atuais passam sem edição.
Arquivos:

- `src/utils/session.ts`

### T-04 — Reselar com `password` em `getSession`

Em `getSession`, ler e apagar `kExtraSeal` antes do `Object.assign(session, unsealed)`, como é feito com `kLegacySeal`. Ampliar a condição de reseal para `legacySeal || extraSeal || shouldSlide(...)`, reaproveitando `updateSession` (D-05). Sessão vinda do header não é reselada, e com `cookie: false` não há `Set-Cookie`, como hoje.

Cobre: RF-03, RF-04
Depende de: T-03
Aceite: passam os casos de RF-03 e RF-04 de T-02. A resposta traz `Set-Cookie` selado com `password`, que abre com B e não abre com A, preservando `id`, `createdAt` e `data`. Sessão por header não emite `Set-Cookie`, e `kExtraSeal` não aparece na sessão devolvida.
Arquivos:

- `src/utils/session.ts`

### T-05 — Documentar a rotação de senha

Adicionar a seção curta "Rotating the password" em `docs/4.examples/handle-session.md`, após a seção de senha. Cobrir: o uso de `extraUnsealPasswords`, a ordem (mais recente primeiro), o reseal automático, a lista curta (custo de PBKDF2), o mínimo de 32 caracteres, a remoção da extra após a migração e o limite de sessões vindas de header, que não migram. Rodar `pnpm fmt`: se `docs/2.utils/4.security.md` for regenerado pelo automd a partir do JSDoc, manter a mudança. Não editar esse arquivo à mão.

Cobre: RF-01, RF-04
Depende de: T-01, T-04
Aceite: a seção existe e descreve o comportamento implementado. `pnpm fmt` e `pnpm lint` não deixam diferença nem erro. A docs gerada (se houver) reflete o JSDoc de `extraUnsealPasswords`.
Arquivos:

- `docs/4.examples/handle-session.md`
- `docs/2.utils/4.security.md` (somente se regenerado por `pnpm fmt`)

### T-06 — Verificação final e regressão

Rodar `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` (suíte completa). Corrigir só o que dependa da mudança, sem perder o que os testes verificam. Conferir que não houve export novo em `src/index.ts` nem mudança em `src/types/context.ts`.

Cobre: RF-07
Depende de: T-02, T-03, T-04, T-05
Aceite: os quatro comandos terminam sem falhas. `git diff --stat` mostra só os arquivos listados nas tarefas T-01 a T-05.
Arquivos:

- `test/session.test.ts` (somente se algum ajuste for necessário)
