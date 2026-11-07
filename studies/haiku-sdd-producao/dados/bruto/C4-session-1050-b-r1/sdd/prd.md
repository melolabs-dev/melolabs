# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050, variante B)

## Problema e objetivo

Hoje `useSession` (`src/utils/session.ts`) usa uma única `password` para selar e para deselar os cookies de sessão. Ao trocar essa senha (rotação de segredo), todas as sessões seladas com a senha antiga deixam de ser aceitas, e os usuários são desconectados.

**Objetivo:** permitir que a aplicação informe senhas anteriores que continuam abrindo sessões já emitidas, sem que novas sessões sejam seladas com elas. A rotação passa a ser feita sem derrubar sessões ativas.

Esta variante usa um campo novo na configuração (`extraUnsealPasswords`), e não a alternativa de tornar `password` um array, que foi descartada.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores aceitas apenas para deselar. O campo deve ter JSDoc explicando seu papel, no mesmo estilo dos demais campos.

**Critério de aceite**
- **Dado** uma configuração de sessão com `extraUnsealPasswords: ["senha-antiga-com-32-caracteres-ou-mais..."]`
- **Quando** o tipo `SessionConfig` é verificado pelo typecheck
- **Então** o campo é aceito como opcional, do tipo `string[]`, e nenhum outro nome público novo é exportado.

### RF-02 — Selagem sempre com `password`

Toda sessão nova ou resealada é selada exclusivamente com `password`. As senhas de `extraUnsealPasswords` nunca são usadas para selar.

**Critério de aceite**
- **Dado** uma configuração com `password: "senha-atual..."` e `extraUnsealPasswords: ["senha-antiga..."]`
- **Quando** uma sessão é criada com `useSession` e salva
- **Então** o cookie só pode ser desselado com `password` e não com `senha-antiga`.

### RF-03 — Tentativa de deselagem em ordem

Ao ler o cookie, o H3 tenta deselar primeiro com `password` e, se falhar, com cada item de `extraUnsealPasswords`, na ordem da lista. A primeira senha que validar é usada.

**Critério de aceite**
- **Dado** uma sessão selada com `senha-antiga` e uma configuração com `password: "senha-atual..."` e `extraUnsealPasswords: ["senha-antiga..."]`
- **Quando** a sessão é lida com `getSession`
- **Então** os dados da sessão são retornados corretamente e a sessão não é recriada.

### RF-04 — Comportamento atual preservado sem senhas extras

Quando `extraUnsealPasswords` não é informado ou é um array vazio, a leitura e a escrita de sessões se comportam exatamente como hoje.

**Critério de aceite**
- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** a suíte existente de sessões é executada
- **Então** todos os testes existentes passam sem alteração de asserções.

### RF-05 — Sessão com senha inválida em todas as tentativas

Se nenhuma senha (`password` nem as extras) deselar o cookie, a sessão é tratada como hoje: sem dados e sem erro para o usuário.

**Critério de aceite**
- **Dado** um cookie selado com `senha-desconhecida` e uma configuração com `password` e `extraUnsealPasswords` diferentes dela
- **Quando** a sessão é lida com `getSession`
- **Então** a sessão é tratada como inexistente (o mesmo resultado de um cookie inválido hoje), sem lançar exceção.

### RF-06 — Compatibilidade com o fallback legado

O caminho de compatibilidade para sessões seladas com 1 iteração de PBKDF2 (`unsealSession`) funciona também para as senhas extras, ou seja, a tentativa legada é feita para cada senha candidata.

**Critério de aceite**
- **Dado** um cookie selado com 1 iteração de PBKDF2 usando `senha-antiga`, e a configuração com `extraUnsealPasswords: ["senha-antiga..."]`
- **Quando** a sessão é lida com `getSession`
- **Então** a sessão é desselada, e o cookie é resealado com `password` pelo caminho já existente.

### RF-07 — Reseal com a senha atual após uso de senha extra

Quando uma sessão só abre com uma senha extra, ela é resealada com `password` na próxima escrita de cookie que o H3 já faz (por exemplo, a renovação por `idleTimeout`). Assim, as sessões migram para a senha nova sem ação do usuário.

**Critério de aceite**
- **Dado** uma sessão selada com `senha-antiga` e lida com `extraUnsealPasswords: ["senha-antiga..."]`
- **Quando** o H3 reescreve o cookie dessa sessão
- **Então** o novo cookie é selado com `password` e deseláveis apenas com ela (sem a senha antiga).

### RF-08 — Validação das senhas extras

Cada item de `extraUnsealPasswords` deve ter pelo menos 32 caracteres, o mesmo mínimo documentado para `password`. Senhas abaixo desse limite geram erro de configuração em vez de serem ignoradas em silêncio.

**Critério de aceite**
- **Dado** uma configuração com `extraUnsealPasswords: ["curta"]`
- **Quando** a sessão é criada ou lida
- **Então** o H3 lança um erro de configuração indicando que a senha extra é curta demais.

## Fora de escopo

- Tornar `password` um array (alternativa 2 da issue).
- Selar sessões com as senhas extras, ou escolher a senha de selagem por sessão.
- Rotação automática de senhas (agendamento, geração de chaves, integração com cofres de segredo).
- Expiração automática de senhas extras. Elas são removidas manualmente pela aplicação.
- Mudanças em `src/utils/internal/iron-crypto.ts` além do estritamente necessário para aceitar a lista de senhas.
- Mudanças em `cookie.ts`, `useSession` de outras formas ou em outros utilitários.
- Remoção do fallback legado (isso é tarefa da v3, já citada no código).
- Novos exports públicos além do campo `extraUnsealPasswords`.
- Mudanças na documentação de site ou no changelog.

## Premissas e riscos

### Premissas

- `iron-crypto.ts` aceita uma senha por chamada a `unseal`. A solução prevista é tentar em laço, uma chamada por senha, sem alterar a API do iron.
- A verificação de integridade do iron falha de forma previsível para senha errada (retorna falha ou lança erro que o código atual já trata), para que o laço possa continuar.
- O mínimo de 32 caracteres (RF-08) é a regra que já vale para `password`; se ela não for aplicada hoje, a validação das extras deve seguir a mesma prática, e isso será confirmado na implementação.
- Testes seguem o padrão `describeMatrix` (web e node), conforme `AGENTS.md`.

### Riscos

- **Segurança:** uma senha antiga comprometida continua abrindo sessões enquanto estiver na lista. Mitigação: documentar que a lista deve ser esvaziada depois de um período maior que o `maxAge` das sessões.
- **Desempenho:** cada senha extra adiciona uma tentativa de deselagem (PBKDF2) para sessões com senha antiga. Com muitas senhas, a latência de leitura aumenta. Mitigação: documentar o custo e limitar o uso a poucas senhas.
- **Regressão:** o laço de tentativas mexe no caminho de leitura de todas as sessões. Mitigação: RF-04 exige que a suíte existente passe sem alterar asserções.
- **Ambiguidade de erro:** se a senha extra for curta, o erro pode aparecer só na primeira leitura de sessão, e não na configuração. Mitigação: validar na criação do handler quando possível.
- **Ajuste de testes existentes:** se algum teste existente depender do formato de falha de `unseal`, ele deve ser ajustado apenas no que a mudança altera, sem reduzir o que verifica (regra do `pedido.md`).
