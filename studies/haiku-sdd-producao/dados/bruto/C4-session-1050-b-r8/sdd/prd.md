# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje cada sessão do H3 é selada com uma única senha, configurada em `password` no `SessionConfig` usado por `useSession` / `getSession` (`src/utils/session.ts`). Quando um time roda rotação de segredos e troca essa senha, todas as sessões seladas com a senha antiga deixam de abrir: os usuários são deslogados de uma vez.

O objetivo é permitir a rotação sem derrubar sessões: o desenvolvedor informa senhas anteriores, que só servem para abrir sessões já existentes, enquanto a senha atual continua sendo a única usada para selar. Com isso, as sessões migram para a senha nova à medida que são lidas, e as senhas antigas podem ser removidas depois de um período.

Esta é a variante da issue #1050 que usa um campo novo, `extraUnsealPasswords`. A alternativa de aceitar `password` como array foi descartada nesta variante.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` no `SessionConfig`

O `SessionConfig` aceita o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores. Nenhum outro nome público novo é introduzido. `password` continua sendo `string`.

- **Dado** um `SessionConfig` com `password: "senha-nova..."` e `extraUnsealPasswords: ["senha-antiga..."]`
- **Quando** o tipo é verificado pelo TypeScript
- **Então** a configuração compila sem erro, e `extraUnsealPasswords` é reconhecido como `string[]` opcional

### RF-02 — Ordem de tentativa de abertura

Ao abrir uma sessão, o H3 tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem em que foram informados. A primeira senha que abre a sessão é a usada.

- **Dado** uma sessão selada com a senha da lista `extraUnsealPasswords[1]`
- **Quando** uma requisição chega com esse cookie
- **Então** a sessão é aberta, com os mesmos dados que tinha antes da rotação

### RF-03 — Selagem sempre com `password`

Novas sessões e sessões regravadas são seladas somente com `password`. As senhas em `extraUnsealPasswords` nunca são usadas para selar.

- **Dado** uma configuração com `password: "A"` e `extraUnsealPasswords: ["B"]`
- **Quando** uma sessão é criada ou atualizada e o cookie resultante é selado
- **Então** o cookie abre com `"A"` e não abre com `"B"`

### RF-04 — Migração para a senha atual na leitura

Quando uma sessão é aberta com uma senha de `extraUnsealPasswords`, o H3 a regrava selada com `password`, na mesma requisição, para que a rotação avance sem depender de nenhuma ação extra do desenvolvedor.

- **Dado** uma sessão selada com `"B"` (senha extra), e a configuração atual com `password: "A"`, `extraUnsealPasswords: ["B"]`
- **Quando** a requisição lê a sessão com sucesso
- **Então** a resposta contém um cookie novo selado com `"A"`, e uma requisição seguinte, com `extraUnsealPasswords` vazio, abre a sessão com `"A"`

### RF-05 — Comportamento inalterado sem senhas extras

Quando `extraUnsealPasswords` não é informado ou é vazio, o comportamento é o mesmo de hoje, incluindo erros, expiração (`maxAge`, `idleTimeout`) e o fallback legado de PBKDF2 (`legacySealFallback`).

- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** a suíte existente de sessões é executada
- **Então** todos os testes que passavam antes continuam passando sem alteração de asserção

### RF-06 — Falha quando nenhuma senha abre a sessão

Se nenhuma das senhas abre o cookie, a sessão é tratada como inexistente ou inválida, exatamente como hoje acontece com uma senha errada. O erro não revela qual senha foi tentada.

- **Dado** uma sessão selada com `"C"` e a configuração com `password: "A"`, `extraUnsealPasswords: ["B"]`
- **Quando** a requisição lê a sessão
- **Então** a sessão vem vazia (sem `id` e sem dados), como acontece com uma senha errada hoje, e nenhum erro é propagado para a aplicação

### RF-07 — Fallback legado para senhas extras

O fallback legado de iterações PBKDF2 (`legacySealFallback`) vale também para as senhas extras. Uma sessão antiga, selada com senha extra e com 1 iteração, abre e é migrada, como uma sessão selada com `password` já é hoje.

- **Dado** uma sessão selada com `"B"` usando 1 iteração PBKDF2, e a configuração com `extraUnsealPasswords: ["B"]`
- **Quando** a requisição lê a sessão
- **Então** a sessão abre e é regravada com a senha atual e as iterações atuais

- **Dado** a mesma sessão e a configuração com `legacySealFallback: false`
- **Quando** a requisição lê a sessão
- **Então** a sessão não abre, como hoje

### RF-08 — Valor inválido em `extraUnsealPasswords`

Cada item de `extraUnsealPasswords` recebe a mesma validação de `password`: strings vazias são recusadas ao criar a sessão, com o mesmo erro que `password` vazia produz hoje.

- **Dado** uma configuração com `extraUnsealPasswords: [""]`
- **Quando** a sessão é usada pela primeira vez
- **Então** o H3 lança erro informando senha vazia, da mesma forma que para `password: ""`

### RF-09 — Cobertura nos dois caminhos de leitura

A abertura com senhas extras vale tanto para o cookie de sessão quanto para o cabeçalho de sessão lido pelo `getSession` (o caminho em que a sessão não é regravada), inclusive na documentação do campo.

- **Dado** uma sessão selada com `"B"` enviada no cabeçalho de sessão, e a configuração com `extraUnsealPasswords: ["B"]`
- **Quando** a requisição lê a sessão pelo cabeçalho
- **Então** os dados da sessão são retornados normalmente, sem regravação do cookie (comportamento atual desse caminho)

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050).
- Selar com mais de uma senha, ou escolher a senha de selagem por configuração.
- Rotação automática, agendamento ou invalidação forçada de sessões antigas.
- Remover ou alterar o fallback legado de PBKDF2 (o item de remoção em v3 continua como está).
- Mudanças em outros utilitários de segredo (`sealSession` e `unsealSession` continuam sendo as funções internas de `session.ts`, sem nova API pública).
- Mudanças no formato do cookie ou em chunked cookies além do que a leitura com senha extra exige.
- Documentação de guia de migração fora do JSDoc do campo.

## Premissas

- A ordem de tentativa é `password` primeiro e depois as extras na ordem da lista. Não há prioridade por data ou por identificador.
- As senhas extras têm o mesmo requisito de entropia de `password` (no JSDoc atual, mínimo de 32 caracteres). Assume-se que a equipe quer esse requisito também para as extras, pois uma senha antiga fraca continuaria sendo o elo fraco. Se não quiser, a validação de tamanho fica fora desta entrega e só a vacuidade é checada (RF-08).
- O custo de tentar N senhas é aceitável para o volume esperado, pois só ocorre em sessões que não abrem com a senha atual, e a migração na leitura faz as sessões antigas deixarem de precisar de tentativas extras.
- A regravação na leitura (RF-04) reaproveita o caminho já existente de reselagem de sessões legadas em `getSession`, sem mudar o contrato de resposta.
- Os testes vivem em `test/session.test.ts` e rodam nos modos `web` e `node` via `describeMatrix`.
- `pnpm lint` e `pnpm typecheck` precisam passar ao final.

## Riscos

- **Custo de CPU (PBKDF2):** cada senha extra testada multiplica o trabalho de unseal para cookies que não abrem na primeira tentativa. Um cliente com cookie inválido pode forçar N+1 derivações (e o dobro se o fallback legado disparar). Mitigação: documentar o custo, manter a lista curta e remover senhas antigas após a janela de rotação.
- **Senha antiga vazando:** manter `extraUnsealPasswords` por muito tempo mantém aberta a superfície de cookies selados com a senha antiga. Mitigação: documentar que a lista deve ser removida após a janela de rotação, e que a migração RF-04 só tira valor da senha antiga quando as sessões são lidas.
- **Sessões que nunca são lidas de novo:** quem não voltar ao site continua com cookie selado pela senha antiga e deixa de abrir depois da remoção. Isso é o comportamento esperado da rotação, mas precisa estar na documentação.
- **Regravação indesejada:** se a regravação RF-04 disparar em toda leitura com senha extra, pode haver escrita extra de cookie por requisição. Mitigação: regravar só quando a senha usada não for `password`, e conferir que não há loop de regravação.
- **Mensagens de erro:** o erro de senha inválida não pode indicar qual senha foi tentada, para não ajudar a adivinhar segredos.
