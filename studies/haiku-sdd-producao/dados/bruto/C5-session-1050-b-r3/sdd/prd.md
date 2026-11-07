# PRD — Várias senhas de unseal nas sessões (issue h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` e `getSession` (`src/utils/session.ts`) selam e abrem as sessões com uma única senha, `SessionConfig.password`. Quando o time troca essa senha, todas as sessões seladas com a senha anterior deixam de abrir, e os usuários são deslogados de uma vez.

O objetivo é permitir a rotação de senhas sem derrubar as sessões existentes. Para isso, `SessionConfig` ganha uma lista de senhas anteriores que servem apenas para abrir sessões. A senha atual continua sendo a única usada para selar.

Referência: issue h3js/h3#1050, primeira alternativa proposta nela.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado em JSDoc como senhas anteriores usadas somente para abrir sessões. Nenhum outro nome público novo é criado, e `password` continua `string`.

- **Dado** uma configuração de sessão com `password` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** o código TypeScript é compilado
- **Então** o campo é aceito como opcional, e a configuração sem `extraUnsealPasswords` continua válida sem alteração

### RF-02 — Abertura tenta a senha atual e depois as extras, nessa ordem

Ao abrir uma sessão, `unsealSession` tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem da lista. A primeira senha que abre a sessão é a que vale.

- **Dado** uma sessão selada com a senha anterior `"senha-antiga"`, e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a requisição chega com o cookie dessa sessão e `getSession` é chamado
- **Então** a sessão é carregada com o `id`, o `createdAt` e os `data` originais

### RF-03 — Selagem sempre usa `password`

Nenhuma senha de `extraUnsealPasswords` é usada por `sealSession` ou `updateSession`.

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** `sealSession` é chamado para uma sessão qualquer
- **Então** o resultado só abre com `"senha-nova"` e não abre com `"senha-antiga"`

### RF-04 — Sem senhas extras, o comportamento não muda

Quando `extraUnsealPasswords` está ausente ou é um array vazio, a abertura se comporta exatamente como antes: uma única tentativa com `password`, incluindo o fallback de seal legado (`legacySealFallback`).

- **Dado** uma configuração sem `extraUnsealPasswords`, e um cookie selado com outra senha
- **Quando** `getSession` é chamado
- **Então** a sessão não é carregada e um id novo é criado em memória, como acontece hoje

### RF-05 — Senha extra não contorna a expiração

A sessão aberta com uma senha extra continua sujeita a `maxAge` e `idleTimeout`. Se estiver expirada, `unsealSession` lança `Session expired!` do mesmo jeito que faria com a senha atual.

- **Dado** uma sessão selada com `"senha-antiga"`, com `createdAt` além de `maxAge`, e a configuração `password: "senha-nova"`, `extraUnsealPasswords: ["senha-antiga"]`, `maxAge` definido
- **Quando** `unsealSession` é chamado com o cookie dessa sessão
- **Então** a chamada lança `Session expired!`

### RF-06 — Sessão aberta com senha extra é resselada com `password`

Quando uma sessão aberta com senha extra é escrita ou resselada (por `updateSession`, pelo deslizamento de `idleTimeout` ou pelo fallback de seal legado), o novo cookie é selado com `password`. Isso faz a migração acontecer aos poucos, sem reselagem em massa.

- **Dado** uma sessão selada com `"senha-antiga"` e aberta com `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** o handler chama `updateSession` com novos dados nessa mesma requisição
- **Então** o `Set-Cookie` gerado abre com `"senha-nova"` e não abre com `"senha-antiga"`

### RF-07 — Vale também para sessões lidas do header

A tentativa com senhas extras é a mesma para o cookie e para o header de sessão (`sessionHeader`).

- **Dado** uma sessão selada com `"senha-antiga"` enviada no header `x-h3-session`, e a configuração com `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** `getSession` é chamado
- **Então** a sessão é carregada, e não é resselada, pois sessões lidas do header não deslizam

### RF-08 — Testes e lint continuam passando

Os testes existentes de sessão continuam passando, e são acrescentados testes para RF-02 a RF-07. `pnpm lint` e `pnpm typecheck` passam.

- **Dado** a branch com a mudança aplicada
- **Quando** `pnpm vitest run test/session.test.ts` e `pnpm lint` são executados
- **Então** ambos terminam sem falhas

## Fora de escopo

- Passar `password` como array (segunda alternativa da issue). Nesta versão, `password` continua sendo uma string.
- Rotação automática ou agendada das senhas, e qualquer gerenciamento de chaves.
- Reselagem proativa de todas as sessões quando uma senha é trocada. A migração acontece só quando a sessão é reescrita ou deslizada (RF-06).
- Mecanismo de revogação de sessões antigas.
- Mudanças em `src/utils/internal/iron-crypto.ts`, nos entries de runtime (`src/_entries/*`) ou em `useSession`/`getSession` além do necessário para a tentativa de senhas.
- Remoção ou alteração do `legacySealFallback`. Ele continua como está, com a remoção prevista para a v3.

## Premissas e riscos

**Premissas**

- A ordem de tentativa é `password` e depois `extraUnsealPasswords`, sem outra lógica de prioridade.
- As senhas extras vêm da configuração do servidor, não de dados do cliente.
- O fallback de seal legado (1 iteração PBKDF2) é aplicado a cada senha tentada, para que sessões antigas e selas com senha extra continuem abrindo.

**Decisões em aberto**

- Validação de tamanho: a documentação de `password` pede pelo menos 32 caracteres. Recomendação: aplicar a mesma regra a cada item de `extraUnsealPasswords`, e confirmar se essa validação já existe em algum lugar antes de implementar.
- Senha vazia ou duplicada na lista: recomendação é ignorar sem erro, ou rejeitar na inicialização. Escolha a ser feita na implementação.

**Riscos**

- **Custo de CPU por requisição.** Cada tentativa é uma derivação PBKDF2 com o número de iterações configurado. Um cookie inválido passa a custar até `1 + N` derivações (N = tamanho da lista), e o dobro quando o fallback legado entra em jogo. Com listas longas, isso pode virar vetor de negação de serviço. Mitigação: manter a lista curta e documentar o custo.
- **Senha antiga comprometida continua valendo** enquanto estiver na lista. A remoção é responsabilidade do operador, e a documentação deve dizer isso.
- **Remoção prematura** derruba sessões que ainda não foram resseladas. Por isso a migração depende de RF-06, e o operador deve manter a senha antiga até o `maxAge` ou `idleTimeout` de todas as sessões ter passado.
- **Desempenho do `maxAge`.** Como a expiração é checada depois do unseal, uma sessão expirada selada com senha extra ainda consome a derivação. Não é um problema de segurança, mas deve ser medido em `test/bench/session.ts`.
