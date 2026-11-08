# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` / `getSession` selam e abrem cada sessão com uma única senha (`SessionConfig.password`, em `src/utils/session.ts`). Ao rotacionar essa senha, todas as sessões já emitidas com a senha antiga deixam de abrir, e os usuários são desconectados à força.

**Objetivo:** permitir que `SessionConfig.password` receba uma lista não vazia de senhas. A primeira senha sela as sessões novas; as demais servem apenas para abrir sessões seladas antes da rotação. Assim a troca de senha pode acontecer sem derrubar as sessões ativas, conforme a segunda alternativa proposta na issue h3js/h3#1050.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

O campo `SessionConfig.password` passa a aceitar `string | string[]`. Uma lista é válida somente se tiver ao menos um item.

- **Dado** uma configuração de sessão com `password: ["senha-nova", "senha-antiga"]`
- **Quando** o código tipa e compila a configuração
- **Então** o tipo `SessionConfig` aceita a lista sem erro de TypeScript, e `password: "senha-unica"` continua aceito.

### RF-02 — Selar sempre com a primeira senha

Ao selar uma sessão, a primeira senha da lista é a única usada.

- **Dado** uma configuração com `password: ["senha-nova", "senha-antiga"]`
- **Quando** uma sessão é criada ou atualizada e selada
- **Então** o selo pode ser aberto apenas com `senha-nova` e não com `senha-antiga`.

### RF-03 — Abrir sessões com qualquer senha da lista

Ao abrir uma sessão, as senhas são tentadas na ordem da lista, e a primeira que validar o selo é usada.

- **Dado** uma sessão selada com `senha-antiga` e uma configuração `password: ["senha-nova", "senha-antiga"]`
- **Quando** a requisição chega com o cookie dessa sessão
- **Então** a sessão é lida corretamente, com os mesmos dados que tinha antes da rotação.

### RF-04 — Sessão inválida para todas as senhas continua falhando

Se nenhuma senha da lista abrir o selo, a sessão é tratada como inválida, da mesma forma que hoje com uma senha errada.

- **Dado** uma configuração `password: ["senha-nova", "senha-antiga"]` e uma sessão selada com `senha-removida`
- **Quando** a requisição chega com o cookie dessa sessão
- **Então** nenhuma sessão é retornada, e o comportamento é o mesmo de hoje para um selo inválido (sessão vazia / nova sessão, sem erro não tratado).

### RF-05 — Resselar com a senha atual ao renovar

Quando uma sessão aberta com uma senha antiga é resselada (por exemplo, pelo `idleTimeout` ou ao gravar dados), o novo selo usa a primeira senha da lista.

- **Dado** uma sessão selada com `senha-antiga` e uma configuração `password: ["senha-nova", "senha-antiga"]` com `idleTimeout` configurado
- **Quando** a sessão é lida e resselada na requisição
- **Então** o cookie devolvido abre com `senha-nova` e já não depende de `senha-antiga`.

### RF-06 — Compatibilidade com configuração de senha única

Com uma senha só, o comportamento é idêntico ao atual.

- **Dado** uma configuração com `password: "senha-unica"` e uma sessão selada antes desta mudança
- **Quando** a sessão é lida e atualizada
- **Então** os dados, o formato do cookie e o comportamento de expiração (`maxAge`, `idleTimeout`) não mudam, e a suíte existente em `test/session.test.ts` continua passando.

### RF-07 — Fallback legado funciona para cada senha

O fallback de selo legado (1 iteração PBKDF2, `legacySealFallback`) é aplicado a cada senha da lista, não só à primeira.

- **Dado** uma sessão selada com a senha antiga usando o selo legado de 1 iteração, e uma configuração com `password: ["senha-nova", "senha-antiga"]`
- **Quando** a sessão é lida
- **Então** ela é aberta pelo fallback legado com `senha-antiga` e resselada com `senha-nova`.

### RF-08 — Validação da lista

Uma lista vazia é rejeitada de forma explícita. Cada senha da lista passa pela mesma regra que uma senha única hoje.

- **Dado** uma configuração com `password: []`
- **Quando** a sessão é usada pela primeira vez
- **Então** um erro claro é lançado, indicando que é preciso ao menos uma senha.

### RF-09 — Nenhum nome público novo

A mudança não cria novas opções nem novas funções exportadas. Apenas o tipo de `password` é ampliado.

- **Dado** o conjunto de exports de `h3` antes e depois da mudança
- **Quando** o diff da API pública é revisado
- **Então** a única alteração é o tipo de `SessionConfig.password`.

### RF-10 — Testes cobrindo a rotação

Os testes cobrem: selar com a primeira senha, abrir com a segunda, falha quando nenhuma serve, resselagem com a senha atual, lista vazia e senha única sem mudança de comportamento. Os testes rodam nos modos `web` e `node` (`describeMatrix`).

- **Dado** a suíte de sessões em `test/session.test.ts`
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** todos os cenários acima passam nos dois modos, e `pnpm lint` e `pnpm typecheck` passam.

## Fora de escopo

- Nova opção `extraUnsealPasswords` (primeira alternativa da issue).
- Remoção do fallback de selo legado ou da opção `legacySealFallback` (isso fica para a v3, conforme o TODO em `session.ts`).
- Mudança no formato do selo, no algoritmo ou no número de iterações PBKDF2.
- Expiração automática ou agendada de senhas antigas, e qualquer ferramenta para descobrir quais sessões ainda usam uma senha antiga.
- Mudanças em cookies (chunking, atributos) ou no header de sessão além do que a resselagem já faz.
- Suporte a rotação em `getSession`/`useSession` com APIs novas; a mudança é só no tipo aceito por `password`.
- Documentação extensa fora do JSDoc de `SessionConfig.password`.

## Premissas e riscos

### Premissas

- A ordem da lista define a prioridade: a primeira senha sela e as demais só abrem. Quem configura precisa manter a senha nova na primeira posição.
- O mecanismo de resselagem atual (`getSession` ao renovar `idleTimeout` ou gravar dados) é suficiente para migrar as sessões ativas para a senha nova sem ação extra do usuário.
- Sessões que chegam pelo header de sessão (`sessionHeader`) não são resseladas, então continuam abertas pela senha antiga até expirar. Isso é aceitável e deve ser documentado.
- A regra de tamanho mínimo e a validação de entropia descritas no JSDoc de `password` se aplicam a cada item da lista. Ainda precisa ser confirmado se essa validação já existe no código ou é só documentação.

### Riscos

- **Custo de CPU:** cada tentativa de senha roda PBKDF2 (8192 iterações por padrão). Uma sessão inválida com uma lista longa multiplica esse custo, o que pode virar um vetor de DoS barato. Recomendação: manter a lista curta e documentar isso.
- **Senha antiga esquecida:** se a senha antiga nunca sair da lista, sessões antigas continuam válidas indefinidamente. Quem rotaciona precisa remover a senha antiga depois de um prazo, e isso não é automatizado.
- **Erro para o chamador:** hoje o erro de `unseal` depende da mensagem `"Bad hmac value"` para ativar o fallback legado. Com várias senhas, é preciso definir qual erro sobe quando nenhuma abre, para não quebrar esse fallback nem o tratamento atual de sessão inválida.
- **Comparação de senhas:** a tentativa sequencial pode revelar, por tempo de resposta, em qual posição da lista a senha casou. O risco é baixo, mas vale mencionar na documentação.
- **Regressão silenciosa:** um código que assume `config.password` como `string` (por exemplo, em outros pontos de `session.ts` ou em plugins) pode continuar compilando e falhar em tempo de execução. Recomendação: buscar todos os usos de `config.password` antes de implementar.
