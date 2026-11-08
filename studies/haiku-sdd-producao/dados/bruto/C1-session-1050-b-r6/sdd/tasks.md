# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Entradas: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (decisões D-01 a D-07).

Ordem: T-01, T-02 e T-03 são independentes e podem sair em paralelo. T-02 deve rodar contra o `master` antes de T-04, para provar que os casos novos falham sem a implementação (fluxo TDD do `AGENTS.md`). Depois seguem T-04, T-05 e, por último, T-06.

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01

Depende de: nenhuma

Aceite:
- `extraUnsealPasswords?: string[]` existe em `SessionConfig`, logo após `password`, com JSDoc em inglês no mesmo estilo dos demais campos. O JSDoc diz que as senhas são tentadas em ordem após `password`, nunca usadas para selar, e que cada uma custa uma derivação PBKDF2 por cookie inválido (texto da techspec, seção 4.1).
- `password` continua `string`. Nenhum outro export novo.
- `pnpm typecheck` passa com uma configuração que tem `password` e `extraUnsealPasswords: [...]`, e também com uma configuração sem o campo.

Arquivos: `src/utils/session.ts`

### T-02 — Casos de teste da senha extra (escritos antes da implementação)

Cobre: RF-02, RF-03, RF-04, RF-06, RF-07, RF-08

Depende de: nenhuma

Aceite:
- Em `test/session.test.ts`, dentro de `describeMatrix("session", ...)`, há um helper `sealWith(password, data, iterations?)` e casos para: selagem usa só `password` (RF-02); senha principal abre sem tentar extras (RF-03); senha extra abre e devolve os dados originais (RF-03); ordem das extras, com `["errada-…", "antiga-…"]` (RF-03); nenhuma senha abre, com `id` ausente e `data` vazio, sem erro não tratado (RF-04); `unsealSession` direto com cookie de outra senha rejeita com `"Bad hmac value"` (RF-04); cookie com 1 iteração e senha extra abre e recebe `kLegacySeal` (RF-06); cookie com senha extra gera exatamente um `Set-Cookie` que abre com `password` (RF-07); senha curta antes de uma válida não bloqueia a válida (D-02); senha extra com `maxAge` vencido resulta em sessão vazia (D-05); lista com senha repetida continua funcionando (premissa do PRD).
- Senhas de teste têm pelo menos 32 caracteres (ex.: `"nova-" + "x".repeat(43)`), porque senhas menores disparam `Password string too short`.
- Rodando `pnpm vitest run test/session.test.ts` no `master`, os casos que dependem de extras falham. Os casos de senha principal e de lista vazia passam, e a suíte existente passa sem mudança de asserção.
- Todos os casos novos estão em `describeMatrix`, então rodam em `web` e `node`.

Arquivos: `test/session.test.ts`

### T-03 — Símbolo interno `kRotatedSeal`

Cobre: RF-07

Depende de: nenhuma

Aceite:
- `src/utils/internal/session.ts` exporta `kRotatedSeal` como `unique symbol`, com `Symbol.for("h3.internal.session.rotated-seal")` e `/* @__PURE__ */`, ao lado de `kLegacySeal`.
- O símbolo não é reexportado por `src/index.ts`. `pnpm vitest run test/unit/package.test.ts` continua passando sem alterar o snapshot.

Arquivos: `src/utils/internal/session.ts`

### T-04 — Loop de desselagem com as senhas em ordem

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06

Depende de: T-01, T-02, T-03

Aceite:
- `unsealSession` tenta `[config.password, ...(config.extraUnsealPasswords || [])]` na ordem e para na primeira que abre. Usa uma flag `opened`, não truthiness, para tratar payload `null` como sucesso.
- Qualquer erro de uma tentativa passa para a próxima. Se nenhuma abrir, relança o erro da primeira tentativa (com `password`), preservando `"Bad hmac value"` (D-02).
- A lógica de fallback legado vai para o helper `unsealWithPassword`, no fim do arquivo, sem mudança de lógica. O fallback é tentado por senha, antes de passar para a próxima (D-03).
- As checagens de `maxAge` e `idleTimeout` ficam depois do loop, sobre o payload que abriu (D-05).
- Quando a senha aberta é uma extra (índice > 0), o objeto recebe `kRotatedSeal`. Quando é a principal, não recebe.
- `sealSession` não muda (RF-02).
- Os casos de T-02 que cobrem RF-02, RF-03, RF-04 e RF-06 passam. A suíte existente de sessões passa sem alteração de asserção (RF-05).
- `src/utils/internal/iron-crypto.ts` não é alterado.

Arquivos: `src/utils/session.ts`

### T-05 — Migração por reselagem em `getSession`

Cobre: RF-07

Depende de: T-03, T-04

Aceite:
- `getSession` lê `kRotatedSeal`, remove a marca antes do `Object.assign`, e reseala quando `sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(...))`, usando a mesma condição já existente para cookie legado (D-04).
- Com cookie selado por senha extra, a resposta traz um `Set-Cookie` novo que abre com `password`.
- Com sessão lida pelo header, nenhum `Set-Cookie` é emitido, e os dados são retornados (premissa do PRD, confirmada na techspec).
- `kRotatedSeal` não aparece em `event.context.session`.
- Os casos de migração e de header de T-02 passam.

Arquivos: `src/utils/session.ts`

### T-06 — Verificação final de qualidade

Cobre: RF-05, RF-08, RF-09

Depende de: T-04, T-05

Aceite:
- `pnpm vitest run test/session.test.ts` passa em `web` e `node`, com todos os casos de T-02.
- `pnpm vitest run test/unit/package.test.ts` passa sem alteração do snapshot.
- `pnpm lint` e `pnpm typecheck` terminam sem erro.
- `pnpm test` (suíte completa com cobertura) passa.
- `git diff` não mostra mudança em `src/utils/internal/iron-crypto.ts` nem em `src/index.ts`.
- Nenhum `@ts-ignore` novo no diff.

Arquivos: nenhum (somente verificação; a correção de qualquer falha volta para a tarefa que a causou)
