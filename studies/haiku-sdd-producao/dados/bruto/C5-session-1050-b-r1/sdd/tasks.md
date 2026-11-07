# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08, R-07 a R-10).

Ordem de trabalho: primeiro os testes (vermelhos, exceto RF-06), depois a implementação, conforme o fluxo de correção do AGENTS.md. Todos os testes ficam em `describeMatrix`, para rodar nos modos `web` e `node`.

---

### T-01 — Baseline da suíte existente (RF-06)

**Cobre:** RF-06
**Depende de:** nenhuma
**Aceite:** antes de qualquer alteração, `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit` passam sem mudança. Acrescentar em `test/session.test.ts` um teste com `extraUnsealPasswords: []` que produz o mesmo `Set-Cookie` e o mesmo corpo da configuração sem o campo. Esse teste passa antes e depois da implementação (o campo ainda não existe no tipo, então o teste deve usar a configuração tipada como as demais; se o typecheck reclamar, a cobertura de tipo vai na T-08).
**Arquivos:** `test/session.test.ts`

---

### T-02 — Testes vermelhos de abertura com senha extra (RF-01, RF-04, RF-05)

**Cobre:** RF-01, RF-04, RF-05
**Depende de:** T-01
**Aceite:** novos testes dentro de `describeMatrix("session", ...)`, após os testes de legado e antes de `idleTimeout`:
- RF-01: cookie selado com `OLD`, config `{ password: NEW, extraUnsealPasswords: [OLD] }` mantém `id`, `createdAt` e `data`.
- RF-04: `[WRONG, OLD]` e `[OLD, OLD, NEW]` dão o mesmo resultado. Com `legacySealFallback: false` e `vi.spyOn(crypto.subtle, "deriveBits")`, `[WRONG, OLD]` custa 4 chamadas (1 + 1 + 2) e `password === OLD` com extras `[OLD]` custa 2.
- RF-05: cookie `OLD` com `maxAge` vencido e outro com `idleTimeout` vencido, usando `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:189-190`. Resultado é sessão nova e a contagem de `deriveBits` é a de uma única abertura.
Os testes devem falhar antes da implementação (T-04). Registrar a falha no histórico antes de seguir.
**Arquivos:** `test/session.test.ts`

---

### T-03 — Testes vermelhos de selagem e regravação (RF-02, RF-03, RF-09)

**Cobre:** RF-02, RF-03, RF-09
**Depende de:** T-01
**Aceite:** novos testes em `describeMatrix("session", ...)`:
- RF-02: criar e atualizar sessão com config que tem extras. `unseal(cookie, NEW, defaults)` abre e `unseal(cookie, OLD, defaults)` lança `Bad hmac value`.
- RF-03: ler cookie selado com `OLD`. A primeira resposta tem exatamente um `Set-Cookie`, e a segunda requisição, sem extras, mantém o mesmo `id`.
- RF-09: sessão selada com `OLD` enviada pelo header `x-h3-test-session` é aceita (`id` original) e a resposta não tem `Set-Cookie`.
- Regressão de D-04/R-09: `kExtraSeal` não aparece em `session.data`, no `session` retornado nem no cookie regravado (`unseal` do cookie regravado não contém a chave).
Os testes de RF-02 e RF-03 devem falhar antes da implementação; o de RF-09 pode passar antes, e isso deve ser anotado.
**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes vermelhos de legado e validação (RF-07, RF-08)

**Cobre:** RF-07, RF-08
**Depende de:** T-01
**Aceite:** novos testes em `describeMatrix("session", ...)`:
- RF-07 (a): cookie legado de 1 iteração selado com `OLD`, config com extras e fallback padrão. A sessão abre e a resposta regrava com `NEW` nas opções atuais; `unseal(resealed, NEW, sealDefaults)` abre.
- RF-07 (b): mesmo cookie com `legacySealFallback: false` é rejeitado (`id` diferente do original).
- RF-08: extra com menos de 32 caracteres colocado antes da senha que selou o cookie faz a leitura cair em sessão nova (D-03). Uma `password` curta produz o mesmo efeito. O teste documenta o comportamento, não o corrige.
RF-07 (a) deve falhar antes da implementação. RF-07 (b) e RF-08 podem passar antes; anotar.
**Arquivos:** `test/session.test.ts`

---

### T-05 — Símbolo interno `kExtraSeal` (D-04)

**Cobre:** RF-03, RF-09
**Depende de:** nenhuma
**Aceite:** `src/utils/internal/session.ts` exporta `kExtraSeal` com `Symbol.for("h3.internal.session.extra-seal")`, logo após `kLegacySeal` (linhas 7-9), no mesmo padrão. Nenhum export público novo: `src/index.ts` não muda e `test/unit/package.test.ts` continua verde.
**Arquivos:** `src/utils/internal/session.ts`

---

### T-06 — Campo `extraUnsealPasswords` e laço de abertura (RF-01, RF-04, RF-05, RF-06, RF-08)

**Cobre:** RF-01, RF-04, RF-05, RF-06, RF-08
**Depende de:** T-02, T-04, T-05
**Aceite:**
- `SessionConfig` ganha `extraUnsealPasswords?: string[]` logo após `password` (linha 48), com o JSDoc do techspec.
- `unsealSession` mantém a assinatura (P-05) e troca o try/catch das linhas 323-348 por `openWithPasswords`. O laço usa `new Set([config.password, ...extras])`, aplica `openWithPassword` (formato atual e legado, sem mudança de regra) e só avança para a próxima senha quando o erro é `Bad hmac value`. Outros erros propagam.
- A senha que abre fora da posição 0 recebe `kExtraSeal`.
- A checagem de `maxAge` e `idleTimeout` (linhas 350-365) continua depois do laço, uma única vez (D-01).
- Helpers `openWithPasswords` e `openWithPassword` ficam no fim de `session.ts`.
- T-02 e T-04 (RF-08) passam; `test/session.test.ts` e `test/unit` continuam verdes sem alterar asserções existentes.
**Arquivos:** `src/utils/session.ts`

---

### T-07 — Regravação ao abrir com senha extra em `getSession` (RF-02, RF-03, RF-07, RF-09)

**Cobre:** RF-02, RF-03, RF-07, RF-09
**Depende de:** T-03, T-04, T-06
**Aceite:**
- Em `getSession` (linhas 198-216), extrair `extraSeal` de `unsealed[kExtraSeal]`, apagar a marca junto com `kLegacySeal` antes de copiar o payload, e incluir `extraSeal` na condição de regravação da linha 214, mantendo `sessionFromCookie` (D-08) e a guarda `unsealed &&` (R-10).
- A regravação usa `updateSession` com `password` e as opções atuais de selagem.
- Os testes de T-03 (RF-02, RF-03, RF-09) e T-04 (RF-07) passam. A regravação de RF-07 usa as opções atuais.
- `kExtraSeal` não vaza para o cookie nem para `session` (teste de regressão de T-03).
**Arquivos:** `src/utils/session.ts`

---

### T-08 — Cobertura de tipo e documentação da rotação (RF-01, RF-08)

**Cobre:** RF-01, RF-08
**Depende de:** T-06
**Aceite:**
- Se existir caso de tipo para `SessionConfig` em `test/unit/types.test-d.ts`, incluir `extraUnsealPasswords?: string[]`. Se não existir, não criar arquivo novo só para isso.
- `docs/4.examples/handle-session.md` ganha nota sobre rotação de senha: mover a senha antiga para `extraUnsealPasswords`, a regravação ao abrir, o custo de CPU por senha extra com `legacySealFallback` (R-03, D-07), a remoção da senha após `maxAge`/`idleTimeout` (R-01, R-02), o efeito de senha extra curta (R-07) e a recomendação de variáveis de ambiente (R-05). A nota fica perto da linha 37 e nas opções.
**Arquivos:** `test/unit/types.test-d.ts`, `docs/4.examples/handle-session.md`

---

### T-09 — Verificação final e gates (RF-06, RF-02, RF-03, RF-04, RF-05, RF-07, RF-08, RF-09)

**Cobre:** RF-06 (suíte existente), e reconfirma todos os RFs de T-02 a T-07
**Depende de:** T-07, T-08
**Aceite:** os seguintes comandos passam, sem enfraquecer asserções existentes:
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (lint, typecheck e cobertura completa)
Se `pnpm bench:node` for executado (R-03), registrar o resultado no relatório de entrega. Se algum gate falhar, reportar a saída real, sem marcar como concluído.
**Arquivos:** nenhum arquivo novo; verificação somente
