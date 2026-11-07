# PRD — Múltiplas senhas de unseal nas sessões (h3js/h3#1050, variante B)

## Problema e objetivo

Hoje `useSession` / `getSession` / `updateSession` (`src/utils/session.ts`) usam uma única senha (`SessionConfig.password`) para selar e desselar o cookie (ou o header) de sessão. Ao trocar a senha por rotação de segredos, todas as sessões seladas com a senha anterior deixam de abrir, e o usuário é desconectado.

A issue h3js/h3#1050 pede que as sessões seladas com senhas anteriores continuem válidas. Esta variante resolve o caso pelo próprio campo `password`:

- `password` aceita `string | string[]`.
- Na lista, a primeira senha sela novas sessões; as demais servem apenas para desselar.

**Objetivo:** permitir a rotação de senhas de sessão sem invalidar sessões existentes, sem novos nomes públicos e sem quebrar o uso com uma senha só.

## Requisitos funcionais

### RF-01 — Aceitar lista de senhas em `SessionConfig.password`

O campo `password` passa a aceitar `string` ou `string[]` não vazio.

**Critério de aceite**

- **Dado** uma configuração com `password: ["nova-senha-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`,
- **Quando** a configuração é passada para `useSession`,
- **Então** a chamada compila sem erro de tipo e a sessão é criada normalmente.

### RF-02 — Selar sempre com a primeira senha

Toda sessão selada (novas sessões, resels por escrita ou por deslizamento de `idleTimeout`, e resels de sessões legadas) usa a primeira senha da lista.

**Critério de aceite**

- **Dado** `password: ["A", "B"]` e uma sessão nova,
- **Quando** a sessão é gravada com `updateSession`,
- **Então** o cookie abre com `A` e não abre com `B` isoladamente.

### RF-03 — Desselar tentando as senhas na ordem da lista

Ao ler uma sessão, o sistema tenta desselar com cada senha, na ordem, e usa a primeira que validar.

**Critério de aceite**

- **Dado** um cookie selado com `B` e a configuração `password: ["A", "B"]`,
- **Quando** uma requisição com esse cookie chama `getSession`,
- **Então** a sessão é carregada com os dados originais, com `id` e `createdAt` preservados.

### RF-04 — Nenhuma senha da lista abre o cookie

Se nenhuma senha validar o cookie, o comportamento é o mesmo de hoje para uma senha errada: a sessão é tratada como inexistente e uma nova é iniciada.

**Critério de aceite**

- **Dado** um cookie selado com `C` e a configuração `password: ["A", "B"]`,
- **Quando** uma requisição com esse cookie chama `getSession`,
- **Então** a sessão retornada é nova (com `id` diferente do cookie), sem dados do cookie original, e nenhum erro não tratado é lançado.

### RF-05 — Compatibilidade com senha única

Com `password` como string, o comportamento é idêntico ao atual: mesmo formato selado, mesmo tratamento de erro e mesmo número de tentativas de unseal.

**Critério de aceite**

- **Dado** a configuração `password: "senha-unica-com-32-caracteres-ou-mais"`,
- **Quando** a suíte existente de sessões é executada,
- **Então** todos os testes passam sem alteração de expectativas.

### RF-06 — Lista vazia é rejeitada

Uma lista vazia não é uma configuração válida.

**Critério de aceite**

- **Dado** `password: []`,
- **Quando** `useSession` ou `getSession` é chamado,
- **Então** a chamada lança um erro com mensagem clara indicando que a lista de senhas está vazia.

### RF-07 — Expiração independe da senha que abriu a sessão

`maxAge` e `idleTimeout` são aplicados da mesma forma, qualquer que seja a senha da lista que abriu a sessão.

**Critério de aceite**

- **Dado** um cookie selado com `B` cujo `createdAt` ultrapassa `maxAge`, e a configuração `password: ["A", "B"]`,
- **Quando** uma requisição com esse cookie chama `getSession`,
- **Então** a sessão é tratada como expirada, da mesma forma que com a senha `B` sozinha.

### RF-08 — Sessões legadas (1 iteração PBKDF2) continuam abrindo

O fallback de sessões seladas com 1 iteração de PBKDF2 funciona para qualquer senha da lista, respeitando `legacySealFallback`.

**Critério de aceite**

- **Dado** um cookie legado selado com `B` com 1 iteração, e a configuração `password: ["A", "B"]` com `legacySealFallback` não definido,
- **Quando** uma requisição com esse cookie chama `getSession`,
- **Então** a sessão é carregada, e o cookie é resselado com `A` e as opções atuais.

- **Dado** a mesma situação com `legacySealFallback: false`,
- **Quando** a mesma requisição é feita,
- **Então** a sessão não é carregada (nova sessão), como hoje com senha única.

### RF-09 — Rotação sem invalidar sessões ativas

Ao trocar a senha, as sessões existentes continuam válidas enquanto a senha antiga estiver na lista. Ao remover a senha antiga da lista, as sessões seladas com ela deixam de abrir.

**Critério de aceite**

- **Dado** uma sessão selada com `A` e a configuração `password: "A"`,
- **Quando** a configuração muda para `password: ["B", "A"]` e a requisição é feita,
- **Então** a sessão continua válida e, na próxima escrita, é resselada com `B`.

- **Dado** a mesma sessão e a configuração mudada para `password: "B"`,
- **Quando** a requisição é feita,
- **Então** a sessão é tratada como inexistente.

## Fora de escopo

- Novos nomes públicos (por exemplo, `extraUnsealPasswords`). A alternativa da issue não entra nesta variante.
- Forçar o resel de todas as sessões ao trocar a senha. A sessão é resselada só quando for escrita ou quando já houver resel por outro motivo.
- Gerenciamento de chaves: geração, armazenamento, rotação automática ou agendamento de troca de senhas.
- Mudanças no formato selado (`iron-crypto`) ou nos algoritmos padrão.
- Mudanças no `h3/rules`, nos adaptadores de plataforma ou em outros módulos além de `src/utils/session.ts` e seus tipos.
- Remoção do fallback de 1 iteração (`legacySealFallback`), que continua previsto para a v3.
- Validação de força das senhas além da regra atual (mínimo de 32 caracteres) — ver premissas.

## Premissas

- A regra atual de tamanho mínimo (32 caracteres) vale para cada senha da lista. Isso precisa ser confirmado no código de `iron-crypto` antes da implementação.
- `unseal` e `seal` de `src/utils/internal/iron-crypto.ts` continuam recebendo uma senha por chamada. A lista é tratada em `session.ts`, sem mudar a assinatura interna.
- Para a ordem de tentativas, a recomendação é: primeiro tentar todas as senhas com as opções atuais; só depois, se o fallback legado estiver ativo, tentar todas com 1 iteração. Isso evita o fallback caro e ambíguo quando a senha correta já abriria a sessão.
- Não é necessário guardar a senha que selou a sessão no cookie; a ordem da lista é a única fonte de verdade.
- A suíte de testes é executada com `describeMatrix` (web e node), conforme `AGENTS.md`.
- Restrições da issue: sem novos nomes públicos, sem quebra para senha única, e `pnpm lint` e `pnpm typecheck` precisam passar. A suíte existente só é ajustada onde a mudança alterar o que ela verifica, sem perder cobertura.

## Riscos

- **Amplificação de custo (DoS leve):** cada senha da lista é uma tentativa de unseal com PBKDF2 (8192 iterações por padrão). Um cookie inválido em uma configuração com N senhas custa N unseals, e com o fallback legado, até 2N. Mitigação: manter a lista curta e documentar o custo.
- **Senha antiga continua válida enquanto estiver na lista:** quem tiver uma senha vazada pode forjar sessões enquanto ela estiver na lista. A documentação precisa deixar claro que a remoção da senha é o único meio de revogação.
- **Erro de tipo em consumidores:** `SessionConfig.password` deixa de ser só `string`. Código que lê `config.password` como string (em testes, plugins ou no `h3/rules`) pode quebrar. Verificar buscas por `.password` antes de mudar o tipo.
- **Ambiguidade de erro:** com várias tentativas, o erro de "Bad hmac value" pode mascarar falhas reais (por exemplo, um seal corrompido). Testar que um cookie corrompido ainda vira nova sessão, como hoje.
- **Interação com `legacySealFallback`:** o fallback hoje só retenta quando a mensagem é "Bad hmac value". Com a lista, é preciso garantir que o retry não tente com todas as senhas duas vezes sem necessidade.
- **`isolatedDeclarations`:** o tipo `string | string[]` precisa de anotação explícita em `SessionConfig`, senão a geração de declarações falha no build.
