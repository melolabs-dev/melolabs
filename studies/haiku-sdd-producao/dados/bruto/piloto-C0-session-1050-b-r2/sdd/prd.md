# PRD — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## 1. Problema e objetivo

### Problema
Hoje as sessões do H3 (`src/utils/session.ts`) são seladas e abertas com uma única `password`. Ao rotacionar esse segredo, todas as sessões seladas com a senha anterior deixam de ser abertas e os usuários logados perdem a sessão.

### Objetivo
Permitir a rotação da senha sem derrubar quem já está logado. Depois da troca, o app continua aceitando sessões seladas com senhas anteriores, e toda sessão nova ou regravada passa a ser selada com a senha atual. A rotação é configurada pelo novo campo opcional `extraUnsealPasswords` em `SessionConfig`.

## 2. Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` na configuração
`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores, aceitas somente para abrir sessões. `password` continua sendo uma string e continua sendo a senha principal. Campo ausente e lista vazia são equivalentes.

**Critério de aceite**
- Dado uma configuração com `password` e `extraUnsealPasswords` ausente ou `[]`
- Quando uma sessão é criada, lida e regravada
- Então o comportamento é idêntico ao atual, sem senhas extras e sem re-selagem ao só ler.

### RF-02 — Selar sempre com `password`
Toda sessão selada (sessão nova, `updateSession`, `sealSession`, re-selagem automática) usa sempre `password`. As senhas de `extraUnsealPasswords` nunca selam.

**Critério de aceite**
- Dado uma configuração com `password` e uma ou mais `extraUnsealPasswords`
- Quando uma sessão é selada por qualquer uma dessas operações
- Então o selo só abre com `password`, e não com uma senha extra isolada.

### RF-03 — Abrir com `password` ou com senha extra, em sequência
Uma sessão selada com `password` ou com qualquer senha extra é aberta normalmente, com `id`, `createdAt` e dados preservados. As senhas são tentadas uma de cada vez: `password` primeiro e, se não abrir, as extras na ordem da lista, parando na primeira que abrir. Quando `password` abre a sessão, nenhuma senha extra é tentada.

**Critério de aceite**
- Dado uma sessão selada com a segunda senha da lista de extras
- Quando a sessão é aberta
- Então `id`, `createdAt` e dados são preservados, e as senhas são tentadas na ordem `password`, primeira extra, segunda extra, parando na que abre.
- Dado uma sessão selada com `password`
- Quando ela é aberta
- Então nenhuma senha extra é tentada.

### RF-04 — Senha desconhecida
Uma sessão selada com senha que não é `password` nem consta em `extraUnsealPasswords` é tratada como inexistente, como hoje com senha errada.

**Critério de aceite**
- Dado uma sessão selada com uma senha fora da configuração
- Quando o pedido é processado
- Então não há erro, e a sessão resultante é nova e vazia.

### RF-05 — Rotação progressiva
Quando `getSession` (e, portanto, `useSession`) abre uma sessão vinda do cookie com uma senha extra, ela é re-selada com `password` e enviada em novo `Set-Cookie` na mesma resposta, mesmo que o handler só leia a sessão (mesmo mecanismo da re-selagem de sessões legadas). Sessões abertas por `password` não são re-seladas por isso. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**
- Dado um cookie de sessão selado com uma senha extra
- Quando o handler apenas lê a sessão
- Então a resposta traz `Set-Cookie` com a sessão re-selada com `password`.
- Dado um cookie selado com `password`, ou uma sessão vinda do cabeçalho de sessão
- Quando o handler apenas lê a sessão
- Então nenhum `Set-Cookie` de re-selagem é enviado.

### RF-06 — Validação das senhas
Cada senha extra segue a mesma regra de `password`: não vazia e com pelo menos `minPasswordlength` caracteres (32 por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession`, `sealSession`) rejeita com erro claro cuja mensagem contém "password", mesmo quando o pedido não traz sessão. Senha extra inválida em qualquer posição da lista provoca o erro, e `password` inválida continua provocando erro como hoje.

**Critério de aceite**
- Dado uma configuração em que uma senha extra, em qualquer posição, é vazia ou curta demais
- Quando `useSession`, `updateSession` ou `sealSession` precisa selar, inclusive em pedido sem sessão
- Então a operação rejeita com erro cuja mensagem contém "password".

### RF-07 — Cobertura das funções e dos canais
A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em chunks e para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**
- Dado uma sessão selada com uma senha extra, entregue por cookie simples, por cookie em chunks ou pelo cabeçalho de sessão
- Quando cada uma das cinco funções a processa
- Então a sessão é aberta com `id`, `createdAt` e dados preservados.

### RF-08 — Sessões legadas
O fallback atual para selos com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a `password` e a todas as senhas extras. Uma sessão legada selada com qualquer uma delas é aberta e re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**
- Dado uma sessão legada selada com uma senha extra e `legacySealFallback` ativo
- Quando ela é aberta
- Então é aceita e re-selada com `password` nas opções atuais.
- Dado `legacySealFallback: false`
- Quando uma sessão legada é aberta
- Então ela é tratada como inexistente.

## 3. Fora de escopo
- Aceitar `password` como lista (alternativa descrita no issue). O tipo de `password` não muda.
- Qualquer nome público novo além do campo `extraUnsealPasswords`.
- Mudanças em `maxAge`, `idleTimeout`, cookies em chunks, cabeçalho de sessão, `errHeaders` e demais comportamentos de sessão.
- Revogação ativa de senhas ou gestão de segredos (armazenamento, geração, remoção da lista).
- Alterar o código do projeto neste passo: este documento é apenas o PRD.

## 4. Premissas e riscos

### Premissas
- Remover uma senha de `extraUnsealPasswords` é decisão do operador do app. A rotação progressiva faz sessões ativas migrarem sozinhas para `password`.
- O mecanismo atual de re-selagem de sessões legadas pode ser reaproveitado para a rotação progressiva.
- Os testes existentes, `pnpm lint` e `pnpm typecheck` continuam sendo o critério de não regressão.

### Riscos
- **Custo criptográfico:** o selo usa PBKDF2, então tentar muitas senhas é caro. Mitigação: ordem fixa, parada na primeira que abre, nenhuma extra tentada quando `password` abre.
- **Re-selagem indevida:** re-selar sessões abertas por `password` ou vindas do cabeçalho geraria `Set-Cookie` inesperado. Mitigação: critérios do RF-05.
- **Validação tardia:** senha extra inválida só seria notada ao selar. Mitigação: RF-06 exige falha em toda operação que sela, mesmo sem sessão no pedido.
- **Interação com o fallback legado:** combinar senhas extras e `legacySealFallback` multiplica as tentativas. Mitigação: RF-08 define a regra explicitamente.
- **Vazamento de senhas antigas:** manter senhas antigas na lista prolonga a validade de segredos comprometidos. Mitigação: documentar que a lista deve ser enxugada após o período de rotação.
