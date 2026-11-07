# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-08), `sdd/techspec.md` (D-01 a D-07).

Ordem geral: primeiro os testes que reproduzem o problema (fluxo de bug fix do `AGENTS.md`), depois o campo de tipo, a validação, o laço de tentativas e, por fim, a regravação e a verificação final.

---

### T-01 — Escrever os testes de regressão antes da implementação

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Depende de: nenhuma

Aceite: adicionar em `test/session.test.ts` os casos 1 a 10 da seção "Estratégia de testes" do techspec, com `describeMatrix` (web e node). Rodar `pnpm vitest run test/session.test.ts` e confirmar que os casos 1, 5, 7 e 8 falham pelo motivo esperado (senha antiga não aberta; campo inexistente). Os 58 testes atuais continuam passando. O caso 11 (tipo) fica para T-02. Não alterar código de `src/`.

Arquivos: `test/session.test.ts`

---

### T-02 — Adicionar o campo `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01

Depende de: T-01

Aceite: `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, com o JSDoc do techspec (ordem de tentativa, só abre, selagem sempre com `password`, tamanho mínimo, limite curto por causa do custo de PBKDF2, manter a senha antiga pelo tempo máximo de vida). `password` continua `string`. `pnpm typecheck` passa, incluindo o caso 11 (configuração com `extraUnsealPasswords: [...]` compila em `useSession` e `getSession`). O campo ainda não é usado pelo código, então o caso 8 continua vermelho até T-03.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-03 — Validar as senhas extras antes de qualquer mutação do contexto

Cobre: RF-08, RF-04

Depende de: T-02

Aceite:
- `assertExtraUnsealPasswords(config)` existe em `src/utils/internal/session.ts` e usa o mínimo `max(encryption.minPasswordlength, integrity.minPasswordlength)` do selo efetivo (`{ ...sealDefaults, ...config.seal }`).
- A função é a primeira instrução de `getSession`, antes de `context.sessions[sessionName]` ser preenchido, e também roda em `unsealSession`.
- Entrada não-string ou curta lança erro com a forma `extraUnsealPasswords[0] must be at least 32 characters`, sem nunca incluir o valor da senha.
- `password` curta não é validada (RF-04).
- Caso 8 passa, incluindo a verificação de que a senha curta não aparece na mensagem.
- Caso 4 (sem extras, cookie com outra senha é inválido) continua passando.

Arquivos: `src/utils/internal/session.ts`, `src/utils/session.ts`, `test/session.test.ts`

---

### T-04 — Laço de tentativas de abertura: senha atual, depois as extras

Cobre: RF-02, RF-04, RF-06

Depende de: T-03

Aceite:
- Em `src/utils/internal/session.ts` existem `kExtraUnsealSeal`, `unsealWithPasswords` e o `unsealWithFallback` interno (corpo atual do `try/catch` de `unsealSession`, sem mudança de lógica).
- `unsealWithPasswords` tenta `password` e depois cada extra, na ordem. Só `Bad hmac value` avança para a próxima senha. Qualquer outro erro é relançado na hora. Se todas falharem, relança o último erro de HMAC.
- `unsealSession` mantém a mesma assinatura. As verificações de `maxAge` e `idleTimeout` ficam depois do laço, uma vez só (D-07).
- Casos 1 (sessão com `A`, configuração `B` com extra `[A]`) e 2 (cookie com a senha atual não repete tentativas: mesmo número de `deriveBits` sem extras) passam.
- Caso 9 (cookie expirado com extras `[A, C]`: `deriveBits` não é chamado) passa.
- Caso 10 (cookie forjado com extras `[A, C]`: uma derivação por senha, sem exceção, sessão nova) passa.
- Caso 4 continua passando.

Arquivos: `src/utils/internal/session.ts`, `src/utils/session.ts`, `test/session.test.ts`

---

### T-05 — Garantir que a selagem usa sempre `password`

Cobre: RF-03

Depende de: T-04

Aceite: `sealSession` continua chamando `seal(session, config.password, ...)` e nenhum caminho de escrita lê `extraUnsealPasswords` (D-04). Caso 3 passa: `updateSession` com `password: B` e extra `[A]` gera um `Set-Cookie` que abre com `B` e não abre com `A`. Não há mudança em `src/` nesta tarefa, a menos que o caso 3 revele uso indevido da lista.

Arquivos: `test/session.test.ts`, `src/utils/session.ts` (somente se necessário)

---

### T-06 — Regravar o cookie quando ele é aberto com senha extra

Cobre: RF-07

Depende de: T-04

Aceite:
- Em `getSession`, `kExtraUnsealSeal` é lido e apagado junto de `kLegacySeal`, antes de `Object.assign(session, unsealed)`, para que o símbolo não vaze para a sessão.
- A condição de regravação passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))` (D-05).
- Sessões de header (`sessionFromCookie === false`) não são regravadas (D-05).
- Caso 7 (`idleTimeout` pela metade, senha extra) passa: o `Set-Cookie` abre com `B` e não com `A`.
- A regravação ocorre uma vez por sessão antiga, porque o cookie novo abre com a primeira tentativa.
- Caso 4 e os testes existentes de legado (`kLegacySeal`) continuam passando.
- **Ponto a confirmar** (ver seção abaixo): se o usuário preferir a leitura literal do RF-07, remover `extraSeal` da condição. Esta tarefa implementa a recomendação do techspec.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-07 — Expiração e header valem para sessões abertas com senha extra

Cobre: RF-05, RF-06

Depende de: T-04

Aceite:
- Caso 5 (sessão com `A` enviada em `x-h3-session` ou no nome configurado em `sessionHeader`, com `A` nas extras) abre a sessão.
- Caso 6 (`maxAge` vencido, senha extra): sessão tratada como expirada, sem dados. Confirma que a expiração é verificada uma vez, depois da abertura, e que uma senha extra não estende a vida da sessão.
- Os casos 5 e 6 usam `vi.useFakeTimers({ toFake: ["Date"] })` quando a expiração é o foco.
- Testes de expiração e `idleTimeout` já existentes continuam passando sem mudança de expectativa.

Arquivos: `test/session.test.ts`, `src/utils/session.ts` (somente se algum caso revelar falha)

---

### T-08 — Verificação final e revisão de regressões

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Depende de: T-03, T-05, T-06, T-07

Aceite: verificar nesta ordem:
1. `pnpm vitest run test/session.test.ts` passa com os 58 testes atuais mais os novos (caso 11 é verificado por `pnpm typecheck`).
2. `pnpm vitest run` (suíte completa) passa.
3. `pnpm lint` (`oxlint . && oxfmt --check .`) e `pnpm typecheck` (`tsc --noEmit`) passam.
4. Confirmar que os casos 1, 5, 7 e 8 falharam antes da implementação (registro de T-01) e passam agora.
5. Conferir que nenhum arquivo fora da lista de "Arquivos a alterar" do techspec foi tocado: `src/utils/internal/iron-crypto.ts`, `src/utils/cookie.ts`, `src/index.ts`, `docs/`, `CHANGELOG.md` ficam sem mudança.
6. Conferir que `src/utils/internal/session.ts` e `src/utils/session.ts` seguem a convenção de tamanho do `AGENTS.md` ou que o excesso está justificado (D-06).

Arquivos: nenhum arquivo novo; leitura e execução de testes e lint

---

## Pontos a confirmar antes de implementar

- **D-05 (afeta T-06):** regravar na primeira leitura com senha extra (recomendado no techspec) ou só em escrita e deslizamento, como o texto literal do RF-07.
- **D-03 (afeta T-03):** senha extra inválida derrubar todas as requisições com `getSession` (recomendado, conforme RF-08) ou alguma degradação mais suave.

Se o usuário não responder, seguir as recomendações do techspec.
