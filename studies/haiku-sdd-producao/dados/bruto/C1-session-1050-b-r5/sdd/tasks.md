# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-06). Ordem sugerida pela ordem TDD da techspec: testes primeiro, depois implementação.

Comandos de verificação usados nos aceites:
- `pnpm vitest run test/session.test.ts`
- `pnpm vitest run test/unit/iron-crypto.test.ts`
- `pnpm lint` e `pnpm typecheck`
- `pnpm test` (lint, typecheck e cobertura completa)

---

### T-01 — Escrever os testes de rotação antes da implementação

Criar um `describe` novo em `test/session.test.ts`, depois do bloco `lazy creation` (por volta da linha 692), usando `describeMatrix`. Cobrir os casos T-01 a T-07 e T-09 da techspec. Usar `seal` de `src/utils/internal/iron-crypto.ts` para selar com a senha antiga, como em `test/session.test.ts:134-143`. Os testes de validação (T-08) entram na T-03 e os de sliding (opcional) na T-08.

Os testes devem falhar por falta de suporte, não por erro de digitação. Registrar a saída da primeira execução.

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` roda o novo `describe` e os casos de rotação falham com erro de funcionalidade ausente (por exemplo, sessão nova no lugar da sessão lida). Nenhum teste existente falha nesta etapa.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Adicionar o campo `extraUnsealPasswords` em `SessionConfig`

Inserir `extraUnsealPasswords?: string[]` logo depois de `password` em `SessionConfig` (`src/utils/session.ts:48`). Escrever o JSDoc em inglês, como o resto do arquivo, dizendo que:
- a lista só abre sessões e nunca sela;
- as senhas são tentadas na ordem, depois de `password`;
- cada item custa uma derivação PBKDF2 por tentativa, por isso a lista deve ser curta;
- remover uma senha antiga invalida as sessões seladas com ela;
- quem tem um cookie selado com uma senha extra pode usá-lo até expirar.

Não criar exportação nova. `password` continua `string`.

**Cobre:** RF-01
**Depende de:** nenhuma
**Aceite:** uma configuração com `password` e `extraUnsealPasswords: ["senha-antiga"]` passa no `pnpm typecheck`, e uma configuração sem o campo continua válida. `pnpm lint` passa.

**Arquivos:** `src/utils/session.ts`

---

### T-03 — Validar as senhas extras antecipadamente

Criar o helper interno `assertExtraUnsealPasswords(config)` no fim de `src/utils/session.ts`. Ele lança `Error("Empty password")` para item vazio e `Error("Password string too short (min N characters required)")` para item curto, com `N = max(encryption.minPasswordlength, integrity.minPasswordlength)` das opções efetivas (padrão 32). Sem extras, não faz nada.

Chamar o helper:
- em `getSession`, logo após `const sessionName` e antes de `context.sessions` e do `.catch`, para o erro não ser engolido;
- no início de `sealSession`;
- no início de `unsealSession`.

**Cobre:** RF-05
**Depende de:** T-02
**Aceite:** com `extraUnsealPasswords: [""]`, `useSession` rejeita com `Empty password`; com `["curta"]`, rejeita com `too short`. `sealSession` e `unsealSession` também lançam. Nenhuma sessão nova é gerada em silêncio. Os testes de validação (T-08 da techspec) passam.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-04 — Abrir a sessão com a lista de senhas

Criar os helpers internos `isBadHmac(error)` e `unsealWithPasswords(sealed, passwords, options)` no fim de `src/utils/session.ts`.
- `unsealWithPasswords` tenta cada senha na ordem e avança só em `"Bad hmac value"`. Qualquer outro erro é relançado na hora. Se nenhuma abrir, relança o último `"Bad hmac value"`.
- `isBadHmac` compara a mensagem do erro (hoje feito em `src/utils/session.ts:336`).

Em `unsealSession`, trocar `unseal(sealed, config.password, ...)` (`:324`) por `unsealWithPasswords` com `[config.password, ...(config.extraUnsealPasswords || [])]`. Manter as checagens de `maxAge` e `idleTimeout` (`:349-365`) como estão, para que RF-06 valha para qualquer senha.

Sem extras, a ordem de tentativas e o erro final devem ser idênticos aos de hoje.

**Cobre:** RF-02, RF-04, RF-06
**Depende de:** T-02
**Aceite:** T-01 casos de leitura passam: sessão selada com `A` abre com `password: B` e `extraUnsealPasswords: [A]`; `[X, A]` abre sessão selada com `A` (T-03 da techspec); cookie de senha errada sem extras gera `deriveBits` 2 vezes (T-04); erro `Expired seal` não percorre as senhas (T-05, 0 chamadas); `maxAge` vencido com extra lança `Session expired!` (T-06). `pnpm vitest run test/session.test.ts` passa nos casos existentes.

**Arquivos:** `src/utils/session.ts`

---

### T-05 — Selar sempre com `password`

Confirmar que `sealSession` continua usando só `config.password` no `seal` (`src/utils/session.ts:300-304`). Sem mudança de lógica além da validação da T-03. Garantir que `updateSession` também sela com `password`.

**Cobre:** RF-03
**Depende de:** T-03, T-04
**Aceite:** com `password: B` e `extraUnsealPasswords: [A]`, o cookie gerado por `updateSession` abre com `unseal(cookie, B)` e `unseal(cookie, A)` rejeita com `Bad hmac value` (T-02 da techspec).

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-06 — Fallback de selo legado em duas passadas

Ajustar o bloco do legado em `unsealSession` (`src/utils/session.ts:332-344`). A nova ordem é:
1. tentar **todas** as senhas com as iterações atuais;
2. só se nenhuma abrir e `legacySealFallback` não for `false`, tentar **todas** as senhas com 1 iteração;
3. quando abrir no legado, marcar `kLegacySeal` como hoje.

Não tentar o legado para `"Expired seal"` nem para outros erros que não sejam `"Bad hmac value"`.

**Cobre:** RF-07
**Depende de:** T-04
**Aceite:** com `N` extras e fallback ativo, cookie inválido gera `2 × (1 + N)` chamadas de `deriveBits` (T-04 da techspec). Sessão legada selada com `A` e 1 iteração abre com `password: B` e `extraUnsealPasswords: [A]`, sinaliza o selo legado e o novo cookie abre com `B` (T-07). Testes existentes de legado (`test/session.test.ts:134-186`) continuam passando sem ajuste.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-07 — Verificação de regressão e de qualidade

Rodar a suíte completa e confirmar que nada existente quebrou. Se algum teste existente quebrar, explicar a causa no relatório e não contornar o teste. Conferir que `test/unit/package.test.ts` não precisa de ajuste, porque nenhuma exportação nova foi criada.

**Cobre:** RF-04
**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06
**Aceite:** `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/iron-crypto.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam. O diff de `src/utils/internal/iron-crypto.ts` é vazio.

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts`

---

### T-08 — Regravação com senha extra (opcional, decisão pendente)

Só executar se o responsável aprovar a alternativa D-05 da techspec. Sem essa aprovação, pular esta tarefa e manter o comportamento de que sessões abertas com extra só são regravadas por legado, por `shouldSlide` ou por escrita.

Se aprovada: `unsealSession` sinaliza a abertura com senha extra, como faz com `kLegacySeal`, e `getSession` regrava a sessão com `password` nesse caso. Adicionar o teste T-09 da techspec: sessão aberta com `A` e `idleTimeout` com mais da metade da janela usada gera cookie selado com `B`.

**Cobre:** RF-03
**Depende de:** T-04, T-05
**Aceite:** se executada, o teste de sliding com extra passa e o cookie da resposta abre com `B`. Se não executada, a tarefa é marcada como pulada no relatório.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

## Pendências fora das tarefas

- Decidir sobre D-05 (regravação ao abrir com senha extra). Define se a T-08 entra.
- Documentação fora do JSDoc (`docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`) fica fora desta entrega, como pede o PRD. Confirmar se é para incluir um trecho sobre rotação.
