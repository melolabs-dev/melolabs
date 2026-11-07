# PRD — Várias senhas de unseal nas sessões (h3js/h3#1050)

## Problema e objetivo

Hoje `useSession`, `getSession` e `updateSession` (`src/utils/session.ts`) usam uma única `password` para selar e para abrir o cookie de sessão. Ao trocar essa senha, todas as sessões seladas com a senha antiga deixam de abrir: a sessão é descartada e o usuário precisa fazer login de novo.

O objetivo é permitir a rotação de senha sem derrubar as sessões existentes. Para isso, `SessionConfig` ganha um campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores que só servem para abrir sessões. A senha que sela continua sendo `password`, e a rotação se completa sozinha: cada sessão aberta com uma senha extra é regravada com `password` na mesma resposta.

Sem `extraUnsealPasswords`, o comportamento deve ser idêntico ao atual.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

**Dado** uma configuração com `password` e `extraUnsealPasswords` contendo uma senha anterior,
**Quando** a sessão do cookie foi selada com essa senha anterior,
**Então** a sessão é carregada com o mesmo `id`, `createdAt` e `data` que teria com a senha atual.

### RF-02 — Selagem sempre com `password`

**Dado** uma configuração com `extraUnsealPasswords` preenchido,
**Quando** uma sessão nova é criada ou uma sessão existente é atualizada,
**Então** o cookie gravado é selado com `password`, e abre com `password` sozinha, sem nenhuma senha extra.

### RF-03 — Regravação ao abrir com senha extra

**Dado** um cookie selado com uma senha extra,
**Quando** a requisição lê a sessão por cookie,
**Então** a resposta traz um `Set-Cookie` com o cookie resselado com `password`, e uma requisição seguinte com esse cookie abre sem a senha extra.

### RF-04 — Ordem de tentativa

**Dado** uma configuração com `password` e uma lista de senhas extras,
**Quando** um cookie precisa ser aberto,
**Então** as senhas são tentadas nesta ordem: `password` primeiro e depois cada extra na ordem em que aparecem; a primeira que abrir o cookie vence e as seguintes não são tentadas. Senhas repetidas ou iguais a `password` não alteram o resultado.

### RF-05 — Sessão expirada continua rejeitada

**Dado** um cookie selado com uma senha extra cuja idade passou de `maxAge` (ou do `idleTimeout`),
**Quando** a sessão é lida,
**Então** ela é tratada como expirada, da mesma forma que hoje (a requisição recebe uma sessão nova), e nenhuma outra senha é tentada depois que uma delas abriu o cookie.

### RF-06 — Sem senhas extras, nada muda

**Dado** uma configuração sem `extraUnsealPasswords` ou com a lista vazia,
**Quando** qualquer operação de sessão é executada,
**Então** o resultado é o mesmo de hoje, e a suíte existente (`test/session.test.ts` e demais) passa sem alterar as asserções que verificam o comportamento atual.

### RF-07 — Compatibilidade com o fallback de selagem legada

**Dado** um cookie selado com 1 iteração de PBKDF2 (formato legado) e selado com uma senha extra,
**Quando** a sessão é lida com `legacySealFallback` no padrão,
**Então** a sessão é aberta e regravada com `password` com as opções de selagem atuais.

**Dado** o mesmo cookie e `legacySealFallback: false`,
**Quando** a sessão é lida,
**Então** o cookie é rejeitado, como acontece hoje com a senha única.

### RF-08 — Mesmo tratamento de validação que `password`

**Dado** uma senha extra que não atende a uma regra que `password` já cumpre (por exemplo, tamanho mínimo),
**Quando** a configuração é usada,
**Então** a senha extra recebe o mesmo tratamento que `password` recebe (mesmo erro ou mesma ausência de erro). Essa regra depende da premissa P-04 e deve ser confirmada na implementação.

### RF-09 — Sessões vindas do header

**Dado** uma sessão enviada pelo header de sessão (não pelo cookie) selada com uma senha extra,
**Quando** a sessão é lida,
**Então** ela é aceita, mas não é regravada, porque sessões de header nunca são resseladas hoje. O comportamento de expiração não muda.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050).
- Selar com mais de uma chave, ou gravar um identificador de chave (`kid`) no token.
- Novos exports públicos além do campo `extraUnsealPasswords`.
- Mudar algoritmo, número de iterações ou formato do seal (`SealOptions`).
- Remover `legacySealFallback` (isso fica para a v3, conforme o TODO em `unsealSession`).
- Invalidar ativamente sessões antigas (lista de revogação, contador de versão) ou detectar quando uma senha antiga pode sair da configuração.
- Rotação automática ou gerenciamento de segredos (cofre, variáveis de ambiente, agendamento).
- Mudanças em `sealSession` além do estritamente necessário para a nova regra de abertura.
- Mudanças em cookies de outras bibliotecas ou em sessões que não usam `SessionConfig`.

## Premissas e riscos

### Premissas

- **P-01:** `password` continua sendo a única chave de selagem. As senhas extras servem só para abrir.
- **P-02:** O token selado não carrega identificador de chave, então a escolha da senha é feita por tentativa, na ordem definida em RF-04.
- **P-03:** A configuração é estática por instância de `useSession` (ou por chamada), e a rotação é feita trocando `password` e movendo a senha antiga para `extraUnsealPasswords`.
- **P-04:** A regra de validação de `password` (tamanho mínimo, por exemplo) é aplicada hoje dentro de `seal`/`unseal` em `src/utils/internal/iron-crypto.ts` ou no próprio `session.ts`. Isso precisa ser confirmado antes de implementar RF-08.
- **P-05:** `unsealSession` é exportada. Hoje ela recebe `config` e usa `config.password`, então a mudança deve manter essa assinatura e apenas ampliar o que é tentado.

### Riscos

- **R-01 — Senha antiga comprometida:** enquanto a senha antiga estiver na lista, quem a tiver consegue abrir sessões seladas com ela. Isso vale até as sessões expirarem.
- **R-02 — Sessões sem expiração:** se `maxAge` e `idleTimeout` não estiverem configurados, sessões antigas nunca expiram e continuam válidas com a senha antiga enquanto a lista existir. Nesse caso a remoção da senha só acontece depois que o usuário relogar.
- **R-03 — Amplificação de CPU:** cada senha extra é uma tentativa de PBKDF2 (8192 iterações por padrão), e o fallback legado pode dobrar isso. Um cookie inválido passa a custar até N+1 aberturas por requisição, o que facilita negação de serviço com cookies forjados. Pode ser mitigado com um limite de tamanho da lista ou documentação, mas não está no escopo deste PRD.
- **R-04 — Sessões de header não se renovam:** sessões enviadas por header continuam aceitas com a senha antiga até expirarem, pois não são regravadas (RF-09).
- **R-05 — Senhas antigas em código ou config:** as senhas anteriores ficam no código ou na configuração até a limpeza manual. Isso aumenta a superfície de vazamento de segredos.
- **R-06 — Compatibilidade de `unsealSession`:** como a função é exportada, mudar o comportamento de tentativa pode afetar quem a chama diretamente. Isso precisa ser verificado na implementação.

### Restrições de verificação

- A suíte existente deve passar sem enfraquecer asserções (RF-06).
- `pnpm lint` e `pnpm typecheck` devem passar.
- Cada RF deve ter teste, e os testes devem ser escritos antes da correção quando reproduzirem um bug, conforme o fluxo de correção do AGENTS.md.
- Os testes devem rodar nos modos `web` e `node` (`describeMatrix`), já que `session.ts` é usado nos dois.
