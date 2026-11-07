# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession` e `getSession` (`src/utils/session.ts`) usam uma única `password` tanto para selar quanto para abrir a sessão. Ao trocar a senha por rotação de segredos, todas as sessões seladas com a senha antiga deixam de abrir, e os usuários são deslogados.

**Objetivo:** permitir que o `SessionConfig` declare senhas anteriores que só servem para abrir sessões, de modo que a rotação não invalide as sessões já emitidas. A senha atual continua sendo a única usada para selar.

Esta é a variante da issue h3js/h3#1050 em que a rotação é configurada num campo novo (`extraUnsealPasswords`). A alternativa de transformar `password` em array não é adotada aqui.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` no `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`. `password` continua sendo `string` e continua sendo a única senha usada para selar.

**Critério de aceite**

- **Dado** um `SessionConfig` com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** o tipo é verificado pelo TypeScript,
- **Então** a configuração compila sem erro, e um `SessionConfig` sem o campo continua válido.

### RF-02 — Selagem sempre com `password`

Toda sessão selada (`sealSession`, incluindo a regravação do cookie) usa somente `password`. As senhas extras nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** uma sessão é selada,
- **Então** o selo abre com `"senha-nova"` e não abre com `"senha-antiga"`.

### RF-03 — Abertura tentando as senhas em ordem

Ao abrir uma sessão, a ordem de tentativa é `password` e depois cada item de `extraUnsealPasswords`, na ordem do array. A primeira senha que abrir o selo é usada. Se nenhuma abrir, a sessão é tratada como inválida, do mesmo jeito que hoje.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga-2", "senha-antiga"]`,
- **Quando** `getSession` lê essa sessão,
- **Então** os dados da sessão são retornados, e a tentativa com `"senha-antiga-2"` falha antes da tentativa com `"senha-antiga"`.

**Critério de aceite (sem senha válida)**

- **Dado** uma sessão selada com uma senha que não está na configuração,
- **Quando** `getSession` lê essa sessão,
- **Então** a sessão retorna vazia, sem erro não tratado, como acontece hoje com senha errada.

### RF-04 — Comportamento inalterado sem senhas extras

Quando `extraUnsealPasswords` não é informado ou é um array vazio, o comportamento é o de hoje, incluindo o fallback de selo legado (1 iteração PBKDF2) e a opção `seal`.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`,
- **Quando** a suíte existente de sessões (`test/session.test.ts`) é executada,
- **Então** todos os testes que passavam antes continuam passando, sem alteração nos seus asserts.

### RF-05 — Fallback de selo legado também vale para as senhas extras

O fallback de selo legado (1 iteração PBKDF2, tratado em `unsealSession`) é aplicado a cada senha da lista, na mesma ordem. Assim, uma sessão antiga selada com senha antiga e formato legado continua abrindo durante a rotação.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` no formato legado (1 iteração) e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` lê essa sessão,
- **Então** os dados são retornados, e a sessão é regravada com `"senha-nova"` e com as opções de selo atuais.

### RF-06 — Regravação com a senha atual quando a sessão foi aberta com senha extra

Quando uma sessão é aberta com uma senha de `extraUnsealPasswords`, `getSession` a regrava com `password`, para que a rotação avance a cada requisição, sem esperar pelo `idleTimeout`.

**Critério de aceite**

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "senha-nova"` e `extraUnsealPasswords: ["senha-antiga"]`,
- **Quando** `getSession` lê essa sessão,
- **Então** o cookie de resposta contém um selo que abre com `"senha-nova"` e não abre com `"senha-antiga"`.

### RF-07 — Validação das senhas extras

Cada item de `extraUnsealPasswords` passa pela mesma validação que `password`. Se `password` tem um tamanho mínimo, as senhas extras também precisam ter. Um item inválido gera erro na configuração, e não é ignorado em silêncio.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords: [""]` (ou com item abaixo do tamanho mínimo, se houver),
- **Quando** a sessão é configurada,
- **Então** a configuração falha com erro que indica o campo `extraUnsealPasswords`.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue).
- Rotação automática ou agendada das senhas; a troca continua sendo feita pelo código da aplicação.
- Remoção de senhas antigas por API própria ou expiração de senhas.
- Novos nomes públicos além de `extraUnsealPasswords` (restrição do contrato).
- Mudanças no formato do cookie, nos cookies em partes (chunked) ou na assinatura de `useSession`/`getSession` além do campo novo.
- Mudanças nos runtimes de entrada (`src/_entries/*`) e em `h3/rules`.
- Migração em lote de sessões armazenadas fora do cookie.

## Premissas e riscos

**Premissas**

- A biblioteca de selo (`iron-crypto.ts`) falha de forma limpa com senha errada, retornando `undefined` ou erro, e não dados corrompidos. A abertura por tentativas depende disso.
- A validação atual de `password` pode ser reutilizada para as senhas extras. Isso ainda precisa ser confirmado no código antes da implementação (ver RF-07).
- Quem usa a rotação mantém a lista de senhas extras pelo tempo necessário e a remove depois. O PRD não define prazo.
- Como `extraUnsealPasswords` é opcional e `password` continua string, nenhum código existente precisa mudar para compilar.

**Riscos**

- **Custo de CPU:** cada tentativa de abertura faz uma derivação PBKDF2. Com N senhas extras, um cookie inválido custa até N+1 derivações, e o fallback legado pode dobrar esse custo. Isso pode ser usado para aumentar a carga do servidor. Mitigação possível: limitar o tamanho da lista na validação, e medir o custo antes de liberar.
- **Senhas antigas esquecidas:** manter uma senha antiga na configuração indefinidamente mantém sessões vulneráveis a ela, se ela vazou. Documentar que a lista deve ser esvaziada após o prazo de vida das sessões.
- **Regravação por requisição (RF-06):** sessões antigas são regravadas assim que são lidas, o que aumenta o custo de selagem uma vez por sessão durante a rotação. É uma troca consciente, mas deve aparecer nos testes de desempenho.
- **Ordem de tentativas:** se a senha atual estiver errada por engano e uma extra igual a ela existir, a sessão abre com a extra sem aviso. Aceitável, mas não deve ser assumido como detecção de erro de configuração.
