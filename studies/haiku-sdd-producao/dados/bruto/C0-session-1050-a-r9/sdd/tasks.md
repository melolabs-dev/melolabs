# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Ordem sugerida: T-01 → T-08. Segue o fluxo do `AGENTS.md`: testes primeiro, confirmar que falham, depois implementar.

### T-01 — Compartilhar a senha nos testes existentes

Extrai uma `const password` no topo do `describeMatrix` de `test/session.test.ts` e a usa em `sessionConfig` e nas chamadas diretas a `seal`/`unseal` (hoje em `:137`, `:157`, `:164`), sem cast e sem mudar as asserções (D-07). Prepara os testes para o alargamento do tipo de `password`.

Cobre: RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` continua passando, com as mesmas asserções de antes; nenhum `as string` novo.
Arquivos: `test/session.test.ts`

### T-02 — Escrever os testes novos de rotação de senha (devem falhar)

Adiciona `describe("password rotation")` ao fim do `describeMatrix`, com `oldPassword` e `newPassword` distintas (≥ 32 caracteres) e sessões antigas geradas com `seal(...)` direto. Casos, conforme a seção 5 da techspec:
- `password: [senha]` de um elemento se comporta como string (RF-01);
- valor selado com `[nova, antiga]` só abre com `nova`; `unseal(valor, antiga)` rejeita `"Bad hmac value"` (RF-02);
- cookie e header `x-h3-test-session` selados com `antiga` abrem com `[nova, antiga]`, mesmo `id` e dados (RF-03);
- cookie selado com `outra` gera sessão nova, sem erro propagado e sem erro em `ctx.errors` (RF-04);
- `password: []` rejeita em `getSession`/`useSession` (mesmo sem cookie) e em `sealSession`, com a mensagem de senha obrigatória (RF-05);
- sessão expirada selada com senha antiga rejeita `"Session expired!"`; seal com `ttl` vencido rejeita `"Expired seal"` sem tentar outras senhas; seal legado (`iterations: 1`) com senha antiga abre e é resselado com `nova`, e com `legacySealFallback: false` é rejeitado (RF-06);
- `useSession` + `session.update` após abrir sessão da `antiga`: o cookie reemitido abre com `nova`, não com `antiga`, e preserva os dados (RF-07);
- `unsealSession`/`sealSession` chamadas direto com `string[]` (RF-07);
- reseal (D-06): cookie antigo emite `Set-Cookie` selado com `nova`; via header não emite; a segunda requisição com o cookie novo não emite reseal extra.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` roda e os casos novos falham antes da implementação (T-03 a T-06), registrando-se o motivo da falha; os testes existentes seguem passando.
Arquivos: `test/session.test.ts`

### T-03 — Tipo público, símbolo interno e helper `resolveSessionPasswords`

- Alarga `SessionConfig.password` para `string | string[]` e reescreve o JSDoc (primeira senha sela, demais só abrem, lista não vazia, cada senha ≥ 32 caracteres, lista curta, remover senhas antigas após a vida útil das sessões, custo de CPU).
- Em `src/utils/internal/session.ts` cria `kStaleSealPassword` (`unique symbol`, `Symbol.for("h3.internal.session.stale-seal-password")`, com `/* @__PURE__ */`) e `resolveSessionPasswords(config): string[]`: `string` → `[password]`; array não vazio → o próprio array; `[]` → `Error("Session password is required: provide at least one password")`. Tipos de retorno explícitos por causa de `isolatedDeclarations`.
- Não exporta nada novo em `src/index.ts` (nenhum nome público novo).

Cobre: RF-01, RF-05, RF-07
Depende de: T-02
Aceite: `pnpm typecheck` passa; `git diff src/index.ts` vazio; `password: "senha"` continua aceito sem mudança de código do usuário; o helper devolve `["senha"]` para string e lança a mensagem acima para `[]`.
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`

### T-04 — Selar somente com a primeira senha

Em `sealSession`, troca `config.password` por `resolveSessionPasswords(config)[0]!`, mantendo `sealDefaults` e `ttl`. Um array vazio falha aqui com o erro explícito, pois `sealSession` é pública.

Cobre: RF-02, RF-05, RF-07
Depende de: T-03
Aceite: os testes de T-02 para RF-02 e para `sealSession` com `string[]` e `[]` passam: o valor selado com `[nova, antiga]` abre com `nova` e não com `antiga`.
Arquivos: `src/utils/session.ts`

### T-05 — Abrir tentando cada senha em ordem (`unsealSession`)

Reescreve a abertura em `unsealSession` conforme D-03:
- move a lógica atual de `try/catch` com fallback legado (iterações atuais; se `"Bad hmac value"` e `legacySealFallback` ligado, 1 iteração PBKDF2 e marca `kLegacySeal`) para uma função local não exportada no fim do arquivo, sem mudar suas regras;
- percorre as senhas em ordem; `"Bad hmac value"` nas duas tentativas avança para a próxima senha; qualquer outro erro (`"Expired seal"`, `"Wrong mac prefix"` etc.) é lançado na hora;
- esgotadas as senhas, relança o erro da última tentativa (com 1 senha, igual ao atual);
- quando a senha que abriu não é a primeira, marca `kStaleSealPassword` no objeto aberto, protegendo o caso de `unseal` devolver `null`;
- mantém as checagens de `maxAge`/`idleTimeout` depois do loop, uma única vez, e chama `resolveSessionPasswords` no início (lista vazia lança).

Cobre: RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: T-03
Aceite: os testes de T-02 para RF-03, RF-04 e RF-06 passam: sessão da `antiga` abre com `[nova, antiga]`; `outra` rejeita `"Bad hmac value"` em `unsealSession`; expirada com senha antiga rejeita `"Session expired!"`; `"Expired seal"` não tenta outras senhas; seal legado com senha antiga abre, e com `legacySealFallback: false` é rejeitado; o caso de senha única mantém o comportamento anterior.
Arquivos: `src/utils/session.ts`

### T-06 — `getSession`: validar lista vazia cedo e resselar com a senha nova

Em `getSession`:
- chama `resolveSessionPasswords(config)` como primeira linha útil, antes de tocar `context.sessions` e fora do `.catch(() => {})` do unseal, para `[]` falhar mesmo sem cookie (D-05); `useSession` herda isso;
- remove a marca `kStaleSealPassword` do resultado (como já faz com `kLegacySeal`) e inclui a condição no reseal: `session.id && sessionFromCookie && (legacySeal || stale || shouldSlide(session, config))` (D-06);
- sessão lida via header não é resselada.

Cobre: RF-03, RF-04, RF-05, RF-07
Depende de: T-05
Aceite: os testes de T-02 passam para `[]` sem cookie, `useSession` + `update` (cookie reemitido abre com `nova` e preserva os dados), reseal por cookie antigo (um `Set-Cookie` com `nova`), ausência de reseal via header e na segunda requisição, e sessão com senha desconhecida virando sessão nova sem erro em `ctx.errors`.
Arquivos: `src/utils/session.ts`

### T-07 — Documentar a rotação de senha

Adiciona a seção curta "Rotating the password" em `docs/4.examples/handle-session.md`, após o bloco de aviso, com o exemplo `password: [novaSenha, senhaAntiga]`: a primeira sela, as demais só abrem; migração automática no próximo acesso por cookie; remover a senha antiga depois da vida útil das sessões; manter a lista curta pelo custo de CPU. Não altera `docs/2.utils/4.security.md` (gerado por automd).

Cobre: RF-01, RF-02, RF-03
Depende de: T-06
Aceite: a seção existe e o exemplo é coerente com a implementação; `pnpm lint` (oxfmt) não aponta problema no arquivo.
Arquivos: `docs/4.examples/handle-session.md`

### T-08 — Verificação final e qualidade

Roda a verificação completa e corrige o que falhar, sem alterar o que os testes existentes verificam. Confere ainda que `src/utils/auth.ts`, `src/types/context.ts`, `src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/bench/session.ts` não foram modificados, e que nenhum nome público novo foi exportado.

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07
Aceite: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` terminam sem falhas; `git status` mostra só os arquivos listados nas tarefas anteriores (mais `sdd/`).
Arquivos: `test/session.test.ts`, `src/utils/session.ts`, `src/utils/internal/session.ts`, `docs/4.examples/handle-session.md`
