# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

Hoje `useSession` / `getSession` / `unsealSession` (`src/utils/session.ts`) aceitam uma única senha, `SessionConfig.password`, que sela e abre todas as sessões. Ao rotacionar essa senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários são desconectados.

A issue h3js/h3#1050 pede que a rotação não invalide sessões existentes. Esta variante resolve isso com um campo novo em `SessionConfig`, `extraUnsealPasswords`, que lista senhas anteriores usadas apenas para abrir sessões.

**Objetivo:** permitir a rotação de `password` sem invalidar sessões seladas com as senhas anteriores listadas, mantendo o comportamento atual quando o campo não é usado.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado como senhas anteriores que só abrem sessões. `password` continua sendo `string` e continua sendo a única senha usada para selar.

**Critério de aceite:**

- **Dado** uma configuração com `password` e `extraUnsealPasswords: ["senha-antiga-com-32-caracteres-ou-mais"]`,
- **Quando** o código de TypeScript for verificado (`pnpm typecheck`),
- **Então** a configuração compila, e `extraUnsealPasswords` aceita um `string[]` e não é obrigatório.

### RF-02 — Abertura tenta `password` e depois as extras, em ordem

Ao abrir uma sessão, `unsealSession` tenta `password` primeiro e, se a verificação falhar, tenta cada senha de `extraUnsealPasswords` na ordem em que foram declaradas. A primeira que verificar a sessão é a usada.

**Critério de aceite:**

- **Dado** uma sessão selada com a senha `B`, e uma configuração com `password: A` e `extraUnsealPasswords: [B]`,
- **Quando** a requisição chega com o cookie dessa sessão e `useSession` ou `getSession` é chamado,
- **Então** a sessão é carregada com os dados originais e `id` e `createdAt` preservados.

### RF-03 — Selagem sempre com `password`

Extras nunca são usadas para selar. Qualquer escrita (`updateSession`, `sealSession`, `clear` ou regravação por deslizamento de `idleTimeout`) sela com `password`.

**Critério de aceite:**

- **Dado** uma sessão aberta com a senha extra `B`, e configuração com `password: A`,
- **Quando** `updateSession` grava dados nessa sessão,
- **Então** o cookie resultante abre com `A` e não abre com `B`.

### RF-04 — Sem extras, comportamento inalterado

Quando `extraUnsealPasswords` está ausente ou é `[]`, o comportamento de `useSession`, `getSession`, `updateSession` e `unsealSession` é o mesmo de hoje, inclusive o fallback de iterações legadas (`legacySealFallback`) e a regravação de sessões legadas.

**Critério de aceite:**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente em `test/session.test.ts` é executada,
- **Então** todos os testes que passavam antes continuam passando, sem alteração nas asserções.

### RF-05 — Falha de verificação com todas as senhas

Se nenhuma senha (`password` nem extras) verificar a sessão, o resultado é o mesmo de hoje quando a única senha falha: `getSession` trata o cookie como inválido e inicia uma sessão nova.

**Critério de aceite:**

- **Dado** uma sessão selada com a senha `C`, que não está entre `password` nem `extraUnsealPasswords`,
- **Quando** `getSession` é chamado com esse cookie,
- **Então** a sessão retornada tem um `id` novo, diferente do id do cookie, e nenhum dado da sessão antiga é exposto.

### RF-06 — Só a falha de senha passa para a próxima

A troca para a próxima senha acontece apenas quando a verificação falha por senha incorreta (o erro `Bad hmac value` do iron). Outros erros, como sessão expirada pelo `ttl` do seal, formato inválido ou senha curta demais, não são mascarados: são propagados como hoje.

**Critério de aceite:**

- **Dado** uma sessão selada com `B` e expirada pelo `ttl`, e uma configuração com `password: A` e `extraUnsealPasswords: [B]`,
- **Quando** `unsealSession` é chamado,
- **Então** o erro de expiração é lançado e não há uma tentativa de abertura com outra senha que mascare a causa.

### RF-07 — Validação de extras

Cada senha em `extraUnsealPasswords` segue a mesma regra de `password`: pelo menos 32 caracteres (`minPasswordlength` do iron). Uma extra inválida gera erro explícito, em vez de ser ignorada silenciosamente. Uma extra igual a `password` é aceita, mas não causa tentativa repetida.

**Critério de aceite:**

- **Dado** `extraUnsealPasswords: ["curta"]`,
- **Quando** a sessão é usada com essa configuração,
- **Então** um erro indicando senha curta é lançado, e a sessão não é silenciosamente tratada como nova.

### RF-08 — Compatibilidade com o fallback legado

O fallback de iterações legadas (`legacySealFallback`, 1 iteração PBKDF2) deve funcionar também para sessões seladas com uma senha extra. A ordem é: para cada senha, tenta-se a configuração atual e, se configurado e aplicável, a configuração legada.

**Critério de aceite:**

- **Dado** uma sessão selada com a senha extra `B` usando 1 iteração PBKDF2, e configuração com `password: A` e `extraUnsealPasswords: [B]`,
- **Quando** `getSession` é chamado,
- **Então** a sessão abre e é regravada com `A` e as opções atuais, como acontece hoje com sessões legadas.

## Fora de escopo

- Aceitar um array em `password`, a segunda alternativa da issue #1050.
- Nomes públicos novos, como uma opção separada para selar, uma função de rotação ou um evento de "sessão com senha antiga".
- Regravação em massa ou job de migração de sessões antigas. A regravação é só a que já acontece hoje (escrita, deslizamento, legado).
- Retirar senhas antigas automaticamente ou por tempo. A retirada é feita pelo usuário ao remover a senha de `extraUnsealPasswords`.
- Sessões lidas do header `x-h3-session`. Elas não são regravadas, então continuam abertas com a senha antiga até expirar. Isso já é o comportamento atual e não muda.
- Mudanças em `legacySealFallback` ou na remoção dele na v3.
- Documentação fora do JSDoc de `SessionConfig`, como guias ou changelog.

## Premissas

- A ordem de tentativa das senhas é a declarada no array, e `password` é sempre a primeira.
- O custo de tentar várias senhas (PBKDF2 por senha) é aceitável para o volume de requisições de sessões, pois a maioria das sessões abre com `password` na primeira tentativa.
- O erro de senha incorreta do iron é `Bad hmac value`, como o código atual já assume em `unsealSession`.
- O `ttl` do seal e os limites `maxAge` e `idleTimeout` continuam sendo verificados independentemente da senha usada.
- A suíte `test/session.test.ts` e os testes de tipo existentes cobrem o caminho sem extras.

## Riscos

- **Tempo de resposta:** uma sessão com senha antiga, ou um cookie inválido, passa por todas as senhas antes de falhar. Com várias extras e PBKDF2 de 8192 iterações, isso aumenta a latência de requisições com cookie inválido. Mitigação: manter a lista curta e documentar isso no JSDoc.
- **Senha antiga esquecida:** se a senha antiga não for removida, ela continua válida para abrir sessões indefinidamente. Mitigação: documentar que a remoção de extras é um ato manual.
- **Interação com o fallback legado:** combinar a lista de senhas com as duas configurações de iterações pode dobrar as tentativas. Mitigação: a ordem de RF-08 e um teste explícito do caso.
- **Erro mascarado:** capturar qualquer erro e tentar a próxima senha esconderia expirações e erros de formato. Mitigação: RF-06, com a captura restrita a `Bad hmac value`.
- **Vazamento de chave antiga:** uma senha antiga guardada em configuração continua sendo um segredo ativo. Mitigação: fora de escopo, mas documentar que a senha antiga deve ser tratada como segredo até ser removida.
