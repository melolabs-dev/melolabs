# PRD: várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050, primeira alternativa (campo novo `extraUnsealPasswords`). Contrato: `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession`, `getSession` e `updateSession` (em `src/utils/session.ts`) selam e abrem sessões com uma única senha, `SessionConfig.password`. Para trocar essa senha (rotação de segredo), há duas opções ruins:

- Trocar a senha de uma vez: todas as sessões ativas deixam de abrir e os usuários são desconectados.
- Manter a senha antiga indefinidamente: o segredo antigo nunca sai de uso.

### Objetivo

Permitir que o desenvolvedor declare senhas anteriores que **só abrem** sessões, enquanto a senha atual continua a única usada para selar. Assim a rotação não derruba sessões existentes, e a configuração atual continua funcionando sem mudanças.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, com documentação JSDoc explicando que são senhas anteriores usadas apenas para abrir sessões.

**Critério de aceite**

- **Dado** uma configuração de sessão sem o campo `extraUnsealPasswords`
- **Quando** o tipo `SessionConfig` é verificado pelo TypeScript
- **Então** a configuração é válida, e nenhum outro nome público novo é exigido.

### RF-02 — Sessão selada com a senha atual continua válida

**Critério de aceite**

- **Dado** uma sessão selada com `password` e uma configuração com `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a requisição chega com esse cookie (ou com o cabeçalho de sessão)
- **Então** `getSession` retorna a sessão original, com os mesmos `id`, `createdAt` e `data`.

### RF-03 — Sessão selada com uma senha extra é aberta

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"`, e uma configuração em que `password` é `"senha-nova"` e `extraUnsealPasswords` é `["senha-antiga"]`
- **Quando** a requisição chega com esse cookie
- **Então** a sessão é aberta e seus dados ficam disponíveis, como se tivesse sido selada com a senha atual.

### RF-04 — Senhas extras nunca selam

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** `updateSession` ou `sealSession` grava uma sessão
- **Então** o cookie resultante é aberto com `"senha-nova"` e **não** é aberto com `"senha-antiga"`.

### RF-05 — Senha desconhecida continua inválida

**Critério de aceite**

- **Dado** uma sessão selada com uma senha que não está em `password` nem em `extraUnsealPasswords`
- **Quando** a requisição chega com esse cookie
- **Então** a sessão é tratada como inválida, do mesmo jeito que hoje: `getSession` cria uma sessão nova em memória e não expõe dados da sessão anterior.

### RF-06 — Sem senhas extras, o comportamento não muda

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`, ou com `extraUnsealPasswords: []`
- **Quando** qualquer sessão existente é lida ou gravada
- **Então** o resultado é idêntico ao da versão atual, e a suíte existente de sessões continua passando sem alteração de asserções.

### RF-07 — Expiração continua valendo com qualquer senha

**Critério de aceite**

- **Dado** uma sessão selada com uma senha extra, cujo `createdAt` está além de `maxAge` (ou cujo `lastSeenAt` está além de `idleTimeout`)
- **Quando** a requisição chega
- **Então** a sessão é rejeitada como expirada, do mesmo jeito que sessões seladas com a senha atual.

### RF-08 — Regravação usa a senha atual

**Critério de aceite**

- **Dado** uma sessão aberta com uma senha extra
- **Quando** a aplicação grava essa sessão com `update` (ou ocorre o deslizamento de `idleTimeout`)
- **Então** o novo cookie é selado com `password`, e a senha extra deixa de ser necessária para aquela sessão.

### RF-09 — Cobertura de testes

**Critério de aceite**

- **Dado** a suíte de testes de sessão, que usa `describeMatrix` (web e node)
- **Quando** a suíte roda com `pnpm vitest run` nos arquivos de sessão
- **Então** há casos cobrindo RF-02 a RF-08 nos dois modos, e `pnpm lint` e `pnpm typecheck` passam.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050).
- Identificar a senha por id (`kid`) dentro do cookie, ou usar o objeto de senha com ids do iron. Nesta versão a tentativa é sequencial.
- Rotação automática, agendada ou com prazo de validade para as senhas extras.
- Ferramenta ou API para regravar em massa as sessões antigas.
- Mudanças em algoritmos, iterações PBKDF2 ou opções de `seal`.
- Mudanças em outros utilitários (cookies, `useSession` além do campo novo, auth, JWT).
- Mudanças em v1 ou em `_deprecated.ts`.
- Remoção do `legacySealFallback` (fica para v3, como já anotado no código).

## Premissas

- Hoje a selagem usa uma senha de id `default`, e o iron aceita senha em string. Por isso, a abertura com várias senhas é feita **tentando cada senha em ordem** (atual primeiro, depois as extras na ordem declarada), e não por id.
- A lista vazia ou ausente equivale a não ter o campo.
- A senha extra é uma string com o mesmo formato e a mesma exigência de entropia de `password` (no mínimo 32 caracteres, conforme a documentação atual).
- Não há migração forçada: uma sessão antiga continua aberta com a senha extra até ser regravada, o que acontece naturalmente em escritas ou no deslizamento.
- A ordem de tentativa não afeta o resultado, porque cada senha valida o HMAC do cookie inteiro.

## Riscos

- **Custo de CPU.** Cada tentativa de abertura deriva chaves com PBKDF2 (8192 iterações por padrão). Um cookie inválido passa por todas as senhas antes de ser rejeitado, então o custo cresce com o número de senhas extras. Isso pode ser abusado com cookies forjados. Mitigação a avaliar: limitar a quantidade de senhas extras na validação ou documentar o custo.
- **Falha silenciosa com senha curta.** `generateKey` lança erro para senhas abaixo do tamanho mínimo, e `getSession` captura erros de `unsealSession`. Uma senha extra curta faria as sessões dela sumirem sem aviso. Mitigação: validar o tamanho de cada senha extra na configuração e lançar erro claro.
- **Senhas antigas que nunca saem.** Uma senha extra que fica na configuração indefinidamente mantém válido um segredo antigo, possivelmente vazado. A documentação deve deixar claro que a remoção é manual e que é o fim da janela de aceitação.
- **Interação com `legacySealFallback`.** A tentativa de fallback de 1 iteração PBKDF2 hoje ocorre só para a senha atual. Com senhas extras, é preciso definir se o fallback também vale para elas, e testar as combinações. Recomendação: aplicar o fallback a cada senha, na mesma ordem.
- **Regressão em sessões existentes.** Mudanças em `unsealSession` afetam todo o fluxo de leitura. RF-06 e a suíte atual são a rede de segurança.
