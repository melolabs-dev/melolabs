# PRD — Várias senhas de unseal nas sessões (#1050-b)

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela) e contrato `sdd/pedido.md`.

## Problema e objetivo

### Problema

As sessões do H3 são seladas com `password` (`src/utils/session.ts`, `SessionConfig.password`). Hoje, trocar essa senha invalida todas as sessões existentes: o `unseal` falha com a nova chave e o usuário precisa entrar de novo. Em um processo normal de rotação de segredos, isso força um logout em massa.

### Objetivo

Permitir que a aplicação rotacione `password` sem invalidar as sessões seladas com senhas anteriores. A nova senha passa a selar; as senhas antigas, listadas em um campo novo, continuam aceitas apenas para abrir (unseal) sessões. Sem o campo novo, o comportamento deve ser idêntico ao atual.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

`SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, documentado com JSDoc no mesmo estilo dos demais campos (senhas anteriores, usadas somente para abrir sessões). `password` continua sendo `string`.

**Critério de aceite**

- **Dado** um `SessionConfig` com `password` e `extraUnsealPasswords: [senhaAntiga]`
- **Quando** o tipo é verificado pelo TypeScript
- **Então** a configuração compila sem erro, e `extraUnsealPasswords` é opcional (omitir o campo também compila).

### RF-02 — Unseal tenta a senha atual e depois as extras, em ordem

Ao abrir uma sessão, o H3 tenta `password` primeiro e, se falhar, tenta cada item de `extraUnsealPasswords` na ordem em que foram declarados. A primeira senha que validar a sessão é usada. Se nenhuma validar, o erro atual de unseal é propagado sem mudança.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` e uma configuração com `password: senhaNova` e `extraUnsealPasswords: [senhaAntiga]`
- **Quando** a requisição chega com o cookie dessa sessão
- **Então** a sessão é aberta normalmente, com os mesmos dados que tinha antes da rotação.

**Critério de aceite (falha)**

- **Dado** uma sessão selada com uma senha que não está em `password` nem em `extraUnsealPasswords`
- **Quando** a requisição chega com o cookie dessa sessão
- **Então** a sessão é tratada como inválida, da mesma forma que hoje ocorre com uma senha errada.

### RF-03 — Selagem usa somente `password`

Sessões novas e sessões regravadas (ex.: após escrita ou deslizamento de `idleTimeout`) são seladas exclusivamente com `password`. `extraUnsealPasswords` nunca é usado para selar.

**Critério de aceite**

- **Dado** uma configuração com `password: senhaNova` e `extraUnsealPasswords: [senhaAntiga]`
- **Quando** uma sessão nova é criada e persistida
- **Então** o cookie resultante só abre com `senhaNova`, e não abre com `senhaAntiga`.

### RF-04 — Sessão aberta com senha extra é regravada com a senha atual

Quando uma sessão é aberta com uma senha de `extraUnsealPasswords`, a próxima gravação da sessão (feita pelo fluxo normal de `getSession`/`useSession`) a sela novamente com `password`. Assim, a rotação converge: sem novas requisições, a senha antiga deixa de ser necessária para aquele usuário.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga`, aberta com `extraUnsealPasswords: [senhaAntiga]`
- **Quando** a sessão é regravada após a leitura
- **Então** o novo cookie abre com `senhaNova` e não abre mais com `senhaAntiga`.

### RF-05 — Sem senhas extras, comportamento inalterado

Quando `extraUnsealPasswords` é omitido ou é `[]`, o unseal faz exatamente uma tentativa com `password`, com as mesmas opções de seal, o mesmo fallback de `legacySealFallback` e os mesmos erros de hoje.

**Critério de aceite**

- **Dado** uma configuração sem `extraUnsealPasswords`
- **Quando** a suíte existente de sessões é executada
- **Então** todos os testes existentes passam sem alteração de asserções.

### RF-06 — Expiração continua independente da senha

`maxAge` e `idleTimeout` continuam sendo verificados depois do unseal, independentemente de qual senha abriu a sessão. Uma sessão expirada não volta a ser válida por ter sido aberta com uma senha extra.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` cujo `createdAt` ultrapassou `maxAge`
- **Quando** a sessão é lida com `extraUnsealPasswords: [senhaAntiga]`
- **Então** a leitura falha com o mesmo "Session expired!" que ocorre hoje.

### RF-07 — Validação das senhas extras

Cada item de `extraUnsealPasswords` deve ser `string` não vazia e atender à mesma regra de tamanho mínimo que `password` (hoje, 32 caracteres). Uma configuração inválida falha na criação da sessão com erro claro, e não silenciosamente.

**Critério de aceite**

- **Dado** uma configuração com `extraUnsealPasswords: ["curta"]`
- **Quando** a sessão é usada pela primeira vez
- **Então** o H3 lança um erro informando que a senha extra é inválida, sem tentar abrir nenhum cookie.

### RF-08 — Funciona para cookie e para header de sessão

O unseal de várias senhas vale para sessões lidas do cookie e para sessões lidas do header `x-h3-session` (ou o nome configurado), pois ambos passam pelo mesmo caminho de unseal.

**Critério de aceite**

- **Dado** uma sessão selada com `senhaAntiga` enviada pelo header de sessão
- **Quando** a requisição é processada com `extraUnsealPasswords: [senhaAntiga]`
- **Então** a sessão é aberta com os mesmos dados que teria pelo cookie.

## Fora de escopo

- Aceitar `password` como array (a segunda alternativa da issue #1050). Nesta variante, o campo novo é `extraUnsealPasswords`.
- Qualquer outro nome público novo (função, opção de seal, evento de rotação etc.).
- Mudar o algoritmo de seal, as iterações de PBKDF2 ou o formato do cookie.
- Remover o fallback de `legacySealFallback` (isso fica para a v3, conforme o TODO existente).
- Ferramenta ou comando para forçar a expiração de sessões antigas após a rotação.
- Armazenamento de sessões no servidor, revogação individual ou lista de sessões ativas.
- Documentação fora do JSDoc (guia de migração, site de docs).
- Mudanças nas rotas de `h3/rules` ou no `cache`.

## Premissas

- **P-01:** A mudança fica em `src/utils/session.ts` e em `src/utils/internal/iron-crypto.ts`, se necessário, sem exportar novos nomes públicos.
- **P-02:** A rotação é feita pela aplicação: ela troca `password` e move a senha anterior para `extraUnsealPasswords`. O H3 não gerencia histórico de senhas.
- **P-03:** A regra de tamanho mínimo de 32 caracteres já existe para `password` e é reaproveitada para as senhas extras (a confirmar ao localizar a validação no código).
- **P-04:** RF-04 (regravar com a senha atual) segue o mesmo mecanismo que já existe para sessões seladas com o fallback legado. Se a regravação não ocorrer em alguma rota (ex.: leitura sem escrita), a sessão continua válida até a expiração, o que é aceitável.
- **P-05:** Não há mudança de comportamento para quem não usa o campo novo.

## Riscos

- **R-01 — Custo de CPU:** cada senha extra pode exigir uma tentativa completa de PBKDF2 (8192 iterações por padrão). Com várias senhas extras, uma requisição com sessão de senha antiga, ou com cookie inválido, paga o custo de todas as tentativas. Mitigação: limitar o número de senhas extras na documentação e medir o custo com `pnpm bench:node`.
- **R-02 — Combinação com o fallback legado:** cada tentativa pode ainda cair no fallback de 1 iteração. Isso multiplica as tentativas (até 2 por senha). É preciso testar essa combinação explicitamente.
- **R-03 — Retenção indefinida de senhas antigas:** se a aplicação esquecer `extraUnsealPasswords` por muito tempo, senhas vazadas continuam válidas para sessões não regravadas. Mitigação: a documentação deve orientar a remoção após a janela de `maxAge`/`idleTimeout`.
- **R-04 — Ordem e colisão:** se a mesma senha aparecer em `password` e em `extraUnsealPasswords`, o custo é desperdiçado sem efeito. Decidir se isso é erro de configuração ou apenas é ignorado.
- **R-05 — Vazamento de log:** erros de unseal não podem incluir o conteúdo das senhas. Revisar as mensagens de erro novas.
- **R-06 — Regressão silenciosa:** mudanças no caminho de unseal afetam todas as sessões. A suíte existente (`pnpm test`) e os testes matriciais web/node precisam cobrir os casos novos e o caso sem extras.
