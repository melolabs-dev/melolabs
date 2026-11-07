# Tarefas de implementação — `extraUnsealPasswords`

- Referências: `sdd/prd.md` (RF-01 a RF-13), `sdd/techspec.md` (D-01 a D-09)
- Convenções: código, JSDoc, nomes de teste e docs em inglês; a partir de AGENTS.md, testes com `describeMatrix` (web e node), `pnpm` para tudo.
- Fluxo: testes antes da implementação (AGENTS.md, "Bug Fix Workflow" adaptado). Tarefas que editam o mesmo arquivo estão encadeadas.

Ordem sugerida: T-01 → T-02 → T-03 → T-04 (testes em vermelho) → T-05 → T-06 (helpers) → T-07 → T-08 (integração) → T-09 (docs) → T-10 (verificação final).

---

### T-01 — Campo público `extraUnsealPasswords` em `SessionConfig`

- **Cobre:** RF-01
- **Depende de:** nenhuma
- **Aceite:** `SessionConfig` ganha `extraUnsealPasswords?: string[]` logo após `password`, com o JSDoc do contrato em `sdd/techspec.md`. `password` continua `string` e obrigatória. `pnpm typecheck` passa. `src/index.ts` e `test/unit/package.test.ts` ficam sem alteração e o teste de exports continua passando.
- **Arquivos:** `src/utils/session.ts`

### T-02 — Testes de ordem, abertura e rejeição por senha extra

- **Cobre:** RF-02, RF-03, RF-04, RF-05, RF-11
- **Depende de:** T-01
- **Aceite:** novo `describe("extraUnsealPasswords")` dentro do `describeMatrix` em `test/session.test.ts` com os casos da tabela da techspec para RF-02 (ordem e não-derivação, contagem de `deriveBits` confirmada rodando o teste), RF-03 (cookie e header), RF-04 (senha não listada) e RF-05 (expirada aberta por extra). Antes da implementação, os casos de abertura por extra e de expiração falham; o caso de senha não listada já passa e serve de regressão. Os casos aparecem para `web` e `node`. Nenhuma asserção existente é alterada.
- **Arquivos:** `test/session.test.ts`

### T-03 — Testes de releitura de cookie e de selagem

- **Cobre:** RF-06, RF-07, RF-11
- **Depende de:** T-02 (mesmo arquivo de teste)
- **Aceite:** casos no mesmo `describe` de T-02 para: cookie aberto por extra recebe `Set-Cookie` e abre com só `password` depois (RF-06); cookie selado com a senha atual não recebe `Set-Cookie` extra (RF-06); sessão de header aberta por extra não recebe `Set-Cookie` e continua abrindo enquanto a extra estiver listada (RF-06); `updateSession` após leitura por extra grava cookie que abre com `password` e lança `Bad hmac value` com a extra (RF-07). Os casos de RF-06 com releitura falham antes da implementação. Aparecem para `web` e `node`.
- **Arquivos:** `test/session.test.ts`

### T-04 — Testes de validação de senha extra e de fallback legado

- **Cobre:** RF-08, RF-09, RF-11
- **Depende de:** T-03 (mesmo arquivo de teste)
- **Aceite:** casos no mesmo `describe`: `extraUnsealPasswords: ["curta"]` faz `getSession` e `useSession` rejeitarem com mensagem contendo `too short`, com e sem cookie (RF-08); extra entre o mínimo de `encryption` e o de `integrity` (configurados com `seal.integrity.minPasswordlength` maior) é rejeitada com `too short` (RF-08, D-06); sessão legada de 1 iteração selada com a extra é aberta e resselada (RF-09); com `legacySealFallback: false` a mesma leitura não abre a sessão (RF-09). Antes da implementação, os casos de rejeição e de legado falham. Aparecem para `web` e `node`.
- **Arquivos:** `test/session.test.ts`

### T-05 — Helper de validação `assertExtraUnsealPasswords`

- **Cobre:** RF-08
- **Depende de:** T-01 (tipo `SessionConfig`)
- **Aceite:** novo `src/utils/internal/session-unseal.ts` exporta `assertExtraUnsealPasswords(config)`. O mínimo é `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`, com `sealOptions` calculado como em `unsealSession` (sem `ttl`). Para cada extra com `length < min`, lança `Error` com a mensagem `Password string too short (min N characters required)`. Nada desse arquivo é exportado por `src/index.ts`. `pnpm typecheck` e `pnpm lint` passam. Comportamento verificado pelos casos de T-04 após T-08.
- **Arquivos:** `src/utils/internal/session-unseal.ts` (novo)

### T-06 — Helper `unsealWithPasswords` com tentativa por candidata e fallback legado

- **Cobre:** RF-02, RF-09
- **Depende de:** T-05 (mesmo arquivo)
- **Aceite:** `unsealWithPasswords(sealed, primary, extra, sealOptions, legacySealFallback)` retorna `{ unsealed, legacy, fromExtra }`. Tenta `primary` e depois cada extra, na ordem do array. Só repete quando o erro é exatamente `Bad hmac value`; qualquer outro erro é relançado na hora. Para cada candidata, o fallback de 1 iteração roda só se `legacySealFallback` estiver ativo e `integrity.iterations !== 1` (D-03). Se todas falharem, relança o último erro. Com `extra` vazio há exatamente uma tentativa. `pnpm typecheck` e `pnpm lint` passam. Comportamento verificado pelos casos de T-02 e T-04 após T-07.
- **Arquivos:** `src/utils/internal/session-unseal.ts`

### T-07 — Integrar `unsealSession` com as senhas extras

- **Cobre:** RF-02, RF-03, RF-04, RF-05, RF-07, RF-09
- **Depende de:** T-02, T-04, T-06
- **Aceite:** em `src/utils/internal/session.ts` existe `kExtraPasswordSeal` com o mesmo padrão de `kLegacySeal` (`Symbol.for`, `unique symbol`). `unsealSession` chama `unsealWithPasswords` no lugar do `try/catch` atual, mantém a assinatura pública, marca `kExtraPasswordSeal` quando `fromExtra` e mantém as checagens de `maxAge` e `idleTimeout` sem mudança. `sealSession` e `updateSession` não mudam (`git diff` nessas funções vazio). Os casos de T-02 passam em `web` e `node`, exceto os de releitura de T-03 e de validação de T-04, que dependem de T-08. Nenhum caso já existente falha.
- **Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

### T-08 — Integrar `getSession`: validação antes da leitura e releitura de cookie

- **Cobre:** RF-06, RF-08
- **Depende de:** T-03, T-04, T-05, T-07
- **Aceite:** `getSession` chama `assertExtraUnsealPasswords(config)` como primeira instrução, antes de ler o contexto, cabeçalho ou cookie. O `.catch` existente continua engolindo só falhas de unseal, e a validação roda antes dele. O símbolo `kExtraPasswordSeal` é lido e removido do objeto antes de `Object.assign`. A condição de releitura ganha o termo `extraSeal` (D-08). Os casos de T-03 (RF-06) e T-04 (RF-08) passam em `web` e `node`. Nenhum caso existente falha.
- **Arquivos:** `src/utils/session.ts`

### T-09 — Documentação da rotação com `extraUnsealPasswords`

- **Cobre:** RF-12
- **Depende de:** T-01 (JSDoc entra pelo automd), T-08 (comportamento final)
- **Aceite:** em `docs/2.utils/4.security.md`, prosa em inglês entre `<!-- /automd -->` e `## Fingerprint`, com: a senha extra só abre sessões; a selagem continua com `password`; sessões de cookie migram na próxima leitura; sessões de header não migram e expiram normalmente; procedimento em três passos (nova senha vira `password`, antiga vai para `extraUnsealPasswords`, retirar a antiga após a janela de migração). O procedimento não fica dentro do bloco automd. Depois de `pnpm fmt`, `git diff docs/` mostra só a prosa nova.
- **Arquivos:** `docs/2.utils/4.security.md`

### T-10 — Verificação final: suíte, lint, typecheck e regressão de API

- **Cobre:** RF-10, RF-11, RF-13
- **Depende de:** T-08, T-09
- **Aceite:** `pnpm vitest run test/session.test.ts test/unit/` passa. `git diff test/session.test.ts` mostra só adições (nenhuma asserção existente removida ou enfraquecida). `pnpm lint` e `pnpm typecheck` terminam com código 0. `pnpm test` completo passa, se o tempo permitir. `git diff` vazio em `src/index.ts`, `test/unit/package.test.ts` e `src/utils/internal/iron-crypto.ts`. O número de linhas de `session.ts` é reportado; acima de 200 é aceito por D-04 e fica registrado.
- **Arquivos:** nenhum (somente verificação)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-01 |
| RF-02 | T-02, T-06, T-07 |
| RF-03 | T-02, T-07 |
| RF-04 | T-02, T-07 |
| RF-05 | T-02, T-07 |
| RF-06 | T-03, T-08 |
| RF-07 | T-03, T-07 |
| RF-08 | T-04, T-05, T-08 |
| RF-09 | T-04, T-06, T-07 |
| RF-10 | T-10 |
| RF-11 | T-02, T-03, T-04, T-10 |
| RF-12 | T-09 |
| RF-13 | T-05, T-06, T-10 |

## Pendências para quem decide o produto

- **P-05 / RF-06 (migração por releitura de cookie):** assumida no PRD. Se não for desejada, retirar T-08 (termo `extraSeal`), os casos de releitura de T-03 e o passo 1 do procedimento em T-09 deixam de se aplicar.
- **R-01 (limite de extras):** a techspec não impõe limite máximo de senhas extras. Definir se é preciso um teto (por exemplo, 4) antes de T-07.
