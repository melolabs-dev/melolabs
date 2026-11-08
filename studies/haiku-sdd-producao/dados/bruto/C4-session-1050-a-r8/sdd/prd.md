# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta na issue), contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

Hoje `useSession` / `getSession` (`src/utils/session.ts`) aceitam uma única `password`. Ela sela e abre todas as sessões. Ao trocar essa senha, todas as sessões seladas com a senha anterior passam a ser inválidas, e os usuários são desconectados à força.

O objetivo é permitir a rotação de senhas sem derrubar sessões existentes: a senha nova sela as sessões, e as senhas antigas continuam aceitas só para abrir sessões já emitidas. A configuração fica no próprio campo `password`, sem nenhum nome público novo.

## Requisitos funcionais

### RF-01 — `password` aceita uma lista de senhas

`SessionConfig.password` passa a aceitar `string | string[]`. Quando for uma lista, a primeira senha sela e todas as demais são usadas apenas para abrir sessões.

**Critério de aceite**

- **Dado** uma configuração com `password: ["nova-senha-com-32-caracteres-ou-mais", "antiga-senha-com-32-caracteres-ou-mais"]`
- **Quando** uma sessão é criada e selada
- **Então** o selo é verificável com `"nova-senha-com-32-caracteres-ou-mais"` e a senha antiga não é usada para selar.

### RF-02 — Sessões seladas com qualquer senha da lista são aceitas

Ao ler uma sessão, o unseal tenta as senhas da lista na ordem em que foram declaradas e aceita a primeira que abrir o selo.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga, e a configuração `password: [senhaNova, senhaAntiga]`
- **Quando** a requisição envia o cookie dessa sessão
- **Então** `getSession` retorna a sessão com o `id` e os `data` originais.

### RF-03 — Senha desconhecida continua invalidando a sessão

Se nenhuma senha da lista abrir o selo, a sessão é tratada como inexistente, exatamente como acontece hoje com uma senha errada.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha que não está na lista
- **Quando** a requisição envia o cookie dessa sessão
- **Então** `getSession` retorna uma sessão nova (com `id` diferente do selo original) e nenhum dado da sessão antiga é exposto.

### RF-04 — Sessão aberta com senha antiga é resselada com a primeira senha

Quando uma sessão é aberta com uma senha que não é a primeira, o próximo selo emitido para ela usa a primeira senha. Assim, a rotação avança sozinha conforme os usuários fazem requisições.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga e a configuração `password: [senhaNova, senhaAntiga]`
- **Quando** o cookie dessa sessão é lido e a sessão é atualizada ou resselada (por exemplo, por `update` ou pelo deslizamento de `idleTimeout`)
- **Então** o `Set-Cookie` resultante abre com `senhaNova` e não com `senhaAntiga`.

### RF-05 — Compatibilidade com a senha única

Com uma senha só (`string`, ou lista de um item), o comportamento é o de hoje: mesmo selo, mesma leitura, mesmos erros, incluindo o fallback legado de 1 iteração PBKDF2.

**Critério de aceite**

- **Dado** uma sessão selada pela versão atual da biblioteca com `password` como `string`
- **Quando** a mesma configuração é usada após esta mudança
- **Então** a sessão é lida sem erro e o cookie emitido é idêntico ao que a versão atual emitiria.

### RF-06 — Fallback legado funciona para cada senha da lista

O fallback de unseal legado (`legacySealFallback`) deve ser aplicado a cada senha da lista, não só à primeira. Assim, uma sessão antiga selada com 1 iteração e com uma senha que não é a primeira continua sendo aberta.

**Critério de aceite**

- **Dado** uma sessão selada com 1 iteração PBKDF2 pela senha da segunda posição, e `legacySealFallback` não desativado
- **Quando** a sessão é lida com `password: [senhaNova, senhaAntiga]`
- **Então** a sessão é aberta e resselada com `senhaNova` com as opções atuais de seal.

### RF-07 — Lista inválida é rejeitada com erro claro

Uma lista vazia, ou com itens que não são strings não vazias, deve falhar cedo com erro explícito, e não silenciosamente.

**Critério de aceite**

- **Dado** uma configuração com `password: []`
- **Quando** `useSession`, `getSession` ou `updateSession` é chamado com essa configuração
- **Então** a chamada lança um erro que indica que a lista de senhas está vazia.

### RF-08 — Expiração não depende da senha usada

`maxAge` e `idleTimeout` são aplicados da mesma forma, independentemente de a sessão ter sido aberta pela primeira senha ou por uma antiga.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga cujo `createdAt` ultrapassa `maxAge`
- **Quando** a requisição envia o cookie dessa sessão
- **Então** a sessão é tratada como expirada, da mesma forma que uma sessão selada com a senha atual.

### RF-09 — Vale para cookie e para o header de sessão

As regras de RF-01 a RF-06 valem tanto para a sessão lida do cookie quanto para a lida do header `sessionHeader`.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga enviada no header `x-h3-session`, e `password: [senhaNova, senhaAntiga]`
- **Quando** `getSession` é chamado
- **Então** a sessão é aberta e retorna os `data` originais.

### RF-10 — Tipos e documentação

O tipo de `SessionConfig.password` e o JSDoc do campo descrevem a lista, a ordem de uso e a exigência de entropia de cada senha. Nenhum nome público novo é exportado.

**Critério de aceite**

- **Dado** o código-fonte após a mudança
- **Quando** `pnpm typecheck` e `pnpm lint` são executados
- **Então** ambos passam, e o JSDoc de `password` menciona que a primeira senha sela e as demais só abrem.

## Fora de escopo

- Uma opção nova como `extraUnsealPasswords` (a primeira alternativa da issue).
- Identificadores nomeados de senha (`{ id: secret }`) na API de sessão. O iron já suporta isso internamente, mas não é exposto aqui.
- Ferramenta, comando ou job para rotacionar senhas ou reselar sessões em massa.
- Remoção do fallback legado de 1 iteração (fica para a v3, conforme o TODO existente).
- Mudança no algoritmo, nas iterações padrão ou nas opções de `seal`.
- Alterações em `basicAuth`, `requireBasicAuth` ou em outros usos de senha fora de sessões.
- Invalidação explícita de sessões antigas (uma sessão some quando a senha antiga é removida da lista).
- Novos testes de runtime além dos necessários para cobrir RF-01 a RF-10 nas suítes `describeMatrix` existentes.

## Premissas

- A ordem da lista é a semântica: o primeiro item sela, os demais só abrem. Não há outra forma de marcar uma senha como "só leitura".
- Cada senha da lista segue a mesma regra de entropia da senha única, de pelo menos 32 caracteres aleatórios, conforme o JSDoc atual de `password`.
- Sessões lidas pelo header `sessionHeader` não são resseladas (já é o comportamento atual). Elas continuam abertas pela senha antiga até expirarem, e o cliente só recebe um selo novo quando uma resposta emite `Set-Cookie`.
- Sessões aceitas com senha antiga só migram para a senha nova quando são resseladas. Sessões que nunca mais são lidas continuam com a senha antiga até expirar ou até a senha antiga sair da lista.
- O comportamento para sessões seladas com a senha atual não muda.

## Riscos

- **Ordem trocada**: se alguém puser a senha antiga na primeira posição, todas as sessões novas passam a ser seladas com ela. A documentação e os testes precisam deixar isso claro.
- **Custo de CPU**: cada senha testada custa uma derivação PBKDF2 completa. Com N senhas, uma requisição com cookie inválido ou de senha desconhecida custa N derivações, e o fallback legado pode dobrar esse custo por senha. Isso amplifica o custo de requisições com cookies forjados, então a lista deve ser curta (por exemplo, até 2 ou 3 senhas).
- **Remoção prematura de senha**: remover uma senha da lista invalida sem aviso todas as sessões seladas com ela. A documentação deve dizer isso.
- **Lista de senhas em log**: se a configuração for logada ou serializada, todas as senhas vazam juntas. Isso já vale para a senha única e não piora, mas vale reforçar.
- **Regressão em sessões existentes**: a mudança toca o caminho de unseal, que é crítico. RF-05 e RF-06 precisam de testes que usem selos gerados pela versão atual, não só selos gerados pelo novo código.
