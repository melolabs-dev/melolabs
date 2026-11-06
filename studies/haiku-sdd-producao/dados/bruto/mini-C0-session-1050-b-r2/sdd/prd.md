# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## 1. Problema e objetivo

### Problema

Hoje `SessionConfig.password` (`src/utils/session.ts`) é a única senha usada para selar e abrir o cookie/header de sessão. Ao rotacionar essa senha, todas as sessões já emitidas falham no unseal e são descartadas: os usuários perdem a sessão e precisam se autenticar de novo. Isso desencoraja a rotação periódica de segredos, que é uma boa prática de segurança.

### Objetivo

Permitir a rotação de senhas sem invalidar as sessões existentes. `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores usadas **somente para abrir** sessões. `password` continua sendo uma string e continua sendo a única senha que sela. Sessões abertas com uma senha extra são migradas para a senha atual.

### Métricas de sucesso

- Após trocar `password` e mover a antiga para `extraUnsealPasswords`, 100% das sessões válidas emitidas com a senha antiga continuam sendo aceitas.
- Sem `extraUnsealPasswords`, o comportamento é idêntico ao atual e a suíte existente passa sem perda de cobertura.
- `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` expõe `extraUnsealPasswords?: string[]`, documentado com TSDoc (somente unseal; usadas após `password`; o mesmo requisito de entropia da `password`). `password` permanece `string`. Nenhum outro nome público novo é exportado.

**Critério de aceite**

- **Dado** uma configuração `{ password, extraUnsealPasswords: [antiga] }`,
- **Quando** o código é compilado com `pnpm typecheck`,
- **Então** a configuração é aceita, `password` continua exigindo `string`, e a API pública não ganha nenhum outro nome novo.

### RF-02 — Selar sempre com `password`

Toda operação de seal (`sealSession`, `updateSession`, `useSession`) usa exclusivamente `config.password`, nunca uma senha extra.

**Critério de aceite**

- **Dado** uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`,
- **Quando** uma sessão é criada ou atualizada e o cookie resultante é aberto,
- **Então** o cookie abre com P2 e **não** abre com P1.

### RF-03 — Abrir sessões com senhas extras

`unsealSession` tenta primeiro `password` e, se falhar por senha/assinatura inválida, tenta cada item de `extraUnsealPasswords` na ordem informada, parando na primeira que abrir. Vale para cookie e para o header de sessão.

**Critério de aceite**

- **Dado** uma sessão selada com P1 e uma configuração com `password` P2 e `extraUnsealPasswords: [P1]`,
- **Quando** a requisição chega com esse cookie (ou header de sessão),
- **Então** `getSession`/`useSession` retornam a mesma sessão (mesmo `id`, `createdAt` e `data`).

### RF-04 — Rejeitar senhas desconhecidas

Se nenhuma das senhas (`password` e extras) abrir o selo, a sessão é tratada como inválida, como hoje: descartada e substituída por uma nova.

**Critério de aceite**

- **Dado** uma sessão selada com P0, que não está em `password` nem em `extraUnsealPasswords`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é rejeitada, é criada uma nova sessão com `id` diferente e nenhum erro vaza para o handler.

### RF-05 — Migrar a sessão para a senha atual

Uma sessão aberta com uma senha extra é resselada com `password`, de modo que a senha antiga possa ser removida depois. O reseal reaproveita o mecanismo já usado para o selo legado (`kLegacySeal`) e só ocorre para sessões vindas de cookie (o header não pode ser resselado).

**Critério de aceite**

- **Dado** uma sessão válida selada com P1 e a configuração `password` P2 e `extraUnsealPasswords: [P1]`,
- **Quando** `getSession` lê o cookie,
- **Então** a resposta traz um `Set-Cookie` novo, que abre com P2, preservando `id`, `createdAt` e `data`.

### RF-06 — Preservar as regras de expiração

`maxAge` e `idleTimeout` continuam valendo para sessões abertas com senhas extras, e o reseal de migração não estende a vida da sessão além desses limites (`createdAt` intocado).

**Critério de aceite**

- **Dado** uma sessão selada com P1 e já vencida segundo `maxAge` (ou `idleTimeout`), com P1 em `extraUnsealPasswords`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é rejeitada como expirada e substituída por uma nova.

### RF-07 — Compatibilidade com o selo legado e com `seal` customizado

O fallback de iterações legadas (`legacySealFallback`) e as opções de `config.seal` funcionam também com senhas extras: uma sessão legada selada com uma senha extra é aberta e migrada. Com `legacySealFallback: false`, ela continua rejeitada.

**Critério de aceite**

- **Dado** uma sessão selada com 1 iteração PBKDF2 e com a senha P1, e a configuração `password` P2 e `extraUnsealPasswords: [P1]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é aceita e resselada com P2 e as iterações atuais; com `legacySealFallback: false` ela é rejeitada.

### RF-08 — Sem regressão sem senhas extras

Com `extraUnsealPasswords` ausente ou vazio, o comportamento, as chamadas de crypto e os erros são os mesmos de hoje.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`),
- **Quando** a suíte existente de sessões é executada,
- **Então** ela passa; qualquer teste ajustado mantém o que verificava; `pnpm lint` e `pnpm typecheck` passam.

### RF-09 — Cobertura de testes

Testes `describeMatrix` (web e node) cobrem RF-02 a RF-07, incluindo ordem de tentativa e múltiplas senhas extras.

**Critério de aceite**

- **Dado** os novos testes em `test/session.test.ts` (ou arquivo equivalente existente),
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** todos passam em `web` e `node`, e cada teste de regressão falha sem a implementação.

## 3. Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue): não será feito nesta variante.
- Novas funções, tipos ou exports públicos além do campo `extraUnsealPasswords`.
- Mudar o algoritmo de seal, as iterações padrão ou o formato do cookie.
- Gerar, armazenar ou rotacionar segredos automaticamente; o gerenciamento das senhas é do usuário.
- Aplicar a mesma opção a outras APIs de seal (por exemplo, utilitários de cookie assinado fora das sessões).
- Revogar sessões individuais ou invalidar uma senha extra em tempo de execução.

## 4. Premissas e riscos

### Premissas

- `extraUnsealPasswords` tem o mesmo requisito de entropia/tamanho (mín. 32 caracteres) de `password`, e a validação existente de `iron-crypto` basta.
- As senhas extras são poucas (rotação típica de 1 a 3 itens); tentar em sequência é aceitável.
- O erro "Session expired!" é uma falha de política e não deve disparar novas tentativas com outras senhas.

### Riscos e mitigações

- **Custo de CPU (PBKDF2):** cada tentativa extra custa uma derivação. Mitigação: tentar `password` primeiro (caso comum), parar na primeira que abrir, e restringir as novas tentativas a falhas de senha/HMAC.
- **Combinação com o fallback legado:** o produto cartesiano senhas × iterações pode multiplicar o custo. Mitigação: definir a ordem (cada senha com iterações atuais, depois legadas) e testar; manter o limite do tamanho da lista como decisão aberta.
- **Distinguir "senha errada" de outros erros:** classificar mal pode mascarar erros reais ou pular tentativas. Mitigação: reaproveitar a checagem atual (`Bad hmac value`) e cobrir com testes.
- **Senhas antigas ficarem para sempre:** sem remoção, a segurança não melhora. Mitigação: o reseal do RF-05 migra as sessões ativas e a TSDoc orienta a remover a senha extra depois de `maxAge`.
- **Sessões via header não migram:** continuam seladas com a senha antiga até expirar. Aceito e documentado.
- **Vazamento de senha antiga:** uma senha extra comprometida continua abrindo sessões. Mitigação: documentar que só deve ser mantida enquanto necessário.
