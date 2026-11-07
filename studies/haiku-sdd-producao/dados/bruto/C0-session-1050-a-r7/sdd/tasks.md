# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Seguem o fluxo do AGENTS.md: testes antes da implementação (T-02 e T-03 devem falhar até as tarefas de código terminarem).

### T-01 — Ajustar testes existentes para o tipo alargado

Extrair a senha literal de `sessionConfig` em uma constante local no topo do `describeMatrix` e usá-la nos três pontos que passam `sessionConfig.password` direto a `seal`/`unseal`, que exigem `string` (D-06). Valor, opções de seal e asserções ficam iguais.

Cobre: RF-08
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` passa sem mudança de resultado, e os testes ajustados verificam o mesmo de antes. Depois de T-05, `pnpm typecheck` não acusa erro nesses três pontos.
Arquivos:
- `test/session.test.ts`

### T-02 — Escrever testes de rotação de senha

Criar `describe("password rotation", ...)` dentro do `describeMatrix` existente, com `oldPassword`, `newPassword` e `removedPassword` de 32 ou mais caracteres. Selos antigos gerados com `seal(...)` direto. Cobrir:
- RF-02: sessão nova com `[new, old]` abre com `new` isolada e lança com `old` isolada; repetir após `update()`.
- RF-03: cookie selado com `old`, config `[new, old]`, devolve mesmo `id` e `data`; variante `[new, mid, old]`.
- RF-04: cookie selado com `removed` gera novo `id`, `data` vazio, resposta 200.
- RF-05: `password: []` rejeita em `useSession`, `getSession`, `sealSession` e `unsealSession`, inclusive com cookie presente (prova que o `.catch` não engole o erro); sem `Set-Cookie`.
- RF-06: cookie com `old` gera exatamente um `Set-Cookie` que abre com `new` e não com `old`; cookie com `new` não gera `Set-Cookie`; header de sessão com `old` é aceito sem `Set-Cookie`.
- RF-07: (a) seal legado de 1 iteração com `old`, aceito e re-selado com um só `Set-Cookie`; (b) idem com `legacySealFallback: false`, rejeitado; (c) `maxAge` e `idleTimeout` com `vi.useFakeTimers({ toFake: ["Date"] })`, aceito dentro do prazo e "Session expired!" fora; (d) `seal` customizado com senha antiga; (e) cookie em partes (chunked) selado com senha antiga.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-09
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` roda os testes novos nos modos `web` e `node`. Antes de T-04 e T-05 eles falham (confirmar e registrar); depois passam.
Arquivos:
- `test/session.test.ts`

### T-03 — Escrever teste de tipo para `SessionConfig["password"]`

Adicionar `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` ao arquivo de testes de tipo.

Cobre: RF-01
Depende de: nenhuma
Aceite: antes de T-04 o teste de tipo falha em `pnpm typecheck`; depois passa. Os testes compilam com `password` como `string` e como `string[]` não vazio.
Arquivos:
- `test/unit/types.test-d.ts`

### T-04 — Tipo, helper de senhas, selagem e abertura com lista

Em `src/utils/session.ts`:
- Alterar `SessionConfig.password` para `string | string[]` (D-01).
- Criar o helper local não exportado `resolvePasswords(config)` no fim do arquivo: `[password]` para `string`, o array para lista não vazia, `Error` explícito para `[]` (D-02).
- `sealSession`: chamar o helper e selar com a primeira senha (D-03). `updateSession`, `useSession` e o reseal herdam o comportamento.
- `unsealSession`: chamar o helper e percorrer as senhas em ordem. Para cada uma, tentar `unseal`, aplicar o fallback legado (1 iteração) com essa senha, respeitando `legacySealFallback === false` e `iterations === 1`. Só `"Bad hmac value"` avança para a próxima senha; qualquer outro erro é relançado na hora. Se todas falharem, relançar o erro da primeira senha. A checagem de expiração ("Session expired!") continua depois do laço. Marcar com `kStalePassword` a sessão aberta com senha de índice > 0, com a guarda `if (unsealed)` (D-04, D-05).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-07
Depende de: T-06
Aceite: `pnpm typecheck` passa com `password` nos dois formatos. Os testes de T-02 e T-03 para RF-01 a RF-04, RF-05 (`sealSession` e `unsealSession`) e RF-07 passam. Para senha única, a mensagem de erro de falha de unseal é a mesma de antes.
Arquivos:
- `src/utils/session.ts`

### T-05 — Reseal de sessão aberta com senha antiga e falha cedo em `getSession`

Em `src/utils/session.ts`, em `getSession`:
- Chamar `resolvePasswords(config)` logo depois do retorno antecipado da sessão em cache e antes do bloco `try` de carga, para que `[]` não seja engolido pelo `.catch(() => {})` (D-02).
- Ler e apagar `kStalePassword` junto com `kLegacySeal` antes de copiar o objeto para a sessão.
- Incluir a marca na condição de reseal: `session.id && sessionFromCookie && (legacySeal || stalePassword || shouldSlide(session, config))` (D-05).

Cobre: RF-05, RF-06, RF-07
Depende de: T-04, T-06
Aceite: os testes de T-02 para RF-05 (incluindo requisição com cookie) e RF-06 passam. Sessão aberta com a primeira senha não gera `Set-Cookie` extra, header de sessão não é re-selado, e seal legado com senha antiga gera um único `Set-Cookie`.
Arquivos:
- `src/utils/session.ts`

### T-06 — Símbolo interno `kStalePassword`

Adicionar `export const kStalePassword = Symbol.for("h3.internal.session.stale-password")` ao lado de `kLegacySeal`, no mesmo estilo, e importá-lo em `src/utils/session.ts`. Não exportar em `src/index.ts`.

Cobre: RF-06
Depende de: nenhuma
Aceite: `pnpm typecheck` passa e o símbolo não aparece nos exports públicos de `src/index.ts`.
Arquivos:
- `src/utils/internal/session.ts`
- `src/utils/session.ts`

### T-07 — JSDoc de `password` e documentação de rotação

Reescrever o JSDoc de `password` descrevendo: a lista, a ordem (a primeira sela, as demais só abrem), o fluxo de rotação (`["nova", "antiga"]` e aposentar a antiga depois), o aviso de segurança (senha vazada deve sair da lista), o custo (cada senha extra pode custar uma derivação PBKDF2 em cookie inválido; manter a lista curta) e que a lista vazia é erro. Opcionalmente, acrescentar um parágrafo de rotação em `docs/4.examples/handle-session.md` depois da nota de entropia.

Cobre: RF-09
Depende de: T-04
Aceite: o JSDoc cobre os seis pontos acima. `pnpm lint` passa (oxlint e `oxfmt --check`). Se o parágrafo opcional for feito, o exemplo usa `password: ["nova", "antiga"]` com senhas de 32 ou mais caracteres.
Arquivos:
- `src/utils/session.ts`
- `docs/4.examples/handle-session.md`

### T-08 — Verificação final e nota de versão

Rodar em sequência: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e `pnpm test`. Confirmar que nenhum export novo foi adicionado a `src/index.ts` e que `src/utils/internal/iron-crypto.ts` não mudou. Registrar, na descrição do PR ou nas notas de versão, que código de terceiros que lê `config.password` como `string` passa a ver `string | string[]`.

Cobre: RF-01, RF-08, RF-09
Depende de: T-01, T-02, T-03, T-04, T-05, T-06, T-07
Aceite: todos os comandos acima terminam sem erro, a suíte existente de sessões passa sem perda de verificação, e `git diff --stat` lista apenas os arquivos previstos nas tarefas anteriores.
Arquivos:
- (nenhum; só verificação)

## Matriz de cobertura

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03, T-04, T-08 |
| RF-02 | T-02, T-04 |
| RF-03 | T-02, T-04 |
| RF-04 | T-02, T-04 |
| RF-05 | T-02, T-04, T-05 |
| RF-06 | T-02, T-05, T-06 |
| RF-07 | T-02, T-04, T-05 |
| RF-08 | T-01, T-08 |
| RF-09 | T-02, T-07, T-08 |
