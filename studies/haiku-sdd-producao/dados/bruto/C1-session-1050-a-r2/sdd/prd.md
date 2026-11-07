# PRD — Várias senhas de unseal nas sessões

Referência: h3js/h3#1050 (segunda alternativa proposta na issue), contrato enxuto #1050-a em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession`/`getSession` (`src/utils/session.ts`) aceitam uma única `password` em `SessionConfig`. Ela sela e abre todas as sessões. Quem gira a senha para cumprir uma política de rotação de segredos invalida, de uma vez, todas as sessões já emitidas: cada usuário logado é deslogado, mesmo sem qualquer motivo de segurança para isso.

### Objetivo

Permitir a rotação de senhas sem deslogar ninguém. A mudança deve:

- aceitar, no próprio campo `password`, uma lista de senhas;
- selar novas sessões somente com a primeira senha da lista;
- abrir sessões seladas com qualquer senha da lista;
- manter exatamente o comportamento atual quando há uma senha só.

## Requisitos funcionais

### RF-01 — `password` aceita uma lista de senhas

`SessionConfig.password` passa a aceitar `string | string[]`. Uma lista precisa ter ao menos um item. A primeira senha é a de selagem; as demais servem apenas para abrir sessões. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** uma configuração com `password: ["senhaNova...", "senhaAntiga..."]`
- **Quando** uma sessão é criada com `useSession` e depois gravada com `update`
- **Então** o cookie selado é aberto com `senhaNova...` (a primeira) e não com `senhaAntiga...`.

### RF-02 — Abertura com qualquer senha da lista

Ao abrir uma sessão (cookie ou header `x-{name}-session`), o sistema tenta as senhas da lista na ordem em que foram declaradas e aceita a primeira que validar a integridade do token.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga...` antes da rotação
- **Quando** a requisição chega com essa sessão e a configuração passa a ser `password: ["senhaNova...", "senhaAntiga..."]`
- **Então** `getSession` devolve a mesma `id` e os mesmos `data` da sessão original.

### RF-03 — Senha fora da lista continua rejeitada

Um token selado com uma senha que não consta na lista não pode ser aberto. O comportamento é o mesmo de hoje para uma senha errada: a sessão é tratada como inexistente.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaDesconhecida...`
- **Quando** a requisição chega com essa sessão e a configuração é `password: ["senhaNova...", "senhaAntiga..."]`
- **Então** `getSession` devolve uma sessão nova, sem `id` herdado, e nenhum dado da sessão original é exposto.

### RF-04 — Senha única preserva o comportamento atual

Quando `password` é uma string, ou uma lista com um único item, o formato do token selado, o cookie emitido e a resposta a qualquer requisição são idênticos aos da versão atual.

**Critério de aceite**

- **Dado** uma configuração com `password: "senhaUnica..."` e uma sessão selada pela versão atual do h3
- **Quando** a sessão é lida com a nova versão
- **Então** ela é aberta normalmente e, ao ser gravada, o token resultante é idêntico ao que a versão atual produziria.

### RF-05 — Lista vazia é erro de configuração

Uma lista vazia não tem senha de selagem e não pode ser aceita. O erro deve deixar claro o problema, em vez de falhar de forma obscura no meio da selagem ou da abertura.

**Critério de aceite**

- **Dado** uma configuração com `password: []`
- **Quando** `useSession` ou `getSession` é chamado com ela
- **Então** a chamada lança um erro que indica que a lista de senhas está vazia.

### RF-06 — Sessões antigas migram ao serem regravadas

Uma sessão aberta com uma senha secundária continua válida até expirar. Quando for regravada (por `update`, `clear` ou pela renovação por `idleTimeout`), o novo cookie é selado com a primeira senha da lista.

**Critério de aceite**

- **Dado** uma sessão aberta com `senhaAntiga...` numa configuração `password: ["senhaNova...", "senhaAntiga..."]`
- **Quando** o handler chama `update({ ... })` nessa sessão
- **Então** o `Set-Cookie` emitido abre com `senhaNova...` e não abre com `senhaAntiga...`.

### RF-07 — Expiração e fallback legado valem para cada senha

`maxAge` e `idleTimeout` continuam sendo aplicados do mesmo jeito, independentemente de qual senha abriu a sessão. O fallback de selos legados (PBKDF2 com 1 iteração, `legacySealFallback`) também é tentado para cada senha da lista, respeitando a opção existente.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga...` há mais tempo que `maxAge`
- **Quando** a requisição chega com essa sessão e a lista contém `senhaAntiga...`
- **Então** a sessão é tratada como expirada, da mesma forma que hoje.

- **Dado** um selo legado (1 iteração) feito com `senhaAntiga...` e `legacySealFallback` ligado (padrão)
- **Quando** a requisição chega e a lista é `["senhaNova...", "senhaAntiga..."]`
- **Então** a sessão é aberta e regravada com a primeira senha, como hoje ocorre com uma senha única.

## Fora de escopo

- Rotação ativa: reselar sessões antigas em lote, ou forçar o logout de quem usa senha antiga. A migração acontece apenas quando a sessão é regravada (RF-06).
- Formato de chave por identificador (o `{ id: senha }` que o `iron` aceita nativamente). Não será exposto como API pública.
- Novos nomes públicos, como `extraUnsealPasswords`. A primeira alternativa da issue não é implementada.
- Alterações em `cookie`, `auth`, `session header` além do que for necessário para ler a lista de senhas.
- Remoção do fallback legado (`legacySealFallback`), que continua previsto para a v3.
- Benchmarks de desempenho novos. Só se mede o impacto se houver regressão evidente na suíte existente.

## Premissas

- **Formato do token.** Selar com uma string hoje grava o identificador de senha vazio no token (o campo id fica entre `**`), não `default`; `default` só é usado na busca em mapa de senhas do iron. Com a lista, a primeira senha é usada como string simples, então o token gerado continua idêntico ao atual (RF-04).
- **Ordem de tentativas.** A primeira senha é tentada primeiro. Sessões novas, que são o caso comum, abrem sem custo extra.
- **Regras por senha.** Cada item da lista segue as mesmas restrições de hoje para `password`, em especial o mínimo de 32 caracteres citado na documentação de `SessionConfig`.
- **Testes existentes.** A suíte em `test/session.test.ts` acessa `sessionConfig.password` diretamente em várias chamadas a `seal`/`unseal`. Com o novo tipo, esses pontos precisam de ajuste pontual para continuar usando uma string, sem perder o que verificam. Isso está previsto no contrato.
- **Compatibilidade de tipos.** O campo continua sendo um único campo, então quem só lê a configuração já existente não precisa mudar código. Quem lê `config.password` como string precisa tratar a união.

## Riscos

- **Custo de CPU por tentativa.** Cada senha tentada sem sucesso deriva uma chave PBKDF2 (8192 iterações por padrão). Uma requisição com cookie inválido custa até N derivações, e até 2N com o fallback legado. Isso amplia o custo de requisições maliciosas proporcionalmente ao tamanho da lista. Mitigação: documentar o custo e recomendar listas curtas; medir o impacto antes de fechar.
- **Senhas antigas que nunca saem.** Manter uma senha antiga na lista mantém válidas todas as sessões que ela selou, até expirarem. Quem usa a lista precisa remover a senha antiga quando o prazo de expiração das sessões tiver passado. Isso deve constar na documentação.
- **Tipo da configuração.** A união `string | string[]` pode quebrar código de terceiros que assume uma string em `config.password`. Mitigação: normalizar internamente e documentar a mudança.
- **Ambiguidade de senha repetida.** Uma lista com a mesma senha duas vezes não tem efeito funcional, mas pode indicar erro de configuração. A decisão de rejeitar ou apenas ignorar a duplicata fica em aberto.
- **Ordem errada na lista.** Se a senha nova for colocada depois da antiga, as sessões continuam sendo seladas com a antiga. Não há como detectar isso em tempo de execução sem regras adicionais; vale documentar com destaque.
