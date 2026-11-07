# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`, usada tanto para selar quanto para abrir a sessão. Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de abrir e os usuários perdem a sessão de uma vez. A issue h3js/h3#1050 pede uma forma de continuar honrando sessões antigas durante a rotação.

### Objetivo
Permitir que `SessionConfig.password` seja `string | string[]` (lista não vazia), seguindo a segunda alternativa da issue:
- Na lista, a **primeira** senha sela (novas sessões e resela).
- As **demais** só abrem sessões já existentes.
- Uma `string` continua com o comportamento atual.

A rotação passa a ser configurada somente no campo `password`, sem criar nenhum nome público novo.

### Métricas de sucesso
- Uma sessão selada com uma senha antiga, ainda presente na lista, continua válida após a rotação.
- Nenhum teste existente perde cobertura. `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia
`SessionConfig.password` passa a ter o tipo `string | string[]`. Nenhum outro nome público é adicionado.

**Critério de aceite**
- **Dado** uma configuração de sessão com `password` como `string` ou como `string[]` com ao menos um item,
- **Quando** o código é verificado pelo TypeScript (`pnpm typecheck`),
- **Então** as duas formas compilam sem erro, e nenhum export novo aparece em `src/index.ts`.

### RF-02 — A primeira senha da lista sela
Ao criar, atualizar ou reselar uma sessão, usa-se apenas a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: ["nova-senha-...", "antiga-senha-..."]`,
- **Quando** uma sessão é criada ou atualizada e o cookie selado é gerado,
- **Então** o cookie abre com `nova-senha-...` sozinha e não abre com `antiga-senha-...` sozinha.

### RF-03 — Todas as senhas da lista abrem sessões
Ao ler uma sessão, tentam-se as senhas na ordem da lista até uma delas abrir o cookie.

**Critério de aceite**
- **Dado** uma sessão selada com `antiga-senha-...` e a configuração `password: ["nova-senha-...", "antiga-senha-..."]`,
- **Quando** uma requisição chega com esse cookie (ou cabeçalho de sessão),
- **Então** os dados da sessão são recuperados com o mesmo `id` e os mesmos `data`.

### RF-04 — Sessões abertas com senha antiga são reseladas com a primeira
Uma sessão aberta com uma senha que não é a primeira deve ser regravada com a primeira, para que a senha antiga possa ser aposentada depois.

**Critério de aceite**
- **Dado** uma sessão selada com `antiga-senha-...` e `password: ["nova-senha-...", "antiga-senha-..."]`,
- **Quando** a sessão é lida em uma requisição e a resposta é gerada,
- **Então** a resposta traz um novo cookie que abre com `nova-senha-...` e preserva `id` e `data`.

### RF-05 — Senha fora da lista invalida a sessão
Cookies selados com uma senha que não consta na configuração são tratados como hoje: sessão inválida, substituída por uma nova.

**Critério de aceite**
- **Dado** uma sessão selada com `senha-removida-...` que não está em `password`,
- **Quando** a requisição chega com esse cookie,
- **Então** é criada uma sessão nova, com `id` diferente, e nenhum erro é lançado para o cliente.

### RF-06 — Uma só senha mantém o comportamento atual
Com `password` como `string`, ou como lista de um item, nada muda, incluindo o fallback para o selo legado de 1 iteração PBKDF2, `maxAge`, `idleTimeout` e `seal`.

**Critério de aceite**
- **Dado** a suíte de testes de sessão existente, com `password` como `string`,
- **Quando** `pnpm vitest run` roda os testes de sessão,
- **Então** todos passam sem perda do que verificam, e um cookie selado com uma `string` abre igualmente com uma lista de um item.

### RF-07 — O selo legado vale para cada senha da lista
O fallback legado (1 iteração) é tentado para cada senha da lista, respeitando `legacySealFallback` (a opção deprecated que o desliga).

**Critério de aceite**
- **Dado** uma sessão selada com 1 iteração PBKDF2 e a senha antiga na lista, em segunda posição,
- **Quando** a sessão é lida,
- **Então** ela é aceita e reselada com a primeira senha e as opções atuais. Com a opção que desliga o fallback ativada, ela é rejeitada.

### RF-08 — Lista vazia ou senha curta é rejeitada
A lista vazia é inválida, e cada senha da lista segue a regra atual de mínimo de 32 caracteres.

**Critério de aceite**
- **Dado** `password: []` ou uma lista com um item de menos de 32 caracteres,
- **Quando** a sessão é selada ou aberta,
- **Então** o h3 lança um erro claro, com o mesmo tipo de falha que hoje ocorre para uma senha curta.

### RF-09 — Utilitários de sessão aceitam a nova forma
Todas as funções que recebem `SessionConfig` (`getSession`, `useSession`, `updateSession`, `clearSession`, `sealSession`, `unsealSession`) funcionam com `string[]`.

**Critério de aceite**
- **Dado** cada uma dessas funções chamada com `password` em lista,
- **Quando** os testes automatizados as executam,
- **Então** cada uma se comporta como com `string`, selando com a primeira senha e abrindo com qualquer uma.

### RF-10 — Testes e documentação
Testes de regressão cobrem rotação, reselagem, senha removida, lista vazia e legado. A documentação do campo `password` (JSDoc e docs do repositório que o citem) descreve a nova forma.

**Critério de aceite**
- **Dado** o repositório após a mudança,
- **Quando** `pnpm lint`, `pnpm typecheck` e `pnpm vitest run test/session.test.ts` rodam,
- **Então** todos passam, e os novos testes falham se a mudança de código for revertida.

## 3. Fora de escopo
- Qualquer outro nome público novo, como o `extraUnsealPasswords` da primeira alternativa da issue.
- Mudanças no formato do cookie, nos algoritmos de seal ou nos padrões de `iron-crypto`.
- Rotação automática ou gerenciamento de segredos (cofres, expiração de senhas).
- Remoção do fallback legado de 1 iteração (planejada para v3).
- Mudanças em `requireBasicAuth` ou em outros utilitários que não usam sessões.

## 4. Premissas e riscos

### Premissas
- Uma lista de um item equivale à `string` correspondente.
- A ordem da lista é significativa: primeira para selar, as demais só para abrir.
- Quem rotaciona remove a senha antiga da lista depois que as sessões antigas expiram ou foram reseladas.
- A regra de 32 caracteres mínimos, hoje documentada em `SessionConfig.password`, vale para cada senha. Onde ela é aplicada no código deve ser confirmado na implementação.

### Riscos
- **Custo de CPU:** o unseal usa PBKDF2, e tentar N senhas, mais o fallback legado por senha, multiplica o custo. *Mitigação:* tentar na ordem, parar na primeira que abrir, e recomendar listas curtas.
- **Erros mascarados:** distinguir "senha errada" de "cookie expirado ou corrompido" ao tentar várias senhas. Só falhas de senha/integridade devem levar à próxima tentativa. Falhas de expiração (`maxAge`, `idleTimeout`) valem para a sessão inteira. *Mitigação:* testes de expiração com senha antiga.
- **Reselagem:** reselar sessões com senha antiga adiciona escrita de cookie em leituras. *Mitigação:* reaproveitar o caminho de reselagem do selo legado.
- **Quebra de tipos:** quem lê `config.password` como `string` (código próprio ou plugins) passa a ter erro de tipo. *Mitigação:* o tipo alargado é aditivo para quem configura, e deve ser citado nas notas de versão.
- **Segurança:** a senha antiga esquecida na lista mantém sessões antigas válidas. *Mitigação:* documentar o procedimento de rotação.
