# PRD — Várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## 1. Problema e objetivo

### Problema

Hoje, `useSession` / `getSession` em `src/utils/session.ts` aceitam uma única senha (`password`). Ao rotacionar essa senha, todas as sessões já seladas com a senha anterior deixam de abrir. Na prática, quem já está logado é deslogado no momento da troca, o que obriga a rotação a ser feita de forma disruptiva.

A issue #1050 pede que a aplicação continue aceitando sessões antigas durante a rotação.

### Objetivo

Permitir a rotação da senha de sessão sem derrubar usuários logados:

- depois da troca, o app continua aceitando sessões seladas com senhas anteriores;
- toda sessão nova ou regravada passa a ser selada somente com a senha atual;
- a configuração é feita por um campo novo e opcional em `SessionConfig`, sem mudar o tipo de `password`;
- sem o campo novo, o comportamento permanece idêntico ao atual.

## 2. Requisitos funcionais

### RF-01 — Campo de senhas extras na configuração

`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores. Essas senhas são aceitas apenas para abrir sessões. `password` continua sendo uma string e continua sendo a senha principal. Campo ausente e lista vazia são equivalentes.

**Critério de aceite**

- **Dado** uma configuração de sessão com `password` válida e sem `extraUnsealPasswords`
- **Quando** a sessão é criada e selada
- **Então** a configuração é aceita sem erro e o resultado é igual ao de hoje.

- **Dado** uma configuração com `extraUnsealPasswords: []`
- **Quando** a sessão é criada e selada
- **Então** o resultado é igual ao de uma configuração sem o campo.

### RF-02 — Selagem sempre com a senha principal

Toda sessão selada (sessão nova, `updateSession`, `sealSession` e re-selagem automática) usa sempre `password`. As senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma configuração com `password = P1` e `extraUnsealPasswords = [P0]`
- **Quando** `useSession`, `updateSession` ou `sealSession` selam uma sessão
- **Então** o cookie resultante só abre com `P1` e não abre com `P0` sozinha.

### RF-03 — Abertura em sequência

Uma sessão selada com `password` ou com qualquer senha de `extraUnsealPasswords` é aberta normalmente, com `id`, `createdAt` e dados preservados. As senhas são tentadas uma de cada vez: primeiro `password` e, se ela não abrir, as extras na ordem da lista, parando na primeira que abrir. Se `password` abrir a sessão, nenhuma senha extra é tentada.

**Critério de aceite**

- **Dado** um cookie selado com a senha `P0`, que está em `extraUnsealPasswords` da configuração atual com `password = P1`
- **Quando** `getSession` lê esse cookie
- **Então** a sessão é aberta com o mesmo `id`, o mesmo `createdAt` e os mesmos dados.

- **Dado** um cookie selado com `password`
- **Quando** `getSession` lê esse cookie
- **Então** nenhuma senha extra é tentada (a tentativa com extras não ocorre).

### RF-04 — Senha desconhecida tratada como sessão inexistente

Uma sessão selada com uma senha que não é `password` nem está em `extraUnsealPasswords` é tratada como inexistente, do mesmo jeito que hoje uma sessão com senha errada. O pedido segue sem erro e a sessão é nova e vazia.

**Critério de aceite**

- **Dado** um cookie selado com uma senha `P9` que não está na configuração
- **Quando** `getSession` ou `useSession` lê esse cookie
- **Então** o pedido não falha, a sessão retornada está vazia e um novo cookie não é gerado por causa dessa leitura.

### RF-05 — Rotação progressiva

Quando `getSession` (e, por consequência, `useSession`) abre uma sessão vinda do cookie com uma senha extra, a sessão é re-selada com `password` e enviada num novo `Set-Cookie` na mesma resposta, mesmo que o handler apenas leia a sessão. Esse é o mesmo mecanismo que hoje re-sela sessões legadas. Sessões abertas por `password` não são re-seladas por esse motivo. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**

- **Dado** um cookie selado com uma senha extra e um handler que só lê a sessão
- **Quando** a requisição é processada por `useSession`
- **Então** a resposta contém um `Set-Cookie` com a sessão selada com `password`, e o `id`, `createdAt` e dados são os mesmos.

- **Dado** um cookie selado com `password`
- **Quando** a requisição é processada por `useSession` e o handler só lê a sessão
- **Então** a resposta não contém novo `Set-Cookie`.

- **Dado** uma sessão enviada pelo cabeçalho de sessão, selada com uma senha extra
- **Quando** essa sessão é lida
- **Então** nenhum `Set-Cookie` de re-selagem é gerado.

### RF-06 — Validação das senhas extras

Cada senha extra segue a mesma regra de `password`: não pode ser vazia e precisa ter pelo menos o tamanho mínimo das opções de selo (`minPasswordlength`, 32 caracteres por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession`, `sealSession`) rejeita com erro claro cuja mensagem menciona a senha (contém a palavra "password", como as mensagens atuais), mesmo quando o pedido não traz sessão. Uma senha extra inválida em qualquer posição da lista provoca o erro. Uma `password` inválida continua provocando erro como hoje. A mensagem de erro não pode conter o valor da senha.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords` contendo uma string vazia ou com menos de `minPasswordlength` caracteres, em qualquer posição da lista
- **Quando** `updateSession`, `sealSession` ou `useSession` (criação de sessão) é chamado
- **Então** a operação rejeita com erro cuja mensagem contém "password" e não contém o valor da senha inválida.

- **Dado** uma configuração com `password` válida e `extraUnsealPasswords` válida
- **Quando** qualquer operação de selo é chamada
- **Então** nenhum erro de validação é lançado.

### RF-07 — Cobertura nas funções e formatos de transporte

A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, tanto para sessões em cookie dividido em pedaços (chunks) quanto para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha extra e gravada em cookie dividido em chunks
- **Quando** cada uma das funções `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession` processa essa sessão
- **Então** a sessão é aberta corretamente (no caso de `clearSession`, a sessão é identificada e limpa).

- **Dado** uma sessão selada com uma senha extra enviada pelo cabeçalho de sessão
- **Quando** `getSession` ou `unsealSession` processa a requisição
- **Então** a sessão é aberta com os dados originais.

### RF-08 — Compatibilidade com sessões legadas

O fallback atual para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a `password` e a todas as senhas extras. Uma sessão legada selada com qualquer uma dessas senhas é aberta e re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**

- **Dado** uma sessão legada (1 iteração PBKDF2) selada com uma senha extra e `legacySealFallback` ativo
- **Quando** `getSession` lê a sessão
- **Então** a sessão é aberta, re-selada com `password` e enviada em novo `Set-Cookie`.

- **Dado** uma sessão legada selada com uma senha extra e `legacySealFallback: false`
- **Quando** `getSession` lê a sessão
- **Então** a sessão é tratada como inexistente, como hoje.

### RF-09 — Preservação do comportamento sem senhas extras

Sem `extraUnsealPasswords`, ou com lista vazia, o comportamento é idêntico ao atual. Isso inclui não re-selar ao apenas ler e rejeitar sessões de outras senhas. Nenhum nome público novo é criado além de `extraUnsealPasswords`, e o tipo de `password` não muda.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords` e um cookie selado com outra senha
- **Quando** `getSession` lê o cookie
- **Então** a sessão é vazia, sem novo `Set-Cookie`, exatamente como na versão atual.

- **Dado** o conjunto de testes existente e os comandos `pnpm lint` e `pnpm typecheck`
- **Quando** são executados após a mudança
- **Então** todos passam sem alteração nos testes existentes.

## 3. Fora de escopo

- Aceitar `password` como array (a alternativa da issue, descartada nesta variante).
- Mudar o tipo de `password` ou criar outros nomes públicos além de `extraUnsealPasswords`.
- Rotação automática ou agendada de senhas, e qualquer mecanismo para descobrir senhas anteriores.
- Re-selagem em massa de sessões ativas fora do fluxo de leitura normal.
- Mudanças em `maxAge`, `idleTimeout`, formato dos chunks, `errHeaders` ou no algoritmo de selo.
- Mudanças em outras integrações de sessão além das listadas em RF-07.
- Alterações no código do projeto nesta etapa (este PRD não altera código).

## 4. Premissas e riscos

### Premissas

- A referência é a issue h3js/h3#1050 e o contrato da variante (b) já descrito em `sdd/pedido.md`.
- Sessões seladas são stateless: não há armazenamento no servidor para invalidar sessões antigas.
- O custo de PBKDF2 é aceitável para algumas senhas extras, pois cada tentativa falha custa uma derivação de chave.
- A equipe remove as senhas antigas da lista depois de um período de transição, quando as sessões antigas já expiraram.

### Riscos

- **Custo de CPU.** Cada senha extra tentada antes da correta soma uma derivação PBKDF2. Listas longas podem degradar o tempo de resposta. Mitigação: documentar que a lista deve ser curta e temporária.
- **Senhas antigas esquecidas.** Manter senhas antigas indefinidamente amplia a superfície de ataque. Mitigação: documentar a remoção após a janela de rotação.
- **Cookie maior.** A re-selagem gera um novo cookie que pode ter tamanho diferente. Em cookies divididos em chunks, a troca precisa limpar os pedaços antigos corretamente. Mitigação: testes específicos de chunks em RF-07.
- **Vazamento de senha em erro.** Mensagens de validação poderiam expor o valor da senha. Mitigação: RF-06 proíbe o valor na mensagem.
- **Inconsistência entre funções.** `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession` podem divergir na ordem de tentativa ou na re-selagem. Mitigação: uma única rotina de abertura compartilhada e testes cobrindo as cinco funções.
- **Ambiguidade a confirmar.** O contrato diz que sessões do cabeçalho não são re-seladas. Como não há cookie para atualizar, isso é coerente, mas vale confirmar se o cliente precisa de outro sinal para migrar.
