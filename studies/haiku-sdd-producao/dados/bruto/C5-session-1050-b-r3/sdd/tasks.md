# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-09). Ordem sugerida: T-01 → T-02 → T-03 → T-04 e T-05 → T-06. Seguir o fluxo de correção de `AGENTS.md`: os testes de T-02 devem falhar antes de T-03.

Cobertura dos requisitos:

| Requisito | Tarefas |
|---|---|
| RF-01 | T-01 |
| RF-02 | T-02, T-03 |
| RF-03 | T-02 |
| RF-04 | T-02, T-03 |
| RF-05 | T-02, T-03 |
| RF-06 | T-02 |
| RF-07 | T-02, T-03 |
| RF-08 | T-06 |

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]`, logo após `password`, com o JSDoc da techspec (contrato em `sdd/techspec.md`, seção "Contratos e assinaturas"). O JSDoc diz que as senhas servem só para abrir sessões, que `password` continua selando, que entradas inválidas são ignoradas, que cada entrada custa uma derivação PBKDF2 por requisição com cookie inválido e que a entrada só deve ser removida depois que as sessões seladas com ela passarem de `maxAge` ou `idleTimeout`, ou forem resseladas.
- `password` continua `string`, e nenhum outro nome público é criado.
- Uma configuração sem o campo continua compilando sem alteração.
- `pnpm typecheck` passa.

**Arquivos:**
- `src/utils/session.ts`

---

### T-02 — Testes de RF-02 a RF-07 e de D-02 e D-04

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** T-01

**Aceite:**
- Existe `describe("extraUnsealPasswords")` dentro do `describeMatrix` de `test/session.test.ts`, que roda em `web` e `node`.
- Todas as senhas dos testes novos têm 32 caracteres ou mais. As senhas `"senha-nova"` e `"senha-antiga"` do PRD são curtas demais: `seal` lança erro e o teste passaria por motivo errado.
- Cookies de teste são gerados com `seal` de `src/utils/internal/iron-crypto.ts`, como no teste de legado (`test/session.test.ts:134-143`).
- Casos cobertos:
  - RF-02: sessão selada com `OLD`, configuração com `password: NEW` e `extraUnsealPasswords: [OLD]`. `id`, `createdAt` e `data` originais são preservados.
  - RF-03: `sealSession` com a configuração gera um selo que abre com `NEW` e não abre com `OLD`.
  - RF-04: sem `extraUnsealPasswords`, cookie selado com outra senha gera id novo, com `legacySealFallback: false`.
  - RF-05: `vi.useFakeTimers({ toFake: ["Date"], now })`, chamada direta a `unsealSession` com `undefined as any` como evento, e espera de `Session expired!`.
  - RF-06: após abrir com `OLD`, `updateSession` gera `Set-Cookie` que abre com `NEW` e não com `OLD`.
  - RF-06 (premissa 3): selado com `OLD` e uma iteração de PBKDF2 (fallback legado), aberto com `extraUnsealPasswords: [OLD]`; a sessão carrega e é resselada com `NEW`.
  - RF-07: cookie selado com `OLD` enviado no header `x-h3-test-session`, com `extraUnsealPasswords: [OLD]`. A sessão carrega e não há `Set-Cookie`.
  - D-02: cookie selado com `NEW`, com `OLD` também na lista. A sessão carrega com os dados corretos e é resselada com `NEW`.
  - D-04: lista com `""`, a própria `NEW` e uma string de 10 caracteres. Cookie selado com `NEW` continua abrindo.
- Antes de T-03, os testes de RF-02, RF-05, RF-06 (incluindo o legado) e RF-07 falham. Os de RF-03, RF-04, D-02 e D-04 podem já passar, porque o comportamento atual se mantém.
- Os testes de RF-03 e RF-06 do `updateSession` valem também com T-03 aplicada, pois `sealSession` e `updateSession` não mudam.

**Arquivos:**
- `test/session.test.ts`

---

### T-03 — Tentativa com várias senhas em `unsealSession`

**Cobre:** RF-02, RF-04, RF-05, RF-07

**Depende de:** T-02

**Aceite:**
- `unsealSession` (`src/utils/session.ts:312`) chama `unsealWithPasswords`, que tenta `config.password` e depois cada senha de `extraPasswords(config)`, nessa ordem.
- O corpo que hoje está em `src/utils/session.ts:323-348` vira `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)`, com o fallback legado dentro de cada tentativa. O marcador `kLegacySeal` continua sendo gravado quando o fallback é usado.
- `extraPasswords(config)` remove vazias, duplicadas e a senha atual. Não há teto de tamanho (D-07).
- Se nenhuma senha abrir, lança o erro da senha atual (`firstError` da primeira tentativa), para que a lista vazia preserve o erro de hoje (RF-04).
- A checagem de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continua depois do laço e não muda (RF-05).
- `sealSession`, `updateSession`, a condição de reselagem em `getSession` e `iron-crypto.ts` não mudam.
- `pnpm vitest run test/session.test.ts` passa para os testes de T-02.

**Arquivos:**
- `src/utils/session.ts`

---

### T-04 — Benchmark do custo com listas de senhas extras

**Cobre:** nenhum RF. Mede o risco de custo de CPU do PRD (seção "Riscos") e a premissa de ordem de tentativa (techspec, risco 6).

**Depende de:** T-03

**Aceite:**
- `test/bench/session.ts` tem, além do caso atual com uma senha (`:10` e `:20`), um caso com 3 extras e um cookie que não abre com nenhuma senha.
- O benchmark roda com `pnpm bench:node`. Ele não entra na suíte de testes.
- A média antes e depois da mudança é registrada na descrição do PR, para confirmar o custo de `1 + N` derivações.

**Arquivos:**
- `test/bench/session.ts`

---

### T-05 — Documentação da rotação de senhas

**Cobre:** nenhum RF. Documenta as premissas e os riscos do PRD (rotação, senha antiga comprometida, remoção prematura, custo) e a exigência de `maxAge` ou `idleTimeout` da techspec (risco 2).

**Depende de:** T-03

**Aceite:**
- `docs/4.examples/handle-session.md` tem uma seção de rotação de senhas, após as opções (`:122-141`) e junto de "Expiration" (`:151-156`).
- A seção diz o procedimento: colocar a nova senha em `password`, a antiga em `extraUnsealPasswords`, esperar todas as sessões passarem de `maxAge` ou `idleTimeout` (ou serem escritas), e só então remover a antiga.
- A seção diz que a senha antiga na lista continua valendo, inclusive se comprometida.
- A seção diz que a rotação exige `maxAge` ou `idleTimeout`, porque sem eles uma sessão nunca reescrita não expira.
- A seção diz que cada senha extra custa uma derivação PBKDF2 por requisição com cookie inválido.
- O texto segue o estilo dos outros exemplos do diretório `docs/4.examples/`.

**Arquivos:**
- `docs/4.examples/handle-session.md`

---

### T-06 — Verificação final

**Cobre:** RF-08

**Depende de:** T-02, T-03, T-04, T-05

**Aceite:**
- `pnpm vitest run test/session.test.ts` termina sem falhas (RF-08).
- `pnpm vitest run test/unit/` termina sem falhas.
- `pnpm lint` termina sem falhas. Esse script é só `oxlint . && oxfmt --check .`, sem typecheck (`package.json:46`).
- `pnpm typecheck` termina sem falhas. Ele é o `tsc --noEmit` de `package.json:54`.
- `pnpm test` termina sem falhas, se o tempo permitir.
- Se o `tsconfig` incluir `test/`, há um teste de tipo para `SessionConfig["extraUnsealPasswords"]`. Se não incluir, RF-01 fica coberto só pelo `pnpm typecheck` de T-01.

**Arquivos:**
- nenhum arquivo novo. Esta tarefa só executa comandos e corrige o que falhar, nos arquivos já listados nas tarefas anteriores.

---

## Decisões assumidas

As tarefas seguem as recomendações da techspec, porque a lista de "Decisões a confirmar" ainda não tem resposta:

1. Entradas inválidas são ignoradas em silêncio (D-04). Não há log.
2. Não há teto de tamanho da lista (D-07). Só documentação.
3. Não há validação de rotação sem `maxAge` nem `idleTimeout` no código (risco 2). A exigência fica só na documentação (T-05).
