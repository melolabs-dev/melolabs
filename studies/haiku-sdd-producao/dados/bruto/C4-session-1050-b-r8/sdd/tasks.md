# Tarefas de implementação — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-06, casos T1 a T12).

Ordem de execução: T-01 primeiro (testes de regressão, que devem **falhar** antes de qualquer mudança em código, conforme o fluxo de correção de bug do `AGENTS.md`). T-02 e T-03 podem ser feitas em paralelo depois disso. T-04, T-05 e T-06 seguem as dependências indicadas. T-07 fecha a entrega.

---

### T-01 — Testes de regressão para a rotação de senhas

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

**Depende de:** nenhuma

**Aceite:**
- Os casos T1 a T12 da techspec (seção "Estratégia de testes") existem em `test/session.test.ts`, dentro de `describeMatrix`, após o teste de `legacySealFallback: false`, usando `seal(...)` de `src/utils/internal/iron-crypto.ts` e `t.app.all(...)` com `useSession`.
- T12 (tipagem) é verificado com `pnpm typecheck` e falha hoje, porque `extraUnsealPasswords` ainda não existe no tipo.
- `pnpm vitest run test/session.test.ts` roda e os casos marcados como "Falha hoje: Sim" falham pelo motivo esperado (senha errada aberta, sessão vazia onde deveria abrir, ausência de `Set-Cookie`, etc.). Os casos marcados como "Não" (T4, T7, T8, T11) passam ou falham como descrito na techspec, e isso é registrado na descrição da tarefa.
- Nenhuma asserção dos testes existentes é alterada.

**Arquivos:**
- `test/session.test.ts`

---

### T-02 — Campo `extraUnsealPasswords` no `SessionConfig`

**Cobre:** RF-01, RF-08 (documentação do campo), RF-09 (documentação do campo)

**Depende de:** T-01

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]` com o JSDoc do contrato da techspec (ordem de tentativa, uso só para abrir, regravação só por cookie, custo de CPU, remoção após a janela de rotação, mesmo mínimo de `password`).
- Nenhum outro nome público novo é introduzido; `password` continua `string`.
- `pnpm typecheck` compila o caso T12 sem erro.
- Os testes T1 a T11 continuam falhando (a lógica ainda não existe), o que confirma que só o tipo mudou.

**Arquivos:**
- `src/utils/session.ts`

---

### T-03 — Símbolo interno `kRotatedSeal`

**Cobre:** RF-04

**Depende de:** T-01

**Aceite:**
- `src/utils/internal/session.ts` exporta `kRotatedSeal` com `Symbol.for("h3.internal.session.rotated-seal")`, no mesmo padrão de `kLegacySeal`.
- O símbolo não aparece em nenhum export público (`src/index.ts` e entradas em `src/_entries/`).
- `pnpm typecheck` passa.

**Arquivos:**
- `src/utils/internal/session.ts`

---

### T-04 — Validação de `extraUnsealPasswords` em `getSession`

**Cobre:** RF-08

**Depende de:** T-02

**Aceite:**
- Função interna `assertExtraUnsealPasswords(config)` é chamada no início de `getSession`, antes de qualquer alteração em `context.sessions`.
- Extra vazia lança `Error("Empty password")`; extra curta lança `Error("Password string too short (min N characters required)")`, com N vindo de `{ ...sealDefaults, ...config.seal }.encryption.minPasswordlength`.
- O erro sai da rota (não é engolido pelo `.catch` de `getSession`). Caso T9 passa; caso T10 passa.
- Ponto a confirmar com a equipe (techspec, D-04 e questão 1): se só a vacuidade for desejada, remover o ramo "too short" e ajustar T10. Até a confirmação, a implementação segue a techspec.

**Arquivos:**
- `src/utils/session.ts`

---

### T-05 — Laço de tentativas de unseal em `unsealSession`

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07

**Depende de:** T-02, T-03

**Aceite:**
- `unsealSession` tenta `[config.password, ...(config.extraUnsealPasswords || [])]` na ordem, chamando o helper interno `unsealWithPassword`, que contém o bloco atual com fallback legado (iterações atuais, depois 1 iteração se `legacySealFallback !== false`).
- O laço só avança para a próxima senha quando o erro é exatamente `"Bad hmac value"`; qualquer outro erro é relançado na hora.
- Se nenhuma senha abre, é relançado o primeiro erro (o da senha principal), sem mencionar qual senha foi tentada.
- Quando a senha que abriu não é a primeira, `unsealed[kRotatedSeal]` é marcado como `true`.
- Caso T3 passa; T4 passa sem tentar a extra (sem regressão); T6 passa; T7 passa (`legacySealFallback: false` continua impedindo a abertura); T8 passa (sessão vazia, sem menção a senhas); T11 passa (expiração vale para a senha que abriu, sem regravação).
- A expiração (`maxAge`, `idleTimeout`) continua conferida depois do laço, sem mudança.
- `src/utils/internal/iron-crypto.ts` não é alterado.

**Arquivos:**
- `src/utils/session.ts`

---

### T-06 — Regravação na leitura com senha extra e escopo ao cookie

**Cobre:** RF-03, RF-04, RF-09

**Depende de:** T-03, T-05

**Aceite:**
- `getSession` lê `kRotatedSeal` do objeto desbloqueado e o apaga antes do `Object.assign`, como já é feito com `kLegacySeal`.
- A condição de regravação passa a ser `sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))`.
- A regravação sempre sela com `password`.
- Caso T1 passa (uma única resposta com `Set-Cookie`, abre com A e não abre com B); T2 passa (a segunda leitura, sem extras, não gera `Set-Cookie`, sem loop); T5 passa (leitura pelo cabeçalho retorna dados e não regrava).
- Sessão aberta com `password` não gera `Set-Cookie` por causa da rotação.

**Arquivos:**
- `src/utils/session.ts`

---

### T-07 — Verificação final da entrega

**Cobre:** RF-01, RF-05

**Depende de:** T-04, T-06

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa em todos os casos (web e node), inclusive T1 a T12.
- Nenhuma asserção dos testes existentes foi alterada (`git diff test/session.test.ts` mostra só adições).
- `pnpm vitest run test/` passa, sem regressões em outros usos de sessão.
- `pnpm typecheck` e `pnpm lint` passam.
- Opcional, antes do PR: `pnpm test` (lint, typecheck e coverage).

**Arquivos:**
- nenhum (apenas execução de comandos de verificação)
