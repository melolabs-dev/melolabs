# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

- Data: 2026-11-06
- Origem: [`sdd/pedido.md`](pedido.md) (issue h3js/h3#1050, primeira alternativa proposta nela)
- Código afetado: `src/utils/session.ts` (`SessionConfig`, `getSession`, `useSession`, `updateSession`, `sealSession`, `unsealSession`) e `test/session.test.ts`

## Problema e objetivo

Hoje `SessionConfig.password` é a única chave aceita para abrir uma sessão selada. Quem gira a senha (rotação de segredo) invalida todas as sessões ativas: o usuário é desconectado e perde o estado da sessão, mesmo que a sessão ainda esteja dentro de `maxAge`/`idleTimeout`.

**Objetivo:** permitir que o desenvolvedor declare senhas anteriores em `extraUnsealPasswords`. Essas senhas só servem para abrir sessões já seladas. Toda sessão nova ou reselada passa a ser selada somente com `password`. Assim a rotação não derruba sessões válidas, e as senhas antigas podem ser removidas quando as sessões antigas expirarem ou forem reseladas.

Fora do objetivo: mudar o formato do token, a forma de selar ou a API pública além do campo novo.

## Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com a documentação TSDoc dizendo que são senhas anteriores usadas só para abrir sessões. Sem o campo, ou com `[]`, o comportamento é o de hoje.

**Critério de aceite:**
- **Dado** uma `SessionConfig` sem `extraUnsealPasswords` e outra com `extraUnsealPasswords: []`,
- **Quando** uma sessão é criada e lida com cada uma delas,
- **Então** o cookie emitido e os dados lidos são idênticos aos do comportamento atual, nos dois casos.

### RF-02 — Selagem usa apenas `password`

Toda selagem (`sealSession`, e portanto `updateSession` e a criação de sessão) usa somente `password`. As senhas extras nunca selam.

**Critério de aceite:**
- **Dado** uma sessão nova criada com `{ password: P, extraUnsealPasswords: [A] }`,
- **Quando** o cookie emitido é aberto com a configuração `{ password: P }` (sem extras),
- **Então** a abertura tem sucesso e retorna o mesmo `id` e os mesmos dados da sessão.

### RF-03 — Abrir sessão selada com uma senha extra

Quando a sessão foi selada com uma senha extra e `password` não a abre, a leitura tenta as senhas extras e retorna a sessão original.

**Critério de aceite:**
- **Dado** um cookie selado com a senha `A` (criado com `{ password: A }`, `id` = `s1`, dados `{ user: "ana" }`),
- **Quando** a sessão é lida com `{ password: P, extraUnsealPasswords: [A] }`,
- **Então** `getSession` retorna `id` = `s1` e `data` = `{ user: "ana" }`.

### RF-04 — Qualquer uma das senhas extras serve

Com várias senhas extras, a sessão é aberta por qualquer uma delas. A ordem da lista não muda o resultado, porque cada senha tem uma chave diferente e só uma verifica o HMAC.

**Critério de aceite:**
- **Dado** um cookie selado com a senha `B`, que é a segunda de `extraUnsealPasswords: [A, B]`,
- **Quando** a sessão é lida com `{ password: P, extraUnsealPasswords: [A, B] }`,
- **Então** a sessão é retornada com o mesmo `id` e os mesmos dados.

### RF-05 — Senha desconhecida continua produzindo sessão nova

Se nenhuma senha (`password` ou extra) abre o cookie, o comportamento é o de hoje para cookie inválido: a leitura não falha, não traz dados antigos e uma nova sessão é criada.

**Critério de aceite:**
- **Dado** um cookie selado com a senha `X`, que não está em `password` nem em `extraUnsealPasswords`,
- **Quando** a sessão é lida com `{ password: P, extraUnsealPasswords: [A] }`,
- **Então** `getSession` não lança erro, `data` está vazio e `id` é diferente do `id` do cookie.

### RF-06 — Sessão aberta por senha extra é reselada com `password`

Quando uma sessão de cookie é aberta por uma senha extra, a resposta reemite o cookie selado com `password`. Assim o cookie migra para a senha atual sem mudar a sessão: o `id` e o `createdAt` são preservados.

**Critério de aceite:**
- **Dado** um cookie selado com `A` e uma sessão lida com `{ password: P, extraUnsealPasswords: [A] }` por meio de um request com cookie,
- **Quando** a resposta é gerada,
- **Então** há um `Set-Cookie` da sessão com um valor que abre com `{ password: P }` sozinho, e o `id` e o `createdAt` não mudam.

### RF-07 — Sessão lida pelo cabeçalho de sessão não é reselada

Sessões lidas pelo cabeçalho de sessão (`sessionHeader`) não têm cookie para reemitir. Elas são abertas pelas senhas extras, mas nenhum cookie novo é emitido. O comportamento de `sessionHeader` não muda.

**Critério de aceite:**
- **Dado** um cabeçalho de sessão com um valor selado com `A`, e a configuração `{ password: P, extraUnsealPasswords: [A] }`,
- **Quando** a sessão é lida nesse request,
- **Então** os dados são retornados e a resposta não contém `Set-Cookie` da sessão.

### RF-08 — Expiração não é contornada pelas senhas extras

A verificação de `maxAge` e `idleTimeout` vale para a sessão, não para a senha. Uma sessão expirada não vira válida por ser aberta com uma senha extra, e a leitura não tenta as demais senhas depois que o selo expirou.

**Critério de aceite:**
- **Dado** um cookie selado com `A` cuja sessão já ultrapassou `maxAge`,
- **Quando** a sessão é lida com `{ password: P, extraUnsealPasswords: [A], maxAge: 60 }`,
- **Então** a sessão é tratada como expirada (`data` vazio e `id` novo), do mesmo jeito que com `password: A` sozinho.

### RF-09 — Senhas extras passam pela mesma regra de tamanho de `password`

Cada item de `extraUnsealPasswords` precisa ter o tamanho mínimo que o seal exige para `password` (32 caracteres por padrão, `seal.minPasswordlength`). A validação roda no início de `getSession`/`useSession`, antes de ler o cookie, para que a configuração errada não falhe em silêncio.

**Critério de aceite:**
- **Dado** uma configuração com `extraUnsealPasswords: ["a".repeat(31)]`,
- **Quando** `useSession` é chamado num request sem cookie,
- **Então** a chamada lança um erro que identifica a senha extra como inválida (mensagem de tamanho mínimo), e nenhum cookie é emitido.

### RF-10 — Interação com o fallback de seal legado

O fallback de seal legado (`legacySealFallback`, 1 iteração PBKDF2) se aplica a cada senha, na mesma ordem: `password` e depois as extras. Uma sessão antiga aberta por uma extra também é reselada com o seal atual.

**Critério de aceite:**
- **Dado** um cookie selado com `A` usando o seal legado (1 iteração) e a configuração `{ password: P, extraUnsealPasswords: [A] }`,
- **Quando** a sessão é lida,
- **Então** os dados são retornados com o mesmo `id`, e o `Set-Cookie` emitido abre com `{ password: P }` e com o seal atual.

### RF-11 — Compatibilidade do suite existente

Os testes existentes em `test/session.test.ts` continuam passando. Se um teste existente precisar mudar, a mudança só ajusta o setup e preserva o que o teste verifica.

**Critério de aceite:**
- **Dado** o código com esta mudança,
- **Quando** `pnpm vitest run test/session.test.ts` roda,
- **Então** todos os testes passam, em `web` e em `node` (matriz `describeMatrix`).

### RF-12 — Nenhum nome público novo e lint/typecheck verdes

A única superfície pública nova é o campo `extraUnsealPasswords` em `SessionConfig`. Nenhuma função, tipo ou export novo é adicionado ao `src/index.ts`.

**Critério de aceite:**
- **Dado** a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` rodam,
- **Então** ambos passam, e a lista de exports de `src/index.ts` é a mesma de antes, exceto pelo tipo `SessionConfig`, que ganha o campo.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050).
- Escolher a senha de selagem automaticamente, rotacionar chaves ou gerar segredos.
- Invalidar sessões já emitidas, revogar sessões específicas ou listar sessões ativas.
- Limitar o número de senhas extras (tema de risco, não de implementação neste PRD).
- Reselar sessões lidas pelo cabeçalho de sessão, ou mudar a semântica de `sessionHeader`.
- Mudar o formato do token, o algoritmo de seal ou o padrão de iterações PBKDF2.
- Remover o `legacySealFallback` (fica para a v3, conforme o TODO existente).
- Documentação extensa no site; basta o TSDoc do campo.

## Premissas e riscos

### Premissas

- **P1.** O token iron carrega o `passwordId`. Com `password` em string, o id é vazio e a abertura usa a chave `"default"`. A mudança não altera o token, então tokens já emitidos continuam válidos.
- **P2.** Senha errada aparece como `Bad hmac value`, e expiração do selo como `Expired seal`. Este último é checado antes da verificação de senha. Por isso só falhas de `Bad hmac value` avançam para a próxima senha; os demais erros propagam como hoje.
- **P3.** Hoje, erro de unseal em `getSession` é capturado e vira sessão nova (RF-05 mantém isso).
- **P4.** Testes seguem o padrão `describeMatrix` do AGENTS.md (web e node).
- **P5.** Remover uma senha da lista de extras é uma decisão do operador. Esta mudança não a faz sozinha.

### Riscos

- **R1 — Custo de CPU.** Cada tentativa é uma derivação PBKDF2 (8192 iterações por padrão). Um cookie que não abre com nenhuma senha custa `(1 + extras) × 2` derivações quando o fallback legado está ativo. Como o cookie chega sem autenticação, isso pode ser usado para amplificar carga. Mitigação possível: limitar o número de extras ou documentar o custo. Recomendação: documentar e deixar o limite para uma decisão posterior.
- **R2 — Senha vazada continua aceita.** Enquanto uma senha antiga estiver na lista, quem a tiver consegue abrir sessões. O operador precisa remover a senha depois que as sessões antigas expirarem.
- **R3 — Sessões por cabeçalho não migram.** Elas continuam abertas pela senha antiga até expirarem (RF-07).
- **R4 — Erro silencioso em produção.** Como hoje um erro de unseal vira sessão nova, uma senha errada em `password` continua silenciosa. RF-09 cobre só as extras, então a inconsistência fica registrada.
- **R5 — Expectativa de rotação.** Sem RF-06, as sessões nunca migrariam e a senha antiga ficaria para sempre. Por isso RF-06 é obrigatório.
