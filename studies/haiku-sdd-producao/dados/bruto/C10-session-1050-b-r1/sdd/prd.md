# PRD: várias senhas de unseal nas sessões

Referência: issue h3js/h3#1050 (primeira alternativa, campo `extraUnsealPasswords`) e contrato enxuto em `sdd/pedido.md`.

## Problema e objetivo

Hoje `useSession`, `getSession` e `updateSession` (`src/utils/session.ts`) usam uma única `password` para selar e para abrir o cookie ou o header de sessão. Quando um time troca a senha, todas as sessões seladas com a senha anterior passam a ser inválidas e os usuários são deslogados de uma vez.

O objetivo é permitir a rotação de segredos sem derrubar sessões ativas: a aplicação informa senhas anteriores que **só servem para abrir** sessões existentes, enquanto a `password` atual continua sendo a única usada para selar. Com isso a rotação passa a ser um deploy comum, e as sessões migram para a senha nova conforme são usadas.

Não é objetivo deste PRD mudar o formato do selo, a derivação das chaves, os nomes públicos além do campo pedido, nem o comportamento de sessões sem senhas extras.

## Requisitos funcionais

### RF-01 — Abrir sessão com a senha atual ou com uma senha extra

O sistema tenta abrir o selo primeiro com `password` e, se falhar por HMAC inválido, tenta cada item de `extraUnsealPasswords` na ordem do array. A primeira senha que abrir o selo vence.

**Critério de aceite**
- Dado uma sessão selada com a senha `A` e uma config com `password: B` e `extraUnsealPasswords: [A]`,
- Quando a requisição chega com esse cookie e a sessão é lida,
- Então `session.data` contém os dados originais, `session.id` é o id original e nenhum erro é lançado.

### RF-02 — Selar sempre com a senha atual

Senhas extras nunca são usadas para selar. Qualquer `Set-Cookie` emitido por `updateSession` ou pelo reseal de `idleTimeout` deve ser decifrável apenas com `password`.

**Critério de aceite**
- Dado uma config com `password: B` e `extraUnsealPasswords: [A]`,
- Quando `updateSession` grava dados em uma sessão nova,
- Então o cookie resultante abre com `B` e falha com `A` (sem usar as extras).

### RF-03 — Regravar sessões abertas por senha extra

Quando uma sessão só abre com uma senha extra, o sistema a regrava com `password` na mesma leitura (`getSession`), emitindo novo `Set-Cookie`, para que a rotação avance sem depender de a sessão ser escrita pelo handler.

**Critério de aceite**
- Dado uma sessão selada com `A` e uma config com `password: B` e `extraUnsealPasswords: [A]`,
- Quando `getSession` lê essa sessão numa requisição,
- Então a resposta contém `Set-Cookie` da sessão, e o cookie novo abre com `B` mas não com `A`.

### RF-04 — Sem senhas extras, comportamento inalterado

Se `extraUnsealPasswords` não for definido ou for um array vazio, o comportamento é idêntico ao atual: mesmas chamadas de unseal, mesmos erros, mesmo fallback legado e mesmos `Set-Cookie`.

**Critério de aceite**
- Dado uma config sem `extraUnsealPasswords` (e outra com `[]`),
- Quando uma sessão selada com outra senha é lida,
- Então a sessão é tratada como inválida (nova, sem dados), exatamente como hoje, e a suíte existente de `test/session.test.ts` passa sem alterações de expectativa.

### RF-05 — Expiração não é mascarada pela troca de senha

`maxAge` e `idleTimeout` valem independentemente de qual senha abriu a sessão. Se a senha estiver correta mas a sessão tiver expirado, o erro `Session expired!` deve ser lançado; o sistema não pode tentar as próximas senhas nem tratar a sessão como válida.

**Critério de aceite**
- Dado uma sessão selada com a senha extra `A`, com `createdAt` além de `maxAge`, e uma config com `password: B`, `extraUnsealPasswords: [A]` e `maxAge` definido,
- Quando `unsealSession` é chamado com o selo,
- Então ele lança `Session expired!` e não retorna dados.

### RF-06 — Fallback legado por senha

O fallback de selo legado (1 iteração PBKDF2, enquanto `legacySealFallback` não for `false`) é aplicado a cada senha candidata, na mesma ordem: primeiro a senha atual, depois cada extra.

**Critério de aceite**
- Dado uma sessão selada com a senha extra `A` usando 1 iteração PBKDF2,
- Quando a config tem `password: B`, `extraUnsealPasswords: [A]` e `legacySealFallback` não definido,
- Então a sessão é aberta e regravada com `B` (RF-03).

### RF-07 — Validação das senhas extras

Cada item de `extraUnsealPasswords` segue a mesma regra de `password`: string não vazia com pelo menos 32 caracteres. Uma senha inválida não pode ser ignorada em silêncio.

**Critério de aceite**
- Dado uma config com `extraUnsealPasswords: ["curta"]` ou `[""]`,
- Quando `useSession` ou `getSession` é chamado,
- Então a chamada lança erro que identifica a configuração inválida, antes de ler o cookie ou o header.

### RF-08 — Cobertura para cookie e header de sessão

RF-01 a RF-06 valem tanto para a sessão lida do cookie quanto para a lida do header `sessionHeader`. Como o header nunca é regravado (ver `idleTimeout` em `SessionConfig`), para ele vale apenas a abertura (RF-01) e a expiração (RF-05).

**Critério de aceite**
- Dado uma sessão selada com `A` enviada no header `x-h3-session`, e uma config com `password: B` e `extraUnsealPasswords: [A]`,
- Quando `getSession` lê a requisição,
- Então os dados da sessão são retornados e a resposta não contém `Set-Cookie` da sessão.

### RF-09 — Superfície pública mínima

A única mudança de API pública é o campo opcional `extraUnsealPasswords?: string[]` em `SessionConfig`, com JSDoc explicando que as senhas só abrem sessões e que a `password` sela. Nenhuma função, tipo ou export novo é criado.

**Critério de aceite**
- Dado o código após a mudança,
- Quando se compara a lista de exports de `src/index.ts` e `src/utils/session.ts` com a versão anterior,
- Então a única diferença é o campo `extraUnsealPasswords` no tipo `SessionConfig`.

### RF-10 — Testes e qualidade

Os novos comportamentos são cobertos por testes que rodam nos modos `web` e `node` (`describeMatrix`), e o projeto segue passando nos checks de qualidade.

**Critério de aceite**
- Dado a implementação pronta,
- Quando rodam `pnpm vitest run test/session.test.ts`, `pnpm lint` e `pnpm typecheck`,
- Então todos passam, e há ao menos um teste para cada RF-01 a RF-08 em ambos os modos.

## Fora de escopo

- Aceitar um array em `password` (a segunda alternativa da issue #1050).
- Identificadores de chave (`kid`) ou metadados que indiquem qual senha selou cada sessão.
- Automação de rotação, agendamento ou ferramentas de CLI para trocar senhas.
- Remoção do fallback legado (`legacySealFallback`); isso continua previsto só para a v3.
- Mudança no formato do selo, nos algoritmos ou nas iterações de `SealOptions`.
- Atualização da documentação do site em `docs/` (o campo fica documentado no JSDoc, conforme o pedido, que limita a mudança a código e testes).
- Mudanças em `useSession` para além da validação de RF-07.
- Compatibilidade com v1 (`src/_deprecated.ts`).

## Premissas

- **P1 — Regravação ao abrir com senha extra (RF-03).** O pedido não fala sobre isso. Assumo que a migração deve acontecer no próprio acesso, sem depender de escrita do handler, porque é isso que permite remover a senha antiga depois. Se o time preferir regravar só em escritas, RF-03 deve ser revisto.
- **P2 — Ordem das tentativas.** A senha atual é sempre a primeira; as extras seguem a ordem do array. Não há prioridade por data.
- **P3 — Mesmo tratamento de erro.** Um erro que não seja HMAC inválido (ex.: expiração) interrompe a tentativa, como hoje com a senha atual.
- **P4 — Chamadas a `unseal` por senha.** Cada senha extra testada custa uma derivação PBKDF2 completa quando não bate. Assumo que a lista é curta (poucas senhas por janela de rotação).
- **P5 — Janela de rotação é responsabilidade de quem configura.** O sistema não sabe quando uma senha antiga deve sair da lista. Quem configura remove a extra quando as sessões antigas já expiraram (`maxAge` / `idleTimeout`).

## Riscos

- **R1 — Senha antiga aceita enquanto estiver na lista.** Um vazamento da senha antiga continua permitindo forjar sessões até ela sair de `extraUnsealPasswords`. Mitigação: documentar a janela e recomendar `maxAge` ou `idleTimeout` configurados, porque sem eles uma sessão não expira. Sessões antigas sem expiração ficam válidas enquanto a senha estiver na lista.
- **R2 — Amplificação de custo (DoS).** Um cliente que envia cookies inválidos força uma tentativa por senha extra em cada requisição, multiplicando o custo de PBKDF2 do caminho de falha. Mitigação: limitar a lista na documentação e garantir que cada senha extra é tentada no máximo uma vez por unseal, sem repetir tentativas.
- **R3 — Erro silencioso.** Hoje `getSession` engole erros de unseal (`.catch(() => {})`). Sem RF-07, uma extra inválida faria a sessão ser descartada sem aviso. RF-07 existe para evitar isso.
- **R4 — Regravação em concorrência.** Duas requisições simultâneas com a mesma sessão antiga podem emitir dois `Set-Cookie`. Ambos decifram com a senha atual, então o efeito é benigno, mas o teste de RF-03 não deve depender de ordem.
- **R5 — Regressão no caminho comum.** A mudança toca `unsealSession` e `getSession`, que são o caminho mais quente de sessão. Mitigação: RF-04 com a suíte existente sem alterações de expectativa e revisão de custo quando não há extras (nenhuma tentativa extra deve ocorrer).
