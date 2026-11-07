# Tarefas — Várias senhas de unseal nas sessões (#1050-b)

**Fontes:** `sdd/prd.md`, `sdd/techspec.md`
**Regra de execução:** seguir o fluxo de correção de bug do `AGENTS.md`. Cada caso de comportamento novo é escrito antes da implementação e precisa ser visto falhando. Os casos de guarda (que já valem hoje, como RF-02 e RF-05) passam desde o início, e isso é esperado.
**Arquivos de teste:** as tarefas T-03 a T-08 editam o mesmo arquivo (`test/session.test.ts`). Por isso são encadeadas, e não paralelas.
**Arquivo de código:** T-01, T-09, T-10 e T-11 editam `src/utils/session.ts`, e também são encadeadas.
**Commits:** nenhuma tarefa faz commit. Isso fica com quem revisa.

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01, RF-09
**Depende de:** nenhuma
**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]` com o tipo anotado explicitamente.
- `password` continua `string`.
- O JSDoc diz que as senhas só abrem sessões e nunca selam, que a sessão aberta com uma delas é resealada com `password`, que cada entrada segue o mínimo de `password`, que cada entrada extra custa uma derivação PBKDF2 a mais por cookie que não abre antes, e que a entrada pode ser removida depois de `maxAge` (ou `idleTimeout`).
- `pnpm typecheck` passa.
- `pnpm vitest run test/unit/package.test.ts` passa sem alteração.

**Arquivos:** `src/utils/session.ts`

---

### T-02 — Símbolo interno `kPreviousPasswordSeal`

**Cobre:** RF-04 (suporte ao reseal), RF-09
**Depende de:** nenhuma
**Aceite:**
- `kPreviousPasswordSeal` é exportado de `src/utils/internal/session.ts`, com `unique symbol` e `Symbol.for("h3.internal.session.previous-password-seal")`, no mesmo padrão de `kLegacySeal`.
- O símbolo não aparece em `src/index.ts` nem em nenhum arquivo público.
- `pnpm typecheck` passa e `pnpm vitest run test/unit/package.test.ts` passa sem alteração.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-03 — Testes de guarda: selagem com `password` e configuração sem extras

**Cobre:** RF-02, RF-05, RF-12
**Depende de:** T-01
**Aceite:**
- Antes de começar, registrar a linha de base: 59 testes passando em `test/session.test.ts` e `test/unit/package.test.ts`.
- Casos novos dentro de `describeMatrix("session", ...)`:
  - `updateSession` e `sealSession` com `password: "atual"` e extras `["antiga"]` geram cookie que abre com `unseal(cookie, "atual")` e falha com `"antiga"` (`"Bad hmac value"`).
  - Com extras ausentes e com `[]`, o selo abre igual ao de hoje e o número de `deriveBits` é o mesmo (2 para abrir, 1 para falhar com HMAC).
  - `password` curta continua rejeitada pelo `seal`, como hoje.
- Esses casos passam antes da implementação, porque são guardas. Isso é esperado e não é falha.
- Os testes existentes em `test/session.test.ts` passam sem alteração de expectativa.
- Os casos rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de ordem de tentativa e de duplicatas

**Cobre:** RF-03, D-07
**Depende de:** T-03
**Aceite:**
- Casos chamam `unsealSession({} as HTTPEvent, cfg, sealed)` diretamente, com `vi.spyOn(crypto.subtle, "deriveBits")` e `mockRestore` ao fim, como em `test/session.test.ts:723-735`.
- Com `password: "A"` e extras `["B", "C"]`:
  - selo com `B` → 3 derivações;
  - selo com `C` → 4 derivações;
  - selo com `A` → 2 derivações.
- Com `password: "A"` e extras `["A"]`, selo com `A` → 2 derivações (não há tentativa extra).
- Os casos com `B` e `C` falham antes de T-09, porque hoje a senha extra é ignorada. O caso com `A` e o de duplicata podem passar antes.
- Rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de validação de `extraUnsealPasswords`

**Cobre:** RF-08
**Depende de:** T-04
**Aceite:**
- Para cada entrada inválida (`""`, número, string com um caractere a menos que o mínimo, `null`, string no lugar de array), o teste chama `useSession` ou `getSession` dentro de um handler. O handler captura o erro e devolve `e.message`.
- O teste verifica que a mensagem contém `extraUnsealPasswords`.
- O teste verifica que, depois do erro, `event.context.sessions` não foi criado (D-04).
- Não usar `throw` direto no handler: `test/_setup.ts:127-153` registra erros não tratados e falha o teste.
- Um caso com entrada exatamente no mínimo é aceito e não gera erro.
- Os casos inválidos falham antes de T-10, porque hoje o campo não é validado. O caso aceito pode passar antes.
- Rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Testes de reseal com senha extra e de sessão de header

**Cobre:** RF-04, RF-10
**Depende de:** T-05
**Aceite:**
- Com `password: "atual"` e extras `["antiga"]`, um cookie selado com `"antiga"` gera `Set-Cookie` na resposta.
- O cookie novo abre com `"atual"`.
- `id`, `createdAt` e `data` são os mesmos antes e depois.
- Uma segunda leitura com o cookie resealado não gera `Set-Cookie`.
- Sessão enviada pelo header `x-h3-test-session` (mesmo padrão de `test/session.test.ts:311`) selada com `"antiga"` é lida com o `data` correto e não gera `Set-Cookie`.
- O caso de `Set-Cookie` falha antes de T-11. O caso de header pode passar antes, porque já não há reseal.
- Rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-07 — Testes de fallback legado com senha extra

**Cobre:** RF-06
**Depende de:** T-06
**Aceite:**
- Um cookie legado (selado com 1 iteração PBKDF2) pela senha `"antiga"`, com `password: "atual"` e extras `["antiga"]`, é aberto, marcado como legado e resealado com `"atual"` (`Set-Cookie` presente). Basear-se no caso de `test/session.test.ts:134`.
- Com `legacySealFallback: false` e a mesma configuração, o cookie é rejeitado e vira sessão nova. Basear-se no caso de `test/session.test.ts:161`.
- O caso aberto falha antes de T-09. O caso com `legacySealFallback: false` pode passar antes.
- Rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-08 — Testes de expiração e de remoção de senha

**Cobre:** RF-07, RF-11
**Depende de:** T-07
**Aceite:**
- Selo com `"antiga"` e `ttl: -120000` (`seal(..., "antiga", { ttl: -120000 })`): `unsealSession` rejeita com `"Expired seal"` e não há nenhum `deriveBits` (0 derivações).
- `maxAge` vencido com senha extra: `createdAt` antigo, resposta com `id` diferente (sessão nova).
- Remoção: cookie selado com `"antiga"`, depois de `"antiga"` sair de `extraUnsealPasswords`, vira sessão nova. Cookie selado com `"B"`, com `"B"` mantida nas extras, continua com a sessão preservada.
- Os casos de expiração falham antes de T-09, porque hoje a senha extra gera `"Bad hmac value"` e não `"Expired seal"`. O caso de `maxAge` e o de remoção podem passar antes.
- Rodam nos alvos `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-09 — Loop de senhas em `unsealSession` e falha só em HMAC

**Cobre:** RF-03, RF-06, RF-07, D-02, D-03, D-07
**Depende de:** T-02, T-08
**Aceite:**
- Helpers `isBadHmacError` e `unsealWithPasswords` ficam ao fim de `src/utils/session.ts`. `unsealWithPasswords` retorna `{ unsealed, index }`.
- O conjunto de senhas é `new Set([config.password, ...(config.extraUnsealPasswords ?? [])])`.
- Todas as senhas são tentadas com as opções atuais antes de qualquer fallback legado. Só depois, com 1 iteração, para a lista inteira (RF-06, opção 2 do PRD).
- Qualquer erro que não seja `"Bad hmac value"` é relançado na hora (RF-07).
- Quando `index > 0`, `unsealSession` marca o objeto com `kPreviousPasswordSeal`.
- Os casos de T-04, T-07 e T-08 passam. Os de T-03 e T-06 continuam passando.
- A condição do fallback legado (`legacySealFallback === false` e `iterations === 1`) não muda.
- `pnpm typecheck` passa.
- `unsealSession` continua exportada com a mesma assinatura (`test/unit/package.test.ts` passa).

**Arquivos:** `src/utils/session.ts`

---

### T-10 — Validação de `extraUnsealPasswords` em `getSession`

**Cobre:** RF-08, D-04
**Depende de:** T-01, T-05, T-09
**Aceite:**
- `assertExtraUnsealPasswords(config)` é a primeira instrução de `getSession`, antes de `context.sessions` ser criado.
- O tamanho mínimo de cada entrada é `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)`, lido de `{ ...sealDefaults, ...config.seal }`.
- A mensagem de erro cita `extraUnsealPasswords`.
- Os casos de T-05 passam.
- `password` não é validada aqui (RF-05): o caso de `password` curta de T-03 continua passando.
- Como `updateSession` e `sealSession` chamam `getSession` quando não há sessão no contexto, a validação também roda nesses caminhos.
- Depende de T-09 só para serializar as edições no mesmo arquivo.

**Arquivos:** `src/utils/session.ts`

---

### T-11 — Reseal de sessão aberta com senha extra

**Cobre:** RF-04, RF-10, D-05
**Depende de:** T-02, T-06, T-09, T-10
**Aceite:**
- Em `getSession`, o símbolo `kPreviousPasswordSeal` é lido e removido antes de `Object.assign(session, unsealed)`.
- A condição de reseal passa a ser `session.id && sessionFromCookie && (legacySeal || previousSeal || shouldSlide(session, config))`.
- O cookie resealado usa `password`. `id`, `createdAt` e `data` são preservados.
- Sessões lidas do header não são resealadas.
- Verificar que `Object.getOwnPropertySymbols(session)` não contém `kPreviousPasswordSeal` depois da leitura.
- Os casos de T-06 passam. Os de T-03, T-04, T-05, T-07 e T-08 continuam passando.
- `pnpm vitest run test/session.test.ts` passa nos alvos `web` e `node`.

**Arquivos:** `src/utils/session.ts`

---

### T-12 — Verificação final da mudança

**Cobre:** RF-09, RF-12, RF-13
**Depende de:** T-08, T-11
**Aceite:**
- `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa.
- `pnpm typecheck` passa.
- `pnpm lint` passa. Observação: o `package.json` define `lint` como `oxlint . && oxfmt --check .` e não inclui `typecheck`, apesar do que diz o `AGENTS.md`. Por isso rodar `typecheck` separadamente.
- `pnpm vitest run` (suíte completa) passa.
- `git diff -- src/index.ts package.json src/_entries src/utils/internal/iron-crypto.ts` está vazio.
- `git diff -- test/session.test.ts` mostra só adições. Se algum teste existente tiver sido alterado, a alteração precisa ser só a exigida pela mudança (RF-13), e isso precisa ser registrado.
- Os 59 testes da linha de base continuam passando, sem mudança de expectativa.
- Relatar qualquer falha com a saída do comando.

**Arquivos:** nenhum (só execução de comandos e leitura de `git diff`)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01 |
| RF-02 | T-03 |
| RF-03 | T-04, T-09 |
| RF-04 | T-02, T-06, T-11 |
| RF-05 | T-01, T-03, T-10, T-12 |
| RF-06 | T-07, T-09 |
| RF-07 | T-08, T-09 |
| RF-08 | T-05, T-10 |
| RF-09 | T-01, T-02, T-12 |
| RF-10 | T-06, T-11 |
| RF-11 | T-08 |
| RF-12 | T-03 a T-08 (matriz `web`/`node`), T-12 |
| RF-13 | T-12 |

## Dívida registrada, fora destas tarefas

- `src/utils/session.ts` continua com mais de 200 linhas (464 hoje, mais o que a mudança acrescenta). O `techspec.md` (D-06) decidiu manter os helpers no arquivo e registrar a dívida para a próxima refatoração.
