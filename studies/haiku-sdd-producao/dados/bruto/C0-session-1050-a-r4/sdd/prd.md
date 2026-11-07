# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`, usada tanto para selar quanto para abrir o cookie/cabeçalho de sessão. Ao rotacionar a senha, todas as sessões seladas com a senha anterior falham no unseal e são descartadas: os usuários perdem a sessão de uma só vez. A issue h3js/h3#1050 pede uma forma de continuar honrando sessões seladas com senhas antigas durante a rotação.

### Objetivo
Permitir que `password` seja `string | string[]` (lista não vazia). Na lista, a primeira senha sela; as demais só abrem sessões. Uma string continua valendo como hoje. Esta variante corresponde à segunda alternativa proposta na issue e não cria nenhum nome público novo.

### Métricas de sucesso
- Uma sessão selada com uma senha antiga, ainda presente na lista, é aceita após a rotação.
- Com uma senha só (string ou lista de um item), o comportamento é idêntico ao atual.
- A suíte existente, `pnpm lint` e `pnpm typecheck` passam.

## 2. Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia de strings
O tipo `SessionConfig.password` passa a ser `string | string[]`. A documentação do campo (JSDoc) descreve a semântica de rotação e mantém o aviso sobre entropia e o mínimo de 32 caracteres, que vale para cada senha da lista.

**Critério de aceite**
- **Dado** uma configuração com `password: ["senha-nova-...", "senha-antiga-..."]` (cada uma com 32+ caracteres)
- **Quando** o código é verificado pelo typecheck e `useSession` é chamado com essa configuração
- **Então** o tipo é aceito sem erro e a sessão funciona normalmente.

### RF-02 — A primeira senha da lista sela
Toda selagem de sessão (`sealSession`, cookie escrito por `updateSession`/`useSession`, reselagem por legado ou `idleTimeout`) usa somente a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: [A, B]`
- **Quando** uma sessão é criada e escrita
- **Então** o cookie gerado só é aberto com `A` (`password: A` abre; `password: B` sozinha não abre).

### RF-03 — As demais senhas só abrem sessões
No unseal (`getSession`, `unsealSession`), as senhas são tentadas em ordem: a primeira, depois as seguintes, até uma abrir. Se nenhuma abrir, o resultado é o mesmo de hoje (sessão inválida, substituída por uma nova).

**Critério de aceite**
- **Dado** um cookie selado com `B` e a configuração `password: [A, B]`
- **Quando** uma requisição com esse cookie chama `getSession`
- **Então** a sessão é recuperada com o mesmo `id` e os mesmos dados.
- **E** com `password: [A, C]` (nenhuma abre o cookie), a requisição recebe uma sessão nova com `id` diferente.

### RF-04 — Sessão aberta com senha antiga é reselada com a primeira
Quando uma sessão é aberta por uma senha que não é a primeira, e veio de cookie, ela é reselada com a primeira senha na mesma requisição, para que a rotação se complete sem exigir escrita pelo handler. Sessões vindas do cabeçalho não são reseladas (já é assim hoje).

**Critério de aceite**
- **Dado** um cookie selado com `B` e `password: [A, B]`
- **Quando** a requisição chama `getSession` e lê a resposta
- **Então** a resposta traz `Set-Cookie` com a sessão selada com `A`, preservando `id` e `data`.
- **E** quando o cookie já foi selado com `A`, nenhum `Set-Cookie` extra é emitido por esse motivo.

### RF-05 — Uma senha só mantém o comportamento atual
`password` como string, ou lista de um único item, se comporta como hoje: mesma selagem, mesmo unseal, sem reselagem extra e sem custo adicional perceptível.

**Critério de aceite**
- **Dado** `password: "x".repeat(32)` e, em outro caso, `password: ["x".repeat(32)]`
- **Quando** os testes de sessão existentes rodam com cada forma
- **Então** os resultados são iguais (mesmos cookies abertos, mesmas expirações, mesmos erros).

### RF-06 — Lista vazia ou senha inválida é rejeitada
Uma lista vazia, ou uma lista com item vazio ou curto demais (menos de 32 caracteres), é tratada como erro de configuração, com a mesma natureza do erro atual para senha vazia ou curta, sem aceitar a sessão em silêncio.

**Critério de aceite**
- **Dado** `password: []`
- **Quando** `useSession` (ou `sealSession`) é chamado
- **Então** a chamada falha com erro de senha inválida e nenhuma sessão é emitida.
- **E** o mesmo vale para `["a".repeat(32), ""]` e para uma lista com item de menos de 32 caracteres.

### RF-07 — Demais opções continuam valendo em todas as senhas
`maxAge`, `idleTimeout`, `seal` e `legacySealFallback` se aplicam igualmente a sessões abertas por qualquer senha da lista. O fallback legado (1 iteração PBKDF2) é tentado também com as senhas antigas.

**Critério de aceite**
- **Dado** `password: [A, B]`, `maxAge` configurado e um cookie selado com `B` cujo `createdAt` excede `maxAge`
- **Quando** a requisição chama `getSession`
- **Então** o cookie é rejeitado por expiração, como seria com `A`.
- **E** um cookie legado (1 iteração) selado com `B` é aberto e reselado com `A`.

### RF-08 — Documentação e testes
A mudança inclui testes novos em `test/` cobrindo RF-02 a RF-07, ajuste mínimo dos testes e do código existentes que dependam do tipo antigo (sem perder o que verificam), e atualização da documentação de sessões, se houver, com um exemplo de rotação.

**Critério de aceite**
- **Dado** a mudança aplicada
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam, e os testes novos falham se a lógica de rotação for removida.

## 3. Fora de escopo
- Parâmetro separado (`extraUnsealPasswords` ou similar): é a primeira alternativa da issue e não faz parte desta variante.
- Qualquer outro nome público novo (funções, opções, exports, tipos).
- Mapa de senhas com ids (`{ id: senha }`) do iron, e senhas como `Uint8Array`.
- Mudanças em `iron-crypto.ts`, nos algoritmos, nas iterações PBKDF2 ou no formato do selo.
- Rotação automática, geração ou armazenamento de segredos.
- Revogação ativa de senhas além de removê-las da lista.
- Mudanças em `requireBasicAuth` ou em outros usos de `password` fora das sessões.

## 4. Premissas e riscos

### Premissas
- O operador mantém a ordem da lista: a mais nova primeiro, as antigas depois, e remove as antigas quando as sessões correspondentes expirarem.
- O iron-crypto atual não carrega o id da senha no selo (id `default`), então não é possível saber de antemão qual senha selou; a tentativa é feita em ordem.
- Cada senha da lista segue as regras atuais (mínimo de 32 caracteres, alta entropia).

### Riscos
- **Custo de CPU:** cada tentativa de unseal executa PBKDF2 (8192 iterações), e há também o fallback legado. Uma lista longa, ou um cookie inválido, multiplica o custo por requisição, o que facilita DoS. Mitigação: documentar que a lista deve ser curta, e manter o fallback legado só quando o erro for `Bad hmac value`.
- **Erros mascarados:** ao tentar várias senhas, o erro final pode vir da última tentativa e esconder um erro mais relevante (por exemplo, expiração ou selo malformado). Mitigação: só avançar para a próxima senha em falha de verificação de HMAC; propagar os demais erros imediatamente.
- **Senha antiga vazada:** manter uma senha antiga na lista mantém aceitos os cookies forjados com ela. Mitigação: documentar que a lista deve ser enxuta e temporária.
- **Regressão por mudança de tipo:** código e testes que leem `config.password` como `string` quebram o typecheck. Mitigação: normalizar a lista em um único ponto interno.
- **Reselagem inesperada:** a reselagem de RF-04 emite `Set-Cookie` em requisições de leitura. Mitigação: ocorre só uma vez por sessão rotacionada e só para cookies, o mesmo mecanismo já usado para sessões legadas.
