# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta) e contrato `sdd/pedido.md`.

## Problema e objetivo

Hoje `SessionConfig.password` aceita uma única string (`src/utils/session.ts`). Ao rotacionar o segredo, trocar essa string invalida todas as sessões seladas com a senha anterior: o usuário é desconectado sem aviso e precisa entrar de novo.

**Objetivo:** permitir que `password` receba uma lista não vazia de senhas. A primeira senha sela as sessões novas; as demais servem apenas para abrir sessões seladas antes da rotação. Com uma senha só, o comportamento permanece igual ao atual.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

`SessionConfig.password` passa a aceitar `string | string[]`. Uma string continua valendo como hoje.

**Critério de aceite**
- **Dado** uma configuração com `password: ["senha-nova-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`,
- **Quando** `useSession` ou `getSession` é chamado com essa configuração,
- **Então** a chamada é aceita sem erro de tipo nem de execução.

### RF-02 — Selar sempre com a primeira senha

Ao gravar uma sessão, a selagem usa somente o primeiro item da lista.

**Critério de aceite**
- **Dado** uma lista `[A, B]` de senhas válidas,
- **Quando** uma sessão é gravada com `updateSession` ou `useSession`,
- **Então** o cookie selado abre com `A` e não abre com `B`.

### RF-03 — Abrir sessões com qualquer senha da lista

Ao ler uma sessão, a desselagem tenta as senhas na ordem da lista e aceita a primeira que validar.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `B` e a configuração `[A, B]`,
- **Quando** `getSession` lê essa sessão a partir do cookie,
- **Então** a sessão é retornada com seus dados e `id` originais.

### RF-04 — Sessão selada com senha que não está na lista

Se nenhuma senha da lista abrir o cookie, o comportamento é o atual para cookie inválido: a requisição recebe uma sessão nova, sem erro.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `C`, que não está na configuração `[A, B]`,
- **Quando** `getSession` lê essa sessão,
- **Então** a sessão retornada tem `id` diferente do cookie original, sem `data` herdado e sem lançar exceção.

### RF-05 — Compatibilidade com senha única

Uma string continua funcionando exatamente como hoje, incluindo o fallback de selo legado (`legacySealFallback`) e a validação de tamanho.

**Critério de aceite**
- **Dado** uma configuração com `password` como string, como nas versões atuais,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes passam sem alteração de resultado.

### RF-06 — Validação da lista

Lista vazia é rejeitada. Cada senha da lista passa pela mesma validação de tamanho mínimo (32 caracteres) que a string única hoje, e uma senha inválida na lista falha com erro explícito.

**Critério de aceite**
- **Dado** `password: []`,
- **Quando** `useSession` ou `getSession` é chamado,
- **Então** a chamada lança erro indicando que a lista de senhas está vazia.

- **Dado** `password: ["senha-curta", "senha-valida-com-32-caracteres-ou-mais"]`,
- **Quando** a sessão é lida ou gravada,
- **Então** a chamada lança erro de senha curta, como ocorre com a string única.

### RF-07 — Nenhum nome público novo

A mudança não cria novas opções, funções exportadas nem tipos públicos além da ampliação de `password`.

**Critério de aceite**
- **Dado** o diff da mudança,
- **Quando** o conjunto de exports de `src/utils/session.ts` e `src/index.ts` é comparado com o anterior,
- **Então** a única diferença é o tipo aceito por `SessionConfig.password`.

### RF-08 — Qualidade do projeto

**Critério de aceite**
- **Dado** a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos passam, e os testes de sessão cobrem RF-02 a RF-06 nos modos `web` e `node`.

## Fora de escopo

- Regravar automaticamente, na leitura, sessões abertas com senha antiga. Elas são migradas só quando forem gravadas de novo pelo fluxo já existente.
- Identificar a senha usada pelo cookie (por exemplo, gravar um `kid` no selo). A tentativa é sequencial.
- Mudanças nos objetos `Password` com `id` do `iron-crypto` (`src/utils/internal/iron-crypto.ts`).
- Rotação automática, agendada ou por tempo de vida de senhas.
- Alterar `maxAge`, `idleTimeout`, `cookie` ou o formato do cookie.
- Mudanças em `h3/rules`, `ocache` ou em outros módulos que não usam `SessionConfig`.

## Premissas

- `password` é usado somente pelas funções de sessão de `src/utils/session.ts` (`useSession`, `getSession`, `updateSession`, `sealSession`, `unsealSession`). **A confirmar** com busca no repositório antes da implementação.
- Hoje a senha única é validada por `generateKey` (tamanho mínimo, padrão 32 caracteres); assume-se que a mesma validação pode ser reaproveitada para cada item da lista.
- O fallback de selo legado (1 iteração PBKDF2) continua valendo para cada senha da lista, como hoje para a senha única.
- Os testes existentes em `test/` cobrem sessões com string única; novos testes seguem o padrão `describeMatrix`.

## Riscos

- **Custo de CPU em cookies inválidos.** Cada senha extra pode gerar uma derivação PBKDF2 (8192 iterações por padrão) quando o cookie não abre. Com o fallback legado, o número de tentativas dobra. Um cliente que envie cookies falsos força essas derivações em toda requisição. Possível mitigação: limitar o tamanho da lista e decidir isso antes da implementação.
- **Senha antiga válida por tempo indeterminado.** Enquanto a senha antiga estiver na lista, as sessões seladas com ela continuam abertas. Ela só pode sair da lista depois que o maior tempo de vida das sessões (`maxAge` ou `idleTimeout`) tiver passado, sem sessões antigas ativas.
- **Ordem da lista.** Trocar a ordem por engano faz com que sessões novas sejam seladas com a senha antiga. Vale documentar a regra e, se possível, validar no tipo ou em tempo de execução.
- **Quebra de tipo para código do usuário.** Quem lê `config.password` como string em código próprio deixa de compilar. Mitigação: checar usos no repositório e documentar a mudança.
- **Confusão com o formato `Password` do `iron-crypto`.** A lista de strings não usa `id`. Se o selo gravar um `id` vazio para todas as senhas, a desselagem precisa tentar cada uma em ordem, e isso deve ser coberto por teste.
