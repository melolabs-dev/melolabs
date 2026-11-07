# Tarefas de implementação — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-07, R-01 a R-08).

Ordem: os testes de regressão (T-03) são escritos e vistos falhando antes de qualquer mudança em `src/` (fluxo de bug fix de `AGENTS.md`). Os comandos de verificação são os de `AGENTS.md` e da techspec.

---

### T-01 — Símbolo interno `kExtraPasswordSeal`

**Cobre:** RF-07

**Depende de:** nenhuma

**Aceite:**
- `kExtraPasswordSeal` existe em `src/utils/internal/session.ts`, após `kLegacySeal`, com o padrão `Symbol.for("h3.internal.session.extra-password-seal")`.
- Nenhum export público novo: `src/index.ts` e o snapshot em `test/unit/package.test.ts` continuam iguais.
- `pnpm vitest run test/unit/package.test.ts` passa.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, com o JSDoc do contrato da techspec (senhas anteriores, só para abrir; selagem sempre com `password`; mesma regra de entropia; lista curta).
- `password` continua `string`.
- Em `test/unit/types.test-d.ts`, `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` passa.
- `pnpm vitest run test/unit/types.test-d.ts` passa.

**Arquivos:** `src/utils/session.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Testes de regressão para os casos novos

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** T-02

**Aceite:**
- Em `test/session.test.ts`, com `describeMatrix` (web e node), existem os casos 1 a 11 da estratégia de testes da techspec:
  1. abre com extra e regrava (RF-02, RF-07);
  2. ordem `[B, C]` com sessão em `B` e em `C` (RF-02);
  3. `useSession` + `update` com `A + [B]` gera cookie que não abre com `B` (RF-03);
  4. `extraUnsealPasswords: []` e ausência do campo se comportam como hoje (RF-04);
  5. selada com `C` e config `A + [B]` vira sessão nova, `data` vazio, sem mensagem que cite as senhas (RF-05);
  6. `["curta", B]` abre com `B` (RF-06);
  7. legado (1 iteração) selado com `B` abre, regrava com `A`, e a próxima leitura não gera `Set-Cookie` (RF-08);
  8. sessão atual com extra não passa pelo caminho legado (teste de custo, com `vi.spyOn` em `unseal`);
  9. header `x-h3-test-session` com `B` abre e não gera `Set-Cookie` (D-05);
  10. expiração por `maxAge` com `B` continua descartando (fake timers);
  11. `unsealSession` com extra não expõe `kExtraPasswordSeal` em `Object.keys` do retorno.
- Ao rodar `pnpm vitest run test/session.test.ts` antes de T-04, os casos 1, 2, 5 (parte de extras), 6, 7 e 8 falham pelo motivo esperado. Os casos de compatibilidade (4) passam. Registrar a saída.
- Nenhum teste existente foi alterado.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Abrir sessão tentando as senhas em ordem

**Cobre:** RF-02, RF-04, RF-05, RF-06

**Depende de:** T-01, T-03

**Aceite:**
- `unsealWithPasswords(sealed, passwords, options)` existe como helper não exportado no fim de `src/utils/session.ts`, com o contrato da techspec: retorna `{ unsealed, index }` da primeira senha que abre; quando nenhuma abre, lança o erro da primeira senha (D-03).
- `unsealSession` usa `[config.password, ...(config.extraUnsealPasswords ?? [])]` (D-07) e marca `kExtraPasswordSeal` quando `index > 0` e `unsealed` existe.
- Os guardas de `null` e as checagens de `maxAge`/`idleTimeout` seguem como antes (techspec, esboço).
- Casos 1, 2, 5, 6 e 10 de T-03 passam. Os casos de compatibilidade continuam passando.
- Mesmo erro de hoje quando não há extras (comparar com o teste existente de selo inválido).
- Decisão de R-05: o helper fica em `src/utils/session.ts`, conforme a recomendação da techspec, salvo revisão em contrário.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Fallback de selo legado com várias senhas (duas fases)

**Cobre:** RF-08, RF-04

**Depende de:** T-04

**Aceite:**
- A fase legada só roda quando `legacySealFallback` está ativo e o primeiro erro da fase atual é `Bad hmac value` (D-02, D-03). Ela percorre todas as senhas com `iterations: 1`, na mesma ordem.
- Sessão legada selada com a senha extra `B` abre com `B`, regrava com `A` (T-06) e recebe `kLegacySeal`.
- Com `password` curta e extra legada, o fallback não roda (R-04). Há um teste ou nota.
- Casos 7 e 8 de T-03 passam.
- Testes existentes de `legacySealFallback` (`test/session.test.ts:134-186`) passam sem alteração.

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Regravar com `password` ao abrir com senha extra

**Cobre:** RF-07, RF-03

**Depende de:** T-04

**Aceite:**
- Em `getSession`, `kExtraPasswordSeal` é lido e apagado junto de `kLegacySeal`, antes de `Object.assign` (R-08).
- A condição de regravação é `session.id && sessionFromCookie && (legacySeal || extraPasswordSeal || shouldSlide(session, config))` (D-05).
- Sessão aberta com `B` gera `Set-Cookie` selado com `A`, e a próxima leitura abre só com `A` (caso 1 de T-03).
- Sessão lida pelo header com `B` não gera `Set-Cookie` (caso 9 de T-03).
- `sealSession` não mudou (D-06).

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-07 — Garantir que a selagem usa só `password`

**Cobre:** RF-03

**Depende de:** T-06

**Aceite:**
- `sealSession` (`src/utils/session.ts`, linhas 282-307 antes da mudança) segue sem diff em relação ao commit `5ab0897`.
- Caso 3 de T-03 passa: cookie gerado com `A + [B]` não abre com `B`.
- O caso de `maxAge`/`idleTimeout` com extras (caso 10) continua passando.

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts` (somente verificação; sem alteração esperada)

---

### T-08 — Compatibilidade sem extras

**Cobre:** RF-04

**Depende de:** T-05, T-06, T-07

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa inteiro, incluindo os testes existentes sem alteração (`test/session.test.ts:134-186` e demais).
- Caso 4 de T-03 passa.
- Se algum teste existente falhar, a falha é investigada antes de qualquer ajuste. Só se for consequência da mudança prevista, e sem reduzir o que o teste verifica (premissa do PRD).

**Arquivos:** `test/session.test.ts`

---

### T-09 — Documentação

**Cobre:** RF-01, RF-07

**Depende de:** T-08

**Aceite:**
- `docs/4.examples/handle-session.md`:
  - perto de `:37`, aviso de que `extraUnsealPasswords` só abre sessões, que enquanto a senha estiver na lista ela continua abrindo cookies, e que remover uma senha exige novo deploy (R-02);
  - perto de `:143`, `extraUnsealPasswords` na descrição das opções, com recomendação de listas curtas e custo de PBKDF2 por tentativa (R-01, sem número fixo, porque o custo exato precisa ser medido);
  - perto de `:180`, nota de que sessões lidas pelo header com senha extra não são regravadas e continuam com a senha antiga até expirar (R-03).
- `docs/2.utils/4.security.md` (perto de `:60`): `unsealSession` menciona que tenta as senhas extras. Sem mudança de assinatura. Cuidar do bloco gerado por automd.
- `CHANGELOG.md` não é alterado.
- `pnpm fmt` não altera nada além do esperado nos docs.

**Arquivos:** `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`

---

### T-10 — Verificação final

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** T-09

**Aceite:**
- `pnpm lint` passa (oxlint, oxfmt --check e typecheck).
- `pnpm test` passa (suíte completa com cobertura).
- `pnpm vitest run test/unit/package.test.ts` passa com o snapshot de exports inalterado.
- `src/utils/internal/iron-crypto.ts` sem diff (regra de senha curta e `Bad hmac value` como estão).
- `src/index.ts` sem diff.
- Relatório da saída de cada comando. Se algo falhar, o relatório diz o que falhou.

**Arquivos:** nenhum arquivo novo; verificação sobre todos os arquivos das tarefas anteriores.

---

## Notas

- Os RFs cobertos por tarefa: RF-01 (T-02, T-09, T-10), RF-02 (T-03, T-04, T-10), RF-03 (T-03, T-06, T-07, T-10), RF-04 (T-03, T-05, T-08, T-10), RF-05 (T-03, T-04, T-10), RF-06 (T-03, T-04, T-10), RF-07 (T-01, T-03, T-06, T-09, T-10), RF-08 (T-03, T-05, T-10).
- A techspec cita `sdd/pedido.md` como base, mas esse arquivo não está no workspace. Estas tarefas se apoiam só em `prd.md` e `techspec.md`.
- O PRD estima o custo como N×2 derivações por requisição. A techspec (R-01) corrige para N+1 por fase. A documentação (T-09) não traz número fixo.
