# Tarefas — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-09, R1 a R5) e `sdd/techspec.md` (D-01 a D-09).

Ordem: primeiro os testes (T-01 a T-07), que devem falhar antes da implementação, como manda o `AGENTS.md`. Depois a implementação (T-08 a T-14) e a verificação final (T-15). Os testes sem extras (T-02) devem passar desde o início, porque são regressão.

## Testes

### T-01 — Testes de desselagem por senha extra (cookie e header)
Cobre: RF-03, RF-05
Depende de: nenhuma
Aceite: com `password` nova e `extraUnsealPasswords` contendo a antiga, uma sessão selada com a antiga abre pelo cookie `h3` e pelo header `x-h3-test-session`, mantendo `id`, `createdAt` e `data`. Uma sessão selada com senha fora das duas listas é descartada (nova sessão, status 200). Os testes rodam em `web` e `node` (`describeMatrix`) e falham antes da implementação.
Arquivos: `test/session.test.ts`

### T-02 — Testes de compatibilidade sem senhas extras
Cobre: RF-02, RF-04
Depende de: nenhuma
Aceite: com `extraUnsealPasswords` ausente, `[]`, a sessão selada com `password` abre e uma sessão selada com outra senha é descartada sem erro para o handler. Ao fim, `password` sela e o cookie não abre com a senha antiga. Estes testes passam já no código atual. As asserções da suíte existente não mudam.
Arquivos: `test/session.test.ts`

### T-03 — Testes de fallback legado por senha extra
Cobre: RF-06
Depende de: nenhuma
Aceite: uma sessão com 1 iteração PBKDF2 selada com a senha extra abre e é resselada. Com `legacySealFallback: false`, a mesma sessão é rejeitada. Usar `seal` com `iterations: 1`, como os testes de legado em `test/session.test.ts:134-186`. Falham antes da implementação.
Arquivos: `test/session.test.ts`

### T-04 — Testes de reselagem, contagem de `Set-Cookie` e header
Cobre: RF-02, RF-07, R4, R5
Depende de: nenhuma
Aceite: após abrir uma sessão por senha extra pelo cookie, a resposta traz um `Set-Cookie` selado com `password`. Uma requisição seguinte só com `password` abre a sessão. Com `legacySeal`, senha extra e `idleTimeout` valendo ao mesmo tempo, há exatamente um `Set-Cookie`. Com sessão vinda pelo header aberta por senha extra, nenhum `Set-Cookie` é emitido. Falham antes da implementação, exceto a parte de `password` selando, que já passa.
Arquivos: `test/session.test.ts`

### T-05 — Testes de expiração com senha extra
Cobre: RF-08
Depende de: nenhuma
Aceite: com `vi.useFakeTimers({ toFake: ["Date"] })`, uma sessão selada com senha extra que passou de `maxAge` é descartada, e outra que ficou mais de `idleTimeout` sem reselagem também é descartada. O comportamento deve ser igual ao de uma sessão selada com `password`. Falham antes da implementação.
Arquivos: `test/session.test.ts`

### T-06 — Testes de validação, de cookie inválido e de vazamento do símbolo
Cobre: RF-09, R1, D-02, D-04
Depende de: nenhuma
Aceite: (a) `extraUnsealPasswords` com string vazia ou curta faz `useSession` e `getSession` rejeitarem antes de ler o cookie; a mensagem contém `extraUnsealPasswords` e não contém o valor da senha. Itens não string e valor que não é array também rejeitam. (b) Cookie malformado ou expirado não tenta as senhas extras: há uma única chamada de derivação (espiar `crypto.subtle.deriveBits` ou contar chamadas). (c) `kStaleSeal` não aparece em `session` nem em `event.context.sessions` na resposta JSON. Falham antes da implementação, exceto (b), que vale também hoje.
Arquivos: `test/session.test.ts`

### T-07 — Teste de tipo do campo novo
Cobre: RF-01
Depende de: nenhuma
Aceite: `test/unit/types.test-d.ts` afirma que `extraUnsealPasswords` é `string[] | undefined` e que `password` continua `string`. Antes, conferir se o arquivo já cobre `SessionConfig`. `pnpm typecheck` passa, e o teste de tipo falha antes da mudança.
Arquivos: `test/unit/types.test-d.ts`

## Implementação

### T-08 — Campo `extraUnsealPasswords` em `SessionConfig`
Cobre: RF-01
Depende de: T-07
Aceite: `SessionConfig` tem `extraUnsealPasswords?: string[]` com JSDoc que diz que a senha só abre, que a lista deve ser curta e que a entrada sai após a rotação. Nenhum outro nome público novo é exportado. O teste de tipo (T-07) passa.
Arquivos: `src/utils/session.ts`

### T-09 — Símbolo interno `kStaleSeal`
Cobre: RF-07
Depende de: nenhuma
Aceite: `kStaleSeal` existe em `src/utils/internal/session.ts` com `Symbol.for("h3.internal.session.stale-seal")`, no mesmo formato de `kLegacySeal`. Não é exportado por `src/index.ts`.
Arquivos: `src/utils/internal/session.ts`

### T-10 — Helpers `candidatePasswords` e `assertExtraUnsealPasswords`
Cobre: RF-09
Depende de: T-08, T-06
Aceite: `candidatePasswords` devolve `[password, ...extras]` sem repetidas, na mesma ordem. `assertExtraUnsealPasswords` aceita ausente e `[]`; lança `Error` quando não é array, quando um item não é string, ou quando um item é vazio ou menor que o maior `minPasswordlength` entre `config.seal?.encryption` e `config.seal?.integrity` (com os padrões de `sealDefaults`). A mensagem cita `extraUnsealPasswords[i]` e o mínimo, nunca o valor. Os helpers não são exportados.
Arquivos: `src/utils/session.ts`

### T-11 — Validação no início de `getSession`
Cobre: RF-09
Depende de: T-10
Aceite: `getSession` chama `assertExtraUnsealPasswords(config)` antes de `getEventContext` e antes de gravar `context.sessions`, de modo que um erro não deixa sessão vazia no contexto. O teste (a) de T-06 passa. Como `useSession` chama `getSession`, a validação cobre os dois.
Arquivos: `src/utils/session.ts`

### T-12 — Desselagem com as candidatas em ordem
Cobre: RF-03, RF-05, RF-06, RF-08
Depende de: T-01, T-03, T-05, T-09, T-10
Aceite: `unsealSession` chama `assertExtraUnsealPasswords` e itera `candidatePasswords` com `unsealWith(p)`, que contém o corpo atual de `unsealSession` com o retry legado. Só `"Bad hmac value"` avança para a próxima senha; outros erros são relançados na hora. Se nenhuma senha abrir, relança o erro da primeira tentativa. Quando a vencedora tem índice maior que 0, marca `kStaleSeal`. `maxAge` e `idleTimeout` continuam aplicados depois da escolha. Os testes de T-01, T-03 e T-05 passam, e os de T-02 continuam passando. O helper de "Bad hmac value" é extraído e usado também em `unsealWith`.
Arquivos: `src/utils/session.ts`

### T-13 — Reselagem quando a sessão foi aberta por senha extra
Cobre: RF-02, RF-07
Depende de: T-02, T-04, T-09, T-12
Aceite: a condição de reselagem em `getSession` passa a ser `sessionFromCookie && session.id && (legacySeal || staleSeal || shouldSlide(...))`. `kStaleSeal` é lido e apagado junto de `kLegacySeal` antes do `Object.assign`. Há exatamente um `Set-Cookie` por requisição quando as condições coincidem, e nenhum para sessão de header. Os testes de T-04 passam.
Arquivos: `src/utils/session.ts`

### T-14 — Documentação da opção e do procedimento de rotação
Cobre: RF-01
Depende de: T-12, T-13
Aceite: a seção "Options" de `docs/4.examples/handle-session.md` descreve `extraUnsealPasswords` e traz os três passos de rotação (senha nova em `password`, esperar `maxAge` ou `idleTimeout`, remover a antiga). A nota avisa sobre R2 (custo de CPU por cookie inválido) e R3 (senha antiga ainda válida).
Arquivos: `docs/4.examples/handle-session.md`

## Verificação

### T-15 — Verificação final e regressão
Cobre: RF-02, RF-04
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12, T-13, T-14
Aceite: `pnpm vitest run test/session.test.ts` passa em `web` e `node`. `pnpm test` (lint, typecheck e cobertura) passa. A suíte existente passa sem alteração de asserções; se algum teste precisar de ajuste, o ajuste preserva o que ele verifica e fica registrado na descrição da entrega. Se `src/utils/session.ts` continuar acima de 200 linhas (convenção do `AGENTS.md`, seção 8 da techspec), mover os helpers novos para `src/utils/internal/session.ts`.
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts`, `src/utils/session.ts`, `src/utils/internal/session.ts`, `docs/4.examples/handle-session.md`

---

Cobertura dos requisitos: RF-01 (T-07, T-08, T-14) · RF-02 (T-02, T-04, T-13, T-15) · RF-03 (T-01, T-12) · RF-04 (T-02, T-15) · RF-05 (T-01, T-12) · RF-06 (T-03, T-12) · RF-07 (T-04, T-09, T-13) · RF-08 (T-05, T-12) · RF-09 (T-06, T-10, T-11).
