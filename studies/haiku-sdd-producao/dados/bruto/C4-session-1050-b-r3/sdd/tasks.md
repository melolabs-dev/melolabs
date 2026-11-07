# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-08), `sdd/techspec.md` (D-01 a D-07).

Ordem: primeiro os testes que descrevem o comportamento (T-01 a T-05), que devem falhar onde o comportamento ainda não existe; depois a implementação em passos pequenos (T-06 a T-12); por fim documentação e verificação (T-13, T-14).

As três pendências do techspec (D-04 reselar na leitura, D-03 `assertPassword` em `iron-crypto.ts`, D-03 erro alto para extra inválida) são tratadas pela recomendação do techspec. Se alguma for recusada, T-06, T-11 e T-12 precisam ser revistos.

---

### T-01 — Testes de abertura e reselagem com senha extra

Escrever, dentro do `describeMatrix` de sessões, os testes de abertura com extra: cookie selado com `"B"`, config `password: "A"` e `extraUnsealPasswords: ["B"]`, lido com `useSession`/`getSession`, deve devolver os dados. Incluir também a reselagem: depois da leitura, o `Set-Cookie` deve abrir com `"A"` e não com `"B"`. E o caso de sessão enviada por header (`x-h3-test-session`): abre, sem `Set-Cookie`.

**Cobre:** RF-01, RF-02

**Depende de:** nenhuma

**Aceite:** os testes novos estão no `describe` e falham no código atual. As asserções de reselagem falham, e as de abertura também falham (o campo é ignorado). Nenhum teste existente é alterado.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Testes de ordem de tentativa e erro único

Criar `test/session-unseal-order.test.ts` com `vi.mock` de `src/utils/internal/iron-crypto.ts` (usar `importOriginal` e espionar `unseal`). Casos: `extraUnsealPasswords: ["B", "C", "D"]` com selo `"C"` deve chamar `unseal` com `A`, `B`, `C` nessa ordem e nunca com `D`. Com `password: "A"`, `extraUnsealPasswords: ["B"]` e selo `"Z"`, o erro deve ser `"Bad hmac value"`, igual ao de uma config sem extras. Com selo `Expired seal`, `unseal` deve ser chamado uma única vez. Confirmar que `vitest.config.mjs` inclui `test/*.test.ts`.

**Cobre:** RF-03

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/session-unseal-order.test.ts` roda. O caso de ordem falha no código atual. Os casos de erro único e de `Expired seal` passam no código atual (são regressão).

**Arquivos:** `test/session-unseal-order.test.ts`, `vitest.config.mjs` (somente leitura, para confirmar o include)

---

### T-03 — Testes de validação das senhas extras

Em `test/session.test.ts`: `extraUnsealPasswords: [""]` com cookie válido sob `password` deve fazer `unsealSession` lançar `"Empty password"`, e `getSession` deve lançar, sem criar sessão nova. `extraUnsealPasswords: ["curta"]` deve lançar `"Password string too short (min 32 characters required)"`. `extraUnsealPasswords: ["", "B"]` com selo `"A"` também deve lançar, para provar que a validação é antecipada e não preguiçosa.

**Cobre:** RF-05

**Depende de:** nenhuma

**Aceite:** os testes falham no código atual, que ignora o campo e devolve a sessão.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de legado e expiração com senha extra

Em `test/session.test.ts`, seguindo o padrão de legado de `test/session.test.ts:134-160`: selo legado (1 iteração PBKDF2) com `"B"`, `legacySealFallback` ausente, deve abrir, ser marcado como legado e ser resselado com `"A"`. Com `legacySealFallback: false`, deve ser rejeitado. Sessão selada com `"B"` criada há 120 s, com `maxAge: 60`, deve lançar `"Session expired!"`.

**Cobre:** RF-06, RF-07

**Depende de:** nenhuma

**Aceite:** no código atual, o legado com extra falha (é rejeitado) e a expiração falha (lança `"Bad hmac value"`). O caso com `legacySealFallback: false` passa (é regressão).

**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de regressão sem extras e de tipo

Em `test/session.test.ts`: `extraUnsealPasswords` ausente e `[]` devem produzir o mesmo resultado e o mesmo erro para uma sessão selada com outra senha. Em `test/unit/types.test-d.ts`: `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()`. Conferir que `test/unit/package.test.ts` (lista de exports) continua passando sem alteração.

**Cobre:** RF-04, RF-08

**Depende de:** nenhuma

**Aceite:** os testes de regressão de RF-04 passam no código atual. A verificação de tipo falha no código atual (`pnpm typecheck`, propriedade inexistente). `pnpm vitest run test/unit/package.test.ts` passa sem alteração.

**Arquivos:** `test/session.test.ts`, `test/unit/types.test-d.ts`, `test/unit/package.test.ts` (somente leitura)

---

### T-06 — Extrair `assertPassword` de `generateKey`

Em `src/utils/internal/iron-crypto.ts`, extrair de `generateKey` as checagens de `src/utils/internal/iron-crypto.ts:172-174` e `:191-196` para uma função `assertPassword(password, minLength)` exportada só para uso interno, e fazer `generateKey` chamá-la. Mensagens idênticas: `"Empty password"` e `Password string too short (min N characters required)`. Nenhum export novo em `src/index.ts`.

**Cobre:** RF-05

**Depende de:** T-01, T-02, T-03, T-04, T-05

**Aceite:** `pnpm vitest run test/iron-crypto.test.ts test/unit/iron-crypto.test.ts` passa. As mensagens de erro não mudam. `src/index.ts` não tem diff.

**Arquivos:** `src/utils/internal/iron-crypto.ts`

---

### T-07 — Campo `extraUnsealPasswords`, JSDoc e símbolo `kExtraPasswordSeal`

Em `src/utils/session.ts`, adicionar `extraUnsealPasswords?: string[]` em `SessionConfig`, logo após `password`, com o JSDoc de D-06 (só abre, nunca sela, ordem, custo de PBKDF2, remoção só após o TTL, entrada inválida lança a cada leitura). Em `src/utils/internal/session.ts`, criar `kExtraPasswordSeal` ao lado de `kLegacySeal`.

**Cobre:** RF-08

**Depende de:** T-06

**Aceite:** `pnpm typecheck` passa, incluindo a verificação de tipo de T-05. `pnpm vitest run test/unit/package.test.ts` passa sem alteração. O JSDoc aparece no campo. Nenhum export novo em `src/index.ts` ou em `src/utils/session.ts`.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-08 — Extrair `unsealWithPassword` sem mudança de comportamento

Mover o bloco `try/catch` de `unsealSession` (`src/utils/session.ts:323-348`) para uma função interna `unsealWithPassword(sealed, password, sealOptions, allowLegacy)`, no fim de `src/utils/session.ts`. O chamador passa `allowLegacy = config.legacySealFallback !== false`. Ainda uma senha só, sem laço.

**Cobre:** RF-04

**Depende de:** T-07

**Aceite:** a suíte existente de sessões passa sem alteração. Os testes de regressão de T-05 passam.

**Arquivos:** `src/utils/session.ts`

---

### T-09 — Laço de tentativas em `unsealSession`

Em `unsealSession`, percorrer `[config.password, ...(config.extraUnsealPasswords || [])]` em ordem. Continuar para a próxima senha só quando o erro for exatamente `"Bad hmac value"`. Qualquer outro erro é relançado. Na última senha, relançar o erro. Quando o índice for maior que zero, marcar `kExtraPasswordSeal` no resultado. Não usar `!` solto: retornar de dentro do laço e lançar depois dele, para o `tsc` aceitar.

**Cobre:** RF-01, RF-03, RF-06

**Depende de:** T-08

**Aceite:** os testes de abertura com extra de T-01 passam, exceto as asserções de reselagem (são de T-12). Os testes de ordem de T-02 passam. O legado com extra de T-04 passa. Com `legacySealFallback: false`, o legado continua rejeitado. `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`

---

### T-10 — Expiração aplicada depois da abertura

Mover as verificações de `maxAge` (`src/utils/session.ts:350-355`) e `idleTimeout` (`src/utils/session.ts:359-365`) para depois do laço de T-09, aplicadas ao objeto aberto. Sem nova tentativa de senha.

**Cobre:** RF-07

**Depende de:** T-09

**Aceite:** o teste de expiração com extra de T-04 lança `"Session expired!"`. Os testes de expiração existentes continuam passando.

**Arquivos:** `src/utils/session.ts`

---

### T-11 — Validação antecipada das extras em `getSession` e `unsealSession`

Criar `assertExtraPasswords(config)` no fim de `src/utils/session.ts`. Ela usa `(config.seal ?? sealDefaults).integrity.minPasswordlength` e chama `assertPassword` para cada item de `config.extraUnsealPasswords ?? []`. Chamar no início de `getSession`, antes de `context.sessions` (`src/utils/session.ts:158`), e no início de `unsealSession`.

**Cobre:** RF-05

**Depende de:** T-06, T-09

**Aceite:** os testes de validação de T-03 passam. `[""]` lança em `unsealSession` e em `getSession`. `["", "B"]` lança mesmo com selo `"A"`. `["curta"]` lança a mensagem com o mínimo de 32. O erro chega ao chamador de `getSession` e não vira sessão nova.

**Arquivos:** `src/utils/session.ts`

---

### T-12 — Reselar com `password` após leitura por senha extra

Em `getSession`, ler e apagar `kExtraPasswordSeal` junto com `kLegacySeal` (`src/utils/session.ts:199-201`). Ampliar a condição de reselagem (`src/utils/session.ts:214`) para `if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config)))`. `sealSession` não muda. Sessões de header não são resseladas.

**Cobre:** RF-02

**Depende de:** T-09

**Aceite:** as asserções de reselagem de T-01 passam: o `Set-Cookie` abre com `"A"` e não abre com `"B"`. O teste de sessão de header passa sem `Set-Cookie`. `git diff` de `sealSession` está vazio.

**Arquivos:** `src/utils/session.ts`

---

### T-13 — Documentação da rotação de senhas

Em `docs/4.examples/handle-session.md`, acrescentar uma subseção sobre rotação com `extraUnsealPasswords`, após a nota sobre `password` ou na seção de expiração. Explicar: a ordem de tentativa, que a senha extra só abre, que a remoção deve esperar o TTL das sessões e o custo de PBKDF2 por senha. Opcionalmente, uma frase em `docs/2.utils/4.security.md:60-62`.

**Cobre:** RF-08

**Depende de:** T-12

**Aceite:** o trecho novo segue o estilo dos exemplos vizinhos. `pnpm lint` passa.

**Arquivos:** `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md` (opcional)

---

### T-14 — Verificação final

Rodar a suíte completa. Conferir que `src/index.ts` não tem diff, que os testes existentes só ganharam linhas, e que `sealSession` não mudou. Conferir cada critério de aceite do PRD (RF-01 a RF-08).

**Cobre:** RF-04, RF-08

**Depende de:** T-10, T-11, T-12, T-13

**Aceite:** `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. `git diff -- src/index.ts` está vazio. `git diff` dos testes existentes só mostra linhas adicionadas.

**Arquivos:** nenhum arquivo editado; verificação de `src/index.ts`, `test/session.test.ts`, `test/unit/package.test.ts`
