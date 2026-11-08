# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md`. Ordem sugerida: T-01 → T-09.

### T-01 — Ampliar o tipo e o JSDoc de `password`

Alterar `SessionConfig.password` para `string | string[]` (D-01) e reescrever o JSDoc: a primeira senha sela, as demais só abrem; lista não vazia e sem itens vazios; colocar a nova na frente e manter as antigas só até as sessões expirarem; listas curtas por causa do custo de PBKDF2; mínimo de 32 caracteres em todas; sessão por cabeçalho não é resselada. Manter o aviso de entropia existente.

- Cobre: RF-01, RF-10
- Arquivos: `src/utils/session.ts`
- Depende de: nenhuma
- Aceite: `pnpm typecheck` passa nos usos internos já ajustados (T-02 a T-05) e o JSDoc descreve a semântica acima. Nenhum export novo em `src/index.ts`.

### T-02 — Helper interno `resolvePasswords` com validação

Criar `resolvePasswords(password)` em `src/utils/internal/session.ts` (não exportado por `src/index.ts`): `string` vira `[string]`, array vira cópia (sem mutar o original). Lança `new Error("Empty password")` se a lista for vazia ou se algum item for falsy ou não string (D-02, D-05). Atualizar o comentário de `kLegacySeal` para dizer "selo legado ou aberto com senha antiga" (D-06).

- Cobre: RF-01, RF-08
- Arquivos: `src/utils/internal/session.ts`
- Depende de: T-01
- Aceite: `resolvePasswords("x")` e `resolvePasswords(["x"])` devolvem `["x"]`. `[]` e `["", "x"]` lançam `Empty password`. O array de entrada não é alterado.

### T-03 — Selar apenas com a primeira senha

Em `sealSession`, chamar `seal(session, resolvePasswords(config.password)[0], …)`. Unificar os imports de `./internal/session.ts` sem criar barrel (D-03).

- Cobre: RF-02, RF-08
- Arquivos: `src/utils/session.ts`
- Depende de: T-02
- Aceite: com `[nova, antiga]`, o selo emitido abre com `nova` e falha com `Bad hmac value` quando só `antiga` é informada. `sealSession` com `[]` ou `["", "x"]` lança `Empty password`.

### T-04 — Abertura com várias senhas (`unsealWithPasswords`)

Reescrever o try/catch de `unsealSession`. Chamar `resolvePasswords` no início, antes de qualquer cripto, e extrair a função interna `unsealWithPasswords` no fim do arquivo (D-04):

1. Fase atual: tentar cada senha em ordem, com as iterações configuradas.
2. Fase legada: tentar cada senha com 1 iteração, só se `legacySealFallback !== false` e as iterações configuradas não forem 1.
3. Só o erro `"Bad hmac value"` (predicado único `isBadHmac`) passa para a próxima senha ou fase. Qualquer outro erro é relançado na hora.
4. Se todas falharem por HMAC, lançar o primeiro erro capturado.
5. Marcar `kLegacySeal` quando abrir com senha de índice > 0 ou na fase legada, apenas se o resultado for truthy.
6. Manter os blocos de `maxAge` e `idleTimeout` depois da abertura, sem alteração (D-07).

- Cobre: RF-03, RF-05, RF-06, RF-07, RF-08, RF-09
- Arquivos: `src/utils/session.ts`
- Depende de: T-02, T-03
- Aceite: um selo da `antiga` abre com `[nova, antiga]`. Um selo da `outra` é rejeitado com o erro original. Com uma única senha, a mensagem de erro e a ordem das tentativas são idênticas às de antes. `unsealSession` com `[]` lança `Empty password`. Erros que não sejam HMAC não tentam outras senhas.

### T-05 — Resselar com a primeira senha em `getSession`

Ajustar o comentário do ressel em `getSession` para cobrir "selo legado **ou** senha antiga". Conferir que o fluxo existente (remove `kLegacySeal`, chama `updateSession` quando `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))`) rassela com a primeira senha, preserva `createdAt` e faz no máximo um `updateSession` por leitura (D-06). Sessão lida do cabeçalho continua sem ressel.

- Cobre: RF-04, RF-07
- Arquivos: `src/utils/session.ts`
- Depende de: T-04
- Aceite: ao ler um cookie selado com `antiga` em `[nova, antiga]`, a resposta traz um `Set-Cookie` selado com `nova` que abre com `password: "nova"` isolada. Um cookie selado com `nova` não gera `Set-Cookie` extra. Pelo cabeçalho, a sessão abre sem ressel.

### T-06 — Ajustar os testes existentes ao tipo ampliado

Extrair uma constante `password` string no topo de `test/session.test.ts` e usá-la em `sessionConfig` e nas chamadas diretas a `seal`/`unseal` (D-08), sem usar `as` e sem mudar o que cada teste verifica.

- Cobre: RF-06
- Arquivos: `test/session.test.ts`
- Depende de: T-01
- Aceite: `pnpm vitest run test/session.test.ts` e `pnpm typecheck` passam com os testes antigos inalterados em substância.

### T-07 — Testes de regressão para RF-02 a RF-09

Adicionar em `test/session.test.ts`, via `describeMatrix`, com `name` próprio por teste e selos montados pelo `seal` interno (seção 5 da techspec):

1. RF-02: o cookie emitido com `[nova, antiga]` abre com `nova` e falha com `antiga`.
2. RF-03: `getSession` devolve id, `createdAt` e `data` originais.
3. RF-04: ressel com `nova`; sem `Set-Cookie` extra para selo da `nova`; cabeçalho abre sem ressel.
4. RF-05: selo da `outra` gera sessão nova, com id novo e dados vazios.
5. RF-06: `"x"` e `["x"]` dão o mesmo resultado, incluindo `maxAge`, `idleTimeout`, `seal` customizado e `legacySealFallback: false`.
6. RF-07: selo legado com `antiga` e com a primeira senha; restaurado e resselado, e rejeitado com `legacySealFallback: false`.
7. RF-08: `[]` e `["", "x"]` fazem `sealSession` e `unsealSession` lançarem `Empty password`, e `useSession` não emite cookie.
8. RF-09: expiração por `maxAge` e `idleTimeout` (com `vi.useFakeTimers({ toFake: ["Date"] })`) com `antiga`; erro não HMAC (selo malformado ou `Expired seal`) não tenta outras senhas e propaga o original.
9. Ordem: em `[a, b]`, a primeira falha por HMAC e a segunda abre.
10. Pior caso: sessão inválida faz no máximo 2N tentativas (contar chamadas).

- Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10
- Arquivos: `test/session.test.ts`
- Depende de: T-05, T-06
- Aceite: `pnpm vitest run test/session.test.ts` passa. Com as mudanças de `src/` descartadas (git stash), os testes novos falham.

### T-08 — Documentar a rotação de senha

Adicionar a seção curta "Rotação de senha" em `docs/4.examples/handle-session.md`, após o trecho atual: nova senha na frente, antiga mantida até a janela de `maxAge`, ressel automático em cookies, limitação de sessões só por cabeçalho e custo de listas longas. Tarefa opcional segundo a techspec.

- Cobre: RF-10
- Arquivos: `docs/4.examples/handle-session.md`
- Depende de: T-05
- Aceite: a seção existe, é consistente com o JSDoc e `pnpm lint` passa.

### T-09 — Verificação final

Rodar `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`, depois `pnpm vitest run` completo para conferir que `test/unit/package.test.ts` não acusa export novo. Confirmar que `src/utils/internal/iron-crypto.ts`, `src/types/context.ts`, `src/utils/auth.ts` e `src/index.ts` não foram alterados.

- Cobre: RF-01, RF-06, RF-10
- Arquivos: nenhum (somente verificação)
- Depende de: T-07, T-08
- Aceite: todos os comandos passam e `git diff --stat` não lista os arquivos protegidos.

## Cobertura dos requisitos

| Requisito | Tarefas                |
| --------- | ---------------------- |
| RF-01     | T-01, T-02, T-09       |
| RF-02     | T-03, T-07             |
| RF-03     | T-04, T-07             |
| RF-04     | T-05, T-07             |
| RF-05     | T-04, T-07             |
| RF-06     | T-04, T-06, T-07, T-09 |
| RF-07     | T-04, T-05, T-07       |
| RF-08     | T-02, T-03, T-04, T-07 |
| RF-09     | T-04, T-07             |
| RF-10     | T-01, T-07, T-08, T-09 |
