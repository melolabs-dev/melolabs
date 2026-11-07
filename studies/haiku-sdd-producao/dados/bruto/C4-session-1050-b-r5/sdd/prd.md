# PRD — Várias senhas de unseal nas sessões (#1050-b)

## Problema e objetivo

### Problema

Hoje `useSession` / `SessionConfig` aceita uma única `password` (`src/utils/session.ts`). Ela é usada tanto para selar quanto para abrir o cookie de sessão. Ao trocar (girar) essa senha, todas as sessões já seladas com a senha antiga deixam de abrir, e os usuários são deslogados de uma vez.

A issue h3js/h3#1050 pede que, durante a rotação de segredos, as sessões seladas com senhas anteriores continuem válidas.

### Objetivo

Permitir que o desenvolvedor informe senhas anteriores que **só servem para abrir** sessões, mantendo `password` como a única senha usada para selar. Assim, uma rotação de senha não invalida sessões ainda vigentes, e o comportamento do projeto continua igual para quem não usa o recurso.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores. O campo `password` continua sendo uma `string` e continua sendo a senha de selagem. Nenhum outro nome público novo é criado.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password: "nova-senha…"` e `extraUnsealPasswords: ["senha-antiga…"]`,
- **Quando** o tipo de `SessionConfig` é verificado pelo TypeScript,
- **Então** o campo é aceito como `string[]` opcional, e `password` continua aceitando apenas `string`.

### RF-02 — Abertura tenta a senha principal e depois as extras

Ao abrir o cookie, a biblioteca tenta primeiro `password` e, se falhar, cada item de `extraUnsealPasswords` na ordem em que foram declarados. A primeira senha que abrir o cookie é usada.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga…"` e uma configuração com `password: "nova-senha…"` e `extraUnsealPasswords: ["senha-antiga…"]`,
- **Quando** `getSession` é chamado com o cookie dessa sessão,
- **Então** os dados da sessão são retornados normalmente, sem erro e sem sessão vazia.

### RF-03 — Selagem sempre com `password`

Senhas extras nunca são usadas para selar. Qualquer sessão nova ou resselada é selada apenas com `password`.

**Critério de aceite**

- **Dado** uma configuração com `password: "nova-senha…"` e `extraUnsealPasswords: ["senha-antiga…"]`,
- **Quando** uma sessão é criada com `useSession` e o cookie resultante é aberto somente com `"senha-antiga…"`,
- **Então** a abertura com a senha antiga falha, provando que o selo usa `"nova-senha…"`.

### RF-04 — Compatibilidade sem senhas extras

Quando `extraUnsealPasswords` não é informado ou é um array vazio, o comportamento é idêntico ao atual, inclusive nos casos de cookie inválido ou de senha errada.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** é lido um cookie selado com outra senha,
- **Então** a sessão retornada é vazia, como acontece hoje, e nenhum erro novo é lançado.

### RF-05 — Fallback de sessões legadas considera as senhas extras

O caminho de compatibilidade para sessões seladas com 1 iteração de PBKDF2 (`unsealSession`) também tenta cada senha extra, para que sessões antigas e rotacionadas continuem abrindo.

**Critério de aceite**

- **Dado** um cookie legado (1 iteração PBKDF2) selado com `"senha-antiga…"`,
- **Quando** `getSession` é chamado com `password: "nova-senha…"` e `extraUnsealPasswords: ["senha-antiga…"]`,
- **Então** a sessão é aberta e resselada com `"nova-senha…"`.

### RF-06 — Reselagem com a senha atual após abrir com senha extra

Quando uma sessão é aberta com uma senha extra, ela é resselada com `password` no mesmo fluxo em que a biblioteca já reselaria a sessão (legado ou deslizamento de `idleTimeout`). Assim, a rotação converge sem exigir logout.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga…"` e uma configuração com `idleTimeout` ativo,
- **Quando** `getSession` abre a sessão e a reselagem por inatividade é disparada,
- **Então** o novo cookie abre com `"nova-senha…"` e não abre com `"senha-antiga…"`.

### RF-07 — Falha quando nenhuma senha abre o cookie

Se nem `password` nem nenhuma das extras abrir o cookie, a sessão se comporta como uma sessão inválida hoje.

**Critério de aceite**

- **Dado** uma configuração com `password: "nova-senha…"` e `extraUnsealPasswords: ["outra-senha…"]`,
- **Quando** `getSession` é chamado com um cookie selado com `"senha-desconhecida…"`,
- **Então** a sessão retornada é vazia, sem erro novo, da mesma forma que hoje ocorre com senha errada.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050). Nesta variante, o campo continua sendo `string`.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Alterar o formato do selo (iron), os algoritmos ou o número de iterações PBKDF2 padrão.
- Rotação automática, leitura de senhas de variáveis de ambiente ou qualquer mecanismo de agendamento de troca de senha.
- Suporte a senhas extras em `useSession` fora de `SessionConfig`, em outros módulos de auth (`basicAuth`, `sealSession` isolado) ou em cookies de outros tipos.
- Revogação de sessões antigas. Uma senha extra que permanece na configuração continua abrindo sessões antigas.
- Mudanças no `README` público ou na documentação além do necessário para o tipo novo.

## Premissas e riscos

### Premissas

- **P-01:** `extraUnsealPasswords` é aplicado a todos os caminhos de abertura de `getSession`/`unsealSession`, incluindo o fallback legado.
- **P-02:** A regra de tamanho mínimo de 32 caracteres aplicada a `password` (documentada em `src/utils/session.ts`) também vale para cada senha extra. Se a biblioteca não valida `password` hoje, senhas extras também não serão validadas.
- **P-03:** A reselagem com a senha atual (RF-06) acontece somente nos caminhos de reselagem já existentes. Não se cria reselagem obrigatória a cada requisição.
- **P-04:** A ordem das senhas extras não tem significado além de desempate na tentativa de abertura.
- **P-05:** Os testes de `test/session.test.ts`, `test/unit/iron-crypto.test.ts` e `test/bench/session.ts` são os pontos que dependem do fluxo de abertura e podem precisar de ajuste.

### Riscos

- **R-01 — Custo de desempenho:** cada senha extra é uma tentativa de unseal com PBKDF2. Uma lista longa aumenta a latência de sessões inválidas, que pagam o custo de todas as tentativas. Mitigação: documentar o custo e sugerir remover senhas antigas após a janela de rotação.
- **R-02 — Senhas antigas permanentes:** esquecer de remover uma senha extra mantém sessões vulneráveis a uma chave que pode ter vazado. Mitigação: documentação e o campo ser explícito.
- **R-03 — Divergência de comportamento legado:** a combinação de fallback legado com senhas extras pode abrir sessões por caminhos diferentes. Mitigação: testes específicos para cada caminho (RF-02, RF-05).
- **R-04 — Ajuste de testes existentes:** a instrução permite alterar testes existentes apenas quando dependem da mudança. Qualquer alteração precisa preservar o que o teste verifica; deve ser revisada com cuidado.
- **R-05 — Verificação de lint e tipos:** `pnpm lint` e `pnpm typecheck` precisam passar, incluindo a regra `isolatedDeclarations` para o novo campo do tipo público.
