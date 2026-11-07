# Tarefas — `extraUnsealPasswords` nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` e `sdd/techspec.md`. Seguir o fluxo de correção do AGENTS.md: os testes (T-02 a T-05) são escritos e vistos falhando antes da implementação (T-06 a T-08). Nenhum nome público novo além de `SessionConfig.extraUnsealPasswords`.

### T-01 — Tipo `extraUnsealPasswords` em `SessionConfig` e teste de tipo

Adicionar `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig`, com JSDoc (D-01): só abre sessões; `password` é a única que sela; mesma exigência de entropia (≥ 32 caracteres); ordem = ordem de tentativa, mais recente primeiro; custo de uma derivação PBKDF2 por senha extra em cookie inválido. Adicionar teste de tipo: `string[]` e ausência compilam; `extraUnsealPasswords: "x"` é erro (`@ts-expect-error`).

Cobre: RF-01, RF-08
Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa com as duas formas de configuração e o `@ts-expect-error` do valor inválido é consumido; `test/unit/package.test.ts` não muda (nenhum export novo).

### T-02 — Testes de abertura por senha anterior e de selo apenas com `password`

Em `test/session.test.ts` (após a linha 186), criar `describe("password rotation")` dentro de `describeMatrix`, com helpers locais (senhas distintas de ≥ 32 caracteres A, A2, B; `sealWith(password, payload, opts?)` usando `seal` e `sealDefaults`; rotas próprias com `name` próprio). Cobrir:

- RF-02: cookie selado com A e config `{password: B, extraUnsealPasswords: [A]}` mantém `id`, `createdAt` e `data`; o mesmo via header `x-<name>-session`; o mesmo com cookie em chunks (`cookie.chunkMaxLength` pequeno); com `[A1, A2]`, selo com a segunda extra abre; a ordem de tentativa é respeitada.
- RF-03: após `updateSession`/`sealSession` com `{password: B, extra: [A]}`, `unseal(sealed, B)` abre e `unseal(sealed, A)` rejeita com `Bad hmac value`.

Cobre: RF-02, RF-03, RF-08
Arquivos: `test/session.test.ts`
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes de RF-02 falhando antes da implementação (T-06) e passando depois, em `web` e `node`; os de RF-03 passam desde o início (selo já usa só `password`) e servem de garantia.

### T-03 — Testes de resselo e de sessões abertas com `password`

No mesmo `describe("password rotation")`, cobrir:

- RF-04: cookie com A ⇒ resposta com 1 `Set-Cookie` que abre com B e preserva `id`/`createdAt`/`data`; segunda requisição com o novo cookie e `extraUnsealPasswords` ausente e `[]` continua autenticada; `Object.getOwnPropertySymbols` de `session` e de `session.data` vazio (marcador não vaza); sessão do header não é resselada (`getSetCookie()` vazio).
- RF-05: selo com `password` e `extraUnsealPasswords` ausente, `[]` e preenchido ⇒ sessão carregada, `getSetCookie()` com tamanho 0 e spy confirma uma única chamada a `unseal`.

Cobre: RF-04, RF-05, RF-08
Arquivos: `test/session.test.ts`
Depende de: T-02
Aceite: `pnpm vitest run test/session.test.ts` mostra os testes de RF-04 falhando antes de T-07 e passando depois; os de RF-05 passam antes e depois da mudança.

### T-04 — Testes de senha não configurada, expiração, integridade e selo legado

No mesmo `describe("password rotation")`, cobrir:

- RF-06: selo com A fora de `password` e de `extraUnsealPasswords` (e também com `[]`) ⇒ `getSession` devolve sessão nova com `id` diferente e `data` `{}`, via cookie e via header.
- RF-07: com `vi.useFakeTimers({ toFake: ["Date"] })` (padrão de `:189-190`), sessão com A vencida por `maxAge` e por `idleTimeout` é rejeitada; HMAC adulterado (último segmento) com A e com B é rejeitado; selo com `ttl` expirado é rejeitado sem tentar extras; legado (1 iteração) selado com A abre e é resselado com B e iterações atuais (`unseal(resealed, B, sealDefaults)` passa); `legacySealFallback: false` com legado de A é rejeitado.

Cobre: RF-06, RF-07, RF-08
Arquivos: `test/session.test.ts`
Depende de: T-02
Aceite: `pnpm vitest run test/session.test.ts` passa com todos os casos; os casos que dependem da abertura por extra (legado com A) falham antes de T-06/T-07 e passam depois; os de rejeição passam antes e depois.

### T-05 — Confirmar a suíte vermelha antes de implementar

Rodar `pnpm vitest run test/session.test.ts` com T-01 a T-04 prontos e sem alterar `src/utils/session.ts` além do tipo. Registrar quais testes falham e conferir que o motivo é o comportamento ausente (e não erro de teste). Não enfraquecer testes existentes.

Cobre: RF-08
Arquivos: `test/session.test.ts`
Depende de: T-02, T-03, T-04
Aceite: os testes novos de RF-02, RF-04 e legado-com-extra falham pelo motivo esperado; os demais e a suíte existente passam.

### T-06 — Símbolo interno `kRotatedSeal` e abertura com várias senhas em `unsealSession`

Em `src/utils/internal/session.ts` (ao lado de `kLegacySeal`), criar `kRotatedSeal = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal")`, sem reexport. Em `src/utils/session.ts`, importar o símbolo e extrair o helper interno `unsealWithPassword(sealed, password, config, sealOptions)` (tentativa normal + fallback legado, marcando `kLegacySeal`), ao final do arquivo e sem export. Em `unsealSession`, iterar `[config.password, ...(config.extraUnsealPasswords || [])]`: continuar só em erro `Bad hmac value`; relançar imediatamente qualquer outro erro; ao esgotar por HMAC, relançar o primeiro erro (o da `password`); marcar `kRotatedSeal` quando o índice vencedor for > 0. Validação de `maxAge`/`idleTimeout` permanece depois do loop, inalterada. Sem lista (ausente ou `[]`), há um único candidato e o fluxo é idêntico ao atual. Não alterar `iron-crypto`, `sealSession` nem `src/index.ts`.

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07
Arquivos: `src/utils/internal/session.ts`, `src/utils/session.ts`
Depende de: T-05
Aceite: `pnpm vitest run test/session.test.ts` — passam os testes de RF-02, RF-06 e RF-07 (abertura, rejeição, expiração, HMAC, legado); a mensagem de erro do caminho sem extras é a mesma de antes; `sealSession`/`updateSession` continuam selando só com `config.password` (RF-03).

### T-07 — Resselo em `getSession` para sessões de cookie abertas por senha extra

Em `getSession` (`src/utils/session.ts`), ler e apagar `kLegacySeal` e `kRotatedSeal` **antes** do `Object.assign(session, unsealed)`, para que nenhum marcador vaze para `session` nem para `data`. Incluir `rotatedSeal` na condição de resselo: `session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))`. Sessão do header (`sessionFromCookie = false`) não é resselada. Um único resselo quando houver `kLegacySeal` e `kRotatedSeal` juntos.

Cobre: RF-04, RF-05, RF-07
Arquivos: `src/utils/session.ts`
Depende de: T-06
Aceite: `pnpm vitest run test/session.test.ts` — passam os testes de RF-04 (um `Set-Cookie` que abre com B, `id`/`createdAt`/`data` preservados, sem símbolos em `session`/`data`, header sem resselo) e de RF-05 (sem `Set-Cookie` extra); o caso legado selado com A é resselado com B e iterações atuais.

### T-08 — Guia de sessões: rotação de senhas

Em `docs/4.examples/handle-session.md`, adicionar a seção "Rotate the Password" depois de "Expiration" e antes de "Use Multiple Sessions", com o passo a passo (mover a senha antiga para `extraUnsealPasswords`, definir a nova em `password`, retirar a antiga depois que as sessões migraram) e um exemplo de código. Incluir notas: a lista é tentada em ordem (mais recente primeiro); sessões de cookie migram sozinhas por resselo; sessões do header não são resseladas e seguem abrindo com a senha antiga enquanto ela estiver na lista; cada senha extra custa uma derivação PBKDF2 em cookie inválido (manter a lista curta); senha antiga comprometida continua abrindo sessões enquanto estiver na lista; mesmas exigências de entropia de `password`.

Cobre: RF-08
Arquivos: `docs/4.examples/handle-session.md`
Depende de: T-06, T-07
Aceite: a seção existe com exemplo de rotação descrevendo `extraUnsealPasswords`, e `pnpm lint` (oxfmt) passa no arquivo.

### T-09 — Regenerar docs automd e validar tudo

Rodar `pnpm fmt` para regenerar `docs/2.utils/4.security.md` a partir dos JSDoc (não editar à mão) e conferir o diff: manter só o trecho de `extraUnsealPasswords` e reverter mudanças não relacionadas. Rodar a verificação final: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test`. Confirmar que testes existentes só foram ajustados no que a mudança altera, sem perder o que verificam.

Cobre: RF-01, RF-08
Arquivos: `docs/2.utils/4.security.md`
Depende de: T-01, T-07, T-08
Aceite: `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` passam; existe ao menos um teste para cada RF-02 a RF-07; `docs/2.utils/4.security.md` descreve `extraUnsealPasswords` sem diff espúrio.

## Cobertura dos requisitos

| RF    | Tarefas                 |
| ----- | ----------------------- |
| RF-01 | T-01, T-09              |
| RF-02 | T-02, T-06              |
| RF-03 | T-02, T-06              |
| RF-04 | T-03, T-07              |
| RF-05 | T-03, T-06, T-07        |
| RF-06 | T-04, T-06              |
| RF-07 | T-04, T-06, T-07        |
| RF-08 | T-01 a T-05, T-08, T-09 |
