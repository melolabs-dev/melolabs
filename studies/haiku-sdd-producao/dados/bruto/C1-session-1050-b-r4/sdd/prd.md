# PRD — Várias senhas de unseal nas sessões (#1050-b)

## Problema e objetivo

Hoje `useSession` / `getSession` (`src/utils/session.ts`) selam e abrem cada sessão com uma única senha, `SessionConfig.password`. Quando o time troca essa senha por rotação de segredos, todas as sessões seladas com a senha anterior deixam de abrir: os usuários são deslogados de uma vez, mesmo sem nenhum motivo de segurança para isso.

A issue h3js/h3#1050 pede que a aplicação continue aceitando sessões seladas com senhas anteriores durante a rotação. Esta variante usa a primeira alternativa proposta na issue: um campo novo em `SessionConfig`, com senhas extras que servem apenas para abrir sessões.

**Objetivo:** permitir que `SessionConfig` declare senhas anteriores (`extraUnsealPasswords`) que abrem sessões existentes, sem mudar a senha usada para selar, sem alterar o comportamento de quem não usa o campo e sem criar outros nomes públicos.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, documentado em JSDoc como senhas anteriores que só abrem sessões. `password` continua sendo `string` e continua sendo a única senha de selagem.

- **Dado** uma configuração com `password: A` e `extraUnsealPasswords: [B]`,
- **Quando** o tipo `SessionConfig` é consultado ou a configuração é passada a `useSession`,
- **Então** o campo é aceito pelo TypeScript, `password` tem tipo `string` e o campo é opcional.

### RF-02 — Abertura com a senha atual ou com qualquer senha extra

Ao abrir uma sessão, a leitura tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem declarada. A primeira senha que abre a sessão vale.

- **Dado** uma sessão selada com `B`, e a configuração `password: A` com `extraUnsealPasswords: [B]`,
- **Quando** uma requisição chega com esse cookie,
- **Então** `getSession` devolve a sessão com os dados originais, sem erro.

- **Dado** uma sessão selada com `C`, que não está na configuração,
- **Quando** uma requisição chega com esse cookie,
- **Então** a sessão é tratada como inexistente (comportamento atual para cookie inválido).

### RF-03 — Selagem sempre com `password`

Toda selagem nova (`updateSession`, `sealSession`, reseal por `idleTimeout`) usa somente `password`. Senhas extras nunca selam.

- **Dado** uma configuração com `password: A` e `extraUnsealPasswords: [B]`,
- **Quando** uma sessão é gravada,
- **Então** o cookie resultante abre com `A` e não abre com `B`.

### RF-04 — Migração: sessão aberta por senha extra é regravada com `password`

Quando uma sessão é aberta com uma senha extra e pode ser regravada (cookie, não header), a resposta inclui um novo `Set-Cookie` selado com `password`. Assim, o cookie migra para a senha atual e a senha antiga pode ser removida depois.

- **Dado** uma sessão selada com `B` vinda do cookie, e a configuração `password: A` com `extraUnsealPasswords: [B]`,
- **Quando** a requisição é processada,
- **Então** a resposta traz `Set-Cookie` com um cookie que abre com `A` e não abre com `B`.

- **Dado** a mesma sessão, mas enviada pelo header de sessão (`sessionHeader`),
- **Quando** a requisição é processada,
- **Então** a sessão abre com `B` normalmente, sem `Set-Cookie`, e continua válida até expirar.

### RF-05 — Compatibilidade sem senhas extras

Sem `extraUnsealPasswords` (ou com array vazio), o comportamento é idêntico ao atual, inclusive o fallback legado `legacySealFallback`.

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessão é executada,
- **Então** todos os testes passam sem alteração de expectativa.

### RF-06 — Senhas extras são validadas como `password`

Cada senha extra precisa atender ao mesmo requisito de `password` (tamanho mínimo de 32 caracteres, a mesma regra de `minPasswordlength` do iron). Senha vazia ou curta não pode falhar em silêncio.

- **Dado** `extraUnsealPasswords: ["curta"]`,
- **Quando** `useSession` ou `getSession` é chamado com essa configuração,
- **Então** a chamada lança erro indicando a senha extra inválida, em vez de tratar todas as sessões como inexistentes.

### RF-07 — Expiração independe da senha

`maxAge` e `idleTimeout` são verificados da mesma forma, qualquer que seja a senha que abriu a sessão.

- **Dado** uma sessão selada com `B` cujo `createdAt` excede `maxAge`,
- **Quando** é lida com `extraUnsealPasswords: [B]`,
- **Então** a sessão é rejeitada como expirada.

### RF-08 — Testes cobrem a rotação

A suíte de sessão ganha casos para: abertura com senha extra, rejeição de senha fora da lista, selagem só com a senha atual, migração via `Set-Cookie`, ausência de `Set-Cookie` no header, e validação de senha extra inválida. Os testes seguem o padrão `describeMatrix` (web e node).

- **Dado** a suíte de sessão atualizada,
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** todos os casos passam nos modos web e node.

### RF-09 — Qualidade do projeto

- **Dado** a mudança aplicada,
- **Quando** `pnpm lint` e `pnpm typecheck` são executados,
- **Então** ambos passam sem erros novos.

## Fora de escopo

- A segunda alternativa da issue: aceitar `password` como array de strings. Não será implementada.
- Mudança do formato selado (iron) ou do algoritmo de derivação.
- Rotação automática, agendada ou por tempo. Quem rotaciona continua trocando as configurações manualmente.
- Revogação ou invalidação de sessões individuais.
- Mudanças em `getSession` para o caminho de header além do que RF-04 exige (o header não é regravado).
- Remoção do fallback legado (`legacySealFallback`), que continua previsto para a v3.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Documentação fora do JSDoc do campo (por exemplo, guia de migração). Pode vir depois.

## Premissas e riscos

### Premissas

- **P1.** A ordem de tentativa é `password` e depois as extras, na ordem da lista. A primeira que abre vence. Não há prioridade por data de selagem.
- **P2.** A regravação da RF-04 vale só para cookies. Sessões de header são lidas com a senha extra até expirarem, como já ocorre com elas hoje (`idleTimeout` conta a partir da emissão do selo).
- **P3.** A regravação de sessões legadas já existente em `getSession` (que reselá com as opções atuais) serve de modelo para a RF-04.
- **P4.** `password` e cada extra são strings usadas com o mesmo algoritmo de selagem; não há diferença de formato de `passwordId` entre elas, pois o iron trata senha em string como `default`.
- **P5.** A lista de senhas extras é estática, definida na inicialização da aplicação. Não há leitura dinâmica de segredos.

### Riscos

- **R1 — Amplificação de CPU sem autenticação.** Cada cookie inválido passa a disparar até `1 + N` derivações PBKDF2 (com o padrão de 8192 iterações), já que qualquer requisição pode enviar um cookie qualquer. Com muitas senhas extras, isso encarece o caminho de requisição anônima. Mitigação sugerida: limitar o número de senhas extras (por exemplo, até 3) e documentar o custo.
- **R2 — Interação com `legacySealFallback`.** O fallback de 1 iteração precisa ser tentado para cada senha, o que multiplica o caso de erro. A combinação deve ser testada explicitamente. Se complicar demais, a alternativa é aplicar o fallback só à senha atual.
- **R3 — Erros engolidos.** Em `getSession`, falhas de unseal são capturadas (`.catch(() => {})`). Sem a validação da RF-06, uma senha extra mal formada faria todas as sessões sumirem silenciosamente. A RF-06 existe por causa disso.
- **R4 — Senha antiga esquecida.** Se a senha extra nunca for removida, a rotação perde o efeito de segurança: quem tiver a senha antiga e um cookie antigo continua com acesso. A documentação do campo deve dizer que as extras devem ser removidas depois da janela de migração.
- **R5 — Sessões de header não migram.** Clientes que usam só o header ficam presos à senha antiga até expirar. Para eles, a janela de migração depende de `maxAge`/`idleTimeout`.
- **R6 — Mudança de tipo pública.** Adicionar o campo é compatível, mas quem usa `SessionConfig` como tipo exato em outro lugar pode notar. O risco é baixo.
