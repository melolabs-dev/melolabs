# Tarefas — Várias senhas de unseal nas sessões (`extraUnsealPasswords`)

Referência: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md` (D-01 a D-08, R-01 a R-06). Fluxo: testes primeiro (devem falhar), depois a implementação, depois documentação e gates finais.

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig` (tipo e TSDoc)

Acrescentar `extraUnsealPasswords?: string[]` à interface `SessionConfig`, logo após `password`, com TSDoc: senhas anteriores, só abrem sessões (nunca selam), mesmo mínimo de 32 caracteres e mesma exigência de entropia de `password`, tentadas na ordem da lista (mais recentes primeiro), lista curta e a ser esvaziada depois da janela de rotação. `password` continua `string`. Nenhum export novo em `src/index.ts`.

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` passa com uma configuração `{ password, extraUnsealPasswords: [antiga] }`; `password: ["x"]` continua sendo erro de tipo; `test/unit/package.test.ts` (lista de exports) segue passando sem alteração.
Arquivos: `src/utils/session.ts`

### T-02 — Escrever os testes novos de sessão (antes da implementação)

Em `test/session.test.ts`, num novo bloco dentro de `describeMatrix("session", ...)` (depois do teste de seal legado, cerca da linha 186), escrever os testes da seção 5 do techspec, fabricando cookies com `seal`/`unseal` de `iron-crypto.ts` e usando um `name` próprio por teste:

- RF-02: sessão selada com A, config `password: B, extraUnsealPasswords: [A]` mantém `id`, `createdAt` e `data` sem criar sessão nova; `unsealSession` direta abre com extra; ordem com `[A1, A2]` e sessão selada com A2.
- RF-03: selada com C é descartada e gera novo `id`.
- RF-04: token de `sealSession` e de `updateSession` abre com B e não abre com A (via `unseal` direto).
- RF-05: cookie selado com A gera `Set-Cookie` selado por B (abre só com B) com o mesmo `id`; sessão vinda de header não é resselada.
- RF-06: `maxAge` e `idleTimeout` expirados com seal por A são rejeitados e substituídos.
- RF-07: seal legado (1 iteração) com A e `legacySealFallback` indefinido carrega e reressela com B e iterações atuais; com `legacySealFallback: false` é rejeitado.
- RF-08: `extraUnsealPasswords: []` e ausente mantêm a rejeição de sessão selada com outra senha.
- D-04: extra curta ou vazia na lista não derruba a sessão selada com a extra válida seguinte.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` roda em `web` e `node`. Sem a implementação (T-03 e T-04), falham no mínimo os testes de RF-02, RF-05, RF-07 (caso com fallback ligado) e D-04; os de RF-03, RF-04, RF-06, RF-07 (`legacySealFallback: false`) e RF-08 passam como guardas de regressão. Registrar a saída da execução com as falhas.
Arquivos: `test/session.test.ts`

### T-03 — Extrair `unsealWith` e `unsealPasswords` sem mudar o comportamento

Refatoração preparatória em `src/utils/session.ts`: mover o trecho atual `unseal` + retry legado de `unsealSession` para o helper interno `unsealWith(sealed, password, config, sealOptions)`, que devolve a sessão (com `kLegacySeal` se o seal era legado) ou lança. Criar `unsealPasswords(config)` no fim do arquivo, retornando `[config.password, ...(config.extraUnsealPasswords ?? [])]`. `unsealSession` chama `unsealWith` só com a primeira senha por enquanto, e `maxAge`/`idleTimeout` ficam inalterados e rodam só depois do sucesso. Helpers internos ficam no fim do arquivo, sem exports novos.

Cobre: RF-08
Depende de: T-01
Aceite: `pnpm vitest run test/session.test.ts` mantém todos os testes existentes passando e os testes novos de T-02 continuam falhando só onde se espera (a refatoração não muda o comportamento); `pnpm lint` passa.
Arquivos: `src/utils/session.ts`

### T-04 — Loop de tentativas, distinção de erro e marcador de resselagem

Em `unsealSession`, percorrer `unsealPasswords(config)` na ordem; a primeira que abrir vale. Implementar `isPasswordMismatch(error, isExtra)`: passa para a próxima senha apenas em `"Bad hmac value"` (para `password` e extras) e, só para as extras, também em `"Empty password"` e `"Password string too short"`. Erros independentes da senha (`Wrong mac prefix`, `Incorrect number of sealed components`, `Expired seal`, `Invalid expiration`) são relançados na hora. Guardar o primeiro erro e, esgotadas as senhas, relançá-lo (o da `password`), para que sem extras a saída seja a de hoje. Quando a senha que abriu não é a primeira, marcar `kLegacySeal` no resultado (resselagem proativa; vale também para extra + seal legado, pois `unsealWith` aplica o fallback de 1 iteração por senha e respeita `legacySealFallback: false` e `iterations === 1`). Aplicar `maxAge`/`idleTimeout` só depois do sucesso, para qualquer senha. Não alterar `sealSession`, `updateSession` nem `iron-crypto.ts`.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
Depende de: T-03
Aceite: `pnpm vitest run test/session.test.ts` passa por inteiro, incluindo todos os testes de T-02 (os que falhavam passam agora); sem extras o erro lançado e a saída são os mesmos de antes; `pnpm lint` e `pnpm typecheck` passam.
Arquivos: `src/utils/session.ts`

### T-05 — Atualizar comentários do marcador de resselagem

Ajustar o comentário da resselagem em `getSession` (cerca de `src/utils/session.ts:210-213`) para citar "seal legado ou senha extra", e o comentário de `kLegacySeal` em `src/utils/internal/session.ts` para o novo significado ("aberta com algo diferente do seal atual"). Somente comentários; sem renomear símbolos.

Cobre: RF-05, RF-07
Depende de: T-04
Aceite: o diff dessa tarefa contém só linhas de comentário; `pnpm lint` passa e `pnpm vitest run test/session.test.ts` segue passando.
Arquivos: `src/utils/session.ts`, `src/utils/internal/session.ts`

### T-06 — Documentação da rotação de senha

Em `docs/4.examples/handle-session.md`, perto da nota sobre a entropia da `password`, acrescentar o parágrafo curto "Rotating the password" com exemplo de `extraUnsealPasswords`. Deve avisar: extras só abrem sessões (a selagem usa sempre `password`); manter a lista curta (custo de PBKDF2 por tentativa); manter apenas senhas ainda confiáveis; sessões lidas por header não são resseladas e dependem da senha extra até expirarem. Se `pnpm fmt`/automd regenerar o trecho, não editar à mão a parte gerada.

Cobre: RF-01
Depende de: T-04
Aceite: a página contém a seção com o exemplo; `pnpm fmt` não gera diff adicional inesperado; `pnpm lint` passa.
Arquivos: `docs/4.examples/handle-session.md`

### T-07 — Verificação final e gates

Rodar `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`, e depois `pnpm test` (suíte completa) para checar regressões. Conferir que `src/utils/internal/iron-crypto.ts`, `src/index.ts` e `test/unit/package.test.ts` não foram alterados e que os testes existentes de sessão passam sem perda de cobertura. Confirmar o registro de T-02 (RF-02, RF-05 e RF-07 falhavam antes da implementação).

Cobre: RF-08, RF-09
Depende de: T-02, T-04, T-05, T-06
Aceite: os quatro comandos terminam sem erro; `git status` lista só os arquivos previstos nas tarefas anteriores.
Arquivos: nenhum (somente verificação)
