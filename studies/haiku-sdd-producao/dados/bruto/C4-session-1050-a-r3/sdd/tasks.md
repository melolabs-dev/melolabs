# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09).

Ordem sugerida: T-01 → T-02 a T-06 (testes, em sequência, pois todas editam `test/session.test.ts`) → T-07 → T-08 e T-09 → T-10 e T-11 → T-12.

Cobertura dos requisitos: RF-01 (T-07, T-11), RF-02 (T-02, T-08), RF-03 (T-02, T-09), RF-04 (T-01, T-12), RF-05 (T-03, T-07), RF-06 (T-04, T-09), RF-07 (T-05, T-10), RF-08 (T-06, T-09), RF-09 (T-07, T-12).

---

### T-01 — Ajustar testes existentes para senha em variável string

Cobre: RF-04
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` passa sem alterar nenhum `expect` existente. As chamadas diretas de `seal`/`unseal` em `test/session.test.ts` (linhas ~137, ~157, ~164) usam uma `const password` do tipo string extraída de `sessionConfig.password`, e `pnpm typecheck` ainda não é exigido nesta etapa.
Arquivos: `test/session.test.ts`

---

### T-02 — Testes de seal e unseal com lista de senhas

Cobre: RF-01, RF-02, RF-03
Depende de: T-01
Aceite: novos casos em `describeMatrix` (web e node) em `test/session.test.ts`:
- `password: [pw0, pw1]` aceita a configuração e `useSession` roda sem erro (RF-01);
- token selado com a primeira senha abre com `pw0` e falha com apenas `pw1` (RF-02);
- cookie selado com `pw1` passa por `getSession` e devolve `id` e `data` originais (RF-03);
- cookie de senha desconhecida devolve sessão nova e vazia, sem erro propagado (RF-03).
Os casos devem FALHAR antes da implementação. Confirmar com `pnpm vitest run test/session.test.ts`.
Arquivos: `test/session.test.ts`

---

### T-03 — Testes de validação da configuração de senhas

Cobre: RF-05
Depende de: T-02
Aceite: novos casos em `test/session.test.ts`, chamando as funções diretamente com `mockEvent` e sem rota (`expect(...).rejects.toThrow`):
- `password: []` falha em `useSession`, `getSession` e `updateSession`, com mensagem que diz que é preciso ao menos uma senha, e sem `Set-Cookie`;
- entrada curta na cauda da lista falha na configuração, mesmo com cookie válido de outra senha (Risco 2);
- lista com mais de 4 entradas falha (D-06);
- a mensagem de erro não cita índice nem valor da senha (Risco 4).
Os casos devem FALHAR antes da implementação.
Arquivos: `test/session.test.ts`

---

### T-04 — Testes do fallback legado com senhas da lista

Cobre: RF-06
Depende de: T-02
Aceite: novos casos em `test/session.test.ts`:
- `password: [pw0, pw1]` com `legacySealFallback` ligado e cookie legado (1 iteração) selado com `pw1` abre a sessão e devolve `Set-Cookie` selado com `pw0`;
- o mesmo cookie com `legacySealFallback: false` não abre a sessão, como hoje.
Os casos devem FALHAR antes da implementação.
Arquivos: `test/session.test.ts`

---

### T-05 — Teste de migração gradual por reselagem

Cobre: RF-07
Depende de: T-02
Aceite: novo caso em `test/session.test.ts`, com `idleTimeout` configurado e `vi.useFakeTimers` (como no caso da linha ~188): cookie selado com `pw1` que passou da metade da janela ociosa gera `Set-Cookie` selado com `pw0`; a requisição seguinte só é aceita com `pw0` quando `pw1` sai da lista. O caso deve FALHAR antes da implementação.
Arquivos: `test/session.test.ts`

---

### T-06 — Teste do header de sessão com senha antiga

Cobre: RF-08
Depende de: T-02
Aceite: novo caso em `test/session.test.ts`: requisição com header `x-h3-session` contendo valor selado com `pw1`, com `password: [pw0, pw1]`, faz `getSession` devolver `id` e `data` originais. O caso deve FALHAR antes da implementação.
Arquivos: `test/session.test.ts`

---

### T-07 — Tipo `string | string[]`, normalização e validação em `session.ts`

Cobre: RF-01, RF-05, RF-09
Depende de: T-03, T-04, T-05, T-06
Aceite:
- `SessionConfig.password` vira `string | string[]` (`src/utils/session.ts:40-48`);
- função interna `sessionPasswords(config)` (sem `export`) normaliza para `string[]` e valida lista vazia, máximo de `MAX_SESSION_PASSWORDS = 4` e tamanho mínimo por entrada (`max(encryption.minPasswordlength, integrity.minPasswordlength)`), só para listas;
- a validação roda no início de `useSession`, antes do retorno de cache em `getSession`, em `updateSession`, `sealSession` e `unsealSession`;
- nenhum nome público novo em `src/index.ts`;
- os testes de T-03 passam; os de T-02, T-04, T-05 e T-06 ainda podem falhar até T-08 e T-09.
Arquivos: `src/utils/session.ts`

---

### T-08 — Selar sempre com a primeira senha

Cobre: RF-02
Depende de: T-07
Aceite: `sealSession` chama `seal(session, passwords[0], …)` em vez de `config.password` (`src/utils/session.ts:282-304`). O caso de RF-02 em `test/session.test.ts` passa, e o cookie gerado continua no formato `Fe26.2**` idêntico ao de senha única.
Arquivos: `src/utils/session.ts`

---

### T-09 — Desselar com laço sobre as senhas, incluindo legado e header

Cobre: RF-03, RF-06, RF-08
Depende de: T-07
Aceite:
- função interna `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` (sem `export`) faz o unseal atual e, se o fallback legado estiver ativo, o unseal com 1 iteração;
- `unsealSession` percorre a lista na ordem; só `"Bad hmac value"` avança para a próxima senha, e os demais erros são relançados de imediato (D-04);
- se nenhuma senha valida, relança o último `"Bad hmac value"` (D-07);
- os checks de `maxAge` e `idleTimeout` continuam depois do laço;
- os casos de T-02 (RF-03), T-04 (RF-06) e T-06 (RF-08) passam, e `legacySealFallback: false` não abre cookie legado com senha da cauda.
Arquivos: `src/utils/session.ts`

---

### T-10 — Migração gradual pela reselagem existente

Cobre: RF-07
Depende de: T-08, T-09
Aceite: o caso de T-05 passa sem mudar o gatilho de reselagem (`src/utils/session.ts:214-216` e `:414-421`). A reselagem usa `passwords[0]` via `sealSession`/`updateSession`. Nenhuma varredura em lote é adicionada. Os casos existentes de idle em `test/session.test.ts` (linhas ~188-510) continuam passando.
Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-11 — JSDoc de `SessionConfig.password`

Cobre: RF-01, RF-09
Depende de: T-08
Aceite: o JSDoc em `src/utils/session.ts:40-48` descreve que a primeira senha sela e as demais só abrem sessões já emitidas, que a ordem é prioridade, o mínimo de caracteres por entrada e o limite de 4 entradas. Sem mudança em `CHANGELOG.md`. Revisão visual do bloco.
Arquivos: `src/utils/session.ts`

---

### T-12 — Verificação final: suíte, lint e tipos

Cobre: RF-04, RF-09
Depende de: T-10, T-11
Aceite:
- `pnpm vitest run` passa por completo (critério de RF-04);
- `pnpm lint` passa;
- `pnpm typecheck` passa, incluindo `test/` com `password` em lista;
- `git diff` não mostra mudança em `src/utils/internal/iron-crypto.ts`, `src/index.ts` nem `src/utils/auth.ts`;
- opcional: `pnpm bench:node` para confirmar que o caminho de senha única não ficou mais lento.
Arquivos: `src/utils/session.ts`, `test/session.test.ts`
