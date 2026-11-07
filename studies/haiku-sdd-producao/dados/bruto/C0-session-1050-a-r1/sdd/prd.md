# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única string, usada tanto para selar quanto para abrir a sessão. Ao rotacionar essa senha, todo cookie ou header selado com a senha anterior deixa de ser aceito. O `unsealSession` falha, a sessão é descartada e todos os usuários perdem a sessão de uma só vez. É exatamente o que a issue h3js/h3#1050 relata.

### Objetivo
Permitir rotação de senha sem invalidar as sessões existentes. O campo `password` passa a aceitar também uma lista não vazia de senhas (segunda alternativa da issue):

- a **primeira** senha da lista sela;
- **todas** as senhas da lista (a primeira e as demais) podem abrir sessões.

Uma string continua valendo como hoje. Nenhum nome público novo é criado.

### Métricas de sucesso
- Após trocar `password: "nova"` por `password: ["nova", "antiga"]`, sessões seladas com `"antiga"` continuam válidas.
- Sessões com uma única senha se comportam exatamente como antes. A suíte existente passa, e `pnpm lint` e `pnpm typecheck` também.

## 2. Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia
`SessionConfig.password` passa a ter o tipo `string | string[]`. A documentação do campo (JSDoc) descreve o papel de cada posição da lista e mantém os avisos atuais (mínimo de 32 caracteres, entropia).

**Critério de aceite**
- **Dado** uma configuração com `password` do tipo `string[]` com ao menos uma senha,
- **Quando** o código é verificado com `pnpm typecheck`,
- **Então** a configuração é aceita, e a configuração com `password: string` continua aceita sem alterações.

### RF-02 — A primeira senha sela
`sealSession`, e com ela `updateSession` e `useSession`, usam somente a primeira senha da lista para selar. As demais nunca selam.

**Critério de aceite**
- **Dado** `password: ["nova-...", "antiga-..."]` (cada uma com 32 caracteres ou mais),
- **Quando** uma sessão é criada e selada,
- **Então** o token só pode ser aberto com a senha `"nova-..."` sozinha (`password: "nova-..."`). Ele não abre com `"antiga-..."` sozinha.

### RF-03 — Qualquer senha da lista abre a sessão
`unsealSession` tenta abrir o token com cada senha da lista, na ordem, e aceita o primeiro resultado válido. Isso vale para token vindo de cookie (inclusive em chunks) e do header de sessão.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `"antiga-..."` e uma configuração `password: ["nova-...", "antiga-..."]`,
- **Quando** uma requisição chega com esse cookie (ou header de sessão),
- **Então** `getSession` e `useSession` devolvem o mesmo `id` e os mesmos `data` da sessão original, sem criar sessão nova.

### RF-04 — Token com senha desconhecida é rejeitado
Se nenhuma senha da lista abre o token, o comportamento é o de hoje: o erro é tratado como sessão inválida e uma sessão nova é iniciada. Os demais erros de validação (expiração por `maxAge`/`idleTimeout`, integridade) não são mascarados pela tentativa com outras senhas.

**Critério de aceite**
- **Dado** um token selado com uma senha que não está na lista,
- **Quando** a requisição chega com esse token,
- **Então** a sessão antiga não é reaproveitada: `getSession` devolve um `id` novo e `data` vazio.
- **E** um token válido, mas expirado (`maxAge` ou `idleTimeout`), continua sendo rejeitado mesmo quando a senha que o abre não é a primeira da lista.

### RF-05 — Reselagem com a senha primária
Uma sessão aberta com uma senha que não seja a primeira é reselada com a primeira senha, para que a senha antiga possa ser removida da lista depois. A reselagem usa o mesmo mecanismo que já existe para sessões legadas (`kLegacySeal`) e para o deslize do `idleTimeout`. O `id` e o `createdAt` são preservados.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga-..."` e `password: ["nova-...", "antiga-..."]`,
- **Quando** uma requisição com esse cookie passa por `getSession`/`useSession` e a resposta é emitida,
- **Então** a resposta traz um `Set-Cookie` com um token que abre somente com `"nova-..."`, mantendo o mesmo `id` e `createdAt`.
- **E** um token já selado com a primeira senha não gera `Set-Cookie` extra por causa disso.
- **E** uma sessão lida do header de sessão não é reselada, pois esse caminho nunca reseala.

### RF-06 — Compatibilidade com o fallback legado de PBKDF2
O fallback `legacySealFallback` (1 iteração de PBKDF2) continua funcionando e passa a considerar a lista de senhas. Uma sessão legada selada com uma senha secundária é aberta e reselada com a primeira senha e as opções atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**
- **Dado** uma sessão selada com 1 iteração de PBKDF2 usando a senha `"antiga-..."` e `password: ["nova-...", "antiga-..."]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é aberta e reselada com a senha `"nova-..."` e as opções atuais.
- **E** com `legacySealFallback: false` a sessão é rejeitada.

### RF-07 — Validação de lista inválida
Uma lista vazia, ou com elemento que não seja string ou seja vazio, é erro de configuração. O erro é lançado de forma explícita ao usar a sessão, e a requisição não segue com uma senha indefinida. A mensagem identifica que `password` precisa ser uma string ou uma lista não vazia de senhas.

**Critério de aceite**
- **Dado** `password: []`,
- **Quando** `useSession`, `getSession`, `sealSession` ou `unsealSession` é chamado,
- **Então** a chamada rejeita com um erro cuja mensagem indica que `password` precisa ser uma string ou uma lista não vazia.

### RF-08 — Comportamento inalterado com uma senha só
Com `password` string, ou lista de um único elemento, selar, abrir, expirar, deslizar e reselar legados se comportam como hoje. Uma lista de um elemento equivale à string.

**Critério de aceite**
- **Dado** a suíte de testes de sessão existente,
- **Quando** `pnpm vitest run test/session.test.ts` (e a suíte completa) é executado,
- **Então** todos os testes continuam passando, sem perder o que verificam.
- **E** um token selado com `password: "x…"` abre com `password: ["x…"]` e vice-versa.

### RF-09 — Testes e documentação
Os testes cobrem RF-02 a RF-08 (regressão primeiro, seguindo o fluxo de bug/feature do `AGENTS.md`), usando `describeMatrix` nos modos `web` e `node`. A documentação de sessões no repositório, se existir, descreve a rotação de senha.

**Critério de aceite**
- **Dado** a mudança implementada,
- **Quando** `pnpm test` é executado,
- **Então** lint, typecheck e testes passam, e há ao menos um teste para cada um dos requisitos RF-02 a RF-08.

## 3. Fora de escopo

- Novo campo `extraUnsealPasswords` (primeira alternativa da issue). Nenhum outro nome público novo é introduzido.
- Senhas em formato objeto/`Uint8Array` ou com `id` do iron (`{ id, secret }`, mapa de ids). `password` continua sendo string ou lista de strings.
- Rotação automática, geração ou armazenamento de segredos, e revogação individual de sessões.
- Mudanças em algoritmos, iterações ou `ttl` do seal, e em `src/utils/internal/iron-crypto.ts`, salvo se inevitável para o ponto de entrada.
- Mudanças em outros usos de "password" (`requireBasicAuth`, `basicAuth`).
- Limite máximo do tamanho da lista.

## 4. Premissas e riscos

### Premissas
- O token não carrega o identificador da senha usada, então a abertura é por tentativa e erro na ordem da lista. O `id` do iron-crypto continua vazio (`default`).
- Quem rotaciona coloca a senha nova na frente e mantém as antigas até o fim da vida útil das sessões (`maxAge`), e só então as remove.
- O erro "Bad hmac value" é o sinal esperado de senha errada, e o iron-crypto continua lançando-o para HMAC inválido.

### Riscos e mitigações
| Risco | Mitigação |
| --- | --- |
| Custo: com PBKDF2 de 8192 iterações, cada senha tentada soma uma derivação de chave, e o fallback legado pode dobrar isso (N senhas × 2 tentativas). | Tentar primeiro a senha primária (caso comum). Manter a lista curta na documentação. Usar o fallback legado só depois de esgotar a lista com as opções atuais, e medir o impacto. |
| Mascarar erros reais (expiração, token corrompido) ao tentar outras senhas, ou trocar o erro lançado e quebrar testes que dependem da mensagem. | Só avançar para a próxima senha em falha de HMAC. Propagar os demais erros como hoje (RF-04). |
| Senha antiga comprometida continua aceita enquanto estiver na lista. | Documentar que a lista deve ser enxugada após o fim das sessões antigas. A reselagem (RF-05) acelera a migração. |
| Reselagem sem querer em toda requisição, gerando `Set-Cookie` desnecessário. | Reselar só quando a abertura usou uma senha não primária, e testar que um token primário não gera cookie extra. |
| Mutação do `config.password` ou quebra de tipos de quem lê `config.password` como string (há usos em `sealSession`/`unsealSession`). | Normalizar para lista internamente sem alterar o objeto de configuração, e revisar todos os usos. `pnpm typecheck` cobre o restante. |
| Lista vazia ou com segredo curto (< 32 caracteres) falhando tarde e de forma obscura. | Validar cedo (RF-07). O erro de tamanho mínimo do iron-crypto continua valendo para cada senha. |
