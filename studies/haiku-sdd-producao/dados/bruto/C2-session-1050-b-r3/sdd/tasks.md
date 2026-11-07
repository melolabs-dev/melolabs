# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08, casos de teste 1 a 11).

A ordem segue o fluxo de correção do `AGENTS.md`: os testes novos são escritos e vistos falhando (T-03) antes da mudança de comportamento (T-04 em diante).

Ordem sugerida: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09.

---

### T-01 — Adicionar `extraUnsealPasswords` ao `SessionConfig`

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:** `pnpm typecheck` passa com `SessionConfig` com e sem `extraUnsealPasswords`. O campo é `string[]` opcional, com JSDoc no mesmo estilo dos demais campos (senhas anteriores, usadas só para abrir sessões, com o mesmo tamanho mínimo de `password`). `password` continua `string`. Nenhum export novo em `src/index.ts`.

**Arquivos:** `src/utils/session.ts`

---

### T-02 — Criar o símbolo interno `kRotatedSeal`

**Cobre:** RF-04

**Depende de:** nenhuma

**Aceite:** `kRotatedSeal` é declarado em `src/utils/internal/session.ts`, logo após `kLegacySeal`, com `Symbol.for("h3.internal.session.rotated-seal")` e `/* @__PURE__ */`. Não é exportado pelo pacote público. `pnpm lint` passa.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-03 — Escrever os testes novos e confirmar que falham

**Cobre:** RF-02, RF-03, RF-04, RF-06, RF-07, RF-08

**Depende de:** T-01

**Aceite:** os casos 1, 2, 3, 5, 6 e 7 do techspec são escritos em `test/session.test.ts` com `describeMatrix` (web e node), seguindo o padrão dos testes de legado (`test/session.test.ts:134-186`). Os casos 8, 9 e 10 são guardas de comportamento que já passam hoje. Ao rodar `pnpm vitest run test/session.test.ts`, os casos 1, 2, 3, 5, 6 e 7 falham pelo motivo esperado (por exemplo, o cookie com `senhaAntiga` não abre). Nenhuma asserção de teste existente é alterada.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Extrair `unsealWithPassword` sem mudar o comportamento

**Cobre:** RF-05

**Depende de:** T-03

**Aceite:** existe o helper interno `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`, não exportado, com o `try/catch` atual do fallback de 1 iteração (`src/utils/session.ts:325-347`). `unsealSession` continua fazendo uma única tentativa, com `config.password`. A assinatura pública de `unsealSession` não muda. A suíte existente de `test/session.test.ts` passa sem alteração de asserções.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Tentar as senhas em ordem dentro de `unsealSession`

**Cobre:** RF-02, RF-08

**Depende de:** T-02, T-04

**Aceite:**
- `unsealPasswords(config)` devolve `password` seguido de `extraUnsealPasswords`, na ordem declarada, sem duplicatas (D-07: uma extra igual a `password` é descartada, sem erro).
- O loop avança para a próxima senha somente quando o erro é `"Bad hmac value"`. Qualquer outro erro é lançado na hora (D-02).
- Se nenhuma senha validar, o erro lançado é o da primeira tentativa, com a mesma mensagem de hoje.
- O controle de sucesso usa uma flag `found`, e não `if (!unsealed)`, para que payload vazio continue igual ao atual.
- Quando a sessão abre com uma extra (índice maior que 0), o resultado recebe `kRotatedSeal`.
- Os casos 3 e 6 passam. O trecho de leitura do caso 1 passa.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-06 — Validar as senhas extras antes de abrir qualquer cookie

**Cobre:** RF-07

**Depende de:** T-01, T-04

**Aceite:**
- `assertExtraUnsealPasswords(config, sealOptions)` lança erro para `extraUnsealPasswords` que não seja array, para item que não seja `string`, para string vazia e para string abaixo do mínimo. O mínimo é `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`, usando as opções efetivas de seal.
- A mensagem segue o formato `Invalid session extra password at extraUnsealPasswords[${index}]: must be a string of at least ${min} characters` e não inclui o valor da senha (R-05).
- A validação é chamada em `getSession` antes de `context.sessions[sessionName] = session` (perto de `src/utils/session.ts:167`), fora do `.catch` que engole falhas de unseal (R-08, R-10). Também é chamada no início de `unsealSession`, para quem usa a API pública.
- O caso 7 passa, incluindo a verificação de que a mensagem não contém `"curta"`.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Regravar a sessão aberta com senha extra e selar só com `password`

**Cobre:** RF-03, RF-04

**Depende de:** T-02, T-05

**Aceite:**
- Em `getSession`, `kRotatedSeal` é lido e removido antes de `Object.assign(session, unsealed)` (perto de `src/utils/session.ts:208`), no mesmo ponto em que `kLegacySeal` é removido. A sessão em memória não contém o símbolo (R-07).
- A condição de regravação (perto de `src/utils/session.ts:214`) passa a incluir `rotatedSeal`, e mantém `sessionFromCookie`, porque sessões de header não regravam cookie.
- O caso 1 passa por completo: o novo cookie abre com `senhaNova` e não abre com `senhaAntiga`.
- O caso 2 passa: uma sessão nova criada com extras configurados não abre com a extra.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Cobrir os casos de borda: legado, expiração, colisão e erro sem avanço

**Cobre:** RF-06

**Depende de:** T-05, T-07

**Aceite:**
- Caso 4 passa: sessão legada (1 iteração) selada com a extra abre e é regravada com 8192 iterações (R-02).
- Caso 5 passa: sessão com `createdAt` antigo e cookie com a extra falha com `"Session expired!"`, igual ao teste de `maxAge` existente.
- Caso 8 passa: sessão selada com `password` abre normalmente quando `extraUnsealPasswords` contém o mesmo valor. Se não for possível medir o número de tentativas sem mock, isso é dito explicitamente na entrega.
- Caso 10 passa: cookie malformado (`"a*b"`) com extras, chamado por `unsealSession`, lança `"Incorrect number of sealed components"` e não tenta as extras (D-02).

**Arquivos:** `test/session.test.ts`

---

### T-09 — Verificação final, revisão de erros e de custo

**Cobre:** RF-05 (e confirma todos os RF anteriores)

**Depende de:** T-06, T-07, T-08

**Aceite:**
- `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam.
- O diff de `test/session.test.ts` só adiciona testes; nenhuma asserção existente mudou.
- `test/unit/package.test.ts` continua com a mesma lista de exports (sem nome público novo).
- As mensagens de erro novas e as que vêm do iron são revisadas: nenhuma inclui o valor da senha (R-05).
- Medição de custo com `pnpm bench:node` para cookie inválido com 0 e com N extras, registrada na entrega (R-01). Só altera `src/utils/internal/iron-crypto.ts` se o bench indicar necessidade.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`

---

## Fora destas tarefas

Itens que o PRD ou o techspec deixam para depois, sem tarefa de implementação:

- Documentação de `unsealSession` e `sealSession` em `docs/2.utils/4.security.md:56-60` (techspec, seção "Arquivos a alterar").
- Guia de migração: remover extras após a janela de `maxAge`/`idleTimeout` (R-03), e o fato de que clientes que só usam header convergem só na expiração (R-09, P-04).
- Entrada no changelog sobre a mudança de comportamento de `unsealSession` pública (R-11).
