# Tarefas de implementação: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (decisões D-01 a D-08). Ordem sugerida: T-01 a T-03 em paralelo, depois T-04, T-05, T-06, depois os blocos de testes e a verificação final.

Convenção geral: os testes novos seguem `describeMatrix` em `test/session.test.ts`. Cada teste de regressão deve falhar antes da mudança de código correspondente e passar depois. Testes existentes não são alterados, salvo ajuste estritamente necessário para compilar.

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

Adicionar o campo opcional `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig`, com comentário de tipo dizendo: senhas anteriores, usadas só para abrir, nunca selam, tentadas em ordem após `password`, ausente e lista vazia são equivalentes, cada item segue a regra de `password`, e cada senha que não abre custa uma derivação PBKDF2. `password` continua `string`. Nenhum outro export novo.

Cobre: RF-01

Depende de: nenhuma

Aceite: `SessionConfig` aceita `extraUnsealPasswords` sem erro de tipo; `pnpm typecheck` passa; o tipo de `password` não muda; `test/unit/package.test.ts` continua listando os mesmos exports.

Arquivos: `src/utils/session.ts`

### T-02 — Marcador interno `kExtraSeal`

Criar o símbolo `kExtraSeal` em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal` (`Symbol.for`), junto aos símbolos existentes.

Cobre: RF-05

Depende de: nenhuma

Aceite: o símbolo é exportado do módulo interno com o mesmo padrão de `kLegacySeal`; `pnpm typecheck` passa; nenhum export público novo em `src/index.ts`.

Arquivos: `src/utils/internal/session.ts`

### T-03 — Resolução única das opções de selo

Extrair a função interna `resolveSealOptions(config)` em `src/utils/session.ts` com a fórmula atual (`ttl` a partir de `maxAge`/`idleTimeout` e depois `...config.seal`). Trocar as três montagens existentes (em `sealSession`, em `unsealSession` e, no futuro, na validação) por essa função. Sem mudança de comportamento.

Cobre: RF-02 (apoio: a selagem e a abertura passam a usar as mesmas opções)

Depende de: nenhuma

Aceite: `pnpm vitest run test/session.test.ts` passa sem alterar nenhum teste existente; o teste de deriveBits em `test/session.test.ts` (`seals once`) continua com o mesmo número de derivações.

Arquivos: `src/utils/session.ts`

### T-04 — Validação central das senhas e selagem sempre com `password`

Criar a função interna `assertSessionPasswords(config, sealOptions)` e a função auxiliar `isValidPassword(password, sealOptions)`. Uma senha é inválida se não for string, se for vazia ou se tiver comprimento menor que `max(encryption.minPasswordlength, integrity.minPasswordlength)`. A mensagem usa "password" em minúsculas, indica o índice (por exemplo `extraUnsealPasswords[1]`), e nunca inclui o valor. Chamar `assertSessionPasswords` no início de `sealSession`. Em `updateSession`, chamar a mesma validação dentro do ramo do cookie, antes de qualquer mutação de `session.data` ou remoção de `kSessionNew`. Garantir que a selagem use sempre `password` e nunca uma extra.

Cobre: RF-02, RF-06

Depende de: T-01, T-03

Aceite: com `password` válida e extras válidas, nenhum erro é lançado; com extra curta ou vazia, `sealSession` e `updateSession` rejeitam com erro cuja mensagem contém "password"; em `updateSession` rejeitado, a sessão em memória não foi alterada; o cookie gravado abre com `password` e não abre com a extra.

Arquivos: `src/utils/session.ts`

### T-05 — Abertura sequencial por candidatos em `unsealSession`

Substituir o `try/catch` atual de `unsealSession` pelo loop sobre `[password, ...extraUnsealPasswords]`, usando a função interna `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` com o conteúdo do `try/catch` atual para uma senha (incluindo o fallback de 1 iteração PBKDF2). Regras: pular candidatos inválidos na leitura sem erro; avançar só no erro `"Bad hmac value"`; propagar imediatamente os demais erros (formato, `"Expired seal"`, decifragem, expiração por `maxAge`/`idleTimeout`); se nenhum candidato for válido, lançar erro, que `getSession` trata como sessão inexistente. Parar na primeira senha que abrir. Marcar o resultado com `kExtraSeal` quando o vencedor não for `password`. Não tentar extras quando `password` abre a sessão. Não alterar as checagens de expiração existentes.

Cobre: RF-03, RF-04, RF-07 (parte de `unsealSession`), RF-08

Depende de: T-01, T-02, T-03, T-04

Aceite: sessão selada com a segunda extra abre com `id`, `createdAt` e dados originais; sessão selada com `password` não dispara tentativas com extras; sessão selada com senha fora da lista é tratada como inexistente por `getSession` e `useSession` (sem erro, sessão nova e vazia); extra inválida na posição 0 não impede abertura pela extra válida na posição 1; sessão legada (1 iteração) selada com extra abre com `legacySealFallback` ativo e não abre com `legacySealFallback: false`.

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`

### T-06 — Rotação progressiva na leitura (`getSession`)

Em `getSession`, ler `kExtraSeal` do resultado de `unsealSession` e apagar o marcador antes do `Object.assign(session, unsealed)`, para que o símbolo não vaze para a sessão. Acrescentar a condição `extraSeal` à re-selagem existente, junto de `legacySeal` e `shouldSlide`, mantendo a regra de que sessões vindas do cabeçalho de sessão não são re-seladas. Sessões abertas por `password` não são re-seladas por este motivo.

Cobre: RF-05

Depende de: T-02, T-05

Aceite: sessão em cookie selada com extra, lida só com `useSession`, gera `Set-Cookie` selado com `password`, com o mesmo `id` e os mesmos dados; sessão em cookie selada com `password` não gera `Set-Cookie` de re-selagem; sessão do cabeçalho selada com extra não gera `Set-Cookie`; a sessão final não contém o símbolo `kExtraSeal`.

Arquivos: `src/utils/session.ts`

### T-07 — Testes de selagem e validação

Escrever em `test/session.test.ts`, com `describeMatrix`, os testes de RF-02 e RF-06: `updateSession` e `sealSession` com `password = P1` e extras `[P0]` gravam cookie que abre com P1 e não abre com P0 (usar `unseal` direto); extra curta na posição 1 e extra vazia rejeitam com `/password/` em `updateSession` e `sealSession`; `useSession` sem cookie com extra vazia rejeita com `/password/`; configuração válida não gera erro; `password` inválida continua rejeitando. Usar `seal(...)` e `sealDefaults` de `src/utils/internal/iron-crypto.ts` para gerar cookies de teste.

Cobre: RF-02, RF-06

Depende de: T-04

Aceite: os testes novos falham antes da implementação de T-04 e passam depois; nenhuma mensagem de erro nem log exibe o valor da senha; `pnpm vitest run test/session.test.ts` passa.

Arquivos: `test/session.test.ts`

### T-08 — Testes de abertura, ordem e sessões legadas

Escrever os testes de RF-01, RF-03, RF-04 e RF-08: com `extraUnsealPasswords: []`, `getSession` de sessão selada com `password` retorna o mesmo que com o campo ausente, sem `Set-Cookie`; ordem de tentativa conferida pela contagem de `crypto.subtle.deriveBits` (como em `test/session.test.ts`, teste de `seals once`), descontando a re-selagem da leitura: sessão com `password` custa 2 derivações; sessão com a primeira extra custa 4; sessão com a segunda extra custa 6; sessão com senha desconhecida vira sessão nova e vazia sem erro; extra inválida na posição 0 com válida na posição 1 abre normalmente; sessão legada com extra abre e re-sela com `legacySealFallback` ativo, e é tratada como inexistente com `legacySealFallback: false`.

Cobre: RF-01, RF-03, RF-04, RF-08

Depende de: T-05

Aceite: os testes novos falham antes de T-05 e passam depois; as contagens de derivação batem com as da techspec (seção 5, item 3), confirmadas ao rodar o teste; `pnpm vitest run test/session.test.ts` passa.

Arquivos: `test/session.test.ts`

### T-09 — Testes de rotação progressiva, chunks, cabeçalho e clear

Escrever os testes de RF-05 e RF-07: sessão em cookie com extra e `useSession` sem escrita gera `Set-Cookie` com `password`, mesmo `id` e dados; sessão com `password` não gera re-selagem; sessão do cabeçalho com extra não gera re-selagem; sessão grande (mais de 4000 caracteres selados, `CHUNKS_MAX_LENGTH` em `src/utils/cookie.ts`) selada com extra é lida corretamente e a re-selagem grava pedaços, com remoção dos pedaços antigos quando a re-selagem produz menos pedaços; `getSession` e `unsealSession` abrem sessão em chunks selada com extra; `clearSession` com sessão de cabeçalho selada com extra limpa o cookie com `Max-Age=0`; `updateSession` com sessão selada com extra regrava com `password`; regressão: sessão com extra e `maxAge` vencido vira sessão nova e não há re-selagem.

Cobre: RF-05, RF-07

Depende de: T-06

Aceite: os testes novos falham antes de T-06 e passam depois; os casos de chunks e de remoção de pedaços antigos passam; `pnpm vitest run test/session.test.ts` passa.

Arquivos: `test/session.test.ts`

### T-10 — Verificação final e regressão

Rodar a suíte completa e conferir que a implementação cobre todos os requisitos: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e, se possível, `pnpm test`. Conferir que nenhum teste existente foi alterado e que `test/unit/package.test.ts` continua listando os mesmos exports. Conferir que nenhuma mensagem de erro ou log contém valor de senha, e que `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts` e `src/index.ts` não foram alterados.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Depende de: T-07, T-08, T-09

Aceite: todos os comandos listados passam; `git diff` (ou equivalente) mostra alterações apenas nos arquivos listados em "Arquivos" das tarefas T-01 a T-09; nenhum teste existente foi alterado; registrar no relatório qualquer item pendente, incluindo a decisão em aberto sobre limite máximo de `extraUnsealPasswords` (techspec, seção 6, item 1).

Arquivos: `test/session.test.ts`, `test/unit/package.test.ts` (somente leitura, se a verificação o exigir), `src/utils/session.ts`, `src/utils/internal/session.ts`
