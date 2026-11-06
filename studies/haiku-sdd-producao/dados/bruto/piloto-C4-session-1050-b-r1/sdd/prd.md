# PRD: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

## Problema e objetivo

### Problema

Em `src/utils/session.ts`, as sessões são seladas com uma única senha (`password`). Ao trocar essa senha por motivo de segurança (rotação de segredos), todas as sessões já emitidas deixam de abrir: os usuários logados são derrubados e precisam autenticar de novo.

### Objetivo

Permitir a rotação da senha de sessão sem derrubar quem já está logado. Depois da troca:

- o app continua aceitando sessões seladas com senhas anteriores, configuradas em `extraUnsealPasswords`;
- toda sessão nova ou regravada é selada apenas com a senha atual (`password`);
- as sessões antigas migram gradualmente para a senha atual à medida que são lidas.

Nesta variante (b), a rotação é configurada por um campo novo em `SessionConfig`. A API atual não muda além desse campo.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords`, uma lista de strings com senhas anteriores, usadas somente para abrir sessões. `password` continua sendo uma string e a senha principal. Campo ausente e lista vazia são equivalentes.

**Critério de aceite**

- **Dado** uma configuração de sessão sem o campo `extraUnsealPasswords`
- **Quando** a sessão é criada, lida ou atualizada
- **Então** o comportamento é idêntico ao da versão atual, e o resultado com a lista vazia também é idêntico.

### RF-02 — Selagem sempre com `password`

Toda sessão selada (sessão nova, `updateSession`, `sealSession` e re-selagem automática) usa `password`. As senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**

- **Dado** uma sessão configurada com `password = P1` e `extraUnsealPasswords = [P0]`
- **Quando** `useSession` cria uma sessão, ou `updateSession` ou `sealSession` a regrava
- **Então** o cookie resultante pode ser aberto com `P1` e não pode ser aberto somente com `P0`.

### RF-03 — Abertura em sequência

Uma sessão selada com `password` ou com qualquer senha de `extraUnsealPasswords` é aberta normalmente, preservando `id`, `createdAt` e os dados. As senhas são tentadas uma de cada vez: `password` primeiro e, se ela não abrir, as extras na ordem da lista, parando na primeira que abrir. Se `password` abrir a sessão, nenhuma extra é tentada.

**Critério de aceite**

- **Dado** uma sessão selada com a senha `P0`, que está em `extraUnsealPasswords` na segunda posição (`[P9, P0]`)
- **Quando** a sessão é lida com `getSession`
- **Então** `id`, `createdAt` e os dados são preservados, e as senhas tentadas foram `password`, `P9` e `P0`, nessa ordem, parando em `P0`.

- **Dado** uma sessão selada com `password`
- **Quando** a sessão é lida
- **Então** nenhuma senha extra é tentada.

### RF-04 — Senha desconhecida tratada como sessão inexistente

Uma sessão selada com senha que não é `password` nem está em `extraUnsealPasswords` é tratada como inexistente, do mesmo jeito que hoje ocorre com senha errada: o pedido segue sem erro e a sessão é nova e vazia.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha fora da configuração
- **Quando** `getSession` é chamada com essa sessão no cookie
- **Então** a chamada não lança erro, e a sessão retornada está vazia e é nova.

### RF-05 — Rotação progressiva

Quando `getSession` (e, por consequência, `useSession`) abre uma sessão vinda do cookie com uma senha extra, a sessão é re-selada com `password` e enviada em um novo `Set-Cookie` na mesma resposta, mesmo que o handler apenas leia a sessão. Esse é o mesmo mecanismo que hoje re-sela sessões legadas. Sessões abertas com `password` não são re-seladas por este motivo. Sessões vindas do cabeçalho de sessão não são re-seladas.

**Critério de aceite**

- **Dado** uma requisição com cookie de sessão selado com uma senha extra, e um handler que só lê a sessão
- **Quando** `useSession` é executada
- **Então** a resposta contém um `Set-Cookie` com a sessão selada com `password`, com `id`, `createdAt` e dados preservados.

- **Dado** uma requisição com cookie selado com `password`
- **Quando** a sessão é lida
- **Então** a resposta não contém novo `Set-Cookie` por esse motivo.

- **Dado** uma requisição em que a sessão veio do cabeçalho de sessão e foi aberta com uma senha extra
- **Quando** a sessão é lida
- **Então** a resposta não contém `Set-Cookie` de re-selagem.

### RF-06 — Validação das senhas extras

Cada senha extra segue a mesma regra de `password`: não pode ser vazia e precisa ter, no mínimo, o tamanho de `minPasswordlength` (32 caracteres por padrão). Com configuração inválida, toda operação que sela (`useSession` ao criar a sessão, `updateSession` e `sealSession`) rejeita com erro claro cuja mensagem contém a palavra "password", mesmo quando a requisição não traz sessão. Uma senha extra inválida em qualquer posição da lista provoca o erro. Uma `password` inválida continua provocando erro como hoje.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords = [senhaValida, ""]`
- **Quando** `updateSession` ou `sealSession` é chamada, ou `useSession` cria uma sessão
- **Então** a operação rejeita com erro cuja mensagem contém "password", mesmo que a requisição não tenha cookie de sessão.

- **Dado** uma configuração com uma senha extra de 10 caracteres
- **Quando** qualquer operação que sela é executada
- **Então** a operação rejeita com erro que menciona "password".

### RF-07 — Cobertura das funções e formatos de cookie

A abertura com senhas extras vale para `getSession`, `useSession`, `updateSession`, `clearSession` e `unsealSession`, para sessões em cookie dividido em pedaços (chunks) e para sessões enviadas pelo cabeçalho de sessão.

**Critério de aceite**

- **Dado** uma sessão selada com uma senha extra e gravada em cookie dividido em chunks
- **Quando** `getSession` ou `unsealSession` é chamada
- **Então** a sessão é aberta com `id`, `createdAt` e dados preservados.

- **Dado** uma sessão selada com uma senha extra enviada pelo cabeçalho de sessão
- **Quando** `getSession` é chamada
- **Então** a sessão é aberta normalmente, sem re-selagem.

- **Dado** uma sessão selada com uma senha extra
- **Quando** `clearSession` é chamada
- **Então** a sessão é invalidada sem erro.

### RF-08 — Compatibilidade com sessões legadas

O fallback para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) continua valendo e se aplica a `password` e a todas as senhas extras. Uma sessão legada selada com qualquer uma delas é aberta e re-selada com `password` e as opções de selo atuais. `legacySealFallback: false` continua desligando o fallback.

**Critério de aceite**

- **Dado** uma sessão legada (1 iteração de PBKDF2) selada com uma senha extra e `legacySealFallback` ativo
- **Quando** a sessão é lida
- **Então** ela é aberta e re-selada com `password` e as opções de selo atuais, com novo `Set-Cookie`.

- **Dado** a mesma sessão legada e `legacySealFallback: false`
- **Quando** a sessão é lida
- **Então** ela não é aberta, e a sessão retornada é nova e vazia.

### RF-09 — Compatibilidade e qualidade

Nada além de `extraUnsealPasswords` é adicionado à API pública. O tipo de `password` não muda. `maxAge`, `idleTimeout`, cookies em chunks, cabeçalho de sessão, `errHeaders` e o restante do comportamento seguem como hoje. O conjunto de testes existente, `pnpm lint` e `pnpm typecheck` continuam passando, e há testes novos cobrindo os RF-01 a RF-08.

**Critério de aceite**

- **Dado** o código após a mudança
- **Quando** `pnpm test` é executado
- **Então** a suíte existente passa sem alteração de expectativas, `pnpm lint` e `pnpm typecheck` passam, e os cenários de RF-01 a RF-08 têm testes.

- **Dado** a lista de exports públicos de `h3` após a mudança
- **Quando** é comparada com a anterior
- **Então** a única diferença é o campo `extraUnsealPasswords` em `SessionConfig`.

## Fora de escopo

- Rotação automática ou agendada de senhas, e qualquer mecanismo que gere senhas.
- Variante (a) do issue (`password` como array de strings). Não será implementada.
- Armazenamento de sessões no servidor, troca de algoritmo de selo ou mudança no número de iterações de PBKDF2.
- Revogação ou expiração forçada de sessões já emitidas com senhas antigas, além do que o `maxAge` já faz.
- Carregamento de senhas a partir de variáveis de ambiente ou de serviços de segredos.
- Mudanças em outras partes do h3 (routing, middleware, adapters de runtime) e documentação fora do necessário para o campo novo.

## Premissas e riscos

### Premissas

- O projeto é o h3 v2, e a mudança fica em `src/utils/session.ts` e em seus internos de selo e abertura.
- `minPasswordlength` existe em `SessionConfig` e tem padrão de 32 caracteres.
- As senhas são lidas da configuração já existente no app; este trabalho não define de onde elas vêm.
- A ordem de tentativa (`password`, depois as extras na ordem da lista) é parte do contrato e não será randomizada nem otimizada.

### Riscos

- **Custo de CPU.** Cada senha tentada é uma derivação PBKDF2 completa. Uma sessão selada com a última de N senhas extras custa até N+1 derivações, e o fallback legado pode multiplicar o custo. Pode haver impacto de latência em aplicações com muitas senhas antigas. Mitigação: manter a lista curta e documentar o custo.
- **Set-Cookie em leituras.** A re-selagem de sessões com senha extra faz uma leitura gerar `Set-Cookie`. Isso pode afetar caches intermediários, proxies e respostas que não esperavam cabeçalho de cookie. Mitigação: documentar o comportamento e cobri-lo com testes.
- **Falha em todas as operações de escrita.** Uma senha extra inválida derruba toda operação que sela, inclusive em produção. Mitigação: validar a configuração de forma clara e cedo, com mensagem que aponte a senha.
- **Retenção de senhas antigas.** Manter senhas antigas na configuração as deixa ativas enquanto estiverem na lista. Isso é intencional, mas precisa de procedimento operacional para removê-las depois da janela de migração. A remoção fica fora deste escopo.
- **Vazamento de senhas.** Senhas antigas em código ou em logs de erro comprometem sessões. A mensagem de erro não deve conter o valor da senha.
- **Diferença de comportamento entre formatos.** Chunks e cabeçalho de sessão são caminhos separados, e uma correção em um pode não cobrir o outro. Mitigação: testes específicos para cada formato (RF-07).
