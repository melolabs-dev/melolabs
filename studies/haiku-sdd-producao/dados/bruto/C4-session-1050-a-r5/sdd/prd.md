# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (segunda alternativa proposta nela) e contrato `sdd/pedido.md`.

## Problema e objetivo

### Problema

Hoje `useSession` / `getSession` (em `src/utils/session.ts`) aceitam uma única `password` (`string`), usada tanto para selar quanto para abrir a sessão. Ao trocar a senha por motivos de rotação de segredos, todas as sessões seladas com a senha anterior deixam de abrir: o usuário é deslogado de uma vez.

### Objetivo

Permitir a rotação de senhas sem invalidar sessões existentes. O campo `password` passa a aceitar uma lista: a primeira senha sela as sessões novas; as demais servem apenas para abrir sessões seladas antes da troca. Quem usa uma senha só não precisa mudar nada.

## Requisitos funcionais

### RF-01 — `password` aceita uma lista de senhas

`SessionConfig.password` passa a aceitar `string | string[]`. Uma lista é uma sequência ordenada de senhas não vazias.

- **Dado** uma configuração de sessão com `password: ["nova-senha-com-32-caracteres-ou-mais", "senha-antiga-com-32-caracteres-ou-mais"]`
- **Quando** a sessão é criada ou lida
- **Então** a configuração é aceita, sem erro de tipo nem de execução.

### RF-02 — A primeira senha sela

Ao selar uma sessão, a primeira senha da lista é a única usada.

- **Dado** `password` como lista `[A, B]`
- **Quando** uma sessão é selada
- **Então** a sessão só abre com `A` isoladamente, e não abre com `B` isoladamente.

### RF-03 — Abrir sessão com qualquer senha da lista

Ao abrir uma sessão, as senhas são tentadas na ordem da lista; a sessão é aceita se qualquer uma delas a abrir.

- **Dado** `password` como lista `[A, B]` e uma sessão selada somente com `B`
- **Quando** a requisição envia o cookie dessa sessão
- **Então** os dados da sessão são carregados normalmente, como se a sessão estivesse selada com `A`.

### RF-04 — Compatibilidade com senha única

Uma `password` do tipo `string` (ou uma lista com um único item) se comporta exatamente como hoje.

- **Dado** `password: "senha-atual-com-32-caracteres-ou-mais"` e um cookie selado antes desta mudança
- **Quando** a sessão é lida
- **Então** os dados são carregados e o cookie emitido tem o mesmo formato de antes da mudança.

### RF-05 — Lista inválida é rejeitada

Uma lista vazia, ou que contenha um item vazio ou não string, é um erro de configuração.

- **Dado** `password: []`
- **Quando** uma sessão é selada ou aberta
- **Então** um erro é lançado com mensagem que indica a lista de senhas inválida. Nenhuma sessão é selada.

### RF-06 — Falha com todas as senhas mantém o comportamento atual

Se nenhuma senha da lista abrir a sessão, o resultado é o mesmo que hoje ocorre com uma senha errada.

- **Dado** `password: [A, B]` e um cookie selado com `C`
- **Quando** a sessão é lida
- **Então** o resultado é idêntico ao de hoje para um cookie selado com senha diferente da configurada (mesmo erro ou mesma sessão vazia, conforme o código atual).

### RF-07 — Fallback de sessões legadas vale para cada senha

O fallback existente para sessões seladas com 1 iteração de PBKDF2 (`legacySealFallback`) deve ser aplicado a cada senha da lista, e não só à primeira.

- **Dado** `password: [A, B]`, `legacySealFallback` ativo (padrão) e um cookie legado selado com `B`
- **Quando** a sessão é lida
- **Então** a sessão abre e é regravada, do mesmo modo que um cookie legado selado com `A`.

### RF-08 — Tipo público e documentação atualizados

O campo `password` de `SessionConfig` tem o tipo `string | string[]` e a documentação JSDoc explica que a primeira senha sela e as demais só abrem. Nenhum outro nome público novo é criado.

- **Dado** o código fonte após a mudança
- **Quando** o tipo de `SessionConfig["password"]` é verificado
- **Então** ele aceita `string` e `string[]`, e o JSDoc descreve a regra da primeira senha.

## Fora de escopo

- Nova opção separada (ex.: `extraUnsealPasswords`), que é a primeira alternativa da issue #1050.
- Regravação automática de sessões antigas com a senha nova fora do fluxo já existente de `getSession`. Só o fluxo atual de reselagem é mantido.
- Identificadores explícitos de senha (`{ id, secret }`) em `password`. O suporte a IDs já existente em `iron-crypto.ts` não é exposto pela API de sessão nesta entrega.
- Mecanismo de expiração ou remoção de senhas antigas (agendamento, aviso, telemetria).
- Mudanças no formato do cookie selado, nos parâmetros de PBKDF2 ou no algoritmo de selagem.
- Alterações em outros módulos (`h3/rules`, `auth`, `cookie`) além do que for necessário para o novo tipo de `password`.
- Versões de documentação fora do próprio JSDoc (guia, changelog, exemplos de migração).

## Premissas e riscos

### Premissas

- A senha selada não carrega nenhum identificador útil. Pela leitura de `src/utils/internal/iron-crypto.ts`, senhas do tipo `string` têm id vazio, que é tratado como `default` na abertura. Logo, o token não diz qual senha o selou, e a abertura precisa tentar cada senha da lista na ordem. Isso deve ser confirmado nos testes.
- A ordem da lista é a ordem de tentativa, e a primeira senha é a de selagem. Não há outro critério.
- A verificação de tipo e o uso de `config.password` em outros pontos do código devem ser revisados com busca no projeto antes da implementação. Ainda não foi feita.
- A suíte existente (`test/session.test.ts` e demais) continua válida para o caso de senha única.

### Riscos

- **Custo de CPU.** Cada tentativa de abertura faz PBKDF2 (8192 iterações por padrão). Com N senhas, uma requisição com cookie inválido custa até N tentativas, e o fallback legado pode dobrar esse custo para cada senha. Isso pode ser usado para negação de serviço leve. Mitigação possível: limitar o tamanho da lista e documentar o custo; medir antes de liberar.
- **Superfície de ataque maior.** Senhas antigas continuam válidas enquanto estiverem na lista. Se uma senha antiga vazar, as sessões que ela selou ficam expostas até ela ser removida. A documentação precisa deixar isso claro.
- **Remoção de senha invalida sessões.** Sessões seladas só com uma senha retirada da lista deixam de abrir. Isso é o comportamento esperado, mas precisa estar documentado.
- **Quebra de tipagem.** Código que lê `config.password` como `string` deixa de compilar. Pode afetar usuários da API pública; é uma mudança de tipo compatível para quem só passa strings, mas não para quem lê o campo.
- **Comportamento de erro ambíguo.** RF-05 e RF-06 precisam de mensagens distintas para lista inválida e senha errada, sem vazar qual senha falhou.
- **Testes de matriz.** Cada cenário deve rodar em `web` e `node` (`describeMatrix`), o que dobra o tempo de execução dos novos testes.
