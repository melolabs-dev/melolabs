# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

## Problema e objetivo

### Problema

Hoje `SessionConfig.password` (`src/utils/session.ts`) aceita apenas uma `string`. Ao trocar a senha das sessões por rotação de segredos, todas as sessões seladas com a senha anterior deixam de abrir (`Bad hmac value`). Os usuários perdem a sessão e precisam entrar de novo. Não há como manter a senha antiga válida durante a transição.

### Objetivo

Permitir a rotação de senhas sem invalidar as sessões existentes. O campo `password` passa a aceitar também uma lista não vazia de strings (segunda alternativa proposta na issue h3js/h3#1050):

- A primeira senha da lista sela sessões novas e re-seladas.
- Todas as senhas da lista, na ordem, podem abrir sessões.
- Uma `string` continua se comportando exatamente como hoje.

### Métricas de sucesso

- Uma sessão selada com a senha antiga é aceita depois que essa senha passa a ser a segunda da lista.
- Nenhum teste existente perde cobertura. `pnpm lint`, `pnpm typecheck` e a suíte passam.

## Requisitos funcionais

### RF-01 — `password` aceita `string | string[]`

O tipo de `SessionConfig.password` passa a ser `string | string[]`. A lista deve ser não vazia, e a documentação do campo explica a semântica de selar e abrir. Nenhum outro nome público é criado.

**Critério de aceite**
- **Dado** uma configuração de sessão com `password: ["nova-senha-32-caracteres-ou-mais...", "antiga-senha-32-caracteres-ou-mais..."]`
- **Quando** ela é passada a `useSession`, `getSession`, `updateSession`, `sealSession` ou `unsealSession`
- **Então** o código tipa e executa sem erro, e `password: "senha"` (string) continua sendo aceito.

### RF-02 — A primeira senha sela

Todo selo gerado (cookie, `sealSession`, reseal por `idleTimeout`) usa somente a primeira senha da lista.

**Critério de aceite**
- **Dado** `password: [nova, antiga]`
- **Quando** uma sessão é criada e selada
- **Então** o valor selado só abre com a `nova`, e uma configuração com `password: antiga` não consegue abri-lo.

### RF-03 — Qualquer senha da lista abre sessões

Ao abrir uma sessão, tenta-se cada senha da lista, na ordem, e usa-se a primeira que verifica. A expiração (`maxAge`, `idleTimeout`) é aplicada depois do unseal bem-sucedido, como hoje.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `antiga` e a configuração `password: [nova, antiga]`
- **Quando** a requisição com essa sessão chega
- **Então** os dados e o `id` da sessão são recuperados, sem criar uma sessão nova.

### RF-04 — Senha desconhecida ou removida rejeita a sessão

Se nenhuma senha da lista abre o selo, o comportamento é o mesmo de hoje para um selo inválido: a sessão é descartada e uma nova é iniciada. O erro lançado por `unsealSession` continua sendo o do unseal, e não uma mensagem nova e ambígua.

**Critério de aceite**
- **Dado** uma sessão selada com a senha `removida` e a configuração `password: [nova, antiga]`
- **Quando** a requisição chega
- **Então** a sessão não é recuperada, um `id` novo é gerado e nenhum erro não tratado é registrado.

### RF-05 — Reseal com a senha primária

Uma sessão aberta com uma senha que não é a primeira, e lida de cookie, é re-selada na mesma requisição com a primeira senha, no mesmo mecanismo do reseal proativo já usado para selos legados. Assim a rotação se completa e a senha antiga pode ser removida depois. Sessões lidas do header não são re-seladas, como hoje.

**Critério de aceite**
- **Dado** uma sessão em cookie selada com `antiga` e a configuração `password: [nova, antiga]`
- **Quando** a requisição é processada
- **Então** a resposta traz um `Set-Cookie` com o selo refeito, que abre com `password: nova` sozinha, e o `id` e os dados da sessão não mudam.

### RF-06 — Compatibilidade com uma senha só

Com uma `string`, ou com uma lista de um elemento, o comportamento é idêntico ao atual: formato do selo, resealing, fallback legado, expiração e mensagens de erro.

**Critério de aceite**
- **Dado** `password: "senha"` e, em outro caso, `password: ["senha"]`
- **Quando** a suíte existente de sessões roda
- **Então** todos os testes passam, e um selo gerado com a string abre com a lista de um elemento e vice-versa.

### RF-07 — Lista inválida é rejeitada

Uma lista vazia, ou uma lista com elemento vazio, falha de forma explícita e não cai em um selo sem senha. O mínimo de 32 caracteres continua valendo para cada senha, aplicado pelo `iron-crypto`.

**Critério de aceite**
- **Dado** `password: []`
- **Quando** uma sessão é selada ou aberta
- **Então** é lançado um erro explícito (por exemplo `Empty password`), e nenhuma sessão é criada ou aceita.

### RF-08 — Fallback legado funciona com cada senha

O fallback de selos de 1 iteração PBKDF2 (`legacySealFallback`) continua valendo para qualquer senha da lista. A sessão legada, com senha antiga ou atual, é aberta e re-selada com a primeira senha. `legacySealFallback: false` continua rejeitando esses selos.

**Critério de aceite**
- **Dado** uma sessão selada com 1 iteração e com a senha `antiga`, e a configuração `password: [nova, antiga]`
- **Quando** a requisição chega com `legacySealFallback` indefinido
- **Então** a sessão é recuperada e re-selada com `nova` e as iterações atuais, e com `legacySealFallback: false` ela é rejeitada.

### RF-09 — Testes e documentação

Os testes cobrem RF-01 a RF-08 em `test/session.test.ts` (com `describeMatrix`), mais um teste de tipos se o arquivo de type tests cobrir `SessionConfig`. Testes existentes só são ajustados quando dependem do que muda, sem perder o que verificam. A documentação das sessões (se existir em `docs/`) descreve a rotação com a lista.

**Critério de aceite**
- **Dado** a mudança implementada
- **Quando** se executa `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`
- **Então** os três terminam sem falhas.

## Fora de escopo

- Um parâmetro separado como `extraUnsealPasswords` (primeira alternativa da issue). Esta variante usa só `password`.
- Qualquer novo nome público (função, tipo, opção, export).
- Objetos de senha do `iron-crypto` (`{ id, secret }`, `{ encryption, integrity }`) ou `Uint8Array` na configuração de sessão.
- Rotação automática de segredos, geração de senhas ou armazenamento delas.
- Mudanças no formato do selo, nos algoritmos ou nas iterações padrão.
- Revogação de sessões individuais e mudanças em `requireBasicAuth` e outros usos de "password" no projeto.
- Mudanças fora de `src/utils/session.ts` além de testes e documentação.

## Premissas e riscos

### Premissas

- Só `src/utils/session.ts` lê `config.password` (confirmado por busca no código). `iron-crypto` não precisa mudar.
- A ordem da lista é significativa: a primeira sela, e as demais são tentadas em sequência.
- O `unseal` do `iron-crypto` falha de forma distinguível (por exemplo `Bad hmac value`) quando a senha está errada.
- Listas de rotação são curtas (2 a 3 senhas), então tentar várias senhas é aceitável.

### Riscos

- **Custo de CPU:** cada tentativa roda PBKDF2 (8192 iterações por padrão). Com N senhas, um selo inválido custa até N vezes mais, e com o fallback legado até 2N. Mitigação: tentar a primeira senha primeiro e documentar que a lista deve ser curta.
- **Escolha do erro:** com várias senhas, qual erro propagar quando todas falham? Propor o erro da primeira senha, para manter as mensagens atuais. Erros de expiração não podem ser confundidos com falha de senha, nem desencadear novas tentativas.
- **Interação com o fallback legado:** a ordem entre "outra senha" e "1 iteração" muda o custo e o resultado do reseal. Decisão na implementação: percorrer as senhas e, para cada uma, aplicar o fallback legado.
- **Senha antiga esquecida:** manter uma senha comprometida na lista mantém sessões forjáveis. A documentação deve dizer que a senha antiga sai da lista quando o reseal acabar.
- **Reseal inesperado:** RF-05 acrescenta um `Set-Cookie` em requisições que antes não o faziam. Isso é intencional e deve estar documentado e testado.
- **Tipagem:** `password: string | string[]` pode quebrar código de terceiros que lê `config.password` como `string`. É uma mudança aditiva para quem configura, mas exige aviso em changelog.
