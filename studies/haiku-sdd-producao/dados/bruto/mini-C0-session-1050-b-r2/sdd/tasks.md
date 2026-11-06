# Tarefas de implementação — `extraUnsealPasswords` nas sessões

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08). Seguindo o Bug Fix Workflow do `AGENTS.md`, os testes (T-02, T-03) vêm antes da implementação (T-04, T-05) e devem falhar até lá.

### T-01 — Adicionar o campo `extraUnsealPasswords` ao `SessionConfig`

Adicionar `extraUnsealPasswords?: string[]` logo após `password` (`password` continua `string`), com a TSDoc da techspec 4.1: somente unseal, tentadas após `password`, mesmo requisito de entropia (mín. 32 caracteres), sessões via header não migram, manter 1 a 3 itens e remover depois de `maxAge`, senha extra comprometida continua abrindo sessões. Não exportar nenhum nome novo.

Cobre: RF-01
Arquivos: `src/utils/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` aceita `{ password, extraUnsealPasswords: [antiga] }` e continua rejeitando `password` que não seja `string`; `pnpm vitest run test/unit/package.test.ts` passa (API pública sem nome novo).

### T-02 — Testes de aceitação, selo e rejeição de senhas

Em `test/session.test.ts`, com `describeMatrix` e duas ou mais senhas fixas (`P0` a `P3`, 32+ caracteres), criar cookies com `seal(...)` e usar uma rota própria com a config de rotação (padrão de `/strict`). Testes:

- aceita sessão selada com senha extra, via cookie e via header `x-h3-test-session`, com mesmo `id`, `createdAt` e `data` (RF-03);
- sela só com `password`: após criar e atualizar a sessão, o cookie abre com P2 e não abre com P1 (`Bad hmac value`) (RF-02);
- rejeita senha desconhecida: selo de P0 gera `id` novo, `data` vazio e `ctx.errors` vazio (RF-04);
- ordem e várias extras: `[P3, P1]` abre sessão de P1; entre extras escolhe a primeira que abrir; `password` atual tem prioridade (RF-03, RF-09).

Cobre: RF-02, RF-03, RF-04, RF-09
Arquivos: `test/session.test.ts`
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` roda em `web` e `node`; antes de T-04 os testes de RF-03, RF-04 e de ordem falham (o de RF-02 pode passar, pois documenta o comportamento atual); nenhum teste existente é alterado.

### T-03 — Testes de migração, expiração, legado e regressão

Em `test/session.test.ts`, com `describeMatrix`:

- migra sessão de senha extra: `Set-Cookie` presente, abre com P2, preserva `id`, `createdAt` e `data`; via header não há `Set-Cookie` (RF-05);
- `maxAge` e `idleTimeout` com senha extra: usar `vi.useFakeTimers({ toFake: ["Date"] })`; sessão vencida selada com P1 é rejeitada e substituída; a migrada mantém `createdAt` (RF-06);
- legado: selo com 1 iteração PBKDF2 e P1 é aceito e resselado com P2 e iterações atuais (`unseal(resealed, P2, sealDefaults)`); com `legacySealFallback: false` é rejeitado (RF-07);
- `seal` customizado com iterações diferentes das padrão: sessão de P1 selada com essas opções abre (RF-07);
- sem regressão: `extraUnsealPasswords: []` e ausente se comportam como hoje (RF-08);
- erro de política não tenta outras senhas: sessão expirada selada com `password` é rejeitada sem depender de P1 (D-05; aceitar sinal fraco, ver R-10).

Cobre: RF-05, RF-06, RF-07, RF-08, RF-09
Arquivos: `test/session.test.ts`
Depende de: T-02
Aceite: `pnpm vitest run test/session.test.ts` roda em `web` e `node`; antes de T-04 e T-05 os testes de migração, legado e `maxAge`/`idleTimeout` com senha extra falham; os testes existentes seguem passando sem ajuste.

### T-04 — Implementar o unseal com senhas extras

Criar o helper interno não exportado `unsealWithPasswords(sealed, config, sealOptions)` no fim de `src/utils/session.ts` (D-08) e fazer `unsealSession` usá-lo no lugar do bloco `try/catch` atual. Contrato (techspec 4.2/4.3):

- fase 1: `[config.password, ...(config.extraUnsealPasswords ?? [])]` com as iterações atuais, parando na primeira que abrir;
- só `Error("Bad hmac value")` avança para a próxima senha; qualquer outro erro é relançado (D-05);
- fase 2 (legada, com `iterations: 1` em `encryption` e `integrity`) só se `legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1`; manter o TODO do v3 junto dela;
- marcar `kLegacySeal = true` se abriu na fase 2 ou com índice > 0, respeitando `unsealed` nulo;
- esgotadas as tentativas, relançar o último `"Bad hmac value"`;
- `maxAge` e `idleTimeout` continuam aplicados depois do unseal, como hoje, e `sealSession` não muda (selo sempre com `config.password`).

Cobre: RF-02, RF-03, RF-04, RF-06, RF-07, RF-08
Arquivos: `src/utils/session.ts`
Depende de: T-01, T-02, T-03
Aceite: `pnpm vitest run test/session.test.ts` passa por inteiro em `web` e `node`, incluindo os testes de T-02 e T-03 (exceto os de migração que dependem de T-05, se separados); sem `extraUnsealPasswords` as chamadas de crypto são as de hoje (`password` atual e depois legada).

### T-05 — Migrar a sessão para a senha atual (reseal)

Confirmar que `getSession` já remove `kLegacySeal` e chama `updateSession` apenas para sessões de cookie, resselando com `config.password` e sem tocar em `createdAt`; não alterar a lógica. Atualizar o comentário do reseal em `getSession` para dizer que ele cobre cookies legados e cookies abertos com senha extra, e que o header não é resselado.

Cobre: RF-05, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: o teste de migração de T-03 passa (cookie resselado abre com P2, preserva `id`, `createdAt` e `data`; header sem `Set-Cookie`); o diff em `getSession` é só de comentário.

### T-06 — Documentação

Adicionar a subseção "Rotating the password" em `docs/4.examples/handle-session.md`, com exemplo de `password` nova e a antiga em `extraUnsealPasswords`, a migração automática por cookie, o limite do header, remover a senha antiga após `maxAge` e o custo de CPU por senha extra. Rodar `pnpm fmt` para regenerar `docs/2.utils/4.security.md` via `automd` e conferir que o diff é só o esperado.

Cobre: RF-01, RF-05
Arquivos: `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`
Depende de: T-04, T-05
Aceite: a subseção existe e o exemplo é coerente com a API; `git diff` de `docs/2.utils/4.security.md` só traz mudanças geradas pela TSDoc; `pnpm lint` passa.

### T-07 — Validação final

Rodar, nesta ordem: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm fmt` e `pnpm test`. Conferir que nenhum teste existente foi alterado (ou, se foi, que mantém o que verificava) e que cada teste de regressão de T-02 e T-03 falha sem a implementação de T-04.

Cobre: RF-01, RF-08, RF-09
Arquivos: nenhum (somente verificação)
Depende de: T-06
Aceite: todos os comandos terminam sem erro; a suíte existente passa sem perda de cobertura com `extraUnsealPasswords` ausente ou `[]`; `git status` mostra apenas os arquivos listados nas tarefas T-01 a T-06.
