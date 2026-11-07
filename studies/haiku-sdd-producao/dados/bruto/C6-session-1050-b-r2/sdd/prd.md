# PRD — Várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa proposta nela) e contrato `sdd/pedido.md`.

## Problema e objetivo

Hoje `useSession` (e `getSession`/`updateSession`) usa uma única `password` de `SessionConfig` para selar e para abrir o cookie de sessão (`src/utils/session.ts`). Quando o time gira o segredo, todas as sessões seladas com a senha anterior passam a ser descartadas: os usuários são deslogados de uma vez.

**Objetivo:** permitir configurar senhas anteriores que só servem para abrir sessões já existentes, mantendo a senha atual como a única que sela. Assim a rotação de segredo deixa de deslogar quem já está autenticado, e nada muda para quem não usa o recurso.

## Requisitos funcionais

### RF-01 — Campo `extraUnsealPasswords` em `SessionConfig`

- **Dado** uma configuração de sessão com `password: "nova-senha"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** o tipo `SessionConfig` é usado em `useSession`
- **Então** o campo é opcional, do tipo `string[]`, e `password` continua do tipo `string`, sem nenhum outro nome público novo.

### RF-02 — Selagem sempre com a senha atual

- **Dado** uma configuração com `password: "nova-senha"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a sessão é selada (`updateSession` ou `sealSession`)
- **Então** o cookie gerado é aberto com `"nova-senha"` e é rejeitado quando só `"senha-antiga"` é tentada.

### RF-03 — Desselagem tenta as senhas em ordem, por cookie e por header

- **Dado** uma sessão selada com `"senha-antiga"` e uma configuração com `password: "nova-senha"` e `extraUnsealPasswords: ["senha-antiga"]`
- **Quando** a requisição chega com essa sessão no cookie `h3` ou no header `x-{name}-session`
- **Então** a sessão é carregada com o `id`, o `createdAt` e os `data` originais, e a primeira senha que abrir o token vence (`password` primeiro, depois as extras na ordem do array).

### RF-04 — Sem senhas extras, o comportamento não muda

- **Dado** uma configuração sem `extraUnsealPasswords` ou com `extraUnsealPasswords: []`
- **Quando** chega uma sessão selada com outra senha
- **Então** ela é tratada como hoje: é descartada, uma nova sessão é criada e nenhum erro é lançado para o handler. A suíte de testes existente passa sem alteração de asserções.

### RF-05 — Senha não listada continua inválida

- **Dado** uma sessão selada com uma senha que não está em `password` nem em `extraUnsealPasswords`
- **Quando** a sessão é lida
- **Então** ela é descartada como hoje, sem revelar qual das senhas configuradas foi tentada.

### RF-06 — Fallback legado vale para cada senha candidata

- **Dado** uma sessão selada com 1 iteração PBKDF2 (formato legado) sob uma senha extra, e `legacySealFallback` diferente de `false`
- **Quando** a sessão é lida
- **Então** ela é aberta e marcada para reselagem, como acontece hoje com a senha atual. Com `legacySealFallback: false`, ela é rejeitada.

### RF-07 — Sessão aberta por senha extra é resselada com a senha atual

- **Dado** uma sessão baseada em cookie aberta com uma senha extra
- **Quando** a requisição termina com a sessão lida
- **Então** o `Set-Cookie` emitido é selado com `password`, e a próxima requisição abre a sessão apenas com `password`.

### RF-08 — Expiração continua valendo para sessões de senha extra

- **Dado** uma sessão selada com uma senha extra que já passou de `maxAge`, ou que ficou mais de `idleTimeout` sem reselagem
- **Quando** a sessão é lida
- **Então** ela é tratada como expirada, exatamente como uma sessão selada com a senha atual. Senhas antigas não estendem a vida da sessão.

### RF-09 — Senhas extras inválidas falham de forma explícita

- **Dado** uma configuração com `extraUnsealPasswords` contendo uma string vazia ou mais curta que o mínimo exigido para `password`
- **Quando** `useSession` ou `getSession` é chamado com essa configuração
- **Então** o erro é lançado antes de ler o cookie, com mensagem que cita `extraUnsealPasswords` sem incluir o valor da senha. Ela não é tratada como sessão inválida em silêncio.

## Fora de escopo

- Aceitar `password` como array, com a primeira senha selando e as demais só abrindo (alternativa 2 da issue).
- Rotação automática, agendada ou por tempo das senhas, e qualquer API para remover senhas em tempo de execução.
- Reselagem em massa de sessões. As sessões vivem só no cookie ou no header, então não há armazenamento no servidor para migrar.
- Mudança no formato do token selado, nos ids de senha do iron ou em `seal`.
- Alterações em `legacySealFallback`, que já está deprecated e sai na v3.
- Logs ou métricas de qual senha abriu cada sessão.
- Alterações em `_deprecated.ts` ou no comportamento da v1.

## Premissas e riscos

### Premissas

- **P1.** `useSession`, `getSession`, `updateSession` e `unsealSession` já recebem o mesmo `config`. Por isso a mudança fica em `SessionConfig` e no caminho de desselagem (`session.ts:196` e `session.ts:312-367`), sem alterar a assinatura pública.
- **P2.** Com senha em formato string, o token do iron não carrega id de senha (`iron-crypto.ts:304-318`, `_passwordId || "default"`). A escolha da senha acontece por tentativa, então o formato selado atual continua válido.
- **P3.** A reselagem com a senha atual (RF-07) é a recomendação deste PRD. Se o time preferir manter senhas antigas indefinidamente, RF-07 sai do escopo e a responsabilidade de remover senhas fica com quem configura o app.
- **P4.** Restrições do contrato: nenhum outro nome público novo; `pnpm lint` e `pnpm typecheck` passam; a suíte existente passa, com ajuste só onde a mudança altera o que os testes verificam.
- **P5.** Os testes novos usam `describeMatrix`, para rodar em `web` e `node`, como manda o `AGENTS.md`.

### Riscos

- **R1. Falha silenciosa.** `getSession` engole erros de desselagem (`session.ts:198`, `.catch(() => {})`). Uma senha extra errada derruba sessões sem nenhum sinal. Mitigação: RF-09, e um teste que confirme a mensagem de erro.
- **R2. Custo de CPU.** Cada tentativa é uma derivação PBKDF2 com 8192 iterações. Um cookie inválido custa uma tentativa por senha configurada, e até o dobro com o fallback legado. Um atacante pode usar isso para amplificar o custo por requisição. Mitigação: documentar que a lista deve ser curta e que as senhas antigas devem sair logo após a rotação.
- **R3. Senha antiga ainda válida.** Enquanto a senha antiga estiver na lista, quem a tiver pode forjar sessões. Mitigação: documentar o procedimento de remoção. Remover a senha é responsabilidade de quem configura, fora de escopo.
- **R4. Interação com a lógica de reselagem.** O novo gatilho de RF-07 precisa conviver com `legacySeal` e `shouldSlide` (`session.ts:214`). O risco é selar duas vezes na mesma requisição. O `setCookie` já deduplica `Set-Cookie`, mas vale um teste de contagem.
- **R5. Sessões vindas por header.** Uma sessão aberta por senha extra no header não pode ser resselada (`session.ts:65`). Ela continua sendo aberta pela senha antiga até expirar ou até o cliente receber um cookie novo.
