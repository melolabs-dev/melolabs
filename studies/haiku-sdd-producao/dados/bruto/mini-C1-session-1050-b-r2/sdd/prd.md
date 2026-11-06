# PRD: várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela), contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

### Problema

As sessões de `useSession`, `getSession` e `updateSession` (`src/utils/session.ts`) são seladas com um único `password`. Ao trocar essa senha, todas as sessões seladas com a senha antiga deixam de abrir, e o usuário é desconectado de uma vez. Quem faz rotação de segredos não consegue trocar a senha sem derrubar as sessões ativas.

### Objetivo

Permitir que `SessionConfig` declare senhas anteriores, que só servem para abrir sessões já emitidas. A senha atual (`password`) continua sendo a única usada para selar. Sem senhas extras, o comportamento não muda.

## Requisitos funcionais

### RF-01 — Abrir sessões seladas com senha extra

O `SessionConfig` aceita o campo opcional `extraUnsealPasswords: string[]`. Uma sessão selada com uma dessas senhas deve ser lida normalmente.

**Critério de aceite**

- **Dado** uma configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`, e um cookie de sessão selado com `P0`,
- **Quando** `getSession` é chamado com essa configuração na requisição,
- **Então** a sessão é carregada com o mesmo `id`, `createdAt` e `data` que foram selados.

### RF-02 — Selar sempre com `password`

Qualquer sessão nova ou regravada deve ser selada com `password`, mesmo quando `extraUnsealPasswords` existe.

**Critério de aceite**

- **Dado** uma configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`,
- **Quando** `updateSession` grava dados numa sessão nova,
- **Então** o cookie resultante abre com `P1` e não abre com `P0`.

### RF-03 — Migrar para `password` ao ler uma sessão com senha extra

Quando uma sessão só abre com uma senha extra, ela é regravada selada com `password` na mesma requisição. Assim, a rotação se completa sem ação do usuário.

**Critério de aceite**

- **Dado** uma sessão selada com `P0`, e a configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`,
- **Quando** `getSession` lê essa sessão,
- **Então** a resposta contém um `Set-Cookie` da sessão, e esse cookie abre com `P1` (e não com `P0`).

### RF-04 — Ordem de tentativa

A senha `password` é tentada primeiro. As senhas extras são tentadas na ordem declarada, e a primeira que abrir a sessão vence. Se `password` abrir a sessão, nenhuma senha extra é tentada.

**Critério de aceite**

- **Dado** uma sessão selada com `P1` e a configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`,
- **Quando** `unsealSession` é chamado,
- **Então** a sessão é aberta na primeira tentativa, e `P0` não é usada.

### RF-05 — Sem senhas extras, comportamento idêntico ao atual

Se `extraUnsealPasswords` estiver ausente ou vazio, o código deve se comportar como hoje: mesmo resultado, mesmo número de operações de unseal e mesmo tratamento de erro.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`, e um cookie selado com outra senha,
- **Quando** `getSession` é chamado,
- **Então** a sessão é nova (sem dados da sessão antiga), e a única tentativa de unseal foi com `password`.

### RF-06 — Senha não listada não abre a sessão

Um cookie selado com uma chave que não está em `password` nem em `extraUnsealPasswords` é tratado como sessão inexistente, como acontece hoje com qualquer cookie inválido.

**Critério de aceite**

- **Dado** uma configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`, e um cookie selado com `P9`,
- **Quando** `getSession` é chamado,
- **Então** a sessão retornada é nova, com `id` novo, sem `data` herdada, e nenhum erro chega ao handler.

### RF-07 — Fallback legado vale para cada senha

O fallback de selagem legada (1 iteração PBKDF2, controlado por `legacySealFallback`) deve ser aplicado a cada senha candidata, para que sessões antigas seladas com uma senha extra continuem abrindo.

**Critério de aceite**

- **Dado** uma sessão selada com `P0` usando 1 iteração PBKDF2, e a configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`, com `legacySealFallback` em seu padrão,
- **Quando** `getSession` lê essa sessão,
- **Então** a sessão é carregada com os dados originais e regravada com `P1`.

### RF-08 — Expiração continua valendo

Uma sessão aberta por senha extra fica sujeita às mesmas regras de `maxAge` e `idleTimeout`. A senha que abriu a sessão não estende sua vida.

**Critério de aceite**

- **Dado** uma sessão selada com `P0`, com `createdAt` além de `maxAge` e a configuração com `password` = `P1` e `extraUnsealPasswords` = `["P0"]`,
- **Quando** `getSession` lê essa sessão,
- **Então** a sessão é tratada como expirada e substituída por uma sessão nova.

### RF-09 — Retirar uma senha antiga invalida as sessões dela

Ao remover uma senha de `extraUnsealPasswords`, as sessões seladas com ela deixam de abrir. Isso permite encerrar a janela de compatibilidade.

**Critério de aceite**

- **Dado** uma sessão selada com `P0`, e uma configuração em que `P0` foi removida de `extraUnsealPasswords`,
- **Quando** `getSession` lê essa sessão,
- **Então** a sessão retornada é nova e a sessão antiga não é carregada.

### RF-10 — API pública mínima

O único nome público novo é o campo `extraUnsealPasswords` em `SessionConfig`. O campo é opcional e tipado como `string[]`.

**Critério de aceite**

- **Dado** o tipo `SessionConfig`,
- **Quando** o código de um usuário passa `extraUnsealPasswords: ["..."]` ou omite o campo,
- **Então** o `pnpm typecheck` passa nos dois casos, e nenhum outro export novo aparece em `src/`.

### RF-11 — Testes cobrem os dois modos de runtime

Os testes novos ficam em `test/session.test.ts` (ou arquivo de sessão já existente) e usam `describeMatrix`, para rodar em `web` e `node`.

**Critério de aceite**

- **Dado** os testes de RF-01 a RF-09 escritos com `describeMatrix`,
- **Quando** `pnpm vitest run test/session.test.ts` é executado,
- **Então** todos passam nos modos `web` e `node`, e a suíte existente continua passando sem ser enfraquecida.

## Fora de escopo

- Alternativa 2 da issue: aceitar `password` como array. Não entra nesta versão.
- Novos nomes públicos além de `extraUnsealPasswords` (por exemplo, opções de rotação, callbacks ou eventos).
- Rotação automática de chaves, agendamento ou invalidação de sessões em armazenamento.
- Migração em massa de sessões. A migração acontece só quando a sessão é lida (RF-03).
- Mudança no formato do selo (iron) ou nas opções padrão de `seal`.
- Remoção do `legacySealFallback`. Ela está prevista para v3.
- Sessões lidas pelo header (`sessionHeader`). Elas continuam sem resselagem, como hoje.
- Mudanças em outros utilitários (`cookie`, `auth`, `cors`, `session` de terceiros).
- Documentação do site fora do JSDoc de `SessionConfig`.

## Premissas

- As sessões são stateless: o estado vive no cookie selado, então não há banco a migrar.
- `password` e as senhas extras seguem a mesma política (string não vazia, mínimo de 32 caracteres, conforme o JSDoc atual). A validação precisa ser confirmada no código antes da implementação.
- A regravação ao ler (RF-03) é a decisão padrão deste PRD. Ela não está no contrato e pode ser recusada.
- O custo extra de tentar senhas adicionais é aceitável para listas pequenas, de uma a três senhas.
- O alvo é a versão v2 do pacote. Não há quebra de contrato porque o campo é opcional.

## Riscos

- **Amplificação de CPU.** Cada senha extra soma tentativas de unseal (PBKDF2) para cada cookie inválido. Com o fallback legado, o custo pode chegar a 2 × (N + 1) derivações por requisição, onde N é o número de senhas extras. Mitigação: documentar um limite recomendado e medir o custo em `pnpm bench:node`.
- **Janela de sessões comprometidas.** Se a rotação foi motivada por vazamento, manter `P0` na lista mantém vivas as sessões que ela selou. O risco é operacional, e deve ser explicado na documentação do campo.
- **Mais `Set-Cookie` em leituras.** A migração de RF-03 faz uma selagem extra na primeira leitura de cada sessão antiga. O custo é pontual, mas existe.
- **Ambiguidade de diagnóstico.** Sessão com senha errada e sessão expirada viram "sessão nova" nos dois casos. Isso é o comportamento atual, mas dificulta investigar falhas de rotação.
- **Regressão em `unsealSession`.** A função é exportada e chamada por `getSession`. Mudar a ordem de tentativa pode afetar quem a usa diretamente. Mitigação: RF-05 e os testes existentes como rede de segurança.
