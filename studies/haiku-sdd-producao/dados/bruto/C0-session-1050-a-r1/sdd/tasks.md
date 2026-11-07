# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-09). Seguem o fluxo do `AGENTS.md`: testes primeiro, confirmados como falhando, depois a implementação mínima.

### T-01 — Extrair constante `PASSWORD` nos testes existentes

Substituir os usos de `sessionConfig.password` em `seal`/`unseal` por uma constante `PASSWORD` (`"1234567123456712345671234567123456712345671234567"`), usada também em `sessionConfig`. Asserts e opções ficam idênticos, para que o typecheck não quebre quando o tipo virar `string | string[]` (techspec §5).

Cobre: RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` passa com o mesmo número de testes de antes e sem alterar o que cada um verifica; `pnpm typecheck` passa.
Arquivos: `test/session.test.ts`

### T-02 — Escrever os testes novos de rotação de senha (regressão primeiro)

Adicionar ao `describeMatrix` existente (modos `web` e `node`) os casos da tabela do techspec §5, com senhas `NEW`, `OLD` e `OTHER` de 32 caracteres ou mais:
- RF-02: com `[NEW, OLD]`, o cookie criado abre com `NEW` e falha com `OLD`.
- RF-03: cookie selado com `OLD` abre com `[NEW, OLD]` (mesmo `id`/`data`, sem sessão nova), também via header `x-h3-test-session` e com cookie em chunks.
- RF-04: token com `OTHER` gera `id` novo e `data` vazio; token `OLD` com `maxAge` vencido e com `idleTimeout` vencido (fake timers) é rejeitado.
- RF-05: token `OLD` por cookie gera um único `Set-Cookie` que só abre com `NEW`, preservando `id` e `createdAt`; token `NEW` não gera `Set-Cookie`; token `OLD` por header não gera `Set-Cookie`.
- RF-06: token com 1 iteração PBKDF2 e `OLD` abre e é reselado com `NEW` e opções atuais; com `legacySealFallback: false` é rejeitado.
- RF-07: `password: []`, `[""]` e `[123 as any]` fazem `useSession`, `getSession`, `sealSession` e `unsealSession` rejeitar com mensagem contendo "non-empty", inclusive com cookie presente.
- RF-08: token de `"x…"` abre com `["x…"]` e o inverso; lista de um elemento não gera `Set-Cookie` extra.
- RF-01: teste de tipo (em `test/unit/types.test-d.ts` ou no próprio arquivo) de que `SessionConfig` aceita `password: string` e `password: string[]`.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes novos falhando antes de qualquer mudança em `src/` (e o typecheck acusando `string[]`); os testes de RF-08 com string única continuam passando.
Arquivos: `test/session.test.ts`, `test/unit/types.test-d.ts`

### T-03 — Aceitar `string | string[]` em `SessionConfig.password`

Mudar o tipo do campo e reescrever o JSDoc: a primeira senha sela, todas (em ordem) abrem, remover as antigas após o fim de `maxAge`, manter a lista curta (custo PBKDF2), e manter os avisos de mínimo de 32 caracteres e entropia (D-01).

Cobre: RF-01
Depende de: T-01
Aceite: `pnpm typecheck` aceita `password: string` e `password: string[]` em `SessionConfig`; o JSDoc descreve o papel de cada posição e mantém os avisos atuais. Os usos internos de `config.password` ainda não compilam até T-04 a T-07, o que é esperado.
Arquivos: `src/utils/session.ts`

### T-04 — Criar o helper interno `resolvePasswords` e ajustar o comentário de `kLegacySeal`

Em `src/utils/internal/session.ts`, adicionar `resolvePasswords(config)`: string não vazia vira `[string]`; array não vazio com todos os elementos string não vazios vira cópia do array; qualquer outra coisa lança `Error("Session `password` must be a string or a non-empty array of passwords.")`. Não muta a config e não é exportado em `src/index.ts`. Atualizar o comentário de `kLegacySeal` ("seal that must be resealed: legacy options or non-primary password"), sem renomear (D-02, D-03, D-06).

Cobre: RF-07, RF-08
Depende de: T-03
Aceite: `pnpm typecheck` passa para o helper; a mensagem contém "non-empty"; string e lista de um elemento resultam em `[p]`; o objeto de config permanece intacto após a chamada.
Arquivos: `src/utils/internal/session.ts`

### T-05 — Validar a configuração no início de `getSession`

Chamar `resolvePasswords` no início de `getSession`, antes de ler `context.sessions` e fora do `.catch` que engole erros de `unsealSession`, para que a requisição não siga com senha indefinida nem deixe sessão vazia no contexto (D-03). `useSession` e `updateSession` herdam a validação.

Cobre: RF-07
Depende de: T-04
Aceite: com `password: []`, `getSession` e `useSession` rejeitam com a mensagem de `password` inválido, mesmo com cookie presente e mesmo com sessão já em cache; os testes de RF-07 de `getSession`/`useSession` passam.
Arquivos: `src/utils/session.ts`

### T-06 — `sealSession` valida e sela só com a primeira senha

Chamar `resolvePasswords` em `sealSession` e passar `passwords[0]` a `seal`, sem tocar em `iron-crypto.ts` (D-04).

Cobre: RF-02, RF-07, RF-08
Depende de: T-04
Aceite: com `[NEW, OLD]`, o token abre só com `NEW` e falha com `OLD` ("Bad hmac value"); `password: []` rejeita em `sealSession` e `updateSession`; os testes de RF-02 e do RF-07 correspondente passam.
Arquivos: `src/utils/session.ts`

### T-07 — `unsealSession` tenta todas as senhas, em dois passes, e marca reselagem

Criar a função interna `unsealWithAny(sealed, passwords, options)`, que tenta as senhas em ordem, avança só em erro "Bad hmac value", propaga qualquer outro erro (inclusive "Expired seal") e, esgotada a lista, relança o último erro. Em `unsealSession`: validar com `resolvePasswords`; passe 1 com as opções atuais, marcando `kLegacySeal` se `index > 0`; passe 2 (somente se `legacySealFallback !== false`, iterações atuais ≠ 1 e erro "Bad hmac value") com 1 iteração PBKDF2 sobre a lista inteira, marcando sempre `kLegacySeal`. Os checks de `maxAge` e `idleTimeout` continuam depois da abertura (D-05, D-06, D-07, D-08).

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-04
Aceite: `pnpm vitest run test/session.test.ts` passa nos casos de RF-03 (cookie, chunks e header), RF-04 (senha desconhecida, `maxAge` e `idleTimeout` vencidos com senha secundária), RF-05 (`Set-Cookie` único com `NEW`, nenhum para token `NEW` e para header), RF-06 (legado com `OLD`, e rejeição com `legacySealFallback: false`), RF-07 (`unsealSession` com lista inválida) e RF-08; os testes legados antigos seguem passando.
Arquivos: `src/utils/session.ts`

### T-08 — Documentar a rotação de senha

Em `docs/4.examples/handle-session.md`, logo após a nota sobre o header, adicionar a seção "Rotating the password": exemplo `password: [NEW, OLD]`, regra de selar e abrir, reselagem automática, remover a senha antiga após `maxAge`, aviso de custo (lista curta) e de que uma senha antiga comprometida segue aceita enquanto estiver na lista (D-09).

Cobre: RF-09
Depende de: T-07
Aceite: a seção existe, o exemplo é coerente com a API implementada e `pnpm lint` (oxfmt) passa no arquivo; nenhum outro doc foi alterado.
Arquivos: `docs/4.examples/handle-session.md`

### T-09 — Verificação final e custo

Rodar a suíte completa e conferir que há ao menos um teste para cada RF-02 a RF-08. Se possível, rodar `test/bench/session.ts` para confirmar que o caminho de senha única não regride.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-02, T-05, T-06, T-07, T-08
Aceite: `pnpm test` (lint, typecheck e cobertura) passa; a suíte existente passa sem perder asserts; `git status` mostra mudanças só nos arquivos listados nas tarefas anteriores (e `iron-crypto.ts` e `src/index.ts` intactos).
Arquivos: `test/session.test.ts`, `test/bench/session.ts`
