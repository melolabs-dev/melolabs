# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` aceita uma única `password`, que sela e abre todas as sessões. Ao trocar essa senha (rotação de segredo), todas as sessões seladas com a senha antiga deixam de abrir e os usuários são desconectados de uma vez.

O objetivo é permitir a rotação sem invalidar sessões: o campo `password` passa a ser a única senha usada para selar, e um novo campo opcional `extraUnsealPasswords` lista senhas anteriores que apenas abrem sessões já existentes. Esta é a primeira alternativa proposta na issue h3js/h3#1050.

Restrições:

- Nenhum outro nome público novo além de `extraUnsealPasswords`.
- `password` continua sendo `string`.
- Sem `extraUnsealPasswords`, o comportamento atual não muda.
- A suíte existente continua passando. Testes existentes só são ajustados se dependerem do que a mudança altera, sem perder o que verificam.
- `pnpm lint` e `pnpm typecheck` passam.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` (`src/utils/session.ts`) passa a aceitar o campo opcional `extraUnsealPasswords: string[]`, com a documentação do que é e de que só serve para abrir sessões.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o tipo da configuração é verificado pelo TypeScript,
- **Então** a configuração é aceita sem erro de tipo, e uma configuração sem o campo continua válida.

### RF-02 — Abrir sessões com a senha atual ou com as extras

Ao abrir uma sessão selada, o sistema tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem da lista, e usa a primeira senha que validar a sessão.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `A`, e uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- **Quando** a sessão é lida com `useSession` ou `getSession` em uma requisição que traz o cookie,
- **Então** a sessão é carregada com os mesmos dados que tinha, e nenhum erro é lançado.

### RF-03 — Selar sempre com `password`

Novas sessões e sessões regravadas são seladas somente com `password`. Senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- **Quando** uma sessão nova é criada e selada,
- **Então** o cookie resultante abre com `B` e não abre com `A` (por exemplo, `unseal` com somente `A` lança erro).

### RF-04 — Sem senhas extras, comportamento inalterado

Quando `extraUnsealPasswords` está ausente ou vazio, o sistema se comporta exatamente como antes: mesmos cookies gerados, mesmos erros para cookies inválidos e mesmo número de tentativas de desselagem.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** um cookie selado com outra senha é apresentado,
- **Então** a sessão não é carregada e o erro é o mesmo que o atual (`Bad hmac value` em `unseal`, tratado como hoje).

### RF-05 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue as mesmas regras de `password`: não pode ser vazio e deve atender ao tamanho mínimo de senha usado pelo iron. Um item inválido gera erro com mensagem clara, e não é ignorado em silêncio.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords: [""]`,
- **Quando** uma sessão é selada ou aberta com essa configuração,
- **Então** o sistema lança erro (por exemplo, `Empty password`), e não tenta abrir a sessão sem essa senha.

### RF-06 — Expiração continua valendo com qualquer senha

`maxAge` e `idleTimeout` são verificados da mesma forma, independentemente de a sessão ter sido aberta com `password` ou com uma senha extra.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `A`, aberta com `password: B` e `extraUnsealPasswords: [A]`, e um `maxAge` já vencido,
- **Quando** a sessão é lida,
- **Então** o sistema lança `Session expired!`, como faria para uma sessão aberta com a senha atual.

### RF-07 — Compatibilidade com o fallback de selo legado

O fallback de selo legado (`legacySealFallback`, 1 iteração PBKDF2) continua funcionando quando há senhas extras: uma sessão legada selada com uma senha extra também abre.

**Critério de aceite**

- **Dado** uma sessão selada com a senha extra `A` usando 1 iteração PBKDF2, e uma configuração com `password: B`, `extraUnsealPasswords: [A]` e `legacySealFallback` não desabilitado,
- **Quando** a sessão é lida,
- **Então** a sessão é carregada, e o selo legado é sinalizado como hoje.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050).
- Escolher a senha de selagem por rotação automática, por data ou por ID de senha.
- Regravação obrigatória ou em massa de sessões antigas (ver premissas).
- Remover ou alterar `legacySealFallback`. A remoção está prevista para a v3.
- Novos métodos públicos, novas opções fora de `extraUnsealPasswords` ou alterações em `sealSession`/`unsealSession` além do necessário para os requisitos acima.
- Mudanças no formato do cookie, nos chunks ou no header de sessão.
- Documentação extensa fora do JSDoc do campo.

## Premissas e riscos

### Premissas

- A ordem de tentativa é `password` primeiro e depois `extraUnsealPasswords` na ordem dada. Não há busca por ID de senha no selo.
- A sessão aberta com uma senha extra continua válida até expirar. Ela só passa a usar `password` se o caminho de regravação existente (`getSession`) a regravar; isso precisa ser verificado no código antes da implementação. Se não for regravada, a rotação só termina quando a sessão expirar ou quando o usuário fizer login de novo.
- Os testes existentes em `test/session.test.ts` usam o padrão `describeMatrix`, e os novos testes seguem o mesmo padrão.

### Riscos

- **Custo de CPU:** cada tentativa de desselagem deriva chaves com PBKDF2 (8192 iterações por padrão). Com várias senhas extras, uma sessão antiga ou um cookie inválido custa uma tentativa por senha. Isso aumenta latência e uso de CPU, e pode ser usado como vetor de negação de serviço. Mitigação: manter a lista curta e documentar isso no JSDoc.
- **Combinação com o fallback legado:** o fallback repete a desselagem com 1 iteração. Com senhas extras, o número de tentativas pode dobrar. É preciso testar essa combinação.
- **Segurança das senhas antigas:** senhas que continuam na configuração continuam válidas para abrir sessões. Quem tiver uma sessão roubada antes da rotação ainda pode usá-la até ela expirar. Isso deve ser explicado na documentação.
- **Esquecer a senha extra:** se a senha antiga for removida cedo demais, as sessões que dependem dela são invalidadas. Isso é esperado, mas precisa estar documentado.
- **Erro de digitação silencioso:** sem validação (RF-05), uma senha extra errada apenas nunca abre sessões. A validação de tamanho e de vazio reduz esse risco, mas não o elimina.
