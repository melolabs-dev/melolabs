# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta nela) e contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` (e `getSession`, `sealSession`, `unsealSession` em `src/utils/session.ts`) usa uma única senha, `SessionConfig.password`, para selar e abrir a sessão. Quando a aplicação troca essa senha, todas as sessões seladas com a senha anterior deixam de abrir: o usuário é deslogado de forma abrupta, sem que a troca tenha sido uma decisão de expirar sessões.

Rotacionar segredos é uma prática comum de segurança, e hoje ela é incompatível com a continuidade das sessões.

### Objetivo

Permitir que `password` receba uma lista de senhas. A primeira senha da lista sela as sessões novas; as demais são usadas somente para abrir sessões seladas antes da rotação. Com isso, a aplicação pode trocar a senha sem invalidar as sessões ativas, e uma senha única continua funcionando exatamente como hoje.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

`SessionConfig.password` passa a aceitar `string | string[]`. Uma lista é válida somente se tiver ao menos uma senha.

**Critério de aceite:**
- **Dado** uma configuração com `password: ["senha-nova-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`,
- **Quando** a sessão é criada ou aberta com `useSession` ou `getSession`,
- **Então** a configuração é aceita pelo tipo do TypeScript e pela execução, sem erro de validação.

### RF-02 — Selar com a primeira senha

Ao selar uma sessão (`sealSession`, inclusive ao gravar com `useSession().update`/`clear`), a primeira senha da lista é usada.

**Critério de aceite:**
- **Dado** uma configuração com `password: [senhaA, senhaB]`,
- **Quando** uma sessão nova é selada,
- **Então** o cookie ou header resultante abre com `senhaA` isoladamente e não abre com `senhaB` isoladamente.

### RF-03 — Abrir sessões seladas com qualquer senha da lista

Ao abrir uma sessão (`unsealSession`), as senhas da lista são tentadas em ordem até uma abrir o selo. Se nenhuma abrir, o erro é o mesmo que hoje para uma senha inválida.

**Critério de aceite:**
- **Dado** uma sessão selada com `senhaB` (anterior à rotação),
- **Quando** ela é lida com `password: [senhaA, senhaB]`,
- **Então** os dados da sessão são retornados e a sessão permanece válida.

- **Dado** uma sessão selada com uma senha que não está na lista,
- **Quando** ela é lida,
- **Então** a leitura falha como falha hoje para senha inválida, sem retornar dados parciais.

### RF-04 — Compatibilidade com senha única

Quando `password` é uma string, o comportamento é idêntico ao atual, em todos os caminhos de selagem e abertura.

**Critério de aceite:**
- **Dado** a suíte existente de `test/session.test.ts`,
- **Quando** ela roda sem alterações nos cenários que não envolvem listas,
- **Então** todos os testes continuam passando.

### RF-05 — Validação da lista

Uma lista vazia é rejeitada. Cada senha da lista segue a mesma regra que a senha única segue hoje.

**Critério de aceite:**
- **Dado** uma configuração com `password: []`,
- **Quando** a sessão é usada,
- **Então** a execução falha com erro explícito indicando que ao menos uma senha é necessária.

- **Dado** uma configuração com uma senha da lista que viola a regra de tamanho/validação da senha única,
- **Quando** a sessão é usada,
- **Então** o erro é o mesmo que a senha única produziria para essa violação.

### RF-06 — Cobertura nos dois caminhos de leitura

A lista vale tanto para sessões em cookie quanto para sessões lidas pelo header de sessão, pois ambas passam por `unsealSession`.

**Critério de aceite:**
- **Dado** uma sessão selada com a senha anterior, enviada pelo header de sessão,
- **Quando** ela é lida com `password: [senhaA, senhaB]`,
- **Então** ela é aberta da mesma forma que um cookie equivalente.

### RF-07 — Suporte ao fallback de selo legado

Quando o fallback de selo legado (`legacySealFallback`, 1 iteração PBKDF2) está ativo, ele é aplicado a cada senha da lista, e não só à primeira.

**Critério de aceite:**
- **Dado** uma sessão selada com a senha anterior usando 1 iteração PBKDF2,
- **Quando** ela é lida com `password: [senhaA, senhaB]` e `legacySealFallback` não é `false`,
- **Então** a sessão é aberta e marcada como selo legado, como hoje para uma senha única.

## Fora de escopo

- Nova opção pública como `extraUnsealPasswords` (primeira alternativa da issue). Nesta variante não há nomes públicos novos.
- Rotação automática ou agendada de senhas, e qualquer mecanismo de distribuição de segredos.
- Reselagem forçada de todas as sessões antigas. Uma sessão aberta com senha anterior volta a ser selada com a primeira senha na próxima gravação natural; não há migração em massa.
- Revogação de sessões específicas ou de todas as sessões.
- Mudança de algoritmo, de parâmetros de selo padrão (`sealDefaults`) ou do formato do selo.
- Alterações em outros utilitários (`cookie.ts`, `proxy.ts`, `auth.ts`) além do que for estritamente necessário para tipar `password`.
- Remoção do `legacySealFallback` (fica para a v3, como já indicado no código).

## Premissas e riscos

### Premissas

- As três ocorrências atuais de `config.password` estão em `src/utils/session.ts` (linhas 300, 324 e 340). Antes da implementação, confirmar com busca no repositório que nenhum outro arquivo lê `config.password` diretamente.
- A ordem da lista é significativa e documentada: a primeira senha sela, as demais só abrem.
- A regra de tamanho mínimo e qualquer outra validação de `password` hoje aplicada à senha única se aplica igualmente a cada item da lista. Confirmar onde essa validação ocorre, pois a documentação do campo menciona 32 caracteres e a implementação precisa ser verificada.
- Testes existentes em `test/session.test.ts` continuam válidos para senha única; novos testes cobrem listas.
- O critério de conclusão inclui `pnpm lint` e `pnpm typecheck` passando.

### Riscos

- **Custo de desempenho.** Cada senha tentada custa uma derivação PBKDF2 completa (8192 iterações por padrão). Uma sessão selada com a última senha da lista exige N tentativas, e uma sessão inválida exige todas elas. Com listas longas, a latência de leitura de cookies inválidos cresce linearmente. Mitigação: manter listas curtas e documentar o custo.
- **Interação com o fallback legado.** Como o fallback retenta com 1 iteração, o número de derivações pode dobrar por senha no pior caso. Precisa ser coberto por teste (RF-07) para não criar uma regressão silenciosa.
- **Senha antiga esquecida na lista.** Se a senha anterior nunca for removida, a superfície de ataque cresce com ela: quem tiver a senha antiga continua podendo forjar sessões. Documentar que a senha antiga deve sair da lista após o período de transição.
- **Ambiguidade de tipo.** Trocar `string` por `string | string[]` pode afetar código de terceiros que lê `config.password`. Pode exigir tratamento explícito no tipo exportado.
- **Mensagem de erro.** Erros de lista vazia ou inválida precisam ser distinguíveis do erro de sessão inválida, sem vazar qual senha da lista falhou.
