# Tarefas — várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-07).

Ordem de trabalho: testes novos primeiro, confirmados como falhando antes da implementação (fluxo de `AGENTS.md`). As tarefas T-02 a T-06 são testes; T-07 a T-09 são implementação.

### T-01 — Tipo público `extraUnsealPasswords`
**Cobre:** RF-07
**Depende de:** nenhuma
**Aceite:** `SessionConfig` tem o campo opcional `extraUnsealPasswords?: string[]`, com JSDoc no estilo dos campos vizinhos. O teste de tipo aceita `extraUnsealPasswords: ["senha-antiga"]` em `useSession` e recusa um valor que não seja `string[]` com `@ts-expect-error`. `pnpm vitest run test/unit` e `pnpm typecheck` passam.
**Arquivos:** `src/utils/session.ts`, `test/unit/types.test-d.ts`

### T-02 — Testes de abertura com senhas extras
**Cobre:** RF-01, RF-05
**Depende de:** T-01
**Aceite:** Dentro de `describe("extraUnsealPasswords")` em `test/session.test.ts`, com `describeMatrix`, há casos para cookie `h3-rot` e header `x-h3-rot-session`: sessão selada com `A`, lida com `password: B` e `extraUnsealPasswords: [A]`, carrega `id` e `data`. Há também um caso sem `extraUnsealPasswords` em que a sessão de `A` lida com `B` é tratada como inválida (`data` vazio). Os casos de extras falham antes da implementação; o caso sem extras passa.
**Arquivos:** `test/session.test.ts`

### T-03 — Testes de selagem sempre com `password`
**Cobre:** RF-02
**Depende de:** T-01
**Aceite:** Caso em que `updateSession` grava com `password: B` e `extraUnsealPasswords: [A]`. O cookie resultante abre com `B` e não abre só com `A` (com config só de `A`, a sessão lida é nova, com `id` diferente). O caso falha ou passa conforme o comportamento atual, e o resultado fica registrado na descrição da tarefa ao concluir.
**Arquivos:** `test/session.test.ts`

### T-04 — Testes de migração ao reselar
**Cobre:** RF-03, RF-04
**Depende de:** T-01
**Aceite:** Dois casos em `test/session.test.ts`:
- Sessão selada com `A`, lida com `password: B`, `extraUnsealPasswords: [A]` e `idleTimeout`. Usando `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:188-190`, passa-se metade da janela ociosa e a sessão é lida de novo. O cookie da resposta abre com `B` e não com `A`.
- Sessão legada (1 iteração) selada com `A`, com `extraUnsealPasswords: [A]`. Os dados são carregados e o cookie resselado abre com `B`, usando `unseal` com `sealDefaults` como em `test/session.test.ts:157`.

Os casos falham antes da implementação.
**Arquivos:** `test/session.test.ts`

### T-05 — Testes de validação das extras
**Cobre:** RF-06
**Depende de:** T-01
**Aceite:** Casos em `test/session.test.ts` para `""` e para uma senha curta (ex.: `"curta"`) em `extraUnsealPasswords`. Cada caso chama `getSession` dentro de um handler com `try/catch`, que devolve a mensagem de erro. A mensagem tem o formato `Invalid extraUnsealPasswords[<índice>]: must be a string of at least <mínimo> characters`. Os casos também verificam que o cookie não foi aberto. O erro não pode escapar, porque `test/_setup.ts:153` falha o teste com erro não tratado. Os casos falham antes da implementação.
**Arquivos:** `test/session.test.ts`

### T-06 — Teste de custo de CPU na ordem das tentativas
**Cobre:** RF-01, RF-05
**Depende de:** T-01
**Aceite:** Caso com cookie selado com `B` e `extraUnsealPasswords: [A, C]`. Espiona `crypto.subtle.deriveBits` como em `test/session.test.ts:722-735` e verifica exatamente 2 chamadas, ou seja, `password` é a primeira tentativa e as extras não são tentadas. O teste existente em `test/session.test.ts:722-735` continua com 2 chamadas sem extras. O caso falha antes da implementação.
**Arquivos:** `test/session.test.ts`

### T-07 — Validação das extras antes de abrir
**Cobre:** RF-06
**Depende de:** T-05
**Aceite:** Helper `assertExtraUnsealPasswords` no fim de `src/utils/session.ts` (D-05). O comprimento mínimo vem de `{ ...sealDefaults, ...config.seal }`, com o maior `minPasswordlength`. A chamada fica no início de `getSession`, antes de `context.sessions` ser preenchido, e no início de `unsealSession`. Os casos de T-05 passam. `password` não ganha validação antecipada.
**Arquivos:** `src/utils/session.ts`

### T-08 — Loop de senhas em `unsealSession`
**Cobre:** RF-01, RF-04, RF-05
**Depende de:** T-02, T-06, T-07
**Aceite:** `unsealSession` mantém a mesma assinatura e tenta `password` e depois cada extra, na ordem (D-01). Dentro de cada tentativa, o fallback legado de 1 iteração é tentado antes da senha seguinte (D-02, via `unsealWithPassword`). Só o erro `"Bad hmac value"` avança para a próxima senha (D-03). Se nenhuma senha abre, lança o erro da primeira tentativa, com sinalizador de sucesso em vez de `!unsealed` (D-04). Os casos de T-02 e T-06 passam, e o caso sem extras continua passando. `pnpm vitest run test/session.test.ts` passa sem alterar os testes existentes.
**Arquivos:** `src/utils/session.ts`

### T-09 — Selagem com `password` e reselagem pelos fluxos existentes
**Cobre:** RF-02, RF-03, RF-04
**Depende de:** T-03, T-04, T-08
**Aceite:** `sealSession` e a reselagem em `getSession` (`src/utils/session.ts:214-216`) usam sempre `config.password`. Sessão lida pelo header não é resselada (sem `Set-Cookie`). Os casos de T-03 e T-04 passam. Nenhuma selagem nova acontece a cada leitura: a migração ocorre só pelo fallback legado, pelo `shouldSlide` ou por `updateSession` (D-06).
**Arquivos:** `src/utils/session.ts`

### T-10 — Documentação da rotação de senha
**Cobre:** RF-07
**Depende de:** T-08
**Aceite:** JSDoc do campo completo em `SessionConfig`, já criado em T-01, revisado com a regra de validação. Seção nova em `docs/4.examples/handle-session.md`, perto da nota sobre sessões por header (linha 180), que cobre: como trocar a senha com `extraUnsealPasswords`; o limite prático de extras por causa do custo de PBKDF2; que sessões lidas pelo header não migram e continuam com a senha antiga até expirar; e que sem `idleTimeout` uma sessão só lida migra apenas ao expirar (D-06). `CHANGELOG.md` não é editado.
**Arquivos:** `docs/4.examples/handle-session.md`, `src/utils/session.ts`

### T-11 — Verificação final
**Cobre:** RF-05
**Depende de:** T-09, T-10
**Aceite:** `pnpm test` (lint, typecheck e cobertura) passa. Como o script `lint` não inclui o typecheck, `pnpm typecheck` roda separado. Os testes existentes de `test/session.test.ts` passam sem alteração, exceto os que dependam da nova opção. `pnpm build` gera o pacote sem erro. Nenhum outro módulo foi alterado, e `src/utils/cookie.ts` está intacto.
**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`, `test/unit/types.test-d.ts`, `docs/4.examples/handle-session.md`

---

## Fora destas tarefas

- Dividir `src/utils/session.ts`, que já passa de 200 linhas (débito pré-existente, techspec, Riscos). Deve virar tarefa separada, fora deste escopo.
- Rodar `pnpm fmt` no projeto inteiro: reescreve outros arquivos. Use apenas `oxfmt` nos arquivos alterados.
