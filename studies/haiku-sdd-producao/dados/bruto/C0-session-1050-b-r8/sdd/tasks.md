# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Baseadas em `sdd/prd.md` e `sdd/techspec.md`. Seguem o fluxo de bug fix do AGENTS.md: o campo de tipo entra primeiro, os testes são escritos e confirmados como falhando (T-02) e só então a implementação (T-03 e T-04).

### T-01 — Adicionar `extraUnsealPasswords` ao `SessionConfig`

Adicionar `extraUnsealPasswords?: string[]` logo após `password` em `SessionConfig`, com JSDoc: só abre sessões e nunca sela, é tentado em ordem depois de `password`, a sessão aberta com ele é reselada com `password`, a lista deve ser curta, e as entradas devem ter pelo menos 32 caracteres e ser removidas depois de `maxAge`. Não criar nenhum outro nome público e não mexer em `src/index.ts`, que já reexporta o tipo.

- **Cobre:** RF-01
- **Depende de:** nenhuma
- **Aceite:** `pnpm typecheck` passa com uma config com `password` e `extraUnsealPasswords: ["antiga"]` e com uma config sem o campo. `rg extraUnsealPasswords src` só encontra `src/utils/session.ts`. O comportamento em tempo de execução continua inalterado.
- **Arquivos:** `src/utils/session.ts`

### T-02 — Escrever os testes de regressão de rotação de senha

Dentro de `describeMatrix("session")`, após os testes de selo legado, adicionar os casos da seção 6 do techspec. Usar `seal` com `sealDefaults` e uma segunda senha de 32 ou mais caracteres:

- O cookie criado com `password: "nova"` e `extraUnsealPasswords: ["antiga"]` abre com `nova` e não abre só com `antiga`.
- Um cookie selado com `antiga` preserva `id` e `data`.
- Um cookie selado com `outra` gera `id` diferente e `data` vazio.
- Um selo expirado com extras configuradas gera sessão nova, e `vi.spyOn(crypto.subtle, "deriveBits")` registra 0 chamadas.
- Um cookie com `antiga` gera um único `Set-Cookie` que abre com `nova` e preserva `id` e `data`. Depois de remover `antiga` da config, o novo cookie continua válido.
- Com duas extras, uma sessão selada com a segunda abre.
- Um selo legado de 1 iteração com `antiga` é aceito e reselado com `nova` quando `legacySealFallback` é omitido, e é rejeitado com uma sessão nova quando `legacySealFallback: false`.
- Uma sessão lida por `sessionHeader` e selada com `antiga` é aceita, sem `Set-Cookie` de resselagem.
- Um caso explícito com `extraUnsealPasswords: []` mantém o comportamento atual.

- **Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08
- **Depende de:** T-01
- **Aceite:** `pnpm vitest run test/session.test.ts` roda os novos testes em web e node. Antes de T-03 e T-04, os testes de RF-03, RF-05, RF-06 e do header **falham**, e isso é registrado. Os testes de RF-02, de RF-04 e do caso `[]` já passam, porque descrevem comportamento que não muda. Os testes existentes continuam passando.
- **Arquivos:** `test/session.test.ts`

### T-03 — Implementar a tentativa com senhas extras em `unsealSession`

Criar o helper interno não exportado `unsealWithPassword(sealed, password, config, sealOptions)` no fim de `session.ts`:

- Ele tenta `unseal` no modo atual.
- Se o erro for `Bad hmac value` e valer a condição do fallback legado, tenta com 1 iteração e marca `kLegacySeal`.
- Qualquer outro erro é relançado.

Em `unsealSession`, substituir o `try/catch` atual por um laço sobre `[config.password, ...(config.extraUnsealPasswords || [])]`:

- Só `Bad hmac value` avança para a próxima senha.
- Outros erros são relançados imediatamente (D-05).
- Se todas falharem, relançar o erro da primeira tentativa.
- Marcar `kLegacySeal` quando a sessão abrir com uma senha extra (índice maior que 0).
- Manter as checagens de `maxAge` e `idleTimeout` intactas.

`sealSession` e `updateSession` não podem ler o novo campo.

- **Cobre:** RF-02, RF-03, RF-04, RF-06, RF-07
- **Depende de:** T-01, T-02
- **Aceite:** Os testes de RF-03, RF-04 e RF-06 de T-02 passam. Com `legacySealFallback: false` nenhuma senha é testada no modo legado. Selo expirado com extras faz 0 chamadas a `deriveBits`. Sem o campo, ou com `[]`, os erros e as saídas são idênticos aos atuais, e o resto de `test/session.test.ts` continua verde.
- **Arquivos:** `src/utils/session.ts`

### T-04 — Resselar com `password` sessões abertas com senha extra

Em `getSession`, a lógica existente de `kLegacySeal` já apaga o marcador e chama `updateSession` quando `sessionFromCookie`. Não mudar essa lógica. Ajustar só os comentários em `getSession` e no helper, para dizer que o marcador significa "selo que precisa ser reselado com `password` e as opções atuais", cobrindo selo legado e senha extra. Não criar símbolo novo nem exportar o marcador. Confirmar que a sessão lida por header continua sem resselagem.

- **Cobre:** RF-05, RF-07
- **Depende de:** T-03
- **Aceite:** Os testes de resselagem de T-02 passam. O `Set-Cookie` único abre com `password`, preserva `id` e `data`, e continua válido depois de remover a senha antiga da config. Pela sessão via header não sai `Set-Cookie`. `src/index.ts` não ganha exports novos, e `pnpm vitest run test/unit/package.test.ts` passa.
- **Arquivos:** `src/utils/session.ts`

### T-05 — Verificação final e prova de regressão

- Rodar `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck` e a suíte completa (`pnpm test`).
- Provar que os testes de rotação são reais: reverter temporariamente a implementação (T-03 e T-04), confirmar que eles falham e restaurar.
- Confirmar que nenhum arquivo fora de `src/utils/session.ts` e `test/session.test.ts` foi alterado, incluindo `iron-crypto.ts`, `internal/session.ts`, `src/index.ts` e `docs/`.

- **Cobre:** RF-07, RF-08
- **Depende de:** T-03, T-04
- **Aceite:** Todos os comandos passam, nenhum teste existente perdeu verificação e `git status` lista só os dois arquivos acima, além de `sdd/`. A falha dos testes de rotação com a implementação revertida está registrada.
- **Arquivos:** `src/utils/session.ts`, `test/session.test.ts`
