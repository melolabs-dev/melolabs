# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) é a única senha usada para selar e abrir sessões. Ao rotacionar o segredo, todos os cookies e cabeçalhos de sessão selados com a senha anterior falham no unseal. `getSession` descarta esses dados e cria uma sessão nova, e todos os usuários perdem a sessão de uma vez.

### Objetivo
Permitir a rotação de senhas sem invalidar as sessões existentes. A configuração ganha um campo opcional `extraUnsealPasswords: string[]` com as senhas anteriores. Essas senhas só abrem sessões. `password` continua sendo uma string e continua sendo a única que sela. Sem o campo, nada muda.

Referência: issue h3js/h3#1050, primeira alternativa proposta.

### Métricas de sucesso
- Uma sessão selada com uma senha listada em `extraUnsealPasswords` é aceita, com os mesmos dados e o mesmo `id`.
- Nenhuma sessão nova é selada com uma senha extra.
- A suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`
`SessionConfig` expõe `extraUnsealPasswords?: string[]`, documentado em TSDoc: só abre sessões, nunca sela, e a ordem é a de tentativa. `password` permanece `string`. Nenhum outro nome público é adicionado.

**Critério de aceite**
- **Dado** uma `SessionConfig` com `password` string e `extraUnsealPasswords: ["senha-antiga-com-32-caracteres-ou-mais"]`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** a configuração é aceita, e `password` continua exigindo `string` (um array em `password` é erro de tipo).

### RF-02 — Aceitar sessões seladas com senhas extras
Ao abrir uma sessão (cookie ou cabeçalho de sessão), `unsealSession` tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem. A primeira senha que abre a sessão vence. A sessão aberta tem os mesmos `id`, `createdAt` e `data` que tinha quando foi selada.

**Critério de aceite**
- **Dado** uma sessão selada com a senha A e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** uma requisição com esse cookie chama `getSession` ou `useSession`
- **Então** a sessão é carregada com o `id` e os `data` originais, e não é criada uma sessão nova.

### RF-03 — Selar somente com `password`
`sealSession` e `updateSession` continuam selando exclusivamente com `password`, mesmo que a sessão tenha sido aberta com uma senha extra.

**Critério de aceite**
- **Dado** uma sessão aberta com a senha extra A, numa configuração com `password: B`
- **Quando** a sessão é atualizada (`update`) e o cookie `Set-Cookie` resultante é lido
- **Então** o novo valor abre com uma configuração que só tem `password: B` e não abre com uma que só tem A.

### RF-04 — Resselar ao abrir com senha extra
Quando uma sessão vinda de cookie é aberta com uma senha extra, `getSession` a resela com `password`. O resselo reaproveita o mecanismo já usado para a migração do seal legado. Assim a senha antiga pode ser removida da lista quando os cookies ativos tiverem migrado. Uma sessão vinda do cabeçalho de sessão não é resselada, como já ocorre hoje.

**Critério de aceite**
- **Dado** uma sessão em cookie selada com a senha A e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** `getSession` carrega a sessão numa requisição com `event.res` disponível
- **Então** a resposta traz `Set-Cookie` com a sessão selada com B, e esse cookie abre com uma configuração que só tem `password: B`.

### RF-05 — Rejeitar senhas desconhecidas
Se nenhuma das senhas (`password` e as extras) abre a sessão, o comportamento é o de hoje: a sessão é descartada e uma nova é criada em memória. Uma senha removida da lista deixa de ser aceita.

**Critério de aceite**
- **Dado** uma sessão selada com a senha C, que não está em `password` nem em `extraUnsealPasswords`
- **Quando** a requisição com esse cookie chama `getSession`
- **Então** o `id` carregado é novo (diferente do `id` selado), os `data` estão vazios e nada da sessão antiga é exposto.

### RF-06 — Regras de expiração valem para qualquer senha
As validações de `maxAge` e `idleTimeout` e o `ttl` do seal se aplicam igualmente a sessões abertas com senhas extras. O `legacySealFallback` (1 iteração) também vale para elas. Uma senha extra não estende nem contorna a vida da sessão.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra A, com `createdAt` além de `maxAge`
- **Quando** a requisição com esse cookie chama `getSession`
- **Então** a sessão é tratada como expirada e substituída por uma nova, exatamente como seria com `password`.

### RF-07 — Sem senhas extras, o comportamento é o atual
Com `extraUnsealPasswords` ausente ou `[]`, o fluxo de seal, unseal, legado, expiração e erros é idêntico ao atual, inclusive a mensagem e o tipo do erro que `unsealSession` lança publicamente.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` (e outra com `[]`)
- **Quando** a suíte existente de testes de sessão é executada
- **Então** todos os testes passam, sem mudar o que verificam, e `unsealSession` com senha errada rejeita com o mesmo erro de hoje.

### RF-08 — Testes e documentação
Os testes cobrem RF-02 a RF-07 em `test/session.test.ts`, usando `describeMatrix`. Um teste de regressão que não passava antes da mudança é escrito primeiro. A documentação de sessões, se existir, ganha um exemplo de rotação.

**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** os três terminam sem falhas, e o teste de rotação (RF-02) falha se a lógica de senhas extras for removida.

## 3. Fora de escopo

- `password` aceitar um array (segunda alternativa da issue). Esta variante usa apenas o campo novo.
- Qualquer nome público novo além de `extraUnsealPasswords`.
- Mudar o formato do seal, os algoritmos, as iterações PBKDF2 ou os padrões de `SealOptions`.
- Gerar ou rotacionar senhas automaticamente, ou gerenciar segredos (cofre, variáveis de ambiente).
- Remover o fallback de seal legado, que continua planejado para a v3.
- Mudanças em outros utilitários (`cookie`, `auth`) e nos adapters de runtime.
- Revogar sessões individualmente ou manter lista de senhas "ativas" no servidor.

## 4. Premissas e riscos

### Premissas
- Quem opera a aplicação mantém as senhas extras na configuração, com a mesma exigência de entropia de `password` (32+ caracteres, geradas aleatoriamente).
- A senha de unseal é escolhida por tentativa e erro, sem identificador de senha no seal. A ordem de tentativa é `password` e depois as extras, na ordem do array.
- A validação do tamanho mínimo da senha continua sendo a feita por `iron-crypto`, que também vale para as senhas extras. Isso deve ser confirmado na implementação.
- `getSession` já tem o mecanismo de resselo (`kLegacySeal`, `shouldSlide`). O resselo por senha extra pode se apoiar nele sem criar nome público.

### Riscos
- **Custo de CPU**: cada senha extra é uma tentativa de PBKDF2 (8192 iterações por padrão) quando o cookie é inválido ou antigo. Um cookie forjado ou inválido custa N+1 tentativas, o que aumenta a superfície de DoS. Mitigação: documentar que a lista deve ser curta, e a senha atual é tentada primeiro para o caso comum.
- **Interação com o fallback legado**: o fallback tenta de novo com 1 iteração depois de um erro `Bad hmac value`. Com várias senhas, o fallback precisa ser tentado por senha ou ao fim, sem mascarar erros nem multiplicar tentativas sem necessidade. Escolha de desenho a registrar na implementação.
- **Mascarar erros**: tentar várias senhas não pode trocar o erro final por outro enganoso. Quando todas falham, o erro propagado deve ser o da senha principal (ou equivalente ao atual).
- **Segurança de senhas antigas**: uma senha extra vazada mantém válidas as sessões antigas até ser removida. É preciso orientar a retirá-la depois da migração dos cookies, que o resselo (RF-04) facilita.
- **Regressão em testes existentes**: testes que dependem do fluxo de `unsealSession` ou do resselo podem precisar de ajuste. O ajuste não pode enfraquecer o que verificam.
