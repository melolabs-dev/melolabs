# Tarefas: múltiplas senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-10) e `sdd/techspec.md` (D-01 a D-06).

Convenções desta lista:

- Código e TSDoc seguem o restante do projeto, em inglês. Só a prosa desta lista e as tarefas estão em português.
- Tarefas que editam o mesmo arquivo estão encadeadas, para não haver conflito de edição. A ordem de trabalho é a do AGENTS.md (Bug Fix Workflow aplicado a feature): primeiro os testes, confirmados em vermelho, depois a implementação.
- Tarefas sem dependência entre si podem rodar em paralelo: T-01, T-02 e T-09.

Cadeias sequenciais:

- Testes em `test/session.test.ts`: T-03 → T-04 → T-05.
- Código em `src/utils/session.ts`: T-01 → T-06 → T-07 → T-08.

---

### T-01 — Campo `extraUnsealPasswords` em `SessionConfig`

Adicionar `extraUnsealPasswords?: string[];` logo após `password: string;` em `SessionConfig`, com o TSDoc da techspec (seção "Campo público"). Nenhuma lógica nova nesta tarefa. O campo só precisa existir e ser tipado.

**Cobre:** RF-01

**Depende de:** nenhuma

**Aceite:**
- `pnpm typecheck` compila uma configuração com `extraUnsealPasswords: ["<32 ou mais caracteres>"]`.
- `pnpm typecheck` compila a mesma configuração sem o campo.
- Um valor `extraUnsealPasswords: "uma-string"` gera erro de tipo.
- `password` continua `string`, sem alteração.

**Arquivos:** `src/utils/session.ts`

---

### T-02 — Símbolo interno `kExtraSeal`

Criar o símbolo interno `kExtraSeal` em `src/utils/internal/session.ts`, após `kLegacySeal`, com `Symbol.for("h3.internal.session.extra-seal")` e o mesmo padrão `/* @__PURE__ */` já usado. Ele marca a sessão aberta por senha extra (D-02). Não exportar em `src/index.ts`.

**Cobre:** RF-07 (suporte: marcador usado para a reselagem)

**Depende de:** nenhuma

**Aceite:**
- `kExtraSeal` existe em `src/utils/internal/session.ts` e segue o padrão de `kLegacySeal`.
- `src/index.ts` não muda.
- `pnpm vitest run test/unit/` passa, incluindo `test/unit/package.test.ts` sem alteração.
- `pnpm lint` passa.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-03 — Testes de selagem, ordem de tentativas e header (RF-02 a RF-05)

Escrever, dentro de `describeMatrix("session", ...)` em `test/session.test.ts`, antes do bloco de legado (após a linha 186), os testes abaixo. Usar `seal` e `unseal` de `src/utils/internal/iron-crypto.ts` para criar cookies com `P`, `A`, `B` e `C`. Senhas com 32 ou mais caracteres.

- RF-02: sessão nova emite cookie que abre com `unseal(valor, P)` e falha com `unseal(valor, A)` (`Bad hmac value`).
- RF-03: com `password: P` e `extraUnsealPasswords: [A, B]`, cookie selado com `B` carrega o mesmo `id`, `createdAt` e `data`. Cookie com `P` dá o mesmo resultado. Cookie com chave `C` desconhecida vira sessão nova, sem dados.
- RF-04: cookie selado com `A` enviado no header `x-h3-session` é carregado com os dados originais. `updateSession` com cookie selado com `A` mantém os dados antigos e acrescenta os novos, e o cookie emitido abre com `P`.
- RF-05: sem `extraUnsealPasswords`, e com `[]`, o token tem 8 partes, `[0] === "Fe26.2"` e `[1] === ""`.
- RF-01: um teste de tipo com `@ts-expect-error` para `extraUnsealPasswords: "uma-string"`, e outro sem o campo, ambos compilando.

Não alterar as expectativas dos testes existentes.

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05

**Depende de:** T-01 (o teste de tipo precisa do campo para ser significativo)

**Aceite:**
- `pnpm vitest run test/session.test.ts` mostra os testes novos de RF-03 e RF-04 falhando antes da implementação. Os de RF-02 e RF-05 já podem passar, porque o comportamento atual é o mesmo; isso precisa ser dito no relatório.
- Os testes existentes do arquivo passam sem alteração.
- `pnpm typecheck` compila os testes de tipo.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de legado e reselagem (RF-06 e RF-07)

Na sequência de T-03, no mesmo arquivo, adicionar:

- RF-06: sessão legada (1 iteração PBKDF2) selada com `A`. Com `legacySealFallback` padrão, `getSession` carrega os dados originais e emite novo cookie que abre com `P`. Com `legacySealFallback: false`, a sessão é tratada como ausente. Seguir a forma de criação do selo legado usada nos testes existentes (`test/session.test.ts`, linhas 134 a 186).
- RF-07: cookie selado com `A` gera `Set-Cookie` cujo valor abre com `P` e falha com `A`. Reler esse cookie com a configuração sem `extraUnsealPasswords` carrega os dados originais. Sessão com `A` enviada pelo header `x-h3-session` é carregada e não gera `Set-Cookie`.

**Cobre:** RF-06, RF-07

**Depende de:** T-03

**Aceite:**
- Os testes novos falham antes de T-06 e T-07, por causa da ausência da lógica de extras.
- Os testes de legado existentes (linhas 134 a 186) passam sem alteração.
- `pnpm vitest run test/session.test.ts` roda sem erro de sintaxe ou de tipo.

**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de validação, expiração e ordem do laço (RF-08, RF-09, D-01)

Na sequência de T-04, no mesmo arquivo, adicionar:

- RF-08: com `extraUnsealPasswords: ["curta"]`, `getSession` lança erro que cita o índice `0` e o mínimo de `32`. Com `[""]`, o mesmo. Com `[]`, não lança. A validação ocorre mesmo sem cookie na requisição.
- RF-09: com `A` e `maxAge: 60`, a sessão expira aos 61 segundos, com `vi.useFakeTimers({ toFake: ["Date"] })`, no mesmo padrão de `test/session.test.ts:188-190`. Com `A` e `idleTimeout: 60`, a sessão expira após 61 segundos ociosos.
- D-01: chamar `unsealSession` direto com um selo expirado e `extraUnsealPasswords` configuradas. Deve lançar `"Expired seal"` sem tentar as extras.

**Cobre:** RF-03 (ordem, via D-01), RF-08, RF-09

**Depende de:** T-04

**Aceite:**
- Os testes de RF-08 e de RF-09 falham antes de T-08, e o de D-01 passa após T-06. Isso precisa ser dito no relatório.
- Os testes existentes de expiração (linhas 188 a 229) passam sem alteração.
- `pnpm vitest run test/session.test.ts` executa em web e node.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Laço de tentativas em `unsealSession` (RF-03, RF-04, RF-05, RF-06, D-01)

Implementar a decisão D-01 da techspec:

- Criar `unsealWithPassword(sealed, password, sealOptions, legacySealFallback)` no fim de `src/utils/session.ts`. Ele contém o try/catch atual de `unsealSession` (linhas 322 a 348), com a senha recebida no lugar de `config.password`. Marca `kLegacySeal` quando abre pelo fallback.
- Substituir o corpo de `unsealSession` pelo laço da techspec, que tenta `password` e depois cada item de `extraUnsealPasswords`, na ordem. Só `"Bad hmac value"` avança para a próxima senha; qualquer outro erro é relançado na hora. Se nenhuma abrir, relançar o primeiro erro.
- Quando a senha que abriu não é a de índice 0, marcar o objeto com `kExtraSeal`.
- Assinatura de `unsealSession` sem alteração. Não exportar `unsealWithPassword`. Não dividir o arquivo, mesmo acima de 200 linhas: registrar como dívida.
- Não mexer em `getSession` nesta tarefa. A reselagem e a leitura de `kExtraSeal` ficam para T-07.

**Cobre:** RF-03, RF-04, RF-05, RF-06

**Depende de:** T-01, T-02, T-05 (todos os testes em vermelho antes da implementação)

**Aceite:**
- Os testes de RF-02, RF-03, RF-04 e RF-05 de T-03 passam.
- Os testes de RF-06 de T-04 passam para a parte de carga da sessão legada. A parte de `Set-Cookie` continua em vermelho até T-07.
- O teste de D-01 de T-05 passa.
- Os testes de concorrência (linha 99) e de criação preguiçosa (linha 692) passam sem alteração.
- `pnpm vitest run test/session.test.ts` roda, e a lista de falhas é só o que T-07 e T-08 devem resolver.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Reselagem de sessões abertas por senha extra (RF-07, RF-09, D-02, D-04)

Em `getSession` (linhas 196 a 221 de `src/utils/session.ts`):

- Ler `kExtraSeal` do objeto aberto, junto com `kLegacySeal`.
- Remover `kExtraSeal` com `delete` antes do `Object.assign`. Sem isso, o símbolo vai para a sessão.
- Estender a condição da reselagem para `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))`.
- Atualizar o comentário das linhas 211 a 213 para dizer que a sessão também é resselada quando foi aberta por senha extra.

Sessões lidas pelo header continuam sem reselagem, porque `sessionFromCookie` é falso. `maxAge` e `idleTimeout` não mudam (RF-09 vale sem código novo).

**Cobre:** RF-07, RF-09

**Depende de:** T-02, T-06

**Aceite:**
- Os testes de RF-07 de T-04 passam.
- O teste de RF-09 de T-05 passa (ou, se ainda falhar por causa de RF-08, a falha precisa ser só da validação, que é T-08).
- Nenhum símbolo interno aparece em `session.data` ou no objeto da sessão. Verificar em um teste ou na inspeção do `Object.assign`.
- Os testes de concorrência e de criação preguiçosa passam sem alteração.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Validação de `extraUnsealPasswords` em `getSession` (RF-08, D-03)

Adicionar `assertExtraUnsealPasswords(config)` como primeira instrução de `getSession`, antes do retorno da sessão já existente (linhas 158 a 165) e antes do placeholder (linhas 157 a 173).

- A função fica no fim de `src/utils/session.ts`, não exportada.
- O tamanho mínimo é `max(encryption.minPasswordlength, integrity.minPasswordlength)` de `{ ...sealDefaults, ...config.seal }`, que dá 32 com os defaults.
- Para cada item, se não for string ou tiver tamanho menor que o mínimo, lançar `Error("extraUnsealPasswords[${i}] must be at least ${minLength} characters")`.
- Não validar `password`, conforme PRD (Premissas).
- Não colocar a validação dentro de `unsealSession`: o `.catch(() => {})` engoliria o erro.

**Cobre:** RF-08

**Depende de:** T-05, T-07 (mesmo arquivo; T-05 precisa estar em vermelho antes)

**Aceite:**
- Os testes de RF-08 de T-05 passam.
- Com config inválida, `getSession` lança antes de ler o cookie e não deixa sessão no `context.sessions`. Isso precisa ser verificado por teste ou por leitura.
- Com `password` curta, o comportamento é o de hoje: nenhuma validação nova.
- `pnpm vitest run test/session.test.ts` passa por inteiro.

**Arquivos:** `src/utils/session.ts`

---

### T-09 — Documentação da rotação de senha

Em `docs/4.examples/handle-session.md`, adicionar a subseção "Rotate the password" antes de "## Expiration" (linha 151), em inglês, no estilo do arquivo. Conteúdo:

- Como girar `password`: mover a senha atual para `extraUnsealPasswords` e definir a nova em `password`.
- Que a senha antiga deve sair da lista quando as sessões que ela selou expirarem.
- Que sessões lidas pelo cookie migram para `password` na leitura; sessões lidas pelo header não migram.
- Que sessões sem `maxAge` nem `idleTimeout` não expiram, então a senha antiga fica na lista até o desenvolvedor aceitar perdê-las.
- Recomendação de poucas senhas (2 ou 3), por causa do custo de PBKDF2 por tentativa.

Não editar `docs/2.utils/4.security.md`: ele é gerado pelo automd. Não rodar `pnpm fmt`, para não regenerar arquivos fora do escopo.

**Cobre:** nenhum RF diretamente. Mitiga os riscos "Senha antiga vazada" e "Custo de CPU" do PRD.

**Depende de:** nenhuma

**Aceite:**
- A subseção existe antes de "## Expiration", com os cinco pontos acima.
- `pnpm lint` passa.
- Nenhum outro arquivo de docs muda.

**Arquivos:** `docs/4.examples/handle-session.md`

---

### T-10 — Verificação final e conformidade com o PRD

Rodar a suíte completa e conferir que a superfície pública não mudou além do campo.

- `pnpm test` (lint, typecheck e cobertura).
- `pnpm vitest run test/unit/`, com `test/unit/package.test.ts` sem alteração.
- Conferir no diff que `src/index.ts` não muda e que `src/utils/session.ts` não exporta nada novo além do campo em `SessionConfig`.
- Conferir que o token continua `Fe26.2` com 8 partes.
- Listar no relatório o que foi verificado e o que ficou como dívida (tamanho de `src/utils/session.ts` acima de 200 linhas; custo de CPU sem limite rígido de senhas).

Esta tarefa não altera arquivos. Falhas voltam para a tarefa responsável.

**Cobre:** RF-10, e regressão de todos os RF-01 a RF-09

**Depende de:** T-07, T-08, T-09

**Aceite:**
- `pnpm test` termina sem erro.
- `pnpm vitest run test/unit/` passa.
- O diff toca somente os arquivos listados nas tarefas.

**Arquivos:** nenhum (apenas execução e conferência)

---

## Cobertura dos requisitos do PRD

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-03 |
| RF-02 | T-03 |
| RF-03 | T-03, T-05, T-06 |
| RF-04 | T-03, T-06 |
| RF-05 | T-03, T-06 |
| RF-06 | T-04, T-06 |
| RF-07 | T-02, T-04, T-07 |
| RF-08 | T-05, T-08 |
| RF-09 | T-05, T-07 |
| RF-10 | T-02, T-10 |
