# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Origem: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-06).

Ordem sugerida: T-01 e T-02 em paralelo; depois T-03; depois T-04; por último T-05.

Cobertura dos requisitos:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-04 |
| RF-02 | T-02, T-03 |
| RF-03 | T-02, T-04 |
| RF-04 | T-02, T-04, T-05 |
| RF-05 | T-02, T-04 |
| RF-06 | T-01, T-02, T-03 |
| RF-07 | T-02, T-04 |

---

### T-01 — Extrair `assertPasswordLength` para `iron-crypto.ts`

Extrair a checagem de tamanho de `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`) para uma função exportada `assertPasswordLength(password, minPasswordlength)` no mesmo arquivo. `generateKey` passa a chamá-la. A mensagem de erro não muda (`"Password string too short (min 32 characters required)"`). Adicionar um caso unitário próximo de `test/unit/iron-crypto.test.ts:121-125` cobrindo: lança a mesma mensagem para senha curta; não lança para senha de tamanho exato.

Cobre: RF-06
Depende de: nenhuma
Aceite: `pnpm vitest run test/unit/iron-crypto.test.ts` passa, incluindo o caso novo. O teste existente de `generateKey` continua passando sem alteração.
Arquivos: `src/utils/internal/iron-crypto.ts`, `test/unit/iron-crypto.test.ts`

---

### T-02 — Escrever os testes de integração das senhas extras (antes da implementação)

Adicionar em `test/session.test.ts`, dentro de `describeMatrix("session", ...)`, um teste por caso abaixo, cada um com config própria (`{ ...sessionConfig, extraUnsealPasswords: [...] }`) e rota dedicada, seguindo o padrão de `t.app.all(...)` com header `Cookie` já usado em `:134-186`. Senhas de teste com pelo menos 32 caracteres. Nenhum teste existente é removido ou alterado.

- RF-01: cookie selado com `B` é lido por `useSession` com `password = A` e `extraUnsealPasswords = [B]`; `session.data` vem preenchido.
- RF-02: após `update`, o `Set-Cookie` abre com `A` (`unseal(..., A, sealDefaults)` resolve) e não abre com `B` (`rejects`).
- RF-03 (ordem): cookie com `B` e lista `[B, C]` abre com `B`.
- RF-03 (repetida): `password = A` e `extraUnsealPasswords = [A]`; sessão aberta sem erro.
- RF-04: cookie selado com senha desconhecida, sem extras, resulta em sessão nova (teste novo; os existentes não mudam).
- RF-05: cookie com `C` (fora da lista) gera sessão nova, com `data` vazio e `id` diferente.
- RF-06: extra `""` e extra com 31 caracteres: leitura gera sessão nova; `update` falha e o erro é o da senha curta.
- RF-07 (aberto): cookie legado (1 iteração) selado com `B` é aberto, e o `Set-Cookie` resultante abre com `A`.
- RF-07 (fechado): mesmo cookie legado com `legacySealFallback: false` não é aberto (sessão nova).

Verificação de "C não é tentada" (RF-03) é feita pelo resultado, sem spy em `unseal` (módulo ESM).

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07
Depende de: nenhuma
Aceite: rodar `pnpm vitest run test/session.test.ts` antes de T-03 e T-04. Os testes de RF-01, RF-02, RF-03, RF-05, RF-06 e RF-07 (aberto) falham, e os de RF-04 (sem extras) e RF-07 (fechado) passam. Os testes existentes passam. Registrar as falhas observadas na descrição da PR ou no commit, para comprovar o vermelho inicial.
Arquivos: `test/session.test.ts`

---

### T-03 — Campo `extraUnsealPasswords`, validação e selagem com `sealOptionsFor`

Em `src/utils/session.ts`:

- Adicionar a `SessionConfig`, logo após `password` (`:48`), o campo `extraUnsealPasswords?: string[]` com o JSDoc do contrato em `sdd/techspec.md` (usado só para abrir; ordem de tentativa; mínimo de 32 caracteres; risco de manter senha antiga). É o único símbolo público novo.
- Criar o helper interno `sealOptionsFor(config)` no fim do arquivo, com as opções de selagem que hoje estão repetidas em `sealSession` (`:300-304`) e `unsealSession` (`:317-321`).
- Criar o helper interno `assertExtraPasswords(config, sealOptions)`, que chama `assertPasswordLength` para cada extra nos dois limites (`encryption.minPasswordlength` e `integrity.minPasswordlength`).
- `sealSession`: usar `sealOptionsFor(config)` e chamar `assertExtraPasswords` antes de `seal`. Continua selando somente com `config.password`.
- `unsealSession`: chamar `sealOptionsFor` e `assertExtraPasswords` no início. Ainda não trocar o loop de tentativas (isso é T-04); a assinatura e o comportamento sem extras não mudam.
- Assinaturas de `sealSession` e `unsealSession` não mudam; `src/index.ts` não muda.

Cobre: RF-02, RF-06
Depende de: T-01, T-02
Aceite: `pnpm typecheck` passa. Com `extraUnsealPasswords: [""]` (ou com 31 caracteres), `sealSession` e `unsealSession` lançam `"Password string too short (min 32 characters required)"`. Com `extraUnsealPasswords` ausente, o comportamento é idêntico ao atual. Os testes RF-02 e RF-06 de T-02 passam. Confirmar que `src/index.ts` não exporta nada novo (`git diff` mostra apenas `session.ts` e `iron-crypto.ts`).
Arquivos: `src/utils/session.ts`

---

### T-04 — Loop de tentativas por senha com fallback legado dentro de cada tentativa

Em `src/utils/session.ts`, substituir a chamada direta a `unseal` e o `try/catch` com fallback legado em `unsealSession` (`:322-348`) pelos helpers internos do fim do arquivo:

- `unsealWithPasswords(sealed, config, sealOptions)`: itera sobre `new Set([config.password, ...(config.extraUnsealPasswords || [])])`. Para cada senha chama `unsealWithPassword`. Só continua para a próxima senha se o erro for `"Bad hmac value"` (`isBadHmac`); qualquer outro erro sobe imediatamente. Se nenhuma abrir, relança o último erro `"Bad hmac value"`.
- `unsealWithPassword(sealed, password, config, sealOptions)`: tentativa com as iterações configuradas; se falhar com `"Bad hmac value"`, `legacySealFallback` não for `false` e as iterações não forem 1, tenta de novo com 1 iteração e marca `kLegacySeal` no resultado (`:170-172`). Preservar o comentário TODO sobre remover o fallback na v3.
- `isBadHmac(error)`: `error instanceof Error && error.message === "Bad hmac value"`.
- Manter o `if (unsealed)` antes de marcar `kLegacySeal`, porque `unseal` pode retornar `null`.
- As checagens de `maxAge` e `idleTimeout` (`:349-365`) continuam depois do loop, sem mudança.
- `getSession` não muda (continua engolindo o erro de `unsealSession` em `:197`).

Sem extras, o loop executa uma única tentativa e os erros saem idênticos aos atuais.

Cobre: RF-01, RF-03, RF-04, RF-05, RF-07
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/session.test.ts` passa por completo, incluindo todos os testes de T-02 e a suíte existente sem alteração. Cookie com `B` e lista `[B, C]` abre com `B`. Cookie com `C` fora da lista gera sessão nova. Cookie legado com `B` abre com fallback padrão e é regravado com `A`; com `legacySealFallback: false` não abre. Expiração com `B` e `maxAge` vencido continua lançando `"Session expired!"`.
Arquivos: `src/utils/session.ts`

---

### T-05 — Verificação final e regressão

- Rodar `pnpm lint` (oxlint + oxfmt --check) e `pnpm typecheck`; corrigir apenas o que for da feature.
- Rodar `pnpm test` (suíte completa com cobertura) e confirmar que nada que existia antes deixou de passar.
- Conferir que o tamanho de `src/utils/session.ts` está registrado como aceito (R-07 da techspec); não extrair o loop nesta entrega.
- Conferir que o JSDoc do campo novo menciona o risco de manter senha antiga (R-01).
- Não adicionar guia de migração (fora de escopo do PRD).

Cobre: RF-04
Depende de: T-04
Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` passam sem falhas. O resultado (comandos e saída resumida) é reportado na entrega.
Arquivos: `src/utils/session.ts`, `src/utils/internal/iron-crypto.ts`, `test/session.test.ts`, `test/unit/iron-crypto.test.ts`

---

## Pendências do PRD (não bloqueiam as tarefas)

Estes pontos estão em aberto no PRD e na techspec. Nenhuma tarefa depende deles; a implementação segue o que está escrito (regravação com `password` apenas nas condições já existentes, sem limite máximo para `extraUnsealPasswords`):

1. Confirmar com o dono da feature que a regravação com `password` de sessões abertas com senha extra é aceita (PRD, RF-07; techspec D-03).
2. Confirmar se há limite máximo para `extraUnsealPasswords` antes de publicar (PRD; techspec R-02).
