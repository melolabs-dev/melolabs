# Tarefas: várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, testes 1 a 12).
Ordem: T-01 → T-02 → T-03 → T-04 → T-05. Seguir o fluxo de correção de bug do `AGENTS.md`: o teste precisa falhar antes da implementação.

Nota para todas as tarefas: as senhas `"nova"` e `"antiga"` do PRD têm menos de 32 caracteres, e o iron lança `"Password string too short"` com elas. Nos testes, usar senhas de pelo menos 32 caracteres, como `sessionConfig.password` em `test/session.test.ts`.

### T-01 — Escrever os testes de senhas extras (vermelho)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** nenhuma

Criar o bloco `describe("extraUnsealPasswords")` dentro do `describeMatrix` existente, logo após `describe("lazy creation")` (`test/session.test.ts:692`). Cobrir os testes 1 a 11 da seção 5 da techspec:

- Cookie selado com a senha extra abre, com o mesmo `id`, `createdAt` e `data.user === 1` (RF-01).
- `updateSession` grava cookie que abre com `password` e não abre com a extra (RF-02).
- Sem `extraUnsealPasswords` e com `[]`, cookie de outra senha cria sessão nova sem erro (RF-03).
- Cookie com senha desconhecida cria sessão nova com `data` vazio e resposta 200 (RF-04).
- `maxAge: 3600` e, em outro teste, `idleTimeout`, com `vi.useFakeTimers({ toFake: ["Date"] })`: cookie da senha extra expirado vira sessão nova (RF-05).
- Leitura seguida de `update({ visto: true })`: `Set-Cookie` abre com `password` e mantém o `id` (RF-06).
- Cookie legado (`iterations: 1`) selado com a extra abre e é resselado com `password` (RF-01 e RF-06).
- Cookie legado com a extra e `legacySealFallback: false` vira sessão nova.
- Cabeçalho `x-h3-test-session` selado com a extra devolve `id` e `data` (RF-07).
- `unsealSession` direto com `ttl` vencido rejeita com `"Expired seal"`, sem tentar outra senha (D-03).
- `unsealSession` direto com senha desconhecida rejeita com `"Bad hmac value"` (D-03).

Aceite:
- `pnpm vitest run test/session.test.ts` roda com os testes novos. Com a implementação atual, os testes 1, 6, 7 e 9 falham; os demais passam (são guardas de regressão).
- Os 59 testes da linha de base continuam verdes.
- Nenhum arquivo de `src/` foi alterado nesta tarefa.

Arquivos: `test/session.test.ts`

### T-02 — Campo `extraUnsealPasswords` no tipo público e JSDoc

**Cobre:** RF-08
**Depende de:** T-01

Adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`, logo depois de `password` (`src/utils/session.ts:48`) e antes do JSDoc de `maxAge`. Usar o JSDoc da seção 4.1 da techspec, que diz que as senhas só abrem sessões, que `password` é a única usada para selar, que a sessão aberta com uma senha extra é resselada na próxima gravação, que cada entrada precisa da mesma entropia de `password`, e que a lista deve ser curta e as entradas removidas após a expiração das sessões que elas podem ter emitido. Não validar comprimento nem entropia em tempo de execução (D-07). Não adicionar export novo (D-08).

Aceite:
- `pnpm typecheck` passa, e o teste 12 (uso de `extraUnsealPasswords: ["..."]` em `useSession`) compila sem erro de tipo.
- `pnpm vitest run test/unit/package.test.ts` continua passando (lista de exports inalterada).
- O JSDoc do campo contém as três informações exigidas pelo RF-08.

Arquivos: `src/utils/session.ts`

### T-03 — Laço de senhas em `unsealSession` e helper `unsealWithPassword`

**Cobre:** RF-01, RF-03, RF-04, RF-05, RF-07
**Depende de:** T-02

Em `unsealSession` (`src/utils/session.ts:312`), trocar a tentativa única (`:323-348`) por um laço sobre `[config.password, ...(config.extraUnsealPasswords || [])]`. Mover a tentativa de uma senha para um helper novo, não exportado, `unsealWithPassword(sealed, password, sealOptions, config)`, colocado depois de `unsealSession`. Regras (seção 4.3 e 4.4 da techspec):

- Na primeira senha que abrir, guardar o payload e sair do laço.
- Erro `"Bad hmac value"`: guardar como último erro e tentar a próxima senha.
- Qualquer outro erro: relançar na hora, sem tentar as demais.
- Se nenhuma abrir, relançar o último `"Bad hmac value"`.
- Fallback legado (`iterations: 1`, com `legacySealFallback !== false`) é aplicado dentro de `unsealWithPassword`, antes da próxima senha (D-04).
- O bloco de expiração (`:349-365`) fica exatamente como está (D-06).
- Não alterar `iron-crypto.ts` (D-02), nem as assinaturas de `unsealSession`, `getSession`, `updateSession`, `sealSession` ou `useSession`.

Aceite:
- Testes 1, 7 e 9 da T-01 passam.
- Testes 2, 3, 4, 5, 8, 10 e 11 continuam passando.
- `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa com todos os testes da linha de base.
- No diff, o bloco de expiração não aparece como alterado.

Arquivos: `src/utils/session.ts`

### T-04 — Confirmar a migração na regravação e a leitura sem escrita

**Cobre:** RF-02, RF-06
**Depende de:** T-03

Confirmar que a regravação migra a sessão para a senha atual sem mudar `src/utils/session.ts` (D-05: `updateSession` já sela com `config.password`). Se o teste 6 ou o 2 falhar aqui, a causa está em T-03, não na escrita. Adicionar um teste: sessão aberta com senha extra, lida sem `update`, não gera `Set-Cookie`. Esse teste protege a decisão D-05, que evita reabrir a corrida de `docs/4.examples/handle-session.md:183`.

Aceite:
- Teste 6 (`Set-Cookie` abre com `password`, mesmo `id`) passa.
- Teste 2 (`updateSession` não abre com a extra) passa.
- Teste novo (leitura sem escrita não gera `Set-Cookie`) passa nos dois targets, `web` e `node`.
- Nenhuma linha de `src/utils/session.ts` é alterada nesta tarefa, a não ser que um teste tenha falhado por causa de T-03.

Arquivos: `test/session.test.ts`

### T-05 — Verificação final da entrega

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08 (verificação conjunta)
**Depende de:** T-04

Rodar os comandos da seção 5 da techspec e conferir o resultado.

Aceite:
- `pnpm vitest run test/session.test.ts test/unit/package.test.ts` verde, com os 59 testes da linha de base e os novos.
- `pnpm lint` passa (`oxlint` e `oxfmt --check`).
- `pnpm typecheck` passa.
- `pnpm test` (lint, typecheck e cobertura) passa.
- `pnpm fmt` (automd) não altera `docs/`. Se ele alterar arquivos fora de `src/utils/session.ts` e `test/session.test.ts`, reverter e registrar no relatório.
- Não há alteração em `CHANGELOG.md`, `src/index.ts` nem `src/utils/internal/iron-crypto.ts`.

Arquivos: nenhum arquivo novo. Verificação sobre `src/utils/session.ts` e `test/session.test.ts`.
