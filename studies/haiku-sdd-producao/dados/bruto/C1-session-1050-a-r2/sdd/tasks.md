# Tarefas de implementação — Várias senhas de unseal nas sessões

Base: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-09, estratégia de testes e riscos).

A ordem segue a coluna "Depende de". T-01 vem antes de qualquer implementação, conforme o fluxo de bug/feature do `AGENTS.md`: os testes são escritos e vistos falhando antes do código.

### T-01 — Testes de regressão primeiro (falhando)

Extrair `const password = "1234567..."` em `test/session.test.ts` (linhas 21-25) e usar essa constante em `sessionConfig` e nos pontos de `seal`/`unseal` que hoje usam `sessionConfig.password` (linhas 137, 157 e 164). Depois, escrever com `describeMatrix` os casos 1 (abre sessão com senha antiga), 2 (sela com a primeira senha), 3 (senha fora da lista vira sessão nova) e 5 (lista vazia lança erro com "empty") da techspec, sem implementar nada em `src/`.

- Cobre: RF-01, RF-02, RF-03, RF-05
- Depende de: nenhuma
- Aceite: `pnpm vitest run test/session.test.ts` mostra os casos 1, 2 e 5 falhando, em web e node. Os demais casos desta tarefa podem passar ou falhar, mas nenhum outro teste existente pode falhar. Nenhum arquivo em `src/` é alterado.
- Arquivos: `test/session.test.ts`

### T-02 — Tipo `string | string[]` e helper `toPasswordList`

Mudar o tipo de `SessionConfig.password` para `string | string[]` (`src/utils/session.ts`, linha 48) e atualizar o comentário do campo. Criar `toPasswordList` em `src/utils/internal/session.ts` conforme a seção "Helper interno" da techspec: string vira `[x]`; array é devolvido sem cópia; array vazio lança `Error("The session password list is empty: provide at least one password")`; outro valor não-array vira `[valor]`. Criar `test/unit/session-password.test.ts` com os quatro casos de "Contratos". Não exportar nada novo em `src/index.ts`.

- Cobre: RF-01, RF-04, RF-05
- Depende de: T-01
- Aceite: `pnpm vitest run test/unit/session-password.test.ts` passa. `pnpm typecheck` pode ainda acusar os usos de `config.password` dentro de `session.ts`; eles são resolvidos em T-03 a T-05. `src/index.ts` e `test/unit/package.test.ts` não mudam.
- Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/unit/session-password.test.ts`

### T-03 — Validação da lista em `getSession`, `sealSession` e `unsealSession`

Chamar `toPasswordList` no início de `getSession`, antes de qualquer mutação de `context.sessions` (`src/utils/session.ts`, linhas 149-173). Chamar também em `sealSession` e `unsealSession`, porque ambas são exportadas. A checagem precisa ficar fora do `.catch(() => {})` da linha 196-197, senão o erro de configuração seria engolido e a requisição receberia uma sessão nova sem aviso (D-03). Nesta tarefa ainda não há laço de abertura nem mudança na selagem.

- Cobre: RF-05
- Depende de: T-02
- Aceite: o caso 5 de T-01 passa nas duas rotas (`useSession` e `getSession`), e `t.errors[0].message` contém "empty".
- Arquivos: `src/utils/session.ts`

### T-04 — Laço de abertura com todas as senhas

Criar `unsealWithPasswords(sealed, passwords, sealOptions, legacyFallback)` perto de `unsealSession`. Para cada senha, na ordem declarada: tentar a abertura estrita; se falhar com `"Bad hmac value"` e `legacyFallback` estiver ligado, tentar a legada (`iterations: 1`) e marcar `kLegacySeal`. Qualquer outro erro é relançado na hora. Se a lista acabar, relançar o último `"Bad hmac value"`. `legacyFallback` vale `config.legacySealFallback !== false` e é ignorado quando `iterations === 1`, como hoje (`src/utils/session.ts`, linha 334). `unsealSession` chama `toPasswordList` e depois `unsealWithPasswords`. As checagens de `maxAge` e `idleTimeout` (linhas 350-365) ficam depois do laço, sem mudança (D-04, D-06). `iron-crypto.ts` não muda.

- Cobre: RF-02, RF-03, RF-07
- Depende de: T-03
- Aceite: os casos 1 e 3 de T-01 passam. Os testes existentes de legado e de expiração em `test/session.test.ts` continuam passando.
- Arquivos: `src/utils/session.ts`

### T-05 — Selagem sempre com a primeira senha

Trocar `config.password` por `toPasswordList(config.password)[0]` na chamada de selagem de `sealSession` (`src/utils/session.ts`, linha 300), conforme D-05. `updateSession`, `clear` e a renovação por `idleTimeout` não mudam, porque já delegam a `sealSession`. Com isso, sessões abertas com senha secundária são regravadas com a primeira na próxima escrita.

- Cobre: RF-01, RF-04, RF-06
- Depende de: T-04
- Aceite: o caso 2 de T-01 passa. Depois de `update`, `unseal(cookie, "antiga", sealDefaults)` lança `"Bad hmac value"`. O teste "throttles idleTimeout reseals" (`test/session.test.ts`, linhas 410-435) passa com a mesma contagem de `subtle.encrypt`.
- Arquivos: `src/utils/session.ts`

### T-06 — Casos de borda: formato, expiração e legado

Escrever em `test/session.test.ts`, depois da linha 186, os casos 4, 6, 7 e 8 da techspec:

- Caso 4: `["x"]` e `"x"` geram token com 8 partes em `split("*")`, com a parte do id vazia, e ambos abrem com `"x"`. Cobre o RF-04.
- Caso 6: sessão legada com `"antiga"` e lista `["nova", "antiga"]` é aberta e o `Set-Cookie` abre com `"nova"`. Cobre RF-06 e RF-07.
- Caso 7: relógio falso como em linhas 188-191; sessão criada com `"antiga"` expira após `maxAge` e a requisição recebe sessão nova. Cobre o RF-07.
- Caso 8: sessão legada com `"antiga"`, lista `["nova", "antiga"]` e `legacySealFallback: false` resulta em sessão nova. Cobre a regressão do fallback por senha (RF-07).

- Cobre: RF-04, RF-06, RF-07
- Depende de: T-05
- Aceite: `pnpm vitest run test/session.test.ts` passa em web e node, incluindo os quatro casos. Se algum falhar, a correção vai para a implementação da tarefa responsável, não para o teste.
- Arquivos: `test/session.test.ts`

### T-07 — Documentação da rotação de senhas

Atualizar o comentário de `SessionConfig.password` (`src/utils/session.ts`, linhas 41-48) e a seção de `docs/4.examples/handle-session.md` (linhas 36-43), conforme D-09 e os riscos da techspec. A documentação precisa cobrir:

- a ordem da lista: a primeira sela, as demais só abrem;
- a remoção de senhas antigas depois do prazo de expiração das sessões (`maxAge` ou `idleTimeout`);
- o custo de uma derivação PBKDF2 por tentativa, e a recomendação de listas curtas;
- o aviso de ordem errada, que não gera erro (R4);
- o aviso de que senha secundária com menos de 32 caracteres falha em silêncio (R2);
- a mudança de tipo para quem lê `config.password` (R5).

Além disso, corrigir em `sdd/prd.md` a premissa do identificador `default` na selagem por string, que não procede (techspec, "Correção de premissa", R6). A conclusão de RF-04 não muda.

- Cobre: RF-01, RF-06, RF-07
- Depende de: T-05
- Aceite: o comentário JSDoc e a seção de docs citam os seis pontos acima. `pnpm lint` (`oxfmt --check`) passa nos arquivos alterados.
- Arquivos: `src/utils/session.ts`, `docs/4.examples/handle-session.md`, `sdd/prd.md`

### T-08 — Verificação final da suíte

Rodar, nesta ordem: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm typecheck`, `pnpm lint` e, por último, `pnpm test` com cobertura. Conferir que `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `src/utils/cookie.ts`, `src/utils/auth.ts` e `test/bench/session.ts` não foram alterados. Só rodar `pnpm bench:node` se a suíte mostrar lentidão evidente (R1). Benchmarks novos estão fora de escopo.

- Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
- Depende de: T-06, T-07
- Aceite: `pnpm test` termina sem falhas. `git status` mostra apenas os arquivos listados nas tarefas T-01 a T-07, além de `sdd/tasks.md`.
- Arquivos: nenhum arquivo novo; a tarefa só executa comandos e confere o resultado.

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 — `password` aceita lista | T-01, T-02, T-05, T-07 |
| RF-02 — abertura com qualquer senha da lista | T-01, T-04 |
| RF-03 — senha fora da lista continua rejeitada | T-01, T-04 |
| RF-04 — senha única preserva o comportamento | T-02, T-05, T-06 |
| RF-05 — lista vazia é erro de configuração | T-01, T-02, T-03 |
| RF-06 — sessões antigas migram ao serem regravadas | T-05, T-06, T-07 |
| RF-07 — expiração e fallback legado valem para cada senha | T-04, T-06, T-07 |
