# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-08).

Ordem: os testes vêm antes da implementação (fluxo "Bug Fix Workflow" de `AGENTS.md`). Os testes de RF-02, RF-05 e RF-06 precisam falhar antes da T-02 a T-05.

---

### T-01 — Escrever os testes de `extraUnsealPasswords` antes da mudança

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

Criar `describe("extraUnsealPasswords", ...)` dentro de `describeMatrix` em `test/session.test.ts`, seguindo `describe("lazy creation", ...)` (`:692`). Usar senhas de 48+ caracteres, como em `:23`. Sessões antigas são seladas com `seal` de `src/utils/internal/iron-crypto.ts`, como em `:134-141`.

Casos (conforme a tabela da techspec):

- Abre cookie selado com a senha antiga (RF-02).
- Abre com a segunda extra, garantindo a ordem (RF-02).
- Sela só com `password`: o cookie de `useSession` não abre com a senha antiga (RF-03).
- Sem extras e com `[]`: cookie com outra senha dá sessão vazia, sem erro (RF-04).
- Cookie legado de 1 iteração com a senha antiga: sessão aberta e resselada com `password` (RF-05).
- Reselagem por `idleTimeout` com senha extra: o novo cookie abre com `password` e não com a antiga (RF-06).
- Reselagem ocorre uma vez: a segunda requisição com o cookie novo não gera `Set-Cookie` sem `idleTimeout` (D-06).
- Nenhuma senha abre: sessão vazia, sem erro novo e sem `Set-Cookie` (RF-07).
- `maxAge` com senha extra: sessão expirada fica vazia, sem reselagem (D-05).
- Sessão por header com senha extra: abre e não é resselada (R-04).
- Extra curta antes da correta: a sessão falha (R-03, documenta o comportamento).

**Arquivos:**
- `test/session.test.ts`

**Depende de:** nenhuma

**Aceite:** `pnpm vitest run test/session.test.ts` roda o novo bloco. Os casos de RF-02, RF-05 e RF-06 falham antes de T-02 a T-05 (falham por erro de tipo ou por sessão vazia). Os casos de RF-03, RF-04, RF-07, D-05 e R-04 já podem passar ou falhar, mas nenhum existente pode quebrar. O bloco roda nos dois modos (web e node).

---

### T-02 — Adicionar o campo público `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

Inserir `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig` (`src/utils/session.ts:48`). O JSDoc deve dizer que as senhas só abrem sessões, que a selagem usa `password`, que cada senha custa uma derivação PBKDF2 para cada cookie que não abre antes, e que as entradas antigas devem ser removidas após a janela de rotação (R-01, R-02). Não criar nenhum outro nome público e não alterar `password`, que continua `string`.

**Arquivos:**
- `src/utils/session.ts`

**Depende de:** nenhuma

**Aceite:** `SessionConfig["extraUnsealPasswords"]` tem o tipo `string[] | undefined`. `password` continua aceitando só `string`. `pnpm lint` passa, incluindo `isolatedDeclarations` (R-05). O campo aparece no JSDoc gerado.

---

### T-03 — Criar o símbolo interno `kExtraPasswordSeal`

**Cobre:** RF-06

Adicionar `kExtraPasswordSeal` em `src/utils/internal/session.ts`, logo após `kLegacySeal` (`:5-7`), com o mesmo padrão `Symbol.for(...)`. Não exportar pelo `src/index.ts`.

**Arquivos:**
- `src/utils/internal/session.ts`

**Depende de:** nenhuma

**Aceite:** o símbolo é importável por `src/utils/session.ts`. `src/index.ts` e `test/unit/package.test.ts` não mudam e continuam passando.

---

### T-04 — Tentar as senhas em ordem dentro de `unsealSession`

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-07

Em `src/utils/session.ts` (`:312-367`):

- Criar as funções internas no fim do arquivo: `unsealWithPasswords`, `unsealWithPassword` e `isWrongPasswordError` (`error.message === "Bad hmac value"`).
- `unsealWithPasswords` tenta `[config.password, ...(config.extraUnsealPasswords || [])]` em ordem e para na primeira que abrir. Só `isWrongPasswordError` avança para a próxima. Qualquer outro erro é relançado na hora, e a última tentativa relança o próprio erro (D-03).
- `unsealWithPassword` recebe o corpo atual do fallback: primeiro as iterações atuais, depois 1 iteração quando `legacySealFallback !== false` (D-04). Essa é a ordem intercalada por senha.
- `unsealSession` mantém a assinatura pública. As checagens de `maxAge` e `idleTimeout` (`:350-365`) continuam depois do laço, uma vez só (D-05).
- `sealSession` (`:300`) não muda (D-02, RF-03).
- `iron-crypto.ts` não muda (D-07).

**Arquivos:**
- `src/utils/session.ts`

**Depende de:** T-01, T-02

**Aceite:** os casos de T-01 de RF-02, RF-04, RF-05 e RF-07 passam. O caso de RF-03 continua passando. `test/unit/iron-crypto.test.ts` passa sem edição. `pnpm vitest run test/session.test.ts` não tem regressão nos testes existentes.

---

### T-05 — Reselar a sessão com `password` ao abrir com senha extra

**Cobre:** RF-06

Em `getSession` (`src/utils/session.ts:196-216`):

- Ao abrir, `unsealWithPasswords` marca o resultado com `kExtraPasswordSeal` quando a senha que abriu foi uma extra. A marca é definida dentro de `unsealSession`, como `kLegacySeal`.
- Ler e apagar a marca antes de `Object.assign(session, unsealed)` (`:208`), porque o `Object.assign` copia símbolos enumeráveis.
- Acrescentar `extraPasswordSeal` à condição de `updateSession` (`:214`): `legacySeal || extraPasswordSeal || shouldSlide(...)`. A reselagem usa `updateSession`, que sela com `password`.
- A reselagem ocorre só no caminho do cookie (`sessionFromCookie`). Sessões por header não são resseladas (R-04).

**Arquivos:**
- `src/utils/session.ts`

**Depende de:** T-03, T-04

**Aceite:** os casos de reselagem de T-01 (RF-06, D-06 e a reselagem por `idleTimeout`) passam. O novo cookie abre com `password` e não com a senha antiga. Uma segunda requisição com o cookie novo não gera `Set-Cookie` sem `idleTimeout`. Os testes existentes de reselagem legada continuam passando.

---

### T-06 — Verificar exports, escopo e tipos

**Cobre:** RF-01, RF-04

Confirmar que a mudança não alterou o que está fora de escopo no PRD:

- `src/index.ts` não ganha export novo. `test/unit/package.test.ts` (`:125`, `:149`) passa sem edição.
- `src/utils/internal/iron-crypto.ts`, `test/unit/iron-crypto.test.ts`, `test/bench/session.ts`, `docs/` e `README.md` não mudam.
- Se `test/unit/types.test-d.ts` já tiver padrão para tipos de configuração, incluir `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()`. Caso contrário, não criar esse padrão.

**Arquivos:**
- `test/unit/types.test-d.ts` (somente se o padrão já existir no arquivo)

**Depende de:** T-05

**Aceite:** `git diff --stat` não mostra alteração nos arquivos da lista fora de escopo. `pnpm vitest run test/unit` passa.

---

### T-07 — Rodar a verificação completa

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

Rodar o ciclo completo e registrar a saída. Não alterar código sem novo teste que reproduza o problema (AGENTS.md, "Bug Fix Workflow").

**Arquivos:**
- nenhum (somente verificação)

**Depende de:** T-06

**Aceite:** `pnpm lint` passa (oxlint, oxfmt e typecheck com `isolatedDeclarations`, R-05). `pnpm test` passa (lint, typecheck e cobertura). `pnpm vitest run test/session.test.ts` passa nos modos web e node. Se algo falhar, a saída da falha é reportada, sem resumo. Opcional: `pnpm bench:node` para comparar sessões sem extras antes e depois (esperado: sem diferença, PRD R-01 e techspec).
