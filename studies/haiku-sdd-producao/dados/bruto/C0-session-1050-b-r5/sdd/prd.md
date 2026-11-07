# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

### Problema
Hoje `SessionConfig.password` é a única senha usada para selar e abrir sessões (`src/utils/session.ts`). Ao rotacionar o segredo, todas as sessões já emitidas com a senha anterior deixam de abrir (`unsealSession` falha e `getSession` cria uma sessão nova). Na prática, todos os usuários perdem a sessão no momento da troca, o que desencoraja a rotação periódica de segredos.

### Objetivo
Permitir que a rotação de senha seja feita sem invalidar sessões existentes. Um campo opcional novo, `SessionConfig.extraUnsealPasswords: string[]`, lista senhas anteriores que **só abrem** sessões. `password` continua sendo uma string e continua sendo a única senha que sela. Sem senhas extras, o comportamento é idêntico ao atual.

### Métricas de sucesso
- Uma sessão selada com a senha antiga é aceita após a rotação, desde que a senha antiga esteja em `extraUnsealPasswords`.
- Nenhuma regressão na suíte existente; `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Novo campo `extraUnsealPasswords` em `SessionConfig`
`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, documentado com TSDoc (só abre sessões; nunca sela; mesma exigência de entropia e mínimo de 32 caracteres de `password`). Nenhum outro nome público novo é criado.

**Critério de aceite**
- **Dado** uma configuração `{ password, extraUnsealPasswords: ["senha-antiga..."] }`
- **Quando** ela é passada a `useSession`, `getSession`, `updateSession`, `sealSession` ou `unsealSession`
- **Então** o código compila em TypeScript estrito sem erros de tipo, e o campo é opcional (configurações sem ele continuam válidas).

### RF-02 — Unseal tenta `password` primeiro e depois as senhas extras
Ao abrir uma sessão selada, `unsealSession` tenta primeiro `password` e, se a verificação de integridade falhar, tenta cada item de `extraUnsealPasswords` na ordem informada, parando na primeira que funcionar. Vale para sessões vindas de cookie e do header de sessão.

**Critério de aceite**
- **Dado** uma sessão selada com a senha A e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** uma requisição com essa sessão chama `getSession` ou `useSession`
- **Então** os dados e o `id` da sessão original são recuperados, sem criar uma sessão nova.

### RF-03 — Selagem usa somente `password`
`sealSession` e `updateSession` selam sempre com `password`, nunca com uma senha extra.

**Critério de aceite**
- **Dado** uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** a sessão é gravada com `updateSession` e o cookie resultante é aberto com uma configuração que só tem `password: B`
- **Então** o cookie abre com sucesso e não abre com uma configuração que só tem `password: A`.

### RF-04 — Sessão aberta com senha extra é regravada com a senha atual
Quando a sessão vem de cookie e foi aberta com uma senha extra, `getSession` a regrava com `password`, para que a migração aconteça sozinha e as senhas antigas possam ser removidas depois. Sessões abertas pela senha atual não são regravadas por esse motivo (sem custo extra no caso comum). Sessões vindas do header, que não podem ser regravadas, não geram `Set-Cookie`.

**Critério de aceite**
- **Dado** uma sessão em cookie selada com a senha A e uma configuração com `password: B` e `extraUnsealPasswords: [A]`
- **Quando** a requisição chama `getSession`
- **Então** a resposta traz `Set-Cookie` com a sessão selada com B, que abre com uma configuração que só tem `password: B`; e, com uma sessão selada com B, nenhum `Set-Cookie` é emitido por esse motivo.

### RF-05 — Senha desconhecida continua sendo rejeitada
Uma sessão selada com uma senha que não é `password` nem consta em `extraUnsealPasswords` é tratada como inválida, igual hoje: ignorada e substituída por uma sessão nova. Quando todas as tentativas falham, o erro propagado é o da tentativa com `password`.

**Critério de aceite**
- **Dado** uma sessão selada com a senha C, ausente de `password` e de `extraUnsealPasswords`
- **Quando** a requisição chama `getSession`
- **Então** a sessão enviada é descartada e é criada uma sessão nova, com `id` diferente e sem os dados antigos.

### RF-06 — Regras de expiração e opções de seal valem para qualquer senha
`maxAge`, `idleTimeout`, `seal` e o `ttl` derivado são aplicados do mesmo jeito, qualquer que seja a senha que abriu a sessão. Uma sessão expirada não é aceita por ter sido aberta com senha extra. O fallback legado (`legacySealFallback`, 1 iteração PBKDF2) também funciona com senhas extras: uma sessão legada selada com uma senha extra é aceita e regravada com o formato e a senha atuais, e `legacySealFallback: false` a rejeita.

**Critério de aceite**
- **Dado** uma sessão selada com a senha A, com `createdAt` além de `maxAge`, e uma configuração com `extraUnsealPasswords: [A]`
- **Quando** a requisição chama `getSession`
- **Então** a sessão é tratada como expirada e substituída por uma nova, exatamente como seria com `password: A`.

### RF-07 — Compatibilidade quando o campo é omitido ou vazio
Com `extraUnsealPasswords` ausente, `undefined` ou `[]`, o comportamento e os erros de `unsealSession` não mudam, e não há tentativas adicionais de unseal.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` (e outra com `[]`)
- **Quando** a suíte existente de sessões (`test/session.test.ts` e testes relacionados) é executada
- **Então** todos os testes passam sem alteração de comportamento, e `pnpm lint` e `pnpm typecheck` passam.

### RF-08 — Testes e documentação
Testes de regressão cobrem RF-02 a RF-07 usando `describeMatrix`. Cada teste novo falha antes da implementação e passa depois. Se houver documentação de sessões em `docs/`, ela ganha uma seção curta sobre rotação de senha. Testes existentes só mudam quando dependem diretamente do que a implementação altera, sem perder o que verificam.

**Critério de aceite**
- **Dado** os testes novos escritos antes da implementação
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** os testes novos falham sem a implementação e passam com ela, e o restante da suíte continua verde.

## Fora de escopo
- Aceitar `password` como array (segunda alternativa da issue). `password` continua `string`.
- Qualquer outro nome público novo (funções, tipos, opções) além de `extraUnsealPasswords`.
- Mecanismo automático de rotação, geração de segredos ou gestão de chaves.
- Mudanças em `iron-crypto.ts`, no formato do token selado ou nas opções de `seal`.
- Alterar o suporte do fallback legado além de aplicá-lo às senhas extras (RF-06).
- Validação de tamanho mínimo ou de entropia das senhas, hoje apenas documentada para `password`.
- Mudanças em outras utilidades (`cookie`, `auth`, etc.) ou em adaptadores de runtime.

## Premissas e riscos

### Premissas
- A ordem de `extraUnsealPasswords` é a ordem de tentativa; quem rotaciona coloca primeiro as senhas mais recentes.
- O operador remove uma senha extra quando a migração termina, por exemplo depois do `maxAge` das sessões ou do prazo do cookie.
- A falha de verificação em `unseal` é distinguível de outras falhas (hoje, `Bad hmac value`), de modo que só ela dispara a próxima tentativa.

### Riscos e mitigações
- **Custo de CPU:** cada tentativa de unseal usa PBKDF2 (8192 iterações por padrão). Um cookie inválido ou forjado pode custar `1 + N` tentativas (mais as do fallback legado) por requisição, o que amplia o impacto de requisições maliciosas. Mitigação: documentar que a lista deve ser curta, tentar `password` primeiro e não tentar senhas extras para erros que não sejam de integridade (expiração, formato).
- **Combinação com o fallback legado:** a multiplicação de tentativas (senhas × iterações) pode ser mais custosa e complexa. Mitigação: definir a ordem explicitamente (por senha, com o fallback legado dentro de cada senha) e testar (RF-06).
- **Senha comprometida mantida na lista:** uma senha extra continua abrindo sessões enquanto estiver na lista, e permite forjar sessões válidas. Mitigação: TSDoc e documentação orientam a remover senhas comprometidas e a manter a lista curta.
- **Regravação em cookies de header:** sessões do header não são regravadas, então continuam dependendo da senha extra até expirarem. Mitigação: documentar.
- **Estado compartilhado:** `getSession` guarda a sessão em `event.context`; a regravação de RF-04 não pode causar dupla regravação ou condição de corrida com a de `idleTimeout`. Mitigação: reutilizar a mesma condição de regravação existente (`legacySeal || shouldSlide`) e cobrir com teste.
