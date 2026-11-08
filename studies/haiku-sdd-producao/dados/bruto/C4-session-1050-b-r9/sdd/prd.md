# PRD — Várias senhas de unseal nas sessões (#1050-b)

## Problema e objetivo

Hoje `SessionConfig.password` é a única chave aceita para abrir (unseal) uma sessão selada. Ao trocar a senha por rotação de segredos, todas as sessões seladas com a senha antiga deixam de abrir e os usuários são desconectados de uma vez. A issue h3js/h3#1050 pede que as sessões anteriores continuem válidas durante a rotação.

**Objetivo:** permitir que `useSession`/`getSession` aceitem sessões seladas com senhas anteriores, configuradas num campo novo `extraUnsealPasswords`, sem alterar o comportamento de quem não usa o campo. A senha atual (`password`) continua sendo a única usada para selar.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com as senhas anteriores que só servem para abrir sessões. `password` continua `string`.

**Critério de aceite**

- **Dado** uma configuração de sessão com `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o código de TypeScript for verificado (`pnpm typecheck`),
- **Então** o campo é aceito como `string[]` opcional, e nenhum outro nome público novo é exportado.

### RF-02 — Selagem sempre com `password`

Ao selar uma sessão, a biblioteca usa somente `password`. As senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** uma sessão é gravada com `updateSession`,
- **Então** o cookie pode ser aberto com `"nova"` e não pode ser aberto apenas com `"antiga"`.

### RF-03 — Abertura tenta as senhas em ordem

Ao abrir uma sessão, a biblioteca tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem em que foram declarados. A primeira senha que abre o selo vence.

**Critério de aceite**

- **Dado** um cookie selado com `"antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** uma requisição chega com esse cookie e a sessão é lida com `getSession`,
- **Então** a sessão é carregada com os dados originais e `id` igual ao do cookie.

### RF-04 — Sem senhas extras, comportamento inalterado

Quando `extraUnsealPasswords` está ausente ou é um array vazio, a leitura e a escrita de sessões se comportam exatamente como hoje, incluindo o conteúdo do cookie gerado.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`),
- **Quando** a suíte existente de sessões (`test/session.test.ts`) for executada,
- **Então** todos os testes que passavam antes continuam passando sem alteração de asserção.

### RF-05 — Falha com todas as senhas

Se nenhuma senha (`password` ou extra) abre o selo, a sessão é tratada como inexistente, exatamente como hoje ao falhar com a senha única. Nenhum erro novo é lançado para o handler.

**Critério de aceite**

- **Dado** um cookie selado com `"desconhecida"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a sessão é lida com `getSession`,
- **Então** o resultado é uma sessão nova, vazia, com `id` diferente do cookie recebido.

### RF-06 — Fallback de selo legado por senha

O fallback de selo legado (1 iteração PBKDF2, hoje ligado por `legacySealFallback`) deve valer para cada senha candidata. Uma sessão antiga selada com 1 iteração e com uma senha extra precisa abrir.

**Critério de aceite**

- **Dado** um cookie selado com a senha extra e com o selo legado de 1 iteração,
- **Quando** a sessão é lida com `legacySealFallback` em seu valor padrão,
- **Então** a sessão abre e é resselada com `password` (ver RF-07).

Com `legacySealFallback: false`, a mesma sessão legada deve ser rejeitada, como hoje.

### RF-07 — Migração ao abrir com senha extra

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password` na mesma leitura, para que o cookie migre para a senha atual e as senhas antigas possam ser removidas depois.

**Critério de aceite**

- **Dado** um cookie selado com `"antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a sessão é lida com `getSession` numa requisição que tem o cookie,
- **Então** a resposta contém um `Set-Cookie` novo que abre com `"nova"` e não abre com `"antiga"`.

### RF-08 — Expiração independe da senha

As regras de `maxAge` e `idleTimeout` valem do mesmo jeito, qualquer que seja a senha que abriu a sessão.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` cujo `createdAt` ultrapassou `maxAge`,
- **Quando** a sessão é lida com `getSession` usando `extraUnsealPasswords: ["antiga"]`,
- **Então** a sessão é tratada como expirada e não é carregada.

### RF-09 — Vale também para sessões no header

Sessões recebidas pelo header de sessão (`sessionHeader`) são abertas pelo mesmo caminho e aceitam as senhas extras da mesma forma.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` enviada no header `x-h3-session` e uma configuração com `extraUnsealPasswords: ["antiga"]`,
- **Quando** a sessão é lida com `getSession`,
- **Então** a sessão é carregada, e não há `Set-Cookie` de migração, porque sessões do header não são reseladas.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050). Só o campo novo é implementado.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Versionamento ou identificador de chave (`kid`) dentro do cookie para escolher a senha sem tentativas.
- Remover ou alterar o fallback de selo legado (a remoção está prevista para v3).
- Mudar algoritmo, iterações ou formato do selo em `src/utils/internal/iron-crypto.ts`.
- Revogação de sessões ou armazenamento server-side.
- Ferramenta ou comando para rotacionar segredos.
- Validação de tamanho mínimo das senhas extras, além do que já existir para `password`.

## Premissas

- **P1.** O formato do cookie selado não muda: as senhas extras são usadas só na abertura, e o conteúdo do selo continua o mesmo.
- **P2.** A ordem de `extraUnsealPasswords` é a ordem de tentativa. Não há mais de uma senha ativa para selar.
- **P3.** A migração descrita em RF-07 é uma decisão de desenho que a issue não pede explicitamente. Assumo que é desejada, porque sem ela não há como desligar a senha antiga no futuro. Se não for, RF-07 sai e as sessões antigas continuam selando com a senha antiga até expirar.
- **P4.** O documento de `SessionConfig.password` (mínimo de 32 caracteres, entropia) vale também para as senhas extras. Isso é só documentação; a implementação não precisa validar.
- **P5.** `useSession` e `getSession` compartilham `unsealSession`, então uma única mudança cobre os dois.

## Riscos

- **R1 — Custo de latência.** Cada senha tentada é uma derivação PBKDF2 completa (8192 iterações por padrão). Uma sessão antiga pode custar até `1 + N` derivações, e o fallback legado dobra as tentativas. Com muitas senhas extras, o custo sobe em toda requisição de sessões antigas. Mitigação: manter a lista curta e documentar.
- **R2 — Senhas antigas esquecidas.** Manter senhas antigas indefinidamente amplia a superfície de ataque, porque um cookie roubado pode ser testado contra todas elas. Mitigação: documentar que as senhas extras devem sair da configuração quando as sessões antigas já tiverem migrado.
- **R3 — Testes existentes acoplados.** Alguns testes de `test/session.test.ts` podem depender de uma única tentativa de unseal ou de mensagens de erro exatas, como `"Bad hmac value"`. Mitigação: ajustar só o que a mudança altera, sem remover o que cada teste verifica.
- **R4 — Migração e `Set-Cookie` duplicado.** Resselar durante a leitura pode gerar um segundo `Set-Cookie` na mesma resposta, se o handler também escrever a sessão. Mitigação: confiar na deduplicação de `setCookie` já existente e cobrir com teste.
- **R5 — Tempo de vida após troca.** Sessões que não são lidas depois da troca continuam com a senha antiga até expirarem. Se `maxAge` e `idleTimeout` não estiverem configurados, elas podem durar para sempre. Mitigação: documentar.
