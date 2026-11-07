# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa), contrato #1050-b em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje cada sessão é selada com uma única senha, `SessionConfig.password` (`src/utils/session.ts:48`). Ao trocar essa senha, todas as sessões seladas com a senha anterior deixam de abrir: `unsealSession` falha (`src/utils/session.ts:324`) e `getSession` engole o erro (`src/utils/session.ts:197`). Na prática, os usuários são desconectados sem aviso.

### Objetivo

Permitir que a senha seja trocada sem invalidar sessões existentes. A configuração ganha uma lista de senhas anteriores, `extraUnsealPasswords`, que só servem para abrir sessões. Quem sela continua sendo sempre `password`.

## Requisitos funcionais

### RF-01 — Abrir sessões com as senhas extras

O sistema tenta abrir o cookie ou o header de sessão com `password` e, se falhar, com cada item de `extraUnsealPasswords`, na ordem da lista. Usa a primeira senha que valida.

**Critério de aceite:**
- Dado uma sessão selada com a senha `A`, e uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- Quando a sessão é lida com `getSession` (por cookie ou por header),
- Então os dados da sessão são carregados normalmente.

### RF-02 — Selar sempre com `password`

Toda sessão nova ou regravada é selada somente com `password`. As senhas extras nunca são usadas para selar.

**Critério de aceite:**
- Dado uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- Quando `updateSession` grava dados na sessão,
- Então o cookie resultante abre com `B` e não abre com `A`.

### RF-03 — Sessões sealed com a senha extra migram ao serem resealadas

Quando uma sessão aberta com uma senha extra é resealada pelo fluxo que já existe (deslizamento de `idleTimeout` ou reselagem de cookie legado), o novo cookie usa `password`.

**Critério de aceite:**
- Dado uma sessão selada com `A`, lida com `password: B`, `extraUnsealPasswords: [A]` e `idleTimeout` configurado, depois de passar metade da janela ociosa,
- Quando a sessão é lida novamente,
- Então o cookie enviado na resposta abre com `B`.

### RF-04 — Compatível com o fallback de selagem legada

O fallback de 1 iteração PBKDF2 (`src/utils/session.ts:340`) funciona também para sessões abertas com uma senha extra. A sessão é aberta e resealada com `password`.

**Critério de aceite:**
- Dado uma sessão legada (1 iteração) selada com `A`, e `extraUnsealPasswords: [A]`,
- Quando a sessão é lida,
- Então os dados são carregados e o cookie de resposta usa `password` com as opções atuais.

### RF-05 — Sem senhas extras, o comportamento não muda

Quando `extraUnsealPasswords` está ausente ou vazio, as sessões se comportam exatamente como hoje. A suíte existente passa sem alterações nos testes que não dependem da nova opção.

**Critério de aceite:**
- Dado uma configuração sem `extraUnsealPasswords`,
- Quando uma sessão selada com outra senha é lida,
- Então a sessão é tratada como inválida, como acontece hoje, e `pnpm vitest run test/session.test.ts` continua passando.

### RF-06 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue as mesmas regras de `password`. Uma senha extra inválida não pode ser ignorada em silêncio.

**Critério de aceite:**
- Dado uma configuração com um item de `extraUnsealPasswords` vazio ou abaixo do tamanho mínimo aceito por `password`,
- Quando `useSession` ou `getSession` é chamado,
- Então a chamada lança um erro que indica a senha extra inválida, sem tentar abrir o cookie.

### RF-07 — Tipo público

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com documentação em JSDoc. Nenhum outro nome público novo é criado.

**Critério de aceite:**
- Dado código TypeScript que passa `extraUnsealPasswords: ["senha-antiga"]` em `useSession`,
- Quando `pnpm typecheck` roda,
- Então a verificação passa, e passar um valor que não seja `string[]` gera erro de tipo.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050).
- Identificadores de senha (`id` do iron) e rotação automática de chaves.
- Remover ou alterar o fallback de selagem legada (previsto para v3).
- Mudar o formato do cookie, o algoritmo de selagem ou os padrões de `seal`.
- Ferramenta ou endpoint para reselar em massa as sessões existentes.
- Revogação de sessões antigas. Remover uma senha extra invalida as sessões seladas com ela, mas isso é decisão de quem configura.
- Mudanças em `src/utils/cookie.ts` ou em outros módulos além de `session.ts` e dos tipos ligados a ele.

## Premissas e riscos

### Premissas

- A lista de senhas extras vem da configuração do servidor, não de dados do usuário.
- A troca de senha serve para continuidade, não para revogação imediata.
- As opções `seal` valem igualmente para `password` e para as senhas extras.
- Sessões lidas pelo header (`sessionHeader`) não são resealadas. Elas continuam abertas com a senha antiga até expirar. Isso é aceito e deve ficar documentado.
- Os testes existentes em `test/session.test.ts` seguem como base. Só são ajustados se a mudança alterar o que eles verificam, sem perder a verificação.

### Riscos

- **Custo de CPU.** Cada tentativa de abrir o cookie roda PBKDF2. Com N senhas extras, um cookie inválido custa até N+1 tentativas, e o fallback legado dobra esse número. Mitigação: documentar um limite prático de senhas extras e manter `password` como primeira tentativa.
- **Falha silenciosa.** `getSession` engole erros de unseal (`src/utils/session.ts:197`). Uma senha extra mal digitada faria os usuários parecerem desconectados. Mitigação: RF-06 e um teste que cubra a senha inválida.
- **Sessões por header não migram.** Como essas sessões não são resealadas, a senha antiga continua aceita por mais tempo do que o esperado. Mitigação: documentar e cobrir com teste.
- **Erro de digitação na senha nova.** Se `password` for trocada por engano, as sessões novas não abrem com a senha antiga, que ficou em `extraUnsealPasswords`. Mitigação: nada no código; é responsabilidade de quem configura.
- **Quebra de tipo.** O campo é aditivo e opcional, então o risco é baixo. Mesmo assim, `pnpm lint` e `pnpm typecheck` precisam passar.
