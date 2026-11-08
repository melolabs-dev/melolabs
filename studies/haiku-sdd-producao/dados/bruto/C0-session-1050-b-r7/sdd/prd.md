# PRD — Senhas extras de unseal para sessões (h3js/h3#1050-b)

## 1. Problema e objetivo

### Problema

Hoje `SessionConfig.password` é a única senha usada para selar e abrir sessões (`src/utils/session.ts`). Ao rotacionar essa senha, todas as sessões já emitidas deixam de ser abertas: o `unseal` falha, a sessão é descartada e os usuários perdem o login. Para rotacionar segredos sem derrubar sessões ativas, é preciso continuar aceitando as senhas anteriores.

### Objetivo

Permitir que a configuração de sessão declare senhas anteriores que **só abrem** sessões, mantendo `password` como a única senha que **sela**. A rotação passa a ser: colocar a senha nova em `password` e mover a antiga para `extraUnsealPasswords`. Sem esse campo, o comportamento é idêntico ao atual.

### Referência

Issue h3js/h3#1050, primeira alternativa proposta (campo adicional, `password` continua string).

### Interface pública

- `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`.
- Nenhum outro nome público novo.

## 2. Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` na configuração

`SessionConfig` aceita o campo opcional `extraUnsealPasswords?: string[]`, documentado em TSDoc (só abre sessões, nunca sela; ordem de tentativa; mesmo requisito de entropia de `password`). `password` continua `string`.

**Critério de aceite**

- **Dado** uma `SessionConfig` com `password` string e `extraUnsealPasswords: ["senha-antiga…"]`
- **Quando** o projeto é verificado com `pnpm typecheck`
- **Então** a configuração compila sem erro, e passar `password` como array continua sendo erro de tipo.

### RF-02 — Selagem usa somente `password`

`sealSession` (e, por consequência, `updateSession` e `useSession`) sela sempre com `password`, nunca com uma senha extra.

**Critério de aceite**

- **Dado** uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`
- **Quando** uma sessão é criada ou atualizada e o cookie é emitido
- **Então** o valor selado só é aberto com P2 (abri-lo apenas com P1 falha).

### RF-03 — Abertura de sessões seladas com senha anterior

`unsealSession` tenta `password` primeiro e, se falhar, tenta cada item de `extraUnsealPasswords` na ordem. A primeira que abrir vence. Isso vale para sessões vindas de cookie (incluindo chunked) e do header de sessão.

**Critério de aceite**

- **Dado** uma sessão com dados selada com P1 e uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`
- **Quando** uma requisição com esse cookie chama `getSession`/`useSession`
- **Então** o `id`, `createdAt` e `data` originais são recuperados, sem criar uma sessão nova.

### RF-04 — Senha desconhecida continua rejeitada

Se nenhuma das senhas (principal ou extras) abre o valor selado, o comportamento atual é mantido: a sessão é descartada e uma nova é iniciada em memória. Nenhum erro novo é exposto ao chamador de `getSession`.

**Critério de aceite**

- **Dado** uma sessão selada com P0, que não está em `password` nem em `extraUnsealPasswords`
- **Quando** uma requisição com esse cookie chama `getSession`
- **Então** é retornada uma sessão nova (outro `id`, sem dados do cookie antigo), igual ao comportamento atual com senha errada.

### RF-05 — Reselagem automática com a senha atual

Quando uma sessão de cookie é aberta com uma senha extra, ela é resselada com `password` e o cookie atualizado é emitido na mesma resposta, de modo que a senha antiga possa ser removida da configuração depois que as sessões migrarem. Sessões do header de sessão não são reseladas (como hoje).

**Critério de aceite**

- **Dado** uma sessão de cookie selada com P1 e uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`
- **Quando** `getSession` é chamado para essa requisição
- **Então** a resposta contém `Set-Cookie` da sessão e esse novo valor abre apenas com P2, preservando `id`, `createdAt` e `data`.

### RF-06 — Sem senhas extras, nada muda

Com `extraUnsealPasswords` ausente ou vazio, selar, abrir, expirar e resselar se comportam exatamente como antes, inclusive o custo de uma única tentativa de unseal.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`)
- **Quando** a suíte de testes existente de sessões é executada
- **Então** todos os testes passam, e uma sessão selada com outra senha é rejeitada como hoje.

### RF-07 — Preservação das regras de expiração e do fallback legado

`maxAge`, `idleTimeout`, `seal` (opções do iron) e `legacySealFallback` valem igualmente para sessões abertas com senhas extras: uma sessão expirada continua expirada, e o fallback de 1 iteração PBKDF2 também é tentado com cada senha, respeitando `legacySealFallback: false`. A reselagem de RF-05 e a do fallback legado coexistem sem selar duas vezes.

**Critério de aceite**

- **Dado** uma sessão selada com P1 que já ultrapassou `maxAge` e uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`
- **Quando** `getSession` é chamado com esse cookie
- **Então** a sessão é tratada como expirada (sessão nova), e o mesmo vale para `idleTimeout`; e, com `legacySealFallback: false`, um valor legado selado com P1 é rejeitado.

### RF-08 — Documentação e testes

O novo campo é descrito na documentação de sessões do projeto (guia de rotação de senha) e coberto por testes de integração em `test/` usando `describeMatrix` (RF-02 a RF-07). Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam.

**Critério de aceite**

- **Dado** a mudança implementada
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam, e há ao menos um teste por RF-02 a RF-07 que falha sem a implementação.

## 3. Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue).
- Novos nomes públicos além de `extraUnsealPasswords` (sem novas funções, tipos ou exports).
- Rotação automática, geração ou armazenamento de segredos; remoção automática de senhas antigas.
- Revogação seletiva de sessões por senha, ou métricas de qual senha abriu a sessão.
- Mudanças em `sealSession` além de continuar usando `password`, em cookies, headers ou no `iron-crypto` fora do necessário.
- Outras features de sessão (`maxAge`, `idleTimeout`) além de preservar seu comportamento.

## 4. Premissas e riscos

### Premissas

- A ordem de tentativa é `password` e depois `extraUnsealPasswords` na ordem do array; a primeira que abrir vence.
- Senhas extras têm o mesmo requisito de entropia de `password` (≥ 32 caracteres, aleatórias); uma senha inválida em `extraUnsealPasswords` é ignorada na tentativa (falha de unseal) e não derruba a requisição.
- A reselagem (RF-05) é desejável porque é o que permite concluir a rotação; ela reutiliza o mecanismo de reselagem do fallback legado.
- `extraUnsealPasswords` com valor `undefined` ou `[]` equivale a ausente.

### Riscos

- **Custo de CPU / DoS:** cada tentativa de unseal executa PBKDF2 (8192 iterações) e o fallback legado dobra as tentativas. Um cookie inválido passa a custar até `(1 + N) × 2` operações; mitigar documentando que a lista deve ser curta.
- **Segurança:** uma senha antiga comprometida mantém sessões válidas enquanto estiver na lista; a documentação deve orientar a removê-la após a migração.
- **Regressão:** tocar `unsealSession` e o fluxo de reselagem em `getSession` pode alterar erros ou o número de `Set-Cookie`; coberto por RF-06 e pela suíte existente.
- **Mascarar erro de expiração:** se o tratamento de erros por senha engolir o erro "Session expired!", uma sessão expirada poderia ser aceita; coberto por RF-07.
- **Testes existentes:** algum teste pode assumir uma única chamada de `unseal` ou a mensagem de erro; exigirá ajuste mínimo sem enfraquecer a verificação.
