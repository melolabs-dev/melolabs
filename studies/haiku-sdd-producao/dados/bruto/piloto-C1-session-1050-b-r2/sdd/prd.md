# PRD: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## Problema e objetivo

Hoje `useSession` e `getSession` (em `src/utils/session.ts`) aceitam uma única senha. Ao rotacionar a senha, todas as sessões seladas com a senha anterior deixam de ser abertas: os usuários logados são derrubados e precisam entrar de novo.

Objetivo: permitir a rotação da senha sem derrubar sessões existentes. Depois da troca, o app continua aceitando sessões seladas com senhas anteriores, e toda sessão nova ou regravada passa a ser selada com a senha atual. Nesta variante, as senhas anteriores são configuradas no novo campo `extraUnsealPasswords` de `SessionConfig`.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores, usadas apenas para abrir sessões. `password` continua sendo uma string e continua sendo a senha principal. Campo ausente e lista vazia têm o mesmo efeito: não há senhas extras.

**Critério de aceite**

- Dado uma configuração de sessão sem `extraUnsealPasswords`,
- Quando uma sessão é criada e lida com `password`,
- Então o comportamento é idêntico ao atual.

- Dado uma configuração com `extraUnsealPasswords: []`,
- Quando uma sessão selada com `password` é lida,
- Então o resultado é o mesmo que com o campo ausente.

### RF-02 — Selagem sempre com `password`

Toda sessão selada (sessão nova, `updateSession`, `sealSession` e re-selagem automática) usa sempre `password`. Senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- Dado uma configuração com `password = P1` e `extraUnsealPasswords = [P0]`,
- Quando `updateSession` ou `sealSession` grava uma sessão,
- Então o cookie resultante só abre com `P1` e não abre com `P0`.

### RF-03 — Abertura com ordem de tentativa

Uma sessão selada com `password` ou com qualquer senha de `extraUnsealPasswords` é aberta normalmente, preservando `id`, `createdAt` e os dados. As senhas são tentadas uma por vez, em sequência: primeiro `password`; se ela não abrir, as extras na ordem da lista, parando na primeira que abrir. Se `password` abrir a sessão, nenhuma senha extra é tentada.

**Critério de aceite**

- Dado uma sessão selada com a segunda senha extra da lista,
- Quando `getSession` é chamado,
- Então a sessão é aberta com `id`, `createdAt` e dados originais, e as senhas são tentadas nesta ordem: `password`, primeira extra, segunda extra; a tentativa para na segunda extra.

- Dado uma sessão selada com `password`,
- Quando `getSession` é chamado com extras configuradas,
- Então nenhuma senha extra é tentada.

### RF-04 — Senha desconhecida tratada como sessão inexistente

Sessão selada com senha que não é `password` nem está em `extraUnsealPasswords` é tratada como inexistente, como hoje ocorre com senha errada: a requisição segue sem erro e a sessão é nova e vazia.

**Critério de aceite**

- Dado uma sessão selada com uma senha fora de `password` e de `extraUnsealPasswords`,
- Quando `useSession` é chamado,
- Então a requisição não recebe erro, a sessão retornada está vazia e o `id` é novo.

### RF-05 — Rotação progressiva na leitura

Quando `getSession` (e, por consequência, `useSession`) abre uma sessão vinda do cookie com uma senha extra, a sessão é re-selada com `password` e enviada em um novo `Set-Cookie` na mesma resposta, mesmo que o handler apenas leia a sessão. Este é o mesmo mecanismo que hoje re-sela sessões legadas. Sessões abertas por `password` não são re-seladas por este motivo. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**

- Dado uma sessão em cookie selada com uma senha extra,
- Quando um handler apenas lê a sessão com `useSession`,
- Então a resposta contém um `Set-Cookie` com a sessão selada com `password`, com o mesmo `id` e os mesmos dados.

- Dado uma sessão em cookie selada com `password`,
- Quando um handler apenas lê a sessão,
- Então a resposta não contém `Set-Cookie` de re-selagem.

- Dado uma sessão enviada pelo cabeçalho de sessão, selada com uma senha extra,
- Quando a sessão é lida,
- Então a resposta não contém `Set-Cookie` de re-selagem.

### RF-06 — Validação das senhas extras

Cada senha extra segue a mesma regra de `password`: não pode ser vazia e precisa ter pelo menos `minPasswordlength` caracteres (32 por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession`, `sealSession`) rejeita com erro claro cuja mensagem contém a palavra "password", como as mensagens atuais. Isso vale mesmo quando o pedido não traz sessão. Uma senha extra inválida em qualquer posição da lista provoca o erro. Uma `password` inválida continua provocando erro, como hoje.

**Critério de aceite**

- Dado `extraUnsealPasswords` com uma senha curta na segunda posição,
- Quando `updateSession` ou `sealSession` é chamado,
- Então a operação rejeita com erro cuja mensagem contém "password".

- Dado `extraUnsealPasswords` com uma string vazia,
- Quando `useSession` é chamado sem cookie de sessão,
- Então a operação rejeita com erro cuja mensagem contém "password".

- Dado `password` válida e `extraUnsealPasswords` com todas as senhas válidas,
- Quando as operações são chamadas,
- Então nenhum erro de validação é lançado.

### RF-07 — Cobertura das funções e formatos de sessão

A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em pedaços (chunks) e para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**

- Dado uma sessão em cookie dividido em chunks, selada com uma senha extra,
- Quando `getSession` ou `unsealSession` é chamado,
- Então a sessão é aberta com os dados originais.

- Dado uma sessão enviada pelo cabeçalho de sessão, selada com uma senha extra,
- Quando `clearSession` é chamado com essa sessão,
- Então a operação identifica a sessão corretamente e limpa o cookie como hoje.

- Dado uma sessão selada com uma senha extra,
- Quando `updateSession` é chamado,
- Então a sessão é aberta, atualizada e regravada com `password`.

### RF-08 — Sessões legadas com senhas extras

O fallback atual para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a `password` e a todas as senhas extras. Uma sessão legada selada com qualquer uma delas é aberta e re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**

- Dado uma sessão legada (1 iteração de PBKDF2) selada com uma senha extra e `legacySealFallback` ativo,
- Quando `useSession` é chamado,
- Então a sessão é aberta, o `Set-Cookie` re-sela com `password` e as opções de selo atuais.

- Dado uma sessão legada selada com uma senha extra e `legacySealFallback: false`,
- Quando `getSession` é chamado,
- Então a sessão não é aberta e é tratada como inexistente.

## Fora de escopo

- Novos nomes públicos além de `extraUnsealPasswords` em `SessionConfig`. O tipo de `password` não muda.
- Alterações em `maxAge`, `idleTimeout`, formato dos cookies em pedaços, cabeçalho de sessão, `errHeaders` e demais comportamentos de sessão.
- Lista de senhas com `password` como array (alternativa citada na issue, não adotada nesta variante).
- Rotação automática ou agendada de senhas, e qualquer ferramenta para descobrir ou remover senhas antigas.
- Re-selagem de sessões vindas do cabeçalho de sessão.
- Mudanças nos testes existentes, salvo ajustes estritamente necessários para compilar.
- Documentação pública além de comentários de tipo do campo novo.

## Premissas e riscos

### Premissas

- A implementação fica em `src/utils/session.ts` e módulos internos de selagem já existentes.
- A selagem usa PBKDF2 e as opções de selo atuais, incluindo `minPasswordlength` (32 por padrão).
- Sem `extraUnsealPasswords`, ou com lista vazia, o comportamento atual é preservado, inclusive a regra de não re-selar ao apenas ler.
- O conjunto de testes existente, `pnpm lint` e `pnpm typecheck` devem continuar passando ao final.

### Riscos

- **Custo de CPU:** cada senha extra tentada custa uma derivação PBKDF2. Uma sessão selada com a última senha da lista, ou uma sessão de senha desconhecida, exige N derivações por requisição. Pode ser necessário limitar o tamanho da lista ou documentar o custo.
- **Escrita em requisições de leitura:** a rotação progressiva gera `Set-Cookie` em handlers que só leem. Isso pode interferir com caches intermediários e com fluxos que não esperam cabeçalhos de escrita. Vale testar com e sem cache.
- **Erro de validação em `useSession` sem sessão:** a validação de senhas extras dispara mesmo sem cookie. Isso muda o comportamento apenas quando a configuração é inválida, mas é uma diferença a ser comunicada.
- **Vazamento de senhas:** senhas antigas ficam no código ou na configuração. Logs e mensagens de erro não podem exibir os valores.
- **Confusão com o fallback legado:** as duas trilhas de compatibilidade (senhas extras e PBKDF2 de 1 iteração) se combinam. A ordem de tentativa precisa ser testada para os dois casos juntos.
- **Concorrência:** duas requisições simultâneas com a mesma sessão antiga podem gerar dois `Set-Cookie` com sessões seladas diferentes. O último cookie vence e isso é aceitável, mas precisa ser verificado.
- **Tamanho do cookie:** a re-selagem pode mudar o número de chunks. Isso precisa ser coberto por teste para sessões grandes.
