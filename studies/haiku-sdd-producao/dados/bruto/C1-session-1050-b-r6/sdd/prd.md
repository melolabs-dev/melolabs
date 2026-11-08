# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

Hoje `useSession` / `getSession` selam e deselam a sessão com uma única senha, `SessionConfig.password` (`src/utils/session.ts`). Ao trocar essa senha por motivo de rotação de segredos, todas as sessões já emitidas deixam de abrir e os usuários são desconectados.

Objetivo: permitir que o desenvolvedor informe senhas anteriores, que só são usadas para **abrir** sessões antigas, sem alterar a senha que **sela** as novas. Com isso a rotação pode ser feita sem derrubar sessões ativas. Esta é a primeira alternativa proposta na issue h3js/h3#1050, com a configuração feita por um campo novo.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores. O campo é documentado em JSDoc, no mesmo estilo dos demais campos da interface. `password` continua sendo `string`. Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** uma configuração com `password` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** o TypeScript compila o uso dessa configuração em `useSession`,
- **Então** a configuração é aceita sem erro de tipo, e uma configuração sem o campo continua válida.

### RF-02 — Selagem sempre com `password`

Toda selagem de sessão usa somente `password`. As senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** uma sessão é criada ou atualizada,
- **Então** o cookie selado abre com `"nova"` e não abre com `"antiga"`.

### RF-03 — Desselagem tenta as senhas em ordem

Ao ler um cookie, a desselagem tenta `password` primeiro e, em seguida, cada senha de `extraUnsealPasswords` na ordem declarada. A primeira tentativa que verifica o HMAC e decifra o conteúdo é a que vale. As tentativas seguintes não são feitas.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com esse cookie,
- **Então** `event.context.session` (ou o retorno de `getSession`) contém os dados da sessão original.

### RF-04 — Falha quando nenhuma senha abre o cookie

Se nenhuma senha (a principal ou as extras) abrir o cookie, o comportamento de erro é o mesmo de hoje: o erro produzido pela tentativa com `password` é propagado, e a sessão é tratada como inexistente (cookie substituído, como já acontece para sessões inválidas).

**Critério de aceite**
- **Dado** uma sessão selada com `"outra"`, e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão lida está vazia, sem `id`, e a função não lança exceção não tratada.

### RF-05 — Sem senhas extras, comportamento inalterado

Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento é idêntico ao atual, incluindo o fallback de iterações PBKDF2 legadas e a opção `legacySealFallback`.

**Critério de aceite**
- **Dado** a suíte de testes existente de sessões,
- **Quando** ela roda sem alterar as configurações dos testes,
- **Então** todos os testes passam, sem mudança de asserção.

### RF-06 — Compatibilidade com o fallback de iterações legadas

O fallback de iterações PBKDF2 legadas (`legacySealFallback`) vale para cada senha tentada. Uma sessão antiga selada com 1 iteração e com uma senha extra deve abrir.

**Critério de aceite**
- **Dado** uma sessão selada com 1 iteração PBKDF2 e a senha `"antiga"`, e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é aberta e marcada como selada no formato legado, como acontece hoje com `password` única.

### RF-07 — Migração gradual para a senha atual

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password`, de modo que o cookie migre para a senha atual na mesma resposta. Assim, depois do tempo de vida da sessão, as senhas antigas podem ser removidas da configuração sem efeito colateral.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"`, e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com esse cookie e a sessão é lida,
- **Então** a resposta traz um `Set-Cookie` novo, que abre com `"nova"`.

### RF-08 — Testes cobrindo os cenários

Os testes de sessão ganham casos para: senha extra que abre; senha principal que abre (sem tentar as extras); nenhuma senha que abre; ordem das extras; migração (RF-07); fallback legado (RF-06). Os testes seguem `describeMatrix`, rodando em `web` e `node`.

**Critério de aceite**
- **Dado** os novos casos de teste,
- **Quando** roda `pnpm vitest run test/session.test.ts` (ou o arquivo de sessões existente),
- **Então** todos passam nos dois alvos (`web` e `node`).

### RF-09 — Qualidade do código

`pnpm lint` e `pnpm typecheck` passam, sem `@ts-ignore` novo e sem alterar `iron-crypto.ts`.

**Critério de aceite**
- **Dado** a branch com a mudança,
- **Quando** roda `pnpm lint` e `pnpm typecheck`,
- **Então** ambos terminam sem erro.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050).
- Remover o fallback legado de iterações ou a opção `legacySealFallback` (isso fica para a v3).
- Política automática de expiração ou rotação de senhas; a remoção de senhas antigas é decisão manual do desenvolvedor.
- Alterar o formato do cookie, o header de sessão ou o `iron-crypto.ts`.
- Qualquer nome público novo além de `extraUnsealPasswords`.
- Documentação fora do JSDoc (site de docs, README), salvo se pedido depois.

## Premissas

- A mudança fica restrita a `src/utils/session.ts` e aos testes de sessão, conforme o contrato.
- A desselagem e a selagem já passam pela mesma `SessionConfig`, então o campo novo vale tanto para cookie quanto para o header de sessão.
- A migração (RF-07) se aplica a sessões que passam pelo caminho de reselagem de `getSession`. Sessões lidas pelo header não podem ser resseladas e continuam válidas até expirar, como já ocorre hoje; isso deve ser confirmado no desenho.
- Senhas extras vazias ou repetidas não exigem tratamento especial além de não quebrar a tentativa (a senha repetida apenas custa uma tentativa extra).

## Riscos

- **Custo de CPU sob ataque:** cada cookie inválido passa a custar até `1 + N` derivações PBKDF2 (N = número de senhas extras), e o fallback legado pode dobrar esse número. Um atacante pode forçar esse custo com cookies falsos. Mitigação a avaliar: limitar o tamanho da lista ou documentar o custo.
- **Vazamento por tempo:** a diferença de tempo entre tentar a senha principal e as extras pode indicar em qual posição a senha casou. O impacto é baixo, porque a tentativa exige o cookie já emitido, mas deve ser registrado.
- **Testes existentes:** a suíte depende de mensagens de erro como `"Bad hmac value"`. A propagação do erro (RF-04) precisa preservar essa mensagem para não quebrar asserções existentes.
- **Senha antiga esquecida:** se a lista de senhas extras nunca for limpa, a superfície de ataque cresce. Isso é decisão operacional e fica fora do código.
