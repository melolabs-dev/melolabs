# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

### Problema

Hoje `SessionConfig` aceita uma única `password` (`src/utils/session.ts`), usada tanto para selar quanto para abrir o cookie ou o header de sessão. Ao rotacionar essa senha, todas as sessões já emitidas deixam de abrir (`unsealSession` falha e `getSession` descarta o cookie). Na prática, cada rotação desloga todos os usuários. Isso desencoraja a troca periódica de segredos, que é uma boa prática de segurança, e obriga a escolher entre rotacionar e manter as sessões ativas.

### Objetivo

Permitir rotacionar a senha das sessões sem invalidar as sessões existentes. Isso se faz com o campo opcional `extraUnsealPasswords: string[]` em `SessionConfig`:

- `password` continua sendo uma string e continua sendo a única senha que sela.
- `extraUnsealPasswords` guarda senhas anteriores, usadas somente para abrir sessões.
- Sem `extraUnsealPasswords`, o comportamento é idêntico ao atual.

Esta variante corresponde à primeira alternativa proposta na issue h3js/h3#1050. A segunda alternativa, `password` como array, não será implementada.

## Requisitos funcionais

### RF-01 — Campo opcional `extraUnsealPasswords` na configuração

`SessionConfig` ganha o campo opcional `extraUnsealPasswords?: string[]`, documentado em JSDoc. A documentação deve dizer que as senhas só abrem sessões, que `password` é a única que sela e que valem os mesmos requisitos de entropia de `password`. Nenhum outro nome público é criado.

**Critério de aceite**

- **Dado** o tipo `SessionConfig`
- **Quando** uma configuração é escrita com `password: string` e `extraUnsealPasswords: string[]`, ou sem o campo extra
- **Então** as duas formas compilam em `pnpm typecheck`, e passar `extraUnsealPasswords` com um valor que não seja `string[]` é erro de tipo.

### RF-02 — Abrir sessões seladas com senha anterior

`unsealSession` tenta primeiro `password`. Se a abertura falhar, tenta cada senha de `extraUnsealPasswords`, na ordem em que foram dadas. A primeira que abrir vence. Se nenhuma abrir, o erro é o mesmo de hoje, e `getSession` trata o resultado como sessão inexistente. Isso vale para sessões lidas de cookie (inclusive em chunks) e do header de sessão.

**Critério de aceite**

- **Dado** uma sessão selada com a senha A e uma configuração com `password` B e `extraUnsealPasswords: [A]`
- **Quando** a requisição chega com esse cookie (ou header) e o handler chama `getSession` ou `useSession`
- **Então** a sessão é carregada com o mesmo `id`, `createdAt` e `data` originais, e o mesmo vale com mais de uma senha extra, em que a sessão selada com a segunda senha extra também abre.

### RF-03 — Selar sempre com `password`

`sealSession`, `updateSession` e o `Set-Cookie` resultante usam somente `password`. Nenhuma senha de `extraUnsealPasswords` é usada para selar.

**Critério de aceite**

- **Dado** uma configuração com `password` B e `extraUnsealPasswords: [A]`
- **Quando** o handler chama `updateSession` (ou `sealSession`) e o valor selado é aberto
- **Então** ele abre com a senha B e não abre só com a senha A.

### RF-04 — Resselar na senha atual uma sessão aberta por senha extra

Quando uma sessão lida de **cookie** é aberta por uma senha extra, `getSession` a reseala com `password` na mesma requisição e emite o `Set-Cookie` novo. Isso segue o padrão já usado para o selo legado (`kLegacySeal` e `shouldSlide`). Assim, as sessões migram para a senha nova gradualmente, e a senha antiga pode ser retirada depois. `id`, `createdAt` e `data` não mudam. Uma sessão do header de sessão, que não é resselada hoje, também não é resselada aqui. Nenhum marcador interno vaza para `session` nem para `data`.

**Critério de aceite**

- **Dado** uma sessão em cookie selada com a senha A e uma configuração com `password` B e `extraUnsealPasswords: [A]`
- **Quando** a requisição é processada por `getSession`
- **Então** a resposta traz um `Set-Cookie` cujo valor abre com B, a sessão mantém `id`, `createdAt` e `data`, e uma requisição seguinte com esse novo cookie e `extraUnsealPasswords` vazio ou ausente continua autenticada.

### RF-05 — Sessões abertas com `password` não mudam

Sem `extraUnsealPasswords` (ausente ou `[]`), ou quando a sessão abre com `password`, o comportamento atual é preservado: não há tentativas adicionais, nem resselo por causa desta funcionalidade, nem mudança nas mensagens de erro, nos cookies ou no formato do selo.

**Critério de aceite**

- **Dado** uma sessão selada com `password`, com `extraUnsealPasswords` ausente, `[]` ou preenchido
- **Quando** a requisição é processada
- **Então** a sessão é carregada como hoje e nenhum `Set-Cookie` extra é emitido por conta desta funcionalidade. Além disso, a suíte de testes existente de sessões passa sem perder o que verifica.

### RF-06 — Sessão selada com senha não configurada é rejeitada

Uma sessão selada com uma senha que não está em `password` nem em `extraUnsealPasswords` (por exemplo, uma senha já retirada da lista) é tratada como inválida: o cookie é ignorado e uma sessão nova é criada em memória, como acontece hoje com um selo inválido.

**Critério de aceite**

- **Dado** uma sessão selada com a senha A, com A fora de `password` e de `extraUnsealPasswords`
- **Quando** a requisição chega com esse cookie ou header
- **Então** `getSession` devolve uma sessão nova, com `id` diferente do original, e `data` vazio.

### RF-07 — Expiração e integridade valem com qualquer senha

A abertura por senha extra mantém todas as verificações atuais: `maxAge` (a partir de `createdAt`), `idleTimeout` (a partir de `lastSeenAt` ou `createdAt`), o `ttl` do selo e a integridade (HMAC). Uma sessão expirada selada com senha extra é rejeitada do mesmo jeito que uma selada com `password`. O fallback de selo legado (`legacySealFallback`) continua funcionando e também é aplicado às senhas extras: uma sessão legada selada com senha extra abre e é resselada com `password` e com as opções atuais.

**Critério de aceite**

- **Dado** uma sessão selada com a senha A, uma configuração com `password` B e `extraUnsealPasswords: [A]`, e `maxAge` ou `idleTimeout` já vencidos
- **Quando** a requisição é processada
- **Então** a sessão é rejeitada e uma nova é criada; e uma sessão adulterada (HMAC inválido) selada com qualquer senha configurada também é rejeitada.

### RF-08 — Testes e documentação

Os testes de sessão cobrem RF-02 a RF-07, incluindo cookie, header e cookie em chunks. Os testes existentes que dependam do que a mudança altera são ajustados sem perder o que verificam. O guia de sessões em `docs/` é atualizado com a rotação de senhas (passo a passo: mover a senha antiga para `extraUnsealPasswords`, definir a nova em `password`, retirar a antiga depois que as sessões migraram).

**Critério de aceite**

- **Dado** o repositório com a mudança aplicada
- **Quando** `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck` são executados
- **Então** todos passam, existe ao menos um teste para cada RF-02 a RF-07, e a documentação de sessões descreve `extraUnsealPasswords` com um exemplo de rotação.

## Fora de escopo

- Aceitar `password` como array (segunda alternativa da issue).
- Qualquer nome público novo além de `extraUnsealPasswords`.
- Rotação automática de segredos, geração de senhas ou integração com cofres de segredos.
- Mudanças no formato do selo, nos algoritmos, nas iterações do PBKDF2 ou em `iron-crypto`.
- Seleção da senha por identificador (`kid`) no selo, ou revogação de sessões individuais.
- Mudança no tratamento de `password` curta ou fraca, além do que já existe.
- Remoção do fallback de selo legado, que está previsto para a v3.
- Outros usos de `unseal` fora de `src/utils/session.ts`.

## Premissas e riscos

### Premissas

- A ordem de `extraUnsealPasswords` é a ordem de tentativa; a mais recente deve vir primeiro por convenção.
- Quem configura a rotação mantém a senha antiga na lista pelo tempo necessário. O fim da lista é decisão operacional, e o PRD não impõe prazo.
- As senhas extras têm a mesma exigência de entropia de `password` (mínimo de 32 caracteres), e a validação existente do `iron-crypto` se aplica a elas quando são usadas.
- `sealSession` e `updateSession` já selam apenas com `config.password`, então o selo não deve exigir mudança além do que o resselo de RF-04 pedir.

### Riscos

- **Custo de CPU**: cada tentativa extra de unseal faz derivação PBKDF2 (8192 iterações por padrão). Um cookie inválido ou forjado passa a custar até `1 + N` aberturas, ou o dobro com o fallback legado. Mitigação: manter a lista curta, documentar isso, e tentar `password` primeiro para que o caso comum não custe mais.
- **Superfície de ataque**: uma senha antiga comprometida continua abrindo sessões enquanto estiver na lista. Mitigação: o resselo de RF-04 migra as sessões ativas, e a documentação orienta a retirar a senha antiga o quanto antes.
- **Distinguir erro de senha de erro de expiração**: o loop não pode mascarar `Session expired!` nem tratar uma sessão expirada como sucesso, e não pode tentar outras senhas depois que uma abriu o selo. Mitigação: validar `maxAge` e `idleTimeout` só depois de escolher a senha que abriu.
- **Interação com o selo legado**: tentar senhas extras e o fallback legado pode multiplicar as combinações. Mitigação: definir uma ordem determinística (senha por senha, cada uma com o fallback legado) e cobri-la com testes.
- **Sessões em header não são resseladas**: elas continuam abrindo com a senha antiga enquanto ela estiver na lista. É esperado e deve ser documentado.
- **Testes existentes**: algum teste pode assumir que um selo com a senha errada falha de uma só maneira, ou contar chamadas de `Set-Cookie`. Mitigação: ajustar esses testes só no que a mudança altera, sem enfraquecer o que verificam.
