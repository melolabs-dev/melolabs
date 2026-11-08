# Tarefas de implementação — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08).

A ordem segue as dependências. Os testes vêm antes da implementação (regra do `AGENTS.md`, Bug Fix Workflow).

**Pendência:** a techspec pede confirmação de três pontos antes de implementar: D-04 (leitura de string curta ou vazia passa a lançar erro), D-05 (limite de 4 senhas) e D-06 (migração no deslizamento de `idleTimeout`). T-03 e T-04 dependem da confirmação de D-04 e D-05.

---

### T-01 — Testes de comportamento antes da implementação

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-06

**Depende de:** nenhuma

**Aceite:** o arquivo novo usa `describeMatrix` e cobre os casos 1 a 11 da seção "Estratégia de testes" da techspec (aceitação da lista, selo com a primeira senha, leitura com qualquer senha da lista, senha desconhecida, ordem, legado com e sem `legacySealFallback`, lista vazia, senha curta na lista, limite de 5 senhas e custo de derivações). Rodado com `pnpm vitest run test/session-passwords.test.ts` antes de T-03 e T-04, os casos novos falham pelo motivo esperado (lista não aceita, mensagem ausente), e nenhum falha por erro de import ou de sintaxe.

**Arquivos:** `test/session-passwords.test.ts`

---

### T-02 — Teste de tipo para `SessionConfig["password"]`

**Cobre:** RF-01, RF-07

**Depende de:** nenhuma

**Aceite:** `test/unit/types.test-d.ts` ganha `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`. Antes de T-04 o `pnpm typecheck` falha nesse ponto, e depois de T-04 passa. Nenhum export novo é criado: o diff de `src/index.ts` fica vazio nesta tarefa.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-03 — Módulo interno de senhas da sessão

**Cobre:** RF-03, RF-04, RF-06

**Depende de:** T-01

**Aceite:** `src/utils/internal/session-passwords.ts` exporta `MAX_SESSION_PASSWORDS = 4`, `resolvePasswords` e `unsealWithPasswords`, com as assinaturas da techspec (seção "Contratos e assinaturas"). Os três são internos e não aparecem em `src/index.ts`. `resolvePasswords` lança as mensagens exatas `Session password list is empty`, `Too many session passwords (max 4)` e `Password string too short (min 32 characters required)`. `unsealWithPasswords` tenta as senhas em ordem, avança só em `"Bad hmac value"`, tenta 1 iteração por senha quando `legacyAllowed` é verdadeiro, marca `kLegacySeal` no sucesso legado e relança o último `"Bad hmac value"` se nenhuma abrir. `pnpm typecheck` e `pnpm lint` passam para o arquivo.

**Arquivos:** `src/utils/internal/session-passwords.ts`

---

### T-04 — Integrar a lista de senhas em `session.ts`

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-06

**Depende de:** T-02, T-03 (e confirmação de D-04 e D-05)

**Aceite:**
- `SessionConfig.password` passa a ser `string | string[]`, com JSDoc que diz que a primeira senha sela, as demais só abrem, e que cada uma tem pelo menos 32 caracteres.
- `resolvePasswords(config)` é chamado no começo de `getSession`, antes de `context.sessions[sessionName] = session`.
- `sealSession` usa `const [sealPassword] = resolvePasswords(config)`.
- `unsealSession` troca o `try { unseal(...) }` pela chamada a `unsealWithPasswords`, mantém as checagens de `maxAge` e `idleTimeout` e não altera o formato do cookie.
- `pnpm vitest run test/session-passwords.test.ts` passa nos modos `web` e `node`.
- `pnpm typecheck` passa, incluindo T-02.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Regressão das sessões existentes e da lista de exports

**Cobre:** RF-05, RF-07

**Depende de:** T-04

**Aceite:** `pnpm vitest run test/session.test.ts test/unit/` passa sem nenhuma alteração nesses arquivos (`git diff` vazio para `test/session.test.ts` e `test/unit/package.test.ts`). Os testes de legado com `legacySealFallback` e de validação de tamanho continuam verdes. O conjunto de exports de `src/utils/session.ts` e `src/index.ts` é igual ao anterior.

**Arquivos:** nenhum (somente execução e verificação)

---

### T-06 — Qualidade final do projeto

**Cobre:** RF-08

**Depende de:** T-05

**Aceite:** `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. Os testes de `test/session-passwords.test.ts` aparecem nos modos `web` e `node`. O tempo do arquivo novo fica na mesma ordem de grandeza de `test/session.test.ts`; se ficar muito maior, reduzir casos repetidos (risco 6 da techspec).

**Arquivos:** nenhum (somente verificação; correções de lint entram nos arquivos já listados acima)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-04 |
| RF-02 | T-01, T-04 |
| RF-03 | T-01, T-03, T-04 |
| RF-04 | T-01, T-03, T-04 |
| RF-05 | T-05 |
| RF-06 | T-01, T-03, T-04 |
| RF-07 | T-02, T-05 |
| RF-08 | T-06 |
