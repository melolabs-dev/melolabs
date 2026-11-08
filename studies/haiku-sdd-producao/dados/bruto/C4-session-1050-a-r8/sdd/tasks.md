# Tarefas — várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-08).

Ordem geral: primeiro os testes (T-01 a T-04), que devem falhar antes da implementação, depois o código (T-05 a T-08), depois documentação e verificação final. Seguindo o fluxo de correção de bug do `AGENTS.md`: teste que reproduz primeiro, implementação depois.

Comandos de verificação usados nos aceites:

```bash
pnpm vitest run test/session.test.ts      # suíte de sessão
pnpm vitest run test/unit/                # unitários (inclui a lista de exports)
pnpm typecheck                            # tsc --noEmit (inclui test/)
pnpm lint                                 # oxlint + oxfmt --check
pnpm test                                 # suíte completa com cobertura
```

---

### T-01 — Ajustar os usos diretos do iron nos testes existentes

**Cobre:** RF-05, RF-10

**Depende de:** nenhuma

**Aceite:**
- `test/session.test.ts` define uma constante `PASSWORD` no bloco de teste e a usa em `sessionConfig.password` e nas três chamadas diretas a `seal`/`unseal` do iron (linhas 137, 157 e 164 hoje).
- `pnpm vitest run test/session.test.ts` passa sem mudança de expectativa em nenhum teste existente.
- Nenhuma alteração em `src/`.

**Arquivos:** `test/session.test.ts`

---

### T-02 — Testes de selo e leitura por senha antiga (RF-01, RF-02, RF-03, RF-09)

**Cobre:** RF-01, RF-02, RF-03, RF-09

**Depende de:** T-01

**Aceite:**
- Novos casos em `describeMatrix` de `test/session.test.ts`, rodando em `web` e `node`:
  - RF-01: `useSession` com `[NOVA, ANTIGA]` e `update` gera selo que abre com `NOVA` via `unseal` do iron e não abre com `ANTIGA`.
  - RF-02: cookie selado com `seal({ id, createdAt, data }, ANTIGA, sealDefaults)` é lido por `getSession` com `[NOVA, ANTIGA]` e devolve o mesmo `id` e `data`.
  - RF-03: cookie selado com uma senha fora da lista vira sessão nova (`id` diferente do original, sem dados antigos).
  - RF-09: mesmo cenário de RF-02 enviado no header `x-h3-session`; `getSession` devolve os `data` originais.
- Antes da T-05, os casos de RF-01, RF-02 e RF-09 falham (a lista ainda não é aceita ou só a primeira senha é tentada). RF-03 pode já passar; isso é esperado e deve ser anotado.

**Arquivos:** `test/session.test.ts`

---

### T-03 — Testes de reselagem, fallback legado e expiração com senha antiga (RF-04, RF-06, RF-08)

**Cobre:** RF-04, RF-06, RF-08

**Depende de:** T-01

**Aceite:**
- Novos casos em `describeMatrix` de `test/session.test.ts`:
  - RF-04: cookie com `ANTIGA` lido por `useSession` (ou `update`) com `[NOVA, ANTIGA]`; o `Set-Cookie` resultante abre com `NOVA` e não com `ANTIGA`. Verificar também que o payload resselado não contém a chave `kOlderPassword` nem outra propriedade extra.
  - RF-04 (idleTimeout): mesmo teste com `idleTimeout` e `createdAt` passando da metade da janela; o `Set-Cookie` abre com `NOVA`.
  - RF-06: selo gerado com `seal` do iron em 1 iteração (`integrity: { iterations: 1 }`) pela senha `ANTIGA`; `getSession` com `[NOVA, ANTIGA]` abre a sessão e resela com `NOVA` usando as opções atuais de `sealDefaults`.
  - RF-08: selo com `ANTIGA` e `createdAt` além de `maxAge`; `getSession` trata como expirada (`id` novo).
- Os selos de "versão atual" são gerados com `seal` do iron direto, e não com `sealSession`, como em `test/session.test.ts:134-139`.
- Antes da T-05 e da T-07, RF-04 e RF-06 falham; RF-08 pode já passar porque a expiração não depende da senha. Anotar o resultado de cada caso.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de compatibilidade com senha única e validação da lista (RF-05, RF-07)

**Cobre:** RF-05, RF-07

**Depende de:** T-01

**Aceite:**
- RF-05: caso novo com `password` como `string` e um selo gerado pela versão atual do código (via `seal` do iron direto, com `sealDefaults`). `getSession` lê sem erro, e o `Set-Cookie` emitido após reselagem é idêntico ao que a versão atual emite. Os testes existentes `test/session.test.ts:134-186` continuam passando.
- RF-07: casos com `password: []` e `password: [""]` (e um item não-string, como `[1 as any]`), chamando `getSession`, `updateSession` e `sealSession`/`unsealSession` dentro de `try/catch`. A mensagem contém `empty` para a lista vazia e `non-empty` para item inválido. Usar `try/catch` para não cair no rastreamento de erros do `describeMatrix`.
- Antes da T-05, os casos de RF-07 falham (o erro não existe, ou o erro é engolido por `getSession`). O caso de RF-05 deve passar desde já, porque descreve o comportamento atual.

**Arquivos:** `test/session.test.ts`

---

### T-05 — Tipo `string | string[]`, normalização e validação da lista (RF-07, RF-10)

**Cobre:** RF-07, RF-10

**Depende de:** T-02, T-03, T-04

**Aceite:**
- `SessionConfig.password` vira `string | string[]` em `src/utils/session.ts`.
- Função interna `sessionPasswords(config)` converte o valor em `string[]`: string vira `[senha]`; lista é validada. Lista vazia lança `Error("Session password list is empty")`; item que não é string não vazia lança `Error("Session passwords must be non-empty strings")`. Strings vazias isoladas não ganham validação nova (RF-05).
- `sessionPasswords` é chamada no início de `getSession` (antes de `context.sessions` ser preenchido), `updateSession`, `sealSession` e `unsealSession`.
- JSDoc de `password` menciona: a primeira senha sela; as demais só abrem; a ordem importa; cada senha precisa de pelo menos 32 caracteres aleatórios; remover uma senha da lista invalida as sessões seladas com ela; manter a lista curta (2 ou 3) porque cada senha custa derivações.
- Nenhum export novo em `src/index.ts`.
- Após esta tarefa, os casos de RF-07 de T-04 passam. Os casos de T-02 e T-03 ainda podem falhar até T-06 a T-08.

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Selo sempre com a primeira senha (RF-01, RF-05)

**Cobre:** RF-01, RF-05

**Depende de:** T-05

**Aceite:**
- `sealSession` usa `passwords[0]` como senha de `seal`, mantendo `sealDefaults` e `config.seal` como antes. A string é passada direto, então o selo não tem `id`.
- Os casos de RF-01 de T-02 (parte de selo) passam.
- O caso de RF-05 de T-04 e os testes existentes continuam passando, com o mesmo formato de cookie.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Loop de unseal com fallback legado por senha (RF-02, RF-03, RF-05, RF-06, RF-09)

**Cobre:** RF-02, RF-03, RF-05, RF-06, RF-09

**Depende de:** T-06 (edita o mesmo arquivo; fazer em sequência)

**Aceite:**
- Função interna `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` contém o bloco atual de `try { unseal } catch { legacy }` (`src/utils/session.ts:323-348`), com `legacySealFallback` no lugar de `config.legacySealFallback === false`, e mantém `kLegacySeal`.
- `unsealSession` percorre a lista na ordem. Só `"Bad hmac value"` avança para a próxima senha; outros erros (`Expired seal`, `Wrong mac prefix`, `Incorrect number of sealed components`, `Invalid expiration`) são propagados na hora.
- Quando nenhuma senha abre, relança o erro da última tentativa. Com senha única, o erro é o de hoje.
- Blocos de `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`) ficam sem mudança.
- Os casos de RF-02, RF-03, RF-06 (parte de leitura) e RF-09 de T-02 e T-03 passam. Os testes existentes de legacy (`test/session.test.ts:134` e `:161`) continuam passando.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Reselagem de sessão aberta por senha antiga (RF-04)

**Cobre:** RF-04

**Depende de:** T-07

**Aceite:**
- `src/utils/internal/session.ts` ganha `kOlderPassword` (`Symbol.for("h3.internal.session.older-password")`), no mesmo padrão de `kLegacySeal`.
- `unsealSession` marca o objeto aberto com `kOlderPassword = true` quando a senha que abriu não é a primeira da lista.
- `getSession` remove `kOlderPassword` do objeto aberto junto com `kLegacySeal`, antes do `Object.assign`, e a condição de reseal vira `(legacySeal || olderPassword || shouldSlide(session, config))`, restrita a `sessionFromCookie`.
- Sessões lidas pelo header não são resseladas.
- Os casos de RF-04 de T-03 passam; o símbolo não aparece no payload do cookie.

**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

---

### T-09 — Confirmar expiração independente da senha (RF-08)

**Cobre:** RF-08

**Depende de:** T-07

**Aceite:**
- O caso de RF-08 de T-03 passa (sessão com `ANTIGA` e `createdAt` além de `maxAge` vira sessão nova).
- Os testes de `idleTimeout` existentes (`test/session.test.ts:188-510`) continuam passando sem mudança de expectativa.
- Nenhuma alteração em `shouldSlide` ou `sessionExpires` (D-08). Se algum teste de expiração falhar, a causa é registrada antes de qualquer ajuste.

**Arquivos:** `test/session.test.ts`

---

### T-10 — Documentação da rotação de senhas (RF-10)

**Cobre:** RF-10

**Depende de:** T-08

**Aceite:**
- `docs/4.examples/handle-session.md`: o aviso de entropia (linha 37) passa a dizer que a primeira senha sela e as demais só abrem.
- Nova subseção "Rotating the password" depois do parágrafo de opções (após a linha 143), com exemplo `password: [NOVA, ANTIGA]` e os pontos: a ordem importa; sessões antigas migram só quando são lidas por cookie; sessões lidas por header não migram; remover a senha antiga da lista invalida as sessões seladas com ela; cada senha extra custa uma derivação por requisição com cookie desconhecido.
- Texto em português, seguindo o estilo do arquivo (que está em inglês; manter o idioma do arquivo existente).

**Arquivos:** `docs/4.examples/handle-session.md`

---

### T-11 — Verificação final e regressões (RF-01 a RF-10)

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10

**Depende de:** T-06, T-08, T-09, T-10

**Aceite:**
- `pnpm vitest run test/session.test.ts` passa em `web` e `node`, incluindo todos os casos de T-02 a T-04.
- `pnpm vitest run test/unit/` passa, e `test/unit/package.test.ts` mostra a lista de exports inalterada.
- `pnpm typecheck` passa.
- `pnpm lint` passa (oxlint e oxfmt).
- `pnpm test` (suíte completa com cobertura) passa.
- Diff restrito aos arquivos listados nas tarefas. `src/utils/internal/iron-crypto.ts` e `src/index.ts` não mudam.
- Se algum comando falhar, registrar a saída e a causa, sem marcar a tarefa como concluída.

**Arquivos:** nenhum (apenas verificação)
