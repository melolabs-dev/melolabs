# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Ordem pensada para o fluxo de correção do `AGENTS.md`: ajustar testes existentes, escrever os testes novos e vê-los falhar, implementar e ver passar, rodar a suíte completa.

### T-01 — Ajustar os testes existentes que passam `password` ao `iron-crypto`

Extrair `const password = "1234567123456712345671234567123456712345671234567"` no topo do `describeMatrix` de `test/session.test.ts`, usá-lo em `sessionConfig` e nos três pontos que chamam `seal`/`unseal` com `sessionConfig.password` (techspec seção 5). O que os testes verificam não muda.

Cobre: RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` passa como antes; nenhum teste foi removido nem teve a asserção enfraquecida (conferir no diff).
Arquivos: `test/session.test.ts`

### T-02 — Escrever os testes novos (vermelhos antes da implementação)

Criar `describe("password rotation")` em `test/session.test.ts` (senhas de 32+ caracteres, tokens antigos forjados com `seal`) cobrindo: RF-02 (cookie abre só com `nova`); RF-03 (cookie e header `x-h3-test-session` preservam `id` e dados, `generateId` não é chamado); RF-04 (`Set-Cookie` proativo, variantes de escrita e `idleTimeout`, sem `Set-Cookie` por header); RF-05 (senha fora da lista e config de string única com token da antiga geram sessão nova); RF-06 (`sealSession`/`unsealSession` com `[]` e `[nova, "curta"]`, e `useSession` com `[]`); RF-07 (`[nova]` igual a `nova`, token legado de 1 iteração com senha secundária reressalado, rejeição com `legacySealFallback: false`); expiração por TTL sem tentar outras senhas; marcadores `kSecondarySeal`/`kLegacySeal` não vazam em `Object.getOwnPropertySymbols(session)`. Testes de contagem de `deriveBits` são opcionais (só se estáveis em web e node). Acrescentar o teste de tipo do RF-01 em `test/unit/types.test-d.ts` (`SessionConfig["password"]` igual a `string | string[]`; as cinco funções aceitam `{ password: string }` e `{ password: string[] }`).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes novos falhando pelos motivos esperados (e os antigos passando) antes de T-03 a T-07; `pnpm vitest run test/unit/` mostra o teste de tipo falhando antes de T-04.
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts`

### T-03 — Criar `kSecondarySeal` e `resolvePasswords` no módulo interno

Em `src/utils/internal/session.ts`: exportar `kSecondarySeal = Symbol.for("h3.internal.session.secondary-seal")` ao lado de `kLegacySeal`, e `resolvePasswords(password, minLength): [string, ...string[]]`, que converte `string` em lista, lança `Error("Empty password")` para lista vazia ou elemento que não seja string não vazia, e `Error("Password string too short (min N characters required)")` para elemento menor que `N`. Não exportar nada em `src/index.ts`.

Cobre: RF-06, RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` passa; `src/index.ts` sem alteração (nenhum nome público novo); as mensagens de erro são idênticas às de `iron-crypto.ts`.
Arquivos: `src/utils/internal/session.ts`

### T-04 — Tipo `password: string | string[]` e JSDoc de rotação

Alterar `SessionConfig.password` para `string | string[]` e reescrever o JSDoc: índice 0 sela, os demais só abrem, a ordem importa; lista não vazia; mínimo de 32 caracteres por senha; preferir listas curtas (custo PBKDF2); remover a senha antiga ao fim da janela de rotação.

Cobre: RF-01, RF-08
Depende de: nenhuma
Aceite: o teste de tipo de T-02 passa; `pnpm typecheck` passa (o uso de `config.password` em `sealSession`/`unsealSession` será ajustado em T-05 e T-06, então rodar o typecheck completo após eles); o JSDoc descreve a semântica de rotação.
Arquivos: `src/utils/session.ts`

### T-05 — `sealSession` sela com a primeira senha e valida a lista

Extrair as `sealOptions` para uma constante local, chamar `resolvePasswords` com o maior `minPasswordlength` entre encriptação e integridade, e selar com `passwords[0]`. `updateSession` herda a mudança sem alteração.

Cobre: RF-02, RF-06, RF-07
Depende de: T-03, T-04
Aceite: testes de RF-02 e os de `sealSession` de RF-06 do T-02 passam; com senha única o token é igual ao de hoje (suíte existente verde).
Arquivos: `src/utils/session.ts`

### T-06 — `unsealSession` tenta todas as senhas (iterações por fora, senhas por dentro)

Validar a lista com `resolvePasswords` no início. Implementar o laço de senhas (`unsealWithAny`): continuar para a próxima senha só quando o erro for `Error` com mensagem `"Bad hmac value"`; relançar na hora qualquer outro erro (ex.: `Expired seal`); se todas falharem, relançar o último. Só depois de esgotar as senhas com as iterações atuais, e se o fallback legado estiver ativo e as iterações forem diferentes de 1, repetir com 1 iteração em todas as senhas e marcar `kLegacySeal`. Marcar `kSecondarySeal` quando o índice da senha que abriu for maior que 0. Com uma senha só, a sequência de chamadas a `unseal` fica idêntica à atual.

Cobre: RF-03, RF-05, RF-06, RF-07
Depende de: T-03, T-04
Aceite: testes de RF-03, RF-05, RF-06 (`unsealSession`), RF-07 e o de expiração por TTL do T-02 passam; token com senha fora da lista falha com `Bad hmac value`; `Expired seal` não gera tentativas extras; a tabela de verdade da techspec seção 4 é respeitada.
Arquivos: `src/utils/session.ts`

### T-07 — `getSession` reressala proativamente sessões abertas com senha secundária

Importar `kSecondarySeal`; ler e apagar o marcador no mesmo ponto em que `kLegacySeal` é apagado, antes do `Object.assign`; incluir `secondarySeal` na condição de reseal por cookie (`legacySeal || secondarySeal || shouldSlide`). Sessões lidas por header não são reressaladas. Manter o `.catch(() => {})` do unseal.

Cobre: RF-04, RF-05
Depende de: T-05, T-06
Aceite: testes de RF-04 do T-02 passam (cookie reressalado abre só com `nova`; sem `Set-Cookie` por header; marcadores não aparecem em `getOwnPropertySymbols(session)`); token inválido continua gerando nova sessão (RF-05).
Arquivos: `src/utils/session.ts`

### T-08 — Documentar a rotação de senha

Acrescentar a seção "Rotating the password" em `docs/4.examples/handle-session.md`, depois do aviso `[!WARNING]`: exemplo com `password: [nova, antiga]`, explicação de que a primeira sela e as demais só abrem, o reseal automático ao ler, o custo de listas longas e a remoção da senha antiga depois da janela de rotação.

Cobre: RF-08
Depende de: T-04
Aceite: a seção existe, o exemplo é coerente com a API implementada e `pnpm lint` (oxfmt) passa no arquivo.
Arquivos: `docs/4.examples/handle-session.md`

### T-09 — Verificação final

Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e `pnpm test`; corrigir o que falhar, sem alterar `iron-crypto.ts`, `src/index.ts` nem `test/bench/session.ts`. Conferir que todos os requisitos RF-01 a RF-08 têm teste e que nenhum arquivo fora do escopo mudou (`git status`).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-01, T-02, T-05, T-06, T-07, T-08
Aceite: todos os comandos acima terminam sem erro; `git status` lista apenas os arquivos citados nas tarefas T-01 a T-08.
Arquivos: nenhum (somente verificação)

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-03, T-04, T-09 |
| RF-02 | T-02, T-05, T-09 |
| RF-03 | T-02, T-06, T-09 |
| RF-04 | T-02, T-07, T-09 |
| RF-05 | T-02, T-06, T-07, T-09 |
| RF-06 | T-02, T-03, T-05, T-06, T-09 |
| RF-07 | T-02, T-05, T-06, T-09 |
| RF-08 | T-01, T-02, T-04, T-08, T-09 |
