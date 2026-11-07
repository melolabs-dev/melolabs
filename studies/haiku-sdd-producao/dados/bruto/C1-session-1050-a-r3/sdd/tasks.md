# Tarefas de implementação — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-06) e `sdd/techspec.md` (decisões D-01 a D-10).

Ordem: os testes vêm antes da implementação (Bug Fix Workflow de `AGENTS.md`). A tarefa T-04 muda o tipo público e, até T-05 ser feita, a checagem de tipos acusa os pontos de uso de `config.password` em `src/utils/session.ts`. Isso é esperado.

### T-01 — Extrair a senha dos testes existentes para uma constante

Cobre: RF-04
Depende de: nenhuma
Aceite: em `test/session.test.ts`, a senha passa a ser a constante `password`, usada em `sessionConfig` (`:21-25`) e nas chamadas diretas de `seal`/`unseal` (`:137`, `:157`, `:164`). `pnpm vitest run test/session.test.ts` passa sem alterar nenhuma expectativa.
Arquivos: `test/session.test.ts`

### T-02 — Escrever os testes de lista de senhas (devem falhar)

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06
Depende de: T-01
Aceite: existe `describe("multiple passwords")` em `test/session.test.ts`, inserido após os testes de legado (`:134-186`), com os oito testes da techspec 5.1 (itens 1 a 8): selar com a primeira senha; abrir cookie selado com a segunda; rejeitar senha fora da lista; string e lista de um elemento equivalentes; legado com a segunda senha, com fallback ligado e desligado; lista vazia nas quatro funções; `maxAge` vencido com a segunda senha. Os testes que dependem de lista falham antes de qualquer mudança em `src/`. A saída da falha fica registrada.
Arquivos: `test/session.test.ts`

### T-03 — Escrever o teste de tipo de `password`

Cobre: RF-01
Depende de: T-01
Aceite: novo arquivo `test/unit/session.test-d.ts`, seguindo o padrão de `test/unit/types.test-d.ts`, com `const config: SessionConfig = { password: [A, B] }` e uma senha em string. Antes de T-04, o `pnpm typecheck` acusa o caso de lista.
Arquivos: `test/unit/session.test-d.ts`

### T-04 — Ampliar o tipo público e atualizar a JSDoc

Cobre: RF-01
Depende de: T-02, T-03
Aceite: `SessionConfig.password` passa a ser `string | string[]` (`src/utils/session.ts:48`). A JSDoc (`:41-47`) diz que a lista é aceita, que a primeira senha sela, que as demais só abrem sessões e que a senha antiga deve sair da lista quando a rotação terminar. Nenhum nome público novo é exportado. O typecheck acusa erro em `src/utils/session.ts:300`, `:324` e `:340`, e isso é resolvido em T-05.
Arquivos: `src/utils/session.ts`

### T-05 — Normalizar a lista e validar lista vazia

Cobre: RF-01
Depende de: T-04
Aceite: existe o helper não exportado `toPasswordList` em `src/utils/session.ts`. Ele converte string em `[string]` e lança `Session password list must not be empty` para array vazio. A validação roda em `getSession` antes do `try` (`:149-155`), em `sealSession` (`:282`) e em `unsealSession` (`:312`). String vazia `""` não é validada. O teste 7 de T-02 passa, e o `pnpm typecheck` volta a passar.
Arquivos: `src/utils/session.ts`

### T-06 — Selar sempre com a primeira senha

Cobre: RF-02, RF-04
Depende de: T-05
Aceite: `sealSession` usa `toPasswordList(config.password)[0]` (`src/utils/session.ts:300`). Os testes 1 e 4 de T-02 passam. Um cookie selado com string tem o mesmo formato de antes (mesmas partes e prefixo) e abre com `unseal(cookie, senha, sealDefaults)`.
Arquivos: `src/utils/session.ts`

### T-07 — Laço de abertura em ordem, com propagação de erros

Cobre: RF-03
Depende de: T-06
Aceite: `unsealSession` percorre a lista na ordem declarada e para na primeira senha que abre. Continua para a próxima só no erro `"Bad hmac value"`. Os erros `"Expired seal"`, `"Wrong mac prefix"`, `"Incorrect number of sealed components"` e `"Empty password"` são propagados na hora. Se nenhuma senha abre, relança o primeiro `"Bad hmac value"`. Os testes 2 e 3 de T-02 passam. O fallback legado ainda não entra nesta tarefa (T-08).
Arquivos: `src/utils/session.ts`

### T-08 — Fallback legado para cada senha

Cobre: RF-05
Depende de: T-07
Aceite: para cada senha, a ordem é: tentativa com as iterações atuais; se houver `"Bad hmac value"`, `legacySealFallback !== false` e iterações diferentes de 1, tentativa com 1 iteração, marcando `kLegacySeal`. Os testes 5 e 6 de T-02 passam. A resealagem legada (`src/utils/session.ts:214-215`) continua igual e regrava com a primeira senha.
Arquivos: `src/utils/session.ts`

### T-09 — Manter `maxAge` e `idleTimeout` fora do laço

Cobre: RF-06
Depende de: T-08
Aceite: as verificações de `maxAge` (`src/utils/session.ts:350-355`) e de `idleTimeout` (`:359-365`) continuam depois do laço e rodam uma única vez. O teste 8 de T-02 passa, e os testes existentes de `maxAge` e `idleTimeout` passam sem mudança.
Arquivos: `src/utils/session.ts`

### T-10 — Documentar a rotação de senhas

Cobre: RF-01, RF-03
Depende de: T-09
Aceite: em `docs/4.examples/handle-session.md`, logo após o aviso das linhas 37-43, há uma seção curta que diz: `password` aceita lista; a primeira senha sela e as demais só abrem; o procedimento de rotação (nova primeiro, antiga mantida, antiga removida depois de um intervalo maior que o maior `maxAge`/`idleTimeout`); o trade-off de tempo de resposta e de custo de PBKDF2 por senha errada; e que o requisito de 32 caracteres é orientação de uso. `CHANGELOG.md` não é alterado.
Arquivos: `docs/4.examples/handle-session.md`

### T-11 — Medir o custo de desempenho na bancada

Cobre: RF-03
Depende de: T-09
Aceite: `test/bench/session.ts` ganha uma entrada com `password: [nova, antiga]` que lê um cookie selado com a senha antiga. `pnpm bench:node` roda antes e depois da mudança, com e sem lista, e os resultados vão para a descrição do PR. O limite aceitável fica pendente de definição pelo time (techspec, seção 7).
Arquivos: `test/bench/session.ts`

### T-12 — Verificação final

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06
Depende de: T-10, T-11
Aceite: `pnpm lint` e `pnpm typecheck` passam. `pnpm test` (lint, typecheck e cobertura) passa. Em `git status`, só aparecem alterações em `src/utils/session.ts`, `test/session.test.ts`, `test/unit/session.test-d.ts`, `docs/4.examples/handle-session.md` e `test/bench/session.ts`. `src/utils/internal/iron-crypto.ts`, `src/utils/auth.ts` e `src/index.ts` ficam intactos.
Arquivos: nenhum arquivo de código (só verificação)
