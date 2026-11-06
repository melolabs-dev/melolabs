# Tarefas de implementação — `extraUnsealPasswords` em sessões (h3js/h3#1050, variante b)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-08). Seguir o fluxo de bug-fix do AGENTS.md: testes primeiro (T-01 a T-03), confirmar que falham, depois implementar (T-04 a T-07), confirmar que passam, e por fim documentar e rodar a suíte completa (T-08, T-09).

Mapa de cobertura: RF-01 (T-01, T-04, T-08), RF-02 (T-01, T-04), RF-03 (T-01, T-05), RF-04 (T-01, T-05), RF-05 (T-02, T-06), RF-06 (T-03, T-07, T-08), RF-07 (T-02, T-05), RF-08 (T-02, T-05, T-06).

### T-01 — Testes de configuração, selagem, abertura em sequência e senha desconhecida

Em `test/session.test.ts`, dentro de `describeMatrix("session", ...)`, criar o helper local que sela `{ id, createdAt, data }` com uma senha dada (usando `seal` e `sealDefaults`) e uma segunda `SessionConfig` com `password` nova e `extraUnsealPasswords: [antiga1, antiga2]` (todas com 32+ caracteres). Escrever os casos 1 a 4 da seção 5 da techspec: ausência do campo e `[]` equivalentes, sem `Set-Cookie` ao só ler (RF-01); selo de sessão nova, `updateSession` e `sealSession` abre só com `password` e falha com cada extra isolada (RF-02); sessão da 2ª extra preserva `id`, `createdAt` e dados, e a ordem e a parada são conferidas contando chamadas de `crypto.subtle.deriveBits` com `vi.spyOn` (RF-03); senha fora da config gera sessão nova e vazia com status 200 (RF-04). Confirmar que os testes novos falham antes da implementação.

Cobre: RF-01, RF-02, RF-03, RF-04
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` roda e os testes novos falham pelo motivo esperado (campo ainda inexistente), enquanto os testes antigos do arquivo continuam passando. Cada caso tem nome que cita o RF correspondente.
Arquivos: `test/session.test.ts`

### T-02 — Testes de rotação progressiva, canais e sessões legadas

Em `test/session.test.ts`, escrever os casos 5, 7, 8 e 10 da techspec. Rotação (RF-05): cookie com extra e handler que só lê devolve exatamente um `Set-Cookie` que abre com `password` e não com a extra; cookie com `password` não gera `Set-Cookie`; cabeçalho `x-h3-test-session` com extra abre sem `Set-Cookie`. Canais (RF-07): `getSession`, `useSession`, `updateSession`, `unsealSession` e `clearSession` com sessão da extra em cookie simples, cookie em chunks (`cookie: { chunkMaxLength }` pequeno) e cabeçalho. Legado (RF-08): sessão de 1 iteração selada com extra abre e é re-selada com `password` e `sealDefaults`; com `legacySealFallback: false` é tratada como inexistente; legada selada com `password` não dispara tentativas com extras (contagem de derivações). Incluir sessão expirada por `maxAge`/`idleTimeout` aberta por extra ainda rejeitada (`Session expired!`).

Cobre: RF-05, RF-07, RF-08
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os novos casos falhando pelo motivo esperado e os testes existentes (incluindo os legados em `:134-185`) passando.
Arquivos: `test/session.test.ts`

### T-03 — Testes de validação das senhas extras

Em `test/session.test.ts`, escrever o caso 6 da techspec: para extra vazia e extra curta, e em cada posição da lista (primeira e última), `useSession` sem cookie, `updateSession` e `sealSession` rejeitam com mensagem casando `/password/i`, mesmo sem sessão no pedido; `password` curta continua rejeitando como hoje. Incluir um caso confirmando que quem apenas lê uma sessão aberta por `password` não falha por extra inválida (limitação documentada em D-06).

Cobre: RF-06
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os casos de extra inválida falhando antes da implementação (sem erro ou erro sem "password") e o caso de `password` curta passando.
Arquivos: `test/session.test.ts`

### T-04 — Campo na configuração, símbolo interno e helper de opções de selo

Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig` com JSDoc (só abre, nunca sela, mesmo tamanho mínimo de `password`, enxugar a lista após a rotação), sem mudar o tipo de `password`. Criar `kExtraSeal` em `src/utils/internal/session.ts` ao lado de `kLegacySeal` e importá-lo em `session.ts`. Extrair `getSealOptions(config)` (interna, não exportada) e usá-la em `sealSession` e `unsealSession`, sem mudança de comportamento. Não exportar nada novo em `src/index.ts`. Selagem continua só com `config.password` (RF-02).

Cobre: RF-01, RF-02
Depende de: T-01
Aceite: `pnpm typecheck` passa; `pnpm vitest run test/session.test.ts` mantém os testes antigos passando; os casos de RF-01 sem extras e de RF-02 de T-01 passam; `src/index.ts` não ganhou nomes novos.
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`

### T-05 — Abertura em sequência em `unsealSession`

Reescrever o miolo de `unsealSession` como laço sobre `[config.password, ...(config.extraUnsealPasswords ?? [])]` conforme D-02 a D-04: para cada senha, tentar com as opções atuais e, se der `"Bad hmac value"`, tentar o fallback legado de 1 iteração (mantendo as condições `legacySealFallback === false` e iterações já iguais a 1), passando à próxima senha só se o erro final for hmac; demais erros propagam; se todas falharem, relançar o primeiro erro (o da `password`). Marcar `kExtraSeal` quando abrir por senha de índice maior que 0 (inclusive no caso legado, que fica com os dois marcadores). Usar indicador de sucesso separado de `unsealed` para preservar o efeito do `null` retornado por `unseal`. Verificações de `maxAge` e `idleTimeout` ficam após o laço, inalteradas. Cobre cookie simples, chunks e cabeçalho, pois todos chegam como string única.

Cobre: RF-03, RF-04, RF-07, RF-08
Depende de: T-04
Aceite: `pnpm vitest run test/session.test.ts` passa nos casos de RF-03, RF-04 e RF-07 de T-01 e T-02 e nos casos de RF-08 de abertura e de `legacySealFallback: false`; a contagem de derivações confirma que, com `password`, nenhuma extra é tentada.
Arquivos: `src/utils/session.ts`

### T-06 — Re-selagem em `getSession` para sessões abertas por senha extra

Em `getSession`, ler `kExtraSeal` junto com `kLegacySeal` e removê-lo do objeto antes do `Object.assign` (D-05); a condição de re-selagem passa a `(legacySeal || extraSeal || shouldSlide(...))`, mantendo `sessionFromCookie` para excluir o cabeçalho. A re-selagem usa `updateSession`, que sela com `password`. Sessões abertas por `password` não geram `Set-Cookie` ao só ler.

Cobre: RF-05, RF-08
Depende de: T-05
Aceite: `pnpm vitest run test/session.test.ts` passa nos casos de RF-05 (um único `Set-Cookie` que abre com `password` e não com a extra; nenhum para `password` nem para cabeçalho) e no caso de RF-08 em que a sessão legada selada com extra é re-selada com `password` e `sealDefaults`.
Arquivos: `src/utils/session.ts`

### T-07 — Validação das senhas extras ao selar

Implementar `assertExtraPasswords(config, sealOptions)` (D-06): cada item deve ser `string`, não vazio e com `length >= max(encryption.minPasswordlength, integrity.minPasswordlength)`; mensagens ``Invalid session config: extraUnsealPasswords[${i}] password is empty`` e ``... password must be at least ${min} characters``. Chamá-la no topo de `sealSession` (antes de buscar a sessão) e no início de `updateSession` quando for selar (`config.cookie !== false && event.res`), antes de mutar `session.data`. `useSession` sem sessão fica coberto via `updateSession`. `password` inválida continua falhando em `seal()`.

Cobre: RF-06
Depende de: T-04
Aceite: `pnpm vitest run test/session.test.ts` passa em todos os casos de T-03; mensagens casam `/password/i`; erro ocorre em qualquer posição da lista e em pedido sem sessão.
Arquivos: `src/utils/session.ts`

### T-08 — Documentação da rotação de senha

Em `docs/4.examples/handle-session.md`, na seção Options (por volta de `:120-149`), adicionar subseção curta "Rotating the password" com exemplo de `password` nova e `extraUnsealPasswords` com a antiga, explicando: extras só abrem; sessões abertas por extra são re-seladas com `password` mesmo em requisição só de leitura (com a sobreposição já descrita perto de `:183`); extras devem ter o mesmo tamanho mínimo e são validadas ao selar; a lista deve ser enxugada após o período de rotação e mantida curta por causa do custo de PBKDF2. Confirmar a convenção do `CHANGELOG.md` e não editá-lo se for gerado por release.

Cobre: RF-01, RF-06
Depende de: T-06, T-07
Aceite: a subseção existe com exemplo em TypeScript e os quatro avisos acima; `pnpm lint` (oxfmt --check) continua passando para o arquivo de docs.
Arquivos: `docs/4.examples/handle-session.md`

### T-09 — Verificação final de não regressão

Rodar `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run`, corrigir qualquer regressão, e rodar `pnpm fmt` se o formatador apontar diferenças. Conferir que `src/index.ts` não exporta nomes novos e que `iron-crypto.ts`, `cookie.ts` e o tipo de `password` ficaram intactos (D-08). Conferir que `maxAge`, `idleTimeout`, chunks, cabeçalho e `errHeaders` não mudaram de comportamento.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-08
Aceite: os quatro comandos terminam sem erros; `git diff --stat` mostra alterações apenas nos arquivos listados nas tarefas anteriores.
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`, `test/session.test.ts`, `docs/4.examples/handle-session.md`
