# PRD — Múltiplas senhas de unseal nas sessões

Referência: issue h3js/h3#1050 e contrato enxuto em `sdd/pedido.md` (variante com o campo `extraUnsealPasswords`).

## Problema e objetivo

Hoje `useSession` / `getSession` (em `src/utils/session.ts`) selam e abrem as sessões com uma única senha, `SessionConfig.password`. Ao trocar essa senha por motivos de segurança (rotação de segredos), todas as sessões já emitidas deixam de abrir e os usuários são desconectados de uma vez.

O objetivo é permitir a rotação sem derrubar sessões: o desenvolvedor informa as senhas anteriores em um campo novo, o h3 continua aceitando sessões seladas com elas, e as sessões antigas migram para a senha atual à medida que são usadas. Quando a janela de rotação terminar, basta remover a senha extra da configuração.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores aceitas apenas para abrir sessões. `password` continua sendo uma string.

**Dado** uma configuração com `password: A` e `extraUnsealPasswords: [B]`
**Quando** uma requisição chega com um cookie de sessão selado com `B`
**Então** a sessão é carregada com os mesmos `id`, `createdAt` e `data` que foram gravados

### RF-02 — Selagem sempre com `password`

As senhas extras nunca são usadas para selar. Toda escrita de sessão usa `password`.

**Dado** uma configuração com `password: A` e `extraUnsealPasswords: [B]`
**Quando** a sessão é escrita com `updateSession` ou `useSession(...).update`
**Então** o cookie resultante só abre com `A` e não abre com `B`

### RF-03 — Migração da sessão para a senha atual

Quando uma sessão é aberta com uma senha extra e lida por cookie, ela é resselada com `password` na mesma requisição, como já acontece com cookies legados.

**Dado** uma sessão selada com `B` e uma configuração com `password: A` e `extraUnsealPasswords: [B]`
**Quando** a requisição lê a sessão por cookie
**Então** a resposta traz um `Set-Cookie` com um selo novo, que abre com `A` e não com `B`, e os dados da sessão permanecem os mesmos

### RF-04 — Compatibilidade sem senhas extras

Sem `extraUnsealPasswords` (ou com lista vazia), o comportamento é idêntico ao atual, inclusive o fallback de selo legado de 1 iteração PBKDF2.

**Dado** uma configuração sem `extraUnsealPasswords`
**Quando** chega um cookie selado com outra senha, ou um cookie legado selado com `password`
**Então** o resultado é o mesmo de hoje: no primeiro caso a sessão é tratada como nova, e no segundo ela abre e é resselada

### RF-05 — Prazos não mudam com a senha extra

Abrir uma sessão com senha extra respeita `maxAge` e `idleTimeout` exatamente como abrir com `password`. Usar a senha extra não estende prazo.

**Dado** uma sessão selada com `B` cujo `maxAge` já expirou
**Quando** a requisição tenta abri-la
**Então** a sessão é descartada como expirada e nenhuma sessão nova herda seus dados

### RF-06 — Validação de senhas extras

Cada senha em `extraUnsealPasswords` recebe a mesma validação de `password`: string não vazia com no mínimo 32 caracteres.

**Dado** uma configuração com `extraUnsealPasswords: ["curta"]`
**Quando** a configuração é usada por `useSession` ou `getSession`
**Então** um erro indica qual senha é inválida, em vez de a senha falhar em silêncio e as sessões dela serem tratadas como novas

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050). Não será implementado nesta entrega.
- Identificador de chave (`kid`) ou versão no token selado. Mudaria o formato do cookie e exigiria compatibilidade com a versão anterior do formato.
- Rotação automática ou agendada das senhas. A troca e a remoção das senhas continuam manuais, na configuração.
- Migração de sessões lidas pelo header de sessão (`sessionHeader`). Essas sessões não podem ser resseladas, então continuam abertas com a senha extra enquanto ela existir.
- Remoção do fallback legado (`legacySealFallback`), que tem remoção prevista para a v3.
- Qualquer outro campo ou função pública além de `extraUnsealPasswords`.

## Premissas e riscos

**Premissas**

- `unsealSession` é o único ponto em que `config.password` é usado para abrir sessões, e é nele que as senhas extras são tentadas, na ordem `password` e depois `extraUnsealPasswords`.
- A migração de RF-03 é uma decisão deste PRD, não algo pedido na issue. Sem ela, a senha antiga teria de ficar configurada para sempre.
- O fallback de selo legado (1 iteração PBKDF2) continua valendo para cada senha tentada.
- A validação de RF-06 precisa acontecer antes de `getSession` capturar o erro de unseal; hoje esse erro é engolido por `.catch(() => {})`.

**Riscos**

- **Custo de CPU e amplificação.** Cada tentativa é uma derivação PBKDF2. Um cookie inválido custa até `1 + extraUnsealPasswords.length` derivações, e com fallback legado o custo dobra por senha. Mitigação: manter a lista curta e documentar o custo.
- **Senha antiga mantida em uso.** Se a senha extra não for removida depois da janela de rotação, ela continua valendo. Mitigação: documentar que a janela deve ser maior que `maxAge` ou `idleTimeout`, para que nenhuma sessão legítima seja cortada.
- **Sessões por header não migram.** Enquanto a senha extra existir, elas continuam dependendo dela. Mitigação: documentar.
- **Erro silencioso.** Senha extra inválida, sem RF-06, faria as sessões dela sumirem sem aviso. Mitigação: RF-06.
- **Testes.** Os testes novos devem usar `describeMatrix`, para rodar nos alvos `web` e `node`. Esta PRD não executa testes nem `pnpm lint`/`pnpm typecheck`. Isso fica para a etapa de implementação, que deve seguir o fluxo de bug fix do AGENTS.md (teste de regressão primeiro, falhando antes da mudança).
