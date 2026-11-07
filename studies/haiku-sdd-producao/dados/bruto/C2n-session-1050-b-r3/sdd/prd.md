# PRD — Múltiplas senhas de unseal nas sessões (h3js/h3#1050)

## Status

Rascunho. As decisões listadas em "Decisões pendentes" precisam de resposta antes da implementação. Os requisitos RF-01 a RF-11 valem independentemente delas, salvo onde a própria decisão for citada.

## Problema e objetivo

Hoje `useSession` / `getSession` (em `src/utils/session.ts`) aceitam uma única senha em `SessionConfig.password`. Ela serve tanto para selar quanto para abrir o cookie de sessão. Quando a equipe troca essa senha (rotação de segredo), todas as sessões seladas com a senha antiga deixam de abrir, e os usuários são deslogados de uma vez.

Objetivo: permitir que a aplicação informe senhas anteriores que continuam abrindo sessões já emitidas, sem que elas passem a selar novas sessões. A senha atual continua sendo a única usada para selar. Esta é a primeira alternativa proposta na issue h3js/h3#1050, com a configuração feita num campo novo.

## Termos

- **Selar:** gravar os dados da sessão no cookie, protegidos por uma senha.
- **Abrir (unseal):** ler o cookie com uma senha e recuperar os dados.
- **Senha atual:** `SessionConfig.password`. É a única usada para selar.
- **Senhas extras:** `SessionConfig.extraUnsealPasswords`. Servem só para abrir.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com as senhas anteriores. Se o campo for omitido, equivale a `[]`. `password` continua sendo `string` e continua sendo a única senha usada para selar.

**Critério de aceite**
- Dado uma configuração com `password: "A..."` e `extraUnsealPasswords: ["B..."]`,
- Quando a configuração é usada em `useSession` ou `getSession`,
- Então a aplicação compila sem erros de tipo, e `password` continua aceitando apenas `string`.

### RF-02 — Sessões seladas com a senha atual continuam válidas

Sessões seladas com `password` devem ser abertas normalmente, com ou sem `extraUnsealPasswords`.

**Critério de aceite**
- Dado uma sessão selada com `password`,
- Quando a requisição chega com `extraUnsealPasswords` configurado,
- Então a sessão é lida, os dados são os mesmos de antes, e a resposta não traz `Set-Cookie` novo.

### RF-03 — Ordem de tentativas

Para abrir um cookie, o sistema tenta nesta ordem:

1. `password`, com o formato atual e, se permitido, o fallback legado de PBKDF2;
2. cada senha de `extraUnsealPasswords`, na ordem declarada, com o mesmo critério do item 1.

Para na primeira tentativa que abrir o cookie. Se nenhuma abrir, a sessão é tratada como inválida (RF-05).

**Critério de aceite**
- Dado uma sessão selada com `"B..."` e uma configuração com `password: "A..."` e `extraUnsealPasswords: ["B..."]`,
- Quando a requisição chega com o cookie de sessão,
- Então `getSession` devolve os dados gravados na sessão.

### RF-04 — Sessões abertas por senha extra são regravadas com a senha atual

Quando uma sessão é aberta por uma senha extra, a resposta regrava o cookie selado com `password`. A regravação usa o mesmo mecanismo de escrita que a API já usa para selar, e o usuário da biblioteca não precisa chamar nada a mais. A rotação converge: cada sessão ativa troca de selo na primeira requisição em que é lida com a configuração nova. Vale só para sessões lidas do cookie. Sessões lidas do header abrem com as senhas extras, mas não recebem `Set-Cookie` (techspec, D-03).

Se não houver resposta onde gravar o cookie, a sessão continua válida naquela requisição, e a regravação acontece na próxima em que for possível.

**Critério de aceite**
- Dado uma sessão selada com a senha extra `"B..."`,
- Quando a requisição é processada com `password: "A..."`,
- Então a resposta traz um `Set-Cookie` com um selo novo, e a próxima requisição abre a sessão usando `"A..."` sem tentar a senha extra.

### RF-05 — Senha que não está na lista continua rejeitada

Sessões seladas com qualquer senha que não seja `password` nem esteja em `extraUnsealPasswords` são tratadas como hoje. Não abrem, a sessão fica vazia, e nenhum erro não tratado é lançado.

**Critério de aceite**
- Dado uma sessão selada com `"C..."`, e uma configuração com `password: "A..."` e `extraUnsealPasswords: ["B..."]`,
- Quando a requisição chega com esse cookie,
- Então `getSession` devolve uma sessão vazia, com o mesmo resultado de um cookie inválido hoje.

### RF-06 — Comportamento sem senhas extras é idêntico ao atual

Se `extraUnsealPasswords` não for informado, ou for um array vazio, o comportamento deve ser exatamente o de hoje, inclusive o fallback legado de PBKDF2 e a opção `legacySealFallback` (antes chamada `rejectLegacySeal`, ver techspec, seção 0).

**Critério de aceite**
- Dado uma configuração sem `extraUnsealPasswords`,
- Quando a suíte existente de sessões é executada,
- Então todos os testes que passavam antes continuam passando sem alteração de asserção.

### RF-07 — Expiração continua valendo para sessões de senha extra

`maxAge` e `idleTimeout` são verificados da mesma forma, independentemente de qual senha abriu a sessão. A regravação de RF-04 renova `lastSeenAt` antes da metade da janela de inatividade, o que estende a janela além do que uma leitura normal faria. Proposta, D-08 da techspec, pendente de confirmação da equipe. `maxAge` não é estendido, porque `createdAt` não muda.

**Critério de aceite**
- Dado uma sessão selada com `"B..."` cujo `createdAt` ultrapassa `maxAge`,
- Quando a requisição chega com `password: "A..."` e `extraUnsealPasswords: ["B..."]`,
- Então a sessão é tratada como expirada e não devolve os dados.

- Dado uma sessão selada com `"B..."` cujo `lastSeenAt` está além de `idleTimeout`,
- Quando a requisição chega com a mesma configuração,
- Então a sessão é tratada como expirada e não devolve os dados.

### RF-08 — Fallback legado funciona com senhas extras

Sessões seladas no formato legado (1 iteração PBKDF2) também devem ser aceitas quando seladas com uma senha extra, desde que `legacySealFallback` não seja `false`. Com `legacySealFallback: false`, a mesma sessão é rejeitada, como hoje.

**Critério de aceite**
- Dado uma sessão legada selada com `"B..."`,
- Quando a requisição chega com `password: "A..."`, `extraUnsealPasswords: ["B..."]` e `legacySealFallback` ausente,
- Então a sessão é aberta, e a resposta a regrava com a senha atual e as iterações atuais.

- Dado a mesma sessão legada,
- Quando a requisição chega com `legacySealFallback: false`,
- Então a sessão é rejeitada e a resposta não traz `Set-Cookie`.

### RF-09 — Nenhum outro nome público novo

A mudança não introduz exports, tipos públicos ou opções além de `extraUnsealPasswords`. Helpers internos ficam em módulos não exportados pelos entry points.

**Critério de aceite**
- Dado o diff do PR,
- Quando comparado com a API pública atual (exports de `src/index.ts` e dos subpaths que reexportam sessões),
- Então a única adição pública é o campo `extraUnsealPasswords` em `SessionConfig`.

### RF-10 — Qualidade do código

- Os testes existentes continuam passando sem alteração de asserção.
- Os testes novos cobrem RF-03 a RF-08 e usam `describeMatrix`, para rodar nos modos `web` e `node`.
- `pnpm lint` e `pnpm typecheck` passam. São comandos separados: o lint não inclui o typecheck (`package.json`). Ver "Decisões pendentes", item 5.
- `pnpm vitest run test/session.test.ts` passa.

**Critério de aceite**
- Dado a branch com a mudança,
- Quando `pnpm lint` e `pnpm vitest run test/session.test.ts` são executados,
- Então os dois terminam sem erro.

### RF-11 — Documentação no código

O JSDoc de `extraUnsealPasswords` explica que essas senhas só abrem sessões, que são tentadas na ordem declarada, que sessões abertas por elas são regravadas com `password`, e que devem ser removidas depois da janela descrita em "Procedimento de rotação".

Mudanças na documentação pública fora do JSDoc continuam fora de escopo.

**Critério de aceite**
- Dado o JSDoc de `SessionConfig.extraUnsealPasswords`,
- Quando lido por quem usa a biblioteca,
- Então ele responde se a senha sela (não), em que ordem é tentada, e quando remover.

## Procedimento de rotação

Este é o fluxo que a equipe segue. Ele também define o uso esperado do campo.

1. Gerar a nova senha, com pelo menos 32 caracteres.
Proposta, D-10 da techspec, pendente de confirmação da equipe. A rotação tem duas fases antes da remoção, porque durante um deploy rolante uma instância com a configuração antiga não abre cookie selado com a senha nova.

2. Deploy A: `password` = senha antiga e `extraUnsealPasswords` = `[senha nova]`. Nada é selado com a senha nova ainda, mas todas as instâncias passam a conseguir abri-la. Esperar até todas as instâncias estarem no deploy A.
3. Deploy B: `password` = senha nova e `extraUnsealPasswords` = `[senha antiga]`. A partir daqui o selo muda, e as sessões lidas com a senha antiga são regravadas com a nova. A janela de remoção da senha antiga começa neste deploy, não no A.
4. Esperar pelo menos `maxAge` desde o deploy B. Sessões que não foram lidas nesse período continuam seladas com a senha antiga. Depois de `maxAge`, elas expiram de qualquer forma, por causa de RF-07.
5. Deploy C: remover a senha antiga de `extraUnsealPasswords`. Sessões que ainda usam a senha antiga deixam de abrir, o que é o esperado.

Se `maxAge` não estiver definido, a janela não tem fim e a remoção da senha antiga depende de decisão manual (ver "Decisões pendentes", item 4).

## Fora de escopo

- A segunda alternativa da issue (`password` como `string[]`). Não será implementada agora.
- Rotação automática de senhas, agendamento ou expiração de chaves.
- Ferramenta ou endpoint para revogar sessões antigas.
- Migração em massa de cookies fora do fluxo de requisição (cada sessão migra quando for lida).
- Remoção do fallback legado de PBKDF2 (prevista para v3, conforme `legacySealFallback`).
- Alterações em outros utilitários de autenticação (`basicAuth`, `requireBasicAuth`) ou em cookies chunked.
- Mudanças na documentação pública além do JSDoc de `extraUnsealPasswords` (RF-11).

## Premissas

- A lista de senhas extras é configuração do servidor, carregada da mesma fonte que `password` (variável de ambiente, cofre etc.). Não há mudança em como essa fonte é lida.
- Quando a equipe remove uma senha antiga da lista, as sessões seladas com ela deixam de abrir. Isso é o esperado.
- O caminho de leitura de `getSession` consegue emitir `Set-Cookie` nas rotas em que é usado. Ver "Decisões pendentes", item 3.

## Riscos

- **Desempenho:** cada tentativa de unseal envolve PBKDF2 e HMAC. O custo dominante é de `N + 1` derivações de 8192 iterações por cookie que não abre pela senha atual, onde `N` é o número de senhas extras. A tentativa legada custa uma derivação de 1 iteração, então não dobra o custo. Medir com `pnpm bench:node` antes de definir o limite da lista.
- **Superfície de ataque:** qualquer senha extra vazada permite abrir sessões. Manter a lista curta e remover senhas antigas assim que a rotação terminar.
- **Set-Cookie durante a rotação:** cada sessão antiga gera um `Set-Cookie` na primeira requisição depois do deploy. Depois disso, não gera mais, porque o selo passa a ser o atual. Esse custo ocorre uma vez por sessão.
- **Requisições paralelas:** várias requisições com o mesmo cookie antigo regravam em paralelo, e o último `Set-Cookie` que chega vence. Os dados são os mesmos, então o efeito é só tráfego extra. Uma escrita de sessão feita em paralelo pode ser perdida, como já acontece hoje sem rotação.
- **Regressão silenciosa:** os testes existentes podem não cobrir todos os caminhos de unseal. RF-06 depende de a suíte cobrir o caminho sem senhas extras. Se não cobrir, adicionar casos antes da mudança.
- **Interação com `idleTimeout`:** a regravação por RF-04 atualiza `lastSeenAt` quando `idleTimeout` está ativo. RF-07 cobre esse ponto, e o teste deve confirmá-lo.
- **Sem `maxAge`:** sem esse limite, sessões antigas nunca expiram por tempo, e o procedimento de rotação não tem prazo para remover a senha antiga.

## Decisões pendentes

1. **Regravação (RF-04):** decidida (sim). Techspec, seção 9, item 1, e D-03.
2. **Tamanho mínimo (32 caracteres):** aberta. A techspec propõe lançar erro em runtime para extras curtas (D-06). A equipe ainda precisa aceitar.
3. **Caminho de escrita:** decidida. `updateSession` grava por `event.res`, que existe em todo `H3Event`. Vale para cookie, não para header (techspec, seção 9, item 3).
4. **Limite da lista e `maxAge` ausente:** aberta. A techspec propõe nenhum limite no código (D-07) e 3 na documentação. Sem `maxAge`, a remoção é manual.
5. **Nomes dos comandos:** decidida. `pnpm typecheck` existe (`package.json`), `pnpm lint` não inclui o typecheck, e `test/session.test.ts` existe. Techspec, seção 9, item 5. A correção de `AGENTS.md:18` fica para mudança separada.
6. **Procedimento de rotação:** proposta, aguarda a equipe. Duas fases antes da remoção, com três deploys (D-10 da techspec).
