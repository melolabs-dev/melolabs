# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## 1. Problema e objetivo

### Problema
Em `src/utils/session.ts`, `SessionConfig.password` é a única senha usada para selar e abrir sessões. Ao rotacionar a senha, todas as sessões já emitidas deixam de abrir (`unseal` falha) e os usuários perdem a sessão. Hoje não há como trocar a senha mantendo as sessões antigas válidas.

### Objetivo
Permitir a rotação de senhas sem invalidar sessões existentes, com um campo opcional novo em `SessionConfig`:

- `extraUnsealPasswords?: string[]` — senhas anteriores, usadas **somente para abrir** sessões.
- `password` continua `string` e continua sendo a única senha que sela.
- Sem `extraUnsealPasswords`, o comportamento é idêntico ao atual.

Referência: issue h3js/h3#1050, primeira alternativa proposta (campo adicional). A alternativa de `password` como array está fora desta variante.

## 2. Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` em `SessionConfig`
`SessionConfig` expõe `extraUnsealPasswords?: string[]`, documentado em JSDoc como senhas que só abrem sessões. Nenhum outro nome público é adicionado.

**Critério de aceite**
- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: ["antiga"]`
- **Quando** o código é verificado por tipos (`pnpm typecheck`)
- **Então** a configuração é aceita, `password` continua tipado como `string`, e nenhuma outra exportação pública nova existe.

### RF-02 — Selagem usa apenas `password`
`sealSession` (e portanto `updateSession`/cookie) sela sempre com `config.password`, nunca com uma senha extra.

**Critério de aceite**
- **Dado** uma config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** uma sessão é selada via `sealSession` ou gravada em cookie por `updateSession`
- **Então** o valor selado só abre com `"nova"` e não abre com `"antiga"` isoladamente.

### RF-03 — Abertura aceita sessões seladas com senhas extras
`unsealSession` tenta `password` primeiro e, se falhar por senha/integridade, tenta cada item de `extraUnsealPasswords` na ordem informada, retornando o primeiro sucesso.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e uma config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession`/`useSession` lê o cookie ou o cabeçalho de sessão
- **Então** os dados da sessão (`id`, `data`) são recuperados normalmente.

### RF-04 — Senha desconhecida continua rejeitada
Uma sessão selada com senha que não está em `password` nem em `extraUnsealPasswords` não é aceita; o erro original é preservado e o fluxo atual (sessão nova) permanece.

**Critério de aceite**
- **Dado** uma sessão selada com `"outra"` e uma config sem essa senha em nenhum campo
- **Quando** `getSession` lê essa sessão
- **Então** a sessão não é restaurada e uma nova sessão (novo `id`) é criada, como hoje.

### RF-05 — Sessão aberta com senha extra é re-selada com `password`
Quando a sessão veio de cookie e foi aberta com senha extra, ela é re-selada proativamente com a senha atual (mesmo mecanismo do reseal de `kLegacySeal`/`shouldSlide`), para que a senha antiga possa ser aposentada depois.

**Critério de aceite**
- **Dado** um cookie de sessão selado com `"antiga"` e config com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`
- **Quando** `getSession` lê a sessão a partir do cookie
- **Então** a resposta traz `Set-Cookie` com valor que abre com `"nova"`; para sessão vinda de cabeçalho, nenhum cookie é emitido (como hoje).

### RF-06 — Expiração e demais validações valem para senhas extras
`maxAge` e `idleTimeout` são aplicados após a abertura, independentemente de qual senha abriu a sessão. Erros de expiração não provocam novas tentativas com outras senhas.

**Critério de aceite**
- **Dado** uma sessão expirada (`maxAge`) selada com senha extra
- **Quando** `getSession` a lê
- **Então** ela é rejeitada como expirada e uma nova sessão é criada.

### RF-07 — Compatibilidade com o fallback legado de iterações
O fallback `legacySealFallback` (iterações = 1) continua funcionando para `password` e também para senhas extras; `legacySealFallback: false` o desativa para todas.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` usando 1 iteração PBKDF2 e config com essa senha em `extraUnsealPasswords`
- **Quando** `getSession` a lê a partir do cookie
- **Então** a sessão é restaurada e re-selada com `password` e as opções atuais.

### RF-08 — Sem regressão sem senhas extras
Com `extraUnsealPasswords` ausente ou `[]`, o comportamento (resultados, cookies, erros) é idêntico ao atual.

**Critério de aceite**
- **Dado** uma config sem `extraUnsealPasswords`
- **Quando** a suíte existente de sessões (`test/session.test.ts` e correlatos) é executada
- **Então** todos os testes passam, e quaisquer ajustes feitos em testes existentes preservam o que eles verificam.

### RF-09 — Cobertura de testes e qualidade
Há testes novos (via `describeMatrix`) cobrindo RF-02 a RF-07, escritos primeiro e vistos falhar antes da implementação.

**Critério de aceite**
- **Dado** a implementação concluída
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam sem erros.

## 3. Fora de escopo

- `password` aceitar `string[]` (segunda alternativa da issue).
- Qualquer nome público novo além de `SessionConfig.extraUnsealPasswords`.
- Mecanismo de rotação automática, armazenamento de senhas ou gestão de segredos.
- Mudanças em `iron-crypto`, no formato do selo ou nas opções de seal padrão.
- Alterar o comportamento de `clearSession` ou do formato dos cookies.
- Documentação além do JSDoc do campo (salvo se já houver doc de sessões a atualizar).

## 4. Premissas e riscos

### Premissas
- A ordem de tentativa é `password` e depois `extraUnsealPasswords` na ordem do array; array vazio equivale a ausente.
- Todas as senhas obedecem às mesmas regras de `password` (ex.: tamanho mínimo exigido por `iron-crypto`).
- Re-selar sessões vindas de cookie é desejável e não altera `createdAt`/`id`.

### Riscos
- **Custo de CPU:** cada tentativa falha faz PBKDF2 (8192 iterações) e, com o fallback legado, dobra; N senhas extras podem multiplicar o custo por requisição com cookie inválido (vetor de abuso). Mitigação: documentar que a lista deve ser curta e distinguir erros de senha/HMAC de erros de expiração para não tentar à toa.
- **Mascarar erros:** ao tentar várias senhas, o erro retornado deve ser o da primeira tentativa (`password`) para manter mensagens atuais.
- **Segredo vazado nas extras:** senhas antigas comprometidas continuam abrindo sessões até serem removidas; o re-selamento (RF-05) reduz o tempo de permanência, mas a remoção é responsabilidade do operador.
- **Sessões por cabeçalho** não são re-seladas (comportamento atual), então dependem de a senha extra permanecer configurada.
- **Testes existentes** que assumam falha de unseal com senha diferente ou o número de `Set-Cookie` podem precisar de ajuste cuidadoso.
