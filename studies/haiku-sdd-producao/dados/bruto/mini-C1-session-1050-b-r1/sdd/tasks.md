# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050)

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-08, estratégia de testes).

Ordem de trabalho: escrever os testes de rotação primeiro (T-01) e confirmar que falham; depois implementar (T-02 a T-05); por fim rodar a suíte completa (T-06).

Cobertura dos requisitos: RF-01 (T-02, T-07), RF-02 (T-01, T-03), RF-03 (T-01, T-03), RF-04 (T-01, T-03), RF-05 (T-06), RF-06 (T-01, T-04), RF-07 (T-01, T-06).

---

### T-01 — Casos de teste de rotação (vermelhos antes da implementação)

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** nenhuma

**Aceite:**
- Os casos da tabela "Estratégia de testes" da techspec são adicionados em `describeMatrix` (web e node), usando `seal` de `src/utils/internal/iron-crypto.ts` para os selos de teste.
- Os casos de sessão antiga aceita, senha desconhecida rejeitada, selagem só com a senha nova, lista vazia ou ausente, senha extra curta, ordem com parada no primeiro acerto, legado com extra, legado com `legacySealFallback: false` e sessão expirada com extras estão presentes.
- Ao rodar `pnpm vitest run test/session.test.ts`, os casos de rotação falham (o campo ainda não é usado) e os casos já existentes passam.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

**Depende de:** T-01

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]` logo depois de `password`, com o JSDoc da techspec (D-07): tamanho mínimo de 32 caracteres, só desselam, ordem de tentativa, lista curta e remoção de responsabilidade de quem configura.
- Nenhum outro nome público novo é exportado (`src/index.ts` e `test/unit/package.test.ts` não mudam).
- `pnpm typecheck` passa com uma configuração que usa o campo.

**Arquivos:** `src/utils/session.ts`

---

### T-03 — Tentativa de unseal em ordem, parando na primeira senha que valida

**Cobre:** RF-02, RF-03, RF-04

**Depende de:** T-02

**Aceite:**
- `unsealSession` tenta `[config.password, ...extraUnsealPasswords]` nessa ordem, usando `unsealWithAnyPassword` e `isBadHmac` (esboço da techspec).
- Só `Bad hmac value` avança para a próxima senha; qualquer outro erro é relançado na hora (D-02).
- `sealSession` continua usando apenas `config.password` (D-05), sem mudança de código.
- Os casos de sessão antiga aceita, senha desconhecida, selagem com a senha nova e ordem com parada no primeiro acerto passam em web e node. A contagem de `deriveBits` é 3 nesse último caso.
- Sessão expirada com extras falha na primeira tentativa (sem derivações para as demais senhas).

**Arquivos:** `src/utils/session.ts`

---

### T-04 — Fallback legado por senha e validação das extras

**Cobre:** RF-06

**Depende de:** T-03

**Aceite:**
- Para cada senha, o fallback legado (1 iteração) roda depois da iteração padrão, só se `legacySealFallback !== false` (D-03). Esse trecho vive em `unsealWithPassword`, com a senha da iteração no lugar de `config.password`.
- Os casos de sessão legada com senha extra e de `legacySealFallback: false` com extra passam em web e node.
- `assertUnsealPasswords` roda antes de qualquer tentativa e lança `Password string too short (min N characters required)` para extras curtas, sem validar `password` (D-04).
- O caso de senha extra curta passa, e a validação não muda a mensagem de `password = ""` (que continua `Empty password`, vinda do iron).

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-05 — Revisão dos helpers internos e limites de arquivo

**Cobre:** RF-02, RF-05

**Depende de:** T-04

**Aceite:**
- `shouldSlide` e `sessionExpires` não mudam (P4: `maxAge` e `idleTimeout` seguem independentes da senha que abriu a sessão).
- Não há regravação de sessão dentro de `getSession` (D-06); nenhuma senha extra é usada para selar.
- `src/utils/internal/iron-crypto.ts` não tem diff.
- O arquivo `src/utils/session.ts` cresce cerca de 40 linhas; a divisão em arquivo próprio fica como acompanhamento (risco 7).

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Suíte completa, lint e typecheck

**Cobre:** RF-05, RF-07

**Depende de:** T-04, T-05

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa nos modos web e node, incluindo os casos novos e todos os existentes sem mudança de expectativa.
- `pnpm vitest run test/unit/iron-crypto.test.ts test/unit/package.test.ts` passa.
- `pnpm lint` (oxlint, oxfmt --check e tsc) e `pnpm typecheck` passam.
- `pnpm test` (suíte completa com cobertura) passa, ou a falha existente, se houver, é reportada com a saída.

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts`

---

### T-07 — Exemplo de configuração na documentação (opcional)

**Cobre:** RF-01

**Depende de:** T-02

**Aceite:**
- `docs/4.examples/handle-session.md` menciona `extraUnsealPasswords` no exemplo de configuração (perto da linha 29), com a nota de que as senhas antigas só desselam e devem ser removidas após a janela de rotação.
- Tarefa opcional segundo D-07; pode ser feita depois do merge se o time preferir.

**Arquivos:** `docs/4.examples/handle-session.md`

---

## Pendências para confirmação (fora das tarefas)

- P3 / D-06: confirmar com o time que a regravação imediata de sessões abertas por senha extra fica fora desta entrega.
- Limite de tamanho da lista (risco 1): só vira barreira se o time decidir; fora do PRD.
