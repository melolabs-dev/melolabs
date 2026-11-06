# Tarefas de implementação: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (decisões D-01 a D-08, riscos R-01 a R-09).

Ordem sugerida: T-01, T-03 e T-04 em paralelo; depois T-02, T-05, T-06, T-07, T-08 e T-09. T-01 e T-02 são a fase vermelha do Bug Fix Workflow de `AGENTS.md`.

## Pendências de decisão

Não bloqueiam a implementação. Os padrões abaixo seguem a techspec e podem ser trocados.

1. **Regravação ao ler (D-05, RF-03).** Padrão adotado: sim. Se for recusada, T-06 não insere o bloco de reselagem e o teste de RF-03 em T-02 passa a afirmar que não há `Set-Cookie`.
2. **Validação eager de extras (D-07, R-04).** Padrão adotado: não validar. Erros continuam engolidos em `src/utils/session.ts:197`.
3. **Texto de RF-05 no PRD.** Padrão adotado: o teste mede contagem de `deriveBits` (T-01), não "uma única tentativa de unseal". O PRD não é alterado por estas tarefas.

---

### T-01 — Linha de base de RF-05 (derivações e benchmark sem extras)

**Cobre:** RF-05, RF-11
**Depende de:** nenhuma
**Aceite:** Antes de qualquer mudança em `src/`, `pnpm bench:node` é executado e o resultado guardado como referência. Em `test/session.test.ts`, dentro de `describeMatrix`, um teste espia `crypto.subtle.deriveBits` (padrão de `:722-735`) e registra a contagem de derivações para (a) cookie selado com `password` e config sem extras e (b) cookie selado com outra senha e config sem extras. Os testes usam a contagem relativa entre os dois casos, não o número absoluto (R-07). Ambos passam sem mudança em `src/`, em `web` e `node`.
**Arquivos:** `test/session.test.ts`

---

### T-02 — Testes de RF-01 a RF-09 (fase vermelha)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-06, RF-07, RF-08, RF-09, RF-11
**Depende de:** T-01
**Aceite:** Bloco `describe("extra unseal passwords")` dentro de `describeMatrix`, perto de "lazy creation" (`:692`). Cobre os casos da tabela de testes da techspec:
- abre sessão selada com extra (RF-01);
- `updateSession` com a config nova gera cookie que abre com `P1` e não abre com `P0` (RF-02);
- leitura de sessão com `P0` gera `Set-Cookie` que abre com `P1` (RF-03);
- com cookie de `P1`, a contagem de `deriveBits` é igual à de T-01 (RF-04);
- cookie com `P9` vira sessão nova, com `id` novo, sem `data` e sem erro no handler (RF-06);
- legado de 1 iteração com `P0` carrega os dados e é regravado com `P1` (RF-07);
- `createdAt` além de `maxAge` com cookie de `P0` vira sessão nova, usando `vi.useFakeTimers({ toFake: ["Date"] })` e `vi.useRealTimers()` (RF-08);
- cookie de `P0` com `P0` removida da lista vira sessão nova (RF-09).

Os testes usam `P1` (48+ caracteres), `P0` e `P9`, com `seal` de `src/utils/internal/iron-crypto.ts`. Antes de T-04 o campo não existe no tipo; vitest não checa tipos, então os testes rodam. Na fase vermelha, esperado: RF-01, RF-03, RF-07 e RF-08 falham. RF-02, RF-04, RF-06 e RF-09 já passam, porque o comportamento sem a mudança coincide com o esperado. Confirmar isso na execução.
**Arquivos:** `test/session.test.ts`

---

### T-03 — Símbolo interno `kExtraPasswordSeal`

**Cobre:** RF-03
**Depende de:** nenhuma
**Aceite:** `src/utils/internal/session.ts` exporta `kExtraPasswordSeal = Symbol.for("h3.internal.session.extra-password-seal")`, logo após `kLegacySeal` (`:7-9`), no mesmo estilo. `pnpm typecheck` passa. Nenhum export novo aparece em `src/index.ts`, e `test/unit/package.test.ts` passa sem mudança.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-04 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01, RF-10
**Depende de:** nenhuma
**Aceite:** `extraUnsealPasswords?: string[]` está logo após `password` (`src/utils/session.ts:48`), com JSDoc no mesmo idioma do JSDoc de `password` (`:40-47`). O JSDoc diz: (a) o campo serve só para abrir sessões; (b) a senha deve ser removida quando a janela de compatibilidade acabar; (c) sessões seladas com ela continuam válidas enquanto ela estiver na lista, o que é risco operacional se a rotação foi por vazamento (R-02); (d) recomenda-se de uma a três entradas. Nenhuma lógica muda ainda. A suíte existente passa sem alteração.
**Arquivos:** `src/utils/session.ts`

---

### T-05 — Tentativa em ordem com `password` e extras em `unsealSession`

**Cobre:** RF-01, RF-04, RF-05, RF-06, RF-07
**Depende de:** T-02, T-03, T-04
**Aceite:** `unsealSession` (`src/utils/session.ts:312`) mantém a assinatura e percorre `[config.password, ...(config.extraUnsealPasswords || []).filter(Boolean)]` na ordem declarada. O primeiro sucesso vence e nenhuma extra posterior é tentada. O sucesso é controlado por uma flag `found`, não por `if (!unsealed)`, porque `unseal` pode devolver `null`. Se todas falham, relança o erro da primeira candidata. Quando o sucesso vem de uma extra (índice maior que zero), marca `kExtraPasswordSeal`. O try/catch legado (`:323-348`) vai para um helper interno `unsealWithPassword`, no fim do arquivo, executado por senha (RF-07). Sem extras, a lista tem um item e o fluxo é igual ao atual. Passam: RF-01, RF-04, RF-06 e RF-07 de T-02, o teste de RF-05 de T-01 e toda a suíte existente. RF-03 continua vermelho até T-06.
**Arquivos:** `src/utils/session.ts`

---

### T-06 — `getSession` remove o marcador e regrava com `password`

**Cobre:** RF-03, RF-08
**Depende de:** T-05
**Aceite:** `getSession` lê e apaga `kExtraPasswordSeal` antes de `Object.assign(session, unsealed)` (`:208`), no mesmo bloco de `kLegacySeal` (`:199-201`). O condicional de reselagem (`:214`) passa a incluir o marcador e continua restrito a `sessionFromCookie`. O símbolo não aparece no objeto de sessão retornado. Passam os testes de RF-03 e RF-08 de T-02. A suíte existente passa, inclusive `:134-159` (legado resselado) e `:161-186` (`legacySealFallback: false`).
**Arquivos:** `src/utils/session.ts`

---

### T-07 — Testes complementares: entrada vazia, header e duplicata

**Cobre:** RF-03, RF-11
**Depende de:** T-06
**Aceite:** Em `describeMatrix`, passam os casos:
- `extraUnsealPasswords: ["", P0]` com cookie de `P0` abre a sessão (D-02);
- cookie de `P0` enviado pelo `sessionHeader` abre a sessão e não gera `Set-Cookie` (sessões de header não são reseladas, `sdd/prd.md:135`);
- `P1` repetida em `extraUnsealPasswords` não muda o resultado (R-09, opcional).

Todos passam em `web` e `node`.
**Arquivos:** `test/session.test.ts`

---

### T-08 — Tipo público e lista de exports

**Cobre:** RF-10
**Depende de:** T-04
**Aceite:** `pnpm typecheck` passa com `extraUnsealPasswords: ["..."]` e com o campo omitido. A verificação usa `expectTypeOf` em `test/unit/types.test-d.ts`, se esse arquivo já tiver o padrão; caso contrário, um arquivo temporário que não é commitado. `test/unit/package.test.ts` passa sem alteração do snapshot, e `src/index.ts` não ganha export novo.
**Arquivos:** `test/unit/types.test-d.ts` (somente se o padrão existir)

---

### T-09 — Verificação final e custo com extras

**Cobre:** RF-05, RF-11
**Depende de:** T-07, T-08
**Aceite:**
- `pnpm vitest run test/session.test.ts` passa em `web` e `node`, com todos os testes de RF-01 a RF-11;
- `pnpm test` passa (lint, typecheck e cobertura);
- `pnpm bench:node` sem extras não piora frente à linha de base de T-01;
- uma variante temporária do benchmark, com 1 a 3 extras e cookie inválido, mede o custo de R-01 e é revertida ao final, sem commit;
- o resultado da medição é reportado no fim da tarefa.

**Arquivos:** `test/bench/session.ts` (somente como variante temporária, revertida ao final)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04, T-05 |
| RF-02 | T-02 |
| RF-03 | T-02, T-03, T-06, T-07 |
| RF-04 | T-01, T-02, T-05 |
| RF-05 | T-01, T-05, T-09 |
| RF-06 | T-02, T-05 |
| RF-07 | T-02, T-05 |
| RF-08 | T-02, T-06 |
| RF-09 | T-02 |
| RF-10 | T-04, T-08 |
| RF-11 | T-01, T-02, T-07, T-09 |
