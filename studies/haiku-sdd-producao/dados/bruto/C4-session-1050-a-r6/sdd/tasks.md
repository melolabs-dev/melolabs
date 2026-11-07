# Tarefas de implementação: várias senhas de unseal nas sessões

Referências: `sdd/prd.md` (RF-01 a RF-07) e `sdd/techspec.md` (D-01 a D-07).

Regra de todas as tarefas que mudam comportamento: escrever primeiro os testes, confirmar que falham, depois implementar (AGENTS.md, "Bug Fix Workflow").

Pendências que afetam as tarefas (ver `sdd/techspec.md`, "Pendências para o usuário"): D-01 (tipo `string | string[]` ou tupla), D-05 (senha curta passa a lançar em `getSession`) e D-06 (limite de 4 entradas). As tarefas assumem a recomendação da techspec para as três; T-07 só é feita se D-06 for confirmado.

---

### T-01 — Validar e normalizar a lista de senhas

Criar `resolvePasswords` em `src/utils/internal/session.ts`. Ela aceita `string | string[]`, devolve sempre um array não vazio e lança erro de configuração para lista vazia ou entrada com menos de 32 caracteres (`sealDefaults.encryption.minPasswordlength`). A chamada roda antes de qualquer leitura ou selagem, para que o erro não seja engolido pelo `.catch(() => {})` de `getSession` e não deixe `context.sessions` pela metade.

Os testes devem cobrir `password: []` e `[novaValida, "curta"]` em `getSession`, `useSession` e `sealSession`, sem cookie na requisição, para provar que a validação roda antes da leitura. Confirmar também que uma string curta passa a lançar (D-05).

Cobre: RF-05, RF-04 (a string continua valendo; a validação só acrescenta erro para entradas inválidas)
Depende de: nenhuma
Aceite:
- Os testes novos falham antes da implementação e passam depois.
- `password: []` e `password: [valida, "curta"]` lançam em `getSession`, `useSession` e `sealSession`, mesmo sem cookie.
- A mudança de comportamento de senha curta fica registrada como pendente de confirmação (D-05).
- `resolvePasswords` tem tipo de retorno explícito (`isolatedDeclarations`).
- Arquivos: `src/utils/internal/session.ts`, `test/session.test.ts`

Arquivos:
- `src/utils/internal/session.ts`
- `test/session.test.ts`

---

### T-02 — Tipo público `password: string | string[]`

Alterar `SessionConfig.password` em `src/utils/session.ts:48` para `string | string[]` e atualizar o JSDoc (`src/utils/session.ts:41-47`) com a ordem das senhas (a primeira sela, as demais só abrem), a regra de 32 caracteres por entrada e a orientação para remover a senha antiga. Adicionar a asserção de tipo `SessionConfig["password"]` igual a `string | string[]`. Não usar tupla (D-01).

Cobre: RF-01 (tipo), RF-07 (parte do JSDoc que vira referência da documentação)
Depende de: nenhuma
Aceite:
- `pnpm vitest run test/unit` passa com a nova asserção de tipo.
- `pnpm typecheck` passa sem casts nos testes existentes.
- O JSDoc descreve a ordem das senhas e a regra por entrada.
- Arquivos: `src/utils/session.ts`, `test/unit/types.test-d.ts`

Arquivos:
- `src/utils/session.ts`
- `test/unit/types.test-d.ts`

---

### T-03 — Abrir sessões com qualquer senha da lista

Adicionar a função privada `unsealWithPasswords` e `isBadHmac` no fim de `src/utils/session.ts`. `unsealWithPasswords` tenta `unseal` com cada senha, em ordem, e só continua quando o erro é `"Bad hmac value"`. Qualquer outro erro (formato inválido, `Expired seal`, prefixo errado) é relançado na hora. Se nenhuma senha abrir, relança o último `"Bad hmac value"`, para que a mensagem de erro não mude (D-07). `unsealSession` passa a usar `resolvePasswords(config.password)` e `unsealWithPasswords` no lugar de `unseal` direto (`src/utils/session.ts:324`, `src/utils/session.ts:340-344`).

Testes: cookie e header selados só com a senha antiga (índice 1) são lidos; cookie selado com senha fora da lista vira sessão nova, sem dados e sem erro (RF-03); sessão além de `maxAge` continua rejeitada com lista (`Expired seal` não é mascarado pela iteração); `unsealSession` com senha desconhecida lança `"Bad hmac value"`.

Cobre: RF-01, RF-03
Depende de: T-01, T-02
Aceite:
- Cookie selado só com `senhaAntiga` em `[novaSenha, senhaAntiga]` retorna os dados sem erro.
- Header `x-h3-test-session` selado só com `senhaAntiga` retorna os dados sem erro.
- Cookie selado com `senhaRemovida` retorna sessão vazia, sem dados e sem lançar.
- Sessão expirada continua rejeitada com a mesma mensagem de hoje.
- `unsealSession` com senha desconhecida lança `"Bad hmac value"`.
- Nenhuma alteração em `src/utils/internal/iron-crypto.ts`.
- Arquivos: `src/utils/session.ts`, `test/session.test.ts`

Arquivos:
- `src/utils/session.ts`
- `test/session.test.ts`

---

### T-04 — Fallback de iterações legadas com cada senha

Garantir que o fallback legado (1 iteração, `src/utils/session.ts:332-339`) funcione com a lista. Conforme D-03, todas as senhas são tentadas com as iterações atuais primeiro; só se nenhuma abrir, todas são tentadas com 1 iteração. `kLegacySeal` (`src/utils/session.ts:346`) não muda.

Testes: sessão selada com a senha antiga com 1 iteração, com a senha no índice 1 e no índice 2 de uma lista, abre com `kLegacySeal`. Com `legacySealFallback: false`, a mesma sessão é rejeitada e vira sessão nova.

Cobre: RF-06
Depende de: T-03
Aceite:
- `unsealSession` retorna o objeto com `kLegacySeal` para a senha no índice 1 e no índice 2.
- Com `legacySealFallback: false` e lista, a sessão legada é rejeitada.
- Uma sessão atual com a senha no índice 1 não passa pelo caminho legado (uma única derivação de integridade por senha tentada, conforme D-03).
- Arquivos: `src/utils/session.ts`, `test/session.test.ts`

Arquivos:
- `src/utils/session.ts`
- `test/session.test.ts`

---

### T-05 — Selar sempre com a primeira senha

Fazer `sealSession` usar `resolvePasswords(config.password)[0]` (`src/utils/session.ts:300`). A validação roda antes de `session.lastSeenAt` ser alterado (`src/utils/session.ts:293-298`). Não criar mecanismo novo: `updateSession`, o reselamento de legado e o de deslizamento do `idleTimeout` (`src/utils/session.ts:214-216`, `src/utils/session.ts:267`) já passam por `sealSession`.

Testes: `sealSession` gera cookie que abre com `novaSenha` e não abre com `senhaAntiga`; `updateSession` sobre cookie de senha antiga gera `Set-Cookie` que abre com a primeira senha; o mesmo vale para o reselamento de sessão legada e para o deslizamento de `idleTimeout`.

Cobre: RF-02
Depende de: T-01
Aceite:
- O cookie de `sealSession` e o `Set-Cookie` de `updateSession` abrem com `unseal` da primeira senha e falham com a segunda.
- Com a ordem trocada na configuração, o teste detecta que a senha antiga está selando (é o caso que o teste existe para pegar).
- Arquivos: `src/utils/session.ts`, `test/session.test.ts`

Arquivos:
- `src/utils/session.ts`
- `test/session.test.ts`

---

### T-06 — Manter a compatibilidade com a senha única

Verificar que a senha única continua igual a hoje. A suíte existente de `test/session.test.ts` deve passar sem alteração de asserção. Adicionar um teste em que `password: [senha]` repete uma das asserções existentes (por exemplo, a de `test/session.test.ts:23`). Se alguma asserção existente quebrar, investigar a causa antes de qualquer ajuste, porque RF-04 exige que nada mude.

Cobre: RF-04
Depende de: T-03, T-05
Aceite:
- `pnpm vitest run test/session.test.ts` passa, e o `git diff` nas asserções existentes está vazio.
- O teste com lista de uma entrada passa nas duas plataformas (`web` e `node`).
- Arquivos: `test/session.test.ts`

Arquivos:
- `test/session.test.ts`

---

### T-07 — Limite de tamanho da lista (condicional a D-06)

Só fazer se o usuário confirmar D-06. Adicionar `MAX_SESSION_PASSWORDS = 4` em `src/utils/internal/session.ts` e validar o limite em `resolvePasswords`, com erro de configuração. Se D-06 for dispensado, esta tarefa não entra, e o restante das tarefas continua válido.

Cobre: sem RF próprio (PRD, "Fora de escopo" e "Riscos", custo de CPU sob ataque)
Depende de: nenhuma (bloqueada pela confirmação de D-06)
Aceite:
- Lista com 5 entradas lança erro de configuração, antes de qualquer leitura.
- Lista com 4 entradas continua aceita.
- Arquivos: `src/utils/internal/session.ts`, `test/session.test.ts`

Arquivos:
- `src/utils/internal/session.ts`
- `test/session.test.ts`

---

### T-08 — Documentação da rotação de senhas

Atualizar a documentação de sessões.

- `docs/2.utils/4.security.md`: adicionar um parágrafo manual depois do `<!-- /automd -->` (linha 74). O bloco automd de `:44-74` só gera as funções a partir do JSDoc, então o parágrafo não pode ficar dentro dele. O parágrafo explica a ordem das senhas, que a primeira sela e as demais só abrem, e quando a senha antiga pode sair.
- `docs/4.examples/handle-session.md`: adicionar a subseção "Rotacionar a senha" depois do aviso (linhas 36-43), com um exemplo `password: [nova, antiga]`.

Pontos que a doc precisa dizer, conforme a techspec: com `maxAge`, a senha antiga pode sair após `maxAge`; com só `idleTimeout`, após `idleTimeout` sem requisições; sem nenhum dos dois, a sessão não expira e remover a senha antiga desloga quem ainda tem cookie antigo; sessões lidas do header não são reseladas e continuam com a senha antiga até `maxAge` ou `idleTimeout` contado do selo original; trocar a ordem faz as sessões novas serem seladas com a senha antiga, sem erro.

Cobre: RF-07
Depende de: T-02, T-03, T-05
Aceite:
- Um leitor que procura "como rotacionar a senha" encontra o exemplo com `password` como lista e a ordem explicada nas duas páginas.
- Os cinco pontos acima estão escritos.
- `pnpm lint` passa (formatação `oxfmt`), e o bloco automd não é editado à mão.
- Arquivos: `docs/2.utils/4.security.md`, `docs/4.examples/handle-session.md`

Arquivos:
- `docs/2.utils/4.security.md`
- `docs/4.examples/handle-session.md`

---

### T-09 — Verificação final

Rodar a verificação completa, nesta ordem: `pnpm vitest run test/session.test.ts`; `pnpm vitest run test/unit`; `pnpm typecheck` e `pnpm lint`; `pnpm test` com cobertura; `pnpm bench:node` antes e depois da mudança, para confirmar que a senha única não ficou mais lenta. Se T-07 foi feita, medir também com N = 1, 2 e 4 para documentar o custo de cookies inválidos (opcional, em `test/bench/session.ts`).

Cobre: RF-04 (suíte existente sem alteração), e fecha a verificação de todos os RFs
Depende de: T-04, T-06, T-07, T-08
Aceite:
- Os cinco comandos passam, sem falhas.
- O resultado do bench antes e depois é registrado na descrição do PR, com a diferença observada.
- Nenhuma asserção existente em `test/session.test.ts` foi alterada.
- Arquivos: `test/session.test.ts`, `test/bench/session.ts` (opcional)

Arquivos:
- `test/session.test.ts`
- `test/bench/session.ts` (opcional)
