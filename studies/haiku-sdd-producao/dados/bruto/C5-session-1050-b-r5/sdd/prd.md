# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela) e contrato em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `SessionConfig` aceita uma única `password`, que é usada tanto para selar quanto para abrir (unseal) as sessões. Ao trocar essa senha por rotação de segredos, todas as sessões seladas com a senha anterior passam a ser inválidas, e os usuários são deslogados de uma vez.

### Objetivo

Permitir que a senha seja rotacionada sem invalidar as sessões existentes. Para isso, `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores que só servem para abrir sessões. A `password` continua sendo a única usada para selar.

Fora do objetivo: alterar o formato do cookie de sessão ou a API pública além do campo novo.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` aceita o campo opcional `extraUnsealPasswords: string[]`, documentado (JSDoc) como senhas anteriores que só abrem sessões. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** uma configuração de sessão sem `extraUnsealPasswords`
- **Quando** o tipo `SessionConfig` é verificado pelo typecheck
- **Então** a configuração continua válida e `password` continua sendo do tipo `string`.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou resselada é selada exclusivamente com `password`, mesmo quando há senhas extras configuradas.

**Critério de aceite**

- **Dado** uma configuração com `password = A` e `extraUnsealPasswords = [B]`
- **Quando** uma sessão é criada com `useSession` e o cookie é inspecionado
- **Então** o cookie só pode ser aberto com `A`, e não com `B`.

### RF-03 — Abertura de sessões com senhas extras

Uma sessão selada com uma senha presente em `extraUnsealPasswords` é aberta e seus dados ficam disponíveis normalmente.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `B` e uma configuração com `password = A` e `extraUnsealPasswords = [B]`
- **Quando** a requisição chega com esse cookie e a sessão é lida com `getSession`
- **Então** os dados da sessão são retornados sem erro e o usuário permanece autenticado.

### RF-04 — Ordem de tentativa

As senhas são tentadas nesta ordem: `password` primeiro e, depois, cada item de `extraUnsealPasswords` na ordem em que aparece na lista. A primeira que abrir o cookie vence.

**Critério de aceite**

- **Dado** uma configuração com `password = A` e `extraUnsealPasswords = [B, C]`
- **Quando** um cookie selado com `C` é lido
- **Então** a sessão é aberta após as tentativas com `A` e `B` falharem, sem tentar outras senhas depois de `C` ter funcionado.

### RF-05 — Resselagem com a senha atual

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password` na mesma leitura em que o fluxo atual já resselaria a sessão (por exemplo, deslizamento de `idleTimeout` ou sessão legada). Assim, a senha antiga pode ser removida da lista depois que as sessões migrarem.

**Critério de aceite**

- **Dado** uma sessão selada com `B` e uma configuração com `password = A` e `extraUnsealPasswords = [B]`
- **Quando** a sessão é lida e o fluxo de resselagem ocorre
- **Então** o novo cookie emitido só pode ser aberto com `A`.

### RF-06 — Compatibilidade com o fallback de sessões legadas

O fallback de sessões seladas com 1 iteração PBKDF2 (`legacySealFallback`) vale para cada senha tentada, inclusive para as senhas extras. Com `legacySealFallback: false`, o comportamento é o mesmo de hoje para todas as senhas.

**Critério de aceite**

- **Dado** uma sessão legada (1 iteração) selada com `B`, e uma configuração com `password = A` e `extraUnsealPasswords = [B]`
- **Quando** a sessão é lida
- **Então** ela é aberta e marcada como legada, como acontece hoje com a senha principal.

### RF-07 — Falha quando nenhuma senha abre o cookie

Se nenhuma senha (`password` ou extras) abrir o cookie, o resultado é o mesmo de hoje para cookie inválido: a sessão é tratada como vazia e uma nova é criada, sem expor a senha ou detalhes internos.

**Critério de aceite**

- **Dado** um cookie selado com `Z`, que não está em nenhuma das senhas configuradas
- **Quando** a sessão é lida com `getSession`
- **Então** o resultado é uma sessão vazia, igual ao cenário de cookie inválido atual.

### RF-08 — Comportamento inalterado sem senhas extras

Sem `extraUnsealPasswords` (ou com lista vazia), as sessões se comportam exatamente como antes, inclusive o fallback legado.

**Critério de aceite**

- **Dado** uma configuração idêntica à de hoje, sem o campo novo
- **Quando** a suíte existente de sessões é executada
- **Então** todos os testes passam sem alteração de resultado.

### RF-09 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue a mesma regra de tamanho mínimo que `password` (pelo menos 32 caracteres). Uma senha inválida na configuração é rejeitada com erro claro, em vez de ser ignorada em silêncio.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords = ["curta"]`
- **Quando** a sessão é usada pela primeira vez
- **Então** um erro indica que a senha extra é inválida (tamanho mínimo de 32 caracteres).

### RF-10 — Testes cobrindo os cenários

Os cenários de RF-02 a RF-09 têm testes automatizados em `test/session.test.ts`, usando `describeMatrix` para rodar em modo `web` e `node`.

**Critério de aceite**

- **Dado** a implementação concluída
- **Quando** `pnpm vitest run test/session.test.ts` é executado
- **Então** todos os testes novos e os existentes passam, e `pnpm lint` e `pnpm typecheck` também passam.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue #1050).
- Rotação automática de senhas, ou leitura de senhas a partir de variáveis de ambiente ou de um gerenciador de segredos.
- Expiração ou remoção automática de senhas extras.
- Mudança no formato do cookie ou na biblioteca de selagem (`iron`/`seal`).
- Alterações em outras utilidades (`cookie`, `auth`, `cache`) ou na API de `H3Event`.
- Forçar a resselagem de sessões que não passam pelo fluxo atual de leitura, como sessões vindas somente pelo cabeçalho de sessão.

## Premissas e riscos

### Premissas

- A `password` continua sendo `string` e continua sendo a única senha usada para selar.
- A suíte existente em `test/session.test.ts` passa antes da mudança e deve continuar passando sem alteração de resultado.
- O fallback legado (`legacySealFallback`) hoje tenta apenas a `password`; a extensão para as senhas extras é uma decisão deste PRD (RF-06).
- A regra de tamanho mínimo de 32 caracteres se aplica a `password` e será estendida às extras (RF-09).
- A resselagem com `password` (RF-05) reaproveita o fluxo já existente de `getSession`, sem novo caminho de escrita.

### Riscos

- **Senhas antigas continuam válidas enquanto estiverem na lista.** Se uma senha vazar, ela só deixa de funcionar quando for removida de `extraUnsealPasswords`. Mitigação: documentar o processo de rotação e o momento de remover as extras.
- **Custo de CPU em cookies inválidos.** Cada senha tentada faz uma derivação PBKDF2 (8192 iterações por padrão). Um cliente que envie cookies inválidos força N derivações por requisição, e o fallback legado pode dobrar esse número. Mitigação: manter a lista curta e documentar o custo; avaliar um limite de tamanho para a lista.
- **Sessões que não são resseladas.** Sessões lidas apenas pelo cabeçalho de sessão não são resseladas; enquanto a senha antiga estiver na lista, elas continuam abertas. Mitigação: documentar a limitação.
- **Erro de configuração silencioso.** Senha extra igual à `password`, ou repetida, pode passar sem efeito. Mitigação: validar duplicatas (ou aceitar e documentar que são ignoradas).
- **Vazamento de detalhes.** Mensagens de erro não devem indicar qual senha falhou. Mitigação: manter a resposta de falha igual à atual (RF-07).
