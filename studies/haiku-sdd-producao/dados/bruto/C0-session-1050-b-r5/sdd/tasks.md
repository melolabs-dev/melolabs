# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md`. Seguem o fluxo de correção de bug do AGENTS.md: testes primeiro (T-01), confirmar que falham, depois implementar (T-02 a T-04).

### T-01 — Escrever os testes de regressão (devem falhar antes da implementação)

Em `test/session.test.ts`, dentro de `describeMatrix`, reutilizando `sessionConfig`, `seal`/`sealDefaults` e o relógio falso dos testes legados. Usar senhas A, B e C distintas, com 32 caracteres ou mais. Cenários:

- Cookie selado com A, configuração `password: B, extraUnsealPasswords: [A]`: `getSession` e `useSession` devolvem `id` e `data` originais.
- O mesmo cenário via header `x-h3-test-session`.
- Ordem das extras (`[X, A]` abre) e `password` correto abrindo sem `Set-Cookie`.
- `updateSession` com `password: B, extra: [A]`: o cookie abre com `{password: B}` e não abre com `{password: A}`.
- Cookie de A gera `Set-Cookie` selado com B. Cookie de B não gera `Set-Cookie`. Header de A é aceito sem `Set-Cookie`.
- Com `idleTimeout` e janela maior que a metade, a resposta traz um único `Set-Cookie`.
- Senha C fora da lista: `id` novo e `data` vazio. `unsealSession` direto falha com `Bad hmac value`.
- Sessão de A com `createdAt` além de `maxAge` e `extra: [A]` é substituída.
- Sessão legada (1 iteração) selada com A e `extra: [A]` é aceita e regravada com B no formato atual. Com `legacySealFallback: false` é rejeitada.
- `extra` ausente e `extra: []` reproduzem o resultado dos testes legados (parametrizar o teste de senha errada).
- `extra: [""]` não derruba a requisição e a senha vazia é pulada.
- O marcador simbólico interno não vaza para a sessão nem para a resposta JSON.

Opcional: asserção `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>()` em `test/unit/types.test-d.ts`.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts` (opcional)
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes novos de extras falhando (sem a implementação) e os testes existentes passando. Os testes de `extra` ausente e `[]` já passam.

### T-02 — Adicionar o campo `extraUnsealPasswords` e o símbolo interno

- Em `SessionConfig` (`src/utils/session.ts`), logo após `password`, adicionar `extraUnsealPasswords?: string[]` com TSDoc. O TSDoc deve dizer que o campo só abre sessões e nunca sela, que vale a mesma entropia e o mesmo mínimo de 32 caracteres de `password`, que as senhas são tentadas em ordem depois de `password`, que a lista deve ser curta (cada extra custa um PBKDF2 por cookie inválido), que senhas comprometidas devem ser removidas e que sessões de header não migram.
- Em `src/utils/internal/session.ts`, criar o símbolo interno `kExtraPasswordSeal` (`Symbol.for("h3.internal.session.extra-password")`), ao lado de `kLegacySeal`.
- Não exportar nada novo em `src/index.ts`.

Cobre: RF-01
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`
Depende de: T-01
Aceite: `pnpm typecheck` passa. Configurações com e sem `extraUnsealPasswords` compilam em `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession`. `src/index.ts` não muda.

### T-03 — `unsealSession` tenta `password` e depois as extras

- Extrair para o fim de `src/utils/session.ts` o helper interno `unsealWithPassword(sealed, password, sealOptions, config)`. Ele contém a lógica atual de unseal e fallback legado, movida sem alteração, e marca `kLegacySeal`.
- Extrair `isBadHmac(error)` e reutilizá-lo no fallback legado.
- Em `unsealSession`, tentar `config.password` primeiro. Só se o erro for `Bad hmac value` (depois do retry legado) e houver extras, percorrer `extraUnsealPasswords` em ordem. A ordem é por senha, com o fallback legado dentro de cada senha.
- Erros nas tentativas extras são ignorados e passam para a próxima senha. Quando uma extra abre, marcar o resultado com `kExtraPasswordSeal`.
- Se todas falharem, relançar o erro da tentativa com `password`.
- Manter inalteradas as validações de `maxAge` e `idleTimeout` depois do laço.
- `sealSession`, `updateSession` e `clearSession` não mudam. Selam só com `password`.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-02
Aceite: `pnpm vitest run test/session.test.ts` passa nos testes de abertura por extra (cookie e header), ordem, senha desconhecida, `unsealSession` direto com `Bad hmac value`, `maxAge` com extra, sessão legada com extra, `legacySealFallback: false`, `extra: [""]`, e nos testes de selagem só com `password`. Os testes legados existentes continuam verdes sem alteração.

### T-04 — `getSession` regrava a sessão aberta por senha extra

- Importar `kExtraPasswordSeal` em `src/utils/session.ts`.
- Em `getSession`, ler e remover `kExtraPasswordSeal` do objeto desselado antes do `Object.assign`, como já é feito com `kLegacySeal`.
- Estender a condição de regravação para `session.id && sessionFromCookie && (legacySeal || extraPassword || shouldSlide(session, config))`, mantendo uma única chamada a `updateSession`.
- Sessões de header não regravam. Sessões abertas por `password` não ganham regravação extra.

Cobre: RF-04, RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: `pnpm vitest run test/session.test.ts` passa nos testes de `Set-Cookie`. Cookie de A gera `Set-Cookie` que abre com `{password: B}`. Cookie de B e header de A não geram `Set-Cookie`. Com `idleTimeout` há um único `Set-Cookie`. A sessão legada com extra é regravada no formato atual. O marcador não vaza para `session`.

### T-05 — Documentar a rotação de senha

Em `docs/4.examples/handle-session.md`, entre `## Expiration` e `## Use Multiple Sessions`, adicionar a seção curta `## Password Rotation`. Ela deve:

- Mostrar o uso de `password` mais `extraUnsealPasswords`.
- Explicar que a lista só abre sessões e `password` sela.
- Explicar a migração automática dos cookies.
- Orientar a manter a lista curta, com as senhas mais recentes primeiro.
- Orientar a remover as senhas extras depois do `maxAge` e a remover imediatamente as comprometidas.
- Avisar que sessões de header não migram.
- Avisar sobre o custo de CPU.

Cobre: RF-08
Arquivos: `docs/4.examples/handle-session.md`
Depende de: T-02
Aceite: a seção existe em inglês, no mesmo estilo da doc, e `pnpm lint` passa (formatação `oxfmt`).

### T-06 — Verificação final de regressão

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run`, `pnpm lint` e `pnpm typecheck`. Ajustar apenas o que for estritamente necessário se algum teste existente quebrar, sem perder o que ele verifica. Conferir que `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `sealSession`, `updateSession` e `clearSession` não foram alterados.

Cobre: RF-01, RF-07, RF-08
Arquivos: nenhum (verificação), `test/session.test.ts` apenas se um ajuste for inevitável
Depende de: T-01, T-02, T-03, T-04, T-05
Aceite: todos os comandos acima terminam sem erro, e os testes novos que falhavam em T-01 agora passam.
