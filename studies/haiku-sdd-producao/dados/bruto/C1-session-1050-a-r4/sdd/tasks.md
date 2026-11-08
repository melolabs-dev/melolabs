# Tarefas de implementação — várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-09), `sdd/techspec.md` (D-01 a D-06), h3js/h3#1050.

Ordem geral, seguindo a regra do `AGENTS.md`: primeiro os testes de regressão (T-01 a T-03), vendo-os falhar; depois a implementação; por fim a verificação ampla. T-01 a T-04 podem ser feitas em paralelo.

### T-01 — Testes de sela, abertura e rejeição com lista de senhas

**Cobre:** RF-02, RF-03, RF-04, RF-09

**Depende de:** nenhuma

**Aceite:** casos em `describeMatrix` dentro de `test/session.test.ts`, usando `t.app` e `t.fetch`:
- sela com `[NEW, OLD]`: o cookie abre com `unseal(cookie, NEW)` e não abre com `unseal(cookie, OLD)`;
- cookie selado com `OLD` é lido com `[NEW, OLD]` e devolve dados e id;
- cookie selado com `OTHER` gera sessão nova (id diferente, sem dados), sem erro na resposta.
Antes de T-06 a T-08, os casos que dependem da lista devem falhar. Os casos com string continuam passando.

**Arquivos:** `test/session.test.ts`

### T-02 — Testes de validação da lista de senhas

**Cobre:** RF-05, RF-09

**Depende de:** nenhuma

**Aceite:** em `test/session.test.ts`, com `describeMatrix`:
- `password: []` faz `updateSession` lançar `Session password list is empty`. O handler captura o erro e devolve `{ message }`, porque o h3 mascara erros 500;
- `[NEW, "curta"]` lança a mensagem de senha curta existente em `getSession` e em `updateSession`, mesmo com cookie selado com `NEW`.
Antes de T-04, T-06 e T-08, os casos devem falhar.

**Arquivos:** `test/session.test.ts`

### T-03 — Testes de fallback legado e regravação com lista

**Cobre:** RF-07, RF-08, RF-09

**Depende de:** nenhuma

**Aceite:** em `test/session.test.ts`, espelhando `:134-186`:
- cookie com contagem 1 e senha `OLD`, lido com `[NEW, OLD]`: abre, regrava com `NEW`, e o novo cookie abre com `unseal(…, sealDefaults)` sem fallback;
- o mesmo cenário com `legacySealFallback: false` rejeita a sessão;
- cookie lido com `OLD` e depois `session.update(...)`: o `Set-Cookie` novo abre com `NEW` e não abre com `OLD`.
Antes de T-07 e T-08, os casos devem falhar.

**Arquivos:** `test/session.test.ts`

### T-04 — Extrair `assertPasswordLength` de `generateKey`

**Cobre:** RF-05

**Depende de:** nenhuma

**Aceite:** `assertPasswordLength(password, minLength)` exportado de `src/utils/internal/iron-crypto.ts`, com a mesma mensagem `Password string too short (min N characters required)`. `generateKey` passa a chamá-lo com `options.minPasswordlength`. Teste unitário em `test/unit/iron-crypto.test.ts` junto ao teste de `generateKey` (`:121-126`) cobre a função direta. `pnpm vitest run test/unit/iron-crypto.test.ts` passa, e o teste de `generateKey` continua verde sem alteração.

**Arquivos:** `src/utils/internal/iron-crypto.ts`, `test/unit/iron-crypto.test.ts`

### T-05 — Tipo `string | string[]` em `SessionConfig`

**Cobre:** RF-01, RF-06

**Depende de:** nenhuma

**Aceite:** `SessionConfig.password` em `src/utils/session.ts:48` tem tipo `string | string[]`, com JSDoc dizendo que o primeiro item sela e os demais só abrem sessões antigas. Nenhum símbolo público novo é exportado (`src/index.ts` não muda). Os testes existentes continuam compilando e passando. `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`

### T-06 — Helpers `getSealOptions` e `getPasswords` com validação

**Cobre:** RF-01, RF-05

**Depende de:** T-04, T-05

**Aceite:**
- `getSealOptions(config)` monta as opções efetivas de seal (defaults, `maxAge`/`idleTimeout` como ttl e overrides de `config.seal`);
- `getPasswords(config, sealOptions)` devolve `[senha]` sem validar quando `password` é string, preservando `Empty password` para `""`;
- para lista, lança `Session password list is empty` se vazia, e chama `assertPasswordLength` com `Math.max` dos dois `minPasswordlength` efetivos para cada item;
- `getSession` chama `getPasswords` logo após `sessionName`, antes de tocar em `context.sessions`.
Os casos de T-02 passam. Strings se comportam como antes.

**Arquivos:** `src/utils/session.ts`

### T-07 — `unsealWithPasswords` e `isBadHmac` no `unsealSession`

**Cobre:** RF-03, RF-04, RF-07

**Depende de:** T-01, T-03, T-06

**Aceite:**
- `unsealWithPasswords(sealed, passwords, sealOptions, legacyFallback)` segue a ordem de D-03: para cada senha, primeiro a contagem atual; só `Bad hmac value` avança, com o fallback de contagem 1 para a mesma senha antes de avançar; outros erros sobem direto;
- `isBadHmac(error)` identifica o erro de HMAC;
- `unsealSession` usa o helper, mantém `kLegacySeal` e as checagens de `maxAge` e `idleTimeout`;
- senha desconhecida continua gerando sessão nova sem erro para o cliente (RF-04).
Os casos de T-01 e T-03 passam.

**Arquivos:** `src/utils/session.ts`

### T-08 — Selar com a primeira senha

**Cobre:** RF-02, RF-08

**Depende de:** T-06, T-01, T-03

**Aceite:**
- `sealSession` usa `getPasswords(config, sealOptions)[0]` e `getSealOptions`, substituindo o inline de `:300-304`;
- `updateSession` e as reselagens existentes (legado e `idleTimeout`, `:214-216`) passam por `sealSession`, então regravam com a primeira senha sem código novo;
- os casos de T-01 (selo com `NEW`) e T-03 (regravação com `NEW`) passam.

**Arquivos:** `src/utils/session.ts`

### T-09 — Preservar o comportamento com uma senha

**Cobre:** RF-06

**Depende de:** T-07, T-08

**Aceite:** `pnpm vitest run test/session.test.ts` passa sem alterar nenhum caso existente. Em especial, `throttles idleTimeout reseals…` (`:410-474`) e `seals once when updateSession creates the session` (`:722-735`) continuam verdes, o que mostra que o número de derivações ao selar não mudou. Também é preciso confirmar que o `Set-Cookie` e a mensagem de erro de string única não mudam.

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts`

### T-10 — Teste de custo de derivação (documentação)

**Cobre:** RF-09

**Depende de:** T-07

**Aceite:** caso em `test/session.test.ts` que espiona `deriveBits` (como em `:723`) e lê um cookie selado com a segunda senha de `[NEW, OLD]`. Espera-se 3 derivações (uma HMAC com a primeira, uma HMAC e uma decriptação com a segunda). O valor serve como documentação do custo (R1 do techspec), não como contrato rígido. Registrar o número medido na descrição do PR. `pnpm bench:node` pode ser rodado para medir o custo com lista de 2 a 3 senhas, sem bloquear a entrega.

**Arquivos:** `test/session.test.ts`

### T-11 — Verificação final

**Cobre:** RF-09

**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10

**Aceite:** passam, sem falhas:
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/iron-crypto.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (lint, typecheck e cobertura completa)

Se algum comando falhar, o resultado com a saída deve ir para a descrição do PR.

**Arquivos:** nenhum arquivo de código; apenas execução dos comandos acima

## Itens fora das tarefas

Estes pontos são do PRD ou do techspec, mas não viram tarefa de código:
- **R4 (quebra de tipo):** sinalizar na descrição do PR e no changelog de release (`changelogen`).
- **R2 (senha antiga que nunca sai) e documentação extensa:** fora de escopo do PRD; ficam para um PR separado.
- **Pergunta em aberto 1 (limite de itens na lista):** a recomendação do techspec é não impor limite agora. Se o time quiser limite, vira uma tarefa nova.
