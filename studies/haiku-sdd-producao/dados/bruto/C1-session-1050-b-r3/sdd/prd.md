# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Data: 2026-11-06
Origem: `sdd/pedido.md` (issue h3js/h3#1050, primeira alternativa proposta)
Área afetada: `src/utils/session.ts` (`SessionConfig`, `sealSession`, `unsealSession`, `getSession`)

## Problema e objetivo

### Problema

Hoje cada `SessionConfig` tem uma única `password`, usada para selar e para abrir as sessões. Quem precisa trocar essa senha (por exemplo, por rotação de segredos) invalida todas as sessões seladas com a senha antiga: os usuários precisam fazer login de novo, mesmo sem nenhum motivo de segurança para isso.

### Objetivo

Permitir que a aplicação troque a senha de selagem sem quebrar as sessões já emitidas. A nova configuração `extraUnsealPasswords` aceita uma lista de senhas anteriores que servem **somente para abrir** sessões. Toda sessão nova ou regravada continua sendo selada apenas com `password`.

### Fora deste PRD

Nenhuma mudança de comportamento para quem não usa o campo novo.

## Requisitos funcionais

### RF-01 — Abrir sessão selada com senha extra

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`, e um cookie de sessão selado com `B`,
- **Quando** a sessão é lida (`getSession` / `useSession`),
- **Então** os dados da sessão são retornados sem erro.

### RF-02 — Selar sempre com a senha principal

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`,
- **Quando** uma sessão é criada ou atualizada (`sealSession` / `useSession().update`),
- **Então** o cookie resultante abre com `A` e não abre com `B`.

### RF-03 — Ordem de tentativa e senhas repetidas

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B", "C"]`, e um cookie selado com `B`,
- **Quando** a sessão é lida,
- **Então** a senha `B` abre o cookie, e a senha `C` não precisa ser tentada.

- **Dado** uma configuração em que a mesma senha aparece em `password` e em `extraUnsealPasswords`,
- **Quando** uma sessão selada com essa senha é lida,
- **Então** a sessão é aberta normalmente, sem erro.

### RF-04 — Sem senhas extras, comportamento inalterado

- **Dado** uma configuração sem `extraUnsealPasswords` (ou com lista vazia),
- **Quando** é lido um cookie selado com outra senha ou adulterado,
- **Então** o resultado é idêntico ao da versão atual (mesma sessão vazia ou mesmo erro), e a suíte de testes existente continua passando.

### RF-05 — Falha quando nenhuma senha abre o cookie

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`, e um cookie selado com `C`,
- **Quando** a sessão é lida,
- **Então** a sessão é tratada como inválida da mesma forma que hoje é tratada uma senha errada, sem indicar qual senha foi tentada.

### RF-06 — Validação de senhas extras

- **Dado** uma configuração com `extraUnsealPasswords` contendo uma string vazia ou com menos caracteres do que o mínimo exigido para `password`,
- **Quando** a configuração é usada,
- **Então** ela é rejeitada com o mesmo tratamento que uma `password` inválida recebe hoje.

### RF-07 — Fallback legado e regravação

- **Dado** uma configuração com `password` = `A` e `extraUnsealPasswords` = `["B"]`, e um cookie selado com `B` usando o formato legado (1 iteração de PBKDF2),
- **Quando** a sessão é lida com `legacySealFallback` em seu valor padrão,
- **Então** a sessão é aberta, e a regravação que o fluxo atual já faz para cookies legados usa `A`.

- **Dado** a mesma configuração com `legacySealFallback: false`,
- **Quando** o mesmo cookie legado é lido,
- **Então** a sessão não é aberta, como hoje para uma senha que não abre o cookie.

## Restrições

- Nenhum outro nome público novo. O único símbolo público novo é o campo `extraUnsealPasswords: string[]` em `SessionConfig`, opcional, com JSDoc.
- `password` continua sendo `string` e continua sendo a única senha usada para selar.
- Os testes devem seguir o padrão `describeMatrix` (web e node).
- `pnpm lint` e `pnpm typecheck` devem passar.
- A suíte existente deve continuar passando. Se algum teste depender de detalhes que mudam, ajustar só o necessário, sem remover o que ele verifica.

## Premissas

- **Rotação é manual.** A aplicação coloca a senha nova em `password` e a antiga em `extraUnsealPasswords`. Quem remove a senha antiga da lista é a aplicação, não a biblioteca.
- **Ordem de tentativa.** `password` é tentada primeiro, depois as extras na ordem do array. A primeira que abre o cookie vence.
- **Listas curtas.** Espera-se de 0 a 3 senhas extras. Não há limite imposto pela biblioteca.
- **Regravação com a senha atual.** Uma sessão aberta com senha extra é regravada com `password` apenas quando o fluxo atual já faria a regravação (formato legado ou janela deslizante de `idleTimeout`). Não há regravação forçada nova.
- **Mínimo de caracteres.** A regra de tamanho mínimo de `password` (documentada como 32 caracteres) vale para cada senha extra. Verificar no código onde essa regra é aplicada, para que a validação da RF-06 use o mesmo caminho.

## Riscos

- **Senha antiga por tempo indefinido.** Enquanto uma senha antiga estiver em `extraUnsealPasswords`, quem a conhece consegue forjar sessões válidas. Esse é o principal risco de segurança da feature. Deve ser documentado para quem usa a opção, com a recomendação de remover a senha da lista depois de um prazo.
- **Custo de CPU por requisição.** Cada senha tentada custa uma derivação PBKDF2. Um cookie inválido ou forjado custa até `N + 1` derivações (e o dobro quando o fallback legado é ativado para cada senha). Como o cookie vem do cliente, isso abre espaço para amplificação de custo. Mitigação: listas curtas e documentação.
- **Interação com o fallback legado.** O fallback atual é disparado pela mensagem de erro `"Bad hmac value"`. Ele precisa valer para cada senha tentada, não só para a principal. Um erro nessa lógica faria sessões legadas seladas com senha extra deixarem de abrir. Coberto pela RF-07.
- **Vazamento de detalhe por tempo de resposta.** Ao tentar várias senhas, o tempo de resposta cresce com a posição da senha que abre o cookie. Não é um vazamento do segredo, mas altera o perfil de tempo em relação a hoje.
- **Regressão silenciosa.** Mudanças em `unsealSession` afetam todas as sessões da aplicação. Os testes da RF-04 são a principal proteção contra isso.

## Pontos em aberto

- A regravação com `password` (RF-07, premissa de regravação) precisa ser confirmada pelo dono da feature. A alternativa seria não regravar nada além do que já é regravado hoje, o que também atende a RF-01.
- Confirmar se há limite máximo para `extraUnsealPasswords` antes de publicar a feature.

## Fora de escopo

- A alternativa 2 da issue #1050, em que `password` passa a aceitar um array (primeira senha sela, as demais só abrem). Não será implementada agora, e a API definida aqui não deve impedir uma evolução futura nesse sentido.
- Rotação automática, agendada ou por tempo. A biblioteca não gera nem troca senhas.
- Ferramenta ou comando de linha para re-selar sessões em lote.
- Mudança no formato do cookie selado ou no algoritmo de selagem.
- Remoção do fallback legado (`legacySealFallback`), que continua planejada para a v3.
- Mudanças em outros módulos, como `basicAuth`, `cookie` ou `cache`.
- Documentação de guia de migração completo. Apenas o JSDoc do campo novo entra nesta entrega.
