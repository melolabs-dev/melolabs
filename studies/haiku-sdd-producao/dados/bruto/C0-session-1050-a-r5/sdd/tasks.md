# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Nenhuma tarefa altera `src/index.ts`, `iron-crypto.ts` ou o formato do cookie. Os comandos de verificação seguem o AGENTS.md (`pnpm vitest run <path>`, `pnpm lint`, `pnpm typecheck`).

### T-01 — Alargar o tipo e documentar `SessionConfig.password`

Trocar `password: string` por `password: string | string[]` (D-01) e reescrever o JSDoc: a primeira senha sela, todas abrem, a lista não é vazia, cada senha tem no mínimo 32 caracteres, deve ser curta (custo de PBKDF2) e transitória (janela de exposição), e quem rotaciona retira as senhas antigas.

Cobre: RF-01, RF-09
Arquivos: `src/utils/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` aponta apenas os usos de `sessionConfig.password` em `test/session.test.ts` que serão ajustados em T-02. O JSDoc descreve o novo formato e os avisos de custo e exposição.

### T-02 — Ajustar os testes existentes ao novo tipo

Extrair `const password = "1234567123456712345671234567123456712345671234567"` no topo do `describeMatrix` e usá-la em `sessionConfig` e nas três chamadas a `seal`/`unseal` do `iron-crypto` (`:137`, `:157`, `:164`), que só aceitam `RawPassword`. Os demais usos ficam como estão.

Cobre: RF-02, RF-09
Arquivos: `test/session.test.ts`
Depende de: T-01
Aceite: `pnpm typecheck` passa e `pnpm vitest run test/session.test.ts` passa com as mesmas verificações de antes. Nenhum `expect` foi removido nem enfraquecido.

### T-03 — Escrever os testes novos antes da implementação

No `describeMatrix`, com constantes `OLD`, `NEW` e `OTHER` de pelo menos 32 caracteres e relógio via `vi.useFakeTimers({ toFake: ["Date"] })`:
- lista de um elemento lê sessão criada com `string` (mesmos `id` e `data`);
- com `[NEW, OLD]`, criar e atualizar produz cookie que só abre com `NEW` (`OLD` lança `Bad hmac value`);
- cookie selado com `OLD` e `[NEW, OLD]` devolve o mesmo `id` e `data`, sem chamar `generateId`;
- senha na 3ª posição abre;
- cookie selado com `OTHER` gera sessão nova (`id` diferente, `data` vazio);
- `[]` e `["boa…", "curta"]` (curta em segundo lugar) fazem `sealSession` e `unsealSession` rejeitarem com `Empty password` / `Password string too short`, e `getSession` devolve sessão nova;
- cookie selado com `OLD` e expirado por `maxAge`, e por `idleTimeout`, é rejeitado; dentro do prazo é aceito;
- cookie legado (1 iteração) selado com `OLD` abre com `[NEW, OLD]` e é regravado de modo que só `NEW` o abre;
- chamadas concorrentes de `getSession`/`useSession` com cookie de `OLD` devolvem o mesmo `id` e `data`;
- cookie expirado selado com `NEW` e lista `[NEW, OLD]` é rejeitado por `Session expired!`, sem tentar `OLD`.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09
Arquivos: `test/session.test.ts`
Depende de: T-02
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes de rotação, senha desconhecida, lista inválida e expiração falhando antes da implementação (T-04 a T-06), e o teste de lista de um elemento já passando ou falhando pelo motivo esperado. Os testes antigos continuam passando.

### T-04 — Helper interno `resolvePasswords` com validação antecipada

Adicionar, no fim do arquivo e sem exportar, `resolvePasswords(config, options): string[]`. Para `string` devolve `[config.password]`, deixando a validação a cargo de `generateKey` (comportamento idêntico). Para lista, lança `Empty password` se estiver vazia ou se algum elemento não for `string` ou for vazio, e `Password string too short (min N characters required)` quando alguma senha tiver menos que o maior `minPasswordlength` entre `options.encryption` e `options.integrity`. Todas as senhas são validadas antes de qualquer uso.

Cobre: RF-06
Arquivos: `src/utils/session.ts`
Depende de: T-03
Aceite: o teste de lista inválida de T-03 passa para `sealSession`; `pnpm lint` e `pnpm typecheck` passam. O helper não está em `src/index.ts`.

### T-05 — `sealSession` sela somente com a primeira senha

Extrair as opções (`{ ...sealDefaults, ttl, ...config.seal }`) para uma constante local e selar com `resolvePasswords(config, opts)[0]`. Criação, atualização e reseal de `getSession` passam por `sealSession` e ficam cobertos sem alteração.

Cobre: RF-03, RF-02
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: o teste de selagem com `[NEW, OLD]` passa (cookie abre com `NEW`, `OLD` lança `Bad hmac value`), e os testes de `string` e de lista de um elemento continuam passando.

### T-06 — `unsealSession` tenta as senhas em ordem

Criar o helper interno `unsealWith(sealed, password, config, options)` com o bloco atual (tentativa normal e depois fallback legado de 1 iteração, marcando `kLegacySeal`). Em `unsealSession`, obter as senhas via `resolvePasswords` e percorrê-las em ordem, parando na primeira que abrir. Só `Bad hmac value` avança para a próxima senha. Qualquer outro erro é relançado de imediato, e esgotada a lista lança-se o último `Bad hmac value`. As verificações de `maxAge` e `idleTimeout` rodam uma única vez, fora do laço, depois de obtido o `unsealed`. `getSession` não muda.

Cobre: RF-04, RF-05, RF-07, RF-02
Arquivos: `src/utils/session.ts`
Depende de: T-05
Aceite: `pnpm vitest run test/session.test.ts` passa por inteiro, incluindo rotação, 3ª posição, senha fora da lista, expiração (`maxAge`, `idleTimeout`, legado) com senha secundária, expirado não reaceito por outra senha e concorrência. Os testes antigos continuam passando.

### T-07 — Teste de tipo para `SessionConfig["password"]`

Adicionar ao fim de `test/unit/types.test-d.ts` a verificação `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`, importando `SessionConfig` conforme o estilo do arquivo.

Cobre: RF-01, RF-09
Arquivos: `test/unit/types.test-d.ts`
Depende de: T-01
Aceite: `pnpm vitest run test/unit/` e `pnpm typecheck` passam.

### T-08 — Documentar a rotação de senha

Em `docs/4.examples/handle-session.md`, adicionar a subseção "Rotating the password" depois do aviso de entropia, com exemplo `password: [process.env.SESSION_PASSWORD_NEW, process.env.SESSION_PASSWORD_OLD]`. O texto diz que a primeira sela e todas abrem, que a lista deve ser curta e transitória, e que as senhas antigas devem sair da lista quando as sessões expirarem. Rodar `pnpm fmt` para regenerar o que for gerado por `automd`, sem edição manual em `docs/2.utils/4.security.md`.

Cobre: RF-09
Arquivos: `docs/4.examples/handle-session.md`
Depende de: T-06
Aceite: a subseção existe e o exemplo é coerente com o comportamento testado. `pnpm lint` (oxfmt `--check`) passa.

### T-09 — Verificação final e conferência da API pública

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e `pnpm test`. Buscar no repositório usos de `config.password` lidos como `string`. Conferir que `src/index.ts` e `test/unit/package.test.ts` não mudaram e que a única mudança de superfície pública é o tipo de `SessionConfig.password`.

Cobre: RF-01, RF-02, RF-08, RF-09
Arquivos: `src/utils/session.ts`, `test/session.test.ts`, `test/unit/types.test-d.ts`, `docs/4.examples/handle-session.md`
Depende de: T-06, T-07, T-08
Aceite: todos os comandos acima passam. `git diff --stat` não lista `src/index.ts`, `src/utils/internal/iron-crypto.ts` nem `test/unit/package.test.ts`. Nenhum teste perdeu cobertura.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-07, T-09 |
| RF-02 | T-02, T-03, T-05, T-06, T-09 |
| RF-03 | T-03, T-05 |
| RF-04 | T-03, T-06 |
| RF-05 | T-03, T-06 |
| RF-06 | T-03, T-04 |
| RF-07 | T-03, T-06 |
| RF-08 | T-09 |
| RF-09 | T-01, T-02, T-03, T-07, T-08, T-09 |
