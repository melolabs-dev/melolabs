# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema

Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`. Ao rotacionar a senha das sessões, todas as sessões seladas com a senha anterior deixam de abrir (`unsealSession` falha) e os usuários perdem a sessão de uma só vez. Não há como a aplicação aceitar senhas antigas durante a transição.

### Objetivo

Permitir a rotação de senhas sem invalidar sessões existentes, conforme a segunda alternativa da issue h3js/h3#1050: `password` passa a aceitar `string | string[]` (lista não vazia). Na lista, a **primeira** senha sela; **todas** podem abrir. Uma `string` continua com o comportamento atual.

### Métricas de sucesso

- Após rotacionar (nova senha na frente, antiga mantida na lista), 100% das sessões seladas com a senha antiga continuam válidas.
- Zero mudança de comportamento para quem usa uma única senha.
- Nenhum novo nome público além do tipo ampliado de `password`.

## 2. Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia

`SessionConfig.password` passa a ter o tipo `string | string[]`. Uma `string` equivale a uma lista de um elemento.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` como `string`, ou como `string[]` com ao menos um item,
- **Quando** `useSession`, `getSession`, `updateSession`, `sealSession` ou `unsealSession` a recebem,
- **Então** a configuração é aceita pelo tipo (`pnpm typecheck` passa) e a sessão funciona normalmente.

### RF-02 — Selagem usa apenas a primeira senha

Ao selar (`sealSession`, e portanto ao gravar o cookie), usa-se somente a primeira senha da lista.

**Critério de aceite**

- **Dado** `password: [nova, antiga]`,
- **Quando** uma sessão é criada ou atualizada e o cookie é emitido,
- **Então** o valor selado só pode ser aberto com `nova` (abrir com uma configuração que tenha apenas `antiga` falha).

### RF-03 — Abertura tenta todas as senhas, em ordem

Ao abrir (`unsealSession`), tenta-se cada senha na ordem da lista até uma funcionar.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `antiga` e a configuração `password: [nova, antiga]`,
- **Quando** a requisição chega com esse cookie (ou com o cabeçalho de sessão),
- **Então** `getSession` devolve os dados originais da sessão (id, `createdAt`, `data`) sem erro.

### RF-04 — Sessão aberta com senha antiga é regravada com a primeira

Uma sessão aberta com uma senha que não seja a primeira deve ser resselada com a primeira senha, para que a senha antiga possa ser aposentada depois, sem perder a sessão.

**Critério de aceite**

- **Dado** uma sessão selada com `antiga` e `password: [nova, antiga]`,
- **Quando** `getSession` lê essa sessão numa requisição com cookie,
- **Então** a resposta traz um `Set-Cookie` selado com `nova`, e esse cookie abre com `password: "nova"` isolada.

### RF-05 — Senha desconhecida continua rejeitada

Sessões seladas com senha ausente da lista não são aceitas e seguem o fluxo atual de sessão inválida (nova sessão criada).

**Critério de aceite**

- **Dado** uma sessão selada com `outra` e `password: [nova, antiga]`,
- **Quando** `getSession` lê o cookie,
- **Então** a sessão antiga não é restaurada, e uma sessão nova é criada, exatamente como ocorre hoje com senha errada.

### RF-06 — Compatibilidade com uma única senha

Com `password` string (ou lista de um item), o comportamento é idêntico ao atual, incluindo `maxAge`, `idleTimeout`, `legacySealFallback` e `seal` customizado.

**Critério de aceite**

- **Dado** `password: "x"` e, separadamente, `password: ["x"]`,
- **Quando** se executa a suíte de sessões existente e os mesmos cenários com a lista,
- **Então** os resultados são iguais nos dois casos e a suíte existente passa sem perder o que verifica (só se ajusta o que a mudança de fato altera).

### RF-07 — Fallback de iterações legadas vale para cada senha

O fallback de selos legados (1 iteração PBKDF2) deve funcionar também para sessões seladas com senhas antigas da lista.

**Critério de aceite**

- **Dado** uma sessão legada (1 iteração) selada com `antiga` e `password: [nova, antiga]`,
- **Quando** `getSession` a lê com `legacySealFallback` padrão,
- **Então** a sessão é restaurada e resselada com `nova` e as opções atuais; com `legacySealFallback: false` ela é rejeitada.

### RF-08 — Validação da lista

Lista vazia ou com item vazio é configuração inválida e falha de forma clara, sem aceitar sessões.

**Critério de aceite**

- **Dado** `password: []` (ou lista contendo `""`),
- **Quando** a sessão é selada ou aberta,
- **Então** é lançado erro (a exigência de senha não vazia atual é mantida) e nenhuma sessão é emitida nem aceita.

### RF-09 — Erros e expiração preservados

Quando nenhuma senha abre a sessão, propaga-se o erro relevante; expiração (`maxAge`/`idleTimeout`) é verificada após abrir, independentemente de qual senha abriu.

**Critério de aceite**

- **Dado** uma sessão expirada selada com `antiga` e `password: [nova, antiga]`,
- **Quando** `getSession` a lê,
- **Então** ela é tratada como expirada (nova sessão), como ocorre com uma única senha.

### RF-10 — Documentação e testes

O tipo/JSDoc de `password` descreve a semântica (primeira sela, demais só abrem) e há testes de regressão para RF-02 a RF-09.

**Critério de aceite**

- **Dado** o repositório após a mudança,
- **Quando** se roda `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`,
- **Então** todos passam e os novos testes falham sem a implementação.

## 3. Fora de escopo

- Novo campo de configuração (ex.: `extraUnsealPasswords`), a primeira alternativa da issue.
- Qualquer outro nome público novo (funções, tipos, opções).
- Senhas com `id` / objetos de senha do iron-crypto como forma de rotação; `Uint8Array` e outros formatos de senha.
- Mudanças no formato do cookie/selo, nos algoritmos ou nas iterações padrão.
- Gestão de rotação (agendamento, armazenamento de segredos, remoção automática de senhas antigas).
- Alterações em `requireBasicAuth` e demais usos da palavra "password".

## 4. Premissas e riscos

### Premissas

- A ordem da lista define a prioridade: o primeiro item é sempre o de selagem.
- O desenvolvedor remove a senha antiga da lista por conta própria, após a janela de `maxAge` ou depois que as sessões ativas forem resseladas.
- O Iron-crypto atual não identifica a senha usada no selo (id vazio), então a abertura se faz por tentativa e erro.

### Riscos

- **Custo de CPU:** cada tentativa falha faz PBKDF2 (8192 iterações). Com N senhas, uma sessão inválida custa até N tentativas (e 2N com o fallback legado). _Mitigação:_ recomendar listas curtas e testar o pior caso.
- **Distinguir erro de senha de outros erros:** falhas como "Bad hmac value" indicam senha errada, enquanto expiração do selo ou formato inválido não devem ser mascarados nem repetidos. _Mitigação:_ tentar a próxima senha só em erro de HMAC e preservar o erro original quando todas falharem (RF-09).
- **Ressel indevido:** resselar a cada leitura com senha antiga pode interagir com `idleTimeout` e `shouldSlide`. _Mitigação:_ reaproveitar o mecanismo de `kLegacySeal` e cobrir com teste (RF-04).
- **Quebra de tipos:** quem lê `SessionConfig["password"]` como `string` passa a receber `string | string[]`. _Mitigação:_ uso interno ajustado e `typecheck` obrigatório.
- **Rotação mal feita:** colocar a senha antiga na frente continua selando com ela. _Mitigação:_ documentar claramente no JSDoc (RF-10).
