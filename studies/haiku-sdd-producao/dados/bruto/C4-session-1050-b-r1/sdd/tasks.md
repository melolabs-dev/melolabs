# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050, variante B)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (decisões D-01 a D-09).

Ordem de execução: T-01 → T-02 (testes que falham) → T-03 → T-04 → T-05 → T-06 → T-07 → T-08. O fluxo de correção de bug de `AGENTS.md` vale para T-02: os casos devem falhar antes de qualquer mudança em `src/`.

Desvio registrado: T-05 reseala a sessão já na leitura (D-07 da techspec), e não só na próxima escrita como diz o RF-07 literalmente. O PR deve citar esse desvio.

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:** `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, com JSDoc no estilo dos campos vizinhos. O JSDoc diz que a senha nunca é usada para selar, que as senhas são tentadas em ordem depois de `password`, que cada uma deve ter pelo menos 32 caracteres e que devem ser removidas depois de `maxAge`/`idleTimeout`. O typecheck passa. `src/index.ts` não ganha export novo (`git diff src/index.ts` vazio).
**Arquivos:** `src/utils/session.ts`

---

### T-02 — Testes dos casos de bug, escritos antes da implementação

**Cobre:** RF-03, RF-04, RF-06, RF-07
**Depende de:** T-01
**Aceite:** em `test/session.test.ts`, um bloco `describe("extraUnsealPasswords")` dentro de `describeMatrix` com:
- leitura de sessão selada com `OLD` e config `{password: NEW, extraUnsealPasswords: [OLD]}`: dados retornados, mesmo `id`, `Set-Cookie` presente (caso 1 da techspec);
- cookie resealado após a leitura abre com `NEW` e falha com `OLD` (caso 2);
- legado com 1 iteração de PBKDF2 sob `OLD`, com `OLD` como extra: dados retornados e reselagem com `NEW` (caso 6);
- regressão: sessão selada com `password` atual, extras presentes, sem `idleTimeout`, sem `Set-Cookie` na leitura (caso 4).

Antes de T-03, `pnpm vitest run test/session.test.ts` mostra os casos 1, 2 e 6 falhando e o caso 4 passando. Nenhuma asserção de teste existente é alterada.
**Arquivos:** `test/session.test.ts`

---

### T-03 — Laço de tentativas em `unsealSession`

**Cobre:** RF-03, RF-04, RF-05, RF-06
**Depende de:** T-02
**Aceite:**
- o bloco `try { unseal } catch { legado }` atual vira `unsealWithPassword(sealed, password, config, sealOptions)`, sem mudança de comportamento;
- `unsealSession` percorre `[config.password, ...(config.extraUnsealPasswords || [])]` em ordem, para na primeira que valida e continua só quando o erro é exatamente `"Bad hmac value"`; qualquer outro erro é relançado;
- se nenhum candidato valida, o último erro é relançado e `getSession` o trata como sessão inexistente, sem exceção para o usuário;
- as checagens de `maxAge`/`idleTimeout` ficam depois do laço e rodam uma vez;
- com lista vazia ou ausente, há exatamente um `unseal`;
- `unsealSession` mantém a assinatura pública.

Os casos 1 e 6 de T-02 passam. Os testes existentes passam sem mudança de asserção.
**Arquivos:** `src/utils/session.ts`

---

### T-04 — Marca de sessão aberta com senha extra

**Cobre:** RF-07
**Depende de:** T-03
**Aceite:** `src/utils/internal/session.ts` exporta `kExtraUnsealPassword` (ex.: `Symbol.for("h3.internal.session.extra-unseal-password")`), no padrão de `kLegacySeal`. `unsealSession` marca o resultado com esse símbolo quando a senha que validou tem índice maior que zero. Sem extras, o símbolo nunca aparece no retorno. O símbolo não é reexportado em `src/index.ts`.
**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

---

### T-05 — Reselagem com `password` na leitura e selagem exclusiva

**Cobre:** RF-02, RF-07
**Depende de:** T-04
**Aceite:**
- `getSession` reseala o cookie com `password` quando a flag `kExtraUnsealPassword` está setada, além das condições que já existem para sessões legadas;
- a flag é apagada da sessão antes de `Object.assign`, para não vazar nos dados;
- a selagem continua usando só `config.password`, sem alteração na linha de selagem;
- o caso 2 de T-02 passa;
- o JSDoc ou a descrição do PR registra o desvio D-07 em relação ao RF-07.
**Arquivos:** `src/utils/session.ts`

---

### T-06 — Validação de tamanho das senhas extras

**Cobre:** RF-08
**Depende de:** T-01
**Aceite:**
- uma função interna `assertExtraUnsealPasswords(config)` lança `Error` com a mensagem `extraUnsealPasswords[i] is too short (min N characters required)`, onde N é `max(encryption.minPasswordlength, integrity.minPasswordlength)` calculado sobre `sealDefaults` mesclado com `config.seal`;
- a função roda no início de `getSession`, antes de qualquer leitura de cookie, e a exceção não passa pelo `.catch(() => {})` da leitura;
- com `extraUnsealPasswords: ["curta"]`, `useSession` sem cookie e `getSession` com cookie lançam o erro.

Os testes desse critério ficam em T-07.
**Arquivos:** `src/utils/session.ts`

---

### T-07 — Testes dos demais critérios

**Cobre:** RF-02, RF-03, RF-05, RF-08
**Depende de:** T-05, T-06
**Aceite:** em `test/session.test.ts`, no mesmo bloco `describe("extraUnsealPasswords")`, passam os casos:
- ordem com `[X, OLD]`: sessão selada com `OLD` abre, e sessão selada com `X` também abre (caso 3);
- senha desconhecida: cookie com `UNKNOWN` resulta em resposta 200, sem dados, com `id` novo e sem exceção (caso 5);
- extra curta: `useSession` sem cookie e `getSession` com cookie falham com a mensagem da T-06 (caso 7). Se for mais simples, o teste chama `getSession` direto;
- expiração: sessão selada com `OLD` e `maxAge` vencido continua expirada (caso 8);
- header: sessão selada com `OLD` enviada no header é aberta e não recebe `Set-Cookie` (caso 9);
- selagem: sessão nova com extras presentes só abre com `password` (caso 10).

Os testes usam `describeMatrix` (web e node), com `ctx.app` e `ctx.fetch`.
**Arquivos:** `test/session.test.ts`

---

### T-08 — Verificação de regressão e de escopo

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
**Depende de:** T-07
**Aceite:**
- `pnpm vitest run test/session.test.ts` passa;
- `pnpm vitest run test/unit/` passa, o que mostra que `iron-crypto` não mudou de comportamento;
- `pnpm test` passa (lint, typecheck e coverage);
- `git diff --stat` mostra só os arquivos da seção "Arquivos a alterar" da techspec;
- `src/utils/internal/iron-crypto.ts`, `src/utils/cookie.ts`, `src/index.ts` e `test/unit/iron-crypto.test.ts` não têm diff;
- `git diff` em `test/session.test.ts` não remove nem altera nenhuma asserção dos testes existentes.
**Arquivos:** nenhum (só verificação)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-08 |
| RF-02 | T-05, T-07, T-08 |
| RF-03 | T-02, T-03, T-07, T-08 |
| RF-04 | T-02, T-03, T-08 |
| RF-05 | T-03, T-07, T-08 |
| RF-06 | T-02, T-03, T-08 |
| RF-07 | T-02, T-04, T-05, T-08 |
| RF-08 | T-06, T-07, T-08 |
