# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta), contrato em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `getSession` (`src/utils/session.ts`) aceitam uma única `password` de `SessionConfig`. Ela sela e abre todas as sessões. Ao trocar essa senha por rotação de segredo, todas as sessões seladas com a senha anterior passam a falhar na leitura: `unsealSession` lança e `getSession` trata o erro como sessão inexistente. Na prática, todos os usuários logados são deslogados no momento da troca.

### Objetivo

Permitir que, ao trocar a senha, as sessões seladas com senhas anteriores continuem válidas até expirarem. A senha atual continua sendo a única usada para selar. As anteriores servem apenas para abrir. A configuração é feita por um campo novo, `extraUnsealPasswords`, sem outros nomes públicos novos e sem quebrar o comportamento atual quando o campo não é usado.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado por JSDoc como senhas anteriores que só abrem sessões. `password` continua sendo `string`.

**Critério de aceite:**
- Dado uma configuração com `extraUnsealPasswords: ["senha-antiga-com-32-caracteres-ou-mais"]`,
- Quando a configuração é usada em `useSession` ou `getSession`,
- Então o código compila sem erro de tipo e o campo é aceito como `string[]` opcional.

### RF-02 — Leitura tenta a senha atual e depois as extras, em ordem

Ao abrir uma sessão, a leitura tenta `password` primeiro e, em seguida, cada entrada de `extraUnsealPasswords` na ordem declarada. A primeira senha que abre o selo (HMAC válido) é usada.

**Critério de aceite:**
- Dado uma sessão selada com a senha `A` e uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- Quando a sessão é lida,
- Então `getSession` retorna a sessão com os dados originais e `id` preservado.

### RF-03 — Selagem usa sempre `password`

Nenhuma selagem usa as senhas de `extraUnsealPasswords`. Toda sessão nova ou regravada é selada com `password`.

**Critério de aceite:**
- Dado uma configuração com `password: B` e `extraUnsealPasswords: [A]`,
- Quando uma sessão é criada ou escrita com `updateSession`,
- Então o cookie resultante só abre com `B` e não abre com `A`.

### RF-04 — Sem senhas extras, o comportamento não muda

Quando `extraUnsealPasswords` está ausente ou vazio, a leitura, a selagem e o fallback legado (`legacySealFallback`) se comportam exatamente como hoje.

**Critério de aceite:**
- Dado uma configuração sem `extraUnsealPasswords`,
- Quando uma sessão selada com outra senha é lida,
- Então ela é tratada como inválida, como acontece na versão atual, e a suíte existente passa sem alterações de expectativa.

### RF-05 — Vale para cookie e para header de sessão

A tentativa com senhas extras acontece em qualquer caminho que abre sessão: cookie (`getChunkedCookie`) e header (`sessionHeader`).

**Critério de aceite:**
- Dado uma sessão selada com a senha antiga enviada no header `x-h3-session` (ou o nome configurado em `sessionHeader`),
- Quando a requisição chega com `extraUnsealPasswords` contendo essa senha,
- Então `getSession` abre a sessão a partir do header.

### RF-06 — Expiração continua valendo para sessões abertas com senha extra

`maxAge` e `idleTimeout` são aplicados da mesma forma a uma sessão aberta com senha extra. Uma senha extra não estende a vida da sessão.

**Critério de aceite:**
- Dado uma sessão selada com a senha antiga, cujo `createdAt` ultrapassa `maxAge`,
- Quando a sessão é lida com `extraUnsealPasswords` contendo a senha antiga,
- Então a sessão é tratada como expirada e não é retornada com dados.

### RF-07 — Sessão aberta com senha extra é regravada com a senha atual

Quando uma sessão é aberta com senha extra e o cookie é regravado pela requisição (por escrita, por deslizamento de `idleTimeout` ou por fallback legado), o novo cookie é selado com `password`. Assim a rotação avança sem ação manual.

**Critério de aceite:**
- Dado uma sessão selada com a senha antiga e uma configuração com `idleTimeout` já vencido pela metade,
- Quando a sessão é lida e regravada pela requisição,
- Então o `Set-Cookie` resultante abre com a senha atual e não abre com a antiga.

### RF-08 — Senha extra inválida não vira sessão inválida em silêncio

Uma entrada de `extraUnsealPasswords` com menos caracteres que o mínimo do selo (`seal.encryption.minPasswordlength`, padrão 32) é um erro de configuração. Ela não pode fazer todas as sessões caírem sem aviso.

**Critério de aceite:**
- Dado uma configuração com `extraUnsealPasswords: ["curta"]`,
- Quando uma sessão é lida,
- Então a leitura lança erro explícito de configuração, identificando o problema, em vez de retornar uma sessão vazia como se o cookie fosse inválido.

## Fora de escopo

- `password` como array (a segunda alternativa da issue). O contrato escolhe o campo novo.
- Identificadores de senha do iron (`passwordId`) no cookie ou na seleção de senha. Senhas são tentadas em ordem, sem IDs.
- Rotação automática, agendada ou por tempo. Quem configura remove a senha antiga da lista quando julgar seguro.
- Forçar a regravação de todas as sessões de uma vez (migração em massa ou API para isso).
- Mudar algoritmo, iterações PBKDF2 ou o fallback legado de 1 iteração. Remover `legacySealFallback` continua previsto só para v3.
- Mudanças em `cookie.ts`, na assinatura pública de `getSession` / `useSession` / `updateSession` além do campo novo.
- Documentação fora do JSDoc de `SessionConfig` (site de docs, guias).

## Premissas

- A senha atual é sempre a primeira tentada e a única que sela. As extras nunca são usadas para selar.
- Senhas seguem a mesma regra de hoje: entropia alta e gerada por fonte criptográfica, com no mínimo 32 caracteres.
- A lista de senhas extras é pequena (uma a três). Cada tentativa custa uma derivação PBKDF2 com 8192 iterações.
- A expiração já é verificada depois da abertura do selo, por `createdAt` ou `lastSeenAt`. Ela é a mesma para qualquer senha.
- O fallback legado de 1 iteração é aplicado a cada senha tentada, com o mesmo comportamento de hoje.
- Os testes existentes podem ser ajustados só onde a mudança altera o que eles verificam, sem perder a verificação original (restrição do contrato).

## Riscos

- **Desconexão silenciosa por configuração errada.** `getSession` engole erros de `unsealSession` (`.catch(() => {})`). Uma senha extra malformada ou errada pode deslogar todo mundo sem nenhum sinal. Mitigação: RF-08 e testes de erro explícito.
- **Amplificação de CPU.** Um cookie forjado ou sem chave válida força uma tentativa por senha extra. Cada uma custa uma derivação PBKDF2 de 8192 iterações. Com três extras, uma requisição vira até quatro derivações. Mitigação: limitar a lista na documentação e manter a ordem de tentativas curta.
- **Erro de expiração disparando nova tentativa.** Se "Session expired!" ou "Expired seal" for capturado no laço de tentativas, a implementação pode gastar tentativas à toa ou mascarar o motivo real. A verificação de expiração deve ficar fora do laço.
- **Rotação incompleta.** Sessões inativas que não são regravadas continuam com a senha antiga até expirar. Se o usuário remover a senha antiga antes de `maxAge`/`idleTimeout` vencerem, essas sessões caem. Mitigação: documentar que a senha antiga deve ficar na lista pelo menos pelo tempo de vida máximo das sessões.
- **Senha antiga parada em configuração.** Manter chaves antigas indefinidamente aumenta a superfície de vazamento. Não há mecanismo de descarte neste escopo.
- **Ordem de tentativa e tempo constante.** Tentar senhas em sequência pode revelar, pelo tempo de resposta, qual senha da lista abriu a sessão. O impacto é pequeno, porque o atacante já precisa do cookie, mas precisa ser considerado na revisão de segurança.
