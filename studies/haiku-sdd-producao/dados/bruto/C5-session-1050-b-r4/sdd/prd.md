# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` / `getSession` (`src/utils/session.ts`) aceitam uma única senha, `SessionConfig.password`, que serve tanto para selar quanto para abrir o cookie ou o header de sessão. Quando um time troca essa senha, todas as sessões seladas com a senha antiga deixam de abrir: `getSession` captura o erro de `unsealSession` e devolve uma sessão nova e anônima. Na prática, rotacionar o segredo desloga todo mundo de uma vez.

Objetivo: permitir que a senha seja rotacionada sem invalidar as sessões existentes. A configuração recebe senhas anteriores que só servem para abrir sessões; a senha atual continua sendo a única usada para selar. Com o tempo, as sessões migram para a senha nova e as antigas podem ser removidas da configuração.

Referência: issue h3js/h3#1050, primeira alternativa proposta (campo novo na configuração).

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com a documentação dizendo que essas senhas são usadas apenas para abrir sessões, nunca para selar. `password` continua `string`.

**Critério de aceite**
- **Dado** uma configuração com `password` e `extraUnsealPasswords` preenchidos,
- **Quando** o código de tipos é verificado (`pnpm typecheck`),
- **Então** o campo é aceito como `string[]` opcional e nenhum outro nome público novo aparece na API exportada.

### RF-02 — Abrir sessões seladas com senha anterior

Ao ler uma sessão (cookie ou header), o sistema tenta abrir o token com `password` e, se falhar, com cada item de `extraUnsealPasswords`, nessa ordem. A primeira senha que abre o token é usada.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `A` e uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- **Quando** uma requisição chega com esse cookie,
- **Então** a sessão é carregada com os dados originais, com o mesmo `id` e o mesmo `createdAt`.

### RF-03 — Selar sempre com a senha atual

Toda selagem (`sealSession`, e portanto `updateSession` e a regravação de RF-08) usa somente `password`. Senhas em `extraUnsealPasswords` nunca são usadas para gerar um token novo.

**Critério de aceite**
- **Dado** uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- **Quando** uma sessão é gravada com `update()`,
- **Então** o cookie resultante abre com `B` e não abre com `A`.

### RF-04 — Sem senhas extras, comportamento idêntico

Quando `extraUnsealPasswords` está ausente ou vazio, o comportamento é exatamente o atual: mesmo token, mesma ordem de tentativas, mesmos erros capturados e mesma sessão anônima para tokens inválidos.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes passam sem alteração de expectativa.

### RF-05 — Token que nenhuma senha abre continua sendo sessão nova

Se nenhuma das senhas abre o token (senha errada, token adulterado ou selado com outra chave), o comportamento é o mesmo de hoje: a sessão é inicializada em memória como nova, sem erro para o chamador.

**Critério de aceite**
- **Dado** um token selado com a senha `C`, que não está na configuração,
- **Quando** uma requisição chega com esse cookie,
- **Então** `getSession` retorna uma sessão nova com `id` diferente do token e nenhuma exceção é lançada.

### RF-06 — Expiração continua valendo para qualquer senha

`maxAge` e `idleTimeout` são verificados depois que o token é aberto, independentemente de qual senha o abriu. Uma sessão antiga aberta com senha extra expira no mesmo instante que uma aberta com a senha atual.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `A` que já passou de `maxAge`, e a configuração `password: B` com `extraUnsealPasswords: [A]`,
- **Quando** a requisição chega,
- **Então** a sessão é tratada como expirada (sessão nova), do mesmo jeito que se a senha fosse `B`.

### RF-07 — Fallback legado de iterações respeita as senhas extras

O fallback existente para sessões seladas com 1 iteração PBKDF2 (`legacySealFallback`, `unsealSession`) passa a ser tentado para cada senha da lista, e a sessão aberta por esse caminho continua sendo marcada para regravação com a senha atual. `legacySealFallback: false` continua desligando o fallback para todas as senhas.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `A` e com 1 iteração PBKDF2, e a configuração `password: B` com `extraUnsealPasswords: [A]`,
- **Quando** a requisição chega,
- **Então** a sessão é aberta e regravada com `B` e com as iterações atuais, e a leitura seguinte já não usa o fallback.

### RF-08 — Regravação com a senha atual ao abrir com senha extra

Quando uma sessão é aberta com uma senha extra, ela é regravada com `password` na mesma leitura (o mesmo mecanismo que hoje regrava sessões legadas e faz o *sliding* do `idleTimeout`). Sem isso, a senha antiga teria de ficar na configuração para sempre.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `A` e a configuração `password: B` com `extraUnsealPasswords: [A]`,
- **Quando** a requisição lê a sessão,
- **Então** a resposta traz um `Set-Cookie` com um token que abre com `B` e não abre com `A`, mantendo `id` e `createdAt`.

### RF-09 — Cobertura nos dois caminhos de leitura

O comportamento de RF-02 a RF-08 vale tanto para o cookie quanto para o header de sessão (`sessionHeader`). Os testes seguem o padrão `describeMatrix`, rodando em `web` e `node`.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `A` enviada pelo header de sessão, e a configuração `password: B` com `extraUnsealPasswords: [A]`,
- **Quando** a requisição chega,
- **Então** a sessão é carregada com os dados originais, nos dois ambientes de teste.

## Fora de escopo

- Novos nomes públicos além de `extraUnsealPasswords` (nada de helpers como `rotateSessionPassword`).
- Rotação automática ou agendada das senhas, e qualquer gestão de chaves (armazenamento, KMS, leitura de variáveis de ambiente).
- Limite de quantas senhas extras podem existir, ou validação de duplicatas na lista.
- Mudar o formato do token selado ou o algoritmo de `iron-crypto`.
- Remover o `legacySealFallback` (isso fica para a v3, conforme o comentário `@deprecated`).
- Alterar `sealSession` para aceitar senha por chamada, ou qualquer mudança em `cookie.ts` além do necessário.
- Documentação em `docs/` e changelog; podem ser feitos depois da implementação.

## Premissas

- **P1.** Cada item de `extraUnsealPasswords` é validado do mesmo jeito que `password` hoje. A checagem de tamanho mínimo (32 caracteres) é feita pela biblioteca de selagem ou pela própria config; a implementação precisa confirmar isso antes de decidir se a validação se estende às senhas extras.
- **P2.** A ordem de tentativas é `password` primeiro e depois as extras na ordem dada. Sessões seladas com a senha atual (caso normal) não pagam custo extra.
- **P3.** O erro de unseal que não é HMAC (por exemplo, token malformado) não deve fazer o loop parar nem ser engolido de forma diferente do que acontece hoje. Se todas as senhas falharem, o comportamento final é o atual (sessão nova).
- **P4.** RF-08 (regravação com a senha atual) é uma decisão de produto que este PRD assume. A issue pede só aceitar as senhas antigas; regravar é o que torna a rotação completa. Se o time preferir não regravar, RF-08 sai e a documentação precisa dizer que as senhas extras devem ficar até as sessões expirarem.
- **P5.** `password` continua sendo a única senha usada para selar, então o contrato de `SessionConfig.password` não muda.

## Riscos

- **R1 — Custo de CPU por requisição.** Cada senha extra que não abre o token custa uma derivação PBKDF2 completa (8192 iterações por padrão), e o fallback legado dobra esse custo. Com várias senhas extras e um token que nenhuma abre (cookie antigo ou adulterado), uma requisição pode fazer muitas derivações. Mitigação: ordem fixa, documentação recomendando poucas senhas extras e remoção rápida, e um teste de regressão que conte as tentativas.
- **R2 — Senha vazada continua valendo enquanto estiver na lista.** Quem tiver uma senha antiga consegue forjar sessões enquanto ela estiver em `extraUnsealPasswords`. A documentação precisa deixar explícito que remover a senha é a única forma de revogar.
- **R3 — Regravação com erro silencioso.** Se a regravação de RF-08 falhar (por exemplo, `res` ausente em uma requisição sem resposta), a sessão continua aberta com a senha antiga e a rotação fica pendente. Mitigação: o teste de RF-08 verifica o `Set-Cookie` e o caso sem `res` fica coberto pelo comportamento atual de `updateSession`.
- **R4 — Ambiguidade no nome.** `extraUnsealPasswords` sugere que o campo recebe senhas de unseal, não de seal. A documentação de RF-01 e o teste de RF-03 existem para evitar que alguém use o campo como senha de selagem.
- **R5 — Testes existentes acoplados ao comportamento de uma senha.** Alguns testes de sessão podem depender de uma senha única ou de um erro específico. O pedido manda ajustar só o que a mudança altera, sem perder o que eles verificam; cada ajuste precisa ser justificado no PR.
