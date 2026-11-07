# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession`/`getSession` aceitam uma única `password` em `SessionConfig` (`src/utils/session.ts`). Ela sela e abre todas as sessões. Ao trocar essa senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários são desconectados.

O objetivo é permitir a rotação de senha sem derrubar sessões: o desenvolvedor informa senhas anteriores em um campo novo, que só são usadas para abrir sessões existentes. A senha atual continua sendo a única usada para selar. Isso segue a primeira alternativa proposta na issue h3js/h3#1050.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com a documentação dizendo que essas senhas só abrem sessões. `password` continua sendo `string` e continua sendo a única usada em `seal`.

**Critério de aceite**

- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** uma sessão é selada pelo `useSession` ou `updateSession`
- **Então** o cookie é selado com `"nova"` e nunca com `"antiga"`.

### RF-02 — Abertura tenta a senha atual e depois as extras, em ordem

Ao ler uma sessão (cookie ou header de sessão), `unsealSession` tenta `password` primeiro e, se falhar, cada senha de `extraUnsealPasswords` na ordem declarada. A primeira que validar a integridade do selo é usada.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** a requisição chega com esse cookie
- **Então** `getSession` devolve a sessão original, com o mesmo `id`, `createdAt` e `data`.

### RF-03 — Sem senhas extras, o comportamento não muda

Quando `extraUnsealPasswords` está ausente ou é um array vazio, o resultado de todas as operações de sessão é o mesmo de hoje.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** a suíte existente de sessões (`test/session.test.ts` e demais testes relacionados) é executada
- **Então** todos os testes passam sem alteração de comportamento.

### RF-04 — Senha que não corresponde a nenhuma sessão continua inválida

Se nenhuma das senhas (atual ou extra) abre o selo, o comportamento é o atual: a sessão é tratada como inexistente e uma nova é criada, sem erro para o cliente.

**Critério de aceite**

- **Dado** uma sessão selada com `"desconhecida"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** a requisição chega com esse cookie
- **Então** `getSession` devolve uma sessão nova, com `id` diferente do cookie, e nenhuma exceção é lançada.

### RF-05 — Expiração vale igual para sessões abertas por senha extra

`maxAge` e `idleTimeout` são verificados da mesma forma, independentemente da senha que abriu o selo. Uma sessão expirada não é reativada por ter sido selada com uma senha extra.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"`, com `createdAt` mais antigo que `maxAge`
- **Quando** a requisição chega com esse cookie e a configuração tem `extraUnsealPasswords: ["antiga"]`
- **Então** a sessão é tratada como expirada e uma nova é criada.

### RF-06 — Fallback de selo legado vale para cada senha

O fallback de 1 iteração PBKDF2 (`legacySealFallback`) é tentado para cada senha, na mesma ordem de RF-02. Com `legacySealFallback: false`, o fallback não é usado para nenhuma delas.

**Critério de aceite**

- **Dado** uma sessão selada com a senha extra `"antiga"` e com o selo legado de 1 iteração
- **Quando** a requisição chega com `legacySealFallback` em seu valor padrão
- **Então** a sessão é aberta e, como hoje, resselada com `password` por causa do selo legado.
- **E** **Dado** o mesmo cenário com `legacySealFallback: false`
- **Quando** a requisição chega
- **Então** a sessão é tratada como inválida, como hoje.

### RF-07 — Senhas extras valem para cookie e para header de sessão

A abertura por senha extra é aplicada nos dois caminhos de leitura que já existem: o cookie (incluindo cookies em chunks) e o header `x-{name}-session`.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` enviada no header `x-{name}-session` (com o nome padrão `h3`, `x-h3-session`)
- **Quando** a configuração tem `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Então** `getSession` devolve a sessão original.

## Fora de escopo

- **Resselar automaticamente sessões abertas por senha extra com a senha atual.** Nesta versão, a sessão só é aberta. A migração acontece quando o desenvolvedor grava na sessão, como já acontece hoje. Com `idleTimeout` ativo, a leitura também pode resselar a sessão (quando a janela ociosa passou da metade), porque o deslizamento da janela regrava o cookie com `password` (techspec, D-06). Sem `idleTimeout`, a migração continua só na escrita.
- **Nova API pública.** Nenhum outro nome público novo é criado. Não entram funções como `rotatePassword()` ou um tipo `SessionPasswords`.
- **Múltiplas senhas para selar.** Só `password` sela. Não há lista de senhas de selo nem prioridade entre elas.
- **Mudança no formato do selo ou em `seal`/iron.** O formato dos cookies e os parâmetros de `SealOptions` não mudam.
- **Remoção do fallback legado.** `legacySealFallback` continua como está e segue marcado como deprecated para v3.
- **Invalidação explícita de sessões antigas** (lista de revogação, contador de versão). Sessões antigas expiram por `maxAge`/`idleTimeout` ou quando o desenvolvedor remove a senha da lista.
- **Mudanças em `useSession`/`getSession` além do que a leitura precisa.** A API de `SessionManager` não muda.

## Restrições

- `pnpm lint` e `pnpm typecheck` passam.
- A suíte existente continua passando. Testes existentes só são ajustados se dependerem de algo que a mudança altera, sem perder o que verificam.
- Os testes novos seguem o padrão `describeMatrix` (web e node), conforme `AGENTS.md`.
- O caminho de bug fix do `AGENTS.md` (teste de regressão antes da correção) vale aqui como prática: o teste de RF-02 deve falhar antes da mudança.

## Premissas

- **P1.** A validação de tamanho mínimo (32 caracteres, documentada em `password`) se aplica também a cada item de `extraUnsealPasswords`. Isso precisa ser confirmado no código de `iron-crypto.ts` antes da implementação.
- **P2.** `unseal` falha com erro quando o HMAC não confere (o fallback legado já depende disso, em `unsealSession`). É esse erro que faz a tentativa passar para a próxima senha.
- **P3.** A ordem das senhas é a ordem do array, com `password` sempre primeiro. Se a mesma senha aparecer em `password` e em `extraUnsealPasswords`, a repetição é inofensiva e não exige validação extra.
- **P4.** Várias tentativas de abertura são aceitáveis. O PBKDF2 roda uma vez por senha tentada, então uma sessão aberta pela última senha da lista leva mais tempo para ser lida. A lista deve ser curta (poucas senhas em rotação), e isso fica na documentação.
- **P5.** O campo é opcional e não muda o tipo de `password`, então código existente continua compilando.

## Riscos

- **R1. Senhas antigas ficam ativas por tempo indeterminado.** Como a sessão não é resselada automaticamente (ver Fora de escopo), a senha antiga precisa continuar na configuração até que as sessões seladas com ela expirem ou sejam regravadas. Mitigação: documentar isso e sugerir remover a senha depois de `maxAge` (ou `idleTimeout`) a partir da troca.
- **R2. Custo de CPU com listas longas.** Cada senha extra adiciona uma tentativa de PBKDF2 para cada requisição com sessão antiga. Requisições sem cookie não são afetadas. Mitigação: documentação e, se necessário, um limite de tamanho da lista em validação (fora desta versão).
- **R3. Senha antiga vazada.** Quem tiver a senha antiga ainda consegue abrir sessões até ela sair da lista. Mitigação: a documentação deve tratar a remoção da senha antiga como parte da rotação.
- **R4. Regressão no caminho de erro.** Mudar a ordem de `try/catch` em `unsealSession` pode alterar o caso de senha desconhecida ou o fallback legado. Mitigação: RF-04 e RF-06 cobrem esses casos explicitamente, e a suíte existente deve passar sem mudança (RF-03).
