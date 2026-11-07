# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (decisões D-01 a D-07).

Fluxo: testes primeiro (T-01 a T-06), confirmando que os novos casos falham antes da implementação (AGENTS.md, "Bug Fix Workflow"). Depois a implementação (T-07 a T-10), a documentação (T-11) e a verificação final (T-12).

Pontos do techspec ainda sem confirmação (§9). As tarefas seguem a recomendação do techspec:
- D-04: sem reselagem na leitura por senha extra. Se o usuário quiser reselar, a mudança entra como tarefa nova.
- D-06: validação antecipada de `extraUnsealPasswords` em `getSession` (T-10). Se for recusada, T-10 é removida e a verificação de T-12 não muda.
- D-07: tipo `string[]`, não `readonly string[]`.

---

### T-01 — Teste de tipo para o campo `extraUnsealPasswords`

**Cobre:** RF-01

**Depende de:** nenhuma

Adicionar a `test/unit/types.test-d.ts` as asserções de tipo para `SessionConfig["password"]` (exatamente `string`) e `SessionConfig["extraUnsealPasswords"]` (`string[] | undefined`). Confirmar os imports do arquivo, porque o trecho lido não mostra a importação de `SessionConfig`.

**Aceite:** com o campo ainda ausente, `pnpm typecheck` falha no novo teste. Depois de T-07, passa.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-02 — Testes de abertura com senha extra e de falha sem senha válida

**Cobre:** RF-03, RF-04

**Depende de:** nenhuma

Em `test/session.test.ts`, dentro de `describeMatrix`, usando `sessionConfig` como base:
- cookie selado com `"antiga"` e configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`: a sessão volta com o mesmo `id` e o mesmo `data`, e não há `Set-Cookie` de sessão nova;
- cookie selado com `"antiga"` e `extraUnsealPasswords: ["x-errada", "antiga"]`: a segunda extra é tentada e a sessão abre (RF-03, ordem de declaração);
- cookie selado com `"desconhecida"`: a sessão anterior é descartada, a nova tem `id` diferente e o `Set-Cookie` abre com `"nova"` (RF-04).

**Aceite:** os casos falham antes da implementação e passam depois de T-08 e T-09. Os testes rodam em `web` e `node`.

**Arquivos:** `test/session.test.ts`

---

### T-03 — Testes de selagem sempre com `password`

**Cobre:** RF-02

**Depende de:** nenhuma

Em `test/session.test.ts`:
- cookie selado com `"antiga"`, lido com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, e com `idleTimeout` configurado. Avançar o relógio (`vi.useFakeTimers({ toFake: ["Date"] })`) além de `idleTimeout / 2`. O cookie resultante abre com `"nova"` e não abre com `"antiga"` (`unseal` direto, como em `test/session.test.ts:134-159`);
- uma escrita (`session.update`) com a mesma configuração também resela com `"nova"`.

Usar `vi.useRealTimers()` no `finally`.

**Aceite:** os casos falham antes da implementação (o comportamento de selagem não muda, então eles podem passar já na base, o que deve ser registrado como verificação de regressão e não como falha). Depois de T-08 e T-09, continuam passando.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de fallback legado aplicado a cada senha

**Cobre:** RF-06

**Depende de:** nenhuma

Em `test/session.test.ts`, seguindo o padrão de `test/session.test.ts:134-159` e `:161-186`:
- cookie com 1 iteração PBKDF2 selado com `"antiga"`, configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e `legacySealFallback` não definido: a sessão abre e é resselada com `"nova"`;
- mesmo cookie com `legacySealFallback: false`: a sessão é rejeitada e uma sessão nova é criada.

**Aceite:** os casos falham antes da implementação e passam depois de T-08 e T-09.

**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de expiração para sessões de senhas antigas

**Cobre:** RF-07

**Depende de:** nenhuma

Em `test/session.test.ts`, seguindo o padrão de `test/session.test.ts:375-408`: cookie selado com `"antiga"` cujo `createdAt` passa de `maxAge`, configuração com `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e o mesmo `maxAge`. A sessão é tratada como expirada e uma nova é criada. Incluir também o caso de `idleTimeout` vencido com a senha antiga.

Opcional (techspec §7): spy sobre `unseal` para garantir que `"Expired seal"` não dispara tentativa com outras senhas.

**Aceite:** os casos falham antes da implementação e passam depois de T-09.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Teste de compatibilidade sem senhas extras

**Cobre:** RF-05

**Depende de:** nenhuma

Adicionar em `test/session.test.ts` um caso que repete um teste existente (por exemplo "unseals and reseals legacy sessions") com `extraUnsealPasswords: []`, e garantir que o resultado é igual ao de quando o campo está ausente. Sem alterar asserções dos testes atuais.

**Aceite:** o caso novo passa já na base. Os testes atuais de `test/session.test.ts` continuam passando sem alteração de asserção.

**Arquivos:** `test/session.test.ts`

---

### T-07 — Campo `extraUnsealPasswords` e JSDoc em `SessionConfig`

**Cobre:** RF-01, RF-08

**Depende de:** T-01

Em `src/utils/session.ts`:
- ajustar o JSDoc de `password` (`:40-47`) para dizer que é a única senha usada para selar;
- adicionar `extraUnsealPasswords?: string[]` logo depois de `password` (`:48`), com JSDoc que explica: serve só para abrir sessões; `password` sela; tentativa depois de `password`, na ordem declarada; a entrada deve ser removida quando as sessões antigas expirarem (`maxAge`/`idleTimeout`); a rotação exige `maxAge` ou `idleTimeout`.

Não exportar nenhum nome novo.

**Aceite:** `pnpm typecheck` passa, incluindo T-01. `test/unit/package.test.ts` (snapshot de exports) continua passando sem alteração.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Helpers privados de tentativa de unseal

**Cobre:** RF-02, RF-03, RF-04, RF-06

**Depende de:** T-02, T-03, T-04, T-07

Criar em `src/utils/internal/session.ts` (já existe, hoje só com constantes) dois helpers não exportados pela API pública:
- `isBadHmac(error)`: verdadeiro só para `"Bad hmac value"`;
- `unsealWithPasswords(sealed, config, sealOptions)`: para cada senha em `[config.password, ...extraUnsealPasswords]`, tenta o selo atual e, se `legacySealFallback !== false` e `integrity.iterations !== 1`, tenta o legado com 1 iteração com a mesma senha. Relança qualquer erro que não seja de HMAC. Retorna `{ unsealed, legacySeal }`.

O arquivo `src/utils/session.ts` tem 465 linhas e não deve crescer com esses helpers (AGENTS.md: arquivos com menos de 200 linhas). Os helpers ficam no arquivo interno, e `src/utils/session.ts` importa com extensão `.ts`.

Não alterar `src/utils/internal/iron-crypto.ts` nem `src/index.ts`.

**Aceite:** T-02, T-03 e T-04 passam quando combinados com T-09. Revisão de leitura confirma que `"Expired seal"` e os erros de formato e de configuração não passam para a próxima senha.

**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

---

### T-09 — Ligar `unsealSession` ao helper e manter a expiração

**Cobre:** RF-03, RF-05, RF-07

**Depende de:** T-05, T-06, T-08

Em `src/utils/session.ts`, substituir o corpo de `unsealSession` (`:312-348`) por uma chamada a `unsealWithPasswords` e a marcação de `kLegacySeal` quando `legacySeal` for verdadeiro. As checagens de `maxAge` e `idleTimeout` (`:350-365`) continuam depois do laço, sem alteração (D-05). `sealSession`, `updateSession` e `getSession` não mudam além do necessário.

**Aceite:** `pnpm vitest run test/session.test.ts` passa para T-02, T-03, T-04, T-05 e T-06, e os testes atuais continuam passando sem alteração de asserção.

**Arquivos:** `src/utils/session.ts`

---

### T-10 — Validação antecipada de senhas extras em `getSession`

**Cobre:** RF-03

**Depende de:** T-02, T-09

Condicionada à aprovação de D-06. Em `getSession`, antes de tentar o cookie, lançar erro explícito se alguma entrada de `extraUnsealPasswords` for vazia ou menor que `minPasswordlength` (`config.seal?.encryption.minPasswordlength` ou o padrão de `sealDefaults`). Sem essa validação, a senha inválida cai no `.catch(() => {})` de `src/utils/session.ts:197` e a sessão falha sem mensagem.

Adicionar em `test/session.test.ts` o caso `extraUnsealPasswords: ["curta"]`, com a mensagem esperada.

**Aceite:** o caso novo passa, e o caso sem `extraUnsealPasswords` continua igual. Se D-06 for recusada, esta tarefa é removida e nada mais depende dela.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-11 — Documentação de rotação com `extraUnsealPasswords`

**Cobre:** RF-08

**Depende de:** T-07, T-09

- Em `docs/4.examples/handle-session.md` (`:37` e `:143`): aviso de que `password` é a única que sela, e nota sobre o procedimento de rotação com `extraUnsealPasswords` (adicionar a senha nova em `password`, mover a antiga para a lista, remover a entrada depois que as sessões expirarem, e a exigência de `maxAge` ou `idleTimeout`).
- Em `docs/2.utils/4.security.md` (`:68`): a seção de `useSession` é gerada pelo automd a partir do JSDoc. Regenerar com `pnpm fmt`, sem editar à mão.

**Aceite:** o texto de `docs/4.examples/handle-session.md` cita o campo e o procedimento. `pnpm fmt` não deixa diferença sem commit em `docs/2.utils/4.security.md` na seção de `useSession`.

**Arquivos:** `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`

---

### T-12 — Verificação final

**Cobre:** RF-01, RF-05, RF-08

**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11

Executar, nesta ordem:
1. `pnpm vitest run test/session.test.ts`
2. `pnpm vitest run test/unit/` (inclui `package.test.ts` e `types.test-d.ts`)
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm test` (suíte completa com cobertura)

Confirmar também que `test/unit/package.test.ts` não mudou, o que comprova que nenhum nome público novo foi exportado (RF-08).

**Aceite:** todos os comandos passam. Se algum falhar, a saída é reportada e a tarefa fica aberta.

**Arquivos:** nenhum (apenas execução de comandos)
