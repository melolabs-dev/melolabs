# PRD — Múltiplas senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa proposta: campo extra de senhas).
Escopo técnico: `src/utils/session.ts` (`SessionConfig`, `getSession`, `unsealSession`, `sealSession`) e testes de sessão.

## Problema e objetivo

Hoje `useSession`/`getSession` aceitam uma única `password`, usada tanto para selar quanto para abrir as sessões. Ao rotacionar essa senha, todas as sessões seladas com a senha anterior deixam de abrir: os usuários são deslogados de uma vez, mesmo sem nenhum motivo de segurança imediato para invalidar as sessões antigas.

**Objetivo:** permitir que a aplicação troque a `password` (que passa a selar) e mantenha aceitas, só para abrir, as sessões seladas com senhas anteriores listadas em um campo novo. A rotação deixa de ser um logout forçado e passa a ser uma decisão controlada pela configuração.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, documentado como senhas anteriores que só abrem sessões. `password` continua sendo `string` e continua sendo a única senha usada para selar. Nenhum outro nome público novo é introduzido.

**Critério de aceite:**
- Dado uma configuração com `password` e `extraUnsealPasswords: ["antiga"]`,
- Quando o tipo `SessionConfig` é verificado pelo typecheck,
- Então o campo é aceito como `string[]` opcional e a configuração sem o campo continua válida.

### RF-02 — Abertura tenta `password` e depois as extras, em ordem

Ao abrir uma sessão, a biblioteca tenta primeiro `password` e depois cada item de `extraUnsealPasswords`, na ordem declarada. Usa a primeira senha que abre a selagem e para ali.

**Critério de aceite:**
- Dado uma sessão selada com a senha `antiga`, e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- Quando a sessão é lida com `getSession` ou `useSession`,
- Então os dados da sessão são carregados e o `id` é o da sessão original.

### RF-03 — Selagem usa sempre `password`

Nenhuma senha extra é usada para selar. Toda selagem (`sealSession`, `updateSession`, `clear` quando aplicável) usa `password`.

**Critério de aceite:**
- Dado uma sessão aberta com a senha extra `antiga`,
- Quando a aplicação grava um dado nela com `update`,
- Então o cookie resultante só abre com `password: "nova"` e não abre com a configuração que tem apenas `"antiga"`.

### RF-04 — Sessão que não abre por nenhuma senha continua tratada como inexistente

Se nem `password` nem as extras abrem a selagem, o comportamento é o mesmo de hoje: a sessão é ignorada e uma nova sessão é iniciada, sem lançar erro para quem chama.

**Critério de aceite:**
- Dado um cookie selado com uma senha que não está em `password` nem em `extraUnsealPasswords`,
- Quando a sessão é lida,
- Então `getSession` retorna uma sessão nova com dados vazios e nenhuma exceção é propagada.

### RF-05 — Vale para cookie e para header de sessão

A busca por extras acontece no mesmo ponto em que a selagem é aberta, então se aplica tanto à sessão lida do cookie quanto à lida do header `x-{name}-session` (ou o header configurado em `sessionHeader`).

**Critério de aceite:**
- Dado uma sessão selada com `antiga` enviada no header de sessão,
- Quando a configuração tem `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e `sessionHeader` ativo,
- Então a sessão é aberta a partir do header como se viesse do cookie.

### RF-06 — Compatibilidade com o fallback de selagem legada

O fallback de 1 iteração PBKDF2 (`legacySealFallback`) continua valendo para cada senha tentada. Uma sessão antiga selada com 1 iteração sob uma senha extra abre se `legacySealFallback` não for `false`, e é resselada com `password` como já acontece hoje.

**Critério de aceite:**
- Dado uma sessão selada com a senha extra `antiga` usando 1 iteração PBKDF2,
- Quando a sessão é lida com `legacySealFallback` ausente ou `true`,
- Então ela é aberta e resselada com `password`; com `legacySealFallback: false`, ela é rejeitada.

### RF-07 — Sem extras, o comportamento não muda

Quando `extraUnsealPasswords` está ausente ou é um array vazio, o comportamento é idêntico ao atual: mesma selagem, mesmos cookies e mesmos erros internos tratados.

**Critério de aceite:**
- Dado uma configuração sem `extraUnsealPasswords` (ou com `[]`),
- Quando a suíte existente de sessões é executada,
- Então todos os testes continuam passando sem alteração de expectativa.

### RF-08 — Expiração continua valendo para sessões abertas por extras

`maxAge` e `idleTimeout` são aplicados da mesma forma a sessões abertas por qualquer senha. Abrir com uma extra não estende a vida da sessão.

**Critério de aceite:**
- Dado uma sessão selada com `antiga` cujo `createdAt` ultrapassa `maxAge`,
- Quando a sessão é lida com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- Então ela é tratada como expirada e uma nova sessão é iniciada.

### RF-09 — Documentação do campo

O JSDoc de `extraUnsealPasswords` explica: que as extras só abrem, que a selagem usa `password`, que as extras seguem a mesma recomendação de entropia de `password`, e que as senhas extras devem ser removidas depois que a maior `maxAge` (ou `idleTimeout`) das sessões antigas tiver passado.

**Critério de aceite:**
- Dado o arquivo `src/utils/session.ts`,
- Quando o campo é lido no JSDoc,
- Então a documentação cobre os quatro pontos acima e não contradiz o JSDoc de `password`.

### RF-10 — Cobertura de testes nos dois modos

Os testes novos seguem o padrão `describeMatrix` (web e node) e cobrem: abertura com senha extra, rejeição de senha desconhecida, selagem sempre com `password`, leitura pelo header, e ausência de extras.

**Critério de aceite:**
- Dado os testes novos em `test/` usando `describeMatrix`,
- Quando `pnpm vitest run` é executado para os arquivos de sessão,
- Então todos os casos passam nos modos web e node.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050).
- Identificador de chave (`kid`) no payload selado ou qualquer mudança de formato da selagem iron.
- Invalidação automática de sessões antigas ou agendamento de remoção das extras.
- Migração proativa de todas as sessões na leitura: a resselagem com `password` acontece apenas nos caminhos que já resselam hoje (fallback legado, deslizamento de `idleTimeout` e escritas).
- Helper ou CLI para rotação de chaves.
- Mudanças em outras utilidades (`auth`, `cookie`, `cors`) ou no entry de v1 (`_deprecated.ts`).
- Mudança nas opções `seal` ou nos valores padrão de PBKDF2.

## Premissas e riscos

### Premissas

- A configuração é passada a cada chamada (`useSession`, `getSession`, `updateSession`). Todas as chamadas de uma mesma sessão precisam receber a mesma lista de senhas.
- A sessão lida do header e a lida do cookie passam pelo mesmo `unsealSession`.
- `legacySealFallback` continua existindo em v2 e não é removido nesta entrega.
- O iron rejeita senhas string menores que `minPasswordlength` (padrão 32) em `generateKey`, então `password` e as extras já têm um tamanho mínimo validado em runtime. As extras seguem o mesmo limite, sem validação própria.
- Sessões sem `maxAge` nem `idleTimeout` não expiram. Nesse caso, uma senha extra mantida na configuração vale indefinidamente.

### Riscos

- **Custo de CPU amplificado:** cada senha tentada custa uma derivação PBKDF2. Um cookie inválido, controlado por quem envia a requisição, pode disparar uma derivação por senha configurada (e mais uma, se o fallback legado estiver ativo). Mitigação possível: limitar o número de extras ou documentar o custo; decisão pendente.
- **Senha antiga vazada:** enquanto a senha extra estiver na configuração, quem a possuir pode forjar sessões válidas. A rotação não revoga sessões antigas por si só.
- **Rotação sem prazo:** esquecer a senha extra na configuração depois da janela de `maxAge` mantém a porta aberta sem necessidade. A documentação (RF-09) mitiga, mas não impede.
- **Deploy misto:** instâncias com a versão antiga (sem extras) não conseguem abrir sessões seladas com a nova `password`. A ordem recomendada é implantar primeiro a configuração com `password` antiga e `extraUnsealPasswords` com a nova, e só depois trocar `password` para a nova.
- **Sessões sem expiração e sem escrita:** sessões que nunca são reescritas continuam seladas com a senha antiga até expirar; a remoção da extra antes disso as desloga.
- **Ordem das extras:** se a mesma senha estiver em `password` e em `extraUnsealPasswords`, a tentativa repetida é desperdício de CPU. Pode ser normalizado ou apenas documentado.
