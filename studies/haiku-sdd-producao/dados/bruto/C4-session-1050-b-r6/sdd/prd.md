# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` / `getSession` (`src/utils/session.ts`) selam e abrem sessões com uma única senha, `SessionConfig.password`. Ao rotacionar essa senha, todas as sessões já emitidas deixam de abrir e os usuários são desconectados.

O objetivo é permitir que a aplicação troque a senha de selagem sem invalidar as sessões seladas com senhas anteriores. A mudança adiciona um campo opcional `extraUnsealPasswords: string[]` em `SessionConfig`: `password` continua sendo a única senha usada para selar, e as senhas extras servem apenas para abrir sessões antigas.

Esta é a primeira alternativa proposta na issue h3js/h3#1050. A alternativa de aceitar `password` como array não entra neste escopo.

## Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado como senhas anteriores usadas somente para abrir sessões. Nenhum outro nome público novo é introduzido.

**Critério de aceite**
- **Dado** uma configuração de sessão com `password` e `extraUnsealPasswords` preenchidos,
- **Quando** o tipo `SessionConfig` é usado no código,
- **Então** o campo é aceito como `string[]` opcional e `password` continua tipado como `string`.

### RF-02 — Abrir sessão tentando as senhas em ordem

Ao abrir uma sessão, H3 tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem em que aparecem. A primeira senha que abre o selo é usada.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `B` e uma configuração com `password = A` e `extraUnsealPasswords = [B]`,
- **Quando** a sessão é lida numa requisição,
- **Então** os dados da sessão são retornados sem erro.

### RF-03 — Selar sempre com `password`

Sessões novas e sessões regravadas são seladas somente com `password`. As senhas extras nunca são usadas para selar.

**Critério de aceite**
- **Dado** uma configuração com `password = A` e `extraUnsealPasswords = [B]`,
- **Quando** uma sessão é criada ou atualizada,
- **Então** o cookie gerado só abre com `A` e não abre com `B`.

### RF-04 — Compatibilidade sem senhas extras

Quando `extraUnsealPasswords` está ausente ou é um array vazio, o comportamento é idêntico ao atual, incluindo os erros lançados e o fallback de selo legado (`legacySealFallback`).

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`) e uma sessão selada com outra senha,
- **Quando** a sessão é lida,
- **Então** o resultado é o mesmo de hoje: a sessão é tratada como inválida e substituída, sem tentar outras senhas.

### RF-05 — Falha quando nenhuma senha abre a sessão

Se nenhuma senha da lista abre o selo, a leitura falha pelo mesmo caminho de hoje para um selo inválido.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `C` e uma configuração com `password = A` e `extraUnsealPasswords = [B]`,
- **Quando** a sessão é lida,
- **Então** nenhum dado de sessão é retornado e o comportamento para selo inválido é o mesmo de hoje.

### RF-06 — Senha extra inválida não bloqueia as demais

Uma senha extra que o iron recusa (por exemplo, menor que o mínimo de 32 caracteres) não pode impedir que as outras senhas da lista sejam tentadas.

**Critério de aceite**
- **Dado** `extraUnsealPasswords = ["curta", B]`, com `B` válida e a sessão selada com `B`,
- **Quando** a sessão é lida,
- **Então** a sessão é aberta com `B`.

### RF-07 — Regravação de sessões abertas com senha extra

Quando uma sessão é aberta com uma senha extra, ela é regravada com `password` no mesmo fluxo em que hoje são regravados os selos legados. Assim, a rotação migra as sessões à medida que são usadas.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra `B` e uma configuração com `password = A`,
- **Quando** a sessão é lida numa requisição,
- **Então** a resposta traz um cookie novo selado com `A`, e a próxima leitura abre esse cookie usando apenas `A`.

### RF-08 — Fallback de selo legado com várias senhas

O fallback de selo legado (`legacySealFallback`) continua valendo. Ele só é tentado depois que nenhuma senha abre a sessão com as opções atuais, e percorre as senhas na mesma ordem de RF-02.

**Critério de aceite**
- **Dado** uma sessão legada selada com a senha extra `B` (1 iteração de PBKDF2) e uma configuração com `password = A` e `extraUnsealPasswords = [B]`,
- **Quando** a sessão é lida,
- **Então** a sessão é aberta pelo fallback legado com `B` e regravada com `A`.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050).
- Rotação automática, agendada ou por tempo; a troca das senhas continua manual pela configuração.
- Novas APIs para listar, validar ou remover senhas.
- Mudança no formato do selo ou no algoritmo de iron.
- Alterações em `clearSession`, cookies em partes (chunked) e no modo de sessão por header, além do que RF-07 exige.
- Remoção do fallback legado (continua previsto para a v3).
- Suporte a outros pontos de entrada além de `src/utils/session.ts`.

## Premissas e riscos

**Premissas**
- Todas as senhas da lista seguem a mesma regra de entropia de `password` (mínimo de 32 caracteres, gerada de forma aleatória). A documentação atual de `password` vale também para as extras.
- A regravação com `password` (RF-07) é o comportamento desejado. Se a aplicação não quiser que o cookie mude, é preciso decidir isso antes da implementação.
- Os testes existentes em `test/session.test.ts` continuam válidos. Só devem ser ajustados os casos que dependem do que a mudança altera, sem reduzir o que eles verificam.
- Verificação final: `pnpm lint` e `pnpm typecheck` passam.

**Riscos**
- **Custo de CPU:** cada senha extra tentada custa uma derivação PBKDF2. Com o fallback legado, o custo por requisição pode chegar a N senhas × 2 tentativas. Uma lista longa de senhas pode ser usada para degradar o servidor, então a documentação deve recomendar listas curtas.
- **Senha vazada continua válida:** enquanto uma senha estiver na lista, quem a tiver abre sessões. Remover a senha exige nova configuração e deploy.
- **Sessões que não são regravadas:** sessões lidas pelo header de sessão não são regravadas (ver `src/utils/session.ts`). Elas continuam com a senha antiga até expirar, e isso precisa aparecer na documentação.
- **Erros mascarados:** tentar várias senhas pode esconder erros de configuração. Por isso RF-05 exige o mesmo erro de hoje para selo inválido, sem mensagens que revelem quais senhas foram tentadas.
