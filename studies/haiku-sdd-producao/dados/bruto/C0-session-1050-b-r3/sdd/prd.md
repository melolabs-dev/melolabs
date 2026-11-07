# PRD — Várias senhas de unseal nas sessões (`extraUnsealPasswords`)

Referência: issue h3js/h3#1050 (primeira alternativa), contrato enxuto #1050-b. Arquivo afetado: `src/utils/session.ts`.

## Problema e objetivo

### Problema
Hoje `SessionConfig.password` é a única senha usada para selar e abrir sessões. Ao rotacionar essa senha (boa prática de segurança, ou resposta a vazamento), todas as sessões seladas com a senha anterior deixam de abrir e todos os usuários são deslogados de uma vez.

### Objetivo
Permitir a rotação de senha sem invalidar sessões existentes: o `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores usadas **somente para abrir** sessões. `password` continua sendo uma string e continua sendo a única senha que sela.

### Métricas de sucesso
- Uma sessão selada com uma senha listada em `extraUnsealPasswords` é aceita e mantém `id`, `createdAt` e `data`.
- Sem `extraUnsealPasswords`, o comportamento é idêntico ao atual (suíte existente passa sem perda de cobertura).
- `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`
`SessionConfig` expõe `extraUnsealPasswords?: string[]`, documentado com TSDoc (senhas anteriores, só abrem sessões, mesmo requisito de tamanho mínimo e de entropia de `password`). Nenhum outro nome público novo é criado e `password` permanece `string`.

**Critério de aceite**
- **Dado** uma configuração `{ password, extraUnsealPasswords: [antiga] }`
- **Quando** o código TypeScript é verificado (`pnpm typecheck`)
- **Então** a configuração compila, e `password` continua aceitando apenas `string`.

### RF-02 — Sessões seladas com senha extra são aceitas
Ao abrir uma sessão (cookie ou header), tenta-se primeiro `password` e, se falhar, cada senha de `extraUnsealPasswords`, na ordem da lista. A primeira que abrir com sucesso vale. Vale para `getSession`, `useSession` e `unsealSession`.

**Critério de aceite**
- **Dado** uma sessão com dados selada com a senha A, e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** uma requisição com essa sessão chama `getSession`/`useSession`
- **Então** a sessão é carregada com o mesmo `id`, `createdAt` e `data`, sem criar uma sessão nova.

### RF-03 — Sessões seladas com senha desconhecida continuam rejeitadas
Uma sessão selada com senha que não é `password` nem consta em `extraUnsealPasswords` é tratada como inválida: descartada e substituída por uma sessão nova, como hoje.

**Critério de aceite**
- **Dado** uma sessão selada com a senha C e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** uma requisição com essa sessão chama `getSession`
- **Então** os dados da sessão antiga não são carregados e uma sessão nova (novo `id`) é criada.

### RF-04 — Selagem sempre usa `password`
`sealSession` e `updateSession` selam apenas com `password`, nunca com uma senha extra.

**Critério de aceite**
- **Dado** uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** `sealSession` (ou `updateSession`) gera um token
- **Então** o token abre com `B` sozinho e não abre com `A` sozinho.

### RF-05 — Resselagem proativa de sessões abertas com senha extra
Quando uma sessão vinda de **cookie** é aberta com uma senha extra, ela é resselada com `password` na mesma requisição (mesmo mecanismo da resselagem de seal legado), para que a senha antiga possa ser removida da lista com o tempo. Sessões lidas do header não são resseladas, como hoje. A resselagem preserva `id`, `createdAt` e `data`.

**Critério de aceite**
- **Dado** uma sessão em cookie selada com A e configuração `password: B`, `extraUnsealPasswords: [A]`
- **Quando** a requisição chama `getSession` e a resposta é gerada
- **Então** a resposta traz `Set-Cookie` com a sessão selada por B, que abre apenas com `B`, com o mesmo `id`.

### RF-06 — Regras de expiração valem para qualquer senha
`maxAge` e `idleTimeout` são aplicados da mesma forma, independentemente de qual senha abriu a sessão. Uma senha extra não estende a vida da sessão.

**Critério de aceite**
- **Dado** uma sessão expirada pelo `maxAge` (ou `idleTimeout`) selada com a senha extra A
- **Quando** uma requisição com essa sessão chama `getSession`
- **Então** a sessão é rejeitada e substituída por uma nova.

### RF-07 — Compatibilidade com o fallback de seal legado
O fallback de `legacySealFallback` (1 iteração PBKDF2) continua funcionando com `password` e também com as senhas extras, respeitando `legacySealFallback: false`. Uma sessão com seal legado aberta por senha extra é resselada (RF-05) com as opções atuais.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra A usando 1 iteração PBKDF2, e `legacySealFallback` não definido
- **Quando** a requisição chama `getSession`
- **Então** a sessão é carregada e resselada com `password` e as iterações atuais; com `legacySealFallback: false` ela é rejeitada.

### RF-08 — Sem senhas extras, nada muda
Com `extraUnsealPasswords` ausente ou `[]`, o fluxo, os erros e a saída são os mesmos de hoje. Os testes existentes continuam passando; só são ajustados os que dependam do que a mudança altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`)
- **Quando** a suíte existente de sessões roda (`pnpm vitest run test/session.test.ts`)
- **Então** todos os testes passam e uma sessão selada com outra senha continua sendo rejeitada.

### RF-09 — Testes de regressão e qualidade
Novos testes (via `describeMatrix`, em `web` e `node`) cobrem RF-02 a RF-07. Seguindo o fluxo de bug/feature do projeto, os testes novos devem falhar antes da implementação. `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** os testes novos escritos antes da implementação
- **Quando** rodados sem a mudança em `src/utils/session.ts`
- **Então** os de RF-02, RF-05 e RF-07 falham; depois da implementação todos passam, junto com `pnpm lint` e `pnpm typecheck`.

## Fora de escopo
- Aceitar `password` como `string | string[]` (segunda alternativa da issue).
- Nomes públicos novos além de `extraUnsealPasswords`, e ids de senha no estilo iron (`{ id, secret }`).
- Rotação automática de senhas, expiração de senhas antigas ou invalidação seletiva por senha.
- Mudanças em `iron-crypto.ts`, no formato do token selado ou em outras APIs (`requireBasicAuth`, cookies avulsos etc.).
- Remoção do fallback legado (planejada para a v3).
- Documentação fora do TSDoc (site/guia), salvo se já houver página de sessões a atualizar de forma trivial.

## Premissas e riscos

### Premissas
- A ordem de tentativa é `password` e depois `extraUnsealPasswords` na ordem dada; quem configura coloca as mais recentes primeiro.
- Senhas extras seguem as mesmas regras de `password` (string, mínimo de 32 caracteres, alta entropia); uma senha extra inválida simplesmente não abre a sessão.
- Uma lista vazia ou ausente equivale a "sem rotação".
- A resselagem proativa (RF-05) é desejada, pois é o que permite aposentar a senha antiga.

### Riscos
- **Custo de CPU**: cada tentativa falha faz PBKDF2 (8192 iterações) e, com o fallback legado, mais uma. Com N senhas extras o pior caso (cookie inválido) multiplica o custo por até 2·(N+1). Mitigação: documentar que a lista deve ser curta e removê-las após a janela de rotação. Um cookie forjado pode ser usado para amplificar carga.
- **Superfície de segurança**: uma senha antiga vazada continua válida enquanto estiver na lista. Mitigação: documentar que só se mantém na lista senhas ainda confiáveis.
- **Distinção de erro**: só tentar a próxima senha em falha de integridade/descriptografia, não em expiração (`Session expired!`), para não mascarar erros nem repetir trabalho. Confirmar o comportamento dos erros do `iron-crypto` na implementação.
- **Resselagem em header**: sessões via header não são resseladas, então continuam dependendo da senha extra até expirarem.
- **Testes existentes** que fixam o erro lançado ou o número de chamadas de unseal podem precisar de ajuste; deve-se preservar o que verificam.
