# Tarefas — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Fluxo do `AGENTS.md`: testes primeiro (devem falhar), depois implementação, depois suíte completa. Testes de integração usam `describeMatrix` e senhas de 32+ caracteres (P0, P1, P2 distintas).

### T-01 — Escrever testes de integração da rotação de senhas

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`
Depende de: nenhuma
Aceite: os casos 1 a 9 da seção 5 do techspec existem (equivalência sem campo e com `[]`; selagem só com `password`; abertura com P2, P1 e P0; senha desconhecida gera sessão nova e vazia; re-selagem só para cookie com senha extra, sem `Set-Cookie` para `password` ou cabeçalho; validação de extras inválidas em qualquer posição; matriz de cinco funções x cookie simples, chunks e cabeçalho; legado com extra; expiração). Antes das tarefas T-03 a T-06, `pnpm vitest run test/session.test.ts` mostra os casos novos falhando e os testes antigos passando.

### T-02 — Escrever testes de contagem de tentativas e de tipos

Cobre: RF-01, RF-03
Arquivos: `test/session-rotation.test.ts`, `test/unit/types.test-d.ts`
Depende de: nenhuma
Aceite: com `vi.mock` de `unseal`, sessão de P2 chama `unseal` só com P2; sessão de P1 nunca tenta P0; senha desconhecida tenta cada candidata uma vez; sem extras as chamadas são idênticas às atuais. O teste de tipos confirma `password: string` e que `extraUnsealPasswords` aceita `string[]` e `readonly string[]` e rejeita `string`. Os testes falham antes de T-03 a T-05 e passam depois.

### T-03 — Adicionar o campo `extraUnsealPasswords` e os helpers internos

Cobre: RF-01
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`
Depende de: nenhuma
Aceite: `SessionConfig` tem `extraUnsealPasswords?: readonly string[]` logo após `password`, com JSDoc (só abre, nunca sela; ordem importa; lista curta por custo de PBKDF2; remover entrada invalida sessões; validação ocorre ao selar). `internal/session.ts` exporta `kExtraPassword` (`Symbol.for("h3.internal.session.extra-password")`) e `isValidSealPassword`; nada novo em `src/index.ts`. `pnpm typecheck` passa e o tipo de `password` segue `string`.

### T-04 — Abrir sessões com `password` e senhas extras em `unsealSession`

Cobre: RF-03, RF-04, RF-07, RF-08
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: o bloco de unseal com fallback legado vira o helper `unsealWithPassword`; `unsealSession` percorre `[password, ...extras válidas]` em sequência (para cada senha, modo atual e depois legado), avançando só em "Bad hmac value", parando na primeira que abrir e relançando o primeiro erro se todas falharem; extras inválidas são puladas na leitura; `kExtraPassword` é marcado quando abre com índice > 0; checagens de `maxAge` e `idleTimeout` seguem depois do laço. `legacySealFallback: false` continua desligando o legado. Sem extras, a sequência de chamadas a `unseal` é a atual. Os testes de T-01 (casos 3, 4, 7, 8, 9) e T-02 (contagem) passam e os testes legados existentes passam sem alteração.

### T-05 — Re-selar em `getSession` quando abriu com senha extra

Cobre: RF-05, RF-08
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: `getSession` lê e apaga `kExtraPassword` junto com `kLegacySeal` antes do `Object.assign`, e re-sela com `legacySeal || extraPassword || shouldSlide(...)` apenas quando a sessão veio do cookie; o comentário correspondente é atualizado. Cookie com senha extra gera um único `Set-Cookie` com sessão que abre com `password`; cookie selado por `password` e sessão do cabeçalho não geram `Set-Cookie`; a sessão viva não contém o símbolo; com `idleTimeout` há um só `Set-Cookie`. O caso 5 e o caso 8 de T-01 passam.

### T-06 — Validar senhas extras ao selar em `sealSession`

Cobre: RF-02, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: `sealSession` monta `sealOptions` uma vez, chama `assertExtraUnsealPasswords` antes de `seal(...)` e continua selando só com `config.password`. Senha extra não string, vazia ou menor que o mínimo efetivo (maior `minPasswordlength` entre encryption e integrity) em qualquer posição, inclusive a última, rejeita `useSession` (sem cookie), `updateSession` e `sealSession` com mensagem "Invalid session password in extraUnsealPasswords[i]: ..." casando `/password/i`. `password` inválida segue falhando como hoje. Leitura com extra inválida não falha. Os casos 2 e 6 de T-01 passam.

### T-07 — Documentar o campo e o procedimento de rotação

Cobre: RF-01, RF-02, RF-03, RF-05, RF-06
Arquivos: `docs/4.examples/handle-session.md`, `docs/2.utils/4.security.md`
Depende de: T-05, T-06
Aceite: `handle-session.md` descreve `extraUnsealPasswords` e o passo a passo da rotação (nova `password`, antiga em `extraUnsealPasswords`, re-selagem progressiva, remoção posterior), com o aviso de lista curta e de validação ao selar. `security.md` indica que extras só abrem; se o arquivo for gerado por automd, a edição é feita no JSDoc de origem e `pnpm fmt` é rodado. Sem mudança de código.

### T-08 — Verificação final de regressão

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: nenhum
Depende de: T-01, T-02, T-04, T-05, T-06, T-07
Aceite: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam sem falhas; a suíte existente segue verde sem edições nos testes antigos; `git diff` mostra alterações apenas nos arquivos listados nas tarefas.
