# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## 1. Problema e objetivo

### Problema
Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita uma única `string`, usada tanto para selar quanto para abrir a sessão. Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de ser abertas e os usuários perdem a sessão de uma vez. A issue h3js/h3#1050 pede uma forma de continuar honrando sessões antigas durante a rotação.

### Objetivo
Permitir que `password` seja `string | string[]` (lista não vazia). Na lista, a primeira senha sela e as demais só abrem sessões. Assim a rotação é feita acrescentando a senha nova na frente e mantendo as antigas atrás, sem invalidar sessões existentes. Esta é a segunda alternativa proposta na issue.

### Métricas de sucesso
- Sessões seladas com uma senha antiga continuam sendo lidas após a rotação.
- Nenhuma mudança de comportamento para quem usa uma única `string`.
- Nenhum nome público novo além do alargamento do tipo de `password`.

## 2. Requisitos funcionais

### RF-01 — `password` aceita string ou lista não vazia
`SessionConfig.password` passa a ter o tipo `string | string[]`. Uma `string` continua valendo como hoje.

**Critério de aceite**
- **Dado** uma configuração de sessão com `password: "senha"` (string)
- **Quando** uma sessão é criada e lida em requisições seguintes
- **Então** o comportamento é idêntico ao atual, sem exigir mudança no código do usuário.

### RF-02 — A primeira senha da lista sela
Ao selar a sessão (cookie de resposta, `sealSession` e equivalentes), usa-se somente a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: ["nova", "antiga"]`
- **Quando** uma sessão é criada e o valor selado é gerado
- **Então** o valor selado só pode ser aberto com `"nova"` e não com `"antiga"` isoladamente.

### RF-03 — Senhas seguintes abrem sessões antigas
Ao abrir a sessão, tenta-se cada senha da lista, em ordem, até uma funcionar. As demais senhas servem apenas para abrir.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e a configuração `password: ["nova", "antiga"]`
- **Quando** a requisição chega com esse cookie (ou header de sessão)
- **Então** a sessão é aberta com os dados originais, sem erro e sem ser tratada como nova.

### RF-04 — Falha quando nenhuma senha serve
Se nenhuma senha da lista abrir o valor selado, a sessão é tratada como inválida, como já ocorre com senha errada hoje (sessão descartada e substituída por uma nova, sem vazar detalhes da senha).

**Critério de aceite**
- **Dado** uma sessão selada com `"outra"` e `password: ["nova", "antiga"]`
- **Quando** a requisição chega com esse cookie
- **Então** a sessão não é aceita e o fluxo é o mesmo de uma sessão inválida atual.

### RF-05 — Lista vazia é rejeitada
`password` como array vazio é configuração inválida e deve falhar de forma explícita, em vez de selar com senha indefinida.

**Critério de aceite**
- **Dado** `password: []`
- **Quando** a sessão é lida ou selada
- **Então** é lançado um erro claro indicando que ao menos uma senha é obrigatória.

### RF-06 — Regras de expiração e fallback legado preservadas
A tentativa com várias senhas não altera as validações de `maxAge`, `idleTimeout` nem o fallback de seal legado (`legacySealFallback`, 1 iteração PBKDF2). O fallback legado também vale para senhas antigas da lista.

**Critério de aceite**
- **Dado** uma sessão expirada selada com uma senha antiga da lista
- **Quando** a requisição chega com esse cookie
- **Então** ela é rejeitada com "Session expired!", igual ao caso de senha única.

### RF-07 — `useSession` e demais utilitários aceitam a lista
`useSession`, `getSession`, `updateSession`, `clearSession`, `sealSession` e `unsealSession` funcionam com `string[]` sem novos parâmetros ou nomes públicos.

**Critério de aceite**
- **Dado** `useSession(event, { password: ["nova", "antiga"] })`
- **Quando** `session.update(...)` é chamado após abrir uma sessão selada com `"antiga"`
- **Então** o cookie reemitido é selado com `"nova"` e os dados anteriores são mantidos.

### RF-08 — Testes e qualidade
Há testes cobrindo RF-01 a RF-07, a suíte existente continua passando (ajustando só testes que dependam do que mudou, sem perder o que verificam), e `pnpm lint` e `pnpm typecheck` passam.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos terminam sem falhas.

## 3. Fora de escopo
- Parâmetro separado como `extraUnsealPasswords` (primeira alternativa da issue).
- Qualquer outro nome público novo (funções, opções, tipos exportados).
- Mudança de algoritmo de selagem, iterações PBKDF2 ou formato do cookie.
- Mecanismo de rotação automática de segredos ou gestão de chaves.
- Alterações em `requireBasicAuth`/`basicAuth` (`src/utils/auth.ts`), que usam outro conceito de senha.
- Mudança de comportamento de sessões com uma única senha.

## 4. Premissas e riscos

### Premissas
- A ordem da lista é significativa: a primeira sela, as demais só abrem.
- O tamanho da lista é pequeno (poucas rotações), então tentar cada senha em sequência é aceitável.
- `password` é lido em `src/utils/session.ts` (selagem em `sealSession`, abertura em `unsealSession`); outros pontos de `password` no código (`src/types/context.ts`, `src/utils/auth.ts`, `src/utils/internal/iron-crypto.ts`) serão verificados na implementação.

### Riscos
- **Custo de CPU:** cada tentativa falha faz PBKDF2 (8192 iterações) e, somada ao fallback legado, uma requisição com sessão inválida pode custar até 2 × N derivações. Mitigação: manter a lista curta e documentar.
- **Mensagem de erro:** o fallback legado depende de `error.message === "Bad hmac value"`. Ao iterar senhas é preciso distinguir "senha errada" de outros erros (ex.: expiração do seal) para não mascarar falhas reais nem repropagar o erro da senha errada.
- **Reselagem:** sessões abertas com senha antiga só migram para a nova ao serem resseladas (`update`/nova resposta). Sessões que nunca são atualizadas seguem dependendo da senha antiga. Definir na implementação se `getSession` reseala automaticamente, como já faz no caso legado.
- **Tipagem:** alargar o tipo pode quebrar código que lê `config.password` como `string` (consumidores internos e testes); o `typecheck` deve cobrir isso.
- **Senha antiga vazada:** manter senhas antigas na lista amplia a janela de exposição; remover da lista quando o tempo de vida das sessões antigas passar.
