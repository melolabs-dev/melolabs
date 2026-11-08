# Tarefas de implementação — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-08). As decisões D-NN citadas abaixo são as da techspec.

Ordem sugerida: T-01 e T-02 primeiro (testes vermelhos e tipo); depois T-03; depois T-04, T-05 e T-06 em paralelo; então T-07, T-08 e T-09.

---

### T-01 — Escrever os testes de rotação (antes da implementação)

Escrever o bloco `describe("password rotation")` em `test/session.test.ts`, após a linha 186, dentro de `describeMatrix` (roda em `web` e `node`). Cenários da tabela "Estratégia de testes" da techspec:

- selar só com a primeira senha (RF-02);
- abrir sessão selada com a senha antiga (RF-03);
- senha removida vira sessão nova, sem erro não tratado (RF-04);
- resselar com a senha atual ao ler sessão antiga, com `idleTimeout` (RF-05);
- resselar com a senha atual ao ler sessão antiga, sem `idleTimeout` (D-06);
- não resselar quando a senha atual já abre (regressão de D-06);
- legado de 1 iteração com a senha antiga, com resselagem para a nova (RF-07);
- lista vazia lança erro "at least one" (RF-08);
- item curto na lista lança erro de tamanho (D-03);
- erro não-HMAC (expiração) interrompe a lista sem tentar a próxima senha (D-05).

Não editar as linhas 21-25 nem os testes existentes.

**Cobre:** RF-02, RF-03, RF-04, RF-05, RF-07, RF-08, RF-10
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/session.test.ts` executa os cenários novos e eles **falham** antes de T-03 a T-07 (confirmar a falha e anotar o motivo de cada um). Os testes existentes continuam passando. Cada cenário aparece nos modos `web` e `node`.
**Arquivos:** `test/session.test.ts`

---

### T-02 — Ampliar o tipo de `SessionConfig.password` e testar o tipo

Trocar `password: string` por `password: string | string[]` em `src/utils/session.ts:48` (D-01). Não mexer no JSDoc agora; ele é atualizado em T-08. Acrescentar em `test/unit/types.test-d.ts`, após a linha 530, uma seção com:

- `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`;
- checagem de que `{ password: ["nova", "antiga"] }` e `{ password: "unica" }` são atribuíveis a `SessionConfig`.

Buscar todos os usos de `config.password` em `src/` antes de terminar (techspec, Riscos 6). Os usos esperados são `src/utils/session.ts:300`, `:324` e `:340`. Os de `src/utils/auth.ts` e `src/types/context.ts:32` são outras senhas e não entram.

**Cobre:** RF-01, RF-09
**Depende de:** nenhuma
**Aceite:** `pnpm vitest run test/unit/` passa a seção nova. `pnpm typecheck` acusa erro apenas nos três usos de `config.password` que T-03 e T-04 vão migrar, e em nenhum outro lugar.
**Arquivos:** `src/utils/session.ts`, `test/unit/types.test-d.ts`

---

### T-03 — Helper `sessionPasswords` com validação explícita

Criar `sessionPasswords(config: Pick<SessionConfig, "password" | "seal">): string[]` em `src/utils/internal/session.ts` (D-02), no fim do arquivo, com as regras de D-03:

- `[]` lança `Error("At least one session password is required")`;
- string simples é normalizada para `[string]`;
- cada item precisa ser string não vazia com `length >= minPasswordlength`, usando `config.seal?.encryption.minPasswordlength ?? sealDefaults.encryption.minPasswordlength`, com a mesma mensagem de `generateKey` (`Password string too short ...`).

Não exportar o helper por `src/index.ts` (D-08).

**Cobre:** RF-01, RF-08
**Depende de:** T-02
**Aceite:** teste unitário (em `test/unit/`) cobre: lista vazia lança; string única vira array de um item; item curto lança a mensagem de tamanho; lista válida devolve a mesma ordem. `pnpm vitest run test/unit/` passa.
**Arquivos:** `src/utils/internal/session.ts`, `test/unit/` (arquivo de teste do helper)

---

### T-04 — Selar sempre com a primeira senha

Em `sealSession`, trocar o uso de `config.password` (`src/utils/session.ts:300-304`) por `sessionPasswords(config)[0]` (D-04). Nenhuma outra mudança no caminho de selo, para não alterar o número de derivações PBKDF2.

**Cobre:** RF-02
**Depende de:** T-03
**Aceite:** cenário "selar só com a primeira senha" de T-01 passa nos dois modos. O teste de contagem de derivações (`test/session.test.ts:722-735`) continua passando sem edição.
**Arquivos:** `src/utils/session.ts`

---

### T-05 — Abrir tentando cada senha em ordem

Mover o corpo atual do `try/catch` de `unsealSession` (`src/utils/session.ts:324-347`) para uma função interna `unsealWithPassword(sealed, password, sealOptions, config)` no fim de `src/utils/session.ts`, sem mudança de lógica (fallback legado de 1 iteração incluído). `unsealSession` passa a fazer um laço sobre `sessionPasswords(config)` conforme D-05:

- só `"Bad hmac value"` faz continuar para a próxima senha;
- qualquer outro erro sobe imediatamente;
- se nenhuma senha abre, sobe o `Bad hmac value` da última tentativa;
- a checagem de expiração (`src/utils/session.ts:350-365`) continua depois do laço.

O marcador `kRotated` não é tratado aqui; ele entra em T-07.

**Cobre:** RF-03, RF-04, RF-07
**Depende de:** T-03
**Aceite:** cenários "abre com a senha antiga", "senha removida vira sessão nova", "legado de 1 iteração com a senha antiga" e "erro não-HMAC interrompe a lista" de T-01 passam nos dois modos. A suíte existente de `test/session.test.ts` continua passando.
**Arquivos:** `src/utils/session.ts`

---

### T-06 — Validação antecipada em `getSession`, `sealSession` e `unsealSession`

Chamar `sessionPasswords(config)` no início de `getSession`, antes do bloco com `.catch(() => {})` (`src/utils/session.ts:149-155` e `:197`), e também no início de `sealSession` e de `unsealSession` (D-03). Assim, lista vazia ou item curto não é engolido e vira "sessão nova" em silêncio.

**Cobre:** RF-08
**Depende de:** T-03
**Aceite:** cenários "lista vazia lança erro explícito" e "item curto na lista lança erro" de T-01 passam nos dois modos. Os erros aparecem na primeira utilização, não no primeiro `updateSession`.
**Arquivos:** `src/utils/session.ts`

---

### T-07 — Resselar sessões abertas com senha antiga

Adicionar em `src/utils/internal/session.ts`, ao lado de `kLegacySeal` (linhas 7-9), o símbolo `kRotated = Symbol.for("h3.internal.session.rotated")`. Em `unsealSession`, marcar o resultado com `kRotated` quando a senha que abriu não for a primeira (D-05 e D-06). Em `getSession`, trocar a condição de reselagem (`src/utils/session.ts:214`) para `legacySeal || rotated || shouldSlide(session, config)` e remover o marcador antes do `Object.assign` (como em `src/utils/session.ts:199-201`).

Sessões que chegam pelo header de sessão continuam sem reselagem (`sessionFromCookie`), como diz o PRD.

**Atenção:** D-06 amplia RF-05. A reselagem passa a acontecer também sem `idleTimeout`, uma vez por sessão. Se o texto literal do PRD for preferido, não criar `kRotated` nem a condição nova; os cenários "sem `idleTimeout`" de T-01 passam a ser removidos. Confirmar a escolha antes de começar esta tarefa.

**Cobre:** RF-05
**Depende de:** T-04, T-05
**Aceite:** cenários "resela com a senha atual, com `idleTimeout`", "resela sem `idleTimeout`" e "não resela quando a senha atual abre" de T-01 passam nos dois modos. Sessões de header não geram `Set-Cookie` de reselagem.
**Arquivos:** `src/utils/internal/session.ts`, `src/utils/session.ts`

---

### T-08 — Atualizar o JSDoc de `password`

Reescrever o JSDoc de `SessionConfig.password` em `src/utils/session.ts:40-48` (D-08) com:

- a primeira senha sela e as demais só abrem;
- a lista precisa ter ao menos uma senha;
- cada item segue a mesma regra de tamanho mínimo; a regra de entropia continua só como texto, sem validação no código;
- manter a senha nova na primeira posição;
- manter a lista curta (custo de PBKDF2 por tentativa, Riscos 1);
- o tempo de resposta pode indicar a posição da senha que casou (Riscos 5);
- sessões de header não são resseladas (Riscos 3).

Nenhuma documentação fora do JSDoc (PRD, "Fora de escopo").

**Cobre:** RF-01, RF-08
**Depende de:** T-05, T-06, T-07
**Aceite:** o JSDoc descreve o comportamento implementado. `pnpm lint` passa (oxlint e oxfmt).
**Arquivos:** `src/utils/session.ts`

---

### T-09 — Verificação final: compatibilidade, API pública e suíte completa

Confirmar que:

- as linhas 21-25 de `test/session.test.ts` e os testes anteriores não foram editados (RF-06);
- `test/unit/package.test.ts` não foi editado e continua passando, o que mostra que nenhum export novo foi criado (RF-09);
- `src/index.ts` não foi alterado (techspec, "Não alterar").

Rodar, nesta ordem: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, `pnpm lint`, `pnpm typecheck` e `pnpm test`.

**Cobre:** RF-06, RF-09, RF-10
**Depende de:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08
**Aceite:** todos os comandos passam. Se algum falhar, registrar a saída completa. Os cenários de RF-10 passam nos modos `web` e `node`.
**Arquivos:** nenhum arquivo novo; verificação sobre `test/session.test.ts`, `test/unit/package.test.ts`, `src/index.ts`

---

## Pontos em aberto

1. **D-06 contra RF-05** (ver T-07). Decisão a confirmar com quem definiu o PRD.
2. **Referência a `sdd/pedido.md`.** A techspec cita `sdd/pedido.md` (contrato #1050-a) como base, mas esse arquivo não está na pasta `sdd/` (só `prd.md` e `techspec.md`). Não foi usado para estas tarefas.
3. **Limite de tamanho da lista** (Riscos 1 da techspec). A techspec recomenda não impor limite duro agora. Nenhuma tarefa cria esse limite.
