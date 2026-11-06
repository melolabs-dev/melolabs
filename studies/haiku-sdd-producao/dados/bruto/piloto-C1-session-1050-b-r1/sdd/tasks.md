# Tarefas de implementação — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (decisões D-01 a D-08, arquivos e casos de teste).

Ordem geral: cada tarefa escreve primeiro os testes do seu escopo em `test/session-extra-passwords.test.ts` (criado na T-01), vê-los falhar quando couber, e só então altera a implementação. `test/session.test.ts` não é alterado em nenhuma tarefa (RF-09).

### T-01 — Campo `extraUnsealPasswords` e símbolo interno `kExtraSeal`

Cobre: RF-01, RF-09

Depende de: nenhuma

Aceite:
- `SessionConfig` tem `extraUnsealPasswords?: readonly string[]` logo após `password`, com JSDoc dizendo que as senhas só abrem sessões, nunca selam, e que a lista deve ser curta e temporária.
- `password` continua `string`; nenhum export novo em `src/index.ts`.
- `kExtraSeal` existe em `src/utils/internal/session.ts`, ao lado de `kLegacySeal`.
- JSDoc de `legacySealFallback` menciona que o fallback vale para `password` e para todas as extras.
- Criado `test/session-extra-passwords.test.ts` com testes de RF-01: config sem o campo e com `[]` geram o mesmo cookie, `id`, `createdAt` e dados.
- `pnpm vitest run test/session.test.ts` e `pnpm typecheck` passam sem alterar testes existentes.

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session-extra-passwords.test.ts`

### T-02 — Validação das senhas extras em `sealSession` (`assertExtraPasswords`)

Cobre: RF-06

Depende de: T-01

Aceite:
- Testes escritos antes: com extra vazia, com 31 caracteres, e inválida em posição 0 e em posição 2, `updateSession`, `sealSession` e `useSession` (criação) rejeitam.
- A mensagem contém `password` (minúsculo, casando com `/password/i`) e não contém o valor da senha inválida.
- Limite usado é `Math.max(minPasswordlength de encryption, minPasswordlength de integrity)` das opções efetivas `{ ...sealDefaults, ...config.seal }`.
- Com `password` válida e extras válidas, nenhuma operação de selo lança erro de validação.
- Teste de `password` inválida continua lançando erro como hoje.
- `assertExtraPasswords` é chamada no início de `sealSession`, antes de qualquer `seal`.

Arquivos: `src/utils/session.ts`, `test/session-extra-passwords.test.ts`

### T-03 — Selagem sempre com `password`

Cobre: RF-02

Depende de: T-02

Aceite:
- Teste: com `password = P1` e `extraUnsealPasswords = [P0]`, o cookie gerado por `useSession` (criação), `updateSession` e `sealSession` abre com `P1` e não abre com `P0` sozinha (verificado com `unseal` direto).
- Nenhuma chamada de selo usa `extraUnsealPasswords`; `sealSession` usa `config.password`.
- Nenhuma mudança em `updateSession` nem `clearSession` (D-06).

Arquivos: `src/utils/session.ts`, `test/session-extra-passwords.test.ts`

### T-04 — Abertura em sequência em `unsealSession` (`validExtraPasswords`, `unsealOnce`, laço)

Cobre: RF-03, RF-04

Depende de: T-01

Aceite:
- Testes escritos antes:
  - cookie com `P0` (extra de `password = P1`) abre em `getSession` com mesmo `id`, `createdAt` e dados;
  - cookie com `P1` não dispara tentativa com `P0` (contagem de `deriveBits` via `vi.spyOn(crypto.subtle, "deriveBits")`, confirmando que o método é interceptável em cada target da matriz; se não for, testar só pelo resultado);
  - cookie com extras em ordem: a segunda extra abre e a primeira não abre com sucesso;
  - cookie com `P9` (desconhecida) resulta em sessão vazia, sem `Set-Cookie`, sem erro, em `getSession` e `useSession`.
- `validExtraPasswords` filtra extras inválidas com a mesma regra de T-02, sem lançar (D-05).
- `unsealOnce` tenta a senha normal e, em `"Bad hmac value"`, o legado com 1 iteração quando `legacySealFallback !== false`.
- `unsealSession` tenta `[password, ...validExtras]`, para na primeira que abre, e lança o erro da primeira tentativa se nenhuma abrir.
- Erros que não são `"Bad hmac value"` são propagados na hora, sem tentar a próxima senha.
- `maxAge` e `idleTimeout` continuam aplicados uma vez, depois do laço.
- Assinatura pública de `unsealSession` não muda.

Arquivos: `src/utils/session.ts`, `test/session-extra-passwords.test.ts`

### T-05 — Re-selagem progressiva em `getSession` (marcador `kExtraSeal`)

Cobre: RF-05

Depende de: T-03, T-04

Aceite:
- Testes escritos antes:
  - cookie com `P0` e handler só de leitura em `useSession` gera `Set-Cookie` selado com `P1`, com mesmos `id`, `createdAt` e dados;
  - cookie com `P1` e handler só de leitura não gera `Set-Cookie` (`getSetCookie()` vazio);
  - sessão do cabeçalho de sessão (`x-h3-test-session`) com `P0` não gera `Set-Cookie`.
- `unsealSession` marca o retorno com `kExtraSeal = true` quando a sessão abriu por extra.
- O marcador é removido de `unsealed` antes de `Object.assign` (D-04), como `kLegacySeal`.
- Condição de re-selagem em `getSession` passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))`.
- Teste de não repetição: a sessão re-selada não gera re-selagem na mesma leitura nem carrega o marcador em memória.

Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session-extra-passwords.test.ts`

### T-06 — Cobertura de chunks e cabeçalho nas cinco funções

Cobre: RF-07

Depende de: T-05

Aceite:
- Testes escritos antes, com `chunkMaxLength` pequeno e sessão selada com extra:
  - `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession` abrem ou identificam a sessão corretamente (em `clearSession`, cookie principal e chunks recebem `Max-Age=0`);
  - re-selagem de cookie em chunks com `P1` remove os chunks antigos `name.N` que sobram (`Max-Age=0`), aproveitando `setChunkedCookie` (`src/utils/cookie.ts:215-225`);
  - sessão enviada pelo cabeçalho com extra é aberta por `getSession` e `unsealSession` com os dados originais.
- Nenhuma mudança em `clearSession` nem em `src/utils/cookie.ts` (D-06). Se algum teste falhar por isso, a correção vai para a T-05 ou para a T-04, não para esta tarefa.

Arquivos: `test/session-extra-passwords.test.ts`, `src/utils/session.ts` (somente se um teste acusar falha)

### T-07 — Compatibilidade com sessões legadas com senhas extras

Cobre: RF-08

Depende de: T-04

Aceite:
- Teste escrito antes: sessão legada (1 iteração PBKDF2) selada com `P0` (extra), com `legacySealFallback` ativo, é aberta por `getSession`, re-selada com `password` e enviada em novo `Set-Cookie`.
- Teste: a mesma sessão legada com `legacySealFallback: false` vira sessão vazia, sem `id`, como hoje.
- O fallback legado é aplicado por senha dentro de `unsealOnce`, na mesma ordem de D-03 (senha normal e depois legada, antes da próxima senha).

Arquivos: `src/utils/session.ts`, `test/session-extra-passwords.test.ts`

### T-08 — Regressão completa, documentação e verificação final

Cobre: RF-09

Depende de: T-05, T-06, T-07

Aceite:
- `pnpm vitest run test/session.test.ts` passa sem alterações nos testes existentes.
- `pnpm vitest run test/session-extra-passwords.test.ts` passa nos dois targets da matriz (web e node).
- `pnpm lint` (inclui typecheck) e `pnpm test` (lint, typecheck e cobertura) passam.
- Com `extraUnsealPasswords` ausente ou `[]`, o comportamento é igual ao da versão atual (não re-sela ao só ler, não cria `Set-Cookie` ao rejeitar sessões de outra senha).
- Verificado se há documentação fora de `src` e `sdd` que descreve `SessionConfig`; se houver, recebe o novo campo. `CHANGELOG.md` não é editado.
- Nenhum arquivo de `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts` ou `src/index.ts` foi alterado.
- Se `src/utils/session.ts` continuar acima de 200 linhas, a mudança fica registrada como ponto de atenção (opcional mover helpers para `src/utils/internal/`).

Arquivos: `src/utils/session.ts`, `test/session-extra-passwords.test.ts`, documentação existente que descreva `SessionConfig` (se houver)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-01 |
| RF-02 | T-03 |
| RF-03 | T-04 |
| RF-04 | T-04 |
| RF-05 | T-05 |
| RF-06 | T-02 |
| RF-07 | T-06 |
| RF-08 | T-07 |
| RF-09 | T-01, T-08 |
