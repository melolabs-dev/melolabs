# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Segue o fluxo do AGENTS.md: testes primeiro (devem falhar), depois a implementação mínima, depois a verificação geral. Nenhum nome público novo além de `SessionConfig.extraUnsealPasswords`.

### T-01 — Escrever testes de regressão (devem falhar antes da mudança)

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-08, RF-09
Arquivos: `test/session.test.ts`
Depende de: nenhuma
Aceite: novos casos dentro do `describeMatrix("session", ...)`, logo após o teste de `legacySealFallback: false`, usando `sessionConfig`, `seal`/`unseal`/`sealDefaults` e o padrão de cookie `h3-test=...`, com constantes `OLD` e `OTHER` (≥ 32 caracteres, diferentes de `password`). Casos: (1) abre sessão selada com senha extra, sem sessão nova; (2) sela sempre com `password` (token abre com `password` e falha com `Bad hmac value` só com a extra); (3) resela cookie aberto com senha extra, com mesmos `id`, `createdAt` e `data`; (4) não resela sessão de header (sem `Set-Cookie`); (5) rejeita senha desconhecida (`id` novo, `data` vazio, `t.errors` vazio); (6) `maxAge` e (7) `idleTimeout` com senha extra rejeitam a sessão; (8) legado de 1 iteração + senha extra aceito e resselado, e rejeitado com `legacySealFallback: false`. Rodar `pnpm vitest run test/session.test.ts` e confirmar que ao menos os casos de RF-02, RF-04 e RF-08 falham.

### T-02 — Adicionar o campo `extraUnsealPasswords` ao `SessionConfig`

Cobre: RF-01
Arquivos: `src/utils/session.ts`
Depende de: nenhuma
Aceite: `extraUnsealPasswords?: string[]` declarado logo após `password`, com o JSDoc do techspec (D-01: só abre, nunca sela, mesmos requisitos de `password`, lista curta, remover senha migrada ou vazada). `password` continua `string`. `pnpm typecheck` aceita uma config com `password` e `extraUnsealPasswords`, e rejeita `password` como array.

### T-03 — Criar o marcador interno `kExtraSeal`

Cobre: RF-04
Arquivos: `src/utils/internal/session.ts`
Depende de: nenhuma
Aceite: `kExtraSeal` exportado ao lado de `kLegacySeal` com `Symbol.for("h3.internal.session.extra-seal")` e `/* @__PURE__ */`; não é reexportado em `src/index.ts`. `pnpm vitest run test/unit/package.test.ts` continua passando.

### T-04 — Tentar várias senhas em `unsealSession` via helper interno

Cobre: RF-02, RF-05, RF-06, RF-07, RF-08
Arquivos: `src/utils/session.ts`
Depende de: T-02, T-03
Aceite: helper `unsealWithPasswords` (sem `export`, no fim do arquivo) monta `[password, ...extras]` sem repetidas; passada 1 com as iterações atuais em todas as senhas e passada 2 (legado, 1 iteração) só se `legacySealFallback !== false`, `iterations !== 1` e todas falharam com `"Bad hmac value"`; só esse erro avança para a próxima senha, e o último é relançado; qualquer outro erro sai na hora. `unsealSession` mantém a assinatura, usa o helper no lugar do `try/catch`, marca `kLegacySeal` no resultado legado e `kExtraSeal` quando uma extra abriu; as checagens de `maxAge` e `idleTimeout` ficam depois do unseal, inalteradas. Sem extras, a sequência de chamadas a `unseal` é a mesma de antes. Os testes de T-01 sobre RF-02, RF-05, RF-06 e RF-08 (exceto a parte de reseal) passam.

### T-05 — Resselar com `password` em `getSession` quando abriu com senha extra

Cobre: RF-03, RF-04
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: `getSession` lê e apaga `kExtraSeal` junto de `kLegacySeal` (sem vazar para `session`) e a condição de reseal inclui `extraSeal`, mantendo a guarda de sessão vinda de cookie. `sealSession` fica sem mudança e continua usando só `config.password`. Os testes de T-01 sobre RF-03 e RF-04 passam (token resselado abre só com `password`; header não gera `Set-Cookie`; payload resselado preserva `id`, `createdAt` e `data`).

### T-06 — Testes complementares de compatibilidade e de ordem de tentativas

Cobre: RF-07, RF-09
Arquivos: `test/session.test.ts`
Depende de: T-05
Aceite: casos adicionais com `describeMatrix`: `extraUnsealPasswords: []` equivale a ausente; sessão selada com `password` abre sem tentar extras; erro independente de senha (token malformado ou `Expired seal`) com extras gera sessão nova sem erro registrado. Todos passam com `pnpm vitest run test/session.test.ts`.

### T-07 — Verificação final

Cobre: RF-07, RF-09
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`
Depende de: T-06
Aceite: `pnpm vitest run test/session.test.ts` (inclusive os testes preexistentes, sem verificações removidas), `pnpm vitest run test/unit/package.test.ts`, `pnpm lint` e `pnpm typecheck` terminam sem falhas; `pnpm fmt` não gera diff em `docs/`.
