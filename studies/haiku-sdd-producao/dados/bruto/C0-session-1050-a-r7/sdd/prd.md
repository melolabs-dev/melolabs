# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## Problema e objetivo

**Problema.** Hoje `SessionConfig.password` (`src/utils/session.ts`) é uma única `string`. Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de abrir (`unsealSession` falha, `getSession` descarta a sessão e cria outra), deslogando todos os usuários de uma vez.

**Objetivo.** Permitir a rotação de senha sem invalidar sessões existentes. `password` passa a aceitar também uma lista não vazia de senhas: a primeira sela, as demais só abrem sessões. Nenhuma opção nova é criada (segunda alternativa da issue #1050). Quem usa uma `string` não percebe diferença.

**Resultado esperado.** Um operador troca `password: "nova"` por `password: ["nova", "antiga"]`; sessões antigas continuam válidas e as novas passam a ser seladas com `"nova"`.

## Requisitos funcionais

### RF-01 — `password` aceita `string | string[]`

`SessionConfig.password` passa a ter o tipo `string | string[]`. Uma `string` tem o comportamento atual. Nenhum outro nome público é adicionado.

**Critério de aceite**
- **Dado** uma configuração com `password` como `string` ou como `string[]` não vazio,
- **Quando** ela é passada a `useSession`, `getSession`, `updateSession`, `sealSession` ou `unsealSession`,
- **Então** o código compila (typecheck) sem erros nos dois formatos.

### RF-02 — Selagem usa somente a primeira senha

Em `sealSession` (e, por consequência, em `updateSession`, `useSession` e no reseal automático), o selo é sempre feito com a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: ["nova", "antiga"]`,
- **Quando** uma sessão é criada ou atualizada e o valor selado é gerado,
- **Então** esse valor abre com `password: "nova"` isolada e não abre com `password: "antiga"` isolada.

### RF-03 — Abertura tenta todas as senhas, na ordem

`unsealSession` tenta a primeira senha e, se falhar, as seguintes, na ordem da lista. A sessão é aceita com a primeira senha que funcionar.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e `password: ["nova", "antiga"]`,
- **Quando** a requisição chega com o cookie (ou o header de sessão) dessa sessão,
- **Então** `getSession` devolve a mesma sessão (mesmo `id` e `data`), sem criar uma nova.

### RF-04 — Senha fora da lista continua rejeitada

Uma sessão selada com senha que não está na lista é tratada como inválida, como hoje.

**Critério de aceite**
- **Dado** uma sessão selada com `"removida"` e `password: ["nova", "antiga"]`,
- **Quando** a requisição chega com esse cookie,
- **Então** a sessão é descartada e uma nova é iniciada (novo `id`), sem lançar erro para o handler.

### RF-05 — Lista vazia é inválida

Uma lista vazia não tem senha para selar, então é erro de configuração e não pode falhar em silêncio.

**Critério de aceite**
- **Dado** `password: []`,
- **Quando** a sessão é selada ou aberta,
- **Então** é lançado um erro explícito e claro, e nenhuma sessão é criada ou aceita.

### RF-06 — Sessões abertas com senha antiga migram para a nova

Quando a sessão abre com uma senha que não é a primeira, o `getSession` a re-sela com a primeira senha (por cookie, como já acontece com o seal legado), para que a senha antiga possa ser aposentada depois.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` e `password: ["nova", "antiga"]`, vinda de cookie,
- **Quando** `getSession` a lê,
- **Então** a resposta traz `Set-Cookie` cujo valor abre com `password: "nova"` isolada. Uma sessão aberta com a primeira senha não gera `Set-Cookie` extra por esse motivo.

### RF-07 — Compatibilidade com os demais mecanismos de sessão

O comportamento de `maxAge`, `idleTimeout`, `legacySealFallback`, `seal`, header de sessão e cookies em partes (chunked) vale igual para qualquer senha da lista. O fallback de seal legado (1 iteração PBKDF2) também é tentado com cada senha.

**Critério de aceite**
- **Dado** uma sessão selada com `"antiga"` (inclusive com o seal legado de 1 iteração) e `password: ["nova", "antiga"]`,
- **Quando** ela é lida, com `maxAge`/`idleTimeout` dentro e fora do prazo,
- **Então** ela é aceita dentro do prazo e rejeitada com "Session expired!" (nova sessão) fora dele, igual ao caso de senha única.

### RF-08 — Senha única mantém o comportamento atual

**Critério de aceite**
- **Dado** `password` como `string`,
- **Quando** se roda a suíte existente de sessões (`test/session.test.ts` e correlatos),
- **Então** todos os testes passam, com ajustes apenas onde dependem do que a mudança altera, sem perder o que verificam. `pnpm lint` e `pnpm typecheck` passam.

### RF-09 — Cobertura de testes e documentação

**Critério de aceite**
- **Dado** a implementação concluída,
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** há testes para RF-02 a RF-07 (usando `describeMatrix`) que passam, e o JSDoc de `password` descreve a lista, a ordem e a rotação.

## Fora de escopo

- Opção separada (`extraUnsealPasswords` ou similar): a issue a cita como alternativa, e esta variante não a adota.
- Novos nomes públicos (funções, tipos, constantes, exports).
- Senhas por objeto/ID (`{ id: password }`) ou escolha de senha por prefixo do selo.
- Mudar o formato do selo, algoritmos, iterações ou TTL.
- Rotação automática de senhas, geração ou armazenamento de segredos.
- Aposentar automaticamente senhas antigas da lista.
- Alterar `h3/rules`, outras entradas de plataforma ou utilitários fora de sessão.

## Premissas e riscos

**Premissas**
- `seal`/`unseal` em `src/utils/internal/iron-crypto.ts` aceitam uma senha por chamada, então a lista é tratada em `session.ts`, sem mudar a API interna de crypto.
- A lista é pequena (normalmente 2 ou 3 senhas); tentar em sequência é aceitável.
- A regra de tamanho mínimo (32 caracteres) vale para cada senha da lista, como já vale para a única.
- Dedup de lista e senhas repetidas não exigem tratamento especial.

**Riscos**
- **Custo de CPU:** cada tentativa falha faz PBKDF2 (8192 iterações) e, no caso legado, uma segunda rodada. O pior caso cresce com N senhas × 2 (fallback legado). Um cookie inválido forjado pode amplificar o custo. Mitigação: manter a lista curta e documentar isso.
- **Erros mascarados:** com várias tentativas, é preciso lançar um erro significativo. Falhas de expiração ("Session expired!") não devem ser confundidas com falha de senha nem disparar nova tentativa sem necessidade.
- **Fallback legado:** deve ser avaliado por senha sem trocar o erro original. A condição atual compara `error.message === "Bad hmac value"`, e essa checagem tem de continuar correta com a lista.
- **Reseal (RF-06):** resselar em `getSession` pode gerar `Set-Cookie` em leituras que antes não geravam. Só deve ocorrer para sessões de cookie abertas com senha antiga. Sessões vindas do header não são reseladas.
- **Segurança:** manter uma senha antiga na lista mantém válidas as sessões feitas com ela. Se ela foi vazada, deve sair da lista, e a documentação precisa dizer isso.
- **Tipos:** `password: string | string[]` pode quebrar código de terceiros que lê `config.password` como `string`. Mudança aceitável por ser um alargamento, mas deve ser mencionada.
