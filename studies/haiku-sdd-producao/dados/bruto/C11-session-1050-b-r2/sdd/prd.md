# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b). Código de referência: `src/utils/session.ts`.

## Problema e objetivo

Hoje cada `SessionConfig` tem uma única `password`, usada para selar e para abrir as sessões. Ao trocar essa senha, todas as sessões seladas com a senha antiga deixam de abrir e o usuário é deslogado de uma vez.

Objetivo: permitir uma rotação sem logout em massa. A nova senha passa a selar, e as senhas anteriores continuam abrindo sessões já emitidas. Isso é feito com um campo novo, `extraUnsealPasswords`, em `SessionConfig`. Sem esse campo, o comportamento não muda.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` aceita o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores que só servem para abrir sessões. `password` continua sendo uma `string` e continua sendo a única senha de selagem. Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** uma `SessionConfig` com `password` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o objeto é passado a `useSession`, `getSession` ou `updateSession`,
- **Então** a chamada compila sem erro de tipo e a configuração é aceita em tempo de execução.

### RF-02 — Abrir sessões seladas com senha extra

Ao ler um cookie ou header de sessão, a leitura tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem do array. A primeira senha que valida o HMAC é usada.

**Critério de aceite**
- **Dado** uma sessão selada com `"senha-antiga"` e uma config com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** a requisição com esse cookie chega e `getSession` é chamado,
- **Então** `session.data` e `session.id` são os da sessão original.

### RF-03 — Selar sempre com `password`

Toda selagem usa somente `password`. `sealSession` e `updateSession` nunca usam `extraUnsealPasswords`.

**Critério de aceite**
- **Dado** uma config com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `updateSession(event, config, { user: "ana" })` é chamado,
- **Então** o cookie emitido abre com `unsealSession` usando só `"senha-nova"`, e falha se for aberto só com `"senha-antiga"`.

### RF-04 — Sessão com senha desconhecida continua tratada como nova

Se nenhuma senha (`password` nem extras) valida o cookie, o comportamento é o de hoje: a sessão é ignorada e uma nova é criada em memória.

**Critério de aceite**
- **Dado** um cookie selado com `"senha-desconhecida"` e uma config com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` é chamado,
- **Então** a sessão retornada tem `id` novo, `data` vazio e nenhum erro é lançado.

### RF-05 — Retrocompatibilidade sem senhas extras

Sem `extraUnsealPasswords`, ou com array vazio, a biblioteca se comporta exatamente como antes, inclusive com o fallback de seal legado.

**Critério de aceite**
- **Dado** a suíte existente em `test/session.test.ts` e os testes de unidade relacionados,
- **Quando** `pnpm vitest run test/session.test.ts` roda sem alterações nos testes,
- **Então** todos os casos passam.

### RF-06 — Migração gradual por releitura

Quando uma sessão baseada em cookie é aberta com uma senha extra, ela é resselada com `password` na mesma requisição. Assim a rotação avança conforme os usuários navegam, sem exigir que todas as sessões sejam renovadas de uma vez. Sessões lidas por header não são resseladas, pelo mesmo motivo já documentado em `idleTimeout`.

**Critério de aceite**
- **Dado** um cookie selado com `"senha-antiga"` e uma config com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` lê esse cookie,
- **Então** a resposta contém um `Set-Cookie` novo, que abre com `"senha-nova"`.

- **Dado** o mesmo cenário, mas com a sessão enviada pelo header `x-h3-session`,
- **Quando** `getSession` é chamado,
- **Então** a sessão é carregada e nenhum `Set-Cookie` é emitido.

### RF-07 — Validação das senhas extras

Cada item de `extraUnsealPasswords` precisa atender às mesmas regras de `password`: não vazio e com o tamanho mínimo exigido pela selagem (32 caracteres). Um item inválido gera erro explícito, em vez de ser ignorado em silêncio.

**Critério de aceite**
- **Dado** uma config com `extraUnsealPasswords: [""]` ou com um item de 10 caracteres,
- **Quando** `useSession` ou `getSession` é chamado com essa config,
- **Então** a chamada rejeita com erro que cita o problema da senha extra.

### RF-08 — Expiração continua valendo para sessões com senha extra

`maxAge` e `idleTimeout` são aplicados da mesma forma, independentemente da senha que abriu a sessão.

**Critério de aceite**
- **Dado** uma sessão selada com `"senha-antiga"` cujo `createdAt` ultrapassa `maxAge`,
- **Quando** `getSession` é chamado com a config que tem `extraUnsealPasswords: ["senha-antiga"]`,
- **Então** a sessão é tratada como expirada e uma nova é criada.

### RF-09 — Fallback de seal legado com senhas extras

O fallback de 1 iteração PBKDF2 (`legacySealFallback`) funciona para cada senha da lista, e uma sessão aberta por esse caminho é resselada como já acontece hoje.

**Critério de aceite**
- **Dado** um cookie selado com `"senha-antiga"` usando 1 iteração e uma config com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` é chamado,
- **Então** a sessão é carregada e resselada com as opções atuais.

### RF-10 — Cobertura nos dois alvos de teste

Os novos casos ficam em `test/session.test.ts` (ou em arquivo irmão) usando `describeMatrix`, para rodar em `web` e `node`.

**Critério de aceite**
- **Dado** os novos testes de RF-02 a RF-09,
- **Quando** `pnpm vitest run test/session.test.ts` roda,
- **Então** cada cenário passa nos alvos `web` e `node`.

## Fora de escopo

- Lista de senhas no lugar de `password` (a alternativa 2 da issue). Só a alternativa 1 é implementada.
- Selagem com várias senhas ou escolha de senha por sessão.
- Rotação automática, leitura de senhas de variáveis de ambiente ou integração com cofres de segredo.
- Identificadores de senha do iron (`password.id`) em `extraUnsealPasswords`.
- Remoção do `legacySealFallback`, que fica para v3.
- Mudança no formato do cookie, no algoritmo de seal ou nos padrões de `seal`.
- Reselagem de sessões lidas por header.
- Mudanças em `basicAuth` ou em outros usos de senha no projeto.

## Premissas e riscos

**Premissas**
- A ordem de tentativa é `password` e depois as extras, na ordem do array. Não há prioridade configurável.
- Sessões abertas por senha extra são resseladas (RF-06). Isso é uma decisão de design: sem ela, a rotação nunca termina, porque as sessões antigas continuariam dependendo da senha anterior até expirar. Se o mantenedor preferir não reselar, RF-06 deve ser revisado.
- A validação de RF-07 acontece ao usar a config, não ao carregar a biblioteca.
- `unsealSession` é exportada (`src/index.ts`). Ela passa a considerar `extraUnsealPasswords`, o que é uma mudança de comportamento aceita pela feature.

**Riscos**
- **Custo de CPU:** cada senha extra que não corresponde custa uma derivação PBKDF2 com 8192 iterações. Um cookie inválido passa a custar até `1 + N` derivações. Isso amplifica o custo de requisições com cookies forjados. Convém limitar o número de extras na documentação e medir antes de publicar.
- **Senha antiga vazada:** senhas antigas continuam válidas enquanto estiverem na lista. A documentação deve dizer para remover a senha da lista quando o último cookie antigo já tiver expirado (`maxAge`).
- **Sessões por header:** sessões antigas enviadas por header continuam abrindo com a senha anterior até expirar, sem migração.
- **Interação com `legacySealFallback`:** combinar o fallback de 1 iteração com várias senhas multiplica as tentativas (até `2 × (1 + N)` derivações). Os testes precisam cobrir esse caso.
- **Regressão silenciosa:** um erro na ordem de tentativa poderia aceitar uma senha errada sem falhar. A cobertura de RF-03 e RF-04 existe para detectar isso.
