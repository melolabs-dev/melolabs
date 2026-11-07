# PRD: várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` / `getSession` em `src/utils/session.ts` selam e abrem cookies com uma única senha, `SessionConfig.password`. Ao trocar essa senha (rotação de segredo), todas as sessões já emitidas deixam de abrir e o usuário é deslogado de uma vez.

O objetivo é permitir a rotação sem derrubar sessões: a senha atual continua selando as sessões novas, e uma lista de senhas anteriores continua abrindo as sessões antigas. Conforme a primeira alternativa da issue #1050, a configuração ganha um campo novo, `extraUnsealPasswords`, em vez de transformar `password` em array.

## Requisitos funcionais

### RF-01 — Abrir sessões seladas com uma senha extra

A sessão selada com uma senha da lista `extraUnsealPasswords` deve ser lida normalmente, com o mesmo `id`, `createdAt` e `data` que tinha.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, e um cookie de sessão selado com `"antiga"` e com `data: { user: 1 }`,
- **Quando** `getSession(event, config)` é chamado na requisição,
- **Então** o retorno tem o mesmo `id` do cookie e `data.user === 1`.

### RF-02 — Selar sempre com a senha atual

Toda gravação de sessão deve selar com `password`, nunca com uma senha extra.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** `updateSession(event, config, { user: 1 })` é chamado,
- **Então** o cookie gravado abre com `"nova"` e não abre com `"antiga"`.

### RF-03 — Comportamento inalterado sem senhas extras

Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento deve ser idêntico ao atual, inclusive para cookies selados com outra senha.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords` e um cookie selado com `"antiga"`,
- **Quando** `getSession(event, config)` é chamado,
- **Então** é criada uma sessão nova (`id` diferente do cookie), sem erro lançado, como hoje.

### RF-04 — Senha desconhecida continua gerando sessão nova

Se nenhuma das senhas (atual ou extras) abre o cookie, a leitura deve cair no caminho atual de sessão nova, sem propagar erro.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, e um cookie selado com `"desconhecida"`,
- **Quando** `getSession(event, config)` é chamado,
- **Então** é retornada uma sessão nova com `data` vazio e nenhuma exceção é lançada.

### RF-05 — Expiração vale para sessões abertas com senha extra

Uma sessão aberta com senha extra deve ser recusada se estiver expirada por `maxAge` ou `idleTimeout`, da mesma forma que uma sessão aberta com a senha atual. A tentativa com outra senha não pode mascarar o erro de expiração.

**Critério de aceite**
- **Dado** uma configuração com `maxAge: 3600`, `password: "nova"` e `extraUnsealPasswords: ["antiga"]`, e um cookie selado com `"antiga"` cujo `createdAt` tem mais de 3600 segundos,
- **Quando** `getSession(event, config)` é chamado,
- **Então** a sessão é tratada como expirada (sessão nova, como hoje) e o cookie antigo não é aceito.

### RF-06 — Regravação migra a sessão para a senha atual

Quando uma sessão aberta com senha extra é regravada, o cookie resultante deve estar selado com a senha atual. Assim, a lista de senhas antigas pode ser encurtada com o tempo.

**Critério de aceite**
- **Dado** um cookie selado com `"antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição lê a sessão e chama `update({ visto: true })`,
- **Então** o `Set-Cookie` resultante abre com `"nova"` e mantém o mesmo `id`.

### RF-07 — Sessões por header também abrem com senhas extras

O cabeçalho de sessão (`sessionHeader`) passa pelo mesmo caminho de abertura, então deve aceitar senhas extras da mesma forma.

**Critério de aceite**
- **Dado** uma configuração com `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e um cabeçalho `x-h3-session` selado com `"antiga"`,
- **Quando** `getSession(event, config)` é chamado,
- **Então** o `id` e o `data` do cabeçalho são retornados.

### RF-08 — Tipo público e documentação do campo

`SessionConfig` deve expor `extraUnsealPasswords?: string[]`, com JSDoc dizendo que as senhas só abrem sessões, que `password` é a única usada para selar, e que as senhas antigas devem ter a mesma entropia exigida de `password`.

**Critério de aceite**
- **Dado** o código após a mudança,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos passam, e um uso de `extraUnsealPasswords: ["..."]` em `useSession` compila sem erro de tipo.

## Fora de escopo

- `password` aceitar array (a segunda alternativa da issue). A API escolhida é o campo novo.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Ferramenta ou comando para rotacionar segredos, e rotação automática por tempo.
- Revogação individual de sessões ou lista de sessões invalidadas.
- Validação em tempo de execução do comprimento ou da entropia das senhas, inclusive de `password` (hoje não existe e não será criada aqui; a regra fica documentada).
- Mudança no formato do cookie, na versão do iron ou nos parâmetros de `seal`.
- Reselar sessões lidas do cabeçalho (hoje elas não são reseladas e isso continua assim).
- Alterações em `getSession`/`useSession` além do necessário para as senhas extras, e refatoração do fallback de selo legado (`legacySealFallback`).

## Premissas e riscos

### Premissas

- A ordem de tentativa é: `password` primeiro, depois cada item de `extraUnsealPasswords` na ordem da lista. Na primeira que abrir, a tentativa para.
- O fallback legado de 1 iteração PBKDF2 (`legacySealFallback`) continua valendo. Ele é aplicado a cada senha da lista, antes de passar para a próxima.
- O erro de HMAC (`"Bad hmac value"`, usado hoje para decidir o fallback legado) é o sinal para tentar a próxima senha. Qualquer outro erro, inclusive `"Session expired!"`, é propagado da mesma forma que hoje.
- O `session.ts` atual não valida o comprimento de `password`. Assume-se que as senhas extras não terão validação nova; a exigência fica só na documentação.
- Os testes seguem o padrão `describeMatrix` (web e node), conforme `AGENTS.md`.

### Riscos

- **Custo de CPU (amplificação):** cada senha extra que não abre o cookie gera mais uma rodada de PBKDF2. Um cookie inválido passa a custar até `1 + N` derivações (mais o fallback legado, se aplicável). Uma lista longa aumenta o custo de requisições com cookie falso. Mitigação sugerida: documentar que a lista deve ser curta e temporária.
- **Senha antiga vazada:** enquanto a senha estiver na lista, quem a conhecer consegue forjar sessões válidas. A remoção da senha antiga deve ser feita junto com a expiração do maior `maxAge`/`idleTimeout` das sessões que ela pode ter emitido.
- **Sessões que nunca são regravadas:** sem `idleTimeout`, uma sessão aberta com senha extra só migra quando for regravada. Enquanto isso, a senha antiga precisa continuar na lista.
- **Detecção por mensagem de erro:** a distinção entre "senha errada" e "outro erro" depende da string `"Bad hmac value"` do `iron`. Uma mudança de versão pode quebrar a regra. Os testes devem cobrir esse caso.
- **Ambiguidade de tentativa:** se uma senha extra e a atual abrirem o mesmo cookie (não deveria acontecer com senhas diferentes), vale a primeira da ordem. Isso não precisa de tratamento especial.
- **Compatibilidade:** o campo é opcional e o comportamento sem ele não muda, então o risco de quebra é baixo. O risco principal é de segurança, não de compatibilidade.
