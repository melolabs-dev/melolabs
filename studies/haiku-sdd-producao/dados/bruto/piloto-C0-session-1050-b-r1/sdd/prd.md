# PRD — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## 1. Problema e objetivo

### Problema

Hoje `SessionConfig` aceita uma única `password`. Ao rotacionar essa senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários logados perdem a sessão. Não existe forma de manter a compatibilidade com senhas antigas durante a rotação de segredos.

### Objetivo

Permitir a rotação da senha de sessão (`src/utils/session.ts`) sem derrubar quem já está logado. Depois da troca, o app aceita sessões seladas com senhas anteriores, e toda sessão nova ou regravada passa a ser selada com a senha atual. A rotação é configurada pelo novo campo opcional `extraUnsealPasswords` em `SessionConfig`.

### Métricas de sucesso

- Após rotacionar `password` e listar a antiga em `extraUnsealPasswords`, 100% das sessões antigas válidas continuam abrindo.
- Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento é idêntico ao atual.
- A suíte de testes existente, `pnpm lint` e `pnpm typecheck` continuam passando.

## 2. Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` na configuração

`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores, aceitas somente para abrir sessões. `password` continua sendo uma string e a senha principal. Campo ausente e lista vazia são equivalentes.

**Critério de aceite**

- **Dado** uma configuração com `password` e sem `extraUnsealPasswords`, e outra com `extraUnsealPasswords: []`
- **Quando** uma sessão é criada, selada e aberta nas duas configurações
- **Então** o comportamento é idêntico nas duas e igual ao atual, e o tipo de `password` continua `string`.

### RF-02 — Selar sempre com `password`

Toda selagem (sessão nova, `updateSession`, `sealSession`, re-selagem automática) usa sempre `password`. Senhas extras nunca selam.

**Critério de aceite**

- **Dado** uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`
- **Quando** uma sessão é criada, atualizada com `updateSession` ou selada com `sealSession`
- **Então** o valor selado só abre com P2 (e não com P1 isoladamente).

### RF-03 — Abrir com `password` ou com senha extra, em sequência

Uma sessão selada com `password` ou com qualquer senha extra abre normalmente, preservando `id`, `createdAt` e dados. As senhas são tentadas uma de cada vez: `password` primeiro, depois as extras na ordem da lista, parando na primeira que abrir. Se `password` abrir, nenhuma extra é tentada.

**Critério de aceite**

- **Dado** `password` P2, `extraUnsealPasswords: [P1, P0]` e sessões seladas com P2, P1 e P0
- **Quando** cada sessão é aberta
- **Então** as três abrem com `id`, `createdAt` e dados preservados; para a sessão selada com P2 nenhuma tentativa de unseal com P1 ou P0 ocorre; para a selada com P1 P0 não é tentada.

### RF-04 — Senha desconhecida

Sessão selada com senha que não é `password` nem consta em `extraUnsealPasswords` é tratada como inexistente, como hoje: sem erro, sessão nova e vazia.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha fora da configuração
- **Quando** o pedido chega com esse cookie
- **Então** o pedido segue sem erro e a sessão é nova e vazia.

### RF-05 — Rotação progressiva (re-selagem)

Quando `getSession` (e portanto `useSession`) abre uma sessão vinda do cookie com senha extra, ela é re-selada com `password` e enviada em novo `Set-Cookie` na mesma resposta, mesmo que o handler só leia a sessão (mesmo mecanismo da re-selagem de sessões legadas). Sessões abertas por `password` não são re-seladas por isso. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**

- **Dado** um cookie selado com uma senha extra e um handler que apenas lê a sessão
- **Quando** o pedido é processado
- **Então** a resposta contém `Set-Cookie` com a sessão re-selada com `password`; com cookie selado por `password`, ou com a sessão vinda do cabeçalho de sessão, não há `Set-Cookie` por esse motivo.

### RF-06 — Validação das senhas

Cada senha extra segue a regra de `password`: não vazia e com no mínimo `minPasswordlength` caracteres (32 por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar sessão, `updateSession`, `sealSession`) rejeita com erro claro cuja mensagem contém "password", mesmo sem sessão no pedido. Senha extra inválida em qualquer posição da lista causa o erro; `password` inválida continua causando erro.

**Critério de aceite**

- **Dado** `extraUnsealPasswords` contendo uma senha vazia ou curta em qualquer posição (inclusive a última)
- **Quando** `useSession` cria uma sessão, ou `updateSession` ou `sealSession` é chamada, mesmo em pedido sem sessão
- **Então** a operação rejeita com erro cuja mensagem contém "password".

### RF-07 — Cobertura das funções e origens

A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em chunks e para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**

- **Dado** sessões seladas com uma senha extra, entregues por cookie simples, cookie em chunks e cabeçalho de sessão
- **Quando** cada uma das cinco funções as processa
- **Então** a sessão é aberta com dados preservados em todas as combinações aplicáveis.

### RF-08 — Sessões legadas

O fallback `legacySealFallback` (1 iteração de PBKDF2) continua valendo e se aplica a `password` e a todas as senhas extras: sessão legada selada com qualquer uma delas abre e é re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**

- **Dado** uma sessão legada selada com uma senha extra e `legacySealFallback` ativo
- **Quando** `getSession` a abre a partir do cookie
- **Então** ela abre, é re-selada com `password` e opções atuais e enviada em `Set-Cookie`; com `legacySealFallback: false` ela é tratada como inexistente.

## 3. Fora de escopo

- `password` aceitar array ou qualquer mudança no seu tipo (alternativa citada no issue, descartada nesta variante).
- Novos nomes públicos além de `extraUnsealPasswords`.
- Mudanças em `maxAge`, `idleTimeout`, cookies em chunks, cabeçalho de sessão, `errHeaders` e demais comportamentos de sessão.
- Re-selagem de sessões vindas do cabeçalho de sessão.
- Tentativa de senhas em paralelo, cache de chaves ou otimizações de desempenho.
- Mecanismo de expiração/remoção automática de senhas antigas da lista.

## 4. Premissas e riscos

### Premissas

- A re-selagem de sessões legadas já existe e pode ser reaproveitada para a re-selagem por senha extra.
- A mensagem de erro atual de `password` inválida contém "password" e serve de modelo.
- `minPasswordlength` das opções de selo é a fonte do tamanho mínimo.
- Quem configura é responsável por remover senhas extras antigas quando quiser invalidar sessões.

### Riscos

- **Custo criptográfico:** cada tentativa de unseal usa PBKDF2; uma lista longa e sessões inválidas multiplicam o custo (possível vetor de DoS). Mitigação: tentar `password` primeiro, parar na primeira que abrir e documentar que a lista deve ser curta.
- **Regressão sem extras:** qualquer mudança no caminho comum pode alterar o comportamento atual. Mitigação: testes de equivalência com campo ausente e lista vazia.
- **Re-selagem indevida:** re-selar sessões abertas por `password` ou vindas do cabeçalho geraria `Set-Cookie` inesperado. Mitigação: testes negativos explícitos.
- **Validação tardia:** senha extra inválida só detectada ao selar, não ao ler. É o comportamento especificado; deve ficar claro nos testes.
- **Interação com legado:** combinar fallback legado com várias senhas aumenta o número de tentativas (senhas x modos). Mitigação: ordem determinística e parada na primeira que abrir.
