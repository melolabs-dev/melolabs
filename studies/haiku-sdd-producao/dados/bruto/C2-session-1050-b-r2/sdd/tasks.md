# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-06). A ordem segue a seção "Ordem de implementação" da techspec: testes primeiro, depois renomeação, tipo, implementação e documentação.

Cobertura dos requisitos:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04 |
| RF-02 | T-01, T-06 |
| RF-03 | T-01, T-05 |
| RF-04 | T-01, T-08 |
| RF-05 | T-01, T-03, T-06 |
| RF-06 | T-01, T-05 |
| RF-07 | T-04, T-07 |

---

### T-01 — Escrever os testes que falham para a rotação de senhas

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06

Depende de: nenhuma

Aceite:
- Em `test/session.test.ts`, dentro de `describeMatrix`, existem casos separados para: abrir cookie selado com senha extra (RF-03); migrar para `password` na mesma leitura, com `Set-Cookie` novo que não abre com a senha antiga e abre com a nova, e leitura seguinte sem extras recuperando a sessão (RF-05); `updateSession` selando só com `password` (RF-02); senha desconhecida resultando em sessão nova e `data` vazio (RF-03, falha); ordem e entradas ruins `[wrong, old]`, `["", old]` e `["curta", old]`, cada um em seu `it` (RF-03, D-03); cookie de 1 iteração com `legacySealFallback: false` rejeitado e com o padrão aberto e resselado (RF-06); sessão lida de `x-h3-test-session` com senha extra abre sem `Set-Cookie` (D-06).
- Os casos de `oldPassword` e `newPassword` (49 caracteres cada) ficam ao lado de `sessionConfig`.
- Ao rodar `pnpm vitest run test/session.test.ts`, os casos novos que dependem da implementação falham, e os casos existentes continuam passando.

Arquivos:
- `test/session.test.ts`

---

### T-02 — Teste de tipo para `extraUnsealPasswords`

Cobre: RF-01

Depende de: nenhuma

Aceite:
- Em `test/unit/types.test-d.ts`, seguindo o padrão `expectTypeOf` que o arquivo já usa, há verificação de que `SessionConfig["extraUnsealPasswords"]` é `string[] | undefined` e de que `SessionConfig["password"]` é `string`.
- Antes de T-04, o teste falha por causa do campo ausente. Depois de T-04, passa.
- `pnpm vitest run test/unit/` passa com T-04 aplicada.

Arquivos:
- `test/unit/types.test-d.ts`

---

### T-03 — Renomear `kLegacySeal` para `kStaleSeal`

Cobre: RF-05

Depende de: T-01

Aceite:
- Em `src/utils/internal/session.ts`, o símbolo `kLegacySeal` vira `kStaleSeal`, com o valor `Symbol.for("h3.internal.session.stale-seal")`.
- Todas as ocorrências em `src/` e `test/` são trocadas; `grep` por `kLegacySeal` não encontra mais nada no repositório.
- `src/index.ts` não exporta o símbolo, então a API pública não muda.
- `pnpm vitest run test/session.test.ts` mantém o mesmo resultado de antes da renomeação, porque é só renomeação.

Arquivos:
- `src/utils/internal/session.ts`
- `src/utils/session.ts`
- `test/session.test.ts` (somente se houver referência ao símbolo)

---

### T-04 — Campo `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01, RF-07

Depende de: T-02, T-03

Aceite:
- `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, e `password` continua `string`.
- O JSDoc descreve a ordem de tentativa, que as senhas só abrem e nunca selam, que cada entrada precisa de no mínimo 32 caracteres, que a entrada deve ser removida depois de `maxAge` ou `idleTimeout`, e que sessões lidas do `sessionHeader` não são resseladas (texto em `sdd/techspec.md`, seção "Configuração pública").
- A configuração do exemplo do RF-01 compila sem erro.
- O teste de tipo de T-02 passa.

Arquivos:
- `src/utils/session.ts`

---

### T-05 — Laço de senhas em `unsealSession`

Cobre: RF-03, RF-06

Depende de: T-01, T-04

Aceite:
- Existe o helper interno `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`. Para cada senha, ele tenta as iterações atuais e depois a legada, se `legacySealFallback` permitir (D-02).
- `unsealSession` percorre `[config.password, ...(config.extraUnsealPasswords || [])]` na ordem declarada e para na primeira senha que abre.
- Para `password`, só `Bad hmac value` permite continuar; outros erros são lançados imediatamente (D-03). Para senhas extras, qualquer erro significa tentar a próxima.
- Se nenhuma senha abrir, o erro lançado é o da tentativa com `password`.
- A checagem de `maxAge` / `idleTimeout` continua depois do laço e não muda.
- A assinatura pública de `unsealSession` não muda.
- Os casos de ordem, fallback legado e senha desconhecida de T-01 passam.

Arquivos:
- `src/utils/session.ts`

---

### T-06 — Reselagem na leitura de cookie com senha extra

Cobre: RF-02, RF-05

Depende de: T-05

Aceite:
- `unsealSession` marca o objeto retornado com `kStaleSeal` quando a senha que abriu foi uma extra.
- Em `getSession`, a flag é lida, apagada antes de `Object.assign(session, unsealed)` e incluída na condição de `updateSession` junto com `shouldSlide`, somente para sessões lidas de cookie (D-04, D-06).
- `sealSession` e `updateSession` não mudam; a selagem continua usando `config.password`.
- Os casos de migração (RF-05) e de selagem só com `password` (RF-02) de T-01 passam.
- Depois da migração, uma leitura com apenas `password: new` recupera a mesma sessão.

Arquivos:
- `src/utils/session.ts`

---

### T-07 — Documentação em `docs/4.examples/handle-session.md`

Cobre: RF-07

Depende de: T-06

Aceite:
- Há uma nota sobre `extraUnsealPasswords` perto da seção de `password` (linha 37) e outra perto da seção de `idleTimeout` (linhas 156-183, regra de header na linha 180).
- A nota explica: a ordem de tentativa, que as senhas só abrem, a recomendação de remover cada entrada após `maxAge` ou `idleTimeout`, o aviso de que sessões do `sessionHeader` continuam abrindo com a senha antiga até expirar, e a recomendação de conferir a lista após a rotação (risco 4 da techspec).
- O texto da documentação não diverge do JSDoc de T-04.

Arquivos:
- `docs/4.examples/handle-session.md`

---

### T-08 — Verificação final

Cobre: RF-04

Depende de: T-07

Aceite:
- `pnpm vitest run test/session.test.ts` passa, incluindo os casos existentes sem alteração de expectativa.
- `pnpm vitest run test/unit/` passa.
- `pnpm lint` passa (oxlint, oxfmt --check e typecheck).
- `pnpm test` passa (suíte completa com cobertura).
- `src/utils/internal/iron-crypto.ts` e o formato do selo não aparecem no diff (fora de escopo, `sdd/prd.md`).

Arquivos:
- `test/session.test.ts`
- `test/unit/types.test-d.ts`
- `src/utils/session.ts`
- `src/utils/internal/session.ts`
- `docs/4.examples/handle-session.md`
