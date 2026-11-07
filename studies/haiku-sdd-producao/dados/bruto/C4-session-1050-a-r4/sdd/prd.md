# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession`/`getSession` (`src/utils/session.ts`) aceitam uma única `password`. Para trocar a senha de selagem, o time precisa escolher entre invalidar todas as sessões ativas ou manter a senha antiga configurada para sempre. Quando a senha é rotacionada, as sessões seladas com a senha anterior deveriam continuar válidas até expirarem, como pede a issue [h3js/h3#1050](https://github.com/h3js/h3/issues/1050).

**Objetivo:** permitir que `SessionConfig.password` receba uma lista de senhas. A primeira senha sela as novas sessões; as demais só servem para abrir sessões já existentes. Com uma senha só, o comportamento não muda.

Esta é a segunda alternativa proposta na issue. A primeira (um campo separado, `extraUnsealPasswords`) está fora de escopo.

## Requisitos funcionais

### RF-01 — Aceitar uma lista de senhas em `password`

O campo `SessionConfig.password` passa a aceitar `string | string[]`. Nenhum outro nome público novo é introduzido.

**Critério de aceite**

- **Dado** uma configuração com `password: ["senhaNova…", "senhaAntiga…"]`,
- **Quando** o TypeScript compila o uso dessa configuração em `useSession`,
- **Então** a chamada é aceita sem erro de tipo, e uma configuração com `password: "senha…"` continua aceita.

### RF-02 — Selar sempre com a primeira senha

Toda sessão nova, ou re-selada pela escrita (`updateSession`) ou pela renovação de cookie, é selada com a primeira senha da lista.

**Critério de aceite**

- **Dado** uma configuração com `password: ["A…", "B…"]` (ambas com 32+ caracteres),
- **Quando** uma sessão é criada e gravada com `updateSession`,
- **Então** o cookie selado abre com `A…` e não abre com `B…` isoladamente.

### RF-03 — Abrir sessões com qualquer senha da lista

Ao ler uma sessão, o sistema tenta abrir o selo com as senhas da lista, na ordem declarada, e aceita a primeira que validar.

**Critério de aceite**

- **Dado** um cookie selado com `B…` (senha antiga) e uma configuração `password: ["A…", "B…"]`,
- **Quando** `getSession` é chamado para uma requisição com esse cookie,
- **Então** a sessão é carregada com os dados originais e `session.id` é o mesmo do cookie.

### RF-04 — Rejeitar sessões que nenhuma senha da lista abre

Se nenhuma senha da lista validar o selo, a sessão é tratada como inexistente, exatamente como hoje quando a senha única não confere.

**Critério de aceite**

- **Dado** um cookie selado com `C…`, que não está na lista `["A…", "B…"]`,
- **Quando** `getSession` é chamado,
- **Então** a sessão retornada é nova (id diferente do cookie) e nenhum dado do cookie é carregado.

### RF-05 — Preservar o comportamento com senha única

Quando `password` é uma string, as sessões seladas, abertas, expiradas e renovadas se comportam como na versão atual, inclusive o fallback de selo legado (`legacySealFallback`).

**Critério de aceite**

- **Dado** a suíte existente de `test/session.test.ts` sem alterações de configuração,
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** todos os testes que passavam antes continuam passando.

### RF-06 — Validar a lista de senhas

Uma lista vazia é erro de configuração. Cada senha da lista segue a mesma regra da senha única (entropia mínima de 32 caracteres, conforme a documentação do campo).

**Critério de aceite**

- **Dado** uma configuração com `password: []`,
- **Quando** `useSession` ou `getSession` é chamado,
- **Então** a chamada lança um erro claro indicando que a lista de senhas está vazia.

- **Dado** uma configuração com `password: ["A…", "curta"]`,
- **Quando** a sessão é selada ou aberta,
- **Então** a chamada lança erro indicando a senha curta, sem vazar o valor da senha na mensagem.

### RF-07 — Documentar o campo `password`

O JSDoc de `SessionConfig.password` descreve a lista: a primeira senha sela, as demais só abrem, e a rotação deve remover a senha antiga da lista quando o prazo de todas as sessões que ela selou tiver passado.

**Critério de aceite**

- **Dado** o arquivo `src/utils/session.ts`,
- **Quando** alguém lê o JSDoc de `SessionConfig.password`,
- **Então** encontra a regra de ordem (primeira sela, demais abrem) e a recomendação de remover senhas antigas após `maxAge`/`idleTimeout`.

### RF-08 — Cobrir a rotação com testes

Os testes novos cobrem rotação, abertura com senha antiga, senha desconhecida e lista vazia, sem remover asserções existentes.

**Critério de aceite**

- **Dado** a suíte de sessões com os testes novos,
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** existem testes que cobrem RF-02, RF-03, RF-04 e RF-06, e todos passam.

## Fora de escopo

- A opção `extraUnsealPasswords` (primeira alternativa da issue).
- Gerenciamento automático de chaves, rotação agendada ou armazenamento de senhas.
- Re-selagem forçada de todas as sessões antigas ao trocar a senha. A re-selagem que já existe no código (legado e deslizamento de `idleTimeout`) continua igual.
- Mudanças no formato do cookie, no header de sessão ou no algoritmo de selo (`seal`).
- Remoção do `legacySealFallback` (fica para a v3).
- Mudanças em outros módulos além de `src/utils/session.ts`, `src/utils/internal/iron-crypto.ts` (somente se necessário) e os testes de sessão.
- Alterar o código do projeto neste PRD: este documento só descreve o comportamento esperado.

## Premissas e riscos

### Premissas

- **P1 — Suporte a mapa de senhas no iron.** `unsealSession` passa `config.password` para `unseal` (`src/utils/internal/iron-crypto.ts`), e esse módulo já aceita um objeto de senhas indexado pelo id do selo. A implementação pode reaproveitar esse mecanismo, mas isso precisa ser confirmado.
- **P2 — Senhas em string usam id `default`.** Todas as senhas em string recebem o mesmo id. Para distinguir qual senha selou o cookie, a implementação precisa atribuir ids diferentes a cada item da lista. A escolha desse mecanismo fica para a fase de implementação.
- **P3 — Expiração independente da senha.** `maxAge` e `idleTimeout` continuam medindo a vida da sessão, e a senha não entra nesse cálculo.
- **P4 — Mudança de tipo aceita.** Passar `password` de `string` para `string | string[]` é uma mudança de tipo, não de nome público. Quem usa string continua compilando.

### Riscos

- **R1 — Amplificação de custo (CPU).** Cada tentativa de abertura roda PBKDF2 (8192 iterações por padrão). Com N senhas, uma sessão inválida ou de senha antiga custa até N vezes mais. Um cookie forjado com id desconhecido pode fazer o servidor tentar todas as senhas. Mitigação possível: usar o id do selo para escolher a senha diretamente, sem tentar todas. Isso precisa ser medido antes de fechar a abordagem.
- **R2 — Combinação com `legacySealFallback`.** Se a abertura com a senha atual falhar, o fallback de 1 iteração pode multiplicar as tentativas por senha. O comportamento da combinação precisa ser testado.
- **R3 — Senha comprometida continua válida.** Enquanto uma senha estiver na lista, quem tiver um cookie selado com ela continua autenticado. Remover a senha só invalida as sessões dela depois que o prazo delas passar (ou imediatamente, se o time aceitar derrubar sessões).
- **R4 — Entropia das senhas antigas.** A regra de 32 caracteres vale para cada senha. Um time que mantém uma senha curta na lista enfraquece todas as sessões dela. A validação do RF-06 cobre isso.
- **R5 — Ordem de tentativa.** A ordem da lista só importa para a selagem. Abrir sessões tenta as senhas na ordem declarada, e isso deve ser descrito para quem configura a lista.
- **R6 — Escopo de testes.** A suíte roda nos modos `web` e `node` (`describeMatrix`). Os testes novos precisam cobrir os dois.
