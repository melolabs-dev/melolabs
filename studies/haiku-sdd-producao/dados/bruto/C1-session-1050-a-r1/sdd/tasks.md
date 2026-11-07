# Tarefas de implementação — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-08) e `sdd/techspec.md` (D-01 a D-07, P-1 e P-2).

Ordem sugerida: T-01 → T-02 → (T-03, T-04, T-05 em paralelo) → (T-06, T-07) → T-08 → T-09 → T-10.

Pendências da techspec que afetam as tarefas. Enquanto não houver decisão, valem os padrões abaixo.

- **P-1 (tamanho mínimo em strings únicas):** padrão adotado: a checagem de tamanho vale para todas as entradas, inclusive string única (D-05, item 4). T-05 implementa assim.
- **P-2 (reselo em leitura):** padrão adotado: sem reselo novo; valem os gatilhos atuais (D-06). Não há tarefa para P-2. Se for aprovada, abrir nova tarefa.

---

### T-01 — Tipo público e JSDoc de `password`

Cobre: RF-01, RF-04

Trocar `password: string` por `password: string | string[]` em `SessionConfig` e atualizar o JSDoc: a lista é não vazia, a primeira senha sela, e todas tentam desselar em ordem. Manter o aviso de 32 caracteres. Sem alterar nenhuma lógica nesta tarefa, só o tipo e a documentação. Conferir que `src/index.ts` e `test/bench/session.ts` continuam compilando sem mudança.

Depende de: nenhuma

Aceite: `pnpm typecheck` passa. Uma configuração com `password: ["a", "b"]` é aceita pelo tipo em `useSession` e `getSession`. `pnpm vitest run test/session.test.ts` continua verde (RF-04).

Arquivos: `src/utils/session.ts`

---

### T-02 — Helpers `resolveSessionPasswords` e `unsealWithPasswords`

Cobre: RF-03, RF-05, RF-06, RF-07

Criar em `src/utils/internal/session.ts` os dois helpers da techspec:

- `resolveSessionPasswords(password)`: rejeita lista vazia com mensagem que diga que ao menos uma senha é necessária (RF-05); rejeita entrada vazia `""`; remove duplicadas preservando a ordem; verifica o tamanho mínimo de cada entrada usando `minPasswordlength` (ver P-1). Retorna `[string, ...string[]]`.
- `unsealWithPasswords(sealed, passwords, sealOptions, legacyFallback)`: para cada senha, tenta o selo atual; avança para a próxima só em `Bad hmac value`; com `legacyFallback`, tenta o selo de 1 iteração para a mesma senha antes de avançar; marca o resultado com `kLegacySeal` quando o legado abriu; relança o último `Bad hmac value` se nenhuma senha servir. Qualquer outro erro é relançado de imediato (D-03).

Reutilizar `kLegacySeal` já existente. Helpers ficam no fim do arquivo, com JSDoc curto no estilo do arquivo.

Depende de: T-01

Aceite: testes unitários em `test/unit/` (tarefa T-09) cobrem os dois helpers. Para este ponto, `pnpm typecheck` e `pnpm lint` passam, e a função `resolveSessionPasswords([])` lança a mensagem de RF-05.

Arquivos: `src/utils/internal/session.ts`

---

### T-03 — Selar sempre com a primeira senha

Cobre: RF-02

Em `sealSession`, usar `resolveSessionPasswords(config.password)[0]` como senha de selo, sem `id` (D-02). O formato do cookie não muda: `passwordId` continua vazio.

Depende de: T-02

Aceite: uma sessão criada com `["senha-nova", "senha-antiga"]` abre com `senha-nova` via `unseal` direto e não abre com `senha-antiga` (teste da tarefa T-06). `pnpm vitest run test/session.test.ts` passa.

Arquivos: `src/utils/session.ts`

---

### T-04 — Desselar com a lista de senhas

Cobre: RF-03, RF-06, RF-07

Em `unsealSession`, substituir o desselo com uma senha pelo helper da T-02. Manter a guarda existente `legacySealFallback !== false` e `sealOptions.integrity.iterations !== 1` e o TODO de remoção na v3 (`src/utils/session.ts:326-339`). Manter as checagens de `maxAge` e `idleTimeout` como estão.

Depende de: T-02

Aceite: cookie selado com `senha-antiga` é lido com `["senha-nova", "senha-antiga"]` e não cria sessão nova (RF-03). Cookie com `senha-removida` vira sessão inexistente, como senha errada hoje (RF-07). Testes da T-06 passam.

Arquivos: `src/utils/session.ts`

---

### T-05 — Validação da configuração antes do `.catch`

Cobre: RF-05

Chamar `resolveSessionPasswords(config.password)` no início de `getSession`, antes de tocar em `context.sessions` e antes do `.catch(() => {})` que envolve `unsealSession` (D-05). Também chamar em `sealSession` e `unsealSession`, para que a mensagem chegue ao chamador.

Depende de: T-02

Aceite: `password: []` faz `useSession`, `getSession` e `sealSession` lançarem erro com a mensagem de RF-05. A exceção não é engolida por `getSession`. Entrada vazia e senha abaixo de 32 caracteres também lançam erro claro, e a senha curta não bloqueia o laço de tentativas.

Arquivos: `src/utils/session.ts`

---

### T-06 — Testes de selo, desselo e compatibilidade

Cobre: RF-01, RF-02, RF-03, RF-04, RF-06, RF-07

Adicionar em `test/session.test.ts`, depois do teste de `legacySealFallback: false` (`:161-186`), um bloco `describeMatrix` (web e node) com:

- sela com a primeira senha: cookie abre com a nova e não abre com a antiga (RF-02);
- cookie selado com a antiga é lido por `getSession`, mantém o `id` e não cria sessão nova (RF-03);
- cookie legado (1 iteração) com a antiga é aberto, marcado como legado e resselado com a nova (RF-06);
- cookie com `senha-removida` vira sessão nova, como senha errada hoje (RF-07);
- lista de uma senha se comporta como string (RF-04).

Escrever os testes de RF-03 e RF-06 antes das T-03 e T-04 para vê-los falhar, conforme o fluxo de bug do `AGENTS.md`. Os testes existentes não são alterados.

Depende de: T-03, T-04

Aceite: `pnpm vitest run test/session.test.ts` passa em web e node. Antes da implementação, RF-03 e RF-06 falham.

Arquivos: `test/session.test.ts`

---

### T-07 — Testes de rotação pelo reselo

Cobre: RF-08

No mesmo bloco de testes da T-06, cobrir os gatilhos de reselo existentes com cookie selado pela senha antiga:

- escrita com `updateSession` grava cookie que abre só com a nova;
- desselo de selo legado resela com a nova (já coberto em RF-06, reforçar a asserção de que o cookie da resposta não abre com a antiga);
- deslizamento de `idleTimeout` grava cookie que abre só com a nova.

Depende de: T-04

Aceite: os três casos passam em web e node. Cada asserção confirma que o cookie da resposta não abre com `senha-antiga`.

Arquivos: `test/session.test.ts`

---

### T-08 — Testes de validação, duplicadas e expiração

Cobre: RF-05

Ainda em `test/session.test.ts`, cobrir:

- `password: []` rejeita `useSession`, `getSession` e `sealSession` com a mensagem de RF-05;
- entrada vazia dá erro claro;
- lista com duplicadas (`["a", "a", "b"]`) se comporta como `["a", "b"]`;
- sessão expirada continua expirada com lista de senhas: `Expired seal` não avança o laço (D-03).

Depende de: T-05

Aceite: os quatro casos passam em web e node, e o de expiração confirma que a segunda senha não é tentada.

Arquivos: `test/session.test.ts`

---

### T-09 — Testes unitários dos helpers

Cobre: RF-05, RF-03

Criar `test/unit/session-passwords.test.ts` (ou nome equivalente no padrão de `test/unit/`) com:

- `resolveSessionPasswords`: lista vazia, entrada vazia, duplicadas preservando ordem, tupla de retorno, senha curta;
- `unsealWithPasswords`: senhas erradas seguidas de uma correta; `Expired seal` relançado sem tentar as demais; fallback legado por senha.

Depende de: T-02

Aceite: `pnpm vitest run test/unit` passa.

Arquivos: `test/unit/session-passwords.test.ts`

---

### T-10 — Documentação da rotação

Cobre: RF-08

Em `docs/4.examples/handle-session.md`, junto ao aviso de entropia (`:37`), incluir uma nota curta sobre rotação com lista de senhas: a primeira senha sela, as demais só desselam; a senha antiga só sai de fato quando as sessões são reseladas (escrita, `idleTimeout`) ou expiram (`maxAge`); sem `maxAge` nem `idleTimeout`, uma sessão lida e não escrita continua aceita com a senha antiga; a ordem da lista define a prioridade; trocar a ordem muda a senha de selo sem aviso (techspec, Riscos). Documentar também a mudança de tipo de `password` para o changelog, se o repositório tiver um.

Depende de: T-03

Aceite: a nota existe, está em português, e o texto corresponde ao comportamento verificado nos testes de T-07 e T-08.

Arquivos: `docs/4.examples/handle-session.md`

---

### T-11 — Verificação final e medição de CPU

Cobre: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

Rodar a verificação completa e medir o custo de CPU da lista (risco do PRD).

- `pnpm lint` e `pnpm typecheck` passam;
- `pnpm vitest run test/session.test.ts test/unit` passam;
- `pnpm test` passa (lint, typecheck e cobertura);
- medir `test/bench/session.ts` com 1 senha e com uma lista de 3 a 5 senhas, e registrar o resultado na descrição da entrega.

Depende de: T-06, T-07, T-08, T-09, T-10

Aceite: todos os comandos acima passam. A medição é registrada com os números de uma senha e de 3 a 5 senhas. Se algum comando falhar, a saída é reportada sem ajuste dos testes existentes.

Arquivos: `package.json` (apenas leitura para confirmar os scripts), `test/bench/session.ts` (apenas execução)
