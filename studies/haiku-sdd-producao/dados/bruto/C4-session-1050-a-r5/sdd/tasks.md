# Tarefas — várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-08), `sdd/techspec.md` (decisões D-01 a D-10; ordem de testes na seção 6).

## Ordem e cobertura

Ordem sugerida: testes primeiro (T-01, T-02, T-03, T-10), depois a implementação. Antes de T-04 a T-09, os cenários de lista em `test/session-password-list.test.ts` devem falhar; os cenários de senha única devem passar.

As tarefas T-06, T-07, T-08 e T-09 alteram o mesmo arquivo (`src/utils/session.ts`). Faça-as em sequência, na ordem dos ids.

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-01, T-02, T-05 |
| RF-02 | T-01, T-07 |
| RF-03 | T-01, T-08, T-09 |
| RF-04 | T-01, T-03, T-04, T-07 |
| RF-05 | T-01, T-04, T-06 |
| RF-06 | T-01, T-08, T-09 |
| RF-07 | T-01, T-08 |
| RF-08 | T-02, T-05, T-10 |

## Tarefas

### T-01 — Escrever os testes de comportamento da lista de senhas

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07

**Depende de:** nenhuma

**Aceite:** arquivo criado com `describeMatrix`, rodando em `web` e `node`, com os cenários da tabela da seção 6 do techspec:
- lista aceita como `password` na criação e na leitura;
- sessão selada com `[A, B]` abre com `[A]` e não abre com `[B]`;
- cookie selado só com `B` é lido com `[A, B]`, com dados carregados e cookie regravado com `A` (verificado com `unseal`);
- senha única como string e lista de um item geram token com id vazio e são lidos como hoje (confirma a premissa do PRD);
- `[]`, `["", A]`, `[A, 1]` e `[A, "curta"]` lançam `Invalid session password list` em `useSession`, `getSession` e `updateSession`, mesmo sem cookie;
- cookie selado com `C` dá o mesmo resultado que cookie selado com outra senha lido com senha única;
- cookie legado selado com `B` é regravado com `A`; com `legacySealFallback: false` não é aberto;
- sessão selada com `B` e expirada por `maxAge` não abre com nenhuma senha;
- sessão selada com `A` abre quando `A` está em segundo lugar (`[B, A]`).

Rodando `pnpm vitest run test/session-password-list.test.ts` antes das mudanças em `src`, os cenários de lista falham e os de senha única passam.

**Arquivos:** `test/session-password-list.test.ts` (novo)

---

### T-02 — Escrever o teste de tipo de `SessionConfig["password"]`

**Cobre:** RF-01, RF-08

**Depende de:** nenhuma

**Aceite:** em `test/unit/types.test-d.ts`, `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()` e a chamada `useSession(event, { password: ["…", "…"] })` estão presentes. Antes de T-05, `pnpm typecheck` falha nesse teste.

**Arquivos:** `test/unit/types.test-d.ts`

---

### T-03 — Ajustar `test/session.test.ts` para o novo tipo

**Cobre:** RF-04

**Depende de:** nenhuma

**Aceite:** a senha de `test/session.test.ts:23` vira constante `string`, usada nas chamadas de `seal` e `unseal` do iron (linhas ~137, ~157 e ~164), que não aceitam `string[]`. `pnpm vitest run test/session.test.ts` passa sem mudança de comportamento.

**Arquivos:** `test/session.test.ts`

---

### T-10 — Levantar os usos de `config.password` no projeto

**Cobre:** RF-08

**Depende de:** nenhuma

**Aceite:** busca em `src/` e `test/` por leituras de `config.password` e do campo `password` de `SessionConfig`. Os resultados ficam registrados (arquivo:linha) na descrição do PR. Se algum uso fora de `src/utils/session.ts` lê o campo como `string`, cria-se uma tarefa de ajuste antes de T-05.

**Arquivos:** nenhum (somente leitura)

---

### T-04 — Criar `sessionPasswords` em `src/utils/internal/session.ts`

**Cobre:** RF-01, RF-04, RF-05

**Depende de:** T-01

**Aceite:** função `sessionPasswords(config: SessionConfig): string[]`, com retorno explícito, no fim do arquivo, com import de `defaults` de `./iron-crypto.ts`:
- `config.password` que não é array devolve `[config.password]`, sem validação nova;
- array válido devolve a lista na mesma ordem;
- array vazio, item que não é string, string vazia ou item menor que `config.seal?.encryption.minPasswordlength ?? defaults.encryption.minPasswordlength` lança `Invalid session password list: …`, sem mostrar o conteúdo de nenhuma senha.

Os cenários de RF-05 de T-01 passam quando T-06 estiver pronta.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-05 — Atualizar o tipo público e o JSDoc de `SessionConfig.password`

**Cobre:** RF-01, RF-08

**Depende de:** T-02, T-03, T-10

**Aceite:** em `src/utils/session.ts:48`, o campo fica `password: string | string[]`. O JSDoc (linhas 40-47) diz, em linguagem direta:
- a primeira senha sela e as demais só abrem;
- sessão selada só com uma senha retirada da lista deixa de abrir;
- senha antiga na lista continua aceitando sessões até ser removida;
- o custo de abertura cresce com o número de senhas (uma tentativa de PBKDF2 por senha), então a lista deve ser curta.

O teste de tipo de T-02 passa. `src/index.ts` e `test/unit/package.test.ts` não mudam.

**Arquivos:** `src/utils/session.ts`

---

### T-06 — Validar a lista antes do `.catch` de `getSession`

**Cobre:** RF-05

**Depende de:** T-04, T-05

**Aceite:** `sessionPasswords(config)` é chamada no início de `getSession`, antes de qualquer alteração em `context.sessions` (linhas 149-153, antes da linha 155), com comentário explicando que o `.catch` logo abaixo engoliria o erro. `useSession`, `getSession` e `updateSession` lançam `Invalid session password list` mesmo sem cookie. Os cenários de RF-05 de T-01 passam.

**Arquivos:** `src/utils/session.ts`

---

### T-07 — Selar com a primeira senha da lista

**Cobre:** RF-02, RF-04

**Depende de:** T-04, T-05

**Aceite:** em `src/utils/session.ts:300`, a selagem usa `sessionPasswords(config)[0]`. Sessão selada com `[A, B]` abre com `A` e não abre com `B` isoladamente. `test/session.test.ts` continua passando.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Abrir com laço sobre as senhas e fallback legado por senha

**Cobre:** RF-03, RF-06, RF-07

**Depende de:** T-06, T-07

**Aceite:** o bloco `try/catch` de `src/utils/session.ts:322-348` vira `unsealWithPassword(sealed, password, sealOptions, config)`, com a lógica do fallback legado sem mudança, exceto pela senha recebida como parâmetro. `unsealSession` percorre `sessionPasswords(config)` em ordem e:
- retorna na primeira senha que abre;
- continua só quando o erro é `"Bad hmac value"`; outro erro é relançado na hora;
- se nenhuma senha abrir, relança o último `"Bad hmac value"`.

Cookie com senha que não está na lista dá o mesmo resultado de hoje (sessão nova). Os cenários de RF-03, RF-06 e RF-07 de T-01 passam, e `test/session.test.ts` (testes de legado) continua passando.

**Arquivos:** `src/utils/session.ts`

---

### T-09 — Checar expiração uma vez, depois do laço

**Cobre:** RF-03, RF-06

**Depende de:** T-08

**Aceite:** as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) ficam depois do laço e rodam uma vez, sobre o resultado já aberto. Sessão selada com `B` e expirada por `maxAge` não abre com nenhuma senha, e o cenário correspondente de T-01 passa.

**Arquivos:** `src/utils/session.ts`

---

### T-11 — Benchmark de custo com 1, 2 e 3 senhas (opcional)

**Cobre:** nenhum RF; mitiga o risco de custo de CPU do PRD e confirma a estimativa de D-06

**Depende de:** T-08

**Aceite:** `test/bench/session.ts` mede a leitura de cookie inválido com 1, 2 e 3 senhas, e `pnpm bench:node` roda. O resultado vai para a descrição do PR e serve de base para decidir o teto da lista (ponto 1 da seção 8 do techspec).

**Arquivos:** `test/bench/session.ts`

---

### T-12 — Verificação final e regressão

**Cobre:** RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08

**Depende de:** T-03, T-06, T-07, T-08, T-09

**Aceite:**
- `pnpm vitest run test/session-password-list.test.ts` passa;
- `pnpm vitest run test/session.test.ts test/unit/` passa;
- `pnpm typecheck` passa;
- `pnpm lint` passa. Se `oxlint` reclamar do `await` no laço, a correção preferida é reescrever sem supressão (techspec, seção 7);
- `pnpm vitest run` (suíte completa) passa.

**Arquivos:** nenhum (só execução de comandos)

---

## Pontos em aberto (techspec, seção 8)

As tarefas assumem os padrões abaixo. Confirmar antes de T-04 e T-11:
1. **Teto de tamanho da lista (D-08):** sem teto no código, só documentação. T-11 informa a decisão.
2. **Mínimo de comprimento dos itens (D-03):** validar com o `minPasswordlength` efetivo, como em T-04.
3. **Regravação com senha antiga (D-07):** sem novo gatilho, por estar fora do escopo do PRD.
