# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050)

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-07, estratégia de testes).

Ordem geral: primeiro o teste de regressão que falha (T-01), depois a implementação, depois os casos por requisito e a verificação final, conforme `AGENTS.md` (Bug Fix Workflow).

Pendência de decisão antes de T-04: **D-06** (migração no slide com `idleTimeout`). A recomendação da techspec é mantê-la e corrigir a redação do PRD (ver T-11). As tarefas assumem essa recomendação.

---

### T-01 — Teste de regressão de abertura por senha extra

Escrever, em `test/session.test.ts` (dentro de `describeMatrix`, após o caso "rejects legacy sessions with legacySealFallback: false"), os casos que hoje devem falhar:

- `opens sessions sealed with an extra password` (sessão selada com `"antiga"`, config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`; `id`, `createdAt` e `data` iguais aos originais).
- `rejects extra passwords shorter than 32 characters` (D-05 / P1: `unsealSession` com extra de 10 caracteres lança `too short`).

Não alterar a implementação nesta tarefa.

**Cobre:** RF-02 (e premissa P1 do PRD)
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` executa; o caso `opens sessions sealed with an extra password` falha nas duas variantes (web e node) porque hoje cria uma sessão nova; o caso de extra curta também falha. Registrar a saída do teste antes da T-02.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`

Adicionar `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig` (`src/utils/session.ts`, ~linha 48), com o JSDoc da techspec: senhas só abrem sessões, são testadas na ordem declarada após `password`, cada uma soma uma tentativa de PBKDF2, cada uma deve ter pelo menos 32 caracteres, e a senha antiga deve ser removida depois de `maxAge` ou `idleTimeout`. Não mudar o JSDoc de `password` nem `sealSession`.

**Cobre:** RF-01
**Depende de:** T-01
**Aceite:** o campo existe com o tipo e o JSDoc descritos; `pnpm typecheck` passa; código que não usa o campo continua compilando (P5).

**Arquivos:** `src/utils/session.ts`

---

### T-03 — Teste de selo só com a senha atual

Adicionar em `test/session.test.ts` o caso `seals with the current password only`: com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, uma requisição que chama `update` grava um cookie que `unseal(cookie, "nova")` abre e `unseal(cookie, "antiga")` rejeita com `Bad hmac value`. Esse caso é uma guarda: deve passar antes e depois da implementação.

**Cobre:** RF-01
**Depende de:** T-02
**Aceite:** o caso passa com a implementação atual e continua passando após T-04.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Laço de abertura em `unsealSession`

Implementar em `src/utils/session.ts` (linhas ~312-367):

- Helper `isBadHmac(error)`: verdadeiro apenas para `Bad hmac value` (D-03).
- Helper `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`: recebe o corpo atual do `try`/`catch` do fallback legado e troca `config.password` pelo parâmetro, mantendo a condição (`legacySealFallback === false`, `iterations === 1`, `Bad hmac value`) e a marca `kLegacySeal` (D-04: iteração completa, depois a legada, por senha).
- `unsealSession` faz o laço sobre `[config.password, ...extraUnsealPasswords]`; só `Bad hmac value` avança; outro erro é relançado; se nenhuma abrir, relança o primeiro erro `Bad hmac value`.
- Sem extras, o erro relançado é o mesmo de hoje (R-E).
- Assinatura pública de `unsealSession` e `getSession` não mudam (D-02).

**Cobre:** RF-02, RF-03
**Depende de:** T-01, T-02
**Aceite:** T-01 passa (web e node); `pnpm vitest run test/session.test.ts` continua verde nos casos existentes; `unsealSession` segue exportado com a mesma assinatura.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Validação do tamanho mínimo das extras

Em `unsealSession`, antes do laço, rejeitar qualquer item de `extraUnsealPasswords` com menos caracteres que `sealOptions.integrity.minPasswordlength`, com a mesma mensagem de `generateKey` (`Password string too short (min N characters required)`) (D-05). Não pular extras silenciosamente.

**Cobre:** RF-02 (premissa P1 do PRD)
**Depende de:** T-04
**Aceite:** o caso `rejects extra passwords shorter than 32 characters` (T-01) passa; uma extra curta faz a leitura lançar antes de qualquer tentativa de PBKDF2.

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Sessão com senha desconhecida continua inválida

Adicionar o caso `replaces sessions sealed with an unknown password`: selar com `"desconhecida"`; com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, `getSession` devolve sessão com `id` diferente do cookie e não lança.

**Cobre:** RF-04
**Depende de:** T-04
**Aceite:** o caso passa em web e node; nenhum erro chega ao cliente (`ctx.errors` vazio).

**Arquivos:** `test/session.test.ts`

---

### T-07 — Expiração vale para sessões abertas por senha extra

Adicionar o caso `expires sessions opened by an extra password`: selar com `"antiga"` e `createdAt` mais antigo que `maxAge`; com `extraUnsealPasswords: ["antiga"]`, a leitura devolve uma sessão nova, sem erro. Verificar também `idleTimeout` se o teste for simples de montar.

**Cobre:** RF-05
**Depende de:** T-04
**Aceite:** o caso passa; a sessão original não é reativada.

**Arquivos:** `test/session.test.ts`

---

### T-08 — Fallback de selo legado para cada senha

Adicionar o caso `unseals legacy sessions sealed with an extra password`:

- Selar com `"antiga"` usando 1 iteração. Com `legacySealFallback` padrão: sessão aberta e resselada com `"nova"` (conferir com `unseal(resealed, "nova", sealDefaults)`).
- Com `legacySealFallback: false`: sessão tratada como inválida (sessão nova), como hoje.

**Cobre:** RF-06
**Depende de:** T-04
**Aceite:** os dois cenários passam em web e node.

**Arquivos:** `test/session.test.ts`

---

### T-09 — Senhas extras no header de sessão e nos cookies em chunks

Adicionar o caso `reads extra-password sessions from the session header`: header `x-h3-test-session` (a config usa `name: "h3-test"`) com sessão selada com `"antiga"` devolve a sessão original. Verificar também que um cookie em chunks selado com `"antiga"` é lido (pode ficar em `test/cookies.test.ts` se for mais natural).

**Cobre:** RF-07
**Depende de:** T-04
**Aceite:** os casos passam em web e node; o header usado é `x-{name}-session` em minúsculas.

**Arquivos:** `test/session.test.ts`, `test/cookies.test.ts` (se o caso de chunks for ali)

---

### T-10 — Regressão: suíte existente sem extras

Adicionar o caso `keeps the current behavior when extraUnsealPasswords is empty` (`extraUnsealPasswords: []` com cookie selado com `password` tem o mesmo resultado da config sem o campo). Rodar a suíte existente sem alterar testes antigos.

**Cobre:** RF-03
**Depende de:** T-04
**Aceite:** `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/` e `pnpm vitest run test/cookies.test.ts` passam sem alteração em casos existentes. Se algum existente precisar de ajuste, parar e reportar, porque o plano não prevê isso.

**Arquivos:** `test/session.test.ts`

---

### T-11 — Corrigir a redação do PRD (RF-07 e migração)

Ajustar `sdd/prd.md`, conforme a techspec:

- RF-07: trocar `x-h3-session` por `x-{name}-session` (o nome padrão `h3` gera `x-h3-session`).
- "Fora de escopo", primeiro item: a migração também pode acontecer na leitura quando `idleTimeout` está ativo e a janela passou da metade (D-06), porque `shouldSlide` regrava com `password`. Sem `idleTimeout`, a migração continua só na escrita.

Confirmar o D-06 com quem pediu antes de fechar esta tarefa. Até lá, a recomendação é manter o comportamento e ajustar a redação.

**Cobre:** RF-07 (redação), RF-05 (escopo de migração)
**Depende de:** nenhuma (a decisão D-06 deve estar confirmada antes de concluir)
**Aceite:** o PRD não cita mais `x-h3-session` como header genérico e descreve a migração com `idleTimeout` de forma coerente com D-06.

**Arquivos:** `sdd/prd.md`

---

### T-12 — Verificação final

Rodar os checks completos e registrar a saída:

- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/`
- `pnpm vitest run test/cookies.test.ts`
- `pnpm lint` (`oxlint` e `oxfmt --check`)
- `pnpm typecheck`

Se algum falhar, reportar a saída completa e não marcar a entrega como concluída.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** T-03, T-05, T-06, T-07, T-08, T-09, T-10, T-11
**Aceite:** todos os comandos passam; a lista de RF do PRD está coberta pelos casos listados.

**Arquivos:** nenhum arquivo novo; roda os testes e checks sobre `src/utils/session.ts`, `test/session.test.ts` e `test/cookies.test.ts`

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-02, T-03, T-12 |
| RF-02 | T-01, T-04, T-05, T-12 |
| RF-03 | T-04, T-10, T-12 |
| RF-04 | T-06, T-12 |
| RF-05 | T-07, T-11, T-12 |
| RF-06 | T-08, T-12 |
| RF-07 | T-09, T-11, T-12 |

## Pontos para confirmar

1. **D-06** — aceitar a migração no slide com `idleTimeout` (recomendado) ou bloquear o reseal para sessões de senha extra. Bloqueá-lo muda T-04 e T-07.
2. **D-05** — aceitar que uma extra curta faz toda leitura de sessão falhar (recomendado, por ser explícito) ou pular a extra com aviso. Pular muda T-05.
3. A techspec cita `sdd/pedido.md`, que não existe nesta pasta. Nenhuma tarefa depende dele.
