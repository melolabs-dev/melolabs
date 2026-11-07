# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta), contrato em `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `sealSession` / `unsealSession` (`src/utils/session.ts`) usam uma única senha, `SessionConfig.password`, tanto para selar quanto para abrir a sessão. Ao trocar essa senha (rotação de segredo), todas as sessões seladas com a senha anterior passam a falhar na validação HMAC e os usuários são deslogados de uma vez.

### Objetivo

Permitir a rotação de senhas sem invalidar as sessões existentes: a senha atual continua selando, e uma lista opcional de senhas anteriores passa a ser aceita apenas para abrir sessões. Quando não houver senhas extras, o comportamento deve ser idêntico ao atual.

## Requisitos funcionais

### RF-01 — Abrir sessões selada com uma senha extra

O `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`. Quando uma sessão não abre com `password`, o sistema tenta as senhas de `extraUnsealPasswords`.

**Critério de aceite**

- **Dado** uma configuração com `password` = "A" e `extraUnsealPasswords` = ["B"], e um cookie de sessão selado com "B",
- **Quando** a sessão é lida com `useSession` ou `getSession`,
- **Então** a sessão é aberta e seus dados são retornados normalmente.

### RF-02 — Selar sempre com `password`

As senhas extras nunca são usadas para selar. Qualquer nova selagem (criação, escrita, reselagem por `idleTimeout` ou reselagem de sessão legada) usa `password`.

**Critério de aceite**

- **Dado** uma sessão aberta com a senha extra "B" em uma configuração com `password` = "A",
- **Quando** a sessão é escrita ou resselada,
- **Então** o novo selo é válido com "A" e não é mais aceito apenas com "B" quando se tenta abri-lo com `password` = "A" e sem extras.

### RF-03 — Ordem de tentativa e falha quando nenhuma senha serve

As senhas são tentadas nesta ordem: `password` primeiro, depois cada item de `extraUnsealPasswords` na ordem declarada. A primeira que abrir a sessão vence. Se nenhuma abrir, o erro lançado é o mesmo que é lançado hoje para uma sessão inválida.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords` = ["B", "C", "D"] e uma sessão selada com "C",
- **Quando** a sessão é aberta,
- **Então** ela é aberta, e a tentativa com "C" acontece depois das tentativas com "B" e antes de qualquer tentativa com "D".

- **Dado** uma configuração com `password` = "A" e `extraUnsealPasswords` = ["B"] e uma sessão selada com "Z",
- **Quando** a sessão é aberta,
- **Então** o erro é o mesmo que hoje se lança para uma sessão selada com outra senha (HMAC inválido), sem revelar qual senha foi tentada.

### RF-04 — Comportamento inalterado sem senhas extras

Sem `extraUnsealPasswords` (campo ausente ou vazio), o comportamento de `useSession`, `getSession`, `sealSession` e `unsealSession` não muda: mesmos dados, mesmos erros, mesmo fallback de selo legado (`legacySealFallback`).

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords` (ou com `[]`),
- **Quando** uma sessão selada com outra senha é aberta,
- **Então** o resultado e o erro são idênticos aos da versão atual do código, e a suíte existente em `test/` continua passando.

### RF-05 — Validação das senhas extras

Cada item de `extraUnsealPasswords` passa pela mesma validação aplicada a `password` (string vazia e tamanho mínimo). Um item inválido não pode ser ignorado silenciosamente.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords` = [""],
- **Quando** uma sessão é aberta,
- **Então** o sistema lança o mesmo erro que lançaria para um `password` vazio, em vez de simplesmente pular a senha.

### RF-06 — Selo legado com senhas extras

O fallback de selo legado (PBKDF2 com 1 iteração, controlado por `legacySealFallback`) vale também para as senhas extras: uma sessão legada selada com uma senha extra abre enquanto `legacySealFallback` não for `false`.

**Critério de aceite**

- **Dado** uma configuração com `password` = "A", `extraUnsealPasswords` = ["B"] e `legacySealFallback` ausente,
- **Quando** uma sessão legada selada com "B" e 1 iteração PBKDF2 é aberta,
- **Então** ela é aberta e marcada como legada, como acontece hoje para `password`.

- **Dado** a mesma configuração com `legacySealFallback: false`,
- **Quando** a mesma sessão é aberta,
- **Então** ela é rejeitada.

### RF-07 — Expiração continua valendo

`maxAge` e `idleTimeout` são aplicados depois de a sessão ser aberta, independentemente de qual senha a abriu. Uma sessão expirada não volta a ser válida por ter sido aberta com uma senha extra.

**Critério de aceite**

- **Dado** uma configuração com `maxAge` = 60, `extraUnsealPasswords` = ["B"] e uma sessão selada com "B" criada há 120 segundos,
- **Quando** a sessão é aberta,
- **Então** o sistema lança "Session expired!".

### RF-08 — Tipo e documentação públicos

O campo é opcional, tipado como `string[]`, documentado por JSDoc no `SessionConfig` (dizendo que é só para abrir, que não sela e que `password` continua sendo a senha de selagem). Nenhum outro nome público novo é exportado.

**Critério de aceite**

- **Dado** o código após a mudança,
- **Quando** `pnpm typecheck` e `pnpm lint` são executados,
- **Então** ambos passam, e o campo `extraUnsealPasswords` aparece em `SessionConfig` com JSDoc, e nenhum novo export é adicionado a `src/index.ts` ou `src/utils/session.ts`.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050).
- Rotação automática, agendada ou por tempo; a lista de senhas extras é configurada manualmente pelo usuário da biblioteca.
- Reselar em massa ou migrar sessões existentes fora do fluxo normal de leitura/escrita.
- Mudanças no formato do selo (iron), nos algoritmos padrão ou no número de iterações PBKDF2.
- Remoção do `legacySealFallback` (fica para v3, como indicado no código).
- Mudanças no transporte da sessão (cookie, chunking de cookie, header `x-h3-session`) além do que for necessário para a nova lógica de unseal.
- Alterações nos utilitários de selo que não sejam o fluxo de sessão.

## Premissas e riscos

### Premissas

- `password` é string e, no iron, o selo usa identificador de senha vazio; as senhas extras usam o mesmo formato, então o unseal com cada uma delas funciona sem mudar o formato do token.
- A lista de senhas extras é pequena (algumas unidades). Não há limite imposto pelo contrato.
- A remoção de uma senha antiga da lista é feita pelo usuário da biblioteca, depois que as sessões seladas com ela já expiraram (`maxAge` ou `idleTimeout`).
- Os testes existentes em `test/` cobrem o comportamento sem extras; se algum precisar de ajuste, o ajuste deve manter o que o teste verifica.

### Riscos

- **Custo de CPU:** cada senha tentada faz uma derivação PBKDF2 (padrão de 8192 iterações). Com N senhas extras, uma sessão selada com a última custa até N+1 derivações, e uma requisição com token inválido custa todas elas. Mitigação: documentar no JSDoc e manter a lista curta.
- **Janela de comprometimento:** senhas antigas que continuam na lista mantêm válidas as sessões seladas com elas. Se a senha antiga vazou, as sessões dela continuam aceitas até expirarem. Mitigação: documentar que a remoção deve acompanhar o TTL das sessões.
- **Vazamento de informação:** a ordem de tentativa e o tempo de resposta podem indicar qual senha abriu a sessão. Mitigação: o erro é o mesmo para todas as falhas (RF-03). O tempo não é tratado pelo contrato.
- **Reselagem muda o cookie:** uma sessão aberta com senha extra e resselada recebe um novo cookie. Requisições paralelas com o cookie antigo continuam sendo abertas pela senha extra, então não há erro, só troca de valor.
- **Validação divergente:** se a validação de `extraUnsealPasswords` não for a mesma de `password`, uma senha curta pode funcionar só como extra. RF-05 existe para evitar isso.
