# PRD — Múltiplas senhas de unseal nas sessões

Referência: h3js/h3#1050 (primeira alternativa proposta na issue, `extraUnsealPasswords`).

## Problema e objetivo

Hoje, `useSession` / `getSession` (`src/utils/session.ts`) aceitam uma única `password`. Ao trocar essa senha para girar o segredo, todas as sessões seladas com a senha anterior deixam de abrir: `unsealSession` lança erro, `getSession` ignora a falha e cria uma sessão nova. Na prática, todo usuário logado é deslogado na rotação.

Objetivo: permitir que o servidor aceite sessões seladas com senhas anteriores durante a rotação, sem mudar a senha usada para selar novas sessões.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores que só servem para abrir sessões. `password` continua sendo `string`. Nenhum outro nome público novo é criado.

**Critério de aceite**

- Dado uma configuração com `password: "nova-senha…"` e `extraUnsealPasswords: ["antiga-senha…"]`,
- Quando a configuração é passada a `useSession` ou `getSession`,
- Então o tipo é aceito pelo TypeScript e nenhum outro campo público precisa ser declarado.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou regravada é selada somente com `password`. As senhas extras nunca são usadas para selar.

**Critério de aceite**

- Dado uma sessão aberta com `extraUnsealPasswords` contendo a senha antiga,
- Quando o handler grava dados na sessão (`update`),
- Então o cookie resultante abre com `password` e não abre com a senha antiga.

### RF-03 — Abertura com a primeira senha que funcionar

Ao abrir um selo, a ordem de tentativas é: `password`, depois cada item de `extraUnsealPasswords` na ordem da lista. A primeira que abrir o selo vence.

**Critério de aceite**

- Dado um cookie selado com a senha da posição 2 de `extraUnsealPasswords`,
- Quando a requisição chega ao handler com `useSession`,
- Então a sessão é carregada com os dados originais, o mesmo `id` e o mesmo `createdAt`.

### RF-04 — Sem senhas extras, comportamento idêntico

Quando `extraUnsealPasswords` não é informado (ou é vazio), o comportamento, o payload selado, os cookies e os erros são os mesmos de hoje.

**Critério de aceite**

- Dado uma configuração sem `extraUnsealPasswords`,
- Quando a suíte existente roda (`test/session.test.ts` e demais),
- Então todos os testes continuam passando sem alteração de expectativa.

### RF-05 — Expiração continua valendo

`maxAge` e `idleTimeout` são aplicados a sessões abertas com senha extra da mesma forma que a sessões abertas com `password`.

**Critério de aceite**

- Dado uma sessão selada com a senha antiga e `createdAt` mais antigo que `maxAge`,
- Quando a requisição chega com `extraUnsealPasswords` configurado,
- Então a sessão é tratada como expirada e uma sessão nova é criada.

### RF-06 — Senha desconhecida mantém o tratamento atual

Um selo que nenhuma das senhas abre é tratado como hoje: a sessão em memória é nova, sem dados, e nenhuma exceção chega ao handler.

**Critério de aceite**

- Dado um cookie selado com uma senha que não está na lista,
- Quando a requisição chega ao handler,
- Então `getSession` devolve uma sessão nova sem dados e o handler responde normalmente.

### RF-07 — Vale para cookie e para header de sessão

A tentativa com senhas extras acontece tanto para a sessão lida do cookie quanto para a lida do header `x-{name}-session`.

**Critério de aceite**

- Dado uma sessão selada com a senha antiga enviada no header de sessão,
- Quando a requisição é processada com `extraUnsealPasswords` configurado,
- Então os dados da sessão são lidos normalmente.

### RF-08 — Fallback legado preservado

O fallback de 1 iteração PBKDF2 (`legacySealFallback`) continua funcionando para sessões seladas com a senha atual.

**Critério de aceite**

- Dado uma sessão selada com 1 iteração e a senha atual,
- Quando a sessão é lida com `extraUnsealPasswords` configurado,
- Então ela abre, é regravada com as opções atuais, e o comportamento é igual ao de hoje.

### RF-09 — Qualidade do código

A mudança não introduz erros de lint nem de tipo.

**Critério de aceite**

- Dado a implementação e os testes novos,
- Quando `pnpm lint` e `pnpm typecheck` são executados,
- Então ambos terminam sem erros.

## Fora de escopo

- Lista de senhas em `password` (alternativa 2 da issue). Nesta variante, `password` continua sendo string.
- Reselagem forçada de todas as sessões com a senha atual, ou comando/rotina para retirar senhas antigas.
- Mudança no formato do selo (`iron-crypto.ts`), nos parâmetros de PBKDF2 ou no algoritmo.
- Mudança em `h3` v1 ou em `_deprecated.ts`.
- Novos campos públicos além de `extraUnsealPasswords`.
- Validação de força das senhas extras além da que já existir para `password`.

## Premissas e riscos

### Premissas

- A reselagem de uma sessão aberta com senha extra acontece pelos caminhos que já existem (escrita pelo handler, fallback legado ou `idleTimeout` deslizante). Nenhum caminho novo é criado só para migrar sessões.
- Senhas extras são tratadas como as demais: o código não impõe tamanho mínimo hoje para `password`, então a mesma regra vale para as extras. A confirmar: se houver validação de tamanho em `iron-crypto.ts`, ela deve se aplicar às extras.
- O cliente não precisa saber qual senha foi usada.

### Riscos

- **Amplificação de CPU.** Cada tentativa é uma derivação PBKDF2 (8192 iterações por padrão). Um cookie inválido passa a custar até `N + 1` derivações, e o fallback legado pode dobrar esse custo. Como o cookie vem do cliente, isso pode ser usado para gastar CPU. Mitigação sugerida: documentar um limite recomendado de senhas extras (por exemplo, até 2 ou 3) e medir o custo de uma requisição com cookie inválido.
- **Senhas antigas esquecidas.** Enquanto uma senha antiga estiver na lista, sessões seladas com ela continuam válidas até expirar. Se a lista nunca for limpa, a senha antiga fica ativa indefinidamente. Mitigação: documentar que a senha deve sair da lista depois de `maxAge` (ou `idleTimeout`) da sessão mais antiga.
- **Fallback legado com senha extra.** Não está decidido se o fallback de 1 iteração vale para cada senha extra ou só para `password`. Recomendação: aplicar a todas, pois sessões antigas podem ter sido seladas com a senha antiga também antes da mudança de iterações. Confirmar antes da implementação.
- **Regressão silenciosa.** Erros em `unsealSession` são engolidos por `getSession`. Um bug na ordem de tentativas pode deslogar usuários sem erro visível. Mitigação: testes que cubram RF-03, RF-05 e RF-06 com senha correta, senha antiga e senha desconhecida.
