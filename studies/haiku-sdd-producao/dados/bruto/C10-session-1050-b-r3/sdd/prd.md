# PRD: múltiplas senhas de unseal nas sessões

Referência: h3js/h3#1050 (primeira alternativa proposta na issue), contrato enxuto #1050-b.

## Problema e objetivo

Hoje `SessionConfig.password` é a única senha usada por `useSession`, `getSession` e `updateSession` para abrir (unseal) e selar as sessões. Quando o desenvolvedor troca essa senha para girar o segredo, todas as sessões seladas com a senha anterior deixam de abrir. Em `getSession`, o erro de unseal é engolido e o visitante recebe uma sessão nova, ou seja, é deslogado sem aviso.

**Objetivo:** permitir que o desenvolvedor informe senhas anteriores que servem apenas para abrir sessões. Com isso, girar `password` não derruba sessões válidas. Quem não usa o campo novo deve continuar tendo exatamente o comportamento atual, e o formato do token selado não muda.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com TSDoc no mesmo estilo dos outros campos. `password` continua `string`.

**Critério de aceite**
- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: ["<senha antiga com 32 ou mais caracteres>"]`
- **Quando** `pnpm typecheck` é executado
- **Então** a configuração compila sem erro.
- **Dado** um `SessionConfig` sem o campo `extraUnsealPasswords`
- **Quando** `pnpm typecheck` é executado
- **Então** a configuração continua compilando sem alteração.
- **Dado** um `SessionConfig` com `extraUnsealPasswords: "uma-string"`
- **Quando** `pnpm typecheck` é executado
- **Então** o compilador acusa erro de tipo.

### RF-02 — Selagem sempre com `password`

As senhas extras nunca são usadas para selar. Toda sessão nova ou reselada é selada com `password`.

**Critério de aceite**
- **Dado** uma configuração com `password: P` e `extraUnsealPasswords: [A]`
- **Quando** `useSession` cria uma sessão e emite o cookie
- **Então** o valor do cookie abre com `unseal(valor, P)` e falha com `unseal(valor, A)` (erro `Bad hmac value`).

### RF-03 — Ordem de tentativa das senhas

Ao abrir uma sessão, as senhas são tentadas nesta ordem: `password` e depois cada item de `extraUnsealPasswords`, na ordem do array. A primeira que verifica o HMAC é usada. Se nenhuma verificar, vale o erro atual (sessão tratada como ausente).

**Critério de aceite**
- **Dado** uma configuração com `password: P` e `extraUnsealPasswords: [A, B]`, e um cookie selado com `B`
- **Quando** `getSession` lê esse cookie
- **Então** a sessão é carregada com os mesmos `id`, `createdAt` e `data` do cookie original.
- **Dado** o mesmo config e um cookie selado com `P`
- **Quando** `getSession` lê esse cookie
- **Então** a sessão é carregada com os mesmos dados, e o resultado é igual ao de hoje.
- **Dado** o mesmo config e um cookie selado com uma chave `C` que não está na configuração
- **Quando** `getSession` lê esse cookie
- **Então** a sessão é tratada como ausente (nova, sem dados), como hoje com uma senha errada.

### RF-04 — Cobertura de todos os caminhos de leitura

A busca em senhas extras vale para qualquer leitura de sessão: cookie e header de sessão (`sessionHeader`), e as funções `getSession`, `useSession` e `updateSession`.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra `A` e enviada no header `x-h3-session`
- **Quando** `getSession` lê o header
- **Então** a sessão é carregada com os dados originais.
- **Dado** uma sessão selada com `A` e enviada no cookie
- **Quando** `updateSession` grava novos dados com essa requisição
- **Então** os dados antigos e os novos estão presentes na sessão resultante, e o cookie emitido abre com `P`.

### RF-05 — Sem senhas extras, comportamento inalterado

Quando `extraUnsealPasswords` é omitido ou é `[]`, nenhuma tentativa adicional é feita e o token continua no mesmo formato.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords`, ou com `extraUnsealPasswords: []`
- **Quando** a suíte `test/session.test.ts` é executada sem alteração nas expectativas
- **Então** todos os testes passam.
- **Dado** um cookie selado por essa configuração
- **Quando** o valor é dividido por `*`
- **Então** há 8 partes, a primeira é `Fe26.2`, e a parte do identificador de senha é vazia, como hoje.

### RF-06 — Fallback legado vale para cada senha

O fallback de sessões seladas com 1 iteração PBKDF2 (`legacySealFallback`) é aplicado a cada senha da lista, na mesma ordem de RF-03. Sessões legadas abertas dessa forma são resseladas (ver RF-07).

**Critério de aceite**
- **Dado** uma sessão selada com 1 iteração PBKDF2 usando a senha extra `A`, e `legacySealFallback` sem valor (padrão)
- **Quando** `getSession` lê essa sessão pelo cookie
- **Então** a sessão é carregada com os dados originais e um novo cookie é emitido, selado com `P`.
- **Dado** a mesma sessão legada e `legacySealFallback: false`
- **Quando** `getSession` lê essa sessão
- **Então** a sessão é tratada como ausente, como hoje com `legacySealFallback: false`.

### RF-07 — Migração para a senha atual

Quando uma sessão lida pelo cookie é aberta por uma senha extra (não por `password`), ela é resselada com `password` na mesma requisição. Sessões lidas pelo header não podem ser resseladas e são mantidas como estão.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra `A`, vinda do cookie, e uma configuração sem `idleTimeout`
- **Quando** `getSession` lê a sessão
- **Então** a resposta contém um `Set-Cookie` com o novo valor, e esse valor abre com `P` e falha com `A`.
- **Dado** a mesma sessão, agora com o cookie resselado e a configuração sem `extraUnsealPasswords`
- **Quando** `getSession` lê a sessão
- **Então** a sessão é carregada com os dados originais.
- **Dado** uma sessão selada com a senha extra `A`, vinda do header `x-h3-session`
- **Quando** `getSession` lê a sessão
- **Então** a sessão é carregada e a resposta não contém `Set-Cookie` de reselagem.

### RF-08 — Validação das senhas extras

Cada senha extra deve ter ao menos 32 caracteres, do mesmo modo que `password` precisa (a verificação de tamanho do iron-crypto). Uma senha inválida não pode ser ignorada em silêncio: a validação ocorre antes de qualquer leitura de cookie, e a chamada falha com erro que identifica a senha extra inválida pelo índice.

**Critério de aceite**
- **Dado** uma configuração com `extraUnsealPasswords: ["curta"]`, e um cookie válido qualquer
- **Quando** `getSession` é chamado
- **Então** a chamada lança erro que cita o índice `0` e o tamanho mínimo de 32 caracteres.
- **Dado** uma configuração com `extraUnsealPasswords: [""]`
- **Quando** `getSession` é chamado
- **Então** a chamada lança erro, como no caso anterior.
- **Dado** uma configuração com `extraUnsealPasswords: []`
- **Quando** `getSession` é chamado
- **Então** nenhum erro é lançado.

### RF-09 — Expiração independe da senha que abriu a sessão

`maxAge` e `idleTimeout` são aplicados da mesma forma, qualquer que seja a senha que abriu a sessão.

**Critério de aceite**
- **Dado** uma sessão selada com a senha extra `A`, e `maxAge: 60`
- **Quando** `getSession` lê a sessão 61 segundos depois da criação (relógio simulado)
- **Então** a sessão é tratada como expirada, com o mesmo resultado de uma sessão selada com `P`.
- **Dado** uma sessão selada com a senha extra `A`, e `idleTimeout: 60`, sem atividade por 61 segundos
- **Quando** `getSession` lê a sessão
- **Então** a sessão é tratada como expirada.

### RF-10 — Nenhum outro nome público novo

A mudança adiciona um único símbolo público: o campo `extraUnsealPasswords`.

**Critério de aceite**
- **Dado** o diff da mudança
- **Quando** os exports de `src/index.ts` e de `src/utils/session.ts` são comparados com a versão atual
- **Então** nenhum novo export existe além do campo `extraUnsealPasswords` dentro de `SessionConfig`.
- **Dado** o projeto após a mudança
- **Quando** `pnpm lint` e `pnpm typecheck` são executados
- **Então** ambos passam.

## Fora de escopo

- `password` aceito como array (a segunda alternativa da issue).
- Identificadores de senha (mapa `{ id: senha }`) do iron-crypto expostos ao usuário.
- Rotação automática, agendada ou por tempo. A biblioteca recebe as senhas; quem gira é o desenvolvedor.
- Remoção do `legacySealFallback` (fica para a v3, conforme o TODO em `unsealSession`).
- Mudança de algoritmo, de iterações PBKDF2 ou do formato do selo.
- Validação de tamanho de `password` (permanece como hoje).
- Revogação de sessões individuais, ou invalidação em massa de sessões.
- Reselagem de sessões lidas pelo header (não são resseladas, como hoje).
- Novos exports públicos para `sealSession`, `unsealSession` ou para a ordem de tentativas.

## Premissas

- A maioria dos usuários usa sessões por cookie (o padrão). Sessões por header continuam válidas até expirarem, e só migram quando o cliente recebe um novo token por outro meio.
- Sessões sem `maxAge` nem `idleTimeout` não expiram (o `ttl` do selo fica em 0). Nesse caso, a senha antiga precisa permanecer na lista até o desenvolvedor aceitar a perda dessas sessões.
- Senhas extras têm a mesma exigência de entropia de `password`: aleatórias e com ao menos 32 caracteres, como descrito no TSDoc de `password`.
- A validação de RF-08 é uma decisão deliberada: diverge do comportamento atual de `password` (erro engolido) e não deve ser aplicada a `password` nesta entrega.
- O código de referência é `src/utils/session.ts` (`getSession`, `unsealSession`, `sealSession`) e `src/utils/internal/iron-crypto.ts` (`unseal`, que já aceita uma senha por string e não usa o identificador do selo quando a senha é string).

## Riscos

- **Senha antiga vazada:** enquanto estiver na lista, ela continua válida para abrir sessões. Mitigação: documentar que a senha deve sair da lista quando as sessões que ela selou expirarem; RF-07 migra as sessões ativas que chegam por cookie.
- **Custo de CPU:** cada senha extra adiciona uma tentativa de PBKDF2 (8192 iterações) e, com o fallback legado, até mais uma por senha. Uma sessão aberta pela última senha da lista custa N tentativas por requisição. Mitigação: documentar a recomendação de poucas senhas e medir o custo antes de liberar.
- **Erros silenciosos em outros caminhos:** `getSession` continua engolindo erros de unseal para `password`, o que pode confundir quem depura. Mitigação: RF-08 cobre apenas o campo novo; a mudança no comportamento de `password` fica para outra entrega.
- **Concorrência:** o caminho de `getSession` com `kGetSession` é sensível a alterações. Mitigação: os testes existentes de concorrência e de criação preguiçosa devem continuar passando sem alteração.
