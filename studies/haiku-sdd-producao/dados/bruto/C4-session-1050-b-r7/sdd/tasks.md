# Tarefas de implementação: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-09), `sdd/techspec.md` (decisões D-01 a D-10, casos de teste, riscos R-01 a R-07).

Os IDs `T-NN` deste arquivo são tarefas. Os casos de teste da tabela da techspec mantêm o nome original (`T-01` a `T-11`) e são citados como "caso T-NN da techspec", para não confundir com as tarefas.

Ordem sugerida: escrever os testes primeiro e vê-los falhar (fluxo de bug fix do `AGENTS.md`), depois implementar em passos pequenos. Refatorações sem mudança de comportamento (T-03, T-04) vêm antes da mudança de lógica (T-05).

---

### T-01 — Escrever os casos de teste novos e vê-los falhar

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

Depende de: nenhuma

Aceite: em `test/session.test.ts`, dentro do `describeMatrix` e no novo `describe("extraUnsealPasswords", ...)`, existem os casos da techspec T-01 a T-08, T-10 e T-11 (rodam em `web` e `node`), e T-09 no mesmo `describe`. Usar `seal`, `sealDefaults` e `unseal` de `src/utils/internal/iron-crypto.ts`, e `vi.useFakeTimers({ toFake: ["Date"] })` para o tempo, como nos testes legados. Ao rodar `pnpm vitest run test/session.test.ts`, os casos novos falham pelo motivo esperado (sessão não aberta com a extra, ou ausência de validação), e os testes existentes continuam passando.

Arquivos: `test/session.test.ts`

---

### T-02 — Adicionar o campo `extraUnsealPasswords` a `SessionConfig`

Cobre: RF-01

Depende de: nenhuma

Aceite: `SessionConfig` tem `extraUnsealPasswords?: string[]` logo após `password`, com o JSDoc da techspec (D-10): são senhas só para abrir, a sessão aberta é regravada com `password`, a remoção é manual e a lista deve ser curta por causa do custo de PBKDF2. Uma configuração sem o campo compila em `pnpm typecheck`. Nenhum outro nome público novo é exportado (`src/index.ts` não muda).

Arquivos: `src/utils/session.ts`

---

### T-03 — Extrair `getSealOptions` sem mudar o valor das opções

Cobre: RF-06

Depende de: nenhuma

Aceite: `sealSession` e `unsealSession` usam `getSealOptions(config)` no lugar do objeto inline, com o mesmo valor de antes (D-09). Nenhuma assertion existente em `test/session.test.ts` foi alterada, e a suíte passa.

Arquivos: `src/utils/session.ts`

---

### T-04 — Extrair o bloco de abertura para `unsealWithFallback`, verbatim

Cobre: RF-06

Depende de: T-03

Aceite: o bloco `try/catch` atual de `unsealSession` (com o fallback legado de 1 iteração) vira `unsealWithFallback(sealed, password, config, sealOptions)`, sem mudança de lógica (R-05). `unsealSession` ainda usa só `config.password` nesta etapa. A suíte existente de sessões passa sem alterar asserções.

Arquivos: `src/utils/session.ts`

---

### T-05 — Abrir com a senha atual e depois com as extras, em ordem

Cobre: RF-02, RF-03, RF-05

Depende de: T-01, T-02, T-04

Aceite: `unsealWithAnyPassword` percorre `[config.password, ...extraUnsealPasswords]` e só continua ao receber `Bad hmac value`; qualquer outro erro é relançado (D-04). `unsealSession` chama esse loop, e a assinatura não muda. Passam os casos da techspec T-01 (senha atual continua válida), T-02 (sessão com extra é aberta), T-04 (senha desconhecida vira sessão nova, sem dados) e T-10 (caminho do header `x-h3-test-session`). Os casos de expiração e de regravação ficam para T-06 e T-07.

Arquivos: `src/utils/session.ts`

---

### T-06 — Garantir que a selagem usa só a senha atual

Cobre: RF-04, RF-08

Depende de: T-03, T-05

Aceite: `sealSession` e `updateSession` continuam selando só com `config.password` (D-09). O cookie gravado a partir de uma sessão aberta com extra abre com `"nova"` e não abre com `"antiga"` (caso T-03 da techspec). Após `update` ou deslizamento de `idleTimeout`, a extra deixa de ser necessária para aquela sessão (caso T-11 da techspec).

Arquivos: `src/utils/session.ts`

---

### T-07 — Manter a expiração válida com qualquer senha

Cobre: RF-07

Depende de: T-05

Aceite: `maxAge` e `idleTimeout` continuam verificados uma única vez, depois do loop, sobre o resultado da senha que abriu (D-04). Passam os casos da techspec T-06 (`createdAt` além de `maxAge`) e T-07 (`lastSeenAt` além de `idleTimeout`), com sessão selada por extra rejeitada como expirada.

Arquivos: `src/utils/session.ts`

---

### T-08 — Validar o tamanho das senhas extras em `getSession`

Cobre: RF-01 (o valor do campo precisa ser uma lista de senhas válidas)

Depende de: T-02, T-03

Aceite: `assertUnsealPasswords(config, sealOptions)` é chamada no início de `getSession`, antes de qualquer escrita em `context.sessions` e antes do `try` que engole erros (D-06, R-02). Uma extra com menos caracteres que `sealOptions.integrity.minPasswordlength` faz `getSession` lançar `Error` com mensagem que cita o tamanho, sem criar sessão (caso T-09 da techspec). A validação não se aplica a `password`, para não mudar RF-06.

Arquivos: `src/utils/session.ts`

---

### T-09 — Aplicar o fallback legado a cada senha, na mesma ordem

Cobre: RF-03

Depende de: T-05

Aceite: o loop de T-05 chama `unsealWithFallback` para cada senha, então o fallback de 1 iteração vale também para as extras (D-05, R-04). Passa o caso da techspec T-08: sessão legada (1 iteração) selada com extra é aberta e regravada com `password`. Com `legacySealFallback: false`, o fallback continua desligado para todas as senhas.

Arquivos: `src/utils/session.ts`

---

### T-10 — Documentar a rotação no guia de sessões

Cobre: RF-01

Depende de: T-02, T-05

Aceite: `docs/4.examples/handle-session.md` ganha um parágrafo depois da linha 143, no tom das notas existentes, com: como declarar `extraUnsealPasswords`, que a selagem usa só `password`, que a remoção é manual e marca o fim da janela (R-03), que cada extra custa uma derivação PBKDF2 por cookie desconhecido (R-01), e que trocar `seal.encryption.iterations` ou `seal.integrity.iterations` junto com a rotação torna as sessões antigas ilegíveis (D-08, R-06). `CHANGELOG.md` não é editado à mão (D-10).

Arquivos: `docs/4.examples/handle-session.md`

---

### T-11 — Verificação final e regressão

Cobre: RF-06, RF-09

Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10

Aceite: `pnpm vitest run test/session.test.ts` passa nos dois modos (`web` e `node`), com todos os casos T-01 a T-11 da techspec mais o teste de validação. `pnpm typecheck` e `pnpm lint` passam. `pnpm test` (lint, typecheck e cobertura) passa, e a suíte completa roda uma vez antes do PR. Opcional: `pnpm bench:node` com 0, 1 e 3 extras, para medir o custo do R-01 e decidir sobre o teto de extras (D-07, pendência da techspec).

Arquivos: nenhum arquivo de código. Esta tarefa só roda os comandos de verificação. Se algo falhar, a correção vai na tarefa responsável.
