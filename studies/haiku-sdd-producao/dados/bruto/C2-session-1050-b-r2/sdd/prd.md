# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta) e contrato `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `SessionConfig` aceita uma única `password`, usada tanto para selar quanto para abrir (unseal) os cookies de sessão. Quando um time troca essa senha por motivo de rotação de segredos, todas as sessões já emitidas com a senha antiga deixam de abrir e os usuários são desconectados de uma vez.

### Objetivo

Permitir a rotação da senha de sessão sem invalidar as sessões existentes:

- `password` continua sendo a **única** senha usada para selar novas sessões.
- Um novo campo opcional `extraUnsealPasswords` lista senhas anteriores que **só** servem para abrir sessões já seladas.
- Sem `extraUnsealPasswords`, o comportamento atual permanece idêntico.

## Requisitos funcionais

### RF-01 — Novo campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`. O campo é documentado como senhas anteriores que só abrem sessões. `password` permanece `string`.

**Critério de aceite**

- **Dado** uma configuração de sessão com `extraUnsealPasswords: ["senha-antiga"]` e `password: "senha-nova"`,
- **Quando** o tipo `SessionConfig` é checado pelo TypeScript,
- **Então** a configuração compila sem erro, e `password` continua aceitando apenas `string`.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou resselada é selada exclusivamente com `password`. As senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** uma sessão é criada e selada com `useSession`/`updateSession`,
- **Então** o cookie resultante abre com `senha-nova` e não abre com `senha-antiga` isoladamente.

### RF-03 — Abertura tentando as senhas em ordem

Ao ler um cookie de sessão, a abertura tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem declarada, até uma funcionar. Se nenhuma funcionar, vale o comportamento atual de falha (sessão vazia / nova).

**Critério de aceite**

- **Dado** um cookie selado com `senha-antiga` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` lê esse cookie,
- **Então** a sessão é recuperada com o mesmo `id` e os mesmos `data` que tinha antes da rotação.

**Critério de aceite (falha)**

- **Dado** um cookie selado com uma senha que não está em `password` nem em `extraUnsealPasswords`,
- **Quando** `getSession` lê esse cookie,
- **Então** o resultado é o mesmo de hoje para um cookie inválido: nenhuma sessão recuperada e um id novo.

### RF-04 — Compatibilidade sem senhas extras

Quando `extraUnsealPasswords` está ausente ou vazio, a leitura e a escrita de sessões produzem o mesmo resultado de antes.

**Critério de aceite**

- **Dado** uma configuração idêntica à atual, sem `extraUnsealPasswords`,
- **Quando** a suíte existente (`test/session.test.ts` e demais testes) roda,
- **Então** todos os testes passam sem alteração de expectativa.

### RF-05 — Migração para a senha atual ao ler cookie antigo

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password` na mesma leitura, seguindo o mecanismo que já existe para cookies com `legacySeal` e para `idleTimeout`. Assim, a rotação migra os cookies de forma gradual.

**Critério de aceite**

- **Dado** um cookie selado com `senha-antiga` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` lê esse cookie a partir de uma requisição,
- **Então** a resposta contém um `Set-Cookie` novo selado com `senha-nova`, e uma leitura seguinte com apenas `password: "senha-nova"` (sem extras) recupera a mesma sessão.

### RF-06 — Interação com `legacySealFallback`

A abertura com cada senha respeita o fallback de 1 iteração PBKDF2 já existente. Uma senha extra não pode fazer uma sessão inválida ser aceita, e o fallback legado não pode ser ignorado para as senhas extras.

**Critério de aceite**

- **Dado** `legacySealFallback: false` e um cookie selado com 1 iteração e `senha-antiga`,
- **Quando** `getSession` lê esse cookie com `extraUnsealPasswords: ["senha-antiga"]`,
- **Então** a sessão é rejeitada, da mesma forma que hoje rejeitaria com `password` sozinha.

### RF-07 — Tipos e documentação

A documentação JSDoc de `extraUnsealPasswords` explica: a ordem de tentativa, que essas senhas só abrem, e que devem ser removidas após o prazo máximo de vida das sessões antigas (`maxAge` ou `idleTimeout`).

**Critério de aceite**

- **Dado** o arquivo `src/utils/session.ts`,
- **Quando** o campo `extraUnsealPasswords` é inspecionado (hover no editor ou leitura do código),
- **Então** o JSDoc descreve ordem, finalidade e recomendação de remoção.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050). A forma de configuração escolhida é o campo novo.
- Mudanças no cabeçalho de sessão (`sessionHeader`) além do que a leitura por cookie já cobre.
- Rotação automática, agendamento ou invalidação programada de senhas.
- Mudanças em `src/utils/internal/iron-crypto.ts` ou no formato do selo.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Remoção do fallback legado (`legacySealFallback`), que continua previsto só para a v3.
- Benchmarks de desempenho dedicados (apenas verificar que a suíte existente roda).

## Premissas e riscos

### Premissas

- A biblioteca de selagem (`iron-crypto.ts`) aceita uma senha string por chamada de `unseal`; portanto, tentar senhas em sequência funciona sem alterar o formato do selo. Verificado na leitura de `unseal`: com senha string, o `passwordId` do selo não é checado.
- O mecanismo de `updateSession` / `shouldSlide` já reselar cookies, então a migração do RF-05 pode reaproveitar esse caminho.
- Os nomes e defaults atuais de `SessionConfig` permanecem como estão.

### Riscos

- **Custo de CPU**: cada senha extra tentada custa uma derivação PBKDF2 completa (8192 iterações por padrão) para cookies que não batem com as anteriores. Com N senhas extras, uma sessão inválida custa até N+1 derivações. Mitigação: limitar a lista na documentação e recomendar remoção após a janela de rotação.
- **Interação com fallback legado**: se o fallback de 1 iteração for aplicado por senha, o número de tentativas dobra no pior caso. Precisa de teste específico (RF-06).
- **Sessões sem expiração**: sem `maxAge` nem `idleTimeout`, uma senha extra pode ficar aceitando sessões indefinidamente. Mitigação: documentação (RF-07).
- **Vazamento de senha antiga**: manter uma senha antiga na configuração amplia a superfície de ataque enquanto ela estiver lá. A recomendação é remover após a janela de rotação.
- **Divergência entre leitura por header e cookie**: sessões lidas do header não são resseladas (conforme o JSDoc de `idleTimeout`). Com senha extra, essas sessões continuam abrindo com a senha antiga até expirar. Precisa estar explícito na documentação.
