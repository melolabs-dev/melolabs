# Tarefas de implementação — Várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-07), `sdd/techspec.md` (D-01 a D-08). A ordem segue o fluxo de `AGENTS.md`: teste de regressão antes da implementação.

Mapa de cobertura:

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03, T-09 |
| RF-02 | T-02, T-05, T-07 |
| RF-03 | T-02, T-06, T-07 |
| RF-04 | T-01, T-08 |
| RF-05 | T-02, T-04, T-05, T-07 |
| RF-06 | T-02, T-07 |
| RF-07 | T-02, T-06 |

---

### T-01 — Trocar o acesso a `password` nos testes de senha única

Cobre: RF-04

Depende de: nenhuma

Aceite: nos três pontos citados em `techspec.md` (linhas 137, 157 e 164 de `test/session.test.ts`), as chamadas diretas de `seal`/`unseal` usam uma constante `string` (por exemplo, a constante `password` da linha 23) em vez de `sessionConfig.password`. `pnpm vitest run test/session.test.ts` passa sem outras alterações nos testes.

Arquivos: `test/session.test.ts`

---

### T-02 — Escrever os testes de regressão de listas (antes da implementação)

Cobre: RF-02, RF-03, RF-05, RF-06, RF-07

Depende de: T-01

Aceite: existe `describe("multiple passwords", ...)` dentro do `describeMatrix` em `test/session.test.ts`, antes da linha 692, com os 11 cenários do `techspec.md` (seção "Estratégia de testes"). Cada cenário cobre um requisito: selagem com a primeira senha, leitura de sessão antiga, nova gravação com a primeira senha, senha fora da lista, header de sessão, legado com senha antiga (com e sem `legacySealFallback: false`), lista vazia, lista de um item equivalente a string, validação de tamanho, e contagem de derivações com `vi.spyOn(crypto.subtle, "deriveBits")`. Ao rodar `pnpm vitest run test/session.test.ts` antes da implementação, os cenários de lista falham e os de senha única passam. O registro do resultado (quais falharam) fica na descrição do PR ou em nota de execução.

Arquivos: `test/session.test.ts`

---

### T-03 — Tipar `SessionConfig.password` como `string | string[]`

Cobre: RF-01

Depende de: T-02

Aceite: `SessionConfig.password` em `src/utils/session.ts` (linhas 39 a 48) tem o tipo exato `string | string[]` (D-07). O JSDoc descreve: a ordem da lista (a primeira sela, as demais só abrem), que a lista não pode ser vazia, o custo de uma derivação PBKDF2 por senha tentada, e que a senha antiga deve sair da lista após a transição. Confirmar com busca em `src/` que só `src/utils/session.ts` lê `config.password` (premissa do PRD). `pnpm typecheck` passa. Uma configuração com `password: ["senha-nova-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]` é aceita pelo tipo.

Arquivos: `src/utils/session.ts`

---

### T-04 — Criar os helpers de senha e a checagem de lista vazia

Cobre: RF-05

Depende de: T-03

Aceite: no fim de `src/utils/session.ts`, junto de `shouldSlide`, `stageSessionErrCookies` e `sessionExpires`, existem os helpers privados `sealPassword(config)` (retorna a primeira senha) e `unsealPasswords(config)` (retorna a lista como array). Ambos lançam `Session password list is empty: at least one password is required` quando a lista está vazia. Para string, o retorno é a própria string em array de um item, sem mudança de comportamento (RF-04). Nenhum símbolo novo é exportado, e `iron-crypto.ts` não muda (D-08). O teste de lista vazia de T-02 ainda falha nesta etapa, porque a checagem não está ligada aos caminhos públicos.

Arquivos: `src/utils/session.ts`

---

### T-05 — Selar com a primeira senha e validar lista vazia em `sealSession`

Cobre: RF-02, RF-05

Depende de: T-04

Aceite: a linha `seal(session, config.password, ...)` (linha 300) passa a usar `sealPassword(config)`. Com `password: [A, B]`, o selo abre com `A` e não abre com `B` (`unseal(cookie, B)` rejeita com `Bad hmac value`). Com `password: []`, `sealSession` lança a mensagem de lista vazia antes de qualquer derivação. Com `password: ["curta", B]`, `sealSession` lança `Password string too short`, o mesmo erro da senha única (D-06). Os cenários 1, 3 (reselagem) e 8 (lista vazia na gravação) de T-02 passam.

Arquivos: `src/utils/session.ts`

---

### T-06 — Implementar o laço de abertura com fallback legado por senha

Cobre: RF-03, RF-07

Depende de: T-04

Aceite: o helper `unsealWithPasswords(sealed, passwords, sealOptions, legacySealFallback)` existe no fim de `src/utils/session.ts`. Ele segue D-04 e D-05 do `techspec.md`:

- só `Bad hmac value` avança para a próxima senha; qualquer outro erro é relançado na hora;
- para cada senha, tenta o selo normal e depois o legado com 1 iteração, na mesma ordem de hoje (não tenta o legado se `legacySealFallback === false` ou se `sealOptions.integrity.iterations === 1`);
- o resultado do legado é marcado com `kLegacySeal`;
- se nenhuma senha abrir, relança o último `Bad hmac value`, sem indicar a posição da senha.

Os cenários 2, 4, 6 e 7 de T-02 passam (esta tarefa não liga o laço aos caminhos públicos; isso é T-07). Como `unsealWithPasswords` não recebe `config`, `legacySealFallback` entra como argumento. O `techspec.md` deixa a forma final a critério do implementador.

Arquivos: `src/utils/session.ts`

---

### T-07 — Ligar a abertura com lista em `unsealSession` e `getSession`

Cobre: RF-02, RF-03, RF-05, RF-06

Depende de: T-05, T-06

Aceite: `unsealSession` (linhas 312 a 348) chama `unsealWithPasswords(...)` com `unsealPasswords(config)` no lugar da chamada direta a `unseal`. As checagens de expiração (linhas 350 a 365) ficam como estão. O bloco `.catch` de `getSession` (linhas 196 a 198) continua engolindo erros de sessão inválida, mas a checagem de lista vazia roda antes dele, no topo de `getSession` (linha 153), para que a lista vazia falhe na leitura com a mensagem própria (D-06). Os cenários 1 a 5 e 8 de T-02 passam, incluindo a leitura pelo header de sessão (cenário 5). Os cenários de senha fora da lista (4) retornam sessão nova sem dados na leitura.

Arquivos: `src/utils/session.ts`

---

### T-08 — Verificar compatibilidade e a suíte completa

Cobre: RF-04

Depende de: T-07

Aceite: `pnpm vitest run test/session.test.ts` passa com todos os testes de senha única inalterados e todos os cenários de T-02. `pnpm typecheck` e `pnpm lint` passam. `pnpm test` completo (lint, typecheck e cobertura) passa. Se algum teste de senha única mudar de comportamento, a tarefa não está concluída: o caminho de string precisa ficar idêntico (RF-04). A contagem de derivações do cenário 11 confirma N-1 falhas mais o acerto para a última de três senhas.

Arquivos: `test/session.test.ts`, `src/utils/session.ts`

---

### T-09 — Documentar a lista de senhas e a rotação

Cobre: RF-01

Depende de: T-07

Aceite: `docs/4.examples/handle-session.md` tem um parágrafo sobre listas de senhas perto da linha 143 ("Every option is optional except `password`"). O parágrafo diz que a primeira senha sela, as demais só abrem, que a lista não pode ser vazia, que cada senha tentada custa uma derivação PBKDF2 (e que listas curtas são o caso de uso) e que a senha antiga deve sair da lista após o período de transição. O aviso de entropia perto da linha 37 recebe a mesma recomendação sobre a senha antiga. Nenhum arquivo gerado (`CHANGELOG.md`, saída do `changelogen`) é editado à mão. `pnpm lint` passa.

Arquivos: `docs/4.examples/handle-session.md`
