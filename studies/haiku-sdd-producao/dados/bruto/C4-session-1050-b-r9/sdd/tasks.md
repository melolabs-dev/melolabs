# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (decisões D-01 a D-07, seção 5 de testes).

Ordem: os testes novos (T-03 a T-05) são escritos antes da implementação (T-06 a T-08), conforme a seção 5 da spec. Baseline: `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa com 59 testes, e os 59 devem continuar passando sem mudança de asserção (RF-04).

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01

Depende de: nenhuma

Aceite: `pnpm typecheck` aceita `extraUnsealPasswords: ["senha-antiga"]` em `SessionConfig`, o campo é `string[]` opcional, `password` continua `string`, e `test/unit/package.test.ts` passa sem alteração (nenhum export novo).

Arquivos: `src/utils/session.ts`

### T-02 — Símbolo interno `kPreviousPasswordSeal`

Cobre: RF-07 (suporte à reselagem)

Depende de: nenhuma

Aceite: o símbolo `kPreviousPasswordSeal` existe em `src/utils/internal/session.ts` com `Symbol.for("h3.internal.session.previous-password-seal")`, ao lado de `kLegacySeal`, e não aparece em `src/index.ts` nem nos snapshots de exports.

Arquivos: `src/utils/internal/session.ts`

### T-03 — Testes de selagem e leitura com senhas extras

Cobre: RF-02, RF-03, RF-04

Depende de: T-01

Aceite: um `describe` novo em `test/session.test.ts` (depois do bloco de legado, `test/session.test.ts:186`), usando `describeMatrix`, com um `it` por critério: (a) `updateSession` com `password: "nova"` e extra `"antiga"` gera cookie que abre com `"nova"` e não abre com `"antiga"`; (b) cookie selado com `"antiga"` é lido por `getSession` com `id` e `data` originais; (c) duas extras, cookie selado com a segunda, abre; (d) cookie selado com a primeira extra abre mesmo com a segunda declarada. Antes da implementação, (b), (c) e (d) falham; (a) passa, por ser guarda de RF-02. A suíte existente não é alterada (RF-04): `extraUnsealPasswords: []` tem o mesmo comportamento de leitura e de cookie que a configuração sem o campo.

Arquivos: `test/session.test.ts`

### T-04 — Testes de falha, legado, expiração e header

Cobre: RF-05, RF-06, RF-08, RF-09

Depende de: T-01

Aceite: `it`s no mesmo `describe` de T-03 ou em bloco vizinho, um por critério: (a) cookie `"desconhecida"` com `password: "nova"` e extra `"antiga"` devolve sessão nova com `id` diferente, sem erro no handler (RF-05; passa já, é guarda); (b) cookie com `"antiga"` e legado de 1 iteração abre e é resselado com `"nova"` (RF-06, falha antes); (c) mesmo cookie com `legacySealFallback: false` é rejeitado (RF-06, passa já); (d) sessão com `"antiga"` e `createdAt` além de `maxAge` não é carregada, usando `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:188-229` (RF-08, falha antes ou passa, a ser confirmado); (e) mesmo com `lastSeenAt` vencido para `idleTimeout` (RF-08); (f) selo com `"antiga"` no header `x-h3-session` (nome por `sessionName`, como em `test/session.test.ts:336`) é carregado (RF-09, falha antes).

Arquivos: `test/session.test.ts`

### T-05 — Testes de migração e de `Set-Cookie` sem duplicação

Cobre: RF-07, RF-09

Depende de: T-01, T-03

Aceite: (a) cookie com `"antiga"`, lido com `getSession` numa requisição com o cookie, gera `Set-Cookie` que abre com `"nova"` e não abre com `"antiga"` (RF-07; falha antes); (b) a leitura do header com `"antiga"` não gera `Set-Cookie` de migração (RF-09; passa já, é guarda); (c) handler que lê e escreve (`session.update`) na mesma requisição, com cookie de senha extra, tem exatamente um `Set-Cookie` da sessão em `getSetCookie()` (R4; deve passar depois de T-08 e falhar se a reselagem for duplicada).

Arquivos: `test/session.test.ts`

### T-06 — Duas passadas de unseal em `unsealSession`

Cobre: RF-03, RF-04, RF-05, RF-06

Depende de: T-01, T-02, T-03, T-04

Aceite: `unsealSession` monta `[config.password, ...(config.extraUnsealPasswords ?? [])]` e usa o helper interno `openSeal` (D-01, D-02): passada 1 com as iterações atuais, em ordem; passada 2 com 1 iteração só se `legacySealFallback !== false`, `sealOptions.integrity.iterations !== 1` e algum erro da passada 1 for `"Bad hmac value"`; relança o primeiro erro da passada 1 quando nenhuma abre (D-05). Marca `kLegacySeal` quando veio da passada 2 e `kPreviousPasswordSeal` quando `index > 0`. Assinatura pública inalterada. Verificado por: os testes de T-03 e T-04 passam; os 59 da baseline passam sem mudança de asserção; nenhum erro novo chega ao handler.

Arquivos: `src/utils/session.ts`

### T-07 — Expiração depois da escolha da senha

Cobre: RF-08

Depende de: T-06

Aceite: `maxAge` e `idleTimeout` continuam em um único ponto depois do laço de `openSeal`, aplicados ao objeto desselado por qualquer senha (D-04), sem checar por candidato. Os casos (d) e (e) de T-04 passam, e os testes de `idleTimeout` já existentes passam sem alteração.

Arquivos: `src/utils/session.ts`

### T-08 — Reselagem e marcador em `getSession`

Cobre: RF-07, RF-09

Depende de: T-02, T-06

Aceite: `getSession` lê `kPreviousPasswordSeal` junto com `kLegacySeal`, remove os dois antes de `Object.assign(session, unsealed)`, e reseleja com `updateSession` quando `session.id && sessionFromCookie && (legacySeal || previousSeal || shouldSlide(...))` (techspec §4). O símbolo não aparece no objeto `session`. Sessões lidas pelo header (`sessionFromCookie` falso) não são resseladas. Os casos de T-05 (a) e (b) passam; os testes de T-03 e T-04 passam.

Arquivos: `src/utils/session.ts`

### T-09 — Documentação do campo no JSDoc

Cobre: RF-01 (documentação de P4, R1, R2, R5, R6, R7)

Depende de: T-01

Aceite: o JSDoc de `extraUnsealPasswords` tem o texto da techspec §4: ordem de tentativa, selagem só com `password`, mesma exigência de entropia (32 caracteres), remoção quando as sessões migrarem, custo de uma derivação por senha tentada. Também documenta que senhas extras não migram sessões lidas pelo header (R7) e que uma senha extra inválida falha em silêncio (R6). Não há edição manual em `docs/` nem em `CHANGELOG.md`; `pnpm fmt` regenera o bloco automd de `docs/2.utils/4.security.md` se houver diferença.

Arquivos: `src/utils/session.ts`, `docs/2.utils/4.security.md` (gerado por `pnpm fmt`, sem edição manual)

### T-10 — Verificação final

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09

Depende de: T-03, T-04, T-05, T-06, T-07, T-08, T-09

Aceite: `pnpm lint` passa; `pnpm typecheck` passa; `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa com os 59 da baseline mais os novos, sem alteração de asserção nos antigos; `pnpm test` completo passa (lint, typecheck e coverage); `test/unit/package.test.ts` não foi alterado.

Arquivos: nenhum (apenas comandos de verificação)
