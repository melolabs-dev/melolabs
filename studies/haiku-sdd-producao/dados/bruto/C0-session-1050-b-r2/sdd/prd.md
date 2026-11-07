# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

### Problema
Hoje `SessionConfig.password` é a única senha usada para selar e abrir sessões (`src/utils/session.ts`). Ao rotacionar o segredo, todas as sessões já emitidas deixam de abrir (falha de HMAC), e os usuários perdem a sessão. Não existe forma de rotacionar a senha sem invalidar as sessões ativas.

### Objetivo
Permitir que a aplicação configure senhas anteriores que **só abrem** sessões, mantendo `password` como a única senha que **sela**. As sessões seladas com uma senha anterior continuam válidas e migram para a senha atual de forma transparente. Sem senhas extras, o comportamento permanece idêntico ao atual.

### Referência
Issue h3js/h3#1050, primeira alternativa proposta (campo adicional em vez de `password` como array).

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`
`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado em JSDoc. `password` continua `string`. Nenhum outro nome público é criado.

**Critério de aceite**
- **Dado** uma configuração com `password` e `extraUnsealPasswords: ["antiga"]`
- **Quando** o código é compilado com `pnpm typecheck`
- **Então** a configuração é aceita, e atribuir `password` como array continua sendo erro de tipo.

### RF-02 — Selagem sempre com `password`
`sealSession` (e portanto `updateSession`/`useSession`) usa exclusivamente `config.password`, nunca uma senha extra.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** uma sessão é selada e o resultado é aberto usando apenas `password: "nova"`
- **Então** a abertura tem sucesso, e a abertura usando apenas `"antiga"` falha.

### RF-03 — Abertura com senhas extras como alternativa
`unsealSession` tenta primeiro `password` e, se a senha for rejeitada, tenta cada item de `extraUnsealPasswords` na ordem informada. A primeira que abrir vale.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `"antiga"` e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`
- **Quando** uma requisição com o cookie dessa sessão chama `getSession`/`useSession`
- **Então** os dados e o `id` originais da sessão são recuperados.

### RF-04 — Rejeição quando nenhuma senha serve
Se nem `password` nem as senhas extras abrirem o selo, a sessão é tratada como hoje: descartada e substituída por uma nova. Erros que não sejam de senha incorreta (por exemplo, sessão expirada por `maxAge`/`idleTimeout`) não são mascarados nem reinterpretados pela tentativa de outras senhas.

**Critério de aceite**
- **Dado** um cookie selado com `"desconhecida"` e uma configuração com `password` e `extraUnsealPasswords` que não a incluem
- **Quando** `getSession` é chamado
- **Então** é criada uma sessão nova (novo `id`, `data` vazio) e nenhum erro é propagado ao handler.

### RF-05 — Migração para a senha atual (reselagem)
Uma sessão aberta com uma senha extra é reselada com `password` na mesma requisição, seguindo o mecanismo já usado para selos legados, de modo que a senha antiga possa ser removida depois.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e uma configuração `password: "nova"`, `extraUnsealPasswords: ["antiga"]`
- **Quando** a requisição é processada via `getSession`/`useSession` com cookie
- **Então** a resposta contém `Set-Cookie` com a sessão reselada, que abre apenas com `"nova"` e mantém o mesmo `id`.

### RF-06 — Interação com o fallback de selo legado
O fallback de iterações PBKDF2 legado (`legacySealFallback`) continua funcionando e também considera as senhas extras: uma sessão legada selada com senha anterior abre e é reselada com as opções atuais e `password`.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e 1 iteração PBKDF2, e uma configuração com `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession` é chamado com o cookie
- **Então** a sessão abre e é reselada com `"nova"` e as iterações atuais; com `legacySealFallback: false` a sessão é descartada.

### RF-07 — Compatibilidade sem senhas extras
Com `extraUnsealPasswords` ausente ou `[]`, o comportamento (resultados, erros, cookies, número de tentativas de unseal) é o mesmo de hoje.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** a suíte existente (`pnpm vitest run test/session.test.ts` e demais) é executada
- **Então** todos os testes passam sem que suas verificações tenham sido enfraquecidas.

### RF-08 — Testes e qualidade
Os cenários RF-02 a RF-06 têm testes de regressão com `describeMatrix` (web e node). Ajustes em código ou testes existentes ficam restritos ao que a mudança realmente altera.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos terminam com sucesso.

## Fora de escopo
- Aceitar `password` como array (segunda alternativa da issue).
- Qualquer outro nome público novo (funções, tipos exportados, opções).
- Alterar o formato do selo, os parâmetros padrão de PBKDF2 ou o módulo `iron-crypto`.
- Rotação automática de segredos, gestão/armazenamento de senhas ou revogação de sessões.
- Mudanças em `useSession`/`getSession` além do necessário; alterações em outros utilitários (cookies, auth, etc.) e na documentação fora do JSDoc do novo campo.
- Alterar `package.json`, dependências ou configuração de build.

## Premissas e riscos

### Premissas
- A ordem de tentativa é `password` e depois `extraUnsealPasswords` na ordem do array; a lista é pequena (poucas rotações).
- A rejeição por senha incorreta é identificável pela mensagem de erro (`"Bad hmac value"`, já usada no fallback legado).
- A reselagem proativa reaproveita o caminho existente (`kLegacySeal` / `updateSession`) apenas para sessões vindas de cookie, não do header de sessão.

### Riscos
- **Custo de CPU:** cada senha extra implica um PBKDF2 adicional por tentativa (e mais um ao combinar com o fallback legado), amplificando o custo de cookies inválidos. Mitigação: tentar `password` primeiro e documentar que a lista deve ser curta.
- **Erros mascarados:** tentar outras senhas após qualquer erro poderia esconder falhas reais (expiração, selo malformado). Mitigação: só avançar para a próxima senha em caso de HMAC inválido (RF-04).
- **Sessões vindas de header:** como não são reseladas, continuam dependendo da senha antiga até o cliente renovar; remover a senha antiga cedo demais as invalida.
- **Segredos extras em memória/configuração:** senhas antigas continuam sendo material sensível; remover-as da configuração após o período de migração é responsabilidade da aplicação.
- **Regressão em testes existentes que assumem uma única senha:** devem ser ajustados sem perder o que verificam (RF-07).
