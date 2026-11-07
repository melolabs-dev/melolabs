# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

## Problema e objetivo

Hoje `useSession` (`src/utils/session.ts`) aceita uma única `password`, usada tanto para selar quanto para abrir a sessão. Ao trocar essa senha (rotação de segredo), todas as sessões seladas com a senha anterior passam a ser inválidas e os usuários são deslogados de uma vez.

Objetivo: permitir a rotação de senha sem invalidar sessões existentes. A senha atual continua selando as sessões novas; senhas anteriores passam a ser aceitas apenas para abrir sessões já emitidas. Esta é a primeira alternativa proposta na issue h3js/h3#1050: um campo novo na configuração, `extraUnsealPasswords`.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores. `password` continua sendo `string` e continua sendo a única senha usada para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** o código TypeScript é verificado (`pnpm typecheck`),
- **Então** a configuração compila sem erro, e `password` é tipado como `string`, não como array.

### RF-02 — Selagem sempre com `password`

Ao selar uma sessão nova ou resselar uma existente (renovação de `idleTimeout`, escrita na sessão), a senha usada é sempre `password`. As senhas em `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma sessão selada com `password: "antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a sessão é lida e depois modificada (ou resselada pela renovação de `idleTimeout`),
- **Então** o cookie resultante só abre com `"nova"` e não abre com `"antiga"` quando usado com a configuração que tem apenas `password: "antiga"`.

### RF-03 — Sessões abertas por qualquer senha da lista

Ao ler uma sessão, o sistema tenta abri-la primeiro com `password` e, em seguida, com cada senha de `extraUnsealPasswords`, na ordem em que foram declaradas. A primeira que verificar a integridade é a usada.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com o cookie dessa sessão,
- **Então** `useSession` retorna a sessão com os dados originais (mesmo `id` e mesmo `data`), sem iniciar uma sessão nova.

### RF-04 — Falha quando nenhuma senha abre a sessão

Se nenhuma das senhas (`password` ou uma de `extraUnsealPasswords`) abrir a sessão, o comportamento é o mesmo de hoje para uma senha errada: o erro de selo é tratado como sessão inválida e uma sessão nova é criada.

**Critério de aceite**

- **Dado** uma sessão selada com `"desconhecida"` e uma configuração com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`,
- **Quando** a requisição chega com o cookie dessa sessão,
- **Então** a sessão anterior é descartada, uma sessão nova é criada, e o cookie de resposta é selado com `"nova"`.

### RF-05 — Compatibilidade sem senhas extras

Sem `extraUnsealPasswords` (campo ausente ou lista vazia), o comportamento deve ser idêntico ao atual, incluindo o fallback de selo legado (`legacySealFallback`) e os limites de `maxAge` e `idleTimeout`.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessões (`pnpm vitest run test/session.test.ts` ou equivalente) é executada,
- **Então** todos os testes que passavam antes continuam passando sem alteração de asserção.

### RF-06 — Fallback legado aplicado a cada senha

O fallback de selo legado (1 iteração PBKDF2, hoje tentado com `password`) passa a ser tentado para cada senha da lista, respeitando `legacySealFallback: false` para desligá-lo. A ordem de tentativa é: para cada senha, primeiro o selo atual, depois o legado.

**Critério de aceite**

- **Dado** uma sessão selada com 1 iteração PBKDF2 usando `"antiga"`, e uma configuração com `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e `legacySealFallback` não definido,
- **Quando** a requisição chega com o cookie dessa sessão,
- **Então** a sessão é aberta, e `getSession` a reselia com as opções atuais usando `"nova"`.
- **Dado** a mesma sessão com `legacySealFallback: false`,
- **Quando** a requisição chega,
- **Então** a sessão é rejeitada e uma sessão nova é criada.

### RF-07 — Expiração continua valendo para sessões de senhas antigas

`maxAge` e `idleTimeout` são verificados sobre a sessão aberta, independentemente de qual senha a abriu. Abrir uma sessão com uma senha antiga não estende sua validade.

**Critério de aceite**

- **Dado** uma sessão selada com `"antiga"` cujo `createdAt` ultrapassa `maxAge`,
- **Quando** a requisição chega com uma configuração com `password: "nova"`, `extraUnsealPasswords: ["antiga"]` e o mesmo `maxAge`,
- **Então** a sessão é tratada como expirada e uma sessão nova é criada.

### RF-08 — Documentação e tipos

O JSDoc de `extraUnsealPasswords` explica que as senhas servem apenas para abrir sessões, que `password` é a que sela, e que a lista deve ser removida depois que as sessões antigas expirarem. A documentação de `useSession` (e do `SessionConfig`) menciona o campo.

**Critério de aceite**

- **Dado** o arquivo `src/utils/session.ts`,
- **Quando** o campo `extraUnsealPasswords` é lido,
- **Então** o JSDoc descreve o comportamento de unseal e de selagem, e nenhum outro nome público novo aparece no módulo exportado.

## Fora de escopo

- A alternativa 2 da issue (`password` aceitar `string[]`, com a primeira usada para selar). Não será implementada.
- Novos nomes públicos além de `extraUnsealPasswords`.
- Rotação automática ou agendada das senhas, e qualquer mecanismo que gere ou armazene senhas.
- Mudança no algoritmo de selo (`seal`) ou no formato do cookie.
- Invalidação explícita de sessões antigas (ex.: lista de revogação).
- Alterações em `getSession`, `clearSession` ou em outros utilitários de sessão além do necessário para passar as senhas.
- Mudança no fallback legado (`legacySealFallback`) além de aplicá-lo a cada senha, incluindo sua remoção, que está prevista para v3.
- Validação de força das senhas extras além da que já existe para `password`.

## Premissas e riscos

### Premissas

- As senhas em `extraUnsealPasswords` são segredos com a mesma exigência de entropia de `password` (documentada como mínimo de 32 caracteres e geração aleatória). Premissa a confirmar na implementação: se a validação atual de tamanho for feita em `seal`/`unseal`, ela se aplica às senhas extras também.
- A tentativa de cada senha é local ao request e não altera o estado de outras requisições.
- A ordem das senhas em `extraUnsealPasswords` não tem significado de segurança; ela só define a ordem de tentativa.
- O custo de tentar várias senhas (PBKDF2) é aceitável para a quantidade de senhas que uma rotação real mantém (uma ou duas).
- O cookie por sessão do cliente não guarda a senha, então a troca de senha é transparente para o navegador.

### Riscos

- **Custo de CPU:** cada senha extra a tentar multiplica o custo de PBKDF2 em sessões que não abrem com a senha atual. Com muitas senhas, o tempo por requisição cresce. Mitigação: documentar que a lista deve ser curta e removida após a janela de expiração.
- **Senhas antigas esquecidas:** se a lista nunca for limpa, uma senha comprometida continua aceita. Mitigação: documentar o procedimento de remoção no JSDoc.
- **Confusão com o fallback legado:** combinar fallback legado com várias senhas aumenta o número de tentativas (até 2 por senha). Os testes de RF-06 devem cobrir esse caso.
- **Ressello inadvertido com senha antiga:** se a leitura resselar a sessão com a senha antiga em algum caminho, a rotação não se completa. Mitigação: RF-02 e o teste correspondente.
- **Escopo do JSDoc:** a documentação de `password` diz que a senha é a chave de selagem; é preciso ajustar o texto para não dar a entender que as extras também selam.
- **Compatibilidade de tipos:** adicionar um campo opcional a `SessionConfig` não quebra quem já usa a interface, mas é uma mudança de API pública que precisa ser refletida nos testes de tipo, se existirem em `test/unit/`.
