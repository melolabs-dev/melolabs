# PRD: várias senhas de unseal nas sessões

Status: rascunho
Referências: issue h3js/h3#1050 (primeira alternativa proposta na issue) e contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession`, `getSession` e `updateSession` (em `src/utils/session.ts`) usam uma única senha, `SessionConfig.password`, tanto para selar quanto para abrir a sessão. Ao trocar essa senha por rotação de segredo, todas as sessões seladas com a senha anterior passam a falhar no `unseal`, e `getSession` as trata como inexistentes. Os usuários são deslogados de uma vez, mesmo que a rotação não tenha qualquer motivo de segurança para invalidar sessões válidas.

### Objetivo

Permitir que o desenvolvedor informe senhas anteriores, apenas para abrir sessões, sem alterar a senha usada para selar. Assim, uma rotação de segredo não derruba as sessões existentes, e a senha antiga pode ser removida depois de um período de transição.

### Critérios de sucesso

- Trocar `password` e manter a senha antiga em `extraUnsealPasswords` não desloga nenhum usuário com sessão ativa.
- Depois que as sessões antigas forem resseladas ou expirarem, remover a senha antiga da configuração não altera o comportamento para nenhum cookie novo.
- Nenhuma mudança observável para quem não usa o campo novo (ver RF-04).

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado em JSDoc como senhas anteriores que só servem para abrir sessões. `password` continua sendo `string` e continua sendo a única senha usada para selar.

**Critério de aceite**

- Dado um `SessionConfig` com `password` e `extraUnsealPasswords: ["senha-antiga"]`,
- Quando o tipo é verificado pelo TypeScript (teste de tipo em `test/unit/types.test-d.ts` ou equivalente, conforme AGENTS.md),
- Então o código compila sem erros, `extraUnsealPasswords` aceita `string[]` e `password` continua aceitando apenas `string`.

### RF-02 — Abertura tenta a senha atual e depois as extras, em ordem

Ao abrir uma sessão, `unsealSession` tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem em que foram informados. A primeira senha que abre o selo é usada e as demais não são tentadas.

**Critério de aceite**

- Dado um cookie selado com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- Quando `getSession` lê a sessão nessa requisição,
- Então a sessão é carregada com os dados originais e `id` igual ao da sessão selada.

### RF-03 — Selagem sempre usa apenas `password`

`sealSession` e `updateSession` selam exclusivamente com `password`. Senhas em `extraUnsealPasswords` nunca são usadas para gerar um novo cookie.

**Critério de aceite**

- Dado uma sessão aberta com `"senha-antiga"` através de `extraUnsealPasswords`,
- Quando a requisição grava algum dado com `updateSession`, ou chama `sealSession` diretamente,
- Então o novo cookie abre com `password` e não abre com `"senha-antiga"`.

### RF-04 — Sem senhas extras, o comportamento não muda

Quando `extraUnsealPasswords` não é informado ou é um array vazio, o comportamento é idêntico ao atual, incluindo o fallback de selo legado (`legacySealFallback`) e os erros lançados para cookies inválidos.

**Critério de aceite**

- Dado uma configuração sem `extraUnsealPasswords` e um cookie selado com outra senha,
- Quando `getSession` lê a sessão,
- Então ela é tratada como nova, com a mesma saída de hoje, sem erro propagado.

### RF-05 — Fallback de selo legado vale para cada senha

O fallback de selo legado (1 iteração PBKDF2, descrito em `unsealSession`) é aplicado a cada senha candidata. Uma sessão selada com selo legado e com uma senha extra é aberta, marcada como `kLegacySeal` e resselada com `password` por `getSession`, como acontece hoje com a senha atual.

**Critério de aceite**

- Dado um cookie selado com selo legado e com `"senha-antiga"`, e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- Quando `getSession` lê a sessão,
- Então a sessão é carregada e um novo `Set-Cookie` é emitido, selado com `"senha-nova"`.

### RF-06 — Expiração continua valendo para qualquer senha

`maxAge` e `idleTimeout` são verificados da mesma forma, independentemente de a senha que abriu a sessão ser `password` ou uma extra. Uma sessão expirada não volta a ser válida por ter sido selada com uma senha antiga.

**Critério de aceite**

- Dado uma sessão selada com `"senha-antiga"` cujo `createdAt` ultrapassa `maxAge`,
- Quando `getSession` lê a sessão com `extraUnsealPasswords: ["senha-antiga"]`,
- Então a sessão é tratada como expirada e não é carregada.
- E, com a mesma sessão dentro de `maxAge` mas com `idleTimeout` vencido, ela também não é carregada.

### RF-07 — Reselagem após abertura com senha extra

Quando uma sessão é aberta com uma senha extra, `getSession` a reseila com `password` na mesma requisição, para que o cookie passe a depender só da senha atual. Esse é o comportamento que permite remover a senha antiga depois da transição. A reselagem acontece mesmo que a sessão não tenha sido alterada e mesmo que o `idleTimeout` ainda não exija slide.

Exceção: uma sessão lida do cabeçalho `x-h3-session` não é resselada, porque o cliente não recebe cookie nessa resposta. Ela continua válida com a senha antiga até expirar. RF-07 vale, portanto, só para sessões de cookie.

**Critério de aceite**

- Dado uma sessão aberta com `"senha-antiga"` através de `extraUnsealPasswords`, sem nenhuma escrita na requisição,
- Quando `getSession` termina a leitura nessa requisição,
- Então a resposta contém um `Set-Cookie` da sessão selado com `password`.

### RF-08 — Falha com todas as senhas

Se nenhuma das senhas (`password` mais as extras) abre o cookie, o resultado é o mesmo de uma senha errada hoje: a sessão é tratada como nova e nenhum erro sobe para o handler.

**Critério de aceite**

- Dado uma configuração com `password` e `extraUnsealPasswords: ["outra"]`, e um cookie selado com uma terceira senha,
- Quando `getSession` lê a sessão,
- Então ela é tratada como nova e nenhum erro é lançado.

### RF-09 — Cobertura de testes

Os testes de sessão cobrem: abertura com senha extra, ordem de tentativa (inclusive parada na primeira que abre), selagem só com `password`, reselagem após abertura extra, expiração com senha extra (`maxAge` e `idleTimeout`), falha com todas as senhas, a ausência de `extraUnsealPasswords`, senha extra igual a `password` e senha extra vazia ou duplicada.

**Critério de aceite**

- Dado a suíte de sessão atualizada,
- Quando `pnpm vitest run` roda sobre os arquivos de sessão existentes,
- Então todos os testes passam nos modos `web` e `node` do `describeMatrix`.

### RF-10 — Documentação

O JSDoc de `SessionConfig.extraUnsealPasswords` diz que as senhas são só para abrir, que a sessão é resselada com `password` ao ser aberta e que a senha antiga deve ser removida após a transição. O JSDoc de `password` passa a apontar para o novo campo. A documentação repete a regra de tamanho e entropia de `password` (ver premissas).

**Critério de aceite**

- Dado o código final,
- Quando alguém lê o JSDoc de `extraUnsealPasswords` sem outras referências,
- Então entende o prazo da transição e sabe que a senha extra nunca sela.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue).
- Selar com várias senhas ou escolher a senha de selagem por `kid` ou versão do cookie.
- Rotação automática de senhas, agendamento ou integração com gerenciadores de segredo.
- Revogação de sessões individuais ou invalidação em massa.
- Remover o fallback de selo legado ou `legacySealFallback` (isso fica para a v3, como já indicado no código).
- Alterar o formato do cookie, o nome do cookie, o cabeçalho de sessão ou o tratamento de cookies em partes.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Validação em tempo de execução que rejeite senhas curtas ou fracas (a regra fica na documentação).

## Decisões

- **Limite de senhas extras:** recomendado no máximo 2 na documentação. O código não impõe limite, para não criar um erro novo em configurações existentes. Revisar se houver uso real com mais de 2.
- **Senha vazia ou duplicada:** strings vazias em `extraUnsealPasswords` são ignoradas. Duplicatas e a repetição de `password` não têm efeito e não geram erro.
- **Sessões só de leitura:** RF-07 vale para toda sessão de cookie aberta com senha extra, inclusive as só de leitura. Isso substitui a regra anterior de "esperar o próximo slide", que contradizia RF-07 e tornaria o prazo da transição indefinido.
- **Sessões do cabeçalho `x-h3-session`:** aceitas e documentadas, sem validação nova. Não são resseladas (ver RF-07) e continuam dependendo da senha antiga até expirar. Como o prazo de expiração de uma sessão de cabeçalho só existe com `maxAge` ou `idleTimeout`, o prazo de remoção da senha antiga só é previsível para sessões de cookie. Exigir `maxAge`/`idleTimeout` quando `extraUnsealPasswords` estiver configurado seria validação em tempo de execução, que está fora de escopo.

## Premissas e riscos

### Premissas

- A senha antiga continua em uso apenas durante a transição. O desenvolvedor a remove da configuração depois que as sessões abertas por ela tiverem sido resseladas (RF-07) ou expirado. Como toda abertura com senha extra reseila o cookie, o prazo de remoção é previsível: o tempo máximo de vida da sessão mais a janela até a próxima leitura de cada usuário.
- As senhas extras seguem a mesma regra de `password`: mínimo de 32 caracteres e entropia alta. O código impõe o comprimento mínimo de 32 caracteres (`src/utils/internal/iron-crypto.ts:22` e `:28`, aplicado em `:191-196`), e uma senha mais curta falha ao abrir. O código não impõe entropia. O novo campo também não impõe essas regras em tempo de execução, mas a documentação deve repeti-las.
- O custo de `unseal` é aceitável para algumas tentativas por requisição, porque o PBKDF2 é executado uma vez por senha candidata.

### Riscos

- **Custo de CPU:** cada senha extra adiciona um PBKDF2 em toda leitura de cookie que não abre com a senha atual, inclusive cookies inválidos. Com muitas senhas extras, o custo cresce linearmente. Mitigação: limite recomendado de 2 (ver Decisões) e nota de custo na documentação.
- **Senha antiga vazada:** enquanto ela estiver na configuração, cookies selados com ela continuam válidos até expirar ou serem resselados. O campo não substitui uma revogação. Se a senha antiga foi exposta, a remoção imediata é o caminho, e as sessões ativas precisam ser invalidadas por outro meio.
- **Interação com `legacySealFallback`:** combinar o fallback de 1 iteração com várias senhas multiplica as tentativas. O teste de RF-05 precisa cobrir esse caso para não deixar uma regressão silenciosa.
- **Reselagem sob falha:** se a reselagem de RF-07 não puder ser emitida (por exemplo, erro ao gerar o cookie), a sessão já aberta ainda é lida nessa requisição, mas o próximo request depende de novo da senha antiga. A implementação deve registrar o caso em teste e não deve lançar erro para o handler, em linha com RF-08.
- **Documentação de `SessionConfig`:** o JSDoc de `password` diz que a chave é a única que sela. Essa frase continua correta, mas a documentação nova precisa deixar claro que a rotação tem prazo.

## Perguntas em aberto

- `sdd/pedido.md`: conferido. Os requisitos deste PRD batem com o contrato #1050-b: campo `extraUnsealPasswords` em `SessionConfig`, `password` continua `string`, sem nomes públicos novos, sem alterar o comportamento sem o campo.
- Uso do campo `password` fora de `src/utils/session.ts`: conferido. Em `src/` só `session.ts` usa `SessionConfig.password` para sessões. Os demais usos são de autenticação (`src/utils/auth.ts`, `src/utils/internal/iron-crypto.ts`, `src/types/context.ts`) e não mudam. Nos testes e na documentação, o uso de sessão está em `test/session.test.ts`, `test/bench/session.ts` e `docs/4.examples/handle-session.md`, que serão atualizados ou já são compatíveis (o campo é opcional).
