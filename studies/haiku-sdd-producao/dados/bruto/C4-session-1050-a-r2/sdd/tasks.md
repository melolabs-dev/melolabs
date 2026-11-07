# Tarefas de implementação — Múltiplas senhas de unseal nas sessões (h3js/h3#1050, variante B)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08).

Regra de bug fix do `AGENTS.md`: os testes de regressão são escritos antes da implementação e precisam falhar antes da mudança (T-01). Verificação de `pnpm lint` e `pnpm typecheck` separadamente, porque `pnpm lint` não roda o typecheck.

---

### T-01 — Escrever os testes da lista de senhas antes da implementação

Cria o bloco `describe("password list")` com os casos de RF-02 a RF-09 (techspec §5), usando `describeMatrix` (web e node) e `ctx.app` novo por teste. Os casos de RF-03, RF-06 e RF-08 precisam falhar antes da mudança. Como `password: [...]` hoje não compila nem roda, a falha é verificada por `tsc` e pelo comportamento de runtime dos testes com a lista.

Cobre: RF-02, RF-03, RF-04, RF-06, RF-07, RF-08, RF-09 (testes; a implementação vem nas tarefas seguintes)
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` roda o novo bloco; os casos de RF-03, RF-06 e RF-08 falham no estado atual; os testes de senha única (RF-05) do arquivo continuam passando sem alteração de expectativa; `pnpm typecheck` acusa o erro de tipo de `password: [...]`.
Arquivos: `test/session.test.ts`

---

### T-02 — Aceitar `string | string[]` em `SessionConfig.password`

Troca o tipo de `password` em `SessionConfig` por `string | string[]`, com anotação explícita (exigida por `isolatedDeclarations`). Atualiza a doc do campo (`src/utils/session.ts:41-47`) dizendo que a primeira senha sela e as demais só desselam, que a remoção de uma senha da lista é a única forma de revogação, que o custo cresce com o tamanho da lista e que uma senha curta fora da primeira posição nunca abre sessões (D-07). Adiciona o teste de tipo.

Cobre: RF-01
Depende de: nenhuma
Aceite: `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` passa em `test/unit/types.test-d.ts`; `useSession({ password: ["a…32+", "b…32+"], … })` compila; `pnpm typecheck` passa.
Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Criar os helpers internos `toPasswordList` e `unsealWithPasswords`

Adiciona em `src/utils/internal/session.ts` (no fim do arquivo):

- `toPasswordList(password)`: normaliza `string` em `[string]`; lança `Error("Session password list is empty")` para `[]`.
- `unsealWithPasswords(sealed, passwords, opts)`: tenta `unseal` com cada senha, na ordem, e retorna a primeira que validar. Se todas falharem, relança o erro da última tentativa (D-04). Não para em erros que não sejam "Bad hmac value", para que uma senha curta na lista não bloqueie as demais.

`iron-crypto.ts` não muda. Assinaturas exatas em techspec §4.

Cobre: RF-03, RF-04, RF-06
Depende de: T-02
Aceite: testes unitários em `test/unit/` (opcional, mas recomendados) cobrem: lista com senha errada seguida da correta retorna o payload; todas erradas relançam o erro da última; `[]` lança a mensagem com "empty"; senha curta na posição 0 seguida de senha válida ainda abre o cookie. `pnpm typecheck` passa, sem ciclo de import (o arquivo importa de `../session.ts` apenas por tipo).
Arquivos: `src/utils/internal/session.ts`, `test/unit/` (teste opcional)

---

### T-04 — Validar lista vazia antes do `try` em `getSession`, `useSession`, `updateSession`, `sealSession` e `unsealSession`

Chama `toPasswordList(config.password)` no início de `getSession`, antes do cache e antes do `try`/`.catch(() => {})` de `session.ts:196-197`, para que o erro de configuração não seja engolido (D-05). Repete a chamada em `sealSession` e `unsealSession`, porque são exportadas (`src/index.ts:208-209`).

Cobre: RF-06
Depende de: T-03
Aceite: `password: []` em `useSession` e em `getSession` gera erro não tratado com mensagem contendo "empty" (`t.errors[0].unhandled === true`, limpar com `t.errors = []`, padrão de `test/errors.test.ts:114-116`); os testes de RF-06 de T-01 passam.
Arquivos: `src/utils/session.ts`

---

### T-05 — Selar sempre com a primeira senha

`sealSession` (`src/utils/session.ts:300-304`) passa a usar `toPasswordList(config.password)[0]`. Como `updateSession` (`:266-267`) e os resels de `getSession` (`:214-215`) passam por `sealSession`, todas as selagens usam a primeira senha. Não grava índice ou id de senha no cookie (D-06).

Cobre: RF-02
Depende de: T-03
Aceite: com `password: ["A", "B"]`, após `updateSession` o cookie abre com `unseal(cookie, A)` e é rejeitado com `unseal(cookie, B)` (teste de T-01 passa).
Arquivos: `src/utils/session.ts`

---

### T-06 — Desselar com a lista em `unsealSession`, incluindo o fallback legado

Em `unsealSession` (`src/utils/session.ts:317-344`), troca `unseal` por `unsealWithPasswords`. Mantém a ordem de D-03: primeiro todas as senhas com as opções atuais; só se a última tentativa falhar com "Bad hmac value" e `legacySealFallback` estiver ativo, todas as senhas com 1 iteração de PBKDF2. Não altera `maxAge` e `idleTimeout` (`:349-365`): a expiração independe da senha que abriu a sessão (D-08).

Cobre: RF-03, RF-04, RF-05, RF-07, RF-08
Depende de: T-03, T-04
Aceite: os testes de T-01 de RF-03, RF-04, RF-07 e RF-08 passam. RF-03: cookie com `B` e `["A", "B"]` preserva `id` e `createdAt`. RF-04: cookie com `C` gera sessão nova sem erro não tratado. RF-07: cookie com `B` vencido por `maxAge` vira sessão nova. RF-08: cookie legado com `B` abre e é resselado com `A`; com `legacySealFallback: false` vira sessão nova. A suíte de `test/session.test.ts` sem alteração de expectativas continua passando (RF-05).
Arquivos: `src/utils/session.ts`

---

### T-07 — Rotação sem invalidar sessões ativas e robustez a cookie corrompido

Cobre os cenários de rotação e de integridade que dependem de T-05 e T-06, e o cenário de cabeçalho de sessão:

- rotação: cookie com `A`; config `["B", "A"]` lê a sessão; após uma escrita o cookie abre com `B`. Config `"B"` trata a sessão como inexistente.
- cookie corrompido (bytes trocados) com lista vira sessão nova, sem erro não tratado (risco de "Bad hmac" mascarado).
- cabeçalho de sessão (`sessionHeader`, `src/utils/session.ts:178-186`) com o cenário RF-03 carrega a sessão; não há resel, então o cabeçalho continua com a senha antiga até expirar.

Cobre: RF-09, RF-03, RF-04
Depende de: T-05, T-06
Aceite: os casos novos de `test/session.test.ts` passam em web e node; nenhum erro não tratado aparece em `t.errors` nos cenários de sessão nova.
Arquivos: `test/session.test.ts`

---

### T-08 — Documentação da rotação de senhas

Atualiza a documentação de sessão:

- `docs/4.examples/handle-session.md`: nota sobre rotação, perto de `:37`. Procedimento: adicionar a nova senha na primeira posição, manter a antiga pelo menos por `maxAge` (ou `idleTimeout`) e só então removê-la. Sessões sem `maxAge`/`idleTimeout` não expiram, então a remoção desloga quem não escreveu. Sessões de cabeçalho não são resseladas.
- `docs/2.utils/4.security.md`: é gerado pelo `automd` a partir do JSDoc de `session.ts`. Não editar à mão; regenerar com `pnpm fmt`.

Cobre: RF-01, RF-09
Depende de: T-02, T-05, T-06
Aceite: `pnpm fmt` roda sem diferença manual em `docs/2.utils/4.security.md`; o texto do JSDoc aparece no arquivo gerado; a nota de rotação está em `docs/4.examples/handle-session.md`.
Arquivos: `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`, `src/utils/session.ts` (JSDoc)

---

### T-09 — Verificação final e regressão

Roda a verificação completa e confirma que nada fora do escopo mudou. Confirma que `src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/bench/session.ts` não foram alterados e que nenhum export público novo foi adicionado.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
Aceite: `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit` passam; `pnpm typecheck` passa; `pnpm lint` passa; `pnpm build` gera as declarações sem erro de `isolatedDeclarations`; `git diff --stat` não lista os arquivos de fora do escopo.
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`, `test/unit/types.test-d.ts`, `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`
