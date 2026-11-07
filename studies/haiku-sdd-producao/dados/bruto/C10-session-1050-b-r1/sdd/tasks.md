# Tarefas: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-07, arquivos e testes).

Regras gerais para todas as tarefas:

- Seguir o fluxo de bug fix do `AGENTS.md`: escrever o teste antes, confirmar que ele falha, implementar, confirmar que passa.
- Todo teste novo vai dentro de `describeMatrix` em `test/session.test.ts`, para rodar em `web` e `node`.
- Não mudar expectativa de teste existente (RF-04).
- Não tocar em `src/index.ts`, `src/utils/internal/iron-crypto.ts`, `src/_deprecated.ts` nem em `docs/`.
- Tarefas que editam `test/session.test.ts` ou `src/utils/session.ts` na mesma região devem rodar em sequência, conforme o campo `Depende de:`.

## Ordem sugerida

T-01 → T-02 → T-03 → T-04 → T-05 → T-07
T-01 → T-06
T-05, T-06, T-07 → T-08

---

### T-01 — Campo público e símbolo interno

**Cobre:** RF-09

**Depende de:** nenhuma

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]` com a JSDoc da techspec (senhas só abrem, `password` sela, lista curta, custo de PBKDF2, remover após expirar).
- `kSealedWithExtra` existe em `src/utils/internal/session.ts` com `Symbol.for("h3.internal.session.extra-password")`, ao lado de `kLegacySeal`.
- Nenhum export novo em `src/index.ts` nem em `src/utils/session.ts`. Comparando com a versão anterior, a única diferença de API é o campo novo.
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`, `src/utils/internal/session.ts`

---

### T-02 — Extrair o unseal por senha (refatoração sem mudança de comportamento)

**Cobre:** RF-04

**Depende de:** T-01

**Aceite:**
- Helpers `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` e `isBadHmac(error)` existem no fim de `src/utils/session.ts`, com o bloco `try`/fallback de `:322-348` movido para `unsealWithPassword`.
- `unsealSession` ainda chama só `config.password`. Comportamento, erros e `Set-Cookie` não mudam.
- Antes da mudança, um teste de RF-04 novo ("sem extras, sessão selada com outra senha é nova", com config sem o campo e com `[]`) passa. Depois da mudança, continua passando.
- `pnpm vitest run test/session.test.ts` passa sem alterar expectativa de nenhum teste existente.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-03 — Laço de senhas em `unsealSession`, expiração e fallback legado

**Cobre:** RF-01, RF-05, RF-06

**Depende de:** T-02

**Aceite:**
- Testes escritos antes e falhando, depois passando, em `describeMatrix`:
  - RF-01: rota `getSession` com cookie selado com `oldPassword`, config com `password: sessionConfig.password` e `extraUnsealPasswords: [oldPassword]`. Retorna `data` e `id` originais, sem erro.
  - RF-05: `unsealSession({} as HTTPEvent, config, sealed)` com selo de `createdAt` antigo, `maxAge` e senha extra. Lança `Session expired!`. Usa `vi.useFakeTimers` com `toFake: ["Date"]` e selo de `ttl` zero, como em `test/session.test.ts:344-373` (R-5 da techspec).
  - RF-06: selo legado de 1 iteração com `oldPassword`, sem `legacySealFallback`. Abre. Com `legacySealFallback: false`, não abre e vira sessão nova.
- `unsealWithPasswords` percorre `[config.password, ...(config.extraUnsealPasswords ?? [])]` na ordem. Só passa para a próxima senha quando o erro é `"Bad hmac value"` e não é a última. Qualquer outro erro é relançado (P2, P3, D-01).
- `unsealSession` define `kSealedWithExtra` como `true` só quando a senha vencedora não é a primeira. Com a senha atual, o símbolo não aparece (D-02).
- As checagens de `maxAge` e `idleTimeout` continuam depois do laço, sem mudança (D-06).

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-04 — Regravação de sessão aberta por senha extra

**Cobre:** RF-03

**Depende de:** T-03

**Aceite:**
- Teste escrito antes e falhando, depois passando, em `describeMatrix`: rota `getSession` com cookie selado com `oldPassword` gera `Set-Cookie`. O novo cookie abre com `sessionConfig.password` e falha com `oldPassword`. O teste lê o último `Set-Cookie` e não depende de ordem entre cookies (R-4).
- Teste de "sessão selada com a senha atual não regrava": cookie com a senha atual, extras `[oldPassword]`, sem `idleTimeout`. Não há `Set-Cookie` e os dados são os originais. Garante que o marcador só é ligado para senha extra.
- A condição de reseal em `getSession` vira `session.id && sessionFromCookie && (legacySeal || sealedWithExtra || shouldSlide(session, config))`, e a regravação usa `updateSession` (D-03).
- `kSealedWithExtra` é lido e apagado antes de `Object.assign` (`src/utils/session.ts:199-208`), ao lado de `kLegacySeal`. Na revisão, confirmar que o símbolo não aparece no objeto retornado por `getSession` (R-1).

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-05 — Selagem sempre com a senha atual

**Cobre:** RF-02

**Depende de:** T-04

**Aceite:**
- Teste em `describeMatrix` com rota `updateSession` e config `password: B`, `extraUnsealPasswords: [A]`. O cookie resultante abre com `B` e falha com `A`.
- O teste passa sem alterar `sealSession` nem `updateSession`. Se precisar mudar um deles, parar e registrar o motivo, porque RF-02 já vale por construção (techspec, "Estado atual").
- `pnpm vitest run test/session.test.ts` passa.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Validação de `extraUnsealPasswords`

**Cobre:** RF-07

**Depende de:** T-01

**Aceite:**
- Helper `assertExtraUnsealPasswords(config)` no fim de `src/utils/session.ts`. É chamado em `getSession` logo depois de `sessionName` e antes de `context.sessions` (D-04).
- Regras, nessa ordem: sem campo, não faz nada. Não é array, lança erro. Item que não é string ou tem tamanho menor que o mínimo (o maior `minPasswordlength` de `config.seal ?? sealDefaults`), lança erro.
- Mensagens exatas da techspec: ``Invalid session config: `extraUnsealPasswords[${index}]` must be a string of at least ${minLength} characters.`` e ``Invalid session config: `extraUnsealPasswords` must be an array of strings.``
- Testes em `describeMatrix`, com rota que chama `getSession` dentro de `try`/`catch` e devolve `error.message` no corpo. Casos: `["curta"]`, `[""]`, e não-array. A mensagem contém `extraUnsealPasswords` e não contém a senha. `ctx.errors` fica vazio.
- Teste de `useSession` também lança o erro antes de ler o cookie, pelo mesmo caminho.

**Arquivos:** `src/utils/session.ts`, `test/session.test.ts`

---

### T-07 — Cobertura de header `sessionHeader`

**Cobre:** RF-08

**Depende de:** T-04

**Aceite:**
- Teste em `describeMatrix`: header com selo de `oldPassword`, config com `password: sessionConfig.password` e `extraUnsealPasswords: [oldPassword]`. Os dados são retornados e a resposta não tem `Set-Cookie` de sessão.
- Teste de header expirado com senha extra (`createdAt` antigo): sessão nova, sem `Set-Cookie`, erro engolido como hoje.
- Confirmar que `sessionFromCookie` continua impedindo a regravação para sessão lida do header. Nenhuma condição nova para isso (techspec, D-03).

**Arquivos:** `test/session.test.ts`

---

### T-08 — Verificação final de qualidade

**Cobre:** RF-10

**Depende de:** T-05, T-06, T-07

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa nos modos `web` e `node`.
- Há pelo menos um teste por RF-01 a RF-08 em cada modo. Conferir com o nome dos testes ou com a lista de `describeMatrix`.
- `pnpm typecheck` passa.
- `pnpm lint` passa, incluindo `oxfmt --check`.
- `pnpm test` completo roda, e a cobertura do caminho novo em `src/utils/session.ts` foi checada (opcional, techspec).
- Se algum check falhar, o resultado é reportado com a saída, sem marcar a tarefa como concluída.

**Arquivos:** `test/session.test.ts`, `src/utils/session.ts` (somente correções de formatação ou lint, se necessárias)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
|---|---|
| RF-01 | T-03 |
| RF-02 | T-05 |
| RF-03 | T-04 |
| RF-04 | T-02 |
| RF-05 | T-03 |
| RF-06 | T-03 |
| RF-07 | T-06 |
| RF-08 | T-07 |
| RF-09 | T-01 |
| RF-10 | T-08 |

## Fora destas tarefas

Itens que a techspec marca como fora de escopo ou como tarefa separada. Não entram aqui:

- Dividir `src/utils/session.ts` em outro arquivo (D-07, R-7).
- Atualizar `docs/` (R-8).
- Validar a `password` atual com a mesma regra, e o erro silencioso dela (R-3). Recomendado como issue separada.
