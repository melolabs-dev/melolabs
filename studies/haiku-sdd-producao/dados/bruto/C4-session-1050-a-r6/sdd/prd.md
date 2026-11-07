# PRD: várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta nela) e contrato `sdd/pedido.md`.

## Problema e objetivo

### Problema

As sessões de `useSession` / `getSession` são seladas com uma única senha (`SessionConfig.password`, em `src/utils/session.ts`). Trocar essa senha, por rotação de segredo, invalida todas as sessões já emitidas: quem estava logado com a senha antiga é deslogado no momento da troca, mesmo que a sessão ainda estivesse dentro do `maxAge`.

Não existe hoje forma de fazer uma transição gradual. A única opção é trocar a senha e aceitar o logout em massa.

### Objetivo

Permitir que `password` seja uma lista de senhas. A primeira sela as sessões novas e as demais servem apenas para abrir sessões seladas antes da rotação. Com isso, a troca de senha deixa de deslogar usuários, e a senha antiga pode ser removida depois que as sessões antigas expirarem.

Quem usa uma senha só não deve notar nenhuma mudança.

## Requisitos funcionais

### RF-01 — Aceitar uma lista de senhas em `password`

`SessionConfig.password` passa a aceitar `string | string[]`. Uma string continua valendo como hoje. Uma lista não vazia tem a primeira entrada como senha de selagem e as demais como senhas de abertura. A lista vale em todas as vias de leitura, tanto o cookie quanto o header de sessão.

**Critério de aceite**

- **Dado** uma configuração com `password: [novaSenha, senhaAntiga]`, em que ambas têm pelo menos 32 caracteres,
- **Quando** `getSession` lê uma requisição com cookie selado somente com `senhaAntiga`,
- **Então** os dados da sessão são retornados sem erro.

- **Dado** a mesma configuração,
- **Quando** `getSession` lê uma requisição cujo header de sessão foi selado somente com `senhaAntiga`,
- **Então** os dados da sessão são retornados sem erro.

### RF-02 — Selar sempre com a primeira senha

Toda sessão nova ou reselada é selada com a primeira senha da lista. As demais não podem ser usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: [novaSenha, senhaAntiga]`,
- **Quando** `updateSession` ou `sealSession` gera um cookie,
- **Então** o cookie abre com `novaSenha` e não abre com `senhaAntiga`.

### RF-03 — Sessões seladas com senha desconhecida continuam sendo rejeitadas

Uma sessão selada com uma senha que não está na lista é rejeitada, exatamente como hoje com uma senha só. Não se abre a sessão por tentativa de outra forma.

**Critério de aceite**

- **Dado** uma configuração com `password: [novaSenha, senhaAntiga]`,
- **Quando** `getSession` lê um cookie selado com `senhaRemovida`, uma senha que não está na lista,
- **Então** o resultado é o mesmo que hoje ocorre com uma sessão selada com outra senha: a sessão não é aberta e nenhum dado dela é retornado.

### RF-04 — Compatibilidade com a senha única

Com `password` como string, o comportamento é o mesmo de hoje. Isso inclui a rejeição de sessões de outra senha, o fallback de iterações legadas (`kLegacySeal`) e o `seal` customizado.

**Critério de aceite**

- **Dado** uma configuração com `password` como string, como hoje,
- **Quando** a suíte existente de `test/session.test.ts` é executada,
- **Então** todos os testes passam sem alteração em suas asserções.

### RF-05 — Lista vazia e senhas inválidas são rejeitadas

Uma lista vazia, ou uma lista com alguma entrada que não atende à mesma regra exigida de uma string (pelo menos 32 caracteres), é erro de configuração. O erro acontece antes de qualquer selagem ou abertura.

**Critério de aceite**

- **Dado** uma configuração com `password: []`,
- **Quando** `useSession` ou `getSession` é chamado,
- **Então** a chamada lança um erro.

- **Dado** uma configuração com `password: [novaSenhaValida, "curta"]`,
- **Quando** `useSession` ou `getSession` é chamado,
- **Então** a chamada lança um erro.

### RF-06 — Fallback de iterações legadas funciona com cada senha da lista

Sessões seladas antes da mudança de iterações do PBKDF2 (1 iteração) devem abrir quando a senha antiga original está na lista, em qualquer posição.

**Critério de aceite**

- **Dado** uma sessão selada com a senha antiga usando 1 iteração e uma configuração `password: [novaSenha, senhaAntiga]`,
- **Quando** `unsealSession` é chamado com essa sessão,
- **Então** a sessão é aberta e recebe a marca `kLegacySeal`.

### RF-07 — Documentação atualizada

A documentação de sessões descreve que `password` aceita uma lista, que a primeira senha sela e que as demais só abrem sessões.

**Critério de aceite**

- **Dado** a documentação de segurança e a de exemplos de sessão (`docs/2.utils/4.security.md` e `docs/4.examples/handle-session.md`),
- **Quando** o leitor procura como rotacionar a senha,
- **Então** encontra o uso de `password` como lista, com a ordem das senhas explicada.

## Fora de escopo

- Nova opção pública como `extraUnsealPasswords`. Esta variante usa só o campo `password` (primeira alternativa da issue).
- Seleção de senha por `id` do token (formato de senha em objeto de `iron-crypto`). Não é exposto na API de sessão.
- Reselagem em massa ou job de migração de sessões antigas. A reselagem acontece pelo caminho de escrita que já existe.
- Rotação automática, agendada ou integrada a um gerenciador de chaves (KMS).
- Mudança de algoritmo, de iterações do PBKDF2 ou do formato do token selado.
- Limite máximo de tamanho da lista. Só entra se a decisão for tomada, ver riscos.

## Premissas

- A regra de força das senhas (pelo menos 32 caracteres, entropia alta) vale para cada entrada da lista, com a mesma exigência de hoje para string.
- A ordem da lista define o papel de cada senha: a primeira sela, as demais só abrem. Não há outra forma de marcar a senha de selagem.
- A reselagem de sessões antigas com a primeira senha acontece pelo caminho de escrita existente (`updateSession`, `sealSession`, e a reselagem já feita por `getSession` em sessões legadas). Não será criado um novo mecanismo.
- O tipo público fica como `string | string[]`. A rejeição de lista vazia é feita em runtime (RF-05). Um tipo tupla `[string, ...string[]]` no lugar seria mais forte, mas é uma decisão em aberto.
- O `iron-crypto` interno já aceita senhas indexadas por id. Isso pode ser aproveitado na implementação, mas não é requisito deste PRD.
- `pnpm lint` e `pnpm typecheck` precisam passar ao final, junto com a suíte existente.

## Riscos

- **Custo de CPU sob ataque.** Cada tentativa de abertura deriva chaves com PBKDF2 (8192 iterações por padrão). Com N senhas, um cookie inválido custa até N derivações. Com o fallback legado, o número de tentativas pode chegar a 2N. Um atacante pode usar isso para gastar CPU do servidor. Vale decidir um limite de tamanho para a lista, ou medir o custo com `test/bench/session.ts`.
- **Senha antiga esquecida.** Se a senha antiga nunca sair da lista, ela continua valendo indefinidamente. A documentação deve dizer que ela pode ser removida depois de `maxAge` (ou `idleTimeout`).
- **Confusão de ordem.** Colocar a senha nova em segundo lugar faz as sessões novas serem seladas com a senha antiga. Não há erro para isso, então a documentação e os testes de RF-02 precisam cobrir a ordem.
- **Testes existentes.** A suíte de sessões usa `password` como string em muitos pontos. Ajustes nos testes só podem acontecer onde a mudança de comportamento exigir, sem remover o que eles verificam.
- **Mensagens de erro.** Ao tentar várias senhas, a mensagem de erro de uma falha pode mudar em relação à atual. Isso só é aceitável se nenhum teste ou usuário depender do texto exato.
