# PRD: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## Problema e objetivo

### Problema

Hoje o `h3` sela sessões (`src/utils/session.ts`) com uma única senha, configurada em `password`. Quando o time troca essa senha por rotação de segredos, todas as sessões já seladas com a senha anterior deixam de abrir. Na prática, os usuários logados são desconectados de uma vez, mesmo sem nenhum problema de segurança que justifique isso.

### Objetivo

Permitir a rotação da senha de sessão sem derrubar quem já está logado. Após a troca, o app passa a:

- selar toda sessão nova ou regravada apenas com a senha atual (`password`);
- continuar aceitando sessões seladas com senhas anteriores, listadas em um novo campo `extraUnsealPasswords` de `SessionConfig`;
- migrar progressivamente essas sessões para a senha atual, à medida que os usuários fazem requisições.

Esta é a variante (b) do contrato do issue: a rotação é configurada em um campo novo, e o tipo de `password` não muda.

## Requisitos funcionais

### RF-01 — Configurar senhas extras

`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores. Essas senhas servem só para abrir sessões. Campo ausente e lista vazia são equivalentes.

**Critério de aceite**

- **Dado** uma configuração de sessão sem `extraUnsealPasswords`, ou com `extraUnsealPasswords: []`,
- **Quando** o app cria, lê ou atualiza uma sessão,
- **Então** o comportamento é idêntico ao atual, sem senhas extras em nenhuma etapa.

### RF-02 — Selar sempre com a senha atual

Toda selagem (sessão nova, `updateSession`, `sealSession` e re-selagem automática) usa `password`. Nenhuma senha de `extraUnsealPasswords` é usada para selar.

**Critério de aceite**

- **Dado** uma configuração com `password = "A"` e `extraUnsealPasswords = ["B"]`,
- **Quando** o app cria uma sessão nova com `useSession` ou chama `sealSession`,
- **Então** a sessão selada só abre com `"A"` e não abre com `"B"`.

### RF-03 — Abrir com a senha atual e depois com as extras, em sequência

A sessão é aberta tentando as senhas uma de cada vez: `password` primeiro, depois as senhas de `extraUnsealPasswords` na ordem da lista. A tentativa para na primeira senha que abrir. Se `password` abrir a sessão, nenhuma senha extra é tentada.

**Critério de aceite**

- **Dado** uma sessão selada com a senha da lista extra na segunda posição,
- **Quando** `getSession` lê essa sessão do cookie,
- **Então** `id`, `createdAt` e os dados são preservados, e as tentativas param na senha que abriu.
- **Dado** uma sessão selada com `password`,
- **Quando** `getSession` a lê,
- **Então** nenhuma senha de `extraUnsealPasswords` é tentada.

### RF-04 — Tratar senha desconhecida como sessão inexistente

Uma sessão selada com senha que não é `password` nem está em `extraUnsealPasswords` é tratada como inexistente, do mesmo jeito que hoje ocorre com senha errada. O pedido segue sem erro e a sessão é nova e vazia.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha que não está na configuração,
- **Quando** `getSession` ou `useSession` lê essa sessão,
- **Então** nenhum erro é lançado, a sessão retornada está vazia e não traz dados da sessão original.

### RF-05 — Rotação progressiva na leitura

Quando `getSession` (e, por consequência, `useSession`) abre uma sessão vinda do cookie com uma senha extra, ela é re-selada com `password` e enviada em um novo `Set-Cookie` na mesma resposta. Isso vale mesmo quando o handler só lê a sessão, pelo mesmo mecanismo que hoje re-sela sessões legadas. Sessões abertas com `password` não são re-seladas. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha extra chegando pelo cookie,
- **Quando** um handler apenas lê a sessão com `useSession`,
- **Então** a resposta contém um `Set-Cookie` com a sessão re-selada com `password`, e a sessão lida mantém `id`, `createdAt` e dados.
- **Dado** uma sessão selada com `password` chegando pelo cookie,
- **Quando** um handler apenas lê a sessão,
- **Então** a resposta não contém `Set-Cookie` de re-selagem.
- **Dado** uma sessão selada com uma senha extra chegando pelo cabeçalho de sessão,
- **Quando** o handler lê a sessão,
- **Então** a resposta não contém `Set-Cookie` de re-selagem.

### RF-06 — Validar as senhas extras

Cada senha extra segue a mesma regra de `password`: não pode ser vazia e precisa ter pelo menos `minPasswordlength` caracteres (32 por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession` e `sealSession`) rejeita com erro cuja mensagem contém a palavra "password", mesmo quando o pedido não traz sessão. Uma senha extra inválida em qualquer posição da lista provoca o erro. Uma `password` inválida continua provocando erro como hoje.

**Critério de aceite**

- **Dado** `extraUnsealPasswords` com uma senha de 10 caracteres na terceira posição,
- **Quando** `sealSession` ou `updateSession` é chamado, mesmo sem cookie de sessão no pedido,
- **Então** a operação rejeita com erro cuja mensagem contém "password", e a mensagem não revela o valor da senha.
- **Dado** `extraUnsealPasswords` com uma string vazia,
- **Quando** `useSession` cria uma sessão nova,
- **Então** a operação rejeita com erro que contém "password".

### RF-07 — Cobertura nas funções e nos formatos de sessão

A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`. Vale também para sessões em cookie dividido em pedaços (chunks) e para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha extra e dividida em chunks no cookie,
- **Quando** `getSession` ou `useSession` a lê,
- **Então** a sessão é aberta corretamente e os dados são preservados.
- **Dado** uma sessão selada com uma senha extra,
- **Quando** `clearSession` ou `unsealSession` é chamado com essa sessão,
- **Então** a operação abre a sessão sem erro e se comporta como com `password`.

### RF-08 — Sessões legadas com as senhas extras

O fallback atual para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo. Ele se aplica a `password` e a todas as senhas extras. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**

- **Dado** uma sessão legada selada com uma senha extra e `legacySealFallback` ativo,
- **Quando** `getSession` a lê,
- **Então** a sessão é aberta, e a resposta traz um `Set-Cookie` com a sessão re-selada com `password` e as opções de selo atuais.
- **Dado** a mesma sessão legada e `legacySealFallback: false`,
- **Quando** `getSession` a lê,
- **Então** a sessão não é aberta e é tratada como inexistente.

### RF-09 — Compatibilidade com o comportamento atual

Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento é idêntico ao atual. Isso inclui não re-selar ao só ler e rejeitar sessões de outras senhas. `maxAge`, `idleTimeout`, cookies em chunks, cabeçalho de sessão, `errHeaders` e o restante do comportamento permanecem como estão. A suíte de testes existente e `pnpm lint` / `pnpm typecheck` continuam passando.

**Critério de aceite**

- **Dado** a suíte de testes atual, sem alterações nos testes existentes,
- **Quando** `pnpm test` é executado,
- **Então** todos os testes existentes passam, com lint e typecheck.
- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** uma sessão de outra senha é lida,
- **Então** o resultado é o mesmo de hoje: sessão nova e vazia, sem `Set-Cookie`.

## Fora de escopo

- Aceitar um array em `password` (a variante "a" do issue). A variante escolhida é a (b).
- Qualquer nome público novo além de `extraUnsealPasswords` em `SessionConfig`.
- Mudança no tipo de `password`.
- Rotação automática, agendada ou por tempo das senhas, e qualquer mecanismo para gerar ou armazenar senhas.
- Mudança em `maxAge`, `idleTimeout`, formato dos chunks de cookie, cabeçalho de sessão ou `errHeaders`.
- Alterações no módulo `v1` descontinuado (`_deprecated.ts`).
- Documentação pública além do necessário para o novo campo.

## Premissas e riscos

### Premissas

- A implementação fica em `src/utils/session.ts`, com a selagem e a abertura em `src/utils/internal/iron-crypto.ts`, conforme a estrutura descrita no `AGENTS.md`.
- O `minPasswordlength` padrão é 32 caracteres, como hoje.
- O operador do app remove da lista as senhas antigas quando não houver mais sessões seladas com elas. O h3 não rastreia isso.
- O app usa `Set-Cookie` na resposta para propagar a re-selagem. Não há cache intermediário que ignore esse cabeçalho em respostas com sessão.

### Riscos

- **Custo criptográfico.** Cada senha extra tentada custa uma derivação de chave. Uma lista longa, combinada com sessões seladas com as últimas senhas, aumenta a latência de leitura. Mitigação: manter a lista curta e remover senhas antigas assim que possível.
- **Re-selagem em leituras.** Handlers que só leem a sessão passam a emitir `Set-Cookie`. Isso pode surpreender consumidores que dependem de cabeçalhos estáveis ou que cacheiam respostas. Mitigação: documentar o comportamento no campo e cobrir com testes.
- **Validação mais cedo.** A validação de senhas extras ocorre em operações de selagem que hoje não validam quando não há sessão. Fluxos que dependiam dessa tolerância podem falhar. Mitigação: a regra segue `password` e a mensagem de erro é explícita.
- **Vazamento de senhas antigas.** Enquanto uma senha estiver na lista, sessões seladas com ela continuam válidas. Isso pode prolongar a exposição de um segredo comprometido. Mitigação: orientação para remover a senha da lista após a janela de rotação.
- **Exposição de segredos em erros e logs.** As mensagens de validação não podem incluir o valor das senhas. Os testes devem verificar isso.
