# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Segue o fluxo de correção de bug do AGENTS.md: teste de regressão primeiro (T-01), confirmado como falho, depois a implementação.

### T-01 — Teste de regressão da rotação de senha (deve falhar antes da mudança)
Escrever em `test/session.test.ts`, dentro de `describeMatrix`, o teste de RF-02: sessão selada com A (via `seal`/`sealDefaults`), config `password: B` e `extraUnsealPasswords: [A]`, rota com config própria como em `:172`. Verificar `id` e `data` originais, sem sessão nova. Rodar e confirmar que o teste **falha** com o código atual. Usar senhas de 32+ caracteres.

Cobre: RF-02, RF-08
Arquivos: `test/session.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` mostra o novo teste falhando e os existentes passando, antes de qualquer mudança em `src/`.

### T-02 — Campo `extraUnsealPasswords` em `SessionConfig`
Inserir `extraUnsealPasswords?: string[]` depois de `password` (`:48`), com o TSDoc do techspec §4 (só abre, nunca sela, ordem de tentativa, lista curta e sem repetição, remover após a migração). `password` continua `string`. Nenhum outro nome público.

Cobre: RF-01
Arquivos: `src/utils/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa com a config nova; `pnpm vitest run test/unit/package.test.ts` confirma que a lista de exportações não mudou.

### T-03 — Extrair `unsealWith` e iterar senhas em `unsealSession`
Criar a função interna não exportada `unsealWith(sealed, password, config, sealOptions)` no fim do arquivo, com o corpo atual de `:322-348` (incluindo o fallback legado de 1 iteração por senha, D-04) e tipos explícitos (`isolatedDeclarations`). Em `unsealSession`, montar `sealOptions` como hoje e iterar `[config.password, ...(config.extraUnsealPasswords ?? [])]`: passar à próxima senha só em `Bad hmac value`, guardar o primeiro erro e lançá-lo se todas falharem; outros erros são lançados na hora (D-05). Sucesso no índice > 0 marca `kLegacySeal = true` (D-06). Manter `maxAge`/`idleTimeout` depois do laço. `sealSession` e `updateSession` não mudam (selam só com `password`).

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-02
Aceite: o teste de T-01 passa; a suíte existente de `test/session.test.ts` passa sem alteração; `unsealSession` com senha errada e sem extras (ausente ou `[]`) rejeita com o mesmo erro `Bad hmac value`; `pnpm typecheck` passa.

### T-04 — Resselo ao abrir com senha extra (comentários de `kLegacySeal`)
Confirmar que `getSession` reessela via `kLegacySeal`/`updateSession` sem mudar de lógica e que a sessão do cabeçalho não é resselada. Atualizar o comentário de `session.ts:210-213` e o de `kLegacySeal` em `src/utils/internal/session.ts:7-9` para dizer que o marcador também cobre senhas extras. Sem novo símbolo.

Cobre: RF-04, RF-03
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`
Depende de: T-03
Aceite: cookie selado com A, config `password: B` e `extraUnsealPasswords: [A]` gera uma resposta com um `Set-Cookie` que abre só com `{password: B}`; pelo cabeçalho de sessão não há `Set-Cookie`.

### T-05 — Testes restantes de sessão (RF-02 a RF-07)
Completar em `test/session.test.ts` (`describeMatrix`) a tabela do techspec §5: cabeçalho `x-h3-test-session` sem `Set-Cookie`; `update` após abrir com A (o cookie abre com B e não com A); resselo na leitura com `id` preservado e um só `Set-Cookie`; senha C fora da lista (id novo, `data` vazio); senha removida da lista rejeita o cookie antigo; ordem (B vence quando ambas abrem, sem resselo); `maxAge` vencido com A (`vi.useFakeTimers({ toFake: ["Date"] })`); `idleTimeout` com A sem `Set-Cookie` duplicado; seal legado com A aceito e resselado, e rejeitado com `legacySealFallback: false`; `extraUnsealPasswords` ausente e `[]`, com `unsealSession` de senha errada lançando `Bad hmac value`; extra curta (<32) lançando o erro de tamanho mínimo.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`
Depende de: T-03, T-04
Aceite: `pnpm vitest run test/session.test.ts` passa; remover temporariamente o laço de extras em `unsealSession` faz o teste de RF-02 falhar (e a mudança é revertida em seguida).

### T-06 — Teste de tipo de RF-01
Acrescentar ao fim de `test/unit/types.test-d.ts` um caso em que `extraUnsealPasswords: string[]` é aceito e `password: ["x"]` é erro de tipo, com `// @ts-expect-error`.

Cobre: RF-01, RF-08
Arquivos: `test/unit/types.test-d.ts`
Depende de: T-02
Aceite: `pnpm typecheck` passa (o `@ts-expect-error` não fica sem uso).

### T-07 — Documentação de rotação de senha
Adicionar a seção "Rotate the password" em `docs/4.examples/handle-session.md`, depois de `:149` ou antes de `## Expiration`, com exemplo de `password` novo e `extraUnsealPasswords` com o antigo, o resselo na leitura, o aviso para manter a lista curta (custo de PBKDF2/DoS) e remover a senha antiga após a migração (cookies do cabeçalho não são resselados). Não editar à mão o bloco `automd:jsdocs` de `docs/2.utils/4.security.md`.

Cobre: RF-08
Arquivos: `docs/4.examples/handle-session.md`
Depende de: T-03
Aceite: a seção existe, em inglês como o resto do arquivo, com exemplo coerente com a API implementada; `pnpm fmt` não gera diff inesperado em `docs/2.utils/4.security.md`.

### T-08 — Verificação final
Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint` e `pnpm typecheck`; rodar `pnpm fmt` se o TSDoc exigir regenerar a documentação. Corrigir falhas sem enfraquecer testes existentes.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Arquivos: `src/utils/session.ts`, `test/session.test.ts`
Depende de: T-05, T-06, T-07
Aceite: os quatro comandos terminam sem falhas.

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-06, T-08 |
| RF-02 | T-01, T-03, T-05, T-08 |
| RF-03 | T-03, T-04, T-05, T-08 |
| RF-04 | T-04, T-05, T-08 |
| RF-05 | T-03, T-05, T-08 |
| RF-06 | T-03, T-05, T-08 |
| RF-07 | T-03, T-05, T-08 |
| RF-08 | T-01, T-05, T-06, T-07, T-08 |
