# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela), contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

### Problema

As sessões do H3 são seladas com uma única senha, `password`, configurada em `SessionConfig` (`src/utils/session.ts`). Quando essa senha é trocada, todas as sessões seladas com a senha anterior deixam de ser abertas: `unsealSession` falha e o usuário é deslogado. Quem precisa girar segredos (rotação de chaves) não tem como fazer isso sem invalidar as sessões ativas.

### Objetivo

Permitir que `SessionConfig` declare senhas anteriores, usadas apenas para abrir sessões, de modo que a rotação de `password` não invalide as sessões existentes. A senha atual continua sendo a única usada para selar. Sem a configuração nova, o comportamento não muda.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`. O campo é aceito por `useSession`, `getSession` e pelos demais pontos que recebem `SessionConfig`.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `A`,
- **Quando** o app é configurado com `password: "B"` e `extraUnsealPasswords: ["A"]` e a requisição traz o cookie dessa sessão,
- **Então** `getSession` devolve os dados da sessão original, sem erro.

### RF-02 — `password` continua sendo a única senha de selagem

Novas sessões e reselagens (sliding de `idleTimeout`, reselagem de cookies legados) são seladas exclusivamente com `password`. As senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** a configuração `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Quando** uma sessão selada com `A` é lida e reselada pela própria H3 (por exemplo, ao atualizar a sessão),
- **Então** o cookie resultante pode ser aberto com `B` e não pode ser aberto apenas com `A`.

### RF-03 — Ordem de tentativa das senhas

Ao abrir uma sessão, a H3 tenta `password` primeiro e depois cada item de `extraUnsealPasswords`, na ordem declarada. A primeira senha que abrir a sessão é a usada.

**Critério de aceite**

- **Dado** `password: "B"` e `extraUnsealPasswords: ["A", "C"]`,
- **Quando** uma sessão selada com `C` é lida,
- **Então** a leitura tem sucesso após tentar `B` e `A`, sem erro.

### RF-04 — Fallback de sessões legadas com as senhas extras

O fallback de sessões seladas com 1 iteração PBKDF2 (`legacySealFallback`) também é aplicado a cada senha extra. Uma sessão legada selada com uma senha extra é aberta e reselada com `password`.

**Critério de aceite**

- **Dado** uma sessão legada (1 iteração) selada com a senha `A`, e a configuração `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Quando** a sessão é lida,
- **Então** ela é aberta e o cookie é reselado com `B` com as opções atuais.

### RF-05 — Falha com todas as senhas mantém o comportamento atual

Se nenhuma senha (`password` ou extras) abrir a sessão, o resultado é o mesmo de hoje quando `password` está errada: a sessão é tratada como inexistente e substituída por uma nova, sem vazar a causa do erro para o cliente.

**Critério de aceite**

- **Dado** `password: "B"` e `extraUnsealPasswords: ["A"]`,
- **Quando** o cookie foi selado com `Z`, que não está configurada,
- **Então** `getSession` devolve uma sessão vazia (sem `id`) e nenhuma exceção chega ao handler.

### RF-06 — Retrocompatibilidade sem senhas extras

Quando `extraUnsealPasswords` não é informado ou é um array vazio, o comportamento de `useSession`, `getSession`, `sealSession` e `unsealSession` é idêntico ao atual, inclusive nos testes existentes.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes passam sem alteração de asserções.

### RF-07 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue a mesma regra de `password` (string não vazia, com o tamanho mínimo que a implementação de selagem já exige). Um item inválido falha na configuração, não na leitura de um cookie.

**Critério de aceite**

- **Dado** `extraUnsealPasswords: [""]` ou um item com menos caracteres que o mínimo exigido para `password`,
- **Quando** a sessão é configurada,
- **Então** a configuração é rejeitada com erro claro, antes de qualquer requisição.

*Nota:* a regra exata de `password` deve ser confirmada no código de `iron-crypto.ts` durante a implementação (ver Premissas).

### RF-08 — Funciona em todos os runtimes da matriz de testes

O comportamento de RF-01 a RF-05 é o mesmo nos alvos `web` e `node` do `describeMatrix`.

**Critério de aceite**

- **Dado** os testes novos de sessão escritos com `describeMatrix`,
- **Quando** `pnpm vitest run` é executado para o arquivo de sessão,
- **Então** os casos passam nos dois alvos (`web` e `node`).

### RF-09 — Tipos públicos sem nomes novos

Além de `extraUnsealPasswords` dentro de `SessionConfig`, nenhum tipo, função ou export público novo é criado. `password` continua sendo `string`.

**Critério de aceite**

- **Dado** o `index.ts` e os tipos exportados de `src/utils/session.ts` antes e depois da mudança,
- **Quando** a diferença de exports é comparada,
- **Então** a única adição de API pública é a propriedade `extraUnsealPasswords` em `SessionConfig`.

### RF-10 — Documentação do campo

O campo tem comentário JSDoc em `SessionConfig` explicando que as senhas são só para abrir sessões, que a ordem de tentativa é `password` e depois as extras, e que a remoção de uma senha antiga invalida as sessões que dependem dela.

**Critério de aceite**

- **Dado** o tipo `SessionConfig`,
- **Quando** o desenvolvedor passa o cursor sobre `extraUnsealPasswords` na IDE,
- **Então** o JSDoc descreve o comportamento acima.

## Fora de escopo

- `password` como array (a segunda alternativa da issue). Não será implementada.
- Mudança do algoritmo de selagem ou das iterações PBKDF2 padrão.
- Remoção do fallback legado (`legacySealFallback`), que continua previsto para a v3.
- Automação de rotação de chaves, agendamento ou armazenamento de segredos.
- Expiração automática de senhas extras por tempo. A duração de uma senha antiga continua limitada por `maxAge` e `idleTimeout` das próprias sessões.
- Mudanças em `useSession` além da passagem do novo campo para `getSession`.
- Atualização da documentação do site fora do JSDoc.

## Premissas

- A solução segue o contrato de `sdd/pedido.md`: `extraUnsealPasswords: string[]` é um campo opcional de `SessionConfig`, `password` continua `string`, e não há outros nomes públicos novos.
- Todas as sessões são seladas e abertas pelo mesmo `unsealSession` / `sealSession`, então cookies simples, cookies em partes (chunked) e a leitura pelo header de sessão passam pelo mesmo caminho de unseal e são cobertos pelo mesmo código.
- A suíte atual de sessões passa antes da mudança e serve de base para RF-06.
- `pnpm lint` e `pnpm typecheck` são exigidos ao final.
- A validação de tamanho mínimo de senha (RF-07) é feita hoje na camada de selagem; isso ainda precisa ser confirmado antes de implementar.

## Riscos

- **Amplificação de custo (DoS).** Cada senha extra é uma tentativa de unseal com PBKDF2. Um cookie que não abre com nenhuma senha custa `1 + N` operações, e com o fallback legado o custo sobe para até `2 × (1 + N)`. Um atacante que envia cookies inválidos pode aumentar o CPU por requisição. Mitigação: limitar o número de senhas extras na documentação, medir o custo com N = 1, 3 e 5, e considerar não aplicar as extras quando o cookie falhar na verificação de formato antes do PBKDF2.
- **Senhas antigas que nunca saem.** Como uma senha extra fica configurada até ser removida pelo desenvolvedor, sessões antigas continuam válidas enquanto ela estiver na lista. Mitigação: JSDoc e documentação explicando o procedimento de rotação (adicionar a nova como `password`, mover a antiga para as extras, e removê-la após `maxAge`).
- **Reselagem silenciosa.** Uma sessão aberta com senha extra é resealada com `password` ao ser lida (RF-02). Isso é desejado, mas significa que a migração depende de as sessões serem lidas. Sessões que não voltam ao app continuam com a senha antiga até expirarem.
- **Mensagens de erro.** Testes existentes podem verificar mensagens como `Bad hmac value`. A ordem de tentativa pode mudar qual erro é lançado quando todas as senhas falham. Mitigação: manter o erro da primeira senha quando todas falham (RF-05) e revisar os asserts existentes antes de alterá-los.
- **Custo de manutenção do fallback legado.** Combinar extras com `legacySealFallback` aumenta a complexidade de `unsealSession`, que já tem um fallback com TODO para a v3. Mitigação: extrair a tentativa de unseal para uma função que aceita a lista de senhas, para que o fallback reaproveite a mesma lógica.
