# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta) e contrato `sdd/pedido.md` (#1050-a).

## Problema e objetivo

### Problema

Hoje `useSession` / `getSession` selam e abrem sessões com uma única senha, `SessionConfig.password` (`src/utils/session.ts`). Para trocar essa senha, por exemplo por rotação de segredos, todas as sessões seladas com a senha anterior deixam de abrir. Os usuários são deslogados de uma vez, e não existe um caminho de transição.

### Objetivo

Permitir a rotação de senhas sem invalidar sessões existentes. Em `SessionConfig.password`, passa a ser aceita uma lista não vazia de senhas: a primeira sela as sessões novas e as demais só abrem sessões já existentes. Quem usa uma única string não percebe nenhuma mudança.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `password`

`SessionConfig.password` aceita `string | string[]`, onde a lista deve ter ao menos uma senha.

- **Dado** uma configuração de sessão com `password: ["senha-nova", "senha-antiga"]`
- **Quando** a configuração é usada por `useSession` ou `getSession`
- **Então** a configuração é aceita sem erro de tipo nem de execução

### RF-02 — Selar sempre com a primeira senha

Toda sessão nova ou resselada é selada com a primeira senha da lista.

- **Dado** `password: ["senha-nova", "senha-antiga"]`
- **Quando** uma sessão é criada ou atualizada com `useSession`
- **Então** o cookie selado abre com `senha-nova` e não abre com `senha-antiga`

### RF-03 — Desselar tentando as senhas em ordem

Ao ler um cookie, as senhas são tentadas na ordem da lista. A primeira que validar a integridade do selo é usada.

- **Dado** um cookie selado com `senha-antiga` e uma configuração `password: ["senha-nova", "senha-antiga"]`
- **Quando** `getSession` lê esse cookie
- **Então** os dados da sessão são retornados corretamente, sem criar uma sessão nova

### RF-04 — Compatibilidade com senha única

Uma string em `password` continua se comportando exatamente como hoje.

- **Dado** `password: "senha-unica-com-32-caracteres-ou-mais"`
- **Quando** uma sessão é selada e depois lida
- **Então** o resultado é idêntico ao da versão atual, e a suíte existente em `test/session.test.ts` passa

### RF-05 — Rejeitar lista vazia

Uma lista vazia não é uma configuração válida.

- **Dado** `password: []`
- **Quando** a configuração é usada por `useSession` ou `getSession`
- **Então** é lançado um erro com mensagem clara indicando que ao menos uma senha é necessária

### RF-06 — Manter o fallback de selo legado para cada senha

O fallback de 1 iteração PBKDF2 (`legacySealFallback`) deve funcionar para cada senha da lista, e não só para a primeira.

- **Dado** um cookie legado selado com 1 iteração e com `senha-antiga`, e a configuração `password: ["senha-nova", "senha-antiga"]`
- **Quando** `getSession` lê o cookie
- **Então** a sessão é aberta, é marcada como selo legado e é resselada com `senha-nova`

### RF-07 — Sessão com senha fora da lista continua inválida

Uma sessão selada com uma senha que não está mais na lista não abre, e o comportamento é o mesmo de hoje.

- **Dado** um cookie selado com `senha-removida` e a configuração `password: ["senha-nova", "senha-antiga"]`
- **Quando** `getSession` lê o cookie
- **Então** a sessão é tratada como inexistente, como acontece hoje com uma senha errada

### RF-08 — Rotação gradual pelo reselo

Quando uma sessão antiga é resselada, por exemplo pelo deslizamento de `idleTimeout` ou pelo reselo de cookies legados, ela passa a ser selada com a senha nova. Assim a senha antiga pode ser removida da lista depois de um tempo.

- **Dado** um cookie selado com `senha-antiga` e a configuração `password: ["senha-nova", "senha-antiga"]`
- **Quando** `getSession` lê o cookie e o reselo acontece
- **Então** o cookie gravado na resposta abre com `senha-nova` e não abre com `senha-antiga`

## Fora de escopo

- A opção alternativa `extraUnsealPasswords` (primeira alternativa da issue). Esta variante usa só o campo `password`, e nenhum outro nome público novo deve ser criado.
- Rotação automática, agendada ou controlada por tempo. Quem configura a lista decide quando remover a senha antiga.
- Mudanças no formato do cookie, no algoritmo de selo (iron) ou nos parâmetros de PBKDF2 padrão.
- Remoção do fallback legado. Continua previsto para a v3, conforme o TODO em `src/utils/session.ts`.
- Validação de força das senhas além do que já existe. Premissa abaixo.
- Mudanças em outros utilitários de sessão, como cookies, `useSession` em outros runtimes ou WebSocket.

## Premissas e riscos

### Premissas

- A ordem da lista define a prioridade. A primeira senha sela, e as demais são tentadas só para desselar, nessa ordem.
- A validação de tamanho mínimo de 32 caracteres, documentada em `SessionConfig.password`, vale para cada senha da lista. Isso ainda precisa ser confirmado.
- A suíte existente (`test/session.test.ts`) e os critérios do pedido continuam valendo: `pnpm lint` e `pnpm typecheck` devem passar. Testes existentes só podem ser ajustados quando dependem diretamente do tipo `string` de `password`, sem perder o que verificam.
- Os testes devem seguir o padrão `describeMatrix`, com cobertura nos runtimes web e node.

### Riscos

- **Custo de CPU.** Cada senha tentada gera uma derivação PBKDF2 completa. Com N senhas, uma sessão antiga pode custar até N tentativas, e com o fallback legado o pior caso chega a 2N. Vale medir o impacto, principalmente com listas longas.
- **Mudança de tipo pública.** `password` passa de `string` para `string | string[]`. Código externo que lê `config.password` como string pode quebrar. Vale checar as chamadas internas (`sealSession`, `unsealSession`) e documentar a mudança.
- **Senha antiga esquecida.** Se a senha antiga nunca sair da lista, ela continua aceita indefinidamente. Isso enfraquece a rotação, e o risco deve ser documentado.
- **Lista com duplicadas ou com a mesma senha em posições diferentes.** Pode gerar tentativas redundantes. O comportamento esperado ainda precisa ser definido.
