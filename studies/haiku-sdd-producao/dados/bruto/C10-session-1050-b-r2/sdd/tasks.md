# Tasks — Várias senhas de unseal nas sessões (h3js/h3#1050)

- Data: 2026-11-06
- Origem: [`sdd/prd.md`](prd.md) (RF-01 a RF-12) e [`sdd/techspec.md`](techspec.md) (D-01 a D-08)

## Ordem e conflitos

- Os testes são escritos antes da implementação correspondente (AGENTS.md: "Bug Fix Workflow"). Cada teste deve falhar pelo motivo certo antes da tarefa de implementação.
- T-04, T-05, T-06 e T-07 editam o mesmo arquivo (`test/session.test.ts`). Executar em sequência.
- T-01, T-03, T-08, T-09 e T-10 editam `src/utils/session.ts`. Executar em sequência.
- Comandos de verificação usados em todas as tarefas: `pnpm vitest run test/session.test.ts` (web e node), `pnpm typecheck`, `pnpm lint`.

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

Adicionar `extraUnsealPasswords?: string[]` logo depois de `password` em `SessionConfig`, com TSDoc em inglês: senhas anteriores usadas só para abrir sessões, `password` continua sendo a única usada para selar, e cada item precisa do tamanho mínimo do seal. Nenhuma lógica nova nesta tarefa.

**Cobre:** RF-01, RF-12
**Depende de:** nenhuma
**Aceite:** `pnpm typecheck` passa. `pnpm vitest run test/unit/package.test.ts` passa sem alteração no snapshot de exports. `src/index.ts` não muda.
**Arquivos:** `src/utils/session.ts`

---

### T-02 — Símbolo interno `kSealedWithExtra`

Criar `kSealedWithExtra` em `src/utils/internal/session.ts`, no mesmo formato de `kLegacySeal` (`Symbol.for("h3.internal.session.sealed-with-extra")`, com `/* @__PURE__ */`). Só declarar o símbolo; ainda não é usado.

**Cobre:** RF-06, RF-07 (base para o marcador)
**Depende de:** nenhuma
**Aceite:** `pnpm lint` e `pnpm typecheck` passam. O símbolo está exportado do arquivo interno e não aparece em `src/index.ts`.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-03 — Extrair `resolveSealOptions` (sem mudança de comportamento)

Criar a função interna `resolveSealOptions(config)` no fim de `src/utils/session.ts`, retornando `{ ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal }`. Trocar as duas cópias atuais (dentro de `sealSession` e de `unsealSession`) por chamadas a essa função. `sealSession` continua selando só com `config.password` (D-06).

**Cobre:** RF-02 (a selagem não muda)
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` passa inteiro, sem alterar nenhum teste existente, em web e node.
**Arquivos:** `src/utils/session.ts`

---

### T-04 — Testes de RF-01 e RF-02 (guardas)

Em `test/session.test.ts`, dentro do `describeMatrix` principal (antes de `describe("lazy creation")`), adicionar:
- Cookie gerado com `extraUnsealPasswords: []` e com o campo ausente: mesmo número de partes (8), prefixo `Fe26.2`, `passwordId` vazio, e ambos abrem com `{ password }`. Não comparar bytes, porque o `iron` usa salt e IV aleatórios.
- Sessão criada com `{ password: P, extraUnsealPasswords: [A] }` abre com `unseal(cookie, P, sealDefaults)` e devolve o mesmo `id` e os mesmos dados.

Estes testes devem passar hoje, porque são guardas do comportamento atual. Registrar isso na descrição do PR.

**Cobre:** RF-01, RF-02
**Depende de:** T-01
**Aceite:** os novos testes passam em web e em node. Nenhum teste existente foi alterado.
**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de RF-03, RF-04 e RF-05 (leitura com senha extra)

Em `test/session.test.ts`, dentro do mesmo bloco, adicionar:
- Cookie selado com `A` (`seal({ id: "s1", createdAt, data: { user: "ana" } }, A, sealDefaults)`), lido com `{ password: P, extraUnsealPasswords: [A] }`: `id` = `s1` e `data` = `{ user: "ana" }`.
- Cookie selado com `B`, lido com `{ password: P, extraUnsealPasswords: [A, B] }`: mesmos `id` e `data`.
- Cookie selado com `X` (fora da lista), lido com `{ password: P, extraUnsealPasswords: [A] }`: sem erro, `data` vazio, `id` diferente do cookie.

Hoje, os dois primeiros devem falhar (a sessão vira nova). O terceiro já passa.

**Cobre:** RF-03, RF-04, RF-05
**Depende de:** T-04
**Aceite:** os testes de RF-03 e RF-04 falham hoje pelo motivo certo (`id` diferente, não erro de sintaxe). O de RF-05 passa. Tudo em web e node.
**Arquivos:** `test/session.test.ts`

---

### T-06 — Testes de RF-06 e RF-07 (reseal e cabeçalho de sessão)

Em `test/session.test.ts`, adicionar:
- Request com cookie selado com `A`, lido com `{ password: P, extraUnsealPasswords: [A] }`: o `Set-Cookie` da resposta abre com `unseal(setCookie, P, sealDefaults)` sozinho, e o `id` e o `createdAt` são os originais.
- Request com cabeçalho de sessão (`sessionHeader`) contendo selo de `A`, com a mesma configuração: os dados são retornados e `res.headers.getSetCookie()` está vazio.

O primeiro deve falhar hoje. O segundo deve passar hoje.

**Cobre:** RF-06, RF-07
**Depende de:** T-04
**Aceite:** o teste de RF-06 falha hoje por falta de reseal. O de RF-07 passa. Ambos em web e node.
**Arquivos:** `test/session.test.ts`

---

### T-07 — Testes de RF-08, RF-09 e RF-10 (expiração, tamanho e legado)

Em `test/session.test.ts`, adicionar:
- **RF-08:** selo de `A` com `maxAge` vencido, lido com `{ password: P, extraUnsealPasswords: [A], maxAge: 60 }`, usando fake timers como em `test/session.test.ts:188-229` (`toFake: ["Date"]`). `data` vazio e `id` novo.
- **D-02:** selo de `A` com `ttl` vencido: a leitura cai em sessão nova sem tentar a próxima senha (erro "Expired seal" relançado na primeira tentativa).
- **RF-09:** `extraUnsealPasswords: ["a".repeat(31)]` com `useSession` numa rota sem cookie: a chamada falha com erro que cita o índice `extraUnsealPasswords[0]` e não cita o valor da senha; nenhum `Set-Cookie`. Antes de escrever, ver como `test/errors.test.ts:114-115` e `opts.allowUnhandledErrors` em `test/_setup.ts:146` tratam erro esperado, ou consumir `t.errors` na própria asserção.
- **RF-10:** cookie com seal legado (1 iteração, como em `test/session.test.ts:134-146`) com `A`, lido com `{ password: P, extraUnsealPasswords: [A] }`: dados e `id` originais; `Set-Cookie` abre com `{ password: P }` no seal atual.
- **RF-10 (borda):** o mesmo cenário com `legacySealFallback: false` não devolve a sessão original.

Todos devem falhar hoje, exceto o de `legacySealFallback: false` e o de `ttl` vencido, que já passam.

**Cobre:** RF-08, RF-09, RF-10
**Depende de:** T-04
**Aceite:** os testes de RF-08, RF-09 e RF-10 (caso principal) falham hoje pelo motivo certo. Os demais passam. Tudo em web e node, sem erro não tratado vazando para o `afterEach`.
**Arquivos:** `test/session.test.ts`

---

### T-08 — Laço de senhas em `unsealSession` e `unsealWithPassword`

Em `src/utils/session.ts`:
- Criar `unsealWithPassword(sealed, password, sealOptions, config)` com o corpo atual do `try/catch` de `unsealSession` (modo moderno, depois fallback legado de 1 iteração quando `legacySealFallback` está ativo e o erro é `"Bad hmac value"`).
- Em `unsealSession`, percorrer `[config.password, ...(config.extraUnsealPasswords || [])]` em ordem. Avançar só em `"Bad hmac value"` e só se houver próxima senha; qualquer outro erro é relançado na hora. Parar no primeiro sucesso.
- Manter as checagens de `maxAge` e `idleTimeout` **depois** do laço, sobre o resultado já aberto (D-02, RF-08).
- Não marcar o resultado ainda (isso é T-10).

**Cobre:** RF-03, RF-04, RF-05, RF-08, RF-10 (leitura)
**Depende de:** T-03, T-05, T-07
**Aceite:** os testes de T-05 e T-07 passam, em web e node. Todos os testes anteriores de `test/session.test.ts` continuam passando.
**Arquivos:** `src/utils/session.ts`

---

### T-09 — Validação de tamanho das extras

Em `src/utils/session.ts`, criar `assertExtraUnsealPasswords(config)` e chamá-la como primeira instrução de `getSession`, antes da criação da entrada em `context.sessions`. Retornar cedo quando `extraUnsealPasswords` é ausente ou vazio. O mínimo é `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` das opções resolvidas por `resolveSealOptions`. A mensagem cita o índice e não cita o valor da senha. Não validar `password` (fora do escopo; PRD R4).

**Cobre:** RF-09
**Depende de:** T-03, T-07
**Aceite:** o teste de RF-09 de T-07 passa, em web e node. Com `extraUnsealPasswords` vazio ou ausente, nenhuma validação extra é executada.
**Arquivos:** `src/utils/session.ts`

---

### T-10 — Marcador `kSealedWithExtra` e reseal da sessão

Em `src/utils/session.ts` e `src/utils/internal/session.ts`:
- Em `unsealSession`, marcar o resultado com `kSealedWithExtra` quando a senha que abriu não é a primeira (índice > 0), incluindo o caso legado.
- Em `getSession`, ler e apagar o marcador de forma incondicional, logo após o tratamento de `kLegacySeal` e antes do `Object.assign`. Apagar também quando a sessão veio do cabeçalho.
- Trocar a condição de reseal para `session.id && sessionFromCookie && (legacySeal || sealedWithExtra || shouldSlide(session, config))`. Atualizar o comentário ao lado.
- Sessões lidas por cabeçalho não são reseladas (RF-07): a condição já exige `sessionFromCookie`.

**Cobre:** RF-06, RF-07, RF-10 (reseal)
**Depende de:** T-02, T-06, T-08
**Aceite:** os testes de T-06 passam, em web e node. Uma verificação extra: `Reflect.ownKeys` da sessão retornada por `getSession` não contém o símbolo `kSealedWithExtra` (D-03, R5). Adicionar esse teste em `test/session.test.ts` como parte desta tarefa.
**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`

---

### T-11 — Verificação final de regressão e API

Rodar a suíte completa e conferir a superfície pública.
- Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test`.
- Conferir que `src/index.ts` não ganhou export e que o `git diff` toca só os arquivos da seção "Arquivos" de cada tarefa.
- Conferir que `src/utils/internal/iron-crypto.ts` e o formato do token não mudaram.

**Cobre:** RF-11, RF-12
**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10
**Aceite:** todos os comandos passam. Se algum falhar, registrar a saída completa na descrição do PR em vez de resumir.
**Arquivos:** nenhum (apenas verificação)
