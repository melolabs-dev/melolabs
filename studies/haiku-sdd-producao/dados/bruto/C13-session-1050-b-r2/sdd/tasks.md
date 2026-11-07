# Tarefas de implementação — Múltiplas senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-09), `sdd/techspec.md` (D-01 a D-07, R1 a R5), h3js/h3#1050.

Ordem sugerida: T-01 primeiro (testes vermelhos, como manda o `AGENTS.md`). T-07 e T-08 fecham a mudança.
Todas as tarefas tocam só `src/utils/session.ts` e `test/session.test.ts`, salvo indicação.

Os números de linha citados são aproximados. Conferir antes de editar, porque o arquivo pode ter mudado.

---

### T-01 — Escrever os testes de regressão antes da implementação

Criar, em `test/session.test.ts`, dentro da `describeMatrix` existente (`:15`), os casos da tabela "Estratégia de testes" da techspec:

- cookie selado com `extraUnsealPasswords[1]` (dados, `id` e `createdAt` preservados);
- `POST` com cookie antigo, e depois abrir o cookie novo com `password` (regravado com a senha atual);
- senha que não está na lista (sessão nova, `data` vazio, resposta 200, `ctx.errors` vazio);
- sessão com `createdAt` além de `maxAge` (vira sessão nova);
- header `x-h3-test-session` com selo antigo (dados lidos);
- selo com 1 iteração e senha extra (abre, regrava com `password`).

Rodar os testes e confirmar que os casos que dependem do loop **falham**. Sem essa falha, o teste não prova nada.

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` roda e os casos novos falham pelo motivo esperado (senha antiga não aberta). Os testes existentes continuam verdes. A saída do teste vermelho fica registrada na descrição da PR ou nas notas da tarefa.
**Arquivos:** `test/session.test.ts`

---

### T-02 — Adicionar o campo `extraUnsealPasswords` em `SessionConfig`

- Incluir `extraUnsealPasswords?: string[]` em `SessionConfig` (`src/utils/session.ts:39`), com JSDoc no formato da techspec (usada só para abrir; tentada depois de `password`; nunca usada para selar; mesmo tamanho mínimo de `password`).
- Ajustar a JSDoc de `password` (`:41`) para citar as extras.
- Não adicionar nada em `Session` nem exportar nome novo (D-06).
- Confirmar se o `tsconfig` inclui `test/`. Se não incluir, o teste de tipo vai para `test/unit/types.test-d.ts`.

**Cobre:** RF-01
**Depende de:** T-01
**Aceite:** um literal `{ password: "...", extraUnsealPasswords: ["..."] }` passado a `useSession` e a `getSession` compila em `pnpm typecheck`. Um literal sem o campo continua compilando.
**Arquivos:** `src/utils/session.ts`, `test/unit/types.test-d.ts` (só se `test/` não entrar no `tsconfig`)

---

### T-03 — Extrair o helper `unsealWithPassword` (refatoração sem mudança de comportamento)

- Mover o `try/catch` atual de `unsealSession` (hoje perto de `:322-348`, com o fallback legado de 1 iteração em `:326-336`) para um helper interno `unsealWithPassword(sealed, password, config, sealOptions)`.
- O helper recebe a senha como parâmetro, no lugar de `config.password`.
- Colocar o helper no fim do arquivo, como manda o `AGENTS.md`. Não exportar.
- `unsealSession` ainda usa só `config.password` nesta tarefa. A assinatura não muda.

Esta tarefa não altera nenhum teste. A suíte existente precisa passar sem mudança.

**Cobre:** RF-04
**Depende de:** T-01
**Aceite:** `pnpm vitest run test/session.test.ts test/unit/` passa, sem alterar expectativa de teste existente. O diff de `src/utils/session.ts` só move código e troca `config.password` pelo parâmetro.
**Arquivos:** `src/utils/session.ts`

---

### T-04 — Implementar o loop de senhas em `unsealSession`

Implementar D-01, D-02, D-03 e D-07 da techspec:

- Para cada senha em `[config.password, ...(config.extraUnsealPasswords || [])]`, chamar `unsealWithPassword`.
- Se der certo, usar o resultado e sair do loop.
- Passar para a próxima senha **só** quando o erro for exatamente `"Bad hmac value"` e não for a última senha. Qualquer outro erro é relançado (`Expired seal`, `Wrong mac prefix`, `Password string too short`).
- Na última senha, relançar o `"Bad hmac value"`. `getSession` já o engole (`:197`).
- Aplicar as checagens de `maxAge` e `idleTimeout` (`:350-365`) **depois** do loop, sobre o payload aberto por qualquer senha.
- A assinatura de `unsealSession` não muda. `sealSession` não muda (D-04).

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-07, RF-08
**Depende de:** T-02, T-03
**Aceite:** todos os casos de T-01 passam. Nenhum caso existente muda de expectativa (RF-04). `getSession` não é alterado.
**Arquivos:** `src/utils/session.ts`

---

### T-05 — Testar a ordem de tentativas e os erros que não podem ser mascarados

Adicionar testes em `test/session.test.ts` (ou em `test/unit/`, se for teste unitário direto):

- senha extra **curta** antes da correta: `unsealSession({} as HTTPEvent, config, sealed)` rejeita com `"Password string too short"` (D-02, D-05, R1). O erro não pode ser engolido nem seguir para a próxima senha;
- um erro que não seja `"Bad hmac value"` (por exemplo, selo expirado) interrompe o loop e é relançado;
- sessão aberta com a senha da posição 2 mantém `id` e `createdAt`.

**Cobre:** RF-03, RF-06
**Depende de:** T-04
**Aceite:** os três casos passam. Confirmar, com uma mudança temporária no loop, que um deles falha quando o erro é engolido. Desfazer a mudança depois.
**Arquivos:** `test/session.test.ts`, `test/unit/` (se usar teste unitário direto)

---

### T-06 — Testar a contagem de derivações PBKDF2 com cookie inválido

Registrar o custo da mudança (R2). Usar `vi.spyOn` sobre `crypto.subtle.deriveBits` e contar as chamadas numa requisição com cookie que nenhuma senha abre.

- Com `password` + 2 extras, o esperado é 2 × (N+1) = 6 derivações, conforme a techspec. Confirmar o número ao rodar: o fallback legado usa 1 iteração e pode ou não aparecer como chamada separada, então o número real pode ser outro. Registrar o valor observado na descrição da PR.

**Cobre:** RF-03
**Depende de:** T-04
**Aceite:** o teste roda e afirma a contagem observada. O número usado no teste e o motivo ficam num comentário curto no próprio teste.
**Arquivos:** `test/session.test.ts`

---

### T-07 — Documentar o limite de senhas extras e a remoção da senha antiga

Cobrir R2, R3 e a pendência 3 da techspec, só na JSDoc de `extraUnsealPasswords`:

- recomendar até 2 senhas extras (cada uma custa uma derivação completa em cada requisição com cookie inválido);
- dizer que a senha antiga só pode sair da lista depois do `maxAge` (ou `idleTimeout`) da sessão mais antiga;
- lembrar que uma sessão aberta com senha extra só é regravada com `password` pelos caminhos existentes (escrita do handler, fallback legado, `idleTimeout`).

Não criar rotina nova de migração (fora do escopo do PRD).

**Cobre:** RF-01
**Depende de:** T-02
**Aceite:** a JSDoc aparece no hover do TypeScript para `extraUnsealPasswords`. `pnpm lint` passa (inclui `oxfmt --check`).
**Arquivos:** `src/utils/session.ts`

---

### T-08 — Verificação final: lint, tipos, suíte e exports

- Rodar `pnpm vitest run test/session.test.ts` e `pnpm vitest run test/unit/`.
- Confirmar que `test/unit/package.test.ts` continua igual. Ele lista os exports (`getSession` `:81`, `unsealSession` `:149`, `useSession` `:152`). Nenhum export novo.
- Rodar `pnpm lint` e `pnpm typecheck`. Ambos precisam terminar sem erro.
- Revisar o diff e confirmar que `sealSession`, `iron-crypto.ts`, `_deprecated.ts` e a v1 não mudaram.

**Cobre:** RF-01, RF-04, RF-09
**Depende de:** T-04, T-05, T-06, T-07
**Aceite:** os quatro comandos terminam sem erro. Nenhum arquivo fora da lista de arquivos da techspec aparece no `git diff`.
**Arquivos:** nenhum arquivo novo; verificação sobre `src/utils/session.ts` e `test/session.test.ts`

---

## Pendências fora destas tarefas

Estas decisões não estão nas tarefas acima. Ficam em aberto até a equipe decidir:

1. Validar `extraUnsealPasswords` em `useSession` com erro explícito (D-05, R1). Hoje a falha de senha curta acontece só ao abrir o selo, e `getSession` a engole.
2. Migração imediata de sessões abertas com senha extra. Rejeitada por ora (techspec, pendência 2).

## Requisitos sem tarefa

Nenhum. Cobertura: RF-01 (T-02, T-07, T-08), RF-02 (T-01, T-04), RF-03 (T-01, T-04, T-05, T-06), RF-04 (T-03, T-08), RF-05 (T-01, T-04), RF-06 (T-01, T-04, T-05), RF-07 (T-01, T-04), RF-08 (T-01, T-04), RF-09 (T-08).
